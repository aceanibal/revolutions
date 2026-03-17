import type { LiveMonitorRow } from "./lib/rvolContract";
import { useLiveMonitor } from "./lib/rvolContract";

interface LiveMonitorPanelProps {
  onSubscribeAsset?: (asset: string) => void;
}

function formatUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  if (value === 0) return "$0";
  const abs = Math.abs(value);
  const formatter = new Intl.NumberFormat("en-US", {
    notation: abs >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: abs >= 1 ? 2 : 4
  });
  return `$${formatter.format(value)}`;
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(2)}%`;
}

function formatIso(iso: string | null): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function LiveMonitorPanel({ onSubscribeAsset }: LiveMonitorPanelProps) {
  const wsUrl = "ws://localhost:4000/ws/live-monitor";
  const { rows, asOf, connected } = useLiveMonitor(wsUrl);

  const handleSubscribe = (asset: string) => {
    if (!asset) return;
    onSubscribeAsset?.(asset.toUpperCase());
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <header className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold leading-6 text-slate-900">RVOL Live Monitor</h2>
          <p className="text-xs text-slate-500">
            Live orderbook breadth, imbalance, and RVOL leaders from your backend.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
          <span
            className={`inline-flex h-2.5 w-2.5 rounded-full ${
              connected ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.25)]" : "bg-slate-300"
            }`}
          />
          <span>{connected ? "Connected" : "Disconnected"}</span>
        </div>
      </header>

      <div className="mt-4">
        <div className="overflow-hidden rounded-xl border border-slate-100 bg-slate-50/60">
          <div className="overflow-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-100/80">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-slate-500">
                    Asset
                  </th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">
                    Spread
                  </th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">
                    Total depth
                  </th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">
                    Delta
                  </th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">
                    Imbalance
                  </th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">
                    Score
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-xs text-slate-500"
                    >
                      No live monitor data yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((row: LiveMonitorRow) => (
                    <tr key={row.coin} className="hover:bg-slate-50/80">
                      <td className="px-3 py-2 text-sm font-semibold text-slate-900">
                        {row.coin}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {formatPercent(row.spreadPct)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {formatUsd(row.totalDepth)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {formatUsd(row.delta)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {formatPercent(row.imbalancePct)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                        {row.score.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center rounded-full px-3 py-1 text-xs font-semibold shadow-sm ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 bg-slate-900 text-slate-50 ring-slate-900/10 hover:bg-slate-800"
                          onClick={() => handleSubscribe(row.coin)}
                        >
                          Subscribe
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-2 text-right text-[11px] text-slate-500">
          <span className="font-medium">As of</span>{" "}
          <span className="tabular-nums">{formatIso(asOf)}</span>
        </div>
      </div>
    </section>
  );
}

