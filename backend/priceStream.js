const WebSocket = require("ws");

let hyperliquidWs = null;
const currentSubscriptions = {
  activeAssetCtx: new Set(),
  trades: new Set()
};

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function parseTradeMessage(msg, currentSymbol) {
  const channel = String(msg?.channel || msg?.topic || "").toLowerCase();
  const data = msg?.data || msg;

  if (!channel.includes("trades") && !data?.trades && !Array.isArray(data)) {
    return null;
  }

  const tradesArray = Array.isArray(data?.trades) ? data.trades : Array.isArray(data) ? data : [data];
  const normalized = [];

  for (const t of tradesArray) {
    const symbol = t?.coin || t?.symbol || t?.s || currentSymbol;
    const price = Number(t?.px ?? t?.price ?? t?.p);
    const size = Number(t?.sz ?? t?.size ?? t?.q ?? 0);
    const side = String(t?.side || t?.S || "").toLowerCase() || undefined;
    const rawTime = t?.time ?? t?.t ?? Date.now();
    const ts = Number(rawTime);

    if (!symbol || !Number.isFinite(price) || !Number.isFinite(ts)) {
      continue;
    }

    normalized.push({ symbol, price, size, side, ts });
  }

  if (!normalized.length) {
    return null;
  }

  return normalized;
}

// Use the same price Hyperliquid uses for stops and margin:
// mark price from activeAssetCtx (PerpsAssetCtx.shared.markPx).
function parseActiveAssetCtxMessage(msg, currentSymbol) {
  const channel = msg?.channel || msg?.topic || "";
  if (!String(channel).toLowerCase().includes("activeassetctx")) {
    return null;
  }

  const data = msg?.data || msg;
  const symbol = data?.coin || data?.symbol || data?.s || currentSymbol;
  const ctx = data?.ctx;
  const markPx = Number(ctx?.markPx);

  if (!symbol || !Number.isFinite(markPx)) {
    return null;
  }

  return { symbol, mark: markPx };
}

function subscribeToSymbol(symbol) {
  if (!hyperliquidWs || hyperliquidWs.readyState !== WebSocket.OPEN) {
    console.log("[priceStream] subscribeToSymbol skipped, WS not open yet:", symbol);
    return;
  }

  if (currentSubscriptions.activeAssetCtx.has(symbol) && currentSubscriptions.trades.has(symbol)) {
    console.log("[priceStream] Already subscribed to symbol:", symbol);
    return;
  }

  console.log("[priceStream] Subscribing to symbol:", symbol);

  const activeAssetCtxPayload = {
    method: "subscribe",
    subscription: {
      type: "activeAssetCtx",
      coin: symbol
    }
  };

  const tradesPayload = {
    method: "subscribe",
    subscription: {
      type: "trades",
      coin: symbol
    }
  };

  if (!currentSubscriptions.activeAssetCtx.has(symbol)) {
    hyperliquidWs.send(JSON.stringify(activeAssetCtxPayload));
    currentSubscriptions.activeAssetCtx.add(symbol);
  }

  if (!currentSubscriptions.trades.has(symbol)) {
    hyperliquidWs.send(JSON.stringify(tradesPayload));
    currentSubscriptions.trades.add(symbol);
  }
}

function unsubscribeFromSymbol(symbol) {
  if (!hyperliquidWs || hyperliquidWs.readyState !== WebSocket.OPEN || !symbol) {
    console.log("[priceStream] unsubscribeToSymbol skipped, WS not open or symbol missing:", symbol);
    return;
  }

  console.log("[priceStream] Unsubscribing from symbol:", symbol);

  if (currentSubscriptions.activeAssetCtx.has(symbol)) {
    const activeAssetCtxPayload = {
      method: "unsubscribe",
      subscription: {
        type: "activeAssetCtx",
        coin: symbol
      }
    };
    hyperliquidWs.send(JSON.stringify(activeAssetCtxPayload));
    currentSubscriptions.activeAssetCtx.delete(symbol);
  }

  if (currentSubscriptions.trades.has(symbol)) {
    const tradesPayload = {
      method: "unsubscribe",
      subscription: {
        type: "trades",
        coin: symbol
      }
    };
    hyperliquidWs.send(JSON.stringify(tradesPayload));
    currentSubscriptions.trades.delete(symbol);
  }
}

function connectHyperliquidWs({
  io,
  wsUrl,
  getActiveSymbols,
  seenFirstDataForSymbol,
  onPriceUpdate,
  onTick,
  onConnected
}) {
  console.log("[priceStream] Opening Hyperliquid WS:", wsUrl);
  hyperliquidWs = new WebSocket(wsUrl);

  hyperliquidWs.on("open", () => {
    console.log("[priceStream] Connected to Hyperliquid WS");
    const symbols = typeof getActiveSymbols === "function" ? getActiveSymbols() : [];
    for (const symbol of symbols || []) {
      subscribeToSymbol(symbol);
    }
    if (typeof onConnected === "function") {
      onConnected(symbols);
    }
  });

  hyperliquidWs.on("message", (rawBuffer) => {
    const raw = rawBuffer.toString("utf8");
    const msg = safeJsonParse(raw);
    if (!msg) {
      return;
    }

    const markCtx = parseActiveAssetCtxMessage(msg);
    if (markCtx) {
      const { symbol, mark } = markCtx;
      if (!seenFirstDataForSymbol.has(symbol)) {
        seenFirstDataForSymbol.add(symbol);
        console.log("[priceStream] Received first activeAssetCtx (markPx) for symbol:", symbol);
      }
      io.emit("priceUpdate", {
        symbol,
        price: mark,
        ts: Date.now()
      });
      if (typeof onPriceUpdate === "function") {
        onPriceUpdate({ symbol, price: mark });
      }
      return;
    }

    const trades = parseTradeMessage(msg);
    if (trades) {
      //console.log("[priceStream] Emitting trades as ticks:", trades.length);
      for (const trade of trades) {
        io.emit("tick", trade);
        if (typeof onTick === "function") {
          onTick(trade);
        }
      }
    }
  });

  hyperliquidWs.on("close", (code, reason) => {
    console.log(
      "[priceStream] Hyperliquid WS closed. Code:",
      code,
      "Reason:",
      reason?.toString?.() || ""
    );
    setTimeout(
      () =>
        connectHyperliquidWs({
          io,
          wsUrl,
          getActiveSymbols,
          seenFirstDataForSymbol,
          onPriceUpdate,
          onTick,
          onConnected
        }),
      2000
    );
  });

  hyperliquidWs.on("error", (err) => {
    console.log("[priceStream] Hyperliquid WS error:", err?.message || err);
  });
}

module.exports = {
  connectHyperliquidWs,
  subscribeToSymbol,
  unsubscribeFromSymbol
};

