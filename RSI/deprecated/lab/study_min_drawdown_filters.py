#!/usr/bin/env python3
"""
Min Drawdown Filter Study
=========================

Purpose:
  Sweep momentum filter thresholds and find configurations that minimize drawdown.

Uses existing momentum/FVG signal model and replay engine:
  - Signal bar i -> enter short at i+1 open
  - Optional FVG-only subset
  - Mode: STANDARD or FVG-ONE

Outputs:
  - Console ranking (lowest maxDD first)
  - CSV with all tested parameter combinations
"""
from __future__ import annotations

import argparse
import itertools
import sys
from pathlib import Path

import pandas as pd

LAB_ROOT = Path(__file__).resolve().parent
REPO_ROOT = LAB_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from lab.study_fvg_momentum import (
    DEFAULT_DB,
    SYMS,
    _stats,
    collect_signals,
    prepare_sym,
    replay_fvg_stop,
    replay_standard,
)


def _parse_float_list(v: str) -> list[float]:
    return [float(x.strip()) for x in v.split(",") if x.strip()]


def run_study(
    db_path: str,
    symbols: list[str],
    start: str,
    tp_r: float,
    atr_mult: float,
    fvg_buf_mult: float,
    decision_delay_hours: float,
    subset: str,
    mode: str,
    vol_ratio_grid: list[float],
    body_pct_grid: list[float],
    close_pct_grid: list[float],
) -> pd.DataFrame:
    sym_df5: dict[str, pd.DataFrame] = {}
    sym_df1h: dict[str, pd.DataFrame] = {}

    print(f"\nLoading {len(symbols)} symbols...")
    for sym in symbols:
        df5, df1h = prepare_sym(db_path, sym, start)
        sym_df5[sym] = df5
        sym_df1h[sym] = df1h
        print(f"  {sym:<10}  5m={len(df5):>7}  1h={len(df1h):>6}")

    rows: list[dict] = []
    grid = list(itertools.product(vol_ratio_grid, body_pct_grid, close_pct_grid))
    print(f"\nTesting {len(grid)} filter combinations...")

    for idx, (vol_ratio_min, body_pct_min, close_pct_max) in enumerate(grid, start=1):
        pnls: list[float] = []
        n_signals = 0
        n_fvg = 0

        for sym in symbols:
            sigs = collect_signals(
                sym_df1h[sym],
                sym,
                vol_ratio_min=vol_ratio_min,
                body_pct_min=body_pct_min,
                close_pct_max=close_pct_max,
            )
            n_signals += len(sigs)
            n_fvg += sum(1 for s in sigs if s["has_fvg"])

            if subset == "fvg":
                sigs = [s for s in sigs if s["has_fvg"]]

            for s in sigs:
                if mode == "standard":
                    res = replay_standard(s, sym_df5[sym], atr_mult, tp_r)
                else:
                    res = replay_fvg_stop(
                        s,
                        sym_df5[sym],
                        atr_mult,
                        tp_r,
                        decision_delay_hours=decision_delay_hours,
                        fvg_buf_mult=fvg_buf_mult,
                    )
                if res:
                    pnls.append(res.pnl_r)

        st = _stats(pnls)
        rows.append(
            {
                "mode": mode,
                "subset": subset,
                "tp_r": tp_r,
                "atr_mult": atr_mult,
                "fvg_buf_mult": fvg_buf_mult,
                "decision_delay_hours": decision_delay_hours,
                "start": start,
                "vol_ratio_min": vol_ratio_min,
                "body_pct_min": body_pct_min,
                "close_pct_max": close_pct_max,
                "n_signals": n_signals,
                "n_fvg_signals": n_fvg,
                **st,
            }
        )

        print(
            f"[{idx:>3}/{len(grid)}] vol>{vol_ratio_min:.2f} body>{body_pct_min:.2f} "
            f"close<{close_pct_max:.2f} | n={st['n']:>4} totalR={st['total_r']:>7.1f} "
            f"maxDD={st['max_dd']:>6.1f}"
        )

    out_df = pd.DataFrame(rows)
    # Rank: lowest drawdown first, then higher total R, then more trades.
    out_df = out_df.sort_values(
        by=["max_dd", "total_r", "n"],
        ascending=[True, False, False],
    ).reset_index(drop=True)
    return out_df


def main() -> None:
    ap = argparse.ArgumentParser(description="Filter sweep to minimize drawdown")
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--symbols", nargs="+", default=SYMS)
    ap.add_argument("--start", default="2024-01-01")
    ap.add_argument("--tp-r", type=float, default=4.0)
    ap.add_argument("--atr-mult", type=float, default=2.0)
    ap.add_argument("--fvg-buf", type=float, default=0.15)
    ap.add_argument("--decision-delay-hours", type=float, default=1.0)
    ap.add_argument("--mode", choices=["standard", "fvg_one"], default="fvg_one")
    ap.add_argument("--subset", choices=["all", "fvg"], default="fvg")
    ap.add_argument("--vol-ratio-grid", default="1.2,1.5,1.8,2.0")
    ap.add_argument("--body-pct-grid", default="0.45,0.55,0.65")
    ap.add_argument("--close-pct-grid", default="0.15,0.20,0.25")
    ap.add_argument("--top-k", type=int, default=12)
    args = ap.parse_args()

    vol_ratio_grid = _parse_float_list(args.vol_ratio_grid)
    body_pct_grid = _parse_float_list(args.body_pct_grid)
    close_pct_grid = _parse_float_list(args.close_pct_grid)

    print("=" * 72)
    print("Min Drawdown Filter Study")
    print("=" * 72)
    print(
        f"mode={args.mode} subset={args.subset} tp={args.tp_r} "
        f"start={args.start} symbols={len(args.symbols)}"
    )

    df = run_study(
        db_path=args.db,
        symbols=args.symbols,
        start=args.start,
        tp_r=args.tp_r,
        atr_mult=args.atr_mult,
        fvg_buf_mult=args.fvg_buf,
        decision_delay_hours=args.decision_delay_hours,
        subset=args.subset,
        mode=args.mode,
        vol_ratio_grid=vol_ratio_grid,
        body_pct_grid=body_pct_grid,
        close_pct_grid=close_pct_grid,
    )

    out = REPO_ROOT / "cache" / "min_drawdown_filter_sweep.csv"
    out.parent.mkdir(exist_ok=True)
    df.to_csv(out, index=False)

    print("\nTop configs (lowest maxDD):")
    print(
        df.head(args.top_k)[
            [
                "vol_ratio_min",
                "body_pct_min",
                "close_pct_max",
                "n",
                "win_pct",
                "total_r",
                "max_dd",
                "dd_per_trade",
                "mcl",
            ]
        ].to_string(index=False)
    )
    print(f"\nSaved -> {out}")


if __name__ == "__main__":
    main()
