# FVG + MFE-Lock Impact Report

Run: `run_all_streams_20260416T153516Z`

## Mechanism Map

| stream | regime | stop | filter | active management |
| --- | --- | --- | --- | --- |
| S1 | IMBAL+HIGH Long  | ATR×2.0 below entry | none | none |
| S2 | BAL+HIGH Short   | FVG-LOW + ATR×0.15  | **FVG required** | none |
| S3 | IMBAL+HIGH Short | ATR×2.0 above entry | none | none |
| S4 | BAL+HIGH Long    | ATR×2.0 below entry | equal-lows sweep ≥0.90 rejection | **BE lock @ 3.5R → +1R** |

S2 and S4 are the only streams with an active mechanism; this report
isolates what each one contributes.

## S2 FVG stop placement (same signals, FVG-LOW vs ATR×2)

| label | n | win_pct | total_r | avg_r | maxDD_r | sl | tp | be |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FVG-LOW stop (live S2) | 285 | 28.07 | 164.46 | 0.58 | 10.41 | 205 | 80 | 0 |
| ATR x2 stop (same signals) | 285 | 29.82 | 157.58 | 0.55 | 12.61 | 200 | 85 | 0 |
| Δ FVG stop saves (total_R_A − total_R_B) | 285 | 0.00 | 6.87 | 0.02 | 0.00 | 0 | 0 | 0 |


## S2 FVG filter (FVG-only vs no filter, ATR stop)

| label | n | win_pct | total_r | avg_r | maxDD_r | sl | tp | be |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FVG-only (live S2) | 285 | 28.07 | 164.46 | 0.58 | 10.41 | 205 | 80 | 0 |
| No FVG filter (ATR stop, all signals) | 1400 | 23.00 | 271.23 | 0.19 | 44.33 | 1078 | 322 | 0 |
| Δ FVG filter impact (total_R_A − total_R_C) | -1115 | 0.00 | -106.77 | 0.00 | 0.00 | 0 | 0 | 0 |


## S2 FVG stop — per year

| year | n | fvg_total_r | atr_total_r | saved_r | fvg_win_pct | atr_win_pct | fvg_maxDD | atr_maxDD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2022 | 76 | 43.29 | 59.73 | -16.44 | 27.63 | 34.21 | 10.41 | 6.05 |
| 2023 | 29 | 11.65 | 12.54 | -0.89 | 24.14 | 27.59 | 7.95 | 7.94 |
| 2024 | 61 | 9.99 | 6.42 | 3.56 | 21.31 | 21.31 | 11.78 | 9.73 |
| 2025 | 109 | 92.62 | 73.31 | 19.31 | 33.03 | 32.11 | 5.89 | 7.08 |
| 2026 | 10 | 6.91 | 5.58 | 1.32 | 30.00 | 30.00 | 2.60 | 3.05 |


## S2 FVG stop — per asset

| sym | n | fvg_total_r | atr_total_r | saved_r | fvg_win_pct | atr_win_pct | fvg_maxDD | atr_maxDD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTCUSDT | 45 | 36.79 | 27.58 | 9.20 | 33.33 | 31.11 | 6.97 | 8.00 |
| DOGEUSDT | 38 | 9.36 | 8.83 | 0.53 | 21.05 | 23.68 | 6.90 | 8.12 |
| ETHUSDT | 45 | 20.59 | 27.83 | -7.25 | 26.67 | 31.11 | 7.47 | 6.90 |
| LINKUSDT | 55 | 42.82 | 38.95 | 3.88 | 30.91 | 32.73 | 6.02 | 10.08 |
| SOLUSDT | 60 | 38.79 | 44.40 | -5.61 | 30.00 | 33.33 | 10.41 | 6.04 |
| XRPUSDT | 42 | 16.10 | 9.99 | 6.12 | 23.81 | 23.81 | 6.34 | 12.61 |


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
| S2 (FVG stop) | <=0R | 1 | 0.00 | -0.90 | -0.90 |
| S2 (FVG stop) | 0-1R | 128 | 0.00 | -0.83 | -106.53 |
| S2 (FVG stop) | 1-2R | 43 | 0.00 | -0.84 | -35.98 |
| S2 (FVG stop) | 2-3.5R | 24 | 0.00 | -0.90 | -21.69 |
| S2 (FVG stop) | 3.5-6.5R | 86 | 89.53 | 3.68 | 316.86 |
| S2 (FVG stop) | 6.5-10R | 3 | 100.00 | 4.23 | 12.70 |
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

