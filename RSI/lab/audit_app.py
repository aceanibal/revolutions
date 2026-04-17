"""
Trade Audit Dashboard — reads runs/*/trades/trades_all.csv directly.

Launch: streamlit run lab/audit_app.py
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

LAB_ROOT = Path(__file__).resolve().parent
REPO_ROOT = LAB_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

RUNS_DIR = REPO_ROOT / "runs"

from lab.core.db import load_candles_window      # noqa: E402
from lab.core.regime import classify_regimes, regime_numeric  # noqa: E402

# ── Page config ────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Trade Audit",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Stream condition descriptions (from strategy/ specs) ───────────────────
STREAM_CONDITIONS = {
    "S1": "IMBAL+HIGH long | vol_ratio>1.8 | body>55% | close<15% | ATR×2.0 stop | TP=12R",
    "S2": "BAL+HIGH short | vol_ratio>1.5 | body>55% | close<20% | ATR×1.5 stop | TP=3R",
    "S3": "BAL+HIGH short + bearish FVG | vol_ratio>1.8 | body>55% | close<15% | FVG-LOW stop (+ATR×0.15 buf) | TP=4.25R",
    "S4": "BAL+HIGH long | swing-low sweep | lookback=50 | tol=0.5% | ATR×2.0 stop | BE lock 3.5R→+1R | TP=19.5R",
    "S5": "IMBAL+HIGH short | vol_ratio>1.8 | body>55% | close<15% | ATR×2.0 stop | TP=5.0R",
}

# ── Data loaders ───────────────────────────────────────────────────────────

@st.cache_data(ttl=30)
def discover_runs(runs_dir: str) -> list[dict]:
    p = Path(runs_dir)
    out = []
    for d in sorted(p.iterdir(), reverse=True):
        if not d.is_dir() or not d.name.startswith("run_"):
            continue
        cfg_path = d / "run_config.json"
        trades_path = d / "trades" / "trades_all.csv"
        if not cfg_path.exists() or not trades_path.exists():
            continue
        cfg = json.loads(cfg_path.read_text())
        out.append({"run_id": d.name, "run_dir": str(d), "cfg": cfg})
    return out


@st.cache_data
def load_trades(run_dir: str) -> pd.DataFrame:
    p = Path(run_dir) / "trades" / "trades_all.csv"
    df = pd.read_csv(p)
    df["entry_ts_utc"] = pd.to_datetime(df["entry_ts_utc"], utc=True)
    df["exit_ts_utc"] = pd.to_datetime(df["exit_ts_utc"], utc=True)
    return df


@st.cache_data(ttl=600)
def load_candles(db_path: str, symbol: str, entry_ts: str, exit_ts: str,
                 pre_hours: int = 120, post_hours: int = 48) -> pd.DataFrame:
    buf_ms = pre_hours * 3_600_000
    post_ms = post_hours * 3_600_000
    entry_ms = int(pd.Timestamp(entry_ts).timestamp() * 1000)
    exit_ms = int(pd.Timestamp(exit_ts).timestamp() * 1000)
    return load_candles_window(db_path, symbol, entry_ms - buf_ms, exit_ms + post_ms)


@st.cache_data(show_spinner=False)
def compute_regime(df5_json: str) -> pd.DataFrame:
    df5 = pd.read_json(io.StringIO(df5_json), orient="split", convert_dates=False)
    df5.index = pd.to_datetime(df5.index, utc=True)
    df1h = (
        df5.resample("1h")
        .agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
        .dropna()
    )
    r = classify_regimes(df1h)
    return regime_numeric(r)


# ── Chart helpers ──────────────────────────────────────────────────────────

def _candles(df: pd.DataFrame, name: str = "") -> go.Candlestick:
    return go.Candlestick(
        x=df.index, open=df["open"], high=df["high"],
        low=df["low"], close=df["close"],
        name=name,
        increasing_line_color="#26a69a",
        decreasing_line_color="#ef5350",
        showlegend=False,
    )


def _hline_annot(fig: go.Figure, y: float, color: str, label: str,
                 row: int, dash: str = "solid", width: float = 1.5) -> None:
    fig.add_hline(
        y=y, line_color=color, line_dash=dash, line_width=width,
        annotation_text=label, annotation_position="right",
        annotation_font_color=color, annotation_font_size=11,
        row=row, col=1,
    )


def _add_regime_shading(fig: go.Figure, regime_df: pd.DataFrame) -> None:
    if "structure" not in regime_df.columns or regime_df.empty:
        return
    vals = regime_df["structure"].values
    times = regime_df.index
    i = 0
    while i < len(vals):
        s = vals[i]
        if pd.isna(s):
            i += 1
            continue
        j = i + 1
        while j < len(vals) and vals[j] == s:
            j += 1
        t0 = times[i]
        t1 = times[j - 1] + pd.Timedelta(hours=1)
        color = "rgba(38,166,154,0.08)" if s == "BALANCED" else "rgba(239,83,80,0.08)"
        fig.add_vrect(x0=t0, x1=t1, fillcolor=color, line_width=0, layer="below", row=1, col=1)
        i = j


def build_chart(df5: pd.DataFrame, trade: pd.Series, cfg: dict,
                regime_df: pd.DataFrame) -> go.Figure:
    entry_ts = pd.Timestamp(trade["entry_ts_utc"])
    exit_ts  = pd.Timestamp(trade["exit_ts_utc"])
    stream   = str(trade["stream"])
    side     = int(trade["side"])
    entry_p  = float(trade["entry_price"])
    stop_p   = float(trade["stop_init"])
    tp_p     = float(trade["tp_price"])
    risk     = float(trade["risk"])
    mfe_r    = float(trade["mfe_r"])

    mfe_price = entry_p + side * mfe_r * risk

    has_regime = not regime_df.empty

    # 1h candles from the full loaded window
    df1h = (
        df5.resample("1h")
        .agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
        .dropna()
    )

    # 5m window: trade detail zoom
    z_start = entry_ts - pd.Timedelta(hours=10)
    z_end   = exit_ts  + pd.Timedelta(hours=6)
    df5z    = df5.loc[(df5.index >= z_start) & (df5.index <= z_end)]

    if has_regime:
        n_rows = 3
        row_heights = [0.36, 0.10, 0.54]
        subplot_titles = ("1h Chart", "Regime (structure / vol)", "5m Detail")
    else:
        n_rows = 2
        row_heights = [0.40, 0.60]
        subplot_titles = ("1h Chart", "5m Detail")

    fig = make_subplots(
        rows=n_rows, cols=1,
        row_heights=row_heights,
        shared_xaxes=False,
        vertical_spacing=0.03,
        subplot_titles=subplot_titles,
    )

    # ── Row 1: 1h candles ─────────────────────────────────────────────────
    fig.add_trace(_candles(df1h, "1h"), row=1, col=1)
    fig.add_vline(x=entry_ts, line_color="#ffd54f", line_dash="dash", line_width=1.5)
    fig.add_vline(x=exit_ts,  line_color="#ef9a9a", line_dash="dash", line_width=1.5)

    _hline_annot(fig, entry_p, "#ffd54f", "Entry", row=1, dash="dot", width=1)
    _hline_annot(fig, stop_p,  "#ef5350", "SL",    row=1, dash="dot", width=1)
    _hline_annot(fig, tp_p,    "#26a69a", "TP",    row=1, dash="dot", width=1)

    if has_regime:
        r1h_win = regime_df.loc[
            (regime_df.index >= df1h.index[0]) & (regime_df.index <= df1h.index[-1])
        ]
        _add_regime_shading(fig, r1h_win)

    # Entry / exit candle markers on 1h
    entry_1h = df1h.index[df1h.index <= entry_ts]
    exit_1h  = df1h.index[df1h.index <= exit_ts]
    if len(entry_1h):
        bar = df1h.loc[entry_1h[-1]]
        fig.add_trace(go.Scatter(
            x=[entry_1h[-1]], y=[bar["low"] * 0.999 if side == 1 else bar["high"] * 1.001],
            mode="markers",
            marker=dict(symbol="triangle-up" if side == 1 else "triangle-down",
                        color="#ffd54f", size=12),
            name="Entry", showlegend=False,
        ), row=1, col=1)
    if len(exit_1h):
        bar = df1h.loc[exit_1h[-1]]
        fig.add_trace(go.Scatter(
            x=[exit_1h[-1]], y=[bar["high"] * 1.001 if side == 1 else bar["low"] * 0.999],
            mode="markers",
            marker=dict(symbol="x", color="#ef9a9a", size=10),
            name="Exit", showlegend=False,
        ), row=1, col=1)

    # ── Row 2: Regime panel ───────────────────────────────────────────────
    if has_regime:
        r_win = regime_df.loc[
            (regime_df.index >= df1h.index[0]) & (regime_df.index <= df1h.index[-1])
        ]
        if "structure_num" in r_win.columns:
            fig.add_trace(go.Scatter(
                x=r_win.index, y=r_win["structure_num"],
                name="Structure (0=BAL, 1=IMB)",
                line=dict(color="#26a69a", width=1.5, shape="hv"),
                fill="tozeroy", fillcolor="rgba(38,166,154,0.12)",
                showlegend=True,
            ), row=2, col=1)
        if "vol_num" in r_win.columns:
            fig.add_trace(go.Scatter(
                x=r_win.index, y=r_win["vol_num"],
                name="Vol (0=L, 1=N, 2=H)",
                line=dict(color="#ffa726", width=1.5, shape="hv"),
                showlegend=True,
            ), row=2, col=1)
        fig.update_yaxes(tickvals=[0, 1, 2], ticktext=["BAL/L", "IMB/N", "H"], row=2, col=1)

    # ── Last row: 5m detail ────────────────────────────────────────────────
    last_row = n_rows
    fig.add_trace(_candles(df5z, "5m"), row=last_row, col=1)
    fig.add_vline(x=entry_ts, line_color="#ffd54f", line_dash="dash", line_width=2)
    fig.add_vline(x=exit_ts,  line_color="#ef9a9a", line_dash="dash", line_width=2)

    _hline_annot(fig, entry_p, "#ffd54f", f"Entry {entry_p:.4g}", row=last_row)
    _hline_annot(fig, stop_p,  "#ef5350", f"SL {stop_p:.4g}",    row=last_row)
    _hline_annot(fig, tp_p,    "#26a69a", f"TP {tp_p:.4g}",      row=last_row)
    _hline_annot(fig, mfe_price, "#80cbc4", f"MFE {mfe_r:.2f}R",  row=last_row, dash="dot", width=1.5)

    # Lock level for S4
    if stream == "S4":
        s4_cfg = cfg.get("locked_config", {}).get("s4", {})
        lock_r = float(s4_cfg.get("lock_r", 1.0))
        trig_r = float(s4_cfg.get("trig_r", 3.5))
        lock_price = entry_p + side * lock_r * risk
        _hline_annot(fig, lock_price, "#ce93d8", f"Lock {lock_r}R", row=last_row, dash="dot", width=1.2)

    # Entry candle marker on 5m
    entry_5m = df5z.index[df5z.index <= entry_ts]
    exit_5m  = df5z.index[df5z.index <= exit_ts]
    if len(entry_5m):
        bar = df5z.loc[entry_5m[-1]]
        fig.add_trace(go.Scatter(
            x=[entry_5m[-1]], y=[bar["low"] * 0.9985 if side == 1 else bar["high"] * 1.0015],
            mode="markers",
            marker=dict(symbol="triangle-up" if side == 1 else "triangle-down",
                        color="#ffd54f", size=14),
            showlegend=False,
        ), row=last_row, col=1)
    if len(exit_5m):
        bar = df5z.loc[exit_5m[-1]]
        fig.add_trace(go.Scatter(
            x=[exit_5m[-1]], y=[bar["high"] * 1.0015 if side == 1 else bar["low"] * 0.9985],
            mode="markers",
            marker=dict(symbol="x", color="#ef9a9a", size=12),
            showlegend=False,
        ), row=last_row, col=1)

    height = 950 if has_regime else 800
    fig.update_layout(
        height=height,
        margin=dict(l=0, r=90, t=36, b=0),
        hovermode="x unified",
        showlegend=has_regime,
        legend=dict(orientation="h", yanchor="bottom", y=1.01, x=0),
        **{f"xaxis{i}_rangeslider_visible": False for i in range(1, n_rows + 1)},
        xaxis_rangeslider_visible=False,
    )
    return fig


# ── Run selector ──────────────────────────────────────────────────────────
st.sidebar.title("Trade Audit")

runs = discover_runs(str(RUNS_DIR))
if not runs:
    st.error(f"No runs found in `{RUNS_DIR}`.")
    st.stop()

run_map = {r["run_id"]: r for r in runs}
sel_run_id = st.sidebar.selectbox("Run", list(run_map.keys()))
run = run_map[sel_run_id]
cfg = run["cfg"]
db_path: str = cfg.get("db", cfg.get("db_path", ""))

with st.sidebar.expander("Run config", expanded=False):
    st.sidebar.json(cfg)

# ── Load trades ────────────────────────────────────────────────────────────
trades_df = load_trades(run["run_dir"])

# ── Filters ────────────────────────────────────────────────────────────────
st.sidebar.markdown("#### Filters")

streams = ["All"] + sorted(trades_df["stream"].unique().tolist())
syms    = ["All"] + sorted(trades_df["sym"].unique().tolist())
reasons = ["All"] + sorted(trades_df["managed_reason"].unique().tolist())
years   = ["All"] + sorted(trades_df["year"].unique().astype(str).tolist())

col_a, col_b = st.sidebar.columns(2)
sel_stream = col_a.selectbox("Stream", streams, key="f_stream")
sel_sym    = col_b.selectbox("Symbol", syms,    key="f_sym")
col_c, col_d = st.sidebar.columns(2)
sel_side   = col_c.selectbox("Side",   ["All", "L", "S"], key="f_side")
sel_reason = col_d.selectbox("Reason", reasons, key="f_reason")
sel_year   = st.sidebar.selectbox("Year", years, key="f_year")

side_map = {"All": None, "L": 1, "S": -1}

filtered = trades_df.copy()
if sel_stream != "All":  filtered = filtered[filtered["stream"] == sel_stream]
if sel_sym    != "All":  filtered = filtered[filtered["sym"]    == sel_sym]
if side_map[sel_side] is not None:
    filtered = filtered[filtered["side"] == side_map[sel_side]]
if sel_reason != "All":  filtered = filtered[filtered["managed_reason"] == sel_reason]
if sel_year   != "All":  filtered = filtered[filtered["year"] == int(sel_year)]

# ── Sidebar summary ────────────────────────────────────────────────────────
total_r = filtered["managed_r"].sum()
win_pct = (filtered["managed_r"] > 0).mean() * 100 if len(filtered) else 0.0
st.sidebar.caption(
    f"{len(filtered)} trades · {total_r:+.1f}R · {win_pct:.0f}% win"
)
st.sidebar.divider()

# ── Trade list (fixed-height scrollable) ───────────────────────────────────
st.sidebar.markdown("#### Trades — click to audit")

list_cols = ["stream", "sym", "side", "entry_ts_utc", "managed_r", "mfe_r", "managed_reason"]
list_df = filtered[list_cols].copy().reset_index(drop=True)
list_df["entry_ts_utc"] = list_df["entry_ts_utc"].dt.strftime("%Y-%m-%d %H:%M")

event = st.sidebar.dataframe(
    list_df,
    use_container_width=True,
    hide_index=True,
    height=520,
    selection_mode="single-row",
    on_select="rerun",
    key="trade_table",
    column_config={
        "entry_ts_utc": st.column_config.TextColumn("Entry UTC", width="medium"),
        "managed_r":    st.column_config.NumberColumn("R",   format="%.3f", width="small"),
        "mfe_r":        st.column_config.NumberColumn("MFE", format="%.2f", width="small"),
        "managed_reason": st.column_config.TextColumn("Exit", width="small"),
        "stream":       st.column_config.TextColumn("S",    width="small"),
        "sym":          st.column_config.TextColumn("Sym",  width="small"),
        "side":         st.column_config.NumberColumn("Dir", width="small"),
    },
)

# ── Main area: placeholder or trade detail ─────────────────────────────────
if not (event.selection and event.selection.rows):
    st.markdown("## Trade Audit")
    st.info("Select a trade from the sidebar list to load its chart.")
    st.stop()

row_idx   = event.selection.rows[0]
trade     = filtered.iloc[row_idx]
stream    = str(trade["stream"])
sym       = str(trade["sym"])
side      = int(trade["side"])
direction = "Long" if side == 1 else "Short"
r_val     = float(trade["managed_r"])
reason    = str(trade["managed_reason"])

# ── Trade audit container (scrollable) ────────────────────────────────────
audit = st.container(height=920, border=False)

# ── Trade info header ──────────────────────────────────────────────────────
col_info, col_cond = audit.columns([2, 3])
with col_info:
    st.markdown(f"### {stream} — {sym} {direction}")
    mfe_price = float(trade["entry_price"]) + side * float(trade["mfe_r"]) * float(trade["risk"])
    st.markdown(
        f"**Entry:** {trade['entry_ts_utc'].strftime('%Y-%m-%d %H:%M')} UTC &nbsp;·&nbsp; "
        f"**Exit:** {trade['exit_ts_utc'].strftime('%Y-%m-%d %H:%M')} UTC  \n"
        f"**R:** `{r_val:+.3f}` &nbsp; **MFE:** `{float(trade['mfe_r']):.2f}R` ({mfe_price:.6g}) "
        f"&nbsp; **Hold:** `{float(trade['duration_h']):.1f}h`  \n"
        f"**Exit:** `{reason}` &nbsp;·&nbsp; "
        f"**Entry:** `{float(trade['entry_price']):.6g}` &nbsp; "
        f"**SL:** `{float(trade['stop_init']):.6g}` &nbsp; "
        f"**TP:** `{float(trade['tp_price']):.6g}` &nbsp; "
        f"**Risk:** `{float(trade['risk']):.6g}`"
    )
with col_cond:
    st.markdown(f"**{stream} signal conditions**")
    st.info(STREAM_CONDITIONS.get(stream, "—"))
    if stream == "S4":
        s4 = cfg.get("locked_config", {}).get("s4", {})
        lock_p = float(trade["entry_price"]) + side * float(s4.get("lock_r", 1.0)) * float(trade["risk"])
        trig_p = float(trade["entry_price"]) + side * float(s4.get("trig_r", 3.5)) * float(trade["risk"])
        st.caption(f"BE trig @ {trig_p:.6g}  →  lock @ {lock_p:.6g}")

# ── Load candles & render chart ────────────────────────────────────────────
if not db_path:
    audit.warning("No `db` path in run config — cannot load candles.")
    st.stop()

with audit.spinner(f"Loading candles for {sym}…"):
    df5 = load_candles(
        db_path, sym,
        trade["entry_ts_utc"].isoformat(),
        trade["exit_ts_utc"].isoformat(),
    )

if df5.empty:
    audit.warning("No candle data found.")
    st.stop()

regime_df = compute_regime(df5.to_json(orient="split", date_format="iso"))

fig = build_chart(df5, trade, cfg, regime_df)
audit.plotly_chart(fig, use_container_width=True)

with audit.expander("Raw trade fields"):
    st.json({k: (v.isoformat() if isinstance(v, pd.Timestamp) else v)
             for k, v in trade.items() if not (isinstance(v, float) and np.isnan(v))})
