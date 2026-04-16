#!/usr/bin/env python3
"""
Master Portfolio Runner — 4 Streams, Compounding Balance, Streamlit-Ready Output
=================================================================================

Streams
-------
  S1  IMBAL+HIGH Long   4h RSI crossover (rsi_l=35, rsi_h=60)
                        3-stage MFE ladder: (1→0.8R), (6.5→5.5R), (10→9R)
                        TP=13R

  S2  BAL+HIGH Short    FVG-filtered momentum exhaustion short (BALANCED+HIGH)
                        Signal: bearish candle + bearish FVG (high[i] < low[i-2])
                        Stop: fvg_low + ATR×0.15 (FVG-LOW, tight)
                        TP=4.25R

  S3  IMBAL+HIGH Short  Trend-continuation short (IMBALANCED+HIGH)
                        ATR×2.0 stop, TP=5R

  S4  BAL+HIGH Swing Low Long
                        Equal-lows liquidity sweep (BALANCED+HIGH, rejection≥0.90)
                        ATR×2.0 stop, trig=3.5R → lock=+1.0R, TP=19.5R

Position Sizing
---------------
  risk_pct = TARGET_DD_PCT / stream_maxDD_r
  TARGET_DD_PCT = 35.0  (targets ~35% portfolio maxDD)

  Stream maxDD reference:
    S1 BTC  23.2R → 1.51%     S1 ETH  28.2R → 1.24%
    S1 XRP   8.5R → 4.12%     S1 SOL  12.9R → 2.71%
    S1 LINK 12.5R → 2.80%
    S2      10.3R → 3.40%
    S3      33.0R → 1.06%
    S4      17.6R → 1.99%

  dollar_risk  = balance_at_entry × risk_pct
  dollar_pnl   = dollar_risk × pnl_r
  balance      compounded: updated on trade close (sorted by exit_ts)

Output files (cache/)
---------------------
  portfolio_trades.csv    — every trade, full metadata (Streamlit-ready)
  portfolio_equity.csv    — daily equity snapshots
  portfolio_monthly.csv   — monthly P&L breakdown by stream
  portfolio_summary.csv   — per-stream aggregate stats

Usage
-----
    python lab/run_portfolio.py
    python lab/run_portfolio.py --start 2022-01-01 --balance 10000
    python lab/run_portfolio.py --start 2023-01-01  # faster smoke test
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd

LAB_ROOT  = Path(__file__).resolve().parent
REPO_ROOT = LAB_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from lab.study_fvg_momentum   import DEFAULT_DB, SYMS, prepare_sym, collect_signals as _collect_s2_signals
from lab.study_imbalanced_trend import collect_imbalanced_signals
from lab.study_swing_low_sweep  import collect_sweep_signals
from lab.study_order_blocks     import stop_fvg, risk_std, replay_fixed_risk
from lab.core.db                import load_merged_5m
from lab.core.resample          import build_4h_rsi
from lab.sim.entry              import run_simulation_trades, tp_price_from_r
from lab.sim.exit               import replay_trade_5m, replay_trade_mfe_ladder_5m


# ── Config ────────────────────────────────────────────────────────────────────

TARGET_DD_PCT = 35.0   # target each stream's maxDD ≈ 35% of account
FEE_BPS       = 3.0
START_DEFAULT = "2022-01-01"
BALANCE_START = 10_000.0

# Per-stream risk % (= TARGET_DD_PCT / stream_maxDD_r)
_RISK = {
    "S1_BTCUSDT":  round(TARGET_DD_PCT / 23.2, 4),   # 1.51%
    "S1_ETHUSDT":  round(TARGET_DD_PCT / 28.2, 4),   # 1.24%
    "S1_XRPUSDT":  round(TARGET_DD_PCT / 8.5,  4),   # 4.12%
    "S1_SOLUSDT":  round(TARGET_DD_PCT / 12.9,  4),  # 2.71%
    "S1_LINKUSDT": round(TARGET_DD_PCT / 12.5,  4),  # 2.80%
    "S2":          round(TARGET_DD_PCT / 10.3,  4),  # 3.40%
    "S3":          round(TARGET_DD_PCT / 33.0,  4),  # 1.06%
    "S4":          round(TARGET_DD_PCT / 17.6,  4),  # 1.99%
}

# S1 MFE ladder stages
S1_STAGES = [(1.0, 0.8), (6.5, 5.5), (10.0, 9.0)]
S1_TP     = 13.0
S1_RSI_L  = 35
S1_RSI_H  = 60
S1_SL_N   = 3
S1_ATR    = 2.0

# S2 — BAL+HIGH Short FVG
S2_TP         = 4.25
S2_ATR_MULT   = 2.0
S2_BUF_MULT   = 0.15

# S3 — IMBAL+HIGH Short
S3_TP         = 5.0
S3_ATR_MULT   = 2.0

# S4 — Swing Low Long
S4_TP         = 19.5
S4_ATR_MULT   = 2.0
S4_TRIG_R     = 3.5
S4_LOCK_R     = 1.0
S4_REJECT_MIN = 0.90


# ── Signal collectors ─────────────────────────────────────────────────────────

S1_SYMS = {"BTCUSDT", "ETHUSDT", "XRPUSDT", "SOLUSDT", "LINKUSDT"}  # DOGE excluded


def _collect_s1(df5: pd.DataFrame, sym: str) -> list[dict]:
    """
    4h RSI crossover BOTH DIRECTIONS using run_simulation_trades.

    run_simulation_trades enforces one-at-a-time with 4h-level exits.
    We collect ALL entries (both long and short) and replay each
    independently on 5m with the MFE ladder — matching the confirmed
    massive_chunk_v2_mfe3 approach.
    """
    if sym not in S1_SYMS:
        return []
    df4h = build_4h_rsi(df5, window=20)
    raw  = run_simulation_trades(
        df4h["open"].values, df4h["high"].values,
        df4h["low"].values,  df4h["rsi"].values,
        S1_RSI_L, S1_RSI_H, S1_SL_N, r_multi=S1_TP, fee_bps=FEE_BPS,
    )
    sigs = []
    for t in raw:
        idx     = t["entry_idx"]
        side    = t["side"]
        ep      = float(t["entry_price"])
        sl      = float(t["stop_loss"])
        risk    = abs(ep - sl)
        if risk <= 0 or idx >= len(df4h):
            continue
        sigs.append({
            "stream": f"S1_{sym}", "sym": sym, "side": side,
            "ts": df4h.index[idx], "entry_p": ep,
            "stop_p": sl, "risk": risk, "tp_r": S1_TP,
        })
    return sigs


def _collect_s2(df1h: pd.DataFrame, df5: pd.DataFrame, sym: str) -> list[dict]:
    """BAL+HIGH short with FVG filter → FVG-LOW stop.
    close_pct_max=0.15 matches the confirmed fvg_lock_sweep.py config."""
    raw = _collect_s2_signals(df1h, sym, vol_ratio_min=1.5, body_pct_min=0.55,
                              close_pct_max=0.15)
    sigs = []
    for s in raw:
        if not s.get("has_fvg"):
            continue
        stop_p = stop_fvg(s, S2_BUF_MULT)
        if stop_p is None:
            continue
        risk = risk_std(s, S2_ATR_MULT)
        if risk <= 0 or stop_p <= s["entry_p"]:
            continue
        sigs.append({
            "stream": "S2", "sym": sym, "side": -1,
            "ts": s["ts"], "entry_p": s["entry_p"],
            "stop_p": stop_p, "risk": risk, "tp_r": S2_TP,
            "fvg_low": s["fvg_low"],
        })
    return sigs


def _collect_s3(df1h: pd.DataFrame, sym: str) -> list[dict]:
    """IMBAL+HIGH short, ATR stop."""
    raw = collect_imbalanced_signals(
        df1h, sym, vol_ratio_min=1.8, body_pct_min=0.55, close_pct_max=0.15,
    )
    sigs = []
    for s in raw:
        if s["side"] != -1:
            continue
        entry_p = s["entry_p"]
        risk    = s["atr"] * S3_ATR_MULT
        stop_p  = entry_p + risk
        if risk <= 0:
            continue
        sigs.append({
            "stream": "S3", "sym": sym, "side": -1,
            "ts": s["ts"], "entry_p": entry_p,
            "stop_p": stop_p, "risk": risk, "tp_r": S3_TP,
        })
    return sigs


def _collect_s4(df1h: pd.DataFrame, sym: str) -> list[dict]:
    """BAL+HIGH swing low (liquidity sweep), trig=3.5R→+1R lock."""
    raw = collect_sweep_signals(
        df1h, sym, lookback=50, tolerance=0.005,
        min_swing=5, rejection_min=S4_REJECT_MIN,
    )
    sigs = []
    for s in raw:
        if s.get("structure") != "BALANCED" or s.get("vol_q") != "HIGH":
            continue
        risk = s["atr"] * S4_ATR_MULT
        if risk <= 0:
            continue
        stop_p = s["entry_p"] - risk
        sigs.append({
            "stream": "S4", "sym": sym, "side": 1,
            "ts": s["ts"], "entry_p": s["entry_p"],
            "stop_p": stop_p, "risk": risk, "tp_r": S4_TP,
        })
    return sigs


# ── Replay ────────────────────────────────────────────────────────────────────

def _replay_one(sig: dict, df5: pd.DataFrame) -> dict | None:
    """Replay a single signal on 5m bars. Returns enriched trade dict or None."""
    entry_p = sig["entry_p"]
    stop_p  = sig["stop_p"]
    risk    = sig["risk"]
    tp_r    = sig["tp_r"]
    side    = sig["side"]
    tp_p    = tp_price_from_r(entry_p, risk, side, tp_r)

    stream = sig["stream"]

    if stream.startswith("S1"):
        res = replay_trade_mfe_ladder_5m(
            df5, sig["ts"], side, entry_p, stop_p, tp_p,
            risk, FEE_BPS, stages=S1_STAGES, cap_lock_by_mfe=True,
            skip_entry_bucket_hours=0.0,
        )
    elif stream == "S2":
        # FVG-LOW stop: stop is already set; risk is ATR-based (for TP/R accounting)
        res = replay_trade_5m(
            df5, sig["ts"], side, entry_p, stop_p, tp_p,
            risk, FEE_BPS, be_trigger_r=None, be_offset_r=0.0,
            skip_entry_bucket_hours=0.0,
        )
    elif stream == "S3":
        res = replay_trade_5m(
            df5, sig["ts"], side, entry_p, stop_p, tp_p,
            risk, FEE_BPS, be_trigger_r=None, be_offset_r=0.0,
            skip_entry_bucket_hours=0.0,
        )
    elif stream == "S4":
        res = replay_trade_5m(
            df5, sig["ts"], side, entry_p, stop_p, tp_p,
            risk, FEE_BPS,
            be_trigger_r=S4_TRIG_R,
            be_offset_r=S4_LOCK_R,
            skip_entry_bucket_hours=0.0,
        )
    else:
        return None

    if res is None:
        return None

    # Risk key for position sizing lookup
    risk_key = stream if not stream.startswith("S1") else f"S1_{sig['sym']}"
    risk_pct = _RISK.get(risk_key, 0.0)

    return {
        "stream":      stream,
        "sym":         sig["sym"],
        "side":        side,
        "entry_ts":    sig["ts"],
        "exit_ts":     res.exit_ts,
        "entry_price": round(entry_p, 8),
        "stop_price":  round(stop_p, 8),
        "tp_price":    round(tp_p, 8),
        "pnl_r":       round(res.pnl_r, 6),
        "reason":      res.reason,
        "bars_5m":     res.bars,
        "risk_pct":    risk_pct,
        # dollar fields filled later during compounding pass
        "balance_before": None,
        "dollar_risk":    None,
        "dollar_pnl":     None,
        "balance_after":  None,
    }


# ── Compounding pass ──────────────────────────────────────────────────────────

def _compound(trades: list[dict], start_balance: float) -> list[dict]:
    """
    Sort trades by exit_ts and apply compounding balance.
    Multiple trades open simultaneously: each uses balance at ITS OWN entry_ts.
    Balance updates on exit, applied in exit_ts order.

    To handle concurrent positions correctly:
      - On entry:  record balance_at_entry = current running balance
      - On exit:   dollar_pnl = balance_at_entry × risk_pct × pnl_r
                   balance += dollar_pnl
    """
    # Index by entry_ts to snapshot balance at open time
    # Sort all events (entries and exits) chronologically
    # We need two passes:
    #   Pass 1: sort by entry_ts, record balance_before for each trade
    #   Pass 2: sort by exit_ts, compound balance using balance_before

    # Separate open/close events
    # For each trade: entry_ts → capture balance at open
    #                 exit_ts  → apply pnl to balance

    balance    = start_balance
    entry_snap: dict[int, float] = {}   # trade_idx → balance at entry

    # Sort trades by entry_ts to capture balance-at-open snapshots
    by_entry = sorted(enumerate(trades), key=lambda x: x[1]["entry_ts"])
    # Sort trades by exit_ts to apply P&L
    by_exit  = sorted(enumerate(trades), key=lambda x: x[1]["exit_ts"])

    # Build entry-order balance snapshots
    # Problem: entries interleave with exits, so we need a unified timeline
    # Build event list: (ts, type, trade_idx)
    events = []
    for i, t in enumerate(trades):
        events.append((t["entry_ts"], 0, i))   # type 0 = entry (snapshot balance)
        events.append((t["exit_ts"],  1, i))   # type 1 = exit  (apply pnl)

    events.sort(key=lambda e: (e[0], e[1]))    # entries before exits on same ts

    balance_snapshots = {}   # trade_idx → balance at entry

    for ts, etype, idx in events:
        t = trades[idx]
        if etype == 0:
            # Entry: snapshot current balance for this trade
            balance_snapshots[idx] = balance
        else:
            # Exit: apply pnl
            bal_at_entry = balance_snapshots.get(idx, start_balance)
            dollar_risk  = bal_at_entry * (t["risk_pct"] / 100.0)
            dollar_pnl   = dollar_risk * t["pnl_r"]
            balance     += dollar_pnl

            t["balance_before"] = round(bal_at_entry, 2)
            t["dollar_risk"]    = round(dollar_risk, 2)
            t["dollar_pnl"]     = round(dollar_pnl, 2)
            t["balance_after"]  = round(balance, 2)

    return trades


# ── Daily equity curve ────────────────────────────────────────────────────────

def _equity_curve(trades: list[dict], start: str, start_balance: float) -> pd.DataFrame:
    """Build daily balance snapshots from trade exits."""
    if not trades:
        return pd.DataFrame()
    rows = [{"date": pd.Timestamp(start).date(), "balance": start_balance,
             "daily_pnl": 0.0}]
    by_day = defaultdict(float)
    for t in trades:
        if t["dollar_pnl"] is None:
            continue
        day = pd.Timestamp(t["exit_ts"]).date()
        by_day[day] += t["dollar_pnl"]

    balance = start_balance
    for day in sorted(by_day):
        balance += by_day[day]
        rows.append({"date": day, "balance": round(balance, 2),
                     "daily_pnl": round(by_day[day], 2)})
    return pd.DataFrame(rows)


def _monthly_breakdown(trades: list[dict]) -> pd.DataFrame:
    """Monthly P&L by stream."""
    rows = []
    for t in trades:
        if t["dollar_pnl"] is None:
            continue
        dt = pd.Timestamp(t["exit_ts"])
        rows.append({
            "year":       dt.year,
            "month":      dt.month,
            "ym":         f"{dt.year}-{dt.month:02d}",
            "stream":     t["stream"],
            "sym":        t["sym"],
            "pnl_r":      t["pnl_r"],
            "dollar_pnl": t["dollar_pnl"],
        })
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    return (df.groupby(["ym", "stream"])
              .agg(n_trades=("pnl_r", "count"),
                   total_r=("pnl_r", "sum"),
                   total_pnl=("dollar_pnl", "sum"))
              .reset_index())


def _stream_summary(trades: list[dict], start_balance: float) -> pd.DataFrame:
    """Per-stream aggregate stats."""
    rows = []
    by_stream = defaultdict(list)
    for t in trades:
        if t["dollar_pnl"] is not None:
            by_stream[t["stream"]].append(t)

    for stream, tlist in sorted(by_stream.items()):
        pnls_r   = np.array([t["pnl_r"]     for t in tlist])
        pnls_usd = np.array([t["dollar_pnl"] for t in tlist])
        n        = len(pnls_r)
        cum      = np.cumsum(pnls_usd)
        dd_usd   = float(np.max(np.maximum.accumulate(cum) - cum)) if n > 0 else 0
        rows.append({
            "stream":      stream,
            "n_trades":    n,
            "win_pct":     round(float((pnls_r > 0).mean() * 100), 1),
            "avg_r":       round(float(pnls_r.mean()), 4),
            "total_r":     round(float(pnls_r.sum()), 2),
            "total_pnl":   round(float(pnls_usd.sum()), 2),
            "maxDD_usd":   round(dd_usd, 2),
            "risk_pct":    round(tlist[0]["risk_pct"], 4),
        })
    return pd.DataFrame(rows)


# ── Main ──────────────────────────────────────────────────────────────────────

def main(db_path: str, start: str, balance: float) -> None:
    print(f"\n{'='*72}")
    print(f"  PORTFOLIO RUNNER — 4 Streams")
    print(f"{'='*72}")
    print(f"  start={start}  balance=${balance:,.0f}  target_DD={TARGET_DD_PCT}%")
    print(f"  Risk%: S1/BTC={_RISK['S1_BTCUSDT']:.2f}% ETH={_RISK['S1_ETHUSDT']:.2f}%"
          f" XRP={_RISK['S1_XRPUSDT']:.2f}% SOL={_RISK['S1_SOLUSDT']:.2f}%"
          f" LINK={_RISK['S1_LINKUSDT']:.2f}%")
    print(f"         S2={_RISK['S2']:.2f}%  S3={_RISK['S3']:.2f}%  S4={_RISK['S4']:.2f}%\n")

    # ── Load data ─────────────────────────────────────────────────────────────
    print(f"  Loading data for {len(SYMS)} symbols...")
    sym_df5:  dict[str, pd.DataFrame] = {}
    sym_df1h: dict[str, pd.DataFrame] = {}

    for sym in SYMS:
        df5, df1h = prepare_sym(db_path, sym, start)
        sym_df5[sym]  = df5
        sym_df1h[sym] = df1h
        print(f"  {sym:<12}  5m={len(df5):>7}  1h={len(df1h):>5}")

    # ── Collect signals ───────────────────────────────────────────────────────
    print(f"\n  Collecting signals...")
    all_sigs: list[dict] = []

    for sym in SYMS:
        s1 = _collect_s1(sym_df5[sym], sym)
        s2 = _collect_s2(sym_df1h[sym], sym_df5[sym], sym)
        s3 = _collect_s3(sym_df1h[sym], sym)
        s4 = _collect_s4(sym_df1h[sym], sym)
        all_sigs.extend(s1 + s2 + s3 + s4)
        print(f"  {sym:<12}  S1={len(s1):>3}  S2={len(s2):>3}  "
              f"S3={len(s3):>3}  S4={len(s4):>3}  total={len(s1)+len(s2)+len(s3)+len(s4):>3}")

    print(f"\n  Total signals: {len(all_sigs)}")

    # ── Replay trades on 5m ───────────────────────────────────────────────────
    print(f"\n  Replaying {len(all_sigs)} trades on 5m bars (parallel)...")

    raw_trades: list[dict] = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {
            ex.submit(_replay_one, sig, sym_df5[sig["sym"]]): sig
            for sig in all_sigs
        }
        for fut in as_completed(futs):
            result = fut.result()
            if result:
                raw_trades.append(result)

    # Sort by entry_ts for the compounding pass
    raw_trades.sort(key=lambda t: (t["entry_ts"], t["stream"]))
    print(f"  Replayed: {len(raw_trades)} valid trades  "
          f"({len(all_sigs)-len(raw_trades)} skipped — no 5m data)\n")

    # ── Compound balance ──────────────────────────────────────────────────────
    print(f"  Compounding balance...")
    trades = _compound(raw_trades, balance)

    # Add trade_id and duration
    for i, t in enumerate(trades):
        t["trade_id"] = i + 1
        if t["entry_ts"] and t["exit_ts"]:
            dur = (pd.Timestamp(t["exit_ts"]) - pd.Timestamp(t["entry_ts"])).total_seconds() / 3600
            t["duration_h"] = round(dur, 2)
        else:
            t["duration_h"] = None

    # ── Build outputs ─────────────────────────────────────────────────────────
    out_dir = REPO_ROOT / "cache"
    out_dir.mkdir(exist_ok=True)

    # Trades CSV
    trades_path = out_dir / "portfolio_trades.csv"
    cols = [
        "trade_id", "stream", "sym", "side", "entry_ts", "exit_ts",
        "duration_h", "entry_price", "stop_price", "tp_price",
        "pnl_r", "reason", "bars_5m", "risk_pct",
        "balance_before", "dollar_risk", "dollar_pnl", "balance_after",
    ]
    pd.DataFrame(trades)[cols].to_csv(trades_path, index=False)

    # Equity curve
    eq = _equity_curve(trades, start, balance)
    eq.to_csv(out_dir / "portfolio_equity.csv", index=False)

    # Monthly breakdown
    monthly = _monthly_breakdown(trades)
    monthly.to_csv(out_dir / "portfolio_monthly.csv", index=False)

    # Stream summary
    summary = _stream_summary(trades, balance)
    summary.to_csv(out_dir / "portfolio_summary.csv", index=False)

    # ── Print results ─────────────────────────────────────────────────────────
    print(f"\n{'='*72}")
    print(f"  STREAM SUMMARY")
    print(f"{'='*72}")
    print(f"  {'Stream':<14}  {'n':>5}  {'win%':>6}  {'total_R':>8}  "
          f"{'total_$':>10}  {'maxDD_$':>8}  {'risk%':>6}")
    print(f"  {'-'*70}")
    for _, r in summary.iterrows():
        print(f"  {r.stream:<14}  {r.n_trades:>5}  {r.win_pct:>5.1f}%  "
              f"{r.total_r:>8.1f}  ${r.total_pnl:>9,.0f}  "
              f"${r.maxDD_usd:>7,.0f}  {r.risk_pct:>5.2f}%")

    # Portfolio totals
    valid = [t for t in trades if t["dollar_pnl"] is not None]
    all_pnl_usd = np.array([t["dollar_pnl"] for t in valid])
    cum = np.cumsum(all_pnl_usd)
    port_dd_usd = float(np.max(np.maximum.accumulate(cum) - cum)) if len(cum) else 0
    final_bal = valid[-1]["balance_after"] if valid else balance
    total_return_pct = (final_bal - balance) / balance * 100

    print(f"\n{'='*72}")
    print(f"  PORTFOLIO TOTALS")
    print(f"{'='*72}")
    print(f"  Start balance:   ${balance:>12,.2f}")
    print(f"  Final balance:   ${final_bal:>12,.2f}")
    print(f"  Total return:     {total_return_pct:>10.1f}%")
    print(f"  Max drawdown:    ${port_dd_usd:>12,.2f}  "
          f"({port_dd_usd/balance*100:.1f}% of start)")
    print(f"  Total trades:    {len(valid):>12,}")

    # Year breakdown
    print(f"\n{'='*72}")
    print(f"  YEAR BREAKDOWN")
    print(f"{'='*72}")
    print(f"  {'Year':<6}  {'n':>5}  {'P&L ($)':>12}  {'Return %':>9}  Balance")
    print(f"  {'-'*50}")
    yr_pnl = defaultdict(float)
    yr_n   = defaultdict(int)
    for t in valid:
        y = pd.Timestamp(t["exit_ts"]).year
        yr_pnl[y] += t["dollar_pnl"]
        yr_n[y]   += 1
    running_yr = balance
    for y in sorted(yr_pnl):
        pnl = yr_pnl[y]
        ret = pnl / running_yr * 100
        running_yr += pnl
        print(f"  {y:<6}  {yr_n[y]:>5}  ${pnl:>11,.0f}  {ret:>8.1f}%  ${running_yr:>12,.0f}")

    print(f"\n{'='*72}")
    print(f"  OUTPUT FILES")
    print(f"{'='*72}")
    print(f"  {trades_path}")
    print(f"  {out_dir/'portfolio_equity.csv'}")
    print(f"  {out_dir/'portfolio_monthly.csv'}")
    print(f"  {out_dir/'portfolio_summary.csv'}")
    print(f"\n  Launch dashboard: streamlit run lab/app.py\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Master portfolio runner — 4 streams")
    ap.add_argument("--db",      default=DEFAULT_DB)
    ap.add_argument("--start",   default=START_DEFAULT)
    ap.add_argument("--balance", type=float, default=BALANCE_START)
    args = ap.parse_args()
    main(db_path=args.db, start=args.start, balance=args.balance)
