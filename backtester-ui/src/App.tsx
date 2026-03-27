import { useEffect, useMemo, useState } from "react";
import { CandleChart } from "./components/CandleChart";
import {
  fetchBacktestSessions,
  fetchBacktestSessionsPaged,
  fetchBacktestSnapshot,
  fetchBacktestSymbols,
  fetchSourceSessionsPaged,
  importSourceSession,
  fetchBacktestTrades,
  fetchScannerMetadata,
  runBacktestApi
} from "./lib/api";
import type {
  BacktestOptimizerSettings,
  BacktestRunResult,
  Candle,
  PaginationMeta,
  ReplayMode,
  SavedSession,
  ScannerMetadataItem,
  SessionTrade,
  StrategyId,
  TickPolicy,
  Timeframe
} from "./types";

type BatchRunRow = {
  sessionId: string;
  symbol: string;
  trades: number;
  winRate: number;
  pnlR: number;
  status: "ok" | "error";
  error?: string;
};

type OptimizationScenarioResult = {
  rr: number;
  activeStartHHMM: number;
  activeEndHHMM: number;
  runCount: number;
  totalR: number;
  avgRPerRun: number;
  avgDrawdown: number;
  negativeRunRate: number;
  score: number;
  rating: number;
  profitRankScore: number;
  drawdownRankScore: number;
};

function hhmmToMinutes(hhmm: number): number {
  const clean = Math.max(0, Math.min(2359, Number(hhmm || 0)));
  const hh = Math.floor(clean / 100);
  const mm = clean % 100;
  return hh * 60 + mm;
}

function minutesToHHMM(minutes: number): number {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.floor(Number(minutes || 0))));
  const hh = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return hh * 100 + mm;
}

function rangeByStep(start: number, end: number, step: number, precision = 4): number[] {
  const safeStep = Math.max(Number.EPSILON, Number(step || 0));
  const safeStart = Number(start || 0);
  const safeEnd = Number(end || safeStart);
  const out: number[] = [];
  for (let value = safeStart; value <= safeEnd + Number.EPSILON; value += safeStep) {
    out.push(Number(value.toFixed(precision)));
  }
  return out;
}

function rangeBySamples(start: number, end: number, samples: number, precision = 4): number[] {
  const n = Math.max(1, Math.floor(Number(samples || 1)));
  if (n === 1) return [Number(start.toFixed(precision))];
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    out.push(Number((start + (end - start) * t).toFixed(precision)));
  }
  return Array.from(new Set(out));
}

type OptimizationAssetRow = {
  symbol: string;
  runs: number;
  totalR: number;
  avgRPerRun: number;
  avgDrawdown: number;
  negativeRunRate: number;
  score: number;
};

function tradeRiskPerUnit(side: string, entryPx: number, stopLoss?: number | null): number {
  if (!Number.isFinite(entryPx) || !Number.isFinite(stopLoss)) return 0;
  if (String(side || "").toLowerCase() === "short") return Number(stopLoss) - Number(entryPx);
  return Number(entryPx) - Number(stopLoss);
}

function tradePnlInR(trade: {
  side: string;
  entryPx: number;
  stopLoss?: number | null;
  size: number;
  pnl: number;
}): number | null {
  const riskPerUnit = tradeRiskPerUnit(trade.side, trade.entryPx, trade.stopLoss);
  const totalRisk = riskPerUnit * Number(trade.size || 0);
  if (!Number.isFinite(totalRisk) || totalRisk <= 0) return null;
  return Number(trade.pnl || 0) / totalRisk;
}

function runTotalR(
  trades: Array<{ side: string; entryPx: number; stopLoss?: number | null; size: number; pnl: number }>
): number {
  return trades.reduce((acc, trade) => {
    const r = tradePnlInR(trade);
    return acc + (r ?? 0);
  }, 0);
}

function formatDateTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "--";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(ms));
}

function formatDuration(startedAtMs: number, endedAtMs: number | null): string {
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) return "--";
  const endMs = Number.isFinite(endedAtMs || 0) && (endedAtMs || 0) > 0 ? Number(endedAtMs) : Date.now();
  const diffSec = Math.max(0, Math.floor((endMs - startedAtMs) / 1000));
  const hours = Math.floor(diffSec / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export default function App() {
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
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [symbols, setSymbols] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [mode, setMode] = useState<ReplayMode>("candle");
  const [tickPolicy, setTickPolicy] = useState<TickPolicy>("real_then_synthetic");
  const [strategyId, setStrategyId] = useState<StrategyId>("noop");
  const [optimizerSettings, setOptimizerSettings] = useState<BacktestOptimizerSettings>({
    takeProfitRR: 2,
    activeStartHHMM: 930,
    activeEndHHMM: 1600
  });
  const [candlesByTimeframe, setCandlesByTimeframe] = useState<Record<Timeframe, Candle[]>>({
    "1m": [],
    "5m": []
  });
  const [runResult, setRunResult] = useState<BacktestRunResult | null>(null);
  const [sessionTrades, setSessionTrades] = useState<SessionTrade[]>([]);
  const [scannerMetadata, setScannerMetadata] = useState<ScannerMetadataItem[]>([]);
  const [running, setRunning] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchRunRow[]>([]);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0, current: "" });
  const [optimizing, setOptimizing] = useState(false);
  const [optimizerRrStart, setOptimizerRrStart] = useState(1);
  const [optimizerRrEnd, setOptimizerRrEnd] = useState(3);
  const [optimizerRrStep, setOptimizerRrStep] = useState(0.5);
  const [optimizerActiveStartFrom, setOptimizerActiveStartFrom] = useState(930);
  const [optimizerActiveStartTo, setOptimizerActiveStartTo] = useState(1000);
  const [optimizerActiveStartStepMinutes, setOptimizerActiveStartStepMinutes] = useState(15);
  const [optimizerActiveEndFrom, setOptimizerActiveEndFrom] = useState(1500);
  const [optimizerActiveEndTo, setOptimizerActiveEndTo] = useState(1600);
  const [optimizerActiveEndStepMinutes, setOptimizerActiveEndStepMinutes] = useState(15);
  const [optimizerStepMode, setOptimizerStepMode] = useState<"per_variable" | "consistent">("per_variable");
  const [optimizerConsistentSamples, setOptimizerConsistentSamples] = useState(3);
  const [optimizerMixSize, setOptimizerMixSize] = useState(3);
  const [optimizerDrawdownWeight, setOptimizerDrawdownWeight] = useState(1);
  const [optimizerLossWeight, setOptimizerLossWeight] = useState(1);
  const [optimizerAssetSelection, setOptimizerAssetSelection] = useState("");
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

  const refreshBacktestSessions = async (page = 1, date = backtestDateFilter) => {
    const payload = await fetchBacktestSessionsPaged({ page, pageSize: 10, date: date || undefined });
    if (!payload) return;
    setSessions(payload.sessions);
    setBacktestPagination(payload.pagination);
    setBacktestDateFilter(date);
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await fetchBacktestSessions(); // initial fallback compatibility
      if (cancelled) return;
      if (rows.length > 0) {
        await refreshBacktestSessions(1, "");
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
      const [nextSymbols, trades, metadata] = await Promise.all([
        fetchBacktestSymbols(selectedSessionId),
        fetchBacktestTrades(selectedSessionId),
        fetchScannerMetadata(selectedSessionId)
      ]);
      if (cancelled) return;
      setSymbols(nextSymbols);
      setSelectedSymbol((prev) => (prev && nextSymbols.includes(prev) ? prev : nextSymbols[0] || ""));
      setSessionTrades(trades);
      setScannerMetadata(metadata);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSessionId]);

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
    return {
      count: candles.length,
      from: first.timeMs,
      to: last.timeMs
    };
  }, [candlesByTimeframe, timeframe]);

  const strategyVariables = useMemo(() => {
    const vars: Record<StrategyId, Record<string, unknown>> = {
      noop: {},
      "simple-momentum": {},
      "orb-avwap-930": {
        rr: Number(optimizerSettings.takeProfitRR),
        activeStartHHMM: Number(optimizerSettings.activeStartHHMM),
        activeEndHHMM: Number(optimizerSettings.activeEndHHMM)
      }
    };
    return vars;
  }, [optimizerSettings]);

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
      strategyParams: strategyVariables[strategyId]
    });
    setRunResult(result);
    setRunning(false);
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
          date: backtestDateFilter || undefined
        });
        if (!payload) break;
        allSessions.push(...payload.sessions);
        totalPages = payload.pagination.totalPages || 1;
        page += 1;
      } while (page <= totalPages);

      const targets: Array<{ sessionId: string; symbol: string }> = [];
      for (const session of allSessions) {
        const sessionSymbols = await fetchBacktestSymbols(session.id);
        for (const symbol of sessionSymbols) {
          targets.push({ sessionId: session.id, symbol });
        }
      }

      if (targets.length === 0) {
        setBatchProgress({ done: 0, total: 0, current: "No session/symbol targets found." });
        return;
      }

      setBatchProgress({ done: 0, total: targets.length, current: "Starting batch..." });
      for (let i = 0; i < targets.length; i += 1) {
        const target = targets[i];
        setBatchProgress({
          done: i,
          total: targets.length,
          current: `${target.sessionId} / ${target.symbol}`
        });
        const result = await runBacktestApi({
          sessionId: target.sessionId,
          symbol: target.symbol,
          timeframe,
          mode,
          strategyId,
          tickPolicy,
          strategyParams: strategyVariables[strategyId]
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
    if (running || batchRunning || optimizing || strategyId !== "orb-avwap-930") return;
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

      const startFromMin = hhmmToMinutes(Math.min(optimizerActiveStartFrom, optimizerActiveStartTo));
      const startToMin = hhmmToMinutes(Math.max(optimizerActiveStartFrom, optimizerActiveStartTo));
      const endFromMin = hhmmToMinutes(Math.min(optimizerActiveEndFrom, optimizerActiveEndTo));
      const endToMin = hhmmToMinutes(Math.max(optimizerActiveEndFrom, optimizerActiveEndTo));
      const startMinValues =
        optimizerStepMode === "consistent"
          ? rangeBySamples(startFromMin, startToMin, Math.max(1, Number(optimizerConsistentSamples || 3)), 0)
          : rangeByStep(startFromMin, startToMin, Math.max(1, Number(optimizerActiveStartStepMinutes || 15)), 0);
      const endMinValues =
        optimizerStepMode === "consistent"
          ? rangeBySamples(endFromMin, endToMin, Math.max(1, Number(optimizerConsistentSamples || 3)), 0)
          : rangeByStep(endFromMin, endToMin, Math.max(1, Number(optimizerActiveEndStepMinutes || 15)), 0);
      const activeStartValues = startMinValues.map((m) => minutesToHHMM(m));
      const activeEndValues = endMinValues.map((m) => minutesToHHMM(m));
      const variableCombos: Array<{ rr: number; activeStartHHMM: number; activeEndHHMM: number }> = [];
      for (const rr of rrValues) {
        for (const activeStartHHMM of activeStartValues) {
          for (const activeEndHHMM of activeEndValues) {
            if (hhmmToMinutes(activeEndHHMM) <= hhmmToMinutes(activeStartHHMM)) continue;
            variableCombos.push({ rr, activeStartHHMM, activeEndHHMM });
          }
        }
      }
      if (variableCombos.length === 0) return;

      const allSessions: SavedSession[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const payload = await fetchBacktestSessionsPaged({
          page,
          pageSize: 50,
          date: backtestDateFilter || undefined
        });
        if (!payload) break;
        allSessions.push(...payload.sessions);
        totalPages = payload.pagination.totalPages || 1;
        page += 1;
      } while (page <= totalPages);

      const targets: Array<{ sessionId: string; symbol: string }> = [];
      for (const session of allSessions) {
        const sessionSymbols = await fetchBacktestSymbols(session.id);
        for (const symbol of sessionSymbols) {
          targets.push({ sessionId: session.id, symbol });
        }
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
        const assetStats = new Map<
          string,
          { runs: number; totalR: number; totalDrawdown: number; negativeRuns: number }
        >();
        let rrRunCount = 0;
        let rrTotalR = 0;
        let rrTotalDrawdown = 0;
        let rrNegativeRuns = 0;

        for (const target of filteredTargets) {
          setOptimizationProgress({
            done,
            total: totalRuns,
            current: `RR ${rr.toFixed(2)} ${combo.activeStartHHMM}-${combo.activeEndHHMM} · ${target.sessionId}/${target.symbol}`
          });
          const result = await runBacktestApi({
            sessionId: target.sessionId,
            symbol: target.symbol,
            timeframe,
            mode,
            strategyId,
            tickPolicy,
            strategyParams: {
              ...strategyVariables["orb-avwap-930"],
              rr,
              activeStartHHMM: combo.activeStartHHMM,
              activeEndHHMM: combo.activeEndHHMM
            }
          });
          done += 1;
          if (!result) continue;
          const totalR = runTotalR(result.trades);
          const dd = Number(result.metrics.maxDrawdown || 0);
          rrRunCount += 1;
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
              avgRPerRun -
              Number(optimizerDrawdownWeight || 0) * avgDrawdown -
              Number(optimizerLossWeight || 0) * negativeRunRate;
            return {
              symbol,
              runs: s.runs,
              totalR: s.totalR,
              avgRPerRun,
              avgDrawdown,
              negativeRunRate,
              score
            };
          })
          .sort((a, b) => b.score - a.score);

        const runCount = rrRunCount;
        const totalR = rrTotalR;
        const avgRPerRun = runCount > 0 ? totalR / runCount : 0;
        const avgDrawdown = runCount > 0 ? rrTotalDrawdown / runCount : 0;
        const negativeRunRate = runCount > 0 ? rrNegativeRuns / runCount : 0;
        const score =
          avgRPerRun -
          Number(optimizerDrawdownWeight || 0) * avgDrawdown -
          Number(optimizerLossWeight || 0) * negativeRunRate;

        scenarioAccumulator.push({
          rr,
          activeStartHHMM: combo.activeStartHHMM,
          activeEndHHMM: combo.activeEndHHMM,
          runCount,
          totalR,
          avgRPerRun,
          avgDrawdown,
          negativeRunRate,
          score,
          rating: 0,
          profitRankScore: 0,
          drawdownRankScore: 0
        });
        rrAssetBreakdownAccumulator[
          `${rr.toFixed(4)}:${combo.activeStartHHMM}:${combo.activeEndHHMM}`
        ] = assetRows;
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
        const bestAssets = (
          rrAssetBreakdownAccumulator[
            `${best.rr.toFixed(4)}:${best.activeStartHHMM}:${best.activeEndHHMM}`
          ] || []
        )
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
    const weightedWinRate =
      totalTrades > 0
        ? okRows.reduce((acc, row) => acc + row.winRate * row.trades, 0) / totalTrades
        : 0;
    const avgRPerRun = okRows.length > 0 ? totalR / okRows.length : 0;
    const avgRPerTrade = totalTrades > 0 ? totalR / totalTrades : 0;
    const positiveRuns = okRows.filter((row) => row.pnlR > 0).length;
    const negativeRuns = okRows.filter((row) => row.pnlR < 0).length;
    const flatRuns = okRows.filter((row) => row.pnlR === 0).length;
    const bestRun = okRows.reduce<BatchRunRow | null>(
      (best, row) => (best == null || row.pnlR > best.pnlR ? row : best),
      null
    );
    const worstRun = okRows.reduce<BatchRunRow | null>(
      (worst, row) => (worst == null || row.pnlR < worst.pnlR ? row : worst),
      null
    );

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
    const grouped = new Map<
      string,
      { runs: number; trades: number; totalR: number; weightedWinRateNumerator: number }
    >();
    for (const row of okRows) {
      const current = grouped.get(row.symbol) || {
        runs: 0,
        trades: 0,
        totalR: 0,
        weightedWinRateNumerator: 0
      };
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
        return {
          symbol,
          runs: stats.runs,
          trades: stats.trades,
          totalR: stats.totalR,
          avgRPerRun,
          avgRPerTrade,
          weightedWinRate
        };
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
    const weightedWinRate =
      totalTrades > 0 ? rows.reduce((acc, row) => acc + row.winRate * row.trades, 0) / totalTrades : 0;
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

  const optimizationLeaderboards = useMemo(() => {
    if (optimizationResults.length === 0) {
      return {
        byScore: [] as OptimizationScenarioResult[],
        byProfit: [] as OptimizationScenarioResult[],
        byDrawdown: [] as OptimizationScenarioResult[],
        balancedAlt: [] as OptimizationScenarioResult[]
      };
    }
    const byScore = optimizationResults.slice().sort((a, b) => b.score - a.score).slice(0, 5);
    const byProfit = optimizationResults.slice().sort((a, b) => b.totalR - a.totalR).slice(0, 5);
    const byDrawdown = optimizationResults
      .slice()
      .sort((a, b) => a.avgDrawdown - b.avgDrawdown || b.totalR - a.totalR)
      .slice(0, 5);
    const balancedAlt = optimizationResults
      .slice()
      .filter((row) => row.totalR > 0)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 5);
    return { byScore, byProfit, byDrawdown, balancedAlt };
  }, [optimizationResults]);

  const bestRrAssetMix = useMemo(() => {
    if (!bestOptimizationScenario) return [];
    const rows =
      optimizationAssetBreakdownsByRr[
        `${bestOptimizationScenario.rr.toFixed(4)}:${bestOptimizationScenario.activeStartHHMM}:${bestOptimizationScenario.activeEndHHMM}`
      ] || [];
    return rows.slice(0, Math.max(1, Number(optimizerMixSize || 1)));
  }, [bestOptimizationScenario, optimizationAssetBreakdownsByRr, optimizerMixSize]);

  const selectTopAssets = (count: number) => {
    const top = filteredAssetBreakdown.slice(0, Math.max(1, count)).map((row) => row.symbol);
    setSelectedAssetSymbols(top);
  };

  const toggleAssetSelection = (symbol: string) => {
    setSelectedAssetSymbols((prev) =>
      prev.includes(symbol) ? prev.filter((value) => value !== symbol) : [...prev, symbol]
    );
  };

  const stepReplay = () => {
    if (mode !== "mixed") return;
    const maxIndex = Math.max(0, chartCandles.length - 1);
    setReplayIndex((prev) => Math.min(maxIndex, prev + 1));
  };

  const groupedImportedSessions = useMemo(() => {
    const groups = new Map<string, SavedSession[]>();
    for (const session of sessions) {
      const day = new Date(session.startedAtMs).toLocaleDateString();
      const list = groups.get(day) || [];
      list.push(session);
      groups.set(day, list);
    }
    return Array.from(groups.entries());
  }, [sessions]);

  const handleImportSession = async (sessionId: string) => {
    if (!sessionId || importingId) return;
    setImportingId(sessionId);
    setImportFeedback("");
    const ok = await importSourceSession(sessionId);
    if (ok) {
      setImportFeedback(`Imported ${sessionId}`);
      await refreshBacktestSessions(1, backtestDateFilter);
    } else {
      setImportFeedback(`Import failed for ${sessionId}`);
    }
    setImportingId("");
  };

  return (
    <div className="app-shell">
      <aside className="panel panel-left">
        <div className="panel-header">
          <h2>Backtest Sessions</h2>
          <span>
            page {backtestPagination.page}/{backtestPagination.totalPages} · total {backtestPagination.total}
          </span>
        </div>
        <div className="filter-row">
          <input
            type="date"
            value={backtestDateFilter}
            onChange={(e) => setBacktestDateFilter(e.target.value)}
          />
          <button type="button" onClick={() => void refreshBacktestSessions(1, backtestDateFilter)}>
            Filter
          </button>
          <button type="button" onClick={() => void refreshBacktestSessions(1, "")}>
            Clear
          </button>
        </div>
        <div className="session-list">
          {groupedImportedSessions.map(([day, items]) => (
            <div key={day}>
              <div className="group-title">{day}</div>
              {items.map((session) => (
                <button
                  key={session.id}
                  className={selectedSessionId === session.id ? "session-item selected" : "session-item"}
                  onClick={() => setSelectedSessionId(session.id)}
                  type="button"
                >
                  <div className="row">
                    <strong>{new Date(session.startedAtMs).toLocaleTimeString()}</strong>
                    <span>{formatDuration(session.startedAtMs, session.endedAtMs)}</span>
                  </div>
                  <div className="sub">{session.id}</div>
                  <div className="sub">{session.assetCount} assets · {session.candleCount} candles</div>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="pager">
          <button
            type="button"
            disabled={backtestPagination.page <= 1}
            onClick={() => void refreshBacktestSessions(backtestPagination.page - 1, backtestDateFilter)}
          >
            Prev
          </button>
          <button
            type="button"
            disabled={backtestPagination.page >= backtestPagination.totalPages}
            onClick={() => void refreshBacktestSessions(backtestPagination.page + 1, backtestDateFilter)}
          >
            Next
          </button>
        </div>
      </aside>

      <main className="panel panel-main">
        <div className="toolbar">
          <span className="pill">{selectedSession?.id || "No session selected"}</span>
          <span className="pill">Start {selectedSession ? formatDateTime(selectedSession.startedAtMs) : "--"}</span>
          <label>
            Symbol
            <select value={selectedSymbol} onChange={(e) => setSelectedSymbol(e.target.value)}>
              {symbols.map((symbol) => (
                <option key={symbol} value={symbol}>
                  {symbol}
                </option>
              ))}
            </select>
          </label>
          <label>
            Timeframe
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe)}>
              <option value="1m">1m</option>
              <option value="5m">5m</option>
            </select>
          </label>
          <label>
            Replay
            <select value={mode} onChange={(e) => setMode(e.target.value as ReplayMode)}>
              <option value="candle">candle</option>
              <option value="tick">tick</option>
              <option value="mixed">mixed</option>
            </select>
          </label>
          <label>
            Tick policy
            <select value={tickPolicy} onChange={(e) => setTickPolicy(e.target.value as TickPolicy)}>
              <option value="real_only">real_only</option>
              <option value="real_then_synthetic">real_then_synthetic</option>
              <option value="synthetic_only">synthetic_only</option>
            </select>
          </label>
          <label>
            Strategy
            <select value={strategyId} onChange={(e) => setStrategyId(e.target.value as StrategyId)}>
              <option value="noop">noop</option>
              <option value="simple-momentum">simple-momentum</option>
              <option value="orb-avwap-930">orb-avwap-930</option>
            </select>
          </label>
          <button onClick={handleRun} disabled={running || !selectedSymbol} type="button">
            {running ? "Running..." : "Run Backtest"}
          </button>
          <button onClick={runBatch} disabled={running || batchRunning} type="button">
            {batchRunning ? "Batch Running..." : "Run Batch (Filtered Days + Assets)"}
          </button>
          {mode === "mixed" && (
            <button onClick={stepReplay} type="button">
              Step Replay
            </button>
          )}
        </div>

        {strategyId === "orb-avwap-930" && (
          <section className="grid2">
            <div className="card">
              <h3>Strategy Optimizer</h3>
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
                      setOptimizerSettings((prev) => ({
                        ...prev,
                        takeProfitRR: Math.max(0.1, Number(e.target.value || 2))
                      }))
                    }
                  />
                </label>
                <label>
                  Start (HHMM)
                  <input
                    type="number"
                    min={0}
                    max={2359}
                    step={1}
                    value={optimizerSettings.activeStartHHMM}
                    onChange={(e) =>
                      setOptimizerSettings((prev) => ({
                        ...prev,
                        activeStartHHMM: Math.max(0, Math.min(2359, Number(e.target.value || 930)))
                      }))
                    }
                  />
                </label>
                <label>
                  End (HHMM)
                  <input
                    type="number"
                    min={0}
                    max={2359}
                    step={1}
                    value={optimizerSettings.activeEndHHMM}
                    onChange={(e) =>
                      setOptimizerSettings((prev) => ({
                        ...prev,
                        activeEndHHMM: Math.max(0, Math.min(2359, Number(e.target.value || 1600)))
                      }))
                    }
                  />
                </label>
                <span className="sub">
                  Current run: {Number(optimizerSettings.takeProfitRR).toFixed(1)}R ·{" "}
                  {optimizerSettings.activeStartHHMM}-{optimizerSettings.activeEndHHMM} ET
                </span>
              </div>
            </div>
            <div className="card">
              <h3>Optimize</h3>
              <div className="filter-row" style={{ borderBottom: "none", padding: "0", marginBottom: 6 }}>
                <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Step mode
                  <select
                    value={optimizerStepMode}
                    onChange={(e) => setOptimizerStepMode(e.target.value as "per_variable" | "consistent")}
                  >
                    <option value="per_variable">per-variable steps</option>
                    <option value="consistent">consistent samples</option>
                  </select>
                </label>
                {optimizerStepMode === "consistent" && (
                  <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    Samples per variable
                    <input
                      type="number"
                      min={2}
                      step={1}
                      value={optimizerConsistentSamples}
                      onChange={(e) => setOptimizerConsistentSamples(Math.max(2, Number(e.target.value || 3)))}
                      style={{ width: 70 }}
                    />
                  </label>
                )}
              </div>
              <div className="filter-row" style={{ borderBottom: "none", padding: "0", marginBottom: 6 }}>
                <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  RR start
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={optimizerRrStart}
                    onChange={(e) => setOptimizerRrStart(Math.max(0.1, Number(e.target.value || 1)))}
                    style={{ width: 70 }}
                  />
                </label>
                <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  RR end
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={optimizerRrEnd}
                    onChange={(e) => setOptimizerRrEnd(Math.max(0.1, Number(e.target.value || 3)))}
                    style={{ width: 70 }}
                  />
                </label>
                <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  RR step
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={optimizerRrStep}
                    onChange={(e) => setOptimizerRrStep(Math.max(0.1, Number(e.target.value || 0.5)))}
                    style={{ width: 70 }}
                    disabled={optimizerStepMode === "consistent"}
                  />
                </label>
              </div>
              <div className="filter-row" style={{ borderBottom: "none", padding: "0", marginBottom: 6 }}>
                <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Start from
                  <input
                    type="number"
                    min={0}
                    max={2359}
                    step={1}
                    value={optimizerActiveStartFrom}
                    onChange={(e) => setOptimizerActiveStartFrom(Math.max(0, Math.min(2359, Number(e.target.value || 930))))}
                    style={{ width: 80 }}
                  />
                </label>
                <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Start to
                  <input
                    type="number"
                    min={0}
                    max={2359}
                    step={1}
                    value={optimizerActiveStartTo}
                    onChange={(e) => setOptimizerActiveStartTo(Math.max(0, Math.min(2359, Number(e.target.value || 1000))))}
                    style={{ width: 80 }}
                  />
                </label>
                <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Start step (min)
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={optimizerActiveStartStepMinutes}
                    onChange={(e) => setOptimizerActiveStartStepMinutes(Math.max(1, Number(e.target.value || 15)))}
                    style={{ width: 80 }}
                    disabled={optimizerStepMode === "consistent"}
                  />
                </label>
              </div>
              <div className="filter-row" style={{ borderBottom: "none", padding: "0", marginBottom: 6 }}>
                <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  End from
                  <input
                    type="number"
                    min={0}
                    max={2359}
                    step={1}
                    value={optimizerActiveEndFrom}
                    onChange={(e) => setOptimizerActiveEndFrom(Math.max(0, Math.min(2359, Number(e.target.value || 1500))))}
                    style={{ width: 80 }}
                  />
                </label>
                <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  End to
                  <input
                    type="number"
                    min={0}
                    max={2359}
                    step={1}
                    value={optimizerActiveEndTo}
                    onChange={(e) => setOptimizerActiveEndTo(Math.max(0, Math.min(2359, Number(e.target.value || 1600))))}
                    style={{ width: 80 }}
                  />
                </label>
                <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  End step (min)
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={optimizerActiveEndStepMinutes}
                    onChange={(e) => setOptimizerActiveEndStepMinutes(Math.max(1, Number(e.target.value || 15)))}
                    style={{ width: 80 }}
                    disabled={optimizerStepMode === "consistent"}
                  />
                </label>
              </div>
              <div className="filter-row" style={{ borderBottom: "none", padding: "0", marginBottom: 6 }}>
                <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Mix size
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={optimizerMixSize}
                    onChange={(e) => setOptimizerMixSize(Math.max(1, Number(e.target.value || 3)))}
                    style={{ width: 70 }}
                  />
                </label>
                <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Drawdown weight
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={optimizerDrawdownWeight}
                    onChange={(e) => setOptimizerDrawdownWeight(Math.max(0, Number(e.target.value || 1)))}
                    style={{ width: 70 }}
                  />
                </label>
                <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Loss weight
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={optimizerLossWeight}
                    onChange={(e) => setOptimizerLossWeight(Math.max(0, Number(e.target.value || 1)))}
                    style={{ width: 70 }}
                  />
                </label>
              </div>
              <div className="filter-row" style={{ borderBottom: "none", padding: "0", marginBottom: 6 }}>
                <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6, width: "100%" }}>
                  Assets (optional, comma-separated)
                  <input
                    type="text"
                    placeholder="All assets, or e.g. XRP,BTC,ETH"
                    value={optimizerAssetSelection}
                    onChange={(e) => setOptimizerAssetSelection(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </label>
              </div>
              <button type="button" disabled={optimizing || running || batchRunning} onClick={optimizeScenarios}>
                {optimizing ? "Optimizing..." : "Run Optimize"}
              </button>
              <div className="sub" style={{ marginTop: 6 }}>
                Progress: {optimizationProgress.done}/{optimizationProgress.total}{" "}
                {optimizationProgress.current ? `· ${optimizationProgress.current}` : ""}
              </div>
              {bestOptimizationScenario ? (
                <>
                  <div className="sub" style={{ marginTop: 6 }}>
                    Best RR (all assets): {bestOptimizationScenario.rr.toFixed(2)} · Score:{" "}
                    {bestOptimizationScenario.score.toFixed(3)}
                  </div>
                  <div className="sub">
                    Best active window (ET): {bestOptimizationScenario.activeStartHHMM}-
                    {bestOptimizationScenario.activeEndHHMM}
                  </div>
                  <div className="sub">
                    Scenario rating: {bestOptimizationScenario.rating.toFixed(1)}/100 · Profit rank:{" "}
                    {bestOptimizationScenario.profitRankScore.toFixed(1)} · Drawdown rank:{" "}
                    {bestOptimizationScenario.drawdownRankScore.toFixed(1)}
                  </div>
                  <div className="sub">
                    All-asset runs: {bestOptimizationScenario.runCount} · Total R:{" "}
                    {bestOptimizationScenario.totalR.toFixed(3)}R
                  </div>
                  <div className="sub">
                    Avg R/run: {bestOptimizationScenario.avgRPerRun.toFixed(3)}R · Avg DD:{" "}
                    {bestOptimizationScenario.avgDrawdown.toFixed(4)} · Neg run rate:{" "}
                    {(bestOptimizationScenario.negativeRunRate * 100).toFixed(2)}%
                  </div>
                  <div className="sub">
                    Best RR asset mix ({bestRrAssetMix.length}):{" "}
                    {bestRrAssetMix.map((row) => row.symbol).join(", ") || "--"}
                  </div>
                </>
              ) : (
                <div className="sub" style={{ marginTop: 6 }}>
                  Run optimization to find best RR first, then best asset mix for that RR.
                </div>
              )}
            </div>
          </section>
        )}

        {strategyId === "orb-avwap-930" && (
          <section className="grid2">
            <div className="card table-card">
              <h3>Optimize Scenarios</h3>
              {optimizationResults.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>RR</th>
                      <th>Start (ET HHMM)</th>
                      <th>End (ET HHMM)</th>
                      <th>Runs (All Assets)</th>
                      <th>Total R</th>
                      <th>Avg R/Run</th>
                      <th>Avg DD</th>
                      <th>Neg Run %</th>
                      <th>Rating</th>
                      <th>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {optimizationResults
                      .slice()
                      .sort((a, b) => b.score - a.score)
                      .map((row) => (
                        <tr key={`opt-${row.rr}-${row.activeStartHHMM}-${row.activeEndHHMM}`}>
                          <td>{row.rr.toFixed(2)}</td>
                          <td>{row.activeStartHHMM}</td>
                          <td>{row.activeEndHHMM}</td>
                          <td>{row.runCount}</td>
                          <td>{row.totalR.toFixed(3)}R</td>
                          <td>{row.avgRPerRun.toFixed(3)}R</td>
                          <td>{row.avgDrawdown.toFixed(4)}</td>
                          <td>{(row.negativeRunRate * 100).toFixed(2)}%</td>
                          <td>{row.rating.toFixed(1)}</td>
                          <td>{row.score.toFixed(3)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : (
                <div className="sub">No optimize runs yet.</div>
              )}
            </div>
            <div className="card">
              <h3>Optimize Leaderboards</h3>
              <div className="sub">
                Top by balanced score:{" "}
                {optimizationLeaderboards.byScore
                  .map((x) => `${x.rr.toFixed(2)}@${x.activeStartHHMM}-${x.activeEndHHMM}`)
                  .join(", ") || "--"}
              </div>
              <div className="sub">
                Top by profit (Total R):{" "}
                {optimizationLeaderboards.byProfit
                  .map((x) => `${x.rr.toFixed(2)}@${x.activeStartHHMM}-${x.activeEndHHMM}`)
                  .join(", ") || "--"}
              </div>
              <div className="sub">
                Top by lowest drawdown:{" "}
                {optimizationLeaderboards.byDrawdown
                  .map((x) => `${x.rr.toFixed(2)}@${x.activeStartHHMM}-${x.activeEndHHMM}`)
                  .join(", ") || "--"}
              </div>
              <div className="sub">
                Balanced positive alternatives:{" "}
                {optimizationLeaderboards.balancedAlt
                  .map((x) => `${x.rr.toFixed(2)}@${x.activeStartHHMM}-${x.activeEndHHMM}`)
                  .join(", ") || "--"}
              </div>
              <div className="sub">
                Variables optimized: `rr`, `activeStartHHMM`, `activeEndHHMM` (per-variable steps or consistent samples).
              </div>
            </div>
          </section>
        )}

        <section className="grid2">
          <div className="card table-card">
            <h3>Batch Runner</h3>
            <div className="sub">
              Scope: sessions filtered by date ({backtestDateFilter || "all dates"}) x all symbols per session
            </div>
            <div className="sub">
              Progress: {batchProgress.done}/{batchProgress.total} {batchProgress.current ? `· ${batchProgress.current}` : ""}
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
                onChange={(e) => setAssetSearch(e.target.value)}
              />
              <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Min runs
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={assetMinRuns}
                  onChange={(e) => setAssetMinRuns(Math.max(1, Number(e.target.value || 1)))}
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
                  onChange={(e) => setAssetTopN(Math.max(1, Number(e.target.value || 3)))}
                  style={{ width: 70 }}
                />
              </label>
              <button type="button" onClick={() => selectTopAssets(assetTopN)}>
                Select Top N
              </button>
              <button type="button" onClick={() => setSelectedAssetSymbols([])}>
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
                          onChange={() => toggleAssetSelection(row.symbol)}
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
            <div className="sub" style={{ marginTop: 8 }}>
              Sorted by Total R descending. Use filters and "Select Top N" to test best combinations quickly.
            </div>
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
                    <tr key={`${trade.openedAtMs}-${trade.closedAtMs}-${idx}`}>
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
            <h3>Data Provenance ({timeframe})</h3>
            <div className="sub">history: {sourceStats.history}</div>
            <div className="sub">live: {sourceStats.live}</div>
            <div className="sub">mixed: {sourceStats.mixed}</div>
            <div className="sub">gap_fill source: {sourceStats.gap_fill}</div>
            <div className="sub">is_gap_fill flag count: {sourceStats.gapFill}</div>
          </div>
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
                      Active window (ET): {Number(runResult.meta.params?.activeStartHHMM || optimizerSettings.activeStartHHMM)}-
                      {Number(runResult.meta.params?.activeEndHHMM || optimizerSettings.activeEndHHMM)}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="empty">No run yet.</div>
            )}
          </div>
        </section>

        <section className="grid2">
          <div className="card table-card">
            <h3>
              Import Source Sessions ({sourcePagination.total}) · page {sourcePagination.page}/
              {sourcePagination.totalPages}
            </h3>
            <div className="filter-row">
              <input type="date" value={sourceDateFilter} onChange={(e) => setSourceDateFilter(e.target.value)} />
              <button type="button" onClick={() => void refreshSourceSessions(1, sourceDateFilter)}>
                Filter
              </button>
              <button type="button" onClick={() => void refreshSourceSessions(1, "")}>
                Clear
              </button>
            </div>
            {importFeedback ? <div className="sub">{importFeedback}</div> : null}
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>ID</th>
                  <th>Candles</th>
                  <th>Import</th>
                </tr>
              </thead>
              <tbody>
                {sourceSessions.map((session) => (
                  <tr key={session.id}>
                    <td>{formatDateTime(session.startedAtMs)}</td>
                    <td>{session.id}</td>
                    <td>{session.candleCount}</td>
                    <td>
                      <button
                        type="button"
                        disabled={Boolean(importingId)}
                        onClick={() => void handleImportSession(session.id)}
                      >
                        {importingId === session.id ? "Importing..." : "Import"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="pager">
              <button
                type="button"
                disabled={sourcePagination.page <= 1}
                onClick={() => void refreshSourceSessions(sourcePagination.page - 1, sourceDateFilter)}
              >
                Prev
              </button>
              <button
                type="button"
                disabled={sourcePagination.page >= sourcePagination.totalPages}
                onClick={() => void refreshSourceSessions(sourcePagination.page + 1, sourceDateFilter)}
              >
                Next
              </button>
            </div>
          </div>
          <div className="card table-card">
            <h3>Session Trades ({sessionTrades.length})</h3>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Coin</th>
                  <th>Px</th>
                  <th>Sz</th>
                  <th>PnL</th>
                </tr>
              </thead>
              <tbody>
                {sessionTrades.slice(0, 30).map((trade, idx) => (
                  <tr key={`${trade.time}-${idx}`}>
                    <td>{new Date(trade.time).toLocaleTimeString()}</td>
                    <td>{trade.coin}</td>
                    <td>{trade.px.toFixed(4)}</td>
                    <td>{trade.sz.toFixed(4)}</td>
                    <td>{trade.closedPnl.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card table-card">
            <h3>Scanner Metadata ({scannerMetadata.length})</h3>
            <table>
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Source</th>
                  <th>Imported</th>
                </tr>
              </thead>
              <tbody>
                {scannerMetadata.slice(0, 30).map((item, idx) => (
                  <tr key={`${item.tool}-${item.sourceId}-${idx}`}>
                    <td>{item.tool}</td>
                    <td>{item.sourceId || "--"}</td>
                    <td>{formatDateTime(item.importedAtMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
