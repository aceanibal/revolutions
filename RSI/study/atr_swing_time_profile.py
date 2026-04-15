#!/usr/bin/env python3
"""
ATR regime vs time-of-day (UTC) on long 5m history.

- Resample 5m → 1h / 4h (default), Wilder ATR.
- **Expansion:** ATR rose vs prior bar (dATR > 0) and pct-change is in top `--expand-quantile` of all positive moves.
- **Contraction:** ATR fell (dATR < 0) and pct-change is in bottom `--contract-quantile` of all negative moves.

For each flagged 4h/1h **bar close**, record UTC hour + weekday of that close, and optional **forward range %**
over the next N 5m bars (max(high)-min(low))/ref_close — exploratory “how much price moved after volatility shifted”,
not a trading system or guarantee of profitability.

Usage:
  python study/atr_swing_time_profile.py --db ... --symbol XRPUSDT --months 48
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

_SCRIPT_DIR = Path(__file__).resolve().parent
_RSI_ROOT = _SCRIPT_DIR.parent
_SIM_DIR = _RSI_ROOT / "simulation"
if str(_SIM_DIR) not in sys.path:
    sys.path.insert(0, str(_SIM_DIR))
if str(_RSI_ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(_RSI_ROOT / "scripts"))

from massive_chunk_backtest_5m_v1fix import load_merged_5m  # noqa: E402
from multi_asset_4h_rsi_sim import DB_PATH as DEFAULT_DB  # noqa: E402


def wilder_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int) -> np.ndarray:
    n = len(close)
    prev_c = np.empty(n)
    prev_c[0] = close[0]
    prev_c[1:] = close[:-1]
    tr = np.maximum(
        high - low,
        np.maximum(np.abs(high - prev_c), np.abs(low - prev_c)),
    )
    atr = np.full(n, np.nan)
    if n < period:
        return atr
    atr[period - 1] = float(np.mean(tr[:period]))
    for i in range(period, n):
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period
    return atr


def resample_ohlc(df_5m: pd.DataFrame, rule: str) -> pd.DataFrame:
    return (
        df_5m.resample(rule)
        .agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
        .dropna(subset=["open", "high", "low", "close"])
    )


def bar_end_times(index: pd.DatetimeIndex, rule: str) -> pd.DatetimeIndex:
    """Left-labeled bars -> wall-clock time when the bar finishes."""
    off = pd.tseries.frequencies.to_offset(rule)
    return index + off


def forward_range_pct(
    df5: pd.DataFrame,
    event_end_utc: pd.Timestamp,
    ref_close: float,
    n_bars: int,
) -> float:
    """Max-min range over next n 5m bars after event_end, as % of ref_close."""
    if ref_close <= 0 or not np.isfinite(ref_close):
        return float("nan")
    sub = df5.loc[df5.index >= event_end_utc]
    if len(sub) == 0:
        return float("nan")
    sub = sub.iloc[:n_bars]
    if len(sub) == 0:
        return float("nan")
    w = (float(sub["high"].max()) - float(sub["low"].min())) / ref_close * 100.0
    return w


def analyze_tf(
    df5: pd.DataFrame,
    *,
    rule: str,
    atr_period: int,
    expand_q: float,
    contract_q: float,
    fwd_bars: list[int],
) -> pd.DataFrame:
    """Returns one row per flagged ATR regime event."""
    dfx = resample_ohlc(df5, rule)
    if len(dfx) < atr_period + 5:
        return pd.DataFrame()

    h = dfx["high"].values.astype(float)
    l = dfx["low"].values.astype(float)
    c = dfx["close"].values.astype(float)
    atr = wilder_atr(h, l, c, atr_period)

    atr_s = pd.Series(atr, index=dfx.index)
    d_atr = atr_s.diff()
    roc = atr_s.pct_change(1)

    pos = roc[roc > 0].dropna()
    neg = roc[roc < 0].dropna()
    if len(pos) < 50 or len(neg) < 50:
        thr_exp = pos.quantile(expand_q) if len(pos) else np.nan
        thr_con = neg.quantile(1.0 - contract_q) if len(neg) else np.nan
    else:
        thr_exp = pos.quantile(expand_q)
        thr_con = neg.quantile(1.0 - contract_q)

    ends = bar_end_times(dfx.index, rule)
    if hasattr(ends, "as_unit") and hasattr(df5.index, "unit"):
        ends = ends.as_unit(df5.index.unit)

    rows: list[dict] = []
    for i in range(1, len(dfx)):
        a = atr[i]
        a_prev = atr[i - 1]
        if not (np.isfinite(a) and np.isfinite(a_prev) and a_prev > 0):
            continue
        r = roc.iloc[i]
        if not np.isfinite(r):
            continue
        ev = "none"
        if r > 0 and r >= thr_exp:
            ev = "expand"
        elif r < 0 and r <= thr_con:
            ev = "contract"

        if ev == "none":
            continue

        t_end = ends[i]
        ref = float(c[i])
        event_end_5m = t_end
        if hasattr(event_end_5m, "asm8"):
            pass
        rec: dict = {
            "tf_rule": rule,
            "bar_start_utc": dfx.index[i].isoformat(),
            "bar_end_utc": t_end.isoformat(),
            "hour_utc": int(t_end.hour),
            "weekday": int(t_end.dayofweek),
            "weekday_name": t_end.day_name(),
            "event": ev,
            "atr": float(a),
            "atr_roc_1": float(r),
            "d_atr": float(d_atr.iloc[i]) if np.isfinite(d_atr.iloc[i]) else float("nan"),
            "close": ref,
        }
        for nb in fwd_bars:
            rec[f"fwd_range_pct_{nb}m"] = forward_range_pct(df5, event_end_5m, ref, nb)
        rows.append(rec)

    return pd.DataFrame(rows)


def main() -> None:
    ap = argparse.ArgumentParser(description="ATR expansion/contraction vs UTC hour (48m 5m data)")
    ap.add_argument("--db", default=os.path.abspath(os.path.join(DEFAULT_DB)))
    ap.add_argument("--symbol", default="XRPUSDT")
    ap.add_argument("--months", type=int, default=48, help="Rolling window ending at last 5m bar")
    ap.add_argument("--atr-period", type=int, default=14)
    ap.add_argument(
        "--timeframes",
        default="4h,1h",
        help="Comma resample rules (pandas), e.g. 4h,1h",
    )
    ap.add_argument(
        "--expand-quantile",
        type=float,
        default=0.90,
        help="Flag expansion when ATR pct-change is above this quantile among positive moves",
    )
    ap.add_argument(
        "--contract-quantile",
        type=float,
        default=0.90,
        help="Flag contraction when ATR pct-change is below (1-q) quantile among negative moves",
    )
    ap.add_argument(
        "--fwd-bars",
        default="48,192,288",
        help="Comma-separated 5m bar counts for forward range %% (48~4h, 288~24h)",
    )
    ap.add_argument("--out-dir", default="", help="Write CSVs here (default: RSI/study/out)")
    args = ap.parse_args()

    fwd_bars = [int(x.strip()) for x in args.fwd_bars.split(",") if x.strip()]
    rules = [x.strip() for x in args.timeframes.split(",") if x.strip()]

    db_path = os.path.abspath(args.db)
    df = load_merged_5m(db_path, args.symbol.strip().upper())
    if len(df) == 0:
        raise SystemExit(f"No data for {args.symbol}")

    end = df.index.max()
    start = end - pd.DateOffset(months=args.months)
    df = df.loc[df.index >= start].copy()
    if len(df) < 1000:
        raise SystemExit("Window too short after --months clip")

    out_dir = Path(args.out_dir) if args.out_dir else _SCRIPT_DIR / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    print("=== ATR swing / time-of-day profile ===")
    print(
        json.dumps(
            {
                "db": db_path,
                "symbol": args.symbol,
                "window_start": str(df.index.min()),
                "window_end": str(df.index.max()),
                "n_5m_bars": len(df),
                "months": args.months,
                "atr_period": args.atr_period,
                "expand_q": args.expand_quantile,
                "contract_q": args.contract_quantile,
                "fwd_bars_5m": fwd_bars,
            },
            indent=2,
        )
    )
    print()

    all_events: list[pd.DataFrame] = []
    for rule in rules:
        ev = analyze_tf(
            df,
            rule=rule,
            atr_period=args.atr_period,
            expand_q=args.expand_quantile,
            contract_q=args.contract_quantile,
            fwd_bars=fwd_bars,
        )
        if len(ev):
            all_events.append(ev)
            tag = rule.replace("/", "")
            ev.to_csv(out_dir / f"atr_events_{args.symbol}_{tag}.csv", index=False)
            print(f"Wrote {out_dir / f'atr_events_{args.symbol}_{tag}.csv'} ({len(ev)} events)")

        # Hour histogram for this rule
        if len(ev) == 0:
            print(f"No events for tf={rule} (try looser quantiles)")
            continue

        print(f"\n--- {rule} ATR: event counts by UTC hour (bar close) ---")
        ct = pd.crosstab(ev["hour_utc"], ev["event"])
        if "contract" not in ct.columns:
            ct["contract"] = 0
        if "expand" not in ct.columns:
            ct["expand"] = 0
        ct = ct.reindex(range(24), fill_value=0)
        print(ct.to_string())
        primary = f"fwd_range_pct_{fwd_bars[0]}m"
        print(f"\nMean {primary} (%) by hour × event (same TF):")
        pivot = ev.pivot_table(
            index="hour_utc",
            columns="event",
            values=primary,
            aggfunc="mean",
        )
        print(pivot.reindex(range(24)).to_string())

        # Weekday
        print(f"\n--- {rule}: events by weekday ---")
        wd = ev.groupby(["weekday_name", "event"]).size().unstack(fill_value=0)
        print(wd.to_string())

    if all_events:
        full = pd.concat(all_events, ignore_index=True)
        full.to_csv(out_dir / f"atr_events_{args.symbol}_ALL.csv", index=False)

    print(
        "\nNote: 'expand'/'contract' are **ATR dynamics** (volatility up/down), not price direction. "
        "Forward range is an exploratory swing-size proxy, not expected profit."
    )
    print(f"Artifacts under: {out_dir}")


if __name__ == "__main__":
    main()
