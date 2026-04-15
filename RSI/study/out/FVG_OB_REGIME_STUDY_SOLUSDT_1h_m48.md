# FVG + Order Block Proxy Study: SOLUSDT (1h)

## Setup

- DB: `/Users/anibalperez/revolutions/backtester/data/backtest.sqlite`
- Window: `2022-03-01T00:00:00+00:00 -> 2026-03-01T00:00:00+00:00`
- Regime TF: `1h` | ATR period: `14` | lookback: `20`
- FVG threshold: `5.0 bps`
- OB proxy displacement quantile: `0.85`

## Caveat

- `ORDER_BLOCK_PROXY` is candle-structure based; true Level-2 order-book walls are not available in this dataset.

## Totals

| event_type | event_side | count |
| --- | --- | --- |
| FVG | bearish | 2860 |
| FVG | bullish | 2845 |
| ORDER_BLOCK_PROXY | bearish | 957 |
| ORDER_BLOCK_PROXY | bullish | 928 |

## Counts by Combined Regime

| event_type | event_side | combined_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | BALANCE__NORMAL_VOL | 2148 |
| FVG | bearish | IMBALANCE__NORMAL_VOL | 376 |
| FVG | bearish | BALANCE__HIGH_VOL | 183 |
| FVG | bearish | IMBALANCE__HIGH_VOL | 80 |
| FVG | bearish | BALANCE__LOW_VOL | 66 |
| FVG | bearish | IMBALANCE__LOW_VOL | 7 |
| FVG | bullish | BALANCE__NORMAL_VOL | 2174 |
| FVG | bullish | IMBALANCE__NORMAL_VOL | 443 |
| FVG | bullish | BALANCE__HIGH_VOL | 113 |
| FVG | bullish | BALANCE__LOW_VOL | 58 |
| FVG | bullish | IMBALANCE__HIGH_VOL | 52 |
| FVG | bullish | IMBALANCE__LOW_VOL | 5 |
| ORDER_BLOCK_PROXY | bearish | BALANCE__NORMAL_VOL | 630 |
| ORDER_BLOCK_PROXY | bearish | BALANCE__HIGH_VOL | 137 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE__NORMAL_VOL | 134 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE__HIGH_VOL | 56 |
| ORDER_BLOCK_PROXY | bullish | BALANCE__NORMAL_VOL | 698 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE__NORMAL_VOL | 147 |
| ORDER_BLOCK_PROXY | bullish | BALANCE__HIGH_VOL | 60 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE__HIGH_VOL | 23 |

## Counts by Structure Regime

| event_type | event_side | structure_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | BALANCE | 2397 |
| FVG | bearish | IMBALANCE | 463 |
| FVG | bullish | BALANCE | 2345 |
| FVG | bullish | IMBALANCE | 500 |
| ORDER_BLOCK_PROXY | bearish | BALANCE | 767 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE | 190 |
| ORDER_BLOCK_PROXY | bullish | BALANCE | 758 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE | 170 |

## Counts by Vol Regime

| event_type | event_side | vol_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | NORMAL_VOL | 2524 |
| FVG | bearish | HIGH_VOL | 263 |
| FVG | bearish | LOW_VOL | 73 |
| FVG | bullish | NORMAL_VOL | 2617 |
| FVG | bullish | HIGH_VOL | 165 |
| FVG | bullish | LOW_VOL | 63 |
| ORDER_BLOCK_PROXY | bearish | NORMAL_VOL | 764 |
| ORDER_BLOCK_PROXY | bearish | HIGH_VOL | 193 |
| ORDER_BLOCK_PROXY | bullish | NORMAL_VOL | 845 |
| ORDER_BLOCK_PROXY | bullish | HIGH_VOL | 83 |

## Counts by Regime Bias

| event_type | event_side | regime_bias | count |
| --- | --- | --- | --- |
| FVG | bearish | bearish | 1633 |
| FVG | bearish | bullish | 668 |
| FVG | bearish | neutral | 559 |
| FVG | bullish | bullish | 1509 |
| FVG | bullish | bearish | 715 |
| FVG | bullish | neutral | 621 |
| ORDER_BLOCK_PROXY | bearish | bearish | 444 |
| ORDER_BLOCK_PROXY | bearish | bullish | 332 |
| ORDER_BLOCK_PROXY | bearish | neutral | 181 |
| ORDER_BLOCK_PROXY | bullish | bullish | 462 |
| ORDER_BLOCK_PROXY | bullish | bearish | 324 |
| ORDER_BLOCK_PROXY | bullish | neutral | 142 |

## Artifacts

- Events: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_events_SOLUSDT_1h_m48.csv`
- By combined regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_combined_regime_SOLUSDT_1h_m48.csv`
- By structure regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_structure_regime_SOLUSDT_1h_m48.csv`
- By vol regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_vol_regime_SOLUSDT_1h_m48.csv`
- By regime bias: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_regime_bias_SOLUSDT_1h_m48.csv`
- Totals: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_totals_SOLUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_regime_chart_SOLUSDT_1h_m48.png`
