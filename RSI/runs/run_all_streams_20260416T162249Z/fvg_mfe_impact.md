# FVG + MFE-Lock Impact Report

Run: `run_all_streams_20260416T162249Z`

## Mechanism Map

| stream | regime | stop | filter | active management |
| --- | --- | --- | --- | --- |
| S1 | IMBAL+HIGH Long  | ATR×2.0 below entry | none | none |
| S2 | BAL+HIGH Short   | ATR×1.5 above entry | none | none |
| S3 | BAL+HIGH Short   | FVG-LOW + ATR×0.15  | **FVG required** | none |
| S4 | BAL+HIGH Long    | ATR×2.0 below entry | equal-lows sweep ≥0.90 rejection | **BE lock @ 3.5R → +1R** |

S3 and S4 are the only streams with an active mechanism; this report
isolates what each one contributes.

## S3 FVG stop placement (same signals, FVG-LOW vs ATR×2)

| label | n | win_pct | total_r | avg_r | maxDD_r | sl | tp | be |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FVG-LOW stop (live S3) | 226 | 29.65 | 142.27 | 0.63 | 9.67 | 159 | 67 | 0 |
| ATR x2 stop (same signals) | 226 | 30.53 | 133.36 | 0.59 | 12.97 | 157 | 69 | 0 |
| Δ FVG stop saves (total_R_A − total_R_B) | 226 | 0.00 | 8.92 | 0.04 | 0.00 | 0 | 0 | 0 |


## S3 FVG filter (FVG-only vs no filter, ATR stop)

| label | n | win_pct | total_r | avg_r | maxDD_r | sl | tp | be |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FVG-only (live S3) | 226 | 29.65 | 142.27 | 0.63 | 9.67 | 159 | 67 | 0 |
| No FVG filter (ATR stop, all BAL shorts) | 1078 | 22.73 | 193.57 | 0.18 | 43.60 | 833 | 245 | 0 |
| Δ FVG filter impact (total_R_A − total_R_C) | -852 | 0.00 | -51.30 | 0.00 | 0.00 | 0 | 0 | 0 |


## S3 FVG stop — per year

| year | n | fvg_total_r | atr_total_r | saved_r | fvg_win_pct | atr_win_pct | fvg_maxDD | atr_maxDD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2022 | 56 | 37.83 | 43.18 | -5.35 | 30.36 | 33.93 | 7.57 | 5.05 |
| 2023 | 23 | 10.91 | 13.41 | -2.50 | 26.09 | 30.43 | 4.29 | 6.11 |
| 2024 | 49 | 9.40 | 8.06 | 1.34 | 22.45 | 22.45 | 7.97 | 10.00 |
| 2025 | 91 | 74.95 | 60.07 | 14.88 | 32.97 | 31.87 | 6.34 | 7.08 |
| 2026 | 7 | 9.19 | 8.64 | 0.55 | 42.86 | 42.86 | 2.00 | 2.04 |


## S3 FVG stop — per asset

| sym | n | fvg_total_r | atr_total_r | saved_r | fvg_win_pct | atr_win_pct | fvg_maxDD | atr_maxDD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTCUSDT | 36 | 28.61 | 21.01 | 7.61 | 33.33 | 30.56 | 7.75 | 9.18 |
| DOGEUSDT | 32 | 13.78 | 14.89 | -1.10 | 25.00 | 28.12 | 4.29 | 7.08 |
| ETHUSDT | 35 | 12.61 | 11.77 | 0.83 | 25.71 | 25.71 | 6.97 | 10.97 |
| LINKUSDT | 42 | 41.81 | 41.58 | 0.23 | 35.71 | 38.10 | 6.86 | 5.85 |
| SOLUSDT | 51 | 35.64 | 37.73 | -2.09 | 31.37 | 33.33 | 7.57 | 5.06 |
| XRPUSDT | 30 | 9.82 | 6.39 | 3.44 | 23.33 | 23.33 | 9.67 | 12.97 |


## S4 BE-lock impact (managed vs baseline)

| label | n | total_r | win_pct | maxDD_r | sl | tp | be |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline (ATR stop, no lock) | 274 | 377.46 | 11.68 | 28.36 | 242 | 32 | 0 |
| managed (BE lock @ 3.5R → +1R) | 274 | 290.46 | 29.56 | 21.67 | 193 | 22 | 59 |
| Δ managed − baseline | 274 | -87.00 | 0.00 | 0.00 | 0 | 0 | 0 |


## S4 BE-lock per-trade effect

| bucket | n | total_saved | avg_save |
| --- | --- | --- | --- |
| improved (saved_r > 0) | 49 | 98.00 | 2.00 |
| worsened (saved_r < 0) | 10 | -185.00 | -18.50 |
| unchanged | 215 | 0.00 | 0.00 |


## S4 BE-lock by year

| year | n | managed_total | baseline_total | saved_r | be_hits | tp_hits |
| --- | --- | --- | --- | --- | --- | --- |
| 2022 | 41 | -9.04 | 19.96 | -29.00 | 6 | 1 |
| 2023 | 91 | 160.76 | 173.76 | -13.00 | 14 | 11 |
| 2024 | 90 | 96.10 | 134.10 | -38.00 | 22 | 7 |
| 2025 | 48 | 42.72 | 53.72 | -11.00 | 15 | 3 |
| 2026 | 4 | -0.07 | -4.07 | 4.00 | 2 | 0 |


## S4 BE-lock by asset

| sym | n | managed_total | baseline_total | saved_r | be_hits | tp_hits |
| --- | --- | --- | --- | --- | --- | --- |
| BTCUSDT | 48 | 52.72 | 94.22 | -41.50 | 10 | 4 |
| DOGEUSDT | 33 | 54.49 | 48.49 | 6.00 | 3 | 4 |
| ETHUSDT | 42 | 38.74 | 59.74 | -21.00 | 10 | 3 |
| LINKUSDT | 48 | 32.91 | 12.91 | 20.00 | 10 | 3 |
| SOLUSDT | 49 | 45.97 | 93.97 | -48.00 | 17 | 3 |
| XRPUSDT | 54 | 65.62 | 68.12 | -2.50 | 9 | 5 |


## MFE-bucket win rates (mechanism streams)

| variant | mfe_bucket | n | win_pct | avg_r | total_r |
| --- | --- | --- | --- | --- | --- |
| S3 (FVG stop) | 0-1R | 96 | 0.00 | -0.88 | -84.08 |
| S3 (FVG stop) | 1-2R | 39 | 0.00 | -0.84 | -32.86 |
| S3 (FVG stop) | 2-3.5R | 17 | 0.00 | -0.98 | -16.67 |
| S3 (FVG stop) | 3.5-6.5R | 71 | 90.14 | 3.71 | 263.18 |
| S3 (FVG stop) | 6.5-10R | 3 | 100.00 | 4.23 | 12.70 |
| S4 baseline (no lock) | <=0R | 4 | 0.00 | -1.01 | -4.06 |
| S4 baseline (no lock) | 0-1R | 125 | 0.00 | -1.02 | -127.04 |
| S4 baseline (no lock) | 1-2R | 38 | 0.00 | -1.02 | -38.68 |
| S4 baseline (no lock) | 2-3.5R | 26 | 0.00 | -1.01 | -26.39 |
| S4 baseline (no lock) | 3.5-6.5R | 40 | 12.50 | 1.55 | 61.91 |
| S4 baseline (no lock) | 6.5-10R | 12 | 25.00 | 4.11 | 49.28 |
| S4 baseline (no lock) | >10R | 29 | 82.76 | 15.95 | 462.44 |
| S4 managed (BE lock) | <=0R | 4 | 0.00 | -1.01 | -4.06 |
| S4 managed (BE lock) | 0-1R | 125 | 0.00 | -1.02 | -127.04 |
| S4 managed (BE lock) | 1-2R | 38 | 0.00 | -1.02 | -38.68 |
| S4 managed (BE lock) | 2-3.5R | 26 | 0.00 | -1.01 | -26.39 |
| S4 managed (BE lock) | 3.5-6.5R | 40 | 100.00 | 0.98 | 39.41 |
| S4 managed (BE lock) | 6.5-10R | 12 | 100.00 | 0.98 | 11.78 |
| S4 managed (BE lock) | >10R | 29 | 100.00 | 15.02 | 435.44 |

