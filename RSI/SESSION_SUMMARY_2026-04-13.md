# Session Summary - 2026-04-13

## Goal

Build and tune an FVG-based short system around the momentum entry framework, with emphasis on:

- comparing stop logic (`STANDARD` vs `FVG-ONE` vs trailing variants),
- minimizing drawdown,
- and testing whether portfolio/subset choices can improve annualized returns.

---

## What Was Implemented

### 1) `study_fvg_momentum.py` updates

- Added real TP selection from sweep for Section A (removed hardcoded `2.0R` behavior).
- Added configurable `--close-pct-max`.
- Added `--symbols` support.
- Added `--decision-delay-hours`.
- Changed stop behavior to match real workflow:
  - SL/TP active from entry,
  - then one-time stop tighten at decision gate for FVG mode.
- Added stop diagnostics:
  - `SL_hits`
  - `SL_%`

### 2) New trailing study

Created `lab/study_fvg_momentum_trailing.py`:

- Modes:
  - `STANDARD`
  - `FVG-ONE`
  - `FVG-TRAIL` (tighten on each new bearish FVG)
- Audit/fix applied:
  - removed lookahead by activating FVG updates at bar close timing,
  - included initial FVG update parity with one-time mode.

### 3) New entry-only clone

Created `lab/study_fvg_entry_only.py`:

- Removes momentum/regime filters (entry model only),
- keeps FVG tagging,
- compares `STANDARD` vs `FVG-ONE`.

### 4) New drawdown filter optimizer

Created `lab/study_min_drawdown_filters.py`:

- sweeps filter thresholds,
- ranks by lowest `maxDD` (with return/trade context),
- outputs CSV for review.

---

## Major Experiment Results

## A) XRP-only (earlier focused runs)

With delayed decision gate and fixed initial-R accounting:

- `FVG-STOP` often improved low/mid TP behavior.
- At higher TP, `STANDARD` sometimes overtook.

## B) All assets, TP=4.0, start=2024 (asset-by-asset)

Using `FVG-ONE` logic:

- FVG-ONE outperformed total R in 5/6 assets.
- `SOLUSDT` was the primary exception where `STANDARD` was slightly better on total R.
- FVG-ONE generally reduced drawdown.

## C) 1:1 test (TP=1.0)

Question answered: how many winners are sacrificed by FVG-ONE?

- Total sacrificed winners vs `STANDARD`: **8 trades** across assets.
- In many cases, improvement came from smaller stop loss size, not fewer stop hits.

## D) “Do winning trades form more FVGs later?”

Result: yes, strongly.

- About **96%** of winning FVG-tagged trades had at least one additional bearish FVG after the initial one (both standard and FVG-one paths were similar).

## E) Drawdown-focused tuning (all assets, start=2024, TP=4.0, FVG-only)

Best low-DD filter from sweep:

- `vol_ratio > 1.8`
- `body_pct > 0.55`
- `close_pct < 0.15`

Top result from that sweep:

- `n=146`, `total_R=84.18`, `maxDD=6.63`.

## F) TP tuning around 4R (same tuned filter)

Sweep: `3.5, 3.7, 3.8, 3.9, 4.1, 4.2, 4.3, 4.5`

- Best total R in that set: **`TP=4.2R`**
  - `n=146`, `total_R=87.58`, `maxDD=6.63`.

## G) Regime tweak on top of tuned filters

Tested regime combinations:

- `BALANCED+LOW` produced very low DD but lower scale/sample.
- `BALANCED+HIGH` retained stronger practical return+sample balance.

## H) Replay from 2022 with tuned BALANCED+LOW setup

Config:

- `structure=BALANCED`, `vol_q=LOW`
- `vol>1.8`, `body>0.55`, `close<0.15`
- `TP=4.2`, `FVG-ONE`

Result:

- `n=113`, `total_R=29.36`, `maxDD=11.47`, annualized `~5.87R/year`.

Conclusion:

- N is low because stacked filters are highly selective.

---

## Portfolio / Subset Search Toward 200R/year Goal

Large concurrent subset searches were run (including asset removal scenarios).

Outcome:

- **No tested configuration reached 200R/year** under the tested constraints.
- Best annualized candidates were in the `~30-48 R/year` range depending on regime/filter/TP and asset set.
- Removing assets did not unlock a 200R/year solution in tested space.

Notable small-subset standout:

- `BTCUSDT + LINKUSDT + XRPUSDT` with relaxed settings in `BAL_HIGH_LOW` family gave strongest small-set annualized values, but still far below 200R/year.

---

## Compounding Estimates From Discussed Scenarios

Using simplified compounding from yearly R and fixed risk per trade:

- At `1.5%` risk:
  - top all-asset scenario projected much higher growth than conservative subsets.
- At `2.0%` risk:
  - projected growth increased substantially, with proportional risk/drawdown increase.

---

## PAXG Smoke Test

Added `PAXGUSDT` to best current all-asset configuration as a quick smoke test.

Result:

- Slight increase in trade count,
- slight drag on total/annual R,
- no drawdown improvement.

Interpretation:

- PAXG does not improve the current tuned system in the tested setup.

---

## Files Added This Session

- `lab/study_fvg_momentum_trailing.py`
- `lab/study_fvg_entry_only.py`
- `lab/study_min_drawdown_filters.py`
- `SESSION_SUMMARY_2026-04-13.md` (this file)

## Key Output CSVs Produced

- `cache/fvg_momentum_study.csv`
- `cache/fvg_momentum_trailing_study.csv`
- `cache/fvg_entry_only_study.csv`
- `cache/min_drawdown_filter_sweep.csv`
- `cache/regime_tweak_tp4p2.csv`
- `cache/replay_tuned_balanced_low_tp4p2_by_asset.csv`
- `cache/replay_tuned_balanced_low_tp4p2_aggregate.csv`
- `cache/asset_subset_goal_search_BAL_LOW.csv`
- `cache/asset_subset_goal_search_BAL_HIGH.csv`
- `cache/asset_subset_goal_search_BAL_HIGH_LOW.csv`
- `cache/multi_year_compound_top2.csv`
- `cache/smoke_with_paxg.csv`

---

## Final State / Practical Takeaway

- `FVG-ONE` (first FVG stop update) is implemented and tested across many variants.
- Strongest practical tuning found so far centers around:
  - balanced/high-low regime combinations,
  - moderate filter strictness,
  - TP around `4.2-4.5`.
- Drawdown can be reduced materially, but tested search space did not support a 200R/year objective.

