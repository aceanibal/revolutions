#!/usr/bin/env python3
"""
Liquidity-zone trade verifier and plotter.

Loads scanner snapshots + candles + optional strategy_sim trade JSON, then:
  1) Recomputes snapshot levels at the same anchor.
  2) Audits week_high/week_low against raw candles and cached snapshot.
  3) Prints flattened + deduped zones used for detection.
  4) Plots overnight 5m action + optional 1m trade zoom.

Usage examples:
  python sandbox/verify_liquidity_trade.py --json sandbox/strategy_results.json --trade-index 0 --save out.png
  python sandbox/verify_liquidity_trade.py --session-id abc --symbol XRPUSDT --anchor-ms 1742830800000 --show
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import matplotlib.pyplot as plt

from liquidity_zones import (
    DB_PATH,
    compute_liquidity_zones,
    list_sessions_with_symbol,
    load_5m_candles,
    load_scanner_cache,
    ms_to_et,
    scanner_cache_path,
)
from reversal_study import dedupe_nearby_levels, flatten_zones, load_1m_candles, slice_candles
from strategy_sim import OVERNIGHT_MS, SL_MULT, TP_MAP, sim_trade


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Verify liquidity-zone trade and plot it")
    p.add_argument("--db", default=DB_PATH)
    p.add_argument("--session-id", default="")
    p.add_argument("--symbol", default="XRPUSDT")
    p.add_argument("--lookback-days", type=int, default=7)

    p.add_argument("--json", default="", help="strategy_sim.py --output JSON")
    p.add_argument("--trade-index", type=int, default=None, help="Index in JSON trades array")
    p.add_argument("--time-ms", type=int, default=0, help="Select JSON trade by time_ms")

    p.add_argument("--anchor-ms", type=int, default=0, help="Force snapshot anchor timestamp")
    p.add_argument("--max-hold", type=int, default=120, help="Minutes for replay parity check")

    p.add_argument("--trade-time-ms", type=int, default=0, help="Manual trade time if --json not provided")
    p.add_argument("--entry-price", type=float, default=None)
    p.add_argument("--stop-price", type=float, default=None)
    p.add_argument("--side", choices=["long", "short"], default=None)
    p.add_argument("--pattern", default="")
    p.add_argument("--zone-type", default="")
    p.add_argument("--zone-price", type=float, default=None)

    p.add_argument("--save", default="", help="Save plot to PNG path")
    p.add_argument("--show", action="store_true", help="Show interactive plot")
    return p.parse_args()


def _pick_session(db: str, session_id: str, symbol: str) -> str:
    if session_id:
        return session_id
    sessions = list_sessions_with_symbol(db, symbol)
    if not sessions:
        raise RuntimeError(f"No historical sessions with {symbol} 5m candles")
    return sessions[0][0]


def _load_trade_from_json(path: str, trade_index: int | None, time_ms: int) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    with open(path) as f:
        data = json.load(f)
    trades = data.get("trades", [])
    if not trades:
        raise RuntimeError(f"No trades in JSON: {path}")

    trade: dict[str, Any] | None = None
    if trade_index is not None:
        if trade_index < 0 or trade_index >= len(trades):
            raise RuntimeError(f"--trade-index out of range: {trade_index} (n={len(trades)})")
        trade = trades[trade_index]
    elif time_ms > 0:
        for t in trades:
            if int(t.get("time_ms", 0)) == time_ms:
                trade = t
                break
        if trade is None:
            raise RuntimeError(f"No trade with time_ms={time_ms} in {path}")
    else:
        trade = trades[-1]

    return trade, data


def _manual_trade_from_args(args: argparse.Namespace) -> dict[str, Any] | None:
    if args.entry_price is None or args.stop_price is None or not args.side:
        return None
    return {
        "time_ms": args.trade_time_ms if args.trade_time_ms > 0 else 0,
        "entry_price": float(args.entry_price),
        "stop_price": float(args.stop_price),
        "side": args.side,
        "pattern": args.pattern or "manual",
        "zone_type": args.zone_type or "manual",
        "zone_price": float(args.zone_price) if args.zone_price is not None else None,
    }


def _anchor_of(snapshot: dict[str, Any]) -> int:
    return int(snapshot.get("anchor_ms") or snapshot.get("anchorTsMs") or 0)


def _resolve_anchor(anchor_ms: int, trade: dict[str, Any] | None, snapshots: list[dict[str, Any]]) -> int:
    if anchor_ms > 0:
        return anchor_ms
    if trade and int(trade.get("time_ms", 0)) > 0 and snapshots:
        t = int(trade["time_ms"])
        candidates = []
        for snap in snapshots:
            a = _anchor_of(snap)
            if a <= 0:
                continue
            if a <= t <= a + OVERNIGHT_MS:
                candidates.append(a)
        if candidates:
            return max(candidates)
    if snapshots:
        return max(_anchor_of(s) for s in snapshots if _anchor_of(s) > 0)
    raise RuntimeError("Unable to resolve anchor. Provide --anchor-ms or scanner cache with matching symbol/session.")


def _window_for_anchor(candles_5m: list[dict[str, Any]], anchor_ms: int, lookback_days: int) -> list[dict[str, Any]]:
    cutoff = anchor_ms - lookback_days * 86_400_000
    return [c for c in candles_5m if cutoff < int(c["bucket_start_ms"]) <= anchor_ms]


def _is_close(a: float, b: float, rel: float = 1e-9, abs_tol: float = 1e-9) -> bool:
    return abs(a - b) <= max(abs_tol, rel * max(abs(a), abs(b), 1.0))


def _format_price(v: Any) -> str:
    if v is None:
        return "None"
    return f"{float(v):.6f}"


def _print_zones(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    zones = dedupe_nearby_levels(flatten_zones(snapshot))
    print("\n[ZONE LIST] flattened + deduped levels used by detector")
    print(f"{'type':<14} {'bias':<11} {'price':>12}")
    print("-" * 42)
    for z in zones:
        print(f"{z.get('type', 'unknown'):<14} {z.get('bias', 'n/a'):<11} {float(z.get('price', 0)):>12.6f}")
    return zones


def _replay_sim_if_possible(trade: dict[str, Any], candles_1m: list[dict[str, Any]], max_hold: int) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    pattern = str(trade.get("pattern", ""))
    side = str(trade.get("side", ""))
    entry = trade.get("entry_price")
    stop = trade.get("stop_price")
    ts = int(trade.get("time_ms", 0))
    if pattern not in TP_MAP or side not in ("long", "short"):
        return None, []
    if entry is None or stop is None or ts <= 0:
        return None, []

    hold_from = ts + 5 * 60_000
    hold_to = ts + (max_hold + 5) * 60_000
    bars = slice_candles(candles_1m, hold_from, hold_to)
    replay = sim_trade(bars, float(entry), float(stop), side, TP_MAP[pattern], SL_MULT)
    return replay, bars


def _plot(
    anchor_ms: int,
    overnight_5m: list[dict[str, Any]],
    overnight_1m: list[dict[str, Any]],
    snapshot: dict[str, Any],
    zones: list[dict[str, Any]],
    trade: dict[str, Any] | None,
    save_path: str,
    show: bool,
) -> None:
    fig, (ax_top, ax_bot) = plt.subplots(2, 1, figsize=(15, 10), sharex=False, height_ratios=[3, 2])
    fig.suptitle(f"Liquidity Verification | Anchor {ms_to_et(anchor_ms).strftime('%Y-%m-%d %H:%M ET')}")

    x5 = [ms_to_et(int(c["bucket_start_ms"])) for c in overnight_5m]
    c5 = [float(c["close"]) for c in overnight_5m]
    h5 = [float(c["high"]) for c in overnight_5m]
    l5 = [float(c["low"]) for c in overnight_5m]
    ax_top.plot(x5, c5, color="black", linewidth=1.2, label="5m close")
    ax_top.fill_between(x5, l5, h5, color="#8fb8ff", alpha=0.20, linewidth=0)

    lines = [
        ("previous_day_high", snapshot.get("previous_day_high"), "tab:orange", "--"),
        ("previous_day_low", snapshot.get("previous_day_low"), "tab:orange", "--"),
        ("week_high", snapshot.get("week_high"), "tab:red", "-."),
        ("week_low", snapshot.get("week_low"), "tab:green", "-."),
    ]
    for name, price, color, style in lines:
        if price is None:
            continue
        ax_top.axhline(float(price), color=color, linestyle=style, linewidth=1.2, alpha=0.95, label=f"{name}={float(price):.5f}")

    hvn_drawn = False
    for z in zones:
        if z.get("type") != "hvn":
            continue
        p = float(z["price"])
        ax_top.axhline(p, color="#666666", linestyle=":", linewidth=0.8, alpha=0.7, label="hvn" if not hvn_drawn else None)
        hvn_drawn = True

    if trade:
        t = int(trade.get("time_ms", 0))
        entry = trade.get("entry_price")
        stop = trade.get("stop_price")
        side = trade.get("side")
        pattern = str(trade.get("pattern", ""))

        if t > 0:
            ax_top.axvline(ms_to_et(t), color="purple", linestyle="--", linewidth=1.2, alpha=0.9, label="signal time")
        if entry is not None:
            ax_top.axhline(float(entry), color="blue", linestyle="-", linewidth=1.2, alpha=0.9, label=f"entry={float(entry):.5f}")
        if stop is not None:
            ax_top.axhline(float(stop), color="red", linestyle="-", linewidth=1.2, alpha=0.9, label=f"orig_stop={float(stop):.5f}")

        if entry is not None and stop is not None and side in ("long", "short") and pattern in TP_MAP:
            orig_risk = abs(float(entry) - float(stop))
            new_risk = float(trade.get("new_risk")) if trade.get("new_risk") is not None else orig_risk * SL_MULT
            if side == "short":
                sim_stop = float(entry) + new_risk
                sim_tp = float(entry) - TP_MAP[pattern] * new_risk
            else:
                sim_stop = float(entry) - new_risk
                sim_tp = float(entry) + TP_MAP[pattern] * new_risk
            ax_top.axhline(sim_stop, color="#d62728", linestyle=":", linewidth=1.0, alpha=0.9, label=f"sim_stop={sim_stop:.5f}")
            ax_top.axhline(sim_tp, color="#2ca02c", linestyle=":", linewidth=1.0, alpha=0.9, label=f"sim_tp={sim_tp:.5f}")

    ax_top.set_ylabel("Price")
    ax_top.set_title("5m Overnight Window")
    ax_top.grid(alpha=0.25)
    ax_top.legend(loc="best", fontsize=8)

    x1 = [ms_to_et(int(c["bucket_start_ms"])) for c in overnight_1m]
    c1 = [float(c["close"]) for c in overnight_1m]
    if x1:
        ax_bot.plot(x1, c1, color="#333333", linewidth=1.0, label="1m close")
    if trade and int(trade.get("time_ms", 0)) > 0:
        ax_bot.axvline(ms_to_et(int(trade["time_ms"])), color="purple", linestyle="--", linewidth=1.0, label="signal time")
    ax_bot.set_ylabel("Price")
    ax_bot.set_title("1m Window")
    ax_bot.grid(alpha=0.25)
    ax_bot.legend(loc="best", fontsize=8)

    fig.tight_layout(rect=[0, 0, 1, 0.97])

    if save_path:
        os.makedirs(os.path.dirname(os.path.abspath(save_path)), exist_ok=True)
        fig.savefig(save_path, dpi=150)
        print(f"\n[PLOT] saved {save_path}")
    if show:
        plt.show()
    plt.close(fig)


def main() -> int:
    args = parse_args()
    db = os.path.abspath(args.db)
    if not os.path.isfile(db):
        print(f"ERROR: database not found at {db}", file=sys.stderr)
        return 1

    trade: dict[str, Any] | None = None
    json_meta: dict[str, Any] = {}
    if args.json:
        trade, json_meta = _load_trade_from_json(args.json, args.trade_index, args.time_ms)
        if not args.session_id and json_meta.get("session_id"):
            args.session_id = str(json_meta["session_id"])
        if args.symbol == "XRPUSDT" and json_meta.get("symbol"):
            args.symbol = str(json_meta["symbol"])
    else:
        trade = _manual_trade_from_args(args)

    symbol = args.symbol.upper()
    session_id = _pick_session(db, args.session_id, symbol)
    cache_file = scanner_cache_path(session_id, symbol, args.lookback_days)
    snapshots = load_scanner_cache(cache_file) or []
    snapshots_by_anchor = {_anchor_of(s): s for s in snapshots if _anchor_of(s) > 0}

    anchor_ms = _resolve_anchor(args.anchor_ms, trade, snapshots)
    cached_snapshot = snapshots_by_anchor.get(anchor_ms)

    print("[INPUT]")
    print(f"session_id   : {session_id}")
    print(f"symbol       : {symbol}")
    print(f"lookback_days: {args.lookback_days}")
    print(f"anchor_ms    : {anchor_ms} ({ms_to_et(anchor_ms).strftime('%Y-%m-%d %H:%M ET')})")
    print(f"cache_file   : {cache_file}")
    print(f"cache_hit    : {'yes' if cached_snapshot else 'no'}")

    candles_5m = load_5m_candles(db, session_id, symbol)
    candles_1m = load_1m_candles(db, session_id, symbol)

    recomputed = compute_liquidity_zones(candles_5m, anchor_ms, lookback_days=args.lookback_days)
    if recomputed is None:
        print("ERROR: no candles in recomputation window", file=sys.stderr)
        return 1

    window = _window_for_anchor(candles_5m, anchor_ms, args.lookback_days)
    if not window:
        print("ERROR: empty scanner window", file=sys.stderr)
        return 1
    raw_high = max(float(c["high"]) for c in window)
    raw_low = min(float(c["low"]) for c in window)
    snapshot_for_audit = cached_snapshot or recomputed

    checks: list[tuple[str, bool, str]] = []
    checks.append((
        "raw window high == recomputed week_high",
        _is_close(raw_high, float(recomputed["week_high"])),
        f"raw_high={raw_high:.6f} recomputed_week_high={float(recomputed['week_high']):.6f}",
    ))
    checks.append((
        "raw window low == recomputed week_low",
        _is_close(raw_low, float(recomputed["week_low"])),
        f"raw_low={raw_low:.6f} recomputed_week_low={float(recomputed['week_low']):.6f}",
    ))

    if cached_snapshot:
        checks.append((
            "cached week_high == recomputed week_high",
            _is_close(float(cached_snapshot["week_high"]), float(recomputed["week_high"])),
            f"cached={float(cached_snapshot['week_high']):.6f} recomputed={float(recomputed['week_high']):.6f}",
        ))
        checks.append((
            "cached week_low == recomputed week_low",
            _is_close(float(cached_snapshot["week_low"]), float(recomputed["week_low"])),
            f"cached={float(cached_snapshot['week_low']):.6f} recomputed={float(recomputed['week_low']):.6f}",
        ))

    print("\n[AUDIT] rolling-window extreme checks")
    print(f"window bars   : {len(window)}")
    print(f"window start  : {ms_to_et(int(window[0]['bucket_start_ms'])).strftime('%Y-%m-%d %H:%M ET')}")
    print(f"window end    : {ms_to_et(int(window[-1]['bucket_start_ms'])).strftime('%Y-%m-%d %H:%M ET')}")
    print(f"snapshot high : {_format_price(snapshot_for_audit.get('week_high'))}")
    print(f"snapshot low  : {_format_price(snapshot_for_audit.get('week_low'))}")
    failures = 0
    for label, ok, detail in checks:
        status = "PASS" if ok else "FAIL"
        print(f"  - {status}: {label} | {detail}")
        if not ok:
            failures += 1

    zones = _print_zones(snapshot_for_audit)

    replay_bars: list[dict[str, Any]] = []
    if trade:
        print("\n[TRADE]")
        print(f"time_ms    : {trade.get('time_ms')}")
        if int(trade.get("time_ms", 0)) > 0:
            print(f"time_et    : {ms_to_et(int(trade['time_ms'])).strftime('%Y-%m-%d %H:%M ET')}")
        print(f"pattern    : {trade.get('pattern')}")
        print(f"side       : {trade.get('side')}")
        print(f"zone_type  : {trade.get('zone_type')}")
        print(f"zone_price : {trade.get('zone_price')}")
        print(f"entry      : {trade.get('entry_price')}")
        print(f"stop       : {trade.get('stop_price')}")
        if "exit_reason" in trade:
            print(f"exit_reason: {trade.get('exit_reason')}")
        if "pnl_r" in trade:
            print(f"pnl_r      : {trade.get('pnl_r')}")

        replay, replay_bars = _replay_sim_if_possible(trade, candles_1m, args.max_hold)
        if replay is not None:
            print("\n[REPLAY]")
            print(f"exit_reason: {replay['exit_reason']}")
            print(f"pnl_r      : {replay['pnl_r']}")
            print(f"mfe_r      : {replay['mfe_r']}")
            print(f"mae_r      : {replay['mae_r']}")
            if "exit_reason" in trade and str(trade.get("exit_reason")) != str(replay["exit_reason"]):
                failures += 1
                print("  - FAIL: replay exit_reason differs from JSON trade")
            if "pnl_r" in trade and not _is_close(float(trade.get("pnl_r", 0)), float(replay["pnl_r"]), rel=1e-6, abs_tol=1e-6):
                failures += 1
                print("  - FAIL: replay pnl_r differs from JSON trade")

    overnight_5m = slice_candles(candles_5m, anchor_ms, anchor_ms + OVERNIGHT_MS)
    if trade and int(trade.get("time_ms", 0)) > 0:
        trade_ms = int(trade["time_ms"])
        overnight_1m = slice_candles(candles_1m, trade_ms - 90 * 60_000, trade_ms + (args.max_hold + 30) * 60_000)
    elif replay_bars:
        overnight_1m = replay_bars
    else:
        overnight_1m = slice_candles(candles_1m, anchor_ms, anchor_ms + OVERNIGHT_MS)

    save_path = args.save
    if not save_path and not args.show:
        save_path = os.path.join(
            os.path.dirname(__file__),
            "cache",
            f"verify_{symbol}_{anchor_ms}.png",
        )
    _plot(
        anchor_ms=anchor_ms,
        overnight_5m=overnight_5m,
        overnight_1m=overnight_1m,
        snapshot=snapshot_for_audit,
        zones=zones,
        trade=trade,
        save_path=save_path,
        show=args.show,
    )

    if failures:
        print(f"\n[AUDIT RESULT] FAIL ({failures} checks failed)")
        return 2
    print("\n[AUDIT RESULT] PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
