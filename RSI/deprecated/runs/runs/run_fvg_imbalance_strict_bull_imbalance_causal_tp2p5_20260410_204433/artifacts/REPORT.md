# FVG IMBALANCE Strategy Report (XRPUSDT)

## Strategy

- Long only on strict bullish FVG when context is bullish IMBALANCE.
- Stop anchored at FVG lower boundary, TP fixed at `tp_r * risk`.
- 5m replay after HTF close (`replay_from_ts = entry_ts + tf`), conservative same-bar resolution (SL before TP).

## Config

- Window: `2022-03-01T00:00:00+00:00 -> 2026-03-01T00:00:00+00:00`
- TF: `1h` | ATR period: `14` | lookback: `20`
- Strict FVG: `min_gap_bps=5.0`, `disp_q=0.85`, `disp_lb=120`
- TP R: `2.5` | max hold (5m bars): `576` | fee bps: `3.0`
- Overlap allowed: `False`

## Summary

 symbol  n_trades  total_r  avg_r  median_r  win_rate  tp_rate  sl_rate  time_rate  max_drawdown_r
XRPUSDT       178   1.1253 0.0063   -1.0108    0.3146    0.264   0.6573     0.0787         23.0542

## Monthly

  month  n_trades  total_r   avg_r  win_rate
2022-03         5  -1.6496 -0.3299    0.2000
2022-04         1  -1.0557 -1.0557    0.0000
2022-06         3  -2.1216 -0.7072    0.0000
2022-07         5   1.9157  0.3831    0.4000
2022-08         1  -1.0052 -1.0052    0.0000
2022-09         7   3.3827  0.4832    0.4286
2022-10         5  -1.7424 -0.3485    0.2000
2022-11         4   2.8905  0.7226    0.5000
2022-12         1  -1.0133 -1.0133    0.0000
2023-01         2   1.4283  0.7142    0.5000
2023-02         2   1.4541  0.7271    0.5000
2023-03         7  -0.0993 -0.0142    0.2857
2023-04         4  -4.1049 -1.0262    0.0000
2023-05         3   1.5318  0.5106    0.6667
2023-06         5  -3.7270 -0.7454    0.2000
2023-07         4  -3.4255 -0.8564    0.0000
2023-09         1  -1.0299 -1.0299    0.0000
2023-10         4  -0.5718 -0.1429    0.2500
2023-11         4   4.3813  1.0953    0.7500
2023-12         2  -2.0410 -1.0205    0.0000
2024-01         2  -2.0821 -1.0410    0.0000
2024-02         7  -3.7285 -0.5326    0.1429
2024-03         1  -1.0292 -1.0292    0.0000
2024-04         2  -2.1270 -1.0635    0.0000
2024-06         1  -1.0184 -1.0184    0.0000
2024-07         9   5.6314  0.6257    0.4444
2024-08         2  -2.0315 -1.0158    0.0000
2024-09         5  -1.7924 -0.3585    0.2000
2024-10         2  -2.1563 -1.0781    0.0000
2024-11        14  10.2705  0.7336    0.5000
2024-12         5   1.9304  0.3861    0.4000
2025-01         7   3.3685  0.4812    0.4286
2025-02         1   0.5393  0.5393    1.0000
2025-03         2  -2.0305 -1.0152    0.0000
2025-04         3  -1.9608 -0.6536    0.3333
2025-05         1   1.9111  1.9111    1.0000
2025-06         4  -0.9768 -0.2442    0.2500
2025-07        15   2.0129  0.1342    0.3333
2025-08         4  -0.0600 -0.0150    0.2500
2025-09         5  -1.6472 -0.3294    0.2000
2025-10         5  -1.8210 -0.3642    0.2000
2025-11         3   1.6976  0.5659    0.6667
2025-12         2   1.3731  0.6866    0.5000
2026-01         3   3.0019  1.0006    0.6667
2026-02         3   0.4530  0.1510    0.3333

## Artifacts

- Trades (artifact): `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_causal_tp2p5_20260410_204433/artifacts/trades.csv`
- Trades (UI tp): `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_causal_tp2p5_20260410_204433/trades/trade_details_v1fix_tp2p5.csv`
- Trades (UI all): `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_causal_tp2p5_20260410_204433/trades/trade_details_v1fix_all_tp.csv`
- Replay audit (UI): `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_causal_tp2p5_20260410_204433/trades/replay_audit_v1fix.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_causal_tp2p5_20260410_204433/artifacts/summary.csv`
- Monthly: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_causal_tp2p5_20260410_204433/artifacts/monthly.csv`
