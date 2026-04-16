# FVG IMBALANCE Strategy Report (XRPUSDT)

## Strategy

- Long only on strict bullish FVG when context is bullish IMBALANCE.
- Stop anchored at FVG lower boundary, TP fixed at `tp_r * risk`.
- 5m replay, conservative same-bar resolution (SL before TP).

## Config

- Window: `2022-03-01T00:00:00+00:00 -> 2026-03-01T00:00:00+00:00`
- TF: `1h` | ATR period: `14` | lookback: `20`
- Strict FVG: `min_gap_bps=5.0`, `disp_q=0.85`, `disp_lb=120`
- TP R: `4.0` | max hold (5m bars): `576` | fee bps: `3.0`
- Overlap allowed: `False`

## Summary

 symbol  n_trades  total_r  avg_r  median_r  win_rate  tp_rate  sl_rate  time_rate  max_drawdown_r
XRPUSDT       164   31.738 0.1935   -1.0134    0.2866   0.2073    0.689     0.1037         24.5123

## Monthly

  month  n_trades  total_r   avg_r  win_rate
2022-03         5  -5.1496 -1.0299    0.0000
2022-04         1  -1.0557 -1.0557    0.0000
2022-06         3  -2.0726 -0.6909    0.3333
2022-07         5   3.8010  0.7602    0.4000
2022-09         6   5.8384  0.9731    0.5000
2022-10         4  -4.1711 -1.0428    0.0000
2022-11         3   1.9472  0.6491    0.3333
2022-12         1  -1.0133 -1.0133    0.0000
2023-01         2  -2.0717 -1.0358    0.0000
2023-02         2   2.9394  1.4697    0.5000
2023-03         7   2.8888  0.4127    0.2857
2023-04         4  -4.1049 -1.0262    0.0000
2023-05         3   2.9934  0.9978    0.6667
2023-06         5  -3.5666 -0.7133    0.2000
2023-07         4  -3.5107 -0.8777    0.0000
2023-09         1  -1.0299 -1.0299    0.0000
2023-10         4   0.9282  0.2321    0.2500
2023-11         3   3.3938  1.1313    0.6667
2023-12         2  -2.0410 -1.0205    0.0000
2024-01         2  -2.0821 -1.0410    0.0000
2024-02         7  -7.2285 -1.0326    0.0000
2024-03         1  -1.0292 -1.0292    0.0000
2024-04         2  -2.1270 -1.0635    0.0000
2024-06         1  -1.0184 -1.0184    0.0000
2024-07         8   7.7057  0.9632    0.3750
2024-08         2  -2.0315 -1.0158    0.0000
2024-09         5  -2.6798 -0.5360    0.2000
2024-10         2  -2.1563 -1.0781    0.0000
2024-11        12  17.7859  1.4822    0.5000
2024-12         3   6.9421  2.3140    0.6667
2025-01         8  15.4473  1.9309    0.6250
2025-02         1   0.5271  0.5271    1.0000
2025-03         2  -2.0305 -1.0152    0.0000
2025-04         3  -2.2168 -0.7389    0.0000
2025-05         1   1.7364  1.7364    1.0000
2025-06         4  -1.2534 -0.3133    0.2500
2025-07        13   1.5675  0.1206    0.2308
2025-08         3   1.9299  0.6433    0.3333
2025-09         5  -0.1472 -0.0294    0.2000
2025-10         5  -0.3210 -0.0642    0.2000
2025-11         3  -1.8690 -0.6230    0.3333
2025-12         1   3.9306  3.9306    1.0000
2026-01         2   5.4599  2.7300    1.0000
2026-02         3   1.9530  0.6510    0.3333

## Artifacts

- Trades: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_tp_sweep_strict_bull_imbalance_tp4.0_20260410_201446/artifacts/trades.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_tp_sweep_strict_bull_imbalance_tp4.0_20260410_201446/artifacts/summary.csv`
- Monthly: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_tp_sweep_strict_bull_imbalance_tp4.0_20260410_201446/artifacts/monthly.csv`
