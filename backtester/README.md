# Backtester (SQLite-first)

`backtester/` is a standalone package for importing saved sessions into a separate SQLite database and running offline backtests with replay support.

## Design goals

- Runtime reads come from SQLite only.
- Session provenance is explicit: historical, live, gap_fill, mixed.
- Tick, candle, and mixed replay modes are all supported.
- Scanner/external metadata is tracked per session.
- Data is isolated from the live dashboard database.

## Folder layout

- `data/`  
  Backtester database (`backtest.sqlite`), optional run artifacts (`data/runs/*.json`), and repository/data-layer code.
- `engine/`  
  Event builders + backtest runner + strategy resolution.
- `simulator/`  
  Replay controllers (`tick`, `candle`, `mixed`).
- `results/`  
  Run schema and optional JSON persistence.
- `import/`  
  SQL bridge from source `backend/data/sessions.sqlite` into `backtest.sqlite`.
- `runner/`  
  CLI entry for batch execution.
- `scripts/`  
  Convenience commands (`import`, `list`, scanner metadata import).
- `lib/`  
  Path utilities.

## Environment variables

- `BACKTEST_SQLITE_PATH`  
  Backtester DB file path. Used by scripts and by backend `/api/backtest/*` routes.  
  Default: `backtester/data/backtest.sqlite`
- `SOURCE_SQLITE_PATH`  
  Source DB path for import.  
  Default: `backend/data/sessions.sqlite`

Recommendation: keep backend and CLI pointed at the same `BACKTEST_SQLITE_PATH`.

## Data dictionary

This package mirrors the session schema used by the app and extends it with scanner metadata.

- `sessions`  
  Session-level state and counts (`started_at_ms`, `ended_at_ms`, `status`, `asset_count`, etc).
- `session_ticks`  
  Tick stream (`ts_ms`, `price`, `size`, `source`) for tick-level replay.
- `session_candles`  
  Candle buckets (`timeframe`, `bucket_start_ms`, OHLCV, `source`, `is_gap_fill`) for bar replay and provenance analysis.
- `session_notes`, `session_trades`, `session_trade_state`  
  Copied along with sessions for context and analytics.
- `session_external_metadata`  
  Extensible external payloads per session:  
  `session_id`, `tool`, `source_id`, `payload_json`, `imported_at_ms`.

### Candle provenance semantics

- `source = history`  
  Candle came from historical REST snapshot.
- `source = live`  
  Candle built from real-time tick ingestion.
- `source = gap_fill`  
  Candle inserted specifically to fill detected missing buckets.
- `source = mixed`  
  Candle merged/reconciled from multiple origins (common after live + historical overlap).
- `is_gap_fill = 1`  
  Explicit flag that bucket was gap-repair material.

## Replay modes

- `tick`  
  Uses `session_ticks` ordered by `ts_ms`.
- `candle`  
  Uses `session_candles` for one timeframe (`1m` or `5m`).
- `mixed`  
  Uses a unified timeline of ticks + candle-close events, preserving both granular and aggregate context.

## Scanner integration (per-asset candle features)

Scanner output is stored as per-asset candle-attached features in `session_candle_features`:

- one row per `(session_id, symbol, timeframe, bucket_start_ms, feature_set, feature_version)`
- payload is JSON (`payload_json`) and is attached to candle events during `/api/backtest/run`
- strategies can read it from `event.candle.features[featureSet]`

Primary scanner vars:

- `anchorTsMs`, `lookbackHours`, `currentWindowHours`, `btcSymbol`, `featureSet`, `featureVersion`

Primary outputs per asset:

- `rvol`, `currentWindowVolumeUsd`, `baselineVolumeUsd`, `btcCorr`, `price`

See full variable definitions and anti-lookahead rule in `docs/data-and-simulator.md` (Part 3).

## CLI usage

From `backtester/`:

- `npm run import -- <sessionId>`  
  Import one session from source SQLite into backtester SQLite.
- `npm run list`  
  List imported sessions from backtester SQLite.
- `npm run run -- --session <sessionId> --symbol <SYMBOL> [--timeframe 1m|5m] [--mode tick|candle|mixed] [--strategy noop|simple-momentum]`
- `npm run import:scanner -- <sessionId> <payloadJsonPath> [toolName] [sourceId]`
- `npm run run:scanner -- --session-id <sessionId> [--timeframe 1m|5m] [--anchor-ts-ms <ms>] [--lookback-hours <n>] [--current-window-hours <n>] [--btc-symbol BTC] [--feature-set rvol-scanner] [--feature-version v1]`

## HTTP API (served by backend)

When `backend/server.js` is running:

- `GET /api/backtest/sessions/all`
- `GET /api/backtest/sessions/:id/symbols`
- `GET /api/backtest/sessions/:id?symbol=BTC&timeframe=all|1m|5m`
- `GET /api/backtest/sessions/:id/trades`
- `GET /api/backtest/sessions/:id/scanner-metadata`
- `POST /api/backtest/scanner-metadata`
- `POST /api/backtest/scanner/run`
- `GET /api/backtest/sessions/:id/scanner/features`
- `POST /api/backtest/run`

## Dev workflow

1. Start standalone backtester API in `backtester`:
   - `npm install`
   - `npm run server` (default port `3001`)
2. Import sessions via UI Import panel or CLI (`npm run import -- <sessionId>`).
3. Start standalone UI in `backtester-ui` (`npm run dev`, port `5174`).
4. Open the UI and run backtests/replay.

Main frontend commonly runs on `5173`; backtester UI defaults to `5174`; backtester API defaults to `3001`.

## Relationship to main app DB

- Main app: `backend/data/sessions.sqlite`
- Backtester: `backtester/data/backtest.sqlite`

Backtester reads/writes only its own DB at runtime. The import step is the bridge.
