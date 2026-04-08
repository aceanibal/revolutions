#!/usr/bin/env python3
"""
Strategy + sizing lab (XRP, 1:1 TP/SL by default).

What this script does:
1) Builds reversal setups from existing scanner snapshots.
2) Sweeps strategy filters (pattern/zone/side/window/cap).
3) Computes fee-adjusted edge per strategy.
4) Runs position-sizing simulations and ranks best risk-adjusted outcomes.

Usage:
  python sandbox/position_sizing_lab.py
  python sandbox/position_sizing_lab.py --fee-bps-rt 6 --min-n 300 --top-k 20
"""

from __future__ import annotations

import argparse
import os
import statistics
from collections import defaultdict

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


DB_PATH = os.path.join(os.path.dirname(__file__), "..", "backtester", "data", "backtest.sqlite")


def in_window(hour_et: int, window: tuple[int, int] | None) -> bool:
    if window is None:
        return True
    a, b = window
    if a < b:
        return a <= hour_et < b
    return hour_et >= a or hour_et < b


def max_losing_streak(net_r: list[float]) -> int:
    m = 0
    cur = 0
    for x in net_r:
        if x <= 0:
            cur += 1
            m = max(m, cur)
        else:
            cur = 0
    return m


def equity_curve(net_r: list[float], sizing_mode: str, base_risk: float, p1: float, p2: float) -> dict:
    """
    sizing_mode:
      - fixed: risk fraction = base_risk every trade
      - anti:  after win, multiply risk by p1 up to p2 cap; after loss reset to base
      - prog:  after loss, multiply risk by p1 up to p2 cap; after win reset to base
    """
    eq = 10_000.0
    peak = eq
    max_dd = 0.0
    risk_f = base_risk
    ruined = False

    for r in net_r:
        pnl = eq * risk_f * r
        eq += pnl
        if eq <= 0:
            ruined = True
            eq = 0.0
            break
        peak = max(peak, eq)
        dd = (peak - eq) / peak if peak > 0 else 0.0
        max_dd = max(max_dd, dd)

        if sizing_mode == "fixed":
            risk_f = base_risk
        elif sizing_mode == "anti":
            if r > 0:
                risk_f = min(risk_f * p1, p2)
            else:
                risk_f = base_risk
        elif sizing_mode == "prog":
            if r <= 0:
                risk_f = min(risk_f * p1, p2)
            else:
                risk_f = base_risk
        else:
            raise ValueError(f"Unknown sizing mode: {sizing_mode}")

    return dict(final_eq=eq, ret_pct=(eq / 10_000 - 1) * 100, max_dd=max_dd * 100, ruined=ruined)


def build_setups() -> tuple[list[dict], dict[int, list[dict]]]:
    sid = list_sessions_with_symbol(DB_PATH, "XRPUSDT")[0][0]
    snapshots = load_scanner_cache(scanner_cache_path(sid, "XRPUSDT", 7))
    candles_5m = load_5m_candles(DB_PATH, sid, "XRPUSDT")
    candles_1m = load_1m_candles(DB_PATH, sid, "XRPUSDT")

    setups: list[dict] = []
    overnight_ms = 15 * 3600 * 1000

    for snap in snapshots:
        anchor_ms = snap["anchor_ms"]
        anchor_dt = ms_to_et(anchor_ms)
        if anchor_dt.weekday() >= 5:
            continue

        o5m = slice_candles(candles_5m, anchor_ms, anchor_ms + overnight_ms)
        if len(o5m) < 6:
            continue

        zones = dedupe_nearby_levels(flatten_zones(snap))
        found = detect_reversals_5m(o5m, zones, touch_pct=0.10)
        for s in found:
            s["anchor_date"] = anchor_dt.strftime("%Y-%m-%d")
            s["hour_et"] = ms_to_et(s["time_ms"]).hour
        setups.extend(found)

    bars_per = {
        id(s): slice_candles(candles_1m, s["time_ms"] + 5 * 60000, s["time_ms"] + 125 * 60000)
        for s in setups
    }
    return setups, bars_per


def sim_trade(
    setup: dict,
    bars_1m: list[dict],
    tp_r: float,
    sl_mult: float,
    fee_bps_rt: float,
    min_risk_pct: float,
) -> dict | None:
    if not bars_1m:
        return None
    entry = setup["entry_price"]
    stop = setup["stop_price"]
    side = setup["side"]
    risk_px = abs(entry - stop) * sl_mult
    if risk_px <= 0:
        return None

    if side == "long":
        sl_p = entry - risk_px
        tp_p = entry + tp_r * risk_px
    else:
        sl_p = entry + risk_px
        tp_p = entry - tp_r * risk_px

    exit_price = entry
    exit_ms = bars_1m[-1]["bucket_start_ms"]
    for b in bars_1m:
        hi, lo = b["high"], b["low"]
        if side == "long":
            stopped = lo <= sl_p
            tped = hi >= tp_p
        else:
            stopped = hi >= sl_p
            tped = lo <= tp_p

        if stopped and not tped:
            exit_price = sl_p
            exit_ms = b["bucket_start_ms"]
            break
        if tped and not stopped:
            exit_price = tp_p
            exit_ms = b["bucket_start_ms"]
            break
        if stopped and tped:
            # Conservative tie-break on ambiguous OHLC intrabar: stop first.
            exit_price = sl_p
            exit_ms = b["bucket_start_ms"]
            break

    gross_r = (exit_price - entry) / risk_px if side == "long" else (entry - exit_price) / risk_px
    risk_pct = (risk_px / entry) * 100 if entry > 0 else 0.0
    if risk_pct < min_risk_pct:
        return None
    fee_pct = fee_bps_rt / 10000.0
    fee_r = fee_pct / (risk_pct / 100.0) if risk_pct > 0 else 0.0
    net_r = gross_r - fee_r
    return dict(time_ms=setup["time_ms"], exit_ms=exit_ms, gross_r=gross_r, net_r=net_r)


def oaat(trades: list[dict]) -> list[dict]:
    out: list[dict] = []
    busy_until = -1
    for t in sorted(trades, key=lambda x: x["time_ms"]):
        if t["time_ms"] < busy_until:
            continue
        out.append(t)
        busy_until = t["exit_ms"]
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tp-r", type=float, default=1.0)
    ap.add_argument("--sl-mult", type=float, default=1.0)
    ap.add_argument("--fee-bps-rt", type=float, default=6.0, help="Round-trip fee in bps (e.g., 6 = 0.06%%)")
    ap.add_argument("--min-risk-pct", type=float, default=0.20, help="Drop trades with stop distance below this percent")
    ap.add_argument("--min-n", type=int, default=300)
    ap.add_argument("--top-k", type=int, default=20)
    args = ap.parse_args()

    setups, bars_per = build_setups()
    patterns = sorted({s["pattern"] for s in setups})
    zones = sorted({s["zone_type"] for s in setups})

    pattern_sets = [
        ("all_patterns", set(patterns)),
        ("eng+pin", {"engulfing", "pin_bar"}),
        ("pin+es", {"pin_bar", "evening_star"}),
        ("pin+ms", {"pin_bar", "morning_star"}),
        ("engulfing", {"engulfing"}),
        ("pin_bar", {"pin_bar"}),
        ("stars_only", {"morning_star", "evening_star"}),
    ]
    zone_sets = [
        ("all_zones", set(zones)),
        ("major_only", {"week_low", "week_high", "pdh", "pdl", "hvn"}),
        ("week_levels", {"week_low", "week_high"}),
        ("day_levels", {"pdh", "pdl"}),
        ("hvn_only", {"hvn"}),
    ]
    side_sets = [("both", {"long", "short"}), ("long_only", {"long"}), ("short_only", {"short"})]
    windows = [
        ("all_hours", None),
        ("17_08", (17, 8)),
        ("17_21", (17, 21)),
        ("21_08", (21, 8)),
    ]
    caps = [("cap_none", None), ("cap_2", 2), ("cap_3", 3)]

    strat_rows = []
    for pname, pset in pattern_sets:
        for zname, zset in zone_sets:
            for sname, sset in side_sets:
                for wname, w in windows:
                    for cname, cap in caps:
                        subset = [
                            s
                            for s in setups
                            if s["pattern"] in pset
                            and s["zone_type"] in zset
                            and s["side"] in sset
                            and in_window(s["hour_et"], w)
                        ]
                        if len(subset) < args.min_n:
                            continue

                        # simulate
                        trades = []
                        for s in subset:
                            t = sim_trade(
                                s,
                                bars_per[id(s)],
                                args.tp_r,
                                args.sl_mult,
                                args.fee_bps_rt,
                                args.min_risk_pct,
                            )
                            if t:
                                t["anchor_date"] = s["anchor_date"]
                                trades.append(t)
                        if len(trades) < args.min_n:
                            continue

                        # cap trades/day if configured
                        if cap is not None:
                            by_day = defaultdict(list)
                            for t in sorted(trades, key=lambda x: x["time_ms"]):
                                by_day[t["anchor_date"]].append(t)
                            capped = []
                            for day in sorted(by_day):
                                capped.extend(by_day[day][:cap])
                            trades = capped
                            if len(trades) < args.min_n:
                                continue

                        trades = oaat(trades)
                        if len(trades) < args.min_n:
                            continue

                        net_r = [t["net_r"] for t in trades]
                        gross_r = [t["gross_r"] for t in trades]
                        wins = sum(1 for x in net_r if x > 0)
                        n = len(net_r)
                        gp = sum(x for x in net_r if x > 0)
                        gl = abs(sum(x for x in net_r if x <= 0))
                        pf = gp / gl if gl > 0 else 999
                        avg = statistics.mean(net_r)
                        max_ls = max_losing_streak(net_r)

                        strat_rows.append(
                            dict(
                                name=f"{pname} | {zname} | {sname} | {wname} | {cname}",
                                n=n,
                                win_rate=wins / n * 100,
                                avg_net_r=avg,
                                total_net_r=sum(net_r),
                                total_gross_r=sum(gross_r),
                                pf=pf,
                                max_ls=max_ls,
                                net_r=net_r,
                            )
                        )

    strat_rows = sorted(strat_rows, key=lambda x: (-x["avg_net_r"], -x["pf"], -x["win_rate"], -x["n"]))
    top = strat_rows[: args.top_k]

    print(f"Strategies passing filters: {len(strat_rows)}")
    print("\n=== Top Strategies (post-fees) ===")
    print(f"{'Strategy':<78} {'N':>5} {'Win%':>6} {'AvgNetR':>8} {'PF':>5} {'MaxLS':>6} {'TotNetR':>9}")
    for s in top:
        print(
            f"{s['name']:<78} {s['n']:>5} {s['win_rate']:>6.1f} {s['avg_net_r']:>+8.4f} "
            f"{s['pf']:>5.2f} {s['max_ls']:>6} {s['total_net_r']:>+9.1f}"
        )

    # Sizing optimization on top strategies
    size_results = []
    for s in top:
        net_r = s["net_r"]
        # fixed fraction grid
        for f in [0.001, 0.002, 0.003, 0.005, 0.0075, 0.01, 0.015, 0.02]:
            e = equity_curve(net_r, "fixed", f, 1.0, f)
            score = (e["ret_pct"] / max(e["max_dd"], 1e-9)) if e["max_dd"] > 0 else 999
            size_results.append(
                dict(strategy=s["name"], mode="fixed", params=f"risk={f*100:.2f}%", score=score, **e)
            )

        # anti-martingale (press winners)
        for base in [0.001, 0.002, 0.003, 0.005]:
            for mult in [1.25, 1.5]:
                for cap in [0.01, 0.015, 0.02]:
                    e = equity_curve(net_r, "anti", base, mult, cap)
                    score = (e["ret_pct"] / max(e["max_dd"], 1e-9)) if e["max_dd"] > 0 else 999
                    size_results.append(
                        dict(
                            strategy=s["name"],
                            mode="anti",
                            params=f"base={base*100:.2f}% x{mult} cap={cap*100:.2f}%",
                            score=score,
                            **e,
                        )
                    )

        # capped progression (loss-chasing, controlled)
        for base in [0.0005, 0.001, 0.002]:
            for mult in [1.25, 1.5]:
                for cap in [0.01, 0.015]:
                    e = equity_curve(net_r, "prog", base, mult, cap)
                    score = (e["ret_pct"] / max(e["max_dd"], 1e-9)) if e["max_dd"] > 0 else 999
                    size_results.append(
                        dict(
                            strategy=s["name"],
                            mode="prog",
                            params=f"base={base*100:.2f}% x{mult} cap={cap*100:.2f}%",
                            score=score,
                            **e,
                        )
                    )

    # Keep sane risk (avoid casino blowups): max DD <= 40%
    sane = [x for x in size_results if not x["ruined"] and x["max_dd"] <= 40]
    sane_sorted = sorted(sane, key=lambda x: (x["score"], x["ret_pct"]), reverse=True)

    print("\n=== Best Sizing Combos (MaxDD <= 40%) ===")
    print(f"{'Mode':<6} {'Params':<33} {'Return%':>9} {'MaxDD%':>8} {'Score':>8}  Strategy")
    for r in sane_sorted[:15]:
        print(
            f"{r['mode']:<6} {r['params']:<33} {r['ret_pct']:>+8.1f}% {r['max_dd']:>7.1f}% "
            f"{r['score']:>8.2f}  {r['strategy']}"
        )

    # Also show top by absolute return under strict DD cap
    strict = [x for x in size_results if not x["ruined"] and x["max_dd"] <= 25]
    strict_sorted = sorted(strict, key=lambda x: x["ret_pct"], reverse=True)
    if strict_sorted:
        print("\n=== Highest Return with MaxDD <= 25% ===")
        for r in strict_sorted[:10]:
            print(
                f"{r['mode']:<6} {r['params']:<33} ret={r['ret_pct']:+.1f}% dd={r['max_dd']:.1f}% "
                f"score={r['score']:.2f} | {r['strategy']}"
            )


if __name__ == "__main__":
    main()
