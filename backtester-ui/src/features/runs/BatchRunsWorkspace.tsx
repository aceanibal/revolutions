import type { BatchRunRow } from "../../types";

interface BatchSummary {
  runs: number;
  ok: number;
  errorCount: number;
  totalR: number;
  totalTrades: number;
  weightedWinRate: number;
  avgRPerRun: number;
  avgRPerTrade: number;
  positiveRuns: number;
  negativeRuns: number;
  flatRuns: number;
  bestRun: BatchRunRow | null;
  worstRun: BatchRunRow | null;
}

interface AssetBreakdownRow {
  symbol: string;
  runs: number;
  trades: number;
  totalR: number;
  avgRPerRun: number;
  avgRPerTrade: number;
  weightedWinRate: number;
}

interface SelectedAssetComboStats {
  assetCount: number;
  runs: number;
  totalTrades: number;
  totalR: number;
  avgRPerRun: number;
  avgRPerTrade: number;
  weightedWinRate: number;
}

interface BatchRunsWorkspaceProps {
  backtestDateFilter: string;
  batchProgress: { done: number; total: number; current: string };
  batchSummary: BatchSummary | null;
  batchResults: BatchRunRow[];
  batchAssetBreakdown: AssetBreakdownRow[];
  filteredAssetBreakdown: AssetBreakdownRow[];
  selectedAssetComboStats: SelectedAssetComboStats;
  selectedAssetSymbols: string[];
  assetSearch: string;
  assetMinRuns: number;
  assetTopN: number;
  onAssetSearchChange: (value: string) => void;
  onAssetMinRunsChange: (value: number) => void;
  onAssetTopNChange: (value: number) => void;
  onSelectTopAssets: (count: number) => void;
  onClearAssetSelection: () => void;
  onToggleAssetSelection: (symbol: string) => void;
}

export function BatchRunsWorkspace({
  backtestDateFilter,
  batchProgress,
  batchSummary,
  batchResults,
  batchAssetBreakdown,
  filteredAssetBreakdown,
  selectedAssetComboStats,
  selectedAssetSymbols,
  assetSearch,
  assetMinRuns,
  assetTopN,
  onAssetSearchChange,
  onAssetMinRunsChange,
  onAssetTopNChange,
  onSelectTopAssets,
  onClearAssetSelection,
  onToggleAssetSelection
}: BatchRunsWorkspaceProps) {
  return (
    <>
      <section className="grid2">
        <div className="card table-card">
          <h3>Batch Runner</h3>
          <div className="sub">
            Scope: sessions filtered by date ({backtestDateFilter || "all dates"}) x all symbols per session
          </div>
          <div className="sub">
            Progress: {batchProgress.done}/{batchProgress.total}{" "}
            {batchProgress.current ? `· ${batchProgress.current}` : ""}
          </div>
          {batchSummary ? (
            <>
              <div className="sub">
                Runs: {batchSummary.runs} · ok: {batchSummary.ok} · errors: {batchSummary.errorCount}
              </div>
              <div className="sub">
                Total trades: {batchSummary.totalTrades} · Total R: {batchSummary.totalR.toFixed(3)}R
              </div>
              <div className="sub">
                Avg R/run: {batchSummary.avgRPerRun.toFixed(3)}R · Avg R/trade:{" "}
                {batchSummary.avgRPerTrade.toFixed(3)}R
              </div>
              <div className="sub">
                Weighted win rate: {(batchSummary.weightedWinRate * 100).toFixed(2)}% · +runs:{" "}
                {batchSummary.positiveRuns} · -runs: {batchSummary.negativeRuns} · flat: {batchSummary.flatRuns}
              </div>
              <div className="sub">
                Best:{" "}
                {batchSummary.bestRun
                  ? `${batchSummary.bestRun.sessionId} ${batchSummary.bestRun.symbol} (${batchSummary.bestRun.pnlR.toFixed(3)}R)`
                  : "--"}
              </div>
              <div className="sub">
                Worst:{" "}
                {batchSummary.worstRun
                  ? `${batchSummary.worstRun.sessionId} ${batchSummary.worstRun.symbol} (${batchSummary.worstRun.pnlR.toFixed(3)}R)`
                  : "--"}
              </div>
            </>
          ) : (
            <div className="sub">No batch runs yet.</div>
          )}
          {batchResults.length > 0 && (
            <table style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Symbol</th>
                  <th>Status</th>
                  <th>Trades</th>
                  <th>Win %</th>
                  <th>PnL (R)</th>
                </tr>
              </thead>
              <tbody>
                {batchResults.slice(-100).map((row, idx) => (
                  <tr key={`${row.sessionId}-${row.symbol}-${idx}`}>
                    <td>{row.sessionId}</td>
                    <td>{row.symbol}</td>
                    <td>{row.status === "ok" ? "ok" : row.error || "error"}</td>
                    <td>{row.trades}</td>
                    <td>{(row.winRate * 100).toFixed(2)}%</td>
                    <td>{row.pnlR.toFixed(3)}R</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h3>Batch Notes</h3>
          <div className="sub">Batch uses current controls: timeframe, replay mode, tick policy, strategy.</div>
          <div className="sub">For `orb-avwap-930`, current optimizer TP RR value is applied to every run.</div>
          <div className="sub">Runs execute sequentially to avoid overloading the API server.</div>
        </div>
      </section>

      <section className="grid2">
        <div className="card table-card">
          <h3>Asset Breakdown</h3>
          <div className="sub">
            Total assets: {batchAssetBreakdown.length} · Showing: {filteredAssetBreakdown.length}
          </div>
          <div className="filter-row" style={{ borderBottom: "none", padding: "8px 0" }}>
            <input
              type="text"
              placeholder="Search asset (e.g. XRP)"
              value={assetSearch}
              onChange={(e) => onAssetSearchChange(e.target.value)}
            />
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Min runs
              <input
                type="number"
                min={1}
                step={1}
                value={assetMinRuns}
                onChange={(e) => onAssetMinRunsChange(Math.max(1, Number(e.target.value || 1)))}
                style={{ width: 70 }}
              />
            </label>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Top N
              <input
                type="number"
                min={1}
                step={1}
                value={assetTopN}
                onChange={(e) => onAssetTopNChange(Math.max(1, Number(e.target.value || 3)))}
                style={{ width: 70 }}
              />
            </label>
            <button type="button" onClick={() => onSelectTopAssets(assetTopN)}>
              Select Top N
            </button>
            <button type="button" onClick={onClearAssetSelection}>
              Clear Selection
            </button>
          </div>
          {batchAssetBreakdown.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Asset</th>
                  <th>Runs</th>
                  <th>Trades</th>
                  <th>Total R</th>
                  <th>Avg R/Run</th>
                  <th>Avg R/Trade</th>
                  <th>Win %</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssetBreakdown.map((row) => (
                  <tr key={row.symbol}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedAssetSymbols.includes(row.symbol)}
                        onChange={() => onToggleAssetSelection(row.symbol)}
                      />
                    </td>
                    <td>{row.symbol}</td>
                    <td>{row.runs}</td>
                    <td>{row.trades}</td>
                    <td>{row.totalR.toFixed(3)}R</td>
                    <td>{row.avgRPerRun.toFixed(3)}R</td>
                    <td>{row.avgRPerTrade.toFixed(3)}R</td>
                    <td>{(row.weightedWinRate * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="sub">Run a batch to view asset-level performance.</div>
          )}
        </div>
        <div className="card">
          <h3>Asset Combination Summary</h3>
          <div className="sub">Selected assets: {selectedAssetComboStats.assetCount}</div>
          <div className="sub">Runs: {selectedAssetComboStats.runs}</div>
          <div className="sub">Total trades: {selectedAssetComboStats.totalTrades}</div>
          <div className="sub">Total R: {selectedAssetComboStats.totalR.toFixed(3)}R</div>
          <div className="sub">Avg R/run: {selectedAssetComboStats.avgRPerRun.toFixed(3)}R</div>
          <div className="sub">Avg R/trade: {selectedAssetComboStats.avgRPerTrade.toFixed(3)}R</div>
          <div className="sub">
            Weighted win rate: {(selectedAssetComboStats.weightedWinRate * 100).toFixed(2)}%
          </div>
        </div>
      </section>
    </>
  );
}
