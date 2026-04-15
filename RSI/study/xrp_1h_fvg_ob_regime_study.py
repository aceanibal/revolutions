#!/usr/bin/env python3
"""
XRP 1h structure study: FVG + order-block proxy vs regime.

Important limitation:
- We do NOT have historical L2 order book snapshots in this dataset.
- "Order block" here is a candle-structure proxy:
  * Bullish OB candidate: previous candle is bearish, current candle displaces up
    (close > prev high) with body >= rolling displacement threshold.
  * Bearish OB candidate: previous candle is bullish, current candle displaces down
    (close < prev low) with body >= threshold.

FVG definition (3-candle gap):
- Bullish FVG at i when low[i] > high[i-2]
- Bearish FVG at i when high[i] < low[i-2]

Outputs:
- Event-level CSV with timestamps, type, side, regime, and regime bias
- Pivot/count CSVs
- PNG chart with side-by-side counts by regime and side
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import matplotlib.pyplot as plt
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
    direction = (close - close.shift(n)).abs()
    volatility = close.diff().abs().rolling(n).sum()
    return (direction / volatility.replace(0, np.nan)).clip(0.0, 1.0)


def classify_regimes_1h(df: pd.DataFrame, atr_period: int = 14, lookback: int = 20) -> pd.DataFrame:
    close = df["close"]
    high = df["high"]
    low = df["low"]

    atr = pd.Series(
        wilder_atr(high.values.astype(float), low.values.astype(float), close.values.astype(float), atr_period),
        index=df.index,
    )
    atr_pct = 100.0 * atr / close
    atr_roc = atr_pct.pct_change()

    hh = high.rolling(lookback).max().shift(1)
    ll = low.rolling(lookback).min().shift(1)
    breakout_up = close > hh
    breakout_down = close < ll
    breakout = breakout_up | breakout_down

    ema_fast = close.ewm(span=20, adjust=False).mean()
    ema_slow = close.ewm(span=50, adjust=False).mean()
    trend_sep = (ema_fast - ema_slow).abs() / atr.replace(0, np.nan)
    er = efficiency_ratio(close, n=lookback)

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

    # Two-axis model to allow BALANCE + HIGH_VOL simultaneously.
    structure_regime = pd.Series("BALANCE", index=df.index)
    structure_regime.loc[imbalance] = "IMBALANCE"

    vol_regime = pd.Series("NORMAL_VOL", index=df.index)
    vol_regime.loc[low_vol] = "LOW_VOL"
    vol_regime.loc[high_vol] = "HIGH_VOL"
    combined_regime = structure_regime + "__" + vol_regime

    # Directional bias (bullish/bearish/neutral) from EMA stack
    bias = pd.Series("neutral", index=df.index)
    bias.loc[(close > ema_slow) & (ema_fast > ema_slow)] = "bullish"
    bias.loc[(close < ema_slow) & (ema_fast < ema_slow)] = "bearish"

    out = df.copy()
    out["atr"] = atr
    out["atr_pct"] = atr_pct
    out["atr_roc"] = atr_roc
    out["eff_ratio"] = er
    out["trend_sep"] = trend_sep
    out["structure_regime"] = structure_regime
    out["vol_regime"] = vol_regime
    out["combined_regime"] = combined_regime
    out["regime_bias"] = bias
    return out.dropna(subset=["atr", "atr_pct", "atr_roc", "eff_ratio", "trend_sep"]).copy()


def detect_fvg_and_ob_events(df: pd.DataFrame, min_gap_bps: float, displacement_q: float) -> pd.DataFrame:
    open_ = df["open"]
    high = df["high"]
    low = df["low"]
    close = df["close"]
    idx = df.index

    body = (close - open_).abs()
    disp_thr = body.rolling(100, min_periods=30).quantile(displacement_q)

    rows: list[dict] = []
    for i in range(2, len(df)):
        ts = idx[i]
        px = float(close.iloc[i])
        if px <= 0:
            continue

        # FVGs
        bull_gap = float(low.iloc[i] - high.iloc[i - 2])
        bear_gap = float(low.iloc[i - 2] - high.iloc[i])
        bull_gap_bps = 10000.0 * bull_gap / px
        bear_gap_bps = 10000.0 * bear_gap / px

        if bull_gap > 0 and bull_gap_bps >= min_gap_bps:
            rows.append(
                {
                    "ts": ts,
                    "event_type": "FVG",
                    "event_side": "bullish",
                    "event_strength_bps": bull_gap_bps,
                    "notes": "low[i] > high[i-2]",
                }
            )
        if bear_gap > 0 and bear_gap_bps >= min_gap_bps:
            rows.append(
                {
                    "ts": ts,
                    "event_type": "FVG",
                    "event_side": "bearish",
                    "event_strength_bps": bear_gap_bps,
                    "notes": "high[i] < low[i-2]",
                }
            )

        # Order-block proxy via displacement break from prior opposite candle
        dthr = disp_thr.iloc[i]
        if not np.isfinite(dthr):
            continue
        body_i = float(body.iloc[i])

        prev_bear = close.iloc[i - 1] < open_.iloc[i - 1]
        prev_bull = close.iloc[i - 1] > open_.iloc[i - 1]
        up_displace = (close.iloc[i] > high.iloc[i - 1]) and (body_i >= dthr)
        dn_displace = (close.iloc[i] < low.iloc[i - 1]) and (body_i >= dthr)

        if prev_bear and up_displace:
            rows.append(
                {
                    "ts": ts,
                    "event_type": "ORDER_BLOCK_PROXY",
                    "event_side": "bullish",
                    "event_strength_bps": 10000.0 * body_i / px,
                    "notes": "prev bear candle + up displacement close > prev high",
                }
            )
        if prev_bull and dn_displace:
            rows.append(
                {
                    "ts": ts,
                    "event_type": "ORDER_BLOCK_PROXY",
                    "event_side": "bearish",
                    "event_strength_bps": 10000.0 * body_i / px,
                    "notes": "prev bull candle + down displacement close < prev low",
                }
            )

    return pd.DataFrame(rows)


def md_table(df: pd.DataFrame) -> str:
    if len(df) == 0:
        return "_Empty._"
    cols = list(df.columns)
    lines = ["| " + " | ".join(cols) + " |", "| " + " | ".join("---" for _ in cols) + " |"]
    for _, row in df.iterrows():
        lines.append("| " + " | ".join(str(row[c]) for c in cols) + " |")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description="XRP 1h FVG + OB proxy regime study")
    ap.add_argument("--db", default=os.path.abspath(DEFAULT_DB))
    ap.add_argument("--symbol", default="XRPUSDT")
    ap.add_argument("--months", type=int, default=48)
    ap.add_argument("--tf", default="1h")
    ap.add_argument("--atr-period", type=int, default=14)
    ap.add_argument("--lookback", type=int, default=20)
    ap.add_argument("--min-gap-bps", type=float, default=1.0, help="Minimum FVG size in bps of close")
    ap.add_argument(
        "--disp-quantile",
        type=float,
        default=0.70,
        help="Body-size rolling quantile threshold for OB displacement proxy",
    )
    ap.add_argument("--out-dir", default=str(SCRIPT_DIR / "out"))
    args = ap.parse_args()

    symbol = args.symbol.strip().upper()
    db_path = os.path.abspath(args.db)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    df5 = load_merged_5m(db_path, symbol)
    if len(df5) == 0:
        raise SystemExit(f"No data for {symbol}")
    end = df5.index.max()
    start = end - pd.DateOffset(months=args.months)
    df5 = df5.loc[df5.index >= start].copy()

    df = (
        df5.resample(args.tf)
        .agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
        .dropna()
    )
    clf = classify_regimes_1h(df, atr_period=args.atr_period, lookback=args.lookback)
    ev = detect_fvg_and_ob_events(clf, min_gap_bps=args.min_gap_bps, displacement_q=args.disp_quantile)
    if len(ev) == 0:
        raise SystemExit("No events found; try lower --min-gap-bps or lower --disp-quantile")

    # Join regime context
    ev = ev.merge(
        clf[
            [
                "structure_regime",
                "vol_regime",
                "combined_regime",
                "regime_bias",
                "close",
                "atr_pct",
            ]
        ]
        .reset_index()
        .rename(columns={"Date": "ts"}),
        on="ts",
        how="left",
    )
    ev["hour_utc"] = pd.to_datetime(ev["ts"], utc=True).dt.hour
    ev["weekday"] = pd.to_datetime(ev["ts"], utc=True).dt.day_name()
    ev = ev.sort_values("ts").reset_index(drop=True)

    # Summaries
    counts_regime = (
        ev.groupby(["event_type", "event_side", "combined_regime"], as_index=False)
        .size()
        .rename(columns={"size": "count"})
        .sort_values(["event_type", "event_side", "count"], ascending=[True, True, False])
    )
    counts_structure = (
        ev.groupby(["event_type", "event_side", "structure_regime"], as_index=False)
        .size()
        .rename(columns={"size": "count"})
        .sort_values(["event_type", "event_side", "count"], ascending=[True, True, False])
    )
    counts_vol = (
        ev.groupby(["event_type", "event_side", "vol_regime"], as_index=False)
        .size()
        .rename(columns={"size": "count"})
        .sort_values(["event_type", "event_side", "count"], ascending=[True, True, False])
    )
    counts_bias = (
        ev.groupby(["event_type", "event_side", "regime_bias"], as_index=False)
        .size()
        .rename(columns={"size": "count"})
        .sort_values(["event_type", "event_side", "count"], ascending=[True, True, False])
    )
    totals = ev.groupby(["event_type", "event_side"], as_index=False).size().rename(columns={"size": "count"})

    # Chart (2x2): counts by combined regime for each event_type/side
    regimes = sorted(ev["combined_regime"].dropna().unique())
    fig, axs = plt.subplots(2, 2, figsize=(12, 8), sharey=False)
    combos = [
        ("FVG", "bullish"),
        ("FVG", "bearish"),
        ("ORDER_BLOCK_PROXY", "bullish"),
        ("ORDER_BLOCK_PROXY", "bearish"),
    ]
    for ax, (et, side) in zip(axs.ravel(), combos):
        sub = counts_regime[(counts_regime["event_type"] == et) & (counts_regime["event_side"] == side)]
        m = sub.set_index("combined_regime")["count"].reindex(regimes, fill_value=0)
        ax.bar(m.index, m.values)
        ax.set_title(f"{et} | {side}")
        ax.tick_params(axis="x", rotation=25)
        ax.set_ylabel("count")
    fig.suptitle(f"{symbol} {args.tf} events by combined regime ({args.months}m)")
    fig.tight_layout()

    tag = f"{symbol}_{args.tf}_m{args.months}"
    events_csv = out_dir / f"fvg_ob_events_{tag}.csv"
    reg_csv = out_dir / f"fvg_ob_counts_by_combined_regime_{tag}.csv"
    structure_csv = out_dir / f"fvg_ob_counts_by_structure_regime_{tag}.csv"
    vol_csv = out_dir / f"fvg_ob_counts_by_vol_regime_{tag}.csv"
    bias_csv = out_dir / f"fvg_ob_counts_by_regime_bias_{tag}.csv"
    totals_csv = out_dir / f"fvg_ob_totals_{tag}.csv"
    chart_png = out_dir / f"fvg_ob_regime_chart_{tag}.png"
    report_md = out_dir / f"FVG_OB_REGIME_STUDY_{tag}.md"

    ev.to_csv(events_csv, index=False)
    counts_regime.to_csv(reg_csv, index=False)
    counts_structure.to_csv(structure_csv, index=False)
    counts_vol.to_csv(vol_csv, index=False)
    counts_bias.to_csv(bias_csv, index=False)
    totals.to_csv(totals_csv, index=False)
    fig.savefig(chart_png, dpi=180, bbox_inches="tight")
    plt.close(fig)

    lines = [
        f"# FVG + Order Block Proxy Study: {symbol} ({args.tf})",
        "",
        "## Setup",
        "",
        f"- DB: `{db_path}`",
        f"- Window: `{df5.index.min().isoformat()} -> {df5.index.max().isoformat()}`",
        f"- Regime TF: `{args.tf}` | ATR period: `{args.atr_period}` | lookback: `{args.lookback}`",
        f"- FVG threshold: `{args.min_gap_bps} bps`",
        f"- OB proxy displacement quantile: `{args.disp_quantile}`",
        "",
        "## Caveat",
        "",
        "- `ORDER_BLOCK_PROXY` is candle-structure based; true Level-2 order-book walls are not available in this dataset.",
        "",
        "## Totals",
        "",
        md_table(totals),
        "",
        "## Counts by Combined Regime",
        "",
        md_table(counts_regime),
        "",
        "## Counts by Structure Regime",
        "",
        md_table(counts_structure),
        "",
        "## Counts by Vol Regime",
        "",
        md_table(counts_vol),
        "",
        "## Counts by Regime Bias",
        "",
        md_table(counts_bias),
        "",
        "## Artifacts",
        "",
        f"- Events: `{events_csv}`",
        f"- By combined regime: `{reg_csv}`",
        f"- By structure regime: `{structure_csv}`",
        f"- By vol regime: `{vol_csv}`",
        f"- By regime bias: `{bias_csv}`",
        f"- Totals: `{totals_csv}`",
        f"- Chart: `{chart_png}`",
    ]
    report_md.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"Wrote {events_csv} ({len(ev)} rows)")
    print(f"Wrote {chart_png}")
    print(totals.to_string(index=False))


if __name__ == "__main__":
    main()
