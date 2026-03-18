const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const {
  computePositionSize,
  emitHudUpdate: accountEmitHudUpdate,
  fetchAccountBalance,
  getBalanceRefreshMs,
  hasAccountConfigured
} = require("./account");
const { connectHyperliquidWs, subscribeToSymbol, unsubscribeFromSymbol } = require("./priceStream");
const { setupKeyboardController } = require("./controller");
const { SessionStore } = require("./sessionStore");
const { detectGapRanges, intervalForTimeframe } = require("./sessionMath");

const PORT = process.env.PORT || 3000;
const HYPERLIQUID_WS_URL =
  process.env.HYPERLIQUID_WS_URL || "wss://api.hyperliquid.xyz/ws";
const DEFAULT_SYMBOL = "";
const DEFAULT_STOP_LOSS_PRICE = 0;
const STOP_LOSS_STEP = 5;
const ARCHIVE_ON_SHUTDOWN = String(process.env.SESSION_ARCHIVE_ON_SHUTDOWN || "")
  .trim()
  .toLowerCase() === "true";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false
  }
});

// Basic CORS handling for REST API (including preflight) - allow all origins and common methods
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
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
let stopLossPrice = DEFAULT_STOP_LOSS_PRICE;
let balance = 0;
let lastPrice = 0;

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

  // Notify all clients about the new primary and updated streams.
  io.emit("symbolChanged", { symbol: primarySymbol });
  io.emit("streams:update", {
    symbols: Array.from(activeSymbols),
    primary: primarySymbol
  });

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
      io.emit("symbolChanged", { symbol: primarySymbol });
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

function emitHudUpdate() {
  accountEmitHudUpdate(io, {
    stopLossPrice,
    balance,
    lastPrice
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
}

function handleControllerAction(action) {
  if (action === "cross") {
    console.log("TRADE EXECUTED - 2% RISK");
    emitControllerEvent("cross");
    return;
  }

  if (action === "triangle") {
    console.log("AZIZ METHOD - 50% CLOSE & BE");
    emitControllerEvent("triangle");
    return;
  }

  if (action === "circle") {
    console.log("BAILOUT");
    emitControllerEvent("circle");
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

  if (action === "dpadUp" || action === "dpadRight") {
    stopLossPrice += STOP_LOSS_STEP;
    console.log("stopLossPrice updated:", stopLossPrice);
    emitHudUpdate();
    emitControllerEvent(action);
    return;
  }

  if (action === "dpadDown" || action === "dpadLeft") {
    stopLossPrice -= STOP_LOSS_STEP;
    console.log("stopLossPrice updated:", stopLossPrice);
    emitHudUpdate();
    emitControllerEvent(action);
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

  socket.emit("initialState", {
    symbol: primarySymbol,
    balance,
    riskPercent: 2,
    positionSize: computePositionSize(balance, lastPrice),
    stopLossPrice
  });

  // Send initial streams state to the new client.
  emitStreamsUpdate(socket);
  void emitSessionUpdate();

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
      io.emit("symbolChanged", { symbol: primarySymbol });
      emitStreamsUpdate();
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
    io.emit("symbolChanged", { symbol: primarySymbol });
    emitStreamsUpdate();
  });
});

console.log(`Server starting on port ${PORT}`);

async function bootstrapServer() {
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
        void sessionStore
          .ingestTick(
            {
              symbol,
              price,
              size: 0,
              ts: Date.now()
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

    if (hasAccountConfigured()) {
      const doFetchBalance = () =>
        fetchAccountBalance({
          onBalance: (parsedBalance) => {
            balance = parsedBalance;
            console.log("Fetched account info:", { balance });
            emitHudUpdate();
          },
          onError: (error) => {
            console.log("Failed to fetch account info:", error.message);
          }
        });

      doFetchBalance();
      balanceIntervalId = setInterval(doFetchBalance, getBalanceRefreshMs());
    } else {
      console.log(
        "Account balance polling disabled: set HYPERLIQUID_ACCOUNT in backend/account.js"
      );
    }

    console.log(
      "PS5 controller handling removed from backend; use Enjoyable F-key mappings (F1-F9)."
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

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});


