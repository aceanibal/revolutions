# Strategy Registry

Authoritative, per-stream specs for every confirmed live strategy. One file
per stream. Any change to a stream (signal rule, stop, TP, universe,
reference stats) must be reflected here **before** it goes into the master
runner or the memory file.

## Streams

| file | stream | regime | side | filter | stop | active mgmt | TP | universe |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [S1_imbal_high_long.md](./S1_imbal_high_long.md) | S1 | IMBAL+HIGH | Long | bullish momentum (body>0.55, close>0.85, vol_r>1.8) | ATR×2.0 fixed | none | 12R | 6 syms |
| [S2_bal_high_short.md](./S2_bal_high_short.md) | S2 | BAL+HIGH | Short | bearish momentum (body>0.55, close<0.20, vol_r>1.5) | ATR×1.5 fixed | none | 3R | 6 syms |
| [S3_bal_high_short_fvg.md](./S3_bal_high_short_fvg.md) | S3 | BAL+HIGH | Short | bearish momentum **+ bearish FVG** (body>0.55, close<0.15, vol_r>1.8) | **FVG-LOW** (`high[i]+ATR×0.15`) | none | 4.25R | 6 syms |
| [S4_bal_high_swing_low_long.md](./S4_bal_high_swing_low_long.md) | S4 | BAL+HIGH | Long | equal-lows sweep (rejection≥0.90, lookback=50, tolerance=0.5%) | ATR×2.0 fixed | **BE lock @ 3.5R → +1R** | 19.5R | 6 syms |
| [S5_imbal_high_short.md](./S5_imbal_high_short.md) | S5 | IMBAL+HIGH | Short | bearish momentum (body>0.55, close<0.15, vol_r>1.8) | ATR×2.0 fixed | none | 5R | 6 syms | ✅ wired 2026-04-16 |

## Mechanism map

- **FVG filter / FVG-LOW stop** — S3 only. Requires a bearish fair-value gap
  (high[i] < low[i-2]) on the signal bar; stop placed just above the gap
  bottom.
- **BE-lock** — S4 only. When MFE ≥ 3.5R, stop moves to entry + 1.0R.
- **Fixed stop, no management** — S1, S2, S3, S5 (stop placement differs; none
  of them move during the trade).

## Rules of engagement

- **Never** publish new stream stats without updating the matching file here
  first.
- The master runner `lab/run_all_streams.py` MUST import configs consistent
  with these files.
- Reference stats are pinned to a specific run directory
  (`runs/run_all_streams_<stamp>/`) so results are reproducible.
- BAL+MED regime is rejected project-wide. Do not propose new streams there.

## Universe (all streams)

`BTCUSDT, ETHUSDT, SOLUSDT, LINKUSDT, DOGEUSDT, XRPUSDT`

Start: 2022-01-01. Fee: 3.0 bps round-trip. Data: `data/backtest.sqlite`.
