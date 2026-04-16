---
name: Swing Low Sweep Strategy Research
description: Key findings from BAL+HIGH swing low liquidity grab research — signal logic, what worked, what didn't
type: project
originSessionId: ec260109-55dd-42c6-882c-a908d1ac26ca
---
# Swing Low Sweep — Research Summary (2026-04-16)

## What the strategy is

Equal-lows liquidity sweep on 1h bars. Finds 2+ swing lows within 0.5% of each other
(the "trap level"), waits for price to dip below it and close back above in the same bar
(V-shape), then enters long next bar.

Key quality filter: rejection_min=0.90 — close must be in top 10% of the bar's range.
This alone is the most important filter: requiring 0.90 vs 0.60 cut the noise dramatically.

## What was rejected

- **All regimes mixed together**: edge exists but is diluted
- **BAL+MED**: structural drag with Calmar=-0.16. Genuinely harmful, not just weak
- **BAL+LOW**: some edge (Calmar=0.33) but not worth the noise
- **IMBAL regimes**: swing lows in trending regimes don't have the same mean-reversion snap
- **Wick stop**: underperforms ATR stop in BAL+HIGH (unlike other strategies)
  — in HIGH vol, the entry bar itself is the natural anchor
- **MFE ladders**: more complex but worse Calmar than simple single-trigger (3.51 → 3.86)
- **LINK exclusion**: LINK contributes 0.8 ann_R — nearly dead weight, consider dropping

## What matters most (in order)

1. **BAL+HIGH regime filter** — everything below HIGH vol is noise or drag
2. **rejection_min=0.90** — only near-perfect V-shapes count
3. **Trigger at 3.5R, lock to +1.0R** — converts ~18% of trades from -1R to +1R
4. **High TP (19.5R)** — strategy needs long TPs; edge comes from rare big runners
   The few winners (10-12% TP hit rate) go far

## Sweep depth finding (counterintuitive)

In the mixed-regime study, shallow sweeps (<0.2 ATR) were better (Calmar 0.97 vs 0.08).
But in BAL+HIGH specifically, deeper sweeps (>0.5 ATR) have better Calmar (1.00 vs 0.84).
Reason: in HIGH vol, a deeper stop hunt required more institutional size → stronger reversal.

## Heatmap robust zone (trig × lock at TP=19.5R)

The Calmar peak isn't a single point — there's a stable plateau:
- trig=3.0–4.0R, lock=0.0–1.0R all produce Calmar ≥ 3.4
- Best single point: trig=3.5R, lock=+1.0R → Calmar=3.86
- Runner-up: trig=3.5R, lock=+0.5R → Calmar=3.70 (all years positive, 2022: +7R)

## 2022 issue

The only consistently negative year. 41 signals, 17% win rate.
- With trig=3.5R → lock=+1.0R: -9.0R in 2022
- With trig=3.5R → lock=+0.5R: +7.0R in 2022 (fully rescues it)
2022 was a bear-dominated year — swing lows in BAL+HIGH during a bear market
get swept and don't recover as cleanly.

## Practical TP alternatives

If 19.5R is too hard to hold:
- TP=12R, trig=3.5R→BE: ann=49.1, maxDD=17.2, Calmar=2.85
- TP=16R, trig=3.5R→+1R: ann=49.8, maxDD=17.6, Calmar=2.84
Same DD profile, ~30% less annual return.

## Scripts

- `lab/study_swing_low_sweep.py` — initial BAL/IMBAL/regime sweep, added --vol-q filter
- `lab/study_swing_low_locks.py` — single-trigger and MFE ladder comparison
- `lab/study_swing_low_trigger_sweep.py` — full 483-config grid (trig × lock × TP)
