#!/usr/bin/env python3
"""
FVG + Momentum Short Study (Trailing FVG Stops)
===============================================

Clone of the momentum/FVG study with a new stop system:
after entry, every newly formed bearish FVG can tighten stop again.

Modes compared on FVG-tagged signals:
  1) STANDARD   : stop = entry + ATR*atr_mult (from entry, fixed)
  2) FVG-ONE    : one-time FVG stop update (existing logic)
  3) FVG-TRAIL  : stop updates after each new bearish FVG forms

All modes keep initial-R accounting:
  - TP is computed once from initial risk at entry and never moved.
"""
from __future__ import annotations

import argparse
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
    _hdr,
    _row,
    _stats_from_results,
    collect_signals,
    prepare_sym,
    replay_fvg_stop,
    replay_standard,
)


def replay_fvg_trailing_stop(
    sig: dict,
    df5: pd.DataFrame,
    df1h: pd.DataFrame,
    atr_mult: float,
    tp_r: float,
    *,
    fvg_buf_mult: float = 0.15,
    decision_delay_hours: float = 1.0,
    fee_bps: float = 3.0,
):
    """
    Two-phase trailing FVG stop for short trades.

    - Initial stop/TP are active from entry.
    - After decision_delay_hours, each newly formed bearish FVG can tighten stop.
    - Stop is monotonic for shorts: only moves downward (never loosens).
    """
    from lab.sim.entry import tp_price_from_r
    from lab.sim.exit import ReplayResult

    if not sig.get("has_fvg"):
        return None

    entry_ts = pd.Timestamp(sig["ts"])
    entry_p = float(sig["entry_p"])
    atr_entry = float(sig["atr"])

    stop_init = entry_p + atr_entry * atr_mult
    risk_init = stop_init - entry_p
    if risk_init <= 0:
        return None
    tp_p = tp_price_from_r(entry_p, risk_init, -1, tp_r)

    sig_idx = sig.get("sig_idx")
    if sig_idx is None:
        return None

    # Build stop-update schedule from future 1h bars that form bearish FVGs.
    # IMPORTANT: updates must activate at bar CLOSE (next hour timestamp),
    # not at bar OPEN, to avoid lookahead.
    gate_ts = entry_ts + pd.Timedelta(hours=decision_delay_hours)
    hi = df1h["high"].values
    lo = df1h["low"].values
    atr = df1h["atr"].values

    updates: list[tuple[pd.Timestamp, float]] = []

    # Keep parity with one-time FVG mode: include initial signal FVG update
    # at the decision gate.
    stop_init_fvg = float(sig["fvg_low"]) + atr_entry * fvg_buf_mult
    updates.append((gate_ts, stop_init_fvg))
    for j in range(int(sig_idx) + 1, len(df1h)):
        if j < 2:
            continue
        if hi[j] < lo[j - 2]:
            if pd.isna(atr[j]):
                continue
            stop_candidate = float(hi[j]) + float(atr[j]) * fvg_buf_mult
            # 1h bar at index j closes one hour later.
            update_ts = max(pd.Timestamp(df1h.index[j]) + pd.Timedelta(hours=1), gate_ts)
            updates.append((update_ts, stop_candidate))

    if len(df5) == 0:
        return None
    d = df5.loc[df5.index >= entry_ts]
    if len(d) == 0:
        return None

    fee_r = (entry_p * (fee_bps / 10_000.0)) / risk_init
    stop_live = stop_init
    u = 0
    updates.sort(key=lambda x: x[0])

    for i, (ts, row) in enumerate(d.iterrows()):
        while u < len(updates) and ts >= updates[u][0]:
            # For short: lower stop is tighter. Never loosen.
            stop_live = min(stop_live, updates[u][1])
            u += 1

        h = float(row["high"])
        lo5 = float(row["low"])
        if h >= stop_live:
            return ReplayResult((entry_p - stop_live) / risk_init - fee_r, "SL", ts, i + 1)
        if lo5 <= tp_p:
            return ReplayResult((entry_p - tp_p) / risk_init - fee_r, "TP", ts, i + 1)

    return None


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
    sym_df1h: dict[str, pd.DataFrame] = {}

    print(f"\nLoading {len(symbols)} symbols...")
    for sym in symbols:
        df5, df1h = prepare_sym(db_path, sym, start)
        sym_df5[sym] = df5
        sym_df1h[sym] = df1h
        sigs = collect_signals(df1h, sym)

        # Keep signal index to discover future FVG events during each trade.
        entry_to_sig_i = {df1h.index[i + 1]: i for i in range(62, len(df1h) - 1)}
        for s in sigs:
            s["sig_idx"] = entry_to_sig_i.get(s["ts"])

        n_fvg = sum(1 for s in sigs if s["has_fvg"])
        print(f"  {sym:<12}  {len(sigs):>3} signals  |  "
              f"{n_fvg:>3} FVG-tagged ({n_fvg/max(len(sigs),1)*100:.0f}%)")
        all_sigs.extend(sigs)

    sigs_fvg = [s for s in all_sigs if s["has_fvg"]]
    print(f"\n  TOTAL {len(all_sigs)} signals  |  {len(sigs_fvg)} FVG-tagged")

    _hdr(
        f"Trailing FVG Stop Comparison  |  start={start}  |  gate=+{decision_delay_hours}h",
        ["mode", "TP", "n", "win%", "SL_hits", "SL_%", "avg_R", "total_R", "maxDD"],
    )

    rows = []
    for tp_r in tp_sweep:
        res_std, res_one, res_trail = [], [], []
        for s in sigs_fvg:
            sym = s["sym"]
            df5 = sym_df5[sym]
            df1h = sym_df1h[sym]

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

            r_trail = replay_fvg_trailing_stop(
                s,
                df5,
                df1h,
                atr_mult,
                tp_r,
                decision_delay_hours=decision_delay_hours,
                fvg_buf_mult=fvg_buf_mult,
            )
            if r_trail:
                res_trail.append(r_trail)

        for mode, result_list in [
            ("STANDARD", res_std),
            ("FVG-ONE", res_one),
            ("FVG-TRAIL", res_trail),
        ]:
            st = _stats_from_results(result_list)
            _row([mode, f"{tp_r}R", st["n"], f"{st['win_pct']}%",
                  st["sl_hits"], f"{st['sl_hit_pct']}%",
                  f"{st['avg_r']:.4f}", f"{st['total_r']:.1f}", f"{st['max_dd']:.1f}"])
            rows.append({
                "mode": mode,
                "tp": tp_r,
                **st,
                "start": start,
                "decision_delay_hours": decision_delay_hours,
            })
        print()

    out = REPO_ROOT / "cache" / "fvg_momentum_trailing_study.csv"
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
    print("FVG Momentum Trailing Study")
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
