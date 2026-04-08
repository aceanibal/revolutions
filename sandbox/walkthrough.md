# The Universal Portfolio Strategy

Instead of relying on highly asset-specific parameters (overfitting each asset to a localized edge), we forced the simulator to discover a single **Unified Ruleset**. The solver calculates all 480 combinations simultaneously across every **loaded** symbol (default list: `BTC`, `LINK`, `DOGE`, `SOL`, `XRP`, **`ETH`**, **`PAXG`**) to locate the mathematical "Center of Mass."

Execution is simulated on **4-hour** bars (5m history resampled to 4h in code). Trades are **structural** (not scalps): RSI cross entries, stop from the last `N` completed 4h bars, take-profit at `R` multiples.

---

## Fee assumptions (Hyperliquid-style)

- **9.0 bps round-trip (stress test):** Models full **Taker** both ways (e.g. ~4.5 bps per side). This is the conservative baseline.
- **3.0 bps round-trip (maker-style execution):** Models materially lower friction—e.g. **Maker** rebates on one or both legs, or a mix of Maker exits and Taker entries—so round-trip cost lands near **3 bps** instead of 9. Same signal logic; only per-trade fee-in-`R` changes.

All PnL below is **fixed** to the walkthrough rule: **RSI 35 / 60 | SL_N = 3 | TP = 5.0 R**, run against the shared DB (`../backtester/data/backtest.sqlite`). Reproduce:

```bash
cd sandbox
.venv/bin/python multi_asset_4h_rsi_sim.py --fee-bps 9 --fixed-rule-report
.venv/bin/python multi_asset_4h_rsi_sim.py --fee-bps 3 --fixed-rule-report
```

If a symbol has no historical `5m` session, the script prints a **warning** and continues with the rest. **`ETHUSDT`** must be imported the same way as the other pairs before it appears in the tables.

*(Create `sandbox/.venv` and `pip install -r requirements.txt` if you have not already.)*

---

### Baseline: 9.0 bps (Taker stress test)

**A. Five “core crypto” names (same window as the original study — excludes ETH/PAXG)**

| Rank | Asset | PnL (R) | Win rate | Avg hold | Min hold | Max hold* |
|:---:|:---|---:|---:|---:|---:|---:|
| 1 | **SOLUSDT** | **+36.78** | 25.8% | 21.7 h | 4 h | 328 h |
| 2 | **LINKUSDT** | **+30.00** | 27.3% | 58.0 h | 4 h | 2828 h |
| 3 | **XRPUSDT** | **+27.81** | 29.3% | 26.3 h | 4 h | 428 h |
| 4 | **BTCUSDT** | **+17.87** | 28.0% | 44.3 h | 4 h | 1692 h |
| 5 | **DOGEUSDT** | **−2.96** | 19.0% | 73.4 h | 4 h | 2832 h |

**Portfolio (these five): +109.49 R** · **Top four (SOL, LINK, XRP, BTC): +112.45 R**

**B. Extended DB list — adds `PAXGUSDT` (and `ETHUSDT` when present)**

`multi_asset_4h_rsi_sim.py` now loads **`ETHUSDT`** and **`PAXGUSDT`** from the same `backtest.sqlite` historical `5m` data as the others. Snapshot from a run where **`ETHUSDT` was not yet imported** (script warns once):

| Asset | PnL (R) | Win rate | Avg hold | Min hold | Max hold* |
|:---|---:|---:|---:|---:|---:|
| **PAXGUSDT** | **−113.13** | 23.0% | 22.2 h | 4 h | 360 h |
| **ETHUSDT** | *— (no historical session in DB for this checkout)* | — | — | — | — |

With **BTC, LINK, DOGE, SOL, XRP, PAXG** loaded (no ETH), the fixed-rule footer is:

- **Sum (all listed): −3.64 R** · **Sum (BTC+LINK+SOL+XRP): +112.45 R** · **Sum (ex-DOGE): −0.67 R**

**Takeaway:** the same **35 / 60 | SL=3 | 5R** rule that works on the major alts **does not** carry to **PAXG** on this sample—**PAXG** dominates the combined total. Treat **gold** as a **separate** sleeve (different thresholds, or exclude from the unified grid) until you validate a ruleset on it. **ETH** will add a row automatically after you import **`ETHUSDT`** `5m` history.

\*Max hold = longest **single** trade in the sample (4h-bar count × 4 hours). A few trades sit through extended chop before SL/TP.

---

### Maker-style: 3.0 bps round-trip

**A. Five core crypto names**

| Rank | Asset | PnL (R) | Win rate | Avg hold | Min hold | Max hold* |
|:---:|:---|---:|---:|---:|---:|---:|
| 1 | **XRPUSDT** | **+54.60** | 29.3% | 26.3 h | 4 h | 428 h |
| 2 | **BTCUSDT** | **+51.29** | 30.5% | 44.3 h | 4 h | 1692 h |
| 3 | **SOLUSDT** | **+46.26** | 25.8% | 21.7 h | 4 h | 328 h |
| 4 | **LINKUSDT** | **+38.00** | 27.3% | 58.0 h | 4 h | 2828 h |
| 5 | **DOGEUSDT** | **+4.35** | 19.0% | 73.4 h | 4 h | 2832 h |

**Portfolio (these five): +194.50 R** · **Top four (BTC, LINK, SOL, XRP): +190.15 R**

**B. With `PAXGUSDT` in the same run (ETH still missing in DB)**

| **PAXGUSDT** | **−11.04** | 24.3% | 22.2 h | 4 h | 360 h |

Footer (BTC, LINK, DOGE, SOL, XRP, PAXG; no ETH):

- **Sum (all listed): +183.45 R** · **Sum (BTC+LINK+SOL+XRP): +190.15 R** · **Sum (ex-DOGE): +179.11 R**

**Friction effect on the five-name book:** **9 bps → 3 bps** lifts total from **+109.49 R** to **+194.50 R** (~**+85 R** from fees alone). **Average holds do not change**—only fee drag per `R` changes.

---

### Trade duration (4h = slow burn)

- **Fast-cycle names:** **SOL** and **XRP** keep the **lowest average** hold times (~22–26 h), so capital turns over faster when the edge hits.
- **Slower structural plays:** **LINK** and **BTC** average **~2–3 days** to resolution—still not scalps; they do more of the heavy lifting in R when fees are lower.
- At **9 bps**, **DOGE** is a drag (−2.96 R). At **3 bps** it turns **small positive** (+4.35 R) but remains the weakest; many desks still **exclude DOGE** from a unified rule for stability.
- **PAXG** in this sample needs its **own** study—do not assume the alt RSI matrix transfers.

---

### Conclusion

- **4h + one universal rule** stays coherent on **liquid alts + BTC**; execution quality (9 vs 3 bps RT) is a **large** lever on the same signals.
- **Default sim** now includes **`ETHUSDT`** and **`PAXGUSDT`** when sessions exist; **re-run** after **ETH** import to see the full seven-name board.
- **Taker 9 bps:** favor **SOL, LINK, XRP, BTC**; **drop DOGE** if you want the cleanest multi-asset book; **do not** fold **PAXG** into the same rule without evidence.
- **~3 bps RT:** same story for ranking quality among the five; **DOGE** is optional (slightly positive but thin).

---

## LTF trade management (breakeven vs fixed 5R)

The ranked table above uses a **fixed 5R take-profit** on **4h** bars. A separate study asks: *after a favorable move of +X R, if we move the stop to **breakeven** (still aiming for 5R until stopped), do we reduce drawdowns or improve total R?*

- **Script:** `ltf_trade_management_study.py` (same DB, same 4h entries: RSI 35/60, SL_N=3, fee e.g. 3 bps).
- **Replay rule:** matches the bar engine (exits start **after** the entry bar — no same-bar stop/TP). Optional `--include-5m-micro` stress-tests path on 5m; default is **4h-bar** management so totals line up with your **PnL (R)** column.
- **5m “better fill” line:** median / p90 of how many **R** of **better long entry** was available inside the entry **4h** window (wick below the 4h open vs your modeled fill at the open). Use it to explore **limits** later; the study does not change the fill price unless you extend the script.

**Scenario matrix (TP × MFE × lock):** sweeps **TP targets** (`--tp-sweep`, default `2…8` R), **MFE** before arming the managed stop (`--mfe-sweep`, e.g. `1.0` for “1R MFE”), and **lock** at stop (`--lock-sweep`, `0` = breakeven, `0.5` = +0.5R). Trade **entries** come from the engine at `--entry-tp-r` (default **5** R); replay then varies TP / management on **that same trade list** (counterfactual exits).

```bash
cd sandbox
.venv/bin/python ltf_trade_management_study.py --fee-bps 3
```

Writes **`sandbox/cache/ltf_scenario_matrix.csv`** (full grid). **1R MFE only** + tighter TP/lock grid:

```bash
.venv/bin/python ltf_trade_management_study.py --fee-bps 3 \
  --mfe-sweep 1.0 --tp-sweep 4,5,6,7,8 --lock-sweep 0,0.25,0.5,1.0
```

Use `--verbose` to print every combo to the terminal, or open the CSV in a sheet and filter `mfe_r == 1`.

**TP fixed (management only):** after the main matrix, the script prints a second block where **`tp_r` is held at 5** (override with `--tp-fixed-report 5`) and only **MFE × lock** vary—so **Δ vs TP-only @ 5R** is isolated from changing the profit target. Writes `sandbox/cache/ltf_tp5_management_isolation.csv` unless `--no-csv`. Disable the extra block with `--tp-fixed-report -1`.

**Two-stage lock (`ltf_two_stage_lock_study.py`):** stage 1 fixed (**MFE 0.5R → lock +1R** by default); stage 2 arms when **cumulative** MFE from entry hits **`mfe2_r`**, then stop moves to **`lock2_r`**. Compares **TP = 3 / 5 / 8 R** (TP-only vs stage 1 only vs two-stage grid). Output: `sandbox/cache/ltf_two_stage_lock_study.csv`.

---

## Exploring another symbol (e.g. ETH-only) from this folder

Use only the shared database and the scripts in this directory:

- **Data:** `../backtester/data/backtest.sqlite` (historical `5m` candles; the sim resamples to **4h** in code).
- **ETH / single-symbol grid:** run `db_4h_rsi_sim.py` (defaults to `--symbol ETHUSDT` and **TP = 5R** unless you pass `--full-r-grid`). Use `--fee-bps 3` or `9` as needed.
- **Portfolio / universal grid search:** `multi_asset_4h_rsi_sim.py` (omit `--fixed-rule-report` to run the full 480-combo search across all loaded symbols).

`rsi_strategy_sim.py` is for **CSV inputs** under `sandbox/cache/` (e.g. ratio series), not for per-pair futures history from the DB.

If `ETHUSDT` is not in the database yet, import that symbol into `backtest.sqlite` first; until then the single-symbol script will exit with a clear message, and the multi-asset script will warn and skip **ETH**.
