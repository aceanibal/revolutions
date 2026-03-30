import type { ReplayMode, SavedSession, StrategyId, TickPolicy, Timeframe } from "../../types";
import { formatDateTime } from "../../lib/backtestMath";

interface RunControlsBarProps {
  selectedSession: SavedSession | null;
  symbols: string[];
  selectedSymbol: string;
  timeframe: Timeframe;
  mode: ReplayMode;
  tickPolicy: TickPolicy;
  strategyId: StrategyId;
  running: boolean;
  batchRunning: boolean;
  onSelectSymbol: (symbol: string) => void;
  onSetTimeframe: (value: Timeframe) => void;
  onSetMode: (value: ReplayMode) => void;
  onSetTickPolicy: (value: TickPolicy) => void;
  onSetStrategyId: (value: StrategyId) => void;
  onRun: () => void;
  onRunBatch: () => void;
  onStepReplay: () => void;
}

export function RunControlsBar({
  selectedSession,
  symbols,
  selectedSymbol,
  timeframe,
  mode,
  tickPolicy,
  strategyId,
  running,
  batchRunning,
  onSelectSymbol,
  onSetTimeframe,
  onSetMode,
  onSetTickPolicy,
  onSetStrategyId,
  onRun,
  onRunBatch,
  onStepReplay
}: RunControlsBarProps) {
  return (
    <div className="toolbar">
      <span className="pill">{selectedSession?.id || "No session selected"}</span>
      <span className="pill">Start {selectedSession ? formatDateTime(selectedSession.startedAtMs) : "--"}</span>
      <label>
        Symbol
        <select value={selectedSymbol} onChange={(e) => onSelectSymbol(e.target.value)}>
          {symbols.map((symbol) => (
            <option key={symbol} value={symbol}>
              {symbol}
            </option>
          ))}
        </select>
      </label>
      <label>
        Timeframe
        <select value={timeframe} onChange={(e) => onSetTimeframe(e.target.value as Timeframe)}>
          <option value="1m">1m</option>
          <option value="5m">5m</option>
        </select>
      </label>
      <label>
        Replay
        <select value={mode} onChange={(e) => onSetMode(e.target.value as ReplayMode)}>
          <option value="mixed">mixed</option>
          <option value="candle">candle</option>
          <option value="tick">tick</option>
        </select>
      </label>
      <label>
        Tick policy
        <select value={tickPolicy} onChange={(e) => onSetTickPolicy(e.target.value as TickPolicy)}>
          <option value="real_only">real_only</option>
          <option value="real_then_synthetic">real_then_synthetic</option>
          <option value="synthetic_only">synthetic_only</option>
        </select>
      </label>
      <label>
        Strategy
        <select value={strategyId} onChange={(e) => onSetStrategyId(e.target.value as StrategyId)}>
          <option value="noop">noop</option>
          <option value="simple-momentum">simple-momentum</option>
          <option value="orb-avwap-930">orb-avwap-930</option>
          <option value="orb-avwap-930-open-avwap-sl">orb-avwap-930-open-avwap-sl</option>
        </select>
      </label>
      <button onClick={onRun} disabled={running || !selectedSymbol} type="button">
        {running ? "Running..." : "Run Backtest"}
      </button>
      <button onClick={onRunBatch} disabled={running || batchRunning} type="button">
        {batchRunning ? "Batch Running..." : "Run Batch (Filtered Days + Assets)"}
      </button>
      {mode === "mixed" && (
        <button onClick={onStepReplay} type="button">
          Step Replay
        </button>
      )}
    </div>
  );
}
