# PAXG Smoke Test — Final Report
Run folder: `runs/paxg_smoke/run_all_streams_20260416T163424Z`

Universe: `PAXGUSDT` only.

## Portfolio Total

| n_trades | win_pct | avg_r | median_r | total_r | best_r | worst_r | maxDD_r | mcl | baseline_total_r | saved_r | sl_hits | be_hits | tp_hits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 149.00 | 23.49 | 0.8417 | -1.05 | 125.41 | 19.45 | -1.32 | 22.68 | 11.00 | 162.41 | -37.00 | 114.00 | 3.00 | 32.00 |
## By Stream

| stream | n_trades | win_pct | avg_r | median_r | total_r | best_r | worst_r | maxDD_r | mcl | baseline_total_r | saved_r | sl_hits | be_hits | tp_hits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | 57 | 19.30 | 1.44 | -1.05 | 82.20 | 11.97 | -1.12 | 12.93 | 12 | 82.20 | 0.0000 | 46 | 0 | 11 |
| S2 | 73 | 21.92 | -0.2000 | -1.06 | -14.60 | 2.99 | -1.21 | 19.19 | 10 | -14.60 | 0.0000 | 57 | 0 | 16 |
| S3 | 5 | 40.00 | 1.02 | -1.01 | 5.08 | 4.22 | -1.32 | 2.33 | 2 | 5.08 | 0.0000 | 3 | 0 | 2 |
| S4 | 14 | 42.86 | 3.77 | -1.03 | 52.74 | 19.45 | -1.08 | 5.48 | 4 | 89.74 | -37.00 | 8 | 3 | 3 |
## By Year

| year | n_trades | win_pct | avg_r | median_r | total_r | best_r | worst_r | maxDD_r | mcl | baseline_total_r | saved_r | sl_hits | be_hits | tp_hits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2025.00 | 131.00 | 22.14 | 0.4608 | -1.06 | 60.37 | 19.42 | -1.32 | 22.68 | 11.00 | 97.37 | -37.00 | 102.00 | 3.00 | 26.00 |
| 2026.00 | 18.00 | 33.33 | 3.61 | -1.04 | 65.04 | 19.45 | -1.08 | 6.32 | 6.00 | 65.04 | 0.0000 | 12.00 | 0.0000 | 6.00 |
## Saved R (Managed vs Baseline)

| stream | n_trades | baseline_total_r | managed_total_r | saved_r | saved_per_trade | n_improved | n_worse | n_unchanged | avg_save_improved | avg_hurt_worse | baseline_win_pct | managed_win_pct |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | 57 | 82.20 | 82.20 | 0.0000 | 0.0000 | 0 | 0 | 57 | 0.0000 | 0.0000 | 19.30 | 19.30 |
| S2 | 73 | -14.60 | -14.60 | 0.0000 | 0.0000 | 0 | 0 | 73 | 0.0000 | 0.0000 | 21.92 | 21.92 |
| S3 | 5 | 5.08 | 5.08 | 0.0000 | 0.0000 | 0 | 0 | 5 | 0.0000 | 0.0000 | 40.00 | 40.00 |
| S4 | 14 | 89.74 | 52.74 | -37.00 | -2.64 | 0 | 2 | 12 | 0.0000 | -18.50 | 42.86 | 42.86 |
## Smoke Test Readout

- Trades: 149
- Total R: 125.41
- Win rate: 23.49%
- MaxDD: 22.68R
- Saved R from management: -37.00R (S4 only)
