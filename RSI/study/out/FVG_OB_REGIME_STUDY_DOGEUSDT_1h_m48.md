# FVG + Order Block Proxy Study: DOGEUSDT (1h)

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
| FVG | bearish | 2677 |
| FVG | bullish | 2626 |
| ORDER_BLOCK_PROXY | bearish | 937 |
| ORDER_BLOCK_PROXY | bullish | 883 |

## Counts by Combined Regime

| event_type | event_side | combined_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | BALANCE__NORMAL_VOL | 2001 |
| FVG | bearish | IMBALANCE__NORMAL_VOL | 422 |
| FVG | bearish | BALANCE__HIGH_VOL | 134 |
| FVG | bearish | IMBALANCE__HIGH_VOL | 73 |
| FVG | bearish | BALANCE__LOW_VOL | 44 |
| FVG | bearish | IMBALANCE__LOW_VOL | 3 |
| FVG | bullish | BALANCE__NORMAL_VOL | 1945 |
| FVG | bullish | IMBALANCE__NORMAL_VOL | 437 |
| FVG | bullish | BALANCE__HIGH_VOL | 100 |
| FVG | bullish | IMBALANCE__HIGH_VOL | 67 |
| FVG | bullish | BALANCE__LOW_VOL | 64 |
| FVG | bullish | IMBALANCE__LOW_VOL | 13 |
| ORDER_BLOCK_PROXY | bearish | BALANCE__NORMAL_VOL | 583 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE__NORMAL_VOL | 164 |
| ORDER_BLOCK_PROXY | bearish | BALANCE__HIGH_VOL | 131 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE__HIGH_VOL | 59 |
| ORDER_BLOCK_PROXY | bullish | BALANCE__NORMAL_VOL | 590 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE__NORMAL_VOL | 188 |
| ORDER_BLOCK_PROXY | bullish | BALANCE__HIGH_VOL | 70 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE__HIGH_VOL | 35 |

## Counts by Structure Regime

| event_type | event_side | structure_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | BALANCE | 2179 |
| FVG | bearish | IMBALANCE | 498 |
| FVG | bullish | BALANCE | 2109 |
| FVG | bullish | IMBALANCE | 517 |
| ORDER_BLOCK_PROXY | bearish | BALANCE | 714 |
| ORDER_BLOCK_PROXY | bearish | IMBALANCE | 223 |
| ORDER_BLOCK_PROXY | bullish | BALANCE | 660 |
| ORDER_BLOCK_PROXY | bullish | IMBALANCE | 223 |

## Counts by Vol Regime

| event_type | event_side | vol_regime | count |
| --- | --- | --- | --- |
| FVG | bearish | NORMAL_VOL | 2423 |
| FVG | bearish | HIGH_VOL | 207 |
| FVG | bearish | LOW_VOL | 47 |
| FVG | bullish | NORMAL_VOL | 2382 |
| FVG | bullish | HIGH_VOL | 167 |
| FVG | bullish | LOW_VOL | 77 |
| ORDER_BLOCK_PROXY | bearish | NORMAL_VOL | 747 |
| ORDER_BLOCK_PROXY | bearish | HIGH_VOL | 190 |
| ORDER_BLOCK_PROXY | bullish | NORMAL_VOL | 778 |
| ORDER_BLOCK_PROXY | bullish | HIGH_VOL | 105 |

## Counts by Regime Bias

| event_type | event_side | regime_bias | count |
| --- | --- | --- | --- |
| FVG | bearish | bearish | 1481 |
| FVG | bearish | bullish | 618 |
| FVG | bearish | neutral | 578 |
| FVG | bullish | bullish | 1290 |
| FVG | bullish | bearish | 749 |
| FVG | bullish | neutral | 587 |
| ORDER_BLOCK_PROXY | bearish | bearish | 449 |
| ORDER_BLOCK_PROXY | bearish | bullish | 309 |
| ORDER_BLOCK_PROXY | bearish | neutral | 179 |
| ORDER_BLOCK_PROXY | bullish | bullish | 479 |
| ORDER_BLOCK_PROXY | bullish | bearish | 249 |
| ORDER_BLOCK_PROXY | bullish | neutral | 155 |

## Artifacts

- Events: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_events_DOGEUSDT_1h_m48.csv`
- By combined regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_combined_regime_DOGEUSDT_1h_m48.csv`
- By structure regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_structure_regime_DOGEUSDT_1h_m48.csv`
- By vol regime: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_vol_regime_DOGEUSDT_1h_m48.csv`
- By regime bias: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_counts_by_regime_bias_DOGEUSDT_1h_m48.csv`
- Totals: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_totals_DOGEUSDT_1h_m48.csv`
- Chart: `/Users/anibalperez/revolutions/RSI/study/out/fvg_ob_regime_chart_DOGEUSDT_1h_m48.png`
