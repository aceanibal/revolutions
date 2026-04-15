#!/usr/bin/env python3
"""
Reversal-at-TP study
====================

After the optimal short (FVG-LOW stop, TP=4.25R) hits TP, enter a LONG
reversal trade targeting the FVG level (gap fill) as take-profit.

Geometry
--------
  Short entry       = entry_p
  Short risk        = ATR × 2.0
  Short TP price    = entry_p - risk × 4.25   ← price dropped this far
  FVG zone          = [fvg_low, fvg_high]      ← gap above original entry

  Reversal entry    = short TP price           ← long from there
  Reversal TP       = fvg_low                  ← fill the gap bottom
  Implied TP dist   = fvg_low - reversal_entry ≈ 8.5 × ATR + (fvg_low − entry_p)
  Reversal SL       = reversal_entry − ATR × sl_mult   ← sweep this

  Implied R-mult at each SL: (fvg_low − reversal_entry) / (ATR × sl_mult)
    sl_mult=0.5 → ~17R   sl_mult=1.0 → ~9R
    sl_mult=2.0 → ~4.5R  sl_mult=3.0 → ~3R

Rationale: the short signal fires in a BALANCED (mean-reverting) regime.
After the momentum exhausts at the TP, the market may revert. The FVG above
is unmitigated — institutional order flow may pull price back to fill it.

Sections
--------
A. Reversal geometry overview (winning short distribution)
B. SL sweep — full grid of ATR multiples
C. Year breakdown at best SL
D. Per-symbol at best SL
E. Distribution: implied R-multiple vs actual outcome

Usage:
    python lab/study_reversal_at_tp.py
    python lab/study_reversal_at_tp.py --tp 4.25 --buf 0.15 --start 2022-01-01
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
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
    YEARS,
    _hdr,
    _max_dd,
    _row,
    _stats,
)
from lab.study_order_blocks import (
    replay_fixed_risk,
    risk_std,
    stop_fvg,
)
from lab.sim.exit import replay_trade_5m, ReplayResult
from lab.sim.entry import tp_price_from_r


# ── Reversal replay ────────────────────────────────────────────────────────

def replay_reversal(
    sig: dict,
    short_result: "ReplayResult",
    df5: pd.DataFrame,
    atr_mult: float,
    buf_mult: float,
    short_tp_r: float,
    sl_mult: float,
    fee_bps: float = 3.0,
) -> "ReplayResult | None":
    """
    Long reversal trade entered at the short's TP price.

    Entry  : short TP price  = entry_p - ATR×atr_mult × short_tp_r
    TP     : fvg_low of the original signal  (fill the FVG gap bottom)
    SL     : entry - ATR × sl_mult
    Risk   : ATR × sl_mult  (independent of atr_mult)
    """
    entry_p   = sig["entry_p"]
    atr_val   = sig["atr"]
    short_risk = atr_val * atr_mult

    rev_entry = entry_p - short_risk * short_tp_r   # where the short TP fired
    rev_tp    = sig["fvg_low"]                       # fill the FVG gap bottom
    rev_sl    = rev_entry - atr_val * sl_mult
    rev_risk  = atr_val * sl_mult

    # Sanity: TP must be above entry (long), SL must be below entry
    if rev_tp <= rev_entry or rev_sl >= rev_entry or rev_risk <= 0:
        return None

    return replay_trade_5m(
        df5,
        entry_ts                = short_result.exit_ts,
        side                    = +1,          # long
        entry_price             = rev_entry,
        stop_init               = rev_sl,
        tp_price                = rev_tp,
        risk                    = rev_risk,
        fee_bps                 = fee_bps,
        be_trigger_r            = None,
        be_offset_r             = 0.0,
        skip_entry_bucket_hours = 0.0,
    )


# ── Stats helpers ──────────────────────────────────────────────────────────

def _rev_stats(results: list, n_years: float) -> dict:
    if not results:
        return dict(n=0, win_pct=0, sl_pct=0, avg_r=0,
                    total_r=0, max_dd=0, dd_per_trade=0, ann_r=0)
    pnls  = np.array([r.pnl_r for r in results])
    n     = len(pnls)
    n_tp  = sum(1 for r in results if r.reason == "TP")
    n_sl  = sum(1 for r in results if r.reason == "SL")
    dd    = _max_dd(pnls)
    ann   = round(float(pnls.sum()) / n_years, 1)
    return dict(
        n            = n,
        win_pct      = round(n_tp / n * 100, 1),
        sl_pct       = round(n_sl / n * 100, 1),
        avg_r        = round(float(pnls.mean()), 4),
        total_r      = round(float(pnls.sum()), 2),
        max_dd       = round(dd, 2),
        dd_per_trade = round(dd / n, 4) if n else 0,
        ann_r        = ann,
    )


# ── Main ───────────────────────────────────────────────────────────────────

def main(
    db_path: str,
    atr_mult: float       = 2.0,
    vol_ratio_min: float  = 1.8,
    body_pct_min: float   = 0.55,
    close_pct_max: float  = 0.15,
    buf_mult: float       = 0.15,
    short_tp_r: float     = 4.25,
    start: str            = "2022-01-01",
) -> None:
    from lab.study_fvg_momentum import collect_signals, prepare_sym

    # ── Load ──────────────────────────────────────────────────────────────
    all_sigs: list[dict] = []
    sym_df5: dict[str, pd.DataFrame] = {}

    print(f"\nLoading {len(SYMS)} symbols  [{start} → latest]")
    print(f"Filters : vol>{vol_ratio_min}  body>{body_pct_min}  close<{close_pct_max}")
    print(f"Short   : FVG-LOW buf×{buf_mult}  TP={short_tp_r}R  ATR×{atr_mult}")
    print(f"Reversal: LONG at short TP  →  TP = fvg_low (gap fill)\n")

    for sym in SYMS:
        df5, df1h = prepare_sym(db_path, sym, start)
        sym_df5[sym] = df5
        sigs = collect_signals(
            df1h, sym,
            vol_ratio_min=vol_ratio_min,
            body_pct_min=body_pct_min,
            close_pct_max=close_pct_max,
        )
        all_sigs.extend(sigs)

    fvg_sigs = [s for s in all_sigs if s["has_fvg"]]
    n_years  = max((pd.Timestamp("today") - pd.Timestamp(start)).days / 365.25, 1)
    fvg_low_fn = lambda s: stop_fvg(s, buf_mult)

    print(f"  Total signals : {len(all_sigs)}")
    print(f"  FVG signals   : {len(fvg_sigs)}")

    # ── Run baseline shorts, collect TP-hit trades ─────────────────────────
    tp_pairs: list[tuple[dict, ReplayResult]] = []   # (sig, short_result)
    sl_pairs: list[tuple[dict, ReplayResult]] = []

    for s in fvg_sigs:
        sp = fvg_low_fn(s)
        if sp is None:
            continue
        rb  = risk_std(s, atr_mult)
        res = replay_fixed_risk(s, sym_df5[s["sym"]], sp, rb, short_tp_r)
        if res is None:
            continue
        if res.reason == "TP":
            tp_pairs.append((s, res))
        else:
            sl_pairs.append((s, res))

    print(f"\n  Short TP hits : {len(tp_pairs)} ({len(tp_pairs)/max(len(fvg_sigs),1)*100:.1f}% of FVG signals)")
    print(f"  Short SL hits : {len(sl_pairs)} ({len(sl_pairs)/max(len(fvg_sigs),1)*100:.1f}%)")

    # ── Section A: Reversal geometry overview ─────────────────────────────
    print(f"\n{'='*72}")
    print(f"A — Reversal geometry  |  {len(tp_pairs)} winning shorts")
    print(f"{'='*72}")

    tp_dists = []   # distance from reversal entry to fvg_low, in ATR units
    for s, _ in tp_pairs:
        atr_val   = s["atr"]
        short_risk = atr_val * atr_mult
        rev_entry = s["entry_p"] - short_risk * short_tp_r
        rev_tp    = s["fvg_low"]
        if atr_val > 0:
            tp_dists.append((rev_tp - rev_entry) / atr_val)

    tp_dists = np.array(tp_dists)
    print(f"  Reversal TP distance (fvg_low − rev_entry) in ATR units:")
    print(f"    mean={tp_dists.mean():.2f}  median={np.median(tp_dists):.2f}  "
          f"min={tp_dists.min():.2f}  max={tp_dists.max():.2f}")
    print(f"\n  Implied TP R-multiple at each SL (using median TP dist = {np.median(tp_dists):.2f} ATR):")
    print(f"  {'SL mult':>10}  {'impl_TP_R':>10}  {'breakeven_win%':>15}")
    for sl_m in [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0]:
        implied_r = np.median(tp_dists) / sl_m
        be_win    = 1 / (1 + implied_r) * 100
        print(f"  {sl_m:>10.2f}  {implied_r:>10.2f}R  {be_win:>14.1f}%")

    # ── Section B: SL sweep ────────────────────────────────────────────────
    sl_sweep = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0]

    _hdr(
        f"B — SL sweep  |  LONG reversal at short TP  |  TP=fvg_low",
        ["sl_mult", "n", "win%", "sl%", "impl_R",
         "avg_R", "total_R", "maxDD", "DD/n", "ann_R"],
    )

    sweep_results = []
    for sl_m in sl_sweep:
        results = []
        for s, short_res in tp_pairs:
            df5 = sym_df5[s["sym"]]
            res = replay_reversal(s, short_res, df5, atr_mult, buf_mult,
                                  short_tp_r, sl_m)
            if res:
                results.append(res)
        if not results:
            continue
        st   = _rev_stats(results, n_years)
        # median implied TP R for this sl_mult
        impl = round(np.median(tp_dists) / sl_m, 2)
        sweep_results.append({"sl_mult": sl_m, "impl_r": impl, **st, "results": results})
        _row([f"×{sl_m}", st["n"], f"{st['win_pct']}%", f"{st['sl_pct']}%",
              f"{impl}R", f"{st['avg_r']:.4f}", f"{st['total_r']:.1f}",
              f"{st['max_dd']:.1f}", f"{st['dd_per_trade']:.3f}",
              f"{st['ann_r']:.1f}"])

    if not sweep_results:
        print("  No valid reversal trades found.")
        return

    best = max(sweep_results, key=lambda x: x["total_r"])
    best_safe = sorted(
        [r for r in sweep_results if r["dd_per_trade"] < 0.1],
        key=lambda x: x["total_r"], reverse=True,
    )
    print(f"\n  → Best by total_R : sl×{best['sl_mult']}  "
          f"total={best['total_r']:.1f}  win={best['win_pct']}%  "
          f"maxDD={best['max_dd']:.1f}  ann={best['ann_r']:.1f}R/yr")
    if best_safe:
        bs = best_safe[0]
        print(f"  → Best (DD/n<0.10): sl×{bs['sl_mult']}  "
              f"total={bs['total_r']:.1f}  win={bs['win_pct']}%  "
              f"maxDD={bs['max_dd']:.1f}  ann={bs['ann_r']:.1f}R/yr")

    # pick best config for year/symbol breakdowns
    chosen = best_safe[0] if best_safe else best
    chosen_sl = chosen["sl_mult"]
    print(f"\n  Chosen SL for C/D: ×{chosen_sl}  impl_R≈{chosen['impl_r']}R")

    # ── Section C: Year breakdown ──────────────────────────────────────────
    _hdr(
        f"C — Year breakdown  |  reversal SL×{chosen_sl}  |  TP=fvg_low",
        ["year", "n_shorts", "n_rev", "rev_win%", "rev_R", "maxDD"],
    )

    yr_rev:    dict[int, list] = defaultdict(list)
    yr_shorts: dict[int, int]  = defaultdict(int)

    for s, short_res in tp_pairs:
        df5 = sym_df5[s["sym"]]
        yr  = s["year"]
        yr_shorts[yr] += 1
        res = replay_reversal(s, short_res, df5, atr_mult, buf_mult,
                              short_tp_r, chosen_sl)
        if res:
            yr_rev[yr].append(res.pnl_r)

    for yr in YEARS:
        r  = np.array(yr_rev.get(yr, []))
        ns = yr_shorts.get(yr, 0)
        if len(r) == 0:
            _row([yr, ns, 0, "—", "—", "—"])
        else:
            _row([yr, ns, len(r), f"{(r>0).mean()*100:.1f}%",
                  f"{r.sum():.1f}", f"{_max_dd(r):.1f}"])

    # ── Section D: Per-symbol breakdown ───────────────────────────────────
    _hdr(
        f"D — Per-symbol  |  reversal SL×{chosen_sl}  |  TP=fvg_low",
        ["sym", "n_shorts", "n_rev", "rev_win%", "rev_sl%",
         "impl_R", "rev_R", "maxDD"],
    )
    for sym in SYMS:
        sub_tp = [(s, r) for s, r in tp_pairs if s["sym"] == sym]
        rev_res = []
        for s, short_res in sub_tp:
            df5 = sym_df5[s["sym"]]
            res = replay_reversal(s, short_res, df5, atr_mult, buf_mult,
                                  short_tp_r, chosen_sl)
            if res:
                rev_res.append(res)

        if not rev_res:
            _row([sym, len(sub_tp), 0, "—", "—", "—", "—", "—"])
            continue

        pnls  = np.array([r.pnl_r for r in rev_res])
        n_tp2 = sum(1 for r in rev_res if r.reason == "TP")
        n_sl2 = sum(1 for r in rev_res if r.reason == "SL")

        # per-sym implied R
        sym_tp_dists = []
        for s, _ in sub_tp:
            rv = s["entry_p"] - s["atr"] * atr_mult * short_tp_r
            if s["atr"] > 0:
                sym_tp_dists.append((s["fvg_low"] - rv) / s["atr"])
        impl_sym = round(np.median(sym_tp_dists) / chosen_sl, 2) if sym_tp_dists else 0

        _row([sym, len(sub_tp), len(pnls),
              f"{n_tp2/len(pnls)*100:.1f}%",
              f"{n_sl2/len(pnls)*100:.1f}%",
              f"{impl_sym}R",
              f"{pnls.sum():.1f}",
              f"{_max_dd(pnls):.1f}"])

    # ── Section E: distribution — implied R vs outcome ────────────────────
    print(f"\n{'='*72}")
    print(f"E — Implied R-bucket distribution  |  SL×{chosen_sl}")
    print(f"{'='*72}")
    print(f"  {'impl_R_bucket':>14}  {'n':>5}  {'win%':>6}  {'avg_R':>7}  {'total_R':>8}")
    print(f"  {'-'*50}")

    buckets: dict[str, list] = defaultdict(list)
    for s, short_res in tp_pairs:
        atr_val   = s["atr"]
        short_risk = atr_val * atr_mult
        rev_entry = s["entry_p"] - short_risk * short_tp_r
        rev_tp    = s["fvg_low"]
        if atr_val <= 0:
            continue
        impl_r = (rev_tp - rev_entry) / (atr_val * chosen_sl)
        if impl_r < 3:
            bucket = "<3R"
        elif impl_r < 5:
            bucket = "3-5R"
        elif impl_r < 7:
            bucket = "5-7R"
        elif impl_r < 10:
            bucket = "7-10R"
        elif impl_r < 15:
            bucket = "10-15R"
        else:
            bucket = "≥15R"

        df5 = sym_df5[s["sym"]]
        res = replay_reversal(s, short_res, df5, atr_mult, buf_mult,
                              short_tp_r, chosen_sl)
        if res:
            buckets[bucket].append(res.pnl_r)

    for bucket in ["<3R", "3-5R", "5-7R", "7-10R", "10-15R", "≥15R"]:
        arr = np.array(buckets.get(bucket, []))
        if len(arr) == 0:
            continue
        print(f"  {bucket:>14}  {len(arr):>5}  "
              f"{(arr>0).mean()*100:>5.1f}%  "
              f"{arr.mean():>7.4f}  {arr.sum():>8.1f}")

    # ── Combined view: short P&L + reversal P&L at best SL ────────────────
    print(f"\n{'='*72}")
    print(f"COMBINED: short strategy + reversal at SL×{chosen_sl}")
    print(f"{'='*72}")

    # short total
    all_short_pnls = []
    for s in fvg_sigs:
        sp = fvg_low_fn(s)
        if sp is None: continue
        rb  = risk_std(s, atr_mult)
        res = replay_fixed_risk(s, sym_df5[s["sym"]], sp, rb, short_tp_r)
        if res: all_short_pnls.append(res.pnl_r)

    # reversal total at chosen SL
    all_rev_pnls = [r.pnl_r for r in chosen["results"]]

    short_arr = np.array(all_short_pnls)
    rev_arr   = np.array(all_rev_pnls)
    comb      = np.concatenate([short_arr, rev_arr])

    print(f"\n  Short only  : n={len(short_arr)}  total={short_arr.sum():.1f}R  "
          f"maxDD={_max_dd(short_arr):.1f}  ann={short_arr.sum()/n_years:.1f}R/yr")
    print(f"  Reversal    : n={len(rev_arr)}   total={rev_arr.sum():.1f}R  "
          f"maxDD={_max_dd(rev_arr):.1f}  ann={rev_arr.sum()/n_years:.1f}R/yr")
    print(f"  Combined    : n={len(comb)}  total={comb.sum():.1f}R  "
          f"maxDD={_max_dd(comb):.1f}  ann={comb.sum()/n_years:.1f}R/yr")

    # ── Save ──────────────────────────────────────────────────────────────
    rows_out = []
    for r in sweep_results:
        rows_out.append({
            "sl_mult":     r["sl_mult"],
            "impl_r":      r["impl_r"],
            "n":           r["n"],
            "win_pct":     r["win_pct"],
            "sl_pct":      r["sl_pct"],
            "avg_r":       r["avg_r"],
            "total_r":     r["total_r"],
            "max_dd":      r["max_dd"],
            "dd_per_trade":r["dd_per_trade"],
            "ann_r":       r["ann_r"],
        })
    out = REPO_ROOT / "cache" / "reversal_at_tp.csv"
    out.parent.mkdir(exist_ok=True)
    pd.DataFrame(rows_out).to_csv(out, index=False)
    print(f"\nSaved → {out}\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db",        default=DEFAULT_DB)
    ap.add_argument("--start",     default="2022-01-01")
    ap.add_argument("--atr-mult",  type=float, default=2.0)
    ap.add_argument("--vol-ratio", type=float, default=1.8)
    ap.add_argument("--body-pct",  type=float, default=0.55)
    ap.add_argument("--close-pct", type=float, default=0.15)
    ap.add_argument("--buf",       type=float, default=0.15)
    ap.add_argument("--tp",        type=float, default=4.25,
                    help="Short TP (default 4.25R)")
    args = ap.parse_args()

    print("=" * 72)
    print("Reversal-at-TP study  |  LONG after short TP hit  |  TP=fvg_low")
    print("=" * 72)
    main(
        db_path       = args.db,
        atr_mult      = args.atr_mult,
        vol_ratio_min = args.vol_ratio,
        body_pct_min  = args.body_pct,
        close_pct_max = args.close_pct,
        buf_mult      = args.buf,
        short_tp_r    = args.tp,
        start         = args.start,
    )
