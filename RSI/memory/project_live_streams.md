---
name: Live Trading Streams
description: Confirmed live portfolio streams with their configs, stats, and regime filters
type: project
originSessionId: ec260109-55dd-42c6-882c-a908d1ac26ca
---
# Confirmed Live Streams (as of 2026-04-17)

All streams use 1h bars for signal detection, 5m bars for trade management.
Backtested 2022-01-01 → present (~4.3 years). Symbols: BTC, ETH, SOL, LINK, DOGE, XRP.

---

## Stream 1 — IMBAL+HIGH Long (bullish momentum continuation) ✅ OVERHAULED 2026-04-17

**Choice B applied:** EMA(200) regime filter + 3.5R→+1R trailing lock.
Full analysis: `memory/report_s1_overhaul_20260417.md`. Authoritative spec: `strategy/S1_imbal_high_long.md`.

**Regime:** structure=IMBALANCED, vol_q=HIGH
**Signal:** 1h bullish candle with strong body (`body_pct > 0.55`), close near high
(`close_pct > 1 - 0.15 = 0.85`), above-average volume (`vol_ratio > 1.8`).
**Lever 2 — EMA filter:** signal bar close must be above EMA(200) on 1h. Suppresses
bear-regime entries (2022 bear, 2026 risk-off).
Entry at next-bar open.
**Stop:** ATR×2.0 below entry.
**Lever 1 — Trailing lock:** when MFE reaches 3.5R, stop moves to entry+1R (same-bar activation).
**TP:** 12R (fat-tail target — do not reduce).
**Universe:** BTC, ETH, SOL, LINK, DOGE, XRP. ONDO excluded (structural failure, 2.4% TP rate).
**Stats (confirmed run `run_all_streams_20260417T231541Z`):**
- n = 671 replayed (~157/yr after EMA filter)
- win% = 28.9% (lock converts SL→BE exits; baseline win% without lock = 13%)
- total_R = +411  |  baseline (no lock) = +450  |  ann_R ≈ 96/yr
- **maxDD_R = 37.78** (↓ from 70.27 — 46% reduction)
- **MCL = 20** (↓ from 63 — 68% reduction)
- Exit mix: 477 SL / 130 BE / 64 TP
- Year breakdown: 2022 −13 / 2023 +159 / 2024 +207 / 2025 +50 / 2026 YTD +7
- Per-asset: BTC +156, ETH +106, SOL +76, LINK +67, DOGE +23, XRP −16
**Risk sizing:** maxDD_R = 37.78 → risk_pct = 35/37.78 = 0.926% (updated in runner)
**Signal collector:** `lab/run_all_streams.py::_collect_s1` (EMA filter applied here)
**Replay:** `lab/run_all_streams.py::_replay_managed` (S1 branch, lock params)
**Master runner:** `lab/run_all_streams.py` (S1 block)
**Overhaul study:** `lab/study_s1_overhaul.py` / `cache/s1_overhaul_comparison.csv`

---

## Stream 2 — BAL+HIGH Short (momentum, no FVG)

See `strategy/S2_bal_high_short.md` for the authoritative spec.

**Regime:** structure=BALANCED, vol_q=HIGH
**Signal:** bearish momentum candle (vol_ratio>1.5, body_pct>0.55, close_pct<0.20)
  — strong bearish body closing near the low in a ranging HIGH-vol bar
**Stop:** ATR×1.5 above entry (fixed)
**Config:** TP=3R, no FVG requirement, no active management
**Stats (reference, all symbols combined):**
- n≈274 signals (~64/yr)
- ann_R: ~19.9/yr
- win%: 33.2%
- maxDD: 12.7
- Calmar: ~1.69
**Script:** `lab/sweep_shorts_filtered.py`
**File refs:** `cache/shorts_filtered_sweep.csv`

---

## Stream 3 — BAL+HIGH Short with FVG (FVG-LOW stop)  ⚠️ CORRECTED 2026-04-16

See `strategy/S3_bal_high_short_fvg.md` for the authoritative spec.

**Regime:** structure=BALANCED, vol_q=HIGH
**Signal:** bearish momentum candle (vol_ratio>1.8, body_pct>0.55, close_pct<0.15)
  + MUST have bearish FVG (high[i] < low[i-2])
  — price left a gap above the entry bar; this gap is the invalidation zone
**Stop (FVG-LOW):** `stop = high[i] + ATR × 0.15`
  — just above the bottom of the bearish gap. If price fills the FVG, thesis
  is wrong → exit early with a small loss instead of full −ATR×2.
**R basis:** `risk = ATR × 2.0` (decoupled from stop distance so 1R is
consistent across streams).
**Config:** TP=4.25R, no additional lock
**Reference baseline:** 226 signals, 29.6% win, +142.3R, maxDD=10.3, ann_R=33.2/yr
(`lab/study_fvg_lock_sweep.py` baseline section).
**Script:** signal family in `lab/study_fvg_momentum.py`, runner wiring in
`lab/run_all_streams.py` (S3 block), baseline/lock sweeps in
`lab/study_fvg_lock_sweep.py`.

---

## Stream 4 — BAL+HIGH Swing Low Long (NEW — 2026-04-16)

**Regime:** structure=BALANCED, vol_q=HIGH
**Signal:** equal-lows liquidity sweep on 1h bars (rejection_min=0.90, tolerance=0.5%, lookback=50)
**Config (AGGRESSIVE):** ATR stop (ATR×2.0), trig=3.5R→lock=+1.0R, TP=19.5R
**Stats:**
- n=274 signals (64/yr, ~5/month)
- ann_R: 67.8/yr
- maxDD: 17.6
- Calmar: **3.86** (best of all streams)
- MCL: 11
- win%: 29.6% (lock converts ~18% of trades to small +1R exits)
**Year breakdown:** 2022: -9.0R, 2023: +160.8R, 2024: +97.1R, 2025: +43.7R
**Per-symbol ann_R:** SOL 11.7, DOGE 12.7, LINK 8.6, XRP 11.0, ETH 9.5, BTC 3.7
**File refs:** `lab/study_swing_low_sweep.py`, `lab/study_swing_low_locks.py`, `lab/study_swing_low_trigger_sweep.py`, `cache/swing_low_sweep.csv`

**How the lock works:** When MFE reaches 3.5R, stop moves to entry+1R. Trade either runs to TP=19.5R (big win) or reverses and exits at +1R (small win). Full -1R stops only when price never reaches 3.5R.

---

## Stream 5 — IMBAL+HIGH Short (bearish momentum continuation)

See `strategy/S5_imbal_high_short.md` for the authoritative spec.

**Regime:** structure=IMBALANCED, vol_q=HIGH
**Signal:** bearish momentum candle (vol_ratio>1.8, body_pct>0.55, close_pct<0.15) —
  short-side mirror of S1. Entry at next 1h bar open.
**Stop:** fixed ATR×2.0 above entry. No lock, no ladder.
**Config:** TP=5R
**Reference stats (combined 6 symbols, 2022-start):**
- n=631 signals (~147/yr)
- ann_R: ~37/yr
- win%: 21.1%
- maxDD: ~67R (combined)
- Calmar: ~0.55
**Signal collector:** `lab/study_imbalanced_trend.py::collect_imbalanced_signals` (side=-1)
**Replay:** `lab/study_imbalanced_trend.py::replay_trend` (atr_mult=2.0, tp_r=5.0, fixed)

---

## Regime Coverage Map

```
              SHORT                       LONG
              LOW   MED   HIGH            LOW   MED   HIGH
BALANCED       ⬜    ⬜   ✅ S2, S3(FVG)    ❌    ❌    ✅ S4 (swing low)
IMBALANCED     ⬜    ⬜   ✅ S5             ❌    ❌    ✅ S1
```

Legend: ✅ live  ❌ rejected  ⬜ untested

Note: S2 and S3 are both BAL+HIGH short streams; S3 is the FVG-filtered subset
with FVG-LOW stop and higher TP.
