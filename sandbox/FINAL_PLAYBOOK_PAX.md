# Final Report - PAXGUSDT

This report consolidates the full PAXG strategy research and the most recent cross-asset retuning pass.

## Executive Conclusion

- PAXG remains the only asset with a stable time-of-day edge after fees under the same tuning template.
- The strongest and most stable setup is still the `14:00 ET` long regime with volume/trend confirmation.
- Short extensions add trade count but reduce edge quality and are less stable in walk-forward.

## Final Production Setup

- **Asset**: `PAXGUSDT` only
- **Session filter**: Weekdays (`Mon-Fri`)
- **Signal time**: `14:00 ET` (hour-close entry logic)
- **Execution path**: simulate/trade on following `5m` candles
- **Max hold**: `6h`
- **Fees tested**: `6 bps` round-trip

### Entry Filter

- `vol_ratio >= q60`
  - `vol_ratio = prev_hour_volume / mean(last_24h_hourly_volume)`
- `bull6 >= 0.5`
  - `bull6 = fraction of bullish candles in last 6 hourly bars`

### Risk Model (final stable)

- **Stop loss**: `0.60%`
- **Take profit**: `1.00R`
- **Sizing**: fixed fraction only (no martingale / anti-martingale)

## Validation Results

### In-sample tuned baseline (latest broad search pass)

- Rule family confirmed around the same core setup:
  - `LONG 14 vol>=q60 & bull6>=0.5`
- Nearby best parameterizations remained positive (including `0.40% / 1.50R` and `0.60% / 1.00R`), indicating local robustness rather than a single-point fit.

### Walk-forward check (65/35 time split)

- **Selected rule**: `L14 vol>=q60 & bull6>=0.5, SL 0.60%, TP 1.00R`
- **Train**: `N=59`, `Win=57.6%`, `AvgR=+0.1154`, `PF=1.70`
- **Test**: `N=30`, `Win=50.0%`, `AvgR=+0.1178`, `PF=1.52`

Interpretation:
- Edge survives out-of-sample with similar AvgR and PF.
- This is the strongest evidence that the PAX setup is not just in-sample noise.

## Cross-Asset Context (same tuning, same constraints)

Using the same hours/filters/SLTP search on `BTCUSDT`, `SOLUSDT`, `XRPUSDT`, `LINKUSDT`, and `DOGEUSDT`:
- most candidates looked strong in-sample,
- but turned negative in test (`PF < 1`).

This supports a **PAX-specific microstructure/time behavior** rather than a universal crypto rule.

## Operational Rules

- Trade only the single 14:00 ET long setup.
- Skip weekends.
- Enforce one position at a time on this playbook.
- Keep fee/slippage assumptions conservative; if realized costs rise, edge can disappear quickly.

## Risk Controls (required)

- Pause strategy if rolling PF over last `40-60` trades drops below `1.0`.
- Pause if rolling AvgR over last `40-60` trades is negative.
- Resume only after re-validation on most recent data window.

## Monitoring Cadence

- Weekly: sanity check fills/slippage vs model.
- Monthly: rerun tuning + walk-forward with latest data.
- Quarterly: re-test alternate TP/SL neighbors (`0.40/1.50`, `0.50/1.25`, `0.60/1.00`) to confirm regime continuity.

## Final Verdict

PAXG `14:00 ET` long with `vol_ratio + bull6` confirmation remains the best deployable edge from this research cycle. Treat it as a **single-asset specialist playbook**, with strict kill-switch discipline and periodic re-validation.
