# FVG IMBALANCE Strategy Report (XRPUSDT)

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
XRPUSDT       221  61.5972 0.2787    0.9608    0.6561   0.6425   0.3394     0.0181          6.9344

## Monthly

  month  n_trades  total_r   avg_r  win_rate
2022-03         5  -3.1496 -0.6299    0.2000
2022-04         1  -1.0557 -1.0557    0.0000
2022-05         1   0.9904  0.9904    1.0000
2022-06         2   1.8929  0.9465    1.0000
2022-07         6   1.8888  0.3148    0.6667
2022-08         1  -1.0052 -1.0052    0.0000
2022-09         9   2.8643  0.3183    0.6667
2022-10         5   2.7576  0.5515    0.8000
2022-11         4  -0.1095 -0.0274    0.5000
2022-12         1   0.9867  0.9867    1.0000
2023-01         2  -0.0717 -0.0358    0.5000
2023-02         3   2.9238  0.9746    1.0000
2023-03        10  -0.1462 -0.0146    0.5000
2023-04         4  -2.1049 -0.5262    0.2500
2023-05         6   0.9434  0.1572    0.6667
2023-06         4  -0.0618 -0.0155    0.5000
2023-07         6  -0.0617 -0.0103    0.5000
2023-09         2   1.9165  0.9582    1.0000
2023-10         4  -0.0718 -0.0179    0.5000
2023-11         4   1.3873  0.3468    0.7500
2023-12         3   0.9371  0.3124    0.6667
2024-01         2  -0.0821 -0.0410    0.5000
2024-02        10  -4.2970 -0.4297    0.3000
2024-03         1   0.9708  0.9708    1.0000
2024-04         2  -0.1270 -0.0635    0.5000
2024-06         1  -1.0184 -1.0184    0.0000
2024-07        12   9.7272  0.8106    0.9167
2024-08         2  -2.0315 -1.0158    0.0000
2024-09         6   3.6203  0.6034    0.8333
2024-10         2  -0.1563 -0.0781    0.5000
2024-11        19   6.7310  0.3543    0.6842
2024-12         6   1.9273  0.3212    0.6667
2025-01        11   4.7609  0.4328    0.7273
2025-02         2  -0.0181 -0.0090    0.5000
2025-03         2  -2.0305 -1.0152    0.0000
2025-04         4   3.8784  0.9696    1.0000
2025-05         1   0.9881  0.9881    1.0000
2025-06         6   5.8039  0.9673    1.0000
2025-07        18  13.4688  0.7483    0.8889
2025-08         5   1.4719  0.2944    0.6000
2025-09         5  -3.1472 -0.6294    0.2000
2025-10         5  -1.3210 -0.2642    0.4000
2025-11         4  -0.8873 -0.2218    0.5000
2025-12         2   1.8731  0.9366    1.0000
2026-01         5   4.9307  0.9861    1.0000
2026-02         5   4.9103  0.9821    1.0000

## Artifacts

- Trades: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_tp_sweep_strict_bull_imbalance_tp1.0_20260410_201436/artifacts/trades.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_tp_sweep_strict_bull_imbalance_tp1.0_20260410_201436/artifacts/summary.csv`
- Monthly: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_tp_sweep_strict_bull_imbalance_tp1.0_20260410_201436/artifacts/monthly.csv`
