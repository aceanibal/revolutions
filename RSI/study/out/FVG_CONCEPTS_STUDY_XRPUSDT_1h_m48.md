# FVG Concepts Study: XRPUSDT (1h)

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
| trend_aligned | bearish | 275 | 102.3073 | 3.8106 | 2.6547 | 0.4727 | 0.4982 | 0.0255 | 0.7018 | 0.8073 | -0.0255 |
| trend_aligned | bullish | 284 | 110.3915 | 3.8365 | 2.7733 | 0.4824 | 0.4754 | 0.0423 | 0.6901 | 0.7746 | 0.007 |
| trend_counter | bearish | 74 | 70.3575 | 2.4473 | 2.1951 | 0.5811 | 0.4189 | 0.0 | 0.7297 | 0.8108 | 0.1622 |
| trend_counter | bullish | 54 | 61.3227 | 2.3215 | 3.0394 | 0.4815 | 0.5185 | 0.0 | 0.7037 | 0.7778 | -0.037 |

## Concept 2: Ranging Regime (Middle vs Edge)

| range_zone | event_side | n | mean_gap_bps | mean_mfe_r | mean_mae_r | plus1r_fast | minus1r_fast | both_fast | full_fill_fast | full_fill_slow | edge_score_fast |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| edge | bearish | 412 | 81.1333 | 3.3233 | 2.5624 | 0.5049 | 0.483 | 0.0121 | 0.5971 | 0.7451 | 0.0218 |
| edge | bullish | 409 | 89.2032 | 2.9976 | 2.5612 | 0.5012 | 0.4719 | 0.0196 | 0.6235 | 0.7579 | 0.0293 |
| middle | bearish | 432 | 62.9625 | 2.7744 | 2.8345 | 0.5093 | 0.4861 | 0.0023 | 0.7407 | 0.8495 | 0.0231 |
| middle | bullish | 299 | 56.6314 | 2.6356 | 2.4314 | 0.5251 | 0.4649 | 0.0067 | 0.7358 | 0.8395 | 0.0602 |

## Concept 3: High-Vol Regime (Large vs Regular FVG)

| high_vol_size_bucket | event_side | n | mean_gap_bps | mean_mfe_r | mean_mae_r | plus1r_fast | minus1r_fast | both_fast | full_fill_fast | full_fill_slow | edge_score_fast |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| high_vol_large | bearish | 8 | 420.5025 | 1.8113 | 2.1842 | 0.625 | 0.375 | 0.0 | 0.125 | 0.875 | 0.25 |
| high_vol_large | bullish | 21 | 632.644 | 4.2015 | 2.2469 | 0.5238 | 0.381 | 0.0952 | 0.1429 | 0.2857 | 0.1429 |
| high_vol_regular | bearish | 142 | 123.695 | 3.331 | 2.4148 | 0.4085 | 0.5634 | 0.0282 | 0.5352 | 0.669 | -0.1549 |
| high_vol_regular | bullish | 111 | 133.6337 | 3.3331 | 2.1783 | 0.4505 | 0.5045 | 0.045 | 0.4775 | 0.6306 | -0.0541 |

## Artifacts

- Event rows: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concepts_events_XRPUSDT_1h_m48.csv`
- Concept 1 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept1_trend_XRPUSDT_1h_m48.csv`
- Concept 2 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept2_range_XRPUSDT_1h_m48.csv`
- Concept 3 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept3_highvol_XRPUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concepts_chart_XRPUSDT_1h_m48.png`
