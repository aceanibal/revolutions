# S3 — BAL+HIGH Short with FVG filter (FVG-LOW stop)

## Thesis

Within S2's universe, bearish bars that also leave a bearish Fair Value Gap
above them (`high[i] < low[i-2]`) signal an accelerated rejection. The gap
is the invalidation zone: if price fills it, the setup is wrong and we exit
cheaply. Because the stop is placed just above the gap bottom, losers are
much smaller than a full ATR×2 stop, which is the whole point.

## Signal (1h)

Source: `lab/study_fvg_momentum.py :: collect_signals` with `has_fvg=True`.

- structure = `BALANCED`
- vol_q = `HIGH`
- `close_pct < 0.15` (tight — close pinned to the low)
- bearish bar (`close < open`)
- `vol_ratio > 1.8`
- `body_pct > 0.55`
- **bearish FVG required**: `high[i] < low[i-2]`
- FVG must sit above entry (`fvg_low > entry_p`); otherwise reject.

Entry: next 1h bar open.

## Stop (FVG-LOW)

Source: `lab/study_order_blocks.py :: stop_fvg`

```
stop = fvg_low + ATR × 0.15
     = high[i] + ATR × 0.15
```

The stop sits just above the bottom of the bearish gap with a small ATR
buffer. This keeps the stop **tight** (typically 0.2–0.6 R wide) relative
to the reference risk basis.

**R basis** (used for TP and all R-accounting): `risk = ATR × 2.0`. This is
decoupled from the stop distance so that a 1R loss is comparable across
streams.

## Take profit

`TP = 4.25R` below entry, measured against the `ATR × 2.0` risk basis.

## Active management

None. The FVG-LOW initial stop is already tighter than ATR×2, so a profit
lock would pile on — not used in the confirmed config.

## Replay

Source: `lab/sim/exit.py :: replay_trade_5m` (fee=3.0 bps, same-bar stop/TP
activation, no management).

## Universe

All six symbols: BTC, ETH, SOL, LINK, DOGE, XRP.

## Reference stats (from `lab/study_fvg_lock_sweep.py` baseline)

| metric | value |
| --- | --- |
| n signals | ≈ 226 |
| ann_R | ≈ 33.2 / yr |
| total_R | ≈ +142 |
| win % | 29.6 |
| maxDD_R | 10.3 |
| Calmar | 3.22 |

Compared with the ATR-stop variant (same FVG signals, no FVG-LOW placement):
the ATR variant reaches similar ann_R but with ~3× larger drawdown.

## Regime label — clarification

Older `memory/project_live_streams.md` labelled S3 as "IMBAL+HIGH Short".
That is a mis-labelling: the canonical implementation
(`lab/study_fvg_lock_sweep.py` → `study_fvg_momentum.collect_signals`)
filters on `structure == BALANCED`. The reference stats (n≈226, maxDD≈10.3)
only reproduce under BAL+HIGH. This file is the source of truth; memory has
been corrected.

## Why these values

- `close_pct_max=0.15` — tighter than S2 (0.20); requires the close to be
  stacked on the low.
- `vol_ratio_min=1.8` — tighter than S2 (1.5) to filter to the highest
  quality bars.
- `buf_mult=0.15` — small ATR buffer above `fvg_low` to avoid exiting on
  mechanical spread/wick.
- `tp_r=4.25` — chosen on the FVG-LOW stop grid; higher TPs don't improve
  Calmar because the tight stop plus fat tails already generate enough R
  per winner.
- `atr_mult=2.0` for the R basis — keeps R-accounting comparable with other
  streams.

## Canonical files

- Signal: `lab/study_fvg_momentum.py :: collect_signals` (filter on
  `has_fvg=True`).
- Stop placement: `lab/study_order_blocks.py :: stop_fvg(sig, buf_mult)`.
- Reference sweep: `lab/study_fvg_lock_sweep.py`
- Master runner: `lab/run_all_streams.py` (S3 block)
- Cached reference outputs: `cache/fvg_lock_sweep.csv`,
  `cache/fvg_momentum_study.csv`

## History

- Pre-2026-04-16 the runner's S3 block was running an ATR×2 IMBAL+HIGH short
  variant (TP=5R). That was a rejected experiment, not the confirmed S3.
  Corrected 2026-04-16.
- Memory file originally labelled the regime as IMBAL+HIGH; corrected to
  BAL+HIGH to match the implementation that produced the reference stats.
- 2026-04-16 audit: duplicate content removed (file had been appended 3×
  by AI agents; only the final version retained).
