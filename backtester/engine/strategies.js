const { DateTime } = require("luxon");

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

function createOrbAvwap930Strategy(options = {}) {
  const anchorHHMM = Number(options.anchorHHMM || 930);
  const confirmAfterHHMM = Number(options.confirmAfterHHMM || 1000);
  const sessionEndHHMM = Number(options.sessionEndHHMM || 1600);
  const activeStartHHMM = Number(options.activeStartHHMM || anchorHHMM);
  const activeEndHHMM = Number(options.activeEndHHMM || sessionEndHHMM);
  const rr = Number(options.rr || 2);
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
      if (dayKey !== currentDay) {
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

      if (longSignal) {
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
  if (strategyId === "simple-momentum") return createSimpleMomentumStrategy(params);
  return createNoopStrategy();
}

module.exports = {
  createNoopStrategy,
  createSimpleMomentumStrategy,
  createOrbAvwap930Strategy,
  resolveStrategy
};
