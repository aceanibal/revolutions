const { DateTime } = require("luxon");

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

/** @param {string} raw */
function normalizeStopLossSource(raw) {
  const s = String(raw || "open").trim().toLowerCase();
  if (s === "avwap") return "avwap";
  if (s === "low") return "low";
  if (s === "high") return "high";
  if (s === "extreme" || s === "high-low" || s === "highlow" || s === "wick") return "extreme";
  return "open";
}

/**
 * Stop anchor for the signal candle. Longs use low (or open/avwap); shorts use high (or open/avwap).
 * @param {"long" | "short"} side
 * @param {"open" | "avwap" | "low" | "high" | "extreme"} src
 */
function resolveStopLossCandidate(side, src, open, high, low, anchoredVwap) {
  if (src === "avwap") return anchoredVwap;
  if (src === "open") return open;
  if (src === "extreme") return side === "long" ? low : high;
  if (src === "low") return side === "long" ? low : null;
  if (src === "high") return side === "short" ? high : null;
  return open;
}

function createOrbAvwap930OpenOrAvwapStopStrategy(options = {}) {
  const anchorHHMM = Number(options.anchorHHMM || 930);
  const confirmAfterHHMM = Number(options.confirmAfterHHMM || 1000);
  const sessionEndHHMM = Number(options.sessionEndHHMM || 1600);
  const activeStartHHMM = Number(options.activeStartHHMM || anchorHHMM);
  const activeEndHHMM = Number(options.activeEndHHMM || sessionEndHHMM);
  const rr = Number(options.rr || 2);
  const stopLossSource = normalizeStopLossSource(options.stopLossSource);
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
    id: "orb-avwap-930-open-avwap-sl",
    onEvent({ event, state }) {
      if (event.kind !== "candle") return null;
      const stateSymbol = String(state?.symbol || "").toUpperCase();
      const scanner = readScannerFeature(event, state, options.scannerFeatureSet || "rvol-scanner");
      const c = event.candle || {};
      // Keep ET labels/session checks aligned with candle bucket open.
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
            `[orb-avwap-930-open-avwap-sl] skip out-of-session at=${etLabel} ET ts=${t} window=[${sessionWindowStartMs}..${sessionWindowEndMs}]`
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
              `[orb-avwap-930-open-avwap-sl] day_boundary_exit prevDay=${currentDay} newDay=${dayKey} at=${etLabel} ET side=${String(runnerPosition.side || "").toLowerCase() || "long"} px=${Number(overnightExitPx).toFixed(6)}`
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
          console.log(`[orb-avwap-930-open-avwap-sl] day_reset day=${dayKey} at=${etLabel} ET`);
        }
      }
      if (hhmm < anchorHHMM) return null;
      if (hhmm >= sessionEndHHMM) {
        if (runnerPosition) {
          const sessionEndExitPx = Number.isFinite(open) ? open : close;
          if (debug) {
            console.log(
              `[orb-avwap-930-open-avwap-sl] session_end_exit day=${dayKey} at=${etLabel} ET side=${String(runnerPosition.side || "").toLowerCase() || "long"} px=${Number(sessionEndExitPx).toFixed(6)}`
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
        return null;
      }

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
          `[orb-avwap-930-open-avwap-sl] avwap day=${dayKey} at=${etLabel} ET avwap=${anchoredVwap.toFixed(6)} o=${open.toFixed(6)} c=${close.toFixed(6)}`
        );
        if (scanner && scanner.rvol != null) {
          console.log(
            `[orb-avwap-930-open-avwap-sl] scanner symbol=${stateSymbol} rvol=${Number(scanner.rvol).toFixed(3)} btcCorr=${
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
            `[orb-avwap-930-open-avwap-sl] hold position symbol=${stateSymbol} day=${dayKey} at=${etLabel} ET side=${position.side} sl=${Number(position.stopLoss).toFixed(6)} tp=${Number(position.takeProfit).toFixed(6)}`
          );
        }
        return null;
      }

      if (hhmm < confirmAfterHHMM) return null;
      if (!isActiveWindow) return null;

      const longSignal = open < anchoredVwap && close > anchoredVwap;
      const shortSignal = open > anchoredVwap && close < anchoredVwap;
      if (shouldLogSignal) {
        console.log(
          `[orb-avwap-930-open-avwap-sl] check symbol=${stateSymbol} day=${dayKey} at=${etLabel} ET o=${open.toFixed(6)} c=${close.toFixed(6)} avwap=${anchoredVwap.toFixed(6)} long=${longSignal} short=${shortSignal}`
        );
      }

      if (longSignal) {
        const stopLoss = resolveStopLossCandidate("long", stopLossSource, open, high, low, anchoredVwap);
        if (!Number.isFinite(stopLoss)) return null;
        const risk = close - stopLoss;
        if (!Number.isFinite(risk) || risk <= 0) return null;
        const takeProfit = close + rr * risk;
        position = { side: "long", stopLoss, takeProfit };
        if (debug) {
          console.log(
            `[orb-avwap-930-open-avwap-sl] LONG signal at=${etLabel} ET close=${close.toFixed(6)} avwap=${anchoredVwap.toFixed(6)} stopSource=${stopLossSource} sl=${stopLoss.toFixed(6)} tp=${takeProfit.toFixed(6)}`
          );
        }
        return {
          type: "enter",
          side: "long",
          price: close,
          size: 1,
          stopLoss,
          takeProfit,
          meta: { anchoredVwap, stopLossSource }
        };
      }

      if (shortSignal) {
        const stopLoss = resolveStopLossCandidate("short", stopLossSource, open, high, low, anchoredVwap);
        if (!Number.isFinite(stopLoss)) return null;
        const risk = stopLoss - close;
        if (!Number.isFinite(risk) || risk <= 0) return null;
        const takeProfit = close - rr * risk;
        position = { side: "short", stopLoss, takeProfit };
        if (debug) {
          console.log(
            `[orb-avwap-930-open-avwap-sl] SHORT signal at=${etLabel} ET close=${close.toFixed(6)} avwap=${anchoredVwap.toFixed(6)} stopSource=${stopLossSource} sl=${stopLoss.toFixed(6)} tp=${takeProfit.toFixed(6)}`
          );
        }
        return {
          type: "enter",
          side: "short",
          price: close,
          size: 1,
          stopLoss,
          takeProfit,
          meta: { anchoredVwap, stopLossSource }
        };
      }

      return null;
    }
  };
}

module.exports = {
  createOrbAvwap930OpenOrAvwapStopStrategy
};
