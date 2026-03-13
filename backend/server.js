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
const { pollController } = require("./controller");

const PORT = process.env.PORT || 3000;
const HYPERLIQUID_WS_URL = "wss://api.hyperliquid-testnet.xyz/ws";
const DEFAULT_SYMBOL = "BTC";
const DEFAULT_STOP_LOSS_PRICE = 0;

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

// Primary symbol is the one used for HUD/account/controller logic.
let primarySymbol = DEFAULT_SYMBOL;
// All symbols we maintain active Hyperliquid streams for.
const activeSymbols = new Set([DEFAULT_SYMBOL]);
let stopLossPrice = DEFAULT_STOP_LOSS_PRICE;
let balance = 0;
let lastPrice = 0;

let seenFirstDataForSymbol = new Set();
let balanceIntervalId = null;
let controllerIntervalId = null;

const controllerState = {
  connected: false,
  device: null,
  notFoundLogged: false,
  previous: {
    cross: false,
    triangle: false,
    circle: false,
    dpadUp: false,
    dpadDown: false,
    dpadLeft: false,
    dpadRight: false
  }
};

// REST API to update the primary symbol (ensures it is part of the active streams set).
app.post("/api/change-symbol", (req, res) => {
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

app.post("/api/streams", (req, res) => {
  const symbol = normalizeSymbol(req.body?.symbol);
  if (!symbol) {
    return res.status(400).json({ ok: false, message: "Missing symbol" });
  }

  if (!activeSymbols.has(symbol)) {
    activeSymbols.add(symbol);
    subscribeToSymbol(symbol);
  }

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

function emitHudUpdate() {
  accountEmitHudUpdate(io, {
    stopLossPrice,
    balance,
    lastPrice
  });
}

function normalizeSymbol(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase();
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

  socket.on("symbol:subscribe", (payload) => {
    const symbol = normalizeSymbol(payload?.symbol || primarySymbol);
    if (!symbol) {
      return;
    }

    if (!activeSymbols.has(symbol)) {
      activeSymbols.add(symbol);
      subscribeToSymbol(symbol);
    }

    if (symbol !== primarySymbol) {
      primarySymbol = symbol;
      seenFirstDataForSymbol.delete(primarySymbol);
      io.emit("symbolChanged", { symbol: primarySymbol });
      emitStreamsUpdate();
    }
  });

  socket.on("changeSymbol", (payload) => {
    const nextSymbol = normalizeSymbol(payload?.symbol);
    if (!nextSymbol || nextSymbol === primarySymbol) {
      return;
    }

    console.log("changeSymbol from client:", nextSymbol);
    if (!activeSymbols.has(nextSymbol)) {
      activeSymbols.add(nextSymbol);
      subscribeToSymbol(nextSymbol);
    }

    primarySymbol = nextSymbol;
    seenFirstDataForSymbol.delete(primarySymbol);
    io.emit("symbolChanged", { symbol: primarySymbol });
    emitStreamsUpdate();
  });
});

console.log(`Server starting on port ${PORT}`);

server.listen(PORT, () => {
  console.log("Express + Socket.io ready");
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

  controllerIntervalId = setInterval(() => {
    pollController({
      io,
      onStopLossDelta: (delta) => {
        stopLossPrice += delta;
        console.log("stopLossPrice updated:", stopLossPrice);
        emitHudUpdate();
      }
    });
  }, 120);
});

