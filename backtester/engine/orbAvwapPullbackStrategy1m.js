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

function createOrbAvwapPullbackStrategy1m(options = {}) {
  const anchorHHMM = Number(options.anchorHHMM || 930);
  const confirmAfterHHMM = Number(options.confirmAfterHHMM || 1000);
  const sessionEndHHMM = Number(options.sessionEndHHMM || 1600);
  const activeStartHHMM = Number(options.activeStartHHMM || anchorHHMM);
  const activeEndHHMM = Number(options.activeEndHHMM || sessionEndHHMM);
  const rr = Number(options.rr || 2);
  const stopLossSource = normalizeStopLossSource(options.stopLossSource);
  /** Minimum stop distance as % of entry price (failsafe); matches Python min_stop_pct. Use 0 to disable. */
  const minStopPct = Number(options.minStopPct ?? 0.4);
  /** Require session scanner RVOL on the entry 1m candle (see candle.features / state.scannerFeatures). Use 0 to disable. */
  const minRvol = Number(options.minRvol ?? 1.2);
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
  let pendingSignal = null;

  return {
    id: "orb-avwap-pullback-1m",
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
      const actionMeta = (bucketStartMs) =>
        Number.isFinite(Number(bucketStartMs)) ? { signalBucketStartMs: Number(bucketStartMs) } : {};
      if (enforceSessionWindow && (t < sessionWindowStartMs || t > sessionWindowEndMs)) {
        if (debug) {
          console.log(
            `[orb-avwap-pullback-1m] skip out-of-session at=${etLabel} ET ts=${t} window=[${sessionWindowStartMs}..${sessionWindowEndMs}]`
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
              `[orb-avwap-pullback-1m] day_boundary_exit prevDay=${currentDay} newDay=${dayKey} at=${etLabel} ET side=${String(runnerPosition.side || "").toLowerCase() || "long"} px=${Number(overnightExitPx).toFixed(6)}`
            );
          }
          currentDay = dayKey;
          avwapState.resetDay();
          signalPartialFiveMinute = null;
          pendingSignal = null;
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
        pendingSignal = null;
        position = null;
        if (debug) {
          console.log(`[orb-avwap-pullback-1m] day_reset day=${dayKey} at=${etLabel} ET`);
        }
      }
      if (hhmm < anchorHHMM) return null;
      if (hhmm >= sessionEndHHMM) {
        pendingSignal = null;
        if (runnerPosition) {
          const sessionEndExitPx = Number.isFinite(open) ? open : close;
          if (debug) {
            console.log(
              `[orb-avwap-pullback-1m] session_end_exit day=${dayKey} at=${etLabel} ET side=${String(runnerPosition.side || "").toLowerCase() || "long"} px=${Number(sessionEndExitPx).toFixed(6)}`
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

      if (position) {
        if (position.side === "long") {
          const stopHit = low <= position.stopLoss;
          const targetHit = high >= position.takeProfit;
          if (stopHit || targetHit) {
            const exitPrice = stopHit ? position.stopLoss : position.takeProfit;
            position = null;
            return {
              type: "exit",
              side: "long",
              price: exitPrice,
              size: 1,
              meta: actionMeta(t)
            };
          }
        } else if (position.side === "short") {
          const stopHit = high >= position.stopLoss;
          const targetHit = low <= position.takeProfit;
          if (stopHit || targetHit) {
            const exitPrice = stopHit ? position.stopLoss : position.takeProfit;
            position = null;
            return {
              type: "exit",
              side: "short",
              price: exitPrice,
              size: 1,
              meta: actionMeta(t)
            };
          }
        }
      }

      if (!position && pendingSignal) {
        const readyToEnter = t >= Number(pendingSignal.entryTimeMs || 0);
        if (readyToEnter) {
          if (minRvol > 0) {
            const rv = scanner && scanner.rvol != null ? Number(scanner.rvol) : NaN;
            if (!Number.isFinite(rv) || rv < minRvol) {
              pendingSignal = null;
              if (debug) {
                console.log(
                  `[orb-avwap-pullback-1m] skip_entry_rvol at=${etLabel} ET rvol=${Number.isFinite(rv) ? rv.toFixed(3) : "n/a"} min=${minRvol}`
                );
              }
              return null;
            }
          }

          const entryPx = close;
          const originalStop = pendingSignal.stopLoss;
          const filled = pendingSignal;
          pendingSignal = null;

          if (filled.side === "long" && entryPx <= originalStop) {
            if (debug) {
              console.log(
                `[orb-avwap-pullback-1m] skip LONG entry invalid stop entry=${entryPx.toFixed(6)} sl=${originalStop.toFixed(6)} at=${etLabel} ET`
              );
            }
            return null;
          }
          if (filled.side === "short" && entryPx >= originalStop) {
            if (debug) {
              console.log(
                `[orb-avwap-pullback-1m] skip SHORT entry invalid stop entry=${entryPx.toFixed(6)} sl=${originalStop.toFixed(6)} at=${etLabel} ET`
              );
            }
            return null;
          }

          const rawRiskDist = Math.abs(entryPx - originalStop);
          const minRiskDist = minStopPct > 0 ? entryPx * (minStopPct / 100) : 0;
          const riskDist = Math.max(rawRiskDist, minRiskDist);
          if (!Number.isFinite(riskDist) || riskDist <= 0) {
            return null;
          }

          const stopLoss = filled.side === "long" ? entryPx - riskDist : entryPx + riskDist;
          const takeProfit = filled.side === "long" ? entryPx + rr * riskDist : entryPx - rr * riskDist;
          position = { side: filled.side, stopLoss, takeProfit };
          if (debug) {
            console.log(
              `[orb-avwap-pullback-1m] ${filled.side.toUpperCase()} entry at=${etLabel} ET close=${entryPx.toFixed(6)} rawRisk=${rawRiskDist.toFixed(6)} minRisk=${minRiskDist.toFixed(6)} risk=${riskDist.toFixed(6)} sl=${stopLoss.toFixed(6)} tp=${takeProfit.toFixed(6)}`
            );
          }
          // runBacktest uses meta.signalBucketStartMs as openedAtMs / closedAtMs when present.
          // Entry must align with this 1m bar (one bar after the arm event), not the 5m signal bucket start.
          return {
            type: "enter",
            side: filled.side,
            price: entryPx,
            size: 1,
            stopLoss,
            takeProfit,
            meta: {
              anchoredVwap: filled.anchoredVwap,
              stopLossSource: filled.stopLossSource,
              signalBucketStartMs: t,
              signalFiveMinuteBucketStartMs: filled.signalBucketStartMs
            }
          };
        }
      }

      if (!completedFiveMinute) return null;
      if (position || pendingSignal) return null;

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
          `[orb-avwap-pullback-1m] avwap day=${dayKey} at=${signalEtLabel} ET avwap=${anchoredVwap.toFixed(6)} o=${signalOpen.toFixed(6)} c=${signalClose.toFixed(6)}`
        );
        if (scanner && scanner.rvol != null) {
          console.log(
            `[orb-avwap-pullback-1m] scanner symbol=${stateSymbol} rvol=${Number(scanner.rvol).toFixed(3)} btcCorr=${
              scanner.btcCorr == null ? "n/a" : Number(scanner.btcCorr).toFixed(3)
            }`
          );
        }
      }

      const signalActiveWindow = signalHhmm >= activeStartHHMM && signalHhmm < activeEndHHMM;
      if (signalHhmm < confirmAfterHHMM) return null;
      if (!signalActiveWindow) return null;

      const longSignal = signalOpen < anchoredVwap && signalClose > anchoredVwap;
      const shortSignal = signalOpen > anchoredVwap && signalClose < anchoredVwap;
      if (shouldLogSignal) {
        console.log(
          `[orb-avwap-pullback-1m] check symbol=${stateSymbol} day=${dayKey} at=${signalEtLabel} ET o=${signalOpen.toFixed(6)} c=${signalClose.toFixed(6)} avwap=${anchoredVwap.toFixed(6)} long=${longSignal} short=${shortSignal}`
        );
      }

      if (longSignal || shortSignal) {
        const side = longSignal ? "long" : "short";
        const stopLoss = resolveStopLossCandidate(side, stopLossSource, signalOpen, signalHigh, signalLow, anchoredVwap);
        if (!Number.isFinite(stopLoss)) return null;
        pendingSignal = {
          side,
          stopLoss,
          anchoredVwap,
          signalBucketStartMs,
          stopLossSource,
          entryTimeMs: t + 60_000
        };
        if (debug) {
          console.log(
            `[orb-avwap-pullback-1m] ${side.toUpperCase()} pending at=${signalEtLabel} ET signalClose=${signalClose.toFixed(6)} sl=${stopLoss.toFixed(6)} entryNext1m=true`
          );
        }
      }

      return null;
    }
  };
}

module.exports = {
  createOrbAvwapPullbackStrategy1m
};
