const { fork } = require("child_process");
const path = require("path");
const readline = require("readline");

const SERVER_SCRIPT = path.join(__dirname, "server.js");
const RESTART_DELAY_MS = 500;
const CRASH_WINDOW_MS = 15_000;
const STABLE_UPTIME_MS = 8_000;

let child = null;
let intentionalKill = false;
let restartCount = 0;
let spawnTimer = null;
let reloadInProgress = false;
let pendingReload = false;
let quitting = false;
let lastStartAtMs = 0;
const recentCrashTimes = [];

function banner() {
  console.log("\n\x1b[36m╔══════════════════════════════════════════════╗");
  console.log("║  rs | reload    restart server                ║");
  console.log("║  quit | exit    stop everything               ║");
  console.log("║  clear          clear terminal                ║");
  console.log("║  Ctrl+C         reload (not kill)             ║");
  console.log("╚══════════════════════════════════════════════╝\x1b[0m\n");
}

function scheduleSpawn(delayMs = RESTART_DELAY_MS) {
  if (quitting) return;
  if (spawnTimer) clearTimeout(spawnTimer);
  spawnTimer = setTimeout(() => {
    spawnTimer = null;
    spawnServer();
  }, delayMs);
}

function computeRestartDelay(uptimeMs) {
  if (uptimeMs >= STABLE_UPTIME_MS) {
    recentCrashTimes.length = 0;
    return RESTART_DELAY_MS;
  }

  const now = Date.now();
  recentCrashTimes.push(now);
  while (recentCrashTimes.length && now - recentCrashTimes[0] > CRASH_WINDOW_MS) {
    recentCrashTimes.shift();
  }

  if (recentCrashTimes.length >= 5) return 5_000;
  if (recentCrashTimes.length >= 3) return 2_000;
  return RESTART_DELAY_MS;
}

function spawnServer() {
  if (quitting || child) return;
  lastStartAtMs = Date.now();
  child = fork(SERVER_SCRIPT, [], {
    stdio: ["pipe", "inherit", "inherit", "ipc"],
    env: { ...process.env }
  });

  child.on("exit", (code, signal) => {
    const uptimeMs = Date.now() - lastStartAtMs;
    const killedByLauncher = intentionalKill;
    child = null;
    intentionalKill = false;

    if (quitting) return;
    if (killedByLauncher) {
      return;
    }

    const delayMs = computeRestartDelay(uptimeMs);
    console.log(
      `\x1b[33m[launcher] Server exited (code=${code} signal=${signal}), restarting in ${delayMs}ms...\x1b[0m`
    );
    scheduleSpawn(delayMs);
  });

  child.on("error", (err) => {
    console.error(`\x1b[31m[launcher] Failed to spawn server: ${err.message}\x1b[0m`);
  });

  restartCount++;
  const label = restartCount === 1 ? "Started" : `Restarted (#${restartCount})`;
  console.log(`\x1b[32m[launcher] ${label} server (pid ${child.pid})\x1b[0m`);
  if (restartCount > 1) banner();
}

function killChild() {
  return new Promise((resolve) => {
    if (!child) return resolve();
    intentionalKill = true;
    child.once("exit", resolve);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 3000);
  });
}

async function processReloadQueue() {
  if (reloadInProgress || quitting || !pendingReload) return;
  reloadInProgress = true;
  pendingReload = false;
  console.log("\x1b[33m[launcher] Reloading server...\x1b[0m");
  await killChild();
  scheduleSpawn(RESTART_DELAY_MS);
  reloadInProgress = false;

  if (pendingReload) {
    setImmediate(() => {
      void processReloadQueue();
    });
  }
}

function requestReload(source = "manual") {
  if (quitting) return;
  pendingReload = true;
  if (reloadInProgress) {
    console.log(`\x1b[90m[launcher] Reload already in progress, coalescing request (${source}).\x1b[0m`);
    return;
  }
  void processReloadQueue();
}

async function quit() {
  quitting = true;
  if (spawnTimer) {
    clearTimeout(spawnTimer);
    spawnTimer = null;
  }
  console.log("\x1b[33m[launcher] Shutting down...\x1b[0m");
  await killChild();
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  const cmd = line.trim().toLowerCase();
  if (cmd === "rs" || cmd === "reload") {
    requestReload("command");
  } else if (cmd === "quit" || cmd === "exit") {
    quit();
  } else if (cmd === "clear") {
    process.stdout.write("\x1Bc");
    banner();
  } else if (cmd) {
    console.log(`\x1b[90m[launcher] Unknown command: "${cmd}" (try rs, reload, quit, exit, clear)\x1b[0m`);
  }
});

process.on("SIGINT", () => requestReload("SIGINT"));
process.on("SIGTERM", () => quit());

banner();
spawnServer();
