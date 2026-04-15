"""
Bollinger Band Mean-Reversion Strategy — BALANCED regime only.

Signal logic (4h bars):
  Long:  close[i] crosses BELOW lower BB band in BALANCED structure regime
  Short: close[i] crosses ABOVE upper BB band in BALANCED structure regime
  Entry: open of bar i+1 (first 5m bar after signal bar closes) — Rule 1

Stop (ATR-based, Rule 4):
  Long:  entry_price - ATR[i] * atr_mult
  Short: entry_price + ATR[i] * atr_mult
  ATR[i] is from the signal bar (fully known at entry time).
  atr_mult=1.5 — gives the trade room for normal BB wick noise without
  being wide enough to absorb a full trending move against position.

Regime filter:
  Only enter when structure == BALANCED.
  Optionally skip HIGH vol bars (see params.skip_high_vol).
  BB mean reversion works best in ranging/balanced markets. In trending
  (IMBALANCED) conditions the band acts as support/resistance for continuation,
  not reversal — taking the mean-reversion trade would be fading a trend.

TP sweep: 1.0R, 1.5R, 2.0R (fixed limit orders, no MFE management).
  Both baseline_r and managed_r are identical (no active management) —
  this is a study of the signal, not the exit method.

Outputs:
  runs/run_bb_balanced_<ts>/
    run_config.json
    trades/
      trade_details_bb_balanced_tp1p0.csv
      trade_details_bb_balanced_tp1p5.csv
      trade_details_bb_balanced_tp2p0.csv
    artifacts/
      bb_balanced_tp*_results.csv
      bb_balanced_tp*_results_by_asset.csv
      regime_<SYMBOL>.csv           ← full regime timeseries for the app
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from ta.volatility import BollingerBands

from lab.base.strategy import BaseStrategy, StrategyConfig
from lab.core.db import load_merged_5m
from lab.core.regime import BALANCED, classify_regimes, regime_numeric
from lab.core.resample import resample_ohlcv
from lab.output.run_writer import RunWriter
from lab.schemas.types import RunManifest, TradeRecord
from lab.sim.exit import replay_trade_5m
from lab.sim.entry import tp_price_from_r


@dataclass
class BBBalancedParams:
    """
    Tunable parameters for the BB Balanced strategy.

    bb_period       : Bollinger Band moving average window (bars)
    bb_std          : Standard deviation multiplier for bands
    atr_period      : ATR period for stop calculation
    atr_mult        : Stop distance = ATR * atr_mult
                      1.5 chosen to: absorb normal BB wick noise (price often
                      briefly breaks the band then returns) while not being so
                      wide that a genuine trend move doesn't stop you out.
    er_period       : Efficiency Ratio lookback for regime
    er_threshold    : ER below this = BALANCED (mean-reverting)
    skip_high_vol   : If True, skip entries when vol regime == HIGH.
                      BB breakouts in high-vol are often genuine, not mean-rev.
    tp_sweep        : List of R-multiples for TP (e.g. [1.0, 1.5, 2.0])
    """
    bb_period: int = 20
    bb_std: float = 2.0
    atr_period: int = 14
    atr_mult: float = 1.5
    atr_ma_period: int = 50
    er_period: int = 20
    er_threshold: float = 0.35
    skip_high_vol: bool = True
    htf: str = "1h"
    tp_sweep: list[float] = field(default_factory=lambda: [1.0, 1.5, 2.0])


class BBBalancedStrategy(BaseStrategy):
    """
    Bollinger Band mean-reversion in BALANCED regime.

    Usage:
        from lab.strategies.bb_balanced import BBBalancedStrategy, BBBalancedParams
        from lab.base.strategy import StrategyConfig

        cfg = StrategyConfig(
            db_path="/path/to/backtest.sqlite",
            symbols=["XRPUSDT"],
            start_utc="2022-01-01",
            fee_bps=3.0,
        )
        run_dir = BBBalancedStrategy(cfg).run(Path("runs/"))
    """

    STRATEGY_ID = "bb_balanced"
    VERSION = "1.0"

    def __init__(self, config: StrategyConfig, params: BBBalancedParams | None = None):
        super().__init__(config)
        self.params = params or BBBalancedParams()

    def run(self, runs_dir: Path) -> Path:
        p = self.params
        cfg = self.config
        writer = RunWriter(runs_dir)
        run_dir, run_id = writer.create_run_dir(self.STRATEGY_ID)

        start_utc = pd.Timestamp(cfg.start_utc, tz="UTC")
        end_utc = pd.Timestamp(cfg.end_utc, tz="UTC") if cfg.end_utc else None

        all_trades_by_tp: dict[float, list[TradeRecord]] = {tp: [] for tp in p.tp_sweep}

        for symbol in cfg.symbols:
            print(f"  [{symbol}] loading 5m data...")
            df5 = load_merged_5m(cfg.db_path, symbol)
            if len(df5) == 0:
                print(f"  [{symbol}] no data — skipped")
                continue

            df5_win = df5.loc[df5.index >= start_utc]
            if end_utc is not None:
                df5_win = df5_win.loc[df5_win.index < end_utc]
            if len(df5_win) < 200:
                print(f"  [{symbol}] insufficient data — skipped")
                continue

            # Build HTF OHLCV and add indicators
            df4h = resample_ohlcv(df5_win, p.htf).copy()

            # Bollinger Bands
            bb = BollingerBands(
                close=df4h["close"],
                window=p.bb_period,
                window_dev=p.bb_std,
                fillna=False,
            )
            df4h["bb_upper"] = bb.bollinger_hband()
            df4h["bb_lower"] = bb.bollinger_lband()
            df4h["bb_mid"]   = bb.bollinger_mavg()
            df4h["bb_width"] = bb.bollinger_wband()

            # Regime classification (on same 4h bars)
            df4h = classify_regimes(
                df4h,
                atr_period=p.atr_period,
                atr_ma_period=p.atr_ma_period,
                er_period=p.er_period,
                er_balanced_threshold=p.er_threshold,
            )

            # Save regime timeseries as artifact for the app
            _write_regime_artifact(run_dir, symbol, df4h, p.htf)

            # Generate entry signals
            entries = _run_bb_entries(df4h, p)
            print(f"  [{symbol}] {len(entries)} BB entries in BALANCED regime")

            # Replay each entry at each TP multiple
            for tp_r in p.tp_sweep:
                n_ok = 0
                for e in entries:
                    entry_ts = df4h.index[e["entry_idx"]]
                    tp_price = tp_price_from_r(e["entry_price"], e["risk"], e["side"], tp_r)

                    # Fixed SL/TP — no MFE management (this is a signal study)
                    result = replay_trade_5m(
                        df5_win, entry_ts, e["side"],
                        e["entry_price"], e["stop_loss"], tp_price,
                        e["risk"], cfg.fee_bps,
                        be_trigger_r=None,
                        be_offset_r=0.0,
                        skip_entry_bucket_hours=0.0,
                    )
                    if result is None:
                        continue

                    all_trades_by_tp[tp_r].append(TradeRecord(
                        symbol=symbol,
                        strategy_id=self.STRATEGY_ID,
                        tp_r=tp_r,
                        entry_ts_utc=str(entry_ts),
                        exit_ts_utc=str(result.exit_ts),
                        side=e["side"],
                        entry_price=e["entry_price"],
                        stop_init=e["stop_loss"],
                        risk=e["risk"],
                        tp_price=tp_price,
                        fee_bps=cfg.fee_bps,
                        baseline_r=round(result.pnl_r, 8),
                        managed_r=round(result.pnl_r, 8),  # same — no mgmt
                        managed_reason=result.reason,
                        hold_5m_bars=result.bars,
                        stages=[],
                        signal_meta={
                            "bb_period":   p.bb_period,
                            "bb_std":      p.bb_std,
                            "atr_mult":    p.atr_mult,
                            "bb_upper":    round(e["bb_upper"], 6),
                            "bb_lower":    round(e["bb_lower"], 6),
                            "bb_mid":      round(e["bb_mid"], 6),
                            "bb_width":    round(e["bb_width"], 6),
                            "atr":         round(e["atr"], 6),
                            "atr_ratio":   round(e["atr_ratio"], 4),
                            "er":          round(e["er"], 4),
                            "structure":   e["structure"],
                            "vol":         e["vol"],
                            "regime":      e["regime"],
                            "entry_idx_4h": e["entry_idx"],
                        },
                    ))
                    n_ok += 1
                print(f"  [{symbol}] tp={tp_r}R: {n_ok} trades replayed")

        # Write trade files and artifacts
        all_tp_trades: list[TradeRecord] = []
        for tp_r, trades in all_trades_by_tp.items():
            if trades:
                writer.write_trades(run_dir, self.STRATEGY_ID, tp_r, trades)
                writer.write_chunk_results(run_dir, self.STRATEGY_ID, tp_r, trades)
                all_tp_trades.extend(trades)

        manifest = RunManifest(
            run_id=run_id,
            strategy_id=self.STRATEGY_ID,
            strategy_version=self.VERSION,
            db_path=cfg.db_path,
            symbols=cfg.symbols,
            start_utc=cfg.start_utc,
            end_utc=cfg.end_utc or "(auto latest)",
            fee_bps=cfg.fee_bps,
            params={
                "bb_period":      p.bb_period,
                "bb_std":         p.bb_std,
                "atr_period":     p.atr_period,
                "atr_mult":       p.atr_mult,
                "er_period":      p.er_period,
                "er_threshold":   p.er_threshold,
                "skip_high_vol":  p.skip_high_vol,
                "htf":            p.htf,
                "tp_sweep":       p.tp_sweep,
            },
            created_at=datetime.now(timezone.utc).isoformat(),
            tp_sweep=p.tp_sweep,
        )
        writer.write_manifest(run_dir, manifest)

        print(f"\nDone. Run: {run_dir}")
        print(f"Total trades (all TPs): {len(all_tp_trades)}")
        return run_dir


# ── Entry signal engine ────────────────────────────────────────────────────

def _run_bb_entries(df4h: pd.DataFrame, p: BBBalancedParams) -> list[dict]:
    """
    Scan 4h bars for BB crossover entries in BALANCED regime.

    Signal bar i → entry bar i+1 (Rule 1: act only after bar closes).

    Long:  close[i] < bb_lower[i]  (close below lower band)
           AND structure[i] == BALANCED
           AND (not skip_high_vol OR vol[i] != HIGH)

    Short: close[i] > bb_upper[i]  (close above upper band)
           AND structure[i] == BALANCED
           AND (not skip_high_vol OR vol[i] != HIGH)

    Stop (Rule 4 — use signal bar's ATR, known at entry):
      Long:  entry_price - atr[i] * atr_mult
      Short: entry_price + atr[i] * atr_mult

    Returns list of entry dicts with full signal metadata.
    """
    from lab.core.regime import VOL_HIGH

    entries: list[dict] = []
    position = 0
    n = len(df4h)
    min_idx = max(p.bb_period, p.atr_period + p.atr_ma_period, p.er_period) + 2

    for i in range(min_idx, n - 1):
        row = df4h.iloc[i]

        # Skip bars with incomplete indicators
        if pd.isna(row.get("bb_lower")) or pd.isna(row.get("structure")) or pd.isna(row.get("atr")):
            continue

        structure = row["structure"]
        vol       = row["vol"]

        # Regime filter
        if structure != BALANCED:
            continue
        if p.skip_high_vol and vol == VOL_HIGH:
            continue

        # Entry bar is i+1
        entry_bar = df4h.iloc[i + 1]
        if pd.isna(entry_bar["open"]):
            continue

        entry_price = float(entry_bar["open"])
        atr_val     = float(row["atr"])

        if position == 0:
            close_i    = float(row["close"])
            bb_lower_i = float(row["bb_lower"])
            bb_upper_i = float(row["bb_upper"])

            if close_i < bb_lower_i:
                # Long entry
                stop = entry_price - atr_val * p.atr_mult
                risk = entry_price - stop
                if risk <= 0:
                    continue
                entries.append(_entry_dict(
                    entry_idx=i + 1, side=1,
                    entry_price=entry_price, stop=stop, risk=risk, row=row,
                ))
                position = 1

            elif close_i > bb_upper_i:
                # Short entry
                stop = entry_price + atr_val * p.atr_mult
                risk = stop - entry_price
                if risk <= 0:
                    continue
                entries.append(_entry_dict(
                    entry_idx=i + 1, side=-1,
                    entry_price=entry_price, stop=stop, risk=risk, row=row,
                ))
                position = -1

        else:
            # Simple flat-on-close: reset position once signal bar is neutral
            close_i    = float(row["close"])
            bb_lower_i = float(row["bb_lower"])
            bb_upper_i = float(row["bb_upper"])

            # Close position if price returns to midband
            if position == 1 and close_i >= float(row["bb_mid"]):
                position = 0
            elif position == -1 and close_i <= float(row["bb_mid"]):
                position = 0

    return entries


def _entry_dict(
    entry_idx: int,
    side: int,
    entry_price: float,
    stop: float,
    risk: float,
    row: pd.Series,
) -> dict:
    return {
        "entry_idx":  entry_idx,
        "side":       side,
        "entry_price": entry_price,
        "stop_loss":  stop,
        "risk":       risk,
        "bb_upper":   float(row.get("bb_upper", np.nan)),
        "bb_lower":   float(row.get("bb_lower", np.nan)),
        "bb_mid":     float(row.get("bb_mid", np.nan)),
        "bb_width":   float(row.get("bb_width", np.nan)),
        "atr":        float(row.get("atr", np.nan)),
        "atr_ratio":  float(row.get("atr_ratio", np.nan)),
        "er":         float(row.get("er", np.nan)),
        "structure":  row.get("structure", ""),
        "vol":        row.get("vol", ""),
        "regime":     row.get("regime", ""),
    }


# ── Artifact writer ────────────────────────────────────────────────────────

def _write_regime_artifact(run_dir: Path, symbol: str, df4h: pd.DataFrame, htf: str = "1h") -> None:
    """
    Save the full regime timeseries as a CSV artifact.
    The app loads this to show regime panels and BB bands on charts.
    """
    from lab.core.regime import regime_numeric

    cols = [c for c in [
        "open", "high", "low", "close",
        "bb_upper", "bb_lower", "bb_mid", "bb_width",
        "atr", "atr_ma", "atr_ratio", "er",
        "structure", "vol", "regime",
    ] if c in df4h.columns]

    out = regime_numeric(df4h[cols].copy())
    out.index.name = "ts"
    out.attrs["htf"] = htf  # stored in CSV header comment
    out.to_csv(run_dir / "artifacts" / f"regime_{symbol}.csv")
    # Write htf as a sidecar so the app can read it without parsing CSV attrs
    (run_dir / "artifacts" / f"regime_{symbol}_htf.txt").write_text(htf)
