#!/usr/bin/env python3
"""
IMBALANCED + LOW vol — Long strategy study
==========================================

Hypothesis: IMBALANCED + LOW vol is the accumulation phase of a trend.
ER ≥ 0.35 confirms price is moving directionally; LOW vol means it is doing
so without explosive volatility — institutions building positions quietly.
A bullish momentum candle or FVG in this regime signals continuation of a
sustained, grinding uptrend.

Key differences vs IMBALANCED + HIGH:
  - Smaller candles → relaxed body/close thresholds
  - Directional ER check (close > close[i-N]) baked into signal — filters
    IMBALANCED-DOWN (bear grind) without needing an external HTF gate
  - Bullish FVG in LOW vol = high-conviction signal (gap left despite quiet
    conditions = extra institutional aggression)

Signal:
  - structure == IMBALANCED, vol_q == LOW
  - close > close[i - DIR_PERIOD]   (directional filter — bullish ER)
  - close > open  (bullish candle)
  - body_pct > body_min   (default 0.35 — relaxed for LOW vol)
  - close_pct > close_min (default 0.65 — relaxed for LOW vol)
  - vol_ratio > vol_min   (default 1.1  — relaxed for LOW vol)

FVG variant adds:
  - Bullish FVG: low[i] > high[i-2]
  - fvg_bottom = low[i]  →  stop = fvg_bottom − ATR×buf

Sections
--------
A  Signal counts per symbol — raw vs FVG subset
B  TP sweep — raw momentum, ATR stop
C  TP sweep — FVG-filtered, ATR stop
D  TP sweep — FVG-filtered, FVG stop  (structural anchor)
E  TP sweep — Hybrid stop (FVG where available, ATR otherwise), all signals
F  Year breakdown at best config per variant
G  Per-symbol at best config

Usage:
    python lab/study_imbalanced_low_long.py
    python lab/study_imbalanced_low_long.py --body-pct 0.30 --close-pct 0.60
    python lab/study_imbalanced_low_long.py --tp-max 16
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
from lab.sim.exit  import replay_trade_5m, ReplayResult
from lab.sim.entry import tp_price_from_r
from lab.study_imbalanced_trend import _mcl


# ── Constants ─────────────────────────────────────────────────────────────────

DIR_PERIOD = 20   # bars to look back for directional ER check (20h)
ATR_MULT   = 2.0
BUF_MULT   = 0.15


# ── Signal collector ──────────────────────────────────────────────────────────

def collect_low_long_signals(
    df1h: pd.DataFrame,
    sym: str,
    vol_ratio_min: float = 1.1,
    body_pct_min: float  = 0.35,
    close_pct_min: float = 0.65,
    dir_period: int      = DIR_PERIOD,
) -> list[dict]:
    """
    IMBALANCED + LOW vol bullish momentum signals with directional ER filter.

    Directional filter: close[i] > close[i - dir_period]
    Ensures we only take longs when the IMBALANCED move is upward.
    Filters bear-grind IMBALANCED without needing an external HTF gate.
    """
    hi_arr = df1h["high"].values
    lo_arr = df1h["low"].values
    op_arr = df1h["open"].values
    cl_arr = df1h["close"].values
    n      = len(df1h)
    sigs   = []
    min_idx = max(62, dir_period + 1)

    for i in range(min_idx, n - 1):
        row = df1h.iloc[i]

        if pd.isna(row.get("atr")) or pd.isna(row.get("vol_q")):
            continue
        if row["structure"] != "IMBALANCED":
            continue
        if row["vol_q"] != "LOW":
            continue
        if not (row.get("vol_ratio", 0.0) > vol_ratio_min):
            continue
        if not (row.get("body_pct", 0.0) > body_pct_min):
            continue

        # Bullish candle only
        if not (float(cl_arr[i]) > float(op_arr[i])):
            continue

        # Close in upper portion of range
        cp = float(row.get("close_pct", 0.5))
        if cp < close_pct_min:
            continue

        # Directional ER filter — IMBALANCED move must be bullish
        if cl_arr[i] <= cl_arr[i - dir_period]:
            continue

        entry_bar = df1h.iloc[i + 1]
        if pd.isna(entry_bar["open"]):
            continue

        entry_p = float(entry_bar["open"])
        atr_val = float(row["atr"])

        # Bullish FVG: low[i] > high[i-2]
        has_fvg   = False
        fvg_stop  = np.nan
        if i >= 2 and lo_arr[i] > hi_arr[i - 2]:
            gap_bottom = float(lo_arr[i])
            if gap_bottom < entry_p:
                has_fvg  = True
                fvg_stop = gap_bottom

        sigs.append({
            "side":     +1,
            "sym":      sym,
            "year":     entry_bar.name.year,
            "ts":       entry_bar.name,
            "entry_p":  entry_p,
            "atr":      atr_val,
            "has_fvg":  has_fvg,
            "fvg_stop": fvg_stop,
        })

    return sigs


# ── Replay helpers ────────────────────────────────────────────────────────────

def _replay_atr(sig: dict, df5: pd.DataFrame, tp_r: float,
                fee_bps: float = 3.0) -> "ReplayResult | None":
    risk = sig["atr"] * ATR_MULT
    if risk <= 0:
        return None
    stop_p = sig["entry_p"] - risk
    tp_p   = tp_price_from_r(sig["entry_p"], risk, +1, tp_r)
    return replay_trade_5m(
        df5, sig["ts"], +1, sig["entry_p"], stop_p, tp_p,
        risk, fee_bps, be_trigger_r=None, be_offset_r=0.0,
        skip_entry_bucket_hours=0.0,
    )


def _replay_fvg_stop(sig: dict, df5: pd.DataFrame, tp_r: float,
                     buf_mult: float = BUF_MULT,
                     fee_bps: float = 3.0) -> "ReplayResult | None":
    fvg = sig.get("fvg_stop")
    if fvg is None or (isinstance(fvg, float) and np.isnan(fvg)):
        return None
    risk = sig["atr"] * ATR_MULT
    if risk <= 0:
        return None
    stop_p = fvg - sig["atr"] * buf_mult
    if stop_p >= sig["entry_p"]:
        return None
    tp_p = tp_price_from_r(sig["entry_p"], risk, +1, tp_r)
    return replay_trade_5m(
        df5, sig["ts"], +1, sig["entry_p"], stop_p, tp_p,
        risk, fee_bps, be_trigger_r=None, be_offset_r=0.0,
        skip_entry_bucket_hours=0.0,
    )


def _replay_hybrid(sig: dict, df5: pd.DataFrame, tp_r: float,
                   fee_bps: float = 3.0) -> "ReplayResult | None":
    """FVG stop when available, ATR stop otherwise."""
    if sig["has_fvg"] and not np.isnan(sig.get("fvg_stop", np.nan)):
        return _replay_fvg_stop(sig, df5, tp_r, fee_bps=fee_bps)
    return _replay_atr(sig, df5, tp_r, fee_bps=fee_bps)


# ── Sweep ─────────────────────────────────────────────────────────────────────

def _sweep(
    sigs: list[dict],
    sym_df5: dict,
    tp_list: list[float],
    n_years: float,
    replay_fn,
    **replay_kwargs,
) -> list[dict]:
    rows = []
    for tp_r in tp_list:
        pnls = []
        for s in sigs:
            res = replay_fn(s, sym_df5[s["sym"]], tp_r, **replay_kwargs)
            if res:
                pnls.append(res.pnl_r)
        if not pnls:
            continue
        arr = np.array(pnls)
        dd  = _max_dd(arr)
        n   = len(arr)
        rows.append(dict(
            tp=tp_r, n=n,
            win_pct=round((arr > 0).mean() * 100, 1),
            avg_r=round(float(arr.mean()), 4),
            total_r=round(float(arr.sum()), 2),
            max_dd=round(dd, 2),
            dd_per_trade=round(dd / n, 4),
            mcl=_mcl(arr),
            ann_r=round(float(arr.sum()) / n_years, 1),
        ))
    return rows


def _print_sweep(rows: list[dict], label: str, dd_n_thresh: float = 0.10) -> dict | None:
    _hdr(label, ["TP", "n", "win%", "avg_R", "total_R", "maxDD", "DD/n", "MCL", "ann_R"])
    for r in rows:
        _row([f"{r['tp']}R", r["n"], f"{r['win_pct']}%",
              f"{r['avg_r']:.4f}", f"{r['total_r']:.1f}",
              f"{r['max_dd']:.1f}", f"{r['dd_per_trade']:.3f}",
              r["mcl"], f"{r['ann_r']:.1f}"])
    if not rows:
        return None
    best = max(rows, key=lambda x: x["total_r"])
    candidates = sorted(
        [r for r in rows if r["dd_per_trade"] < dd_n_thresh and r["n"] >= 15],
        key=lambda x: x["ann_r"], reverse=True,
    )[:5]
    print(f"\n  → Best by total_R: TP={best['tp']}R  total={best['total_r']:.1f}  "
          f"win={best['win_pct']}%  maxDD={best['max_dd']:.1f}  ann={best['ann_r']:.1f}R/yr")
    if candidates:
        print(f"  Top configs (DD/n<{dd_n_thresh}, n≥15):")
        for r in candidates:
            print(f"    TP={r['tp']}R  ann={r['ann_r']:.1f}/yr  total={r['total_r']:.1f}  "
                  f"win={r['win_pct']}%  maxDD={r['max_dd']:.1f}  DD/n={r['dd_per_trade']:.3f}")
    return candidates[0] if candidates else best


def _year_breakdown(
    sigs: list[dict],
    sym_df5: dict,
    tp_r: float,
    n_years: float,
    replay_fn,
    label: str,
    **replay_kwargs,
) -> None:
    _hdr(label, ["year", "n", "win%", "total_R", "maxDD", "ann_R"])
    yr_data: dict[int, list] = defaultdict(list)
    for s in sigs:
        res = replay_fn(s, sym_df5[s["sym"]], tp_r, **replay_kwargs)
        if res:
            yr_data[s["year"]].append(res.pnl_r)
    for yr in YEARS:
        arr = np.array(yr_data.get(yr, []))
        if not len(arr):
            _row([yr, 0, "—", "—", "—", "—"])
            continue
        _row([yr, len(arr), f"{(arr > 0).mean() * 100:.1f}%",
              f"{arr.sum():.1f}", f"{_max_dd(arr):.1f}",
              f"{arr.sum() / n_years:.1f}"])


def _per_symbol(
    sigs: list[dict],
    sym_df5: dict,
    tp_r: float,
    n_years: float,
    replay_fn,
    label: str,
    **replay_kwargs,
) -> None:
    _hdr(label, ["sym", "n", "win%", "total_R", "maxDD", "ann_R"])
    for sym in SYMS:
        sub  = [s for s in sigs if s["sym"] == sym]
        pnls = [r.pnl_r for s in sub
                for r in [replay_fn(s, sym_df5[sym], tp_r, **replay_kwargs)] if r]
        if not pnls:
            _row([sym, 0, "—", "—", "—", "—"])
            continue
        arr = np.array(pnls)
        _row([sym, len(arr), f"{(arr > 0).mean() * 100:.1f}%",
              f"{arr.sum():.1f}", f"{_max_dd(arr):.1f}",
              f"{arr.sum() / n_years:.1f}"])


# ── Side-by-side comparison ───────────────────────────────────────────────────

def _compare_table(
    tp_list: list[float],
    maps: list[tuple[str, dict]],
) -> None:
    """Print variants side by side for easy comparison."""
    col_w = 36
    header = f"  {'TP':>5}  │"
    for label, _ in maps:
        header += f"  {label:^{col_w}}  │"
    print(f"\n{'='*( 9 + (col_w+5)*len(maps) )}")
    print(f"  SIDE-BY-SIDE COMPARISON")
    print(f"{'='*( 9 + (col_w+5)*len(maps) )}")

    sub = f"  {'':>5}  │"
    for _ in maps:
        sub += f"  {'ann_R':>8} {'maxDD':>7} {'win%':>6} {'DD/n':>6}  │"
    print(header)
    print(sub)
    print(f"  {'-'*(7 + (col_w+5)*len(maps))}")

    for tp in tp_list:
        line = f"  {tp:>4.1f}R │"
        for _, m in maps:
            r = m.get(tp, {})
            if r:
                line += (f"  {r['ann_r']:>8.1f} {r['max_dd']:>7.1f}"
                         f" {r['win_pct']:>5.1f}% {r['dd_per_trade']:>6.3f}  │")
            else:
                line += f"  {'—':>8} {'—':>7} {'—':>6} {'—':>6}  │"
        print(line)


# ── Main ──────────────────────────────────────────────────────────────────────

def main(
    db_path: str,
    vol_ratio_min: float = 1.1,
    body_pct_min: float  = 0.35,
    close_pct_min: float = 0.65,
    dir_period: int      = DIR_PERIOD,
    tp_max: float        = 16.0,
    start: str           = "2022-01-01",
) -> None:

    tp_list = [round(v * 0.5, 2) for v in range(4, int(tp_max / 0.5) + 1)]

    # ── Load ──────────────────────────────────────────────────────────────
    print(f"\nLoading {len(SYMS)} symbols  [{start} → latest]")
    print(f"Regime  : IMBALANCED + LOW vol_q")
    print(f"Filters : vol>{vol_ratio_min}  body>{body_pct_min}  close_pct>{close_pct_min}  "
          f"dir_period={dir_period}h\n")

    all_sigs: list[dict] = []
    sym_df5: dict[str, pd.DataFrame] = {}

    for sym in SYMS:
        df5, df1h = prepare_sym(db_path, sym, start)
        sym_df5[sym] = df5
        sigs = collect_low_long_signals(
            df1h, sym,
            vol_ratio_min=vol_ratio_min,
            body_pct_min=body_pct_min,
            close_pct_min=close_pct_min,
            dir_period=dir_period,
        )
        fvg_n = sum(1 for s in sigs if s["has_fvg"])
        all_sigs.extend(sigs)
        pct = f"{fvg_n/len(sigs)*100:.0f}%" if sigs else "—"
        print(f"  {sym:<12}  total={len(sigs):>3}  fvg={fvg_n:>3}  ({pct} have FVG)")

    fvg_sigs = [s for s in all_sigs if s["has_fvg"]]
    n_years  = max((pd.Timestamp("today") - pd.Timestamp(start)).days / 365.25, 1)

    print(f"\n  TOTAL  raw={len(all_sigs)}  fvg_subset={len(fvg_sigs)}  "
          f"({len(fvg_sigs)/len(all_sigs)*100:.0f}% have FVG)" if all_sigs else
          f"\n  TOTAL  0 signals — check thresholds")

    if not all_sigs:
        return

    print(f"\n  Reference — IMBAL_LONG (HIGH vol): "
          f"778 sigs  12.1% win  433R  101R/yr  maxDD=70.3  (TP=12R)")

    # ── Parallel sweeps ───────────────────────────────────────────────────
    print(f"\n  Running 4 sweeps in parallel ...\n")
    with ThreadPoolExecutor(max_workers=4) as ex:
        fut_raw    = ex.submit(_sweep, all_sigs,  sym_df5, tp_list, n_years, _replay_atr)
        fut_fvg_a  = ex.submit(_sweep, fvg_sigs,  sym_df5, tp_list, n_years, _replay_atr)
        fut_fvg_s  = ex.submit(_sweep, fvg_sigs,  sym_df5, tp_list, n_years, _replay_fvg_stop)
        fut_hybrid = ex.submit(_sweep, all_sigs,  sym_df5, tp_list, n_years, _replay_hybrid)
        rows_raw    = fut_raw.result()
        rows_fvg_a  = fut_fvg_a.result()
        rows_fvg_s  = fut_fvg_s.result()
        rows_hybrid = fut_hybrid.result()

    # ── Section B — Raw ATR ───────────────────────────────────────────────
    best_raw = _print_sweep(
        rows_raw,
        f"B — Raw momentum  ATR stop  |  {len(all_sigs)} signals",
    )

    # ── Section C — FVG-filtered ATR ──────────────────────────────────────
    best_fvg_a = _print_sweep(
        rows_fvg_a,
        f"C — FVG-filtered  ATR stop  |  {len(fvg_sigs)} signals",
    )

    # ── Section D — FVG-filtered FVG stop ────────────────────────────────
    best_fvg_s = _print_sweep(
        rows_fvg_s,
        f"D — FVG-filtered  FVG stop  buf×{BUF_MULT}  |  {len(fvg_sigs)} signals",
    )

    # ── Section E — Hybrid ────────────────────────────────────────────────
    best_hybrid = _print_sweep(
        rows_hybrid,
        f"E — Hybrid stop (FVG where avail, ATR otherwise)  |  {len(all_sigs)} signals",
    )

    # ── Side-by-side ──────────────────────────────────────────────────────
    _compare_table(
        tp_list,
        [
            (f"Raw ATR ({len(all_sigs)})", {r["tp"]: r for r in rows_raw}),
            (f"FVG ATR ({len(fvg_sigs)})",  {r["tp"]: r for r in rows_fvg_a}),
            (f"FVG stop ({len(fvg_sigs)})", {r["tp"]: r for r in rows_fvg_s}),
            (f"Hybrid ({len(all_sigs)})",   {r["tp"]: r for r in rows_hybrid}),
        ],
    )

    # ── Section F — Year breakdown best per variant ───────────────────────
    for label, sigs, best, fn in [
        ("raw ATR",   all_sigs,  best_raw,    _replay_atr),
        ("FVG ATR",   fvg_sigs,  best_fvg_a,  _replay_atr),
        ("FVG stop",  fvg_sigs,  best_fvg_s,  _replay_fvg_stop),
        ("Hybrid",    all_sigs,  best_hybrid, _replay_hybrid),
    ]:
        if best is None:
            continue
        _year_breakdown(
            sigs, sym_df5, best["tp"], n_years, fn,
            f"F — Year breakdown  {label}  TP={best['tp']}R",
        )

    # ── Section G — Per-symbol at best raw ───────────────────────────────
    if best_raw:
        _per_symbol(
            all_sigs, sym_df5, best_raw["tp"], n_years, _replay_atr,
            f"G — Per-symbol  raw ATR  TP={best_raw['tp']}R",
        )
    if best_hybrid:
        _per_symbol(
            all_sigs, sym_df5, best_hybrid["tp"], n_years, _replay_hybrid,
            f"G2 — Per-symbol  Hybrid  TP={best_hybrid['tp']}R",
        )

    # ── Save ──────────────────────────────────────────────────────────────
    rows_out = (
        [{"variant": "raw_atr",    **r} for r in rows_raw]    +
        [{"variant": "fvg_atr",    **r} for r in rows_fvg_a]  +
        [{"variant": "fvg_stop",   **r} for r in rows_fvg_s]  +
        [{"variant": "hybrid",     **r} for r in rows_hybrid]
    )
    out = REPO_ROOT / "cache" / "imbalanced_low_long_sweep.csv"
    out.parent.mkdir(exist_ok=True)
    pd.DataFrame(rows_out).to_csv(out, index=False)
    print(f"\nSaved → {out}\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db",          default=DEFAULT_DB)
    ap.add_argument("--start",       default="2022-01-01")
    ap.add_argument("--vol-ratio",   type=float, default=1.1)
    ap.add_argument("--body-pct",    type=float, default=0.35)
    ap.add_argument("--close-pct",   type=float, default=0.65)
    ap.add_argument("--dir-period",  type=int,   default=DIR_PERIOD)
    ap.add_argument("--tp-max",      type=float, default=16.0)
    args = ap.parse_args()

    print("=" * 72)
    print("IMBALANCED + LOW vol — Long strategy study")
    print("=" * 72)
    main(
        db_path       = args.db,
        vol_ratio_min = args.vol_ratio,
        body_pct_min  = args.body_pct,
        close_pct_min = args.close_pct,
        dir_period    = args.dir_period,
        tp_max        = args.tp_max,
        start         = args.start,
    )
