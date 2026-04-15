export interface Candle {
  timeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RunConfig {
  run_id: string;
  db: string;
  symbols: string[];
  rsi_l?: number;
  rsi_h?: number;
  /** Wilder RSI length on 4h closes (default 14 if omitted). */
  rsi_period?: number;
  tp_sweep?: number[];
  [key: string]: unknown;
}

export interface TradeRow {
  symbol: string;
  tp_r: number;
  entry_ts_utc: string;
  exit_ts_utc: string;
  side: number;
  entry_price: number;
  stop_init: number;
  risk: number;
  tp_price: number;
  mfe1: number;
  lock1: number;
  mfe2: number;
  lock2: number;
  managed_r: number;
  managed_reason: string;
  [key: string]: string | number;
}

export interface RunUploadData {
  runConfig: RunConfig;
  tpTrades: Record<string, TradeRow[]>;
  tradeFiles: string[];
  runFolderName: string;
  runId?: string;
}

export interface RunListItem {
  id: string;
  updatedAtMs: number;
}

export interface ChartMarker {
  timeSec: number;
  color: string;
  position: "aboveBar" | "belowBar";
  shape: "arrowUp" | "arrowDown" | "circle";
  text?: string;
}

export interface PriceLevel {
  price: number;
  title: string;
  color: string;
  style?: 0 | 1 | 2 | 3;
}
