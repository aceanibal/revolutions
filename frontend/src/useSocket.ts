import { useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { Candle, HudState, Tick, Timeframe } from "./types";
import { fetchAccountBalance, fetchHistoricalCandles } from "./lib/api";
import { buildDisplayCandles } from "./lib/display";

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

export function useSocket(selectedSymbol: string) {
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
  const [history1m, setHistory1m] = useState<Candle[]>([]);
  const [history5m, setHistory5m] = useState<Candle[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe | null>("1m");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket: Socket = io("/", { path: "/socket.io" });

    socket.on("connect", () => {
      setConnected(true);
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
      setCandles1m([]);
      setCandles5m([]);
      setHistory1m([]);
      setHistory5m([]);
      setHistoryLoading(true);
    });

    socket.on("priceUpdate", (payload: any) => {
      const symbol = String(payload.symbol ?? "").toUpperCase();
      const price = Number(payload.price ?? 0);
      const ts = Number(payload.ts ?? Date.now());

      if (symbol !== selectedSymbol) return;

      console.log("[frontend] priceUpdate", { symbol, price, ts });

      setHud((prev) => ({
        ...prev,
        price
      }));

      if (!Number.isFinite(price) || !Number.isFinite(ts)) {
        return;
      }

      const pseudoTick: Tick = {
        symbol,
        price,
        size: 0,
        ts
      };

      setCandles1m((prev) => upsertLiveCandle(prev, pseudoTick, 60_000));
      setCandles5m((prev) => upsertLiveCandle(prev, pseudoTick, 5 * 60_000));
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

      if (tick.symbol !== selectedSymbol) return;
      if (!Number.isFinite(tick.ts) || !Number.isFinite(tick.price)) {
        return;
      }

      console.log("[frontend] tick", tick);

      setCandles1m((prev) => upsertLiveCandle(prev, tick, 60_000));
      setCandles5m((prev) => upsertLiveCandle(prev, tick, 5 * 60_000));
    });

    return () => {
      setConnected(false);
      socket.disconnect();
    };
  }, []);

  // Fetch and poll history for this chart's symbol only. Runs on mount and when symbol or timeframe changes.
  useEffect(() => {
    if (!selectedSymbol || !timeframe) return;

    let cancelled = false;
    setHistoryLoading(true);
    const intervalMs = timeframe === "1m" ? 60_000 : 5 * 60_000;

    const poll = async () => {
      const history = await fetchHistoricalCandles(selectedSymbol, timeframe).catch(() => []);
      if (cancelled) return;

      if (timeframe === "1m") {
        setHistory1m(history);
        setCandles1m([]);
      } else if (timeframe === "5m") {
        setHistory5m(history);
        setCandles5m([]);
      }
      setHistoryLoading(false);
    };

    // Initial fetch for this chart load
    void poll();
    // Poll once per candle interval to keep volume in sync
    const id = setInterval(poll, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [selectedSymbol, timeframe]);

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
    if (timeframe === "5m") return buildDisplayCandles(history5m, candles5m);
    if (timeframe === "1m") return buildDisplayCandles(history1m, candles1m);
    return [];
  }, [timeframe, history1m, history5m, candles1m, candles5m]);

  return {
    hud,
    candles: selectedCandles,
    timeframe,
    setTimeframe,
    historyLoading,
    connected
  };
}

