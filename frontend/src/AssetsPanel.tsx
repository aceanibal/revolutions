import { useEffect, useMemo, useState } from "react";
import type { StreamsState } from "./lib/api";
import {
  fetchActiveStreams,
  fetchPerpSymbols,
  addStream,
  removeStream,
  setPrimarySymbol
} from "./lib/api";
import type { LatestRvolReport, RvolResultRow } from "./lib/rvolContract";
import { useLatestRvolReport } from "./lib/rvolContract";

type SnapshotMode = "preopen" | "live";

interface AssetsPanelProps {
  snapshotMode: SnapshotMode;
  onSelectAsset?: (asset: string) => void;
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

function indexByAsset(report: LatestRvolReport | null): Record<string, RvolResultRow> {
  if (!report || !Array.isArray(report.results)) return {};
  return report.results.reduce<Record<string, RvolResultRow>>((acc, row) => {
    acc[row.asset.toUpperCase()] = row;
    return acc;
  }, {});
}

export function AssetsPanel({ snapshotMode, onSelectAsset }: AssetsPanelProps) {
  const [streams, setStreams] = useState<StreamsState | null>(null);
  const [streamsError, setStreamsError] = useState<string | null>(null);
  const [perpSymbols, setPerpSymbols] = useState<string[] | null>(null);
  const [pendingAdd, setPendingAdd] = useState<string>("");

  const httpUrl = `http://localhost:4000/api/latest-report?snapshotMode=${snapshotMode}`;
  const { report, loading, error } = useLatestRvolReport(httpUrl);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [active, perps] = await Promise.all([
          fetchActiveStreams(),
          fetchPerpSymbols()
        ]);
        if (cancelled) return;
        setStreams(active);
        setPerpSymbols(perps);
      } catch (e: any) {
        if (!cancelled) {
          setStreamsError(e?.message ?? "Failed to load subscribed assets");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const reportByAsset = useMemo(() => indexByAsset(report), [report]);

  const subscribedSymbols = streams?.symbols ?? [];

  const handleAddStream = async () => {
    if (!pendingAdd) return;
    const symbol = pendingAdd.toUpperCase();
    try {
      const updated = await addStream(symbol);
      if (updated) {
        setStreams({
          symbols: updated.symbols.map((s) => String(s).toUpperCase()),
          primary: String(updated.primary).toUpperCase()
        });
      }
    } catch {
      // swallow; streamsError is for initial load only
    } finally {
      setPendingAdd("");
    }
  };

  const handleRemoveStream = async (symbol: string) => {
    try {
      const updated = await removeStream(symbol);
      if (updated) {
        setStreams({
          symbols: updated.symbols.map((s) => String(s).toUpperCase()),
          primary: String(updated.primary).toUpperCase()
        });
      }
    } catch {
      // ignore
    }
  };

  const handleMakePrimary = async (symbol: string) => {
    try {
      const updatedSymbol = await setPrimarySymbol(symbol);
      if (updatedSymbol && streams) {
        setStreams({
          symbols: streams.symbols,
          primary: updatedSymbol.toUpperCase()
        });
      }
    } catch {
      // ignore
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <header className="flex flex-col gap-3 border-b border-slate-100 pb-4">
        <h2 className="text-lg font-semibold leading-6 text-slate-900">Streams &amp; assets</h2>
        <p className="text-xs text-slate-500">
          Manage which perps are streaming, highlight your primary, and jump any asset into the
          Trade chart.
        </p>
      </header>

      <div className="mt-4 space-y-4 text-xs text-slate-600">
        {streamsError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            Error: {streamsError}
          </div>
        )}
        {loading && <div>Loading latest RVOL report…</div>}
        {error && !loading && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            Error: {error}
          </div>
        )}

        <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Add symbol to streams
              </h3>
              <p className="text-[11px] text-slate-500">
                Choose a perp from the universe and add it to your streaming set.
              </p>
            </div>
            <div className="flex flex-col gap-2 text-xs sm:flex-row sm:items-center">
              <select
                value={pendingAdd}
                onChange={(e) => setPendingAdd(e.target.value)}
                className="block w-full cursor-pointer rounded-md border-slate-200 bg-white py-1.5 pl-3 pr-8 text-xs text-slate-900 shadow-sm outline-none ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-slate-900 sm:w-48"
              >
                <option value="">Select symbol…</option>
                {perpSymbols?.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAddStream}
                disabled={!pendingAdd}
                className="inline-flex cursor-pointer items-center justify-center rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-50 shadow-sm ring-1 ring-slate-900/10 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-100 disabled:ring-0"
              >
                Add to streams
              </button>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Streaming assets
          </h3>
          <div className="mt-2 flex flex-wrap gap-3">
            {subscribedSymbols.length === 0 ? (
              <span className="text-xs text-slate-500">
                No subscribed assets yet. Add a symbol above to start streaming.
              </span>
            ) : (
              subscribedSymbols.map((symbol) => {
                const isPrimary = streams?.primary === symbol;
                return (
                  <div
                    key={symbol}
                    className={`flex w-auto min-w-[6rem] flex-col items-center gap-1 rounded-2xl border px-3 py-2 text-xs shadow-sm ${
                      isPrimary
                        ? "border-slate-900 bg-slate-900 text-slate-50"
                        : "border-slate-200 bg-white text-slate-900"
                    }`}
                  >
                    <button
                      type="button"
                      className={`cursor-pointer text-sm font-semibold ${
                        isPrimary ? "text-slate-50" : "text-slate-900 hover:text-slate-700"
                      }`}
                      onClick={() => onSelectAsset?.(symbol)}
                    >
                      {symbol}
                    </button>
                    {isPrimary && (
                      <span className="rounded-full bg-slate-50/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                        Primary
                      </span>
                    )}
                    <div className="mt-1 flex flex-wrap items-center justify-center gap-1 text-[10px]">
                      {!isPrimary && (
                        <button
                          type="button"
                          className="cursor-pointer rounded-full bg-slate-900 px-2 py-0.5 font-semibold text-slate-50 ring-1 ring-slate-900/10 hover:bg-slate-800"
                          onClick={() => handleMakePrimary(symbol)}
                        >
                          Make primary
                        </button>
                      )}
                      <button
                        type="button"
                        className={`cursor-pointer rounded-full px-2 py-0.5 font-semibold ring-1 ${
                          isPrimary
                            ? "bg-slate-50/10 text-slate-50 ring-slate-50/20"
                            : "bg-white text-slate-900 ring-slate-200 hover:bg-slate-50"
                        }`}
                        onClick={() => onSelectAsset?.(symbol)}
                      >
                        View on chart
                      </button>
                      <button
                        type="button"
                        className={`cursor-pointer rounded-full px-2 py-0.5 font-semibold ring-1 ${
                          isPrimary
                            ? "bg-slate-50/10 text-slate-50/80 ring-slate-50/20"
                            : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50 hover:text-slate-700"
                        }`}
                        onClick={() => handleRemoveStream(symbol)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
          <div className="overflow-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-slate-500">
                    Asset
                  </th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">
                    In RVOL report
                  </th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">
                    RVOL
                  </th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">
                    12h Vol (USD)
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
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {subscribedSymbols.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-8 text-center text-xs text-slate-500"
                    >
                      No subscribed assets yet. Add streams from the Trade tab or Live Monitor.
                    </td>
                  </tr>
                ) : (
                  subscribedSymbols.map((symbol) => {
                    const key = symbol.toUpperCase();
                    const row = reportByAsset[key];
                    const inUniverse =
                      !perpSymbols || perpSymbols.includes(key.toUpperCase());

                    return (
                      <tr key={symbol} className="hover:bg-slate-50/80">
                        <td className="px-3 py-2 text-sm font-semibold text-slate-900">
                          {symbol}
                          {!inUniverse && (
                            <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
                              Not in meta
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {row ? (
                            <span className="inline-flex items-center justify-end gap-1 text-emerald-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              <span>Yes</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center justify-end gap-1 text-slate-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                              <span>No</span>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                          {row ? `${row.rvol.toFixed(2)}x` : "-"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {row ? formatUsd(row.current12hVolumeUsd) : "-"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {row ? formatUsd(row.openInterest) : "-"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {row ? formatPercent(row.funding) : "-"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {row && row.price != null && Number.isFinite(row.price)
                            ? row.price.toFixed(4)
                            : "-"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-50 shadow-sm ring-1 ring-slate-900/10 transition hover:bg-slate-800"
                            onClick={() => onSelectAsset?.(symbol)}
                          >
                            View on chart
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

