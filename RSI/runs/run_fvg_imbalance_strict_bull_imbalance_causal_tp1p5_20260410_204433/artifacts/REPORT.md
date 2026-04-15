# FVG IMBALANCE Strategy Report (XRPUSDT)

## Strategy

- Long only on strict bullish FVG when context is bullish IMBALANCE.
- Stop anchored at FVG lower boundary, TP fixed at `tp_r * risk`.
- 5m replay after HTF close (`replay_from_ts = entry_ts + tf`), conservative same-bar resolution (SL before TP).

## Config

- Window: `2022-03-01T00:00:00+00:00 -> 2026-03-01T00:00:00+00:00`
- TF: `1h` | ATR period: `14` | lookback: `20`
- Strict FVG: `min_gap_bps=5.0`, `disp_q=0.85`, `disp_lb=120`
- TP R: `1.5` | max hold (5m bars): `576` | fee bps: `3.0`
- Overlap allowed: `False`

## Summary

 symbol  n_trades  total_r  avg_r  median_r  win_rate  tp_rate  sl_rate  time_rate  max_drawdown_r
XRPUSDT       198   6.3724 0.0322   -1.0065    0.4293    0.404   0.5505     0.0455         24.5428

## Monthly

  month  n_trades  total_r   avg_r  win_rate
2022-03         5  -2.6496 -0.5299    0.2000
2022-04         1  -1.0557 -1.0557    0.0000
2022-06         3  -2.1216 -0.7072    0.0000
2022-07         6   1.3888  0.2315    0.5000
2022-08         1  -1.0052 -1.0052    0.0000
2022-09         8   1.8730  0.2341    0.5000
2022-10         5   2.2576  0.4515    0.6000
2022-11         4   0.8905  0.2226    0.5000
2022-12         1  -1.0133 -1.0133    0.0000
2023-01         2   0.4283  0.2142    0.5000
2023-02         2   0.4541  0.2271    0.5000
2023-03         9   0.8585  0.0954    0.4444
2023-04         4  -4.1049 -1.0262    0.0000
2023-05         6  -0.0181 -0.0030    0.5000
2023-06         4  -4.0618 -1.0155    0.0000
2023-07         4  -3.4255 -0.8564    0.0000
2023-09         2   0.4165  0.2082    0.5000
2023-10         4  -1.5718 -0.3929    0.2500
2023-11         4   2.3873  0.5968    0.7500
2023-12         3  -0.5629 -0.1876    0.3333
2024-01         2  -2.0821 -1.0410    0.0000
2024-02         9  -4.2832 -0.4759    0.2222
2024-03         1  -1.0292 -1.0292    0.0000
2024-04         2  -2.1270 -1.0635    0.0000
2024-06         1  -1.0184 -1.0184    0.0000
2024-07        10   7.2580  0.7258    0.7000
2024-08         2  -2.0315 -1.0158    0.0000
2024-09         5  -0.2924 -0.0585    0.4000
2024-10         2  -2.1563 -1.0781    0.0000
2024-11        17   2.7525  0.1619    0.4706
2024-12         5  -0.0696 -0.0139    0.4000
2025-01         8   4.3543  0.5443    0.6250
2025-02         1   0.5393  0.5393    1.0000
2025-03         2  -2.0305 -1.0152    0.0000
2025-04         4  -0.5392 -0.1348    0.5000
2025-05         1   1.4881  1.4881    1.0000
2025-06         5   5.7062  1.1412    0.8000
2025-07        16   6.1465  0.3842    0.5625
2025-08         4   1.4400  0.3600    0.5000
2025-09         5  -2.6472 -0.5294    0.2000
2025-10         5  -0.3210 -0.0642    0.4000
2025-11         4  -0.3207 -0.0802    0.5000
2025-12         2   0.3731  0.1866    0.5000
2026-01         3   4.4703  1.4901    1.0000
2026-02         4   3.4279  0.8570    0.7500

## Artifacts

- Trades (artifact): `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_causal_tp1p5_20260410_204433/artifacts/trades.csv`
- Trades (UI tp): `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_causal_tp1p5_20260410_204433/trades/trade_details_v1fix_tp1p5.csv`
- Trades (UI all): `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_causal_tp1p5_20260410_204433/trades/trade_details_v1fix_all_tp.csv`
- Replay audit (UI): `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_causal_tp1p5_20260410_204433/trades/replay_audit_v1fix.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_causal_tp1p5_20260410_204433/artifacts/summary.csv`
- Monthly: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_causal_tp1p5_20260410_204433/artifacts/monthly.csv`
