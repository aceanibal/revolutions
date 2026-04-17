#!/usr/bin/env python3
"""
run_all_streams.py — Locked, single-TP master runner for S1-S5 with M1+M3 mitigations.

Runs every confirmed live stream on all available 5m/1h data with fully
locked parameters (no sweeps, no optional flags) and emits an immutable
run folder following memory/run_definition.md:

    runs/run_all_streams_<UTC_STAMP>/
        run_config.json                     # every config variable captured
        trades/
            trades_all.csv                  # one row per executed trade (all streams)
        artifacts/
            summary_total.csv               # portfolio-level totals (R)
            summary_by_stream.csv           # per-stream totals (R)
            summary_by_year.csv             # exit-year × portfolio (R)
            summary_by_stream_year.csv      # exit-year × stream (R)
            summary_by_asset.csv            # symbol × portfolio (R)
            summary_by_stream_asset.csv     # symbol × stream (R)
            saved_r_by_stream.csv           # managed vs baseline deltas
            mfe_buckets_by_stream.csv       # win/R by MFE reached
            exit_reason_by_stream.csv       # SL / BE / TP mix
            equity_by_stream.csv            # running cum-R per stream
            risk_sizing.csv                 # per-stream risk % config
            portfolio_equity.csv            # daily dollar equity curve ($10k start)
            portfolio_trades.csv            # all trades enriched with dollar fields

        report.md                           # readable overview

Configs are sourced from CLAUDE.md "Confirmed Live Streams".
One TP per stream. No TP sweeps.

Each trade is replayed TWICE:
    managed  = current stream rules (S4 BE-lock, S1/S2/S3/S5 fixed)
    baseline = same entry, fixed stop, no management

saved_r = managed_r - baseline_r  (how much R the stop-management rules
rescued from losers or captured from reversals).

MFE (max favorable excursion in R) is measured independently from the 5m
bars between entry and the managed exit.

Portfolio simulation ($10k):
    risk_pct = TARGET_DD_PCT / stream_maxDD_r   (target: each stream hits ≤35% DD)
    dollar_risk  = balance_at_entry × risk_pct
    dollar_pnl   = dollar_risk × managed_r
    balance compounded: applied at exit_ts, sorted chronologically.
    Concurrent positions each use their own balance_at_entry snapshot.
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
# Portfolio simulation constants.
# ────────────────────────────────────────────────────────────────────────────

PORTFOLIO_START_BALANCE = 10_000.0   # USD
TARGET_DD_PCT = 35.0                 # target each stream's maxDD ≈ 35% of account

# Reference maxDD_r per stream (from confirmed run / strategy spec files).
# Used to derive base risk_pct = TARGET_DD_PCT / maxDD_r.
# Source: strategy/S*.md reference stats.
STREAM_MAXDD_R: dict[str, float] = {
    "S1": 37.78,   # strategy/S1 — runs/run_all_streams_20260417T231541Z (post Choice-B overhaul)
    "S2": 12.7,    # strategy/S2 — cache/shorts_filtered_sweep.csv
    "S3": 10.3,    # strategy/S3 — cache/fvg_lock_sweep.csv baseline
    "S4": 21.67,   # strategy/S4 — runs/run_all_streams_20260416T153516Z
    "S5": 67.1,    # strategy/S5 — chat-history combined reference
}

# ── Active mitigations (M1 + M3) ─────────────────────────────────────────────
# Derived from lab/analyze_mitigations.py post-hoc analysis on run 20260417.
# Full analysis: runs/run_all_streams_20260417T010915Z/artifacts/mitigation_analysis.md
#
# M3 — Halve S2 risk% (1.378% instead of 2.756%).
#   Rationale: S2 drives the largest single-stream contribution to portfolio
#   maxDD due to its high signal count (1,910 trades). Halving its risk%
#   reduces S2's dollar impact while retaining full signal coverage.
#   Effect: 62% DD reduction at 1.8× efficiency (best single ratio).
#
# M1 — Daily −5% loss cap.
#   Rationale: S2 can fire 10–20 cluster signals in a single session.
#   When that session reverses, every signal stops out simultaneously,
#   creating a single-day loss far exceeding the intended per-trade risk.
#   The daily cap stops accepting new entries once the day's P&L drops
#   below −5% of that day's opening balance.
#   Effect: ~510 entries skipped over 4 years (~120/yr, ~10/month).

# M3: S2 risk% halved — applied directly to STREAM_RISK_PCT
STREAM_RISK_PCT: dict[str, float] = {
    s: round(TARGET_DD_PCT / dd, 4) for s, dd in STREAM_MAXDD_R.items()
}
RISK_PCT_S2_BASE = STREAM_RISK_PCT["S2"]                          # pre-M3 reference
STREAM_RISK_PCT["S2"] = round(STREAM_RISK_PCT["S2"] / 2.0, 4)   # M3 applied

# M1: daily loss cap threshold (% of day-open balance)
DAILY_LOSS_CAP_PCT: float = -5.0


# ────────────────────────────────────────────────────────────────────────────
# Locked configuration. Every value is intentional. Do not parameterise.
# Source: CLAUDE.md "Confirmed Live Streams" and memory/project_live_streams.md.
# ────────────────────────────────────────────────────────────────────────────

FEE_BPS = 3.0
START_UTC = "2022-01-01"

# Full 11-symbol universe (expanded 2026-04-17).
# Canonical 6 + AVAX, SUI, TAO, ONDO, PAXG.
# Excluded: BNBUSDT (user decision), LTCUSDT (2025-only), CRCLUSDT (<2 months).
# ONDO: included for S2/S3/S5 signal coverage; S1 EMA filter will suppress most entries.
SX_SYMS = (
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "LINKUSDT", "DOGEUSDT", "XRPUSDT",
    "AVAXUSDT", "SUIUSDT", "TAOUSDT", "ONDOUSDT", "PAXGUSDT",
)

# S1 — IMBAL+HIGH Long bullish momentum continuation (fat-tail trend capture).
# Signal: collect_imbalanced_signals long side (side=+1):
#   structure=IMBALANCED, vol_q=HIGH, bullish candle with body_pct>0.55,
#   close_pct>1-close_pct_max (close near high), vol_ratio>1.8.
# Lever 2 — EMA200 regime filter: signal bar close must be above EMA(200) on 1h.
#   Suppresses signals in bear-market regimes (2022 bear, 2026 risk-off).
#   Study (2026-04-17): drops 17% of signals, maxDD 91→58, R +572→+599.
# Stop: ATR×2.0 below entry.
# Lever 1 — trailing lock: when MFE reaches 3.5R, stop moves to entry+1R.
#   Reduces MCL 54→19, rescued 213 abandoned runners (+426R offset by -407R
#   from 37 capped winners; net +19R, main benefit is drawdown and run control).
# TP:   12R — fat-tail target; edge is in the right-tail outliers.
# Reference (post-overhaul, 2026-04-17): study/s1_overhaul_comparison.csv
#   6-symbol baseline: maxDD≈70R / with L1+L2: maxDD≈58R (update after first run).
S1 = dict(
    regime="IMBALANCED+HIGH long, bullish momentum continuation",
    vol_ratio_min=1.8, body_pct_min=0.55, close_pct_max=0.15,
    atr_mult=2.0,
    tp_r=12.0,
    ema_filter=200,   # Lever 2: only fire if 1h close > EMA(200) on signal bar
    trig_r=3.5,       # Lever 1: lock trigger (MFE threshold)
    lock_r=1.0,       # Lever 1: stop moves to entry + lock_r * risk
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

# S5 — IMBAL+HIGH Short (bearish momentum continuation).
# Short-side counterpart to S1. Same regime/filters but side=-1.
# Signal: collect_imbalanced_signals short side (side=-1):
#   structure=IMBALANCED, vol_q=HIGH, bearish candle with body_pct>0.55,
#   close_pct<0.15 (close near low), vol_ratio>1.8.
# Stop: ATR×2.0 fixed (no lock, no ladder).
# TP:   5R — historically optimal for IMBAL+HIGH short trend-follow.
# Reference (chat history, combined 6 symbols): 631 signals / 21.1% win /
#   +158.7R / ann≈37R/yr / maxDD≈67R.
S5 = dict(
    regime="IMBALANCED+HIGH short, bearish momentum continuation",
    vol_ratio_min=1.8, body_pct_min=0.55, close_pct_max=0.15,
    atr_mult=2.0,
    tp_r=5.0,
)

LOCKED_CONFIG = dict(
    start_utc=START_UTC,
    fee_bps=FEE_BPS,
    symbols=list(SX_SYMS),
    s1=S1,
    s2=S2,
    s3=S3,
    s4=S4,
    s5=S5,
)


# ────────────────────────────────────────────────────────────────────────────
# Signal collectors. Each returns a list of stream-tagged signal dicts.
# ────────────────────────────────────────────────────────────────────────────

def _collect_s1(df1h: pd.DataFrame, sym: str) -> list[dict]:
    """IMBAL+HIGH bullish momentum continuation (long side of collect_imbalanced_signals).

    Lever 2 — EMA(200) regime filter applied here. Signal bar close must be above
    the 1h EMA(200) at the time the signal fires. No look-ahead: EMA uses only
    bars up to and including the signal bar (bar i), which is already closed when
    the signal is detected (Rule 1).
    """
    ema_span = S1["ema_filter"]
    ema_col  = f"_s1_ema{ema_span}"
    df1h     = df1h.copy()
    df1h[ema_col] = df1h["close"].ewm(span=ema_span, adjust=False).mean()

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

        # Lever 2: check signal bar (bar i = one before entry ts) close vs EMA
        try:
            loc = df1h.index.get_loc(s["ts"])
            if loc < 1:
                continue
            sig_bar  = df1h.iloc[loc - 1]
            ema_val  = sig_bar[ema_col]
            if pd.isna(ema_val) or float(sig_bar["close"]) <= float(ema_val):
                continue
        except (KeyError, TypeError):
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


def _collect_s5(df1h: pd.DataFrame, sym: str) -> list[dict]:
    """IMBAL+HIGH bearish momentum continuation (short side of collect_imbalanced_signals)."""
    raw = collect_imbalanced_signals(
        df1h, sym,
        vol_ratio_min=S5["vol_ratio_min"],
        body_pct_min=S5["body_pct_min"],
        close_pct_max=S5["close_pct_max"],
    )
    sigs: list[dict] = []
    for s in raw:
        if s["side"] != -1:
            continue
        entry_p = s["entry_p"]
        risk = s["atr"] * S5["atr_mult"]
        if risk <= 0:
            continue
        stop_p = entry_p + risk      # short: stop above entry
        sigs.append(dict(
            stream="S5", sym=sym, side=-1,
            ts=s["ts"], entry_p=entry_p,
            stop_p=stop_p, risk=risk, tp_r=S5["tp_r"],
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

    if stream == "S1":
        # Lever 1: trailing lock at 3.5R → +1R (same mechanism as S4).
        res = replay_trade_5m(
            df5, sig["ts"], side, entry_p, stop_p, tp_p,
            risk, FEE_BPS,
            be_trigger_r=S1["trig_r"], be_offset_r=S1["lock_r"],
            skip_entry_bucket_hours=0.0,
        )
    elif stream == "S4":
        res = replay_trade_5m(
            df5, sig["ts"], side, entry_p, stop_p, tp_p,
            risk, FEE_BPS,
            be_trigger_r=S4["trig_r"], be_offset_r=S4["lock_r"],
            skip_entry_bucket_hours=0.0,
        )
    else:  # S2, S3, S5 — fixed SL/TP, no stop management
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

# ────────────────────────────────────────────────────────────────────────────
# Portfolio simulation — dollar compounding from a $10k starting balance.
# ────────────────────────────────────────────────────────────────────────────

def _apply_daily_loss_cap(
    df: pd.DataFrame,
    cap_pct: float = DAILY_LOSS_CAP_PCT,
) -> tuple[pd.DataFrame, set[int]]:
    """
    M1 — Daily loss cap filter.

    Simulates entry acceptance sequentially. When a new entry event fires,
    the cumulative intraday P&L (from exits that occurred earlier that day)
    is checked against cap_pct% of the day's opening balance. If the cap
    has already been hit, the entry is skipped for the rest of that day.

    Returns the original df unchanged PLUS a set of row-indices that are
    ACTIVE (not skipped). The skipped flag is written to a column so that
    all trades remain in the output CSV for Streamlit audit.

    Uses STREAM_RISK_PCT (with M3 already applied) to measure intraday P&L.
    """
    events: list[tuple] = []
    for idx, row in df.iterrows():
        events.append((pd.Timestamp(row["entry_ts_utc"]), 1, idx))   # 1=entry
        events.append((pd.Timestamp(row["exit_ts_utc"]),  0, idx))   # 0=exit first on tie
    events.sort(key=lambda e: (e[0], e[1]))

    balance              = PORTFOLIO_START_BALANCE
    entry_snaps: dict[int, float] = {}
    day_open_bal: dict           = {}
    day_running_pnl: dict        = defaultdict(float)
    active_indices: set[int]     = set()

    for ts, etype, idx in events:
        day = ts.date()
        if day not in day_open_bal:
            day_open_bal[day] = balance

        if etype == 0:   # exit
            if idx not in entry_snaps:
                continue
            bal_before  = entry_snaps.pop(idx)
            rp          = STREAM_RISK_PCT.get(df.at[idx, "stream"], 0.0)
            pnl         = bal_before * (rp / 100.0) * float(df.at[idx, "managed_r"])
            balance    += pnl
            day_running_pnl[day] += pnl
        else:            # entry attempt
            open_bal        = day_open_bal[day]
            cum_loss_pct    = day_running_pnl[day] / open_bal * 100.0 if open_bal else 0.0
            if cum_loss_pct <= cap_pct:
                continue  # daily cap hit — skip this entry
            active_indices.add(idx)
            entry_snaps[idx] = balance

    return df, active_indices


def _portfolio_simulation(
    df: pd.DataFrame,
    active_indices: set[int],
    start_balance: float = PORTFOLIO_START_BALANCE,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Compound a starting balance through the active (non-capped) trades.

    active_indices: row indices accepted by _apply_daily_loss_cap (M1).
    All rows in df are returned in sim_df, but only active ones get dollar
    fields; skipped rows get sim_active=False and null dollar columns so
    every trade is visible in Streamlit.

    Concurrent positions are handled correctly:
      - Entry  → snapshot balance_before = running_balance
      - Exit   → dollar_pnl = balance_before × risk_pct × managed_r
                 (STREAM_RISK_PCT already has M3 applied — S2 halved)

    Returns:
        (enriched_trades_df, equity_curve_df, risk_sizing_df)
    """
    if df.empty:
        return df.copy(), pd.DataFrame(), pd.DataFrame()

    # Only compound through active trades
    active_df = df[df.index.isin(active_indices)].copy()

    # Build event list: exits (0) before entries (1) on same timestamp
    events: list[tuple[pd.Timestamp, int, int]] = []
    for idx, row in active_df.iterrows():
        events.append((pd.Timestamp(row["entry_ts_utc"]), 1, idx))
        events.append((pd.Timestamp(row["exit_ts_utc"]),  0, idx))
    events.sort(key=lambda e: (e[0], e[1]))

    balance         = start_balance
    entry_snapshots: dict[int, float] = {}   # row_index → balance at entry
    exit_results:   dict[int, dict]   = {}   # row_index → dollar fields

    for ts, etype, idx in events:
        stream   = active_df.at[idx, "stream"]
        risk_pct = STREAM_RISK_PCT.get(stream, 0.0)
        if etype == 1:
            # Entry: snapshot balance
            entry_snapshots[idx] = balance
        else:
            # Exit: apply P&L
            bal_before   = entry_snapshots.get(idx, start_balance)
            dollar_risk  = bal_before * (risk_pct / 100.0)
            managed_r    = float(active_df.at[idx, "managed_r"])
            dollar_pnl   = dollar_risk * managed_r
            balance     += dollar_pnl
            exit_results[idx] = dict(
                balance_before = round(bal_before, 2),
                risk_pct       = risk_pct,
                dollar_risk    = round(dollar_risk, 2),
                dollar_pnl     = round(dollar_pnl, 2),
                balance_after  = round(balance, 2),
            )

    # Enrich trades DataFrame — ALL trades present, skipped ones get sim_active=False
    sim_df = df.copy()
    sim_df["sim_active"]    = sim_df.index.isin(active_indices)
    sim_df["m1_daily_cap"]  = ~sim_df["sim_active"]   # True = was blocked by M1
    for col in ("balance_before", "risk_pct", "dollar_risk", "dollar_pnl", "balance_after"):
        sim_df[col] = pd.NA
    for idx, fields in exit_results.items():
        for col, val in fields.items():
            sim_df.at[idx, col] = val
    sim_df["duration_h"] = (
        (pd.to_datetime(sim_df["exit_ts_utc"]) - pd.to_datetime(sim_df["entry_ts_utc"]))
        .dt.total_seconds() / 3600
    ).round(2)

    # Daily equity curve
    eq_rows: list[dict] = [{"date": pd.Timestamp(df["entry_ts_utc"].min()).date(),
                             "balance": start_balance, "daily_pnl": 0.0}]
    by_day: dict = defaultdict(float)
    for idx, fields in exit_results.items():
        day = pd.Timestamp(active_df.at[idx, "exit_ts_utc"]).date()
        by_day[day] += fields["dollar_pnl"]

    running = start_balance
    for day in sorted(by_day):
        running += by_day[day]
        eq_rows.append({"date": day, "balance": round(running, 2),
                        "daily_pnl": round(by_day[day], 2)})
    equity_curve = pd.DataFrame(eq_rows)

    # Risk sizing table — include M3 note for S2
    risk_rows = []
    for stream in sorted(STREAM_MAXDD_R):
        base_rp = round(TARGET_DD_PCT / STREAM_MAXDD_R[stream], 4)
        applied = STREAM_RISK_PCT[stream]
        note    = f"risk_pct = {TARGET_DD_PCT} / {STREAM_MAXDD_R[stream]}"
        if stream == "S2":
            note += f" → halved to {applied}% (M3 mitigation)"
        risk_rows.append(dict(
            stream        = stream,
            ref_maxDD_r   = STREAM_MAXDD_R[stream],
            target_dd_pct = TARGET_DD_PCT,
            base_risk_pct = base_rp,
            applied_risk_pct = applied,
            m3_applied    = (stream == "S2"),
            note          = note,
        ))
    risk_sizing = pd.DataFrame(risk_rows)

    return sim_df, equity_curve, risk_sizing


def _print_simulation_summary(
    sim_df: pd.DataFrame,
    equity_curve: pd.DataFrame,
    risk_sizing: pd.DataFrame,
    start_balance: float,
) -> None:
    """Print the dollar simulation results to console."""
    if sim_df.empty or equity_curve.empty:
        print("\n  (no simulation data)")
        return

    final_bal = equity_curve["balance"].iloc[-1]
    total_return_pct = (final_bal - start_balance) / start_balance * 100
    pnls = sim_df["dollar_pnl"].dropna().to_numpy(dtype=float)
    cum  = np.cumsum(pnls)
    port_dd = float(np.max(np.maximum.accumulate(cum) - cum)) if len(cum) else 0

    print(f"\n{'='*72}")
    print(f"  PORTFOLIO SIMULATION  (start=${start_balance:,.0f})")
    print(f"{'='*72}")
    print(f"\n  Risk sizing (risk_pct = {TARGET_DD_PCT}% / stream maxDD_r):")
    print(f"  {'Stream':<6}  {'maxDD_r':>8}  {'risk_pct':>9}")
    print(f"  {'-'*30}")
    for _, r in risk_sizing.iterrows():
        m3_tag = "  ← M3 halved" if r.m3_applied else ""
        print(f"  {r.stream:<6}  {r.ref_maxDD_r:>8.1f}R  {r.applied_risk_pct:>8.4f}%{m3_tag}")

    print(f"\n  {'Metric':<26}  Value")
    print(f"  {'-'*45}")
    print(f"  {'Start balance':<26}  ${start_balance:>12,.2f}")
    print(f"  {'Final balance':<26}  ${final_bal:>12,.2f}")
    print(f"  {'Total return':<26}  {total_return_pct:>11.1f}%")
    print(f"  {'Max drawdown ($)':<26}  ${port_dd:>12,.2f}  "
          f"({port_dd/start_balance*100:.1f}% of start)")
    print(f"  {'Total trades':<26}  {len(sim_df):>13,}")

    # Year breakdown
    print(f"\n  Year breakdown:")
    print(f"  {'Year':<6}  {'n':>5}  {'P&L ($)':>12}  {'Return':>8}  Balance")
    print(f"  {'-'*52}")
    valid = sim_df.dropna(subset=["dollar_pnl"]).copy()
    valid["exit_year"] = pd.to_datetime(valid["exit_ts_utc"]).dt.year
    running = start_balance
    for yr, grp in valid.groupby("exit_year"):
        pnl  = float(grp["dollar_pnl"].sum())
        ret  = pnl / running * 100
        running += pnl
        print(f"  {yr:<6}  {len(grp):>5}  ${pnl:>11,.0f}  {ret:>7.1f}%  "
              f"${running:>12,.0f}")

    # Per-stream dollar summary
    print(f"\n  Per-stream dollar summary:")
    print(f"  {'Stream':<6}  {'n':>5}  {'risk%':>6}  {'P&L ($)':>12}  {'maxDD ($)':>10}")
    print(f"  {'-'*50}")
    for stream, grp in valid.groupby("stream"):
        arr = grp["dollar_pnl"].to_numpy(dtype=float)
        dd  = float(np.max(np.maximum.accumulate(np.cumsum(arr)) - np.cumsum(arr))) if len(arr) else 0
        print(f"  {stream:<6}  {len(grp):>5}  "
              f"{STREAM_RISK_PCT.get(stream, 0):>5.3f}%  "
              f"${arr.sum():>11,.0f}  ${dd:>9,.0f}")


def _print_table(df: pd.DataFrame, title: str) -> None:
    print(f"\n  {title}")
    print("  " + "-" * max(len(title), 40))
    if df.empty:
        print("  (no rows)")
        return
    with pd.option_context("display.max_rows", None, "display.width", 220,
                           "display.max_columns", None):
        print(df.to_string(index=False))


def main(db_path: str, out_root: str,
         symbols_override: list[str] | None = None) -> None:
    db_path = str(Path(db_path).resolve())
    # Apply symbol override — allows single-asset runs without touching locked config
    run_syms = tuple(s.upper() for s in symbols_override) if symbols_override else SX_SYMS
    stamp  = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
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
    print(f"  symbols:  {', '.join(run_syms)}")
    if run_syms != SX_SYMS:
        print(f"  (override — default is {', '.join(SX_SYMS)})")
    print(f"  fee_bps:  {FEE_BPS}")

    # ── Data load ───────────────────────────────────────────────────────
    print(f"\n  Loading 5m/1h data for {len(run_syms)} symbols…")
    sym_df5: dict[str, pd.DataFrame] = {}
    sym_df1h: dict[str, pd.DataFrame] = {}
    for sym in run_syms:
        df5, df1h = prepare_sym(db_path, sym, START_UTC)
        sym_df5[sym] = df5
        sym_df1h[sym] = df1h
        print(f"    {sym:<10}  5m={len(df5):>7}  1h={len(df1h):>6}")

    # ── Signal collection ──────────────────────────────────────────────
    print(f"\n  Collecting signals…")
    all_sigs: list[dict] = []
    per_stream_counts: dict[str, int] = defaultdict(int)
    for sym in run_syms:
        s1 = _collect_s1(sym_df1h[sym], sym)
        s2 = _collect_s2(sym_df1h[sym], sym)
        s3 = _collect_s3(sym_df1h[sym], sym)
        s4 = _collect_s4(sym_df1h[sym], sym)
        s5 = _collect_s5(sym_df1h[sym], sym)
        all_sigs.extend(s1 + s2 + s3 + s4 + s5)
        per_stream_counts["S1"] += len(s1)
        per_stream_counts["S2"] += len(s2)
        per_stream_counts["S3"] += len(s3)
        per_stream_counts["S4"] += len(s4)
        per_stream_counts["S5"] += len(s5)
        print(f"    {sym:<10}  S1={len(s1):>4}  S2={len(s2):>4}  "
              f"S3={len(s3):>4}  S4={len(s4):>4}  S5={len(s5):>4}")
    print(f"  signals: total={len(all_sigs)}  "
          f"S1={per_stream_counts['S1']} S2={per_stream_counts['S2']} "
          f"S3={per_stream_counts['S3']} S4={per_stream_counts['S4']} "
          f"S5={per_stream_counts['S5']}")

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

    # ── Portfolio simulation ($10k) with M1 + M3 ──────────────────────
    print(f"\n  Running portfolio simulation (start=${PORTFOLIO_START_BALANCE:,.0f})…")
    print(f"  Mitigations active:")
    print(f"    M3 — S2 risk% halved: {RISK_PCT_S2_BASE:.4f}% → {STREAM_RISK_PCT['S2']:.4f}%")
    print(f"    M1 — daily loss cap at {DAILY_LOSS_CAP_PCT:+.1f}% of day-open balance")

    _, active_indices = _apply_daily_loss_cap(df)
    n_skipped = len(df) - len(active_indices)
    print(f"  M1 skipped {n_skipped} entries ({n_skipped/len(df)*100:.1f}% of trades)")
    sim_df, equity_curve, risk_sizing = _portfolio_simulation(
        df, active_indices, PORTFOLIO_START_BALANCE
    )

    risk_sizing.to_csv(artifacts / "risk_sizing.csv", index=False)
    equity_curve.to_csv(artifacts / "portfolio_equity.csv", index=False)
    # portfolio_trades.csv — enriched trades including dollar fields
    port_trades_csv = run_dir / "trades" / "portfolio_trades.csv"
    sim_df.to_csv(port_trades_csv, index=False)
    print(f"  wrote {port_trades_csv.relative_to(REPO_ROOT)}  rows={len(sim_df)}")
    print(f"  wrote {(artifacts/'portfolio_equity.csv').relative_to(REPO_ROOT)}")
    print(f"  wrote {(artifacts/'risk_sizing.csv').relative_to(REPO_ROOT)}")

    # ── run_config + report.md ─────────────────────────────────────────
    run_config = dict(
        run_id=run_id,
        generated_utc=datetime.now(timezone.utc).isoformat(),
        db=db_path,
        script="lab/run_all_streams.py",
        locked_config=LOCKED_CONFIG,
        portfolio_simulation=dict(
            start_balance=PORTFOLIO_START_BALANCE,
            target_dd_pct=TARGET_DD_PCT,
            stream_maxdd_r=STREAM_MAXDD_R,
            stream_risk_pct=STREAM_RISK_PCT,
            mitigations=dict(
                M1_daily_loss_cap=dict(
                    active=True,
                    cap_pct=DAILY_LOSS_CAP_PCT,
                    trades_skipped=n_skipped,
                    description=(
                        "Skip new entries on a day once cumulative intraday P&L "
                        f"falls below {DAILY_LOSS_CAP_PCT:+.1f}% of day-open balance. "
                        "Prevents S2 cluster blow-ups in a single session."
                    ),
                ),
                M3_s2_risk_halved=dict(
                    active=True,
                    s2_base_risk_pct=RISK_PCT_S2_BASE,
                    s2_applied_risk_pct=STREAM_RISK_PCT["S2"],
                    description=(
                        "S2 risk% halved from "
                        f"{RISK_PCT_S2_BASE:.4f}% to {STREAM_RISK_PCT['S2']:.4f}%. "
                        "Reduces S2 dollar impact; confirmed best efficiency ratio "
                        "in lab/analyze_mitigations.py (1.8x DD reduction per return unit)."
                    ),
                ),
            ),
        ),
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
    _print_table(total, "PORTFOLIO TOTAL (R)")
    _print_table(by_stream, "BY STREAM (R)")
    _print_table(by_year, "BY YEAR — portfolio (R)")
    _print_table(by_stream_year, "BY STREAM × YEAR (R)")
    _print_table(by_asset, "BY ASSET — portfolio (R)")
    _print_table(by_stream_asset, "BY STREAM × ASSET (R)")
    _print_table(saved, "SAVED R (stop-management impact)")
    _print_table(exits, "EXIT REASON MIX")
    _print_table(mfe, "MFE BUCKETS (win rate by max favourable excursion)")

    _print_simulation_summary(sim_df, equity_curve, risk_sizing, PORTFOLIO_START_BALANCE)

    print(f"\n{'='*72}")
    print(f"  OUTPUT: {run_dir}")
    print(f"  R-level trades:     {trades_csv.relative_to(REPO_ROOT)}")
    print(f"  Dollar trades:      {port_trades_csv.relative_to(REPO_ROOT)}")
    print(f"  Equity curve:       {(artifacts/'portfolio_equity.csv').relative_to(REPO_ROOT)}")
    print(f"  Risk sizing:        {(artifacts/'risk_sizing.csv').relative_to(REPO_ROOT)}")
    print(f"\n  Launch dashboard:   streamlit run lab/app.py")
    print(f"{'='*72}\n")


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
        description="Run S1-S5 on all data with locked configs (no sweeps)."
    )
    ap.add_argument("--db", default=DEFAULT_DB, help="Path to backtest.sqlite")
    ap.add_argument(
        "--out", default=str(REPO_ROOT / "runs"),
        help="Root directory for run folders (default: RSI/runs)",
    )
    ap.add_argument(
        "--symbols", nargs="+", default=None,
        metavar="SYM",
        help="Override symbol list e.g. --symbols BNBUSDT BTCUSDT (default: all 6)",
    )
    args = ap.parse_args()
    main(db_path=args.db, out_root=args.out, symbols_override=args.symbols)
