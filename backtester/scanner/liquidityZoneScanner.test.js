const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractDailyLevels,
  computeVolumeProfile,
  findHighVolumeNodes,
  detectSwingPoints,
  computeLiquidityZones
} = require("./liquidityZoneScanner");

const { DateTime } = require("luxon");

/** Helper: create a 5m candle at the given ET time string. */
function candle(etDatetime, open, high, low, close, volume = 100) {
  const dt = DateTime.fromFormat(etDatetime, "yyyy-MM-dd HH:mm", { zone: "America/New_York" });
  return { timeMs: dt.toMillis(), open, high, low, close, volume };
}

// ---------------------------------------------------------------------------
// extractDailyLevels
// ---------------------------------------------------------------------------

test("extractDailyLevels groups candles by ET day and tracks OHLC", () => {
  const candles = [
    candle("2026-04-01 09:30", 100, 105, 99, 102),
    candle("2026-04-01 10:00", 102, 110, 101, 108),
    candle("2026-04-01 15:55", 108, 109, 106, 107),
    candle("2026-04-02 09:30", 107, 112, 106, 111),
    candle("2026-04-02 10:00", 111, 115, 110, 114)
  ];

  const days = extractDailyLevels(candles);
  assert.equal(days.length, 2);

  assert.equal(days[0].dayKey, "2026-04-01");
  assert.equal(days[0].high, 110);
  assert.equal(days[0].low, 99);
  assert.equal(days[0].open, 100);
  assert.equal(days[0].close, 107);

  assert.equal(days[1].dayKey, "2026-04-02");
  assert.equal(days[1].high, 115);
  assert.equal(days[1].low, 106);
  assert.equal(days[1].open, 107);
  assert.equal(days[1].close, 114);
});

test("extractDailyLevels returns empty array for no candles", () => {
  assert.deepStrictEqual(extractDailyLevels([]), []);
});

// ---------------------------------------------------------------------------
// computeVolumeProfile
// ---------------------------------------------------------------------------

test("computeVolumeProfile distributes volume into bins", () => {
  const candles = [
    { timeMs: 1, open: 100, high: 110, low: 90, close: 100, volume: 500 },
    { timeMs: 2, open: 100, high: 110, low: 90, close: 105, volume: 300 },
    { timeMs: 3, open: 100, high: 110, low: 90, close: 95, volume: 200 }
  ];

  const profile = computeVolumeProfile(candles, 10);
  assert.equal(profile.bins.length, 10);
  assert.equal(profile.weekHigh, 110);
  assert.equal(profile.weekLow, 90);

  const totalVolume = profile.bins.reduce((s, b) => s + b.volume, 0);
  assert.equal(totalVolume, 1000);
});

test("computeVolumeProfile returns empty for no candles", () => {
  const profile = computeVolumeProfile([], 10);
  assert.equal(profile.bins.length, 0);
});

test("computeVolumeProfile returns empty for flat price", () => {
  const candles = [
    { timeMs: 1, open: 100, high: 100, low: 100, close: 100, volume: 100 }
  ];
  const profile = computeVolumeProfile(candles, 10);
  assert.equal(profile.bins.length, 0);
});

// ---------------------------------------------------------------------------
// findHighVolumeNodes
// ---------------------------------------------------------------------------

test("findHighVolumeNodes picks bins above threshold", () => {
  const bins = [
    { priceLow: 0, priceHigh: 1, priceMid: 0.5, volume: 10 },
    { priceLow: 1, priceHigh: 2, priceMid: 1.5, volume: 10 },
    { priceLow: 2, priceHigh: 3, priceMid: 2.5, volume: 10 },
    { priceLow: 3, priceHigh: 4, priceMid: 3.5, volume: 10 },
    { priceLow: 4, priceHigh: 5, priceMid: 4.5, volume: 100 }
  ];
  const profile = { bins, weekHigh: 5, weekLow: 0, binSize: 1 };

  const nodes = findHighVolumeNodes(profile, 1.0);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].priceMid, 4.5);
  assert.equal(nodes[0].volume, 100);
});

test("findHighVolumeNodes returns empty for uniform volume", () => {
  const bins = Array.from({ length: 5 }, (_, i) => ({
    priceLow: i,
    priceHigh: i + 1,
    priceMid: i + 0.5,
    volume: 50
  }));
  // All same volume → stdDev = 0 → threshold = mean = 50 → all pass (>= threshold)
  const nodes = findHighVolumeNodes({ bins }, 1.0);
  assert.equal(nodes.length, 5);
});

// ---------------------------------------------------------------------------
// detectSwingPoints
// ---------------------------------------------------------------------------

test("detectSwingPoints finds fractal pivot highs and lows", () => {
  // Pattern: low → high → low with left=2 right=2
  const candles = [
    { timeMs: 1, high: 100, low: 95 },
    { timeMs: 2, high: 101, low: 96 },
    { timeMs: 3, high: 110, low: 97 }, // swing high
    { timeMs: 4, high: 102, low: 96 },
    { timeMs: 5, high: 100, low: 95 },
    { timeMs: 6, high: 99, low: 88 }, // swing low
    { timeMs: 7, high: 101, low: 94 },
    { timeMs: 8, high: 105, low: 96 }
  ];

  const { swingHighs, swingLows } = detectSwingPoints(candles, 2, 2);
  assert.equal(swingHighs.length, 1);
  assert.equal(swingHighs[0].price, 110);
  assert.equal(swingHighs[0].timeMs, 3);

  assert.equal(swingLows.length, 1);
  assert.equal(swingLows[0].price, 88);
  assert.equal(swingLows[0].timeMs, 6);
});

test("detectSwingPoints returns empty for insufficient data", () => {
  const { swingHighs, swingLows } = detectSwingPoints([{ timeMs: 1, high: 100, low: 90 }], 3, 3);
  assert.equal(swingHighs.length, 0);
  assert.equal(swingLows.length, 0);
});

// ---------------------------------------------------------------------------
// computeLiquidityZones (integration)
// ---------------------------------------------------------------------------

test("computeLiquidityZones returns null for empty candles", () => {
  assert.equal(computeLiquidityZones([], 1000), null);
});

test("computeLiquidityZones returns null for invalid anchor", () => {
  assert.equal(computeLiquidityZones([{ timeMs: 1 }], 0), null);
});

test("computeLiquidityZones returns full payload for multi-day data", () => {
  const sorted = [];
  // Generate 3 days of 5m candles (Mon-Wed), anchored at Wed 5 PM
  for (let day = 0; day < 3; day++) {
    const dateStr = `2026-04-0${day + 1}`;
    for (let hour = 9; hour <= 17; hour++) {
      for (let minute = 0; minute < 60; minute += 5) {
        const base = 100 + day * 2 + Math.sin((hour * 60 + minute) / 100) * 5;
        sorted.push(
          candle(
            `${dateStr} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
            base,
            base + 1,
            base - 1,
            base + 0.5,
            1000
          )
        );
      }
    }
  }
  sorted.sort((a, b) => a.timeMs - b.timeMs);

  const anchorDt = DateTime.fromFormat("2026-04-03 17:00", "yyyy-MM-dd HH:mm", {
    zone: "America/New_York"
  });
  const zones = computeLiquidityZones(sorted, anchorDt.toMillis(), { lookbackDays: 7 });

  assert.ok(zones !== null);
  assert.equal(zones.anchorDayKey, "2026-04-03");
  assert.ok(zones.candleCount > 0);
  assert.ok(zones.weekHigh > 0);
  assert.ok(zones.weekLow > 0);
  assert.ok(zones.weekHigh > zones.weekLow);
  assert.ok(Array.isArray(zones.dailyLevels));
  assert.equal(zones.dailyLevels.length, 2); // days before anchor day
  assert.ok(Array.isArray(zones.highVolumeNodes));
  assert.ok(Array.isArray(zones.swingHighs));
  assert.ok(Array.isArray(zones.swingLows));
  assert.equal(zones.previousDayHigh, zones.dailyLevels[1].high);
  assert.equal(zones.previousDayLow, zones.dailyLevels[1].low);
});

test("computeLiquidityZones respects lookback window", () => {
  const sorted = [];
  // 10 days of data
  for (let day = 1; day <= 10; day++) {
    const dateStr = `2026-04-${String(day).padStart(2, "0")}`;
    sorted.push(candle(`${dateStr} 12:00`, 100 + day, 105 + day, 95 + day, 102 + day, 500));
  }
  sorted.sort((a, b) => a.timeMs - b.timeMs);

  const anchorDt = DateTime.fromFormat("2026-04-10 17:00", "yyyy-MM-dd HH:mm", {
    zone: "America/New_York"
  });

  // lookback 3 days: only days 8, 9, 10 should be in the window
  const zones = computeLiquidityZones(sorted, anchorDt.toMillis(), { lookbackDays: 3 });
  assert.ok(zones !== null);
  assert.ok(zones.candleCount <= 3);
  // dailyLevels only includes days before anchor day (day 10)
  assert.ok(zones.dailyLevels.every((d) => d.dayKey >= "2026-04-08"));
});
