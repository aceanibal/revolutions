const { DateTime } = require("luxon");
const { normalizeSymbol } = require("../data/math");

const ET_ZONE = "America/New_York";

function getEtDayKey(ms) {
  return DateTime.fromMillis(Number(ms || 0), { zone: ET_ZONE }).toISODate() || "0000-00-00";
}

function getEtHHMM(ms) {
  const dt = DateTime.fromMillis(Number(ms || 0), { zone: ET_ZONE });
  return dt.hour * 100 + dt.minute;
}

/**
 * Group sorted 5m candles by ET day, returning each day's OHLC and time range.
 */
function extractDailyLevels(sorted5mCandles) {
  const days = new Map();
  for (const c of sorted5mCandles) {
    const t = Number(c.timeMs || 0);
    if (t <= 0) continue;
    const dayKey = getEtDayKey(t);
    const h = Number(c.high);
    const l = Number(c.low);
    const o = Number(c.open);
    const cl = Number(c.close);
    if (!Number.isFinite(h) || !Number.isFinite(l)) continue;

    if (!days.has(dayKey)) {
      days.set(dayKey, { dayKey, high: h, low: l, open: o, close: cl, openTimeMs: t, closeTimeMs: t });
    } else {
      const d = days.get(dayKey);
      if (h > d.high) d.high = h;
      if (l < d.low) d.low = l;
      if (t < d.openTimeMs) {
        d.open = o;
        d.openTimeMs = t;
      }
      if (t > d.closeTimeMs) {
        d.close = cl;
        d.closeTimeMs = t;
      }
    }
  }
  return [...days.values()].sort((a, b) => a.openTimeMs - b.openTimeMs);
}

/**
 * Bucket the price range into `numBins` bins and accumulate volume in each.
 * Uses typical price = (H+L+C)/3 per candle to assign volume to bins.
 */
function computeVolumeProfile(candles, numBins = 50) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return { bins: [], weekHigh: 0, weekLow: 0, binSize: 0 };
  }

  let weekHigh = -Infinity;
  let weekLow = Infinity;
  for (const c of candles) {
    const h = Number(c.high);
    const l = Number(c.low);
    if (Number.isFinite(h) && h > weekHigh) weekHigh = h;
    if (Number.isFinite(l) && l < weekLow) weekLow = l;
  }
  if (!Number.isFinite(weekHigh) || !Number.isFinite(weekLow) || weekHigh <= weekLow) {
    return { bins: [], weekHigh, weekLow, binSize: 0 };
  }

  const range = weekHigh - weekLow;
  const binSize = range / numBins;
  const bins = Array.from({ length: numBins }, (_, i) => ({
    priceLow: weekLow + i * binSize,
    priceHigh: weekLow + (i + 1) * binSize,
    priceMid: weekLow + (i + 0.5) * binSize,
    volume: 0
  }));

  for (const c of candles) {
    const typical = (Number(c.high) + Number(c.low) + Number(c.close)) / 3;
    const vol = Number(c.volume || 0);
    if (!Number.isFinite(typical) || !Number.isFinite(vol) || vol <= 0) continue;
    const idx = Math.min(Math.floor((typical - weekLow) / binSize), numBins - 1);
    if (idx >= 0) bins[idx].volume += vol;
  }

  return { bins, weekHigh, weekLow, binSize };
}

/**
 * Return bins whose volume exceeds mean + stdDevMultiplier * stdDev.
 */
function findHighVolumeNodes(profile, stdDevMultiplier = 1.0) {
  const { bins } = profile;
  if (!Array.isArray(bins) || bins.length === 0) return [];

  const volumes = bins.map((b) => b.volume);
  const mean = volumes.reduce((s, v) => s + v, 0) / volumes.length;
  const variance = volumes.reduce((s, v) => s + (v - mean) ** 2, 0) / volumes.length;
  const stdDev = Math.sqrt(variance);
  const threshold = mean + stdDevMultiplier * stdDev;

  return bins
    .filter((b) => b.volume >= threshold)
    .map((b) => ({
      priceLow: b.priceLow,
      priceHigh: b.priceHigh,
      priceMid: b.priceMid,
      volume: b.volume
    }));
}

/**
 * Fractal pivot detection: a bar is a swing high if its high is strictly the highest
 * in a window of `leftBars` before and `rightBars` after it. Same logic inverted for lows.
 */
function detectSwingPoints(candles, leftBars = 5, rightBars = 5) {
  const swingHighs = [];
  const swingLows = [];
  if (!Array.isArray(candles) || candles.length < leftBars + rightBars + 1) {
    return { swingHighs, swingLows };
  }

  for (let i = leftBars; i < candles.length - rightBars; i++) {
    const high = Number(candles[i].high);
    const low = Number(candles[i].low);
    const t = Number(candles[i].timeMs || 0);
    if (!Number.isFinite(high) || !Number.isFinite(low)) continue;

    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue;
      const cmpHigh = Number(candles[j].high);
      const cmpLow = Number(candles[j].low);
      if (Number.isFinite(cmpHigh) && cmpHigh >= high) isSwingHigh = false;
      if (Number.isFinite(cmpLow) && cmpLow <= low) isSwingLow = false;
      if (!isSwingHigh && !isSwingLow) break;
    }

    if (isSwingHigh) swingHighs.push({ timeMs: t, price: high });
    if (isSwingLow) swingLows.push({ timeMs: t, price: low });
  }

  return { swingHighs, swingLows };
}

/**
 * Compute full liquidity zone payload from sorted 5m candles up to `anchorTsMs`.
 * Returns null if insufficient data.
 */
function computeLiquidityZones(sorted5m, anchorTsMs, options = {}) {
  const lookbackDays = Number(options.lookbackDays || 7);
  const numBins = Number(options.numBins || 50);
  const swingLeftBars = Number(options.swingLeftBars || 5);
  const swingRightBars = Number(options.swingRightBars || 5);
  const hvnStdDevMultiplier = Number(options.hvnStdDevMultiplier || 1.0);

  const anchor = Number(anchorTsMs || 0);
  if (!Number.isFinite(anchor) || anchor <= 0) return null;
  const lookbackMs = lookbackDays * 24 * 60 * 60 * 1000;
  const cutoff = anchor - lookbackMs;

  const windowCandles = sorted5m.filter((c) => {
    const t = Number(c.timeMs || 0);
    return t > cutoff && t <= anchor;
  });
  if (windowCandles.length === 0) return null;

  const dailyLevels = extractDailyLevels(windowCandles);
  const anchorDay = getEtDayKey(anchor);
  const previousDays = dailyLevels.filter((d) => d.dayKey < anchorDay);
  const prevDay = previousDays.length > 0 ? previousDays[previousDays.length - 1] : null;

  const profile = computeVolumeProfile(windowCandles, numBins);
  const highVolumeNodes = findHighVolumeNodes(profile, hvnStdDevMultiplier);
  const { swingHighs, swingLows } = detectSwingPoints(windowCandles, swingLeftBars, swingRightBars);

  return {
    anchorTsMs: anchor,
    anchorDayKey: anchorDay,
    lookbackDays,
    candleCount: windowCandles.length,
    weekHigh: profile.weekHigh,
    weekLow: profile.weekLow,
    previousDayHigh: prevDay ? prevDay.high : null,
    previousDayLow: prevDay ? prevDay.low : null,
    previousDayClose: prevDay ? prevDay.close : null,
    dailyLevels: previousDays.map((d) => ({
      dayKey: d.dayKey,
      high: d.high,
      low: d.low,
      open: d.open,
      close: d.close
    })),
    highVolumeNodes,
    swingHighs: swingHighs.map((s) => ({ timeMs: s.timeMs, price: s.price })),
    swingLows: swingLows.map((s) => ({ timeMs: s.timeMs, price: s.price }))
  };
}

const UPSERT_BATCH_SIZE = 5000;

/**
 * Binary search: index of the first element with timeMs >= targetMs.
 */
function lowerBound(sorted, targetMs) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (Number(sorted[mid].timeMs || 0) < targetMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Binary search: index of the first element with timeMs > targetMs.
 */
function upperBound(sorted, targetMs) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (Number(sorted[mid].timeMs || 0) <= targetMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Run the liquidity zone scanner for a session. Computes zones at each day's
 * anchor bar (default 5 PM ET) from a trailing week of 5m data, then stores
 * one feature row per daily anchor (not fanned out to every bar).
 *
 * Strategies read the most recent anchor via the backtest runner's carry-forward
 * of `state.scannerFeatures`.
 */
function runLiquidityZoneScanner(repo, options = {}) {
  if (!repo) throw new Error("runLiquidityZoneScanner: repo is required");
  const sessionId = String(options.sessionId || "").trim();
  if (!sessionId) throw new Error("runLiquidityZoneScanner: sessionId is required");

  const session = repo.getSessionById(sessionId);
  if (!session) throw new Error(`runLiquidityZoneScanner: session not found (${sessionId})`);

  const featureSet = String(options.featureSet || "liquidity-zones").trim();
  const featureVersion = String(options.featureVersion || "v1").trim();
  const lookbackDays = Number(options.lookbackDays || 7);
  const numBins = Number(options.numBins || 50);
  const swingLeftBars = Number(options.swingLeftBars || 5);
  const swingRightBars = Number(options.swingRightBars || 5);
  const hvnStdDevMultiplier = Number(options.hvnStdDevMultiplier || 1.0);
  const anchorHHMM = Number(options.anchorHHMM || 1700);
  const createdAtMs = Number(options.createdAtMs || Date.now());

  const symbols = repo.listSessionSymbols(sessionId);
  const sortedMap = {};
  for (const symbol of symbols) {
    const sym = normalizeSymbol(symbol);
    if (!sym) continue;
    const raw = repo.getCandles(sessionId, sym, "5m");
    if (!Array.isArray(raw) || raw.length === 0) continue;
    sortedMap[sym] = [...raw].sort((a, b) => Number(a.timeMs || 0) - Number(b.timeMs || 0));
  }

  const computeOpts = { lookbackDays, numBins, swingLeftBars, swingRightBars, hvnStdDevMultiplier };
  let totalUpserted = 0;
  let totalRows = 0;
  let anchorCountTotal = 0;

  for (const symbol of Object.keys(sortedMap)) {
    const sorted = sortedMap[symbol];
    if (sorted.length === 0) continue;

    const dayAnchorMap = new Map();
    for (let i = 0; i < sorted.length; i++) {
      const t = Number(sorted[i].timeMs || 0);
      const dayKey = getEtDayKey(t);
      const hhmm = getEtHHMM(t);
      if (hhmm <= anchorHHMM) {
        dayAnchorMap.set(dayKey, { timeMs: t, idx: i });
      }
    }

    const rows = [];
    for (const [, anchor] of dayAnchorMap) {
      const zones = computeLiquidityZones(sorted, anchor.timeMs, computeOpts);
      if (!zones) continue;
      rows.push({
        symbol,
        timeframe: "5m",
        bucketStartMs: anchor.timeMs,
        payload: zones
      });
    }
    anchorCountTotal += rows.length;
    totalRows += rows.length;

    for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
      const save = repo.upsertSessionCandleFeatures({
        sessionId,
        timeframe: "5m",
        featureSet,
        featureVersion,
        rows: batch,
        createdAtMs
      });
      totalUpserted += Number(save.upserted || 0);
    }
  }

  return {
    sessionId,
    featureSet,
    featureVersion,
    scanMode: "daily_anchor",
    lookbackDays,
    numBins,
    swingLeftBars,
    swingRightBars,
    hvnStdDevMultiplier,
    anchorHHMM,
    symbolCount: Object.keys(sortedMap).length,
    anchorCount: anchorCountTotal,
    computedCount: totalRows,
    upserted: totalUpserted
  };
}

const OVERNIGHT_WINDOW_HOURS = 15; // 5 PM → 8 AM = 15 hours
const OVERNIGHT_WINDOW_MS = OVERNIGHT_WINDOW_HOURS * 60 * 60 * 1000;
const MAX_EXPORT_SNAPSHOTS = 60;

/**
 * Slice 1m candles for a time window using binary search on a pre-sorted array.
 * Returns plain objects to avoid holding references to the source rows.
 */
function sliceOvernightCandles(sorted1m, fromMs, toMs) {
  const startIdx = lowerBound(sorted1m, fromMs);
  const endIdx = upperBound(sorted1m, toMs);
  const out = [];
  for (let i = startIdx; i < endIdx; i++) {
    const c = sorted1m[i];
    out.push({
      timeMs: Number(c.timeMs || 0),
      open: Number(c.open || 0),
      high: Number(c.high || 0),
      low: Number(c.low || 0),
      close: Number(c.close || 0),
      volume: Number(c.volume || 0)
    });
  }
  return out;
}

/**
 * Build an export payload that pairs each daily 5 PM liquidity-zone snapshot
 * with the following 1m candles from 5 PM to 8 AM (overnight / Asian session).
 *
 * Capped to the most recent `maxSnapshots` (default 60) anchors to keep
 * the response size manageable.
 */
function buildLiquidityZoneExport(repo, options = {}) {
  if (!repo) throw new Error("buildLiquidityZoneExport: repo is required");
  const sessionId = String(options.sessionId || "").trim();
  if (!sessionId) throw new Error("buildLiquidityZoneExport: sessionId is required");
  const symbol = normalizeSymbol(options.symbol || "");
  if (!symbol) throw new Error("buildLiquidityZoneExport: symbol is required");

  const featureSet = String(options.featureSet || "liquidity-zones").trim();
  const featureVersion = String(options.featureVersion || "v1").trim();
  const maxSnapshots = Math.max(1, Number(options.maxSnapshots || MAX_EXPORT_SNAPSHOTS));

  const featureRows = repo.listSessionCandleFeatures(sessionId, {
    symbol,
    timeframe: "5m",
    featureSet,
    featureVersion,
    limit: 50_000
  });

  // Each row is a unique anchor (no fan-out), keyed by anchorTsMs.
  const anchorMap = new Map();
  for (const row of featureRows) {
    const anchorTsMs = Number(row.payload?.anchorTsMs || 0);
    if (!Number.isFinite(anchorTsMs) || anchorTsMs <= 0) continue;
    if (anchorMap.has(anchorTsMs)) continue;
    anchorMap.set(anchorTsMs, row.payload);
  }

  const anchorKeys = [...anchorMap.keys()].sort((a, b) => a - b);
  const trimmedKeys = anchorKeys.length > maxSnapshots
    ? anchorKeys.slice(anchorKeys.length - maxSnapshots)
    : anchorKeys;

  const oneMinuteCandles = repo.getCandles(sessionId, symbol, "1m");
  const sorted1m = [...(oneMinuteCandles || [])].sort(
    (a, b) => Number(a.timeMs || 0) - Number(b.timeMs || 0)
  );

  const snapshots = [];
  for (const anchorTsMs of trimmedKeys) {
    const zones = anchorMap.get(anchorTsMs);
    const windowEndMs = anchorTsMs + OVERNIGHT_WINDOW_MS;
    const overnightCandles = sliceOvernightCandles(sorted1m, anchorTsMs, windowEndMs);

    snapshots.push({
      anchorTsMs,
      anchorDayKey: zones.anchorDayKey || getEtDayKey(anchorTsMs),
      overnightWindow: {
        fromMs: anchorTsMs,
        toMs: windowEndMs,
        hours: OVERNIGHT_WINDOW_HOURS
      },
      zones,
      oneMinuteCandles: overnightCandles,
      oneMinuteCandleCount: overnightCandles.length
    });
  }

  return {
    exportedAtMs: Date.now(),
    exportType: "liquidity-zones-with-overnight-1m",
    sessionId,
    symbol,
    featureSet,
    featureVersion,
    snapshotCount: snapshots.length,
    totalAnchorsAvailable: anchorKeys.length,
    maxSnapshots,
    overnightWindowHours: OVERNIGHT_WINDOW_HOURS,
    snapshots
  };
}

module.exports = {
  extractDailyLevels,
  computeVolumeProfile,
  findHighVolumeNodes,
  detectSwingPoints,
  computeLiquidityZones,
  runLiquidityZoneScanner,
  buildLiquidityZoneExport
};
