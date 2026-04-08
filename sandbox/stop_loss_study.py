#!/usr/bin/env python3
"""
Stop-loss optimization study — takes the profitable reversal setup
(5m candle patterns at week_low, week_high, pdh, hvn zones) and tests
ATR-based stop placement vs the default candle-based stop.

Stop strategies tested:
  - candle:       original candle high/low (baseline)
  - atr_fixed:    entry ± ATR_mult × ATR(period)
  - atr_zone:     zone_price ± ATR_mult × ATR(period)  (buffer beyond the zone)
  - atr_wick:     signal candle wick tip ± ATR_mult × ATR(period)

Sweeps ATR periods (5, 8, 10, 14, 20) and multipliers (0.3–3.0).

Usage:
    python sandbox/stop_loss_study.py [--symbol XRPUSDT] [--last-n 0]
"""

import argparse
import json
import os
import sys
from collections import defaultdict
from itertools import product
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

# ── ATR computation ──────────────────────────────────────────────────────────

def compute_atr_series(candles: list[dict], period: int = 14) -> dict[int, float]:
    """
    Compute ATR for each candle timestamp using Wilder's smoothing.
    Returns {bucket_start_ms: atr_value}.
    """
    if len(candles) < 2:
        return {}

    trs = []
    for i in range(1, len(candles)):
        prev_close = candles[i - 1]["close"]
        c = candles[i]
        tr = max(
            c["high"] - c["low"],
            abs(c["high"] - prev_close),
            abs(c["low"] - prev_close),
        )
        trs.append((c["bucket_start_ms"], tr))

    atr_map: dict[int, float] = {}
    if len(trs) < period:
        return atr_map

    atr = sum(tr for _, tr in trs[:period]) / period
    atr_map[trs[period - 1][0]] = atr

    for j in range(period, len(trs)):
        ts, tr = trs[j]
        atr = (atr * (period - 1) + tr) / period
        atr_map[ts] = atr

    return atr_map


def get_atr_at(atr_map: dict[int, float], ts: int) -> float | None:
    """Get ATR at or just before the given timestamp via binary search."""
    keys = sorted(atr_map.keys())
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
    return atr_map[keys[lo - 1]]


# ── stop strategies ──────────────────────────────────────────────────────────

def compute_stops(setup: dict, atr: float, mult: float) -> dict[str, float]:
    """Return stop prices for each strategy given a setup and ATR."""
    entry = setup["entry_price"]
    side = setup["side"]
    zone = setup["zone_price"]
    candle_stop = setup["candle_stop"]

    offset = mult * atr

    if side == "long":
        return {
            "candle":    candle_stop,
            "atr_fixed": entry - offset,
            "atr_zone":  zone - offset,
            "atr_wick":  candle_stop - offset,
        }
    else:
        return {
            "candle":    candle_stop,
            "atr_fixed": entry + offset,
            "atr_zone":  zone + offset,
            "atr_wick":  candle_stop + offset,
        }


# ── outcome sim (operates on pre-sliced 1m bars) ────────────────────────────

def sim_outcome(
    bars_1m: list[dict],
    entry: float,
    stop: float,
    side: str,
) -> dict:
    """Simulate a single trade on pre-sliced 1m bars."""
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
    hold_bars = 0

    for j, bar in enumerate(bars_1m):
        hold_bars = j + 1
        bh, bl = bar["high"], bar["low"]
        if is_short:
            fav = entry - bl
            adv = bh - entry
            stopped = bh >= stop
            r1 = bl <= t1
            r2 = bl <= t2
            r3 = bl <= t3
        else:
            fav = bh - entry
            adv = entry - bl
            stopped = bl <= stop
            r1 = bh >= t1
            r2 = bh >= t2
            r3 = bh >= t3

        mfe = max(mfe, fav / risk)
        mae = max(mae, adv / risk)
        if r1:
            hit_1r = True
        if r2:
            hit_2r = True
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

    if is_short:
        pnl_r = (entry - exit_price) / risk
    else:
        pnl_r = (exit_price - entry) / risk

    return dict(pnl_r=round(pnl_r, 3), hit_1r=hit_1r, hit_2r=hit_2r,
                hit_3r=hit_3r, hit_stop=hit_stop, exit_reason=exit_reason,
                mfe_r=round(mfe, 2), mae_r=round(mae, 2), hold_bars=hold_bars)


# ── grid search ──────────────────────────────────────────────────────────────

ATR_PERIODS = [8, 14]
ATR_MULTS = [0.5, 1.0, 1.5, 2.0]
STOP_STRATEGIES = ["candle", "atr_fixed", "atr_zone", "atr_wick"]


def _preslice_1m(setups: list[dict], sorted_1m: list[dict],
                 max_hold_min: int) -> list[list[dict]]:
    """Pre-slice 1m bars for every setup once (avoids repeated binary search)."""
    import time
    t0_wall = time.time()
    sliced = []
    n = len(setups)
    for idx, s in enumerate(setups):
        t0 = s["time_ms"] + 5 * 60_000
        t1 = s["time_ms"] + (max_hold_min + 5) * 60_000
        sliced.append(slice_candles(sorted_1m, t0, t1))
        if (idx + 1) % 2000 == 0:
            elapsed = time.time() - t0_wall
            print(f"    sliced {idx+1}/{n} ({elapsed:.1f}s)", file=sys.stderr)
    elapsed = time.time() - t0_wall
    print(f"    sliced {n}/{n} ({elapsed:.1f}s)", file=sys.stderr)
    return sliced


def run_grid(setups: list[dict], bars_per_setup: list[list[dict]],
             atr_caches: dict[int, dict[int, float]]) -> list[dict]:
    """
    For each (strategy, atr_period, atr_mult) combo, re-simulate all setups.
    Uses pre-sliced 1m bars so the inner loop is just arithmetic.
    """
    rows = []
    n_setups = len(setups)

    # baseline: candle stop
    print("  [candle] baseline...", file=sys.stderr)
    outs = [sim_outcome(bars_per_setup[i], s["entry_price"], s["candle_stop"],
                        s["side"])
            for i, s in enumerate(setups)]
    rows.append(_summarise("candle", 0, 0, outs))

    # pre-resolve ATR values per setup for each period
    atr_vals: dict[int, list[float | None]] = {}
    for p in ATR_PERIODS:
        atr_map = atr_caches[p]
        atr_vals[p] = [get_atr_at(atr_map, s["time_ms"]) for s in setups]

    import time
    combos = list(product(ATR_PERIODS, ATR_MULTS))
    total_combos = len(combos) * 3
    done = 0
    for strat in ["atr_fixed", "atr_zone", "atr_wick"]:
        for atr_p, atr_m in combos:
            t0 = time.time()
            vals = atr_vals[atr_p]
            outs = []
            for i, s in enumerate(setups):
                av = vals[i]
                if av is None:
                    continue
                stops = compute_stops(s, av, atr_m)
                stop = stops[strat]
                if abs(s["entry_price"] - stop) <= 0:
                    continue
                outs.append(sim_outcome(bars_per_setup[i], s["entry_price"],
                                        stop, s["side"]))
            done += 1
            dt = time.time() - t0
            if outs:
                r = _summarise(strat, atr_p, atr_m, outs)
                rows.append(r)
                print(f"  [{done}/{total_combos}] {strat} ATR({atr_p})×{atr_m:.1f}  "
                      f"n={r['n']}  PnL={r['pnl_r']:+.0f}R  avg={r['avg_r']:+.4f}R  "
                      f"1R={r['r1_pct']:.0f}%  stop={r['stop_pct']:.0f}%  "
                      f"PF={r['profit_factor']:.2f}  ({dt:.1f}s)", file=sys.stderr)
            else:
                print(f"  [{done}/{total_combos}] {strat} ATR({atr_p})×{atr_m:.1f}  "
                      f"SKIPPED (no valid stops)  ({dt:.1f}s)", file=sys.stderr)

    return rows


def _summarise(strat: str, atr_p: int, atr_m: float, outs: list[dict]) -> dict:
    n = len(outs)
    if n == 0:
        return dict(strategy=strat, atr_period=atr_p, atr_mult=atr_m,
                    n=0, pnl_r=0, avg_r=0, r1_pct=0, r2_pct=0, r3_pct=0,
                    stop_pct=0, avg_mfe=0, avg_mae=0, profit_factor=0)
    total_pnl = sum(o["pnl_r"] for o in outs)
    wins = sum(o["pnl_r"] for o in outs if o["pnl_r"] > 0)
    losses = abs(sum(o["pnl_r"] for o in outs if o["pnl_r"] <= 0))
    return dict(
        strategy=strat,
        atr_period=atr_p,
        atr_mult=atr_m,
        n=n,
        pnl_r=round(total_pnl, 1),
        avg_r=round(total_pnl / n, 4),
        r1_pct=round(sum(1 for o in outs if o["hit_1r"]) / n * 100, 1),
        r2_pct=round(sum(1 for o in outs if o["hit_2r"]) / n * 100, 1),
        r3_pct=round(sum(1 for o in outs if o["hit_3r"]) / n * 100, 1),
        stop_pct=round(sum(1 for o in outs if o["hit_stop"]) / n * 100, 1),
        avg_mfe=round(sum(o["mfe_r"] for o in outs) / n, 2),
        avg_mae=round(sum(o["mae_r"] for o in outs) / n, 2),
        profit_factor=round(wins / losses, 3) if losses > 0 else 999.0,
    )


# ── reporting ────────────────────────────────────────────────────────────────

def print_results(rows: list[dict]):
    print("\n" + "=" * 110)
    print("STOP-LOSS OPTIMIZATION — ATR SWEEP")
    print("=" * 110)

    baseline = [r for r in rows if r["strategy"] == "candle"]
    atr_rows = [r for r in rows if r["strategy"] != "candle"]

    if baseline:
        b = baseline[0]
        print(f"\n  BASELINE (candle stop)")
        print(f"  n={b['n']}  PnL={b['pnl_r']:+.1f}R  avg={b['avg_r']:+.4f}R  "
              f"1R={b['r1_pct']:.1f}%  2R={b['r2_pct']:.1f}%  3R={b['r3_pct']:.1f}%  "
              f"stop={b['stop_pct']:.1f}%  PF={b['profit_factor']:.2f}  "
              f"MFE={b['avg_mfe']:.2f}R  MAE={b['avg_mae']:.2f}R")

    # Best by total PnL for each strategy
    by_strat = defaultdict(list)
    for r in atr_rows:
        by_strat[r["strategy"]].append(r)

    print(f"\n  BEST CONFIG PER STRATEGY (by total PnL)")
    header = (f"  {'Strategy':<12} {'ATR':>4} {'Mult':>5} {'N':>6} {'PnL R':>8} "
              f"{'Avg R':>8} {'1R%':>6} {'2R%':>6} {'3R%':>6} {'Stop%':>6} "
              f"{'PF':>6} {'MFE':>5} {'MAE':>5}")
    print(header)
    print("  " + "-" * (len(header) - 2))
    for strat in ["atr_fixed", "atr_zone", "atr_wick"]:
        if strat not in by_strat:
            continue
        best = max(by_strat[strat], key=lambda r: r["pnl_r"])
        print(f"  {best['strategy']:<12} {best['atr_period']:>4} {best['atr_mult']:>5.2f} "
              f"{best['n']:>6} {best['pnl_r']:>+7.1f}R {best['avg_r']:>+7.4f}R "
              f"{best['r1_pct']:>5.1f}% {best['r2_pct']:>5.1f}% {best['r3_pct']:>5.1f}% "
              f"{best['stop_pct']:>5.1f}% {best['profit_factor']:>5.2f} "
              f"{best['avg_mfe']:>5.2f} {best['avg_mae']:>5.2f}")

    # Best by profit factor (min 100 trades)
    viable = [r for r in atr_rows if r["n"] >= 100 and r["profit_factor"] < 999]
    if viable:
        print(f"\n  BEST CONFIG BY PROFIT FACTOR (min 100 trades)")
        print(header)
        print("  " + "-" * (len(header) - 2))
        top_pf = sorted(viable, key=lambda r: r["profit_factor"], reverse=True)[:10]
        for r in top_pf:
            print(f"  {r['strategy']:<12} {r['atr_period']:>4} {r['atr_mult']:>5.2f} "
                  f"{r['n']:>6} {r['pnl_r']:>+7.1f}R {r['avg_r']:>+7.4f}R "
                  f"{r['r1_pct']:>5.1f}% {r['r2_pct']:>5.1f}% {r['r3_pct']:>5.1f}% "
                  f"{r['stop_pct']:>5.1f}% {r['profit_factor']:>5.2f} "
                  f"{r['avg_mfe']:>5.2f} {r['avg_mae']:>5.2f}")

    # Best by avg R (min 100 trades)
    if viable:
        print(f"\n  BEST CONFIG BY AVG R (min 100 trades)")
        print(header)
        print("  " + "-" * (len(header) - 2))
        top_avg = sorted(viable, key=lambda r: r["avg_r"], reverse=True)[:10]
        for r in top_avg:
            print(f"  {r['strategy']:<12} {r['atr_period']:>4} {r['atr_mult']:>5.2f} "
                  f"{r['n']:>6} {r['pnl_r']:>+7.1f}R {r['avg_r']:>+7.4f}R "
                  f"{r['r1_pct']:>5.1f}% {r['r2_pct']:>5.1f}% {r['r3_pct']:>5.1f}% "
                  f"{r['stop_pct']:>5.1f}% {r['profit_factor']:>5.2f} "
                  f"{r['avg_mfe']:>5.2f} {r['avg_mae']:>5.2f}")

    # Full ATR heatmap for best strategy
    if viable:
        best_strat = max(by_strat.keys(),
                         key=lambda s: max(r["pnl_r"] for r in by_strat[s]))
        print(f"\n  HEATMAP: {best_strat} — Total PnL (R) by period × mult")
        mults_used = sorted(set(r["atr_mult"] for r in by_strat[best_strat]))
        periods_used = sorted(set(r["atr_period"] for r in by_strat[best_strat]))
        lookup = {(r["atr_period"], r["atr_mult"]): r for r in by_strat[best_strat]}

        print(f"  {'ATR\\Mult':<8}", end="")
        for m in mults_used:
            print(f" {m:>7.2f}", end="")
        print()
        print("  " + "-" * (8 + 8 * len(mults_used)))
        for p in periods_used:
            print(f"  {p:<8}", end="")
            for m in mults_used:
                r = lookup.get((p, m))
                val = r["pnl_r"] if r else 0
                print(f" {val:>+6.0f}R", end="")
            print()


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Stop-loss ATR optimization study")
    parser.add_argument("--db", default=DB_PATH)
    parser.add_argument("--session-id", default="")
    parser.add_argument("--symbol", default="XRPUSDT")
    parser.add_argument("--lookback-days", type=int, default=7)
    parser.add_argument("--touch-pct", type=float, default=0.10)
    parser.add_argument("--max-hold", type=int, default=120)
    parser.add_argument("--last-n", type=int, default=0)
    parser.add_argument("--output", default="", help="Write grid JSON to file")
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

    # Scanner cache
    cache_file = scanner_cache_path(session_id, symbol, args.lookback_days)
    snapshots = load_scanner_cache(cache_file)
    if snapshots is None:
        print("ERROR: scanner cache not found — run reversal_study.py first", file=sys.stderr)
        sys.exit(1)

    if args.last_n > 0:
        snapshots = snapshots[-args.last_n:]
        print(f"  Using last {len(snapshots)} snapshots", file=sys.stderr)

    # Load candles
    print(f"Loading {symbol} 5m candles...", file=sys.stderr)
    candles_5m = load_5m_candles(db, session_id, symbol)
    print(f"  {len(candles_5m)} 5m bars", file=sys.stderr)

    print(f"Loading {symbol} 1m candles...", file=sys.stderr)
    candles_1m = load_1m_candles(db, session_id, symbol)
    print(f"  {len(candles_1m)} 1m bars", file=sys.stderr)

    # Pre-compute ATR series for all periods on the full 5m dataset
    print("Computing ATR series...", file=sys.stderr)
    atr_caches: dict[int, dict[int, float]] = {}
    for p in ATR_PERIODS:
        atr_caches[p] = compute_atr_series(candles_5m, period=p)
        print(f"  ATR({p}): {len(atr_caches[p])} values", file=sys.stderr)

    # Detect setups (filtered to profitable zones only)
    print("Detecting 5m reversal setups (filtered zones)...", file=sys.stderr)
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
            s["candle_stop"] = s["stop_price"]
        all_setups.extend(setups)

    if skipped_weekends:
        print(f"  Skipped {skipped_weekends} weekend snapshots", file=sys.stderr)
    print(f"  {len(all_setups)} setups to optimise", file=sys.stderr)

    if not all_setups:
        print("No setups found.", file=sys.stderr)
        sys.exit(0)

    # Pre-slice 1m bars for every setup (the big speedup)
    print(f"Pre-slicing 1m bars for {len(all_setups)} setups...", file=sys.stderr)
    bars_per_setup = _preslice_1m(all_setups, candles_1m, args.max_hold)
    del candles_1m  # free ~600k dicts
    print("  done", file=sys.stderr)

    # Run grid search
    print("\nRunning grid search...", file=sys.stderr)
    rows = run_grid(all_setups, bars_per_setup, atr_caches)
    print(f"  {len(rows)} configurations tested", file=sys.stderr)

    print_results(rows)

    if args.output:
        with open(args.output, "w") as f:
            json.dump(dict(
                symbol=symbol, session_id=session_id,
                keep_zones=sorted(KEEP_ZONES),
                atr_periods=ATR_PERIODS, atr_mults=ATR_MULTS,
                total_setups=len(all_setups),
                grid=rows,
            ), f, indent=2)
        print(f"\nGrid results written to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
