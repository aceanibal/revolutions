const test = require("node:test");
const assert = require("node:assert/strict");
const { DateTime } = require("luxon");
const {
  FIVE_MINUTES_MS,
  createFiveMinuteAnchoredVwapFromOneMinuteState,
  mergeOneMinuteIntoFiveMinutePartial,
  typicalPrice
} = require("./fiveMinuteAvwapFromOneMinute");

function makeOneMinuteCandle(baseMs, minuteOffset, open, high, low, close, volume) {
  return {
    timeMs: baseMs + minuteOffset * 60_000,
    open,
    high,
    low,
    close,
    volume
  };
}

function mergeBucket(candles) {
  let partial = null;
  for (const c of candles) partial = mergeOneMinuteIntoFiveMinutePartial(partial, c);
  return partial;
}

function computeCumulativeFromMergedFiveMinuteBuckets(buckets) {
  let pv = 0;
  let v = 0;
  const out = [];
  for (const bucket of buckets) {
    const tp = typicalPrice(bucket.high, bucket.low, bucket.close);
    pv += tp * bucket.volume;
    v += bucket.volume;
    out.push(v > 0 ? pv / v : tp);
  }
  return out;
}

test("flush commits merged 5m typical*volume parity", () => {
  const baseMs = DateTime.fromObject({ year: 2026, month: 1, day: 5, hour: 10, minute: 0 }, { zone: "America/New_York" }).toMillis();
  const state = createFiveMinuteAnchoredVwapFromOneMinuteState();
  const firstBucket = [
    makeOneMinuteCandle(baseMs, 0, 100, 101, 99, 100.5, 10),
    makeOneMinuteCandle(baseMs, 1, 100.5, 102, 100, 101.8, 20),
    makeOneMinuteCandle(baseMs, 2, 101.8, 103, 101, 102.4, 15),
    makeOneMinuteCandle(baseMs, 3, 102.4, 104, 102, 103.2, 12),
    makeOneMinuteCandle(baseMs, 4, 103.2, 104.5, 103, 104.1, 18)
  ];

  for (const c of firstBucket) state.onOneMinuteCandle(c);
  state.onOneMinuteCandle(makeOneMinuteCandle(baseMs + FIVE_MINUTES_MS, 0, 104.1, 104.8, 103.9, 104.2, 5));

  const merged = mergeBucket(firstBucket);
  const expected = typicalPrice(merged.high, merged.low, merged.close);
  const actual = state.anchoredVwapFromOneMinuteTypical(0);

  assert.ok(Number.isFinite(actual));
  assert.ok(Math.abs(actual - expected) < 1e-12);
});

test("currentAnchoredVwap matches cumulative 5m reference at each bucket end", () => {
  const baseMs = DateTime.fromObject({ year: 2026, month: 1, day: 5, hour: 10, minute: 0 }, { zone: "America/New_York" }).toMillis();
  const state = createFiveMinuteAnchoredVwapFromOneMinuteState();
  const allCandles = [
    makeOneMinuteCandle(baseMs, 0, 100, 101, 99.8, 100.9, 8),
    makeOneMinuteCandle(baseMs, 1, 100.9, 101.2, 100.3, 100.6, 14),
    makeOneMinuteCandle(baseMs, 2, 100.6, 101.4, 100.4, 101.2, 11),
    makeOneMinuteCandle(baseMs, 3, 101.2, 101.6, 100.7, 101.5, 13),
    makeOneMinuteCandle(baseMs, 4, 101.5, 102.1, 101.2, 101.9, 9),
    makeOneMinuteCandle(baseMs + FIVE_MINUTES_MS, 0, 101.9, 102.4, 101.7, 102.1, 7),
    makeOneMinuteCandle(baseMs + FIVE_MINUTES_MS, 1, 102.1, 102.3, 101.4, 101.6, 12),
    makeOneMinuteCandle(baseMs + FIVE_MINUTES_MS, 2, 101.6, 101.9, 101.1, 101.2, 10),
    makeOneMinuteCandle(baseMs + FIVE_MINUTES_MS, 3, 101.2, 101.5, 100.8, 101.1, 11),
    makeOneMinuteCandle(baseMs + FIVE_MINUTES_MS, 4, 101.1, 101.3, 100.5, 100.9, 10),
    makeOneMinuteCandle(baseMs + 2 * FIVE_MINUTES_MS, 0, 100.9, 101.1, 100.2, 100.5, 6),
    makeOneMinuteCandle(baseMs + 2 * FIVE_MINUTES_MS, 1, 100.5, 100.8, 100.1, 100.3, 8),
    makeOneMinuteCandle(baseMs + 2 * FIVE_MINUTES_MS, 2, 100.3, 100.6, 99.9, 100.1, 7),
    makeOneMinuteCandle(baseMs + 2 * FIVE_MINUTES_MS, 3, 100.1, 100.4, 99.7, 99.9, 9),
    makeOneMinuteCandle(baseMs + 2 * FIVE_MINUTES_MS, 4, 99.9, 100.2, 99.4, 99.6, 10)
  ];

  const mergedBuckets = [
    mergeBucket(allCandles.slice(0, 5)),
    mergeBucket(allCandles.slice(5, 10)),
    mergeBucket(allCandles.slice(10, 15))
  ];
  const referenceCumulative = computeCumulativeFromMergedFiveMinuteBuckets(mergedBuckets);

  const checkpoints = [4, 9, 14];
  for (let i = 0; i < allCandles.length; i += 1) {
    const c = allCandles[i];
    state.onOneMinuteCandle(c);
    if (!checkpoints.includes(i)) continue;
    const checkpointIdx = checkpoints.indexOf(i);
    const currentTypical = typicalPrice(c.high, c.low, c.close);
    const actual = state.currentAnchoredVwap(currentTypical);
    const expected = referenceCumulative[checkpointIdx];
    assert.ok(Number.isFinite(actual));
    assert.ok(Math.abs(actual - expected) < 1e-12);
  }
});
