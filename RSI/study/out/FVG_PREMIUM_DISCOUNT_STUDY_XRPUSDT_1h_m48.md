# FVG Premium/Discount Study: XRPUSDT (1h)

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
| bearish | discount | 814 | 84.0743 | 3.5045 | 2.8962 | 0.4914 | 0.4951 | 0.0123 | 0.6843 | 0.7998 | -0.0037 |
| bearish | premium | 58 | 93.079 | 2.2669 | 2.2479 | 0.4655 | 0.5172 | 0.0 | 0.7414 | 0.8448 | -0.0517 |
| bullish | discount | 20 | 31.9356 | 1.6766 | 2.6379 | 0.35 | 0.6 | 0.0 | 0.85 | 0.95 | -0.25 |
| bullish | premium | 710 | 95.3443 | 3.4452 | 2.7367 | 0.493 | 0.4803 | 0.0268 | 0.6986 | 0.8085 | 0.0127 |

## By Structure Regime

| structure_regime | event_side | premium_discount_zone | n | mean_gap_bps | mean_mfe_r | mean_mae_r | plus_hit | minus_hit | both_hit | fill_fast | fill_slow | edge_score |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BALANCE | bearish | discount | 544 | 74.6051 | 3.3363 | 3.0058 | 0.5037 | 0.489 | 0.0055 | 0.6765 | 0.7978 | 0.0147 |
| BALANCE | bearish | premium | 54 | 98.0766 | 2.3213 | 2.2904 | 0.4444 | 0.5556 | 0.0 | 0.7222 | 0.8333 | -0.1111 |
| BALANCE | bullish | discount | 20 | 31.9356 | 1.6766 | 2.6379 | 0.35 | 0.6 | 0.0 | 0.85 | 0.95 | -0.25 |
| BALANCE | bullish | premium | 426 | 85.3128 | 3.1843 | 2.7123 | 0.5 | 0.4836 | 0.0164 | 0.7042 | 0.831 | 0.0164 |
| IMBALANCE | bearish | discount | 270 | 103.1529 | 3.8433 | 2.6754 | 0.4667 | 0.5074 | 0.0259 | 0.7 | 0.8037 | -0.0407 |
| IMBALANCE | bearish | premium | 4 | 25.612 | 1.5315 | 1.6748 | 0.75 | 0.0 | 0.0 | 1.0 | 1.0 | 0.75 |
| IMBALANCE | bullish | premium | 284 | 110.3915 | 3.8365 | 2.7733 | 0.4824 | 0.4754 | 0.0423 | 0.6901 | 0.7746 | 0.007 |

## Artifacts

- Event rows: `/Users/anibalperez/revolutions/RSI/study/out/fvg_premium_discount_events_XRPUSDT_1h_m48.csv`
- Core concept CSV: `/Users/anibalperez/revolutions/RSI/study/out/fvg_premium_discount_concept_XRPUSDT_1h_m48.csv`
- By structure CSV: `/Users/anibalperez/revolutions/RSI/study/out/fvg_premium_discount_by_structure_XRPUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_premium_discount_chart_XRPUSDT_1h_m48.png`
