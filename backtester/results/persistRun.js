const fs = require("fs");
const path = require("path");
const { backtesterDataPath } = require("../lib/paths");

function persistRun(runResult, options = {}) {
  const runsDir = options.runsDir || backtesterDataPath("runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const safeSession = String(runResult?.meta?.sessionId || "session").replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeSymbol = String(runResult?.meta?.symbol || "symbol").replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${safeSession}__${safeSymbol}__${Date.now()}.json`;
  const outputPath = path.join(runsDir, filename);
  fs.writeFileSync(outputPath, JSON.stringify(runResult, null, 2), "utf8");
  return outputPath;
}

module.exports = {
  persistRun
};
