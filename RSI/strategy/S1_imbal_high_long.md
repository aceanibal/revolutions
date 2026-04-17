# S1 — IMBAL+HIGH Long (bullish momentum continuation)

## Thesis

IMBAL+HIGH 1h bars where the close pins the high, the body is dominant, and
volume is elevated mark a regime transition where trend followers commit.
The edge is fat-tailed: low hit rate, large right-tail winners. Fixed ATR×2
stop keeps losers bounded; TP=12R captures the outliers that pay for the
misses.

Two structural improvements confirmed 2026-04-17 ("Choice B" overhaul):
- **Lever 2 — EMA(200) regime filter** suppresses signals in bear-market
  regimes. Cuts 2022 from −48R to −13R and 2026 from −11R to +7R.
- **Lever 1 — 3.5R→+1R trailing lock** reduces consecutive losing streaks
  from 63 to 20 by converting abandoned runners into small wins at +1R.

## Signal (1h)

Source: `lab/study_imbalanced_trend.py :: collect_imbalanced_signals` (long side)

- structure = `IMBALANCED`
- vol_q = `HIGH` (rolling quantile p67)
- `body_pct > 0.55`
- `close_pct > 1 − 0.15 = 0.85` (close near high)
- `vol_ratio > 1.8`
- bullish bar (`close > open`)
- **Lever 2**: signal bar close must be above EMA(200) on 1h bars.
  Computed on the signal bar (bar i, already closed). No look-ahead.

Entry: next 1h bar open.

## Stop

Fixed `ATR×2.0` below entry (ATR = 14-period on 1h bars of the signal bar).

## Trailing lock (Lever 1)

When MFE reaches **3.5R**, stop moves to `entry + 1.0R`.

Same-bar activation (Rule 11): if price reaches 3.5R MFE and the same 5m bar
reverses through entry+1R, the trade exits at +1R in that bar.

Exit tag: `BE` (same mechanism as S4's lock).

## Take profit

`TP = 12R` above entry. Fat-tail target; the right tail of the R distribution
is what pays. Do not reduce TP — analysis confirmed 12R is the correct level.

## Replay

Source: `lab/sim/exit.py :: replay_trade_5m`
(5m bar replay, fee=3.0 bps, same-bar stop/TP activation).
Parameters: `be_trigger_r=3.5, be_offset_r=1.0`.

## Universe

BTC, ETH, SOL, LINK, DOGE, XRP — canonical six symbols.

**ONDO**: structurally broken on S1 (2.4% TP rate vs ~13% for working assets,
50% of trades never reach 1R MFE). Do not add to S1 universe.

**TAO**: works (+46R with Choice B), but not yet added to canonical universe.
Can be considered for universe expansion in a future study.

## Reference stats — `runs/run_all_streams_20260417T231541Z/` (Choice B)

| metric | value | vs old baseline |
| --- | --- | --- |
| n signals | 674 collected / 671 replayed | −133 (EMA filter) |
| win % (managed) | 28.91% | ↑ from 12.1% |
| total R (managed) | +411 | −22R vs old +433 |
| total R (baseline, no lock) | +450 | +17R vs old +433 |
| avg R | 0.61 | |
| ann_R | ≈ 96 / yr | |
| maxDD_R | **37.78** | ↓ from 70.27 (−46%) |
| MCL | **20** | ↓ from 63 (−68%) |
| SL / BE / TP | 477 / 130 / 64 | |

Year breakdown (managed R):
2022 −13R / 2023 +159R / 2024 +207R / 2025 +50R / 2026 YTD +7R

Per-asset managed total R (Choice B):
BTC +156, ETH +106, SOL +76, LINK +67, DOGE +23, XRP −16.

## Lock decomposition (Lever 1)

Across all 11 assets in the study:
- **213 trades rescued**: lock prevented −1R exit → +1R exit. +426R recovered.
- **37 trades capped**: trade hit 3.5R lock, reversed to +1R, then recovered
  and would have reached 12R TP. −407R cost.
- **Net L1 R impact**: +19R — modest, but MCL drops 63→20.
- The primary value of L1 is **risk management and live-trading psychology**,
  not R maximisation.

## Filter impact (Lever 2)

EMA(200) on 1h drops 17% of signals. Filtered signals were:
- 2022 bear: −48R → −13R (+35R from filtering alone)
- 2026 risk-off: −11R → +7R (+18R from filtering alone)
- Bull years: minor reduction in signals (~10–15%)

## Why these values

- `close_pct_max=0.15` — only accept bars that close in the top 15% of their
  range. Rejects doji/wicks.
- `body_pct_min=0.55` — require meaningful body, not just a range spike.
- `vol_ratio_min=1.8` — require volume commitment; filters slow drifts.
- `atr_mult=2.0` — wide enough to let the entry bar's wick breathe without
  premature whipsaw.
- `tp_r=12.0` — optimal across all TP sensitivity tests; lower TPs reduce
  total R significantly because they sacrifice the 12R outlier winners.
- `ema_filter=200` — suppresses bear-regime entries without over-filtering
  bull regimes. EMA50 is more reactive; EMA200 is more stable.
- `trig_r=3.5` — matches the threshold where abandoned runners cluster
  (212 SL trades reached 3.5R+ in the study; none reached 12R without
  continuing to TP).
- `lock_r=1.0` — locks in a small profit; trade either continues to 12R or
  exits at +1R instead of −1R if it reverses.

## Canonical files

- Signal + EMA filter: `lab/run_all_streams.py :: _collect_s1`
- Replay with lock: `lab/run_all_streams.py :: _replay_managed` (S1 branch)
- Study: `lab/study_imbalanced_trend.py`
- Overhaul study: `lab/study_s1_overhaul.py`
- Overhaul CSV: `cache/s1_overhaul_comparison.csv`
- Master runner: `lab/run_all_streams.py` (S1 block)
- Confirmed run: `runs/run_all_streams_20260417T231541Z/`

## History

- Pre-2026-04-16: incorrectly documented as "4h RSI crossover + MFE ladder,
  TP=13R". Under same-bar stop activation that config underperformed badly.
- 2026-04-16: real S1 identified as the long side of `collect_imbalanced_signals`
  (n=778, 12.08% win, +433R, maxDD≈70R). See deprecated reports.
- 2026-04-17: Choice B overhaul applied (EMA200 regime filter + 3.5R→+1R lock).
  maxDD reduced 70→37.78, MCL reduced 63→20.
