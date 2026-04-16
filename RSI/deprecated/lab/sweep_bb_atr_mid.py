#!/usr/bin/env python3
"""
BB Balanced — Two-axis sweep study.

Sweep A: ATR mult tightness [0.4, 0.6, 0.8, 1.0, 1.5]
  TP = midband price (the natural BB mean-reversion exit)
  Tests whether a tighter stop creates enough R/R for the midband to be a viable target.

Sweep B: Same ATR mult range, shorts only
  Tests whether isolating the short side (which showed positive R in baseline) is robust.

Both sweeps are run on XRPUSDT 1h BALANCED regime (all vol tiers included).

Usage:
    python lab/sweep_bb_atr_mid.py
    python lab/sweep_bb_atr_mid.py --db /path/to/backtest.sqlite
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

LAB_ROOT = Path(__file__).resolve().parent
REPO_ROOT = LAB_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

DEFAULT_DB = str(REPO_ROOT / "data" / "backtest.sqlite")


def _max_dd(r: np.ndarray) -> float:
    if len(r) == 0:
        return 0.0
    c = np.cumsum(r)
    return float(np.max(np.maximum.accumulate(c) - c))


def _stats(pnls: list[float], label: str) -> dict:
    r = np.array(pnls)
    n = len(r)
    if n == 0:
        return {"label": label, "n": 0, "total_r": 0, "win_pct": 0,
                "avg_r": 0, "max_dd": 0}
    return {
        "label":    label,
        "n":        n,
        "total_r":  round(float(r.sum()), 2),
        "win_pct":  round(float((r > 0).mean() * 100), 1),
        "avg_r":    round(float(r.mean()), 4),
        "max_dd":   round(_max_dd(r), 2),
    }


def run_sweep(db_path: str) -> None:
    from lab.core.db import load_merged_5m
    from lab.core.resample import resample_ohlcv
    from lab.core.regime import BALANCED, classify_regimes, VOL_HIGH
    from lab.sim.exit import replay_trade_5m
    from ta.volatility import BollingerBands

    HTF        = "1h"
    SYMBOL     = "XRPUSDT"
    START      = "2022-01-01"
    BB_PERIOD  = 20
    BB_STD     = 2.0
    ATR_PERIOD = 14
    ATR_MA_P   = 50
    ER_PERIOD  = 20
    ER_THRESH  = 0.35
    FEE_BPS    = 3.0

    ATR_MULTS  = [0.4, 0.6, 0.8, 1.0, 1.5]

    print(f"Loading {SYMBOL} 5m data...")
    df5 = load_merged_5m(db_path, SYMBOL)
    df5 = df5.loc[df5.index >= pd.Timestamp(START, tz="UTC")]
    print(f"  {len(df5)} bars from {df5.index[0].date()} to {df5.index[-1].date()}")

    df1h = resample_ohlcv(df5, HTF).copy()

    bb = BollingerBands(close=df1h["close"], window=BB_PERIOD,
                        window_dev=BB_STD, fillna=False)
    df1h["bb_upper"] = bb.bollinger_hband()
    df1h["bb_lower"] = bb.bollinger_lband()
    df1h["bb_mid"]   = bb.bollinger_mavg()

    df1h = classify_regimes(
        df1h,
        atr_period=ATR_PERIOD,
        atr_ma_period=ATR_MA_P,
        er_period=ER_PERIOD,
        er_balanced_threshold=ER_THRESH,
    )

    # ── Collect signal bars ────────────────────────────────────────────────
    min_idx = max(BB_PERIOD, ATR_PERIOD + ATR_MA_P, ER_PERIOD) + 2
    n = len(df1h)

    signals: list[dict] = []
    for i in range(min_idx, n - 1):
        row = df1h.iloc[i]
        if (pd.isna(row.get("bb_lower")) or pd.isna(row.get("structure"))
                or pd.isna(row.get("atr"))):
            continue
        if row["structure"] != BALANCED:
            continue

        entry_bar = df1h.iloc[i + 1]
        if pd.isna(entry_bar["open"]):
            continue

        close_i = float(row["close"])
        bb_lo   = float(row["bb_lower"])
        bb_hi   = float(row["bb_upper"])
        bb_mid  = float(row["bb_mid"])
        atr_val = float(row["atr"])
        entry_p = float(entry_bar["open"])

        if close_i < bb_lo:
            side = 1
        elif close_i > bb_hi:
            side = -1
        else:
            continue

        signals.append({
            "i":        i + 1,
            "side":     side,
            "entry_p":  entry_p,
            "bb_mid":   bb_mid,
            "atr":      atr_val,
            "vol":      row.get("vol", ""),
            "ts":       df1h.index[i + 1],
        })

    print(f"  {len(signals)} signal bars in BALANCED regime\n")

    # ── Sweep A: ATR mult × TP at midband ─────────────────────────────────
    print("SWEEP A — ATR mult tightness, TP = midband price")
    print(f"{'ATR mult':>10}  {'n':>5}  {'total_R':>8}  {'win%':>6}  {'avg_R':>7}  {'max_dd':>7}")
    print("-" * 55)

    sweep_a_rows = []
    for mult in ATR_MULTS:
        pnls_all, pnls_long, pnls_short = [], [], []

        for s in signals:
            entry_p = s["entry_p"]
            atr_val = s["atr"]
            side    = s["side"]
            bb_mid  = s["bb_mid"]

            if side == 1:
                stop  = entry_p - atr_val * mult
                risk  = entry_p - stop
                tp_p  = bb_mid   # natural mean-reversion target
            else:
                stop  = entry_p + atr_val * mult
                risk  = stop - entry_p
                tp_p  = bb_mid

            if risk <= 0:
                continue
            # tp_p must be in the right direction
            if side == 1 and tp_p <= entry_p:
                continue
            if side == -1 and tp_p >= entry_p:
                continue

            result = replay_trade_5m(
                df5, s["ts"], side, entry_p, stop, tp_p, risk, FEE_BPS,
                be_trigger_r=None, be_offset_r=0.0,
                skip_entry_bucket_hours=0.0,
            )
            if result is None:
                continue

            pnl = result.pnl_r
            pnls_all.append(pnl)
            (pnls_long if side == 1 else pnls_short).append(pnl)

        st = _stats(pnls_all, f"atr×{mult}")
        sweep_a_rows.append({**st, "mult": mult,
                              "n_long": len(pnls_long), "n_short": len(pnls_short),
                              "total_long": round(sum(pnls_long), 2),
                              "total_short": round(sum(pnls_short), 2),
                              "win_long": round((np.array(pnls_long)>0).mean()*100, 1) if pnls_long else 0,
                              "win_short": round((np.array(pnls_short)>0).mean()*100, 1) if pnls_short else 0})
        print(f"  ×{mult:<8.2f}  {st['n']:>5}  {st['total_r']:>8.2f}  {st['win_pct']:>6.1f}  {st['avg_r']:>7.4f}  {st['max_dd']:>7.2f}")

    # ── Sweep B: Shorts-only across ATR mults ─────────────────────────────
    print(f"\nSWEEP B — Shorts only, TP = midband price")
    print(f"{'ATR mult':>10}  {'n':>5}  {'total_R':>8}  {'win%':>6}  {'avg_R':>7}  {'max_dd':>7}")
    print("-" * 55)

    for row in sweep_a_rows:
        m   = row["mult"]
        pnl = row["total_short"]
        n   = row["n_short"]
        w   = row["win_short"]
        # Recompute max_dd for shorts
        pnls_sh = []
        for s in signals:
            if s["side"] != -1:
                continue
            entry_p = s["entry_p"]
            atr_val = s["atr"]
            stop    = entry_p + atr_val * m
            risk    = stop - entry_p
            tp_p    = s["bb_mid"]
            if risk <= 0 or tp_p >= entry_p:
                continue
            result = replay_trade_5m(
                df5, s["ts"], -1, entry_p, stop, tp_p, risk, FEE_BPS,
                be_trigger_r=None, be_offset_r=0.0,
                skip_entry_bucket_hours=0.0,
            )
            if result:
                pnls_sh.append(result.pnl_r)
        dd = _max_dd(np.array(pnls_sh)) if pnls_sh else 0
        avg_r = round(np.mean(pnls_sh), 4) if pnls_sh else 0
        print(f"  ×{m:<8.2f}  {n:>5}  {pnl:>8.2f}  {w:>6.1f}  {avg_r:>7.4f}  {dd:>7.2f}")

    # ── Vol regime breakdown for best ATR mult ────────────────────────────
    best_mult = min(sweep_a_rows, key=lambda r: r["total_r"])  # most negative? find best
    # Actually pick the least negative or positive
    sweep_a_rows_sorted = sorted(sweep_a_rows, key=lambda r: -r["total_r"])
    best_mult = sweep_a_rows_sorted[0]["mult"]

    print(f"\nSWEEP C — Vol regime breakdown at best ATR×{best_mult}, TP=midband, shorts only")
    print(f"{'vol':>8}  {'n':>5}  {'total_R':>8}  {'win%':>6}  {'avg_R':>7}")
    print("-" * 45)
    vol_buckets: dict[str, list[float]] = {}
    for s in signals:
        if s["side"] != -1:
            continue
        entry_p = s["entry_p"]
        atr_val = s["atr"]
        stop    = entry_p + atr_val * best_mult
        risk    = stop - entry_p
        tp_p    = s["bb_mid"]
        vol     = s["vol"] or "UNKNOWN"
        if risk <= 0 or tp_p >= entry_p:
            continue
        result = replay_trade_5m(
            df5, s["ts"], -1, entry_p, stop, tp_p, risk, FEE_BPS,
            be_trigger_r=None, be_offset_r=0.0,
            skip_entry_bucket_hours=0.0,
        )
        if result:
            vol_buckets.setdefault(vol, []).append(result.pnl_r)

    for vol in sorted(vol_buckets):
        r = np.array(vol_buckets[vol])
        print(f"  {vol:>8}  {len(r):>5}  {r.sum():>8.2f}  {(r>0).mean()*100:>6.1f}  {r.mean():>7.4f}")

    print("\nDone.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DEFAULT_DB)
    args = ap.parse_args()
    run_sweep(args.db)
