# FVG IMBALANCE Strategy Report (XRPUSDT)

## Strategy

- Long only on strict bullish FVG when context is bullish IMBALANCE.
- Stop anchored at FVG lower boundary, TP fixed at `tp_r * risk`.
- 5m replay, conservative same-bar resolution (SL before TP).

## Config

- Window: `2022-03-01T00:00:00+00:00 -> 2026-03-01T00:00:00+00:00`
- TF: `1h` | ATR period: `14` | lookback: `20`
- Strict FVG: `min_gap_bps=5.0`, `disp_q=0.85`, `disp_lb=120`
- TP R: `2.0` | max hold (5m bars): `576` | fee bps: `3.0`
- Overlap allowed: `False`

## Summary

 symbol  n_trades  total_r  avg_r  median_r  win_rate  tp_rate  sl_rate  time_rate  max_drawdown_r
XRPUSDT       182  18.8755 0.1037   -1.0077    0.3901   0.3516   0.5879     0.0604         14.1707

## Monthly

  month  n_trades  total_r   avg_r  win_rate
2022-03         5  -2.1496 -0.4299    0.2000
2022-04         1  -1.0557 -1.0557    0.0000
2022-06         3  -2.0726 -0.6909    0.3333
2022-07         6   2.8888  0.4815    0.5000
2022-08         1  -1.0052 -1.0052    0.0000
2022-09         7   1.8827  0.2690    0.4286
2022-10         5   0.7576  0.1515    0.4000
2022-11         4   1.8905  0.4726    0.5000
2022-12         1  -1.0133 -1.0133    0.0000
2023-01         2   0.9283  0.4642    0.5000
2023-02         2   0.9541  0.4771    0.5000
2023-03         7  -1.0993 -0.1570    0.2857
2023-04         4  -4.1049 -1.0262    0.0000
2023-05         5   1.9684  0.3937    0.6000
2023-06         4  -4.0618 -1.0155    0.0000
2023-07         4  -0.5107 -0.1277    0.2500
2023-09         2   0.9165  0.4582    0.5000
2023-10         4  -1.0718 -0.2679    0.2500
2023-11         4   3.3813  0.8453    0.7500
2023-12         2   0.9590  0.4795    0.5000
2024-01         2  -2.0821 -1.0410    0.0000
2024-02         7  -4.2285 -0.6041    0.1429
2024-03         1  -1.0292 -1.0292    0.0000
2024-04         2   0.8730  0.4365    0.5000
2024-06         1  -1.0184 -1.0184    0.0000
2024-07        10   7.7539  0.7754    0.6000
2024-08         2  -2.0315 -1.0158    0.0000
2024-09         5   0.7076  0.1415    0.4000
2024-10         2  -2.1563 -1.0781    0.0000
2024-11        15   8.7646  0.5843    0.5333
2024-12         5   0.9304  0.1861    0.4000
2025-01         7   4.8729  0.6961    0.5714
2025-02         1   0.5271  0.5271    1.0000
2025-03         2  -2.0305 -1.0152    0.0000
2025-04         3  -2.2168 -0.7389    0.0000
2025-05         1   1.9881  1.9881    1.0000
2025-06         5   3.6745  0.7349    0.6000
2025-07        13   4.7069  0.3621    0.4615
2025-08         4   2.5517  0.6379    0.5000
2025-09         5  -2.1472 -0.4294    0.2000
2025-10         5  -2.3210 -0.4642    0.2000
2025-11         3   1.1310  0.3770    0.6667
2025-12         2   0.8731  0.4366    0.5000
2026-01         3   2.4468  0.8156    0.6667
2026-02         3  -0.0470 -0.0157    0.3333

## Artifacts

- Trades: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_20260410_201333/artifacts/trades.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_20260410_201333/artifacts/summary.csv`
- Monthly: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_20260410_201333/artifacts/monthly.csv`
