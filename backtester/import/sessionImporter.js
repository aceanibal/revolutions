const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { createBacktestRepository, defaultBacktestSqlitePath, defaultSourceSqlitePath } = require("../data");

const TABLES = [
  "session_ticks",
  "session_candles",
  "session_notes",
  "session_trades",
  "session_trade_state",
  "session_external_metadata",
  "sessions"
];

function deleteSessionRows(db, sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return;
  for (const table of TABLES) {
    const col = table === "sessions" ? "id" : "session_id";
    db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(id);
  }
}

function openSourceDb(sourceSqlitePath) {
  return new DatabaseSync(path.resolve(sourceSqlitePath));
}

function listSourceSessions(options = {}) {
  const sourceSqlitePath = options.sourceSqlitePath || defaultSourceSqlitePath();
  const page = Math.max(1, Number.parseInt(String(options.page || "1"), 10) || 1);
  const pageSize = Math.max(1, Math.min(500, Number.parseInt(String(options.pageSize || "50"), 10) || 50));
  const dateFilter = String(options.date || "").trim();
  const db = openSourceDb(sourceSqlitePath);
  try {
    const where = dateFilter ? "WHERE date(s.started_at_ms / 1000, 'unixepoch') = ?" : "";
    const countSql = `SELECT COUNT(*) AS total FROM sessions s ${where}`;
    const totalRow = dateFilter ? db.prepare(countSql).get(dateFilter) : db.prepare(countSql).get();
    const total = Number(totalRow?.total || 0);
    const offset = (page - 1) * pageSize;
    const sql = `
      SELECT
        s.id,
        s.status,
        s.started_at_ms,
        s.ended_at_ms,
        s.break_reason,
        s.asset_count,
        s.candle_count,
        COALESCE(n.notes, '') AS notes,
        COALESCE(t.trade_count, 0) AS trade_count
      FROM sessions s
      LEFT JOIN session_notes n ON n.session_id = s.id
      LEFT JOIN (
        SELECT session_id, COUNT(*) AS trade_count
        FROM session_trades
        GROUP BY session_id
      ) t ON t.session_id = s.id
      ${where}
      ORDER BY s.started_at_ms DESC
      LIMIT ? OFFSET ?
    `;
    const rows = dateFilter
      ? db.prepare(sql).all(dateFilter, pageSize, offset)
      : db.prepare(sql).all(pageSize, offset);
    return {
      sessions: rows.map((row) => ({
        id: String(row.id || ""),
        sessionType: "live",
        status: String(row.status || "closed"),
        startedAtMs: Number(row.started_at_ms || 0),
        endedAtMs: row.ended_at_ms == null ? null : Number(row.ended_at_ms),
        breakReason: row.break_reason ? String(row.break_reason) : null,
        assetCount: Number(row.asset_count || 0),
        candleCount: Number(row.candle_count || 0),
        notes: String(row.notes || ""),
        tradeCount: Number(row.trade_count || 0)
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      }
    };
  } finally {
    db.close();
  }
}

function copyRows(destDb, sourceDb, sessionId) {
  const id = String(sessionId || "").trim();
  const sessionRow = sourceDb.prepare("SELECT * FROM sessions WHERE id = ? LIMIT 1").get(id);
  if (!sessionRow) throw new Error(`Session not found in source db: ${id}`);

  const tickRows = sourceDb
    .prepare("SELECT session_id, symbol, ts_ms, price, size, source FROM session_ticks WHERE session_id = ?")
    .all(id);
  const candleRows = sourceDb
    .prepare(
      "SELECT session_id, symbol, timeframe, bucket_start_ms, open, high, low, close, volume, source, is_gap_fill FROM session_candles WHERE session_id = ?"
    )
    .all(id);
  const noteRows = sourceDb.prepare("SELECT session_id, notes, updated_at_ms FROM session_notes WHERE session_id = ?").all(id);
  const tradeRows = sourceDb
    .prepare(
      "SELECT session_id, mode, coin, side, dir, px, sz, time_ms, fee, fee_token, closed_pnl, crossed, oid, tid FROM session_trades WHERE session_id = ?"
    )
    .all(id);
  const tradeStateRows = sourceDb
    .prepare(
      `
      SELECT session_id, mode, symbol, status, side, size, entry_px, stop_loss, stop_loss_from_pending_orders,
             take_profit_from_pending_orders, stop_order_ref_json, pending_orders_json, execution_meta_json,
             last_action, error, updated_at_ms
      FROM session_trade_state
      WHERE session_id = ?
    `
    )
    .all(id);

  const insertSession = destDb.prepare(
    `INSERT INTO sessions (id, market_window_start, market_window_end, started_at_ms, ended_at_ms, status, break_reason, asset_count, tick_count, candle_count, last_saved_at_ms, active_streams_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertTick = destDb.prepare(
    "INSERT INTO session_ticks (session_id, symbol, ts_ms, price, size, source) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insertCandle = destDb.prepare(
    "INSERT INTO session_candles (session_id, symbol, timeframe, bucket_start_ms, open, high, low, close, volume, source, is_gap_fill) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const insertNote = destDb.prepare(
    "INSERT INTO session_notes (session_id, notes, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET notes = excluded.notes, updated_at_ms = excluded.updated_at_ms"
  );
  const insertTrade = destDb.prepare(
    "INSERT INTO session_trades (session_id, mode, coin, side, dir, px, sz, time_ms, fee, fee_token, closed_pnl, crossed, oid, tid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const insertTradeState = destDb.prepare(
    `
    INSERT INTO session_trade_state (
      session_id, mode, symbol, status, side, size, entry_px, stop_loss,
      stop_loss_from_pending_orders, take_profit_from_pending_orders,
      stop_order_ref_json, pending_orders_json, execution_meta_json, last_action, error, updated_at_ms
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  );

  destDb.exec("BEGIN");
  try {
    deleteSessionRows(destDb, id);
    insertSession.run(
      sessionRow.id,
      sessionRow.market_window_start,
      sessionRow.market_window_end,
      sessionRow.started_at_ms,
      sessionRow.ended_at_ms,
      sessionRow.status,
      sessionRow.break_reason,
      sessionRow.asset_count,
      sessionRow.tick_count,
      sessionRow.candle_count,
      sessionRow.last_saved_at_ms ?? Date.now(),
      sessionRow.active_streams_json || ""
    );
    for (const row of tickRows) {
      insertTick.run(row.session_id, row.symbol, row.ts_ms, row.price, row.size, row.source);
    }
    for (const row of candleRows) {
      insertCandle.run(
        row.session_id,
        row.symbol,
        row.timeframe,
        row.bucket_start_ms,
        row.open,
        row.high,
        row.low,
        row.close,
        row.volume,
        row.source,
        row.is_gap_fill
      );
    }
    for (const row of noteRows) {
      insertNote.run(row.session_id, row.notes, row.updated_at_ms);
    }
    for (const row of tradeRows) {
      insertTrade.run(
        row.session_id,
        row.mode,
        row.coin,
        row.side,
        row.dir,
        row.px,
        row.sz,
        row.time_ms,
        row.fee,
        row.fee_token,
        row.closed_pnl,
        row.crossed,
        row.oid,
        row.tid
      );
    }
    for (const row of tradeStateRows) {
      insertTradeState.run(
        row.session_id,
        row.mode,
        row.symbol,
        row.status,
        row.side,
        row.size,
        row.entry_px,
        row.stop_loss,
        row.stop_loss_from_pending_orders,
        row.take_profit_from_pending_orders,
        row.stop_order_ref_json,
        row.pending_orders_json,
        row.execution_meta_json,
        row.last_action,
        row.error,
        row.updated_at_ms
      );
    }
    destDb.exec("COMMIT");
  } catch (error) {
    destDb.exec("ROLLBACK");
    throw error;
  }

  return {
    sessionId: id,
    tickCount: tickRows.length,
    candleCount: candleRows.length,
    tradeCount: tradeRows.length,
    tradeStateCount: tradeStateRows.length
  };
}

async function importSession(options = {}) {
  const sessionId = String(options.sessionId || "").trim();
  if (!sessionId) throw new Error("importSession: sessionId is required");
  const sourceSqlitePath = options.sourceSqlitePath || defaultSourceSqlitePath();
  const destSqlitePath = options.destSqlitePath || defaultBacktestSqlitePath();
  const repo = createBacktestRepository({ sqlitePath: destSqlitePath });
  const sourceDb = openSourceDb(sourceSqlitePath);
  try {
    const copied = copyRows(repo.db, sourceDb, sessionId);
    return {
      ...copied,
      sourceSqlitePath: path.resolve(sourceSqlitePath),
      destSqlitePath: path.resolve(destSqlitePath)
    };
  } finally {
    sourceDb.close();
    repo.close();
  }
}

module.exports = {
  importSession,
  listSourceSessions
};
