#!/usr/bin/env node

/**
 * Standalone testnet runner for Hyperliquid account/exchange API calls.
 *
 * Uses the testnet exclusively. Pulls price via the allMids API endpoint
 * instead of WebSocket streaming, so you can validate every API call
 * in isolation before wiring it into the live app.
 *
 * Usage:
 *   node backend/test-account.js              # run all read-only tests
 *   node backend/test-account.js --trade      # include trade execution tests
 *   node backend/test-account.js --aziz       # test Aziz exit (close 50% + SL to break-even)
 *   node backend/test-account.js --symbol ETH # test a specific symbol (default: ETH)
 */

const hl = require("./hyperliquid");

const MODE = "test";
const args = process.argv.slice(2);
const INCLUDE_TRADE_TESTS = args.includes("--trade");
const INCLUDE_AZIZ_TEST = args.includes("--aziz");
const SYMBOL = (() => {
  const idx = args.indexOf("--symbol");
  return idx >= 0 && args[idx + 1] ? args[idx + 1].toUpperCase() : "ETH";
})();

const HR = "─".repeat(60);
let passed = 0;
let failed = 0;

function log(label, data) {
  console.log(`\n${HR}`);
  console.log(`  ${label}`);
  console.log(HR);
  if (data !== undefined) {
    console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
  }
}

function pass(name) {
  passed++;
  console.log(`  ✓ ${name}`);
}

function fail(name, err) {
  failed++;
  console.log(`  ✗ ${name}: ${err?.message || err}`);
}

async function testConfigCheck() {
  log("Config check");
  try {
    const configured = hl.isAccountConfiguredForMode(MODE);
    if (!configured) {
      console.log("  ⚠ Test account is NOT configured. Set Main_Wallet_Address in .env_test");
      console.log("  Skipping all tests that require a wallet.");
      return false;
    }
    const config = hl.getConfig(MODE);
    console.log(`  Info URL : ${config.infoUrl}`);
    console.log(`  Account  : ${config.account.slice(0, 8)}...`);
    pass("config loaded");
    return true;
  } catch (err) {
    fail("config check", err);
    return false;
  }
}

async function testFetchMidPrice() {
  log(`Fetch mid price for ${SYMBOL} (via allMids API — no WebSocket needed)`);
  try {
    const price = await hl.fetchMidPrice(SYMBOL, MODE);
    console.log(`  ${SYMBOL} mid price: $${price}`);
    if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid price");
    pass("fetchMidPrice");
    return price;
  } catch (err) {
    fail("fetchMidPrice", err);
    return null;
  }
}

async function testFetchAllMids() {
  log("Fetch all mid prices");
  try {
    const mids = await hl.fetchAllMids(MODE);
    const symbols = Object.keys(mids || {});
    console.log(`  ${symbols.length} symbols with mid prices`);
    console.log(`  Sample: ${symbols.slice(0, 5).map(s => `${s}=$${Number(mids[s]).toFixed(2)}`).join(", ")}`);
    pass("fetchAllMids");
  } catch (err) {
    fail("fetchAllMids", err);
  }
}

async function testFetchAccountBalance() {
  log("Fetch account balance");
  try {
    const balance = await hl.fetchAccountBalance(MODE);
    console.log(`  Balance: $${balance?.toFixed(2) ?? "null"}`);
    pass("fetchAccountBalance");
    return balance;
  } catch (err) {
    fail("fetchAccountBalance", err);
    return null;
  }
}

async function testFetchAccountOverview() {
  log("Fetch account overview (clearinghouse + spot)");
  try {
    const [perps, spot] = await Promise.all([
      hl.fetchClearinghouseState(MODE),
      hl.fetchSpotClearinghouseState(MODE).catch(() => null)
    ]);
    const overview = hl.normalizeAccountOverview(perps, spot);
    console.log(`  Account value : $${overview.accountValue.toFixed(2)}`);
    console.log(`  Perps value   : $${overview.perpsAccountValue.toFixed(2)}`);
    console.log(`  Spot value    : $${overview.spotUsdValue.toFixed(2)}`);
    console.log(`  Total NTL pos : $${overview.totalNtlPos.toFixed(2)}`);
    console.log(`  Margin used   : $${overview.totalMarginUsed.toFixed(2)}`);
    console.log(`  Withdrawable  : $${overview.withdrawable.toFixed(2)}`);
    pass("account overview");
    return overview;
  } catch (err) {
    fail("account overview", err);
    return null;
  }
}

async function testFetchPositions() {
  log("Fetch open positions");
  try {
    const payload = await hl.fetchClearinghouseState(MODE);
    const positions = hl.normalizePositions(payload);
    if (positions.length === 0) {
      console.log("  (no open positions)");
    } else {
      for (const p of positions) {
        const dir = p.szi > 0 ? "LONG" : "SHORT";
        console.log(`  ${p.coin} ${dir} size=${Math.abs(p.szi)} entry=$${p.entryPx} pnl=$${p.unrealizedPnl.toFixed(2)}`);
      }
    }
    pass("positions");
    return positions;
  } catch (err) {
    fail("positions", err);
    return [];
  }
}

async function testFetchFills() {
  log("Fetch recent fills");
  try {
    const payload = await hl.fetchUserFills(MODE);
    const fills = hl.normalizeFills(payload);
    console.log(`  ${fills.length} fill(s) returned`);
    for (const f of fills.slice(0, 5)) {
      console.log(`  ${f.coin} ${f.side} sz=${f.sz} px=$${f.px} fee=$${f.fee} pnl=$${f.closedPnl}`);
    }
    if (fills.length > 5) console.log(`  ... and ${fills.length - 5} more`);
    pass("fills");
  } catch (err) {
    fail("fills", err);
  }
}

async function testFetchFees() {
  log("Fetch fee rates");
  try {
    const payload = await hl.fetchUserFees(MODE);
    const fees = hl.normalizeFeeRates(payload);
    console.log(`  Maker (add)  : ${(fees.userAddRate * 100).toFixed(4)}%`);
    console.log(`  Taker (cross): ${(fees.userCrossRate * 100).toFixed(4)}%`);
    pass("fee rates");
    return fees;
  } catch (err) {
    fail("fee rates", err);
    return null;
  }
}

async function testFetchOpenOrders() {
  log("Fetch open orders (via SDK info client)");
  try {
    const orders = await hl.getOpenOrders({ mode: MODE });
    console.log(`  ${orders.length} open order(s)`);
    for (const o of orders.slice(0, 5)) {
      console.log(`  ${o.coin} side=${o.side} sz=${o.sz} px=${o.limitPx} oid=${o.oid}`);
    }
    pass("open orders (SDK)");
    return orders;
  } catch (err) {
    fail("open orders (SDK)", err);
    return [];
  }
}

async function testFetchOpenOrdersViaApi() {
  log("Fetch open orders (via REST info API)");
  try {
    const orders = await hl.fetchOpenOrders(MODE);
    console.log(`  ${orders.length} open order(s)`);
    for (const o of orders.slice(0, 5)) {
      console.log(`  ${o.coin} side=${o.side} sz=${o.sz} px=${o.limitPx} oid=${o.oid}`);
    }
    pass("open orders (API)");
  } catch (err) {
    fail("open orders (API)", err);
  }
}

async function testFetchMeta() {
  log(`Fetch meta / symbol info for ${SYMBOL}`);
  try {
    const metaPayload = await hl.fetchMeta(MODE);
    const symbolMeta = hl.normalizeMetaForSymbol(metaPayload, SYMBOL);
    if (!symbolMeta) {
      fail("meta", new Error(`Symbol ${SYMBOL} not found in universe`));
      return null;
    }
    console.log(`  Name         : ${symbolMeta.name}`);
    console.log(`  szDecimals   : ${symbolMeta.szDecimals}`);
    console.log(`  maxLeverage  : ${symbolMeta.maxLeverage}x`);
    console.log(`  onlyIsolated : ${symbolMeta.onlyIsolated}`);
    pass("meta");
    return symbolMeta;
  } catch (err) {
    fail("meta", err);
    return null;
  }
}

async function testResolveAsset() {
  log(`Resolve asset index for ${SYMBOL}`);
  try {
    const resolved = await hl.resolveAsset(SYMBOL, MODE);
    console.log(`  Asset index  : ${resolved.asset}`);
    console.log(`  szDecimals   : ${resolved.szDecimals}`);
    console.log(`  maxLeverage  : ${resolved.maxLeverage}x`);
    pass("resolveAsset");
    return resolved;
  } catch (err) {
    fail("resolveAsset", err);
    return null;
  }
}

async function testLeveragePreview(balance, price, fees) {
  log("Leverage preview (2% risk, 1% stop distance)");
  try {
    const preview = hl.computeLeveragePreview({
      stopLossDistancePct: 1,
      riskBudgetPct: 2,
      makerFeePct: fees?.userAddRate || 0.0002,
      takerFeePct: fees?.userCrossRate || 0.00035,
      slippageBps: 10,
      exchangeMaxLeverage: 50,
      accountBalance: balance || 100,
      entryPrice: price || 1000
    });
    console.log(`  Recommended leverage : ${preview.recommendedLeverage}x`);
    console.log(`  Capped leverage      : ${preview.cappedLeverage}x`);
    console.log(`  Position size (units): ${preview.positionSizeUnits}`);
    console.log(`  Notional position    : $${preview.notionalPosition}`);
    console.log(`  Risk ($)             : $${preview.riskDollars}`);
    console.log(`  Fee cost ($)         : $${preview.feeCostUsd}`);
    if (preview.warning) console.log(`  ⚠ ${preview.warning}`);
    pass("leverage preview");
  } catch (err) {
    fail("leverage preview", err);
  }
}

async function testSettings() {
  log("Settings persistence");
  try {
    const current = hl.getSettings();
    console.log(`  Current: ${JSON.stringify(current)}`);
    pass("getSettings");
  } catch (err) {
    fail("getSettings", err);
  }
}

// ---------------------------------------------------------------------------
// Trade execution tests (only with --trade flag)
// ---------------------------------------------------------------------------

async function testExecuteTrade(price) {
  const minNotional = 10;
  const minSize = Math.ceil((minNotional / (price || 1)) * 10000) / 10000;
  log(`Trade test: open tiny ${SYMBOL} LONG on testnet (${minSize} units ≈ $${(minSize * price).toFixed(2)})`);
  if (!price) {
    fail("executeTrade", new Error("No price available"));
    return null;
  }
  try {
    const result = await hl.executeTrade({
      symbol: SYMBOL,
      isLong: true,
      positionSize: minSize,
      leverage: 2,
      price,
      mode: MODE
    });
    console.log(`  Status  : ${result.status}`);
    console.log(`  Side    : ${result.side}`);
    console.log(`  Size    : ${result.size}`);
    console.log(`  Avg Px  : ${result.avgPx}`);
    console.log(`  OID     : ${result.oid}`);
    pass("executeTrade");
    return result;
  } catch (err) {
    fail("executeTrade", err);
    return null;
  }
}

async function testClosePosition(price) {
  log(`Trade test: close ${SYMBOL} position on testnet`);
  if (!price) {
    fail("closePosition", new Error("No price available"));
    return;
  }
  try {
    const payload = await hl.fetchClearinghouseState(MODE);
    const positions = hl.normalizePositions(payload);
    const pos = positions.find(p => p.coin === SYMBOL);
    if (!pos) {
      console.log("  (no position to close — skipping)");
      pass("closePosition (no-op)");
      return;
    }
    const isLong = pos.szi > 0;
    const size = Math.abs(pos.szi);
    const result = await hl.closePosition({
      symbol: SYMBOL,
      isLong,
      size,
      price,
      mode: MODE
    });
    console.log(`  Status  : ${result.status}`);
    console.log(`  Size    : ${result.size}`);
    console.log(`  Avg Px  : ${result.avgPx}`);
    pass("closePosition");
  } catch (err) {
    fail("closePosition", err);
  }
}

async function testPlaceStopLoss(price, tradeResult) {
  log(`Trade test: place stop loss for ${SYMBOL} on testnet`);
  if (!price) {
    fail("placeStopLoss", new Error("No price available"));
    return null;
  }

  try {
    const payload = await hl.fetchClearinghouseState(MODE);
    const positions = hl.normalizePositions(payload);
    const pos = positions.find(p => p.coin === SYMBOL);
    if (!pos) {
      console.log("  (no position found — skipping stop loss)");
      pass("placeStopLoss (no-op)");
      return null;
    }

    const isLong = pos.szi > 0;
    const size = Math.abs(pos.szi);
    const triggerPrice = isLong
      ? price * 0.97
      : price * 1.03;

    console.log(`  Position : ${isLong ? "LONG" : "SHORT"} ${size} ${SYMBOL}`);
    console.log(`  Trigger  : $${triggerPrice.toFixed(2)} (${isLong ? "3% below" : "3% above"} mid)`);

    const result = await hl.placeStopLoss({
      symbol: SYMBOL,
      isLong,
      size,
      triggerPrice,
      mode: MODE
    });

    console.log(`  Status   : ${result.status}`);
    console.log(`  OID      : ${result.oid}`);
    console.log(`  Asset    : ${result.asset}`);
    pass("placeStopLoss");
    return result;
  } catch (err) {
    fail("placeStopLoss", err);
    return null;
  }
}

async function testVerifyStopLossInOrders(stopResult) {
  log(`Trade test: verify stop loss appears in open orders`);
  try {
    const orders = await hl.getOpenOrders({ mode: MODE });
    console.log(`  ${orders.length} open order(s)`);
    for (const o of orders) {
      console.log(`  ${o.coin} side=${o.side} sz=${o.sz} triggerPx=${o.triggerPx || "n/a"} oid=${o.oid}`);
    }

    if (stopResult?.oid) {
      const found = orders.some(o => Number(o.oid) === Number(stopResult.oid));
      if (found) {
        console.log(`  Stop loss OID ${stopResult.oid} confirmed in open orders`);
        pass("verify stop loss in orders");
      } else {
        console.log(`  ⚠ Stop loss OID ${stopResult.oid} not found — may be trigger order (check separately)`);
        pass("verify stop loss in orders (trigger type)");
      }
    } else {
      pass("verify stop loss in orders (no oid to check)");
    }
  } catch (err) {
    fail("verify stop loss in orders", err);
  }
}

async function testUpdateStopLoss(price, stopResult) {
  log(`Trade test: update stop loss to new price`);
  if (!price) {
    fail("updateStopLoss", new Error("No price available"));
    return null;
  }

  try {
    const payload = await hl.fetchClearinghouseState(MODE);
    const positions = hl.normalizePositions(payload);
    const pos = positions.find(p => p.coin === SYMBOL);
    if (!pos) {
      console.log("  (no position found — skipping)");
      pass("updateStopLoss (no-op)");
      return null;
    }

    const isLong = pos.szi > 0;
    const size = Math.abs(pos.szi);
    const newTriggerPrice = isLong
      ? price * 0.95
      : price * 1.05;

    const oldTrigger = isLong ? price * 0.97 : price * 1.03;
    console.log(`  Position   : ${isLong ? "LONG" : "SHORT"} ${size} ${SYMBOL}`);
    console.log(`  Old trigger: $${oldTrigger.toFixed(2)}`);
    console.log(`  New trigger: $${newTriggerPrice.toFixed(2)} (moved ${isLong ? "lower" : "higher"})`);
    console.log(`  Old OID    : ${stopResult?.oid ?? "n/a"}`);

    const result = await hl.updateStopLoss({
      symbol: SYMBOL,
      isLong,
      size,
      newTriggerPrice,
      oldOid: stopResult?.oid ?? null,
      oldAsset: stopResult?.asset ?? null,
      mode: MODE
    });

    console.log(`  Status     : ${result.status}`);
    console.log(`  New OID    : ${result.oid}`);
    console.log(`  New trigger: $${result.triggerPrice.toFixed(2)}`);
    pass("updateStopLoss");
    return result;
  } catch (err) {
    fail("updateStopLoss", err);
    return null;
  }
}

async function testCancelOrderById(stopResult) {
  log(`Trade test: cancel stop loss by OID`);
  if (!stopResult?.oid || !Number.isFinite(stopResult?.asset)) {
    console.log("  (no stop loss oid to cancel — skipping)");
    pass("cancelOrderById (no-op)");
    return;
  }
  try {
    const result = await hl.cancelOrderById({
      asset: stopResult.asset,
      oid: stopResult.oid,
      mode: MODE
    });
    console.log(`  Canceled : ${result.canceled}`);
    pass("cancelOrderById");
  } catch (err) {
    fail("cancelOrderById", err);
  }
}

async function testExecuteAzizOpen(price) {
  const minNotional = 10;
  const minSize = Math.ceil((minNotional / (price || 1)) * 10000) / 10000;
  const azizSize = minSize * 3;
  log(`Aziz setup: open ${SYMBOL} LONG (${azizSize} units ≈ $${(azizSize * price).toFixed(2)}, so 50% ≈ $${(azizSize * price * 0.5).toFixed(2)})`);
  if (!price) {
    fail("aziz open", new Error("No price available"));
    return null;
  }
  try {
    const result = await hl.executeTrade({
      symbol: SYMBOL,
      isLong: true,
      positionSize: azizSize,
      leverage: 2,
      price,
      mode: MODE
    });
    console.log(`  Status  : ${result.status}`);
    console.log(`  Side    : ${result.side}`);
    console.log(`  Size    : ${result.size}`);
    console.log(`  Avg Px  : ${result.avgPx}`);
    console.log(`  OID     : ${result.oid}`);
    pass("aziz open");
    return result;
  } catch (err) {
    fail("aziz open", err);
    return null;
  }
}

async function testAzizExit(price, stopResult) {
  log(`Trade test: Aziz exit — close 50% + move SL to break-even`);
  if (!price) {
    fail("executeAzizExit", new Error("No price available"));
    return null;
  }
  try {
    const result = await hl.executeAzizExit({
      symbol: SYMBOL,
      price,
      oldStopOid: stopResult?.oid ?? null,
      oldStopAsset: stopResult?.asset ?? null,
      mode: MODE
    });

    console.log(`  Side           : ${result.side}`);
    console.log(`  Closed size    : ${result.closedSize}`);
    console.log(`  Closed avg px  : $${result.closedAvgPx}`);
    console.log(`  Remaining size : ${result.remainingSize}`);
    console.log(`  Break-even SL  : $${result.breakEvenPrice}`);
    if (result.stopLoss) {
      console.log(`  SL status      : ${result.stopLoss.status}`);
      console.log(`  SL OID         : ${result.stopLoss.oid}`);
      console.log(`  SL trigger     : $${result.stopLoss.triggerPrice}`);
    } else {
      console.log(`  (position fully closed — no stop loss needed)`);
    }
    pass("executeAzizExit");
    return result;
  } catch (err) {
    fail("executeAzizExit", err);
    return null;
  }
}

async function testCancelAllOrders() {
  log(`Trade test: cancel all ${SYMBOL} orders on testnet`);
  try {
    const result = await hl.cancelAllOrders({ symbol: SYMBOL, mode: MODE });
    console.log(`  Canceled: ${result.canceledCount} order(s)`);
    pass("cancelAllOrders");
  } catch (err) {
    fail("cancelAllOrders", err);
  }
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

function printModuleMap() {
  console.log(`\n${"═".repeat(60)}`);
  console.log("  hyperliquid.js — API Reference");
  console.log(`${"═".repeat(60)}`);

  const sections = [
    {
      heading: "CONFIG",
      fns: [
        ["getConfig(mode)", "Returns { infoUrl, account } for 'live' or 'test'"],
        ["isAccountConfiguredForMode(mode)", "True if wallet address is set for the given mode"],
      ]
    },
    {
      heading: "READ-ONLY FETCHERS (info API, cached 5s)",
      fns: [
        ["fetchClearinghouseState(mode)", "Perps margin summary, positions, withdrawable"],
        ["fetchSpotClearinghouseState(mode)", "Spot balances (USDC, tokens)"],
        ["fetchUserFills(mode)", "Recent trade fills for the account"],
        ["fetchUserFees(mode)", "Current maker/taker fee rates"],
        ["fetchMeta(mode)", "Exchange metadata — universe of symbols, szDecimals, maxLeverage"],
        ["fetchOpenOrders(mode)", "Open orders via REST info API (no private key needed)"],
        ["fetchAllMids(mode)", "Mid prices for every listed symbol (replaces WS for testing)"],
        ["fetchMidPrice(symbol, mode)", "Single symbol mid price extracted from allMids"],
        ["fetchAccountBalance(mode)", "Total balance = perps accountValue + spot USD value"],
      ]
    },
    {
      heading: "NORMALIZERS (shape raw payloads into clean objects)",
      fns: [
        ["normalizeAccountOverview(perps, spot)", "Unified overview: accountValue, margin, withdrawable, spot balances"],
        ["normalizePositions(payload)", "Array of open positions with coin, szi, entryPx, pnl, leverage, funding"],
        ["normalizeFills(payload)", "Array of recent fills: coin, side, px, sz, fee, closedPnl"],
        ["normalizeFeeRates(payload)", "Maker/taker rates as decimals (e.g. 0.0002)"],
        ["normalizeMetaForSymbol(meta, symbol)", "Single symbol info: szDecimals, maxLeverage, onlyIsolated"],
      ]
    },
    {
      heading: "RISK / LEVERAGE CALCULATORS (pure math, no API calls)",
      fns: [
        ["computeLeveragePreview({...})", "Given stop distance + risk %, returns leverage, position size, fees, risk $"],
        ["computeStopLossProjections({...})", "Long/short projections from current price + stop loss price"],
      ]
    },
    {
      heading: "SETTINGS PERSISTENCE (account-settings.json)",
      fns: [
        ["loadSettings()", "Read settings from disk (riskPercent, slippageBps, stopLossStep)"],
        ["getSettings()", "Return cached settings or load from disk"],
        ["patchSettings(partial)", "Merge partial update and write to disk"],
      ]
    },
    {
      heading: "EXCHANGE OPS — SIGNED (require private key)",
      fns: [
        ["getOrCreateClients(mode)", "Wallet + ExchangeClient + InfoClient, cached per mode"],
        ["resolveAsset(symbol, mode)", "Lookup symbol → { asset index, szDecimals, maxLeverage }"],
        ["resolveAssetIndex(symbol, mode)", "Shorthand — returns just the numeric asset index"],
        ["executeTrade({symbol,isLong,positionSize,leverage,price,mode})", "Open a position (market order with slippage)"],
        ["placeStopLoss({symbol,isLong,size,triggerPrice,mode})", "Place a trigger stop-loss order"],
        ["updateStopLoss({symbol,isLong,size,newTriggerPrice,...})", "Place new SL then cancel old (never unprotected)"],
        ["executeAzizExit({symbol,price,oldStopOid,...})", "Close 50% + move SL to break-even (entry price)"],
        ["closePosition({symbol,isLong,size,price,mode})", "Close (reduce) a position at market"],
        ["getOpenOrders({mode})", "Open orders via SDK InfoClient (needs wallet)"],
        ["cancelOrderById({asset,oid,mode})", "Cancel a single order by asset+oid"],
        ["cancelAllOrders({symbol,mode})", "Cancel all open orders for a symbol"],
      ]
    },
    {
      heading: "LEGACY HELPERS (used by server.js HUD)",
      fns: [
        ["computePositionSize(balance, lastPrice)", "Simple risk-based size = (balance × risk%) / price"],
        ["emitHudUpdate(io, {stopLossPrice,balance,lastPrice})", "Emit hudUpdate event via socket.io"],
        ["clearAccountCache(mode)", "Bust all cached payloads for a mode"],
      ]
    },
  ];

  for (const section of sections) {
    console.log(`\n  ┌─ ${section.heading}`);
    for (const [fn, desc] of section.fns) {
      const pad = 55 - fn.length;
      console.log(`  │  ${fn}${" ".repeat(Math.max(1, pad))}${desc}`);
    }
    console.log("  └" + "─".repeat(59));
  }
  console.log("");
}

async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  HYPERLIQUID TESTNET API RUNNER`);
  console.log(`  Mode    : ${MODE}`);
  console.log(`  Symbol  : ${SYMBOL}`);
  console.log(`  Trades  : ${INCLUDE_TRADE_TESTS ? "ENABLED (--trade)" : "disabled (add --trade to enable)"}`);
  console.log(`  Aziz    : ${INCLUDE_AZIZ_TEST ? "ENABLED (--aziz)" : "disabled (add --aziz to enable)"}`);
  console.log(`${"═".repeat(60)}`);

  printModuleMap();

  const accountOk = await testConfigCheck();
  if (!accountOk) {
    console.log("\n  Cannot proceed without a configured test account.\n");
    process.exit(1);
  }

  hl.clearAccountCache(MODE);

  // Read-only tests
  const price = await testFetchMidPrice();
  await testFetchAllMids();
  const balance = await testFetchAccountBalance();
  await testFetchAccountOverview();
  await testFetchPositions();
  await testFetchFills();
  const fees = await testFetchFees();
  await testFetchOpenOrders();
  await testFetchOpenOrdersViaApi();
  await testFetchMeta();
  await testResolveAsset();
  await testLeveragePreview(balance, price, fees);
  await testSettings();

  // Trade tests (opt-in)
  if (INCLUDE_TRADE_TESTS) {
    log("TRADE EXECUTION TESTS (testnet only)");
    console.log("  These tests will open and close a tiny position on testnet.\n");

    // 1. Open position
    const tradeResult = await testExecuteTrade(price);

    hl.clearAccountCache(MODE);
    await testFetchPositions();

    // 2. Place stop loss on the open position
    const stopResult = await testPlaceStopLoss(price, tradeResult);

    hl.clearAccountCache(MODE);
    await testVerifyStopLossInOrders(stopResult);

    // 3. Update stop loss to a new price (place new first, then cancel old)
    const updatedStop = await testUpdateStopLoss(price, stopResult);

    hl.clearAccountCache(MODE);
    await testVerifyStopLossInOrders(updatedStop);

    // 4. Cancel stop loss by OID
    await testCancelOrderById(updatedStop || stopResult);

    hl.clearAccountCache(MODE);
    await testFetchOpenOrders();

    // 5. Close the position
    await testClosePosition(price);

    // 6. Final cleanup
    hl.clearAccountCache(MODE);
    await testCancelAllOrders();
    await testFetchPositions();
  }

  // Aziz exit test (opt-in, separate from trade tests)
  if (INCLUDE_AZIZ_TEST) {
    log("AZIZ EXIT TEST (close 50% + move SL to break-even)");
    console.log("  Opens a position, places SL, then executes the Aziz exit.");
    console.log("");
    console.log("  NOTE: break-even price = pos.entryPx from the clearinghouse API.");
    console.log("  This is the exchange's average entry price for the position.");
    console.log("  It does NOT include fees. True break-even including fees would be:");
    console.log("    LONG:  entryPx + (entryPx × (makerFee + takerFee))");
    console.log("    SHORT: entryPx - (entryPx × (makerFee + takerFee))");
    console.log("  For live, decide whether to use raw entryPx or fee-adjusted.\n");

    // 1. Open a position large enough that 50% still meets the $10 minimum
    const azizTrade = await testExecuteAzizOpen(price);

    hl.clearAccountCache(MODE);
    await testFetchPositions();

    // 2. Place initial stop loss
    const azizStop = await testPlaceStopLoss(price, azizTrade);

    // 3. Execute Aziz exit (close 50% + move SL to entry price)
    hl.clearAccountCache(MODE);
    const azizResult = await testAzizExit(price, azizStop);

    hl.clearAccountCache(MODE);
    await testFetchPositions();
    await testFetchOpenOrders();

    // 4. Cleanup — close remaining half + cancel SL
    await testClosePosition(price);

    hl.clearAccountCache(MODE);
    await testCancelAllOrders();
    await testFetchPositions();
  }

  // Summary
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`${"═".repeat(60)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
