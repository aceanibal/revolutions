import { useCallback, useEffect, useState } from "react";
import {
  fetchAccountOverview,
  fetchAccountFills,
  fetchAccountFees,
  fetchAccountSettings,
  updateAccountSettings
} from "./lib/api";
import type {
  AccountFees,
  AccountFill,
  AccountMode,
  AccountOverview,
  AccountPosition,
  AccountSettings
} from "./types";

function fmtUsd(v: number | undefined | null): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "$0.00";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function fmtPct(v: number | undefined | null, decimals = 4): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "0%";
  return `${n.toFixed(decimals)}%`;
}

function fmtNum(v: number | undefined | null, decimals = 2): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function ModeSection({
  mode,
  symbol
}: {
  mode: AccountMode;
  symbol: string;
}) {
  const [overview, setOverview] = useState<AccountOverview | null>(null);
  const [positions, setPositions] = useState<AccountPosition[]>([]);
  const [fills, setFills] = useState<AccountFill[]>([]);
  const [fees, setFees] = useState<AccountFees | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, fillsRes, feesRes] = await Promise.all([
        fetchAccountOverview(mode),
        fetchAccountFills(mode),
        fetchAccountFees(mode)
      ]);
      if (overviewRes) {
        setOverview(overviewRes.overview);
        setPositions(overviewRes.positions);
      } else {
        setError(`No ${mode} account configured or unreachable`);
      }
      setFills(fillsRes);
      setFees(feesRes);
    } catch {
      setError("Failed to load account data");
    }
    setLoading(false);
  }, [mode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const modeLabel = mode === "live" ? "Live" : "Test";
  const modeDotClass = mode === "live" ? "bg-emerald-500" : "bg-amber-500";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-2.5 w-2.5 rounded-full ${modeDotClass}`} />
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{modeLabel} Account</h3>
        <button
          type="button"
          onClick={() => void refresh()}
          className="ml-auto rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
        >
          Refresh
        </button>
      </div>

      {loading && !overview && (
        <p className="text-xs text-slate-500">Loading...</p>
      )}
      {error && (
        <p className="text-xs text-rose-600">{error}</p>
      )}

      {overview && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Total Balance" value={fmtUsd(overview.accountValue)} />
            <StatCard label="Perps Balance" value={fmtUsd(overview.perpsAccountValue)} />
            <StatCard label="Spot Balance" value={fmtUsd(overview.spotUsdValue)} />
            <StatCard label="Withdrawable" value={fmtUsd(overview.withdrawable)} />
            <StatCard label="Margin Used" value={fmtUsd(overview.totalMarginUsed)} />
            <StatCard label="Notional" value={fmtUsd(overview.totalNtlPos)} />
          </div>
          {overview.spotBalances?.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {overview.spotBalances.map((b) => (
                <span key={b.coin} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] tabular-nums text-slate-700">
                  {b.coin}: {fmtNum(b.total, 2)}{b.hold > 0 ? ` (${fmtNum(b.hold, 2)} held)` : ""}
                </span>
              ))}
            </div>
          )}
          {(overview.spotUsdValue ?? 0) > 0 && (overview.perpsAccountValue ?? 0) === 0 && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
              Funds are in Spot — transfer USDC from Spot to Perps on the Hyperliquid UI (Portfolio &gt; Transfer) to trade with leverage.
            </p>
          )}
        </>
      )}

      {fees && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard label="Maker Fee" value={fmtPct(fees.userAddRate * 100)} />
          <StatCard label="Taker Fee" value={fmtPct(fees.userCrossRate * 100)} />
          <StatCard label="Base Maker" value={fmtPct(fees.baseAdd * 100)} />
          <StatCard label="Base Taker" value={fmtPct(fees.baseCross * 100)} />
        </div>
      )}

      {positions.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Positions</h4>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-2 py-1">Coin</th>
                  <th className="px-2 py-1 text-right">Size</th>
                  <th className="px-2 py-1 text-right">Entry</th>
                  <th className="px-2 py-1 text-right">Value</th>
                  <th className="px-2 py-1 text-right">uPnL</th>
                  <th className="px-2 py-1 text-right">Liq. Price</th>
                  <th className="px-2 py-1 text-right">Leverage</th>
                  <th className="px-2 py-1 text-right">Max Lev.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {positions.map((p) => (
                  <tr key={p.coin} className="hover:bg-slate-50">
                    <td className="px-2 py-1 font-medium">{p.coin}</td>
                    <td className={`px-2 py-1 text-right tabular-nums ${p.szi >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {fmtNum(p.szi, 4)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtNum(p.entryPx)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtUsd(p.positionValue)}</td>
                    <td className={`px-2 py-1 text-right tabular-nums ${p.unrealizedPnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {fmtUsd(p.unrealizedPnl)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{p.liquidationPx != null ? fmtNum(p.liquidationPx) : "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{p.leverage.value}x {p.leverage.type}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{p.maxLeverage}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {fills.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Recent Fills</h4>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-2 py-1">Coin</th>
                  <th className="px-2 py-1">Dir</th>
                  <th className="px-2 py-1 text-right">Price</th>
                  <th className="px-2 py-1 text-right">Size</th>
                  <th className="px-2 py-1 text-right">Fee</th>
                  <th className="px-2 py-1 text-right">PnL</th>
                  <th className="px-2 py-1 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fills.slice(0, 50).map((f, idx) => (
                  <tr key={f.tid ?? idx} className="hover:bg-slate-50">
                    <td className="px-2 py-1 font-medium">{f.coin}</td>
                    <td className={`px-2 py-1 ${f.side === "B" ? "text-emerald-700" : "text-rose-700"}`}>{f.dir || f.side}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtNum(f.px)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtNum(f.sz, 4)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtUsd(f.fee)}</td>
                    <td className={`px-2 py-1 text-right tabular-nums ${f.closedPnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {fmtUsd(f.closedPnl)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-500">
                      {new Date(f.time).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

function SettingsForm() {
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [draft, setDraft] = useState<Partial<AccountSettings>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await fetchAccountSettings();
      if (cancelled) return;
      if (s) {
        setSettings(s);
        setDraft(s);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    const updated = await updateAccountSettings(draft);
    if (updated) {
      setSettings(updated);
      setDraft(updated);
      setFeedback("Saved");
    } else {
      setFeedback("Failed to save");
    }
    setSaving(false);
    setTimeout(() => setFeedback(null), 3000);
  };

  if (!settings) return <p className="text-xs text-slate-500">Loading settings...</p>;

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Account Settings</h4>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-0.5">
          <span className="block text-[10px] font-medium text-slate-500">Risk % of Balance</span>
          <input
            type="number"
            min={0.1}
            max={100}
            step={0.1}
            value={draft.riskPercent ?? settings.riskPercent}
            onChange={(e) => setDraft((d) => ({ ...d, riskPercent: Number(e.target.value) }))}
            className="w-20 rounded-md border border-slate-200 px-2 py-1 text-xs tabular-nums outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300"
          />
        </label>
        <label className="space-y-0.5">
          <span className="block text-[10px] font-medium text-slate-500">Take Profit %</span>
          <input
            type="number"
            min={0.1}
            max={100}
            step={0.1}
            value={draft.takeProfitPercent ?? settings.takeProfitPercent}
            onChange={(e) => setDraft((d) => ({ ...d, takeProfitPercent: Number(e.target.value) }))}
            className="w-20 rounded-md border border-slate-200 px-2 py-1 text-xs tabular-nums outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300"
          />
        </label>
        <label className="space-y-0.5">
          <span className="block text-[10px] font-medium text-slate-500">
            SL Step k (multiplies ATR)
          </span>
          <input
            type="number"
            min={0.01}
            max={1000}
            step={0.01}
            value={draft.stopLossStep ?? settings.stopLossStep}
            onChange={(e) => setDraft((d) => ({ ...d, stopLossStep: Number(e.target.value) }))}
            className="w-20 rounded-md border border-slate-200 px-2 py-1 text-xs tabular-nums outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300"
          />
        </label>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {feedback && (
          <span className="text-xs font-medium text-slate-600">{feedback}</span>
        )}
      </div>
    </div>
  );
}

interface AccountPanelProps {
  symbol: string;
}

export function AccountPanel({ symbol }: AccountPanelProps) {
  return (
    <div className="space-y-8 p-4 sm:p-6">
      <SettingsForm />
      <div className="grid gap-6">
        <ModeSection mode="live" symbol={symbol} />
      </div>
    </div>
  );
}
