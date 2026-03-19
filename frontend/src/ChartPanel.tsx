import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSocket } from "./useSocket";
import { Chart } from "./Chart";
import type { AccountMode, SessionInfo, Timeframe } from "./types";
import { fetchAccountFees, fetchAccountSettings, patchAccountMode } from "./lib/api";
import { calculateRiskFirstMetrics } from "./lib/riskCalculator";
import { RiskFirstPanel } from "./RiskFirstPanel";

interface ChartPanelProps {
  symbol: string;
  trackedSymbols?: string[];
  vwapEnabled?: boolean;
  vwapPeriod?: number;
  emaEnabled?: boolean;
  emaPeriod?: number;
  selectedSessionId?: string | null;
  onSessionInfoChange?: (sessionInfo: SessionInfo) => void;
  onHistoryPreloadingChange?: (loading: boolean) => void;
  riskPanelTarget?: HTMLDivElement | null;
}

export function ChartPanel({
  symbol,
  trackedSymbols = [],
  vwapEnabled = true,
  vwapPeriod = 20,
  emaEnabled = true,
  emaPeriod = 9,
  selectedSessionId = null,
  onSessionInfoChange,
  onHistoryPreloadingChange,
  riskPanelTarget = null
}: ChartPanelProps) {
  const [hoveredTimeSec, setHoveredTimeSec] = useState<number | null>(null);
  const {
    hud,
    candles,
    timeframe,
    setTimeframe,
    waitingForLiveData,
    historyPreloading,
    connected,
    sessionInfo,
    gaps,
    stopLossProjections,
    accountMode,
    activePosition,
    setStopLossPrice: setStopLossPriceOnSocket
  } = useSocket(symbol, trackedSymbols, selectedSessionId);
  const [riskPercentage, setRiskPercentage] = useState(2);
  const [stopLossPrice, setStopLossPrice] = useState(0);
  const [isLong, setIsLong] = useState(true);
  const [makerFeeRate, setMakerFeeRate] = useState(0.0001);
  const [takerFeeRate, setTakerFeeRate] = useState(0.00035);
  const maxExchangeLeverage = 50;

  const hasActiveTrade = activePosition !== null;
  const entryPrice = hasActiveTrade ? activePosition.entryPx : hud.price;

  const effectiveTimeframe = timeframe ?? "1m";
  const latestTimeSec = useMemo(() => {
    if (candles.length === 0) return null;
    return Math.floor(candles[candles.length - 1].timeMs / 1000);
  }, [candles]);
  const displayTimeSec = hoveredTimeSec ?? latestTimeSec;
  const displayTime = displayTimeSec
    ? new Date(displayTimeSec * 1000).toLocaleString()
    : "--";

  const handleTimeframeClick = (tf: Timeframe) => setTimeframe(tf);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "1") setTimeframe("1m");
      else if (e.key === "2") setTimeframe("5m");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setTimeframe]);

  useEffect(() => {
    onSessionInfoChange?.(sessionInfo);
  }, [onSessionInfoChange, sessionInfo]);

  useEffect(() => {
    onHistoryPreloadingChange?.(historyPreloading);
  }, [historyPreloading, onHistoryPreloadingChange]);

  const slPrice = stopLossProjections?.stopLossPrice ?? hud.stopLossPrice;
  const metrics = useMemo(
    () =>
      calculateRiskFirstMetrics({
        accountBalance: hud.balance,
        riskPercentage,
        entryPrice,
        stopLossPrice,
        isLong,
        makerFeeRate,
        takerFeeRate,
        maxExchangeLeverage
      }),
    [hud.balance, riskPercentage, entryPrice, stopLossPrice, isLong, makerFeeRate, takerFeeRate]
  );
  const warningText =
    metrics.leverageTooHigh
      ? `Warning: leverage ${metrics.leverage.toFixed(
          2
        )}x is above ${maxExchangeLeverage}x. Stop loss is too tight.`
      : null;

  useEffect(() => {
    if (slPrice >= 0) {
      setStopLossPrice(slPrice);
    }
  }, [slPrice]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [fees, settings] = await Promise.all([fetchAccountFees(accountMode), fetchAccountSettings()]);
      if (cancelled) return;
      if (fees) {
        setMakerFeeRate(Math.max(0, Number(fees.userAddRate ?? 0)));
        setTakerFeeRate(Math.max(0, Number(fees.userCrossRate ?? 0)));
      }
      if (settings?.riskPercent && Number.isFinite(settings.riskPercent)) {
        setRiskPercentage(Math.max(0, Number(settings.riskPercent)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountMode]);

  const handleStopLossPriceChange = (nextPrice: number) => {
    setStopLossPrice(nextPrice);
    setStopLossPriceOnSocket(nextPrice);
  };

  const handleModeToggle = () => {
    const next: AccountMode = accountMode === "live" ? "test" : "live";
    void patchAccountMode(next);
  };

  const riskPanel = (
    <RiskFirstPanel
      accountBalance={hud.balance}
      riskPercentage={riskPercentage}
      entryPrice={entryPrice}
      livePrice={hud.price}
      hasActiveTrade={hasActiveTrade}
      stopLossPrice={stopLossPrice}
      isLong={isLong}
      makerFeeRate={makerFeeRate}
      takerFeeRate={takerFeeRate}
      metrics={metrics}
      warningText={warningText}
      accountMode={accountMode}
      onModeToggle={handleModeToggle}
      onRiskPercentageChange={setRiskPercentage}
      onIsLongChange={setIsLong}
    />
  );

  return (
    <>
      <section
        className="relative h-full min-h-0 rounded-xl border border-slate-200 bg-white p-2"
        data-symbol={symbol}
      >
        <div className="relative h-full rounded-lg bg-white">
          <div className="absolute left-2 top-2 z-20 inline-flex items-center gap-2 rounded-full bg-white/90 px-2 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-inset ring-slate-200 backdrop-blur">
            <span
              className={`inline-flex h-2 w-2 rounded-full ${
                connected
                  ? "bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.2)]"
                  : "bg-slate-300"
              }`}
            />
            <button
              type="button"
              className={`rounded-full px-2 py-0.5 transition ${
                effectiveTimeframe === "1m"
                  ? "bg-indigo-600 text-white"
                  : "text-indigo-700 hover:bg-indigo-100"
              }`}
              onClick={() => handleTimeframeClick("1m")}
            >
              1m
            </button>
            <button
              type="button"
              className={`rounded-full px-2 py-0.5 transition ${
                effectiveTimeframe === "5m"
                  ? "bg-indigo-600 text-white"
                  : "text-indigo-700 hover:bg-indigo-100"
              }`}
              onClick={() => handleTimeframeClick("5m")}
            >
              5m
            </button>
          </div>
          <div className="absolute bottom-2 right-2 z-20 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-inset ring-slate-200 backdrop-blur">
            {displayTime}
          </div>
          {waitingForLiveData && !historyPreloading && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/70">
              <span className="text-xs font-medium text-gray-700">Waiting for live candles...</span>
            </div>
          )}
          {stopLossPrice === 0 && hud.price > 0 && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-md border border-sky-200 bg-sky-50/90 px-3 py-1.5 text-xs font-medium text-sky-800 backdrop-blur">
              Press F9 to place stop-loss at current price
            </div>
          )}
          <Chart
            candles={candles}
            gaps={gaps}
            vwapEnabled={vwapEnabled}
            vwapPeriod={vwapPeriod}
            emaEnabled={emaEnabled}
            emaPeriod={emaPeriod}
            entryPrice={hasActiveTrade ? entryPrice : 0}
            stopLossPrice={stopLossPrice}
            breakEvenPrice={metrics.breakEvenPrice}
            isLong={isLong}
            enableStopLossDrag
            onStopLossPriceChange={handleStopLossPriceChange}
            onCrosshairTimeChange={setHoveredTimeSec}
          />
        </div>
      </section>
      {riskPanelTarget ? createPortal(riskPanel, riskPanelTarget) : riskPanel}
    </>
  );
}
