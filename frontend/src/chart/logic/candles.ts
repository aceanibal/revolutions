import type { Candle } from "../../types";
import type { ChartCandlePoint } from "./types";

export function normalizeCandles(candles: Candle[]): ChartCandlePoint[] {
  const normalizedCandles = candles
    .filter(
      (c) =>
        Number.isFinite(c.timeMs) &&
        [c.open, c.high, c.low, c.close].every(Number.isFinite)
    )
    .map((c) => ({
      time: Math.floor(c.timeMs / 1000),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: Number.isFinite(c.volume) && c.volume >= 0 ? c.volume : 0
    }))
    .sort((a, b) => a.time - b.time);

  const sourceByTime = new Map<number, Candle["source"]>();
  for (const candle of candles) {
    sourceByTime.set(Math.floor(candle.timeMs / 1000), candle.source);
  }

  return normalizedCandles.reduce<Array<ChartCandlePoint>>((acc, point) => {
    const last = acc[acc.length - 1];
    const source = sourceByTime.get(point.time);
    const withSource = { ...point, source };
    if (last && last.time === point.time) {
      acc[acc.length - 1] = withSource;
    } else {
      acc.push(withSource);
    }
    return acc;
  }, []);
}
