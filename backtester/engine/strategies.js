const { DateTime } = require("luxon");
const {
  createOrbAvwap930OpenOrAvwapStopStrategy
} = require("./orbAvwap930OpenOrAvwapStopStrategy");
const {
  createOrbAvwap930OpenOrAvwapStopStrategy1m
} = require("./orbAvwap930OpenOrAvwapStopStrategy1m");
const {
  createOrbAvwapPullbackStrategy1m
} = require("./orbAvwapPullbackStrategy1m");

function readScannerFeature(event, state, featureSet = "rvol-scanner") {
  const setName = String(featureSet || "rvol-scanner").trim();
  const fromEvent =
    event?.kind === "candle" && event?.candle?.features && typeof event.candle.features === "object"
      ? event.candle.features[setName]
      : null;
  if (fromEvent && typeof fromEvent === "object") return fromEvent;
  const fromState = state?.scannerFeatures && typeof state.scannerFeatures === "object"
    ? state.scannerFeatures[setName]
    : null;
  if (fromState && typeof fromState === "object") return fromState;
  return null;
}

function createNoopStrategy() {
  return {
    id: "noop",
    onEvent() {
      return null;
    }
  };
}

function getEasternParts(ms) {
  const dt = DateTime.fromMillis(Number(ms || 0), { zone: "America/New_York" });
  const hh = dt.hour;
  const mm = dt.minute;
  const hhmm = hh * 100 + mm;
  const dayKey = dt.toISODate() || "0000-00-00";
  const minuteOfDay = hh * 60 + mm;
  const etLabel = dt.toFormat("yyyy-LL-dd HH:mm");
  return { hhmm, dayKey, minuteOfDay, etLabel };
}

function buildCandleShape(open, high, low, close) {
  const body = Math.abs(close - open);
  const range = Math.max(0, high - low);
  const upperWick = Math.max(0, high - Math.max(open, close));
  const lowerWick = Math.max(0, Math.min(open, close) - low);
  return { body, range, upperWick, lowerWick };
}

function createOrbAvwap930Strategy(options = {}) {
  const anchorHHMM = Number(options.anchorHHMM || 930);
  const confirmAfterHHMM = Number(options.confirmAfterHHMM || 1000);
  const sessionEndHHMM = Number(options.sessionEndHHMM || 1600);
  const activeStartHHMM = Number(options.activeStartHHMM || anchorHHMM);
  const activeEndHHMM = Number(options.activeEndHHMM || sessionEndHHMM);
  const rr = Number(options.rr || 2);
  const dojiBodyToRangeMax = Number(options.dojiBodyToRangeMax ?? 0.3);
  const debug =
    Boolean(options.debug) || String(process.env.BACKTESTER_STRATEGY_DEBUG || "").toLowerCase() === "true";
  const debugSignal =
    Boolean(options.debugSignal) ||
    String(process.env.BACKTESTER_STRATEGY_DEBUG_SIGNALS || "").toLowerCase() === "true";
  const sessionWindowStartMs = Number(options.sessionWindowStartMs || 0);
  const sessionWindowEndMs = Number(options.sessionWindowEndMs || 0);
  const enforceSessionWindow = sessionWindowStartMs > 0 && sessionWindowEndMs > 0;
  let cumulativePV = 0;
  let cumulativeV = 0;
  let currentDay = "";
  let position = null;

  return {
    id: "orb-avwap-930",
    onEvent({ event, state }) {
      if (event.kind !== "candle") return null;
      const stateSymbol = String(state?.symbol || "").toUpperCase();
      const scanner = readScannerFeature(event, state, options.scannerFeatureSet || "rvol-scanner");
      const c = event.candle || {};
      // Prefer candle bucket open (timeMs). In mixed mode `event.ts` is end-of-bar for sort order only;
      // Study/chart use bucket_start_ms — must match for ET labels and session windows.
      const t = Number(c.timeMs || event.ts || 0);
      const open = Number(c.open);
      const high = Number(c.high);
      const low = Number(c.low);
      const close = Number(c.close);
      const volumeRaw = Number(c.volume ?? 0);
      if (![t, open, high, low, close].every(Number.isFinite)) return null;
      if (t <= 0) return null;

      const { hhmm, dayKey, etLabel } = getEasternParts(t);
      const shouldLogSignal = debugSignal;
      if (enforceSessionWindow && (t < sessionWindowStartMs || t > sessionWindowEndMs)) {
        if (debug) {
          console.log(
            `[orb-avwap-930] skip out-of-session at=${etLabel} ET ts=${t} window=[${sessionWindowStartMs}..${sessionWindowEndMs}]`
          );
        }
        return null;
      }
      const isActiveWindow = hhmm >= activeStartHHMM && hhmm < activeEndHHMM;
      const runnerPosition = state?.position || null;
      if (dayKey !== currentDay) {
        if (currentDay && runnerPosition) {
          const overnightExitPx = Number.isFinite(open) ? open : close;
          if (debug) {
            console.log(
              `[orb-avwap-930] day_boundary_exit prevDay=${currentDay} newDay=${dayKey} at=${etLabel} ET side=${String(runnerPosition.side || "").toLowerCase() || "long"} px=${Number(overnightExitPx).toFixed(6)}`
            );
          }
          currentDay = dayKey;
          cumulativePV = 0;
          cumulativeV = 0;
          position = null;
          return {
            type: "exit",
            side: String(runnerPosition.side || "").toLowerCase() || "long",
            price: overnightExitPx,
            size: Number(runnerPosition.size || 1)
          };
        }
        currentDay = dayKey;
        cumulativePV = 0;
        cumulativeV = 0;
        position = null;
        if (debug) {
          console.log(`[orb-avwap-930] day_reset day=${dayKey} at=${etLabel} ET`);
        }
      }
      if (hhmm < anchorHHMM) {
        if (debug) {
          console.log(`[orb-avwap-930] skip pre-anchor at=${etLabel} ET`);
        }
        return null;
      }
      if (hhmm >= sessionEndHHMM) {
        if (runnerPosition) {
          const sessionEndExitPx = Number.isFinite(open) ? open : close;
          if (debug) {
            console.log(
              `[orb-avwap-930] session_end_exit day=${dayKey} at=${etLabel} ET side=${String(runnerPosition.side || "").toLowerCase() || "long"} px=${Number(sessionEndExitPx).toFixed(6)}`
            );
          }
          position = null;
          return {
            type: "exit",
            side: String(runnerPosition.side || "").toLowerCase() || "long",
            price: sessionEndExitPx,
            size: Number(runnerPosition.size || 1)
          };
        }
        if (debug) {
          console.log(`[orb-avwap-930] skip post-session at=${etLabel} ET`);
        }
        return null;
      }

      // Keep Anchored VWAP math aligned with frontend chart indicator logic.
      // Frontend treats non-finite volume as 0 and does not coerce zero-volume bars to 1.
      const volume = Number.isFinite(volumeRaw) ? volumeRaw : 0;
      const typical = (high + low + close) / 3;
      cumulativePV += typical * volume;
      cumulativeV += volume;
      if (!Number.isFinite(cumulativePV) || !Number.isFinite(cumulativeV)) {
        return null;
      }
      const anchoredVwap = cumulativeV > 0 ? cumulativePV / cumulativeV : typical;
      if (debug && hhmm % 100 === 0) {
        console.log(
          `[orb-avwap-930] avwap day=${dayKey} at=${etLabel} ET avwap=${anchoredVwap.toFixed(6)} o=${open.toFixed(6)} c=${close.toFixed(6)}`
        );
        if (scanner && scanner.rvol != null) {
          console.log(
            `[orb-avwap-930] scanner symbol=${stateSymbol} rvol=${Number(scanner.rvol).toFixed(3)} btcCorr=${
              scanner.btcCorr == null ? "n/a" : Number(scanner.btcCorr).toFixed(3)
            }`
          );
        }
      }

      if (position) {
        if (position.side === "long") {
          const stopHit = low <= position.stopLoss;
          const targetHit = high >= position.takeProfit;
          if (stopHit || targetHit) {
            const exitPrice = stopHit ? position.stopLoss : position.takeProfit;
            position = null;
            return { type: "exit", side: "long", price: exitPrice, size: 1 };
          }
        } else if (position.side === "short") {
          const stopHit = high >= position.stopLoss;
          const targetHit = low <= position.takeProfit;
          if (stopHit || targetHit) {
            const exitPrice = stopHit ? position.stopLoss : position.takeProfit;
            position = null;
            return { type: "exit", side: "short", price: exitPrice, size: 1 };
          }
        }
        if (shouldLogSignal && hhmm >= confirmAfterHHMM) {
          console.log(
            `[orb-avwap-930] hold position symbol=${stateSymbol} day=${dayKey} at=${etLabel} ET side=${position.side} sl=${Number(position.stopLoss).toFixed(6)} tp=${Number(position.takeProfit).toFixed(6)}`
          );
        }
        return null;
      }

      if (hhmm < confirmAfterHHMM) {
        if (debug) {
          console.log(`[orb-avwap-930] skip pre-confirm at=${etLabel} ET`);
        }
        return null;
      }
      if (!isActiveWindow) {
        if (debug) {
          console.log(
            `[orb-avwap-930] skip entries outside active window at=${etLabel} ET active=[${activeStartHHMM}..${activeEndHHMM})`
          );
        }
        return null;
      }

      const longSignal = open < anchoredVwap && close > anchoredVwap;
      const shortSignal = open > anchoredVwap && close < anchoredVwap;
      if (shouldLogSignal) {
        console.log(
          `[orb-avwap-930] check symbol=${stateSymbol} day=${dayKey} at=${etLabel} ET o=${open.toFixed(6)} c=${close.toFixed(6)} avwap=${anchoredVwap.toFixed(6)} long=${longSignal} short=${shortSignal}`
        );
      }

      const shape = buildCandleShape(open, high, low, close);
      const safeRange = Math.max(shape.range, Number.EPSILON);
      const bodyToRange = shape.body / safeRange;
      const isDoji = bodyToRange <= dojiBodyToRangeMax;

      if (longSignal) {
        if (isDoji) {
          if (debug) {
            console.log(
              `[orb-avwap-930] LONG filtered doji at=${etLabel} ET bodyToRange=${bodyToRange.toFixed(4)} max=${dojiBodyToRangeMax}`
            );
          }
          return null;
        }
        const stopLoss = low;
        const risk = close - stopLoss;
        if (!Number.isFinite(risk) || risk <= 0) return null;
        const takeProfit = close + rr * risk;
        position = { side: "long", stopLoss, takeProfit };
        if (debug) {
          console.log(
            `[orb-avwap-930] LONG signal at=${etLabel} ET close=${close.toFixed(6)} avwap=${anchoredVwap.toFixed(6)} sl=${stopLoss.toFixed(6)} tp=${takeProfit.toFixed(6)}`
          );
        }
        return {
          type: "enter",
          side: "long",
          price: close,
          size: 1,
          stopLoss,
          takeProfit,
          meta: { anchoredVwap }
        };
      }

      if (shortSignal) {
        if (isDoji) {
          if (debug) {
            console.log(
              `[orb-avwap-930] SHORT filtered doji at=${etLabel} ET bodyToRange=${bodyToRange.toFixed(4)} max=${dojiBodyToRangeMax}`
            );
          }
          return null;
        }
        const stopLoss = high;
        const risk = stopLoss - close;
        if (!Number.isFinite(risk) || risk <= 0) return null;
        const takeProfit = close - rr * risk;
        position = { side: "short", stopLoss, takeProfit };
        if (debug) {
          console.log(
            `[orb-avwap-930] SHORT signal at=${etLabel} ET close=${close.toFixed(6)} avwap=${anchoredVwap.toFixed(6)} sl=${stopLoss.toFixed(6)} tp=${takeProfit.toFixed(6)}`
          );
        }
        return {
          type: "enter",
          side: "short",
          price: close,
          size: 1,
          stopLoss,
          takeProfit,
          meta: { anchoredVwap }
        };
      }

      return null;
    }
  };
}

/**
 * Very small reference strategy for validating the pipeline.
 * Buys on green bar, exits on red bar.
 */
function createSimpleMomentumStrategy(options = {}) {
  const minBodyBps = Number(options.minBodyBps ?? 2);
  let position = null;
  return {
    id: "simple-momentum",
    onEvent({ event }) {
      if (event.kind !== "candle") return null;
      const open = Number(event.candle.open);
      const close = Number(event.candle.close);
      if (!Number.isFinite(open) || !Number.isFinite(close) || open <= 0) return null;
      const bodyBps = ((close - open) / open) * 10_000;
      if (!position && bodyBps >= minBodyBps) {
        position = { side: "long", entryPx: close };
        return { type: "enter", side: "long", price: close, size: 1 };
      }
      if (position && bodyBps <= -minBodyBps) {
        position = null;
        return { type: "exit", side: "long", price: close, size: 1 };
      }
      return null;
    }
  };
}

function resolveStrategy(strategyId = "noop", params = {}) {
  if (strategyId === "orb-avwap-930") return createOrbAvwap930Strategy(params);
  if (strategyId === "orb-avwap-930-open-avwap-sl") return createOrbAvwap930OpenOrAvwapStopStrategy(params);
  if (strategyId === "orb-avwap-930-open-avwap-sl-1m") return createOrbAvwap930OpenOrAvwapStopStrategy1m(params);
  if (strategyId === "orb-avwap-pullback-1m") return createOrbAvwapPullbackStrategy1m(params);
  if (strategyId === "simple-momentum") return createSimpleMomentumStrategy(params);
  return createNoopStrategy();
}

const STRATEGY_DEFINITIONS = [
  {
    id: "noop",
    label: "No-op",
    description: "Does not place any orders.",
    params: []
  },
  {
    id: "simple-momentum",
    label: "Simple Momentum",
    description: "Enters on strong green candle body and exits on strong red body.",
    params: [
      {
        key: "minBodyBps",
        label: "Min body (bps)",
        type: "number",
        defaultValue: 2,
        min: 0,
        step: 0.5
      }
    ]
  },
  {
    id: "orb-avwap-930",
    label: "ORB AVWAP 9:30",
    description: "Cross above/below anchored VWAP with doji filter and fixed RR exits.",
    params: [
      { key: "rr", label: "Take Profit (R)", type: "number", defaultValue: 2, min: 0.1, step: 0.1 },
      { key: "anchorHHMM", label: "VWAP start (HHMM)", type: "number", defaultValue: 930, min: 0, max: 2359, step: 1 },
      { key: "confirmAfterHHMM", label: "Confirm after (HHMM)", type: "number", defaultValue: 1000, min: 0, max: 2359, step: 1 },
      { key: "activeStartHHMM", label: "Active start (HHMM)", type: "number", defaultValue: 930, min: 0, max: 2359, step: 1 },
      { key: "activeEndHHMM", label: "Active end (HHMM)", type: "number", defaultValue: 1600, min: 0, max: 2359, step: 1 },
      { key: "sessionEndHHMM", label: "Session end (HHMM)", type: "number", defaultValue: 1600, min: 0, max: 2359, step: 1 },
      {
        key: "dojiBodyToRangeMax",
        label: "Doji body/range max",
        type: "number",
        defaultValue: 0.3,
        min: 0,
        max: 1,
        step: 0.01
      },
      { key: "ignoreWeekends", label: "Ignore weekends", type: "boolean", defaultValue: false },
      { key: "ignoreUsHolidays", label: "Ignore US holidays + early closes", type: "boolean", defaultValue: false }
    ]
  },
  {
    id: "orb-avwap-930-open-avwap-sl",
    label: "ORB AVWAP 9:30 (Open/AVWAP SL)",
    description: "ORB AVWAP entry logic with configurable stop-loss source.",
    params: [
      { key: "rr", label: "Take Profit (R)", type: "number", defaultValue: 2, min: 0.1, step: 0.1 },
      { key: "anchorHHMM", label: "VWAP start (HHMM)", type: "number", defaultValue: 930, min: 0, max: 2359, step: 1 },
      { key: "confirmAfterHHMM", label: "Confirm after (HHMM)", type: "number", defaultValue: 1000, min: 0, max: 2359, step: 1 },
      { key: "activeStartHHMM", label: "Active start (HHMM)", type: "number", defaultValue: 930, min: 0, max: 2359, step: 1 },
      { key: "activeEndHHMM", label: "Active end (HHMM)", type: "number", defaultValue: 1600, min: 0, max: 2359, step: 1 },
      { key: "sessionEndHHMM", label: "Session end (HHMM)", type: "number", defaultValue: 1600, min: 0, max: 2359, step: 1 },
      {
        key: "stopLossSource",
        label: "Stop-loss source",
        type: "select",
        defaultValue: "open",
        options: [
          { value: "open", label: "open" },
          { value: "avwap", label: "avwap" },
          { value: "extreme", label: "candle low/high" },
          { value: "low", label: "low (long only)" },
          { value: "high", label: "high (short only)" }
        ]
      },
      { key: "ignoreWeekends", label: "Ignore weekends", type: "boolean", defaultValue: false },
      { key: "ignoreUsHolidays", label: "Ignore US holidays + early closes", type: "boolean", defaultValue: false }
    ]
  },
  {
    id: "orb-avwap-930-open-avwap-sl-1m",
    label: "ORB AVWAP 9:30 (1m AVWAP)",
    description: "Computes AVWAP from 1m bars and trades cross logic with configurable stop source.",
    params: [
      { key: "rr", label: "Take Profit (R)", type: "number", defaultValue: 2, min: 0.1, step: 0.1 },
      { key: "anchorHHMM", label: "VWAP start (HHMM)", type: "number", defaultValue: 930, min: 0, max: 2359, step: 1 },
      { key: "confirmAfterHHMM", label: "Confirm after (HHMM)", type: "number", defaultValue: 1000, min: 0, max: 2359, step: 1 },
      { key: "activeStartHHMM", label: "Active start (HHMM)", type: "number", defaultValue: 930, min: 0, max: 2359, step: 1 },
      { key: "activeEndHHMM", label: "Active end (HHMM)", type: "number", defaultValue: 1600, min: 0, max: 2359, step: 1 },
      { key: "sessionEndHHMM", label: "Session end (HHMM)", type: "number", defaultValue: 1600, min: 0, max: 2359, step: 1 },
      {
        key: "stopLossSource",
        label: "Stop-loss source",
        type: "select",
        defaultValue: "open",
        options: [
          { value: "open", label: "open" },
          { value: "avwap", label: "avwap" },
          { value: "extreme", label: "candle low/high" },
          { value: "low", label: "low (long only)" },
          { value: "high", label: "high (short only)" }
        ]
      },
      { key: "ignoreWeekends", label: "Ignore weekends", type: "boolean", defaultValue: false },
      { key: "ignoreUsHolidays", label: "Ignore US holidays + early closes", type: "boolean", defaultValue: false }
    ]
  },
  {
    id: "orb-avwap-pullback-1m",
    label: "ORB AVWAP Pullback (1m Close Entry)",
    description:
      "Arms on 5m signal and enters at the next 1m close if RVOL on that candle meets min; exits on 1m stop/target.",
    params: [
      { key: "rr", label: "Take Profit (R)", type: "number", defaultValue: 2, min: 0.1, step: 0.1 },
      { key: "anchorHHMM", label: "VWAP start (HHMM)", type: "number", defaultValue: 930, min: 0, max: 2359, step: 1 },
      { key: "confirmAfterHHMM", label: "Confirm after (HHMM)", type: "number", defaultValue: 1000, min: 0, max: 2359, step: 1 },
      { key: "activeStartHHMM", label: "Active start (HHMM)", type: "number", defaultValue: 930, min: 0, max: 2359, step: 1 },
      { key: "activeEndHHMM", label: "Active end (HHMM)", type: "number", defaultValue: 1600, min: 0, max: 2359, step: 1 },
      { key: "sessionEndHHMM", label: "Session end (HHMM)", type: "number", defaultValue: 1600, min: 0, max: 2359, step: 1 },
      {
        key: "stopLossSource",
        label: "Stop-loss source",
        type: "select",
        defaultValue: "open",
        options: [
          { value: "open", label: "open" },
          { value: "avwap", label: "avwap" },
          { value: "extreme", label: "candle low/high" },
          { value: "low", label: "low (long only)" },
          { value: "high", label: "high (short only)" }
        ]
      },
      {
        key: "minStopPct",
        label: "Min stop distance (% of entry)",
        type: "number",
        defaultValue: 0.4,
        min: 0,
        step: 0.01
      },
      {
        key: "minRvol",
        label: "Min RVOL (entry candle)",
        type: "number",
        defaultValue: 1.2,
        min: 0,
        step: 0.05
      },
      { key: "ignoreWeekends", label: "Ignore weekends", type: "boolean", defaultValue: false },
      { key: "ignoreUsHolidays", label: "Ignore US holidays + early closes", type: "boolean", defaultValue: false }
    ]
  }
];

function listStrategies() {
  return STRATEGY_DEFINITIONS;
}

module.exports = {
  createNoopStrategy,
  createSimpleMomentumStrategy,
  createOrbAvwap930Strategy,
  createOrbAvwap930OpenOrAvwapStopStrategy,
  createOrbAvwap930OpenOrAvwapStopStrategy1m,
  createOrbAvwapPullbackStrategy1m,
  resolveStrategy,
  listStrategies
};
