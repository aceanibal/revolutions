import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type { Candle } from "../types";

let sqlPromise: Promise<SqlJsStatic> | null = null;

function getSqlJs() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => `https://sql.js.org/dist/${file}`
    });
  }
  return sqlPromise;
}

function uniqueCandidates(symbol: string): string[] {
  const upper = symbol.toUpperCase();
  const short = upper.replace(/USDT$/i, "");
  const plusUsdt = short.endsWith("USDT") ? short : `${short}USDT`;
  return Array.from(new Set([upper, short, plusUsdt].filter(Boolean)));
}

function parseRows(values: Array<Array<string | number | null>>): Candle[] {
  return values
    .map((row) => {
      const timeMs = Number(row[0]);
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      const volume = Number(row[5] ?? 0);
      if (!Number.isFinite(timeMs) || ![open, high, low, close].every(Number.isFinite)) return null;
      return { timeMs, open, high, low, close, volume };
    })
    .filter((row): row is Candle => row !== null)
    .sort((a, b) => a.timeMs - b.timeMs);
}

/** Same bucket can appear in multiple historical imports; keep first row (stable order by session_id in SQL). */
function dedupeByTimeMs(candles: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of candles) {
    if (!byTime.has(c.timeMs)) byTime.set(c.timeMs, c);
  }
  return Array.from(byTime.values()).sort((a, b) => a.timeMs - b.timeMs);
}

/** Match backtester historicalImporter: finalized session + history-sourced bars only. */
const HISTORICAL_5M_SQL = `SELECT sc.bucket_start_ms, sc.open, sc.high, sc.low, sc.close, sc.volume
       FROM session_candles sc
       INNER JOIN sessions s ON s.id = sc.session_id
       WHERE sc.timeframe = '5m'
         AND s.session_type = 'historical'
         AND s.status = 'imported'
         AND sc.source = 'history'
         AND sc.symbol = ?`;

function runQuery(db: Database, sql: string, params: Array<string | number>): Candle[] {
  const stmt = db.prepare(sql, params);
  const rows: Array<Array<string | number | null>> = [];
  while (stmt.step()) {
    rows.push(stmt.get() as Array<string | number | null>);
  }
  stmt.free();
  return parseRows(rows);
}

export async function openSqliteFile(file: File): Promise<Database> {
  const SQL = await getSqlJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  return new SQL.Database(bytes);
}

export function closeSqlite(db: Database | null) {
  if (db) db.close();
}

export function queryFiveMinuteRange(
  db: Database,
  symbol: string,
  fromMs: number,
  toMs: number
): Candle[] {
  const symbols = uniqueCandidates(symbol);
  for (const candidate of symbols) {
    const rows = dedupeByTimeMs(
      runQuery(
        db,
        `${HISTORICAL_5M_SQL}
         AND sc.bucket_start_ms >= ?
         AND sc.bucket_start_ms <= ?
       ORDER BY sc.bucket_start_ms ASC, sc.session_id ASC`,
        [candidate, Math.floor(fromMs), Math.floor(toMs)]
      )
    );
    if (rows.length > 0) return rows;
  }
  return [];
}

export function queryFiveMinuteForSymbol(db: Database, symbol: string): Candle[] {
  const symbols = uniqueCandidates(symbol);
  for (const candidate of symbols) {
    const rows = dedupeByTimeMs(
      runQuery(db, `${HISTORICAL_5M_SQL} ORDER BY sc.bucket_start_ms ASC, sc.session_id ASC`, [candidate])
    );
    if (rows.length > 0) return rows;
  }
  return [];
}
