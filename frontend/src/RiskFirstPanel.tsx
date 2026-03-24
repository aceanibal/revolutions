import type { RiskFirstMetrics } from "./lib/riskCalculator";
import type { TradeStateSnapshot } from "./types";

function fmtUsd(v: number | undefined | null): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "$0.00";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

interface RiskFirstPanelProps {
  accountBalance: number;
  riskPercentage: number;
  takeProfitPercentage: number;
  takeProfitPrice: number | null;
  entryPrice: number;
  controllerStopLossPrice: number;
  exchangeStopLossPrice: number | null;
  exchangeTakeProfitPrice: number | null;
  hasStopMismatch: boolean;
  isLong: boolean;
  takerFeeRate: number;
  metrics: RiskFirstMetrics;
  warningText: string | null;
  tradeState: TradeStateSnapshot | null;
  saveState: "idle" | "saving" | "saved" | "error";
  saveMessage: string | null;
  onRiskPercentageChange: (value: number) => void;
  onTakeProfitPercentageChange: (value: number) => void;
  onSaveSettings: () => void;
}

export function RiskFirstPanel({
  accountBalance,
  riskPercentage,
  takeProfitPercentage,
  takeProfitPrice,
  entryPrice,
  controllerStopLossPrice,
  exchangeStopLossPrice,
  exchangeTakeProfitPrice,
  hasStopMismatch,
  isLong,
  takerFeeRate,
  metrics,
  warningText,
  tradeState,
  saveState,
  saveMessage,
  onRiskPercentageChange,
  onTakeProfitPercentageChange,
  onSaveSettings
}: RiskFirstPanelProps) {
  const noBalanceWarning =
    !Number.isFinite(accountBalance) || accountBalance <= 0
      ? "No account balance — deposit funds or check live account connectivity."
      : null;
  const noStopLossWarning =
    !Number.isFinite(controllerStopLossPrice) || controllerStopLossPrice <= 0
      ? "Set a stop loss before trading (F9 or drag on chart)."
      : null;
  const minNotionalWarning =
    Number.isFinite(metrics.notionalValue) && metrics.notionalValue > 0 && metrics.notionalValue < 10
      ? `Position value (${fmtUsd(metrics.notionalValue)}) is below exchange minimum ($10.00).`
      : null;

  const stopMismatchWarning = hasStopMismatch
    ? "Resting exchange stop differs from your controller stop; sizing and preview use the controller level."
    : null;
  const effectiveWarnings = [warningText, noBalanceWarning, noStopLossWarning, minNotionalWarning, stopMismatchWarning].filter(
    Boolean
  ) as string[];
  const status = tradeState?.status || "FLAT";
  const controllerStop = Number.isFinite(controllerStopLossPrice) && controllerStopLossPrice > 0 ? controllerStopLossPrice : null;
  const exchangeStop =
    status !== "FLAT" && Number.isFinite(Number(exchangeStopLossPrice ?? 0)) && Number(exchangeStopLossPrice ?? 0) > 0
      ? Number(exchangeStopLossPrice)
      : null;
  const exchangeTp =
    status !== "FLAT" &&
    Number.isFinite(Number(exchangeTakeProfitPrice ?? 0)) &&
    Number(exchangeTakeProfitPrice ?? 0) > 0
      ? Number(exchangeTakeProfitPrice)
      : null;
  const statusTone =
    status === "OPEN"
      ? "bg-emerald-100 text-emerald-700"
      : status === "PENDING_OPEN" || status === "PENDING_CLOSE"
        ? "bg-amber-100 text-amber-700"
        : status === "ERROR"
          ? "bg-rose-100 text-rose-700"
          : "bg-slate-100 text-slate-700";
  const executionMeta = status === "FLAT" ? null : tradeState?.executionMeta || null;
  const entryRequested = Number(executionMeta?.entryPxRequested ?? 0);
  const filledEntry = Number(executionMeta?.entryPxFilled ?? 0);
  const slippageRequested = Number(executionMeta?.slippageBpsRequested ?? 0);
  const stopRequested = Number(executionMeta?.stopLossRequested ?? 0);
  const stopPlaced = Number(executionMeta?.stopLossPlaced ?? 0);
  const stopOrderRef = tradeState?.stopOrderRef || null;
  const showStopPlaced = Number.isFinite(stopPlaced) && stopPlaced > 0 && (exchangeStop == null || Math.abs(stopPlaced - exchangeStop) > 1e-6);
  const hasExecutionContext =
    status !== "FLAT" &&
    (Number.isFinite(entryRequested) && entryRequested > 0 ||
      Number.isFinite(filledEntry) && filledEntry > 0 ||
      Number.isFinite(slippageRequested) && slippageRequested > 0 ||
      Number.isFinite(stopRequested) && stopRequested > 0 ||
      showStopPlaced ||
      Boolean(stopOrderRef));
  const projectionSourceText = controllerStop != null
    ? `Sizing uses controller stop ${controllerStop.toFixed(4)} + live price + taker fees`
    : "Sizing needs a controller stop from HUD (drag or F9)";

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
        <label className="space-y-1">
          <span className="block text-slate-500">Take Profit %</span>
          <input
            type="number"
            min={0.1}
            max={100}
            step={0.1}
            value={takeProfitPercentage}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next)) return;
              onTakeProfitPercentageChange(next);
            }}
            onBlur={(e) => {
              const raw = Number(e.target.value);
              const clamped = Number.isFinite(raw) ? Math.min(100, Math.max(0.1, raw)) : 2;
              onTakeProfitPercentageChange(clamped);
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
          <span className="block text-slate-500" title="Controller/HUD stop used for sizing, leverage preview, and fee projection">
            Stop Loss
          </span>
          <p className="w-full rounded-md border border-slate-200 bg-slate-100 px-2 py-1 tabular-nums text-slate-900">
            {controllerStop != null ? controllerStop.toFixed(4) : "—"}
          </p>
        </div>
        <div className="space-y-1">
          <span className="block text-slate-500" title="Risk projection assumes taker on entry and stop execution">
            Taker Fee
          </span>
          <p className="w-full rounded-md border border-slate-200 bg-slate-100 px-2 py-1 tabular-nums text-slate-900">
            {(takerFeeRate * 100).toFixed(4)}%
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSaveSettings}
          disabled={saveState === "saving"}
          className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saveState === "saving" ? "Saving..." : "Save"}
        </button>
        {saveMessage ? (
          <span className={`text-xs ${saveState === "error" ? "text-rose-700" : "text-slate-600"}`}>{saveMessage}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            isLong ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
          }`}
        >
          {isLong ? "Long" : "Short"}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusTone}`}>
          {status}
        </span>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
        <p className="font-semibold text-slate-700">Active Trade</p>
      </div>
      <div className="grid gap-2 rounded-lg border border-slate-200 bg-white p-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-slate-500">Tracked Entry</p>
          <p className="font-semibold tabular-nums text-slate-900">
            {Number(tradeState?.entryPx ?? 0) > 0 ? Number(tradeState?.entryPx).toFixed(4) : "—"}
          </p>
        </div>
        <div>
          <p className="text-slate-500">Tracked Size</p>
          <p className="font-semibold tabular-nums text-slate-900">
            {Number(tradeState?.size ?? 0) > 0 ? Number(tradeState?.size).toFixed(6) : "—"}
          </p>
        </div>
        <div>
          <p className="text-slate-500">Stop (from orders)</p>
          <p className="font-semibold tabular-nums text-slate-900" title="tradeState.stopLossFromPendingOrders — navy dashed chart line">
            {exchangeStop != null ? exchangeStop.toFixed(4) : "—"}
          </p>
        </div>
        <div>
          <p className="text-slate-500">Take profit (from orders)</p>
          <p
            className="font-semibold tabular-nums text-emerald-800"
            title="tradeState.takeProfitFromPendingOrders — emerald dashed chart line"
          >
            {exchangeTp != null ? exchangeTp.toFixed(4) : "—"}
          </p>
        </div>
      </div>

      {hasExecutionContext ? (
        <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
          <p className="font-semibold text-slate-700">Execution Context</p>
          <div className="mt-1 grid grid-cols-2 gap-y-1 tabular-nums">
            {Number.isFinite(entryRequested) && entryRequested > 0 ? (
              <>
                <span className="text-slate-500">Requested Entry</span>
                <span className="text-right">{entryRequested.toFixed(4)}</span>
              </>
            ) : null}
            {Number.isFinite(filledEntry) && filledEntry > 0 ? (
              <>
                <span className="text-slate-500">Filled Entry</span>
                <span className="text-right">{filledEntry.toFixed(4)}</span>
              </>
            ) : null}
            {Number.isFinite(slippageRequested) && slippageRequested > 0 ? (
              <>
                <span className="text-slate-500">Requested Slippage</span>
                <span className="text-right">{slippageRequested} bps</span>
              </>
            ) : null}
            {Number.isFinite(stopRequested) && stopRequested > 0 ? (
              <>
                <span className="text-slate-500">Stop Requested</span>
                <span className="text-right">{stopRequested.toFixed(4)}</span>
              </>
            ) : null}
            {showStopPlaced ? (
              <>
                <span className="text-slate-500">Stop Placed</span>
                <span className="text-right">{stopPlaced.toFixed(4)}</span>
              </>
            ) : null}
            {stopOrderRef ? (
              <>
                <span className="text-slate-500">Stop Order Ref</span>
                <span className="text-right">{`a:${stopOrderRef.asset} o:${stopOrderRef.oid}`}</span>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
        <p className="font-semibold text-slate-700">Risk Projection</p>
        <p className="text-[10px] uppercase tracking-wide text-slate-500">{projectionSourceText}</p>
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
          <div className="mt-1 flex items-center justify-between">
            <span className="text-slate-500">Take-Profit Target</span>
            <span>{takeProfitPrice && takeProfitPrice > 0 ? takeProfitPrice.toFixed(4) : "—"}</span>
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
