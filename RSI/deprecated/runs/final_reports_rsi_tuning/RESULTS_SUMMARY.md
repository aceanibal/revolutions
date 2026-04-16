# RSI Tuning Results Summary

## Included result sets

- RSI-only sweep on ETH/BTC/XRP/SOL/LINK
- Compact RSI+MFE/lock+SL_N sweep
- Year-by-asset RSI adaptive pattern outputs

## Top outcomes

### RSI-only sweep best (by total managed R)

- RSI: `40/65`
- Managed total R: `+1073.046`
- Trades: `1621`
- Weighted win %: `53.42%`

### Balanced lower-frequency candidate (>=10% fewer trades)

- RSI: `40/70`
- Managed total R: `+848.668`
- Trades: `1363`
- Trade reduction vs 35/60: `14.11%`
- Weighted win %: `53.19%`

### Compact sweep best

- RSI: `35/60`
- SL_N (MAE proxy): `2`
- Ladder: `(0.8->0.6), (6.0->5.0)`
- Managed total R: `+936.507`
- Trades: `1487`

### Year-adaptive output snapshot

- Rows in `rsi_year_asset_best.csv`: `1`
- Rows in `rsi_year_global_pattern.csv`: `1`

## Files in this bundle

- `FINAL_COMPACT_RSI_MFE_MAE_SWEEP.md`
- `FINAL_RSI_ENTRY_ADAPTIVE_PATTERN.md`
- `FINAL_RSI_ONLY_SWEEP_FREQ_ETH_NO_DOGE.md`
- `compact_rsi_mfe_mae_sweep.csv`
- `rsi_only_sweep_eth_no_doge.csv`
- `rsi_year_asset_best.csv`
- `rsi_year_asset_grid_managed.csv`
- `rsi_year_global_pattern.csv`
