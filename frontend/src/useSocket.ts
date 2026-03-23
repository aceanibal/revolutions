import { useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type {
  AccountMode,
  AccountSettings,
  Candle,
  GapRange,
  HudState,
  SessionInfo,
  Tick,
  Timeframe,
  TradeResult,
  TradeStateSnapshot
} from "./types";
import {
  fetchCurrentSessionSnapshot,
  fetchSessionSnapshotById
} from "./lib/api";

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
        volume: tick.size ?? 0,
        source: "live"
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
        volume: tick.size ?? 0,
        source: "live"
      }
    ];
  }

  const mergedSource: Candle["source"] =
    last.source === "live" || !last.source ? "live" : "mixed";

  const updated: Candle = {
    ...last,
    close: tick.price,
    high: Math.max(last.high, tick.price),
    low: Math.min(last.low, tick.price),
    volume: last.volume + (tick.size ?? 0),
    source: mergedSource
  };

  return [...candles.slice(0, -1), updated];
}

const emptySessionInfo: SessionInfo = {
  id: "",
  status: "active",
  startedAtMs: Date.now(),
  lastEventAtMs: null,
  assetCount: 0,
  candleCount: 0,
  breakReason: null
};

export function useSocket(
  selectedSymbol: string,
  trackedSymbols: string[] = [],
  selectedSessionId: string | null = null
) {
  const socketRef = useRef<Socket | null>(null);
  const selectedSymbolRef = useRef(selectedSymbol.toUpperCase());
  const effectiveSelectedSessionId = selectedSessionId;
  const liveMode = !effectiveSelectedSessionId;
  const [hud, setHud] = useState<HudState>({
    symbol: "",
    price: 0,
    balance: 0,
    stopLossPrice: 0,
    riskPercent: 2,
    positionSize: 0
  });
  const [candles1m, setCandles1m] = useState<Candle[]>([]);
  const [candles5m, setCandles5m] = useState<Candle[]>([]);
  const [gaps1m, setGaps1m] = useState<GapRange[]>([]);
  const [gaps5m, setGaps5m] = useState<GapRange[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe | null>("1m");
  const [connected, setConnected] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo>(emptySessionInfo);
  const [historyPreloading, setHistoryPreloading] = useState(false);
  const [accountSettings, setAccountSettings] = useState<AccountSettings | null>(null);
  const [accountMode, setAccountMode] = useState<AccountMode>("live");
  const [isLong, setIsLong] = useState(true);
  const [tradeResult, setTradeResult] = useState<TradeResult | null>(null);
  const [tradeState, setTradeState] = useState<TradeStateSnapshot | null>(null);

  const applyTradeState = (nextState: TradeStateSnapshot | null) => {
    if (!nextState) {
      setTradeState(null);
      return;
    }
    setTradeState({
      ...nextState,
      stopLossFromPendingOrders: Number(nextState.stopLossFromPendingOrders ?? 0) || 0,
      executionMeta: nextState.executionMeta ? { ...nextState.executionMeta } : nextState.executionMeta,
      pendingOrders: Array.isArray(nextState.pendingOrders) ? [...nextState.pendingOrders] : nextState.pendingOrders
    });
    if (nextState.mode === "live" || nextState.mode === "test") {
      setAccountMode(nextState.mode);
    }
    if (nextState.side === "long") setIsLong(true);
    if (nextState.side === "short") setIsLong(false);
  };
  const trackedSymbolsKey = useMemo(() => {
    const set = new Set<string>();
    for (const symbol of [selectedSymbol, ...trackedSymbols]) {
      const upper = String(symbol || "").trim().toUpperCase();
      if (upper) set.add(upper);
    }
    return Array.from(set).join("|");
  }, [selectedSymbol, trackedSymbols]);

  useEffect(() => {
    selectedSymbolRef.current = selectedSymbol.toUpperCase();
  }, [selectedSymbol]);

  /** Avoid showing LIT trade rows while the chart is on XRP until the matching snapshot arrives. */
  useEffect(() => {
    setTradeState(null);
  }, [selectedSymbol]);

  useEffect(() => {
    let cancelled = false;
    setHistoryPreloading(true);

    const load = async () => {
      const snapshot = effectiveSelectedSessionId
        ? await fetchSessionSnapshotById(effectiveSelectedSessionId, selectedSymbolRef.current)
        : await fetchCurrentSessionSnapshot(selectedSymbolRef.current);
      if (cancelled) return;

      if (snapshot) {
        const withSource = (candles: Candle[]) =>
          candles.map((c) => ({
            ...c,
            source:
              effectiveSelectedSessionId && (!c.source || c.source === "live")
                ? ("history" as const)
                : c.source
          }));
        setCandles1m(withSource(snapshot.candlesByTimeframe["1m"] || []));
        setCandles5m(withSource(snapshot.candlesByTimeframe["5m"] || []));
        setGaps1m(snapshot.gapsByTimeframe["1m"] || []);
        setGaps5m(snapshot.gapsByTimeframe["5m"] || []);
        setSessionInfo(snapshot.sessionInfo || emptySessionInfo);
      } else {
        setCandles1m([]);
        setCandles5m([]);
        setGaps1m([]);
        setGaps5m([]);
      }

      setHistoryPreloading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [trackedSymbolsKey, effectiveSelectedSessionId]);

  useEffect(() => {
    const socket: Socket = io("/", { path: "/socket.io" });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("symbol:subscribe", { symbol: selectedSymbolRef.current });
    });
    socket.on("disconnect", () => {
      setConnected(false);
    });
    socket.on("connect_error", () => {
      setConnected(false);
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
      if (payload.settings) {
        setAccountSettings(payload.settings as AccountSettings);
      }
      if (payload.mode === "live" || payload.mode === "test") {
        setAccountMode(payload.mode);
      }
      if (typeof payload.isLong === "boolean") {
        setIsLong(payload.isLong);
      }
      if (payload.tradeState) {
        applyTradeState(payload.tradeState as TradeStateSnapshot);
      }
    });

    socket.on("tradeState:snapshot", (payload: any) => {
      if (!payload) return;
      const symbol = String(payload.symbol ?? "").toUpperCase();
      if (symbol && symbol !== selectedSymbolRef.current) return;
      applyTradeState(payload as TradeStateSnapshot);
    });

    socket.on("tradeState:update", (payload: any) => {
      if (!payload) return;
      const symbol = String(payload.symbol ?? "").toUpperCase();
      if (symbol && symbol !== selectedSymbolRef.current) return;
      applyTradeState(payload as TradeStateSnapshot);
    });

    socket.on("hudUpdate", (payload: any) => {
      if (!payload) return;
      setHud((prev) => ({
        ...prev,
        stopLossPrice: Number(payload.stopLossPrice ?? prev.stopLossPrice),
        balance: Number(payload.balance ?? prev.balance),
        positionSize: Number(payload.positionSize ?? prev.positionSize)
      }));
    });

    socket.on("direction:update", (payload: any) => {
      const symbol = String(payload?.symbol ?? "").toUpperCase();
      if (symbol && symbol !== selectedSymbolRef.current) return;
      if (typeof payload?.isLong === "boolean") {
        setIsLong(payload.isLong);
      }
    });

    socket.on("mode:update", (payload: any) => {
      const mode = payload?.mode;
      if (mode === "live" || mode === "test") {
        setAccountMode(mode);
        socket.emit("symbol:subscribe", { symbol: selectedSymbolRef.current });
      }
    });

    socket.on("settings:update", (payload: any) => {
      if (!payload || typeof payload !== "object") return;
      setAccountSettings(payload as AccountSettings);
      if (payload.riskPercent !== undefined) {
        setHud((prev) => ({
          ...prev,
          riskPercent: Number(payload.riskPercent ?? prev.riskPercent)
        }));
      }
    });

    socket.on("session:update", (payload: SessionInfo) => {
      if (!liveMode) return;
      if (!payload) return;
      setSessionInfo(payload);
    });

    socket.on("priceUpdate", (payload: any) => {
      if (!liveMode) return;
      const symbol = String(payload.symbol ?? "").toUpperCase();
      const price = Number(payload.price ?? 0);
      const ts = Number(payload.ts ?? Date.now());
      if (!Number.isFinite(price) || !Number.isFinite(ts)) return;

      const pseudoTick: Tick = { symbol, price, size: 0, ts };
      if (symbol === selectedSymbolRef.current) {
        setCandles1m((prev) => upsertLiveCandle(prev, pseudoTick, 60_000));
        setCandles5m((prev) => upsertLiveCandle(prev, pseudoTick, 5 * 60_000));
        setHud((prev) => ({ ...prev, price }));
      }
    });

    socket.on("trade:result", (payload: any) => {
      if (!payload) return;
      const sym = String(payload.symbol ?? "").toUpperCase();
      if (sym && sym !== selectedSymbolRef.current) return;
      setTradeResult(payload as TradeResult);
    });

    socket.on("controllerEvent", (payload: any) => {
      const button = String(payload?.button ?? "");
      if (
        button === "updateStopLoss" ||
        button === "toggleDirection" ||
        button === "primaryPrev" ||
        button === "primaryNext"
      ) {
        socket.emit("symbol:subscribe", { symbol: selectedSymbolRef.current });
      }
    });

    socket.on("tick", (tickPayload: any) => {
      if (!liveMode) return;
      const tick: Tick = {
        symbol: String(tickPayload.symbol ?? "").toUpperCase(),
        price: Number(tickPayload.price ?? 0),
        size: Number(tickPayload.size ?? 0),
        ts: Number(tickPayload.ts ?? Date.now())
      };
      if (!Number.isFinite(tick.ts) || !Number.isFinite(tick.price)) return;
      if (tick.symbol !== selectedSymbolRef.current) return;
      setCandles1m((prev) => upsertLiveCandle(prev, tick, 60_000));
      setCandles5m((prev) => upsertLiveCandle(prev, tick, 5 * 60_000));
    });

    socket.on("session:snapshot:ready", async (payload: any) => {
      if (!liveMode) return;
      const sym = String(payload?.symbol ?? "").toUpperCase();
      if (sym !== selectedSymbolRef.current) return;
      const snapshot = await fetchCurrentSessionSnapshot(sym);
      if (!snapshot) return;
      setCandles1m(snapshot.candlesByTimeframe["1m"] || []);
      setCandles5m(snapshot.candlesByTimeframe["5m"] || []);
      setGaps1m(snapshot.gapsByTimeframe["1m"] || []);
      setGaps5m(snapshot.gapsByTimeframe["5m"] || []);
      setSessionInfo(snapshot.sessionInfo || emptySessionInfo);
    });

    return () => {
      setConnected(false);
      socketRef.current = null;
      socket.disconnect();
    };
  }, [liveMode]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;
    socket.emit("symbol:subscribe", { symbol: selectedSymbolRef.current });
  }, [trackedSymbolsKey, liveMode]);

  const selectedCandles = useMemo(() => {
    if (timeframe === "5m") return candles5m;
    return candles1m;
  }, [timeframe, candles1m, candles5m]);

  const selectedGaps = useMemo(() => {
    if (timeframe === "5m") return gaps5m;
    return gaps1m;
  }, [timeframe, gaps1m, gaps5m]);

  const setStopLossPrice = (nextStopLossPrice: number) => {
    const next = Number(nextStopLossPrice);
    if (!Number.isFinite(next) || next < 0) return;
    setHud((prev) => ({ ...prev, stopLossPrice: next }));
    socketRef.current?.emit("stopLoss:set", {
      symbol: selectedSymbolRef.current,
      stopLossPrice: next
    });
  };

  return {
    hud,
    candles: selectedCandles,
    gaps: selectedGaps,
    timeframe,
    setTimeframe,
    waitingForLiveData: liveMode && selectedCandles.length === 0,
    historyPreloading,
    connected,
    sessionInfo,
    accountSettings,
    accountMode,
    isLong,
    tradeResult,
    tradeState,
    setStopLossPrice
  };
}

