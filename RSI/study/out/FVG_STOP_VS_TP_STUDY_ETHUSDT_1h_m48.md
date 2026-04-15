# FVG Stop vs TP Study: ETHUSDT (1h)

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
| FVG_TP_ANCHOR | 1677 | 0.0503 | 0.2235 | 0.6447 | 0.6447 | 0.35 | 0.0053 |
| FVG_STOP_ANCHOR | 1677 | 0.0097 | 0.0 | 0.4699 | 0.4699 | 0.4602 | 0.0699 |

## By Side + Structure

| event_side | structure_regime | n | mean_r | median_r | win_rate | tp_rate | sl_rate | time_rate | strategy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bearish | BALANCE | 611 | 0.0065 | 0.0 | 0.4697 | 0.4697 | 0.4632 | 0.0671 | FVG_STOP_ANCHOR |
| bearish | IMBALANCE | 246 | 0.0163 | 0.0 | 0.4756 | 0.4756 | 0.4593 | 0.065 | FVG_STOP_ANCHOR |
| bullish | BALANCE | 553 | 0.0271 | 0.0 | 0.481 | 0.481 | 0.4539 | 0.0651 | FVG_STOP_ANCHOR |
| bullish | IMBALANCE | 267 | -0.0112 | 0.0 | 0.4532 | 0.4532 | 0.4644 | 0.0824 | FVG_STOP_ANCHOR |
| bearish | BALANCE | 611 | 0.0143 | 0.2094 | 0.6268 | 0.6268 | 0.365 | 0.0082 | FVG_TP_ANCHOR |
| bearish | IMBALANCE | 246 | 0.1312 | 0.2209 | 0.6707 | 0.6707 | 0.3293 | 0.0 | FVG_TP_ANCHOR |
| bullish | BALANCE | 553 | 0.0313 | 0.2407 | 0.6221 | 0.6221 | 0.3725 | 0.0054 | FVG_TP_ANCHOR |
| bullish | IMBALANCE | 267 | 0.0246 | 0.2227 | 0.6592 | 0.6592 | 0.3333 | 0.0075 | FVG_TP_ANCHOR |

## Artifacts

- Event rows: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_events_ETHUSDT_1h_m48.csv`
- Comparison: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_comparison_ETHUSDT_1h_m48.csv`
- Overall: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_overall_ETHUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_chart_ETHUSDT_1h_m48.png`
