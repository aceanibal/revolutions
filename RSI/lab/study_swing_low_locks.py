#!/usr/bin/env python3
"""
Swing Low Sweep — BAL+HIGH Lock / Trailing Stop Study
======================================================

Builds on study_swing_low_sweep.py which confirmed BAL+HIGH has real edge
at TP=8.5R–19.5R (Calmar 2.0–3.0, ann_R 35–88).

Problem: 12% win rate means long losing streaks (MCL=15–29 at high TPs).
Goal: add MFE-based locking to:
  1. Convert some -1R full stops into partial recoveries (BE or small gain)
  2. Capture value from big runners without capping upside too hard
  3. Reduce maxDD while keeping ann_R competitive

Two locking mechanisms tested:
  A) Single BE trigger — at MFE=X, move stop to entry + Y×risk
     Simple, one decision point.
  B) MFE ladder — N stages, each locks progressively higher
     Captures value at multiple checkpoints, lets winners run.

Baseline (no lock, TP=12R and TP=19.5R) is always shown first for comparison.

Configs tested
--------------
Single-trigger:
  trig=2R lock=0R (BE), TP=12/15/19.5R
  trig=2R lock=+1R,     TP=12/15/19.5R
  trig=3R lock=0R (BE), TP=12/15/19.5R
  trig=3R lock=+1R,     TP=15/19.5R
  trig=4R lock=+2R,     TP=15/19.5R

MFE ladder:
  Ladder A: (2R→0R, 5R→2R, 10R→6R)        TP=15R
  Ladder B: (2R→0R, 5R→2R, 10R→6R)        TP=19.5R
  Ladder C: (3R→0R, 7R→4R, 12R→8R)        TP=19.5R
  Ladder D: (2R→0R, 5R→2R, 10R→6R, 15R→10R) TP=20R  (full trail)
  Ladder E: (2R→-0.5R, 5R→2R, 10R→6R)    TP=15R    (sub-entry lock)

Sections
--------
A  Baseline (no lock)
B  Single-trigger grid
C  MFE ladder grid
D  Best lock vs baseline side-by-side
E  Year breakdown — best lock config
F  Per-symbol — best lock config

Usage:
    python lab/study_swing_low_locks.py
    python lab/study_swing_low_locks.py --tp-baseline 8.5 19.5
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd

LAB_ROOT  = Path(__file__).resolve().parent
REPO_ROOT = LAB_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from lab.study_fvg_momentum import (
    DEFAULT_DB, SYMS, YEARS,
    _hdr, _max_dd, _row,
    prepare_sym,
)
from lab.sim.exit import (
    replay_trade_5m,
    replay_trade_mfe_ladder_5m,
    ReplayResult,
)
from lab.sim.entry import tp_price_from_r
from lab.study_imbalanced_trend import _mcl
from lab.study_swing_low_sweep import (
    collect_sweep_signals,
    find_swing_lows,
)


# ── Replay helpers ────────────────────────────────────────────────────────────

ATR_MULT  = 2.0
FEE_BPS   = 3.0


def _replay_fixed(sig, df5, tp_r, be_trigger_r=None, be_offset_r=0.0):
    """Fixed ATR stop, optional single BE trigger."""
    risk   = sig["atr"] * ATR_MULT
    if risk <= 0: return None
    stop_p = sig["entry_p"] - risk
    tp_p   = tp_price_from_r(sig["entry_p"], risk, +1, tp_r)
    return replay_trade_5m(
        df5, sig["ts"], +1, sig["entry_p"], stop_p, tp_p,
        risk, FEE_BPS,
        be_trigger_r=be_trigger_r,
        be_offset_r=be_offset_r,
        skip_entry_bucket_hours=0.0,
    )


def _replay_ladder(sig, df5, tp_r, stages):
    """MFE ladder stop."""
    risk   = sig["atr"] * ATR_MULT
    if risk <= 0: return None
    stop_p = sig["entry_p"] - risk
    tp_p   = tp_price_from_r(sig["entry_p"], risk, +1, tp_r)
    return replay_trade_mfe_ladder_5m(
        df5, sig["ts"], +1, sig["entry_p"], stop_p, tp_p,
        risk, FEE_BPS,
        stages=stages,
        cap_lock_by_mfe=True,
        skip_entry_bucket_hours=0.0,
    )


# ── Metrics helpers ───────────────────────────────────────────────────────────

def _metrics(pnls, n_years):
    if not pnls:
        return dict(n=0, win_pct=0, avg_r=0, total_r=0,
                    max_dd=0, dd_per_trade=0, mcl=0, ann_r=0, calmar=0)
    arr = np.array(pnls)
    dd  = _max_dd(arr)
    n   = len(arr)
    ann = float(arr.sum()) / n_years
    return dict(
        n=n,
        win_pct=round((arr > 0).mean() * 100, 1),
        avg_r=round(float(arr.mean()), 4),
        total_r=round(float(arr.sum()), 2),
        max_dd=round(dd, 2),
        dd_per_trade=round(dd / n, 4),
        mcl=_mcl(arr),
        ann_r=round(ann, 1),
        calmar=round(ann / dd, 2) if dd > 0 else 0.0,
    )


def _run(sigs, sym_df5, replay_fn, **kwargs):
    """Collect pnls for one config across all signals."""
    pnls = []
    for s in sigs:
        r = replay_fn(s, sym_df5[s["sym"]], **kwargs)
        if r: pnls.append(r.pnl_r)
    return pnls


def _print_row(label, m, width=42):
    print(f"  {label:<{width}}  n={m['n']:>3}  win={m['win_pct']:>4}%  "
          f"ann={m['ann_r']:>6.1f}  maxDD={m['max_dd']:>5.1f}  "
          f"DD/n={m['dd_per_trade']:.3f}  MCL={m['mcl']:>2}  Calmar={m['calmar']:.2f}")


def _year_detail(sigs, sym_df5, replay_fn, n_years, label, **kwargs):
    _hdr(label, ["year", "n", "win%", "total_R", "maxDD", "ann_R"])
    yr = defaultdict(list)
    for s in sigs:
        r = replay_fn(s, sym_df5[s["sym"]], **kwargs)
        if r: yr[s["year"]].append(r.pnl_r)
    for y in YEARS:
        arr = np.array(yr.get(y, []))
        if not len(arr):
            _row([y, 0, "—", "—", "—", "—"]); continue
        _row([y, len(arr), f"{(arr>0).mean()*100:.1f}%",
              f"{arr.sum():.1f}", f"{_max_dd(arr):.1f}",
              f"{arr.sum()/n_years:.1f}"])


def _sym_detail(sigs, sym_df5, replay_fn, n_years, label, **kwargs):
    _hdr(label, ["sym", "n", "win%", "total_R", "maxDD", "ann_R", "Calmar"])
    for sym in SYMS:
        sub  = [s for s in sigs if s["sym"] == sym]
        pnls = [r.pnl_r for s in sub
                for r in [replay_fn(s, sym_df5[sym], **kwargs)] if r]
        if not pnls:
            _row([sym, 0, "—", "—", "—", "—", "—"]); continue
        arr = np.array(pnls); dd = _max_dd(arr)
        _row([sym, len(arr), f"{(arr>0).mean()*100:.1f}%",
              f"{arr.sum():.1f}", f"{dd:.1f}",
              f"{arr.sum()/n_years:.1f}",
              f"{arr.sum()/n_years/dd:.2f}" if dd > 0 else "—"])


# ── Main ──────────────────────────────────────────────────────────────────────

def main(
    db_path: str,
    start: str = "2022-01-01",
    tp_baselines: list[float] | None = None,
):
    tp_baselines = tp_baselines or [12.0, 19.5]

    print(f"\n{'='*72}")
    print(f"  SWING LOW — BAL+HIGH Lock / Trailing Stop Study")
    print(f"{'='*72}")
    print(f"  regime=BAL+HIGH  rejection≥0.90  ATR×{ATR_MULT}  fee={FEE_BPS}bps")
    print(f"  start={start}\n")

    # ── Load signals ──────────────────────────────────────────────────────────
    all_sigs: list[dict] = []
    sym_df5: dict[str, pd.DataFrame] = {}

    print(f"  Loading {len(SYMS)} symbols...")
    for sym in SYMS:
        df5, df1h = prepare_sym(db_path, sym, start)
        sym_df5[sym] = df5
        sigs = collect_sweep_signals(
            df1h, sym,
            lookback=50, tolerance=0.005,
            min_swing=5, rejection_min=0.90,
        )
        sigs = [s for s in sigs
                if s["structure"] == "BALANCED" and s["vol_q"] == "HIGH"]
        all_sigs.extend(sigs)
        print(f"  {sym:<12}  signals={len(sigs):>3}")

    n_years = max((pd.Timestamp("today") - pd.Timestamp(start)).days / 365.25, 1)
    print(f"\n  TOTAL: {len(all_sigs)} signals  ({len(all_sigs)/n_years:.0f}/yr)\n")

    if not all_sigs:
        print("  No signals."); return

    # ── Section A — Baseline (no lock) ────────────────────────────────────────
    print(f"\n{'='*72}")
    print(f"  A — Baseline (no lock, ATR stop)")
    print(f"{'='*72}")
    print(f"  {'Config':<42}  {'n':>3}  {'win':>5}  {'ann_R':>6}  {'maxDD':>5}  "
          f"{'DD/n':>5}  {'MCL':>3}  {'Calmar':>6}")
    print(f"  {'-'*80}")
    baseline_results = {}
    for tp in tp_baselines:
        pnls = _run(all_sigs, sym_df5, _replay_fixed, tp_r=tp)
        m = _metrics(pnls, n_years)
        baseline_results[tp] = m
        _print_row(f"no-lock  TP={tp}R", m)

    # ── Section B — Single-trigger grid ───────────────────────────────────────
    print(f"\n{'='*72}")
    print(f"  B — Single BE trigger  (trig_R → lock_R, then run to TP)")
    print(f"{'='*72}")
    print(f"  {'Config':<42}  {'n':>3}  {'win':>5}  {'ann_R':>6}  {'maxDD':>5}  "
          f"{'DD/n':>5}  {'MCL':>3}  {'Calmar':>6}")
    print(f"  {'-'*80}")

    single_configs = [
        # (trig_r, lock_r, tp_r)
        (2.0,  0.0,  12.0),
        (2.0,  1.0,  12.0),
        (3.0,  0.0,  12.0),
        (3.0,  1.0,  12.0),
        (2.0,  0.0,  15.0),
        (2.0,  1.0,  15.0),
        (3.0,  0.0,  15.0),
        (3.0,  1.0,  15.0),
        (4.0,  2.0,  15.0),
        (2.0,  0.0,  19.5),
        (2.0,  1.0,  19.5),
        (3.0,  0.0,  19.5),
        (3.0,  1.0,  19.5),
        (4.0,  2.0,  19.5),
        (5.0,  3.0,  19.5),
    ]

    single_results = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {
            ex.submit(_run, all_sigs, sym_df5, _replay_fixed,
                      tp_r=tp, be_trigger_r=trig, be_offset_r=lock): (trig, lock, tp)
            for trig, lock, tp in single_configs
        }
        for fut in as_completed(futs):
            cfg = futs[fut]
            single_results[cfg] = _metrics(fut.result(), n_years)

    for cfg in single_configs:
        trig, lock, tp = cfg
        m = single_results[cfg]
        label = f"trig={trig}R→lock={lock:+.1f}R  TP={tp}R"
        _print_row(label, m)
        # blank line between TP groups
        if cfg == single_configs[-1] or single_configs[single_configs.index(cfg)+1][2] != tp:
            print()

    # ── Section C — MFE ladder grid ───────────────────────────────────────────
    print(f"{'='*72}")
    print(f"  C — MFE ladder  (cumulative lock stages + TP)")
    print(f"{'='*72}")
    print(f"  {'Config':<42}  {'n':>3}  {'win':>5}  {'ann_R':>6}  {'maxDD':>5}  "
          f"{'DD/n':>5}  {'MCL':>3}  {'Calmar':>6}")
    print(f"  {'-'*80}")

    ladder_configs = [
        # (label, stages, tp_r)
        ("(2→0, 5→2, 10→6)     TP=12R",
         [(2.0, 0.0), (5.0, 2.0), (10.0, 6.0)], 12.0),
        ("(2→0, 5→2, 10→6)     TP=15R",
         [(2.0, 0.0), (5.0, 2.0), (10.0, 6.0)], 15.0),
        ("(2→0, 5→2, 10→6)     TP=19.5R",
         [(2.0, 0.0), (5.0, 2.0), (10.0, 6.0)], 19.5),
        ("(3→0, 7→4, 12→8)     TP=19.5R",
         [(3.0, 0.0), (7.0, 4.0), (12.0, 8.0)], 19.5),
        ("(2→-0.5, 5→2, 10→6)  TP=15R",
         [(2.0, -0.5), (5.0, 2.0), (10.0, 6.0)], 15.0),
        ("(2→-0.5, 5→2, 10→6)  TP=19.5R",
         [(2.0, -0.5), (5.0, 2.0), (10.0, 6.0)], 19.5),
        ("(2→0, 5→2, 10→6, 15→10) TP=20R  [full trail]",
         [(2.0, 0.0), (5.0, 2.0), (10.0, 6.0), (15.0, 10.0)], 20.0),
        ("(3→0, 6→3, 10→7, 15→11) TP=20R",
         [(3.0, 0.0), (6.0, 3.0), (10.0, 7.0), (15.0, 11.0)], 20.0),
        # Tighter first lock — rescue more losers
        ("(1.5→0, 4→2, 8→5)    TP=15R",
         [(1.5, 0.0), (4.0, 2.0), (8.0, 5.0)], 15.0),
        ("(1.5→0, 4→2, 8→5)    TP=19.5R",
         [(1.5, 0.0), (4.0, 2.0), (8.0, 5.0)], 19.5),
        # Wider first lock — only protect big runners
        ("(4→0, 8→4, 14→10)    TP=19.5R",
         [(4.0, 0.0), (8.0, 4.0), (14.0, 10.0)], 19.5),
        ("(4→0, 8→4, 14→10)    TP=20R",
         [(4.0, 0.0), (8.0, 4.0), (14.0, 10.0)], 20.0),
    ]

    ladder_results = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {
            ex.submit(_run, all_sigs, sym_df5, _replay_ladder,
                      tp_r=tp, stages=stages): (label, stages, tp)
            for label, stages, tp in ladder_configs
        }
        for fut in as_completed(futs):
            cfg = futs[fut]
            ladder_results[cfg[0]] = _metrics(fut.result(), n_years)

    for label, stages, tp in ladder_configs:
        m = ladder_results[label]
        _print_row(label, m)
    print()

    # ── Section D — Best lock vs baseline ────────────────────────────────────
    print(f"{'='*72}")
    print(f"  D — Summary: Baseline vs best lock configs")
    print(f"{'='*72}")

    all_results = []
    for tp, m in baseline_results.items():
        all_results.append((f"BASELINE no-lock TP={tp}R", m))
    for cfg in single_configs:
        trig, lock, tp = cfg
        m = single_results[cfg]
        all_results.append((f"SINGLE trig={trig}R→{lock:+.1f}R TP={tp}R", m))
    for label, _, _ in ladder_configs:
        m = ladder_results[label]
        all_results.append((f"LADDER {label}", m))

    # Sort by Calmar desc, show top 10
    top = sorted(all_results, key=lambda x: x[1]["calmar"], reverse=True)[:10]
    print(f"\n  Top 10 by Calmar:")
    print(f"  {'Config':<50}  {'ann_R':>6}  {'maxDD':>5}  {'Calmar':>6}  {'MCL':>3}  {'win%':>5}")
    print(f"  {'-'*88}")
    best_config = None
    for name, m in top:
        flag = " ← BEST" if best_config is None and m["ann_r"] > 0 else ""
        print(f"  {name:<50}  {m['ann_r']:>6.1f}  {m['max_dd']:>5.1f}  "
              f"{m['calmar']:>6.2f}  {m['mcl']:>3}  {m['win_pct']:>4.1f}%{flag}")
        if best_config is None and m["ann_r"] > 0:
            best_config = (name, m)

    # Also show top 10 by ann_R
    top_ann = sorted(all_results, key=lambda x: x[1]["ann_r"], reverse=True)[:10]
    print(f"\n  Top 10 by ann_R:")
    print(f"  {'Config':<50}  {'ann_R':>6}  {'maxDD':>5}  {'Calmar':>6}  {'MCL':>3}  {'win%':>5}")
    print(f"  {'-'*88}")
    best_ann = None
    for name, m in top_ann:
        flag = " ← BEST" if best_ann is None else ""
        print(f"  {name:<50}  {m['ann_r']:>6.1f}  {m['max_dd']:>5.1f}  "
              f"{m['calmar']:>6.2f}  {m['mcl']:>3}  {m['win_pct']:>4.1f}%{flag}")
        if best_ann is None:
            best_ann = (name, m)

    # ── Section E — Year breakdown for best Calmar config ─────────────────────
    # Find best single and best ladder for year breakdown
    best_single = max(single_results.items(), key=lambda x: x[1]["calmar"])
    best_single_cfg = best_single[0]   # (trig, lock, tp)
    trig, lock, tp = best_single_cfg

    best_ladder = max(ladder_results.items(), key=lambda x: x[1]["calmar"])
    best_ladder_label = best_ladder[0]
    best_ladder_cfg   = next((s, t) for l, s, t in ladder_configs if l == best_ladder_label)

    _year_detail(all_sigs, sym_df5, _replay_fixed, n_years,
                 f"E1 — Year breakdown: best single  trig={trig}R→{lock:+.1f}R  TP={tp}R",
                 tp_r=tp, be_trigger_r=trig, be_offset_r=lock)

    _year_detail(all_sigs, sym_df5, _replay_ladder, n_years,
                 f"E2 — Year breakdown: best ladder  {best_ladder_label}",
                 tp_r=best_ladder_cfg[1], stages=best_ladder_cfg[0])

    # Also year breakdown for the no-lock TP=19.5R (reference)
    _year_detail(all_sigs, sym_df5, _replay_fixed, n_years,
                 "E3 — Year breakdown: baseline no-lock TP=19.5R",
                 tp_r=19.5, be_trigger_r=None, be_offset_r=0.0)

    # ── Section F — Per-symbol for best configs ───────────────────────────────
    _sym_detail(all_sigs, sym_df5, _replay_fixed, n_years,
                f"F1 — Per-symbol: best single  trig={trig}R→{lock:+.1f}R  TP={tp}R",
                tp_r=tp, be_trigger_r=trig, be_offset_r=lock)

    _sym_detail(all_sigs, sym_df5, _replay_ladder, n_years,
                f"F2 — Per-symbol: best ladder  {best_ladder_label}",
                tp_r=best_ladder_cfg[1], stages=best_ladder_cfg[0])

    print(f"\n{'='*72}")
    print(f"  DONE")
    print(f"{'='*72}\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db",    default=DEFAULT_DB)
    ap.add_argument("--start", default="2022-01-01")
    ap.add_argument("--tp-baseline", type=float, nargs="+", default=[12.0, 19.5],
                    metavar="R", help="TP levels for no-lock baseline comparison")
    args = ap.parse_args()
    main(
        db_path      = args.db,
        start        = args.start,
        tp_baselines = args.tp_baseline,
    )
