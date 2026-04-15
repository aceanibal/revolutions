# Massive 5m Chunk Backtest V1FIX (final)

## Configuration

- **Start (UTC):** `2025-03-28`
- **End (UTC):** `2026-03-01 00:00:00+00:00`
- **Chunking:** `monthly`
- **Replay TP (R):** `2.0`

### Strategy / execution

- 4h RSI cross entries; structural SL; 5m replay (wick order, stop updates next bar open)
- RSI 40/70 (period=28), SL_N=4, engine fee 3.0 bps RT
- Trade list from engine at TP=5.0R; replay TP=2.0R
- MFE ladder (V1FIX): (1.5R → 1.0R), (5.0R → 4.0R); cap_lock_by_mfe=True; skip_entry_bucket_hours=0.0

## 5m data coverage (preflight)

| symbol | first_ts_utc | last_ts_utc | n_candles | n_in_window | ok | notes |
| --- | --- | --- | --- | --- | --- | --- |
| XRPUSDT_PER_PAXGUSDT | 2025-03-27 10:30:00+00:00 | 2026-03-01 00:00:00+00:00 | 97507 | 97344 | True |  |

## Per-symbol totals (full window)

| symbol | n_trades | n_chunks_with_trades | baseline_total_r | managed_total_r | baseline_delta_r | win_pct | max_dd_r | avg_hold_h |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| XRPUSDT_PER_PAXGUSDT | 62 | 11 | -21.499226769709924 | -19.499226769709917 | 2.000000000000007 | 32.25806451612903 | 22.462539204291865 | 5.21505376344086 |

## Chunk-level detail (all symbols)

| symbol | chunk | chunk_start_utc | chunk_end_utc | n_trades | baseline_total_r | managed_total_r | baseline_delta_r | win_pct | max_dd_r | avg_hold_h |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| XRPUSDT_PER_PAXGUSDT | 2025-04 | 2025-04-01T00:00:00+00:00 | 2025-05-01T00:00:00+00:00 | 5 | 3.8884758421925465 | 0.8884758421925466 | -3.0 | 60.0 | 1.0087253650774288 | 4.55 |
| XRPUSDT_PER_PAXGUSDT | 2025-05 | 2025-05-01T00:00:00+00:00 | 2025-06-01T00:00:00+00:00 | 2 | -2.069459177735105 | -2.069459177735105 | 0.0 | 0.0 | 1.0541639235725249 | 2.2083333333333335 |
| XRPUSDT_PER_PAXGUSDT | 2025-06 | 2025-06-01T00:00:00+00:00 | 2025-07-01T00:00:00+00:00 | 4 | 1.693699400126648 | 0.6936994001266481 | -1.0 | 50.0 | 1.0075655701360924 | 24.916666666666668 |
| XRPUSDT_PER_PAXGUSDT | 2025-07 | 2025-07-01T00:00:00+00:00 | 2025-08-01T00:00:00+00:00 | 3 | -3.172380457146099 | 0.827619542853901 | 4.0 | 66.66666666666666 | 1.0414686523433805 | 0.75 |
| XRPUSDT_PER_PAXGUSDT | 2025-08 | 2025-08-01T00:00:00+00:00 | 2025-09-01T00:00:00+00:00 | 8 | -2.9838267578220927 | -0.9838267578220927 | 2.0 | 37.5 | 3.6068035849660447 | 4.208333333333333 |
| XRPUSDT_PER_PAXGUSDT | 2025-09 | 2025-09-01T00:00:00+00:00 | 2025-10-01T00:00:00+00:00 | 5 | 2.8150308144278875 | 1.8150308144278875 | -1.0 | 60.0 | 1.0337024951580855 | 0.6666666666666666 |
| XRPUSDT_PER_PAXGUSDT | 2025-10 | 2025-10-01T00:00:00+00:00 | 2025-11-01T00:00:00+00:00 | 5 | -5.093494739643542 | -5.093494739643542 | 0.0 | 0.0 | 4.054094333142936 | 9.916666666666666 |
| XRPUSDT_PER_PAXGUSDT | 2025-11 | 2025-11-01T00:00:00+00:00 | 2025-12-01T00:00:00+00:00 | 7 | -4.425949509487827 | -2.425949509487827 | 2.0 | 28.57142857142857 | 5.38370932679125 | 0.8095238095238095 |
| XRPUSDT_PER_PAXGUSDT | 2025-12 | 2025-12-01T00:00:00+00:00 | 2026-01-01T00:00:00+00:00 | 9 | -0.5660763701446321 | -1.566076370144632 | -1.0 | 44.44444444444444 | 2.279938833076185 | 1.425925925925926 |
| XRPUSDT_PER_PAXGUSDT | 2026-01 | 2026-01-01T00:00:00+00:00 | 2026-02-01T00:00:00+00:00 | 6 | -6.281688739568311 | -6.281688739568311 | 0.0 | 0.0 | 5.144148516526811 | 9.708333333333334 |
| XRPUSDT_PER_PAXGUSDT | 2026-02 | 2026-02-01T00:00:00+00:00 | 2026-03-01T00:00:00+00:00 | 8 | -5.303557074909394 | -5.303557074909394 | 0.0 | 12.5 | 4.287394630550109 | 3.8645833333333335 |

## Pooled summary

- **Total trades:** 62
- **Baseline R (sum):** -21.50
- **Managed MFE-lock R (sum):** -19.50
- **Delta (managed − baseline):** +2.00
- **Risk note:** `max_dd_r` is cumulative drawdown on *sequential* managed-R within each row’s scope (per chunk or full window per asset), not a portfolio DD across assets.

## Chunk stability (pooled managed R by calendar month)

Cross-asset sum of `managed_total_r` per month (same trades as detail table; different from single-asset drawdown).

### Weakest 5 months (pooled)

| chunk | n_symbols | n_trades | managed_total_r | baseline_total_r |
| --- | --- | --- | --- | --- |
| 2026-01 | 1 | 6 | -6.281688739568311 | -6.281688739568311 |
| 2026-02 | 1 | 8 | -5.303557074909394 | -5.303557074909394 |
| 2025-10 | 1 | 5 | -5.093494739643542 | -5.093494739643542 |
| 2025-11 | 1 | 7 | -2.425949509487827 | -4.425949509487827 |
| 2025-05 | 1 | 2 | -2.069459177735105 | -2.069459177735105 |

### Strongest 5 months (pooled)

| chunk | n_symbols | n_trades | managed_total_r | baseline_total_r |
| --- | --- | --- | --- | --- |
| 2025-09 | 1 | 5 | 1.8150308144278875 | 2.8150308144278875 |
| 2025-04 | 1 | 5 | 0.8884758421925466 | 3.8884758421925465 |
| 2025-07 | 1 | 3 | 0.827619542853901 | -3.172380457146099 |
| 2025-06 | 1 | 4 | 0.6936994001266481 | 1.693699400126648 |
| 2025-08 | 1 | 8 | -0.9838267578220927 | -2.9838267578220927 |

## Artifacts

- Preflight: `RSI/cache/massive_chunk_v1fix_preflight.csv`
- Chunk results (primary run): `RSI/cache/massive_chunk_v1fix_tp2p0_results.csv`
- By asset (primary run): `RSI/cache/massive_chunk_v1fix_tp2p0_results_by_asset.csv`

