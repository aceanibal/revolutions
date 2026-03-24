import type { Candle, GapRange } from "../../types";

const FIVE_MINUTES_MS = 5 * 60_000;
const FIFTEEN_MINUTES_MS = 15 * 60_000;

function floorToInterval(tsMs: number, intervalMs: number): number {
  return Math.floor(tsMs / intervalMs) * intervalMs;
}

function mergeSource(prevSource: Candle["source"], nextSource: Candle["source"]): Candle["source"] {
  if (!prevSource) return nextSource;
  if (!nextSource) return prevSource;
  if (prevSource === nextSource) return prevSource;
  return "mixed";
}

export function aggregate5mCandlesTo15m(candles5m: Candle[]): Candle[] {
  if (!Array.isArray(candles5m) || candles5m.length === 0) return [];

  const ordered = [...candles5m]
    .filter(
      (c) =>
        Number.isFinite(c.timeMs) &&
        [c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)
    )
    .sort((a, b) => a.timeMs - b.timeMs);

  const grouped = new Map<number, Candle[]>();
  for (const candle of ordered) {
    const bucketStart = floorToInterval(candle.timeMs, FIFTEEN_MINUTES_MS);
    const existing = grouped.get(bucketStart);
    if (existing) existing.push(candle);
    else grouped.set(bucketStart, [candle]);
  }

  const result: Candle[] = [];
  const bucketStarts = Array.from(grouped.keys()).sort((a, b) => a - b);
  for (const bucketStart of bucketStarts) {
    const bucketCandles = (grouped.get(bucketStart) || []).sort((a, b) => a.timeMs - b.timeMs);
    if (bucketCandles.length === 0) continue;

    const first = bucketCandles[0];
    const last = bucketCandles[bucketCandles.length - 1];
    let high = first.high;
    let low = first.low;
    let volume = 0;
    let source: Candle["source"] = first.source;
    let isGapFill = Boolean(first.isGapFill);

    for (const candle of bucketCandles) {
      high = Math.max(high, candle.high);
      low = Math.min(low, candle.low);
      volume += candle.volume;
      source = mergeSource(source, candle.source);
      isGapFill = isGapFill || Boolean(candle.isGapFill);
    }

    result.push({
      timeMs: bucketStart,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
      source,
      isGapFill
    });
  }

  return result;
}

export function aggregate5mGapsTo15m(gaps5m: GapRange[]): GapRange[] {
  if (!Array.isArray(gaps5m) || gaps5m.length === 0) return [];

  const missing15mBucketStarts = new Set<number>();

  for (const gap of gaps5m) {
    if (!Number.isFinite(gap.fromTimeMs) || !Number.isFinite(gap.toTimeMs)) continue;
    const expectedBuckets = Number.isFinite(gap.missingBuckets) ? Math.max(0, gap.missingBuckets) : 0;
    if (expectedBuckets <= 0) continue;

    let count = 0;
    for (
      let missing5mStart = gap.fromTimeMs;
      missing5mStart <= gap.toTimeMs && count < expectedBuckets;
      missing5mStart += FIVE_MINUTES_MS
    ) {
      missing15mBucketStarts.add(floorToInterval(missing5mStart, FIFTEEN_MINUTES_MS));
      count += 1;
    }
  }

  const ordered15m = Array.from(missing15mBucketStarts).sort((a, b) => a - b);
  if (ordered15m.length === 0) return [];

  const result: GapRange[] = [];
  let rangeStart = ordered15m[0];
  let prev = ordered15m[0];

  for (let i = 1; i < ordered15m.length; i += 1) {
    const current = ordered15m[i];
    if (current === prev + FIFTEEN_MINUTES_MS) {
      prev = current;
      continue;
    }

    const missingBuckets = Math.floor((prev - rangeStart) / FIFTEEN_MINUTES_MS) + 1;
    result.push({
      fromTimeMs: rangeStart,
      toTimeMs: prev,
      missingBuckets
    });
    rangeStart = current;
    prev = current;
  }

  const tailMissingBuckets = Math.floor((prev - rangeStart) / FIFTEEN_MINUTES_MS) + 1;
  result.push({
    fromTimeMs: rangeStart,
    toTimeMs: prev,
    missingBuckets: tailMissingBuckets
  });

  return result;
}
