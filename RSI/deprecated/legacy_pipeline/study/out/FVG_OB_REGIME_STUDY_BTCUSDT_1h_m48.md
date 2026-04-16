# FVG + Order Block Proxy Study: BTCUSDT (1h)

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
| FVG | bearish | 2256 |
| FVG | bullish | 2388 |
| ORDER_BLOCK_PROXY | bearish | 923 |
| ORDER_BLOCK_PROXY | bullish | 923 |

## Counts by Combined Regime

| event_type | event_side | combined_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | BALANCE__NORMAL_VOL | 1673 |
| FVG | bearish | IMBALANCE__NORMAL_VOL | 328 |
| FVG | bearish | BALANCE__HIGH_VOL | 144 |
| FVG | bearish | IMBALANCE__HIGH_VOL | 78 |
| FVG | bearish | BALANCE__LOW_VOL | 31 |
| FVG | bearish | IMBALANCE__LOW_VOL | 2 |
| FVG | bullish | BALANCE__NORMAL_VOL | 1786 |
| FVG | bullish | IMBALANCE__NORMAL_VOL | 385 |
| FVG | bullish | BALANCE__HIGH_VOL | 130 |
| FVG | bullish | IMBALANCE__HIGH_VOL | 43 |
| FVG | bullish | BALANCE__LOW_VOL | 41 |
| FVG | bullish | IMBALANCE__LOW_VOL | 3 |
| ORDER_BLOCK_PROXY | bearish | BALANCE__NORMAL_VOL | 608 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE__NORMAL_VOL | 138 |
| ORDER_BLOCK_PROXY | bearish | BALANCE__HIGH_VOL | 128 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE__HIGH_VOL | 49 |
| ORDER_BLOCK_PROXY | bullish | BALANCE__NORMAL_VOL | 675 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE__NORMAL_VOL | 163 |
| ORDER_BLOCK_PROXY | bullish | BALANCE__HIGH_VOL | 62 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE__HIGH_VOL | 23 |

## Counts by Structure Regime

| event_type | event_side | structure_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | BALANCE | 1848 |
| FVG | bearish | IMBALANCE | 408 |
| FVG | bullish | BALANCE | 1957 |
| FVG | bullish | IMBALANCE | 431 |
| ORDER_BLOCK_PROXY | bearish | BALANCE | 736 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE | 187 |
| ORDER_BLOCK_PROXY | bullish | BALANCE | 737 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE | 186 |

## Counts by Vol Regime

| event_type | event_side | vol_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | NORMAL_VOL | 2001 |
| FVG | bearish | HIGH_VOL | 222 |
| FVG | bearish | LOW_VOL | 33 |
| FVG | bullish | NORMAL_VOL | 2171 |
| FVG | bullish | HIGH_VOL | 173 |
| FVG | bullish | LOW_VOL | 44 |
| ORDER_BLOCK_PROXY | bearish | NORMAL_VOL | 746 |
| ORDER_BLOCK_PROXY | bearish | HIGH_VOL | 177 |
| ORDER_BLOCK_PROXY | bullish | NORMAL_VOL | 838 |
| ORDER_BLOCK_PROXY | bullish | HIGH_VOL | 85 |

## Counts by Regime Bias

| event_type | event_side | regime_bias | count |
| --- | --- | --- | --- |
| FVG | bearish | bearish | 1193 |
| FVG | bearish | bullish | 538 |
| FVG | bearish | neutral | 525 |
| FVG | bullish | bullish | 1285 |
| FVG | bullish | bearish | 571 |
| FVG | bullish | neutral | 532 |
| ORDER_BLOCK_PROXY | bearish | bearish | 435 |
| ORDER_BLOCK_PROXY | bearish | bullish | 300 |
| ORDER_BLOCK_PROXY | bearish | neutral | 188 |
| ORDER_BLOCK_PROXY | bullish | bullish | 446 |
| ORDER_BLOCK_PROXY | bullish | bearish | 315 |
| ORDER_BLOCK_PROXY | bullish | neutral | 162 |

## Artifacts

- Events: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_events_BTCUSDT_1h_m48.csv`
- By combined regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_combined_regime_BTCUSDT_1h_m48.csv`
- By structure regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_structure_regime_BTCUSDT_1h_m48.csv`
- By vol regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_vol_regime_BTCUSDT_1h_m48.csv`
- By regime bias: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_regime_bias_BTCUSDT_1h_m48.csv`
- Totals: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_totals_BTCUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_regime_chart_BTCUSDT_1h_m48.png`
