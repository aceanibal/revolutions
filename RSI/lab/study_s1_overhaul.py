#!/usr/bin/env python3
"""
S1 Overhaul Study — Lever 1 + Lever 2
========================================

Lever 1: Trailing stop lock at 3.5R → +1R (same mechanism as S4).
  When MFE hits 3.5R, stop moves to entry+1R. Trade exits at +1R if reversed,
  or continues to 12R TP if it keeps running.
  Target: recover ~428R from abandoned runners without touching signal/TP.

Lever 2: Regime filter — only fire S1 when asset is in an uptrend.
  Implementation: signal bar close must be above EMA(N) on 1h bars.
  Tests three EMA windows: 50, 100, 200 (1h periods).
  Target: suppress signals in bear-market years (2022, 2026 bled -94R / -20R).

Compares 4 variants per EMA choice:
  baseline  — current production (fixed SL/TP, no lock, no filter)
  L1        — lock 3.5R→+1R, no regime filter
  L2        — regime filter only, fixed SL/TP
  L1+L2     — both levers combined

Assets: all 11 in the DB with S1 signal history.
Output: cache/s1_overhaul_comparison.csv  +  printed report.

Rules followed: lab/sim/rules.py
  Rule 1:  signal at bar i close → entry at bar i+1 open (no look-ahead)
  Rule 11: same-bar lock activation via replay_trade_5m
  EMA filter uses bar i's EMA value (all lagged bars, no look-ahead)
"""
from __future__ import annotations

import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd

LAB_ROOT = Path(__file__).resolve().parent
REPO_ROOT = LAB_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from lab.study_fvg_momentum import DEFAULT_DB, prepare_sym
from lab.study_imbalanced_trend import collect_imbalanced_signals
from lab.sim.exit import replay_trade_5m
from lab.sim.entry import tp_price_from_r

# ── Config ────────────────────────────────────────────────────────────────────

START_UTC   = "2022-01-01"
FEE_BPS     = 3.0
ATR_MULT    = 2.0
TP_R        = 12.0
LOCK_TRIG_R = 3.5     # Lever 1: lock triggers when MFE hits this
LOCK_OFF_R  = 1.0     # Lever 1: stop moves to entry + this R

VOL_RATIO_MIN = 1.8
BODY_PCT_MIN  = 0.55
CLOSE_PCT_MAX = 0.15

# All 11 assets with confirmed S1 signal history
ALL_SYMS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "LINKUSDT", "DOGEUSDT", "XRPUSDT",
    "AVAXUSDT", "PAXGUSDT", "SUIUSDT", "ONDOUSDT", "TAOUSDT",
]

# Lever 2: EMA periods to test (1h bars)
EMA_WINDOWS = [50, 100, 200]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _max_dd(pnls: np.ndarray) -> float:
    if len(pnls) == 0:
        return 0.0
    cum  = np.cumsum(pnls)
    peak = np.maximum.accumulate(cum)
    return float((peak - cum).max())


def _mcl(pnls: np.ndarray) -> int:
    best, cur = 0, 0
    for p in pnls:
        cur = cur + 1 if p <= 0 else 0
        best = max(best, cur)
    return best


def _stats(pnls: np.ndarray, n_years: float) -> dict:
    if len(pnls) == 0:
        return dict(n=0, total_R=0.0, win_pct=0.0, avg_R=0.0,
                    maxDD=0.0, mcl=0, ann_R=0.0)
    return dict(
        n=len(pnls),
        total_R=round(float(pnls.sum()), 2),
        win_pct=round(float((pnls > 0).mean() * 100), 1),
        avg_R=round(float(pnls.mean()), 3),
        maxDD=round(_max_dd(pnls), 2),
        mcl=_mcl(pnls),
        ann_R=round(float(pnls.sum()) / n_years, 1),
    )


# ── Signal collection with EMA filter support ────────────────────────────────

def add_ema_columns(df1h: pd.DataFrame, windows: list[int]) -> pd.DataFrame:
    """Add EMA columns to df1h. No look-ahead: EMA at bar i uses bars 0..i."""
    df = df1h.copy()
    for w in windows:
        df[f"ema_{w}"] = df["close"].ewm(span=w, adjust=False).mean()
    return df


def collect_s1_signals(
    df1h: pd.DataFrame,
    sym: str,
    ema_filter: int | None = None,
) -> list[dict]:
    """
    Collect S1 long signals with optional EMA regime filter.

    ema_filter: if set, only include signals where close[i] > ema_{ema_filter}[i].
    No look-ahead: EMA is computed on bar i (the signal bar, already closed).
    """
    raw = collect_imbalanced_signals(
        df1h, sym,
        vol_ratio_min=VOL_RATIO_MIN,
        body_pct_min=BODY_PCT_MIN,
        close_pct_max=CLOSE_PCT_MAX,
    )
    sigs = []
    for s in raw:
        if s["side"] != 1:
            continue
        # EMA filter: find the signal bar row and check regime
        if ema_filter is not None:
            col = f"ema_{ema_filter}"
            if col not in df1h.columns:
                continue
            try:
                sig_bar = df1h.loc[df1h.index < s["ts"]].iloc[-1]  # bar i (already closed)
                if pd.isna(sig_bar[col]) or float(sig_bar["close"]) <= float(sig_bar[col]):
                    continue
            except (IndexError, KeyError):
                continue
        risk = s["atr"] * ATR_MULT
        if risk <= 0:
            continue
        sigs.append({
            "sym": sym,
            "ts":  s["ts"],
            "entry_p": s["entry_p"],
            "stop_p":  s["entry_p"] - risk,
            "risk":    risk,
        })
    return sigs


# ── Replay helpers ─────────────────────────────────────────────────────────────

def replay_sig(sig: dict, df5: pd.DataFrame, lock: bool) -> float | None:
    """Replay one signal. Returns managed_r or None."""
    tp_p = tp_price_from_r(sig["entry_p"], sig["risk"], 1, TP_R)
    res  = replay_trade_5m(
        df5, sig["ts"], 1, sig["entry_p"], sig["stop_p"], tp_p,
        sig["risk"], FEE_BPS,
        be_trigger_r=LOCK_TRIG_R if lock else None,
        be_offset_r =LOCK_OFF_R  if lock else 0.0,
        skip_entry_bucket_hours=0.0,
    )
    return res.pnl_r if res is not None else None


# ── Per-symbol runner ─────────────────────────────────────────────────────────

def run_sym(sym: str, db_path: str, n_years: float) -> dict:
    """Load one symbol, collect signals, replay all 4 variants × all EMA windows."""
    try:
        df5, df1h = prepare_sym(db_path, sym, START_UTC)
    except Exception as e:
        print(f"  {sym}: load error — {e}")
        return {}

    df1h = add_ema_columns(df1h, EMA_WINDOWS)

    results: dict = {"sym": sym}

    # Collect signals for each variant
    sigs_base = collect_s1_signals(df1h, sym, ema_filter=None)

    variant_sigs: dict[str, list] = {"baseline": sigs_base, "L1": sigs_base}
    for w in EMA_WINDOWS:
        filtered = collect_s1_signals(df1h, sym, ema_filter=w)
        variant_sigs[f"L2_ema{w}"]   = filtered
        variant_sigs[f"L1L2_ema{w}"] = filtered

    # Replay all variants
    for variant, sigs in variant_sigs.items():
        lock = variant.startswith("L1")
        pnls, years = [], []
        for s in sigs:
            r = replay_sig(s, df5, lock=lock)
            if r is not None:
                pnls.append(r)
                years.append(pd.Timestamp(s["ts"]).year)

        arr = np.array(pnls)
        st  = _stats(arr, n_years)
        st["years"] = years
        st["pnls"]  = pnls
        st["n_sigs_collected"] = len(sigs)
        results[variant] = st

    print(f"  {sym:12s}  base_n={len(sigs_base):4d}  "
          f"base_R={results['baseline']['total_R']:+7.1f}  "
          f"L1_R={results['L1']['total_R']:+7.1f}  "
          f"L1L2_ema200_R={results.get('L1L2_ema200', {}).get('total_R', 0):+7.1f}")
    return results


# ── Aggregation ───────────────────────────────────────────────────────────────

def aggregate(sym_results: list[dict], variant: str, n_years: float) -> dict:
    all_pnls = []
    for r in sym_results:
        if not r or variant not in r:
            continue
        all_pnls.extend(r[variant]["pnls"])
    arr = np.array(all_pnls)
    return _stats(arr, n_years)


def year_breakdown(sym_results: list[dict], variant: str) -> dict[int, dict]:
    yr_pnls: dict[int, list] = defaultdict(list)
    for r in sym_results:
        if not r or variant not in r:
            continue
        vd = r[variant]
        for p, y in zip(vd["pnls"], vd["years"]):
            yr_pnls[y].append(p)
    return {
        yr: {
            "n": len(pnls),
            "total_R": round(sum(pnls), 2),
            "win_pct": round(sum(1 for p in pnls if p > 0) / len(pnls) * 100, 1) if pnls else 0,
        }
        for yr, pnls in sorted(yr_pnls.items())
    }


# ── Lever 1 trade-level analysis ──────────────────────────────────────────────

def lever1_decomposition(sym_results: list[dict]) -> None:
    """How many trades did L1 rescue vs cap?"""
    rescued, capped = 0, 0
    rescued_r, capped_r_loss = 0.0, 0.0

    for r in sym_results:
        if not r:
            continue
        base_v = r.get("baseline", {})
        l1_v   = r.get("L1", {})
        for pb, pl in zip(base_v.get("pnls", []), l1_v.get("pnls", [])):
            delta = pl - pb
            if delta > 0.05:            # L1 rescued this trade
                rescued += 1
                rescued_r += delta
            elif delta < -0.05:         # L1 capped a winner early
                capped += 1
                capped_r_loss += abs(delta)

    print(f"\n  Lever 1 decomposition (across all assets):")
    print(f"    Trades rescued (L1 exit > baseline): {rescued}  recovered_R=+{rescued_r:.1f}")
    print(f"    Trades capped  (L1 exit < baseline): {capped}   lost_R=-{capped_r_loss:.1f}")
    print(f"    Net R impact of L1: {rescued_r - capped_r_loss:+.1f}R")


# ── Print helpers ─────────────────────────────────────────────────────────────

def print_section(title: str) -> None:
    print(f"\n{'='*76}")
    print(f"  {title}")
    print('='*76)


def print_variant_row(label: str, st: dict) -> None:
    print(f"  {label:20s}  n={st['n']:5d}  total_R={st['total_R']:+8.1f}  "
          f"win%={st['win_pct']:5.1f}%  maxDD={st['maxDD']:6.1f}  "
          f"mcl={st['mcl']:3d}  ann_R={st['ann_R']:+7.1f}")


def print_year_row(yr: int, variants: dict[str, dict]) -> None:
    parts = [f"  {yr}"]
    for label, yd in variants.items():
        parts.append(f"  {label:18s} n={yd['n']:4d} R={yd['total_R']:+7.1f} w%={yd['win_pct']:4.1f}")
    print(" | ".join(parts))


# ── Main ──────────────────────────────────────────────────────────────────────

def main(db_path: str = DEFAULT_DB) -> None:
    n_years = max(
        (pd.Timestamp("today") - pd.Timestamp(START_UTC)).days / 365.25, 1
    )

    print(f"\nS1 OVERHAUL STUDY — Lever 1 (3.5R→+1R lock) + Lever 2 (EMA regime filter)")
    print(f"Assets: {ALL_SYMS}")
    print(f"Period: {START_UTC} → latest  ({n_years:.1f} years)")
    print(f"L1 lock: trig={LOCK_TRIG_R}R → lock={LOCK_OFF_R}R")
    print(f"L2 EMA windows tested: {EMA_WINDOWS} (1h periods)")
    print(f"\nLoading and replaying ...\n")

    sym_results = []
    with ThreadPoolExecutor(max_workers=4) as ex:
        futures = {ex.submit(run_sym, sym, db_path, n_years): sym for sym in ALL_SYMS}
        for fut in as_completed(futures):
            sym_results.append(fut.result())

    # ── Section 1: Portfolio totals for each variant ─────────────────────────
    print_section("1 — PORTFOLIO TOTALS: all 11 assets combined")
    variants_to_show = ["baseline", "L1", "L2_ema50", "L2_ema100", "L2_ema200",
                        "L1L2_ema50", "L1L2_ema100", "L1L2_ema200"]
    for v in variants_to_show:
        st = aggregate(sym_results, v, n_years)
        base_total = aggregate(sym_results, "baseline", n_years)["total_R"]
        delta = st["total_R"] - base_total
        label = v
        print_variant_row(f"{label} (Δ{delta:+.0f}R)", st)

    # ── Section 2: maxDD improvement focus ───────────────────────────────────
    print_section("2 — maxDD COMPARISON (key metric for risk management)")
    base_dd = aggregate(sym_results, "baseline", n_years)["maxDD"]
    print(f"  {'variant':20s}  {'maxDD':>8}  {'DD_reduction':>13}  {'total_R':>9}  {'R_change':>9}")
    for v in variants_to_show:
        st  = aggregate(sym_results, v, n_years)
        dd_red = base_dd - st["maxDD"]
        r_ch   = st["total_R"] - aggregate(sym_results, "baseline", n_years)["total_R"]
        print(f"  {v:20s}  {st['maxDD']:8.1f}  {dd_red:+12.1f}R  {st['total_R']:+9.1f}  {r_ch:+9.1f}R")

    # ── Section 3: Per-asset breakdown for best combined variant ─────────────
    best_variant = "L1L2_ema200"
    print_section(f"3 — PER-ASSET: baseline vs {best_variant}")
    print(f"  {'sym':12s}  {'base_n':>7}  {'base_R':>8}  {'base_DD':>8}  "
          f"  {'new_n':>6}  {'new_R':>8}  {'new_DD':>8}  {'ΔR':>8}  {'ΔDD':>8}")
    for r in sorted(sym_results, key=lambda x: x.get("baseline", {}).get("total_R", 0)):
        if not r:
            continue
        b  = r.get("baseline", {})
        nw = r.get(best_variant, {})
        sym = r["sym"]
        delta_r  = nw.get("total_R", 0) - b.get("total_R", 0)
        delta_dd = nw.get("maxDD",   0) - b.get("maxDD",   0)
        print(f"  {sym:12s}  {b.get('n',0):7d}  {b.get('total_R',0):+8.1f}  {b.get('maxDD',0):8.1f}  "
              f"  {nw.get('n',0):6d}  {nw.get('total_R',0):+8.1f}  {nw.get('maxDD',0):8.1f}  "
              f"{delta_r:+8.1f}  {delta_dd:+8.1f}")

    # ── Section 4: Year-by-year for key variants ──────────────────────────────
    print_section("4 — YEAR BREAKDOWN: baseline vs L1 vs L1+L2_ema200")
    key_variants = ["baseline", "L1", "L1L2_ema200"]
    yr_data = {v: year_breakdown(sym_results, v) for v in key_variants}
    all_years = sorted(set(y for yd in yr_data.values() for y in yd))

    hdr = f"  {'year':>5}"
    for v in key_variants:
        hdr += f"  {v:>14}  {'n':>4}  {'win%':>5}"
    print(hdr)
    for yr in all_years:
        row = f"  {yr:>5}"
        for v in key_variants:
            yd = yr_data[v].get(yr, {"n": 0, "total_R": 0.0, "win_pct": 0.0})
            row += f"  {yd['total_R']:+14.1f}  {yd['n']:>4}  {yd['win_pct']:>5.1f}%"
        print(row)

    # ── Section 5: L1 trade decomposition ─────────────────────────────────────
    print_section("5 — LEVER 1 DECOMPOSITION: rescued vs capped trades")
    lever1_decomposition(sym_results)

    # ── Section 6: L2 signal filter impact (how many signals dropped per year) ─
    print_section("6 — LEVER 2 FILTER IMPACT: signals dropped by EMA regime gate")
    for ema_w in EMA_WINDOWS:
        base_n  = sum(r.get("baseline", {}).get("n", 0) for r in sym_results if r)
        filt_n  = sum(r.get(f"L2_ema{ema_w}", {}).get("n", 0) for r in sym_results if r)
        dropped = base_n - filt_n
        # How much R did we drop (was it bad R)?
        base_r = aggregate(sym_results, "baseline", n_years)["total_R"]
        filt_r = aggregate(sym_results, f"L2_ema{ema_w}", n_years)["total_R"]
        print(f"\n  EMA({ema_w}) filter:")
        print(f"    Signals kept: {filt_n}/{base_n}  dropped: {dropped} ({dropped/max(base_n,1)*100:.0f}%)")
        print(f"    baseline_total_R={base_r:+.1f}  filtered_total_R={filt_r:+.1f}  delta={filt_r-base_r:+.1f}R")

    # ── Section 7: Best combined config summary ───────────────────────────────
    print_section("7 — EFFICIENCY RATIO: R gained per DD-unit saved")
    base_st = aggregate(sym_results, "baseline", n_years)
    print(f"\n  {'variant':22s}  {'ΔR':>8}  {'ΔmaxDD':>9}  {'R/DD_unit':>10}  note")
    for v in ["L1", "L2_ema200", "L1L2_ema200"]:
        st     = aggregate(sym_results, v, n_years)
        delta_r  = st["total_R"]  - base_st["total_R"]
        delta_dd = st["maxDD"]    - base_st["maxDD"]
        if delta_dd < -0.1:
            ratio = delta_r / abs(delta_dd)
            note  = f"{ratio:+.2f}R per 1R of DD reduction"
        elif delta_r > 0:
            note  = "DD unchanged but R improved"
        else:
            note  = "both R and DD changed positively" if delta_dd > 0 else "neutral"
        print(f"  {v:22s}  {delta_r:+8.1f}  {delta_dd:+9.1f}  {note}")

    # ── Save CSV ──────────────────────────────────────────────────────────────
    rows_out = []
    for r in sym_results:
        if not r:
            continue
        for v in variants_to_show:
            if v not in r:
                continue
            st = r[v]
            rows_out.append(dict(
                sym=r["sym"], variant=v,
                n=st["n"], total_R=st["total_R"], win_pct=st["win_pct"],
                maxDD=st["maxDD"], mcl=st["mcl"], ann_R=st["ann_R"],
            ))
    out_path = REPO_ROOT / "cache" / "s1_overhaul_comparison.csv"
    pd.DataFrame(rows_out).to_csv(out_path, index=False)
    print(f"\n  Saved → {out_path}")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DEFAULT_DB)
    args = ap.parse_args()
    main(args.db)
