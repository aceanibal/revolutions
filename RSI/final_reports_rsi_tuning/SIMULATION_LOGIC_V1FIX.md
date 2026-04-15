# V1FIX Simulation Logic

This documents the `v1fix` replay path introduced for strict 4h-signal -> 5m-execution alignment.

## Scope

- Simulator core: `RSI/simulation/ltf_trade_management_study_v1fix.py`
- Runner: `RSI/scripts/massive_chunk_backtest_5m_v1fix.py`
- Batch sequencer: `RSI/scripts/run_v1_sequence_v1fix.py`
- Single-symbol sequencer: `RSI/scripts/run_v1_sequence_single_v1fix.py`

## Execution semantics (V1FIX)

1. **Signal source (4h):**
   - Entry signal is formed after 4h bar close (same entry engine as V1).
   - Entry price, initial stop, and risk `R` come from the 4h signal record.
2. **5m replay start:**
   - Replay starts at the entry timestamp (`skip_entry_bucket_hours=0` default in v1fix).
   - This allows stop/TP/management events inside the entry 4h bucket.
3. **Baseline replay:**
   - Fixed initial stop + fixed TP cap on 5m path.
4. **Managed replay (MFE ladder):**
   - Uses cumulative MFE from entry.
   - Uses `cap_lock_by_mfe=True`.
   - **Same-bar lock activation:** when MFE threshold is touched in a 5m candle, the tightened stop is active immediately and can be hit in that same candle.

## Outputs

Both v1fix sequencers preserve run packaging:

- `runs/<run_id>/run_config.json`
- `runs/<run_id>/artifacts/*`
- `runs/<run_id>/trades/*`
- `runs/<run_id>/manifest_files.txt`

Batch/single trade exports include:

- `trade_details_v1fix_tp*.csv`
- `trade_details_v1fix_all_tp.csv`
- `replay_audit_v1fix.csv` (quick audit sample with entry/exit/stop/risk/outcomes)

## Notes

- V1FIX artifacts are isolated via `massive_chunk_v1fix_*` naming to avoid collisions with prior v1 runs.
- Legacy behavior (skip first 4h bucket) remains in non-v1fix flow.
