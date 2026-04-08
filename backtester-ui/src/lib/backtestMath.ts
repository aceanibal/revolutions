import type {
  BacktestRunResult,
  Candle,
  IndicatorSeries,
  OptimizationScenarioResult,
  StrategyId,
  Timeframe
} from "../types";

/** Match backtester/scanner/sessionScanner.js: anchor must be late enough to include lookback bars. */
export function resolveScannerEffectiveAnchorTsMs(
  candles: Candle[],
  requestedAnchorTsMs: number,
  timeframe: Timeframe,
  lookbackHours: number,
  currentWindowHours: number
): number {
  const barsPerHour = timeframe === "5m" ? 12 : 60;
  const lookbackBars = Math.max(2, Math.floor(Math.max(1, lookbackHours) * barsPerHour));
  const windowBars = Math.max(1, Math.floor(Math.max(1, currentWindowHours) * barsPerHour));
  const minSamplesForMetrics = windowBars * 2;
  if (!Array.isArray(candles) || candles.length === 0 || !Number.isFinite(requestedAnchorTsMs) || requestedAnchorTsMs <= 0) {
    return requestedAnchorTsMs;
  }
  const sorted = [...candles].sort((a, b) => Number(a.timeMs || 0) - Number(b.timeMs || 0));
  const maxLastTs = Number(sorted[sorted.length - 1]?.timeMs || 0);
  if (!Number.isFinite(maxLastTs) || maxLastTs <= 0) return requestedAnchorTsMs;
  if (sorted.length < minSamplesForMetrics || sorted.length < lookbackBars) {
    return Math.min(requestedAnchorTsMs, maxLastTs);
  }
  const minAnchorTs = Number(sorted[lookbackBars - 1]?.timeMs || 0);
  let effective = Math.max(requestedAnchorTsMs, minAnchorTs);
  effective = Math.min(effective, maxLastTs);
  return effective;
}

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

/** Win / loss / flat from realized dollar PnL. */
export function tradeOutcomeFromPnl(pnl: number): "WIN" | "LOSS" | "FLAT" {
  if (!Number.isFinite(pnl)) return "FLAT";
  if (pnl > 0) return "WIN";
  if (pnl < 0) return "LOSS";
  return "FLAT";
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
  optimizerSettings: {
    takeProfitRR: number;
    vwapStartHHMM: number;
    activeStartHHMM: number;
    activeEndHHMM: number;
    dojiBodyToRangeMax: number;
    stopLossSource: "open" | "avwap" | "extreme" | "low" | "high";
    ignoreWeekends: boolean;
    ignoreUsHolidays: boolean;
  }
): Record<StrategyId, Record<string, unknown>> {
  const baseOrbParams = {
    rr: Number(optimizerSettings.takeProfitRR),
    anchorHHMM: Number(optimizerSettings.vwapStartHHMM),
    activeStartHHMM: Number(optimizerSettings.activeStartHHMM),
    activeEndHHMM: Number(optimizerSettings.activeEndHHMM),
    dojiBodyToRangeMax: Number(optimizerSettings.dojiBodyToRangeMax),
    ignoreWeekends: Boolean(optimizerSettings.ignoreWeekends),
    ignoreUsHolidays: Boolean(optimizerSettings.ignoreUsHolidays)
  };
  return {
    noop: {},
    "simple-momentum": {},
    "orb-avwap-930": baseOrbParams,
    "orb-avwap-930-open-avwap-sl": {
      ...baseOrbParams,
      stopLossSource: optimizerSettings.stopLossSource
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

export function displayMetricsFromTrades(
  trades: BacktestRunResult["trades"]
): { tradeCount: number; winRate: number; maxDrawdown: number } {
  const tradeCount = trades.length;
  if (tradeCount === 0) return { tradeCount: 0, winRate: 0, maxDrawdown: 0 };

  const winners = trades.filter((t) => t.pnl > 0).length;
  const winRate = winners / tradeCount;

  let peak = 0;
  let cumPnl = 0;
  let maxDrawdown = 0;
  for (const t of trades) {
    const r = tradePnlInR(t);
    cumPnl += r ?? 0;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  return { tradeCount, winRate, maxDrawdown };
}

export function capTradesPerCalendarDay(
  trades: BacktestRunResult["trades"],
  maxPerDay: number
): BacktestRunResult["trades"] {
  const counts = new Map<string, number>();
  return trades.filter((t) => {
    const { dayKey } = etParts(t.openedAtMs);
    const prev = counts.get(dayKey) ?? 0;
    if (prev >= maxPerDay) return false;
    counts.set(dayKey, prev + 1);
    return true;
  });
}

/** ET calendar day, first open only if it wins (pnl > 0); else first open + one retry (second open). Trades should be sorted by `openedAtMs`. */
export function applyWinStopOneRetryPerDay(trades: BacktestRunResult["trades"]): BacktestRunResult["trades"] {
  if (trades.length === 0) return [];
  const byDay = new Map<string, BacktestRunResult["trades"]>();
  for (const t of trades) {
    const { dayKey } = etParts(t.openedAtMs);
    const list = byDay.get(dayKey);
    if (list) list.push(t);
    else byDay.set(dayKey, [t]);
  }
  const out: BacktestRunResult["trades"] = [];
  for (const dayTrades of byDay.values()) {
    const first = dayTrades[0];
    out.push(first);
    if (Number(first.pnl) > 0) continue;
    if (dayTrades.length > 1) out.push(dayTrades[1]);
  }
  return out;
}

export function runResultTradeCount(result: BacktestRunResult | null): number {
  return result?.trades?.length || 0;
}

const ET_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function etParts(ms: number): { dayKey: string; hhmm: number } {
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
  const dayKey = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { dayKey, hhmm: hour * 100 + minute };
}

export function normalizeEpochMs(value: unknown): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Heuristic: unix seconds are ~1e9-1e10, unix ms are ~1e12+.
  return n < 1e12 ? Math.floor(n * 1000) : Math.floor(n);
}

export function buildTradeReplayCandlesWindow(
  candles: Candle[],
  trade: { openedAtMs: number; closedAtMs: number } | null,
  contextCandles = 10
): Candle[] {
  if (!trade || candles.length === 0) return candles;
  const openedAtMs = normalizeEpochMs(trade.openedAtMs);
  const closedAtMs = normalizeEpochMs(trade.closedAtMs);
  if (!openedAtMs || !closedAtMs) return candles;
  const findClosestIndex = (targetMs: number) => {
    let closestIdx = -1;
    let closestDiff = Number.POSITIVE_INFINITY;
    for (let i = 0; i < candles.length; i += 1) {
      const diff = Math.abs(Number(candles[i]?.timeMs || 0) - targetMs);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIdx = i;
      }
    }
    return closestIdx;
  };
  const openIdx = findClosestIndex(openedAtMs);
  const closeIdx = findClosestIndex(closedAtMs);
  if (openIdx < 0 && closeIdx < 0) return candles;
  const span = Math.max(0, Math.floor(contextCandles));
  const includeIndexes = new Set<number>();
  const includeRange = (centerIdx: number) => {
    if (centerIdx < 0) return;
    const start = Math.max(0, centerIdx - span);
    const end = Math.min(candles.length - 1, centerIdx + span);
    for (let i = start; i <= end; i += 1) includeIndexes.add(i);
  };
  includeRange(openIdx);
  includeRange(closeIdx);
  return candles.filter((_, idx) => includeIndexes.has(idx));
}

export function buildTradeOneMinuteCandlesCsv(
  candles: Candle[],
  trade: { openedAtMs: number; closedAtMs: number } | null
): string {
  const headers = ["timeMs", "open", "high", "low", "close", "volume", "source", "isGapFill"];
  const lines: string[] = [headers.join(",")];
  if (!trade || candles.length === 0) return `\uFEFF${lines.join("\n")}`;
  const openedAtMs = normalizeEpochMs(trade.openedAtMs);
  const closedAtMs = normalizeEpochMs(trade.closedAtMs);
  if (!openedAtMs || !closedAtMs) {
    return `\uFEFF${lines.join("\n")}`;
  }
  const from = Math.min(openedAtMs, closedAtMs);
  const to = Math.max(openedAtMs, closedAtMs);
  for (const candle of candles) {
    const timeMs = Number(candle.timeMs || 0);
    if (!Number.isFinite(timeMs) || timeMs < from || timeMs > to) continue;
    const row = [
      String(timeMs),
      String(Number(candle.open || 0)),
      String(Number(candle.high || 0)),
      String(Number(candle.low || 0)),
      String(Number(candle.close || 0)),
      String(Number(candle.volume || 0)),
      String(candle.source || ""),
      candle.isGapFill ? "1" : "0"
    ];
    lines.push(row.map((cell) => csvEscapeCell(cell)).join(","));
  }
  return `\uFEFF${lines.join("\n")}`;
}

export function buildReplayIndicatorSeries(input: {
  strategyId: string;
  strategyParams?: Record<string, unknown> | null;
  allCandles: Candle[];
  visibleCandles: Candle[];
}): IndicatorSeries[] {
  const strategyId = String(input.strategyId || "");
  if (strategyId !== "orb-avwap-930" && strategyId !== "orb-avwap-930-open-avwap-sl") return [];
  if (input.allCandles.length === 0 || input.visibleCandles.length === 0) return [];
  const anchorHHMM = Number(input.strategyParams?.anchorHHMM || 930);
  const sessionEndHHMM = Number(input.strategyParams?.sessionEndHHMM || 1600);
  let dayKey = "";
  let cumulativePV = 0;
  let cumulativeV = 0;
  const allValues: Array<{ timeMs: number; value: number }> = [];
  for (const candle of input.allCandles) {
    const timeMs = Number(candle.timeMs || 0);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    if (!Number.isFinite(timeMs) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) continue;
    const et = etParts(timeMs);
    if (et.dayKey !== dayKey) {
      dayKey = et.dayKey;
      cumulativePV = 0;
      cumulativeV = 0;
    }
    if (et.hhmm < anchorHHMM || et.hhmm >= sessionEndHHMM) continue;
    const volume = Number.isFinite(Number(candle.volume)) ? Number(candle.volume) : 0;
    const typical = (high + low + close) / 3;
    cumulativePV += typical * volume;
    cumulativeV += volume;
    const anchoredVwap = cumulativeV > 0 ? cumulativePV / cumulativeV : typical;
    if (!Number.isFinite(anchoredVwap)) continue;
    allValues.push({ timeMs, value: anchoredVwap });
  }
  const visibleFrom = Number(input.visibleCandles[0]?.timeMs || 0);
  const visibleTo = Number(input.visibleCandles[input.visibleCandles.length - 1]?.timeMs || 0);
  return [
    {
      key: "orb-avwap",
      title: "AVWAP",
      color: "#7c3aed",
      values: allValues.filter((point) => point.timeMs >= visibleFrom && point.timeMs <= visibleTo)
    }
  ].filter((series) => series.values.length > 0);
}

function csvEscapeCell(s: string): string {
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Pull one feature-set payload from `candle.features` shape stored on trades. */
export function pickNestedScannerPayload(
  features: Record<string, Record<string, unknown>> | null | undefined,
  featureSet: string
): Record<string, unknown> | null {
  if (!features || typeof features !== "object") return null;
  const inner = features[featureSet];
  if (!inner || typeof inner !== "object") return null;
  return inner as Record<string, unknown>;
}

/** Keep trades whose entry scanner payload has `btcCorr` within optional inclusive bounds. */
export function filterTradesByScannerEntryBtcCorr(
  trades: BacktestRunResult["trades"],
  featureSet: string,
  bounds: { min?: number; max?: number }
): BacktestRunResult["trades"] {
  const setName = String(featureSet || "rvol-scanner").trim() || "rvol-scanner";
  const hasMin = Number.isFinite(bounds.min);
  const hasMax = Number.isFinite(bounds.max);
  if (!hasMin && !hasMax) return trades;
  return trades.filter((trade) => {
    const p = pickNestedScannerPayload(trade.scannerAtEntry, setName);
    const rho = Number(p?.btcCorr);
    if (!Number.isFinite(rho)) return false;
    if (hasMin && rho < (bounds.min as number)) return false;
    if (hasMax && rho > (bounds.max as number)) return false;
    return true;
  });
}

/** CSV for spreadsheet import; includes ET day, flattened scanner columns, and full JSON snapshots. */
export function buildSimulatedTradesCsv(
  trades: BacktestRunResult["trades"],
  meta: BacktestRunResult["meta"]
): string {
  const params = meta.params || {};
  const scannerSet = String(params.scannerFeatureSet || "rvol-scanner").trim() || "rvol-scanner";
  const headers = [
    "sessionId",
    "symbol",
    "timeframe",
    "strategyId",
    "tradingDayEt",
    "openedAtMs",
    "closedAtMs",
    "side",
    "size",
    "entryPx",
    "exitPx",
    "pnl",
    "winLoss",
    "stopLoss",
    "takeProfit",
    "avwapAtEntry",
    "scannerEntry_rvol",
    "scannerEntry_btcCorr",
    "scannerEntry_price",
    "scannerExit_rvol",
    "scannerExit_btcCorr",
    "scannerExit_price",
    "scannerAtEntryJson",
    "scannerAtExitJson"
  ];
  const lines: string[] = [headers.join(",")];
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? String(v) : "";

  for (const t of trades) {
    const entryP = pickNestedScannerPayload(t.scannerAtEntry, scannerSet);
    const exitP = pickNestedScannerPayload(t.scannerAtExit, scannerSet);
    const row = [
      meta.sessionId,
      meta.symbol,
      meta.timeframe,
      meta.strategyId,
      String(t.tradingDayEt ?? ""),
      String(t.openedAtMs),
      String(t.closedAtMs),
      String(t.side),
      String(t.size),
      String(t.entryPx),
      String(t.exitPx),
      String(t.pnl),
      tradeOutcomeFromPnl(Number(t.pnl)),
      t.stopLoss == null ? "" : String(t.stopLoss),
      t.takeProfit == null ? "" : String(t.takeProfit),
      num(t.avwapAtEntry),
      num(entryP?.rvol),
      num(entryP?.btcCorr),
      num(entryP?.price),
      num(exitP?.rvol),
      num(exitP?.btcCorr),
      num(exitP?.price),
      JSON.stringify(t.scannerAtEntry ?? null),
      JSON.stringify(t.scannerAtExit ?? null)
    ];
    lines.push(row.map((cell) => csvEscapeCell(cell)).join(","));
  }
  return `\uFEFF${lines.join("\n")}`;
}

/** Session export: one row per 1m candle inside the same drilldown window used by trade replay. */
export function buildSimulatedTradesWithOneMinuteCandlesCsv(input: {
  trades: BacktestRunResult["trades"];
  meta: BacktestRunResult["meta"];
  tradeWindowCandles: Candle[];
  oneMinuteCandles: Candle[];
  contextCandles?: number;
}): string {
  const { trades, meta, tradeWindowCandles, oneMinuteCandles } = input;
  const contextCandles = Math.max(0, Math.floor(Number(input.contextCandles ?? 10)));
  const params = meta.params || {};
  const scannerSet = String(params.scannerFeatureSet || "rvol-scanner").trim() || "rvol-scanner";
  const headers = [
    "sessionId",
    "symbol",
    "timeframe",
    "strategyId",
    "tradeIndex",
    "tradingDayEt",
    "openedAtMs",
    "closedAtMs",
    "side",
    "size",
    "entryPx",
    "exitPx",
    "pnl",
    "winLoss",
    "stopLoss",
    "takeProfit",
    "avwapAtEntry",
    "scannerEntry_rvol",
    "scannerEntry_btcCorr",
    "scannerEntry_price",
    "scannerExit_rvol",
    "scannerExit_btcCorr",
    "scannerExit_price",
    "scannerAtEntryJson",
    "scannerAtExitJson",
    "tradeWindowFromMs",
    "tradeWindowToMs",
    "candle1mTimeMs",
    "candle1mOpen",
    "candle1mHigh",
    "candle1mLow",
    "candle1mClose",
    "candle1mVolume",
    "candle1mSource",
    "candle1mIsGapFill"
  ];
  const lines: string[] = [headers.join(",")];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "");

  for (let tradeIndex = 0; tradeIndex < trades.length; tradeIndex += 1) {
    const trade = trades[tradeIndex];
    const entryP = pickNestedScannerPayload(trade.scannerAtEntry, scannerSet);
    const exitP = pickNestedScannerPayload(trade.scannerAtExit, scannerSet);
    const tradeWindow = buildTradeReplayCandlesWindow(tradeWindowCandles, trade, contextCandles);
    const fromMs = Number(tradeWindow[0]?.timeMs || 0);
    const toMs = Number(tradeWindow[tradeWindow.length - 1]?.timeMs || 0);
    const oneMinuteInWindow =
      fromMs > 0 && toMs > 0
        ? oneMinuteCandles.filter((candle) => {
            const t = Number(candle.timeMs || 0);
            return Number.isFinite(t) && t >= fromMs && t <= toMs;
          })
        : [];
    const base = [
      meta.sessionId,
      meta.symbol,
      meta.timeframe,
      meta.strategyId,
      String(tradeIndex),
      String(trade.tradingDayEt ?? ""),
      String(trade.openedAtMs),
      String(trade.closedAtMs),
      String(trade.side),
      String(trade.size),
      String(trade.entryPx),
      String(trade.exitPx),
      String(trade.pnl),
      tradeOutcomeFromPnl(Number(trade.pnl)),
      trade.stopLoss == null ? "" : String(trade.stopLoss),
      trade.takeProfit == null ? "" : String(trade.takeProfit),
      num(trade.avwapAtEntry),
      num(entryP?.rvol),
      num(entryP?.btcCorr),
      num(entryP?.price),
      num(exitP?.rvol),
      num(exitP?.btcCorr),
      num(exitP?.price),
      JSON.stringify(trade.scannerAtEntry ?? null),
      JSON.stringify(trade.scannerAtExit ?? null),
      fromMs > 0 ? String(fromMs) : "",
      toMs > 0 ? String(toMs) : ""
    ];
    if (oneMinuteInWindow.length === 0) {
      lines.push([...base, "", "", "", "", "", "", "", ""].map((cell) => csvEscapeCell(cell)).join(","));
      continue;
    }
    for (const candle of oneMinuteInWindow) {
      const row = [
        ...base,
        String(Number(candle.timeMs || 0)),
        String(Number(candle.open || 0)),
        String(Number(candle.high || 0)),
        String(Number(candle.low || 0)),
        String(Number(candle.close || 0)),
        String(Number(candle.volume || 0)),
        String(candle.source || ""),
        candle.isGapFill ? "1" : "0"
      ];
      lines.push(row.map((cell) => csvEscapeCell(cell)).join(","));
    }
  }
  return `\uFEFF${lines.join("\n")}`;
}

const ONE_MINUTE_EXPORT_HOURS_AFTER_OPEN = 11;
const ONE_MINUTE_EXPORT_MS = ONE_MINUTE_EXPORT_HOURS_AFTER_OPEN * 60 * 60 * 1000;

export function buildSimulatedTradesWithOneMinuteCandlesJson(input: {
  trades: BacktestRunResult["trades"];
  meta: BacktestRunResult["meta"];
  tradeWindowCandles: Candle[];
  oneMinuteCandles: Candle[];
  contextCandles?: number;
}): string {
  const { trades, meta, tradeWindowCandles, oneMinuteCandles } = input;
  const contextCandles = Math.max(0, Math.floor(Number(input.contextCandles ?? 10)));
  const exportedAtMs = Date.now();
  const payload = {
    exportedAtMs,
    exportType: "sim-trades-with-1m-candles-and-scanner",
    contextCandles,
    oneMinuteExport: {
      anchor: "openedAtMs" as const,
      hoursAfterOpen: ONE_MINUTE_EXPORT_HOURS_AFTER_OPEN,
      description:
        "1m candles from trade open through 11 hours after open (not clipped at trade close)."
    },
    meta,
    trades: trades.map((trade, tradeIndex) => {
      const tradeWindow = buildTradeReplayCandlesWindow(tradeWindowCandles, trade, contextCandles);
      const twFromMs = Number(tradeWindow[0]?.timeMs || 0);
      const twToMs = Number(tradeWindow[tradeWindow.length - 1]?.timeMs || 0);
      const openMs = normalizeEpochMs(trade.openedAtMs);
      const oneMinuteToMs = openMs > 0 ? openMs + ONE_MINUTE_EXPORT_MS : 0;
      const oneMinuteInRange =
        openMs > 0 && oneMinuteToMs > openMs
          ? oneMinuteCandles
              .filter((candle) => {
                const t = Number(candle.timeMs || 0);
                return Number.isFinite(t) && t >= openMs && t <= oneMinuteToMs;
              })
              .map((candle) => ({
                timeMs: Number(candle.timeMs || 0),
                open: Number(candle.open || 0),
                high: Number(candle.high || 0),
                low: Number(candle.low || 0),
                close: Number(candle.close || 0),
                volume: Number(candle.volume || 0),
                source: candle.source ?? null,
                isGapFill: Boolean(candle.isGapFill),
                features: candle.features ?? null
              }))
          : [];
      return {
        tradeIndex,
        trade,
        scannerAtEntry: trade.scannerAtEntry ?? null,
        scannerAtExit: trade.scannerAtExit ?? null,
        tradeWindow: {
          timeframe: meta.timeframe,
          fromMs: twFromMs || null,
          toMs: twToMs || null,
          candleCount: tradeWindow.length
        },
        oneMinuteRange: {
          fromMs: openMs || null,
          toMs: oneMinuteToMs || null,
          anchor: "openedAtMs" as const,
          hoursAfterOpen: ONE_MINUTE_EXPORT_HOURS_AFTER_OPEN
        },
        oneMinuteCandles: oneMinuteInRange
      };
    })
  };
  return JSON.stringify(payload, null, 2);
}
