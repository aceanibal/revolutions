const Redis = require("ioredis");
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const { DateTime } = require("luxon");
const { upsertCandle, sortedCandlesFromMap, detectGapRanges, intervalForTimeframe } = require("./sessionMath");

const TIMEFRAMES = ["1m", "5m"];

function parseHHMM(value, fallback) {
  const raw = String(value || fallback || "").trim();
  const [hourRaw, minuteRaw] = raw.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    const [fh, fm] = fallback.split(":").map(Number);
    return { hour: fh, minute: fm };
  }
  return {
    hour: Math.min(23, Math.max(0, hour)),
    minute: Math.min(59, Math.max(0, minute))
  };
}

function normalizeSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function parseSafeJson(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function toSessionInfo(meta, assetCount, candleCount) {
  return {
    id: String(meta.id || ""),
    status: String(meta.status || "active"),
    startedAtMs: Number(meta.startedAtMs || 0),
    endedAtMs: meta.endedAtMs ? Number(meta.endedAtMs) : null,
    lastEventAtMs: meta.lastEventAtMs ? Number(meta.lastEventAtMs) : null,
    assetCount: Number(assetCount || 0),
    candleCount: Number(candleCount || 0),
    breakReason: meta.breakReason || null,
    marketWindowStartMs: Number(meta.marketWindowStartMs || 0),
    marketWindowEndMs: Number(meta.marketWindowEndMs || 0)
  };
}

class SessionStore {
  constructor(options = {}) {
    this.timezone = options.timezone || process.env.SESSION_TIMEZONE || "America/New_York";
    this.marketStart = parseHHMM(process.env.SESSION_MARKET_START, "08:00");
    this.marketEnd = parseHHMM(process.env.SESSION_MARKET_END, "17:00");
    this.sameDayTtlSeconds = Number(process.env.SESSION_SAME_DAY_TTL_SECONDS || 172800);
    this.redis = options.redis || null;
    this.redisUrl = options.redisUrl || process.env.REDIS_URL || "redis://127.0.0.1:6379";
    this.sqlite = options.sqlite || null;
    this.sqlitePath =
      options.sqlitePath ||
      process.env.SQLITE_PATH ||
      path.join(process.cwd(), "backend", "data", "sessions.sqlite");
    this.hyperliquidInfoUrl =
      options.hyperliquidInfoUrl ||
      process.env.HYPERLIQUID_INFO_URL ||
      "https://api.hyperliquid.xyz/info";
    this.lastSqlSaveAtMs = null;
    this.lastSqlSavedSessionId = null;
  }

  async init() {
    if (!this.redis) {
      const candidate = new Redis(this.redisUrl, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        enableOfflineQueue: false,
        connectTimeout: 1_500
      });
      candidate.on("error", () => {});
      try {
        await candidate.connect();
        await candidate.ping();
        this.redis = candidate;
        console.log(`[sessionStore] Redis connected: ${this.redisUrl}`);
      } catch (error) {
        try {
          candidate.disconnect();
        } catch {}
        this.redis = null;
        console.log(
          `[sessionStore] Redis unavailable (${this.redisUrl}). Active session persistence disabled until Redis is reachable.`
        );
      }
    }
    if (!this.sqlite) {
      const dir = path.dirname(this.sqlitePath);
      fs.mkdirSync(dir, { recursive: true });
      this.sqlite = new DatabaseSync(this.sqlitePath);
    }
    await this.ensureTables();
    this.hydrateLastSqlSaveFromDb();
  }

  async shutdown() {
    if (this.redis) await this.redis.quit().catch(() => {});
    if (this.sqlite) this.sqlite.close();
  }

  currentWindow(nowMs = Date.now()) {
    const now = DateTime.fromMillis(nowMs, { zone: this.timezone });
    const startForDay = now.set({
      hour: this.marketStart.hour,
      minute: this.marketStart.minute,
      second: 0,
      millisecond: 0
    });
    const endForDay = now.set({
      hour: this.marketEnd.hour,
      minute: this.marketEnd.minute,
      second: 0,
      millisecond: 0
    });

    let start = startForDay;
    let end = endForDay;
    if (end <= start) {
      end = end.plus({ days: 1 });
    }
    if (now < start) {
      start = start.minus({ days: 1 });
      end = end.minus({ days: 1 });
    }

    const windowId = `${start.toISODate()}_${String(start.hour).padStart(2, "0")}${String(
      start.minute
    ).padStart(2, "0")}`;
    return { windowId, startMs: start.toMillis(), endMs: end.toMillis() };
  }

  sessionMetaKey(sessionId) {
    return `session:${sessionId}:meta`;
  }

  sessionSymbolsKey(sessionId) {
    return `session:${sessionId}:symbols`;
  }

  sessionTicksKey(sessionId, symbol) {
    return `session:${sessionId}:ticks:${symbol}`;
  }

  sessionCandlesKey(sessionId, symbol, timeframe) {
    return `session:${sessionId}:candles:${symbol}:${timeframe}`;
  }

  sessionGapsKey(sessionId, symbol, timeframe) {
    return `session:${sessionId}:gaps:${symbol}:${timeframe}`;
  }

  dayIndexKey(dayId) {
    return `sessions:index:day:${dayId}`;
  }

  historyLoadedKey(sessionId, symbol, timeframe) {
    return `session:${sessionId}:historyLoaded:${symbol}:${timeframe}`;
  }

  async ensureActiveSession(nowMs = Date.now()) {
    const { windowId, startMs, endMs } = this.currentWindow(nowMs);
    if (!this.redis) {
      return null;
    }

    const activeIndexKey = `session:active:${windowId}`;
    let activeId = await this.redis.get(activeIndexKey);
    if (activeId) return activeId;

    activeId = `${windowId}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const meta = {
      id: activeId,
      status: "active",
      startedAtMs: String(now),
      endedAtMs: "",
      marketWindowId: windowId,
      marketWindowStartMs: String(startMs),
      marketWindowEndMs: String(endMs),
      lastEventAtMs: "",
      breakReason: ""
    };

    const multi = this.redis.multi();
    multi.set(activeIndexKey, activeId);
    multi.hset(this.sessionMetaKey(activeId), meta);
    multi.expire(this.sessionMetaKey(activeId), this.sameDayTtlSeconds);
    multi.zadd(this.dayIndexKey(windowId.slice(0, 10)), now, activeId);
    multi.expire(this.dayIndexKey(windowId.slice(0, 10)), this.sameDayTtlSeconds);
    await multi.exec();
    return activeId;
  }

  async maybeRollSession(nowMs = Date.now()) {
    if (!this.redis) return;
    const { windowId } = this.currentWindow(nowMs);
    const keys = await this.redis.keys("session:active:*");
    for (const key of keys) {
      if (key === `session:active:${windowId}`) continue;
      const sessionId = await this.redis.get(key);
      if (!sessionId) continue;
      await this.closeAndArchiveSession(sessionId, nowMs, "window_rollover");
      await this.redis.del(key);
    }
  }

  async ingestTick(rawTick, source = "live") {
    const symbol = normalizeSymbol(rawTick.symbol);
    const price = Number(rawTick.price);
    const ts = Number(rawTick.ts || Date.now());
    const size = Number(rawTick.size || 0);
    if (!this.redis || !symbol || !Number.isFinite(price) || !Number.isFinite(ts)) {
      return null;
    }

    await this.maybeRollSession(ts);
    const sessionId = await this.ensureActiveSession(ts);
    if (!sessionId) return null;
    const tick = { symbol, price, size: Number.isFinite(size) ? size : 0, ts, source };

    const multi = this.redis.multi();
    multi.sadd(this.sessionSymbolsKey(sessionId), symbol);
    multi.expire(this.sessionSymbolsKey(sessionId), this.sameDayTtlSeconds);
    multi.zadd(this.sessionTicksKey(sessionId, symbol), ts, JSON.stringify(tick));
    multi.expire(this.sessionTicksKey(sessionId, symbol), this.sameDayTtlSeconds);
    multi.hset(this.sessionMetaKey(sessionId), "lastEventAtMs", String(ts));
    multi.expire(this.sessionMetaKey(sessionId), this.sameDayTtlSeconds);
    await multi.exec();

    for (const timeframe of TIMEFRAMES) {
      await this.upsertCandleForTick(sessionId, symbol, timeframe, tick);
    }

    const sessionInfo = await this.getSessionInfo(sessionId);
    return { sessionId, tick, sessionInfo };
  }

  async fetchHistoricalCandles(symbol, timeframe) {
    const upper = normalizeSymbol(symbol);
    if (!upper) return [];

    try {
      const response = await fetch(this.hyperliquidInfoUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "candleSnapshot",
          req: {
            coin: upper,
            interval: timeframe,
            startTime: 0
          }
        })
      });

      if (!response.ok) {
        return [];
      }

      const payload = await response.json();
      const candlesArray = Array.isArray(payload) ? payload : payload?.candles ?? [];
      return candlesArray
        .map((c) => {
          const timeMs = Number(c?.t ?? c?.openTime ?? c?.timeMs);
          const open = Number(c?.o ?? c?.open);
          const high = Number(c?.h ?? c?.high);
          const low = Number(c?.l ?? c?.low);
          const close = Number(c?.c ?? c?.close);
          const volume = Number(c?.v ?? c?.volume ?? 0);
          if (!Number.isFinite(timeMs) || ![open, high, low, close].every(Number.isFinite)) {
            return null;
          }
          return { timeMs, open, high, low, close, volume };
        })
        .filter((c) => c !== null)
        .sort((a, b) => a.timeMs - b.timeMs);
    } catch {
      return [];
    }
  }

  mergeHistoryCandle(existing, incoming, bucketStart) {
    if (!existing) {
      return {
        timeMs: bucketStart,
        open: incoming.open,
        high: incoming.high,
        low: incoming.low,
        close: incoming.close,
        volume: incoming.volume,
        source: "history",
        isGapFill: false
      };
    }

    const source = existing.source === "history" ? "history" : "mixed";
    return {
      ...existing,
      timeMs: bucketStart,
      high: Math.max(Number(existing.high ?? incoming.high), incoming.high),
      low: Math.min(Number(existing.low ?? incoming.low), incoming.low),
      // Preserve live close if we already had live data in this bucket.
      close: existing.source === "live" || existing.source === "mixed" ? existing.close : incoming.close,
      volume: Math.max(Number(existing.volume ?? 0), Number(incoming.volume ?? 0)),
      source
    };
  }

  async preloadHistoricalForSymbol(symbol, options = {}) {
    const upper = normalizeSymbol(symbol);
    if (!upper) return null;
    if (!this.redis) {
      return { sessionId: null, sessionInfo: null, reason: "redis_unavailable" };
    }
    const force = Boolean(options.force);

    const sessionId = await this.ensureActiveSession(Date.now());
    if (!sessionId) return null;

    console.log(
      `[sessionStore] History preload start symbol=${upper} session=${sessionId} force=${force}`
    );

    const multi = this.redis.multi();
    multi.sadd(this.sessionSymbolsKey(sessionId), upper);
    multi.expire(this.sessionSymbolsKey(sessionId), this.sameDayTtlSeconds);
    await multi.exec();

    const loadedCounts = {
      "1m": 0,
      "5m": 0
    };
    for (const timeframe of TIMEFRAMES) {
      loadedCounts[timeframe] = await this.preloadHistoricalTimeframe(sessionId, upper, timeframe, {
        force
      });
    }

    const sessionInfo = await this.getSessionInfo(sessionId);
    console.log(
      `[sessionStore] History preload done symbol=${upper} session=${sessionId} 1m=${loadedCounts["1m"]} 5m=${loadedCounts["5m"]}`
    );
    return { sessionId, sessionInfo };
  }

  async preloadHistoricalTimeframe(sessionId, symbol, timeframe, options = {}) {
    const force = Boolean(options.force);
    const loadedKey = this.historyLoadedKey(sessionId, symbol, timeframe);
    const alreadyLoaded = await this.redis.get(loadedKey);
    if (alreadyLoaded === "1" && !force) {
      console.log(
        `[sessionStore] History preload skip symbol=${symbol} timeframe=${timeframe} session=${sessionId} (already loaded)`
      );
      return 0;
    }

    const history = await this.fetchHistoricalCandles(symbol, timeframe);
    console.log(
      `[sessionStore] History fetched symbol=${symbol} timeframe=${timeframe} candles=${history.length}`
    );
    const intervalMs = intervalForTimeframe(timeframe);
    const key = this.sessionCandlesKey(sessionId, symbol, timeframe);
    const existingRaw = await this.redis.hgetall(key);
    const map = new Map();

    for (const [bucket, raw] of Object.entries(existingRaw || {})) {
      const parsed = parseSafeJson(raw);
      if (!parsed) continue;
      map.set(Number(bucket), parsed);
    }

    for (const candle of history) {
      const bucketStart = Math.floor(candle.timeMs / intervalMs) * intervalMs;
      const existing = map.get(bucketStart);
      map.set(bucketStart, this.mergeHistoryCandle(existing, candle, bucketStart));
    }

    const payload = {};
    for (const [bucket, candle] of map.entries()) {
      payload[String(bucket)] = JSON.stringify(candle);
    }

    if (Object.keys(payload).length > 0) {
      await this.redis.hset(key, payload);
      await this.redis.expire(key, this.sameDayTtlSeconds);
    }
    await this.redis.set(loadedKey, "1", "EX", this.sameDayTtlSeconds);
    await this.updateGapRanges(sessionId, symbol, timeframe);
    return history.length;
  }

  async upsertCandleForTick(sessionId, symbol, timeframe, tick) {
    const key = this.sessionCandlesKey(sessionId, symbol, timeframe);
    const intervalMs = intervalForTimeframe(timeframe);
    const bucketStart = Math.floor(tick.ts / intervalMs) * intervalMs;
    const existingRaw = await this.redis.hget(key, String(bucketStart));
    const map = new Map();
    if (existingRaw) {
      map.set(bucketStart, parseSafeJson(existingRaw));
    }
    upsertCandle(map, tick, intervalMs, tick.source || "live");
    const candle = map.get(bucketStart);

    await this.redis.hset(key, String(bucketStart), JSON.stringify(candle));
    await this.redis.expire(key, this.sameDayTtlSeconds);
    await this.updateGapRanges(sessionId, symbol, timeframe);
  }

  async updateGapRanges(sessionId, symbol, timeframe) {
    const candles = await this.getCandles(sessionId, symbol, timeframe);
    const gaps = detectGapRanges(candles, intervalForTimeframe(timeframe));
    const key = this.sessionGapsKey(sessionId, symbol, timeframe);
    await this.redis.set(key, JSON.stringify(gaps), "EX", this.sameDayTtlSeconds);
  }

  async getCandles(sessionId, symbol, timeframe) {
    if (!this.redis || !sessionId || !symbol) return [];
    const mapRaw = await this.redis.hgetall(this.sessionCandlesKey(sessionId, symbol, timeframe));
    const map = new Map();
    for (const [bucket, raw] of Object.entries(mapRaw || {})) {
      const parsed = parseSafeJson(raw);
      if (!parsed) continue;
      map.set(Number(bucket), parsed);
    }
    return sortedCandlesFromMap(map);
  }

  async getGaps(sessionId, symbol, timeframe) {
    if (!this.redis || !sessionId || !symbol) return [];
    const raw = await this.redis.get(this.sessionGapsKey(sessionId, symbol, timeframe));
    return parseSafeJson(raw, []) || [];
  }

  async getSessionInfo(sessionId) {
    if (!this.redis || !sessionId) return null;
    const meta = await this.redis.hgetall(this.sessionMetaKey(sessionId));
    if (!meta || !meta.id) return null;
    const symbols = await this.redis.smembers(this.sessionSymbolsKey(sessionId));
    let candleCount = 0;
    for (const symbol of symbols) {
      for (const timeframe of TIMEFRAMES) {
        const count = await this.redis.hlen(this.sessionCandlesKey(sessionId, symbol, timeframe));
        candleCount += Number(count || 0);
      }
    }
    return toSessionInfo(meta, symbols.length, candleCount);
  }

  async getCurrentSessionId() {
    if (!this.redis) return null;
    const { windowId } = this.currentWindow(Date.now());
    return this.redis.get(`session:active:${windowId}`);
  }

  async getStartupSymbols() {
    const normalizeUnique = (values) =>
      Array.from(new Set((values || []).map(normalizeSymbol).filter(Boolean)));

    const currentSessionId = await this.getCurrentSessionId();
    if (currentSessionId && this.redis) {
      const redisSymbols = normalizeUnique(await this.redis.smembers(this.sessionSymbolsKey(currentSessionId)));
      if (redisSymbols.length > 0) {
        return { symbols: redisSymbols, source: "redis", sessionId: currentSessionId };
      }
    }

    if (!this.sqlite) {
      return { symbols: [], source: "none", sessionId: null };
    }

    const latestRow = this.sqlite
      .prepare(
        "SELECT id FROM sessions ORDER BY COALESCE(last_saved_at_ms, ended_at_ms, started_at_ms) DESC LIMIT 1"
      )
      .get();
    const latestSessionId = latestRow?.id ? String(latestRow.id) : null;
    if (!latestSessionId) {
      return { symbols: [], source: "none", sessionId: null };
    }

    const rows = this.sqlite
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
      .all(latestSessionId, latestSessionId);
    const sqlSymbols = normalizeUnique(rows.map((row) => row.symbol));
    if (sqlSymbols.length > 0) {
      return { symbols: sqlSymbols, source: "sql", sessionId: latestSessionId };
    }

    return { symbols: [], source: "none", sessionId: latestSessionId };
  }

  async getCurrentSessionSnapshot(symbol, timeframe = "1m") {
    if (!this.redis) return null;
    const sessionId = await this.getCurrentSessionId();
    if (!sessionId) return null;
    return this.getSessionSnapshot(sessionId, symbol, timeframe);
  }

  async getSessionSnapshot(sessionId, symbol, timeframe = "1m") {
    const upper = normalizeSymbol(symbol);
    const sessionInfo = await this.getSessionInfo(sessionId);
    if (!sessionInfo || !upper) return null;

    if (timeframe === "all") {
      const candles1m = await this.getCandles(sessionId, upper, "1m");
      const candles5m = await this.getCandles(sessionId, upper, "5m");
      const gaps1m = await this.getGaps(sessionId, upper, "1m");
      const gaps5m = await this.getGaps(sessionId, upper, "5m");
      return {
        sessionInfo,
        symbol: upper,
        candlesByTimeframe: { "1m": candles1m, "5m": candles5m },
        gapsByTimeframe: { "1m": gaps1m, "5m": gaps5m }
      };
    }

    const candles = await this.getCandles(sessionId, upper, timeframe);
    const gaps = await this.getGaps(sessionId, upper, timeframe);
    return {
      sessionInfo,
      symbol: upper,
      timeframe,
      candles,
      gaps
    };
  }

  async listTodaySessions(nowMs = Date.now()) {
    if (!this.redis) return [];
    const dayId = DateTime.fromMillis(nowMs, { zone: this.timezone }).toISODate();
    const ids = await this.redis.zrange(this.dayIndexKey(dayId), 0, -1);
    const result = [];
    for (const id of ids) {
      const info = await this.getSessionInfo(id);
      if (info) result.push(info);
    }

    if (this.sqlite) {
      const dayStart = DateTime.fromMillis(nowMs, { zone: this.timezone }).startOf("day").toMillis();
      const dayEnd = DateTime.fromMillis(nowMs, { zone: this.timezone }).endOf("day").toMillis();
      const rows = this.sqlite
        .prepare(
          "SELECT id, started_at_ms, ended_at_ms, status, break_reason, asset_count, candle_count FROM sessions WHERE started_at_ms BETWEEN ? AND ? ORDER BY started_at_ms ASC"
        )
        .all(dayStart, dayEnd);

      for (const row of rows) {
        if (result.some((x) => x.id === row.id)) continue;
        result.push({
          id: row.id,
          status: row.status,
          startedAtMs: Number(row.started_at_ms || 0),
          endedAtMs: row.ended_at_ms ? Number(row.ended_at_ms) : null,
          lastEventAtMs: null,
          assetCount: Number(row.asset_count || 0),
          candleCount: Number(row.candle_count || 0),
          breakReason: row.break_reason || null
        });
      }
    }

    return result.sort((a, b) => a.startedAtMs - b.startedAtMs);
  }

  async saveSessionCheckpoint(sessionId, savedAtMs = Date.now(), reason = "manual_save") {
    return this.persistSessionToSql(sessionId, {
      markClosed: false,
      savedAtMs,
      reason
    });
  }

  async closeAndArchiveSession(sessionId, endedAtMs = Date.now(), breakReason = null) {
    if (!this.redis || !sessionId) return;
    return this.persistSessionToSql(sessionId, {
      markClosed: true,
      savedAtMs: endedAtMs,
      reason: breakReason
    });
  }

  async persistSessionToSql(sessionId, options = {}) {
    if (!this.redis || !sessionId) return null;
    const markClosed = Boolean(options.markClosed);
    const savedAtMs = Number(options.savedAtMs || Date.now());
    const reason = options.reason || null;
    const metaKey = this.sessionMetaKey(sessionId);
    const meta = await this.redis.hgetall(metaKey);
    if (!meta || !meta.id) return null;

    if (markClosed) {
      await this.redis.hset(metaKey, {
        status: "closed",
        endedAtMs: String(savedAtMs),
        breakReason: reason || ""
      });
    }

    if (!this.sqlite) return null;
    const effectiveMeta = markClosed ? await this.redis.hgetall(metaKey) : meta;
    const symbols = await this.redis.smembers(this.sessionSymbolsKey(sessionId));
    let candleCount = 0;
    let tickCount = 0;

    const insertTick = this.sqlite.prepare(
      "INSERT OR IGNORE INTO session_ticks (session_id, symbol, ts_ms, price, size, source) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertCandle = this.sqlite.prepare(
      "INSERT OR IGNORE INTO session_candles (session_id, symbol, timeframe, bucket_start_ms, open, high, low, close, volume, source, is_gap_fill) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const upsertSession = this.sqlite.prepare(
      "INSERT INTO sessions (id, market_window_start, market_window_end, started_at_ms, ended_at_ms, status, break_reason, asset_count, tick_count, candle_count, last_saved_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ended_at_ms=excluded.ended_at_ms, status=excluded.status, break_reason=excluded.break_reason, asset_count=excluded.asset_count, tick_count=excluded.tick_count, candle_count=excluded.candle_count, last_saved_at_ms=excluded.last_saved_at_ms"
    );

    const tickRows = [];
    const candleRows = [];

    for (const symbol of symbols) {
      const tickKey = this.sessionTicksKey(sessionId, symbol);
      const ticksRaw = await this.redis.zrange(tickKey, 0, -1);
      tickCount += ticksRaw.length;

      for (const raw of ticksRaw) {
        const tick = parseSafeJson(raw);
        if (!tick) continue;
        tickRows.push({
          sessionId,
          symbol,
          ts: Number(tick.ts),
          price: Number(tick.price),
          size: Number(tick.size || 0),
          source: tick.source || "live"
        });
      }

      for (const timeframe of TIMEFRAMES) {
        const candles = await this.getCandles(sessionId, symbol, timeframe);
        candleCount += candles.length;
        for (const c of candles) {
          candleRows.push({
            sessionId,
            symbol,
            timeframe,
            timeMs: Number(c.timeMs),
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
            volume: Number(c.volume || 0),
            source: c.source || "live",
            isGapFill: Boolean(c.isGapFill)
          });
        }
      }
    }

    const sessionPayload = {
      id: sessionId,
      marketWindowStartMs: Number(effectiveMeta.marketWindowStartMs || 0),
      marketWindowEndMs: Number(effectiveMeta.marketWindowEndMs || 0),
      startedAtMs: Number(effectiveMeta.startedAtMs || Date.now()),
      endedAtMs: effectiveMeta.endedAtMs ? Number(effectiveMeta.endedAtMs) : null,
      status: markClosed ? "closed" : String(effectiveMeta.status || "active"),
      breakReason: markClosed ? reason : effectiveMeta.breakReason || null,
      assetCount: symbols.length,
      tickCount,
      candleCount,
      lastSavedAtMs: savedAtMs
    };

    this.sqlite.exec("BEGIN");
    try {
      for (const item of tickRows) {
        insertTick.run(item.sessionId, item.symbol, item.ts, item.price, item.size, item.source);
      }
      for (const item of candleRows) {
        insertCandle.run(
          item.sessionId,
          item.symbol,
          item.timeframe,
          item.timeMs,
          item.open,
          item.high,
          item.low,
          item.close,
          item.volume,
          item.source,
          item.isGapFill ? 1 : 0
        );
      }
      upsertSession.run(
        sessionPayload.id,
        sessionPayload.marketWindowStartMs,
        sessionPayload.marketWindowEndMs,
        sessionPayload.startedAtMs,
        sessionPayload.endedAtMs,
        sessionPayload.status,
        sessionPayload.breakReason,
        sessionPayload.assetCount,
        sessionPayload.tickCount,
        sessionPayload.candleCount,
        sessionPayload.lastSavedAtMs
      );
      this.sqlite.exec("COMMIT");
      this.lastSqlSaveAtMs = sessionPayload.lastSavedAtMs;
      this.lastSqlSavedSessionId = sessionPayload.id;
      console.log(
        `[sessionStore] SQL checkpoint saved session=${sessionPayload.id} savedAtMs=${sessionPayload.lastSavedAtMs} status=${sessionPayload.status}`
      );
      return sessionPayload;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  hydrateLastSqlSaveFromDb() {
    if (!this.sqlite) return;
    try {
      const row = this.sqlite
        .prepare(
          "SELECT id, COALESCE(last_saved_at_ms, ended_at_ms, started_at_ms) AS saved_ms FROM sessions ORDER BY saved_ms DESC LIMIT 1"
        )
        .get();
      if (row && Number.isFinite(Number(row.saved_ms))) {
        this.lastSqlSaveAtMs = Number(row.saved_ms);
        this.lastSqlSavedSessionId = String(row.id || "");
      }
    } catch {
      // Best-effort cache warmup for status endpoint.
    }
  }

  getPersistenceStatus() {
    return {
      redisOnline: Boolean(this.redis),
      redisUrl: this.redisUrl,
      sqliteOnline: Boolean(this.sqlite),
      sqlitePath: this.sqlitePath,
      lastSqlSaveAtMs: this.lastSqlSaveAtMs,
      lastSqlSavedSessionId: this.lastSqlSavedSessionId,
      mode: this.redis ? "persisted" : "fallback"
    };
  }

  async ensureTables() {
    if (!this.sqlite) return;
    this.sqlite.exec("PRAGMA journal_mode=WAL;");
    this.sqlite.exec("PRAGMA synchronous=NORMAL;");
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        market_window_start INTEGER NOT NULL,
        market_window_end INTEGER NOT NULL,
        started_at_ms INTEGER NOT NULL,
        ended_at_ms INTEGER,
        status TEXT NOT NULL,
        break_reason TEXT,
        asset_count INTEGER NOT NULL DEFAULT 0,
        tick_count INTEGER NOT NULL DEFAULT 0,
        candle_count INTEGER NOT NULL DEFAULT 0,
        last_saved_at_ms INTEGER
      );

      CREATE TABLE IF NOT EXISTS session_ticks (
        session_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        ts_ms INTEGER NOT NULL,
        price REAL NOT NULL,
        size REAL NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'live',
        PRIMARY KEY (session_id, symbol, ts_ms, source)
      );

      CREATE TABLE IF NOT EXISTS session_candles (
        session_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        bucket_start_ms INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'live',
        is_gap_fill INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, symbol, timeframe, bucket_start_ms)
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_started_at_ms ON sessions (started_at_ms);
      CREATE INDEX IF NOT EXISTS idx_session_ticks_lookup ON session_ticks (session_id, symbol, ts_ms);
      CREATE INDEX IF NOT EXISTS idx_session_candles_lookup ON session_candles (session_id, symbol, timeframe, bucket_start_ms);
    `);
    try {
      this.sqlite.exec("ALTER TABLE sessions ADD COLUMN last_saved_at_ms INTEGER;");
    } catch {}
  }
}

module.exports = {
  SessionStore,
  normalizeSymbol
};
