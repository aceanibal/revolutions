# FVG IMBALANCE TP sweep (XRPUSDT, 1h, 48m, causal replay)

Win rate = fraction of trades with `managed_r > 0`. TP rate = exits tagged TP (full tp_r hit).

| tp_r | n_trades | total_r | avg_r | median_r | win_rate | tp_rate | sl_rate | time_rate | max_drawdown_r | run_id |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1.0 | 218 | 19.264709 | 0.088370 | 0.934478 | 0.559633 | 0.545872 | 0.431193 | 0.022936 | 18.173292 | `run_fvg_imbalance_strict_bull_imbalance_causal_tp1p0_20260410_204433` |
| 1.5 | 198 | 6.372357 | 0.032184 | -1.006450 | 0.429293 | 0.404040 | 0.550505 | 0.045455 | 24.542848 | `run_fvg_imbalance_strict_bull_imbalance_causal_tp1p5_20260410_204433` |
| 2.0 | 182 | 4.504890 | 0.024752 | -1.008877 | 0.362637 | 0.324176 | 0.615385 | 0.060440 | 22.015382 | `run_fvg_imbalance_strict_bull_imbalance_causal_tp2p0_20260410_204433` |
| 2.5 | 178 | 1.125338 | 0.006322 | -1.010794 | 0.314607 | 0.264045 | 0.657303 | 0.078652 | 23.054176 | `run_fvg_imbalance_strict_bull_imbalance_causal_tp2p5_20260410_204433` |
| 3.0 | 168 | 4.304196 | 0.025620 | -1.012030 | 0.291667 | 0.226190 | 0.678571 | 0.095238 | 24.554176 | `run_fvg_imbalance_strict_bull_imbalance_causal_tp3p0_20260410_204433` |
| 4.0 | 164 | 13.862690 | 0.084529 | -1.014508 | 0.262195 | 0.182927 | 0.713415 | 0.103659 | 24.549050 | `run_fvg_imbalance_strict_bull_imbalance_causal_tp4p0_20260410_204433` |

- Best by total_r: tp_r=1.0 total_r=19.2647 avg_r=0.0884
- Best by avg_r: tp_r=1.0 total_r=19.2647 avg_r=0.0884

- Aggregate CSV: `/Users/anibalperez/revolutions/RSI/cache/fvg_imbalance_tp_sweep_summary.csv`
