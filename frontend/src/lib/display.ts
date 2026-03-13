import type { Candle } from "../types";

// Merge historical candles with live-aggregated candles.
// If both have a candle for the same timeMs bucket, prefer the live candle
// so the "current" candle continues to update with each new tick.
export function buildDisplayCandles(history: Candle[], live: Candle[]): Candle[] {
  if (!history.length) {
    return [...live].sort((a, b) => a.timeMs - b.timeMs);
  }

  if (!live.length) {
    return [...history].sort((a, b) => a.timeMs - b.timeMs);
  }

  const merged = [...history, ...live].sort((a, b) => a.timeMs - b.timeMs);

  const result: Candle[] = [];
  for (const c of merged) {
    const last = result[result.length - 1];
    if (last && last.timeMs === c.timeMs) {
      // Prefer the more recent (live) candle for this bucket.
      result[result.length - 1] = c;
    } else {
      result.push(c);
    }
  }

  return result;
}

