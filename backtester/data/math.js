const ONE_MINUTE_MS = 60_000;
const FIVE_MINUTES_MS = 5 * ONE_MINUTE_MS;

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function intervalForTimeframe(timeframe) {
  return timeframe === "5m" ? FIVE_MINUTES_MS : ONE_MINUTE_MS;
}

function detectGapRanges(candles, intervalMs) {
  if (!Array.isArray(candles) || candles.length < 2) return [];
  const ordered = [...candles].sort((a, b) => a.timeMs - b.timeMs);
  const ranges = [];

  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const next = ordered[i];
    const diff = next.timeMs - prev.timeMs;
    if (diff <= intervalMs) continue;
    const missingBuckets = Math.floor(diff / intervalMs) - 1;
    if (missingBuckets <= 0) continue;
    ranges.push({
      fromTimeMs: prev.timeMs + intervalMs,
      toTimeMs: next.timeMs - intervalMs,
      missingBuckets
    });
  }

  return ranges;
}

module.exports = {
  ONE_MINUTE_MS,
  FIVE_MINUTES_MS,
  intervalForTimeframe,
  normalizeSymbol,
  detectGapRanges
};
