# FVG Concepts Study: ETHUSDT (1h)

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
| trend_aligned | bearish | 246 | 112.1243 | 4.4581 | 2.2968 | 0.5407 | 0.4512 | 0.0081 | 0.6301 | 0.7358 | 0.0894 |
| trend_aligned | bullish | 267 | 76.1087 | 3.2013 | 2.2965 | 0.5169 | 0.4682 | 0.015 | 0.6479 | 0.7416 | 0.0487 |
| trend_counter | bearish | 57 | 33.5331 | 2.136 | 2.6807 | 0.386 | 0.614 | 0.0 | 0.8947 | 0.9298 | -0.2281 |
| trend_counter | bullish | 48 | 47.759 | 2.0274 | 2.3223 | 0.3958 | 0.6042 | 0.0 | 0.8125 | 0.8958 | -0.2083 |

## Concept 2: Ranging Regime (Middle vs Edge)

| range_zone | event_side | n | mean_gap_bps | mean_mfe_r | mean_mae_r | plus1r_fast | minus1r_fast | both_fast | full_fill_fast | full_fill_slow | edge_score_fast |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| edge | bearish | 464 | 91.0284 | 3.1558 | 2.4101 | 0.5172 | 0.4677 | 0.0129 | 0.5754 | 0.7198 | 0.0496 |
| edge | bullish | 515 | 93.5296 | 3.0557 | 2.6402 | 0.532 | 0.4583 | 0.0078 | 0.6 | 0.7592 | 0.0738 |
| middle | bearish | 396 | 49.4327 | 2.7603 | 2.5685 | 0.5126 | 0.4672 | 0.0076 | 0.7551 | 0.8611 | 0.0455 |
| middle | bullish | 295 | 47.4376 | 2.7471 | 2.3484 | 0.5254 | 0.4542 | 0.0068 | 0.7424 | 0.8407 | 0.0712 |

## Concept 3: High-Vol Regime (Large vs Regular FVG)

| high_vol_size_bucket | event_side | n | mean_gap_bps | mean_mfe_r | mean_mae_r | plus1r_fast | minus1r_fast | both_fast | full_fill_fast | full_fill_slow | edge_score_fast |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| high_vol_large | bearish | 20 | 409.6614 | 2.0013 | 2.1885 | 0.6 | 0.4 | 0.0 | 0.25 | 0.5 | 0.2 |
| high_vol_large | bullish | 8 | 405.9096 | 2.1154 | 2.0566 | 0.5 | 0.5 | 0.0 | 0.125 | 0.375 | 0.0 |
| high_vol_regular | bearish | 155 | 104.7952 | 3.3234 | 2.2608 | 0.5097 | 0.471 | 0.0194 | 0.4968 | 0.6645 | 0.0387 |
| high_vol_regular | bullish | 92 | 101.1528 | 2.6353 | 1.8834 | 0.5217 | 0.4565 | 0.0109 | 0.4565 | 0.6304 | 0.0652 |

## Artifacts

- Event rows: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concepts_events_ETHUSDT_1h_m48.csv`
- Concept 1 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept1_trend_ETHUSDT_1h_m48.csv`
- Concept 2 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept2_range_ETHUSDT_1h_m48.csv`
- Concept 3 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept3_highvol_ETHUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concepts_chart_ETHUSDT_1h_m48.png`
