#!/usr/bin/env python3
"""
Study sessions where previous-day high/low are hit during overnight window.

For each scanner snapshot session:
  - Detect first touch of previous_day_high and/or previous_day_low in
    [anchor, anchor + 15h]
  - Compute price/volume context at the touch candle
  - Summarize aggregate behavior by hit type
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from collections import defaultdict
from statistics import mean
from typing import Any

from liquidity_zones import DB_PATH, list_sessions_with_symbol, load_5m_candles, load_scanner_cache, ms_to_et, scanner_cache_path
from reversal_study import slice_candles
from strategy_sim import OVERNIGHT_MS


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Study daily-extreme touches per session")
    p.add_argument("--db", default=DB_PATH)
    p.add_argument("--session-id", default="")
    p.add_argument("--symbol", default="XRPUSDT")
    p.add_argument("--lookback-days", type=int, default=7)
    p.add_argument("--skip-weekends", action="store_true", default=True)
    p.add_argument("--include-weekends", action="store_true", help="Override skip-weekends")
    p.add_argument("--post-minutes", type=int, default=60)
    p.add_argument("--output", default="", help="Write full JSON report")
    p.add_argument("--events-csv", default="", help="Optional CSV export")
    return p.parse_args()


def _pick_session(db: str, session_id: str, symbol: str) -> str:
    if session_id:
        return session_id
    sessions = list_sessions_with_symbol(db, symbol)
    if not sessions:
        raise RuntimeError(f"No historical sessions found for {symbol}")
    return sessions[0][0]


def _mean(values: list[float]) -> float:
    return mean(values) if values else 0.0


def _stdev(values: list[float]) -> float:
    n = len(values)
    if n < 2:
        return 0.0
    m = _mean(values)
    return math.sqrt(sum((v - m) ** 2 for v in values) / n)


def _safe_pct(a: float, b: float) -> float:
    if b == 0:
        return 0.0
    return (a - b) / b * 100.0


def _close_at_or_before(candles: list[dict[str, Any]], ts_ms: int) -> float | None:
    prev_close = None
    for c in candles:
        t = int(c["bucket_start_ms"])
        if t > ts_ms:
            break
        prev_close = float(c["close"])
    return prev_close


def _first_touch(candles: list[dict[str, Any]], level: float, kind: str) -> tuple[int, dict[str, Any] | None]:
    for i, c in enumerate(candles):
        h = float(c["high"])
        l = float(c["low"])
        if kind == "daily_high" and h >= level:
            return i, c
        if kind == "daily_low" and l <= level:
            return i, c
    return -1, None


def _forward_close(candles: list[dict[str, Any]], hit_idx: int, forward_bars: int) -> float | None:
    idx = hit_idx + forward_bars
    if idx < 0 or idx >= len(candles):
        return None
    return float(candles[idx]["close"])


def _volume_zscore(candles: list[dict[str, Any]], idx: int, lookback_bars: int = 24) -> float:
    if idx <= 0:
        return 0.0
    lo = max(0, idx - lookback_bars)
    baseline = [float(c["volume"]) for c in candles[lo:idx]]
    if not baseline:
        return 0.0
    m = _mean(baseline)
    sd = _stdev(baseline)
    if sd == 0:
        return 0.0
    return (float(candles[idx]["volume"]) - m) / sd


def event_from_touch(
    session_day: str,
    anchor_ms: int,
    anchor_close: float,
    overnight: list[dict[str, Any]],
    kind: str,
    level: float,
    hit_idx: int,
    hit_candle: dict[str, Any],
    post_minutes: int,
) -> dict[str, Any]:
    hit_ms = int(hit_candle["bucket_start_ms"])
    hit_close = float(hit_candle["close"])
    hit_high = float(hit_candle["high"])
    hit_low = float(hit_candle["low"])
    hit_volume = float(hit_candle["volume"])
    hit_range = hit_high - hit_low
    bars_fwd = max(1, post_minutes // 5)
    fwd_close = _forward_close(overnight, hit_idx, bars_fwd)

    future_slice = overnight[hit_idx + 1: hit_idx + 1 + bars_fwd]
    cont_move = 0.0
    if future_slice:
        if kind == "daily_high":
            cont_move = max(float(c["high"]) for c in future_slice) - level
        else:
            cont_move = level - min(float(c["low"]) for c in future_slice)

    return {
        "session_day": session_day,
        "anchor_ms": anchor_ms,
        "anchor_et": ms_to_et(anchor_ms).strftime("%Y-%m-%d %H:%M"),
        "event_type": kind,
        "level": level,
        "hit_ms": hit_ms,
        "hit_et": ms_to_et(hit_ms).strftime("%Y-%m-%d %H:%M"),
        "minutes_to_hit": round((hit_ms - anchor_ms) / 60_000, 2),
        "anchor_close": anchor_close,
        "hit_close": hit_close,
        "move_anchor_to_hit_pct": round(_safe_pct(hit_close, anchor_close), 4),
        "hit_candle_range": hit_range,
        "hit_candle_range_pct_of_level": round((hit_range / level * 100.0) if level else 0.0, 4),
        "hit_candle_volume": hit_volume,
        "hit_volume_zscore_24bars": round(_volume_zscore(overnight, hit_idx, lookback_bars=24), 4),
        "forward_close": fwd_close,
        "forward_return_pct": round(_safe_pct(fwd_close, hit_close), 4) if fwd_close is not None else None,
        "continuation_move_abs": round(cont_move, 6),
        "continuation_move_pct_of_level": round((cont_move / level * 100.0) if level else 0.0, 4),
    }


def write_events_csv(path: str, events: list[dict[str, Any]]) -> None:
    if not events:
        with open(path, "w") as f:
            f.write("")
        return
    cols = list(events[0].keys())
    with open(path, "w") as f:
        f.write(",".join(cols) + "\n")
        for e in events:
            row = []
            for c in cols:
                v = e.get(c)
                text = "" if v is None else str(v)
                if "," in text:
                    text = f"\"{text}\""
                row.append(text)
            f.write(",".join(row) + "\n")


def summarize(events: list[dict[str, Any]]) -> dict[str, Any]:
    by_type: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in events:
        by_type[e["event_type"]].append(e)

    out: dict[str, Any] = {}
    for k in ("daily_high", "daily_low"):
        rows = by_type.get(k, [])
        out[k] = {
            "count": len(rows),
            "avg_minutes_to_hit": round(_mean([float(r["minutes_to_hit"]) for r in rows]), 2) if rows else None,
            "avg_hit_volume_zscore": round(_mean([float(r["hit_volume_zscore_24bars"]) for r in rows]), 4) if rows else None,
            "avg_move_anchor_to_hit_pct": round(_mean([float(r["move_anchor_to_hit_pct"]) for r in rows]), 4) if rows else None,
            "avg_forward_return_pct": round(_mean([float(r["forward_return_pct"]) for r in rows if r["forward_return_pct"] is not None]), 4)
            if rows
            else None,
            "avg_continuation_move_pct_of_level": round(_mean([float(r["continuation_move_pct_of_level"]) for r in rows]), 4) if rows else None,
        }
    return out


def main() -> int:
    args = parse_args()
    if args.include_weekends:
        args.skip_weekends = False

    db = os.path.abspath(args.db)
    if not os.path.isfile(db):
        print(f"ERROR: DB not found: {db}", file=sys.stderr)
        return 1

    symbol = args.symbol.upper()
    session_id = _pick_session(db, args.session_id, symbol)
    cache_file = scanner_cache_path(session_id, symbol, args.lookback_days)
    snapshots = load_scanner_cache(cache_file)
    if snapshots is None:
        print(f"ERROR: scanner cache missing: {cache_file}", file=sys.stderr)
        return 1

    candles_5m = load_5m_candles(db, session_id, symbol)
    if not candles_5m:
        print("ERROR: no 5m candles found", file=sys.stderr)
        return 1

    events: list[dict[str, Any]] = []
    session_count = 0
    high_hit_sessions = 0
    low_hit_sessions = 0
    both_hit_sessions = 0

    for snap in snapshots:
        anchor_ms = int(snap.get("anchor_ms", 0))
        if anchor_ms <= 0:
            continue
        anchor_dt = ms_to_et(anchor_ms)
        if args.skip_weekends and anchor_dt.weekday() >= 5:
            continue

        overnight = slice_candles(candles_5m, anchor_ms, anchor_ms + OVERNIGHT_MS)
        if not overnight:
            continue
        session_count += 1

        daily_high = snap.get("previous_day_high")
        daily_low = snap.get("previous_day_low")
        if daily_high is None and daily_low is None:
            continue

        anchor_close = _close_at_or_before(candles_5m, anchor_ms)
        if anchor_close is None:
            continue

        hit_h = False
        hit_l = False
        if daily_high is not None:
            high_idx, high_candle = _first_touch(overnight, float(daily_high), "daily_high")
            if high_idx >= 0 and high_candle is not None:
                hit_h = True
                high_hit_sessions += 1
                events.append(
                    event_from_touch(
                        session_day=anchor_dt.strftime("%Y-%m-%d"),
                        anchor_ms=anchor_ms,
                        anchor_close=float(anchor_close),
                        overnight=overnight,
                        kind="daily_high",
                        level=float(daily_high),
                        hit_idx=high_idx,
                        hit_candle=high_candle,
                        post_minutes=args.post_minutes,
                    )
                )

        if daily_low is not None:
            low_idx, low_candle = _first_touch(overnight, float(daily_low), "daily_low")
            if low_idx >= 0 and low_candle is not None:
                hit_l = True
                low_hit_sessions += 1
                events.append(
                    event_from_touch(
                        session_day=anchor_dt.strftime("%Y-%m-%d"),
                        anchor_ms=anchor_ms,
                        anchor_close=float(anchor_close),
                        overnight=overnight,
                        kind="daily_low",
                        level=float(daily_low),
                        hit_idx=low_idx,
                        hit_candle=low_candle,
                        post_minutes=args.post_minutes,
                    )
                )

        if hit_h and hit_l:
            both_hit_sessions += 1

    summary = summarize(events)
    result = {
        "session_id": session_id,
        "symbol": symbol,
        "lookback_days": args.lookback_days,
        "post_minutes": args.post_minutes,
        "skip_weekends": args.skip_weekends,
        "session_count": session_count,
        "sessions_with_daily_high_hit": high_hit_sessions,
        "sessions_with_daily_low_hit": low_hit_sessions,
        "sessions_with_both_hits": both_hit_sessions,
        "daily_high_hit_rate_pct": round((high_hit_sessions / session_count * 100.0), 2) if session_count else 0.0,
        "daily_low_hit_rate_pct": round((low_hit_sessions / session_count * 100.0), 2) if session_count else 0.0,
        "both_hit_rate_pct": round((both_hit_sessions / session_count * 100.0), 2) if session_count else 0.0,
        "summary_by_event_type": summary,
        "event_count": len(events),
        "events": events,
    }

    print("\nDAILY EXTREME TOUCH STUDY")
    print("=" * 80)
    print(f"Session: {session_id}")
    print(f"Symbol: {symbol}")
    print(f"Sessions analyzed: {session_count}")
    print(f"Daily-high touched sessions: {high_hit_sessions} ({result['daily_high_hit_rate_pct']:.2f}%)")
    print(f"Daily-low touched sessions: {low_hit_sessions} ({result['daily_low_hit_rate_pct']:.2f}%)")
    print(f"Both touched sessions: {both_hit_sessions} ({result['both_hit_rate_pct']:.2f}%)")
    print("-" * 80)
    for key in ("daily_high", "daily_low"):
        s = summary.get(key, {})
        print(
            f"{key:<10} | n={s.get('count')} | avg_min_to_hit={s.get('avg_minutes_to_hit')} | "
            f"avg_vol_z={s.get('avg_hit_volume_zscore')} | avg_fwd_ret%={s.get('avg_forward_return_pct')} | "
            f"avg_cont%={s.get('avg_continuation_move_pct_of_level')}"
        )

    if args.events_csv:
        csv_path = os.path.abspath(args.events_csv)
        os.makedirs(os.path.dirname(csv_path), exist_ok=True)
        write_events_csv(csv_path, events)
        print(f"\nWrote events CSV: {csv_path}")

    if args.output:
        out_path = os.path.abspath(args.output)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w") as f:
            json.dump(result, f, indent=2)
        print(f"Wrote JSON report: {out_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
