# FVG IMBALANCE Strategy Report (XRPUSDT)

## Strategy

- Long only on strict bullish FVG when context is bullish IMBALANCE.
- Stop anchored at FVG lower boundary, TP fixed at `tp_r * risk`.
- 5m replay after HTF close (`replay_from_ts = entry_ts + tf`), conservative same-bar resolution (SL before TP).

## Config

- Window: `2022-03-01T00:00:00+00:00 -> 2026-03-01T00:00:00+00:00`
- TF: `1h` | ATR period: `14` | lookback: `20`
- Strict FVG: `min_gap_bps=5.0`, `disp_q=0.85`, `disp_lb=120`
- TP R: `2.0` | max hold (5m bars): `576` | fee bps: `3.0`
- Overlap allowed: `False`

## Summary

 symbol  n_trades  total_r  avg_r  median_r  win_rate  tp_rate  sl_rate  time_rate  max_drawdown_r
XRPUSDT       182   4.5049 0.0248   -1.0089    0.3626   0.3242   0.6154     0.0604         22.0154

## Monthly

  month  n_trades  total_r   avg_r  win_rate
2022-03         5  -2.1496 -0.4299    0.2000
2022-04         1  -1.0557 -1.0557    0.0000
2022-06         3  -2.1216 -0.7072    0.0000
2022-07         6   2.8888  0.4815    0.5000
2022-08         1  -1.0052 -1.0052    0.0000
2022-09         7   1.8827  0.2690    0.4286
2022-10         5  -2.2424 -0.4485    0.2000
2022-11         4   1.8905  0.4726    0.5000
2022-12         1  -1.0133 -1.0133    0.0000
2023-01         2   0.9283  0.4642    0.5000
2023-02         2   0.9541  0.4771    0.5000
2023-03         7  -1.0993 -0.1570    0.2857
2023-04         4  -4.1049 -1.0262    0.0000
2023-05         5   2.0069  0.4014    0.6000
2023-06         4  -4.0618 -1.0155    0.0000
2023-07         4  -3.4255 -0.8564    0.0000
2023-09         2   0.9165  0.4582    0.5000
2023-10         4  -1.0718 -0.2679    0.2500
2023-11         4   3.3813  0.8453    0.7500
2023-12         2   0.9590  0.4795    0.5000
2024-01         2  -2.0821 -1.0410    0.0000
2024-02         7  -4.2285 -0.6041    0.1429
2024-03         1  -1.0292 -1.0292    0.0000
2024-04         2  -2.1270 -1.0635    0.0000
2024-06         1  -1.0184 -1.0184    0.0000
2024-07        10   7.7539  0.7754    0.6000
2024-08         2  -2.0315 -1.0158    0.0000
2024-09         5  -2.2924 -0.4585    0.2000
2024-10         2  -2.1563 -1.0781    0.0000
2024-11        15   8.7646  0.5843    0.5333
2024-12         5   0.9304  0.1861    0.4000
2025-01         7   1.8729  0.2676    0.4286
2025-02         1   0.5393  0.5393    1.0000
2025-03         2  -2.0305 -1.0152    0.0000
2025-04         3  -1.9608 -0.6536    0.3333
2025-05         1   1.9881  1.9881    1.0000
2025-06         5   3.9511  0.7902    0.6000
2025-07        13   4.7069  0.3621    0.4615
2025-08         4   2.4400  0.6100    0.5000
2025-09         5  -2.1472 -0.4294    0.2000
2025-10         5  -2.3210 -0.4642    0.2000
2025-11         3   1.1976  0.3992    0.6667
2025-12         2   0.8731  0.4366    0.5000
2026-01         3   2.5019  0.8340    0.6667
2026-02         3  -0.0470 -0.0157    0.3333

## Artifacts

- Trades (artifact): `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_causal_tp2p0_20260410_204433/artifacts/trades.csv`
- Trades (UI tp): `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_causal_tp2p0_20260410_204433/trades/trade_details_v1fix_tp2p0.csv`
- Trades (UI all): `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_causal_tp2p0_20260410_204433/trades/trade_details_v1fix_all_tp.csv`
- Replay audit (UI): `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_causal_tp2p0_20260410_204433/trades/replay_audit_v1fix.csv`
- Summary: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_causal_tp2p0_20260410_204433/artifacts/summary.csv`
- Monthly: `/Users/anibalperez/revolutions/RSI/runs/run_fvg_imbalance_strict_bull_imbalance_causal_tp2p0_20260410_204433/artifacts/monthly.csv`
