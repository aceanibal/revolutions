import type { Candle, RunListItem, RunUploadData } from "../types";

const jsonHeaders = { "Content-Type": "application/json" };

/** In dev, set VITE_API_ORIGIN=http://127.0.0.1:3006 if the Vite proxy to the API fails. */
function apiPath(path: string): string {
  const origin = import.meta.env.VITE_API_ORIGIN as string | undefined;
  if (origin && String(origin).trim()) {
    return `${String(origin).replace(/\/$/, "")}${path}`;
  }
  return path;
}

export interface RunsPayload {
  ok: boolean;
  runs: RunListItem[];
  defaultRunId: string;
  dbPath: string;
  dbExists: boolean;
  message?: string;
}

export interface HealthPayload {
  ok: boolean;
  service?: string;
  runsDir?: string;
  dbPath?: string;
  dbExists?: boolean;
}

export async function fetchHealth(): Promise<HealthPayload> {
  const res = await fetch(apiPath("/api/health"));
  return (await res.json()) as HealthPayload;
}

export async function fetchRuns(): Promise<RunsPayload> {
  const res = await fetch(apiPath("/api/runs"));
  const data = (await res.json()) as RunsPayload;
  if (!res.ok || !data.ok) {
    throw new Error(data.message || `Failed to list runs (${res.status})`);
  }
  return data;
}

export async function loadRun(runId: string): Promise<RunUploadData> {
  const res = await fetch(apiPath("/api/run/load"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ runId })
  });
  const data = (await res.json()) as { ok: boolean; message?: string } & Partial<RunUploadData>;
  if (!res.ok || !data.ok || !data.tpTrades) {
    throw new Error(data.message || "Failed to load run");
  }
  return data as RunUploadData;
}

export async function fetchCandles(params: {
  symbol: string;
  timeframe: "4h" | "5m";
  fromMs: number;
  toMs: number;
}): Promise<Candle[]> {
  const res = await fetch(apiPath("/api/candles/query"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(params)
  });
  const text = await res.text();
  let data: { ok: boolean; message?: string; candles?: Candle[] };
  try {
    data = JSON.parse(text) as { ok: boolean; message?: string; candles?: Candle[] };
  } catch {
    throw new Error(text.trim() || `Candle query failed (${res.status})`);
  }
  if (!res.ok || !data.ok) {
    throw new Error(data.message || `Candle query failed (${res.status})`);
  }
  return Array.isArray(data.candles) ? data.candles : [];
}
