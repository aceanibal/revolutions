#!/usr/bin/env python3
"""
Swing Low Sweep (Liquidity Grab) — Long strategy study
=======================================================

Concept: Institutions build a pool of stop-losses below obvious support
(equal lows / double bottoms). They sweep price below the level, absorb
the panic sell orders, then reverse violently back up.

Signal mechanics:
  1. Equal lows: find 2+ swing lows within `tolerance` % of each other
     in the last `lookback` bars. That price is the "trap level."
  2. Sweep: current bar's LOW < trap_level  AND  CLOSE > trap_level
     (price dips below the line and snaps back in the same bar)
  3. Rejection strength: (close - low) / (high - low) > `rejection_min`
     (closes in the upper portion of the wick — V-shape quality filter)

Two stop modes compared:
  A. ATR stop: stop = entry - ATR×atr_mult  (standard)
  B. Wick stop: stop = sweep_low - ATR×buf  (below the actual sweep wick)
     Thesis: the wick low IS the structural stop — if the institution's
     absorption zone fails, the trade idea is wrong. This is tighter and
     more capital-efficient.

Entry: bar i+1 open  (no look-ahead)
TP: sweep 2R → 16R

No regime filter applied — this is a pure price structure pattern that
can appear in any regime. Sections include regime breakdown to see where
the edge concentrates.

Sections
--------
A  Signal counts — per symbol, rejection strength distribution
B  TP sweep — ATR stop
C  TP sweep — wick stop
D  Side-by-side ATR vs wick stop comparison
E  Year breakdown at best TP (both modes)
F  Per-symbol at best TP
G  Candle shape analysis — sweep depth and rejection strength tiers
H  Regime breakdown — where does the edge concentrate?

Usage:
    python lab/study_swing_low_sweep.py
    python lab/study_swing_low_sweep.py --tolerance 0.003 --lookback 40
    python lab/study_swing_low_sweep.py --rejection-min 0.5 --tp-max 20
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
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


# ── Swing low detection ───────────────────────────────────────────────────────

def find_swing_lows(lo_arr: np.ndarray, min_swing: int = 5) -> list[tuple[int, float]]:
    """
    Return (index, price) for all local minima.
    A swing low requires `min_swing` higher bars on each side.
    """
    n      = len(lo_arr)
    swings = []
    for i in range(min_swing, n - min_swing):
        if (all(lo_arr[i] <= lo_arr[i - k] for k in range(1, min_swing + 1)) and
                all(lo_arr[i] <= lo_arr[i + k] for k in range(1, min_swing + 1))):
            swings.append((i, float(lo_arr[i])))
    return swings


def equal_lows_level(
    swings: list[tuple[int, float]],
    current_idx: int,
    lookback: int,
    tolerance: float,
) -> float | None:
    """
    Within the lookback window ending at current_idx, find the most recent
    pair of swing lows within `tolerance` % of each other.
    Returns the LOWER of the two (the "trap line") or None.
    """
    recent = [(idx, p) for idx, p in swings
              if current_idx - lookback <= idx < current_idx - 2]

    if len(recent) < 2:
        return None

    # Scan from most recent backward — find the first qualifying pair
    for k in range(len(recent) - 1, 0, -1):
        p1 = recent[k][1]
        for m in range(k - 1, -1, -1):
            p2 = recent[m][1]
            if abs(p1 - p2) / max(p1, p2) <= tolerance:
                return min(p1, p2)   # the lower low = the line retail defends

    return None


# ── Signal collector ──────────────────────────────────────────────────────────

def collect_sweep_signals(
    df1h: pd.DataFrame,
    sym: str,
    lookback: int        = 50,
    tolerance: float     = 0.005,   # 0.5% — how "equal" the lows need to be
    min_swing: int       = 5,
    rejection_min: float = 0.60,    # (close-low)/(high-low) — V-shape quality
    sweep_depth_min: float = 0.0,   # sweep_low must be at least X×ATR below trap
) -> list[dict]:
    """
    Collect equal-lows sweep signals on 1h bars.

    For each bar i:
      - Find equal lows level in lookback window (trap)
      - Check bar sweeps below and closes above (V-shape)
      - Record signal metadata for later analysis
    """
    hi_arr  = df1h["high"].values
    lo_arr  = df1h["low"].values
    op_arr  = df1h["open"].values
    cl_arr  = df1h["close"].values
    n       = len(df1h)

    # Pre-compute swing lows for the whole series
    swings = find_swing_lows(lo_arr, min_swing=min_swing)

    sigs = []
    min_idx = lookback + min_swing + 1

    for i in range(min_idx, n - 1):
        row = df1h.iloc[i]
        if pd.isna(row.get("atr")): continue

        atr_val  = float(row["atr"])
        hi, lo   = float(hi_arr[i]), float(lo_arr[i])
        op, cl   = float(op_arr[i]), float(cl_arr[i])
        bar_rng  = hi - lo
        if bar_rng <= 0: continue

        # Find the trap level
        trap = equal_lows_level(swings, i, lookback, tolerance)
        if trap is None: continue

        # Sweep condition: low < trap AND close >= trap
        if lo >= trap:    continue   # no sweep
        if cl < trap:     continue   # didn't recover above the line

        # V-shape rejection strength
        rejection = (cl - lo) / bar_rng
        if rejection < rejection_min: continue

        # Optional: sweep must be meaningful (not just 1 tick below)
        sweep_depth = (trap - lo) / atr_val   # in ATR units
        if sweep_depth < sweep_depth_min: continue

        entry_bar = df1h.iloc[i + 1]
        if pd.isna(entry_bar["open"]): continue

        entry_p   = float(entry_bar["open"])
        sweep_low = lo   # actual wick low of the sweep bar

        sigs.append({
            "sym":         sym,
            "year":        entry_bar.name.year,
            "ts":          entry_bar.name,
            "entry_p":     entry_p,
            "atr":         atr_val,
            "trap":        trap,
            "sweep_low":   sweep_low,
            "rejection":   round(rejection, 3),
            "sweep_depth": round(sweep_depth, 3),
            "structure":   row.get("structure", "—"),
            "vol_q":       row.get("vol_q", "—"),
        })

    return sigs


# ── Replay ────────────────────────────────────────────────────────────────────

def replay_atr(
    sig: dict, df5: pd.DataFrame, atr_mult: float, tp_r: float,
    fee_bps: float = 3.0,
) -> "ReplayResult | None":
    """Standard ATR-based stop."""
    risk = sig["atr"] * atr_mult
    if risk <= 0: return None
    stop_p = sig["entry_p"] - risk
    tp_p   = tp_price_from_r(sig["entry_p"], risk, +1, tp_r)
    return replay_trade_5m(
        df5, sig["ts"], +1, sig["entry_p"], stop_p, tp_p,
        risk, fee_bps, be_trigger_r=None, be_offset_r=0.0,
        skip_entry_bucket_hours=0.0,
    )


def replay_wick_stop(
    sig: dict, df5: pd.DataFrame, atr_mult: float, buf_mult: float,
    tp_r: float, fee_bps: float = 3.0,
) -> "ReplayResult | None":
    """
    Stop placed below the sweep wick (the actual fakeout low).
    Risk basis for TP is still ATR×atr_mult (decoupled from stop).
    This is a tighter stop — if the absorption zone fails, exit.
    """
    stop_p = sig["sweep_low"] - sig["atr"] * buf_mult
    if stop_p >= sig["entry_p"]: return None
    risk   = sig["atr"] * atr_mult   # TP basis
    if risk <= 0: return None
    tp_p   = tp_price_from_r(sig["entry_p"], risk, +1, tp_r)
    return replay_trade_5m(
        df5, sig["ts"], +1, sig["entry_p"], stop_p, tp_p,
        risk, fee_bps, be_trigger_r=None, be_offset_r=0.0,
        skip_entry_bucket_hours=0.0,
    )


# ── Sweep + helpers ───────────────────────────────────────────────────────────

def _sweep(sigs, sym_df5, fn, tp_list, n_years, **kwargs):
    rows = []
    for tp_r in tp_list:
        pnls = [r.pnl_r for s in sigs
                for r in [fn(s, sym_df5[s["sym"]], tp_r=tp_r, **kwargs)] if r]
        if not pnls: continue
        arr = np.array(pnls); dd = _max_dd(arr); n = len(arr)
        rows.append(dict(
            tp=tp_r, n=n,
            win_pct=round((arr>0).mean()*100, 1),
            avg_r=round(float(arr.mean()), 4),
            total_r=round(float(arr.sum()), 2),
            max_dd=round(dd, 2),
            dd_per_trade=round(dd/n, 4),
            mcl=_mcl(arr),
            ann_r=round(float(arr.sum())/n_years, 1),
            calmar=round(float(arr.sum())/n_years/dd, 2) if dd > 0 else 0,
        ))
    return rows


def _print_sweep(rows, label, dd_thresh=0.10):
    _hdr(label, ["TP","n","win%","avg_R","total_R","maxDD","DD/n","MCL","ann_R","Calmar"])
    for r in rows:
        _row([f"{r['tp']}R", r["n"], f"{r['win_pct']}%",
              f"{r['avg_r']:.4f}", f"{r['total_r']:.1f}",
              f"{r['max_dd']:.1f}", f"{r['dd_per_trade']:.3f}",
              r["mcl"], f"{r['ann_r']:.1f}", f"{r['calmar']:.2f}"])
    if not rows: return None
    best = max(rows, key=lambda x: x["total_r"])
    cands = sorted([r for r in rows if r["dd_per_trade"] < dd_thresh and r["n"] >= 20],
                   key=lambda x: x["ann_r"], reverse=True)[:4]
    print(f"\n  → Best total_R: TP={best['tp']}R  ann={best['ann_r']:.1f}  "
          f"win={best['win_pct']}%  maxDD={best['max_dd']:.1f}  Calmar={best['calmar']:.2f}")
    if cands:
        print(f"  Top (DD/n<{dd_thresh}, n≥20):")
        for r in cands:
            print(f"    TP={r['tp']}R  ann={r['ann_r']:.1f}/yr  win={r['win_pct']}%  "
                  f"maxDD={r['max_dd']:.1f}  DD/n={r['dd_per_trade']:.3f}  Calmar={r['calmar']:.2f}")
    return cands[0] if cands else best


def _year_breakdown(sigs, sym_df5, fn, tp_r, n_years, label, **kwargs):
    _hdr(label, ["year","n","win%","total_R","maxDD","ann_R"])
    yr = defaultdict(list)
    for s in sigs:
        res = fn(s, sym_df5[s["sym"]], tp_r=tp_r, **kwargs)
        if res: yr[s["year"]].append(res.pnl_r)
    for y in YEARS:
        arr = np.array(yr.get(y, []))
        if not len(arr): _row([y,0,"—","—","—","—"]); continue
        _row([y, len(arr), f"{(arr>0).mean()*100:.1f}%",
              f"{arr.sum():.1f}", f"{_max_dd(arr):.1f}", f"{arr.sum()/n_years:.1f}"])


def _per_symbol(sigs, sym_df5, fn, tp_r, n_years, label, **kwargs):
    _hdr(label, ["sym","n","win%","total_R","maxDD","ann_R","Calmar"])
    for sym in SYMS:
        sub  = [s for s in sigs if s["sym"] == sym]
        pnls = [r.pnl_r for s in sub
                for r in [fn(s, sym_df5[sym], tp_r=tp_r, **kwargs)] if r]
        if not pnls: _row([sym,0,"—","—","—","—","—"]); continue
        arr = np.array(pnls); dd = _max_dd(arr)
        calmar = arr.sum()/n_years/dd if dd > 0 else 0
        _row([sym, len(arr), f"{(arr>0).mean()*100:.1f}%",
              f"{arr.sum():.1f}", f"{_max_dd(arr):.1f}",
              f"{arr.sum()/n_years:.1f}", f"{calmar:.2f}"])


def _candle_analysis(sigs, sym_df5, fn, tp_r, n_years, label, **kwargs):
    """Break down by sweep depth and rejection strength tiers."""
    _hdr(label, ["tier","n","win%","total_R","ann_R","Calmar"])

    # Rejection tiers (V-shape quality)
    print("  -- Rejection strength (close position in the wick) --")
    for tier, lo_r, hi_r in [("0.60-0.75",0.60,0.75),("0.75-0.90",0.75,0.90),("0.90+",0.90,1.01)]:
        sub  = [s for s in sigs if lo_r <= s["rejection"] < hi_r]
        pnls = [r.pnl_r for s in sub
                for r in [fn(s, sym_df5[s["sym"]], tp_r=tp_r, **kwargs)] if r]
        if not pnls: _row([tier,0,"—","—","—","—"]); continue
        arr = np.array(pnls); dd = _max_dd(arr)
        calmar = arr.sum()/n_years/dd if dd > 0 else 0
        _row([tier, len(arr), f"{(arr>0).mean()*100:.1f}%",
              f"{arr.sum():.1f}", f"{arr.sum()/n_years:.1f}", f"{calmar:.2f}"])

    # Sweep depth tiers (how far below the trap price went, in ATR units)
    print("  -- Sweep depth (ATR units below trap level) --")
    for tier, lo_d, hi_d in [("<0.2 ATR",0,0.2),("0.2-0.5 ATR",0.2,0.5),(">0.5 ATR",0.5,99)]:
        sub  = [s for s in sigs if lo_d <= s["sweep_depth"] < hi_d]
        pnls = [r.pnl_r for s in sub
                for r in [fn(s, sym_df5[s["sym"]], tp_r=tp_r, **kwargs)] if r]
        if not pnls: _row([tier,0,"—","—","—","—"]); continue
        arr = np.array(pnls); dd = _max_dd(arr)
        calmar = arr.sum()/n_years/dd if dd > 0 else 0
        _row([tier, len(arr), f"{(arr>0).mean()*100:.1f}%",
              f"{arr.sum():.1f}", f"{arr.sum()/n_years:.1f}", f"{calmar:.2f}"])


def _regime_breakdown(sigs, sym_df5, fn, tp_r, n_years, label, **kwargs):
    """Where does the edge concentrate — BALANCED vs IMBALANCED, vol tier."""
    _hdr(label, ["regime","n","win%","total_R","ann_R","Calmar"])
    combos = [
        ("BAL+HIGH",  "BALANCED",   "HIGH"),
        ("BAL+MED",   "BALANCED",   "MED"),
        ("BAL+LOW",   "BALANCED",   "LOW"),
        ("IMBAL+HIGH","IMBALANCED", "HIGH"),
        ("IMBAL+MED", "IMBALANCED", "MED"),
        ("IMBAL+LOW",  "IMBALANCED","LOW"),
    ]
    for combo_name, structure, vol_q in combos:
        sub  = [s for s in sigs if s["structure"] == structure and s["vol_q"] == vol_q]
        pnls = [r.pnl_r for s in sub
                for r in [fn(s, sym_df5[s["sym"]], tp_r=tp_r, **kwargs)] if r]
        if not pnls: _row([combo_name,0,"—","—","—","—"]); continue
        arr = np.array(pnls); dd = _max_dd(arr)
        calmar = arr.sum()/n_years/dd if dd > 0 else 0
        _row([combo_name, len(arr), f"{(arr>0).mean()*100:.1f}%",
              f"{arr.sum():.1f}", f"{arr.sum()/n_years:.1f}", f"{calmar:.2f}"])


# ── Main ──────────────────────────────────────────────────────────────────────

def main(
    db_path: str,
    lookback: int        = 50,
    tolerance: float     = 0.005,
    min_swing: int       = 5,
    rejection_min: float = 0.60,
    atr_mult: float      = 2.0,
    buf_mult: float      = 0.15,
    tp_max: float        = 16.0,
    start: str           = "2022-01-01",
    structure_filter: str | None = None,   # e.g. "BALANCED" or "IMBALANCED"
    vol_q_filter: str | None = None,       # e.g. "HIGH", "MED", "LOW"
    stop_mode: str       = "both",         # "atr" | "wick" | "both"
    tp_levels: list[float] | None = None,  # override sweep with exact TP list
) -> None:

    tp_list = [round(v * 0.5, 2) for v in range(4, int(tp_max / 0.5) + 1)]
    if tp_levels:
        tp_list = sorted(set(round(t, 2) for t in tp_levels))

    print(f"\n{'='*72}")
    print(f"  SWING LOW SWEEP — Liquidity Grab Long Study")
    print(f"{'='*72}")
    print(f"  lookback={lookback}  tolerance={tolerance*100:.1f}%  min_swing={min_swing}")
    print(f"  rejection_min={rejection_min}  ATR×{atr_mult}  buf×{buf_mult}")
    filt_str = ""
    if structure_filter: filt_str += f"  structure={structure_filter}"
    if vol_q_filter:     filt_str += f"  vol_q={vol_q_filter}"
    print(f"  TP sweep: 2R → {tp_max}R  stop_mode={stop_mode}{filt_str}\n")

    all_sigs: list[dict] = []
    sym_df5: dict[str, pd.DataFrame] = {}

    print(f"  Loading {len(SYMS)} symbols [{start} → latest]...")
    for sym in SYMS:
        df5, df1h = prepare_sym(db_path, sym, start)
        sym_df5[sym] = df5
        sigs = collect_sweep_signals(
            df1h, sym,
            lookback=lookback, tolerance=tolerance,
            min_swing=min_swing, rejection_min=rejection_min,
        )
        # Apply regime filters after collection (labels live on the signal)
        if structure_filter:
            sigs = [s for s in sigs if s["structure"] == structure_filter]
        if vol_q_filter:
            sigs = [s for s in sigs if s["vol_q"] == vol_q_filter]
        all_sigs.extend(sigs)
        rej_dist = np.array([s["rejection"] for s in sigs])
        print(f"  {sym:<12}  signals={len(sigs):>4}  "
              f"avg_rejection={rej_dist.mean():.2f}  "
              f"avg_sweep_depth={np.array([s['sweep_depth'] for s in sigs]).mean():.2f}ATR"
              if sigs else f"  {sym:<12}  signals=   0")

    n_years = max((pd.Timestamp("today") - pd.Timestamp(start)).days / 365.25, 1)
    print(f"\n  TOTAL signals: {len(all_sigs)}  ({len(all_sigs)/n_years:.0f}/yr)\n")

    if not all_sigs:
        print("  No signals — relax tolerance or rejection_min"); return

    # ── Parallel sweeps ───────────────────────────────────────────────────
    atr_kw  = dict(atr_mult=atr_mult)
    wick_kw = dict(atr_mult=atr_mult, buf_mult=buf_mult)

    run_atr  = stop_mode in ("atr",  "both")
    run_wick = stop_mode in ("wick", "both")

    print(f"  Running {'ATR + wick stop' if stop_mode == 'both' else stop_mode + ' stop'} sweep(s) in parallel ...")
    workers = sum([run_atr, run_wick])
    with ThreadPoolExecutor(max_workers=max(workers, 1)) as ex:
        fut_atr  = ex.submit(_sweep, all_sigs, sym_df5, replay_atr,       tp_list, n_years, **atr_kw)  if run_atr  else None
        fut_wick = ex.submit(_sweep, all_sigs, sym_df5, replay_wick_stop, tp_list, n_years, **wick_kw) if run_wick else None
        rows_atr  = fut_atr.result()  if fut_atr  else []
        rows_wick = fut_wick.result() if fut_wick else []

    best_atr  = _print_sweep(rows_atr,  f"B — ATR stop  (entry - ATR×{atr_mult})")  if rows_atr  else None
    best_wick = _print_sweep(rows_wick, f"C — Wick stop (sweep_low - ATR×{buf_mult})") if rows_wick else None

    # ── Section D — Side-by-side comparison ──────────────────────────────
    atr_map  = {r["tp"]: r for r in rows_atr}
    wick_map = {r["tp"]: r for r in rows_wick}
    print(f"\n{'='*90}")
    print(f"  D — ATR stop vs Wick stop  (side-by-side)")
    print(f"{'='*90}")
    print(f"  {'TP':>6}  │  {'ATR stop':^38}  │  {'Wick stop':^38}")
    print(f"  {'':>6}  │  {'ann_R':>8} {'maxDD':>7} {'win%':>6} {'Calmar':>7}  │"
          f"  {'ann_R':>8} {'maxDD':>7} {'win%':>6} {'Calmar':>7}")
    print(f"  {'-'*88}")
    for tp in tp_list:
        a = atr_map.get(tp, {})
        w = wick_map.get(tp, {})
        print(f"  {tp:>5.1f}R │"
              f"  {a.get('ann_r','—'):>8}  {a.get('max_dd','—'):>6}  "
              f"{a.get('win_pct','—'):>5}%  {a.get('calmar','—'):>7}  │"
              f"  {w.get('ann_r','—'):>8}  {w.get('max_dd','—'):>6}  "
              f"{w.get('win_pct','—'):>5}%  {w.get('calmar','—'):>7}")

    # Choose best mode for deep dive
    best_atr_ann  = max((r["ann_r"] for r in rows_atr),  default=-999)
    best_wick_ann = max((r["ann_r"] for r in rows_wick), default=-999)

    if best_wick_ann >= best_atr_ann:
        best_cfg = best_wick or best_atr
        best_fn, best_kw, mode_label = replay_wick_stop, wick_kw, "Wick stop"
    else:
        best_cfg = best_atr or best_wick
        best_fn, best_kw, mode_label = replay_atr, atr_kw, "ATR stop"

    if best_cfg is None:
        print("\n  No viable config found."); return

    btp = best_cfg["tp"]

    # ── Section E — Year breakdown ────────────────────────────────────────
    for label, fn, kw in [
        (f"E1 — Year breakdown  ATR stop  TP={best_atr['tp'] if best_atr else btp}R",
         replay_atr, atr_kw),
        (f"E2 — Year breakdown  Wick stop TP={best_wick['tp'] if best_wick else btp}R",
         replay_wick_stop, wick_kw),
    ]:
        tp_use = best_atr["tp"] if fn == replay_atr and best_atr else \
                 best_wick["tp"] if fn == replay_wick_stop and best_wick else btp
        _year_breakdown(all_sigs, sym_df5, fn, tp_use, n_years, label, **kw)

    # ── Section F — Per-symbol ────────────────────────────────────────────
    _per_symbol(all_sigs, sym_df5, best_fn, btp, n_years,
                f"F — Per-symbol  {mode_label}  TP={btp}R", **best_kw)

    # ── Section G — Candle shape analysis ─────────────────────────────────
    _candle_analysis(all_sigs, sym_df5, best_fn, btp, n_years,
                     f"G — Candle shape analysis  {mode_label}  TP={btp}R", **best_kw)

    # ── Section H — Regime breakdown ──────────────────────────────────────
    _regime_breakdown(all_sigs, sym_df5, best_fn, btp, n_years,
                      f"H — Regime breakdown  {mode_label}  TP={btp}R", **best_kw)

    # ── Summary ───────────────────────────────────────────────────────────
    print(f"\n{'='*72}")
    print(f"  SUMMARY")
    print(f"{'='*72}")
    for label, rows in [("ATR stop", rows_atr), ("Wick stop", rows_wick)]:
        if not rows: continue
        best = max(rows, key=lambda x: x["ann_r"])
        pos  = [r for r in rows if r["ann_r"] > 0]
        edge = "✅ HAS EDGE" if pos else "❌ NO EDGE"
        print(f"  {label:<12}: {edge}  best TP={best['tp']}R  "
              f"ann={best['ann_r']:.1f}R/yr  maxDD={best['max_dd']:.1f}  "
              f"Calmar={best['calmar']:.2f}")

    # Save
    rows_out = ([{"mode": "atr_stop",  **r} for r in rows_atr] +
                [{"mode": "wick_stop", **r} for r in rows_wick])
    out = REPO_ROOT / "cache" / "swing_low_sweep.csv"
    out.parent.mkdir(exist_ok=True)
    pd.DataFrame(rows_out).to_csv(out, index=False)
    print(f"\nSaved → {out}\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db",             default=DEFAULT_DB)
    ap.add_argument("--start",          default="2022-01-01")
    ap.add_argument("--lookback",       type=int,   default=50)
    ap.add_argument("--tolerance",      type=float, default=0.005)
    ap.add_argument("--min-swing",      type=int,   default=5)
    ap.add_argument("--rejection-min",  type=float, default=0.60)
    ap.add_argument("--atr-mult",       type=float, default=2.0)
    ap.add_argument("--buf-mult",       type=float, default=0.15)
    ap.add_argument("--tp-max",         type=float, default=16.0)
    ap.add_argument("--structure",      type=str,   default=None,
                    help="Filter to one regime: BALANCED or IMBALANCED")
    ap.add_argument("--vol-q",          type=str,   default=None,
                    help="Filter to one vol tier: HIGH, MED, or LOW")
    ap.add_argument("--stop-mode",      type=str,   default="both",
                    choices=["atr", "wick", "both"],
                    help="Which stop mode(s) to run")
    ap.add_argument("--tp-levels",      type=str,   default=None,
                    help="Comma-separated exact TP levels, e.g. '12,13.5,15.5,16'")
    args = ap.parse_args()
    main(
        db_path          = args.db,
        lookback         = args.lookback,
        tolerance        = args.tolerance,
        min_swing        = args.min_swing,
        rejection_min    = args.rejection_min,
        atr_mult         = args.atr_mult,
        buf_mult         = args.buf_mult,
        tp_max           = args.tp_max,
        start            = args.start,
        structure_filter = args.structure,
        vol_q_filter     = args.vol_q,
        stop_mode        = args.stop_mode,
        tp_levels        = [float(x) for x in args.tp_levels.split(",")] if args.tp_levels else None,
    )
