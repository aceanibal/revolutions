# Massive 5m Chunk Backtest V1FIX (final)

## Configuration

- **Start (UTC):** `2025-03-27`
- **End (UTC):** `2026-03-01 00:00:00+00:00`
- **Chunking:** `monthly`
- **Replay TP (R):** `8.0`

### Strategy / execution

- 4h RSI cross entries; structural SL; 5m replay (wick order, stop updates next bar open)
- RSI 40/70 (period=28), SL_N=4, engine fee 3.0 bps RT
- Trade list from engine at TP=5.0R; replay TP=8.0R
- MFE ladder (V1FIX): (1.5R → 1.0R), (5.0R → 4.0R); cap_lock_by_mfe=True; skip_entry_bucket_hours=0.0

## 5m data coverage (preflight)

| symbol | first_ts_utc | last_ts_utc | n_candles | n_in_window | ok | notes |
| --- | --- | --- | --- | --- | --- | --- |
| XRPUSDT_PER_PAXGUSDT | 2025-03-27 10:30:00+00:00 | 2026-03-01 00:00:00+00:00 | 97507 | 97506 | False | data starts 2025-03-27 10:30:00+00:00 (after 2025-03-27 00:00:00+00:00) |

## Per-symbol totals (full window)

_No results._

## Chunk-level detail (all symbols)

_No chunk rows._

## Pooled summary

_N/A_
## Artifacts

- Preflight: `RSI/cache/massive_chunk_v1fix_preflight.csv`
- Chunk results (primary run): `RSI/cache/massive_chunk_v1fix_tp8p0_results.csv`
- By asset (primary run): `RSI/cache/massive_chunk_v1fix_tp8p0_results_by_asset.csv`

