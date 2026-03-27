function asNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function calculateMetrics({ trades, equity }) {
  const realizedPnL = trades.reduce((acc, t) => acc + asNum(t.pnl), 0);
  const winners = trades.filter((t) => asNum(t.pnl) > 0).length;
  const losers = trades.filter((t) => asNum(t.pnl) < 0).length;
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const point of equity) {
    peak = Math.max(peak, asNum(point.value));
    const dd = peak - asNum(point.value);
    maxDrawdown = Math.max(maxDrawdown, dd);
  }
  return {
    tradeCount: trades.length,
    winRate: trades.length > 0 ? winners / trades.length : 0,
    winners,
    losers,
    realizedPnL,
    maxDrawdown
  };
}

function createRunResult({ meta, events, equity, trades }) {
  return {
    version: 1,
    createdAtMs: Date.now(),
    meta: {
      sessionId: String(meta.sessionId || ""),
      symbol: String(meta.symbol || ""),
      timeframe: String(meta.timeframe || ""),
      mode: String(meta.mode || "candle"),
      strategyId: String(meta.strategyId || "noop"),
      params: meta.params || {},
      eventCount: events.length,
      eventStats: meta.eventStats || {
        realTickEvents: 0,
        syntheticTickEvents: 0,
        candleEvents: 0
      }
    },
    equity,
    trades,
    metrics: calculateMetrics({ trades, equity })
  };
}

module.exports = {
  createRunResult
};
