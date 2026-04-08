const test = require("node:test");
const assert = require("node:assert/strict");
const { DateTime } = require("luxon");
const { createOrbAvwapPullbackStrategy1m } = require("./orbAvwapPullbackStrategy1m");

function makeOneMinute(baseMs, minuteOffset, { open, high, low, close, volume = 10, rvol } = {}) {
  const candle = {
    timeMs: baseMs + minuteOffset * 60_000,
    open,
    high,
    low,
    close,
    volume
  };
  if (rvol != null && Number.isFinite(Number(rvol))) {
    candle.features = { "rvol-scanner": { rvol: Number(rvol) } };
  }
  return {
    kind: "candle",
    candle
  };
}

function runEvent(strategy, event) {
  return strategy.onEvent({
    event,
    state: { position: null, symbol: "TEST", scannerFeatures: null }
  });
}

test("arms on 5m signal and enters on next 1m close", () => {
  const baseMs = DateTime.fromObject({ year: 2026, month: 1, day: 5, hour: 10, minute: 0 }, { zone: "America/New_York" }).toMillis();
  const strategy = createOrbAvwapPullbackStrategy1m({ confirmAfterHHMM: 1000, stopLossSource: "open", minRvol: 0 });

  // Build signal 5m bucket (10:00-10:04): open below AVWAP, close above AVWAP => long signal.
  const signalBucket = [
    makeOneMinute(baseMs, 0, { open: 100, high: 101, low: 99, close: 100.5 }),
    makeOneMinute(baseMs, 1, { open: 100.5, high: 102, low: 100, close: 101.5 }),
    makeOneMinute(baseMs, 2, { open: 101.5, high: 103, low: 101, close: 102 }),
    makeOneMinute(baseMs, 3, { open: 102, high: 104, low: 101.8, close: 103.8 }),
    makeOneMinute(baseMs, 4, { open: 103.8, high: 106, low: 103.2, close: 105 })
  ];
  for (const e of signalBucket) {
    const action = runEvent(strategy, e);
    assert.equal(action, null);
  }

  // This event closes prior 5m bucket and arms pending entry, but must not enter same bar.
  const armEvent = makeOneMinute(baseMs, 5, { open: 106, high: 107, low: 105.6, close: 106.3 });
  const armAction = runEvent(strategy, armEvent);
  assert.equal(armAction, null);

  // Next 1m bar enters at close (Python-like "first 1m close after signal").
  const fillEvent = makeOneMinute(baseMs, 6, { open: 106.2, high: 106.5, low: 104.8, close: 105.8 });
  const fillAction = runEvent(strategy, fillEvent);
  assert.ok(fillAction);
  assert.equal(fillAction.type, "enter");
  assert.equal(fillAction.side, "long");
  assert.equal(fillAction.price, 105.8);
  assert.equal(fillAction.stopLoss, 100);
  assert.ok(Math.abs(fillAction.takeProfit - 117.4) < 1e-12);
  assert.equal(fillAction.meta.signalBucketStartMs, baseMs + 6 * 60_000);
  assert.equal(fillAction.meta.signalFiveMinuteBucketStartMs, baseMs);
});

test("widens stop to min % of entry when raw risk is tighter than floor", () => {
  const baseMs = DateTime.fromObject({ year: 2026, month: 1, day: 5, hour: 10, minute: 0 }, { zone: "America/New_York" }).toMillis();
  const strategy = createOrbAvwapPullbackStrategy1m({
    confirmAfterHHMM: 1000,
    stopLossSource: "open",
    minStopPct: 0.4,
    minRvol: 0
  });

  const signalBucket = [
    makeOneMinute(baseMs, 0, { open: 100, high: 101, low: 99, close: 100.5 }),
    makeOneMinute(baseMs, 1, { open: 100.5, high: 102, low: 100, close: 101.5 }),
    makeOneMinute(baseMs, 2, { open: 101.5, high: 103, low: 101, close: 102 }),
    makeOneMinute(baseMs, 3, { open: 102, high: 104, low: 101.8, close: 103.8 }),
    makeOneMinute(baseMs, 4, { open: 103.8, high: 106, low: 103.2, close: 105 })
  ];
  for (const e of signalBucket) {
    assert.equal(runEvent(strategy, e), null);
  }
  assert.equal(runEvent(strategy, makeOneMinute(baseMs, 5, { open: 106, high: 107, low: 105.6, close: 106.3 })), null);

  const entryPx = 100.08;
  const minRisk = entryPx * (0.4 / 100);
  const fillAction = runEvent(
    strategy,
    makeOneMinute(baseMs, 6, { open: 100.1, high: 100.2, low: 99.9, close: entryPx })
  );
  assert.ok(fillAction);
  assert.equal(fillAction.type, "enter");
  const expectedRisk = Math.max(Math.abs(entryPx - 100), minRisk);
  const expectedSl = entryPx - expectedRisk;
  const expectedTp = entryPx + 2 * expectedRisk;
  assert.ok(Math.abs(fillAction.stopLoss - expectedSl) < 1e-9);
  assert.ok(Math.abs(fillAction.takeProfit - expectedTp) < 1e-9);
});

test("evaluates exits on each 1m candle", () => {
  const baseMs = DateTime.fromObject({ year: 2026, month: 1, day: 5, hour: 10, minute: 0 }, { zone: "America/New_York" }).toMillis();
  const strategy = createOrbAvwapPullbackStrategy1m({ confirmAfterHHMM: 1000, stopLossSource: "open", minRvol: 0 });

  const seed = [
    makeOneMinute(baseMs, 0, { open: 100, high: 101, low: 99, close: 100.5 }),
    makeOneMinute(baseMs, 1, { open: 100.5, high: 102, low: 100, close: 101.5 }),
    makeOneMinute(baseMs, 2, { open: 101.5, high: 103, low: 101, close: 102 }),
    makeOneMinute(baseMs, 3, { open: 102, high: 104, low: 101.8, close: 103.8 }),
    makeOneMinute(baseMs, 4, { open: 103.8, high: 106, low: 103.2, close: 105 }),
    makeOneMinute(baseMs, 5, { open: 106, high: 107, low: 105.7, close: 106.4 })
  ];
  for (const e of seed) {
    const action = runEvent(strategy, e);
    assert.equal(action, null);
  }

  const enterAction = runEvent(strategy, makeOneMinute(baseMs, 6, { open: 106.5, high: 107.2, low: 105.2, close: 106.8 }));
  assert.ok(enterAction);
  assert.equal(enterAction.type, "enter");
  assert.equal(enterAction.side, "long");

  // This 1m candle reaches TP intrabar; exit should happen immediately on this event.
  const exitAction = runEvent(strategy, makeOneMinute(baseMs, 7, { open: 106.8, high: 121, low: 106.2, close: 118 }));
  assert.ok(exitAction);
  assert.equal(exitAction.type, "exit");
  assert.equal(exitAction.side, "long");
});

test("skips entry when entry candle RVOL is below minRvol", () => {
  const baseMs = DateTime.fromObject({ year: 2026, month: 1, day: 5, hour: 10, minute: 0 }, { zone: "America/New_York" }).toMillis();
  const strategy = createOrbAvwapPullbackStrategy1m({
    confirmAfterHHMM: 1000,
    stopLossSource: "open",
    minRvol: 1.2
  });
  const signalBucket = [
    makeOneMinute(baseMs, 0, { open: 100, high: 101, low: 99, close: 100.5 }),
    makeOneMinute(baseMs, 1, { open: 100.5, high: 102, low: 100, close: 101.5 }),
    makeOneMinute(baseMs, 2, { open: 101.5, high: 103, low: 101, close: 102 }),
    makeOneMinute(baseMs, 3, { open: 102, high: 104, low: 101.8, close: 103.8 }),
    makeOneMinute(baseMs, 4, { open: 103.8, high: 106, low: 103.2, close: 105 })
  ];
  for (const e of signalBucket) assert.equal(runEvent(strategy, e), null);
  assert.equal(runEvent(strategy, makeOneMinute(baseMs, 5, { open: 106, high: 107, low: 105.6, close: 106.3 })), null);

  const lowRvol = runEvent(
    strategy,
    makeOneMinute(baseMs, 6, { open: 106.2, high: 106.5, low: 104.8, close: 105.8, rvol: 1.1 })
  );
  assert.equal(lowRvol, null);
});

test("enters when entry candle RVOL meets minRvol", () => {
  const baseMs = DateTime.fromObject({ year: 2026, month: 1, day: 5, hour: 10, minute: 0 }, { zone: "America/New_York" }).toMillis();
  const strategy = createOrbAvwapPullbackStrategy1m({
    confirmAfterHHMM: 1000,
    stopLossSource: "open",
    minRvol: 1.2
  });
  const signalBucket = [
    makeOneMinute(baseMs, 0, { open: 100, high: 101, low: 99, close: 100.5 }),
    makeOneMinute(baseMs, 1, { open: 100.5, high: 102, low: 100, close: 101.5 }),
    makeOneMinute(baseMs, 2, { open: 101.5, high: 103, low: 101, close: 102 }),
    makeOneMinute(baseMs, 3, { open: 102, high: 104, low: 101.8, close: 103.8 }),
    makeOneMinute(baseMs, 4, { open: 103.8, high: 106, low: 103.2, close: 105 })
  ];
  for (const e of signalBucket) assert.equal(runEvent(strategy, e), null);
  assert.equal(runEvent(strategy, makeOneMinute(baseMs, 5, { open: 106, high: 107, low: 105.6, close: 106.3 })), null);

  const enter = runEvent(
    strategy,
    makeOneMinute(baseMs, 6, { open: 106.2, high: 106.5, low: 104.8, close: 105.8, rvol: 1.25 })
  );
  assert.ok(enter);
  assert.equal(enter.type, "enter");
});
