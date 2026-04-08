import type {
  BacktestRunResult,
  PaginationMeta,
  ReplayMode,
  SavedSession,
  ScannerFeatureRow,
  ScannerRunInput,
  ScannerRunResult,
  SessionType,
  ScannerMetadataItem,
  SessionSnapshot,
  SessionTrade,
  StrategyDefinition,
  StrategyId,
  Tick,
  TickPolicy,
  Timeframe
} from "../types";

const BACKEND_BASE_URL = (import.meta as any).env?.VITE_BACKEND_BASE_URL ?? "http://localhost:3001";

async function readJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchBacktestSessions(): Promise<SavedSession[]> {
  const payload = await readJson<{ ok: boolean; sessions: SavedSession[] }>(`${BACKEND_BASE_URL}/api/backtest/sessions/all`);
  return payload?.ok ? payload.sessions : [];
}

export async function fetchStrategyDefinitions(): Promise<StrategyDefinition[]> {
  const payload = await readJson<{ ok: boolean; strategies: StrategyDefinition[] }>(
    `${BACKEND_BASE_URL}/api/backtest/strategies`
  );
  return payload?.ok ? payload.strategies : [];
}

export async function fetchBacktestSessionsPaged(options: {
  page: number;
  pageSize: number;
  date?: string;
  sessionType?: SessionType;
}): Promise<{ sessions: SavedSession[]; pagination: PaginationMeta } | null> {
  const params = new URLSearchParams({
    page: String(options.page),
    pageSize: String(options.pageSize)
  });
  if (options.date) params.set("date", options.date);
  if (options.sessionType) params.set("sessionType", options.sessionType);
  const payload = await readJson<{ ok: boolean; sessions: SavedSession[]; pagination: PaginationMeta }>(
    `${BACKEND_BASE_URL}/api/backtest/sessions/all?${params.toString()}`
  );
  if (!payload?.ok) return null;
  return { sessions: payload.sessions, pagination: payload.pagination };
}

export async function fetchSourceSessionsPaged(options: {
  page: number;
  pageSize: number;
  date?: string;
}): Promise<{ sessions: SavedSession[]; pagination: PaginationMeta } | null> {
  const params = new URLSearchParams({
    page: String(options.page),
    pageSize: String(options.pageSize)
  });
  if (options.date) params.set("date", options.date);
  const payload = await readJson<{ ok: boolean; sessions: SavedSession[]; pagination: PaginationMeta }>(
    `${BACKEND_BASE_URL}/api/backtest/import/source-sessions?${params.toString()}`
  );
  if (!payload?.ok) return null;
  return { sessions: payload.sessions, pagination: payload.pagination };
}

export async function importSourceSession(sessionId: string): Promise<boolean> {
  const payload = await readJson<{ ok: boolean }>(`${BACKEND_BASE_URL}/api/backtest/import/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId })
  });
  return Boolean(payload?.ok);
}

export async function fetchBacktestSymbols(sessionId: string): Promise<string[]> {
  const payload = await readJson<{ ok: boolean; symbols: string[] }>(
    `${BACKEND_BASE_URL}/api/backtest/sessions/${encodeURIComponent(sessionId)}/symbols`
  );
  return payload?.ok ? payload.symbols : [];
}

export async function fetchBacktestSnapshot(
  sessionId: string,
  symbol: string,
  timeframe: Timeframe | "all" = "all"
): Promise<SessionSnapshot | null> {
  const payload = await readJson<any>(
    `${BACKEND_BASE_URL}/api/backtest/sessions/${encodeURIComponent(sessionId)}?symbol=${encodeURIComponent(
      symbol
    )}&timeframe=${encodeURIComponent(timeframe)}`
  );
  if (!payload?.ok) return null;
  return {
    sessionInfo: payload.sessionInfo,
    symbol: payload.symbol,
    candlesByTimeframe: payload.candlesByTimeframe || { "1m": [], "5m": [] },
    gapsByTimeframe: payload.gapsByTimeframe || { "1m": [], "5m": [] }
  };
}

export async function fetchBacktestTrades(sessionId: string): Promise<SessionTrade[]> {
  const payload = await readJson<{ ok: boolean; trades: SessionTrade[] }>(
    `${BACKEND_BASE_URL}/api/backtest/sessions/${encodeURIComponent(sessionId)}/trades`
  );
  return payload?.ok ? payload.trades : [];
}

export async function fetchBacktestTicks(sessionId: string, symbol: string): Promise<Tick[]> {
  const payload = await readJson<{ ok: boolean; ticks: Tick[] }>(
    `${BACKEND_BASE_URL}/api/backtest/sessions/${encodeURIComponent(sessionId)}/ticks?symbol=${encodeURIComponent(
      symbol
    )}`
  );
  return payload?.ok ? payload.ticks : [];
}

export async function fetchScannerMetadata(
  sessionId: string,
  tool = ""
): Promise<ScannerMetadataItem[]> {
  const q = tool ? `?tool=${encodeURIComponent(tool)}` : "";
  const payload = await readJson<{ ok: boolean; items: ScannerMetadataItem[] }>(
    `${BACKEND_BASE_URL}/api/backtest/sessions/${encodeURIComponent(sessionId)}/scanner-metadata${q}`
  );
  return payload?.ok ? payload.items : [];
}

export async function runBacktestApi(input: {
  sessionId: string;
  symbol: string;
  mode: ReplayMode;
  timeframe: Timeframe;
  strategyId: StrategyId;
  tickPolicy: TickPolicy;
  strategyParams?: Record<string, unknown>;
}): Promise<BacktestRunResult | null> {
  const payload = await readJson<{ ok: boolean; result: BacktestRunResult }>(
    `${BACKEND_BASE_URL}/api/backtest/run`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: input.sessionId,
        symbol: input.symbol,
        mode: input.mode,
        timeframe: input.timeframe,
        strategyId: input.strategyId,
        params: {
          tickPolicy: input.tickPolicy,
          ...(input.strategyParams && typeof input.strategyParams === "object" ? input.strategyParams : {})
        }
      })
    }
  );
  return payload?.ok ? payload.result : null;
}

export async function runSessionScannerApi(input: ScannerRunInput): Promise<ScannerRunResult | null> {
  const payload = await readJson<{ ok: boolean; result: ScannerRunResult }>(
    `${BACKEND_BASE_URL}/api/backtest/scanner/run`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  );
  return payload?.ok ? payload.result : null;
}

export async function fetchScannerFeatures(input: {
  sessionId: string;
  symbol?: string;
  timeframe?: Timeframe;
  featureSet?: string;
  featureVersion?: string;
  anchorTsMs?: number;
  limit?: number;
}): Promise<ScannerFeatureRow[]> {
  const params = new URLSearchParams();
  if (input.symbol) params.set("symbol", input.symbol);
  if (input.timeframe) params.set("timeframe", input.timeframe);
  if (input.featureSet) params.set("featureSet", input.featureSet);
  if (input.featureVersion) params.set("featureVersion", input.featureVersion);
  if (Number.isFinite(input.anchorTsMs || 0) && Number(input.anchorTsMs || 0) > 0) {
    params.set("anchorTsMs", String(Number(input.anchorTsMs)));
  }
  if (Number.isFinite(input.limit || 0) && Number(input.limit || 0) > 0) {
    params.set("limit", String(Number(input.limit)));
  }
  const query = params.toString();
  const payload = await readJson<{ ok: boolean; rows: ScannerFeatureRow[] }>(
    `${BACKEND_BASE_URL}/api/backtest/sessions/${encodeURIComponent(input.sessionId)}/scanner/features${
      query ? `?${query}` : ""
    }`
  );
  return payload?.ok ? payload.rows : [];
}

export async function fetchLiquidityZoneExport(input: {
  sessionId: string;
  symbol: string;
  featureSet?: string;
  featureVersion?: string;
}): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams({ symbol: input.symbol });
  if (input.featureSet) params.set("featureSet", input.featureSet);
  if (input.featureVersion) params.set("featureVersion", input.featureVersion);
  const payload = await readJson<{ ok: boolean } & Record<string, unknown>>(
    `${BACKEND_BASE_URL}/api/backtest/sessions/${encodeURIComponent(input.sessionId)}/liquidity-zones/export?${params.toString()}`
  );
  if (!payload?.ok) return null;
  const { ok: _, ...rest } = payload;
  return rest;
}

export async function runLiquidityZoneScannerApi(input: {
  sessionId: string;
  featureSet?: string;
  featureVersion?: string;
  lookbackDays?: number;
  numBins?: number;
  swingLeftBars?: number;
  swingRightBars?: number;
  hvnStdDevMultiplier?: number;
  anchorHHMM?: number;
}): Promise<Record<string, unknown> | null> {
  const payload = await readJson<{ ok: boolean; result: Record<string, unknown> }>(
    `${BACKEND_BASE_URL}/api/backtest/scanner/liquidity-zones/run`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  );
  return payload?.ok ? payload.result : null;
}
