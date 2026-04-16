# RSI Trading Strategy Research

## Session Pretext — read before responding

1. Load memory index: `memory/MEMORY.md`, then read each file it lists.
2. Read simulation rules: `lab/sim/rules.py`. Every new study or strategy must
   comply with this file.
3. Use this audited project structure as the source of truth. Do not use paths
   outside `RSI/` for memory, data, scripts, or outputs.

## Audit Status (2026-04-16)

This project was audited and simplified for live S1-S4 research.

- Active, canonical workflow is kept at root `lab/`, `scripts/`, `simulation/`,
  `cache/`, `data/`, and `memory/`.
- Non-canonical historical assets were moved to `deprecated/` with categories:
  `deprecated/lab/`, `deprecated/legacy_pipeline/`, `deprecated/reports/`,
  `deprecated/runs/`, `deprecated/cache/`.
- `lab/run_portfolio.py` exists but is experimental and unvalidated.

## Run Contract (critical)

- One run = one strategy setup + one TP (`tp_r`) + one window + one symbol set.
- TP sweeps are not standard run behavior.
- If TP changes, create a new run (`run_id` changes).
- Canonical definition lives in `memory/run_definition.md`.

## Project Layout (canonical)

- Memory: `memory/`
- Data DB: `data/backtest.sqlite`
- Core simulation rules: `lab/sim/rules.py`
- Master runner (all streams, locked configs): `lab/run_all_streams.py`
- Active studies: `lab/` (only S1-S4 relevant files)
- Active outputs: `cache/` (S1-S4 + portfolio only) and `runs/run_all_streams_*/`
- Archived/legacy outputs and experiments: `deprecated/` (includes the
  previous 4h-RSI S1 scripts `scripts/massive_chunk_backtest_5m_v2_mfe3.py`
  and `scripts/run_v2_mfe3_sequence.py`, and 4h RSI sim under
  `simulation/`)

## Environment

- Python project; deps in `requirements.txt` and `lab/requirements.txt`
- Run from repo root (`RSI/`)
- Default fee: 3.0 bps RT
- Default stop activation skip: 0.0h
- Default stop update: same-bar
- Portfolio risk sizing target: `risk_pct = 35 / stream_maxDD_r`

## Canonical Live Streams (S1-S4)

Authoritative per-stream specs live in `strategy/` — one file per stream.
See `strategy/README.md` for the registry and mechanism map.
`memory/project_live_streams.md` is a secondary summary.

- **S1 — IMBAL+HIGH Long** (bullish momentum continuation)
  - Fixed ATR×2.0 stop, TP=12R, no mgmt. Spec: `strategy/S1_imbal_high_long.md`.
- **S2 — BAL+HIGH Short** (bearish momentum, no FVG)
  - Fixed ATR×1.5 stop, TP=3R, no mgmt. Spec: `strategy/S2_bal_high_short.md`.
- **S3 — BAL+HIGH Short with FVG** (FVG filter + FVG-LOW stop)
  - Stop = `high[i] + ATR×0.15`, TP=4.25R, risk basis ATR×2.0, no mgmt.
    Spec: `strategy/S3_bal_high_short_fvg.md`.
- **S4 — BAL+HIGH Swing Low Long** (equal-lows sweep + BE lock)
  - ATR×2.0 stop, BE lock `trig=3.5R → lock=+1.0R`, TP=19.5R.
    Spec: `strategy/S4_bal_high_swing_low_long.md`.

All streams run on BTC, ETH, SOL, LINK, DOGE, XRP. Start 2022-01-01. Fee
3.0 bps round-trip.

## Key Rules (strategy-level)

- BAL+MED regime is rejected. Do not include in new studies.
- S1 is a low-win-rate (~12%) fat-tail strategy; do not optimise for win rate.
  The edge is in TP=12R outliers — keep the stop fixed at ATR×2.0.
- S1 runs on all 6 symbols (BTC, ETH, SOL, LINK, DOGE, XRP).
- S2 runs on BAL+HIGH bearish momentum with no FVG requirement.
- S3 runs on BAL+HIGH bearish momentum with bearish FVG required and an
  FVG-LOW stop.
- Only S3 uses the **FVG filter / FVG-LOW stop**. Only S4 uses the
  **BE-lock** active-management rule. S1, S2, S3 use fixed stops.
- Always derive HTF bars from 5m bars and follow `lab/sim/rules.py` timing rules.
- Changes to a stream's signal, stop, TP, or universe **must** update the
  matching file in `strategy/` first; the master runner must import values
  consistent with `strategy/`.

## Protection Rules (workflow)

- If a run/file already produced a confirmed result, reuse it. For variants,
  copy then modify; do not overwrite confirmed baselines.
- Write outputs to dedicated CSVs under `cache/` (active) or `deprecated/cache/`
  (archived). Keep files organized and named by study/config.
- Always re-read `lab/sim/rules.py` before writing new simulation code.
- Assign/filter chunks by EXIT timestamp, not entry (Rule 16).
- One position per symbol at a time. No pyramiding (Rule 5 / L10).
