import type { AccountMode } from "./types";
import type { RiskFirstMetrics } from "./lib/riskCalculator";

function fmtUsd(v: number | undefined | null): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "$0.00";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

interface RiskFirstPanelProps {
  accountBalance: number;
  riskPercentage: number;
  entryPrice: number;
  livePrice: number;
  hasActiveTrade: boolean;
  stopLossPrice: number;
  isLong: boolean;
  makerFeeRate: number;
  takerFeeRate: number;
  metrics: RiskFirstMetrics;
  warningText: string | null;
  accountMode: AccountMode;
  onModeToggle: () => void;
  onRiskPercentageChange: (value: number) => void;
  onIsLongChange: (value: boolean) => void;
}

export function RiskFirstPanel({
  accountBalance,
  riskPercentage,
  entryPrice,
  livePrice,
  hasActiveTrade,
  stopLossPrice,
  isLong,
  makerFeeRate,
  takerFeeRate,
  metrics,
  warningText,
  accountMode,
  onModeToggle,
  onRiskPercentageChange,
  onIsLongChange
}: RiskFirstPanelProps) {
  return (
    <aside className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Risk-First Position Sizing</h3>
        <button
          type="button"
          onClick={onModeToggle}
          className={`rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider transition ${
            accountMode === "live"
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-amber-500 text-white shadow-sm"
          }`}
        >
          {accountMode}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
        <div className="space-y-1">
          <span className="block text-slate-500">Account Balance</span>
          <p className="w-full rounded-md border border-slate-200 bg-slate-100 px-2 py-1 tabular-nums text-slate-900">
            {fmtUsd(accountBalance)}
          </p>
        </div>
        <label className="space-y-1">
          <span className="block text-slate-500">Risk %</span>
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={riskPercentage}
            onChange={(e) => onRiskPercentageChange(Number(e.target.value))}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 tabular-nums outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300"
          />
        </label>
        <div className="space-y-1">
          <span className="block text-slate-500">
            {hasActiveTrade ? "Entry Px" : "Live Price"}
          </span>
          <p className="w-full rounded-md border border-slate-200 bg-slate-100 px-2 py-1 tabular-nums text-slate-900">
            {entryPrice > 0 ? entryPrice.toFixed(4) : "—"}
          </p>
          {hasActiveTrade && livePrice > 0 && (
            <p className="flex items-center gap-1 text-[10px] tabular-nums text-slate-500">
              <span>Live</span>
              <span className="font-medium text-slate-700">{livePrice.toFixed(4)}</span>
            </p>
          )}
        </div>
        <div className="space-y-1">
          <span className="block text-slate-500">Stop Loss</span>
          <p className="w-full rounded-md border border-slate-200 bg-slate-100 px-2 py-1 tabular-nums text-slate-900">
            {stopLossPrice > 0 ? stopLossPrice.toFixed(4) : "—"}
          </p>
        </div>
        <div className="space-y-1">
          <span className="block text-slate-500">Maker Fee</span>
          <p className="w-full rounded-md border border-slate-200 bg-slate-100 px-2 py-1 tabular-nums text-slate-900">
            {(makerFeeRate * 100).toFixed(4)}%
          </p>
        </div>
        <div className="space-y-1">
          <span className="block text-slate-500">Taker Fee</span>
          <p className="w-full rounded-md border border-slate-200 bg-slate-100 px-2 py-1 tabular-nums text-slate-900">
            {(takerFeeRate * 100).toFixed(4)}%
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onIsLongChange(true)}
          className={`rounded-md px-2 py-1 text-xs font-semibold ${
            isLong ? "bg-emerald-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300"
          }`}
        >
          Long
        </button>
        <button
          type="button"
          onClick={() => onIsLongChange(false)}
          className={`rounded-md px-2 py-1 text-xs font-semibold ${
            !isLong ? "bg-rose-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300"
          }`}
        >
          Short
        </button>
        {hasActiveTrade && (
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
            Active Position
          </span>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
          <p className="text-slate-500">Position Size</p>
          <p className="text-lg font-semibold tabular-nums text-slate-900">{metrics.positionSize.toFixed(6)}</p>
          <p className="mt-1 text-slate-500">Leverage</p>
          <p className="text-lg font-semibold tabular-nums text-slate-900">{metrics.leverage.toFixed(2)}x</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
          <p className="font-semibold text-slate-700">Estimated Total Fees</p>
          <div className="mt-1 grid grid-cols-2 gap-y-1 tabular-nums">
            <span className="text-slate-500">Entry</span>
            <span className="text-right">{fmtUsd(metrics.entryFee)}</span>
            <span className="text-slate-500">Exit</span>
            <span className="text-right">{fmtUsd(metrics.exitFee)}</span>
            <span className="text-slate-500">Total</span>
            <span className="text-right font-semibold">{fmtUsd(metrics.totalFees)}</span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs tabular-nums">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Break-even</span>
            <span className="font-semibold">{metrics.breakEvenPrice.toFixed(4)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-slate-500">Risk Amount</span>
            <span>{fmtUsd(metrics.riskAmount)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-slate-500">Notional</span>
            <span>{fmtUsd(metrics.notionalValue)}</span>
          </div>
        </div>
      </div>
      {warningText && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
          {warningText}
        </p>
      )}
    </aside>
  );
}
