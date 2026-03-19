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
  const hasToken = (token) => {
    const t = normalizeKeyName(token);
    return keys.some((key) => key === t || key.includes(` ${t}`) || key.includes(`${t} `));
  };

  if (includesAny("F1", "KEY F1")) return "cross";
  if (includesAny("F2", "KEY F2")) return "triangle";
  if (includesAny("F3", "KEY F3")) return "circle";
  if (includesAny("F4", "KEY F4")) return "primaryPrev";
  if (includesAny("F5", "KEY F5")) return "primaryNext";
  if (includesAny("3", "KEY 3", "NUMPAD 3")) return "toggleDirection";
  if (includesAny("F6", "KEY F6") || hasToken("F6")) return "dpadUp";
  if (includesAny("F8", "KEY F8") || hasToken("F8")) return "dpadDown";
  if (includesAny("F9", "KEY F9")) return "stopLossSnap";
  if (includesAny("F10", "KEY F10")) return "updateStopLoss";

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

  const REPEAT_ACTIONS = new Set(["dpadUp", "dpadDown"]);
  const REPEAT_INITIAL_MS = 300;
  const REPEAT_INTERVAL_MS = 80;

  let repeatTimer = null;
  let repeatAction = null;

  function stopRepeat() {
    if (repeatTimer) {
      clearInterval(repeatTimer);
      repeatTimer = null;
      repeatAction = null;
    }
  }

  const listener = (event, down) => {
    const candidates = extractKeyCandidates(event);
    const action = mapGlobalKeyNameToAction(candidates);
    const state = normalizeKeyName(event?.state);
    const isDown = state === "DOWN" || !state;
    const isUp = state === "UP";

    if (action && REPEAT_ACTIONS.has(action)) {
      if (isDown) {
        // Some controllers/remappers may fire repeated DOWN events while held.
        // If we are already repeating this action, ignore duplicates so speed
        // doesn't multiply.
        if (repeatAction === action && repeatTimer) {
          return;
        }
        console.log(`[keyboard] action=${action} keys=${candidates.join(",")}`);
        onAction(action);
        stopRepeat();
        repeatAction = action;
        repeatTimer = setTimeout(() => {
          repeatTimer = setInterval(() => onAction(action), REPEAT_INTERVAL_MS);
        }, REPEAT_INITIAL_MS);
      } else if (isUp && repeatAction === action) {
        stopRepeat();
      }
      return;
    }

    if (!isDown) return;

    if (action) {
      console.log(`[keyboard] action=${action} keys=${candidates.join(",")}`);
      onAction(action);
      return;
    }

    if (candidates.length > 0) {
      const mods = Object.entries(down || {})
        .filter(([, v]) => v)
        .map(([k]) => k);
      //console.log(`[keyboard] unmatched: ${candidates.join(", ")}${mods.length ? ` mods=[${mods.join(",")}]` : ""}`);
    }
  };

  keyboard.addListener(listener).catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("Failed to initialize global keyboard listener:", reason);
    process.exit(1);
  });

  console.log(
    "Global keyboard listener active — " +
    "F1=cross F2=triangle F3=circle 3=direction F4/F5=primary F6/F8=stopLoss+/- F9=snap F10=updateSL"
  );

  return () => {
    stopRepeat();
    keyboard.removeListener(listener);
    keyboard.kill();
  };
}

module.exports = {
  setupKeyboardController
};
