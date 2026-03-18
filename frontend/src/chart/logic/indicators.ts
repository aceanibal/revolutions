import type { LineData, Time } from "lightweight-charts";
import type { ChartCandlePoint } from "./types";

export function calculateVwapData(data: ChartCandlePoint[], periodInput: number): LineData[] {
  const period = Math.max(1, Math.floor(periodInput));
  const pvWindow: number[] = [];
  const volumeWindow: number[] = [];
  let rollingPV = 0;
  let rollingVolume = 0;
  const vwapData: LineData[] = [];

  for (const point of data) {
    const typicalPrice = (point.high + point.low + point.close) / 3;
    const volume = Number.isFinite(point.volume) ? point.volume : 0;
    const pv = typicalPrice * volume;
    pvWindow.push(pv);
    volumeWindow.push(volume);
    rollingPV += pv;
    rollingVolume += volume;
    if (pvWindow.length > period) {
      rollingPV -= pvWindow.shift() ?? 0;
      rollingVolume -= volumeWindow.shift() ?? 0;
    }
    vwapData.push({
      time: point.time as Time,
      value: rollingVolume > 0 ? rollingPV / rollingVolume : typicalPrice
    });
  }

  return vwapData;
}

export function calculateEmaData(data: ChartCandlePoint[], periodInput: number): LineData[] {
  const period = Math.max(1, Math.floor(periodInput));
  const multiplier = 2 / (period + 1);
  const emaData: LineData[] = [];
  let emaValue: number | null = null;

  for (const point of data) {
    if (emaValue == null) {
      emaValue = point.close;
    } else {
      emaValue = (point.close - emaValue) * multiplier + emaValue;
    }
    emaData.push({ time: point.time as Time, value: emaValue });
  }

  return emaData;
}
