# V1FIX Compact Autotune

## Grid

- Symbols: `XRPUSDT,ETHUSDT,LINKUSDT`
- Horizon: `2025-09-01T00:05:00+00:00 -> 2026-03-01T00:05:00+00:00`
- RSI period grid: `7`
- RSI combos: `35:60`
- Stage1 combos (mfe1:lock1): `1.5:1.0,2.0:1.0,2.5:1.0,2.5:1.2,3.0:1.5,1.2:0.9,2.0:0.9`
- TP grid: `3`
- SL grid (MAE proxy / lookback N): `4`
- Fixed stage2: `mfe2=6.5, lock2=5.5`
- Force managed==baseline: `False`
- entry_tp_r: `5.0` | fee_bps: `3.0`
- Out prefix: `(default)`

## Top Ranked (by managed_total_r)

| rsi_period | rsi_l | rsi_h | sl_n | tp_r | mfe1 | lock1 | mfe2 | lock2 | total_trades | managed_total_r | baseline_total_r | delta_m_minus_b | weighted_win_pct | max_asset_dd_r |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 7.0 | 35.0 | 60.0 | 4.0 | 3.0 | 1.5 | 1.0 | 6.5 | 5.5 | 258.0 | -18.79094224083208 | -26.790942240832113 | 8.000000000000034 | 42.63565891472868 | 28.60836427222683 |
| 7.0 | 35.0 | 60.0 | 4.0 | 3.0 | 3.0 | 1.5 | 6.5 | 5.5 | 258.0 | -26.790942240832113 | -26.790942240832113 | 0.0 | 24.418604651162788 | 38.47393056469636 |
| 7.0 | 35.0 | 60.0 | 4.0 | 3.0 | 1.2 | 0.9 | 6.5 | 5.5 | 258.0 | -28.09094224083199 | -26.790942240832113 | -1.2999999999998764 | 47.286821705426355 | 28.63132890106091 |
| 7.0 | 35.0 | 60.0 | 4.0 | 3.0 | 2.0 | 1.0 | 6.5 | 5.5 | 258.0 | -30.79094224083208 | -26.790942240832113 | -3.999999999999968 | 32.55813953488372 | 37.925768229690256 |
| 7.0 | 35.0 | 60.0 | 4.0 | 3.0 | 2.5 | 1.0 | 6.5 | 5.5 | 258.0 | -32.79094224083211 | -26.790942240832113 | -6.0 | 28.68217054263566 | 39.925768229690256 |
| 7.0 | 35.0 | 60.0 | 4.0 | 3.0 | 2.0 | 0.9 | 6.5 | 5.5 | 258.0 | -33.090942240832106 | -26.790942240832113 | -6.299999999999997 | 32.55813953488372 | 37.02576822969028 |
| 7.0 | 35.0 | 60.0 | 4.0 | 3.0 | 2.5 | 1.2 | 6.5 | 5.5 | 258.0 | -36.7909422408321 | -26.790942240832113 | -9.99999999999999 | 28.68217054263566 | 40.72576822969028 |

## Best Combo

- RSI period: `7`
- RSI: `35/60`
- SL_N: `4`
- TP: `3.0`
- Stage1: `1.5 -> 1.0`
- Stage2: `6.5 -> 5.5`
- Managed total R: `-18.7909`
- Baseline total R: `-26.7909`
- Delta (managed - baseline): `+8.0000`
- Total trades: `258`
- Weighted win %: `42.64`

## Artifacts

- Grid: `/Users/anibalperez/revolutions/RSI/runs/run_v1fix_autotune_sl4_wide_mfe_tp3_6m_rsi3560_20260409_175803/artifacts/v1fix_autotune_compact_grid.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/runs/run_v1fix_autotune_sl4_wide_mfe_tp3_6m_rsi3560_20260409_175803/artifacts/v1fix_autotune_compact_summary.csv`

