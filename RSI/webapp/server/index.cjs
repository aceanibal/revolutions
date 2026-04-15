const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const PORT = Number(process.env.RSI_WEBAPP_API_PORT || 3006);
const RSI_ROOT = path.resolve(__dirname, "..", "..");
const RUNS_DIR = path.join(RSI_ROOT, "runs");
const DEFAULT_DB_PATH = path.resolve(
  process.env.RSI_WEBAPP_DB_PATH || path.join(__dirname, "..", "..", "..", "backtester", "data", "backtest.sqlite")
);

const FOUR_H_MS = 4 * 60 * 60 * 1000;

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((cell) => cell.trim());
}

function parseTradeCsv(content) {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      const raw = cols[idx] ?? "";
      const lower = h.toLowerCase();
      if (
        lower.includes("price") ||
        lower.includes("risk") ||
        lower.includes("mfe") ||
        lower.includes("lock") ||
        lower.includes("tp_r") ||
        lower.includes("side") ||
        lower.includes("bars") ||
        lower === "baseline_r" ||
        lower === "managed_r" ||
        lower === "stop_init" ||
        lower === "sl_n" ||
        lower === "fee_bps"
      ) {
        row[h] = toNumber(raw);
      } else {
        row[h] = raw;
      }
    });
    if (!row.symbol || !row.entry_ts_utc || !row.exit_ts_utc) continue;
    rows.push(row);
  }
  return rows;
}

function getRunDirectories() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isDirectory()) return false;
      const name = entry.name;
      if (!/^run_/i.test(name)) return false;
      const runDir = path.join(RUNS_DIR, name);
      return fs.existsSync(path.join(runDir, "run_config.json"));
    })
    .map((entry) => {
      const runId = entry.name;
      const runDir = path.join(RUNS_DIR, runId);
      const stat = fs.statSync(runDir);
      return { runId, runDir, updatedAtMs: stat.mtimeMs };
    })
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

function resolveRun(runIdRaw) {
  const runId = String(runIdRaw || "").trim();
  const runs = getRunDirectories();
  const chosen = runId ? runs.find((item) => item.runId === runId) : runs[0];
  if (!chosen) throw new Error("No run folders found in RSI/runs.");
  const runDir = chosen.runDir;

  const configPath = path.join(runDir, "run_config.json");
  if (!fs.existsSync(configPath)) throw new Error(`Missing run_config.json in ${runDir}`);
  const runConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const tradesDir = path.join(runDir, "trades");
  if (!fs.existsSync(tradesDir)) throw new Error(`Missing trades directory in ${runDir}`);
  /** V1: trade_details_v1_tp8p0.csv · V1fix: trade_details_v1fix_tp8p0.csv (skips *_all_tp.csv) */
  const tradeFiles = fs
    .readdirSync(tradesDir)
    .filter((name) => /^trade_details_(v1fix|v1)_(tp[0-9p]+)\.csv$/i.test(name))
    .sort();
  if (tradeFiles.length === 0) {
    throw new Error(
      "No trade CSV found. Expected trades/trade_details_v1_tp*.csv or trades/trade_details_v1fix_tp*.csv"
    );
  }
  const tpTrades = {};
  for (const fileName of tradeFiles) {
    const match = fileName.match(/^trade_details_(v1fix|v1)_(tp[0-9p]+)\.csv$/i);
    if (!match) continue;
    const tpTag = match[2].toLowerCase();
    const fullPath = path.join(tradesDir, fileName);
    tpTrades[tpTag] = parseTradeCsv(fs.readFileSync(fullPath, "utf-8"));
  }
  return {
    runId: chosen.runId,
    runFolderName: path.basename(runDir),
    runConfig,
    tpTrades,
    tradeFiles: tradeFiles.map((name) => `trades/${name}`)
  };
}

function symbolCandidates(symbol) {
  const upper = String(symbol || "").trim().toUpperCase();
  const short = upper.replace(/USDT$/i, "");
  const withUsdt = short.endsWith("USDT") ? short : `${short}USDT`;
  return Array.from(new Set([upper, short, withUsdt].filter(Boolean)));
}

const SESSION_FILTER = `
  FROM session_candles sc
  INNER JOIN sessions s ON s.id = sc.session_id
  WHERE sc.timeframe = '5m'
    AND s.session_type = 'historical'
    AND s.status = 'imported'
    AND sc.source = 'history'
    AND sc.symbol = ?
    AND sc.bucket_start_ms >= ?
    AND sc.bucket_start_ms <= ?
`;

/** One row per bucket_start_ms (matches prior JS dedupe: lowest session_id wins). */
function query5mDeduped(db, symbol, lower, upper) {
  const sql = `
    WITH ranked AS (
      SELECT
        sc.bucket_start_ms,
        sc.open,
        sc.high,
        sc.low,
        sc.close,
        sc.volume,
        ROW_NUMBER() OVER (PARTITION BY sc.bucket_start_ms ORDER BY sc.session_id ASC) AS rn
      ${SESSION_FILTER}
    )
    SELECT bucket_start_ms, open, high, low, close, volume
    FROM ranked
    WHERE rn = 1
    ORDER BY bucket_start_ms ASC
  `;
  return db.prepare(sql).all(symbol, lower, upper);
}

/**
 * Aggregate deduped 5m → 4h entirely in SQLite (no multi-million-row JS loop).
 * bucket = floor(ms / 4h) * 4h using integer arithmetic (same as prior JS).
 */
function query4hFrom5m(db, symbol, lower, upper) {
  const sql = `
    WITH ranked AS (
      SELECT
        sc.bucket_start_ms,
        sc.open,
        sc.high,
        sc.low,
        sc.close,
        sc.volume,
        ROW_NUMBER() OVER (PARTITION BY sc.bucket_start_ms ORDER BY sc.session_id ASC) AS rn
      ${SESSION_FILTER}
    ),
    dedup AS (
      SELECT bucket_start_ms, open, high, low, close, volume
      FROM ranked
      WHERE rn = 1
    ),
    marked AS (
      SELECT
        bucket_start_ms,
        (bucket_start_ms / ${FOUR_H_MS}) * ${FOUR_H_MS} AS b4h,
        open,
        high,
        low,
        close,
        volume,
        ROW_NUMBER() OVER (
          PARTITION BY (bucket_start_ms / ${FOUR_H_MS}) * ${FOUR_H_MS}
          ORDER BY bucket_start_ms ASC
        ) AS rn_first,
        ROW_NUMBER() OVER (
          PARTITION BY (bucket_start_ms / ${FOUR_H_MS}) * ${FOUR_H_MS}
          ORDER BY bucket_start_ms DESC
        ) AS rn_last
      FROM dedup
    )
    SELECT
      b4h AS time_ms,
      MAX(CASE WHEN rn_first = 1 THEN open END) AS open,
      MAX(high) AS high,
      MIN(low) AS low,
      MAX(CASE WHEN rn_last = 1 THEN close END) AS close,
      SUM(volume) AS volume
    FROM marked
    GROUP BY b4h
    ORDER BY b4h ASC
  `;
  return db.prepare(sql).all(symbol, lower, upper);
}

function rowsToCandles(rows) {
  return rows
    .map((row) => ({
      timeMs: Number(row.time_ms ?? row.bucket_start_ms),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume ?? 0)
    }))
    .filter((c) => Number.isFinite(c.timeMs));
}

const dbCache = new Map();

function getDb() {
  const dbPath = DEFAULT_DB_PATH;
  if (!fs.existsSync(dbPath)) throw new Error(`SQLite DB not found: ${dbPath}`);
  const stat = fs.statSync(dbPath);
  const hit = dbCache.get(dbPath);
  if (hit && hit.mtimeMs === stat.mtimeMs) {
    return hit.db;
  }
  if (hit) {
    try {
      hit.db.close();
    } catch {
      /* ignore */
    }
    dbCache.delete(dbPath);
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  dbCache.set(dbPath, { mtimeMs: stat.mtimeMs, db });
  return db;
}

function main() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "rsi-webapp-api",
      runsDir: RUNS_DIR,
      dbPath: DEFAULT_DB_PATH,
      dbExists: fs.existsSync(DEFAULT_DB_PATH),
      dbDriver: "better-sqlite3"
    });
  });

  app.get("/api/runs", (_req, res) => {
    try {
      const runs = getRunDirectories();
      const items = runs.map((item) => ({
        id: item.runId,
        updatedAtMs: item.updatedAtMs
      }));
      return res.json({
        ok: true,
        runs: items,
        defaultRunId: items[0]?.id || "",
        dbPath: DEFAULT_DB_PATH,
        dbExists: fs.existsSync(DEFAULT_DB_PATH)
      });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || "Failed to list runs" });
    }
  });

  app.post("/api/run/load", (req, res) => {
    try {
      const payload = resolveRun(req.body?.runId);
      return res.json({ ok: true, ...payload });
    } catch (error) {
      return res.status(400).json({ ok: false, message: error.message || "Failed to load run folder" });
    }
  });

  app.post("/api/candles/query", (req, res) => {
    try {
      const symbol = String(req.body?.symbol || "");
      const timeframe = String(req.body?.timeframe || "5m").toLowerCase();
      const fromMs = toNumber(req.body?.fromMs);
      const toMs = toNumber(req.body?.toMs);
      const db = getDb();

      if (!symbol) {
        return res.status(400).json({ ok: false, message: "symbol is required" });
      }

      const lower = Number.isFinite(fromMs) ? Math.floor(fromMs) : 0;
      const upper = Number.isFinite(toMs) ? Math.floor(toMs) : Date.now();

      let candles = [];
      for (const candidate of symbolCandidates(symbol)) {
        const rows =
          timeframe === "4h" ? query4hFrom5m(db, candidate, lower, upper) : query5mDeduped(db, candidate, lower, upper);
        if (rows.length > 0) {
          candles = rowsToCandles(rows);
          break;
        }
      }

      return res.json({ ok: true, candles });
    } catch (error) {
      return res.status(400).json({ ok: false, message: error.message || "Failed candle query" });
    }
  });

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[rsi-webapp-api] listening on http://localhost:${PORT}`);
  });
}

main();
