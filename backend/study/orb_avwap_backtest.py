#!/usr/bin/env python3
import json
import math
import statistics
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo


@dataclass
class Candle:
    time_ms: int
    open: float
    high: float
    low: float
    close: float
    volume: float


def _safe_float(value, fallback=0.0):
    try:
        parsed = float(value)
        if math.isfinite(parsed):
            return parsed
    except Exception:
        pass
    return fallback


def _safe_int(value, fallback=0):
    try:
        parsed = int(value)
        return parsed
    except Exception:
        return fallback


def _parse_hhmm(value, default_minutes):
    raw = str(value or "").strip()
    if len(raw) != 5 or ":" not in raw:
        return default_minutes
    hh_str, mm_str = raw.split(":", 1)
    try:
        hh = int(hh_str)
        mm = int(mm_str)
    except Exception:
        return default_minutes
    if hh < 0 or hh > 23 or mm < 0 or mm > 59:
        return default_minutes
    return hh * 60 + mm


def _et_minute(candle_ms, timezone_name):
    tz = ZoneInfo(timezone_name)
    dt = datetime.fromtimestamp(candle_ms / 1000, tz=tz)
    return dt.hour * 60 + dt.minute


def _normalize_candle_rows(rows):
    out = []
    for row in rows or []:
        time_ms = _safe_int(row.get("timeMs"), 0)
        if time_ms <= 0:
            continue
        c = Candle(
            time_ms=time_ms,
            open=_safe_float(row.get("open")),
            high=_safe_float(row.get("high")),
            low=_safe_float(row.get("low")),
            close=_safe_float(row.get("close")),
            volume=max(0.0, _safe_float(row.get("volume"), 0.0)),
        )
        out.append(c)
    out.sort(key=lambda x: x.time_ms)
    return out


def _anchored_vwap_series(candles, anchor_minute, end_minute, timezone_name, price_source):
    cumulative_pv = 0.0
    cumulative_vol = 0.0
    series = {}
    for candle in candles:
        minute_et = _et_minute(candle.time_ms, timezone_name)
        if minute_et < anchor_minute or minute_et >= end_minute:
            continue
        if price_source == "hlc3":
            px = (candle.high + candle.low + candle.close) / 3.0
        else:
            px = candle.close
        vol = candle.volume if candle.volume > 0 else 0.0
        cumulative_pv += px * vol
        cumulative_vol += vol
        if cumulative_vol > 0:
            series[candle.time_ms] = cumulative_pv / cumulative_vol
        else:
            series[candle.time_ms] = px
    return series


def _calc_metrics(trades):
    count = len(trades)
    if count == 0:
        return {
            "tradeCount": 0,
            "winRate": 0,
            "avgR": 0,
            "expectancyR": 0,
            "profitFactor": 0,
            "maxDrawdownR": 0,
            "netR": 0,
            "netPnLQuote": 0,
            "sharpeLike": 0,
        }
    r_values = [t["rMultipleNet"] for t in trades]
    wins = [v for v in r_values if v > 0]
    losses = [v for v in r_values if v < 0]
    equity = 0.0
    peak = 0.0
    max_dd = 0.0
    for r in r_values:
        equity += r
        if equity > peak:
            peak = equity
        drawdown = peak - equity
        if drawdown > max_dd:
            max_dd = drawdown
    std = statistics.pstdev(r_values) if len(r_values) > 1 else 0.0
    sharpe_like = (statistics.mean(r_values) / std) if std > 0 else 0.0
    gross_win = sum(wins)
    gross_loss = abs(sum(losses))
    return {
        "tradeCount": count,
        "winRate": len(wins) / count,
        "avgR": statistics.mean(r_values),
        "expectancyR": statistics.mean(r_values),
        "profitFactor": (gross_win / gross_loss) if gross_loss > 0 else (999 if gross_win > 0 else 0),
        "maxDrawdownR": max_dd,
        "netR": sum(r_values),
        "netPnLQuote": sum(t["pnlQuoteNet"] for t in trades),
        "sharpeLike": sharpe_like,
    }


def _simulate_case(case, cfg):
    timezone_name = cfg["timezone"]
    orb_start = _parse_hhmm(cfg["orb"]["startTime"], 570)
    orb_end = _parse_hhmm(cfg["orb"]["endTime"], 600)
    avwap_anchor = _parse_hhmm(cfg["avwap"]["anchorTime"], 600)
    trade_end = _parse_hhmm(cfg["avwap"]["endTime"], 780)
    direction_mode = cfg["execution"]["directionMode"]
    max_trades = int(cfg["execution"]["maxTradesPerDay"])
    take_profit_r = float(cfg["execution"]["takeProfitR"])
    fee_bps = float(cfg["execution"]["feeBps"])
    slippage_bps = float(cfg["execution"]["slippageBps"])
    breakout_source = cfg["orb"]["breakoutSource"]
    stop_loss_mode = cfg["execution"]["stopLossMode"]

    candles_1m = _normalize_candle_rows(case.get("candles1m"))
    candles_5m = _normalize_candle_rows(case.get("candles5m"))
    orb_source = candles_5m if cfg["orb"]["timeframe"] == "5m" else candles_1m

    orb_window = [c for c in orb_source if orb_start <= _et_minute(c.time_ms, timezone_name) < orb_end]
    if not orb_window:
        return {"case": case, "trades": [], "notes": "No ORB window candles"}

    orb_high = max(c.high for c in orb_window)
    orb_low = min(c.low for c in orb_window)
    if orb_high <= orb_low:
        return {"case": case, "trades": [], "notes": "Invalid ORB range"}

    avwap_by_time = _anchored_vwap_series(
        candles_1m, avwap_anchor, trade_end, timezone_name, cfg["avwap"]["priceSource"]
    )
    trading_window = [c for c in candles_1m if avwap_anchor <= _et_minute(c.time_ms, timezone_name) < trade_end]
    trades = []

    for candle in trading_window:
        if len(trades) >= max_trades:
            break
        avwap = avwap_by_time.get(candle.time_ms)
        if avwap is None:
            continue
        trigger_long = (candle.high > orb_high) if breakout_source == "wick" else (candle.close > orb_high)
        trigger_short = (candle.low < orb_low) if breakout_source == "wick" else (candle.close < orb_low)
        allow_long = direction_mode in ("both", "long_only")
        allow_short = direction_mode in ("both", "short_only")

        side = None
        entry_price = candle.close
        if allow_long and trigger_long and candle.close >= avwap:
            side = "long"
            stop_price = orb_low if stop_loss_mode == "orb_opposite" else avwap
            risk = max(0.0, entry_price - stop_price)
            target = entry_price + (risk * take_profit_r if risk > 0 else 0)
        elif allow_short and trigger_short and candle.close <= avwap:
            side = "short"
            stop_price = orb_high if stop_loss_mode == "orb_opposite" else avwap
            risk = max(0.0, stop_price - entry_price)
            target = entry_price - (risk * take_profit_r if risk > 0 else 0)
        else:
            continue

        if side is None or risk <= 0:
            continue

        exit_reason = "time_stop"
        exit_price = trading_window[-1].close
        exit_time_ms = trading_window[-1].time_ms
        for next_candle in trading_window:
            if next_candle.time_ms <= candle.time_ms:
                continue
            if side == "long":
                if next_candle.low <= stop_price:
                    exit_reason = "stop_loss"
                    exit_price = stop_price
                    exit_time_ms = next_candle.time_ms
                    break
                if target > 0 and next_candle.high >= target:
                    exit_reason = "take_profit"
                    exit_price = target
                    exit_time_ms = next_candle.time_ms
                    break
            else:
                if next_candle.high >= stop_price:
                    exit_reason = "stop_loss"
                    exit_price = stop_price
                    exit_time_ms = next_candle.time_ms
                    break
                if target > 0 and next_candle.low <= target:
                    exit_reason = "take_profit"
                    exit_price = target
                    exit_time_ms = next_candle.time_ms
                    break

        gross_move = (exit_price - entry_price) if side == "long" else (entry_price - exit_price)
        r_multiple = gross_move / risk if risk > 0 else 0.0
        cost_r = (fee_bps + slippage_bps) * 2 / 10000.0
        r_net = r_multiple - cost_r
        pnl_quote_net = r_net * risk

        trades.append(
            {
                "sessionId": case.get("sessionId"),
                "symbol": case.get("symbol"),
                "side": side,
                "entryTimeMs": candle.time_ms,
                "entryPrice": entry_price,
                "exitTimeMs": exit_time_ms,
                "exitPrice": exit_price,
                "exitReason": exit_reason,
                "orbHigh": orb_high,
                "orbLow": orb_low,
                "avwapAtEntry": avwap,
                "riskPerUnit": risk,
                "rMultipleGross": r_multiple,
                "rMultipleNet": r_net,
                "pnlQuoteNet": pnl_quote_net,
            }
        )

    return {"case": case, "trades": trades, "notes": ""}


def run():
    payload = json.loads(sys.stdin.read() or "{}")
    config = payload.get("config") or {}
    cases = payload.get("cases") or []
    split_pct = float(config.get("validation", {}).get("walkForwardSplitPct", 0.7))
    split_pct = min(0.95, max(0.5, split_pct))

    case_results = [_simulate_case(case, config) for case in cases]
    all_trades = [trade for item in case_results for trade in item["trades"]]

    sorted_cases = sorted(
        case_results,
        key=lambda x: _safe_int(x["case"].get("startedAtMs") or x["case"].get("sessionStartedAtMs"), 0),
    )
    cutoff = max(1, int(len(sorted_cases) * split_pct)) if sorted_cases else 0
    train_case_ids = set((row["case"].get("sessionId"), row["case"].get("symbol")) for row in sorted_cases[:cutoff])
    val_case_ids = set((row["case"].get("sessionId"), row["case"].get("symbol")) for row in sorted_cases[cutoff:])

    train_trades = [t for t in all_trades if (t.get("sessionId"), t.get("symbol")) in train_case_ids]
    val_trades = [t for t in all_trades if (t.get("sessionId"), t.get("symbol")) in val_case_ids]

    by_symbol = {}
    for trade in all_trades:
        symbol = str(trade.get("symbol") or "").upper()
        by_symbol.setdefault(symbol, []).append(trade)

    case_summaries = []
    for row in case_results:
        metrics = _calc_metrics(row["trades"])
        case_summaries.append(
            {
                "sessionId": row["case"].get("sessionId"),
                "symbol": row["case"].get("symbol"),
                "startedAtMs": row["case"].get("startedAtMs"),
                "tradeCount": metrics["tradeCount"],
                "netR": metrics["netR"],
                "winRate": metrics["winRate"],
                "notes": row["notes"],
            }
        )

    output = {
        "runId": f"orb-avwap-{uuid.uuid4().hex[:12]}",
        "generatedAtMs": int(datetime.now().timestamp() * 1000),
        "aggregate": _calc_metrics(all_trades),
        "inSample": _calc_metrics(train_trades),
        "outOfSample": _calc_metrics(val_trades),
        "bySymbol": {symbol: _calc_metrics(trades) for symbol, trades in by_symbol.items()},
        "cases": case_summaries,
        "trades": all_trades,
    }
    print(json.dumps(output))


if __name__ == "__main__":
    run()
