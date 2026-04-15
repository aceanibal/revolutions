# V1FIX Compact Autotune

## Grid

- Symbols: `XRPUSDT`
- Horizon: `2026-02-01T00:05:00+00:00 -> 2026-03-01T00:05:00+00:00`
- RSI period grid: `7,14`
- RSI combos: `30:70,35:65`
- Stage1 combos (mfe1:lock1): `1.0:0.8`
- TP grid: `0.7,1`
- SL grid (MAE proxy / lookback N): `2`
- Fixed stage2: `mfe2=6.5, lock2=5.5`
- Force managed==baseline: `True`
- entry_tp_r: `5.0` | fee_bps: `3.0`
- Out prefix: `sanity_rsiperiod`

## Top Ranked (by managed_total_r)

| rsi_period | rsi_l | rsi_h | sl_n | tp_r | mfe1 | lock1 | mfe2 | lock2 | total_trades | managed_total_r | baseline_total_r | delta_m_minus_b | weighted_win_pct | max_asset_dd_r |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 7.0 | 35.0 | 65.0 | 2.0 | 0.7 | 1.0 | 0.8 | 6.5 | 5.5 | 12.0 | 4.335891880695417 | 4.335891880695417 | 0.0 | 83.33333333333334 | 1.0900312499999973 |
| 7.0 | 35.0 | 65.0 | 2.0 | 1.0 | 1.0 | 0.8 | 6.5 | 5.5 | 12.0 | 1.335891880695356 | 1.335891880695356 | 0.0 | 58.333333333333336 | 1.0900312499999973 |
| 14.0 | 30.0 | 70.0 | 2.0 | 0.7 | 1.0 | 0.8 | 6.5 | 5.5 | 3.0 | 0.2445424497525316 | 0.2445424497525316 | 0.0 | 66.66666666666666 | 0.0 |
| 14.0 | 30.0 | 70.0 | 2.0 | 1.0 | 1.0 | 0.8 | 6.5 | 5.5 | 3.0 | -1.155457550247489 | -1.155457550247489 | 0.0 | 33.33333333333333 | 1.094262500000002 |
| 14.0 | 35.0 | 65.0 | 2.0 | 0.7 | 1.0 | 0.8 | 6.5 | 5.5 | 6.0 | -1.2951855084610768 | -1.2951855084610768 | 0.0 | 50.0 | 1.9864217376662534 |

## Best Combo

- RSI period: `7`
- RSI: `35/65`
- SL_N: `2`
- TP: `0.7`
- Stage1: `1.0 -> 0.8`
- Stage2: `6.5 -> 5.5`
- Managed total R: `+4.3359`
- Baseline total R: `+4.3359`
- Delta (managed - baseline): `+0.0000`
- Total trades: `12`
- Weighted win %: `83.33`

## Artifacts

- Grid: `/Users/anibalperez/revolutions/RSI/cache/v1fix_autotune_compact_sanity_rsiperiod_grid.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/cache/v1fix_autotune_compact_sanity_rsiperiod_summary.csv`

