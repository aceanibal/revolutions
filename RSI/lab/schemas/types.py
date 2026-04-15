"""
Standard data types for the lab.

TradeRecord  — one closed trade (all strategies produce these)
RunManifest  — written as run_config.json; describes a strategy run
StudyManifest — written as manifest.json; describes a study run

These types are the contract between strategy code and the Streamlit app.
The app reads TradeRecord CSV rows and RunManifest JSON — nothing else.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class TradeRecord:
    """
    One closed trade.

    Core fields are required. Signal metadata (rsi thresholds, entry index, etc.)
    lives in signal_meta and gets flattened into the CSV row.

    baseline_r: fixed SL/TP result, no active management
    managed_r:  result with whatever exit logic the strategy uses
    managed_reason: 'SL' | 'TP' | 'BE' | 'TIMEOUT'
    """
    symbol: str
    strategy_id: str
    tp_r: float
    entry_ts_utc: str
    exit_ts_utc: str
    side: int                 # +1 long, -1 short
    entry_price: float
    stop_init: float
    risk: float               # absolute price distance entry → stop
    tp_price: float
    fee_bps: float
    baseline_r: float
    managed_r: float
    managed_reason: str
    hold_5m_bars: int
    stages: list[tuple[float, float]] = field(default_factory=list)
    signal_meta: dict[str, Any] = field(default_factory=dict)

    def to_row(self) -> dict[str, Any]:
        """Flat dict for a CSV row. MFE stages and signal_meta are inlined."""
        row: dict[str, Any] = {
            "symbol": self.symbol,
            "strategy_id": self.strategy_id,
            "tp_r": self.tp_r,
            "entry_ts_utc": self.entry_ts_utc,
            "exit_ts_utc": self.exit_ts_utc,
            "side": self.side,
            "entry_price": self.entry_price,
            "stop_init": self.stop_init,
            "risk": self.risk,
            "tp_price": self.tp_price,
            "fee_bps": self.fee_bps,
            "baseline_r": self.baseline_r,
            "managed_r": self.managed_r,
            "managed_reason": self.managed_reason,
            "hold_5m_bars": self.hold_5m_bars,
        }
        for i, (mfe_r, lock_r) in enumerate(self.stages, start=1):
            row[f"mfe{i}"] = mfe_r
            row[f"lock{i}"] = lock_r
        for k, v in self.signal_meta.items():
            row[k] = v
        return row


@dataclass
class RunManifest:
    """
    Written as run_config.json in the run folder.
    Read by the Streamlit app to display run metadata.
    """
    run_id: str
    strategy_id: str
    strategy_version: str
    db_path: str
    symbols: list[str]
    start_utc: str
    end_utc: str
    fee_bps: float
    params: dict[str, Any]
    created_at: str
    tp_sweep: list[float] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class StudyManifest:
    """Written as manifest.json in the study output folder."""
    study_id: str
    name: str
    description: str
    symbols: list[str]
    timeframe: str
    start_utc: str
    end_utc: str
    created_at: str
    summary: dict[str, Any]
    n_events: int
