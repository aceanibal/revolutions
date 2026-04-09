#!/usr/bin/env python3
"""
Run orchestrator for V2 MFE3/LOCK3 flow.

Creates a timestamped run folder under RSI/runs/, executes the v2 runner,
copies artifacts, and exports detailed per-trade rows (without candle data).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
SIM_DIR = PROJECT_ROOT / "simulation"
if str(SIM_DIR) not in sys.path:
    sys.path.insert(0, str(SIM_DIR))
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from massive_chunk_backtest_5m_v2_mfe3 import (  # noqa: E402
    build_4h_rsi,
    load_merged_5m,
    parse_float_grid,
)
from ltf_trade_management_study import (  # noqa: E402
    replay_trade_5m,
    replay_trade_mfe_ladder_5m,
    tp_price_from_r,
)
from multi_asset_4h_rsi_sim import DB_PATH, run_simulation_trades  # noqa: E402


def _tp_tag(tp_r: float) -> str:
    return f"tp{str(tp_r).replace('.', 'p')}"


def _copy_if_exists(src: Path, dst: Path) -> bool:
    if src.exists():
        shutil.copy2(src, dst)
        return True
    return False


def export_trade_details(
    *,
    db_path: str,
    symbols: list[str],
    start_utc: pd.Timestamp,
    end_utc: pd.Timestamp,
    rsi_l: int,
    rsi_h: int,
    sl_n: int,
    entry_tp_r: float,
    fee_bps: float,
    tp_levels: list[float],
    stages: list[tuple[float, float]],
    out_dir: Path,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    combined_rows: list[dict] = []
    for tp_r in tp_levels:
        tp_rows: list[dict] = []
        for sym in symbols:
            df5 = load_merged_5m(db_path, sym)
            if len(df5) == 0:
                continue
            df5 = df5.loc[(df5.index >= start_utc) & (df5.index < end_utc)].copy()
            if len(df5) == 0:
                continue
            df4h = build_4h_rsi(df5)
            if len(df4h) < sl_n + 5:
                continue

            o = df4h["open"].values
            h = df4h["high"].values
            low = df4h["low"].values
            rsi = df4h["RSI"].values
            idx = df4h.index
            trades = run_simulation_trades(o, h, low, rsi, rsi_l, rsi_h, sl_n, entry_tp_r, fee_bps)

            for t in trades:
                entry_ts = idx[t["entry_idx"]]
                tp_px = tp_price_from_r(t["entry_price"], t["risk"], t["side"], tp_r)
                base = replay_trade_5m(
                    df5,
                    entry_ts,
                    t["side"],
                    t["entry_price"],
                    t["stop_loss"],
                    tp_px,
                    t["risk"],
                    fee_bps,
                    be_trigger_r=None,
                    be_offset_r=0.0,
                )
                mfe = replay_trade_mfe_ladder_5m(
                    df5,
                    entry_ts,
                    t["side"],
                    t["entry_price"],
                    t["stop_loss"],
                    tp_px,
                    t["risk"],
                    fee_bps,
                    stages=stages,
                    cap_lock_by_mfe=True,
                )
                if mfe is None or base is None:
                    continue
                ex = pd.Timestamp(mfe.exit_ts).tz_convert("UTC")
                if ex < start_utc or ex >= end_utc:
                    continue

                row = {
                    "symbol": sym,
                    "tp_r": tp_r,
                    "entry_ts_utc": entry_ts.isoformat(),
                    "exit_ts_utc": ex.isoformat(),
                    "entry_idx_4h": int(t["entry_idx"]),
                    "side": int(t["side"]),
                    "entry_price": float(t["entry_price"]),
                    "stop_init": float(t["stop_loss"]),
                    "risk": float(t["risk"]),
                    "tp_price": float(tp_px),
                    "mfe1": float(stages[0][0]),
                    "lock1": float(stages[0][1]),
                    "mfe2": float(stages[1][0]),
                    "lock2": float(stages[1][1]),
                    "mfe3": float(stages[2][0]),
                    "lock3": float(stages[2][1]),
                    "rsi_l": int(rsi_l),
                    "rsi_h": int(rsi_h),
                    "sl_n": int(sl_n),
                    "entry_tp_r": float(entry_tp_r),
                    "fee_bps": float(fee_bps),
                    "baseline_r": float(base.pnl_r),
                    "managed_r": float(mfe.pnl_r),
                    "managed_reason": str(mfe.reason),
                    "hold_5m_bars": int(mfe.bars),
                }
                tp_rows.append(row)
                combined_rows.append(row)
        tp_df = pd.DataFrame(tp_rows).sort_values(["symbol", "entry_ts_utc"])
        tp_df.to_csv(out_dir / f"trade_details_v2_mfe3_{_tp_tag(tp_r)}.csv", index=False)

    combined_df = pd.DataFrame(combined_rows).sort_values(["tp_r", "symbol", "entry_ts_utc"])
    combined_df.to_csv(out_dir / "trade_details_v2_mfe3_all_tp.csv", index=False)


def main() -> None:
    ap = argparse.ArgumentParser(description="Run v2 MFE3 sequence and package all artifacts.")
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--symbols", default="BTCUSDT,ETHUSDT,XRPUSDT,SOLUSDT,LINKUSDT")
    ap.add_argument("--start-utc", default="2022-01-01")
    ap.add_argument("--end-utc", default="")
    ap.add_argument("--chunk", choices=("monthly", "quarterly"), default="monthly")
    ap.add_argument("--rsi-l", type=int, default=35)
    ap.add_argument("--rsi-h", type=int, default=60)
    ap.add_argument("--sl-n", type=int, default=2)
    ap.add_argument("--entry-tp-r", type=float, default=5.0)
    ap.add_argument("--fee-bps", type=float, default=3.0)
    ap.add_argument("--tp-sweep", default="12,13,14")
    ap.add_argument("--mfe1", type=float, default=1.0)
    ap.add_argument("--lock1", type=float, default=0.8)
    ap.add_argument("--mfe2", type=float, default=6.5)
    ap.add_argument("--lock2", type=float, default=5.5)
    ap.add_argument("--mfe3", type=float, default=10.0)
    ap.add_argument("--lock3", type=float, default=9.0)
    args = ap.parse_args()

    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    tp_levels = parse_float_grid(args.tp_sweep)
    stages = sorted([(args.mfe1, args.lock1), (args.mfe2, args.lock2), (args.mfe3, args.lock3)], key=lambda x: x[0])

    now = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    run_id = f"run_v2_mfe3_{now}"
    run_dir = PROJECT_ROOT / "runs" / run_id
    artifacts_dir = run_dir / "artifacts"
    trades_dir = run_dir / "trades"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    trades_dir.mkdir(parents=True, exist_ok=True)

    config = {
        "run_id": run_id,
        "db": str(Path(args.db).resolve()),
        "symbols": symbols,
        "start_utc": args.start_utc,
        "end_utc": args.end_utc or "(auto latest)",
        "chunk": args.chunk,
        "rsi_l": args.rsi_l,
        "rsi_h": args.rsi_h,
        "sl_n": args.sl_n,
        "entry_tp_r": args.entry_tp_r,
        "fee_bps": args.fee_bps,
        "tp_sweep": tp_levels,
        "stages": stages,
        "script": "scripts/massive_chunk_backtest_5m_v2_mfe3.py",
    }
    (run_dir / "run_config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")

    cmd = [
        str(PROJECT_ROOT / ".venv" / "bin" / "python"),
        str(SCRIPT_DIR / "massive_chunk_backtest_5m_v2_mfe3.py"),
        "--db",
        args.db,
        "--symbols",
        ",".join(symbols),
        "--start-utc",
        args.start_utc,
        "--chunk",
        args.chunk,
        "--rsi-l",
        str(args.rsi_l),
        "--rsi-h",
        str(args.rsi_h),
        "--sl-n",
        str(args.sl_n),
        "--entry-tp-r",
        str(args.entry_tp_r),
        "--fee-bps",
        str(args.fee_bps),
        "--tp-sweep",
        args.tp_sweep,
        "--mfe1",
        str(args.mfe1),
        "--lock1",
        str(args.lock1),
        "--mfe2",
        str(args.mfe2),
        "--lock2",
        str(args.lock2),
        "--mfe3",
        str(args.mfe3),
        "--lock3",
        str(args.lock3),
        "--write-ledgers",
        "--no-also-quarterly",
    ]
    if args.end_utc:
        cmd.extend(["--end-utc", args.end_utc])

    print(f"Running: {' '.join(cmd)}")
    subprocess.run(cmd, check=True, cwd=str(PROJECT_ROOT))

    # Copy runner artifacts
    cache = PROJECT_ROOT / "cache"
    _copy_if_exists(cache / "massive_chunk_v2_mfe3_preflight.csv", artifacts_dir / "massive_chunk_v2_mfe3_preflight.csv")
    _copy_if_exists(
        cache / "massive_chunk_v2_mfe3_tp_sweep_summary.csv",
        artifacts_dir / "massive_chunk_v2_mfe3_tp_sweep_summary.csv",
    )
    for tp_r in tp_levels:
        tag = _tp_tag(tp_r)
        for name in [
            f"massive_chunk_v2_mfe3_{tag}_results.csv",
            f"massive_chunk_v2_mfe3_{tag}_results_by_asset.csv",
        ]:
            _copy_if_exists(cache / name, artifacts_dir / name)
        for sym in symbols:
            led = f"massive_chunk_v2_mfe3_{tag}_ledger_{sym}.csv"
            _copy_if_exists(cache / led, artifacts_dir / led)
        rep = PROJECT_ROOT / f"FINAL_MASSIVE_CHUNK_BACKTEST_V2_MFE3_{tag}.md"
        _copy_if_exists(rep, artifacts_dir / rep.name)

    start_ts = pd.Timestamp(args.start_utc, tz="UTC")
    if args.end_utc:
        end_ts = pd.Timestamp(args.end_utc, tz="UTC")
    else:
        end_ts = pd.Timestamp.max.tz_localize("UTC")
    export_trade_details(
        db_path=os.path.abspath(args.db),
        symbols=symbols,
        start_utc=start_ts,
        end_utc=end_ts,
        rsi_l=args.rsi_l,
        rsi_h=args.rsi_h,
        sl_n=args.sl_n,
        entry_tp_r=args.entry_tp_r,
        fee_bps=args.fee_bps,
        tp_levels=tp_levels,
        stages=stages,
        out_dir=trades_dir,
    )

    manifest = sorted(
        [str(p.relative_to(run_dir)) for p in run_dir.rglob("*") if p.is_file()]
    )
    (run_dir / "manifest_files.txt").write_text("\n".join(manifest) + "\n", encoding="utf-8")
    print(f"Run package ready: {run_dir}")


if __name__ == "__main__":
    main()
