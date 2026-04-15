"""
BaseStudy — contract every lab study must satisfy.

A study observes the market and records events. It does NOT simulate trades
and does NOT take positions. Studies are for understanding market structure,
signal quality, regime classification, etc.

Agents creating new studies should:
  1. Subclass BaseStudy
  2. Implement run() → StudyResult
  3. Call self.save(out_dir, result) to persist outputs
  4. Define a clear events schema (columns of the events DataFrame)
"""
from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd


@dataclass
class StudyResult:
    """
    Standardized output of a study.

    name:        human-readable study name
    description: what was studied and what was found
    symbols:     assets covered
    timeframe:   primary timeframe, e.g. '4h', '1h'
    start_utc:   data window start
    end_utc:     data window end
    summary:     key findings as a flat dict of scalars (shown in app overview)
    events:      one row per observation (schema defined by the study)
    """
    name: str
    description: str
    symbols: list[str]
    timeframe: str
    start_utc: str
    end_utc: str
    summary: dict[str, Any]
    events: pd.DataFrame = field(default_factory=pd.DataFrame)


class BaseStudy(ABC):
    """
    All lab studies inherit from this class.

    Output contract — save() writes:
      out_dir/
        manifest.json   name, description, symbols, timeframe, date range, run_ts, summary
        events.csv      one row per observed event (schema defined by the study)
    """

    @abstractmethod
    def run(self) -> StudyResult:
        """Execute the study and return a StudyResult."""
        ...

    def save(self, out_dir: Path, result: StudyResult) -> Path:
        """
        Persist the study result to out_dir.

        Creates out_dir if it does not exist.
        Returns out_dir.
        """
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)

        manifest: dict[str, Any] = {
            "name": result.name,
            "description": result.description,
            "symbols": result.symbols,
            "timeframe": result.timeframe,
            "start_utc": result.start_utc,
            "end_utc": result.end_utc,
            "run_ts": datetime.now(timezone.utc).isoformat(),
            "n_events": len(result.events),
            "summary": result.summary,
        }
        with open(out_dir / "manifest.json", "w") as f:
            json.dump(manifest, f, indent=2, default=str)

        if len(result.events) > 0:
            result.events.to_csv(out_dir / "events.csv", index=False)

        return out_dir
