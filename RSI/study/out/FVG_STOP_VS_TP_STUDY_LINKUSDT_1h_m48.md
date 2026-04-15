# FVG Stop vs TP Study: LINKUSDT (1h)

## Setup

- Window months: `48`
- Strict FVG: `True` | min gap bps: `5.0`
- Horizon bars: `24`
- Strategy A (FVG stop): TP = `1.0R`
- Strategy B (FVG TP): Stop = `1.0 * ATR`
- Only aligned events: `True`

## Overall

| strategy | total_n | avg_mean_r | avg_median_r | avg_win_rate | avg_tp_rate | avg_sl_rate | avg_time_rate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FVG_TP_ANCHOR | 1712 | 0.0054 | 0.1932 | 0.6495 | 0.6495 | 0.3484 | 0.0021 |
| FVG_STOP_ANCHOR | 1712 | -0.0244 | 0.0 | 0.4571 | 0.4571 | 0.4815 | 0.0615 |

## By Side + Structure

| event_side | structure_regime | n | mean_r | median_r | win_rate | tp_rate | sl_rate | time_rate | strategy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bearish | BALANCE | 590 | -0.0102 | 0.0 | 0.4559 | 0.4559 | 0.4661 | 0.078 | FVG_STOP_ANCHOR |
| bearish | IMBALANCE | 229 | -0.0437 | 0.0 | 0.4454 | 0.4454 | 0.4891 | 0.0655 | FVG_STOP_ANCHOR |
| bullish | BALANCE | 634 | -0.0284 | 0.0 | 0.4558 | 0.4558 | 0.4842 | 0.0599 | FVG_STOP_ANCHOR |
| bullish | IMBALANCE | 259 | -0.0154 | 0.0 | 0.471 | 0.471 | 0.4865 | 0.0425 | FVG_STOP_ANCHOR |
| bearish | BALANCE | 590 | 0.0152 | 0.2002 | 0.6542 | 0.6542 | 0.339 | 0.0068 | FVG_TP_ANCHOR |
| bearish | IMBALANCE | 229 | -0.0355 | 0.1483 | 0.6026 | 0.6026 | 0.3974 | 0.0 | FVG_TP_ANCHOR |
| bullish | BALANCE | 634 | 0.0065 | 0.2074 | 0.6577 | 0.6577 | 0.3407 | 0.0016 | FVG_TP_ANCHOR |
| bullish | IMBALANCE | 259 | 0.0354 | 0.2166 | 0.6834 | 0.6834 | 0.3166 | 0.0 | FVG_TP_ANCHOR |

## Artifacts

- Event rows: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_events_LINKUSDT_1h_m48.csv`
- Comparison: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_comparison_LINKUSDT_1h_m48.csv`
- Overall: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_overall_LINKUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_chart_LINKUSDT_1h_m48.png`
