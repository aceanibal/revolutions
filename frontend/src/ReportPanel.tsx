import type { LatestRvolReport, RvolResultRow } from "./lib/rvolContract";
import { useLatestRvolReport } from "./lib/rvolContract";

type SnapshotMode = "preopen" | "live";

interface ReportPanelProps {
  snapshotMode: SnapshotMode;
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

function formatTimestampMs(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "-";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "-";
  }
}

function sortedResults(report: LatestRvolReport | null): RvolResultRow[] {
  if (!report || !Array.isArray(report.results)) return [];
  return [...report.results]
    .filter((r) => Number.isFinite(r.rvol))
    .sort((a, b) => b.rvol - a.rvol);
}

export function ReportPanel({ snapshotMode }: ReportPanelProps) {
  const httpUrl = `http://localhost:4000/api/latest-report?snapshotMode=${snapshotMode}`;
  const { report, loading, error } = useLatestRvolReport(httpUrl);
  const rows = sortedResults(report);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <header className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold leading-6 text-slate-900">RVOL Report</h2>
          <p className="mt-1 text-xs text-slate-500">
            Full latest RVOL snapshot from your backend, sorted by highest relative volume.
          </p>
        </div>
        <div className="flex flex-col items-start gap-1 text-xs text-slate-600 sm:items-end">
          {report && (
            <>
              <span className="inline-flex items-center gap-2">
                <span className="font-medium text-slate-700">Trading date</span>
                <span className="tabular-nums">{report.tradingDate}</span>
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="font-medium text-slate-700">Snapshot</span>
                <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-50">
                  {report.snapshotMode}
                </span>
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="font-medium text-slate-700">Generated</span>
                <span className="tabular-nums">
                  {formatTimestampMs(report.generatedAt)}
                </span>
              </span>
            </>
          )}
        </div>
      </header>

      <div className="mt-4 space-y-3 text-xs text-slate-600">
        {loading && <div>Loading latest report…</div>}
        {error && !loading && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            Error: {error}
          </div>
        )}
        {report && (
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-slate-700">
                {report.results.length} assets in report
              </span>
              <span className="text-[11px] text-slate-500">
                Sorted by RVOL (highest first)
              </span>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
          <div className="overflow-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-slate-500">
                    Asset
                  </th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">
                    RVOL
                  </th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">
                    12h Vol (USD)
                  </th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">
                    Day Notional
                  </th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">
                    Open Interest
                  </th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">
                    Funding
                  </th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">
                    Price
                  </th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">
                    BTC Corr
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-8 text-center text-xs text-slate-500"
                    >
                      No report data available.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.asset} className="hover:bg-slate-50/80">
                      <td className="px-3 py-2 text-sm font-semibold text-slate-900">
                        {row.asset}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                        {row.rvol.toFixed(2)}x
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {formatUsd(row.current12hVolumeUsd)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {formatUsd(row.dayNtlVlm)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {formatUsd(row.openInterest)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {formatPercent(row.funding)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {row.price == null || !Number.isFinite(row.price)
                          ? "-"
                          : row.price.toFixed(4)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {row.btcCorr == null || !Number.isFinite(row.btcCorr)
                          ? "-"
                          : row.btcCorr.toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

