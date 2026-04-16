# FVG IMBALANCE Strategy Report (ETHUSDT)

## Strategy

- Long only on strict bullish FVG when context is bullish IMBALANCE.
- Stop anchored at FVG lower boundary, TP fixed at `tp_r * risk`.
- 5m replay, conservative same-bar resolution (SL before TP).

## Config

- Window: `2022-03-01T00:00:00+00:00 -> 2026-03-01T00:00:00+00:00`
- TF: `1h` | ATR period: `14` | lookback: `20`
- Strict FVG: `min_gap_bps=5.0`, `disp_q=0.85`, `disp_lb=120`
- TP R: `1.0` | max hold (5m bars): `576` | fee bps: `3.0`
- Overlap allowed: `False`

## Summary

 symbol  n_trades  total_r  avg_r  median_r  win_rate  tp_rate  sl_rate  time_rate  max_drawdown_r
ETHUSDT       205  35.9371 0.1753    0.9222    0.6049   0.5854   0.3707     0.0439          8.2812

## Monthly

  month  n_trades  total_r   avg_r  win_rate
2022-03         6   1.7553  0.2925    0.6667
2022-05         2  -2.0394 -1.0197    0.0000
2022-06         2  -0.0204 -0.0102    0.5000
2022-07         6  -0.9012 -0.1502    0.5000
2022-08         5  -1.0847 -0.2169    0.4000
2022-09         2  -0.0327 -0.0163    0.5000
2022-10         8  -0.2135 -0.0267    0.5000
2022-11         2  -0.0583 -0.0292    0.5000
2022-12         2   1.0915  0.5457    1.0000
2023-01         7   3.8445  0.5492    0.8571
2023-02         3   0.9412  0.3137    0.6667
2023-03         8   3.6270  0.4534    0.7500
2023-04         3  -2.3363 -0.7788    0.0000
2023-05         2  -1.2441 -0.6221    0.0000
2023-06         3   0.7024  0.2341    0.6667
2023-07         2   1.9167  0.9583    1.0000
2023-09         2   1.9248  0.9624    1.0000
2023-10         5   2.8460  0.5692    0.8000
2023-11         7   0.7427  0.1061    0.5714
2023-12         8   3.3706  0.4213    0.7500
2024-01         6   3.8041  0.6340    0.8333
2024-02         7  -1.1948 -0.1707    0.4286
2024-03         3   0.9350  0.3117    0.6667
2024-04         4   2.2834  0.5709    0.7500
2024-05         3   2.8678  0.9559    1.0000
2024-06         1  -1.0496 -1.0496    0.0000
2024-07         5   2.6198  0.5240    0.8000
2024-08         2  -0.1405 -0.0702    0.5000
2024-09         5  -1.1543 -0.2309    0.4000
2024-10         4  -0.2911 -0.0728    0.5000
2024-11         8   3.5633  0.4454    0.7500
2024-12         1  -1.0219 -1.0219    0.0000
2025-01         5  -3.1552 -0.6310    0.2000
2025-03         2  -2.0682 -1.0341    0.0000
2025-04         1   0.9881  0.9881    1.0000
2025-05         7   2.8697  0.4100    0.7143
2025-06         4  -2.0654 -0.5163    0.2500
2025-07        15   7.1888  0.4793    0.7333
2025-08        12  -0.3828 -0.0319    0.5000
2025-09         6  -0.2790 -0.0465    0.5000
2025-10         7   2.4592  0.3513    0.7143
2025-11         1   0.9690  0.9690    1.0000
2025-12         2   1.9024  0.9512    1.0000
2026-01         6  -1.3896 -0.2316    0.3333
2026-02         3   2.8470  0.9490    1.0000

## Artifacts

- Trades: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_all_assets_tp1_20260410_201620/artifacts/trades.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_all_assets_tp1_20260410_201620/artifacts/summary.csv`
- Monthly: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_all_assets_tp1_20260410_201620/artifacts/monthly.csv`
