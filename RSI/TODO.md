# Research TODO

## Short Regime Studies (not yet run — compute-heavy)

All 4 need the same treatment as `study_imbalanced_trend.py`:
- 3 variants per regime: raw ATR stop | FVG-filtered ATR stop | FVG-filtered FVG stop
- Candle shape tiers (body_pct 0.30-0.45 / 0.45-0.60 / 0.60+) to find best filter
- Year breakdown + per-symbol at best TP
- ATR vs FVG stop delta comparison

### 1. BALANCED + MED SHORT
- `study_balanced_med_short.py`
- ~58,012 bar pool — likely extends BAL_SHORT edge down one vol tier
- Thresholds: vol>1.3, body>0.45, close<0.20
- TP sweep: 3.0R → 8.0R (BALANCED tends toward shorter TPs like 4.25R)
- Hypothesis: FVG short edge carries from HIGH → likely ✅

### 2. BALANCED + LOW SHORT
- `study_balanced_low_short.py`
- ~64,576 bar pool — largest untested pool, but LOW vol = weaker momentum
- Use tighter filters to control signal volume: vol>1.5, body>0.50, close<0.15
- TP sweep: 3.0R → 6.0R
- Hypothesis: probably weak but FVG stop may save losses (market asleep = gaps more significant)

### 3. IMBALANCED + MED SHORT
- `study_imbalanced_med_short.py`
- ~15,163 bars — same regime we rejected for longs (short side may be different)
- Thresholds: vol>1.3, body>0.45, close<0.20
- TP sweep: 3.0R → 10.0R
- Hypothesis: trending MED regime shorts should work — we confirmed IMBAL_HIGH shorts work

### 4. IMBALANCED + LOW SHORT
- `study_imbalanced_low_short.py`
- ~9,374 bars — smallest pool
- Thresholds: vol>1.1, body>0.35, close<0.30
- TP sweep: 3.0R → 8.0R
- Hypothesis: low conviction — LOW vol trending rarely produces strong shorts

---

## Performance Note
BAL_LOW studies are slow (~6000+ signals). Run with:
- Strict filters (vol>1.5, body>0.50) to cut signal count
- Max 7 TP levels instead of full sweep
- Run each regime as a separate script rather than combined

---

## Other Pending Work

### Update Research Report
- Add PAXG findings (smoke test at 0.5%, standalone sim)
- Add full long regime rejection log (all 5 rejected)
- Add key thesis: "Only IMBALANCED+HIGH has structural long edge"
- Add structural insight: "FVG in sleeping market (BAL+LOW) = rare accumulation signal"
- Add BALANCED+MED long mean-reversion at TP=2R observation

### Portfolio Compound Sim
- Re-run compound sim once short regimes are tested
- Add any new confirmed streams at appropriate sizing
- Update CAGR / maxDD / Calmar comparison table

### IMBAL_LONG TP Extension
- Test TP=14R, 15R, 16R — sweep was still improving at 12R
- 778 signals, quick run

---

## Regime Coverage Map (current state)

```
              SHORT                          LONG
              LOW     MED     HIGH           LOW     MED     HIGH
BALANCED       ⬜      ⬜     ✅ LIVE         ❌      ❌      ❌
IMBALANCED     ⬜      ⬜     ✅ LIVE         ❌      ❌      ✅ LIVE
```

Legend: ✅ live  ❌ rejected  ⬜ untested
