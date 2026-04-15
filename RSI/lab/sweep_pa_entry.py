#!/usr/bin/env python3
"""
Price-Action Entry Study — no lagging indicators.

Replaces BB signal with two pure price-action entries:

  A — Momentum Close:  bar closes in the top/bottom 20% of its own H/L range
      AND volume is above rolling median (vol_ratio > 1.0).
      Long: close_pct > 0.80 + close > open + vol_ratio > 1.0
      Short: close_pct < 0.20 + close < open + vol_ratio > 1.0
      Thesis: committed directional bar on real volume → continuation next open.

  B — N-bar Breakout:  close exceeds the highest/lowest close of the last N bars.
      Long: close == max(closes[i-N:i])
      Short: close == min(closes[i-N:i])
      Thesis: price making new structure highs/lows → momentum follow-through.

Vol regime: quantile thirds of rolling ATR ratio (no fixed thresholds).
  LOW:  atr_ratio < p33 of last 200 bars
  MED:  p33 ≤ atr_ratio < p67
  HIGH: atr_ratio ≥ p67
  This gives balanced n across regimes regardless of asset.

Structure filter: BALANCED | IMBALANCED | ALL (sweep dimension).

Stop: ATR(14) × atr_mult (sweep: 1.0, 1.5)
TP:   fixed R multiple (sweep: 1.5, 2.0, 3.0)

Output: ranked table sorted by total_r with regime + entry + side breakdown.

Usage:
    python lab/sweep_pa_entry.py
    python lab/sweep_pa_entry.py --db /path/to/backtest.sqlite --symbol BTCUSDT
"""
from __future__ import annotations

import argparse
import sys
from itertools import product
from pathlib import Path

import numpy as np
import pandas as pd

LAB_ROOT = Path(__file__).resolve().parent
REPO_ROOT = LAB_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

DEFAULT_DB = str(REPO_ROOT.parent / "backtester" / "data" / "backtest.sqlite")


def _max_dd(r: np.ndarray) -> float:
    if len(r) == 0:
        return 0.0
    c = np.cumsum(r)
    return float(np.max(np.maximum.accumulate(c) - c))


def _row(label: str, pnls: list[float]) -> dict:
    r = np.array(pnls)
    n = len(r)
    if n == 0:
        return {"label": label, "n": 0, "total_r": 0.0, "win_pct": 0.0,
                "avg_r": 0.0, "max_dd": 0.0, "exp_per_trade": 0.0}
    total = float(r.sum())
    win   = float((r > 0).mean() * 100)
    avg   = float(r.mean())
    dd    = _max_dd(r)
    # Simple expectancy score: avg_r / max_dd (penalise deep drawdowns)
    exp   = round(avg / dd, 4) if dd > 0 else 0.0
    return {"label": label, "n": n, "total_r": round(total, 2),
            "win_pct": round(win, 1), "avg_r": round(avg, 4),
            "max_dd": round(dd, 2), "exp_score": exp}


def add_quantile_vol(df: pd.DataFrame, window: int = 200) -> pd.DataFrame:
    """
    Rolling quantile vol regime — balanced thirds regardless of asset.
    vol_q: 'LOW' | 'MED' | 'HIGH'
    """
    out = df.copy()
    atr_r = out["atr_ratio"]

    # Rolling p33 and p67 over last `window` bars
    p33 = atr_r.rolling(window, min_periods=50).quantile(0.33)
    p67 = atr_r.rolling(window, min_periods=50).quantile(0.67)

    conditions = [
        atr_r < p33,
        (atr_r >= p33) & (atr_r < p67),
        atr_r >= p67,
    ]
    vol_q = np.select(conditions, ["LOW", "MED", "HIGH"], default="").astype(object)
    vol_q[p33.isna().values] = np.nan
    out["vol_q"] = vol_q
    return out


def add_pa_signals(df: pd.DataFrame, breakout_n: int = 10) -> pd.DataFrame:
    """
    Compute price-action signal columns (no look-ahead).
    All values at bar i use only data from bars 0..i (bar i is closed).
    Entry is at bar i+1 open.

    Added columns:
      close_pct   : (close - low) / (high - low)  — where close sits in the bar
      body_pct    : abs(close - open) / (high - low)  — body as share of range
      vol_ratio   : volume / rolling 20-bar median volume
      sig_mom_l   : True = momentum long signal at this bar
      sig_mom_s   : True = momentum short signal
      sig_bo_l    : True = N-bar breakout long signal
      sig_bo_s    : True = N-bar breakout short signal
    """
    out = df.copy()
    hi, lo, cl, op = out["high"], out["low"], out["close"], out["open"]
    rng = (hi - lo).replace(0, np.nan)

    out["close_pct"] = (cl - lo) / rng
    out["body_pct"]  = (cl - op).abs() / rng
    out["vol_ratio"] = out["volume"] / out["volume"].rolling(20, min_periods=10).median()

    # Signal A — momentum close
    is_bull = cl > op
    is_bear = cl < op
    vol_ok  = out["vol_ratio"] > 1.0
    out["sig_mom_l"] = (out["close_pct"] > 0.80) & is_bull & vol_ok
    out["sig_mom_s"] = (out["close_pct"] < 0.20) & is_bear & vol_ok

    # Signal B — N-bar close breakout (close >= highest close of prior N bars)
    # Use shift(1) so bar i only looks at i-N to i-1 (no current bar)
    rolling_max = cl.shift(1).rolling(breakout_n, min_periods=breakout_n).max()
    rolling_min = cl.shift(1).rolling(breakout_n, min_periods=breakout_n).min()
    out["sig_bo_l"] = cl >= rolling_max  # new N-bar high close
    out["sig_bo_s"] = cl <= rolling_min  # new N-bar low close

    return out


def run_study(
    db_path: str,
    symbol: str = "XRPUSDT",
    start: str = "2022-01-01",
    htf: str = "1h",
    breakout_n: int = 10,
    atr_mult: float = 1.0,
    tp_rs: list[float] = None,
    fee_bps: float = 3.0,
) -> pd.DataFrame:
    if tp_rs is None:
        tp_rs = [1.5, 2.0, 3.0]

    from lab.core.db import load_merged_5m
    from lab.core.resample import resample_ohlcv
    from lab.core.regime import classify_regimes
    from lab.sim.exit import replay_trade_5m
    from lab.sim.entry import tp_price_from_r

    print(f"Loading {symbol} 5m...")
    df5 = load_merged_5m(db_path, symbol)
    df5 = df5.loc[df5.index >= pd.Timestamp(start, tz="UTC")]
    print(f"  {len(df5)} 5m bars  {df5.index[0].date()} → {df5.index[-1].date()}")

    df = resample_ohlcv(df5, htf).copy()
    df = classify_regimes(df, atr_period=14, atr_ma_period=50,
                          er_period=20, er_balanced_threshold=0.35)
    df = add_quantile_vol(df, window=200)
    df = add_pa_signals(df, breakout_n=breakout_n)

    n_bars = len(df)
    min_idx = 50 + breakout_n  # warmup

    print(f"  {n_bars} {htf} bars after resample\n")
    print(f"  Quantile vol thirds distribution:")
    for v in ["LOW", "MED", "HIGH"]:
        n = (df["vol_q"] == v).sum()
        print(f"    {v}: {n} ({n/n_bars*100:.1f}%)")
    print(f"  Structure: {dict(df['structure'].value_counts())}\n")

    # ── Collect all signals ───────────────────────────────────────────────
    SIG_COLS = {
        "mom": ("sig_mom_l", "sig_mom_s"),
        "bo":  ("sig_bo_l",  "sig_bo_s"),
    }

    Signal = dict  # {entry_idx, side, entry_p, atr, structure, vol_q, sig}
    signals: list[Signal] = []

    for i in range(min_idx, n_bars - 1):
        row = df.iloc[i]
        if pd.isna(row.get("atr")) or pd.isna(row.get("vol_q")):
            continue
        entry_bar = df.iloc[i + 1]
        if pd.isna(entry_bar["open"]):
            continue

        atr_val   = float(row["atr"])
        entry_p   = float(entry_bar["open"])
        structure = row.get("structure", "")
        vol_q     = row.get("vol_q", "")

        for sig_name, (col_l, col_s) in SIG_COLS.items():
            for side, col in [(1, col_l), (-1, col_s)]:
                if not row.get(col, False):
                    continue
                signals.append({
                    "i": i + 1, "side": side, "entry_p": entry_p,
                    "atr": atr_val, "structure": structure,
                    "vol_q": vol_q, "sig": sig_name,
                    "ts": df.index[i + 1],
                })

    print(f"  Total raw signals: {len(signals)}")
    for sig in ["mom", "bo"]:
        n_l = sum(1 for s in signals if s["sig"] == sig and s["side"] == 1)
        n_s = sum(1 for s in signals if s["sig"] == sig and s["side"] == -1)
        print(f"    {sig}: {n_l} longs + {n_s} shorts")
    print()

    # ── Replay across all sweep dimensions ───────────────────────────────
    rows = []

    for sig_name, tp_r in product(["mom", "bo"], tp_rs):
        label = f"{sig_name}|atr×{atr_mult}|tp{tp_r}R"
        bucket: dict[str, list[float]] = {
            "ALL": [], "LONG": [], "SHORT": [],
            "BAL": [], "IMBAL": [],
            "vol_LOW": [], "vol_MED": [], "vol_HIGH": [],
        }

        for s in signals:
            if s["sig"] != sig_name:
                continue
            side    = s["side"]
            entry_p = s["entry_p"]
            atr_val = s["atr"]

            if side == 1:
                stop = entry_p - atr_val * atr_mult
                risk = entry_p - stop
            else:
                stop = entry_p + atr_val * atr_mult
                risk = stop - entry_p

            if risk <= 0:
                continue

            tp_p = tp_price_from_r(entry_p, risk, side, tp_r)

            result = replay_trade_5m(
                df5, s["ts"], side, entry_p, stop, tp_p, risk, fee_bps,
                be_trigger_r=None, be_offset_r=0.0,
                skip_entry_bucket_hours=0.0,
            )
            if result is None:
                continue

            pnl = result.pnl_r
            bucket["ALL"].append(pnl)
            bucket["LONG" if side == 1 else "SHORT"].append(pnl)
            if s["structure"] == "BALANCED":
                bucket["BAL"].append(pnl)
            elif s["structure"] == "IMBALANCED":
                bucket["IMBAL"].append(pnl)
            bucket.get(f"vol_{s['vol_q']}", []).append(pnl)

        base = _row(label, bucket["ALL"])
        for bkey, bpnls in bucket.items():
            if bkey == "ALL":
                continue
            sub = _row(f"{label}|{bkey}", bpnls)
            base[f"{bkey}_n"]    = sub["n"]
            base[f"{bkey}_totR"] = sub["total_r"]
            base[f"{bkey}_win"]  = sub["win_pct"]

        rows.append(base)
        stat = base
        print(f"  {label:<35}  n={stat['n']:4d}  total={stat['total_r']:7.2f}R  "
              f"win={stat['win_pct']:5.1f}%  avg={stat['avg_r']:.4f}  "
              f"dd={stat['max_dd']:.1f}  "
              f"[L:{base.get('LONG_totR',0):+.1f} S:{base.get('SHORT_totR',0):+.1f}]  "
              f"[BAL:{base.get('BAL_totR',0):+.1f} IMBAL:{base.get('IMBAL_totR',0):+.1f}]  "
              f"[vL:{base.get('vol_LOW_totR',0):+.1f} vM:{base.get('vol_MED_totR',0):+.1f} vH:{base.get('vol_HIGH_totR',0):+.1f}]")

    # Sort by win rate first (primary), then max_dd ascending (secondary)
    df_out = (
        pd.DataFrame(rows)
        .sort_values(["win_pct", "max_dd"], ascending=[False, True])
        .reset_index(drop=True)
    )
    return df_out


def _print_table(results: pd.DataFrame) -> None:
    SEP = "-" * 100

    print(f"\n{'ENTRY':>6}  {'TP':>5}  {'n':>5}  {'win%':>6}  {'avg_R':>7}  "
          f"{'total_R':>8}  {'maxDD':>7}  "
          f"{'L_tot':>7}  {'S_tot':>7}  "
          f"{'BAL':>7}  {'IMBAL':>7}  "
          f"{'vLOW':>7}  {'vMED':>7}  {'vHIGH':>7}")
    print(SEP)

    for _, r in results.iterrows():
        parts = r["label"].split("|")
        sig = parts[0]
        tp  = parts[2]
        print(f"  {sig:>6}  {tp:>5}  {r['n']:>5}  {r['win_pct']:>6.1f}  {r['avg_r']:>7.4f}  "
              f"{r['total_r']:>8.2f}  {r['max_dd']:>7.2f}  "
              f"{r.get('LONG_totR',0):>7.1f}  {r.get('SHORT_totR',0):>7.1f}  "
              f"{r.get('BAL_totR',0):>7.1f}  {r.get('IMBAL_totR',0):>7.1f}  "
              f"{r.get('vol_LOW_totR',0):>7.1f}  {r.get('vol_MED_totR',0):>7.1f}  {r.get('vol_HIGH_totR',0):>7.1f}")

    print(SEP)
    print("Sorted by: win% DESC, maxDD ASC")
    print("Cols: L_tot=longs only, S_tot=shorts only, BAL/IMBAL=structure filter, vLOW/vMED/vHIGH=vol thirds")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db",       default=DEFAULT_DB)
    ap.add_argument("--symbol",   default="XRPUSDT")
    ap.add_argument("--start",    default="2022-01-01")
    ap.add_argument("--htf",      default="1h")
    ap.add_argument("--bo-n",     type=int,   default=10)
    ap.add_argument("--atr-mult", type=float, default=1.0)
    args = ap.parse_args()

    print("=" * 80)
    print("PA Entry Sweep — momentum close & N-bar breakout | 3 TPs | quantile vol regime")
    print(f"ATR mult fixed at ×{args.atr_mult} | tune stop → then TP")
    print("=" * 80)

    results = run_study(
        db_path=args.db,
        symbol=args.symbol,
        start=args.start,
        htf=args.htf,
        breakout_n=args.bo_n,
        atr_mult=args.atr_mult,
        tp_rs=[1.5, 2.0, 3.0],
    )

    _print_table(results)

    out_path = REPO_ROOT / "cache" / "pa_entry_sweep_results.csv"
    out_path.parent.mkdir(exist_ok=True)
    results.to_csv(out_path, index=False)
    print(f"\nSaved → {out_path}")
