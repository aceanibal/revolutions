import type { Candle } from "../types";

const ONE_H_MS = 60 * 60 * 1000;

/**
 * Roll 5m candles into 1h OHLCV (UTC bucket by `floor(timeMs / 1h) * 1h`).
 * Open = first bar in bucket, high/low = range, close = last bar, volume = sum.
 */
export function aggregate5mTo1h(candles: Candle[]): Candle[] {
  if (candles.length === 0) return [];
  const sorted = [...candles].sort((a, b) => a.timeMs - b.timeMs);
  const out: Candle[] = [];
  let bucketMs = -1;
  let agg: Candle | null = null;

  for (const c of sorted) {
    const b = Math.floor(c.timeMs / ONE_H_MS) * ONE_H_MS;
    if (b !== bucketMs) {
      if (agg) out.push(agg);
      bucketMs = b;
      agg = {
        timeMs: b,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      };
    } else if (agg) {
      agg.high = Math.max(agg.high, c.high);
      agg.low = Math.min(agg.low, c.low);
      agg.close = c.close;
      agg.volume += c.volume;
    }
  }
  if (agg) out.push(agg);
  return out;
}
