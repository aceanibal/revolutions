# Massive 5m Chunk Backtest V1FIX (final)

## Configuration

- **Start (UTC):** `2025-01-01`
- **End (UTC):** `2025-02-01 00:00:00+00:00`
- **Chunking:** `monthly`
- **Replay TP (R):** `8.0`

### Strategy / execution

- 4h RSI cross entries; structural SL; 5m replay (wick order, stop updates next bar open)
- RSI 40/65, SL_N=2, engine fee 3.0 bps RT
- Trade list from engine at TP=5.0R; replay TP=8.0R
- MFE ladder (V1FIX): (0.9R → 0.7R), (6.5R → 5.5R); cap_lock_by_mfe=True; skip_entry_bucket_hours=0.0

## 5m data coverage (preflight)

| symbol | first_ts_utc | last_ts_utc | n_candles | n_in_window | ok | notes |
| --- | --- | --- | --- | --- | --- | --- |
| BTCUSDT | 2022-01-01 00:00:00+00:00 | 2026-03-01 00:00:00+00:00 | 437761 | 8928 | True |  |

## Per-symbol totals (full window)

| symbol | n_trades | n_chunks_with_trades | baseline_total_r | managed_total_r | baseline_delta_r | win_pct | max_dd_r | avg_hold_h |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTCUSDT | 8 | 1 | -12.642011260968712 | -9.242011260968724 | 3.399999999999988 | 25.0 | 8.77653568553036 | 2.7291666666666665 |

## Chunk-level detail (all symbols)

| symbol | chunk | chunk_start_utc | chunk_end_utc | n_trades | baseline_total_r | managed_total_r | baseline_delta_r | win_pct | max_dd_r | avg_hold_h |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTCUSDT | 2025-01 | 2025-01-01T00:00:00+00:00 | 2025-02-01T00:00:00+00:00 | 8 | -12.642011260968712 | -9.242011260968724 | 3.399999999999988 | 25.0 | 8.77653568553036 | 2.7291666666666665 |

## Pooled summary

- **Total trades:** 8
- **Baseline R (sum):** -12.64
- **Managed MFE-lock R (sum):** -9.24
- **Delta (managed − baseline):** +3.40
- **Risk note:** `max_dd_r` is cumulative drawdown on *sequential* managed-R within each row’s scope (per chunk or full window per asset), not a portfolio DD across assets.

## Chunk stability (pooled managed R by calendar month)

Cross-asset sum of `managed_total_r` per month (same trades as detail table; different from single-asset drawdown).

### Weakest 5 months (pooled)

| chunk | n_symbols | n_trades | managed_total_r | baseline_total_r |
| --- | --- | --- | --- | --- |
| 2025-01 | 1 | 8 | -9.242011260968724 | -12.642011260968712 |

### Strongest 5 months (pooled)

| chunk | n_symbols | n_trades | managed_total_r | baseline_total_r |
| --- | --- | --- | --- | --- |
| 2025-01 | 1 | 8 | -9.242011260968724 | -12.642011260968712 |

## Artifacts

- Preflight: `RSI/cache/massive_chunk_v1fix_preflight.csv`
- Chunk results (primary run): `RSI/cache/massive_chunk_v1fix_tp8p0_results.csv`
- By asset (primary run): `RSI/cache/massive_chunk_v1fix_tp8p0_results_by_asset.csv`

