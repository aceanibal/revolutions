# FVG IMBALANCE Strategy Report (BTCUSDT)

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
BTCUSDT       202  32.7082 0.1619    0.9177     0.604   0.5941   0.3911     0.0149          7.4809

## Monthly

  month  n_trades  total_r   avg_r  win_rate
2022-03         2  -0.0706 -0.0353    0.5000
2022-04         1   0.9732  0.9732    1.0000
2022-05         2   1.9253  0.9626    1.0000
2022-06         2  -2.0257 -1.0129    0.0000
2022-07         8   1.7694  0.2212    0.6250
2022-08         2  -0.0701 -0.0350    0.5000
2022-09         4  -0.1494 -0.0374    0.5000
2022-10         4  -0.0910 -0.0228    0.5000
2022-11         2  -0.0684 -0.0342    0.5000
2022-12         1   0.9858  0.9858    1.0000
2023-01         6   2.9025  0.4838    0.8333
2023-02         2   1.9801  0.9901    1.0000
2023-03         8  -0.2013 -0.0252    0.5000
2023-04         5   0.9037  0.1807    0.6000
2023-05         3   0.6941  0.2314    0.6667
2023-06         6   2.1275  0.3546    0.6667
2023-08         1  -1.0252 -1.0252    0.0000
2023-09         1  -1.0425 -1.0425    0.0000
2023-10         9   2.7561  0.3062    0.6667
2023-11         1  -1.0132 -1.0132    0.0000
2023-12         5   4.8775  0.9755    1.0000
2024-01         5  -3.1450 -0.6290    0.2000
2024-02        13   6.4710  0.4978    0.7692
2024-03         4   1.9138  0.4784    0.7500
2024-04         3   0.7544  0.2515    0.6667
2024-05         7  -3.2347 -0.4621    0.2857
2024-06         1   0.9605  0.9605    1.0000
2024-07         8  -2.2627 -0.2828    0.3750
2024-08         3   0.8246  0.2749    0.6667
2024-09         6   1.4093  0.2349    0.6667
2024-10         8   3.4882  0.4360    0.7500
2024-11        10   1.0201  0.1020    0.6000
2024-12         3  -3.0639 -1.0213    0.0000
2025-01         5  -1.1704 -0.2341    0.4000
2025-03         6   1.7639  0.2940    0.6667
2025-04         4   1.8766  0.4691    0.7500
2025-05         7   2.6304  0.3758    0.7143
2025-06         3  -1.1892 -0.3964    0.3333
2025-07         5   4.7749  0.9550    1.0000
2025-08         3  -1.1138 -0.3713    0.3333
2025-09         3  -1.2843 -0.4281    0.3333
2025-10        10   5.6023  0.5602    0.8000
2025-11         2  -0.1646 -0.0823    0.5000
2025-12         1   0.9739  0.9739    1.0000
2026-01         7  -1.2649 -0.1807    0.4286

## Artifacts

- Trades: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_all_assets_tp1_20260410_201615/artifacts/trades.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_all_assets_tp1_20260410_201615/artifacts/summary.csv`
- Monthly: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_all_assets_tp1_20260410_201615/artifacts/monthly.csv`
