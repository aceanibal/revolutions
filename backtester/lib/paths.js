const path = require("path");

const REVOLUTIONS_ROOT = path.resolve(__dirname, "..", "..");
const BACKTESTER_ROOT = path.resolve(__dirname, "..");

function backendDataPath(...segments) {
  return path.join(REVOLUTIONS_ROOT, "backend", "data", ...segments);
}

function backtesterDataPath(...segments) {
  return path.join(BACKTESTER_ROOT, "data", ...segments);
}

module.exports = {
  REVOLUTIONS_ROOT,
  BACKTESTER_ROOT,
  backendDataPath,
  backtesterDataPath
};
