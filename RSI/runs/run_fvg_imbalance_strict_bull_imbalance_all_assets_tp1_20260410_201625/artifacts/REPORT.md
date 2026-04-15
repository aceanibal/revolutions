# FVG IMBALANCE Strategy Report (SOLUSDT)

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
SOLUSDT       212   34.545 0.1629    0.9585    0.5896   0.5849   0.3962     0.0189         10.3989

## Monthly

  month  n_trades  total_r   avg_r  win_rate
2022-03         7   4.8224  0.6889    0.8571
2022-04         1  -1.0227 -1.0227    0.0000
2022-05         1   0.8923  0.8923    1.0000
2022-06         4  -0.0428 -0.0107    0.5000
2022-07         8  -2.1136 -0.2642    0.3750
2022-08         2  -0.0434 -0.0217    0.5000
2022-09         4  -0.0645 -0.0161    0.5000
2022-10         4  -0.1139 -0.0285    0.5000
2022-11         4   0.9666  0.2417    0.7500
2022-12         2  -0.0500 -0.0250    0.5000
2023-01        12   1.8692  0.1558    0.5833
2023-02         4  -0.0475 -0.0119    0.5000
2023-03         1   0.9948  0.9948    1.0000
2023-04         6  -0.1759 -0.0293    0.5000
2023-05         2  -0.0446 -0.0223    0.5000
2023-06         4  -0.0990 -0.0247    0.5000
2023-07         3  -3.0176 -1.0059    0.0000
2023-09         4   1.8489  0.4622    0.7500
2023-10         9   5.2383  0.5820    0.7778
2023-11        12   3.8304  0.3192    0.6667
2023-12        16   5.7486  0.3593    0.6875
2024-01         3  -1.0701 -0.3567    0.3333
2024-02         5  -3.1225 -0.6245    0.2000
2024-03         6  -0.1063 -0.0177    0.5000
2024-04         1   0.9605  0.9605    1.0000
2024-05         5   0.8677  0.1735    0.6000
2024-06         2   1.8783  0.9391    1.0000
2024-07         5  -1.0922 -0.2184    0.4000
2024-08         5   0.8714  0.1743    0.6000
2024-09         4   0.8833  0.2208    0.5000
2024-10         6  -0.1250 -0.0208    0.5000
2024-11         4   1.8638  0.4659    0.7500
2025-01         5   2.8576  0.5715    0.8000
2025-03         2   1.9731  0.9866    1.0000
2025-04         3   2.8234  0.9411    1.0000
2025-05         7   0.8351  0.1193    0.5714
2025-06         4  -4.1012 -1.0253    0.0000
2025-07         9  -3.2057 -0.3562    0.3333
2025-08         7   1.8145  0.2592    0.5714
2025-09         6   1.8718  0.3120    0.6667
2025-10         3   0.9036  0.3012    0.6667
2025-11         1   0.9433  0.9433    1.0000
2025-12         2  -0.0369 -0.0184    0.5000
2026-01         4   3.7464  0.9366    1.0000
2026-02         3   2.9350  0.9783    1.0000

## Artifacts

- Trades: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_all_assets_tp1_20260410_201625/artifacts/trades.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_all_assets_tp1_20260410_201625/artifacts/summary.csv`
- Monthly: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_all_assets_tp1_20260410_201625/artifacts/monthly.csv`
