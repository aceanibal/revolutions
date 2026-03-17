import { useEffect, useState } from "react";

// ---- Contract types (from FRONTEND_CONTRACT.md) ----

export interface LiveMonitorRow {
  coin: string;
  spreadPct: number;
  bidDepth: number;
  askDepth: number;
  totalDepth: number;
  delta: number;
  imbalancePct: number;
  isSpreadOk: boolean;
  isDirectionStrong: boolean;
  score: number;
}

export interface LiveMonitorUpdateMessage {
  type: "live-monitor.update";
  version: 1;
  snapshotMode: "preopen" | "live";
  asOf: string; // ISO8601
  rows: LiveMonitorRow[];
}

export interface HelloMessage {
  type: "hello";
  version: 1;
  snapshotMode: "preopen" | "live";
  message: string;
}

export type LiveMonitorMessage = LiveMonitorUpdateMessage | HelloMessage;

export interface RvolResultRow {
  asset: string;
  rvol: number;
  current12hVolumeUsd: number;
  dayNtlVlm: number | null;
  openInterest: number | null;
  funding: number | null;
  price: number | null;
  btcCorr: number | null;
  runTimestamp: number;
}

export interface LatestRvolReport {
  tradingDate: string; // YYYY-MM-DD (ET trading date)
  snapshotMode: "preopen" | "live";
  generatedAt: number; // ms since epoch
  results: RvolResultRow[];
}

// ---- Hooks ----

export function useLiveMonitor(url: string) {
  const [rows, setRows] = useState<LiveMonitorRow[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closedByUser = false;

    function connect() {
      ws = new WebSocket(url);

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onclose = () => {
        setConnected(false);
        if (!closedByUser) {
          setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };

      ws.onmessage = (event) => {
        try {
          const msg: LiveMonitorMessage = JSON.parse(event.data);

          if (msg.version !== 1) {
            // Forward compatible: ignore unknown versions but surface a console hint.
            // eslint-disable-next-line no-console
            console.warn?.("Unexpected live-monitor message version", msg.version);
          }

          if (msg.type === "live-monitor.update") {
            const sorted = [...msg.rows].sort((a, b) => b.score - a.score);
            setRows(sorted);
            setAsOf(msg.asOf);
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("Failed to parse live-monitor message", e);
        }
      };
    }

    connect();

    return () => {
      closedByUser = true;
      ws?.close();
    };
  }, [url]);

  return { rows, asOf, connected };
}

export function useLatestRvolReport(url: string) {
  const [report, setReport] = useState<LatestRvolReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as LatestRvolReport;
        if (!cancelled) {
          setReport(json);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? "Unknown error");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    const id = setInterval(load, 60_000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [url]);

  return { report, loading, error };
}

