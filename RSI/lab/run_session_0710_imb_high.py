#!/usr/bin/env python3
"""
Session block study: 07:00 UTC entry for IMBALANCED + HIGH regime.

Goal:
  - Build a simple, reproducible study in the 07:00-10:00 UTC context.
  - Place at most one trade per day at 07:00 UTC (entry at 07:00 open),
    only if the prior closed 1h bar (06:00) is IMBALANCED + HIGH.
  - Use fixed risk model from band width:
      risk = 0.5 * half_band
      SL = 1R
      TP = 4R
  - Direction can be:
      contrarian6: opposite of last 6 bars open->close bias
      random:      random long/short with fixed RNG seed

Outputs follow lab run conventions and are directly consumable by lab/app.py.
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from ta.volatility import BollingerBands

LAB_ROOT = Path(__file__).resolve().parent
REPO_ROOT = LAB_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from lab.base.strategy import StrategyConfig
from lab.core.db import load_merged_5m
from lab.core.regime import VOL_HIGH, classify_regimes
from lab.core.resample import resample_ohlcv
from lab.output.run_writer import RunWriter
from lab.schemas.types import RunManifest, TradeRecord
from lab.sim.entry import tp_price_from_r
from lab.sim.exit import replay_trade_5m

DEFAULT_DB = str(REPO_ROOT.parent / "backtester" / "data" / "backtest.sqlite")
DEFAULT_RUNS = str(REPO_ROOT / "runs")


@dataclass
class SessionStudyParams:
    bb_period: int = 48
    bb_std: float = 2.0
    atr_period: int = 14
    atr_ma_period: int = 50
    er_period: int = 20
    er_threshold: float = 0.35
    htf: str = "1h"
    entry_hour_utc: int = 7
    sl_band_mult: float = 0.5
    tp_r: float = 4.0
    direction_mode: str = "contrarian6"  # contrarian6 | random
    random_seed: int = 7


def _direction_contrarian6(dfh: pd.DataFrame, signal_idx: int) -> tuple[int | None, str]:
    """
    Opposite of last 6 bars' open->close bias at signal bar.
    Returns (side, label): side +1 long / -1 short / None when neutral.
    """
    start = signal_idx - 5
    if start < 0:
        return None, "insufficient_history"
    w = dfh.iloc[start : signal_idx + 1]
    deltas = (w["close"] - w["open"]).values.astype(float)
    bias = np.sign(deltas).sum()
    if bias > 0:
        return -1, "last6_up_bias->short"
    if bias < 0:
        return 1, "last6_down_bias->long"
    return None, "last6_neutral_skip"


def _run_one_mode(cfg: StrategyConfig, p: SessionStudyParams, runs_dir: Path) -> Path:
    strategy_id = f"session_0710_imb_high_{p.direction_mode}"
    writer = RunWriter(runs_dir)
    run_dir, run_id = writer.create_run_dir(strategy_id)

    rng = np.random.default_rng(p.random_seed)
    start_utc = pd.Timestamp(cfg.start_utc, tz="UTC")
    end_utc = pd.Timestamp(cfg.end_utc, tz="UTC") if cfg.end_utc else None

    all_trades: list[TradeRecord] = []

    for symbol in cfg.symbols:
        df5 = load_merged_5m(cfg.db_path, symbol)
        if len(df5) == 0:
            continue
        df5 = df5.loc[df5.index >= start_utc]
        if end_utc is not None:
            df5 = df5.loc[df5.index < end_utc]
        if len(df5) < 400:
            continue

        dfh = resample_ohlcv(df5, p.htf).copy()
        bb = BollingerBands(
            close=dfh["close"],
            window=p.bb_period,
            window_dev=p.bb_std,
            fillna=False,
        )
        dfh["bb_upper"] = bb.bollinger_hband()
        dfh["bb_lower"] = bb.bollinger_lband()
        dfh["bb_mid"] = bb.bollinger_mavg()
        dfh = classify_regimes(
            dfh,
            atr_period=p.atr_period,
            atr_ma_period=p.atr_ma_period,
            er_period=p.er_period,
            er_balanced_threshold=p.er_threshold,
        )

        # Signal at 06:00 bar close -> enter 07:00 open.
        # If entry_hour_utc is 7, signal hour is 6.
        signal_hour = (p.entry_hour_utc - 1) % 24
        min_idx = max(p.bb_period, p.atr_period + p.atr_ma_period, p.er_period) + 2

        for i in range(min_idx, len(dfh) - 1):
            signal_bar = dfh.iloc[i]
            entry_bar = dfh.iloc[i + 1]
            entry_ts = dfh.index[i + 1]

            if entry_ts.hour != p.entry_hour_utc:
                continue
            if dfh.index[i].hour != signal_hour:
                continue
            if pd.isna(signal_bar.get("structure")) or pd.isna(signal_bar.get("vol")):
                continue
            if signal_bar["structure"] != "IMBALANCED" or signal_bar["vol"] != VOL_HIGH:
                continue
            if pd.isna(entry_bar.get("open")):
                continue
            if pd.isna(signal_bar.get("bb_upper")) or pd.isna(signal_bar.get("bb_lower")):
                continue

            entry_price = float(entry_bar["open"])
            half_band = abs(float(signal_bar["bb_upper"]) - float(signal_bar["bb_lower"])) / 2.0
            risk = half_band * p.sl_band_mult
            if not np.isfinite(risk) or risk <= 0:
                continue

            if p.direction_mode == "random":
                side = int(rng.choice([1, -1]))
                side_label = "random"
            else:
                side, side_label = _direction_contrarian6(dfh, i)
                if side is None:
                    continue

            stop = entry_price - risk if side == 1 else entry_price + risk
            tp = tp_price_from_r(entry_price, risk, side, p.tp_r)

            rr = replay_trade_5m(
                df5,
                entry_ts,
                side,
                entry_price,
                stop,
                tp,
                risk,
                cfg.fee_bps,
                be_trigger_r=None,
                be_offset_r=0.0,
                skip_entry_bucket_hours=0.0,
            )
            if rr is None:
                continue

            all_trades.append(
                TradeRecord(
                    symbol=symbol,
                    strategy_id=strategy_id,
                    tp_r=p.tp_r,
                    entry_ts_utc=str(entry_ts),
                    exit_ts_utc=str(rr.exit_ts),
                    side=side,
                    entry_price=entry_price,
                    stop_init=stop,
                    risk=risk,
                    tp_price=tp,
                    fee_bps=cfg.fee_bps,
                    baseline_r=round(rr.pnl_r, 8),
                    managed_r=round(rr.pnl_r, 8),
                    managed_reason=rr.reason,
                    hold_5m_bars=rr.bars,
                    stages=[],
                    signal_meta={
                        "direction_mode": p.direction_mode,
                        "direction_rule": side_label,
                        "entry_hour_utc": p.entry_hour_utc,
                        "signal_hour_utc": signal_hour,
                        "structure": signal_bar.get("structure", ""),
                        "vol": signal_bar.get("vol", ""),
                        "regime": signal_bar.get("regime", ""),
                        "atr_ratio": float(signal_bar.get("atr_ratio", np.nan)),
                        "er": float(signal_bar.get("er", np.nan)),
                        "bb_period": p.bb_period,
                        "bb_std": p.bb_std,
                        "sl_band_mult": p.sl_band_mult,
                        "tp_r": p.tp_r,
                    },
                )
            )

    if all_trades:
        writer.write_trades(run_dir, strategy_id, p.tp_r, all_trades)
        writer.write_chunk_results(run_dir, strategy_id, p.tp_r, all_trades)

        # Extra study artifact for "time block" analysis.
        df = pd.DataFrame([t.to_row() for t in all_trades])
        df["entry_ts"] = pd.to_datetime(df["entry_ts_utc"], utc=True)
        hourly = (
            df.groupby(df["entry_ts"].dt.hour)
            .apply(
                lambda g: pd.Series(
                    {
                        "n_trades": len(g),
                        "win_pct": round(float((g["managed_r"] > 0).mean() * 100), 2),
                        "total_r": round(float(g["managed_r"].sum()), 4),
                        "avg_r": round(float(g["managed_r"].mean()), 4),
                    }
                ),
                include_groups=False,
            )
            .reset_index(names=["entry_hour_utc"])
        )
        hourly.to_csv(run_dir / "artifacts" / f"{strategy_id}_hourly.csv", index=False)

    manifest = RunManifest(
        run_id=run_id,
        strategy_id=strategy_id,
        strategy_version="1.0",
        db_path=cfg.db_path,
        symbols=cfg.symbols,
        start_utc=cfg.start_utc,
        end_utc=cfg.end_utc or "(auto latest)",
        fee_bps=cfg.fee_bps,
        params={
            "study_window_utc": "07:00-10:00",
            "trade_entry_hour_utc": p.entry_hour_utc,
            "trigger_regime": "IMBALANCED_HIGH",
            "bb_period": p.bb_period,
            "bb_std": p.bb_std,
            "atr_period": p.atr_period,
            "atr_ma_period": p.atr_ma_period,
            "er_period": p.er_period,
            "er_threshold": p.er_threshold,
            "sl_band_mult": p.sl_band_mult,
            "tp_r": p.tp_r,
            "direction_mode": p.direction_mode,
            "random_seed": p.random_seed,
        },
        created_at=datetime.now(timezone.utc).isoformat(),
        tp_sweep=[p.tp_r],
    )
    writer.write_manifest(run_dir, manifest)
    return run_dir


def main() -> None:
    ap = argparse.ArgumentParser(description="07:00 UTC IMBALANCED+HIGH session study")
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--runs-dir", default=DEFAULT_RUNS)
    ap.add_argument("--symbols", nargs="+", default=["XRPUSDT"])
    ap.add_argument("--start", default="2022-01-01")
    ap.add_argument("--end", default=None)
    ap.add_argument("--fee-bps", type=float, default=3.0)
    ap.add_argument("--bb-period", type=int, default=48)
    ap.add_argument("--bb-std", type=float, default=2.0)
    ap.add_argument("--atr-period", type=int, default=14)
    ap.add_argument("--atr-ma-period", type=int, default=50)
    ap.add_argument("--er-period", type=int, default=20)
    ap.add_argument("--er-threshold", type=float, default=0.35)
    ap.add_argument("--entry-hour-utc", type=int, default=7)
    ap.add_argument("--sl-band-mult", type=float, default=0.5)
    ap.add_argument("--tp-r", type=float, default=4.0)
    ap.add_argument(
        "--direction-mode",
        choices=["contrarian6", "random", "both"],
        default="contrarian6",
    )
    ap.add_argument("--random-seed", type=int, default=7)
    args = ap.parse_args()

    cfg = StrategyConfig(
        db_path=args.db,
        symbols=args.symbols,
        start_utc=args.start,
        end_utc=args.end,
        fee_bps=args.fee_bps,
    )

    modes = ["contrarian6", "random"] if args.direction_mode == "both" else [args.direction_mode]
    print("Session Study — 07:00 UTC IMBALANCED+HIGH")
    print(f"  Symbols: {args.symbols}")
    print(f"  Window:  {args.start} -> {args.end or 'latest'}")
    print(f"  Entry:   {args.entry_hour_utc:02d}:00 UTC (signal from prior hour close)")
    print(f"  Risk:    SL={args.sl_band_mult} * half-band, TP={args.tp_r}R")
    print(f"  Modes:   {modes}")

    for mode in modes:
        p = SessionStudyParams(
            bb_period=args.bb_period,
            bb_std=args.bb_std,
            atr_period=args.atr_period,
            atr_ma_period=args.atr_ma_period,
            er_period=args.er_period,
            er_threshold=args.er_threshold,
            entry_hour_utc=args.entry_hour_utc,
            sl_band_mult=args.sl_band_mult,
            tp_r=args.tp_r,
            direction_mode=mode,
            random_seed=args.random_seed,
        )
        run_dir = _run_one_mode(cfg, p, Path(args.runs_dir))
        print(f"  [{mode}] run folder: {run_dir}")

    print("Launch dashboard: streamlit run lab/app.py")


if __name__ == "__main__":
    main()

