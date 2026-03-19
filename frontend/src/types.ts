export type Timeframe = "1m" | "5m";

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
  source?: "live" | "history" | "mixed";
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

