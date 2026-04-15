#!/usr/bin/env python3
"""
Run XRP bullish FVG-in-IMBALANCE strategy (v1-style packaged output).

Strategy:
- Build 1h bars from merged 5m.
- Detect strict bullish FVG events.
- Enter long only when:
  * structure_regime == IMBALANCE
  * regime_bias == bullish
- Stop = FVG low boundary.
- TP = entry + tp_r * risk.
- Replay path on 5m bars (conservative same-bar SL before TP), starting at the first 5m **at or after**
  HTF period close (signal bar label + `--tf`), so the hourly close is not traded before it exists.

Outputs:
- runs/run_fvg_imbalance_<timestamp>/ (one folder per `--tp-r`, or per TP when `--tp-sweep` has multiple values)
  - run_config.json
  - artifacts/summary.csv
  - artifacts/monthly.csv
  - artifacts/trades.csv
  - artifacts/REPORT.md
  - manifest_files.txt
- With `--tp-sweep` (2+ values): also `cache/fvg_imbalance_tp_sweep_summary.csv` and
  `study/out/FVG_IMBALANCE_TP_SWEEP.md` (aggregate win rates / TP hit rates).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
SIM_DIR = PROJECT_ROOT / "simulation"
if str(SIM_DIR) not in sys.path:
    sys.path.insert(0, str(SIM_DIR))
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from massive_chunk_backtest_5m_v1fix import load_merged_5m  # noqa: E402
from multi_asset_4h_rsi_sim import DB_PATH as DEFAULT_DB  # noqa: E402


def _tp_tag(tp_r: float) -> str:
    return f"tp{str(tp_r).replace('.', 'p')}"


def parse_float_grid(s: str) -> list[float]:
    return [float(x.strip()) for x in s.split(",") if x.strip()]


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


def classify_context(df: pd.DataFrame, atr_period: int = 14, lookback: int = 20) -> pd.DataFrame:
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


def detect_strict_bullish_fvg(
    df: pd.DataFrame,
    *,
    min_gap_bps: float,
    disp_quantile: float,
    disp_lookback: int,
) -> pd.DataFrame:
    high = df["high"].values
    low = df["low"].values
    open_ = df["open"].values
    close = df["close"].values
    idx = df.index
    body = np.abs(close - open_)
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
        gap = float(low[i] - high[i - 2])
        gap_bps = 10000.0 * gap / px
        ok = gap > 0 and gap_bps >= min_gap_bps
        mid_body_ok = np.isfinite(disp_thr[i - 1]) and (body[i - 1] >= disp_thr[i - 1])
        mid_close_ok = close[i - 1] > high[i - 2]
        if ok and mid_body_ok and mid_close_ok:
            rows.append(
                {
                    "ts": idx[i],
                    "gap_low": float(high[i - 2]),
                    "gap_high": float(low[i]),
                    "gap_bps": float(gap_bps),
                }
            )
    return pd.DataFrame(rows)


def fee_r(entry: float, risk: float, fee_bps: float) -> float:
    return (entry * (fee_bps / 10000.0)) / risk if risk > 0 else 0.0


def htf_close_timestamp(signal_bar_ts: pd.Timestamp, tf: str) -> pd.Timestamp:
    """Left-labeled HTF bar `signal_bar_ts` spans [ts, ts + Δ); close exists at first instant of the next bar."""
    t = pd.Timestamp(signal_bar_ts)
    if t.tzinfo is None:
        t = t.tz_localize("UTC")
    else:
        t = t.tz_convert("UTC")
    return t + pd.to_timedelta(tf)


def replay_long_5m(
    *,
    df5: pd.DataFrame,
    replay_from_ts: pd.Timestamp,
    entry: float,
    stop: float,
    tp: float,
    max_bars_5m: int,
    fee_bps: float,
) -> dict | None:
    risk = entry - stop
    if risk <= 0:
        return None
    fee = fee_r(entry, risk, fee_bps)
    tail = df5.loc[df5.index >= replay_from_ts]
    if len(tail) == 0:
        return None
    tail = tail.iloc[:max_bars_5m]
    if len(tail) == 0:
        return None

    for i, (ts, row) in enumerate(tail.iterrows(), start=1):
        h = float(row["high"])
        l = float(row["low"])
        hit_sl = l <= stop
        hit_tp = h >= tp
        if hit_sl and hit_tp:
            return {"exit_ts": ts, "reason": "SL", "r": -1.0 - fee, "bars_5m": i}
        if hit_sl:
            return {"exit_ts": ts, "reason": "SL", "r": -1.0 - fee, "bars_5m": i}
        if hit_tp:
            rr = (tp - entry) / risk
            return {"exit_ts": ts, "reason": "TP", "r": float(rr - fee), "bars_5m": i}

    last_ts = tail.index[-1]
    last_close = float(tail["close"].iloc[-1])
    r = (last_close - entry) / risk - fee
    return {"exit_ts": last_ts, "reason": "TIME", "r": float(r), "bars_5m": len(tail)}


def simulate_trades_for_tp_r(
    *,
    df5: pd.DataFrame,
    ctx: pd.DataFrame,
    events: pd.DataFrame,
    symbol: str,
    tp_r: float,
    tf: str,
    atr_period: int,
    lookback: int,
    max_hold_bars_5m: int,
    fee_bps: float,
    allow_overlap: bool,
) -> pd.DataFrame:
    rows: list[dict] = []
    blocked_until = pd.Timestamp.min.tz_localize("UTC")
    idx_map = {ts: i for i, ts in enumerate(ctx.index)}
    for _, e in events.iterrows():
        ts = pd.Timestamp(e["ts"]).tz_convert("UTC")
        if not allow_overlap and ts <= blocked_until:
            continue
        entry_idx = int(idx_map.get(ts, -1))
        if entry_idx < 0:
            continue
        entry = float(e["close"])
        stop = float(e["gap_low"])
        risk = entry - stop
        if risk <= 0:
            continue
        tp = entry + tp_r * risk
        replay_from_ts = htf_close_timestamp(ts, tf)
        rr = replay_long_5m(
            df5=df5,
            replay_from_ts=replay_from_ts,
            entry=entry,
            stop=stop,
            tp=tp,
            max_bars_5m=max_hold_bars_5m,
            fee_bps=fee_bps,
        )
        if rr is None:
            continue
        exit_ts = pd.Timestamp(rr["exit_ts"]).tz_convert("UTC")
        blocked_until = exit_ts if not allow_overlap else blocked_until
        rows.append(
            {
                "symbol": symbol,
                "tp_r": float(tp_r),
                "entry_ts_utc": ts.isoformat(),
                "replay_from_ts_utc": replay_from_ts.isoformat(),
                "exit_ts_utc": exit_ts.isoformat(),
                "entry_idx_4h": entry_idx,
                "side": 1,
                "entry_price": entry,
                "stop_init": stop,
                "tp_price": tp,
                "risk": risk,
                "mfe1": float("nan"),
                "lock1": float("nan"),
                "mfe2": float("nan"),
                "lock2": float("nan"),
                "mfe3": float("nan"),
                "lock3": float("nan"),
                "rsi_l": float("nan"),
                "rsi_h": float("nan"),
                "rsi_window": int(atr_period),
                "sl_n": int(lookback),
                "entry_tp_r": float(tp_r),
                "fee_bps": float(fee_bps),
                "baseline_r": float(rr["r"]),
                "managed_r": float(rr["r"]),
                "managed_reason": rr["reason"],
                "hold_5m_bars": int(rr["bars_5m"]),
                "gap_bps": float(e["gap_bps"]),
                "r": rr["r"],
                "structure_regime": "IMBALANCE",
                "regime_bias": "bullish",
            }
        )
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows).sort_values("entry_ts_utc")


def write_one_run(
    run_dir: Path,
    trades: pd.DataFrame,
    *,
    symbol: str,
    df5: pd.DataFrame,
    tp_r: float,
    args: argparse.Namespace,
) -> pd.DataFrame:
    artifacts = run_dir / "artifacts"
    trades_dir = run_dir / "trades"
    artifacts.mkdir(parents=True, exist_ok=True)
    trades_dir.mkdir(parents=True, exist_ok=True)

    trades_csv = artifacts / "trades.csv"
    trades.to_csv(trades_csv, index=False)

    ui_cols = [
        "symbol",
        "tp_r",
        "entry_ts_utc",
        "replay_from_ts_utc",
        "exit_ts_utc",
        "entry_idx_4h",
        "side",
        "entry_price",
        "stop_init",
        "risk",
        "tp_price",
        "mfe1",
        "lock1",
        "mfe2",
        "lock2",
        "mfe3",
        "lock3",
        "rsi_l",
        "rsi_h",
        "rsi_window",
        "sl_n",
        "entry_tp_r",
        "fee_bps",
        "baseline_r",
        "managed_r",
        "managed_reason",
        "hold_5m_bars",
    ]
    ui_trades = trades[ui_cols].copy()
    tp_tag = _tp_tag(float(tp_r))
    ui_tp_csv = trades_dir / f"trade_details_v1fix_{tp_tag}.csv"
    ui_all_csv = trades_dir / "trade_details_v1fix_all_tp.csv"
    ui_trades.to_csv(ui_tp_csv, index=False)
    ui_trades.to_csv(ui_all_csv, index=False)
    audit = ui_trades.copy()
    audit["delta_r"] = audit["managed_r"] - audit["baseline_r"]
    audit["audit_scope"] = "all_rows"
    audit_csv = trades_dir / "replay_audit_v1fix.csv"
    audit.to_csv(audit_csv, index=False)

    summary = pd.DataFrame(
        [
            {
                "symbol": symbol,
                "n_trades": int(len(trades)),
                "total_r": float(trades["r"].sum()),
                "avg_r": float(trades["r"].mean()),
                "median_r": float(trades["r"].median()),
                "win_rate": float((trades["managed_r"] > 0).mean()),
                "tp_rate": float((trades["managed_reason"] == "TP").mean()),
                "sl_rate": float((trades["managed_reason"] == "SL").mean()),
                "time_rate": float((trades["managed_reason"] == "TIME").mean()),
                "max_drawdown_r": float((trades["managed_r"].cumsum().cummax() - trades["managed_r"].cumsum()).max()),
            }
        ]
    )
    summary_csv = artifacts / "summary.csv"
    summary.to_csv(summary_csv, index=False)

    t = trades.copy()
    t["month"] = pd.to_datetime(t["exit_ts_utc"], utc=True).dt.to_period("M").astype(str)
    monthly = (
        t.groupby("month", as_index=False)
        .agg(
            n_trades=("managed_r", "size"),
            total_r=("managed_r", "sum"),
            avg_r=("managed_r", "mean"),
            win_rate=("managed_r", lambda s: float((s > 0).mean())),
        )
        .sort_values("month")
    )
    monthly_csv = artifacts / "monthly.csv"
    monthly.to_csv(monthly_csv, index=False)

    lines = [
        f"# FVG IMBALANCE Strategy Report ({symbol})",
        "",
        "## Strategy",
        "",
        "- Long only on strict bullish FVG when context is bullish IMBALANCE.",
        "- Stop anchored at FVG lower boundary, TP fixed at `tp_r * risk`.",
        "- 5m replay after HTF close (`replay_from_ts = entry_ts + tf`), conservative same-bar resolution (SL before TP).",
        "",
        "## Config",
        "",
        f"- Window: `{df5.index.min().isoformat()} -> {df5.index.max().isoformat()}`",
        f"- TF: `{args.tf}` | ATR period: `{args.atr_period}` | lookback: `{args.lookback}`",
        f"- Strict FVG: `min_gap_bps={args.min_gap_bps}`, `disp_q={args.disp_quantile}`, `disp_lb={args.disp_lookback}`",
        f"- TP R: `{tp_r}` | max hold (5m bars): `{args.max_hold_bars_5m}` | fee bps: `{args.fee_bps}`",
        f"- Overlap allowed: `{args.allow_overlap}`",
        "",
        "## Summary",
        "",
        summary.round(4).to_string(index=False),
        "",
        "## Monthly",
        "",
        monthly.round(4).to_string(index=False),
        "",
        "## Artifacts",
        "",
        f"- Trades (artifact): `{trades_csv}`",
        f"- Trades (UI tp): `{ui_tp_csv}`",
        f"- Trades (UI all): `{ui_all_csv}`",
        f"- Replay audit (UI): `{audit_csv}`",
        f"- Summary: `{summary_csv}`",
        f"- Monthly: `{monthly_csv}`",
    ]
    (artifacts / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    manifest = sorted(str(p.relative_to(run_dir)) for p in run_dir.rglob("*") if p.is_file())
    (run_dir / "manifest_files.txt").write_text("\n".join(manifest) + "\n", encoding="utf-8")
    return summary


def main() -> None:
    ap = argparse.ArgumentParser(description="Run bullish FVG-in-IMBALANCE strategy on XRP")
    ap.add_argument("--db", default=os.path.abspath(DEFAULT_DB))
    ap.add_argument("--symbol", default="XRPUSDT")
    ap.add_argument("--months", type=int, default=48)
    ap.add_argument("--tf", default="1h")
    ap.add_argument("--atr-period", type=int, default=14)
    ap.add_argument("--lookback", type=int, default=20)
    ap.add_argument("--min-gap-bps", type=float, default=5.0)
    ap.add_argument("--disp-quantile", type=float, default=0.85)
    ap.add_argument("--disp-lookback", type=int, default=120)
    ap.add_argument("--tp-r", type=float, default=2.0)
    ap.add_argument(
        "--tp-sweep",
        default="",
        help="Comma-separated tp_r values (e.g. 1,1.5,2,2.5,3,4). If empty, runs a single --tp-r only.",
    )
    ap.add_argument("--max-hold-bars-5m", type=int, default=576, help="Default 48h on 5m")
    ap.add_argument("--fee-bps", type=float, default=3.0)
    ap.add_argument("--allow-overlap", action=argparse.BooleanOptionalAction, default=False)
    ap.add_argument("--run-label", default="xrp_fvg_imbalance")
    args = ap.parse_args()

    symbol = args.symbol.strip().upper()
    db_path = os.path.abspath(args.db)

    tp_levels = parse_float_grid(args.tp_sweep) if args.tp_sweep.strip() else [float(args.tp_r)]
    batch_now = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    df5 = load_merged_5m(db_path, symbol)
    if len(df5) == 0:
        raise SystemExit(f"No data for {symbol}")
    end = df5.index.max()
    start = end - pd.DateOffset(months=args.months)
    df5 = df5.loc[df5.index >= start].copy()
    df1h = (
        df5.resample(args.tf)
        .agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
        .dropna()
    )
    ctx = classify_context(df1h, atr_period=args.atr_period, lookback=args.lookback)
    fvg = detect_strict_bullish_fvg(
        ctx,
        min_gap_bps=args.min_gap_bps,
        disp_quantile=args.disp_quantile,
        disp_lookback=args.disp_lookback,
    )
    if len(fvg) == 0:
        raise SystemExit("No strict bullish FVG events found.")

    events = fvg.merge(
        ctx[["structure_regime", "regime_bias", "close"]].reset_index().rename(columns={"Date": "ts"}),
        on="ts",
        how="left",
    )
    events = events[(events["structure_regime"] == "IMBALANCE") & (events["regime_bias"] == "bullish")].copy()
    events = events.sort_values("ts").reset_index(drop=True)
    if len(events) == 0:
        raise SystemExit("No bullish FVG entries in bullish IMBALANCE.")

    sweep_rows: list[dict] = []
    for tp_r in tp_levels:
        trades = simulate_trades_for_tp_r(
            df5=df5,
            ctx=ctx,
            events=events,
            symbol=symbol,
            tp_r=tp_r,
            tf=args.tf,
            atr_period=args.atr_period,
            lookback=args.lookback,
            max_hold_bars_5m=args.max_hold_bars_5m,
            fee_bps=args.fee_bps,
            allow_overlap=args.allow_overlap,
        )
        if len(trades) == 0:
            raise SystemExit(f"No trades replayed for tp_r={tp_r}.")

        if len(tp_levels) == 1:
            run_id = f"run_fvg_imbalance_{args.run_label}_{batch_now}" if args.run_label else f"run_fvg_imbalance_{batch_now}"
        else:
            run_id = f"run_fvg_imbalance_{args.run_label}_{_tp_tag(tp_r)}_{batch_now}"
        run_dir = PROJECT_ROOT / "runs" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)

        cfg = {
            "run_id": run_id,
            "script": "scripts/run_fvg_imbalance_strategy.py",
            "variant": "bullish_fvg_stop_anchor_in_imbalance",
            "db": db_path,
            "symbol": symbol,
            "months": args.months,
            "tf": args.tf,
            "atr_period": args.atr_period,
            "lookback": args.lookback,
            "min_gap_bps": args.min_gap_bps,
            "disp_quantile": args.disp_quantile,
            "disp_lookback": args.disp_lookback,
            "tp_r": tp_r,
            "tp_sweep": tp_levels if len(tp_levels) > 1 else None,
            "max_hold_bars_5m": args.max_hold_bars_5m,
            "fee_bps": args.fee_bps,
            "allow_overlap": args.allow_overlap,
            "replay_policy": "first_5m_at_or_after_htf_close",
        }
        (run_dir / "run_config.json").write_text(json.dumps(cfg, indent=2), encoding="utf-8")

        summary = write_one_run(run_dir, trades, symbol=symbol, df5=df5, tp_r=tp_r, args=args)
        print(f"Run package ready: {run_dir}")
        print(summary.to_string(index=False))

        row = summary.iloc[0].to_dict()
        row["tp_r"] = tp_r
        row["run_id"] = run_id
        sweep_rows.append(row)

    if len(tp_levels) > 1:
        cache_dir = PROJECT_ROOT / "cache"
        out_dir = PROJECT_ROOT / "study" / "out"
        cache_dir.mkdir(parents=True, exist_ok=True)
        out_dir.mkdir(parents=True, exist_ok=True)
        agg = pd.DataFrame(sweep_rows)
        sweep_path = cache_dir / "fvg_imbalance_tp_sweep_summary.csv"
        agg.to_csv(sweep_path, index=False)

        best_tot = agg.loc[agg["total_r"].idxmax()]
        best_avg = agg.loc[agg["avg_r"].idxmax()]
        md_lines = [
            f"# FVG IMBALANCE TP sweep ({symbol}, {args.tf}, {args.months}m, causal replay)",
            "",
            "Win rate = fraction of trades with `managed_r > 0`. TP rate = exits tagged TP (full tp_r hit).",
            "",
            "| tp_r | n_trades | total_r | avg_r | median_r | win_rate | tp_rate | sl_rate | time_rate | max_drawdown_r | run_id |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        for _, r in agg.iterrows():
            md_lines.append(
                f"| {r['tp_r']} | {int(r['n_trades'])} | {r['total_r']:.6f} | {r['avg_r']:.6f} | {r['median_r']:.6f} | "
                f"{r['win_rate']:.6f} | {r['tp_rate']:.6f} | {r['sl_rate']:.6f} | {r['time_rate']:.6f} | "
                f"{r['max_drawdown_r']:.6f} | `{r['run_id']}` |"
            )
        md_lines.extend(
            [
                "",
                f"- Best by total_r: tp_r={best_tot['tp_r']} total_r={best_tot['total_r']:.4f} avg_r={best_tot['avg_r']:.4f}",
                f"- Best by avg_r: tp_r={best_avg['tp_r']} total_r={best_avg['total_r']:.4f} avg_r={best_avg['avg_r']:.4f}",
                "",
                f"- Aggregate CSV: `{sweep_path}`",
            ]
        )
        md_path = out_dir / "FVG_IMBALANCE_TP_SWEEP.md"
        md_path.write_text("\n".join(md_lines) + "\n", encoding="utf-8")
        print(f"\nTP sweep summary: {sweep_path}")
        print(f"TP sweep report: {md_path}")


if __name__ == "__main__":
    main()
