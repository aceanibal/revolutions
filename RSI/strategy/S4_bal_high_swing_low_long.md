# S4 — BAL+HIGH Swing Low Long (equal-lows sweep + BE lock)

## Thesis

Inside a BALANCED, HIGH-vol regime, a liquidity sweep below an equal-lows
cluster that closes back above the cluster is a mean-reversion long setup.
The BE-lock at 3.5R converts a volatile distribution into asymmetric one:
large right-tail winners still run, 3.5R excursions that reverse become
+1R wins instead of full losses.

## Signal (1h)

Source: `lab/study_swing_low_sweep.py :: collect_sweep_signals`, filtered
post-hoc for `structure == BALANCED` and `vol_q == HIGH`.

- `lookback = 50` bars — window for equal-lows detection
- `tolerance = 0.005` (0.5 %) — price equality window for "equal lows"
- `min_swing = 5` — minimum count in the lows cluster
- `rejection_min = 0.90` — sweep must reject the break with ≥90 % bar
  body closing back above the cluster

Entry: next 1h bar open.

## Stop

Fixed `ATR × 2.0` below entry.

`risk = ATR × 2.0`

## Active management — BE lock

Single-stage profit lock:

- `mfe_trigger = 3.5R` — when MFE (in R) reaches 3.5, the stop moves
- `lock_offset = +1.0R` — new stop is placed at `entry + 1.0R`
- Stop is monotonic — can only tighten, never loosen.

Source: `lab/sim/exit.py :: replay_trade_5m` with `be_trigger_r=3.5`,
`be_offset_r=1.0`.

## Take profit

`TP = 19.5R` above entry. Large TP — S4 is the Calmar leader; the edge is
in the tails that reach +10 to +19R.

## Replay

`lab/sim/exit.py :: replay_trade_5m` (fee=3.0 bps, same-bar stop/TP
activation, BE-lock active).

## Universe

All six symbols: BTC, ETH, SOL, LINK, DOGE, XRP.

## Reference stats — `runs/run_all_streams_20260416T153516Z/`

| metric | value |
| --- | --- |
| n signals | 274 |
| win % | 29.56 |
| total R (managed) | +290.46 |
| total R (baseline, no lock) | +377.46 |
| saved R from lock | **−87.00** (costs total R, buys DD reduction) |
| maxDD_R (managed) | 21.67 |
| maxDD_R (baseline) | 28.36 |
| BE hits | 59 |
| TP hits | 22 |
| SL hits | 193 |

## BE-lock impact breakdown

| bucket | n | total saved R | avg save |
| --- | --- | --- | --- |
| improved (saved_r > 0) | 49 | +98 | +2.00 |
| worsened (saved_r < 0) | 10 | −185 | −18.50 |
| unchanged | 215 | 0 | 0 |

The 10 "worsened" trades are the ones that locked at +1R then continued to
a big right-tail winner that we no longer caught. Net: the lock converts
volatility into hit rate at the cost of ~87R total return.

## Per-asset BE-lock delta vs baseline

| sym | managed | baseline | saved_r |
| --- | --- | --- | --- |
| BTCUSDT | +52.72 | +94.22 | −41.50 |
| DOGEUSDT | +54.49 | +48.49 | +6.00 |
| ETHUSDT | +38.74 | +59.74 | −21.00 |
| LINKUSDT | +32.91 | +12.91 | +20.00 |
| SOLUSDT | +45.97 | +93.97 | −48.00 |
| XRPUSDT | +65.62 | +68.12 | −2.50 |

## Why these values

- `rejection_min=0.90` — high threshold; accept only very strong rejections.
  A looser rejection (0.80) triples signal count but collapses Calmar.
- `lookback=50`, `tolerance=0.005`, `min_swing=5` — canonical sweep
  definition; tested in `lab/study_swing_low_sweep.py`.
- `atr_mult=2.0` — standard risk basis.
- `trig_r=3.5`, `lock_r=1.0` — single-stage lock confirmed in
  `lab/study_swing_low_locks.py`. A 2-stage ladder was tested and did not
  add edge.
- `tp_r=19.5` — fat-tail target; confirmed via trigger sweeps.

## Canonical files

- Signal: `lab/study_swing_low_sweep.py :: collect_sweep_signals`
- Lock sweeps: `lab/study_swing_low_locks.py`,
  `lab/study_swing_low_trigger_sweep.py`
- Replay: `lab/sim/exit.py :: replay_trade_5m` (BE branch)
- Master runner: `lab/run_all_streams.py` (S4 block)
- Cached reference output: `cache/swing_low_sweep.csv`

## History

- New as of 2026-04-16; added as the portfolio's Calmar anchor.
- Lock parameters finalised on `study_swing_low_locks.py` — the 3.5R trigger
  is chosen because the MFE bucket breakdown shows 0% win in ≤2R buckets,
  and a flat 100% win at ≥3.5R when the lock is engaged, with the >10R
  bucket almost unaffected.
