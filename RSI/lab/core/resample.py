"""
OHLCV resampling utilities.

All higher-timeframe data is derived from 5m candles — never loaded independently.
This ensures a single source of truth and no bar alignment mismatches.
"""
from __future__ import annotations

import pandas as pd
from ta.momentum import RSIIndicator


def resample_ohlcv(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    """
    Resample a 5m OHLCV DataFrame to any higher timeframe.

    rule examples: '4h', '1h', '1D', '1W'
    Left-labeled: index timestamp t covers the interval [t, t + rule).
    """
    return (
        df.resample(rule)
        .agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
        .dropna(subset=["open", "high", "low", "close"])
    )


def build_4h_ohlcv(df_5m: pd.DataFrame) -> pd.DataFrame:
    """Resample 5m → 4h OHLCV."""
    return resample_ohlcv(df_5m, "4h")


def build_1h_ohlcv(df_5m: pd.DataFrame) -> pd.DataFrame:
    """Resample 5m → 1h OHLCV."""
    return resample_ohlcv(df_5m, "1h")


def build_4h_rsi(df_5m: pd.DataFrame, window: int = 20) -> pd.DataFrame:
    """
    Build 4h OHLCV with an RSI column.

    Uses ta.momentum.RSIIndicator (Wilder smoothing).
    Drops leading NaN rows (first `window` bars have no valid RSI).
    Returns a copy with lowercase column names: open, high, low, close, volume, rsi.
    """
    df = build_4h_ohlcv(df_5m).copy()
    df["rsi"] = RSIIndicator(close=df["close"], window=window).rsi()
    return df.dropna(subset=["rsi"]).copy()
