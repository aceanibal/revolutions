# FVG Concepts Study: XRPUSDT (4h)

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
| trend_aligned | bearish | 68 | 193.2145 | 3.0792 | 2.8532 | 0.4853 | 0.4853 | 0.0294 | 0.7647 | 0.8824 | 0.0 |
| trend_aligned | bullish | 72 | 210.2391 | 4.8919 | 2.6775 | 0.5417 | 0.4306 | 0.0278 | 0.6111 | 0.7222 | 0.1111 |
| trend_counter | bearish | 12 | 166.6833 | 2.0132 | 2.7389 | 0.5 | 0.5 | 0.0 | 0.8333 | 0.9167 | 0.0 |
| trend_counter | bullish | 18 | 86.9135 | 1.7075 | 2.313 | 0.2778 | 0.6667 | 0.0 | 0.8889 | 0.8889 | -0.3889 |

## Concept 2: Ranging Regime (Middle vs Edge)

| range_zone | event_side | n | mean_gap_bps | mean_mfe_r | mean_mae_r | plus1r_fast | minus1r_fast | both_fast | full_fill_fast | full_fill_slow | edge_score_fast |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| edge | bearish | 91 | 166.6609 | 3.6373 | 2.2702 | 0.6374 | 0.3407 | 0.022 | 0.5385 | 0.7033 | 0.2967 |
| edge | bullish | 98 | 205.4039 | 4.1043 | 2.9054 | 0.4286 | 0.5612 | 0.0102 | 0.6735 | 0.7959 | -0.1327 |
| middle | bearish | 129 | 132.8381 | 2.9564 | 1.9017 | 0.5659 | 0.4186 | 0.0 | 0.7054 | 0.845 | 0.1473 |
| middle | bullish | 80 | 131.4546 | 2.3548 | 2.8269 | 0.4375 | 0.525 | 0.0125 | 0.825 | 0.9125 | -0.0875 |

## Concept 3: High-Vol Regime (Large vs Regular FVG)

| high_vol_size_bucket | event_side | n | mean_gap_bps | mean_mfe_r | mean_mae_r | plus1r_fast | minus1r_fast | both_fast | full_fill_fast | full_fill_slow | edge_score_fast |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| high_vol_large | bearish | 3 | 948.8189 | 1.5613 | 3.5705 | 0.6667 | 0.3333 | 0.0 | 0.3333 | 0.6667 | 0.3333 |
| high_vol_large | bullish | 4 | 955.2944 | 0.6212 | 4.1365 | 0.0 | 0.75 | 0.25 | 0.25 | 0.25 | -0.75 |
| high_vol_regular | bearish | 37 | 165.9063 | 3.098 | 2.8751 | 0.6216 | 0.3514 | 0.027 | 0.5676 | 0.7297 | 0.2703 |
| high_vol_regular | bullish | 23 | 264.2463 | 5.81 | 1.836 | 0.5652 | 0.4348 | 0.0 | 0.3913 | 0.6522 | 0.1304 |

## Artifacts

- Event rows: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concepts_events_XRPUSDT_4h_m48.csv`
- Concept 1 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept1_trend_XRPUSDT_4h_m48.csv`
- Concept 2 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept2_range_XRPUSDT_4h_m48.csv`
- Concept 3 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept3_highvol_XRPUSDT_4h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concepts_chart_XRPUSDT_4h_m48.png`
