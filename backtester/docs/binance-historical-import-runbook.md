# Binance Historical Import Runbook

This runbook documents the exact process to import Binance kline data into the backtester as a `historical` session.

It is based on the first successful import:
- Symbol: `XRPUSDT`
- Timeframe: `5m`
- Range: `2025-01-01` to `2026-03-01`

---

## Prerequisites

- Repo checked out locally.
- Node dependencies installed in `backtester` (`npm install`).
- Python 3 available.
- Backtester import scripts available:
  - `scripts/importHistorical.js`
  - `scripts/convertBinanceKlinesToNdjson.py`

---

## 1) Prepare Binance downloader

Clone Binance public data tools once:

```bash
cd backtester
mkdir -p tools
git clone https://github.com/binance/binance-public-data.git tools/binance-public-data
```

Create Python venv and install dependencies:

```bash
cd backtester
python3 -m venv tools/binance-public-data/.venv
tools/binance-public-data/.venv/bin/python -m pip install -r tools/binance-public-data/python/requirements.txt
```

---

## 2) Download source zip files from Binance

### Why two commands for this date range?

At the time of writing, the Binance script's built-in monthly years list stops at `2025`.  
For `2026-01` to `2026-03`, download daily files.

### Download monthly (`2025`)

```bash
cd backtester
STORE_DIRECTORY="$(pwd)/data/historical/binance" \
tools/binance-public-data/.venv/bin/python tools/binance-public-data/python/download-kline.py \
  -t um \
  -s XRPUSDT \
  -i 5m \
  -startDate 2025-01-01 \
  -endDate 2026-03-01 \
  -skip-daily 1
```

### Download daily (`2026-01-01` to `2026-03-01`)

```bash
cd backtester
STORE_DIRECTORY="$(pwd)/data/historical/binance" \
tools/binance-public-data/.venv/bin/python tools/binance-public-data/python/download-kline.py \
  -t um \
  -s XRPUSDT \
  -i 5m \
  -startDate 2026-01-01 \
  -endDate 2026-03-01 \
  -skip-monthly 1
```

Expected folders:

- `data/historical/binance/data/futures/um/monthly/klines/XRPUSDT/5m/2025-01-01_2026-03-01`
- `data/historical/binance/data/futures/um/daily/klines/XRPUSDT/5m/2026-01-01_2026-03-01`

---

## 3) Convert Binance zip CSVs to backtester NDJSON

The converter:
- reads all `.zip` files from one or more input directories,
- parses CSV rows,
- maps to backtester candle schema,
- dedupes by `bucketStartMs`,
- validates 5-minute continuity,
- writes one NDJSON line per candle.

Command for XRP example:

```bash
cd backtester
python3 scripts/convertBinanceKlinesToNdjson.py \
  --symbol XRPUSDT \
  --timeframe 5m \
  --start-ms 1735689600000 \
  --end-ms 1772323200000 \
  --input-dir data/historical/binance/data/futures/um/monthly/klines/XRPUSDT/5m/2025-01-01_2026-03-01 \
  --input-dir data/historical/binance/data/futures/um/daily/klines/XRPUSDT/5m/2026-01-01_2026-03-01 \
  --output data/historical/ndjson/xrpusdt_5m_2025-01-01_2026-03-01.ndjson
```

You should see a JSON summary with:
- `dedupedRows`
- `continuityGapCount`
- `firstBucketStartMs` / `lastBucketStartMs`

---

## 4) Import NDJSON into a historical session

```bash
cd backtester
npm run import:historical -- \
  --file data/historical/ndjson/xrpusdt_5m_2025-01-01_2026-03-01.ndjson \
  --session-id hist-xrpusdt-5m-2025-01-2026-03 \
  --symbols XRPUSDT \
  --timeframe 5m \
  --type candles \
  --start-ms 1735689600000 \
  --end-ms 1772323200000
```

Expected output includes:
- `"ok": true`
- `"finalized": true`
- `"candleCount"` in summary

---

## 5) Verify import

Check API result:

```bash
curl -s "http://localhost:3001/api/backtest/sessions/all?sessionType=historical"
```

Confirm for your session:
- `sessionType = historical`
- `status = imported`
- `candleCount` matches converter `dedupedRows`
- `startedAtMs` / `endedAtMs` match the intended range

Optional DB spot-check:
- compare first and last candle from source zip vs NDJSON vs `session_candles`.

---

## Reuse Template For Future Imports

Replace only these values:
- `SYMBOL` (e.g. `ETHUSDT`, `SOLUSDT`)
- `TIMEFRAME` (`1m` or `5m`)
- date range and epoch boundaries
- `--session-id`
- input directories and output file names

General import flow stays the same:
1. Download Binance zip files.
2. Convert to NDJSON.
3. Import via `npm run import:historical`.
4. Verify session stats and boundaries.

To build a synthetic XRP/PAXG ratio session after both historical imports exist, run `npm run list:long-series -- --symbols XRPUSDT,PAXGUSDT --timeframe 5m --min-days 365`, then `npm run build:xrp-paxg-ratio -- --xrp-session <xrpSessionId> --paxg-session <paxgSessionId> --timeframe 5m`.

---

## Symbol Mapping (Binance -> Hyperliquid)

Binance candles are pair symbols:
- `ETHUSDT`, `XRPUSDT`, `DOGEUSDT`

Hyperliquid execution typically uses base assets:
- `ETH`, `XRP`, `DOGE`

Keep Binance pair symbols in historical data, but map to base asset in execution order routing.
