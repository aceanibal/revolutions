const ONE_MINUTE_MS = 60_000;
const FIVE_MINUTES_MS = 5 * ONE_MINUTE_MS;

function floorToInterval(tsMs, intervalMs) {
  return Math.floor(tsMs / intervalMs) * intervalMs;
}

function mergeSource(prevSource, nextSource) {
  if (!prevSource) return nextSource;
  if (!nextSource) return prevSource;
  if (prevSource === nextSource) return prevSource;
  return "mixed";
}

function upsertCandle(candleMap, tick, intervalMs, source = "live") {
  const bucketStart = floorToInterval(tick.ts, intervalMs);
  const existingRaw = candleMap.get(bucketStart);
  const existing = existingRaw || null;

  if (!existing) {
    candleMap.set(bucketStart, {
      timeMs: bucketStart,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
      volume: Number.isFinite(tick.size) ? tick.size : 0,
      source,
      isGapFill: false
    });
    return;
  }

  candleMap.set(bucketStart, {
    ...existing,
    high: Math.max(existing.high, tick.price),
    low: Math.min(existing.low, tick.price),
    close: tick.price,
    volume: existing.volume + (Number.isFinite(tick.size) ? tick.size : 0),
    source: mergeSource(existing.source, source),
    isGapFill: Boolean(existing.isGapFill)
  });
}

function sortedCandlesFromMap(candleMap) {
  return Array.from(candleMap.values()).sort((a, b) => a.timeMs - b.timeMs);
}

function detectGapRanges(candles, intervalMs) {
  if (!Array.isArray(candles) || candles.length < 2) {
    return [];
  }

  const ordered = [...candles].sort((a, b) => a.timeMs - b.timeMs);
  const gaps = [];

  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const next = ordered[i];
    const diff = next.timeMs - prev.timeMs;
    if (diff <= intervalMs) continue;

    const missingBuckets = Math.floor(diff / intervalMs) - 1;
    if (missingBuckets <= 0) continue;

    gaps.push({
      fromTimeMs: prev.timeMs + intervalMs,
      toTimeMs: next.timeMs - intervalMs,
      missingBuckets
    });
  }

  return gaps;
}

function intervalForTimeframe(timeframe) {
  return timeframe === "5m" ? FIVE_MINUTES_MS : ONE_MINUTE_MS;
}

module.exports = {
  ONE_MINUTE_MS,
  FIVE_MINUTES_MS,
  floorToInterval,
  upsertCandle,
  sortedCandlesFromMap,
  detectGapRanges,
  intervalForTimeframe
};
