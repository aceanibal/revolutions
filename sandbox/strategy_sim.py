#!/usr/bin/env python3
"""
Optimized strategy simulation — short reversals at liquidity zones, 5-9PM ET.

Rules:
  - Patterns: pin_bar, engulfing, evening_star (5m candles)
  - Side: short only
  - Time: 5-9 PM ET
  - SL: 0.5x candle extreme (half the original risk)
  - TP per pattern: pin_bar=3.0R, engulfing=2.5R, evening_star=3.0R
  - Outcome tracking on 1m candles

Computes equity curve, max drawdown, and zone-level breakdowns.

Usage:
    python sandbox/strategy_sim.py [--symbol XRPUSDT]
"""

import argparse
import json
import os
import sys
import time as _time
from collections import defaultdict
from zoneinfo import ZoneInfo
from datetime import datetime

ET = ZoneInfo("America/New_York")
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "backtester", "data", "backtest.sqlite")

from liquidity_zones import (
    load_5m_candles,
    list_sessions_with_symbol,
    ms_to_et,
    scanner_cache_path,
    load_scanner_cache,
)

from reversal_study import (
    load_1m_candles,
    slice_candles,
    flatten_zones,
    dedupe_nearby_levels,
    detect_reversals_5m,
)

OVERNIGHT_MS = 15 * 3600 * 1000

# ── strategy config ──────────────────────────────────────────────────────────

PATTERNS = {"pin_bar", "engulfing", "evening_star"}
SIDE = "short"
HOUR_START = 17  # 5 PM ET
HOUR_END = 21    # 9 PM ET

SL_MULT = 0.5    # tighten stop to 50% of candle extreme distance

TP_MAP = {
    "pin_bar": 3.0,
    "engulfing": 2.5,
    "evening_star": 3.0,
}

ALL_ZONES = {"week_low", "week_high", "pdh", "hvn"}

# ── simulation ───────────────────────────────────────────────────────────────

def one_trade_per_session(setups: list[dict]) -> list[dict]:
    """Keep earliest qualifying setup for each anchor_date session."""
    if not setups:
        return []
    ordered = sorted(setups, key=lambda s: int(s["time_ms"]))
    picked_by_session: dict[str, dict] = {}
    for s in ordered:
        session_key = str(s.get("anchor_date", ""))
        if not session_key:
            session_key = ms_to_et(int(s["time_ms"])).strftime("%Y-%m-%d")
        if session_key in picked_by_session:
            continue
        picked_by_session[session_key] = s
    return sorted(picked_by_session.values(), key=lambda s: int(s["time_ms"]))

def sim_trade(bars_1m: list[dict], entry: float, original_stop: float,
              side: str, tp_r: float, sl_mult: float) -> dict:
    """Simulate one trade with adjusted SL and pattern-specific TP."""
    original_risk = abs(entry - original_stop)
    if original_risk <= 0 or not bars_1m:
        return dict(pnl_r=0, exit_reason="no_risk", hold_bars=0)

    new_risk = original_risk * sl_mult
    if side == "short":
        stop = entry + new_risk
        tp_price = entry - tp_r * new_risk
    else:
        stop = entry - new_risk
        tp_price = entry + tp_r * new_risk

    mfe = mae = 0.0
    exit_reason = "timeout"
    exit_price = entry

    for j, bar in enumerate(bars_1m):
        bh, bl = bar["high"], bar["low"]
        if side == "short":
            fav, adv = entry - bl, bh - entry
            stopped = bh >= stop
            tp_hit = bl <= tp_price
        else:
            fav, adv = bh - entry, entry - bl
            stopped = bl <= stop
            tp_hit = bh >= tp_price

        mfe = max(mfe, fav / new_risk) if new_risk > 0 else 0
        mae = max(mae, adv / new_risk) if new_risk > 0 else 0

        if tp_hit and not stopped:
            exit_reason = f"{tp_r}R"
            exit_price = tp_price
            break
        if stopped and not tp_hit:
            exit_reason = "stopped"
            exit_price = stop
            break
        if tp_hit and stopped:
            if fav > adv:
                exit_reason = f"{tp_r}R"
                exit_price = tp_price
            else:
                exit_reason = "stopped"
                exit_price = stop
            break

    if exit_reason == "timeout" and bars_1m:
        exit_price = bars_1m[-1]["close"]

    if new_risk > 0:
        pnl_r = ((entry - exit_price) if side == "short" else (exit_price - entry)) / new_risk
    else:
        pnl_r = 0

    return dict(pnl_r=round(pnl_r, 4), exit_reason=exit_reason,
                mfe_r=round(mfe, 2), mae_r=round(mae, 2),
                hold_bars=j + 1 if bars_1m else 0, new_risk=new_risk)


# ── drawdown calculation ─────────────────────────────────────────────────────

def compute_drawdown(trades: list[dict]) -> dict:
    """Compute equity curve and max drawdown from trade list."""
    equity = 0.0
    peak = 0.0
    max_dd = 0.0
    max_dd_trades = 0
    dd_start = 0
    worst_dd_start = 0
    worst_dd_end = 0
    in_dd = False
    dd_trade_count = 0

    curve = []
    for i, t in enumerate(trades):
        equity += t["pnl_r"]
        curve.append(equity)
        if equity > peak:
            peak = equity
            in_dd = False
            dd_trade_count = 0
        else:
            if not in_dd:
                dd_start = i
                in_dd = True
            dd_trade_count += 1

        dd = peak - equity
        if dd > max_dd:
            max_dd = dd
            max_dd_trades = dd_trade_count
            worst_dd_start = dd_start
            worst_dd_end = i

    return dict(
        final_equity=round(equity, 1),
        peak_equity=round(peak, 1),
        max_dd_r=round(max_dd, 1),
        max_dd_trades=max_dd_trades,
        dd_start_idx=worst_dd_start,
        dd_end_idx=worst_dd_end,
        curve=curve,
    )


def print_dd_summary(label: str, trades: list[dict], dd: dict):
    n = len(trades)
    if n == 0:
        print(f"\n  {label}: no trades")
        return
    wins = sum(1 for t in trades if t["pnl_r"] > 0)
    total_pnl = sum(t["pnl_r"] for t in trades)
    avg_r = total_pnl / n
    win_pnl = sum(t["pnl_r"] for t in trades if t["pnl_r"] > 0)
    loss_pnl = abs(sum(t["pnl_r"] for t in trades if t["pnl_r"] <= 0))
    pf = win_pnl / loss_pnl if loss_pnl > 0 else 999

    print(f"\n  {label}")
    print(f"    Trades: {n}   Wins: {wins} ({wins/n*100:.1f}%)")
    print(f"    Total PnL: {total_pnl:+.1f}R   Avg: {avg_r:+.4f}R   PF: {pf:.2f}")
    print(f"    Max DD: {dd['max_dd_r']:.1f}R over {dd['max_dd_trades']} trades")
    print(f"    Peak equity: {dd['peak_equity']:.1f}R   Final: {dd['final_equity']:.1f}R")
    if dd["max_dd_r"] > 0:
        print(f"    Return/DD ratio: {dd['final_equity'] / dd['max_dd_r']:.2f}")


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Optimized strategy simulation")
    parser.add_argument("--db", default=DB_PATH)
    parser.add_argument("--session-id", default="")
    parser.add_argument("--symbol", default="XRPUSDT")
    parser.add_argument("--lookback-days", type=int, default=7)
    parser.add_argument("--touch-pct", type=float, default=0.10)
    parser.add_argument("--max-hold", type=int, default=120)
    parser.add_argument("--last-n", type=int, default=0)
    parser.add_argument("--output", default="", help="Write results JSON")
    args = parser.parse_args()

    db = os.path.abspath(args.db)
    if not os.path.isfile(db):
        print(f"ERROR: database not found at {db}", file=sys.stderr)
        sys.exit(1)

    symbol = args.symbol.upper()
    session_id = args.session_id
    if not session_id:
        sessions = list_sessions_with_symbol(db, symbol)
        if not sessions:
            print(f"ERROR: no sessions", file=sys.stderr)
            sys.exit(1)
        session_id = sessions[0][0]
        print(f"Session: {session_id} ({sessions[0][1]} 5m bars)", file=sys.stderr)

    cache_file = scanner_cache_path(session_id, symbol, args.lookback_days)
    snapshots = load_scanner_cache(cache_file)
    if snapshots is None:
        print("ERROR: scanner cache missing", file=sys.stderr)
        sys.exit(1)

    if args.last_n > 0:
        snapshots = snapshots[-args.last_n:]

    print(f"Loading candles...", file=sys.stderr)
    candles_5m = load_5m_candles(db, session_id, symbol)
    candles_1m = load_1m_candles(db, session_id, symbol)
    print(f"  {len(candles_5m)} 5m, {len(candles_1m)} 1m", file=sys.stderr)

    # Detect setups with all zone types
    print("Detecting setups...", file=sys.stderr)
    all_setups = []
    skipped = 0
    for snap in snapshots:
        anchor_ms = snap["anchor_ms"]
        anchor_dt = ms_to_et(anchor_ms)
        if anchor_dt.weekday() >= 5:
            skipped += 1
            continue

        overnight_5m = slice_candles(candles_5m, anchor_ms, anchor_ms + OVERNIGHT_MS)
        if len(overnight_5m) < 6:
            continue

        zones = flatten_zones(snap)
        zones = [z for z in zones if z["type"] in ALL_ZONES]
        zones = dedupe_nearby_levels(zones)

        setups = detect_reversals_5m(overnight_5m, zones, touch_pct=args.touch_pct)
        for s in setups:
            s["anchor_date"] = anchor_dt.strftime("%Y-%m-%d")
        all_setups.extend(setups)

    # Filter to strategy rules
    filtered = [s for s in all_setups
                if s["pattern"] in PATTERNS
                and s["side"] == SIDE
                and HOUR_START <= ms_to_et(s["time_ms"]).hour < HOUR_END]
    filtered = one_trade_per_session(filtered)

    print(f"  {len(all_setups)} raw -> {len(filtered)} after filters (1 trade/session)", file=sys.stderr)

    # Pre-slice 1m bars
    print("Pre-slicing 1m bars...", file=sys.stderr)
    bars_per = []
    for s in filtered:
        t0 = s["time_ms"] + 5 * 60_000
        t1 = s["time_ms"] + (args.max_hold + 5) * 60_000
        bars_per.append(slice_candles(candles_1m, t0, t1))
    del candles_1m

    # Simulate all trades
    print("Simulating trades...", file=sys.stderr)
    trades = []
    for i, s in enumerate(filtered):
        tp = TP_MAP[s["pattern"]]
        result = sim_trade(bars_per[i], s["entry_price"], s["stop_price"],
                           s["side"], tp, SL_MULT)
        trades.append({**s, **result})

    # Sort by time for equity curve
    trades.sort(key=lambda t: t["time_ms"])

    # ── Overall results ──────────────────────────────────────────────────
    print("\n" + "=" * 95)
    print("OPTIMIZED STRATEGY — short reversals at liquidity zones, 5-9PM ET")
    print(f"SL=0.5x candle | TP: pin=3.0R eng=2.5R es=3.0R")
    print("=" * 95)

    dd_all = compute_drawdown(trades)
    print_dd_summary("ALL ZONES COMBINED", trades, dd_all)

    # ── Per-zone breakdown with drawdown ─────────────────────────────────
    by_zone = defaultdict(list)
    for t in trades:
        by_zone[t["zone_type"]].append(t)

    zone_results = {}
    for zt in sorted(by_zone.keys()):
        zt_trades = sorted(by_zone[zt], key=lambda t: t["time_ms"])
        dd = compute_drawdown(zt_trades)
        zone_results[zt] = dict(trades=zt_trades, dd=dd)
        print_dd_summary(f"ZONE: {zt}", zt_trades, dd)

    # ── Per-pattern breakdown with drawdown ──────────────────────────────
    by_pat = defaultdict(list)
    for t in trades:
        by_pat[t["pattern"]].append(t)

    for pat in sorted(by_pat.keys()):
        pat_trades = sorted(by_pat[pat], key=lambda t: t["time_ms"])
        dd = compute_drawdown(pat_trades)
        print_dd_summary(f"PATTERN: {pat}", pat_trades, dd)

    # ── Zone exclusion comparison ────────────────────────────────────────
    print("\n" + "=" * 95)
    print("ZONE EXCLUSION ANALYSIS")
    print("=" * 95)

    header = (f"  {'Config':<30} {'N':>5} {'PnL R':>8} {'Avg R':>8} "
              f"{'PF':>6} {'MaxDD':>7} {'Ret/DD':>7}")
    print(header)
    print("  " + "-" * (len(header) - 2))

    zone_list = sorted(ALL_ZONES)
    # All zones
    _print_config_row("all zones", trades)

    # Drop one zone at a time
    for drop in zone_list:
        subset = [t for t in trades if t["zone_type"] != drop]
        subset.sort(key=lambda t: t["time_ms"])
        _print_config_row(f"drop {drop}", subset)

    # Only single zones
    for only in zone_list:
        subset = [t for t in trades if t["zone_type"] == only]
        subset.sort(key=lambda t: t["time_ms"])
        _print_config_row(f"only {only}", subset)

    # Best 2-zone combos
    from itertools import combinations
    for combo in combinations(zone_list, 2):
        subset = [t for t in trades if t["zone_type"] in combo]
        subset.sort(key=lambda t: t["time_ms"])
        _print_config_row(f"only {'+'.join(combo)}", subset)

    # Best 3-zone combos
    for combo in combinations(zone_list, 3):
        subset = [t for t in trades if t["zone_type"] in combo]
        subset.sort(key=lambda t: t["time_ms"])
        _print_config_row(f"only {'+'.join(combo)}", subset)

    # ── Monthly equity ───────────────────────────────────────────────────
    print(f"\n  MONTHLY EQUITY CURVE")
    by_month = defaultdict(list)
    for t in trades:
        mo = ms_to_et(t["time_ms"]).strftime("%Y-%m")
        by_month[mo].append(t)

    cum = 0.0
    print(f"  {'Month':<10} {'Trades':>6} {'PnL R':>8} {'Cum R':>8} {'Win%':>6}")
    print("  " + "-" * 42)
    for mo in sorted(by_month.keys()):
        mo_trades = by_month[mo]
        mo_pnl = sum(t["pnl_r"] for t in mo_trades)
        cum += mo_pnl
        mo_wins = sum(1 for t in mo_trades if t["pnl_r"] > 0)
        print(f"  {mo:<10} {len(mo_trades):>6} {mo_pnl:>+7.1f}R {cum:>+7.1f}R "
              f"{mo_wins/len(mo_trades)*100:>5.1f}%")

    if args.output:
        with open(args.output, "w") as f:
            json.dump(dict(
                symbol=symbol, session_id=session_id,
                config=dict(sl_mult=SL_MULT, tp_map=TP_MAP,
                            zones=sorted(ALL_ZONES), side=SIDE,
                            hours=f"{HOUR_START}-{HOUR_END}"),
                total_trades=len(trades),
                equity_curve=dd_all["curve"],
                max_dd_r=dd_all["max_dd_r"],
                final_equity=dd_all["final_equity"],
                trades=[{k: v for k, v in t.items() if k != "candle_idx"}
                        for t in trades],
            ), f, indent=2)
        print(f"\nResults written to {args.output}", file=sys.stderr)


def _print_config_row(label: str, trades: list[dict]):
    n = len(trades)
    if n == 0:
        print(f"  {label:<30} {'—':>5}")
        return
    total = sum(t["pnl_r"] for t in trades)
    avg = total / n
    wp = sum(t["pnl_r"] for t in trades if t["pnl_r"] > 0)
    lp = abs(sum(t["pnl_r"] for t in trades if t["pnl_r"] <= 0))
    pf = wp / lp if lp > 0 else 999
    dd = compute_drawdown(trades)
    ret_dd = dd["final_equity"] / dd["max_dd_r"] if dd["max_dd_r"] > 0 else 999
    print(f"  {label:<30} {n:>5} {total:>+7.1f}R {avg:>+7.4f}R "
          f"{pf:>5.2f} {dd['max_dd_r']:>6.1f}R {ret_dd:>6.2f}")


if __name__ == "__main__":
    main()
