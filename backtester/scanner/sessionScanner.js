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

function computeWindowMetrics(candles, windowBars) {
  const bars = Math.max(1, Number(windowBars || 1));
  if (!Array.isArray(candles) || candles.length < bars * 2) {
    return null;
  }
  const sorted = [...candles].sort((a, b) => Number(a.timeMs || 0) - Number(b.timeMs || 0));
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

function computeScannerRows({
  candlesBySymbol,
  anchorTsMs,
  timeframe = "1m",
  lookbackHours = 120,
  currentWindowHours = 12,
  preferredBtcSymbol = "BTC",
  minAlignedReturns = 12
}) {
  const barsPerHour = timeframeBarsPerHour(timeframe);
  const lookbackBars = Math.max(2, Math.floor(Number(lookbackHours || 120) * barsPerHour));
  const windowBars = Math.max(1, Math.floor(Number(currentWindowHours || 12) * barsPerHour));
  const symbols = Object.keys(candlesBySymbol || {}).map((value) => normalizeSymbol(value)).filter(Boolean);
  const btcSymbol = resolveBtcSymbol(symbols, preferredBtcSymbol);
  const btcCandles = btcSymbol
    ? boundedCandles(candlesBySymbol[btcSymbol] || [], anchorTsMs, lookbackBars)
    : [];

  const rows = [];
  for (const symbol of symbols) {
    const candles = boundedCandles(candlesBySymbol[symbol] || [], anchorTsMs, lookbackBars);
    const latest = candles[candles.length - 1] || null;
    const metrics = computeWindowMetrics(candles, windowBars);
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

function runSessionScanner(repo, options = {}) {
  if (!repo) throw new Error("runSessionScanner: repo is required");
  const sessionId = String(options.sessionId || "").trim();
  if (!sessionId) throw new Error("runSessionScanner: sessionId is required");
  const timeframe = String(options.timeframe || "1m").trim().toLowerCase();
  const session = repo.getSessionById(sessionId);
  if (!session) throw new Error(`runSessionScanner: session not found (${sessionId})`);
  const anchorTsMs = Number(
    options.anchorTsMs || session.market_window_start || session.started_at_ms || Date.now()
  );
  if (!Number.isFinite(anchorTsMs) || anchorTsMs <= 0) {
    throw new Error("runSessionScanner: anchorTsMs is invalid");
  }

  const symbols = repo.listSessionSymbols(sessionId);
  const candlesBySymbol = {};
  for (const symbol of symbols) {
    candlesBySymbol[symbol] = repo.getCandles(sessionId, symbol, timeframe);
  }

  const computed = computeScannerRows({
    candlesBySymbol,
    anchorTsMs,
    timeframe,
    lookbackHours: Number(options.lookbackHours || 120),
    currentWindowHours: Number(options.currentWindowHours || 12),
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
    anchorTsMs,
    ...computed.summary,
    upserted: Number(save.upserted || 0)
  };
}

module.exports = {
  computeScannerRows,
  runSessionScanner
};
