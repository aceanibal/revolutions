const { DateTime } = require("luxon");
const { FIVE_MINUTES_MS } = require("../data/math");

/**
 * Align with session candle storage: floor Unix ms to 5m bucket (same as backend/sessionMath.floorToInterval).
 */
function fiveMinuteBucketStartMs(timeMs) {
  const t = Number(timeMs || 0);
  if (!Number.isFinite(t)) return 0;
  return Math.floor(t / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
}

function typicalPrice(high, low, close) {
  return (Number(high) + Number(low) + Number(close)) / 3;
}

function getEasternParts(ms) {
  const dt = DateTime.fromMillis(Number(ms || 0), { zone: "America/New_York" });
  const hh = dt.hour;
  const mm = dt.minute;
  const hhmm = hh * 100 + mm;
  const dayKey = dt.toISODate() || "0000-00-00";
  const etLabel = dt.toFormat("yyyy-LL-dd HH:mm");
  return { hhmm, dayKey, etLabel };
}

/**
 * Merge a 1m candle into the in-progress 5m OHLCV for its bucket.
 * @param {object | null} partial
 * @param {{ timeMs: number, open: number, high: number, low: number, close: number, volume: number }} c
 */
function mergeOneMinuteIntoFiveMinutePartial(partial, c) {
  const vol = Number.isFinite(Number(c.volume)) ? Number(c.volume) : 0;
  const open = Number(c.open);
  const high = Number(c.high);
  const low = Number(c.low);
  const close = Number(c.close);
  const bucketStart = fiveMinuteBucketStartMs(c.timeMs);
  if (!partial) {
    return {
      bucketStartMs: bucketStart,
      open,
      high,
      low,
      close,
      volume: vol
    };
  }
  return {
    bucketStartMs: partial.bucketStartMs,
    open: partial.open,
    high: Math.max(partial.high, high),
    low: Math.min(partial.low, low),
    close,
    volume: partial.volume + vol
  };
}

/**
 * Stateful accumulator: anchored VWAP from 1m stream matches native 5m bar VWAP
 * (typical price × volume of each *completed* 5m bucket, same rule as orb strategies).
 *
 * @param {object} options
 * @param {number} options.anchorHHMM
 * @param {number} options.sessionEndHHMM
 */
function createFiveMinuteAnchoredVwapFromOneMinuteState(options = {}) {
  const anchorHHMM = Number(options.anchorHHMM || 930);
  const sessionEndHHMM = Number(options.sessionEndHHMM || 1600);
  let cumulativePV = 0;
  let cumulativeV = 0;
  let partialFiveMinute = null;

  function bucketContributesToAvwap(bucketStartMs) {
    const { hhmm } = getEasternParts(bucketStartMs);
    return hhmm >= anchorHHMM && hhmm < sessionEndHHMM;
  }

  function flushPartialIfNeeded(newBucketStartMs) {
    if (!partialFiveMinute) return;
    const prevStart = partialFiveMinute.bucketStartMs;
    if (prevStart === newBucketStartMs) return;
    if (bucketContributesToAvwap(prevStart)) {
      const tp = typicalPrice(partialFiveMinute.high, partialFiveMinute.low, partialFiveMinute.close);
      const vol = partialFiveMinute.volume;
      cumulativePV += tp * vol;
      cumulativeV += vol;
    }
    partialFiveMinute = null;
  }

  return {
    /**
     * Call for each 1m candle in chronological order (per session day).
     * @param {{ timeMs: number, open: number, high: number, low: number, close: number, volume?: number }} c
     */
    onOneMinuteCandle(c) {
      const t = Number(c.timeMs || 0);
      const bucketStart = fiveMinuteBucketStartMs(t);
      flushPartialIfNeeded(bucketStart);
      partialFiveMinute = mergeOneMinuteIntoFiveMinutePartial(partialFiveMinute, c);
    },

    anchoredVwapFromOneMinuteTypical(oneMinuteTypical) {
      if (cumulativeV > 0) return cumulativePV / cumulativeV;
      return oneMinuteTypical;
    },

    resetDay() {
      cumulativePV = 0;
      cumulativeV = 0;
      partialFiveMinute = null;
    },

    /** @internal for tests */
    _snapshot() {
      return { cumulativePV, cumulativeV, partialFiveMinute };
    }
  };
}

module.exports = {
  FIVE_MINUTES_MS,
  fiveMinuteBucketStartMs,
  typicalPrice,
  mergeOneMinuteIntoFiveMinutePartial,
  getEasternParts,
  createFiveMinuteAnchoredVwapFromOneMinuteState
};
