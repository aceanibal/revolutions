# FVG Stop vs TP Study: XRPUSDT (4h)

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
| FVG_STOP_ANCHOR | 417 | -0.0292 | 0.0 | 0.4606 | 0.4606 | 0.4897 | 0.0497 |
| FVG_TP_ANCHOR | 417 | -0.0533 | 0.1649 | 0.6391 | 0.6391 | 0.3594 | 0.0015 |

## By Side + Structure

| event_side | structure_regime | n | mean_r | median_r | win_rate | tp_rate | sl_rate | time_rate | strategy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bearish | BALANCE | 163 | 0.1411 | 1.0 | 0.5521 | 0.5521 | 0.411 | 0.0368 | FVG_STOP_ANCHOR |
| bearish | IMBALANCE | 68 | -0.2059 | -1.0 | 0.3676 | 0.3676 | 0.5735 | 0.0588 | FVG_STOP_ANCHOR |
| bullish | BALANCE | 114 | -0.1491 | -1.0 | 0.3947 | 0.3947 | 0.5439 | 0.0614 | FVG_STOP_ANCHOR |
| bullish | IMBALANCE | 72 | 0.0972 | 1.0 | 0.5278 | 0.5278 | 0.4306 | 0.0417 | FVG_STOP_ANCHOR |
| bearish | BALANCE | 163 | 0.09 | 0.2812 | 0.7362 | 0.7362 | 0.2577 | 0.0061 | FVG_TP_ANCHOR |
| bearish | IMBALANCE | 68 | -0.1301 | 0.121 | 0.6176 | 0.6176 | 0.3824 | 0.0 | FVG_TP_ANCHOR |
| bullish | BALANCE | 114 | -0.0887 | 0.1487 | 0.6053 | 0.6053 | 0.3947 | 0.0 | FVG_TP_ANCHOR |
| bullish | IMBALANCE | 72 | -0.0843 | 0.1085 | 0.5972 | 0.5972 | 0.4028 | 0.0 | FVG_TP_ANCHOR |

## Artifacts

- Event rows: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_events_XRPUSDT_4h_m48.csv`
- Comparison: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_comparison_XRPUSDT_4h_m48.csv`
- Overall: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_overall_XRPUSDT_4h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_chart_XRPUSDT_4h_m48.png`
