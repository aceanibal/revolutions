#!/usr/bin/env python3
"""
Compare total R: 4h MFE ladder vs 5m MFE ladder (capped locks) on the same trade list.

5m path uses replay_trade_mfe_ladder_5m — intrabar sequence on 5m candles after the
entry 4h bucket; locks use min(lock_r, mfe_max_r) so stops cannot sit beyond proven excursion.
"""
from __future__ import annotations

import argparse
import os
import sys

_SANDBOX = os.path.dirname(os.path.abspath(__file__))
if _SANDBOX not in sys.path:
    sys.path.insert(0, _SANDBOX)

from ltf_trade_management_study import (  # noqa: E402
    DB_PATH,
    load_4h_and_5m,
    replay_trade_4h_mfe_ladder,
    replay_trade_mfe_ladder_5m,
    tp_price_from_r,
)
from multi_asset_4h_rsi_sim import run_simulation_trades  # noqa: E402


def batch_4h(trades, idx, h, low, fee_bps, tp_r, stages):
    out = []
    for t in trades:
        tp_px = tp_price_from_r(t["entry_price"], t["risk"], t["side"], tp_r)
        rr = replay_trade_4h_mfe_ladder(
            idx,
            h,
            low,
            t["entry_idx"],
            t["side"],
            t["entry_price"],
            t["stop_loss"],
            tp_px,
            t["risk"],
            fee_bps,
            stages=stages,
        )
        if rr:
            out.append(rr.pnl_r)
    return out


def batch_5m(trades, idx, df5, fee_bps, tp_r, stages, cap_lock: bool):
    out = []
    for t in trades:
        tp_px = tp_price_from_r(t["entry_price"], t["risk"], t["side"], tp_r)
        entry_ts = idx[t["entry_idx"]]
        rr = replay_trade_mfe_ladder_5m(
            df5,
            entry_ts,
            t["side"],
            t["entry_price"],
            t["stop_loss"],
            tp_px,
            t["risk"],
            fee_bps,
            stages=stages,
            cap_lock_by_mfe=cap_lock,
        )
        if rr:
            out.append(rr.pnl_r)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="4h vs 5m MFE ladder total R")
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--symbol", default="XRPUSDT")
    ap.add_argument("--fee-bps", type=float, default=3.0)
    ap.add_argument("--tp-r", type=float, default=8.0)
    ap.add_argument("--no-cap", action="store_true", help="5m: use raw lock_r (old semantics on 5m bars)")
    args = ap.parse_args()

    df_4h, df_5m = load_4h_and_5m(os.path.abspath(args.db), args.symbol.upper())
    if df_4h is None:
        print("No data")
        return

    o = df_4h["open"].values
    h = df_4h["high"].values
    low = df_4h["low"].values
    rsi = df_4h["RSI"].values
    idx = df_4h.index

    trades = run_simulation_trades(o, h, low, rsi, 35, 60, 3, 5.0, args.fee_bps)
    stages = [(0.5, 1.0), (1.25, 3.0), (4.0, 6.0)]

    r4 = batch_4h(trades, idx, h, low, args.fee_bps, args.tp_r, stages)
    r5 = batch_5m(trades, idx, df_5m, args.fee_bps, args.tp_r, stages, cap_lock=not args.no_cap)

    s4, s5 = sum(r4), sum(r5)
    print(f"Symbol {args.symbol} | trades with replay: 4h={len(r4)} 5m={len(r5)} (engine trades={len(trades)})")
    print(f"Stages {stages} | TP={args.tp_r}R")
    print(f"  Total R 4h ladder:     {s4:+.2f}")
    cap = "off" if args.no_cap else "min(lock, mfe_max)"
    print(f"  Total R 5m ladder ({cap}): {s5:+.2f}")
    print(f"  Delta (5m - 4h):       {s5 - s4:+.2f}")


if __name__ == "__main__":
    main()
