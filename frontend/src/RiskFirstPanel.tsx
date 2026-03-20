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
  stopLossPrice: number;
  isLong: boolean;
  makerFeeRate: number;
  takerFeeRate: number;
  metrics: RiskFirstMetrics;
  warningText: string | null;
  onRiskPercentageChange: (value: number) => void;
}

export function RiskFirstPanel({
  accountBalance,
  riskPercentage,
  entryPrice,
  stopLossPrice,
  isLong,
  makerFeeRate,
  takerFeeRate,
  metrics,
  warningText,
  onRiskPercentageChange
}: RiskFirstPanelProps) {
  const noBalanceWarning =
    !Number.isFinite(accountBalance) || accountBalance <= 0
      ? "No account balance — deposit funds or check live account connectivity."
      : null;
  const noStopLossWarning =
    !Number.isFinite(stopLossPrice) || stopLossPrice <= 0
      ? "Set a stop loss before trading (F9 or drag on chart)."
      : null;
  const minNotionalWarning =
    Number.isFinite(metrics.notionalValue) && metrics.notionalValue > 0 && metrics.notionalValue < 10
      ? `Position value (${fmtUsd(metrics.notionalValue)}) is below exchange minimum ($10.00).`
      : null;

  const effectiveWarnings = [warningText, noBalanceWarning, noStopLossWarning, minNotionalWarning].filter(
    Boolean
  ) as string[];

  return (
    <aside className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Risk-First Position Sizing</h3>
        <span className="rounded-full bg-rose-600 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
          Live
        </span>
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
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next)) return;
              onRiskPercentageChange(next);
            }}
            onBlur={(e) => {
              const raw = Number(e.target.value);
              const clamped = Number.isFinite(raw) ? Math.min(100, Math.max(0.1, raw)) : 2;
              onRiskPercentageChange(clamped);
            }}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 tabular-nums outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300"
          />
        </label>
        <div className="space-y-1">
          <span className="block text-slate-500">Live Price</span>
          <p className="w-full rounded-md border border-slate-200 bg-slate-100 px-2 py-1 tabular-nums text-slate-900">
            {entryPrice > 0 ? entryPrice.toFixed(4) : "—"}
          </p>
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
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            isLong ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
          }`}
        >
          {isLong ? "Long" : "Short"}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
          <p className="text-slate-500">Position Size</p>
          <p className="text-lg font-semibold tabular-nums text-slate-900">{metrics.positionSize.toFixed(6)}</p>
          <p className="mt-1 text-slate-500">Leverage</p>
          <p className="text-lg font-semibold tabular-nums text-slate-900">{metrics.leverage.toFixed(2)}x</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
          <p className="font-semibold text-slate-700">Estimated Fees</p>
          <div className="mt-1 grid grid-cols-2 gap-y-1 tabular-nums">
            <span className="text-slate-500">Entry (taker)</span>
            <span className="text-right">{fmtUsd(metrics.entryFee)}</span>
            <span className="text-slate-500">Stop Loss (taker)</span>
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
      {effectiveWarnings.map((warning) => (
        <p key={warning} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
          {warning}
        </p>
      ))}
    </aside>
  );
}
