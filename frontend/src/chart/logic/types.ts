import type { Candle } from "../../types";

export type CandleSource = Candle["source"];

export interface ChartCandlePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source?: CandleSource;
}
