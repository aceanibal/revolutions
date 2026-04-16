# V1FIX Compact Autotune

## Grid

- Symbols: `BTCUSDT,ETHUSDT,XRPUSDT,SOLUSDT,LINKUSDT`
- Horizon: `2022-03-01T00:05:00+00:00 -> 2026-03-01T00:05:00+00:00`
- RSI period grid: `14`
- RSI combos: `35:60`
- Stage1 combos (mfe1:lock1): `1.5:1.0`
- Stage2 combos (mfe2:lock2): `5.0:4.0`
- TP grid: `8`
- SL grid (MAE proxy / lookback N): `4`
- Force managed==baseline: `False`
- entry_tp_r: `5.0` | fee_bps: `3.0`
- Out prefix: `(default)`

## Top Ranked (by managed_total_r)

| rsi_period | rsi_l | rsi_h | sl_n | tp_r | mfe1 | lock1 | mfe2 | lock2 | total_trades | managed_total_r | baseline_total_r | delta_m_minus_b | weighted_win_pct | max_asset_dd_r |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 14.0 | 35.0 | 60.0 | 4.0 | 8.0 | 1.5 | 1.0 | 5.0 | 4.0 | 1844.0 | -433.56604488067615 | -237.56604488067615 | -196.00000000000003 | 36.00867678958785 | 155.21784797135618 |

## Best Combo

- RSI period: `14`
- RSI: `35/60`
- SL_N: `4`
- TP: `8.0`
- Stage1: `1.5 -> 1.0`
- Stage2: `5.0 -> 4.0`
- Managed total R: `-433.5660`
- Baseline total R: `-237.5660`
- Delta (managed - baseline): `-196.0000`
- Total trades: `1844`
- Weighted win %: `36.01`

## Artifacts

- Grid: `/Users/anibalperez/revolutions/RSI/runs/run_v1fix_autotune_48m_rsi14_s1p5l1_s2p5l4_tp8_full5_20260409_180520/artifacts/v1fix_autotune_compact_grid.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/runs/run_v1fix_autotune_48m_rsi14_s1p5l1_s2p5l4_tp8_full5_20260409_180520/artifacts/v1fix_autotune_compact_summary.csv`

