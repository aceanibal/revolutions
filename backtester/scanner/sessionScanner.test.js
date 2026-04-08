const test = require("node:test");
const assert = require("node:assert/strict");
const {
  appendDualTimeframeMirrorRows,
  fiveMinuteBarOpenAtOrBefore
} = require("./sessionScanner");

test("fiveMinuteBarOpenAtOrBefore picks bar open at or before anchor", () => {
  const sorted5m = [
    { timeMs: 1_000_000 },
    { timeMs: 1_000_000 + 300_000 },
    { timeMs: 1_000_000 + 600_000 }
  ];
  assert.equal(fiveMinuteBarOpenAtOrBefore(sorted5m, 1_000_000 + 120_000), 1_000_000);
  assert.equal(fiveMinuteBarOpenAtOrBefore(sorted5m, 1_000_000 + 300_000), 1_000_000 + 300_000);
});

test("appendDualTimeframeMirrorRows adds 5m rows for 1m primary", () => {
  const sorted5m = [{ timeMs: 1000 }, { timeMs: 1000 + 300_000 }];
  const rows = [
    {
      symbol: "AAA",
      timeframe: "1m",
      bucketStartMs: 1000 + 60_000,
      payload: { symbol: "AAA", timeframe: "1m", anchorTsMs: 1000 + 60_000, rvol: 1.5 }
    }
  ];
  const out = appendDualTimeframeMirrorRows(rows, "1m", 1000 + 60_000, sorted5m);
  assert.equal(out.length, 2);
  assert.equal(out[1].timeframe, "5m");
  assert.equal(out[1].bucketStartMs, 1000);
  assert.equal(out[1].payload.computedOnTimeframe, "1m");
  assert.equal(out[1].payload.rvol, 1.5);
});

test("appendDualTimeframeMirrorRows adds 1m rows for 5m primary", () => {
  const rows = [
    {
      symbol: "AAA",
      timeframe: "5m",
      bucketStartMs: 5000,
      payload: { symbol: "AAA", timeframe: "5m", anchorTsMs: 5000, rvol: 2 }
    }
  ];
  const out = appendDualTimeframeMirrorRows(rows, "5m", 5000, []);
  assert.equal(out.length, 2);
  assert.equal(out[1].timeframe, "1m");
  assert.equal(out[1].bucketStartMs, 5000);
  assert.equal(out[1].payload.computedOnTimeframe, "5m");
});
