# V1FIX Compact Autotune

## Grid

- Symbols: `XRPUSDT_PER_PAXGUSDT`
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
| 28.0 | 40.0 | 70.0 | 4.0 | 5.0 | 1.5 | 1.0 | 5.0 | 4.0 | 62.0 | -24.49667435493416 | -30.496674354934164 | 6.0000000000000036 | 30.64516129032258 | 23.945798797865915 |
| 28.0 | 40.0 | 70.0 | 4.0 | 8.0 | 1.5 | 1.0 | 5.0 | 4.0 | 62.0 | -25.49667435493416 | -21.496674354934164 | -3.9999999999999964 | 30.64516129032258 | 24.489439201297287 |

## Best Combo

- RSI period: `28`
- RSI: `40/70`
- SL_N: `4`
- TP: `5.0`
- Stage1: `1.5 -> 1.0`
- Stage2: `5.0 -> 4.0`
- Managed total R: `-24.4967`
- Baseline total R: `-30.4967`
- Delta (managed - baseline): `+6.0000`
- Total trades: `62`
- Weighted win %: `30.65`

## Artifacts

- Grid: `/Users/anibalperez/revolutions/RSI/runs/run_v1fix_autotune_48m_rsi28_4070_tp58_xrp_paxg_20260409_181425/artifacts/v1fix_autotune_compact_grid.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/runs/run_v1fix_autotune_48m_rsi28_4070_tp58_xrp_paxg_20260409_181425/artifacts/v1fix_autotune_compact_summary.csv`

