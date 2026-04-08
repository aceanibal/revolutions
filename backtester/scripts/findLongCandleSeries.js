#!/usr/bin/env node
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { createBacktestRepository } = require("../data");

const DAY_MS = 24 * 60 * 60 * 1000;

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

function formatIso(ms) {
  return new Date(Number(ms || 0)).toISOString();
}

async function main() {
  const args = parseArgs(process.argv);
  const timeframe = String(args.timeframe || "5m").trim().toLowerCase();
  const minDays = Math.max(1, Number.parseFloat(String(args["min-days"] || "365")) || 365);
  const minSpanMs = Math.floor(minDays * DAY_MS);
  const symbols = String(args.symbols || "XRPUSDT,PAXGUSDT")
    .split(",")
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean);

  if (timeframe !== "1m" && timeframe !== "5m") {
    throw new Error(`Invalid timeframe: ${timeframe}`);
  }
  if (symbols.length === 0) {
    throw new Error("No symbols provided. Use --symbols XRPUSDT,PAXGUSDT");
  }

  const repo = createBacktestRepository();
  try {
    const placeholders = symbols.map(() => "?").join(", ");
    const rows = repo.db
      .prepare(
        `
          SELECT
            c.session_id AS session_id,
            c.symbol AS symbol,
            MIN(c.bucket_start_ms) AS first_bucket_start_ms,
            MAX(c.bucket_start_ms) AS last_bucket_start_ms,
            COUNT(*) AS candle_count
          FROM session_candles c
          INNER JOIN sessions s ON s.id = c.session_id
          WHERE s.session_type = 'historical'
            AND c.timeframe = ?
            AND c.symbol IN (${placeholders})
          GROUP BY c.session_id, c.symbol
          HAVING (MAX(c.bucket_start_ms) - MIN(c.bucket_start_ms)) >= ?
          ORDER BY (MAX(c.bucket_start_ms) - MIN(c.bucket_start_ms)) DESC
        `
      )
      .all(timeframe, ...symbols, minSpanMs);

    const resultRows = rows.map((row) => {
      const firstMs = Number(row.first_bucket_start_ms || 0);
      const lastMs = Number(row.last_bucket_start_ms || 0);
      const spanMs = Math.max(0, lastMs - firstMs);
      return {
        sessionId: String(row.session_id || ""),
        symbol: String(row.symbol || ""),
        timeframe,
        candleCount: Number(row.candle_count || 0),
        firstBucketStartMs: firstMs,
        firstBucketIso: formatIso(firstMs),
        lastBucketStartMs: lastMs,
        lastBucketIso: formatIso(lastMs),
        spanMs,
        spanDays: Number((spanMs / DAY_MS).toFixed(3))
      };
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          filters: {
            timeframe,
            symbols,
            minDays,
            minSpanMs
          },
          rows: resultRows
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
