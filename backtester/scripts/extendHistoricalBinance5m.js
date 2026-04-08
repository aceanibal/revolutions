#!/usr/bin/env node
/**
 * Extend historical sessions with older Binance USD-M 5m klines (same DB session id).
 *
 * For each (session, symbol) with existing 5m data, pulls the next chunk backward:
 *   [now_earliest - N calendar months, now_earliest - one 5m bar]
 *
 * Skips symbols that are not Binance futures tickers (e.g. derived ratio series).
 * Skips chunks with empty downloads / zero rows after convert.
 *
 * Usage:
 *   node scripts/extendHistoricalBinance5m.js --months 6 --rounds 4
 *   node scripts/extendHistoricalBinance5m.js --months 6 --rounds 1 --session-id hist-dogeusdt-1m5m-2025-01-2026-03
 *   node scripts/extendHistoricalBinance5m.js --dry-run
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { DateTime } = require("luxon");
const { createBacktestRepository } = require("../data");
const { finalizeHistoricalSession } = require("../import/historicalImporter");

const FIVE_MS = 5 * 60 * 1000;

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

function floorTo5m(ms) {
  return Math.floor(Number(ms) / FIVE_MS) * FIVE_MS;
}

function isBinanceUmSymbol(sym) {
  const s = String(sym || "").trim().toUpperCase();
  if (!s.endsWith("USDT")) return false;
  if (s.includes("PER_") || s.includes("RATIO") || s.includes("/")) return false;
  return true;
}

function usage() {
  console.error(
    [
      "Usage:",
      "  node scripts/extendHistoricalBinance5m.js [--months 6] [--rounds 4] [--session-id <id>] [--dry-run]",
      "",
      "  --months     Calendar months to step backward each round (default 6)",
      "  --rounds     How many backward passes to run (default 4, e.g. 4×6mo ≈ 2y)",
      "  --session-id Only extend this historical session",
      "  --dry-run    Print planned work only"
    ].join("\n")
  );
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    usage();
    process.exit(0);
  }

  const monthsPerRound = Math.max(1, Number.parseInt(String(args.months || "6"), 10) || 6);
  const rounds = Math.max(1, Number.parseInt(String(args.rounds || "4"), 10) || 4);
  const onlySession = String(args["session-id"] || "").trim();
  const dryRun = args["dry-run"] === true;

  const root = path.join(__dirname, "..");
  const py = path.join(root, "tools/binance-public-data/.venv/bin/python");
  const binancePyDir = path.join(root, "tools/binance-public-data/python");
  const dl = path.join(binancePyDir, "download-kline.py");
  const convert = path.join(root, "scripts/convertBinanceKlinesToNdjson.py");
  const storeDir = path.join(root, "data/historical/binance");

  const repo = createBacktestRepository();
  try {
    const db = repo.db;

    const sessionRows = onlySession
      ? db
          .prepare(
            `
            SELECT id FROM sessions
            WHERE session_type = 'historical' AND id = ?
            ORDER BY id
          `
          )
          .all(onlySession)
      : db.prepare(`SELECT id FROM sessions WHERE session_type = 'historical' ORDER BY id`).all();

    if (onlySession && sessionRows.length === 0) {
      throw new Error(`Historical session not found: ${onlySession}`);
    }

    for (let r = 0; r < rounds; r += 1) {
      console.log(`\n=== Round ${r + 1} / ${rounds} (backward ${monthsPerRound} mo each) ===\n`);

      for (const { id: sessionId } of sessionRows) {
        if (String(sessionId).toLowerCase().includes("ratio")) {
          console.log(`[skip] ${sessionId} (derived / non-Binance session)`);
          continue;
        }

        const symbols = db
          .prepare(
            `
            SELECT DISTINCT symbol FROM session_candles
            WHERE session_id = ? AND timeframe = '5m'
            ORDER BY symbol
          `
          )
          .all(sessionId)
          .map((row) => String(row.symbol || "").trim())
          .filter(Boolean);

        for (const symbol of symbols) {
          if (!isBinanceUmSymbol(symbol)) {
            console.log(`[skip] ${sessionId} ${symbol} (not a Binance UM *USDT series)`);
            continue;
          }

          const earliestRow = db
            .prepare(
              `
              SELECT MIN(bucket_start_ms) AS ms
              FROM session_candles
              WHERE session_id = ? AND symbol = ? AND timeframe = '5m'
            `
            )
            .get(sessionId, symbol);
          const earliestMs = Number(earliestRow?.ms || 0);
          if (!earliestMs) continue;

          const rangeEndMs = earliestMs - FIVE_MS;
          const rangeStartMs = floorTo5m(
            DateTime.fromMillis(earliestMs, { zone: "utc" })
              .minus({ months: monthsPerRound })
              .toMillis()
          );

          if (rangeStartMs > rangeEndMs) {
            console.log(`[skip] ${sessionId} ${symbol} empty window after ${monthsPerRound}mo step`);
            continue;
          }

          const startDate = DateTime.fromMillis(rangeStartMs, { zone: "utc" }).toFormat("yyyy-MM-dd");
          const endDate = DateTime.fromMillis(rangeEndMs, { zone: "utc" }).toFormat("yyyy-MM-dd");

          const ndjsonPath = path.join(
            root,
            "data/historical/ndjson",
            `_extend_${sessionId}_${symbol}_${rangeStartMs}_${rangeEndMs}.ndjson`
          );

          console.log(
            `[plan] ${sessionId} ${symbol} 5m ${startDate}..${endDate} (${rangeStartMs}..${rangeEndMs})`
          );

          if (dryRun) continue;

          const env = { ...process.env, STORE_DIRECTORY: storeDir };

          try {
            execFileSync(
              py,
              [
                dl,
                "-t",
                "um",
                "-s",
                symbol,
                "-i",
                "5m",
                "-startDate",
                startDate,
                "-endDate",
                endDate,
                "-skip-daily",
                "1"
              ],
              {
                cwd: binancePyDir,
                env,
                stdio: "inherit"
              }
            );
          } catch (e) {
            console.log(`[warn] ${sessionId} ${symbol} download failed: ${e?.message || e}`);
            continue;
          }

          const monthlyGlob = path.join(
            storeDir,
            "data/futures/um/monthly/klines",
            symbol,
            "5m",
            `${startDate}_${endDate}`
          );

          try {
            execFileSync(
              py,
              [
                convert,
                "--symbol",
                symbol,
                "--timeframe",
                "5m",
                "--start-ms",
                String(rangeStartMs),
                "--end-ms",
                String(rangeEndMs),
                "--input-dir",
                monthlyGlob,
                "--output",
                ndjsonPath
              ],
              { cwd: root, stdio: "inherit" }
            );
          } catch (e) {
            console.log(`[warn] ${sessionId} ${symbol} convert failed (missing zips or no rows in range): ${e?.message || e}`);
            try {
              fs.unlinkSync(ndjsonPath);
            } catch (_) {}
            continue;
          }

          let lines = 0;
          try {
            const st = fs.statSync(ndjsonPath);
            if (st.size === 0) {
              console.log(`[warn] ${sessionId} ${symbol} empty NDJSON, skipping import`);
              try {
                fs.unlinkSync(ndjsonPath);
              } catch (_) {}
              continue;
            }
            const raw = fs.readFileSync(ndjsonPath, "utf8");
            lines = raw.split("\n").filter((l) => l.trim()).length;
          } catch (e) {
            console.log(`[warn] ${sessionId} ${symbol} no NDJSON: ${e?.message || e}`);
            continue;
          }

          if (lines === 0) {
            console.log(`[warn] ${sessionId} ${symbol} 0 rows (likely no Binance data this far back)`);
            try {
              fs.unlinkSync(ndjsonPath);
            } catch (_) {}
            continue;
          }

          try {
            execFileSync(
              process.execPath,
              [
                path.join(root, "scripts/importHistorical.js"),
                "--file",
                ndjsonPath,
                "--session-id",
                sessionId,
                "--symbols",
                symbol,
                "--timeframe",
                "5m",
                "--type",
                "candles",
                "--start-ms",
                String(rangeStartMs),
                "--end-ms",
                String(rangeEndMs),
                "--no-finalize"
              ],
              { cwd: root, stdio: "inherit" }
            );
          } catch (e) {
            console.log(`[warn] ${sessionId} ${symbol} import failed: ${e?.message || e}`);
            try {
              fs.unlinkSync(ndjsonPath);
            } catch (_) {}
            continue;
          }

          const bounds = db
            .prepare(
              `
              SELECT
                MIN(bucket_start_ms) AS mn,
                MAX(bucket_start_ms) AS mx
              FROM session_candles
              WHERE session_id = ?
            `
            )
            .get(sessionId);

          finalizeHistoricalSession(db, sessionId, {
            startMs: Number(bounds?.mn || 0),
            endMs: Number(bounds?.mx || 0)
          });

          console.log(`[ok] ${sessionId} ${symbol} +${lines} candles (5m), session window ${bounds?.mn}..${bounds?.mx}`);

          try {
            fs.unlinkSync(ndjsonPath);
          } catch (_) {}
        }
      }
    }

    console.log("\nDone.");
  } finally {
    repo.close();
  }
}

main();
