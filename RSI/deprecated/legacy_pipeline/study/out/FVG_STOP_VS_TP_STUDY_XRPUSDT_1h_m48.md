# FVG Stop vs TP Study: XRPUSDT (1h)

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
| FVG_STOP_ANCHOR | 1604 | 0.0126 | 0.0 | 0.4751 | 0.4751 | 0.4625 | 0.0624 |
| FVG_TP_ANCHOR | 1604 | -0.0524 | 0.1823 | 0.6136 | 0.6136 | 0.384 | 0.0024 |

## By Side + Structure

| event_side | structure_regime | n | mean_r | median_r | win_rate | tp_rate | sl_rate | time_rate | strategy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bearish | BALANCE | 599 | 0.01 | 0.0 | 0.4708 | 0.4708 | 0.4608 | 0.0684 | FVG_STOP_ANCHOR |
| bearish | IMBALANCE | 275 | 0.0036 | 0.0 | 0.4691 | 0.4691 | 0.4655 | 0.0655 | FVG_STOP_ANCHOR |
| bullish | BALANCE | 446 | -0.009 | 0.0 | 0.4641 | 0.4641 | 0.4731 | 0.0628 | FVG_STOP_ANCHOR |
| bullish | IMBALANCE | 284 | 0.0458 | 0.0 | 0.4965 | 0.4965 | 0.4507 | 0.0528 | FVG_STOP_ANCHOR |
| bearish | BALANCE | 599 | -0.0193 | 0.206 | 0.6377 | 0.6377 | 0.3606 | 0.0017 | FVG_TP_ANCHOR |
| bearish | IMBALANCE | 275 | -0.0125 | 0.2168 | 0.6327 | 0.6327 | 0.3636 | 0.0036 | FVG_TP_ANCHOR |
| bullish | BALANCE | 446 | -0.0648 | 0.1624 | 0.6099 | 0.6099 | 0.3857 | 0.0045 | FVG_TP_ANCHOR |
| bullish | IMBALANCE | 284 | -0.1129 | 0.1441 | 0.5739 | 0.5739 | 0.4261 | 0.0 | FVG_TP_ANCHOR |

## Artifacts

- Event rows: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_events_XRPUSDT_1h_m48.csv`
- Comparison: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_comparison_XRPUSDT_1h_m48.csv`
- Overall: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_overall_XRPUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_chart_XRPUSDT_1h_m48.png`
