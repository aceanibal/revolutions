# RSI 4h Entry Project (5 Assets, 5m Data Since 2022)

## Scope

This folder packages the working files for the strategy variant using:

- Assets: `BTCUSDT`, `ETHUSDT`, `XRPUSDT`, `SOLUSDT`, `LINKUSDT`
- Data timeframe for replay: `5m`
- Start date: `2022-01-01 UTC`
- Entry logic: `4h RSI cross`
- Exit logic: `5m MFE-lock ladder`

## Where the data lives

Raw historical candles are read from the shared SQLite DB in the main repo:

- Relative path from this folder: `../backtester/data/backtest.sqlite`
- Absolute path on this machine: `/Users/anibalperez/revolutions/backtester/data/backtest.sqlite`

The scripts in this folder load 5m candles from that DB, then resample to 4h for RSI entry logic.

## Project structure

- `scripts/`
  - Runnable entry points (what you execute from CLI).
- `simulation/`
  - Core simulation logic and DB loader modules.
- `cache/`
  - Generated CSV outputs for this project snapshot.

## Core runnable scripts (`scripts/`)

- `scripts/massive_chunk_backtest_5m.py`
  - Main runner for chunked backtests.
  - Runs asset-by-asset, then buckets closed trades into monthly/quarterly chunks.
  - Produces preflight coverage and result CSVs.
  - Uses 4h RSI entries and 5m replay for exits.

- `scripts/tune_rsi_entry_by_year_asset.py`
  - RSI tuning utility (year x asset grid).
  - Sweeps RSI entry thresholds while keeping exit model fixed.
  - Useful for finding regime drift in entry thresholds over time.

## Core simulation logic modules (`simulation/`)

- `simulation/multi_asset_4h_rsi_sim.py`
  - DB read layer (`backtester/data/backtest.sqlite`) for 5m candles.
  - 4h RSI entry-generation helpers (`run_simulation_trades`).

- `simulation/ltf_trade_management_study.py`
  - 5m replay functions for managed exits (MFE/lock ladder, stop update behavior).

- `SIMULATION_LOGIC.md`
  - Detailed flow chart of what logic runs where (entry vs replay vs aggregation).

## Reports in this folder

- `FINAL_YEARLY_ETH_NO_DOGE.md`
  - Year-by-year summary for the ETH-in / DOGE-out run.
  - Includes win rate, total R, and drawdown by year and by asset-year.

- `FINAL_RSI_ONLY_SWEEP_FREQ_ETH_NO_DOGE.md`
  - RSI-only sweep report for the 5-asset set.
  - Compares trade frequency and performance impact across RSI combos.

- `FINAL_COMPACT_RSI_MFE_MAE_SWEEP.md`
  - Compact parameter sweep report combining RSI + MFE/lock + SL_N proxy.
  - Used to identify practical, low-grid candidate settings.

## `cache/` file guide

- `massive_chunk_preflight_eth_no_doge.csv`
  - Per-asset 5m data coverage validation (min/max timestamp, candle counts).

- `massive_chunk_results_eth_no_doge.csv`
  - Per-asset, per-chunk output rows (trades, R, win%, DD, hold metrics, baseline delta).

- `massive_chunk_results_by_asset_eth_no_doge.csv`
  - Aggregated totals by asset for the same run.

- `yearly_metrics_pooled_eth_no_doge.csv`
  - Pooled year-level metrics across all 5 assets.

- `yearly_metrics_by_asset_eth_no_doge.csv`
  - Asset-year metrics (win%, total R, max DD, trade count).

- `rsi_only_sweep_eth_no_doge.csv`
  - RSI-only sweep result table used by the frequency report.

- `eth_no_doge_overlap_summary.csv`
  - Drawdown overlap counts (how often multiple assets are negative together).

- `eth_no_doge_risk_sizing_dd.csv`
  - Max drawdown estimates under fixed risk-per-trade levels.

- `eth_no_doge_worst_day_stress.csv`
  - Worst same-day negative-R stress converted to account-hit percentages by risk level.

- `eth_no_doge_top_overlap_days.csv`
  - Dates with the largest multi-asset simultaneous downside.

## Environment

- Dedicated virtual environment: `.venv/`
- Activate:
  - macOS/Linux: `source .venv/bin/activate`
- Install deps (already installed in this env): `pip install -r requirements.txt`

### Typical run commands

- Chunk run:
  - `python scripts/massive_chunk_backtest_5m.py --help`
- RSI tuning run:
  - `python scripts/tune_rsi_entry_by_year_asset.py --help`

## Notes

- This folder is a packaged snapshot of relevant scripts + outputs.
- You can rerun simulations from here, but outputs still depend on data in the shared DB path above.
