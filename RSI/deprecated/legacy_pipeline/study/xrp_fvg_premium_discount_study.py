#!/usr/bin/env python3
"""
XRP FVG premium/discount study (1h by default).

Idea tested:
- In bullish context, bullish FVGs formed in DISCOUNT (< 50% of recent leg range)
  should behave better than bullish FVGs formed in PREMIUM (> 50%).
- Symmetric test is also reported for bearish context.

Premium/discount proxy:
- Build rolling swing leg from prior `--leg-lookback` bars (high/low, shifted by 1).
- Equilibrium = (leg_high + leg_low) / 2.
- If close <= EQ => DISCOUNT, else PREMIUM.

Outputs:
- Event-level CSV with premium/discount tag and forward outcomes.
- Summary CSVs and a PNG chart.
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


def classify_context(df: pd.DataFrame, atr_period: int, lookback: int, leg_lookback: int) -> pd.DataFrame:
    close = df["close"]
    high = df["high"]
    low = df["low"]

    atr = pd.Series(
        wilder_atr(high.values.astype(float), low.values.astype(float), close.values.astype(float), atr_period),
        index=df.index,
    )
    atr_pct = 100.0 * atr / close
    atr_roc = atr_pct.pct_change()

    ema_fast = close.ewm(span=20, adjust=False).mean()
    ema_slow = close.ewm(span=50, adjust=False).mean()
    trend_sep = (ema_fast - ema_slow).abs() / atr.replace(0, np.nan)
    er = efficiency_ratio(close, n=lookback)

    hh = high.rolling(lookback).max().shift(1)
    ll = low.rolling(lookback).min().shift(1)
    breakout = (close > hh) | (close < ll)

    q_atr_hi = float(atr_pct.quantile(0.75))
    q_atr_lo = float(atr_pct.quantile(0.25))
    pos_roc = atr_roc[atr_roc > 0]
    neg_roc = atr_roc[atr_roc < 0]
    q_roc_up = float(pos_roc.quantile(0.75)) if len(pos_roc) else np.nan
    q_roc_dn = float(neg_roc.quantile(0.25)) if len(neg_roc) else np.nan
    q_er_hi = float(er.quantile(0.65))
    q_sep_hi = float(trend_sep.quantile(0.65))

    structure_regime = pd.Series("BALANCE", index=df.index)
    structure_regime.loc[(er >= q_er_hi) & (trend_sep >= q_sep_hi)] = "IMBALANCE"

    vol_regime = pd.Series("NORMAL_VOL", index=df.index)
    vol_regime.loc[(atr_pct <= q_atr_lo) & (atr_roc <= q_roc_dn)] = "LOW_VOL"
    vol_regime.loc[(atr_pct >= q_atr_hi) & ((atr_roc >= q_roc_up) | breakout)] = "HIGH_VOL"

    regime_bias = pd.Series("neutral", index=df.index)
    regime_bias.loc[(close > ema_slow) & (ema_fast > ema_slow)] = "bullish"
    regime_bias.loc[(close < ema_slow) & (ema_fast < ema_slow)] = "bearish"

    leg_high = high.rolling(leg_lookback).max().shift(1)
    leg_low = low.rolling(leg_lookback).min().shift(1)
    eq = (leg_high + leg_low) / 2.0
    zone = pd.Series("premium", index=df.index)
    zone.loc[close <= eq] = "discount"

    out = df.copy()
    out["atr"] = atr
    out["atr_pct"] = atr_pct
    out["structure_regime"] = structure_regime
    out["vol_regime"] = vol_regime
    out["regime_bias"] = regime_bias
    out["leg_high"] = leg_high
    out["leg_low"] = leg_low
    out["eq50"] = eq
    out["premium_discount_zone"] = zone
    return out.dropna(subset=["atr", "leg_high", "leg_low", "eq50"]).copy()


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
        bull_gap = float(low[i] - high[i - 2])
        bull_bps = 10000.0 * bull_gap / px
        bull_ok = bull_gap > 0 and bull_bps >= min_gap_bps
        if strict:
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


def first_hit_outcome(side: str, entry: float, atr: float, highs: np.ndarray, lows: np.ndarray, r: float) -> str:
    if atr <= 0 or not np.isfinite(atr):
        return "none"
    if side == "bullish":
        up = entry + r * atr
        dn = entry - r * atr
        for h, l in zip(highs, lows):
            hit_up = h >= up
            hit_dn = l <= dn
            if hit_up and hit_dn:
                return "both"
            if hit_up:
                return "plus"
            if hit_dn:
                return "minus"
    else:
        up = entry - r * atr
        dn = entry + r * atr
        for h, l in zip(highs, lows):
            hit_up = l <= up
            hit_dn = h >= dn
            if hit_up and hit_dn:
                return "both"
            if hit_up:
                return "plus"
            if hit_dn:
                return "minus"
    return "none"


def score_events(df: pd.DataFrame, ev: pd.DataFrame, h_fast: int, h_slow: int, hit_r: float) -> pd.DataFrame:
    idx_to_pos = {ts: i for i, ts in enumerate(df.index)}
    highs = df["high"].values.astype(float)
    lows = df["low"].values.astype(float)
    closes = df["close"].values.astype(float)
    rows: list[dict] = []
    for _, r in ev.iterrows():
        i = idx_to_pos.get(r["ts"])
        if i is None or i + 1 >= len(df):
            continue
        entry = float(closes[i])
        atr = float(r["atr"])
        side = str(r["event_side"])
        if not np.isfinite(atr) or atr <= 0:
            continue
        j1 = min(len(df), i + 1 + h_fast)
        j2 = min(len(df), i + 1 + h_slow)
        h1 = highs[i + 1 : j1]
        l1 = lows[i + 1 : j1]
        h2 = highs[i + 1 : j2]
        l2 = lows[i + 1 : j2]
        if len(h1) == 0 or len(h2) == 0:
            continue

        if side == "bullish":
            mfe = (np.max(h1) - entry) / atr
            mae = (entry - np.min(l1)) / atr
            fill_fast = np.min(l1) <= float(r["gap_low"])
            fill_slow = np.min(l2) <= float(r["gap_low"])
        else:
            mfe = (entry - np.min(l1)) / atr
            mae = (np.max(h1) - entry) / atr
            fill_fast = np.max(h1) >= float(r["gap_high"])
            fill_slow = np.max(h2) >= float(r["gap_high"])

        hit_fast = first_hit_outcome(side, entry, atr, h1, l1, r=hit_r)
        rr = dict(r)
        rr.update(
            {
                "mfe_r_fast": float(mfe),
                "mae_r_fast": float(mae),
                "hit_outcome_fast": hit_fast,
                "full_fill_fast": int(fill_fast),
                "full_fill_slow": int(fill_slow),
            }
        )
        rows.append(rr)
    return pd.DataFrame(rows)


def aggregate(df: pd.DataFrame, by_cols: list[str]) -> pd.DataFrame:
    if len(df) == 0:
        return pd.DataFrame()
    out = (
        df.groupby(by_cols, as_index=False)
        .agg(
            n=("event_side", "size"),
            mean_gap_bps=("gap_bps", "mean"),
            mean_mfe_r=("mfe_r_fast", "mean"),
            mean_mae_r=("mae_r_fast", "mean"),
            plus_hit=("hit_outcome_fast", lambda s: float((s == "plus").mean())),
            minus_hit=("hit_outcome_fast", lambda s: float((s == "minus").mean())),
            both_hit=("hit_outcome_fast", lambda s: float((s == "both").mean())),
            fill_fast=("full_fill_fast", "mean"),
            fill_slow=("full_fill_slow", "mean"),
        )
        .sort_values(by_cols + ["n"], ascending=[True] * len(by_cols) + [False])
    )
    out["edge_score"] = out["plus_hit"] - out["minus_hit"]
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
    ap = argparse.ArgumentParser(description="XRP FVG premium/discount concept study")
    ap.add_argument("--db", default=os.path.abspath(DEFAULT_DB))
    ap.add_argument("--symbol", default="XRPUSDT")
    ap.add_argument("--months", type=int, default=48)
    ap.add_argument("--tf", default="1h")
    ap.add_argument("--atr-period", type=int, default=14)
    ap.add_argument("--lookback", type=int, default=20)
    ap.add_argument("--leg-lookback", type=int, default=48, help="Bars to define swing range and EQ50")
    ap.add_argument("--min-gap-bps", type=float, default=1.0)
    ap.add_argument(
        "--strict-fvg",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Require displacement on middle candle for FVG validity.",
    )
    ap.add_argument("--disp-quantile", type=float, default=0.75, help="Middle-candle displacement quantile.")
    ap.add_argument("--disp-lookback", type=int, default=120, help="Rolling lookback for displacement quantile.")
    ap.add_argument("--h-fast", type=int, default=24)
    ap.add_argument("--h-slow", type=int, default=72)
    ap.add_argument("--hit-r", type=float, default=1.0)
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

    ctx = classify_context(df, atr_period=args.atr_period, lookback=args.lookback, leg_lookback=args.leg_lookback)
    fvg = detect_fvg(
        ctx,
        min_gap_bps=args.min_gap_bps,
        strict=args.strict_fvg,
        disp_quantile=args.disp_quantile,
        disp_lookback=args.disp_lookback,
    )
    if len(fvg) == 0:
        raise SystemExit("No FVG events found. Lower --min-gap-bps.")

    ev = fvg.merge(
        ctx[
            [
                "atr",
                "structure_regime",
                "vol_regime",
                "regime_bias",
                "premium_discount_zone",
                "eq50",
                "leg_high",
                "leg_low",
            ]
        ]
        .reset_index()
        .rename(columns={"Date": "ts"}),
        on="ts",
        how="left",
    )
    ev = ev.dropna(subset=["atr", "premium_discount_zone", "regime_bias"]).copy()
    ev["aligned_to_bias"] = (
        ((ev["event_side"] == "bullish") & (ev["regime_bias"] == "bullish"))
        | ((ev["event_side"] == "bearish") & (ev["regime_bias"] == "bearish"))
    )

    scored = score_events(ctx, ev, h_fast=args.h_fast, h_slow=args.h_slow, hit_r=args.hit_r)
    if len(scored) == 0:
        raise SystemExit("No scored events generated.")

    # Core concept table: only aligned events, grouped by side + zone.
    aligned = scored[scored["aligned_to_bias"]].copy()
    concept = aggregate(aligned, ["event_side", "premium_discount_zone"])

    # Extra: by structure regime and zone
    by_structure = aggregate(aligned, ["structure_regime", "event_side", "premium_discount_zone"])

    # Visual: edge score and +hit by zone for bullish and bearish aligned cases
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.8))
    for ax, side in zip(axes, ["bullish", "bearish"]):
        sub = concept[concept["event_side"] == side].set_index("premium_discount_zone")
        zones = ["discount", "premium"]
        edge = [float(sub["edge_score"].get(z, np.nan)) for z in zones]
        plus = [float(sub["plus_hit"].get(z, np.nan)) for z in zones]
        x = np.arange(len(zones))
        ax.bar(x - 0.18, edge, width=0.35, label="edge_score")
        ax.bar(x + 0.18, plus, width=0.35, label=f"plus_hit @ {args.hit_r:.1f}R")
        ax.set_xticks(x)
        ax.set_xticklabels(zones)
        ax.set_title(f"Aligned {side} FVG")
        ax.set_ylim(min(-0.3, np.nanmin(edge) - 0.05), max(0.8, np.nanmax(plus) + 0.05))
        ax.legend(fontsize=8)
    fig.suptitle(f"{symbol} FVG Premium/Discount Study ({args.tf}, {args.months}m)")
    fig.tight_layout()

    tag = f"{symbol}_{args.tf}_m{args.months}"
    events_csv = out_dir / f"fvg_premium_discount_events_{tag}.csv"
    concept_csv = out_dir / f"fvg_premium_discount_concept_{tag}.csv"
    structure_csv = out_dir / f"fvg_premium_discount_by_structure_{tag}.csv"
    chart_png = out_dir / f"fvg_premium_discount_chart_{tag}.png"
    report_md = out_dir / f"FVG_PREMIUM_DISCOUNT_STUDY_{tag}.md"

    scored.to_csv(events_csv, index=False)
    concept.to_csv(concept_csv, index=False)
    by_structure.to_csv(structure_csv, index=False)
    fig.savefig(chart_png, dpi=180, bbox_inches="tight")
    plt.close(fig)

    lines = [
        f"# FVG Premium/Discount Study: {symbol} ({args.tf})",
        "",
        "## Setup",
        "",
        f"- DB: `{db_path}`",
        f"- Window: `{df5.index.min().isoformat()} -> {df5.index.max().isoformat()}`",
        f"- Leg lookback: `{args.leg_lookback}` bars | EQ50 = (leg_high + leg_low)/2",
        f"- Strict FVG filter: `{args.strict_fvg}` | displacement q `{args.disp_quantile}` over `{args.disp_lookback}` bars",
        f"- Aligned sample: FVG side matches regime bias direction",
        f"- Horizons: fast `{args.h_fast}` bars, slow `{args.h_slow}` bars",
        "",
        "## Core Result (Aligned FVGs by Zone)",
        "",
        md_table(concept.round(4)),
        "",
        "## By Structure Regime",
        "",
        md_table(by_structure.round(4)),
        "",
        "## Artifacts",
        "",
        f"- Event rows: `{events_csv}`",
        f"- Core concept CSV: `{concept_csv}`",
        f"- By structure CSV: `{structure_csv}`",
        f"- Chart: `{chart_png}`",
    ]
    report_md.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"Wrote {events_csv} ({len(scored)} rows)")
    print(f"Wrote {chart_png}")
    print(concept.round(4).to_string(index=False))


if __name__ == "__main__":
    main()
