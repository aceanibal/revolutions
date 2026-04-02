import { CandleChart } from "../../components/CandleChart";
import {
  buildSimulatedTradesCsv,
  buildSimulatedTradesWithOneMinuteCandlesCsv,
  buildSimulatedTradesWithOneMinuteCandlesJson,
  displayMetricsFromTrades,
  formatDateTime,
  pickNestedScannerPayload,
  runTotalR,
  tradeOutcomeFromPnl,
  tradePnlInR
} from "../../lib/backtestMath";
import type {
  BacktestOptimizerSettings,
  BacktestRunResult,
  Candle,
  StrategyDefinition,
  StrategyId,
  StrategyParamDefinition,
  Timeframe
} from "../../types";

interface SingleRunWorkspaceProps {
  timeframe: Timeframe;
  strategyId: StrategyId;
  loadingSnapshot: boolean;
  selectedSessionId: string;
  selectedSymbol: string;
  chartCandles: Candle[];
  tradeWindowCandles: Candle[];
  oneMinuteCandles: Candle[];
  candleRange: { count: number; from: number; to: number } | null;
  runResult: BacktestRunResult | null;
  tradesForDisplay: BacktestRunResult["trades"];
  capTradesTwoPerDay: boolean;
  onCapTradesTwoPerDayChange: (value: boolean) => void;
  simWinStopRetryPerDay: boolean;
  onSimWinStopRetryPerDayChange: (value: boolean) => void;
  optimizerSettings: BacktestOptimizerSettings;
  onOptimizerSettingChange: (patch: Partial<BacktestOptimizerSettings>) => void;
  strategyDefinition: StrategyDefinition | null;
  strategyParams: Record<string, unknown>;
  onStrategyParamChange: (key: string, value: unknown) => void;
  onTradeClick: (index: number) => void;
}

export function SingleRunWorkspace({
  timeframe,
  strategyId,
  loadingSnapshot,
  selectedSessionId,
  selectedSymbol,
  chartCandles,
  tradeWindowCandles,
  oneMinuteCandles,
  candleRange,
  runResult,
  tradesForDisplay,
  capTradesTwoPerDay,
  onCapTradesTwoPerDayChange,
  simWinStopRetryPerDay,
  onSimWinStopRetryPerDayChange,
  optimizerSettings,
  onOptimizerSettingChange,
  strategyDefinition,
  strategyParams,
  onStrategyParamChange,
  onTradeClick
}: SingleRunWorkspaceProps) {
  const fullTradeCount = runResult?.trades?.length ?? 0;
  const displayMetricsCap = displayMetricsFromTrades(tradesForDisplay);
  const useDisplayAdjustedMetrics = capTradesTwoPerDay || simWinStopRetryPerDay;
  const scannerFeatureSet = String(
    (runResult?.meta?.params as Record<string, unknown> | undefined)?.scannerFeatureSet || "rvol-scanner"
  );

  const exportTradesCsv = () => {
    if (!runResult?.trades?.length) return;
    const csv = buildSimulatedTradesCsv(runResult.trades, runResult.meta);
    const safeSession = String(runResult.meta.sessionId || "session").replace(/[^a-zA-Z0-9_-]+/g, "_");
    const safeSymbol = String(runResult.meta.symbol || "symbol").replace(/[^a-zA-Z0-9_-]+/g, "_");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sim-trades_${safeSession}_${safeSymbol}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportTradesWithOneMinuteCandlesCsv = () => {
    if (!runResult?.trades?.length) return;
    const csv = buildSimulatedTradesWithOneMinuteCandlesCsv({
      trades: runResult.trades,
      meta: runResult.meta,
      tradeWindowCandles,
      oneMinuteCandles,
      contextCandles: 10
    });
    const safeSession = String(runResult.meta.sessionId || "session").replace(/[^a-zA-Z0-9_-]+/g, "_");
    const safeSymbol = String(runResult.meta.symbol || "symbol").replace(/[^a-zA-Z0-9_-]+/g, "_");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sim-trades_with-1m-window_${safeSession}_${safeSymbol}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportTradesWithOneMinuteCandlesJson = () => {
    if (!runResult?.trades?.length) return;
    const json = buildSimulatedTradesWithOneMinuteCandlesJson({
      trades: runResult.trades,
      meta: runResult.meta,
      tradeWindowCandles,
      oneMinuteCandles,
      contextCandles: 10
    });
    const safeSession = String(runResult.meta.sessionId || "session").replace(/[^a-zA-Z0-9_-]+/g, "_");
    const safeSymbol = String(runResult.meta.symbol || "symbol").replace(/[^a-zA-Z0-9_-]+/g, "_");
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sim-trades_full_${safeSession}_${safeSymbol}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderParamInput = (param: StrategyParamDefinition) => {
    const value = strategyParams[param.key];
    if (param.type === "boolean") {
      return (
        <label key={param.key} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onStrategyParamChange(param.key, Boolean(e.target.checked))}
          />
          {param.label}
        </label>
      );
    }
    if (param.type === "select") {
      return (
        <label key={param.key}>
          {param.label}
          <select value={String(value ?? "")} onChange={(e) => onStrategyParamChange(param.key, e.target.value)}>
            {(param.options || []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      );
    }
    if (param.type === "number") {
      return (
        <label key={param.key}>
          {param.label}
          <input
            type="number"
            min={param.min}
            max={param.max}
            step={param.step}
            value={Number(value ?? 0)}
            onChange={(e) => onStrategyParamChange(param.key, Number(e.target.value))}
          />
        </label>
      );
    }
    return (
      <label key={param.key}>
        {param.label}
        <input type="text" value={String(value ?? "")} onChange={(e) => onStrategyParamChange(param.key, e.target.value)} />
      </label>
    );
  };

  return (
    <>
      <section className="grid2">
        <div className="card">
          <h3>Strategy Variables (Single Run)</h3>
          {strategyDefinition?.params?.length ? (
            <div className="optimizer-row">
              {strategyDefinition.params.map((param) => renderParamInput(param))}
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
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>Simulated Trades ({tradesForDisplay.length || 0})</h3>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              {runResult?.trades?.length ? (
                <button type="button" className="toolbar" style={{ padding: "6px 10px" }} onClick={exportTradesCsv}>
                  Export all trades (CSV + scanner)
                </button>
              ) : null}
              {runResult?.trades?.length ? (
                <button
                  type="button"
                  className="toolbar"
                  style={{ padding: "6px 10px" }}
                  onClick={exportTradesWithOneMinuteCandlesJson}
                >
                  Export full session JSON (scanner + 1m for 11h after open)
                </button>
              ) : null}
              {runResult?.trades?.length ? (
                <button
                  type="button"
                  className="toolbar"
                  style={{ padding: "6px 10px" }}
                  onClick={exportTradesWithOneMinuteCandlesCsv}
                >
                  Export session + 1m candles (drilldown window)
                </button>
              ) : null}
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "0.9rem", whiteSpace: "nowrap" }}>
                <input
                  type="checkbox"
                  checked={capTradesTwoPerDay}
                  onChange={(e) => onCapTradesTwoPerDayChange(Boolean(e.target.checked))}
                />
                Cap 2 / day (ET)
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "0.9rem", whiteSpace: "nowrap" }}>
                <input
                  type="checkbox"
                  checked={simWinStopRetryPerDay}
                  onChange={(e) => onSimWinStopRetryPerDayChange(Boolean(e.target.checked))}
                />
                Win stops day · loss → 1 retry
              </label>
            </div>
          </div>
          {(capTradesTwoPerDay || simWinStopRetryPerDay) && fullTradeCount > tradesForDisplay.length ? (
            <div className="sub" style={{ marginTop: 6 }}>
              Showing {tradesForDisplay.length} of {fullTradeCount}
              {capTradesTwoPerDay ? " · max 2 opens per ET day" : ""}
              {simWinStopRetryPerDay ? " · if first open of day wins (PnL > 0), no second; otherwise allow one more." : ""}
              {" "}
              · CSV export uses the full run ({fullTradeCount} trades).
            </div>
          ) : null}
          {tradesForDisplay.length ? (
            <table>
              <thead>
                <tr>
                  <th>Day (ET)</th>
                  <th>Opened (ET)</th>
                  <th>Closed (ET)</th>
                  <th>Side</th>
                  <th>Entry</th>
                  <th>Exit</th>
                  <th>SL</th>
                  <th>TP</th>
                  <th>W/L</th>
                  <th>PnL (R)</th>
                  <th title={`Scanner at entry (${scannerFeatureSet})`}>RVOL in</th>
                  <th title={`Scanner at entry (${scannerFeatureSet})`}>BTC ρ in</th>
                  <th title={`Scanner at exit (${scannerFeatureSet})`}>RVOL out</th>
                </tr>
              </thead>
              <tbody>
                {tradesForDisplay.map((trade, idx) => {
                  const en = pickNestedScannerPayload(trade.scannerAtEntry, scannerFeatureSet);
                  const ex = pickNestedScannerPayload(trade.scannerAtExit, scannerFeatureSet);
                  const fmt = (v: unknown) =>
                    typeof v === "number" && Number.isFinite(v) ? v.toFixed(3) : "--";
                  return (
                  <tr
                    key={`${trade.openedAtMs}-${trade.closedAtMs}-${idx}`}
                    className="trade-row"
                    onClick={() => onTradeClick(idx)}
                    title="Click to open trade chart"
                  >
                    <td>{trade.tradingDayEt || "--"}</td>
                    <td>{formatDateTime(trade.openedAtMs)}</td>
                    <td>{formatDateTime(trade.closedAtMs)}</td>
                    <td>{String(trade.side || "").toUpperCase()}</td>
                    <td>{Number(trade.entryPx || 0).toFixed(4)}</td>
                    <td>{Number(trade.exitPx || 0).toFixed(4)}</td>
                    <td>{trade.stopLoss == null ? "--" : Number(trade.stopLoss).toFixed(4)}</td>
                    <td>{trade.takeProfit == null ? "--" : Number(trade.takeProfit).toFixed(4)}</td>
                    <td>{tradeOutcomeFromPnl(Number(trade.pnl))}</td>
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
                    <td>{fmt(en?.rvol)}</td>
                    <td>{fmt(en?.btcCorr)}</td>
                    <td>{fmt(ex?.rvol)}</td>
                  </tr>
                  );
                })}
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
              <div className="sub">
                Trades: {useDisplayAdjustedMetrics ? displayMetricsCap.tradeCount : runResult.metrics.tradeCount}
              </div>
              <div className="sub">
                Win rate:{" "}
                {((useDisplayAdjustedMetrics ? displayMetricsCap.winRate : runResult.metrics.winRate) * 100).toFixed(2)}%
              </div>
              <div className="sub">PnL (R): {runTotalR(tradesForDisplay).toFixed(3)}R</div>
              <div className="sub">
                Max drawdown:{" "}
                {(useDisplayAdjustedMetrics ? displayMetricsCap.maxDrawdown : runResult.metrics.maxDrawdown).toFixed(4)}
              </div>
              <div className="sub">Real tick events: {runResult.meta.eventStats.realTickEvents}</div>
              <div className="sub">Synthetic tick events: {runResult.meta.eventStats.syntheticTickEvents}</div>
              <div className="sub">Candle events: {runResult.meta.eventStats.candleEvents}</div>
              {(runResult.meta.strategyId === "orb-avwap-930" ||
                runResult.meta.strategyId === "orb-avwap-930-open-avwap-sl") && (
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
                  {runResult.meta.strategyId === "orb-avwap-930" && (
                    <div className="sub">
                      Doji body/range max:{" "}
                      {Number(
                        runResult.meta.params?.dojiBodyToRangeMax ?? optimizerSettings.dojiBodyToRangeMax
                      ).toFixed(3)}
                    </div>
                  )}
                  {runResult.meta.strategyId === "orb-avwap-930-open-avwap-sl" && (
                    <div className="sub">
                      Stop loss source:{" "}
                      {String(runResult.meta.params?.stopLossSource || optimizerSettings.stopLossSource)}
                    </div>
                  )}
                  <div className="sub">
                    Ignore weekends:{" "}
                    {Boolean(runResult.meta.params?.ignoreWeekends ?? optimizerSettings.ignoreWeekends) ? "yes" : "no"}
                  </div>
                  <div className="sub">
                    Ignore US holidays + early close days:{" "}
                    {Boolean(runResult.meta.params?.ignoreUsHolidays ?? optimizerSettings.ignoreUsHolidays) ? "yes" : "no"}
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
