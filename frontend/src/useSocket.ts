import { useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type {
  Candle,
  HudState,
  SessionBreakReason,
  SessionInfo,
  SessionStatus,
  Tick,
  Timeframe
} from "./types";
import { fetchAccountBalance, fetchHistoricalCandles } from "./lib/api";

function floorToInterval(tsMs: number, intervalMs: number): number {
  return Math.floor(tsMs / intervalMs) * intervalMs;
}

function upsertLiveCandle(candles: Candle[], tick: Tick, intervalMs: number): Candle[] {
  const bucketStart = floorToInterval(tick.ts, intervalMs);

  if (!candles.length || candles[candles.length - 1].timeMs < bucketStart) {
    return [
      ...candles,
      {
        timeMs: bucketStart,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.size ?? 0
      }
    ];
  }

  const last = candles[candles.length - 1];
  if (last.timeMs !== bucketStart) {
    return [
      ...candles,
      {
        timeMs: bucketStart,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.size ?? 0
      }
    ];
  }

  const updated: Candle = {
    ...last,
    close: tick.price,
    high: Math.max(last.high, tick.price),
    low: Math.min(last.low, tick.price),
    volume: last.volume + (tick.size ?? 0)
  };

  return [...candles.slice(0, -1), updated];
}

function computePositionSize(balance: number, price: number, riskPercent: number): number {
  if (!Number.isFinite(price) || price <= 0) {
    return 0;
  }
  return (balance * (riskPercent / 100)) / price;
}

function mergeCandles(base: Candle[], overlay: Candle[]): Candle[] {
  if (!base.length) return [...overlay].sort((a, b) => a.timeMs - b.timeMs);
  if (!overlay.length) return [...base].sort((a, b) => a.timeMs - b.timeMs);

  const merged = [...base, ...overlay].sort((a, b) => a.timeMs - b.timeMs);
  const result: Candle[] = [];
  for (const candle of merged) {
    const last = result[result.length - 1];
    if (last && last.timeMs === candle.timeMs) {
      // Keep the latter entry so live-updated buckets win over snapshot buckets.
      result[result.length - 1] = candle;
    } else {
      result.push(candle);
    }
  }
  return result;
}

const INACTIVITY_TIMEOUT_MS = 30_000;
const HISTORY_PRELOAD_CONCURRENCY = 2;

type TimeframeCandleStore = Record<Timeframe, Candle[]>;
type SessionStore = Record<string, TimeframeCandleStore>;

type SessionRuntime = {
  id: string;
  startedAtMs: number;
  lastEventAtMs: number | null;
  status: SessionStatus;
  breakReason: SessionBreakReason;
};

const candlesBySessionId: Record<string, SessionStore> = {};
let activeSession: SessionRuntime = createSession("active", null);

function createSession(status: SessionStatus, breakReason: SessionBreakReason): SessionRuntime {
  const now = Date.now();
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    startedAtMs: now,
    lastEventAtMs: null,
    status,
    breakReason
  };
}

function getSessionStore(sessionId: string): SessionStore {
  if (!candlesBySessionId[sessionId]) {
    candlesBySessionId[sessionId] = {};
  }
  return candlesBySessionId[sessionId];
}

function getOrCreateSymbolStore(sessionId: string, symbol: string): TimeframeCandleStore {
  const upperSymbol = symbol.toUpperCase();
  const sessionStore = getSessionStore(sessionId);
  if (!sessionStore[upperSymbol]) {
    sessionStore[upperSymbol] = { "1m": [], "5m": [] };
  }
  return sessionStore[upperSymbol];
}

function buildSessionInfo(): SessionInfo {
  const sessionStore = getSessionStore(activeSession.id);
  const assetSymbols = Object.keys(sessionStore).filter((symbol) => {
    const timeframeStore = sessionStore[symbol];
    return timeframeStore["1m"].length > 0 || timeframeStore["5m"].length > 0;
  });
  const candleCount = assetSymbols.reduce((acc, symbol) => {
    const timeframeStore = sessionStore[symbol];
    return acc + timeframeStore["1m"].length + timeframeStore["5m"].length;
  }, 0);

  return {
    id: activeSession.id,
    status: activeSession.status,
    startedAtMs: activeSession.startedAtMs,
    lastEventAtMs: activeSession.lastEventAtMs,
    assetCount: assetSymbols.length,
    candleCount,
    breakReason: activeSession.breakReason
  };
}

export function useSocket(
  selectedSymbol: string,
  trackedSymbols: string[] = [],
  restartSignal = 0
) {
  const selectedSymbolRef = useRef(selectedSymbol.toUpperCase());
  const historyLoadStateRef = useRef<Record<string, "loading" | "loaded">>({});
  const lastRestartSignalRef = useRef(restartSignal);
  const [hud, setHud] = useState<HudState>({
    symbol: "BTC",
    price: 0,
    balance: 0,
    stopLossPrice: 0,
    riskPercent: 2,
    positionSize: 0
  });

  const [candles1m, setCandles1m] = useState<Candle[]>([]);
  const [candles5m, setCandles5m] = useState<Candle[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe | null>("1m");
  const [connected, setConnected] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo>(() => buildSessionInfo());
  const [historyPreloading, setHistoryPreloading] = useState(false);
  const trackedSymbolsKey = useMemo(() => {
    const symbols = new Set<string>();
    for (const symbol of [selectedSymbol, ...trackedSymbols]) {
      const upper = String(symbol ?? "").trim().toUpperCase();
      if (upper) symbols.add(upper);
    }
    return Array.from(symbols).sort().join("|");
  }, [selectedSymbol, trackedSymbols]);

  const syncSelectedSymbolFromSession = (symbol: string) => {
    const symbolStore = getOrCreateSymbolStore(activeSession.id, symbol);
    setCandles1m([...symbolStore["1m"]]);
    setCandles5m([...symbolStore["5m"]]);
    setSessionInfo(buildSessionInfo());
  };

  const startNewBrokenSession = (reason: SessionBreakReason) => {
    activeSession = createSession("broken", reason);
    setCandles1m([]);
    setCandles5m([]);
    setSessionInfo(buildSessionInfo());
  };

  const restartSession = () => {
    activeSession = createSession("active", null);
    setCandles1m([]);
    setCandles5m([]);
    setSessionInfo(buildSessionInfo());
  };

  const markSessionActiveFromEvent = (eventTs: number) => {
    if (activeSession.status !== "active") {
      activeSession.status = "active";
      activeSession.breakReason = null;
      activeSession.startedAtMs = Date.now();
    }
    activeSession.lastEventAtMs = eventTs;
  };

  const appendTickToSessionStore = (tick: Tick) => {
    const symbolStore = getOrCreateSymbolStore(activeSession.id, tick.symbol);
    symbolStore["1m"] = upsertLiveCandle(symbolStore["1m"], tick, 60_000);
    symbolStore["5m"] = upsertLiveCandle(symbolStore["5m"], tick, 5 * 60_000);

    if (tick.symbol === selectedSymbolRef.current) {
      setCandles1m([...symbolStore["1m"]]);
      setCandles5m([...symbolStore["5m"]]);
    }

    setSessionInfo(buildSessionInfo());
  };

  useEffect(() => {
    const upper = selectedSymbol.toUpperCase();
    selectedSymbolRef.current = upper;
    syncSelectedSymbolFromSession(upper);
  }, [selectedSymbol]);

  useEffect(() => {
    const symbols = trackedSymbolsKey.length > 0 ? trackedSymbolsKey.split("|") : [];
    const sessionId = activeSession.id;
    let cancelled = false;
    const queue: Array<{ symbol: string; timeframe: Timeframe; key: string }> = [];

    const queuePreloadForSymbol = (symbol: string) => {
      const upper = symbol.toUpperCase();
      const timeframes: Timeframe[] = ["1m", "5m"];

      for (const timeframe of timeframes) {
        const key = `${sessionId}:${upper}:${timeframe}`;
        const status = historyLoadStateRef.current[key];
        if (status === "loading" || status === "loaded") continue;
        historyLoadStateRef.current[key] = "loading";
        queue.push({ symbol: upper, timeframe, key });
      }
    };

    for (const symbol of symbols) {
      queuePreloadForSymbol(symbol);
    }

    if (queue.length === 0) {
      setHistoryPreloading(false);
      return () => {
        cancelled = true;
      };
    }

    setHistoryPreloading(true);
    const workerCount = Math.max(1, Math.min(HISTORY_PRELOAD_CONCURRENCY, queue.length));
    const workers = Array.from({ length: workerCount }, async () => {
      while (!cancelled && activeSession.id === sessionId) {
        const next = queue.shift();
        if (!next) break;

        try {
          const history = await fetchHistoricalCandles(next.symbol, next.timeframe).catch(() => []);
          if (cancelled) return;
          if (activeSession.id !== sessionId) return;

          const symbolStore = getOrCreateSymbolStore(sessionId, next.symbol);
          symbolStore[next.timeframe] = mergeCandles(history, symbolStore[next.timeframe]);
          historyLoadStateRef.current[next.key] = "loaded";

          if (next.symbol === selectedSymbolRef.current) {
            syncSelectedSymbolFromSession(next.symbol);
          } else {
            setSessionInfo(buildSessionInfo());
          }
        } catch {
          delete historyLoadStateRef.current[next.key];
        }
      }
    });

    void Promise.allSettled(workers).then(() => {
      if (cancelled) return;
      if (activeSession.id !== sessionId) return;
      setHistoryPreloading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [trackedSymbolsKey, sessionInfo.id]);

  useEffect(() => {
    if (restartSignal === lastRestartSignalRef.current) return;
    lastRestartSignalRef.current = restartSignal;
    restartSession();
  }, [restartSignal]);

  useEffect(() => {
    const socket: Socket = io("/", { path: "/socket.io" });

    socket.on("connect", () => {
      setConnected(true);
    });

    socket.on("disconnect", () => {
      setConnected(false);
      startNewBrokenSession("disconnect");
    });

    socket.on("connect_error", () => {
      setConnected(false);
      startNewBrokenSession("connect_error");
    });

    socket.on("initialState", (payload: any) => {
      setHud((prev) => ({
        ...prev,
        symbol: String(payload.symbol ?? prev.symbol).toUpperCase(),
        balance: Number(payload.balance ?? 0),
        riskPercent: Number(payload.riskPercent ?? prev.riskPercent),
        stopLossPrice: Number(payload.stopLossPrice ?? 0),
        positionSize: Number(payload.positionSize ?? 0)
      }));
    });

    socket.on("symbolChanged", ({ symbol }: { symbol: string }) => {
      setHud((prev) => {
        const nextSymbol = String(symbol || prev.symbol).toUpperCase();
        return {
          ...prev,
          symbol: nextSymbol,
          price: 0
        };
      });
      selectedSymbolRef.current = String(symbol || "").toUpperCase();
      syncSelectedSymbolFromSession(selectedSymbolRef.current);
    });

    socket.on("priceUpdate", (payload: any) => {
      const symbol = String(payload.symbol ?? "").toUpperCase();
      const price = Number(payload.price ?? 0);
      const ts = Number(payload.ts ?? Date.now());

      if (!Number.isFinite(price) || !Number.isFinite(ts)) {
        return;
      }

      markSessionActiveFromEvent(ts);
      const pseudoTick: Tick = {
        symbol,
        price,
        size: 0,
        ts
      };

      appendTickToSessionStore(pseudoTick);

      if (symbol === selectedSymbolRef.current) {
        setHud((prev) => ({
          ...prev,
          price
        }));
      }
    });

    socket.on("hudUpdate", (payload: any) => {
      setHud((prev) => ({
        ...prev,
        balance: payload.balance !== undefined ? Number(payload.balance ?? 0) : prev.balance,
        stopLossPrice:
          payload.stopLossPrice !== undefined
            ? Number(payload.stopLossPrice ?? 0)
            : prev.stopLossPrice,
        positionSize:
          payload.positionSize !== undefined
            ? Number(payload.positionSize ?? prev.positionSize)
            : prev.positionSize
      }));
    });

    socket.on("tick", (tickPayload: any) => {
      const tick: Tick = {
        symbol: String(tickPayload.symbol ?? "").toUpperCase(),
        price: Number(tickPayload.price ?? 0),
        size: Number(tickPayload.size ?? 0),
        ts: Number(tickPayload.ts ?? Date.now())
      };

      if (!Number.isFinite(tick.ts) || !Number.isFinite(tick.price)) {
        return;
      }

      markSessionActiveFromEvent(tick.ts);
      appendTickToSessionStore(tick);
    });

    return () => {
      setConnected(false);
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const last = activeSession.lastEventAtMs;
      if (!last) return;
      if (activeSession.status !== "active") return;
      if (Date.now() - last < INACTIVITY_TIMEOUT_MS) return;
      startNewBrokenSession("inactivity");
    }, 1_000);

    return () => {
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const balance = await fetchAccountBalance();
      if (cancelled) return;
      if (!Number.isFinite(balance) || balance < 0) return;

      setHud((prev) => ({
        ...prev,
        balance,
        positionSize: computePositionSize(balance, prev.price, prev.riskPercent)
      }));
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCandles = useMemo(() => {
    if (timeframe === "5m") return candles5m;
    if (timeframe === "1m") return candles1m;
    return [];
  }, [timeframe, candles1m, candles5m]);

  const waitingForLiveData = selectedCandles.length === 0;

  return {
    hud,
    candles: selectedCandles,
    timeframe,
    setTimeframe,
    waitingForLiveData,
    historyPreloading,
    connected,
    sessionInfo
  };
}

