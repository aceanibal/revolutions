"""
RunWriter — handles all file I/O for strategy runs.

Strategies never write files directly. They pass data to RunWriter
and it handles folder creation, CSV formatting, and JSON manifests.

Output layout:
    runs/run_<strategy_id>_<YYYYMMDD_HHMMSS>/
        run_config.json
        trades/
            trade_details_<strategy_id>_<tp_tag>.csv
        artifacts/
            <strategy_id>_<tp_tag>_results.csv          per-chunk summary
            <strategy_id>_<tp_tag>_results_by_asset.csv per-asset summary
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from lab.schemas.types import RunManifest, TradeRecord


def _tp_tag(tp_r: float) -> str:
    """'12.0' → 'tp12p0'"""
    return "tp" + f"{tp_r}".replace(".", "p")


class RunWriter:
    def __init__(self, runs_dir: Path):
        self.runs_dir = Path(runs_dir)

    def create_run_dir(self, strategy_id: str) -> tuple[Path, str]:
        """Create timestamped run folder. Returns (run_dir, run_id)."""
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        run_id = f"run_{strategy_id}_{ts}"
        run_dir = self.runs_dir / run_id
        (run_dir / "trades").mkdir(parents=True, exist_ok=True)
        (run_dir / "artifacts").mkdir(parents=True, exist_ok=True)
        return run_dir, run_id

    def write_manifest(self, run_dir: Path, manifest: RunManifest) -> None:
        """Write run_config.json."""
        with open(run_dir / "run_config.json", "w") as f:
            json.dump(manifest.to_dict(), f, indent=2, default=str)

    def write_trades(
        self,
        run_dir: Path,
        strategy_id: str,
        tp_r: float,
        trades: list[TradeRecord],
    ) -> Path:
        """Write trade CSV for one TP target. Returns path written."""
        tag = _tp_tag(tp_r)
        path = run_dir / "trades" / f"trade_details_{strategy_id}_{tag}.csv"
        if not trades:
            pd.DataFrame().to_csv(path, index=False)
            return path
        df = pd.DataFrame([t.to_row() for t in trades])
        df.to_csv(path, index=False)
        return path

    def write_chunk_results(
        self,
        run_dir: Path,
        strategy_id: str,
        tp_r: float,
        trades: list[TradeRecord],
    ) -> None:
        """
        Aggregate trades into monthly chunk and per-asset summaries.
        Writes two artifact CSVs.
        """
        if not trades:
            return
        tag = _tp_tag(tp_r)
        df = pd.DataFrame([t.to_row() for t in trades])
        df["chunk"] = (
            pd.to_datetime(df["exit_ts_utc"], utc=True)
            .dt.to_period("M")
            .astype(str)
        )

        chunk_rows = []
        for chunk, g in df.groupby("chunk"):
            chunk_rows.append({"chunk": chunk, **_agg(g)})
        pd.DataFrame(chunk_rows).to_csv(
            run_dir / "artifacts" / f"{strategy_id}_{tag}_results.csv", index=False
        )

        asset_rows = []
        for sym, g in df.groupby("symbol"):
            asset_rows.append({"symbol": sym, **_agg(g)})
        pd.DataFrame(asset_rows).to_csv(
            run_dir / "artifacts" / f"{strategy_id}_{tag}_results_by_asset.csv", index=False
        )


def _agg(g: pd.DataFrame) -> dict:
    pnls = g["managed_r"].values.astype(float)
    return {
        "n_trades": len(g),
        "total_r": round(float(pnls.sum()), 4),
        "win_pct": round(float((pnls > 0).mean() * 100), 2),
        "max_dd_r": round(float(_max_dd(pnls)), 4),
        "avg_hold_5m_bars": round(float(g["hold_5m_bars"].mean()), 1),
    }


def _max_dd(pnls: np.ndarray) -> float:
    if len(pnls) == 0:
        return 0.0
    c = np.cumsum(pnls)
    peak = np.maximum.accumulate(c)
    return float(np.max(peak - c))
