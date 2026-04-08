#!/usr/bin/env python3
"""
Time-of-day directional prior — empirical P(next bar UP) by ET hour from 1h candles
(aggregated from 5m DB data). Use as a *weak* input to direction, not a standalone edge.

Why this exists:
  Pure candle patterns rarely clear fees. Calendar effects are small (~2–8pp vs 50%)
  but can be combined with regime filters, cross-asset context, and execution rules.

Usage:
  python sandbox/time_of_day_prior.py --symbol PAXGUSDT
  python sandbox/time_of_day_prior.py --symbol XRPUSDT --min-z 2.0
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
from collections import defaultdict

from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "backtester", "data", "backtest.sqlite")


def load_5m(db_path: str, session_id: str, symbol: str) -> list[dict]:
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


def list_hist_session(db_path: str, symbol: str) -> str | None:
    conn = sqlite3.connect(db_path)
    cur = conn.execute(
        """
        SELECT sc.session_id, COUNT(*) AS cnt
        FROM session_candles sc
        JOIN sessions s ON s.id = sc.session_id
        WHERE sc.symbol = ? AND sc.timeframe = '5m' AND s.session_type = 'historical'
        GROUP BY sc.session_id
        ORDER BY cnt DESC
        LIMIT 1
        """,
        (symbol,),
    )
    row = cur.fetchone()
    conn.close()
    return row[0] if row else None


def ms_to_et(ms: int):
    from datetime import datetime, timezone

    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(ET)


def aggregate_to_1hr(bars_5m: list[dict]) -> list[dict]:
    hourly: list[dict] = []
    bucket: list[dict] = []
    for b in bars_5m:
        hour_ms = (b["bucket_start_ms"] // (3600 * 1000)) * 3600 * 1000
        if bucket and bucket[0]["_hm"] != hour_ms:
            # Finalize the *completed* hour (bucket[0]), not the incoming bar's hour.
            hourly.append(_finalize_hour(bucket, bucket[0]["_hm"]))
            bucket = []
        bucket.append({**b, "_hm": hour_ms})
    if bucket:
        hourly.append(_finalize_hour(bucket, bucket[0]["_hm"]))
    return hourly


def _finalize_hour(bucket: list[dict], hour_ms: int) -> dict:
    return {
        "bucket_start_ms": hour_ms,
        "open": bucket[0]["open"],
        "high": max(x["high"] for x in bucket),
        "low": min(x["low"] for x in bucket),
        "close": bucket[-1]["close"],
        "volume": sum(x["volume"] for x in bucket),
    }


def build_hourly_stats(c1h: list[dict]) -> list[dict]:
    by_h: dict[int, list[float]] = defaultdict(list)
    for i in range(len(c1h) - 1):
        h = ms_to_et(c1h[i]["bucket_start_ms"]).hour
        r = (c1h[i + 1]["close"] - c1h[i]["close"]) / c1h[i]["close"] * 100
        by_h[h].append(r)

    out = []
    for h in range(24):
        rs = by_h[h]
        if len(rs) < 30:
            continue
        n = len(rs)
        p_up = sum(1 for x in rs if x > 0) / n
        mean_r = sum(rs) / n
        med_abs = sorted(abs(x) for x in rs)[len(rs) // 2]
        se = math.sqrt(p_up * (1 - p_up) / n) if n else 0
        z = (p_up - 0.5) / se if se > 0 else 0
        # Prior score in [-1, 1]: strength of long vs short bias
        prior = (p_up - 0.5) * 2
        out.append(
            {
                "hour_et": h,
                "n": n,
                "p_up": round(p_up, 4),
                "mean_next_ret_pct": round(mean_r, 6),
                "median_abs_next_ret_pct": round(med_abs, 6),
                "z_vs_50": round(z, 3),
                "prior_long_score": round(prior, 4),
            }
        )
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="PAXGUSDT")
    ap.add_argument("--min-z", type=float, default=0.0, help="Only print rows with |z| >= this")
    ap.add_argument("--json", action="store_true", help="Emit JSON for tooling")
    args = ap.parse_args()

    sid = list_hist_session(DB_PATH, args.symbol)
    if not sid:
        raise SystemExit(f"No historical 5m session for {args.symbol}")

    c5m = load_5m(DB_PATH, sid, args.symbol)
    c1h = aggregate_to_1hr(c5m)
    stats = build_hourly_stats(c1h)

    filtered = [s for s in stats if abs(s["z_vs_50"]) >= args.min_z]

    if args.json:
        print(
            json.dumps(
                {
                    "symbol": args.symbol,
                    "session_id": sid,
                    "bars_1h": len(c1h),
                    "hourly": filtered if args.min_z > 0 else stats,
                },
                indent=2,
            )
        )
        return

    print(f"symbol={args.symbol} session={sid} 1h_bars={len(c1h)}")
    print()
    print(
        f"{'Hr':>3} {'N':>6} {'P(up)':>8} {'Z':>7} {'mean%':>10} {'med|ret|':>10} {'prior':>8}  note"
    )
    print("-" * 72)
    for s in stats:
        if abs(s["z_vs_50"]) < args.min_z:
            continue
        note = ""
        if s["z_vs_50"] > 2:
            note = "long tilt"
        elif s["z_vs_50"] < -2:
            note = "short tilt"
        print(
            f"{s['hour_et']:>3} {s['n']:>6} {s['p_up']*100:>7.2f}% {s['z_vs_50']:>+7.2f} "
            f"{s['mean_next_ret_pct']:>+10.5f}% {s['median_abs_next_ret_pct']:>10.5f}% "
            f"{s['prior_long_score']:>+8.3f}  {note}"
        )

    print()
    print(
        "Interpretation: prior_long_score = 2*(P(up)-0.5). "
        "Combine with regime (trend/vol), fees, and execution — not a standalone system."
    )


if __name__ == "__main__":
    main()
