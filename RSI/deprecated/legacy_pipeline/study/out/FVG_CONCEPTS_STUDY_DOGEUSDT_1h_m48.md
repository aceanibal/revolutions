# FVG Concepts Study: DOGEUSDT (1h)

## Setup

- DB: `/Users/anibalperez/revolutions/backtester/data/backtest.sqlite`
- Window: `2022-03-01T00:00:00+00:00 -> 2026-03-01T00:00:00+00:00`
- FVG min gap: `5.0 bps`
- Strict FVG filter: `True` | displacement q: `0.85` over `120` bars
- Fast horizon: `24` bars | Slow horizon: `72` bars
- Large FVG quantile in HIGH_VOL: `0.9`

## Concept 1: Trending Regime (Aligned vs Counter)

| trend_alignment | event_side | n | mean_gap_bps | mean_mfe_r | mean_mae_r | plus1r_fast | minus1r_fast | both_fast | full_fill_fast | full_fill_slow | edge_score_fast |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| trend_aligned | bearish | 282 | 130.4199 | 3.7407 | 2.9234 | 0.5 | 0.4894 | 0.0106 | 0.6702 | 0.7801 | 0.0106 |
| trend_aligned | bullish | 277 | 119.598 | 3.7552 | 2.5689 | 0.5343 | 0.4404 | 0.0253 | 0.6968 | 0.8087 | 0.0939 |
| trend_counter | bearish | 61 | 57.4361 | 2.5274 | 3.4049 | 0.5082 | 0.4754 | 0.0164 | 0.7869 | 0.8689 | 0.0328 |
| trend_counter | bullish | 50 | 69.2662 | 2.7952 | 3.5427 | 0.46 | 0.54 | 0.0 | 0.7 | 0.8 | -0.08 |

## Concept 2: Ranging Regime (Middle vs Edge)

| range_zone | event_side | n | mean_gap_bps | mean_mfe_r | mean_mae_r | plus1r_fast | minus1r_fast | both_fast | full_fill_fast | full_fill_slow | edge_score_fast |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| edge | bearish | 422 | 102.6158 | 3.1397 | 2.1508 | 0.5569 | 0.4336 | 0.0047 | 0.5427 | 0.6825 | 0.1232 |
| edge | bullish | 425 | 106.1162 | 3.1354 | 2.842 | 0.48 | 0.5012 | 0.0188 | 0.6612 | 0.7976 | -0.0212 |
| middle | bearish | 407 | 73.5903 | 2.6293 | 2.6897 | 0.4963 | 0.4914 | 0.0049 | 0.7445 | 0.8526 | 0.0049 |
| middle | bullish | 336 | 71.993 | 2.6001 | 2.4296 | 0.5417 | 0.4435 | 0.0089 | 0.7411 | 0.8393 | 0.0982 |

## Concept 3: High-Vol Regime (Large vs Regular FVG)

| high_vol_size_bucket | event_side | n | mean_gap_bps | mean_mfe_r | mean_mae_r | plus1r_fast | minus1r_fast | both_fast | full_fill_fast | full_fill_slow | edge_score_fast |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| high_vol_large | bearish | 12 | 481.6238 | 2.8568 | 2.6867 | 0.4167 | 0.5833 | 0.0 | 0.3333 | 0.4167 | -0.1667 |
| high_vol_large | bullish | 16 | 577.0072 | 3.9755 | 2.437 | 0.5625 | 0.375 | 0.0625 | 0.1875 | 0.375 | 0.1875 |
| high_vol_regular | bearish | 135 | 133.2254 | 2.7173 | 2.1987 | 0.4815 | 0.5185 | 0.0 | 0.5111 | 0.6667 | -0.037 |
| high_vol_regular | bullish | 109 | 134.2294 | 2.634 | 2.6856 | 0.4862 | 0.4679 | 0.0459 | 0.6239 | 0.7982 | 0.0183 |

## Artifacts

- Event rows: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concepts_events_DOGEUSDT_1h_m48.csv`
- Concept 1 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept1_trend_DOGEUSDT_1h_m48.csv`
- Concept 2 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept2_range_DOGEUSDT_1h_m48.csv`
- Concept 3 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept3_highvol_DOGEUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concepts_chart_DOGEUSDT_1h_m48.png`
