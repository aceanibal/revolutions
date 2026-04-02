const { runBacktest, buildEvents } = require("./runBacktest");
const { resolveStrategy, listStrategies } = require("./strategies");
const { synthesizeTicksFromCandles } = require("./tickSynthesizer");

module.exports = {
  runBacktest,
  buildEvents,
  resolveStrategy,
  listStrategies,
  synthesizeTicksFromCandles
};
