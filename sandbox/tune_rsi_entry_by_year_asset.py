#!/usr/bin/env python3
"""
Tune RSI entry thresholds over years and assets using the current managed-exit strategy.

Strategy under test:
- Entry engine: 4h RSI cross entries (same run_simulation_trades logic).
- Exit model: 5m MFE ladder replay (same as massive chunk runner).

Outputs:
- sandbox/cache/rsi_year_asset_grid_managed.csv
- sandbox/cache/rsi_year_asset_best.csv
- sandbox/cache/rsi_year_global_pattern.csv
- sandbox/FINAL_RSI_ENTRY_ADAPTIVE_PATTERN.md
"""
from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass

import numpy as np
import pandas as pd

_SANDBOX = os.path.dirname(os.path.abspath(__file__))
if _SANDBOX not in sys.path:
    sys.path.insert(0, _SANDBOX)

from ltf_trade_management_study import replay_trade_mfe_ladder_5m, tp_price_from_r  # noqa: E402
from massive_chunk_backtest_5m import build_4h_rsi, load_merged_5m  # noqa: E402
from multi_asset_4h_rsi_sim import DB_PATH, run_simulation_trades  # noqa: E402

DEFAULT_SYMBOLS = ["BTCUSDT", "LINKUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"]
CACHE_DIR = os.path.join(_SANDBOX, "cache")
GRID_CSV = os.path.join(CACHE_DIR, "rsi_year_asset_grid_managed.csv")
BEST_CSV = os.path.join(CACHE_DIR, "rsi_year_asset_best.csv")
PATTERN_CSV = os.path.join(CACHE_DIR, "rsi_year_global_pattern.csv")
REPORT_MD = os.path.join(_SANDBOX, "FINAL_RSI_ENTRY_ADAPTIVE_PATTERN.md")


@dataclass
class ComboResult:
    symbol: str
    year: int
    rsi_l: int
    rsi_h: int
    n_trades: int
    managed_total_r: float
    win_pct: float
    max_dd_r: float
    avg_hold_h: float


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
    out = ["| " + " | ".join(cols) + " |", "| " + " | ".join("---" for _ in cols) + " |"]
    for _, row in df.iterrows():
        out.append("| " + " | ".join(str(row[c]).replace("|", "\\|") for c in cols) + " |")
    return "\n".join(out)


def parse_int_grid(s: str) -> list[int]:
    vals = []
    for x in s.split(","):
        x = x.strip()
        if x:
            vals.append(int(x))
    if not vals:
        raise ValueError("Empty grid")
    return sorted(set(vals))


def evaluate_symbol_combo(
    *,
    symbol: str,
    df5: pd.DataFrame,
    start_utc: pd.Timestamp,
    end_utc: pd.Timestamp,
    rsi_l: int,
    rsi_h: int,
    sl_n: int,
    entry_tp_r: float,
    fee_bps: float,
    tp_r: float,
    stages: list[tuple[float, float]],
) -> list[ComboResult]:
    df5w = df5.loc[(df5.index >= start_utc) & (df5.index < end_utc)].copy()
    if len(df5w) == 0:
        return []
    df4h = build_4h_rsi(df5w)
    if len(df4h) < sl_n + 5:
        return []

    o = df4h["open"].values
    h = df4h["high"].values
    low = df4h["low"].values
    rsi = df4h["RSI"].values
    idx = df4h.index
    trades = run_simulation_trades(o, h, low, rsi, rsi_l, rsi_h, sl_n, entry_tp_r, fee_bps)

    rows: list[dict] = []
    for t in trades:
        entry_ts = idx[t["entry_idx"]]
        tp_px = tp_price_from_r(t["entry_price"], t["risk"], t["side"], tp_r)
        rr = replay_trade_mfe_ladder_5m(
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
        )
        if rr is None:
            continue
        ex = pd.Timestamp(rr.exit_ts).tz_convert("UTC")
        if ex < start_utc or ex >= end_utc:
            continue
        rows.append(
            {
                "year": ex.year,
                "pnl_r": float(rr.pnl_r),
                "win": float(rr.pnl_r > 0),
                "hold_h": float(rr.bars * 5.0 / 60.0),
            }
        )
    if not rows:
        return []

    d = pd.DataFrame(rows)
    out: list[ComboResult] = []
    for year, g in d.groupby("year", sort=True):
        pnls = g["pnl_r"].values
        out.append(
            ComboResult(
                symbol=symbol,
                year=int(year),
                rsi_l=rsi_l,
                rsi_h=rsi_h,
                n_trades=int(len(g)),
                managed_total_r=float(np.sum(pnls)),
                win_pct=float(np.mean(g["win"].values) * 100.0),
                max_dd_r=max_drawdown_r(pnls),
                avg_hold_h=float(np.mean(g["hold_h"].values)),
            )
        )
    return out


def slope_year_value(df: pd.DataFrame, y_col: str) -> float:
    if len(df) < 2:
        return float("nan")
    x = df["year"].astype(float).values
    y = df[y_col].astype(float).values
    return float(np.polyfit(x, y, 1)[0])


def main() -> None:
    ap = argparse.ArgumentParser(description="Tune RSI entry thresholds by year+asset on managed strategy.")
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--symbols", default=",".join(DEFAULT_SYMBOLS))
    ap.add_argument("--start-utc", default="2022-01-01")
    ap.add_argument("--end-utc", default="")
    ap.add_argument("--rsi-l-grid", default="28,30,32,35,38,40,42")
    ap.add_argument("--rsi-h-grid", default="58,60,62,65,68,70,72")
    ap.add_argument("--min-gap", type=int, default=10, help="Require rsi_h - rsi_l >= min-gap")
    ap.add_argument("--min-trades", type=int, default=20)
    ap.add_argument("--entry-tp-r", type=float, default=5.0)
    ap.add_argument("--tp-r", type=float, default=8.0)
    ap.add_argument("--fee-bps", type=float, default=3.0)
    ap.add_argument("--sl-n", type=int, default=3)
    ap.add_argument("--mfe1", type=float, default=1.0)
    ap.add_argument("--lock1", type=float, default=0.8)
    ap.add_argument("--mfe2", type=float, default=6.5)
    ap.add_argument("--lock2", type=float, default=5.5)
    ap.add_argument("--top-k", type=int, default=3)
    args = ap.parse_args()

    os.makedirs(CACHE_DIR, exist_ok=True)
    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    start_utc = pd.Timestamp(args.start_utc, tz="UTC")

    db_path = os.path.abspath(args.db)
    all_data: dict[str, pd.DataFrame] = {}
    max_ts = None
    for sym in symbols:
        df5 = load_merged_5m(db_path, sym)
        all_data[sym] = df5
        if len(df5):
            mx = df5.index.max()
            max_ts = mx if max_ts is None else max(max_ts, mx)
    if max_ts is None:
        raise RuntimeError("No 5m data for selected symbols")
    end_utc = pd.Timestamp(args.end_utc, tz="UTC") if args.end_utc else (max_ts + pd.Timedelta(minutes=5))

    l_grid = parse_int_grid(args.rsi_l_grid)
    h_grid = parse_int_grid(args.rsi_h_grid)
    combos = [(l, h) for l in l_grid for h in h_grid if h - l >= args.min_gap]
    stages = [(args.mfe1, args.lock1), (args.mfe2, args.lock2)]

    rows: list[dict] = []
    for sym in symbols:
        df5 = all_data[sym]
        if len(df5) == 0:
            print(f"{sym}: no data, skip")
            continue
        print(f"{sym}: evaluating {len(combos)} RSI combos...")
        for rsi_l, rsi_h in combos:
            res = evaluate_symbol_combo(
                symbol=sym,
                df5=df5,
                start_utc=start_utc,
                end_utc=end_utc,
                rsi_l=rsi_l,
                rsi_h=rsi_h,
                sl_n=args.sl_n,
                entry_tp_r=args.entry_tp_r,
                fee_bps=args.fee_bps,
                tp_r=args.tp_r,
                stages=stages,
            )
            for z in res:
                rows.append(z.__dict__)

    grid_df = pd.DataFrame(rows)
    if len(grid_df) == 0:
        raise RuntimeError("No rows produced from RSI grid")
    grid_df = grid_df.sort_values(["symbol", "year", "managed_total_r"], ascending=[True, True, False])
    grid_df.to_csv(GRID_CSV, index=False)
    print(f"Wrote {GRID_CSV} ({len(grid_df)} rows)")

    eligible = grid_df[grid_df["n_trades"] >= args.min_trades].copy()
    if len(eligible) == 0:
        raise RuntimeError("No eligible rows after min-trades filter")

    # Best combo per symbol-year
    best = (
        eligible.sort_values(
            ["symbol", "year", "managed_total_r", "win_pct", "max_dd_r"],
            ascending=[True, True, False, False, True],
        )
        .groupby(["symbol", "year"], as_index=False)
        .head(1)
        .reset_index(drop=True)
    )
    best.to_csv(BEST_CSV, index=False)
    print(f"Wrote {BEST_CSV} ({len(best)} rows)")

    # Global pattern by year from best-per-asset rows
    by_year = (
        best.groupby("year", as_index=False)
        .agg(
            n_assets=("symbol", "nunique"),
            n_trades=("n_trades", "sum"),
            managed_total_r=("managed_total_r", "sum"),
            median_rsi_l=("rsi_l", "median"),
            median_rsi_h=("rsi_h", "median"),
            weighted_rsi_l=("rsi_l", lambda s: np.average(s, weights=best.loc[s.index, "n_trades"])),
            weighted_rsi_h=("rsi_h", lambda s: np.average(s, weights=best.loc[s.index, "n_trades"])),
        )
        .sort_values("year")
        .reset_index(drop=True)
    )
    by_year.to_csv(PATTERN_CSV, index=False)
    print(f"Wrote {PATTERN_CSV} ({len(by_year)} rows)")

    # Top-k table for context
    top_k = (
        eligible.sort_values(["symbol", "year", "managed_total_r"], ascending=[True, True, False])
        .groupby(["symbol", "year"], as_index=False)
        .head(args.top_k)
        .reset_index(drop=True)
    )

    # Trend summary
    global_low_slope = slope_year_value(by_year, "weighted_rsi_l")
    global_high_slope = slope_year_value(by_year, "weighted_rsi_h")
    gap_slope = slope_year_value(
        by_year.assign(weighted_gap=by_year["weighted_rsi_h"] - by_year["weighted_rsi_l"]),
        "weighted_gap",
    )
    asset_trends = []
    for sym in sorted(best["symbol"].unique()):
        b = best[best["symbol"] == sym].sort_values("year")
        asset_trends.append(
            {
                "symbol": sym,
                "years": int(len(b)),
                "slope_rsi_l_per_year": slope_year_value(b, "rsi_l"),
                "slope_rsi_h_per_year": slope_year_value(b, "rsi_h"),
            }
        )
    asset_trends_df = pd.DataFrame(asset_trends).sort_values("symbol")

    report_lines = [
        "# RSI Entry Adaptation Pattern (Year x Asset)",
        "",
        "## Setup",
        "",
        f"- Symbols: `{','.join(symbols)}`",
        f"- Window: `{start_utc}` to `{end_utc}` (exit-time assignment)",
        f"- Entry engine: 4h RSI cross with `SL_N={args.sl_n}` and engine `entry_tp_r={args.entry_tp_r}`",
        f"- Managed replay: 5m MFE ladder `({args.mfe1}->{args.lock1}), ({args.mfe2}->{args.lock2})`, TP `{args.tp_r}R`, cap lock by MFE",
        f"- RSI grid: L={l_grid}, H={h_grid}, min gap `{args.min_gap}`",
        f"- Eligibility: `n_trades >= {args.min_trades}` per symbol-year-combo",
        "",
        "## Best RSI per Symbol-Year",
        "",
        df_to_md_table(best.sort_values(["year", "symbol"])),
        "",
        "## Global Yearly Pattern (from best-per-asset)",
        "",
        df_to_md_table(by_year),
        "",
        "## Trend Signals",
        "",
        f"- Weighted RSI-L slope vs year: `{global_low_slope:+.3f}` points/year",
        f"- Weighted RSI-H slope vs year: `{global_high_slope:+.3f}` points/year",
        f"- Weighted gap (H-L) slope vs year: `{gap_slope:+.3f}` points/year",
        "",
        "Per-asset slope of chosen best RSI levels:",
        "",
        df_to_md_table(asset_trends_df),
        "",
        f"## Top-{args.top_k} RSI combos per Symbol-Year",
        "",
        df_to_md_table(top_k.sort_values(["year", "symbol", "managed_total_r"], ascending=[True, True, False])),
        "",
        "## Artifacts",
        "",
        f"- `sandbox/cache/{os.path.basename(GRID_CSV)}`",
        f"- `sandbox/cache/{os.path.basename(BEST_CSV)}`",
        f"- `sandbox/cache/{os.path.basename(PATTERN_CSV)}`",
    ]
    with open(REPORT_MD, "w", encoding="utf-8") as f:
        f.write("\n".join(report_lines) + "\n")
    print(f"Wrote {REPORT_MD}")


if __name__ == "__main__":
    main()
