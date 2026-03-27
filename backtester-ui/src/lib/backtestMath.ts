import type { BacktestRunResult, OptimizationScenarioResult, StrategyId } from "../types";

export function hhmmToMinutes(hhmm: number): number {
  const clean = Math.max(0, Math.min(2359, Number(hhmm || 0)));
  const hh = Math.floor(clean / 100);
  const mm = clean % 100;
  return hh * 60 + mm;
}

export function minutesToHHMM(minutes: number): number {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.floor(Number(minutes || 0))));
  const hh = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return hh * 100 + mm;
}

export function rangeByStep(start: number, end: number, step: number, precision = 4): number[] {
  const safeStep = Math.max(Number.EPSILON, Number(step || 0));
  const safeStart = Number(start || 0);
  const safeEnd = Number(end || safeStart);
  const out: number[] = [];
  for (let value = safeStart; value <= safeEnd + Number.EPSILON; value += safeStep) {
    out.push(Number(value.toFixed(precision)));
  }
  return out;
}

export function rangeBySamples(start: number, end: number, samples: number, precision = 4): number[] {
  const n = Math.max(1, Math.floor(Number(samples || 1)));
  if (n === 1) return [Number(start.toFixed(precision))];
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    out.push(Number((start + (end - start) * t).toFixed(precision)));
  }
  return Array.from(new Set(out));
}

export function tradeRiskPerUnit(side: string, entryPx: number, stopLoss?: number | null): number {
  if (!Number.isFinite(entryPx) || !Number.isFinite(stopLoss)) return 0;
  if (String(side || "").toLowerCase() === "short") return Number(stopLoss) - Number(entryPx);
  return Number(entryPx) - Number(stopLoss);
}

export function tradePnlInR(trade: {
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

export function runTotalR(
  trades: Array<{ side: string; entryPx: number; stopLoss?: number | null; size: number; pnl: number }>
): number {
  return trades.reduce((acc, trade) => {
    const r = tradePnlInR(trade);
    return acc + (r ?? 0);
  }, 0);
}

export function formatDateTime(ms: number): string {
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

export function formatDuration(startedAtMs: number, endedAtMs: number | null): string {
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) return "--";
  const endMs = Number.isFinite(endedAtMs || 0) && (endedAtMs || 0) > 0 ? Number(endedAtMs) : Date.now();
  const diffSec = Math.max(0, Math.floor((endMs - startedAtMs) / 1000));
  const hours = Math.floor(diffSec / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export function buildStrategyVariables(
  optimizerSettings: { takeProfitRR: number; vwapStartHHMM: number; activeStartHHMM: number; activeEndHHMM: number }
): Record<StrategyId, Record<string, unknown>> {
  return {
    noop: {},
    "simple-momentum": {},
    "orb-avwap-930": {
      rr: Number(optimizerSettings.takeProfitRR),
      anchorHHMM: Number(optimizerSettings.vwapStartHHMM),
      activeStartHHMM: Number(optimizerSettings.activeStartHHMM),
      activeEndHHMM: Number(optimizerSettings.activeEndHHMM)
    }
  };
}

export function buildOptimizationLeaderboards(optimizationResults: OptimizationScenarioResult[]) {
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
}

export function runResultTradeCount(result: BacktestRunResult | null): number {
  return result?.trades?.length || 0;
}
