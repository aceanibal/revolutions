import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { CandleChart } from "./components/CandleChart";
import { OhlcvRsiChart } from "./components/OhlcvRsiChart";
import { fetchCandles, fetchRuns, loadRun } from "./lib/api";
import { calculateRsi, toIsoDay } from "./lib/indicators";
import { aggregate5mTo1h } from "./lib/candleAggregate";
import { buildTradeLevels } from "./lib/tradeLevels";
import type { Candle, ChartMarker, RunListItem, RunUploadData, TradeRow } from "./types";

function classNames(...parts: Array<string | boolean | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function toMs(iso: string): number {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : 0;
}

function formatSide(side: number) {
  return side >= 0 ? "LONG" : "SHORT";
}

function formatTpTag(tpTag: string) {
  return tpTag.replace("tp", "TP ").replace("p", ".");
}

function formatFixed(value: unknown, digits: number): string {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

/** Stop / entry prices from CSV (variable decimals). */
function formatTradePrice(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return n.toFixed(digits);
}

function sortTradesByEntryDesc(trades: TradeRow[]): TradeRow[] {
  return [...trades].sort((a, b) => toMs(b.entry_ts_utc) - toMs(a.entry_ts_utc));
}

/** Signed R from managed outcome (CSV `managed_r`). */
function tradeOutcomeLabel(trade: TradeRow): { text: string; tone: "win" | "loss" | "flat" } {
  const r = typeof trade.managed_r === "number" ? trade.managed_r : Number(trade.managed_r);
  if (!Number.isFinite(r)) return { text: "—", tone: "flat" };
  if (r > 0) return { text: "Win", tone: "win" };
  if (r < 0) return { text: "Loss", tone: "loss" };
  return { text: "BE", tone: "flat" };
}

export function SequencerStudyPanel() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const verticalDragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const [leftPanelWidth, setLeftPanelWidth] = useState(320);
  const [chartHeight, setChartHeight] = useState(320);

  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [dbExists, setDbExists] = useState(false);

  const [runData, setRunData] = useState<RunUploadData | null>(null);
  const [selectedTpTag, setSelectedTpTag] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [selectedTradeIndex, setSelectedTradeIndex] = useState(0);

  const [overviewCandles4h, setOverviewCandles4h] = useState<Candle[]>([]);
  const [rsiSeries, setRsiSeries] = useState<Array<{ timeMs: number; value: number }>>([]);
  const [detailCandles5m, setDetailCandles5m] = useState<Candle[]>([]);
  /** Detail pane: still loads 5m from API; 1h is derived in the browser. */
  const [detailChartTf, setDetailChartTf] = useState<"5m" | "1h">("5m");

  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");

  const tpTags = useMemo(() => {
    if (!runData) return [];
    return Object.keys(runData.tpTrades).sort((a, b) => {
      const ax = Number(a.replace("tp", "").replace("p", "."));
      const bx = Number(b.replace("tp", "").replace("p", "."));
      return ax - bx;
    });
  }, [runData]);

  /** All symbols appearing in any TP file; order from run_config.symbols when set. */
  const symbols = useMemo(() => {
    if (!runData) return [];
    const fromTrades = new Set<string>();
    for (const rows of Object.values(runData.tpTrades)) {
      for (const t of rows) {
        if (t.symbol) fromTrades.add(String(t.symbol).toUpperCase());
      }
    }
    const cfg = runData.runConfig?.symbols;
    if (Array.isArray(cfg) && cfg.length) {
      const ordered = cfg.map((s) => String(s).toUpperCase()).filter((s) => fromTrades.has(s));
      if (ordered.length) return ordered;
    }
    return Array.from(fromTrades).sort();
  }, [runData]);

  /** TP scenarios that have at least one row for the selected asset (for multi-asset runs). */
  const tpTagsForAsset = useMemo(() => {
    if (!runData || !selectedSymbol) return tpTags;
    const sym = selectedSymbol.toUpperCase();
    return tpTags.filter((tag) => {
      const rows = runData.tpTrades[tag] ?? [];
      return rows.some((t) => String(t.symbol).toUpperCase() === sym);
    });
  }, [runData, tpTags, selectedSymbol]);

  const scenarioChoices = useMemo(
    () => (tpTagsForAsset.length > 0 ? tpTagsForAsset : tpTags),
    [tpTagsForAsset, tpTags]
  );

  const currentTrades = useMemo(() => {
    if (!runData || !selectedTpTag) return [];
    const list = runData.tpTrades[selectedTpTag] ?? [];
    const filtered = selectedSymbol ? list.filter((t) => t.symbol.toUpperCase() === selectedSymbol) : list;
    return sortTradesByEntryDesc(filtered);
  }, [runData, selectedTpTag, selectedSymbol]);

  /** Keep TP selection valid when switching asset (pick first scenario that has rows for this asset). */
  useEffect(() => {
    if (!runData || !selectedSymbol || scenarioChoices.length === 0) return;
    if (!scenarioChoices.includes(selectedTpTag)) {
      setSelectedTpTag(scenarioChoices[0]);
    }
  }, [runData, selectedSymbol, selectedTpTag, scenarioChoices]);

  const selectedTrade = useMemo(() => currentTrades[selectedTradeIndex] ?? null, [currentTrades, selectedTradeIndex]);

  const detailChartCandles = useMemo(() => {
    if (detailChartTf === "1h") return aggregate5mTo1h(detailCandles5m);
    return detailCandles5m;
  }, [detailCandles5m, detailChartTf]);

  const overviewMarkers = useMemo<ChartMarker[]>(() => {
    return currentTrades.map((trade) => ({
      timeSec: Math.floor(toMs(trade.entry_ts_utc) / 1000),
      color: trade.side >= 0 ? "#16a34a" : "#dc2626",
      position: trade.side >= 0 ? "belowBar" : "aboveBar",
      shape: trade.side >= 0 ? "arrowUp" : "arrowDown",
      text: `${formatSide(trade.side)} ${trade.tp_r}R`
    }));
  }, [currentTrades]);

  const detailMarkers = useMemo<ChartMarker[]>(() => {
    if (!selectedTrade) return [];
    return [
      {
        timeSec: Math.floor(toMs(selectedTrade.entry_ts_utc) / 1000),
        color: selectedTrade.side >= 0 ? "#16a34a" : "#dc2626",
        position: selectedTrade.side >= 0 ? "belowBar" : "aboveBar",
        shape: selectedTrade.side >= 0 ? "arrowUp" : "arrowDown",
        text: "Entry"
      },
      {
        timeSec: Math.floor(toMs(selectedTrade.exit_ts_utc) / 1000),
        color: "#0f172a",
        position: selectedTrade.side >= 0 ? "aboveBar" : "belowBar",
        shape: "circle",
        text: "Exit"
      }
    ];
  }, [selectedTrade]);

  const refreshRuns = async () => {
    setLoadingRuns(true);
    setError("");
    try {
      const payload = await fetchRuns();
      setRuns(payload.runs || []);
      setDbExists(Boolean(payload.dbExists));
      const nextId = payload.defaultRunId || payload.runs?.[0]?.id || "";
      setSelectedRunId((prev) => (prev && payload.runs?.some((r) => r.id === prev) ? prev : nextId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list runs");
    } finally {
      setLoadingRuns(false);
    }
  };

  useEffect(() => {
    void refreshRuns();
  }, []);

  useEffect(() => {
    if (!selectedRunId) return;
    let cancelled = false;
    setLoadingRun(true);
    setError("");
    loadRun(selectedRunId)
      .then((parsed) => {
        if (cancelled) return;
        setError("");
        setRunData({
          runConfig: parsed.runConfig,
          tpTrades: parsed.tpTrades,
          tradeFiles: parsed.tradeFiles,
          runFolderName: parsed.runFolderName
        });
        const tpKeys = Object.keys(parsed.tpTrades).sort((a, b) => {
          const ax = Number(a.replace("tp", "").replace("p", "."));
          const bx = Number(b.replace("tp", "").replace("p", "."));
          return ax - bx;
        });
        const symSet = new Set<string>();
        for (const rows of Object.values(parsed.tpTrades)) {
          for (const t of rows) {
            if (t.symbol) symSet.add(String(t.symbol).toUpperCase());
          }
        }
        const cfgSyms = parsed.runConfig?.symbols;
        let defaultSymbol = "";
        if (Array.isArray(cfgSyms) && cfgSyms.length) {
          defaultSymbol =
            cfgSyms.map((s) => String(s).toUpperCase()).find((s) => symSet.has(s)) ??
            Array.from(symSet).sort()[0] ??
            "";
        } else {
          defaultSymbol = Array.from(symSet).sort()[0] ?? "";
        }
        const defaultTp =
          tpKeys.find((k) =>
            (parsed.tpTrades[k] ?? []).some((t) => String(t.symbol).toUpperCase() === defaultSymbol)
          ) ??
          tpKeys[0] ??
          "";
        setSelectedSymbol(defaultSymbol);
        setSelectedTpTag(defaultTp);
        setSelectedTradeIndex(0);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load run.");
        setRunData(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingRun(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  const rsiPeriod = useMemo(() => {
    const p = Number(runData?.runConfig?.rsi_period ?? 14);
    return Number.isFinite(p) && p >= 2 ? Math.floor(p) : 14;
  }, [runData?.runConfig?.rsi_period]);

  useEffect(() => {
    if (!dbExists || !selectedSymbol || currentTrades.length === 0) {
      setOverviewCandles4h([]);
      setRsiSeries([]);
      return;
    }
    let cancelled = false;
    setLoadingOverview(true);
    const firstEntry = Math.min(...currentTrades.map((t) => toMs(t.entry_ts_utc)));
    const lastExit = Math.max(...currentTrades.map((t) => toMs(t.exit_ts_utc)));

    fetchCandles({
      symbol: selectedSymbol,
      timeframe: "4h",
      fromMs: firstEntry - 10 * 24 * 60 * 60 * 1000,
      toMs: lastExit + 10 * 24 * 60 * 60 * 1000
    })
      .then((rows) => {
        if (cancelled) return;
        setError("");
        setOverviewCandles4h(rows);
        setRsiSeries(calculateRsi(rows, rsiPeriod));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Overview candles failed.");
        setOverviewCandles4h([]);
        setRsiSeries([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingOverview(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dbExists, selectedSymbol, currentTrades, rsiPeriod]);

  useEffect(() => {
    if (!dbExists || !selectedTrade) {
      setDetailCandles5m([]);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    const entryMs = toMs(selectedTrade.entry_ts_utc);
    const exitMs = toMs(selectedTrade.exit_ts_utc);
    const buffer = 6 * 60 * 60 * 1000;

    fetchCandles({
      symbol: selectedTrade.symbol,
      timeframe: "5m",
      fromMs: Math.min(entryMs, exitMs) - buffer,
      toMs: Math.max(entryMs, exitMs) + buffer
    })
      .then((rows) => {
        if (cancelled) return;
        setError("");
        setDetailCandles5m(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Detail candles failed.");
        setDetailCandles5m([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dbExists, selectedTrade]);

  useEffect(() => {
    setSelectedTradeIndex(0);
  }, [selectedTpTag, selectedSymbol]);

  const rsiLow = Number(runData?.runConfig?.rsi_l ?? 40);
  const rsiHigh = Number(runData?.runConfig?.rsi_h ?? 65);

  const startHorizontalResize = () => {
    const onMouseMove = (event: MouseEvent) => {
      if (!rootRef.current) return;
      const rect = rootRef.current.getBoundingClientRect();
      const next = Math.max(260, Math.min(520, event.clientX - rect.left));
      setLeftPanelWidth(next);
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const startVerticalResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    verticalDragRef.current = { startY: event.clientY, startHeight: chartHeight };
    const onMouseMove = (e: MouseEvent) => {
      if (!verticalDragRef.current) return;
      const delta = e.clientY - verticalDragRef.current.startY;
      const next = Math.max(200, Math.min(560, verticalDragRef.current.startHeight + delta));
      setChartHeight(next);
    };
    const onMouseUp = () => {
      verticalDragRef.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div className="sequencer-shell">
      <header className="sequencer-toolbar">
        <div className="sequencer-toolbar-title">
          <strong>Sequencer study</strong>
          <span>RSI run review · 4h entries with synced RSI · trade detail (5m or 1h)</span>
        </div>

        <label className="sequencer-field">
          <span>Run</span>
          <select
            className="sequencer-input"
            value={selectedRunId}
            onChange={(e) => setSelectedRunId(e.target.value)}
            disabled={loadingRuns || runs.length === 0}
          >
            {runs.length === 0 ? (
              <option value="">No runs</option>
            ) : (
              runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.id} · {new Date(run.updatedAtMs).toLocaleString()}
                </option>
              ))
            )}
          </select>
        </label>

        {runData ? (
          <div className="sequencer-strategy">
            <em>Strategy:</em> RSI({rsiPeriod}) on 4h closes · entry band{" "}
            <span style={{ fontFamily: "ui-monospace, monospace" }}>
              {Number.isFinite(rsiLow) ? rsiLow : "—"}–{Number.isFinite(rsiHigh) ? rsiHigh : "—"}
            </span>
            {runData.runFolderName ? <span> · {runData.runFolderName}</span> : null}
            {loadingRun ? <span> · loading…</span> : null}
          </div>
        ) : null}

        <div className="sequencer-toolbar-spacer" />

        {dbExists ? (
          <span className="sequencer-badge sequencer-badge--ok">DB OK</span>
        ) : (
          <span className="sequencer-badge sequencer-badge--warn">DB missing</span>
        )}
        <button type="button" className="sequencer-btn" onClick={() => void refreshRuns()}>
          Refresh runs
        </button>
      </header>

      {error ? <div className="sequencer-error-banner">{error}</div> : null}

      <div
        ref={rootRef}
        className="sequencer-body"
        style={{ gridTemplateColumns: `${leftPanelWidth}px 12px minmax(0, 1fr)` }}
      >
        <aside className="sequencer-panel">
          <div className="sequencer-panel-header">
            <h2>Context</h2>
            <span className="sub">Asset → TP scenario → trades (same run)</span>
          </div>

          <div className="sequencer-panel-section">
            <div className="sequencer-group-title">1 · Asset</div>
            {!runData || symbols.length === 0 ? (
              <div className="sequencer-muted-box">{loadingRun ? "Loading run…" : "Select a run with trades."}</div>
            ) : (
              <div className="sequencer-asset-row">
                {symbols.map((sym) => (
                  <button
                    key={sym}
                    type="button"
                    className={classNames("sequencer-asset-btn", selectedSymbol === sym && "is-active")}
                    onClick={() => setSelectedSymbol(sym)}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="sequencer-panel-section">
            <div className="sequencer-group-title">2 · Scenario (TP sweep)</div>
            {!runData || scenarioChoices.length === 0 ? (
              <div className="sequencer-muted-box">{loadingRun ? "Loading…" : "No TP sweep files in this run."}</div>
            ) : (
              <div className="sequencer-tp-group" role="group" aria-label="TP scenario">
                {scenarioChoices.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={classNames("sequencer-tp-btn", selectedTpTag === tag && "is-active")}
                    onClick={() => setSelectedTpTag(tag)}
                  >
                    {formatTpTag(tag)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="sequencer-panel-section sequencer-panel-section--grow">
            <div className="sequencer-group-title" style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span>3 · Trades</span>
              {selectedSymbol ? (
                <span style={{ fontWeight: 500, textTransform: "none", color: "#475569" }}>{selectedSymbol}</span>
              ) : null}
              {selectedTpTag ? (
                <span style={{ fontWeight: 500, textTransform: "none", color: "#6366f1" }}>
                  · {formatTpTag(selectedTpTag)}
                </span>
              ) : null}
              <span className="sequencer-hint">{currentTrades.length} rows · click row for detail chart</span>
            </div>
            {currentTrades.length === 0 ? (
              <div className="sequencer-muted-box">No trades for this TP / asset.</div>
            ) : (
              <div className="sequencer-table-wrap">
                <table className="sequencer-table">
                  <thead>
                    <tr>
                      <th>Side</th>
                      <th>Entry (UTC)</th>
                      <th style={{ textAlign: "right" }} title="Entry price">
                        Entry
                      </th>
                      <th style={{ textAlign: "right" }} title="Initial stop (stop_init)">
                        SL
                      </th>
                      <th title="From managed R (managed_r)">W/L</th>
                      <th style={{ textAlign: "right" }}>R</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentTrades.map((trade, idx) => {
                      const outcome = tradeOutcomeLabel(trade);
                      return (
                      <tr
                        key={`${trade.symbol}-${trade.entry_ts_utc}-${idx}`}
                        onClick={() => setSelectedTradeIndex(idx)}
                        className={classNames(selectedTradeIndex === idx && "is-selected")}
                      >
                        <td className={trade.side >= 0 ? "sequencer-side-long" : "sequencer-side-short"}>
                          {formatSide(trade.side)}
                        </td>
                        <td style={{ color: "#475569" }}>{toIsoDay(toMs(trade.entry_ts_utc))}</td>
                        <td
                          style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#334155" }}
                          title={formatTradePrice(trade.entry_price)}
                        >
                          {formatTradePrice(trade.entry_price)}
                        </td>
                        <td
                          style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#334155" }}
                          title={formatTradePrice(trade.stop_init)}
                        >
                          {formatTradePrice(trade.stop_init)}
                        </td>
                        <td
                          className={classNames(
                            "sequencer-outcome",
                            outcome.tone === "win" && "sequencer-outcome--win",
                            outcome.tone === "loss" && "sequencer-outcome--loss",
                            outcome.tone === "flat" && "sequencer-outcome--flat"
                          )}
                          title={`managed_r ${formatFixed(trade.managed_r, 4)}`}
                        >
                          {outcome.text}
                        </td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {formatFixed(trade.managed_r, 2)}
                        </td>
                        <td style={{ color: "#475569", maxWidth: 120 }} title={String(trade.managed_reason)}>
                          <span
                            style={{
                              display: "block",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap"
                            }}
                          >
                            {String(trade.managed_reason)}
                          </span>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </aside>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize side panel"
          className="sequencer-resize-h"
          onMouseDown={startHorizontalResize}
        />

        <main className="sequencer-main">
          <div className="sequencer-workspace-header">
            <h2>Charts</h2>
            <p>
              4h candlestick and volume with RSI on a shared time scale; trade detail loads 5m from the DB — use the
              toggle to aggregate to 1h in the browser.
            </p>
          </div>

          <div className="sequencer-card sequencer-chart-card" style={{ height: chartHeight }}>
            <h3>
              4h overview · OHLCV + RSI({rsiPeriod})
              {loadingOverview ? (
                <span style={{ marginLeft: 8, fontWeight: 400, color: "#6366f1" }}>Loading…</span>
              ) : null}
            </h3>
            <div className="sequencer-card-body">
              {loadingOverview ? (
                <div className="sequencer-empty">Loading 4h candles…</div>
              ) : selectedSymbol && runData && overviewCandles4h.length > 0 ? (
                <OhlcvRsiChart
                  key={rsiPeriod}
                  candles={overviewCandles4h}
                  markers={overviewMarkers}
                  rsi={{
                    period: rsiPeriod,
                    data: rsiSeries,
                    lower: Number.isFinite(rsiLow) ? rsiLow : 40,
                    upper: Number.isFinite(rsiHigh) ? rsiHigh : 65
                  }}
                  fitKey={`${selectedTpTag}-${selectedSymbol}-${overviewCandles4h.length}-${rsiSeries.length}`}
                />
              ) : (
                <div className="sequencer-empty">Load a run, pick an asset, and wait for 4h data from the API.</div>
              )}
            </div>
          </div>

          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize 4h chart height"
            className="sequencer-resize-v"
            onMouseDown={startVerticalResize}
          />

          <div className="sequencer-card sequencer-chart-card--flex">
            <h3 className="sequencer-detail-chart-heading">
              <span>
                Trade detail · {detailChartTf === "1h" ? "1h (from 5m)" : "5m"}
                {loadingDetail ? (
                  <span style={{ marginLeft: 8, fontWeight: 400, color: "#6366f1" }}>Loading…</span>
                ) : null}
              </span>
              <span className="sequencer-tf-toggle" role="group" aria-label="Detail chart timeframe">
                <button
                  type="button"
                  className={classNames("sequencer-tf-btn", detailChartTf === "5m" && "is-active")}
                  aria-pressed={detailChartTf === "5m"}
                  onClick={() => setDetailChartTf("5m")}
                  disabled={!selectedTrade || detailCandles5m.length === 0}
                >
                  5m
                </button>
                <button
                  type="button"
                  className={classNames("sequencer-tf-btn", detailChartTf === "1h" && "is-active")}
                  aria-pressed={detailChartTf === "1h"}
                  onClick={() => setDetailChartTf("1h")}
                  disabled={!selectedTrade || detailCandles5m.length === 0}
                >
                  1h
                </button>
              </span>
            </h3>
            <div className="sequencer-card-body">
              {selectedTrade ? (
                <CandleChart
                  candles={detailChartCandles}
                  markers={detailMarkers}
                  levels={buildTradeLevels(selectedTrade)}
                  fitKey={`${selectedTrade.entry_ts_utc}-${detailCandles5m.length}-${detailChartTf}`}
                />
              ) : (
                <div className="sequencer-empty">
                  Select a trade in the left list to show SL, MFE, locks, and TP.
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
