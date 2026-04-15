# XRPUSDT Regime Side-by-Side (4h vs 1h)

## Duration + Transition Comparison

| regime | occurrences_4h | avg_bars_4h | median_bars_4h | occurrences_1h | avg_bars_1h | median_bars_1h | avg_hours_4h | avg_hours_1h | avg_hours_blend | transition_stay_4h | transition_stay_1h | transition_stay_blend | occurrence_ratio_1h_vs_4h |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BALANCE | 589 | 11.4177 | 5.0 | 2417 | 11.1332 | 5.0 | 45.6706 | 11.1332 | 31.8557 | 0.9126 | 0.9102 | 0.9116 | 4.1036 |
| IMBALANCE | 327 | 4.0183 | 2.0 | 1258 | 4.3148 | 2.0 | 16.0734 | 4.3148 | 11.37 | 0.7511 | 0.7682 | 0.7579 | 3.8471 |
| HIGH_VOL | 257 | 1.3385 | 1.0 | 921 | 1.3963 | 1.0 | 5.3541 | 1.3963 | 3.771 | 0.2529 | 0.2838 | 0.2653 | 3.5837 |
| LOW_VOL | 233 | 1.5107 | 1.0 | 980 | 1.402 | 1.0 | 6.0429 | 1.402 | 4.1866 | 0.3381 | 0.2868 | 0.3176 | 4.206 |

## Suggested Rule Averages (Blended 60% 4h, 40% 1h)

| regime | avg_hours_blend | stay_prob_blend | confidence | recheck_every_hours | most_likely_next_if_changes |
| --- | --- | --- | --- | --- | --- |
| BALANCE | 31.86 | 0.9116 | high | 11.1 | LOW_VOL |
| IMBALANCE | 11.37 | 0.7579 | medium | 4.0 | BALANCE |
| HIGH_VOL | 3.77 | 0.2653 | low | 1.3 | BALANCE |
| LOW_VOL | 4.19 | 0.3176 | low | 1.5 | BALANCE |

## Top Start Hours by Regime (UTC, blended)

| regime | hour_utc | start_share_blend | end_share_blend |
| --- | --- | --- | --- |
| BALANCE | 12 | 0.1354 | 0.1121 |
| BALANCE | 0 | 0.128 | 0.107 |
| BALANCE | 20 | 0.124 | 0.1277 |
| IMBALANCE | 0 | 0.1269 | 0.1133 |
| IMBALANCE | 20 | 0.1232 | 0.1284 |
| IMBALANCE | 16 | 0.116 | 0.1051 |
| HIGH_VOL | 16 | 0.1595 | 0.1499 |
| HIGH_VOL | 12 | 0.1509 | 0.0809 |
| HIGH_VOL | 0 | 0.1167 | 0.0987 |
| LOW_VOL | 4 | 0.1717 | 0.0847 |
| LOW_VOL | 20 | 0.157 | 0.0726 |
| LOW_VOL | 8 | 0.1193 | 0.1541 |

## Files

- `/Users/anibalperez/revolutions/RSI/study/out/regime_side_by_side_durations_transitions_XRPUSDT_m48.csv`
- `/Users/anibalperez/revolutions/RSI/study/out/regime_start_end_hour_comparison_XRPUSDT_m48.csv`
- `/Users/anibalperez/revolutions/RSI/study/out/regime_top_start_hours_XRPUSDT_m48.csv`
- `/Users/anibalperez/revolutions/RSI/study/out/regime_rules_XRPUSDT_m48.csv`
