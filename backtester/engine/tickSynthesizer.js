const { intervalForTimeframe } = require("../data/math");

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Create deterministic synthetic ticks from candles.
 * This is fallback-only when real ticks are missing.
 */
function synthesizeTicksFromCandles(candles = [], timeframe = "1m", options = {}) {
  const intervalMs = intervalForTimeframe(timeframe === "5m" ? "5m" : "1m");
  const ticksPerCandle = clamp(Number(options.ticksPerCandle || 4), 4, 20);
  const out = [];

  for (const candle of candles) {
    const start = Number(candle.timeMs || 0);
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    if (![start, open, high, low, close].every(Number.isFinite)) continue;
    if (start <= 0) continue;

    // Common intrabar path model:
    // bullish bars prefer O->L->H->C, bearish bars prefer O->H->L->C.
    const bullish = close >= open;
    const anchors = bullish ? [open, low, high, close] : [open, high, low, close];
    const segments = anchors.length - 1;
    const basePerSegment = Math.max(1, Math.floor(ticksPerCandle / segments));
    const prices = [anchors[0]];
    for (let s = 0; s < segments; s += 1) {
      const from = anchors[s];
      const to = anchors[s + 1];
      const count = s === segments - 1 ? Math.max(1, ticksPerCandle - prices.length + 1) : basePerSegment;
      for (let i = 1; i <= count; i += 1) {
        const t = i / count;
        prices.push(from + (to - from) * t);
      }
    }

    const stepMs = intervalMs / Math.max(1, prices.length);
    prices.forEach((price, idx) => {
      out.push({
        symbol: String(options.symbol || ""),
        ts: Math.floor(start + idx * stepMs),
        price: Number(price),
        size: Number(candle.volume || 0) / Math.max(1, prices.length),
        source: "synthetic"
      });
    });
  }

  return out;
}

module.exports = {
  synthesizeTicksFromCandles
};
