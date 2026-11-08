const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { BASE_SCHEMA_SQL } = require("./schema");
const { detectGapRanges, intervalForTimeframe, normalizeSymbol } = require("./math");

function ensureSessionTypeColumn(db) {
  const columns = db.prepare("PRAGMA table_info(sessions)").all();
  const hasSessionType = columns.some((col) => String(col.name || "").toLowerCase() === "session_type");
  if (!hasSessionType) {
    db.exec("ALTER TABLE sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'live';");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_type ON sessions (session_type);");
}

class BacktestRepository {
  constructor(options = {}) {
    this.sqlitePath = options.sqlitePath;
    this.db = null;
  }

  init() {
    if (this.db) return;
    if (!this.sqlitePath) throw new Error("BacktestRepository: sqlitePath is required");
    fs.mkdirSync(path.dirname(this.sqlitePath), { recursive: true });
    this.db = new DatabaseSync(this.sqlitePath);
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec("PRAGMA synchronous=NORMAL;");
    this.db.exec(BASE_SCHEMA_SQL);
    ensureSessionTypeColumn(this.db);
  }

  close() {
    if (this.db) this.db.close();
    this.db = null;
  }

  ensureOpen() {
    if (!this.db) throw new Error("BacktestRepository not initialized");
  }

  getSessionById(sessionId) {
    this.ensureOpen();
    return this.db
      .prepare(
        `SELECT id, started_at_ms, ended_at_ms, session_type, status, break_reason, asset_count, candle_count,
                market_window_start, market_window_end
         FROM sessions WHERE id = ? LIMIT 1`
      )
      .get(String(sessionId));
  }

  listSessions(options = {}) {
    this.ensureOpen();
    const sessionType = String(options.sessionType || "").trim().toLowerCase();
    const where = sessionType === "historical" || sessionType === "live" ? "WHERE s.session_type = ?" : "";
    const rows = this.db
      .prepare(
        `
        SELECT
          s.id,
          s.session_type,
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
      `
      )
      .all(...(where ? [sessionType] : []));

    return rows.map((row) => ({
      id: String(row.id || ""),
      sessionType: String(row.session_type || "live"),
      status: String(row.status || "closed"),
      startedAtMs: Number(row.started_at_ms || 0),
      endedAtMs: row.ended_at_ms == null ? null : Number(row.ended_at_ms),
      breakReason: row.break_reason ? String(row.break_reason) : null,
      assetCount: Number(row.asset_count || 0),
      candleCount: Number(row.candle_count || 0),
      notes: String(row.notes || ""),
      tradeCount: Number(row.trade_count || 0)
    }));
  }

  listSessionSymbols(sessionId) {
    this.ensureOpen();
    const id = String(sessionId || "").trim();
    if (!id) return [];
    const rows = this.db
      .prepare(
        `
          SELECT symbol, MIN(ts_ms) AS first_seen_ms
          FROM (
            SELECT symbol, bucket_start_ms AS ts_ms FROM session_candles WHERE session_id = ?
            UNION ALL
            SELECT symbol, ts_ms FROM session_ticks WHERE session_id = ?
          )
          GROUP BY symbol
          ORDER BY first_seen_ms ASC
        `
      )
      .all(id, id);
    return Array.from(new Set(rows.map((row) => normalizeSymbol(row.symbol)).filter(Boolean)));
  }

  getCandles(sessionId, symbol, timeframe = "1m") {
    this.ensureOpen();
    const id = String(sessionId || "").trim();
    const sym = normalizeSymbol(symbol);
    if (!id || !sym) return [];
    const rows = this.db
      .prepare(
        `
          SELECT bucket_start_ms, open, high, low, close, volume, source, is_gap_fill
          FROM session_candles
          WHERE session_id = ? AND symbol = ? AND timeframe = ?
          ORDER BY bucket_start_ms ASC
        `
      )
      .all(id, sym, timeframe);
    return rows.map((row) => ({
      timeMs: Number(row.bucket_start_ms || 0),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume || 0),
      source: String(row.source || "history"),
      isGapFill: Boolean(row.is_gap_fill)
    }));
  }

  getTicks(sessionId, symbol = "") {
    this.ensureOpen();
    const id = String(sessionId || "").trim();
    if (!id) return [];
    const sym = normalizeSymbol(symbol);
    const rows = sym
      ? this.db
          .prepare(
            `
            SELECT symbol, ts_ms, price, size, source
            FROM session_ticks
            WHERE session_id = ? AND symbol = ?
            ORDER BY ts_ms ASC
          `
          )
          .all(id, sym)
      : this.db
          .prepare(
            `
            SELECT symbol, ts_ms, price, size, source
            FROM session_ticks
            WHERE session_id = ?
            ORDER BY ts_ms ASC
          `
          )
          .all(id);
    return rows.map((row) => ({
      symbol: String(row.symbol || ""),
      ts: Number(row.ts_ms || 0),
      price: Number(row.price || 0),
      size: Number(row.size || 0),
      source: String(row.source || "live")
    }));
  }

  getSessionTrades(sessionId) {
    this.ensureOpen();
    const id = String(sessionId || "").trim();
    if (!id) return [];
    const rows = this.db
      .prepare(
        `
          SELECT mode, coin, side, dir, px, sz, time_ms, fee, fee_token, closed_pnl, crossed, oid, tid
          FROM session_trades
          WHERE session_id = ?
          ORDER BY time_ms DESC
        `
      )
      .all(id);
    return rows.map((row) => ({
      mode: String(row.mode || "live"),
      coin: String(row.coin || ""),
      side: String(row.side || ""),
      dir: String(row.dir || ""),
      px: Number(row.px || 0),
      sz: Number(row.sz || 0),
      time: Number(row.time_ms || 0),
      fee: Number(row.fee || 0),
      feeToken: String(row.fee_token || "USDC"),
      closedPnl: Number(row.closed_pnl || 0),
      crossed: Boolean(row.crossed),
      oid: row.oid ? Number(row.oid) : null,
      tid: row.tid ? Number(row.tid) : null
    }));
  }

  getSessionSnapshot(sessionId, symbol, timeframe = "all") {
    this.ensureOpen();
    const id = String(sessionId || "").trim();
    const sym = normalizeSymbol(symbol);
    if (!id || !sym) return null;
    const session = this.getSessionById(id);
    if (!session) return null;

    const sessionInfo = {
      id: String(session.id || ""),
      sessionType: String(session.session_type || "live"),
      status: String(session.status || "closed"),
      startedAtMs: Number(session.started_at_ms || 0),
      endedAtMs: session.ended_at_ms == null ? null : Number(session.ended_at_ms),
      lastEventAtMs: null,
      assetCount: Number(session.asset_count || 0),
      candleCount: Number(session.candle_count || 0),
      breakReason: session.break_reason ? String(session.break_reason) : null,
      marketWindowStartMs: Number(session.market_window_start || 0),
      marketWindowEndMs: Number(session.market_window_end || 0)
    };

    const readFrame = (tf) => {
      const candles = this.getCandles(id, sym, tf);
      const gaps = detectGapRanges(candles, intervalForTimeframe(tf));
      return { candles, gaps };
    };

    if (timeframe === "all") {
      const one = readFrame("1m");
      const five = readFrame("5m");
      return {
        sessionInfo,
        symbol: sym,
        candlesByTimeframe: { "1m": one.candles, "5m": five.candles },
        gapsByTimeframe: { "1m": one.gaps, "5m": five.gaps }
      };
    }

    const frame = readFrame(timeframe);
    return {
      sessionInfo,
      symbol: sym,
      timeframe,
      candles: frame.candles,
      gaps: frame.gaps
    };
  }

  /**
   * Store scanner/external metadata payloads per session.
   * Payloads stay JSON so schema can evolve without table churn.
   */
  importScannerMetadata({
    sessionId,
    tool = "scanner",
    sourceId = "",
    payload,
    importedAtMs = Date.now()
  }) {
    this.ensureOpen();
    const id = String(sessionId || "").trim();
    if (!id) throw new Error("importScannerMetadata: sessionId is required");
    this.db
      .prepare(
        `
          INSERT INTO session_external_metadata (session_id, tool, source_id, payload_json, imported_at_ms)
          VALUES (?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        String(tool || "scanner"),
        String(sourceId || ""),
        JSON.stringify(payload ?? {}),
        Number(importedAtMs || Date.now())
      );
  }

  listScannerMetadata(sessionId, tool = "") {
    this.ensureOpen();
    const id = String(sessionId || "").trim();
    if (!id) return [];
    const rows = tool
      ? this.db
          .prepare(
            `
          SELECT session_id, tool, source_id, payload_json, imported_at_ms
          FROM session_external_metadata
          WHERE session_id = ? AND tool = ?
          ORDER BY imported_at_ms DESC
        `
          )
          .all(id, String(tool))
      : this.db
          .prepare(
            `
          SELECT session_id, tool, source_id, payload_json, imported_at_ms
          FROM session_external_metadata
          WHERE session_id = ?
          ORDER BY imported_at_ms DESC
        `
          )
          .all(id);

    return rows.map((row) => ({
      sessionId: String(row.session_id || ""),
      tool: String(row.tool || ""),
      sourceId: String(row.source_id || ""),
      importedAtMs: Number(row.imported_at_ms || 0),
      payload: (() => {
        try {
          return JSON.parse(String(row.payload_json || "{}"));
        } catch {
          return {};
        }
      })()
    }));
  }

  upsertSessionCandleFeatures({
    sessionId,
    timeframe = "1m",
    featureSet = "scanner",
    featureVersion = "v1",
    rows = [],
    createdAtMs = Date.now()
  }) {
    this.ensureOpen();
    const id = String(sessionId || "").trim();
    if (!id) throw new Error("upsertSessionCandleFeatures: sessionId is required");
    if (!Array.isArray(rows) || rows.length === 0) return { sessionId: id, upserted: 0 };
    const tfDefault = String(timeframe || "1m").trim().toLowerCase();
    const setName = String(featureSet || "scanner").trim();
    const version = String(featureVersion || "v1").trim();
    const created = Number(createdAtMs || Date.now());
    const stmt = this.db.prepare(
      `
        INSERT OR REPLACE INTO session_candle_features (
          session_id,
          symbol,
          timeframe,
          bucket_start_ms,
          feature_set,
          feature_version,
          payload_json,
          created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    );

    this.db.exec("BEGIN");
    let upserted = 0;
    try {
      for (const row of rows) {
        const symbol = normalizeSymbol(row.symbol || "");
        const tf = String(row.timeframe || tfDefault).trim().toLowerCase();
        const bucketStartMs = Number(row.bucketStartMs ?? row.timeMs ?? 0);
        if (!symbol || !Number.isFinite(bucketStartMs) || bucketStartMs <= 0) {
          continue;
        }
        const payload =
          row.payload && typeof row.payload === "object"
            ? row.payload
            : {
                ...row
              };
        stmt.run(
          id,
          symbol,
          tf,
          bucketStartMs,
          setName,
          version,
          JSON.stringify(payload ?? {}),
          created
        );
        upserted += 1;
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { sessionId: id, upserted };
  }

  listSessionCandleFeatures(sessionId, options = {}) {
    this.ensureOpen();
    const id = String(sessionId || "").trim();
    if (!id) return [];
    const symbol = normalizeSymbol(options.symbol || "");
    const timeframe = String(options.timeframe || "").trim().toLowerCase();
    const featureSet = String(options.featureSet || "").trim();
    const featureVersion = String(options.featureVersion || "").trim();
    const anchorTsMs = Number(options.anchorTsMs || 0);
    const limit = Math.max(1, Number(options.limit || 5000));

    const clauses = ["session_id = ?"];
    const params = [id];
    if (symbol) {
      clauses.push("symbol = ?");
      params.push(symbol);
    }
    if (timeframe) {
      clauses.push("timeframe = ?");
      params.push(timeframe);
    }
    if (featureSet) {
      clauses.push("feature_set = ?");
      params.push(featureSet);
    }
    if (featureVersion) {
      clauses.push("feature_version = ?");
      params.push(featureVersion);
    }
    if (Number.isFinite(anchorTsMs) && anchorTsMs > 0) {
      clauses.push("bucket_start_ms = ?");
      params.push(anchorTsMs);
    }

    const rows = this.db
      .prepare(
        `
          SELECT session_id, symbol, timeframe, bucket_start_ms, feature_set, feature_version, payload_json, created_at_ms
          FROM session_candle_features
          WHERE ${clauses.join(" AND ")}
          ORDER BY bucket_start_ms ASC, symbol ASC
          LIMIT ?
        `
      )
      .all(...params, limit);

    return rows.map((row) => ({
      sessionId: String(row.session_id || ""),
      symbol: normalizeSymbol(row.symbol || ""),
      timeframe: String(row.timeframe || "1m"),
      bucketStartMs: Number(row.bucket_start_ms || 0),
      featureSet: String(row.feature_set || ""),
      featureVersion: String(row.feature_version || "v1"),
      createdAtMs: Number(row.created_at_ms || 0),
      payload: (() => {
        try {
          return JSON.parse(String(row.payload_json || "{}"));
        } catch {
          return {};
        }
      })()
    }));
  }
}

module.exports = {
  BacktestRepository
};
