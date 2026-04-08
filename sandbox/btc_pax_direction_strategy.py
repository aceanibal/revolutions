#!/usr/bin/env python3
"""
BTC -> PAX direction strategy lab (5m, historical).

Goal:
  Use BTCUSDT 5m data as a directional signal for trading PAXGUSDT 5m.
  This script builds and evaluates simple "guess direction" strategies.

Strategies tested:
  1) Mirror BTC 5m return sign (always trade).
  2) Mirror BTC sign only on large BTC moves (quantile filters).
  3) Composite BTC momentum score (multi-horizon + EMA trend), thresholded.

Execution model:
  - Signal at bar t close.
  - Enter PAX at t close, exit at t+1 close (single 5m hold).
  - Net return = directional PAX return - round-trip fee.

Usage:
  python sandbox/btc_pax_direction_strategy.py
  python sandbox/btc_pax_direction_strategy.py --fee-bps-rt 6
"""

from __future__ import annotations

import argparse
import math
import os
import sqlite3
import statistics
from collections import defaultdict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


DB_PATH = os.path.join(os.path.dirname(__file__), "..", "backtester", "data", "backtest.sqlite")
ET = ZoneInfo("America/New_York")


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


def sign(x: float) -> int:
    if x > 0:
        return 1
    if x < 0:
        return -1
    return 0


def ms_to_et(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(ET)


def pct_ret(a: float, b: float) -> float:
    if a == 0:
        return 0.0
    return (b - a) / a * 100


def evaluate_trades(trades: list[dict], fee_bps_rt: float) -> dict:
    if not trades:
        return dict(n=0, win=0.0, avg=0.0, total=0.0, pf=0.0, max_dd=0.0, max_ls=0)

    fee_pct = fee_bps_rt / 10000.0 * 100
    net = []
    for t in trades:
        gross = t["direction"] * t["pax_next_ret_pct"]
        net.append(gross - fee_pct)

    n = len(net)
    wins = sum(1 for x in net if x > 0)
    avg = statistics.mean(net)
    total = sum(net)

    gp = sum(x for x in net if x > 0)
    gl = abs(sum(x for x in net if x <= 0))
    pf = gp / gl if gl > 0 else 999.0

    eq = 0.0
    peak = 0.0
    max_dd = 0.0
    for x in net:
        eq += x
        peak = max(peak, eq)
        max_dd = max(max_dd, peak - eq)

    cur = 0
    max_ls = 0
    for x in net:
        if x <= 0:
            cur += 1
            max_ls = max(max_ls, cur)
        else:
            cur = 0

    return dict(
        n=n,
        win=wins / n * 100,
        avg=avg,
        total=total,
        pf=pf,
        max_dd=max_dd,
        max_ls=max_ls,
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fee-bps-rt", type=float, default=6.0, help="Round-trip fee in bps (6 = 0.06%%)")
    ap.add_argument("--min-n", type=int, default=300)
    args = ap.parse_args()

    pax_sid = list_hist_session(DB_PATH, "PAXGUSDT")
    btc_sid = list_hist_session(DB_PATH, "BTCUSDT")
    if not pax_sid or not btc_sid:
        raise SystemExit("Missing historical PAXGUSDT or BTCUSDT 5m data.")

    pax = load_5m(DB_PATH, pax_sid, "PAXGUSDT")
    btc = load_5m(DB_PATH, btc_sid, "BTCUSDT")
    print(f"PAX bars={len(pax)} BTC bars={len(btc)}")

    pax_by_ms = {r["bucket_start_ms"]: r for r in pax}
    btc_by_ms = {r["bucket_start_ms"]: r for r in btc}
    common_ms = sorted(set(pax_by_ms).intersection(btc_by_ms))
    if len(common_ms) < 2000:
        raise SystemExit("Not enough aligned bars.")
    print(f"Aligned bars={len(common_ms)}")

    # Build aligned panel with simple BTC features and PAX next return.
    rows: list[dict] = []
    ema = None
    alpha = 2 / (20 + 1)
    btc_ret_hist: list[float] = []
    vol_hist: list[float] = []

    for i in range(len(common_ms) - 1):
        ms = common_ms[i]
        ms_next = common_ms[i + 1]
        b = btc_by_ms[ms]
        p = pax_by_ms[ms]
        p_next = pax_by_ms[ms_next]

        btc_ret_1 = pct_ret(b["open"], b["close"])
        btc_ret_hist.append(btc_ret_1)
        vol_hist.append(b["volume"])

        if ema is None:
            ema = b["close"]
        else:
            ema = alpha * b["close"] + (1 - alpha) * ema

        if i < 25:
            continue

        btc_ret_3 = pct_ret(btc_by_ms[common_ms[i - 3]]["close"], b["close"])
        btc_ret_12 = pct_ret(btc_by_ms[common_ms[i - 12]]["close"], b["close"])
        btc_range = pct_ret(b["low"], b["high"])
        avg_vol_24 = statistics.mean(vol_hist[-24:])
        vol_ratio = b["volume"] / avg_vol_24 if avg_vol_24 > 0 else 1.0
        ema_dev = pct_ret(ema, b["close"])  # >0 means price above ema

        pax_next_ret = pct_ret(p["close"], p_next["close"])

        rows.append(
            dict(
                ms=ms,
                btc_ret_1=btc_ret_1,
                btc_ret_3=btc_ret_3,
                btc_ret_12=btc_ret_12,
                btc_range=btc_range,
                vol_ratio=vol_ratio,
                ema_dev=ema_dev,
                pax_next_ret_pct=pax_next_ret,
            )
        )

    print(f"Usable rows={len(rows)}")

    # Strategy 1: mirror BTC 1-bar sign
    s1 = []
    for r in rows:
        d = sign(r["btc_ret_1"])
        if d == 0:
            continue
        s1.append(dict(direction=d, pax_next_ret_pct=r["pax_next_ret_pct"]))
    m1 = evaluate_trades(s1, args.fee_bps_rt)
    print("\n=== Strategy 1: Mirror BTC 5m sign (always trade) ===")
    print(
        f"N={m1['n']} Win={m1['win']:.2f}% AvgNet={m1['avg']:+.4f}% PF={m1['pf']:.2f} "
        f"MaxLS={m1['max_ls']} TotNet={m1['total']:+.2f}% DD={m1['max_dd']:.2f}%"
    )

    # Strategy 2: mirror sign only on big BTC bars
    abs_btc = sorted(abs(r["btc_ret_1"]) for r in rows)
    quantiles = [0.50, 0.60, 0.70, 0.80, 0.90]
    s2_res = []
    for q in quantiles:
        thr = abs_btc[int(len(abs_btc) * q)]
        trades = []
        for r in rows:
            if abs(r["btc_ret_1"]) < thr:
                continue
            d = sign(r["btc_ret_1"])
            if d == 0:
                continue
            trades.append(dict(direction=d, pax_next_ret_pct=r["pax_next_ret_pct"]))
        m = evaluate_trades(trades, args.fee_bps_rt)
        s2_res.append((q, thr, m))

    print("\n=== Strategy 2: Follow BTC only on large BTC candles ===")
    print(f"{'q':>4} {'thr%':>8} {'N':>6} {'Win%':>7} {'AvgNet%':>9} {'PF':>6} {'MaxLS':>6} {'TotNet%':>10}")
    for q, thr, m in s2_res:
        print(
            f"{q:>4.2f} {thr:>8.4f} {m['n']:>6} {m['win']:>7.2f} {m['avg']:>+9.4f} "
            f"{m['pf']:>6.2f} {m['max_ls']:>6} {m['total']:>+10.2f}"
        )

    # Strategy 3: composite score
    # score components:
    #  + sign(ret1), + sign(ret3), + sign(ret12), + sign(ema_dev), + sign(ret1*vol_excess)
    # trade only if |score| >= threshold
    s3_res = []
    for thr in [1, 2, 3, 4, 5]:
        trades = []
        for r in rows:
            score = (
                sign(r["btc_ret_1"])
                + sign(r["btc_ret_3"])
                + sign(r["btc_ret_12"])
                + sign(r["ema_dev"])
                + sign(r["btc_ret_1"] * (r["vol_ratio"] - 1.0))
            )
            if abs(score) < thr:
                continue
            d = sign(score)
            if d == 0:
                continue
            trades.append(dict(direction=d, pax_next_ret_pct=r["pax_next_ret_pct"]))
        m = evaluate_trades(trades, args.fee_bps_rt)
        s3_res.append((thr, m))

    print("\n=== Strategy 3: BTC composite direction score ===")
    print(f"{'|score|>=':>10} {'N':>6} {'Win%':>7} {'AvgNet%':>9} {'PF':>6} {'MaxLS':>6} {'TotNet%':>10}")
    for thr, m in s3_res:
        print(
            f"{thr:>10} {m['n']:>6} {m['win']:>7.2f} {m['avg']:>+9.4f} "
            f"{m['pf']:>6.2f} {m['max_ls']:>6} {m['total']:>+10.2f}"
        )

    # Pick best by AvgNet with min N
    candidates = []
    candidates.append(("mirror_all", m1))
    for q, _, m in s2_res:
        candidates.append((f"mirror_q{int(q*100)}", m))
    for thr, m in s3_res:
        candidates.append((f"composite_t{thr}", m))
    candidates = [c for c in candidates if c[1]["n"] >= args.min_n]
    candidates.sort(key=lambda x: (x[1]["avg"], x[1]["pf"], x[1]["win"]), reverse=True)

    print("\n=== Best Candidate (min N filter) ===")
    if not candidates:
        print("No candidate met min N.")
    else:
        name, m = candidates[0]
        print(
            f"{name}: N={m['n']} Win={m['win']:.2f}% AvgNet={m['avg']:+.4f}% PF={m['pf']:.2f} "
            f"MaxLS={m['max_ls']} TotNet={m['total']:+.2f}% DD={m['max_dd']:.2f}%"
        )

    # A tiny "direction indicator" readout:
    # P(PAX up next | BTC up now), and same for down.
    up_cases = [r for r in rows if r["btc_ret_1"] > 0]
    dn_cases = [r for r in rows if r["btc_ret_1"] < 0]
    p_up_given_btc_up = sum(1 for r in up_cases if r["pax_next_ret_pct"] > 0) / len(up_cases) * 100 if up_cases else 0
    p_dn_given_btc_dn = sum(1 for r in dn_cases if r["pax_next_ret_pct"] < 0) / len(dn_cases) * 100 if dn_cases else 0
    print("\n=== BTC directional indicator (simple) ===")
    print(f"P(PAX up next | BTC up now)   = {p_up_given_btc_up:.2f}%")
    print(f"P(PAX down next | BTC down now)= {p_dn_given_btc_dn:.2f}%")

    # Candidate rule discovered in extended search:
    # Fade extreme BTC 5m impulse during NY overlap, hold PAX longer than 1 bar.
    # (This can show tiny pre-fee edge, usually fee-sensitive.)
    def eval_candidate(
        direction_mode: str,
        hold_bars: int,
        quantile: float,
        window: tuple[int, int] | None,
        fee_bps_rt: float,
    ) -> dict:
        thr = abs_btc[int(len(abs_btc) * quantile)]
        fee_pct = fee_bps_rt / 10000.0 * 100
        pnl = []
        for r in rows:
            if abs(r["btc_ret_1"]) < thr:
                continue
            if window is not None:
                a, b = window
                h = ms_to_et(r["ms"]).hour
                ok = (a <= h < b) if a < b else (h >= a or h < b)
                if not ok:
                    continue
            d = sign(r["btc_ret_1"])
            if d == 0:
                continue
            if direction_mode == "fade":
                d = -d

            # Hold PAX for hold_bars bars.
            # Need aligned ms index lookups.
            i = ms_index[r["ms"]]
            if i + hold_bars >= len(common_ms):
                continue
            e = pax_by_ms[common_ms[i]]["close"]
            x = pax_by_ms[common_ms[i + hold_bars]]["close"]
            gross = d * pct_ret(e, x)
            pnl.append(gross - fee_pct)

        if not pnl:
            return dict(n=0, win=0, avg=0, pf=0, total=0, max_ls=0, max_dd=0)

        n = len(pnl)
        wins = sum(1 for x in pnl if x > 0)
        avg = statistics.mean(pnl)
        total = sum(pnl)
        gp = sum(x for x in pnl if x > 0)
        gl = abs(sum(x for x in pnl if x <= 0))
        pf = gp / gl if gl > 0 else 999.0
        cur = 0
        max_ls = 0
        eq = 0.0
        peak = 0.0
        max_dd = 0.0
        for x in pnl:
            if x <= 0:
                cur += 1
                max_ls = max(max_ls, cur)
            else:
                cur = 0
            eq += x
            peak = max(peak, eq)
            max_dd = max(max_dd, peak - eq)
        return dict(n=n, win=wins / n * 100, avg=avg, pf=pf, total=total, max_ls=max_ls, max_dd=max_dd)

    # ms -> index map for hold-bars candidate evaluation.
    ms_index = {m: i for i, m in enumerate(common_ms)}

    candidate = dict(
        direction_mode="fade",
        hold_bars=12,  # 60 minutes
        quantile=0.95,  # only strongest BTC candles
        window=(16, 21),  # ET
    )
    c0 = eval_candidate(**candidate, fee_bps_rt=0.0)
    c6 = eval_candidate(**candidate, fee_bps_rt=args.fee_bps_rt)

    print("\n=== Candidate BTC->PAX Rule (from extended search) ===")
    print(
        "Rule: FADE BTC direction when |BTC 5m ret| is in top 5%, "
        "only 16:00-21:00 ET, hold PAX for 12 bars (60m)."
    )
    print(
        f"Pre-fee: N={c0['n']} Win={c0['win']:.2f}% Avg={c0['avg']:+.4f}% "
        f"PF={c0['pf']:.2f} Tot={c0['total']:+.2f}% MaxLS={c0['max_ls']}"
    )
    print(
        f"After {args.fee_bps_rt:.1f} bps RT fee: N={c6['n']} Win={c6['win']:.2f}% "
        f"Avg={c6['avg']:+.4f}% PF={c6['pf']:.2f} Tot={c6['total']:+.2f}% MaxLS={c6['max_ls']}"
    )


if __name__ == "__main__":
    main()
