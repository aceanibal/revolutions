# FVG + Order Block Proxy Study: ETHUSDT (1h)

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
| FVG | bearish | 2483 |
| FVG | bullish | 2579 |
| ORDER_BLOCK_PROXY | bearish | 910 |
| ORDER_BLOCK_PROXY | bullish | 877 |

## Counts by Combined Regime

| event_type | event_side | combined_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | BALANCE__NORMAL_VOL | 1825 |
| FVG | bearish | IMBALANCE__NORMAL_VOL | 360 |
| FVG | bearish | BALANCE__HIGH_VOL | 165 |
| FVG | bearish | IMBALANCE__HIGH_VOL | 76 |
| FVG | bearish | BALANCE__LOW_VOL | 52 |
| FVG | bearish | IMBALANCE__LOW_VOL | 5 |
| FVG | bullish | BALANCE__NORMAL_VOL | 1930 |
| FVG | bullish | IMBALANCE__NORMAL_VOL | 447 |
| FVG | bullish | BALANCE__HIGH_VOL | 90 |
| FVG | bullish | BALANCE__LOW_VOL | 57 |
| FVG | bullish | IMBALANCE__HIGH_VOL | 49 |
| FVG | bullish | IMBALANCE__LOW_VOL | 6 |
| ORDER_BLOCK_PROXY | bearish | BALANCE__NORMAL_VOL | 608 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE__NORMAL_VOL | 136 |
| ORDER_BLOCK_PROXY | bearish | BALANCE__HIGH_VOL | 115 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE__HIGH_VOL | 51 |
| ORDER_BLOCK_PROXY | bullish | BALANCE__NORMAL_VOL | 644 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE__NORMAL_VOL | 170 |
| ORDER_BLOCK_PROXY | bullish | BALANCE__HIGH_VOL | 49 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE__HIGH_VOL | 14 |

## Counts by Structure Regime

| event_type | event_side | structure_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | BALANCE | 2042 |
| FVG | bearish | IMBALANCE | 441 |
| FVG | bullish | BALANCE | 2077 |
| FVG | bullish | IMBALANCE | 502 |
| ORDER_BLOCK_PROXY | bearish | BALANCE | 723 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE | 187 |
| ORDER_BLOCK_PROXY | bullish | BALANCE | 693 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE | 184 |

## Counts by Vol Regime

| event_type | event_side | vol_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | NORMAL_VOL | 2185 |
| FVG | bearish | HIGH_VOL | 241 |
| FVG | bearish | LOW_VOL | 57 |
| FVG | bullish | NORMAL_VOL | 2377 |
| FVG | bullish | HIGH_VOL | 139 |
| FVG | bullish | LOW_VOL | 63 |
| ORDER_BLOCK_PROXY | bearish | NORMAL_VOL | 744 |
| ORDER_BLOCK_PROXY | bearish | HIGH_VOL | 166 |
| ORDER_BLOCK_PROXY | bullish | NORMAL_VOL | 814 |
| ORDER_BLOCK_PROXY | bullish | HIGH_VOL | 63 |

## Counts by Regime Bias

| event_type | event_side | regime_bias | count |
| --- | --- | --- | --- |
| FVG | bearish | bearish | 1357 |
| FVG | bearish | bullish | 602 |
| FVG | bearish | neutral | 524 |
| FVG | bullish | bullish | 1383 |
| FVG | bullish | bearish | 641 |
| FVG | bullish | neutral | 555 |
| ORDER_BLOCK_PROXY | bearish | bearish | 435 |
| ORDER_BLOCK_PROXY | bearish | bullish | 282 |
| ORDER_BLOCK_PROXY | bearish | neutral | 193 |
| ORDER_BLOCK_PROXY | bullish | bullish | 428 |
| ORDER_BLOCK_PROXY | bullish | bearish | 293 |
| ORDER_BLOCK_PROXY | bullish | neutral | 156 |

## Artifacts

- Events: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_events_ETHUSDT_1h_m48.csv`
- By combined regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_combined_regime_ETHUSDT_1h_m48.csv`
- By structure regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_structure_regime_ETHUSDT_1h_m48.csv`
- By vol regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_vol_regime_ETHUSDT_1h_m48.csv`
- By regime bias: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_regime_bias_ETHUSDT_1h_m48.csv`
- Totals: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_totals_ETHUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_regime_chart_ETHUSDT_1h_m48.png`
