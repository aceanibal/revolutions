#!/usr/bin/env python3
"""
IMBALANCED regime trend-follow study
=====================================

Hypothesis: When the market is trending (IMBALANCED) with high volatility,
a strong momentum candle in the trend direction should continue rather than
revert. The opposite of our BALANCED mean-reversion short strategy.

Signal
------
  IMBALANCED + HIGH vol_q + strong body + close at extreme:

  Short (bearish trend):
    structure == IMBALANCED, vol_q == HIGH
    close < open  (bearish)
    body_pct > body_min   (strong body)
    close_pct < close_max (close near low)
    vol_ratio > vol_min

  Long (bullish trend):
    structure == IMBALANCED, vol_q == HIGH
    close > open  (bullish)
    body_pct > body_min
    close_pct > (1 - close_max)   (close near high)
    vol_ratio > vol_min

Entry : bar i+1 open (Rule 1 — no look-ahead)
Stop  : entry ± ATR × atr_mult   (standard)
TP    : sweep 1.5R → 12R (trend following → wider TPs)

Sections
--------
A. Signal counts — both directions, per symbol
B. TP sweep — SHORTS only
C. TP sweep — LONGS only
D. TP sweep — COMBINED (both directions on same account)
E. Year breakdown at best TP per direction
F. Per-symbol at best TP

No FVG filter — this is the raw baseline.
Add --fvg flag to restrict to FVG-tagged bars for a quality filter test.

Usage:
    python lab/study_imbalanced_trend.py
    python lab/study_imbalanced_trend.py --fvg
    python lab/study_imbalanced_trend.py --start 2023-01-01 --tp-max 15
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
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
    prepare_sym,
)
from lab.sim.exit import replay_trade_5m, ReplayResult
from lab.sim.entry import tp_price_from_r


# ── Signal collector ───────────────────────────────────────────────────────

def collect_imbalanced_signals(
    df1h: pd.DataFrame,
    sym: str,
    vol_ratio_min: float = 1.8,
    body_pct_min: float  = 0.55,
    close_pct_max: float = 0.15,   # for shorts (close near low)
    fvg_only: bool       = False,
) -> list[dict]:
    """
    Collect IMBALANCED+HIGH momentum signals for both directions.

    close_pct_max : threshold for short (close near low)
                    same value used as 1-threshold for long (close near high)
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
        if row["vol_q"] != "HIGH":
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
        cp      = float(row["close_pct"])
        is_bear = float(row["close"]) < float(row["open"])
        is_bull = float(row["close"]) > float(row["open"])

        # FVG detection (bearish: high[i] < low[i-2])
        has_fvg  = False
        fvg_low  = np.nan
        fvg_high = np.nan
        if i >= 2 and hi_arr[i] < lo_arr[i - 2]:
            fl, fh = float(hi_arr[i]), float(lo_arr[i - 2])
            if fl > entry_p:
                has_fvg, fvg_low, fvg_high = True, fl, fh

        # Bearish short signal
        if is_bear and cp < close_pct_max:
            if fvg_only and not has_fvg:
                continue
            sigs.append({
                "side": -1, "sym": sym, "year": entry_bar.name.year,
                "ts": entry_bar.name, "entry_p": entry_p, "atr": atr_val,
                "has_fvg": has_fvg,
                # fvg_stop: bottom of bearish gap (high[i]) — stop goes above this
                "fvg_stop": fvg_low,   # = high[i], stop = fvg_stop + buf×ATR
                "fvg_low": fvg_low, "fvg_high": fvg_high,
            })

        # Bullish long signal (close near high)
        elif is_bull and cp > (1.0 - close_pct_max):
            # FVG check for longs: bullish FVG = low[i] > high[i-2]
            has_bull_fvg = False
            fvg_stop_long = np.nan
            if i >= 2 and lo_arr[i] > hi_arr[i - 2]:
                bfl = float(lo_arr[i])
                if bfl < entry_p:    # gap below entry → valid for long
                    has_bull_fvg = True
                    fvg_stop_long = bfl   # top of bullish gap (low[i]), stop goes below
            if fvg_only and not has_bull_fvg:
                continue
            sigs.append({
                "side": +1, "sym": sym, "year": entry_bar.name.year,
                "ts": entry_bar.name, "entry_p": entry_p, "atr": atr_val,
                "has_fvg": has_bull_fvg,
                # fvg_stop: top of bullish gap (low[i]) — stop goes below this
                "fvg_stop": fvg_stop_long,  # stop = fvg_stop - buf×ATR
                "fvg_low": np.nan, "fvg_high": np.nan,
            })

    return sigs


# ── Replay ────────────────────────────────────────────────────────────────

def replay_trend(
    sig: dict,
    df5: pd.DataFrame,
    atr_mult: float,
    tp_r: float,
    fee_bps: float = 3.0,
) -> "ReplayResult | None":
    side    = sig["side"]
    entry_p = sig["entry_p"]
    risk    = sig["atr"] * atr_mult
    if risk <= 0:
        return None
    stop_p = entry_p - side * risk   # short: above entry (+risk), long: below entry (-risk)
    tp_p   = tp_price_from_r(entry_p, risk, side, tp_r)
    return replay_trade_5m(
        df5, sig["ts"], side, entry_p, stop_p, tp_p, risk, fee_bps,
        be_trigger_r=None, be_offset_r=0.0, skip_entry_bucket_hours=0.0,
    )


def replay_trend_fvg_stop(
    sig: dict,
    df5: pd.DataFrame,
    atr_mult: float,
    buf_mult: float,
    tp_r: float,
    fee_bps: float = 3.0,
) -> "ReplayResult | None":
    """Same as replay_trend but stop is placed at the FVG edge + buffer.

    Short: stop = fvg_stop + ATR×buf  (just above bottom of bearish gap)
    Long:  stop = fvg_stop - ATR×buf  (just below top of bullish gap)
    Risk for TP calc remains ATR×atr_mult (standard basis, same as replay_trend).
    """
    side    = sig["side"]
    entry_p = sig["entry_p"]
    atr_val = sig["atr"]
    fvg_stop = sig.get("fvg_stop")

    if fvg_stop is None or (isinstance(fvg_stop, float) and np.isnan(fvg_stop)):
        return None  # no FVG on this bar

    risk = atr_val * atr_mult   # unchanged risk basis for TP
    if risk <= 0:
        return None

    if side == -1:   # short: stop above entry
        stop_p = fvg_stop + atr_val * buf_mult
        if stop_p <= entry_p:   # gap below entry — invalid
            return None
    else:            # long: stop below entry
        stop_p = fvg_stop - atr_val * buf_mult
        if stop_p >= entry_p:   # gap above entry — invalid
            return None

    tp_p = tp_price_from_r(entry_p, risk, side, tp_r)
    return replay_trade_5m(
        df5, sig["ts"], side, entry_p, stop_p, tp_p, risk, fee_bps,
        be_trigger_r=None, be_offset_r=0.0, skip_entry_bucket_hours=0.0,
    )


# ── Stats ─────────────────────────────────────────────────────────────────

def _run_tp_sweep(
    subset: list[dict],
    sym_df5: dict,
    atr_mult: float,
    tp_sweep: list[float],
    n_years: float,
) -> list[dict]:
    rows = []
    for tp_r in tp_sweep:
        pnls = []
        for s in subset:
            res = replay_trend(s, sym_df5[s["sym"]], atr_mult, tp_r)
            if res:
                pnls.append(res.pnl_r)
        if not pnls:
            continue
        arr = np.array(pnls)
        dd  = _max_dd(arr)
        n   = len(arr)
        rows.append(dict(
            tp=tp_r, n=n,
            win_pct=round((arr>0).mean()*100, 1),
            avg_r=round(float(arr.mean()), 4),
            total_r=round(float(arr.sum()), 2),
            max_dd=round(dd, 2),
            dd_per_trade=round(dd/n, 4),
            mcl=int(sum(1 for p in arr if p<0)),   # quick proxy, proper MCL below
            ann_r=round(float(arr.sum())/n_years, 1),
        ))
    return rows


def _mcl(pnls: np.ndarray) -> int:
    best, cur = 0, 0
    for p in pnls:
        cur = cur + 1 if p < 0 else 0
        best = max(best, cur)
    return best


def _run_tp_sweep_full(
    subset: list[dict],
    sym_df5: dict,
    atr_mult: float,
    tp_sweep: list[float],
    n_years: float,
) -> list[dict]:
    rows = []
    for tp_r in tp_sweep:
        pnls = []
        for s in subset:
            res = replay_trend(s, sym_df5[s["sym"]], atr_mult, tp_r)
            if res:
                pnls.append(res.pnl_r)
        if not pnls:
            continue
        arr = np.array(pnls)
        dd  = _max_dd(arr)
        n   = len(arr)
        rows.append(dict(
            tp=tp_r, n=n,
            win_pct=round((arr>0).mean()*100, 1),
            avg_r=round(float(arr.mean()), 4),
            total_r=round(float(arr.sum()), 2),
            max_dd=round(dd, 2),
            dd_per_trade=round(dd/n, 4),
            mcl=_mcl(arr),
            ann_r=round(float(arr.sum())/n_years, 1),
        ))
    return rows


def _print_sweep(rows: list[dict], label: str, n_sigs: int, n_years: float) -> dict | None:
    """Print sweep table, return best safe config."""
    _hdr(label, ["TP", "n", "win%", "avg_R", "total_R", "maxDD", "DD/n", "MCL", "ann_R"])
    for r in rows:
        _row([f"{r['tp']}R", r["n"], f"{r['win_pct']}%", f"{r['avg_r']:.4f}",
              f"{r['total_r']:.1f}", f"{r['max_dd']:.1f}",
              f"{r['dd_per_trade']:.3f}", r["mcl"], f"{r['ann_r']:.1f}"])

    if not rows:
        return None

    best = max(rows, key=lambda x: x["total_r"])
    candidates = sorted(
        [r for r in rows if r["dd_per_trade"] < 0.08 and r["n"] >= 20],
        key=lambda x: x["ann_r"], reverse=True,
    )[:5]
    print(f"\n  → Best by total_R: TP={best['tp']}R  total={best['total_r']:.1f}  "
          f"win={best['win_pct']}%  maxDD={best['max_dd']:.1f}  ann={best['ann_r']:.1f}R/yr")
    if candidates:
        print(f"  Top 5 (DD/n<0.08):")
        for r in candidates:
            print(f"    TP={r['tp']}R  ann={r['ann_r']:.1f}/yr  total={r['total_r']:.1f}  "
                  f"win={r['win_pct']}%  maxDD={r['max_dd']:.1f}  DD/n={r['dd_per_trade']:.3f}")
    return candidates[0] if candidates else best


# ── Main ───────────────────────────────────────────────────────────────────

def _run_tp_sweep_fvg_stop(
    subset: list[dict],
    sym_df5: dict,
    atr_mult: float,
    buf_mult: float,
    tp_sweep: list[float],
    n_years: float,
) -> list[dict]:
    rows = []
    for tp_r in tp_sweep:
        pnls = []
        for s in subset:
            res = replay_trend_fvg_stop(s, sym_df5[s["sym"]], atr_mult, buf_mult, tp_r)
            if res:
                pnls.append(res.pnl_r)
        if not pnls:
            continue
        arr = np.array(pnls)
        dd  = _max_dd(arr)
        n   = len(arr)
        rows.append(dict(
            tp=tp_r, n=n,
            win_pct=round((arr>0).mean()*100, 1),
            avg_r=round(float(arr.mean()), 4),
            total_r=round(float(arr.sum()), 2),
            max_dd=round(dd, 2),
            dd_per_trade=round(dd/n, 4),
            mcl=_mcl(arr),
            ann_r=round(float(arr.sum())/n_years, 1),
        ))
    return rows


def main(
    db_path: str,
    atr_mult: float       = 2.0,
    buf_mult: float       = 0.15,
    vol_ratio_min: float  = 1.8,
    body_pct_min: float   = 0.55,
    close_pct_max: float  = 0.15,
    tp_max: float         = 12.0,
    fvg_only: bool        = False,
    fvg_stop: bool        = False,
    start: str            = "2022-01-01",
) -> None:

    tp_sweep = [round(v * 0.5, 2) for v in range(3, int(tp_max / 0.5) + 1)]

    # ── Load ──────────────────────────────────────────────────────────────
    all_sigs: list[dict] = []
    sym_df5:  dict[str, pd.DataFrame] = {}

    label_fvg = "  FVG-only" if fvg_only else "  no FVG filter"
    print(f"\nLoading {len(SYMS)} symbols  [{start} → latest]")
    print(f"Filters : vol>{vol_ratio_min}  body>{body_pct_min}  close<{close_pct_max}")
    print(f"Regime  : IMBALANCED + HIGH vol_q  {label_fvg}\n")

    for sym in SYMS:
        df5, df1h = prepare_sym(db_path, sym, start)
        sym_df5[sym] = df5
        sigs = collect_imbalanced_signals(
            df1h, sym,
            vol_ratio_min=vol_ratio_min,
            body_pct_min=body_pct_min,
            close_pct_max=close_pct_max,
            fvg_only=fvg_only,
        )
        all_sigs.extend(sigs)
        bears = sum(1 for s in sigs if s["side"] == -1)
        bulls = sum(1 for s in sigs if s["side"] == +1)
        print(f"  {sym:<12} shorts={bears:>3}  longs={bulls:>3}  total={len(sigs):>3}")

    n_years = max((pd.Timestamp("today") - pd.Timestamp(start)).days / 365.25, 1)
    bear_sigs = [s for s in all_sigs if s["side"] == -1]
    bull_sigs = [s for s in all_sigs if s["side"] == +1]

    print(f"\n  TOTAL  shorts={len(bear_sigs)}  longs={len(bull_sigs)}  "
          f"combined={len(all_sigs)}")

    # ── Compare to BALANCED baseline ──────────────────────────────────────
    print(f"\n  BALANCED baseline (shorts only): 226 sigs  29.6% win  "
          f"142.3R  maxDD=10.3  33.2R/yr  (TP=4.25R)")

    # ── Section B+C: Short and Long TP sweeps in parallel ────────────────
    print(f"\n  Running sweeps in parallel: {len(bear_sigs)} shorts × {len(tp_sweep)} TPs"
          f"  |  {len(bull_sigs)} longs × {len(tp_sweep)} TPs ...")
    with ThreadPoolExecutor(max_workers=2) as ex:
        fut_short = ex.submit(_run_tp_sweep_full, bear_sigs, sym_df5, atr_mult, tp_sweep, n_years)
        fut_long  = ex.submit(_run_tp_sweep_full, bull_sigs, sym_df5, atr_mult, tp_sweep, n_years)
        short_rows = fut_short.result()
        long_rows  = fut_long.result()

    best_short = _print_sweep(
        short_rows,
        f"B — TP sweep  |  IMBALANCED SHORT  |  ATR×{atr_mult}  |  {len(bear_sigs)} signals",
        len(bear_sigs), n_years,
    )
    best_long = _print_sweep(
        long_rows,
        f"C — TP sweep  |  IMBALANCED LONG  |  ATR×{atr_mult}  |  {len(bull_sigs)} signals",
        len(bull_sigs), n_years,
    )

    # ── Section D: Combined ────────────────────────────────────────────────
    # Use best TP from each direction independently on the combined account
    best_short_tp = best_short["tp"] if best_short else 3.0
    best_long_tp  = best_long["tp"]  if best_long  else 3.0

    _hdr(
        f"D — Combined short+long  |  short TP={best_short_tp}R  long TP={best_long_tp}R",
        ["direction", "n", "win%", "avg_R", "total_R", "maxDD", "DD/n", "ann_R"],
    )
    for label, sigs, tp_r in [
        ("SHORT", bear_sigs, best_short_tp),
        ("LONG",  bull_sigs, best_long_tp),
    ]:
        pnls = []
        for s in sigs:
            res = replay_trend(s, sym_df5[s["sym"]], atr_mult, tp_r)
            if res: pnls.append(res.pnl_r)
        arr = np.array(pnls)
        dd  = _max_dd(arr)
        n   = len(arr)
        ann = round(float(arr.sum())/n_years, 1)
        _row([label, n, f"{(arr>0).mean()*100:.1f}%",
              f"{arr.mean():.4f}", f"{arr.sum():.1f}",
              f"{dd:.1f}", f"{dd/n:.3f}", f"{ann:.1f}"])

    # Combined P&L
    all_pnls = []
    for s in bear_sigs:
        res = replay_trend(s, sym_df5[s["sym"]], atr_mult, best_short_tp)
        if res: all_pnls.append(res.pnl_r)
    for s in bull_sigs:
        res = replay_trend(s, sym_df5[s["sym"]], atr_mult, best_long_tp)
        if res: all_pnls.append(res.pnl_r)
    arr_all = np.array(all_pnls)
    dd_all  = _max_dd(arr_all)
    ann_all = round(float(arr_all.sum())/n_years, 1)
    _row(["COMBINED", len(arr_all), f"{(arr_all>0).mean()*100:.1f}%",
          f"{arr_all.mean():.4f}", f"{arr_all.sum():.1f}",
          f"{dd_all:.1f}", f"{dd_all/len(arr_all):.3f}", f"{ann_all:.1f}"])

    # ── Section E: Year breakdown ──────────────────────────────────────────
    _hdr(
        f"E — Year breakdown  |  short TP={best_short_tp}R  long TP={best_long_tp}R",
        ["year", "n_sh", "sh_win%", "sh_R", "n_lg", "lg_win%", "lg_R", "total_R"],
    )

    yr_sh: dict[int, list] = defaultdict(list)
    yr_lg: dict[int, list] = defaultdict(list)

    for s in bear_sigs:
        res = replay_trend(s, sym_df5[s["sym"]], atr_mult, best_short_tp)
        if res: yr_sh[s["year"]].append(res.pnl_r)
    for s in bull_sigs:
        res = replay_trend(s, sym_df5[s["sym"]], atr_mult, best_long_tp)
        if res: yr_lg[s["year"]].append(res.pnl_r)

    for yr in YEARS:
        sh = np.array(yr_sh.get(yr, []))
        lg = np.array(yr_lg.get(yr, []))
        tot = round(sh.sum() + lg.sum(), 1)
        _row([yr,
              len(sh), f"{(sh>0).mean()*100:.1f}%" if len(sh) else "—",
              f"{sh.sum():.1f}" if len(sh) else "—",
              len(lg), f"{(lg>0).mean()*100:.1f}%" if len(lg) else "—",
              f"{lg.sum():.1f}" if len(lg) else "—",
              f"{tot:.1f}"])

    # ── Section F: Per-symbol ──────────────────────────────────────────────
    _hdr(
        f"F — Per-symbol  |  short TP={best_short_tp}R  long TP={best_long_tp}R",
        ["sym", "n_sh", "sh_win%", "sh_R", "sh_DD",
                "n_lg", "lg_win%", "lg_R", "lg_DD"],
    )
    for sym in SYMS:
        sh_sub = [s for s in bear_sigs if s["sym"] == sym]
        lg_sub = [s for s in bull_sigs if s["sym"] == sym]
        sh_res = [r for s in sh_sub for r in [replay_trend(s, sym_df5[sym], atr_mult, best_short_tp)] if r]
        lg_res = [r for s in lg_sub for r in [replay_trend(s, sym_df5[sym], atr_mult, best_long_tp)]  if r]
        sh_arr = np.array([r.pnl_r for r in sh_res])
        lg_arr = np.array([r.pnl_r for r in lg_res])
        _row([sym,
              len(sh_arr),
              f"{(sh_arr>0).mean()*100:.1f}%" if len(sh_arr) else "—",
              f"{sh_arr.sum():.1f}" if len(sh_arr) else "—",
              f"{_max_dd(sh_arr):.1f}" if len(sh_arr) else "—",
              len(lg_arr),
              f"{(lg_arr>0).mean()*100:.1f}%" if len(lg_arr) else "—",
              f"{lg_arr.sum():.1f}" if len(lg_arr) else "—",
              f"{_max_dd(lg_arr):.1f}" if len(lg_arr) else "—",
              ])

    # ── Section G/H/I: FVG-stop sweep ────────────────────────────────────
    if fvg_stop:
        fvg_tps = [3.0, 5.0, 8.0, 12.0]

        bear_fvg = [s for s in bear_sigs if s.get("has_fvg")]
        bull_fvg = [s for s in bull_sigs if s.get("has_fvg")]

        print(f"\n  FVG-stop signals: {len(bear_fvg)} shorts  {len(bull_fvg)} longs  "
              f"(buf×{buf_mult}  4 TPs: {fvg_tps})")

        with ThreadPoolExecutor(max_workers=2) as ex:
            fut_sh = ex.submit(_run_tp_sweep_fvg_stop, bear_fvg, sym_df5, atr_mult, buf_mult, fvg_tps, n_years)
            fut_lg = ex.submit(_run_tp_sweep_fvg_stop, bull_fvg, sym_df5, atr_mult, buf_mult, fvg_tps, n_years)
            fvg_sh_rows = fut_sh.result()
            fvg_lg_rows = fut_lg.result()

        best_fvg_sh = _print_sweep(
            fvg_sh_rows,
            f"G — FVG-stop SHORT  |  ATR×{atr_mult}  buf×{buf_mult}  |  {len(bear_fvg)} signals",
            len(bear_fvg), n_years,
        )
        best_fvg_lg = _print_sweep(
            fvg_lg_rows,
            f"H — FVG-stop LONG   |  ATR×{atr_mult}  buf×{buf_mult}  |  {len(bull_fvg)} signals",
            len(bull_fvg), n_years,
        )

        bsh_tp = best_fvg_sh["tp"] if best_fvg_sh else 5.0
        blg_tp = best_fvg_lg["tp"] if best_fvg_lg else 8.0

        # Year breakdown
        _hdr(
            f"I — Year breakdown (FVG-stop)  |  short TP={bsh_tp}R  long TP={blg_tp}R",
            ["year", "n_sh", "sh_win%", "sh_R", "n_lg", "lg_win%", "lg_R", "total_R"],
        )
        yr_sh2: dict[int, list] = defaultdict(list)
        yr_lg2: dict[int, list] = defaultdict(list)
        for s in bear_fvg:
            res = replay_trend_fvg_stop(s, sym_df5[s["sym"]], atr_mult, buf_mult, bsh_tp)
            if res: yr_sh2[s["year"]].append(res.pnl_r)
        for s in bull_fvg:
            res = replay_trend_fvg_stop(s, sym_df5[s["sym"]], atr_mult, buf_mult, blg_tp)
            if res: yr_lg2[s["year"]].append(res.pnl_r)
        for yr in YEARS:
            sh = np.array(yr_sh2.get(yr, []))
            lg = np.array(yr_lg2.get(yr, []))
            tot = round(float(sh.sum()) + float(lg.sum()), 1)
            _row([yr,
                  len(sh), f"{(sh>0).mean()*100:.1f}%" if len(sh) else "—",
                  f"{sh.sum():.1f}" if len(sh) else "—",
                  len(lg), f"{(lg>0).mean()*100:.1f}%" if len(lg) else "—",
                  f"{lg.sum():.1f}" if len(lg) else "—",
                  f"{tot:.1f}"])

        # Per-symbol
        _hdr(
            f"J — Per-symbol (FVG-stop)  |  short TP={bsh_tp}R  long TP={blg_tp}R",
            ["sym", "n_sh", "sh_win%", "sh_R", "sh_DD", "n_lg", "lg_win%", "lg_R", "lg_DD"],
        )
        for sym in SYMS:
            sh_sub = [s for s in bear_fvg if s["sym"] == sym]
            lg_sub = [s for s in bull_fvg if s["sym"] == sym]
            sh_res = [r for s in sh_sub for r in [replay_trend_fvg_stop(s, sym_df5[sym], atr_mult, buf_mult, bsh_tp)] if r]
            lg_res = [r for s in lg_sub for r in [replay_trend_fvg_stop(s, sym_df5[sym], atr_mult, buf_mult, blg_tp)] if r]
            sh_arr = np.array([r.pnl_r for r in sh_res])
            lg_arr = np.array([r.pnl_r for r in lg_res])
            _row([sym,
                  len(sh_arr),
                  f"{(sh_arr>0).mean()*100:.1f}%" if len(sh_arr) else "—",
                  f"{sh_arr.sum():.1f}" if len(sh_arr) else "—",
                  f"{_max_dd(sh_arr):.1f}" if len(sh_arr) else "—",
                  len(lg_arr),
                  f"{(lg_arr>0).mean()*100:.1f}%" if len(lg_arr) else "—",
                  f"{lg_arr.sum():.1f}" if len(lg_arr) else "—",
                  f"{_max_dd(lg_arr):.1f}" if len(lg_arr) else "—",
                  ])

    # ── Save ──────────────────────────────────────────────────────────────
    rows_out = (
        [{"direction": "short", **r} for r in short_rows] +
        [{"direction": "long",  **r} for r in long_rows]
    )
    out = REPO_ROOT / "cache" / "imbalanced_trend_sweep.csv"
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
    ap.add_argument("--tp-max",    type=float, default=12.0)
    ap.add_argument("--fvg",       action="store_true",
                    help="Restrict to FVG-tagged bars only")
    ap.add_argument("--fvg-stop",  action="store_true",
                    help="Add FVG-edge stop sections (G/H/I/J)")
    ap.add_argument("--buf-mult",  type=float, default=0.15,
                    help="Buffer multiplier for FVG stop (default 0.15)")
    args = ap.parse_args()

    print("=" * 72)
    print("IMBALANCED regime trend-follow study")
    print("=" * 72)
    main(
        db_path       = args.db,
        atr_mult      = args.atr_mult,
        buf_mult      = args.buf_mult,
        vol_ratio_min = args.vol_ratio,
        body_pct_min  = args.body_pct,
        close_pct_max = args.close_pct,
        tp_max        = args.tp_max,
        fvg_only      = args.fvg,
        fvg_stop      = args.fvg_stop,
        start         = args.start,
    )
