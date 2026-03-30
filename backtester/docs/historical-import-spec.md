# Historical Session Import Specification

This document defines how an external process can import large historical datasets into the backtester as `historical` sessions.

## Goals

- Import sessions that are distinct from live sessions.
- Support candle datasets (`1m`, `5m`) and tick datasets.
- Scale to large payloads using chunked API calls or streaming CLI import.

## Session Type

- Historical sessions are stored in `sessions.session_type = 'historical'`.
- Live sessions continue to use `sessions.session_type = 'live'`.
- UI can filter between `all`, `live`, and `historical`.

## Data Model

### Session row (`sessions`)

Required fields at creation:
- `id` (string): unique session id
- `market_window_start` / `market_window_end` (epoch ms)
- `session_type` = `historical`

System-managed fields:
- `status`: starts as `importing`, becomes `imported` after finalize
- `asset_count`, `tick_count`, `candle_count`: computed on finalize

### Candle row (`session_candles`)

Primary key:
- `(session_id, symbol, timeframe, bucket_start_ms)`

Fields:
- `symbol` (string, uppercase)
- `timeframe` (`1m` or `5m`)
- `bucket_start_ms` (number)
- `open`, `high`, `low`, `close` (number)
- `volume` (number, default `0`)
- `source` = `history`
- `is_gap_fill` = `0`

### Tick row (`session_ticks`)

Primary key:
- `(session_id, symbol, ts_ms, source)`

Fields:
- `symbol` (string, uppercase)
- `ts_ms` (number)
- `price` (number)
- `size` (number, default `0`)
- `source` = `history`

## HTTP Import API

Base URL defaults to `http://localhost:3001`.

## 1) Create historical session

`POST /api/backtest/import/historical-session`

Request body:

```json
{
  "id": "hist-2025-03-15-btc",
  "symbols": ["BTCUSDT", "ETHUSDT"],
  "timeframe": "1m",
  "startMs": 1741991400000,
  "endMs": 1742014800000,
  "metadata": {
    "source": "vendor-x",
    "datasetVersion": "2026-03-29"
  }
}
```

Response:

```json
{
  "ok": true,
  "result": {
    "sessionId": "hist-2025-03-15-btc",
    "sessionType": "historical"
  }
}
```

## 2) Import candles (chunked)

`POST /api/backtest/import/historical-session/:id/candles`

Request body:

```json
{
  "timeframe": "1m",
  "chunkSize": 1000,
  "candles": [
    {
      "symbol": "BTCUSDT",
      "bucketStartMs": 1741991400000,
      "open": 64000.25,
      "high": 64010.0,
      "low": 63990.5,
      "close": 64002.75,
      "volume": 120.12
    }
  ]
}
```

Notes:
- `rows` can be used instead of `candles`.
- If candle `timeframe` is absent per row, request-level `timeframe` is used.
- Inserts are `INSERT OR REPLACE`; reposting the same primary-key candle overwrites it.

## 3) Import ticks (chunked)

`POST /api/backtest/import/historical-session/:id/ticks`

Request body:

```json
{
  "chunkSize": 1000,
  "ticks": [
    {
      "symbol": "BTCUSDT",
      "tsMs": 1741991400123,
      "price": 64001.25,
      "size": 0.2
    }
  ]
}
```

Notes:
- `rows` can be used instead of `ticks`.
- Inserts are `INSERT OR REPLACE`; reposting the same `(session_id, symbol, ts_ms, source)` overwrites it.

## 4) Finalize session

`POST /api/backtest/import/historical-session/:id/finalize`

Optional body:

```json
{
  "startMs": 1741991400000,
  "endMs": 1742014800000
}
```

Finalization computes:
- `asset_count` from distinct symbols across ticks and candles
- `tick_count`
- `candle_count`
- marks session `status = imported`

## 5) Delete historical session

`DELETE /api/backtest/import/historical-session/:id`

Deletes the session and all related rows from:
- `session_ticks`
- `session_candles`
- `session_notes`
- `session_trades`
- `session_trade_state`
- `session_external_metadata`
- `sessions`

## Session listing filter

`GET /api/backtest/sessions/all?sessionType=historical`

Supported values:
- `historical`
- `live`

If omitted, both are returned.

## NDJSON Format (for CLI and preprocessors)

NDJSON is one JSON object per line.

### Candle NDJSON (`1m` or `5m`)

```json
{"symbol":"BTCUSDT","timeframe":"1m","bucketStartMs":1741991400000,"open":64000.25,"high":64010,"low":63990.5,"close":64002.75,"volume":120.12}
{"symbol":"BTCUSDT","timeframe":"1m","bucketStartMs":1741991460000,"open":64002.75,"high":64006,"low":63998,"close":64001.25,"volume":98.42}
```

### Tick NDJSON

```json
{"symbol":"BTCUSDT","tsMs":1741991400123,"price":64001.25,"size":0.2}
{"symbol":"BTCUSDT","tsMs":1741991400456,"price":64001.5,"size":0.05}
```

## CLI Import

Script:
- `node scripts/importHistorical.js`
- npm alias: `npm run import:historical -- ...`

Example (candles):

```bash
npm run import:historical -- \
  --file ./data/btc_1m.ndjson \
  --session-id hist-2025-03-15-btc \
  --symbols BTCUSDT,ETHUSDT \
  --timeframe 1m \
  --type candles
```

Example (ticks):

```bash
npm run import:historical -- \
  --file ./data/btc_ticks.ndjson \
  --session-id hist-2025-03-15-btc \
  --symbols BTCUSDT \
  --type ticks
```

Optional flags:
- `--chunk-size <N>` (default `1000`) DB transaction chunking
- `--flush-size <N>` (default `5000`) in-memory line buffer
- `--start-ms <epochMs>` session window start
- `--end-ms <epochMs>` session window end
- `--no-finalize` skip finalize if importing in multiple phases

## Large Dataset Guidance

For multi-million-row imports:

- Prefer NDJSON streaming via CLI when data is on the same machine.
- For HTTP ingestion, post in chunks of `10k` to `50k` records per call.
- Keep server payloads under JSON body limits; split oversized chunks.
- Use bounded concurrency (1-4 parallel requests) to avoid SQLite write contention.
- Finalize only after all chunks are acknowledged.

Recommended process:

1. Create session.
2. Import all candle/tick chunks.
3. Retry failed chunks.
4. Finalize.
5. Verify via `GET /api/backtest/sessions/all?sessionType=historical`.

## Retry and Idempotency

- Candle/tick chunk endpoints are idempotent by primary key (`INSERT OR REPLACE`).
- Safe retry strategy: resend full failed chunk.
- Session creation is **not** idempotent by default (duplicate `id` fails). Reuse existing session id only if you intend to continue importing into it.

## Validation Rules

- `symbol`: required, non-empty string, normalized to uppercase.
- Candle `timeframe`: must be `1m` or `5m`.
- Timestamps (`bucketStartMs`, `tsMs`): epoch milliseconds.
- Prices and OHLC must be numeric.
- Volume/size defaults to `0` if omitted.

## Operational Notes

- SQLite runs in WAL mode; chunked writes reduce lock duration and memory spikes.
- If imports are interrupted, you can resume by posting remaining chunks, then finalize.
- Historical session metadata can be attached during session creation in `metadata`.

## Binance Bulk Import Runbook

Use Binance's official downloader repo for bulk kline acquisition:
- Repository: `https://github.com/binance/binance-public-data`
- Script: `python/download-kline.py`

### 1) Download Binance klines

The downloader's year list currently ends at `2025`, so for the `2025-01` through `2026-03` window use:
- monthly download for `2025`
- daily download for `2026-01-01` through `2026-03-01`

Example:

```bash
python3 -m venv tools/binance-public-data/.venv
tools/binance-public-data/.venv/bin/python -m pip install -r tools/binance-public-data/python/requirements.txt

STORE_DIRECTORY=/absolute/path/to/backtester/data/historical/binance \
tools/binance-public-data/.venv/bin/python tools/binance-public-data/python/download-kline.py \
  -t um -s XRPUSDT -i 5m -startDate 2025-01-01 -endDate 2026-03-01 -skip-daily 1

STORE_DIRECTORY=/absolute/path/to/backtester/data/historical/binance \
tools/binance-public-data/.venv/bin/python tools/binance-public-data/python/download-kline.py \
  -t um -s XRPUSDT -i 5m -startDate 2026-01-01 -endDate 2026-03-01 -skip-monthly 1
```

### 2) Convert downloaded zip CSVs to backtester NDJSON

Use `scripts/convertBinanceKlinesToNdjson.py` to:
- read all zip files,
- map to candle NDJSON schema,
- dedupe by `bucketStartMs`,
- validate 5-minute continuity,
- output a single NDJSON file.

Example:

```bash
python3 scripts/convertBinanceKlinesToNdjson.py \
  --symbol XRPUSDT \
  --timeframe 5m \
  --start-ms 1735689600000 \
  --end-ms 1772323200000 \
  --input-dir data/historical/binance/data/futures/um/monthly/klines/XRPUSDT/5m/2025-01-01_2026-03-01 \
  --input-dir data/historical/binance/data/futures/um/daily/klines/XRPUSDT/5m/2026-01-01_2026-03-01 \
  --output data/historical/ndjson/xrpusdt_5m_2025-01-01_2026-03-01.ndjson
```

### 3) Import NDJSON into a historical session

```bash
npm run import:historical -- \
  --file data/historical/ndjson/xrpusdt_5m_2025-01-01_2026-03-01.ndjson \
  --session-id hist-xrpusdt-5m-2025-01-2026-03 \
  --symbols XRPUSDT \
  --timeframe 5m \
  --type candles \
  --start-ms 1735689600000 \
  --end-ms 1772323200000
```

### 4) Verify

- `GET /api/backtest/sessions/all?sessionType=historical` contains the imported session.
- `candleCount` matches converter output row count.
- first/last candle timestamps match the requested window.

### Symbol mapping note (Binance vs Hyperliquid)

- Binance historical symbols are pair-formatted (`XRPUSDT`, `ETHUSDT`, etc.).
- Hyperliquid execution symbols are base assets (`XRP`, `ETH`, etc.).
- Keep data symbol (`XRPUSDT`) for historical candles, but map to execution symbol (`XRP`) when placing live/simulated orders against Hyperliquid.
