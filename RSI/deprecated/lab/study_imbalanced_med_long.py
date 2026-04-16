#!/usr/bin/env python3
"""
IMBALANCED + MED vol — Long strategy study
===========================================

Hypothesis: IMBALANCED + MED vol is the slow-grind trend phase.
Price moves directionally but without the extreme volatility of HIGH vol bars.
Long momentum signals in this regime may offer a more consistent, lower-DD
edge compared to HIGH vol signals where entries are choppier.

Two signal variants:
  A) Raw momentum long  — strong bullish candle, close near high
  B) Bullish FVG long   — same + price left a gap (low[i] > high[i-2])
                          Gap = institutional aggression footprint, acts as
                          a launchpad. Stop anchored below the gap edge.

Signal criteria (IMBALANCED + MED):
  - structure == IMBALANCED  (ER >= 0.35)
  - vol_q == MED
  - close > open  (bullish)
  - body_pct > body_min  (default 0.45 — relaxed vs HIGH vol)
  - close_pct > 0.75  (close in top 25% of range)
  - vol_ratio > vol_min  (default 1.3 — relaxed vs HIGH vol)

FVG variant adds:
  - Bullish FVG: low[i] > high[i-2]
  - fvg_high = low[i] (bottom of gap)
  - Stop = fvg_high - ATR×buf_mult  (just below the gap bottom)

Entry : bar i+1 open
TP    : sweep 2R → 14R
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


# ── Signal collector ──────────────────────────────────────────────────────────

def collect_med_long_signals(
    df1h: pd.DataFrame,
    sym: str,
    vol_ratio_min: float = 1.3,
    body_pct_min: float  = 0.45,
    close_pct_min: float = 0.75,  # close must be in top 25% of range
    fvg_only: bool       = False,
) -> list[dict]:
    """
    IMBALANCED + MED long signals.

    fvg_only : if True, only emit signals where a bullish FVG exists
               (low[i] > high[i-2])
    """
    hi_arr = df1h["high"].values
    lo_arr = df1h["low"].values
    op_arr = df1h["open"].values
    cl_arr = df1h["close"].values
    n      = len(df1h)
    sigs   = []
    min_idx = 62

    for i in range(min_idx, n - 1):
        row = df1h.iloc[i]

        if pd.isna(row.get("atr")) or pd.isna(row.get("vol_q")):
            continue
        if row["structure"] != "IMBALANCED":
            continue
        if row["vol_q"] != "MED":
            continue
        if not (row.get("vol_ratio", 0.0) > vol_ratio_min):
            continue
        if not (row.get("body_pct", 0.0) > body_pct_min):
            continue

        # Bullish candle only
        if not (float(cl_arr[i]) > float(op_arr[i])):
            continue

        cp = float(row.get("close_pct", 0.5))
        if cp < close_pct_min:
            continue

        entry_bar = df1h.iloc[i + 1]
        if pd.isna(entry_bar["open"]):
            continue

        entry_p = float(entry_bar["open"])
        atr_val = float(row["atr"])

        # Bullish FVG: low[i] > high[i-2]
        has_fvg   = False
        fvg_stop  = np.nan   # = low[i] = bottom of the gap; stop goes just below
        if i >= 2 and lo_arr[i] > hi_arr[i - 2]:
            gap_bottom = float(lo_arr[i])
            if gap_bottom < entry_p:     # gap is below our entry → valid support
                has_fvg  = True
                fvg_stop = gap_bottom

        if fvg_only and not has_fvg:
            continue

        sigs.append({
            "side":     +1,
            "sym":      sym,
            "year":     entry_bar.name.year,
            "ts":       entry_bar.name,
            "entry_p":  entry_p,
            "atr":      atr_val,
            "has_fvg":  has_fvg,
            "fvg_stop": fvg_stop,    # bottom of bullish gap
        })

    return sigs


# ── Replay helpers ────────────────────────────────────────────────────────────

def replay_med_long(
    sig: dict,
    df5: pd.DataFrame,
    atr_mult: float,
    tp_r: float,
    fee_bps: float = 3.0,
) -> "ReplayResult | None":
    """ATR-based stop (standard trend-follow)."""
    risk = sig["atr"] * atr_mult
    if risk <= 0:
        return None
    stop_p = sig["entry_p"] - risk     # below entry
    tp_p   = tp_price_from_r(sig["entry_p"], risk, +1, tp_r)
    return replay_trade_5m(
        df5, sig["ts"], +1, sig["entry_p"], stop_p, tp_p, risk,
        fee_bps, be_trigger_r=None, be_offset_r=0.0,
        skip_entry_bucket_hours=0.0,
    )


def replay_med_long_fvg_stop(
    sig: dict,
    df5: pd.DataFrame,
    atr_mult: float,
    buf_mult: float,
    tp_r: float,
    fee_bps: float = 3.0,
) -> "ReplayResult | None":
    """
    Stop anchored just below the bullish FVG bottom.
    Risk basis for TP remains ATR×atr_mult (decoupled, same as BAL_SHORT pattern).
    """
    fvg_stop = sig.get("fvg_stop")
    if fvg_stop is None or (isinstance(fvg_stop, float) and np.isnan(fvg_stop)):
        return None

    risk = sig["atr"] * atr_mult
    if risk <= 0:
        return None

    stop_p = fvg_stop - sig["atr"] * buf_mult   # below gap bottom
    if stop_p >= sig["entry_p"]:                 # invalid geometry
        return None

    tp_p = tp_price_from_r(sig["entry_p"], risk, +1, tp_r)
    return replay_trade_5m(
        df5, sig["ts"], +1, sig["entry_p"], stop_p, tp_p, risk,
        fee_bps, be_trigger_r=None, be_offset_r=0.0,
        skip_entry_bucket_hours=0.0,
    )


# ── Sweep helpers ─────────────────────────────────────────────────────────────

def _sweep(
    sigs: list[dict],
    sym_df5: dict,
    atr_mult: float,
    tp_sweep: list[float],
    n_years: float,
    fvg_stop: bool = False,
    buf_mult: float = 0.15,
) -> list[dict]:
    rows = []
    for tp_r in tp_sweep:
        pnls = []
        for s in sigs:
            fn  = replay_med_long_fvg_stop if fvg_stop else replay_med_long
            res = (fn(s, sym_df5[s["sym"]], atr_mult, buf_mult, tp_r)
                   if fvg_stop
                   else fn(s, sym_df5[s["sym"]], atr_mult, tp_r))
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


def _print_sweep(rows: list[dict], label: str) -> dict | None:
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
        [r for r in rows if r["dd_per_trade"] < 0.10 and r["n"] >= 20],
        key=lambda x: x["ann_r"], reverse=True,
    )[:5]
    print(f"\n  → Best by total_R: TP={best['tp']}R  total={best['total_r']:.1f}  "
          f"win={best['win_pct']}%  maxDD={best['max_dd']:.1f}  ann={best['ann_r']:.1f}R/yr")
    if candidates:
        print(f"  Top 5 (DD/n<0.10, n≥20):")
        for r in candidates:
            print(f"    TP={r['tp']}R  ann={r['ann_r']:.1f}/yr  total={r['total_r']:.1f}  "
                  f"win={r['win_pct']}%  maxDD={r['max_dd']:.1f}  DD/n={r['dd_per_trade']:.3f}")
    return candidates[0] if candidates else best


# ── Main ──────────────────────────────────────────────────────────────────────

def main(
    db_path: str,
    atr_mult: float      = 2.0,
    buf_mult: float      = 0.15,
    vol_ratio_min: float = 1.3,
    body_pct_min: float  = 0.45,
    close_pct_min: float = 0.75,
    tp_max: float        = 14.0,
    start: str           = "2022-01-01",
) -> None:

    tp_sweep = [round(v * 0.5, 2) for v in range(4, int(tp_max / 0.5) + 1)]

    print(f"\nLoading {len(SYMS)} symbols  [{start} → latest]")
    print(f"Regime  : IMBALANCED + MED vol_q")
    print(f"Filters : vol>{vol_ratio_min}  body>{body_pct_min}  close_pct>{close_pct_min}\n")

    all_sigs_raw: list[dict] = []
    all_sigs_fvg: list[dict] = []
    sym_df5: dict[str, pd.DataFrame] = {}

    for sym in SYMS:
        df5, df1h = prepare_sym(db_path, sym, start)
        sym_df5[sym] = df5

        raw = collect_med_long_signals(
            df1h, sym,
            vol_ratio_min=vol_ratio_min,
            body_pct_min=body_pct_min,
            close_pct_min=close_pct_min,
            fvg_only=False,
        )
        fvg = [s for s in raw if s["has_fvg"]]
        all_sigs_raw.extend(raw)
        all_sigs_fvg.extend(fvg)
        print(f"  {sym:<12}  raw={len(raw):>3}  fvg={len(fvg):>3}  "
              f"({len(fvg)/len(raw)*100:.0f}% have FVG)" if raw else
              f"  {sym:<12}  raw=  0  fvg=  0")

    n_years = max((pd.Timestamp("today") - pd.Timestamp(start)).days / 365.25, 1)

    print(f"\n  TOTAL  raw={len(all_sigs_raw)}  fvg_subset={len(all_sigs_fvg)}")
    print(f"\n  Reference — IMBAL_LONG (HIGH vol, same regime ER≥0.35):")
    print(f"    778 signals  19.3% win  +433R total  101R/yr  maxDD=70.3  (TP=12R)")

    # ── A: Raw momentum sweep ─────────────────────────────────────────────
    print(f"\n  Running sweeps in parallel ...")
    with ThreadPoolExecutor(max_workers=2) as ex:
        fut_raw = ex.submit(_sweep, all_sigs_raw, sym_df5, atr_mult, tp_sweep, n_years, False, buf_mult)
        fut_fvg = ex.submit(_sweep, all_sigs_fvg, sym_df5, atr_mult, tp_sweep, n_years, False, buf_mult)
        raw_rows = fut_raw.result()
        fvg_rows = fut_fvg.result()

    best_raw = _print_sweep(
        raw_rows,
        f"A — MED IMBAL LONG raw  |  ATR×{atr_mult}  |  {len(all_sigs_raw)} signals",
    )

    # ── B: FVG-filtered, ATR stop ─────────────────────────────────────────
    best_fvg = _print_sweep(
        fvg_rows,
        f"B — MED IMBAL LONG FVG-filter  |  ATR stop  |  {len(all_sigs_fvg)} signals",
    )

    # ── C: FVG-filtered, FVG stop ─────────────────────────────────────────
    fvg_stop_rows = _sweep(
        all_sigs_fvg, sym_df5, atr_mult, tp_sweep, n_years,
        fvg_stop=True, buf_mult=buf_mult,
    )
    best_fvg_stop = _print_sweep(
        fvg_stop_rows,
        f"C — MED IMBAL LONG FVG-stop  |  buf×{buf_mult}  |  {len(all_sigs_fvg)} signals",
    )

    # ── D: Year breakdown (raw vs fvg at best TPs) ────────────────────────
    best_tp_raw = best_raw["tp"] if best_raw else 6.0
    best_tp_fvg = best_fvg["tp"] if best_fvg else 6.0

    _hdr(
        f"D — Year breakdown  |  raw TP={best_tp_raw}R  |  fvg TP={best_tp_fvg}R",
        ["year", "n_raw", "raw_win%", "raw_R", "n_fvg", "fvg_win%", "fvg_R"],
    )

    yr_raw: dict[int, list] = defaultdict(list)
    yr_fvg: dict[int, list] = defaultdict(list)

    for s in all_sigs_raw:
        res = replay_med_long(s, sym_df5[s["sym"]], atr_mult, best_tp_raw)
        if res: yr_raw[s["year"]].append(res.pnl_r)

    for s in all_sigs_fvg:
        res = replay_med_long(s, sym_df5[s["sym"]], atr_mult, best_tp_fvg)
        if res: yr_fvg[s["year"]].append(res.pnl_r)

    for yr in YEARS:
        ra = np.array(yr_raw.get(yr, []))
        fv = np.array(yr_fvg.get(yr, []))
        _row([yr,
              len(ra), f"{(ra>0).mean()*100:.1f}%" if len(ra) else "—",
              f"{ra.sum():.1f}" if len(ra) else "—",
              len(fv), f"{(fv>0).mean()*100:.1f}%" if len(fv) else "—",
              f"{fv.sum():.1f}" if len(fv) else "—"])

    # ── E: Per-symbol (raw) ───────────────────────────────────────────────
    _hdr(
        f"E — Per-symbol raw  |  TP={best_tp_raw}R",
        ["sym", "n", "win%", "total_R", "maxDD", "ann_R"],
    )
    for sym in SYMS:
        sub  = [s for s in all_sigs_raw if s["sym"] == sym]
        pnls = [r.pnl_r for s in sub
                for r in [replay_med_long(s, sym_df5[sym], atr_mult, best_tp_raw)] if r]
        if not pnls:
            _row([sym, 0, "—", "—", "—", "—"])
            continue
        arr = np.array(pnls)
        _row([sym, len(arr), f"{(arr>0).mean()*100:.1f}%",
              f"{arr.sum():.1f}", f"{_max_dd(arr):.1f}",
              f"{arr.sum()/n_years:.1f}"])

    # ── F: Per-symbol (fvg) ───────────────────────────────────────────────
    _hdr(
        f"F — Per-symbol FVG-filter  |  TP={best_tp_fvg}R",
        ["sym", "n", "win%", "total_R", "maxDD", "ann_R"],
    )
    for sym in SYMS:
        sub  = [s for s in all_sigs_fvg if s["sym"] == sym]
        pnls = [r.pnl_r for s in sub
                for r in [replay_med_long(s, sym_df5[sym], atr_mult, best_tp_fvg)] if r]
        if not pnls:
            _row([sym, 0, "—", "—", "—", "—"])
            continue
        arr = np.array(pnls)
        _row([sym, len(arr), f"{(arr>0).mean()*100:.1f}%",
              f"{arr.sum():.1f}", f"{_max_dd(arr):.1f}",
              f"{arr.sum()/n_years:.1f}"])

    # ── Save ──────────────────────────────────────────────────────────────
    rows_out = (
        [{"variant": "raw", **r} for r in raw_rows] +
        [{"variant": "fvg_atr_stop", **r} for r in fvg_rows] +
        [{"variant": "fvg_fvg_stop", **r} for r in fvg_stop_rows]
    )
    out = REPO_ROOT / "cache" / "imbalanced_med_long_sweep.csv"
    out.parent.mkdir(exist_ok=True)
    pd.DataFrame(rows_out).to_csv(out, index=False)
    print(f"\nSaved → {out}\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db",         default=DEFAULT_DB)
    ap.add_argument("--start",      default="2022-01-01")
    ap.add_argument("--atr-mult",   type=float, default=2.0)
    ap.add_argument("--buf-mult",   type=float, default=0.15)
    ap.add_argument("--vol-ratio",  type=float, default=1.3)
    ap.add_argument("--body-pct",   type=float, default=0.45)
    ap.add_argument("--close-pct",  type=float, default=0.75)
    ap.add_argument("--tp-max",     type=float, default=14.0)
    args = ap.parse_args()

    print("=" * 72)
    print("IMBALANCED + MED vol — Long strategy study")
    print("=" * 72)
    main(
        db_path       = args.db,
        atr_mult      = args.atr_mult,
        buf_mult      = args.buf_mult,
        vol_ratio_min = args.vol_ratio,
        body_pct_min  = args.body_pct,
        close_pct_min = args.close_pct,
        tp_max        = args.tp_max,
        start         = args.start,
    )
