#!/usr/bin/env node
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { importSession } = require("../import/sessionImporter");

async function main() {
  const sessionId = String(process.argv[2] || "").trim();
  if (!sessionId) {
    console.error("Usage: node scripts/importSession.js <sessionId>");
    process.exit(1);
  }
  const result = await importSession({ sessionId });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
