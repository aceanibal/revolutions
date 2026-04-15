#!/usr/bin/env python3
"""
Shorts-only filtered sweep — two dimensions:

  Sweep 1 (ATR mult): fix signal quality, sweep stop distance
    Signal:  mom short  (close_pct < 0.20, close < open, vol_ratio > 1.5)
    Filter:  BALANCED regime + HIGH vol quantile
    ATR mult: [0.75, 1.0, 1.25, 1.5, 2.0]
    TP:       [2.0, 3.0]   ← just two; tune stop first

  Sweep 2 (signal quality): fix ATR mult at 1.5, sweep signal tightness
    Dimensions: vol_ratio threshold × body_pct threshold
    vol_ratio:  [1.0, 1.5, 2.0]
    body_pct:   [0.0, 0.40, 0.55]
    TP fixed at 3.0R

All runs: shorts only, BALANCED, HIGH vol quantile (rolling p67).
MaxDD reported in R and also as a fraction of trades (DD_per_trade)
to give a normalised picture of drawdown severity.

Usage:
    python lab/sweep_shorts_filtered.py
    python lab/sweep_shorts_filtered.py --atr-mult 1.5 --tp 3.0
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

DEFAULT_DB = str(REPO_ROOT.parent / "backtester" / "data" / "backtest.sqlite")


# ── Helpers ────────────────────────────────────────────────────────────────

def _max_dd(pnls: np.ndarray) -> float:
    if len(pnls) == 0:
        return 0.0
    c = np.cumsum(pnls)
    return float(np.max(np.maximum.accumulate(c) - c))


def _max_consec_loss(pnls: np.ndarray) -> int:
    best, cur = 0, 0
    for p in pnls:
        cur = cur + 1 if p < 0 else 0
        best = max(best, cur)
    return best


def _stats(label: str, pnls: list[float]) -> dict:
    r = np.array(pnls, dtype=float)
    n = len(r)
    if n == 0:
        return dict(label=label, n=0, win_pct=0, avg_r=0,
                    total_r=0, max_dd=0, dd_per_trade=0, max_consec_loss=0)
    dd = _max_dd(r)
    return dict(
        label          = label,
        n              = n,
        win_pct        = round(float((r > 0).mean() * 100), 1),
        avg_r          = round(float(r.mean()), 4),
        total_r        = round(float(r.sum()), 2),
        max_dd         = round(dd, 2),
        dd_per_trade   = round(dd / n, 4),   # normalised: DD cost per trade taken
        max_consec_loss= int(_max_consec_loss(r)),
    )


# ── Data preparation ───────────────────────────────────────────────────────

def prepare_data(db_path: str, symbol: str, start: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    from lab.core.db import load_merged_5m
    from lab.core.resample import resample_ohlcv
    from lab.core.regime import classify_regimes

    print(f"Loading {symbol}...")
    df5 = load_merged_5m(db_path, symbol)
    df5 = df5.loc[df5.index >= pd.Timestamp(start, tz="UTC")]

    df1h = resample_ohlcv(df5, "1h").copy()
    df1h = classify_regimes(df1h, atr_period=14, atr_ma_period=50,
                            er_period=20, er_balanced_threshold=0.35)

    # Candle structure
    rng = (df1h["high"] - df1h["low"]).replace(0, np.nan)
    df1h["close_pct"] = (df1h["close"] - df1h["low"]) / rng
    df1h["body_pct"]  = (df1h["close"] - df1h["open"]).abs() / rng
    df1h["vol_ratio"] = df1h["volume"] / df1h["volume"].rolling(20, min_periods=10).median()

    # Rolling quantile vol regime (balanced thirds)
    atr_r = df1h["atr_ratio"]
    p67   = atr_r.rolling(200, min_periods=50).quantile(0.67)
    p33   = atr_r.rolling(200, min_periods=50).quantile(0.33)
    vol_q = np.where(atr_r >= p67, "HIGH",
            np.where(atr_r < p33,  "LOW", "MED")).astype(object)
    vol_q[p67.isna().values] = np.nan
    df1h["vol_q"] = vol_q

    print(f"  {len(df5)} 5m bars | {len(df1h)} 1h bars | "
          f"{df5.index[0].date()} → {df5.index[-1].date()}")
    return df5, df1h


# ── Signal builder ─────────────────────────────────────────────────────────

def collect_signals(
    df1h: pd.DataFrame,
    vol_ratio_min: float = 1.5,
    body_pct_min: float  = 0.0,
    close_pct_max: float = 0.20,
) -> list[dict]:
    """
    Returns short signal bars (entry at bar i+1 open).
    Filters applied at bar i (signal bar):
      - BALANCED structure
      - HIGH vol quantile
      - close_pct < close_pct_max  (close in lower portion of bar)
      - close < open               (bearish bar)
      - vol_ratio > vol_ratio_min  (elevated volume)
      - body_pct > body_pct_min    (meaningful body — not doji/noise)
    """
    min_idx = 60  # warmup
    n = len(df1h)
    sigs = []

    for i in range(min_idx, n - 1):
        row = df1h.iloc[i]
        if pd.isna(row.get("atr")) or pd.isna(row.get("vol_q")):
            continue
        if row["structure"] != "BALANCED":
            continue
        if row["vol_q"] != "HIGH":
            continue
        if not (row["close_pct"] < close_pct_max):
            continue
        if not (row["close"] < row["open"]):
            continue
        if not (row["vol_ratio"] > vol_ratio_min):
            continue
        if not (row["body_pct"] > body_pct_min):
            continue

        entry_bar = df1h.iloc[i + 1]
        if pd.isna(entry_bar["open"]):
            continue

        sigs.append({
            "ts":      df1h.index[i + 1],
            "entry_p": float(entry_bar["open"]),
            "atr":     float(row["atr"]),
        })
    return sigs


# ── Replay runner ──────────────────────────────────────────────────────────

def replay_signals(
    signals: list[dict],
    df5: pd.DataFrame,
    atr_mult: float,
    tp_r: float,
    fee_bps: float = 3.0,
) -> list[float]:
    from lab.sim.exit import replay_trade_5m
    from lab.sim.entry import tp_price_from_r

    pnls = []
    for s in signals:
        entry_p = s["entry_p"]
        stop    = entry_p + s["atr"] * atr_mult   # short stop above entry
        risk    = stop - entry_p
        if risk <= 0:
            continue
        tp_p = tp_price_from_r(entry_p, risk, -1, tp_r)
        result = replay_trade_5m(
            df5, s["ts"], -1, entry_p, stop, tp_p, risk, fee_bps,
            be_trigger_r=None, be_offset_r=0.0,
            skip_entry_bucket_hours=0.0,
        )
        if result:
            pnls.append(result.pnl_r)
    return pnls


# ── Print helpers ──────────────────────────────────────────────────────────

def _hdr(title: str, cols: list[str]) -> None:
    print(f"\n{'='*70}")
    print(title)
    print(f"{'='*70}")
    print("  " + "  ".join(f"{c:>10}" for c in cols))
    print("  " + "-" * (12 * len(cols)))


def _prow(vals: list) -> None:
    print("  " + "  ".join(f"{v:>10}" for v in vals))


# ── Main ───────────────────────────────────────────────────────────────────

def main(db_path: str, symbol: str = "XRPUSDT", start: str = "2022-01-01") -> None:
    df5, df1h = prepare_data(db_path, symbol, start)

    # ── SWEEP 1: ATR mult × TP ─────────────────────────────────────────────
    # Fixed signal quality: vol_ratio > 1.5, body_pct > 0.40
    sigs_base = collect_signals(df1h, vol_ratio_min=1.5, body_pct_min=0.40)
    print(f"\n  Base signals (vol_r>1.5, body>0.4, BAL, HIGH): {len(sigs_base)} shorts over {start}→latest")
    print(f"  ≈ {len(sigs_base)/(2026-2022+1):.0f} per year\n")

    ATR_MULTS = [0.75, 1.0, 1.25, 1.5, 2.0]
    TP_RS     = [2.0, 3.0]

    cols = ["atr_mult", "tp", "n", "win%", "avg_R", "total_R", "maxDD", "DD/trade", "max_loss_run"]
    _hdr("SWEEP 1 — ATR mult  |  shorts, BALANCED, HIGH vol, vol_r>1.5, body>0.4", cols)

    sweep1 = []
    for mult in ATR_MULTS:
        for tp in TP_RS:
            pnls = replay_signals(sigs_base, df5, mult, tp)
            st = _stats(f"×{mult}|tp{tp}", pnls)
            sweep1.append({**st, "mult": mult, "tp": tp})
            _prow([f"×{mult}", f"{tp}R", st["n"], f"{st['win_pct']}%",
                   f"{st['avg_r']:.4f}", f"{st['total_r']:.1f}",
                   f"{st['max_dd']:.1f}", f"{st['dd_per_trade']:.3f}",
                   st["max_consec_loss"]])

    # ── SWEEP 2: Signal quality filter ────────────────────────────────────
    # Fixed ATR mult=1.5, TP=3.0 (best from sweep 1 — will know after running)
    FIXED_MULT = 1.5
    FIXED_TP   = 3.0
    VOL_THRESHOLDS  = [1.0, 1.5, 2.0]
    BODY_THRESHOLDS = [0.00, 0.40, 0.55]

    cols2 = ["vol_r>", "body>", "n", "win%", "avg_R", "total_R", "maxDD", "DD/trade", "max_loss_run"]
    _hdr(f"SWEEP 2 — Signal quality  |  ATR×{FIXED_MULT}, TP={FIXED_TP}R, shorts, BAL, HIGH vol", cols2)

    sweep2 = []
    for vr in VOL_THRESHOLDS:
        for bp in BODY_THRESHOLDS:
            sigs = collect_signals(df1h, vol_ratio_min=vr, body_pct_min=bp)
            pnls = replay_signals(sigs, df5, FIXED_MULT, FIXED_TP)
            st = _stats(f"vr>{vr}|bp>{bp}", pnls)
            sweep2.append({**st, "vol_r_min": vr, "body_min": bp})
            _prow([f">{vr}", f">{bp}", st["n"], f"{st['win_pct']}%",
                   f"{st['avg_r']:.4f}", f"{st['total_r']:.1f}",
                   f"{st['max_dd']:.1f}", f"{st['dd_per_trade']:.3f}",
                   st["max_consec_loss"]])

    # ── Year-by-year for the best config ──────────────────────────────────
    # Pick best from sweep 2: highest win% among configs with n >= 50
    df2 = pd.DataFrame(sweep2)
    candidates = df2[df2["n"] >= 50].sort_values(["win_pct", "max_dd"], ascending=[False, True])
    if len(candidates):
        best = candidates.iloc[0]
        best_vr = best["vol_r_min"]
        best_bp = best["body_min"]
        best_mult = float(
            pd.DataFrame(sweep1)
            .pipe(lambda d: d[d["tp"] == FIXED_TP])
            .sort_values(["win_pct", "max_dd"], ascending=[False, True])
            .iloc[0]["mult"]
        )
        print(f"\n{'='*70}")
        print(f"YEAR-BY-YEAR — best config: vol_r>{best_vr}, body>{best_bp}, "
              f"ATR×{best_mult}, TP={FIXED_TP}R")
        print(f"{'='*70}")
        print(f"  {'year':>6}  {'n':>5}  {'win%':>6}  {'avg_R':>7}  {'total_R':>8}  {'maxDD':>7}")
        print(f"  {'-'*50}")

        sigs_best = collect_signals(df1h, vol_ratio_min=best_vr, body_pct_min=best_bp)
        from lab.sim.exit import replay_trade_5m
        from lab.sim.entry import tp_price_from_r

        year_bucket: dict[int, list[float]] = {}
        for s in sigs_best:
            entry_p = s["entry_p"]
            stop    = entry_p + s["atr"] * best_mult
            risk    = stop - entry_p
            if risk <= 0:
                continue
            tp_p = tp_price_from_r(entry_p, risk, -1, FIXED_TP)
            result = replay_trade_5m(
                df5, s["ts"], -1, entry_p, stop, tp_p, risk, 3.0,
                be_trigger_r=None, be_offset_r=0.0,
                skip_entry_bucket_hours=0.0,
            )
            if result:
                yr = s["ts"].year
                year_bucket.setdefault(yr, []).append(result.pnl_r)

        for yr in sorted(year_bucket):
            r = np.array(year_bucket[yr])
            print(f"  {yr:>6}  {len(r):>5}  {(r>0).mean()*100:>6.1f}%  "
                  f"{r.mean():>7.4f}  {r.sum():>8.2f}  {_max_dd(r):>7.2f}")

    # ── Save results ───────────────────────────────────────────────────────
    out = REPO_ROOT / "cache" / "shorts_filtered_sweep.csv"
    out.parent.mkdir(exist_ok=True)
    pd.concat([
        pd.DataFrame(sweep1).assign(sweep="atr_mult"),
        pd.DataFrame(sweep2).assign(sweep="sig_quality"),
    ]).to_csv(out, index=False)
    print(f"\nSaved → {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db",     default=DEFAULT_DB)
    ap.add_argument("--symbol", default="XRPUSDT")
    ap.add_argument("--start",  default="2022-01-01")
    args = ap.parse_args()
    main(args.db, args.symbol, args.start)
