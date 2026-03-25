const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { DEFAULT_STUDY_CONFIG, normalizeStudyConfig } = require("./orbAvwapConfig");

const RUNS_DIR = path.resolve(__dirname, "runs");
const PYTHON_SCRIPT = path.resolve(__dirname, "orb_avwap_backtest.py");

function mergeConfig(base, override) {
  return {
    ...base,
    ...(override || {}),
    orb: { ...base.orb, ...(override?.orb || {}) },
    avwap: { ...base.avwap, ...(override?.avwap || {}) },
    execution: { ...base.execution, ...(override?.execution || {}) },
    validation: { ...base.validation, ...(override?.validation || {}) }
  };
}

function crossProductGrid(grid = {}) {
  const entries = Object.entries(grid).filter(([, values]) => Array.isArray(values) && values.length > 0);
  if (entries.length === 0) return [{}];
  let combos = [{}];
  for (const [key, values] of entries) {
    const next = [];
    for (const current of combos) {
      for (const value of values) {
        next.push({ ...current, [key]: value });
      }
    }
    combos = next;
  }
  return combos;
}

function deepSet(target, dottedKey, value) {
  const parts = String(dottedKey || "").split(".").filter(Boolean);
  if (!parts.length) return target;
  let cursor = target;
  for (let i = 0; i < parts.length; i += 1) {
    const k = parts[i];
    if (i === parts.length - 1) {
      cursor[k] = value;
      return target;
    }
    if (!cursor[k] || typeof cursor[k] !== "object") cursor[k] = {};
    cursor = cursor[k];
  }
  return target;
}

async function runPythonBacktest(config, cases) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [PYTHON_SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || `Python backtester failed with code ${code}`));
      }
      try {
        resolve(JSON.parse(stdout || "{}"));
      } catch (error) {
        reject(new Error(`Failed to parse backtest output: ${error.message}`));
      }
    });

    child.stdin.write(JSON.stringify({ config, cases }));
    child.stdin.end();
  });
}

async function buildCases(sessionStore, { sessionIds, symbol, limit = 60 }) {
  const allSessions = await sessionStore.listAllSessions();
  const selectedSessionIds = Array.isArray(sessionIds) && sessionIds.length
    ? sessionIds.map((id) => String(id))
    : allSessions.slice(0, limit).map((session) => String(session.id));
  const cases = [];

  for (const sessionId of selectedSessionIds) {
    let chosenSymbol = symbol ? String(symbol).toUpperCase() : "";
    if (!chosenSymbol) {
      const symbols = await sessionStore.getSessionSymbols(sessionId);
      chosenSymbol = symbols[0] ? String(symbols[0]).toUpperCase() : "";
    }
    if (!chosenSymbol) continue;
    const snapshot = await sessionStore.getSessionSnapshot(sessionId, chosenSymbol, "all");
    if (!snapshot) continue;
    cases.push({
      sessionId,
      symbol: chosenSymbol,
      startedAtMs: Number(snapshot?.sessionInfo?.startedAtMs || 0),
      candles1m: snapshot?.candlesByTimeframe?.["1m"] || [],
      candles5m: snapshot?.candlesByTimeframe?.["5m"] || []
    });
  }
  return cases;
}

async function persistRun(runType, payload) {
  await fs.mkdir(RUNS_DIR, { recursive: true });
  const runId = payload?.runId || `${runType}-${Date.now()}`;
  const runPath = path.join(RUNS_DIR, `${runId}.json`);
  await fs.writeFile(runPath, JSON.stringify(payload, null, 2), "utf8");
  return { runId, runPath };
}

function scoreExperiment(result) {
  const val = result?.outOfSample || {};
  const train = result?.inSample || {};
  const valExpectancy = Number(val.expectancyR || 0);
  const trainExpectancy = Number(train.expectancyR || 0);
  const valTrades = Number(val.tradeCount || 0);
  const overfitGap = Math.max(0, trainExpectancy - valExpectancy);
  return valExpectancy * Math.sqrt(Math.max(1, valTrades)) - overfitGap;
}

async function runStudy(sessionStore, params = {}) {
  const merged = mergeConfig(DEFAULT_STUDY_CONFIG, params?.config || {});
  const config = normalizeStudyConfig(merged);
  const cases = await buildCases(sessionStore, {
    sessionIds: params?.sessionIds,
    symbol: params?.symbol,
    limit: params?.limit
  });
  const result = await runPythonBacktest(config, cases);
  const payload = {
    ...result,
    runType: "single",
    config,
    caseCount: cases.length
  };
  await persistRun("single", payload);
  return payload;
}

async function runExperimentBatch(sessionStore, params = {}) {
  const mergedBase = mergeConfig(DEFAULT_STUDY_CONFIG, params?.baseConfig || {});
  const baseConfig = normalizeStudyConfig(mergedBase);
  const cases = await buildCases(sessionStore, {
    sessionIds: params?.sessionIds,
    symbol: params?.symbol,
    limit: params?.limit
  });

  const maxExperiments = Math.max(1, Math.min(50, Number(params?.maxExperiments || 12)));
  const combos = crossProductGrid(params?.parameterGrid || {}).slice(0, maxExperiments);
  const runs = [];

  for (const combo of combos) {
    const override = {};
    for (const [k, v] of Object.entries(combo)) {
      deepSet(override, k, v);
    }
    const config = normalizeStudyConfig(mergeConfig(baseConfig, override));
    const result = await runPythonBacktest(config, cases);
    runs.push({
      runId: result.runId,
      config,
      aggregate: result.aggregate,
      inSample: result.inSample,
      outOfSample: result.outOfSample,
      score: scoreExperiment(result),
      caseCount: cases.length,
      tradeCount: Number(result?.aggregate?.tradeCount || 0)
    });
  }

  runs.sort((a, b) => b.score - a.score);
  const payload = {
    runId: `orb-avwap-exp-${Date.now()}`,
    generatedAtMs: Date.now(),
    runType: "experiments",
    baseConfig,
    parameterGrid: params?.parameterGrid || {},
    runs
  };
  await persistRun("experiments", payload);
  return payload;
}

async function listRuns(limit = 20) {
  await fs.mkdir(RUNS_DIR, { recursive: true });
  const names = (await fs.readdir(RUNS_DIR)).filter((name) => name.endsWith(".json"));
  const withStats = await Promise.all(
    names.map(async (name) => {
      const fullPath = path.join(RUNS_DIR, name);
      const stat = await fs.stat(fullPath);
      return { name, fullPath, mtimeMs: stat.mtimeMs };
    })
  );
  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const sliced = withStats.slice(0, Math.max(1, Math.min(100, Number(limit || 20))));
  const rows = [];
  for (const item of sliced) {
    try {
      const payload = JSON.parse(await fs.readFile(item.fullPath, "utf8"));
      rows.push({
        runId: payload.runId || item.name.replace(/\.json$/i, ""),
        runType: payload.runType || "unknown",
        generatedAtMs: Number(payload.generatedAtMs || item.mtimeMs),
        caseCount: Number(payload.caseCount || 0),
        tradeCount: Number(payload?.aggregate?.tradeCount || 0),
        netR: Number(payload?.aggregate?.netR || 0)
      });
    } catch {
      rows.push({
        runId: item.name.replace(/\.json$/i, ""),
        runType: "unknown",
        generatedAtMs: Number(item.mtimeMs),
        caseCount: 0,
        tradeCount: 0,
        netR: 0
      });
    }
  }
  return rows;
}

async function getRun(runId) {
  const filePath = path.join(RUNS_DIR, `${String(runId || "").trim()}.json`);
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content);
}

module.exports = {
  DEFAULT_STUDY_CONFIG,
  normalizeStudyConfig,
  runStudy,
  runExperimentBatch,
  listRuns,
  getRun
};
