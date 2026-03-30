#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const readline = require("readline");

require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { createBacktestRepository } = require("../data");
const {
  createHistoricalSession,
  insertCandlesBatch,
  insertTicksBatch,
  finalizeHistoricalSession
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

function usage() {
  console.error(
    [
      "Usage:",
      "  node scripts/importHistorical.js --file <ndjson> --session-id <id> --type <candles|ticks> [options]",
      "",
      "Options:",
      "  --symbols <CSV>         Comma-separated symbols used when creating the session",
      "  --timeframe <1m|5m>     Required for candle import unless row.timeframe exists",
      "  --chunk-size <N>        DB transaction chunk size (default: 1000)",
      "  --flush-size <N>        In-memory batch flush size (default: 5000)",
      "  --start-ms <epochMs>    Session market window start",
      "  --end-ms <epochMs>      Session market window end",
      "  --no-finalize           Skip finalize step"
    ].join("\n")
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const filePath = String(args.file || "").trim();
  const sessionId = String(args["session-id"] || "").trim();
  const importType = String(args.type || "").trim().toLowerCase();
  const timeframe = String(args.timeframe || "").trim().toLowerCase();
  const chunkSize = Math.max(1, Number.parseInt(String(args["chunk-size"] || "1000"), 10) || 1000);
  const flushSize = Math.max(1, Number.parseInt(String(args["flush-size"] || "5000"), 10) || 5000);
  const shouldFinalize = args["no-finalize"] !== true;
  const startMs = args["start-ms"] == null ? Date.now() : Number(args["start-ms"]);
  const endMs = args["end-ms"] == null ? Date.now() : Number(args["end-ms"]);
  const symbols = String(args.symbols || "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  if (!filePath || !sessionId || (importType !== "candles" && importType !== "ticks")) {
    usage();
    process.exit(1);
  }
  if (importType === "candles" && timeframe && timeframe !== "1m" && timeframe !== "5m") {
    throw new Error(`Invalid timeframe: ${timeframe}`);
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const repo = createBacktestRepository();
  try {
    const existing = repo.db
      .prepare("SELECT id, session_type FROM sessions WHERE id = ? LIMIT 1")
      .get(sessionId);
    if (!existing) {
      createHistoricalSession({
        id: sessionId,
        symbols,
        timeframe: timeframe || undefined,
        startMs,
        endMs
      });
      console.log(`[historical-import] Created session ${sessionId}`);
    } else if (String(existing.session_type || "live") !== "historical") {
      throw new Error(`Session exists and is not historical: ${sessionId}`);
    }

    const startTs = Date.now();
    let parsed = 0;
    let inserted = 0;
    let batch = [];

    const flush = () => {
      if (batch.length === 0) return;
      if (importType === "candles") {
        const result = insertCandlesBatch(repo.db, sessionId, batch, { timeframe, chunkSize });
        inserted += Number(result.inserted || 0);
      } else {
        const result = insertTicksBatch(repo.db, sessionId, batch, { chunkSize });
        inserted += Number(result.inserted || 0);
      }
      batch = [];
    };

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity
    });

    for await (const rawLine of rl) {
      const line = String(rawLine || "").trim();
      if (!line) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSON line at record ${parsed + 1}`);
      }
      parsed += 1;
      if (importType === "candles") {
        batch.push({
          symbol: row.symbol,
          timeframe: row.timeframe || timeframe,
          bucketStartMs: row.bucketStartMs,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume
        });
      } else {
        batch.push({
          symbol: row.symbol,
          tsMs: row.tsMs,
          price: row.price,
          size: row.size
        });
      }

      if (batch.length >= flushSize) flush();
      if (parsed % 10000 === 0) {
        const elapsedSec = Math.max(1, (Date.now() - startTs) / 1000);
        const rate = Math.round(parsed / elapsedSec);
        console.log(`[historical-import] parsed=${parsed} inserted=${inserted} rate=${rate}/s`);
      }
    }
    flush();

    let finalizeSummary = null;
    if (shouldFinalize) {
      finalizeSummary = finalizeHistoricalSession(repo.db, sessionId, { startMs, endMs });
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          sessionId,
          type: importType,
          parsed,
          inserted,
          finalized: shouldFinalize,
          summary: finalizeSummary
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
