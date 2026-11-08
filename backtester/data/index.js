const path = require("path");
const { BacktestRepository } = require("./repository");
const { backtesterDataPath, backendDataPath } = require("../lib/paths");

function defaultBacktestSqlitePath() {
  return process.env.BACKTEST_SQLITE_PATH || backtesterDataPath("backtest.sqlite");
}

function defaultSourceSqlitePath() {
  return process.env.SOURCE_SQLITE_PATH || backendDataPath("sessions.sqlite");
}

function createBacktestRepository(options = {}) {
  const sqlitePath = options.sqlitePath || defaultBacktestSqlitePath();
  const repo = new BacktestRepository({ sqlitePath: path.resolve(sqlitePath) });
  repo.init();
  return repo;
}

module.exports = {
  BacktestRepository,
  createBacktestRepository,
  defaultBacktestSqlitePath,
  defaultSourceSqlitePath
};
