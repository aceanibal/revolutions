const path = require("path");
const { createBacktestRepository, defaultBacktestSqlitePath } = require("../data");

const DEFAULT_CHUNK_SIZE = 1000;

function chunkedWrite(db, rows, chunkSize, insertRow) {
  const size = Math.max(1, Number(chunkSize || DEFAULT_CHUNK_SIZE));
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += size) {
    const chunk = rows.slice(offset, offset + size);
    db.exec("BEGIN");
    try {
      for (const row of chunk) {
        insertRow(row);
        inserted += 1;
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return inserted;
}

function normalizeSessionId(value) {
  return String(value || "").trim();
}

function assertHistoricalSession(db, sessionId) {
  const row = db
    .prepare("SELECT id, session_type FROM sessions WHERE id = ? LIMIT 1")
    .get(sessionId);
  if (!row) throw new Error(`Historical session not found: ${sessionId}`);
  const sessionType = String(row.session_type || "live");
  if (sessionType !== "historical") {
    throw new Error(`Session ${sessionId} is not historical`);
  }
}

function createHistoricalSession(options = {}) {
  const sessionId = normalizeSessionId(options.id || options.sessionId);
  if (!sessionId) throw new Error("createHistoricalSession: id is required");

  const startMs = Number(options.startMs || Date.now());
  const endMs = Number(options.endMs || startMs);
  const symbols = Array.isArray(options.symbols) ? options.symbols.map((s) => String(s || "").trim()).filter(Boolean) : [];
  const metadata = options.metadata && typeof options.metadata === "object" ? options.metadata : null;
  const repo = createBacktestRepository({ sqlitePath: options.destSqlitePath || defaultBacktestSqlitePath() });
  try {
    const activeStreamsJson = symbols.length ? JSON.stringify(symbols) : "";
    repo.db.exec("BEGIN");
    try {
      repo.db
        .prepare(
          `
            INSERT INTO sessions (
              id, market_window_start, market_window_end, started_at_ms, ended_at_ms, session_type, status,
              break_reason, asset_count, tick_count, candle_count, last_saved_at_ms, active_streams_json
            )
            VALUES (?, ?, ?, ?, ?, 'historical', 'importing', NULL, 0, 0, 0, ?, ?)
          `
        )
        .run(sessionId, startMs, endMs, startMs, null, Date.now(), activeStreamsJson);
      if (metadata) {
        repo.db
          .prepare(
            `
              INSERT INTO session_external_metadata (session_id, tool, source_id, payload_json, imported_at_ms)
              VALUES (?, 'historical-import', '', ?, ?)
            `
          )
          .run(sessionId, JSON.stringify(metadata), Date.now());
      }
      repo.db.exec("COMMIT");
    } catch (error) {
      repo.db.exec("ROLLBACK");
      throw error;
    }
    return {
      sessionId,
      sessionType: "historical",
      startMs,
      endMs,
      destSqlitePath: path.resolve(repo.sqlitePath || options.destSqlitePath || defaultBacktestSqlitePath())
    };
  } finally {
    repo.close();
  }
}

function insertCandlesBatch(db, sessionId, rows, options = {}) {
  const id = normalizeSessionId(sessionId);
  if (!id) throw new Error("insertCandlesBatch: sessionId is required");
  if (!Array.isArray(rows) || rows.length === 0) return { sessionId: id, inserted: 0 };
  assertHistoricalSession(db, id);
  const fallbackTimeframe = String(options.timeframe || "").trim();
  const stmt = db.prepare(
    `
      INSERT OR REPLACE INTO session_candles (
        session_id, symbol, timeframe, bucket_start_ms, open, high, low, close, volume, source, is_gap_fill
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'history', 0)
    `
  );
  const inserted = chunkedWrite(db, rows, options.chunkSize, (row) => {
    const timeframe = String(row.timeframe || fallbackTimeframe || "").trim().toLowerCase();
    if (timeframe !== "1m" && timeframe !== "5m") {
      throw new Error(`insertCandlesBatch: invalid timeframe for row ${JSON.stringify(row)}`);
    }
    stmt.run(
      id,
      String(row.symbol || "").trim().toUpperCase(),
      timeframe,
      Number(row.bucketStartMs),
      Number(row.open),
      Number(row.high),
      Number(row.low),
      Number(row.close),
      Number(row.volume || 0)
    );
  });
  return { sessionId: id, inserted };
}

function insertTicksBatch(db, sessionId, rows, options = {}) {
  const id = normalizeSessionId(sessionId);
  if (!id) throw new Error("insertTicksBatch: sessionId is required");
  if (!Array.isArray(rows) || rows.length === 0) return { sessionId: id, inserted: 0 };
  assertHistoricalSession(db, id);
  const stmt = db.prepare(
    `
      INSERT OR REPLACE INTO session_ticks (session_id, symbol, ts_ms, price, size, source)
      VALUES (?, ?, ?, ?, ?, 'history')
    `
  );
  const inserted = chunkedWrite(db, rows, options.chunkSize, (row) => {
    stmt.run(
      id,
      String(row.symbol || "").trim().toUpperCase(),
      Number(row.tsMs),
      Number(row.price),
      Number(row.size || 0)
    );
  });
  return { sessionId: id, inserted };
}

function finalizeHistoricalSession(db, sessionId, options = {}) {
  const id = normalizeSessionId(sessionId);
  if (!id) throw new Error("finalizeHistoricalSession: sessionId is required");
  assertHistoricalSession(db, id);
  const startMs = Number(options.startMs || 0);
  const endMs = Number(options.endMs || Date.now());
  const summary = db
    .prepare(
      `
        SELECT
          COALESCE((SELECT COUNT(*) FROM session_ticks WHERE session_id = ?), 0) AS tick_count,
          COALESCE((SELECT COUNT(*) FROM session_candles WHERE session_id = ?), 0) AS candle_count,
          (
            SELECT COUNT(*) FROM (
              SELECT symbol FROM session_ticks WHERE session_id = ?
              UNION
              SELECT symbol FROM session_candles WHERE session_id = ?
            )
          ) AS asset_count
      `
    )
    .get(id, id, id, id);
  db.prepare(
    `
      UPDATE sessions
      SET
        market_window_start = CASE WHEN ? > 0 THEN ? ELSE market_window_start END,
        market_window_end = CASE WHEN ? > 0 THEN ? ELSE market_window_end END,
        ended_at_ms = ?,
        status = 'imported',
        asset_count = ?,
        tick_count = ?,
        candle_count = ?,
        last_saved_at_ms = ?
      WHERE id = ? AND session_type = 'historical'
    `
  ).run(
    startMs,
    startMs,
    endMs,
    endMs,
    endMs,
    Number(summary.asset_count || 0),
    Number(summary.tick_count || 0),
    Number(summary.candle_count || 0),
    Date.now(),
    id
  );
  return {
    sessionId: id,
    assetCount: Number(summary.asset_count || 0),
    tickCount: Number(summary.tick_count || 0),
    candleCount: Number(summary.candle_count || 0),
    status: "imported"
  };
}

function deleteHistoricalSession(db, sessionId) {
  const id = normalizeSessionId(sessionId);
  if (!id) throw new Error("deleteHistoricalSession: sessionId is required");
  const row = db.prepare("SELECT session_type FROM sessions WHERE id = ? LIMIT 1").get(id);
  if (!row) return { sessionId: id, deleted: false };
  if (String(row.session_type || "live") !== "historical") {
    throw new Error(`Session ${id} is not historical`);
  }
  const tables = [
    "session_ticks",
    "session_candles",
    "session_notes",
    "session_trades",
    "session_trade_state",
    "session_external_metadata",
    "sessions"
  ];
  db.exec("BEGIN");
  try {
    for (const table of tables) {
      const idColumn = table === "sessions" ? "id" : "session_id";
      db.prepare(`DELETE FROM ${table} WHERE ${idColumn} = ?`).run(id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { sessionId: id, deleted: true };
}

module.exports = {
  createHistoricalSession,
  insertCandlesBatch,
  insertTicksBatch,
  finalizeHistoricalSession,
  deleteHistoricalSession
};
