#!/usr/bin/env python3
"""
FVG + Momentum Short Study
==========================

Does the momentum signal candle ALSO form a Bearish FVG?
If so, we get two things:
  1. A quality filter — do FVG-tagged signals have higher win rates?
  2. A tighter stop — use fvg_low (= high[i]) as the stop reference instead
     of entry + ATR×mult.  If price rallies back to fill the FVG, short thesis
     is invalidated → exit early with a smaller loss.

Bearish FVG at signal bar i:
  Condition : high[i] < low[i-2]
  FVG zone  : [high[i], low[i-2]]  — price gap above the entry region
  fvg_low   = high[i]   ← bottom of gap, nearest to entry
  fvg_high  = low[i-2]  ← top of gap, furthest from entry

Entry short at bar i+1 open (standard Rule 1).
Entry sits well BELOW fvg_low because the candle closed strongly bearish.

Stop modes (short):
  STANDARD  stop = entry + ATR × atr_mult        (established baseline)
  FVG-STOP  stop = fvg_low + ATR × fvg_buf_mult  (exits if FVG gets filled)

TP: fixed R multiples (sweep).

Sections:
  A. Signal quality: all mom-shorts vs FVG-only (standard stop, best TP)
  B. Stop mode comparison: standard vs FVG-stop for FVG-only trades (TP sweep)
  C. Year-by-year for the best combo
  D. Per-symbol summary

All 6 symbols, 2022→latest, 1h signals replayed on 5m candles.

Usage:
    python lab/study_fvg_momentum.py
    python lab/study_fvg_momentum.py --atr-mult 2.0 --tp-sweep 1.5 2.0 3.0
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

DEFAULT_DB = str(REPO_ROOT / "data" / "backtest.sqlite")
SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "LINKUSDT", "DOGEUSDT", "XRPUSDT"]
YEARS = [2022, 2023, 2024, 2025]


# ── Helpers ────────────────────────────────────────────────────────────────

def _max_dd(r: np.ndarray) -> float:
    if len(r) == 0:
        return 0.0
    c = np.cumsum(r)
    return float(np.max(np.maximum.accumulate(c) - c))


def _max_consec_loss(pnls: np.ndarray) -> int:
    best, cur = 0, 0
    for p in pnls:
        cur = cur + 1 if p < 0 else 0
        best = max(best, cur)
    return best


def _stats(pnls: list[float], label: str = "") -> dict:
    r = np.array(pnls, dtype=float)
    n = len(r)
    if n == 0:
        return dict(label=label, n=0, win_pct=0, avg_r=0,
                    total_r=0, max_dd=0, dd_per_trade=0, mcl=0)
    dd = _max_dd(r)
    return dict(
        label       = label,
        n           = n,
        win_pct     = round(float((r > 0).mean() * 100), 1),
        avg_r       = round(float(r.mean()), 4),
        total_r     = round(float(r.sum()), 2),
        max_dd      = round(dd, 2),
        dd_per_trade= round(dd / n, 4),
        mcl         = int(_max_consec_loss(r)),
    )


def _stats_from_results(results: list) -> dict:
    """
    Build stats from replay results and expose stop-hit diagnostics.
    """
    pnls = [float(r.pnl_r) for r in results]
    st = _stats(pnls)
    n = st["n"]
    sl_hits = sum(1 for r in results if getattr(r, "reason", "") == "SL")
    st["sl_hits"] = int(sl_hits)
    st["sl_hit_pct"] = round((sl_hits / n) * 100, 1) if n else 0.0
    return st


def _hdr(title: str, cols: list[str]) -> None:
    print(f"\n{'='*72}")
    print(title)
    print(f"{'='*72}")
    print("  " + "  ".join(f"{c:>10}" for c in cols))
    print("  " + "-" * (12 * len(cols)))


def _row(vals: list) -> None:
    print("  " + "  ".join(f"{str(v):>10}" for v in vals))


# ── Data prep ──────────────────────────────────────────────────────────────

def prepare_sym(
    db_path: str,
    sym: str,
    start: str = "2022-01-01",
) -> tuple[pd.DataFrame, pd.DataFrame]:
    from lab.core.db import load_merged_5m
    from lab.core.resample import resample_ohlcv
    from lab.core.regime import classify_regimes

    df5 = load_merged_5m(db_path, sym)
    df5 = df5.loc[df5.index >= pd.Timestamp(start, tz="UTC")]

    df1h = resample_ohlcv(df5, "1h").copy()
    df1h = classify_regimes(df1h, atr_period=14, atr_ma_period=50,
                            er_period=20, er_balanced_threshold=0.35)

    # Candle structure metrics
    rng = (df1h["high"] - df1h["low"]).replace(0, np.nan)
    df1h["close_pct"] = (df1h["close"] - df1h["low"]) / rng
    df1h["body_pct"]  = (df1h["close"] - df1h["open"]).abs() / rng
    df1h["vol_ratio"] = df1h["volume"] / df1h["volume"].rolling(20, min_periods=10).median()

    # Rolling quantile vol regime — balanced thirds
    atr_r = df1h["atr_ratio"]
    p67   = atr_r.rolling(200, min_periods=50).quantile(0.67)
    p33   = atr_r.rolling(200, min_periods=50).quantile(0.33)
    vol_q = np.where(atr_r >= p67, "HIGH",
            np.where(atr_r < p33,  "LOW", "MED")).astype(object)
    vol_q[p67.isna().values] = np.nan
    df1h["vol_q"] = vol_q

    return df5, df1h


# ── Signal collector ───────────────────────────────────────────────────────

def collect_signals(
    df1h: pd.DataFrame,
    sym: str,
    vol_ratio_min: float = 1.5,
    body_pct_min: float  = 0.55,
    close_pct_max: float = 0.20,
) -> list[dict]:
    """
    Collect momentum short signals AND tag each with FVG presence.

    FVG tag (bearish):
      Condition : high[i] < low[i-2]  — signal candle gapped below bar i-2
      Zone      : [high[i], low[i-2]]
      fvg_low   = high[i]   ← bottom of gap (= nearest resistance above entry)
      fvg_high  = low[i-2]  ← top of gap

    Requires i >= 2 (for FVG check). Signals at i < 2 are still collected
    with has_fvg=False.
    """
    hi_arr = df1h["high"].values
    lo_arr = df1h["low"].values
    n      = len(df1h)
    sigs   = []
    min_idx = 62  # warmup (60 for regime + 2 for FVG lookback)

    for i in range(min_idx, n - 1):
        row = df1h.iloc[i]

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

        entry_bar = df1h.iloc[i + 1]
        if pd.isna(entry_bar["open"]):
            continue

        entry_p = float(entry_bar["open"])
        atr_val = float(row["atr"])

        # ── FVG detection ──────────────────────────────────────────────────
        # Bearish FVG: high[i] < low[i-2]
        has_fvg  = False
        fvg_low  = np.nan   # high[i]    — bottom of gap, nearest to entry
        fvg_high = np.nan   # low[i-2]   — top of gap, furthest from entry
        gap_bps  = 0.0

        if hi_arr[i] < lo_arr[i - 2]:
            fvg_low_v  = float(hi_arr[i])
            fvg_high_v = float(lo_arr[i - 2])
            # Validate: stop must be above entry for a short
            if fvg_low_v > entry_p:
                gap_bps   = (fvg_high_v - fvg_low_v) / fvg_low_v * 10_000
                has_fvg   = True
                fvg_low   = fvg_low_v
                fvg_high  = fvg_high_v

        sigs.append({
            "ts":      df1h.index[i + 1],
            "year":    df1h.index[i + 1].year,
            "sym":     sym,
            "entry_p": entry_p,
            "atr":     atr_val,
            "has_fvg": has_fvg,
            "fvg_low": fvg_low,
            "fvg_high":fvg_high,
            "gap_bps": round(gap_bps, 1),
        })

    return sigs


# ── Replay helpers ─────────────────────────────────────────────────────────

def replay_standard(
    sig: dict,
    df5: pd.DataFrame,
    atr_mult: float,
    tp_r: float,
    fee_bps: float = 3.0,
) -> "ReplayResult | None":
    """Standard ATR stop active from entry: stop = entry + ATR × atr_mult."""
    from lab.sim.exit import replay_trade_5m
    from lab.sim.entry import tp_price_from_r

    entry_p = sig["entry_p"]
    stop    = entry_p + sig["atr"] * atr_mult
    risk    = stop - entry_p
    if risk <= 0:
        return None
    tp_p = tp_price_from_r(entry_p, risk, -1, tp_r)
    return replay_trade_5m(
        df5, sig["ts"], -1, entry_p, stop, tp_p, risk, fee_bps,
        be_trigger_r=None, be_offset_r=0.0, skip_entry_bucket_hours=0.0,
    )


def replay_fvg_stop(
    sig: dict,
    df5: pd.DataFrame,
    atr_mult: float,
    tp_r: float,
    decision_delay_hours: float = 1.0,
    fvg_buf_mult: float = 0.15,
    fee_bps: float = 3.0,
) -> "ReplayResult | None":
    """
    Two-phase stop for short trades with initial protection:
      1) Enter with standard stop active from entry:
           stop_init = entry + ATR * atr_mult
           tp_price  = derived from initial risk (initial-R accounting)
      2) At decision_delay_hours after entry, tighten stop (never loosen):
           stop_update = fvg_low + ATR * fvg_buf_mult
           stop_live   = min(stop_init, stop_update)

    SL/TP are always live from entry. Only the stop reference is updated later.
    TP stays unchanged.
    """
    from lab.sim.exit import ReplayResult
    from lab.sim.entry import tp_price_from_r

    if not sig["has_fvg"] or np.isnan(sig["fvg_low"]):
        return None
    entry_p = sig["entry_p"]
    stop_init = entry_p + sig["atr"] * atr_mult
    risk_init = stop_init - entry_p
    if risk_init <= 0:
        return None
    tp_p = tp_price_from_r(entry_p, risk_init, -1, tp_r)
    stop_update = sig["fvg_low"] + sig["atr"] * fvg_buf_mult
    stop_tight = min(stop_init, stop_update)  # short: lower stop = tighter

    if len(df5) == 0:
        return None
    d = df5.loc[df5.index >= pd.Timestamp(sig["ts"])]
    if len(d) == 0:
        return None

    update_ts = pd.Timestamp(sig["ts"]) + pd.Timedelta(hours=decision_delay_hours)
    fee_r = (entry_p * (fee_bps / 10_000.0)) / risk_init

    for i, (ts, row) in enumerate(d.iterrows()):
        h, lo = float(row["high"]), float(row["low"])
        stop_live = stop_tight if ts >= update_ts else stop_init
        # Rule 4: for shorts, stop is checked before TP.
        if h >= stop_live:
            return ReplayResult((entry_p - stop_live) / risk_init - fee_r, "SL", ts, i + 1)
        if lo <= tp_p:
            return ReplayResult((entry_p - tp_p) / risk_init - fee_r, "TP", ts, i + 1)

    return None


# ── Main ───────────────────────────────────────────────────────────────────

def main(
    db_path: str,
    symbols: list[str] | None = None,
    atr_mult: float      = 2.0,
    tp_sweep: list[float]= None,
    vol_ratio_min: float = 1.5,
    body_pct_min: float  = 0.55,
    close_pct_max: float = 0.20,
    fvg_buf_mult: float  = 0.15,
    decision_delay_hours: float = 1.0,
    start: str           = "2022-01-01",
) -> None:
    if symbols is None:
        symbols = SYMS
    if tp_sweep is None:
        tp_sweep = [1.5, 2.0, 3.0]

    # ── Load all symbols ──────────────────────────────────────────────────
    all_sigs: list[dict] = []
    sym_df5: dict[str, pd.DataFrame] = {}

    print(f"\nLoading {len(symbols)} symbols...")
    for sym in symbols:
        df5, df1h = prepare_sym(db_path, sym, start)
        sym_df5[sym] = df5
        sigs = collect_signals(
            df1h,
            sym,
            vol_ratio_min=vol_ratio_min,
            body_pct_min=body_pct_min,
            close_pct_max=close_pct_max,
        )
        n_fvg = sum(1 for s in sigs if s["has_fvg"])
        print(f"  {sym:<12}  {len(sigs):>3} signals  |  "
              f"{n_fvg:>3} FVG-tagged ({n_fvg/max(len(sigs),1)*100:.0f}%)")
        all_sigs.extend(sigs)

    n_total = len(all_sigs)
    n_fvg_total = sum(1 for s in all_sigs if s["has_fvg"])
    print(f"\n  TOTAL  {n_total} signals  |  "
          f"{n_fvg_total} FVG-tagged ({n_fvg_total/max(n_total,1)*100:.0f}%)")

    sigs_fvg    = [s for s in all_sigs if     s["has_fvg"]]
    sigs_no_fvg = [s for s in all_sigs if not s["has_fvg"]]

    # ── SECTION A: FVG as quality filter ─────────────────────────────────
    # Standard stop, best TP selected from sweep (by total R on ALL signals)
    tp_stats_standard_all: dict[float, dict] = {}
    for tp_r in tp_sweep:
        pnls = []
        for s in all_sigs:
            res = replay_standard(
                s,
                sym_df5[s["sym"]],
                atr_mult,
                tp_r,
            )
            if res:
                pnls.append(res.pnl_r)
        tp_stats_standard_all[tp_r] = _stats(pnls)

    DISPLAY_TP = max(
        tp_sweep,
        key=lambda tp: (tp_stats_standard_all[tp]["total_r"], tp_stats_standard_all[tp]["avg_r"]),
    )

    _hdr(f"A — FVG as signal filter  |  ATR×{atr_mult}, TP={DISPLAY_TP}R  (standard stop)",
         ["subset", "n", "win%", "avg_R", "total_R", "maxDD", "DD/n", "MCL"])

    for label, subset in [
        ("ALL",        all_sigs),
        ("FVG only",   sigs_fvg),
        ("No-FVG",     sigs_no_fvg),
    ]:
        pnls = []
        for s in subset:
            res = replay_standard(
                s,
                sym_df5[s["sym"]],
                atr_mult,
                DISPLAY_TP,
            )
            if res:
                pnls.append(res.pnl_r)
        st = _stats(pnls)
        _row([label, st["n"], f"{st['win_pct']}%", f"{st['avg_r']:.4f}",
              f"{st['total_r']:.1f}", f"{st['max_dd']:.1f}",
              f"{st['dd_per_trade']:.3f}", st["mcl"]])

    # ── SECTION B: Stop-mode comparison for FVG signals ──────────────────
    # TP sweep: standard ATR stop vs FVG zone stop
    _hdr(
        f"B — Stop mode × TP sweep  |  FVG signals only  "
        f"(ATR×{atr_mult} vs FVG-stop buf×{fvg_buf_mult}, update @ +{decision_delay_hours}h)",
        ["mode", "TP", "n", "win%", "SL_hits", "SL_%", "avg_R", "total_R", "maxDD", "DD/n"],
    )

    for tp_r in tp_sweep:
        # Standard stop
        res_std_list = []
        for s in sigs_fvg:
            res = replay_standard(
                s,
                sym_df5[s["sym"]],
                atr_mult,
                tp_r,
            )
            if res:
                res_std_list.append(res)
        st = _stats_from_results(res_std_list)
        _row(["STANDARD", f"{tp_r}R", st["n"], f"{st['win_pct']}%",
              st["sl_hits"], f"{st['sl_hit_pct']}%",
              f"{st['avg_r']:.4f}", f"{st['total_r']:.1f}",
              f"{st['max_dd']:.1f}", f"{st['dd_per_trade']:.3f}"])

        # FVG-zone stop
        res_fvg_list = []
        for s in sigs_fvg:
            res = replay_fvg_stop(
                s,
                sym_df5[s["sym"]],
                atr_mult,
                tp_r,
                decision_delay_hours=decision_delay_hours,
                fvg_buf_mult=fvg_buf_mult,
            )
            if res:
                res_fvg_list.append(res)
        st2 = _stats_from_results(res_fvg_list)
        _row(["FVG-STOP", f"{tp_r}R", st2["n"], f"{st2['win_pct']}%",
              st2["sl_hits"], f"{st2['sl_hit_pct']}%",
              f"{st2['avg_r']:.4f}", f"{st2['total_r']:.1f}",
              f"{st2['max_dd']:.1f}", f"{st2['dd_per_trade']:.3f}"])

        print()  # blank between TP groups

    # ── SECTION C: Gap size segmentation ─────────────────────────────────
    # Does gap magnitude predict trade quality?
    _hdr(
        f"C — FVG gap size buckets  |  ATR×{atr_mult}, TP={DISPLAY_TP}R  (standard stop)",
        ["gap_bps", "n", "win%", "avg_R", "total_R", "maxDD"],
    )

    gap_buckets = [
        ("small  (<10)", lambda s: s["gap_bps"] < 10),
        ("medium (10-30)", lambda s: 10 <= s["gap_bps"] < 30),
        ("large  (>=30)", lambda s: s["gap_bps"] >= 30),
    ]
    for blabel, bfn in gap_buckets:
        subset = [s for s in sigs_fvg if bfn(s)]
        pnls = []
        for s in subset:
            res = replay_standard(
                s,
                sym_df5[s["sym"]],
                atr_mult,
                DISPLAY_TP,
            )
            if res:
                pnls.append(res.pnl_r)
        st = _stats(pnls)
        _row([blabel, st["n"], f"{st['win_pct']}%", f"{st['avg_r']:.4f}",
              f"{st['total_r']:.1f}", f"{st['max_dd']:.1f}"])

    # ── SECTION D: Year-by-year for best combo ────────────────────────────
    _hdr(
        f"D — Year breakdown  |  FVG-only  |  STANDARD vs FVG-STOP  |  TP={DISPLAY_TP}R",
        ["year", "n", "std_win%", "std_R", "fvg_win%", "fvg_R"],
    )

    yr_std: dict[int, list[float]] = defaultdict(list)
    yr_fvg: dict[int, list[float]] = defaultdict(list)
    for s in sigs_fvg:
        df5 = sym_df5[s["sym"]]
        res_std = replay_standard(
            s,
            df5,
            atr_mult,
            DISPLAY_TP,
        )
        res_fvg = replay_fvg_stop(
            s,
            df5,
            atr_mult,
            DISPLAY_TP,
            decision_delay_hours=decision_delay_hours,
            fvg_buf_mult=fvg_buf_mult,
        )
        yr = s["year"]
        if res_std:
            yr_std[yr].append(res_std.pnl_r)
        if res_fvg:
            yr_fvg[yr].append(res_fvg.pnl_r)

    for yr in YEARS:
        rs = np.array(yr_std.get(yr, []))
        rf = np.array(yr_fvg.get(yr, []))
        sw = f"{(rs>0).mean()*100:.1f}%" if len(rs) else "—"
        fw = f"{(rf>0).mean()*100:.1f}%" if len(rf) else "—"
        _row([yr, f"std:{len(rs)}/fvg:{len(rf)}",
              sw, f"{rs.sum():.1f}R" if len(rs) else "—",
              fw, f"{rf.sum():.1f}R" if len(rf) else "—"])

    # ── SECTION E: Per-symbol summary ────────────────────────────────────
    _hdr(
        f"E — Per-symbol  |  FVG-only  |  STANDARD (ATR×{atr_mult})  vs  FVG-STOP  |  TP={DISPLAY_TP}R",
        ["sym", "n_fvg", "std_win%", "std_totR", "fvg_win%", "fvg_totR", "fvg_DD"],
    )

    for sym in symbols:
        subset = [s for s in sigs_fvg if s["sym"] == sym]
        p_std, p_fvg = [], []
        df5 = sym_df5[sym]
        for s in subset:
            r1 = replay_standard(
                s,
                df5,
                atr_mult,
                DISPLAY_TP,
            )
            r2 = replay_fvg_stop(
                s,
                df5,
                atr_mult,
                DISPLAY_TP,
                decision_delay_hours=decision_delay_hours,
                fvg_buf_mult=fvg_buf_mult,
            )
            if r1: p_std.append(r1.pnl_r)
            if r2: p_fvg.append(r2.pnl_r)
        st1 = _stats(p_std)
        st2 = _stats(p_fvg)
        _row([sym, len(subset),
              f"{st1['win_pct']}%", f"{st1['total_r']:.1f}",
              f"{st2['win_pct']}%", f"{st2['total_r']:.1f}",
              f"{st2['max_dd']:.1f}"])

    # ── Save ──────────────────────────────────────────────────────────────
    rows = []
    for tp_r in tp_sweep:
        for mode in ["standard", "fvg_stop"]:
            for subset_label, subset in [
                ("all",    all_sigs),
                ("fvg",    sigs_fvg),
                ("no_fvg", sigs_no_fvg),
            ]:
                if mode == "fvg_stop" and subset_label != "fvg":
                    continue  # FVG-stop only makes sense for FVG signals
                pnls = []
                for s in subset:
                    if mode == "standard":
                        res = replay_standard(
                            s,
                            sym_df5[s["sym"]],
                            atr_mult,
                            tp_r,
                        )
                    else:
                        res = replay_fvg_stop(
                            s,
                            sym_df5[s["sym"]],
                            atr_mult,
                            tp_r,
                            decision_delay_hours=decision_delay_hours,
                            fvg_buf_mult=fvg_buf_mult,
                        )
                    if res:
                        pnls.append(res.pnl_r)
                st = _stats(pnls)
                rows.append({"tp": tp_r, "mode": mode, "subset": subset_label, **st})

    out = REPO_ROOT / "cache" / "fvg_momentum_study.csv"
    out.parent.mkdir(exist_ok=True)
    pd.DataFrame(rows).to_csv(out, index=False)
    print(f"\nSaved → {out}\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db",          default=DEFAULT_DB)
    ap.add_argument("--symbols",     nargs="+", default=SYMS)
    ap.add_argument("--start",       default="2022-01-01")
    ap.add_argument("--atr-mult",    type=float, default=2.0)
    ap.add_argument("--tp-sweep",    nargs="+",  type=float, default=[1.5, 2.0, 3.0])
    ap.add_argument("--vol-ratio",   type=float, default=1.5)
    ap.add_argument("--body-pct",    type=float, default=0.55)
    ap.add_argument("--close-pct-max", type=float, default=0.20)
    ap.add_argument("--fvg-buf",     type=float, default=0.15,
                    help="ATR multiplier for buffer above fvg_low (FVG-stop mode)")
    ap.add_argument("--decision-delay-hours", type=float, default=1.0,
                    help="Keep initial SL/TP live from entry; tighten FVG stop after this many hours.")
    args = ap.parse_args()

    print("=" * 72)
    print("FVG + Momentum Short Study")
    print("Momentum signal candle × bearish FVG tag")
    print("=" * 72)

    main(
        db_path      = args.db,
        symbols      = args.symbols,
        atr_mult     = args.atr_mult,
        tp_sweep     = args.tp_sweep,
        vol_ratio_min= args.vol_ratio,
        body_pct_min = args.body_pct,
        close_pct_max= args.close_pct_max,
        fvg_buf_mult = args.fvg_buf,
        decision_delay_hours=args.decision_delay_hours,
        start        = args.start,
    )
