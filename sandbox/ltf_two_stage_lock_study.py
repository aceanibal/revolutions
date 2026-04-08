#!/usr/bin/env python3
"""
Two-stage lock study (sandbox + shared DB).

Stage 1 (fixed): MFE = mfe1_r → stop at entry ± lock1_r·R (same idea as your chosen 0.5 → +1R).

Stage 2 (optional): additional *cumulative* MFE from entry (mfe2_r) → tighten stop to entry ± lock2_r·R.
  Example: mfe1=0.5, lock1=1.0, mfe2=1.5, lock2=2.0 means after price reaches +1.5R from entry,
  move stop to +2R (if still in trade).

Compares TP targets in {3, 5, 8} R with:
  - TP-only replay (no management)
  - Single-stage (stage 1 only) — same as replay_trade_4h with mfe/lock
  - Two-stage grid

Entries: same trade list as main studies (engine at --entry-tp-r, default 5R).
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np
import pandas as pd
from ta.momentum import RSIIndicator

_SANDBOX = os.path.dirname(os.path.abspath(__file__))
if _SANDBOX not in sys.path:
    sys.path.insert(0, _SANDBOX)

from ltf_trade_management_study import (  # noqa: E402
    DB_PATH,
    load_4h_and_5m,
    replay_scenario,
    replay_trade_4h_two_stage,
    summarize_pnls,
    tp_price_from_r,
)
from multi_asset_4h_rsi_sim import run_simulation_trades  # noqa: E402

DEFAULT_SYMBOLS = ["XRPUSDT", "BTCUSDT", "SOLUSDT", "LINKUSDT", "DOGEUSDT"]


def replay_two_stage_batch(
    trades: list,
    idx,
    high_arr: np.ndarray,
    low_arr: np.ndarray,
    fee_bps: float,
    tp_r: float,
    mfe1_r: float,
    lock1_r: float,
    mfe2_r: float | None,
    lock2_r: float | None,
) -> list[ReplayResult]:
    out: list[ReplayResult] = []
    for t in trades:
        tp_px = tp_price_from_r(t["entry_price"], t["risk"], t["side"], tp_r)
        rr = replay_trade_4h_two_stage(
            idx,
            high_arr,
            low_arr,
            t["entry_idx"],
            t["side"],
            t["entry_price"],
            t["stop_loss"],
            tp_px,
            t["risk"],
            fee_bps,
            mfe1_r=mfe1_r,
            lock1_r=lock1_r,
            mfe2_r=mfe2_r,
            lock2_r=lock2_r,
        )
        if rr:
            out.append(rr)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Two-stage MFE lock vs TP=3/5/8")
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--fee-bps", type=float, default=3.0)
    ap.add_argument("--rsi-l", type=int, default=35)
    ap.add_argument("--rsi-h", type=int, default=60)
    ap.add_argument("--sl-n", type=int, default=3)
    ap.add_argument("--entry-tp-r", type=float, default=5.0)
    ap.add_argument("--symbols", type=str, default=",".join(DEFAULT_SYMBOLS))
    ap.add_argument(
        "--tp-compare",
        type=str,
        default="3,5,8",
        help="TP targets (R) to compare",
    )
    ap.add_argument("--mfe1", type=float, default=0.5, help="First MFE trigger (R from entry)")
    ap.add_argument("--lock1", type=float, default=1.0, help="First lock at entry±lock1·R")
    ap.add_argument(
        "--mfe2-sweep",
        type=str,
        default="1.25,1.5,1.75,2.0,2.5",
        help="Second cumulative MFE (R from entry) to arm second lock",
    )
    ap.add_argument(
        "--lock2-sweep",
        type=str,
        default="1.5,2.0,2.5,3.0",
        help="Second lock at entry±lock2·R after mfe2",
    )
    ap.add_argument(
        "--csv",
        type=str,
        default=os.path.join(_SANDBOX, "cache", "ltf_two_stage_lock_study.csv"),
    )
    args = ap.parse_args()

    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    tp_list = [float(x.strip()) for x in args.tp_compare.split(",") if x.strip()]
    mfe2_levels = [float(x.strip()) for x in args.mfe2_sweep.split(",") if x.strip()]
    lock2_levels = [float(x.strip()) for x in args.lock2_sweep.split(",") if x.strip()]

    rows: list[dict] = []

    print(
        f"Two-stage lock study | fee {args.fee_bps} bps | stage1 MFE={args.mfe1}R → lock={args.lock1}R\n"
        f"TP compare: {tp_list} | stage2: cumulative MFE2 from entry × lock2\n"
        f"Engine trade list @ entry TP={args.entry_tp_r}R\n"
    )

    for sym in symbols:
        df_4h, _ = load_4h_and_5m(os.path.abspath(args.db), sym)
        if df_4h is None or len(df_4h) == 0:
            print(f"{sym}: skip\n")
            continue
        o = df_4h["open"].values
        h = df_4h["high"].values
        low = df_4h["low"].values
        rsi = df_4h["RSI"].values
        idx = df_4h.index
        trades = run_simulation_trades(
            o, h, low, rsi, args.rsi_l, args.rsi_h, args.sl_n, args.entry_tp_r, args.fee_bps
        )
        n = len(trades)
        eng = float(sum(t["pnl_r"] for t in trades))

        print(f"=== {sym} | trades={n} | engine PnL @ {args.entry_tp_r}R TP: {eng:+.2f} R ===")

        for tp_r in tp_list:
            tp_only = replay_scenario(trades, idx, h, low, args.fee_bps, tp_r, None, 0.0)
            s0 = summarize_pnls(tp_only)

            one_stage = replay_scenario(
                trades, idx, h, low, args.fee_bps, tp_r, args.mfe1, args.lock1
            )
            s1 = summarize_pnls(one_stage)

            print(
                f"  TP={tp_r}R | TP-only: {s0['total_r']:+.2f} R (win {s0['win_rate']:.1f}% DD {s0['max_dd_r']:.2f}) | "
                f"stage1 only: {s1['total_r']:+.2f} R (Δ {s1['total_r']-s0['total_r']:+.2f})"
            )

            best_tot = s1["total_r"]
            best_key = "stage1_only"

            for m2 in mfe2_levels:
                for lk2 in lock2_levels:
                    if m2 <= args.mfe1 + 1e-9:
                        continue
                    if lk2 <= args.lock1 + 1e-9:
                        continue
                    ts = replay_two_stage_batch(
                        trades,
                        idx,
                        h,
                        low,
                        args.fee_bps,
                        tp_r,
                        args.mfe1,
                        args.lock1,
                        m2,
                        lk2,
                    )
                    sm = summarize_pnls(ts)
                    rows.append(
                        {
                            "symbol": sym,
                            "tp_r": tp_r,
                            "mfe1_r": args.mfe1,
                            "lock1_r": args.lock1,
                            "mfe2_r": m2,
                            "lock2_r": lk2,
                            "total_r": round(sm["total_r"], 4),
                            "delta_vs_tp_only": round(sm["total_r"] - s0["total_r"], 4),
                            "delta_vs_stage1": round(sm["total_r"] - s1["total_r"], 4),
                            "win_pct": round(sm["win_rate"], 2),
                            "max_dd_r": round(sm["max_dd_r"], 4),
                            "avg_hold_h": round(sm["avg_hold_bars"] * 4.0, 2),
                        }
                    )
                    if sm["total_r"] > best_tot:
                        best_tot = sm["total_r"]
                        best_key = f"mfe2={m2} lock2={lk2}"

            print(f"    best two-stage in sweep: {best_tot:+.2f} R ({best_key}) vs stage1 {s1['total_r']:+.2f} R")
        print()

    if rows and args.csv:
        outp = os.path.abspath(args.csv)
        d = os.path.dirname(outp)
        if d:
            os.makedirs(d, exist_ok=True)
        pd.DataFrame(rows).to_csv(outp, index=False)
        print(f"Wrote {len(rows)} two-stage rows → {outp}")

    print(
        "Notes:\n"
        "  • mfe2 is cumulative favorable excursion from entry (R). Must exceed first trigger for a second tighten.\n"
        "  • lock2 must be > lock1 for a meaningful second step on longs.\n"
    )


if __name__ == "__main__":
    main()
