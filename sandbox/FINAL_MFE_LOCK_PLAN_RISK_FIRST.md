# Final MFE Lock Plan (Risk-First Variant)

Built from existing CSV outputs only (no model reruns).
Selection priority per asset: **highest win rate**, then **lowest max drawdown**, then **highest total R**.

## Risk-First Picks By Asset (Stage1)

| Symbol | mfe1 | lock1 | total R | win % | max DD (R) |
|---|---:|---:|---:|---:|---:|
| BTCUSDT | 1.00 | 1.00 | +170.40 | 51.53% | 19.99 |
| DOGEUSDT | 1.00 | 1.00 | +131.54 | 51.90% | 9.53 |
| LINKUSDT | 1.00 | 1.00 | +172.68 | 49.20% | 11.84 |
| SOLUSDT | 1.00 | 1.00 | +204.26 | 53.97% | 11.25 |
| XRPUSDT | 1.00 | 1.00 | +194.53 | 55.90% | 9.11 |

## Risk-First Picks By Asset (Stage2)

| Symbol | mfe1 | lock1 | mfe2 | lock2 | total R | win % | max DD (R) |
|---|---:|---:|---:|---:|---:|---:|---:|
| BTCUSDT | 2.00 | 1.40 | 7.00 | 5.50 | +176.90 | 42.02% | 22.81 |
| DOGEUSDT | 1.50 | 1.00 | 6.50 | 5.00 | +138.54 | 47.62% | 9.53 |
| LINKUSDT | 2.00 | 1.60 | 6.00 | 5.00 | +168.88 | 41.85% | 19.41 |
| SOLUSDT | 1.00 | 0.80 | 6.50 | 6.00 | +249.06 | 53.97% | 8.41 |
| XRPUSDT | 2.00 | 1.20 | 6.00 | 5.50 | +211.33 | 44.54% | 10.22 |

## Averaged Parameters From Risk-First Picks

- Raw average Stage1: **mfe1=1.00**, **lock1=1.00**
- Raw average Stage2: **mfe2=6.40**, **lock2=5.40**

Rounded-to-grid practical set (respecting chat constraints):
- **Stage1:** mfe1=1.00, lock1=1.00 (lock1 <= mfe1)
- **Stage2:** mfe2=6.50, lock2=5.50 (lock2 < mfe2)

## Notes

- This report prioritizes smoothness (win rate, drawdown) ahead of maximizing total R.
- Values were selected from these existing files:
  - `/Users/anibalperez/revolutions/sandbox/cache/XRPUSDT_stage1_grid_tp8_realistic.csv`
  - `/Users/anibalperez/revolutions/sandbox/cache/BTCUSDT_stage1_grid_tp8_realistic.csv`
  - `/Users/anibalperez/revolutions/sandbox/cache/SOLUSDT_stage1_grid_tp8_realistic.csv`
  - `/Users/anibalperez/revolutions/sandbox/cache/LINKUSDT_stage1_grid_tp8_realistic.csv`
  - `/Users/anibalperez/revolutions/sandbox/cache/DOGEUSDT_stage1_grid_tp8_realistic.csv`
  - `/Users/anibalperez/revolutions/sandbox/cache/XRPUSDT_stage2_grid_tp8_realistic.csv`
  - `/Users/anibalperez/revolutions/sandbox/cache/BTCUSDT_stage2_grid_tp8_realistic.csv`
  - `/Users/anibalperez/revolutions/sandbox/cache/SOLUSDT_stage2_grid_tp8_realistic.csv`
  - `/Users/anibalperez/revolutions/sandbox/cache/LINKUSDT_stage2_grid_tp8_realistic.csv`
  - `/Users/anibalperez/revolutions/sandbox/cache/DOGEUSDT_stage2_grid_tp8_realistic.csv`

- Risk-first pick tables: `/Users/anibalperez/revolutions/sandbox/cache/riskfirst_stage1_picks_by_asset.csv`, `/Users/anibalperez/revolutions/sandbox/cache/riskfirst_stage2_picks_by_asset.csv`