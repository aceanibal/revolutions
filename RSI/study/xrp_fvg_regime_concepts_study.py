#!/usr/bin/env python3
"""
Test FVG concepts on XRPUSDT (48 months) using 1h bars built from 5m candles.

Concepts tested:
1) Trending regime: aligned FVG vs counter-trend FVG.
2) Ranging regime: middle-of-range FVG vs edge-of-range FVG.
3) High-vol regime: large "news-like" FVG fill behavior (breakaway proxy).

Notes:
- No Level 2 / tape data is available, so this is chart-only inference.
- Regime model is two-axis: structure (BALANCE/IMBALANCE) + volatility (LOW/NORMAL/HIGH).
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


def classify_regimes(df: pd.DataFrame, atr_period: int = 14, lookback: int = 20) -> pd.DataFrame:
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

    structure_regime = pd.Series("BALANCE", index=df.index)
    structure_regime.loc[imbalance] = "IMBALANCE"

    vol_regime = pd.Series("NORMAL_VOL", index=df.index)
    vol_regime.loc[low_vol] = "LOW_VOL"
    vol_regime.loc[high_vol] = "HIGH_VOL"

    bias = pd.Series("neutral", index=df.index)
    bias.loc[(close > ema_slow) & (ema_fast > ema_slow)] = "bullish"
    bias.loc[(close < ema_slow) & (ema_fast < ema_slow)] = "bearish"

    out = df.copy()
    out["atr"] = atr
    out["atr_pct"] = atr_pct
    out["structure_regime"] = structure_regime
    out["vol_regime"] = vol_regime
    out["regime_bias"] = bias
    # range position proxy for balance-trap concept
    out["range_hi"] = high.rolling(lookback).max().shift(1)
    out["range_lo"] = low.rolling(lookback).min().shift(1)
    rng = (out["range_hi"] - out["range_lo"]).replace(0, np.nan)
    out["range_pos"] = ((close - out["range_lo"]) / rng).clip(0.0, 1.0)
    return out.dropna(subset=["atr", "atr_pct", "range_pos"]).copy()


def detect_fvg(
    df: pd.DataFrame,
    min_gap_bps: float,
    *,
    strict: bool,
    disp_quantile: float,
    disp_lookback: int,
) -> pd.DataFrame:
    high = df["high"].values
    low = df["low"].values
    open_ = df["open"].values
    close = df["close"].values
    idx = df.index
    body = np.abs(close - open_)
    body_s = pd.Series(body, index=df.index)
    disp_thr = body_s.rolling(disp_lookback, min_periods=max(30, disp_lookback // 3)).quantile(disp_quantile).values
    rows: list[dict] = []
    for i in range(2, len(df)):
        px = float(close[i])
        if px <= 0:
            continue
        # bullish: low[i] > high[i-2], gap zone [high[i-2], low[i]]
        bull_gap = float(low[i] - high[i - 2])
        bull_bps = 10000.0 * bull_gap / px
        bull_ok = bull_gap > 0 and bull_bps >= min_gap_bps
        if strict:
            # Require displacement on middle candle and close-through behavior.
            mid_body_ok = np.isfinite(disp_thr[i - 1]) and (body[i - 1] >= disp_thr[i - 1])
            mid_close_ok = close[i - 1] > high[i - 2]
            bull_ok = bull_ok and mid_body_ok and mid_close_ok
        if bull_ok:
            rows.append(
                {
                    "ts": idx[i],
                    "event_side": "bullish",
                    "gap_low": float(high[i - 2]),
                    "gap_high": float(low[i]),
                    "gap_bps": bull_bps,
                }
            )
        # bearish: high[i] < low[i-2], gap zone [high[i], low[i-2]]
        bear_gap = float(low[i - 2] - high[i])
        bear_bps = 10000.0 * bear_gap / px
        bear_ok = bear_gap > 0 and bear_bps >= min_gap_bps
        if strict:
            mid_body_ok = np.isfinite(disp_thr[i - 1]) and (body[i - 1] >= disp_thr[i - 1])
            mid_close_ok = close[i - 1] < low[i - 2]
            bear_ok = bear_ok and mid_body_ok and mid_close_ok
        if bear_ok:
            rows.append(
                {
                    "ts": idx[i],
                    "event_side": "bearish",
                    "gap_low": float(high[i]),
                    "gap_high": float(low[i - 2]),
                    "gap_bps": bear_bps,
                }
            )
    return pd.DataFrame(rows)


def first_hit_outcome(
    side: str,
    entry: float,
    atr: float,
    highs: np.ndarray,
    lows: np.ndarray,
    r: float = 1.0,
) -> str:
    """Return 'plus', 'minus', 'both', or 'none' for first +/-r ATR move."""
    if atr <= 0 or not np.isfinite(atr):
        return "none"
    if side == "bullish":
        plus_px = entry + r * atr
        minus_px = entry - r * atr
        for h, l in zip(highs, lows):
            hit_plus = h >= plus_px
            hit_minus = l <= minus_px
            if hit_plus and hit_minus:
                return "both"
            if hit_plus:
                return "plus"
            if hit_minus:
                return "minus"
    else:
        plus_px = entry - r * atr
        minus_px = entry + r * atr
        for h, l in zip(highs, lows):
            hit_plus = l <= plus_px
            hit_minus = h >= minus_px
            if hit_plus and hit_minus:
                return "both"
            if hit_plus:
                return "plus"
            if hit_minus:
                return "minus"
    return "none"


def compute_forward_stats(df: pd.DataFrame, ev: pd.DataFrame, h_fast: int, h_slow: int) -> pd.DataFrame:
    """Attach forward MFE/MAE in ATR units + hit outcomes + fill flags."""
    idx_to_pos = {ts: i for i, ts in enumerate(df.index)}
    highs = df["high"].values.astype(float)
    lows = df["low"].values.astype(float)
    closes = df["close"].values.astype(float)

    out_rows: list[dict] = []
    for _, r in ev.iterrows():
        ts = r["ts"]
        i = idx_to_pos.get(ts)
        if i is None:
            continue
        if i + 1 >= len(df):
            continue
        entry = float(closes[i])
        atr = float(r["atr"])
        side = str(r["event_side"])
        if not np.isfinite(atr) or atr <= 0:
            continue

        j1 = min(len(df), i + 1 + h_fast)
        j2 = min(len(df), i + 1 + h_slow)
        h_fast_arr = highs[i + 1 : j1]
        l_fast_arr = lows[i + 1 : j1]
        h_slow_arr = highs[i + 1 : j2]
        l_slow_arr = lows[i + 1 : j2]
        if len(h_fast_arr) == 0 or len(h_slow_arr) == 0:
            continue

        if side == "bullish":
            mfe_fast = (np.max(h_fast_arr) - entry) / atr
            mae_fast = (entry - np.min(l_fast_arr)) / atr
            full_fill_fast = np.min(l_fast_arr) <= float(r["gap_low"])
            full_fill_slow = np.min(l_slow_arr) <= float(r["gap_low"])
        else:
            mfe_fast = (entry - np.min(l_fast_arr)) / atr
            mae_fast = (np.max(h_fast_arr) - entry) / atr
            full_fill_fast = np.max(h_fast_arr) >= float(r["gap_high"])
            full_fill_slow = np.max(h_slow_arr) >= float(r["gap_high"])

        hit_fast = first_hit_outcome(side, entry, atr, h_fast_arr, l_fast_arr, r=1.0)
        hit_slow = first_hit_outcome(side, entry, atr, h_slow_arr, l_slow_arr, r=1.0)

        rr = dict(r)
        rr.update(
            {
                "mfe_r_fast": float(mfe_fast),
                "mae_r_fast": float(mae_fast),
                "hit_outcome_fast": hit_fast,
                "hit_outcome_slow": hit_slow,
                "full_fill_fast": int(full_fill_fast),
                "full_fill_slow": int(full_fill_slow),
            }
        )
        out_rows.append(rr)
    return pd.DataFrame(out_rows)


def agg_concept(df: pd.DataFrame, by_cols: list[str]) -> pd.DataFrame:
    if len(df) == 0:
        return pd.DataFrame()
    out = (
        df.groupby(by_cols, as_index=False)
        .agg(
            n=("event_side", "size"),
            mean_gap_bps=("gap_bps", "mean"),
            mean_mfe_r=("mfe_r_fast", "mean"),
            mean_mae_r=("mae_r_fast", "mean"),
            plus1r_fast=("hit_outcome_fast", lambda s: float((s == "plus").mean())),
            minus1r_fast=("hit_outcome_fast", lambda s: float((s == "minus").mean())),
            both_fast=("hit_outcome_fast", lambda s: float((s == "both").mean())),
            full_fill_fast=("full_fill_fast", "mean"),
            full_fill_slow=("full_fill_slow", "mean"),
        )
        .sort_values(by_cols + ["n"], ascending=[True] * len(by_cols) + [False])
    )
    out["edge_score_fast"] = out["plus1r_fast"] - out["minus1r_fast"]
    return out


def md_table(df: pd.DataFrame) -> str:
    if len(df) == 0:
        return "_Empty._"
    cols = list(df.columns)
    lines = ["| " + " | ".join(cols) + " |", "| " + " | ".join("---" for _ in cols) + " |"]
    for _, row in df.iterrows():
        lines.append("| " + " | ".join(str(row[c]) for c in cols) + " |")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description="XRP FVG concept study by regime")
    ap.add_argument("--db", default=os.path.abspath(DEFAULT_DB))
    ap.add_argument("--symbol", default="XRPUSDT")
    ap.add_argument("--months", type=int, default=48)
    ap.add_argument("--tf", default="1h")
    ap.add_argument("--atr-period", type=int, default=14)
    ap.add_argument("--lookback", type=int, default=20)
    ap.add_argument("--min-gap-bps", type=float, default=1.0)
    ap.add_argument(
        "--strict-fvg",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Require displacement on middle candle for FVG validity.",
    )
    ap.add_argument(
        "--disp-quantile",
        type=float,
        default=0.75,
        help="Middle-candle body quantile threshold for strict FVG filter.",
    )
    ap.add_argument("--disp-lookback", type=int, default=120, help="Rolling lookback for displacement threshold.")
    ap.add_argument("--h-fast", type=int, default=24, help="Forward bars for primary outcomes (24 = 1 day on 1h)")
    ap.add_argument("--h-slow", type=int, default=72, help="Forward bars for slow fill check")
    ap.add_argument("--large-fvg-q", type=float, default=0.90, help="Quantile threshold for large FVG in HIGH_VOL")
    ap.add_argument("--out-dir", default=str(SCRIPT_DIR / "out"))
    args = ap.parse_args()

    db_path = os.path.abspath(args.db)
    symbol = args.symbol.strip().upper()
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
    clf = classify_regimes(df, atr_period=args.atr_period, lookback=args.lookback)
    fvg = detect_fvg(
        clf,
        min_gap_bps=args.min_gap_bps,
        strict=args.strict_fvg,
        disp_quantile=args.disp_quantile,
        disp_lookback=args.disp_lookback,
    )
    if len(fvg) == 0:
        raise SystemExit("No FVG events found. Lower --min-gap-bps.")

    ev = fvg.merge(
        clf[
            [
                "atr",
                "structure_regime",
                "vol_regime",
                "regime_bias",
                "range_pos",
            ]
        ].reset_index().rename(columns={"Date": "ts"}),
        on="ts",
        how="left",
    )
    ev = ev.dropna(subset=["atr", "structure_regime", "vol_regime", "regime_bias", "range_pos"]).copy()

    # Concept tags
    ev["trend_alignment"] = "other"
    ev.loc[
        (ev["structure_regime"] == "IMBALANCE")
        & (
            ((ev["event_side"] == "bullish") & (ev["regime_bias"] == "bullish"))
            | ((ev["event_side"] == "bearish") & (ev["regime_bias"] == "bearish"))
        ),
        "trend_alignment",
    ] = "trend_aligned"
    ev.loc[
        (ev["structure_regime"] == "IMBALANCE")
        & (
            ((ev["event_side"] == "bullish") & (ev["regime_bias"] == "bearish"))
            | ((ev["event_side"] == "bearish") & (ev["regime_bias"] == "bullish"))
        ),
        "trend_alignment",
    ] = "trend_counter"

    ev["range_zone"] = "other"
    ev.loc[(ev["structure_regime"] == "BALANCE") & (ev["range_pos"].between(0.30, 0.70)), "range_zone"] = "middle"
    ev.loc[
        (ev["structure_regime"] == "BALANCE") & ((ev["range_pos"] <= 0.15) | (ev["range_pos"] >= 0.85)),
        "range_zone",
    ] = "edge"

    hi_mask = ev["vol_regime"] == "HIGH_VOL"
    q_large = float(ev.loc[hi_mask, "gap_bps"].quantile(args.large_fvg_q)) if hi_mask.any() else np.nan
    ev["high_vol_size_bucket"] = "other"
    ev.loc[hi_mask, "high_vol_size_bucket"] = "high_vol_regular"
    if np.isfinite(q_large):
        ev.loc[hi_mask & (ev["gap_bps"] >= q_large), "high_vol_size_bucket"] = "high_vol_large"

    scored = compute_forward_stats(clf, ev, h_fast=args.h_fast, h_slow=args.h_slow)
    if len(scored) == 0:
        raise SystemExit("No scored events; increase data window or reduce horizons.")

    c1 = agg_concept(
        scored[scored["trend_alignment"].isin(["trend_aligned", "trend_counter"])],
        ["trend_alignment", "event_side"],
    )
    c2 = agg_concept(
        scored[scored["range_zone"].isin(["middle", "edge"])],
        ["range_zone", "event_side"],
    )
    c3 = agg_concept(
        scored[scored["high_vol_size_bucket"].isin(["high_vol_regular", "high_vol_large"])],
        ["high_vol_size_bucket", "event_side"],
    )

    # Visual chart
    fig, axes = plt.subplots(1, 3, figsize=(16, 4.8))

    def _plot_metric(ax, dfm, xcol, title, metric):
        if len(dfm) == 0:
            ax.set_title(title + " (no rows)")
            return
        pivot = dfm.pivot(index=xcol, columns="event_side", values=metric).fillna(0.0)
        pivot = pivot.sort_index()
        pivot.plot(kind="bar", ax=ax)
        ax.set_title(title)
        ax.set_ylabel(metric)
        ax.tick_params(axis="x", rotation=20)
        ax.legend(fontsize=8)

    _plot_metric(axes[0], c1, "trend_alignment", "Concept 1: Trend Alignment", "edge_score_fast")
    _plot_metric(axes[1], c2, "range_zone", "Concept 2: Range Zone", "edge_score_fast")
    _plot_metric(axes[2], c3, "high_vol_size_bucket", "Concept 3: High-Vol Size", "full_fill_slow")
    fig.suptitle(f"{symbol} FVG Concept Study ({args.tf}, {args.months}m)")
    fig.tight_layout()

    tag = f"{symbol}_{args.tf}_m{args.months}"
    events_csv = out_dir / f"fvg_concepts_events_{tag}.csv"
    c1_csv = out_dir / f"fvg_concept1_trend_{tag}.csv"
    c2_csv = out_dir / f"fvg_concept2_range_{tag}.csv"
    c3_csv = out_dir / f"fvg_concept3_highvol_{tag}.csv"
    chart_png = out_dir / f"fvg_concepts_chart_{tag}.png"
    report_md = out_dir / f"FVG_CONCEPTS_STUDY_{tag}.md"

    scored.to_csv(events_csv, index=False)
    c1.to_csv(c1_csv, index=False)
    c2.to_csv(c2_csv, index=False)
    c3.to_csv(c3_csv, index=False)
    fig.savefig(chart_png, dpi=180, bbox_inches="tight")
    plt.close(fig)

    lines = [
        f"# FVG Concepts Study: {symbol} ({args.tf})",
        "",
        "## Setup",
        "",
        f"- DB: `{db_path}`",
        f"- Window: `{df5.index.min().isoformat()} -> {df5.index.max().isoformat()}`",
        f"- FVG min gap: `{args.min_gap_bps} bps`",
        f"- Strict FVG filter: `{args.strict_fvg}` | displacement q: `{args.disp_quantile}` over `{args.disp_lookback}` bars",
        f"- Fast horizon: `{args.h_fast}` bars | Slow horizon: `{args.h_slow}` bars",
        f"- Large FVG quantile in HIGH_VOL: `{args.large_fvg_q}`",
        "",
        "## Concept 1: Trending Regime (Aligned vs Counter)",
        "",
        md_table(c1.round(4)),
        "",
        "## Concept 2: Ranging Regime (Middle vs Edge)",
        "",
        md_table(c2.round(4)),
        "",
        "## Concept 3: High-Vol Regime (Large vs Regular FVG)",
        "",
        md_table(c3.round(4)),
        "",
        "## Artifacts",
        "",
        f"- Event rows: `{events_csv}`",
        f"- Concept 1 table: `{c1_csv}`",
        f"- Concept 2 table: `{c2_csv}`",
        f"- Concept 3 table: `{c3_csv}`",
        f"- Chart: `{chart_png}`",
    ]
    report_md.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"Wrote {events_csv} ({len(scored)} rows)")
    print(f"Wrote {chart_png}")
    print("Concept1 rows:", len(c1), "Concept2 rows:", len(c2), "Concept3 rows:", len(c3))


if __name__ == "__main__":
    main()
