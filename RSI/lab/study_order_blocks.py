#!/usr/bin/env python3
"""
Order Block + FVG + Momentum Short Study
=========================================

Concept
-------
Our momentum signal (bar i) IS the bearish displacement.
Before that displacement, institutional sellers loaded orders — the last
bullish body candle before the move is the "Bearish Order Block" (OB).

  Bearish OB at bar j (j < i, most-recent bullish body):
    Condition : close[j] > open[j]  AND  body_pct[j] > min_body
    Zone      : [open[j], close[j]]  — body of the last bull candle
    ob_top    = close[j]   ← top of OB body  (stop reference)
    ob_high   = high[j]    ← full candle high (invalidation level)

  When price returns to the OB zone, remaining sell orders are being filled.
  If price clears ob_high, the OB is fully mitigated → short thesis dead.

Bearish FVG at bar i (same as study_fvg_momentum.py):
    Condition : high[i] < low[i-2]
    fvg_low   = high[i]   ← bottom of gap (nearest to entry)
    fvg_high  = low[i-2]  ← top of gap

Confluence: BOTH OB and FVG exist AND zones overlap or are adjacent.
  Overlap condition: fvg_low <= ob_high  (FVG sits inside or below OB)

Sections
--------
A.  Coverage — what % of signals have OB / FVG / both
B.  Signal quality filter — all vs FVG-only vs OB-only vs FVG+OB
    (standard ATR stop, best TP from sweep)
C.  Stop mode comparison for FVG+OB confluence signals
      STANDARD   : stop = entry + ATR * atr_mult
      OB-STOP    : stop = ob_high + ATR * buf   (above OB invalidation)
      FVG-STOP   : stop = fvg_low + ATR * buf   (above FVG bottom, tightest)
      MIN-STOP   : min(OB-STOP, FVG-STOP) when both exist
D.  Confluence quality — does OB/FVG zone proximity improve results?
      (gap between fvg_high and ob_low: tight confluence vs loose)
E.  Year-by-year breakdown for best combo
F.  Per-symbol summary

All 6 symbols, 2022→latest, 1h signals replayed on 5m candles.
Builds on the tuned best config from SESSION_SUMMARY_2026-04-13.md:
  vol>1.8, body>0.55, close<0.15, BALANCED, HIGH vol quantile.

Usage:
    python lab/study_order_blocks.py
    python lab/study_order_blocks.py --start 2024-01-01 --tp-sweep 3.5 4.0 4.2 4.5
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
    _max_consec_loss,
    _row,
    _stats,
    _stats_from_results,
    prepare_sym,
)

# ── Order Block detector ───────────────────────────────────────────────────

def detect_bearish_ob(
    df1h: pd.DataFrame,
    signal_idx: int,
    lookback: int = 10,
    min_body_pct: float = 0.30,
) -> dict | None:
    """
    Find the last bullish-body candle before signal_idx within `lookback` bars.
    This is the Bearish Order Block (institutional supply zone).

    Returns dict or None:
      ob_idx      : bar index of the OB candle
      ob_open     : open of OB candle  (= bottom of body for bullish)
      ob_close    : close of OB candle (= top of body for bullish)
      ob_high     : full candle high   (stop invalidation level)
      ob_low      : full candle low
      ob_body_pct : body as fraction of full range
      ob_age      : bars between OB and signal (freshness)
    """
    hi = df1h["high"].values
    lo = df1h["low"].values
    op = df1h["open"].values
    cl = df1h["close"].values

    end = max(0, signal_idx - lookback - 1)
    for j in range(signal_idx - 1, end, -1):
        if j < 0:
            break
        # Must be a bullish body
        if cl[j] <= op[j]:
            continue
        rng = hi[j] - lo[j]
        if rng < 1e-12:
            continue
        body = (cl[j] - op[j]) / rng
        if body < min_body_pct:
            continue
        return {
            "ob_idx":      j,
            "ob_open":     float(op[j]),
            "ob_close":    float(cl[j]),
            "ob_high":     float(hi[j]),
            "ob_low":      float(lo[j]),
            "ob_body_pct": round(body, 3),
            "ob_age":      signal_idx - j,
        }
    return None


# ── Signal collector ───────────────────────────────────────────────────────

def collect_signals(
    df1h: pd.DataFrame,
    sym: str,
    vol_ratio_min: float = 1.8,
    body_pct_min: float  = 0.55,
    close_pct_max: float = 0.15,
    ob_lookback: int     = 10,
    ob_min_body: float   = 0.30,
) -> list[dict]:
    """
    Collect momentum short signals with FVG + OB tags.

    Bearish FVG  : high[i] < low[i-2]
    Bearish OB   : last bullish-body candle in [i-ob_lookback, i-1]

    Confluence check:
      fvg_low <= ob_high  →  FVG gap sits inside/below OB zone (overlap)
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

        # ── FVG tag ────────────────────────────────────────────────────────
        has_fvg  = False
        fvg_low  = np.nan
        fvg_high = np.nan
        fvg_bps  = 0.0

        if i >= 2 and hi_arr[i] < lo_arr[i - 2]:
            fl = float(hi_arr[i])
            fh = float(lo_arr[i - 2])
            if fl > entry_p:          # zone is above entry (valid for short)
                has_fvg  = True
                fvg_low  = fl
                fvg_high = fh
                fvg_bps  = round((fh - fl) / fl * 10_000, 1)

        # ── Order Block tag ────────────────────────────────────────────────
        ob = detect_bearish_ob(df1h, i, lookback=ob_lookback, min_body_pct=ob_min_body)
        has_ob = ob is not None

        # Validate OB is above entry (it should be for a bearish setup)
        if has_ob and ob["ob_close"] <= entry_p:
            has_ob = False
            ob = None

        # ── Confluence: FVG overlaps with OB zone ─────────────────────────
        # OB zone = [ob_open, ob_high], FVG zone = [fvg_low, fvg_high]
        # Confluence when FVG bottom is at or below OB full high → zones touch
        has_confluence = (
            has_fvg and has_ob
            and fvg_low <= ob["ob_high"]   # FVG is inside or touching OB zone
        )

        # Zone gap between FVG top and OB bottom
        # Tight = FVG and OB are adjacent/overlapping = strongest confluence
        zone_gap_bps = np.nan
        if has_fvg and has_ob:
            zone_gap_bps = round((ob["ob_low"] - fvg_high) / fvg_high * 10_000, 1)
            # negative means overlap

        sigs.append({
            "ts":            df1h.index[i + 1],
            "year":          df1h.index[i + 1].year,
            "sym":           sym,
            "sig_idx":       i,
            "entry_p":       entry_p,
            "atr":           atr_val,
            # FVG
            "has_fvg":       has_fvg,
            "fvg_low":       fvg_low,
            "fvg_high":      fvg_high,
            "fvg_bps":       fvg_bps,
            # OB
            "has_ob":        has_ob,
            "ob_open":       float(ob["ob_open"])     if has_ob else np.nan,
            "ob_close":      float(ob["ob_close"])    if has_ob else np.nan,
            "ob_high":       float(ob["ob_high"])     if has_ob else np.nan,
            "ob_low":        float(ob["ob_low"])      if has_ob else np.nan,
            "ob_age":        int(ob["ob_age"])        if has_ob else -1,
            "ob_body_pct":   float(ob["ob_body_pct"]) if has_ob else np.nan,
            # Confluence
            "has_confluence":has_confluence,
            "zone_gap_bps":  zone_gap_bps,
        })

    return sigs


# ── Replay functions ───────────────────────────────────────────────────────

def replay_fixed_risk(
    sig: dict,
    df5: pd.DataFrame,
    stop_price: float,
    risk_basis: float,
    tp_r: float,
    fee_bps: float = 3.0,
):
    """
    Short replay where risk_basis and stop_price are INDEPENDENT.

    risk_basis : used for TP calculation and R normalisation.
                 Always = ATR * atr_mult (standard risk) so that TP stays
                 at the same price regardless of which stop is used.
    stop_price : the actual stop level (may be tighter than risk_basis).
                 When stop_price < risk_basis above entry, losses are < -1R.

    This is the correct accounting for FVG-stop comparison:
      - TP price is IDENTICAL to STANDARD mode (same risk_basis)
      - Loss when FVG-stop is hit: (entry - fvg_stop) / risk_std < -1R
      - R saved on that loss = 1 - abs(loss_r)
    """
    from lab.sim.exit import replay_trade_5m
    from lab.sim.entry import tp_price_from_r

    entry_p = sig["entry_p"]
    if risk_basis <= 0 or stop_price <= entry_p:
        return None
    tp_p = tp_price_from_r(entry_p, risk_basis, -1, tp_r)
    return replay_trade_5m(
        df5, sig["ts"], -1, entry_p, stop_price, tp_p, risk_basis, fee_bps,
        be_trigger_r=None, be_offset_r=0.0, skip_entry_bucket_hours=0.0,
    )


def stop_standard(sig: dict, atr_mult: float) -> float:
    return sig["entry_p"] + sig["atr"] * atr_mult

def stop_fvg(sig: dict, buf_mult: float = 0.15) -> float | None:
    if not sig["has_fvg"] or np.isnan(sig["fvg_low"]):
        return None
    return sig["fvg_low"] + sig["atr"] * buf_mult

def stop_ob(sig: dict, buf_mult: float = 0.15) -> float | None:
    if not sig["has_ob"] or np.isnan(sig["ob_high"]):
        return None
    return sig["ob_high"] + sig["atr"] * buf_mult

def risk_std(sig: dict, atr_mult: float) -> float:
    """Standard risk (always used for TP normalisation)."""
    return sig["atr"] * atr_mult


# ── Stats helpers ──────────────────────────────────────────────────────────

def _run_subset(
    subset: list[dict],
    sym_df5: dict,
    atr_mult: float,
    stop_price_fn,          # sig → float | None
    tp_r: float,
    fee_bps: float = 3.0,
) -> dict:
    """
    Replay a subset. Risk basis is always standard (ATR×atr_mult).
    stop_price_fn may return a tighter stop — losses < -1R in that case.
    """
    results = []
    for s in subset:
        sp = stop_price_fn(s)
        if sp is None:
            continue
        rb = risk_std(s, atr_mult)
        res = replay_fixed_risk(s, sym_df5[s["sym"]], sp, rb, tp_r, fee_bps)
        if res:
            results.append(res)
    return _stats_from_results(results)


def _r_saved_report(
    subset: list[dict],
    sym_df5: dict,
    atr_mult: float,
    tight_stop_fn,          # sig → float | None  (FVG or OB stop)
    tp_r: float,
    fee_bps: float = 3.0,
) -> dict:
    """
    For each signal, replay BOTH standard and tight stop (same TP).
    Report how much R is saved on losing trades where the tight stop was hit
    before the standard stop would have been.

    Returns:
      n_total          : total trades replayed
      n_tp             : TP hits (identical in both modes)
      n_sl_tight       : trades stopped at tight level (< -1R loss)
      n_sl_standard    : trades stopped at standard level (-1R loss)
      avg_loss_standard: avg pnl on losing trades with standard stop
      avg_loss_tight   : avg pnl on losing trades with tight stop
      r_saved_per_exit : avg R saved per tight-stop exit vs standard
      total_r_saved    : total R saved across all tight-stop exits
      total_r_std      : total R with standard stop
      total_r_tight    : total R with tight stop
      r_saved_pct      : total_r_saved / abs(total_r_std losses) * 100
    """
    from lab.sim.exit import replay_trade_5m
    from lab.sim.entry import tp_price_from_r

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

        res_std   = replay_fixed_risk(s, df5, sp_std,   rb, tp_r, fee_bps)
        res_tight = replay_fixed_risk(s, df5, sp_tight, rb, tp_r, fee_bps)

        if res_std is None or res_tight is None:
            continue

        pnls_std.append(res_std.pnl_r)
        pnls_tight.append(res_tight.pnl_r)

        if res_std.reason == "TP":
            # TP: both modes identical (same TP price)
            n_tp += 1
        elif res_tight.reason == "TP" and res_std.reason != "TP":
            # tight stop missed (not hit), standard stop hit first?
            # Shouldn't happen if tight_stop < std_stop, but handle it
            n_tp += 1
            losses_std.append(res_std.pnl_r)
        else:
            # Both are losses — check if tight stop was hit before std would be
            if res_tight.pnl_r > res_std.pnl_r + 1e-6:
                # tight exit was BETTER (less loss) → tight stop fired first
                n_sl_tight += 1
                losses_std.append(res_std.pnl_r)
                losses_tight.append(res_tight.pnl_r)
                r_savings.append(res_tight.pnl_r - res_std.pnl_r)
            else:
                # same outcome — tight stop didn't trigger earlier
                n_sl_std += 1
                losses_std.append(res_std.pnl_r)
                losses_tight.append(res_tight.pnl_r)

    n_total = n_tp + n_sl_tight + n_sl_std
    avg_ls  = float(np.mean(losses_std))   if losses_std  else 0.0
    avg_lt  = float(np.mean(losses_tight)) if losses_tight else 0.0
    avg_sav = float(np.mean(r_savings))    if r_savings   else 0.0
    tot_sav = float(np.sum(r_savings))
    tot_std = float(np.sum(pnls_std))
    tot_tgt = float(np.sum(pnls_tight))
    # R saved as % of total std losses
    std_loss_total = abs(sum(l for l in pnls_std if l < 0))
    sav_pct = round(tot_sav / std_loss_total * 100, 1) if std_loss_total > 0 else 0.0

    return dict(
        n_total          = n_total,
        n_tp             = n_tp,
        n_sl_tight       = n_sl_tight,
        n_sl_standard    = n_sl_std,
        avg_loss_standard= round(avg_ls,  4),
        avg_loss_tight   = round(avg_lt,  4),
        r_saved_per_exit = round(avg_sav, 4),
        total_r_saved    = round(tot_sav, 2),
        total_r_std      = round(tot_std, 2),
        total_r_tight    = round(tot_tgt, 2),
        r_saved_pct      = sav_pct,
    )


# ── Main ───────────────────────────────────────────────────────────────────

def main(
    db_path: str,
    atr_mult: float       = 2.0,
    tp_sweep: list[float] = None,
    vol_ratio_min: float  = 1.8,
    body_pct_min: float   = 0.55,
    close_pct_max: float  = 0.15,
    ob_lookback: int      = 10,
    ob_min_body: float    = 0.30,
    buf_mult: float       = 0.15,
    start: str            = "2022-01-01",
) -> None:
    if tp_sweep is None:
        tp_sweep = [2.0, 3.0, 4.0, 4.2]

    # ── Load all symbols ──────────────────────────────────────────────────
    all_sigs: list[dict] = []
    sym_df5: dict[str, pd.DataFrame] = {}

    print(f"\nLoading {len(SYMS)} symbols  [{start} → latest]")
    print(f"Signal filters: vol>{vol_ratio_min}, body>{body_pct_min}, close<{close_pct_max}")
    print(f"OB: lookback={ob_lookback} bars, min_body={ob_min_body}")
    for sym in SYMS:
        df5, df1h = prepare_sym(db_path, sym, start)
        sym_df5[sym] = df5
        sigs = collect_signals(
            df1h, sym,
            vol_ratio_min=vol_ratio_min,
            body_pct_min=body_pct_min,
            close_pct_max=close_pct_max,
            ob_lookback=ob_lookback,
            ob_min_body=ob_min_body,
        )
        n_fvg  = sum(1 for s in sigs if s["has_fvg"])
        n_ob   = sum(1 for s in sigs if s["has_ob"])
        n_conf = sum(1 for s in sigs if s["has_confluence"])
        total  = max(len(sigs), 1)
        print(f"  {sym:<12}  {len(sigs):>3} sigs  |  "
              f"FVG:{n_fvg:>3}({n_fvg/total*100:.0f}%)  "
              f"OB:{n_ob:>3}({n_ob/total*100:.0f}%)  "
              f"CONF:{n_conf:>3}({n_conf/total*100:.0f}%)")
        all_sigs.extend(sigs)

    n_tot  = len(all_sigs)
    n_fvg  = sum(1 for s in all_sigs if s["has_fvg"])
    n_ob   = sum(1 for s in all_sigs if s["has_ob"])
    n_conf = sum(1 for s in all_sigs if s["has_confluence"])
    print(f"\n  {'TOTAL':<12}  {n_tot:>3} sigs  |  "
          f"FVG:{n_fvg:>3}({n_fvg/max(n_tot,1)*100:.0f}%)  "
          f"OB:{n_ob:>3}({n_ob/max(n_tot,1)*100:.0f}%)  "
          f"CONF:{n_conf:>3}({n_conf/max(n_tot,1)*100:.0f}%)")

    # Subset preselection
    sigs_fvg  = [s for s in all_sigs if s["has_fvg"]]
    sigs_ob   = [s for s in all_sigs if s["has_ob"]]
    sigs_conf = [s for s in all_sigs if s["has_confluence"]]

    std_stop_fn = lambda s: stop_standard(s, atr_mult)
    fvg_stop_fn = lambda s: stop_fvg(s, buf_mult)
    ob_stop_fn  = lambda s: stop_ob(s, buf_mult)

    # Best TP: pick by total_r on ALL signals with standard stop
    best_tp = max(
        tp_sweep,
        key=lambda tp: _run_subset(all_sigs, sym_df5, atr_mult, std_stop_fn, tp)["total_r"],
    )
    print(f"\n  Best TP from sweep on ALL+STANDARD: {best_tp}R\n")

    age_bins = [(1, 1), (2, 3), (4, 5), (6, 10), (11, 99)]

    # ── SECTION A: OB coverage by age ─────────────────────────────────────
    _hdr("A — Order Block freshness (bars before signal)", ["age", "n", "pct"])
    for lo_a, hi_a in age_bins:
        n = sum(1 for s in all_sigs if s["has_ob"] and lo_a <= s["ob_age"] <= hi_a)
        pct = n / max(n_ob, 1) * 100
        _row([f"{lo_a}-{hi_a} bars", n, f"{pct:.1f}%"])

    # ── SECTION B: Signal quality filter (standard stop, same TP) ─────────
    # All modes use the SAME risk_basis = ATR×atr_mult, SAME TP price.
    _hdr(
        f"B — Signal quality filter  |  ATR×{atr_mult} stop, TP={best_tp}R  "
        f"(all use same risk basis — apples-to-apples)",
        ["filter", "n", "win%", "SL%", "avg_R", "total_R", "maxDD", "DD/n", "MCL"],
    )
    for label, subset, sfn in [
        ("ALL",       all_sigs,  std_stop_fn),
        ("FVG-only",  sigs_fvg,  std_stop_fn),
        ("OB-only",   sigs_ob,   std_stop_fn),
        ("FVG+OB",    sigs_conf, std_stop_fn),
    ]:
        st = _run_subset(subset, sym_df5, atr_mult, sfn, best_tp)
        _row([label, st["n"], f"{st['win_pct']}%", f"{st.get('sl_hit_pct',0)}%",
              f"{st['avg_r']:.4f}", f"{st['total_r']:.1f}",
              f"{st['max_dd']:.1f}", f"{st['dd_per_trade']:.3f}",
              st.get("mcl", "—")])

    # ── SECTION C: FVG-STOP R-saved analysis (FIXED accounting) ───────────
    # Risk basis = ATR×atr_mult for all modes. TP price is IDENTICAL.
    # FVG-STOP / OB-STOP are TIGHTER stops → smaller losses when hit.
    # Win rate impact and R-saved are now correctly separable.
    _hdr(
        f"C — FVG-stop R-saved analysis  |  FVG-only signals  |  TP sweep",
        ["TP", "n_total", "n_tp", "n_sl_fvg", "n_sl_std",
         "avgL_std", "avgL_fvg", "R_per_exit", "tot_R_saved", "saved_%"],
    )
    for tp_r in tp_sweep:
        rpt = _r_saved_report(sigs_fvg, sym_df5, atr_mult, fvg_stop_fn, tp_r)
        _row([f"{tp_r}R",
              rpt["n_total"], rpt["n_tp"], rpt["n_sl_tight"], rpt["n_sl_standard"],
              f"{rpt['avg_loss_standard']:.3f}", f"{rpt['avg_loss_tight']:.3f}",
              f"{rpt['r_saved_per_exit']:.4f}", f"{rpt['total_r_saved']:.2f}",
              f"{rpt['r_saved_pct']}%"])

    # ── SECTION C2: OB-STOP R-saved ───────────────────────────────────────
    _hdr(
        f"C2 — OB-stop R-saved analysis  |  FVG+OB confluence signals  |  TP sweep",
        ["TP", "n_total", "n_tp", "n_sl_ob", "n_sl_std",
         "avgL_std", "avgL_ob", "R_per_exit", "tot_R_saved", "saved_%"],
    )
    for tp_r in tp_sweep:
        rpt = _r_saved_report(sigs_conf, sym_df5, atr_mult, ob_stop_fn, tp_r)
        _row([f"{tp_r}R",
              rpt["n_total"], rpt["n_tp"], rpt["n_sl_tight"], rpt["n_sl_standard"],
              f"{rpt['avg_loss_standard']:.3f}", f"{rpt['avg_loss_tight']:.3f}",
              f"{rpt['r_saved_per_exit']:.4f}", f"{rpt['total_r_saved']:.2f}",
              f"{rpt['r_saved_pct']}%"])

    # ── SECTION C3: Total R comparison (corrected) ────────────────────────
    _hdr(
        f"C3 — Total R comparison  |  FVG-only signals  |  SAME TP price  |  TP sweep",
        ["TP", "mode", "n", "win%", "avg_loss", "total_R", "maxDD", "DD/n"],
    )
    for tp_r in tp_sweep:
        for mode_label, sfn in [
            ("STANDARD", std_stop_fn),
            ("FVG-STOP", fvg_stop_fn),
            ("OB-STOP",  ob_stop_fn),
        ]:
            sub = sigs_fvg if mode_label in ("STANDARD", "FVG-STOP") else sigs_conf
            st = _run_subset(sub, sym_df5, atr_mult, sfn, tp_r)
            losses = [r for r in [] if r < 0]  # placeholder
            _row([f"{tp_r}R", mode_label, st["n"], f"{st['win_pct']}%",
                  f"{st['avg_r']:.4f}", f"{st['total_r']:.1f}",
                  f"{st['max_dd']:.1f}", f"{st['dd_per_trade']:.3f}"])
        print()

    # ── SECTION D: OB age quality ─────────────────────────────────────────
    _hdr(
        f"D — OB freshness vs quality  |  FVG+OB confluence  |  TP={best_tp}R  STANDARD stop",
        ["ob_age", "n", "win%", "avg_R", "total_R", "maxDD"],
    )
    for lo_a, hi_a in age_bins:
        subset = [s for s in sigs_conf if lo_a <= s.get("ob_age", 999) <= hi_a]
        if not subset:
            continue
        st = _run_subset(subset, sym_df5, atr_mult, std_stop_fn, best_tp)
        _row([f"{lo_a}-{hi_a}b", st["n"], f"{st['win_pct']}%",
              f"{st['avg_r']:.4f}", f"{st['total_r']:.1f}",
              f"{st['max_dd']:.1f}"])

    # ── SECTION E: Zone proximity ─────────────────────────────────────────
    _hdr(
        f"E — Zone proximity  |  FVG+OB confluence  |  TP={best_tp}R  STANDARD stop",
        ["zone_gap", "n", "win%", "avg_R", "total_R", "maxDD"],
    )
    prox_bins = [
        ("overlap (<0)",  lambda s: s["zone_gap_bps"] < 0),
        ("tight (0-30)",  lambda s: 0 <= s["zone_gap_bps"] < 30),
        ("loose (30-100)",lambda s: 30 <= s["zone_gap_bps"] < 100),
        ("far  (>100)",   lambda s: s["zone_gap_bps"] >= 100),
    ]
    for plabel, pfn in prox_bins:
        subset = [s for s in sigs_conf
                  if not np.isnan(s["zone_gap_bps"]) and pfn(s)]
        if not subset:
            continue
        st = _run_subset(subset, sym_df5, atr_mult, std_stop_fn, best_tp)
        _row([plabel, st["n"], f"{st['win_pct']}%",
              f"{st['avg_r']:.4f}", f"{st['total_r']:.1f}",
              f"{st['max_dd']:.1f}"])

    # ── SECTION F: Year-by-year (FVG-only, FVG-STOP, corrected) ──────────
    _hdr(
        f"F — Year breakdown  |  FVG-only  |  STANDARD vs FVG-STOP  |  "
        f"TP={best_tp}R  (same TP price, corrected R)",
        ["year", "n", "std_win%", "std_R", "fvg_win%", "fvg_R", "R_saved"],
    )
    yr_std: dict[int, list]  = defaultdict(list)
    yr_fvg_d: dict[int, list] = defaultdict(list)
    yr_saved: dict[int, list] = defaultdict(list)

    for s in sigs_fvg:
        rb   = risk_std(s, atr_mult)
        df5v = sym_df5[s["sym"]]
        sp_s = std_stop_fn(s)
        sp_f = fvg_stop_fn(s)
        yr   = s["year"]

        res_s = replay_fixed_risk(s, df5v, sp_s, rb, best_tp)
        res_f = replay_fixed_risk(s, df5v, sp_f, rb, best_tp) if sp_f else None

        if res_s:
            yr_std[yr].append(res_s.pnl_r)
        if res_f:
            yr_fvg_d[yr].append(res_f.pnl_r)
        if res_s and res_f:
            yr_saved[yr].append(res_f.pnl_r - res_s.pnl_r)

    for yr in YEARS:
        rs = np.array(yr_std.get(yr, []))
        rf = np.array(yr_fvg_d.get(yr, []))
        saved = sum(yr_saved.get(yr, []))
        sw = f"{(rs>0).mean()*100:.1f}%" if len(rs) else "—"
        fw = f"{(rf>0).mean()*100:.1f}%" if len(rf) else "—"
        _row([yr, f"s:{len(rs)}/f:{len(rf)}",
              sw, f"{rs.sum():.1f}" if len(rs) else "—",
              fw, f"{rf.sum():.1f}" if len(rf) else "—",
              f"{saved:+.2f}"])

    # ── SECTION G: Per-symbol summary (corrected) ─────────────────────────
    _hdr(
        f"G — Per-symbol  |  FVG-only  |  STANDARD vs FVG-STOP  |  TP={best_tp}R",
        ["sym", "n", "std_win%", "std_R", "fvg_win%", "fvg_R", "R_saved", "dd_delta"],
    )
    for sym in SYMS:
        subset = [s for s in sigs_fvg if s["sym"] == sym]
        st_std = _run_subset(subset, sym_df5, atr_mult, std_stop_fn, best_tp)
        st_fvg = _run_subset(subset, sym_df5, atr_mult, fvg_stop_fn, best_tp)
        r_sav  = round(st_fvg["total_r"] - st_std["total_r"], 2)
        dd_del = round(st_fvg["max_dd"]  - st_std["max_dd"],  2)
        _row([sym, len(subset),
              f"{st_std['win_pct']}%", f"{st_std['total_r']:.1f}",
              f"{st_fvg['win_pct']}%", f"{st_fvg['total_r']:.1f}",
              f"{r_sav:+.2f}", f"{dd_del:+.2f}"])

    # ── Save ──────────────────────────────────────────────────────────────
    rows = []
    for subset_label, subset in [
        ("all",  all_sigs),
        ("fvg",  sigs_fvg),
        ("ob",   sigs_ob),
        ("conf", sigs_conf),
    ]:
        for tp_r in tp_sweep:
            for mode_label, sfn in [
                ("standard", std_stop_fn),
                ("fvg_stop", fvg_stop_fn),
                ("ob_stop",  ob_stop_fn),
            ]:
                st = _run_subset(subset, sym_df5, atr_mult, sfn, tp_r)
                rows.append({
                    "subset": subset_label, "stop_mode": mode_label,
                    "tp": tp_r, **st,
                })

    out = REPO_ROOT / "cache" / "order_blocks_study.csv"
    out.parent.mkdir(exist_ok=True)
    pd.DataFrame(rows).to_csv(out, index=False)
    print(f"\nSaved → {out}\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db",          default=DEFAULT_DB)
    ap.add_argument("--start",       default="2022-01-01")
    ap.add_argument("--atr-mult",    type=float, default=2.0)
    ap.add_argument("--tp-sweep",    nargs="+",  type=float, default=[2.0, 3.0, 4.0, 4.2])
    ap.add_argument("--vol-ratio",   type=float, default=1.8)
    ap.add_argument("--body-pct",    type=float, default=0.55)
    ap.add_argument("--close-pct",   type=float, default=0.15)
    ap.add_argument("--ob-lookback", type=int,   default=10,
                    help="How many bars back to search for OB candle")
    ap.add_argument("--ob-min-body", type=float, default=0.30,
                    help="Min body fraction for OB candle (0=any bullish bar)")
    ap.add_argument("--buf",         type=float, default=0.15,
                    help="ATR buffer above stop reference (OB-STOP and FVG-STOP)")
    args = ap.parse_args()

    print("=" * 72)
    print("Order Block + FVG + Momentum Short Study")
    print("Bearish OB = last bullish candle before displacement")
    print("=" * 72)

    main(
        db_path      = args.db,
        atr_mult     = args.atr_mult,
        tp_sweep     = args.tp_sweep,
        vol_ratio_min= args.vol_ratio,
        body_pct_min = args.body_pct,
        close_pct_max= args.close_pct,
        ob_lookback  = args.ob_lookback,
        ob_min_body  = args.ob_min_body,
        buf_mult     = args.buf,
        start        = args.start,
    )
