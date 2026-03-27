#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { createBacktestRepository } = require("../data");

/**
 * Usage:
 * node scripts/importScannerMetadata.js <sessionId> <jsonFilePath> [toolName] [sourceId]
 */
async function main() {
  const sessionId = String(process.argv[2] || "").trim();
  const payloadPath = String(process.argv[3] || "").trim();
  const tool = String(process.argv[4] || "scanner").trim();
  const sourceId = String(process.argv[5] || "").trim();
  if (!sessionId || !payloadPath) {
    console.error(
      "Usage: node scripts/importScannerMetadata.js <sessionId> <jsonFilePath> [toolName] [sourceId]"
    );
    process.exit(1);
  }

  const raw = fs.readFileSync(path.resolve(payloadPath), "utf8");
  const payload = JSON.parse(raw);
  const repo = createBacktestRepository();
  try {
    repo.importScannerMetadata({ sessionId, tool, sourceId, payload });
    console.log(JSON.stringify({ ok: true, sessionId, tool, sourceId }, null, 2));
  } finally {
    repo.close();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
