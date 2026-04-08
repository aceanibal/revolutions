#!/usr/bin/env python3
"""
ML study for post-hit 5m behavior on weekly/daily extreme events.

Builds event-level features from the full post-hit 5m path (hit -> session end),
creates multi-output labels, runs interpretable supervised models + clustering,
and exports data/metrics/charts.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import balanced_accuracy_score, confusion_matrix, f1_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from liquidity_zones import DB_PATH, list_sessions_with_symbol, load_5m_candles
from reversal_study import slice_candles
from strategy_sim import OVERNIGHT_MS


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ML study for post-hit 5m behavior")
    parser.add_argument("--db", default=DB_PATH)
    parser.add_argument("--session-id", default="")
    parser.add_argument("--symbol", default="XRPUSDT")
    parser.add_argument(
        "--weekly-events-json",
        default=os.path.join(os.path.dirname(__file__), "cache", "week_extreme_study_xrp.json"),
    )
    parser.add_argument(
        "--daily-events-json",
        default=os.path.join(
            os.path.dirname(__file__),
            "cache",
            "daily_extreme_no_weekly_session_overlap_xrp",
            "daily_events_filtered.json",
        ),
    )
    parser.add_argument(
        "--output-dir",
        default=os.path.join(os.path.dirname(__file__), "cache", "hit_event_ml_study_xrp"),
    )
    parser.add_argument("--direction-threshold-pct", type=float, default=0.20)
    parser.add_argument("--return-bucket-threshold-pct", type=float, default=1.00)
    parser.add_argument("--breakout-threshold-pct", type=float, default=0.20)
    return parser.parse_args()


def _pick_session(db: str, session_id: str, symbol: str) -> str:
    if session_id:
        return session_id
    sessions = list_sessions_with_symbol(db, symbol)
    if not sessions:
        raise RuntimeError(f"No historical sessions found for {symbol}")
    return sessions[0][0]


def _safe_pct(a: float, b: float) -> float:
    if b == 0:
        return 0.0
    return (a - b) / b * 100.0


def _safe_div(a: float, b: float) -> float:
    if b == 0:
        return 0.0
    return a / b


def _drawdown_from_path(closes: np.ndarray) -> float:
    if closes.size == 0:
        return 0.0
    running_peak = np.maximum.accumulate(closes)
    dd = (running_peak - closes) / np.where(running_peak == 0, 1.0, running_peak) * 100.0
    return float(np.max(dd))


def _trend_slope_pct_per_bar(closes: np.ndarray, base: float) -> float:
    if closes.size < 2 or base == 0:
        return 0.0
    y = (closes / base - 1.0) * 100.0
    x = np.arange(closes.size)
    slope, _ = np.polyfit(x, y, 1)
    return float(slope)


def _realized_vol_pct(closes: np.ndarray) -> float:
    if closes.size < 3:
        return 0.0
    rets = np.diff(np.log(np.where(closes <= 0, np.nan, closes)))
    rets = rets[~np.isnan(rets)]
    if rets.size == 0:
        return 0.0
    return float(np.std(rets) * math.sqrt(rets.size) * 100.0)


def _third_means(values: np.ndarray) -> tuple[float, float, float]:
    if values.size == 0:
        return 0.0, 0.0, 0.0
    third = max(1, values.size // 3)
    early = values[:third]
    mid = values[third : 2 * third]
    late = values[2 * third :]
    return (
        float(np.mean(early)) if early.size else 0.0,
        float(np.mean(mid)) if mid.size else 0.0,
        float(np.mean(late)) if late.size else 0.0,
    )


@dataclass
class EventPack:
    row: dict[str, Any]
    path_norm_pct: list[float]


def _label_direction(end_ret_pct: float, thr: float) -> str:
    if end_ret_pct > thr:
        return "up"
    if end_ret_pct < -thr:
        return "down"
    return "flat"


def _label_return_bucket(end_ret_pct: float, thr: float) -> str:
    if end_ret_pct >= thr:
        return "strong_up"
    if end_ret_pct <= -thr:
        return "strong_down"
    return "neutral"


def _label_breakout(event_type: str, cont_pct: float, rej_pct: float, thr: float) -> str:
    # For highs: continuation means move above level. For lows: below level.
    # We compare continuation vs rejection magnitudes within the remaining session.
    if cont_pct >= thr and cont_pct >= rej_pct * 1.10:
        return "continuation"
    if rej_pct >= thr and rej_pct >= cont_pct * 1.10:
        return "rejection"
    return "indecisive"


def build_event_row(
    event: dict[str, Any],
    source: str,
    candles_5m: list[dict[str, Any]],
    direction_thr: float,
    bucket_thr: float,
    breakout_thr: float,
) -> EventPack | None:
    anchor_ms = int(event["anchor_ms"])
    hit_ms = int(event["hit_ms"])
    level = float(event["level"])
    hit_close = float(event["hit_close"])
    event_type = str(event["event_type"])
    session_day = str(event["session_day"])

    post = slice_candles(candles_5m, hit_ms, anchor_ms + OVERNIGHT_MS)
    if len(post) < 3:
        return None
    pre = slice_candles(candles_5m, hit_ms - 24 * 5 * 60_000, hit_ms - 5 * 60_000)
    pre_1h = slice_candles(candles_5m, hit_ms - 12 * 5 * 60_000, hit_ms - 5 * 60_000)
    pre_2h = slice_candles(candles_5m, hit_ms - 24 * 5 * 60_000, hit_ms - 5 * 60_000)

    closes = np.array([float(c["close"]) for c in post], dtype=float)
    highs = np.array([float(c["high"]) for c in post], dtype=float)
    lows = np.array([float(c["low"]) for c in post], dtype=float)
    vols = np.array([float(c["volume"]) for c in post], dtype=float)
    pre_vols = np.array([float(c["volume"]) for c in pre], dtype=float) if pre else np.array([], dtype=float)
    pre_closes = np.array([float(c["close"]) for c in pre], dtype=float) if pre else np.array([], dtype=float)
    pre_highs = np.array([float(c["high"]) for c in pre], dtype=float) if pre else np.array([], dtype=float)
    pre_lows = np.array([float(c["low"]) for c in pre], dtype=float) if pre else np.array([], dtype=float)

    end_close = float(closes[-1])
    end_ret_pct = _safe_pct(end_close, hit_close)
    max_up_pct = _safe_pct(float(np.max(highs)), hit_close)
    max_down_pct = _safe_pct(float(np.min(lows)), hit_close) * -1.0

    idx_peak = int(np.argmax(highs))
    idx_trough = int(np.argmin(lows))
    time_to_peak_min = idx_peak * 5
    time_to_trough_min = idx_trough * 5

    pre_vol_mean = float(np.mean(pre_vols)) if pre_vols.size else 0.0
    post_vol_mean = float(np.mean(vols))
    post_vol_peak = float(np.max(vols))
    early_v, mid_v, late_v = _third_means(vols)

    if event_type in ("week_high", "daily_high"):
        continuation_pct = _safe_pct(float(np.max(highs)), level)
        rejection_pct = _safe_pct(level, float(np.min(lows)))
    else:
        continuation_pct = _safe_pct(level, float(np.min(lows)))
        rejection_pct = _safe_pct(float(np.max(highs)), level)

    path_norm_pct = ((closes / hit_close) - 1.0) * 100.0
    pre_close_1h = float(pre_1h[-1]["close"]) if pre_1h else hit_close
    pre_open_1h = float(pre_1h[0]["open"]) if pre_1h else hit_close
    pre_close_2h = float(pre_2h[-1]["close"]) if pre_2h else hit_close
    pre_open_2h = float(pre_2h[0]["open"]) if pre_2h else hit_close
    pre_return_1h_pct = _safe_pct(pre_close_1h, pre_open_1h)
    pre_return_2h_pct = _safe_pct(pre_close_2h, pre_open_2h)
    pre_range_mean_pct = _safe_div(float(np.mean(pre_highs - pre_lows)) * 100.0, hit_close) if pre_highs.size else 0.0
    pre_realized_vol_pct = _realized_vol_pct(pre_closes) if pre_closes.size else 0.0
    pre_trend_slope_pct = _trend_slope_pct_per_bar(pre_closes, pre_closes[0]) if pre_closes.size else 0.0
    dist_level_from_hit_pct = _safe_pct(level, hit_close)

    row = {
        "source": source,
        "session_day": session_day,
        "event_type": event_type,
        "anchor_ms": anchor_ms,
        "hit_ms": hit_ms,
        "minutes_to_hit": float(event["minutes_to_hit"]),
        "level": level,
        "hit_close": hit_close,
        "bars_post": int(len(post)),
        "end_ret_pct": end_ret_pct,
        "max_up_pct": max_up_pct,
        "max_down_pct": max_down_pct,
        "time_to_peak_min": time_to_peak_min,
        "time_to_trough_min": time_to_trough_min,
        "realized_vol_pct": _realized_vol_pct(closes),
        "trend_slope_pct_per_bar": _trend_slope_pct_per_bar(closes, hit_close),
        "max_drawdown_pct": _drawdown_from_path(closes),
        "hit_candle_range": float(event["hit_candle_range"]),
        "hit_candle_range_pct_of_level": float(event["hit_candle_range_pct_of_level"]),
        "hit_volume_zscore_24bars": float(event["hit_volume_zscore_24bars"]),
        "pre_return_1h_pct": pre_return_1h_pct,
        "pre_return_2h_pct": pre_return_2h_pct,
        "pre_range_mean_pct": pre_range_mean_pct,
        "pre_realized_vol_pct": pre_realized_vol_pct,
        "pre_trend_slope_pct": pre_trend_slope_pct,
        "dist_level_from_hit_pct": dist_level_from_hit_pct,
        "post_vol_mean": post_vol_mean,
        "post_vol_peak": post_vol_peak,
        "pre_vol_mean": pre_vol_mean,
        "vol_rel_post_vs_pre": _safe_div(post_vol_mean, pre_vol_mean),
        "vol_rel_peak_vs_pre": _safe_div(post_vol_peak, pre_vol_mean),
        "vol_early_rel_pre": _safe_div(early_v, pre_vol_mean),
        "vol_mid_rel_pre": _safe_div(mid_v, pre_vol_mean),
        "vol_late_rel_pre": _safe_div(late_v, pre_vol_mean),
        "continuation_pct": continuation_pct,
        "rejection_pct": rejection_pct,
    }

    row["label_direction"] = _label_direction(end_ret_pct, direction_thr)
    row["label_breakout"] = _label_breakout(event_type, continuation_pct, rejection_pct, breakout_thr)
    row["label_return_bucket"] = _label_return_bucket(end_ret_pct, bucket_thr)
    return EventPack(row=row, path_norm_pct=path_norm_pct.tolist())


def save_confusion_plot(cm: np.ndarray, labels: list[str], title: str, out_path: str) -> None:
    fig, ax = plt.subplots(figsize=(6, 5))
    im = ax.imshow(cm, aspect="auto")
    ax.set_title(title)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("True")
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=30, ha="right")
    ax.set_yticks(range(len(labels)))
    ax.set_yticklabels(labels)
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(j, i, str(cm[i, j]), ha="center", va="center", fontsize=9)
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def save_importance_plot(feature_names: list[str], importances: np.ndarray, title: str, out_path: str, top_n: int = 15) -> None:
    order = np.argsort(importances)[::-1][:top_n]
    f = [feature_names[i] for i in order]
    v = [float(importances[i]) for i in order]
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.barh(range(len(f)), v[::-1])
    ax.set_yticks(range(len(f)))
    ax.set_yticklabels(f[::-1], fontsize=9)
    ax.set_title(title)
    ax.set_xlabel("Importance (|coef|)")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def run_supervised_view(
    df: pd.DataFrame,
    view_name: str,
    out_charts_dir: str,
    feature_mode: str = "all_path",
    random_state: int = 42,
) -> tuple[dict[str, Any], pd.DataFrame]:
    metrics: dict[str, Any] = {}
    pred_rows: list[dict[str, Any]] = []
    if df.empty:
        return {"error": "empty view"}, pd.DataFrame()

    all_path_feature_cols = [
        "minutes_to_hit",
        "bars_post",
        "end_ret_pct",
        "max_up_pct",
        "max_down_pct",
        "time_to_peak_min",
        "time_to_trough_min",
        "realized_vol_pct",
        "trend_slope_pct_per_bar",
        "max_drawdown_pct",
        "hit_candle_range",
        "hit_candle_range_pct_of_level",
        "hit_volume_zscore_24bars",
        "pre_return_1h_pct",
        "pre_return_2h_pct",
        "pre_range_mean_pct",
        "pre_realized_vol_pct",
        "pre_trend_slope_pct",
        "dist_level_from_hit_pct",
        "post_vol_mean",
        "post_vol_peak",
        "pre_vol_mean",
        "vol_rel_post_vs_pre",
        "vol_rel_peak_vs_pre",
        "vol_early_rel_pre",
        "vol_mid_rel_pre",
        "vol_late_rel_pre",
        "continuation_pct",
        "rejection_pct",
    ]
    predictive_feature_cols = [
        "minutes_to_hit",
        "hit_candle_range",
        "hit_candle_range_pct_of_level",
        "hit_volume_zscore_24bars",
        "pre_return_1h_pct",
        "pre_return_2h_pct",
        "pre_range_mean_pct",
        "pre_realized_vol_pct",
        "pre_trend_slope_pct",
        "pre_vol_mean",
        "dist_level_from_hit_pct",
    ]
    feature_cols = predictive_feature_cols if feature_mode == "predictive" else all_path_feature_cols
    cat_cols = ["event_type", "source"]
    X_num = df[feature_cols].copy()
    X_cat = pd.get_dummies(df[cat_cols], prefix=cat_cols, drop_first=False)
    X = pd.concat([X_num, X_cat], axis=1)
    X = X.replace([np.inf, -np.inf], np.nan).fillna(0.0)
    feature_names = X.columns.tolist()
    groups = df["session_day"].astype(str).values

    targets = ["label_direction", "label_breakout", "label_return_bucket"]

    for target in targets:
        y = df[target].astype(str).values
        label_counts = Counter(y)
        labels_sorted = sorted(label_counts.keys())
        majority_label = max(label_counts, key=label_counts.get)
        baseline_acc = float(np.mean([yy == majority_label for yy in y]))
        baseline_weighted_f1 = float(
            f1_score(y, np.array([majority_label] * len(y)), average="weighted", zero_division=0)
        )

        uniq_groups = len(set(groups))
        if uniq_groups < 3 or len(set(y)) < 2:
            metrics[target] = {
                "skipped": True,
                "reason": "not enough group diversity or target classes",
                "n_samples": int(len(y)),
                "label_counts": dict(label_counts),
                "baseline_majority_label": majority_label,
                "baseline_accuracy": baseline_acc,
                "baseline_weighted_f1": baseline_weighted_f1,
            }
            continue

        n_splits = min(5, uniq_groups)
        gkf = GroupKFold(n_splits=n_splits)
        oof_pred = np.empty(len(y), dtype=object)

        for tr_idx, te_idx in gkf.split(X, y, groups):
            pipe = Pipeline(
                steps=[
                    ("scaler", StandardScaler()),
                    (
                        "clf",
                        LogisticRegression(
                            max_iter=4000,
                            class_weight="balanced",
                            random_state=random_state,
                        ),
                    ),
                ]
            )
            pipe.fit(X.iloc[tr_idx], y[tr_idx])
            oof_pred[te_idx] = pipe.predict(X.iloc[te_idx])

        bal_acc = float(balanced_accuracy_score(y, oof_pred))
        weighted_f1 = float(f1_score(y, oof_pred, average="weighted", zero_division=0))
        cm = confusion_matrix(y, oof_pred, labels=labels_sorted)
        metrics[target] = {
            "skipped": False,
            "n_samples": int(len(y)),
            "label_counts": dict(label_counts),
            "baseline_majority_label": majority_label,
            "baseline_accuracy": baseline_acc,
            "baseline_weighted_f1": baseline_weighted_f1,
            "balanced_accuracy": bal_acc,
            "weighted_f1": weighted_f1,
            "labels": labels_sorted,
            "confusion_matrix": cm.tolist(),
        }

        conf_path = os.path.join(out_charts_dir, f"confusion_{feature_mode}_{view_name}_{target}.png")
        save_confusion_plot(cm, labels_sorted, f"{feature_mode} | {view_name} | {target}", conf_path)

        # Fit final model on all rows for feature importance.
        final_pipe = Pipeline(
            steps=[
                ("scaler", StandardScaler()),
                (
                    "clf",
                    LogisticRegression(
                        max_iter=4000,
                        class_weight="balanced",
                        random_state=random_state,
                    ),
                ),
            ]
        )
        final_pipe.fit(X, y)
        coef = final_pipe.named_steps["clf"].coef_
        if coef.ndim == 1:
            imp = np.abs(coef)
        else:
            imp = np.mean(np.abs(coef), axis=0)
        imp_path = os.path.join(out_charts_dir, f"importance_{feature_mode}_{view_name}_{target}.png")
        save_importance_plot(feature_names, imp, f"{feature_mode} | {view_name} | {target}", imp_path)

        for i in range(len(df)):
            pred_rows.append(
                {
                    "dataset": view_name,
                    "feature_mode": feature_mode,
                    "event_id": int(df.iloc[i]["event_id"]),
                    "session_day": df.iloc[i]["session_day"],
                    "event_type": df.iloc[i]["event_type"],
                    "target": target,
                    "y_true": y[i],
                    "y_pred": str(oof_pred[i]),
                }
            )

    return metrics, pd.DataFrame(pred_rows)


def run_clustering(df: pd.DataFrame, path_map: dict[int, list[float]], out_charts_dir: str, random_state: int = 42) -> tuple[pd.DataFrame, dict[str, Any]]:
    if df.empty:
        return df, {"error": "empty dataset"}

    clust_feats = [
        "end_ret_pct",
        "max_up_pct",
        "max_down_pct",
        "realized_vol_pct",
        "trend_slope_pct_per_bar",
        "max_drawdown_pct",
        "vol_rel_post_vs_pre",
        "continuation_pct",
        "rejection_pct",
        "minutes_to_hit",
        "bars_post",
    ]
    X = df[clust_feats].replace([np.inf, -np.inf], np.nan).fillna(0.0).values
    n = len(df)
    k = min(4, max(2, int(round(math.sqrt(max(n, 1) / 2)))))
    if n < k:
        k = max(1, n)

    if k <= 1:
        df = df.copy()
        df["cluster_id"] = 0
        return df, {"k": 1, "clusters": {"0": {"count": int(n)}}}

    km = KMeans(n_clusters=k, random_state=random_state, n_init=20)
    cluster_ids = km.fit_predict(X)
    df = df.copy()
    df["cluster_id"] = cluster_ids

    summary: dict[str, Any] = {"k": int(k), "clusters": {}}
    for cid in sorted(df["cluster_id"].unique()):
        sub = df[df["cluster_id"] == cid]
        summary["clusters"][str(cid)] = {
            "count": int(len(sub)),
            "event_type_counts": dict(Counter(sub["event_type"])),
            "source_counts": dict(Counter(sub["source"])),
            "avg_end_ret_pct": float(sub["end_ret_pct"].mean()),
            "avg_max_up_pct": float(sub["max_up_pct"].mean()),
            "avg_max_down_pct": float(sub["max_down_pct"].mean()),
            "avg_realized_vol_pct": float(sub["realized_vol_pct"].mean()),
            "direction_counts": dict(Counter(sub["label_direction"])),
            "breakout_counts": dict(Counter(sub["label_breakout"])),
            "return_bucket_counts": dict(Counter(sub["label_return_bucket"])),
        }

    # Cluster average path chart.
    fig, ax = plt.subplots(figsize=(11, 6))
    for cid in sorted(df["cluster_id"].unique()):
        ids = [int(x) for x in df[df["cluster_id"] == cid]["event_id"].tolist()]
        paths = [np.array(path_map[i], dtype=float) for i in ids if i in path_map]
        if not paths:
            continue
        max_len = max(len(p) for p in paths)
        matrix = np.full((len(paths), max_len), np.nan)
        for i, p in enumerate(paths):
            matrix[i, : len(p)] = p
        avg_path = np.nanmean(matrix, axis=0)
        x = np.arange(len(avg_path)) * 5.0
        ax.plot(x, avg_path, label=f"cluster {cid} (n={len(paths)})")
    ax.axhline(0.0, color="black", linewidth=0.8, alpha=0.6)
    ax.set_title("Cluster average normalized post-hit path")
    ax.set_xlabel("Minutes after hit (5m bars)")
    ax.set_ylabel("Return from hit close (%)")
    ax.grid(alpha=0.25)
    ax.legend(loc="best", fontsize=8)
    fig.tight_layout()
    fig.savefig(os.path.join(out_charts_dir, "cluster_avg_paths_combined.png"), dpi=150)
    plt.close(fig)

    return df, summary


def main() -> int:
    args = parse_args()
    db = os.path.abspath(args.db)
    if not os.path.isfile(db):
        print(f"ERROR: database not found: {db}", file=sys.stderr)
        return 1

    with open(args.weekly_events_json) as f:
        weekly_payload = json.load(f)
    with open(args.daily_events_json) as f:
        daily_payload = json.load(f)

    weekly_events = weekly_payload["events"] if isinstance(weekly_payload, dict) and "events" in weekly_payload else weekly_payload
    daily_events = daily_payload["events"] if isinstance(daily_payload, dict) and "events" in daily_payload else daily_payload
    if not isinstance(weekly_events, list) or not isinstance(daily_events, list):
        print("ERROR: events JSON must be list or object with 'events' array", file=sys.stderr)
        return 1

    symbol = args.symbol.upper()
    if isinstance(weekly_payload, dict) and weekly_payload.get("symbol"):
        symbol = str(weekly_payload["symbol"]).upper()
    session_id = args.session_id
    if not session_id and isinstance(weekly_payload, dict) and weekly_payload.get("session_id"):
        session_id = str(weekly_payload["session_id"])
    session_id = _pick_session(db, session_id, symbol)

    print(f"Loading 5m candles for session {session_id} {symbol}...", file=sys.stderr)
    candles_5m = load_5m_candles(db, session_id, symbol)
    if not candles_5m:
        print("ERROR: no 5m candles found", file=sys.stderr)
        return 1

    packs: list[EventPack] = []
    for e in weekly_events:
        pack = build_event_row(
            e,
            "weekly",
            candles_5m,
            direction_thr=args.direction_threshold_pct,
            bucket_thr=args.return_bucket_threshold_pct,
            breakout_thr=args.breakout_threshold_pct,
        )
        if pack:
            packs.append(pack)
    for e in daily_events:
        pack = build_event_row(
            e,
            "daily",
            candles_5m,
            direction_thr=args.direction_threshold_pct,
            bucket_thr=args.return_bucket_threshold_pct,
            breakout_thr=args.breakout_threshold_pct,
        )
        if pack:
            packs.append(pack)
    if not packs:
        print("ERROR: no usable events after feature build", file=sys.stderr)
        return 1

    rows = []
    path_map: dict[int, list[float]] = {}
    for idx, p in enumerate(packs):
        row = dict(p.row)
        row["event_id"] = idx
        rows.append(row)
        path_map[idx] = p.path_norm_pct
    df = pd.DataFrame(rows)

    out_dir = os.path.abspath(args.output_dir)
    charts_dir = os.path.join(out_dir, "charts")
    os.makedirs(charts_dir, exist_ok=True)

    # Clustering on combined view first, then supervised by view.
    df_clustered, cluster_summary = run_clustering(df, path_map, charts_dir)

    views = {
        "combined": df_clustered.copy(),
        "weekly_only": df_clustered[df_clustered["source"] == "weekly"].copy(),
        "daily_only": df_clustered[df_clustered["source"] == "daily"].copy(),
    }

    all_metrics: dict[str, Any] = {"all_path": {}, "predictive": {}}
    pred_frames = []
    for mode in ("all_path", "predictive"):
        for view_name, view_df in views.items():
            m, preds = run_supervised_view(view_df, view_name, charts_dir, feature_mode=mode)
            all_metrics[mode][view_name] = m
            if not preds.empty:
                pred_frames.append(preds)

    # Export tables.
    label_cols = ["event_id", "source", "session_day", "event_type", "label_direction", "label_breakout", "label_return_bucket"]
    feature_cols = [c for c in df_clustered.columns if c not in ("label_direction", "label_breakout", "label_return_bucket")]
    df_clustered[feature_cols].to_csv(os.path.join(out_dir, "features.csv"), index=False)
    df_clustered[label_cols].to_csv(os.path.join(out_dir, "labels.csv"), index=False)
    df_clustered.to_csv(os.path.join(out_dir, "features_with_labels.csv"), index=False)
    if pred_frames:
        pd.concat(pred_frames, ignore_index=True).to_csv(os.path.join(out_dir, "event_predictions.csv"), index=False)
    else:
        pd.DataFrame(columns=["feature_mode", "dataset", "event_id", "session_day", "event_type", "target", "y_true", "y_pred"]).to_csv(
            os.path.join(out_dir, "event_predictions.csv"), index=False
        )

    with open(os.path.join(out_dir, "model_metrics.json"), "w") as f:
        json.dump(all_metrics, f, indent=2)
    with open(os.path.join(out_dir, "cluster_summary.json"), "w") as f:
        json.dump(cluster_summary, f, indent=2)

    # Lightweight run summary for quick read.
    run_summary = {
        "session_id": session_id,
        "symbol": symbol,
        "n_events_combined": int(len(views["combined"])),
        "n_events_weekly": int(len(views["weekly_only"])),
        "n_events_daily": int(len(views["daily_only"])),
        "output_dir": out_dir,
    }
    with open(os.path.join(out_dir, "run_summary.json"), "w") as f:
        json.dump(run_summary, f, indent=2)

    print("\nML Study Completed")
    print("=" * 80)
    print(f"Events: combined={run_summary['n_events_combined']} weekly={run_summary['n_events_weekly']} daily={run_summary['n_events_daily']}")
    print(f"Output dir: {out_dir}")
    print("Wrote: features.csv, labels.csv, features_with_labels.csv, event_predictions.csv")
    print("Wrote: model_metrics.json, cluster_summary.json, run_summary.json")
    print("Wrote charts under: charts/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
