"""
Lab — Strategy Audit Dashboard

Visualize and audit strategy runs. Auto-discovers runs/ folder.
Every run shows: equity curve, per-asset summary, trade browser, trade chart.

Launch: streamlit run lab/app.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

# ── Path setup ─────────────────────────────────────────────────────────────
LAB_ROOT = Path(__file__).resolve().parent
REPO_ROOT = LAB_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

RUNS_DIR = REPO_ROOT / "runs"

from lab.core.db import load_candles_window  # noqa: E402
from lab.core.indicators import wilder_rsi_arr  # noqa: E402


# ── Helpers ────────────────────────────────────────────────────────────────

def _max_dd(pnls: np.ndarray) -> float:
    if len(pnls) == 0:
        return 0.0
    c = np.cumsum(pnls)
    peak = np.maximum.accumulate(c)
    return float(np.max(peak - c))

# ── Page config ────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Lab — Strategy Audit",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Data loaders ───────────────────────────────────────────────────────────

@st.cache_data(ttl=30)
def discover_runs(runs_dir: str) -> list[dict]:
    p = Path(runs_dir)
    if not p.exists():
        return []
    out = []
    for d in sorted(p.iterdir(), reverse=True):
        if not d.is_dir() or not d.name.startswith("run_"):
            continue
        cfg_path = d / "run_config.json"
        if not cfg_path.exists():
            continue
        cfg = json.loads(cfg_path.read_text())
        trades_dir = d / "trades"
        tp_tags = []
        if trades_dir.exists():
            for f in sorted(trades_dir.glob("trade_details_*.csv")):
                # extract the tp tag (last underscore-segment before .csv)
                stem_parts = f.stem.split("_")
                for part in reversed(stem_parts):
                    if part.startswith("tp"):
                        tp_tags.append(part)
                        break
        out.append({
            "run_id": d.name,
            "run_dir": str(d),
            "cfg": cfg,
            "tp_tags": sorted(set(tp_tags)),
        })
    return out


@st.cache_data
def load_trades_df(run_dir: str, tp_tag: str) -> pd.DataFrame:
    p = Path(run_dir) / "trades"
    matches = list(p.glob(f"trade_details_*_{tp_tag}.csv"))
    if not matches:
        return pd.DataFrame()
    return pd.read_csv(matches[0])


@st.cache_data
def load_candles_for_trade(
    db_path: str, symbol: str, entry_ts_utc: str, exit_ts_utc: str
) -> pd.DataFrame:
    buffer_ms = 20 * 60 * 60 * 1000  # 20h buffer each side
    entry_ms = int(pd.Timestamp(entry_ts_utc).timestamp() * 1000)
    exit_ms = int(pd.Timestamp(exit_ts_utc).timestamp() * 1000)
    return load_candles_window(db_path, symbol, entry_ms - buffer_ms, exit_ms + buffer_ms)


@st.cache_data
def load_regime_df(run_dir: str, symbol: str) -> tuple[pd.DataFrame, str]:
    """Returns (regime_df, htf_string). htf_string is e.g. '1h', '4h'."""
    path = Path(run_dir) / "artifacts" / f"regime_{symbol}.csv"
    if not path.exists():
        return pd.DataFrame(), "4h"
    df = pd.read_csv(path, index_col="ts", parse_dates=True)
    df.index = pd.to_datetime(df.index, utc=True)
    htf_path = Path(run_dir) / "artifacts" / f"regime_{symbol}_htf.txt"
    htf = htf_path.read_text().strip() if htf_path.exists() else "4h"
    return df, htf


# ── Chart builders ─────────────────────────────────────────────────────────

def _candles(df: pd.DataFrame, name: str = "") -> go.Candlestick:
    return go.Candlestick(
        x=df.index, open=df["open"], high=df["high"],
        low=df["low"], close=df["close"],
        name=name,
        increasing_line_color="#26a69a",
        decreasing_line_color="#ef5350",
        showlegend=False,
    )


def equity_curve_fig(trades_df: pd.DataFrame) -> go.Figure:
    df = trades_df.copy()
    df["exit_ts"] = pd.to_datetime(df["exit_ts_utc"], utc=True)
    df = df.sort_values("exit_ts").reset_index(drop=True)
    df["eq_managed"] = df["managed_r"].cumsum()
    df["eq_baseline"] = df["baseline_r"].cumsum()

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=df["exit_ts"], y=df["eq_managed"],
        name="Managed", line=dict(color="#26a69a", width=2), mode="lines",
    ))
    fig.add_trace(go.Scatter(
        x=df["exit_ts"], y=df["eq_baseline"],
        name="Baseline (fixed SL/TP)", line=dict(color="#90a4ae", width=1.5, dash="dash"),
        mode="lines",
    ))
    fig.add_hline(y=0, line_color="#444", line_width=1)
    fig.update_layout(
        title="Equity Curve — cumulative R",
        height=320,
        margin=dict(l=0, r=10, t=36, b=0),
        hovermode="x unified",
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
        xaxis_title=None,
        yaxis_title="Cumulative R",
    )
    return fig


def trade_chart_fig(
    df5: pd.DataFrame,
    trade: pd.Series,
    rsi_window: int = 20,
    regime_df: pd.DataFrame | None = None,
    htf: str = "1h",
) -> go.Figure:
    """
    Trade chart with 3 or 4 rows depending on whether regime data is available.

    Row 1: 4h OHLCV with entry / exit markers (+ BB bands if regime_df present)
    Row 2: 4h RSI with threshold lines  -OR-  BB-only indicator row
    Row 3: Regime panel (structure + vol) — only when regime_df provided
    Row 4 (or 3 without regime): 5m OHLCV with SL / TP / lock levels
    """
    entry_ts = pd.Timestamp(trade["entry_ts_utc"])
    exit_ts  = pd.Timestamp(trade["exit_ts_utc"])

    has_regime = regime_df is not None and not regime_df.empty

    # Build 4h OHLCV from 5m window
    df4h = (
        df5.resample("4h")
        .agg({"open": "first", "high": "max", "low": "min", "close": "last"})
        .dropna()
    )
    rsi_vals = wilder_rsi_arr(df4h["close"].values, window=rsi_window)
    df4h["rsi"] = rsi_vals

    if has_regime:
        n_rows = 4
        row_heights = [0.35, 0.15, 0.12, 0.38]
        subplot_titles = ("4h OHLCV + BB Bands", f"4h RSI ({rsi_window})", "Regime", "5m Detail")
        detail_row = 4
    else:
        n_rows = 3
        row_heights = [0.38, 0.18, 0.44]
        subplot_titles = ("4h OHLCV", f"4h RSI ({rsi_window})", "5m Detail")
        detail_row = 3

    fig = make_subplots(
        rows=n_rows, cols=1,
        row_heights=row_heights,
        shared_xaxes=True,
        vertical_spacing=0.02,
        subplot_titles=subplot_titles,
    )

    # ── Row 1: 4h candles ──────────────────────────────────────────────────
    fig.add_trace(_candles(df4h, "4h"), row=1, col=1)
    fig.add_vline(x=entry_ts, line_color="#ffd54f", line_dash="dash", line_width=1.5)
    fig.add_vline(x=exit_ts,  line_color="#ef9a9a", line_dash="dash", line_width=1.5)

    if has_regime:
        # Align regime_df to the chart window
        r = regime_df.loc[
            (regime_df.index >= df4h.index[0]) & (regime_df.index <= df4h.index[-1])
        ]

        # BB bands
        if "bb_upper" in r.columns:
            for col, color, name in [
                ("bb_upper", "#64b5f6", "BB Upper"),
                ("bb_mid",   "#90a4ae", "BB Mid"),
                ("bb_lower", "#64b5f6", "BB Lower"),
            ]:
                if col in r.columns:
                    fig.add_trace(
                        go.Scatter(
                            x=r.index, y=r[col],
                            name=name,
                            line=dict(color=color, width=1, dash="dot"),
                            showlegend=False,
                        ),
                        row=1, col=1,
                    )

        # Background shading: BALANCED = subtle green, IMBALANCED = subtle red
        if "structure" in r.columns:
            _add_regime_shading(fig, r, htf)

    # ── Row 2: RSI ─────────────────────────────────────────────────────────
    fig.add_trace(
        go.Scatter(
            x=df4h.index, y=df4h["rsi"],
            name="RSI", line=dict(color="#7e57c2", width=1.5), showlegend=False,
        ),
        row=2, col=1,
    )
    rsi_l = float(trade.get("rsi_l", 35))
    rsi_h = float(trade.get("rsi_h", 60))
    for level, color in [(rsi_l, "#26a69a"), (50, "#555"), (rsi_h, "#ef5350")]:
        fig.add_hline(y=level, line_color=color, line_dash="dot", line_width=1, row=2, col=1)

    # ── Row 3: Regime panel (only when regime_df present) ──────────────────
    if has_regime:
        r = regime_df.loc[
            (regime_df.index >= df4h.index[0]) & (regime_df.index <= df4h.index[-1])
        ]
        if "structure_num" in r.columns:
            fig.add_trace(
                go.Scatter(
                    x=r.index, y=r["structure_num"],
                    name="Structure",
                    line=dict(color="#26a69a", width=1.5, shape="hv"),
                    fill="tozeroy",
                    fillcolor="rgba(38,166,154,0.15)",
                    showlegend=True,
                ),
                row=3, col=1,
            )
        if "vol_num" in r.columns:
            fig.add_trace(
                go.Scatter(
                    x=r.index, y=r["vol_num"],
                    name="Vol (0=L,1=N,2=H)",
                    line=dict(color="#ffa726", width=1.5, shape="hv"),
                    showlegend=True,
                ),
                row=3, col=1,
            )
        # Y-axis ticks for regime panel
        fig.update_yaxes(
            tickvals=[0, 1, 2],
            ticktext=["BAL/L", "IMB/N", "H"],
            row=3, col=1,
        )

    # ── Row detail: 5m zoomed window ───────────────────────────────────────
    zoom_start = entry_ts - pd.Timedelta(hours=8)
    zoom_end   = exit_ts  + pd.Timedelta(hours=6)
    df5z = df5.loc[(df5.index >= zoom_start) & (df5.index <= zoom_end)]
    fig.add_trace(_candles(df5z, "5m"), row=detail_row, col=1)

    entry_price = float(trade["entry_price"])
    stop_init   = float(trade["stop_init"])
    tp_price    = float(trade["tp_price"])
    side        = int(trade["side"])
    risk        = float(trade["risk"])

    _hline(fig, entry_price, "#ffd54f", "Entry", row=detail_row)
    _hline(fig, stop_init,   "#ef5350", "SL",    row=detail_row)
    _hline(fig, tp_price,    "#26a69a", "TP",     row=detail_row)

    for i in range(1, 5):
        lock_key = f"lock{i}"
        if lock_key in trade and pd.notna(trade.get(lock_key)):
            lock_price = entry_price + side * float(trade[lock_key]) * risk
            _hline(fig, lock_price, "#80cbc4", f"Lock{i}", row=detail_row, dash="dot", width=1)

    height = 920 if has_regime else 780
    xaxis_keys = {f"xaxis{i}_rangeslider_visible": False for i in range(1, n_rows + 1)}
    xaxis_keys["xaxis_rangeslider_visible"] = False  # xaxis1 key alias

    fig.update_layout(
        height=height,
        margin=dict(l=0, r=70, t=40, b=0),
        showlegend=has_regime,
        hovermode="x unified",
        legend=dict(orientation="h", yanchor="bottom", y=1.01, x=0),
        **xaxis_keys,
    )
    return fig


def _add_regime_shading(fig: go.Figure, regime_slice: pd.DataFrame, htf: str = "1h") -> None:
    """
    Add vertical rectangle shading behind the 4h chart based on structure.
    BALANCED = subtle green, IMBALANCED = subtle red.
    Only draws transitions (groups contiguous same-structure bars into one vrect).
    """
    if "structure" not in regime_slice.columns or len(regime_slice) == 0:
        return

    structure_vals = regime_slice["structure"].values
    timestamps     = regime_slice.index

    i = 0
    while i < len(structure_vals):
        s = structure_vals[i]
        if pd.isna(s):
            i += 1
            continue
        j = i + 1
        while j < len(structure_vals) and structure_vals[j] == s:
            j += 1
        t0 = timestamps[i]
        t1 = timestamps[j - 1] + pd.tseries.frequencies.to_offset(htf)  # extend to bar close
        color = "rgba(38,166,154,0.07)" if s == "BALANCED" else "rgba(239,83,80,0.07)"
        fig.add_vrect(
            x0=t0, x1=t1,
            fillcolor=color, line_width=0,
            layer="below",
            row=1, col=1,
        )
        i = j


def _hline(fig, y: float, color: str, label: str, row: int,
           dash: str = "solid", width: float = 1.5) -> None:
    fig.add_hline(
        y=y, line_color=color, line_dash=dash, line_width=width,
        annotation_text=label, annotation_position="right",
        annotation_font_color=color,
        row=row, col=1,
    )


# ── Sidebar ────────────────────────────────────────────────────────────────

st.sidebar.title("Lab — Strategy Audit")

runs = discover_runs(str(RUNS_DIR))
if not runs:
    st.error(f"No runs found in `{RUNS_DIR}`.\n\nRun a strategy first:\n```\npython lab/run_rsi4h.py\n```")
    st.stop()

run_map = {r["run_id"]: r for r in runs}
selected_run_id = st.sidebar.selectbox("Run", list(run_map.keys()))
run = run_map[selected_run_id]
cfg = run["cfg"]

tp_tags = run["tp_tags"]
if not tp_tags:
    st.warning("No trade files found in this run.")
    st.stop()
selected_tp = st.sidebar.selectbox("TP target", tp_tags)

with st.sidebar.expander("Run config"):
    st.json(cfg)

# ── Load trades ────────────────────────────────────────────────────────────

trades_df = load_trades_df(run["run_dir"], selected_tp)
if trades_df.empty:
    st.warning("No trades found for this run / TP combination.")
    st.stop()

db_path: str = cfg.get("db_path", cfg.get("db", ""))

# ── Tabs ───────────────────────────────────────────────────────────────────

tab_overview, tab_trades, tab_chart = st.tabs(["Overview", "Trades", "Chart"])

# ──────────────────────────────────────────────────────────────────────────
with tab_overview:
    managed_r = trades_df["managed_r"]
    baseline_r = trades_df["baseline_r"]
    hold_h = trades_df["hold_5m_bars"] * 5 / 60

    c1, c2, c3, c4, c5, c6 = st.columns(6)
    c1.metric("Total R (managed)",  f"{managed_r.sum():.2f}")
    c2.metric("Total R (baseline)", f"{baseline_r.sum():.2f}")
    c3.metric("Trades",             len(trades_df))
    c4.metric("Win %",              f"{(managed_r > 0).mean() * 100:.1f}%")
    c5.metric("Avg Hold",           f"{hold_h.mean():.1f}h")
    c6.metric("Max DD (managed)",   f"{_max_dd(managed_r.values):.2f}R")

    st.plotly_chart(equity_curve_fig(trades_df), use_container_width=True)

    col_asset, col_month = st.columns(2)

    with col_asset:
        st.subheader("By Asset")
        asset_tbl = (
            trades_df.groupby("symbol")
            .apply(lambda g: pd.Series({
                "trades":    len(g),
                "total_R":   round(g["managed_r"].sum(), 2),
                "baseline_R": round(g["baseline_r"].sum(), 2),
                "win_%":     round((g["managed_r"] > 0).mean() * 100, 1),
                "avg_hold_h": round(g["hold_5m_bars"].mean() * 5 / 60, 1),
            }), include_groups=False)
            .reset_index()
            .sort_values("total_R", ascending=False)
        )
        st.dataframe(asset_tbl, use_container_width=True, hide_index=True)

    with col_month:
        st.subheader("By Month")
        df_copy = trades_df.copy()
        df_copy["month"] = (
            pd.to_datetime(df_copy["exit_ts_utc"], utc=True)
            .dt.to_period("M").astype(str)
        )
        month_tbl = (
            df_copy.groupby("month")
            .apply(lambda g: pd.Series({
                "trades":  len(g),
                "total_R": round(g["managed_r"].sum(), 2),
                "win_%":   round((g["managed_r"] > 0).mean() * 100, 1),
            }), include_groups=False)
            .reset_index()
        )
        st.dataframe(month_tbl, use_container_width=True, hide_index=True)

    # Vol regime breakdown (only when vol column exists — BB runs)
    if "vol" in trades_df.columns and trades_df["vol"].notna().any():
        st.subheader("By Vol Regime (BALANCED trades only)")
        vol_tbl = (
            trades_df.groupby("vol")
            .apply(lambda g: pd.Series({
                "trades":    len(g),
                "total_R":   round(g["managed_r"].sum(), 2),
                "avg_R":     round(g["managed_r"].mean(), 3),
                "win_%":     round((g["managed_r"] > 0).mean() * 100, 1),
                "avg_hold_h": round(g["hold_5m_bars"].mean() * 5 / 60, 1),
            }), include_groups=False)
            .reset_index()
            .sort_values("total_R", ascending=False)
        )
        st.dataframe(vol_tbl, use_container_width=True, hide_index=True)

    # Exit reason breakdown
    st.subheader("Exit Reasons")
    reason_tbl = (
        trades_df.groupby("managed_reason")
        .apply(lambda g: pd.Series({
            "count":   len(g),
            "avg_R":   round(g["managed_r"].mean(), 3),
            "total_R": round(g["managed_r"].sum(), 2),
        }), include_groups=False)
        .reset_index()
    )
    st.dataframe(reason_tbl, use_container_width=True, hide_index=True)


# ──────────────────────────────────────────────────────────────────────────
with tab_trades:
    st.subheader(f"{selected_run_id}  /  {selected_tp}")

    f_sym, f_side, f_reason = st.columns(3)
    symbols = ["All"] + sorted(trades_df["symbol"].unique().tolist())
    sel_sym = f_sym.selectbox("Symbol", symbols, key="sym_filter")
    sides_map = {"All": None, "Long (+1)": 1, "Short (-1)": -1}
    sel_side = f_side.selectbox("Side", list(sides_map.keys()), key="side_filter")
    reasons = ["All"] + sorted(trades_df["managed_reason"].unique().tolist())
    sel_reason = f_reason.selectbox("Exit reason", reasons, key="reason_filter")

    filtered = trades_df.copy()
    if sel_sym != "All":
        filtered = filtered[filtered["symbol"] == sel_sym]
    if sides_map[sel_side] is not None:
        filtered = filtered[filtered["side"] == sides_map[sel_side]]
    if sel_reason != "All":
        filtered = filtered[filtered["managed_reason"] == sel_reason]

    display_cols = [
        "symbol", "side", "entry_ts_utc", "exit_ts_utc",
        "entry_price", "stop_init", "tp_price",
        "baseline_r", "managed_r", "managed_reason", "hold_5m_bars",
    ]
    show_cols = [c for c in display_cols if c in filtered.columns]

    event = st.dataframe(
        filtered[show_cols].reset_index(drop=True),
        use_container_width=True,
        hide_index=True,
        selection_mode="single-row",
        on_select="rerun",
        key="trade_table",
    )

    if event.selection and event.selection.rows:
        row_idx = event.selection.rows[0]
        sel = filtered.iloc[row_idx]
        st.session_state["selected_trade"] = sel.to_dict()
        direction = "Long" if int(sel["side"]) == 1 else "Short"
        st.success(
            f"**Selected:** {sel['symbol']} {direction} | "
            f"{sel['entry_ts_utc']} → {sel['exit_ts_utc']} | "
            f"{sel['managed_reason']} {float(sel['managed_r']):.3f}R  "
            f"_(switch to Chart tab)_"
        )


# ──────────────────────────────────────────────────────────────────────────
with tab_chart:
    if "selected_trade" not in st.session_state:
        st.info("Select a trade in the **Trades** tab first.")
        st.stop()

    trade = pd.Series(st.session_state["selected_trade"])

    if not db_path:
        st.warning("No `db_path` found in run config — cannot load candles.")
        st.stop()

    symbol = str(trade["symbol"])
    direction = "Long" if int(trade["side"]) == 1 else "Short"
    st.subheader(
        f"{symbol} {direction} | {trade['entry_ts_utc']} → {trade['exit_ts_utc']} "
        f"| {trade['managed_reason']} {float(trade['managed_r']):.3f}R"
    )

    with st.spinner("Loading candle data..."):
        df5 = load_candles_for_trade(db_path, symbol, trade["entry_ts_utc"], trade["exit_ts_utc"])
        regime_df, htf = load_regime_df(run["run_dir"], symbol)

    if df5.empty:
        st.warning("No candle data found for this trade window.")
    else:
        rsi_window = int(trade.get("rsi_window", 20))
        fig = trade_chart_fig(
            df5, trade,
            rsi_window=rsi_window,
            regime_df=regime_df if not regime_df.empty else None,
            htf=htf,
        )
        st.plotly_chart(fig, use_container_width=True)
        if not regime_df.empty:
            st.caption(f"HTF: {htf} | Regime panel: structure_num (0=BALANCED, 1=IMBALANCED) | vol_num (0=LOW, 1=NORMAL, 2=HIGH)")

        with st.expander("Raw trade data"):
            clean = {
                k: v for k, v in trade.items()
                if not (isinstance(v, float) and np.isnan(v))
            }
            st.json(clean)

