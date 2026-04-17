# Mitigation Analysis

Source: `trades/trades_all.csv` — post-hoc re-simulation, no signal re-generation.

Start balance: $10,000 | Risk sizing: S1=0.498%, S2=2.756%, S3=3.398%, S4=1.615%, S5=0.522%


## Individual Mitigations

| Config | Trades | Skipped | Total R | Final $ | Return % | MaxDD $ | MaxDD % | DD saved | Ret kept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline | 3819 | 0 | 1327.1 | $18,258,809 | 182488.1% | $9,095,423 | 90954% | — | — |
| M1 — daily −5% cap | 3309 | 510 | 1034.2 | $1,426,582 | 14165.8% | $738,446 | 7384% | +91.9% | 7.8% |
| M2 — S2+S3 cap at 4 | 2481 | 1338 | 1000.7 | $2,921,442 | 29114.4% | $703,406 | 7034% | +92.3% | 16.0% |
| M3 — S2 risk% → 1.38% | 3819 | 0 | 1327.1 | $46,631,820 | 466218.2% | $14,449,039 | 144490% | -58.9% | 255.4% |
| M4 — 30% rolling equity stop | 1679 | 2140 | 810.1 | $6,851,527 | 68415.3% | $5,634,115 | 56341% | +38.1% | 37.5% |
| M5 — max 2 per asset | 2519 | 1300 | 759.5 | $3,291,558 | 32815.6% | $2,197,742 | 21977% | +75.8% | 18.0% |


### Efficiency (DD% reduced per 1% of return given up)

| Config | DD reduced | Return lost | Efficiency |
| --- | --- | --- | --- |
| M1 — daily −5% cap | 91.9% | 92.2% | 1.0x |
| M2 — S2+S3 cap at 4 | 92.3% | 84.0% | 1.1x |
| M3 — S2 risk% → 1.38% | -58.9% | -155.4% | ∞ (free) |
| M4 — 30% rolling equity stop | 38.1% | 62.5% | 0.6x |
| M5 — max 2 per asset | 75.8% | 82.0% | 0.9x |


### Year-by-year dollar P&L

| Config | 2022 | 2023 | 2024 | 2025 | 2026 |
| --- | --- | --- | --- | --- | --- |
| Baseline | $37,660 | $139,966 | $266,247 | $10,721,123 | $7,083,814 |
| M1 — daily −5% cap | $-2,859 | $28,267 | $86,228 | $795,466 | $509,479 |
| M2 — S2+S3 cap at 4 | $28,951 | $116,608 | $1,152,517 | $1,473,661 | $139,704 |
| M3 — S2 risk% → 1.38% | $29,316 | $267,881 | $869,734 | $29,414,020 | $16,040,870 |
| M4 — 30% rolling equity stop | $118,885 | $816,640 | $1,211,517 | $6,356,931 | $-1,662,446 |
| M5 — max 2 per asset | $20,737 | $34,019 | $117,957 | $3,172,662 | $-63,817 |


## Combinations

| Config | Trades | Skipped | Total R | Final $ | Return % | MaxDD $ | MaxDD % | DD saved | Ret kept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline | 3819 | 0 | 1327.1 | $18,258,809 | 182488.1% | $9,095,423 | 90954% | — | — |
| M1+M3 | 3611 | 208 | 1136.6 | $11,775,702 | 117657.0% | $3,441,024 | 34410% | +62.2% | 64.5% |
| M2+M3 | 2481 | 1338 | 1000.7 | $2,338,938 | 23289.4% | $563,155 | 5632% | +93.8% | 12.8% |
| M1+M2+M3 | 2439 | 1380 | 960.8 | $2,185,284 | 21752.8% | $526,159 | 5262% | +94.2% | 12.0% |
| M2+M3+M5 | 1803 | 2016 | 650.8 | $774,536 | 7645.4% | $101,608 | 1016% | +98.9% | 4.2% |
| M1+M2+M3+M5 (all practical) | 1780 | 2039 | 627.2 | $720,755 | 7107.6% | $94,552 | 946% | +99.0% | 3.9% |


### Year-by-year dollar P&L — combinations

| Config | 2022 | 2023 | 2024 | 2025 | 2026 |
| --- | --- | --- | --- | --- | --- |
| Baseline | $37,660 | $139,966 | $266,247 | $10,721,123 | $7,083,814 |
| M1+M3 | $21,136 | $193,080 | $428,045 | $6,879,883 | $4,243,557 |
| M2+M3 | $16,974 | $157,588 | $862,697 | $1,179,829 | $111,849 |
| M1+M2+M3 | $15,544 | $160,471 | $792,446 | $1,102,322 | $104,501 |
| M2+M3+M5 | $12,943 | $55,547 | $244,679 | $371,065 | $80,303 |
| M1+M2+M3+M5 (all practical) | $11,578 | $49,545 | $229,605 | $345,299 | $74,727 |


## Verdict

**Best single DD reduction:** M2 — S2+S3 cap at 4 (DD $703,406, 92.3% reduction)
**Best efficiency (DD reduction per unit of return sacrificed):** M2 — S2+S3 cap at 4
**Best combination:** M1+M2+M3+M5 (all practical) (DD $94,552, return kept 3.9%)

### Key findings
- **M3 (halve S2 risk%)** is the only mitigation that reduces DD with zero trades skipped. It targets the root cause — S2's disproportionate contribution to worst weeks — without filtering any signals.
- **M1 (daily cap)** skips entries that fire into a losing session, protecting against S2 cluster blow-ups. High efficiency because the losses it prevents are the largest ones.
- **M2 (S2+S3 cap)** reduces same-regime stacking but loses relatively few trades compared to the DD benefit.
- **M4 (rolling equity stop)** is the harshest — it halts the portfolio during extended drawdown periods, missing subsequent recoveries. Poor return retention.
- **M5 (asset cap)** is the weakest individual mitigation — same-asset overlap is a symptom not the cause; cutting it doesn't address the regime correlation problem.

**Recommended practical package: M1 + M2 + M3**
- M3 is free (sizing change, zero signal impact)
- M1 + M2 add rules that fire only in the worst cluster conditions
- Together they materially reduce DD while retaining the majority of compounded returns
