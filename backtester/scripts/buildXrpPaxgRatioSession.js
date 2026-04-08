#!/usr/bin/env node
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { createBacktestRepository } = require("../data");
const {
  createHistoricalSession,
  insertCandlesBatch,
  finalizeHistoricalSession,
  deleteHistoricalSession
} = require("../import/historicalImporter");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || String(next).startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function dateTag(ms) {
  const d = new Date(Number(ms || 0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function safeVolume(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function computeVolume(volumeMethod, xrpVolume, paxgVolume) {
  if (volumeMethod === "min") return Math.min(xrpVolume, paxgVolume);
  if (xrpVolume <= 0 || paxgVolume <= 0) return 0;
  return Math.sqrt(xrpVolume * paxgVolume);
}

function getCandlesByBucket(repo, sessionId, symbol, timeframe) {
  const rows = repo.db
    .prepare(
      `
        SELECT
          bucket_start_ms,
          open,
          high,
          low,
          close,
          volume,
          is_gap_fill
        FROM session_candles
        WHERE session_id = ? AND symbol = ? AND timeframe = ?
        ORDER BY bucket_start_ms ASC
      `
    )
    .all(sessionId, symbol, timeframe);
  const byBucket = new Map();
  for (const row of rows) {
    byBucket.set(Number(row.bucket_start_ms || 0), {
      bucketStartMs: Number(row.bucket_start_ms || 0),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume || 0),
      isGapFill: Boolean(row.is_gap_fill)
    });
  }
  return byBucket;
}

async function main() {
  const args = parseArgs(process.argv);
  const xrpSessionId = String(args["xrp-session"] || "").trim();
  const paxgSessionId = String(args["paxg-session"] || "").trim();
  const timeframe = String(args.timeframe || "5m").trim().toLowerCase();
  const symbolXrp = String(args["symbol-xrp"] || "XRPUSDT").trim().toUpperCase();
  const symbolPaxg = String(args["symbol-paxg"] || "PAXGUSDT").trim().toUpperCase();
  const ratioSymbol = String(args["ratio-symbol"] || "XRPUSDT_PER_PAXGUSDT")
    .trim()
    .toUpperCase();
  const volumeMethod = String(args["volume-method"] || "geom_mean").trim().toLowerCase();
  const includeGapFill = args["include-gap-fill"] === true;
  const shouldReplace = args.replace === true;
  const chunkSize = Math.max(1, Number.parseInt(String(args["chunk-size"] || "2000"), 10) || 2000);

  if (!xrpSessionId || !paxgSessionId) {
    throw new Error("Both --xrp-session and --paxg-session are required");
  }
  if (timeframe !== "1m" && timeframe !== "5m") {
    throw new Error(`Invalid timeframe: ${timeframe}`);
  }
  if (volumeMethod !== "geom_mean" && volumeMethod !== "min") {
    throw new Error("Invalid --volume-method. Use geom_mean or min");
  }

  const repo = createBacktestRepository();
  try {
    const xrpByBucket = getCandlesByBucket(repo, xrpSessionId, symbolXrp, timeframe);
    const paxgByBucket = getCandlesByBucket(repo, paxgSessionId, symbolPaxg, timeframe);
    if (xrpByBucket.size === 0) {
      throw new Error(`No candles found for ${symbolXrp} in session ${xrpSessionId} (${timeframe})`);
    }
    if (paxgByBucket.size === 0) {
      throw new Error(`No candles found for ${symbolPaxg} in session ${paxgSessionId} (${timeframe})`);
    }

    const commonBuckets = Array.from(xrpByBucket.keys())
      .filter((bucketStartMs) => paxgByBucket.has(bucketStartMs))
      .sort((a, b) => a - b);
    if (commonBuckets.length === 0) {
      throw new Error("No overlapping bucket_start_ms values between input sessions");
    }

    const derivedRows = [];
    const dropped = {
      gapFill: 0,
      invalidDivisor: 0,
      invalidOhlc: 0
    };
    for (const bucketStartMs of commonBuckets) {
      const xrp = xrpByBucket.get(bucketStartMs);
      const paxg = paxgByBucket.get(bucketStartMs);
      if (!xrp || !paxg) continue;
      if (!includeGapFill && (xrp.isGapFill || paxg.isGapFill)) {
        dropped.gapFill += 1;
        continue;
      }

      const numbers = [xrp.open, xrp.high, xrp.low, xrp.close, paxg.open, paxg.high, paxg.low, paxg.close];
      if (numbers.some((value) => !Number.isFinite(value))) {
        dropped.invalidOhlc += 1;
        continue;
      }
      if (paxg.open <= 0 || paxg.high <= 0 || paxg.low <= 0 || paxg.close <= 0) {
        dropped.invalidDivisor += 1;
        continue;
      }

      const open = xrp.open / paxg.open;
      const high = xrp.high / paxg.low;
      const low = xrp.low / paxg.high;
      const close = xrp.close / paxg.close;
      if (![open, high, low, close].every(Number.isFinite)) {
        dropped.invalidOhlc += 1;
        continue;
      }

      const xrpVolume = safeVolume(xrp.volume);
      const paxgVolume = safeVolume(paxg.volume);
      const volume = computeVolume(volumeMethod, xrpVolume, paxgVolume);

      derivedRows.push({
        symbol: ratioSymbol,
        timeframe,
        bucketStartMs,
        open,
        high: Math.max(high, open, close, low),
        low: Math.min(low, open, close, high),
        close,
        volume
      });
    }

    if (derivedRows.length === 0) {
      throw new Error("No ratio candles produced after filtering/validation");
    }

    const derivedStartMs = Number(derivedRows[0].bucketStartMs || 0);
    const derivedEndMs = Number(derivedRows[derivedRows.length - 1].bucketStartMs || 0);
    const sessionId =
      String(args["session-id"] || "").trim() ||
      `hist-xrp-paxg-ratio-${timeframe}-${dateTag(derivedStartMs)}-${dateTag(derivedEndMs)}`;

    const existing = repo.db.prepare("SELECT id, session_type FROM sessions WHERE id = ? LIMIT 1").get(sessionId);
    if (existing && !shouldReplace) {
      throw new Error(`Session ${sessionId} already exists. Use --replace to rebuild it.`);
    }
    if (existing && shouldReplace) {
      deleteHistoricalSession(repo.db, sessionId);
    }

    createHistoricalSession({
      id: sessionId,
      symbols: [ratioSymbol],
      timeframe,
      startMs: derivedStartMs,
      endMs: derivedEndMs
    });
    const insertResult = insertCandlesBatch(repo.db, sessionId, derivedRows, { timeframe, chunkSize });
    const finalizeResult = finalizeHistoricalSession(repo.db, sessionId, {
      startMs: derivedStartMs,
      endMs: derivedEndMs
    });
    repo.importScannerMetadata({
      sessionId,
      tool: "ratio-builder",
      sourceId: "xrp-paxg",
      payload: {
        ratioDefinition: `${symbolXrp}/${symbolPaxg}`,
        timeframe,
        ratioSymbol,
        volumeMethod,
        includeGapFill,
        sourceSessions: {
          xrpSessionId,
          paxgSessionId
        },
        overlapBuckets: commonBuckets.length,
        derivedBuckets: derivedRows.length,
        dropped
      }
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          sessionId,
          ratioSymbol,
          timeframe,
          sourceSessions: {
            xrpSessionId,
            paxgSessionId
          },
          overlapBuckets: commonBuckets.length,
          inserted: Number(insertResult.inserted || 0),
          dropped,
          summary: finalizeResult
        },
        null,
        2
      )
    );
  } finally {
    repo.close();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
