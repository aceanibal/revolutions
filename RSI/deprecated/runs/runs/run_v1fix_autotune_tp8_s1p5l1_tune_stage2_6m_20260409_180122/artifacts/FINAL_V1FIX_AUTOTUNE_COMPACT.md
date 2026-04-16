# V1FIX Compact Autotune

## Grid

- Symbols: `XRPUSDT,ETHUSDT,LINKUSDT`
- Horizon: `2025-09-01T00:05:00+00:00 -> 2026-03-01T00:05:00+00:00`
- RSI period grid: `7`
- RSI combos: `35:60`
- Stage1 combos (mfe1:lock1): `1.5:1.0`
- Stage2 combos (mfe2:lock2): `5:4,6:5,6.5:5.5,8:6.5,10:8,12:9`
- TP grid: `8`
- SL grid (MAE proxy / lookback N): `4`
- Force managed==baseline: `False`
- entry_tp_r: `5.0` | fee_bps: `3.0`
- Out prefix: `(default)`

## Top Ranked (by managed_total_r)

| rsi_period | rsi_l | rsi_h | sl_n | tp_r | mfe1 | lock1 | mfe2 | lock2 | total_trades | managed_total_r | baseline_total_r | delta_m_minus_b | weighted_win_pct | max_asset_dd_r |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 7.0 | 35.0 | 60.0 | 4.0 | 8.0 | 1.5 | 1.0 | 5.0 | 4.0 | 257.0 | -1.770690034949715 | -25.770690034949723 | 24.00000000000001 | 42.4124513618677 | 27.60836427222683 |
| 7.0 | 35.0 | 60.0 | 4.0 | 8.0 | 1.5 | 1.0 | 6.0 | 5.0 | 257.0 | -3.770690034949723 | -25.770690034949723 | 22.000000000000004 | 42.4124513618677 | 26.608364272226826 |
| 7.0 | 35.0 | 60.0 | 4.0 | 8.0 | 1.5 | 1.0 | 6.5 | 5.5 | 257.0 | -6.7706900349497 | -25.770690034949723 | 19.00000000000003 | 42.4124513618677 | 31.93428005425975 |
| 7.0 | 35.0 | 60.0 | 4.0 | 8.0 | 1.5 | 1.0 | 8.0 | 6.5 | 257.0 | -17.770690034949723 | -25.770690034949723 | 8.000000000000004 | 42.4124513618677 | 36.434280054259766 |
| 7.0 | 35.0 | 60.0 | 4.0 | 8.0 | 1.5 | 1.0 | 10.0 | 8.0 | 257.0 | -17.770690034949723 | -25.770690034949723 | 8.000000000000004 | 42.4124513618677 | 36.434280054259766 |
| 7.0 | 35.0 | 60.0 | 4.0 | 8.0 | 1.5 | 1.0 | 12.0 | 9.0 | 257.0 | -17.770690034949723 | -25.770690034949723 | 8.000000000000004 | 42.4124513618677 | 36.434280054259766 |

## Best Combo

- RSI period: `7`
- RSI: `35/60`
- SL_N: `4`
- TP: `8.0`
- Stage1: `1.5 -> 1.0`
- Stage2: `5.0 -> 4.0`
- Managed total R: `-1.7707`
- Baseline total R: `-25.7707`
- Delta (managed - baseline): `+24.0000`
- Total trades: `257`
- Weighted win %: `42.41`

## Artifacts

- Grid: `/Users/anibalperez/revolutions/RSI/runs/run_v1fix_autotune_tp8_s1p5l1_tune_stage2_6m_20260409_180122/artifacts/v1fix_autotune_compact_grid.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/runs/run_v1fix_autotune_tp8_s1p5l1_tune_stage2_6m_20260409_180122/artifacts/v1fix_autotune_compact_summary.csv`

