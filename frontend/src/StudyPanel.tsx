import { useEffect, useMemo, useState } from "react";
import { Chart } from "./Chart";
import type { Candle, GapRange, SavedSession, Timeframe } from "./types";
import {
  fetchAllSessions,
  fetchSessionNotes,
  fetchSessionSnapshotById,
  fetchSessionSymbols,
  saveSessionNotes
} from "./lib/api";

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

export function StudyPanel() {
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [symbols, setSymbols] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [candlesByTimeframe, setCandlesByTimeframe] = useState<Record<Timeframe, Candle[]>>({
    "1m": [],
    "5m": []
  });
  const [gapsByTimeframe, setGapsByTimeframe] = useState<Record<Timeframe, GapRange[]>>({
    "1m": [],
    "5m": []
  });
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [notes, setNotes] = useState("");
  const [notesOriginal, setNotesOriginal] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");

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
      return;
    }

    let cancelled = false;
    (async () => {
      const [nextSymbols, nextNotes] = await Promise.all([
        fetchSessionSymbols(selectedSessionId),
        fetchSessionNotes(selectedSessionId)
      ]);
      if (cancelled) return;
      setSymbols(nextSymbols);
      setSelectedSymbol((prev) => (prev && nextSymbols.includes(prev) ? prev : nextSymbols[0] || ""));
      setNotes(nextNotes);
      setNotesOriginal(nextNotes);
      setSaveState("idle");
      setSaveMessage("");
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId || !selectedSymbol) {
      setCandlesByTimeframe({ "1m": [], "5m": [] });
      setGapsByTimeframe({ "1m": [], "5m": [] });
      return;
    }
    let cancelled = false;
    setLoadingSnapshot(true);
    (async () => {
      const snapshot = await fetchSessionSnapshotById(selectedSessionId, selectedSymbol);
      if (cancelled) return;
      if (!snapshot) {
        setCandlesByTimeframe({ "1m": [], "5m": [] });
        setGapsByTimeframe({ "1m": [], "5m": [] });
      } else {
        setCandlesByTimeframe({
          "1m": snapshot.candlesByTimeframe["1m"] || [],
          "5m": snapshot.candlesByTimeframe["5m"] || []
        });
        setGapsByTimeframe({
          "1m": snapshot.gapsByTimeframe["1m"] || [],
          "5m": snapshot.gapsByTimeframe["5m"] || []
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

  return (
    <div className="grid h-[calc(100vh-5.5rem)] grid-cols-[22rem_minmax(0,1fr)] gap-3">
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

      <section className="flex min-h-0 flex-col gap-3">
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
            </div>
          ) : (
            <div className="text-sm text-slate-600">Select a saved session to begin studying.</div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white p-2">
          {loadingSnapshot ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading chart...</div>
          ) : selectedSymbol ? (
            <Chart
              candles={candlesByTimeframe[timeframe]}
              gaps={gapsByTimeframe[timeframe]}
              vwapEnabled
              emaEnabled
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              This session has no symbols to load.
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3">
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
      </section>
    </div>
  );
}
