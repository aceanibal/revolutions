#!/usr/bin/env python3
"""
Strict Order Block Study — Two ICT-precise OB definitions
==========================================================

Builds on study_order_blocks.py findings:
  - Loose OB (last bullish in 10 bars) = 99% presence → useless as filter
  - FVG is the real filter (21% presence, 31%+ win rate vs 24%)
  - FVG-STOP saves ~26R by exiting at gap bottom instead of full ATR stop

This study tests two STRICT OB definitions that require the OB to have a
direct geometric relationship with the FVG zone:

  Option 1 — OB-CREATOR
    Bar i-2 is bullish (close > open).
    This is the candle whose LOW forms the FVG TOP (low[i-2] = fvg_high).
    It is the last bull candle before the two-bar run that created the gap.
    OB zone: body = [open[i-2], close[i-2]], full = [low[i-2], high[i-2]]
    Prevalence: expected ~50% (roughly half of i-2 bars will be bullish)

  Option 2 — OB-DELIVERY
    The last bullish candle before bar i whose close falls inside the FVG zone.
      fvg_low  <= close[j] <= fvg_high
    That candle "delivered" price into the exact zone that became the gap.
    The FVG is the imprint of that delivery — price was there and left.
    Prevalence: expected ~10-25% (rare, high-quality confluence)

Stop progression (all use same ATR×mult risk basis → same TP price):
  STD      : stop = entry + ATR × atr_mult              (widest)
  FVG-HIGH : stop = fvg_high + ATR × buf                (FVG fully filled)
  FVG-LOW  : stop = fvg_low  + ATR × buf                (gap bottom touched)

Sections:
  A. Coverage: how many FVG signals have OB-creator / OB-delivery?
  B. Quality filter: does OB-creator or OB-delivery improve win rate?
  C. Stop progression R-saved: STD vs FVG-HIGH vs FVG-LOW (TP sweep)
  D. Combined: OB-delivery + FVG-LOW (strongest confluence + tightest stop)
  E. Year breakdown for best combo
  F. Per-symbol for best combo

Usage:
    python lab/study_ob_strict.py
    python lab/study_ob_strict.py --start 2024-01-01 --tp-sweep 3.0 4.0 4.2
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

from lab.study_order_blocks import (
    DEFAULT_DB,
    SYMS,
    YEARS,
    _hdr,
    _max_consec_loss,
    _max_dd,
    _row,
    _stats,
    _stats_from_results,
    prepare_sym,
    replay_fixed_risk,
    risk_std,
    stop_standard,
)


# ── Strict OB detectors ────────────────────────────────────────────────────

def ob_creator(df1h: pd.DataFrame, signal_idx: int, min_body: float = 0.0) -> dict | None:
    """
    Option 1: OB = bar i-2 is bullish.
    This is the candle whose low IS the FVG top (low[i-2] = fvg_high).
    Requires the FVG to already be confirmed (high[i] < low[i-2]).

    Returns OB dict or None if bar i-2 is not bullish.
    """
    i = signal_idx
    if i < 2:
        return None
    op = df1h["open"].values
    cl = df1h["close"].values
    hi = df1h["high"].values
    lo = df1h["low"].values
    j  = i - 2  # the candle whose low = fvg_high

    if cl[j] <= op[j]:   # not bullish
        return None
    rng = hi[j] - lo[j]
    if rng < 1e-12:
        return None
    body = (cl[j] - op[j]) / rng
    if body < min_body:
        return None

    return {
        "ob_idx":      j,
        "ob_open":     float(op[j]),
        "ob_close":    float(cl[j]),
        "ob_high":     float(hi[j]),
        "ob_low":      float(lo[j]),   # == fvg_high for the FVG
        "ob_body_pct": round(body, 3),
        "ob_age":      2,
        "ob_type":     "creator",
    }


def ob_delivery(
    df1h: pd.DataFrame,
    signal_idx: int,
    fvg_low: float,
    fvg_high: float,
    lookback: int = 5,
    min_body: float = 0.0,
) -> dict | None:
    """
    Option 2: OB = last bullish candle with close inside FVG zone.
    close[j] ∈ [fvg_low, fvg_high] — that candle delivered price into the gap.

    Searches back up to `lookback` bars before signal_idx.
    Returns first match (most recent) or None.
    """
    i   = signal_idx
    op  = df1h["open"].values
    cl  = df1h["close"].values
    hi  = df1h["high"].values
    lo  = df1h["low"].values
    end = max(0, i - lookback - 1)

    for j in range(i - 1, end, -1):
        if cl[j] <= op[j]:           # must be bullish
            continue
        if not (fvg_low <= cl[j] <= fvg_high):  # close in FVG zone
            continue
        rng  = hi[j] - lo[j]
        body = (cl[j] - op[j]) / rng if rng > 1e-12 else 0.0
        if body < min_body:
            continue
        return {
            "ob_idx":      j,
            "ob_open":     float(op[j]),
            "ob_close":    float(cl[j]),
            "ob_high":     float(hi[j]),
            "ob_low":      float(lo[j]),
            "ob_body_pct": round(body, 3),
            "ob_age":      i - j,
            "ob_type":     "delivery",
        }
    return None


# ── Signal collector (FVG + strict OBs) ───────────────────────────────────

def collect_signals(
    df1h: pd.DataFrame,
    sym: str,
    vol_ratio_min: float = 1.8,
    body_pct_min: float  = 0.55,
    close_pct_max: float = 0.15,
    ob_lookback: int     = 5,
    ob_min_body: float   = 0.0,
) -> list[dict]:
    """
    Momentum short signals with FVG + both strict OB tags.
    Only FVG-tagged signals carry meaningful OB data.
    """
    hi_arr = df1h["high"].values
    lo_arr = df1h["low"].values
    n      = len(df1h)
    sigs   = []
    min_idx = 62

    for i in range(min_idx, n - 1):
        row = df1h.iloc[i]
        if pd.isna(row.get("atr")) or pd.isna(row.get("vol_q")):
            continue
        if row["structure"] != "BALANCED":
            continue
        if row["vol_q"] != "HIGH":
            continue
        if not (row.get("close_pct", 1.0) < close_pct_max):
            continue
        if not (row["close"] < row["open"]):
            continue
        if not (row.get("vol_ratio", 0.0) > vol_ratio_min):
            continue
        if not (row.get("body_pct", 0.0) > body_pct_min):
            continue

        entry_bar = df1h.iloc[i + 1]
        if pd.isna(entry_bar["open"]):
            continue

        entry_p = float(entry_bar["open"])
        atr_val = float(row["atr"])

        # ── FVG (required for strict OB analysis) ─────────────────────────
        has_fvg  = False
        fvg_low  = np.nan
        fvg_high = np.nan

        if i >= 2 and hi_arr[i] < lo_arr[i - 2]:
            fl = float(hi_arr[i])
            fh = float(lo_arr[i - 2])
            if fl > entry_p:
                has_fvg  = True
                fvg_low  = fl
                fvg_high = fh

        # ── Strict OBs (only meaningful when FVG exists) ──────────────────
        obc = ob_creator( df1h, i, min_body=ob_min_body)            if has_fvg else None
        obd = ob_delivery(df1h, i, fvg_low, fvg_high,               # type: ignore[arg-type]
                          lookback=ob_lookback,
                          min_body=ob_min_body)                     if has_fvg else None

        sigs.append({
            "ts":          df1h.index[i + 1],
            "year":        df1h.index[i + 1].year,
            "sym":         sym,
            "sig_idx":     i,
            "entry_p":     entry_p,
            "atr":         atr_val,
            # FVG
            "has_fvg":     has_fvg,
            "fvg_low":     fvg_low,
            "fvg_high":    fvg_high,
            # OB-CREATOR (bar i-2 bullish)
            "has_creator": obc is not None,
            "creator_high":float(obc["ob_high"])  if obc else np.nan,
            "creator_low": float(obc["ob_low"])   if obc else np.nan,  # == fvg_high
            # OB-DELIVERY (bullish close inside FVG zone)
            "has_delivery":obd is not None,
            "delivery_high":float(obd["ob_high"]) if obd else np.nan,
            "delivery_low": float(obd["ob_low"])  if obd else np.nan,
            "delivery_age": int(obd["ob_age"])    if obd else -1,
        })

    return sigs


# ── Stop helpers ───────────────────────────────────────────────────────────

def stop_fvg_low(sig: dict, buf: float = 0.15) -> float | None:
    """Tightest: just above FVG bottom. Exit if gap even lightly touched."""
    if not sig["has_fvg"] or np.isnan(sig["fvg_low"]):
        return None
    return sig["fvg_low"] + sig["atr"] * buf


def stop_fvg_high(sig: dict, buf: float = 0.15) -> float | None:
    """Middle: just above FVG top. Exit if price travels through the whole gap."""
    if not sig["has_fvg"] or np.isnan(sig["fvg_high"]):
        return None
    sp = sig["fvg_high"] + sig["atr"] * buf
    # Only use if this is tighter than (or equal to) the standard stop
    sp_std = stop_standard(sig, 2.0)  # reference; overridden by caller
    return sp


def stop_creator(sig: dict, buf: float = 0.15) -> float | None:
    """Above OB-creator high (bar i-2 high). Widest strict OB stop."""
    if not sig["has_creator"] or np.isnan(sig["creator_high"]):
        return None
    return sig["creator_high"] + sig["atr"] * buf


def stop_delivery(sig: dict, buf: float = 0.15) -> float | None:
    """Above OB-delivery candle high. Exits if OB invalidated."""
    if not sig["has_delivery"] or np.isnan(sig["delivery_high"]):
        return None
    return sig["delivery_high"] + sig["atr"] * buf


# ── R-saved helper ─────────────────────────────────────────────────────────

def r_saved_report(
    subset: list[dict],
    sym_df5: dict,
    atr_mult: float,
    tight_stop_fn,
    tp_r: float,
    fee_bps: float = 3.0,
) -> dict:
    """
    Per-trade comparison: tight stop vs standard stop.
    Both use the same risk_basis (ATR×atr_mult) → same TP price.
    Measures actual R saved when tight stop fires before standard.
    """
    n_tp = n_sl_tight = n_sl_std = 0
    losses_std: list[float] = []
    losses_tight: list[float] = []
    r_savings: list[float] = []
    pnls_std: list[float] = []
    pnls_tight: list[float] = []

    for s in subset:
        sp_tight = tight_stop_fn(s)
        if sp_tight is None:
            continue
        sp_std = stop_standard(s, atr_mult)
        rb     = risk_std(s, atr_mult)
        df5    = sym_df5[s["sym"]]

        res_s = replay_fixed_risk(s, df5, sp_std,   rb, tp_r, fee_bps)
        res_t = replay_fixed_risk(s, df5, sp_tight, rb, tp_r, fee_bps)
        if res_s is None or res_t is None:
            continue

        pnls_std.append(res_s.pnl_r)
        pnls_tight.append(res_t.pnl_r)

        if res_s.reason == "TP":
            n_tp += 1
        elif res_t.pnl_r > res_s.pnl_r + 1e-6:
            n_sl_tight += 1
            losses_std.append(res_s.pnl_r)
            losses_tight.append(res_t.pnl_r)
            r_savings.append(res_t.pnl_r - res_s.pnl_r)
        else:
            n_sl_std += 1
            losses_std.append(res_s.pnl_r)
            losses_tight.append(res_t.pnl_r)

    n_tot       = n_tp + n_sl_tight + n_sl_std
    std_loss_sum = abs(sum(l for l in pnls_std if l < 0))
    tot_sav      = float(np.sum(r_savings))

    return dict(
        n              = n_tot,
        n_tp           = n_tp,
        n_sl_tight     = n_sl_tight,
        n_sl_std       = n_sl_std,
        tight_pct      = round(n_sl_tight / max(n_sl_tight + n_sl_std, 1) * 100, 1),
        avg_loss_std   = round(float(np.mean(losses_std))   if losses_std  else 0.0, 4),
        avg_loss_tight = round(float(np.mean(losses_tight)) if losses_tight else 0.0, 4),
        r_per_exit     = round(float(np.mean(r_savings))    if r_savings   else 0.0, 4),
        total_r_saved  = round(tot_sav, 2),
        total_r_std    = round(float(np.sum(pnls_std)),  2),
        total_r_tight  = round(float(np.sum(pnls_tight)), 2),
        saved_pct      = round(tot_sav / std_loss_sum * 100, 1) if std_loss_sum > 0 else 0.0,
    )


def run_subset_stats(
    subset: list[dict],
    sym_df5: dict,
    atr_mult: float,
    stop_fn,
    tp_r: float,
    fee_bps: float = 3.0,
) -> dict:
    results = []
    for s in subset:
        sp = stop_fn(s)
        if sp is None:
            continue
        rb  = risk_std(s, atr_mult)
        res = replay_fixed_risk(s, sym_df5[s["sym"]], sp, rb, tp_r, fee_bps)
        if res:
            results.append(res)
    return _stats_from_results(results)


# ── Main ───────────────────────────────────────────────────────────────────

def main(
    db_path: str,
    atr_mult: float       = 2.0,
    tp_sweep: list[float] = None,
    vol_ratio_min: float  = 1.8,
    body_pct_min: float   = 0.55,
    close_pct_max: float  = 0.15,
    ob_lookback: int      = 5,
    buf_mult: float       = 0.15,
    start: str            = "2022-01-01",
) -> None:
    if tp_sweep is None:
        tp_sweep = [3.0, 4.0, 4.2]

    # ── Load ──────────────────────────────────────────────────────────────
    all_sigs: list[dict] = []
    sym_df5: dict[str, pd.DataFrame] = {}

    print(f"\nLoading {len(SYMS)} symbols  [{start} → latest]")
    print(f"Filters: vol>{vol_ratio_min}  body>{body_pct_min}  close<{close_pct_max}")
    print(f"OB delivery lookback: {ob_lookback} bars\n")

    for sym in SYMS:
        df5, df1h = prepare_sym(db_path, sym, start)
        sym_df5[sym] = df5
        sigs = collect_signals(
            df1h, sym,
            vol_ratio_min=vol_ratio_min,
            body_pct_min=body_pct_min,
            close_pct_max=close_pct_max,
            ob_lookback=ob_lookback,
        )
        sigs_fvg  = [s for s in sigs if s["has_fvg"]]
        n_cre  = sum(1 for s in sigs_fvg if s["has_creator"])
        n_del  = sum(1 for s in sigs_fvg if s["has_delivery"])
        nf     = max(len(sigs_fvg), 1)
        print(f"  {sym:<12}  total:{len(sigs):>3}  fvg:{len(sigs_fvg):>3}  "
              f"creator:{n_cre:>3}({n_cre/nf*100:.0f}%)  "
              f"delivery:{n_del:>3}({n_del/nf*100:.0f}%)")
        all_sigs.extend(sigs)

    fvg_sigs  = [s for s in all_sigs if s["has_fvg"]]
    cre_sigs  = [s for s in fvg_sigs  if s["has_creator"]]
    del_sigs  = [s for s in fvg_sigs  if s["has_delivery"]]
    both_sigs = [s for s in fvg_sigs  if s["has_creator"] and s["has_delivery"]]

    n_fvg = len(fvg_sigs)
    print(f"\n  TOTAL  all:{len(all_sigs)}  fvg:{n_fvg}  "
          f"creator:{len(cre_sigs)}({len(cre_sigs)/max(n_fvg,1)*100:.0f}%)  "
          f"delivery:{len(del_sigs)}({len(del_sigs)/max(n_fvg,1)*100:.0f}%)  "
          f"both:{len(both_sigs)}({len(both_sigs)/max(n_fvg,1)*100:.0f}%)")

    # Best TP from sweep on FVG signals, standard stop
    std_fn = lambda s: stop_standard(s, atr_mult)
    best_tp = max(
        tp_sweep,
        key=lambda tp: run_subset_stats(fvg_sigs, sym_df5, atr_mult, std_fn, tp)["total_r"],
    )
    print(f"\n  Best TP (FVG+STANDARD): {best_tp}R\n")

    # ── SECTION A: Coverage breakdown ─────────────────────────────────────
    _hdr("A — Strict OB coverage within FVG signals", ["subset", "n", "pct_of_fvg"])
    for label, subset in [
        ("FVG (all)",         fvg_sigs),
        ("OB-CREATOR",        cre_sigs),
        ("OB-DELIVERY",       del_sigs),
        ("CREATOR+DELIVERY",  both_sigs),
    ]:
        pct = len(subset) / max(n_fvg, 1) * 100
        _row([label, len(subset), f"{pct:.1f}%"])

    # OB-delivery age distribution
    print("\n  OB-DELIVERY age (bars from OB to signal):")
    for age in [1, 2, 3, 4, 5]:
        n = sum(1 for s in del_sigs if s["delivery_age"] == age)
        print(f"    age={age}: {n}")

    # ── SECTION B: Quality filter — does strict OB improve win rate? ───────
    _hdr(
        f"B — Signal quality  |  ATR×{atr_mult} STANDARD stop  |  TP={best_tp}R",
        ["subset", "n", "win%", "SL%", "avg_R", "total_R", "maxDD", "DD/n", "MCL"],
    )
    for label, subset in [
        ("FVG (baseline)",    fvg_sigs),
        ("FVG+CREATOR",       cre_sigs),
        ("FVG+DELIVERY",      del_sigs),
        ("FVG+BOTH",          both_sigs),
        ("FVG (no creator)",  [s for s in fvg_sigs if not s["has_creator"]]),
        ("FVG (no delivery)", [s for s in fvg_sigs if not s["has_delivery"]]),
    ]:
        st = run_subset_stats(subset, sym_df5, atr_mult, std_fn, best_tp)
        _row([label, st["n"], f"{st['win_pct']}%", f"{st.get('sl_hit_pct',0)}%",
              f"{st['avg_r']:.4f}", f"{st['total_r']:.1f}",
              f"{st['max_dd']:.1f}", f"{st['dd_per_trade']:.3f}", st.get("mcl","—")])

    # ── SECTION C: Stop progression R-saved — same TP, FVG signals ────────
    # Three stops in order from tight to wide:
    #   FVG-LOW  : exits at gap bottom touch
    #   FVG-HIGH : exits only when gap fully filled (price through whole zone)
    #   STANDARD : exits at ATR×mult (baseline)
    _hdr(
        f"C — Stop progression R-saved  |  FVG signals  |  TP sweep\n"
        f"  All modes use SAME risk basis (ATR×{atr_mult}) = SAME TP price\n"
        f"  Columns: n_tp / n_sl_tight / n_sl_std / tight_hit% / "
        f"avgL_std / avgL_tight / R/exit / tot_R_saved / saved%",
        ["stop", "TP", "n_tp", "n_sl_t", "n_sl_s", "tight%",
         "avgL_s", "avgL_t", "R/exit", "totSaved", "saved%"],
    )
    for tp_r in tp_sweep:
        for stop_label, sfn in [
            ("FVG-LOW",  lambda s: stop_fvg_low(s,  buf_mult)),
            ("FVG-HIGH", lambda s: stop_fvg_high(s, buf_mult)),
        ]:
            rpt = r_saved_report(fvg_sigs, sym_df5, atr_mult, sfn, tp_r)
            _row([stop_label, f"{tp_r}R",
                  rpt["n_tp"], rpt["n_sl_tight"], rpt["n_sl_std"],
                  f"{rpt['tight_pct']}%",
                  f"{rpt['avg_loss_std']:.3f}", f"{rpt['avg_loss_tight']:.3f}",
                  f"{rpt['r_per_exit']:.4f}", f"{rpt['total_r_saved']:.2f}",
                  f"{rpt['saved_pct']}%"])
        print()

    # ── SECTION D: Delivery OB as stop ────────────────────────────────────
    # OB-delivery candle high is a very specific invalidation level:
    # if price clears the candle that delivered INTO the gap, structure is broken
    _hdr(
        f"D — OB-DELIVERY as stop  |  FVG+DELIVERY signals  |  TP sweep",
        ["stop", "TP", "n_tp", "n_sl_t", "n_sl_s", "tight%",
         "avgL_s", "avgL_t", "R/exit", "totSaved", "saved%"],
    )
    for tp_r in tp_sweep:
        for stop_label, sfn in [
            ("FVG-LOW",      lambda s: stop_fvg_low(s, buf_mult)),
            ("DELIVERY-OB",  lambda s: stop_delivery(s, buf_mult)),
        ]:
            rpt = r_saved_report(del_sigs, sym_df5, atr_mult, sfn, tp_r)
            _row([stop_label, f"{tp_r}R",
                  rpt["n_tp"], rpt["n_sl_tight"], rpt["n_sl_std"],
                  f"{rpt['tight_pct']}%",
                  f"{rpt['avg_loss_std']:.3f}", f"{rpt['avg_loss_tight']:.3f}",
                  f"{rpt['r_per_exit']:.4f}", f"{rpt['total_r_saved']:.2f}",
                  f"{rpt['saved_pct']}%"])
        print()

    # ── SECTION E: Best combo total R comparison ───────────────────────────
    _hdr(
        f"E — Total R comparison  |  all FVG subsets × stop modes  |  TP={best_tp}R",
        ["subset", "stop", "n", "win%", "total_R", "maxDD", "DD/n"],
    )
    combos = [
        ("FVG",          fvg_sigs,  "STANDARD", std_fn),
        ("FVG",          fvg_sigs,  "FVG-LOW",  lambda s: stop_fvg_low(s,  buf_mult)),
        ("FVG",          fvg_sigs,  "FVG-HIGH", lambda s: stop_fvg_high(s, buf_mult)),
        ("FVG+CREATOR",  cre_sigs,  "STANDARD", std_fn),
        ("FVG+CREATOR",  cre_sigs,  "FVG-LOW",  lambda s: stop_fvg_low(s,  buf_mult)),
        ("FVG+DELIVERY", del_sigs,  "STANDARD", std_fn),
        ("FVG+DELIVERY", del_sigs,  "FVG-LOW",  lambda s: stop_fvg_low(s,  buf_mult)),
        ("FVG+DELIVERY", del_sigs,  "DELIVERY", lambda s: stop_delivery(s, buf_mult)),
        ("FVG+BOTH",     both_sigs, "STANDARD", std_fn),
        ("FVG+BOTH",     both_sigs, "FVG-LOW",  lambda s: stop_fvg_low(s,  buf_mult)),
    ]
    for sub_label, subset, stop_label, sfn in combos:
        st = run_subset_stats(subset, sym_df5, atr_mult, sfn, best_tp)
        _row([sub_label, stop_label, st["n"], f"{st['win_pct']}%",
              f"{st['total_r']:.1f}", f"{st['max_dd']:.1f}",
              f"{st['dd_per_trade']:.3f}"])

    # ── SECTION F: Year breakdown for best subset+stop ─────────────────────
    # Find best combo from E (highest total_r per-trade)
    best_label = "FVG+DELIVERY / FVG-LOW"  # hypothesis; print both
    _hdr(
        f"F — Year breakdown  |  FVG+DELIVERY, FVG-LOW stop  vs  FVG baseline, STANDARD  |  TP={best_tp}R",
        ["year", "n_base", "base_win%", "base_R", "n_del", "del_win%", "del_R"],
    )
    yr_base: dict[int, list] = defaultdict(list)
    yr_del:  dict[int, list] = defaultdict(list)

    fvg_low_fn = lambda s: stop_fvg_low(s, buf_mult)

    for s in fvg_sigs:
        rb  = risk_std(s, atr_mult)
        df5 = sym_df5[s["sym"]]
        res = replay_fixed_risk(s, df5, stop_standard(s, atr_mult), rb, best_tp)
        if res:
            yr_base[s["year"]].append(res.pnl_r)

    for s in del_sigs:
        rb  = risk_std(s, atr_mult)
        df5 = sym_df5[s["sym"]]
        sp  = fvg_low_fn(s)
        if sp is None:
            continue
        res = replay_fixed_risk(s, df5, sp, rb, best_tp)
        if res:
            yr_del[s["year"]].append(res.pnl_r)

    for yr in YEARS:
        rb_arr = np.array(yr_base.get(yr, []))
        rd_arr = np.array(yr_del.get(yr, []))
        bw = f"{(rb_arr>0).mean()*100:.1f}%" if len(rb_arr) else "—"
        dw = f"{(rd_arr>0).mean()*100:.1f}%" if len(rd_arr) else "—"
        _row([yr,
              len(rb_arr), bw, f"{rb_arr.sum():.1f}" if len(rb_arr) else "—",
              len(rd_arr), dw, f"{rd_arr.sum():.1f}" if len(rd_arr) else "—"])

    # ── SECTION G: Per-symbol ─────────────────────────────────────────────
    _hdr(
        f"G — Per-symbol  |  FVG+DELIVERY, FVG-LOW  vs  FVG baseline, STANDARD  |  TP={best_tp}R",
        ["sym", "base_n", "base_win%", "base_R", "del_n", "del_win%", "del_R", "R_delta"],
    )
    for sym in SYMS:
        sub_base = [s for s in fvg_sigs if s["sym"] == sym]
        sub_del  = [s for s in del_sigs  if s["sym"] == sym]
        st_base  = run_subset_stats(sub_base, sym_df5, atr_mult, std_fn,      best_tp)
        st_del   = run_subset_stats(sub_del,  sym_df5, atr_mult, fvg_low_fn,  best_tp)
        delta    = round(st_del["total_r"] - st_base["total_r"], 2)
        _row([sym,
              st_base["n"], f"{st_base['win_pct']}%", f"{st_base['total_r']:.1f}",
              st_del["n"],  f"{st_del['win_pct']}%",  f"{st_del['total_r']:.1f}",
              f"{delta:+.2f}"])

    # ── Save ──────────────────────────────────────────────────────────────
    rows = []
    for sub_label, subset in [
        ("fvg",      fvg_sigs),
        ("creator",  cre_sigs),
        ("delivery", del_sigs),
        ("both",     both_sigs),
    ]:
        for tp_r in tp_sweep:
            for stop_label, sfn in [
                ("standard",  std_fn),
                ("fvg_low",   lambda s: stop_fvg_low(s,  buf_mult)),
                ("fvg_high",  lambda s: stop_fvg_high(s, buf_mult)),
                ("delivery",  lambda s: stop_delivery(s, buf_mult)),
            ]:
                st = run_subset_stats(subset, sym_df5, atr_mult, sfn, tp_r)
                rows.append({"subset": sub_label, "stop": stop_label,
                             "tp": tp_r, **st})

    out = REPO_ROOT / "cache" / "ob_strict_study.csv"
    out.parent.mkdir(exist_ok=True)
    pd.DataFrame(rows).to_csv(out, index=False)
    print(f"\nSaved → {out}\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db",           default=DEFAULT_DB)
    ap.add_argument("--start",        default="2022-01-01")
    ap.add_argument("--atr-mult",     type=float, default=2.0)
    ap.add_argument("--tp-sweep",     nargs="+",  type=float, default=[3.0, 4.0, 4.2])
    ap.add_argument("--vol-ratio",    type=float, default=1.8)
    ap.add_argument("--body-pct",     type=float, default=0.55)
    ap.add_argument("--close-pct",    type=float, default=0.15)
    ap.add_argument("--ob-lookback",  type=int,   default=5,
                    help="Bars back to search for OB-DELIVERY candle")
    ap.add_argument("--buf",          type=float, default=0.15,
                    help="ATR buffer added above stop reference price")
    args = ap.parse_args()

    print("=" * 72)
    print("Strict Order Block Study — OB-Creator & OB-Delivery")
    print("=" * 72)

    main(
        db_path       = args.db,
        atr_mult      = args.atr_mult,
        tp_sweep      = args.tp_sweep,
        vol_ratio_min = args.vol_ratio,
        body_pct_min  = args.body_pct,
        close_pct_max = args.close_pct,
        ob_lookback   = args.ob_lookback,
        buf_mult      = args.buf,
        start         = args.start,
    )
