# Massive 5m Chunk Backtest V1FIX (final)

## Configuration

- **Start (UTC):** `2025-10-01`
- **End (UTC):** `2026-03-01 00:00:00+00:00`
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
| XRPUSDT | 2022-01-01 00:00:00+00:00 | 2026-03-01 00:00:00+00:00 | 436321 | 43488 | True |  |

## Per-symbol totals (full window)

| symbol | n_trades | n_chunks_with_trades | baseline_total_r | managed_total_r | baseline_delta_r | win_pct | max_dd_r | avg_hold_h |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| XRPUSDT | 38 | 5 | -32.33450651904108 | 6.465493480958972 | 38.80000000000005 | 55.26315789473685 | 8.073562816936715 | 18.072368421052634 |

## Chunk-level detail (all symbols)

| symbol | chunk | chunk_start_utc | chunk_end_utc | n_trades | baseline_total_r | managed_total_r | baseline_delta_r | win_pct | max_dd_r | avg_hold_h |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| XRPUSDT | 2025-10 | 2025-10-01T00:00:00+00:00 | 2025-11-01T00:00:00+00:00 | 11 | -11.73289403350647 | -4.932894033506492 | 6.7999999999999785 | 36.36363636363637 | 4.930861412611247 | 1.0227272727272727 |
| XRPUSDT | 2025-11 | 2025-11-01T00:00:00+00:00 | 2025-12-01T00:00:00+00:00 | 7 | -7.783552496150755 | -2.683552496150759 | 5.099999999999996 | 42.857142857142854 | 2.7809021294442995 | 1.5952380952380951 |
| XRPUSDT | 2025-12 | 2025-12-01T00:00:00+00:00 | 2026-01-01T00:00:00+00:00 | 11 | -11.625050017568459 | 1.9749499824315815 | 13.60000000000004 | 72.72727272727273 | 1.137355 | 4.015151515151515 |
| XRPUSDT | 2026-01 | 2026-01-01T00:00:00+00:00 | 2026-02-01T00:00:00+00:00 | 4 | 4.851061849779592 | 8.251061849779594 | 3.400000000000002 | 75.0 | 1.0105746031746032 | 152.66666666666666 |
| XRPUSDT | 2026-02 | 2026-02-01T00:00:00+00:00 | 2026-03-01T00:00:00+00:00 | 5 | -6.044071821594982 | 3.8559281784050476 | 9.90000000000003 | 60.0 | 1.8240499999997857 | 1.9 |

## Pooled summary

- **Total trades:** 38
- **Baseline R (sum):** -32.33
- **Managed MFE-lock R (sum):** +6.47
- **Delta (managed − baseline):** +38.80
- **Risk note:** `max_dd_r` is cumulative drawdown on *sequential* managed-R within each row’s scope (per chunk or full window per asset), not a portfolio DD across assets.

## Chunk stability (pooled managed R by calendar month)

Cross-asset sum of `managed_total_r` per month (same trades as detail table; different from single-asset drawdown).

### Weakest 5 months (pooled)

| chunk | n_symbols | n_trades | managed_total_r | baseline_total_r |
| --- | --- | --- | --- | --- |
| 2025-10 | 1 | 11 | -4.932894033506492 | -11.73289403350647 |
| 2025-11 | 1 | 7 | -2.683552496150759 | -7.783552496150755 |
| 2025-12 | 1 | 11 | 1.9749499824315815 | -11.625050017568459 |
| 2026-02 | 1 | 5 | 3.8559281784050476 | -6.044071821594982 |
| 2026-01 | 1 | 4 | 8.251061849779594 | 4.851061849779592 |

### Strongest 5 months (pooled)

| chunk | n_symbols | n_trades | managed_total_r | baseline_total_r |
| --- | --- | --- | --- | --- |
| 2026-01 | 1 | 4 | 8.251061849779594 | 4.851061849779592 |
| 2026-02 | 1 | 5 | 3.8559281784050476 | -6.044071821594982 |
| 2025-12 | 1 | 11 | 1.9749499824315815 | -11.625050017568459 |
| 2025-11 | 1 | 7 | -2.683552496150759 | -7.783552496150755 |
| 2025-10 | 1 | 11 | -4.932894033506492 | -11.73289403350647 |

## Artifacts

- Preflight: `RSI/cache/massive_chunk_v1fix_preflight.csv`
- Chunk results (primary run): `RSI/cache/massive_chunk_v1fix_tp8p0_results.csv`
- By asset (primary run): `RSI/cache/massive_chunk_v1fix_tp8p0_results_by_asset.csv`

