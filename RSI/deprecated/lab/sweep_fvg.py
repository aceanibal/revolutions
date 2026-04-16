#!/usr/bin/env python3
"""
FVG (Fair Value Gap) Strategy Sweep — lab/ framework.

Concept:
  A 3-candle gap creates a price inefficiency the market tends to revisit.
  Bullish FVG: low[i] > high[i-2]  → gap up, unfilled zone = [high[i-2], low[i]]
  Bearish FVG: high[i] < low[i-2]  → gap down, unfilled zone = [high[i], low[i-2]]

Entry logic (no-lookahead, Rule 1):
  After FVG forms at bar i, monitor subsequent 1h bars for a fill attempt.
  Fill detected when: bar.low <= fvg_low (bullish) or bar.high >= fvg_high (bearish)
  Entry: open of the NEXT 1h bar after fill detection.
  (If fill bar itself = entry bar, we can't act until it closes — Rule 1)

Stop:
  Bullish: stop = high[i-2] - atr_buffer  (just below the bottom of the FVG zone)
  Bearish: stop = low[i-2]  + atr_buffer  (just above the top of the FVG zone)
  atr_buffer = ATR[i] * atr_buf_mult  — gives the zone a little room vs a hard edge

Risk = entry - stop  (always positive; FVG width + buffer)

TP: fixed R multiples (sweep).

Regime filter:
  IMBALANCE only — FVG in a trending context is a pullback entry into momentum.
  In BALANCED markets the gap may not have directional follow-through.
  Vol: quantile thirds (rolling p33/p67 of atr_ratio over 200 bars).

FVG quality filters:
  min_gap_bps : minimum gap size as basis points of price (skip tiny gaps)
  max_age_bars: expire FVG if not filled within N 1h bars (stale gap)
  one trade per active FVG (no re-entry on same gap)

All 6 symbols, 2022→latest, 1h bars, replayed on 5m candles.

Usage:
    python lab/sweep_fvg.py
    python lab/sweep_fvg.py --sides bull bear --tp-sweep 1.0 1.5 2.0 2.5 3.0
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

DEFAULT_DB = str(REPO_ROOT / "data" / "backtest.sqlite")
SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "LINKUSDT", "DOGEUSDT", "XRPUSDT"]
YEARS = [2022, 2023, 2024, 2025]


# ── Helpers ────────────────────────────────────────────────────────────────

def _max_dd(r: np.ndarray) -> float:
    if len(r) == 0:
        return 0.0
    c = np.cumsum(r)
    return float(np.max(np.maximum.accumulate(c) - c))


def _stats(pnls: list[float]) -> dict:
    r = np.array(pnls, dtype=float)
    n = len(r)
    if n == 0:
        return dict(n=0, win_pct=0, avg_r=0, total_r=0, max_dd=0, dd_per_trade=0)
    dd = _max_dd(r)
    return dict(
        n          = n,
        win_pct    = round(float((r > 0).mean() * 100), 1),
        avg_r      = round(float(r.mean()), 4),
        total_r    = round(float(r.sum()), 2),
        max_dd     = round(dd, 2),
        dd_per_trade = round(dd / n, 4),
    )


# ── FVG detector ──────────────────────────────────────────────────────────

def detect_fvgs(
    df1h: pd.DataFrame,
    min_gap_bps: float = 5.0,
) -> list[dict]:
    """
    Scan 1h bars for FVG formations. Returns list of FVG event dicts.
    Each dict: {idx, ts, side, fvg_low, fvg_high, gap_bps, atr}

    No look-ahead: FVG at bar i is known at bar i's close.
    Entry can happen from bar i+1 onward.
    """
    hi  = df1h["high"].values
    lo  = df1h["low"].values
    cl  = df1h["close"].values
    atr = df1h["atr"].values if "atr" in df1h else np.full(len(df1h), np.nan)
    n   = len(df1h)
    fvgs = []

    for i in range(2, n - 1):
        if np.isnan(atr[i]):
            continue
        mid = cl[i]

        # Bullish FVG: gap up — low[i] > high[i-2]
        if lo[i] > hi[i - 2]:
            gap_bps = (lo[i] - hi[i - 2]) / hi[i - 2] * 10_000
            if gap_bps >= min_gap_bps:
                fvgs.append({
                    "idx": i, "ts": df1h.index[i],
                    "side": "bull",
                    "fvg_low": float(hi[i - 2]),   # bottom of gap
                    "fvg_high": float(lo[i]),       # top of gap (entry zone)
                    "gap_bps": round(gap_bps, 2),
                    "atr": float(atr[i]),
                })

        # Bearish FVG: gap down — high[i] < low[i-2]
        if hi[i] < lo[i - 2]:
            gap_bps = (lo[i - 2] - hi[i]) / lo[i - 2] * 10_000
            if gap_bps >= min_gap_bps:
                fvgs.append({
                    "idx": i, "ts": df1h.index[i],
                    "side": "bear",
                    "fvg_low": float(hi[i]),        # bottom of gap (entry zone)
                    "fvg_high": float(lo[i - 2]),   # top of gap
                    "gap_bps": round(gap_bps, 2),
                    "atr": float(atr[i]),
                })

    return fvgs


# ── Signal builder ─────────────────────────────────────────────────────────

def collect_fvg_signals(
    df1h: pd.DataFrame,
    sides: list[str],
    structure_filter: str,       # "IMBALANCED" | "BALANCED" | "ALL"
    min_gap_bps: float = 5.0,
    max_age_bars: int  = 24,     # expire FVG after 24 bars (~1 day on 1h)
    atr_buf_mult: float = 0.25,  # stop buffer below/above FVG edge
) -> list[dict]:
    """
    For each FVG, scan forward up to max_age_bars for the first fill.
    Fill = 1h bar whose low touches fvg_high (bull) or high touches fvg_low (bear).
    Entry at next 1h bar open (Rule 1 — can only act after bar closes).
    """
    fvgs = detect_fvgs(df1h, min_gap_bps=min_gap_bps)
    n = len(df1h)
    signals = []
    hi_arr = df1h["high"].values
    lo_arr = df1h["low"].values

    for fvg in fvgs:
        if fvg["side"] not in sides:
            continue

        # Check regime at the FVG formation bar
        fvg_row = df1h.iloc[fvg["idx"]]
        structure = fvg_row.get("structure", "")
        vol_q     = fvg_row.get("vol_q", "")
        if structure_filter != "ALL" and structure != structure_filter:
            continue
        if pd.isna(structure) or pd.isna(vol_q):
            continue

        # Scan forward for fill
        start = fvg["idx"] + 1
        end   = min(fvg["idx"] + max_age_bars + 1, n - 1)
        filled_at = None

        for j in range(start, end):
            if fvg["side"] == "bull":
                # Fill: bar's low enters the FVG zone from above
                if lo_arr[j] <= fvg["fvg_high"]:
                    filled_at = j
                    break
            else:
                # Fill: bar's high enters the FVG zone from below
                if hi_arr[j] >= fvg["fvg_low"]:
                    filled_at = j
                    break

        if filled_at is None or filled_at + 1 >= n:
            continue

        # Entry at next bar open after fill (Rule 1)
        entry_idx = filled_at + 1
        entry_bar = df1h.iloc[entry_idx]
        if pd.isna(entry_bar["open"]):
            continue

        entry_p = float(entry_bar["open"])
        atr_v   = fvg["atr"]
        buf     = atr_v * atr_buf_mult

        if fvg["side"] == "bull":
            stop = fvg["fvg_low"] - buf        # below bottom of FVG
            side_int = 1
        else:
            stop = fvg["fvg_high"] + buf       # above top of FVG
            side_int = -1

        # Validate risk direction
        if side_int == 1 and stop >= entry_p:
            continue
        if side_int == -1 and stop <= entry_p:
            continue

        risk = abs(entry_p - stop)
        if risk <= 0:
            continue

        signals.append({
            "ts":        df1h.index[entry_idx],
            "side":      side_int,
            "entry_p":   entry_p,
            "stop":      stop,
            "risk":      risk,
            "atr":       atr_v,
            "gap_bps":   fvg["gap_bps"],
            "structure": structure,
            "vol_q":     vol_q,
            "year":      df1h.index[entry_idx].year,
            "fvg_idx":   fvg["idx"],
        })

    return signals


# ── Data preparation ───────────────────────────────────────────────────────

def prepare_sym(db_path: str, sym: str, start: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    from lab.core.db import load_merged_5m
    from lab.core.resample import resample_ohlcv
    from lab.core.regime import classify_regimes

    df5 = load_merged_5m(db_path, sym)
    df5 = df5.loc[df5.index >= pd.Timestamp(start, tz="UTC")]
    df1h = resample_ohlcv(df5, "1h").copy()
    df1h = classify_regimes(df1h, atr_period=14, atr_ma_period=50,
                            er_period=20, er_balanced_threshold=0.35)

    # Quantile vol regime
    atr_r = df1h["atr_ratio"]
    p67   = atr_r.rolling(200, min_periods=50).quantile(0.67)
    p33   = atr_r.rolling(200, min_periods=50).quantile(0.33)
    vol_q = np.where(atr_r >= p67, "HIGH",
            np.where(atr_r < p33,  "LOW", "MED")).astype(object)
    vol_q[p67.isna().values] = np.nan
    df1h["vol_q"] = vol_q

    return df5, df1h


# ── Main sweep ─────────────────────────────────────────────────────────────

def run_sweep(
    db_path: str,
    sides: list[str],
    structure_filter: str,
    tp_sweep: list[float],
    min_gap_bps: float  = 5.0,
    max_age_bars: int   = 24,
    atr_buf_mult: float = 0.25,
    fee_bps: float      = 3.0,
    start: str          = "2022-01-01",
) -> None:
    from lab.sim.exit import replay_trade_5m
    from lab.sim.entry import tp_price_from_r

    print(f"\nLoading signals  sides={sides}  structure={structure_filter}  "
          f"min_gap={min_gap_bps}bps  max_age={max_age_bars}bars  atr_buf=×{atr_buf_mult}")

    all_sigs = []
    for sym in SYMS:
        df5, df1h = prepare_sym(db_path, sym, start)
        sigs = collect_fvg_signals(
            df1h, sides=sides, structure_filter=structure_filter,
            min_gap_bps=min_gap_bps, max_age_bars=max_age_bars,
            atr_buf_mult=atr_buf_mult,
        )
        for s in sigs:
            s["sym"] = sym
            s["df5"] = df5
        all_sigs.extend(sigs)
        print(f"  {sym:<12} {len(sigs):>4} signals")

    print(f"  {'TOTAL':<12} {len(all_sigs):>4} signals\n")

    # ── TP sweep ──────────────────────────────────────────────────────────
    print(f"  {'TP':>5}  {'n':>5}  {'win%':>6}  {'avg_R':>7}  "
          f"{'total_R':>8}  {'maxDD':>7}  {'DD/n':>6}", end="")
    for yr in YEARS:
        print(f"  {yr}", end="")
    print()
    print("  " + "-" * 90)

    tp_results = []
    for tp_r in tp_sweep:
        pnls_all, pnls_yr, pnls_sym = [], defaultdict(list), defaultdict(list)
        for s in all_sigs:
            tp_p = tp_price_from_r(s["entry_p"], s["risk"], s["side"], tp_r)
            res = replay_trade_5m(
                s["df5"], s["ts"], s["side"],
                s["entry_p"], s["stop"], tp_p, s["risk"], fee_bps,
                be_trigger_r=None, be_offset_r=0.0,
                skip_entry_bucket_hours=0.0,
            )
            if res:
                pnls_all.append(res.pnl_r)
                pnls_yr[s["year"]].append(res.pnl_r)
                pnls_sym[s["sym"]].append(res.pnl_r)

        st = _stats(pnls_all)
        yr_tots = [round(np.array(pnls_yr.get(yr, [])).sum(), 1) for yr in YEARS]
        print(f"  {tp_r:>5.1f}  {st['n']:>5}  {st['win_pct']:>6.1f}%  {st['avg_r']:>7.4f}  "
              f"{st['total_r']:>8.2f}  {st['max_dd']:>7.2f}  {st['dd_per_trade']:>6.3f}", end="")
        for v in yr_tots:
            print(f"  {v:>5.1f}", end="")
        print()
        tp_results.append({"tp": tp_r, **st, "yr": pnls_yr, "sym": pnls_sym})

    # ── Per-symbol at each TP ─────────────────────────────────────────────
    print(f"\n  Per-symbol total R:")
    print(f"  {'sym':<12}", end="")
    for r in tp_results:
        print(f"  {r['tp']:>5.1f}R", end="")
    print()
    print("  " + "-" * (14 + 8 * len(tp_results)))
    for sym in SYMS:
        print(f"  {sym:<12}", end="")
        for r in tp_results:
            v = round(sum(r["sym"].get(sym, [])), 1)
            print(f"  {v:>+6.1f}", end="")
        print()

    # ── Vol regime breakdown at best TP ───────────────────────────────────
    best = max(tp_results, key=lambda x: x["total_r"])
    best_tp = best["tp"]
    print(f"\n  Vol regime breakdown at best TP={best_tp}R:")
    print(f"  {'vol_q':>8}  {'n':>5}  {'win%':>6}  {'avg_R':>7}  {'total_R':>8}")
    vol_buckets: dict[str, list[float]] = defaultdict(list)
    for s in all_sigs:
        tp_p = tp_price_from_r(s["entry_p"], s["risk"], s["side"], best_tp)
        res  = replay_trade_5m(
            s["df5"], s["ts"], s["side"],
            s["entry_p"], s["stop"], tp_p, s["risk"], fee_bps,
            be_trigger_r=None, be_offset_r=0.0, skip_entry_bucket_hours=0.0,
        )
        if res:
            vol_buckets[s["vol_q"]].append(res.pnl_r)
    for vq in ["LOW", "MED", "HIGH"]:
        r = np.array(vol_buckets.get(vq, []))
        if len(r):
            print(f"  {vq:>8}  {len(r):>5}  {(r>0).mean()*100:>6.1f}%  "
                  f"{r.mean():>7.4f}  {r.sum():>8.2f}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db",          default=DEFAULT_DB)
    ap.add_argument("--start",       default="2022-01-01")
    ap.add_argument("--sides",       nargs="+", default=["bull", "bear"])
    ap.add_argument("--structure",   default="IMBALANCED",
                    help="IMBALANCED | BALANCED | ALL")
    ap.add_argument("--tp-sweep",    nargs="+", type=float,
                    default=[1.0, 1.5, 2.0, 2.5, 3.0])
    ap.add_argument("--min-gap-bps", type=float, default=5.0)
    ap.add_argument("--max-age",     type=int,   default=24)
    ap.add_argument("--atr-buf",     type=float, default=0.25,
                    help="ATR multiplier for stop buffer beyond FVG edge")
    args = ap.parse_args()

    print("=" * 70)
    print("FVG Sweep — Fair Value Gap entry, replayed on 5m candles")
    print("=" * 70)

    # Run 1: IMBALANCED both sides
    run_sweep(
        db_path=args.db, sides=args.sides,
        structure_filter=args.structure,
        tp_sweep=args.tp_sweep,
        min_gap_bps=args.min_gap_bps,
        max_age_bars=args.max_age,
        atr_buf_mult=args.atr_buf,
        start=args.start,
    )

    # Run 2: split bull vs bear for IMBALANCED
    print("\n" + "=" * 70)
    print("Split by FVG direction:")
    for side_label, side_list in [("BULL only", ["bull"]), ("BEAR only", ["bear"])]:
        print(f"\n  --- {side_label} ---")
        run_sweep(
            db_path=args.db, sides=side_list,
            structure_filter=args.structure,
            tp_sweep=[1.0, 2.0, 3.0],   # condensed for speed
            min_gap_bps=args.min_gap_bps,
            max_age_bars=args.max_age,
            atr_buf_mult=args.atr_buf,
            start=args.start,
        )
