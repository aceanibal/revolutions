#!/usr/bin/env python3
"""
4h RSI entry + structural SL + R-multiple TP, using only the shared backtester SQLite DB.

Reads historical 5m candles for a symbol, resamples to 4h, then runs the same engine as
`multi_asset_4h_rsi_sim.py`. No CSVs or other data sources.

Default DB path (overridable with --db):
  <sandbox>/../backtester/data/backtest.sqlite
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import warnings

warnings.filterwarnings("ignore")

import itertools

# Allow `python path/to/db_4h_rsi_sim.py` from any cwd
_SANDBOX_DIR = os.path.dirname(os.path.abspath(__file__))
if _SANDBOX_DIR not in sys.path:
    sys.path.insert(0, _SANDBOX_DIR)

import pandas as pd
from ta.momentum import RSIIndicator

from multi_asset_4h_rsi_sim import (
    DB_PATH,
    list_sessions_with_symbol,
    load_5m_candles,
    run_simulation,
)


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="4h RSI sim from backtester DB only")
    ap.add_argument("--symbol", default="ETHUSDT", help="e.g. ETHUSDT")
    ap.add_argument(
        "--db",
        default=DB_PATH,
        help="Path to backtest.sqlite (default: ../backtester/data/backtest.sqlite from sandbox)",
    )
    ap.add_argument("--rsi-period", type=int, default=20)
    ap.add_argument("--fee-bps", type=float, default=9.0)
    ap.add_argument("--min-trades", type=int, default=10)
    ap.add_argument(
        "--full-r-grid",
        action="store_true",
        help="Sweep R multiples 1.0..5.0 (default: TP fixed at 5R only)",
    )
    ap.add_argument(
        "--apply-universal-rule",
        action="store_true",
        help="Score only RSI_L=35, RSI_H=60, SL_N=3, R=5.0 (from walkthrough.md)",
    )
    return ap.parse_args()


def load_4h_with_rsi(
    db_path: str, symbol: str, rsi_period: int
) -> tuple[pd.DataFrame, str]:
    sessions = list_sessions_with_symbol(db_path, symbol)
    if not sessions:
        raise SystemExit(
            f"No historical 5m session found for {symbol} in DB.\n"
            f"Import that symbol into {db_path} first."
        )
    session_id, cnt = sessions[0]
    df_5m = load_5m_candles(db_path, session_id, symbol)
    if len(df_5m) == 0:
        raise SystemExit(f"Session {session_id} has no rows for {symbol}.")

    df_4h = df_5m.resample("4h").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    ).dropna()
    df_4h["RSI"] = RSIIndicator(close=df_4h["close"], window=rsi_period).rsi()
    df_4h = df_4h.dropna(subset=["RSI"]).copy()
    return df_4h, session_id


def main() -> None:
    args = parse_args()
    db_path = os.path.abspath(args.db)
    if not os.path.isfile(db_path):
        raise SystemExit(f"DB not found: {db_path}")

    df_4h, session_id = load_4h_with_rsi(db_path, args.symbol, args.rsi_period)
    print(f"DB: {db_path}")
    print(f"Symbol: {args.symbol} | session_id: {session_id} | 4h bars: {len(df_4h)}")

    o = df_4h["open"].values
    h = df_4h["high"].values
    low = df_4h["low"].values
    rsi = df_4h["RSI"].values

    rsi_lows = [25, 30, 35, 40]
    rsi_highs = [60, 65, 70, 75]
    sl_ns = [0, 1, 2, 3, 5]
    r_multis = [1.0, 1.5, 2.0, 3.0, 4.0, 5.0] if args.full_r_grid else [5.0]

    if args.apply_universal_rule:
        grid = [(35, 60, 3, 5.0)]
        print("Mode: single rule 35/60 | SL_N=3 | TP=5R")
    else:
        grid = list(itertools.product(rsi_lows, rsi_highs, sl_ns, r_multis))
        print(
            f"Grid: {len(grid)} combos | fee {args.fee_bps} bps | min trades {args.min_trades}"
        )

    results = []
    t0 = time.time()
    for rl, rh, sln, rm in grid:
        pnl, wr, maxdd, n_trades, avg_b, _min_b, _max_b = run_simulation(
            o, h, low, rsi, rl, rh, sln, rm, args.fee_bps
        )
        if n_trades >= args.min_trades:
            results.append(
                {
                    "RSI_L": rl,
                    "RSI_H": rh,
                    "SL_N": sln,
                    "R_Mult": rm,
                    "Total_PnL_R": pnl,
                    "Win%": wr,
                    "Max_DD_R": maxdd,
                    "Trades": n_trades,
                    "AvgHoldHours": avg_b * 4.0,
                }
            )
    t1 = time.time()

    if not results:
        print("No parameter set met min-trades threshold.")
        return

    results.sort(key=lambda x: x["Total_PnL_R"], reverse=True)
    print(f"Done in {t1 - t0:.2f}s. Showing top {min(40, len(results))}:\n")
    hdr = (
        f"{'RSI_L':<6} {'RSI_H':<6} {'SL_N':<5} {'R':<6} | "
        f"{'PnL_R':<10} {'Win%':<8} {'MaxDD':<8} {'Trades':<8} {'AvgHrs':<8}"
    )
    print(hdr)
    print("-" * len(hdr))
    for r in results[:40]:
        print(
            f"{r['RSI_L']:<6} {r['RSI_H']:<6} {r['SL_N']:<5} {r['R_Mult']:<6.1f} | "
            f"{r['Total_PnL_R']:<10.2f} {r['Win%']:<7.1f}% {r['Max_DD_R']:<8.2f} "
            f"{r['Trades']:<8} {r['AvgHoldHours']:<8.1f}"
        )


if __name__ == "__main__":
    main()
