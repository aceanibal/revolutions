# S1 — IMBAL+HIGH Long (bullish momentum continuation)

## Thesis

IMBAL+HIGH 1h bars where the close pins the high, the body is dominant, and
volume is elevated mark a regime transition where trend followers commit.
The edge is fat-tailed: low hit rate, large right-tail winners. Fixed ATR×2
stop keeps losers bounded; TP=12R captures the outliers that pay for the
misses.

## Signal (1h)

Source: `lab/study_imbalanced_trend.py :: collect_imbalanced_signals` (long side)

- structure = `IMBALANCED`
- vol_q = `HIGH` (rolling quantile p67)
- `body_pct > 0.55`
- `close_pct > 1 − 0.15 = 0.85` (close near high)
- `vol_ratio > 1.8`
- bullish bar (`close > open`)

Entry: next 1h bar open.

## Stop

Fixed `ATR×2.0` below entry (ATR = 14-period on 1h bars of the signal bar).
No MFE ladder, no BE-lock.

## Take profit

`TP = 12R` above entry. Fat-tail target; the right tail of the R
distribution is what pays.

## Replay

Source: `lab/study_imbalanced_trend.py :: replay_trend`
(5m bar replay, fee=3.0 bps, same-bar stop/TP activation).

## Universe

BTC, ETH, SOL, LINK, DOGE, XRP — all six symbols.
**Do not** exclude DOGE from S1 (it is part of the confirmed reference).

## Reference stats — `runs/run_all_streams_20260416T153516Z/`

| metric | value |
| --- | --- |
| n signals | 778 |
| win % | 12.08 |
| total R | +432.97 |
| avg R | 0.56 |
| ann_R | ≈ 101 / yr |
| maxDD_R | 70.27 |
| MCL | 63 |
| SL / TP | 684 / 94 |

Year breakdown (total R): 2022 −58.6 / 2023 +241.2 / 2024 +238.8 / 2025 +42.2
/ 2026 YTD −30.6.

Per-asset total R: BTC +175.8, SOL +100.5, ETH +84.0, DOGE +41.5, LINK +41.6,
XRP −10.5.

## Why these values

- `close_pct_max=0.15` — only accept bars that close in the top 15% of their
  range. Rejects doji/wicks.
- `body_pct_min=0.55` — require meaningful body, not just a range spike.
- `vol_ratio_min=1.8` — require volume commitment; filters slow drifts.
- `atr_mult=2.0` — wide enough to let the entry bar's wick breathe without
  premature whipsaw.
- `tp_r=12.0` — determined empirically; higher TP sensitivities show 8R/10R
  leave R on the table, 14R/16R slightly higher but at the cost of more
  never-filled trades.

## Canonical files

- Signal: `lab/study_imbalanced_trend.py :: collect_imbalanced_signals`
- Replay: `lab/study_imbalanced_trend.py :: replay_trend`
- Master runner: `lab/run_all_streams.py` (S1 block)
- Investigation (2026-04-16): deprecated `lab/_investigate_imbal_long.py`,
  evidence archived in `deprecated/reports/RESEARCH_REPORT_2026-04-15.md`.

## History

- Pre-2026-04-16 S1 was incorrectly documented as "4h RSI crossover + MFE
  ladder, TP=13R". Under the current simulator (same-bar stop activation)
  that configuration underperformed badly and the MFE ladder actively hurt.
- On 2026-04-16 the real S1 was identified as the long side of
  `collect_imbalanced_signals`. A one-off verification script reproduced the
  reference stats (n=778, 12.08% win, +433R, maxDD≈70R).
