"""
RSI 4h Strategy — reference implementation.

Signal:  4h RSI crossover (below rsi_l = long, above rsi_h = short)
Entry:   open of bar after RSI cross confirmation (Rule 1, Rule 2)
Stop:    structural — min/max of sl_n bars preceding entry (Rule 3)
Exit:    N-stage MFE lock ladder on 5m bars with deferred stop updates (Rules 6-8)

This is a direct port of the existing simulation code, cleaned up to use
lab abstractions. Logic is identical — same entries, same exits, same fees.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from lab.base.strategy import BaseStrategy, StrategyConfig
from lab.core.db import load_merged_5m
from lab.core.resample import build_4h_rsi
from lab.output.run_writer import RunWriter
from lab.schemas.types import RunManifest, TradeRecord
from lab.sim.entry import run_simulation_trades, tp_price_from_r
from lab.sim.exit import replay_trade_5m, replay_trade_mfe_ladder_5m


@dataclass
class RSI4hParams:
    """
    All tunable parameters for the RSI 4h strategy.

    rsi_l / rsi_h:       RSI thresholds for long / short entries
    rsi_window:          RSI smoothing period (Wilder)
    sl_n:                structural stop lookback in 4h bars
    entry_tp_r:          TP used by the 4h entry engine (affects stop construction only)
    tp_sweep:            list of TP multiples to test in replay
    stages:              MFE ladder (mfe_r, lock_r) — must be strictly increasing mfe_r
    skip_entry_bucket_h: hours to skip at entry before 5m management starts (Rule 6)
    """
    rsi_l: int = 35
    rsi_h: int = 60
    rsi_window: int = 20
    sl_n: int = 2
    entry_tp_r: float = 5.0
    tp_sweep: list[float] = field(default_factory=lambda: [12.0])
    stages: list[tuple[float, float]] = field(
        default_factory=lambda: [(1.0, 0.8), (6.5, 5.5)]
    )
    skip_entry_bucket_h: float = 0.0


class RSI4hStrategy(BaseStrategy):
    """
    4h RSI crossover with 5m MFE ladder exit management.

    Usage:
        from lab.strategies.rsi_4h import RSI4hStrategy, RSI4hParams
        from lab.base.strategy import StrategyConfig

        cfg = StrategyConfig(
            db_path="/path/to/backtest.sqlite",
            symbols=["BTCUSDT", "ETHUSDT"],
            start_utc="2022-01-01",
            fee_bps=3.0,
        )
        params = RSI4hParams(rsi_l=35, rsi_h=60, sl_n=2, tp_sweep=[12.0, 13.0])
        strategy = RSI4hStrategy(cfg, params)
        run_dir = strategy.run(Path("runs/"))
    """

    STRATEGY_ID = "rsi_4h"
    VERSION = "1.0"

    def __init__(self, config: StrategyConfig, params: RSI4hParams | None = None):
        super().__init__(config)
        self.params = params or RSI4hParams()

    def run(self, runs_dir: Path) -> Path:
        p = self.params
        cfg = self.config
        writer = RunWriter(runs_dir)
        run_dir, run_id = writer.create_run_dir(self.STRATEGY_ID)

        start_utc = pd.Timestamp(cfg.start_utc, tz="UTC")
        end_utc = pd.Timestamp(cfg.end_utc, tz="UTC") if cfg.end_utc else None

        all_trades_by_tp: dict[float, list[TradeRecord]] = {tp: [] for tp in p.tp_sweep}

        for symbol in cfg.symbols:
            print(f"  [{symbol}] loading...")
            df5 = load_merged_5m(cfg.db_path, symbol)
            if len(df5) == 0:
                print(f"  [{symbol}] no data — skipped")
                continue

            df5_win = df5.loc[df5.index >= start_utc]
            if end_utc is not None:
                df5_win = df5_win.loc[df5_win.index < end_utc]
            if len(df5_win) < 50:
                print(f"  [{symbol}] insufficient data in window — skipped")
                continue

            df4h = build_4h_rsi(df5_win, window=p.rsi_window)
            if len(df4h) < p.sl_n + 5:
                continue

            raw_trades = run_simulation_trades(
                df4h["open"].values,
                df4h["high"].values,
                df4h["low"].values,
                df4h["rsi"].values,
                p.rsi_l,
                p.rsi_h,
                p.sl_n,
                p.entry_tp_r,
                cfg.fee_bps,
            )
            print(f"  [{symbol}] {len(raw_trades)} entries generated")

            for tp_r in p.tp_sweep:
                n_ok = 0
                for t in raw_trades:
                    entry_ts = df4h.index[t["entry_idx"]]
                    tp_price = tp_price_from_r(t["entry_price"], t["risk"], t["side"], tp_r)

                    baseline = replay_trade_5m(
                        df5_win, entry_ts, t["side"],
                        t["entry_price"], t["stop_loss"], tp_price,
                        t["risk"], cfg.fee_bps,
                        be_trigger_r=None, be_offset_r=0.0,
                        skip_entry_bucket_hours=p.skip_entry_bucket_h,
                    )
                    if baseline is None:
                        continue

                    managed = replay_trade_mfe_ladder_5m(
                        df5_win, entry_ts, t["side"],
                        t["entry_price"], t["stop_loss"], tp_price,
                        t["risk"], cfg.fee_bps,
                        stages=p.stages,
                        skip_entry_bucket_hours=p.skip_entry_bucket_h,
                    )
                    if managed is None:
                        continue

                    all_trades_by_tp[tp_r].append(TradeRecord(
                        symbol=symbol,
                        strategy_id=self.STRATEGY_ID,
                        tp_r=tp_r,
                        entry_ts_utc=str(entry_ts),
                        exit_ts_utc=str(managed.exit_ts),
                        side=t["side"],
                        entry_price=t["entry_price"],
                        stop_init=t["stop_loss"],
                        risk=t["risk"],
                        tp_price=tp_price,
                        fee_bps=cfg.fee_bps,
                        baseline_r=round(baseline.pnl_r, 8),
                        managed_r=round(managed.pnl_r, 8),
                        managed_reason=managed.reason,
                        hold_5m_bars=managed.bars,
                        stages=p.stages,
                        signal_meta={
                            "rsi_l": p.rsi_l,
                            "rsi_h": p.rsi_h,
                            "rsi_window": p.rsi_window,
                            "sl_n": p.sl_n,
                            "entry_tp_r": p.entry_tp_r,
                            "entry_idx_4h": t["entry_idx"],
                        },
                    ))
                    n_ok += 1
                print(f"  [{symbol}] tp={tp_r}: {n_ok} trades replayed")

        # Write outputs
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
                "rsi_l": p.rsi_l,
                "rsi_h": p.rsi_h,
                "rsi_window": p.rsi_window,
                "sl_n": p.sl_n,
                "entry_tp_r": p.entry_tp_r,
                "tp_sweep": p.tp_sweep,
                "stages": p.stages,
                "skip_entry_bucket_h": p.skip_entry_bucket_h,
            },
            created_at=datetime.now(timezone.utc).isoformat(),
            tp_sweep=p.tp_sweep,
        )
        writer.write_manifest(run_dir, manifest)

        print(f"\nDone. Run: {run_dir}")
        print(f"Total trades (all TPs): {len(all_tp_trades)}")
        return run_dir
