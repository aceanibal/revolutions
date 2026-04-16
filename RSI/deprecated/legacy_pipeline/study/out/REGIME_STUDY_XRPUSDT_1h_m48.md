# Regime Study: XRPUSDT

## Setup

- DB: `/Users/anibalperez/revolutions/backtester/data/backtest.sqlite`
- Window: `2022-03-01T00:00:00+00:00 -> 2026-03-01T00:00:00+00:00`
- Base candles: `5m` | Classification TF: `1h`
- ATR period: `14` | Lookback: `20`

## Regime Definitions (Chart-Only Proxies)

- `HIGH_VOL`: ATR% high + expanding and/or breakout from prior range.
- `LOW_VOL`: ATR% low + contracting.
- `IMBALANCE`: directional efficiency + trend separation elevated.
- `BALANCE`: residual state (sideways / non-event).

## Summary

| regime | time_share | occurrences | avg_bars | median_bars | avg_days |
| --- | --- | --- | --- | --- | --- |
| BALANCE | 0.7689 | 2417 | 11.13 | 5.0 | 0.46 |
| IMBALANCE | 0.1551 | 1258 | 4.31 | 2.0 | 0.18 |
| HIGH_VOL | 0.0367 | 921 | 1.4 | 1.0 | 0.06 |
| LOW_VOL | 0.0393 | 980 | 1.4 | 1.0 | 0.06 |

## Transition Probability Matrix P(next | current)

| regime | BALANCE | IMBALANCE | HIGH_VOL | LOW_VOL |
| --- | --- | --- | --- | --- |
| BALANCE | 0.9102 | 0.0327 | 0.0235 | 0.0336 |
| IMBALANCE | 0.1645 | 0.7682 | 0.0534 | 0.0138 |
| HIGH_VOL | 0.486 | 0.2302 | 0.2838 | 0.0 |
| LOW_VOL | 0.6536 | 0.0597 | 0.0 | 0.2868 |

## Artifacts

- Bars: `/Users/anibalperez/revolutions/RSI/study/out/regime_bars_XRPUSDT_1h_m48.csv`
- Runs: `/Users/anibalperez/revolutions/RSI/study/out/regime_runs_XRPUSDT_1h_m48.csv`
- Transitions count: `/Users/anibalperez/revolutions/RSI/study/out/regime_transitions_XRPUSDT_1h_m48.csv`
- Transitions prob: `/Users/anibalperez/revolutions/RSI/study/out/regime_transitions_prob_XRPUSDT_1h_m48.csv`
- Summary CSV: `/Users/anibalperez/revolutions/RSI/study/out/regime_summary_XRPUSDT_1h_m48.csv`
