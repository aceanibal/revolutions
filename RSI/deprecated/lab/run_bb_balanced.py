#!/usr/bin/env python3
"""
CLI entry point for the BB Balanced strategy.

Usage:
    python lab/run_bb_balanced.py
    python lab/run_bb_balanced.py --symbols XRPUSDT --start 2022-01-01
    python lab/run_bb_balanced.py --bb-period 20 --bb-std 2.0 --atr-mult 1.5
    python lab/run_bb_balanced.py --tp-sweep 1.0 1.5 2.0 --no-skip-high-vol
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

LAB_ROOT = Path(__file__).resolve().parent
REPO_ROOT = LAB_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

DEFAULT_DB    = str(REPO_ROOT / "data" / "backtest.sqlite")
DEFAULT_RUNS  = str(REPO_ROOT / "runs")


def main() -> None:
    ap = argparse.ArgumentParser(description="Run BB Balanced strategy")
    ap.add_argument("--db",       default=DEFAULT_DB)
    ap.add_argument("--runs-dir", default=DEFAULT_RUNS)
    ap.add_argument("--symbols",  nargs="+", default=["XRPUSDT"])
    ap.add_argument("--start",    default="2022-01-01")
    ap.add_argument("--end",      default=None)
    ap.add_argument("--fee-bps",  type=float, default=3.0)
    ap.add_argument("--bb-period",  type=int,   default=20)
    ap.add_argument("--bb-std",     type=float, default=2.0)
    ap.add_argument("--atr-mult",   type=float, default=1.5)
    ap.add_argument("--atr-period", type=int,   default=14)
    ap.add_argument("--er-period",  type=int,   default=20)
    ap.add_argument("--er-threshold", type=float, default=0.35)
    ap.add_argument("--htf",     default="1h",
                    help="Higher timeframe for signal bars (default: 1h)")
    ap.add_argument("--tp-sweep", nargs="+", type=float, default=[1.0, 1.5, 2.0])
    ap.add_argument("--no-skip-high-vol", action="store_true",
                    help="Include HIGH vol BALANCED bars (default: skip them)")
    args = ap.parse_args()

    from lab.base.strategy import StrategyConfig
    from lab.strategies.bb_balanced import BBBalancedStrategy, BBBalancedParams

    cfg = StrategyConfig(
        db_path=args.db,
        symbols=args.symbols,
        start_utc=args.start,
        end_utc=args.end,
        fee_bps=args.fee_bps,
    )
    params = BBBalancedParams(
        bb_period=args.bb_period,
        bb_std=args.bb_std,
        atr_mult=args.atr_mult,
        atr_period=args.atr_period,
        er_period=args.er_period,
        er_threshold=args.er_threshold,
        skip_high_vol=not args.no_skip_high_vol,
        htf=args.htf,
        tp_sweep=args.tp_sweep,
    )

    print("BB Balanced Strategy")
    print(f"  DB:         {args.db}")
    print(f"  Symbols:    {args.symbols}")
    print(f"  Window:     {args.start} → {args.end or 'latest'}")
    print(f"  HTF:        {args.htf}")
    print(f"  BB:         period={args.bb_period}, std={args.bb_std}")
    print(f"  Stop:       ATR({args.atr_period}) × {args.atr_mult}")
    print(f"  Regime:     ER({args.er_period}) threshold={args.er_threshold}, skip_high_vol={not args.no_skip_high_vol}")
    print(f"  TP sweep:   {args.tp_sweep}")
    print(f"  Fee:        {args.fee_bps} bps RT")
    print()

    strategy = BBBalancedStrategy(cfg, params)
    run_dir = strategy.run(Path(args.runs_dir))
    print(f"\nRun folder: {run_dir}")
    print("Launch dashboard: streamlit run lab/app.py")


if __name__ == "__main__":
    main()
