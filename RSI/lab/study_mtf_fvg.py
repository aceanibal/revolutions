#!/usr/bin/env python3
"""
Multi-Timeframe FVG + FVG-LOW stop — momentum short study
===========================================================

Tests the FVG + FVG-LOW stop strategy across four timeframes:
  5m, 15m, 1h (baseline), 4h

For each HTF:
  - Signals are detected on HTF bars (BALANCED regime, HIGH vol_q, bearish)
  - Trades are replayed on 5m candles (granular execution)
  - FVG detection: high[i] < low[i-2]  (bearish gap above entry)
  - Stops: STANDARD (ATR×atr_mult) vs FVG-LOW (fvg_low + ATR×buf)
  - TP sweep 1.5 → 6.0R in 0.25 steps

Outputs per timeframe:
  A. TP sweep with auto-filter (DD/n < 0.08)
  B. Year breakdown at best TP
  C. Per-symbol at best TP
  D. Side-by-side summary: standard vs fvg-low at selected TPs

Usage:
    python lab/study_mtf_fvg.py                        # all four HTFs
    python lab/study_mtf_fvg.py --htf 4h               # single HTF
    python lab/study_mtf_fvg.py --htf 5m 15m 4h        # subset
    python lab/study_mtf_fvg.py --start 2023-01-01
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
    _stats_from_results,
)
from lab.study_order_blocks import (
    replay_fixed_risk,
    risk_std,
    stop_standard,
    stop_fvg,      # fvg_low + ATR×buf  (FVG-LOW stop)
    _run_subset,
    _r_saved_report,
)


# ── HTF-aware data prep ────────────────────────────────────────────────────

def prepare_sym_mtf(
    db_path: str,
    sym: str,
    htf: str,
    start: str = "2022-01-01",
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Load 5m data, resample to *htf*, run regime + candle metrics.

    Returns (df5, df_htf)  where df_htf has all columns collect_signals needs.
    """
    from lab.core.db import load_merged_5m
    from lab.core.resample import resample_ohlcv
    from lab.core.regime import classify_regimes

    df5 = load_merged_5m(db_path, sym)
    df5 = df5.loc[df5.index >= pd.Timestamp(start, tz="UTC")]

    df_htf = resample_ohlcv(df5, htf).copy()
    df_htf = classify_regimes(
        df_htf,
        atr_period=14,
        atr_ma_period=50,
        er_period=20,
        er_balanced_threshold=0.35,
    )

    # Candle structure metrics (same as prepare_sym in study_fvg_momentum)
    rng = (df_htf["high"] - df_htf["low"]).replace(0, np.nan)
    df_htf["close_pct"] = (df_htf["close"] - df_htf["low"]) / rng
    df_htf["body_pct"]  = (df_htf["close"] - df_htf["open"]).abs() / rng
    df_htf["vol_ratio"] = (
        df_htf["volume"]
        / df_htf["volume"].rolling(20, min_periods=10).median()
    )

    # Rolling quantile vol regime — balanced thirds (same as 1h version)
    atr_r = df_htf["atr_ratio"]
    p67   = atr_r.rolling(200, min_periods=50).quantile(0.67)
    p33   = atr_r.rolling(200, min_periods=50).quantile(0.33)
    vol_q = np.where(atr_r >= p67, "HIGH",
            np.where(atr_r < p33,  "LOW", "MED")).astype(object)
    vol_q[p67.isna().values] = np.nan
    df_htf["vol_q"] = vol_q

    return df5, df_htf


# ── Signal collector (FVG-tagged, HTF-generic) ─────────────────────────────

def collect_signals_htf(
    df_htf: pd.DataFrame,
    sym: str,
    vol_ratio_min: float = 1.8,
    body_pct_min: float  = 0.55,
    close_pct_max: float = 0.15,
) -> list[dict]:
    """
    Collect momentum short signals on any HTF df with regime + metric cols.

    Identical logic to study_fvg_momentum.collect_signals but:
      - Works on any HTF (5m, 15m, 1h, 4h)
      - Only tags FVG; no OB detection
      - 'has_creator' always False (compatibility with study_ob_strict functions)
    """
    hi_arr = df_htf["high"].values
    lo_arr = df_htf["low"].values
    n      = len(df_htf)
    sigs   = []
    min_idx = 62   # regime warmup; NaN guards below handle anything shorter

    for i in range(min_idx, n - 1):
        row = df_htf.iloc[i]

        if pd.isna(row.get("atr")) or pd.isna(row.get("vol_q")):
            continue
        if row["structure"] != "BALANCED":
            continue
        if row["vol_q"] != "HIGH":
            continue
        if not (row["close_pct"] < close_pct_max):
            continue
        if not (row["close"] < row["open"]):
            continue
        if not (row["vol_ratio"] > vol_ratio_min):
            continue
        if not (row["body_pct"] > body_pct_min):
            continue

        entry_bar = df_htf.iloc[i + 1]
        if pd.isna(entry_bar["open"]):
            continue

        entry_p = float(entry_bar["open"])
        atr_val = float(row["atr"])

        # ── Bearish FVG: high[i] < low[i-2] ──────────────────────────────
        has_fvg  = False
        fvg_low  = np.nan
        fvg_high = np.nan

        if i >= 2 and hi_arr[i] < lo_arr[i - 2]:
            fl = float(hi_arr[i])
            fh = float(lo_arr[i - 2])
            if fl > entry_p:   # gap is above entry → valid short resistance
                has_fvg  = True
                fvg_low  = fl
                fvg_high = fh

        sigs.append({
            "ts":          df_htf.index[i + 1],
            "year":        df_htf.index[i + 1].year,
            "sym":         sym,
            "entry_p":     entry_p,
            "atr":         atr_val,
            "has_fvg":     has_fvg,
            "fvg_low":     fvg_low,
            "fvg_high":    fvg_high,
            # compat with study_ob_strict helpers
            "has_creator": False,
        })

    return sigs


# ── Per-HTF runner ─────────────────────────────────────────────────────────

def run_htf(
    db_path: str,
    htf: str,
    atr_mult: float,
    vol_ratio_min: float,
    body_pct_min: float,
    close_pct_max: float,
    buf_mult: float,
    start: str,
    tp_sweep: list[float],
) -> dict:
    """Run the full sweep for one HTF. Returns summary dict for cross-HTF table."""

    print(f"\n{'#'*72}")
    print(f"# HTF = {htf}   [{start} → latest]   buf×{buf_mult}")
    print(f"{'#'*72}")

    all_sigs: list[dict] = []
    sym_df5: dict[str, pd.DataFrame] = {}

    for sym in SYMS:
        df5, df_htf = prepare_sym_mtf(db_path, sym, htf, start)
        sym_df5[sym] = df5
        sigs = collect_signals_htf(
            df_htf, sym,
            vol_ratio_min=vol_ratio_min,
            body_pct_min=body_pct_min,
            close_pct_max=close_pct_max,
        )
        all_sigs.extend(sigs)

    fvg_sigs = [s for s in all_sigs if s["has_fvg"]]
    n_all    = len(all_sigs)
    n_fvg    = len(fvg_sigs)
    print(f"\n  Total signals : {n_all}")
    print(f"  FVG signals   : {n_fvg} ({n_fvg / max(n_all, 1) * 100:.1f}%)")

    std_fn      = lambda s: stop_standard(s, atr_mult)
    fvg_low_fn  = lambda s: stop_fvg(s, buf_mult)

    n_years = max((pd.Timestamp("today") - pd.Timestamp(start)).days / 365.25, 1)

    # ── Section A: TP sweep — FVG + FVG-LOW ───────────────────────────────
    _hdr(
        f"A — TP sweep  |  FVG signals  |  FVG-LOW stop (buf×{buf_mult})  "
        f"|  HTF={htf}  |  ATR×{atr_mult}",
        ["TP", "n", "win%", "avg_R", "total_R", "maxDD", "DD/n", "MCL", "ann_R"],
    )

    tp_results = []
    for tp_r in tp_sweep:
        st  = _run_subset(fvg_sigs, sym_df5, atr_mult, fvg_low_fn, tp_r)
        ann = round(st["total_r"] / n_years, 1)
        tp_results.append({"tp": tp_r, "ann_r": ann, **st})
        _row([f"{tp_r}R", st["n"], f"{st['win_pct']}%", f"{st['avg_r']:.4f}",
              f"{st['total_r']:.1f}", f"{st['max_dd']:.1f}",
              f"{st['dd_per_trade']:.3f}", st.get("mcl", "—"), f"{ann:.1f}"])

    best = max(tp_results, key=lambda x: x["total_r"])
    best_tp = best["tp"]
    print(f"\n  → Best TP by total_R: {best_tp}R  "
          f"(total={best['total_r']:.1f}  win={best['win_pct']}%  "
          f"maxDD={best['max_dd']:.1f}  ann={best['ann_r']:.1f}R/yr)")

    candidates = sorted(
        [r for r in tp_results if r["dd_per_trade"] < 0.08 and r["n"] >= 20],
        key=lambda x: x["ann_r"], reverse=True,
    )[:5]
    if candidates:
        print(f"\n  Top 5 by ann_R (DD/n < 0.08, n ≥ 20):")
        for r in candidates:
            print(f"    TP={r['tp']}R  ann={r['ann_r']:.1f}/yr  "
                  f"total={r['total_r']:.1f}  win={r['win_pct']}%  "
                  f"maxDD={r['max_dd']:.1f}  DD/n={r['dd_per_trade']:.3f}")

    best_safe_tp = candidates[0]["tp"] if candidates else best_tp

    # ── Section B: Year breakdown at best safe TP ─────────────────────────
    _hdr(
        f"B — Year breakdown  |  FVG + FVG-LOW  |  HTF={htf}  |  TP={best_safe_tp}R",
        ["year", "n", "win%", "avg_R", "total_R", "maxDD", "std_R", "R_saved"],
    )
    yr_fvg: dict[int, list] = defaultdict(list)
    yr_std: dict[int, list] = defaultdict(list)

    for s in fvg_sigs:
        rb   = risk_std(s, atr_mult)
        df5  = sym_df5[s["sym"]]
        sp_f = fvg_low_fn(s)
        sp_s = stop_standard(s, atr_mult)
        if sp_f is None:
            continue
        res_f = replay_fixed_risk(s, df5, sp_f, rb, best_safe_tp)
        res_s = replay_fixed_risk(s, df5, sp_s, rb, best_safe_tp)
        yr = s["year"]
        if res_f:
            yr_fvg[yr].append(res_f.pnl_r)
        if res_s:
            yr_std[yr].append(res_s.pnl_r)

    for yr in YEARS:
        rf = np.array(yr_fvg.get(yr, []))
        rs = np.array(yr_std.get(yr, []))
        saved = round(rf.sum() - rs.sum(), 2) if len(rf) and len(rs) else 0.0
        if len(rf) == 0:
            _row([yr, 0, "—", "—", "—", "—", "—", "—"])
        else:
            _row([yr, len(rf), f"{(rf > 0).mean()*100:.1f}%",
                  f"{rf.mean():.4f}", f"{rf.sum():.1f}",
                  f"{_max_dd(rf):.1f}",
                  f"{rs.sum():.1f}" if len(rs) else "—",
                  f"{saved:+.2f}"])

    # ── Section C: Per-symbol at best safe TP ────────────────────────────
    _hdr(
        f"C — Per-symbol  |  FVG + FVG-LOW vs STANDARD  |  HTF={htf}  |  TP={best_safe_tp}R",
        ["sym", "n_fvg", "fvg_win%", "fvg_R", "std_R", "R_delta", "fvg_DD", "DD_delta"],
    )
    for sym in SYMS:
        sub  = [s for s in fvg_sigs if s["sym"] == sym]
        st_f = _run_subset(sub, sym_df5, atr_mult, fvg_low_fn, best_safe_tp)
        st_s = _run_subset(sub, sym_df5, atr_mult, std_fn,     best_safe_tp)
        r_d  = round(st_f["total_r"] - st_s["total_r"], 2)
        dd_d = round(st_f["max_dd"]  - st_s["max_dd"],  2)
        _row([sym, len(sub), f"{st_f['win_pct']}%",
              f"{st_f['total_r']:.1f}", f"{st_s['total_r']:.1f}",
              f"{r_d:+.2f}", f"{st_f['max_dd']:.1f}", f"{dd_d:+.2f}"])

    # Return summary for cross-HTF comparison
    st_best_fvg = _run_subset(fvg_sigs, sym_df5, atr_mult, fvg_low_fn, best_safe_tp)
    st_best_std = _run_subset(fvg_sigs, sym_df5, atr_mult, std_fn,     best_safe_tp)
    return {
        "htf":       htf,
        "n_all":     n_all,
        "n_fvg":     n_fvg,
        "best_tp":   best_safe_tp,
        "fvg_win":   st_best_fvg["win_pct"],
        "fvg_total": st_best_fvg["total_r"],
        "fvg_dd":    st_best_fvg["max_dd"],
        "fvg_ann":   round(st_best_fvg["total_r"] / n_years, 1),
        "std_win":   st_best_std["win_pct"],
        "std_total": st_best_std["total_r"],
        "std_dd":    st_best_std["max_dd"],
    }


# ── Cross-HTF summary table ────────────────────────────────────────────────

def print_cross_htf(rows: list[dict]) -> None:
    print(f"\n{'='*72}")
    print("CROSS-HTF SUMMARY  |  FVG + FVG-LOW vs STANDARD  |  best safe TP")
    print(f"{'='*72}")
    hdr_cols = ["HTF", "n_all", "n_fvg", "best_TP",
                "fvg_win%", "fvg_R", "fvg_DD", "fvg_ann",
                "std_R", "std_DD"]
    print("  " + "  ".join(f"{c:>10}" for c in hdr_cols))
    print("  " + "-" * (12 * len(hdr_cols)))
    for r in rows:
        print("  " + "  ".join(f"{str(v):>10}" for v in [
            r["htf"], r["n_all"], r["n_fvg"], f"{r['best_tp']}R",
            f"{r['fvg_win']}%", f"{r['fvg_total']:.1f}",
            f"{r['fvg_dd']:.1f}", f"{r['fvg_ann']:.1f}R",
            f"{r['std_total']:.1f}", f"{r['std_dd']:.1f}",
        ]))


# ── Entry point ────────────────────────────────────────────────────────────

def _norm_htf(htf: str) -> str:
    """Normalise user-friendly HTF strings to pandas offset aliases."""
    _map = {"5m": "5min", "15m": "15min", "30m": "30min",
            "1h": "1h",   "4h": "4h",     "1d": "1D"}
    return _map.get(htf.lower(), htf)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db",        default=DEFAULT_DB)
    ap.add_argument("--htf",       nargs="+", default=["5m", "15m", "1h", "4h"],
                    help="HTF(s) to test: 5m 15m 1h 4h")
    ap.add_argument("--start",     default="2022-01-01")
    ap.add_argument("--atr-mult",  type=float, default=2.0)
    ap.add_argument("--vol-ratio", type=float, default=1.8)
    ap.add_argument("--body-pct",  type=float, default=0.55)
    ap.add_argument("--close-pct", type=float, default=0.15)
    ap.add_argument("--buf",       type=float, default=0.15)
    args = ap.parse_args()

    tp_sweep = [round(v * 0.25, 2) for v in range(6, 25)]  # 1.5 → 6.0

    print("=" * 72)
    print("Multi-Timeframe FVG + FVG-LOW stop — momentum short")
    print("=" * 72)
    print(f"HTFs    : {', '.join(args.htf)}")
    print(f"Filters : vol>{args.vol_ratio}  body>{args.body_pct}  "
          f"close<{args.close_pct}  ATR×{args.atr_mult}  buf×{args.buf}")
    print(f"Period  : {args.start} → latest")

    summary_rows = []
    for htf in args.htf:
        htf_norm = _norm_htf(htf)
        row = run_htf(
            db_path       = args.db,
            htf           = htf_norm,
            atr_mult      = args.atr_mult,
            vol_ratio_min = args.vol_ratio,
            body_pct_min  = args.body_pct,
            close_pct_max = args.close_pct,
            buf_mult      = args.buf,
            start         = args.start,
            tp_sweep      = tp_sweep,
        )
        summary_rows.append(row)

    print_cross_htf(summary_rows)

    # Save cross-HTF summary
    out = REPO_ROOT / "cache" / "mtf_fvg_summary.csv"
    out.parent.mkdir(exist_ok=True)
    pd.DataFrame(summary_rows).to_csv(out, index=False)
    print(f"\nSaved → {out}\n")


if __name__ == "__main__":
    main()
