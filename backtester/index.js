const { createBacktestRepository, defaultBacktestSqlitePath, defaultSourceSqlitePath } = require("./data");
const { runBacktest, buildEvents, resolveStrategy, listStrategies } = require("./engine");
const { createReplayController, createTickReplay, createCandleReplay, createMixedReplay } = require("./simulator");
const { persistRun } = require("./results");
const { importSession, listSourceSessions } = require("./import/sessionImporter");

module.exports = {
  createBacktestRepository,
  defaultBacktestSqlitePath,
  defaultSourceSqlitePath,
  importSession,
  listSourceSessions,
  runBacktest,
  buildEvents,
  resolveStrategy,
  listStrategies,
  createReplayController,
  createTickReplay,
  createCandleReplay,
  createMixedReplay,
  persistRun
};
