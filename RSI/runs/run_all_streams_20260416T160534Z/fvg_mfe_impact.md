# FVG + MFE-Lock Impact Report

Run: `run_all_streams_20260416T160534Z`

## Mechanism Map

| stream | regime | stop | filter | active management |
| --- | --- | --- | --- | --- |
| S1 | IMBAL+HIGH Long  | ATR×2.0 below entry | none | none |
| S2 | BAL+HIGH Short   | ATR×1.5 above entry | none | none |
| S3 | IMBAL+HIGH Short | FVG-LOW + ATR×0.15  | **FVG required** | none |
| S4 | BAL+HIGH Long    | ATR×2.0 below entry | equal-lows sweep ≥0.90 rejection | **BE lock @ 3.5R → +1R** |

S3 and S4 are the only streams with an active mechanism; this report
isolates what each one contributes.

## S3 FVG stop placement (same signals, FVG-LOW vs ATR×2)

| label | n | win_pct | total_r | avg_r | maxDD_r | sl | tp | be |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FVG-LOW stop (live S3) | 225 | 22.22 | 23.86 | 0.11 | 32.27 | 175 | 50 | 0 |
| ATR x2 stop (same signals) | 225 | 22.22 | 34.45 | 0.15 | 32.61 | 175 | 50 | 0 |
| Δ FVG stop saves (total_R_A − total_R_B) | 225 | 0.00 | -10.59 | -0.05 | 0.00 | 0 | 0 | 0 |


## S3 FVG filter (FVG-only vs no filter, ATR stop)

| label | n | win_pct | total_r | avg_r | maxDD_r | sl | tp | be |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FVG-only (live S3) | 225 | 22.22 | 23.86 | 0.11 | 32.27 | 175 | 50 | 0 |
| No FVG filter (ATR stop, all IMBAL shorts) | 631 | 23.30 | 132.42 | 0.21 | 30.44 | 484 | 147 | 0 |
| Δ FVG filter impact (total_R_A − total_R_C) | -406 | 0.00 | -108.56 | 0.00 | 0.00 | 0 | 0 | 0 |


## S3 FVG stop — per year

| year | n | fvg_total_r | atr_total_r | saved_r | fvg_win_pct | atr_win_pct | fvg_maxDD | atr_maxDD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2022 | 54 | 14.43 | 8.35 | 6.08 | 24.07 | 22.22 | 9.39 | 9.92 |
| 2023 | 28 | -1.07 | -7.41 | 6.34 | 21.43 | 14.29 | 13.38 | 11.14 |
| 2024 | 37 | 15.20 | 14.96 | 0.24 | 27.03 | 27.03 | 8.15 | 8.09 |
| 2025 | 96 | -4.87 | 12.94 | -17.82 | 18.75 | 21.88 | 18.64 | 13.95 |
| 2026 | 10 | 0.18 | 5.60 | -5.43 | 30.00 | 30.00 | 5.23 | 3.04 |


## S3 FVG stop — per asset

| sym | n | fvg_total_r | atr_total_r | saved_r | fvg_win_pct | atr_win_pct | fvg_maxDD | atr_maxDD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTCUSDT | 55 | 17.14 | 22.63 | -5.49 | 25.45 | 27.27 | 10.52 | 10.06 |
| DOGEUSDT | 31 | 0.40 | -5.09 | 5.49 | 19.35 | 16.13 | 9.35 | 10.09 |
| ETHUSDT | 39 | 2.17 | 7.75 | -5.58 | 23.08 | 23.08 | 10.15 | 11.14 |
| LINKUSDT | 36 | -6.53 | -4.86 | -1.67 | 16.67 | 16.67 | 11.97 | 14.14 |
| SOLUSDT | 35 | 30.55 | 27.63 | 2.92 | 37.14 | 34.29 | 4.43 | 5.04 |
| XRPUSDT | 29 | -19.86 | -13.61 | -6.25 | 6.90 | 10.34 | 21.92 | 17.21 |


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
| S3 (FVG stop) | <=0R | 1 | 0.00 | -0.95 | -0.95 |
| S3 (FVG stop) | 0-1R | 111 | 0.00 | -0.98 | -108.75 |
| S3 (FVG stop) | 1-2R | 46 | 0.00 | -1.22 | -56.01 |
| S3 (FVG stop) | 2-3.5R | 12 | 0.00 | -1.42 | -17.07 |
| S3 (FVG stop) | 3.5-6.5R | 54 | 90.74 | 3.75 | 202.42 |
| S3 (FVG stop) | 6.5-10R | 1 | 100.00 | 4.24 | 4.24 |
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

