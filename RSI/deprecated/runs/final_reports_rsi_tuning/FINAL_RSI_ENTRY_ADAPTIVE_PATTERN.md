# RSI Entry Adaptation Pattern (Year x Asset)

## Setup

- Symbols: `BTCUSDT`
- Window: `2025-01-01 00:00:00+00:00` to `2025-03-01 00:00:00+00:00` (exit-time assignment)
- Entry engine: 4h RSI cross with `SL_N=3` and engine `entry_tp_r=5.0`
- Managed replay: 5m MFE ladder `(1.0->0.8), (6.5->5.5)`, TP `8.0R`, cap lock by MFE
- RSI grid: L=[35], H=[60], min gap `10`
- Eligibility: `n_trades >= 1` per symbol-year-combo

## Best RSI per Symbol-Year

| symbol | year | rsi_l | rsi_h | n_trades | managed_total_r | win_pct | max_dd_r | avg_hold_h |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTCUSDT | 2025 | 35 | 60 | 9 | 17.793005176480786 | 77.77777777777779 | 1.0369513133325032 | 7.314814814814814 |

## Global Yearly Pattern (from best-per-asset)

| year | n_assets | n_trades | managed_total_r | median_rsi_l | median_rsi_h | weighted_rsi_l | weighted_rsi_h |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2025.0 | 1.0 | 9.0 | 17.793005176480786 | 35.0 | 60.0 | 35.0 | 60.0 |

## Trend Signals

- Weighted RSI-L slope vs year: `+nan` points/year
- Weighted RSI-H slope vs year: `+nan` points/year
- Weighted gap (H-L) slope vs year: `+nan` points/year

Per-asset slope of chosen best RSI levels:

| symbol | years | slope_rsi_l_per_year | slope_rsi_h_per_year |
| --- | --- | --- | --- |
| BTCUSDT | 1 | nan | nan |

## Top-1 RSI combos per Symbol-Year

| symbol | year | rsi_l | rsi_h | n_trades | managed_total_r | win_pct | max_dd_r | avg_hold_h |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTCUSDT | 2025 | 35 | 60 | 9 | 17.793005176480786 | 77.77777777777779 | 1.0369513133325032 | 7.314814814814814 |

## Artifacts

- `sandbox/cache/rsi_year_asset_grid_managed.csv`
- `sandbox/cache/rsi_year_asset_best.csv`
- `sandbox/cache/rsi_year_global_pattern.csv`
