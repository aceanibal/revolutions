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

