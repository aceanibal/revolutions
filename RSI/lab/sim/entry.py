"""
Entry signal engine.

Generates trade entries from indicator arrays. Ported from
simulation/multi_asset_4h_rsi_sim.py with no logic changes — only
the interface is cleaner (pure functions, no globals).

All rules from sim/rules.py apply:
  - Entries on bar i open when RSI crossed threshold between bar i-2 and i-1.
  - Stop: structural (N-bar min/max).
  - One position at a time.
"""
from __future__ import annotations

import numpy as np


def run_simulation_trades(
    open_arr: np.ndarray,
    high_arr: np.ndarray,
    low_arr: np.ndarray,
    rsi_arr: np.ndarray,
    rsi_low: float,
    rsi_high: float,
    sl_n: int,
    r_multi: float,
    fee_bps: float = 3.0,
) -> list[dict]:
    """
    Scan 4h bar arrays for RSI crossover entries. Returns a list of raw trade dicts.

    Signal:
      Long:  RSI[i-1] < rsi_low  AND RSI[i-2] >= rsi_low  → entry at open[i]
      Short: RSI[i-1] > rsi_high AND RSI[i-2] <= rsi_high → entry at open[i]

    Stop (structural):
      Long:  min(low[i-sl_n-1 : i])
      Short: max(high[i-sl_n-1 : i])

    Each trade dict keys:
      entry_idx, exit_idx, side (+1 long / -1 short),
      entry_price, stop_loss, take_profit, risk (price distance),
      pnl_r, reason ('SL'|'TP'), fee_r, bars
    """
    trades: list[dict] = []
    position = 0
    entry_price = 0.0
    stop_loss = 0.0
    take_profit = 0.0
    entry_idx = 0

    n = len(open_arr)
    start_idx = max(2, sl_n + 1)

    for i in range(start_idx, n):
        # ── Exits ──────────────────────────────────────────────────────────
        if position == 1:
            risk_d = entry_price - stop_loss
            fee_r = (entry_price * (fee_bps / 10_000.0)) / risk_d if risk_d > 0 else 0.0
            if low_arr[i] <= stop_loss:
                trades.append(_trade(entry_idx, i, 1, entry_price, stop_loss, take_profit,
                                     risk_d, -1.0 - fee_r, "SL", fee_r, i - entry_idx))
                position = 0
            elif high_arr[i] >= take_profit:
                trades.append(_trade(entry_idx, i, 1, entry_price, stop_loss, take_profit,
                                     risk_d, r_multi - fee_r, "TP", fee_r, i - entry_idx))
                position = 0

        elif position == -1:
            risk_d = stop_loss - entry_price
            fee_r = (entry_price * (fee_bps / 10_000.0)) / risk_d if risk_d > 0 else 0.0
            if high_arr[i] >= stop_loss:
                trades.append(_trade(entry_idx, i, -1, entry_price, stop_loss, take_profit,
                                     risk_d, -1.0 - fee_r, "SL", fee_r, i - entry_idx))
                position = 0
            elif low_arr[i] <= take_profit:
                trades.append(_trade(entry_idx, i, -1, entry_price, stop_loss, take_profit,
                                     risk_d, r_multi - fee_r, "TP", fee_r, i - entry_idx))
                position = 0

        # ── Entries (only when flat) ────────────────────────────────────────
        elif position == 0:
            if rsi_arr[i - 1] < rsi_low and rsi_arr[i - 2] >= rsi_low:
                ep = open_arr[i]
                sl = float(np.min(low_arr[i - 1 - sl_n: i]))
                risk = ep - sl
                if risk > 0:
                    entry_price, stop_loss = ep, sl
                    take_profit = ep + risk * r_multi
                    position = 1
                    entry_idx = i

            elif rsi_arr[i - 1] > rsi_high and rsi_arr[i - 2] <= rsi_high:
                ep = open_arr[i]
                sl = float(np.max(high_arr[i - 1 - sl_n: i]))
                risk = sl - ep
                if risk > 0:
                    entry_price, stop_loss = ep, sl
                    take_profit = ep - risk * r_multi
                    position = -1
                    entry_idx = i

    return trades


def tp_price_from_r(entry_price: float, risk: float, side: int, tp_r: float) -> float:
    """Compute the TP price given entry, risk distance, direction, and R-multiple."""
    return entry_price + side * tp_r * risk


# ── helpers ────────────────────────────────────────────────────────────────

def _trade(
    entry_idx: int, exit_idx: int, side: int,
    entry_price: float, stop_loss: float, take_profit: float,
    risk: float, pnl_r: float, reason: str, fee_r: float, bars: int,
) -> dict:
    return {
        "entry_idx": entry_idx,
        "exit_idx": exit_idx,
        "side": side,
        "entry_price": entry_price,
        "stop_loss": stop_loss,
        "take_profit": take_profit,
        "risk": risk,
        "pnl_r": pnl_r,
        "reason": reason,
        "fee_r": fee_r,
        "bars": bars,
    }
