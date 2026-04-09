#!/usr/bin/env python3
"""
Massive 5m chunk backtest: 4h RSI entries + 5m MFE-lock replay, bucketed by calendar chunk.

- Loads and merges all historical 5m sessions per symbol, filters [start_utc, end_utc).
- Builds 4h + RSI from merged 5m (same as other sandbox studies).
- Generates trades with run_simulation_trades; replays each trade on full 5m with:
    * baseline: fixed SL/TP at tp_r on 5m path (no BE)
    * managed: MFE ladder (5m, next-bar stop activation, cap_lock_by_mfe=True)
- Assigns each closed trade to a time chunk by **managed** exit timestamp.

Outputs under cache/ (v2):
  massive_chunk_v2_mfe3_preflight.csv
  massive_chunk_v2_mfe3_tpXX_results.csv           (per symbol × chunk)
  massive_chunk_v2_mfe3_tpXX_results_by_asset.csv  (per symbol totals)
  optional ledgers: massive_chunk_v2_mfe3_tpXX_ledger_<SYMBOL>.csv
"""
from __future__ import annotations

import argparse
import os
import sys
import warnings

warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from ta.momentum import RSIIndicator

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_SCRIPT_DIR)
_SIM_DIR = os.path.join(_PROJECT_ROOT, "simulation")
if _SIM_DIR not in sys.path:
    sys.path.insert(0, _SIM_DIR)

from ltf_trade_management_study import (  # noqa: E402
    replay_trade_5m,
    replay_trade_mfe_ladder_5m,
    tp_price_from_r,
)
from multi_asset_4h_rsi_sim import (  # noqa: E402
    DB_PATH,
    list_sessions_with_symbol,
    load_5m_candles,
    run_simulation_trades,
)

DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "XRPUSDT", "SOLUSDT", "LINKUSDT"]
CACHE_DIR = os.path.join(_PROJECT_ROOT, "cache")
PREFLIGHT_CSV = os.path.join(CACHE_DIR, "massive_chunk_v2_mfe3_preflight.csv")
REPORT_MD = os.path.join(_PROJECT_ROOT, "FINAL_MASSIVE_CHUNK_BACKTEST_V2_MFE3.md")


def _tp_tag(tp_r: float) -> str:
    s = f"{tp_r}".replace(".", "p")
    return f"tp{s}"


def _paths_for_tp(tp_r: float) -> tuple[str, str, str, str]:
    tag = _tp_tag(tp_r)
    results_csv = os.path.join(CACHE_DIR, f"massive_chunk_v2_mfe3_{tag}_results.csv")
    by_asset_csv = os.path.join(CACHE_DIR, f"massive_chunk_v2_mfe3_{tag}_results_by_asset.csv")
    results_q_csv = os.path.join(CACHE_DIR, f"massive_chunk_v2_mfe3_{tag}_results_quarterly.csv")
    by_asset_q_csv = os.path.join(CACHE_DIR, f"massive_chunk_v2_mfe3_{tag}_results_by_asset_quarterly.csv")
    return results_csv, by_asset_csv, results_q_csv, by_asset_q_csv

# Paths as shown in markdown (repo-relative)
def _md_path(abs_path: str) -> str:
    repo = os.path.abspath(os.path.join(_PROJECT_ROOT, ".."))
    try:
        return os.path.relpath(abs_path, repo)
    except ValueError:
        return abs_path


def load_merged_5m(db_path: str, symbol: str) -> pd.DataFrame:
    """Concatenate all historical 5m sessions for symbol; dedupe by bar open time."""
    sessions = list_sessions_with_symbol(db_path, symbol)
    frames: list[pd.DataFrame] = []
    for session_id, _ in sessions:
        df = load_5m_candles(db_path, session_id, symbol)
        if len(df) > 0:
            frames.append(df)
    if not frames:
        return pd.DataFrame()
    out = pd.concat(frames).sort_index()
    out = out[~out.index.duplicated(keep="first")]
    return out


def build_4h_rsi(df_5m: pd.DataFrame) -> pd.DataFrame:
    df_4h = (
        df_5m.resample("4h")
        .agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
        .dropna()
    )
    df_4h["RSI"] = RSIIndicator(close=df_4h["close"], window=20).rsi()
    return df_4h.dropna(subset=["RSI"]).copy()


def iter_time_chunks(
    start: pd.Timestamp, end: pd.Timestamp, mode: str
) -> list[tuple[str, pd.Timestamp, pd.Timestamp]]:
    """Half-open intervals [chunk_start, chunk_end). Labels: YYYY-MM or YYYYQ#."""
    start = pd.Timestamp(start).tz_convert("UTC")
    end = pd.Timestamp(end).tz_convert("UTC")
    if start >= end:
        return []
    out: list[tuple[str, pd.Timestamp, pd.Timestamp]] = []
    if mode == "monthly":
        cur_p = start.to_period("M")
        end_p = (end - pd.Timedelta(nanoseconds=1)).to_period("M")
        p = cur_p
        while p <= end_p:
            c_start = p.to_timestamp(how="start").tz_localize("UTC")
            c_end = (p + 1).to_timestamp(how="start").tz_localize("UTC")
            lo = max(c_start, start)
            hi = min(c_end, end)
            if lo < hi:
                out.append((str(p), lo, hi))
            p += 1
    elif mode == "quarterly":
        cur_p = start.to_period("Q")
        end_p = (end - pd.Timedelta(nanoseconds=1)).to_period("Q")
        p = cur_p
        while p <= end_p:
            c_start = p.to_timestamp(how="start").tz_localize("UTC")
            c_end = (p + 1).to_timestamp(how="start").tz_localize("UTC")
            lo = max(c_start, start)
            hi = min(c_end, end)
            if lo < hi:
                label = f"{p.year}Q{p.quarter}"
                out.append((label, lo, hi))
            p += 1
    else:
        raise ValueError(f"Unknown chunk mode: {mode}")
    return out


def df_to_md_table(df: pd.DataFrame) -> str:
    """GitHub-flavored markdown table without extra dependencies."""
    if len(df) == 0:
        return "_Empty._"
    cols = list(df.columns)
    lines = ["| " + " | ".join(cols) + " |", "| " + " | ".join("---" for _ in cols) + " |"]
    for _, row in df.iterrows():
        cells = [str(row[c]).replace("|", "\\|") for c in cols]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def parse_float_grid(s: str) -> list[float]:
    vals: list[float] = []
    for x in s.split(","):
        x = x.strip()
        if x:
            vals.append(float(x))
    if not vals:
        raise ValueError("tp-sweep must include at least one number")
    return sorted(set(vals))


def max_drawdown_r(pnls: np.ndarray) -> float:
    if len(pnls) == 0:
        return 0.0
    c = np.cumsum(pnls)
    peak = np.maximum.accumulate(c)
    dd = peak - c
    return float(np.max(dd)) if len(dd) else 0.0


def run_preflight(
    db_path: str,
    symbols: list[str],
    start_utc: pd.Timestamp,
    end_utc: pd.Timestamp | None,
) -> pd.DataFrame:
    rows = []
    for sym in symbols:
        df5 = load_merged_5m(db_path, sym)
        if len(df5) == 0:
            rows.append(
                {
                    "symbol": sym,
                    "first_ts_utc": "",
                    "last_ts_utc": "",
                    "n_candles": 0,
                    "n_in_window": 0,
                    "ok": False,
                    "notes": "no 5m data",
                }
            )
            continue
        e = end_utc if end_utc is not None else df5.index.max() + pd.Timedelta(minutes=5)
        win = df5.loc[(df5.index >= start_utc) & (df5.index < e)]
        first = df5.index.min()
        last = df5.index.max()
        ok = len(win) > 0 and first <= start_utc
        notes = ""
        if len(win) == 0:
            notes = "empty window"
            ok = False
        elif first > start_utc:
            notes = f"data starts {first} (after {start_utc})"
            ok = False
        rows.append(
            {
                "symbol": sym,
                "first_ts_utc": str(first),
                "last_ts_utc": str(last),
                "n_candles": int(len(df5)),
                "n_in_window": int(len(win)),
                "ok": ok,
                "notes": notes,
            }
        )
    return pd.DataFrame(rows)


def process_symbol(
    *,
    db_path: str,
    symbol: str,
    start_utc: pd.Timestamp,
    end_utc: pd.Timestamp,
    chunk_mode: str,
    rsi_l: int,
    rsi_h: int,
    sl_n: int,
    entry_tp_r: float,
    fee_bps: float,
    tp_r: float,
    stages: list[tuple[float, float]],
    write_ledger: bool,
) -> tuple[pd.DataFrame, pd.DataFrame, list[dict]]:
    """
    Returns (chunk_summary_df, single_row_asset_df, ledger_rows).
    """
    df5 = load_merged_5m(db_path, symbol)
    if len(df5) == 0:
        return pd.DataFrame(), pd.DataFrame(), []

    df5 = df5.loc[(df5.index >= start_utc) & (df5.index < end_utc)].copy()
    if len(df5) == 0:
        return pd.DataFrame(), pd.DataFrame(), []

    df4h = build_4h_rsi(df5)
    if len(df4h) < sl_n + 5:
        return pd.DataFrame(), pd.DataFrame(), []

    o = df4h["open"].values
    h = df4h["high"].values
    low = df4h["low"].values
    rsi = df4h["RSI"].values
    idx = df4h.index

    trades = run_simulation_trades(o, h, low, rsi, rsi_l, rsi_h, sl_n, entry_tp_r, fee_bps)

    trade_rows: list[dict] = []
    for t in trades:
        entry_ts = idx[t["entry_idx"]]
        tp_px = tp_price_from_r(t["entry_price"], t["risk"], t["side"], tp_r)
        base = replay_trade_5m(
            df5,
            entry_ts,
            t["side"],
            t["entry_price"],
            t["stop_loss"],
            tp_px,
            t["risk"],
            fee_bps,
            be_trigger_r=None,
            be_offset_r=0.0,
        )
        mfe = replay_trade_mfe_ladder_5m(
            df5,
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
        if mfe is None or base is None:
            continue
        ex = pd.Timestamp(mfe.exit_ts).tz_convert("UTC")
        if ex < start_utc or ex >= end_utc:
            continue
        trade_rows.append(
            {
                "exit_ts": ex,
                "baseline_r": base.pnl_r,
                "managed_r": mfe.pnl_r,
                "reason": mfe.reason,
                "hold_5m_bars": mfe.bars,
            }
        )

    if not trade_rows:
        empty = pd.DataFrame()
        return empty, empty, []

    tr_df = pd.DataFrame(trade_rows).sort_values("exit_ts")
    chunks_meta = iter_time_chunks(start_utc, end_utc, chunk_mode)

    chunk_summaries: list[dict] = []
    ledger: list[dict] = []

    for label, c_lo, c_hi in chunks_meta:
        sub = tr_df[(tr_df["exit_ts"] >= c_lo) & (tr_df["exit_ts"] < c_hi)]
        if len(sub) == 0:
            continue
        br = sub["baseline_r"].values
        mr = sub["managed_r"].values
        wins = float(np.mean(mr > 0) * 100)
        avg_hold_h = float(sub["hold_5m_bars"].mean() * 5.0 / 60.0)
        chunk_summaries.append(
            {
                "symbol": symbol,
                "chunk": label,
                "chunk_start_utc": c_lo.isoformat(),
                "chunk_end_utc": c_hi.isoformat(),
                "n_trades": len(sub),
                "baseline_total_r": float(np.sum(br)),
                "managed_total_r": float(np.sum(mr)),
                "baseline_delta_r": float(np.sum(mr) - np.sum(br)),
                "win_pct": wins,
                "max_dd_r": max_drawdown_r(mr),
                "avg_hold_h": avg_hold_h,
            }
        )
        if write_ledger:
            for _, row in sub.iterrows():
                ledger.append(
                    {
                        "symbol": symbol,
                        "chunk": label,
                        "exit_ts": row["exit_ts"].isoformat(),
                        "baseline_r": row["baseline_r"],
                        "managed_r": row["managed_r"],
                        "reason": row["reason"],
                        "hold_5m_bars": int(row["hold_5m_bars"]),
                    }
                )

    if not chunk_summaries:
        return pd.DataFrame(), pd.DataFrame(), ledger

    ch_df = pd.DataFrame(chunk_summaries)
    total_b = float(tr_df["baseline_r"].sum())
    total_m = float(tr_df["managed_r"].sum())
    asset_row = pd.DataFrame(
        [
            {
                "symbol": symbol,
                "n_trades": len(tr_df),
                "n_chunks_with_trades": len(ch_df),
                "baseline_total_r": total_b,
                "managed_total_r": total_m,
                "baseline_delta_r": total_m - total_b,
                "win_pct": float(np.mean(tr_df["managed_r"].values > 0) * 100),
                "max_dd_r": max_drawdown_r(tr_df["managed_r"].values),
                "avg_hold_h": float(tr_df["hold_5m_bars"].mean() * 5.0 / 60.0),
            }
        ]
    )
    return ch_df, asset_row, ledger


def run_all_symbols(
    *,
    db_path: str,
    symbols: list[str],
    start_utc: pd.Timestamp,
    global_end: pd.Timestamp,
    preflight: pd.DataFrame,
    chunk_mode: str,
    rsi_l: int,
    rsi_h: int,
    sl_n: int,
    entry_tp_r: float,
    fee_bps: float,
    tp_r: float,
    stages: list[tuple[float, float]],
    write_ledger: bool,
) -> tuple[pd.DataFrame, pd.DataFrame, list[dict]]:
    all_chunks: list[pd.DataFrame] = []
    all_assets: list[pd.DataFrame] = []
    all_ledgers: list[dict] = []

    for sym in symbols:
        row = preflight[preflight["symbol"] == sym]
        if len(row) and not bool(row.iloc[0]["ok"]):
            print(f"Skip {sym} (preflight not ok)")
            continue
        ch_df, asset_df, led = process_symbol(
            db_path=db_path,
            symbol=sym,
            start_utc=start_utc,
            end_utc=global_end,
            chunk_mode=chunk_mode,
            rsi_l=rsi_l,
            rsi_h=rsi_h,
            sl_n=sl_n,
            entry_tp_r=entry_tp_r,
            fee_bps=fee_bps,
            tp_r=tp_r,
            stages=stages,
            write_ledger=write_ledger,
        )
        if len(ch_df) > 0:
            all_chunks.append(ch_df)
        if len(asset_df) > 0:
            all_assets.append(asset_df)
        all_ledgers.extend(led)
        ntr = int(asset_df["n_trades"].iloc[0]) if len(asset_df) else 0
        print(f"{sym}: chunks={len(ch_df)} trades={ntr}")

    results = pd.concat(all_chunks, ignore_index=True) if all_chunks else pd.DataFrame()
    by_asset = pd.concat(all_assets, ignore_index=True) if all_assets else pd.DataFrame()
    return results, by_asset, all_ledgers


def pooled_monthly_managed(results: pd.DataFrame) -> pd.DataFrame:
    """Sum managed R across symbols per calendar chunk label (monthly labels only)."""
    if len(results) == 0 or "chunk" not in results.columns:
        return pd.DataFrame()
    g = results.groupby("chunk", sort=False).agg(
        n_symbols=("symbol", "nunique"),
        n_trades=("n_trades", "sum"),
        managed_total_r=("managed_total_r", "sum"),
        baseline_total_r=("baseline_total_r", "sum"),
    )
    return g.reset_index()


def write_report(
    preflight: pd.DataFrame,
    results: pd.DataFrame,
    by_asset: pd.DataFrame,
    *,
    start_utc: str,
    end_utc: str,
    chunk_mode: str,
    tp_r: float,
    strategy_lines: list[str],
    quarterly_by_asset: pd.DataFrame | None = None,
    results_csv: str = "",
    by_asset_csv: str = "",
    results_quarterly_csv: str = "",
    by_asset_quarterly_csv: str = "",
    report_path: str = "",
) -> None:
    lines = [
        "# Massive 5m Chunk Backtest V2 (MFE3/LOCK3)",
        "",
        "## Configuration",
        "",
        f"- **Start (UTC):** `{start_utc}`",
        f"- **End (UTC):** `{end_utc}`",
        f"- **Chunking:** `{chunk_mode}`",
        f"- **Replay TP (R):** `{tp_r}`",
        "",
        "### Strategy / execution",
        "",
    ]
    lines.extend(f"- {s}" for s in strategy_lines)
    lines.extend(["", "## 5m data coverage (preflight)", ""])
    if len(preflight) == 0:
        lines.append("_No preflight data._")
    else:
        lines.append(df_to_md_table(preflight))
    lines.extend(["", "## Per-symbol totals (full window)", ""])
    if len(by_asset) == 0:
        lines.append("_No results._")
    else:
        lines.append(df_to_md_table(by_asset))
    lines.extend(["", "## Chunk-level detail (all symbols)", ""])
    if len(results) == 0:
        lines.append("_No chunk rows._")
    else:
        lines.append(df_to_md_table(results))
    # Pooled
    lines.extend(["", "## Pooled summary", ""])
    if len(by_asset) == 0:
        lines.append("_N/A_")
    else:
        nt = int(by_asset["n_trades"].sum())
        bt = float(by_asset["baseline_total_r"].sum())
        mt = float(by_asset["managed_total_r"].sum())
        lines.append(f"- **Total trades:** {nt}")
        lines.append(f"- **Baseline R (sum):** {bt:+.2f}")
        lines.append(f"- **Managed MFE-lock R (sum):** {mt:+.2f}")
        lines.append(f"- **Delta (managed − baseline):** {mt - bt:+.2f}")
        lines.append(
            "- **Risk note:** `max_dd_r` is cumulative drawdown on *sequential* managed-R within each "
            "row’s scope (per chunk or full window per asset), not a portfolio DD across assets."
        )

    # Pooled calendar-month totals (cross-asset sum) for stability view
    if chunk_mode == "monthly" and len(results) > 0:
        pm = pooled_monthly_managed(results)
        if len(pm) > 0:
            pm = pm.sort_values("managed_total_r")
            worst = pm.head(5)
            best = pm.tail(5).iloc[::-1]
            lines.extend(
                [
                    "",
                    "## Chunk stability (pooled managed R by calendar month)",
                    "",
                    "Cross-asset sum of `managed_total_r` per month (same trades as detail table; "
                    "different from single-asset drawdown).",
                    "",
                    "### Weakest 5 months (pooled)",
                    "",
                    df_to_md_table(worst),
                    "",
                    "### Strongest 5 months (pooled)",
                    "",
                    df_to_md_table(best),
                    "",
                ]
            )

    if quarterly_by_asset is not None and len(quarterly_by_asset) > 0:
        lines.extend(
            [
                "## Quarterly chunking (sanity vs monthly)",
                "",
                "Same strategy and window; trades bucketed by **managed exit** into calendar quarters. "
                "Per-symbol totals must match monthly aggregation (same closed trades).",
                "",
                df_to_md_table(quarterly_by_asset),
                "",
            ]
        )
        qn = int(quarterly_by_asset["n_trades"].sum())
        qm = float(quarterly_by_asset["managed_total_r"].sum())
        if len(by_asset) > 0:
            mn = int(by_asset["n_trades"].sum())
            mm = float(by_asset["managed_total_r"].sum())
            lines.append(
                f"- **Reconciliation:** monthly pooled trades={mn}, quarterly pooled trades={qn}, "
                f"Δ={mn - qn}; managed R monthly={mm:+.4f} vs quarterly={qm:+.4f}, "
                f"Δ={mm - qm:+.6f}"
            )
            lines.append("")

    lines.extend(
        [
            "## Artifacts",
            "",
            f"- Preflight: `{_md_path(PREFLIGHT_CSV)}`",
            f"- Chunk results (primary run): `{_md_path(results_csv)}`",
            f"- By asset (primary run): `{_md_path(by_asset_csv)}`",
        ]
    )
    if quarterly_by_asset is not None and len(quarterly_by_asset) > 0:
        lines.append(f"- Quarterly detail: `{_md_path(results_quarterly_csv)}`")
        lines.append(f"- Quarterly by asset: `{_md_path(by_asset_quarterly_csv)}`")
    lines.append("")
    out_path = report_path or REPORT_MD
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser(description="Massive 5m chunk backtest (MFE lock + baseline).")
    ap.add_argument("--db", default=DB_PATH, help="Path to backtest.sqlite")
    ap.add_argument(
        "--symbols",
        type=str,
        default=",".join(DEFAULT_SYMBOLS),
        help="Comma-separated symbols (default plan set).",
    )
    ap.add_argument("--start-utc", type=str, default="2022-01-01", help="Inclusive window start (UTC date).")
    ap.add_argument(
        "--end-utc",
        type=str,
        default="",
        help="Exclusive window end. Default: latest 5m per symbol (each symbol uses its own max).",
    )
    ap.add_argument("--chunk", choices=("monthly", "quarterly"), default="monthly")
    ap.add_argument("--rsi-l", type=int, default=35)
    ap.add_argument("--rsi-h", type=int, default=60)
    ap.add_argument("--sl-n", type=int, default=3)
    ap.add_argument("--entry-tp-r", type=float, default=5.0, help="TP (R) for trade generation only.")
    ap.add_argument("--fee-bps", type=float, default=3.0)
    ap.add_argument("--tp-r", type=float, default=13.0, help="Replay TP anchor in R.")
    ap.add_argument("--tp-sweep", type=str, default="12,13,14", help="Comma-separated TP values in R.")
    ap.add_argument("--mfe1", type=float, default=1.0)
    ap.add_argument("--lock1", type=float, default=0.8)
    ap.add_argument("--mfe2", type=float, default=6.5)
    ap.add_argument("--lock2", type=float, default=5.5)
    ap.add_argument("--mfe3", type=float, default=10.0)
    ap.add_argument("--lock3", type=float, default=9.0)
    ap.add_argument("--write-ledgers", action="store_true", help="Write per-symbol ledger CSVs.")
    ap.add_argument("--preflight-only", action="store_true")
    ap.add_argument("--report-only", action="store_true", help="Rebuild markdown from existing CSVs.")
    ap.add_argument("--no-report", action="store_true", help="Skip writing FINAL_MASSIVE_CHUNK_BACKTEST.md")
    ap.add_argument(
        "--also-quarterly",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="After a monthly primary run, also bucket into calendar quarters, write quarterly CSVs, "
        "and add reconciliation to the report (default: true). Use --no-also-quarterly to skip.",
    )
    args = ap.parse_args()

    db_path = os.path.abspath(args.db)
    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    start_utc = pd.Timestamp(args.start_utc, tz="UTC")

    os.makedirs(CACHE_DIR, exist_ok=True)

    if args.report_only:
        pre = pd.read_csv(PREFLIGHT_CSV) if os.path.isfile(PREFLIGHT_CSV) else pd.DataFrame()
        results_csv, by_asset_csv, _, by_asset_q_csv = _paths_for_tp(args.tp_r)
        res = pd.read_csv(results_csv) if os.path.isfile(results_csv) else pd.DataFrame()
        ba = pd.read_csv(by_asset_csv) if os.path.isfile(by_asset_csv) else pd.DataFrame()
        qba = pd.read_csv(by_asset_q_csv) if os.path.isfile(by_asset_q_csv) else None
        meta_start = args.start_utc
        meta_end = args.end_utc or "(from CSV run)"
        write_report(
            pre,
            res,
            ba,
            start_utc=meta_start,
            end_utc=str(meta_end),
            chunk_mode=args.chunk,
            tp_r=args.tp_r,
            strategy_lines=[
                "4h RSI cross entries; structural SL; 5m replay with 3-stage MFE ladder",
                f"Engine fee {args.fee_bps} bps RT; entry list TP={args.entry_tp_r}R",
                f"Replay TP sweep around 13R={args.tp_sweep}; anchor={args.tp_r}R",
                f"MFE ladder mfe1/lock1={args.mfe1}/{args.lock1}, mfe2/lock2={args.mfe2}/{args.lock2}, "
                f"mfe3/lock3={args.mfe3}/{args.lock3} (cap_lock_by_mfe=True)",
            ],
            quarterly_by_asset=qba,
            results_csv=results_csv,
            by_asset_csv=by_asset_csv,
            report_path=REPORT_MD,
        )
        print(f"Wrote {REPORT_MD}")
        return

    # Per-symbol end: need pre-scan for default end_utc
    if args.end_utc:
        global_end = pd.Timestamp(args.end_utc, tz="UTC")
    else:
        max_ts = None
        for sym in symbols:
            df5 = load_merged_5m(db_path, sym)
            if len(df5) == 0:
                continue
            mx = df5.index.max()
            max_ts = mx if max_ts is None else max(max_ts, mx)
        if max_ts is None:
            print("No 5m data for any symbol.")
            sys.exit(1)
        global_end = max_ts + pd.Timedelta(minutes=5)

    preflight = run_preflight(db_path, symbols, start_utc, global_end)
    preflight.to_csv(PREFLIGHT_CSV, index=False)
    print(f"Wrote {PREFLIGHT_CSV}")

    if args.preflight_only:
        print(preflight.to_string(index=False))
        return

    bad = preflight[~preflight["ok"]]
    if len(bad) > 0:
        print("Preflight warnings (ok=False):")
        print(bad.to_string(index=False))

    stages = [(args.mfe1, args.lock1), (args.mfe2, args.lock2)]
    if args.mfe3 is not None and args.lock3 is not None:
        stages.append((args.mfe3, args.lock3))
    stages = sorted(stages, key=lambda x: x[0])

    tp_levels = parse_float_grid(args.tp_sweep) if args.tp_sweep.strip() else [float(args.tp_r)]
    summary_rows: list[dict] = []
    for tp_r in tp_levels:
        print(f"=== Running TP={tp_r}R (v2_mfe3) ===")
        results_csv, by_asset_csv, results_q_csv, by_asset_q_csv = _paths_for_tp(tp_r)
        results, by_asset, all_ledgers = run_all_symbols(
            db_path=db_path,
            symbols=symbols,
            start_utc=start_utc,
            global_end=global_end,
            preflight=preflight,
            chunk_mode=args.chunk,
            rsi_l=args.rsi_l,
            rsi_h=args.rsi_h,
            sl_n=args.sl_n,
            entry_tp_r=args.entry_tp_r,
            fee_bps=args.fee_bps,
            tp_r=tp_r,
            stages=stages,
            write_ledger=args.write_ledgers,
        )
        results.to_csv(results_csv, index=False)
        by_asset.to_csv(by_asset_csv, index=False)
        print(f"Wrote {results_csv} ({len(results)} rows)")
        print(f"Wrote {by_asset_csv} ({len(by_asset)} rows)")

        quarterly_by_asset: pd.DataFrame | None = None
        if args.also_quarterly and args.chunk == "monthly":
            print("Running quarterly bucket pass (--also-quarterly)...")
            q_res, q_ba, _ = run_all_symbols(
                db_path=db_path,
                symbols=symbols,
                start_utc=start_utc,
                global_end=global_end,
                preflight=preflight,
                chunk_mode="quarterly",
                rsi_l=args.rsi_l,
                rsi_h=args.rsi_h,
                sl_n=args.sl_n,
                entry_tp_r=args.entry_tp_r,
                fee_bps=args.fee_bps,
                tp_r=tp_r,
                stages=stages,
                write_ledger=False,
            )
            q_res.to_csv(results_q_csv, index=False)
            q_ba.to_csv(by_asset_q_csv, index=False)
            print(f"Wrote {results_q_csv} ({len(q_res)} rows)")
            print(f"Wrote {by_asset_q_csv} ({len(q_ba)} rows)")
            quarterly_by_asset = q_ba

        if args.write_ledgers and all_ledgers:
            tag = _tp_tag(tp_r)
            for sym in symbols:
                sub = [r for r in all_ledgers if r["symbol"] == sym]
                if not sub:
                    continue
                path = os.path.join(CACHE_DIR, f"massive_chunk_v2_mfe3_{tag}_ledger_{sym}.csv")
                pd.DataFrame(sub).to_csv(path, index=False)
                print(f"Wrote {path}")

        if not args.no_report:
            report_tp = os.path.join(_PROJECT_ROOT, f"FINAL_MASSIVE_CHUNK_BACKTEST_V2_MFE3_{_tp_tag(tp_r)}.md")
            write_report(
                preflight,
                results,
                by_asset,
                start_utc=args.start_utc,
                end_utc=str(global_end),
                chunk_mode=args.chunk,
                tp_r=tp_r,
                strategy_lines=[
                    "4h RSI cross entries; structural SL; 5m replay (wick order, stop updates next bar open)",
                    f"RSI {args.rsi_l}/{args.rsi_h}, SL_N={args.sl_n}, engine fee {args.fee_bps} bps RT",
                    f"Trade list from engine at TP={args.entry_tp_r}R; replay TP={tp_r}R",
                    f"MFE ladder: ({args.mfe1}R -> {args.lock1}R), ({args.mfe2}R -> {args.lock2}R), "
                    f"({args.mfe3}R -> {args.lock3}R); cap_lock_by_mfe=True",
                ],
                quarterly_by_asset=quarterly_by_asset,
                results_csv=results_csv,
                by_asset_csv=by_asset_csv,
                results_quarterly_csv=results_q_csv,
                by_asset_quarterly_csv=by_asset_q_csv,
                report_path=report_tp,
            )
            print(f"Wrote {report_tp}")
        summary_rows.append(
            {
                "tp_r": tp_r,
                "n_trades": int(by_asset["n_trades"].sum()) if len(by_asset) else 0,
                "managed_total_r": float(by_asset["managed_total_r"].sum()) if len(by_asset) else 0.0,
                "baseline_total_r": float(by_asset["baseline_total_r"].sum()) if len(by_asset) else 0.0,
            }
        )

    if summary_rows:
        summary_df = pd.DataFrame(summary_rows).sort_values("tp_r")
        summary_path = os.path.join(CACHE_DIR, "massive_chunk_v2_mfe3_tp_sweep_summary.csv")
        summary_df.to_csv(summary_path, index=False)
        print(f"Wrote {summary_path}")


if __name__ == "__main__":
    main()
