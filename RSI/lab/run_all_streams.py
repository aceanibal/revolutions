#!/usr/bin/env python3
"""
run_all_streams.py — Locked, single-TP master runner for S1-S4.

Runs every confirmed live stream on all available 5m/1h data with fully
locked parameters (no sweeps, no optional flags) and emits an immutable
run folder following memory/run_definition.md:

    runs/run_all_streams_<UTC_STAMP>/
        run_config.json                     # every config variable captured
        trades/
            trades_all.csv                  # one row per executed trade (all streams)
        artifacts/
            summary_total.csv               # portfolio-level totals
            summary_by_stream.csv           # per-stream totals
            summary_by_year.csv             # exit-year × portfolio
            summary_by_stream_year.csv      # exit-year × stream
            summary_by_asset.csv            # symbol × portfolio
            summary_by_stream_asset.csv     # symbol × stream
            saved_r_by_stream.csv           # managed vs baseline deltas
            mfe_buckets_by_stream.csv       # win/R by MFE reached
            exit_reason_by_stream.csv       # SL / BE / TP mix
            equity_by_stream.csv            # running cum-R per stream
        report.md                           # readable overview

Configs are sourced from CLAUDE.md "Confirmed Live Streams" and match
lab/run_portfolio.py exactly. One TP per stream. No TP sweeps.

Each trade is replayed TWICE:
    managed  = current stream rules (S4 BE-lock, S1/S2/S3 fixed)
    baseline = same entry, fixed stop, no management

saved_r = managed_r - baseline_r  (how much R the stop-management rules
rescued from losers or captured from reversals).

MFE (max favorable excursion in R) is measured independently from the 5m
bars between entry and the managed exit so we can bucket win-rates by how
far the trade ran before the managed exit fired.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

LAB_ROOT = Path(__file__).resolve().parent
REPO_ROOT = LAB_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from lab.study_fvg_momentum import DEFAULT_DB, SYMS, prepare_sym, collect_signals as _collect_s2_signals  # noqa: E402
from lab.study_imbalanced_trend import collect_imbalanced_signals  # noqa: E402
from lab.study_swing_low_sweep import collect_sweep_signals  # noqa: E402
from lab.study_order_blocks import stop_fvg, risk_std  # noqa: E402
from lab.sim.entry import tp_price_from_r  # noqa: E402
from lab.sim.exit import replay_trade_5m  # noqa: E402


# ────────────────────────────────────────────────────────────────────────────
# Locked configuration. Every value is intentional. Do not parameterise.
# Source: CLAUDE.md "Confirmed Live Streams" and memory/project_live_streams.md.
# ────────────────────────────────────────────────────────────────────────────

FEE_BPS = 3.0
START_UTC = "2022-01-01"

# All streams run on the full 6-symbol universe.
SX_SYMS = tuple(SYMS)

# S1 — IMBAL+HIGH Long bullish momentum continuation (fat-tail trend capture).
# Signal: collect_imbalanced_signals long side (side=+1):
#   structure=IMBALANCED, vol_q=HIGH, bullish candle with body_pct>0.55,
#   close_pct>1-close_pct_max (close near high), vol_ratio>1.8.
# Stop: ATR×2.0 fixed (no MFE ladder, no lock).
# TP:   12R — captures the fat right tail of trending bull moves.
# Reference: 778 signals / 12.1% win / +433R / ann≈101R/yr / maxDD≈70R.
S1 = dict(
    regime="IMBALANCED+HIGH long, bullish momentum continuation",
    vol_ratio_min=1.8, body_pct_min=0.55, close_pct_max=0.15,
    atr_mult=2.0,
    tp_r=12.0,
)

# S2 — BAL+HIGH Short, bearish momentum, ATR stop, NO FVG.
# Canonical: lab/sweep_shorts_filtered.py / lab/study_fvg_momentum.py
# (same BAL+HIGH bearish momentum filter; S2 ignores has_fvg flag).
S2 = dict(
    regime="BALANCED+HIGH short, momentum (no FVG)",
    vol_ratio_min=1.5, body_pct_min=0.55, close_pct_max=0.20,
    atr_mult=1.5,
    tp_r=3.0,
)

# S3 — BAL+HIGH Short with FVG filter, FVG-LOW stop, fixed.
# Canonical: lab/study_fvg_lock_sweep.py baseline.
S3 = dict(
    regime="BALANCED+HIGH short, FVG filter + FVG-LOW stop",
    vol_ratio_min=1.8, body_pct_min=0.55, close_pct_max=0.15,
    atr_mult=2.0,         # R basis for TP and R accounting (stop is FVG-LOW)
    buf_mult=0.15,        # FVG stop buffer
    tp_r=4.25,
)

# S4 — BAL+HIGH Swing Low Long, single-trigger lock
S4 = dict(
    regime="BALANCED+HIGH long, equal-lows sweep",
    lookback=50, tolerance=0.005, min_swing=5,
    rejection_min=0.90,
    atr_mult=2.0,
    trig_r=3.5,
    lock_r=1.0,
    tp_r=19.5,
)

LOCKED_CONFIG = dict(
    start_utc=START_UTC,
    fee_bps=FEE_BPS,
    symbols=list(SX_SYMS),
    s1=S1,
    s2=S2,
    s3=S3,
    s4=S4,
)


# ────────────────────────────────────────────────────────────────────────────
# Signal collectors. Each returns a list of stream-tagged signal dicts.
# ────────────────────────────────────────────────────────────────────────────

def _collect_s1(df1h: pd.DataFrame, sym: str) -> list[dict]:
    """IMBAL+HIGH bullish momentum continuation (long side of collect_imbalanced_signals)."""
    raw = collect_imbalanced_signals(
        df1h, sym,
        vol_ratio_min=S1["vol_ratio_min"],
        body_pct_min=S1["body_pct_min"],
        close_pct_max=S1["close_pct_max"],
    )
    sigs: list[dict] = []
    for s in raw:
        if s["side"] != 1:
            continue
        entry_p = s["entry_p"]
        risk = s["atr"] * S1["atr_mult"]
        if risk <= 0:
            continue
        stop_p = entry_p - risk
        sigs.append(dict(
            stream="S1", sym=sym, side=1,
            ts=s["ts"], entry_p=entry_p,
            stop_p=stop_p, risk=risk, tp_r=S1["tp_r"],
        ))
    return sigs


def _collect_s2(df1h: pd.DataFrame, sym: str) -> list[dict]:
    """BAL+HIGH bearish momentum short — no FVG filter, ATR x1.5 stop, TP=3R."""
    raw = _collect_s2_signals(
        df1h, sym,
        vol_ratio_min=S2["vol_ratio_min"],
        body_pct_min=S2["body_pct_min"],
        close_pct_max=S2["close_pct_max"],
    )
    sigs: list[dict] = []
    for s in raw:
        entry_p = s["entry_p"]
        risk = s["atr"] * S2["atr_mult"]
        if risk <= 0:
            continue
        stop_p = entry_p + risk
        sigs.append(dict(
            stream="S2", sym=sym, side=-1,
            ts=s["ts"], entry_p=entry_p,
            stop_p=stop_p, risk=risk, tp_r=S2["tp_r"],
        ))
    return sigs


def _collect_s3(df1h: pd.DataFrame, sym: str) -> list[dict]:
    """BAL+HIGH bearish momentum short with FVG filter + FVG-LOW stop, TP=4.25R."""
    raw = _collect_s2_signals(
        df1h, sym,
        vol_ratio_min=S3["vol_ratio_min"],
        body_pct_min=S3["body_pct_min"],
        close_pct_max=S3["close_pct_max"],
    )
    sigs: list[dict] = []
    for s in raw:
        if not s.get("has_fvg"):
            continue
        stop_p = stop_fvg(s, S3["buf_mult"])
        if stop_p is None:
            continue
        risk = risk_std(s, S3["atr_mult"])   # R basis = ATR x 2.0
        if risk <= 0 or stop_p <= s["entry_p"]:
            continue
        sigs.append(dict(
            stream="S3", sym=sym, side=-1,
            ts=s["ts"], entry_p=s["entry_p"],
            stop_p=stop_p, risk=risk, tp_r=S3["tp_r"],
        ))
    return sigs


def _collect_s4(df1h: pd.DataFrame, sym: str) -> list[dict]:
    raw = collect_sweep_signals(
        df1h, sym,
        lookback=S4["lookback"],
        tolerance=S4["tolerance"],
        min_swing=S4["min_swing"],
        rejection_min=S4["rejection_min"],
    )
    sigs: list[dict] = []
    for s in raw:
        if s.get("structure") != "BALANCED" or s.get("vol_q") != "HIGH":
            continue
        risk = s["atr"] * S4["atr_mult"]
        if risk <= 0:
            continue
        stop_p = s["entry_p"] - risk
        sigs.append(dict(
            stream="S4", sym=sym, side=1,
            ts=s["ts"], entry_p=s["entry_p"],
            stop_p=stop_p, risk=risk, tp_r=S4["tp_r"],
        ))
    return sigs


# ────────────────────────────────────────────────────────────────────────────
# Replay: managed + baseline + MFE capture.
# ────────────────────────────────────────────────────────────────────────────

@dataclass
class ManagedResult:
    pnl_r: float
    reason: str
    exit_ts: pd.Timestamp
    bars: int


def _replay_managed(sig: dict, df5: pd.DataFrame) -> ManagedResult | None:
    entry_p, stop_p, risk = sig["entry_p"], sig["stop_p"], sig["risk"]
    tp_r, side = sig["tp_r"], sig["side"]
    tp_p = tp_price_from_r(entry_p, risk, side, tp_r)
    stream = sig["stream"]

    if stream == "S4":
        res = replay_trade_5m(
            df5, sig["ts"], side, entry_p, stop_p, tp_p,
            risk, FEE_BPS,
            be_trigger_r=S4["trig_r"], be_offset_r=S4["lock_r"],
            skip_entry_bucket_hours=0.0,
        )
    else:  # S1, S2, S3 — fixed SL/TP, no stop management
        res = replay_trade_5m(
            df5, sig["ts"], side, entry_p, stop_p, tp_p,
            risk, FEE_BPS, be_trigger_r=None, be_offset_r=0.0,
            skip_entry_bucket_hours=0.0,
        )
    if res is None:
        return None
    return ManagedResult(res.pnl_r, res.reason, res.exit_ts, res.bars)


def _replay_baseline(sig: dict, df5: pd.DataFrame) -> ManagedResult | None:
    """Same trade, fixed stop, no management. Used to measure saved-R."""
    entry_p, stop_p, risk = sig["entry_p"], sig["stop_p"], sig["risk"]
    tp_p = tp_price_from_r(entry_p, risk, sig["side"], sig["tp_r"])
    res = replay_trade_5m(
        df5, sig["ts"], sig["side"], entry_p, stop_p, tp_p,
        risk, FEE_BPS, be_trigger_r=None, be_offset_r=0.0,
        skip_entry_bucket_hours=0.0,
    )
    if res is None:
        return None
    return ManagedResult(res.pnl_r, res.reason, res.exit_ts, res.bars)


def _mfe_until_exit(df5: pd.DataFrame, sig: dict, exit_ts: pd.Timestamp) -> float:
    """Max favorable excursion in R between entry and managed exit (inclusive)."""
    if len(df5) == 0:
        return 0.0
    d = df5.loc[(df5.index >= sig["ts"]) & (df5.index <= exit_ts)]
    if len(d) == 0:
        return 0.0
    risk = sig["risk"]
    if risk <= 0:
        return 0.0
    if sig["side"] == 1:
        peak = float(d["high"].max())
        return (peak - sig["entry_p"]) / risk
    else:
        trough = float(d["low"].min())
        return (sig["entry_p"] - trough) / risk


def _replay_one(sig: dict, df5: pd.DataFrame) -> dict | None:
    m = _replay_managed(sig, df5)
    if m is None:
        return None
    b = _replay_baseline(sig, df5)
    mfe_r = _mfe_until_exit(df5, sig, m.exit_ts)

    duration_h = (pd.Timestamp(m.exit_ts) - pd.Timestamp(sig["ts"])).total_seconds() / 3600.0
    return dict(
        stream=sig["stream"],
        sym=sig["sym"],
        side=sig["side"],
        entry_ts_utc=pd.Timestamp(sig["ts"]).isoformat(),
        exit_ts_utc=pd.Timestamp(m.exit_ts).isoformat(),
        year=pd.Timestamp(m.exit_ts).year,
        entry_price=round(sig["entry_p"], 8),
        stop_init=round(sig["stop_p"], 8),
        tp_price=round(tp_price_from_r(sig["entry_p"], sig["risk"], sig["side"], sig["tp_r"]), 8),
        risk=round(sig["risk"], 8),
        tp_r=sig["tp_r"],
        managed_r=round(m.pnl_r, 6),
        baseline_r=round(b.pnl_r if b else m.pnl_r, 6),
        saved_r=round((m.pnl_r - (b.pnl_r if b else m.pnl_r)), 6),
        managed_reason=m.reason,
        bars_5m=m.bars,
        duration_h=round(duration_h, 2),
        mfe_r=round(mfe_r, 4),
    )


# ────────────────────────────────────────────────────────────────────────────
# Stats builders.
# ────────────────────────────────────────────────────────────────────────────

def _max_dd(pnls: np.ndarray) -> float:
    if len(pnls) == 0:
        return 0.0
    cum = np.cumsum(pnls)
    peak = np.maximum.accumulate(cum)
    return float((peak - cum).max())


def _mcl(pnls: np.ndarray) -> int:
    best, cur = 0, 0
    for p in pnls:
        cur = cur + 1 if p <= 0 else 0
        if cur > best:
            best = cur
    return best


def _agg(df: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    rows = []
    if df.empty:
        return pd.DataFrame()
    grp = df.groupby(keys) if keys else [((), df)]
    for keyvals, sub in grp:
        if not isinstance(keyvals, tuple):
            keyvals = (keyvals,)
        arr_m = sub["managed_r"].to_numpy()
        arr_b = sub["baseline_r"].to_numpy()
        n = len(arr_m)
        rec: dict = {k: v for k, v in zip(keys, keyvals)}
        rec.update(dict(
            n_trades=n,
            win_pct=round(float((arr_m > 0).mean() * 100), 2),
            avg_r=round(float(arr_m.mean()), 4),
            median_r=round(float(np.median(arr_m)), 4),
            total_r=round(float(arr_m.sum()), 2),
            best_r=round(float(arr_m.max()), 2),
            worst_r=round(float(arr_m.min()), 2),
            maxDD_r=round(_max_dd(arr_m), 2),
            mcl=_mcl(arr_m),
            baseline_total_r=round(float(arr_b.sum()), 2),
            saved_r=round(float((arr_m - arr_b).sum()), 2),
            sl_hits=int((sub["managed_reason"] == "SL").sum()),
            be_hits=int((sub["managed_reason"] == "BE").sum()),
            tp_hits=int((sub["managed_reason"] == "TP").sum()),
        ))
        rows.append(rec)
    return pd.DataFrame(rows)


def _saved_r_detail(df: pd.DataFrame) -> pd.DataFrame:
    """Decompose how managed rules rescued losers vs captured reversals."""
    if df.empty:
        return pd.DataFrame()
    rows = []
    for stream, sub in df.groupby("stream"):
        dm = sub["managed_r"].to_numpy()
        db = sub["baseline_r"].to_numpy()
        diff = dm - db
        rows.append(dict(
            stream=stream,
            n_trades=len(dm),
            baseline_total_r=round(float(db.sum()), 2),
            managed_total_r=round(float(dm.sum()), 2),
            saved_r=round(float(diff.sum()), 2),
            saved_per_trade=round(float(diff.mean()), 4),
            n_improved=int((diff > 1e-9).sum()),
            n_worse=int((diff < -1e-9).sum()),
            n_unchanged=int((np.abs(diff) <= 1e-9).sum()),
            avg_save_improved=round(float(diff[diff > 1e-9].mean()) if (diff > 1e-9).any() else 0.0, 4),
            avg_hurt_worse=round(float(diff[diff < -1e-9].mean()) if (diff < -1e-9).any() else 0.0, 4),
            baseline_win_pct=round(float((db > 0).mean() * 100), 2),
            managed_win_pct=round(float((dm > 0).mean() * 100), 2),
        ))
    return pd.DataFrame(rows)


# Per-stream MFE buckets.
# Bucket edges chosen to probe lock behaviour and TP interaction:
#   S4 trigger at 3.5R, S2 TP at 3R, S3 TP at 4.25R, S1 TP at 12R, S4 TP at 19.5R
MFE_EDGES = [-np.inf, 0.0, 1.0, 2.0, 3.5, 6.5, 10.0, np.inf]
MFE_LABELS = ["<=0R", "0-1R", "1-2R", "2-3.5R", "3.5-6.5R", "6.5-10R", ">10R"]


def _mfe_buckets(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame()
    out_rows = []
    bucket = pd.cut(df["mfe_r"], bins=MFE_EDGES, labels=MFE_LABELS, include_lowest=True)
    tmp = df.assign(mfe_bucket=bucket)
    for (stream, b), sub in tmp.groupby(["stream", "mfe_bucket"], observed=True):
        arr = sub["managed_r"].to_numpy()
        if len(arr) == 0:
            continue
        out_rows.append(dict(
            stream=stream,
            mfe_bucket=str(b),
            n_trades=len(arr),
            win_pct=round(float((arr > 0).mean() * 100), 2),
            avg_r=round(float(arr.mean()), 4),
            total_r=round(float(arr.sum()), 2),
            tp_hits=int((sub["managed_reason"] == "TP").sum()),
            be_hits=int((sub["managed_reason"] == "BE").sum()),
            sl_hits=int((sub["managed_reason"] == "SL").sum()),
        ))
    return pd.DataFrame(out_rows).sort_values(["stream", "mfe_bucket"])


def _exit_reason_mix(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame()
    rows = []
    for (stream, reason), sub in df.groupby(["stream", "managed_reason"]):
        arr = sub["managed_r"].to_numpy()
        rows.append(dict(
            stream=stream, reason=reason,
            n=len(arr),
            pct_of_stream=None,  # fill below
            avg_r=round(float(arr.mean()), 4),
            total_r=round(float(arr.sum()), 2),
        ))
    out = pd.DataFrame(rows)
    if out.empty:
        return out
    totals = out.groupby("stream")["n"].transform("sum")
    out["pct_of_stream"] = (out["n"] / totals * 100).round(2)
    return out.sort_values(["stream", "reason"])


def _equity_by_stream(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame()
    df = df.sort_values(["stream", "exit_ts_utc"]).copy()
    df["cum_r"] = df.groupby("stream")["managed_r"].cumsum().round(4)
    return df[["stream", "sym", "exit_ts_utc", "managed_r", "cum_r"]]


# ────────────────────────────────────────────────────────────────────────────
# Main.
# ────────────────────────────────────────────────────────────────────────────

def _print_table(df: pd.DataFrame, title: str) -> None:
    print(f"\n  {title}")
    print("  " + "-" * max(len(title), 40))
    if df.empty:
        print("  (no rows)")
        return
    with pd.option_context("display.max_rows", None, "display.width", 220,
                           "display.max_columns", None):
        print(df.to_string(index=False))


def main(db_path: str, out_root: str) -> None:
    db_path = str(Path(db_path).resolve())
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = f"run_all_streams_{stamp}"
    run_dir = Path(out_root) / run_id
    (run_dir / "trades").mkdir(parents=True, exist_ok=True)
    (run_dir / "artifacts").mkdir(parents=True, exist_ok=True)

    print(f"\n{'=' * 72}")
    print(f"  RUN_ALL_STREAMS   {run_id}")
    print(f"{'=' * 72}")
    print(f"  db:       {db_path}")
    print(f"  start:    {START_UTC}")
    print(f"  out:      {run_dir}")
    print(f"  symbols:  {', '.join(SX_SYMS)}")
    print(f"  fee_bps:  {FEE_BPS}")

    # ── Data load ───────────────────────────────────────────────────────
    print(f"\n  Loading 5m/1h data for {len(SX_SYMS)} symbols…")
    sym_df5: dict[str, pd.DataFrame] = {}
    sym_df1h: dict[str, pd.DataFrame] = {}
    for sym in SX_SYMS:
        df5, df1h = prepare_sym(db_path, sym, START_UTC)
        sym_df5[sym] = df5
        sym_df1h[sym] = df1h
        print(f"    {sym:<10}  5m={len(df5):>7}  1h={len(df1h):>6}")

    # ── Signal collection ──────────────────────────────────────────────
    print(f"\n  Collecting signals…")
    all_sigs: list[dict] = []
    per_stream_counts: dict[str, int] = defaultdict(int)
    for sym in SX_SYMS:
        s1 = _collect_s1(sym_df1h[sym], sym)
        s2 = _collect_s2(sym_df1h[sym], sym)
        s3 = _collect_s3(sym_df1h[sym], sym)
        s4 = _collect_s4(sym_df1h[sym], sym)
        all_sigs.extend(s1 + s2 + s3 + s4)
        per_stream_counts["S1"] += len(s1)
        per_stream_counts["S2"] += len(s2)
        per_stream_counts["S3"] += len(s3)
        per_stream_counts["S4"] += len(s4)
        print(f"    {sym:<10}  S1={len(s1):>4}  S2={len(s2):>4}  "
              f"S3={len(s3):>4}  S4={len(s4):>4}")
    print(f"  signals: total={len(all_sigs)}  "
          f"S1={per_stream_counts['S1']} S2={per_stream_counts['S2']} "
          f"S3={per_stream_counts['S3']} S4={per_stream_counts['S4']}")

    # ── Replay ──────────────────────────────────────────────────────────
    print(f"\n  Replaying {len(all_sigs)} trades on 5m (managed + baseline + MFE)…")
    trades: list[dict] = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(_replay_one, s, sym_df5[s["sym"]]): s for s in all_sigs}
        for fut in as_completed(futs):
            res = fut.result()
            if res:
                trades.append(res)
    trades.sort(key=lambda t: (t["entry_ts_utc"], t["stream"], t["sym"]))
    print(f"  replayed: {len(trades)} valid trades  "
          f"({len(all_sigs) - len(trades)} skipped — no 5m data)")

    if not trades:
        print("  No trades produced — aborting.")
        return

    df = pd.DataFrame(trades)

    # ── Write trades ───────────────────────────────────────────────────
    trades_csv = run_dir / "trades" / "trades_all.csv"
    df.to_csv(trades_csv, index=False)
    print(f"\n  wrote {trades_csv.relative_to(REPO_ROOT)}  rows={len(df)}")

    # ── Stats ──────────────────────────────────────────────────────────
    artifacts = run_dir / "artifacts"
    total = _agg(df, [])
    by_stream = _agg(df, ["stream"]).sort_values("stream")
    by_year = _agg(df, ["year"]).sort_values("year")
    by_stream_year = _agg(df, ["stream", "year"]).sort_values(["stream", "year"])
    by_asset = _agg(df, ["sym"]).sort_values("sym")
    by_stream_asset = _agg(df, ["stream", "sym"]).sort_values(["stream", "sym"])
    saved = _saved_r_detail(df)
    mfe = _mfe_buckets(df)
    exits = _exit_reason_mix(df)
    equity = _equity_by_stream(df)

    total.to_csv(artifacts / "summary_total.csv", index=False)
    by_stream.to_csv(artifacts / "summary_by_stream.csv", index=False)
    by_year.to_csv(artifacts / "summary_by_year.csv", index=False)
    by_stream_year.to_csv(artifacts / "summary_by_stream_year.csv", index=False)
    by_asset.to_csv(artifacts / "summary_by_asset.csv", index=False)
    by_stream_asset.to_csv(artifacts / "summary_by_stream_asset.csv", index=False)
    saved.to_csv(artifacts / "saved_r_by_stream.csv", index=False)
    mfe.to_csv(artifacts / "mfe_buckets_by_stream.csv", index=False)
    exits.to_csv(artifacts / "exit_reason_by_stream.csv", index=False)
    equity.to_csv(artifacts / "equity_by_stream.csv", index=False)

    # ── run_config + report.md ─────────────────────────────────────────
    run_config = dict(
        run_id=run_id,
        generated_utc=datetime.now(timezone.utc).isoformat(),
        db=db_path,
        script="lab/run_all_streams.py",
        locked_config=LOCKED_CONFIG,
        data_window=dict(
            start_utc=START_UTC,
            end_utc=str(max((pd.Timestamp(df5.index.max()) for df5 in sym_df5.values()
                             if len(df5) > 0), default="")),
        ),
        signal_counts=dict(per_stream_counts),
        trade_count=len(df),
    )
    (run_dir / "run_config.json").write_text(
        json.dumps(run_config, indent=2, default=str), encoding="utf-8"
    )

    _write_report(run_dir, df, total, by_stream, by_year, by_stream_year,
                  by_asset, by_stream_asset, saved, mfe, exits)

    # ── Console output ─────────────────────────────────────────────────
    _print_table(total, "PORTFOLIO TOTAL")
    _print_table(by_stream, "BY STREAM")
    _print_table(by_year, "BY YEAR (portfolio)")
    _print_table(by_stream_year, "BY STREAM × YEAR")
    _print_table(by_asset, "BY ASSET (portfolio)")
    _print_table(by_stream_asset, "BY STREAM × ASSET")
    _print_table(saved, "SAVED R (stop-management impact)")
    _print_table(exits, "EXIT REASON MIX")
    _print_table(mfe, "MFE BUCKETS (win rate by max favourable excursion)")
    print(f"\n  OUTPUT: {run_dir}")
    print(f"  Launch dashboard pointing at: {trades_csv}")


def _df_to_md(df_: pd.DataFrame) -> str:
    """Minimal DataFrame → markdown table (no tabulate dependency)."""
    if df_.empty:
        return "_(no data)_\n"
    cols = list(df_.columns)
    lines = ["| " + " | ".join(str(c) for c in cols) + " |",
             "| " + " | ".join("---" for _ in cols) + " |"]
    for _, row in df_.iterrows():
        vals = []
        for c in cols:
            v = row[c]
            if isinstance(v, float):
                vals.append(f"{v:.4f}" if abs(v) < 1 else f"{v:.2f}")
            else:
                vals.append(str(v))
        lines.append("| " + " | ".join(vals) + " |")
    return "\n".join(lines) + "\n"


def _write_report(run_dir: Path, df: pd.DataFrame,
                  total: pd.DataFrame, by_stream: pd.DataFrame,
                  by_year: pd.DataFrame, by_stream_year: pd.DataFrame,
                  by_asset: pd.DataFrame, by_stream_asset: pd.DataFrame,
                  saved: pd.DataFrame, mfe: pd.DataFrame,
                  exits: pd.DataFrame) -> None:
    md = _df_to_md

    out = []
    out.append(f"# {run_dir.name}\n")
    out.append("Run contract: one TP per stream, single immutable run folder.\n")
    out.append("Source: `lab/run_all_streams.py` — locked configs per `CLAUDE.md`.\n\n")
    out.append("## Portfolio total\n\n" + md(total))
    out.append("## By stream\n\n" + md(by_stream))
    out.append("## By year\n\n" + md(by_year))
    out.append("## By stream × year\n\n" + md(by_stream_year))
    out.append("## By asset\n\n" + md(by_asset))
    out.append("## By stream × asset\n\n" + md(by_stream_asset))
    out.append("## Saved R (managed − baseline)\n\n" + md(saved))
    out.append("## Exit reason mix\n\n" + md(exits))
    out.append("## MFE buckets\n\n" + md(mfe))
    (run_dir / "report.md").write_text("".join(out), encoding="utf-8")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(
        description="Run S1-S4 on all data with locked configs (no sweeps)."
    )
    ap.add_argument("--db", default=DEFAULT_DB, help="Path to backtest.sqlite")
    ap.add_argument(
        "--out", default=str(REPO_ROOT / "runs"),
        help="Root directory for run folders (default: RSI/runs)",
    )
    args = ap.parse_args()
    main(db_path=args.db, out_root=args.out)
