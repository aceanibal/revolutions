const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// ---------------------------------------------------------------------------
// Load env files: .env for live, .env_test for testnet
// dotenv.parse() reads the file without polluting process.env so the two
// wallet files stay isolated from each other.
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

const BALANCE_REFRESH_MS = 20_000;

console.log("[account] Live wallet:", HYPERLIQUID_ACCOUNT_LIVE ? `${HYPERLIQUID_ACCOUNT_LIVE.slice(0, 8)}...` : "(not configured)");
console.log("[account] Test wallet:", HYPERLIQUID_ACCOUNT_TEST ? `${HYPERLIQUID_ACCOUNT_TEST.slice(0, 8)}...` : "(not configured)");

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
// TTL cache — avoids hammering Hyperliquid endpoints
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
// Leverage calculator
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
    warning = `Fees+slippage consume ${feePctOfRisk.toFixed(1)}% of total risk — consider wider stop`;
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
    console.log("[account] Failed to persist settings:", err?.message || err);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Legacy exports (backward compatible with server.js)
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

async function fetchAccountBalance({ mode = "live", onBalance, onError } = {}) {
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

    if (Number.isFinite(totalBalance) && totalBalance >= 0) {
      if (typeof onBalance === "function") {
        onBalance(totalBalance);
      }
    }
  } catch (error) {
    if (typeof onError === "function") {
      onError(error);
    }
  }
}

function getBalanceRefreshMs() {
  return BALANCE_REFRESH_MS;
}

function hasAccountConfigured() {
  return isAccountConfiguredForMode("live");
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
  computePositionSize,
  emitHudUpdate,
  fetchAccountBalance,
  getBalanceRefreshMs,
  hasAccountConfigured,

  getConfig,
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
};
