#!/usr/bin/env python3
"""
Random-entry simulator: SL and TP distances are multiples of Wilder ATR.

- **5m mode:** ATR on 5m bars at the entry bar (local noise).
- **4h mode (default):** ATR on 4h OHLC (resampled from 5m); each 5m entry uses the ATR from the
  **last fully closed** 4h candle (no lookahead). Fills are still simulated on **5m** high/low.

Typical TP/SL are expressed as multiples of that ATR (e.g. 1× ATR stop, 2× ATR target).

Usage:
  python study/atr_random_entry_study.py --db /path/to/backtest.sqlite --symbol XRPUSDT
  python study/atr_random_entry_study.py --atr-timeframe 5m   # compare to 5m ATR

Defaults use multi_asset DB path when present.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

# Load merged 5m the same way as massive_chunk_v1fix
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
    """Wilder ATR; first valid value at index period-1 (0-based). Leading indices are NaN."""
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


def build_4h_ohlc(df_5m: pd.DataFrame) -> pd.DataFrame:
    """Left-labeled 4h bars: index t covers [t, t+4h). Matches massive_chunk resampling."""
    return (
        df_5m.resample("4h")
        .agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
        .dropna(subset=["open", "high", "low", "close"])
    )


def atr_series_on_5m_index(
    df_5m: pd.DataFrame,
    *,
    tf: str,
    atr_period: int,
) -> tuple[np.ndarray, str]:
    """
    Return array aligned to df_5m rows: ATR value available at each 5m timestamp (no lookahead).
    For 4h, ATR is known only after each 4h bar closes (merge_asof backward on valid_from).
    """
    if tf == "5m":
        h = df_5m["high"].values.astype(float)
        l = df_5m["low"].values.astype(float)
        c = df_5m["close"].values.astype(float)
        return wilder_atr(h, l, c, atr_period), "5m"

    if tf != "4h":
        raise ValueError(f"Unsupported atr-timeframe: {tf}")

    df4 = build_4h_ohlc(df_5m)
    if len(df4) < atr_period + 1:
        raise SystemExit(f"Not enough 4h bars for atr_period={atr_period}: len={len(df4)}")

    h4 = df4["high"].values.astype(float)
    l4 = df4["low"].values.astype(float)
    c4 = df4["close"].values.astype(float)
    atr4 = wilder_atr(h4, l4, c4, atr_period)

    # valid_from[k] = when 4h bar k has closed and ATR[k] is observable
    idx4 = df4.index
    valid_from = idx4 + pd.Timedelta(hours=4)
    # merge_asof requires identical datetime dtype (e.g. ms vs us)
    unit = getattr(df_5m.index, "unit", None)
    if unit is not None and hasattr(valid_from, "as_unit"):
        valid_from = valid_from.as_unit(unit)
    right = pd.DataFrame(
        {
            "valid_from": valid_from,
            "atr": atr4,
        }
    )
    right = right[np.isfinite(right["atr"]) & (right["atr"] > 0)].sort_values("valid_from")

    left = pd.DataFrame({"ts": df_5m.index, "_ord": np.arange(len(df_5m), dtype=np.int64)})
    m = pd.merge_asof(
        left.sort_values("ts"),
        right,
        left_on="ts",
        right_on="valid_from",
        direction="backward",
    )
    m = m.sort_values("_ord")
    out = m["atr"].values.astype(float)
    return out, "4h"


def simulate_one(
    *,
    o: np.ndarray,
    h: np.ndarray,
    l: np.ndarray,
    c: np.ndarray,
    entry_i: int,
    side: int,
    atr: float,
    sl_mult: float,
    tp_mult: float,
    max_bars: int,
) -> dict:
    """
    Enter at close[entry_i], active from entry_i+1.
    Long: SL = entry - sl_mult*atr, TP = entry + tp_mult*atr
    Short: SL = entry + sl_mult*atr, TP = entry - tp_mult*atr
    Same-bar conflict: if both SL and TP touched on one 5m bar, count SL (conservative).
    """
    entry = float(c[entry_i])
    risk_px = sl_mult * atr
    if risk_px <= 0 or not np.isfinite(atr):
        return {"outcome": "bad_atr", "r": 0.0, "bars": 0}

    if side > 0:
        sl_px = entry - risk_px
        tp_px = entry + tp_mult * atr
        if sl_px <= 0:
            return {"outcome": "invalid_sl", "r": 0.0, "bars": 0}
    else:
        sl_px = entry + risk_px
        tp_px = entry - tp_mult * atr
        if tp_px <= 0:
            return {"outcome": "invalid_tp", "r": 0.0, "bars": 0}

    rr = tp_mult / sl_mult  # R multiple if TP hits

    end = min(len(c) - 1, entry_i + max_bars)
    for j in range(entry_i + 1, end + 1):
        lo = float(l[j])
        hi = float(h[j])
        if side > 0:
            hit_sl = lo <= sl_px
            hit_tp = hi >= tp_px
        else:
            hit_sl = hi >= sl_px
            hit_tp = lo <= tp_px

        if hit_sl and hit_tp:
            return {"outcome": "sl", "r": -1.0, "bars": j - entry_i}
        if hit_sl:
            return {"outcome": "sl", "r": -1.0, "bars": j - entry_i}
        if hit_tp:
            return {"outcome": "tp", "r": float(rr), "bars": j - entry_i}

    return {"outcome": "time", "r": (float(c[end]) - entry) / risk_px if side > 0 else (entry - float(c[end])) / risk_px, "bars": end - entry_i}


def main() -> None:
    ap = argparse.ArgumentParser(description="ATR-multiple SL/TP on random entries (XRPUSDT etc.)")
    ap.add_argument("--db", default=os.path.abspath(os.path.join(DEFAULT_DB)), help="SQLite with session_candles")
    ap.add_argument("--symbol", default="XRPUSDT", help="e.g. XRPUSDT")
    ap.add_argument("--start-utc", default="", help="Optional inclusive window start (UTC)")
    ap.add_argument("--end-utc", default="", help="Optional exclusive window end (UTC)")
    ap.add_argument(
        "--atr-timeframe",
        choices=("4h", "5m"),
        default="4h",
        help="Timeframe for Wilder ATR; 5m path still used for fills (default: 4h, no lookahead).",
    )
    ap.add_argument("--atr-period", type=int, default=14)
    ap.add_argument("--sl-mult", type=float, default=1.0, help="Stop distance = sl_mult * ATR(entry)")
    ap.add_argument("--tp-mult", type=float, default=2.0, help="TP distance = tp_mult * ATR(entry)")
    ap.add_argument("--n-random", type=int, default=8000, help="Number of random entry draws")
    ap.add_argument("--max-hold-bars", type=int, default=2016, help="Max 5m bars to hold (~7d)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--grid", action="store_true", help="Run a small grid of sl_mult x tp_mult and print summary table")
    ap.add_argument("--out-csv", default="", help="Optional path to write per-trade CSV")
    args = ap.parse_args()

    db_path = os.path.abspath(args.db)
    df = load_merged_5m(db_path, args.symbol.strip().upper())
    if len(df) == 0:
        raise SystemExit(f"No 5m data for {args.symbol!r} in {db_path}")

    if args.start_utc:
        df = df.loc[df.index >= pd.Timestamp(args.start_utc, tz="UTC")]
    if args.end_utc:
        df = df.loc[df.index < pd.Timestamp(args.end_utc, tz="UTC")]
    if len(df) < args.max_hold_bars + 50:
        raise SystemExit(f"Not enough rows after window filter: {len(df)}")

    o = df["open"].values.astype(float)
    h = df["high"].values.astype(float)
    l = df["low"].values.astype(float)
    c = df["close"].values.astype(float)
    atr_arr, atr_label = atr_series_on_5m_index(df, tf=args.atr_timeframe, atr_period=args.atr_period)

    n = len(c)
    finite = np.isfinite(atr_arr) & (atr_arr > 0)
    if not finite.any():
        raise SystemExit("No valid ATR values for this window/timeframe.")
    lo_i = int(np.argmax(finite))
    if args.atr_timeframe == "5m":
        lo_i = max(lo_i, args.atr_period)
    hi_i = n - args.max_hold_bars - 2
    if hi_i <= lo_i:
        raise SystemExit("Window too short for ATR warmup + max_hold_bars")

    rng = np.random.default_rng(args.seed)

    def run_batch(sl_mult: float, tp_mult: float, n_rand: int) -> pd.DataFrame:
        rows: list[dict] = []
        for _ in range(n_rand):
            entry_i = int(rng.integers(lo_i, hi_i + 1))
            side = 1 if rng.random() < 0.5 else -1
            atr_e = float(atr_arr[entry_i])
            if not np.isfinite(atr_e) or atr_e <= 0:
                continue
            r = simulate_one(
                o=o,
                h=h,
                l=l,
                c=c,
                entry_i=entry_i,
                side=side,
                atr=atr_e,
                sl_mult=sl_mult,
                tp_mult=tp_mult,
                max_bars=args.max_hold_bars,
            )
            entry_px = float(c[entry_i])
            rows.append(
                {
                    "entry_ts": df.index[entry_i].isoformat(),
                    "entry_i": entry_i,
                    "side": side,
                    "atr": atr_e,
                    "atr_tf": atr_label,
                    "atr_pct": atr_e / entry_px * 100.0,
                    "sl_mult": sl_mult,
                    "tp_mult": tp_mult,
                    "outcome": r["outcome"],
                    "r": r["r"],
                    "bars": r["bars"],
                }
            )
        return pd.DataFrame(rows)

    if args.grid:
        grid_sl = [0.75, 1.0, 1.25, 1.5]
        grid_tp = [1.5, 2.0, 2.5, 3.0]
        print(
            f"symbol={args.symbol} rows={n} window=[{df.index[0]} .. {df.index[-1]}) "
            f"atr_tf={args.atr_timeframe} atr_period={args.atr_period}"
        )
        print("grid: mean_R | win% | P(tp) | P(sl) | P(time) | n")
        for sl_m in grid_sl:
            for tp_m in grid_tp:
                sub = run_batch(sl_m, tp_m, min(args.n_random, 4000))
                if len(sub) == 0:
                    continue
                mean_r = sub["r"].mean()
                win = (sub["r"] > 0).mean() * 100
                p_tp = (sub["outcome"] == "tp").mean() * 100
                p_sl = (sub["outcome"] == "sl").mean() * 100
                p_time = (sub["outcome"] == "time").mean() * 100
                print(f"  sl={sl_m} tp={tp_m}: mean_r={mean_r:+.4f} win%={win:.1f} tp%={p_tp:.1f} sl%={p_sl:.1f} time%={p_time:.1f} n={len(sub)}")
        return

    out = run_batch(args.sl_mult, args.tp_mult, args.n_random)
    if len(out) == 0:
        raise SystemExit("No trades simulated")

    if args.out_csv:
        outp = Path(args.out_csv)
        outp.parent.mkdir(parents=True, exist_ok=True)
        out.to_csv(outp, index=False)
        print(f"Wrote {outp} ({len(out)} rows)")

    # Relationship: ATR% vs outcome
    out["atr_pct_q"] = pd.qcut(out["atr_pct"], q=10, labels=False, duplicates="drop")

    print("=== ATR random-entry study ===")
    print(json.dumps({"db": db_path, "symbol": args.symbol, "bars": n, "start": str(df.index[0]), "end": str(df.index[-1])}, indent=2))
    print(
        f"atr_timeframe={args.atr_timeframe} (ATR source) | fills=5m | "
        f"atr_period={args.atr_period} sl_mult={args.sl_mult} tp_mult={args.tp_mult} tp/sl_R={args.tp_mult/args.sl_mult:.4f}"
    )
    print(f"n={len(out)} max_hold_bars={args.max_hold_bars} (same-bar SL+TP -> SL counted)")
    print()
    print("Overall:")
    print(f"  mean R: {out['r'].mean():+.5f}")
    print(f"  median R: {out['r'].median():+.5f}")
    print(f"  win% (r>0): {(out['r'] > 0).mean()*100:.2f}")
    print(f"  outcomes: {out['outcome'].value_counts().to_dict()}")
    print()
    print("Mean R by decile of ATR% at entry (higher decile = higher ATR% = more volatile bar):")
    g = out.groupby("atr_pct_q", observed=True)["r"].agg(["mean", "count"])
    print(g.to_string())
    print()
    corr = out[["atr_pct", "r"]].corr().iloc[0, 1]
    print(f"corr(atr_pct, R): {corr:.4f}")
    print()
    print("Run with --grid for a quick sl_mult x tp_mult sweep, or tune --sl-mult / --tp-mult.")


if __name__ == "__main__":
    main()
