# FVG + Order Block Proxy Study: LINKUSDT (1h)

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
| FVG | bearish | 2849 |
| FVG | bullish | 2916 |
| ORDER_BLOCK_PROXY | bearish | 925 |
| ORDER_BLOCK_PROXY | bullish | 1000 |

## Counts by Combined Regime

| event_type | event_side | combined_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | BALANCE__NORMAL_VOL | 2067 |
| FVG | bearish | IMBALANCE__NORMAL_VOL | 405 |
| FVG | bearish | BALANCE__HIGH_VOL | 205 |
| FVG | bearish | BALANCE__LOW_VOL | 94 |
| FVG | bearish | IMBALANCE__HIGH_VOL | 66 |
| FVG | bearish | IMBALANCE__LOW_VOL | 12 |
| FVG | bullish | BALANCE__NORMAL_VOL | 2183 |
| FVG | bullish | IMBALANCE__NORMAL_VOL | 459 |
| FVG | bullish | BALANCE__HIGH_VOL | 129 |
| FVG | bullish | BALANCE__LOW_VOL | 76 |
| FVG | bullish | IMBALANCE__HIGH_VOL | 49 |
| FVG | bullish | IMBALANCE__LOW_VOL | 20 |
| ORDER_BLOCK_PROXY | bearish | BALANCE__NORMAL_VOL | 603 |
| ORDER_BLOCK_PROXY | bearish | BALANCE__HIGH_VOL | 154 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE__NORMAL_VOL | 126 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE__HIGH_VOL | 42 |
| ORDER_BLOCK_PROXY | bullish | BALANCE__NORMAL_VOL | 740 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE__NORMAL_VOL | 175 |
| ORDER_BLOCK_PROXY | bullish | BALANCE__HIGH_VOL | 61 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE__HIGH_VOL | 24 |

## Counts by Structure Regime

| event_type | event_side | structure_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | BALANCE | 2366 |
| FVG | bearish | IMBALANCE | 483 |
| FVG | bullish | BALANCE | 2388 |
| FVG | bullish | IMBALANCE | 528 |
| ORDER_BLOCK_PROXY | bearish | BALANCE | 757 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE | 168 |
| ORDER_BLOCK_PROXY | bullish | BALANCE | 801 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE | 199 |

## Counts by Vol Regime

| event_type | event_side | vol_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | NORMAL_VOL | 2472 |
| FVG | bearish | HIGH_VOL | 271 |
| FVG | bearish | LOW_VOL | 106 |
| FVG | bullish | NORMAL_VOL | 2642 |
| FVG | bullish | HIGH_VOL | 178 |
| FVG | bullish | LOW_VOL | 96 |
| ORDER_BLOCK_PROXY | bearish | NORMAL_VOL | 729 |
| ORDER_BLOCK_PROXY | bearish | HIGH_VOL | 196 |
| ORDER_BLOCK_PROXY | bullish | NORMAL_VOL | 915 |
| ORDER_BLOCK_PROXY | bullish | HIGH_VOL | 85 |

## Counts by Regime Bias

| event_type | event_side | regime_bias | count |
| --- | --- | --- | --- |
| FVG | bearish | bearish | 1596 |
| FVG | bearish | bullish | 655 |
| FVG | bearish | neutral | 598 |
| FVG | bullish | bullish | 1509 |
| FVG | bullish | bearish | 764 |
| FVG | bullish | neutral | 643 |
| ORDER_BLOCK_PROXY | bearish | bearish | 417 |
| ORDER_BLOCK_PROXY | bearish | bullish | 327 |
| ORDER_BLOCK_PROXY | bearish | neutral | 181 |
| ORDER_BLOCK_PROXY | bullish | bullish | 541 |
| ORDER_BLOCK_PROXY | bullish | bearish | 295 |
| ORDER_BLOCK_PROXY | bullish | neutral | 164 |

## Artifacts

- Events: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_events_LINKUSDT_1h_m48.csv`
- By combined regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_combined_regime_LINKUSDT_1h_m48.csv`
- By structure regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_structure_regime_LINKUSDT_1h_m48.csv`
- By vol regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_vol_regime_LINKUSDT_1h_m48.csv`
- By regime bias: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_regime_bias_LINKUSDT_1h_m48.csv`
- Totals: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_totals_LINKUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_regime_chart_LINKUSDT_1h_m48.png`
