#!/usr/bin/env python3
"""
FVG + FVG-LOW stop — MAE/MFE profit-lock sweep
================================================

Baseline: FVG signals (226), FVG-LOW stop (buf×0.15), TP=4.25R
  226 signals | 29.6% win | 142.3R total | maxDD=10.3 | 33.2R/yr

Concept: After price moves favourably by mfe_trigger R, move the stop to
  lock_r R of profit (or break-even at 0). The stop is monotonic — it can
  only tighten, never loosen.

The MFE lock is applied ON TOP of the FVG-LOW initial stop:
  stop_init = fvg_low + ATR × buf_mult   ← FVG-LOW (initial stop)
  risk      = ATR × atr_mult             ← standard risk (TP + R units)
  tp_price  = entry - risk × tp_r        ← TP fixed from standard risk

  When price excursion from entry reaches mfe_trigger × risk (favourably):
    stop moves to entry - lock_r × risk   (shorts: moving TOWARD entry = tighter)

Because the initial stop is the FVG-LOW level (< 1R below entry), the lock
can only make it tighter — it never loosens it.

Sections
--------
A. Single-stage sweep — full grid of (mfe_trigger, lock_r)
   Columns: mfe | lock | n | TP% | BE% | SL% | avg_R | total_R | maxDD | DD/n | ann_R

B. Two-stage sweep — selected ladders building on best single-stage configs

C. Year breakdown at best config vs baseline

D. Per-symbol at best config vs baseline

Usage:
    python lab/study_fvg_lock_sweep.py
    python lab/study_fvg_lock_sweep.py --start 2023-01-01
    python lab/study_fvg_lock_sweep.py --tp 4.25 --buf 0.15
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

from lab.study_fvg_momentum import (
    DEFAULT_DB,
    SYMS,
    YEARS,
    _hdr,
    _max_dd,
    _row,
    _stats,
)
from lab.study_order_blocks import (
    risk_std,
    stop_fvg,
    stop_standard,
    replay_fixed_risk,   # baseline (no lock)
    _run_subset,
)
from lab.sim.exit import replay_trade_mfe_ladder_5m


# ── Replay with MFE lock ladder ────────────────────────────────────────────

def replay_fvg_low_with_lock(
    sig: dict,
    df5: pd.DataFrame,
    atr_mult: float,
    buf_mult: float,
    tp_r: float,
    stages: list[tuple[float, float]],   # [(mfe_r, lock_r), ...]
    fee_bps: float = 3.0,
) -> "ReplayResult | None":
    """
    Short trade: FVG-LOW initial stop + MFE ladder to lock profit.

    stop_init = fvg_low + ATR×buf_mult     (FVG-LOW, tighter than standard)
    risk      = ATR×atr_mult               (standard, for TP + R accounting)
    tp_price  = entry - risk × tp_r        (fixed TP, same as baseline)

    MFE is measured in standard-risk units so that mfe=1.0R means
    price moved 1 standard risk in your favour — same units as the TP.
    """
    from lab.sim.entry import tp_price_from_r

    if not sig.get("has_fvg") or np.isnan(sig.get("fvg_low", float("nan"))):
        return None

    entry_p   = sig["entry_p"]
    atr_val   = sig["atr"]
    stop_init = sig["fvg_low"] + atr_val * buf_mult
    risk      = atr_val * atr_mult

    if risk <= 0 or stop_init <= entry_p:
        return None

    tp_p = tp_price_from_r(entry_p, risk, -1, tp_r)

    return replay_trade_mfe_ladder_5m(
        df5,
        sig["ts"],
        side          = -1,        # short
        entry_price   = entry_p,
        stop_init     = stop_init,
        tp_price      = tp_p,
        risk          = risk,
        fee_bps       = fee_bps,
        stages        = stages,
        cap_lock_by_mfe = True,
        skip_entry_bucket_hours = 0.0,
    )


# ── Stats helpers ──────────────────────────────────────────────────────────

def _lock_stats(results: list) -> dict:
    """Stats broken down by exit reason: TP / BE (lock hit) / SL (FVG-LOW hit)."""
    if not results:
        return dict(n=0, win_pct=0, be_pct=0, sl_pct=0,
                    avg_r=0, total_r=0, max_dd=0, dd_per_trade=0, ann_r=0)
    pnls   = np.array([r.pnl_r for r in results])
    n      = len(pnls)
    n_tp   = sum(1 for r in results if r.reason == "TP")
    n_be   = sum(1 for r in results if r.reason == "BE")
    n_sl   = sum(1 for r in results if r.reason == "SL")
    dd     = _max_dd(pnls)
    return dict(
        n            = n,
        win_pct      = round(n_tp / n * 100, 1),   # only TP = "win"
        be_pct       = round(n_be / n * 100, 1),
        sl_pct       = round(n_sl / n * 100, 1),
        avg_r        = round(float(pnls.mean()), 4),
        total_r      = round(float(pnls.sum()), 2),
        max_dd       = round(dd, 2),
        dd_per_trade = round(dd / n, 4),
    )


def run_lock_subset(
    subset: list[dict],
    sym_df5: dict,
    atr_mult: float,
    buf_mult: float,
    tp_r: float,
    stages: list[tuple[float, float]],
) -> dict:
    results = []
    for s in subset:
        res = replay_fvg_low_with_lock(
            s, sym_df5[s["sym"]], atr_mult, buf_mult, tp_r, stages
        )
        if res:
            results.append(res)
    return _lock_stats(results), results


# ── Main ───────────────────────────────────────────────────────────────────

def main(
    db_path: str,
    atr_mult: float       = 2.0,
    vol_ratio_min: float  = 1.8,
    body_pct_min: float   = 0.55,
    close_pct_max: float  = 0.15,
    buf_mult: float       = 0.15,
    tp_r: float           = 4.25,
    start: str            = "2022-01-01",
) -> None:
    from lab.study_fvg_momentum import collect_signals, prepare_sym

    # ── Load ──────────────────────────────────────────────────────────────
    all_sigs: list[dict] = []
    sym_df5: dict[str, pd.DataFrame] = {}

    print(f"\nLoading {len(SYMS)} symbols  [{start} → latest]")
    print(f"Filters: vol>{vol_ratio_min}  body>{body_pct_min}  close<{close_pct_max}")
    print(f"Config : FVG-LOW buf×{buf_mult}  TP={tp_r}R  ATR×{atr_mult}\n")

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

    fvg_sigs = [s for s in all_sigs if s["has_fvg"]]
    n_years  = max((pd.Timestamp("today") - pd.Timestamp(start)).days / 365.25, 1)

    print(f"  Total signals : {len(all_sigs)}")
    print(f"  FVG signals   : {len(fvg_sigs)} ({len(fvg_sigs)/max(len(all_sigs),1)*100:.1f}%)")

    # ── Baseline (FVG-LOW stop, no lock) ─────────────────────────────────
    fvg_low_fn = lambda s: stop_fvg(s, buf_mult)
    std_fn     = lambda s: stop_standard(s, atr_mult)

    baseline_results = []
    for s in fvg_sigs:
        sp = fvg_low_fn(s)
        if sp is None:
            continue
        rb  = risk_std(s, atr_mult)
        res = replay_fixed_risk(s, sym_df5[s["sym"]], sp, rb, tp_r)
        if res:
            baseline_results.append(res)

    b = _lock_stats(baseline_results)
    b_ann = round(b["total_r"] / n_years, 1)
    print(f"\n  BASELINE (FVG-LOW, no lock, TP={tp_r}R):")
    print(f"    n={b['n']}  win={b['win_pct']}%  total={b['total_r']:.1f}R"
          f"  maxDD={b['max_dd']:.1f}  DD/n={b['dd_per_trade']:.3f}  "
          f"ann={b_ann}R/yr")

    # ── Section A: Single-stage sweep ─────────────────────────────────────
    # mfe triggers and lock levels
    mfe_levels  = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0]
    lock_levels = [0.0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0]

    _hdr(
        f"A — Single-stage MFE lock sweep  |  FVG-LOW stop  |  TP={tp_r}R  |  ATR×{atr_mult}",
        ["mfe_R", "lock_R", "n", "TP%", "BE%", "SL%", "avg_R",
         "total_R", "maxDD", "DD/n", "ann_R", "Δtotal"],
    )

    print(f"  {'BASELINE':>8}  {'—':>6}  {b['n']:>5}  "
          f"{b['win_pct']:>5}%  {'—':>5}  {'—':>5}  "
          f"{b['avg_r']:>7.4f}  {b['total_r']:>8.1f}  "
          f"{b['max_dd']:>7.1f}  {b['dd_per_trade']:>6.3f}  "
          f"{b_ann:>6.1f}  {'—':>7}")

    single_results = []
    for mfe_r in mfe_levels:
        for lock_r in lock_levels:
            if lock_r >= mfe_r:
                continue    # lock can't exceed trigger
            stages = [(mfe_r, lock_r)]
            st, _ = run_lock_subset(fvg_sigs, sym_df5, atr_mult, buf_mult, tp_r, stages)
            if st["n"] == 0:
                continue
            ann  = round(st["total_r"] / n_years, 1)
            dR   = round(st["total_r"] - b["total_r"], 1)
            single_results.append({
                "stages": stages, "mfe_r": mfe_r, "lock_r": lock_r, "ann_r": ann,
                **st, "delta_r": dR,
            })
            _row([f"{mfe_r}R", f"{lock_r}R", st["n"],
                  f"{st['win_pct']}%", f"{st['be_pct']}%", f"{st['sl_pct']}%",
                  f"{st['avg_r']:.4f}", f"{st['total_r']:.1f}",
                  f"{st['max_dd']:.1f}", f"{st['dd_per_trade']:.3f}",
                  f"{ann:.1f}", f"{dR:+.1f}"])

    # Best single-stage config
    if single_results:
        best_s = max(single_results, key=lambda x: x["total_r"])
        best_s_safe = sorted(
            [r for r in single_results if r["dd_per_trade"] < b["dd_per_trade"] + 0.01],
            key=lambda x: x["total_r"], reverse=True,
        )
        print(f"\n  → Best single-stage by total_R: "
              f"mfe={best_s['mfe_r']}R lock={best_s['lock_r']}R  "
              f"total={best_s['total_r']:.1f}  win={best_s['win_pct']}%  "
              f"BE={best_s['be_pct']}%  maxDD={best_s['max_dd']:.1f}  "
              f"ann={best_s['ann_r']:.1f}R/yr  Δ={best_s['delta_r']:+.1f}R")
        if best_s_safe:
            bs = best_s_safe[0]
            print(f"  → Best single-stage (DD/n ≤ baseline): "
                  f"mfe={bs['mfe_r']}R lock={bs['lock_r']}R  "
                  f"total={bs['total_r']:.1f}  win={bs['win_pct']}%  "
                  f"BE={bs['be_pct']}%  maxDD={bs['max_dd']:.1f}  "
                  f"ann={bs['ann_r']:.1f}R/yr  Δ={bs['delta_r']:+.1f}R")

    # ── Section B: Two-stage sweep ─────────────────────────────────────────
    # Build candidates from top single-stage results + systematic pairs
    # Stage 1: early soft lock (BE or small profit)
    # Stage 2: higher lock
    two_stage_configs = []

    # Add top single-stage combos as candidates for stage 2 extension
    top_singles = sorted(single_results, key=lambda x: x["total_r"], reverse=True)[:8]
    for s1 in top_singles:
        mfe1, lock1 = s1["mfe_r"], s1["lock_r"]
        for mfe2 in [mfe1 + 0.5, mfe1 + 1.0, mfe1 + 1.5]:
            for lock2 in [lock1 + 0.25, lock1 + 0.5, mfe2 - 0.25]:
                if lock2 >= mfe2 or mfe2 > tp_r or lock2 < 0:
                    continue
                if abs(mfe2 - mfe1) < 0.1:
                    continue
                two_stage_configs.append([(mfe1, lock1), (mfe2, lock2)])

    # Also add a few hand-picked systematic two-stage ladders
    systematic = [
        [(0.5, 0.0), (1.5, 1.0)],
        [(0.5, 0.0), (2.0, 1.5)],
        [(0.5, 0.0), (2.5, 2.0)],
        [(1.0, 0.0), (2.0, 1.0)],
        [(1.0, 0.0), (2.5, 1.5)],
        [(1.0, 0.5), (2.5, 2.0)],
        [(1.0, 0.5), (2.0, 1.5)],
        [(1.5, 1.0), (3.0, 2.5)],
        [(1.5, 1.0), (2.5, 2.0)],
        [(0.75, 0.0), (1.5, 1.0)],
        [(0.75, 0.25), (2.0, 1.5)],
    ]
    # Deduplicate
    seen = set()
    all_two = []
    for cfg in two_stage_configs + systematic:
        key = tuple(sorted([(round(a, 4), round(b, 4)) for a, b in cfg]))
        if key not in seen:
            seen.add(key)
            all_two.append(cfg)

    _hdr(
        f"B — Two-stage MFE lock sweep  |  FVG-LOW stop  |  TP={tp_r}R",
        ["s1:mfe→lock", "s2:mfe→lock", "n", "TP%", "BE%", "SL%", "avg_R",
         "total_R", "maxDD", "DD/n", "ann_R", "Δtotal"],
    )

    two_results = []
    for stages in all_two:
        # validate stages are strictly increasing mfe
        mfes = [s[0] for s in stages]
        if any(mfes[i] >= mfes[i+1] for i in range(len(mfes)-1)):
            continue
        st, _ = run_lock_subset(fvg_sigs, sym_df5, atr_mult, buf_mult, tp_r, stages)
        if st["n"] == 0:
            continue
        ann = round(st["total_r"] / n_years, 1)
        dR  = round(st["total_r"] - b["total_r"], 1)
        two_results.append({
            "stages": stages, "ann_r": ann, **st, "delta_r": dR,
        })
        s_label = "→".join(f"{m}R→{l}R" for m, l in stages)
        parts   = s_label.split("→")
        s1_lbl  = "→".join(parts[:2])
        s2_lbl  = "→".join(parts[2:])
        _row([s1_lbl, s2_lbl, st["n"],
              f"{st['win_pct']}%", f"{st['be_pct']}%", f"{st['sl_pct']}%",
              f"{st['avg_r']:.4f}", f"{st['total_r']:.1f}",
              f"{st['max_dd']:.1f}", f"{st['dd_per_trade']:.3f}",
              f"{ann:.1f}", f"{dR:+.1f}"])

    if two_results:
        best_2 = max(two_results, key=lambda x: x["total_r"])
        print(f"\n  → Best two-stage by total_R: "
              f"{best_2['stages']}  total={best_2['total_r']:.1f}  "
              f"win={best_2['win_pct']}%  BE={best_2['be_pct']}%  "
              f"maxDD={best_2['max_dd']:.1f}  ann={best_2['ann_r']:.1f}R/yr  "
              f"Δ={best_2['delta_r']:+.1f}R")

    # ── Identify overall best config for sections C & D ───────────────────
    all_configs = single_results + two_results
    best_overall = max(all_configs, key=lambda x: x["total_r"]) if all_configs else None
    best_safe    = max(
        [r for r in all_configs if r["dd_per_trade"] <= b["dd_per_trade"] + 0.005],
        key=lambda x: x["total_r"],
        default=None,
    )

    chosen = best_safe or best_overall
    if chosen is None:
        print("\n  No valid configs found.")
        return

    print(f"\n  → Chosen config for C/D: stages={chosen['stages']}  "
          f"total={chosen['total_r']:.1f}  maxDD={chosen['max_dd']:.1f}  "
          f"ann={chosen['ann_r']:.1f}R/yr")

    # ── Section C: Year breakdown — best config vs baseline ───────────────
    _hdr(
        f"C — Year breakdown  |  best lock {chosen['stages']}  vs  no-lock baseline  |  TP={tp_r}R",
        ["year", "n", "lock_win%", "lock_R", "base_R", "Δ_R", "lock_DD"],
    )

    yr_lock: dict[int, list] = defaultdict(list)
    yr_base: dict[int, list] = defaultdict(list)

    for s in fvg_sigs:
        rb   = s["atr"] * atr_mult
        df5  = sym_df5[s["sym"]]
        sp_f = stop_fvg(s, buf_mult)
        if sp_f is None:
            continue
        from lab.sim.entry import tp_price_from_r
        tp_p = tp_price_from_r(s["entry_p"], rb, -1, tp_r)

        res_lock = replay_trade_mfe_ladder_5m(
            df5, s["ts"], -1, s["entry_p"], sp_f, tp_p, rb, 3.0,
            stages=chosen["stages"], cap_lock_by_mfe=True,
            skip_entry_bucket_hours=0.0,
        )
        res_base = replay_fixed_risk(s, df5, sp_f, rb, tp_r)

        yr = s["year"]
        if res_lock:
            yr_lock[yr].append(res_lock.pnl_r)
        if res_base:
            yr_base[yr].append(res_base.pnl_r)

    for yr in YEARS:
        rl = np.array(yr_lock.get(yr, []))
        rb_arr = np.array(yr_base.get(yr, []))
        dR = round(rl.sum() - rb_arr.sum(), 2) if len(rl) and len(rb_arr) else 0.0
        if len(rl) == 0:
            _row([yr, 0, "—", "—", "—", "—", "—"])
        else:
            _row([yr, len(rl),
                  f"{(rl > 0).mean()*100:.1f}%",
                  f"{rl.sum():.1f}",
                  f"{rb_arr.sum():.1f}" if len(rb_arr) else "—",
                  f"{dR:+.2f}",
                  f"{_max_dd(rl):.1f}"])

    # ── Section D: Per-symbol ─────────────────────────────────────────────
    _hdr(
        f"D — Per-symbol  |  best lock {chosen['stages']}  vs  no-lock  |  TP={tp_r}R",
        ["sym", "n", "lock_win%", "lock_BE%", "lock_SL%",
         "lock_R", "base_R", "Δ_R", "lock_DD"],
    )
    for sym in SYMS:
        sub = [s for s in fvg_sigs if s["sym"] == sym]
        st_lock, res_lock_list = run_lock_subset(
            sub, sym_df5, atr_mult, buf_mult, tp_r, chosen["stages"]
        )
        # baseline for this symbol
        base_results = []
        for s in sub:
            sp = stop_fvg(s, buf_mult)
            if sp is None:
                continue
            rb = risk_std(s, atr_mult)
            res = replay_fixed_risk(s, sym_df5[s["sym"]], sp, rb, tp_r)
            if res:
                base_results.append(res)
        base_pnl = sum(r.pnl_r for r in base_results) if base_results else 0.0
        dR = round(st_lock["total_r"] - base_pnl, 2)
        _row([sym, len(sub),
              f"{st_lock['win_pct']}%", f"{st_lock['be_pct']}%",
              f"{st_lock['sl_pct']}%",
              f"{st_lock['total_r']:.1f}",
              f"{base_pnl:.1f}",
              f"{dR:+.2f}",
              f"{st_lock['max_dd']:.1f}"])

    # ── Save ──────────────────────────────────────────────────────────────
    rows_out = []
    for cfg in all_configs:
        rows_out.append({
            "stages":    str(cfg["stages"]),
            "n_stages":  len(cfg["stages"]),
            "mfe1":      cfg["stages"][0][0],
            "lock1":     cfg["stages"][0][1],
            "n":         cfg["n"],
            "win_pct":   cfg["win_pct"],
            "be_pct":    cfg["be_pct"],
            "sl_pct":    cfg["sl_pct"],
            "avg_r":     cfg["avg_r"],
            "total_r":   cfg["total_r"],
            "max_dd":    cfg["max_dd"],
            "dd_per_trade": cfg["dd_per_trade"],
            "ann_r":     cfg["ann_r"],
            "delta_r":   cfg["delta_r"],
        })
    out = REPO_ROOT / "cache" / "fvg_lock_sweep.csv"
    out.parent.mkdir(exist_ok=True)
    pd.DataFrame(rows_out).to_csv(out, index=False)
    print(f"\nSaved → {out}\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db",        default=DEFAULT_DB)
    ap.add_argument("--start",     default="2022-01-01")
    ap.add_argument("--atr-mult",  type=float, default=2.0)
    ap.add_argument("--vol-ratio", type=float, default=1.8)
    ap.add_argument("--body-pct",  type=float, default=0.55)
    ap.add_argument("--close-pct", type=float, default=0.15)
    ap.add_argument("--buf",       type=float, default=0.15)
    ap.add_argument("--tp",        type=float, default=4.25)
    args = ap.parse_args()

    print("=" * 72)
    print("FVG + FVG-LOW stop — MAE/MFE profit-lock sweep")
    print("=" * 72)
    main(
        db_path       = args.db,
        atr_mult      = args.atr_mult,
        vol_ratio_min = args.vol_ratio,
        body_pct_min  = args.body_pct,
        close_pct_max = args.close_pct,
        buf_mult      = args.buf,
        tp_r          = args.tp,
        start         = args.start,
    )
