import type { PriceLevel, TradeRow } from "../types";

function priceFromR(entry: number, risk: number, side: number, rValue: number): number {
  if (!Number.isFinite(entry) || !Number.isFinite(risk) || !Number.isFinite(rValue) || risk <= 0) return NaN;
  const dir = side >= 0 ? 1 : -1;
  return entry + dir * risk * rValue;
}

export function buildTradeLevels(trade: TradeRow): PriceLevel[] {
  const levels: PriceLevel[] = [];
  if (Number.isFinite(trade.entry_price)) {
    levels.push({ price: trade.entry_price, title: "Entry", color: "rgba(76,29,149,0.95)", style: 2 });
  }
  if (Number.isFinite(trade.stop_init)) {
    levels.push({ price: trade.stop_init, title: "Stop Loss", color: "rgba(220,38,38,0.95)", style: 0 });
  }
  if (Number.isFinite(trade.tp_price)) {
    levels.push({ price: trade.tp_price, title: "TP", color: "rgba(5,150,105,0.95)", style: 0 });
  }

  const stageDefs: Array<[keyof TradeRow, string, string]> = [
    ["mfe1", "MFE1", "rgba(37,99,235,0.9)"],
    ["lock1", "LOCK1", "rgba(37,99,235,0.65)"],
    ["mfe2", "MFE2", "rgba(14,116,144,0.9)"],
    ["lock2", "LOCK2", "rgba(14,116,144,0.65)"]
  ];

  for (const [field, label, color] of stageDefs) {
    const rVal = Number(trade[field]);
    const px = priceFromR(trade.entry_price, trade.risk, trade.side, rVal);
    if (Number.isFinite(px)) {
      levels.push({ price: px, title: label, color, style: 2 });
    }
  }

  return levels;
}
