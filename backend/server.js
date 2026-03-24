const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const {
  computePositionSize,
  emitHudUpdate: accountEmitHudUpdate,
  fetchAccountBalance,
  clearAccountCache,
  isAccountConfiguredForMode,
  fetchClearinghouseState,
  fetchSpotClearinghouseState,
  fetchUserFills,
  fetchUserFees,
  fetchMeta,
  fetchOpenOrders,
  normalizeAccountOverview,
  normalizePositions,
  normalizeFills,
  normalizeFeeRates,
  normalizeMetaForSymbol,
  computeLeveragePreview,
  computeStopLossProjections,
  loadSettings,
  getSettings,
  patchSettings,
  executeTrade,
  placeStopLoss,
  placeBracketOrders,
  updateStopLoss,
  executeAzizExit,
  closePosition,
  cancelOrderById,
  cancelAllOrders
} = require("./hyperliquid");
const { connectHyperliquidWs, subscribeToSymbol, unsubscribeFromSymbol } = require("./priceStream");
const { setupKeyboardController } = require("./controller");
const { SessionStore } = require("./sessionStore");
const { detectGapRanges, intervalForTimeframe, upsertCandle } = require("./sessionMath");
const {
  createTradeStateStore,
  inferExchangeStopLossFromPendingOrders,
  inferExchangeTakeProfitFromPendingOrders,
  hyperliquidOpenOrderStopTriggerPx,
  normalizeMode: normalizeTradeMode
} = require("./tradeState");

const PORT = process.env.PORT || 3000;
const HYPERLIQUID_WS_URL =
  process.env.HYPERLIQUID_WS_URL || "wss://api.hyperliquid.xyz/ws";
const DEFAULT_SYMBOL = "";
const DEFAULT_STOP_LOSS_PRICE = 0;
const ARCHIVE_ON_SHUTDOWN = String(process.env.SESSION_ARCHIVE_ON_SHUTDOWN || "")
  .trim()
  .toLowerCase() === "true";
const MIN_ORDER_NOTIONAL = 10;
const EXECUTION_ENTRY_SLIPPAGE_BPS = 200;
const EXECUTION_STOP_SLIPPAGE_BPS = 300;
const EXECUTION_TOTAL_SLIPPAGE_BPS = EXECUTION_ENTRY_SLIPPAGE_BPS + EXECUTION_STOP_SLIPPAGE_BPS;
const TRADE_MANAGER_VERBOSE =
  String(process.env.TRADE_MANAGER_VERBOSE || "")
    .trim()
    .toLowerCase() === "true";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false
  }
});

// Basic CORS handling for REST API (including preflight) - allow all origins and common methods
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json());

// Backend focuses on API + Socket.io streaming.
// Frontend (React/Vite/etc.) should live in a separate project
// and connect over Socket.io using the same events used below.

// Primary symbol is the one used for HUD/account logic.
let primarySymbol = DEFAULT_SYMBOL;
// All symbols we maintain active Hyperliquid streams for.
const activeSymbols = new Set();
const stopLossBySymbol = new Map(); // symbol -> price
const lastPriceBySymbol = new Map(); // symbol -> latest streamed price
let accountMode = "live";
const activePositionBySymbol = new Map();
const isLongBySymbol = new Map(); // symbol -> true(long), false(short)
let balance = 0;
let lastPrice = 0;

// ---------------------------------------------------------------------------
// Stop-loss step (dpadUp/dpadDown)
// Uses ATR * k where ATR comes from recent in-memory 1m candles, and the
// final step is rounded UP to the smallest candle-based price increment.
// ---------------------------------------------------------------------------
const ATR_TIMEFRAME = "1m";
const ATR_PERIOD = 14;
const ATR_CANDLE_MAX = 120; // cap in-memory candles per symbol

const atrIntervalMs = intervalForTimeframe(ATR_TIMEFRAME);
const candleMapsForAtrBySymbol = new Map(); // symbol -> Map(bucketStartMs -> candle)
const atrInfoBySymbol = new Map(); // symbol -> { atr: number, tickInc: number }
const atrLastBucketStartBySymbol = new Map(); // symbol -> bucketStartMs

function getOrCreateAtrCandleMap(symbol) {
  if (!candleMapsForAtrBySymbol.has(symbol)) {
    candleMapsForAtrBySymbol.set(symbol, new Map());
  }
  return candleMapsForAtrBySymbol.get(symbol);
}

function fallbackTickInc(price) {
  if (!Number.isFinite(price) || price <= 0) return 0.01;
  if (price >= 1000) return 1;
  if (price >= 100) return 0.1;
  if (price >= 10) return 0.01;
  if (price >= 1) return 0.001;
  if (price >= 0.1) return 0.0001;
  return 0.000001;
}

function roundUpToIncrement(value, increment) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(increment) || increment <= 0) return value;

  // tickInc is usually a power-of-ten (derived from candle diffs). Using pow10
  // arithmetic avoids most floating rounding surprises.
  const decimals = Math.round(-Math.log10(increment));
  if (decimals < 0 || decimals > 12) {
    // Fallback for weird increments: still do a basic ceil.
    return Math.ceil(value / increment) * increment;
  }
  const factor = Math.pow(10, decimals);
  const scaled = value * factor;
  return Math.ceil(scaled - 1e-12) / factor;
}

function computeTickIncFromCandles(candles, fallbackPrice) {
  const ordered = Array.isArray(candles) ? [...candles].sort((a, b) => a.timeMs - b.timeMs) : [];
  if (ordered.length < 3) return fallbackTickInc(fallbackPrice);

  const closes = ordered.map((c) => Number(c.close)).filter((v) => Number.isFinite(v));
  if (closes.length < 2) return fallbackTickInc(fallbackPrice);

  let minDiff = Infinity;
  for (let i = 1; i < closes.length; i += 1) {
    const diff = Math.abs(closes[i] - closes[i - 1]);
    if (!Number.isFinite(diff) || diff <= 0) continue;
    if (diff < minDiff) minDiff = diff;
  }

  if (!Number.isFinite(minDiff) || minDiff <= 0) return fallbackTickInc(fallbackPrice);

  // Convert minDiff to a power-of-ten tick. This acts like "lowest chart step"
  // without needing exchange tickSize metadata.
  const decimals = Math.min(8, Math.max(0, Math.round(-Math.log10(minDiff))));
  const tickInc = Math.pow(10, -decimals);
  return tickInc > 0 ? tickInc : fallbackTickInc(fallbackPrice);
}

function computeAtrFromCandles(candles) {
  const ordered = Array.isArray(candles) ? [...candles].sort((a, b) => a.timeMs - b.timeMs) : [];
  if (ordered.length < 2) return null;

  // Use up to ATR_PERIOD TR values from the tail.
  const usableTrCount = Math.min(ATR_PERIOD, ordered.length - 1);
  const startIdx = ordered.length - usableTrCount - 1; // inclusive, so we have prev close

  const trs = [];
  for (let i = startIdx + 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    const hl = Math.max(0, Number(cur.high) - Number(cur.low));
    const hp = Math.abs(Number(cur.high) - Number(prev.close));
    const lp = Math.abs(Number(cur.low) - Number(prev.close));
    const tr = Math.max(hl, hp, lp);
    if (Number.isFinite(tr) && tr >= 0) trs.push(tr);
  }

  if (trs.length === 0) return null;
  const sum = trs.reduce((a, b) => a + b, 0);
  return sum / trs.length;
}

function updateAtrForTick(symbol, { price, ts, size } = {}) {
  if (!symbol) return;
  if (!Number.isFinite(price) || price <= 0) return;
  if (!Number.isFinite(ts)) return;

  const bucketStart = Math.floor(ts / atrIntervalMs) * atrIntervalMs;
  const candleMap = getOrCreateAtrCandleMap(symbol);

  // Maintain a bounded candle history in-memory.
  if (candleMap.size > ATR_CANDLE_MAX) {
    const entries = Array.from(candleMap.entries()).sort((a, b) => a[0] - b[0]);
    const toDrop = candleMap.size - ATR_CANDLE_MAX;
    for (let i = 0; i < toDrop; i += 1) {
      candleMap.delete(entries[i][0]);
    }
  }

  upsertCandle(candleMap, { symbol, price, size: size ?? 0, ts }, atrIntervalMs, "live");

  const lastBucketStart = atrLastBucketStartBySymbol.get(symbol);
  if (lastBucketStart === bucketStart) return; // only recompute when a new bucket starts
  atrLastBucketStartBySymbol.set(symbol, bucketStart);

  const candles = Array.from(candleMap.values());
  const atr = computeAtrFromCandles(candles);
  if (!Number.isFinite(atr) || atr <= 0) return;

  const tickInc = computeTickIncFromCandles(candles, price);
  if (!Number.isFinite(tickInc) || tickInc <= 0) return;

  atrInfoBySymbol.set(symbol, { atr, tickInc });
}

function getAtrStopLossStep() {
  const settings = getSettings();
  const k = Number.isFinite(settings?.stopLossStep) ? Number(settings.stopLossStep) : 0.5;

  const atrInfo = atrInfoBySymbol.get(primarySymbol);
  if (atrInfo?.atr && atrInfo?.tickInc) {
    const raw = atrInfo.atr * k;
    const step = roundUpToIncrement(raw, atrInfo.tickInc);
    return step > 0 ? step : atrInfo.tickInc;
  }

  // If ATR isn't ready yet, fall back to a tiny chart-based increment.
  const primaryPrice = getLatestPriceForSymbol(primarySymbol);
  const inc = fallbackTickInc(primaryPrice > 0 ? primaryPrice : lastPrice);
  const raw = inc * Math.max(0.1, k);
  return roundUpToIncrement(raw, inc) || inc;
}

function getStopLossPrice(symbol) {
  if (!symbol) return 0;
  const v = stopLossBySymbol.get(symbol);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function getLatestPriceForSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return 0;
  const v = Number(lastPriceBySymbol.get(normalized) ?? 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function syncPrimaryLastPrice() {
  const next = getLatestPriceForSymbol(primarySymbol);
  if (next > 0) {
    lastPrice = next;
  }
}

function getDirectionForSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return true;
  const existing = isLongBySymbol.get(normalized);
  if (typeof existing === "boolean") return existing;
  isLongBySymbol.set(normalized, true);
  return true;
}

function setDirectionForSymbol(symbol, isLong) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return;
  isLongBySymbol.set(normalized, Boolean(isLong));
}

function emitDirectionUpdate(target, symbol = primarySymbol) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return;
  const payload = { symbol: normalized, isLong: getDirectionForSymbol(normalized) };
  if (target && typeof target.emit === "function") {
    target.emit("direction:update", payload);
  } else {
    io.emit("direction:update", payload);
  }
}

let seenFirstDataForSymbol = new Set();
let cleanupKeyboardController = null;
let sessionRolloverIntervalId = null;

const sessionStore = new SessionStore();
const tradeState = createTradeStateStore({
  onUpdate: (state) => {
    void persistTradeStateSnapshots([state]);
    const sym = normalizeSymbol(state.symbol);
    if (!sym || normalizeTradeMode(state.mode) !== normalizeTradeMode(accountMode)) return;
    const prim = normalizeSymbol(primarySymbol);
    if (!activeSymbols.has(sym) && sym !== prim) return;
    io.emit("tradeState:update", state);
  }
});

function logTradeStateDebug(_label, _payload) {
  /* Optional reconcile tracing (currently disabled). */
}

function logTradeManager(message, payload = undefined) {
  if (!TRADE_MANAGER_VERBOSE) return;
  if (payload === undefined) {
    console.log(`[trade-manager] ${message}`);
    return;
  }
  console.log(`[trade-manager] ${message}`, payload);
}

function emitTradeStateSnapshot(target, symbol = primarySymbol, mode = accountMode) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized || !target || typeof target.emit !== "function") return;
  target.emit("tradeState:snapshot", tradeState.getClientSnapshot(normalized, mode));
}

async function persistTradeStateSnapshots(states = null) {
  const snapshots = Array.isArray(states) ? states : tradeState.getAll({ mode: accountMode });
  if (!snapshots.length) return { saved: 0, skipped: true };
  try {
    const sessionId = await sessionStore.getCurrentSessionId();
    if (!sessionId) return { saved: 0, skipped: true };
    const saved = await sessionStore.persistTradeStateSnapshots(sessionId, snapshots);
    return { saved, skipped: false, sessionId };
  } catch (error) {
    console.log("[server] Failed to persist trade-state snapshots:", error?.message || error);
    return { saved: 0, skipped: false, error: error?.message || String(error) };
  }
}

function getTrackedStopOrder(symbol, mode = accountMode) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return null;
  return tradeState.get(normalized, mode).stopOrderRef || null;
}

async function refreshPendingOrdersForSymbol(symbol, mode = accountMode) {
  if (!isAccountConfiguredForMode(mode)) return [];
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return [];
  try {
    const orders = await fetchOpenOrders(mode);
    if (TRADE_MANAGER_VERBOSE && !Array.isArray(orders)) {
      const safeJson = (v) => {
        try {
          return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
        } catch {
          return String(v);
        }
      };
      console.log(
        "[server] frontendOpenOrders unexpected response shape",
        `mode=${mode} symbol=${normalized}`,
        "type=",
        typeof orders,
        "payload=",
        safeJson(orders)
      );
    }
    const pendingOrders = (Array.isArray(orders) ? orders : []).filter(
      (order) => String(order?.coin || "").toUpperCase() === normalized
    );
    tradeState.setPendingOrders({ symbol: normalized, mode, pendingOrders });
    return tradeState.get(normalized, mode).pendingOrders;
  } catch (error) {
    if (TRADE_MANAGER_VERBOSE) {
      console.log("[server] refreshPendingOrdersForSymbol error:", error?.message || error);
    }
    return [];
  }
}

async function reconcileTradeStateForSymbol(symbol, mode = accountMode, options = {}) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return null;
  const controllerStopLoss = Number.isFinite(options.stopLoss)
    ? Number(options.stopLoss)
    : getStopLossPrice(normalized);
  const pendingOrders = options.pendingOrders || (await refreshPendingOrdersForSymbol(normalized, mode));
  const inferredStopPlacedLoose = (() => {
    const rows = Array.isArray(pendingOrders) ? pendingOrders : [];
    const cand = [];
    for (const order of rows) {
      const px = hyperliquidOpenOrderStopTriggerPx(order);
      if (px == null) continue;
      const ts = Number(order?.timestamp ?? order?.time ?? 0) || 0;
      const oid = Number(order?.oid ?? 0) || 0;
      cand.push({ px, ts, oid });
    }
    if (cand.length === 0) return 0;
    cand.sort((a, b) => {
      if (b.ts !== a.ts) return b.ts - a.ts;
      return b.oid - a.oid;
    });
    return cand[0].px;
  })();
  let position = activePositionBySymbol.get(normalized) || null;
  const preTradeState = tradeState.get(normalized, mode);
  const closedAtMs = Number(preTradeState?.executionMeta?.closedAtMs ?? 0);
  const staleCloseGraceMs = 8000;
  if (
    preTradeState?.status === "FLAT" &&
    preTradeState?.lastAction === "circle" &&
    Number.isFinite(closedAtMs) &&
    closedAtMs > 0 &&
    Date.now() - closedAtMs < staleCloseGraceMs &&
    position &&
    Math.abs(Number(position?.szi ?? 0)) > 0
  ) {
    if (TRADE_MANAGER_VERBOSE) {
      console.log("[tradeState] reconcile: treat clearinghouse position as stale after full close", {
        mode,
        symbol: normalized,
        szi: Number(position?.szi ?? 0)
      });
    }
    activePositionBySymbol.set(normalized, null);
    position = null;
  }

  const posSzi = position ? Number(position?.szi ?? 0) : 0;
  const posSide =
    position && Number.isFinite(posSzi) && Math.abs(posSzi) > 0
      ? posSzi > 0
        ? "long"
        : "short"
      : null;
  const entryPxForInfer = position ? Number(position?.entryPx ?? 0) : 0;
  const orderStopPx =
    posSide && Array.isArray(pendingOrders) && pendingOrders.length > 0
      ? inferExchangeStopLossFromPendingOrders(pendingOrders, {
          side: posSide,
          entryPx: Number.isFinite(entryPxForInfer) && entryPxForInfer > 0 ? entryPxForInfer : null
        })
      : null;

  const orderTpPx =
    posSide && Array.isArray(pendingOrders) && pendingOrders.length > 0
      ? inferExchangeTakeProfitFromPendingOrders(pendingOrders, {
          side: posSide,
          entryPx: Number.isFinite(entryPxForInfer) && entryPxForInfer > 0 ? entryPxForInfer : null
        })
      : null;

  const stopLossFromPendingOrders =
    orderStopPx != null && Number.isFinite(orderStopPx) && orderStopPx > 0 ? orderStopPx : 0;

  const takeProfitFromPendingOrders =
    orderTpPx != null && Number.isFinite(orderTpPx) && orderTpPx > 0 ? orderTpPx : 0;

  const stopLossForReconcile =
    stopLossFromPendingOrders > 0 ? stopLossFromPendingOrders : controllerStopLoss;

  const executionMeta = { ...(options.executionMeta || {}) };
  if (!Number.isFinite(Number(executionMeta.stopLossPlaced)) || Number(executionMeta.stopLossPlaced) <= 0) {
    if (orderStopPx != null && Number.isFinite(orderStopPx) && orderStopPx > 0) {
      executionMeta.stopLossPlaced = orderStopPx;
    } else if (Number.isFinite(inferredStopPlacedLoose) && inferredStopPlacedLoose > 0) {
      executionMeta.stopLossPlaced = inferredStopPlacedLoose;
    }
  }

  const stopOrderRef = getTrackedStopOrder(normalized, mode);
  logTradeStateDebug("reconcile:input", {
    mode,
    symbol: normalized,
    stopLoss: stopLossForReconcile,
    controllerStopLoss,
    orderStopFromOpenOrders: orderStopPx,
    hasPosition: Boolean(position),
    position: position
      ? {
          szi: Number(position?.szi ?? 0),
          entryPx: Number(position?.entryPx ?? 0),
          coin: String(position?.coin || "")
        }
      : null,
    pendingOrdersCount: Array.isArray(pendingOrders) ? pendingOrders.length : 0,
    stopOrderRef
  });
  const next = tradeState.reconcileFromAccountSnapshot({
    symbol: normalized,
    mode,
    position,
    stopLoss: stopLossForReconcile,
    stopLossFromPendingOrders,
    takeProfitFromPendingOrders,
    stopOrderRef,
    pendingOrders,
    lastAction: options.lastAction || "reconcile",
    executionMeta
  });
  if (
    (preTradeState?.status === "OPEN" ||
      preTradeState?.status === "PENDING_OPEN" ||
      preTradeState?.status === "PENDING_CLOSE") &&
    next?.status === "FLAT"
  ) {
    if (TRADE_MANAGER_VERBOSE) {
      console.log("[tradeState] exchange shows no position — trade state set to FLAT", {
        mode,
        symbol: normalized,
        lastAction: next?.lastAction || null,
        hadSize: Number(preTradeState?.size ?? 0) || null
      });
    }
  }
  logTradeStateDebug("reconcile:output", {
    mode: next.mode,
    symbol: next.symbol,
    status: next.status,
    side: next.side,
    size: next.size,
    entryPx: next.entryPx,
    stopLoss: next.stopLoss,
    stopLossFromPendingOrders: next.stopLossFromPendingOrders,
    takeProfitFromPendingOrders: next.takeProfitFromPendingOrders,
    pendingOrdersCount: Array.isArray(next.pendingOrders) ? next.pendingOrders.length : 0,
    stopOrderRef: next.stopOrderRef || null
  });
  return next;
}

async function preloadSymbolHistory(symbol, options = {}) {
  const force = Boolean(options.force);
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return;
  console.log(`[server] preloadSymbolHistory start symbol=${normalized} force=${force}`);
  try {
    const result = await sessionStore.preloadHistoricalForSymbol(normalized, { force });
    if (result?.sessionInfo) {
      io.emit("session:update", result.sessionInfo);
    }
    if (!result?.sessionId) {
      console.log(
        `[server] preloadSymbolHistory skipped symbol=${normalized} reason=${
          result?.reason || "no-active-persisted-session"
        }`
      );
    }
    console.log(
      `[server] preloadSymbolHistory done symbol=${normalized} session=${result?.sessionId || "n/a"}`
    );
    if (result?.sessionId) {
      io.emit("session:snapshot:ready", {
        symbol: normalized,
        sessionId: result.sessionId
      });
    }
  } catch (error) {
    console.log("History preload warning:", error?.message || error);
  }
}

async function buildDirectHistorySnapshot(symbol) {
  const upper = normalizeSymbol(symbol);
  if (!upper) return null;

  const [candles1mRaw, candles5mRaw] = await Promise.all([
    sessionStore.fetchHistoricalCandles(upper, "1m"),
    sessionStore.fetchHistoricalCandles(upper, "5m")
  ]);

  const candles1m = candles1mRaw.map((c) => ({ ...c, source: "history", isGapFill: false }));
  const candles5m = candles5mRaw.map((c) => ({ ...c, source: "history", isGapFill: false }));

  const startedAtMs =
    (candles1m.length > 0 ? candles1m[0].timeMs : candles5m.length > 0 ? candles5m[0].timeMs : Date.now()) ||
    Date.now();

  return {
    sessionInfo: {
      id: `direct-history-${upper}`,
      status: "active",
      startedAtMs,
      lastEventAtMs: null,
      assetCount: 1,
      candleCount: candles1m.length + candles5m.length,
      breakReason: null
    },
    symbol: upper,
    candlesByTimeframe: {
      "1m": candles1m,
      "5m": candles5m
    },
    gapsByTimeframe: {
      "1m": detectGapRanges(candles1m, intervalForTimeframe("1m")),
      "5m": detectGapRanges(candles5m, intervalForTimeframe("5m"))
    }
  };
}

async function hydrateStartupStreams() {
  try {
    const restored = await sessionStore.getStartupSymbols();
    const symbols = Array.isArray(restored?.symbols) ? restored.symbols : [];
    for (const symbol of symbols) {
      if (symbol) activeSymbols.add(symbol);
    }
    const restoredPrimary = normalizeSymbol(restored?.primary || "");
    if (restoredPrimary) {
      primarySymbol = restoredPrimary;
      getDirectionForSymbol(primarySymbol);
    } else if (!primarySymbol && symbols.length > 0) {
      primarySymbol = symbols[0];
      getDirectionForSymbol(primarySymbol);
    }
    if (symbols.length > 0) {
      console.log(
        `[server] Restored startup streams source=${restored.source} session=${restored.sessionId || "n/a"} symbols=${symbols.join(",")} primary=${primarySymbol || ""}`
      );
    } else {
      console.log("[server] No startup streams restored from prior sessions");
    }
    void sessionStore.writeActiveStreamsSnapshot({
      symbols: Array.from(activeSymbols),
      primary: primarySymbol
    });
  } catch (error) {
    console.log("Startup stream restore warning:", error?.message || error);
  }
}

// REST API to update the primary symbol (ensures it is part of the active streams set).
app.post("/api/change-symbol", async (req, res) => {
  const nextSymbol = normalizeSymbol(req.body?.symbol);
  if (!nextSymbol || nextSymbol === primarySymbol) {
    return res.status(400).json({ ok: false, message: "Invalid or unchanged symbol" });
  }

  console.log("changeSymbol via REST (primary symbol):", nextSymbol);

  // Ensure the symbol is streaming.
  if (!activeSymbols.has(nextSymbol)) {
    activeSymbols.add(nextSymbol);
    subscribeToSymbol(nextSymbol);
  }

  primarySymbol = nextSymbol;
  seenFirstDataForSymbol.delete(primarySymbol);
  getDirectionForSymbol(primarySymbol);
  syncPrimaryLastPrice();

  // Notify all clients about the new primary and updated streams.
  io.emit("symbolChanged", { symbol: primarySymbol });
  io.emit("streams:update", {
    symbols: Array.from(activeSymbols),
    primary: primarySymbol
  });
  emitDirectionUpdate();
  emitHudUpdate();

  await preloadSymbolHistory(nextSymbol);
  void sessionStore.writeActiveStreamsSnapshot({
    symbols: Array.from(activeSymbols),
    primary: primarySymbol
  });
  res.json({ ok: true, symbol: primarySymbol });
});

// Helper to emit the current streams state to a specific socket or all.
function emitStreamsUpdate(target) {
  void sessionStore.writeActiveStreamsSnapshot({
    symbols: Array.from(activeSymbols),
    primary: primarySymbol
  });
  const payload = {
    symbols: Array.from(activeSymbols),
    primary: primarySymbol
  };
  if (target && typeof target.emit === "function") {
    target.emit("streams:update", payload);
  } else {
    io.emit("streams:update", payload);
  }
}

// Streams management API
app.get("/api/streams", (req, res) => {
  res.json({
    symbols: Array.from(activeSymbols),
    primary: primarySymbol
  });
});

app.post("/api/streams", async (req, res) => {
  const symbol = normalizeSymbol(req.body?.symbol);
  if (!symbol) {
    return res.status(400).json({ ok: false, message: "Missing symbol" });
  }

  if (!activeSymbols.has(symbol)) {
    activeSymbols.add(symbol);
    subscribeToSymbol(symbol);
  }

  await preloadSymbolHistory(symbol);

  // Do not auto-change primary here; frontend will call /api/change-symbol when needed.
  emitStreamsUpdate();

  res.json({
    ok: true,
    symbols: Array.from(activeSymbols),
    primary: primarySymbol
  });
});

app.delete("/api/streams/:symbol", (req, res) => {
  const symbol = normalizeSymbol(req.params.symbol);
  if (!symbol || !activeSymbols.has(symbol)) {
    return res.status(404).json({ ok: false, message: "Symbol not found in active streams" });
  }

  if (activeSymbols.size === 1) {
    return res
      .status(400)
      .json({ ok: false, message: "Cannot remove the last active stream symbol" });
  }

  activeSymbols.delete(symbol);
  unsubscribeFromSymbol(symbol);
  tradeState.deleteKey(symbol, accountMode);
  activePositionBySymbol.delete(symbol);
  stopLossBySymbol.delete(symbol);

  // Promote a new primary if we removed the current one.
  if (symbol === primarySymbol) {
    const [first] = Array.from(activeSymbols);
    if (first) {
      primarySymbol = first;
      seenFirstDataForSymbol.delete(primarySymbol);
      getDirectionForSymbol(primarySymbol);
      io.emit("symbolChanged", { symbol: primarySymbol });
      emitDirectionUpdate();
    }
  }

  emitStreamsUpdate();

  res.json({
    ok: true,
    symbols: Array.from(activeSymbols),
    primary: primarySymbol
  });
});

app.get("/api/session/current", async (req, res) => {
  const symbol = normalizeSymbol(req.query?.symbol || primarySymbol);
  const timeframeRaw = String(req.query?.timeframe || "all").toLowerCase();
  const timeframe = timeframeRaw === "1m" || timeframeRaw === "5m" ? timeframeRaw : "all";

  try {
    const snapshot = await sessionStore.getCurrentSessionSnapshot(symbol, timeframe);
    if (!snapshot) {
      const directSnapshot = await buildDirectHistorySnapshot(symbol);
      if (!directSnapshot) {
        return res.status(404).json({ ok: false, message: "No active session found" });
      }
      console.log(`[server] /api/session/current using direct history fallback symbol=${symbol}`);
      return res.json({ ok: true, ...directSnapshot });
    }
    res.json({ ok: true, ...snapshot });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Failed to load current session" });
  }
});

app.get("/api/session/active-id", async (req, res) => {
  try {
    const sessionId = await sessionStore.getCurrentSessionId();
    res.json({ ok: true, sessionId: sessionId || null });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Failed to read active session id" });
  }
});

async function persistSessionTradesForMode({ sessionId, mode, startedAtMs, endedAtMs }) {
  if (!isAccountConfiguredForMode(mode)) {
    return { mode, saved: 0, skipped: true };
  }
  try {
    const payload = await fetchUserFills(mode);
    const fills = normalizeFills(payload);
    const since = Number(startedAtMs || 0);
    const until = Number(endedAtMs || Date.now());
    const filtered = fills.filter((fill) => {
      const ts = Number(fill?.time || 0);
      return Number.isFinite(ts) && ts >= since && ts <= until;
    });
    const saved = await sessionStore.persistTrades(sessionId, filtered, mode);
    return { mode, saved, skipped: false };
  } catch (error) {
    console.log(`[server] Failed to persist ${mode} trades for session ${sessionId}:`, error?.message || error);
    return { mode, saved: 0, skipped: false, error: error?.message || String(error) };
  }
}

async function persistSessionTradeStateForMode({ sessionId, mode }) {
  try {
    const snapshots = tradeState.getAll({ mode });
    if (snapshots.length === 0) {
      return { mode, saved: 0, skipped: true };
    }
    const saved = await sessionStore.persistTradeStateSnapshots(sessionId, snapshots);
    return { mode, saved, skipped: false };
  } catch (error) {
    console.log(
      `[server] Failed to persist ${mode} trade-state snapshots for session ${sessionId}:`,
      error?.message || error
    );
    return { mode, saved: 0, skipped: false, error: error?.message || String(error) };
  }
}

app.post("/api/session/save", async (req, res) => {
  try {
    const requestedSessionId = String(req.body?.sessionId || "").trim();
    const sessionId = requestedSessionId || (await sessionStore.getCurrentSessionId());
    if (!sessionId) {
      return res.status(404).json({ ok: false, message: "No active session found to save" });
    }
    await sessionStore.writeActiveStreamsSnapshot({
      symbols: Array.from(activeSymbols),
      primary: primarySymbol
    });
    const payload = await sessionStore.saveSessionCheckpoint(sessionId, Date.now(), "manual_save");
    if (!payload) {
      return res.status(404).json({ ok: false, message: "Session not found or unavailable for save" });
    }
    const startedAtMs = Number(payload.startedAtMs || 0);
    const endedAtMs = Number(payload.lastSavedAtMs || Date.now());
    const tradePersistence = await Promise.all([
      persistSessionTradesForMode({ sessionId, mode: "live", startedAtMs, endedAtMs }),
      persistSessionTradesForMode({ sessionId, mode: "test", startedAtMs, endedAtMs })
    ]);
    const tradeStatePersistence = await Promise.all([
      persistSessionTradeStateForMode({ sessionId, mode: "live" }),
      persistSessionTradeStateForMode({ sessionId, mode: "test" })
    ]);
    const sessionInfo = await sessionStore.getSessionInfo(sessionId);
    return res.json({
      ok: true,
      sessionId,
      sessionInfo,
      tradePersistence,
      tradeStatePersistence,
      persistence: sessionStore.getPersistenceStatus()
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to save session" });
  }
});

app.get("/api/sessions", async (req, res) => {
  const date = String(req.query?.date || "today").toLowerCase();
  if (date !== "today") {
    return res.status(400).json({ ok: false, message: "Only date=today is currently supported" });
  }

  try {
    const sessions = await sessionStore.listTodaySessions();
    res.json({ ok: true, sessions });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Failed to list sessions" });
  }
});

app.get("/api/sessions/all", async (req, res) => {
  try {
    const sessions = await sessionStore.listAllSessions();
    res.json({ ok: true, sessions });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Failed to list saved sessions" });
  }
});

app.get("/api/sessions/:id/symbols", async (req, res) => {
  const sessionId = String(req.params?.id || "").trim();
  if (!sessionId) {
    return res.status(400).json({ ok: false, message: "Missing session id" });
  }

  try {
    const symbols = await sessionStore.getSessionSymbols(sessionId);
    return res.json({ ok: true, sessionId, symbols });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to load session symbols" });
  }
});

app.get("/api/sessions/:id/notes", async (req, res) => {
  const sessionId = String(req.params?.id || "").trim();
  if (!sessionId) {
    return res.status(400).json({ ok: false, message: "Missing session id" });
  }

  try {
    const notes = await sessionStore.getSessionNotes(sessionId);
    return res.json({ ok: true, sessionId, notes });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to load session notes" });
  }
});

app.get("/api/sessions/:id/trades", async (req, res) => {
  const sessionId = String(req.params?.id || "").trim();
  if (!sessionId) {
    return res.status(400).json({ ok: false, message: "Missing session id" });
  }
  try {
    const trades = await sessionStore.getSessionTrades(sessionId);
    return res.json({ ok: true, sessionId, trades });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to load session trades" });
  }
});

app.get("/api/sessions/:id/trade-state", async (req, res) => {
  const sessionId = String(req.params?.id || "").trim();
  if (!sessionId) {
    return res.status(400).json({ ok: false, message: "Missing session id" });
  }
  const modeRaw = String(req.query?.mode || "").toLowerCase();
  const mode = modeRaw === "live" || modeRaw === "test" ? modeRaw : "";
  const symbol = normalizeSymbol(req.query?.symbol || "");
  try {
    const states = await sessionStore.getSessionTradeState(sessionId, {
      mode: mode || undefined,
      symbol: symbol || undefined
    });
    return res.json({ ok: true, sessionId, mode: mode || null, symbol: symbol || null, states });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to load session trade state" });
  }
});

app.put("/api/sessions/:id/notes", async (req, res) => {
  const sessionId = String(req.params?.id || "").trim();
  if (!sessionId) {
    return res.status(400).json({ ok: false, message: "Missing session id" });
  }

  const notes = String(req.body?.notes || "");
  if (notes.length > 20_000) {
    return res.status(400).json({ ok: false, message: "Notes too long (max 20,000 characters)" });
  }

  try {
    const saved = await sessionStore.saveSessionNotes(sessionId, notes);
    if (!saved) {
      return res.status(404).json({ ok: false, message: "Session not found or SQLite unavailable" });
    }
    return res.json({ ok: true, ...saved });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to save session notes" });
  }
});

app.get("/api/sessions/:id", async (req, res) => {
  const symbol = normalizeSymbol(req.query?.symbol || primarySymbol);
  const timeframeRaw = String(req.query?.timeframe || "all").toLowerCase();
  const timeframe = timeframeRaw === "1m" || timeframeRaw === "5m" ? timeframeRaw : "all";
  const sessionId = String(req.params?.id || "").trim();
  if (!sessionId) {
    return res.status(400).json({ ok: false, message: "Missing session id" });
  }

  try {
    const snapshot = await sessionStore.getSessionSnapshot(sessionId, symbol, timeframe);
    if (!snapshot) {
      return res.status(404).json({ ok: false, message: "Session not found" });
    }
    res.json({ ok: true, ...snapshot });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Failed to load session" });
  }
});

app.get("/api/persistence/status", (req, res) => {
  try {
    res.json({ ok: true, ...sessionStore.getPersistenceStatus() });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Failed to read persistence status" });
  }
});

// ---------------------------------------------------------------------------
// Account API routes
// ---------------------------------------------------------------------------

function resolveMode(req) {
  const raw = String(req.query?.mode || req.body?.mode || "").toLowerCase();
  if (raw === "test" || raw === "live") return raw;
  return accountMode;
}

app.get("/api/account/overview", async (req, res) => {
  const mode = resolveMode(req);
  if (!isAccountConfiguredForMode(mode)) {
    return res.status(400).json({ ok: false, message: `No ${mode} account configured` });
  }
  try {
    const [perpsPayload, spotPayload] = await Promise.all([
      fetchClearinghouseState(mode),
      fetchSpotClearinghouseState(mode).catch(() => null)
    ]);
    const overview = normalizeAccountOverview(perpsPayload, spotPayload);
    const positions = normalizePositions(perpsPayload);
    res.json({ ok: true, mode, overview, positions });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Failed to fetch account overview" });
  }
});

app.get("/api/account/positions", async (req, res) => {
  const mode = resolveMode(req);
  if (!isAccountConfiguredForMode(mode)) {
    return res.status(400).json({ ok: false, message: `No ${mode} account configured` });
  }
  try {
    const payload = await fetchClearinghouseState(mode);
    res.json({ ok: true, mode, positions: normalizePositions(payload) });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Failed to fetch positions" });
  }
});

app.get("/api/account/fills", async (req, res) => {
  const mode = resolveMode(req);
  if (!isAccountConfiguredForMode(mode)) {
    return res.status(400).json({ ok: false, message: `No ${mode} account configured` });
  }
  try {
    const payload = await fetchUserFills(mode);
    res.json({ ok: true, mode, fills: normalizeFills(payload) });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Failed to fetch fills" });
  }
});

app.get("/api/account/fees", async (req, res) => {
  const mode = resolveMode(req);
  if (!isAccountConfiguredForMode(mode)) {
    return res.status(400).json({ ok: false, message: `No ${mode} account configured` });
  }
  try {
    const payload = await fetchUserFees(mode);
    res.json({ ok: true, mode, fees: normalizeFeeRates(payload) });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Failed to fetch fees" });
  }
});

app.post("/api/account/leverage-preview", async (req, res) => {
  const mode = resolveMode(req);
  const symbol = normalizeSymbol(req.body?.symbol || primarySymbol);
  const stopLossDistancePct = Number(req.body?.stopLossDistancePct ?? 0);
  const settings = getSettings();
  const riskBudgetPct = Number(req.body?.riskBudgetPct ?? settings.riskPercent);
  const slippageBps = Number(req.body?.slippageBps ?? settings.slippageBps);

  if (!Number.isFinite(stopLossDistancePct) || stopLossDistancePct <= 0) {
    return res.status(400).json({ ok: false, message: "stopLossDistancePct must be a positive number" });
  }

  try {
    let makerFeePct = 0.0002;
    let takerFeePct = 0.00035;
    let exchangeMaxLeverage = 50;
    let accountBalanceForMode = 0;

    if (isAccountConfiguredForMode(mode)) {
      try {
        const feesPayload = await fetchUserFees(mode);
        const fees = normalizeFeeRates(feesPayload);
        makerFeePct = fees.userAddRate || makerFeePct;
        takerFeePct = fees.userCrossRate || takerFeePct;
      } catch { /* use defaults */ }

      try {
        const modeBalance = await fetchAccountBalance(mode);
        if (Number.isFinite(modeBalance) && modeBalance >= 0) {
          accountBalanceForMode = Number(modeBalance);
        }
      } catch { /* keep fallback below */ }
    }

    if (accountBalanceForMode <= 0 && mode === accountMode && Number.isFinite(balance) && balance > 0) {
      accountBalanceForMode = Number(balance);
    }

    try {
      const metaPayload = await fetchMeta(mode);
      const symbolMeta = normalizeMetaForSymbol(metaPayload, symbol);
      if (symbolMeta) {
        exchangeMaxLeverage = symbolMeta.maxLeverage;
      }
    } catch { /* use defaults */ }

    const preview = computeLeveragePreview({
      stopLossDistancePct,
      riskBudgetPct,
      makerFeePct,
      takerFeePct,
      slippageBps,
      exchangeMaxLeverage,
      accountBalance: accountBalanceForMode,
      entryPrice: lastPrice
    });

    res.json({ ok: true, mode, symbol, preview });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Failed to compute leverage preview" });
  }
});

app.get("/api/account/settings", (req, res) => {
  res.json({ ok: true, settings: getSettings() });
});

app.patch("/api/account/settings", (req, res) => {
  const updated = patchSettings(req.body || {});
  io.emit("settings:update", updated);
  res.json({ ok: true, settings: updated });
});

app.get("/api/account/mode", (req, res) => {
  res.json({ ok: true, mode: accountMode });
});

app.patch("/api/account/mode", (req, res) => {
  const next = String(req.body?.mode || "").toLowerCase();
  if (next !== "live" && next !== "test") {
    return res.status(400).json({ ok: false, message: "Mode must be 'live' or 'test'" });
  }
  accountMode = next;
  console.log("[server] Account mode changed to:", accountMode);
  io.emit("mode:update", { mode: accountMode });
  void doFetchBalance({ force: true });
  void refreshFeeAndMetaCache();
  res.json({ ok: true, mode: accountMode });
});

app.get("/api/account/balance", async (req, res) => {
  const mode = resolveMode(req);
  if (!isAccountConfiguredForMode(mode)) {
    return res.status(400).json({ ok: false, message: `No ${mode} account configured` });
  }
  try {
    const shouldForceRefresh =
      String(req.query?.refresh || "")
        .trim()
        .toLowerCase() === "true";
    if (shouldForceRefresh) {
      clearAccountCache(mode);
    }
    const nextBalance = await fetchAccountBalance(mode);
    if (mode === accountMode && Number.isFinite(nextBalance)) {
      balance = Number(nextBalance);
      emitHudUpdate();
    }
    res.json({ ok: true, mode, balance: Number(nextBalance ?? 0) });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Failed to fetch account balance" });
  }
});

// ---------------------------------------------------------------------------
// HUD + projection helpers
// ---------------------------------------------------------------------------

let cachedFeeRates = { makerFeePct: 0.0002, takerFeePct: 0.00035 };
let cachedExchangeMaxLeverage = 50;

async function refreshFeeAndMetaCache() {
  try {
    if (isAccountConfiguredForMode(accountMode)) {
      const feesPayload = await fetchUserFees(accountMode);
      const fees = normalizeFeeRates(feesPayload);
      if (fees.userAddRate > 0) cachedFeeRates.makerFeePct = fees.userAddRate;
      if (fees.userCrossRate > 0) cachedFeeRates.takerFeePct = fees.userCrossRate;
    }
  } catch { /* keep previous */ }

  try {
    if (primarySymbol) {
      const metaPayload = await fetchMeta(accountMode);
      const symbolMeta = normalizeMetaForSymbol(metaPayload, primarySymbol);
      if (symbolMeta) cachedExchangeMaxLeverage = symbolMeta.maxLeverage;
    }
  } catch { /* keep previous */ }
}

function emitStopLossProjections() {
  const currentPrice = getLatestPriceForSymbol(primarySymbol) || lastPrice;
  const settings = getSettings();
  const stopLossPrice = getStopLossPrice(primarySymbol);
  const projections = computeStopLossProjections({
    currentPrice,
    stopLossPrice,
    accountBalance: balance,
    riskBudgetPct: settings.riskPercent,
    makerFeePct: cachedFeeRates.makerFeePct,
    takerFeePct: cachedFeeRates.takerFeePct,
    slippageBps: settings.slippageBps,
    exchangeMaxLeverage: cachedExchangeMaxLeverage
  });
  io.emit("stopLoss:projections", {
    stopLossPrice,
    currentPrice,
    ...projections
  });
}

function emitHudUpdate() {
  syncPrimaryLastPrice();
  const stopLossPrice = getStopLossPrice(primarySymbol);
  accountEmitHudUpdate(io, {
    stopLossPrice,
    balance,
    lastPrice
  });
  emitStopLossProjections();
}

function symbolsToReconcileTradeState() {
  const out = new Set();
  for (const s of activeSymbols) {
    const n = normalizeSymbol(s);
    if (n) out.add(n);
  }
  const prim = normalizeSymbol(primarySymbol);
  if (prim) out.add(prim);
  return out;
}

/**
 * Apply clearinghouse positions to activePositionBySymbol and reconcile TradeStateManager
 * only for subscribed stream symbols (+ primary). Does not touch stale map keys from
 * previously removed assets (avoids noisy upserts/logs).
 */
async function reconcileTradeStateFromClearinghousePayload(payload, { lastAction = "position_refresh" } = {}) {
  const positions = normalizePositions(payload);
  const symbols = symbolsToReconcileTradeState();
  for (const symbol of symbols) {
    const pos =
      positions.find((p) => normalizeSymbol(p.coin) === symbol) || null;
    activePositionBySymbol.set(symbol, pos);
    const inferred = inferDirectionFromPosition(pos);
    if (typeof inferred === "boolean") {
      setDirectionForSymbol(symbol, inferred);
    }
    await reconcileTradeStateForSymbol(symbol, accountMode, { lastAction });
  }
}

async function refreshActivePosition() {
  if (!isAccountConfiguredForMode(accountMode)) return;
  try {
    clearAccountCache(accountMode);
    const payload = await fetchClearinghouseState(accountMode);
    await reconcileTradeStateFromClearinghousePayload(payload, { lastAction: "position_refresh" });
  } catch (err) {
    console.log("[server] refreshActivePosition error:", err?.message || err);
  }
}

/**
 * Fetches account balance (perps + spot) and reconciles trade state from the same
 * clearinghouse snapshot (cached — no extra round trip for positions).
 */
async function doFetchBalance({ force = false } = {}) {
  if (!isAccountConfiguredForMode(accountMode)) return null;
  if (force) {
    clearAccountCache(accountMode);
  }
  try {
    const parsedBalance = await fetchAccountBalance(accountMode);
    if (Number.isFinite(parsedBalance)) {
      balance = Number(parsedBalance);
      clearAccountCache(accountMode);
      const payload = await fetchClearinghouseState(accountMode);
      await reconcileTradeStateFromClearinghousePayload(payload, { lastAction: "balance_sync" });
      console.log("Fetched balance:", { balance, mode: accountMode, force });
      emitHudUpdate();
      return balance;
    }
  } catch (error) {
    console.log("Failed to fetch balance:", error.message);
  }
  return null;
}

async function emitSessionUpdate() {
  const sessionId = await sessionStore.getCurrentSessionId();
  if (!sessionId) return;
  const sessionInfo = await sessionStore.getSessionInfo(sessionId);
  if (!sessionInfo) return;
  io.emit("session:update", sessionInfo);
}

function emitControllerEvent(button) {
  io.emit("controllerEvent", {
    button,
    action: "pressed",
    ts: Date.now()
  });
}

function emitTradeResult(payload) {
  io.emit("trade:result", {
    ts: Date.now(),
    ...payload
  });
}

function getActivePosition(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return null;
  return activePositionBySymbol.get(normalized) || null;
}

function inferDirectionFromPosition(position) {
  const size = Number(position?.szi ?? 0);
  if (!Number.isFinite(size) || size === 0) return null;
  return size > 0;
}

async function maybeRearmStopLossForPosition(symbol, position) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return null;

  const posSize = Math.abs(Number(position?.szi ?? 0));
  if (!Number.isFinite(posSize) || posSize <= 0) return null;
  const isLong = inferDirectionFromPosition(position);
  if (isLong === null) return null;
  const stopLossPrice = getStopLossPrice(normalized);
  if (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0) return null;

  await cancelAllOrders({ symbol: normalized, mode: accountMode });
  const stopResult = await placeStopLoss({
    symbol: normalized,
    isLong,
    size: posSize,
    triggerPrice: stopLossPrice,
    mode: accountMode
  });
  if (
    Number.isFinite(stopResult?.asset) &&
    Number.isFinite(stopResult?.oid) &&
    Number(stopResult.oid) > 0
  ) {
    tradeState.setStopOrderRef({
      symbol: normalized,
      mode: accountMode,
      stopOrderRef: {
        asset: Number(stopResult.asset),
        oid: Number(stopResult.oid)
      },
      stopLossPlaced: stopLossPrice
    });
  }
  return stopResult;
}

function cyclePrimarySymbol(direction) {
  const symbols = Array.from(activeSymbols);
  if (symbols.length <= 1) {
    return;
  }

  const currentIndex = symbols.indexOf(primarySymbol);
  if (currentIndex === -1) {
    return;
  }

  const step = direction === "next" ? 1 : -1;
  const nextIndex = (currentIndex + step + symbols.length) % symbols.length;
  const nextSymbol = symbols[nextIndex];
  if (!nextSymbol || nextSymbol === primarySymbol) {
    return;
  }

  primarySymbol = nextSymbol;
  seenFirstDataForSymbol.delete(primarySymbol);
  syncPrimaryLastPrice();
  console.log("Primary symbol moved via controller:", primarySymbol);
  io.emit("symbolChanged", { symbol: primarySymbol });
  emitStreamsUpdate();
  emitDirectionUpdate();
  emitHudUpdate();
}

async function executeCrossTrade() {
  const symbol = normalizeSymbol(primarySymbol);
  if (!symbol) {
    emitTradeResult({ ok: false, action: "cross", symbol: "", error: "No primary symbol selected" });
    return;
  }
  const currentState = tradeState.get(symbol, accountMode);
  if (currentState.status === "OPEN" || currentState.status === "PENDING_OPEN" || getActivePosition(symbol)) {
    emitTradeResult({ ok: false, action: "cross", symbol, error: "An active trade already exists" });
    return;
  }

  const stopLossPrice = getStopLossPrice(symbol);
  if (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0) {
    emitTradeResult({ ok: false, action: "cross", symbol, error: "Set stop loss first (F9 or drag)" });
    return;
  }
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
    emitTradeResult({ ok: false, action: "cross", symbol, error: "Live price is unavailable" });
    return;
  }
  if (!Number.isFinite(balance) || balance <= 0) {
    emitTradeResult({ ok: false, action: "cross", symbol, error: "Balance is unavailable" });
    return;
  }

  const isLong = getDirectionForSymbol(symbol);
  const stopLossDistancePct = isLong
    ? ((lastPrice - stopLossPrice) / lastPrice) * 100
    : ((stopLossPrice - lastPrice) / lastPrice) * 100;
  if (!Number.isFinite(stopLossDistancePct) || stopLossDistancePct <= 0) {
    emitTradeResult({
      ok: false,
      action: "cross",
      symbol,
      error: isLong
        ? "For LONG, stop loss must be below current price"
        : "For SHORT, stop loss must be above current price"
    });
    return;
  }

  const settings = getSettings();
  const preview = computeLeveragePreview({
    stopLossDistancePct,
    riskBudgetPct: Number(settings?.riskPercent ?? 2),
    makerFeePct: cachedFeeRates.makerFeePct,
    takerFeePct: cachedFeeRates.takerFeePct,
    slippageBps: Number(settings?.slippageBps ?? 10),
    exchangeMaxLeverage: cachedExchangeMaxLeverage,
    accountBalance: balance,
    entryPrice: lastPrice
  });
  if (!Number.isFinite(preview.positionSizeUnits) || preview.positionSizeUnits <= 0) {
    emitTradeResult({ ok: false, action: "cross", symbol, error: "Calculated position size is invalid" });
    return;
  }
  if (!Number.isFinite(preview.notionalPosition) || preview.notionalPosition < MIN_ORDER_NOTIONAL) {
    emitTradeResult({
      ok: false,
      action: "cross",
      symbol,
      error: `Position value ($${Number(preview.notionalPosition || 0).toFixed(2)}) is below minimum $${MIN_ORDER_NOTIONAL.toFixed(2)}`
    });
    return;
  }

  try {
    tradeState.applyActionStart({
      symbol,
      mode: accountMode,
      action: "cross",
      payload: {
        side: isLong ? "long" : "short",
        requestedSize: preview.positionSizeUnits,
        requestedNotional: preview.notionalPosition,
        requestedLeverage: preview.cappedLeverage,
        requestedEntryPx: lastPrice,
        requestedStopLoss: stopLossPrice,
        slippageBpsRequested: EXECUTION_TOTAL_SLIPPAGE_BPS
      }
    });

    const tradeResult = await executeTrade({
      symbol,
      isLong,
      positionSize: preview.positionSizeUnits,
      leverage: preview.cappedLeverage,
      price: lastPrice,
      mode: accountMode
    });

    const entryPriceForTp = Number(tradeResult?.avgPx ?? lastPrice);
    const riskDistance = Math.abs(entryPriceForTp - stopLossPrice);
    const riskPercent = Number(settings?.riskPercent ?? 2);
    const takeProfitPercent = Number(settings?.takeProfitPercent ?? 2);
    const rrMultiple =
      Number.isFinite(riskPercent) && riskPercent > 0
        ? takeProfitPercent / riskPercent
        : 0;
    const takeProfitPrice =
      Number.isFinite(riskDistance) && riskDistance > 0 && Number.isFinite(rrMultiple) && rrMultiple > 0
        ? isLong
          ? entryPriceForTp + riskDistance * rrMultiple
          : entryPriceForTp - riskDistance * rrMultiple
        : 0;
    logTradeManager("cross: computed bracket", {
      mode: accountMode,
      symbol,
      side: isLong ? "long" : "short",
      entryPrice: entryPriceForTp,
      stopLossPrice,
      takeProfitPrice,
      riskPercent,
      takeProfitPercent,
      rrMultiple,
      positionSize: tradeResult.size
    });
    if (!Number.isFinite(takeProfitPrice) || takeProfitPrice <= 0) {
      throw new Error("Calculated take-profit trigger is invalid");
    }
    const bracketResult = await placeBracketOrders({
      symbol,
      isLong,
      size: tradeResult.size,
      stopLossTriggerPrice: stopLossPrice,
      takeProfitTriggerPrice: takeProfitPrice,
      mode: accountMode
    });
    logTradeManager("cross: bracket placement response", {
      mode: accountMode,
      symbol,
      stopLoss: bracketResult?.stopLoss || null,
      takeProfit: bracketResult?.takeProfit || null
    });
    const stopResult = {
      asset: bracketResult?.asset,
      oid: bracketResult?.stopLoss?.oid,
      status: bracketResult?.stopLoss?.status
    };
    if (
      Number.isFinite(stopResult?.asset) &&
      Number.isFinite(stopResult?.oid) &&
      Number(stopResult.oid) > 0
    ) {
      tradeState.setStopOrderRef({
        symbol,
        mode: accountMode,
        stopOrderRef: {
          asset: Number(stopResult.asset),
          oid: Number(stopResult.oid)
        },
        stopLossPlaced: stopLossPrice
      });
    }

    await refreshActivePosition();
    const refreshedPosition = getActivePosition(symbol);
    await reconcileTradeStateForSymbol(symbol, accountMode, {
      lastAction: "cross",
      executionMeta: {
        entryPxFilled: Number(tradeResult?.avgPx ?? 0) || null,
        stopLossPlaced: stopLossPrice
      }
    });
    if (!refreshedPosition) {
      tradeState.applyActionError({
        symbol,
        mode: accountMode,
        action: "cross",
        error: "Position did not appear after execution"
      });
    }
    const refreshedBalance = await doFetchBalance({ force: true });
    if (!Number.isFinite(refreshedBalance)) {
      emitHudUpdate();
    }
    emitTradeResult({
      ok: true,
      action: "cross",
      symbol,
      side: isLong ? "long" : "short",
      size: tradeResult.size,
      avgPx: tradeResult.avgPx,
      details: "Trade opened with stop loss and take profit placed"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    tradeState.applyActionError({ symbol, mode: accountMode, action: "cross", error: message });
    await refreshActivePosition();
    emitTradeResult({
      ok: false,
      action: "cross",
      symbol,
      error: message,
      details: "Trade open/SL/TP placement failed — verify position and protective orders manually if needed."
    });
  }
}

async function executeAzizMethod() {
  const symbol = normalizeSymbol(primarySymbol);
  const position = getActivePosition(symbol);
  if (!symbol || !position) {
    emitTradeResult({ ok: false, action: "triangle", symbol: symbol || "", error: "No active trade to scale out" });
    return;
  }
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
    emitTradeResult({ ok: false, action: "triangle", symbol, error: "Live price is unavailable" });
    return;
  }

  try {
    tradeState.applyActionStart({ symbol, mode: accountMode, action: "triangle" });
    const tracked = getTrackedStopOrder(symbol, accountMode);
    const result = await executeAzizExit({
      symbol,
      price: lastPrice,
      oldStopOid: tracked?.oid ?? null,
      oldStopAsset: tracked?.asset ?? null,
      mode: accountMode
    });

    await refreshActivePosition();
    const updated = getActivePosition(symbol);
    if (updated) {
      setDirectionForSymbol(symbol, Number(updated.szi) > 0);
      stopLossBySymbol.set(symbol, result.breakEvenPrice);
    }
    if (result.stopLoss?.oid && result.stopLoss?.asset != null) {
      tradeState.setStopOrderRef({
        symbol,
        mode: accountMode,
        stopOrderRef: {
          asset: Number(result.stopLoss.asset),
          oid: Number(result.stopLoss.oid)
        },
        stopLossPlaced: result.breakEvenPrice
      });
    } else {
      tradeState.clearStopOrderRef({ symbol, mode: accountMode });
    }
    await reconcileTradeStateForSymbol(symbol, accountMode, {
      lastAction: "triangle",
      executionMeta: {
        stopLossPlaced: Number(result?.stopLoss?.triggerPrice ?? result.breakEvenPrice) || null
      }
    });

    const refreshedBalance = await doFetchBalance({ force: true });
    if (!Number.isFinite(refreshedBalance)) {
      emitHudUpdate();
    }
    emitTradeResult({
      ok: true,
      action: "triangle",
      symbol,
      side: result.side,
      size: result.closedSize,
      avgPx: result.closedAvgPx,
      details: "Closed 50% and moved stop loss to break-even"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    tradeState.applyActionError({ symbol, mode: accountMode, action: "triangle", error: message });
    await refreshActivePosition();
    emitTradeResult({
      ok: false,
      action: "triangle",
      symbol,
      error: message,
      details: "Aziz method failed before stop-loss replacement completed."
    });
  }
}

async function executeBailout() {
  const symbol = normalizeSymbol(primarySymbol);
  const position = getActivePosition(symbol);
  if (!symbol || !position) {
    emitTradeResult({ ok: false, action: "circle", symbol: symbol || "", error: "No active trade to close" });
    return;
  }
  const isLong = inferDirectionFromPosition(position);
  const positionSize = Math.abs(Number(position.szi ?? 0));
  if (isLong === null || !Number.isFinite(positionSize) || positionSize <= 0) {
    emitTradeResult({ ok: false, action: "circle", symbol, error: "Active position size is invalid" });
    return;
  }
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
    emitTradeResult({ ok: false, action: "circle", symbol, error: "Live price is unavailable" });
    return;
  }

  try {
    tradeState.applyActionStart({ symbol, mode: accountMode, action: "circle" });
    const closeResult = await closePosition({
      symbol,
      isLong,
      size: positionSize,
      price: lastPrice,
      mode: accountMode
    });
    await cancelAllOrders({ symbol, mode: accountMode });
    tradeState.clearStopOrderRef({ symbol, mode: accountMode });
    // Emit an immediate local close state even before snapshot reconciliation.
    tradeState.setClosed({ symbol, mode: accountMode, lastAction: "circle" });

    await refreshActivePosition();
    await reconcileTradeStateForSymbol(symbol, accountMode, { lastAction: "circle" });
    const refreshedBalance = await doFetchBalance({ force: true });
    if (!Number.isFinite(refreshedBalance)) {
      emitHudUpdate();
    }
    emitTradeResult({
      ok: true,
      action: "circle",
      symbol,
      side: isLong ? "long" : "short",
      size: closeResult.size,
      avgPx: closeResult.avgPx,
      details: "Position closed"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    tradeState.applyActionError({ symbol, mode: accountMode, action: "circle", error: message });
    await refreshActivePosition();
    emitTradeResult({
      ok: false,
      action: "circle",
      symbol,
      error: message
    });
  }
}

async function executeStopLossUpdate() {
  const symbol = normalizeSymbol(primarySymbol);
  const position = getActivePosition(symbol);
  if (!symbol || !position) {
    emitTradeResult({
      ok: false,
      action: "updateStopLoss",
      symbol: symbol || "",
      error: "No active trade to update stop loss"
    });
    return;
  }
  const isLong = inferDirectionFromPosition(position);
  const positionSize = Math.abs(Number(position.szi ?? 0));
  const stopLossPrice = getStopLossPrice(symbol);
  if (isLong === null || !Number.isFinite(positionSize) || positionSize <= 0) {
    emitTradeResult({ ok: false, action: "updateStopLoss", symbol, error: "Active position size is invalid" });
    return;
  }
  if (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0) {
    emitTradeResult({ ok: false, action: "updateStopLoss", symbol, error: "Stop loss is not set" });
    return;
  }

  const tracked = getTrackedStopOrder(symbol, accountMode);
  const stopResult = await updateStopLoss({
    symbol,
    isLong,
    size: positionSize,
    newTriggerPrice: stopLossPrice,
    oldOid: tracked?.oid ?? null,
    oldAsset: tracked?.asset ?? null,
    mode: accountMode
  });
  if (TRADE_MANAGER_VERBOSE) {
    console.log("[server] stop-loss update placed", {
      mode: accountMode,
      symbol,
      requestedTrigger: stopLossPrice,
      positionSize,
      exchangeAsset: Number(stopResult?.asset ?? 0),
      exchangeOid: Number(stopResult?.oid ?? 0),
      exchangeStatus: String(stopResult?.status ?? "unknown")
    });
  }
  if (
    Number.isFinite(stopResult?.asset) &&
    Number.isFinite(stopResult?.oid) &&
    Number(stopResult.oid) > 0
  ) {
    tradeState.setStopOrderRef({
      symbol,
      mode: accountMode,
      stopOrderRef: {
        asset: Number(stopResult.asset),
        oid: Number(stopResult.oid)
      },
      stopLossPlaced: stopLossPrice
    });
  } else {
    tradeState.clearStopOrderRef({ symbol, mode: accountMode });
  }
  tradeState.setStopLossValue({ symbol, mode: accountMode, stopLoss: stopLossPrice });
  await refreshPendingOrdersForSymbol(symbol, accountMode);
  await reconcileTradeStateForSymbol(symbol, accountMode, { lastAction: "updateStopLoss" });

  emitTradeResult({
    ok: true,
    action: "updateStopLoss",
    symbol,
    side: isLong ? "long" : "short",
    size: positionSize,
    avgPx: null,
    details: "Stop loss updated on exchange"
  });
}

function toggleDirectionFromController() {
  const symbol = normalizeSymbol(primarySymbol);
  if (!symbol) return;
  const nextDirection = !getDirectionForSymbol(symbol);
  setDirectionForSymbol(symbol, nextDirection);
  console.log(`[server] Direction toggled ${symbol}: ${nextDirection ? "LONG" : "SHORT"}`);
  emitDirectionUpdate();
}

async function handleControllerAction(action) {
  try {
    if (action === "cross") {
      emitControllerEvent("cross");
      await executeCrossTrade();
      return;
    }

    if (action === "triangle") {
      emitControllerEvent("triangle");
      await executeAzizMethod();
      return;
    }

    if (action === "circle") {
      emitControllerEvent("circle");
      await executeBailout();
      return;
    }

    if (action === "toggleDirection") {
      emitControllerEvent("toggleDirection");
      toggleDirectionFromController();
      return;
    }

    if (action === "updateStopLoss") {
      emitControllerEvent("updateStopLoss");
      await executeStopLossUpdate();
      return;
    }

    if (action === "primaryPrev") {
      cyclePrimarySymbol("prev");
      emitControllerEvent("primaryPrev");
      return;
    }

    if (action === "primaryNext") {
      cyclePrimarySymbol("next");
      emitControllerEvent("primaryNext");
      return;
    }

    if (action === "stopLossSnap") {
      const snapPrice = getLatestPriceForSymbol(primarySymbol) || lastPrice;
      if (primarySymbol && snapPrice > 0) {
        stopLossBySymbol.set(primarySymbol, snapPrice);
        tradeState.setStopLossValue({ symbol: primarySymbol, mode: accountMode, stopLoss: snapPrice });
        console.log("stopLoss snapped to price:", snapPrice, "for", primarySymbol);
        emitHudUpdate();
        emitControllerEvent("stopLossSnap");
      }
      return;
    }

    if (action === "dpadUp") {
      const step = getAtrStopLossStep();
      const current = getStopLossPrice(primarySymbol);
      const next = current + step;
      stopLossBySymbol.set(primarySymbol, next);
      tradeState.setStopLossValue({ symbol: primarySymbol, mode: accountMode, stopLoss: next });
      emitHudUpdate();
      emitControllerEvent(action);
      return;
    }

    if (action === "dpadDown") {
      const step = getAtrStopLossStep();
      const current = getStopLossPrice(primarySymbol);
      const next = Math.max(0, current - step);
      stopLossBySymbol.set(primarySymbol, next);
      tradeState.setStopLossValue({ symbol: primarySymbol, mode: accountMode, stopLoss: next });
      emitHudUpdate();
      emitControllerEvent(action);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const symbol = normalizeSymbol(primarySymbol);
    console.log("[server] controller action error:", action, message);
    if (symbol) {
      tradeState.applyActionError({ symbol, mode: accountMode, action, error: message });
    }
    emitTradeResult({
      ok: false,
      action,
      symbol,
      error: message
    });
  }
}

function normalizeSymbol(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase();
}

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Shutting down due to ${signal}...`);

  if (sessionRolloverIntervalId) {
    clearInterval(sessionRolloverIntervalId);
  }
  if (typeof cleanupKeyboardController === "function") {
    cleanupKeyboardController();
  }

  try {
    if (ARCHIVE_ON_SHUTDOWN) {
      const sessionId = await sessionStore.getCurrentSessionId();
      if (sessionId) {
        await sessionStore.closeAndArchiveSession(sessionId, Date.now(), signal || "shutdown");
      }
    } else {
      console.log(
        "[server] Leaving active session open on shutdown; it will roll by market window/day."
      );
    }
    await sessionStore.shutdown();
  } catch (error) {
    console.log("Session shutdown warning:", error?.message || error);
  }

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  syncPrimaryLastPrice();

  const settings = getSettings();
  socket.emit("initialState", {
    symbol: primarySymbol,
    balance,
    riskPercent: settings.riskPercent,
    positionSize: computePositionSize(balance, lastPrice),
    stopLossPrice: getStopLossPrice(primarySymbol),
    settings,
    mode: accountMode,
    isLong: getDirectionForSymbol(primarySymbol),
    tradeState: tradeState.getClientSnapshot(primarySymbol, accountMode)
  });
  emitTradeStateSnapshot(socket, primarySymbol, accountMode);

  emitStreamsUpdate(socket);
  void emitSessionUpdate();
  emitStopLossProjections();
  emitDirectionUpdate(socket);

  socket.on("symbol:subscribe", async (payload) => {
    const symbol = normalizeSymbol(payload?.symbol || primarySymbol);
    if (!symbol) {
      return;
    }

    if (!activeSymbols.has(symbol)) {
      activeSymbols.add(symbol);
      subscribeToSymbol(symbol);
    }

    await preloadSymbolHistory(symbol);

    if (symbol !== primarySymbol) {
      primarySymbol = symbol;
      seenFirstDataForSymbol.delete(primarySymbol);
      getDirectionForSymbol(primarySymbol);
      syncPrimaryLastPrice();
      io.emit("symbolChanged", { symbol: primarySymbol });
      emitStreamsUpdate();
      emitDirectionUpdate();
      emitHudUpdate();
    }
    emitTradeStateSnapshot(socket, symbol, accountMode);
  });

  socket.on("stopLoss:set", (payload) => {
    const symbol = normalizeSymbol(payload?.symbol || primarySymbol);
    const price = Number(payload?.stopLossPrice ?? 0);
    if (!symbol || !Number.isFinite(price) || price < 0) return;
    stopLossBySymbol.set(symbol, price);
    tradeState.setStopLossValue({ symbol, mode: accountMode, stopLoss: price });
    if (symbol === primarySymbol) {
      emitHudUpdate();
    }
  });

  socket.on("changeSymbol", async (payload) => {
    const nextSymbol = normalizeSymbol(payload?.symbol);
    if (!nextSymbol || nextSymbol === primarySymbol) {
      return;
    }

    console.log("changeSymbol from client:", nextSymbol);
    if (!activeSymbols.has(nextSymbol)) {
      activeSymbols.add(nextSymbol);
      subscribeToSymbol(nextSymbol);
    }

    await preloadSymbolHistory(nextSymbol);

    primarySymbol = nextSymbol;
    seenFirstDataForSymbol.delete(primarySymbol);
    getDirectionForSymbol(primarySymbol);
    syncPrimaryLastPrice();
    io.emit("symbolChanged", { symbol: primarySymbol });
    emitStreamsUpdate();
    emitDirectionUpdate();
    emitHudUpdate();
    emitTradeStateSnapshot(socket, primarySymbol, accountMode);
  });
});

console.log(`Server starting on port ${PORT}`);

async function bootstrapServer() {
  loadSettings();
  console.log("[server] Account settings loaded:", JSON.stringify(getSettings()));

  try {
    await sessionStore.init();
    await sessionStore.ensureActiveSession(Date.now());
    await hydrateStartupStreams();
  } catch (error) {
    console.log("Session store initialization warning:", error?.message || error);
  }

  server.listen(PORT, async () => {
    console.log("Express + Socket.io ready");
    await emitSessionUpdate();

    connectHyperliquidWs({
      io,
      wsUrl: HYPERLIQUID_WS_URL,
      getActiveSymbols: () => Array.from(activeSymbols),
      seenFirstDataForSymbol,
      onPriceUpdate: ({ symbol, price }) => {
        const normalized = normalizeSymbol(symbol);
        if (normalized && Number.isFinite(price) && price > 0) {
          lastPriceBySymbol.set(normalized, price);
        }
        // Only HUD/position sizing are tied to the primary symbol.
        if (symbol === primarySymbol) {
          lastPrice = price;
          emitHudUpdate();
        }
        const ts = Date.now();
        // Update ATR cache for this symbol (even if not primary) so step is ready.
        updateAtrForTick(symbol, { price, ts, size: 0 });
        void sessionStore
          .ingestTick(
            {
              symbol,
              price,
              size: 0,
              ts
            },
            "live"
          )
          .then((result) => {
            if (result?.sessionInfo) {
              io.emit("session:update", result.sessionInfo);
            }
          })
          .catch(() => {});
      },
      onTick: (trade) => {
        updateAtrForTick(trade.symbol, {
          price: trade.price,
          ts: trade.ts,
          size: trade.size
        });
        void sessionStore
          .ingestTick(
            {
              symbol: trade.symbol,
              price: trade.price,
              size: trade.size,
              ts: trade.ts
            },
            "live"
          )
          .then((result) => {
            if (result?.sessionInfo) {
              io.emit("session:update", result.sessionInfo);
            }
          })
          .catch(() => {});
      },
      onConnected: (symbols) => {
        // Reconnects after temporary internet loss should refresh history and patch
        // missing bars into the existing day session instead of creating a new one.
        for (const symbol of symbols || []) {
          void preloadSymbolHistory(symbol, { force: true });
        }
        void refreshActivePosition();
      }
    });

    if (isAccountConfiguredForMode(accountMode)) {
      void doFetchBalance({ force: true });
    } else {
      console.log(
        `[server] Account balance fetch disabled for ${accountMode} mode: no wallet configured`
      );
    }

    void refreshFeeAndMetaCache();
    setInterval(() => void refreshFeeAndMetaCache(), 60_000);
    void refreshActivePosition();
    setInterval(() => void refreshActivePosition(), 12_000);

    console.log(
      "Keyboard shortcuts active: 3=direction F1=cross F2=triangle F3=circle F4/F5=primary F6/F8=stopLoss F9=snap F10=updateSL"
    );
    cleanupKeyboardController = setupKeyboardController({
      onAction: handleControllerAction,
      onShutdownRequested: () => shutdown("SIGINT")
    });

    sessionRolloverIntervalId = setInterval(() => {
      void sessionStore
        .maybeRollSession(Date.now())
        .then(() => emitSessionUpdate())
        .catch(() => {});
    }, 30_000);
  });
}

void bootstrapServer();

const RUNNING_UNDER_LAUNCHER = !!process.send;

process.on("SIGINT", () => {
  if (RUNNING_UNDER_LAUNCHER) {
    shutdown("SIGINT");
  } else {
    console.log("[server] SIGINT received but ignored (use /api/session/save or market-window rollover).");
  }
});

process.on("SIGTERM", () => {
  if (RUNNING_UNDER_LAUNCHER) {
    shutdown("SIGTERM");
  } else {
    console.log("[server] SIGTERM received but ignored (use /api/session/save or market-window rollover).");
  }
});


