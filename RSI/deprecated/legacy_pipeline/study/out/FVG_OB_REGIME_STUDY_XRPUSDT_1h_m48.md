# FVG + Order Block Proxy Study: XRPUSDT (1h)

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
| FVG | bearish | 2645 |
| FVG | bullish | 2587 |
| ORDER_BLOCK_PROXY | bearish | 991 |
| ORDER_BLOCK_PROXY | bullish | 818 |

## Counts by Combined Regime

| event_type | event_side | combined_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | BALANCE__NORMAL_VOL | 1977 |
| FVG | bearish | IMBALANCE__NORMAL_VOL | 404 |
| FVG | bearish | BALANCE__HIGH_VOL | 135 |
| FVG | bearish | IMBALANCE__HIGH_VOL | 84 |
| FVG | bearish | BALANCE__LOW_VOL | 45 |
| FVG | bullish | BALANCE__NORMAL_VOL | 1877 |
| FVG | bullish | IMBALANCE__NORMAL_VOL | 441 |
| FVG | bullish | BALANCE__HIGH_VOL | 107 |
| FVG | bullish | IMBALANCE__HIGH_VOL | 90 |
| FVG | bullish | BALANCE__LOW_VOL | 66 |
| FVG | bullish | IMBALANCE__LOW_VOL | 6 |
| ORDER_BLOCK_PROXY | bearish | BALANCE__NORMAL_VOL | 660 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE__NORMAL_VOL | 160 |
| ORDER_BLOCK_PROXY | bearish | BALANCE__HIGH_VOL | 112 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE__HIGH_VOL | 59 |
| ORDER_BLOCK_PROXY | bullish | BALANCE__NORMAL_VOL | 576 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE__NORMAL_VOL | 167 |
| ORDER_BLOCK_PROXY | bullish | BALANCE__HIGH_VOL | 54 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE__HIGH_VOL | 21 |

## Counts by Structure Regime

| event_type | event_side | structure_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | BALANCE | 2157 |
| FVG | bearish | IMBALANCE | 488 |
| FVG | bullish | BALANCE | 2050 |
| FVG | bullish | IMBALANCE | 537 |
| ORDER_BLOCK_PROXY | bearish | BALANCE | 772 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE | 219 |
| ORDER_BLOCK_PROXY | bullish | BALANCE | 630 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE | 188 |

## Counts by Vol Regime

| event_type | event_side | vol_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | NORMAL_VOL | 2381 |
| FVG | bearish | HIGH_VOL | 219 |
| FVG | bearish | LOW_VOL | 45 |
| FVG | bullish | NORMAL_VOL | 2318 |
| FVG | bullish | HIGH_VOL | 197 |
| FVG | bullish | LOW_VOL | 72 |
| ORDER_BLOCK_PROXY | bearish | NORMAL_VOL | 820 |
| ORDER_BLOCK_PROXY | bearish | HIGH_VOL | 171 |
| ORDER_BLOCK_PROXY | bullish | NORMAL_VOL | 743 |
| ORDER_BLOCK_PROXY | bullish | HIGH_VOL | 75 |

## Counts by Regime Bias

| event_type | event_side | regime_bias | count |
| --- | --- | --- | --- |
| FVG | bearish | bearish | 1494 |
| FVG | bearish | bullish | 608 |
| FVG | bearish | neutral | 543 |
| FVG | bullish | bullish | 1295 |
| FVG | bullish | bearish | 712 |
| FVG | bullish | neutral | 580 |
| ORDER_BLOCK_PROXY | bearish | bearish | 468 |
| ORDER_BLOCK_PROXY | bearish | bullish | 333 |
| ORDER_BLOCK_PROXY | bearish | neutral | 190 |
| ORDER_BLOCK_PROXY | bullish | bullish | 396 |
| ORDER_BLOCK_PROXY | bullish | bearish | 283 |
| ORDER_BLOCK_PROXY | bullish | neutral | 139 |

## Artifacts

- Events: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_events_XRPUSDT_1h_m48.csv`
- By combined regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_combined_regime_XRPUSDT_1h_m48.csv`
- By structure regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_structure_regime_XRPUSDT_1h_m48.csv`
- By vol regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_vol_regime_XRPUSDT_1h_m48.csv`
- By regime bias: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_regime_bias_XRPUSDT_1h_m48.csv`
- Totals: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_totals_XRPUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_regime_chart_XRPUSDT_1h_m48.png`
