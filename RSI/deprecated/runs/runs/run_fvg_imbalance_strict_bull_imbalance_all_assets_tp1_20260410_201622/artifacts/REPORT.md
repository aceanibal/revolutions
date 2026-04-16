# FVG IMBALANCE Strategy Report (LINKUSDT)

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
LINKUSDT       190  33.5467 0.1766    0.9365    0.6053   0.5842   0.3842     0.0316          7.2742

## Monthly

  month  n_trades  total_r   avg_r  win_rate
2022-03         3  -1.0730 -0.3577    0.3333
2022-05         3  -1.0652 -0.3551    0.3333
2022-06         4  -0.0931 -0.0233    0.5000
2022-07        11   7.2891  0.6626    0.8182
2022-08         3   2.9518  0.9839    1.0000
2022-09         6  -0.3959 -0.0660    0.5000
2022-10         1   0.9856  0.9856    1.0000
2022-11         3   0.1371  0.0457    0.6667
2023-01         2  -0.0252 -0.0126    0.5000
2023-02         2   1.0361  0.5180    1.0000
2023-03         3   0.8999  0.3000    0.6667
2023-04         6   1.7704  0.2951    0.6667
2023-05         3   0.8018  0.2673    0.6667
2023-06         3   2.9111  0.9704    1.0000
2023-07         5   2.8908  0.5782    0.8000
2023-08         2   1.9307  0.9653    1.0000
2023-09         7  -3.2195 -0.4599    0.2857
2023-10         7   2.9278  0.4183    0.7143
2023-11         6   1.8901  0.3150    0.6667
2023-12         5  -1.1421 -0.2284    0.4000
2024-01         2  -2.0310 -1.0155    0.0000
2024-02         6  -2.1025 -0.3504    0.3333
2024-03         3   0.9171  0.3057    0.6667
2024-04         2  -0.0247 -0.0124    0.5000
2024-05         4  -0.8046 -0.2011    0.5000
2024-07         3   0.9027  0.3009    0.6667
2024-08         2   1.9716  0.9858    1.0000
2024-09         8  -0.3168 -0.0396    0.5000
2024-10         3   0.6760  0.2253    0.6667
2024-11        11   4.7689  0.4335    0.7273
2024-12         7   2.8616  0.4088    0.7143
2025-01         5   1.5089  0.3018    0.6000
2025-03         4  -2.1251 -0.5313    0.2500
2025-04         6   1.8294  0.3049    0.6667
2025-05         7   0.8801  0.1257    0.5714
2025-06         6  -2.1447 -0.3575    0.3333
2025-07         8   1.8893  0.2362    0.6250
2025-08         5   0.9560  0.1912    0.6000
2025-09         2  -0.0540 -0.0270    0.5000
2025-10         2  -0.1383 -0.0691    0.5000
2025-11         1   0.9577  0.9577    1.0000
2025-12         1   0.9858  0.9858    1.0000
2026-01         6  -0.2157 -0.0360    0.5000
2026-02         1   0.9908  0.9908    1.0000

## Artifacts

- Trades: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_all_assets_tp1_20260410_201622/artifacts/trades.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_all_assets_tp1_20260410_201622/artifacts/summary.csv`
- Monthly: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_all_assets_tp1_20260410_201622/artifacts/monthly.csv`
