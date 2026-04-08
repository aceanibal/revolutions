#!/usr/bin/env python3
"""
Entry filter study — takes the raw 5m reversal setups and tests which filters
produce a real edge.

Filters tested:
  1. Zone bias alignment (only short at resistance, long at support)
  2. Best pattern×zone×side combos from earlier analysis
  3. Time-of-day windows (early overnight, late overnight, pre-market)
  4. Volume on signal candle (above-average volume)
  5. Combined filters stacked together

Usage:
    python sandbox/entry_filter_study.py [--symbol XRPUSDT]
"""

import argparse
import json
import os
import sys
import time as _time
from collections import defaultdict
from zoneinfo import ZoneInfo

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
KEEP_ZONES = {"week_low", "week_high", "pdh", "hvn"}

# ── volume helpers ───────────────────────────────────────────────────────────

class VolumeLookup:
    """Pre-sorted volume SMA for fast O(log n) lookups."""

    def __init__(self, candles_5m: list[dict], period: int = 20):
        self._keys: list[int] = []
        self._vals: list[float] = []
        self._raw: dict[int, float] = {c["bucket_start_ms"]: c["volume"]
                                        for c in candles_5m}
        if len(candles_5m) < period:
            return
        window_sum = sum(c["volume"] for c in candles_5m[:period])
        self._keys.append(candles_5m[period - 1]["bucket_start_ms"])
        self._vals.append(window_sum / period)
        for i in range(period, len(candles_5m)):
            window_sum += candles_5m[i]["volume"] - candles_5m[i - period]["volume"]
            self._keys.append(candles_5m[i]["bucket_start_ms"])
            self._vals.append(window_sum / period)

    def sma_at(self, ts: int) -> float | None:
        keys = self._keys
        if not keys:
            return None
        lo, hi = 0, len(keys)
        while lo < hi:
            mid = (lo + hi) // 2
            if keys[mid] <= ts:
                lo = mid + 1
            else:
                hi = mid
        if lo == 0:
            return None
        return self._vals[lo - 1]

    def raw_vol(self, ts: int) -> float:
        return self._raw.get(ts, 0.0)


# ── outcome sim (same as stop_loss_study, operates on pre-sliced bars) ───────

def sim_outcome(bars_1m: list[dict], entry: float, stop: float, side: str) -> dict:
    risk = abs(entry - stop)
    if risk <= 0 or not bars_1m:
        return dict(pnl_r=0, hit_1r=False, hit_2r=False, hit_3r=False,
                    hit_stop=False, exit_reason="no_risk", mfe_r=0, mae_r=0,
                    hold_bars=0)

    is_short = side == "short"
    t1 = entry - risk if is_short else entry + risk
    t2 = entry - 2 * risk if is_short else entry + 2 * risk
    t3 = entry - 3 * risk if is_short else entry + 3 * risk

    hit_1r = hit_2r = hit_3r = hit_stop = False
    mfe = mae = 0.0
    exit_reason = "timeout"
    exit_price = entry

    for j, bar in enumerate(bars_1m):
        bh, bl = bar["high"], bar["low"]
        if is_short:
            fav, adv = entry - bl, bh - entry
            stopped = bh >= stop
            r1, r2, r3 = bl <= t1, bl <= t2, bl <= t3
        else:
            fav, adv = bh - entry, entry - bl
            stopped = bl <= stop
            r1, r2, r3 = bh >= t1, bh >= t2, bh >= t3

        mfe = max(mfe, fav / risk)
        mae = max(mae, adv / risk)
        if r1: hit_1r = True
        if r2: hit_2r = True
        if r3:
            hit_3r = True
            exit_reason = "3R"
            exit_price = t3
            break
        if stopped:
            hit_stop = True
            exit_reason = "stopped"
            exit_price = stop
            break

    if exit_reason == "timeout" and bars_1m:
        exit_price = bars_1m[-1]["close"]

    pnl_r = ((entry - exit_price) if is_short else (exit_price - entry)) / risk

    return dict(pnl_r=round(pnl_r, 3), hit_1r=hit_1r, hit_2r=hit_2r,
                hit_3r=hit_3r, hit_stop=hit_stop, exit_reason=exit_reason,
                mfe_r=round(mfe, 2), mae_r=round(mae, 2), hold_bars=j + 1 if bars_1m else 0)


# ── filters ──────────────────────────────────────────────────────────────────

def filter_bias_aligned(setup: dict) -> bool:
    """Only take shorts at resistance zones, longs at support zones."""
    bias = setup.get("zone_bias", "neutral")
    side = setup["side"]
    if bias == "resistance" and side == "short":
        return True
    if bias == "support" and side == "long":
        return True
    if bias == "neutral":
        return True
    return False


def filter_best_combos(setup: dict) -> bool:
    """Only the combos that showed edge in the full study."""
    p = setup["pattern"]
    z = setup["zone_type"]
    s = setup["side"]
    if p == "engulfing" and s == "short":
        return True
    if z in ("pdh", "week_high") and s == "short":
        return True
    if z == "week_low" and s == "long":
        return True
    return False


def make_time_filter(start_h: int, end_h: int):
    """Only setups within a time-of-day window (ET hours, wraps midnight)."""
    def _filter(setup: dict) -> bool:
        dt = ms_to_et(setup["time_ms"])
        h = dt.hour
        if start_h <= end_h:
            return start_h <= h < end_h
        return h >= start_h or h < end_h
    return _filter


def make_volume_filter(vol: VolumeLookup, mult: float = 1.0):
    """Only setups where signal candle volume >= mult × SMA volume."""
    def _filter(setup: dict) -> bool:
        ts = setup["time_ms"]
        avg = vol.sma_at(ts)
        actual = vol.raw_vol(ts)
        if avg is None or avg == 0:
            return False
        return actual >= mult * avg
    return _filter


# ── run filters ──────────────────────────────────────────────────────────────

def summarise(label: str, outs: list[dict]) -> dict:
    n = len(outs)
    if n == 0:
        return dict(label=label, n=0, pnl_r=0, avg_r=0, r1_pct=0, r2_pct=0,
                    r3_pct=0, stop_pct=0, avg_mfe=0, avg_mae=0, pf=0, avg_hold=0)
    total = sum(o["pnl_r"] for o in outs)
    wins = sum(o["pnl_r"] for o in outs if o["pnl_r"] > 0)
    losses = abs(sum(o["pnl_r"] for o in outs if o["pnl_r"] <= 0))
    return dict(
        label=label, n=n,
        pnl_r=round(total, 1),
        avg_r=round(total / n, 4),
        r1_pct=round(sum(1 for o in outs if o["hit_1r"]) / n * 100, 1),
        r2_pct=round(sum(1 for o in outs if o["hit_2r"]) / n * 100, 1),
        r3_pct=round(sum(1 for o in outs if o["hit_3r"]) / n * 100, 1),
        stop_pct=round(sum(1 for o in outs if o["hit_stop"]) / n * 100, 1),
        avg_mfe=round(sum(o["mfe_r"] for o in outs) / n, 2),
        avg_mae=round(sum(o["mae_r"] for o in outs) / n, 2),
        pf=round(wins / losses, 3) if losses > 0 else 999.0,
        avg_hold=round(sum(o["hold_bars"] for o in outs) / n, 0),
    )


def print_table(rows: list[dict]):
    header = (f"  {'Filter':<35} {'N':>6} {'PnL R':>8} {'Avg R':>8} "
              f"{'1R%':>6} {'2R%':>6} {'3R%':>6} {'Stop%':>6} "
              f"{'PF':>6} {'MFE':>5} {'MAE':>5} {'Hold':>5}")
    print(header)
    print("  " + "-" * (len(header) - 2))
    for r in rows:
        if r["n"] == 0:
            print(f"  {r['label']:<35} {'—':>6}")
            continue
        print(f"  {r['label']:<35} {r['n']:>6} {r['pnl_r']:>+7.1f}R {r['avg_r']:>+7.4f}R "
              f"{r['r1_pct']:>5.1f}% {r['r2_pct']:>5.1f}% {r['r3_pct']:>5.1f}% "
              f"{r['stop_pct']:>5.1f}% {r['pf']:>5.2f} "
              f"{r['avg_mfe']:>5.2f} {r['avg_mae']:>5.2f} {r['avg_hold']:>5.0f}")


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Entry filter study")
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
            print(f"ERROR: no sessions with {symbol} 5m data", file=sys.stderr)
            sys.exit(1)
        session_id = sessions[0][0]
        print(f"Session: {session_id} ({sessions[0][1]} 5m bars)", file=sys.stderr)

    cache_file = scanner_cache_path(session_id, symbol, args.lookback_days)
    snapshots = load_scanner_cache(cache_file)
    if snapshots is None:
        print("ERROR: scanner cache missing — run reversal_study.py first", file=sys.stderr)
        sys.exit(1)

    if args.last_n > 0:
        snapshots = snapshots[-args.last_n:]
        print(f"  Using last {len(snapshots)} snapshots", file=sys.stderr)

    print(f"Loading {symbol} 5m candles...", file=sys.stderr)
    candles_5m = load_5m_candles(db, session_id, symbol)
    print(f"  {len(candles_5m)} 5m bars", file=sys.stderr)

    print(f"Loading {symbol} 1m candles...", file=sys.stderr)
    candles_1m = load_1m_candles(db, session_id, symbol)
    print(f"  {len(candles_1m)} 1m bars", file=sys.stderr)

    # Volume lookup (pre-sorted for fast binary search)
    print("Computing volume SMA...", file=sys.stderr)
    vol = VolumeLookup(candles_5m, period=20)

    # Detect setups
    print("Detecting setups (no swings, no pdl)...", file=sys.stderr)
    all_setups = []
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
        zones = [z for z in zones if z["type"] in KEEP_ZONES]
        zones = dedupe_nearby_levels(zones)

        setups = detect_reversals_5m(overnight_5m, zones, touch_pct=args.touch_pct)
        for s in setups:
            matching = [z for z in zones if z["type"] == s["zone_type"]
                        and abs(z["price"] - s["zone_price"]) < 1e-8]
            s["zone_bias"] = matching[0]["bias"] if matching else "neutral"
        all_setups.extend(setups)

    if skipped_weekends:
        print(f"  Skipped {skipped_weekends} weekend snapshots", file=sys.stderr)
    print(f"  {len(all_setups)} total setups", file=sys.stderr)

    # Pre-slice 1m bars
    t0 = _time.time()
    print("Pre-slicing 1m bars...", file=sys.stderr)
    bars_per = []
    for s in all_setups:
        t_from = s["time_ms"] + 5 * 60_000
        t_to = s["time_ms"] + (args.max_hold + 5) * 60_000
        bars_per.append(slice_candles(candles_1m, t_from, t_to))
    del candles_1m
    print(f"  done ({_time.time()-t0:.1f}s)", file=sys.stderr)

    # Simulate all setups once
    print("Simulating outcomes...", file=sys.stderr)
    all_outcomes = [sim_outcome(bars_per[i], s["entry_price"], s["stop_price"], s["side"])
                    for i, s in enumerate(all_setups)]
    print(f"  done", file=sys.stderr)

    # Build filters
    vol_1x = make_volume_filter(vol, 1.0)
    vol_1_5x = make_volume_filter(vol, 1.5)
    vol_2x = make_volume_filter(vol, 2.0)

    time_early = make_time_filter(17, 21)     # 5 PM – 9 PM
    time_late = make_time_filter(21, 1)       # 9 PM – 1 AM
    time_premarket = make_time_filter(4, 8)   # 4 AM – 8 AM

    filters: list[tuple[str, callable]] = [
        ("ALL (baseline)", lambda s: True),

        # -- Direction alignment --
        ("bias_aligned", filter_bias_aligned),
        ("bias_aligned + engulfing", lambda s: filter_bias_aligned(s) and s["pattern"] == "engulfing"),
        ("bias_aligned + pin_bar", lambda s: filter_bias_aligned(s) and s["pattern"] == "pin_bar"),

        # -- Best combos --
        ("best_combos", filter_best_combos),
        ("best_combos + bias_aligned", lambda s: filter_best_combos(s) and filter_bias_aligned(s)),

        # -- Specific high-edge combos --
        ("engulfing_short (any zone)", lambda s: s["pattern"] == "engulfing" and s["side"] == "short"),
        ("short @ pdh/week_high", lambda s: s["zone_type"] in ("pdh", "week_high") and s["side"] == "short"),
        ("long @ week_low", lambda s: s["zone_type"] == "week_low" and s["side"] == "long"),
        ("short @ week_low", lambda s: s["zone_type"] == "week_low" and s["side"] == "short"),
        ("any @ hvn", lambda s: s["zone_type"] == "hvn"),

        # -- Time of day --
        ("5PM–9PM (early)", time_early),
        ("9PM–1AM (late)", time_late),
        ("4AM–8AM (pre-mkt)", time_premarket),
        ("best_combos + 5PM–9PM", lambda s: filter_best_combos(s) and time_early(s)),
        ("best_combos + 4AM–8AM", lambda s: filter_best_combos(s) and time_premarket(s)),

        # -- Volume --
        ("vol >= 1.0× SMA", vol_1x),
        ("vol >= 1.5× SMA", vol_1_5x),
        ("vol >= 2.0× SMA", vol_2x),
        ("best_combos + vol>=1.5x", lambda s: filter_best_combos(s) and vol_1_5x(s)),

        # -- Stacked combos --
        ("best_combos+bias+vol>=1x", lambda s: filter_best_combos(s) and filter_bias_aligned(s) and vol_1x(s)),
        ("best_combos+bias+vol>=1.5x", lambda s: filter_best_combos(s) and filter_bias_aligned(s) and vol_1_5x(s)),
        ("best_combos+bias+5PM-9PM", lambda s: filter_best_combos(s) and filter_bias_aligned(s) and time_early(s)),
        ("best_combos+bias+4AM-8AM", lambda s: filter_best_combos(s) and filter_bias_aligned(s) and time_premarket(s)),
        ("engulf_short+vol>=1.5x", lambda s: s["pattern"] == "engulfing" and s["side"] == "short" and vol_1_5x(s)),
        ("short@pdh_wh+vol>=1.5x", lambda s: s["zone_type"] in ("pdh","week_high") and s["side"] == "short" and vol_1_5x(s)),
        ("long@wl+vol>=1.5x", lambda s: s["zone_type"] == "week_low" and s["side"] == "long" and vol_1_5x(s)),
    ]

    # Run all filters
    print(f"\nTesting {len(filters)} filter combos...\n", file=sys.stderr)

    results = []
    for label, filt in filters:
        mask = [filt(s) for s in all_setups]
        outs = [all_outcomes[i] for i, keep in enumerate(mask) if keep]
        r = summarise(label, outs)
        results.append(r)
        pnl_str = f"{r['pnl_r']:>+7.1f}R" if r["n"] > 0 else "  —"
        print(f"  {label:<35} n={r['n']:>5}  {pnl_str}", file=sys.stderr)

    # Print full table
    print("\n" + "=" * 120)
    print("ENTRY FILTER STUDY — 5m PATTERNS AT LIQUIDITY ZONES (no swings, no pdl)")
    print("=" * 120)
    print_table(results)

    # Sort by avg R (min 30 trades)
    viable = [r for r in results if r["n"] >= 30]
    print(f"\n  TOP 10 BY AVG R (min 30 trades)")
    print_table(sorted(viable, key=lambda r: r["avg_r"], reverse=True)[:10])

    # Sort by profit factor (min 30 trades)
    print(f"\n  TOP 10 BY PROFIT FACTOR (min 30 trades)")
    print_table(sorted(viable, key=lambda r: r["pf"], reverse=True)[:10])

    # Sort by total PnL
    print(f"\n  TOP 10 BY TOTAL PnL (min 30 trades)")
    print_table(sorted(viable, key=lambda r: r["pnl_r"], reverse=True)[:10])

    if args.output:
        with open(args.output, "w") as f:
            json.dump(dict(symbol=symbol, session_id=session_id,
                           total_setups=len(all_setups), filters=results), f, indent=2)
        print(f"\nResults written to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
