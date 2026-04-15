# FVG IMBALANCE Strategy Report (DOGEUSDT)

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
DOGEUSDT       219  28.9296 0.1321    0.9561    0.5753   0.5753   0.4201     0.0046         10.2113

## Monthly

  month  n_trades  total_r   avg_r  win_rate
2022-03         4   3.9114  0.9778    1.0000
2022-04         2   1.9827  0.9913    1.0000
2022-05         2  -2.0334 -1.0167    0.0000
2022-06         4  -0.0556 -0.0139    0.5000
2022-07         6   1.8311  0.3052    0.6667
2022-08         3  -1.0647 -0.3549    0.3333
2022-09         1  -1.0066 -1.0066    0.0000
2022-10        11   4.8752  0.4432    0.7273
2022-11         4  -2.0335 -0.5084    0.2500
2023-01         3   0.9254  0.3085    0.6667
2023-02         1   0.9868  0.9868    1.0000
2023-03         4  -0.0649 -0.0162    0.5000
2023-04         4  -2.0669 -0.5167    0.2500
2023-06         2  -0.0308 -0.0154    0.5000
2023-07         2  -2.0221 -1.0111    0.0000
2023-08         1  -1.0555 -1.0555    0.0000
2023-10         6   3.6757  0.6126    0.8333
2023-11         3   0.9411  0.3137    0.6667
2023-12         4   3.9334  0.9833    1.0000
2024-01         6  -4.1292 -0.6882    0.1667
2024-02         8   5.7027  0.7128    0.8750
2024-03        11   1.3924  0.1266    0.5455
2024-04         3   0.9295  0.3098    0.6667
2024-05         6   3.8664  0.6444    0.8333
2024-06         1   0.9561  0.9561    1.0000
2024-07         6   1.7792  0.2965    0.6667
2024-08         3  -1.0460 -0.3487    0.3333
2024-09         8  -6.1190 -0.7649    0.1250
2024-10         7   0.9009  0.1287    0.5714
2024-11        14   5.7770  0.4126    0.7143
2024-12         2  -0.0457 -0.0228    0.5000
2025-01        12   1.7138  0.1428    0.5833
2025-02         2  -0.0386 -0.0193    0.5000
2025-03         4  -0.0527 -0.0132    0.5000
2025-04         3   2.9642  0.9881    1.0000
2025-05         6   3.8891  0.6482    0.8333
2025-06         2  -2.0282 -1.0141    0.0000
2025-07        11  -5.1216 -0.4656    0.2727
2025-08         5  -1.0913 -0.2183    0.4000
2025-09        11   2.6795  0.2436    0.6364
2025-10         6   1.7118  0.2853    0.6667
2025-11         1   0.9515  0.9515    1.0000
2025-12         1  -1.0182 -1.0182    0.0000
2026-01         8  -2.1415 -0.2677    0.3750
2026-02         5   4.9188  0.9838    1.0000

## Artifacts

- Trades: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_all_assets_tp1_20260410_201617/artifacts/trades.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_all_assets_tp1_20260410_201617/artifacts/summary.csv`
- Monthly: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_all_assets_tp1_20260410_201617/artifacts/monthly.csv`
