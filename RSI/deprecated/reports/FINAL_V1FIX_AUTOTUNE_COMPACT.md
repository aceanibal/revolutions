# V1FIX Compact Autotune

## Grid

- Symbols: `BTCUSDT,ETHUSDT,XRPUSDT,SOLUSDT,LINKUSDT`
- Horizon: `2022-03-01T00:05:00+00:00 -> 2026-03-01T00:05:00+00:00`
- RSI combos: `30:70`
- Stage1 combos (mfe1:lock1): `1.0:0.8`
- TP grid: `0.7,1,2,5,8,13,21`
- SL grid (MAE proxy / lookback N): `2`
- Fixed stage2: `mfe2=6.5, lock2=5.5`
- Force managed==baseline: `True`
- entry_tp_r: `5.0` | fee_bps: `3.0`

## Top Ranked (by managed_total_r)

| rsi_l | rsi_h | sl_n | tp_r | mfe1 | lock1 | mfe2 | lock2 | total_trades | managed_total_r | baseline_total_r | delta_m_minus_b | weighted_win_pct | max_asset_dd_r |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 30.0 | 70.0 | 2.0 | 21.0 | 1.0 | 0.8 | 6.5 | 5.5 | 640.0 | 13.402532535988044 | 13.402532535988044 | 0.0 | 5.0 | 81.6087961954633 |
| 30.0 | 70.0 | 2.0 | 13.0 | 1.0 | 0.8 | 6.5 | 5.5 | 641.0 | -33.60152770000316 | -33.60152770000316 | 0.0 | 7.332293291731669 | 64.49834291348212 |
| 30.0 | 70.0 | 2.0 | 8.0 | 1.0 | 0.8 | 6.5 | 5.5 | 641.0 | -79.60152770000315 | -79.60152770000315 | 0.0 | 10.60842433697348 | 60.49834291348213 |
| 30.0 | 70.0 | 2.0 | 1.0 | 1.0 | 0.8 | 6.5 | 5.5 | 641.0 | -127.60152770000316 | -127.60152770000316 | 0.0 | 43.99375975039001 | 52.84692226470235 |
| 30.0 | 70.0 | 2.0 | 5.0 | 1.0 | 0.8 | 6.5 | 5.5 | 641.0 | -133.60152770000317 | -133.60152770000317 | 0.0 | 14.508580343213728 | 54.49834291348213 |
| 30.0 | 70.0 | 2.0 | 0.7 | 1.0 | 0.8 | 6.5 | 5.5 | 641.0 | -134.0015277000033 | -134.0015277000033 | 0.0 | 51.014040561622465 | 52.35170707992668 |
| 30.0 | 70.0 | 2.0 | 2.0 | 1.0 | 0.8 | 6.5 | 5.5 | 641.0 | -148.60152770000315 | -148.60152770000315 | 0.0 | 28.237129485179405 | 67.65377501978053 |

## Best Combo

- RSI: `30/70`
- SL_N: `2`
- TP: `21.0`
- Stage1: `1.0 -> 0.8`
- Stage2: `6.5 -> 5.5`
- Managed total R: `+13.4025`
- Baseline total R: `+13.4025`
- Delta (managed - baseline): `+0.0000`
- Total trades: `640`
- Weighted win %: `5.00`

## Artifacts

- Grid: `/Users/anibalperez/revolutions/RSI/cache/v1fix_autotune_compact_grid.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/cache/v1fix_autotune_compact_summary.csv`

