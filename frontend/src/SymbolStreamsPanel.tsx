import { useEffect, useState } from "react";
import type { StreamsState } from "./lib/api";
import {
  fetchPerpSymbols,
  fetchActiveStreams,
  removeStream,
  setPrimarySymbol
} from "./lib/api";
import { io, Socket } from "socket.io-client";

interface SymbolStreamsPanelProps {
  selectedSymbol: string;
  onSelectedChange: (symbol: string) => void;
  onPrimaryChange?: (primary: string) => void;
  onStreamsChange?: (symbols: string[], primary: string) => void;
  compact?: boolean;
}

let sharedSocket: Socket | null = null;

function getSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = io("/", { path: "/socket.io" });
  }
  return sharedSocket;
}

export function SymbolStreamsPanel({
  selectedSymbol,
  onSelectedChange,
  onPrimaryChange,
  onStreamsChange,
  compact = false
}: SymbolStreamsPanelProps) {
  const [streams, setStreams] = useState<StreamsState>({ symbols: [], primary: selectedSymbol });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [perps, initialStreams] = await Promise.all([
        fetchPerpSymbols(),
        fetchActiveStreams()
      ]);
      if (cancelled) return;

      const normalizedInitial: StreamsState = {
        symbols: initialStreams.symbols.map((s) => String(s).toUpperCase()),
        primary: String(initialStreams.primary || "BTC").toUpperCase()
      };

      setStreams(normalizedInitial);
      const primary = normalizedInitial.primary;
      onPrimaryChange?.(primary);
      onStreamsChange?.(normalizedInitial.symbols, primary);

      // Ensure selected symbol is valid; fallback to primary or first stream.
      const canonicalSelected =
        selectedSymbol ||
        initialStreams.primary ||
        initialStreams.symbols[0] ||
        (perps.length > 0 ? perps[0] : "BTC");
      onSelectedChange(canonicalSelected);
    })();

    const socket = getSocket();
    const handleStreamsUpdate = (payload: StreamsState) => {
      const primary = String(payload.primary).toUpperCase();
      const next: StreamsState = {
        symbols: payload.symbols.map((s) => String(s).toUpperCase()),
        primary
      };

      setStreams(next);
      onPrimaryChange?.(primary);
      onStreamsChange?.(next.symbols, primary);
    };

    socket.on("streams:update", handleStreamsUpdate);

    return () => {
      cancelled = true;
      socket.off("streams:update", handleStreamsUpdate);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRemoveStream = async (symbol: string) => {
    await removeStream(symbol);
    // If we removed the currently selected symbol, shift selection to primary/first.
    if (symbol === selectedSymbol) {
      const next =
        streams.primary === symbol
          ? streams.symbols.find((s) => s !== symbol) || symbol
          : streams.primary;
      if (next && next !== selectedSymbol) {
        onSelectedChange(next);
      }
    }
  };

  const handleSelectSymbol = async (symbol: string) => {
    onSelectedChange(symbol);
    if (symbol === streams.primary) return;
    const updated = await setPrimarySymbol(symbol);
    if (updated) {
      const nextPrimary = updated.toUpperCase();
      setStreams((prev) => ({ ...prev, primary: nextPrimary }));
      onPrimaryChange?.(nextPrimary);
      onStreamsChange?.(streams.symbols, nextPrimary);
      onSelectedChange(nextPrimary);
    }
  };

  return (
    <section
      className={
        compact
          ? "flex h-full flex-col"
          : "flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
      }
    >
      {!compact && (
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-sm font-semibold leading-6 text-slate-900">
              Symbols &amp; Streams
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Manage which perps your backend streams and choose the chart primary.
            </p>
          </div>
          <div className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
            <span className="text-slate-500">Primary</span>
            <span className="tabular-nums text-slate-900">
              {streams.primary || selectedSymbol}
            </span>
          </div>
        </div>
      )}

      <div className={compact ? "" : "mt-4"}>
        <div className={compact ? "flex flex-wrap gap-1.5" : "mt-2 flex flex-wrap gap-2"}>
          {streams.symbols.length === 0 ? (
            <span className="text-xs text-slate-500">No active streams</span>
          ) : (
            streams.symbols.map((s) => {
              const isPrimary = s === streams.primary;
              const isSelected = s === selectedSymbol;
              return (
                <div
                  key={s}
                  className={`group inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    isPrimary
                      ? "border-slate-900 bg-slate-900 text-slate-50 shadow-sm"
                      : "border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300 hover:bg-slate-100"
                  } ${isSelected && !isPrimary ? "ring-1 ring-slate-900/20" : ""}`}
                  onClick={() => {
                    void handleSelectSymbol(s);
                  }}
                >
                  <span className="tabular-nums">{s}</span>
                  {isPrimary && (
                    <span className="rounded-full bg-slate-50/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-100">
                      Primary
                    </span>
                  )}
                  {streams.symbols.length > 1 && (
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold text-slate-300 hover:bg-slate-800/10 hover:text-slate-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveStream(s);
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

