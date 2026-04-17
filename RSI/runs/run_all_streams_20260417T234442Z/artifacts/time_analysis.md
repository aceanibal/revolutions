# Time-of-Day & Day-of-Week Analysis
Run: run_all_streams_20260417T234442Z | 11 assets | 5,691 trades | 2022–2026

---

## Hour of Day (UTC) — All Streams Combined

| hour | session | n | win% | total_R | signal |
|------|---------|---|------|---------|--------|
| 00h | Asia/late-US | 180 | 42.2% | +212.5 | ★★ |
| 01h | Asia | 246 | 24.4% | +71.1 | |
| 02h | Asia | 217 | 29.5% | +69.2 | |
| 03h | Asia | 168 | 33.9% | +179.1 | ★★ |
| 04h | Asia/EU pre | 176 | 33.5% | +133.9 | ★ |
| 05h | EU pre | 123 | 27.6% | +81.4 | |
| 06h | EU open | 130 | 24.6% | +2.1 | |
| 07h | EU | 171 | 26.9% | +32.7 | |
| 08h | EU morning | 139 | 18.7% | **-18.6** | ⚠️ |
| 09h | EU morning | 203 | 27.6% | +27.2 | |
| 10h | EU mid | 143 | 19.6% | **-34.8** | ⚠️ worst |
| 11h | EU mid | 117 | 18.8% | **-16.1** | ⚠️ |
| 12h | EU/US pre | 137 | 21.9% | **-14.4** | ⚠️ |
| 13h | US pre-market | 207 | 29.0% | +55.8 | |
| 14h | US open (9am ET) | 359 | 29.2% | +95.1 | |
| 15h | US morning | 509 | 27.3% | +92.9 | |
| 16h | US morning | 491 | 30.8% | **+224.8** | ★★★ |
| 17h | US morning | 415 | 30.4% | **+163.2** | ★★ |
| 18h | US midday | 396 | 28.8% | **+173.7** | ★★ |
| 19h | US midday | 266 | 31.6% | **+172.3** | ★★ |
| 20h | US afternoon | 315 | 26.3% | +62.0 | |
| 21h | US afternoon | 240 | 22.9% | +23.2 | |
| 22h | US close | 175 | 32.6% | +62.9 | |
| 23h | US close/Asia | 168 | 23.2% | +77.0 | |

**Dead zone 08h–12h UTC:** −82.8R on 742 trades. European morning session chop.
**Power window 16h–19h UTC:** +733.9R on 1,581 trades (38% of total R, 28% of trades).
**Asian window 00h–05h UTC:** +747.1R — S1 and S4 especially strong; 03h has 44.4% S1 win rate.

---

## Hour × Stream Heatmap (total_R)

| hour | S1 | S2 | S3 | S4 | S5 | total |
|------|-----|-----|-----|-----|-----|-------|
| 00h | +25.6 | +67.5 | +46.3 | +26.7 | +46.5 | +212.5 |
| 01h | +79.8 | -0.3 | -1.4 | -20.3 | +13.4 | +71.1 |
| 02h | +40.0 | +29.7 | -5.6 | -3.3 | +8.3 | +69.2 |
| 03h | +105.5 | +49.3 | -7.9 | +20.7 | +11.6 | +179.1 |
| 04h | +46.3 | +14.4 | -7.2 | +33.7 | +46.6 | +133.9 |
| 05h | +26.3 | +14.1 | +2.7 | +26.7 | +11.5 | +81.4 |
| 06h | +9.1 | -9.1 | +6.7 | -7.2 | +2.7 | +2.1 |
| 07h | -1.6 | +37.3 | -2.6 | +15.2 | -15.6 | +32.7 |
| 08h | -10.2 | -7.6 | +1.3 | +6.2 | -8.5 | -18.6 |
| 09h | -14.7 | +47.3 | +5.2 | -6.2 | -4.4 | +27.2 |
| 10h | -21.4 | +2.6 | +4.6 | -4.1 | -16.4 | -34.8 |
| 11h | +2.5 | -2.3 | -4.1 | -4.0 | -8.2 | -16.1 |
| 12h | -5.4 | +15.1 | +1.4 | -3.1 | -22.3 | -14.4 |
| 13h | +2.1 | +15.2 | +2.8 | +15.2 | +20.6 | +55.8 |
| 14h | -3.7 | +58.6 | +11.7 | +7.3 | +21.2 | +95.1 |
| 15h | -5.6 | +11.3 | +22.9 | +11.1 | +53.2 | +92.9 |
| 16h | +71.8 | +102.7 | +26.2 | +36.7 | -12.6 | +224.8 |
| 17h | +70.9 | +53.1 | +22.7 | +19.2 | -2.7 | +163.2 |
| 18h | +57.2 | +40.7 | +29.6 | +43.9 | +2.4 | +173.7 |
| 19h | +57.5 | +34.8 | +13.0 | +18.6 | +48.5 | +172.3 |
| 20h | +25.3 | +21.2 | +20.9 | +0.2 | -5.6 | +62.0 |
| 21h | +13.6 | +1.2 | -1.3 | +10.3 | -0.6 | +23.2 |
| 22h | -8.3 | +27.0 | +18.1 | +11.3 | +14.8 | +62.9 |
| 23h | +36.2 | -11.0 | -0.1 | +53.1 | -1.2 | +77.0 |

---

## Best / Worst Hours Per Stream

| stream | best hours | worst hours |
|--------|-----------|-------------|
| S1 | 03h (+106R, 44%) · 01h (+80R) · 16–17h (+143R) | 08–10h (−46R, <20% win) |
| S2 | 16h (+103R, 34%) · 00h (+68R, 47%) · 14h (+59R) | 06–08h · 23h (negative) |
| S3 | 00h (+46R, 57%) · 18h (+30R) · 15–17h (+72R) | 01–04h (0–12% win, flat/neg) |
| S4 | 23h (+53R, 45%) · 18h (+44R) · 16h (+37R, 50%) | 01h (−20R, 4.5% win) |
| S5 | 15h (+53R, 32%) · 19h (+49R, 34%) · 04h (+47R, 42%) | 07–12h (−63R combined) |

---

## Day of Week — All Streams Combined

| day | n | win% | total_R | avg_R | note |
|-----|---|------|---------|-------|------|
| Monday | 1706 | 29.0% | +480.7 | +0.282 | most signals, high absolute R |
| Tuesday | 1044 | 23.8% | +235.8 | +0.226 | underperforms signal count |
| Wednesday | 789 | 26.9% | +294.5 | +0.373 | efficient |
| **Thursday** | **701** | **36.9%** | **+485.4** | **+0.692** | **highest win% and avg_R** |
| Friday | 734 | 29.8% | +325.8 | +0.444 | strong |
| Saturday | 247 | 27.9% | +87.6 | +0.355 | low volume but positive |
| **Sunday** | **470** | **21.5%** | **+18.7** | **+0.040** | **weakest — thin markets** |

Thursday: highest win rate despite fewest weekday signals. avg_R = 0.692 vs portfolio avg 0.339 — 2× more efficient per trade.
Sunday: 21.5% win, nearly zero R despite 470 signals. Thin crypto market, no institutional flow.
Tuesday: second-most signals but worst avg_R after Sunday. Midweek digestion phase.

## Day of Week — Per Stream

| stream | best days | worst days |
|--------|----------|-----------|
| S1 | Wed (+195R) · Thu/Fri (+139/+159R) | Sat/Sun low vol |
| S2 | Mon (+241R, 32%) · Thu (+175R, 38%) | Sun (−24R) |
| S3 | Thu (49% win, +77R) · Fri (+41R) | Sun (−3R, 17% win) |
| S4 | Tue (+147R — fat TP hits) · Mon (+80R) | Sat (−6R) |
| S5 | Mon (+89R) · Thu (+82R) | Fri (−15R) · Tue (−8R) |

---

## Structural Observations

### 1. The 08h–12h UTC Dead Zone
Consistent across S1, S2, S5. European morning (9am–1pm London).
Markets in price-discovery mode pre-US. IMBAL signals fire but momentum fails.
S3 and S4 are less affected — they rely on structure (FVG / swing sweep) not pure momentum.
**Combined loss: −82.8R. Consider as a time-of-day filter in future studies.**

### 2. The US Session Power Window (16h–19h UTC)
11am–2pm Eastern. Post-open institutional flow is committed.
Accounts for +733.9R (38% of total R) on just 28% of trades.
All streams positive except S5 at 16h (S5 is a short-bias stream; US opens are bullish on average).
S2 16h alone = +103R at 34% win — the single best stream×hour combination.

### 3. Asia Window (00h–05h UTC)
+747R across 5 hours. S1 and S4 are particularly strong here.
03h UTC: S1 hits 44.4% win, +106R — highest per-hour R for any stream×hour.
Mechanism: Asian session momentum on crypto follows through without EU/US chop interruption.
00h: S3 achieves 56.5% win — highest win rate of any stream×hour with ≥20 signals.

### 4. Thursday Effect
+485R at 36.9% win vs 28.2% overall. avg_R 2× portfolio average.
No single obvious explanation, but consistent across S1, S2, S3, S5.
S4 is an outlier here (Tuesday stronger for S4 due to 19.5R outlier hits).
Possible: position re-establishment after Tue/Wed digestion. Or coincidence — monitor live.

### 5. Sunday Weakness
All streams negative or near-zero on Sunday. 21.5% win rate.
Crypto opens Sunday evening (US) — thin float, wide spreads, noise signals.
S2 Sunday = −24R specifically. Low bar for M1 to kick in.

---

## Actionable Research Flags

1. **08h–12h entry filter**: Skipping these 742 trades would improve quality ratio. Need to simulate — some of those 742 produce winners (27% avg win) so a blanket filter may sacrifice R.
2. **Thursday vs Sunday sizing**: No current intraday sizing adjustment. If results hold out-of-sample, modest day-of-week weighting could improve Calmar.
3. **S5 at 16h**: S5 is negative at the best-overall hour (US open bullish bias vs S5's short orientation). Consider S5 time filter: skip 16h entries.
4. **S1 03h UTC**: 44.4% win is striking. Asian session IMBAL+HIGH long signals may have asymmetrically better follow-through. Worth isolating as a sub-filter study.
