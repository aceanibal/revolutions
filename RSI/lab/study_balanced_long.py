#!/usr/bin/env python3
"""
BALANCED HIGH-vol FVG Long Study
=================================

Mirror of the FVG short strategy — same regime, opposite direction.

Hypothesis: In a ranging (BALANCED) market with elevated volatility, a
bullish FVG candle leaves a gap below price that acts as support. Price is
more likely to continue higher than to fill the gap.

Bullish FVG at signal bar i:
  Condition : low[i] > high[i-2]  — gap was left on the way up
  FVG zone  : [high[i-2], low[i]]
  fvg_high  = low[i]     ← top of gap, nearest to entry (below it)
  fvg_low   = high[i-2]  ← bottom of gap

Entry long at bar i+1 open.
Stop: fvg_high - ATR × buf_mult  (just below gap top; if gap fills → invalidated)
Risk basis: ATR × 2.0  (decoupled from stop, same as short strategy)
TP: sweep 1.5R → 8.0R

Signal conditions (all on 1h bar i):
  1. structure == BALANCED  (ER < 0.35)
  2. vol_q == HIGH           (ATR in top 33% of 200-bar history)
  3. vol_ratio > 1.8         (volume spike)
  4. body_pct > 0.55         (strong body)
  5. close > open            (bullish candle)
  6. close_pct > 0.85        (close in top 15% of bar range)
  7. Bullish FVG present     (low[i] > high[i-2], fvg_high < entry)

Sections:
  A. Signal counts — all vs FVG-only, per symbol
  B. TP sweep — FVG-stop mode (4 key levels)
  C. Year breakdown at best TP
  D. Per-symbol at best TP
  E. BAL_SHORT vs BAL_LONG side-by-side comparison

Usage:
    python lab/study_balanced_long.py
    python lab/study_balanced_long.py --start 2023-01-01
    python lab/study_balanced_long.py --buf-mult 0.25
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

LAB_ROOT = Path(__file__).resolve().parent
REPO_ROOT = LAB_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from lab.study_fvg_momentum import (
    DEFAULT_DB, SYMS, YEARS,
    _hdr, _max_dd, _row, _stats, prepare_sym,
    collect_signals as collect_short_signals,
)
from lab.sim.exit import replay_trade_5m
from lab.sim.entry import tp_price_from_r


# ── Signal collector ───────────────────────────────────────────────────────

def collect_balanced_long_signals(
    df1h: pd.DataFrame,
    sym: str,
    vol_ratio_min: float = 1.8,
    body_pct_min: float  = 0.55,
    close_pct_min: float = 0.85,   # close must be in top 15% of bar range
) -> list[dict]:
    """
    Collect BALANCED+HIGH bullish FVG signals (mirror of FVG short).

    Bullish FVG: low[i] > high[i-2]
      fvg_high = low[i]     — top of gap (nearest to entry from below)
      fvg_low  = high[i-2]  — bottom of gap
    """
    hi_arr = df1h["high"].values
    lo_arr = df1h["low"].values
    n      = len(df1h)
    sigs   = []
    min_idx = 62  # regime warmup

    for i in range(min_idx, n - 1):
        row = df1h.iloc[i]

        if pd.isna(row.get("atr")) or pd.isna(row.get("vol_q")):
            continue
        if row["structure"] != "BALANCED":
            continue
        if row["vol_q"] != "HIGH":
            continue
        if not (row.get("vol_ratio", 0.0) > vol_ratio_min):
            continue
        if not (row.get("body_pct", 0.0) > body_pct_min):
            continue
        if not (float(row["close"]) > float(row["open"])):   # bullish
            continue
        if not (float(row.get("close_pct", 0.0)) > close_pct_min):   # close near high
            continue

        entry_bar = df1h.iloc[i + 1]
        if pd.isna(entry_bar["open"]):
            continue

        entry_p = float(entry_bar["open"])
        atr_val = float(row["atr"])

        # Bullish FVG: low[i] > high[i-2]
        has_fvg  = False
        fvg_high = np.nan   # low[i]     — top of gap, nearest to entry from below
        fvg_low  = np.nan   # high[i-2]  — bottom of gap
        gap_bps  = 0.0

        if i >= 2 and lo_arr[i] > hi_arr[i - 2]:
            fvg_high_v = float(lo_arr[i])
            fvg_low_v  = float(hi_arr[i - 2])
            # Validate: gap top must be below entry (gap is beneath current price)
            if fvg_high_v < entry_p:
                gap_bps  = (fvg_high_v - fvg_low_v) / fvg_low_v * 10_000
                has_fvg  = True
                fvg_high = fvg_high_v
                fvg_low  = fvg_low_v

        sigs.append({
            "ts":       entry_bar.name,
            "year":     entry_bar.name.year,
            "sym":      sym,
            "entry_p":  entry_p,
            "atr":      atr_val,
            "has_fvg":  has_fvg,
            "fvg_high": fvg_high,   # stop reference (top of bullish gap)
            "fvg_low":  fvg_low,
            "gap_bps":  round(gap_bps, 1),
        })

    return sigs


# ── Replay helpers ─────────────────────────────────────────────────────────

def replay_long_standard(
    sig: dict,
    df5: pd.DataFrame,
    atr_mult: float,
    tp_r: float,
    fee_bps: float = 3.0,
) -> "ReplayResult | None":
    """Standard ATR stop: stop = entry - ATR × atr_mult."""
    entry_p = sig["entry_p"]
    risk    = sig["atr"] * atr_mult
    if risk <= 0:
        return None
    stop_p = entry_p - risk
    tp_p   = tp_price_from_r(entry_p, risk, +1, tp_r)
    return replay_trade_5m(
        df5, sig["ts"], +1, entry_p, stop_p, tp_p, risk, fee_bps,
        be_trigger_r=None, be_offset_r=0.0, skip_entry_bucket_hours=0.0,
    )


def replay_long_fvg_stop(
    sig: dict,
    df5: pd.DataFrame,
    atr_mult: float,
    buf_mult: float,
    tp_r: float,
    fee_bps: float = 3.0,
) -> "ReplayResult | None":
    """
    FVG-stop for longs: stop = fvg_high - ATR × buf_mult
    (just below the top of the bullish gap).
    Risk basis for TP remains ATR × atr_mult (decoupled, same as short strategy).
    """
    if not sig["has_fvg"] or np.isnan(sig["fvg_high"]):
        return None

    entry_p  = sig["entry_p"]
    atr_val  = sig["atr"]
    risk     = atr_val * atr_mult    # risk basis for TP (unchanged)
    stop_p   = sig["fvg_high"] - atr_val * buf_mult   # tight: just below gap top

    if risk <= 0 or stop_p >= entry_p:   # stop must be below entry
        return None

    tp_p = tp_price_from_r(entry_p, risk, +1, tp_r)
    return replay_trade_5m(
        df5, sig["ts"], +1, entry_p, stop_p, tp_p, risk, fee_bps,
        be_trigger_r=None, be_offset_r=0.0, skip_entry_bucket_hours=0.0,
    )


# ── Stats helpers ──────────────────────────────────────────────────────────

def _mcl(pnls: np.ndarray) -> int:
    best, cur = 0, 0
    for p in pnls:
        cur = cur + 1 if p < 0 else 0
        best = max(best, cur)
    return best


def _sweep_row(sigs, sym_df5, atr_mult, buf_mult, tp_r, n_years, use_fvg_stop=True):
    pnls = []
    for s in sigs:
        if use_fvg_stop:
            res = replay_long_fvg_stop(s, sym_df5[s["sym"]], atr_mult, buf_mult, tp_r)
        else:
            res = replay_long_standard(s, sym_df5[s["sym"]], atr_mult, tp_r)
        if res:
            pnls.append(res.pnl_r)
    if not pnls:
        return None
    arr = np.array(pnls)
    dd  = _max_dd(arr)
    n   = len(arr)
    return dict(
        tp=tp_r, n=n,
        win_pct=round((arr>0).mean()*100, 1),
        avg_r=round(float(arr.mean()), 4),
        total_r=round(float(arr.sum()), 2),
        max_dd=round(dd, 2),
        dd_per_trade=round(dd/n, 4),
        mcl=_mcl(arr),
        ann_r=round(float(arr.sum())/n_years, 1),
    )


# ── Main ───────────────────────────────────────────────────────────────────

def main(
    db_path: str,
    atr_mult: float      = 2.0,
    buf_mult: float      = 0.15,
    vol_ratio_min: float = 1.8,
    body_pct_min: float  = 0.55,
    close_pct_min: float = 0.85,
    start: str           = "2022-01-01",
) -> None:

    TP_LEVELS = [1.5, 2.0, 3.0, 4.0, 4.25, 5.0, 6.0, 8.0]

    # ── Load ──────────────────────────────────────────────────────────────
    all_long_sigs:  list[dict] = []
    all_short_sigs: list[dict] = []
    sym_df5: dict[str, pd.DataFrame] = {}

    print(f"\nLoading {len(SYMS)} symbols  [{start} → latest]")
    print(f"Filters : vol>{vol_ratio_min}  body>{body_pct_min}  close_pct>{close_pct_min}")
    print(f"Regime  : BALANCED + HIGH vol_q  |  bullish FVG\n")

    for sym in SYMS:
        df5, df1h = prepare_sym(db_path, sym, start)
        sym_df5[sym] = df5

        long_sigs  = collect_balanced_long_signals(
            df1h, sym,
            vol_ratio_min=vol_ratio_min,
            body_pct_min=body_pct_min,
            close_pct_min=close_pct_min,
        )
        short_sigs = collect_short_signals(df1h, sym,
                                           vol_ratio_min=vol_ratio_min,
                                           body_pct_min=body_pct_min)
        short_fvg  = [s for s in short_sigs if s["has_fvg"]]

        n_fvg = sum(1 for s in long_sigs if s["has_fvg"])
        print(f"  {sym:<12}  longs={len(long_sigs):>3}  (FVG={n_fvg:>3})  |  "
              f"shorts_fvg={len(short_fvg):>3}")
        all_long_sigs.extend(long_sigs)
        all_short_sigs.extend(short_fvg)

    n_years = max((pd.Timestamp("today") - pd.Timestamp(start)).days / 365.25, 1)
    fvg_longs  = [s for s in all_long_sigs if s["has_fvg"]]
    fvg_shorts = all_short_sigs

    print(f"\n  TOTAL long signals : {len(all_long_sigs)}  (FVG-tagged: {len(fvg_longs)})")
    print(f"  BAL SHORT baseline : {len(fvg_shorts)} FVG signals  "
          f"29.6% win  142.3R  maxDD=10.3  33.2R/yr  (TP=4.25R)")

    # ── Section A: FVG filter quality ────────────────────────────────────
    _hdr(
        f"A — FVG as signal filter  |  standard stop ATR×{atr_mult}  TP=4.25R",
        ["subset", "n", "win%", "avg_R", "total_R", "maxDD", "DD/n", "MCL"],
    )
    for label, subset, use_fvg in [
        ("ALL longs",  all_long_sigs, False),
        ("FVG longs",  fvg_longs,     False),
        ("No-FVG",     [s for s in all_long_sigs if not s["has_fvg"]], False),
    ]:
        pnls = []
        for s in subset:
            res = replay_long_standard(s, sym_df5[s["sym"]], atr_mult, 4.25)
            if res: pnls.append(res.pnl_r)
        if not pnls:
            _row([label, 0, "—", "—", "—", "—", "—", "—"])
            continue
        arr = np.array(pnls)
        dd  = _max_dd(arr)
        n   = len(arr)
        _row([label, n, f"{(arr>0).mean()*100:.1f}%", f"{arr.mean():.4f}",
              f"{arr.sum():.1f}", f"{dd:.1f}", f"{dd/n:.4f}", _mcl(arr)])

    # ── Section B: TP sweep — FVG stop ───────────────────────────────────
    print(f"\n  Running TP sweep ({len(fvg_longs)} FVG signals × {len(TP_LEVELS)} TPs, "
          f"buf×{buf_mult})...")

    sweep_rows = []
    for tp_r in TP_LEVELS:
        row = _sweep_row(fvg_longs, sym_df5, atr_mult, buf_mult, tp_r, n_years)
        if row:
            sweep_rows.append(row)

    _hdr(
        f"B — TP sweep  |  FVG LONG  |  ATR×{atr_mult}  buf×{buf_mult}  "
        f"|  {len(fvg_longs)} signals",
        ["TP", "n", "win%", "avg_R", "total_R", "maxDD", "DD/n", "MCL", "ann_R"],
    )
    best = None
    for r in sweep_rows:
        _row([f"{r['tp']}R", r["n"], f"{r['win_pct']}%", f"{r['avg_r']:.4f}",
              f"{r['total_r']:.1f}", f"{r['max_dd']:.1f}",
              f"{r['dd_per_trade']:.3f}", r["mcl"], f"{r['ann_r']:.1f}"])
        if best is None or r["total_r"] > best["total_r"]:
            best = r

    print(f"\n  → Best by total_R: TP={best['tp']}R  total={best['total_r']}  "
          f"win={best['win_pct']}%  maxDD={best['max_dd']}  ann={best['ann_r']:.1f}R/yr")

    # Top 5 by ann_R with DD/n guard
    candidates = sorted(
        [r for r in sweep_rows if r["dd_per_trade"] < 0.10],
        key=lambda r: r["ann_r"], reverse=True,
    )[:5]
    if candidates:
        print(f"  Top 5 by ann_R (DD/n<0.10):")
        for r in candidates:
            print(f"    TP={r['tp']}R  ann={r['ann_r']:.1f}/yr  total={r['total_r']:.1f}  "
                  f"win={r['win_pct']}%  maxDD={r['max_dd']:.1f}  DD/n={r['dd_per_trade']:.3f}")

    best_tp = candidates[0]["tp"] if candidates else best["tp"]

    # ── Section C: Year breakdown ─────────────────────────────────────────
    _hdr(
        f"C — Year breakdown  |  FVG LONG  TP={best_tp}R  buf×{buf_mult}",
        ["year", "n", "win%", "avg_R", "total_R", "maxDD", "ann_R"],
    )
    yr_pnl: dict[int, list] = defaultdict(list)
    for s in fvg_longs:
        res = replay_long_fvg_stop(s, sym_df5[s["sym"]], atr_mult, buf_mult, best_tp)
        if res: yr_pnl[s["year"]].append(res.pnl_r)

    for yr in YEARS:
        p = np.array(yr_pnl.get(yr, []))
        if len(p) == 0:
            _row([yr, 0, "—", "—", "—", "—", "—"])
            continue
        dd = _max_dd(p)
        _row([yr, len(p), f"{(p>0).mean()*100:.1f}%", f"{p.mean():.4f}",
              f"{p.sum():.1f}", f"{dd:.1f}", f"{p.sum()/n_years:.1f}"])

    # ── Section D: Per-symbol ─────────────────────────────────────────────
    _hdr(
        f"D — Per-symbol  |  FVG LONG  TP={best_tp}R  buf×{buf_mult}",
        ["sym", "n", "win%", "avg_R", "total_R", "maxDD", "DD/n"],
    )
    for sym in SYMS:
        sub = [s for s in fvg_longs if s["sym"] == sym]
        pnls = []
        for s in sub:
            res = replay_long_fvg_stop(s, sym_df5[sym], atr_mult, buf_mult, best_tp)
            if res: pnls.append(res.pnl_r)
        if not pnls:
            _row([sym, 0, "—", "—", "—", "—", "—"])
            continue
        arr = np.array(pnls)
        dd  = _max_dd(arr)
        n   = len(arr)
        _row([sym, n, f"{(arr>0).mean()*100:.1f}%", f"{arr.mean():.4f}",
              f"{arr.sum():.1f}", f"{dd:.1f}", f"{dd/n:.3f}"])

    # ── Section E: BAL_SHORT vs BAL_LONG side-by-side ────────────────────
    # Replay short at its optimal config (TP=4.25R, FVG-LOW stop)
    from lab.sim.entry import tp_price_from_r as _tp

    def _replay_short_fvg(s):
        ep  = s["entry_p"]
        atv = s["atr"]
        stp = s["fvg_low"] + atv * 0.15
        rsk = atv * 2.0
        if rsk <= 0 or stp <= ep:
            return None
        tp  = _tp(ep, rsk, -1, 4.25)
        res = replay_trade_5m(sym_df5[s["sym"]], s["ts"], -1, ep, stp, tp, rsk, 3.0,
                              be_trigger_r=None, be_offset_r=0.0)
        return res

    sh_pnls = [r.pnl_r for s in fvg_shorts for r in [_replay_short_fvg(s)] if r]
    lg_pnls = [r.pnl_r for s in fvg_longs
               for r in [replay_long_fvg_stop(s, sym_df5[s["sym"]], atr_mult, buf_mult, best_tp)]
               if r]

    _hdr(
        f"E — BAL_SHORT vs BAL_LONG  |  short TP=4.25R  long TP={best_tp}R",
        ["stream", "n", "win%", "avg_R", "total_R", "maxDD", "DD/n", "ann_R"],
    )
    for label, pnls in [("BAL_SHORT", sh_pnls), (f"BAL_LONG", lg_pnls)]:
        arr = np.array(pnls)
        if len(arr) == 0:
            _row([label, 0, "—", "—", "—", "—", "—", "—"])
            continue
        dd = _max_dd(arr)
        n  = len(arr)
        _row([label, n, f"{(arr>0).mean()*100:.1f}%", f"{arr.mean():.4f}",
              f"{arr.sum():.1f}", f"{dd:.1f}", f"{dd/n:.3f}", f"{arr.sum()/n_years:.1f}"])

    # Combined BAL_SHORT + BAL_LONG
    all_bal_pnls = sh_pnls + lg_pnls
    arr_c = np.array(all_bal_pnls)
    dd_c  = _max_dd(arr_c)
    n_c   = len(arr_c)
    _row(["BAL_COMBINED", n_c, f"{(arr_c>0).mean()*100:.1f}%", f"{arr_c.mean():.4f}",
          f"{arr_c.sum():.1f}", f"{dd_c:.1f}", f"{dd_c/n_c:.3f}",
          f"{arr_c.sum()/n_years:.1f}"])

    # ── Save ──────────────────────────────────────────────────────────────
    out = REPO_ROOT / "cache" / "balanced_long_sweep.csv"
    out.parent.mkdir(exist_ok=True)
    pd.DataFrame(sweep_rows).to_csv(out, index=False)
    print(f"\nSaved → {out}\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db",         default=DEFAULT_DB)
    ap.add_argument("--start",      default="2022-01-01")
    ap.add_argument("--atr-mult",   type=float, default=2.0)
    ap.add_argument("--buf-mult",   type=float, default=0.15)
    ap.add_argument("--vol-ratio",  type=float, default=1.8)
    ap.add_argument("--body-pct",   type=float, default=0.55)
    ap.add_argument("--close-pct",  type=float, default=0.85)
    args = ap.parse_args()

    print("=" * 72)
    print("BALANCED HIGH-vol FVG Long Study")
    print("=" * 72)
    main(
        db_path       = args.db,
        atr_mult      = args.atr_mult,
        buf_mult      = args.buf_mult,
        vol_ratio_min = args.vol_ratio,
        body_pct_min  = args.body_pct,
        close_pct_min = args.close_pct,
        start         = args.start,
    )
