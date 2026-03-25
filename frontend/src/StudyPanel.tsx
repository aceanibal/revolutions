import { useEffect, useMemo, useRef, useState } from "react";
import { Chart } from "./Chart";
import type { Candle, GapRange, SavedSession, SessionTrade, Timeframe } from "./types";
import {
  fetchAllSessions,
  fetchSessionNotes,
  fetchSessionSnapshotById,
  fetchSessionSymbols,
  fetchSessionTrades,
  saveSessionNotes
} from "./lib/api";
import { getTodayEasternTimeAnchorSec } from "./lib/easternTime";

type SaveState = "idle" | "saving" | "saved" | "error";

function formatDateTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "--";
  return new Date(ms).toLocaleString();
}

function formatDuration(startedAtMs: number, endedAtMs: number | null): string {
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) return "--";
  const endMs = Number.isFinite(endedAtMs || 0) && (endedAtMs || 0) > 0 ? Number(endedAtMs) : Date.now();
  const diffSec = Math.max(0, Math.floor((endMs - startedAtMs) / 1000));
  const hours = Math.floor(diffSec / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatTradeSide(dir: string, side: string): string {
  const d = String(dir || "").toUpperCase();
  if (d.includes("LONG") || d === "B") return "LONG";
  if (d.includes("SHORT") || d === "A") return "SHORT";
  const s = String(side || "").toUpperCase();
  if (s === "B") return "LONG";
  if (s === "A") return "SHORT";
  return s || "--";
}

export function StudyPanel() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [symbols, setSymbols] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [candlesByTimeframe, setCandlesByTimeframe] = useState<Record<Timeframe, Candle[]>>({
    "1m": [],
    "5m": [],
    "15m": []
  });
  const [gapsByTimeframe, setGapsByTimeframe] = useState<Record<Timeframe, GapRange[]>>({
    "1m": [],
    "5m": [],
    "15m": []
  });
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [notes, setNotes] = useState("");
  const [notesOriginal, setNotesOriginal] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [sessionTrades, setSessionTrades] = useState<SessionTrade[]>([]);
  const [tradeMode, setTradeMode] = useState<"live" | "test">("live");
  const [leftPanelWidth, setLeftPanelWidth] = useState(352);
  const [chartHeight, setChartHeight] = useState(360);
  const [studyUserLines, setStudyUserLines] = useState<number[]>([]);
  const [drawModeEnabled, setDrawModeEnabled] = useState(false);
  const [anchoredVwapEnabled, setAnchoredVwapEnabled] = useState(true);
  const [anchoredVwapTime, setAnchoredVwapTime] = useState("09:30");

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || null,
    [sessions, selectedSessionId]
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingSessions(true);
    (async () => {
      const items = await fetchAllSessions();
      if (cancelled) return;
      setSessions(items);
      if (!selectedSessionId && items.length > 0) {
        setSelectedSessionId(items[0].id);
      }
      setLoadingSessions(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      setSymbols([]);
      setSelectedSymbol("");
      setNotes("");
      setNotesOriginal("");
      setSessionTrades([]);
      return;
    }

    let cancelled = false;
    (async () => {
      const [nextSymbols, nextNotes, nextTrades] = await Promise.all([
        fetchSessionSymbols(selectedSessionId),
        fetchSessionNotes(selectedSessionId),
        fetchSessionTrades(selectedSessionId)
      ]);
      if (cancelled) return;
      setSymbols(nextSymbols);
      setSelectedSymbol((prev) => (prev && nextSymbols.includes(prev) ? prev : nextSymbols[0] || ""));
      setNotes(nextNotes);
      setNotesOriginal(nextNotes);
      setSessionTrades(nextTrades);
      setSaveState("idle");
      setSaveMessage("");
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId || !selectedSymbol) {
      setCandlesByTimeframe({ "1m": [], "5m": [], "15m": [] });
      setGapsByTimeframe({ "1m": [], "5m": [], "15m": [] });
      return;
    }
    let cancelled = false;
    setLoadingSnapshot(true);
    (async () => {
      const snapshot = await fetchSessionSnapshotById(selectedSessionId, selectedSymbol);
      if (cancelled) return;
      if (!snapshot) {
        setCandlesByTimeframe({ "1m": [], "5m": [], "15m": [] });
        setGapsByTimeframe({ "1m": [], "5m": [], "15m": [] });
      } else {
        setCandlesByTimeframe({
          "1m": snapshot.candlesByTimeframe["1m"] || [],
          "5m": snapshot.candlesByTimeframe["5m"] || [],
          "15m": snapshot.candlesByTimeframe["15m"] || []
        });
        setGapsByTimeframe({
          "1m": snapshot.gapsByTimeframe["1m"] || [],
          "5m": snapshot.gapsByTimeframe["5m"] || [],
          "15m": snapshot.gapsByTimeframe["15m"] || []
        });
      }
      setLoadingSnapshot(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSessionId, selectedSymbol]);

  useEffect(() => {
    if (!selectedSessionId) return;
    if (notes === notesOriginal) return;
    const timeoutId = window.setTimeout(() => {
      setSaveState("saving");
      setSaveMessage("Saving notes...");
      void (async () => {
        const ok = await saveSessionNotes(selectedSessionId, notes);
        if (!ok) {
          setSaveState("error");
          setSaveMessage("Failed to save notes");
          return;
        }
        setSaveState("saved");
        setSaveMessage("Notes saved");
        setNotesOriginal(notes);
        setSessions((prev) =>
          prev.map((item) => (item.id === selectedSessionId ? { ...item, notes } : item))
        );
      })();
    }, 800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [selectedSessionId, notes, notesOriginal]);

  const groupedSessions = useMemo(() => {
    const groups = new Map<string, SavedSession[]>();
    for (const session of sessions) {
      const dayKey = new Date(session.startedAtMs).toLocaleDateString();
      const list = groups.get(dayKey) || [];
      list.push(session);
      groups.set(dayKey, list);
    }
    return Array.from(groups.entries());
  }, [sessions]);

  const saveStateClass =
    saveState === "saved"
      ? "text-emerald-700"
      : saveState === "error"
        ? "text-rose-700"
        : "text-slate-500";

  const filteredTrades = useMemo(
    () => sessionTrades.filter((trade) => trade.mode === tradeMode),
    [sessionTrades, tradeMode]
  );
  const chartCandles = useMemo(() => candlesByTimeframe[timeframe] || [], [candlesByTimeframe, timeframe]);
  const anchoredVwapAnchorTimeSec = useMemo(
    () => getTodayEasternTimeAnchorSec(anchoredVwapTime),
    [anchoredVwapTime]
  );
  const handleChartClickPrice = (price: number) => {
    if (!drawModeEnabled) return;
    if (!Number.isFinite(price) || price <= 0) return;
    setStudyUserLines((prev) => [...prev, price]);
  };

  const handleClearStudyLines = () => {
    setStudyUserLines([]);
  };

  const startHorizontalResize = () => {
    const onMouseMove = (event: MouseEvent) => {
      if (!rootRef.current) return;
      const rect = rootRef.current.getBoundingClientRect();
      const next = event.clientX - rect.left;
      setLeftPanelWidth(next);
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const startVerticalResize = () => {
    const onMouseMove = (event: MouseEvent) => {
      if (!contentRef.current) return;
      const rect = contentRef.current.getBoundingClientRect();
      const next = event.clientY - rect.top;
      setChartHeight(next);
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div
      ref={rootRef}
      className="grid h-[calc(100vh-5.5rem)] gap-3"
      style={{ gridTemplateColumns: `${leftPanelWidth}px 6px minmax(0, 1fr)` }}
    >
      <aside className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-3 py-2">
          <div className="text-sm font-semibold text-slate-900">Saved Sessions</div>
          <div className="text-xs text-slate-500">
            {loadingSessions ? "Loading..." : `${sessions.length} session${sessions.length === 1 ? "" : "s"}`}
          </div>
        </div>
        <div className="h-full overflow-y-auto px-2 py-2">
          {groupedSessions.map(([day, daySessions]) => (
            <div key={day} className="mb-3">
              <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {day}
              </div>
              <div className="space-y-1">
                {daySessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setSelectedSessionId(session.id)}
                    className={`w-full rounded-lg border px-2 py-2 text-left transition ${
                      selectedSessionId === session.id
                        ? "border-indigo-300 bg-indigo-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-900">{new Date(session.startedAtMs).toLocaleTimeString()}</span>
                      <span className="text-slate-500">{formatDuration(session.startedAtMs, session.endedAtMs)}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {session.assetCount} assets · {session.candleCount} candles
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {Number(session.tradeCount || 0)} trades
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] text-slate-600">
                      {session.notes?.trim() || "No notes yet"}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!loadingSessions && sessions.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              No saved sessions found in the database.
            </div>
          )}
        </div>
      </aside>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sessions panel"
        className="group relative cursor-col-resize"
        onMouseDown={startHorizontalResize}
      >
        <div className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 rounded bg-slate-200 transition group-hover:bg-indigo-300" />
      </div>

      <section ref={contentRef} className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
          {selectedSession ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-700">
              <span className="font-semibold text-slate-900">{selectedSession.id}</span>
              <span>Start: {formatDateTime(selectedSession.startedAtMs)}</span>
              <span>Duration: {formatDuration(selectedSession.startedAtMs, selectedSession.endedAtMs)}</span>
              <span className="uppercase">{selectedSession.status}</span>
              <label className="ml-auto inline-flex items-center gap-2 rounded-full border border-slate-200 px-2.5 py-1">
                <span>Symbol</span>
                <select
                  className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs"
                  value={selectedSymbol}
                  onChange={(e) => setSelectedSymbol(e.target.value)}
                >
                  {symbols.map((symbol) => (
                    <option key={symbol} value={symbol}>
                      {symbol}
                    </option>
                  ))}
                </select>
              </label>
              <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setTimeframe("1m")}
                  className={`rounded-full px-2 py-0.5 ${timeframe === "1m" ? "bg-slate-900 text-white" : "text-slate-700"}`}
                >
                  1m
                </button>
                <button
                  type="button"
                  onClick={() => setTimeframe("5m")}
                  className={`rounded-full px-2 py-0.5 ${timeframe === "5m" ? "bg-slate-900 text-white" : "text-slate-700"}`}
                >
                  5m
                </button>
              </div>
              <button
                type="button"
                onClick={() => setDrawModeEnabled((prev) => !prev)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                  drawModeEnabled
                    ? "bg-amber-700 text-white hover:bg-amber-800"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Draw Line
              </button>
              <button
                type="button"
                onClick={handleClearStudyLines}
                disabled={studyUserLines.length === 0}
                className="rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                Clear Lines
              </button>
              <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700">
                <span>Anchored VWAP</span>
                <input
                  type="checkbox"
                  checked={anchoredVwapEnabled}
                  onChange={(e) => setAnchoredVwapEnabled(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  aria-label="Enable Anchored VWAP"
                />
                <input
                  type="time"
                  value={anchoredVwapTime}
                  disabled={!anchoredVwapEnabled}
                  onChange={(e) => setAnchoredVwapTime(e.target.value)}
                  className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Anchored VWAP time"
                />
              </label>
            </div>
          ) : (
            <div className="text-sm text-slate-600">Select a saved session to begin studying.</div>
          )}
        </div>

        <div className="shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-2" style={{ height: chartHeight }}>
          {loadingSnapshot ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading chart...</div>
          ) : selectedSymbol ? (
            <Chart
              candles={chartCandles}
              gaps={gapsByTimeframe[timeframe]}
              vwapEnabled
              anchoredVwapEnabled={anchoredVwapEnabled}
              anchoredVwapAnchorTimeSec={anchoredVwapAnchorTimeSec}
              emaEnabled
              userHorizontalLines={studyUserLines}
              onChartClickPrice={handleChartClickPrice}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              This session has no symbols to load.
            </div>
          )}
        </div>

        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize chart height"
          className="group -my-1 h-2 cursor-row-resize"
          onMouseDown={startVerticalResize}
        >
          <div className="mx-auto mt-[3px] h-[2px] w-16 rounded bg-slate-200 transition group-hover:bg-indigo-300" />
        </div>

        <div className="min-h-0 rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Session Notes</h3>
            <span className={`text-xs ${saveStateClass}`}>{saveMessage}</span>
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Write your review notes for this session..."
            className="h-28 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300"
            disabled={!selectedSessionId}
          />
        </div>

        <div className="min-h-0 rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Session Trades ({filteredTrades.length})
            </h3>
            <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 p-1 text-xs">
              <button
                type="button"
                onClick={() => setTradeMode("live")}
                className={`rounded-full px-2 py-0.5 ${
                  tradeMode === "live" ? "bg-slate-900 text-white" : "text-slate-700"
                }`}
              >
                Live
              </button>
              <button
                type="button"
                onClick={() => setTradeMode("test")}
                className={`rounded-full px-2 py-0.5 ${
                  tradeMode === "test" ? "bg-slate-900 text-white" : "text-slate-700"
                }`}
              >
                Test
              </button>
            </div>
          </div>
          {filteredTrades.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              No {tradeMode} trades recorded for this session.
            </div>
          ) : (
            <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="px-2 py-1">Time</th>
                    <th className="px-2 py-1">Coin</th>
                    <th className="px-2 py-1">Side</th>
                    <th className="px-2 py-1 text-right">Px</th>
                    <th className="px-2 py-1 text-right">Sz</th>
                    <th className="px-2 py-1 text-right">Fee</th>
                    <th className="px-2 py-1 text-right">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTrades.map((trade, idx) => (
                    <tr key={`${trade.time}-${trade.tid ?? idx}`} className="border-t border-slate-100">
                      <td className="px-2 py-1 text-slate-600">
                        {Number.isFinite(trade.time) ? new Date(trade.time).toLocaleTimeString() : "--"}
                      </td>
                      <td className="px-2 py-1 font-medium text-slate-800">{trade.coin}</td>
                      <td
                        className={`px-2 py-1 font-semibold ${
                          formatTradeSide(trade.dir, trade.side) === "LONG"
                            ? "text-emerald-700"
                            : formatTradeSide(trade.dir, trade.side) === "SHORT"
                              ? "text-rose-700"
                              : "text-slate-700"
                        }`}
                      >
                        {formatTradeSide(trade.dir, trade.side)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{trade.px.toFixed(4)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{trade.sz.toFixed(6)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                        {trade.fee.toFixed(4)}
                      </td>
                      <td
                        className={`px-2 py-1 text-right tabular-nums ${
                          trade.closedPnl >= 0 ? "text-emerald-700" : "text-rose-700"
                        }`}
                      >
                        {trade.closedPnl.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
