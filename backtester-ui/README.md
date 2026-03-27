# Backtester UI

Standalone React + Vite UI for the SQLite-first backtester.

## Run

```bash
cd /Users/anibalperez/revolutions/backtester-ui
npm install
npm run dev
```

Default dev URL: `http://localhost:5174`

## Backend dependency

This UI calls `http://localhost:3000/api/backtest/*` by default.

- Vite proxy is configured for `/api` -> `http://localhost:3000`.
- Override base URL with `VITE_BACKEND_BASE_URL` if needed.

## Scope

- Session browser
- Symbol/timeframe selection
- Backtest run trigger
- Price + equity charts
- Data provenance stats (`history`, `live`, `gap_fill`, `mixed`)
- Session trades + scanner metadata views

For complete architecture, schema, and replay semantics, see `backtester/README.md`.
