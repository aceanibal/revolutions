#!/usr/bin/env node
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { createBacktestRepository } = require("../data");

async function main() {
  const repo = createBacktestRepository();
  try {
    console.log(JSON.stringify(repo.listSessions(), null, 2));
  } finally {
    repo.close();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
