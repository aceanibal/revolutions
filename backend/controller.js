const { GlobalKeyboardListener } = require("node-global-key-listener");

function normalizeKeyName(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^ANSI /, "");
}

function extractKeyCandidates(event) {
  const candidates = [
    event?.name,
    event?.rawKey?.name,
    event?.rawKey?._nameRaw
  ]
    .map(normalizeKeyName)
    .filter(Boolean);
  return Array.from(new Set(candidates));
}

function mapGlobalKeyNameToAction(candidates) {
  const keys = candidates.map(normalizeKeyName);

  if (keys.includes("X") || keys.includes("KEY X")) return "cross";
  if (keys.includes("J") || keys.includes("KEY J")) return "triangle";
  if (keys.includes("K") || keys.includes("KEY K")) return "circle";
  if (keys.includes("Q") || keys.includes("KEY Q")) return "primaryPrev";
  if (keys.includes("E") || keys.includes("KEY E")) return "primaryNext";

  if (keys.includes("W") || keys.includes("KEY W")) {
    return "dpadUp";
  }
  if (keys.includes("S") || keys.includes("KEY S")) {
    return "dpadDown";
  }
  if (keys.includes("A") || keys.includes("KEY A")) {
    return "dpadLeft";
  }
  if (keys.includes("D") || keys.includes("KEY D")) {
    return "dpadRight";
  }

  return null;
}

function setupKeyboardController({ onAction, onShutdownRequested }) {
  if (typeof onAction !== "function") {
    throw new Error("setupKeyboardController requires an onAction callback");
  }

  const keyboard = new GlobalKeyboardListener({
    mac: {
      onError: (errorCode) => console.error("[keyboard] mac error:", errorCode),
      onInfo: (info) => console.log("[keyboard] mac info:", info)
    }
  });

  const listener = (event, down) => {
    if (event?.state !== "DOWN") return;

    const candidates = extractKeyCandidates(event);
    const action = mapGlobalKeyNameToAction(candidates);
    if (action) {
      onAction(action);
      return;
    }

    const ctrlDown = Boolean(down?.["LEFT CTRL"] || down?.["RIGHT CTRL"]);
    if (ctrlDown && String(event?.name || "").toUpperCase() === "C") {
      if (typeof onShutdownRequested === "function") {
        onShutdownRequested();
      }
    }
  };

  // If this fails (for example missing OS permissions on macOS),
  // startup should fail so we don't silently run without keyboard input.
  keyboard.addListener(listener).catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("Failed to initialize global keyboard listener:", reason);
    process.exit(1);
  });

  console.log("Global keyboard listener active: X=cross J=triangle K=circle WASD=D-pad");

  return () => {
    keyboard.removeListener(listener);
    keyboard.kill();
  };
}

module.exports = {
  setupKeyboardController
};
