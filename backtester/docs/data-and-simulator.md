# Backtester: Data Storage & Simulator Pipeline

## Part 1 — Data Storage (`backtester/data/`)

### Physical Layout

The `backtester/data/` directory is a **flat folder** with no nested subdirectories. There are no CSV, Parquet, or JSON data dumps — everything lives in a single SQLite 3 database.

```
backtester/data/
├── backtest.sqlite          # Primary data store (~185 MB)
├── backtest.sqlite-wal      # SQLite write-ahead log
├── backtest.sqlite-shm      # SQLite shared memory
├── schema.js                # DDL (table definitions)
├── repository.js            # BacktestRepository class (all queries)
├── index.js                 # Factory functions + default paths
├── math.js                  # Symbol normalization, gap detection, timeframe math
└── .gitkeep
```

The DB path defaults to `backtester/data/backtest.sqlite` and can be overridden via the `BACKTEST_SQLITE_PATH` environment variable. The DB is opened with `PRAGMA journal_mode=WAL` and `PRAGMA synchronous=NORMAL` for concurrent-read performance.

### Database Schema

Seven tables, all partitioned logically by `session_id`:

#### `sessions` — Session Metadata

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Format: `YYYY-MM-DD_HHMM-<random>` (e.g. `2026-03-26_0800-io9kfv`) |
| `market_window_start` | INTEGER | Market session open (ms epoch) |
| `market_window_end` | INTEGER | Market session close (ms epoch) |
| `started_at_ms` | INTEGER | When the recording started |
| `ended_at_ms` | INTEGER | When the recording ended (nullable if still running) |
| `status` | TEXT | `closed`, `running`, etc. |
| `break_reason` | TEXT | Why the session ended (nullable) |
| `asset_count` | INTEGER | Number of symbols tracked |
| `tick_count` | INTEGER | Total ticks recorded |
| `candle_count` | INTEGER | Total candles recorded |
| `active_streams_json` | TEXT | JSON blob of active data streams |

#### `session_candles` — OHLCV Bars

Primary key: `(session_id, symbol, timeframe, bucket_start_ms)`

| Column | Type | Description |
|--------|------|-------------|
| `symbol` | TEXT | Uppercase ticker (`BTC`, `SOL`, `FARTCOIN`) |
| `timeframe` | TEXT | `1m` or `5m` |
| `bucket_start_ms` | INTEGER | Bar open time (ms epoch) |
| `open` | REAL | Open price |
| `high` | REAL | High price |
| `low` | REAL | Low price |
| `close` | REAL | Close price |
| `volume` | REAL | Volume for the bar |
| `source` | TEXT | `live` or `history` |
| `is_gap_fill` | INTEGER | `1` if this candle was synthesized to fill a gap |

#### `session_ticks` — Raw Trade Prints

Primary key: `(session_id, symbol, ts_ms, source)`

| Column | Type | Description |
|--------|------|-------------|
| `symbol` | TEXT | Uppercase ticker |
| `ts_ms` | INTEGER | Tick timestamp (ms epoch) |
| `price` | REAL | Trade price |
| `size` | REAL | Trade size |
| `source` | TEXT | `live` (from exchange websocket) |

#### `session_trades` — Exchange Fills (Imported)

These are **actual fills from the live trading app**, not simulator output.

| Column | Type | Description |
|--------|------|-------------|
| `mode` | TEXT | `live` |
| `coin` | TEXT | Symbol |
| `side` | TEXT | `B` (buy) or `A` (sell/ask) |
| `dir` | TEXT | Direction hint |
| `px` | REAL | Fill price |
| `sz` | REAL | Fill size |
| `time_ms` | INTEGER | Fill timestamp |
| `fee` | REAL | Trading fee |
| `closed_pnl` | REAL | Realized P&L from this fill |
| `oid` / `tid` | TEXT | Order and trade IDs from the exchange |

#### `session_trade_state` — Position Snapshots

Primary key: `(session_id, mode, symbol)`

Tracks the final state of each position: `status` (`FLAT`, etc.), `size`, `entry_px`, `stop_loss`, and JSON blobs for pending orders and execution metadata.

#### `session_notes` / `session_external_metadata`

User annotations and scanner/tool JSON payloads. Low-volume, context-only tables.

### How Data Gets Into the Backtest DB

Data originates in the **live app's database** at `backend/data/sessions.sqlite`. The import pipeline (`backtester/import/sessionImporter.js`) copies a session's worth of rows:

```
backend/data/sessions.sqlite  ──importSession()──>  backtester/data/backtest.sqlite
        (source)                                           (destination)
```

The `importSession()` function:
1. Opens the source DB (live app) and the destination DB (backtester)
2. Deletes any existing rows for that `session_id` in the destination
3. Copies all rows from all seven tables in a single SQLite transaction
4. Returns counts of imported ticks, candles, trades, and trade states

Invoked via `npm run import` (CLI script at `scripts/importSession.js`) or programmatically.

### Naming Conventions

- **Session IDs**: `YYYY-MM-DD_HHMM-<short-random>` — used as foreign key everywhere
- **Symbols**: Uppercase strings normalized by `normalizeSymbol()` in `math.js`
- **Timeframes**: `1m` or `5m` only
- **No per-file partitioning**: All data for all sessions/symbols is inside the single SQLite file, indexed by composite keys

---

## Part 2 — How the Simulator Consumes This Data

### High-Level Pipeline

```
┌──────────────────────────────────────────────────────────────────┐
│  Entry Point (CLI or HTTP)                                       │
│  sessionId, symbol, timeframe, mode, strategyId, params          │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  BacktestRepository                                              │
│  getCandles(sessionId, symbol, timeframe) → candle[]             │
│  getTicks(sessionId, symbol) → tick[]                            │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  buildEvents({ mode, candles, ticks, timeframe, params })        │
│  Produces a unified, time-sorted event stream                    │
│  Each event: { kind, origin, ts, tick|candle }                   │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  runBacktest() — Synchronous simulation loop                     │
│  for (const event of events):                                    │
│    strategy.onEvent({ event, state }) → action or null           │
│    process enter/exit actions → update position, equity, trades  │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  createRunResult()                                               │
│  Packages: meta, equity curve, trade list, metrics               │
│  Optionally persisted to data/runs/ as JSON                      │
└──────────────────────────────────────────────────────────────────┘
```

### Step 1: Entry Points

There are two ways to invoke the simulator:

**CLI** (`runner/cli.js`):
```bash
node runner/cli.js --session 2026-03-26_0800-io9kfv --symbol BTC --timeframe 1m --mode mixed --strategy orb-avwap-930
```

**HTTP** (`server.js`):
```
POST /api/backtest/run
Body: { sessionId, symbol, mode, timeframe, strategyId, params }
```

Both do the same thing: create a repository, load candles and ticks, call `runBacktest()`.

### Step 2: Data Loading via BacktestRepository

The repository opens the SQLite DB and runs two queries:

**Candles** — `getCandles(sessionId, symbol, timeframe)`:
- Queries `session_candles` filtered by session, symbol, and timeframe
- Orders by `bucket_start_ms ASC`
- Maps to: `{ timeMs, open, high, low, close, volume, source, isGapFill }`

**Ticks** — `getTicks(sessionId, symbol)`:
- Queries `session_ticks` filtered by session and symbol
- Orders by `ts_ms ASC`
- Maps to: `{ symbol, ts, price, size, source }`

Both datasets are loaded **entirely into memory** as arrays before simulation begins. There is no streaming or pagination.

### Step 3: Event Construction (`buildEvents`)

The raw candles and ticks are transformed into a unified event stream. The `mode` parameter controls which data sources are used:

#### Candle Mode (`mode: "candle"`)

Only candle data is used. Each candle becomes one event:
```
{ kind: "candle", origin: "candle_close", ts: candle.timeMs, candle }
```

#### Tick Mode (`mode: "tick"`)

Only tick data is used. The `tickPolicy` parameter controls which ticks:

| tickPolicy | Behavior |
|---|---|
| `real_then_synthetic` (default) | Use real ticks if available, otherwise synthesize from candles |
| `real_only` | Only real exchange ticks |
| `synthetic_only` | Only ticks generated from candles |

Each tick becomes:
```
{ kind: "tick", origin: "real_tick"|"synthetic_tick", ts: tick.ts, tick }
```

#### Mixed Mode (`mode: "mixed"`)

Tick events **and** candle-close events are merged and sorted by timestamp. The candle event timestamp is set to `bucket_start_ms + interval - 1` so that candle-close events sort **after** all intra-bar ticks for the same bar. This ensures the strategy sees tick-by-tick movement before the bar officially closes.

#### Synthetic Tick Generation

When real ticks are unavailable, `synthesizeTicksFromCandles()` creates deterministic fake ticks from each candle:

1. For **bullish bars** (close >= open): path is Open → Low → High → Close
2. For **bearish bars** (close < open): path is Open → High → Low → Close
3. Prices are linearly interpolated between these anchors
4. Timestamps are evenly spaced within the candle interval
5. Volume is distributed equally across ticks
6. Controlled by `syntheticTicksPerCandle` (default 4, clamped to 4–20)

### Step 4: The Simulation Loop (`runBacktest`)

The core loop is **synchronous** — a simple `for...of` over the event array. No async, no event bus, no multithreading.

Before the loop begins, the engine can also filter the event stream by ET market day using run params:
- `ignoreWeekends`: drops Saturday/Sunday events
- `ignoreUsHolidays`: drops NYSE full holidays and configured early-close days

For each event:

1. **Extract price**: tick → `tick.price`, candle → `candle.close`
2. **Compute wall time**: `chartAlignedTimeMs(event)` — uses `candle.timeMs` (bucket start) for candle events, `event.ts` for ticks
3. **Call strategy**: `strategy.onEvent({ event, state })` where state includes current position, realized P&L, last price, equity curve, symbol, timeframe, and mode
4. **Process action** (if strategy returns one):
   - `{ type: "enter" }` — opens a position if currently flat (side, price, size, stop loss, take profit)
   - `{ type: "exit" }` — closes the position if one is open, calculates P&L
   - Actions are **ignored** if state guards fail (e.g., trying to enter while already in a position)
5. **Push equity point**: realized P&L + unrealized P&L at current mark price

**Force-close at end**: if a position is still open when the event stream ends, it is closed at the last seen price.

**P&L calculation**:
- Long: `(exitPx - entryPx) * size`
- Short: `(entryPx - exitPx) * size`

### Step 5: Results & Metrics

`createRunResult()` packages the output:

```js
{
  version: 1,
  createdAtMs: <timestamp>,
  meta: {
    sessionId, symbol, timeframe, mode, strategyId, params,
    eventCount,
    eventStats: { realTickEvents, syntheticTickEvents, candleEvents }
  },
  equity: [{ ts, value }, ...],           // equity curve over time
  trades: [{                              // closed trade records
    openedAtMs, closedAtMs, side, size,
    entryPx, exitPx, pnl, stopLoss, takeProfit
  }, ...],
  metrics: {
    tradeCount, winRate, winners, losers,
    realizedPnL, maxDrawdown
  }
}
```

Results can be persisted to `data/runs/` as JSON files via `persistRun()`.

### Available Strategies

| ID | Description |
|---|---|
| `noop` | Does nothing — useful for verifying the data pipeline produces events without trading |
| `simple-momentum` | Reference strategy: enters long on green bars, exits on red bars (body > threshold bps) |
| `orb-avwap-930` | Opening Range Breakout + Anchored VWAP from 9:30 ET. Enters on AVWAP cross after 10:00 ET, uses candle high/low for stop loss, R:R ratio for take profit |

Strategies implement `onEvent({ event, state })` and return `null` (no action) or `{ type: "enter"|"exit", side, price, size, stopLoss?, takeProfit? }`.

### Configuration Reference

| Parameter | Source | Description |
|---|---|---|
| `BACKTEST_SQLITE_PATH` | env | Override backtest DB location |
| `SOURCE_SQLITE_PATH` | env | Override live app DB location for imports |
| `BACKTESTER_SIM_DEBUG` | env | Enable verbose simulation logging |
| `BACKTESTER_STRATEGY_DEBUG` | env | Enable strategy-level debug logging |
| `sessionId` | CLI/HTTP | Which session to replay |
| `symbol` | CLI/HTTP | Which asset to simulate (`BTC`, `SOL`, etc.) |
| `timeframe` | CLI/HTTP | `1m` or `5m` |
| `mode` | CLI/HTTP | `candle`, `tick`, or `mixed` |
| `strategyId` | CLI/HTTP | `noop`, `simple-momentum`, or `orb-avwap-930` |
| `tickPolicy` | params | `real_then_synthetic`, `real_only`, `synthetic_only` |
| `syntheticTicksPerCandle` | params | 4–20, default 4 |
| `ignoreWeekends` | params | Skip weekend events before strategy execution |
| `ignoreUsHolidays` | params | Skip NYSE holidays and early-close days before strategy execution |

### Key Design Decisions

1. **SQLite over files**: All data in one DB avoids filesystem fragmentation. Session-scoped composite keys partition data logically without separate files per symbol/date.
2. **In-memory loading**: Entire candle and tick arrays are loaded before simulation. This keeps the sim loop simple and fast (no I/O mid-loop) at the cost of memory for very large sessions.
3. **Synchronous loop**: No event bus or async machinery. The `for...of` loop over a pre-built array is deterministic and easy to debug.
4. **Synthetic tick fallback**: When real ticks are missing, the OHLC path model (O→L→H→C for bullish, O→H→L→C for bearish) gives strategies intra-bar granularity without requiring exchange-level tick data.
5. **Import-based isolation**: The backtester DB is a copy of the live app DB, not the same file. This prevents backtest queries from contending with live writes.

---

## Part 3 — Scanner Features (Per-Asset, Candle-Attached)

The scanner implementation in this backtester is now **per-asset** and **candle-attached**.

Flow:

1. Run scanner at an anchor timestamp (`anchorTsMs`) for a historical session.
2. Compute per-asset metrics from `session_candles` only (offline/deterministic).
3. Persist one feature row per asset into `session_candle_features` at the anchor candle.
4. During `/api/backtest/run`, attach matching feature payload to candle objects so strategies can read `event.candle.features[featureSet]`.

### Why this structure

- Indicator-like consumption (same model as candles).
- No symbol ranking requirement; every asset gets its own row.
- Deterministic replay without external API dependencies.
- Easy inspection in UI via scanner features endpoint.

### Storage Model

Table: `session_candle_features`

- `session_id`
- `symbol`
- `timeframe`
- `bucket_start_ms`
- `feature_set` (example: `rvol-scanner`)
- `feature_version` (example: `v1`)
- `payload_json`
- `created_at_ms`

Primary key:
- `(session_id, symbol, timeframe, bucket_start_ms, feature_set, feature_version)`

### Scanner Input Variables

These are the scanner variables you configure:

- `sessionId` — target historical session
- `timeframe` — `1m` or `5m`
- `anchorTsMs` — anchor candle timestamp (ms epoch)
- `lookbackHours` — historical horizon used to build baseline
- `currentWindowHours` — recent window used for current notional volume
- `btcSymbol` — BTC reference symbol for correlation (for example `BTC` or `BTCUSDT`)
- `featureSet` — feature namespace written to candles
- `featureVersion` — feature schema/version tag

### Scanner Output Variables (Per Asset)

Each persisted `payload_json` contains:

- `symbol`
- `timeframe`
- `anchorTsMs`
- `lookbackHours`
- `currentWindowHours`
- `currentWindowBars`
- `lookbackBars`
- `rvol`
- `currentWindowVolumeUsd`
- `baselineVolumeUsd`
- `btcCorr`
- `btcSymbol`
- `price`
- `sourceCandleCount`

`btcCorr` is informational per asset (no ranking/selection required).

### API / CLI

Run scanner and persist features:

- HTTP: `POST /api/backtest/scanner/run`
- CLI: `npm run run:scanner -- --session-id <id> [--timeframe 1m|5m] [--anchor-ts-ms <ms>] [--lookback-hours <n>] [--current-window-hours <n>] [--btc-symbol BTC] [--feature-set rvol-scanner] [--feature-version v1]`

Read stored feature rows:

- `GET /api/backtest/sessions/:id/scanner/features?symbol=BTC&timeframe=1m&featureSet=rvol-scanner&featureVersion=v1&anchorTsMs=<ms>`

### Anti-Lookahead Rule

For anchor `T`, scanner uses only candles with `timeMs <= T`.  
During simulation, strategies should only use feature rows that match the event/candle timestamp context (the default run path attaches anchor-matching rows to candle events).
