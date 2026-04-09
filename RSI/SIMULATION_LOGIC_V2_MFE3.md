# Simulation Logic V2 (MFE3/LOCK3 + TP Sweep)

## What changed from v1

V2 introduces:

- Third lock stage: `mfe3/lock3`
- TP sweep around 13R (default `12,13,14`)
- Isolated output naming so legacy files are never overwritten

Legacy files remain unchanged.

## Where code lives

- Runner entrypoint:
  - `scripts/massive_chunk_backtest_5m_v2_mfe3.py`
- RSI tuning entrypoint:
  - `scripts/tune_rsi_entry_by_year_asset_v2_mfe3.py`
- Core simulation modules (shared):
  - `simulation/multi_asset_4h_rsi_sim.py` (4h RSI entries + DB loading)
  - `simulation/ltf_trade_management_study.py` (5m replay + MFE ladder exits)

## Data source

- Candle DB: `../backtester/data/backtest.sqlite`

## V2 run flow

1. Load merged 5m candles per symbol from DB.
2. Build 4h candles + RSI for entry generation.
3. Generate entries using RSI cross logic (`run_simulation_trades`).
4. Replay each entry on 5m path:
   - baseline fixed SL/TP replay
   - managed replay with staged MFE locks:
     - stage1: `mfe1/lock1`
     - stage2: `mfe2/lock2`
     - stage3: `mfe3/lock3`
5. Sweep TP values around 13R (default 12/13/14).
6. For each TP level, write isolated chunk/by-asset CSVs and optional report files.

## New output naming

All V2 files are prefixed/suffixed with `v2_mfe3`.

Examples:

- `cache/massive_chunk_v2_mfe3_preflight.csv`
- `cache/massive_chunk_v2_mfe3_tp13p0_results.csv`
- `cache/massive_chunk_v2_mfe3_tp13p0_results_by_asset.csv`
- `cache/massive_chunk_v2_mfe3_tp_sweep_summary.csv`
- `cache/rsi_year_asset_grid_managed_v2_mfe3_tp13p0.csv`
- `FINAL_MASSIVE_CHUNK_BACKTEST_V2_MFE3_tp13p0.md`
- `FINAL_RSI_ENTRY_ADAPTIVE_PATTERN_V2_MFE3_tp13p0.md`

## Typical commands

- Runner (TP sweep):
  - `python scripts/massive_chunk_backtest_5m_v2_mfe3.py --tp-sweep 12,13,14 --mfe1 1.0 --lock1 0.8 --mfe2 6.5 --lock2 5.5 --mfe3 10.0 --lock3 9.0`

- Tuning (single TP for quick checks):
  - `python scripts/tune_rsi_entry_by_year_asset_v2_mfe3.py --tp-sweep 13 --rsi-l-grid 35 --rsi-h-grid 60`
