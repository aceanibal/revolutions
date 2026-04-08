const { intervalForTimeframe } = require("../data/math");
const { createRunResult } = require("../results/schema");
const { resolveStrategy } = require("./strategies");
const { synthesizeTicksFromCandles } = require("./tickSynthesizer");
const { getEtDayKey, isWeekendEt, isUsHolidayOrEarlyCloseEt } = require("./marketCalendar");

function cloneJsonSafe(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

/**
 * Wall-clock time aligned with Study/chart candles: `bucket_start_ms` on candle events.
 * `event.ts` may be end-of-bar (mixed mode) for ordering only.
 */
function chartAlignedTimeMs(event) {
  if (event.kind === "candle" && event.candle != null) {
    const bucket = Number(event.candle.timeMs || 0);
    if (Number.isFinite(bucket) && bucket > 0) return bucket;
  }
  return Number(event.ts || 0);
}

/** ORB AVWAP strategies pass `meta.anchoredVwap` on enter; expose on closed trades for exports. */
function avwapAtEntryFromEnterMeta(meta) {
  if (meta == null || typeof meta !== "object") return null;
  const v = Number(meta.anchoredVwap);
  return Number.isFinite(v) ? v : null;
}

function filterEventsByMarketDay(events = [], params = {}) {
  const ignoreWeekends = Boolean(params.ignoreWeekends);
  const ignoreUsHolidays = Boolean(params.ignoreUsHolidays);
  if (!ignoreWeekends && !ignoreUsHolidays) return events;
  return events.filter((event) => {
    const dayKey = getEtDayKey(chartAlignedTimeMs(event));
    if (ignoreWeekends && isWeekendEt(dayKey)) return false;
    if (ignoreUsHolidays && isUsHolidayOrEarlyCloseEt(dayKey)) return false;
    return true;
  });
}

function buildEvents({ mode, candles, ticks, timeframe, params = {}, symbol = "" }) {
  const tf = timeframe === "5m" ? "5m" : "1m";
  const tickPolicyRaw = String(params.tickPolicy || "real_then_synthetic").toLowerCase();
  const tickPolicy =
    tickPolicyRaw === "real_only" || tickPolicyRaw === "synthetic_only" ? tickPolicyRaw : "real_then_synthetic";
  const realTicks = (ticks || []).map((tick) => ({
    kind: "tick",
    origin: "real_tick",
    ts: Number(tick.ts || 0),
    tick
  }));
  const syntheticTicks = synthesizeTicksFromCandles(candles || [], tf, {
    symbol,
    ticksPerCandle: Number(params.syntheticTicksPerCandle || 4)
  }).map((tick) => ({
    kind: "tick",
    origin: "synthetic_tick",
    ts: Number(tick.ts || 0),
    tick
  }));

  if (mode === "tick") {
    if (realTicks.length === 0 && syntheticTicks.length === 0) {
      console.warn(`[backtester] No tick events for symbol=${symbol} timeframe=${tf}`);
      return [];
    }
    if (tickPolicy === "synthetic_only") return syntheticTicks;
    if (tickPolicy === "real_only") return realTicks;
    return realTicks.length > 0 ? realTicks : syntheticTicks;
  }

  if (mode === "mixed") {
    const intervalMs = intervalForTimeframe(tf);
    const tickEvents =
      tickPolicy === "synthetic_only"
        ? syntheticTicks
        : tickPolicy === "real_only"
          ? realTicks
          : realTicks.length > 0
            ? realTicks
            : syntheticTicks;
    const candleEvents = (candles || []).map((candle) => ({
      kind: "candle",
      origin: "candle_close",
      // End-of-bar ms so mixed streams sort after intra-bar ticks. Strategy + trades use `candle.timeMs`.
      ts: Number(candle.timeMs || 0) + intervalMs - 1,
      candle
    }));
    if (tickEvents.length === 0 && candleEvents.length === 0) {
      console.warn(`[backtester] No mixed events for symbol=${symbol} timeframe=${tf}`);
      return [];
    }
    return [...tickEvents, ...candleEvents].sort((a, b) => a.ts - b.ts);
  }
  const candleOnly = (candles || []).map((candle) => ({
    kind: "candle",
    origin: "candle_close",
    ts: Number(candle.timeMs || 0),
    candle
  }));
  if (candleOnly.length === 0) {
    console.warn(`[backtester] No candle events for symbol=${symbol} timeframe=${tf}`);
  }
  return candleOnly;
}

function runBacktest({
  sessionId,
  symbol,
  timeframe = "1m",
  mode = "mixed",
  candles = [],
  ticks = [],
  strategyId = "noop",
  params = {}
}) {
  const debugLogsEnabled =
    String(process.env.BACKTESTER_SIM_DEBUG || "").toLowerCase() === "true" || Boolean(params.debug);
  const runLabel = `[sim] session=${sessionId} symbol=${symbol} mode=${mode} tf=${timeframe} strategy=${strategyId}`;
  const builtEvents = buildEvents({ mode, candles, ticks, timeframe, params, symbol });
  const events = filterEventsByMarketDay(builtEvents, params);
  if (debugLogsEnabled && events.length !== builtEvents.length) {
    console.log(
      `${runLabel} filtered_events before=${builtEvents.length} after=${events.length} ignoreWeekends=${Boolean(
        params.ignoreWeekends
      )} ignoreUsHolidays=${Boolean(params.ignoreUsHolidays)}`
    );
  }
  if (events.length === 0) {
    console.warn(`[backtester] runBacktest produced zero events session=${sessionId} symbol=${symbol} mode=${mode}`);
  }
  const strategy = resolveStrategy(strategyId, params);
  const eventStats = {
    realTickEvents: 0,
    syntheticTickEvents: 0,
    candleEvents: 0
  };

  const equity = [];
  const trades = [];
  let position = null;
  let realizedPnL = 0;
  let lastPrice = candles[candles.length - 1]?.close || ticks[ticks.length - 1]?.price || 0;
  let minSeenPrice = Number.POSITIVE_INFINITY;
  let maxSeenPrice = Number.NEGATIVE_INFINITY;
  let enterCount = 0;
  let exitCount = 0;
  let ignoredActionCount = 0;
  let lastScannerFeatures = null;

  if (debugLogsEnabled) {
    console.log(
      `${runLabel} start candles=${candles.length} ticks=${ticks.length} params=${JSON.stringify(params || {})}`
    );
  }

  const calcPnl = (side, entryPx, exitPx, size) => {
    if (String(side || "").toLowerCase() === "short") {
      return (entryPx - exitPx) * size;
    }
    return (exitPx - entryPx) * size;
  };

  const pushEquity = (ts, markPrice) => {
    let unrealized = 0;
    if (position && Number.isFinite(markPrice)) {
      unrealized = calcPnl(position.side, position.entryPx, markPrice, position.size);
    }
    equity.push({ ts: Number(ts || 0), value: realizedPnL + unrealized });
  };

  for (const event of events) {
    if (event.origin === "real_tick") eventStats.realTickEvents += 1;
    else if (event.origin === "synthetic_tick") eventStats.syntheticTickEvents += 1;
    else if (event.kind === "candle") eventStats.candleEvents += 1;
    const price =
      event.kind === "tick" ? Number(event.tick.price || 0) : Number(event.candle.close || 0);
    if (Number.isFinite(price) && price > 0) {
      lastPrice = price;
      minSeenPrice = Math.min(minSeenPrice, price);
      maxSeenPrice = Math.max(maxSeenPrice, price);
    }

    const wallMs = chartAlignedTimeMs(event);
    if (event.kind === "candle" && event.candle?.features && typeof event.candle.features === "object") {
      lastScannerFeatures = event.candle.features;
    }

    const action = strategy.onEvent({
      event,
      state: {
        position,
        realizedPnL,
        lastPrice,
        equity,
        symbol,
        timeframe,
        mode,
        scannerFeatures: lastScannerFeatures
      }
    });

    const signalBucketStartMsFromMeta =
      action?.meta != null && typeof action.meta === "object"
        ? Number(action.meta.signalBucketStartMs)
        : NaN;
    const tradeTimeMsForAction = Number.isFinite(signalBucketStartMsFromMeta)
      ? signalBucketStartMsFromMeta
      : wallMs;

    if (action?.type === "enter" && !position) {
      enterCount += 1;
      position = {
        side: action.side || "long",
        entryPx: Number(action.price || price || 0),
        size: Number(action.size || 1),
        openedAtMs: tradeTimeMsForAction,
        stopLoss: Number(action.stopLoss ?? NaN),
        takeProfit: Number(action.takeProfit ?? NaN),
        avwapAtEntry: avwapAtEntryFromEnterMeta(action.meta),
        scannerFeaturesAtEntry: cloneJsonSafe(lastScannerFeatures)
      };
      if (debugLogsEnabled) {
        console.log(
          `${runLabel} enter ts=${tradeTimeMsForAction} side=${position.side} entryPx=${position.entryPx} size=${position.size}`
        );
      }
    } else if (action?.type === "exit" && position) {
      exitCount += 1;
      const exitPx = Number(action.price || price || 0);
      const pnl = calcPnl(position.side, position.entryPx, exitPx, position.size);
      realizedPnL += pnl;
      trades.push({
        openedAtMs: position.openedAtMs,
        closedAtMs: tradeTimeMsForAction,
        side: position.side,
        size: position.size,
        entryPx: position.entryPx,
        exitPx,
        pnl,
        stopLoss: Number.isFinite(position.stopLoss) ? position.stopLoss : null,
        takeProfit: Number.isFinite(position.takeProfit) ? position.takeProfit : null,
        avwapAtEntry: position.avwapAtEntry ?? null,
        tradingDayEt: getEtDayKey(position.openedAtMs),
        scannerAtEntry: position.scannerFeaturesAtEntry ?? null,
        scannerAtExit: cloneJsonSafe(lastScannerFeatures)
      });
      position = null;
      if (debugLogsEnabled) {
        console.log(`${runLabel} exit ts=${tradeTimeMsForAction} exitPx=${exitPx} pnl=${pnl.toFixed(6)} realized=${realizedPnL.toFixed(6)}`);
      }
    } else if (action) {
      ignoredActionCount += 1;
      if (debugLogsEnabled) {
        console.log(`${runLabel} ignored action ts=${wallMs} reason=state_guard action=${JSON.stringify(action)}`);
      }
    }

    pushEquity(wallMs, price);
  }

  if (position) {
    const lastWallMs =
      events.length > 0 ? chartAlignedTimeMs(events[events.length - 1]) : Date.now();
    const exitPx = Number(lastPrice || position.entryPx);
    const pnl = calcPnl(position.side, position.entryPx, exitPx, position.size);
    realizedPnL += pnl;
    trades.push({
      openedAtMs: position.openedAtMs,
      closedAtMs: lastWallMs,
      side: position.side,
      size: position.size,
      entryPx: position.entryPx,
      exitPx,
      pnl,
      stopLoss: Number.isFinite(position.stopLoss) ? position.stopLoss : null,
      takeProfit: Number.isFinite(position.takeProfit) ? position.takeProfit : null,
      avwapAtEntry: position.avwapAtEntry ?? null,
      tradingDayEt: getEtDayKey(position.openedAtMs),
      scannerAtEntry: position.scannerFeaturesAtEntry ?? null,
      scannerAtExit: cloneJsonSafe(lastScannerFeatures)
    });
    position = null;
    if (debugLogsEnabled) {
      console.log(`${runLabel} forced_close ts=${lastWallMs} exitPx=${exitPx} pnl=${pnl.toFixed(6)}`);
    }
  }

  const result = createRunResult({
    meta: { sessionId, symbol, timeframe, mode, strategyId, params, eventStats },
    events,
    equity,
    trades
  });

  if (debugLogsEnabled) {
    const flatEquity = result.equity.every((p) => Number(p.value || 0) === 0);
    const minPriceLabel = Number.isFinite(minSeenPrice) ? minSeenPrice.toFixed(6) : "n/a";
    const maxPriceLabel = Number.isFinite(maxSeenPrice) ? maxSeenPrice.toFixed(6) : "n/a";
    console.log(
      `${runLabel} done events=${result.meta.eventCount} realTicks=${eventStats.realTickEvents} syntheticTicks=${eventStats.syntheticTickEvents} candles=${eventStats.candleEvents} enters=${enterCount} exits=${exitCount} ignoredActions=${ignoredActionCount} priceRange=[${minPriceLabel}..${maxPriceLabel}] trades=${result.metrics.tradeCount} pnl=${result.metrics.realizedPnL.toFixed(6)} flatEquity=${flatEquity}`
    );
    if (flatEquity && result.metrics.tradeCount === 0) {
      console.log(
        `${runLabel} info equity stayed zero because no trades were opened/closed (common with strategy=noop).`
      );
    }
  }

  return result;
}

module.exports = {
  runBacktest,
  buildEvents
};
