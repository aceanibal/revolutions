# Final MFE Lock Plan (Unified Model)

## Final Selected Model

- **Execution model:** 5m replay, wick-touch trigger, stop update active at **next 5m bar open** (no same-candle activation).
- **Lock realism rule:** effective lock capped by proven excursion (`effective_lock = min(configured_lock, proven_mfe)`).
- **TP:** 8.0R
- **Stage 1:** MFE1=1.5R, Lock1=1.4R
- **Stage 2:** MFE2=6.0R, Lock2=5.5R

## Models Used In This Chat

- **Baseline model:** no MFE lock (fixed SL + TP only).
- **Stage1 model:** single ladder stage only (MFE1/Lock1).
- **Unified Stage2 model (final):** Stage1 + Stage2 on 5m realistic timing.

## Per-Asset Breakdown (Final Model vs Baselines)

| Symbol | Trades | Baseline R | Stage1 R | Final Stage2 R | Stage2-Baseline | Stage2-Stage1 | Win % | Max DD (R) | Avg Hold (h) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BTCUSDT | 326 | +243.40 | +176.20 | +179.00 | -64.40 | +2.80 | 46.01% | 18.81 | 8.42 |
| DOGEUSDT | 210 | +122.54 | +132.74 | +135.74 | +13.20 | +3.00 | 47.62% | 9.51 | 29.77 |
| LINKUSDT | 313 | +148.70 | +171.08 | +164.08 | +15.38 | -7.00 | 44.09% | 18.34 | 15.85 |
| SOLUSDT | 315 | +199.26 | +206.46 | +218.36 | +19.10 | +11.90 | 47.62% | 8.41 | 10.79 |
| XRPUSDT | 229 | +244.53 | +195.33 | +191.73 | -52.80 | -3.60 | 51.09% | 6.51 | 22.25 |

## Pooled Totals (All Assets)

- Baseline total: **+958.42R**
- Stage1 total: **+881.80R**
- Final Stage2 total: **+888.90R**
- Delta (Stage2 - Stage1): **+7.10R**

## Trade Ledgers (All Trades By Asset, Final Unified Stage2 Model)

- `/Users/anibalperez/revolutions/sandbox/cache/final_unified_stage2_trades_BTCUSDT.csv`
- `/Users/anibalperez/revolutions/sandbox/cache/final_unified_stage2_trades_DOGEUSDT.csv`
- `/Users/anibalperez/revolutions/sandbox/cache/final_unified_stage2_trades_LINKUSDT.csv`
- `/Users/anibalperez/revolutions/sandbox/cache/final_unified_stage2_trades_SOLUSDT.csv`
- `/Users/anibalperez/revolutions/sandbox/cache/final_unified_stage2_trades_XRPUSDT.csv`

## Additional Artifacts

- Summary CSV by asset: `/Users/anibalperez/revolutions/sandbox/cache/final_unified_stage2_summary_by_asset.csv`
- Unified pooled optimization grids:
  - `sandbox/cache/pooled_stage1_grid_tp8_realistic.csv`
  - `sandbox/cache/pooled_stage2_grid_tp8_realistic.csv`

## Notes

- Results are in-sample on current backtest DB snapshot.
- Stop updates are deferred to next 5m bar open by design.
- Configuration respects realistic ordering discussed in chat.