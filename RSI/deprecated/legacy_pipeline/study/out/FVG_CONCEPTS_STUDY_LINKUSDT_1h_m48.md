# FVG Concepts Study: LINKUSDT (1h)

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
| trend_aligned | bearish | 229 | 112.6347 | 3.2709 | 2.4778 | 0.4367 | 0.5502 | 0.0087 | 0.7118 | 0.8035 | -0.1135 |
| trend_aligned | bullish | 259 | 86.8451 | 2.9531 | 2.5137 | 0.5097 | 0.4749 | 0.0154 | 0.695 | 0.8069 | 0.0347 |
| trend_counter | bearish | 51 | 64.0714 | 2.5886 | 2.2513 | 0.5294 | 0.4706 | 0.0 | 0.7647 | 0.8627 | 0.0588 |
| trend_counter | bullish | 50 | 84.2406 | 1.7245 | 3.4124 | 0.5 | 0.5 | 0.0 | 0.74 | 0.86 | 0.0 |

## Concept 2: Ranging Regime (Middle vs Edge)

| range_zone | event_side | n | mean_gap_bps | mean_mfe_r | mean_mae_r | plus1r_fast | minus1r_fast | both_fast | full_fill_fast | full_fill_slow | edge_score_fast |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| edge | bearish | 492 | 112.595 | 2.9767 | 2.3384 | 0.5427 | 0.4472 | 0.0041 | 0.5752 | 0.7033 | 0.0955 |
| edge | bullish | 580 | 102.3044 | 2.834 | 2.6483 | 0.4862 | 0.5069 | 0.0052 | 0.6414 | 0.7724 | -0.0207 |
| middle | bearish | 365 | 79.31 | 2.6427 | 2.4092 | 0.5041 | 0.4849 | 0.0082 | 0.7534 | 0.8438 | 0.0192 |
| middle | bullish | 371 | 63.3053 | 2.6797 | 2.6421 | 0.531 | 0.469 | 0.0 | 0.7763 | 0.8652 | 0.062 |

## Concept 3: High-Vol Regime (Large vs Regular FVG)

| high_vol_size_bucket | event_side | n | mean_gap_bps | mean_mfe_r | mean_mae_r | plus1r_fast | minus1r_fast | both_fast | full_fill_fast | full_fill_slow | edge_score_fast |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| high_vol_large | bearish | 23 | 495.6383 | 3.5542 | 1.9922 | 0.5652 | 0.4348 | 0.0 | 0.1739 | 0.4348 | 0.1304 |
| high_vol_large | bullish | 8 | 444.77 | 2.0158 | 2.723 | 0.5 | 0.5 | 0.0 | 0.25 | 0.625 | 0.0 |
| high_vol_regular | bearish | 150 | 128.8331 | 2.8699 | 2.2634 | 0.4667 | 0.5133 | 0.02 | 0.5133 | 0.68 | -0.0467 |
| high_vol_regular | bullish | 120 | 116.4711 | 2.1715 | 2.74 | 0.4333 | 0.5333 | 0.0333 | 0.6667 | 0.8 | -0.1 |

## Artifacts

- Event rows: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concepts_events_LINKUSDT_1h_m48.csv`
- Concept 1 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept1_trend_LINKUSDT_1h_m48.csv`
- Concept 2 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept2_range_LINKUSDT_1h_m48.csv`
- Concept 3 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept3_highvol_LINKUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concepts_chart_LINKUSDT_1h_m48.png`
