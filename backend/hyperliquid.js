const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { Wallet } = require("ethers");
const { ExchangeClient, HttpTransport, InfoClient } = require("@nktkas/hyperliquid");
const { formatPrice, formatSize } = require("@nktkas/hyperliquid/utils");

// ---------------------------------------------------------------------------
// Env files: .env for live, .env_test for testnet
// ---------------------------------------------------------------------------

const ROOT_DIR = path.resolve(__dirname, "..");

function parseEnvFile(filename) {
  const filePath = path.join(ROOT_DIR, filename);
  try {
    if (!fs.existsSync(filePath)) return {};
    return dotenv.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

const liveEnvVars = parseEnvFile(".env");
const testEnvVars = parseEnvFile(".env_test");

// ---------------------------------------------------------------------------
// Mode-aware configuration (live / test)
// ---------------------------------------------------------------------------

const HYPERLIQUID_INFO_URL_LIVE =
  process.env.HYPERLIQUID_INFO_URL_LIVE ||
  "https://api.hyperliquid.xyz/info";

const HYPERLIQUID_INFO_URL_TEST =
  process.env.HYPERLIQUID_INFO_URL_TEST ||
  "https://api.hyperliquid-testnet.xyz/info";

const HYPERLIQUID_ACCOUNT_LIVE =
  liveEnvVars.Main_Wallet_Address ||
  process.env.HYPERLIQUID_ACCOUNT_LIVE ||
  process.env.HYPERLIQUID_ACCOUNT ||
  "";

const HYPERLIQUID_ACCOUNT_TEST =
  testEnvVars.Main_Wallet_Address ||
  process.env.HYPERLIQUID_ACCOUNT_TEST ||
  "";

console.log("[hyperliquid] Live wallet:", HYPERLIQUID_ACCOUNT_LIVE ? `${HYPERLIQUID_ACCOUNT_LIVE.slice(0, 8)}...` : "(not configured)");
console.log("[hyperliquid] Test wallet:", HYPERLIQUID_ACCOUNT_TEST ? `${HYPERLIQUID_ACCOUNT_TEST.slice(0, 8)}...` : "(not configured)");

function getConfig(mode) {
  if (mode === "test") {
    return { infoUrl: HYPERLIQUID_INFO_URL_TEST, account: HYPERLIQUID_ACCOUNT_TEST };
  }
  return { infoUrl: HYPERLIQUID_INFO_URL_LIVE, account: HYPERLIQUID_ACCOUNT_LIVE };
}

function isAccountConfiguredForMode(mode) {
  const { account } = getConfig(mode);
  return Boolean(account && account.length > 2 && !account.includes("REPLACE_WITH"));
}

// ---------------------------------------------------------------------------
// TTL cache
// ---------------------------------------------------------------------------

const cache = new Map();
const CACHE_TTL_MS = 5_000;

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCache(key, value) {
  cache.set(key, { value, ts: Date.now() });
}

// ---------------------------------------------------------------------------
// Generic Hyperliquid POST helper
// ---------------------------------------------------------------------------

async function hlPost(mode, body) {
  const { infoUrl } = getConfig(mode);
  const response = await fetch(infoUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`Hyperliquid HTTP ${response.status}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// SDK client cache (for signed/exchange operations)
// ---------------------------------------------------------------------------

const clientCache = new Map();
const MIN_ORDER_NOTIONAL = 10;

function getModeSecrets(mode = "live") {
  const envVars = mode === "test" ? testEnvVars : liveEnvVars;
  const privateKey = String(
    envVars.Private_Key || process.env[`HYPERLIQUID_PRIVATE_KEY_${mode.toUpperCase()}`] || ""
  ).trim();
  const { account } = getConfig(mode);
  return { privateKey, account };
}

function getOrCreateClients(mode = "live") {
  if (clientCache.has(mode)) return clientCache.get(mode);

  const isTestnet = mode === "test";
  const { privateKey, account } = getModeSecrets(mode);
  if (!privateKey) {
    throw new Error(`No ${mode} private key configured`);
  }
  if (!account) {
    throw new Error(`No ${mode} account address configured`);
  }

  const transport = new HttpTransport({ isTestnet });
  const wallet = new Wallet(privateKey);
  const exchange = new ExchangeClient({ transport, wallet });
  const info = new InfoClient({ transport });

  const clients = { transport, exchange, info, account };
  clientCache.set(mode, clients);
  return clients;
}

// ---------------------------------------------------------------------------
// Fetchers (raw payloads, cached)
// ---------------------------------------------------------------------------

async function fetchClearinghouseState(mode = "live") {
  const cacheKey = `clearinghouse:${mode}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const { account } = getConfig(mode);
  const payload = await hlPost(mode, { type: "clearinghouseState", user: account });
  setCache(cacheKey, payload);
  return payload;
}

async function fetchSpotClearinghouseState(mode = "live") {
  const cacheKey = `spotClearinghouse:${mode}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const { account } = getConfig(mode);
  const payload = await hlPost(mode, { type: "spotClearinghouseState", user: account });
  setCache(cacheKey, payload);
  return payload;
}

async function fetchUserFills(mode = "live") {
  const cacheKey = `fills:${mode}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const { account } = getConfig(mode);
  const payload = await hlPost(mode, { type: "userFills", user: account });
  setCache(cacheKey, payload);
  return payload;
}

async function fetchUserFees(mode = "live") {
  const cacheKey = `fees:${mode}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const { account } = getConfig(mode);
  const payload = await hlPost(mode, { type: "userFees", user: account });
  setCache(cacheKey, payload);
  return payload;
}

async function fetchMeta(mode = "live") {
  const cacheKey = `meta:${mode}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const payload = await hlPost(mode, { type: "meta" });
  setCache(cacheKey, payload);
  return payload;
}

/**
 * Use `frontendOpenOrders` (not bare `openOrders`): the minimal openOrders response often omits
 * triggerPx / triggerCondition / orderType — the UI shows e.g. "Price below 1.431" while only limitPx is present on openOrders.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
 */
async function fetchOpenOrders(mode = "live") {
  const { account } = getConfig(mode);
  const payload = await hlPost(mode, { type: "frontendOpenOrders", user: account });
  return Array.isArray(payload) ? payload : [];
}

async function fetchAllMids(mode = "live") {
  const cacheKey = `allMids:${mode}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const payload = await hlPost(mode, { type: "allMids" });
  setCache(cacheKey, payload);
  return payload;
}

async function fetchMidPrice(symbol, mode = "live") {
  const mids = await fetchAllMids(mode);
  const upper = String(symbol || "").trim().toUpperCase();
  const price = Number(mids?.[upper] ?? 0);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`No mid price available for ${upper}`);
  }
  return price;
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function normalizeSpotBalances(spotPayload) {
  const balances = Array.isArray(spotPayload?.balances) ? spotPayload.balances : [];
  const result = [];
  let totalUsdValue = 0;
  for (const b of balances) {
    const total = Number(b?.total ?? 0);
    if (total <= 0) continue;
    const coin = String(b?.coin ?? "");
    result.push({ coin, total, hold: Number(b?.hold ?? 0) });
    if (coin === "USDC" || coin === "USDT0" || coin === "USDE" || coin === "USDH") {
      totalUsdValue += total;
    }
  }
  return { balances: result, totalUsdValue };
}

function normalizeAccountOverview(perpsPayload, spotPayload) {
  const ms = perpsPayload?.marginSummary || {};
  const cms = perpsPayload?.crossMarginSummary || {};
  const perpsAccountValue = Number(ms.accountValue ?? cms.accountValue ?? 0);
  const perpsWithdrawable = Number(perpsPayload?.withdrawable ?? 0);

  const spot = normalizeSpotBalances(spotPayload);

  return {
    accountValue: perpsAccountValue + spot.totalUsdValue,
    perpsAccountValue,
    spotUsdValue: spot.totalUsdValue,
    spotBalances: spot.balances,
    totalNtlPos: Number(ms.totalNtlPos ?? cms.totalNtlPos ?? 0),
    totalMarginUsed: Number(ms.totalMarginUsed ?? cms.totalMarginUsed ?? 0),
    totalRawUsd: Number(ms.totalRawUsd ?? cms.totalRawUsd ?? 0),
    withdrawable: perpsWithdrawable + spot.totalUsdValue,
    crossMaintenanceMarginUsed: Number(perpsPayload?.crossMaintenanceMarginUsed ?? 0),
    time: perpsPayload?.time ?? null
  };
}

function normalizePositions(payload) {
  const raw = Array.isArray(payload?.assetPositions) ? payload.assetPositions : [];
  return raw.map((entry) => {
    const pos = entry?.position || entry;
    return {
      coin: String(pos?.coin ?? ""),
      szi: Number(pos?.szi ?? 0),
      entryPx: Number(pos?.entryPx ?? 0),
      positionValue: Number(pos?.positionValue ?? 0),
      unrealizedPnl: Number(pos?.unrealizedPnl ?? 0),
      returnOnEquity: Number(pos?.returnOnEquity ?? 0),
      liquidationPx: pos?.liquidationPx != null ? Number(pos.liquidationPx) : null,
      marginUsed: Number(pos?.marginUsed ?? 0),
      maxLeverage: Number(pos?.maxLeverage ?? 50),
      leverage: {
        type: String(pos?.leverage?.type ?? "cross"),
        value: Number(pos?.leverage?.value ?? 1)
      },
      cumFunding: {
        allTime: Number(pos?.cumFunding?.allTime ?? 0),
        sinceOpen: Number(pos?.cumFunding?.sinceOpen ?? 0),
        sinceChange: Number(pos?.cumFunding?.sinceChange ?? 0)
      }
    };
  }).filter((p) => p.coin && p.szi !== 0);
}

function normalizeFills(payload) {
  const raw = Array.isArray(payload) ? payload : [];
  return raw.slice(0, 200).map((f) => ({
    coin: String(f?.coin ?? ""),
    side: String(f?.side ?? ""),
    px: Number(f?.px ?? 0),
    sz: Number(f?.sz ?? 0),
    time: Number(f?.time ?? 0),
    fee: Number(f?.fee ?? 0),
    feeToken: String(f?.feeToken ?? "USDC"),
    closedPnl: Number(f?.closedPnl ?? 0),
    dir: String(f?.dir ?? ""),
    crossed: Boolean(f?.crossed),
    oid: f?.oid ?? null,
    tid: f?.tid ?? null
  }));
}

function normalizeFeeRates(payload) {
  return {
    userAddRate: Number(payload?.userAddRate ?? 0),
    userCrossRate: Number(payload?.userCrossRate ?? 0),
    userSpotAddRate: Number(payload?.userSpotAddRate ?? 0),
    userSpotCrossRate: Number(payload?.userSpotCrossRate ?? 0),
    baseAdd: Number(payload?.feeSchedule?.add ?? 0),
    baseCross: Number(payload?.feeSchedule?.cross ?? 0)
  };
}

function normalizeMetaForSymbol(metaPayload, symbol) {
  const universe = Array.isArray(metaPayload?.universe) ? metaPayload.universe : [];
  const entry = universe.find(
    (e) => String(e?.name ?? "").toUpperCase() === String(symbol).toUpperCase()
  );
  if (!entry) return null;
  return {
    name: String(entry.name ?? ""),
    szDecimals: Number(entry.szDecimals ?? 0),
    maxLeverage: Number(entry.maxLeverage ?? 50),
    onlyIsolated: Boolean(entry.onlyIsolated)
  };
}

// ---------------------------------------------------------------------------
// Leverage / risk calculators
// ---------------------------------------------------------------------------

function computeLeveragePreview({
  stopLossDistancePct,
  riskBudgetPct = 2,
  makerFeePct = 0,
  takerFeePct = 0,
  slippageBps = 0,
  exchangeMaxLeverage = 50,
  accountBalance = 0,
  entryPrice = 0
}) {
  const slippageFrac = slippageBps / 10000;
  const stopFrac = stopLossDistancePct / 100;
  const effectiveLossRate = stopFrac + makerFeePct + takerFeePct + slippageFrac;

  if (effectiveLossRate <= 0 || !Number.isFinite(effectiveLossRate)) {
    return {
      effectiveLossPct: 0,
      recommendedLeverage: 0,
      exchangeMaxLeverage,
      cappedLeverage: 0,
      entryFeePct: makerFeePct * 100,
      exitFeePct: takerFeePct * 100,
      totalFeePct: (makerFeePct + takerFeePct) * 100,
      slippagePct: slippageFrac * 100,
      riskDollars: 0,
      notionalPosition: 0,
      positionSizeUnits: 0,
      feeBufferPct: (makerFeePct + takerFeePct + slippageFrac) * 100,
      feeCostUsd: 0,
      warning: "Stop-loss distance too small or invalid"
    };
  }

  const rawLeverage = (riskBudgetPct / 100) / effectiveLossRate;
  const cappedLeverage = Math.min(rawLeverage, exchangeMaxLeverage);
  const safeLeverage = Math.max(1, Math.floor(cappedLeverage * 100) / 100);

  const notionalPosition = accountBalance * safeLeverage;
  const riskDollars = notionalPosition * effectiveLossRate;
  const positionSizeUnits = entryPrice > 0 ? notionalPosition / entryPrice : 0;
  const feeCostUsd = notionalPosition * (makerFeePct + takerFeePct + slippageFrac);

  const feePctOfRisk = effectiveLossRate > 0
    ? ((makerFeePct + takerFeePct + slippageFrac) / effectiveLossRate) * 100
    : 0;

  let warning = null;
  if (feePctOfRisk > 30) {
    warning = `Planning buffer dominates risk: fees + assumed execution slippage are ${feePctOfRisk.toFixed(1)}% of total loss model. This is a conservative estimate; consider a wider stop.`;
  }
  if (rawLeverage > exchangeMaxLeverage) {
    warning = `Recommended leverage (${rawLeverage.toFixed(2)}x) exceeds exchange max (${exchangeMaxLeverage}x) — capped`;
  }

  return {
    effectiveLossPct: effectiveLossRate * 100,
    recommendedLeverage: Math.round(rawLeverage * 100) / 100,
    exchangeMaxLeverage,
    cappedLeverage: safeLeverage,
    entryFeePct: makerFeePct * 100,
    exitFeePct: takerFeePct * 100,
    totalFeePct: (makerFeePct + takerFeePct) * 100,
    slippagePct: slippageFrac * 100,
    riskDollars: Math.round(riskDollars * 100) / 100,
    notionalPosition: Math.round(notionalPosition * 100) / 100,
    positionSizeUnits: Math.round(positionSizeUnits * 1e6) / 1e6,
    feeBufferPct: (makerFeePct + takerFeePct + slippageFrac) * 100,
    feeCostUsd: Math.round(feeCostUsd * 100) / 100,
    warning
  };
}

function computeStopLossProjections({
  currentPrice,
  stopLossPrice,
  accountBalance,
  riskBudgetPct,
  makerFeePct,
  takerFeePct,
  slippageBps,
  exchangeMaxLeverage
}) {
  if (
    !Number.isFinite(currentPrice) || currentPrice <= 0 ||
    !Number.isFinite(stopLossPrice) || stopLossPrice <= 0 ||
    !Number.isFinite(accountBalance) || accountBalance <= 0
  ) {
    return { long: null, short: null, feeBufferPrice: 0 };
  }

  const slippageFrac = (slippageBps || 0) / 10000;
  const feeBufferPrice = currentPrice * (makerFeePct + takerFeePct + slippageFrac);

  function buildProjection(distancePct) {
    if (distancePct <= 0) return null;
    const preview = computeLeveragePreview({
      stopLossDistancePct: distancePct,
      riskBudgetPct,
      makerFeePct,
      takerFeePct,
      slippageBps,
      exchangeMaxLeverage,
      accountBalance,
      entryPrice: currentPrice
    });
    return {
      distancePct,
      ...preview
    };
  }

  const longDistancePct = stopLossPrice < currentPrice
    ? ((currentPrice - stopLossPrice) / currentPrice) * 100
    : 0;
  const shortDistancePct = stopLossPrice > currentPrice
    ? ((stopLossPrice - currentPrice) / currentPrice) * 100
    : 0;

  return {
    long: longDistancePct > 0 ? buildProjection(longDistancePct) : null,
    short: shortDistancePct > 0 ? buildProjection(shortDistancePct) : null,
    feeBufferPrice: Math.round(feeBufferPrice * 1e6) / 1e6
  };
}

// ---------------------------------------------------------------------------
// Settings persistence (simple JSON file)
// ---------------------------------------------------------------------------

const SETTINGS_PATH = path.join(__dirname, "account-settings.json");

const DEFAULT_SETTINGS = {
  riskPercent: 2,
  takeProfitPercent: 2,
  slippageBps: 10,
  stopLossStep: 0.5
};

let settingsCache = null;

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      settingsCache = { ...DEFAULT_SETTINGS, ...parsed };
    } else {
      settingsCache = { ...DEFAULT_SETTINGS };
    }
  } catch {
    settingsCache = { ...DEFAULT_SETTINGS };
  }
  return settingsCache;
}

function getSettings() {
  if (!settingsCache) return loadSettings();
  return { ...settingsCache };
}

function patchSettings(partial) {
  const current = getSettings();
  const next = { ...current };

  if (partial.riskPercent !== undefined) {
    const v = Number(partial.riskPercent);
    if (Number.isFinite(v) && v > 0 && v <= 100) next.riskPercent = v;
  }
  if (partial.takeProfitPercent !== undefined) {
    const v = Number(partial.takeProfitPercent);
    if (Number.isFinite(v) && v > 0 && v <= 100) next.takeProfitPercent = v;
  }
  if (partial.slippageBps !== undefined) {
    const v = Number(partial.slippageBps);
    if (Number.isFinite(v) && v >= 0 && v <= 500) next.slippageBps = v;
  }
  if (partial.stopLossStep !== undefined) {
    const v = Number(partial.stopLossStep);
    if (Number.isFinite(v) && v > 0 && v <= 1000) next.stopLossStep = v;
  }
  settingsCache = next;
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), "utf-8");
  } catch (err) {
    console.log("[hyperliquid] Failed to persist settings:", err?.message || err);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Legacy helpers (backward compat with server.js)
// ---------------------------------------------------------------------------

function computePositionSize(balance, lastPrice) {
  const settings = getSettings();
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
    return 0;
  }
  return (balance * (settings.riskPercent / 100)) / lastPrice;
}

function emitHudUpdate(io, { stopLossPrice, balance, lastPrice }) {
  io.emit("hudUpdate", {
    stopLossPrice,
    balance,
    positionSize: computePositionSize(balance, lastPrice)
  });
}

async function fetchAccountBalance(mode = "live") {
  try {
    const [perpsPayload, spotPayload] = await Promise.all([
      fetchClearinghouseState(mode),
      fetchSpotClearinghouseState(mode).catch(() => null)
    ]);

    const perpsBalance = Number(
      perpsPayload?.marginSummary?.accountValue ??
        perpsPayload?.crossMarginSummary?.accountValue ??
        perpsPayload?.withdrawable ??
        0
    );

    let spotBalance = 0;
    if (spotPayload) {
      const spot = normalizeSpotBalances(spotPayload);
      spotBalance = spot.totalUsdValue;
    }

    const totalBalance = perpsBalance + spotBalance;

    return Number.isFinite(totalBalance) && totalBalance >= 0 ? totalBalance : null;
  } catch (error) {
    throw error;
  }
}

function clearAccountCache(mode) {
  if (mode !== "live" && mode !== "test") return;
  cache.delete(`clearinghouse:${mode}`);
  cache.delete(`spotClearinghouse:${mode}`);
  cache.delete(`fills:${mode}`);
  cache.delete(`fees:${mode}`);
  cache.delete(`meta:${mode}`);
  cache.delete(`allMids:${mode}`);
}

// ---------------------------------------------------------------------------
// Exchange operations (trade execution, order management)
// ---------------------------------------------------------------------------

function roundDown(value, decimals = 6) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const factor = 10 ** Math.max(0, decimals);
  return Math.floor(value * factor) / factor;
}

function parseFirstOrderStatus(orderResponse) {
  const statuses = orderResponse?.response?.data?.statuses;
  if (!Array.isArray(statuses) || statuses.length === 0) {
    throw new Error("Exchange returned empty order status");
  }
  const first = statuses[0];
  if (typeof first === "string") {
    return { kind: first, raw: first, oid: null, avgPx: null, totalSz: null };
  }
  if (first?.error) {
    throw new Error(first.error);
  }
  if (first?.filled) {
    return {
      kind: "filled",
      raw: first,
      oid: Number(first.filled.oid ?? 0) || null,
      avgPx: Number(first.filled.avgPx ?? 0) || null,
      totalSz: Number(first.filled.totalSz ?? 0) || null
    };
  }
  if (first?.resting) {
    return {
      kind: "resting",
      raw: first,
      oid: Number(first.resting.oid ?? 0) || null,
      avgPx: null,
      totalSz: null
    };
  }
  if (first?.waitingForTrigger) {
    const waiting = first.waitingForTrigger || {};
    return {
      kind: "waitingForTrigger",
      raw: first,
      oid: Number(waiting.oid ?? waiting.order?.oid ?? 0) || null,
      avgPx: null,
      totalSz: Number(waiting.totalSz ?? waiting.order?.sz ?? 0) || null
    };
  }
  return { kind: "unknown", raw: first, oid: null, avgPx: null, totalSz: null };
}

function parseOrderStatusAt(orderResponse, index) {
  const statuses = orderResponse?.response?.data?.statuses;
  if (!Array.isArray(statuses) || statuses.length === 0) {
    throw new Error("Exchange returned empty order status");
  }
  const entry = statuses[index];
  if (entry === undefined) {
    throw new Error(`Exchange returned no order status at index ${index}`);
  }
  if (typeof entry === "string") {
    return { kind: entry, raw: entry, oid: null, avgPx: null, totalSz: null };
  }
  if (entry?.error) {
    throw new Error(entry.error);
  }
  if (entry?.filled) {
    return {
      kind: "filled",
      raw: entry,
      oid: Number(entry.filled.oid ?? 0) || null,
      avgPx: Number(entry.filled.avgPx ?? 0) || null,
      totalSz: Number(entry.filled.totalSz ?? 0) || null
    };
  }
  if (entry?.resting) {
    return {
      kind: "resting",
      raw: entry,
      oid: Number(entry.resting.oid ?? 0) || null,
      avgPx: null,
      totalSz: null
    };
  }
  if (entry?.waitingForTrigger) {
    const waiting = entry.waitingForTrigger || {};
    return {
      kind: "waitingForTrigger",
      raw: entry,
      oid: Number(waiting.oid ?? waiting.order?.oid ?? 0) || null,
      avgPx: null,
      totalSz: Number(waiting.totalSz ?? waiting.order?.sz ?? 0) || null
    };
  }
  return { kind: "unknown", raw: entry, oid: null, avgPx: null, totalSz: null };
}

async function resolveAsset(symbol, mode = "live") {
  const upper = String(symbol || "").trim().toUpperCase();
  if (!upper) throw new Error("Symbol is required");

  const { info } = getOrCreateClients(mode);
  const meta = await info.meta();
  const universe = Array.isArray(meta?.universe) ? meta.universe : [];
  const asset = universe.findIndex((entry) => String(entry?.name || "").toUpperCase() === upper);
  if (asset < 0) {
    throw new Error(`Unknown symbol: ${upper}`);
  }
  const entry = universe[asset] || {};
  return {
    symbol: upper,
    asset,
    szDecimals: Number(entry.szDecimals ?? 0),
    maxLeverage: Number(entry.maxLeverage ?? 50)
  };
}

async function resolveAssetIndex(symbol, mode = "live") {
  const resolved = await resolveAsset(symbol, mode);
  return resolved.asset;
}

function slippagePrice(livePrice, isBuy, szDecimals) {
  const slippageFrac = 0.02;
  const raw = isBuy ? livePrice * (1 + slippageFrac) : livePrice * (1 - slippageFrac);
  return formatPrice(raw, szDecimals, "perp");
}

async function executeTrade({
  symbol,
  isLong,
  positionSize,
  leverage,
  price,
  mode = "live"
}) {
  if (!Number.isFinite(price) || price <= 0) throw new Error("Live price is required");
  const { exchange } = getOrCreateClients(mode);
  const { asset, szDecimals } = await resolveAsset(symbol, mode);

  const size = roundDown(Number(positionSize), szDecimals);
  if (!Number.isFinite(size) || size <= 0) throw new Error("Position size must be positive");
  const notional = size * price;
  if (!Number.isFinite(notional) || notional < MIN_ORDER_NOTIONAL) {
    throw new Error(
      `Order notional ($${notional.toFixed(2)}) is below minimum $${MIN_ORDER_NOTIONAL.toFixed(2)}`
    );
  }
  const integerLeverage = Math.max(1, Math.floor(Math.max(1, Number(leverage || 1))));
  const px = slippagePrice(price, Boolean(isLong), szDecimals);

  console.log("[hyperliquid] executeTrade", {
    symbol, asset, szDecimals, isLong,
    livePrice: price, px,
    size: formatSize(size, szDecimals),
    leverage: integerLeverage,
    mode
  });

  await exchange.updateLeverage({
    asset,
    isCross: true,
    leverage: integerLeverage
  });

  const orderResponse = await exchange.order({
    orders: [
      {
        a: asset,
        b: Boolean(isLong),
        p: px,
        s: formatSize(size, szDecimals),
        r: false,
        t: { limit: { tif: "FrontendMarket" } }
      }
    ],
    grouping: "na"
  });

  const status = parseFirstOrderStatus(orderResponse);
  return {
    symbol: String(symbol || "").toUpperCase(),
    asset,
    side: isLong ? "long" : "short",
    size,
    leverage: integerLeverage,
    avgPx: status.avgPx,
    oid: status.oid,
    status: status.kind,
    raw: orderResponse
  };
}

async function placeStopLoss({
  symbol,
  isLong,
  size,
  triggerPrice,
  mode = "live"
}) {
  const { exchange } = getOrCreateClients(mode);
  const { asset, szDecimals } = await resolveAsset(symbol, mode);

  const safeSize = roundDown(Number(size || 0), szDecimals);
  if (!Number.isFinite(safeSize) || safeSize <= 0) throw new Error("Stop-loss size must be positive");
  const triggerPx = Number(triggerPrice || 0);
  if (!Number.isFinite(triggerPx) || triggerPx <= 0) throw new Error("Stop-loss trigger price must be positive");
  const stopNotional = safeSize * triggerPx;
  if (!Number.isFinite(stopNotional) || stopNotional < MIN_ORDER_NOTIONAL) {
    throw new Error(
      `Stop-loss notional ($${stopNotional.toFixed(2)}) is below minimum $${MIN_ORDER_NOTIONAL.toFixed(2)}`
    );
  }

  const isBuyToClose = !Boolean(isLong);
  const slippageFrac = 0.03;
  const limitPx = isBuyToClose
    ? triggerPx * (1 + slippageFrac)
    : triggerPx * (1 - slippageFrac);

  const orderResponse = await exchange.order({
    orders: [
      {
        a: asset,
        b: isBuyToClose,
        p: formatPrice(limitPx, szDecimals, "perp"),
        s: formatSize(safeSize, szDecimals),
        r: true,
        t: {
          trigger: {
            isMarket: true,
            triggerPx: formatPrice(triggerPx, szDecimals, "perp"),
            tpsl: "sl"
          }
        }
      }
    ],
    grouping: "positionTpsl"
  });

  const status = parseFirstOrderStatus(orderResponse);
  return {
    symbol: String(symbol || "").toUpperCase(),
    asset,
    oid: status.oid,
    status: status.kind,
    raw: orderResponse
  };
}

async function placeTakeProfit({
  symbol,
  isLong,
  size,
  triggerPrice,
  mode = "live"
}) {
  const { exchange } = getOrCreateClients(mode);
  const { asset, szDecimals } = await resolveAsset(symbol, mode);

  const safeSize = roundDown(Number(size || 0), szDecimals);
  if (!Number.isFinite(safeSize) || safeSize <= 0) throw new Error("Take-profit size must be positive");
  const triggerPx = Number(triggerPrice || 0);
  if (!Number.isFinite(triggerPx) || triggerPx <= 0) throw new Error("Take-profit trigger price must be positive");
  const tpNotional = safeSize * triggerPx;
  if (!Number.isFinite(tpNotional) || tpNotional < MIN_ORDER_NOTIONAL) {
    throw new Error(
      `Take-profit notional ($${tpNotional.toFixed(2)}) is below minimum $${MIN_ORDER_NOTIONAL.toFixed(2)}`
    );
  }

  const isBuyToClose = !Boolean(isLong);
  const slippageFrac = 0.03;
  const limitPx = isBuyToClose
    ? triggerPx * (1 + slippageFrac)
    : triggerPx * (1 - slippageFrac);

  const orderResponse = await exchange.order({
    orders: [
      {
        a: asset,
        b: isBuyToClose,
        p: formatPrice(limitPx, szDecimals, "perp"),
        s: formatSize(safeSize, szDecimals),
        r: true,
        t: {
          trigger: {
            isMarket: true,
            triggerPx: formatPrice(triggerPx, szDecimals, "perp"),
            tpsl: "tp"
          }
        }
      }
    ],
    grouping: "positionTpsl"
  });

  const status = parseFirstOrderStatus(orderResponse);
  return {
    symbol: String(symbol || "").toUpperCase(),
    asset,
    oid: status.oid,
    status: status.kind,
    raw: orderResponse
  };
}

async function placeBracketOrders({
  symbol,
  isLong,
  size,
  stopLossTriggerPrice,
  takeProfitTriggerPrice,
  mode = "live"
}) {
  const { exchange } = getOrCreateClients(mode);
  const { asset, szDecimals } = await resolveAsset(symbol, mode);

  const safeSize = roundDown(Number(size || 0), szDecimals);
  if (!Number.isFinite(safeSize) || safeSize <= 0) throw new Error("Bracket size must be positive");

  const stopTriggerPx = Number(stopLossTriggerPrice || 0);
  if (!Number.isFinite(stopTriggerPx) || stopTriggerPx <= 0) throw new Error("Stop-loss trigger price must be positive");
  const stopNotional = safeSize * stopTriggerPx;
  if (!Number.isFinite(stopNotional) || stopNotional < MIN_ORDER_NOTIONAL) {
    throw new Error(
      `Stop-loss notional ($${stopNotional.toFixed(2)}) is below minimum $${MIN_ORDER_NOTIONAL.toFixed(2)}`
    );
  }

  const tpTriggerPx = Number(takeProfitTriggerPrice || 0);
  if (!Number.isFinite(tpTriggerPx) || tpTriggerPx <= 0) throw new Error("Take-profit trigger price must be positive");
  const tpNotional = safeSize * tpTriggerPx;
  if (!Number.isFinite(tpNotional) || tpNotional < MIN_ORDER_NOTIONAL) {
    throw new Error(
      `Take-profit notional ($${tpNotional.toFixed(2)}) is below minimum $${MIN_ORDER_NOTIONAL.toFixed(2)}`
    );
  }

  const isBuyToClose = !Boolean(isLong);
  const slippageFrac = 0.03;
  const stopLimitPx = isBuyToClose
    ? stopTriggerPx * (1 + slippageFrac)
    : stopTriggerPx * (1 - slippageFrac);
  const tpLimitPx = isBuyToClose
    ? tpTriggerPx * (1 + slippageFrac)
    : tpTriggerPx * (1 - slippageFrac);

  const orderResponse = await exchange.order({
    orders: [
      {
        a: asset,
        b: isBuyToClose,
        p: formatPrice(stopLimitPx, szDecimals, "perp"),
        s: formatSize(safeSize, szDecimals),
        r: true,
        t: {
          trigger: {
            isMarket: true,
            triggerPx: formatPrice(stopTriggerPx, szDecimals, "perp"),
            tpsl: "sl"
          }
        }
      },
      {
        a: asset,
        b: isBuyToClose,
        p: formatPrice(tpLimitPx, szDecimals, "perp"),
        s: formatSize(safeSize, szDecimals),
        r: true,
        t: {
          trigger: {
            isMarket: true,
            triggerPx: formatPrice(tpTriggerPx, szDecimals, "perp"),
            tpsl: "tp"
          }
        }
      }
    ],
    grouping: "positionTpsl"
  });

  const stopStatus = parseOrderStatusAt(orderResponse, 0);
  const takeProfitStatus = parseOrderStatusAt(orderResponse, 1);

  return {
    symbol: String(symbol || "").toUpperCase(),
    asset,
    stopLoss: {
      oid: stopStatus.oid,
      status: stopStatus.kind
    },
    takeProfit: {
      oid: takeProfitStatus.oid,
      status: takeProfitStatus.kind
    },
    raw: orderResponse
  };
}

async function closePosition({
  symbol,
  isLong,
  size,
  price,
  mode = "live"
}) {
  if (!Number.isFinite(price) || price <= 0) throw new Error("Live price is required");
  const { exchange } = getOrCreateClients(mode);
  const { asset, szDecimals } = await resolveAsset(symbol, mode);

  const closeSize = roundDown(Number(size || 0), szDecimals);
  if (!Number.isFinite(closeSize) || closeSize <= 0) throw new Error("Close size must be positive");

  const isBuyToClose = !Boolean(isLong);

  const orderResponse = await exchange.order({
    orders: [
      {
        a: asset,
        b: isBuyToClose,
        p: slippagePrice(price, isBuyToClose, szDecimals),
        s: formatSize(closeSize, szDecimals),
        r: true,
        t: { limit: { tif: "FrontendMarket" } }
      }
    ],
    grouping: "na"
  });

  const status = parseFirstOrderStatus(orderResponse);
  return {
    symbol: String(symbol || "").toUpperCase(),
    asset,
    size: closeSize,
    avgPx: status.avgPx,
    oid: status.oid,
    status: status.kind,
    raw: orderResponse
  };
}

async function updateStopLoss({
  symbol,
  isLong,
  size,
  newTriggerPrice,
  oldOid = null,
  oldAsset = null,
  mode = "live"
}) {
  const upper = String(symbol || "").trim().toUpperCase();
  if (!upper) throw new Error("Symbol is required");
  if (!Number.isFinite(Number(newTriggerPrice)) || Number(newTriggerPrice) <= 0) {
    throw new Error("New trigger price must be positive");
  }

  // Place new stop loss FIRST so we're never unprotected
  const stopResult = await placeStopLoss({
    symbol: upper,
    isLong,
    size,
    triggerPrice: newTriggerPrice,
    mode
  });

  // Cancel old stop loss only after the new one is confirmed
  let cancelResult = null;
  if (Number.isFinite(oldOid) && oldOid > 0 && Number.isFinite(oldAsset) && oldAsset >= 0) {
    try {
      cancelResult = await cancelOrderById({ asset: oldAsset, oid: oldOid, mode });
    } catch {
      // Preserve the newly placed stop if we need a broader cleanup fallback.
      cancelResult = await cancelAllOrders({
        symbol: upper,
        mode,
        excludeOids: [Number(stopResult.oid)]
      });
    }
  } else {
    // We cannot reliably identify the previous stop order, so avoid blanket
    // cancellation that could remove the newly placed protective stop.
    cancelResult = {
      canceledCount: 0,
      result: null,
      skipped: true,
      reason: "no-previous-stop-reference"
    };
  }

  return {
    symbol: upper,
    oldCanceled: cancelResult,
    oid: stopResult.oid,
    asset: stopResult.asset,
    status: stopResult.status,
    triggerPrice: Number(newTriggerPrice),
    raw: stopResult.raw
  };
}

async function executeAzizExit({
  symbol,
  price,
  oldStopOid = null,
  oldStopAsset = null,
  mode = "live"
}) {
  const upper = String(symbol || "").trim().toUpperCase();
  if (!upper) throw new Error("Symbol is required");
  if (!Number.isFinite(price) || price <= 0) throw new Error("Live price is required");

  clearAccountCache(mode);
  const payload = await fetchClearinghouseState(mode);
  const positions = normalizePositions(payload);
  const pos = positions.find(p => p.coin === upper);
  if (!pos) throw new Error(`No open position for ${upper}`);

  const posSize = Math.abs(pos.szi);
  if (!Number.isFinite(posSize) || posSize <= 0) throw new Error("Position size is invalid");
  const isLong = pos.szi > 0;
  const entryPx = Number(pos.entryPx);
  if (!Number.isFinite(entryPx) || entryPx <= 0) throw new Error("Entry price is invalid");

  const halfSize = posSize / 2;

  const closeResult = await closePosition({
    symbol: upper,
    isLong,
    size: halfSize,
    price,
    mode
  });

  clearAccountCache(mode);
  const updatedPayload = await fetchClearinghouseState(mode);
  const updatedPositions = normalizePositions(updatedPayload);
  const remaining = updatedPositions.find(p => p.coin === upper);

  let stopResult = null;
  if (remaining && Math.abs(remaining.szi) > 0) {
    const remainingSize = Math.abs(remaining.szi);
    const remainingIsLong = remaining.szi > 0;

    stopResult = await updateStopLoss({
      symbol: upper,
      isLong: remainingIsLong,
      size: remainingSize,
      newTriggerPrice: entryPx,
      oldOid: oldStopOid,
      oldAsset: oldStopAsset,
      mode
    });
  }

  return {
    symbol: upper,
    side: isLong ? "long" : "short",
    closedSize: closeResult.size,
    closedAvgPx: closeResult.avgPx,
    remainingSize: remaining ? Math.abs(remaining.szi) : 0,
    breakEvenPrice: entryPx,
    stopLoss: stopResult ? {
      oid: stopResult.oid,
      asset: stopResult.asset,
      status: stopResult.status,
      triggerPrice: stopResult.triggerPrice
    } : null
  };
}

async function getOpenOrders({ mode = "live" } = {}) {
  return fetchOpenOrders(mode);
}

async function cancelOrderById({ asset, oid, mode = "live" }) {
  const { exchange } = getOrCreateClients(mode);
  if (!Number.isFinite(asset) || asset < 0 || !Number.isFinite(oid) || oid <= 0) {
    return { canceled: false };
  }
  const result = await exchange.cancel({
    cancels: [{ a: Number(asset), o: Number(oid) }]
  });
  return { canceled: true, result };
}

async function cancelAllOrders({ symbol, mode = "live", excludeOids = [] }) {
  const { exchange } = getOrCreateClients(mode);
  const { asset, symbol: upper } = await resolveAsset(symbol, mode);
  const blocked = new Set(
    (Array.isArray(excludeOids) ? excludeOids : [])
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0)
  );
  const openOrders = await getOpenOrders({ mode });
  const cancels = openOrders
    .filter((order) => String(order?.coin || "").toUpperCase() === upper)
    .filter((order) => !blocked.has(Number(order?.oid || 0)))
    .map((order) => ({ a: asset, o: Number(order?.oid || 0) }))
    .filter((entry) => Number.isFinite(entry.o) && entry.o > 0);

  if (cancels.length === 0) {
    return { canceledCount: 0, result: null };
  }

  const result = await exchange.cancel({ cancels });
  return { canceledCount: cancels.length, result };
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
  // Config
  getConfig,
  isAccountConfiguredForMode,

  // Fetchers (read-only info API)
  fetchClearinghouseState,
  fetchSpotClearinghouseState,
  fetchUserFills,
  fetchUserFees,
  fetchMeta,
  fetchOpenOrders,
  fetchAllMids,
  fetchMidPrice,
  fetchAccountBalance,

  // Normalizers
  normalizeAccountOverview,
  normalizePositions,
  normalizeFills,
  normalizeFeeRates,
  normalizeMetaForSymbol,

  // Risk / leverage calculators
  computeLeveragePreview,
  computeStopLossProjections,

  // Settings
  loadSettings,
  getSettings,
  patchSettings,

  // Exchange operations (signed, require private key)
  getOrCreateClients,
  resolveAsset,
  resolveAssetIndex,
  executeTrade,
  placeStopLoss,
  placeTakeProfit,
  placeBracketOrders,
  updateStopLoss,
  executeAzizExit,
  closePosition,
  getOpenOrders,
  cancelOrderById,
  cancelAllOrders,

  // Legacy helpers
  computePositionSize,
  emitHudUpdate,
  clearAccountCache
};
