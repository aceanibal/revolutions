import type { Candle } from "../types";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

function bucket4h(timeMs: number) {
  return Math.floor(timeMs / FOUR_HOURS_MS) * FOUR_HOURS_MS;
}

export function aggregateTo4h(candles5m: Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  const ordered = [...candles5m].sort((a, b) => a.timeMs - b.timeMs);
  for (const c of ordered) {
    const b = bucket4h(c.timeMs);
    const prev = map.get(b);
    if (!prev) {
      map.set(b, {
        timeMs: b,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      });
    } else {
      prev.high = Math.max(prev.high, c.high);
      prev.low = Math.min(prev.low, c.low);
      prev.close = c.close;
      prev.volume += c.volume;
      map.set(b, prev);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.timeMs - b.timeMs);
}

export function calculateRsi(candles: Candle[], period = 14): Array<{ timeMs: number; value: number }> {
  if (candles.length <= period) return [];
  const close = candles.map((c) => c.close);
  const out: Array<{ timeMs: number; value: number }> = [];

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = close[i] - close[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  const firstRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  out.push({
    timeMs: candles[period].timeMs,
    value: 100 - 100 / (1 + firstRs)
  });

  for (let i = period + 1; i < close.length; i += 1) {
    const diff = close[i] - close[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out.push({
      timeMs: candles[i].timeMs,
      value: 100 - 100 / (1 + rs)
    });
  }

  return out;
}

export function toIsoDay(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 19).replace("T", " ");
}
