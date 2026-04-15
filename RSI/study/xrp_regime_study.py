#!/usr/bin/env python3
"""
XRP market-regime study from candle data only.

We do not have Level 1/Level 2 data in this repo, so this script maps the four
regimes to chart-based proxies on resampled bars (default: 4h):

1) HIGH_VOL      -> ATR%% is elevated and expanding and/or a range breakout
2) LOW_VOL       -> ATR%% is compressed and contracting
3) IMBALANCE     -> directional efficiency + trend separation are elevated
4) BALANCE       -> none of the above (sideways / mixed state)

Outputs:
- per-bar regime labels CSV
- run-level summary CSV (durations per regime run)
- transition matrix CSV
- markdown summary
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
RSI_ROOT = SCRIPT_DIR.parent
SIM_DIR = RSI_ROOT / "simulation"
SCRIPTS_DIR = RSI_ROOT / "scripts"
if str(SIM_DIR) not in sys.path:
    sys.path.insert(0, str(SIM_DIR))
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from massive_chunk_backtest_5m_v1fix import load_merged_5m  # noqa: E402
from multi_asset_4h_rsi_sim import DB_PATH as DEFAULT_DB  # noqa: E402


def wilder_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int) -> np.ndarray:
    n = len(close)
    prev_close = np.empty(n)
    prev_close[0] = close[0]
    prev_close[1:] = close[:-1]
    tr = np.maximum(high - low, np.maximum(np.abs(high - prev_close), np.abs(low - prev_close)))
    atr = np.full(n, np.nan)
    if n < period:
        return atr
    atr[period - 1] = float(np.mean(tr[:period]))
    for i in range(period, n):
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period
    return atr


def efficiency_ratio(close: pd.Series, n: int) -> pd.Series:
    """Kaufman efficiency ratio in [0,1], high means directional travel."""
    direction = (close - close.shift(n)).abs()
    volatility = close.diff().abs().rolling(n).sum()
    out = direction / volatility.replace(0, np.nan)
    return out.clip(lower=0.0, upper=1.0)


def run_lengths(labels: pd.Series) -> pd.DataFrame:
    if len(labels) == 0:
        return pd.DataFrame(columns=["regime", "start", "end", "bars"])
    rows: list[dict] = []
    cur = str(labels.iloc[0])
    start = labels.index[0]
    bars = 1
    for ts, v in labels.iloc[1:].items():
        v = str(v)
        if v == cur:
            bars += 1
            continue
        rows.append({"regime": cur, "start": start, "end": ts, "bars": bars})
        cur = v
        start = ts
        bars = 1
    rows.append({"regime": cur, "start": start, "end": labels.index[-1], "bars": bars})
    return pd.DataFrame(rows)


def classify_regimes(df: pd.DataFrame, atr_period: int, lookback: int) -> pd.DataFrame:
    close = df["close"]
    high = df["high"]
    low = df["low"]

    atr = pd.Series(
        wilder_atr(high.values.astype(float), low.values.astype(float), close.values.astype(float), atr_period),
        index=df.index,
    )
    atr_pct = 100.0 * atr / close
    atr_roc = atr_pct.pct_change()

    # Structural proxies
    hh = high.rolling(lookback).max().shift(1)
    ll = low.rolling(lookback).min().shift(1)
    breakout_up = close > hh
    breakout_down = close < ll
    breakout = breakout_up | breakout_down

    ema_fast = close.ewm(span=20, adjust=False).mean()
    ema_slow = close.ewm(span=50, adjust=False).mean()
    trend_sep = (ema_fast - ema_slow).abs() / atr.replace(0, np.nan)
    er = efficiency_ratio(close, n=lookback)

    # Distribution thresholds (global sample, robust enough for exploratory regime study)
    q_atr_hi = float(atr_pct.quantile(0.75))
    q_atr_lo = float(atr_pct.quantile(0.25))
    pos_roc = atr_roc[atr_roc > 0]
    neg_roc = atr_roc[atr_roc < 0]
    q_roc_up = float(pos_roc.quantile(0.75)) if len(pos_roc) else np.nan
    q_roc_dn = float(neg_roc.quantile(0.25)) if len(neg_roc) else np.nan
    q_er_hi = float(er.quantile(0.65))
    q_sep_hi = float(trend_sep.quantile(0.65))

    high_vol = (atr_pct >= q_atr_hi) & ((atr_roc >= q_roc_up) | breakout)
    low_vol = (atr_pct <= q_atr_lo) & (atr_roc <= q_roc_dn)
    imbalance = (er >= q_er_hi) & (trend_sep >= q_sep_hi)

    # Two-axis model: structure and volatility are independent.
    structure_regime = pd.Series("BALANCE", index=df.index)
    structure_regime.loc[imbalance] = "IMBALANCE"

    vol_regime = pd.Series("NORMAL_VOL", index=df.index)
    vol_regime.loc[low_vol] = "LOW_VOL"
    vol_regime.loc[high_vol] = "HIGH_VOL"

    combined_regime = structure_regime + "__" + vol_regime

    out = df.copy()
    out["atr"] = atr
    out["atr_pct"] = atr_pct
    out["atr_roc"] = atr_roc
    out["eff_ratio"] = er
    out["trend_sep"] = trend_sep
    out["breakout"] = breakout.astype(int)
    out["structure_regime"] = structure_regime
    out["vol_regime"] = vol_regime
    out["combined_regime"] = combined_regime
    return out.dropna(subset=["atr", "atr_pct", "atr_roc", "eff_ratio", "trend_sep"]).copy()


def to_md_table(df: pd.DataFrame) -> str:
    if len(df) == 0:
        return "_Empty._"
    cols = list(df.columns)
    lines = ["| " + " | ".join(cols) + " |", "| " + " | ".join("---" for _ in cols) + " |"]
    for _, r in df.iterrows():
        lines.append("| " + " | ".join(str(r[c]) for c in cols) + " |")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description="XRP regime study from 5m candles via 4h proxies")
    ap.add_argument("--db", default=os.path.abspath(DEFAULT_DB))
    ap.add_argument("--symbol", default="XRPUSDT")
    ap.add_argument("--months", type=int, default=48)
    ap.add_argument("--tf", default="4h", help="Resample timeframe used for regime classification (default 4h)")
    ap.add_argument("--atr-period", type=int, default=14)
    ap.add_argument("--lookback", type=int, default=20, help="Lookback bars for ER and breakout levels")
    ap.add_argument("--out-dir", default=str(SCRIPT_DIR / "out"))
    args = ap.parse_args()

    db_path = os.path.abspath(args.db)
    symbol = args.symbol.strip().upper()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    df5 = load_merged_5m(db_path, symbol)
    if len(df5) == 0:
        raise SystemExit(f"No data for {symbol} in {db_path}")

    end = df5.index.max()
    start = end - pd.DateOffset(months=args.months)
    df5 = df5.loc[df5.index >= start].copy()

    df = (
        df5.resample(args.tf)
        .agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
        .dropna()
    )
    clf = classify_regimes(df, atr_period=args.atr_period, lookback=args.lookback)
    if len(clf) == 0:
        raise SystemExit("No classified rows; try shorter lookback or verify data window")

    labels = clf["combined_regime"].astype(str)
    runs = run_lengths(labels)
    runs["hours"] = runs["bars"] * pd.to_timedelta(args.tf).total_seconds() / 3600.0
    runs["days"] = runs["hours"] / 24.0

    regimes = sorted(labels.unique())
    trans = pd.crosstab(labels.shift(1), labels).reindex(index=regimes, columns=regimes, fill_value=0)
    trans_p = trans.div(trans.sum(axis=1).replace(0, np.nan), axis=0)

    share = labels.value_counts(normalize=True).reindex(regimes, fill_value=0.0)
    occ = runs.groupby("regime").size().reindex(regimes, fill_value=0)
    dur_mean = runs.groupby("regime")["bars"].mean().reindex(regimes)
    dur_med = runs.groupby("regime")["bars"].median().reindex(regimes)

    summary = pd.DataFrame(
        {
            "regime": regimes,
            "time_share": share.values,
            "occurrences": occ.values,
            "avg_bars": dur_mean.values,
            "median_bars": dur_med.values,
            "avg_days": (dur_mean.values * pd.to_timedelta(args.tf).total_seconds() / 3600.0 / 24.0),
        }
    )
    summary = summary.round({"time_share": 4, "avg_bars": 2, "median_bars": 2, "avg_days": 2})

    tag = f"{symbol}_{args.tf}_m{args.months}"
    bars_csv = out_dir / f"regime_bars_{tag}.csv"
    runs_csv = out_dir / f"regime_runs_{tag}.csv"
    trans_csv = out_dir / f"regime_transitions_{tag}.csv"
    transp_csv = out_dir / f"regime_transitions_prob_{tag}.csv"
    summary_csv = out_dir / f"regime_summary_{tag}.csv"
    report_md = out_dir / f"REGIME_STUDY_{tag}.md"

    clf.reset_index().rename(columns={"index": "bar_ts"}).to_csv(bars_csv, index=False)
    runs.to_csv(runs_csv, index=False)
    trans.to_csv(trans_csv)
    trans_p.round(4).to_csv(transp_csv)
    summary.to_csv(summary_csv, index=False)

    lines = [
        f"# Regime Study: {symbol}",
        "",
        "## Setup",
        "",
        f"- DB: `{db_path}`",
        f"- Window: `{df5.index.min().isoformat()} -> {df5.index.max().isoformat()}`",
        f"- Base candles: `5m` | Classification TF: `{args.tf}`",
        f"- ATR period: `{args.atr_period}` | Lookback: `{args.lookback}`",
        "",
        "## Regime Definitions (Chart-Only Proxies)",
        "",
        "- Structure axis: `BALANCE` vs `IMBALANCE`.",
        "- Vol axis: `LOW_VOL`, `NORMAL_VOL`, `HIGH_VOL`.",
        "- Combined label is `STRUCTURE__VOL` (e.g., `BALANCE__HIGH_VOL`).",
        "",
        "## Summary",
        "",
        to_md_table(summary),
        "",
        "## Transition Probability Matrix P(next | current)",
        "",
        to_md_table(trans_p.round(4).reset_index().rename(columns={"index": "from"})),
        "",
        "## Artifacts",
        "",
        f"- Bars: `{bars_csv}`",
        f"- Runs: `{runs_csv}`",
        f"- Transitions count: `{trans_csv}`",
        f"- Transitions prob: `{transp_csv}`",
        f"- Summary CSV: `{summary_csv}`",
    ]
    report_md.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"Wrote {summary_csv}")
    print(summary.to_string(index=False))
    print(f"Wrote {report_md}")


if __name__ == "__main__":
    main()
