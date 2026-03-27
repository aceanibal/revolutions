import { CandleChart } from "../../components/CandleChart";
import { formatDateTime, runTotalR, tradePnlInR } from "../../lib/backtestMath";
import type {
  BacktestOptimizerSettings,
  BacktestRunResult,
  Candle,
  StrategyId,
  Timeframe
} from "../../types";

interface SingleRunWorkspaceProps {
  timeframe: Timeframe;
  strategyId: StrategyId;
  loadingSnapshot: boolean;
  selectedSessionId: string;
  selectedSymbol: string;
  chartCandles: Candle[];
  candleRange: { count: number; from: number; to: number } | null;
  runResult: BacktestRunResult | null;
  optimizerSettings: BacktestOptimizerSettings;
  onOptimizerSettingChange: (patch: Partial<BacktestOptimizerSettings>) => void;
  onTradeClick: (index: number) => void;
}

export function SingleRunWorkspace({
  timeframe,
  strategyId,
  loadingSnapshot,
  selectedSessionId,
  selectedSymbol,
  chartCandles,
  candleRange,
  runResult,
  optimizerSettings,
  onOptimizerSettingChange,
  onTradeClick
}: SingleRunWorkspaceProps) {
  return (
    <>
      <section className="grid2">
        <div className="card">
          <h3>Strategy Variables (Single Run)</h3>
          {strategyId === "orb-avwap-930" ? (
            <div className="optimizer-row">
              <label>
                Take Profit (R)
                <input
                  type="number"
                  min={0.1}
                  max={20}
                  step={0.1}
                  value={optimizerSettings.takeProfitRR}
                  onChange={(e) =>
                    onOptimizerSettingChange({
                      takeProfitRR: Math.max(0.1, Number(e.target.value || 2))
                    })
                  }
                />
              </label>
              <label>
                VWAP Start (HHMM)
                <input
                  type="number"
                  min={0}
                  max={2359}
                  step={1}
                  value={optimizerSettings.vwapStartHHMM}
                  onChange={(e) =>
                    onOptimizerSettingChange({
                      vwapStartHHMM: Math.max(0, Math.min(2359, Number(e.target.value || 930)))
                    })
                  }
                />
              </label>
              <label>
                Active Start (HHMM)
                <input
                  type="number"
                  min={0}
                  max={2359}
                  step={1}
                  value={optimizerSettings.activeStartHHMM}
                  onChange={(e) =>
                    onOptimizerSettingChange({
                      activeStartHHMM: Math.max(0, Math.min(2359, Number(e.target.value || 930)))
                    })
                  }
                />
              </label>
              <label>
                Active End (HHMM)
                <input
                  type="number"
                  min={0}
                  max={2359}
                  step={1}
                  value={optimizerSettings.activeEndHHMM}
                  onChange={(e) =>
                    onOptimizerSettingChange({
                      activeEndHHMM: Math.max(0, Math.min(2359, Number(e.target.value || 1600)))
                    })
                  }
                />
              </label>
            </div>
          ) : (
            <div className="sub">This strategy does not expose configurable variables for single-run editing yet.</div>
          )}
        </div>
        <div className="card">
          <h3>Run Hints</h3>
          <div className="sub">
            Strategy variables here apply to the next single run and are also reused by batch runs.
          </div>
          <div className="sub">Change strategy in the toolbar to update the variable panel.</div>
        </div>
      </section>

      <section className="grid2">
        <div className="card chart-card">
          <h3>Session Candles ({timeframe})</h3>
          {loadingSnapshot ? (
            <div className="empty">Loading session candles...</div>
          ) : chartCandles.length > 0 ? (
            <>
              <div className="sub" style={{ marginBottom: 6 }}>
                {candleRange?.count || 0} candles · {candleRange ? formatDateTime(candleRange.from) : "--"} to{" "}
                {candleRange ? formatDateTime(candleRange.to) : "--"}
              </div>
              <CandleChart candles={chartCandles} />
            </>
          ) : selectedSessionId && selectedSymbol ? (
            <div className="empty">
              No candles for session `{selectedSessionId}` symbol `{selectedSymbol}` timeframe `{timeframe}`.
            </div>
          ) : (
            <div className="empty">Select a session and symbol to view candles.</div>
          )}
        </div>
        <div className="card table-card">
          <h3>Simulated Trades ({runResult?.trades?.length || 0})</h3>
          {runResult?.trades?.length ? (
            <table>
              <thead>
                <tr>
                  <th>Opened (ET)</th>
                  <th>Closed (ET)</th>
                  <th>Side</th>
                  <th>Entry</th>
                  <th>Exit</th>
                  <th>SL</th>
                  <th>TP</th>
                  <th>PnL (R)</th>
                </tr>
              </thead>
              <tbody>
                {runResult.trades.map((trade, idx) => (
                  <tr
                    key={`${trade.openedAtMs}-${trade.closedAtMs}-${idx}`}
                    className="trade-row"
                    onClick={() => onTradeClick(idx)}
                    title="Click to open trade chart"
                  >
                    <td>{formatDateTime(trade.openedAtMs)}</td>
                    <td>{formatDateTime(trade.closedAtMs)}</td>
                    <td>{String(trade.side || "").toUpperCase()}</td>
                    <td>{Number(trade.entryPx || 0).toFixed(4)}</td>
                    <td>{Number(trade.exitPx || 0).toFixed(4)}</td>
                    <td>{trade.stopLoss == null ? "--" : Number(trade.stopLoss).toFixed(4)}</td>
                    <td>{trade.takeProfit == null ? "--" : Number(trade.takeProfit).toFixed(4)}</td>
                    <td>
                      {(() => {
                        const r = tradePnlInR({
                          side: String(trade.side || ""),
                          entryPx: Number(trade.entryPx || 0),
                          stopLoss: trade.stopLoss,
                          size: Number(trade.size || 0),
                          pnl: Number(trade.pnl || 0)
                        });
                        return r == null ? "--" : `${r.toFixed(3)}R`;
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">Run a backtest to view simulated trades.</div>
          )}
        </div>
      </section>

      <section className="grid2">
        <div className="card">
          <h3>Run Metrics</h3>
          {runResult ? (
            <>
              <div className="sub">Trades: {runResult.metrics.tradeCount}</div>
              <div className="sub">Win rate: {(runResult.metrics.winRate * 100).toFixed(2)}%</div>
              <div className="sub">PnL (R): {runTotalR(runResult.trades).toFixed(3)}R</div>
              <div className="sub">Max drawdown: {runResult.metrics.maxDrawdown.toFixed(4)}</div>
              <div className="sub">Real tick events: {runResult.meta.eventStats.realTickEvents}</div>
              <div className="sub">Synthetic tick events: {runResult.meta.eventStats.syntheticTickEvents}</div>
              <div className="sub">Candle events: {runResult.meta.eventStats.candleEvents}</div>
              {runResult.meta.strategyId === "orb-avwap-930" && (
                <>
                  <div className="sub">
                    TP RR: {Number(runResult.meta.params?.rr || optimizerSettings.takeProfitRR).toFixed(2)}R
                  </div>
                  <div className="sub">
                    VWAP start (ET): {Number(runResult.meta.params?.anchorHHMM || optimizerSettings.vwapStartHHMM)}
                  </div>
                  <div className="sub">
                    Active window (ET):{" "}
                    {Number(runResult.meta.params?.activeStartHHMM || optimizerSettings.activeStartHHMM)}-
                    {Number(runResult.meta.params?.activeEndHHMM || optimizerSettings.activeEndHHMM)}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="empty">No run yet.</div>
          )}
        </div>
        <div className="card">
          <h3>Trade Drill-down</h3>
          <div className="sub">
            Click any simulated trade row to open a visual replay with entry, SL, TP, and trade-time marker.
          </div>
        </div>
      </section>
    </>
  );
}
