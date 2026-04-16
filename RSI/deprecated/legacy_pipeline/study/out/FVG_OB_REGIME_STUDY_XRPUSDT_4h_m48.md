# FVG + Order Block Proxy Study: XRPUSDT (4h)

## Setup

- DB: `/Users/anibalperez/revolutions/backtester/data/backtest.sqlite`
- Window: `2022-03-01T00:00:00+00:00 -> 2026-03-01T00:00:00+00:00`
- Regime TF: `4h` | ATR period: `14` | lookback: `20`
- FVG threshold: `5.0 bps`
- OB proxy displacement quantile: `0.85`

## Caveat

- `ORDER_BLOCK_PROXY` is candle-structure based; true Level-2 order-book walls are not available in this dataset.

## Totals

| event_type | event_side | count |
| --- | --- | --- |
| FVG | bearish | 704 |
| FVG | bullish | 681 |
| ORDER_BLOCK_PROXY | bearish | 252 |
| ORDER_BLOCK_PROXY | bullish | 188 |

## Counts by Combined Regime

| event_type | event_side | combined_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | BALANCE__NORMAL_VOL | 529 |
| FVG | bearish | IMBALANCE__NORMAL_VOL | 103 |
| FVG | bearish | BALANCE__HIGH_VOL | 37 |
| FVG | bearish | IMBALANCE__HIGH_VOL | 23 |
| FVG | bearish | BALANCE__LOW_VOL | 11 |
| FVG | bearish | IMBALANCE__LOW_VOL | 1 |
| FVG | bullish | BALANCE__NORMAL_VOL | 516 |
| FVG | bullish | IMBALANCE__NORMAL_VOL | 111 |
| FVG | bullish | IMBALANCE__HIGH_VOL | 19 |
| FVG | bullish | BALANCE__LOW_VOL | 18 |
| FVG | bullish | BALANCE__HIGH_VOL | 17 |
| ORDER_BLOCK_PROXY | bearish | BALANCE__NORMAL_VOL | 162 |
| ORDER_BLOCK_PROXY | bearish | BALANCE__HIGH_VOL | 39 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE__NORMAL_VOL | 32 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE__HIGH_VOL | 19 |
| ORDER_BLOCK_PROXY | bullish | BALANCE__NORMAL_VOL | 140 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE__NORMAL_VOL | 36 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE__HIGH_VOL | 10 |
| ORDER_BLOCK_PROXY | bullish | BALANCE__HIGH_VOL | 2 |

## Counts by Structure Regime

| event_type | event_side | structure_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | BALANCE | 577 |
| FVG | bearish | IMBALANCE | 127 |
| FVG | bullish | BALANCE | 551 |
| FVG | bullish | IMBALANCE | 130 |
| ORDER_BLOCK_PROXY | bearish | BALANCE | 201 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE | 51 |
| ORDER_BLOCK_PROXY | bullish | BALANCE | 142 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE | 46 |

## Counts by Vol Regime

| event_type | event_side | vol_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | NORMAL_VOL | 632 |
| FVG | bearish | HIGH_VOL | 60 |
| FVG | bearish | LOW_VOL | 12 |
| FVG | bullish | NORMAL_VOL | 627 |
| FVG | bullish | HIGH_VOL | 36 |
| FVG | bullish | LOW_VOL | 18 |
| ORDER_BLOCK_PROXY | bearish | NORMAL_VOL | 194 |
| ORDER_BLOCK_PROXY | bearish | HIGH_VOL | 58 |
| ORDER_BLOCK_PROXY | bullish | NORMAL_VOL | 176 |
| ORDER_BLOCK_PROXY | bullish | HIGH_VOL | 12 |

## Counts by Regime Bias

| event_type | event_side | regime_bias | count |
| --- | --- | --- | --- |
| FVG | bearish | bearish | 427 |
| FVG | bearish | bullish | 141 |
| FVG | bearish | neutral | 136 |
| FVG | bullish | bullish | 309 |
| FVG | bullish | bearish | 207 |
| FVG | bullish | neutral | 165 |
| ORDER_BLOCK_PROXY | bearish | bearish | 116 |
| ORDER_BLOCK_PROXY | bearish | bullish | 94 |
| ORDER_BLOCK_PROXY | bearish | neutral | 42 |
| ORDER_BLOCK_PROXY | bullish | bullish | 91 |
| ORDER_BLOCK_PROXY | bullish | bearish | 67 |
| ORDER_BLOCK_PROXY | bullish | neutral | 30 |

## Artifacts

- Events: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_events_XRPUSDT_4h_m48.csv`
- By combined regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_combined_regime_XRPUSDT_4h_m48.csv`
- By structure regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_structure_regime_XRPUSDT_4h_m48.csv`
- By vol regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_vol_regime_XRPUSDT_4h_m48.csv`
- By regime bias: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_regime_bias_XRPUSDT_4h_m48.csv`
- Totals: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_totals_XRPUSDT_4h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_regime_chart_XRPUSDT_4h_m48.png`
