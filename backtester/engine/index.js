const { runBacktest, buildEvents } = require("./runBacktest");
const { resolveStrategy } = require("./strategies");
const { synthesizeTicksFromCandles } = require("./tickSynthesizer");

module.exports = {
  runBacktest,
  buildEvents,
  resolveStrategy,
  synthesizeTicksFromCandles
};
