# Regime Study: XRPUSDT

## Setup

- DB: `/Users/anibalperez/revolutions/backtester/data/backtest.sqlite`
- Window: `2022-03-01T00:00:00+00:00 -> 2026-03-01T00:00:00+00:00`
- Base candles: `5m` | Classification TF: `4h`
- ATR period: `14` | Lookback: `20`

## Regime Definitions (Chart-Only Proxies)

- Structure axis: `BALANCE` vs `IMBALANCE`.
- Vol axis: `LOW_VOL`, `NORMAL_VOL`, `HIGH_VOL`.
- Combined label is `STRUCTURE__VOL` (e.g., `BALANCE__HIGH_VOL`).

## Summary

| regime | time_share | occurrences | avg_bars | median_bars | avg_days |
| --- | --- | --- | --- | --- | --- |
| BALANCE__HIGH_VOL | 0.0236 | 175 | 1.18 | 1.0 | 0.2 |
| BALANCE__LOW_VOL | 0.0366 | 214 | 1.5 | 1.0 | 0.25 |
| BALANCE__NORMAL_VOL | 0.7699 | 589 | 11.42 | 5.0 | 1.9 |
| IMBALANCE__HIGH_VOL | 0.0158 | 94 | 1.47 | 1.0 | 0.24 |
| IMBALANCE__LOW_VOL | 0.0037 | 24 | 1.33 | 1.0 | 0.22 |
| IMBALANCE__NORMAL_VOL | 0.1504 | 327 | 4.02 | 2.0 | 0.67 |

## Transition Probability Matrix P(next | current)

| combined_regime | BALANCE__HIGH_VOL | BALANCE__LOW_VOL | BALANCE__NORMAL_VOL | IMBALANCE__HIGH_VOL | IMBALANCE__LOW_VOL | IMBALANCE__NORMAL_VOL |
| --- | --- | --- | --- | --- | --- | --- |
| BALANCE__HIGH_VOL | 0.1505 | 0.0 | 0.7427 | 0.0388 | 0.0 | 0.068 |
| BALANCE__LOW_VOL | 0.0 | 0.3312 | 0.6531 | 0.0 | 0.0094 | 0.0062 |
| BALANCE__NORMAL_VOL | 0.0228 | 0.0306 | 0.9126 | 0.0025 | 0.0007 | 0.0308 |
| IMBALANCE__HIGH_VOL | 0.029 | 0.0 | 0.0507 | 0.3188 | 0.0 | 0.6014 |
| IMBALANCE__LOW_VOL | 0.0 | 0.0625 | 0.0312 | 0.0 | 0.25 | 0.6562 |
| IMBALANCE__NORMAL_VOL | 0.0137 | 0.0046 | 0.1659 | 0.0525 | 0.0122 | 0.7511 |

## Artifacts

- Bars: `/Users/anibalperez/revolutions/RSI/study/out/regime_bars_XRPUSDT_4h_m48.csv`
- Runs: `/Users/anibalperez/revolutions/RSI/study/out/regime_runs_XRPUSDT_4h_m48.csv`
- Transitions count: `/Users/anibalperez/revolutions/RSI/study/out/regime_transitions_XRPUSDT_4h_m48.csv`
- Transitions prob: `/Users/anibalperez/revolutions/RSI/study/out/regime_transitions_prob_XRPUSDT_4h_m48.csv`
- Summary CSV: `/Users/anibalperez/revolutions/RSI/study/out/regime_summary_XRPUSDT_4h_m48.csv`
