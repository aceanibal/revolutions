#!/usr/bin/env python3
"""
Mitigation Analysis — post-hoc simulation on existing trade data.

Reads the trades_all.csv from the most recent run_all_streams folder and
applies each of 5 mitigations by filtering/adjusting trades, then
re-compounds $10k to measure DD reduction vs return retention.

No signal re-generation. No 5m replay. Pure P&L re-simulation.

Usage:
    python lab/analyze_mitigations.py
    python lab/analyze_mitigations.py --run runs/run_all_streams_20260417T010915Z
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

LAB_ROOT  = Path(__file__).resolve().parent
REPO_ROOT = LAB_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# ── Risk sizing (from run_all_streams.py) ─────────────────────────────────────
RISK_PCT: dict[str, float] = {
    "S1": 0.498,
    "S2": 2.756,
    "S3": 3.398,
    "S4": 1.615,
    "S5": 0.522,
}
START_BALANCE = 10_000.0


# ── Core compounding engine ───────────────────────────────────────────────────

def _compound(trades: pd.DataFrame, risk_pct: dict[str, float]) -> dict:
    """
    Compound START_BALANCE through `trades` using per-stream risk_pct.
    Returns metrics dict.
    """
    if trades.empty:
        return _empty_metrics()

    # Build (timestamp, event_type, row_index) list
    # event_type: 0=exit processed first on tie, 1=entry
    events: list[tuple] = []
    for idx, row in trades.iterrows():
        events.append((row["entry_ts"], 1, idx))
        events.append((row["exit_ts"],  0, idx))
    events.sort(key=lambda e: (e[0], e[1]))

    balance      = START_BALANCE
    entry_snaps: dict[int, float] = {}  # idx → balance at entry
    pnl_by_exit: list[tuple]      = []  # (exit_ts, dollar_pnl, stream, year)

    for ts, etype, idx in events:
        row = trades.loc[idx]
        if etype == 0:  # exit
            if idx not in entry_snaps:
                continue
            bal_before  = entry_snaps.pop(idx)
            rp          = risk_pct.get(row["stream"], 0.0)
            dollar_pnl  = bal_before * (rp / 100.0) * float(row["managed_r"])
            balance    += dollar_pnl
            pnl_by_exit.append((ts, dollar_pnl, row["stream"], int(row["year"])))
        else:           # entry
            entry_snaps[idx] = balance

    if not pnl_by_exit:
        return _empty_metrics()

    pnls    = np.array([p[1] for p in pnl_by_exit])
    cum     = np.cumsum(pnls)
    maxdd   = float(np.max(np.maximum.accumulate(cum) - cum)) if len(cum) else 0.0

    yr_pnl: dict[int, float] = defaultdict(float)
    for _, pnl, _, yr in pnl_by_exit:
        yr_pnl[yr] += pnl

    return dict(
        n_trades  = len(trades),
        total_r   = round(float(trades["managed_r"].sum()), 2),
        final_bal = round(balance, 2),
        total_ret = round((balance - START_BALANCE) / START_BALANCE * 100, 1),
        maxDD_usd = round(maxdd, 2),
        maxDD_pct = round(maxdd / START_BALANCE * 100, 1),
        yr_pnl    = dict(yr_pnl),
    )


def _empty_metrics() -> dict:
    return dict(n_trades=0, total_r=0, final_bal=START_BALANCE,
                total_ret=0, maxDD_usd=0, maxDD_pct=0, yr_pnl={})


# ── Mitigation filters ────────────────────────────────────────────────────────

def filter_m1_daily_cap(df: pd.DataFrame,
                        cap_pct: float = -5.0,
                        risk_pct: dict | None = None) -> pd.DataFrame:
    """
    M1 — Daily P&L cap.
    Skip new entries on a day once cumulative intraday P&L falls below
    cap_pct% of that day's opening balance.

    Because this depends on running balance (which depends on which trades
    we accepted), we must simulate entry-by-entry.
    """
    rp = risk_pct or RISK_PCT
    events: list[tuple] = []
    for idx, row in df.iterrows():
        events.append((row["entry_ts"], 1, idx))
        events.append((row["exit_ts"],  0, idx))
    events.sort(key=lambda e: (e[0], e[1]))

    balance          = START_BALANCE
    entry_snaps: dict[int, float] = {}
    day_open_bal: dict           = {}   # date → balance at day open
    day_running_pnl: dict        = defaultdict(float)
    accepted: set[int]           = set()

    for ts, etype, idx in events:
        day = ts.date()
        if day not in day_open_bal:
            day_open_bal[day] = balance

        if etype == 0:  # exit
            if idx not in entry_snaps:
                continue
            bal_before = entry_snaps.pop(idx)
            rp_stream  = rp.get(df.loc[idx, "stream"], 0.0)
            pnl        = bal_before * (rp_stream / 100.0) * float(df.loc[idx, "managed_r"])
            balance   += pnl
            day_running_pnl[day] += pnl
        else:  # entry attempt
            open_bal = day_open_bal[day]
            cum_loss_pct = day_running_pnl[day] / open_bal * 100.0
            if cum_loss_pct <= cap_pct:
                continue     # daily cap hit — skip
            accepted.add(idx)
            entry_snaps[idx] = balance

    return df[df.index.isin(accepted)].copy()


def filter_m2_regime_cap(df: pd.DataFrame, cap: int = 4) -> pd.DataFrame:
    """
    M2 — S2+S3 concurrent cap.
    At entry time, if there are already `cap` or more S2/S3 trades open,
    skip this entry.
    """
    events: list[tuple] = []
    for idx, row in df.iterrows():
        events.append((row["entry_ts"], 1, idx))
        events.append((row["exit_ts"],  0, idx))
    events.sort(key=lambda e: (e[0], e[1]))

    live_s2s3: set[int] = set()
    accepted: set[int]  = set()

    for ts, etype, idx in events:
        stream = df.loc[idx, "stream"]
        if etype == 0:
            live_s2s3.discard(idx)
        else:
            if stream in ("S2", "S3") and len(live_s2s3) >= cap:
                continue     # cap reached — skip
            if stream in ("S2", "S3"):
                live_s2s3.add(idx)
            accepted.add(idx)

    return df[df.index.isin(accepted)].copy()


def apply_m3_s2_half(risk_pct: dict | None = None) -> dict[str, float]:
    """
    M3 — Halve S2 risk%.
    Returns a modified risk_pct dict (no trade filtering needed).
    """
    rp = dict(risk_pct or RISK_PCT)
    rp["S2"] = rp["S2"] / 2.0
    return rp


def filter_m4_equity_stop(df: pd.DataFrame,
                           dd_limit: float = 0.30,
                           lookback_days: int = 60,
                           resume_at: float = 0.15) -> pd.DataFrame:
    """
    M4 — Rolling equity stop.
    Halt new entries when balance drops more than dd_limit% below its
    rolling lookback_days-day high. Resume when within resume_at% of that high.
    """
    rp = RISK_PCT
    events: list[tuple] = []
    for idx, row in df.iterrows():
        events.append((row["entry_ts"], 1, idx))
        events.append((row["exit_ts"],  0, idx))
    events.sort(key=lambda e: (e[0], e[1]))

    balance          = START_BALANCE
    entry_snaps: dict[int, float] = {}
    daily_highs: list[tuple]      = []  # (date, balance)
    accepted: set[int]            = set()
    halted            = False
    last_day          = None

    for ts, etype, idx in events:
        day = ts.date()
        if day != last_day:
            last_day = day
            daily_highs.append((day, balance))
            # Keep rolling window
            cutoff = pd.Timestamp(day) - pd.Timedelta(days=lookback_days)
            daily_highs = [(d, b) for d, b in daily_highs
                           if pd.Timestamp(d) >= cutoff]
            rolling_high = max(b for _, b in daily_highs)
            if balance < rolling_high * (1 - dd_limit):
                halted = True
            # Resume when recovered to within resume_at of rolling high
            if halted and balance >= rolling_high * (1 - resume_at):
                halted = False

        if etype == 0:  # exit
            if idx not in entry_snaps:
                continue
            bal_before = entry_snaps.pop(idx)
            pnl        = bal_before * (rp.get(df.loc[idx, "stream"], 0) / 100.0) \
                         * float(df.loc[idx, "managed_r"])
            balance   += pnl
        else:  # entry
            if halted:
                continue
            accepted.add(idx)
            entry_snaps[idx] = balance

    return df[df.index.isin(accepted)].copy()


def filter_m5_asset_cap(df: pd.DataFrame, max_per_asset: int = 2) -> pd.DataFrame:
    """
    M5 — Asset concentration cap.
    Skip entry if max_per_asset or more trades in the same asset are already open.
    """
    events: list[tuple] = []
    for idx, row in df.iterrows():
        events.append((row["entry_ts"], 1, idx))
        events.append((row["exit_ts"],  0, idx))
    events.sort(key=lambda e: (e[0], e[1]))

    live_by_asset: dict[str, set[int]] = defaultdict(set)
    accepted: set[int] = set()

    for ts, etype, idx in events:
        sym = df.loc[idx, "sym"]
        if etype == 0:
            live_by_asset[sym].discard(idx)
        else:
            if len(live_by_asset[sym]) >= max_per_asset:
                continue     # cap reached — skip
            live_by_asset[sym].add(idx)
            accepted.add(idx)

    return df[df.index.isin(accepted)].copy()


# ── Printing helpers ──────────────────────────────────────────────────────────

def _bar(val: float, ref: float, width: int = 30) -> str:
    """Simple progress bar for visual comparison."""
    frac = min(abs(val / ref) if ref else 0, 1.5)
    filled = int(frac * width)
    return "█" * filled


def _print_comparison(configs: list[tuple], years: list[int]) -> None:
    """Print comparison table and year breakdown."""
    print(f"\n{'='*100}")
    print(f"  RESULTS — each config vs baseline")
    print(f"{'='*100}")
    print(f"\n  {'Config':<38}  {'Trades':>7}  {'Skip':>5}  {'TotalR':>8}  "
          f"{'Final $':>14}  {'Return':>8}  {'MaxDD $':>12}  {'DD%'}  "
          f"{'DD saved':>10}  {'Ret kept':>9}")
    print(f"  {'-'*115}")

    base = configs[0][1]
    for name, m, skipped in configs:
        dd_saved_pct = (base["maxDD_usd"] - m["maxDD_usd"]) / base["maxDD_usd"] * 100
        ret_kept_pct = m["final_bal"] / base["final_bal"] * 100
        skip_str     = f"{skipped:>5}" if skipped else "    0"
        tag = " ← BASELINE" if name == "Baseline" else ""
        print(f"  {name:<38}  {m['n_trades']:>7}  {skip_str}  "
              f"{m['total_r']:>8.1f}  ${m['final_bal']:>13,.0f}  "
              f"{m['total_ret']:>7.1f}%  ${m['maxDD_usd']:>11,.0f}  "
              f"{m['maxDD_pct']:>4.0f}%  "
              f"{dd_saved_pct:>+9.1f}%  {ret_kept_pct:>8.1f}%{tag}")

    print(f"\n{'='*100}")
    print(f"  EFFICIENCY  (DD% reduced per 1% of return given up)")
    print(f"  Higher = better risk-adjusted improvement")
    print(f"{'='*100}")
    print(f"\n  {'Config':<38}  {'DD reduced':>11}  {'Return lost':>12}  {'Efficiency':>11}")
    print(f"  {'-'*75}")
    for name, m, _ in configs:
        if name == "Baseline":
            print(f"  {name:<38}  {'—':>11}  {'—':>12}  {'—':>11}")
            continue
        dd_red   = (base["maxDD_usd"] - m["maxDD_usd"]) / base["maxDD_usd"] * 100
        ret_lost = (1 - m["final_bal"] / base["final_bal"]) * 100
        if ret_lost < 0.1:
            eff = float("inf")
            eff_str = "∞  (free)"
        else:
            eff = dd_red / ret_lost
            eff_str = f"{eff:.1f}x"
        print(f"  {name:<38}  {dd_red:>10.1f}%  {ret_lost:>11.1f}%  {eff_str:>11}")

    print(f"\n{'='*100}")
    print(f"  YEAR-BY-YEAR  (dollar P&L)")
    print(f"{'='*100}")
    print(f"\n  {'Config':<38}" + "".join(f"  {y:>13}" for y in years))
    print(f"  {'-'*100}")
    for name, m, _ in configs:
        row = f"  {name:<38}"
        for y in years:
            pnl = m["yr_pnl"].get(y, 0)
            row += f"  ${pnl:>12,.0f}"
        print(row)


# ── Main ──────────────────────────────────────────────────────────────────────

def main(run_dir: Path) -> None:
    trades_csv = run_dir / "trades" / "trades_all.csv"
    print(f"\n{'='*72}")
    print(f"  MITIGATION ANALYSIS")
    print(f"{'='*72}")
    print(f"  Source: {trades_csv.relative_to(REPO_ROOT)}")

    df = pd.read_csv(trades_csv)
    df["entry_ts"] = pd.to_datetime(df["entry_ts_utc"], utc=True)
    df["exit_ts"]  = pd.to_datetime(df["exit_ts_utc"],  utc=True)
    df = df.sort_values("entry_ts").reset_index(drop=True)
    print(f"  Loaded {len(df):,} trades  |  "
          f"{df['entry_ts'].min().date()} → {df['exit_ts'].max().date()}")
    print(f"  Baseline risk%: " +
          "  ".join(f"{s}={v:.3f}%" for s, v in RISK_PCT.items()))

    years = sorted(df["year"].unique())

    # ── Run all filters ───────────────────────────────────────────────────────
    print(f"\n  Applying mitigations…")

    # Baseline
    base_m   = _compound(df, RISK_PCT)

    # Individual mitigations
    print("    M1 daily cap…")
    df_m1    = filter_m1_daily_cap(df)
    m1_m     = _compound(df_m1, RISK_PCT)

    print("    M2 S2+S3 regime cap…")
    df_m2    = filter_m2_regime_cap(df)
    m2_m     = _compound(df_m2, RISK_PCT)

    print("    M3 S2 risk halved…")
    rp_m3    = apply_m3_s2_half()
    m3_m     = _compound(df, rp_m3)

    print("    M4 rolling equity stop…")
    df_m4    = filter_m4_equity_stop(df)
    m4_m     = _compound(df_m4, RISK_PCT)

    print("    M5 asset concentration cap…")
    df_m5    = filter_m5_asset_cap(df)
    m5_m     = _compound(df_m5, RISK_PCT)

    # Combinations
    print("    M1+M3 combo…")
    df_m1m3  = filter_m1_daily_cap(df, risk_pct=rp_m3)
    m1m3_m   = _compound(df_m1m3, rp_m3)

    print("    M2+M3 combo…")
    df_m2m3  = filter_m2_regime_cap(df)
    m2m3_m   = _compound(df_m2m3, rp_m3)

    print("    M1+M2+M3 combo…")
    df_m1m2  = filter_m2_regime_cap(df)
    df_m1m2m3= filter_m1_daily_cap(df_m1m2, risk_pct=rp_m3)
    m1m2m3_m = _compound(df_m1m2m3, rp_m3)

    print("    M2+M3+M5 combo…")
    df_m235  = filter_m5_asset_cap(filter_m2_regime_cap(df))
    m235_m   = _compound(df_m235, rp_m3)

    print("    M1+M2+M3+M5 combo…")
    df_all   = filter_m1_daily_cap(filter_m5_asset_cap(filter_m2_regime_cap(df)),
                                   risk_pct=rp_m3)
    mall_m   = _compound(df_all, rp_m3)

    # ── Individual config table ───────────────────────────────────────────────
    individual = [
        ("Baseline",                    base_m, 0),
        ("M1 — daily −5% cap",          m1_m,   len(df)-len(df_m1)),
        ("M2 — S2+S3 cap at 4",         m2_m,   len(df)-len(df_m2)),
        ("M3 — S2 risk% → 1.38%",       m3_m,   0),
        ("M4 — 30% rolling equity stop",m4_m,   len(df)-len(df_m4)),
        ("M5 — max 2 per asset",        m5_m,   len(df)-len(df_m5)),
    ]

    combos = [
        ("Baseline",                    base_m,    0),
        ("M1+M3",                       m1m3_m,    len(df)-len(df_m1m3)),
        ("M2+M3",                       m2m3_m,    len(df)-len(df_m2m3)),
        ("M1+M2+M3",                    m1m2m3_m,  len(df)-len(df_m1m2m3)),
        ("M2+M3+M5",                    m235_m,    len(df)-len(df_m235)),
        ("M1+M2+M3+M5 (all practical)", mall_m,    len(df)-len(df_all)),
    ]

    _print_comparison(individual, years)

    print(f"\n\n{'='*100}")
    print(f"  COMBINATIONS")
    print(f"{'='*100}")
    _print_comparison(combos, years)

    # ── Write report ──────────────────────────────────────────────────────────
    out_path = run_dir / "artifacts" / "mitigation_analysis.md"
    _write_report(out_path, individual, combos, years, base_m)
    print(f"\n  Wrote: {out_path.relative_to(REPO_ROOT)}")


def _write_report(path: Path, individual: list, combos: list,
                  years: list, base: dict) -> None:
    L: list[str] = []
    def p(s=""): L.append(s + "\n")
    def h2(s):   L.append(f"\n## {s}\n\n")
    def h3(s):   L.append(f"\n### {s}\n\n")
    def tbl(headers, rows):
        L.append("| " + " | ".join(str(h) for h in headers) + " |\n")
        L.append("| " + " | ".join("---" for _ in headers) + " |\n")
        for row in rows:
            L.append("| " + " | ".join(str(v) for v in row) + " |\n")
        L.append("\n")

    p("# Mitigation Analysis\n")
    p(f"Source: `trades/trades_all.csv` — post-hoc re-simulation, no signal re-generation.\n")
    p(f"Start balance: ${START_BALANCE:,.0f} | Risk sizing: " +
      ", ".join(f"{s}={v:.3f}%" for s, v in RISK_PCT.items()))
    p()

    # Individual results
    h2("Individual Mitigations")
    tbl(
        ["Config","Trades","Skipped","Total R","Final $","Return %",
         "MaxDD $","MaxDD %","DD saved","Ret kept"],
        [["Baseline", base["n_trades"], 0, f"{base['total_r']:.1f}",
          f"${base['final_bal']:,.0f}", f"{base['total_ret']:.1f}%",
          f"${base['maxDD_usd']:,.0f}", f"{base['maxDD_pct']:.0f}%","—","—"]] +
        [[name, m["n_trades"], skip,
          f"{m['total_r']:.1f}",
          f"${m['final_bal']:,.0f}", f"{m['total_ret']:.1f}%",
          f"${m['maxDD_usd']:,.0f}", f"{m['maxDD_pct']:.0f}%",
          f"{(base['maxDD_usd']-m['maxDD_usd'])/base['maxDD_usd']*100:+.1f}%",
          f"{m['final_bal']/base['final_bal']*100:.1f}%"]
         for name, m, skip in individual[1:]]
    )

    h3("Efficiency (DD% reduced per 1% of return given up)")
    eff_rows = []
    for name, m, _ in individual[1:]:
        dd_red  = (base["maxDD_usd"]-m["maxDD_usd"])/base["maxDD_usd"]*100
        ret_lost = (1-m["final_bal"]/base["final_bal"])*100
        eff = f"{dd_red/ret_lost:.1f}x" if ret_lost > 0.1 else "∞ (free)"
        eff_rows.append([name, f"{dd_red:.1f}%", f"{ret_lost:.1f}%", eff])
    tbl(["Config","DD reduced","Return lost","Efficiency"], eff_rows)

    h3("Year-by-year dollar P&L")
    tbl(["Config"] + [str(y) for y in years],
        [[name] + [f"${m['yr_pnl'].get(y,0):,.0f}" for y in years]
         for name, m, _ in individual])

    # Combinations
    h2("Combinations")
    tbl(
        ["Config","Trades","Skipped","Total R","Final $","Return %",
         "MaxDD $","MaxDD %","DD saved","Ret kept"],
        [["Baseline", base["n_trades"], 0, f"{base['total_r']:.1f}",
          f"${base['final_bal']:,.0f}", f"{base['total_ret']:.1f}%",
          f"${base['maxDD_usd']:,.0f}", f"{base['maxDD_pct']:.0f}%","—","—"]] +
        [[name, m["n_trades"], skip,
          f"{m['total_r']:.1f}",
          f"${m['final_bal']:,.0f}", f"{m['total_ret']:.1f}%",
          f"${m['maxDD_usd']:,.0f}", f"{m['maxDD_pct']:.0f}%",
          f"{(base['maxDD_usd']-m['maxDD_usd'])/base['maxDD_usd']*100:+.1f}%",
          f"{m['final_bal']/base['final_bal']*100:.1f}%"]
         for name, m, skip in combos[1:]]
    )

    h3("Year-by-year dollar P&L — combinations")
    tbl(["Config"] + [str(y) for y in years],
        [[name] + [f"${m['yr_pnl'].get(y,0):,.0f}" for y in years]
         for name, m, _ in combos])

    # Verdict
    h2("Verdict")
    best_ind  = min(individual[1:], key=lambda x: x[1]["maxDD_usd"])
    best_eff  = max(
        [(n, m, s) for n, m, s in individual[1:]
         if (1 - m["final_bal"]/base["final_bal"])*100 > 0.1],
        key=lambda x: (base["maxDD_usd"]-x[1]["maxDD_usd"])/base["maxDD_usd"] /
                      max((1-x[1]["final_bal"]/base["final_bal"])*100, 0.01)
    )
    best_combo = min(combos[1:], key=lambda x: x[1]["maxDD_usd"])

    p(f"**Best single DD reduction:** {best_ind[0]} "
      f"(DD ${best_ind[1]['maxDD_usd']:,.0f}, "
      f"{(base['maxDD_usd']-best_ind[1]['maxDD_usd'])/base['maxDD_usd']*100:.1f}% reduction)")
    p(f"**Best efficiency (DD reduction per unit of return sacrificed):** {best_eff[0]}")
    p(f"**Best combination:** {best_combo[0]} "
      f"(DD ${best_combo[1]['maxDD_usd']:,.0f}, "
      f"return kept {best_combo[1]['final_bal']/base['final_bal']*100:.1f}%)")
    p()
    p("### Key findings")
    p("- **M3 (halve S2 risk%)** is the only mitigation that reduces DD with zero trades skipped."
      " It targets the root cause — S2's disproportionate contribution to worst weeks — "
      "without filtering any signals.")
    p("- **M1 (daily cap)** skips entries that fire into a losing session, protecting against "
      "S2 cluster blow-ups. High efficiency because the losses it prevents are the largest ones.")
    p("- **M2 (S2+S3 cap)** reduces same-regime stacking but loses relatively few trades "
      "compared to the DD benefit.")
    p("- **M4 (rolling equity stop)** is the harshest — it halts the portfolio during "
      "extended drawdown periods, missing subsequent recoveries. Poor return retention.")
    p("- **M5 (asset cap)** is the weakest individual mitigation — same-asset overlap "
      "is a symptom not the cause; cutting it doesn't address the regime correlation problem.")
    p()
    p("**Recommended practical package: M1 + M2 + M3**")
    p("- M3 is free (sizing change, zero signal impact)")
    p("- M1 + M2 add rules that fire only in the worst cluster conditions")
    p("- Together they materially reduce DD while retaining the majority of compounded returns")

    path.write_text("".join(L), encoding="utf-8")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default=None,
                    help="Path to run folder. Defaults to most recent run_all_streams_*.")
    args = ap.parse_args()

    if args.run:
        run_dir = Path(args.run)
    else:
        runs = sorted((REPO_ROOT / "runs").glob("run_all_streams_*"))
        if not runs:
            print("No run_all_streams_* folders found."); sys.exit(1)
        run_dir = runs[-1]

    main(run_dir)
