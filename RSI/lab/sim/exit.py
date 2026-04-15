"""
Exit simulation engine.

Ported from simulation/ltf_trade_management_study_v1fix.py — the corrected
version. Two specific flaws from the original are fixed here:

  FLAW 1 (skip_entry_bucket_hours=4.0 default):
    The original gave trades a 4h grace period after entry during which no SL
    or TP could fire. This artificially prevented many early stop-outs, making
    results look better than they are. The fix: skip=0.0 — SL/TP are live from
    the first 5m bar at or after entry.

  FLAW 2 (deferred stop updates):
    The original queued stop updates via pending_stop, only activating at the
    NEXT bar's open. This meant a whipsaw bar (price hits MFE then reverses)
    would not trigger the lock — the trade stayed open with the original stop.
    The fix (same-bar activation): when MFE threshold is hit, the tighter stop
    is live immediately and the same bar's adverse wick can hit it.

Two replay modes:
  replay_trade_5m            — fixed SL/TP, optional single BE trigger
  replay_trade_mfe_ladder_5m — N-stage MFE lock ladder, same-bar activation

Both follow sim/rules.py:
  Rule 4: SL checked before TP on each bar
  Rule 6: entry bucket skip=0 (SL/TP live from entry)
  Rule 7: same-bar stop activation (no deferral)
  Rule 8: cap_lock_by_mfe=True default
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class ReplayResult:
    """Result of replaying one trade on 5m bars."""
    pnl_r: float        # net R including fee
    reason: str         # 'SL' | 'TP' | 'BE'
    exit_ts: pd.Timestamp
    bars: int           # 5m bars from first management bar to exit


def _fee_r(entry: float, risk: float, fee_bps: float) -> float:
    """Round-trip fee in R-units. Rule 5."""
    return (entry * (fee_bps / 10_000.0)) / risk if risk > 0 else 0.0


def replay_trade_5m(
    df5: pd.DataFrame,
    entry_ts: pd.Timestamp,
    side: int,
    entry_price: float,
    stop_init: float,
    tp_price: float,
    risk: float,
    fee_bps: float,
    *,
    be_trigger_r: float | None,
    be_offset_r: float,
    skip_entry_bucket_hours: float = 0.0,
) -> ReplayResult | None:
    """
    Replay a trade on 5m OHLCV with optional single breakeven trigger.

    If be_trigger_r is None: pure fixed SL/TP (baseline mode).
    be_offset_r: after BE arm, stop moves to entry ± be_offset_r * risk.

    skip_entry_bucket_hours=0.0 (default): SL/TP are live from the first 5m bar
    at or after entry. This is realistic — your stop is placed when you enter.
    Use skip>0 only if you have a specific reason to delay management.

    Returns None if no candle data is available after the entry bucket skip.
    """
    fee = _fee_r(entry_price, risk, fee_bps)
    if len(df5) == 0 or risk <= 0:
        return None

    entry_end = pd.Timestamp(entry_ts) + pd.Timedelta(hours=skip_entry_bucket_hours)
    d = df5.loc[df5.index >= entry_end]
    if len(d) == 0:
        return None

    stop = stop_init
    armed = False

    if side == 1:
        trig_price = entry_price + be_trigger_r * risk if be_trigger_r is not None else None
        be_stop = entry_price + be_offset_r * risk
    else:
        trig_price = entry_price - be_trigger_r * risk if be_trigger_r is not None else None
        be_stop = entry_price - be_offset_r * risk

    for i, (ts, row) in enumerate(d.iterrows()):
        h, lo = float(row["high"]), float(row["low"])

        if side == 1:
            if lo <= stop:
                tag = "SL" if abs(stop - stop_init) < 1e-9 * max(1.0, abs(entry_price)) else "BE"
                return ReplayResult((stop - entry_price) / risk - fee, tag, ts, i + 1)
            if h >= tp_price:
                return ReplayResult((tp_price - entry_price) / risk - fee, "TP", ts, i + 1)
            if trig_price is not None and not armed and h >= trig_price:
                armed = True
                stop = be_stop
                if lo <= stop:
                    return ReplayResult((stop - entry_price) / risk - fee, "BE", ts, i + 1)
        else:
            if h >= stop:
                tag = "SL" if abs(stop - stop_init) < 1e-9 * max(1.0, abs(entry_price)) else "BE"
                return ReplayResult((entry_price - stop) / risk - fee, tag, ts, i + 1)
            if lo <= tp_price:
                return ReplayResult((entry_price - tp_price) / risk - fee, "TP", ts, i + 1)
            if trig_price is not None and not armed and lo <= trig_price:
                armed = True
                stop = be_stop
                if h >= stop:
                    return ReplayResult((entry_price - stop) / risk - fee, "BE", ts, i + 1)

    return None


def replay_trade_mfe_ladder_5m(
    df5: pd.DataFrame,
    entry_ts: pd.Timestamp,
    side: int,
    entry_price: float,
    stop_init: float,
    tp_price: float,
    risk: float,
    fee_bps: float,
    *,
    stages: list[tuple[float, float]],
    cap_lock_by_mfe: bool = True,
    skip_entry_bucket_hours: float = 0.0,
) -> ReplayResult | None:
    """
    Replay a trade on 5m bars with an N-stage cumulative MFE lock ladder.

    stages: list of (mfe_r, lock_r) with strictly increasing mfe_r values.
      When cumulative favorable excursion from entry reaches mfe_r, stop is
      moved to entry ± lock_r * risk (long: +, short: -).

    cap_lock_by_mfe (Rule 8): lock_eff = min(lock_r, mfe_max_r).
      Prevents locking to a level price hasn't actually reached yet.

    Same-bar activation (Rule 7 fix): when MFE threshold is touched in a bar,
    the tighter stop becomes active immediately. If the same bar's adverse wick
    then hits the new stop, the trade exits in that bar. This is realistic —
    a whipsaw candle that touches +1R then drops to +0.8R gets stopped at +0.8R.

    skip_entry_bucket_hours=0.0: SL/TP live from entry. See replay_trade_5m.

    Returns None if no 5m data is available after the entry bucket skip.
    """
    fee = _fee_r(entry_price, risk, fee_bps)
    if len(df5) == 0 or risk <= 0:
        return None
    if not stages:
        raise ValueError("stages must be non-empty")
    mfes = [s[0] for s in stages]
    for a, b in zip(mfes, mfes[1:]):
        if b <= a + 1e-12:
            raise ValueError(f"mfe_r values must be strictly increasing, got {a} then {b}")

    stages_desc = sorted(stages, key=lambda x: -x[0])
    entry_end = pd.Timestamp(entry_ts) + pd.Timedelta(hours=skip_entry_bucket_hours)
    d = df5.loc[df5.index >= entry_end]
    if len(d) == 0:
        return None

    stop = stop_init
    mfe_max_r = 0.0

    for i, (ts, row) in enumerate(d.iterrows()):
        h, lo = float(row["high"]), float(row["low"])

        if side == 1:
            # Rule 4: SL before TP
            if lo <= stop:
                tag = "SL" if abs(stop - stop_init) < 1e-8 * max(1.0, abs(entry_price)) else "BE"
                return ReplayResult((stop - entry_price) / risk - fee, tag, ts, i + 1)
            if h >= tp_price:
                return ReplayResult((tp_price - entry_price) / risk - fee, "TP", ts, i + 1)

            # Extend MFE, update stop immediately (same-bar activation)
            mfe_max_r = max(mfe_max_r, (h - entry_price) / risk)
            desired = stop
            for mfe_r, lock_r in stages_desc:
                if mfe_max_r + 1e-12 >= mfe_r:
                    lock_eff = min(lock_r, mfe_max_r) if cap_lock_by_mfe else lock_r
                    desired = max(desired, entry_price + lock_eff * risk)
                    break
            stop = desired
            # Same bar: check if adverse wick hits the newly set stop
            if lo <= stop:
                return ReplayResult((stop - entry_price) / risk - fee, "BE", ts, i + 1)

        else:
            if h >= stop:
                tag = "SL" if abs(stop - stop_init) < 1e-8 * max(1.0, abs(entry_price)) else "BE"
                return ReplayResult((entry_price - stop) / risk - fee, tag, ts, i + 1)
            if lo <= tp_price:
                return ReplayResult((entry_price - tp_price) / risk - fee, "TP", ts, i + 1)

            mfe_max_r = max(mfe_max_r, (entry_price - lo) / risk)
            desired = stop
            for mfe_r, lock_r in stages_desc:
                if mfe_max_r + 1e-12 >= mfe_r:
                    lock_eff = min(lock_r, mfe_max_r) if cap_lock_by_mfe else lock_r
                    desired = min(desired, entry_price - lock_eff * risk)
                    break
            stop = desired
            if h >= stop:
                return ReplayResult((entry_price - stop) / risk - fee, "BE", ts, i + 1)

    return None
