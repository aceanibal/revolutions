const { normalizeSymbol } = require("../data/math");

function chunkArray(values, chunkSize) {
  const out = [];
  const size = Math.max(1, Number(chunkSize || 1));
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

function computeDollarVolume(candles) {
  return (candles || []).reduce((sum, candle) => {
    const close = Number(candle.close);
    const volume = Number(candle.volume || 0);
    if (!Number.isFinite(close) || !Number.isFinite(volume)) return sum;
    return sum + close * volume;
  }, 0);
}

function computeWindowMetrics(candles, windowBars, opts = {}) {
  const bars = Math.max(1, Number(windowBars || 1));
  if (!Array.isArray(candles) || candles.length < bars * 2) {
    return null;
  }
  const sorted = opts.alreadySorted
    ? candles
    : [...candles].sort((a, b) => Number(a.timeMs || 0) - Number(b.timeMs || 0));
  const current = sorted.slice(sorted.length - bars);
  const historical = sorted.slice(0, sorted.length - bars);
  const baselineChunks = chunkArray(historical, bars).filter((chunk) => chunk.length === bars);
  if (baselineChunks.length === 0) return null;

  const currentVolumeUsd = computeDollarVolume(current);
  const baselineChunkVolumes = baselineChunks.map((chunk) => computeDollarVolume(chunk));
  const baselineVolumeUsd =
    baselineChunkVolumes.reduce((sum, value) => sum + value, 0) / baselineChunkVolumes.length;
  if (!Number.isFinite(currentVolumeUsd) || !Number.isFinite(baselineVolumeUsd) || baselineVolumeUsd <= 0) {
    return null;
  }
  return {
    currentVolumeUsd,
    baselineVolumeUsd,
    rvol: currentVolumeUsd / baselineVolumeUsd
  };
}

function buildReturnSeries(candles) {
  const sorted = [...(candles || [])].sort((a, b) => Number(a.timeMs || 0) - Number(b.timeMs || 0));
  const out = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prevClose = Number(sorted[i - 1]?.close);
    const nextClose = Number(sorted[i]?.close);
    const at = Number(sorted[i]?.timeMs || 0);
    if (!Number.isFinite(prevClose) || !Number.isFinite(nextClose) || prevClose <= 0 || at <= 0) continue;
    out.push({ timeMs: at, ret: Math.log(nextClose / prevClose) });
  }
  return out;
}

function computePearsonCorrelation(xs, ys) {
  const n = xs.length;
  if (!n || ys.length !== n) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  for (let i = 0; i < n; i += 1) {
    const x = Number(xs[i]);
    const y = Number(ys[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
    sumY2 += y * y;
  }
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function computeBtcCorrelation(assetCandles, btcCandles, minAlignedReturns = 12) {
  const assetReturns = buildReturnSeries(assetCandles);
  const btcReturns = buildReturnSeries(btcCandles);
  if (assetReturns.length === 0 || btcReturns.length === 0) return null;
  const btcByTs = new Map();
  for (const row of btcReturns) btcByTs.set(row.timeMs, row.ret);
  const assetAligned = [];
  const btcAligned = [];
  for (const row of assetReturns) {
    if (!btcByTs.has(row.timeMs)) continue;
    assetAligned.push(row.ret);
    btcAligned.push(btcByTs.get(row.timeMs));
  }
  if (assetAligned.length < Number(minAlignedReturns || 12)) return null;
  return computePearsonCorrelation(assetAligned, btcAligned);
}

function timeframeBarsPerHour(timeframe) {
  return String(timeframe || "1m").toLowerCase() === "5m" ? 12 : 60;
}

function resolveBtcSymbol(symbols, preferredBtcSymbol = "BTC") {
  const normalizedSymbols = new Set((symbols || []).map((sym) => normalizeSymbol(sym)));
  const preferred = normalizeSymbol(preferredBtcSymbol || "BTC");
  if (preferred && normalizedSymbols.has(preferred)) return preferred;
  if (normalizedSymbols.has("BTC")) return "BTC";
  if (normalizedSymbols.has("BTCUSDT")) return "BTCUSDT";
  return "";
}

function boundedCandles(candles, anchorTsMs, lookbackBars) {
  const end = Number(anchorTsMs || 0);
  if (!Array.isArray(candles) || end <= 0) return [];
  const past = candles.filter((candle) => Number(candle.timeMs || 0) <= end);
  const bars = Math.max(1, Number(lookbackBars || 1));
  return past.length <= bars ? past : past.slice(past.length - bars);
}

function rightmostIndexLE(sorted, timeMs) {
  if (!Array.isArray(sorted) || sorted.length === 0) return -1;
  const tEnd = Number(timeMs || 0);
  let lo = 0;
  let hi = sorted.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = Number(sorted[mid].timeMs || 0);
    if (t <= tEnd) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function boundedCandlesSorted(sorted, anchorTsMs, lookbackBars) {
  const bars = Math.max(1, Number(lookbackBars || 1));
  const end = rightmostIndexLE(sorted, anchorTsMs);
  if (end < 0) return [];
  const start = Math.max(0, end - bars + 1);
  return sorted.slice(start, end + 1);
}

function sortCandlesBySymbol(candlesBySymbol) {
  const out = {};
  for (const key of Object.keys(candlesBySymbol || {})) {
    const sym = normalizeSymbol(key);
    if (!sym) continue;
    const raw = candlesBySymbol[key];
    if (!Array.isArray(raw) || raw.length === 0) {
      out[sym] = [];
      continue;
    }
    out[sym] = [...raw].sort((a, b) => Number(a.timeMs || 0) - Number(b.timeMs || 0));
  }
  return out;
}

function globalMinAnchorTsMs(sortedMap, lookbackBars, windowBars) {
  const lb = Math.max(2, Number(lookbackBars || 2));
  const wb = Math.max(1, Number(windowBars || 1));
  const minSamplesForMetrics = wb * 2;
  let minAnchorTs = 0;
  for (const symbol of Object.keys(sortedMap || {})) {
    const sorted = sortedMap[symbol];
    if (!Array.isArray(sorted) || sorted.length === 0) continue;
    if (sorted.length < minSamplesForMetrics || sorted.length < lb) continue;
    const tsAtIdx = Number(sorted[lb - 1]?.timeMs || 0);
    if (!Number.isFinite(tsAtIdx) || tsAtIdx <= 0) continue;
    minAnchorTs = minAnchorTs === 0 ? tsAtIdx : Math.max(minAnchorTs, tsAtIdx);
  }
  return minAnchorTs;
}

function pickTimelineSymbol(sortedMap) {
  let best = "";
  let bestLen = -1;
  for (const key of Object.keys(sortedMap || {})) {
    const sym = normalizeSymbol(key);
    if (!sym) continue;
    const len = (sortedMap[key] || []).length;
    if (len > bestLen) {
      bestLen = len;
      best = sym;
    }
  }
  return best;
}

/**
 * The scanner only uses candles with timeMs <= anchor. If the requested anchor is too early
 * (e.g. first bar of the session), there are not enough bars for lookback / RVOL baseline.
 * Clamp anchor forward to the earliest time that has `lookbackBars` bars ending at or before it
 * on every symbol that has sufficient data; also cap to the latest candle time across symbols.
 */
function resolveEffectiveAnchorTsMs(candlesBySymbol, requestedAnchorTsMs, timeframe, lookbackHours, currentWindowHours) {
  const barsPerHour = timeframeBarsPerHour(timeframe);
  const lookbackBars = Math.max(2, Math.floor(Number(lookbackHours || 120) * barsPerHour));
  const windowBars = Math.max(1, Math.floor(Number(currentWindowHours || 12) * barsPerHour));
  const minSamplesForMetrics = windowBars * 2;

  const requested = Number(requestedAnchorTsMs || 0);
  if (!Number.isFinite(requested) || requested <= 0) {
    return { effectiveAnchorTsMs: requested, anchorRequestedTsMs: requested, anchorClamped: false };
  }

  let minAnchorTs = 0;
  let maxLastTs = 0;

  for (const symbol of Object.keys(candlesBySymbol || {})) {
    const raw = candlesBySymbol[symbol];
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const sorted = [...raw].sort((a, b) => Number(a.timeMs || 0) - Number(b.timeMs || 0));
    const lastTs = Number(sorted[sorted.length - 1]?.timeMs || 0);
    if (Number.isFinite(lastTs) && lastTs > 0) maxLastTs = Math.max(maxLastTs, lastTs);

    if (sorted.length < minSamplesForMetrics || sorted.length < lookbackBars) continue;
    const tsAtIdx = Number(sorted[lookbackBars - 1]?.timeMs || 0);
    if (!Number.isFinite(tsAtIdx) || tsAtIdx <= 0) continue;
    minAnchorTs = minAnchorTs === 0 ? tsAtIdx : Math.max(minAnchorTs, tsAtIdx);
  }

  if (maxLastTs <= 0) {
    return { effectiveAnchorTsMs: requested, anchorRequestedTsMs: requested, anchorClamped: false };
  }

  let effective = requested;
  if (minAnchorTs > 0) effective = Math.max(effective, minAnchorTs);
  effective = Math.min(effective, maxLastTs);

  const anchorClamped = effective !== requested;
  return { effectiveAnchorTsMs: effective, anchorRequestedTsMs: requested, anchorClamped };
}

function computeScannerRowsFromSorted(sortedMap, anchorTsMs, options = {}) {
  const {
    timeframe = "1m",
    lookbackHours = 120,
    currentWindowHours = 12,
    preferredBtcSymbol = "BTC",
    minAlignedReturns = 12
  } = options;
  const barsPerHour = timeframeBarsPerHour(timeframe);
  const lookbackBars = Math.max(2, Math.floor(Number(lookbackHours || 120) * barsPerHour));
  const windowBars = Math.max(1, Math.floor(Number(currentWindowHours || 12) * barsPerHour));
  const symbols = Object.keys(sortedMap || {}).map((value) => normalizeSymbol(value)).filter(Boolean);
  const btcSymbol = resolveBtcSymbol(symbols, preferredBtcSymbol);
  const btcSorted = btcSymbol ? sortedMap[btcSymbol] || [] : [];
  const btcCandles = btcSymbol ? boundedCandlesSorted(btcSorted, anchorTsMs, lookbackBars) : [];

  const rows = [];
  for (const symbol of symbols) {
    const candles = boundedCandlesSorted(sortedMap[symbol] || [], anchorTsMs, lookbackBars);
    const latest = candles[candles.length - 1] || null;
    const metrics = computeWindowMetrics(candles, windowBars, { alreadySorted: true });
    if (!latest || !metrics) continue;
    const btcCorr = symbol === btcSymbol ? 1 : computeBtcCorrelation(candles, btcCandles, minAlignedReturns);
    rows.push({
      symbol,
      timeframe: String(timeframe || "1m").toLowerCase(),
      bucketStartMs: Number(anchorTsMs || 0),
      payload: {
        symbol,
        timeframe: String(timeframe || "1m").toLowerCase(),
        anchorTsMs: Number(anchorTsMs || 0),
        currentWindowHours: Number(currentWindowHours || 12),
        lookbackHours: Number(lookbackHours || 120),
        currentWindowBars: windowBars,
        lookbackBars,
        rvol: metrics.rvol,
        currentWindowVolumeUsd: metrics.currentVolumeUsd,
        baselineVolumeUsd: metrics.baselineVolumeUsd,
        btcCorr: Number.isFinite(btcCorr) ? btcCorr : null,
        btcSymbol: btcSymbol || null,
        price: Number(latest.close || 0),
        sourceCandleCount: candles.length
      }
    });
  }
  return {
    rows,
    summary: {
      anchorTsMs: Number(anchorTsMs || 0),
      timeframe: String(timeframe || "1m").toLowerCase(),
      lookbackHours: Number(lookbackHours || 120),
      currentWindowHours: Number(currentWindowHours || 12),
      barsPerHour,
      lookbackBars,
      windowBars,
      symbolCount: symbols.length,
      computedCount: rows.length,
      btcSymbol: btcSymbol || null
    }
  };
}

function computeScannerRows({
  candlesBySymbol,
  anchorTsMs,
  timeframe = "1m",
  lookbackHours = 120,
  currentWindowHours = 12,
  preferredBtcSymbol = "BTC",
  minAlignedReturns = 12
}) {
  const sortedMap = sortCandlesBySymbol(candlesBySymbol);
  return computeScannerRowsFromSorted(sortedMap, anchorTsMs, {
    timeframe,
    lookbackHours,
    currentWindowHours,
    preferredBtcSymbol,
    minAlignedReturns
  });
}

const UPSERT_BATCH_SIZE = 5000;

function runSessionScannerAllBars(repo, options) {
  const sessionId = String(options.sessionId || "").trim();
  const timeframe = String(options.timeframe || "1m").trim().toLowerCase();
  const candlesBySymbol = options.candlesBySymbol || {};
  const sortedMap = sortCandlesBySymbol(candlesBySymbol);
  const lookbackHours = Number(options.lookbackHours || 120);
  const currentWindowHours = Number(options.currentWindowHours || 12);
  const preferredBtcSymbol = String(options.preferredBtcSymbol || "BTC");
  const minAlignedReturns = Number(options.minAlignedReturns || 12);
  const featureSet = String(options.featureSet || "rvol-scanner").trim();
  const featureVersion = String(options.featureVersion || "v1").trim();
  const createdAtMs = Number(options.createdAtMs || Date.now());

  const barsPerHour = timeframeBarsPerHour(timeframe);
  const lookbackBars = Math.max(2, Math.floor(lookbackHours * barsPerHour));
  const windowBars = Math.max(1, Math.floor(currentWindowHours * barsPerHour));

  const minAnchorTs = globalMinAnchorTsMs(sortedMap, lookbackBars, windowBars);
  if (!Number.isFinite(minAnchorTs) || minAnchorTs <= 0) {
    throw new Error(
      "runSessionScanner: session_bars — not enough overlapping candle history for lookback/window (try shorter lookback or a longer session)"
    );
  }

  const timelineSym = pickTimelineSymbol(sortedMap);
  const timeline = sortedMap[timelineSym] || [];
  if (timeline.length === 0) {
    throw new Error("runSessionScanner: session_bars — no candles on timeline");
  }

  let startIdx = 0;
  while (startIdx < timeline.length && Number(timeline[startIdx].timeMs || 0) < minAnchorTs) {
    startIdx += 1;
  }

  const scanOpts = {
    timeframe,
    lookbackHours,
    currentWindowHours,
    preferredBtcSymbol,
    minAlignedReturns
  };

  let totalUpserted = 0;
  let batch = [];
  let anchorCount = 0;
  let lastAnchor = 0;
  let totalComputedRows = 0;

  for (let i = startIdx; i < timeline.length; i += 1) {
    const anchorTsMs = Number(timeline[i].timeMs || 0);
    if (!Number.isFinite(anchorTsMs) || anchorTsMs <= 0) continue;
    const computed = computeScannerRowsFromSorted(sortedMap, anchorTsMs, scanOpts);
    anchorCount += 1;
    lastAnchor = anchorTsMs;
    totalComputedRows += computed.rows.length;
    batch.push(...computed.rows);
    if (batch.length >= UPSERT_BATCH_SIZE) {
      const save = repo.upsertSessionCandleFeatures({
        sessionId,
        timeframe,
        featureSet,
        featureVersion,
        rows: batch,
        createdAtMs
      });
      totalUpserted += Number(save.upserted || 0);
      batch = [];
    }
  }

  if (batch.length > 0) {
    const save = repo.upsertSessionCandleFeatures({
      sessionId,
      timeframe,
      featureSet,
      featureVersion,
      rows: batch,
      createdAtMs
    });
    totalUpserted += Number(save.upserted || 0);
  }

  const symbols = Object.keys(sortedMap).filter((s) => (sortedMap[s] || []).length > 0);
  const btcSymbol = resolveBtcSymbol(symbols, preferredBtcSymbol);

  return {
    sessionId,
    featureSet,
    featureVersion,
    scanMode: "session_bars",
    anchorTsMs: lastAnchor,
    anchorCount,
    timeframe,
    lookbackHours,
    currentWindowHours,
    barsPerHour,
    lookbackBars,
    windowBars,
    symbolCount: symbols.length,
    computedCount: totalComputedRows,
    btcSymbol: btcSymbol || null,
    upserted: totalUpserted
  };
}

function runSessionScanner(repo, options = {}) {
  if (!repo) throw new Error("runSessionScanner: repo is required");
  const sessionId = String(options.sessionId || "").trim();
  if (!sessionId) throw new Error("runSessionScanner: sessionId is required");
  const timeframe = String(options.timeframe || "1m").trim().toLowerCase();
  const session = repo.getSessionById(sessionId);
  if (!session) throw new Error(`runSessionScanner: session not found (${sessionId})`);
  const scanMode = String(options.scanMode || "single").trim().toLowerCase();

  const symbols = repo.listSessionSymbols(sessionId);
  const candlesBySymbol = {};
  for (const symbol of symbols) {
    candlesBySymbol[symbol] = repo.getCandles(sessionId, symbol, timeframe);
  }

  const lookbackHours = Number(options.lookbackHours || 120);
  const currentWindowHours = Number(options.currentWindowHours || 12);

  if (scanMode === "session_bars") {
    return runSessionScannerAllBars(repo, {
      sessionId,
      timeframe,
      candlesBySymbol,
      lookbackHours,
      currentWindowHours,
      preferredBtcSymbol: String(options.preferredBtcSymbol || "BTC"),
      minAlignedReturns: Number(options.minAlignedReturns || 12),
      featureSet: String(options.featureSet || "rvol-scanner").trim(),
      featureVersion: String(options.featureVersion || "v1").trim(),
      createdAtMs: Number(options.createdAtMs || Date.now())
    });
  }

  const anchorTsMs = Number(
    options.anchorTsMs || session.market_window_start || session.started_at_ms || Date.now()
  );
  if (!Number.isFinite(anchorTsMs) || anchorTsMs <= 0) {
    throw new Error("runSessionScanner: anchorTsMs is invalid");
  }

  const resolvedAnchor = resolveEffectiveAnchorTsMs(
    candlesBySymbol,
    anchorTsMs,
    timeframe,
    lookbackHours,
    currentWindowHours
  );
  const effectiveAnchorTsMs = resolvedAnchor.effectiveAnchorTsMs;

  const computed = computeScannerRows({
    candlesBySymbol,
    anchorTsMs: effectiveAnchorTsMs,
    timeframe,
    lookbackHours,
    currentWindowHours,
    preferredBtcSymbol: String(options.preferredBtcSymbol || "BTC"),
    minAlignedReturns: Number(options.minAlignedReturns || 12)
  });

  const featureSet = String(options.featureSet || "rvol-scanner").trim();
  const featureVersion = String(options.featureVersion || "v1").trim();
  const createdAtMs = Number(options.createdAtMs || Date.now());
  const save = repo.upsertSessionCandleFeatures({
    sessionId,
    timeframe,
    featureSet,
    featureVersion,
    rows: computed.rows,
    createdAtMs
  });

  return {
    sessionId,
    featureSet,
    featureVersion,
    scanMode: "single",
    anchorTsMs: effectiveAnchorTsMs,
    anchorRequestedTsMs: resolvedAnchor.anchorRequestedTsMs,
    anchorClamped: Boolean(resolvedAnchor.anchorClamped),
    ...computed.summary,
    upserted: Number(save.upserted || 0)
  };
}

module.exports = {
  computeScannerRows,
  computeScannerRowsFromSorted,
  resolveEffectiveAnchorTsMs,
  runSessionScanner
};
