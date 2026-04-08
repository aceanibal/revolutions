#!/usr/bin/env python3
"""
Three-stage lock study (sandbox + shared DB).

Default behavior now uses 5m replay for the MFE ladder with lock capping:
  lock_eff = min(lock_r, proven_mfe_r)
This avoids placing profit-lock levels beyond price that has actually traded.

Compares TP targets (default 8R headline) with:
  - TP-only replay (4h baseline)
  - Stage 1 only (4h baseline)
  - Fixed two-stage ladder baseline
  - Three-stage grid over mfe3 × lock3
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np
import pandas as pd

_SANDBOX = os.path.dirname(os.path.abspath(__file__))
if _SANDBOX not in sys.path:
    sys.path.insert(0, _SANDBOX)

from ltf_trade_management_study import (  # noqa: E402
    DB_PATH,
    ReplayResult,
    load_4h_and_5m,
    replay_scenario,
    replay_trade_4h_mfe_ladder,
    replay_trade_mfe_ladder_5m,
    summarize_pnls,
    tp_price_from_r,
)
from multi_asset_4h_rsi_sim import run_simulation_trades  # noqa: E402

DEFAULT_SYMBOLS = ["XRPUSDT", "BTCUSDT", "SOLUSDT", "LINKUSDT", "DOGEUSDT"]


def replay_mfe_ladder_batch(
    trades: list,
    idx,
    high_arr: np.ndarray,
    low_arr: np.ndarray,
    df_5m: pd.DataFrame,
    fee_bps: float,
    tp_r: float,
    stages: list[tuple[float, float]],
    *,
    resolution: str,
    cap_lock_by_mfe: bool,
) -> list[ReplayResult]:
    out: list[ReplayResult] = []
    for t in trades:
        tp_px = tp_price_from_r(t["entry_price"], t["risk"], t["side"], tp_r)
        if resolution == "5m":
            rr = replay_trade_mfe_ladder_5m(
                df_5m,
                idx[t["entry_idx"]],
                t["side"],
                t["entry_price"],
                t["stop_loss"],
                tp_px,
                t["risk"],
                fee_bps,
                stages=stages,
                cap_lock_by_mfe=cap_lock_by_mfe,
            )
        else:
            rr = replay_trade_4h_mfe_ladder(
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
                stages=stages,
            )
        if rr:
            out.append(rr)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Three-stage MFE lock study (5m realistic default)")
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--fee-bps", type=float, default=3.0)
    ap.add_argument("--rsi-l", type=int, default=35)
    ap.add_argument("--rsi-h", type=int, default=60)
    ap.add_argument("--sl-n", type=int, default=3)
    ap.add_argument("--entry-tp-r", type=float, default=5.0)
    ap.add_argument("--symbols", type=str, default=",".join(DEFAULT_SYMBOLS))
    ap.add_argument("--tp-compare", type=str, default="8", help="TP targets (R) to compare")
    ap.add_argument("--mfe1", type=float, default=0.5)
    ap.add_argument("--lock1", type=float, default=1.0)
    ap.add_argument("--mfe2", type=float, default=1.25)
    ap.add_argument("--lock2", type=float, default=3.0)
    ap.add_argument("--mfe3-sweep", type=str, default="4,4.5,5,5.5")
    ap.add_argument("--lock3-sweep", type=str, default="3,3.5,4,4.5,5,5.5,6")
    ap.add_argument(
        "--resolution",
        choices=["5m", "4h"],
        default="5m",
        help="Ladder replay resolution (default 5m)",
    )
    ap.add_argument(
        "--uncapped-lock",
        action="store_true",
        help="5m only: disable lock cap by proven MFE (less realistic)",
    )
    ap.add_argument(
        "--csv",
        type=str,
        default=os.path.join(_SANDBOX, "cache", "ltf_three_stage_lock_study.csv"),
    )
    args = ap.parse_args()

    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    tp_list = [float(x.strip()) for x in args.tp_compare.split(",") if x.strip()]
    mfe3_levels = [float(x.strip()) for x in args.mfe3_sweep.split(",") if x.strip()]
    lock3_levels = [float(x.strip()) for x in args.lock3_sweep.split(",") if x.strip()]
    cap_lock = not args.uncapped_lock

    rows: list[dict] = []
    two_stage_only: list[tuple[float, float]] = [(args.mfe1, args.lock1), (args.mfe2, args.lock2)]

    print(
        f"Three-stage lock study | fee {args.fee_bps} bps | resolution={args.resolution} "
        f"(cap_lock_by_mfe={cap_lock})\n"
        f"stage1 MFE={args.mfe1}R→{args.lock1}R | stage2 MFE={args.mfe2}R→{args.lock2}R (fixed)\n"
        f"TP compare: {tp_list} | stage3: sweep mfe3 × lock3\n"
        f"Engine trade list @ entry TP={args.entry_tp_r}R\n"
    )

    for sym in symbols:
        df_4h, df_5m = load_4h_and_5m(os.path.abspath(args.db), sym)
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

        print(f"=== {sym} | engine trades={n} | engine PnL @ {args.entry_tp_r}R TP: {eng:+.2f} R ===")

        for tp_r in tp_list:
            # Keep these as the known 4h baselines for context.
            tp_only = replay_scenario(trades, idx, h, low, args.fee_bps, tp_r, None, 0.0)
            s0 = summarize_pnls(tp_only)
            one_stage = replay_scenario(trades, idx, h, low, args.fee_bps, tp_r, args.mfe1, args.lock1)
            s1 = summarize_pnls(one_stage)

            ts2 = replay_mfe_ladder_batch(
                trades,
                idx,
                h,
                low,
                df_5m,
                args.fee_bps,
                tp_r,
                two_stage_only,
                resolution=args.resolution,
                cap_lock_by_mfe=cap_lock,
            )
            s2 = summarize_pnls(ts2)

            print(
                f"  TP={tp_r}R | TP-only(4h): {s0['total_r']:+.2f} R | stage1(4h): {s1['total_r']:+.2f} R | "
                f"two-stage({args.resolution}): {s2['total_r']:+.2f} R"
            )

            best_tot = s2["total_r"]
            best_key = "two_stage_fixed"

            for m3 in mfe3_levels:
                for lk3 in lock3_levels:
                    if m3 <= args.mfe2 + 1e-9:
                        continue
                    if lk3 <= args.lock2 + 1e-9:
                        continue
                    stages3 = [*two_stage_only, (m3, lk3)]
                    ts3 = replay_mfe_ladder_batch(
                        trades,
                        idx,
                        h,
                        low,
                        df_5m,
                        args.fee_bps,
                        tp_r,
                        stages3,
                        resolution=args.resolution,
                        cap_lock_by_mfe=cap_lock,
                    )
                    sm = summarize_pnls(ts3)
                    rows.append(
                        {
                            "symbol": sym,
                            "tp_r": tp_r,
                            "mfe1_r": args.mfe1,
                            "lock1_r": args.lock1,
                            "mfe2_r": args.mfe2,
                            "lock2_r": args.lock2,
                            "mfe3_r": m3,
                            "lock3_r": lk3,
                            "resolution": args.resolution,
                            "cap_lock_by_mfe": int(cap_lock),
                            "total_r": round(sm["total_r"], 4),
                            "delta_vs_tp_only": round(sm["total_r"] - s0["total_r"], 4),
                            "delta_vs_stage1": round(sm["total_r"] - s1["total_r"], 4),
                            "delta_vs_two_stage": round(sm["total_r"] - s2["total_r"], 4),
                            "win_pct": round(sm["win_rate"], 2),
                            "max_dd_r": round(sm["max_dd_r"], 4),
                            "avg_hold_h": round(sm["avg_hold_bars"] * (4.0 if args.resolution == "4h" else (5.0 / 60.0)), 2),
                        }
                    )
                    if sm["total_r"] > best_tot:
                        best_tot = sm["total_r"]
                        best_key = f"mfe3={m3} lock3={lk3}"

            print(
                f"    best in sweep: {best_tot:+.2f} R ({best_key}) vs two-stage fixed {s2['total_r']:+.2f} R"
            )
        print()

    if rows and args.csv:
        outp = os.path.abspath(args.csv)
        d = os.path.dirname(outp)
        if d:
            os.makedirs(d, exist_ok=True)
        pd.DataFrame(rows).to_csv(outp, index=False)
        print(f"Wrote {len(rows)} rows → {outp}")

    print(
        "Notes:\n"
        "  • 5m resolution updates MFE/locks from 5m bars after entry bucket.\n"
        "  • With cap_lock_by_mfe=1, lock is capped by proven excursion (more realistic).\n"
        "  • delta_vs_two_stage uses fixed stage2 from --mfe2 / --lock2 at chosen resolution.\n"
    )


if __name__ == "__main__":
    main()
