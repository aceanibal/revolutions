---
name: S1 Overhaul Report 2026-04-17
description: MFE/MAE structural analysis of S1 across all assets led to Choice B — EMA200 regime filter + 3.5R trailing lock. maxDD halved, MCL cut 68%.
type: project
---

# S1 Overhaul — Choice B Implemented (2026-04-17)

## Trigger

ONDO and TAO added to asset universe. MFE analysis revealed structural problems:
ONDO has a 2.4% TP rate (vs ~13% for working assets) and 50% of trades never
reach 1R MFE. This sparked a full cross-asset S1 diagnostic.

## Key Findings from MFE Analysis

**Working assets** (BTC, ETH, SOL): ~15% of trades reach 12R+ MFE (the TP).
**Broken assets** (ONDO, AVAX, XRP): 2–7% reach 12R+. ONDO is structurally broken.

**Abandoned runners** (trades that reached 3.5R+ MFE but reversed to SL):
- 212 such trades across 11 assets
- Duration of reversion: median 152–294 hours (not instant whipsaws)
- If locked at +1R when 3.5R hit: +428R recovered

**Year-by-year**: S1 bleeds in bear years (2022: −94R, 2026: −32R) because
TP rate collapses to 3–7% in risk-off regimes. IMBAL+HIGH bullish bars in bear
markets are distribution/dead-cat bounces, not genuine momentum.

## Choice B: Two Levers Applied

### Lever 1 — Trailing lock 3.5R → +1R
Same mechanism as S4's BE lock. When MFE hits 3.5R, stop moves to entry+1R.

Study result (11 assets):
- 213 rescued trades: +426R
- 37 capped winners: −407R
- Net R: +19R — modest
- MCL: 54→19 (−65%)
- maxDD contribution: meaningful but secondary to L2

### Lever 2 — EMA(200) regime filter on 1h bars
Only fire S1 when signal bar close > EMA(200) on 1h. No look-ahead.

Study result (11 assets):
- Drops 17% of signals
- 2022: −94R → −31R
- 2026: −32R → +20R (flipped positive)
- Bull years: minor reduction (~10–15%)
- Efficiency: +1.59R per 1R of DD reduction (best of all single levers)

## Confirmed Run Results — `runs/run_all_streams_20260417T231541Z/`

**S1 canonical 6-symbol universe (BTC, ETH, SOL, LINK, DOGE, XRP):**

| metric | old baseline | Choice B | change |
|--------|-------------|----------|--------|
| n signals | ~778 | 671 | −13% |
| win% | 12.1% | 28.9% | ↑ (lock converts SL→BE) |
| total_R | +433 | +411 | −22R |
| maxDD_R | 70.27 | **37.78** | **−46%** |
| MCL | 63 | **20** | **−68%** |

Year breakdown (S1 managed):
- 2022: −13R (vs −48R baseline with filter, −94R without filter)
- 2023: +159R
- 2024: +207R
- 2025: +50R
- 2026 YTD: +7R (vs −11R baseline with filter)

**Portfolio impact:**
- Portfolio maxDD: 121R → 87.89R (−27%)
- S1 risk sizing updated: maxDD 70.27 → 37.78 → risk_pct 0.498% → 0.926%

## Why: R Trade-off Is Justified

Total_R drops slightly (−22R) but:
1. maxDD halved = less capital needed to withstand drawdowns
2. MCL 63→20 = live-trading sustainable (63 consecutive losses is psychologically brutal)
3. Bear years flip near-neutral = strategy survives crypto winters
4. Risk sizing increases ~2x → with same account, S1 dollar PnL nearly doubles

## Asset Universe Decisions

- **ONDO**: excluded from S1 (2.4% TP rate, structural break)
- **AVAX, XRP**: remain in canonical 6 for now (borderline but historical data needed)
- **TAO**: positive with Choice B (+46R) — candidate for universe expansion, not yet canonical
- **PAXG**: strong (19.3% TP rate, +82R) — gold acts as risk-off hedge in IMBAL+HIGH long

## Code Changes

- `lab/run_all_streams.py`: S1 dict updated (ema_filter=200, trig_r=3.5, lock_r=1.0),
  `_collect_s1` adds EMA200 filter, `_replay_managed` routes S1 to lock replay,
  `STREAM_MAXDD_R["S1"]` updated to 37.78.
- `strategy/S1_imbal_high_long.md`: fully rewritten with new stats and lock docs.
- `lab/study_s1_overhaul.py`: standalone study, all 11 assets, 4 variants × 3 EMA windows.
- `cache/s1_overhaul_comparison.csv`: per-asset × variant comparison data.

## How to Apply

- **Why:** maxDD and MCL improvement dominates the small R loss. Sustainable live strategy.
- **When to revisit:** If crypto enters a sustained bull regime (EMA filter firing too often),
  consider tightening EMA window from 200→100. If 37 "capped" trades becomes a pattern,
  investigate whether lock_r=2.0 or trig_r=5.0 reduces capping while keeping MCL benefit.
