# Timing & Concurrency Report — run_all_streams_20260417T010915Z

Period: `2022-01-04` → `2026-02-28` (4.2 years) | Trades: 3,819 | Streams: S1–S5 | Assets: 6

## 1  Trade Duration

### Summary by stream

| Stream | n | Median | Mean | p10 | p90 | Max |
| --- | --- | --- | --- | --- | --- | --- |
| ALL | 3819 | 15h | 62h | 2h | 123h | 5384h |
| S1 | 778 | 23h | 141h | 2h | 365h | 5384h |
| S2 | 1910 | 11h | 24h | 1h | 58h | 777h |
| S3 | 226 | 28h | 67h | 3h | 154h | 1103h |
| S4 | 274 | 26h | 107h | 3h | 284h | 1755h |
| S5 | 631 | 18h | 58h | 3h | 131h | 1559h |

- **S1** has the longest tail — rare 12R winners run for days/weeks, pulling mean >> median. Max 5,384h (~224 days).
- **S2** is fastest — ATR×1.5 stop resolves most trades within 58h. Quick both ways.
- **S4** is bimodal — most trades are quick SL exits (~1h), but 19.5R TP winners run for days.

### Duration distribution — all trades

| Bucket | n | pct |
| --- | --- | --- |
| < 1h | 168 | 4.4% |
| 1–4h | 656 | 17.2% |
| 4–12h | 870 | 22.8% |
| 12–24h | 655 | 17.2% |
| 1–2d | 594 | 15.6% |
| 2–4d | 380 | 10.0% |
| 4–7d | 210 | 5.5% |
| 7–14d | 147 | 3.8% |
| > 14d | 139 | 3.6% |

### Duration by stream (trade counts per bucket)

| Stream | < 1h | 1–4h | 4–12h | 12–24h | 1–2d | 2–4d | 4–7d | 7–14d | > 14d |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | 34 | 106 | 144 | 111 | 88 | 79 | 73 | 53 | 90 |
| S2 | 114 | 394 | 490 | 355 | 310 | 174 | 51 | 18 | 4 |
| S3 | 8 | 24 | 40 | 35 | 37 | 34 | 25 | 19 | 4 |
| S4 | 2 | 40 | 54 | 33 | 40 | 32 | 24 | 29 | 20 |
| S5 | 10 | 92 | 142 | 121 | 119 | 61 | 37 | 28 | 21 |

## 2  Concurrent Open Positions

### Portfolio-level at entry

- **Peak:** 33 simultaneous trades
- **Median:** 12
- **Mode:** 14  (most common)
- **75th pct:** 15

| Open positions (incl. new) | n trades | % of all entries |
| --- | --- | --- |
| 1 | 2 | 0.1% |
| 2 | 25 | 0.7% |
| 3 | 76 | 2.0% |
| 4 | 144 | 3.8% |
| 5 | 207 | 5.4% |
| 6 | 237 | 6.2% |
| 7 | 245 | 6.4% |
| 8 | 212 | 5.6% |
| 9 | 241 | 6.3% |
| 10 | 221 | 5.8% |
| 11 | 241 | 6.3% |
| 12 | 258 | 6.8% |
| 13 | 281 | 7.4% |
| 14 | 294 | 7.7% |
| 15 | 281 | 7.4% |
| 16 | 218 | 5.7% |
| 17 | 156 | 4.1% |
| 18 | 137 | 3.6% |
| 19 | 94 | 2.5% |
| 20 | 75 | 2.0% |
| 21 | 62 | 1.6% |
| 22 | 37 | 1.0% |
| 23 | 24 | 0.6% |
| 24 | 19 | 0.5% |
| 25 | 7 | 0.2% |
| 26 | 4 | 0.1% |
| 27 | 6 | 0.2% |
| 28 | 5 | 0.1% |
| 29 | 2 | 0.1% |
| 30 | 3 | 0.1% |
| 31 | 2 | 0.1% |
| 32 | 2 | 0.1% |
| 33 | 1 | 0.0% |

### Same-asset overlap by asset

| Asset | Total | Overlap ≥1 | Overlap ≥2 | % overlap |
| --- | --- | --- | --- | --- |
| BTCUSDT | 714 | 575 | 358 | 80.5% |
| DOGEUSDT | 617 | 499 | 306 | 80.9% |
| ETHUSDT | 606 | 529 | 387 | 87.3% |
| LINKUSDT | 649 | 514 | 425 | 79.2% |
| SOLUSDT | 667 | 443 | 221 | 66.4% |
| XRPUSDT | 566 | 435 | 335 | 76.9% |

S3 overlaps 100% of the time on every asset — expected, since FVG shorts fire within BAL+HIGH windows where other streams are already open.

### Same-stream overlap by stream

| Stream | Total | Overlap ≥1 | Overlap ≥2 | % overlap |
| --- | --- | --- | --- | --- |
| S1 | 778 | 711 | 625 | 91.4% |
| S2 | 1910 | 1693 | 1445 | 88.6% |
| S3 | 226 | 176 | 152 | 77.9% |
| S4 | 274 | 162 | 98 | 59.1% |
| S5 | 631 | 562 | 413 | 89.1% |

## 3  Trade Frequency

- Calendar days: 1516 | Days with ≥1 trade: 942 (62.1%)
- Avg trades/day (active): 4.05 | Median: 3.0 | Max in one day: 26

| Trades/day | Days | pct |
| --- | --- | --- |
| 1 | 245 | 26.0% |
| 2 | 200 | 21.2% |
| 3 | 117 | 12.4% |
| 4 | 80 | 8.5% |
| 5 | 69 | 7.3% |
| 6–7 | 89 | 9.4% |
| 8–9 | 56 | 5.9% |
| 10+ | 86 | 9.1% |

### Per-stream frequency

| Stream | Total | Active days | Avg/day | Max/day | Days with 2+ |
| --- | --- | --- | --- | --- | --- |
| S1 | 778 | 419 | 1.86 | 12 | 185 |
| S2 | 1910 | 678 | 2.82 | 20 | 407 |
| S3 | 226 | 132 | 1.71 | 5 | 52 |
| S4 | 274 | 187 | 1.47 | 5 | 56 |
| S5 | 631 | 285 | 2.21 | 13 | 127 |

### Per-asset frequency

| Asset | Total | Active days | Avg/day | Max/day |
| --- | --- | --- | --- | --- |
| BTCUSDT | 714 | 443 | 1.61 | 6 |
| DOGEUSDT | 617 | 403 | 1.53 | 5 |
| ETHUSDT | 606 | 396 | 1.53 | 6 |
| LINKUSDT | 649 | 420 | 1.55 | 6 |
| SOLUSDT | 667 | 424 | 1.57 | 7 |
| XRPUSDT | 566 | 376 | 1.51 | 6 |

## 4  MaxDD Stress — Would Concurrent Positions Cause a Problem?

### Short answer: Yes — here is exactly how

The portfolio maxDD is **103.7R** even though no individual stream exceeds 82.6R. The gap proves that streams do lose together. Here is the mechanism:

**Why it compounds:**
1. **S2 fires high volume in clusters.** Up to 20 signals in a single day across assets. If that session reverses, every signal stops out at ~−1R × 2.76% of balance each — a single bad day can cost 10–15% of the account before any other stream acts.
2. **S2 and S3 share the same regime (BAL+HIGH).** When that regime misfires, both streams fire concurrently and both stop out together.
3. **S1 and S4 are both long-biased.** They tend to lose in the same bear-market weeks, confirmed by the S1↔S4 weekly R correlation of +0.45.
4. **Risk sizing assumed independence.** `risk_pct = 35 / stream_maxDD_r` treats each stream in isolation. The actual portfolio DD of 103.7R vs individual DDs of 10–82R shows diversification is real but insufficient to prevent combined DD exceeding any single stream.

### Stream weekly R correlation

|  | S1 | S2 | S3 | S4 | S5 |
| --- | --- | --- | --- | --- | --- |
| S1 | 1.0 | -0.233 | -0.142 | 0.451 | -0.094 |
| S2 | -0.233 | 1.0 | 0.403 | -0.145 | 0.285 |
| S3 | -0.142 | 0.403 | 1.0 | -0.078 | 0.332 |
| S4 | 0.451 | -0.145 | -0.078 | 1.0 | -0.056 |
| S5 | -0.094 | 0.285 | 0.332 | -0.056 | 1.0 |

- **S1 ↔ S4: +0.45** — both long-biased; win/lose in the same conditions
- **S2 ↔ S3: +0.40** — both BAL+HIGH shorts; cluster in the same regime windows
- **S1 ↔ S2: −0.23** — partial hedge: S1 loses some of what S2 makes in bear markets
- **S4 ↔ S2: −0.15** — swing lows rarely coincide with BAL+HIGH short signals

### Simultaneous losing weeks

| Streams losing simultaneously | Weeks | pct |
| --- | --- | --- |
| 0 | 4 | 1.8% |
| 1 | 30 | 13.8% |
| 2 | 71 | 32.7% |
| 3 | 63 | 29.0% |
| 4 | 42 | 19.4% |
| 5 | 7 | 3.2% |

**All 5 streams losing in the same week: 7 weeks (3.2%)**
4 or 5 streams losing: 49 weeks (22.6%) — roughly 1 in 5 weeks

### 10 worst portfolio weeks

| Week | S1 | S2 | S3 | S4 | S5 | Portfolio R | # losing |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2024-08-19/2024-08-25 | -2.0 | -18.4 | -1.6 | 0.0 | -2.0 | -24.0 | 4 |
| 2024-08-12/2024-08-18 | -1.0 | -14.2 | -2.0 | -4.1 | -2.0 | -23.3 | 5 |
| 2025-03-17/2025-03-23 | -4.1 | -13.2 | -3.6 | 0.0 | -2.0 | -22.9 | 4 |
| 2022-03-21/2022-03-27 | -4.1 | -13.2 | -2.5 | 0.0 | -3.0 | -22.8 | 4 |
| 2025-08-25/2025-08-31 | -2.0 | -8.2 | -2.5 | 0.0 | -9.1 | -21.8 | 4 |
| 2022-07-04/2022-07-10 | 0.0 | -17.2 | -3.6 | 0.0 | 0.0 | -20.8 | 2 |
| 2024-12-30/2025-01-05 | -3.1 | -13.3 | -1.8 | 0.0 | -1.0 | -19.1 | 4 |
| 2023-11-27/2023-12-03 | -3.0 | -10.3 | -0.5 | -4.0 | -1.0 | -18.9 | 5 |
| 2022-01-31/2022-02-06 | -2.0 | -12.2 | -0.9 | 0.0 | -3.0 | -18.2 | 4 |
| 2024-10-28/2024-11-03 | -11.2 | -3.2 | 0.0 | 0.0 | -3.0 | -17.4 | 3 |

**S2 drives most bad weeks** — it has enough signal volume to dominate losses when momentum shorts misfire in a trending-up environment. S4 is often 0 during the worst weeks — swing lows simply don't fire in sharp downtrends, making it a natural shock absorber.

### Worst drawdown window detail

- Portfolio maxDD: **108.9R** | **$12,441,925** (on $10k start with compounding)
- Window: `2023-02-06/2023-02-12` → `2023-05-22/2023-05-28` (15 weeks)

| Stream | R during DD window | % of stream's total lifetime R |
| --- | --- | --- |
| S1 | -48.7R | -11.2% |
| S2 | -39.1R | -12.9% |
| S3 | 2.2R | 1.5% |
| S4 | 1.2R | 0.4% |
| S5 | -10.6R | -6.7% |


### Probability summary

| Scenario | Probability | Typical weekly portfolio loss | Observed max |
| --- | --- | --- | --- |
| 1 stream losing only | 13.8% | −3 to −8R | −17R |
| 2 streams losing | 32.7% | −5 to −15R | −24R |
| 3 streams losing | 29.0% | −8 to −20R | −30R |
| 4 streams losing | 19.4% | −10 to −24R | −35R |
| All 5 losing | 3.2% | −15 to −24R | −24R (observed max) |

### Recommended mitigations

1. **Daily loss cap** — stop all new entries if intraday P&L drops below −5% of account. This limits the S2 cluster-firing problem: a single bad day cannot compound into a double-digit percentage loss.
2. **Same-regime position cap** — limit concurrent S2+S3 positions to 4 across all assets combined. Both are BAL+HIGH shorts; beyond 4 open at once the regime correlation risk exceeds the diversification benefit.
3. **Reduce S2 risk%** — S2's 2.76% risk_pct is the primary driver of big-week losses. Halving to ~1.4% would roughly halve portfolio DD at the cost of ~35% of S2 dollar returns.
4. **Rolling equity stop** — halt new trades if the running balance falls >30% from its rolling 60-day high. This hard-stops the portfolio during genuine adverse regimes without requiring a discretionary judgment call.
5. **Asset concentration monitor** — if 3+ streams have open trades in the same asset, skip the next signal in that asset until at least one closes. This caps single-asset exposure without changing individual stream logic.
