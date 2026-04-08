# Final MFE Lock Plan (Strict Realistic)

## Final Parameters (No Equality)

- Execution model: 5m replay, wick-touch trigger, stop update active at next 5m bar open
- Realism constraints: lock capped by proven MFE and configured as strict inequality (`lock < mfe`)
- TP: 8.0R
- Stage1: MFE1=1.0R, Lock1=0.8R
- Stage2: MFE2=6.5R, Lock2=5.5R

## Per-Asset Results

| Symbol | Trades | Baseline R | Stage1 R | Stage2 R | Stage2-Baseline | Stage2-Stage1 | Win % | Max DD (R) | Avg Hold (h) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BTCUSDT | 326 | +243.40 | +157.00 | +155.20 | -88.20 | -1.80 | 51.53% | 23.19 | 8.06 |
| DOGEUSDT | 210 | +122.54 | +120.74 | +119.84 | -2.70 | -0.90 | 51.90% | 9.73 | 28.29 |
| LINKUSDT | 313 | +148.70 | +169.28 | +164.98 | +16.28 | -4.30 | 49.20% | 12.36 | 15.27 |
| SOLUSDT | 315 | +199.26 | +233.46 | +248.56 | +49.30 | +15.10 | 53.97% | 8.41 | 13.51 |
| XRPUSDT | 229 | +244.53 | +174.33 | +187.53 | -57.00 | +13.20 | 55.90% | 9.59 | 24.88 |

## Pooled Totals

- Baseline total: **+958.42R**
- Stage1 total: **+854.80R**
- Stage2 total: **+876.10R**
- Delta (Stage2 - Stage1): **+21.30R**
- Total trades (stage2): **1393**

## Artifacts

- Summary CSV: `/Users/anibalperez/revolutions/sandbox/cache/final_strict_summary_by_asset.csv`
- Source strict-pick tables:
  - `sandbox/cache/riskfirst_stage1_picks_by_asset_strict.csv`
  - `sandbox/cache/riskfirst_stage2_picks_by_asset_strict.csv`

Trade-by-trade listings intentionally omitted in this report (can be generated later).