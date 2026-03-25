export type Timeframe = "1m" | "5m" | "15m";

export interface HudState {
  symbol: string;
  price: number;
  balance: number;
  stopLossPrice: number;
  riskPercent: number;
  positionSize: number;
}

export interface Candle {
  timeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source?: "live" | "history" | "mixed" | "gap_fill";
  isGapFill?: boolean;
}

export interface Tick {
  symbol: string;
  price: number;
  size?: number;
  ts: number;
}

export type SessionStatus = "active" | "broken" | "closed";
export type SessionBreakReason = "disconnect" | "connect_error" | "inactivity" | null;

export interface SessionInfo {
  id: string;
  status: SessionStatus;
  startedAtMs: number;
  endedAtMs?: number | null;
  lastEventAtMs: number | null;
  assetCount: number;
  candleCount: number;
  breakReason: SessionBreakReason;
  marketWindowStartMs?: number;
  marketWindowEndMs?: number;
}

export interface SavedSession {
  id: string;
  status: SessionStatus;
  startedAtMs: number;
  endedAtMs: number | null;
  breakReason: SessionBreakReason;
  assetCount: number;
  candleCount: number;
  notes: string;
  tradeCount?: number;
}

export interface GapRange {
  fromTimeMs: number;
  toTimeMs: number;
  missingBuckets: number;
}

export interface PersistenceStatus {
  redisOnline: boolean;
  redisUrl?: string;
  sqliteOnline: boolean;
  sqlitePath?: string;
  lastSqlSaveAtMs: number | null;
  lastSqlSavedSessionId: string | null;
  mode: "persisted" | "fallback";
}

// ---------------------------------------------------------------------------
// Account types
// ---------------------------------------------------------------------------

export type AccountMode = "live" | "test";

export interface SpotBalance {
  coin: string;
  total: number;
  hold: number;
}

export interface AccountOverview {
  accountValue: number;
  perpsAccountValue: number;
  spotUsdValue: number;
  spotBalances: SpotBalance[];
  totalNtlPos: number;
  totalMarginUsed: number;
  totalRawUsd: number;
  withdrawable: number;
  crossMaintenanceMarginUsed: number;
  time: number | null;
}

export interface AccountPosition {
  coin: string;
  szi: number;
  entryPx: number;
  positionValue: number;
  unrealizedPnl: number;
  returnOnEquity: number;
  liquidationPx: number | null;
  marginUsed: number;
  maxLeverage: number;
  leverage: { type: string; value: number };
  cumFunding: { allTime: number; sinceOpen: number; sinceChange: number };
}

export interface AccountFill {
  coin: string;
  side: string;
  px: number;
  sz: number;
  time: number;
  fee: number;
  feeToken: string;
  closedPnl: number;
  dir: string;
  crossed: boolean;
  oid: number | null;
  tid: number | null;
}

export interface SessionTrade extends AccountFill {
  mode: AccountMode;
}

export interface AccountFees {
  userAddRate: number;
  userCrossRate: number;
  userSpotAddRate: number;
  userSpotCrossRate: number;
  baseAdd: number;
  baseCross: number;
}

export interface LeveragePreview {
  effectiveLossPct: number;
  recommendedLeverage: number;
  exchangeMaxLeverage: number;
  cappedLeverage: number;
  entryFeePct: number;
  exitFeePct: number;
  totalFeePct: number;
  slippagePct: number;
  riskDollars: number;
  notionalPosition: number;
  positionSizeUnits: number;
  feeBufferPct: number;
  feeCostUsd?: number;
  warning: string | null;
}

export interface StopLossProjection extends LeveragePreview {
  distancePct: number;
}

export interface StopLossProjections {
  stopLossPrice: number;
  currentPrice: number;
  long: StopLossProjection | null;
  short: StopLossProjection | null;
  feeBufferPrice: number;
}

export interface AccountSettings {
  riskPercent: number;
  takeProfitPercent: number;
  slippageBps: number;
  stopLossStep: number;
}

export interface TradeResult {
  ok: boolean;
  action: string;
  symbol: string;
  side?: "long" | "short";
  size?: number;
  avgPx?: number | null;
  error?: string;
  details?: string;
  ts: number;
}

export type TradeLifecycleStatus = "FLAT" | "PENDING_OPEN" | "OPEN" | "PENDING_CLOSE" | "ERROR";

export interface TradeExecutionMeta {
  entryPxRequested: number | null;
  entryPxFilled: number | null;
  slippageBpsRequested: number | null;
  requestedNotional: number | null;
  requestedSize: number | null;
  requestedLeverage: number | null;
  stopLossRequested: number | null;
  stopLossPlaced: number | null;
  openedAtMs: number | null;
  closedAtMs: number | null;
}

export interface TradeOrderRef {
  asset: number;
  oid: number;
}

export interface TradePendingOrder {
  coin: string;
  oid: number | null;
  side: string;
  sz: number;
  /** Exchange ms; used server-side to pick latest when several stops qualify. */
  timestamp?: number;
  triggerPx: number | null;
  limitPx: number | null;
  /** Hyperliquid copy e.g. "Price above 0.94425" — used server-side when triggerPx is absent. */
  triggerCondition?: string;
  isTrigger: boolean;
  reduceOnly: boolean;
  /** From Hyperliquid `b` / side A|B when present — used server-side to match position stop orders. */
  isBuy?: boolean | null;
}

export interface TradeStateSnapshot {
  symbol: string;
  mode: AccountMode;
  status: TradeLifecycleStatus;
  side: "long" | "short" | null;
  size: number;
  entryPx: number;
  stopLoss: number;
  /** Inferred from resting exchange orders (reduce-only / trigger); preferred over HUD `stopLoss` when set. */
  stopLossFromPendingOrders: number;
  /** Inferred TP trigger from resting reduce-only trigger orders (e.g. Take Profit Market). */
  takeProfitFromPendingOrders: number;
  stopOrderRef: TradeOrderRef | null;
  pendingOrders: TradePendingOrder[];
  executionMeta: TradeExecutionMeta;
  updatedAt: number;
  lastAction: string | null;
  error: string | null;
  position?: AccountPosition | null;
}

export interface OrbAvwapStudyConfig {
  timezone: string;
  orb: {
    startTime: string;
    endTime: string;
    timeframe: "1m" | "5m";
    breakoutSource: "wick" | "close";
  };
  avwap: {
    anchorTime: string;
    endTime: string;
    priceSource: "close" | "hlc3";
  };
  execution: {
    directionMode: "both" | "long_only" | "short_only";
    maxTradesPerDay: number;
    stopLossMode: "orb_opposite" | "avwap_cross";
    takeProfitR: number;
    feeBps: number;
    slippageBps: number;
  };
  validation: {
    walkForwardSplitPct: number;
    minTradesForTrust: number;
  };
}

export interface OrbAvwapMetrics {
  tradeCount: number;
  winRate: number;
  avgR: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  netR: number;
  netPnLQuote: number;
  sharpeLike: number;
}

export interface OrbAvwapStudyRun {
  runId: string;
  generatedAtMs: number;
  runType: "single" | "experiments";
  config?: OrbAvwapStudyConfig;
  aggregate?: OrbAvwapMetrics;
  inSample?: OrbAvwapMetrics;
  outOfSample?: OrbAvwapMetrics;
  caseCount?: number;
  runs?: Array<{
    runId: string;
    config: OrbAvwapStudyConfig;
    aggregate: OrbAvwapMetrics;
    inSample: OrbAvwapMetrics;
    outOfSample: OrbAvwapMetrics;
    score: number;
    caseCount: number;
    tradeCount: number;
  }>;
}

