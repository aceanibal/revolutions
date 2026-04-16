# S5 — IMBAL+HIGH Short (bearish momentum continuation)

## Thesis

In IMBALANCED + HIGH-volatility regimes, strong bearish 1h momentum bars can
continue lower rather than mean-revert. This is the short-side counterpart to
S1's trend-continuation logic: low win rate, positive expectancy via larger
R-multiple winners.

## Signal (1h)

Source: `lab/study_imbalanced_trend.py :: collect_imbalanced_signals` (short side)

- structure = `IMBALANCED`
- vol_q = `HIGH` (rolling quantile p67)
- bearish bar (`close < open`)
- `body_pct > 0.55`
- `close_pct < 0.15` (close near low)
- `vol_ratio > 1.8`

Entry: next 1h bar open.

## Stop

Fixed `ATR×2.0` above entry (ATR = 14-period on 1h bars of the signal bar).
No lock, no ladder.

## Take profit

`TP = 5R` below entry.

## Replay

Source: `lab/study_imbalanced_trend.py :: replay_trend`
(5m bar replay, fee=3.0 bps, same-bar stop/TP activation, no active management).

## Universe

BTC, ETH, SOL, LINK, DOGE, XRP.

## Reference stats (historical baseline)

Historical baseline reported in project chat history (combined portfolio check,
2022-start window, crypto x6):

| metric | value |
| --- | --- |
| n signals | 631 |
| win % | 21.1 |
| total R | +158.7 |
| ann_R | ≈ 37.0 / yr |
| maxDD_R | 67.1 |

Runner-pinned run-folder stats should be added after next `run_all_streams`
execution that includes S5.

## Why these values

- `close_pct_max=0.15` — requires closes near bar lows, preserving momentum
  quality.
- `body_pct_min=0.55` — rejects weak bearish candles.
- `vol_ratio_min=1.8` — requires participation, reducing drift entries.
- `atr_mult=2.0` — keeps stop behavior aligned with S1/S3 risk basis.
- `tp_r=5.0` — historical short-side optimum from IMBAL trend sweeps.

## Canonical files

- Signal: `lab/study_imbalanced_trend.py :: collect_imbalanced_signals` (side = -1)
- Replay: `lab/study_imbalanced_trend.py :: replay_trend`
- Study/sweep: `lab/study_imbalanced_trend.py`

## Notes

- This stream is crypto-only in historical tests; prior PAXG checks for the
  same setup were negative and excluded from stream definitions.
