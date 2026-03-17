# Hyperliquid PS5 Dashboard MVP

Minimal split-brain day-trading dashboard MVP for Hyperliquid mainnet:
- Node.js backend handles Hyperliquid market stream + account info.
- React + Tailwind frontend renders a chart + HUD.

## Prerequisites

- Node.js 18+ (for native `fetch` in backend).
- npm.
- Optional: PS5 DualSense connected through Enjoyable mappings.

## Install

```bash
npm init -y
npm install express socket.io ws
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

Backend uses environment variables to talk to Hyperliquid mainnet:

-- `HYPERLIQUID_INFO_URL` (default: `https://api.hyperliquid.xyz/info`)
-- `HYPERLIQUID_WS_URL` (default: `wss://api.hyperliquid.xyz/ws`)
- `HYPERLIQUID_ACCOUNT` – your Hyperliquid mainnet wallet address

Frontend uses:

- `VITE_HYPERLIQUID_INFO_URL` (default: `https://api.hyperliquid.xyz/info`)
- `VITE_BACKEND_BASE_URL` (default: `http://localhost:3000`)
- `VITE_HYPERLIQUID_ACCOUNT` – same address as backend

Set these before running to ensure everything points at mainnet and uses your real account for balance / risk sizing.

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

## Controller Input

PS5 controller input is expected to come from Enjoyable key mappings. The backend no longer opens HID devices directly.

Default backend key actions:
- `X` -> Cross (`TRADE EXECUTED - 2% RISK`)
- `J` -> Triangle (`AZIZ METHOD - 50% CLOSE & BE`)
- `K` -> Circle (`BAILOUT`)
- `L2` / `Q` -> move primary symbol to previous active stream
- `R2` / `E` -> move primary symbol to next active stream
- `W` / `D` -> `stopLossPrice + 5`
- `S` / `A` -> `stopLossPrice - 5`

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

Frontend:
- `Socket.io connected`
- `Initial state received`
- `Symbol change requested`
- `First candle received for active symbol`

## Troubleshooting

- If balance stays `0.00`, verify `HYPERLIQUID_ACCOUNT` is set to a valid address.
- If chart does not move, check server logs for WS connection/subscription milestones.
