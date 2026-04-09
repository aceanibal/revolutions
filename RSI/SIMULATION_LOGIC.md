# Simulation Logic Map

## Where logic runs

- **Entry-point scripts run from:** `RSI/scripts/`
- **Core simulation modules run from:** `RSI/simulation/`
- **Output files are written to:** `RSI/cache/` (plus selected report `.md` files in `RSI/`)

The scripts prepend `RSI/simulation/` to `sys.path`, then import simulation modules directly.

## Data source

- SQLite candle DB: `../backtester/data/backtest.sqlite` (from `RSI/` root)
- 5m candles are loaded from `session_candles`.

## Entry logic (4h RSI)

Implemented in:
- `simulation/multi_asset_4h_rsi_sim.py`

How it works:
1. Load/merge 5m candles by symbol/session.
2. Resample 5m -> 4h OHLCV.
3. Compute RSI on 4h closes.
4. Generate entry list via `run_simulation_trades` (RSI cross + structural stop logic).

This is the "signal layer" only.

## Exit / trade management logic (5m replay)

Implemented in:
- `simulation/ltf_trade_management_study.py`

Primary functions:
- `replay_trade_5m` (baseline fixed SL/TP replay)
- `replay_trade_mfe_ladder_5m` (managed MFE/lock ladder replay)

Behavior:
- Replays each entry on 5m path.
- Supports staged MFE locks.
- Uses realistic deferred stop update behavior.
- Optionally caps lock by proven MFE.

This is the "execution/replay layer".

## Orchestration scripts

### `scripts/massive_chunk_backtest_5m.py`

Purpose:
- End-to-end run for one parameter set.
- Asset-by-asset simulation + monthly/quarterly chunk aggregation.

Flow:
1. Preflight data coverage by asset.
2. Build 4h RSI entries from 5m.
3. Replay exits on 5m (baseline + managed).
4. Aggregate:
   - per chunk
   - per asset
   - pooled summaries
5. Save CSV/report outputs.

### `scripts/tune_rsi_entry_by_year_asset.py`

Purpose:
- Sweep RSI entry thresholds by asset/year while keeping exit model fixed.

Flow:
1. Iterate RSI grid.
2. For each combo, run entry generation + 5m managed replay.
3. Aggregate by year and asset.
4. Export grid/best/pattern CSVs + summary markdown.

## Aggregation and risk analysis

Post-run analytics in this project (already generated in `cache/`) are computed from the exported ledgers/CSVs:
- yearly totals
- overlap days
- risk-per-trade drawdown stress
- frequency comparisons across RSI sets

No raw DB rewrite occurs; all analysis is read-only on historical candle data.
