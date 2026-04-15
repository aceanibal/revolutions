# High-Risk / High-Trade Strategy Note

## Candidate Direction

Use the entry-only model with high signal frequency as a base for a super high-risk, high-trade strategy prototype.

---

## Run Summary

- Command: `RSI/.venv/bin/python RSI/lab/study_fvg_entry_only.py --start 2025-10-13 --tp-sweep 4.0`
- Output: `RSI/cache/fvg_entry_only_study.csv`

---

## Key Results (6-month window, entry-only, TP=4.0)

- Total entry-only signals: `19,938`
- FVG-tagged subset: `1,836`

### FVG-tagged mode comparison

#### `STANDARD`

- `n=1801`
- `win%=29.0%`
- `SL_hits=1278 (71.0%)`
- `total_R=785.9`
- `maxDD=85.7`

#### `FVG-ONE`

- `n=1820`
- `win%=13.1%`
- `SL_hits=1582 (86.9%)`
- `total_R=321.8`
- `maxDD=45.0`

---

## Interpretation

For this specific 6-month, entry-only TP4 run:

- `STANDARD` strongly outperformed `FVG-ONE` on raw return (`total_R`).
- `FVG-ONE` materially reduced drawdown.

This suggests a viable high-trade development path:

1. Keep entry-only breadth to preserve signal volume.
2. Use `STANDARD` as the aggressive return engine baseline.
3. Add optional risk governors (position cap, daily loss cut, dynamic size throttle) instead of tightening stop logic too early.

