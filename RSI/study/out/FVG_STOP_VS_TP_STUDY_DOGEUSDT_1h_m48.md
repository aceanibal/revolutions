# FVG Stop vs TP Study: DOGEUSDT (1h)

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
| FVG_STOP_ANCHOR | 1638 | -0.0008 | 0.0 | 0.4676 | 0.4676 | 0.4684 | 0.064 |
| FVG_TP_ANCHOR | 1638 | -0.0267 | 0.1875 | 0.6201 | 0.6201 | 0.3759 | 0.004 |

## By Side + Structure

| event_side | structure_regime | n | mean_r | median_r | win_rate | tp_rate | sl_rate | time_rate | strategy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bearish | BALANCE | 576 | -0.0347 | 0.0 | 0.4444 | 0.4444 | 0.4792 | 0.0764 | FVG_STOP_ANCHOR |
| bearish | IMBALANCE | 282 | 0.0496 | 0.0 | 0.4823 | 0.4823 | 0.4326 | 0.0851 | FVG_STOP_ANCHOR |
| bullish | BALANCE | 503 | 0.0179 | 0.0 | 0.4851 | 0.4851 | 0.4672 | 0.0477 | FVG_STOP_ANCHOR |
| bullish | IMBALANCE | 277 | -0.0361 | 0.0 | 0.4585 | 0.4585 | 0.4946 | 0.0469 | FVG_STOP_ANCHOR |
| bearish | BALANCE | 576 | -0.0042 | 0.2004 | 0.6285 | 0.6285 | 0.3594 | 0.0122 | FVG_TP_ANCHOR |
| bearish | IMBALANCE | 282 | -0.0175 | 0.1765 | 0.6028 | 0.6028 | 0.3972 | 0.0 | FVG_TP_ANCHOR |
| bullish | BALANCE | 503 | -0.0007 | 0.2226 | 0.6461 | 0.6461 | 0.3499 | 0.004 | FVG_TP_ANCHOR |
| bullish | IMBALANCE | 277 | -0.0846 | 0.1505 | 0.6029 | 0.6029 | 0.3971 | 0.0 | FVG_TP_ANCHOR |

## Artifacts

- Event rows: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_events_DOGEUSDT_1h_m48.csv`
- Comparison: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_comparison_DOGEUSDT_1h_m48.csv`
- Overall: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_overall_DOGEUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_chart_DOGEUSDT_1h_m48.png`
