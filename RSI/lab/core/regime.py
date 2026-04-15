"""
Market Regime Classifier
========================
Reusable two-axis regime classification for any OHLCV DataFrame.

Axis 1 — Structure: BALANCED | IMBALANCED
    Measured by Efficiency Ratio (ER = directional move / total path over N bars).
    Low ER → price is chopping/ranging → BALANCED (mean-reverting conditions).
    High ER → price is trending directionally → IMBALANCED.

Axis 2 — Volatility: LOW | NORMAL | HIGH
    Measured by ATR relative to its own rolling mean.
    HIGH: current ATR is well above its average (expansion, news-driven)
    LOW:  current ATR is well below its average (compression)
    NORMAL: everything else

Combined regime string: e.g. "BALANCED_NORMAL", "IMBALANCED_HIGH"

USAGE:
    from lab.core.regime import classify_regimes, BALANCED, IMBALANCED, VOL_HIGH

    df4h_with_regime = classify_regimes(df4h)
    # use regime at bar i for entry decision at bar i+1 (Rule 1 — no look-ahead)
    if df4h_with_regime["structure"].iloc[i] == BALANCED:
        ...

NO LOOK-AHEAD: all values at bar i are computed from bars 0..i only.
The regime at bar i is known at bar i's close — valid to use at bar i+1 open.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from lab.core.indicators import efficiency_ratio, wilder_atr

# ── Regime labels ──────────────────────────────────────────────────────────
BALANCED = "BALANCED"
IMBALANCED = "IMBALANCED"
VOL_LOW = "LOW"
VOL_NORMAL = "NORMAL"
VOL_HIGH = "HIGH"


def classify_regimes(
    df: pd.DataFrame,
    *,
    atr_period: int = 14,
    atr_ma_period: int = 50,
    er_period: int = 20,
    er_balanced_threshold: float = 0.35,
    vol_high_threshold: float = 1.5,
    vol_low_threshold: float = 0.6,
) -> pd.DataFrame:
    """
    Classify each bar into a two-axis regime. Returns a copy of df with new columns.

    Parameters
    ----------
    df                    : OHLCV DataFrame (columns: open, high, low, close, volume)
    atr_period            : Wilder ATR lookback
    atr_ma_period         : Rolling window for ATR mean (baseline for vol comparison)
    er_period             : Efficiency Ratio lookback (bars)
    er_balanced_threshold : ER below this → BALANCED; at or above → IMBALANCED
    vol_high_threshold    : atr / atr_ma above this → HIGH vol
    vol_low_threshold     : atr / atr_ma below this → LOW vol

    Added columns
    -------------
    atr           Wilder ATR value
    atr_ma        Rolling mean of ATR (vol baseline)
    atr_ratio     atr / atr_ma (> 1 = above-average vol)
    er            Efficiency Ratio (0..1)
    structure     'BALANCED' | 'IMBALANCED' | NaN (warmup)
    vol           'LOW' | 'NORMAL' | 'HIGH' | NaN (warmup)
    regime        'BALANCED_NORMAL' etc. | NaN (warmup)
    """
    out = df.copy()

    h = df["high"].values.astype(float)
    lo = df["low"].values.astype(float)
    c = df["close"].values.astype(float)

    # ── ATR & vol axis ─────────────────────────────────────────────────────
    atr_vals = wilder_atr(h, lo, c, atr_period)
    out["atr"] = atr_vals
    out["atr_ma"] = out["atr"].rolling(atr_ma_period, min_periods=atr_period).mean()
    out["atr_ratio"] = out["atr"] / out["atr_ma"].replace(0, np.nan)

    # ── Efficiency Ratio & structure axis ──────────────────────────────────
    out["er"] = efficiency_ratio(df["close"], er_period)

    # ── Structure classification ───────────────────────────────────────────
    _struct = np.where(out["er"] < er_balanced_threshold, BALANCED, IMBALANCED).astype(object)
    _struct[out["er"].isna().values] = np.nan
    out["structure"] = _struct

    # ── Volatility classification ──────────────────────────────────────────
    def _vol(ratio):
        if pd.isna(ratio):
            return np.nan
        if ratio > vol_high_threshold:
            return VOL_HIGH
        if ratio < vol_low_threshold:
            return VOL_LOW
        return VOL_NORMAL

    out["vol"] = out["atr_ratio"].map(_vol)

    # ── Combined regime ────────────────────────────────────────────────────
    def _combined(row):
        if pd.isna(row["structure"]) or pd.isna(row["vol"]):
            return np.nan
        return f"{row['structure']}_{row['vol']}"

    out["regime"] = out[["structure", "vol"]].apply(_combined, axis=1)

    return out


def regime_numeric(df_regime: pd.DataFrame) -> pd.DataFrame:
    """
    Add integer columns for plotting:
        structure_num : 0 = BALANCED, 1 = IMBALANCED
        vol_num       : 0 = LOW, 1 = NORMAL, 2 = HIGH
    """
    out = df_regime.copy()
    out["structure_num"] = out["structure"].map(
        {BALANCED: 0, IMBALANCED: 1}
    ).astype(float)
    out["vol_num"] = out["vol"].map(
        {VOL_LOW: 0, VOL_NORMAL: 1, VOL_HIGH: 2}
    ).astype(float)
    return out
