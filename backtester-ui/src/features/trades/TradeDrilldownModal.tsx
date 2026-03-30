import { useMemo } from "react";
import { CandleChart } from "../../components/CandleChart";
import { buildReplayIndicatorSeries, buildTradeReplayCandlesWindow, formatDateTime } from "../../lib/backtestMath";
import type { Candle } from "../../types";

type SimulatedTrade = {
  openedAtMs: number;
  closedAtMs: number;
  side: string;
  entryPx: number;
  exitPx: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
};

interface TradeDrilldownModalProps {
  trade: SimulatedTrade | null;
  symbol: string;
  timeframeLabel: string;
  candles: Candle[];
  strategyId?: string;
  strategyParams?: Record<string, unknown> | null;
  onClose: () => void;
}

export function TradeDrilldownModal({
  trade,
  symbol,
  timeframeLabel,
  candles,
  strategyId = "",
  strategyParams = null,
  onClose
}: TradeDrilldownModalProps) {
  const modalCandles = useMemo(() => buildTradeReplayCandlesWindow(candles, trade, 10), [candles, trade]);
  const priceLevels = [
    { title: "Entry", price: Number(trade?.entryPx || 0), color: "#0ea5e9", lineStyle: 0 as const },
    { title: "SL", price: Number(trade?.stopLoss), color: "#dc2626", lineStyle: 2 as const },
    { title: "TP", price: Number(trade?.takeProfit), color: "#16a34a", lineStyle: 2 as const }
  ].filter((level) => Number.isFinite(level.price) && level.price > 0);

  const timeMarkers = [
    {
      title: "Trade Taken",
      timeMs: Number(trade?.openedAtMs || 0),
      price: Number(trade?.entryPx || 0),
      color: "#7c3aed"
    },
    {
      title: "Trade Closed",
      timeMs: Number(trade?.closedAtMs || 0),
      price: Number(trade?.exitPx || 0),
      color: "#ea580c"
    }
  ].filter((marker) => Number.isFinite(marker.timeMs) && Number.isFinite(marker.price) && marker.price > 0);
  const indicatorSeries = useMemo(
    () =>
      buildReplayIndicatorSeries({
        strategyId,
        strategyParams,
        allCandles: candles,
        visibleCandles: modalCandles
      }),
    [candles, modalCandles, strategyId, strategyParams]
  );
  if (!trade) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Trade Replay Visual</h3>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="sub">
          {symbol} · {timeframeLabel} · {String(trade.side || "").toUpperCase()} · Open{" "}
          {formatDateTime(trade.openedAtMs)} · Close {formatDateTime(trade.closedAtMs)}
        </div>
        <div className="sub">
          Entry {Number(trade.entryPx || 0).toFixed(4)} · SL{" "}
          {trade.stopLoss == null ? "--" : Number(trade.stopLoss).toFixed(4)} · TP{" "}
          {trade.takeProfit == null ? "--" : Number(trade.takeProfit).toFixed(4)} · Exit{" "}
          {Number(trade.exitPx || 0).toFixed(4)}
        </div>
        <div className="modal-chart">
          {modalCandles.length > 0 ? (
            <CandleChart
              candles={modalCandles}
              priceLevels={priceLevels}
              timeMarkers={timeMarkers}
              indicatorSeries={indicatorSeries}
            />
          ) : (
            <div className="empty">No candles loaded for this asset/timeframe.</div>
          )}
        </div>
      </div>
    </div>
  );
}
