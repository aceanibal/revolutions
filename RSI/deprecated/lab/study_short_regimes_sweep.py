#!/usr/bin/env python3
"""
Remaining short regime sweep — all 4 untested short combinations
=================================================================

Regimes tested (in parallel):
  1. BALANCED   + MED vol SHORT  (~58k bars)
  2. BALANCED   + LOW vol SHORT  (~65k bars)
  3. IMBALANCED + MED vol SHORT  (~15k bars)
  4. IMBALANCED + LOW vol SHORT  (~9k bars)

For each regime, three stop variants are compared:
  A. Raw ATR stop        — all signals, stop = entry + ATR×2.0
  B. FVG-filtered ATR    — FVG-only subset, same ATR stop
  C. FVG-filtered FVG stop — stop = fvg_low + ATR×buf  (structural anchor)

Candle shape analysis:
  - Compares win% / total_R across body_pct tiers (loose/mid/tight)
  - Shows whether tighter candle filter improves signal quality

Bearish FVG definition : high[i] < low[i-2]
  fvg_low  = high[i]          → bottom of the gap = resistance zone
  fvg_high = low[i-2]
  FVG stop = fvg_low + ATR×buf_mult  (stop just above resistance)
  Risk basis for TP = ATR×atr_mult   (decoupled, same as BAL_SHORT)

Usage:
    python lab/study_short_regimes_sweep.py
    python lab/study_short_regimes_sweep.py --tp-max 14
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
from lab.sim.exit   import replay_trade_5m, ReplayResult
from lab.sim.entry  import tp_price_from_r
from lab.study_imbalanced_trend import _mcl

ATR_MULT = 2.0
BUF_MULT = 0.15

# Per-regime signal thresholds
REGIME_CFG = {
    "BAL_MED":   dict(structure="BALANCED",    vol_q="MED", vol_min=1.3, body_min=0.40, close_max=0.30),
    "BAL_LOW":   dict(structure="BALANCED",    vol_q="LOW", vol_min=1.0, body_min=0.30, close_max=0.35),
    "IMBAL_MED": dict(structure="IMBALANCED",  vol_q="MED", vol_min=1.3, body_min=0.45, close_max=0.25),
    "IMBAL_LOW": dict(structure="IMBALANCED",  vol_q="LOW", vol_min=1.1, body_min=0.35, close_max=0.35),
}

# ── Signal collector ──────────────────────────────────────────────────────────

def collect_short_signals(
    df1h: pd.DataFrame,
    sym: str,
    structure: str,
    vol_q: str,
    vol_min: float,
    body_min: float,
    close_max: float,
) -> list[dict]:
    """Collect bearish momentum signals for any regime combination."""
    hi_arr = df1h["high"].values
    lo_arr = df1h["low"].values
    op_arr = df1h["open"].values
    cl_arr = df1h["close"].values
    n      = len(df1h)
    sigs   = []

    for i in range(62, n - 1):
        row = df1h.iloc[i]
        if pd.isna(row.get("atr")) or pd.isna(row.get("vol_q")): continue
        if row["structure"] != structure: continue
        if row["vol_q"]    != vol_q:     continue
        if not (row.get("vol_ratio", 0.0) > vol_min): continue
        if not (row.get("body_pct",  0.0) > body_min): continue
        if not (float(cl_arr[i]) < float(op_arr[i])): continue   # bearish candle
        cp = float(row.get("close_pct", 0.5))
        if cp > close_max: continue   # close near low of bar

        entry_bar = df1h.iloc[i + 1]
        if pd.isna(entry_bar["open"]): continue
        entry_p = float(entry_bar["open"])
        atr_val = float(row["atr"])

        # Bearish FVG: high[i] < low[i-2]
        has_fvg  = False
        fvg_low  = np.nan
        fvg_high = np.nan
        if i >= 2 and hi_arr[i] < lo_arr[i - 2]:
            fl = float(hi_arr[i])
            fh = float(lo_arr[i - 2])
            if fl > entry_p:     # gap is above entry → valid resistance
                has_fvg  = True
                fvg_low  = fl
                fvg_high = fh

        sigs.append({
            "sym": sym, "year": entry_bar.name.year, "ts": entry_bar.name,
            "entry_p": entry_p, "atr": atr_val,
            "body_pct": float(row.get("body_pct", 0.0)),
            "close_pct": cp,
            "has_fvg": has_fvg, "fvg_low": fvg_low, "fvg_high": fvg_high,
        })
    return sigs


# ── Replay ────────────────────────────────────────────────────────────────────

def replay_atr(sig: dict, df5: pd.DataFrame, tp_r: float) -> "ReplayResult | None":
    risk = sig["atr"] * ATR_MULT
    if risk <= 0: return None
    stop_p = sig["entry_p"] + risk   # above entry for short
    tp_p   = tp_price_from_r(sig["entry_p"], risk, -1, tp_r)
    return replay_trade_5m(df5, sig["ts"], -1, sig["entry_p"], stop_p, tp_p,
                           risk, 3.0, be_trigger_r=None, be_offset_r=0.0,
                           skip_entry_bucket_hours=0.0)

def replay_fvg_stop(sig: dict, df5: pd.DataFrame, tp_r: float) -> "ReplayResult | None":
    if not sig["has_fvg"] or np.isnan(sig["fvg_low"]): return None
    risk   = sig["atr"] * ATR_MULT
    stop_p = sig["fvg_low"] + sig["atr"] * BUF_MULT   # just above FVG resistance
    if stop_p <= sig["entry_p"] or risk <= 0: return None   # invalid geometry
    tp_p   = tp_price_from_r(sig["entry_p"], risk, -1, tp_r)
    return replay_trade_5m(df5, sig["ts"], -1, sig["entry_p"], stop_p, tp_p,
                           risk, 3.0, be_trigger_r=None, be_offset_r=0.0,
                           skip_entry_bucket_hours=0.0)


# ── Sweep ─────────────────────────────────────────────────────────────────────

def sweep(sigs, sym_df5, fn, tp_list, n_years):
    rows = []
    for tp_r in tp_list:
        pnls = [r.pnl_r for s in sigs
                for r in [fn(s, sym_df5[s["sym"]], tp_r)] if r]
        if not pnls: continue
        arr = np.array(pnls); dd = _max_dd(arr); n = len(arr)
        rows.append(dict(tp=tp_r, n=n,
            win_pct=round((arr>0).mean()*100,1),
            avg_r=round(float(arr.mean()),4),
            total_r=round(float(arr.sum()),2),
            max_dd=round(dd,2), dd_per_trade=round(dd/n,4),
            mcl=_mcl(arr), ann_r=round(float(arr.sum())/n_years,1)))
    return rows


def print_sweep(rows, label, dd_thresh=0.10):
    _hdr(label, ["TP","n","win%","avg_R","total_R","maxDD","DD/n","MCL","ann_R"])
    for r in rows:
        _row([f"{r['tp']}R", r["n"], f"{r['win_pct']}%",
              f"{r['avg_r']:.4f}", f"{r['total_r']:.1f}",
              f"{r['max_dd']:.1f}", f"{r['dd_per_trade']:.3f}",
              r["mcl"], f"{r['ann_r']:.1f}"])
    if not rows: return None
    best = max(rows, key=lambda x: x["total_r"])
    cands = sorted([r for r in rows if r["dd_per_trade"] < dd_thresh and r["n"] >= 15],
                   key=lambda x: x["ann_r"], reverse=True)[:3]
    print(f"\n  → Best total_R: TP={best['tp']}R  ann={best['ann_r']:.1f}  "
          f"win={best['win_pct']}%  maxDD={best['max_dd']:.1f}")
    if cands:
        print(f"  Top (DD/n<{dd_thresh}): " +
              "  |  ".join(f"TP={r['tp']}R ann={r['ann_r']:.1f} DD/n={r['dd_per_trade']:.3f}"
                           for r in cands))
    return cands[0] if cands else best


def year_breakdown(sigs, sym_df5, fn, tp_r, n_years, label):
    _hdr(label, ["year","n","win%","total_R","maxDD","ann_R"])
    yr = defaultdict(list)
    for s in sigs:
        res = fn(s, sym_df5[s["sym"]], tp_r)
        if res: yr[s["year"]].append(res.pnl_r)
    for y in YEARS:
        arr = np.array(yr.get(y, []))
        if not len(arr): _row([y,0,"—","—","—","—"]); continue
        _row([y, len(arr), f"{(arr>0).mean()*100:.1f}%",
              f"{arr.sum():.1f}", f"{_max_dd(arr):.1f}", f"{arr.sum()/n_years:.1f}"])


def per_symbol(sigs, sym_df5, fn, tp_r, n_years, label):
    _hdr(label, ["sym","n","win%","total_R","maxDD","ann_R"])
    for sym in SYMS:
        sub  = [s for s in sigs if s["sym"] == sym]
        pnls = [r.pnl_r for s in sub for r in [fn(s, sym_df5[sym], tp_r)] if r]
        if not pnls: _row([sym,0,"—","—","—","—"]); continue
        arr = np.array(pnls)
        _row([sym, len(arr), f"{(arr>0).mean()*100:.1f}%",
              f"{arr.sum():.1f}", f"{_max_dd(arr):.1f}", f"{arr.sum()/n_years:.1f}"])


def candle_shape_analysis(sigs, sym_df5, fn, tp_r, n_years, label):
    """Break signals into body_pct tiers and compare quality."""
    tiers = [
        ("loose  (0.30-0.45)", lambda s: 0.30 <= s["body_pct"] < 0.45),
        ("mid    (0.45-0.60)", lambda s: 0.45 <= s["body_pct"] < 0.60),
        ("tight  (0.60+    )", lambda s: s["body_pct"] >= 0.60),
    ]
    _hdr(label, ["body_tier","n","win%","total_R","maxDD","ann_R"])
    for tier_name, tier_fn in tiers:
        sub  = [s for s in sigs if tier_fn(s)]
        pnls = [r.pnl_r for s in sub for r in [fn(s, sym_df5[s["sym"]], tp_r)] if r]
        if not pnls: _row([tier_name,0,"—","—","—","—"]); continue
        arr = np.array(pnls)
        _row([tier_name, len(arr), f"{(arr>0).mean()*100:.1f}%",
              f"{arr.sum():.1f}", f"{_max_dd(arr):.1f}", f"{arr.sum()/n_years:.1f}"])


def atr_vs_fvg_comparison(raw_sigs, fvg_sigs, sym_df5, best_tp, n_years, regime_name):
    """Side-by-side ATR stop vs FVG stop at best TP."""
    print(f"\n  {'='*72}")
    print(f"  ATR stop vs FVG stop — {regime_name}  TP={best_tp}R")
    print(f"  {'='*72}")
    for label, sigs, fn in [
        ("ATR stop (all sigs)", raw_sigs, replay_atr),
        ("FVG stop (FVG only)", fvg_sigs, replay_fvg_stop),
    ]:
        pnls = [r.pnl_r for s in sigs for r in [fn(s, sym_df5[s["sym"]], best_tp)] if r]
        if not pnls:
            print(f"  {label}: no results"); continue
        arr = np.array(pnls)
        dd  = _max_dd(arr)
        print(f"  {label:<26}  n={len(arr):>4}  win={( arr>0).mean()*100:>5.1f}%  "
              f"total={arr.sum():>+8.1f}R  maxDD={dd:>6.1f}R  ann={arr.sum()/n_years:>+6.1f}R/yr  "
              f"Calmar={arr.sum()/n_years/dd:.2f}" if dd > 0 else
              f"  {label:<26}  n={len(arr):>4}  win={(arr>0).mean()*100:>5.1f}%  "
              f"total={arr.sum():>+8.1f}R  maxDD=  0.0  ann={arr.sum()/n_years:>+6.1f}R/yr")


# ── Per-regime runner ─────────────────────────────────────────────────────────

def run_regime(regime_name, cfg, sym_df5, tp_list, n_years):
    """Full study for one short regime. Returns dict of results."""
    print(f"\n{'#'*72}")
    print(f"  REGIME: {regime_name}  "
          f"({cfg['structure']} + {cfg['vol_q']} vol | "
          f"vol>{cfg['vol_min']} body>{cfg['body_min']} close<{cfg['close_max']})")
    print(f"{'#'*72}")

    # Collect
    all_sigs = []
    for sym in SYMS:
        sigs = collect_short_signals(
            # need the df1h — we pass it via the load dict
            sym_df5[f"{sym}_1h"], sym,
            cfg["structure"], cfg["vol_q"],
            cfg["vol_min"], cfg["body_min"], cfg["close_max"],
        )
        all_sigs.extend(sigs)

    fvg_sigs = [s for s in all_sigs if s["has_fvg"]]
    df5_map  = {sym: sym_df5[sym] for sym in SYMS}

    print(f"  Signals: raw={len(all_sigs)}  fvg={len(fvg_sigs)} "
          f"({len(fvg_sigs)/len(all_sigs)*100:.0f}% have FVG)" if all_sigs else
          f"  Signals: 0 — check thresholds")
    if not all_sigs:
        return {}

    # Parallel sweeps: raw ATR, FVG ATR, FVG stop
    with ThreadPoolExecutor(max_workers=3) as ex:
        f_raw  = ex.submit(sweep, all_sigs,  df5_map, replay_atr,      tp_list, n_years)
        f_fa   = ex.submit(sweep, fvg_sigs,  df5_map, replay_atr,      tp_list, n_years)
        f_fs   = ex.submit(sweep, fvg_sigs,  df5_map, replay_fvg_stop, tp_list, n_years)
        rows_raw = f_raw.result()
        rows_fa  = f_fa.result()
        rows_fs  = f_fs.result()

    best_raw = print_sweep(rows_raw, f"A — Raw ATR stop  |  {len(all_sigs)} signals")
    best_fa  = print_sweep(rows_fa,  f"B — FVG-filter ATR stop  |  {len(fvg_sigs)} signals")
    best_fs  = print_sweep(rows_fs,  f"C — FVG-filter FVG stop  |  {len(fvg_sigs)} signals")

    # Best TP for detailed breakdown (prefer FVG stop if it has edge)
    has_fvg_edge = any(r["total_r"] > 0 for r in rows_fs)
    if has_fvg_edge and best_fs:
        detail_tp, detail_fn, detail_sigs = best_fs["tp"], replay_fvg_stop, fvg_sigs
        detail_label = f"FVG stop TP={detail_tp}R"
    elif best_raw:
        detail_tp, detail_fn, detail_sigs = best_raw["tp"], replay_atr, all_sigs
        detail_label = f"raw ATR TP={detail_tp}R"
    else:
        return {}

    year_breakdown(detail_sigs, df5_map, detail_fn, detail_tp, n_years,
                   f"D — Year breakdown  {detail_label}")
    per_symbol(detail_sigs, df5_map, detail_fn, detail_tp, n_years,
               f"E — Per-symbol  {detail_label}")

    # Candle shape analysis
    candle_shape_analysis(all_sigs, df5_map, replay_atr, detail_tp, n_years,
                          f"F — Candle shape (body_pct tiers)  TP={detail_tp}R  ATR stop")
    if fvg_sigs:
        candle_shape_analysis(fvg_sigs, df5_map, replay_fvg_stop, detail_tp, n_years,
                              f"G — Candle shape FVG stop  TP={detail_tp}R")

    # ATR vs FVG stop comparison
    atr_vs_fvg_comparison(all_sigs, fvg_sigs, df5_map, detail_tp, n_years, regime_name)

    return dict(raw=rows_raw, fvg_atr=rows_fa, fvg_stop=rows_fs,
                all_sigs=all_sigs, fvg_sigs=fvg_sigs,
                best_raw=best_raw, best_fs=best_fs)


# ── Main ──────────────────────────────────────────────────────────────────────

def main(db_path: str, tp_max: float = 12.0, start: str = "2022-01-01") -> None:
    tp_list = [round(v * 0.5, 2) for v in range(4, int(tp_max / 0.5) + 1)]
    n_years = max((pd.Timestamp("today") - pd.Timestamp(start)).days / 365.25, 1)

    print(f"\n{'='*72}")
    print(f"  SHORT REGIME SWEEP — 4 untested regimes")
    print(f"  {start} → latest  |  {len(SYMS)} symbols  |  TP sweep to {tp_max}R")
    print(f"  Variants: raw ATR  |  FVG-filtered ATR  |  FVG-filtered FVG stop")
    print(f"{'='*72}")
    print(f"\n  Reference — live short streams:")
    print(f"    BAL_SHORT  (BAL+HIGH FVG stop): 402 sigs  25.9% win  44.3R/yr  maxDD=26.2  Calmar=1.69")
    print(f"    IMBAL_SHORT (IMBAL+HIGH ATR):   631 sigs  21.1% win  37.0R/yr  maxDD=67.1  Calmar=0.55")

    # Load all symbols once
    print(f"\n  Loading {len(SYMS)} symbols ...")
    sym_df5 = {}
    for sym in SYMS:
        df5, df1h = prepare_sym(db_path, sym, start)
        sym_df5[sym]         = df5
        sym_df5[f"{sym}_1h"] = df1h
        print(f"    {sym} loaded")

    # Run all 4 regimes sequentially (each internally parallel)
    results = {}
    for name, cfg in REGIME_CFG.items():
        results[name] = run_regime(name, cfg, sym_df5, tp_list, n_years)

    # ── Master summary ────────────────────────────────────────────────────
    print(f"\n\n{'='*80}")
    print(f"  MASTER SUMMARY — All short regimes")
    print(f"{'='*80}")
    print(f"  {'Regime':<14}  {'Variant':<18}  {'n':>5}  {'ann_R':>8}  "
          f"{'maxDD':>7}  {'DD/n':>6}  {'Calmar':>7}  {'best_TP':>8}")
    print(f"  {'-'*78}")

    # Live reference
    for name, n, ann, dd, tp in [
        ("BAL_HIGH",  402, 44.3, 26.2, "4.25R"),
        ("IMBAL_HIGH", 631, 37.0, 67.1, "5.0R"),
    ]:
        calmar = ann / dd if dd > 0 else 0
        print(f"  {name:<14}  {'LIVE':18}  {n:>5}  {ann:>+8.1f}  "
              f"{dd:>7.1f}  {'—':>6}  {calmar:>7.2f}  {tp:>8}")

    print(f"  {'':14}  {'':18}  {'---':>5}")

    for rname, rdata in results.items():
        if not rdata: continue
        for variant, rows, sigs_key in [
            ("raw ATR",      rdata.get("raw", []),      "all_sigs"),
            ("FVG stop",     rdata.get("fvg_stop", []), "fvg_sigs"),
        ]:
            if not rows: continue
            best = max(rows, key=lambda x: x["total_r"])
            calmar = best["ann_r"] / best["max_dd"] if best["max_dd"] > 0 else 0
            edge = "✅" if best["total_r"] > 0 else "❌"
            sigs = rdata.get(sigs_key, [])
            print(f"  {rname:<14}  {variant:<18}  {len(sigs):>5}  "
                  f"{best['ann_r']:>+8.1f}  {best['max_dd']:>7.1f}  "
                  f"{best['dd_per_trade']:>6.3f}  {calmar:>7.2f}  "
                  f"TP={best['tp']}R {edge}")

    # Save
    all_rows = []
    for rname, rdata in results.items():
        for vname, rows in [("raw_atr", rdata.get("raw",[])),
                             ("fvg_atr", rdata.get("fvg_atr",[])),
                             ("fvg_stop",rdata.get("fvg_stop",[]))]:
            for r in rows:
                all_rows.append({"regime": rname, "variant": vname, **r})
    out = REPO_ROOT / "cache" / "short_regimes_sweep.csv"
    out.parent.mkdir(exist_ok=True)
    pd.DataFrame(all_rows).to_csv(out, index=False)
    print(f"\nSaved → {out}\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db",     default=DEFAULT_DB)
    ap.add_argument("--start",  default="2022-01-01")
    ap.add_argument("--tp-max", type=float, default=12.0)
    args = ap.parse_args()
    main(args.db, args.tp_max, args.start)
