# FVG Stop vs TP Study: SOLUSDT (1h)

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
| FVG_STOP_ANCHOR | 1771 | 0.0255 | 0.0 | 0.4878 | 0.4878 | 0.4623 | 0.0499 |
| FVG_TP_ANCHOR | 1771 | 0.0078 | 0.2065 | 0.6533 | 0.6533 | 0.3441 | 0.0026 |

## By Side + Structure

| event_side | structure_regime | n | mean_r | median_r | win_rate | tp_rate | sl_rate | time_rate | strategy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bearish | BALANCE | 634 | 0.0142 | 0.0 | 0.4795 | 0.4795 | 0.4653 | 0.0552 | FVG_STOP_ANCHOR |
| bearish | IMBALANCE | 243 | 0.0165 | 0.0 | 0.4897 | 0.4897 | 0.4733 | 0.037 | FVG_STOP_ANCHOR |
| bullish | BALANCE | 632 | 0.0332 | 0.0 | 0.4858 | 0.4858 | 0.4525 | 0.0617 | FVG_STOP_ANCHOR |
| bullish | IMBALANCE | 262 | 0.0382 | 0.0 | 0.4962 | 0.4962 | 0.458 | 0.0458 | FVG_STOP_ANCHOR |
| bearish | BALANCE | 634 | 0.0008 | 0.2195 | 0.6498 | 0.6498 | 0.3454 | 0.0047 | FVG_TP_ANCHOR |
| bearish | IMBALANCE | 243 | -0.0023 | 0.1807 | 0.6502 | 0.6502 | 0.3457 | 0.0041 | FVG_TP_ANCHOR |
| bullish | BALANCE | 632 | 0.0525 | 0.2081 | 0.6756 | 0.6756 | 0.3228 | 0.0016 | FVG_TP_ANCHOR |
| bullish | IMBALANCE | 262 | -0.02 | 0.2177 | 0.6374 | 0.6374 | 0.3626 | 0.0 | FVG_TP_ANCHOR |

## Artifacts

- Event rows: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_events_SOLUSDT_1h_m48.csv`
- Comparison: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_comparison_SOLUSDT_1h_m48.csv`
- Overall: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_overall_SOLUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_chart_SOLUSDT_1h_m48.png`
