#!/usr/bin/env python3
"""
Reversal study — for each daily 5 PM liquidity-zone snapshot, walks the overnight
5m candles (5 PM → 8 AM ET) looking for reversal setups at zone levels using
candle-pattern recognition.

Detected patterns (on 5m timeframe):
  - engulfing:     reversal candle body fully engulfs previous candle body
  - pin_bar:       long wick into zone (>60% of range), small body closing away
  - morning_star:  3-bar (bearish → doji/small → bullish) at support
  - evening_star:  3-bar (bullish → doji/small → bearish) at resistance
  - strong_reversal: big-body reversal after approach candles (original pattern)

Outcome tracking uses 1m candles for precise R-multiple measurement.

Usage:
    python sandbox/reversal_study.py [--symbol XRPUSDT] [--last-n 30]
"""

import argparse
import json
import math
import os
import sqlite3
import sys
from collections import defaultdict
from zoneinfo import ZoneInfo
from datetime import datetime, timezone

ET = ZoneInfo("America/New_York")
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "backtester", "data", "backtest.sqlite")

# ── reuse scanner math from liquidity_zones.py ───────────────────────────────

from liquidity_zones import (
    load_5m_candles,
    list_sessions_with_symbol,
    run_scanner,
    ms_to_et,
    et_day_key,
    scanner_cache_path,
    save_scanner_cache,
    load_scanner_cache,
)

# ── data loading ──────────────────────────────────────────────────────────────

def load_1m_candles(db_path: str, session_id: str, symbol: str) -> list[dict]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.execute(
        """
        SELECT bucket_start_ms, open, high, low, close, volume
        FROM session_candles
        WHERE session_id = ? AND symbol = ? AND timeframe = '1m'
        ORDER BY bucket_start_ms
        """,
        (session_id, symbol),
    )
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def slice_candles(sorted_candles: list[dict], from_ms: int, to_ms: int) -> list[dict]:
    """Binary-search slice of sorted candles for [from_ms, to_ms]."""
    lo, hi = 0, len(sorted_candles)
    while lo < hi:
        mid = (lo + hi) // 2
        if sorted_candles[mid]["bucket_start_ms"] < from_ms:
            lo = mid + 1
        else:
            hi = mid
    start = lo
    lo, hi = start, len(sorted_candles)
    while lo < hi:
        mid = (lo + hi) // 2
        if sorted_candles[mid]["bucket_start_ms"] <= to_ms:
            lo = mid + 1
        else:
            hi = mid
    return sorted_candles[start:lo]

# ── flatten zones into a list of price levels ────────────────────────────────

def flatten_zones(snapshot: dict) -> list[dict]:
    """Extract all zone levels from a scanner snapshot."""
    levels = []
    pdh = snapshot.get("previous_day_high")
    pdl = snapshot.get("previous_day_low")
    wh = snapshot.get("week_high")
    wl = snapshot.get("week_low")

    if pdh:
        levels.append(dict(type="pdh", price=pdh, bias="resistance"))
    if pdl:
        levels.append(dict(type="pdl", price=pdl, bias="support"))
    if wh:
        levels.append(dict(type="week_high", price=wh, bias="resistance"))
    if wl:
        levels.append(dict(type="week_low", price=wl, bias="support"))

    for hvn in snapshot.get("high_volume_nodes", []):
        levels.append(dict(type="hvn", price=hvn["price_mid"], bias="neutral",
                           range_low=hvn["price_low"], range_high=hvn["price_high"]))

    for sh in snapshot.get("swing_highs", []):
        levels.append(dict(type="swing_high", price=sh["price"], bias="resistance"))
    for sl in snapshot.get("swing_lows", []):
        levels.append(dict(type="swing_low", price=sl["price"], bias="support"))

    return levels


def dedupe_nearby_levels(levels: list[dict], pct_threshold: float = 0.15) -> list[dict]:
    """Merge zone levels that are within pct_threshold% of each other."""
    if not levels:
        return []
    sorted_lvls = sorted(levels, key=lambda l: l["price"])
    out = [sorted_lvls[0]]
    for lvl in sorted_lvls[1:]:
        if out[-1]["price"] > 0 and abs(lvl["price"] - out[-1]["price"]) / out[-1]["price"] * 100 < pct_threshold:
            if lvl["type"] in ("pdh", "pdl", "week_high", "week_low"):
                out[-1] = lvl
            continue
        out.append(lvl)
    return out

# ── candle helpers ────────────────────────────────────────────────────────────

def candle_body(c: dict) -> float:
    return abs(c["close"] - c["open"])


def candle_range(c: dict) -> float:
    return c["high"] - c["low"]


def candle_direction(c: dict) -> str:
    if c["close"] > c["open"]:
        return "bullish"
    if c["close"] < c["open"]:
        return "bearish"
    return "doji"


def upper_wick(c: dict) -> float:
    return c["high"] - max(c["open"], c["close"])


def lower_wick(c: dict) -> float:
    return min(c["open"], c["close"]) - c["low"]


# ── 5m pattern detectors ─────────────────────────────────────────────────────
# Each returns (pattern_name, entry_price, stop_price, side) or None.

def detect_engulfing(candles: list[dict], i: int, zone: dict, threshold: float) -> dict | None:
    """Bullish or bearish engulfing at a zone."""
    if i < 1:
        return None
    prev, curr = candles[i - 1], candles[i]
    zp = zone["price"]

    curr_body = candle_body(curr)
    prev_body = candle_body(prev)
    if prev_body == 0 or curr_body <= prev_body:
        return None

    curr_dir = candle_direction(curr)
    prev_dir = candle_direction(prev)
    if curr_dir == "doji" or prev_dir == "doji":
        return None
    if curr_dir == prev_dir:
        return None

    body_engulfs = (
        min(curr["open"], curr["close"]) <= min(prev["open"], prev["close"]) and
        max(curr["open"], curr["close"]) >= max(prev["open"], prev["close"])
    )
    if not body_engulfs:
        return None

    if curr_dir == "bullish" and prev["low"] <= zp + threshold:
        return dict(pattern="engulfing", side="long",
                    entry=curr["close"], stop=min(prev["low"], curr["low"]))
    if curr_dir == "bearish" and prev["high"] >= zp - threshold:
        return dict(pattern="engulfing", side="short",
                    entry=curr["close"], stop=max(prev["high"], curr["high"]))
    return None


def detect_pin_bar(candles: list[dict], i: int, zone: dict, threshold: float,
                   wick_ratio: float = 0.60, body_ratio: float = 0.33) -> dict | None:
    """Hammer (at support) or shooting star (at resistance)."""
    c = candles[i]
    zp = zone["price"]
    rng = candle_range(c)
    if rng == 0:
        return None
    body = candle_body(c)
    if body / rng > body_ratio:
        return None

    lw = lower_wick(c)
    uw = upper_wick(c)

    if lw / rng >= wick_ratio and c["low"] <= zp + threshold:
        return dict(pattern="pin_bar", side="long",
                    entry=c["close"], stop=c["low"])
    if uw / rng >= wick_ratio and c["high"] >= zp - threshold:
        return dict(pattern="pin_bar", side="short",
                    entry=c["close"], stop=c["high"])
    return None


def detect_morning_star(candles: list[dict], i: int, zone: dict, threshold: float,
                        small_body_ratio: float = 0.30) -> dict | None:
    """Morning star (3-bar bullish reversal) at support."""
    if i < 2:
        return None
    first, middle, third = candles[i - 2], candles[i - 1], candles[i]
    zp = zone["price"]

    if candle_direction(first) != "bearish":
        return None
    if candle_direction(third) != "bullish":
        return None

    first_body = candle_body(first)
    mid_body = candle_body(middle)
    third_body = candle_body(third)

    if first_body == 0 or mid_body > first_body * small_body_ratio:
        return None
    if third_body < first_body * 0.5:
        return None

    if middle["low"] > zp + threshold:
        return None

    return dict(pattern="morning_star", side="long",
                entry=third["close"], stop=min(first["low"], middle["low"], third["low"]))


def detect_evening_star(candles: list[dict], i: int, zone: dict, threshold: float,
                        small_body_ratio: float = 0.30) -> dict | None:
    """Evening star (3-bar bearish reversal) at resistance."""
    if i < 2:
        return None
    first, middle, third = candles[i - 2], candles[i - 1], candles[i]
    zp = zone["price"]

    if candle_direction(first) != "bullish":
        return None
    if candle_direction(third) != "bearish":
        return None

    first_body = candle_body(first)
    mid_body = candle_body(middle)
    third_body = candle_body(third)

    if first_body == 0 or mid_body > first_body * small_body_ratio:
        return None
    if third_body < first_body * 0.5:
        return None

    if middle["high"] < zp - threshold:
        return None

    return dict(pattern="evening_star", side="short",
                entry=third["close"], stop=max(first["high"], middle["high"], third["high"]))


def detect_strong_reversal(candles: list[dict], i: int, zone: dict, threshold: float,
                           min_approach: int = 2, body_multiplier: float = 1.5,
                           min_body_pct: float = 0.04) -> dict | None:
    """Original pattern: trending approach candles then a big body reversal."""
    if i < min_approach:
        return None
    c = candles[i]
    zp = zone["price"]

    is_resistance = c["high"] >= zp - threshold and c["close"] < zp
    is_support = c["low"] <= zp + threshold and c["close"] > zp
    if not is_resistance and not is_support:
        return None

    approach_dir = "bullish" if is_resistance else "bearish"
    reversal_dir = "bearish" if is_resistance else "bullish"

    approach = candles[i - min_approach: i]
    for ac in approach:
        d = candle_direction(ac)
        if d != approach_dir and d != "doji":
            return None

    if candle_direction(c) != reversal_dir:
        return None

    rev_body = candle_body(c)
    avg_body = sum(candle_body(ac) for ac in approach) / len(approach) if approach else 0
    if avg_body > 0 and rev_body < avg_body * body_multiplier:
        return None
    if rev_body < zp * (min_body_pct / 100):
        return None

    side = "short" if is_resistance else "long"
    stop = c["high"] if side == "short" else c["low"]
    return dict(pattern="strong_reversal", side=side, entry=c["close"], stop=stop)


# ── main detection loop (5m candles) ─────────────────────────────────────────

PATTERN_DETECTORS = [
    detect_engulfing,
    detect_pin_bar,
    detect_morning_star,
    detect_evening_star,
    detect_strong_reversal,
]


def detect_reversals_5m(
    candles_5m: list[dict],
    zones: list[dict],
    touch_pct: float = 0.10,
) -> list[dict]:
    """
    Walk 5m candles and detect reversal setups at zone levels using candle patterns.
    Returns one setup per candle (first matching pattern wins).
    """
    setups = []
    if len(candles_5m) < 4 or not zones:
        return setups

    used_times: set[int] = set()

    for i in range(2, len(candles_5m)):
        ts = candles_5m[i]["bucket_start_ms"]
        if ts in used_times:
            continue

        for zone in zones:
            zp = zone["price"]
            threshold = zp * (touch_pct / 100)

            for detector in PATTERN_DETECTORS:
                result = detector(candles_5m, i, zone, threshold)
                if result is None:
                    continue

                entry_price = result["entry"]
                stop_price = result["stop"]
                side = result["side"]
                risk = abs(entry_price - stop_price)
                if risk <= 0:
                    continue

                setups.append(dict(
                    candle_idx=i,
                    time_ms=ts,
                    time_et=ms_to_et(ts).strftime("%Y-%m-%d %H:%M"),
                    pattern=result["pattern"],
                    side=side,
                    zone_type=zone["type"],
                    zone_price=zp,
                    entry_price=entry_price,
                    stop_price=stop_price,
                    risk=risk,
                ))
                used_times.add(ts)
                break  # first matching pattern wins for this zone
            if ts in used_times:
                break  # one setup per candle

    return setups

# ── outcome tracking (1m candles for precision) ──────────────────────────────

def track_outcomes(
    sorted_1m: list[dict],
    setups: list[dict],
    max_hold_minutes: int = 120,
) -> list[dict]:
    """
    After each 5m reversal setup, slice the 1m candles from entry time forward
    and track if price reaches 1R, 2R, 3R or gets stopped.
    """
    results = []
    for setup in setups:
        entry = setup["entry_price"]
        stop = setup["stop_price"]
        risk = setup["risk"]
        side = setup["side"]
        entry_ms = setup["time_ms"]

        hold_from_ms = entry_ms + 5 * 60_000  # next bar after entry candle close
        hold_to_ms = entry_ms + (max_hold_minutes + 5) * 60_000
        bars_1m = slice_candles(sorted_1m, hold_from_ms, hold_to_ms)

        target_1r = entry - risk if side == "short" else entry + risk
        target_2r = entry - 2 * risk if side == "short" else entry + 2 * risk
        target_3r = entry - 3 * risk if side == "short" else entry + 3 * risk

        hit_1r = False
        hit_2r = False
        hit_3r = False
        hit_stop = False
        mfe = 0.0
        mae = 0.0
        exit_reason = "timeout"
        exit_price = entry
        hold_bars = 0

        for j, bar in enumerate(bars_1m):
            hold_bars = j + 1

            if side == "short":
                favorable = entry - bar["low"]
                adverse = bar["high"] - entry
                stopped = bar["high"] >= stop
                r1_hit = bar["low"] <= target_1r
                r2_hit = bar["low"] <= target_2r
                r3_hit = bar["low"] <= target_3r
            else:
                favorable = bar["high"] - entry
                adverse = entry - bar["low"]
                stopped = bar["low"] <= stop
                r1_hit = bar["high"] >= target_1r
                r2_hit = bar["high"] >= target_2r
                r3_hit = bar["high"] >= target_3r

            if risk > 0:
                mfe = max(mfe, favorable / risk)
                mae = max(mae, adverse / risk)

            if r1_hit:
                hit_1r = True
            if r2_hit:
                hit_2r = True
            if r3_hit:
                hit_3r = True
                exit_reason = "3R"
                exit_price = target_3r
                break

            if stopped:
                hit_stop = True
                exit_reason = "stopped"
                exit_price = stop
                break

        if exit_reason == "timeout" and bars_1m:
            exit_price = bars_1m[-1]["close"]

        pnl_r = 0.0
        if risk > 0:
            if side == "short":
                pnl_r = (entry - exit_price) / risk
            else:
                pnl_r = (exit_price - entry) / risk

        results.append({
            **setup,
            "hit_1r": hit_1r,
            "hit_2r": hit_2r,
            "hit_3r": hit_3r,
            "hit_stop": hit_stop,
            "mfe_r": round(mfe, 2),
            "mae_r": round(mae, 2),
            "pnl_r": round(pnl_r, 2),
            "exit_reason": exit_reason,
            "hold_bars_1m": hold_bars,
        })

    return results

# ── reporting ─────────────────────────────────────────────────────────────────

def _breakdown_table(label: str, groups: dict[str, list[dict]]):
    """Print a breakdown table for any grouping key."""
    print(f"\n{'  ' + label:<18} {'Count':>6} {'1R%':>6} {'2R%':>6} {'3R%':>6} {'Stop%':>6} {'Avg R':>7} {'Tot R':>8}")
    print("-" * 68)
    for key in sorted(groups.keys()):
        group = groups[key]
        n = len(group)
        r1 = sum(1 for r in group if r["hit_1r"]) / n * 100
        r2 = sum(1 for r in group if r["hit_2r"]) / n * 100
        r3 = sum(1 for r in group if r["hit_3r"]) / n * 100
        st = sum(1 for r in group if r["hit_stop"]) / n * 100
        avg = sum(r["pnl_r"] for r in group) / n
        tot = sum(r["pnl_r"] for r in group)
        print(f"  {key:<16} {n:>6} {r1:>5.1f}% {r2:>5.1f}% {r3:>5.1f}% {st:>5.1f}% {avg:>+6.2f}R {tot:>+7.1f}R")


def print_summary(results: list[dict]):
    if not results:
        print("\nNo reversal setups found.")
        return

    total = len(results)
    wins_1r = sum(1 for r in results if r["hit_1r"])
    wins_2r = sum(1 for r in results if r["hit_2r"])
    wins_3r = sum(1 for r in results if r["hit_3r"])
    stopped = sum(1 for r in results if r["hit_stop"])
    total_pnl_r = sum(r["pnl_r"] for r in results)
    avg_mfe = sum(r["mfe_r"] for r in results) / total
    avg_mae = sum(r["mae_r"] for r in results) / total
    avg_hold = sum(r["hold_bars_1m"] for r in results) / total

    longs = [r for r in results if r["side"] == "long"]
    shorts = [r for r in results if r["side"] == "short"]

    print("\n" + "=" * 70)
    print("REVERSAL STUDY — 5m PATTERN ENTRY, 1m OUTCOME TRACKING")
    print("=" * 70)

    print(f"\nTotal setups:       {total}")
    print(f"  Long:             {len(longs)}")
    print(f"  Short:            {len(shorts)}")
    print(f"\nHit 1R:             {wins_1r}/{total}  ({wins_1r/total*100:.1f}%)")
    print(f"Hit 2R:             {wins_2r}/{total}  ({wins_2r/total*100:.1f}%)")
    print(f"Hit 3R:             {wins_3r}/{total}  ({wins_3r/total*100:.1f}%)")
    print(f"Stopped out:        {stopped}/{total}  ({stopped/total*100:.1f}%)")
    print(f"\nTotal PnL (R):      {total_pnl_r:+.1f}R")
    print(f"Avg PnL (R):        {total_pnl_r/total:+.2f}R")
    print(f"Avg MFE:            {avg_mfe:.2f}R")
    print(f"Avg MAE:            {avg_mae:.2f}R")
    print(f"Avg hold (1m bars): {avg_hold:.0f}")

    # breakdown by pattern
    by_pattern = defaultdict(list)
    for r in results:
        by_pattern[r["pattern"]].append(r)
    _breakdown_table("Pattern", by_pattern)

    # breakdown by zone type
    by_type = defaultdict(list)
    for r in results:
        by_type[r["zone_type"]].append(r)
    _breakdown_table("Zone Type", by_type)

    # breakdown by side
    by_side = defaultdict(list)
    for r in results:
        by_side[r["side"]].append(r)
    _breakdown_table("Side", by_side)

    # cross: pattern × side
    by_pattern_side = defaultdict(list)
    for r in results:
        by_pattern_side[f"{r['pattern']}_{r['side']}"].append(r)
    _breakdown_table("Pattern × Side", by_pattern_side)

    # sample trades
    print(f"\n--- Last 10 setups ---")
    print(f"{'Time ET':<18} {'Pattern':<16} {'Side':<6} {'Zone':<12} {'Zone$':>8} {'Entry':>8} {'PnL R':>7} {'Exit':>8}")
    print("-" * 95)
    for r in results[-10:]:
        print(
            f"{r['time_et']:<18} {r['pattern']:<16} {r['side']:<6} {r['zone_type']:<12} "
            f"{r['zone_price']:>8.4f} {r['entry_price']:>8.4f} "
            f"{r['pnl_r']:>+6.2f}R {r['exit_reason']:>8}"
        )

# ── main ──────────────────────────────────────────────────────────────────────

OVERNIGHT_MS = 15 * 3600 * 1000  # 5 PM → 8 AM = 15 hours

def main():
    parser = argparse.ArgumentParser(
        description="Reversal study — 5m candle pattern entry, 1m outcome tracking")
    parser.add_argument("--db", default=DB_PATH)
    parser.add_argument("--session-id", default="")
    parser.add_argument("--symbol", default="XRPUSDT")
    parser.add_argument("--lookback-days", type=int, default=7)
    parser.add_argument("--touch-pct", type=float, default=0.10,
                        help="Zone proximity threshold (%%)")
    parser.add_argument("--max-hold", type=int, default=120,
                        help="Max minutes to hold after entry (1m bars)")
    parser.add_argument("--last-n", type=int, default=0,
                        help="Only process last N daily snapshots (0=all)")
    parser.add_argument("--output", default="", help="Write full results JSON to file")
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
            print(f"ERROR: no historical sessions with {symbol} 5m data", file=sys.stderr)
            sys.exit(1)
        session_id = sessions[0][0]
        print(f"Session: {session_id} ({sessions[0][1]} 5m bars)", file=sys.stderr)

    # Load scanner snapshots (from cache or compute fresh)
    cache_file = scanner_cache_path(session_id, symbol, args.lookback_days)
    snapshots = load_scanner_cache(cache_file)
    if snapshots is None:
        print(f"Loading {symbol} 5m candles for scanner...", file=sys.stderr)
        candles_5m_all = load_5m_candles(db, session_id, symbol)
        print(f"  {len(candles_5m_all)} 5m bars", file=sys.stderr)

        print("Computing liquidity zones...", file=sys.stderr)
        snapshots = run_scanner(candles_5m_all, lookback_days=args.lookback_days)
        print(f"  {len(snapshots)} daily snapshots", file=sys.stderr)
        save_scanner_cache(cache_file, session_id, symbol, snapshots)

    if args.last_n > 0:
        snapshots = snapshots[-args.last_n:]
        print(f"  Using last {len(snapshots)} snapshots", file=sys.stderr)

    # Load 5m candles for pattern detection
    print(f"Loading {symbol} 5m candles...", file=sys.stderr)
    candles_5m = load_5m_candles(db, session_id, symbol)
    print(f"  {len(candles_5m)} 5m bars", file=sys.stderr)

    # Load 1m candles for outcome tracking
    print(f"Loading {symbol} 1m candles...", file=sys.stderr)
    candles_1m = load_1m_candles(db, session_id, symbol)
    print(f"  {len(candles_1m)} 1m bars", file=sys.stderr)

    # Process each overnight session (skip weekends)
    all_results = []
    skipped_weekends = 0
    for snap in snapshots:
        anchor_ms = snap["anchor_ms"]
        anchor_dt = ms_to_et(anchor_ms)
        if anchor_dt.weekday() >= 5:
            skipped_weekends += 1
            continue

        overnight_5m = slice_candles(candles_5m, anchor_ms, anchor_ms + OVERNIGHT_MS)
        if len(overnight_5m) < 6:
            continue

        zones = flatten_zones(snap)
        zones = dedupe_nearby_levels(zones)

        setups = detect_reversals_5m(
            overnight_5m, zones,
            touch_pct=args.touch_pct,
        )

        tracked = track_outcomes(candles_1m, setups, max_hold_minutes=args.max_hold)
        all_results.extend(tracked)

    if skipped_weekends:
        print(f"  Skipped {skipped_weekends} weekend snapshots", file=sys.stderr)
    weekday_count = len(snapshots) - skipped_weekends
    print(f"\nFound {len(all_results)} reversal setups across {weekday_count} weekday sessions", file=sys.stderr)
    print_summary(all_results)

    if args.output:
        with open(args.output, "w") as f:
            json.dump(dict(
                symbol=symbol,
                session_id=session_id,
                params=dict(
                    touch_pct=args.touch_pct,
                    max_hold_minutes=args.max_hold,
                    lookback_days=args.lookback_days,
                ),
                total_setups=len(all_results),
                results=all_results,
            ), f, indent=2)
        print(f"\nFull results written to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
