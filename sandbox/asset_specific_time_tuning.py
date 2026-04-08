#!/usr/bin/env python3
"""
Cross-asset hour/filter tuning with a quick walk-forward check.

Methodology (same family used in recent PAX studies):
- Build 1h anchors from historical 5m candles
- Evaluate chosen ET hours on weekdays only
- Features:
  - vol_ratio = prev_hour_volume / mean(last_24h_hourly_volume)
  - bull6 = bullish fraction in the last 6 hourly candles
- Simulate entries on hour close, exits on next 5m path
- Grid-search side/hour/filter/SL/TP
- Report:
  - best in-sample candidate per asset
  - 65/35 time-based walk-forward stats
"""

from __future__ import annotations

import argparse
import os
import statistics
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable
from zoneinfo import ZoneInfo

from liquidity_zones import list_sessions_with_symbol, load_5m_candles

ET = ZoneInfo("America/New_York")


@dataclass
class Sample:
    ms: int
    hour: int
    entry: float
    fut: list[dict]
    vol_ratio: float
    bull6: float


def ms_to_et(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(ET)


def aggregate_1h(candles_5m: list[dict]) -> list[dict]:
    out: list[dict] = []
    bucket: list[dict] = []
    for c in candles_5m:
        hour_ms = (c["bucket_start_ms"] // 3_600_000) * 3_600_000
        if bucket and bucket[0]["_hour_ms"] != hour_ms:
            out.append(
                {
                    "ms": bucket[0]["_hour_ms"],
                    "open": bucket[0]["open"],
                    "high": max(x["high"] for x in bucket),
                    "low": min(x["low"] for x in bucket),
                    "close": bucket[-1]["close"],
                    "vol": sum(x["volume"] for x in bucket),
                }
            )
            bucket = []
        bucket.append({**c, "_hour_ms": hour_ms})
    if bucket:
        out.append(
            {
                "ms": bucket[0]["_hour_ms"],
                "open": bucket[0]["open"],
                "high": max(x["high"] for x in bucket),
                "low": min(x["low"] for x in bucket),
                "close": bucket[-1]["close"],
                "vol": sum(x["volume"] for x in bucket),
            }
        )
    return out


def slice_5m(candles_5m: list[dict], from_ms: int, to_ms: int) -> list[dict]:
    lo, hi = 0, len(candles_5m)
    while lo < hi:
        mid = (lo + hi) // 2
        if candles_5m[mid]["bucket_start_ms"] < from_ms:
            lo = mid + 1
        else:
            hi = mid
    start = lo
    lo, hi = start, len(candles_5m)
    while lo < hi:
        mid = (lo + hi) // 2
        if candles_5m[mid]["bucket_start_ms"] <= to_ms:
            lo = mid + 1
        else:
            hi = mid
    return candles_5m[start:lo]


def simulate_trade(
    entry: float,
    fut_5m: list[dict],
    side: str,
    sl_pct: float,
    tp_mult: float,
    fee_bps_rt: float,
) -> tuple[float, str]:
    if side == "long":
        stop = entry * (1 - sl_pct / 100.0)
        target = entry * (1 + (sl_pct * tp_mult) / 100.0)
    else:
        stop = entry * (1 + sl_pct / 100.0)
        target = entry * (1 - (sl_pct * tp_mult) / 100.0)

    exit_px = fut_5m[-1]["close"]
    hit = "timeout"
    for bar in fut_5m:
        if side == "long":
            hit_stop = bar["low"] <= stop
            hit_tp = bar["high"] >= target
        else:
            hit_stop = bar["high"] >= stop
            hit_tp = bar["low"] <= target
        if hit_stop and hit_tp:
            exit_px, hit = stop, "stop"
            break
        if hit_stop:
            exit_px, hit = stop, "stop"
            break
        if hit_tp:
            exit_px, hit = target, "tp"
            break

    gross_pct = ((exit_px - entry) / entry * 100.0) if side == "long" else ((entry - exit_px) / entry * 100.0)
    gross_r = gross_pct / sl_pct
    fee_pct = (fee_bps_rt / 10_000.0) * 100.0
    fee_r = fee_pct / sl_pct
    return gross_r - fee_r, hit


def compute_metrics(trades: list[dict], min_n: int) -> dict | None:
    if len(trades) < min_n:
        return None
    ts = sorted(trades, key=lambda x: x["ms"])
    rs = [x["r"] for x in ts]
    n = len(rs)
    win = (sum(1 for r in rs if r > 0) / n) * 100.0
    gp = sum(r for r in rs if r > 0)
    gl = abs(sum(r for r in rs if r <= 0))
    pf = (gp / gl) if gl > 0 else 999.0
    return {"n": n, "win": win, "avg": sum(rs) / n, "pf": pf, "tot": sum(rs)}


def build_samples(
    candles_5m: list[dict],
    candles_1h: list[dict],
    hours: list[int],
    hold_hours: int,
) -> list[Sample]:
    samples: list[Sample] = []
    for i, b in enumerate(candles_1h):
        d = ms_to_et(b["ms"])
        if d.weekday() >= 5 or d.hour not in hours:
            continue
        if i < 24 or i + hold_hours >= len(candles_1h):
            continue
        prev1 = candles_1h[i - 1]
        prev6 = candles_1h[i - 6 : i]
        prev24 = candles_1h[i - 24 : i]
        vol_ratio = prev1["vol"] / (statistics.mean(x["vol"] for x in prev24) + 1e-9)
        bull6 = sum(1 for x in prev6 if x["close"] > x["open"]) / len(prev6)
        fut = slice_5m(candles_5m, b["ms"] + 5 * 60 * 1000, b["ms"] + hold_hours * 3_600_000)
        if len(fut) < 40:
            continue
        samples.append(
            Sample(
                ms=b["ms"],
                hour=d.hour,
                entry=b["close"],
                fut=fut,
                vol_ratio=vol_ratio,
                bull6=bull6,
            )
        )
    return sorted(samples, key=lambda s: s.ms)


def build_filters(base_samples: list[Sample], side: str) -> list[tuple[str, Callable[[Sample], bool]]]:
    vol = sorted(s.vol_ratio for s in base_samples)
    q60 = vol[int(len(vol) * 0.60)]
    q70 = vol[int(len(vol) * 0.70)]
    if side == "long":
        return [
            ("none", lambda x: True),
            ("vol>=q60", lambda x: x.vol_ratio >= q60),
            ("vol>=q60 & bull6>=0.5", lambda x: x.vol_ratio >= q60 and x.bull6 >= 0.5),
            ("vol>=q70 & bull6>=0.5", lambda x: x.vol_ratio >= q70 and x.bull6 >= 0.5),
        ]
    return [
        ("none", lambda x: True),
        ("vol>=q60", lambda x: x.vol_ratio >= q60),
        ("vol>=q60 & bull6<=0.5", lambda x: x.vol_ratio >= q60 and x.bull6 <= 0.5),
        ("vol>=q70 & bull6<=0.5", lambda x: x.vol_ratio >= q70 and x.bull6 <= 0.5),
    ]


def main() -> None:
    ap = argparse.ArgumentParser(description="Cross-asset hour/filter tuning + walk-forward check.")
    ap.add_argument("--db", default="backtester/data/backtest.sqlite", help="SQLite DB path")
    ap.add_argument("--assets", default="PAXGUSDT,BTCUSDT,SOLUSDT,XRPUSDT,LINKUSDT,DOGEUSDT")
    ap.add_argument("--hours", default="14,19,20,21,22")
    ap.add_argument("--fee-bps", type=float, default=6.0, help="Round-trip fees in bps")
    ap.add_argument("--hold-hours", type=int, default=6)
    ap.add_argument("--min-n", type=int, default=20)
    args = ap.parse_args()

    db = os.path.abspath(args.db)
    assets = [x.strip() for x in args.assets.split(",") if x.strip()]
    hours = [int(x.strip()) for x in args.hours.split(",") if x.strip()]
    sl_grid = [0.25, 0.30, 0.35, 0.40, 0.50, 0.60, 0.75, 1.00]
    tp_grid = [1.0, 1.25, 1.5, 2.0, 2.5, 3.0]

    print("=== Cross-Asset Tuning (in-sample + walk-forward) ===")
    print(f"DB: {db}")
    print(f"Assets: {', '.join(assets)}")
    print(f"Hours ET: {hours}")
    print(f"Fee bps RT: {args.fee_bps}")
    print(f"Hold hours: {args.hold_hours}")

    for sym in assets:
        try:
            sid = list_sessions_with_symbol(db, sym)[0][0]
        except Exception:
            print(f"\n[{sym}] skipped (no historical session found)")
            continue

        c5 = load_5m_candles(db, sid, sym)
        h1 = aggregate_1h(c5)
        samples = build_samples(c5, h1, hours, args.hold_hours)
        if len(samples) < 120:
            print(f"\n[{sym}] skipped (not enough samples: {len(samples)})")
            continue

        cut = int(len(samples) * 0.65)
        train = samples[:cut]
        test = samples[cut:]
        lf = build_filters(train, "long")
        sf = build_filters(train, "short")

        best_rules: list[dict] = []
        for side, filters in [("long", lf), ("short", sf)]:
            for hr in hours:
                hs = [s for s in train if s.hour == hr]
                candidates: list[tuple] = []
                for fname, fn in filters:
                    sub = [s for s in hs if fn(s)]
                    if len(sub) < 25:
                        continue
                    for sl in sl_grid:
                        for tp in tp_grid:
                            trades = []
                            for s in sub:
                                r, hit = simulate_trade(s.entry, s.fut, side, sl, tp, args.fee_bps)
                                trades.append({"ms": s.ms, "r": r, "hit": hit})
                            m = compute_metrics(trades, args.min_n)
                            if m:
                                candidates.append((m["avg"], m["pf"], m["win"], m["n"], fname, sl, tp, m))
                if candidates:
                    candidates.sort(reverse=True)
                    _, _, _, _, fname, sl, tp, m = candidates[0]
                    best_rules.append({"side": side, "hour": hr, "filter": fname, "sl": sl, "tp": tp, "train": m})

        if not best_rules:
            print(f"\n[{sym}] no candidate rules")
            continue

        fmap_l = dict(lf)
        fmap_s = dict(sf)

        def apply_combo(data: list[Sample], long_rule: dict, short_rule: dict | None) -> dict | None:
            trades = []
            for s in data:
                if s.hour == long_rule["hour"] and fmap_l[long_rule["filter"]](s):
                    r, hit = simulate_trade(s.entry, s.fut, "long", long_rule["sl"], long_rule["tp"], args.fee_bps)
                    trades.append({"ms": s.ms, "r": r, "hit": hit})
                if short_rule and s.hour == short_rule["hour"] and fmap_s[short_rule["filter"]](s):
                    r, hit = simulate_trade(s.entry, s.fut, "short", short_rule["sl"], short_rule["tp"], args.fee_bps)
                    trades.append({"ms": s.ms, "r": r, "hit": hit})
            return compute_metrics(trades, args.min_n)

        long_rules = [r for r in best_rules if r["side"] == "long"]
        short_rules = [r for r in best_rules if r["side"] == "short"]
        combos: list[tuple] = []

        for lr in long_rules:
            tr = apply_combo(train, lr, None)
            te = apply_combo(test, lr, None)
            if tr and te:
                label = f"L{lr['hour']:02d} {lr['filter']} {lr['sl']:.2f}/{lr['tp']:.2f}"
                combos.append((tr["avg"], te["avg"], tr["pf"], te["pf"], label, tr, te))

        for lr in long_rules:
            for sr in short_rules:
                if lr["hour"] == sr["hour"]:
                    continue
                tr = apply_combo(train, lr, sr)
                te = apply_combo(test, lr, sr)
                if tr and te and te["n"] >= 40:
                    label = (
                        f"L{lr['hour']:02d} {lr['filter']} {lr['sl']:.2f}/{lr['tp']:.2f} + "
                        f"S{sr['hour']:02d} {sr['filter']} {sr['sl']:.2f}/{sr['tp']:.2f}"
                    )
                    combos.append((tr["avg"], te["avg"], tr["pf"], te["pf"], label, tr, te))

        if not combos:
            print(f"\n[{sym}] no valid walk-forward combos")
            continue

        combos.sort(key=lambda x: (x[0], x[1], x[2], x[3]), reverse=True)
        best = combos[0]
        print(f"\n[{sym}] {best[4]}")
        print(
            "  TRAIN: "
            f"n={best[5]['n']} win={best[5]['win']:.1f}% avgR={best[5]['avg']:+.4f} pf={best[5]['pf']:.2f}"
        )
        print(
            "  TEST : "
            f"n={best[6]['n']} win={best[6]['win']:.1f}% avgR={best[6]['avg']:+.4f} pf={best[6]['pf']:.2f}"
        )


if __name__ == "__main__":
    main()
