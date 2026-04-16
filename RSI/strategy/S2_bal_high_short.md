# S2 — BAL+HIGH Short (bearish momentum, no FVG)

## Thesis

Inside a BALANCED regime, a strong bearish 1h bar with elevated volume
indicates a local rejection and short-horizon mean-reversion from the range
high. Simple ATR stop, low R multiple — quantity over quality.

## Signal (1h)

Source: `lab/study_fvg_momentum.py :: collect_signals` (ignore `has_fvg` flag).

- structure = `BALANCED`
- vol_q = `HIGH` (rolling quantile p67)
- `close_pct < 0.20` (close near the low)
- bearish bar (`close < open`)
- `vol_ratio > 1.5`
- `body_pct > 0.55`
- **no FVG requirement**

Entry: next 1h bar open.

## Stop

Fixed `ATR×1.5` above entry. No BE-lock, no FVG placement.

`stop = entry + ATR(14) × 1.5`

`risk = ATR × 1.5`

## Take profit

`TP = 3R` below entry. Low-R, high-count target — pairs with ATR×1.5 to give
a meaningful hit-rate profile.

## Replay

Source: `lab/sim/exit.py :: replay_trade_5m` (5m bar replay, fee=3.0 bps,
same-bar stop/TP activation, no management).

## Universe

All six symbols: BTC, ETH, SOL, LINK, DOGE, XRP.

## Reference stats (memory `project_live_streams.md`, from
`lab/sweep_shorts_filtered.py`)

| metric | value |
| --- | --- |
| n signals | ≈ 274 |
| ann_R | ≈ 19.9 / yr |
| win % | 33.2 |
| maxDD_R | 12.7 |
| Calmar | 1.69 |

Current runner reference stats will be pinned after the next
`lab/run_all_streams.py` execution.

## Why these values

- `close_pct_max=0.20` — slightly more permissive than S3 (0.15), because
  we're casting a wider net and relying on higher hit-rate from the ATR stop.
- `vol_ratio_min=1.5` — lower than S3 (1.8) because S2 is the high-volume
  short candidate pool; S3 tightens further and keeps only the best.
- `atr_mult=1.5` — deliberately tighter than S3's `ATR×2` risk basis to
  allow TP=3R to be hit often.
- `tp_r=3.0` — balances against the higher loss rate of a wider signal set.

## Canonical files

- Signal: `lab/study_fvg_momentum.py :: collect_signals` (or
  `lab/sweep_shorts_filtered.py :: collect_signals` — equivalent filter set
  for BAL+HIGH bearish momentum).
- Reference sweep: `lab/sweep_shorts_filtered.py`
- Master runner: `lab/run_all_streams.py` (S2 block)
- Cached reference output: `cache/shorts_filtered_sweep.csv`

## History

- Pre-2026-04-16 the runner's S2 block was mistakenly configured as the
  FVG-filtered FVG-LOW-stop TP=4.25R short (i.e. S3's config). Corrected
  2026-04-16.
- S2 and S3 share the same regime (BAL+HIGH) and side (short). S3 is a
  **subset** of S2's population (only the bars with a bearish FVG),
  traded with a **tighter** FVG-LOW stop and a **higher** TP.
