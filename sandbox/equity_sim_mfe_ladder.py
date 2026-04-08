#!/usr/bin/env python3
"""
Compound equity simulation: fixed % of *current* equity risked per trade (1R),
applied to per-trade PnL in R from MFE ladder replay (default: 5m realistic).

Optional --max-risk-usd: dollars at risk for 1R is min(%%equity, cap) each trade — limits
how large positions grow in $ terms as the account compounds (common risk control).

Optional withdrawals: fixed amount per month or quarter, taken on the first trade that
opens a new calendar month/quarter. Each withdrawal is capped so equity stays at or
above --min-equity-floor (keeps a "healthy" trading balance; may underpay bills if short).

Default: tuned 3-level MFE lock + TP=8R, same engine entries as other sandbox studies.
Ladder resolution defaults to 5m with lock capping by proven MFE.
"""
from __future__ import annotations

import argparse
import os
import sys

import pandas as pd

_SANDBOX = os.path.dirname(os.path.abspath(__file__))
if _SANDBOX not in sys.path:
    sys.path.insert(0, _SANDBOX)

from ltf_trade_management_study import (  # noqa: E402
    DB_PATH,
    load_4h_and_5m,
    replay_trade_4h_mfe_ladder,
    replay_trade_mfe_ladder_5m,
    tp_price_from_r,
)
from multi_asset_4h_rsi_sim import run_simulation_trades  # noqa: E402

DEFAULT_SYMBOLS = ["XRPUSDT", "BTCUSDT", "SOLUSDT", "LINKUSDT", "DOGEUSDT"]


def collect_replay_pnls(
    *,
    symbols: list[str],
    db: str,
    fee_bps: float,
    rsi_l: int,
    rsi_h: int,
    sl_n: int,
    entry_tp_r: float,
    tp_r: float,
    stages: list[tuple[float, float]],
    resolution: str,
    cap_lock_by_mfe: bool,
) -> pd.DataFrame:
    rows: list[dict] = []
    for sym in symbols:
        df_4h, df_5m = load_4h_and_5m(os.path.abspath(db), sym)
        if df_4h is None or len(df_4h) == 0:
            continue
        o = df_4h["open"].values
        h = df_4h["high"].values
        low = df_4h["low"].values
        rsi = df_4h["RSI"].values
        idx = df_4h.index
        trades = run_simulation_trades(
            o, h, low, rsi, rsi_l, rsi_h, sl_n, entry_tp_r, fee_bps
        )
        for t in trades:
            tp_px = tp_price_from_r(t["entry_price"], t["risk"], t["side"], tp_r)
            if resolution == "5m":
                rr = replay_trade_mfe_ladder_5m(
                    df_5m,
                    idx[t["entry_idx"]],
                    t["side"],
                    t["entry_price"],
                    t["stop_loss"],
                    tp_px,
                    t["risk"],
                    fee_bps,
                    stages=stages,
                    cap_lock_by_mfe=cap_lock_by_mfe,
                )
            else:
                rr = replay_trade_4h_mfe_ladder(
                    idx,
                    h,
                    low,
                    t["entry_idx"],
                    t["side"],
                    t["entry_price"],
                    t["stop_loss"],
                    tp_px,
                    t["risk"],
                    fee_bps,
                    stages=stages,
                )
            if rr is None:
                continue
            rows.append(
                {
                    "exit_ts": rr.exit_ts,
                    "symbol": sym,
                    "pnl_r": rr.pnl_r,
                    "reason": rr.reason,
                }
            )
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows).sort_values(["exit_ts", "symbol"]).reset_index(drop=True)


def _period_key(ts, schedule: str) -> tuple:
    t = pd.Timestamp(ts)
    if schedule == "monthly":
        return (t.year, t.month)
    if schedule == "quarterly":
        q = (t.month - 1) // 3 + 1
        return (t.year, q)
    raise ValueError(schedule)


def compound_equity(
    df: pd.DataFrame,
    *,
    initial: float,
    risk_pct: float,
    max_risk_usd: float | None = None,
    min_equity_floor: float = 0.0,
    withdraw_per_period: float = 0.0,
    withdraw_schedule: str | None = None,
) -> tuple[float, float, list[dict], float, int]:
    """
    Returns:
        final equity, max drawdown %, per-trade rows, total withdrawn,
        count of periods where withdrawal was less than requested (shortfall).
    """
    f = risk_pct / 100.0
    equity = float(initial)
    peak = equity
    max_dd_pct = 0.0
    out_rows: list[dict] = []
    total_withdrawn = 0.0
    shortfall_periods = 0

    use_wd = (
        withdraw_schedule is not None
        and withdraw_schedule in ("monthly", "quarterly")
        and withdraw_per_period > 0
    )
    prev_period: tuple | None = None

    for _, r in df.iterrows():
        wd_this_step = 0.0
        ts = r["exit_ts"]
        if use_wd:
            pk = _period_key(ts, withdraw_schedule or "")
            if prev_period is not None and pk != prev_period:
                due = float(withdraw_per_period)
                can_pay = max(0.0, equity - min_equity_floor)
                w = min(due, can_pay)
                wd_this_step = w
                equity -= w
                total_withdrawn += w
                if w + 1e-6 < due:
                    shortfall_periods += 1
                peak = max(peak, equity)
                dd_pct = (peak - equity) / peak * 100.0 if peak > 0 else 0.0
                max_dd_pct = max(max_dd_pct, dd_pct)
            prev_period = pk

        base = equity * f
        if max_risk_usd is not None:
            dollars_at_1r = min(base, max_risk_usd)
        else:
            dollars_at_1r = base
        pnl_usd = dollars_at_1r * float(r["pnl_r"])
        equity = equity + pnl_usd
        peak = max(peak, equity)
        dd_pct = (peak - equity) / peak * 100.0 if peak > 0 else 0.0
        max_dd_pct = max(max_dd_pct, dd_pct)
        row = {
            "exit_ts": r["exit_ts"],
            "symbol": r["symbol"],
            "pnl_r": r["pnl_r"],
            "reason": r["reason"],
            "withdrawal_usd": round(wd_this_step, 2),
            "risk_usd_1r": round(dollars_at_1r, 2),
            "pnl_usd": round(pnl_usd, 2),
            "equity": round(equity, 2),
        }
        if use_wd:
            row["period"] = str(_period_key(r["exit_ts"], withdraw_schedule or ""))
        out_rows.append(row)

    return equity, max_dd_pct, out_rows, total_withdrawn, shortfall_periods


def min_cap_for_target_equity(
    df: pd.DataFrame,
    *,
    initial: float,
    risk_pct: float,
    target: float,
) -> tuple[float | None, float]:
    """
    Smallest max_risk_usd such that compound_equity(..., cap) >= target.
    Larger cap => higher final equity (monotone on this path).
    """
    eq_uncapped, _, _, _, _ = compound_equity(
        df, initial=initial, risk_pct=risk_pct, max_risk_usd=None
    )
    if eq_uncapped < target:
        return None, eq_uncapped

    lo, hi = 1e-6, 100.0
    while True:
        e, _, _, _, _ = compound_equity(
            df, initial=initial, risk_pct=risk_pct, max_risk_usd=hi
        )
        if e >= target or hi > 1e12:
            break
        hi *= 2

    if compound_equity(df, initial=initial, risk_pct=risk_pct, max_risk_usd=hi)[0] < target:
        return None, eq_uncapped

    left, right = lo, hi
    for _ in range(90):
        mid = (left + right) / 2.0
        e, _, _, _, _ = compound_equity(
            df, initial=initial, risk_pct=risk_pct, max_risk_usd=mid
        )
        if e >= target:
            right = mid
        else:
            left = mid
    return right, eq_uncapped


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Compound $ equity from 3-level MFE replay with %% risk per 1R"
    )
    ap.add_argument("--initial", type=float, default=10_000.0, help="Starting equity ($)")
    ap.add_argument(
        "--risk-pct",
        type=float,
        default=2.5,
        help="Fraction of equity at risk for 1R before cap (e.g. 2.5 = 2.5%%)",
    )
    ap.add_argument(
        "--max-risk-usd",
        type=float,
        default=None,
        help="Cap $ at risk for 1R per trade: min(%%equity, this). Omit for no cap.",
    )
    ap.add_argument(
        "--solve-target",
        type=float,
        default=None,
        help="Find minimum --max-risk-usd needed to reach this final equity on this path (implies run)",
    )
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--fee-bps", type=float, default=3.0)
    ap.add_argument("--rsi-l", type=int, default=35)
    ap.add_argument("--rsi-h", type=int, default=60)
    ap.add_argument("--sl-n", type=int, default=3)
    ap.add_argument("--entry-tp-r", type=float, default=5.0)
    ap.add_argument("--tp-r", type=float, default=8.0, help="Management / replay TP (R)")
    ap.add_argument("--mfe1", type=float, default=0.5)
    ap.add_argument("--lock1", type=float, default=1.0)
    ap.add_argument("--mfe2", type=float, default=1.25)
    ap.add_argument("--lock2", type=float, default=3.0)
    ap.add_argument("--mfe3", type=float, default=4.0)
    ap.add_argument("--lock3", type=float, default=6.0)
    ap.add_argument("--symbols", type=str, default=",".join(DEFAULT_SYMBOLS))
    ap.add_argument("--resolution", choices=["5m", "4h"], default="5m")
    ap.add_argument("--uncapped-lock", action="store_true", help="5m only: disable lock cap by proven MFE")
    ap.add_argument(
        "--csv",
        type=str,
        default="",
        help="Optional path to write per-trade equity curve CSV",
    )
    ap.add_argument(
        "--min-equity-floor",
        type=float,
        default=10_000.0,
        help="When using withdrawals: never pull equity below this ($). Bills are min(request, equity−floor).",
    )
    ap.add_argument(
        "--withdraw-monthly",
        type=float,
        default=0.0,
        metavar="USD",
        help="Bill amount each calendar month, taken on first trade of a new month. 0 = off.",
    )
    ap.add_argument(
        "--withdraw-quarterly",
        type=float,
        default=0.0,
        metavar="USD",
        help="Bill amount each quarter, taken on first trade of a new quarter. 0 = off.",
    )
    args = ap.parse_args()

    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    stages = [
        (args.mfe1, args.lock1),
        (args.mfe2, args.lock2),
        (args.mfe3, args.lock3),
    ]

    cap_lock = not args.uncapped_lock
    df = collect_replay_pnls(
        symbols=symbols,
        db=args.db,
        fee_bps=args.fee_bps,
        rsi_l=args.rsi_l,
        rsi_h=args.rsi_h,
        sl_n=args.sl_n,
        entry_tp_r=args.entry_tp_r,
        tp_r=args.tp_r,
        stages=stages,
        resolution=args.resolution,
        cap_lock_by_mfe=cap_lock,
    )
    if df.empty:
        print("No trades.")
        return

    if args.withdraw_monthly > 0 and args.withdraw_quarterly > 0:
        raise SystemExit("Use only one of --withdraw-monthly or --withdraw-quarterly (not both).")

    wd_sched: str | None = None
    wd_amt = 0.0
    if args.withdraw_monthly > 0:
        wd_sched, wd_amt = "monthly", args.withdraw_monthly
    elif args.withdraw_quarterly > 0:
        wd_sched, wd_amt = "quarterly", args.withdraw_quarterly

    n = len(df)
    solved_cap: float | None = None

    if args.solve_target is not None:
        cap, eq_inf = min_cap_for_target_equity(
            df,
            initial=args.initial,
            risk_pct=args.risk_pct,
            target=args.solve_target,
        )
        print("Solve: minimum $ at risk for 1R (cap) to reach target final equity on this path")
        print("=" * 60)
        print(f"  Initial:          ${args.initial:,.2f}")
        print(f"  Risk % (pre-cap): {args.risk_pct}% of equity each trade")
        print(f"  Target final:     ${args.solve_target:,.2f}")
        print(f"  Uncapped final:   ${eq_inf:,.2f}")
        if cap is None:
            print("  Cannot reach target: uncapped simulation ends below target.")
            return
        eq_c, dd_c, _, _, _ = compound_equity(
            df,
            initial=args.initial,
            risk_pct=args.risk_pct,
            max_risk_usd=cap,
        )
        solved_cap = cap
        print(f"  Minimum cap:      ${cap:,.2f}  (risk per 1R = min(% of equity, cap))")
        print(f"  Achieved final:   ${eq_c:,.2f}  | max DD: {dd_c:.2f}%")
        pct_of_10k = cap / args.initial * 100.0
        print(
            f"  Meaning: after equity grows, 2.5% of equity is floored so each 1R risks at most ${cap:,.0f} "
            f"({pct_of_10k:.1f}% of initial $ — at $10k start, uncapped risk is ${args.initial * args.risk_pct / 100:,.0f}/1R until equity exceeds ${cap / (args.risk_pct / 100):,.0f})."
        )
        print()

    # Explicit --max-risk-usd overrides; else use solved cap when --solve-target was used.
    effective_cap = (
        args.max_risk_usd
        if args.max_risk_usd is not None
        else solved_cap
    )

    equity, max_dd_pct, out_rows, total_wd, shortfalls = compound_equity(
        df,
        initial=args.initial,
        risk_pct=args.risk_pct,
        max_risk_usd=effective_cap,
        min_equity_floor=args.min_equity_floor,
        withdraw_per_period=wd_amt,
        withdraw_schedule=wd_sched,
    )

    ret_pct = (equity / args.initial - 1.0) * 100.0

    print("Equity simulation — 3-level MFE ladder replay")
    print("=" * 60)
    print(f"  Start equity:     ${args.initial:,.2f}")
    cap_desc = (
        f"min({args.risk_pct}% of equity, ${effective_cap:,.2f})"
        if effective_cap is not None
        else f"{args.risk_pct}% of equity (no $ cap)"
    )
    print(f"  Risk per 1R:      {cap_desc}")
    print(f"  TP (replay):      {args.tp_r}R | stages: {stages}")
    print(f"  Ladder replay:    {args.resolution} (cap_lock_by_mfe={cap_lock})")
    if wd_sched:
        print(
            f"  Withdrawals:      ${wd_amt:,.2f} per {wd_sched} period "
            f"(floor ${args.min_equity_floor:,.2f} min equity)"
        )
        print(f"  Total withdrawn:  ${total_wd:,.2f}  | shortfall periods: {shortfalls} (bill not paid in full)")
    else:
        print("  Withdrawals:      off")
    print(f"  Trades processed: {n} (exit-time order, all symbols merged)")
    print(f"  Final equity:     ${equity:,.2f}")
    print(f"  Total return:     {ret_pct:+.2f}%")
    print(f"  Max drawdown:     {max_dd_pct:.2f}% (compounded equity path)")
    print(
        "  Note: In-sample path only; caps control $ exposure growth, not live guarantees."
    )
    print()

    if args.csv:
        outp = os.path.abspath(args.csv)
        d = os.path.dirname(outp)
        if d:
            os.makedirs(d, exist_ok=True)
        pd.DataFrame(out_rows).to_csv(outp, index=False)
        print(f"Wrote per-trade curve → {outp}")


if __name__ == "__main__":
    main()
