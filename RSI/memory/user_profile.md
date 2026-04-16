---
name: User Profile
description: Who the user is and how they work — trading strategy researcher building a systematic crypto portfolio
type: user
originSessionId: ec260109-55dd-42c6-882c-a908d1ac26ca
---
# Role

Quantitative crypto trading researcher building a systematic, multi-stream portfolio.
Works exclusively in the RSI/revolutions repo. Uses Python backtesting infrastructure
with 5m OHLCV data and 1h signal detection bars.

# Working style

- Prefers aggressive, high-Calmar configs once edge is confirmed
- Drives research iteratively: sweep → identify regime → lock filter → fine-tune parameters
- Doesn't need lengthy explanations of basics — gets straight to the numbers
- Likes concise result tables, not prose summaries of what the code does
- Makes decisions quickly once the data is clear

# Portfolio philosophy

- Each stream must have confirmed edge across all 4 years (2022-2025)
- 2022 (bear market) is the key robustness test — strategies that fail 2022 are rejected
  unless the loss is small and there's a structural explanation
- Calmar ratio is the primary optimization target, ann_R secondary
- Regime filtering is non-negotiable — mixing regimes kills edge

# Technical context

- Python backtesting with ThreadPoolExecutor for parallel sweeps
- `lab/sim/exit.py`: replay_trade_5m (single BE trigger) and replay_trade_mfe_ladder_5m (N-stage)
- `lab/sim/entry.py`: tp_price_from_r
- Signal labels: structure (BALANCED/IMBALANCED based on ER), vol_q (HIGH/MED/LOW)
- All studies in `lab/study_*.py`, results saved to `cache/*.csv`
