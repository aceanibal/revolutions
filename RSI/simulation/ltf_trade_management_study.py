#!/usr/bin/env python3
"""
LTF trade-management study (sandbox + shared backtest DB only).

Context: 4h RSI entries (same as multi_asset: cross below/above thresholds), structural SL (N=3),
baseline TP = k R on the 4h engine. This script does NOT change the *signal*; it asks:

  If we resolve path on 5m and allow moving the stop to breakeven (or BE + small profit)
  after price moves favorably by X R, do we improve total R vs holding fixed TP/SL?

Optional: report how much "better long entry" was available inside the entry 4h bucket on 5m
(wick below the 4h open) — informational for future limit-order work; does not change simulated fills
unless you use --experimental-better-long-fill.

Assumptions (documented):
- Intra-5m-bar: for longs, check **low** before **high** (conservative for long PnL).
- Same bar: SL before TP before BE-arm (conservative).
"""
from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass

import numpy as np
import pandas as pd
from ta.momentum import RSIIndicator

_SANDBOX = os.path.dirname(os.path.abspath(__file__))
if _SANDBOX not in sys.path:
    sys.path.insert(0, _SANDBOX)

from multi_asset_4h_rsi_sim import (  # noqa: E402
    DB_PATH,
    list_sessions_with_symbol,
    load_5m_candles,
    run_simulation_trades,
)

DEFAULT_SYMBOLS = ["XRPUSDT", "BTCUSDT", "SOLUSDT", "LINKUSDT", "DOGEUSDT"]


@dataclass
class ReplayResult:
    pnl_r: float
    reason: str
    exit_ts: pd.Timestamp
    bars: int  # 5m or 4h bars depending on replay mode


def _fee_r(entry: float, risk: float, fee_bps: float) -> float:
    return (entry * (fee_bps / 10000.0)) / risk if risk > 0 else 0.0


def replay_trade_4h(
    idx: pd.DatetimeIndex,
    high_arr: np.ndarray,
    low_arr: np.ndarray,
    entry_idx: int,
    side: int,
    entry_price: float,
    stop_init: float,
    tp_price: float,
    risk: float,
    fee_bps: float,
    *,
    be_trigger_r: float | None,
    be_offset_r: float,
) -> ReplayResult | None:
    """
    Same bar logic as the 4h engine, one decision per 4h candle — matches baseline PnL when BE is off.
    """
    fee_r = _fee_r(entry_price, risk, fee_bps)
    n = len(high_arr)
    if risk <= 0 or entry_idx + 1 >= n:
        return None

    stop = stop_init
    tp = tp_price
    armed = False
    if side == 1:
        trig_price = entry_price + (be_trigger_r * risk) if be_trigger_r is not None else None
        be_stop = entry_price + (be_offset_r * risk)
    else:
        trig_price = entry_price - (be_trigger_r * risk) if be_trigger_r is not None else None
        be_stop = entry_price - (be_offset_r * risk)

    # Match runBacktest loop: exit is evaluated starting the bar *after* entry (no same-bar exit).
    for j in range(entry_idx + 1, n):
        h, low = float(high_arr[j]), float(low_arr[j])
        ts = idx[j]

        if side == 1:
            if low <= stop:
                gross = (stop - entry_price) / risk
                tag = "SL" if abs(stop - stop_init) < 1e-8 * max(1.0, abs(entry_price)) else "BE"
                return ReplayResult(gross - fee_r, tag, ts, j - entry_idx + 1)
            if h >= tp:
                gross = (tp_price - entry_price) / risk
                return ReplayResult(gross - fee_r, "TP", ts, j - entry_idx + 1)
            if be_trigger_r is not None and not armed and h >= trig_price:
                armed = True
                stop = be_stop
                if low <= stop:
                    gross = (stop - entry_price) / risk
                    return ReplayResult(gross - fee_r, "BE", ts, j - entry_idx + 1)
        else:
            if h >= stop:
                gross = (entry_price - stop) / risk
                tag = "SL" if abs(stop - stop_init) < 1e-8 * max(1.0, abs(entry_price)) else "BE"
                return ReplayResult(gross - fee_r, tag, ts, j - entry_idx + 1)
            if low <= tp:
                gross = (entry_price - tp_price) / risk
                return ReplayResult(gross - fee_r, "TP", ts, j - entry_idx + 1)
            if be_trigger_r is not None and not armed and low <= trig_price:
                armed = True
                stop = be_stop
                if h >= stop:
                    gross = (entry_price - stop) / risk
                    return ReplayResult(gross - fee_r, "BE", ts, j - entry_idx + 1)

    return None


def replay_trade_4h_mfe_ladder(
    idx: pd.DatetimeIndex,
    high_arr: np.ndarray,
    low_arr: np.ndarray,
    entry_idx: int,
    side: int,
    entry_price: float,
    stop_init: float,
    tp_price: float,
    risk: float,
    fee_bps: float,
    *,
    stages: list[tuple[float, float]],
) -> ReplayResult | None:
    """
    Cumulative MFE → lock ladder on 4h bars (exits start after entry bar).

    stages: (mfe_r, lock_r) with strictly increasing mfe_r. Cumulative favorable excursion
    from entry vs stop at entry ± lock_r·R. Per bar, the highest mfe threshold touched applies
    (same-bar as two-stage: strongest lock wins).

    Long: high >= entry + mfe_r*risk → stop >= entry + lock_r*risk.
    Short: low <= entry - mfe_r*risk → stop <= entry - lock_r*risk.
    """
    fee_r = _fee_r(entry_price, risk, fee_bps)
    n = len(high_arr)
    if risk <= 0 or entry_idx + 1 >= n:
        return None
    if not stages:
        raise ValueError("stages must be non-empty")
    mfes = [s[0] for s in stages]
    for a, b in zip(mfes, mfes[1:]):
        if b <= a + 1e-12:
            raise ValueError(f"mfe_r must be strictly increasing, got {a} then {b}")

    stages_desc = sorted(stages, key=lambda x: -x[0])
    stop = stop_init
    tp = tp_price

    for j in range(entry_idx + 1, n):
        h, low = float(high_arr[j]), float(low_arr[j])
        ts = idx[j]

        if side == 1:
            if low <= stop:
                gross = (stop - entry_price) / risk
                tag = "SL" if abs(stop - stop_init) < 1e-8 * max(1.0, abs(entry_price)) else "BE"
                return ReplayResult(gross - fee_r, tag, ts, j - entry_idx + 1)
            if h >= tp:
                gross = (tp_price - entry_price) / risk
                return ReplayResult(gross - fee_r, "TP", ts, j - entry_idx + 1)
            for mfe_r, lock_r in stages_desc:
                if h >= entry_price + mfe_r * risk:
                    stop = max(stop, entry_price + lock_r * risk)
                    break
            if low <= stop:
                gross = (stop - entry_price) / risk
                return ReplayResult(gross - fee_r, "BE", ts, j - entry_idx + 1)
        else:
            if h >= stop:
                gross = (entry_price - stop) / risk
                tag = "SL" if abs(stop - stop_init) < 1e-8 * max(1.0, abs(entry_price)) else "BE"
                return ReplayResult(gross - fee_r, tag, ts, j - entry_idx + 1)
            if low <= tp:
                gross = (entry_price - tp_price) / risk
                return ReplayResult(gross - fee_r, "TP", ts, j - entry_idx + 1)
            for mfe_r, lock_r in stages_desc:
                if low <= entry_price - mfe_r * risk:
                    stop = min(stop, entry_price - lock_r * risk)
                    break
            if h >= stop:
                gross = (entry_price - stop) / risk
                return ReplayResult(gross - fee_r, "BE", ts, j - entry_idx + 1)

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
    skip_entry_bucket_hours: float = 4.0,
) -> ReplayResult | None:
    """
    MFE ladder on 5m OHLC — closer to a real intrabar path than 4h-only.

    - Walks 5m bars from entry_ts + skip_entry_bucket_hours (same idea as replay_trade_5m:
      no management fills inside the entry 4h candle bucket).
    - Tracks cumulative favorable excursion in R: mfe_max_r from running high (long) / low (short).
    - For each stage with mfe_max_r >= mfe_r, tightens stop toward entry ± lock_eff·risk where
      lock_eff = min(lock_r, mfe_max_r) if cap_lock_by_mfe else lock_r.
      So you cannot lock +1R until price has *actually traded* there (when cap_lock_by_mfe=True).
    - Stop updates are deferred: wick-touch updates mfe and computes the new stop level, but that
      level only becomes active at the **open of the next** 5m bar (no same-bar activation).

    Long per bar: apply pending stop at open → low vs active stop → high vs TP → extend mfe_max →
    compute desired stop from ladder → queue for next bar.

    bars in ReplayResult = number of 5m bars from first management bar to exit.
    """
    fee_r = _fee_r(entry_price, risk, fee_bps)
    if len(df5) == 0 or risk <= 0:
        return None
    if not stages:
        raise ValueError("stages must be non-empty")
    mfes = [s[0] for s in stages]
    for a, b in zip(mfes, mfes[1:]):
        if b <= a + 1e-12:
            raise ValueError(f"mfe_r must be strictly increasing, got {a} then {b}")

    stages_desc = sorted(stages, key=lambda x: -x[0])
    entry_end = pd.Timestamp(entry_ts) + pd.Timedelta(hours=skip_entry_bucket_hours)
    d = df5.loc[df5.index >= entry_end]
    if len(d) == 0:
        return None

    stop = stop_init
    tp = tp_price
    mfe_max_r = 0.0
    pending_stop: float | None = None

    for i, (ts, row) in enumerate(d.iterrows()):
        h, low = float(row["high"]), float(row["low"])

        if side == 1:
            if pending_stop is not None:
                stop = pending_stop
                pending_stop = None
            stop_at_open = stop
            # Conservative: check adverse move before extending MFE with this bar's high.
            if low <= stop_at_open:
                gross = (stop_at_open - entry_price) / risk
                tag = "SL" if abs(stop_at_open - stop_init) < 1e-8 * max(1.0, abs(entry_price)) else "BE"
                return ReplayResult(gross - fee_r, tag, ts, i + 1)
            if h >= tp:
                gross = (tp_price - entry_price) / risk
                return ReplayResult(gross - fee_r, "TP", ts, i + 1)
            mfe_max_r = max(mfe_max_r, (h - entry_price) / risk)
            desired = stop_at_open
            for mfe_r, lock_r in stages_desc:
                if mfe_max_r + 1e-12 >= mfe_r:
                    lock_eff = min(lock_r, mfe_max_r) if cap_lock_by_mfe else lock_r
                    desired = max(desired, entry_price + lock_eff * risk)
            pending_stop = desired
        else:
            if pending_stop is not None:
                stop = pending_stop
                pending_stop = None
            stop_at_open = stop
            if h >= stop_at_open:
                gross = (entry_price - stop_at_open) / risk
                tag = "SL" if abs(stop_at_open - stop_init) < 1e-8 * max(1.0, abs(entry_price)) else "BE"
                return ReplayResult(gross - fee_r, tag, ts, i + 1)
            if low <= tp:
                gross = (entry_price - tp_price) / risk
                return ReplayResult(gross - fee_r, "TP", ts, i + 1)
            mfe_max_r = max(mfe_max_r, (entry_price - low) / risk)
            desired = stop_at_open
            for mfe_r, lock_r in stages_desc:
                if mfe_max_r + 1e-12 >= mfe_r:
                    lock_eff = min(lock_r, mfe_max_r) if cap_lock_by_mfe else lock_r
                    desired = min(desired, entry_price - lock_eff * risk)
            pending_stop = desired

    return None


def replay_trade_4h_two_stage(
    idx: pd.DatetimeIndex,
    high_arr: np.ndarray,
    low_arr: np.ndarray,
    entry_idx: int,
    side: int,
    entry_price: float,
    stop_init: float,
    tp_price: float,
    risk: float,
    fee_bps: float,
    *,
    mfe1_r: float,
    lock1_r: float,
    mfe2_r: float | None,
    lock2_r: float | None,
) -> ReplayResult | None:
    """
    Two-stage management (4h bars, exits start after entry bar).

    Long: when high >= entry + mfe1_r*risk → stop at entry + lock1_r*risk.
    Optional second: when high >= entry + mfe2_r*risk (cumulative from entry) → stop at entry + lock2_r*risk.
    Same-bar: if high clears mfe2, apply lock2 in one step (stronger than lock1).

    Short: triggers on favorable lows; locks below entry.

    If mfe2_r is None, only first stage applies (same as one arm if mfe2 ignored).
    """
    if mfe2_r is not None and lock2_r is None:
        raise ValueError("lock2_r required when mfe2_r is set")
    if mfe2_r is None and lock2_r is not None:
        raise ValueError("mfe2_r required when lock2_r is set")

    ladder_stages: list[tuple[float, float]] = [(mfe1_r, lock1_r)]
    if mfe2_r is not None:
        ladder_stages.append((mfe2_r, lock2_r))

    return replay_trade_4h_mfe_ladder(
        idx,
        high_arr,
        low_arr,
        entry_idx,
        side,
        entry_price,
        stop_init,
        tp_price,
        risk,
        fee_bps,
        stages=ladder_stages,
    )


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
) -> ReplayResult | None:
    """
    Walk forward on 5m bars from entry_ts. If be_trigger_r is None, only fixed SL/TP.
    be_offset_r: after BE arm, stop at entry + side*offset*risk (long: entry + off*risk; short: entry - off*risk).

    Intra-bar sequence (long): hit existing stop first, then TP, then arm BE if unfavorable move
    did not exit; after arm, same-bar re-check stop at BE level.
    """
    fee_r = _fee_r(entry_price, risk, fee_bps)
    if len(df5) == 0 or risk <= 0:
        return None

    # First exit in the engine is on the 4h bar after entry; skip 5m bars inside the entry 4h bucket.
    entry_end = entry_ts + pd.Timedelta(hours=4)
    d = df5.loc[df5.index >= entry_end]
    if len(d) == 0:
        return None

    stop = stop_init
    tp = tp_price
    armed = False
    trig_r = be_trigger_r

    if side == 1:
        trig_price = entry_price + (trig_r * risk) if trig_r is not None else None
        be_stop = entry_price + (be_offset_r * risk)
    else:
        trig_price = entry_price - (trig_r * risk) if trig_r is not None else None
        be_stop = entry_price - (be_offset_r * risk)

    def exit_long(stop_px: float, ts, i_bar: int, tag: str) -> ReplayResult:
        gross = (stop_px - entry_price) / risk
        return ReplayResult(gross - fee_r, tag, ts, i_bar)

    def exit_short(stop_px: float, ts, i_bar: int, tag: str) -> ReplayResult:
        gross = (entry_price - stop_px) / risk
        return ReplayResult(gross - fee_r, tag, ts, i_bar)

    for i, (ts, row) in enumerate(d.iterrows()):
        h, low = float(row["high"]), float(row["low"])

        if side == 1:
            if low <= stop:
                tag = "SL" if abs(stop - stop_init) < 1e-9 * max(1.0, abs(entry_price)) else "BE"
                return exit_long(stop, ts, i + 1, tag)
            if h >= tp:
                return exit_long(tp, ts, i + 1, "TP")
            if trig_r is not None and not armed and h >= trig_price:
                armed = True
                stop = be_stop
                if low <= stop:
                    return exit_long(stop, ts, i + 1, "BE")
        else:
            if h >= stop:
                tag = "SL" if abs(stop - stop_init) < 1e-9 * max(1.0, abs(entry_price)) else "BE"
                return exit_short(stop, ts, i + 1, tag)
            if low <= tp:
                return exit_short(tp, ts, i + 1, "TP")
            if trig_r is not None and not armed and low <= trig_price:
                armed = True
                stop = be_stop
                if h >= stop:
                    return exit_short(stop, ts, i + 1, "BE")

    return None


def load_4h_and_5m(db_path: str, symbol: str) -> tuple[pd.DataFrame, pd.DataFrame] | tuple[None, None]:
    sessions = list_sessions_with_symbol(db_path, symbol)
    if not sessions:
        return None, None
    session_id = sessions[0][0]
    df_5m = load_5m_candles(db_path, session_id, symbol)
    if len(df_5m) == 0:
        return None, None
    df_4h = (
        df_5m.resample("4h")
        .agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
        .dropna()
    )
    df_4h["RSI"] = RSIIndicator(close=df_4h["close"], window=20).rsi()
    df_4h = df_4h.dropna(subset=["RSI"]).copy()
    return df_4h, df_5m


def tp_price_from_r(entry_price: float, risk: float, side: int, tp_r: float) -> float:
    if side == 1:
        return entry_price + tp_r * risk
    return entry_price - tp_r * risk


def replay_scenario(
    trades: list,
    idx: pd.DatetimeIndex,
    high_arr: np.ndarray,
    low_arr: np.ndarray,
    fee_bps: float,
    tp_r: float,
    mfe_r: float | None,
    lock_r: float,
) -> list[ReplayResult]:
    """Replay all trades with given TP (R), optional MFE trigger and profit lock."""
    out: list[ReplayResult] = []
    for t in trades:
        tp_px = tp_price_from_r(t["entry_price"], t["risk"], t["side"], tp_r)
        rr = replay_trade_4h(
            idx,
            high_arr,
            low_arr,
            t["entry_idx"],
            t["side"],
            t["entry_price"],
            t["stop_loss"],
            tp_px,
            t["risk"],
            fee_bps,
            be_trigger_r=mfe_r,
            be_offset_r=lock_r,
        )
        if rr:
            out.append(rr)
    return out


def summarize_pnls(results: list[ReplayResult]) -> dict:
    if not results:
        return {
            "total_r": 0.0,
            "n": 0,
            "win_rate": 0.0,
            "avg_hold_bars": 0.0,
            "min_b": 0,
            "max_b": 0,
            "max_dd_r": 0.0,
        }
    pnls = np.array([r.pnl_r for r in results])
    bars = np.array([r.bars for r in results])
    cum = np.cumsum(pnls)
    peak = np.maximum.accumulate(cum)
    max_dd = float(np.max(peak - cum)) if len(cum) else 0.0
    return {
        "total_r": float(np.sum(pnls)),
        "n": len(results),
        "win_rate": float(np.mean(pnls > 0) * 100),
        "avg_hold_bars": float(np.mean(bars)),
        "min_b": int(np.min(bars)),
        "max_b": int(np.max(bars)),
        "max_dd_r": max_dd,
    }


def first_4h_long_entry_improvement_r(
    df5: pd.DataFrame, entry_ts: pd.Timestamp, entry_open_4h: float, risk: float, side: int
) -> float | None:
    """For longs: (open - min_low_in_first_4h_bucket) / risk — how many R of 'better fill' the wick offered."""
    if side != 1 or risk <= 0:
        return None
    end = entry_ts + pd.Timedelta(hours=4)
    seg = df5.loc[(df5.index >= entry_ts) & (df5.index < end)]
    if len(seg) == 0:
        return None
    m = float(seg["low"].min())
    return max(0.0, (entry_open_4h - m) / risk)


def main() -> None:
    ap = argparse.ArgumentParser(
        description="TP × MFE × lock scenario matrix (same 4h entries; replay with alternate TP/management)."
    )
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--fee-bps", type=float, default=3.0)
    ap.add_argument("--rsi-l", type=int, default=35)
    ap.add_argument("--rsi-h", type=int, default=60)
    ap.add_argument("--sl-n", type=int, default=3)
    ap.add_argument(
        "--entry-tp-r",
        type=float,
        default=5.0,
        help="TP (R) used in run_simulation_trades to **generate the trade list** (signals unchanged by TP sweep).",
    )
    ap.add_argument(
        "--tp-r",
        type=float,
        default=5.0,
        help="If --tp-sweep omitted, single TP column only (legacy).",
    )
    ap.add_argument(
        "--tp-sweep",
        type=str,
        default="2,3,4,5,6,7,8",
        help="Comma-separated TP targets in R. Set empty to use --tp-r only.",
    )
    ap.add_argument(
        "--mfe-sweep",
        "--be-sweep",
        type=str,
        default="0.5,1.0,1.5,2.0",
        dest="mfe_sweep",
        help="MFE (R) to arm managed stop. Use 1.0 for '1R MFE' tests.",
    )
    ap.add_argument(
        "--be-offset-r",
        type=float,
        default=None,
        help="Single lock level; if set, --lock-sweep is ignored.",
    )
    ap.add_argument(
        "--lock-sweep",
        type=str,
        default="0,0.25,0.5,1.0",
        help="Profit lock at stop after MFE (R from entry); 0 = BE.",
    )
    ap.add_argument("--symbols", type=str, default=",".join(DEFAULT_SYMBOLS))
    ap.add_argument(
        "--csv",
        type=str,
        default=os.path.join(_SANDBOX, "cache", "ltf_scenario_matrix.csv"),
        help="Write full scenario matrix to this CSV path.",
    )
    ap.add_argument("--no-csv", action="store_true", help="Do not write CSV.")
    ap.add_argument(
        "--verbose",
        action="store_true",
        help="Print full matrix to stdout (large). Default: summary + best rows only.",
    )
    ap.add_argument(
        "--include-5m-micro",
        action="store_true",
        help="Append one line: 5m-resolved baseline for entry TP (diagnostic).",
    )
    ap.add_argument(
        "--tp-fixed-report",
        type=float,
        default=5.0,
        help="After the main run, print TP-isolation tables for this tp_r (default 5). Set -1 to skip.",
    )
    ap.add_argument(
        "--tp-fixed-csv",
        type=str,
        default=os.path.join(_SANDBOX, "cache", "ltf_tp5_management_isolation.csv"),
        help="CSV path for TP-fixed slice (same rows as main matrix, filtered by tp_r).",
    )
    args = ap.parse_args()

    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    mfe_levels = [float(x.strip()) for x in args.mfe_sweep.split(",") if x.strip()]
    lock_levels = [float(x.strip()) for x in args.lock_sweep.split(",") if x.strip()]
    if args.be_offset_r is not None:
        lock_levels = [float(args.be_offset_r)]

    tp_s = args.tp_sweep.strip()
    if tp_s:
        tp_levels = [float(x.strip()) for x in tp_s.split(",") if x.strip()]
    else:
        tp_levels = [float(args.tp_r)]

    csv_rows: list[dict] = []

    print(
        f"LTF scenario matrix | RSI {args.rsi_l}/{args.rsi_h} SL_N={args.sl_n} | fee {args.fee_bps} bps RT\n"
        f"Entry trades from engine TP={args.entry_tp_r}R | Replay sweeps TP={tp_levels} | "
        f"MFE={mfe_levels} | lock={lock_levels}\n"
        f"(Entries identical across TP scenarios; TP/MFE/lock only affect replay exits.)\n"
    )

    for sym in symbols:
        df_4h, df_5m = load_4h_and_5m(os.path.abspath(args.db), sym)
        if df_4h is None or len(df_4h) == 0:
            print(f"{sym}: skip (no data)\n")
            continue

        o = df_4h["open"].values
        h = df_4h["high"].values
        low = df_4h["low"].values
        rsi = df_4h["RSI"].values
        idx = df_4h.index

        trades = run_simulation_trades(
            o,
            h,
            low,
            rsi,
            args.rsi_l,
            args.rsi_h,
            args.sl_n,
            args.entry_tp_r,
            args.fee_bps,
        )
        n_tr = len(trades)
        engine_baseline = float(sum(t["pnl_r"] for t in trades))

        # Baseline TP-only replay per tp_r (no MFE management)
        tp_only_totals: dict[float, dict] = {}
        for tp_r in tp_levels:
            res = replay_scenario(trades, idx, h, low, args.fee_bps, tp_r, None, 0.0)
            tp_only_totals[tp_r] = summarize_pnls(res)

        improve_long: list[float] = []
        for t in trades:
            if t["side"] == 1:
                et = idx[t["entry_idx"]]
                imp = first_4h_long_entry_improvement_r(
                    df_5m, et, float(o[t["entry_idx"]]), t["risk"], t["side"]
                )
                if imp is not None:
                    improve_long.append(imp)

        print(f"=== {sym} | trades={n_tr} | engine @ {args.entry_tp_r}R TP: {engine_baseline:+.2f} R ===")
        if improve_long and args.verbose:
            print(
                f"  Long wick vs open (median R): {np.median(improve_long):.2f} | "
                f"p90 {np.percentile(improve_long, 90):.2f}"
            )

        best_for_sym: list[tuple[float, float, float, float, dict]] = []

        for tp_r in tp_levels:
            base = tp_only_totals[tp_r]
            for mfe_r in mfe_levels:
                for lock_r in lock_levels:
                    res = replay_scenario(trades, idx, h, low, args.fee_bps, tp_r, mfe_r, lock_r)
                    sm = summarize_pnls(res)
                    delta_tp_only = sm["total_r"] - base["total_r"]
                    row = {
                        "symbol": sym,
                        "tp_r": tp_r,
                        "mfe_r": mfe_r,
                        "lock_r": lock_r,
                        "total_r": round(sm["total_r"], 4),
                        "delta_vs_tp_only": round(delta_tp_only, 4),
                        "win_pct": round(sm["win_rate"], 2),
                        "max_dd_r": round(sm["max_dd_r"], 4),
                        "avg_hold_h": round(sm["avg_hold_bars"] * 4.0, 2),
                        "n_trades": sm["n"],
                    }
                    csv_rows.append(row)
                    best_for_sym.append((sm["total_r"], tp_r, mfe_r, lock_r, sm))
                    if args.verbose:
                        print(
                            f"  TP={tp_r} MFE={mfe_r} lock={lock_r} | "
                            f"{sm['total_r']:+.2f} R (Δ vs TP-only {delta_tp_only:+.2f}) | "
                            f"win {sm['win_rate']:.1f}% DD {sm['max_dd_r']:.2f}"
                        )

        best_for_sym.sort(key=lambda x: -x[0])
        print("  Top 8 scenarios by total R:")
        for i, (tot, tp_r, mfe_r, lock_r, sm) in enumerate(best_for_sym[:8]):
            print(
                f"    #{i+1} TP={tp_r} MFE={mfe_r} lock={lock_r} | {tot:+.2f} R | "
                f"win {sm['win_rate']:.1f}% | maxDD {sm['max_dd_r']:.2f} | avgH {sm['avg_hold_bars']*4:.1f}h"
            )
        print("  TP-only replay (no MFE) by target:")
        for tp_r in tp_levels:
            b = tp_only_totals[tp_r]
            print(
                f"    TP={tp_r}R fixed: {b['total_r']:+.2f} R | win {b['win_rate']:.1f}% | "
                f"maxDD {b['max_dd_r']:.2f} R"
            )

        if args.include_5m_micro:
            replay_base_5: list[ReplayResult] = []
            for t in trades:
                et = idx[t["entry_idx"]]
                tp_px = tp_price_from_r(t["entry_price"], t["risk"], t["side"], args.entry_tp_r)
                rr = replay_trade_5m(
                    df_5m,
                    et,
                    t["side"],
                    t["entry_price"],
                    t["stop_loss"],
                    tp_px,
                    t["risk"],
                    args.fee_bps,
                    be_trigger_r=None,
                    be_offset_r=0.0,
                )
                if rr:
                    replay_base_5.append(rr)
            s5 = summarize_pnls(replay_base_5)
            print(
                f"  [5m micro] entry TP={args.entry_tp_r}R: {s5['total_r']:+.2f} R (path model ≠ 4h bar)"
            )
        print()

    if not args.no_csv and args.csv:
        outp = os.path.abspath(args.csv)
        d = os.path.dirname(outp)
        if d:
            os.makedirs(d, exist_ok=True)
        pd.DataFrame(csv_rows).to_csv(outp, index=False)
        print(f"Wrote {len(csv_rows)} rows → {outp}")

    # --- TP fixed: management vs same-TP baseline (isolates TP change from matrix sweep) ---
    if args.tp_fixed_report is not None and args.tp_fixed_report >= 0 and csv_rows:
        ftp = float(args.tp_fixed_report)
        if any(abs(x - ftp) < 1e-9 for x in tp_levels):
            sub = [r for r in csv_rows if abs(r["tp_r"] - ftp) < 1e-9]
            sub_df = pd.DataFrame(sub)
            if len(sub_df):
                print(
                    f"\n{'=' * 88}\n"
                    f"TP = {ftp}R FIXED — MFE × lock only (vs same TP with no management)\n"
                    f"Δ = total_r − TP-only replay at {ftp}R (column delta_vs_tp_only in CSV).\n"
                    f"Baseline win% / max DD for TP-only are in the section above: "
                    f"\"TP-only replay (no MFE) by target\".\n"
                    f"{'=' * 88}\n"
                )
                for sym in symbols:
                    g = sub_df[sub_df["symbol"] == sym]
                    if g.empty:
                        continue
                    r0 = g.iloc[0]
                    btot = float(r0["total_r"]) - float(r0["delta_vs_tp_only"])
                    print(f"\n--- {sym} | TP-only @ {ftp}R (no MFE): {btot:+.2f} R (implied from Δ)")
                    hdr = f"  {'MFE':>5} {'lock':>6} | {'TotR':>8} {'Δ vs TP':>9} {'Win%':>6} {'MaxDD':>7}"
                    print(hdr)
                    print(f"  {'-' * 5} {'-' * 6} | {'-' * 8} {'-' * 9} {'-' * 6} {'-' * 7}")
                    for _, row in g.sort_values(["mfe_r", "lock_r"]).iterrows():
                        print(
                            f"  {row['mfe_r']:5.1f} {row['lock_r']:6.2f} | "
                            f"{row['total_r']:+8.2f} {row['delta_vs_tp_only']:+9.2f} "
                            f"{row['win_pct']:5.1f}% {row['max_dd_r']:7.2f}"
                        )

                print(f"\n--- Portfolio (sum of R across symbols with data) @ TP={ftp}R ---")
                pivot = sub_df.groupby(["mfe_r", "lock_r"], as_index=False).agg(
                    sum_r=("total_r", "sum"),
                    sum_delta=("delta_vs_tp_only", "sum"),
                )
                pivot = pivot.sort_values(["mfe_r", "lock_r"])
                base_port = 0.0
                for sym in sub_df["symbol"].unique():
                    g = sub_df[sub_df["symbol"] == sym]
                    if len(g):
                        r0 = g.iloc[0]
                        base_port += float(r0["total_r"]) - float(r0["delta_vs_tp_only"])
                print(f"  TP-only baseline (sum over symbols): {base_port:+.2f} R")
                print(f"  {'MFE':>5} {'lock':>6} | {'SumR':>8} {'ΣΔ':>9}")
                print(f"  {'-' * 5} {'-' * 6} | {'-' * 8} {'-' * 9}")
                for _, row in pivot.iterrows():
                    print(
                        f"  {row['mfe_r']:5.1f} {row['lock_r']:6.2f} | "
                        f"{row['sum_r']:+8.2f} {row['sum_delta']:+9.2f}"
                    )

                if args.tp_fixed_csv and not args.no_csv:
                    fixp = os.path.abspath(args.tp_fixed_csv)
                    fd = os.path.dirname(fixp)
                    if fd:
                        os.makedirs(fd, exist_ok=True)
                    sub_df.to_csv(fixp, index=False)
                    print(f"\nWrote TP={ftp}R isolation slice ({len(sub_df)} rows) → {fixp}")
        elif args.tp_fixed_report > 0:
            print(
                f"\n(Skipping TP-fixed report: tp_r={args.tp_fixed_report} not in --tp-sweep.)\n"
            )

    print(
        "Notes:\n"
        "  • Trade list is from the engine at --entry-tp-r; replay varies TP/MFE/lock on those entries.\n"
        "  • delta_vs_tp_only = managed scenario minus same TP with no MFE (fixed TP/SL only).\n"
        "  • MaxDD = peak-to-trough on cumulative R over trades in time order.\n"
    )


if __name__ == "__main__":
    main()
