# V1 final comparison: RSI band × first-stage MFE ladder (TP 8R)

**Date:** 2026-04-09  
**Engine:** `scripts/massive_chunk_backtest_5m.py` (V1: 2-stage MFE ladder vs fixed SL/TP baseline on 5m replay)

## Fixed configuration (all four runs)

| Parameter | Value |
|-----------|--------|
| Symbols | BTCUSDT, ETHUSDT, XRPUSDT, SOLUSDT, LINKUSDT |
| Window | start `2022-01-01` UTC → latest 5m per symbol |
| Chunking | monthly (trades bucketed by **managed** exit time) |
| Entry engine | 4h RSI cross, structural SL |
| `sl_n` | 2 |
| Entry list TP | 5R |
| Fee | 3 bps (round-trip as in runner) |
| **Replay TP** | **8R** (baseline cap and managed TP cap) |
| **Stage 2 ladder** | **6.5R → 5.5R** (unchanged across runs) |
| Stage 1 ladder | **Varies** (see scenarios below) |

**Baseline** = fixed SL/TP at 8R on 5m path (`replay_trade_5m`).  
**Managed** = same trade + **MFE ladder** with `cap_lock_by_mfe=True` (`replay_trade_mfe_ladder_5m`).

## Source snapshots (by-asset CSVs)

All four tables below were read from:

`runs/v1_final_comparison/by_asset_snapshots/`

| Scenario | File |
|----------|------|
| RSI 35/60, stage1 **1.0/0.8** | `tp8_mfe10_lock08_rsi3560.csv` |
| RSI 35/60, stage1 **0.9/0.7** | `tp8_mfe09_lock07_rsi3560.csv` |
| RSI 40/65, stage1 **1.0/0.8** | `tp8_mfe10_lock08_rsi4065.csv` |
| RSI 40/65, stage1 **0.9/0.7** | `tp8_mfe09_lock07_rsi4065.csv` |

---

## Pooled summary (sum over symbols)

| RSI band | Stage 1 (MFE → lock) | Trades | Baseline R | Managed R | Δ (managed − baseline) |
|:--------:|:--------------------:|-------:|-----------:|----------:|-----------------------:|
| 35 / 60 | 1.0R → 0.8R | 1587 | +1182.12 | +1014.22 | **−167.90** |
| 35 / 60 | 0.9R → 0.7R | 1587 | +1182.12 | +1039.92 | **−142.20** |
| 40 / 65 | 1.0R → 0.8R | 1621 | +907.05 | +1035.85 | **+128.80** |
| 40 / 65 | 0.9R → 0.7R | 1621 | +907.05 | +1054.35 | **+147.30** |

**Within same RSI band (same trade count), effect of loosening stage 1 from 1.0/0.8 → 0.9/0.7**

- **RSI 35/60:** managed improves by **+25.70R** (still below baseline at TP 8).
- **RSI 40/65:** managed improves by **+18.50R** (still above baseline at TP 8).

**Across bands for the same stage‑1 1.0/0.8:** RSI **40/65** uses a **different entry set** (1621 vs 1587 trades) and flips sign of pooled Δ vs **35/60**.

---

## Per-symbol: RSI 35/60 (1587 trades; baseline identical across both ladders)

| Symbol | Ladder | Win % (managed) | Max DD R (managed) | Baseline R | Managed R | Δ |
|--------|--------|-----------------|--------------------|------------|-----------|---|
| BTCUSDT | 1.0/0.8 | 51.49% | 23.19 | 285.44 | 185.74 | −99.70 |
| BTCUSDT | 0.9/0.7 | 52.08% | 24.79 | 285.44 | 195.44 | −90.00 |
| ETHUSDT | 1.0/0.8 | 46.85% | 28.21 | 318.09 | 198.49 | −119.60 |
| ETHUSDT | 0.9/0.7 | 47.15% | 22.31 | 318.09 | 200.99 | −117.10 |
| XRPUSDT | 1.0/0.8 | 55.33% | 8.52 | 246.40 | 200.60 | −45.80 |
| XRPUSDT | 0.9/0.7 | 55.74% | 9.32 | 246.40 | 211.80 | −34.60 |
| SOLUSDT | 1.0/0.8 | 52.66% | 12.93 | 163.24 | 245.64 | +82.40 |
| SOLUSDT | 0.9/0.7 | 53.78% | 10.63 | 163.24 | 238.14 | +74.90 |
| LINKUSDT | 1.0/0.8 | 49.53% | 12.47 | 168.95 | 183.75 | +14.80 |
| LINKUSDT | 0.9/0.7 | 50.79% | 13.07 | 168.95 | 193.55 | +24.60 |

---

## Per-symbol: RSI 40/65 (1621 trades; baseline identical across both ladders)

| Symbol | Ladder | Win % (managed) | Max DD R (managed) | Baseline R | Managed R | Δ |
|--------|--------|-----------------|--------------------|------------|-----------|---|
| BTCUSDT | 1.0/0.8 | 47.09% | 16.25 | 127.37 | 146.57 | +19.20 |
| BTCUSDT | 0.9/0.7 | 47.97% | 15.52 | 127.37 | 147.07 | +19.70 |
| ETHUSDT | 1.0/0.8 | 48.87% | 18.85 | 120.65 | 123.75 | +3.10 |
| ETHUSDT | 0.9/0.7 | 49.51% | 18.55 | 120.65 | 117.45 | −3.20 |
| XRPUSDT | 1.0/0.8 | 53.19% | 11.54 | 185.91 | 175.71 | −10.20 |
| XRPUSDT | 0.9/0.7 | 53.90% | 10.04 | 185.91 | 191.71 | +5.80 |
| SOLUSDT | 1.0/0.8 | 56.43% | 8.75 | 263.57 | 331.27 | +67.70 |
| SOLUSDT | 0.9/0.7 | 58.53% | 8.64 | 263.57 | 341.07 | +77.50 |
| LINKUSDT | 1.0/0.8 | 49.51% | 9.02 | 209.54 | 258.54 | +49.00 |
| LINKUSDT | 0.9/0.7 | 51.15% | 10.86 | 209.54 | 257.04 | +47.50 |

---

## Short takeaways

1. At **TP 8R** with stage‑2 **6.5/5.5**, **RSI 40/65** entries make **managed** beat **baseline** in the pool for both stage‑1 ladders; **RSI 35/60** entries do not (managed trails baseline in both cases).
2. **Loosening stage 1** (1.0/0.8 → 0.9/0.7) **helps managed R** in the pool for **both** RSI settings, with the largest per‑symbol shifts depending on asset (e.g. XRP/SOL vs ETH/LINK).
3. **Win %** and **max DD (managed)** are reported **per symbol** in the runner’s by‑asset table (sequential managed-R DD within each asset window, not a portfolio DD).

---

## Machine-readable companion

See `v1_rsi_band_mfe_stage1_tp8_comparison.csv` in this folder for the same rows in CSV form.
