#!/usr/bin/env python3
"""
report_fvg_mfe_impact.py — impact report for mechanism streams:
  - S3 BAL+HIGH Short: FVG filter + FVG-LOW stop
  - S4 BAL+HIGH Long: BE-lock at 3.5R -> +1R
"""
from __future__ import annotations

import argparse
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd

LAB_ROOT = Path(__file__).resolve().parent
REPO_ROOT = LAB_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from lab.study_fvg_momentum import DEFAULT_DB, SYMS, prepare_sym, collect_signals as collect_s3_signals  # noqa: E402
from lab.study_order_blocks import stop_fvg  # noqa: E402
from lab.sim.entry import tp_price_from_r  # noqa: E402
from lab.sim.exit import replay_trade_5m  # noqa: E402

# Keep locked config aligned with run_all_streams.py S3 block.
S3_VOL_RATIO_MIN = 1.8
S3_BODY_PCT_MIN  = 0.55
S3_CLOSE_PCT_MAX = 0.15
S3_BUF_MULT      = 0.15
S3_ATR_MULT      = 2.0
S3_TP_R          = 4.25
S3_FEE_BPS       = 3.0
START_UTC        = "2022-01-01"

MFE_EDGES  = [-np.inf, 0.0, 1.0, 2.0, 3.5, 6.5, 10.0, np.inf]
MFE_LABELS = ["<=0R", "0-1R", "1-2R", "2-3.5R", "3.5-6.5R", "6.5-10R", ">10R"]


# ────────────────────────────────────────────────────────────────────────────
# Utilities
# ────────────────────────────────────────────────────────────────────────────

def _max_dd(pnls: np.ndarray) -> float:
    if len(pnls) == 0:
        return 0.0
    cum = np.cumsum(pnls)
    peak = np.maximum.accumulate(cum)
    return float((peak - cum).max())


def _latest_run(runs_dir: Path) -> Path:
    candidates = sorted(runs_dir.glob("run_all_streams_*"))
    if not candidates:
        raise SystemExit(f"no runs found under {runs_dir}")
    return candidates[-1]


def _df_to_md(df: pd.DataFrame, floatfmt: str = ".2f") -> str:
    if df.empty:
        return "_(no rows)_\n"
    cols = list(df.columns)
    dtypes = {c: df[c].dtype for c in cols}
    def fmt(v, dt):
        if pd.isna(v):
            return ""
        if pd.api.types.is_integer_dtype(dt):
            return str(int(v))
        if pd.api.types.is_float_dtype(dt):
            return f"{float(v):{floatfmt}}"
        return str(v)
    lines = ["| " + " | ".join(cols) + " |",
             "| " + " | ".join("---" for _ in cols) + " |"]
    for _, row in df.iterrows():
        lines.append("| " + " | ".join(fmt(row[c], dtypes[c]) for c in cols) + " |")
    return "\n".join(lines) + "\n"


# ────────────────────────────────────────────────────────────────────────────
# S3 — FVG stop vs ATR stop, and FVG filter on/off
# ────────────────────────────────────────────────────────────────────────────

def _replay_s3(
    sig: dict,
    df5: pd.DataFrame,
    stop_mode: str,   # "fvg" or "atr"
) -> dict | None:
    entry_p = sig["entry_p"]
    atr_val = sig["atr"]

    if stop_mode == "fvg":
        if not sig.get("has_fvg"):
            return None
        stop_p = stop_fvg(sig, S3_BUF_MULT)
        if stop_p is None or stop_p <= entry_p:
            return None
        risk = atr_val * S3_ATR_MULT   # R basis identical for apples-to-apples
    elif stop_mode == "atr":
        risk = atr_val * S3_ATR_MULT
        stop_p = entry_p + risk
        if stop_p <= entry_p:
            return None
    else:
        raise ValueError(stop_mode)

    tp_p = tp_price_from_r(entry_p, risk, -1, S3_TP_R)
    res = replay_trade_5m(
        df5, sig["ts"], -1, entry_p, stop_p, tp_p,
        risk, S3_FEE_BPS,
        be_trigger_r=None, be_offset_r=0.0,
        skip_entry_bucket_hours=0.0,
    )
    if res is None:
        return None

    # MFE between entry and managed exit
    d = df5.loc[(df5.index >= sig["ts"]) & (df5.index <= res.exit_ts)]
    if len(d) == 0 or risk <= 0:
        mfe_r = 0.0
    else:
        trough = float(d["low"].min())
        mfe_r = (entry_p - trough) / risk

    return dict(
        sym=sig["sym"],
        year=pd.Timestamp(sig["ts"]).year,
        ts=sig["ts"],
        has_fvg=bool(sig.get("has_fvg")),
        stop_mode=stop_mode,
        pnl_r=res.pnl_r,
        reason=res.reason,
        mfe_r=mfe_r,
    )


def _summarize(df: pd.DataFrame, label: str) -> dict:
    if df.empty:
        return dict(label=label, n=0, win_pct=0.0, total_r=0.0,
                    avg_r=0.0, maxDD_r=0.0, sl=0, tp=0, be=0)
    pnls = df["pnl_r"].to_numpy()
    return dict(
        label=label,
        n=len(pnls),
        win_pct=round(float((pnls > 0).mean() * 100), 2),
        total_r=round(float(pnls.sum()), 2),
        avg_r=round(float(pnls.mean()), 4),
        maxDD_r=round(_max_dd(pnls), 2),
        sl=int((df["reason"] == "SL").sum()),
        tp=int((df["reason"] == "TP").sum()),
        be=int((df["reason"] == "BE").sum()),
    )


def _run_s3_analysis() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Returns (stop_impact_summary, filter_impact_summary,
                per_year_stop_impact, per_asset_stop_impact)."""
    print("  [S3] preparing 5m / 1h data for 6 symbols …")
    sym_df5: dict[str, pd.DataFrame] = {}
    sym_df1h: dict[str, pd.DataFrame] = {}
    for s in SYMS:
        df5, df1h = prepare_sym(DEFAULT_DB, s, START_UTC)
        sym_df5[s]  = df5
        sym_df1h[s] = df1h

    all_sigs: list[dict] = []
    for s in SYMS:
        raw = collect_s3_signals(
            sym_df1h[s], s,
            vol_ratio_min=S3_VOL_RATIO_MIN,
            body_pct_min=S3_BODY_PCT_MIN,
            close_pct_max=S3_CLOSE_PCT_MAX,
        )
        all_sigs.extend(raw)

    n_total   = len(all_sigs)
    n_fvg     = sum(1 for s in all_sigs if s["has_fvg"])
    n_no_fvg  = n_total - n_fvg
    print(f"  [S3] signals: total={n_total}  with_fvg={n_fvg}  without_fvg={n_no_fvg}")

    # Three replay passes:
    #   A: FVG-only signals, FVG-LOW stop  (= live S3)
    #   B: FVG-only signals, ATR stop      (stop-mechanism counterfactual)
    #   C: ALL signals,      ATR stop      (filter-mechanism counterfactual)
    rows_A, rows_B, rows_C = [], [], []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs_A = {ex.submit(_replay_s3, s, sym_df5[s["sym"]], "fvg"): s
                  for s in all_sigs if s["has_fvg"]}
        futs_B = {ex.submit(_replay_s3, s, sym_df5[s["sym"]], "atr"): s
                  for s in all_sigs if s["has_fvg"]}
        futs_C = {ex.submit(_replay_s3, s, sym_df5[s["sym"]], "atr"): s
                  for s in all_sigs}
        for f in as_completed(futs_A):
            r = f.result()
            if r: rows_A.append(r)
        for f in as_completed(futs_B):
            r = f.result()
            if r: rows_B.append(r)
        for f in as_completed(futs_C):
            r = f.result()
            if r: rows_C.append(r)

    df_A = pd.DataFrame(rows_A)
    df_B = pd.DataFrame(rows_B)
    df_C = pd.DataFrame(rows_C)

    # Stop-mechanism impact (same signals, different stop)
    summary_stop = pd.DataFrame([
        _summarize(df_A, "FVG-LOW stop (live S3)"),
        _summarize(df_B, "ATR x2 stop (same signals)"),
    ])
    saved_stop = float(df_A["pnl_r"].sum() - df_B["pnl_r"].sum())
    summary_stop.loc[len(summary_stop)] = dict(
        label=f"Δ FVG stop saves (total_R_A − total_R_B)",
        n=len(df_A), win_pct=0.0,
        total_r=round(saved_stop, 2),
        avg_r=round(saved_stop / max(len(df_A), 1), 4),
        maxDD_r=0.0, sl=0, tp=0, be=0,
    )

    # Filter impact: live S3 vs all signals with ATR stop
    summary_filter = pd.DataFrame([
        _summarize(df_A, "FVG-only (live S3)"),
        _summarize(df_C, "No FVG filter (ATR stop, all BAL shorts)"),
    ])
    saved_filter = float(df_A["pnl_r"].sum() - df_C["pnl_r"].sum())
    summary_filter.loc[len(summary_filter)] = dict(
        label=f"Δ FVG filter impact (total_R_A − total_R_C)",
        n=len(df_A) - len(df_C), win_pct=0.0,
        total_r=round(saved_filter, 2),
        avg_r=0.0, maxDD_r=0.0, sl=0, tp=0, be=0,
    )

    # Year / asset breakdown for stop impact
    def _per(col: str) -> pd.DataFrame:
        rows = []
        for key in sorted(set(df_A[col].astype(object)) | set(df_B[col].astype(object))):
            a = df_A[df_A[col] == key]["pnl_r"].to_numpy()
            b = df_B[df_B[col] == key]["pnl_r"].to_numpy()
            rows.append({
                col: int(key) if col == "year" else key,
                "n": int(len(a)),
                "fvg_total_r": round(float(a.sum()), 2),
                "atr_total_r": round(float(b.sum()), 2),
                "saved_r": round(float(a.sum() - b.sum()), 2),
                "fvg_win_pct": round(float((a > 0).mean() * 100), 2) if len(a) else 0.0,
                "atr_win_pct": round(float((b > 0).mean() * 100), 2) if len(b) else 0.0,
                "fvg_maxDD": round(_max_dd(a), 2),
                "atr_maxDD": round(_max_dd(b), 2),
            })
        return pd.DataFrame(rows)

    per_year  = _per("year")
    per_asset = _per("sym")
    return summary_stop, summary_filter, per_year, per_asset, df_A


# ────────────────────────────────────────────────────────────────────────────
# S4 — BE-lock impact (already in trades_all.csv)
# ────────────────────────────────────────────────────────────────────────────

def _s4_lock_tables(trades: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    s4 = trades[trades["stream"] == "S4"].copy()
    if s4.empty:
        return (pd.DataFrame(),) * 4

    pnl_m = s4["managed_r"].to_numpy()
    pnl_b = s4["baseline_r"].to_numpy()

    # S4 baseline TP is 19.5R; stop is ATR×2 → full SL ≈ −1.0R.
    S4_TP_R = 19.5
    sl_b = int((pnl_b <= -0.99).sum())
    tp_b = int((pnl_b >= S4_TP_R - 0.2).sum())
    overall = pd.DataFrame([dict(
        label="baseline (ATR stop, no lock)",
        n=len(pnl_b),
        total_r=round(float(pnl_b.sum()), 2),
        win_pct=round(float((pnl_b > 0).mean() * 100), 2),
        maxDD_r=round(_max_dd(pnl_b), 2),
        sl=sl_b,
        tp=tp_b,
        be=0,
    ), dict(
        label="managed (BE lock @ 3.5R → +1R)",
        n=len(pnl_m),
        total_r=round(float(pnl_m.sum()), 2),
        win_pct=round(float((pnl_m > 0).mean() * 100), 2),
        maxDD_r=round(_max_dd(pnl_m), 2),
        sl=int((s4["managed_reason"] == "SL").sum()),
        tp=int((s4["managed_reason"] == "TP").sum()),
        be=int((s4["managed_reason"] == "BE").sum()),
    )])
    overall.loc[len(overall)] = dict(
        label="Δ managed − baseline",
        n=len(s4),
        total_r=round(float(s4["saved_r"].sum()), 2),
        win_pct=0.0,
        maxDD_r=0.0,
        sl=0, tp=0, be=0,
    )

    split = pd.DataFrame([dict(
        bucket="improved (saved_r > 0)",
        n=int((s4["saved_r"] > 1e-6).sum()),
        total_saved=round(float(s4.loc[s4["saved_r"] > 1e-6, "saved_r"].sum()), 2),
        avg_save=round(float(s4.loc[s4["saved_r"] > 1e-6, "saved_r"].mean() or 0), 3),
    ), dict(
        bucket="worsened (saved_r < 0)",
        n=int((s4["saved_r"] < -1e-6).sum()),
        total_saved=round(float(s4.loc[s4["saved_r"] < -1e-6, "saved_r"].sum()), 2),
        avg_save=round(float(s4.loc[s4["saved_r"] < -1e-6, "saved_r"].mean() or 0), 3),
    ), dict(
        bucket="unchanged",
        n=int((s4["saved_r"].abs() <= 1e-6).sum()),
        total_saved=0.0,
        avg_save=0.0,
    )])

    def _group(col: str) -> pd.DataFrame:
        rows = []
        for key, g in s4.groupby(col, sort=True):
            rows.append({
                col: int(key) if col == "year" else key,
                "n": int(len(g)),
                "managed_total": round(float(g["managed_r"].sum()), 2),
                "baseline_total": round(float(g["baseline_r"].sum()), 2),
                "saved_r": round(float(g["saved_r"].sum()), 2),
                "be_hits": int((g["managed_reason"] == "BE").sum()),
                "tp_hits": int((g["managed_reason"] == "TP").sum()),
            })
        return pd.DataFrame(rows)

    by_year  = _group("year")
    by_asset = _group("sym")

    return overall, split, by_year, by_asset


# ────────────────────────────────────────────────────────────────────────────
# MFE bucket win rates for mechanism streams
# ────────────────────────────────────────────────────────────────────────────

def _mfe_buckets(df: pd.DataFrame, pnl_col: str, label: str) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame()
    buckets = pd.cut(df["mfe_r"], bins=MFE_EDGES, labels=MFE_LABELS,
                     include_lowest=True)
    tmp = df.assign(bucket=buckets)
    rows = []
    for b, sub in tmp.groupby("bucket", observed=True):
        arr = sub[pnl_col].to_numpy()
        if len(arr) == 0:
            continue
        rows.append(dict(
            variant=label,
            mfe_bucket=str(b),
            n=len(arr),
            win_pct=round(float((arr > 0).mean() * 100), 2),
            avg_r=round(float(arr.mean()), 3),
            total_r=round(float(arr.sum()), 2),
        ))
    out = pd.DataFrame(rows)
    if not out.empty:
        out["mfe_bucket"] = pd.Categorical(out["mfe_bucket"],
                                           categories=MFE_LABELS, ordered=True)
        out = out.sort_values("mfe_bucket").reset_index(drop=True)
    return out


# ────────────────────────────────────────────────────────────────────────────
# Report assembly
# ────────────────────────────────────────────────────────────────────────────

def _write_report(run_dir: Path, parts: dict[str, str]) -> Path:
    out = run_dir / "fvg_mfe_impact.md"
    lines = [
        "# FVG + MFE-Lock Impact Report",
        "",
        f"Run: `{run_dir.name}`",
        "",
        "## Mechanism Map",
        "",
        "| stream | regime | stop | filter | active management |",
        "| --- | --- | --- | --- | --- |",
        "| S1 | IMBAL+HIGH Long  | ATR×2.0 below entry | none | none |",
        "| S2 | BAL+HIGH Short   | ATR×1.5 above entry | none | none |",
        "| S3 | BAL+HIGH Short   | FVG-LOW + ATR×0.15  | **FVG required** | none |",
        "| S4 | BAL+HIGH Long    | ATR×2.0 below entry | equal-lows sweep ≥0.90 rejection | **BE lock @ 3.5R → +1R** |",
        "",
        "S3 and S4 are the only streams with an active mechanism; this report",
        "isolates what each one contributes.",
        "",
    ]
    for title, body in parts.items():
        lines.append(f"## {title}")
        lines.append("")
        lines.append(body)
        lines.append("")
    out.write_text("\n".join(lines))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", type=Path, help="path to a run_all_streams_<stamp> folder")
    args = ap.parse_args()

    runs_root = REPO_ROOT / "runs"
    run_dir = args.run or _latest_run(runs_root)
    if not run_dir.exists():
        raise SystemExit(f"{run_dir} not found")
    artifacts = run_dir / "artifacts"
    artifacts.mkdir(exist_ok=True)

    trades_path = run_dir / "trades" / "trades_all.csv"
    print(f"loading {trades_path}")
    trades = pd.read_csv(trades_path)

    # ── S4 (BE-lock) — from trades_all.csv ──────────────────────────────────
    s4_overall, s4_split, s4_year, s4_asset = _s4_lock_tables(trades)
    s4_year.to_csv(artifacts / "s4_lock_impact_by_year.csv", index=False)
    s4_asset.to_csv(artifacts / "s4_lock_impact_by_asset.csv", index=False)

    # ── S3 (FVG) — re-replay on 5m data ─────────────────────────────────────
    print("re-simulating S3 with FVG-LOW vs ATR stop …")
    s3_stop_tbl, s3_filter_tbl, s3_year, s3_asset, s3_df_A = _run_s3_analysis()
    s3_stop_tbl.to_csv(artifacts / "s3_fvg_stop_impact.csv", index=False)
    s3_filter_tbl.to_csv(artifacts / "s3_fvg_filter_impact.csv", index=False)
    s3_year.to_csv(artifacts / "s3_fvg_stop_impact_by_year.csv", index=False)
    s3_asset.to_csv(artifacts / "s3_fvg_stop_impact_by_asset.csv", index=False)

    # ── MFE bucket win rates for S3 and S4 ──────────────────────────────────
    s3_live_buckets = _mfe_buckets(s3_df_A.rename(columns={"pnl_r": "managed_r"}),
                                   "managed_r", "S3 (FVG stop)")
    s4_buckets_b = _mfe_buckets(
        trades[trades["stream"] == "S4"].rename(columns={"baseline_r": "x"})[
            ["mfe_r", "x"]].rename(columns={"x": "pnl_r"}),
        "pnl_r", "S4 baseline (no lock)",
    )
    s4_buckets_m = _mfe_buckets(
        trades[trades["stream"] == "S4"].rename(columns={"managed_r": "x"})[
            ["mfe_r", "x"]].rename(columns={"x": "pnl_r"}),
        "pnl_r", "S4 managed (BE lock)",
    )
    mfe_all = pd.concat([s3_live_buckets, s4_buckets_b, s4_buckets_m],
                        ignore_index=True)
    mfe_all.to_csv(artifacts / "mfe_bucket_mechanism_streams.csv", index=False)

    # ── Markdown assembly ────────────────────────────────────────────────────
    parts = {
        "S3 FVG stop placement (same signals, FVG-LOW vs ATR×2)":
            _df_to_md(s3_stop_tbl),
        "S3 FVG filter (FVG-only vs no filter, ATR stop)":
            _df_to_md(s3_filter_tbl),
        "S3 FVG stop — per year":
            _df_to_md(s3_year),
        "S3 FVG stop — per asset":
            _df_to_md(s3_asset),
        "S4 BE-lock impact (managed vs baseline)":
            _df_to_md(s4_overall),
        "S4 BE-lock per-trade effect":
            _df_to_md(s4_split),
        "S4 BE-lock by year":
            _df_to_md(s4_year),
        "S4 BE-lock by asset":
            _df_to_md(s4_asset),
        "MFE-bucket win rates (mechanism streams)":
            _df_to_md(mfe_all),
    }
    out = _write_report(run_dir, parts)
    print(f"wrote {out}")
    print("\n=== PORTABLE SUMMARY ===")
    print(f"S3 FVG stop Δ (same signals):    {float(s3_stop_tbl.loc[2, 'total_r']):+.2f} R")
    print(f"S3 FVG filter Δ (live − no-fvg): {float(s3_filter_tbl.loc[2, 'total_r']):+.2f} R")
    if not s4_overall.empty:
        print(f"S4 BE-lock Δ (managed − base):   {float(s4_overall.loc[2, 'total_r']):+.2f} R")


if __name__ == "__main__":
    main()
