#!/usr/bin/env python3
"""
Generate equity/report artifacts from a trade-details CSV.

The script simulates fixed-fractional position sizing:
    pnl_$ = equity_before_trade * risk_fraction * trade_R

Designed for RSI run artifacts such as:
    runs/<run_id>/trades/trade_details_v1_tp8p0.csv
"""
from __future__ import annotations

import argparse
import glob
from pathlib import Path

import numpy as np
import pandas as pd


def _safe_div(a: float, b: float) -> float:
    if b == 0:
        return 0.0
    return a / b


def _fmt_money(x: float) -> str:
    return f"${x:,.2f}"


def _fmt_pct(x: float) -> str:
    return f"{x * 100:.2f}%"


def simulate_equity(
    trades: pd.DataFrame,
    *,
    r_column: str,
    start_balance: float,
    risk_fraction: float,
    max_risk_usd: float,
    withdrawal_quarterly_pct: float,
) -> pd.DataFrame:
    eq = float(start_balance)
    peak = float(start_balance)
    rows: list[dict] = []
    withdrawals: list[dict] = []
    cumulative_withdrawn = 0.0
    q_start_equity = float(start_balance)

    trades_local = trades.copy()
    trades_local["exit_ts_utc"] = pd.to_datetime(trades_local["exit_ts_utc"], utc=True)
    trades_local["quarter"] = trades_local["exit_ts_utc"].dt.to_period("Q")

    for i, tr in trades_local.iterrows():
        r = float(tr[r_column])
        ts = pd.Timestamp(tr["exit_ts_utc"]).tz_convert("UTC")
        eq_before = eq
        risk_usd = eq_before * risk_fraction
        if max_risk_usd > 0:
            risk_usd = min(risk_usd, max_risk_usd)
        pnl = risk_usd * r
        eq = eq_before + pnl
        peak = max(peak, eq)
        dd_abs = peak - eq
        dd_pct = _safe_div(eq, peak) - 1.0
        withdrawal_usd = 0.0

        # At quarter boundary (or end), withdraw a share of positive quarter profit.
        cur_q = tr["quarter"]
        is_last_trade = i == (len(trades_local) - 1)
        next_q = trades_local.iloc[i + 1]["quarter"] if not is_last_trade else None
        quarter_ended = is_last_trade or (next_q != cur_q)
        if quarter_ended and withdrawal_quarterly_pct > 0:
            quarter_profit = eq - q_start_equity
            if quarter_profit > 0:
                withdrawal_usd = quarter_profit * withdrawal_quarterly_pct
                eq -= withdrawal_usd
                cumulative_withdrawn += withdrawal_usd
                withdrawals.append(
                    {
                        "quarter": str(cur_q),
                        "quarter_start_equity": q_start_equity,
                        "quarter_end_pre_withdrawal": q_start_equity + quarter_profit,
                        "quarter_profit": quarter_profit,
                        "withdrawal_pct": withdrawal_quarterly_pct,
                        "withdrawal_usd": withdrawal_usd,
                        "equity_after_withdrawal": eq,
                        "event_ts_utc": ts.isoformat(),
                    }
                )
            q_start_equity = eq

        peak = max(peak, eq)
        dd_abs = peak - eq
        dd_pct = _safe_div(eq, peak) - 1.0
        rows.append(
            {
                "exit_ts_utc": ts.isoformat(),
                "symbol": tr.get("symbol", ""),
                "tp_r": float(tr.get("tp_r", np.nan)),
                "r": r,
                "equity_before": eq_before,
                "risk_usd": risk_usd,
                "pnl_usd": pnl,
                "withdrawal_usd": withdrawal_usd,
                "cumulative_withdrawn_usd": cumulative_withdrawn,
                "return_pct_trade": _safe_div(pnl, eq_before),
                "equity_after": eq,
                "equity_peak": peak,
                "drawdown_usd": dd_abs,
                "drawdown_pct": dd_pct,
            }
        )
    out = pd.DataFrame(rows)
    if len(out) == 0:
        return out, pd.DataFrame()
    out["exit_ts_utc"] = pd.to_datetime(out["exit_ts_utc"], utc=True)
    out["day"] = out["exit_ts_utc"].dt.floor("D")
    out["week_start"] = out["exit_ts_utc"].dt.to_period("W-MON").dt.start_time.dt.tz_localize("UTC")
    out["month"] = out["exit_ts_utc"].dt.to_period("M").astype(str)
    wd_df = pd.DataFrame(withdrawals)
    return out, wd_df


def summarize(
    eq_df: pd.DataFrame,
    *,
    start_balance: float,
) -> dict:
    if len(eq_df) == 0:
        return {
            "n_trades": 0,
            "trades_per_day": 0.0,
            "sum_r": 0.0,
            "avg_r": 0.0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "end_balance": start_balance,
            "net_pnl": 0.0,
            "total_return": 0.0,
            "max_dd_usd": 0.0,
            "max_dd_pct": 0.0,
            "withdrawn_total": 0.0,
            "final_wealth": start_balance,
        }

    n = int(len(eq_df))
    first = eq_df["exit_ts_utc"].min()
    last = eq_df["exit_ts_utc"].max()
    window_days = max(1, int((last - first).total_seconds() // 86400) + 1)

    sum_r = float(eq_df["r"].sum())
    avg_r = float(eq_df["r"].mean())
    win_rate = float((eq_df["r"] > 0).mean())
    gross_win = float(eq_df.loc[eq_df["r"] > 0, "r"].sum())
    gross_loss = float(-eq_df.loc[eq_df["r"] < 0, "r"].sum())
    profit_factor = _safe_div(gross_win, gross_loss)

    end_balance = float(eq_df["equity_after"].iloc[-1])
    net_pnl = end_balance - float(start_balance)
    total_return = _safe_div(end_balance, start_balance) - 1.0

    max_dd_usd = float(eq_df["drawdown_usd"].max())
    max_dd_pct = float(eq_df["drawdown_pct"].min())
    withdrawn_total = float(eq_df["cumulative_withdrawn_usd"].max()) if "cumulative_withdrawn_usd" in eq_df.columns else 0.0
    final_wealth = end_balance + withdrawn_total

    return {
        "n_trades": n,
        "trades_per_day": _safe_div(n, window_days),
        "sum_r": sum_r,
        "avg_r": avg_r,
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "end_balance": end_balance,
        "net_pnl": net_pnl,
        "total_return": total_return,
        "max_dd_usd": max_dd_usd,
        "max_dd_pct": max_dd_pct,
        "withdrawn_total": withdrawn_total,
        "final_wealth": final_wealth,
    }


def monthly_table(eq_df: pd.DataFrame) -> pd.DataFrame:
    if len(eq_df) == 0:
        return pd.DataFrame(
            columns=[
                "month",
                "n_trades",
                "sum_r",
                "pnl_usd",
                "start_balance",
                "end_balance",
                "month_return_pct",
            ]
        )
    grp = []
    for month, g in eq_df.groupby("month", sort=True):
        start_b = float(g["equity_before"].iloc[0])
        end_b = float(g["equity_after"].iloc[-1])
        grp.append(
            {
                "month": month,
                "n_trades": int(len(g)),
                "sum_r": float(g["r"].sum()),
                "pnl_usd": float(g["pnl_usd"].sum()),
                "start_balance": start_b,
                "end_balance": end_b,
                "month_return_pct": _safe_div(end_b, start_b) - 1.0,
            }
        )
    return pd.DataFrame(grp)


def period_pnl(eq_df: pd.DataFrame, period_col: str, top_n: int = 7) -> pd.DataFrame:
    if len(eq_df) == 0:
        return pd.DataFrame(columns=[period_col, "n_trades", "sum_r", "pnl_usd"])
    g = (
        eq_df.groupby(period_col, sort=True)
        .agg(n_trades=("r", "size"), sum_r=("r", "sum"), pnl_usd=("pnl_usd", "sum"))
        .reset_index()
        .sort_values("pnl_usd", ascending=True)
    )
    return g.head(top_n)


def df_to_md(df: pd.DataFrame) -> str:
    if len(df) == 0:
        return "_No rows._"
    cols = list(df.columns)
    lines = ["| " + " | ".join(cols) + " |", "| " + " | ".join("---" for _ in cols) + " |"]
    for _, row in df.iterrows():
        cells = [str(row[c]).replace("|", "\\|") for c in cols]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def load_input_rows(*, trades_csv: str, ledger_glob: str) -> tuple[pd.DataFrame, str]:
    if trades_csv:
        trades_path = Path(trades_csv).resolve()
        if not trades_path.is_file():
            raise FileNotFoundError(f"Missing trades csv: {trades_path}")
        raw = pd.read_csv(trades_path)
        if "exit_ts_utc" not in raw.columns:
            raise ValueError("Expected column 'exit_ts_utc' not found in trades CSV.")
        return raw, str(trades_path)

    pattern = ledger_glob.strip()
    matches = [Path(p) for p in sorted(glob.glob(pattern))]
    if not matches:
        raise FileNotFoundError(f"No files matched --ledger-glob pattern: {pattern}")

    frames: list[pd.DataFrame] = []
    for p in matches:
        df = pd.read_csv(p)
        req = {"exit_ts", "symbol", "baseline_r", "managed_r"}
        if not req.issubset(set(df.columns)):
            continue
        keep = ["symbol", "exit_ts", "baseline_r", "managed_r"]
        if "tp_r" in df.columns:
            keep.append("tp_r")
        frames.append(df[keep].copy())
    if not frames:
        raise ValueError("Matched ledger files but none had required columns.")

    raw = pd.concat(frames, ignore_index=True)
    raw = raw.rename(columns={"exit_ts": "exit_ts_utc"})
    return raw, pattern


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate trade-run equity report from trade details CSV.")
    ap.add_argument("--trades-csv", default="", help="Path to trade details CSV.")
    ap.add_argument(
        "--ledger-glob",
        default="",
        help="Glob for ledger CSVs (e.g. '/abs/run/artifacts/*ledger_*.csv').",
    )
    ap.add_argument("--r-column", default="managed_r", choices=["managed_r", "baseline_r"])
    ap.add_argument("--start-balance", type=float, default=10000.0)
    ap.add_argument("--risk-pct", type=float, default=1.0, help="Percent equity risked per trade (e.g. 1.0).")
    ap.add_argument(
        "--max-risk-usd",
        type=float,
        default=0.0,
        help="Optional cap on risk dollars per trade. 0 disables cap.",
    )
    ap.add_argument(
        "--withdrawal-quarterly-pct",
        type=float,
        default=0.0,
        help="Quarterly withdrawal rate on positive quarter profits (e.g. 30 for 30%%).",
    )
    ap.add_argument("--tp-r", type=float, default=float("nan"), help="Optional replay TP metadata when using ledgers.")
    ap.add_argument("--label", type=str, default="")
    ap.add_argument("--out-md", type=str, default="")
    ap.add_argument("--out-equity-csv", type=str, default="")
    ap.add_argument("--out-monthly-csv", type=str, default="")
    args = ap.parse_args()

    if not args.trades_csv and not args.ledger_glob:
        raise ValueError("Provide one of --trades-csv or --ledger-glob")
    if args.trades_csv and args.ledger_glob:
        raise ValueError("Provide only one input source: --trades-csv or --ledger-glob")

    raw, source_label = load_input_rows(trades_csv=args.trades_csv, ledger_glob=args.ledger_glob)
    default_stem = Path(args.trades_csv).stem if args.trades_csv else "ledger_bundle"
    run_label = args.label.strip() or default_stem
    out_md = Path(args.out_md) if args.out_md else Path(f"{default_stem}_equity_report.md")
    out_eq = Path(args.out_equity_csv) if args.out_equity_csv else Path(f"{default_stem}_equity_curve.csv")
    out_monthly = (
        Path(args.out_monthly_csv)
        if args.out_monthly_csv
        else Path(f"{default_stem}_monthly_balance.csv")
    )
    if args.r_column not in raw.columns:
        raise ValueError(f"Expected column '{args.r_column}' not found in trades CSV.")

    trades = raw.copy()
    trades["exit_ts_utc"] = pd.to_datetime(trades["exit_ts_utc"], utc=True)
    sort_cols = [c for c in ["exit_ts_utc", "entry_ts_utc", "symbol"] if c in trades.columns]
    trades = trades.sort_values(sort_cols).reset_index(drop=True)

    risk_fraction = args.risk_pct / 100.0
    withdrawal_quarterly_fraction = args.withdrawal_quarterly_pct / 100.0
    eq_df, wd_df = simulate_equity(
        trades,
        r_column=args.r_column,
        start_balance=float(args.start_balance),
        risk_fraction=risk_fraction,
        max_risk_usd=float(args.max_risk_usd),
        withdrawal_quarterly_pct=withdrawal_quarterly_fraction,
    )
    summary = summarize(eq_df, start_balance=float(args.start_balance))
    monthly = monthly_table(eq_df)
    worst_days = period_pnl(eq_df, "day", top_n=10)
    worst_weeks = period_pnl(eq_df, "week_start", top_n=10)

    eq_df_out = eq_df.copy()
    if len(eq_df_out) > 0:
        eq_df_out["day"] = eq_df_out["day"].dt.strftime("%Y-%m-%d")
        eq_df_out["week_start"] = eq_df_out["week_start"].dt.strftime("%Y-%m-%d")
    eq_df_out.to_csv(out_eq, index=False)
    monthly.to_csv(out_monthly, index=False)

    meta = []
    if "tp_r" in raw.columns and raw["tp_r"].notna().any():
        tps = sorted({float(x) for x in raw["tp_r"].dropna().unique()})
        meta.append(f"- **Replay TP(s):** `{', '.join(str(x) for x in tps)}`")
    elif not np.isnan(args.tp_r):
        meta.append(f"- **Replay TP(s):** `{args.tp_r}`")
    if "rsi_l" in raw.columns and "rsi_h" in raw.columns:
        try:
            rsi_l = int(raw["rsi_l"].dropna().iloc[0])
            rsi_h = int(raw["rsi_h"].dropna().iloc[0])
            meta.append(f"- **RSI band (from trades):** `{rsi_l}/{rsi_h}`")
        except Exception:
            pass

    lines = [
        f"# Trade Run Equity Report - {run_label}",
        "",
        "## Assumptions",
        "",
        f"- **Start balance:** `{_fmt_money(float(args.start_balance))}`",
        f"- **Position sizing:** fixed-fractional risk per trade = `{args.risk_pct:.2f}%` of current equity",
        f"- **Risk cap per trade:** `{_fmt_money(args.max_risk_usd) if args.max_risk_usd > 0 else 'None'}`",
        f"- **Quarterly withdrawal:** `{args.withdrawal_quarterly_pct:.2f}%` of positive quarter profit",
        f"- **PnL model:** `pnl_$ = equity_before * risk_fraction * {args.r_column}`",
        f"- **R series used:** `{args.r_column}`",
    ]
    lines.extend(meta)
    lines.extend(
        [
            "",
            "## Headline Metrics",
            "",
            f"- **Total trades:** `{summary['n_trades']}`",
            f"- **Trades per day:** `{summary['trades_per_day']:.2f}`",
            f"- **Total R:** `{summary['sum_r']:+.2f}`",
            f"- **Average R/trade:** `{summary['avg_r']:+.4f}`",
            f"- **Win rate:** `{summary['win_rate'] * 100:.2f}%`",
            f"- **Profit factor (R):** `{summary['profit_factor']:.2f}`",
            f"- **Ending balance:** `{_fmt_money(summary['end_balance'])}`",
            f"- **Net PnL:** `{_fmt_money(summary['net_pnl'])}`",
            f"- **Total withdrawn:** `{_fmt_money(summary['withdrawn_total'])}`",
            f"- **Final wealth (balance + withdrawn):** `{_fmt_money(summary['final_wealth'])}`",
            f"- **Total return:** `{_fmt_pct(summary['total_return'])}`",
            f"- **Max drawdown:** `{_fmt_money(summary['max_dd_usd'])}` ({_fmt_pct(summary['max_dd_pct'])})",
            "",
            "## Monthly Balance Curve",
            "",
            df_to_md(
                monthly.assign(
                    sum_r=monthly["sum_r"].map(lambda x: f"{x:+.2f}"),
                    pnl_usd=monthly["pnl_usd"].map(_fmt_money),
                    start_balance=monthly["start_balance"].map(_fmt_money),
                    end_balance=monthly["end_balance"].map(_fmt_money),
                    month_return_pct=monthly["month_return_pct"].map(_fmt_pct),
                )
                if len(monthly)
                else monthly
            ),
            "",
            "## Worst Days (by $PnL)",
            "",
            df_to_md(
                worst_days.assign(
                    day=worst_days["day"].dt.strftime("%Y-%m-%d") if len(worst_days) else worst_days["day"],
                    sum_r=worst_days["sum_r"].map(lambda x: f"{x:+.2f}") if len(worst_days) else [],
                    pnl_usd=worst_days["pnl_usd"].map(_fmt_money) if len(worst_days) else [],
                )
                if len(worst_days)
                else worst_days
            ),
            "",
            "## Worst Weeks (by $PnL)",
            "",
            df_to_md(
                worst_weeks.assign(
                    week_start=worst_weeks["week_start"].dt.strftime("%Y-%m-%d")
                    if len(worst_weeks)
                    else worst_weeks["week_start"],
                    sum_r=worst_weeks["sum_r"].map(lambda x: f"{x:+.2f}") if len(worst_weeks) else [],
                    pnl_usd=worst_weeks["pnl_usd"].map(_fmt_money) if len(worst_weeks) else [],
                )
                if len(worst_weeks)
                else worst_weeks
            ),
            "",
            "## Quarterly Withdrawals",
            "",
            df_to_md(
                wd_df.assign(
                    quarter_start_equity=wd_df["quarter_start_equity"].map(_fmt_money) if len(wd_df) else [],
                    quarter_end_pre_withdrawal=wd_df["quarter_end_pre_withdrawal"].map(_fmt_money) if len(wd_df) else [],
                    quarter_profit=wd_df["quarter_profit"].map(_fmt_money) if len(wd_df) else [],
                    withdrawal_pct=wd_df["withdrawal_pct"].map(lambda x: _fmt_pct(float(x))) if len(wd_df) else [],
                    withdrawal_usd=wd_df["withdrawal_usd"].map(_fmt_money) if len(wd_df) else [],
                    equity_after_withdrawal=wd_df["equity_after_withdrawal"].map(_fmt_money) if len(wd_df) else [],
                )
                if len(wd_df)
                else wd_df
            ),
            "",
            "## Artifacts",
            "",
            f"- Input source: `{source_label}`",
            f"- Equity curve CSV: `{out_eq}`",
            f"- Monthly balances CSV: `{out_monthly}`",
            "",
        ]
    )
    out_md.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {out_md}")
    print(f"Wrote {out_eq}")
    print(f"Wrote {out_monthly}")


if __name__ == "__main__":
    main()
