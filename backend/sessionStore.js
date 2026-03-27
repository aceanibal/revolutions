const Redis = require("ioredis");
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const { DateTime } = require("luxon");
const { upsertCandle, sortedCandlesFromMap, detectGapRanges, intervalForTimeframe } = require("./sessionMath");
const { resolvePerpCoinForInfoApi } = require("./hyperliquid");

const TIMEFRAMES = ["1m", "5m"];
const HYPERLIQUID_CANDLE_PAGE_LIMIT = 500;
const HYPERLIQUID_CANDLE_MAX_AVAILABLE = 5000;

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
    /** When true, init() skips connecting to Redis (SQLite-only consumers, e.g. backtester). */
    this.disableRedis = Boolean(options.disableRedis);
  }

  inferHyperliquidMode() {
    return String(this.hyperliquidInfoUrl || "").includes("testnet") ? "test" : "live";
  }

  async init() {
    if (!this.redis && !this.disableRedis) {
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

  sessionTradeStateKey(sessionId, mode, symbol) {
    const normalizedMode = String(mode || "").toLowerCase() === "test" ? "test" : "live";
    return `session:${sessionId}:tradeState:${normalizedMode}:${normalizeSymbol(symbol)}`;
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

  /**
   * Fetches candle history from Hyperliquid info API.
   * The endpoint is paginated: up to 500 rows per response, with up to 5000 recent candles available.
   * On network/HTTP/parse failure returns { ok: false, candles: [] } so callers do not treat
   * an error the same as a legitimately empty snapshot (avoids marking history "loaded" with no data).
   */
  async fetchHistoricalCandles(symbol, timeframe, options = {}) {
    const upper = normalizeSymbol(symbol);
    if (!upper) return { ok: false, candles: [] };

    const infoCoin = await resolvePerpCoinForInfoApi(upper, this.inferHyperliquidMode());
    const intervalMs = intervalForTimeframe(timeframe);
    const startTimeMsRaw = Number(options.startTimeMs);
    const startTimeMs = Number.isFinite(startTimeMsRaw) ? Math.max(0, Math.floor(startTimeMsRaw)) : 0;
    const endTimeMsRaw = Number(options.endTimeMs);
    const endTimeMs = Number.isFinite(endTimeMsRaw) ? Math.floor(endTimeMsRaw) : Date.now();
    if (endTimeMs <= startTimeMs) {
      return { ok: true, candles: [] };
    }

    const normalizeCandlesArray = (payload) => {
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
    };

    try {
      const byTimeMs = new Map();
      let requestStartMs = startTimeMs;
      let totalRows = 0;

      while (requestStartMs <= endTimeMs && totalRows < HYPERLIQUID_CANDLE_MAX_AVAILABLE) {
        const response = await fetch(this.hyperliquidInfoUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "candleSnapshot",
            req: {
              coin: infoCoin,
              interval: timeframe,
              startTime: requestStartMs,
              endTime: endTimeMs
            }
          })
        });

        if (!response.ok) {
          return { ok: false, candles: [] };
        }

        const payload = await response.json();
        const pageCandles = normalizeCandlesArray(payload);
        if (pageCandles.length === 0) break;

        for (const candle of pageCandles) {
          if (candle.timeMs < startTimeMs || candle.timeMs > endTimeMs) continue;
          byTimeMs.set(candle.timeMs, candle);
        }

        totalRows += pageCandles.length;
        if (pageCandles.length < HYPERLIQUID_CANDLE_PAGE_LIMIT) break;

        const lastTimeMs = Number(pageCandles[pageCandles.length - 1]?.timeMs);
        if (!Number.isFinite(lastTimeMs)) break;
        const nextStartMs = lastTimeMs + intervalMs;
        if (!Number.isFinite(nextStartMs) || nextStartMs <= requestStartMs) break;
        requestStartMs = nextStartMs;
      }

      const candles = Array.from(byTimeMs.values()).sort((a, b) => a.timeMs - b.timeMs);
      return { ok: true, candles };
    } catch {
      return { ok: false, candles: [] };
    }
  }

  mergeHistoryCandle(
    existing,
    incoming,
    bucketStart,
    sourceOverride = null,
    isGapFillFlag = false,
    reconcileClosedLive = false
  ) {
    if (!existing) {
      return {
        timeMs: bucketStart,
        open: incoming.open,
        high: incoming.high,
        low: incoming.low,
        close: incoming.close,
        volume: incoming.volume,
        source: sourceOverride || "history",
        isGapFill: isGapFillFlag
      };
    }

    // Mark-price ticks create a "live" bucket every minute for liquid names (e.g. BTC). For bars that
    // are fully in the past, REST history is authoritative; without this we skip the API row entirely
    // and can keep sparse or wrong OHLC vs exchange candles.
    if (reconcileClosedLive) {
      return {
        timeMs: bucketStart,
        open: incoming.open,
        high: incoming.high,
        low: incoming.low,
        close: incoming.close,
        volume: Math.max(Number(existing.volume ?? 0), Number(incoming.volume ?? 0)),
        source: "mixed",
        isGapFill: isGapFillFlag || Boolean(existing.isGapFill)
      };
    }

    const source = sourceOverride || (existing.source === "history" ? "history" : "mixed");
    return {
      ...existing,
      timeMs: bucketStart,
      high: Math.max(Number(existing.high ?? incoming.high), incoming.high),
      low: Math.min(Number(existing.low ?? incoming.low), incoming.low),
      close: existing.source === "live" || existing.source === "mixed" ? existing.close : incoming.close,
      volume: Math.max(Number(existing.volume ?? 0), Number(incoming.volume ?? 0)),
      source,
      isGapFill: isGapFillFlag || Boolean(existing.isGapFill)
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
    const sessionMeta = await this.redis.hgetall(this.sessionMetaKey(sessionId));
    const historyStartMs = Number(sessionMeta?.marketWindowStartMs || 0) || 0;
    const historyEndMs = Date.now();

    console.log(
      `[sessionStore] Preload start symbol=${upper} session=${sessionId} force=${force}`
    );

    const multi = this.redis.multi();
    multi.sadd(this.sessionSymbolsKey(sessionId), upper);
    multi.expire(this.sessionSymbolsKey(sessionId), this.sameDayTtlSeconds);
    await multi.exec();

    // Phase 1: Live data — already streaming via WebSocket before this method is called
    console.log(`[sessionStore] Phase 1 (live): streaming active for ${upper}`);

    // Phase 2 + 3: Gap fill then historical backfill, per timeframe.
    // A single API fetch per timeframe is classified by position relative to live data.
    const phaseCounts = {};
    for (const timeframe of TIMEFRAMES) {
      const phase = await this.preloadHistoricalTimeframe(sessionId, upper, timeframe, {
        force,
        historyStartMs,
        historyEndMs
      });
      phaseCounts[timeframe] = phase;
      if (phase.skippedEntirely) {
        const repaired = await this.reconcileClosedLiveFromApi(sessionId, upper, timeframe, {
          startTimeMs: historyStartMs,
          endTimeMs: historyEndMs
        });
        const gapFilledAfterSkip = await this.fillGapRanges(sessionId, upper, timeframe, {
          startTimeMs: historyStartMs,
          endTimeMs: historyEndMs
        });
        phaseCounts[timeframe] = { ...phase, reconcileAfterSkip: repaired, gapFilledAfterSkip };
      }
    }

    const sessionInfo = await this.getSessionInfo(sessionId);
    const summary = TIMEFRAMES.map((tf) => {
      const p = phaseCounts[tf];
      const extra =
        typeof p.reconcileAfterSkip === "number" && p.reconcileAfterSkip > 0
          ? ` reconcileSkip=${p.reconcileAfterSkip}`
          : "";
      const gapAfterSkip = typeof p.gapFilledAfterSkip === "number" ? p.gapFilledAfterSkip : 0;
      return `${tf}=[gap=${p.gapFill} hist=${p.history} skipLive=${p.skippedLive} reconciled=${p.reconciledClosedLive ?? 0} gapRepair=${p.gapRepaired ?? 0} gapSkip=${gapAfterSkip}${extra}]`;
    }).join(" ");
    console.log(
      `[sessionStore] Preload complete symbol=${upper} session=${sessionId} ${summary}`
    );
    return { sessionId, sessionInfo };
  }

  async preloadHistoricalTimeframe(sessionId, symbol, timeframe, options = {}) {
    const force = Boolean(options.force);
    const historyStartMs = Number(options.historyStartMs);
    const historyEndMs = Number(options.historyEndMs);
    const loadedKey = this.historyLoadedKey(sessionId, symbol, timeframe);
    const candlesKey = this.sessionCandlesKey(sessionId, symbol, timeframe);
    const alreadyLoaded = await this.redis.get(loadedKey);
    if (alreadyLoaded === "1" && !force) {
      const storedCount = await this.redis.hlen(candlesKey);
      if (storedCount > 0) {
        console.log(
          `[sessionStore] Preload skip ${symbol} ${timeframe} (already loaded)`
        );
        return {
          gapFill: 0,
          history: 0,
          skippedLive: 0,
          reconciledClosedLive: 0,
          skippedEntirely: true
        };
      }
      await this.redis.del(loadedKey);
      console.log(
        `[sessionStore] Preload retry ${symbol} ${timeframe} (historyLoaded set but no candles; refetching)`
      );
    }

    const { ok: historyOk, candles: history } = await this.fetchHistoricalCandles(symbol, timeframe, {
      startTimeMs: Number.isFinite(historyStartMs) ? historyStartMs : 0,
      endTimeMs: Number.isFinite(historyEndMs) ? historyEndMs : Date.now()
    });
    console.log(
      `[sessionStore] Fetched ${history.length} API candles for ${symbol} ${timeframe} ok=${historyOk}`
    );
    if (!historyOk) {
      return {
        gapFill: 0,
        history: 0,
        skippedLive: 0,
        reconciledClosedLive: 0,
        skippedEntirely: false
      };
    }
    if (history.length === 0) {
      await this.redis.set(loadedKey, "1", "EX", this.sameDayTtlSeconds);
      return {
        gapFill: 0,
        history: 0,
        skippedLive: 0,
        reconciledClosedLive: 0,
        skippedEntirely: false
      };
    }

    const intervalMs = intervalForTimeframe(timeframe);
    const key = this.sessionCandlesKey(sessionId, symbol, timeframe);

    // Snapshot existing candles to identify live data boundaries
    const existingRaw = await this.redis.hgetall(key);
    const existingBuckets = new Map();
    for (const [bucket, raw] of Object.entries(existingRaw || {})) {
      const parsed = parseSafeJson(raw);
      if (parsed) existingBuckets.set(Number(bucket), parsed);
    }

    // Determine live data boundaries for gap vs history classification
    const liveBucketTimes = [];
    for (const [bucket, candle] of existingBuckets) {
      if (candle.source === "live" || candle.source === "mixed") {
        liveBucketTimes.push(bucket);
      }
    }
    liveBucketTimes.sort((a, b) => a - b);
    const liveMinMs = liveBucketTimes.length > 0 ? liveBucketTimes[0] : Infinity;
    const liveMaxMs = liveBucketTimes.length > 0 ? liveBucketTimes[liveBucketTimes.length - 1] : -Infinity;

    // Phase 2 (gap fill) + Phase 3 (history backfill) via pipeline.
    // HSETNX for new buckets prevents overwriting concurrent live tick writes.
    const pipeline = this.redis.pipeline();
    let gapFillCount = 0;
    let historyCount = 0;
    let skippedLiveCount = 0;
    let reconciledClosedLiveCount = 0;
    let pipelineOps = 0;
    const nowMs = Date.now();

    for (const candle of history) {
      const bucketStart = Math.floor(candle.timeMs / intervalMs) * intervalMs;
      const existing = existingBuckets.get(bucketStart);
      const bucketEndMs = bucketStart + intervalMs;
      const isClosedBucket = bucketEndMs <= nowMs;

      if (
        existing &&
        (existing.source === "live" || existing.source === "mixed") &&
        !isClosedBucket
      ) {
        skippedLiveCount++;
        continue;
      }

      const isGapFill = bucketStart > liveMinMs && bucketStart < liveMaxMs;
      const source = isGapFill ? "gap_fill" : "history";

      const reconcileClosedLive =
        Boolean(existing) &&
        isClosedBucket &&
        (existing.source === "live" || existing.source === "mixed");
      if (reconcileClosedLive) {
        reconciledClosedLiveCount++;
      }

      const merged = existing
        ? this.mergeHistoryCandle(existing, candle, bucketStart, source, isGapFill, reconcileClosedLive)
        : {
            timeMs: bucketStart,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
            source,
            isGapFill
          };

      if (!existing) {
        pipeline.hsetnx(key, String(bucketStart), JSON.stringify(merged));
      } else {
        pipeline.hset(key, String(bucketStart), JSON.stringify(merged));
      }
      pipelineOps++;

      if (isGapFill) {
        gapFillCount++;
      } else {
        historyCount++;
      }
    }

    if (pipelineOps > 0) {
      await pipeline.exec();
      await this.redis.expire(key, this.sameDayTtlSeconds);
    }

    await this.redis.set(loadedKey, "1", "EX", this.sameDayTtlSeconds);

    if (gapFillCount > 0) {
      console.log(
        `[sessionStore] Phase 2 (gap_fill): ${symbol} ${timeframe} filled=${gapFillCount} candles between live [${liveMinMs}..${liveMaxMs}]`
      );
    }
    console.log(
      `[sessionStore] Phase 3 (history): ${symbol} ${timeframe} backfilled=${historyCount} skippedLive=${skippedLiveCount} reconciledClosedLive=${reconciledClosedLiveCount}`
    );

    const gapRepaired = await this.fillGapRanges(sessionId, symbol, timeframe, {
      startTimeMs: Number.isFinite(historyStartMs) ? historyStartMs : 0,
      endTimeMs: Number.isFinite(historyEndMs) ? historyEndMs : Date.now()
    });
    await this.updateGapRanges(sessionId, symbol, timeframe);
    return {
      gapFill: gapFillCount,
      history: historyCount,
      skippedLive: skippedLiveCount,
      reconciledClosedLive: reconciledClosedLiveCount,
      gapRepaired,
      skippedEntirely: false
    };
  }

  /**
   * For symbols with dense mark-price ticks, Redis may hold "live"/"mixed" buckets for past minutes
   * while preload is skipped (historyLoaded). Overlay REST OHLC for those closed buckets only.
   */
  async reconcileClosedLiveFromApi(sessionId, symbol, timeframe, options = {}) {
    if (!this.redis || !sessionId || !symbol) return 0;
    const upper = normalizeSymbol(symbol);
    if (!upper) return 0;

    const intervalMs = intervalForTimeframe(timeframe);
    const key = this.sessionCandlesKey(sessionId, upper, timeframe);
    const nowMs = Date.now();
    const { ok: historyOk, candles: history } = await this.fetchHistoricalCandles(upper, timeframe, options);
    if (!historyOk || history.length === 0) return 0;

    const existingRaw = await this.redis.hgetall(key);
    if (!existingRaw || Object.keys(existingRaw).length === 0) return 0;

    const pipeline = this.redis.pipeline();
    let pipelineOps = 0;
    let repaired = 0;

    for (const candle of history) {
      const bucketStart = Math.floor(candle.timeMs / intervalMs) * intervalMs;
      if (bucketStart + intervalMs > nowMs) continue;

      const raw = existingRaw[String(bucketStart)];
      if (!raw) continue;
      const existing = parseSafeJson(raw);
      if (!existing || (existing.source !== "live" && existing.source !== "mixed")) continue;

      const merged = this.mergeHistoryCandle(
        existing,
        candle,
        bucketStart,
        "history",
        Boolean(existing.isGapFill),
        true
      );
      pipeline.hset(key, String(bucketStart), JSON.stringify(merged));
      pipelineOps++;
      repaired++;
    }

    if (pipelineOps > 0) {
      await pipeline.exec();
      await this.redis.expire(key, this.sameDayTtlSeconds);
      await this.updateGapRanges(sessionId, upper, timeframe);
      console.log(
        `[sessionStore] Closed-live reconcile (skip path) symbol=${upper} ${timeframe} buckets=${repaired} session=${sessionId}`
      );
    }
    return repaired;
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

  async fillGapRanges(sessionId, symbol, timeframe, options = {}) {
    if (!this.redis || !sessionId || !symbol) return 0;
    const intervalMs = intervalForTimeframe(timeframe);
    const candles = await this.getCandles(sessionId, symbol, timeframe);
    const gaps = detectGapRanges(candles, intervalMs);
    if (gaps.length === 0) return 0;

    const { ok: historyOk, candles: history } = await this.fetchHistoricalCandles(symbol, timeframe, options);
    if (!historyOk || history.length === 0) return 0;

    const gapSet = new Set();
    for (const gap of gaps) {
      for (let t = gap.fromTimeMs; t <= gap.toTimeMs; t += intervalMs) {
        gapSet.add(t);
      }
    }

    const key = this.sessionCandlesKey(sessionId, symbol, timeframe);
    const pipeline = this.redis.pipeline();
    let filled = 0;

    for (const candle of history) {
      const bucketStart = Math.floor(candle.timeMs / intervalMs) * intervalMs;
      if (!gapSet.has(bucketStart)) continue;

      const merged = {
        timeMs: bucketStart,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        source: "gap_fill",
        isGapFill: true
      };
      pipeline.hsetnx(key, String(bucketStart), JSON.stringify(merged));
      filled++;
    }

    if (filled > 0) {
      await pipeline.exec();
      await this.redis.expire(key, this.sameDayTtlSeconds);
      await this.updateGapRanges(sessionId, symbol, timeframe);
      console.log(
        `[sessionStore] fillGapRanges ${symbol} ${timeframe}: attempted=${filled} across ${gaps.length} gaps`
      );
    }
    return filled;
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

  /**
   * Persist which symbols are actively streamed + primary chart symbol (for restore after save/restart).
   */
  async writeActiveStreamsSnapshot({ symbols = [], primary = "" } = {}) {
    if (!this.redis) return { ok: false, reason: "no_redis" };
    const sessionId = await this.getCurrentSessionId();
    if (!sessionId) return { ok: false, reason: "no_session" };
    const norm = Array.from(new Set((symbols || []).map(normalizeSymbol).filter(Boolean)));
    const prim = normalizeSymbol(primary) || norm[0] || "";
    const payload = JSON.stringify({ symbols: norm, primary: prim });
    const metaKey = this.sessionMetaKey(sessionId);
    await this.redis.hset(metaKey, "activeStreamsJson", payload);
    await this.redis.expire(metaKey, this.sameDayTtlSeconds);
    return { ok: true, sessionId };
  }

  async getStartupSymbols() {
    const normalizeUnique = (values) =>
      Array.from(new Set((values || []).map(normalizeSymbol).filter(Boolean)));

    const currentSessionId = await this.getCurrentSessionId();
    if (currentSessionId && this.redis) {
      const meta = await this.redis.hgetall(this.sessionMetaKey(currentSessionId));
      const rawMeta = meta?.activeStreamsJson;
      if (rawMeta) {
        try {
          const parsed = JSON.parse(rawMeta);
          const syms = normalizeUnique(parsed.symbols);
          const primary = normalizeSymbol(parsed.primary || "") || syms[0] || "";
          if (syms.length > 0) {
            return {
              symbols: syms,
              primary,
              source: "redis_active_streams",
              sessionId: currentSessionId
            };
          }
        } catch {
          /* fall through */
        }
      }
      const redisSymbols = normalizeUnique(await this.redis.smembers(this.sessionSymbolsKey(currentSessionId)));
      if (redisSymbols.length > 0) {
        return {
          symbols: redisSymbols,
          primary: redisSymbols[0] || "",
          source: "redis",
          sessionId: currentSessionId
        };
      }
    }

    if (!this.sqlite) {
      return { symbols: [], primary: "", source: "none", sessionId: null };
    }

    let latestRow = null;
    try {
      latestRow = this.sqlite
        .prepare(
          "SELECT id, active_streams_json FROM sessions ORDER BY COALESCE(last_saved_at_ms, ended_at_ms, started_at_ms) DESC LIMIT 1"
        )
        .get();
    } catch {
      latestRow = this.sqlite
        .prepare(
          "SELECT id FROM sessions ORDER BY COALESCE(last_saved_at_ms, ended_at_ms, started_at_ms) DESC LIMIT 1"
        )
        .get();
    }
    const latestSessionId = latestRow?.id ? String(latestRow.id) : null;
    if (!latestSessionId) {
      return { symbols: [], primary: "", source: "none", sessionId: null };
    }

    const sqlMetaRaw =
      latestRow && Object.prototype.hasOwnProperty.call(latestRow, "active_streams_json") && latestRow.active_streams_json
        ? String(latestRow.active_streams_json)
        : "";
    if (sqlMetaRaw) {
      try {
        const parsed = JSON.parse(sqlMetaRaw);
        const syms = normalizeUnique(parsed.symbols);
        const primary = normalizeSymbol(parsed.primary || "") || syms[0] || "";
        if (syms.length > 0) {
          return {
            symbols: syms,
            primary,
            source: "sql_active_streams",
            sessionId: latestSessionId
          };
        }
      } catch {
        /* fall through */
      }
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
      return {
        symbols: sqlSymbols,
        primary: sqlSymbols[0] || "",
        source: "sql",
        sessionId: latestSessionId
      };
    }

    return { symbols: [], primary: "", source: "none", sessionId: latestSessionId };
  }

  async getCurrentSessionSnapshot(symbol, timeframe = "1m") {
    if (!this.redis) return null;
    const sessionId = await this.getCurrentSessionId();
    if (!sessionId) return null;
    return this.getSessionSnapshot(sessionId, symbol, timeframe);
  }

  async getSessionSnapshot(sessionId, symbol, timeframe = "1m") {
    const upper = normalizeSymbol(symbol);
    if (!upper) return null;
    let sessionInfo = await this.getSessionInfo(sessionId);
    if (!sessionInfo && this.sqlite) {
      const row = this.sqlite
        .prepare(
          "SELECT id, started_at_ms, ended_at_ms, status, break_reason, asset_count, candle_count FROM sessions WHERE id = ? LIMIT 1"
        )
        .get(sessionId);
      if (row?.id) {
        sessionInfo = {
          id: String(row.id || ""),
          status: String(row.status || "closed"),
          startedAtMs: Number(row.started_at_ms || 0),
          endedAtMs: row.ended_at_ms ? Number(row.ended_at_ms) : null,
          lastEventAtMs: null,
          assetCount: Number(row.asset_count || 0),
          candleCount: Number(row.candle_count || 0),
          breakReason: row.break_reason || null
        };
      }
    }
    if (!sessionInfo) return null;

    /** Live window: Redis may have newer ticks. Any other session: prefer SQLite so Study matches `session_candles` (and backtest imports), not stale tick-built Redis OHLC. */
    const liveSessionId = this.redis ? await this.getCurrentSessionId() : null;
    const isCurrentLiveSession = liveSessionId != null && sessionId === liveSessionId;

    const mapSqlCandles = (rows) =>
      rows.map((row) => ({
        timeMs: Number(row.bucket_start_ms || 0),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume || 0),
        source: row.source || "history",
        isGapFill: Boolean(row.is_gap_fill)
      }));

    const getCandlesForTimeframe = async (tf) => {
      const sqlRows = this.sqlite
        ? this.sqlite
            .prepare(
              `
            SELECT
              bucket_start_ms,
              open,
              high,
              low,
              close,
              volume,
              source,
              is_gap_fill
            FROM session_candles
            WHERE session_id = ? AND symbol = ? AND timeframe = ?
            ORDER BY bucket_start_ms ASC
          `
            )
            .all(sessionId, upper, tf)
        : [];
      const sqlCandles = mapSqlCandles(sqlRows);
      if (!isCurrentLiveSession && sqlCandles.length > 0) {
        return sqlCandles;
      }

      const redisCandles = await this.getCandles(sessionId, upper, tf);
      if (redisCandles.length > 0 || !this.sqlite) return redisCandles;
      return sqlCandles;
    };

    const getGapsForTimeframe = async (tf, candles) => {
      if (!isCurrentLiveSession && candles.length > 0) {
        return detectGapRanges(candles, intervalForTimeframe(tf));
      }
      const redisGaps = await this.getGaps(sessionId, upper, tf);
      if (redisGaps.length > 0 || !this.sqlite) return redisGaps;
      return detectGapRanges(candles, intervalForTimeframe(tf));
    };

    if (timeframe === "all") {
      const candles1m = await getCandlesForTimeframe("1m");
      const candles5m = await getCandlesForTimeframe("5m");
      const gaps1m = await getGapsForTimeframe("1m", candles1m);
      const gaps5m = await getGapsForTimeframe("5m", candles5m);
      return {
        sessionInfo,
        symbol: upper,
        candlesByTimeframe: { "1m": candles1m, "5m": candles5m },
        gapsByTimeframe: { "1m": gaps1m, "5m": gaps5m }
      };
    }

    const candles = await getCandlesForTimeframe(timeframe);
    const gaps = await getGapsForTimeframe(timeframe, candles);
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

  async listAllSessions() {
    if (!this.sqlite) return [];
    const rows = this.sqlite
      .prepare(
        `
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
          ORDER BY s.started_at_ms DESC
        `
      )
      .all();
    return rows.map((row) => ({
      id: String(row.id || ""),
      status: String(row.status || "closed"),
      startedAtMs: Number(row.started_at_ms || 0),
      endedAtMs: row.ended_at_ms ? Number(row.ended_at_ms) : null,
      lastEventAtMs: null,
      assetCount: Number(row.asset_count || 0),
      candleCount: Number(row.candle_count || 0),
      breakReason: row.break_reason || null,
      notes: String(row.notes || ""),
      tradeCount: Number(row.trade_count || 0)
    }));
  }

  async persistTrades(sessionId, trades, mode = "live") {
    if (!this.sqlite || !sessionId || !Array.isArray(trades) || trades.length === 0) return 0;
    const normalizedSessionId = String(sessionId).trim();
    if (!normalizedSessionId) return 0;
    const normalizedMode = mode === "test" ? "test" : "live";

    const insertTrade = this.sqlite.prepare(
      `
        INSERT OR IGNORE INTO session_trades (
          session_id,
          mode,
          coin,
          side,
          dir,
          px,
          sz,
          time_ms,
          fee,
          fee_token,
          closed_pnl,
          crossed,
          oid,
          tid
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    );

    let inserted = 0;
    this.sqlite.exec("BEGIN");
    try {
      for (const trade of trades) {
        const timeMs = Number(trade?.time ?? 0);
        const coin = normalizeSymbol(trade?.coin);
        if (!coin || !Number.isFinite(timeMs) || timeMs <= 0) continue;
        const result = insertTrade.run(
          normalizedSessionId,
          normalizedMode,
          coin,
          String(trade?.side ?? ""),
          String(trade?.dir ?? ""),
          Number(trade?.px ?? 0),
          Number(trade?.sz ?? 0),
          timeMs,
          Number(trade?.fee ?? 0),
          String(trade?.feeToken ?? "USDC"),
          Number(trade?.closedPnl ?? 0),
          Boolean(trade?.crossed) ? 1 : 0,
          trade?.oid == null ? "" : String(trade.oid),
          trade?.tid == null ? "" : String(trade.tid)
        );
        inserted += Number(result?.changes || 0);
      }
      this.sqlite.exec("COMMIT");
      return inserted;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  async persistTradeStateSnapshots(sessionId, snapshots = []) {
    if (!sessionId || !Array.isArray(snapshots) || snapshots.length === 0) return 0;
    const normalizedSessionId = String(sessionId).trim();
    if (!normalizedSessionId) return 0;

    const normalizedRows = snapshots
      .map((snapshot) => {
        const symbol = normalizeSymbol(snapshot?.symbol);
        if (!symbol) return null;
        const mode = String(snapshot?.mode || "").toLowerCase() === "test" ? "test" : "live";
        return {
          sessionId: normalizedSessionId,
          mode,
          symbol,
          status: String(snapshot?.status || "FLAT"),
          side: String(snapshot?.side || ""),
          size: Number(snapshot?.size ?? 0) || 0,
          entryPx: Number(snapshot?.entryPx ?? 0) || 0,
          stopLoss: Number(snapshot?.stopLoss ?? 0) || 0,
          stopLossFromPendingOrders: Number(snapshot?.stopLossFromPendingOrders ?? 0) || 0,
          takeProfitFromPendingOrders: Number(snapshot?.takeProfitFromPendingOrders ?? 0) || 0,
          stopOrderRefJson: JSON.stringify(snapshot?.stopOrderRef || null),
          pendingOrdersJson: JSON.stringify(Array.isArray(snapshot?.pendingOrders) ? snapshot.pendingOrders : []),
          executionMetaJson: JSON.stringify(snapshot?.executionMeta || {}),
          lastAction: String(snapshot?.lastAction || ""),
          error: String(snapshot?.error || ""),
          updatedAtMs: Number(snapshot?.updatedAt || Date.now()) || Date.now(),
          rawJson: JSON.stringify(snapshot || {})
        };
      })
      .filter(Boolean);

    if (normalizedRows.length === 0) return 0;

    if (this.redis) {
      const pipeline = this.redis.multi();
      for (const row of normalizedRows) {
        const key = this.sessionTradeStateKey(row.sessionId, row.mode, row.symbol);
        pipeline.set(key, row.rawJson, "EX", this.sameDayTtlSeconds);
      }
      await pipeline.exec();
    }

    if (!this.sqlite) return normalizedRows.length;

    const upsert = this.sqlite.prepare(
      `
        INSERT INTO session_trade_state (
          session_id,
          mode,
          symbol,
          status,
          side,
          size,
          entry_px,
          stop_loss,
          stop_loss_from_pending_orders,
          take_profit_from_pending_orders,
          stop_order_ref_json,
          pending_orders_json,
          execution_meta_json,
          last_action,
          error,
          updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, mode, symbol) DO UPDATE SET
          status = excluded.status,
          side = excluded.side,
          size = excluded.size,
          entry_px = excluded.entry_px,
          stop_loss = excluded.stop_loss,
          stop_loss_from_pending_orders = excluded.stop_loss_from_pending_orders,
          take_profit_from_pending_orders = excluded.take_profit_from_pending_orders,
          stop_order_ref_json = excluded.stop_order_ref_json,
          pending_orders_json = excluded.pending_orders_json,
          execution_meta_json = excluded.execution_meta_json,
          last_action = excluded.last_action,
          error = excluded.error,
          updated_at_ms = excluded.updated_at_ms
      `
    );

    let saved = 0;
    this.sqlite.exec("BEGIN");
    try {
      for (const row of normalizedRows) {
        const result = upsert.run(
          row.sessionId,
          row.mode,
          row.symbol,
          row.status,
          row.side,
          row.size,
          row.entryPx,
          row.stopLoss,
          row.stopLossFromPendingOrders,
          row.takeProfitFromPendingOrders,
          row.stopOrderRefJson,
          row.pendingOrdersJson,
          row.executionMetaJson,
          row.lastAction,
          row.error,
          row.updatedAtMs
        );
        saved += Number(result?.changes || 0);
      }
      this.sqlite.exec("COMMIT");
      return saved;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  async getSessionTradeState(sessionId, options = {}) {
    if (!this.sqlite || !sessionId) return [];
    const normalizedSessionId = String(sessionId).trim();
    if (!normalizedSessionId) return [];

    const symbol = normalizeSymbol(options?.symbol || "");
    const modeRaw = String(options?.mode || "").toLowerCase();
    const mode = modeRaw === "test" || modeRaw === "live" ? modeRaw : "";

    const hasMode = Boolean(mode);
    const hasSymbol = Boolean(symbol);
    let rows = [];
    if (hasMode && hasSymbol) {
      rows = this.sqlite
        .prepare(
          `
            SELECT *
            FROM session_trade_state
            WHERE session_id = ? AND mode = ? AND symbol = ?
            ORDER BY updated_at_ms DESC
          `
        )
        .all(normalizedSessionId, mode, symbol);
    } else if (hasMode) {
      rows = this.sqlite
        .prepare(
          `
            SELECT *
            FROM session_trade_state
            WHERE session_id = ? AND mode = ?
            ORDER BY updated_at_ms DESC, symbol ASC
          `
        )
        .all(normalizedSessionId, mode);
    } else if (hasSymbol) {
      rows = this.sqlite
        .prepare(
          `
            SELECT *
            FROM session_trade_state
            WHERE session_id = ? AND symbol = ?
            ORDER BY updated_at_ms DESC
          `
        )
        .all(normalizedSessionId, symbol);
    } else {
      rows = this.sqlite
        .prepare(
          `
            SELECT *
            FROM session_trade_state
            WHERE session_id = ?
            ORDER BY updated_at_ms DESC, symbol ASC
          `
        )
        .all(normalizedSessionId);
    }

    return rows.map((row) => ({
      sessionId: String(row.session_id || ""),
      mode: String(row.mode || "live"),
      symbol: String(row.symbol || ""),
      status: String(row.status || "FLAT"),
      side: row.side ? String(row.side) : null,
      size: Number(row.size || 0),
      entryPx: Number(row.entry_px || 0),
      stopLoss: Number(row.stop_loss || 0),
      stopLossFromPendingOrders: Number(row.stop_loss_from_pending_orders ?? 0) || 0,
      takeProfitFromPendingOrders: Number(row.take_profit_from_pending_orders ?? 0) || 0,
      stopOrderRef: parseSafeJson(row.stop_order_ref_json || "null", null),
      pendingOrders: parseSafeJson(row.pending_orders_json || "[]", []),
      executionMeta: parseSafeJson(row.execution_meta_json || "{}", {}),
      lastAction: String(row.last_action || ""),
      error: row.error ? String(row.error) : null,
      updatedAt: Number(row.updated_at_ms || 0)
    }));
  }

  async getSessionTrades(sessionId) {
    if (!this.sqlite || !sessionId) return [];
    const normalizedSessionId = String(sessionId).trim();
    if (!normalizedSessionId) return [];
    const rows = this.sqlite
      .prepare(
        `
          SELECT
            mode,
            coin,
            side,
            dir,
            px,
            sz,
            time_ms,
            fee,
            fee_token,
            closed_pnl,
            crossed,
            oid,
            tid
          FROM session_trades
          WHERE session_id = ?
          ORDER BY time_ms DESC
        `
      )
      .all(normalizedSessionId);

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

  async getSessionSymbols(sessionId) {
    if (!sessionId) return [];
    const normalizedSessionId = String(sessionId).trim();
    if (!normalizedSessionId) return [];

    if (this.redis) {
      const redisSymbols = await this.redis.smembers(this.sessionSymbolsKey(normalizedSessionId));
      const normalizedRedis = Array.from(new Set(redisSymbols.map(normalizeSymbol).filter(Boolean)));
      if (normalizedRedis.length > 0) {
        return normalizedRedis;
      }
    }

    if (!this.sqlite) return [];
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
      .all(normalizedSessionId, normalizedSessionId);
    return Array.from(new Set(rows.map((row) => normalizeSymbol(row.symbol)).filter(Boolean)));
  }

  async getSessionNotes(sessionId) {
    if (!this.sqlite || !sessionId) return "";
    const normalizedSessionId = String(sessionId).trim();
    if (!normalizedSessionId) return "";
    const row = this.sqlite
      .prepare("SELECT notes FROM session_notes WHERE session_id = ? LIMIT 1")
      .get(normalizedSessionId);
    return row?.notes ? String(row.notes) : "";
  }

  async saveSessionNotes(sessionId, notes) {
    if (!this.sqlite || !sessionId) return null;
    const normalizedSessionId = String(sessionId).trim();
    if (!normalizedSessionId) return null;
    const normalizedNotes = String(notes || "");
    const nowMs = Date.now();
    this.sqlite
      .prepare(
        `
          INSERT INTO session_notes (session_id, notes, updated_at_ms)
          VALUES (?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            notes = excluded.notes,
            updated_at_ms = excluded.updated_at_ms
        `
      )
      .run(normalizedSessionId, normalizedNotes, nowMs);
    return {
      sessionId: normalizedSessionId,
      notes: normalizedNotes,
      updatedAtMs: nowMs
    };
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

  async resaveAllRedisSessions() {
    if (!this.redis || !this.sqlite) return { ok: false, reason: "no_redis_or_sqlite" };
    const metaKeys = await this.redis.keys("session:*:meta");
    const results = [];
    for (const key of metaKeys) {
      const id = await this.redis.hget(key, "id");
      if (!id) continue;
      try {
        const payload = await this.persistSessionToSql(id, { markClosed: false, savedAtMs: Date.now() });
        results.push({ sessionId: id, ok: !!payload });
      } catch (err) {
        results.push({ sessionId: id, ok: false, error: err.message });
      }
    }
    console.log(`[sessionStore] resaveAllRedisSessions: processed ${results.length} sessions`);
    return { ok: true, sessions: results };
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
      "INSERT OR REPLACE INTO session_ticks (session_id, symbol, ts_ms, price, size, source) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertCandle = this.sqlite.prepare(
      `INSERT INTO session_candles (session_id, symbol, timeframe, bucket_start_ms, open, high, low, close, volume, source, is_gap_fill)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, symbol, timeframe, bucket_start_ms) DO UPDATE SET
         open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close,
         volume=excluded.volume, source=excluded.source, is_gap_fill=excluded.is_gap_fill`
    );
    const upsertSession = this.sqlite.prepare(
      `INSERT INTO sessions (id, market_window_start, market_window_end, started_at_ms, ended_at_ms, status, break_reason, asset_count, tick_count, candle_count, last_saved_at_ms, active_streams_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         ended_at_ms=excluded.ended_at_ms,
         status=excluded.status,
         break_reason=excluded.break_reason,
         asset_count=excluded.asset_count,
         tick_count=excluded.tick_count,
         candle_count=excluded.candle_count,
         last_saved_at_ms=excluded.last_saved_at_ms,
         active_streams_json=excluded.active_streams_json`
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
      lastSavedAtMs: savedAtMs,
      activeStreamsJson: String(effectiveMeta.activeStreamsJson || "")
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
        sessionPayload.lastSavedAtMs,
        sessionPayload.activeStreamsJson
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

      CREATE TABLE IF NOT EXISTS session_notes (
        session_id TEXT PRIMARY KEY,
        notes TEXT NOT NULL DEFAULT '',
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_trades (
        session_id TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'live',
        coin TEXT NOT NULL,
        side TEXT NOT NULL,
        dir TEXT NOT NULL DEFAULT '',
        px REAL NOT NULL,
        sz REAL NOT NULL,
        time_ms INTEGER NOT NULL,
        fee REAL NOT NULL DEFAULT 0,
        fee_token TEXT NOT NULL DEFAULT 'USDC',
        closed_pnl REAL NOT NULL DEFAULT 0,
        crossed INTEGER NOT NULL DEFAULT 0,
        oid TEXT NOT NULL DEFAULT '',
        tid TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (session_id, mode, time_ms, coin, side, px, sz, oid, tid)
      );

      CREATE TABLE IF NOT EXISTS session_trade_state (
        session_id TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'live',
        symbol TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'FLAT',
        side TEXT NOT NULL DEFAULT '',
        size REAL NOT NULL DEFAULT 0,
        entry_px REAL NOT NULL DEFAULT 0,
        stop_loss REAL NOT NULL DEFAULT 0,
        stop_loss_from_pending_orders REAL NOT NULL DEFAULT 0,
        take_profit_from_pending_orders REAL NOT NULL DEFAULT 0,
        stop_order_ref_json TEXT NOT NULL DEFAULT '',
        pending_orders_json TEXT NOT NULL DEFAULT '[]',
        execution_meta_json TEXT NOT NULL DEFAULT '{}',
        last_action TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (session_id, mode, symbol)
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_started_at_ms ON sessions (started_at_ms);
      CREATE INDEX IF NOT EXISTS idx_session_ticks_lookup ON session_ticks (session_id, symbol, ts_ms);
      CREATE INDEX IF NOT EXISTS idx_session_candles_lookup ON session_candles (session_id, symbol, timeframe, bucket_start_ms);
      CREATE INDEX IF NOT EXISTS idx_session_notes_updated_at_ms ON session_notes (updated_at_ms);
      CREATE INDEX IF NOT EXISTS idx_session_trades_lookup ON session_trades (session_id);
      CREATE INDEX IF NOT EXISTS idx_session_trade_state_lookup ON session_trade_state (session_id, mode, symbol);
    `);
    try {
      this.sqlite.exec("ALTER TABLE sessions ADD COLUMN last_saved_at_ms INTEGER;");
    } catch {}
    try {
      this.sqlite.exec("ALTER TABLE sessions ADD COLUMN active_streams_json TEXT;");
    } catch {}
    try {
      this.sqlite.exec(
        "ALTER TABLE session_trade_state ADD COLUMN stop_loss_from_pending_orders REAL NOT NULL DEFAULT 0;"
      );
    } catch {}
    try {
      this.sqlite.exec(
        "ALTER TABLE session_trade_state ADD COLUMN take_profit_from_pending_orders REAL NOT NULL DEFAULT 0;"
      );
    } catch {}
  }
}

module.exports = {
  SessionStore,
  normalizeSymbol
};
