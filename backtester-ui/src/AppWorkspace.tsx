import { useEffect, useMemo, useState } from "react";
import {
  fetchBacktestSessions,
  fetchBacktestSessionsPaged,
  fetchBacktestSnapshot,
  fetchBacktestSymbols,
  fetchScannerFeatures,
  fetchBacktestTrades,
  fetchScannerMetadata,
  fetchStrategyDefinitions,
  fetchSourceSessionsPaged,
  importSourceSession,
  runSessionScannerApi,
  runBacktestApi,
  fetchLiquidityZoneExport,
  runLiquidityZoneScannerApi
} from "./lib/api";
import {
  buildOptimizationLeaderboards,
  applyWinStopOneRetryPerDay,
  capTradesPerCalendarDay,
  filterTradesByScannerEntryBtcCorr,
  formatDateTime,
  hhmmToMinutes,
  minutesToHHMM,
  rangeBySamples,
  rangeByStep,
  resolveScannerEffectiveAnchorTsMs,
  runTotalR
} from "./lib/backtestMath";
import { AppShell } from "./layout/AppShell";
import type { NavSection } from "./layout/nav";
import { SessionsSidebar } from "./features/sessions/SessionsSidebar";
import { RunControlsBar } from "./features/runs/RunControlsBar";
import { SingleRunWorkspace } from "./features/runs/SingleRunWorkspace";
import { BatchRunsWorkspace } from "./features/runs/BatchRunsWorkspace";
import { OptimizerWorkspace } from "./features/optimizer/OptimizerWorkspace";
import { TradeDrilldownModal } from "./features/trades/TradeDrilldownModal";
import { SessionDataWorkspace } from "./features/data/SessionDataWorkspace";
import { ScannerWorkspace } from "./features/scanner/ScannerWorkspace";
import { AboutWorkspace } from "./features/about/AboutWorkspace";
import { WorkspaceContext } from "./state/WorkspaceContext";
import type {
  BacktestOptimizerSettings,
  BacktestRunResult,
  BatchRunRow,
  Candle,
  OptimizationAssetRow,
  OptimizationScenarioResult,
  PaginationMeta,
  ReplayMode,
  ScannerFeatureRow,
  ScannerRunResult,
  SavedSession,
  ScannerMetadataItem,
  StrategyDefinition,
  SessionType,
  SessionTrade,
  StrategyId,
  TickPolicy,
  Timeframe
} from "./types";

type SimulatedTrade = BacktestRunResult["trades"][number];

const ET_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function getEtParts(ms: number): { dayKey: string; hour: number; minute: number } {
  const parts = ET_PARTS_FORMATTER.formatToParts(new Date(ms));
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const year = Number(map.year || 0);
  const month = Number(map.month || 0);
  const day = Number(map.day || 0);
  const hour = Number(map.hour || 0);
  const minute = Number(map.minute || 0);
  return {
    dayKey: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    hour,
    minute
  };
}

function parseAnchorTimeToMinutes(value: string): number {
  const raw = String(value || "").trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 9 * 60;
  const hh = Math.max(0, Math.min(23, Number(m[1] || 0)));
  const mm = Math.max(0, Math.min(59, Number(m[2] || 0)));
  return hh * 60 + mm;
}

function defaultsFromDefinition(definition: StrategyDefinition | null): Record<string, unknown> {
  if (!definition) return {};
  const out: Record<string, unknown> = {};
  for (const param of definition.params || []) {
    out[param.key] = param.defaultValue;
  }
  return out;
}

export default function AppWorkspace() {
  const [activeSection, setActiveSection] = useState<NavSection>("overview");
  const [importingId, setImportingId] = useState("");
  const [importFeedback, setImportFeedback] = useState("");
  const [sourceSessions, setSourceSessions] = useState<SavedSession[]>([]);
  const [sourceDateFilter, setSourceDateFilter] = useState("");
  const [sourcePagination, setSourcePagination] = useState<PaginationMeta>({
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1
  });
  const [backtestPagination, setBacktestPagination] = useState<PaginationMeta>({
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1
  });
  const [backtestDateFilter, setBacktestDateFilter] = useState("");
  const [sessionTypeFilter, setSessionTypeFilter] = useState<"all" | SessionType>("all");
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [symbols, setSymbols] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [mode, setMode] = useState<ReplayMode>("mixed");
  const [tickPolicy, setTickPolicy] = useState<TickPolicy>("real_then_synthetic");
  const [strategyId, setStrategyId] = useState<StrategyId>("noop");
  const [strategyCatalog, setStrategyCatalog] = useState<StrategyDefinition[]>([]);
  const [strategyParamOverrides, setStrategyParamOverrides] = useState<Record<string, Record<string, unknown>>>({});
  const [optimizerSettings, setOptimizerSettings] = useState<BacktestOptimizerSettings>({
    takeProfitRR: 2,
    vwapStartHHMM: 930,
    activeStartHHMM: 930,
    activeEndHHMM: 1600,
    stopLossSource: "open",
    dojiBodyToRangeMax: 0.3,
    ignoreWeekends: false,
    ignoreUsHolidays: false
  });
  const [candlesByTimeframe, setCandlesByTimeframe] = useState<Record<Timeframe, Candle[]>>({
    "1m": [],
    "5m": []
  });
  const [runResult, setRunResult] = useState<BacktestRunResult | null>(null);
  const [capSimTradesTwoPerDay, setCapSimTradesTwoPerDay] = useState(false);
  const [simWinStopRetryPerDay, setSimWinStopRetryPerDay] = useState(false);
  const [reportScannerBtcCorrMin, setReportScannerBtcCorrMin] = useState("");
  const [reportScannerBtcCorrMax, setReportScannerBtcCorrMax] = useState("");
  const [selectedSimTradeIdx, setSelectedSimTradeIdx] = useState<number | null>(null);
  const [sessionTrades, setSessionTrades] = useState<SessionTrade[]>([]);
  const [scannerMetadata, setScannerMetadata] = useState<ScannerMetadataItem[]>([]);
  const [scannerRows, setScannerRows] = useState<ScannerFeatureRow[]>([]);
  const [scannerLastRun, setScannerLastRun] = useState<ScannerRunResult | null>(null);
  const [scannerRunning, setScannerRunning] = useState(false);
  const [scannerUseForRuns, setScannerUseForRuns] = useState(true);
  const [scannerTimeframe, setScannerTimeframe] = useState<Timeframe>("1m");
  const [scannerAnchorInput, setScannerAnchorInput] = useState("09:00");
  const [scannerLookbackHours, setScannerLookbackHours] = useState(120);
  const [scannerCurrentWindowHours, setScannerCurrentWindowHours] = useState(12);
  const [scannerBtcSymbol, setScannerBtcSymbol] = useState("BTC");
  const [scannerFeatureSet, setScannerFeatureSet] = useState("rvol-scanner");
  const [scannerFeatureVersion, setScannerFeatureVersion] = useState("v1");
  const [scannerScanFullSession, setScannerScanFullSession] = useState(true);
  const [running, setRunning] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchRunRow[]>([]);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0, current: "" });
  const [optimizing, setOptimizing] = useState(false);
  const [optimizerRrStart, setOptimizerRrStart] = useState(1);
  const [optimizerRrEnd, setOptimizerRrEnd] = useState(3);
  const [optimizerRrStep, setOptimizerRrStep] = useState(0.5);
  const [optimizerVwapStartFrom, setOptimizerVwapStartFrom] = useState(930);
  const [optimizerVwapStartTo, setOptimizerVwapStartTo] = useState(930);
  const [optimizerVwapStartStepMinutes, setOptimizerVwapStartStepMinutes] = useState(15);
  const [optimizerActiveStartFrom, setOptimizerActiveStartFrom] = useState(930);
  const [optimizerActiveStartTo, setOptimizerActiveStartTo] = useState(1000);
  const [optimizerActiveStartStepMinutes, setOptimizerActiveStartStepMinutes] = useState(15);
  const [optimizerActiveEndFrom, setOptimizerActiveEndFrom] = useState(1500);
  const [optimizerActiveEndTo, setOptimizerActiveEndTo] = useState(1600);
  const [optimizerActiveEndStepMinutes, setOptimizerActiveEndStepMinutes] = useState(15);
  const [optimizerDojiBodyToRangeMaxFrom, setOptimizerDojiBodyToRangeMaxFrom] = useState(0.05);
  const [optimizerDojiBodyToRangeMaxTo, setOptimizerDojiBodyToRangeMaxTo] = useState(0.3);
  const [optimizerDojiBodyToRangeMaxStep, setOptimizerDojiBodyToRangeMaxStep] = useState(0.05);
  const [optimizerStepMode, setOptimizerStepMode] = useState<"per_variable" | "consistent">("per_variable");
  const [optimizerConsistentSamples, setOptimizerConsistentSamples] = useState(3);
  const [optimizerMixSize, setOptimizerMixSize] = useState(3);
  const [optimizerDrawdownWeight, setOptimizerDrawdownWeight] = useState(1);
  const [optimizerLossWeight, setOptimizerLossWeight] = useState(1);
  const [optimizerAssetSelection, setOptimizerAssetSelection] = useState("");
  const [optimizerSessionScope, setOptimizerSessionScope] = useState<"filtered" | "selected">("filtered");
  const [optimizerSessionTypeFilter, setOptimizerSessionTypeFilter] = useState<"all" | SessionType>("all");
  const [optimizationResults, setOptimizationResults] = useState<OptimizationScenarioResult[]>([]);
  const [optimizationAssetBreakdownsByRr, setOptimizationAssetBreakdownsByRr] = useState<
    Record<string, OptimizationAssetRow[]>
  >({});
  const [optimizationProgress, setOptimizationProgress] = useState({ done: 0, total: 0, current: "" });
  const [assetSearch, setAssetSearch] = useState("");
  const [assetMinRuns, setAssetMinRuns] = useState(1);
  const [assetTopN, setAssetTopN] = useState(3);
  const [selectedAssetSymbols, setSelectedAssetSymbols] = useState<string[]>([]);
  const [replayIndex, setReplayIndex] = useState<number>(-1);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || null,
    [sessions, selectedSessionId]
  );
  const scannerAnchorTsMs = useMemo(() => {
    const candles = candlesByTimeframe[scannerTimeframe] || [];
    if (candles.length === 0) return Number(selectedSession?.startedAtMs || 0);
    const targetMinutes = parseAnchorTimeToMinutes(scannerAnchorInput);
    const firstCandleTs = Number(candles[0]?.timeMs || 0);
    const firstDayKey = getEtParts(firstCandleTs).dayKey;
    const dayCandles = candles.filter((candle) => getEtParts(Number(candle.timeMs || 0)).dayKey === firstDayKey);
    if (dayCandles.length === 0) return firstCandleTs;
    let exact = 0;
    let nearestTs = Number(dayCandles[0]?.timeMs || firstCandleTs);
    let nearestDiff = Number.POSITIVE_INFINITY;
    for (const candle of dayCandles) {
      const ts = Number(candle.timeMs || 0);
      if (!Number.isFinite(ts) || ts <= 0) continue;
      const et = getEtParts(ts);
      const candleMinutes = et.hour * 60 + et.minute;
      if (candleMinutes === targetMinutes) {
        exact = ts;
        break;
      }
      const diff = Math.abs(candleMinutes - targetMinutes);
      if (diff < nearestDiff) {
        nearestDiff = diff;
        nearestTs = ts;
      }
    }
    const raw = exact || nearestTs || firstCandleTs;
    return resolveScannerEffectiveAnchorTsMs(
      candles,
      raw,
      scannerTimeframe,
      scannerLookbackHours,
      scannerCurrentWindowHours
    );
  }, [
    candlesByTimeframe,
    scannerTimeframe,
    scannerAnchorInput,
    selectedSession?.startedAtMs,
    scannerLookbackHours,
    scannerCurrentWindowHours
  ]);

  const refreshBacktestSessions = async (
    page = 1,
    date = backtestDateFilter,
    sessionType: "all" | SessionType = sessionTypeFilter
  ) => {
    const payload = await fetchBacktestSessionsPaged({
      page,
      pageSize: 10,
      date: date || undefined,
      sessionType: sessionType === "all" ? undefined : sessionType
    });
    if (!payload) return;
    setSessions(payload.sessions);
    setBacktestPagination(payload.pagination);
    setBacktestDateFilter(date);
    setSessionTypeFilter(sessionType);
    setSelectedSessionId((prev) =>
      prev && payload.sessions.some((x) => x.id === prev) ? prev : payload.sessions[0]?.id || ""
    );
  };

  const refreshSourceSessions = async (page = 1, date = sourceDateFilter) => {
    const payload = await fetchSourceSessionsPaged({ page, pageSize: 10, date: date || undefined });
    if (!payload) return;
    setSourceSessions(payload.sessions);
    setSourcePagination(payload.pagination);
    setSourceDateFilter(date);
  };

  const refreshScannerRows = async () => {
    if (!selectedSessionId) {
      setScannerRows([]);
      return;
    }
    const rows = await fetchScannerFeatures({
      sessionId: selectedSessionId,
      timeframe: scannerTimeframe,
      featureSet: scannerFeatureSet,
      featureVersion: scannerFeatureVersion,
      anchorTsMs:
        scannerScanFullSession || !(scannerAnchorTsMs > 0) ? undefined : scannerAnchorTsMs,
      limit: scannerScanFullSession ? 8000 : 1000
    });
    setScannerRows(rows);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [rows, strategies] = await Promise.all([fetchBacktestSessions(), fetchStrategyDefinitions()]);
      if (cancelled) return;
      if (strategies.length > 0) {
        setStrategyCatalog(strategies);
        setStrategyId((prev) => (strategies.some((strategy) => strategy.id === prev) ? prev : strategies[0].id));
      }
      if (rows.length > 0) {
        await refreshBacktestSessions(1, "", "all");
      } else {
        setSessions([]);
      }
      await refreshSourceSessions(1, "");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSessionId) return;
    let cancelled = false;
    (async () => {
      const [nextSymbols, trades, metadata, rows] = await Promise.all([
        fetchBacktestSymbols(selectedSessionId),
        fetchBacktestTrades(selectedSessionId),
        fetchScannerMetadata(selectedSessionId),
        fetchScannerFeatures({
          sessionId: selectedSessionId,
          timeframe: scannerTimeframe,
          featureSet: scannerFeatureSet,
          featureVersion: scannerFeatureVersion,
          anchorTsMs:
            scannerScanFullSession || !(scannerAnchorTsMs > 0) ? undefined : scannerAnchorTsMs,
          limit: scannerScanFullSession ? 8000 : 1000
        })
      ]);
      if (cancelled) return;
      setSymbols(nextSymbols);
      setSelectedSymbol((prev) => (prev && nextSymbols.includes(prev) ? prev : nextSymbols[0] || ""));
      setSessionTrades(trades);
      setScannerMetadata(metadata);
      setScannerRows(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    selectedSessionId,
    scannerTimeframe,
    scannerFeatureSet,
    scannerFeatureVersion,
    scannerAnchorTsMs,
    scannerScanFullSession
  ]);

  useEffect(() => {
    if (strategyCatalog.length === 0) return;
    setStrategyParamOverrides((prev) => {
      const next = { ...prev };
      for (const definition of strategyCatalog) {
        if (!next[definition.id]) next[definition.id] = defaultsFromDefinition(definition);
      }
      return next;
    });
    setStrategyId((prev) =>
      strategyCatalog.some((definition) => definition.id === prev) ? prev : strategyCatalog[0].id
    );
  }, [strategyCatalog]);

  useEffect(() => {
    if (!selectedSessionId || !selectedSymbol) return;
    let cancelled = false;
    (async () => {
      setLoadingSnapshot(true);
      const snapshot = await fetchBacktestSnapshot(selectedSessionId, selectedSymbol, "all");
      if (cancelled) return;
      const next = snapshot?.candlesByTimeframe || { "1m": [], "5m": [] };
      setCandlesByTimeframe(next);
      if ((next["1m"]?.length || 0) === 0 && (next["5m"]?.length || 0) === 0) {
        console.warn(
          `[backtester-ui] No candles for session=${selectedSessionId} symbol=${selectedSymbol}. Check import/source DB.`
        );
      }
      setReplayIndex(-1);
      setLoadingSnapshot(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSessionId, selectedSymbol]);

  const chartCandles = useMemo(() => {
    const candles = candlesByTimeframe[timeframe] || [];
    if (mode === "mixed" && replayIndex >= 0) return candles.slice(0, replayIndex + 1);
    return candles;
  }, [candlesByTimeframe, timeframe, mode, replayIndex]);

  const { tradesForDisplay, tradesBeforeBtcCorrFilter, btcCorrReportFilterActive } = useMemo(() => {
    const raw = runResult?.trades;
    if (!raw?.length) {
      return { tradesForDisplay: [], tradesBeforeBtcCorrFilter: 0, btcCorrReportFilterActive: false };
    }
    const ordered = [...raw].sort((a, b) => Number(a.openedAtMs) - Number(b.openedAtMs));
    let base: typeof ordered;
    if (simWinStopRetryPerDay) base = applyWinStopOneRetryPerDay(ordered);
    else if (capSimTradesTwoPerDay) base = capTradesPerCalendarDay(ordered, 2);
    else base = ordered;

    const minRaw = reportScannerBtcCorrMin.trim();
    const maxRaw = reportScannerBtcCorrMax.trim();
    const minNum = minRaw === "" ? NaN : Number(minRaw);
    const maxNum = maxRaw === "" ? NaN : Number(maxRaw);
    const hasMin = minRaw !== "" && Number.isFinite(minNum);
    const hasMax = maxRaw !== "" && Number.isFinite(maxNum);
    const btcActive = hasMin || hasMax;
    const featureSet =
      String(runResult?.meta?.params?.scannerFeatureSet || "rvol-scanner").trim() || "rvol-scanner";
    let trades = base;
    if (btcActive) {
      trades = filterTradesByScannerEntryBtcCorr(base, featureSet, {
        min: hasMin ? minNum : undefined,
        max: hasMax ? maxNum : undefined
      });
    }
    return {
      tradesForDisplay: trades,
      tradesBeforeBtcCorrFilter: base.length,
      btcCorrReportFilterActive: btcActive
    };
  }, [
    runResult?.trades,
    runResult?.meta?.params?.scannerFeatureSet,
    capSimTradesTwoPerDay,
    simWinStopRetryPerDay,
    reportScannerBtcCorrMin,
    reportScannerBtcCorrMax
  ]);

  const selectedSimTrade = useMemo<SimulatedTrade | null>(() => {
    if (selectedSimTradeIdx == null) return null;
    return tradesForDisplay[selectedSimTradeIdx] || null;
  }, [selectedSimTradeIdx, tradesForDisplay]);

  useEffect(() => {
    setSelectedSimTradeIdx(null);
  }, [runResult]);

  useEffect(() => {
    setSelectedSimTradeIdx(null);
  }, [capSimTradesTwoPerDay, simWinStopRetryPerDay, reportScannerBtcCorrMin, reportScannerBtcCorrMax]);

  useEffect(() => {
    if (selectedSimTradeIdx == null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedSimTradeIdx(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedSimTradeIdx]);

  const sourceStats = useMemo(() => {
    const candles = candlesByTimeframe[timeframe] || [];
    return candles.reduce(
      (acc, candle) => {
        const source = String(candle.source || "unknown");
        acc[source] = (acc[source] || 0) + 1;
        if (candle.isGapFill) acc.gapFill += 1;
        return acc;
      },
      { history: 0, live: 0, mixed: 0, gap_fill: 0, gapFill: 0, unknown: 0 } as Record<string, number>
    );
  }, [candlesByTimeframe, timeframe]);

  const candleRange = useMemo(() => {
    const candles = candlesByTimeframe[timeframe] || [];
    if (candles.length === 0) return null;
    const first = candles[0];
    const last = candles[candles.length - 1];
    return { count: candles.length, from: first.timeMs, to: last.timeMs };
  }, [candlesByTimeframe, timeframe]);

  const activeStrategyDefinition = useMemo(
    () => strategyCatalog.find((definition) => definition.id === strategyId) || null,
    [strategyCatalog, strategyId]
  );

  const strategyVariables = useMemo(() => {
    const byId: Record<string, Record<string, unknown>> = {};
    for (const definition of strategyCatalog) {
      byId[definition.id] = {
        ...defaultsFromDefinition(definition),
        ...(strategyParamOverrides[definition.id] || {})
      };
    }

    // Keep legacy optimizer controls in sync for ORB-family strategies.
    const orbBase = {
      rr: Number(optimizerSettings.takeProfitRR),
      anchorHHMM: Number(optimizerSettings.vwapStartHHMM),
      activeStartHHMM: Number(optimizerSettings.activeStartHHMM),
      activeEndHHMM: Number(optimizerSettings.activeEndHHMM),
      dojiBodyToRangeMax: Number(optimizerSettings.dojiBodyToRangeMax),
      ignoreWeekends: Boolean(optimizerSettings.ignoreWeekends),
      ignoreUsHolidays: Boolean(optimizerSettings.ignoreUsHolidays)
    };
    if (byId["orb-avwap-930"]) byId["orb-avwap-930"] = { ...byId["orb-avwap-930"], ...orbBase };
    if (byId["orb-avwap-930-open-avwap-sl"]) {
      byId["orb-avwap-930-open-avwap-sl"] = {
        ...byId["orb-avwap-930-open-avwap-sl"],
        ...orbBase,
        stopLossSource: optimizerSettings.stopLossSource
      };
    }
    if (byId["orb-avwap-930-open-avwap-sl-1m"]) {
      byId["orb-avwap-930-open-avwap-sl-1m"] = {
        ...byId["orb-avwap-930-open-avwap-sl-1m"],
        ...orbBase,
        stopLossSource: optimizerSettings.stopLossSource
      };
    }
    if (byId["orb-avwap-pullback-1m"]) {
      byId["orb-avwap-pullback-1m"] = {
        ...byId["orb-avwap-pullback-1m"],
        ...orbBase,
        stopLossSource: optimizerSettings.stopLossSource
      };
    }

    if (scannerUseForRuns && scannerFeatureSet) {
      const scannerParams: Record<string, unknown> = {
        scannerFeatureSet,
        scannerFeatureVersion,
        /** 0 = load all buckets for this symbol (per-candle / full-session scan). */
        scannerAnchorTsMs: scannerScanFullSession ? 0 : scannerAnchorTsMs
      };
      for (const key of Object.keys(byId)) {
        byId[key] = { ...byId[key], ...scannerParams };
      }
    }
    return byId;
  }, [
    strategyCatalog,
    strategyParamOverrides,
    optimizerSettings,
    scannerUseForRuns,
    scannerFeatureSet,
    scannerFeatureVersion,
    scannerAnchorTsMs,
    scannerScanFullSession
  ]);

  const handleRun = async () => {
    if (!selectedSessionId || !selectedSymbol || running) return;
    setRunning(true);
    const result = await runBacktestApi({
      sessionId: selectedSessionId,
      symbol: selectedSymbol,
      timeframe,
      mode,
      strategyId,
      tickPolicy,
      strategyParams: strategyVariables[strategyId] || {}
    });
    setRunResult(result);
    setRunning(false);
  };

  const handleStrategyParamChange = (key: string, value: unknown) => {
    setStrategyParamOverrides((prev) => ({
      ...prev,
      [strategyId]: {
        ...(prev[strategyId] || {}),
        [key]: value
      }
    }));
    // Mirror known ORB variables to optimizer settings so optimizer/runs stay aligned.
    if (key === "rr" && Number.isFinite(Number(value))) {
      setOptimizerSettings((prev) => ({ ...prev, takeProfitRR: Math.max(0.1, Number(value)) }));
    } else if (key === "anchorHHMM" && Number.isFinite(Number(value))) {
      setOptimizerSettings((prev) => ({ ...prev, vwapStartHHMM: Math.max(0, Math.min(2359, Number(value))) }));
    } else if (key === "activeStartHHMM" && Number.isFinite(Number(value))) {
      setOptimizerSettings((prev) => ({ ...prev, activeStartHHMM: Math.max(0, Math.min(2359, Number(value))) }));
    } else if (key === "activeEndHHMM" && Number.isFinite(Number(value))) {
      setOptimizerSettings((prev) => ({ ...prev, activeEndHHMM: Math.max(0, Math.min(2359, Number(value))) }));
    } else if (key === "dojiBodyToRangeMax" && Number.isFinite(Number(value))) {
      setOptimizerSettings((prev) => ({ ...prev, dojiBodyToRangeMax: Math.max(0, Math.min(1, Number(value))) }));
    } else if (key === "stopLossSource") {
      setOptimizerSettings((prev) => ({
        ...prev,
        stopLossSource: String(value || "open") as BacktestOptimizerSettings["stopLossSource"]
      }));
    } else if (key === "ignoreWeekends") {
      setOptimizerSettings((prev) => ({ ...prev, ignoreWeekends: Boolean(value) }));
    } else if (key === "ignoreUsHolidays") {
      setOptimizerSettings((prev) => ({ ...prev, ignoreUsHolidays: Boolean(value) }));
    }
  };

  const runBatch = async () => {
    if (running || batchRunning) return;
    setBatchRunning(true);
    setBatchResults([]);
    setBatchProgress({ done: 0, total: 0, current: "Collecting filtered sessions..." });
    try {
      const allSessions: SavedSession[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const payload = await fetchBacktestSessionsPaged({
          page,
          pageSize: 50,
          date: backtestDateFilter || undefined,
          sessionType: sessionTypeFilter === "all" ? undefined : sessionTypeFilter
        });
        if (!payload) break;
        allSessions.push(...payload.sessions);
        totalPages = payload.pagination.totalPages || 1;
        page += 1;
      } while (page <= totalPages);

      const targets: Array<{ sessionId: string; symbol: string }> = [];
      for (const session of allSessions) {
        const sessionSymbols = await fetchBacktestSymbols(session.id);
        for (const symbol of sessionSymbols) targets.push({ sessionId: session.id, symbol });
      }

      if (targets.length === 0) {
        setBatchProgress({ done: 0, total: 0, current: "No session/symbol targets found." });
        return;
      }

      setBatchProgress({ done: 0, total: targets.length, current: "Starting batch..." });
      for (let i = 0; i < targets.length; i += 1) {
        const target = targets[i];
        setBatchProgress({ done: i, total: targets.length, current: `${target.sessionId} / ${target.symbol}` });
        const result = await runBacktestApi({
          sessionId: target.sessionId,
          symbol: target.symbol,
          timeframe,
          mode,
          strategyId,
          tickPolicy,
          strategyParams: strategyVariables[strategyId] || {}
        });
        if (result) {
          const totalR = runTotalR(result.trades);
          setBatchResults((prev) => [
            ...prev,
            {
              sessionId: target.sessionId,
              symbol: target.symbol,
              trades: result.metrics.tradeCount,
              winRate: result.metrics.winRate,
              pnlR: totalR,
              status: "ok"
            }
          ]);
        } else {
          setBatchResults((prev) => [
            ...prev,
            {
              sessionId: target.sessionId,
              symbol: target.symbol,
              trades: 0,
              winRate: 0,
              pnlR: 0,
              status: "error",
              error: "run failed"
            }
          ]);
        }
      }
      setBatchProgress({ done: targets.length, total: targets.length, current: "Batch complete" });
    } finally {
      setBatchRunning(false);
    }
  };

  const optimizeScenarios = async () => {
    if (
      running ||
      batchRunning ||
      optimizing ||
      (strategyId !== "orb-avwap-930" && strategyId !== "orb-avwap-930-open-avwap-sl")
    ) {
      return;
    }
    setOptimizing(true);
    setOptimizationResults([]);
    setOptimizationAssetBreakdownsByRr({});
    setOptimizationProgress({ done: 0, total: 0, current: "Collecting sessions/assets..." });
    try {
      const rrStart = Math.max(0.1, Number(optimizerRrStart || 1));
      const rrEnd = Math.max(rrStart, Number(optimizerRrEnd || rrStart));
      const rrStep = Math.max(0.1, Number(optimizerRrStep || 0.5));
      const rrValues =
        optimizerStepMode === "consistent"
          ? rangeBySamples(rrStart, rrEnd, Math.max(1, Number(optimizerConsistentSamples || 3)), 4)
          : rangeByStep(rrStart, rrEnd, rrStep, 4);

      const vwapFromMin = hhmmToMinutes(Math.min(optimizerVwapStartFrom, optimizerVwapStartTo));
      const vwapToMin = hhmmToMinutes(Math.max(optimizerVwapStartFrom, optimizerVwapStartTo));
      const startFromMin = hhmmToMinutes(Math.min(optimizerActiveStartFrom, optimizerActiveStartTo));
      const startToMin = hhmmToMinutes(Math.max(optimizerActiveStartFrom, optimizerActiveStartTo));
      const endFromMin = hhmmToMinutes(Math.min(optimizerActiveEndFrom, optimizerActiveEndTo));
      const endToMin = hhmmToMinutes(Math.max(optimizerActiveEndFrom, optimizerActiveEndTo));
      const vwapMinValues =
        optimizerStepMode === "consistent"
          ? rangeBySamples(vwapFromMin, vwapToMin, Math.max(1, Number(optimizerConsistentSamples || 3)), 0)
          : rangeByStep(vwapFromMin, vwapToMin, Math.max(1, Number(optimizerVwapStartStepMinutes || 15)), 0);
      const startMinValues =
        optimizerStepMode === "consistent"
          ? rangeBySamples(startFromMin, startToMin, Math.max(1, Number(optimizerConsistentSamples || 3)), 0)
          : rangeByStep(startFromMin, startToMin, Math.max(1, Number(optimizerActiveStartStepMinutes || 15)), 0);
      const endMinValues =
        optimizerStepMode === "consistent"
          ? rangeBySamples(endFromMin, endToMin, Math.max(1, Number(optimizerConsistentSamples || 3)), 0)
          : rangeByStep(endFromMin, endToMin, Math.max(1, Number(optimizerActiveEndStepMinutes || 15)), 0);
      const vwapStartValues = vwapMinValues.map((m) => minutesToHHMM(m));
      const activeStartValues = startMinValues.map((m) => minutesToHHMM(m));
      const activeEndValues = endMinValues.map((m) => minutesToHHMM(m));
      const variableCombos: Array<{ rr: number; anchorHHMM: number; activeStartHHMM: number; activeEndHHMM: number }> =
        [];
      for (const rr of rrValues) {
        for (const anchorHHMM of vwapStartValues) {
          for (const activeStartHHMM of activeStartValues) {
            for (const activeEndHHMM of activeEndValues) {
              if (hhmmToMinutes(activeEndHHMM) <= hhmmToMinutes(activeStartHHMM)) continue;
              if (hhmmToMinutes(activeStartHHMM) < hhmmToMinutes(anchorHHMM)) continue;
              variableCombos.push({ rr, anchorHHMM, activeStartHHMM, activeEndHHMM });
            }
          }
        }
      }
      if (variableCombos.length === 0) return;

      let allSessions: SavedSession[] = [];
      if (optimizerSessionScope === "selected") {
        const selected = sessions.find((session) => session.id === selectedSessionId);
        allSessions = selected ? [selected] : [];
      } else {
        let page = 1;
        let totalPages = 1;
        do {
          const payload = await fetchBacktestSessionsPaged({
            page,
            pageSize: 50,
            date: backtestDateFilter || undefined,
            sessionType: sessionTypeFilter === "all" ? undefined : sessionTypeFilter
          });
          if (!payload) break;
          allSessions.push(...payload.sessions);
          totalPages = payload.pagination.totalPages || 1;
          page += 1;
        } while (page <= totalPages);
      }
      if (optimizerSessionTypeFilter !== "all") {
        allSessions = allSessions.filter((session) => session.sessionType === optimizerSessionTypeFilter);
      }
      if (allSessions.length === 0) {
        setOptimizationProgress({ done: 0, total: 0, current: "No sessions match optimizer scope/filter." });
        return;
      }

      const targets: Array<{ sessionId: string; symbol: string }> = [];
      for (const session of allSessions) {
        const sessionSymbols = await fetchBacktestSymbols(session.id);
        for (const symbol of sessionSymbols) targets.push({ sessionId: session.id, symbol });
      }
      const selectedSymbols = new Set(
        optimizerAssetSelection
          .split(",")
          .map((value) => value.trim().toUpperCase())
          .filter(Boolean)
      );
      const filteredTargets =
        selectedSymbols.size > 0
          ? targets.filter((target) => selectedSymbols.has(String(target.symbol || "").toUpperCase()))
          : targets;
      if (filteredTargets.length === 0) {
        setOptimizationProgress({ done: 0, total: 0, current: "No targets found." });
        return;
      }

      const totalRuns = variableCombos.length * filteredTargets.length;
      let done = 0;
      setOptimizationProgress({ done, total: totalRuns, current: "Running optimization..." });
      const scenarioAccumulator: OptimizationScenarioResult[] = [];
      const rrAssetBreakdownAccumulator: Record<string, OptimizationAssetRow[]> = {};

      for (const combo of variableCombos) {
        const rr = combo.rr;
        const assetStats = new Map<string, { runs: number; totalR: number; totalDrawdown: number; negativeRuns: number }>();
        let rrRunCount = 0;
        let rrTotalTrades = 0;
        let rrWinRateNumerator = 0;
        let rrTotalR = 0;
        let rrTotalDrawdown = 0;
        let rrNegativeRuns = 0;

        for (const target of filteredTargets) {
          setOptimizationProgress({
            done,
            total: totalRuns,
            current: `RR ${rr.toFixed(2)} VWAP ${combo.anchorHHMM} active ${combo.activeStartHHMM}-${combo.activeEndHHMM} · ${target.sessionId}/${target.symbol}`
          });
          const result = await runBacktestApi({
            sessionId: target.sessionId,
            symbol: target.symbol,
            timeframe,
            mode,
            strategyId,
            tickPolicy,
            strategyParams: {
              ...(strategyVariables[strategyId] || {}),
              rr,
              anchorHHMM: combo.anchorHHMM,
              activeStartHHMM: combo.activeStartHHMM,
              activeEndHHMM: combo.activeEndHHMM
            }
          });
          done += 1;
          if (!result) continue;
          const totalR = runTotalR(result.trades);
          const dd = Number(result.metrics.maxDrawdown || 0);
          const tradeCount = Number(result.metrics.tradeCount || 0);
          const runWinRate = Number(result.metrics.winRate || 0);
          rrRunCount += 1;
          rrTotalTrades += tradeCount;
          rrWinRateNumerator += runWinRate * tradeCount;
          rrTotalR += totalR;
          rrTotalDrawdown += dd;
          if (totalR < 0) rrNegativeRuns += 1;
          const curr = assetStats.get(target.symbol) || { runs: 0, totalR: 0, totalDrawdown: 0, negativeRuns: 0 };
          curr.runs += 1;
          curr.totalR += totalR;
          curr.totalDrawdown += dd;
          if (totalR < 0) curr.negativeRuns += 1;
          assetStats.set(target.symbol, curr);
        }

        const assetRows = Array.from(assetStats.entries())
          .map(([symbol, s]) => {
            const avgRPerRun = s.runs > 0 ? s.totalR / s.runs : 0;
            const avgDrawdown = s.runs > 0 ? s.totalDrawdown / s.runs : 0;
            const negativeRunRate = s.runs > 0 ? s.negativeRuns / s.runs : 0;
            const score =
              avgRPerRun - Number(optimizerDrawdownWeight || 0) * avgDrawdown - Number(optimizerLossWeight || 0) * negativeRunRate;
            return { symbol, runs: s.runs, totalR: s.totalR, avgRPerRun, avgDrawdown, negativeRunRate, score };
          })
          .sort((a, b) => b.score - a.score);

        const runCount = rrRunCount;
        const winRate = rrTotalTrades > 0 ? rrWinRateNumerator / rrTotalTrades : 0;
        const totalR = rrTotalR;
        const avgRPerRun = runCount > 0 ? totalR / runCount : 0;
        const avgDrawdown = runCount > 0 ? rrTotalDrawdown / runCount : 0;
        const negativeRunRate = runCount > 0 ? rrNegativeRuns / runCount : 0;
        const score =
          avgRPerRun - Number(optimizerDrawdownWeight || 0) * avgDrawdown - Number(optimizerLossWeight || 0) * negativeRunRate;

        scenarioAccumulator.push({
          rr,
          anchorHHMM: combo.anchorHHMM,
          activeStartHHMM: combo.activeStartHHMM,
          activeEndHHMM: combo.activeEndHHMM,
          runCount,
          winRate,
          totalR,
          avgRPerRun,
          avgDrawdown,
          negativeRunRate,
          score,
          rating: 0,
          profitRankScore: 0,
          drawdownRankScore: 0
        });
        rrAssetBreakdownAccumulator[`${rr.toFixed(4)}:${combo.anchorHHMM}:${combo.activeStartHHMM}:${combo.activeEndHHMM}`] =
          assetRows;
      }

      const totalRMin = Math.min(...scenarioAccumulator.map((x) => x.totalR));
      const totalRMax = Math.max(...scenarioAccumulator.map((x) => x.totalR));
      const ddMin = Math.min(...scenarioAccumulator.map((x) => x.avgDrawdown));
      const ddMax = Math.max(...scenarioAccumulator.map((x) => x.avgDrawdown));
      const negMin = Math.min(...scenarioAccumulator.map((x) => x.negativeRunRate));
      const negMax = Math.max(...scenarioAccumulator.map((x) => x.negativeRunRate));
      const normalize = (value: number, min: number, max: number) => {
        if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max - min === 0) return 50;
        return ((value - min) / (max - min)) * 100;
      };
      const ratedResults = scenarioAccumulator.map((row) => {
        const profitRankScore = normalize(row.totalR, totalRMin, totalRMax);
        const drawdownRankScore = 100 - normalize(row.avgDrawdown, ddMin, ddMax);
        const lossScore = 100 - normalize(row.negativeRunRate, negMin, negMax);
        const rating = profitRankScore * 0.5 + drawdownRankScore * 0.35 + lossScore * 0.15;
        return { ...row, rating, profitRankScore, drawdownRankScore };
      });

      setOptimizationResults(ratedResults);
      setOptimizationAssetBreakdownsByRr(rrAssetBreakdownAccumulator);
      const best = ratedResults.reduce<OptimizationScenarioResult | null>(
        (currBest, row) => (currBest == null || row.score > currBest.score ? row : currBest),
        null
      );
      if (best) {
        const bestAssets =
          (rrAssetBreakdownAccumulator[
            `${best.rr.toFixed(4)}:${best.anchorHHMM}:${best.activeStartHHMM}:${best.activeEndHHMM}`
          ] || [])
            .slice(0, Math.max(1, Number(optimizerMixSize || 1)))
            .map((row) => row.symbol);
        setSelectedAssetSymbols(bestAssets);
      }
      setOptimizationProgress({ done: totalRuns, total: totalRuns, current: "Optimization complete" });
    } finally {
      setOptimizing(false);
    }
  };

  const batchSummary = useMemo(() => {
    if (batchResults.length === 0) return null;
    const okRows = batchResults.filter((x) => x.status === "ok");
    const errorCount = batchResults.length - okRows.length;
    const totalR = okRows.reduce((acc, row) => acc + row.pnlR, 0);
    const totalTrades = okRows.reduce((acc, row) => acc + row.trades, 0);
    const weightedWinRate = totalTrades > 0 ? okRows.reduce((acc, row) => acc + row.winRate * row.trades, 0) / totalTrades : 0;
    const avgRPerRun = okRows.length > 0 ? totalR / okRows.length : 0;
    const avgRPerTrade = totalTrades > 0 ? totalR / totalTrades : 0;
    const positiveRuns = okRows.filter((row) => row.pnlR > 0).length;
    const negativeRuns = okRows.filter((row) => row.pnlR < 0).length;
    const flatRuns = okRows.filter((row) => row.pnlR === 0).length;
    const bestRun = okRows.reduce<BatchRunRow | null>((best, row) => (best == null || row.pnlR > best.pnlR ? row : best), null);
    const worstRun = okRows.reduce<BatchRunRow | null>((worst, row) => (worst == null || row.pnlR < worst.pnlR ? row : worst), null);
    return {
      runs: batchResults.length,
      ok: okRows.length,
      errorCount,
      totalR,
      totalTrades,
      weightedWinRate,
      avgRPerRun,
      avgRPerTrade,
      positiveRuns,
      negativeRuns,
      flatRuns,
      bestRun,
      worstRun
    };
  }, [batchResults]);

  const batchAssetBreakdown = useMemo(() => {
    if (batchResults.length === 0) return [];
    const okRows = batchResults.filter((x) => x.status === "ok");
    const grouped = new Map<string, { runs: number; trades: number; totalR: number; weightedWinRateNumerator: number }>();
    for (const row of okRows) {
      const current = grouped.get(row.symbol) || { runs: 0, trades: 0, totalR: 0, weightedWinRateNumerator: 0 };
      current.runs += 1;
      current.trades += row.trades;
      current.totalR += row.pnlR;
      current.weightedWinRateNumerator += row.winRate * row.trades;
      grouped.set(row.symbol, current);
    }
    return Array.from(grouped.entries())
      .map(([symbol, stats]) => {
        const avgRPerRun = stats.runs > 0 ? stats.totalR / stats.runs : 0;
        const avgRPerTrade = stats.trades > 0 ? stats.totalR / stats.trades : 0;
        const weightedWinRate = stats.trades > 0 ? stats.weightedWinRateNumerator / stats.trades : 0;
        return { symbol, runs: stats.runs, trades: stats.trades, totalR: stats.totalR, avgRPerRun, avgRPerTrade, weightedWinRate };
      })
      .sort((a, b) => b.totalR - a.totalR);
  }, [batchResults]);

  const filteredAssetBreakdown = useMemo(() => {
    const query = assetSearch.trim().toUpperCase();
    return batchAssetBreakdown.filter((row) => {
      if (row.runs < assetMinRuns) return false;
      if (!query) return true;
      return row.symbol.includes(query);
    });
  }, [assetMinRuns, assetSearch, batchAssetBreakdown]);

  const selectedAssetComboStats = useMemo(() => {
    const selected = new Set(selectedAssetSymbols);
    const rows = batchResults.filter((row) => row.status === "ok" && selected.has(row.symbol));
    const runs = rows.length;
    const totalTrades = rows.reduce((acc, row) => acc + row.trades, 0);
    const totalR = rows.reduce((acc, row) => acc + row.pnlR, 0);
    const weightedWinRate = totalTrades > 0 ? rows.reduce((acc, row) => acc + row.winRate * row.trades, 0) / totalTrades : 0;
    return {
      assetCount: selected.size,
      runs,
      totalTrades,
      totalR,
      avgRPerRun: runs > 0 ? totalR / runs : 0,
      avgRPerTrade: totalTrades > 0 ? totalR / totalTrades : 0,
      weightedWinRate
    };
  }, [batchResults, selectedAssetSymbols]);

  const bestOptimizationScenario = useMemo(() => {
    if (optimizationResults.length === 0) return null;
    return optimizationResults.reduce((best, row) => (best == null || row.score > best.score ? row : best), null as OptimizationScenarioResult | null);
  }, [optimizationResults]);

  const optimizationLeaderboards = useMemo(() => buildOptimizationLeaderboards(optimizationResults), [optimizationResults]);

  const optimizerTargetSessionCount = useMemo(() => {
    if (optimizerSessionScope === "selected") {
      const selected = sessions.find((session) => session.id === selectedSessionId);
      if (!selected) return 0;
      if (optimizerSessionTypeFilter === "all") return 1;
      return selected.sessionType === optimizerSessionTypeFilter ? 1 : 0;
    }
    return sessions.filter((session) =>
      optimizerSessionTypeFilter === "all" ? true : session.sessionType === optimizerSessionTypeFilter
    ).length;
  }, [optimizerSessionScope, optimizerSessionTypeFilter, sessions, selectedSessionId]);

  const bestRrAssetMix = useMemo(() => {
    if (!bestOptimizationScenario) return [];
    const rows =
      optimizationAssetBreakdownsByRr[
        `${bestOptimizationScenario.rr.toFixed(4)}:${bestOptimizationScenario.anchorHHMM}:${bestOptimizationScenario.activeStartHHMM}:${bestOptimizationScenario.activeEndHHMM}`
      ] || [];
    return rows.slice(0, Math.max(1, Number(optimizerMixSize || 1)));
  }, [bestOptimizationScenario, optimizationAssetBreakdownsByRr, optimizerMixSize]);

  const stepReplay = () => {
    if (mode !== "mixed") return;
    const maxIndex = Math.max(0, chartCandles.length - 1);
    setReplayIndex((prev) => Math.min(maxIndex, prev + 1));
  };

  const handleImportSession = async (sessionId: string) => {
    if (!sessionId || importingId) return;
    setImportingId(sessionId);
    setImportFeedback("");
    const ok = await importSourceSession(sessionId);
    if (ok) {
      setImportFeedback(`Imported ${sessionId}`);
      await refreshBacktestSessions(1, backtestDateFilter, sessionTypeFilter);
    } else {
      setImportFeedback(`Import failed for ${sessionId}`);
    }
    setImportingId("");
  };

  const handleRunScanner = async () => {
    if (!selectedSessionId || scannerRunning) return;
    setScannerRunning(true);
    try {
      const result = await runSessionScannerApi({
        sessionId: selectedSessionId,
        timeframe: scannerTimeframe,
        anchorTsMs: scannerAnchorTsMs,
        lookbackHours: Math.max(1, Number(scannerLookbackHours || 120)),
        currentWindowHours: Math.max(1, Number(scannerCurrentWindowHours || 12)),
        btcSymbol: String(scannerBtcSymbol || "BTC").toUpperCase(),
        featureSet: scannerFeatureSet,
        featureVersion: scannerFeatureVersion,
        scanMode: scannerScanFullSession ? "session_bars" : "single"
      });
      setScannerLastRun(result);
      await Promise.all([refreshScannerRows(), fetchScannerMetadata(selectedSessionId).then(setScannerMetadata)]);
    } finally {
      setScannerRunning(false);
    }
  };

  const handleRunLiquidityZoneScanner = async () => {
    if (!selectedSessionId || scannerRunning) return;
    setScannerRunning(true);
    try {
      await runLiquidityZoneScannerApi({ sessionId: selectedSessionId });
    } finally {
      setScannerRunning(false);
    }
  };

  const handleExportLiquidityZones = async () => {
    if (!selectedSessionId || !selectedSymbol) return;
    const data = await fetchLiquidityZoneExport({
      sessionId: selectedSessionId,
      symbol: selectedSymbol
    });
    if (!data) return;
    const json = JSON.stringify(data, null, 2);
    const safeSession = String(selectedSessionId).replace(/[^a-zA-Z0-9_-]+/g, "_");
    const safeSymbol = String(selectedSymbol).replace(/[^a-zA-Z0-9_-]+/g, "_");
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `liquidity-zones_${safeSession}_${safeSymbol}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sectionMeta: Record<NavSection, { title: string; description: string }> = {
    overview: { title: "Overview", description: "High-level view of sessions, runs, and data in one workspace." },
    sessions: { title: "Sessions", description: "Select session, run strategy, and drill into simulated trades." },
    scanner: { title: "Scanner", description: "Run per-asset RVOL scanner on this session and attach candle features." },
    "runs-batch": { title: "Batch Runs", description: "Execute strategy across all filtered sessions and symbols." },
    "runs-optimizer": { title: "Optimizer Runs", description: "Sweep strategy variables and compare scenario quality." },
    trades: { title: "Trades", description: "Inspect simulated trades and open detailed chart replays." },
    data: { title: "Data", description: "Manage import queue, session trades, scanner metadata, and provenance." },
    about: { title: "About", description: "How the simulator works — architecture, replay modes, tick policy, and strategies." }
  };

  const selectTopAssets = (count: number) => {
    const top = filteredAssetBreakdown.slice(0, Math.max(1, count)).map((row) => row.symbol);
    setSelectedAssetSymbols(top);
  };

  const toggleAssetSelection = (symbol: string) => {
    setSelectedAssetSymbols((prev) => (prev.includes(symbol) ? prev.filter((value) => value !== symbol) : [...prev, symbol]));
  };

  const workspaceValue = useMemo(
    () => ({
      selectedSessionId,
      selectedSymbol,
      timeframe,
      mode,
      tickPolicy,
      strategyId,
      setSelectedSessionId,
      setSelectedSymbol,
      setTimeframe,
      setMode,
      setTickPolicy,
      setStrategyId
    }),
    [selectedSessionId, selectedSymbol, timeframe, mode, tickPolicy, strategyId]
  );

  const controls = (
    <RunControlsBar
      selectedSession={selectedSession}
      symbols={symbols}
      selectedSymbol={selectedSymbol}
      timeframe={timeframe}
      mode={mode}
      tickPolicy={tickPolicy}
      strategyId={strategyId}
      strategies={strategyCatalog}
      running={running}
      batchRunning={batchRunning}
      onSelectSymbol={setSelectedSymbol}
      onSetTimeframe={setTimeframe}
      onSetMode={setMode}
      onSetTickPolicy={setTickPolicy}
      onSetStrategyId={setStrategyId}
      onRun={handleRun}
      onRunBatch={runBatch}
      onStepReplay={stepReplay}
    />
  );

  const renderActiveSection = () => {
    switch (activeSection) {
      case "sessions":
        return (
          <>
            {controls}
            <SingleRunWorkspace
              timeframe={timeframe}
              strategyId={strategyId}
              loadingSnapshot={loadingSnapshot}
              selectedSessionId={selectedSessionId}
              selectedSymbol={selectedSymbol}
              chartCandles={chartCandles}
              tradeWindowCandles={candlesByTimeframe[timeframe] || []}
              oneMinuteCandles={candlesByTimeframe["1m"] || []}
              candleRange={candleRange}
              runResult={runResult}
              tradesForDisplay={tradesForDisplay}
              capTradesTwoPerDay={capSimTradesTwoPerDay}
              onCapTradesTwoPerDayChange={(v) => {
                setCapSimTradesTwoPerDay(v);
                if (v) setSimWinStopRetryPerDay(false);
              }}
              simWinStopRetryPerDay={simWinStopRetryPerDay}
              onSimWinStopRetryPerDayChange={(v) => {
                setSimWinStopRetryPerDay(v);
                if (v) setCapSimTradesTwoPerDay(false);
              }}
              reportScannerBtcCorrMin={reportScannerBtcCorrMin}
              reportScannerBtcCorrMax={reportScannerBtcCorrMax}
              onReportScannerBtcCorrMinChange={setReportScannerBtcCorrMin}
              onReportScannerBtcCorrMaxChange={setReportScannerBtcCorrMax}
              tradesBeforeBtcCorrFilter={tradesBeforeBtcCorrFilter}
              btcCorrReportFilterActive={btcCorrReportFilterActive}
              optimizerSettings={optimizerSettings}
              onOptimizerSettingChange={(patch) => setOptimizerSettings((prev) => ({ ...prev, ...patch }))}
              strategyDefinition={activeStrategyDefinition}
              strategyParams={strategyVariables[strategyId] || {}}
              onStrategyParamChange={handleStrategyParamChange}
              onTradeClick={setSelectedSimTradeIdx}
            />
          </>
        );
      case "scanner":
        return (
          <>
            {controls}
            <ScannerWorkspace
              selectedSessionId={selectedSessionId}
              scannerTimeframe={scannerTimeframe}
              scannerAnchorInput={scannerAnchorInput}
              scannerResolvedAnchorTsMs={scannerAnchorTsMs}
              scannerLookbackHours={scannerLookbackHours}
              scannerCurrentWindowHours={scannerCurrentWindowHours}
              scannerBtcSymbol={scannerBtcSymbol}
              scannerFeatureSet={scannerFeatureSet}
              scannerFeatureVersion={scannerFeatureVersion}
              scannerScanFullSession={scannerScanFullSession}
              scannerUseForRuns={scannerUseForRuns}
              scannerRunning={scannerRunning}
              scannerRows={scannerRows}
              scannerLastRun={scannerLastRun}
              onScannerTimeframeChange={setScannerTimeframe}
              onScannerAnchorInputChange={setScannerAnchorInput}
              onScannerLookbackHoursChange={setScannerLookbackHours}
              onScannerCurrentWindowHoursChange={setScannerCurrentWindowHours}
              onScannerBtcSymbolChange={setScannerBtcSymbol}
              onScannerFeatureSetChange={setScannerFeatureSet}
              onScannerFeatureVersionChange={setScannerFeatureVersion}
              onScannerScanFullSessionChange={setScannerScanFullSession}
              onScannerUseForRunsChange={setScannerUseForRuns}
              onRunScanner={handleRunScanner}
              onRefreshScannerRows={refreshScannerRows}
              selectedSymbol={selectedSymbol}
              onRunLiquidityZoneScanner={handleRunLiquidityZoneScanner}
              onExportLiquidityZones={handleExportLiquidityZones}
            />
          </>
        );
      case "trades":
        return (
          <>
            {controls}
            <SingleRunWorkspace
              timeframe={timeframe}
              strategyId={strategyId}
              loadingSnapshot={loadingSnapshot}
              selectedSessionId={selectedSessionId}
              selectedSymbol={selectedSymbol}
              chartCandles={chartCandles}
              tradeWindowCandles={candlesByTimeframe[timeframe] || []}
              oneMinuteCandles={candlesByTimeframe["1m"] || []}
              candleRange={candleRange}
              runResult={runResult}
              tradesForDisplay={tradesForDisplay}
              capTradesTwoPerDay={capSimTradesTwoPerDay}
              onCapTradesTwoPerDayChange={(v) => {
                setCapSimTradesTwoPerDay(v);
                if (v) setSimWinStopRetryPerDay(false);
              }}
              simWinStopRetryPerDay={simWinStopRetryPerDay}
              onSimWinStopRetryPerDayChange={(v) => {
                setSimWinStopRetryPerDay(v);
                if (v) setCapSimTradesTwoPerDay(false);
              }}
              reportScannerBtcCorrMin={reportScannerBtcCorrMin}
              reportScannerBtcCorrMax={reportScannerBtcCorrMax}
              onReportScannerBtcCorrMinChange={setReportScannerBtcCorrMin}
              onReportScannerBtcCorrMaxChange={setReportScannerBtcCorrMax}
              tradesBeforeBtcCorrFilter={tradesBeforeBtcCorrFilter}
              btcCorrReportFilterActive={btcCorrReportFilterActive}
              optimizerSettings={optimizerSettings}
              onOptimizerSettingChange={(patch) => setOptimizerSettings((prev) => ({ ...prev, ...patch }))}
              strategyDefinition={activeStrategyDefinition}
              strategyParams={strategyVariables[strategyId] || {}}
              onStrategyParamChange={handleStrategyParamChange}
              onTradeClick={setSelectedSimTradeIdx}
            />
          </>
        );
      case "runs-batch":
        return (
          <>
            {controls}
            <BatchRunsWorkspace
              backtestDateFilter={backtestDateFilter}
              batchProgress={batchProgress}
              batchSummary={batchSummary}
              batchResults={batchResults}
              batchAssetBreakdown={batchAssetBreakdown}
              filteredAssetBreakdown={filteredAssetBreakdown}
              selectedAssetComboStats={selectedAssetComboStats}
              selectedAssetSymbols={selectedAssetSymbols}
              assetSearch={assetSearch}
              assetMinRuns={assetMinRuns}
              assetTopN={assetTopN}
              onAssetSearchChange={setAssetSearch}
              onAssetMinRunsChange={setAssetMinRuns}
              onAssetTopNChange={setAssetTopN}
              onSelectTopAssets={selectTopAssets}
              onClearAssetSelection={() => setSelectedAssetSymbols([])}
              onToggleAssetSelection={toggleAssetSelection}
            />
          </>
        );
      case "runs-optimizer":
        return (
          <>
            {controls}
            <OptimizerWorkspace
              strategyId={strategyId}
              optimizerSettings={optimizerSettings}
              setOptimizerSettings={setOptimizerSettings}
              optimizerStepMode={optimizerStepMode}
              setOptimizerStepMode={setOptimizerStepMode}
              optimizerConsistentSamples={optimizerConsistentSamples}
              setOptimizerConsistentSamples={setOptimizerConsistentSamples}
              optimizerRrStart={optimizerRrStart}
              setOptimizerRrStart={setOptimizerRrStart}
              optimizerRrEnd={optimizerRrEnd}
              setOptimizerRrEnd={setOptimizerRrEnd}
              optimizerRrStep={optimizerRrStep}
              setOptimizerRrStep={setOptimizerRrStep}
              optimizerVwapStartFrom={optimizerVwapStartFrom}
              setOptimizerVwapStartFrom={setOptimizerVwapStartFrom}
              optimizerVwapStartTo={optimizerVwapStartTo}
              setOptimizerVwapStartTo={setOptimizerVwapStartTo}
              optimizerVwapStartStepMinutes={optimizerVwapStartStepMinutes}
              setOptimizerVwapStartStepMinutes={setOptimizerVwapStartStepMinutes}
              optimizerActiveStartFrom={optimizerActiveStartFrom}
              setOptimizerActiveStartFrom={setOptimizerActiveStartFrom}
              optimizerActiveStartTo={optimizerActiveStartTo}
              setOptimizerActiveStartTo={setOptimizerActiveStartTo}
              optimizerActiveStartStepMinutes={optimizerActiveStartStepMinutes}
              setOptimizerActiveStartStepMinutes={setOptimizerActiveStartStepMinutes}
              optimizerActiveEndFrom={optimizerActiveEndFrom}
              setOptimizerActiveEndFrom={setOptimizerActiveEndFrom}
              optimizerActiveEndTo={optimizerActiveEndTo}
              setOptimizerActiveEndTo={setOptimizerActiveEndTo}
              optimizerActiveEndStepMinutes={optimizerActiveEndStepMinutes}
              setOptimizerActiveEndStepMinutes={setOptimizerActiveEndStepMinutes}
              optimizerDojiBodyToRangeMaxFrom={optimizerDojiBodyToRangeMaxFrom}
              setOptimizerDojiBodyToRangeMaxFrom={setOptimizerDojiBodyToRangeMaxFrom}
              optimizerDojiBodyToRangeMaxTo={optimizerDojiBodyToRangeMaxTo}
              setOptimizerDojiBodyToRangeMaxTo={setOptimizerDojiBodyToRangeMaxTo}
              optimizerDojiBodyToRangeMaxStep={optimizerDojiBodyToRangeMaxStep}
              setOptimizerDojiBodyToRangeMaxStep={setOptimizerDojiBodyToRangeMaxStep}
              optimizerMixSize={optimizerMixSize}
              setOptimizerMixSize={setOptimizerMixSize}
              optimizerDrawdownWeight={optimizerDrawdownWeight}
              setOptimizerDrawdownWeight={setOptimizerDrawdownWeight}
              optimizerLossWeight={optimizerLossWeight}
              setOptimizerLossWeight={setOptimizerLossWeight}
              optimizerAssetSelection={optimizerAssetSelection}
              setOptimizerAssetSelection={setOptimizerAssetSelection}
              optimizerSessionScope={optimizerSessionScope}
              setOptimizerSessionScope={setOptimizerSessionScope}
              optimizerSessionTypeFilter={optimizerSessionTypeFilter}
              setOptimizerSessionTypeFilter={setOptimizerSessionTypeFilter}
              optimizerTargetSessionCount={optimizerTargetSessionCount}
              optimizeScenarios={optimizeScenarios}
              optimizing={optimizing}
              running={running}
              batchRunning={batchRunning}
              optimizationProgress={optimizationProgress}
              bestOptimizationScenario={bestOptimizationScenario}
              bestRrAssetMix={bestRrAssetMix}
              optimizationResults={optimizationResults}
              optimizationLeaderboards={optimizationLeaderboards}
            />
          </>
        );
      case "data":
        return (
          <>
            {controls}
            <SessionDataWorkspace
              timeframe={timeframe}
              sourceStats={sourceStats}
              sourcePagination={sourcePagination}
              sourceDateFilter={sourceDateFilter}
              sourceSessions={sourceSessions}
              importFeedback={importFeedback}
              importingId={importingId}
              sessionTrades={sessionTrades}
              scannerMetadata={scannerMetadata}
              onSourceDateFilterChange={setSourceDateFilter}
              onRefreshSourceSessions={refreshSourceSessions}
              onImportSession={handleImportSession}
            />
          </>
        );
      case "about":
        return <AboutWorkspace />;
      case "overview":
      default:
        return (
          <>
            {controls}
            <SingleRunWorkspace
              timeframe={timeframe}
              strategyId={strategyId}
              loadingSnapshot={loadingSnapshot}
              selectedSessionId={selectedSessionId}
              selectedSymbol={selectedSymbol}
              chartCandles={chartCandles}
              tradeWindowCandles={candlesByTimeframe[timeframe] || []}
              oneMinuteCandles={candlesByTimeframe["1m"] || []}
              candleRange={candleRange}
              runResult={runResult}
              tradesForDisplay={tradesForDisplay}
              capTradesTwoPerDay={capSimTradesTwoPerDay}
              onCapTradesTwoPerDayChange={(v) => {
                setCapSimTradesTwoPerDay(v);
                if (v) setSimWinStopRetryPerDay(false);
              }}
              simWinStopRetryPerDay={simWinStopRetryPerDay}
              onSimWinStopRetryPerDayChange={(v) => {
                setSimWinStopRetryPerDay(v);
                if (v) setCapSimTradesTwoPerDay(false);
              }}
              reportScannerBtcCorrMin={reportScannerBtcCorrMin}
              reportScannerBtcCorrMax={reportScannerBtcCorrMax}
              onReportScannerBtcCorrMinChange={setReportScannerBtcCorrMin}
              onReportScannerBtcCorrMaxChange={setReportScannerBtcCorrMax}
              tradesBeforeBtcCorrFilter={tradesBeforeBtcCorrFilter}
              btcCorrReportFilterActive={btcCorrReportFilterActive}
              optimizerSettings={optimizerSettings}
              onOptimizerSettingChange={(patch) => setOptimizerSettings((prev) => ({ ...prev, ...patch }))}
              strategyDefinition={activeStrategyDefinition}
              strategyParams={strategyVariables[strategyId] || {}}
              onStrategyParamChange={handleStrategyParamChange}
              onTradeClick={setSelectedSimTradeIdx}
            />
            <BatchRunsWorkspace
              backtestDateFilter={backtestDateFilter}
              batchProgress={batchProgress}
              batchSummary={batchSummary}
              batchResults={batchResults}
              batchAssetBreakdown={batchAssetBreakdown}
              filteredAssetBreakdown={filteredAssetBreakdown}
              selectedAssetComboStats={selectedAssetComboStats}
              selectedAssetSymbols={selectedAssetSymbols}
              assetSearch={assetSearch}
              assetMinRuns={assetMinRuns}
              assetTopN={assetTopN}
              onAssetSearchChange={setAssetSearch}
              onAssetMinRunsChange={setAssetMinRuns}
              onAssetTopNChange={setAssetTopN}
              onSelectTopAssets={selectTopAssets}
              onClearAssetSelection={() => setSelectedAssetSymbols([])}
              onToggleAssetSelection={toggleAssetSelection}
            />
          </>
        );
    }
  };

  return (
    <WorkspaceContext.Provider value={workspaceValue}>
      <AppShell
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        sectionTitle={sectionMeta[activeSection].title}
        sectionDescription={sectionMeta[activeSection].description}
        sidebar={
          <SessionsSidebar
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            sessionTypeFilter={sessionTypeFilter}
            backtestDateFilter={backtestDateFilter}
            backtestPagination={backtestPagination}
            onSessionTypeFilterChange={(value) => {
              void refreshBacktestSessions(1, backtestDateFilter, value);
            }}
            onDateFilterChange={setBacktestDateFilter}
            onRefresh={refreshBacktestSessions}
            onSelectSession={setSelectedSessionId}
          />
        }
      >
        {renderActiveSection()}
      </AppShell>
      <TradeDrilldownModal
        trade={selectedSimTrade}
        symbol={runResult?.meta?.symbol || selectedSymbol}
        timeframeLabel={timeframe}
        candles={candlesByTimeframe[timeframe] || []}
        oneMinuteCandles={candlesByTimeframe["1m"] || []}
        strategyId={runResult?.meta?.strategyId || strategyId}
        strategyParams={(runResult?.meta?.params as Record<string, unknown> | null) || null}
        onClose={() => setSelectedSimTradeIdx(null)}
      />
    </WorkspaceContext.Provider>
  );
}
