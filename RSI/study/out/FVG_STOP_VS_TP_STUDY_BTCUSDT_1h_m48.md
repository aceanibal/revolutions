# FVG Stop vs TP Study: BTCUSDT (1h)

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
| FVG_STOP_ANCHOR | 1567 | 0.0609 | 0.25 | 0.4922 | 0.4922 | 0.4312 | 0.0766 |
| FVG_TP_ANCHOR | 1567 | 0.0326 | 0.2195 | 0.6327 | 0.6327 | 0.3636 | 0.0037 |

## By Side + Structure

| event_side | structure_regime | n | mean_r | median_r | win_rate | tp_rate | sl_rate | time_rate | strategy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bearish | BALANCE | 545 | 0.0055 | 0.0 | 0.4661 | 0.4661 | 0.4606 | 0.0734 | FVG_STOP_ANCHOR |
| bearish | IMBALANCE | 236 | 0.1102 | 1.0 | 0.5169 | 0.5169 | 0.4068 | 0.0763 | FVG_STOP_ANCHOR |
| bullish | BALANCE | 527 | 0.0702 | 0.0 | 0.4953 | 0.4953 | 0.425 | 0.0797 | FVG_STOP_ANCHOR |
| bullish | IMBALANCE | 259 | 0.0579 | 0.0 | 0.4903 | 0.4903 | 0.4324 | 0.0772 | FVG_STOP_ANCHOR |
| bearish | BALANCE | 545 | 0.0339 | 0.2444 | 0.6367 | 0.6367 | 0.3541 | 0.0092 | FVG_TP_ANCHOR |
| bearish | IMBALANCE | 236 | -0.0093 | 0.1778 | 0.6271 | 0.6271 | 0.3729 | 0.0 | FVG_TP_ANCHOR |
| bullish | BALANCE | 527 | 0.0272 | 0.2239 | 0.6338 | 0.6338 | 0.3643 | 0.0019 | FVG_TP_ANCHOR |
| bullish | IMBALANCE | 259 | 0.0787 | 0.2318 | 0.6332 | 0.6332 | 0.3629 | 0.0039 | FVG_TP_ANCHOR |

## Artifacts

- Event rows: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_events_BTCUSDT_1h_m48.csv`
- Comparison: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_comparison_BTCUSDT_1h_m48.csv`
- Overall: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_overall_BTCUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_stop_vs_tp_chart_BTCUSDT_1h_m48.png`
