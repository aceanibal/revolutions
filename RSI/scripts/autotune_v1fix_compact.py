#!/usr/bin/env python3
"""
Compact autotuner for V1FIX replay.

Default grid (as requested):
- RSI combos: 2
- Stage1 (mfe1/lock1) combos: 2
- TP combos: 2
- SL combos: 1

Defaults target symbols: XRPUSDT, LINKUSDT, ETHUSDT
Default horizon: latest 6 months (unless start/end are provided).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
SIM_DIR = os.path.join(PROJECT_ROOT, "simulation")
if SIM_DIR not in sys.path:
    sys.path.insert(0, SIM_DIR)
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from ltf_trade_management_study_v1fix import (  # noqa: E402
    replay_trade_5m,
    replay_trade_mfe_ladder_5m,
    tp_price_from_r,
)
from massive_chunk_backtest_5m_v1fix import build_4h_rsi, load_merged_5m  # noqa: E402
from multi_asset_4h_rsi_sim import DB_PATH, run_simulation_trades  # noqa: E402


CACHE_DIR = os.path.join(PROJECT_ROOT, "cache")
RUNS_DIR = os.path.join(PROJECT_ROOT, "runs")
DEFAULT_GRID_CSV = os.path.join(CACHE_DIR, "v1fix_autotune_compact_grid.csv")
DEFAULT_SUMMARY_CSV = os.path.join(CACHE_DIR, "v1fix_autotune_compact_summary.csv")
DEFAULT_REPORT_MD = os.path.join(PROJECT_ROOT, "FINAL_V1FIX_AUTOTUNE_COMPACT.md")


@dataclass
class EvalRow:
    symbol: str
    rsi_period: int
    rsi_l: int
    rsi_h: int
    sl_n: int
    tp_r: float
    mfe1: float
    lock1: float
    mfe2: float
    lock2: float
    n_trades: int
    baseline_total_r: float
    managed_total_r: float
    delta_m_minus_b: float
    win_pct: float
    max_dd_r: float
    avg_hold_h: float


def parse_symbols(s: str) -> list[str]:
    out = [x.strip().upper() for x in s.split(",") if x.strip()]
    if not out:
        raise ValueError("symbols cannot be empty")
    return out


def parse_float_grid(s: str) -> list[float]:
    vals = [float(x.strip()) for x in s.split(",") if x.strip()]
    if not vals:
        raise ValueError("empty float grid")
    return vals


def parse_int_grid(s: str) -> list[int]:
    vals = [int(x.strip()) for x in s.split(",") if x.strip()]
    if not vals:
        raise ValueError("empty int grid")
    return vals


def parse_pairs_int(s: str) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for part in s.split(","):
        part = part.strip()
        if not part:
            continue
        a, b = part.split(":")
        out.append((int(a), int(b)))
    if not out:
        raise ValueError("empty pair grid")
    return out


def parse_pairs_float(s: str) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for part in s.split(","):
        part = part.strip()
        if not part:
            continue
        a, b = part.split(":")
        out.append((float(a), float(b)))
    if not out:
        raise ValueError("empty pair grid")
    return out


def max_drawdown_r(pnls: np.ndarray) -> float:
    if len(pnls) == 0:
        return 0.0
    c = np.cumsum(pnls)
    peak = np.maximum.accumulate(c)
    return float(np.max(peak - c))


def df_to_md_table(df: pd.DataFrame) -> str:
    if len(df) == 0:
        return "_Empty._"
    cols = list(df.columns)
    lines = ["| " + " | ".join(cols) + " |", "| " + " | ".join("---" for _ in cols) + " |"]
    for _, row in df.iterrows():
        lines.append("| " + " | ".join(str(row[c]).replace("|", "\\|") for c in cols) + " |")
    return "\n".join(lines)


def resolve_window(
    all_data: dict[str, pd.DataFrame],
    start_utc: str,
    end_utc: str,
    horizon_months: int,
) -> tuple[pd.Timestamp, pd.Timestamp]:
    if start_utc and end_utc:
        return pd.Timestamp(start_utc, tz="UTC"), pd.Timestamp(end_utc, tz="UTC")

    if not end_utc:
        mx = None
        for df in all_data.values():
            if len(df) == 0:
                continue
            x = df.index.max() + pd.Timedelta(minutes=5)
            mx = x if mx is None else max(mx, x)
        if mx is None:
            raise RuntimeError("No data found for selected symbols.")
        end_ts = mx
    else:
        end_ts = pd.Timestamp(end_utc, tz="UTC")

    if start_utc:
        start_ts = pd.Timestamp(start_utc, tz="UTC")
    else:
        start_ts = end_ts - pd.DateOffset(months=horizon_months)
        if start_ts.tz is None:
            start_ts = start_ts.tz_localize(timezone.utc)
        else:
            start_ts = start_ts.tz_convert("UTC")
    if start_ts >= end_ts:
        raise ValueError("start_utc must be before end_utc")
    return start_ts, end_ts


def resolve_output_paths(out_prefix: str) -> tuple[str, str, str]:
    prefix = out_prefix.strip()
    if not prefix:
        return DEFAULT_GRID_CSV, DEFAULT_SUMMARY_CSV, DEFAULT_REPORT_MD
    safe = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in prefix).strip("_")
    if not safe:
        safe = "run"
    return (
        os.path.join(CACHE_DIR, f"v1fix_autotune_compact_{safe}_grid.csv"),
        os.path.join(CACHE_DIR, f"v1fix_autotune_compact_{safe}_summary.csv"),
        os.path.join(PROJECT_ROOT, f"FINAL_V1FIX_AUTOTUNE_COMPACT_{safe}.md"),
    )


def create_sequencer_run_dirs(run_label: str) -> tuple[Path, Path, Path]:
    now = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    run_id = f"run_v1fix_autotune_{run_label}_{now}" if run_label else f"run_v1fix_autotune_{now}"
    run_dir = Path(RUNS_DIR) / run_id
    artifacts_dir = run_dir / "artifacts"
    trades_dir = run_dir / "trades"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    trades_dir.mkdir(parents=True, exist_ok=True)
    return run_dir, artifacts_dir, trades_dir


def write_manifest(run_dir: Path) -> None:
    manifest = sorted(str(p.relative_to(run_dir)) for p in run_dir.rglob("*") if p.is_file())
    (run_dir / "manifest_files.txt").write_text("\n".join(manifest) + "\n", encoding="utf-8")


def evaluate_replay_for_trades(
    *,
    df5w: pd.DataFrame,
    idx: pd.Index,
    trades: list[dict],
    symbol: str,
    rsi_period: int,
    start_utc: pd.Timestamp,
    end_utc: pd.Timestamp,
    rsi_l: int,
    rsi_h: int,
    sl_n: int,
    fee_bps: float,
    tp_r: float,
    stages: list[tuple[float, float]],
    skip_entry_bucket_hours: float,
    force_managed_equal_baseline: bool,
) -> EvalRow | None:
    base_rows: list[float] = []
    mfe_rows: list[float] = []
    hold_rows: list[float] = []
    for t in trades:
        entry_ts = idx[t["entry_idx"]]
        tp_px = tp_price_from_r(t["entry_price"], t["risk"], t["side"], tp_r)
        base = replay_trade_5m(
            df5w,
            entry_ts,
            t["side"],
            t["entry_price"],
            t["stop_loss"],
            tp_px,
            t["risk"],
            fee_bps,
            be_trigger_r=None,
            be_offset_r=0.0,
            skip_entry_bucket_hours=skip_entry_bucket_hours,
        )
        if base is None:
            continue
        if force_managed_equal_baseline:
            managed_pnl_r = float(base.pnl_r)
            managed_bars = int(base.bars)
            ex = pd.Timestamp(base.exit_ts).tz_convert("UTC")
        else:
            mfe = replay_trade_mfe_ladder_5m(
                df5w,
                entry_ts,
                t["side"],
                t["entry_price"],
                t["stop_loss"],
                tp_px,
                t["risk"],
                fee_bps,
                stages=stages,
                cap_lock_by_mfe=True,
                skip_entry_bucket_hours=skip_entry_bucket_hours,
            )
            if mfe is None:
                continue
            managed_pnl_r = float(mfe.pnl_r)
            managed_bars = int(mfe.bars)
            ex = pd.Timestamp(mfe.exit_ts).tz_convert("UTC")
        if ex < start_utc or ex >= end_utc:
            continue
        base_rows.append(float(base.pnl_r))
        mfe_rows.append(managed_pnl_r)
        hold_rows.append(float(managed_bars * 5.0 / 60.0))

    if not mfe_rows:
        return None

    base_arr = np.array(base_rows, dtype=float)
    mfe_arr = np.array(mfe_rows, dtype=float)
    hold_arr = np.array(hold_rows, dtype=float)
    return EvalRow(
        symbol=symbol,
        rsi_period=rsi_period,
        rsi_l=rsi_l,
        rsi_h=rsi_h,
        sl_n=sl_n,
        tp_r=tp_r,
        mfe1=stages[0][0],
        lock1=stages[0][1],
        mfe2=stages[1][0],
        lock2=stages[1][1],
        n_trades=int(len(mfe_arr)),
        baseline_total_r=float(base_arr.sum()),
        managed_total_r=float(mfe_arr.sum()),
        delta_m_minus_b=float(mfe_arr.sum() - base_arr.sum()),
        win_pct=float(np.mean(mfe_arr > 0) * 100.0),
        max_dd_r=max_drawdown_r(mfe_arr),
        avg_hold_h=float(hold_arr.mean()),
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="Compact autotune for V1FIX (RSI/MFE1/TP/SL grids).")
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--symbols", default="XRPUSDT,LINKUSDT,ETHUSDT")
    ap.add_argument("--horizon-months", type=int, default=6)
    ap.add_argument("--start-utc", default="")
    ap.add_argument("--end-utc", default="")

    ap.add_argument("--rsi-combos", default="35:60,40:65", help="Pairs rsi_l:rsi_h, comma-separated.")
    ap.add_argument(
        "--rsi-period-grid",
        default="7,14,21,28",
        help="RSI window grid for 4h RSI calculation.",
    )
    ap.add_argument("--stage1-combos", default="1.0:0.8,0.9:0.7", help="Pairs mfe1:lock1.")
    ap.add_argument(
        "--stage2-combos",
        default="",
        help="Optional pairs mfe2:lock2 (comma-separated). If empty, uses a single pair (--mfe2, --lock2).",
    )
    ap.add_argument("--tp-grid", default="8,10", help="Replay TP grid in R.")
    ap.add_argument("--sl-grid", default="2", help="SL lookback N grid (MAE proxy).")

    ap.add_argument("--mfe2", type=float, default=6.5, help="Stage2 MFE when --stage2-combos is empty.")
    ap.add_argument("--lock2", type=float, default=5.5, help="Stage2 lock when --stage2-combos is empty.")
    ap.add_argument("--entry-tp-r", type=float, default=5.0)
    ap.add_argument("--fee-bps", type=float, default=3.0)
    ap.add_argument("--skip-entry-bucket-hours", type=float, default=0.0)
    ap.add_argument(
        "--force-managed-equal-baseline",
        action="store_true",
        help="Use baseline replay for managed leg too (managed_r == baseline_r). "
        "Useful for pure TP/SL baseline sweeps.",
    )
    ap.add_argument("--top-k", type=int, default=10)
    ap.add_argument("--out-prefix", default="", help="Optional suffix for output artifact filenames.")
    ap.add_argument(
        "--sequencer-layout",
        action="store_true",
        help="Package outputs under runs/<run_id>/ with run_config + artifacts + manifest.",
    )
    ap.add_argument(
        "--run-label",
        default="",
        help="Optional label inserted into run_id when --sequencer-layout is enabled.",
    )
    args = ap.parse_args()

    os.makedirs(CACHE_DIR, exist_ok=True)
    symbols = parse_symbols(args.symbols)
    rsi_combos = parse_pairs_int(args.rsi_combos)
    rsi_period_grid = sorted(set(parse_int_grid(args.rsi_period_grid)))
    stage1_combos = parse_pairs_float(args.stage1_combos)
    if args.stage2_combos.strip():
        stage2_combos = parse_pairs_float(args.stage2_combos)
    else:
        stage2_combos = [(args.mfe2, args.lock2)]
    tp_grid = parse_float_grid(args.tp_grid)
    sl_grid = parse_int_grid(args.sl_grid)
    grid_csv, summary_csv, report_md = resolve_output_paths(args.out_prefix)
    run_dir: Path | None = None
    artifacts_dir: Path | None = None
    trades_dir: Path | None = None
    if args.sequencer_layout:
        run_dir, artifacts_dir, trades_dir = create_sequencer_run_dirs(args.run_label.strip())
        grid_csv = str(artifacts_dir / Path(grid_csv).name)
        summary_csv = str(artifacts_dir / Path(summary_csv).name)
        report_md = str(artifacts_dir / Path(report_md).name)

    all_data: dict[str, pd.DataFrame] = {}
    db_path = os.path.abspath(args.db)
    for sym in symbols:
        all_data[sym] = load_merged_5m(db_path, sym)

    start_ts, end_ts = resolve_window(all_data, args.start_utc, args.end_utc, args.horizon_months)
    print(
        f"V1FIX autotune window: {start_ts.isoformat()} -> {end_ts.isoformat()} | "
        f"symbols={','.join(symbols)}"
    )
    if run_dir is not None:
        run_config = {
            "run_id": run_dir.name,
            "variant": "v1fix_compact_autotune",
            "script": "scripts/autotune_v1fix_compact.py",
            "db": os.path.abspath(args.db),
            "symbols": symbols,
            "horizon_months": args.horizon_months,
            "start_utc": args.start_utc or start_ts.isoformat(),
            "end_utc": args.end_utc or end_ts.isoformat(),
            "resolved_window_start_utc": start_ts.isoformat(),
            "resolved_window_end_utc": end_ts.isoformat(),
            "rsi_period_grid": rsi_period_grid,
            "rsi_combos": args.rsi_combos,
            "stage1_combos": args.stage1_combos,
            "stage2_combos": args.stage2_combos.strip() or f"{args.mfe2}:{args.lock2}",
            "tp_grid": tp_grid,
            "sl_grid": sl_grid,
            "mfe2": args.mfe2,
            "lock2": args.lock2,
            "entry_tp_r": args.entry_tp_r,
            "fee_bps": args.fee_bps,
            "skip_entry_bucket_hours": args.skip_entry_bucket_hours,
            "force_managed_equal_baseline": args.force_managed_equal_baseline,
            "out_prefix": args.out_prefix,
        }
        (run_dir / "run_config.json").write_text(json.dumps(run_config, indent=2), encoding="utf-8")
        print(f"Run package initialized: {run_dir}")

    rows: list[dict] = []
    total = (
        len(symbols)
        * len(rsi_period_grid)
        * len(rsi_combos)
        * len(stage1_combos)
        * len(stage2_combos)
        * len(tp_grid)
        * len(sl_grid)
    )
    done = 0
    t0 = pd.Timestamp.utcnow()
    for sym in symbols:
        df5 = all_data[sym]
        if len(df5) == 0:
            done += (
                len(rsi_period_grid)
                * len(rsi_combos)
                * len(stage1_combos)
                * len(stage2_combos)
                * len(tp_grid)
                * len(sl_grid)
            )
            if done % 10 == 0 or done == total:
                print(f"Progress: {done}/{total}")
            continue
        df5w = df5.loc[(df5.index >= start_ts) & (df5.index < end_ts)].copy()
        if len(df5w) == 0:
            done += (
                len(rsi_period_grid)
                * len(rsi_combos)
                * len(stage1_combos)
                * len(stage2_combos)
                * len(tp_grid)
                * len(sl_grid)
            )
            if done % 10 == 0 or done == total:
                print(f"Progress: {done}/{total}")
            continue
        for rsi_period in rsi_period_grid:
            df4h = build_4h_rsi(df5w, rsi_window=rsi_period)
            o = df4h["open"].values
            h = df4h["high"].values
            low = df4h["low"].values
            rsi = df4h["RSI"].values
            idx = df4h.index
            for rsi_l, rsi_h in rsi_combos:
                for sl_n in sl_grid:
                    if len(df4h) < sl_n + 5:
                        done += len(stage1_combos) * len(stage2_combos) * len(tp_grid)
                        if done % 10 == 0 or done == total:
                            print(f"Progress: {done}/{total}")
                        continue
                    trades = run_simulation_trades(o, h, low, rsi, rsi_l, rsi_h, sl_n, args.entry_tp_r, args.fee_bps)
                    for tp_r in tp_grid:
                        for mfe1, lock1 in stage1_combos:
                            for mfe2, lock2 in stage2_combos:
                                stages = [(mfe1, lock1), (mfe2, lock2)]
                                ev = evaluate_replay_for_trades(
                                    df5w=df5w,
                                    idx=idx,
                                    trades=trades,
                                    symbol=sym,
                                    rsi_period=rsi_period,
                                    start_utc=start_ts,
                                    end_utc=end_ts,
                                    rsi_l=rsi_l,
                                    rsi_h=rsi_h,
                                    sl_n=sl_n,
                                    fee_bps=args.fee_bps,
                                    tp_r=tp_r,
                                    stages=stages,
                                    skip_entry_bucket_hours=args.skip_entry_bucket_hours,
                                    force_managed_equal_baseline=args.force_managed_equal_baseline,
                                )
                                done += 1
                                if done % 10 == 0 or done == total:
                                    elapsed_s = max((pd.Timestamp.utcnow() - t0).total_seconds(), 1e-9)
                                    rate = done / elapsed_s
                                    remaining = max(total - done, 0)
                                    eta_s = remaining / rate if rate > 0 else float("inf")
                                    eta_min = eta_s / 60.0 if np.isfinite(eta_s) else float("inf")
                                    pct = (100.0 * done / total) if total > 0 else 100.0
                                    print(
                                        f"Progress: {done}/{total} ({pct:.1f}%) | "
                                        f"elapsed={elapsed_s/60.0:.1f}m | eta={eta_min:.1f}m"
                                    )
                                if ev is None:
                                    continue
                                rows.append(ev.__dict__)

    grid = pd.DataFrame(rows)
    if len(grid) == 0:
        raise RuntimeError("No rows produced for selected window/grid.")
    grid = grid.sort_values(
        ["symbol", "managed_total_r", "delta_m_minus_b", "win_pct"],
        ascending=[True, False, False, False],
    ).reset_index(drop=True)
    grid.to_csv(grid_csv, index=False)
    print(f"Wrote {grid_csv} ({len(grid)} rows)")

    combo_cols = ["rsi_period", "rsi_l", "rsi_h", "sl_n", "tp_r", "mfe1", "lock1", "mfe2", "lock2"]
    grouped = (
        grid.groupby(combo_cols, as_index=False)
        .agg(
            total_trades=("n_trades", "sum"),
            managed_total_r=("managed_total_r", "sum"),
            baseline_total_r=("baseline_total_r", "sum"),
            delta_m_minus_b=("delta_m_minus_b", "sum"),
            weighted_win_pct=("win_pct", lambda s: np.nan),
            max_asset_dd_r=("max_dd_r", "max"),
        )
        .reset_index(drop=True)
    )

    # weighted win pct by n_trades
    win_rows = []
    for _, row in grouped.iterrows():
        mask = np.ones(len(grid), dtype=bool)
        for c in combo_cols:
            mask &= np.isclose(grid[c].values, row[c]) if isinstance(row[c], float) else (grid[c].values == row[c])
        sub = grid.loc[mask]
        w = float(np.average(sub["win_pct"].values, weights=sub["n_trades"].values))
        win_rows.append(w)
    grouped["weighted_win_pct"] = win_rows
    grouped = grouped.sort_values(["managed_total_r", "delta_m_minus_b"], ascending=[False, False]).reset_index(drop=True)
    grouped.to_csv(summary_csv, index=False)
    print(f"Wrote {summary_csv} ({len(grouped)} rows)")

    top = grouped.head(max(1, args.top_k)).copy()
    best = grouped.iloc[0].to_dict()
    lines = [
        "# V1FIX Compact Autotune",
        "",
        "## Grid",
        "",
        f"- Symbols: `{','.join(symbols)}`",
        f"- Horizon: `{start_ts.isoformat()} -> {end_ts.isoformat()}`",
        f"- RSI period grid: `{args.rsi_period_grid}`",
        f"- RSI combos: `{args.rsi_combos}`",
        f"- Stage1 combos (mfe1:lock1): `{args.stage1_combos}`",
        f"- Stage2 combos (mfe2:lock2): `{args.stage2_combos.strip() or f'{args.mfe2}:{args.lock2}'}`",
        f"- TP grid: `{args.tp_grid}`",
        f"- SL grid (MAE proxy / lookback N): `{args.sl_grid}`",
        f"- Force managed==baseline: `{args.force_managed_equal_baseline}`",
        f"- entry_tp_r: `{args.entry_tp_r}` | fee_bps: `{args.fee_bps}`",
        f"- Out prefix: `{args.out_prefix or '(default)'}`",
        "",
        "## Top Ranked (by managed_total_r)",
        "",
        df_to_md_table(top),
        "",
        "## Best Combo",
        "",
        f"- RSI period: `{int(best['rsi_period'])}`",
        f"- RSI: `{int(best['rsi_l'])}/{int(best['rsi_h'])}`",
        f"- SL_N: `{int(best['sl_n'])}`",
        f"- TP: `{best['tp_r']}`",
        f"- Stage1: `{best['mfe1']} -> {best['lock1']}`",
        f"- Stage2: `{best['mfe2']} -> {best['lock2']}`",
        f"- Managed total R: `{best['managed_total_r']:+.4f}`",
        f"- Baseline total R: `{best['baseline_total_r']:+.4f}`",
        f"- Delta (managed - baseline): `{best['delta_m_minus_b']:+.4f}`",
        f"- Total trades: `{int(best['total_trades'])}`",
        f"- Weighted win %: `{best['weighted_win_pct']:.2f}`",
        "",
        "## Artifacts",
        "",
        f"- Grid: `{grid_csv}`",
        f"- Summary: `{summary_csv}`",
        "",
    ]
    with open(report_md, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Wrote {report_md}")
    if run_dir is not None:
        if trades_dir is not None:
            (trades_dir / "README.md").write_text(
                "Autotune compact run: trade-level exports are not generated by this script.\n",
                encoding="utf-8",
            )
        write_manifest(run_dir)
        print(f"Run package ready: {run_dir}")


if __name__ == "__main__":
    main()
