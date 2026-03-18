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
  const includesAny = (...values) =>
    values.some((value) => keys.includes(normalizeKeyName(value)));

  if (includesAny("F1", "KEY F1")) return "cross";
  if (includesAny("F2", "KEY F2")) return "triangle";
  if (includesAny("F3", "KEY F3")) return "circle";
  if (includesAny("F4", "KEY F4")) return "primaryPrev";
  if (includesAny("F5", "KEY F5")) return "primaryNext";

  if (includesAny("F6", "KEY F6")) {
    return "dpadUp";
  }
  if (includesAny("F7", "KEY F7")) {
    return "dpadDown";
  }
  if (includesAny("F8", "KEY F8")) {
    return "dpadLeft";
  }
  if (includesAny("F9", "KEY F9")) {
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

  console.log("Global keyboard listener active: F1=cross F2=triangle F3=circle F4/F5=primary F6-F9=D-pad");

  return () => {
    keyboard.removeListener(listener);
    keyboard.kill();
  };
}

module.exports = {
  setupKeyboardController
};
