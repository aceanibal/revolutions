# FVG IMBALANCE Strategy Report (XRPUSDT)

## Strategy

- Long only on strict bullish FVG when context is bullish IMBALANCE.
- Stop anchored at FVG lower boundary, TP fixed at `tp_r * risk`.
- 5m replay, conservative same-bar resolution (SL before TP).

## Config

- Window: `2022-03-01T00:00:00+00:00 -> 2026-03-01T00:00:00+00:00`
- TF: `1h` | ATR period: `14` | lookback: `20`
- Strict FVG: `min_gap_bps=5.0`, `disp_q=0.85`, `disp_lb=120`
- TP R: `3.0` | max hold (5m bars): `576` | fee bps: `3.0`
- Overlap allowed: `False`

## Summary

 symbol  n_trades  total_r  avg_r  median_r  win_rate  tp_rate  sl_rate  time_rate  max_drawdown_r
XRPUSDT       168  10.8574 0.0646   -1.0116    0.3036   0.2381   0.6667     0.0952         24.5174

## Monthly

  month  n_trades  total_r   avg_r  win_rate
2022-03         5  -5.1496 -1.0299    0.0000
2022-04         1  -1.0557 -1.0557    0.0000
2022-06         3  -2.0726 -0.6909    0.3333
2022-07         5   2.9157  0.5831    0.4000
2022-09         7   2.8339  0.4048    0.4286
2022-10         4  -0.1711 -0.0428    0.2500
2022-11         3   0.9472  0.3157    0.3333
2022-12         1  -1.0133 -1.0133    0.0000
2023-01         2  -2.0717 -1.0358    0.0000
2023-02         2   1.9394  0.9697    0.5000
2023-03         7   0.9007  0.1287    0.2857
2023-04         4  -4.1049 -1.0262    0.0000
2023-05         3   1.9934  0.6645    0.6667
2023-06         5  -3.5666 -0.7133    0.2000
2023-07         4  -3.5107 -0.8777    0.0000
2023-09         1  -1.0299 -1.0299    0.0000
2023-10         4  -0.0718 -0.0179    0.2500
2023-11         4   5.3813  1.3453    0.7500
2023-12         2  -2.0410 -1.0205    0.0000
2024-01         2  -2.0821 -1.0410    0.0000
2024-02         7  -7.2285 -1.0326    0.0000
2024-03         1  -1.0292 -1.0292    0.0000
2024-04         2  -2.1270 -1.0635    0.0000
2024-06         1  -1.0184 -1.0184    0.0000
2024-07         9   7.6894  0.8544    0.4444
2024-08         2  -2.0315 -1.0158    0.0000
2024-09         5   1.3202  0.2640    0.4000
2024-10         2  -2.1563 -1.0781    0.0000
2024-11        12  11.7859  0.9822    0.5000
2024-12         3   4.9421  1.6474    0.6667
2025-01         6   9.8833  1.6472    0.6667
2025-02         1   0.5271  0.5271    1.0000
2025-03         2  -2.0305 -1.0152    0.0000
2025-04         3  -2.2168 -0.7389    0.0000
2025-05         1   1.7364  1.7364    1.0000
2025-06         4  -1.2534 -0.3133    0.2500
2025-07        14   1.5490  0.1106    0.2857
2025-08         4   0.5517  0.1379    0.2500
2025-09         5  -1.1472 -0.2294    0.2000
2025-10         5  -1.3210 -0.2642    0.2000
2025-11         3  -1.8690 -0.6230    0.3333
2025-12         1   2.9306  2.9306    1.0000
2026-01         3   3.4468  1.1489    0.6667
2026-02         3   0.9530  0.3177    0.3333

## Artifacts

- Trades: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_tp_sweep_strict_bull_imbalance_tp3.0_20260410_201444/artifacts/trades.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_tp_sweep_strict_bull_imbalance_tp3.0_20260410_201444/artifacts/summary.csv`
- Monthly: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_tp_sweep_strict_bull_imbalance_tp3.0_20260410_201444/artifacts/monthly.csv`
