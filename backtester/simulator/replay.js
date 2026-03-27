const { buildEvents } = require("../engine/runBacktest");

function createReplayController(events, options = {}) {
  const speedMs = Number(options.speedMs || 200);
  let index = -1;
  let timer = null;

  function clamp(next) {
    if (!Number.isFinite(next)) return index;
    return Math.max(-1, Math.min(events.length - 1, Math.floor(next)));
  }

  function current() {
    return index >= 0 ? events[index] : null;
  }

  return {
    get index() {
      return index;
    },
    get length() {
      return events.length;
    },
    current,
    seek(nextIndex) {
      index = clamp(nextIndex);
      return current();
    },
    step(direction = 1) {
      index = clamp(index + (direction >= 0 ? 1 : -1));
      return current();
    },
    play(onStep) {
      if (timer) return;
      timer = setInterval(() => {
        if (index >= events.length - 1) {
          clearInterval(timer);
          timer = null;
          return;
        }
        index = clamp(index + 1);
        if (typeof onStep === "function") onStep(current(), index);
      }, speedMs);
    },
    pause() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    isPlaying() {
      return Boolean(timer);
    }
  };
}

function createTickReplay({ ticks = [] }) {
  return createReplayController(buildEvents({ mode: "tick", ticks }), { speedMs: 100 });
}

function createCandleReplay({ candles = [], timeframe = "1m" }) {
  return createReplayController(buildEvents({ mode: "candle", candles, timeframe }), {
    speedMs: 250
  });
}

function createMixedReplay({ ticks = [], candles = [], timeframe = "1m" }) {
  return createReplayController(buildEvents({ mode: "mixed", ticks, candles, timeframe }), {
    speedMs: 150
  });
}

module.exports = {
  createReplayController,
  createTickReplay,
  createCandleReplay,
  createMixedReplay
};
