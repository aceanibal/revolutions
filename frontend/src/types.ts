export type Timeframe = "1m" | "5m";

export interface HudState {
  symbol: string;
  price: number;
  balance: number;
  stopLossPrice: number;
  riskPercent: number;
  positionSize: number;
}

export interface Candle {
  timeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Tick {
  symbol: string;
  price: number;
  size?: number;
  ts: number;
}

