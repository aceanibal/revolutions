import { useEffect, useMemo, useState } from "react";
import { CandleChart } from "../../components/CandleChart";
import {
  buildTradeOneMinuteCandlesCsv,
  buildReplayIndicatorSeries,
  buildTradeReplayCandlesWindow,
  formatDateTime,
  normalizeEpochMs,
  pickNestedScannerPayload
} from "../../lib/backtestMath";
import type { BacktestRunResult, Candle } from "../../types";

type SimulatedTrade = BacktestRunResult["trades"][number];

interface TradeDrilldownModalProps {
  trade: SimulatedTrade | null;
  symbol: string;
  timeframeLabel: string;
  candles: Candle[];
  oneMinuteCandles: Candle[];
  strategyId?: string;
  strategyParams?: Record<string, unknown> | null;
  onClose: () => void;
}

export function TradeDrilldownModal({
  trade,
  symbol,
  timeframeLabel,
  candles,
  oneMinuteCandles,
  strategyId = "",
  strategyParams = null,
  onClose
}: TradeDrilldownModalProps) {
  const [showOneMinuteView, setShowOneMinuteView] = useState(false);
  useEffect(() => {
    setShowOneMinuteView(false);
  }, [trade?.openedAtMs, trade?.closedAtMs]);
  const modalCandles = useMemo(() => buildTradeReplayCandlesWindow(candles, trade, 10), [candles, trade]);
  const oneMinuteTradeCandles = useMemo(
    () => buildTradeReplayCandlesWindow(oneMinuteCandles, trade, 25),
    [oneMinuteCandles, trade]
  );
  const activeCandles = showOneMinuteView ? oneMinuteTradeCandles : modalCandles;
  const openedAtMs = normalizeEpochMs(trade?.openedAtMs);
  const closedAtMs = normalizeEpochMs(trade?.closedAtMs);
  const snapToVisibleCandleTs = (tsMs: number): number => {
    if (!Number.isFinite(tsMs) || tsMs <= 0 || activeCandles.length === 0) return tsMs;
    let closestTs = Number(activeCandles[0]?.timeMs || tsMs);
    let closestDiff = Math.abs(closestTs - tsMs);
    for (const candle of activeCandles) {
      const candleTs = Number(candle.timeMs || 0);
      if (!Number.isFinite(candleTs) || candleTs <= 0) continue;
      const diff = Math.abs(candleTs - tsMs);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestTs = candleTs;
      }
    }
    return closestTs;
  };
  const priceLevels = [
    { title: "Entry", price: Number(trade?.entryPx || 0), color: "#0ea5e9", lineStyle: 0 as const },
    { title: "SL", price: Number(trade?.stopLoss), color: "#dc2626", lineStyle: 2 as const },
    { title: "TP", price: Number(trade?.takeProfit), color: "#16a34a", lineStyle: 2 as const }
  ].filter((level) => Number.isFinite(level.price) && level.price > 0);

  const timeMarkers = [
    {
      title: "Trade Taken",
      timeMs: snapToVisibleCandleTs(openedAtMs),
      price: Number(trade?.entryPx || 0),
      color: "#7c3aed"
    },
    {
      title: "Trade Closed",
      timeMs: snapToVisibleCandleTs(closedAtMs),
      price: Number(trade?.exitPx || 0),
      color: "#ea580c"
    }
  ].filter((marker) => Number.isFinite(marker.timeMs) && Number.isFinite(marker.price) && marker.price > 0);
  const indicatorSeries = useMemo(
    () =>
      buildReplayIndicatorSeries({
        strategyId,
        strategyParams,
        allCandles: showOneMinuteView ? oneMinuteCandles : candles,
        visibleCandles: activeCandles
      }),
    [activeCandles, candles, oneMinuteCandles, showOneMinuteView, strategyId, strategyParams]
  );
  const scannerSet = String(strategyParams?.scannerFeatureSet || "rvol-scanner");
  const scanIn = pickNestedScannerPayload(trade?.scannerAtEntry, scannerSet);
  const scanOut = pickNestedScannerPayload(trade?.scannerAtExit, scannerSet);
  const fmt = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v.toFixed(4) : "--";
  if (!trade) return null;

  const exportOneMinuteCandles = () => {
    if (!trade || oneMinuteCandles.length === 0) return;
    const csv = buildTradeOneMinuteCandlesCsv(oneMinuteCandles, trade);
    const safeSymbol = String(symbol || "symbol").replace(/[^a-zA-Z0-9_-]+/g, "_");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trade-1m_${safeSymbol}_${openedAtMs || 0}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Trade Replay Visual</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" onClick={() => setShowOneMinuteView((prev) => !prev)}>
              {showOneMinuteView ? `Use ${timeframeLabel} view` : "Go to trade open (1m)"}
            </button>
            <button type="button" onClick={exportOneMinuteCandles}>
              Export trade 1m candles (CSV)
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="sub">
          {symbol} · {timeframeLabel} · {String(trade.side || "").toUpperCase()} · Open{" "}
          {formatDateTime(openedAtMs)} · Close {formatDateTime(closedAtMs)}
        </div>
        <div className="sub">
          Entry {Number(trade.entryPx || 0).toFixed(4)} · SL{" "}
          {trade.stopLoss == null ? "--" : Number(trade.stopLoss).toFixed(4)} · TP{" "}
          {trade.takeProfit == null ? "--" : Number(trade.takeProfit).toFixed(4)} · Exit{" "}
          {Number(trade.exitPx || 0).toFixed(4)}
        </div>
        <div className="sub">
          Trading day (ET): {trade.tradingDayEt || "--"} · Scanner set: {scannerSet}
        </div>
        {(scanIn || scanOut) && (
          <div className="sub" style={{ marginTop: 8 }}>
            <strong>Scanner</strong> — entry: RVOL {fmt(scanIn?.rvol)} · BTC ρ {fmt(scanIn?.btcCorr)} · px{" "}
            {fmt(scanIn?.price)} · exit: RVOL {fmt(scanOut?.rvol)} · BTC ρ {fmt(scanOut?.btcCorr)} · px{" "}
            {fmt(scanOut?.price)}
          </div>
        )}
        <div className="sub" style={{ marginTop: 8 }}>
          Chart view: {showOneMinuteView ? "1m trade-open window" : `${timeframeLabel} trade window`}
        </div>
        <div className="modal-chart">
          {activeCandles.length > 0 ? (
            <CandleChart
              candles={activeCandles}
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
