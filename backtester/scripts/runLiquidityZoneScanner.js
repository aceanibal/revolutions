#!/usr/bin/env node
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { createBacktestRepository } = require("../data");
const { runLiquidityZoneScanner } = require("../scanner/liquidityZoneScanner");

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
      "  node scripts/runLiquidityZoneScanner.js --session-id <id> [options]",
      "",
      "Options:",
      "  --lookback-days <N>              Trailing lookback in days (default: 7)",
      "  --num-bins <N>                   Volume profile bins (default: 50)",
      "  --swing-left <N>                 Swing pivot left bars (default: 5)",
      "  --swing-right <N>                Swing pivot right bars (default: 5)",
      "  --hvn-std-dev <N>                HVN std-dev multiplier (default: 1.0)",
      "  --anchor-hhmm <HHMM>             Daily anchor time ET (default: 1700)",
      "  --feature-set <name>             Feature namespace (default: liquidity-zones)",
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
    const result = runLiquidityZoneScanner(repo, {
      sessionId,
      lookbackDays: Number(args["lookback-days"] || 7),
      numBins: Number(args["num-bins"] || 50),
      swingLeftBars: Number(args["swing-left"] || 5),
      swingRightBars: Number(args["swing-right"] || 5),
      hvnStdDevMultiplier: Number(args["hvn-std-dev"] || 1.0),
      anchorHHMM: Number(args["anchor-hhmm"] || 1700),
      featureSet: String(args["feature-set"] || "liquidity-zones").trim(),
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
