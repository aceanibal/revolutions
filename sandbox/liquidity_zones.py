#!/usr/bin/env python3
"""
Liquidity zone scanner — reads XRPUSDT 5m candles from the backtester SQLite DB,
computes daily highs/lows, volume-profile high-volume nodes, and swing pivots
from a trailing week of data anchored at 5 PM ET each day.

Outputs a JSON report (no raw candles) to stdout.

Usage:
    python sandbox/liquidity_zones.py [--session-id <id>] [--symbol XRPUSDT]
"""

import argparse
import json
import math
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "backtester", "data", "backtest.sqlite")

# ── data loading ──────────────────────────────────────────────────────────────

def load_5m_candles(db_path: str, session_id: str, symbol: str) -> list[dict]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.execute(
        """
        SELECT bucket_start_ms, open, high, low, close, volume
        FROM session_candles
        WHERE session_id = ? AND symbol = ? AND timeframe = '5m'
        ORDER BY bucket_start_ms
        """,
        (session_id, symbol),
    )
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def list_sessions_with_symbol(db_path: str, symbol: str) -> list[tuple[str, int]]:
    """Return historical sessions that have 5m data for the given symbol."""
    conn = sqlite3.connect(db_path)
    cur = conn.execute(
        """
        SELECT sc.session_id, COUNT(*) AS cnt
        FROM session_candles sc
        JOIN sessions s ON s.id = sc.session_id
        WHERE sc.symbol = ? AND sc.timeframe = '5m'
          AND s.session_type = 'historical'
        GROUP BY sc.session_id
        ORDER BY cnt DESC
        """,
        (symbol,),
    )
    rows = [(r[0], r[1]) for r in cur.fetchall()]
    conn.close()
    return rows

# ── helpers ───────────────────────────────────────────────────────────────────

def ms_to_et(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(ET)


def et_day_key(ms: int) -> str:
    return ms_to_et(ms).strftime("%Y-%m-%d")


def et_hhmm(ms: int) -> int:
    dt = ms_to_et(ms)
    return dt.hour * 100 + dt.minute

# ── daily levels ──────────────────────────────────────────────────────────────

def extract_daily_levels(candles: list[dict]) -> list[dict]:
    days: dict[str, dict] = {}
    for c in candles:
        t = c["bucket_start_ms"]
        dk = et_day_key(t)
        h, l, o, cl = c["high"], c["low"], c["open"], c["close"]
        if dk not in days:
            days[dk] = dict(day_key=dk, high=h, low=l, open=o, close=cl, open_time=t, close_time=t)
        else:
            d = days[dk]
            if h > d["high"]:
                d["high"] = h
            if l < d["low"]:
                d["low"] = l
            if t < d["open_time"]:
                d["open"] = o
                d["open_time"] = t
            if t > d["close_time"]:
                d["close"] = cl
                d["close_time"] = t
    return sorted(days.values(), key=lambda d: d["open_time"])

# ── volume profile ────────────────────────────────────────────────────────────

def compute_volume_profile(candles: list[dict], num_bins: int = 50) -> dict:
    if not candles:
        return dict(bins=[], week_high=0, week_low=0, bin_size=0)
    week_high = max(c["high"] for c in candles)
    week_low = min(c["low"] for c in candles)
    if week_high <= week_low:
        return dict(bins=[], week_high=week_high, week_low=week_low, bin_size=0)
    rng = week_high - week_low
    bin_size = rng / num_bins
    bins = [
        dict(price_low=week_low + i * bin_size,
             price_high=week_low + (i + 1) * bin_size,
             price_mid=week_low + (i + 0.5) * bin_size,
             volume=0.0)
        for i in range(num_bins)
    ]
    for c in candles:
        typical = (c["high"] + c["low"] + c["close"]) / 3
        vol = c["volume"]
        if vol <= 0:
            continue
        idx = min(int((typical - week_low) / bin_size), num_bins - 1)
        bins[idx]["volume"] += vol
    return dict(bins=bins, week_high=week_high, week_low=week_low, bin_size=bin_size)


def find_high_volume_nodes(profile: dict, std_dev_mult: float = 1.0) -> list[dict]:
    bins = profile["bins"]
    if not bins:
        return []
    volumes = [b["volume"] for b in bins]
    mean = sum(volumes) / len(volumes)
    variance = sum((v - mean) ** 2 for v in volumes) / len(volumes)
    std_dev = math.sqrt(variance)
    threshold = mean + std_dev_mult * std_dev
    return [
        dict(price_low=b["price_low"], price_high=b["price_high"],
             price_mid=b["price_mid"], volume=b["volume"])
        for b in bins if b["volume"] >= threshold
    ]

# ── swing points ──────────────────────────────────────────────────────────────

def detect_swing_points(candles: list[dict], left: int = 5, right: int = 5) -> dict:
    highs, lows = [], []
    if len(candles) < left + right + 1:
        return dict(swing_highs=highs, swing_lows=lows)
    for i in range(left, len(candles) - right):
        h = candles[i]["high"]
        l = candles[i]["low"]
        t = candles[i]["bucket_start_ms"]
        is_high = all(candles[j]["high"] < h for j in range(i - left, i + right + 1) if j != i)
        is_low = all(candles[j]["low"] > l for j in range(i - left, i + right + 1) if j != i)
        if is_high:
            highs.append(dict(time_ms=t, price=h))
        if is_low:
            lows.append(dict(time_ms=t, price=l))
    return dict(swing_highs=highs, swing_lows=lows)

# ── main zone computation ────────────────────────────────────────────────────

def compute_liquidity_zones(
    sorted_5m: list[dict],
    anchor_ms: int,
    lookback_days: int = 7,
    num_bins: int = 50,
    swing_left: int = 5,
    swing_right: int = 5,
    hvn_std_dev: float = 1.0,
) -> dict | None:
    cutoff = anchor_ms - lookback_days * 86_400_000
    window = [c for c in sorted_5m if cutoff < c["bucket_start_ms"] <= anchor_ms]
    if not window:
        return None

    daily = extract_daily_levels(window)
    anchor_day = et_day_key(anchor_ms)
    prev_days = [d for d in daily if d["day_key"] < anchor_day]
    prev = prev_days[-1] if prev_days else None

    profile = compute_volume_profile(window, num_bins)
    hvns = find_high_volume_nodes(profile, hvn_std_dev)
    swings = detect_swing_points(window, swing_left, swing_right)

    return dict(
        anchor_ms=anchor_ms,
        anchor_day=anchor_day,
        lookback_days=lookback_days,
        candle_count=len(window),
        week_high=profile["week_high"],
        week_low=profile["week_low"],
        previous_day_high=prev["high"] if prev else None,
        previous_day_low=prev["low"] if prev else None,
        previous_day_close=prev["close"] if prev else None,
        daily_levels=[
            dict(day_key=d["day_key"], high=d["high"], low=d["low"],
                 open=d["open"], close=d["close"])
            for d in prev_days
        ],
        high_volume_nodes=hvns,
        swing_highs=swings["swing_highs"],
        swing_lows=swings["swing_lows"],
    )

# ── scanner: anchor at 5 PM ET each day ──────────────────────────────────────

def run_scanner(
    candles: list[dict],
    anchor_hhmm: int = 1700,
    lookback_days: int = 7,
    num_bins: int = 50,
    swing_left: int = 5,
    swing_right: int = 5,
    hvn_std_dev: float = 1.0,
) -> list[dict]:
    # find the last bar at or before anchor_hhmm on each day
    day_anchors: dict[str, int] = {}
    for c in candles:
        t = c["bucket_start_ms"]
        dk = et_day_key(t)
        hhmm = et_hhmm(t)
        if hhmm <= anchor_hhmm:
            day_anchors[dk] = t

    snapshots = []
    for dk in sorted(day_anchors):
        anchor_ms = day_anchors[dk]
        zones = compute_liquidity_zones(
            candles, anchor_ms,
            lookback_days=lookback_days,
            num_bins=num_bins,
            swing_left=swing_left,
            swing_right=swing_right,
            hvn_std_dev=hvn_std_dev,
        )
        if zones:
            snapshots.append(zones)
    return snapshots

# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Liquidity zone scanner (Python sandbox)")
    parser.add_argument("--db", default=DB_PATH, help="Path to backtest.sqlite")
    parser.add_argument("--session-id", default="", help="Session ID (auto-detected if omitted)")
    parser.add_argument("--symbol", default="XRPUSDT", help="Symbol (default: XRPUSDT)")
    parser.add_argument("--lookback-days", type=int, default=7)
    parser.add_argument("--num-bins", type=int, default=50)
    parser.add_argument("--swing-left", type=int, default=5)
    parser.add_argument("--swing-right", type=int, default=5)
    parser.add_argument("--hvn-std-dev", type=float, default=1.0)
    parser.add_argument("--anchor-hhmm", type=int, default=1700)
    parser.add_argument("--last-n", type=int, default=0, help="Only output last N snapshots (0=all)")
    parser.add_argument("--output", default="", help="Output file (default: stdout)")
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
        print(f"Auto-selected session: {session_id} ({sessions[0][1]} bars)", file=sys.stderr)

    print(f"Loading {symbol} 5m candles from session {session_id}...", file=sys.stderr)
    candles = load_5m_candles(db, session_id, symbol)
    print(f"Loaded {len(candles)} candles", file=sys.stderr)

    if not candles:
        print("ERROR: no candles found", file=sys.stderr)
        sys.exit(1)

    print("Running liquidity zone scanner...", file=sys.stderr)
    snapshots = run_scanner(
        candles,
        anchor_hhmm=args.anchor_hhmm,
        lookback_days=args.lookback_days,
        num_bins=args.num_bins,
        swing_left=args.swing_left,
        swing_right=args.swing_right,
        hvn_std_dev=args.hvn_std_dev,
    )
    print(f"Computed {len(snapshots)} daily snapshots", file=sys.stderr)

    if args.last_n > 0:
        snapshots = snapshots[-args.last_n:]

    report = dict(
        session_id=session_id,
        symbol=symbol,
        snapshot_count=len(snapshots),
        lookback_days=args.lookback_days,
        num_bins=args.num_bins,
        anchor_hhmm=args.anchor_hhmm,
        snapshots=snapshots,
    )

    out = json.dumps(report, indent=2)
    if args.output:
        with open(args.output, "w") as f:
            f.write(out)
        print(f"Report written to {args.output}", file=sys.stderr)
    else:
        print(out)


CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")


def scanner_cache_path(session_id: str, symbol: str, lookback_days: int = 7) -> str:
    safe = f"{session_id}_{symbol}_lb{lookback_days}".replace("/", "_")
    return os.path.join(CACHE_DIR, f"scanner_{safe}.json")


def save_scanner_cache(path: str, session_id: str, symbol: str, snapshots: list[dict]):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(dict(session_id=session_id, symbol=symbol,
                       snapshot_count=len(snapshots), snapshots=snapshots), f)
    print(f"Scanner cache written to {path}", file=sys.stderr)


def load_scanner_cache(path: str) -> list[dict] | None:
    if not os.path.isfile(path):
        return None
    with open(path) as f:
        data = json.load(f)
    snapshots = data.get("snapshots", [])
    print(f"Loaded {len(snapshots)} snapshots from cache {path}", file=sys.stderr)
    return snapshots


if __name__ == "__main__":
    main()
