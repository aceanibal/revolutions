#!/usr/bin/env node
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { createBacktestRepository } = require("../data");
const { runBacktest } = require("../engine");
const { persistRun } = require("../results");

function parseArgs(argv) {
  const out = {
    sessionId: "",
    symbol: "",
    timeframe: "1m",
    mode: "candle",
    strategyId: "noop",
    persist: true
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--session") out.sessionId = String(argv[i + 1] || "");
    if (arg === "--symbol") out.symbol = String(argv[i + 1] || "");
    if (arg === "--timeframe") out.timeframe = String(argv[i + 1] || "1m");
    if (arg === "--mode") out.mode = String(argv[i + 1] || "candle");
    if (arg === "--strategy") out.strategyId = String(argv[i + 1] || "noop");
    if (arg === "--no-persist") out.persist = false;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sessionId || !args.symbol) {
    console.error(
      "Usage: node runner/cli.js --session <sessionId> --symbol <symbol> [--timeframe 1m|5m] [--mode tick|candle|mixed] [--strategy noop|simple-momentum]"
    );
    process.exit(1);
  }

  const repo = createBacktestRepository();
  try {
    const candles = repo.getCandles(args.sessionId, args.symbol, args.timeframe);
    const ticks = repo.getTicks(args.sessionId, args.symbol);
    const run = runBacktest({
      sessionId: args.sessionId,
      symbol: args.symbol,
      timeframe: args.timeframe,
      mode: args.mode,
      strategyId: args.strategyId,
      candles,
      ticks
    });

    let outputPath = null;
    if (args.persist) outputPath = persistRun(run);
    console.log(
      JSON.stringify(
        {
          ok: true,
          metrics: run.metrics,
          events: run.meta.eventCount,
          outputPath
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
