const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { Wallet } = require("ethers");
const { ExchangeClient, HttpTransport, InfoClient } = require("@nktkas/hyperliquid");
const { formatPrice, formatSize } = require("@nktkas/hyperliquid/utils");
const { getConfig } = require("./account");

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

const clientCache = new Map();

function getModeSecrets(mode = "live") {
  const envVars = mode === "test" ? testEnvVars : liveEnvVars;
  const privateKey = String(
    envVars.Private_Key || process.env[`HYPERLIQUID_PRIVATE_KEY_${mode.toUpperCase()}`] || ""
  ).trim();
  const { account } = getConfig(mode);
  return { privateKey, account };
}

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
  return { kind: "unknown", raw: first, oid: null, avgPx: null, totalSz: null };
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
  const integerLeverage = Math.max(1, Math.floor(Math.max(1, Number(leverage || 1))));
  const px = slippagePrice(price, Boolean(isLong), szDecimals);

  console.log("[exchange] executeTrade", {
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

async function getOpenOrders({ mode = "live" } = {}) {
  const { info, account } = getOrCreateClients(mode);
  const orders = await info.openOrders({ user: account });
  return Array.isArray(orders) ? orders : [];
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

async function cancelAllOrders({ symbol, mode = "live" }) {
  const { exchange } = getOrCreateClients(mode);
  const { asset, symbol: upper } = await resolveAsset(symbol, mode);
  const openOrders = await getOpenOrders({ mode });
  const cancels = openOrders
    .filter((order) => String(order?.coin || "").toUpperCase() === upper)
    .map((order) => ({ a: asset, o: Number(order?.oid || 0) }))
    .filter((entry) => Number.isFinite(entry.o) && entry.o > 0);

  if (cancels.length === 0) {
    return { canceledCount: 0, result: null };
  }

  const result = await exchange.cancel({ cancels });
  return { canceledCount: cancels.length, result };
}

module.exports = {
  getOrCreateClients,
  resolveAsset,
  resolveAssetIndex,
  executeTrade,
  placeStopLoss,
  closePosition,
  getOpenOrders,
  cancelOrderById,
  cancelAllOrders
};
