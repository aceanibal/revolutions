import { useEffect, useMemo, useState } from "react";
import { useSocket } from "./useSocket";
import { Chart } from "./Chart";
import type { SessionInfo, Timeframe } from "./types";

interface ChartPanelProps {
  symbol: string;
  trackedSymbols?: string[];
  vwapPeriod?: number;
  emaEnabled?: boolean;
  emaPeriod?: number;
  restartSignal?: number;
  onSessionInfoChange?: (sessionInfo: SessionInfo) => void;
  onHistoryPreloadingChange?: (loading: boolean) => void;
}

/**
 * Self-contained chart module: owns socket connection, live candle streaming,
 * historical fetch, and chart + HUD for a single symbol. Key by symbol so
 * switching primary fully remounts and refreshes state. Enables multiple
 * chart instances in the future (one per symbol).
 */
export function ChartPanel({
  symbol,
  trackedSymbols = [],
  vwapPeriod = 20,
  emaEnabled = true,
  emaPeriod = 9,
  restartSignal = 0,
  onSessionInfoChange,
  onHistoryPreloadingChange
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
    sessionInfo
  } =
    useSocket(symbol, trackedSymbols, restartSignal);
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
    onSessionInfoChange?.(sessionInfo);
  }, [onSessionInfoChange, sessionInfo]);

  useEffect(() => {
    onHistoryPreloadingChange?.(historyPreloading);
  }, [historyPreloading, onHistoryPreloadingChange]);

  return (
    <section className="relative h-full overflow-hidden rounded-xl border border-slate-200 bg-white" data-symbol={symbol}>
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

      <div className="absolute bottom-2 left-2 z-20 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-inset ring-slate-200 backdrop-blur">
        <span className="tabular-nums">{hud.price > 0 ? hud.price.toFixed(2) : "-"}</span>
        <span className="tabular-nums">${hud.balance.toFixed(2)}</span>
        <span className="tabular-nums">{hud.stopLossPrice.toFixed(2)}</span>
        <span className="tabular-nums">
          {hud.positionSize.toFixed(6)} ({hud.riskPercent}%)
        </span>
      </div>

      <div className="relative h-full min-h-[360px] w-full bg-white sm:min-h-[520px]">
        {waitingForLiveData && !historyPreloading && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/70">
            <span className="text-xs font-medium text-gray-700">Waiting for live candles...</span>
          </div>
        )}
        <Chart
          candles={candles}
          vwapPeriod={vwapPeriod}
          emaEnabled={emaEnabled}
          emaPeriod={emaPeriod}
          onCrosshairTimeChange={setHoveredTimeSec}
        />
      </div>
    </section>
  );
}
