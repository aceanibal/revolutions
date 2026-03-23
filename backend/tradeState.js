function normalizeSymbol(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase();
}

function normalizeMode(raw) {
  return String(raw || "").toLowerCase() === "test" ? "test" : "live";
}

function keyFor(mode, symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const normalizedMode = normalizeMode(mode);
  return `${normalizedMode}:${normalizedSymbol}`;
}

function nowMs() {
  return Date.now();
}

function defaultExecutionMeta() {
  return {
    entryPxRequested: null,
    entryPxFilled: null,
    slippageBpsRequested: null,
    requestedNotional: null,
    requestedSize: null,
    requestedLeverage: null,
    stopLossRequested: null,
    stopLossPlaced: null,
    openedAtMs: null,
    closedAtMs: null
  };
}

function normalizeStopOrderRef(ref) {
  const asset = Number(ref?.asset ?? 0);
  const oid = Number(ref?.oid ?? 0);
  if (!Number.isFinite(asset) || asset < 0 || !Number.isFinite(oid) || oid <= 0) return null;
  return { asset, oid };
}

/** Hyperliquid REST returns trigger/limit prices as strings (e.g. "0.96266"). */
function parseHlPositivePx(raw) {
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Stop-market rows often put the UI trigger in `triggerCondition` ("Price above 0.94425") while
 * `triggerPx` is 0 and `limitPx` is the marketable/execution cap (much farther from entry).
 */
function parseTriggerPxFromHyperliquidTriggerCondition(raw) {
  const s = String(raw ?? "").trim();
  if (!s || /^n\/a$/i.test(s)) return null;
  const m = s.match(/(?:mark\s+)?(?:price\s+)?(?:above|below)\s+([\d.]+)/i);
  if (!m) return null;
  return parseHlPositivePx(m[1]);
}

function parseHlReduceOnly(order) {
  const v = order?.reduceOnly ?? order?.reduce_only;
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    return t === "true" || t === "1";
  }
  return Boolean(v);
}

/** Expand TP/SL rows: parent openOrders entries often carry triggers only on `children`. */
function expandHyperliquidOrderRows(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const order of raw) {
    const kids = Array.isArray(order?.children) ? order.children : [];
    if (kids.length > 0) {
      for (const child of kids) {
        out.push({ ...order, ...child, children: [] });
      }
    } else {
      out.push(order);
    }
  }
  return out;
}

/** Hyperliquid open orders: `b` is buy; some payloads use side A=ask(sell) / B=bid(buy). */
function orderIsBuyFromHyperliquid(order) {
  if (typeof order?.b === "boolean") return order.b;
  const s = String(order?.side ?? "").toUpperCase();
  if (s === "B" || s === "BUY" || s === "LONG") return true;
  if (s === "A" || s === "SELL" || s === "SHORT") return false;
  return null;
}

function normalizePendingOrders(raw) {
  if (!Array.isArray(raw)) return [];
  const expanded = expandHyperliquidOrderRows(raw);
  return expanded
    .map((order) => {
      const trigFromField = parseHlPositivePx(order?.triggerPx);
      const trigFromCondition = parseTriggerPxFromHyperliquidTriggerCondition(order?.triggerCondition);
      const trig = trigFromField ?? trigFromCondition;
      const lim = parseHlPositivePx(order?.limitPx);
      const sz = Number(String(order?.sz ?? "").trim() || 0) || 0;
      const ts = Number(order?.timestamp ?? order?.time ?? 0);
      return {
        coin: normalizeSymbol(order?.coin),
        oid: Number(order?.oid ?? 0) || null,
        side: String(order?.side || ""),
        sz,
        timestamp: Number.isFinite(ts) && ts > 0 ? ts : 0,
        triggerPx: trig,
        limitPx: lim,
        triggerCondition: typeof order?.triggerCondition === "string" ? order.triggerCondition : "",
        isTrigger: Boolean(order?.isTrigger) || trig != null,
        reduceOnly: parseHlReduceOnly(order),
        isBuy: orderIsBuyFromHyperliquid(order)
      };
    })
    .filter((order) => order.coin);
}

/**
 * Exchange stop for an open position: reduce-only trigger (or trigger-style) order that closes the position.
 * Controller / HUD stop (stopLossBySymbol) is separate — this reads what is actually resting on the book.
 */
function inferExchangeStopLossFromPendingOrders(pendingOrders, { side, entryPx = null } = {}) {
  if (side !== "long" && side !== "short") return null;
  const rows = normalizePendingOrders(Array.isArray(pendingOrders) ? pendingOrders : []);
  if (rows.length === 0) return null;

  const entryEps = 1e-8;

  const triggerPrice = (o) => {
    const trig = Number(o.triggerPx ?? 0);
    const lim = Number(o.limitPx ?? 0);
    const trigOk = Number.isFinite(trig) && trig > 0;
    const limOk = Number.isFinite(lim) && lim > 0;
    if (trigOk) return trig;
    // Stop-limit / TP-SL rows often omit triggerPx and isTrigger but still set limitPx + reduceOnly.
    if (limOk && (o.isTrigger || o.reduceOnly)) return lim;
    return null;
  };

  const closesPosition = (o) => {
    if (typeof o.isBuy === "boolean") {
      if (side === "long") return o.isBuy === false;
      return o.isBuy === true;
    }
    if (!o.reduceOnly) return false;
    const px = triggerPrice(o);
    if (px == null || px <= 0) return false;
    const entry = entryPx != null ? Number(entryPx) : NaN;
    if (!Number.isFinite(entry) || entry <= 0) return false;
    if (side === "long") return px < entry + entryEps;
    return px >= entry - entryEps;
  };

  const collectTuples = (requireReduceOnly) => {
    const out = [];
    for (const o of rows) {
      if (requireReduceOnly && !o.reduceOnly) continue;
      if (!requireReduceOnly && !o.reduceOnly) {
        const tr = Number(o.triggerPx ?? 0);
        if (!(o.isTrigger || (Number.isFinite(tr) && tr > 0))) continue;
      }
      const px = triggerPrice(o);
      if (px == null || px <= 0) continue;
      if (!closesPosition(o)) continue;
      out.push({
        px,
        sz: Number(o.sz ?? 0) || 0,
        oid: o.oid,
        timestamp: Number(o.timestamp ?? 0) || 0
      });
    }
    return out;
  };

  let tuples = collectTuples(true);
  if (tuples.length === 0) tuples = collectTuples(false);

  if (tuples.length === 0) {
    console.log("[tradeState] inferExchangeStopLossFromPendingOrders: no candidate", {
      side,
      entryPx,
      orderCount: rows.length,
      orders: rows.map((o) => ({
        coin: o.coin,
        oid: o.oid,
        timestamp: o.timestamp || null,
        triggerPx: o.triggerPx,
        limitPx: o.limitPx,
        triggerCondition: o.triggerCondition || null,
        isTrigger: o.isTrigger,
        reduceOnly: o.reduceOnly,
        isBuy: o.isBuy,
        priceUsed: triggerPrice(o)
      }))
    });
    return null;
  }

  const entry = entryPx != null ? Number(entryPx) : NaN;
  let pool = tuples;
  if (Number.isFinite(entry) && entry > 0) {
    if (side === "long") {
      const below = pool.filter((t) => t.px < entry + entryEps);
      if (below.length > 0) pool = below;
    } else {
      const above = pool.filter((t) => t.px >= entry - entryEps);
      if (above.length > 0) pool = above;
    }
  }
  if (pool.length === 0) pool = tuples;

  pool.sort((a, b) => {
    const tb = Number(b.timestamp) || 0;
    const ta = Number(a.timestamp) || 0;
    if (tb !== ta) return tb - ta;
    const ob = Number(b.oid) || 0;
    const oa = Number(a.oid) || 0;
    return ob - oa;
  });
  return pool[0].px;
}

/** Best-effort trigger for logging / loose reconcile: condition → triggerPx → limitPx. */
function hyperliquidOpenOrderStopTriggerPx(order) {
  if (!order || typeof order !== "object") return null;
  const fromField = parseHlPositivePx(order.triggerPx);
  if (fromField != null) return fromField;
  const fromCond = parseTriggerPxFromHyperliquidTriggerCondition(order.triggerCondition);
  if (fromCond != null) return fromCond;
  return parseHlPositivePx(order.limitPx);
}

function createBaseState(symbol, mode) {
  return {
    symbol: normalizeSymbol(symbol),
    mode: normalizeMode(mode),
    status: "FLAT",
    side: null,
    size: 0,
    entryPx: 0,
    stopLoss: 0,
    /** Inferred from resting reduce-only / trigger orders (see inferExchangeStopLossFromPendingOrders). */
    stopLossFromPendingOrders: 0,
    stopOrderRef: null,
    pendingOrders: [],
    executionMeta: defaultExecutionMeta(),
    updatedAt: nowMs(),
    lastAction: null,
    error: null
  };
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

/**
 * Clone for Socket/API clients: guarantees numeric stop fields, including exchange-inferred
 * `stopLossFromPendingOrders` (see inferExchangeStopLossFromPendingOrders).
 */
function toClientTradeState(state) {
  if (!state) return null;
  const out = cloneState(state);
  out.stopLoss = Number(out.stopLoss ?? 0) || 0;
  out.stopLossFromPendingOrders = Number(out.stopLossFromPendingOrders ?? 0) || 0;
  return out;
}

function summarizeState(state) {
  if (!state) return null;
  return {
    mode: state.mode,
    symbol: state.symbol,
    status: state.status,
    side: state.side,
    size: Number(state.size ?? 0) || 0,
    entryPx: Number(state.entryPx ?? 0) || 0,
    stopLoss: Number(state.stopLoss ?? 0) || 0,
    stopLossFromPendingOrders: Number(state.stopLossFromPendingOrders ?? 0) || 0,
    pendingOrders: Array.isArray(state.pendingOrders) ? state.pendingOrders.length : 0,
    stopOrderRef: state.stopOrderRef || null,
    lastAction: state.lastAction || null,
    error: state.error || null,
    updatedAt: state.updatedAt || null,
    executionMeta: {
      entryPxRequested: state.executionMeta?.entryPxRequested ?? null,
      entryPxFilled: state.executionMeta?.entryPxFilled ?? null,
      stopLossRequested: state.executionMeta?.stopLossRequested ?? null,
      stopLossPlaced: state.executionMeta?.stopLossPlaced ?? null,
      openedAtMs: state.executionMeta?.openedAtMs ?? null,
      closedAtMs: state.executionMeta?.closedAtMs ?? null
    }
  };
}

/** Verbose trade-manager logs only when there is/was a live position, pending lifecycle, resting orders, or ERROR. */
function shouldLogTradePositionContext(state) {
  if (!state || typeof state !== "object") return false;
  if (state.status === "ERROR") return true;
  if (state.status === "OPEN" || state.status === "PENDING_OPEN" || state.status === "PENDING_CLOSE") return true;
  const sz = Number(state.size ?? 0);
  if (Number.isFinite(sz) && sz > 0) return true;
  return Array.isArray(state.pendingOrders) && state.pendingOrders.length > 0;
}

class TradeStateManager {
  constructor(options = {}) {
    this.byKey = new Map();
    this.onUpdate = typeof options.onUpdate === "function" ? options.onUpdate : null;
  }

  emitUpdate(state) {
    if (!this.onUpdate) return;
    this.onUpdate(toClientTradeState(state));
  }

  /** Full trade row for clients (socket snapshot, initialState); includes `stopLossFromPendingOrders`. */
  getClientSnapshot(symbol, mode = "live") {
    const key = keyFor(mode, symbol);
    const existing = this.byKey.get(key);
    const raw = existing || createBaseState(symbol, mode);
    return toClientTradeState(raw);
  }

  log(label, payload = undefined) {
    if (payload === undefined) {
      console.log(`[tradeState.manager] ${label}`);
      return;
    }
    console.log(`[tradeState.manager] ${label}`, payload);
  }

  get(symbol, mode = "live") {
    const key = keyFor(mode, symbol);
    const existing = this.byKey.get(key);
    if (!existing) return createBaseState(symbol, mode);
    return cloneState(existing);
  }

  getAll({ mode = null } = {}) {
    const normalizedMode = mode ? normalizeMode(mode) : null;
    const output = [];
    for (const [, state] of this.byKey.entries()) {
      if (normalizedMode && state.mode !== normalizedMode) continue;
      output.push(cloneState(state));
    }
    return output.sort((a, b) => {
      if (a.mode !== b.mode) return a.mode.localeCompare(b.mode);
      return a.symbol.localeCompare(b.symbol);
    });
  }

  /** Drop persisted row (e.g. symbol removed from streams). Does not emit onUpdate. */
  deleteKey(symbol, mode = "live") {
    const key = keyFor(mode, symbol);
    const removed = this.byKey.delete(key);
    if (removed) this.log("deleteKey", { key });
    return removed;
  }

  upsert(symbol, mode, patch = {}) {
    const key = keyFor(mode, symbol);
    const prev = this.byKey.get(key) || createBaseState(symbol, mode);
    const next = {
      ...prev,
      ...patch,
      symbol: normalizeSymbol(symbol),
      mode: normalizeMode(mode),
      stopLossFromPendingOrders:
        patch.stopLossFromPendingOrders === undefined
          ? prev.stopLossFromPendingOrders
          : Number(patch.stopLossFromPendingOrders ?? 0) || 0,
      stopOrderRef:
        patch.stopOrderRef === undefined ? prev.stopOrderRef : normalizeStopOrderRef(patch.stopOrderRef),
      pendingOrders:
        patch.pendingOrders === undefined
          ? prev.pendingOrders
          : normalizePendingOrders(patch.pendingOrders),
      executionMeta: {
        ...defaultExecutionMeta(),
        ...(prev.executionMeta || {}),
        ...(patch.executionMeta || {})
      },
      updatedAt: nowMs()
    };
    this.byKey.set(key, next);
    if (shouldLogTradePositionContext(next) || shouldLogTradePositionContext(prev)) {
      this.log("upsert", {
        key,
        patchKeys: Object.keys(patch || {}),
        patch: cloneState(patch || {}),
        prev: cloneState(prev),
        next: cloneState(next)
      });
    }
    this.emitUpdate(next);
    return cloneState(next);
  }

  setPendingOpen({
    symbol,
    mode = "live",
    side,
    requestedSize = null,
    requestedNotional = null,
    requestedLeverage = null,
    requestedEntryPx = null,
    requestedStopLoss = null,
    slippageBpsRequested = null,
    lastAction = "cross"
  }) {
    return this.upsert(symbol, mode, {
      status: "PENDING_OPEN",
      side: side === "short" ? "short" : "long",
      lastAction,
      error: null,
      executionMeta: {
        requestedSize,
        requestedNotional,
        requestedLeverage,
        entryPxRequested: requestedEntryPx,
        stopLossRequested: requestedStopLoss,
        slippageBpsRequested
      }
    });
  }

  // Explicit action lifecycle wrappers to keep server-side transitions uniform.
  applyActionStart({ symbol, mode = "live", action, payload = {} }) {
    const normalizedAction = String(action || "").trim();
    this.log("applyActionStart", {
      mode: normalizeMode(mode),
      symbol: normalizeSymbol(symbol),
      action: normalizedAction || null,
      payload
    });
    if (normalizedAction === "cross") {
      return this.setPendingOpen({
        symbol,
        mode,
        side: payload.side,
        requestedSize: payload.requestedSize ?? null,
        requestedNotional: payload.requestedNotional ?? null,
        requestedLeverage: payload.requestedLeverage ?? null,
        requestedEntryPx: payload.requestedEntryPx ?? null,
        requestedStopLoss: payload.requestedStopLoss ?? null,
        slippageBpsRequested: payload.slippageBpsRequested ?? null,
        lastAction: "cross"
      });
    }
    if (normalizedAction === "triangle" || normalizedAction === "circle" || normalizedAction === "updateStopLoss") {
      return this.setPendingClose({ symbol, mode, lastAction: normalizedAction });
    }
    return this.upsert(symbol, mode, {
      lastAction: normalizedAction || "action_start",
      error: null
    });
  }

  applyActionSuccess({ symbol, mode = "live", action, payload = {} }) {
    const normalizedAction = String(action || "").trim();
    this.log("applyActionSuccess", {
      mode: normalizeMode(mode),
      symbol: normalizeSymbol(symbol),
      action: normalizedAction || null,
      payload: cloneState(payload || {})
    });
    if (payload.position) {
      return this.reconcileFromAccountSnapshot({
        symbol,
        mode,
        position: payload.position,
        stopLoss: payload.stopLoss ?? null,
        stopLossFromPendingOrders: payload.stopLossFromPendingOrders,
        stopOrderRef: payload.stopOrderRef ?? null,
        pendingOrders: payload.pendingOrders ?? null,
        lastAction: normalizedAction || "action_success",
        executionMeta: payload.executionMeta || {}
      });
    }
    if (normalizedAction === "circle") {
      return this.setClosed({ symbol, mode, lastAction: "circle" });
    }
    return this.upsert(symbol, mode, {
      lastAction: normalizedAction || "action_success",
      error: null,
      executionMeta: payload.executionMeta || {}
    });
  }

  applyActionError({ symbol, mode = "live", action, error }) {
    this.log("applyActionError", {
      mode: normalizeMode(mode),
      symbol: normalizeSymbol(symbol),
      action: String(action || "action_error"),
      error: String(error || "unknown error")
    });
    return this.setError({
      symbol,
      mode,
      lastAction: String(action || "action_error"),
      error
    });
  }

  setOpen({
    symbol,
    mode = "live",
    side,
    size,
    entryPx,
    stopLoss = null,
    stopLossFromPendingOrders = 0,
    stopOrderRef = null,
    pendingOrders = null,
    lastAction = "open",
    executionMeta = {}
  }) {
    return this.upsert(symbol, mode, {
      status: "OPEN",
      side: side === "short" ? "short" : "long",
      size: Number(size ?? 0) || 0,
      entryPx: Number(entryPx ?? 0) || 0,
      stopLoss: Number(stopLoss ?? 0) || 0,
      stopLossFromPendingOrders: Number(stopLossFromPendingOrders ?? 0) || 0,
      stopOrderRef,
      pendingOrders: pendingOrders ?? undefined,
      lastAction,
      error: null,
      executionMeta: {
        ...executionMeta,
        openedAtMs: executionMeta?.openedAtMs || nowMs()
      }
    });
  }

  setPendingClose({ symbol, mode = "live", lastAction = "close" }) {
    return this.upsert(symbol, mode, {
      status: "PENDING_CLOSE",
      lastAction,
      error: null
    });
  }

  setClosed({ symbol, mode = "live", lastAction = "close" }) {
    const prev = this.get(symbol, mode);
    return this.upsert(symbol, mode, {
      status: "FLAT",
      side: null,
      size: 0,
      entryPx: 0,
      stopLossFromPendingOrders: 0,
      stopOrderRef: null,
      pendingOrders: [],
      lastAction,
      error: null,
      executionMeta: {
        ...(prev.executionMeta || {}),
        closedAtMs: nowMs()
      }
    });
  }

  setError({ symbol, mode = "live", lastAction = "unknown", error }) {
    return this.upsert(symbol, mode, {
      status: "ERROR",
      lastAction,
      error: String(error || "unknown error")
    });
  }

  setStopOrderRef({ symbol, mode = "live", stopOrderRef, stopLossPlaced = null }) {
    return this.upsert(symbol, mode, {
      stopOrderRef,
      executionMeta: {
        stopLossPlaced
      }
    });
  }

  clearStopOrderRef({ symbol, mode = "live" }) {
    return this.upsert(symbol, mode, {
      stopOrderRef: null
    });
  }

  setStopLossValue({ symbol, mode = "live", stopLoss }) {
    return this.upsert(symbol, mode, {
      stopLoss: Number(stopLoss ?? 0) || 0
    });
  }

  setPendingOrders({ symbol, mode = "live", pendingOrders }) {
    return this.upsert(symbol, mode, { pendingOrders });
  }

  mergePendingOrdersAndStops({
    symbol,
    mode = "live",
    pendingOrders,
    stopOrderRef = undefined,
    stopLoss = undefined,
    stopLossFromPendingOrders = undefined
  }) {
    return this.upsert(symbol, mode, {
      pendingOrders: pendingOrders ?? [],
      stopOrderRef,
      stopLoss,
      ...(stopLossFromPendingOrders !== undefined
        ? { stopLossFromPendingOrders: Number(stopLossFromPendingOrders ?? 0) || 0 }
        : {})
    });
  }

  reconcileFromPositionSnapshot({
    symbol,
    mode = "live",
    position = null,
    stopLoss = null,
    stopLossFromPendingOrders: stopLossFromPendingOrdersOpt = undefined,
    stopOrderRef = null,
    pendingOrders = null,
    lastAction = "reconcile",
    executionMeta = {}
  }) {
    const normalizedSymbol = normalizeSymbol(symbol);
    const key = keyFor(mode, normalizedSymbol);
    const prev = this.byKey.get(key) || createBaseState(normalizedSymbol, mode);
    const posSize = Math.abs(Number(position?.szi ?? 0));
    const logReconcileIn =
      (Number.isFinite(posSize) && posSize > 0) ||
      (Array.isArray(pendingOrders) && pendingOrders.length > 0) ||
      shouldLogTradePositionContext(prev);
    if (logReconcileIn) {
      this.log("reconcileFromPositionSnapshot:in", {
        mode: normalizeMode(mode),
        symbol: normalizedSymbol,
        position: position ? cloneState(position) : null,
        stopLoss: stopLoss == null ? null : Number(stopLoss),
        stopOrderRef: stopOrderRef ? cloneState(stopOrderRef) : null,
        pendingOrders: Array.isArray(pendingOrders) ? cloneState(pendingOrders) : null,
        lastAction,
        executionMeta: cloneState(executionMeta || {}),
        prev: cloneState(prev),
        posSize: Number.isFinite(posSize) ? posSize : null
      });
    }
    if (!normalizedSymbol || !Number.isFinite(posSize) || posSize <= 0) {
      const wasPositioned =
        prev.status === "OPEN" ||
        prev.status === "PENDING_OPEN" ||
        prev.status === "PENDING_CLOSE";
      const executionMetaPatch = {
        ...executionMeta,
        ...(wasPositioned ? { closedAtMs: nowMs() } : {})
      };
      return this.upsert(normalizedSymbol, mode, {
        status: "FLAT",
        side: null,
        size: 0,
        entryPx: 0,
        stopLoss: Number(stopLoss ?? 0) || 0,
        stopLossFromPendingOrders: 0,
        stopOrderRef,
        pendingOrders: pendingOrders ?? [],
        lastAction,
        error: null,
        executionMeta: executionMetaPatch
      });
    }

    const side = Number(position?.szi ?? 0) > 0 ? "long" : "short";
    const entryPx = Number(position?.entryPx ?? 0) || 0;
    let stopLossFromPendingOrders = stopLossFromPendingOrdersOpt;
    if (stopLossFromPendingOrders === undefined) {
      stopLossFromPendingOrders = inferExchangeStopLossFromPendingOrders(pendingOrders ?? [], {
        side,
        entryPx: Number.isFinite(entryPx) && entryPx > 0 ? entryPx : null
      });
    }
    const stopLossFromOrdersNum =
      stopLossFromPendingOrders != null &&
      Number.isFinite(Number(stopLossFromPendingOrders)) &&
      Number(stopLossFromPendingOrders) > 0
        ? Number(stopLossFromPendingOrders)
        : 0;
    return this.setOpen({
      symbol: normalizedSymbol,
      mode,
      side,
      size: posSize,
      entryPx,
      stopLoss,
      stopLossFromPendingOrders: stopLossFromOrdersNum,
      stopOrderRef,
      pendingOrders,
      lastAction,
      executionMeta
    });
  }

  reconcileFromAccountSnapshot({
    symbol,
    mode = "live",
    position = null,
    stopLoss = null,
    stopLossFromPendingOrders = undefined,
    stopOrderRef = null,
    pendingOrders = null,
    lastAction = "reconcile",
    executionMeta = {}
  }) {
    return this.reconcileFromPositionSnapshot({
      symbol,
      mode,
      position,
      stopLoss,
      stopLossFromPendingOrders,
      stopOrderRef,
      pendingOrders,
      lastAction,
      executionMeta
    });
  }
}

function createTradeStateStore(options = {}) {
  return new TradeStateManager(options);
}

module.exports = {
  TradeStateManager,
  createTradeStateStore,
  normalizeMode,
  normalizeSymbol,
  inferExchangeStopLossFromPendingOrders,
  hyperliquidOpenOrderStopTriggerPx,
  toClientTradeState
};

