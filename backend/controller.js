const HID = require("node-hid");

const STOP_LOSS_STEP = 5;

const controllerState = {
  connected: false,
  device: null,
  notFoundLogged: false,
  previous: {
    cross: false,
    triangle: false,
    circle: false,
    dpadUp: false,
    dpadDown: false,
    dpadLeft: false,
    dpadRight: false
  }
};

function detectDpad(rawValue) {
  const v = Number(rawValue);
  if (!Number.isInteger(v)) {
    return {
      dpadUp: false,
      dpadDown: false,
      dpadLeft: false,
      dpadRight: false
    };
  }

  return {
    dpadUp: [0, 1, 7].includes(v),
    dpadRight: [1, 2, 3].includes(v),
    dpadDown: [3, 4, 5].includes(v),
    dpadLeft: [5, 6, 7].includes(v)
  };
}

function extractButtonsFromReport(data) {
  const buttonByteCandidates = [8, 9, 7];
  const dpadByteCandidates = [7, 8, 9];

  let buttonByte = 0;
  for (const idx of buttonByteCandidates) {
    if (data[idx] !== undefined) {
      buttonByte = data[idx];
      break;
    }
  }

  let dpadNibble = 8;
  for (const idx of dpadByteCandidates) {
    if (data[idx] !== undefined) {
      dpadNibble = data[idx] & 0x0f;
      break;
    }
  }

  const dpad = detectDpad(dpadNibble);
  const cross = (buttonByte & (1 << 1)) !== 0;
  const circle = (buttonByte & (1 << 2)) !== 0;
  const triangle = (buttonByte & (1 << 3)) !== 0;

  return { cross, triangle, circle, ...dpad };
}

function emitController(io, button) {
  io.emit("controllerEvent", {
    button,
    action: "pressed",
    ts: Date.now()
  });
}

function handleButtonEdges(io, nextState, onStopLossDelta) {
  const prev = controllerState.previous;

  if (nextState.cross && !prev.cross) {
    console.log("TRADE EXECUTED - 2% RISK");
    emitController(io, "cross");
  }

  if (nextState.triangle && !prev.triangle) {
    console.log("AZIZ METHOD - 50% CLOSE & BE");
    emitController(io, "triangle");
  }

  if (nextState.circle && !prev.circle) {
    console.log("BAILOUT");
    emitController(io, "circle");
  }

  if (nextState.dpadUp && !prev.dpadUp) {
    if (typeof onStopLossDelta === "function") {
      onStopLossDelta(STOP_LOSS_STEP);
    }
    emitController(io, "dpadUp");
  }

  if (nextState.dpadDown && !prev.dpadDown) {
    if (typeof onStopLossDelta === "function") {
      onStopLossDelta(-STOP_LOSS_STEP);
    }
    emitController(io, "dpadDown");
  }

  if (nextState.dpadLeft && !prev.dpadLeft) {
    if (typeof onStopLossDelta === "function") {
      onStopLossDelta(-STOP_LOSS_STEP);
    }
    emitController(io, "dpadLeft");
  }

  if (nextState.dpadRight && !prev.dpadRight) {
    if (typeof onStopLossDelta === "function") {
      onStopLossDelta(STOP_LOSS_STEP);
    }
    emitController(io, "dpadRight");
  }

  controllerState.previous = nextState;
}

function openController() {
  const devices = HID.devices();
  const dualSense = devices.find((device) => {
    const vendorMatch = device.vendorId === 0x054c;
    const productMatch = [0x0ce6, 0x0df2].includes(device.productId);
    return vendorMatch && productMatch;
  });

  if (!dualSense) {
    if (controllerState.connected && controllerState.device) {
      try {
        controllerState.device.close();
      } catch (error) {
        // No-op: device is already unavailable.
      }
      controllerState.connected = false;
      controllerState.device = null;
    }
    if (!controllerState.notFoundLogged) {
      console.log("PS5 controller not found");
      controllerState.notFoundLogged = true;
    }
    return;
  }

  if (controllerState.connected) {
    return;
  }

  try {
    controllerState.device = new HID.HID(dualSense.vendorId, dualSense.productId);
    controllerState.device.setNonBlocking(true);
    controllerState.connected = true;
    controllerState.notFoundLogged = false;
    console.log("PS5 controller connected via HID (vid/pid)");
  } catch (error) {
    controllerState.connected = false;
    controllerState.device = null;
    console.log("PS5 controller open error:", error.message);
  }
}

function pollController({ io, onStopLossDelta }) {
  openController();

  if (!controllerState.connected || !controllerState.device) {
    return;
  }

  try {
    const data = controllerState.device.readSync();
    if (!data || !data.length) {
      return;
    }
    const nextState = extractButtonsFromReport(data);
    handleButtonEdges(io, nextState, onStopLossDelta);
  } catch (error) {
    controllerState.connected = false;
    controllerState.device = null;
    controllerState.previous = {
      cross: false,
      triangle: false,
      circle: false,
      dpadUp: false,
      dpadDown: false,
      dpadLeft: false,
      dpadRight: false
    };
  }
}

module.exports = {
  pollController
};

