const path = require("path");
const express = require("express");
const {
  createBacktestRepository,
  runBacktest,
  importSession,
  listSourceSessions
} = require("./index");
const {
  createHistoricalSession,
  insertCandlesBatch,
  insertTicksBatch,
  finalizeHistoricalSession,
  deleteHistoricalSession
} = require("./import/historicalImporter");
const { runSessionScanner } = require("./scanner/sessionScanner");

const PORT = Number.parseInt(process.env.BACKTESTER_PORT || "3001", 10) || 3001;
const BACKTEST_SQLITE_PATH =
  process.env.BACKTEST_SQLITE_PATH || path.join(__dirname, "data", "backtest.sqlite");

function normalizeSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});

const repo = createBacktestRepository({ sqlitePath: BACKTEST_SQLITE_PATH });

app.get("/api/backtest/health", (_req, res) => {
  res.json({ ok: true, service: "backtester", sqlitePath: BACKTEST_SQLITE_PATH });
});

app.get("/api/backtest/sessions/all", (req, res) => {
  try {
    const sessionTypeRaw = String(req.query?.sessionType || "").trim().toLowerCase();
    const sessionType = sessionTypeRaw === "historical" || sessionTypeRaw === "live" ? sessionTypeRaw : "";
    const all = repo.listSessions({ sessionType });
    const page = Math.max(1, Number.parseInt(String(req.query?.page || "1"), 10) || 1);
    const pageSize = Math.max(1, Math.min(500, Number.parseInt(String(req.query?.pageSize || "100"), 10) || 100));
    const date = String(req.query?.date || "").trim();
    const filtered = date
      ? all.filter((item) => {
          const day = new Date(item.startedAtMs).toISOString().slice(0, 10);
          return day === date;
        })
      : all;
    const total = filtered.length;
    const offset = (page - 1) * pageSize;
    const sessions = filtered.slice(offset, offset + pageSize);
    return res.json({
      ok: true,
      sessions,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to load backtest sessions" });
  }
});

app.get("/api/backtest/import/source-sessions", (req, res) => {
  try {
    const page = Number.parseInt(String(req.query?.page || "1"), 10) || 1;
    const pageSize = Number.parseInt(String(req.query?.pageSize || "50"), 10) || 50;
    const date = String(req.query?.date || "").trim();
    const result = listSourceSessions({ page, pageSize, date: date || undefined });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to list source sessions" });
  }
});

app.post("/api/backtest/import/session", async (req, res) => {
  const sessionId = String(req.body?.sessionId || "").trim();
  if (!sessionId) return res.status(400).json({ ok: false, message: "sessionId is required" });
  try {
    const result = await importSession({ sessionId });
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to import session" });
  }
});

app.post("/api/backtest/import/historical-session", (req, res) => {
  try {
    const id = String(req.body?.id || req.body?.sessionId || "").trim();
    if (!id) return res.status(400).json({ ok: false, message: "id is required" });
    const symbols = Array.isArray(req.body?.symbols) ? req.body.symbols : [];
    const timeframe = String(req.body?.timeframe || "").trim();
    const startMs = Number(req.body?.startMs || Date.now());
    const endMs = req.body?.endMs == null ? null : Number(req.body.endMs);
    const metadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : undefined;
    const result = createHistoricalSession({
      id,
      symbols,
      timeframe,
      startMs,
      endMs: endMs == null ? startMs : endMs,
      metadata
    });
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to create historical session" });
  }
});

app.post("/api/backtest/import/historical-session/:id/candles", (req, res) => {
  const sessionId = String(req.params?.id || "").trim();
  if (!sessionId) return res.status(400).json({ ok: false, message: "Missing session id" });
  try {
    const candles = Array.isArray(req.body?.candles)
      ? req.body.candles
      : Array.isArray(req.body?.rows)
        ? req.body.rows
        : [];
    const timeframe = String(req.body?.timeframe || "").trim();
    const chunkSize = Number(req.body?.chunkSize || 1000);
    const result = insertCandlesBatch(repo.db, sessionId, candles, { timeframe, chunkSize });
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to import candles" });
  }
});

app.post("/api/backtest/import/historical-session/:id/ticks", (req, res) => {
  const sessionId = String(req.params?.id || "").trim();
  if (!sessionId) return res.status(400).json({ ok: false, message: "Missing session id" });
  try {
    const ticks = Array.isArray(req.body?.ticks)
      ? req.body.ticks
      : Array.isArray(req.body?.rows)
        ? req.body.rows
        : [];
    const chunkSize = Number(req.body?.chunkSize || 1000);
    const result = insertTicksBatch(repo.db, sessionId, ticks, { chunkSize });
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to import ticks" });
  }
});

app.post("/api/backtest/import/historical-session/:id/finalize", (req, res) => {
  const sessionId = String(req.params?.id || "").trim();
  if (!sessionId) return res.status(400).json({ ok: false, message: "Missing session id" });
  try {
    const startMs = req.body?.startMs == null ? undefined : Number(req.body.startMs);
    const endMs = req.body?.endMs == null ? undefined : Number(req.body.endMs);
    const result = finalizeHistoricalSession(repo.db, sessionId, { startMs, endMs });
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to finalize historical session" });
  }
});

app.delete("/api/backtest/import/historical-session/:id", (req, res) => {
  const sessionId = String(req.params?.id || "").trim();
  if (!sessionId) return res.status(400).json({ ok: false, message: "Missing session id" });
  try {
    const result = deleteHistoricalSession(repo.db, sessionId);
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to delete historical session" });
  }
});

app.get("/api/backtest/sessions/:id/symbols", (req, res) => {
  const sessionId = String(req.params?.id || "").trim();
  if (!sessionId) return res.status(400).json({ ok: false, message: "Missing session id" });
  try {
    const symbols = repo.listSessionSymbols(sessionId);
    return res.json({ ok: true, sessionId, symbols });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to load symbols" });
  }
});

app.get("/api/backtest/sessions/:id", (req, res) => {
  const sessionId = String(req.params?.id || "").trim();
  const symbol = normalizeSymbol(req.query?.symbol || "");
  const timeframeRaw = String(req.query?.timeframe || "all").toLowerCase();
  const timeframe = timeframeRaw === "1m" || timeframeRaw === "5m" ? timeframeRaw : "all";
  if (!sessionId || !symbol) {
    return res.status(400).json({ ok: false, message: "session id and symbol are required" });
  }
  try {
    const snapshot = repo.getSessionSnapshot(sessionId, symbol, timeframe);
    if (!snapshot) return res.status(404).json({ ok: false, message: "Session not found" });
    const candlesByTimeframe = snapshot.candlesByTimeframe || {};
    const c1 = Array.isArray(candlesByTimeframe["1m"]) ? candlesByTimeframe["1m"].length : 0;
    const c5 = Array.isArray(candlesByTimeframe["5m"]) ? candlesByTimeframe["5m"].length : 0;
    if (timeframe === "all" && c1 === 0 && c5 === 0) {
      console.warn(`[backtester] Snapshot has no candles session=${sessionId} symbol=${symbol}`);
    }
    return res.json({ ok: true, ...snapshot });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to load snapshot" });
  }
});

app.get("/api/backtest/sessions/:id/trades", (req, res) => {
  const sessionId = String(req.params?.id || "").trim();
  if (!sessionId) return res.status(400).json({ ok: false, message: "Missing session id" });
  try {
    const trades = repo.getSessionTrades(sessionId);
    return res.json({ ok: true, sessionId, trades });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to load trades" });
  }
});

app.get("/api/backtest/sessions/:id/ticks", (req, res) => {
  const sessionId = String(req.params?.id || "").trim();
  if (!sessionId) return res.status(400).json({ ok: false, message: "Missing session id" });
  const symbol = normalizeSymbol(req.query?.symbol || "");
  try {
    const ticks = repo.getTicks(sessionId, symbol || "");
    return res.json({ ok: true, sessionId, symbol: symbol || null, ticks });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to load ticks" });
  }
});

app.get("/api/backtest/sessions/:id/scanner-metadata", (req, res) => {
  const sessionId = String(req.params?.id || "").trim();
  if (!sessionId) return res.status(400).json({ ok: false, message: "Missing session id" });
  const tool = String(req.query?.tool || "").trim();
  try {
    const items = repo.listScannerMetadata(sessionId, tool);
    return res.json({ ok: true, sessionId, tool: tool || null, items });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to load scanner metadata" });
  }
});

app.post("/api/backtest/scanner-metadata", (req, res) => {
  const sessionId = String(req.body?.sessionId || "").trim();
  const tool = String(req.body?.tool || "scanner").trim();
  const sourceId = String(req.body?.sourceId || "").trim();
  const payload = req.body?.payload ?? {};
  if (!sessionId) return res.status(400).json({ ok: false, message: "sessionId is required" });
  try {
    repo.importScannerMetadata({ sessionId, tool, sourceId, payload, importedAtMs: Date.now() });
    return res.json({ ok: true, sessionId, tool, sourceId });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to import scanner metadata" });
  }
});

app.post("/api/backtest/scanner/run", (req, res) => {
  const sessionId = String(req.body?.sessionId || "").trim();
  if (!sessionId) return res.status(400).json({ ok: false, message: "sessionId is required" });
  try {
    const result = runSessionScanner(repo, {
      sessionId,
      timeframe: String(req.body?.timeframe || "1m").trim().toLowerCase(),
      anchorTsMs: req.body?.anchorTsMs == null ? 0 : Number(req.body.anchorTsMs),
      lookbackHours: Number(req.body?.lookbackHours || 120),
      currentWindowHours: Number(req.body?.currentWindowHours || 12),
      preferredBtcSymbol: String(req.body?.btcSymbol || "BTC").trim().toUpperCase(),
      featureSet: String(req.body?.featureSet || "rvol-scanner").trim(),
      featureVersion: String(req.body?.featureVersion || "v1").trim()
    });
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to run scanner" });
  }
});

app.get("/api/backtest/sessions/:id/scanner/features", (req, res) => {
  const sessionId = String(req.params?.id || "").trim();
  if (!sessionId) return res.status(400).json({ ok: false, message: "Missing session id" });
  try {
    const rows = repo.listSessionCandleFeatures(sessionId, {
      symbol: normalizeSymbol(req.query?.symbol || ""),
      timeframe: String(req.query?.timeframe || "").trim().toLowerCase(),
      featureSet: String(req.query?.featureSet || "").trim(),
      featureVersion: String(req.query?.featureVersion || "").trim(),
      anchorTsMs: req.query?.anchorTsMs == null ? 0 : Number(req.query.anchorTsMs),
      limit: req.query?.limit == null ? 5000 : Number(req.query.limit)
    });
    return res.json({ ok: true, sessionId, rows });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to load scanner features" });
  }
});

app.post("/api/backtest/run", (req, res) => {
  const sessionId = String(req.body?.sessionId || "").trim();
  const symbol = normalizeSymbol(req.body?.symbol || "");
  const modeRaw = String(req.body?.mode || "mixed").toLowerCase();
  const mode = modeRaw === "tick" || modeRaw === "candle" ? modeRaw : "mixed";
  const timeframeRaw = String(req.body?.timeframe || "1m").toLowerCase();
  const timeframe = timeframeRaw === "5m" ? "5m" : "1m";
  const strategyId = String(req.body?.strategyId || "noop");
  const params = req.body?.params && typeof req.body.params === "object" ? req.body.params : {};
  if (!sessionId || !symbol) {
    return res.status(400).json({ ok: false, message: "sessionId and symbol are required" });
  }
  try {
    const session = repo.getSessionById(sessionId);
    if (!session) {
      return res.status(404).json({ ok: false, message: "Session not found" });
    }
    const candles = repo.getCandles(sessionId, symbol, timeframe);
    const ticks = repo.getTicks(sessionId, symbol);
    const scannerFeatureSet = String(params.scannerFeatureSet || "").trim();
    const scannerFeatureVersion = String(params.scannerFeatureVersion || "").trim();
    const scannerAnchorTsMs = Number(params.scannerAnchorTsMs || 0);
    let enrichedCandles = candles;
    if (scannerFeatureSet) {
      const featureRows = repo.listSessionCandleFeatures(sessionId, {
        symbol,
        timeframe,
        featureSet: scannerFeatureSet,
        featureVersion: scannerFeatureVersion,
        anchorTsMs: scannerAnchorTsMs,
        limit: Math.max(5000, candles.length * 2)
      });
      const featureByBucket = new Map(featureRows.map((row) => [Number(row.bucketStartMs), row.payload]));
      enrichedCandles = candles.map((candle) => {
        const payload = featureByBucket.get(Number(candle.timeMs || 0));
        if (!payload) return candle;
        return {
          ...candle,
          features: {
            [scannerFeatureSet]: payload
          }
        };
      });
    }
    const strategyParams = {
      ...params,
      sessionWindowStartMs: Number(
        session.market_window_start || session.started_at_ms || params.sessionWindowStartMs || 0
      ),
      sessionWindowEndMs: Number(
        session.market_window_end || session.ended_at_ms || params.sessionWindowEndMs || 0
      )
    };
    console.log(
      `[backtester] run request session=${sessionId} symbol=${symbol} mode=${mode} tf=${timeframe} strategy=${strategyId} candles=${candles.length} ticks=${ticks.length}`
    );
    if (candles.length === 0) {
      console.warn(`[backtester] No candles for run session=${sessionId} symbol=${symbol} timeframe=${timeframe}`);
    }
    if (ticks.length === 0) {
      console.warn(`[backtester] No ticks for run session=${sessionId} symbol=${symbol}`);
    }
    const result = runBacktest({
      sessionId,
      symbol,
      timeframe,
      mode,
      strategyId,
      params: strategyParams,
      candles: enrichedCandles,
      ticks
    });
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Failed to run backtest" });
  }
});

const server = app.listen(PORT, () => {
  console.log(`[backtester] API listening on http://localhost:${PORT}`);
  console.log(`[backtester] DB: ${BACKTEST_SQLITE_PATH}`);
});

function shutdown() {
  try {
    repo.close();
  } catch {}
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
