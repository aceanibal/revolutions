const { fork } = require("child_process");
const path = require("path");
const readline = require("readline");

const SERVER_SCRIPT = path.join(__dirname, "server.js");
const RESTART_DELAY_MS = 500;

let child = null;
let intentionalKill = false;
let restartCount = 0;

function banner() {
  console.log("\n\x1b[36m╔══════════════════════════════════════════════╗");
  console.log("║  rs | reload    restart server                ║");
  console.log("║  quit | exit    stop everything               ║");
  console.log("║  clear          clear terminal                ║");
  console.log("║  Ctrl+C         reload (not kill)             ║");
  console.log("╚══════════════════════════════════════════════╝\x1b[0m\n");
}

function spawnServer() {
  child = fork(SERVER_SCRIPT, [], {
    stdio: ["pipe", "inherit", "inherit", "ipc"],
    env: { ...process.env }
  });

  child.on("exit", (code, signal) => {
    child = null;
    if (intentionalKill) {
      intentionalKill = false;
      return;
    }
    console.log(
      `\x1b[33m[launcher] Server exited (code=${code} signal=${signal}), restarting in ${RESTART_DELAY_MS}ms...\x1b[0m`
    );
    setTimeout(spawnServer, RESTART_DELAY_MS);
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

async function reload() {
  console.log("\x1b[33m[launcher] Reloading server...\x1b[0m");
  await killChild();
  setTimeout(spawnServer, RESTART_DELAY_MS);
}

async function quit() {
  console.log("\x1b[33m[launcher] Shutting down...\x1b[0m");
  await killChild();
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  const cmd = line.trim().toLowerCase();
  if (cmd === "rs" || cmd === "reload") {
    reload();
  } else if (cmd === "quit" || cmd === "exit") {
    quit();
  } else if (cmd === "clear") {
    process.stdout.write("\x1Bc");
    banner();
  } else if (cmd) {
    console.log(`\x1b[90m[launcher] Unknown command: "${cmd}" (try rs, reload, quit, exit, clear)\x1b[0m`);
  }
});

process.on("SIGINT", () => reload());
process.on("SIGTERM", () => quit());

banner();
spawnServer();
