#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os

import matplotlib.pyplot as plt
import mplfinance as mpf
import pandas as pd
from ta.momentum import RSIIndicator


def parse_args() -> argparse.Namespace:
    default_input = os.path.join(os.path.dirname(__file__), "cache", "xrp_paxg_ratio_5m.csv")
    default_output = os.path.join(os.path.dirname(__file__), "cache", "xrp_paxg_ratio_5m_chart.png")

    ap = argparse.ArgumentParser(description="Plot XRP/PAXG ratio candles with EMA and RSI.")
    ap.add_argument("--input", default=default_input, help="Input CSV path")
    ap.add_argument("--output", default=default_output, help="Output PNG path")
    ap.add_argument("--last-bars", type=int, default=2500, help="Plot only the last N bars")
    ap.add_argument("--ema-fast", type=int, default=20, help="Fast EMA period")
    ap.add_argument("--ema-slow", type=int, default=50, help="Slow EMA period")
    ap.add_argument("--rsi-period", type=int, default=14, help="RSI period")
    ap.add_argument("--style", default="yahoo", help="mplfinance style name")
    return ap.parse_args()


def load_ohlcv(csv_path: str) -> pd.DataFrame:
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    df = pd.read_csv(csv_path)
    if "iso" in df.columns:
        ts = pd.to_datetime(df["iso"], utc=True, errors="coerce")
    elif "bucketStartMs" in df.columns:
        ts = pd.to_datetime(df["bucketStartMs"], unit="ms", utc=True, errors="coerce")
    else:
        raise ValueError("CSV must contain either 'iso' or 'bucketStartMs' column.")

    df = df.assign(Date=ts).dropna(subset=["Date"]).set_index("Date").sort_index()
    required = ["open", "high", "low", "close", "volume"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    ohlcv = df[required].rename(
        columns={
            "open": "Open",
            "high": "High",
            "low": "Low",
            "close": "Close",
            "volume": "Volume",
        }
    )
    return ohlcv


def main() -> None:
    args = parse_args()
    csv_path = os.path.abspath(args.input)
    out_path = os.path.abspath(args.output)

    df = load_ohlcv(csv_path)
    if args.last_bars and args.last_bars > 0:
        df = df.tail(args.last_bars)
    if len(df) < max(args.ema_fast, args.ema_slow, args.rsi_period) + 10:
        raise SystemExit("Not enough rows after slicing for requested indicators.")

    df["EMA_FAST"] = df["Close"].ewm(span=args.ema_fast, adjust=False).mean()
    df["EMA_SLOW"] = df["Close"].ewm(span=args.ema_slow, adjust=False).mean()
    df["RSI"] = RSIIndicator(close=df["Close"], window=args.rsi_period).rsi()

    addplots = [
        mpf.make_addplot(df["EMA_FAST"], color="#1d4ed8", width=1.0),
        mpf.make_addplot(df["EMA_SLOW"], color="#9333ea", width=1.0),
        mpf.make_addplot(df["RSI"], panel=2, color="#dc2626", width=1.0, ylabel=f"RSI({args.rsi_period})"),
        mpf.make_addplot([70] * len(df), panel=2, color="#9ca3af", width=0.8),
        mpf.make_addplot([30] * len(df), panel=2, color="#9ca3af", width=0.8),
    ]

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    fig, _axes = mpf.plot(
        df,
        type="candle",
        style=args.style,
        volume=True,
        addplot=addplots,
        panel_ratios=(8, 2, 3),
        title=f"XRP/PAXG Ratio 5m  |  EMA({args.ema_fast},{args.ema_slow}) + RSI({args.rsi_period})",
        ylabel="Ratio",
        ylabel_lower="Volume",
        figsize=(16, 10),
        datetime_format="%Y-%m-%d",
        returnfig=True,
    )
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)

    print(f"Saved chart: {out_path}")
    print(f"Rows plotted: {len(df)}")
    print(f"Input: {csv_path}")


if __name__ == "__main__":
    main()
