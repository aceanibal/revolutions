"""
BaseStrategy — contract every lab strategy must satisfy.

Agents creating new strategies should:
  1. Subclass BaseStrategy
  2. Set STRATEGY_ID and VERSION class attributes
  3. Implement run() — load data, generate signals, replay, write outputs
  4. Use RunWriter for all file I/O (never write files directly)
  5. Follow all rules in sim/rules.py
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class StrategyConfig:
    """
    Common configuration shared by all strategies.

    strategy-specific parameters live in a separate params dataclass
    defined by each strategy (see strategies/rsi_4h/strategy.py for example).
    """
    db_path: str                        # path to the SQLite candle DB
    symbols: list[str]                  # assets to run on
    start_utc: str                      # ISO date string, e.g. "2022-01-01"
    end_utc: str | None = None          # None = use all available data
    fee_bps: float = 3.0               # round-trip fee in basis points (Rule 5)


class BaseStrategy(ABC):
    """
    All lab strategies inherit from this class.

    Guarantees:
    - A unique STRATEGY_ID string (slug, lowercase, underscores)
    - A VERSION string (semver-style)
    - A run() method that writes to a runs/ folder and returns its path
    - All outputs are written via RunWriter (standard schema)
    """

    STRATEGY_ID: str = "base"   # override in subclass
    VERSION: str = "0.0"        # override in subclass

    def __init__(self, config: StrategyConfig):
        self.config = config

    @abstractmethod
    def run(self, runs_dir: Path) -> Path:
        """
        Execute the strategy across all configured symbols.

        Must:
          - Use RunWriter to create the run folder and write all outputs
          - Write a run_config.json (RunManifest)
          - Write trade CSVs (TradeRecord rows)
          - Write per-chunk and per-asset artifact CSVs
          - Return the path to the created run folder

        Must not:
          - Write files outside the run folder
          - Read candle data for future bars (Rule 1)
          - Deviate from sim/rules.py without explicit documentation
        """
        ...

    def describe(self) -> dict[str, Any]:
        """Return a human-readable summary of this strategy's config."""
        return {
            "strategy_id": self.STRATEGY_ID,
            "version": self.VERSION,
            "symbols": self.config.symbols,
            "start_utc": self.config.start_utc,
            "end_utc": self.config.end_utc,
            "fee_bps": self.config.fee_bps,
        }
