#!/usr/bin/env python3
"""
FVG + Entry-Only Short Study
============================

Clone of the original FVG momentum study, but without momentum/regime filters.

Signal model (entry-only):
  - For each eligible 1h bar i, enter short at bar i+1 open.
  - No structure/vol/body/close filters are applied.
  - FVG tag still uses bearish condition: high[i] < low[i-2].

Stop modes on FVG-tagged trades:
  - STANDARD : stop = entry + ATR * atr_mult
  - FVG-ONE  : initial standard stop from entry, one-time tighten at gate:
               stop = min(standard_stop, fvg_low + ATR * fvg_buf_mult)
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

LAB_ROOT = Path(__file__).resolve().parent
REPO_ROOT = LAB_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from lab.study_fvg_momentum import (
    DEFAULT_DB,
    SYMS,
    _hdr,
    _row,
    _stats,
    _stats_from_results,
    prepare_sym,
    replay_fvg_stop,
    replay_standard,
)


def collect_signals_entry_only(df1h: pd.DataFrame, sym: str) -> list[dict]:
    """
    Entry-only signal collector:
      - no momentum filters
      - no regime filters
      - requires ATR and next-bar open
    """
    hi_arr = df1h["high"].values
    lo_arr = df1h["low"].values
    n = len(df1h)
    sigs: list[dict] = []

    for i in range(2, n - 1):
        row = df1h.iloc[i]
        entry_bar = df1h.iloc[i + 1]
        if pd.isna(row.get("atr")) or pd.isna(entry_bar.get("open")):
            continue

        entry_p = float(entry_bar["open"])
        atr_val = float(row["atr"])

        has_fvg = False
        fvg_low = np.nan
        fvg_high = np.nan
        gap_bps = 0.0

        # Bearish FVG at signal bar i
        if hi_arr[i] < lo_arr[i - 2]:
            fvg_low_v = float(hi_arr[i])
            fvg_high_v = float(lo_arr[i - 2])
            if fvg_low_v > entry_p:
                has_fvg = True
                fvg_low = fvg_low_v
                fvg_high = fvg_high_v
                gap_bps = (fvg_high_v - fvg_low_v) / fvg_low_v * 10_000

        sigs.append(
            {
                "ts": df1h.index[i + 1],
                "year": df1h.index[i + 1].year,
                "sym": sym,
                "entry_p": entry_p,
                "atr": atr_val,
                "has_fvg": has_fvg,
                "fvg_low": fvg_low,
                "fvg_high": fvg_high,
                "gap_bps": round(gap_bps, 1),
            }
        )

    return sigs


def main(
    db_path: str,
    symbols: list[str] | None = None,
    start: str = "2024-01-01",
    atr_mult: float = 2.0,
    tp_sweep: list[float] | None = None,
    fvg_buf_mult: float = 0.15,
    decision_delay_hours: float = 1.0,
) -> None:
    if symbols is None:
        symbols = SYMS
    if tp_sweep is None:
        tp_sweep = [1.0, 2.0, 3.0, 4.0]

    all_sigs: list[dict] = []
    sym_df5: dict[str, pd.DataFrame] = {}

    print(f"\nLoading {len(symbols)} symbols...")
    for sym in symbols:
        df5, df1h = prepare_sym(db_path, sym, start)
        sym_df5[sym] = df5
        sigs = collect_signals_entry_only(df1h, sym)
        n_fvg = sum(1 for s in sigs if s["has_fvg"])
        print(
            f"  {sym:<12}  {len(sigs):>5} signals  |  "
            f"{n_fvg:>5} FVG-tagged ({n_fvg/max(len(sigs),1)*100:.1f}%)"
        )
        all_sigs.extend(sigs)

    sigs_fvg = [s for s in all_sigs if s["has_fvg"]]
    print(f"\n  TOTAL {len(all_sigs)} signals  |  {len(sigs_fvg)} FVG-tagged")

    _hdr(
        f"A — Entry-only quality snapshot | STANDARD stop | start={start}",
        ["subset", "n", "win%", "avg_R", "total_R", "maxDD", "DD/n"],
    )
    for label, subset in [("ALL", all_sigs), ("FVG only", sigs_fvg)]:
        pnls = []
        for s in subset:
            res = replay_standard(s, sym_df5[s["sym"]], atr_mult, 1.0)
            if res:
                pnls.append(res.pnl_r)
        st = _stats(pnls)
        _row(
            [
                label,
                st["n"],
                f"{st['win_pct']}%",
                f"{st['avg_r']:.4f}",
                f"{st['total_r']:.1f}",
                f"{st['max_dd']:.1f}",
                f"{st['dd_per_trade']:.3f}",
            ]
        )

    _hdr(
        f"B — Entry-only stop mode sweep | gate=+{decision_delay_hours}h",
        ["mode", "TP", "n", "win%", "SL_hits", "SL_%", "avg_R", "total_R", "maxDD"],
    )

    rows = []
    for tp_r in tp_sweep:
        res_std, res_one = [], []
        for s in sigs_fvg:
            df5 = sym_df5[s["sym"]]

            r_std = replay_standard(s, df5, atr_mult, tp_r)
            if r_std:
                res_std.append(r_std)

            r_one = replay_fvg_stop(
                s,
                df5,
                atr_mult,
                tp_r,
                decision_delay_hours=decision_delay_hours,
                fvg_buf_mult=fvg_buf_mult,
            )
            if r_one:
                res_one.append(r_one)

        for mode, res_list in [("STANDARD", res_std), ("FVG-ONE", res_one)]:
            st = _stats_from_results(res_list)
            _row(
                [
                    mode,
                    f"{tp_r}R",
                    st["n"],
                    f"{st['win_pct']}%",
                    st["sl_hits"],
                    f"{st['sl_hit_pct']}%",
                    f"{st['avg_r']:.4f}",
                    f"{st['total_r']:.1f}",
                    f"{st['max_dd']:.1f}",
                ]
            )
            rows.append(
                {
                    "mode": mode,
                    "tp": tp_r,
                    "subset": "fvg_only",
                    "start": start,
                    "n_signals_all": len(all_sigs),
                    "n_signals_fvg": len(sigs_fvg),
                    **st,
                }
            )
        print()

    out = REPO_ROOT / "cache" / "fvg_entry_only_study.csv"
    out.parent.mkdir(exist_ok=True)
    pd.DataFrame(rows).to_csv(out, index=False)
    print(f"Saved -> {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--symbols", nargs="+", default=SYMS)
    ap.add_argument("--start", default="2024-01-01")
    ap.add_argument("--atr-mult", type=float, default=2.0)
    ap.add_argument("--tp-sweep", nargs="+", type=float, default=[1.0, 2.0, 3.0, 4.0])
    ap.add_argument("--fvg-buf", type=float, default=0.15)
    ap.add_argument("--decision-delay-hours", type=float, default=1.0)
    args = ap.parse_args()

    print("=" * 72)
    print("FVG Entry-Only Study")
    print("=" * 72)
    main(
        db_path=args.db,
        symbols=args.symbols,
        start=args.start,
        atr_mult=args.atr_mult,
        tp_sweep=args.tp_sweep,
        fvg_buf_mult=args.fvg_buf,
        decision_delay_hours=args.decision_delay_hours,
    )
