#!/usr/bin/env node
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { createBacktestRepository } = require("../data");
const { runSessionScanner } = require("../scanner/sessionScanner");

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
      "  node scripts/runSessionScanner.js --session-id <id> [options]",
      "",
      "Options:",
      "  --timeframe <1m|5m>              Candle timeframe (default: 1m)",
      "  --anchor-ts-ms <epochMs>         Anchor timestamp in ms (default: session market_window_start)",
      "  --lookback-hours <N>             Lookback horizon in hours (default: 120)",
      "  --current-window-hours <N>       RVOL current window size in hours (default: 12)",
      "  --btc-symbol <SYMBOL>            Preferred BTC reference symbol (default: BTC)",
      "  --feature-set <name>             Feature namespace (default: rvol-scanner)",
      "  --feature-version <version>      Feature version tag (default: v1)"
    ].join("\n")
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const sessionId = String(args["session-id"] || "").trim();
  if (!sessionId) {
    usage();
    process.exit(1);
  }

  const repo = createBacktestRepository();
  try {
    const result = runSessionScanner(repo, {
      sessionId,
      timeframe: String(args.timeframe || "1m").trim().toLowerCase(),
      anchorTsMs: args["anchor-ts-ms"] == null ? 0 : Number(args["anchor-ts-ms"]),
      lookbackHours: Number(args["lookback-hours"] || 120),
      currentWindowHours: Number(args["current-window-hours"] || 12),
      preferredBtcSymbol: String(args["btc-symbol"] || "BTC").trim().toUpperCase(),
      featureSet: String(args["feature-set"] || "rvol-scanner").trim(),
      featureVersion: String(args["feature-version"] || "v1").trim()
    });
    console.log(JSON.stringify({ ok: true, result }, null, 2));
  } finally {
    repo.close();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
