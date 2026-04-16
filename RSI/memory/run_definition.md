# Run Definition (Canonical)

## Purpose

Define exactly what a "run" means in this project so all tools (Claude, Cursor,
Streamlit, scripts) follow the same contract.

## What is a run?

A run is a single immutable execution package with one strategy setup and one TP.

A run is defined by:

- one `run_id` (unique)
- one `strategy_id` and `strategy_version`
- one `tp_r` (single TP target)
- one symbol set
- one time window (`start_utc`, `end_utc`)
- one parameter set and one DB path
- one output package (`run_config.json`, `trades/`, `artifacts/`)

## Non-negotiable invariants

1. One run = one TP (`tp_r`).
2. TP sweeps are not standard run mode.
3. If TP changes, create a new run (new `run_id`).
4. Run outputs are append-only/immutable after completion.
5. Trade accounting and chunking use EXIT timestamp.

## Standard folder contract

```
runs/run_<strategy_id>_<timestamp>/
  run_config.json
  trades/
    trade_details_<strategy_id>_<tp_tag>.csv
  artifacts/
    <strategy_id>_<tp_tag>_results.csv
    <strategy_id>_<tp_tag>_results_by_asset.csv
```

`tp_tag` format: `tp13p0`, `tp4p25`, etc.

## Required run_config fields

- `run_id`
- `strategy_id` or `script`
- `db`/`db_path`
- `symbols`
- `start_utc`
- `end_utc`
- `tp_r`
- `fee_bps`
- strategy-specific params (RSI thresholds, stop config, stages, etc.)

## Required trade CSV minimum fields

- `symbol`
- `tp_r`
- `entry_ts_utc`
- `exit_ts_utc`
- `side`
- `entry_price`
- `stop_init`
- `risk`
- `tp_price`
- `baseline_r`
- `managed_r`
- `managed_reason`
- `hold_5m_bars`

## Re-run policy

- If you tweak code/params/window/symbol set/TP, it is a new run.
- Do not overwrite previous run folders.
- Preserve older runs for audit and reproducibility.
