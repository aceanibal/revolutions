# FVG Premium/Discount Study: XRPUSDT (4h)

## Setup

- DB: `/Users/anibalperez/revolutions/backtester/data/backtest.sqlite`
- Window: `2022-03-01T00:00:00+00:00 -> 2026-03-01T00:00:00+00:00`
- Leg lookback: `48` bars | EQ50 = (leg_high + leg_low)/2
- Strict FVG filter: `True` | displacement q `0.85` over `120` bars
- Aligned sample: FVG side matches regime bias direction
- Horizons: fast `24` bars, slow `72` bars

## Core Result (Aligned FVGs by Zone)

| event_side | premium_discount_zone | n | mean_gap_bps | mean_mfe_r | mean_mae_r | plus_hit | minus_hit | both_hit | fill_fast | fill_slow | edge_score |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bearish | discount | 210 | 153.525 | 3.1351 | 2.4664 | 0.5333 | 0.4333 | 0.019 | 0.6905 | 0.8238 | 0.1 |
| bearish | premium | 20 | 166.9271 | 2.0681 | 1.7341 | 0.6 | 0.4 | 0.0 | 0.65 | 0.9 | 0.2 |
| bullish | discount | 2 | 64.0129 | 0.2843 | 2.5687 | 0.0 | 1.0 | 0.0 | 1.0 | 1.0 | -1.0 |
| bullish | premium | 183 | 185.1538 | 3.9293 | 2.8506 | 0.4754 | 0.4918 | 0.0273 | 0.6995 | 0.7923 | -0.0164 |

## By Structure Regime

| structure_regime | event_side | premium_discount_zone | n | mean_gap_bps | mean_mfe_r | mean_mae_r | plus_hit | minus_hit | both_hit | fill_fast | fill_slow | edge_score |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BALANCE | bearish | discount | 145 | 133.039 | 3.1147 | 2.274 | 0.5517 | 0.4138 | 0.0138 | 0.6621 | 0.8 | 0.1379 |
| BALANCE | bearish | premium | 17 | 185.2686 | 2.2766 | 1.699 | 0.6471 | 0.3529 | 0.0 | 0.5882 | 0.8824 | 0.2941 |
| BALANCE | bullish | discount | 2 | 64.0129 | 0.2843 | 2.5687 | 0.0 | 1.0 | 0.0 | 1.0 | 1.0 | -1.0 |
| BALANCE | bullish | premium | 111 | 168.8823 | 3.3049 | 2.9629 | 0.4324 | 0.5315 | 0.027 | 0.7568 | 0.8378 | -0.0991 |
| IMBALANCE | bearish | discount | 65 | 199.2248 | 3.1804 | 2.8957 | 0.4923 | 0.4769 | 0.0308 | 0.7538 | 0.8769 | 0.0154 |
| IMBALANCE | bearish | premium | 3 | 62.9917 | 0.8863 | 1.9329 | 0.3333 | 0.6667 | 0.0 | 1.0 | 1.0 | -0.3333 |
| IMBALANCE | bullish | premium | 72 | 210.2391 | 4.8919 | 2.6775 | 0.5417 | 0.4306 | 0.0278 | 0.6111 | 0.7222 | 0.1111 |

## Artifacts

- Event rows: `/Users/anibalperez/revolutions/RSI/study/out/fvg_premium_discount_events_XRPUSDT_4h_m48.csv`
- Core concept CSV: `/Users/anibalperez/revolutions/RSI/study/out/fvg_premium_discount_concept_XRPUSDT_4h_m48.csv`
- By structure CSV: `/Users/anibalperez/revolutions/RSI/study/out/fvg_premium_discount_by_structure_XRPUSDT_4h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_premium_discount_chart_XRPUSDT_4h_m48.png`
