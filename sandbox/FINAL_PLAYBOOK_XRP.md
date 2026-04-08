# Final XRP Playbook (Fixed Size, No Anti-Martingale)

This is the highest-quality 1:1 setup found in the latest fee-aware sweep, with realistic stop-distance filtering.

## Core Rules

- **Asset**: `XRPUSDT`
- **Entry model**: Reversal confirmations from existing `detect_reversals_5m` logic
- **Patterns**: `engulfing` + `pin_bar`
- **Levels/Zones**: `week_low`, `week_high`, `pdh`, `pdl`, `hvn` (major only)
- **Side**: `long only`
- **Time window (ET)**: `21:00 -> 08:00`
- **Trade cap**: max `2` trades/day
- **Execution**: one-trade-at-a-time
- **Risk model**: `TP = 1R`, `SL = 1R`
- **Min stop distance filter**: ignore setups where stop distance is `< 0.20%` of price

## Backtest Snapshot (same setup, different fees)

N = 196 trades, win rate = 60.2%, max losing streak = 5

- **4 bps round-trip fee (0.04%)**
  - Avg/trade: `+0.0855R`
  - PF: `1.20`
  - Total: `+16.8R`
- **6 bps round-trip fee (0.06%)**
  - Avg/trade: `+0.0211R`
  - PF: `1.05`
  - Total: `+4.1R`
- **8 bps round-trip fee (0.08%)**
  - Avg/trade: `-0.0433R`
  - PF: `0.91`
  - Total: `-8.5R`

## Fixed Position Sizing (starting equity: $10,000)

Using **fixed fractional risk**, same trade sequence:

### At 6 bps (edge is thin, but positive)

- Risk `0.25%` per trade -> final `$10,098` (`+1.0%`), max DD `2.6%`
- Risk `0.50%` per trade -> final `$10,185` (`+1.8%`), max DD `5.1%`
- Risk `1.00%` per trade -> final `$10,325` (`+3.3%`), max DD `10.1%`

### At 4 bps (healthier edge)

- Risk `0.25%` -> `+4.2%`, max DD `2.1%`
- Risk `0.50%` -> `+8.5%`, max DD `4.1%`
- Risk `1.00%` -> `+17.1%`, max DD `8.1%`

## Practical Recommendation

- If your true all-in cost is **<= 6 bps RT**, run this playbook with **0.50% fixed risk**.
- If your true cost drifts toward **8 bps RT**, pause (strategy likely not profitable).
- Re-validate every month for edge drift.
