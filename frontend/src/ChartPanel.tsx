import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSocket } from "./useSocket";
import { Chart } from "./Chart";
import type { LeveragePreview, SessionInfo, Timeframe } from "./types";
import { fetchAccountFees, fetchAccountOverview, fetchAccountSettings, fetchLeveragePreview } from "./lib/api";
import type { RiskFirstMetrics } from "./lib/riskCalculator";
import { RiskFirstPanel } from "./RiskFirstPanel";

const EXECUTION_ENTRY_SLIPPAGE_BPS = 200; // matches hyperliquid.js executeTrade 2%
const EXECUTION_STOP_SLIPPAGE_BPS = 300; // matches hyperliquid.js placeStopLoss 3%
const EFFECTIVE_SLIPPAGE_BPS = EXECUTION_ENTRY_SLIPPAGE_BPS + EXECUTION_STOP_SLIPPAGE_BPS;
const ENTRY_SLIPPAGE_FRAC = EXECUTION_ENTRY_SLIPPAGE_BPS / 10_000;
const EXIT_SLIPPAGE_FRAC = EXECUTION_STOP_SLIPPAGE_BPS / 10_000;

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
    isLong,
    tradeResult,
    setStopLossPrice: setStopLossPriceOnSocket
  } = useSocket(symbol, trackedSymbols, selectedSessionId);
  const [riskPercentage, setRiskPercentage] = useState(2);
  const [stopLossPrice, setStopLossPrice] = useState(0);
  const [visibleTradeResult, setVisibleTradeResult] = useState<typeof tradeResult>(null);
  const [makerFeeRate, setMakerFeeRate] = useState(0.0001);
  const [takerFeeRate, setTakerFeeRate] = useState(0.00035);
  const [positionEntryPrice, setPositionEntryPrice] = useState(0);
  const [liveAccountBalance, setLiveAccountBalance] = useState(0);
  const [leveragePreview, setLeveragePreview] = useState<LeveragePreview | null>(null);
  const maxExchangeLeverage = 50;

  const entryPrice = hud.price;

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
  const accountBalanceForRisk = liveAccountBalance;
  const metrics = useMemo<RiskFirstMetrics>(() => {
    const preview = leveragePreview;
    if (!preview) {
      return {
        riskAmount: 0,
        priceDistance: 0,
        positionSize: 0,
        notionalValue: 0,
        leverage: 0,
        entryFee: 0,
        exitFee: 0,
        totalFees: 0,
        breakEvenPrice: 0,
        leverageTooHigh: false,
        maxExchangeLeverage
      };
    }
    const distance = Math.abs(entryPrice - stopLossPrice);
    const notional = Number(preview.notionalPosition || 0);
    const size = Number(preview.positionSizeUnits || 0);
    const effectiveMaxLev = Number(preview.exchangeMaxLeverage || maxExchangeLeverage);
    const entryFee = notional * Math.max(0, takerFeeRate);
    const exitFee = size * Math.max(0, stopLossPrice) * Math.max(0, takerFeeRate);
    const totalFees = entryFee + exitFee;
    const breakEvenPrice =
      entryPrice > 0
        ? isLong
          ? entryPrice *
            ((1 + takerFeeRate + ENTRY_SLIPPAGE_FRAC) /
              Math.max(1e-12, 1 - takerFeeRate - EXIT_SLIPPAGE_FRAC))
          : entryPrice *
            ((1 - takerFeeRate - ENTRY_SLIPPAGE_FRAC) /
              (1 + takerFeeRate + EXIT_SLIPPAGE_FRAC))
        : 0;
    return {
      riskAmount: Number(preview.riskDollars || 0),
      priceDistance: distance,
      positionSize: size,
      notionalValue: notional,
      leverage: Number(preview.cappedLeverage || 0),
      entryFee,
      exitFee,
      totalFees,
      breakEvenPrice,
      leverageTooHigh: Number(preview.recommendedLeverage || 0) > effectiveMaxLev,
      maxExchangeLeverage: effectiveMaxLev
    };
  }, [leveragePreview, entryPrice, stopLossPrice, takerFeeRate, isLong]);
  const warningText = leveragePreview?.warning || null;

  useEffect(() => {
    if (slPrice >= 0) {
      setStopLossPrice(slPrice);
    }
  }, [slPrice]);

  useEffect(() => {
    if (!tradeResult) return;
    setVisibleTradeResult(tradeResult);
    const timeoutId = window.setTimeout(() => setVisibleTradeResult(null), 6000);
    return () => window.clearTimeout(timeoutId);
  }, [tradeResult]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [fees, settings] = await Promise.all([fetchAccountFees("live"), fetchAccountSettings()]);
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
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!symbol) {
        setPositionEntryPrice(0);
        return;
      }
      const overview = await fetchAccountOverview("live");
      if (cancelled) return;
      const nextBalance = Number(overview?.overview?.accountValue ?? 0);
      setLiveAccountBalance(Number.isFinite(nextBalance) && nextBalance > 0 ? nextBalance : 0);
      const position = overview?.positions?.find((p) => String(p.coin || "").toUpperCase() === symbol.toUpperCase());
      const nextEntry = Number(position?.entryPx ?? 0);
      setPositionEntryPrice(Number.isFinite(nextEntry) && nextEntry > 0 ? nextEntry : 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, tradeResult]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!symbol || entryPrice <= 0 || stopLossPrice <= 0 || accountBalanceForRisk <= 0) {
        setLeveragePreview(null);
        return;
      }
      const stopLossDistancePct = isLong
        ? ((entryPrice - stopLossPrice) / entryPrice) * 100
        : ((stopLossPrice - entryPrice) / entryPrice) * 100;
      if (!Number.isFinite(stopLossDistancePct) || stopLossDistancePct <= 0) {
        setLeveragePreview(null);
        return;
      }
      const preview = await fetchLeveragePreview({
        symbol,
        stopLossDistancePct,
        riskBudgetPct: riskPercentage,
        slippageBps: EFFECTIVE_SLIPPAGE_BPS,
        mode: "live"
      });
      if (cancelled) return;
      setLeveragePreview(preview);
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, entryPrice, stopLossPrice, isLong, riskPercentage, accountBalanceForRisk]);

  const handleStopLossPriceChange = (nextPrice: number) => {
    setStopLossPrice(nextPrice);
    setStopLossPriceOnSocket(nextPrice);
  };

  const riskPanel = (
    <RiskFirstPanel
      accountBalance={accountBalanceForRisk}
      riskPercentage={riskPercentage}
      entryPrice={entryPrice}
      stopLossPrice={stopLossPrice}
      isLong={isLong}
      makerFeeRate={makerFeeRate}
      takerFeeRate={takerFeeRate}
      metrics={metrics}
      warningText={warningText}
      onRiskPercentageChange={setRiskPercentage}
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
            <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Live
            </span>
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
          {visibleTradeResult && (
            <div
              className={`absolute right-2 top-10 z-20 rounded-lg px-3 py-2 text-[11px] font-medium shadow-sm ring-1 ring-inset ${
                visibleTradeResult.ok
                  ? "bg-emerald-100 text-emerald-950 ring-emerald-300"
                  : "bg-rose-100 text-rose-950 ring-rose-300"
              }`}
            >
              <div className="font-semibold uppercase tracking-wide">
                {visibleTradeResult.action}
                {visibleTradeResult.symbol ? ` · ${visibleTradeResult.symbol}` : ""}
              </div>
              <div>
                {visibleTradeResult.ok
                  ? visibleTradeResult.details || "Trade action completed"
                  : visibleTradeResult.error || "Trade action failed"}
              </div>
            </div>
          )}
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
            entryPrice={positionEntryPrice}
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
