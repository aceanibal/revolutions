import { formatDateTime } from "../../lib/backtestMath";
import type { ScannerFeatureRow, ScannerRunResult, Timeframe } from "../../types";

interface ScannerWorkspaceProps {
  selectedSessionId: string;
  scannerTimeframe: Timeframe;
  scannerAnchorInput: string;
  scannerResolvedAnchorTsMs: number;
  scannerLookbackHours: number;
  scannerCurrentWindowHours: number;
  scannerBtcSymbol: string;
  scannerFeatureSet: string;
  scannerFeatureVersion: string;
  scannerScanFullSession: boolean;
  scannerUseForRuns: boolean;
  scannerRunning: boolean;
  scannerRows: ScannerFeatureRow[];
  scannerLastRun: ScannerRunResult | null;
  onScannerTimeframeChange: (value: Timeframe) => void;
  onScannerAnchorInputChange: (value: string) => void;
  onScannerLookbackHoursChange: (value: number) => void;
  onScannerCurrentWindowHoursChange: (value: number) => void;
  onScannerBtcSymbolChange: (value: string) => void;
  onScannerFeatureSetChange: (value: string) => void;
  onScannerFeatureVersionChange: (value: string) => void;
  onScannerScanFullSessionChange: (value: boolean) => void;
  onScannerUseForRunsChange: (value: boolean) => void;
  onRunScanner: () => Promise<void>;
  onRefreshScannerRows: () => Promise<void>;
  selectedSymbol: string;
  onRunLiquidityZoneScanner: () => Promise<void>;
  onExportLiquidityZones: () => Promise<void>;
}

function formatNumber(value: unknown, digits = 3): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return n.toFixed(digits);
}

export function ScannerWorkspace(props: ScannerWorkspaceProps) {
  return (
    <>
      <section className="grid2">
        <div className="card">
          <h3>Scanner Controls</h3>
          <div className="optimizer-row">
            <label>
              Timeframe
              <select
                value={props.scannerTimeframe}
                onChange={(e) => props.onScannerTimeframeChange(e.target.value as Timeframe)}
              >
                <option value="1m">1m</option>
                <option value="5m">5m</option>
              </select>
            </label>
            <label>
              Anchor Time (ET/New_York)
              <input
                type="time"
                step={60}
                value={props.scannerAnchorInput}
                onChange={(e) => props.onScannerAnchorInputChange(e.target.value)}
              />
            </label>
            <label>
              Lookback hours
              <input
                type="number"
                min={1}
                step={1}
                value={props.scannerLookbackHours}
                onChange={(e) => props.onScannerLookbackHoursChange(Math.max(1, Number(e.target.value || 120)))}
              />
            </label>
            <label>
              Window hours
              <input
                type="number"
                min={1}
                step={1}
                value={props.scannerCurrentWindowHours}
                onChange={(e) =>
                  props.onScannerCurrentWindowHoursChange(Math.max(1, Number(e.target.value || 12)))
                }
              />
            </label>
            <label>
              BTC symbol
              <input
                type="text"
                value={props.scannerBtcSymbol}
                onChange={(e) => props.onScannerBtcSymbolChange(String(e.target.value || "").toUpperCase())}
              />
            </label>
            <label>
              Feature set
              <input
                type="text"
                value={props.scannerFeatureSet}
                onChange={(e) => props.onScannerFeatureSetChange(e.target.value)}
              />
            </label>
            <label>
              Version
              <input
                type="text"
                value={props.scannerFeatureVersion}
                onChange={(e) => props.onScannerFeatureVersionChange(e.target.value)}
              />
            </label>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={props.scannerScanFullSession}
                onChange={(e) => props.onScannerScanFullSessionChange(Boolean(e.target.checked))}
              />
              Scan full session (every bar — marks each candle; longer run)
            </label>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={props.scannerUseForRuns}
                onChange={(e) => props.onScannerUseForRunsChange(Boolean(e.target.checked))}
              />
              Attach scanner feature to backtest runs
            </label>
          </div>
          <div className="filter-row" style={{ borderBottom: "none", padding: "8px 0 0" }}>
            <button
              type="button"
              onClick={() => void props.onRunScanner()}
              disabled={props.scannerRunning || !props.selectedSessionId}
            >
              {props.scannerRunning ? "Running scanner..." : "Run scanner on session"}
            </button>
            <button type="button" onClick={() => void props.onRefreshScannerRows()} disabled={!props.selectedSessionId}>
              Refresh features
            </button>
          </div>
          <div className="sub">
            Variables: `anchorTsMs`, `lookbackHours`, `currentWindowHours`, `btcSymbol`, `featureSet`, `featureVersion`.
          </div>
          <div className="sub">
            Resolved anchor candle (ET, single mode): {formatDateTime(props.scannerResolvedAnchorTsMs)}
          </div>
          {props.scannerScanFullSession ? (
            <div className="sub">
              Full-session mode uses the longest symbol series as the timeline and writes one feature row per
              symbol per bar (after enough lookback exists). The table shows up to 8000 rows.
            </div>
          ) : null}
          <div className="sub">
            Output fields per asset: `rvol`, `currentWindowVolumeUsd`, `baselineVolumeUsd`, `btcCorr`, `price`.
          </div>
          <div className="sub">
            Each run also stores the same metrics on the other timeframe: 1m anchors map to the containing 5m bar
            (using the session&apos;s 5m series); 5m anchors map to the 1m bar at that open time. Mirrored rows set
            `payload.computedOnTimeframe` to the timeframe used for the math.
          </div>
        </div>
        <div className="card">
          <h3>Scanner Run Summary</h3>
          {props.scannerLastRun ? (
            <>
              <div className="sub">Session: {props.scannerLastRun.sessionId}</div>
              <div className="sub">
                Mode: {props.scannerLastRun.scanMode === "session_bars" ? "session bars" : "single anchor"}
                {props.scannerLastRun.scanMode === "session_bars" && props.scannerLastRun.anchorCount != null
                  ? ` · anchors processed: ${props.scannerLastRun.anchorCount}`
                  : ""}
              </div>
              <div className="sub">
                Last anchor (ET): {formatDateTime(props.scannerLastRun.anchorTsMs)}
              </div>
              {props.scannerLastRun.anchorClamped &&
              Number.isFinite(props.scannerLastRun.anchorRequestedTsMs) &&
              props.scannerLastRun.anchorRequestedTsMs != null &&
              props.scannerLastRun.anchorRequestedTsMs > 0 ? (
                <div className="sub">
                  Anchor shifted forward from {formatDateTime(props.scannerLastRun.anchorRequestedTsMs)} so the
                  session has enough bars before the anchor for lookback and RVOL baseline.
                </div>
              ) : null}
              <div className="sub">
                Timeframe: {props.scannerLastRun.timeframe} · lookback: {props.scannerLastRun.lookbackHours}h ·
                window: {props.scannerLastRun.currentWindowHours}h
              </div>
              <div className="sub">
                Bars/hour: {props.scannerLastRun.barsPerHour} · lookback bars: {props.scannerLastRun.lookbackBars} ·
                window bars: {props.scannerLastRun.windowBars}
              </div>
              <div className="sub">
                Symbols: {props.scannerLastRun.symbolCount} · computed: {props.scannerLastRun.computedCount} ·
                persisted: {props.scannerLastRun.upserted}
              </div>
              <div className="sub">BTC reference: {props.scannerLastRun.btcSymbol || "--"}</div>
            </>
          ) : (
            <div className="empty">Run scanner to generate per-asset features.</div>
          )}
        </div>
      </section>
      <section className="grid2">
        <div className="card">
          <h3>Liquidity Zone Scanner</h3>
          <div className="sub">
            Computes daily highs/lows, volume profile (high-volume nodes), and swing pivots from a
            trailing week of 5m candles. Anchors at 5 PM ET each day.
          </div>
          <div className="filter-row" style={{ borderBottom: "none", padding: "8px 0 0", gap: 8 }}>
            <button
              type="button"
              onClick={() => void props.onRunLiquidityZoneScanner()}
              disabled={props.scannerRunning || !props.selectedSessionId}
            >
              {props.scannerRunning ? "Running..." : "Run liquidity zone scanner"}
            </button>
            <button
              type="button"
              onClick={() => void props.onExportLiquidityZones()}
              disabled={!props.selectedSessionId || !props.selectedSymbol}
            >
              Export zones + overnight 1m (JSON)
            </button>
          </div>
          <div className="sub">
            Export pairs each 5 PM snapshot with 1m candles from 5 PM → 8 AM ET
            for the selected symbol ({props.selectedSymbol || "none"}).
          </div>
        </div>
      </section>
      <section className="grid2">
        <div className="card table-card" style={{ gridColumn: "1 / -1" }}>
          <h3>Per-Asset Scanner Features ({props.scannerRows.length})</h3>
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Anchor</th>
                <th>RVOL</th>
                <th>Current Vol ($)</th>
                <th>Baseline Vol ($)</th>
                <th>BTC Corr</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {props.scannerRows.map((row) => (
                <tr key={`${row.symbol}-${row.bucketStartMs}-${row.featureSet}-${row.featureVersion}`}>
                  <td>{row.symbol}</td>
                  <td>{formatDateTime(row.bucketStartMs)}</td>
                  <td>{formatNumber(row.payload?.rvol, 3)}</td>
                  <td>{formatNumber(row.payload?.currentWindowVolumeUsd, 0)}</td>
                  <td>{formatNumber(row.payload?.baselineVolumeUsd, 0)}</td>
                  <td>{formatNumber(row.payload?.btcCorr, 3)}</td>
                  <td>{formatNumber(row.payload?.price, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
