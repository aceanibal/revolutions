#!/usr/bin/env python3
"""
XRP FVG utility study: is FVG more useful as stop anchor or TP anchor?

We compare two strategy templates on the same directional FVG events:

1) FVG_STOP_ANCHOR (continuation):
   - entry: close at FVG event bar
   - stop: opposite side of FVG zone
   - tp: fixed multiple of risk (tp_r * risk)

2) FVG_TP_ANCHOR (continuation):
   - entry: close at FVG event bar
   - stop: ATR multiple (sl_r_atr * ATR)
   - tp: FVG geometry projection (entry +/- gap_size)

No L2/tape data; chart-only proxy.
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
    prev = np.empty(n)
    prev[0] = close[0]
    prev[1:] = close[:-1]
    tr = np.maximum(high - low, np.maximum(np.abs(high - prev), np.abs(low - prev)))
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


def classify_bias(df: pd.DataFrame, atr_period: int = 14, lookback: int = 20) -> pd.DataFrame:
    close = df["close"]
    high = df["high"]
    low = df["low"]
    atr = pd.Series(
        wilder_atr(high.values.astype(float), low.values.astype(float), close.values.astype(float), atr_period),
        index=df.index,
    )
    ema_fast = close.ewm(span=20, adjust=False).mean()
    ema_slow = close.ewm(span=50, adjust=False).mean()
    er = efficiency_ratio(close, n=lookback)
    trend_sep = (ema_fast - ema_slow).abs() / atr.replace(0, np.nan)
    q_er_hi = float(er.quantile(0.65))
    q_sep_hi = float(trend_sep.quantile(0.65))
    structure = pd.Series("BALANCE", index=df.index)
    structure.loc[(er >= q_er_hi) & (trend_sep >= q_sep_hi)] = "IMBALANCE"
    bias = pd.Series("neutral", index=df.index)
    bias.loc[(close > ema_slow) & (ema_fast > ema_slow)] = "bullish"
    bias.loc[(close < ema_slow) & (ema_fast < ema_slow)] = "bearish"
    out = df.copy()
    out["atr"] = atr
    out["structure_regime"] = structure
    out["regime_bias"] = bias
    return out.dropna(subset=["atr"]).copy()


def detect_fvg(
    df: pd.DataFrame,
    min_gap_bps: float,
    strict: bool,
    disp_quantile: float,
    disp_lookback: int,
) -> pd.DataFrame:
    high = df["high"].values
    low = df["low"].values
    open_ = df["open"].values
    close = df["close"].values
    body = np.abs(close - open_)
    idx = df.index
    disp_thr = (
        pd.Series(body, index=idx)
        .rolling(disp_lookback, min_periods=max(30, disp_lookback // 3))
        .quantile(disp_quantile)
        .values
    )
    rows: list[dict] = []
    for i in range(2, len(df)):
        px = float(close[i])
        if px <= 0:
            continue
        bull_gap = float(low[i] - high[i - 2])
        bull_bps = 10000.0 * bull_gap / px
        bull_ok = bull_gap > 0 and bull_bps >= min_gap_bps
        if strict:
            bull_ok = bull_ok and np.isfinite(disp_thr[i - 1]) and (body[i - 1] >= disp_thr[i - 1]) and (close[i - 1] > high[i - 2])
        if bull_ok:
            rows.append(
                {
                    "ts": idx[i],
                    "event_side": "bullish",
                    "gap_low": float(high[i - 2]),
                    "gap_high": float(low[i]),
                    "gap_bps": bull_bps,
                    "gap_size": bull_gap,
                }
            )

        bear_gap = float(low[i - 2] - high[i])
        bear_bps = 10000.0 * bear_gap / px
        bear_ok = bear_gap > 0 and bear_bps >= min_gap_bps
        if strict:
            bear_ok = bear_ok and np.isfinite(disp_thr[i - 1]) and (body[i - 1] >= disp_thr[i - 1]) and (close[i - 1] < low[i - 2])
        if bear_ok:
            rows.append(
                {
                    "ts": idx[i],
                    "event_side": "bearish",
                    "gap_low": float(high[i]),
                    "gap_high": float(low[i - 2]),
                    "gap_bps": bear_bps,
                    "gap_size": bear_gap,
                }
            )
    return pd.DataFrame(rows)


def replay_first_touch(
    *,
    side: str,
    entry: float,
    stop: float,
    tp: float,
    highs: np.ndarray,
    lows: np.ndarray,
) -> tuple[float, str]:
    risk = abs(entry - stop)
    if risk <= 0 or not np.isfinite(risk):
        return np.nan, "bad_risk"
    for h, l in zip(highs, lows):
        if side == "bullish":
            hit_sl = l <= stop
            hit_tp = h >= tp
        else:
            hit_sl = h >= stop
            hit_tp = l <= tp
        if hit_sl and hit_tp:
            return -1.0, "both_sl_first"
        if hit_sl:
            return -1.0, "sl"
        if hit_tp:
            rr = abs(tp - entry) / risk
            return float(rr), "tp"
    # time exit at last close is not available here; mark no hit
    return 0.0, "time"


def main() -> None:
    ap = argparse.ArgumentParser(description="Study whether FVG is better as stop or TP anchor")
    ap.add_argument("--db", default=os.path.abspath(DEFAULT_DB))
    ap.add_argument("--symbol", default="XRPUSDT")
    ap.add_argument("--months", type=int, default=48)
    ap.add_argument("--tf", default="1h")
    ap.add_argument("--atr-period", type=int, default=14)
    ap.add_argument("--lookback", type=int, default=20)
    ap.add_argument("--min-gap-bps", type=float, default=5.0)
    ap.add_argument("--strict-fvg", action=argparse.BooleanOptionalAction, default=True)
    ap.add_argument("--disp-quantile", type=float, default=0.85)
    ap.add_argument("--disp-lookback", type=int, default=120)
    ap.add_argument("--max-horizon-bars", type=int, default=24)
    ap.add_argument("--tp-r", type=float, default=2.0, help="TP multiple for FVG_STOP_ANCHOR strategy")
    ap.add_argument("--sl-r-atr", type=float, default=1.0, help="ATR stop multiple for FVG_TP_ANCHOR strategy")
    ap.add_argument("--only-aligned", action=argparse.BooleanOptionalAction, default=True)
    ap.add_argument("--out-dir", default=str(SCRIPT_DIR / "out"))
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    df5 = load_merged_5m(os.path.abspath(args.db), args.symbol.strip().upper())
    if len(df5) == 0:
        raise SystemExit("No data")
    end = df5.index.max()
    df5 = df5.loc[df5.index >= (end - pd.DateOffset(months=args.months))].copy()
    df = (
        df5.resample(args.tf)
        .agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
        .dropna()
    )
    ctx = classify_bias(df, atr_period=args.atr_period, lookback=args.lookback)
    fvg = detect_fvg(
        ctx,
        min_gap_bps=args.min_gap_bps,
        strict=args.strict_fvg,
        disp_quantile=args.disp_quantile,
        disp_lookback=args.disp_lookback,
    )
    if len(fvg) == 0:
        raise SystemExit("No FVG rows under current filters.")

    ev = fvg.merge(
        ctx[["atr", "regime_bias", "structure_regime", "close"]].reset_index().rename(columns={"Date": "ts"}),
        on="ts",
        how="left",
    )
    ev["aligned"] = (
        ((ev["event_side"] == "bullish") & (ev["regime_bias"] == "bullish"))
        | ((ev["event_side"] == "bearish") & (ev["regime_bias"] == "bearish"))
    )
    if args.only_aligned:
        ev = ev[ev["aligned"]].copy()
    ev = ev.reset_index(drop=True)
    if len(ev) == 0:
        raise SystemExit("No events after alignment filter.")

    idx_to_pos = {ts: i for i, ts in enumerate(ctx.index)}
    highs = ctx["high"].values.astype(float)
    lows = ctx["low"].values.astype(float)
    closes = ctx["close"].values.astype(float)

    rows: list[dict] = []
    for _, r in ev.iterrows():
        i = idx_to_pos.get(r["ts"])
        if i is None or i + 1 >= len(ctx):
            continue
        j = min(len(ctx), i + 1 + args.max_horizon_bars)
        h = highs[i + 1 : j]
        l = lows[i + 1 : j]
        if len(h) == 0:
            continue

        side = str(r["event_side"])
        entry = float(closes[i])
        atr = float(r["atr"])
        gap_size = float(r["gap_size"])

        # Strategy A: FVG as stop anchor, TP = tp_r * risk
        if side == "bullish":
            stop_a = float(r["gap_low"])
            risk_a = entry - stop_a
            tp_a = entry + args.tp_r * risk_a if risk_a > 0 else np.nan
        else:
            stop_a = float(r["gap_high"])
            risk_a = stop_a - entry
            tp_a = entry - args.tp_r * risk_a if risk_a > 0 else np.nan
        ra, reason_a = replay_first_touch(side=side, entry=entry, stop=stop_a, tp=tp_a, highs=h, lows=l) if np.isfinite(tp_a) else (np.nan, "bad_setup")

        # Strategy B: FVG as TP anchor, stop = ATR multiple
        if side == "bullish":
            stop_b = entry - args.sl_r_atr * atr
            tp_b = entry + gap_size
        else:
            stop_b = entry + args.sl_r_atr * atr
            tp_b = entry - gap_size
        rb, reason_b = replay_first_touch(side=side, entry=entry, stop=stop_b, tp=tp_b, highs=h, lows=l)

        rr = dict(r)
        rr.update(
            {
                "r_stop_anchor": ra,
                "reason_stop_anchor": reason_a,
                "r_tp_anchor": rb,
                "reason_tp_anchor": reason_b,
            }
        )
        rows.append(rr)

    scored = pd.DataFrame(rows)
    if len(scored) == 0:
        raise SystemExit("No scored rows.")

    # Aggregate
    def _agg(df_in: pd.DataFrame, r_col: str, reason_col: str) -> pd.DataFrame:
        g = (
            df_in.groupby(["event_side", "structure_regime"], as_index=False)
            .agg(
                n=(r_col, "size"),
                mean_r=(r_col, "mean"),
                median_r=(r_col, "median"),
                win_rate=(r_col, lambda s: float((s > 0).mean())),
                tp_rate=(reason_col, lambda s: float((s == "tp").mean())),
                sl_rate=(reason_col, lambda s: float((s == "sl").mean()) + float((s == "both_sl_first").mean())),
                time_rate=(reason_col, lambda s: float((s == "time").mean())),
            )
            .sort_values(["event_side", "structure_regime"])
        )
        return g

    a = _agg(scored, "r_stop_anchor", "reason_stop_anchor")
    b = _agg(scored, "r_tp_anchor", "reason_tp_anchor")
    a["strategy"] = "FVG_STOP_ANCHOR"
    b["strategy"] = "FVG_TP_ANCHOR"
    comp = pd.concat([a, b], ignore_index=True)

    overall = (
        comp.groupby("strategy", as_index=False)
        .agg(
            total_n=("n", "sum"),
            avg_mean_r=("mean_r", "mean"),
            avg_median_r=("median_r", "mean"),
            avg_win_rate=("win_rate", "mean"),
            avg_tp_rate=("tp_rate", "mean"),
            avg_sl_rate=("sl_rate", "mean"),
            avg_time_rate=("time_rate", "mean"),
        )
        .sort_values("avg_mean_r", ascending=False)
    )

    # Chart
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.8))
    m = comp.groupby("strategy", as_index=False)["mean_r"].mean()
    axes[0].bar(m["strategy"], m["mean_r"])
    axes[0].set_title("Average mean R by strategy")
    axes[0].tick_params(axis="x", rotation=20)
    wr = comp.groupby("strategy", as_index=False)["win_rate"].mean()
    axes[1].bar(wr["strategy"], wr["win_rate"])
    axes[1].set_title("Average win rate by strategy")
    axes[1].set_ylim(0, 1)
    axes[1].tick_params(axis="x", rotation=20)
    fig.tight_layout()

    tag = f"{args.symbol.strip().upper()}_{args.tf}_m{args.months}"
    events_csv = out_dir / f"fvg_stop_vs_tp_events_{tag}.csv"
    comp_csv = out_dir / f"fvg_stop_vs_tp_comparison_{tag}.csv"
    overall_csv = out_dir / f"fvg_stop_vs_tp_overall_{tag}.csv"
    chart_png = out_dir / f"fvg_stop_vs_tp_chart_{tag}.png"
    report_md = out_dir / f"FVG_STOP_VS_TP_STUDY_{tag}.md"

    scored.to_csv(events_csv, index=False)
    comp.to_csv(comp_csv, index=False)
    overall.to_csv(overall_csv, index=False)
    fig.savefig(chart_png, dpi=180, bbox_inches="tight")
    plt.close(fig)

    def md_table(dfm: pd.DataFrame) -> str:
        if len(dfm) == 0:
            return "_Empty._"
        cols = list(dfm.columns)
        lines_local = ["| " + " | ".join(cols) + " |", "| " + " | ".join("---" for _ in cols) + " |"]
        for _, rr in dfm.iterrows():
            lines_local.append("| " + " | ".join(str(rr[c]) for c in cols) + " |")
        return "\n".join(lines_local)

    lines = [
        f"# FVG Stop vs TP Study: {args.symbol.strip().upper()} ({args.tf})",
        "",
        "## Setup",
        "",
        f"- Window months: `{args.months}`",
        f"- Strict FVG: `{args.strict_fvg}` | min gap bps: `{args.min_gap_bps}`",
        f"- Horizon bars: `{args.max_horizon_bars}`",
        f"- Strategy A (FVG stop): TP = `{args.tp_r}R`",
        f"- Strategy B (FVG TP): Stop = `{args.sl_r_atr} * ATR`",
        f"- Only aligned events: `{args.only_aligned}`",
        "",
        "## Overall",
        "",
        md_table(overall.round(4)),
        "",
        "## By Side + Structure",
        "",
        md_table(comp.round(4)),
        "",
        "## Artifacts",
        "",
        f"- Event rows: `{events_csv}`",
        f"- Comparison: `{comp_csv}`",
        f"- Overall: `{overall_csv}`",
        f"- Chart: `{chart_png}`",
    ]
    report_md.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"Wrote {events_csv} ({len(scored)} rows)")
    print(overall.to_string(index=False))
    print(f"Wrote {chart_png}")


if __name__ == "__main__":
    main()
