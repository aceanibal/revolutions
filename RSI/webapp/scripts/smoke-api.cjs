/**
 * Smoke test for RSI webapp API. Starts the server if nothing is listening,
 * then exercises /api/health, /api/runs, /api/run/load, /api/candles/query.
 */
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const WEBAPP_ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.RSI_WEBAPP_API_PORT || 3006);

function httpRequest(method, pathname, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = bodyObj != null ? JSON.stringify(bodyObj) : null;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path: pathname,
        method,
        headers:
          body != null
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body)
              }
            : {}
      },
      (res) => {
        let data = "";
        res.on("data", (c) => {
          data += c;
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tryHealth() {
  try {
    const r = await httpRequest("GET", "/api/health");
    return r.status === 200 && r.body && r.body.ok === true;
  } catch {
    return false;
  }
}

async function main() {
  let startedHere = false;
  let child = null;

  if (!(await tryHealth())) {
    console.log("[smoke] Starting API server…");
    child = spawn("node", ["server/index.cjs"], {
      cwd: WEBAPP_ROOT,
      stdio: "ignore",
      detached: false
    });
    startedHere = true;
    for (let i = 0; i < 30; i += 1) {
      await sleep(200);
      if (await tryHealth()) break;
    }
    if (!(await tryHealth())) {
      if (child) child.kill();
      throw new Error("Server did not become healthy in time.");
    }
  }

  const checks = [];

  const h = await httpRequest("GET", "/api/health");
  checks.push(["GET /api/health", h.status === 200 && h.body?.ok]);
  console.log("[smoke] health:", h.body);

  const runsRes = await httpRequest("GET", "/api/runs");
  checks.push(["GET /api/runs", runsRes.status === 200 && runsRes.body?.ok]);
  const runs = runsRes.body?.runs || [];
  const defaultId = runsRes.body?.defaultRunId || runs[0]?.id;
  console.log("[smoke] runs count:", runs.length, "default:", defaultId || "(none)", "dbExists:", runsRes.body?.dbExists);

  if (!defaultId) {
    console.warn("[smoke] No runs to load — skipping load + candles (still OK if repo has no RSI/runs).");
  } else {
    const loadRes = await httpRequest("POST", "/api/run/load", { runId: defaultId });
    checks.push(["POST /api/run/load", loadRes.status === 200 && loadRes.body?.ok]);
    const tpKeys = loadRes.body?.tpTrades ? Object.keys(loadRes.body.tpTrades) : [];
    console.log("[smoke] loaded run:", loadRes.body?.runFolderName, "tp files:", tpKeys.length);

    const firstTp = tpKeys.sort()[0];
    const rows = firstTp ? loadRes.body.tpTrades[firstTp] : [];
    const firstTrade = rows[0];
    if (firstTrade && runsRes.body?.dbExists) {
      const fromMs = Date.parse(firstTrade.entry_ts_utc) - 86400000;
      const toMs = Date.parse(firstTrade.exit_ts_utc) + 86400000;
      const c4 = await httpRequest("POST", "/api/candles/query", {
        symbol: firstTrade.symbol,
        timeframe: "4h",
        fromMs,
        toMs
      });
      const n4 = Array.isArray(c4.body?.candles) ? c4.body.candles.length : 0;
      checks.push(["POST /api/candles/query 4h", c4.status === 200 && c4.body?.ok && n4 > 0]);
      console.log("[smoke] candles 4h:", n4);

      const c5 = await httpRequest("POST", "/api/candles/query", {
        symbol: firstTrade.symbol,
        timeframe: "5m",
        fromMs,
        toMs
      });
      const n5 = Array.isArray(c5.body?.candles) ? c5.body.candles.length : 0;
      checks.push(["POST /api/candles/query 5m", c5.status === 200 && c5.body?.ok && n5 > 0]);
      console.log("[smoke] candles 5m:", n5);
    } else {
      console.warn("[smoke] Skip candle checks (no trade row or DB missing).");
    }
  }

  if (startedHere && child) {
    child.kill("SIGTERM");
    await sleep(100);
  }

  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length) {
    console.error("[smoke] FAILED:", failed.map(([name]) => name).join(", "));
    process.exit(1);
  }
  console.log("[smoke] All checks passed.");
}

main().catch((err) => {
  console.error("[smoke] Error:", err.message || err);
  process.exit(1);
});
