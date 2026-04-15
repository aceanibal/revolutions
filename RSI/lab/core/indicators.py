"""
Technical indicators — single source of truth, no duplicates.

All functions take raw numpy arrays or pandas Series and return the same type.
No side effects, no I/O.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def wilder_atr(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    period: int,
) -> np.ndarray:
    """
    Wilder ATR. First valid value at index period-1 (0-based). Leading indices are NaN.

    Smoothing: ATR[i] = (ATR[i-1] * (period-1) + TR[i]) / period
    True range = max(H-L, |H-prev_C|, |L-prev_C|)
    """
    n = len(close)
    prev_c = np.empty(n)
    prev_c[0] = close[0]
    prev_c[1:] = close[:-1]
    tr = np.maximum(high - low, np.maximum(np.abs(high - prev_c), np.abs(low - prev_c)))
    atr = np.full(n, np.nan)
    if n < period:
        return atr
    atr[period - 1] = float(np.mean(tr[:period]))
    for i in range(period, n):
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period
    return atr


def wilder_rsi_arr(close: np.ndarray, window: int = 14) -> np.ndarray:
    """
    Wilder RSI on a numpy array. Leading window+1 values are NaN.

    Matches ta.momentum.RSIIndicator behavior.
    """
    n = len(close)
    rsi = np.full(n, np.nan)
    if n < window + 1:
        return rsi
    deltas = np.diff(close.astype(float))
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = float(np.mean(gains[:window]))
    avg_loss = float(np.mean(losses[:window]))
    if avg_loss == 0:
        rsi[window] = 100.0
    else:
        rs = avg_gain / avg_loss
        rsi[window] = 100.0 - (100.0 / (1.0 + rs))
    for i in range(window, n - 1):
        avg_gain = (avg_gain * (window - 1) + gains[i]) / window
        avg_loss = (avg_loss * (window - 1) + losses[i]) / window
        if avg_loss == 0:
            rsi[i + 1] = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi[i + 1] = 100.0 - (100.0 / (1.0 + rs))
    return rsi


def efficiency_ratio(close: pd.Series, n: int) -> pd.Series:
    """
    Kaufman's Efficiency Ratio over n bars.

    Range [0, 1]: 1 = perfectly trending, 0 = random/choppy.
    direction / sum(|bar changes|) over n bars.
    """
    direction = (close - close.shift(n)).abs()
    volatility = close.diff().abs().rolling(n).sum()
    return (direction / volatility.replace(0, np.nan)).clip(0.0, 1.0)
