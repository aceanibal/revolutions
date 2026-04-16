# Target Map — Locked S1/S2/S3/S4

Use this as the operational target map for reruns and audits.

## Streams

| Stream | Regime | Side | Filter | Stop | TP | Management |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | IMBAL+HIGH | Long | bullish momentum (`vol>1.8`, `body>0.55`, `close>0.85`) | ATR×2.0 fixed | 12R | none |
| S2 | BAL+HIGH | Short | bearish momentum (`vol>1.5`, `body>0.55`, `close<0.20`) | ATR×1.5 fixed | 3R | none |
| S3 | BAL+HIGH | Short | bearish momentum + bearish FVG (`vol>1.8`, `body>0.55`, `close<0.15`, `has_fvg`) | FVG-LOW + ATR×0.15 (`risk=ATR×2`) | 4.25R | none |
| S4 | BAL+HIGH | Long | equal-lows sweep (`lookback=50`, `tol=0.5%`, `rejection>=0.90`) | ATR×2.0 fixed | 19.5R | BE lock `3.5R -> +1R` |

## Canonical sources

- Runner: `lab/run_all_streams.py`
- Strategy registry: `strategy/README.md`
- Stream docs:
  - `strategy/S1_imbal_high_long.md`
  - `strategy/S2_bal_high_short.md`
  - `strategy/S3_bal_high_short_fvg.md`
  - `strategy/S4_bal_high_swing_low_long.md`
- Memory summary: `memory/project_live_streams.md`

## Non-negotiables

- One TP per stream per run; no TP sweeps in the master run.
- All streams run on BTC, ETH, SOL, LINK, DOGE, XRP.
- Fee = 3 bps RT, start = 2022-01-01.
