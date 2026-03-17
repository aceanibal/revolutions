import { useEffect } from "react";
import { useSocket } from "./useSocket";
import { Chart } from "./Chart";
import type { SessionInfo, Timeframe } from "./types";

interface ChartPanelProps {
  symbol: string;
  trackedSymbols?: string[];
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
  restartSignal = 0,
  onSessionInfoChange,
  onHistoryPreloadingChange
}: ChartPanelProps) {
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

  const handleTimeframeClick = (tf: Timeframe) => setTimeframe(tf);

  useEffect(() => {
    onSessionInfoChange?.(sessionInfo);
  }, [onSessionInfoChange, sessionInfo]);

  useEffect(() => {
    onHistoryPreloadingChange?.(historyPreloading);
  }, [historyPreloading, onHistoryPreloadingChange]);

  return (
    <section
      className="flex flex-col gap-4 lg:flex-row"
      data-symbol={symbol}
    >
      <div className="relative flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold tracking-tight text-gray-900">
                {symbol}
              </span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Perp
              </span>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
              <span
                className={`inline-flex h-2 w-2 rounded-full ${
                  connected
                    ? "bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.25)]"
                    : "bg-slate-300"
                }`}
              />
              <span>{connected ? "Connected" : "Disconnected"}</span>
            </div>
          </div>
          <div className="inline-flex items-center gap-1 rounded-full bg-indigo-50 p-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
            <span className="px-2 text-[11px] uppercase tracking-wide">TF</span>
            <button
              type="button"
              className={`rounded-full px-2.5 py-1 transition ${
                effectiveTimeframe === "1m"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-indigo-700 hover:bg-indigo-100"
              }`}
              onClick={() => handleTimeframeClick("1m")}
            >
              1m
            </button>
            <button
              type="button"
              className={`rounded-full px-2.5 py-1 transition ${
                effectiveTimeframe === "5m"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-indigo-700 hover:bg-indigo-100"
              }`}
              onClick={() => handleTimeframeClick("5m")}
            >
              5m
            </button>
          </div>
        </div>

        <div className="relative h-72 w-full bg-white sm:h-80 md:h-96">
          {waitingForLiveData && !historyPreloading && (
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/80">
              <span className="text-xs font-medium text-gray-700">
                Waiting for live stream candles for this session.
              </span>
              <span className="text-[11px] text-gray-500">
                Candles populate as `tick` and `priceUpdate` events arrive.
              </span>
            </div>
          )}
          <Chart candles={candles} />
        </div>
      </div>

      <aside className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm lg:w-64">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          HUD
        </h3>
        <dl className="mt-3 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-gray-500">Live Price</dt>
            <dd className="tabular-nums text-sm font-semibold text-gray-900">
              {hud.price > 0 ? hud.price.toFixed(2) : "-"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-gray-500">Balance</dt>
            <dd className="tabular-nums text-sm font-semibold text-gray-900">
              ${hud.balance.toFixed(2)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-gray-500">Stop Loss</dt>
            <dd className="tabular-nums text-sm font-semibold text-gray-900">
              {hud.stopLossPrice.toFixed(2)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-gray-500">
              Position Size
              <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                {hud.riskPercent}% risk
              </span>
            </dt>
            <dd className="tabular-nums text-sm font-semibold text-gray-900">
              {hud.positionSize.toFixed(6)}
            </dd>
          </div>
        </dl>
      </aside>
    </section>
  );
}
