# Hyperliquid PS5 Dashboard MVP

Minimal split-brain day-trading dashboard MVP for Hyperliquid Testnet:
- Node.js backend handles Hyperliquid market stream + account info + PS5 DualSense input.
- Vanilla HTML/CSS/JS frontend renders a chart + HUD + PS5 button visualizer.

## Prerequisites

- Node.js 18+ (for native `fetch` in backend).
- npm.
- Optional: PS5 DualSense controller connected via USB for button actions.

## Install

```bash
npm init -y
npm install express socket.io ws node-hid
npm install --save-dev nodemon
```

## Run

```bash
npm start
```

For auto-reload while developing:

```bash
npm run dev
```

Open:
- `http://localhost:3000`

## Configure Account Balance Source

In `server.js`, replace:

```js
const HYPERLIQUID_ACCOUNT = "0xREPLACE_WITH_TESTNET_ADDRESS";
```

with your actual Hyperliquid testnet wallet address.

The backend fetches account info from:
- `https://api.hyperliquid-testnet.xyz/info`

and uses live account value for position sizing.

## Usage

1. Start the server.
2. Open the dashboard in your browser.
3. Type a symbol (for example `BTC`) in the symbol input and press Enter.
4. Watch live updates:
   - Price from L2 mid-price.
   - 1-minute candles on Lightweight Charts.
   - HUD values (`balance`, `stopLossPrice`, and `position size`).

Position size is computed as:
- `(balance * 0.02) / livePrice`

## PS5 Mappings

- Cross -> logs: `TRADE EXECUTED - 2% RISK`
- Triangle -> logs: `AZIZ METHOD - 50% CLOSE & BE`
- Circle -> logs: `BAILOUT`
- D-Pad -> adjusts `stopLossPrice` (and emits HUD updates)

Button events also flash on the on-screen PS5 visualizer.

## Milestone Logs (Intentional, low-noise)

Backend:
- `Server starting on port ...`
- `Express + Socket.io ready`
- `Connected to Hyperliquid WS`
- `Fetched account info: { balance }`
- `Subscribing to symbol: ...`
- `Unsubscribing from symbol: ...`
- `Received first data for symbol: ...`
- `Client connected: ...`
- `changeSymbol from client: ...`
- Trade action logs + `stopLossPrice updated: ...`

Frontend:
- `Socket.io connected`
- `Initial state received`
- `Symbol change requested`
- `First candle received for active symbol`
- `Controller event received`

## Troubleshooting

- If balance stays `0.00`, verify `HYPERLIQUID_ACCOUNT` is set to a valid address.
- If chart does not move, check server logs for WS connection/subscription milestones.
- If controller actions do not fire:
  - Confirm DualSense is connected via USB.
  - Ensure `node-hid` installed successfully on your system.
  - Check for `PS5 controller connected` in backend logs.
