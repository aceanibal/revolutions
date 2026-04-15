# V1FIX Compact Autotune

## Grid

- Symbols: `BTCUSDT,ETHUSDT,XRPUSDT,SOLUSDT,LINKUSDT`
- Horizon: `2022-03-01T00:05:00+00:00 -> 2026-03-01T00:05:00+00:00`
- RSI period grid: `28`
- RSI combos: `40:70`
- Stage1 combos (mfe1:lock1): `1.5:1.0`
- Stage2 combos (mfe2:lock2): `5.0:4.0`
- TP grid: `5,8`
- SL grid (MAE proxy / lookback N): `4`
- Force managed==baseline: `False`
- entry_tp_r: `5.0` | fee_bps: `3.0`
- Out prefix: `(default)`

## Top Ranked (by managed_total_r)

| rsi_period | rsi_l | rsi_h | sl_n | tp_r | mfe1 | lock1 | mfe2 | lock2 | total_trades | managed_total_r | baseline_total_r | delta_m_minus_b | weighted_win_pct | max_asset_dd_r |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 28.0 | 40.0 | 70.0 | 4.0 | 5.0 | 1.5 | 1.0 | 5.0 | 4.0 | 869.0 | -185.62440613116556 | -214.62440613116556 | 28.99999999999998 | 36.478711162255465 | 68.22566446401447 |
| 28.0 | 40.0 | 70.0 | 4.0 | 8.0 | 1.5 | 1.0 | 5.0 | 4.0 | 869.0 | -186.62440613116556 | -292.62440613116553 | 105.99999999999994 | 36.478711162255465 | 67.22566446401449 |

## Best Combo

- RSI period: `28`
- RSI: `40/70`
- SL_N: `4`
- TP: `5.0`
- Stage1: `1.5 -> 1.0`
- Stage2: `5.0 -> 4.0`
- Managed total R: `-185.6244`
- Baseline total R: `-214.6244`
- Delta (managed - baseline): `+29.0000`
- Total trades: `869`
- Weighted win %: `36.48`

## Artifacts

- Grid: `/Users/anibalperez/revolutions/RSI/runs/run_v1fix_autotune_48m_rsi28_4070_tp58_s1p5l1_s2p5l4_full5_20260409_181104/artifacts/v1fix_autotune_compact_grid.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/runs/run_v1fix_autotune_48m_rsi28_4070_tp58_s1p5l1_s2p5l4_full5_20260409_181104/artifacts/v1fix_autotune_compact_summary.csv`

