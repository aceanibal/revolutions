#!/usr/bin/env python3
"""
Render candlestick charts for every daily-extreme touch occurrence.

Input:
  - JSON report produced by daily_extreme_hit_study.py

Output:
  - One folder per event with:
      - 5m_candles.png
      - 1m_candles.png
      - event.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

from liquidity_zones import DB_PATH, load_5m_candles, load_scanner_cache, ms_to_et, scanner_cache_path
from reversal_study import load_1m_candles, slice_candles
from strategy_sim import OVERNIGHT_MS


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Render daily-extreme occurrence candlestick charts")
    p.add_argument("--study-json", required=True, help="daily_extreme_hit_study.py JSON output (metadata)")
    p.add_argument(
        "--events-json",
        default="",
        help="Optional JSON array of events only (e.g. filtered daily_events_filtered.json). "
        "If omitted, uses study.events.",
    )
    p.add_argument("--db", default=DB_PATH)
    p.add_argument("--out-dir", default="", help="Output root folder for images")
    p.add_argument("--pre-1m-minutes", type=int, default=90)
    p.add_argument("--post-1m-minutes", type=int, default=120)
    return p.parse_args()


def draw_candles(ax: Any, candles: list[dict[str, Any]], timeframe_minutes: int) -> None:
    if not candles:
        return
    width_days = (timeframe_minutes / (24 * 60)) * 0.75
    for c in candles:
        t = mdates.date2num(ms_to_et(int(c["bucket_start_ms"])))
        o = float(c["open"])
        h = float(c["high"])
        l = float(c["low"])
        cl = float(c["close"])
        up = cl >= o
        color = "#1f9d55" if up else "#c0392b"
        ax.plot([t, t], [l, h], color=color, linewidth=0.8, alpha=0.95)
        body_low = min(o, cl)
        body_h = abs(cl - o)
        if body_h == 0:
            body_h = max((h - l) * 0.02, 1e-9)
        rect = Rectangle((t - width_days / 2, body_low), width_days, body_h, facecolor=color, edgecolor=color, alpha=0.9)
        ax.add_patch(rect)


def _extreme_box_text(event_type: str, level: float, pdh: float | None, pdl: float | None, wh: float | None, wl: float | None) -> str:
    lines = [f"Hit: {event_type} @ {level:.6f}"]
    if pdh is not None:
        lines.append(f"PDH: {pdh:.6f}")
    if pdl is not None:
        lines.append(f"PDL: {pdl:.6f}")
    if wh is not None:
        lines.append(f"WkHigh: {wh:.6f}")
    if wl is not None:
        lines.append(f"WkLow: {wl:.6f}")
    return "\n".join(lines)


def save_event(
    event_idx: int,
    event: dict[str, Any],
    snapshots_by_anchor: dict[int, dict[str, Any]],
    candles_5m: list[dict[str, Any]],
    candles_1m: list[dict[str, Any]],
    out_root: str,
    pre_1m_minutes: int,
    post_1m_minutes: int,
) -> None:
    anchor_ms = int(event["anchor_ms"])
    hit_ms = int(event["hit_ms"])
    event_type = str(event["event_type"])
    level = float(event["level"])

    snap = snapshots_by_anchor.get(anchor_ms, {})
    pdh = float(snap["previous_day_high"]) if snap.get("previous_day_high") is not None else None
    pdl = float(snap["previous_day_low"]) if snap.get("previous_day_low") is not None else None
    wh = float(snap["week_high"]) if snap.get("week_high") is not None else None
    wl = float(snap["week_low"]) if snap.get("week_low") is not None else None

    event_dir = os.path.join(out_root, f"{event_idx:03d}_{event_type}_{event['session_day']}")
    os.makedirs(event_dir, exist_ok=True)

    overnight_5m = slice_candles(candles_5m, anchor_ms, anchor_ms + OVERNIGHT_MS)
    fig5, ax5 = plt.subplots(figsize=(16, 7))
    draw_candles(ax5, overnight_5m, timeframe_minutes=5)
    ax5.axvline(ms_to_et(hit_ms), color="purple", linestyle="--", linewidth=1.2, label=f"{event_type} hit")
    ax5.axhline(level, color="black", linestyle="-", linewidth=1.2, label=f"{event_type}={level:.6f}")
    if pdh is not None:
        ax5.axhline(pdh, color="#d35400", linestyle=":", linewidth=1.0, label=f"PDH={pdh:.6f}")
    if pdl is not None:
        ax5.axhline(pdl, color="#16a085", linestyle=":", linewidth=1.0, label=f"PDL={pdl:.6f}")
    if wh is not None:
        ax5.axhline(wh, color="#8e44ad", linestyle="--", linewidth=0.9, label=f"WkHigh={wh:.6f}")
    if wl is not None:
        ax5.axhline(wl, color="#2c3e50", linestyle="--", linewidth=0.9, label=f"WkLow={wl:.6f}")
    ax5.text(
        0.01,
        0.99,
        _extreme_box_text(event_type, level, pdh, pdl, wh, wl),
        transform=ax5.transAxes,
        va="top",
        ha="left",
        fontsize=9,
        bbox=dict(boxstyle="round", facecolor="white", alpha=0.8, edgecolor="#444444"),
    )
    ax5.set_title(f"5m Candles | {event['session_day']} | {event_type} touch at {event['hit_et']} ET")
    ax5.set_ylabel("Price")
    ax5.grid(alpha=0.2)
    ax5.legend(loc="best", fontsize=8)
    ax5.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d %H:%M", tz=ms_to_et(hit_ms).tzinfo))
    fig5.autofmt_xdate()
    fig5.tight_layout()
    fig5.savefig(os.path.join(event_dir, "5m_candles.png"), dpi=160)
    plt.close(fig5)

    one_m_start = hit_ms - pre_1m_minutes * 60_000
    one_m_end = hit_ms + post_1m_minutes * 60_000
    zoom_1m = slice_candles(candles_1m, one_m_start, one_m_end)
    fig1, ax1 = plt.subplots(figsize=(16, 7))
    draw_candles(ax1, zoom_1m, timeframe_minutes=1)
    ax1.axvline(ms_to_et(hit_ms), color="purple", linestyle="--", linewidth=1.2, label=f"{event_type} hit")
    ax1.axhline(level, color="black", linestyle="-", linewidth=1.2, label=f"{event_type}={level:.6f}")
    if pdh is not None:
        ax1.axhline(pdh, color="#d35400", linestyle=":", linewidth=0.9, label=f"PDH={pdh:.6f}")
    if pdl is not None:
        ax1.axhline(pdl, color="#16a085", linestyle=":", linewidth=0.9, label=f"PDL={pdl:.6f}")
    ax1.text(
        0.01,
        0.99,
        _extreme_box_text(event_type, level, pdh, pdl, wh, wl),
        transform=ax1.transAxes,
        va="top",
        ha="left",
        fontsize=9,
        bbox=dict(boxstyle="round", facecolor="white", alpha=0.8, edgecolor="#444444"),
    )
    ax1.set_title(f"1m Candles | {event['session_day']} | +/- window around hit")
    ax1.set_ylabel("Price")
    ax1.grid(alpha=0.2)
    ax1.legend(loc="best", fontsize=8)
    ax1.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d %H:%M", tz=ms_to_et(hit_ms).tzinfo))
    fig1.autofmt_xdate()
    fig1.tight_layout()
    fig1.savefig(os.path.join(event_dir, "1m_candles.png"), dpi=160)
    plt.close(fig1)

    with open(os.path.join(event_dir, "event.json"), "w") as f:
        json.dump(event, f, indent=2)


def main() -> int:
    args = parse_args()
    with open(args.study_json) as f:
        study = json.load(f)

    session_id = str(study.get("session_id", "")).strip()
    symbol = str(study.get("symbol", "")).strip().upper()
    lookback_days = int(study.get("lookback_days", 7))
    if args.events_json:
        with open(args.events_json) as f:
            events = json.load(f)
        if not isinstance(events, list):
            print("ERROR: --events-json must be a JSON array", file=sys.stderr)
            return 1
    else:
        events = study.get("events", [])
    if not session_id or not symbol:
        print("ERROR: study json missing session_id/symbol", file=sys.stderr)
        return 1
    if not isinstance(events, list) or not events:
        print("ERROR: study json has no events", file=sys.stderr)
        return 1

    out_root = args.out_dir
    if not out_root:
        out_root = os.path.join(
            os.path.dirname(__file__),
            "cache",
            f"daily_extreme_occurrences_{symbol.lower()}",
        )
    out_root = os.path.abspath(out_root)
    os.makedirs(out_root, exist_ok=True)

    db = os.path.abspath(args.db)
    if not os.path.isfile(db):
        print(f"ERROR: db not found: {db}", file=sys.stderr)
        return 1

    cache_file = scanner_cache_path(session_id, symbol, lookback_days)
    snapshots = load_scanner_cache(cache_file) or []
    snapshots_by_anchor = {int(s.get("anchor_ms", 0)): s for s in snapshots if int(s.get("anchor_ms", 0)) > 0}

    candles_5m = load_5m_candles(db, session_id, symbol)
    candles_1m = load_1m_candles(db, session_id, symbol)
    if not candles_5m or not candles_1m:
        print("ERROR: candles missing for symbol/session", file=sys.stderr)
        return 1

    for i, event in enumerate(events):
        save_event(
            event_idx=i,
            event=event,
            snapshots_by_anchor=snapshots_by_anchor,
            candles_5m=candles_5m,
            candles_1m=candles_1m,
            out_root=out_root,
            pre_1m_minutes=args.pre_1m_minutes,
            post_1m_minutes=args.post_1m_minutes,
        )

    print(f"Saved {len(events)} occurrence folders to: {out_root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
