const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const {
  computePositionSize,
  emitHudUpdate: accountEmitHudUpdate,
  fetchAccountBalance,
  getBalanceRefreshMs,
  hasAccountConfigured,
  isAccountConfiguredForMode,
  fetchClearinghouseState,
  fetchSpotClearinghouseState,
  fetchUserFills,
  fetchUserFees,
  fetchMeta,
  normalizeAccountOverview,
  normalizePositions,
  normalizeFills,
  normalizeFeeRates,
  normalizeMetaForSymbol,
  computeLeveragePreview,
  computeStopLossProjections,
  loadSettings,
  getSettings,
  patchSettings
} = require("./account");
const { connectHyperliquidWs, subscribeToSymbol, unsubscribeFromSymbol } = require("./priceStream");
const { setupKeyboardController } = require("./controller");
const { SessionStore } = require("./sessionStore");
const { detectGapRanges, intervalForTimeframe, upsertCandle } = require("./sessionMath");
const {
  executeTrade,
  placeStopLoss,
  closePosition,
  cancelOrderById,
  cancelAllOrders
} = require("./exchange");

const PORT = process.env.PORT || 3000;
const HYPERLIQUID_WS_URL =
  process.env.HYPERLIQUID_WS_URL || "wss://api.hyperliquid.xyz/ws";
const DEFAULT_SYMBOL = "";
const DEFAULT_STOP_LOSS_PRICE = 0;
const ARCHIVE_ON_SHUTDOWN = String(process.env.SESSION_ARCHIVE_ON_SHUTDOWN || "")
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
let accountMode = "test";
const activePositionBySymbol = new Map();
const isLongBySymbol = new Map(); // symbol -> true(long), false(short)
const activeStopLossOrderBySymbol = new Map(); // symbol -> { asset, oid }
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
  const inc = fallbackTickInc(lastPrice);
  const raw = inc * Math.max(0.1, k);
  return roundUpToIncrement(raw, inc) || inc;
}

function getStopLossPrice(symbol) {
  if (!symbol) return 0;
  const v = stopLossBySymbol.get(symbol);
  return Number.isFinite(v) && v > 0 ? v : 0;
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
let balanceIntervalId = null;
let cleanupKeyboardController = null;
let sessionRolloverIntervalId = null;

const sessionStore = new SessionStore();

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
    if (!primarySymbol && symbols.length > 0) {
      primarySymbol = symbols[0];
      getDirectionForSymbol(primarySymbol);
    }
    if (symbols.length > 0) {
      console.log(
        `[server] Restored startup streams source=${restored.source} session=${restored.sessionId || "n/a"} symbols=${symbols.join(",")}`
      );
    } else {
      console.log("[server] No startup streams restored from prior sessions");
    }
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

  // Notify all clients about the new primary and updated streams.
  io.emit("symbolChanged", { symbol: primarySymbol });
  io.emit("streams:update", {
    symbols: Array.from(activeSymbols),
    primary: primarySymbol
  });
  emitDirectionUpdate();

  await preloadSymbolHistory(nextSymbol);
  res.json({ ok: true, symbol: primarySymbol });
});

// Helper to emit the current streams state to a specific socket or all.
function emitStreamsUpdate(target) {
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

app.post("/api/session/save", async (req, res) => {
  try {
    const requestedSessionId = String(req.body?.sessionId || "").trim();
    const sessionId = requestedSessionId || (await sessionStore.getCurrentSessionId());
    if (!sessionId) {
      return res.status(404).json({ ok: false, message: "No active session found to save" });
    }
    const payload = await sessionStore.saveSessionCheckpoint(sessionId, Date.now(), "manual_save");
    if (!payload) {
      return res.status(404).json({ ok: false, message: "Session not found or unavailable for save" });
    }
    const sessionInfo = await sessionStore.getSessionInfo(sessionId);
    return res.json({
      ok: true,
      sessionId,
      sessionInfo,
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

    if (isAccountConfiguredForMode(mode)) {
      try {
        const feesPayload = await fetchUserFees(mode);
        const fees = normalizeFeeRates(feesPayload);
        makerFeePct = fees.userAddRate || makerFeePct;
        takerFeePct = fees.userCrossRate || takerFeePct;
      } catch { /* use defaults */ }
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
      accountBalance: balance,
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
  void doFetchBalance();
  void refreshFeeAndMetaCache();
  res.json({ ok: true, mode: accountMode });
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
  const settings = getSettings();
  const stopLossPrice = getStopLossPrice(primarySymbol);
  const projections = computeStopLossProjections({
    currentPrice: lastPrice,
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
    currentPrice: lastPrice,
    ...projections
  });
}

function emitHudUpdate() {
  const stopLossPrice = getStopLossPrice(primarySymbol);
  accountEmitHudUpdate(io, {
    stopLossPrice,
    balance,
    lastPrice
  });
  emitStopLossProjections();
}

async function refreshActivePosition() {
  if (!isAccountConfiguredForMode(accountMode)) return;
  try {
    const payload = await fetchClearinghouseState(accountMode);
    const positions = normalizePositions(payload);
    for (const symbol of activeSymbols) {
      const pos = positions.find((p) => p.coin === symbol) || null;
      activePositionBySymbol.set(symbol, pos);
      const inferred = inferDirectionFromPosition(pos);
      if (typeof inferred === "boolean") {
        setDirectionForSymbol(symbol, inferred);
      }
    }
  } catch (err) {
    console.log("[server] refreshActivePosition error:", err?.message || err);
  }
}

async function doFetchBalance() {
  if (!isAccountConfiguredForMode(accountMode)) return;
  fetchAccountBalance({
    mode: accountMode,
    onBalance: (parsedBalance) => {
      balance = parsedBalance;
      console.log("Fetched balance:", { balance, mode: accountMode });
      emitHudUpdate();
    },
    onError: (error) => {
      console.log("Failed to fetch balance:", error.message);
    }
  });
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
    activeStopLossOrderBySymbol.set(normalized, {
      asset: Number(stopResult.asset),
      oid: Number(stopResult.oid)
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
  console.log("Primary symbol moved via controller:", primarySymbol);
  io.emit("symbolChanged", { symbol: primarySymbol });
  emitStreamsUpdate();
  emitDirectionUpdate();
}

async function executeCrossTrade() {
  const symbol = normalizeSymbol(primarySymbol);
  if (!symbol) {
    emitTradeResult({ ok: false, action: "cross", symbol: "", error: "No primary symbol selected" });
    return;
  }
  if (getActivePosition(symbol)) {
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

  const tradeResult = await executeTrade({
    symbol,
    isLong,
    positionSize: preview.positionSizeUnits,
    leverage: preview.cappedLeverage,
    price: lastPrice,
    mode: accountMode
  });

  const stopResult = await placeStopLoss({
    symbol,
    isLong,
    size: tradeResult.size,
    triggerPrice: stopLossPrice,
    mode: accountMode
  });
  if (
    Number.isFinite(stopResult?.asset) &&
    Number.isFinite(stopResult?.oid) &&
    Number(stopResult.oid) > 0
  ) {
    activeStopLossOrderBySymbol.set(symbol, {
      asset: Number(stopResult.asset),
      oid: Number(stopResult.oid)
    });
  }

  await refreshActivePosition();
  emitHudUpdate();
  emitTradeResult({
    ok: true,
    action: "cross",
    symbol,
    side: isLong ? "long" : "short",
    size: tradeResult.size,
    avgPx: tradeResult.avgPx,
    details: "Trade opened and stop loss placed"
  });
}

async function executeAzizMethod() {
  const symbol = normalizeSymbol(primarySymbol);
  const position = getActivePosition(symbol);
  if (!symbol || !position) {
    emitTradeResult({ ok: false, action: "triangle", symbol: symbol || "", error: "No active trade to scale out" });
    return;
  }
  const isLong = inferDirectionFromPosition(position);
  const positionSize = Math.abs(Number(position.szi ?? 0));
  if (isLong === null || !Number.isFinite(positionSize) || positionSize <= 0) {
    emitTradeResult({ ok: false, action: "triangle", symbol, error: "Active position size is invalid" });
    return;
  }
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
    emitTradeResult({ ok: false, action: "triangle", symbol, error: "Live price is unavailable" });
    return;
  }

  const settings = getSettings();
  const closeResult = await closePosition({
    symbol,
    isLong,
    size: positionSize * 0.5,
    price: lastPrice,
    mode: accountMode
  });

  await refreshActivePosition();
  const updated = getActivePosition(symbol);
  if (updated && Number.isFinite(updated.entryPx) && Number(updated.entryPx) > 0) {
    setDirectionForSymbol(symbol, Number(updated.szi) > 0);
    stopLossBySymbol.set(symbol, Number(updated.entryPx));
    await maybeRearmStopLossForPosition(symbol, updated);
  } else {
    activeStopLossOrderBySymbol.delete(symbol);
  }

  emitHudUpdate();
  emitTradeResult({
    ok: true,
    action: "triangle",
    symbol,
    side: isLong ? "long" : "short",
    size: closeResult.size,
    avgPx: closeResult.avgPx,
    details: "Closed 50% and moved stop loss to break-even"
  });
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

  const settings = getSettings();
  const closeResult = await closePosition({
    symbol,
    isLong,
    size: positionSize,
    price: lastPrice,
    mode: accountMode
  });
  await cancelAllOrders({ symbol, mode: accountMode });
  activeStopLossOrderBySymbol.delete(symbol);

  await refreshActivePosition();
  emitHudUpdate();
  emitTradeResult({
    ok: true,
    action: "circle",
    symbol,
    side: isLong ? "long" : "short",
    size: closeResult.size,
    avgPx: closeResult.avgPx,
    details: "Position closed"
  });
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

  const tracked = activeStopLossOrderBySymbol.get(symbol);
  if (tracked?.asset != null && tracked?.oid != null) {
    try {
      await cancelOrderById({
        asset: Number(tracked.asset),
        oid: Number(tracked.oid),
        mode: accountMode
      });
    } catch {
      await cancelAllOrders({ symbol, mode: accountMode });
    }
  } else {
    await cancelAllOrders({ symbol, mode: accountMode });
  }

  const stopResult = await placeStopLoss({
    symbol,
    isLong,
    size: positionSize,
    triggerPrice: stopLossPrice,
    mode: accountMode
  });
  console.log("[server] stop-loss update placed", {
    mode: accountMode,
    symbol,
    requestedTrigger: stopLossPrice,
    positionSize,
    exchangeAsset: Number(stopResult?.asset ?? 0),
    exchangeOid: Number(stopResult?.oid ?? 0),
    exchangeStatus: String(stopResult?.status ?? "unknown")
  });
  if (
    Number.isFinite(stopResult?.asset) &&
    Number.isFinite(stopResult?.oid) &&
    Number(stopResult.oid) > 0
  ) {
    activeStopLossOrderBySymbol.set(symbol, {
      asset: Number(stopResult.asset),
      oid: Number(stopResult.oid)
    });
  } else {
    activeStopLossOrderBySymbol.delete(symbol);
  }

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
      if (primarySymbol && lastPrice > 0) {
        stopLossBySymbol.set(primarySymbol, lastPrice);
        console.log("stopLoss snapped to price:", lastPrice, "for", primarySymbol);
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
      emitHudUpdate();
      emitControllerEvent(action);
      return;
    }

    if (action === "dpadDown") {
      const step = getAtrStopLossStep();
      const current = getStopLossPrice(primarySymbol);
      const next = Math.max(0, current - step);
      stopLossBySymbol.set(primarySymbol, next);
      emitHudUpdate();
      emitControllerEvent(action);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const symbol = normalizeSymbol(primarySymbol);
    console.log("[server] controller action error:", action, message);
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

  if (balanceIntervalId) {
    clearInterval(balanceIntervalId);
  }
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

  const settings = getSettings();
  socket.emit("initialState", {
    symbol: primarySymbol,
    balance,
    riskPercent: settings.riskPercent,
    positionSize: computePositionSize(balance, lastPrice),
    stopLossPrice: getStopLossPrice(primarySymbol),
    settings,
    mode: accountMode,
    isLong: getDirectionForSymbol(primarySymbol)
  });

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
      io.emit("symbolChanged", { symbol: primarySymbol });
      emitStreamsUpdate();
      emitDirectionUpdate();
    }
  });

  socket.on("stopLoss:set", (payload) => {
    const symbol = normalizeSymbol(payload?.symbol || primarySymbol);
    const price = Number(payload?.stopLossPrice ?? 0);
    if (!symbol || !Number.isFinite(price) || price < 0) return;
    stopLossBySymbol.set(symbol, price);
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
    io.emit("symbolChanged", { symbol: primarySymbol });
    emitStreamsUpdate();
    emitDirectionUpdate();
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
      }
    });

    if (isAccountConfiguredForMode(accountMode)) {
      void doFetchBalance();
      balanceIntervalId = setInterval(() => void doFetchBalance(), getBalanceRefreshMs());
    } else {
      console.log(
        `[server] Account balance polling disabled for ${accountMode} mode: no wallet configured`
      );
    }

    void refreshFeeAndMetaCache();
    setInterval(() => void refreshFeeAndMetaCache(), 60_000);

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


