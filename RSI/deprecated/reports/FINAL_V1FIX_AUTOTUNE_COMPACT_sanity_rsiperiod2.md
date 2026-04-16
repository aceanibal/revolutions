# V1FIX Compact Autotune

## Grid

- Symbols: `XRPUSDT`
- Horizon: `2026-02-01T00:05:00+00:00 -> 2026-03-01T00:05:00+00:00`
- RSI period grid: `7`
- RSI combos: `30:70`
- Stage1 combos (mfe1:lock1): `1.0:0.8`
- TP grid: `0.7`
- SL grid (MAE proxy / lookback N): `2`
- Fixed stage2: `mfe2=6.5, lock2=5.5`
- Force managed==baseline: `True`
- entry_tp_r: `5.0` | fee_bps: `3.0`
- Out prefix: `sanity_rsiperiod2`

## Top Ranked (by managed_total_r)

| rsi_period | rsi_l | rsi_h | sl_n | tp_r | mfe1 | lock1 | mfe2 | lock2 | total_trades | managed_total_r | baseline_total_r | delta_m_minus_b | weighted_win_pct | max_asset_dd_r |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 7.0 | 30.0 | 70.0 | 2.0 | 0.7 | 1.0 | 0.8 | 6.5 | 5.5 | 12.0 | -7.733515546027595 | -7.733515546027595 | 0.0 | 25.0 | 6.702025750109228 |

## Best Combo

- RSI period: `7`
- RSI: `30/70`
- SL_N: `2`
- TP: `0.7`
- Stage1: `1.0 -> 0.8`
- Stage2: `6.5 -> 5.5`
- Managed total R: `-7.7335`
- Baseline total R: `-7.7335`
- Delta (managed - baseline): `+0.0000`
- Total trades: `12`
- Weighted win %: `25.00`

## Artifacts

- Grid: `/Users/anibalperez/revolutions/RSI/cache/v1fix_autotune_compact_sanity_rsiperiod2_grid.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/cache/v1fix_autotune_compact_sanity_rsiperiod2_summary.csv`

