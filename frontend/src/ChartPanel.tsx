import { useSocket } from "./useSocket";
import { Chart } from "./Chart";
import type { Timeframe } from "./types";

interface ChartPanelProps {
  symbol: string;
}

/**
 * Self-contained chart module: owns socket connection, live candle streaming,
 * historical fetch, and chart + HUD for a single symbol. Key by symbol so
 * switching primary fully remounts and refreshes state. Enables multiple
 * chart instances in the future (one per symbol).
 */
export function ChartPanel({ symbol }: ChartPanelProps) {
  const { hud, candles, timeframe, setTimeframe, historyLoading } = useSocket(symbol);
  const effectiveTimeframe = timeframe ?? "1m";

  const handleTimeframeClick = (tf: Timeframe) => setTimeframe(tf);

  return (
    <section className="chart panel" data-symbol={symbol}>
      <div className="chart-panel-header">
        <span className="chart-symbol">{symbol}</span>
        <div className="timeframe-toggle">
          <button
            className={`tf-btn ${effectiveTimeframe === "1m" ? "active" : ""}`}
            onClick={() => handleTimeframeClick("1m")}
          >
            1m
          </button>
          <button
            className={`tf-btn ${effectiveTimeframe === "5m" ? "active" : ""}`}
            onClick={() => handleTimeframeClick("5m")}
          >
            5m
          </button>
        </div>
      </div>
      <div className="chart-container">
        {historyLoading && (
          <div className="chart-loading" aria-hidden="true">
            <span className="chart-loading-spinner" />
            <span className="chart-loading-text">Loading history…</span>
          </div>
        )}
        <Chart candles={candles} />
      </div>
      <aside className="chart-hud">
        <h3>HUD</h3>
        <div className="hud-row">
          <span>Live Price</span>
          <strong>{hud.price > 0 ? hud.price.toFixed(2) : "-"}</strong>
        </div>
        <div className="hud-row">
          <span>Balance</span>
          <strong>${hud.balance.toFixed(2)}</strong>
        </div>
        <div className="hud-row">
          <span>Stop Loss</span>
          <strong>{hud.stopLossPrice.toFixed(2)}</strong>
        </div>
        <div className="hud-row">
          <span>Position Size ({hud.riskPercent}% Risk)</span>
          <strong>{hud.positionSize.toFixed(6)}</strong>
        </div>
      </aside>
    </section>
  );
}
