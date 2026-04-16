#!/usr/bin/env python3
"""
CLI entry point for the RSI 4h strategy.

Usage:
    python lab/run_rsi4h.py
    python lab/run_rsi4h.py --symbols BTCUSDT ETHUSDT --tp-sweep 12 13 14
    python lab/run_rsi4h.py --rsi-l 35 --rsi-h 60 --sl-n 2 --fee-bps 3.0
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Allow running from repo root: python lab/run_rsi4h.py
LAB_ROOT = Path(__file__).resolve().parent
REPO_ROOT = LAB_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

DEFAULT_DB = str(REPO_ROOT / "data" / "backtest.sqlite")
DEFAULT_RUNS_DIR = str(REPO_ROOT / "runs")


def main() -> None:
    ap = argparse.ArgumentParser(description="Run RSI 4h strategy")
    ap.add_argument("--db", default=DEFAULT_DB, help="Path to backtest.sqlite")
    ap.add_argument("--runs-dir", default=DEFAULT_RUNS_DIR, help="Output runs directory")
    ap.add_argument(
        "--symbols", nargs="+",
        default=["BTCUSDT", "ETHUSDT", "XRPUSDT", "SOLUSDT", "LINKUSDT"],
    )
    ap.add_argument("--start", default="2022-01-01", help="Start date UTC")
    ap.add_argument("--end", default=None, help="End date UTC (default: latest)")
    ap.add_argument("--fee-bps", type=float, default=3.0)
    ap.add_argument("--rsi-l", type=int, default=35)
    ap.add_argument("--rsi-h", type=int, default=60)
    ap.add_argument("--rsi-window", type=int, default=20)
    ap.add_argument("--sl-n", type=int, default=2)
    ap.add_argument("--entry-tp-r", type=float, default=5.0)
    ap.add_argument("--tp-sweep", nargs="+", type=float, default=[12.0])
    ap.add_argument(
        "--stages", nargs="+", type=float, default=[1.0, 0.8, 6.5, 5.5],
        help="MFE ladder as flat list of mfe lock pairs: mfe1 lock1 mfe2 lock2 ..."
    )
    args = ap.parse_args()

    # Parse stages flat list → list of (mfe, lock) tuples
    flat = args.stages
    if len(flat) % 2 != 0:
        ap.error("--stages must have an even number of values (mfe lock pairs)")
    stages = [(flat[i], flat[i + 1]) for i in range(0, len(flat), 2)]

    from lab.base.strategy import StrategyConfig
    from lab.strategies.rsi_4h import RSI4hStrategy, RSI4hParams

    cfg = StrategyConfig(
        db_path=args.db,
        symbols=args.symbols,
        start_utc=args.start,
        end_utc=args.end,
        fee_bps=args.fee_bps,
    )
    params = RSI4hParams(
        rsi_l=args.rsi_l,
        rsi_h=args.rsi_h,
        rsi_window=args.rsi_window,
        sl_n=args.sl_n,
        entry_tp_r=args.entry_tp_r,
        tp_sweep=args.tp_sweep,
        stages=stages,
    )

    print(f"RSI 4h Strategy")
    print(f"  DB:      {args.db}")
    print(f"  Symbols: {args.symbols}")
    print(f"  Window:  {args.start} → {args.end or 'latest'}")
    print(f"  Params:  RSI {args.rsi_l}/{args.rsi_h} | SL_N={args.sl_n} | TP sweep={args.tp_sweep}")
    print(f"  Stages:  {stages}")
    print(f"  Fee:     {args.fee_bps} bps RT")
    print()

    strategy = RSI4hStrategy(cfg, params)
    run_dir = strategy.run(Path(args.runs_dir))
    print(f"\nRun folder: {run_dir}")
    print("Launch dashboard: streamlit run lab/app.py")


if __name__ == "__main__":
    main()
