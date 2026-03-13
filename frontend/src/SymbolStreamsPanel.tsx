import { useEffect, useMemo, useState } from "react";
import type { StreamsState } from "./lib/api";
import {
  fetchPerpSymbols,
  fetchActiveStreams,
  addStream,
  removeStream,
  setPrimarySymbol
} from "./lib/api";
import { io, Socket } from "socket.io-client";

interface SymbolStreamsPanelProps {
  selectedSymbol: string;
  onSelectedChange: (symbol: string) => void;
  onPrimaryChange?: (primary: string) => void;
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
  onPrimaryChange
}: SymbolStreamsPanelProps) {
  const [allPerps, setAllPerps] = useState<string[]>([]);
  const [streams, setStreams] = useState<StreamsState>({ symbols: [], primary: selectedSymbol });
  const [pendingAdd, setPendingAdd] = useState<string>("");

  // Derived list of symbols that can be added (perps not already streaming).
  const addableSymbols = useMemo(
    () => allPerps.filter((s) => !streams.symbols.includes(s)),
    [allPerps, streams.symbols]
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [perps, initialStreams] = await Promise.all([
        fetchPerpSymbols(),
        fetchActiveStreams()
      ]);
      if (cancelled) return;

      setStreams(initialStreams);
      const primary = String(initialStreams.primary || "BTC").toUpperCase();
      onPrimaryChange?.(primary);

      setAllPerps(perps);

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
      setStreams({
        symbols: payload.symbols.map((s) => String(s).toUpperCase()),
        primary
      });
      onPrimaryChange?.(primary);
    };

    socket.on("streams:update", handleStreamsUpdate);

    return () => {
      cancelled = true;
      socket.off("streams:update", handleStreamsUpdate);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddStream = async () => {
    const symbol = (pendingAdd || addableSymbols[0] || "").toUpperCase();
    if (!symbol) return;
    await addStream(symbol);
    setPendingAdd("");
    // Changes will be reflected via streams:update socket event.
  };

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

  const handleMakePrimary = async (symbol: string) => {
    const updated = await setPrimarySymbol(symbol);
    if (updated) {
      onPrimaryChange?.(updated);
      onSelectedChange(updated);
    }
  };

  const handleSelectSymbol = (symbol: string) => {
    onSelectedChange(symbol);
  };

  return (
    <section className="streams-panel panel">
      <div className="streams-header">
        <h2>Symbols &amp; Streams</h2>
        <div className="primary-label">
          Primary: <strong>{streams.primary || selectedSymbol}</strong>
        </div>
      </div>

      <div className="streams-current">
        <h3>Streaming symbols</h3>
        <div className="streams-list">
          {streams.symbols.length === 0 ? (
            <span className="muted">No active streams</span>
          ) : (
            streams.symbols.map((s) => {
              const isPrimary = s === streams.primary;
              const isSelected = s === selectedSymbol;
              return (
                <div
                  key={s}
                  className={`stream-chip ${isSelected ? "selected" : ""} ${
                    isPrimary ? "primary" : ""
                  }`}
                  onClick={() => handleSelectSymbol(s)}
                >
                  <span className="symbol">{s}</span>
                  {isPrimary && <span className="badge">Primary</span>}
                  <button
                    type="button"
                    className="make-primary-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMakePrimary(s);
                    }}
                  >
                    Make primary
                  </button>
                  {streams.symbols.length > 1 && (
                    <button
                      type="button"
                      className="remove-stream-btn"
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

      <div className="streams-add">
        <h3>Add symbol to stream</h3>
        <div className="streams-add-row">
          <select
            value={pendingAdd}
            onChange={(e) => setPendingAdd(e.target.value)}
            className="streams-select"
          >
            <option value="">Select symbol</option>
            {addableSymbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="button" onClick={handleAddStream} disabled={addableSymbols.length === 0}>
            Add stream
          </button>
        </div>
      </div>
    </section>
  );
}

