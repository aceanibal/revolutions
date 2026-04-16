#!/usr/bin/env python3
"""
Swing Low — Trigger/Lock/TP Fine-tune Sweep
============================================

Grid search over (trig_r, lock_r, tp_r) to find the optimal single-trigger
lock config for BAL+HIGH swing low signals.

Trigger range : 1.5 → 6.0R  (step 0.5)
Lock range    : 0.0 → trig-0.5R  (step 0.5, must be < trig)
TP range      : 6, 8, 10, 12, 14, 16, 19.5R

Outputs ranked tables by Calmar and ann_R.
Also shows a TP-slice heatmap (best lock per TP).
"""
from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd

LAB_ROOT  = Path(__file__).resolve().parent
REPO_ROOT = LAB_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from lab.study_fvg_momentum import DEFAULT_DB, SYMS, YEARS, _max_dd, prepare_sym
from lab.sim.exit   import replay_trade_5m
from lab.sim.entry  import tp_price_from_r
from lab.study_imbalanced_trend import _mcl
from lab.study_swing_low_sweep  import collect_sweep_signals


ATR_MULT = 2.0
FEE_BPS  = 3.0
START    = "2022-01-01"


def _replay(sig, df5, tp_r, trig_r, lock_r):
    risk   = sig["atr"] * ATR_MULT
    if risk <= 0: return None
    stop_p = sig["entry_p"] - risk
    tp_p   = tp_price_from_r(sig["entry_p"], risk, +1, tp_r)
    return replay_trade_5m(
        df5, sig["ts"], +1, sig["entry_p"], stop_p, tp_p,
        risk, FEE_BPS,
        be_trigger_r=trig_r,
        be_offset_r=lock_r,
        skip_entry_bucket_hours=0.0,
    )


def _metrics(pnls, n_years):
    if not pnls:
        return None
    arr = np.array(pnls)
    dd  = _max_dd(arr)
    n   = len(arr)
    ann = float(arr.sum()) / n_years
    return dict(
        n=n, win_pct=round((arr > 0).mean() * 100, 1),
        avg_r=round(float(arr.mean()), 4),
        total_r=round(float(arr.sum()), 2),
        max_dd=round(dd, 2), dd_per_trade=round(dd / n, 4),
        mcl=_mcl(arr), ann_r=round(ann, 1),
        calmar=round(ann / dd, 2) if dd > 0 else 0.0,
    )


def _year_breakdown(sigs, sym_df5, trig_r, lock_r, tp_r, n_years):
    yr = {}
    for s in sigs:
        r = _replay(s, sym_df5[s["sym"]], tp_r, trig_r, lock_r)
        if r:
            yr.setdefault(s["year"], []).append(r.pnl_r)
    rows = []
    for y in YEARS:
        arr = np.array(yr.get(y, []))
        if len(arr):
            rows.append(f"{y}: {arr.sum():+.1f}R  ({(arr>0).mean()*100:.0f}% win)")
        else:
            rows.append(f"{y}: —")
    return rows


def main():
    print(f"\n{'='*72}")
    print(f"  SWING LOW — Trigger/Lock/TP Fine-tune Sweep  (BAL+HIGH)")
    print(f"{'='*72}")

    # ── Load signals ──────────────────────────────────────────────────────────
    all_sigs, sym_df5 = [], {}
    print(f"  Loading symbols...")
    for sym in SYMS:
        df5, df1h = prepare_sym(DEFAULT_DB, sym, START)
        sym_df5[sym] = df5
        sigs = collect_sweep_signals(df1h, sym, lookback=50, tolerance=0.005,
                                     min_swing=5, rejection_min=0.90)
        sigs = [s for s in sigs
                if s["structure"] == "BALANCED" and s["vol_q"] == "HIGH"]
        all_sigs.extend(sigs)
    n_years = max((pd.Timestamp("today") - pd.Timestamp(START)).days / 365.25, 1)
    print(f"  {len(all_sigs)} signals  ({len(all_sigs)/n_years:.0f}/yr)\n")

    # ── Build grid ────────────────────────────────────────────────────────────
    trig_vals = [round(x * 0.5, 1) for x in range(3, 13)]   # 1.5 → 6.0
    lock_vals = [round(x * 0.5, 1) for x in range(0, 9)]    # 0.0 → 4.0
    tp_vals   = [6.0, 8.0, 10.0, 12.0, 14.0, 16.0, 19.5]

    # Baseline (no lock) for each TP
    baseline = {}
    for tp in tp_vals:
        pnls = []
        for s in all_sigs:
            r = _replay(s, sym_df5[s["sym"]], tp, trig_r=None, lock_r=0.0)
            if r: pnls.append(r.pnl_r)
        baseline[tp] = _metrics(pnls, n_years)

    # Grid configs: only lock_r < trig_r
    configs = [
        (trig, lock, tp)
        for trig in trig_vals
        for lock in lock_vals if lock < trig
        for tp   in tp_vals
    ]
    print(f"  Running {len(configs)} configs in parallel...")

    results = {}
    with ThreadPoolExecutor(max_workers=12) as ex:
        futs = {
            ex.submit(
                lambda cfg: (
                    cfg,
                    _metrics(
                        [r.pnl_r for s in all_sigs
                         for r in [_replay(s, sym_df5[s["sym"]], cfg[2], cfg[0], cfg[1])]
                         if r],
                        n_years,
                    )
                ),
                cfg,
            ): cfg
            for cfg in configs
        }
        done = 0
        for fut in as_completed(futs):
            cfg, m = fut.result()
            if m: results[cfg] = m
            done += 1
            if done % 50 == 0:
                print(f"    {done}/{len(configs)} done...")

    print(f"  Complete — {len(results)} valid configs\n")

    # ── Section A — Baseline reference ───────────────────────────────────────
    print(f"{'='*72}")
    print(f"  A — Baseline (no lock)")
    print(f"{'='*72}")
    print(f"  {'TP':>6}  {'ann_R':>7}  {'maxDD':>6}  {'Calmar':>7}  {'win%':>6}  {'MCL':>4}")
    print(f"  {'-'*50}")
    for tp in tp_vals:
        m = baseline[tp]
        print(f"  {tp:>5.1f}R  {m['ann_r']:>7.1f}  {m['max_dd']:>6.1f}  "
              f"{m['calmar']:>7.2f}  {m['win_pct']:>5.1f}%  {m['mcl']:>4}")

    # ── Section B — Top 20 by Calmar ─────────────────────────────────────────
    ranked_calmar = sorted(results.items(), key=lambda x: x[1]["calmar"], reverse=True)
    print(f"\n{'='*72}")
    print(f"  B — Top 20 by Calmar")
    print(f"{'='*72}")
    print(f"  {'trig':>5}  {'lock':>5}  {'TP':>6}  {'ann_R':>7}  {'maxDD':>6}  "
          f"{'Calmar':>7}  {'MCL':>4}  {'win%':>6}  {'DD/n':>6}")
    print(f"  {'-'*70}")
    for (trig, lock, tp), m in ranked_calmar[:20]:
        print(f"  {trig:>5.1f}R  {lock:>+5.1f}R  {tp:>5.1f}R  "
              f"{m['ann_r']:>7.1f}  {m['max_dd']:>6.1f}  {m['calmar']:>7.2f}  "
              f"{m['mcl']:>4}  {m['win_pct']:>5.1f}%  {m['dd_per_trade']:>6.3f}")

    # ── Section C — Top 20 by ann_R ──────────────────────────────────────────
    ranked_ann = sorted(results.items(), key=lambda x: x[1]["ann_r"], reverse=True)
    print(f"\n{'='*72}")
    print(f"  C — Top 20 by ann_R")
    print(f"{'='*72}")
    print(f"  {'trig':>5}  {'lock':>5}  {'TP':>6}  {'ann_R':>7}  {'maxDD':>6}  "
          f"{'Calmar':>7}  {'MCL':>4}  {'win%':>6}  {'DD/n':>6}")
    print(f"  {'-'*70}")
    for (trig, lock, tp), m in ranked_ann[:20]:
        print(f"  {trig:>5.1f}R  {lock:>+5.1f}R  {tp:>5.1f}R  "
              f"{m['ann_r']:>7.1f}  {m['max_dd']:>6.1f}  {m['calmar']:>7.2f}  "
              f"{m['mcl']:>4}  {m['win_pct']:>5.1f}%  {m['dd_per_trade']:>6.3f}")

    # ── Section D — Best per TP (by Calmar) ──────────────────────────────────
    print(f"\n{'='*72}")
    print(f"  D — Best lock config per TP  (ranked by Calmar)")
    print(f"{'='*72}")
    print(f"  {'TP':>6}  {'trig':>5}  {'lock':>5}  {'ann_R':>7}  {'maxDD':>6}  "
          f"{'Calmar':>7}  {'MCL':>4}  {'win%':>6}  vs baseline Calmar")
    print(f"  {'-'*75}")
    best_per_tp = {}
    for tp in tp_vals:
        tp_configs = [(cfg, m) for cfg, m in results.items() if cfg[2] == tp]
        if not tp_configs: continue
        best_cfg, best_m = max(tp_configs, key=lambda x: x[1]["calmar"])
        best_per_tp[tp] = (best_cfg, best_m)
        bl = baseline[tp]
        delta = best_m["calmar"] - bl["calmar"]
        trig, lock, _ = best_cfg
        print(f"  {tp:>5.1f}R  {trig:>5.1f}R  {lock:>+5.1f}R  "
              f"{best_m['ann_r']:>7.1f}  {best_m['max_dd']:>6.1f}  "
              f"{best_m['calmar']:>7.2f}  {best_m['mcl']:>4}  "
              f"{best_m['win_pct']:>5.1f}%  "
              f"({bl['calmar']:.2f} → {best_m['calmar']:.2f}  {delta:+.2f})")

    # ── Section E — Calmar heatmap: trig × lock at best TP ───────────────────
    # Find the single best TP overall by Calmar
    best_overall = ranked_calmar[0]
    best_tp = best_overall[0][2]

    print(f"\n{'='*72}")
    print(f"  E — Calmar heatmap  (TP={best_tp}R — best overall TP)")
    print(f"      Rows=trig_R  Cols=lock_R")
    print(f"{'='*72}")
    tp_slice = {(cfg[0], cfg[1]): m
                for cfg, m in results.items() if cfg[2] == best_tp}

    used_trigs = sorted(set(k[0] for k in tp_slice))
    used_locks = sorted(set(k[1] for k in tp_slice))

    # Header
    print(f"  {'trig':>5}  " + "  ".join(f"lk={l:+.1f}" for l in used_locks))
    print(f"  {'-'*5}  " + "  ".join("-"*7 for _ in used_locks))
    for trig in used_trigs:
        row = f"  {trig:>5.1f}R "
        for lock in used_locks:
            if lock >= trig:
                row += "      —  "
            else:
                m = tp_slice.get((trig, lock))
                row += f"  {m['calmar']:>5.2f} " if m else "      — "
        print(row)

    # ── Section F — Year breakdown for top 3 configs ─────────────────────────
    print(f"\n{'='*72}")
    print(f"  F — Year breakdown — top 3 by Calmar")
    print(f"{'='*72}")
    for rank, ((trig, lock, tp), m) in enumerate(ranked_calmar[:3], 1):
        yrs = _year_breakdown(all_sigs, sym_df5, trig, lock, tp, n_years)
        print(f"\n  #{rank}  trig={trig}R→lock={lock:+.1f}R  TP={tp}R  "
              f"ann={m['ann_r']:.1f}  maxDD={m['max_dd']:.1f}  Calmar={m['calmar']:.2f}")
        for y in yrs:
            print(f"    {y}")

    # ── Section G — Best config at "reasonable" TPs (≤14R) ───────────────────
    print(f"\n{'='*72}")
    print(f"  G — Best configs at practical TPs (≤14R)  sorted by Calmar")
    print(f"{'='*72}")
    practical = [(cfg, m) for cfg, m in results.items() if cfg[2] <= 14.0]
    practical_ranked = sorted(practical, key=lambda x: x[1]["calmar"], reverse=True)[:15]
    print(f"  {'trig':>5}  {'lock':>5}  {'TP':>6}  {'ann_R':>7}  {'maxDD':>6}  "
          f"{'Calmar':>7}  {'MCL':>4}  {'win%':>6}")
    print(f"  {'-'*62}")
    for (trig, lock, tp), m in practical_ranked:
        print(f"  {trig:>5.1f}R  {lock:>+5.1f}R  {tp:>5.1f}R  "
              f"{m['ann_r']:>7.1f}  {m['max_dd']:>6.1f}  {m['calmar']:>7.2f}  "
              f"{m['mcl']:>4}  {m['win_pct']:>5.1f}%")

    print(f"\n{'='*72}")
    print(f"  DONE")
    print(f"{'='*72}\n")


if __name__ == "__main__":
    main()
