# V1FIX Compact Autotune

## Grid

- Symbols: `BTCUSDT,ETHUSDT,XRPUSDT,SOLUSDT,LINKUSDT`
- Horizon: `2022-03-01T00:05:00+00:00 -> 2026-03-01T00:05:00+00:00`
- RSI period grid: `7`
- RSI combos: `35:60`
- Stage1 combos (mfe1:lock1): `1.0:0.8`
- TP grid: `0.7,1,7,14`
- SL grid (MAE proxy / lookback N): `2`
- Fixed stage2: `mfe2=6.5, lock2=5.5`
- Force managed==baseline: `True`
- entry_tp_r: `5.0` | fee_bps: `3.0`
- Out prefix: `(default)`

## Top Ranked (by managed_total_r)

| rsi_period | rsi_l | rsi_h | sl_n | tp_r | mfe1 | lock1 | mfe2 | lock2 | total_trades | managed_total_r | baseline_total_r | delta_m_minus_b | weighted_win_pct | max_asset_dd_r |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 7.0 | 35.0 | 60.0 | 2.0 | 14.0 | 1.0 | 0.8 | 6.5 | 5.5 | 3407.0 | -861.8699270946797 | -861.8699270946797 | 0.0 | 6.31053712943939 | 447.4806098276455 |
| 7.0 | 35.0 | 60.0 | 2.0 | 0.7 | 1.0 | 0.8 | 6.5 | 5.5 | 3409.0 | -993.2079883011739 | -993.2079883011739 | 0.0 | 53.2414197711939 | 501.5014912258202 |
| 7.0 | 35.0 | 60.0 | 2.0 | 1.0 | 1.0 | 0.8 | 6.5 | 5.5 | 3409.0 | -1014.9079883011732 | -1014.9079883011732 | 0.0 | 45.027867409797594 | 518.4331925779105 |
| 7.0 | 35.0 | 60.0 | 2.0 | 7.0 | 1.0 | 0.8 | 6.5 | 5.5 | 3409.0 | -1120.907988301173 | -1120.907988301173 | 0.0 | 10.882956878850102 | 461.99538362605733 |

## Best Combo

- RSI period: `7`
- RSI: `35/60`
- SL_N: `2`
- TP: `14.0`
- Stage1: `1.0 -> 0.8`
- Stage2: `6.5 -> 5.5`
- Managed total R: `-861.8699`
- Baseline total R: `-861.8699`
- Delta (managed - baseline): `+0.0000`
- Total trades: `3407`
- Weighted win %: `6.31`

## Artifacts

- Grid: `/Users/anibalperez/revolutions/RSI/runs/run_v1fix_autotune_rsi7_global_3560_tp071714_4y_20260409_173846/artifacts/v1fix_autotune_compact_grid.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/runs/run_v1fix_autotune_rsi7_global_3560_tp071714_4y_20260409_173846/artifacts/v1fix_autotune_compact_summary.csv`

