#!/usr/bin/env python3
"""
FVG (no-creator) + FVG-LOW stop — TP optimization sweep
=========================================================

"No-creator" = FVG signals where bar i-2 is NOT bullish.
Finding from study_ob_strict.py: this subset has 32.7% win rate vs 25% when
bar i-2 IS bullish (creator). The sustained bearish run before the signal
makes momentum more reliable.

This script sweeps:
  1. TP levels (fine-grained: 1.5 → 6.0 in 0.25 steps)
  2. ATR buf_mult for the FVG-LOW stop (0.05, 0.15, 0.25, 0.40)
     to see how sensitive results are to the stop buffer size

Fixed: ATR×2.0 risk basis, vol>1.8, body>0.55, close<0.15, BALANCED+HIGH

Outputs:
  A. Full TP sweep table (all 6 symbols combined)
  B. Best TP — year-by-year breakdown
  C. Best TP — per-symbol
  D. buf_mult sensitivity at best TP
  E. TP sweep split: no-creator vs creator (shows the contrast)

Usage:
    python lab/study_no_creator_sweep.py
    python lab/study_no_creator_sweep.py --start 2024-01-01
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

LAB_ROOT = Path(__file__).resolve().parent
REPO_ROOT = LAB_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from lab.study_ob_strict import (
    collect_signals,
    ob_creator,
    stop_fvg_low,
    run_subset_stats,
    r_saved_report,
)
from lab.study_order_blocks import (
    DEFAULT_DB,
    SYMS,
    YEARS,
    _hdr,
    _max_dd,
    _row,
    _stats,
    prepare_sym,
    replay_fixed_risk,
    risk_std,
    stop_standard,
)


def main(
    db_path: str,
    atr_mult: float       = 2.0,
    vol_ratio_min: float  = 1.8,
    body_pct_min: float   = 0.55,
    close_pct_max: float  = 0.15,
    buf_mult: float       = 0.15,
    start: str            = "2022-01-01",
) -> None:

    tp_sweep = [round(v * 0.25, 2) for v in range(6, 25)]  # 1.5 → 6.0 step 0.25
    buf_sweep = [0.05, 0.10, 0.15, 0.25, 0.40]

    # ── Load ──────────────────────────────────────────────────────────────
    all_sigs: list[dict] = []
    sym_df5: dict[str, pd.DataFrame] = {}

    print(f"\nLoading {len(SYMS)} symbols  [{start} → latest]")
    print(f"Filters: vol>{vol_ratio_min}  body>{body_pct_min}  close<{close_pct_max}\n")

    for sym in SYMS:
        df5, df1h = prepare_sym(db_path, sym, start)
        sym_df5[sym] = df5
        sigs = collect_signals(
            df1h, sym,
            vol_ratio_min=vol_ratio_min,
            body_pct_min=body_pct_min,
            close_pct_max=close_pct_max,
        )
        all_sigs.extend(sigs)

    fvg_sigs     = [s for s in all_sigs if s["has_fvg"]]
    nocre_sigs   = [s for s in fvg_sigs  if not s["has_creator"]]
    cre_sigs     = [s for s in fvg_sigs  if s["has_creator"]]

    std_fn      = lambda s: stop_standard(s, atr_mult)
    fvg_low_fn  = lambda s: stop_fvg_low(s, buf_mult)

    print(f"  Total signals  : {len(all_sigs)}")
    print(f"  FVG signals    : {len(fvg_sigs)} ({len(fvg_sigs)/max(len(all_sigs),1)*100:.1f}%)")
    print(f"  No-creator     : {len(nocre_sigs)} ({len(nocre_sigs)/max(len(fvg_sigs),1)*100:.1f}% of FVG)")
    print(f"  Creator        : {len(cre_sigs)} ({len(cre_sigs)/max(len(fvg_sigs),1)*100:.1f}% of FVG)")

    # ── SECTION A: TP sweep — no-creator + FVG-LOW ────────────────────────
    _hdr(
        f"A — TP sweep  |  FVG no-creator  |  FVG-LOW stop (buf×{buf_mult})  "
        f"|  ATR×{atr_mult} risk basis",
        ["TP", "n", "win%", "avg_R", "total_R", "maxDD", "DD/n", "MCL",
         "R_saved", "ann_R"],
    )

    tp_results = []
    n_years = max((pd.Timestamp("today") - pd.Timestamp(start)).days / 365.25, 1)

    for tp_r in tp_sweep:
        st = run_subset_stats(nocre_sigs, sym_df5, atr_mult, fvg_low_fn, tp_r)
        rpt = r_saved_report(nocre_sigs, sym_df5, atr_mult, fvg_low_fn, tp_r)
        ann = round(st["total_r"] / n_years, 1)
        tp_results.append({"tp": tp_r, "ann_r": ann, **st,
                           "r_saved": rpt["total_r_saved"]})
        _row([f"{tp_r}R", st["n"], f"{st['win_pct']}%", f"{st['avg_r']:.4f}",
              f"{st['total_r']:.1f}", f"{st['max_dd']:.1f}",
              f"{st['dd_per_trade']:.3f}", st.get("mcl", "—"),
              f"{rpt['total_r_saved']:.1f}", f"{ann:.1f}"])

    # Best TP by total_r
    best = max(tp_results, key=lambda x: x["total_r"])
    best_tp = best["tp"]
    print(f"\n  → Best TP by total_R: {best_tp}R  "
          f"(total={best['total_r']:.1f}  win={best['win_pct']}%  "
          f"maxDD={best['max_dd']:.1f}  ann={best['ann_r']:.1f}R/yr)")

    # Also show top 5 by ann_R with DD/n < 0.08
    candidates = sorted(
        [r for r in tp_results if r["dd_per_trade"] < 0.08 and r["n"] >= 30],
        key=lambda x: x["ann_r"], reverse=True,
    )[:5]
    if candidates:
        print(f"\n  Top 5 by ann_R (DD/n < 0.08, n ≥ 30):")
        for r in candidates:
            print(f"    TP={r['tp']}R  ann={r['ann_r']:.1f}/yr  "
                  f"total={r['total_r']:.1f}  win={r['win_pct']}%  "
                  f"maxDD={r['max_dd']:.1f}  DD/n={r['dd_per_trade']:.3f}")

    # ── SECTION B: Year-by-year at best TP ────────────────────────────────
    _hdr(
        f"B — Year breakdown  |  FVG no-creator + FVG-LOW  |  TP={best_tp}R",
        ["year", "n", "win%", "avg_R", "total_R", "maxDD", "R_saved"],
    )
    yr_pnls:   dict[int, list] = defaultdict(list)
    yr_std:    dict[int, list] = defaultdict(list)

    for s in nocre_sigs:
        rb   = risk_std(s, atr_mult)
        df5  = sym_df5[s["sym"]]
        sp_f = fvg_low_fn(s)
        sp_s = stop_standard(s, atr_mult)
        if sp_f is None:
            continue
        res_f = replay_fixed_risk(s, df5, sp_f, rb, best_tp)
        res_s = replay_fixed_risk(s, df5, sp_s, rb, best_tp)
        yr = s["year"]
        if res_f:
            yr_pnls[yr].append(res_f.pnl_r)
        if res_s:
            yr_std[yr].append(res_s.pnl_r)

    for yr in YEARS:
        r    = np.array(yr_pnls.get(yr, []))
        rs   = np.array(yr_std.get(yr, []))
        saved = round(r.sum() - rs.sum(), 2) if len(r) and len(rs) else 0.0
        if len(r) == 0:
            _row([yr, 0, "—", "—", "—", "—", "—"])
        else:
            _row([yr, len(r), f"{(r>0).mean()*100:.1f}%",
                  f"{r.mean():.4f}", f"{r.sum():.1f}",
                  f"{_max_dd(r):.1f}", f"{saved:+.2f}"])

    # ── SECTION C: Per-symbol at best TP ──────────────────────────────────
    _hdr(
        f"C — Per-symbol  |  FVG no-creator + FVG-LOW  |  TP={best_tp}R",
        ["sym", "n", "win%", "total_R", "maxDD", "DD/n",
         "vs_std_R", "vs_std_DD"],
    )
    for sym in SYMS:
        sub  = [s for s in nocre_sigs if s["sym"] == sym]
        st_f = run_subset_stats(sub, sym_df5, atr_mult, fvg_low_fn, best_tp)
        st_s = run_subset_stats(sub, sym_df5, atr_mult, std_fn,     best_tp)
        r_delta  = round(st_f["total_r"] - st_s["total_r"], 2)
        dd_delta = round(st_f["max_dd"]  - st_s["max_dd"],  2)
        _row([sym, len(sub), f"{st_f['win_pct']}%",
              f"{st_f['total_r']:.1f}", f"{st_f['max_dd']:.1f}",
              f"{st_f['dd_per_trade']:.3f}",
              f"{r_delta:+.2f}", f"{dd_delta:+.2f}"])

    # ── SECTION D: buf_mult sensitivity at best TP ────────────────────────
    _hdr(
        f"D — Stop buffer sensitivity  |  FVG no-creator  |  TP={best_tp}R",
        ["buf_mult", "n", "win%", "total_R", "maxDD", "DD/n",
         "R_saved", "saved%"],
    )
    for buf in buf_sweep:
        sfn = lambda s, b=buf: stop_fvg_low(s, b)
        st  = run_subset_stats(nocre_sigs, sym_df5, atr_mult, sfn, best_tp)
        rpt = r_saved_report(nocre_sigs, sym_df5, atr_mult, sfn, best_tp)
        _row([f"×{buf}", st["n"], f"{st['win_pct']}%",
              f"{st['total_r']:.1f}", f"{st['max_dd']:.1f}",
              f"{st['dd_per_trade']:.3f}",
              f"{rpt['total_r_saved']:.1f}", f"{rpt['saved_pct']}%"])

    # ── SECTION E: No-creator vs creator contrast at each TP ─────────────
    _hdr(
        f"E — No-creator vs creator contrast  |  FVG-LOW stop  |  TP sweep (selected)",
        ["TP", "subset", "n", "win%", "total_R", "maxDD", "ann_R"],
    )
    for tp_r in [2.0, 3.0, 4.0, best_tp, 5.0]:
        for label, subset in [("no-creator", nocre_sigs), ("creator", cre_sigs)]:
            st  = run_subset_stats(subset, sym_df5, atr_mult, fvg_low_fn, tp_r)
            ann = round(st["total_r"] / n_years, 1)
            _row([f"{tp_r}R", label, st["n"], f"{st['win_pct']}%",
                  f"{st['total_r']:.1f}", f"{st['max_dd']:.1f}", f"{ann:.1f}"])
        print()

    # ── Save ──────────────────────────────────────────────────────────────
    rows = []
    for tp_r in tp_sweep:
        for label, subset, sfn in [
            ("nocre_fvg_low", nocre_sigs, lambda s, t=tp_r: stop_fvg_low(s, buf_mult)),
            ("nocre_standard", nocre_sigs, std_fn),
            ("cre_fvg_low",   cre_sigs,   lambda s, t=tp_r: stop_fvg_low(s, buf_mult)),
            ("fvg_fvg_low",   fvg_sigs,   lambda s, t=tp_r: stop_fvg_low(s, buf_mult)),
        ]:
            st = run_subset_stats(subset, sym_df5, atr_mult, sfn, tp_r)
            ann = round(st["total_r"] / n_years, 1)
            rows.append({"subset": label, "tp": tp_r, "ann_r": ann, **st})

    out = REPO_ROOT / "cache" / "no_creator_tp_sweep.csv"
    out.parent.mkdir(exist_ok=True)
    pd.DataFrame(rows).to_csv(out, index=False)
    print(f"\nSaved → {out}\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db",         default=DEFAULT_DB)
    ap.add_argument("--start",      default="2022-01-01")
    ap.add_argument("--atr-mult",   type=float, default=2.0)
    ap.add_argument("--vol-ratio",  type=float, default=1.8)
    ap.add_argument("--body-pct",   type=float, default=0.55)
    ap.add_argument("--close-pct",  type=float, default=0.15)
    ap.add_argument("--buf",        type=float, default=0.15)
    args = ap.parse_args()

    print("=" * 72)
    print("FVG (no-creator) + FVG-LOW stop — TP optimization sweep")
    print("=" * 72)

    main(
        db_path       = args.db,
        atr_mult      = args.atr_mult,
        vol_ratio_min = args.vol_ratio,
        body_pct_min  = args.body_pct,
        close_pct_max = args.close_pct,
        buf_mult      = args.buf,
        start         = args.start,
    )
