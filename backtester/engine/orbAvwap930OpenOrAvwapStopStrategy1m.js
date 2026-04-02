const { DateTime } = require("luxon");
const {
  createFiveMinuteAnchoredVwapFromOneMinuteState,
  mergeOneMinuteIntoFiveMinutePartial,
  fiveMinuteBucketStartMs
} = require("./fiveMinuteAvwapFromOneMinute");

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

function createOrbAvwap930OpenOrAvwapStopStrategy1m(options = {}) {
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
  const avwapState = createFiveMinuteAnchoredVwapFromOneMinuteState({ anchorHHMM, sessionEndHHMM });
  let signalPartialFiveMinute = null;
  let currentDay = "";
  let position = null;

  return {
    id: "orb-avwap-930-open-avwap-sl-1m",
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
      const signalBucketMeta = (bucketStartMs) =>
        Number.isFinite(Number(bucketStartMs)) ? { signalBucketStartMs: Number(bucketStartMs) } : {};
      if (enforceSessionWindow && (t < sessionWindowStartMs || t > sessionWindowEndMs)) {
        if (debug) {
          console.log(
            `[orb-avwap-930-open-avwap-sl-1m] skip out-of-session at=${etLabel} ET ts=${t} window=[${sessionWindowStartMs}..${sessionWindowEndMs}]`
          );
        }
        return null;
      }
      const runnerPosition = state?.position || null;
      if (dayKey !== currentDay) {
        if (currentDay && runnerPosition) {
          const overnightExitPx = Number.isFinite(open) ? open : close;
          if (debug) {
            console.log(
              `[orb-avwap-930-open-avwap-sl-1m] day_boundary_exit prevDay=${currentDay} newDay=${dayKey} at=${etLabel} ET side=${String(runnerPosition.side || "").toLowerCase() || "long"} px=${Number(overnightExitPx).toFixed(6)}`
            );
          }
          currentDay = dayKey;
          avwapState.resetDay();
          signalPartialFiveMinute = null;
          position = null;
          return {
            type: "exit",
            side: String(runnerPosition.side || "").toLowerCase() || "long",
            price: overnightExitPx,
            size: Number(runnerPosition.size || 1)
          };
        }
        currentDay = dayKey;
        avwapState.resetDay();
        signalPartialFiveMinute = null;
        position = null;
        if (debug) {
          console.log(`[orb-avwap-930-open-avwap-sl-1m] day_reset day=${dayKey} at=${etLabel} ET`);
        }
      }
      if (hhmm < anchorHHMM) return null;
      if (hhmm >= sessionEndHHMM) return null;

      const volume = Number.isFinite(volumeRaw) ? volumeRaw : 0;
      const bucketStartMs = fiveMinuteBucketStartMs(t);
      let completedFiveMinute = null;
      if (!signalPartialFiveMinute) {
        signalPartialFiveMinute = mergeOneMinuteIntoFiveMinutePartial(null, { timeMs: t, open, high, low, close, volume });
      } else if (signalPartialFiveMinute.bucketStartMs !== bucketStartMs) {
        completedFiveMinute = signalPartialFiveMinute;
        signalPartialFiveMinute = mergeOneMinuteIntoFiveMinutePartial(null, { timeMs: t, open, high, low, close, volume });
      } else {
        signalPartialFiveMinute = mergeOneMinuteIntoFiveMinutePartial(signalPartialFiveMinute, {
          timeMs: t,
          open,
          high,
          low,
          close,
          volume
        });
      }

      avwapState.onOneMinuteCandle({ timeMs: t, open, high, low, close, volume });
      if (!completedFiveMinute) return null;

      const signalOpen = Number(completedFiveMinute.open);
      const signalHigh = Number(completedFiveMinute.high);
      const signalLow = Number(completedFiveMinute.low);
      const signalClose = Number(completedFiveMinute.close);
      const signalBucketStartMs = Number(completedFiveMinute.bucketStartMs);
      const { hhmm: signalHhmm, etLabel: signalEtLabel } = getEasternParts(signalBucketStartMs);
      const signalTypical = (signalHigh + signalLow + signalClose) / 3;
      const anchoredVwap = avwapState.anchoredVwapFromOneMinuteTypical(signalTypical);
      if (!Number.isFinite(anchoredVwap)) return null;
      if (debug && signalHhmm % 100 === 0) {
        console.log(
          `[orb-avwap-930-open-avwap-sl-1m] avwap day=${dayKey} at=${signalEtLabel} ET avwap=${anchoredVwap.toFixed(6)} o=${signalOpen.toFixed(6)} c=${signalClose.toFixed(6)}`
        );
        if (scanner && scanner.rvol != null) {
          console.log(
            `[orb-avwap-930-open-avwap-sl-1m] scanner symbol=${stateSymbol} rvol=${Number(scanner.rvol).toFixed(3)} btcCorr=${
              scanner.btcCorr == null ? "n/a" : Number(scanner.btcCorr).toFixed(3)
            }`
          );
        }
      }

      if (position) {
        if (position.side === "long") {
          const stopHit = signalLow <= position.stopLoss;
          const targetHit = signalHigh >= position.takeProfit;
          if (stopHit || targetHit) {
            const exitPrice = stopHit ? position.stopLoss : position.takeProfit;
            position = null;
            return {
              type: "exit",
              side: "long",
              price: exitPrice,
              size: 1,
              meta: signalBucketMeta(signalBucketStartMs)
            };
          }
        } else if (position.side === "short") {
          const stopHit = signalHigh >= position.stopLoss;
          const targetHit = signalLow <= position.takeProfit;
          if (stopHit || targetHit) {
            const exitPrice = stopHit ? position.stopLoss : position.takeProfit;
            position = null;
            return {
              type: "exit",
              side: "short",
              price: exitPrice,
              size: 1,
              meta: signalBucketMeta(signalBucketStartMs)
            };
          }
        }
        if (shouldLogSignal && signalHhmm >= confirmAfterHHMM) {
          console.log(
            `[orb-avwap-930-open-avwap-sl-1m] hold position symbol=${stateSymbol} day=${dayKey} at=${signalEtLabel} ET side=${position.side} sl=${Number(position.stopLoss).toFixed(6)} tp=${Number(position.takeProfit).toFixed(6)}`
          );
        }
        return null;
      }

      const signalActiveWindow = signalHhmm >= activeStartHHMM && signalHhmm < activeEndHHMM;
      if (signalHhmm < confirmAfterHHMM) return null;
      if (!signalActiveWindow) return null;

      const longSignal = signalOpen < anchoredVwap && signalClose > anchoredVwap;
      const shortSignal = signalOpen > anchoredVwap && signalClose < anchoredVwap;
      if (shouldLogSignal) {
        console.log(
          `[orb-avwap-930-open-avwap-sl-1m] check symbol=${stateSymbol} day=${dayKey} at=${signalEtLabel} ET o=${signalOpen.toFixed(6)} c=${signalClose.toFixed(6)} avwap=${anchoredVwap.toFixed(6)} long=${longSignal} short=${shortSignal}`
        );
      }

      if (longSignal) {
        const stopLoss = resolveStopLossCandidate(
          "long",
          stopLossSource,
          signalOpen,
          signalHigh,
          signalLow,
          anchoredVwap
        );
        if (!Number.isFinite(stopLoss)) return null;
        const risk = signalClose - stopLoss;
        if (!Number.isFinite(risk) || risk <= 0) return null;
        const takeProfit = signalClose + rr * risk;
        position = { side: "long", stopLoss, takeProfit };
        if (debug) {
          console.log(
            `[orb-avwap-930-open-avwap-sl-1m] LONG signal at=${signalEtLabel} ET close=${signalClose.toFixed(6)} avwap=${anchoredVwap.toFixed(6)} stopSource=${stopLossSource} sl=${stopLoss.toFixed(6)} tp=${takeProfit.toFixed(6)}`
          );
        }
        return {
          type: "enter",
          side: "long",
          price: signalClose,
          size: 1,
          stopLoss,
          takeProfit,
          meta: { anchoredVwap, stopLossSource, signalBucketStartMs }
        };
      }

      if (shortSignal) {
        const stopLoss = resolveStopLossCandidate(
          "short",
          stopLossSource,
          signalOpen,
          signalHigh,
          signalLow,
          anchoredVwap
        );
        if (!Number.isFinite(stopLoss)) return null;
        const risk = stopLoss - signalClose;
        if (!Number.isFinite(risk) || risk <= 0) return null;
        const takeProfit = signalClose - rr * risk;
        position = { side: "short", stopLoss, takeProfit };
        if (debug) {
          console.log(
            `[orb-avwap-930-open-avwap-sl-1m] SHORT signal at=${signalEtLabel} ET close=${signalClose.toFixed(6)} avwap=${anchoredVwap.toFixed(6)} stopSource=${stopLossSource} sl=${stopLoss.toFixed(6)} tp=${takeProfit.toFixed(6)}`
          );
        }
        return {
          type: "enter",
          side: "short",
          price: signalClose,
          size: 1,
          stopLoss,
          takeProfit,
          meta: { anchoredVwap, stopLossSource, signalBucketStartMs }
        };
      }

      return null;
    }
  };
}

module.exports = {
  createOrbAvwap930OpenOrAvwapStopStrategy1m
};
