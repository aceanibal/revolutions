export type Timeframe = "1m" | "5m";
export type ReplayMode = "tick" | "candle" | "mixed";
export type StrategyId =
  | "noop"
  | "simple-momentum"
  | "orb-avwap-930"
  | "orb-avwap-930-open-avwap-sl";
export type TickPolicy = "real_only" | "real_then_synthetic" | "synthetic_only";
export type SessionType = "live" | "historical";

export interface Candle {
  timeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source?: "history" | "live" | "gap_fill" | "mixed";
  isGapFill?: boolean;
  features?: Record<string, Record<string, unknown>>;
}

export interface IndicatorPoint {
  timeMs: number;
  value: number;
}

export interface IndicatorSeries {
  key: string;
  title: string;
  color: string;
  values: IndicatorPoint[];
}

export interface GapRange {
  fromTimeMs: number;
  toTimeMs: number;
  missingBuckets: number;
}

export interface SavedSession {
  id: string;
  sessionType: SessionType;
  status: string;
  startedAtMs: number;
  endedAtMs: number | null;
  breakReason: string | null;
  assetCount: number;
  candleCount: number;
  notes: string;
  tradeCount: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SessionTrade {
  mode: string;
  coin: string;
  side: string;
  dir: string;
  px: number;
  sz: number;
  time: number;
  fee: number;
  feeToken: string;
  closedPnl: number;
  crossed: boolean;
  oid: number | null;
  tid: number | null;
}

export interface Tick {
  symbol: string;
  ts: number;
  price: number;
  size: number;
  source: string;
}

export interface SessionSnapshot {
  sessionInfo: {
    id: string;
    status: string;
    startedAtMs: number;
    endedAtMs: number | null;
    assetCount: number;
    candleCount: number;
    breakReason: string | null;
  };
  symbol: string;
  candlesByTimeframe: Record<Timeframe, Candle[]>;
  gapsByTimeframe: Record<Timeframe, GapRange[]>;
}

export interface BacktestRunResult {
  version: number;
  createdAtMs: number;
  meta: {
    sessionId: string;
    symbol: string;
    timeframe: string;
    mode: string;
    strategyId: string;
    params: Record<string, unknown>;
    eventCount: number;
    eventStats: {
      realTickEvents: number;
      syntheticTickEvents: number;
      candleEvents: number;
    };
  };
  equity: Array<{ ts: number; value: number }>;
  trades: Array<{
    openedAtMs: number;
    closedAtMs: number;
    side: string;
    size: number;
    entryPx: number;
    exitPx: number;
    pnl: number;
    stopLoss?: number | null;
    takeProfit?: number | null;
    /** ET calendar date (YYYY-MM-DD) for the trade open (America/New_York). */
    tradingDayEt?: string;
    /**
     * Candle `features` map at entry (from enriched session candles), e.g. `{ "rvol-scanner": { rvol, ... } }`.
     */
    scannerAtEntry?: Record<string, Record<string, unknown>> | null;
    /** Same shape at exit (last scanner snapshot before exit fill). */
    scannerAtExit?: Record<string, Record<string, unknown>> | null;
  }>;
  metrics: {
    tradeCount: number;
    winRate: number;
    winners: number;
    losers: number;
    realizedPnL: number;
    maxDrawdown: number;
  };
}

export interface BacktestOptimizerSettings {
  takeProfitRR: number;
  vwapStartHHMM: number;
  activeStartHHMM: number;
  activeEndHHMM: number;
  stopLossSource: "open" | "avwap" | "extreme" | "low" | "high";
  dojiBodyToRangeMax: number;
  ignoreWeekends: boolean;
  ignoreUsHolidays: boolean;
}

export interface ScannerMetadataItem {
  sessionId: string;
  tool: string;
  sourceId: string;
  importedAtMs: number;
  payload: Record<string, unknown>;
}

export interface ScannerFeatureRow {
  sessionId: string;
  symbol: string;
  timeframe: Timeframe;
  bucketStartMs: number;
  featureSet: string;
  featureVersion: string;
  createdAtMs: number;
  payload: Record<string, unknown>;
}

export interface ScannerRunInput {
  sessionId: string;
  timeframe: Timeframe;
  anchorTsMs: number;
  lookbackHours: number;
  currentWindowHours: number;
  btcSymbol: string;
  featureSet: string;
  featureVersion: string;
  /** `single` — one anchor; `session_bars` — every bar on the longest series (marks each candle). */
  scanMode?: "single" | "session_bars";
}

export interface ScannerRunResult {
  sessionId: string;
  featureSet: string;
  featureVersion: string;
  scanMode?: "single" | "session_bars";
  /** Number of anchor timestamps processed (session_bars only). */
  anchorCount?: number;
  anchorTsMs: number;
  /** Original anchor before server-side clamp (when anchor was too early for lookback). */
  anchorRequestedTsMs?: number;
  anchorClamped?: boolean;
  timeframe: Timeframe;
  lookbackHours: number;
  currentWindowHours: number;
  barsPerHour: number;
  lookbackBars: number;
  windowBars: number;
  symbolCount: number;
  computedCount: number;
  btcSymbol: string | null;
  upserted: number;
}

export type BatchRunRow = {
  sessionId: string;
  symbol: string;
  trades: number;
  winRate: number;
  pnlR: number;
  status: "ok" | "error";
  error?: string;
};

export type OptimizationScenarioResult = {
  rr: number;
  anchorHHMM: number;
  activeStartHHMM: number;
  activeEndHHMM: number;
  dojiBodyToRangeMax?: number;
  runCount: number;
  winRate: number;
  totalR: number;
  avgRPerRun: number;
  avgDrawdown: number;
  negativeRunRate: number;
  score: number;
  rating: number;
  profitRankScore: number;
  drawdownRankScore: number;
};

export type OptimizationAssetRow = {
  symbol: string;
  runs: number;
  totalR: number;
  avgRPerRun: number;
  avgDrawdown: number;
  negativeRunRate: number;
  score: number;
};
