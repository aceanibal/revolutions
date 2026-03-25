import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSocket } from "./useSocket";
import { Chart } from "./Chart";
import type { LeveragePreview, SessionInfo, Timeframe } from "./types";
import {
  fetchAccountFees,
  fetchAccountOverview,
  fetchAccountSettings,
  fetchLeveragePreview,
  updateAccountSettings
} from "./lib/api";
import type { RiskFirstMetrics } from "./lib/riskCalculator";
import { RiskFirstPanel } from "./RiskFirstPanel";

const EXECUTION_ENTRY_SLIPPAGE_BPS = 200; // matches hyperliquid.js executeTrade 2%
const EXECUTION_STOP_SLIPPAGE_BPS = 300; // matches hyperliquid.js placeStopLoss 3%
const EFFECTIVE_SLIPPAGE_BPS = EXECUTION_ENTRY_SLIPPAGE_BPS + EXECUTION_STOP_SLIPPAGE_BPS;
const ENTRY_SLIPPAGE_FRAC = EXECUTION_ENTRY_SLIPPAGE_BPS / 10_000;
const EXIT_SLIPPAGE_FRAC = EXECUTION_STOP_SLIPPAGE_BPS / 10_000;
type SettingsSaveState = "idle" | "saving" | "saved" | "error";

interface ChartPanelProps {
  symbol: string;
  trackedSymbols?: string[];
  vwapEnabled?: boolean;
  vwapPeriod?: number;
  anchoredVwapEnabled?: boolean;
  anchoredVwapAnchorTimeSec?: number;
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
  anchoredVwapEnabled = false,
  anchoredVwapAnchorTimeSec = 0,
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
    accountSettings,
    gaps,
    accountMode,
    isLong,
    tradeResult,
    tradeState,
    setStopLossPrice: setStopLossPriceOnSocket
  } = useSocket(symbol, trackedSymbols, selectedSessionId);
  const [riskPercentage, setRiskPercentage] = useState(2);
  const [takeProfitPercentage, setTakeProfitPercentage] = useState(2);
  const [stopLossPrice, setStopLossPrice] = useState(0);
  const [visibleTradeResult, setVisibleTradeResult] = useState<typeof tradeResult>(null);
  const [takerFeeRate, setTakerFeeRate] = useState(0.00035);
  const [positionEntryPrice, setPositionEntryPrice] = useState(0);
  const [liveAccountBalance, setLiveAccountBalance] = useState(0);
  const [leveragePreview, setLeveragePreview] = useState<LeveragePreview | null>(null);
  const [settingsSaveState, setSettingsSaveState] = useState<SettingsSaveState>("idle");
  const [settingsSaveMessage, setSettingsSaveMessage] = useState<string | null>(null);
  const [userStopLines, setUserStopLines] = useState<number[]>([]);
  const [drawModeEnabled, setDrawModeEnabled] = useState(false);
  const maxExchangeLeverage = 50;

  const riskEntryPrice = hud.price;

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
    const orderedTimeframes: Timeframe[] = ["1m", "5m", "15m"];
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const currentIndex = Math.max(0, orderedTimeframes.indexOf(effectiveTimeframe));
      if (e.key === "1") {
        const prevIndex = (currentIndex - 1 + orderedTimeframes.length) % orderedTimeframes.length;
        setTimeframe(orderedTimeframes[prevIndex]);
      } else if (e.key === "2") {
        const nextIndex = (currentIndex + 1) % orderedTimeframes.length;
        setTimeframe(orderedTimeframes[nextIndex]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [effectiveTimeframe, setTimeframe]);

  useEffect(() => {
    onSessionInfoChange?.(sessionInfo);
  }, [onSessionInfoChange, sessionInfo]);

  useEffect(() => {
    onHistoryPreloadingChange?.(historyPreloading);
  }, [historyPreloading, onHistoryPreloadingChange]);

  const slPrice = Number(hud.stopLossPrice ?? 0) > 0 ? Number(hud.stopLossPrice ?? 0) : 0;
  const activeTradeStatus = tradeState?.status || "FLAT";
  const hasActiveTrade =
    activeTradeStatus === "OPEN" || activeTradeStatus === "PENDING_OPEN" || activeTradeStatus === "PENDING_CLOSE";
  const activeTradeIsLong = tradeState?.side ? tradeState.side === "long" : isLong;
  const accountBalanceForRisk = liveAccountBalance;

  // Navy dashed chart line: exchange stop inferred from pending orders only (not HUD tradeState.stopLoss).
  const chartActiveStopPrice = useMemo(() => {
    if (!hasActiveTrade) return null;
    const fromOrders = Number(tradeState?.stopLossFromPendingOrders ?? 0);
    return Number.isFinite(fromOrders) && fromOrders > 0 ? fromOrders : null;
  }, [hasActiveTrade, tradeState?.stopLossFromPendingOrders]);
  const chartActiveTpPrice = useMemo(() => {
    if (!hasActiveTrade) return null;
    const fromOrders = Number(tradeState?.takeProfitFromPendingOrders ?? 0);
    return Number.isFinite(fromOrders) && fromOrders > 0 ? fromOrders : null;
  }, [hasActiveTrade, tradeState?.takeProfitFromPendingOrders]);
  const activeEntryPrice = hasActiveTrade
    ? Number(tradeState?.entryPx ?? 0) > 0
      ? Number(tradeState?.entryPx ?? 0)
      : Number(tradeState?.executionMeta?.entryPxFilled ?? 0) > 0
        ? Number(tradeState?.executionMeta?.entryPxFilled ?? 0)
        : 0
    : 0;
  // Product rule: risk/sizing always uses the controller/HUD stop.
  const riskStopLossPrice = slPrice;
  const exchangeStopLossPrice = chartActiveStopPrice;
  const hasStopMismatch =
    hasActiveTrade &&
    riskStopLossPrice > 0 &&
    Number.isFinite(Number(exchangeStopLossPrice ?? 0)) &&
    Number(exchangeStopLossPrice ?? 0) > 0 &&
    Math.abs(Number(exchangeStopLossPrice) - riskStopLossPrice) > 1e-6;

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
    const slForRisk = riskStopLossPrice > 0 ? riskStopLossPrice : stopLossPrice;
    const distance = Math.abs(riskEntryPrice - slForRisk);
    const notional = Number(preview.notionalPosition || 0);
    const size = Number(preview.positionSizeUnits || 0);
    const effectiveMaxLev = Number(preview.exchangeMaxLeverage || maxExchangeLeverage);
    const entryFee = notional * Math.max(0, takerFeeRate);
    const exitFee = size * Math.max(0, slForRisk) * Math.max(0, takerFeeRate);
    const totalFees = entryFee + exitFee;
    const breakEvenPrice =
      riskEntryPrice > 0
        ? activeTradeIsLong
          ? riskEntryPrice *
            ((1 + takerFeeRate + ENTRY_SLIPPAGE_FRAC) /
              Math.max(1e-12, 1 - takerFeeRate - EXIT_SLIPPAGE_FRAC))
          : riskEntryPrice *
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
  }, [leveragePreview, riskEntryPrice, riskStopLossPrice, stopLossPrice, takerFeeRate, activeTradeIsLong]);
  const warningText = leveragePreview?.warning || null;
  const takeProfitPrice = useMemo(() => {
    const entry = Number(riskEntryPrice ?? 0);
    const stop = Number(riskStopLossPrice ?? 0);
    const riskPct = Number(riskPercentage ?? 0);
    const profitPct = Number(takeProfitPercentage ?? 0);
    if (!Number.isFinite(entry) || entry <= 0) return null;
    if (!Number.isFinite(stop) || stop <= 0) return null;
    if (!Number.isFinite(riskPct) || riskPct <= 0) return null;
    if (!Number.isFinite(profitPct) || profitPct <= 0) return null;
    const riskDistance = Math.abs(entry - stop);
    if (!Number.isFinite(riskDistance) || riskDistance <= 0) return null;
    const rr = profitPct / riskPct;
    if (!Number.isFinite(rr) || rr <= 0) return null;
    return activeTradeIsLong ? entry + riskDistance * rr : entry - riskDistance * rr;
  }, [riskEntryPrice, riskStopLossPrice, riskPercentage, takeProfitPercentage, activeTradeIsLong]);

  const chartEntryPrice =
    hasActiveTrade
      ? activeEntryPrice || positionEntryPrice
      : positionEntryPrice;
  const chartSignedR = useMemo(() => {
    if (!hasActiveTrade) return null;
    const entry = activeEntryPrice > 0 ? activeEntryPrice : positionEntryPrice;
    const stopFromOrders = Number(chartActiveStopPrice ?? 0);
    const currentPrice = Number(hud.price ?? 0);
    if (!Number.isFinite(entry) || entry <= 0) return null;
    if (!Number.isFinite(stopFromOrders) || stopFromOrders <= 0) return null;
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;
    const baseR = Math.abs(entry - stopFromOrders);
    if (!Number.isFinite(baseR) || baseR <= 0) return null;
    const signedMove = activeTradeIsLong ? currentPrice - entry : entry - currentPrice;
    return signedMove / baseR;
  }, [hasActiveTrade, activeEntryPrice, positionEntryPrice, chartActiveStopPrice, hud.price, activeTradeIsLong]);

  /**
   * Draggable (solid) SL line = HUD only (`hud.stopLossPrice` / socket).
   * Book stop is the navy dashed line (`stopLossFromPendingOrders`) — do not drive the solid line from
   * `riskStopLossPrice` or it resets on every tradeState:update and feels stuck.
   */
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
      const [fees, settings] = await Promise.all([fetchAccountFees(accountMode), fetchAccountSettings()]);
      if (cancelled) return;
      if (fees) {
        setTakerFeeRate(Math.max(0, Number(fees.userCrossRate ?? 0)));
      }
      if (settings?.riskPercent && Number.isFinite(settings.riskPercent)) {
        setRiskPercentage(Math.max(0, Number(settings.riskPercent)));
      }
      if (settings?.takeProfitPercent && Number.isFinite(settings.takeProfitPercent)) {
        setTakeProfitPercentage(Math.max(0, Number(settings.takeProfitPercent)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountMode]);

  useEffect(() => {
    if (!accountSettings) return;
    const nextRisk = Number(accountSettings.riskPercent ?? 0);
    const nextTp = Number(accountSettings.takeProfitPercent ?? 0);
    if (Number.isFinite(nextRisk) && nextRisk > 0) {
      setRiskPercentage(nextRisk);
    }
    if (Number.isFinite(nextTp) && nextTp > 0) {
      setTakeProfitPercentage(nextTp);
    }
  }, [accountSettings]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!symbol) {
        setPositionEntryPrice(0);
        return;
      }
      if (hasActiveTrade && activeEntryPrice > 0) {
        setPositionEntryPrice(activeEntryPrice);
      }
      const overview = await fetchAccountOverview(accountMode);
      if (cancelled) return;
      const nextBalance = Number(overview?.overview?.accountValue ?? 0);
      setLiveAccountBalance(Number.isFinite(nextBalance) && nextBalance > 0 ? nextBalance : 0);
      const position = overview?.positions?.find((p) => String(p.coin || "").toUpperCase() === symbol.toUpperCase());
      const nextEntry = Number(position?.entryPx ?? 0);
      if (!hasActiveTrade && Number.isFinite(nextEntry) && nextEntry > 0) {
        setPositionEntryPrice(nextEntry);
      } else if (!hasActiveTrade) {
        setPositionEntryPrice(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, tradeResult, tradeState, accountMode, activeEntryPrice, hasActiveTrade]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!symbol || riskEntryPrice <= 0 || riskStopLossPrice <= 0 || accountBalanceForRisk <= 0) {
        setLeveragePreview(null);
        return;
      }
      const stopLossDistancePct = activeTradeIsLong
        ? ((riskEntryPrice - riskStopLossPrice) / riskEntryPrice) * 100
        : ((riskStopLossPrice - riskEntryPrice) / riskEntryPrice) * 100;
      if (!Number.isFinite(stopLossDistancePct) || stopLossDistancePct <= 0) {
        setLeveragePreview(null);
        return;
      }
      const preview = await fetchLeveragePreview({
        symbol,
        stopLossDistancePct,
        riskBudgetPct: riskPercentage,
        slippageBps: EFFECTIVE_SLIPPAGE_BPS,
        mode: accountMode
      });
      if (cancelled) return;
      setLeveragePreview(preview);
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, riskEntryPrice, riskStopLossPrice, activeTradeIsLong, riskPercentage, accountBalanceForRisk, accountMode]);

  const handleStopLossPriceChange = (nextPrice: number) => {
    setStopLossPrice(nextPrice);
    setStopLossPriceOnSocket(nextPrice);
  };

  const handleChartClickPrice = (price: number) => {
    if (!drawModeEnabled) return;
    if (!Number.isFinite(price) || price <= 0) return;
    setUserStopLines((prev) => [...prev, price]);
  };

  const handleClearLines = () => {
    setUserStopLines([]);
  };

  const handleSaveRiskSettings = async () => {
    if (settingsSaveState === "saving") return;
    setSettingsSaveState("saving");
    setSettingsSaveMessage(null);
    const updated = await updateAccountSettings({
      riskPercent: riskPercentage,
      takeProfitPercent: takeProfitPercentage
    });
    if (!updated) {
      setSettingsSaveState("error");
      setSettingsSaveMessage("Failed to save settings");
      return;
    }
    setRiskPercentage(Number(updated.riskPercent ?? riskPercentage));
    setTakeProfitPercentage(Number(updated.takeProfitPercent ?? takeProfitPercentage));
    setSettingsSaveState("saved");
    setSettingsSaveMessage("Settings saved");
    window.setTimeout(() => {
      setSettingsSaveState("idle");
      setSettingsSaveMessage(null);
    }, 3000);
  };

  const riskPanel = (
    <RiskFirstPanel
      accountBalance={accountBalanceForRisk}
      riskPercentage={riskPercentage}
      takeProfitPercentage={takeProfitPercentage}
      takeProfitPrice={takeProfitPrice}
      entryPrice={riskEntryPrice}
      controllerStopLossPrice={riskStopLossPrice}
      exchangeStopLossPrice={exchangeStopLossPrice}
      exchangeTakeProfitPrice={chartActiveTpPrice}
      hasStopMismatch={hasStopMismatch}
      isLong={activeTradeIsLong}
      takerFeeRate={takerFeeRate}
      metrics={metrics}
      warningText={warningText}
      tradeState={tradeState}
      saveState={settingsSaveState}
      saveMessage={settingsSaveMessage}
      onRiskPercentageChange={setRiskPercentage}
      onTakeProfitPercentageChange={setTakeProfitPercentage}
      onSaveSettings={() => void handleSaveRiskSettings()}
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
            <button
              type="button"
              className={`rounded-full px-2 py-0.5 transition ${
                effectiveTimeframe === "15m"
                  ? "bg-indigo-600 text-white"
                  : "text-indigo-700 hover:bg-indigo-100"
              }`}
              onClick={() => handleTimeframeClick("15m")}
            >
              15m
            </button>
            <button
              type="button"
              className={`rounded-full px-2 py-0.5 text-white transition ${
                drawModeEnabled ? "bg-amber-700 hover:bg-amber-800" : "bg-slate-800 hover:bg-slate-700"
              }`}
              onClick={() => setDrawModeEnabled((prev) => !prev)}
            >
              Draw Line
            </button>
            <button
              type="button"
              className="rounded-full px-2 py-0.5 text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
              disabled={userStopLines.length === 0}
              onClick={handleClearLines}
            >
              Clear Lines
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
            anchoredVwapEnabled={anchoredVwapEnabled}
            anchoredVwapAnchorTimeSec={anchoredVwapAnchorTimeSec}
            emaEnabled={emaEnabled}
            emaPeriod={emaPeriod}
            entryPrice={chartEntryPrice}
            stopLossPrice={stopLossPrice}
            stopPlacedPrice={chartActiveStopPrice}
            takeProfitPlacedPrice={chartActiveTpPrice}
            breakEvenPrice={metrics.breakEvenPrice}
            signedR={chartSignedR}
            isLong={activeTradeIsLong}
            userHorizontalLines={userStopLines}
            enableStopLossDrag
            onStopLossPriceChange={handleStopLossPriceChange}
            onCrosshairTimeChange={setHoveredTimeSec}
            onChartClickPrice={handleChartClickPrice}
          />
        </div>
      </section>
      {riskPanelTarget ? createPortal(riskPanel, riskPanelTarget) : riskPanel}
    </>
  );
}
