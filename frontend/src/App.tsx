import { useEffect, useRef, useState } from "react";
import { ChartPanel } from "./ChartPanel";
import { SymbolStreamsPanel } from "./SymbolStreamsPanel";
import { LiveMonitorPanel } from "./LiveMonitorPanel";
import { ReportPanel } from "./ReportPanel";
import { AssetsPanel } from "./AssetsPanel";
import {
  addStream,
  fetchPersistenceStatus,
  saveCurrentSession,
  setPrimarySymbol as setPrimarySymbolOnServer
} from "./lib/api";
import type { PersistenceStatus, SessionInfo } from "./types";

type AppTab = "trade" | "report" | "assets";

const tabs: { id: AppTab; name: string }[] = [
  { id: "trade", name: "Trade" },
  { id: "report", name: "Report" },
  { id: "assets", name: "Assets" }
];
const SPLITTER_HEIGHT_PX = 8;
const MIN_CHART_HEIGHT_PX = 180;
const MIN_MONITOR_HEIGHT_PX = 120;

function classNames(...classes: Array<string | boolean | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const sec = (totalSec % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}

export function App() {
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [primarySymbol, setPrimarySymbol] = useState<string>("");
  const [vwapEnabled, setVwapEnabled] = useState<boolean>(true);
  const [vwapPeriod, setVwapPeriod] = useState<number>(20);
  const [emaEnabled, setEmaEnabled] = useState<boolean>(true);
  const [emaPeriod, setEmaPeriod] = useState<number>(9);
  const [snapshotMode, setSnapshotMode] = useState<"preopen" | "live">("preopen");
  const [activeTab, setActiveTab] = useState<AppTab>("trade");
  const [subscribedAssets, setSubscribedAssets] = useState<string[]>([]);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus | null>(null);
  const [historyPreloading, setHistoryPreloading] = useState(false);
  const [clockNowMs, setClockNowMs] = useState<number>(() => Date.now());
  const [savingSession, setSavingSession] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [liveMonitorHeightPx, setLiveMonitorHeightPx] = useState<number>(220);
  const [isResizingPanels, setIsResizingPanels] = useState(false);
  const panelContainerRef = useRef<HTMLDivElement | null>(null);
  const resizeDragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const sessionElapsedMs = sessionInfo ? clockNowMs - sessionInfo.startedAtMs : 0;
  const sessionStatusLabel = sessionInfo?.status === "closed" ? "saved" : sessionInfo?.status || "";

  const handleChangeTab = (tab: AppTab) => {
    setActiveTab(tab);
  };

  const handleSubscribeAsset = async (asset: string) => {
    const symbol = asset.toUpperCase();
    setSelectedSymbol(symbol);
    setPrimarySymbol(symbol);

    await addStream(symbol);
    await setPrimarySymbolOnServer(symbol);
  };

  const handleStreamsChange = (symbols: string[], primary: string) => {
    setSubscribedAssets(symbols);
    setPrimarySymbol(primary);
  };

  const handleSelectAssetForChart = async (asset: string) => {
    const symbol = asset.toUpperCase();
    setSelectedSymbol(symbol);
    setPrimarySymbol(symbol);
    await setPrimarySymbolOnServer(symbol);
  };

  const handleAssetsPanelSelect = async (asset: string) => {
    await handleSelectAssetForChart(asset);
    setActiveTab("trade");
  };

  const handleShuffleDirection = (direction: "prev" | "next") => {
    if (subscribedAssets.length === 0) return;
    const upperAssets = subscribedAssets.map((s) => s.toUpperCase());
    const current = primarySymbol.toUpperCase();
    const currentIndex = upperAssets.indexOf(current);
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex =
      direction === "next"
        ? (safeIndex + 1) % upperAssets.length
        : (safeIndex - 1 + upperAssets.length) % upperAssets.length;
    const nextSymbol = upperAssets[nextIndex];
    void handleSelectAssetForChart(nextSymbol);
  };

  const handleSessionInfoChange = (nextSessionInfo: SessionInfo) => {
    setSessionInfo(nextSessionInfo);
  };

  const handleSaveSession = async () => {
    if (savingSession) return;
    setSavingSession(true);
    setSaveFeedback(null);
    const status = await saveCurrentSession();
    if (status) {
      setPersistenceStatus(status);
      setSaveFeedback("Session saved");
    } else {
      setSaveFeedback("Save failed");
    }
    setSavingSession(false);
    setTimeout(() => setSaveFeedback(null), 3000);
  };

  useEffect(() => {
    const id = setInterval(() => setClockNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadPersistenceStatus = async () => {
      const status = await fetchPersistenceStatus();
      if (cancelled) return;
      setPersistenceStatus(status);
    };

    void loadPersistenceStatus();
    const id = setInterval(() => {
      void loadPersistenceStatus();
    }, 10_000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!isResizingPanels) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (!resizeDragRef.current || !panelContainerRef.current) return;

      const deltaY = event.clientY - resizeDragRef.current.startY;
      const nextMonitorHeight = resizeDragRef.current.startHeight + deltaY;
      const availableHeight = panelContainerRef.current.clientHeight;
      const maxMonitorHeight = Math.max(
        MIN_MONITOR_HEIGHT_PX,
        availableHeight - MIN_CHART_HEIGHT_PX - SPLITTER_HEIGHT_PX
      );
      const clampedHeight = Math.max(
        MIN_MONITOR_HEIGHT_PX,
        Math.min(maxMonitorHeight, Math.round(nextMonitorHeight))
      );
      setLiveMonitorHeightPx(clampedHeight);
    };

    const stopResize = () => {
      setIsResizingPanels(false);
      resizeDragRef.current = null;
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [isResizingPanels]);

  const handleSplitterPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeDragRef.current = {
      startY: event.clientY,
      startHeight: liveMonitorHeightPx
    };
    setIsResizingPanels(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 p-1 text-xs font-medium">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleChangeTab(tab.id)}
                className={classNames(
                  "rounded-full px-3 py-1 transition",
                  activeTab === tab.id
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-200"
                )}
              >
                {tab.name}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-sm font-semibold tracking-tight text-indigo-900">
            <span>{primarySymbol || "0"}</span>
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
              Primary
            </span>
            <button
              type="button"
              className="rounded-full px-1.5 py-0.5 text-indigo-700 hover:bg-indigo-100"
              onClick={() => handleShuffleDirection("prev")}
              disabled={subscribedAssets.length === 0}
              aria-label="Previous symbol"
            >
              ◀
            </button>
            <button
              type="button"
              className="rounded-full px-1.5 py-0.5 text-indigo-700 hover:bg-indigo-100"
              onClick={() => handleShuffleDirection("next")}
              disabled={subscribedAssets.length === 0}
              aria-label="Next symbol"
            >
              ▶
            </button>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <label className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
              <span>VWAP</span>
              <input
                type="checkbox"
                checked={vwapEnabled}
                onChange={(e) => setVwapEnabled(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                aria-label="Enable VWAP"
              />
              <input
                type="number"
                min={1}
                max={500}
                value={vwapPeriod}
                disabled={!vwapEnabled}
                onChange={(e) => {
                  const next = Number.parseInt(e.target.value, 10);
                  if (Number.isNaN(next)) return;
                  setVwapPeriod(Math.min(500, Math.max(1, next)));
                }}
                className="w-14 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-right text-[11px] tabular-nums outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="VWAP period"
              />
            </label>
            <label className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
              <span>EMA</span>
              <input
                type="checkbox"
                checked={emaEnabled}
                onChange={(e) => setEmaEnabled(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                aria-label="Enable EMA"
              />
              <input
                type="number"
                min={1}
                max={500}
                value={emaPeriod}
                disabled={!emaEnabled}
                onChange={(e) => {
                  const next = Number.parseInt(e.target.value, 10);
                  if (Number.isNaN(next)) return;
                  setEmaPeriod(Math.min(500, Math.max(1, next)));
                }}
                className="w-14 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-right text-[11px] tabular-nums outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="EMA period"
              />
            </label>
            {sessionInfo && (
              <div className="inline-flex items-center gap-2 rounded-full bg-white px-2.5 py-1 font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
                <span
                  className={`inline-flex h-2 w-2 rounded-full ${
                    sessionInfo.status === "active" ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
                <span className="uppercase tracking-wide">{sessionStatusLabel}</span>
                <span>{formatElapsed(sessionElapsedMs)}</span>
              </div>
            )}
            {persistenceStatus && (
              <div
                className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 font-medium ring-1 ring-inset ${
                  persistenceStatus.redisOnline
                    ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                    : "bg-amber-50 text-amber-800 ring-amber-200"
                }`}
                title={
                  persistenceStatus.lastSqlSavedSessionId
                    ? `Last SQL session: ${persistenceStatus.lastSqlSavedSessionId}`
                    : "No SQL save yet"
                }
              >
                <span
                  className={`inline-flex h-2 w-2 rounded-full ${
                    persistenceStatus.redisOnline ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
                <span>
                  Redis {persistenceStatus.redisOnline ? "Online" : "Offline"} ·{" "}
                  {persistenceStatus.lastSqlSaveAtMs
                    ? `SQL saved ${new Date(persistenceStatus.lastSqlSaveAtMs).toLocaleTimeString()}`
                    : "SQL never saved"}
                </span>
              </div>
            )}
            {historyPreloading && (
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 font-medium text-indigo-700">
                Reloading...
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleSaveSession()}
              disabled={savingSession}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingSession ? "Saving..." : "Save Session"}
            </button>
            {saveFeedback && (
              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 font-medium text-slate-700">
                {saveFeedback}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="overflow-x-auto px-2 py-2">
        {activeTab === "trade" && (
          <div className="h-[calc(100vh-5.5rem)] overflow-hidden">
            <div className="grid h-full min-w-[1400px] grid-rows-[auto,minmax(0,1fr)] gap-2">
              <SymbolStreamsPanel
                selectedSymbol={selectedSymbol}
                onSelectedChange={setSelectedSymbol}
                onPrimaryChange={setPrimarySymbol}
                onStreamsChange={handleStreamsChange}
                compact
              />
              <div
                ref={panelContainerRef}
                className="grid min-h-0"
                style={{
                  gridTemplateRows: `minmax(${MIN_CHART_HEIGHT_PX}px,1fr) ${SPLITTER_HEIGHT_PX}px ${liveMonitorHeightPx}px`
                }}
              >
                <div className="min-h-0">
                  <ChartPanel
                    symbol={primarySymbol}
                    trackedSymbols={[...subscribedAssets, primarySymbol].filter(Boolean)}
                    vwapEnabled={vwapEnabled}
                    vwapPeriod={vwapPeriod}
                    emaEnabled={emaEnabled}
                    emaPeriod={emaPeriod}
                    onSessionInfoChange={handleSessionInfoChange}
                    onHistoryPreloadingChange={setHistoryPreloading}
                  />
                </div>
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize chart and live monitor"
                  onPointerDown={handleSplitterPointerDown}
                  className="group flex cursor-row-resize items-center justify-center rounded-full"
                  style={{ touchAction: "none" }}
                >
                  <div className="h-1 w-20 rounded-full bg-slate-300 transition group-hover:bg-slate-400" />
                </div>
                <div className="min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <LiveMonitorPanel
                    onSubscribeAsset={handleSubscribeAsset}
                    subscribedAssets={subscribedAssets}
                    compact
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "report" && (
          <div className="h-[calc(100vh-5.5rem)] overflow-auto">
            <ReportPanel snapshotMode={snapshotMode} />
          </div>
        )}

        {activeTab === "assets" && (
          <div className="h-[calc(100vh-5.5rem)] overflow-auto">
            <AssetsPanel snapshotMode={snapshotMode} onSelectAsset={handleAssetsPanelSelect} />
          </div>
        )}
      </main>
    </div>
  );
}
