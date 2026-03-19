import type {
  AccountFees,
  AccountFill,
  AccountMode,
  AccountOverview,
  AccountPosition,
  AccountSettings,
  Candle,
  GapRange,
  LeveragePreview,
  PersistenceStatus,
  SessionInfo,
  Timeframe
} from "../types";

const HYPERLIQUID_INFO_URL =
  (import.meta as any).env?.VITE_HYPERLIQUID_INFO_URL ?? "https://api.hyperliquid.xyz/info";
const BACKEND_BASE_URL =
  (import.meta as any).env?.VITE_BACKEND_BASE_URL ?? "http://localhost:3000";
const HYPERLIQUID_ACCOUNT =
  (import.meta as any).env?.VITE_HYPERLIQUID_ACCOUNT ?? "0xREPLACE_WITH_MAINNET_ADDRESS";

function intervalToMs(interval: Timeframe): number {
  switch (interval) {
    case "1m":
      return 60_000;
    case "5m":
      return 5 * 60_000;
    default:
      return 60_000;
  }
}

export async function fetchHistoricalCandles(
  symbol: string,
  interval: Timeframe,
  maxCandles: number | null = null
): Promise<Candle[]> {
  // Per Hyperliquid docs, candleSnapshot requires a startTime in ms.
  // Using 0 requests the full available history up to the latest candles.
  // By default we keep all candles and only trim when maxCandles is provided.
  try {
    const response = await fetch(HYPERLIQUID_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: {
          coin: symbol,
          interval,
          startTime: 0
        }
      })
    });

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    const candlesArray: any[] = Array.isArray(payload) ? payload : payload?.candles ?? [];

    const normalized: Candle[] = candlesArray
      .map((c) => {
        const timeMs = Number(c.t ?? c.openTime ?? c.timeMs);
        const open = Number(c.o ?? c.open);
        const high = Number(c.h ?? c.high);
        const low = Number(c.l ?? c.low);
        const close = Number(c.c ?? c.close);
        const volume = Number(c.v ?? c.volume ?? 0);

        if (!Number.isFinite(timeMs) || ![open, high, low, close].every(Number.isFinite)) {
          return null;
        }

        return { timeMs, open, high, low, close, volume };
      })
      .filter((c): c is Candle => c !== null)
      .sort((a, b) => a.timeMs - b.timeMs);

    if (typeof maxCandles === "number" && Number.isFinite(maxCandles) && maxCandles > 0) {
      return normalized.slice(-maxCandles);
    }

    return normalized;
  } catch {
    return [];
  }
}

/**
 * Fetch all available trading symbols from Hyperliquid.
 * Uses the `meta` info endpoint and returns an array of symbol names (e.g. ["BTC", "ETH", ...]).
 */
export async function fetchAvailableSymbols(): Promise<string[]> {
  try {
    const response = await fetch(HYPERLIQUID_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "meta" })
    });

    if (!response.ok) {
      return [];
    }

    const payload: any = await response.json();
    const universe: any[] = Array.isArray(payload?.universe) ? payload.universe : [];

    const symbols = universe
      .map((entry) => {
        // Per Hyperliquid docs, entries typically have a `name` like "BTC", "ETH", etc.
        const raw = entry?.name ?? entry?.coin ?? "";
        return String(raw).trim().toUpperCase();
      })
      .filter((s) => s.length > 0);

    // De-duplicate while preserving order
    return Array.from(new Set(symbols));
  } catch {
    return [];
  }
}

/**
 * Fetch all perpetual symbols from Hyperliquid meta info.
 * Filters universe entries to only include perp markets.
 */
export async function fetchPerpSymbols(): Promise<string[]> {
  try {
    const response = await fetch(HYPERLIQUID_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "meta" })
    });

    if (!response.ok) {
      return [];
    }

    const payload: any = await response.json();
    const universe: any[] = Array.isArray(payload?.universe) ? payload.universe : [];

    const perps = universe
      .filter((entry) => {
        // Heuristic: Hyperliquid universe for perps typically contains leverage / margin fields.
        // Exclude obviously non-perp entries if they have a spot/hip3 marker.
        if (entry?.isDelisted) return false;
        // Some integrations tag perp metas explicitly; keep those.
        if (entry?.perp === true || entry?.isPerp === true) return true;
        // Fallback: default to including; frontend will still only send uppercase coin names.
        return true;
      })
      .map((entry) => String(entry?.name ?? entry?.coin ?? "").trim().toUpperCase())
      .filter((s) => s.length > 0);

    return Array.from(new Set(perps));
  } catch {
    return [];
  }
}

export interface StreamsState {
  symbols: string[];
  primary: string;
}

export interface SessionSnapshot {
  sessionInfo: SessionInfo;
  symbol: string;
  candlesByTimeframe: Record<Timeframe, Candle[]>;
  gapsByTimeframe: Record<Timeframe, GapRange[]>;
}

export async function fetchActiveStreams(): Promise<StreamsState> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/streams`);
    if (!res.ok) {
      return { symbols: [], primary: "" };
    }
    const data = (await res.json()) as Partial<StreamsState>;
    return {
      symbols: Array.isArray(data.symbols) ? data.symbols.map((s) => String(s).toUpperCase()) : [],
      primary: data.primary ? String(data.primary).toUpperCase() : ""
    };
  } catch {
    return { symbols: [], primary: "" };
  }
}

export async function addStream(symbol: string): Promise<StreamsState | null> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/streams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol })
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as StreamsState;
    return {
      symbols: data.symbols.map((s) => String(s).toUpperCase()),
      primary: String(data.primary).toUpperCase()
    };
  } catch {
    return null;
  }
}

export async function removeStream(symbol: string): Promise<StreamsState | null> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/streams/${encodeURIComponent(symbol)}`, {
      method: "DELETE"
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as StreamsState;
    return {
      symbols: data.symbols.map((s) => String(s).toUpperCase()),
      primary: String(data.primary).toUpperCase()
    };
  } catch {
    return null;
  }
}

export async function setPrimarySymbol(symbol: string): Promise<string | null> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/change-symbol`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol })
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { symbol?: string };
    return data.symbol ? String(data.symbol).toUpperCase() : null;
  } catch {
    return null;
  }
}

export async function fetchAccountBalance(): Promise<number> {
  if (!HYPERLIQUID_ACCOUNT || HYPERLIQUID_ACCOUNT.includes("REPLACE_WITH")) {
    return 0;
  }

  try {
    const response = await fetch(HYPERLIQUID_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "clearinghouseState",
        user: HYPERLIQUID_ACCOUNT
      })
    });

    if (!response.ok) {
      return 0;
    }

    const payload = await response.json();
    const parsedBalance = Number(
      payload?.marginSummary?.accountValue ??
        payload?.crossMarginSummary?.accountValue ??
        payload?.withdrawable ??
        0
    );

    return Number.isFinite(parsedBalance) && parsedBalance >= 0 ? parsedBalance : 0;
  } catch {
    return 0;
  }
}

export async function fetchCurrentSessionSnapshot(symbol: string): Promise<SessionSnapshot | null> {
  try {
    const res = await fetch(
      `${BACKEND_BASE_URL}/api/session/current?symbol=${encodeURIComponent(symbol)}&timeframe=all`
    );
    if (!res.ok) {
      return null;
    }
    const payload: any = await res.json();
    if (!payload?.ok) return null;
    const one = Array.isArray(payload?.candlesByTimeframe?.["1m"])
      ? payload.candlesByTimeframe["1m"]
      : [];
    const five = Array.isArray(payload?.candlesByTimeframe?.["5m"])
      ? payload.candlesByTimeframe["5m"]
      : [];

    return {
      sessionInfo: payload.sessionInfo as SessionInfo,
      symbol: String(payload.symbol || symbol).toUpperCase(),
      candlesByTimeframe: {
        "1m": one as Candle[],
        "5m": five as Candle[]
      },
      gapsByTimeframe: {
        "1m": Array.isArray(payload?.gapsByTimeframe?.["1m"]) ? payload.gapsByTimeframe["1m"] : [],
        "5m": Array.isArray(payload?.gapsByTimeframe?.["5m"]) ? payload.gapsByTimeframe["5m"] : []
      }
    };
  } catch {
    return null;
  }
}

export async function fetchActiveSessionId(): Promise<string | null> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/session/active-id`);
    if (!res.ok) {
      return null;
    }
    const payload: any = await res.json();
    if (!payload?.ok) return null;
    return payload.sessionId ? String(payload.sessionId) : null;
  } catch {
    return null;
  }
}

export async function fetchSessionSnapshotById(
  sessionId: string,
  symbol: string
): Promise<SessionSnapshot | null> {
  try {
    const res = await fetch(
      `${BACKEND_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}?symbol=${encodeURIComponent(
        symbol
      )}&timeframe=all`
    );
    if (!res.ok) {
      return null;
    }
    const payload: any = await res.json();
    if (!payload?.ok) return null;

    return {
      sessionInfo: payload.sessionInfo as SessionInfo,
      symbol: String(payload.symbol || symbol).toUpperCase(),
      candlesByTimeframe: {
        "1m": Array.isArray(payload?.candlesByTimeframe?.["1m"])
          ? payload.candlesByTimeframe["1m"]
          : [],
        "5m": Array.isArray(payload?.candlesByTimeframe?.["5m"])
          ? payload.candlesByTimeframe["5m"]
          : []
      },
      gapsByTimeframe: {
        "1m": Array.isArray(payload?.gapsByTimeframe?.["1m"]) ? payload.gapsByTimeframe["1m"] : [],
        "5m": Array.isArray(payload?.gapsByTimeframe?.["5m"]) ? payload.gapsByTimeframe["5m"] : []
      }
    };
  } catch {
    return null;
  }
}

export async function saveCurrentSession(): Promise<PersistenceStatus | null> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/session/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    if (!res.ok) {
      return null;
    }
    const payload: any = await res.json();
    if (!payload?.ok) {
      return null;
    }
    const status = payload?.persistence;
    if (!status) {
      return fetchPersistenceStatus();
    }
    return {
      redisOnline: Boolean(status.redisOnline),
      redisUrl: status.redisUrl ? String(status.redisUrl) : undefined,
      sqliteOnline: Boolean(status.sqliteOnline),
      sqlitePath: status.sqlitePath ? String(status.sqlitePath) : undefined,
      lastSqlSaveAtMs:
        status.lastSqlSaveAtMs !== null && status.lastSqlSaveAtMs !== undefined
          ? Number(status.lastSqlSaveAtMs)
          : null,
      lastSqlSavedSessionId: status.lastSqlSavedSessionId
        ? String(status.lastSqlSavedSessionId)
        : null,
      mode: status.mode === "persisted" ? "persisted" : "fallback"
    };
  } catch {
    return null;
  }
}

export async function fetchTodaySessions(): Promise<SessionInfo[]> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/sessions?date=today`);
    if (!res.ok) {
      return [];
    }
    const payload: any = await res.json();
    if (!payload?.ok || !Array.isArray(payload.sessions)) {
      return [];
    }
    return payload.sessions as SessionInfo[];
  } catch {
    return [];
  }
}

export async function fetchPersistenceStatus(): Promise<PersistenceStatus | null> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/persistence/status`);
    if (!res.ok) {
      return null;
    }
    const payload: any = await res.json();
    if (!payload?.ok) {
      return null;
    }
    return {
      redisOnline: Boolean(payload.redisOnline),
      redisUrl: payload.redisUrl ? String(payload.redisUrl) : undefined,
      sqliteOnline: Boolean(payload.sqliteOnline),
      sqlitePath: payload.sqlitePath ? String(payload.sqlitePath) : undefined,
      lastSqlSaveAtMs:
        payload.lastSqlSaveAtMs !== null && payload.lastSqlSaveAtMs !== undefined
          ? Number(payload.lastSqlSaveAtMs)
          : null,
      lastSqlSavedSessionId: payload.lastSqlSavedSessionId
        ? String(payload.lastSqlSavedSessionId)
        : null,
      mode: payload.mode === "persisted" ? "persisted" : "fallback"
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Account API
// ---------------------------------------------------------------------------

export async function fetchAccountOverview(
  mode: AccountMode = "live"
): Promise<{ overview: AccountOverview; positions: AccountPosition[] } | null> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/account/overview?mode=${mode}`);
    if (!res.ok) return null;
    const data: any = await res.json();
    if (!data?.ok) return null;
    return { overview: data.overview, positions: data.positions ?? [] };
  } catch {
    return null;
  }
}

export async function fetchAccountPositions(
  mode: AccountMode = "live"
): Promise<AccountPosition[]> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/account/positions?mode=${mode}`);
    if (!res.ok) return [];
    const data: any = await res.json();
    return data?.ok ? (data.positions ?? []) : [];
  } catch {
    return [];
  }
}

export async function fetchAccountFills(
  mode: AccountMode = "live"
): Promise<AccountFill[]> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/account/fills?mode=${mode}`);
    if (!res.ok) return [];
    const data: any = await res.json();
    return data?.ok ? (data.fills ?? []) : [];
  } catch {
    return [];
  }
}

export async function fetchAccountFees(
  mode: AccountMode = "live"
): Promise<AccountFees | null> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/account/fees?mode=${mode}`);
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.ok ? data.fees : null;
  } catch {
    return null;
  }
}

export async function fetchLeveragePreview(params: {
  symbol: string;
  stopLossDistancePct: number;
  riskBudgetPct?: number;
  slippageBps?: number;
  mode?: AccountMode;
}): Promise<LeveragePreview | null> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/account/leverage-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params)
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.ok ? data.preview : null;
  } catch {
    return null;
  }
}

export async function fetchAccountSettings(): Promise<AccountSettings | null> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/account/settings`);
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.ok ? data.settings : null;
  } catch {
    return null;
  }
}

export async function patchAccountMode(
  mode: AccountMode
): Promise<AccountMode | null> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/account/mode`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode })
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.ok ? data.mode : null;
  } catch {
    return null;
  }
}

export async function updateAccountSettings(
  partial: Partial<AccountSettings>
): Promise<AccountSettings | null> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/account/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial)
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.ok ? data.settings : null;
  } catch {
    return null;
  }
}

