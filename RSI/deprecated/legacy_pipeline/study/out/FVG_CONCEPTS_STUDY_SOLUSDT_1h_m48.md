# FVG Concepts Study: SOLUSDT (1h)

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
| trend_aligned | bearish | 243 | 126.7621 | 3.4531 | 2.501 | 0.5391 | 0.4444 | 0.0123 | 0.7037 | 0.8189 | 0.0947 |
| trend_aligned | bullish | 262 | 106.7956 | 3.0245 | 2.354 | 0.5305 | 0.4618 | 0.0076 | 0.7137 | 0.8168 | 0.0687 |
| trend_counter | bearish | 38 | 80.7005 | 2.3806 | 2.7066 | 0.4211 | 0.5526 | 0.0263 | 0.8684 | 0.8684 | -0.1316 |
| trend_counter | bullish | 49 | 50.8871 | 1.8659 | 3.1043 | 0.449 | 0.551 | 0.0 | 0.8367 | 0.9388 | -0.102 |

## Concept 2: Ranging Regime (Middle vs Edge)

| range_zone | event_side | n | mean_gap_bps | mean_mfe_r | mean_mae_r | plus1r_fast | minus1r_fast | both_fast | full_fill_fast | full_fill_slow | edge_score_fast |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| edge | bearish | 520 | 106.9238 | 3.0691 | 2.1671 | 0.5308 | 0.4481 | 0.0115 | 0.5423 | 0.725 | 0.0827 |
| edge | bullish | 591 | 109.1297 | 2.972 | 2.445 | 0.5059 | 0.4805 | 0.0118 | 0.6261 | 0.7563 | 0.0254 |
| middle | bearish | 390 | 72.3462 | 2.4801 | 2.7256 | 0.4487 | 0.5487 | 0.0 | 0.7821 | 0.8692 | -0.1 |
| middle | bullish | 318 | 69.5042 | 2.4426 | 2.4116 | 0.4906 | 0.5063 | 0.0 | 0.7453 | 0.8365 | -0.0157 |

## Concept 3: High-Vol Regime (Large vs Regular FVG)

| high_vol_size_bucket | event_side | n | mean_gap_bps | mean_mfe_r | mean_mae_r | plus1r_fast | minus1r_fast | both_fast | full_fill_fast | full_fill_slow | edge_score_fast |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| high_vol_large | bearish | 17 | 504.9753 | 2.2885 | 2.2246 | 0.5294 | 0.4706 | 0.0 | 0.2353 | 0.5294 | 0.0588 |
| high_vol_large | bullish | 13 | 503.6139 | 2.6987 | 2.5804 | 0.2308 | 0.7692 | 0.0 | 0.4615 | 0.7692 | -0.5385 |
| high_vol_regular | bearish | 154 | 134.4925 | 2.4537 | 2.3339 | 0.474 | 0.526 | 0.0 | 0.5649 | 0.7403 | -0.0519 |
| high_vol_regular | bullish | 107 | 133.0277 | 2.5499 | 2.4462 | 0.4766 | 0.514 | 0.0093 | 0.5888 | 0.7383 | -0.0374 |

## Artifacts

- Event rows: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concepts_events_SOLUSDT_1h_m48.csv`
- Concept 1 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept1_trend_SOLUSDT_1h_m48.csv`
- Concept 2 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept2_range_SOLUSDT_1h_m48.csv`
- Concept 3 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept3_highvol_SOLUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concepts_chart_SOLUSDT_1h_m48.png`
