# FVG Concepts Study: BTCUSDT (1h)

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
| trend_aligned | bearish | 236 | 70.2822 | 4.2394 | 2.5501 | 0.5085 | 0.4661 | 0.0169 | 0.6653 | 0.7797 | 0.0424 |
| trend_aligned | bullish | 259 | 65.3674 | 3.7108 | 2.2247 | 0.4981 | 0.4633 | 0.0309 | 0.5946 | 0.7066 | 0.0347 |
| trend_counter | bearish | 40 | 31.351 | 2.8874 | 2.959 | 0.6 | 0.4 | 0.0 | 0.7 | 0.8 | 0.2 |
| trend_counter | bullish | 42 | 33.8199 | 2.6132 | 3.2358 | 0.4286 | 0.5714 | 0.0 | 0.8095 | 0.9048 | -0.1429 |

## Concept 2: Ranging Regime (Middle vs Edge)

| range_zone | event_side | n | mean_gap_bps | mean_mfe_r | mean_mae_r | plus1r_fast | minus1r_fast | both_fast | full_fill_fast | full_fill_slow | edge_score_fast |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| edge | bearish | 452 | 69.676 | 2.8216 | 2.5763 | 0.5265 | 0.4491 | 0.0133 | 0.5708 | 0.7389 | 0.0774 |
| edge | bullish | 491 | 68.3608 | 3.1157 | 2.6059 | 0.5173 | 0.442 | 0.0326 | 0.5662 | 0.7271 | 0.0754 |
| middle | bearish | 334 | 41.0313 | 2.4175 | 2.5994 | 0.4731 | 0.509 | 0.006 | 0.7934 | 0.8713 | -0.0359 |
| middle | bullish | 277 | 32.1174 | 2.9913 | 2.4926 | 0.5487 | 0.4152 | 0.0181 | 0.769 | 0.8592 | 0.1336 |

## Concept 3: High-Vol Regime (Large vs Regular FVG)

| high_vol_size_bucket | event_side | n | mean_gap_bps | mean_mfe_r | mean_mae_r | plus1r_fast | minus1r_fast | both_fast | full_fill_fast | full_fill_slow | edge_score_fast |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| high_vol_large | bearish | 18 | 290.7142 | 2.279 | 1.9036 | 0.6667 | 0.2778 | 0.0556 | 0.1667 | 0.4444 | 0.3889 |
| high_vol_large | bullish | 12 | 289.2588 | 2.6467 | 2.9135 | 0.5833 | 0.3333 | 0.0833 | 0.3333 | 0.4167 | 0.25 |
| high_vol_regular | bearish | 150 | 76.9644 | 2.9914 | 2.3551 | 0.5667 | 0.4267 | 0.0067 | 0.5133 | 0.6733 | 0.14 |
| high_vol_regular | bullish | 111 | 78.2061 | 2.5531 | 2.0684 | 0.4775 | 0.5045 | 0.009 | 0.4595 | 0.6757 | -0.027 |

## Artifacts

- Event rows: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concepts_events_BTCUSDT_1h_m48.csv`
- Concept 1 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept1_trend_BTCUSDT_1h_m48.csv`
- Concept 2 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept2_range_BTCUSDT_1h_m48.csv`
- Concept 3 table: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concept3_highvol_BTCUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_concepts_chart_BTCUSDT_1h_m48.png`
