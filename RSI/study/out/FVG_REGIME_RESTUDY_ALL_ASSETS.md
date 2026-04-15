# FVG Regime Re-Study (All Assets, 1h, 48m, strict)

- Symbols: BTCUSDT, ETHUSDT, XRPUSDT, SOLUSDT, LINKUSDT, DOGEUSDT
- Strict settings: min-gap-bps=5, strict-fvg=True, disp-quantile=0.85, disp-lookback=120
- `bull_edge_fast = plus1r_fast - minus1r_fast` over 24-bar forward horizon

| symbol | bull_events | bull_edge_fast | bull_imb_n | bull_imb_edge_fast | stop_anchor_avg_mean_r | tp_anchor_avg_mean_r |
| --- | --- | --- | --- | --- | --- | --- |
| DOGEUSDT | 1334 | 0.0405 | 331 | 0.0665 | -0.0008 | -0.0267 |
| SOLUSDT | 1492 | 0.0308 | 316 | 0.0443 | 0.0255 | 0.0078 |
| LINKUSDT | 1521 | 0.0316 | 317 | 0.0347 | -0.0244 | 0.0054 |
| BTCUSDT | 1342 | 0.0693 | 308 | 0.0065 | 0.0609 | 0.0326 |
| ETHUSDT | 1415 | 0.0382 | 324 | 0.0000 | 0.0097 | 0.0503 |
| XRPUSDT | 1289 | 0.0186 | 348 | -0.0057 | 0.0126 | -0.0524 |

- Summary CSV: `/Users/anibalperez/revolutions/RSI/study/out/fvg_regime_restudy_all_assets_summary.csv`
