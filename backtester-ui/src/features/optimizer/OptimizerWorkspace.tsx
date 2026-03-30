import type { BacktestOptimizerSettings, OptimizationAssetRow, OptimizationScenarioResult, SessionType } from "../../types";

interface OptimizationLeaderboards {
  byScore: OptimizationScenarioResult[];
  byProfit: OptimizationScenarioResult[];
  byDrawdown: OptimizationScenarioResult[];
  balancedAlt: OptimizationScenarioResult[];
}

interface OptimizerWorkspaceProps {
  strategyId: string;
  optimizerSettings: BacktestOptimizerSettings;
  setOptimizerSettings: React.Dispatch<React.SetStateAction<BacktestOptimizerSettings>>;
  optimizerStepMode: "per_variable" | "consistent";
  setOptimizerStepMode: React.Dispatch<React.SetStateAction<"per_variable" | "consistent">>;
  optimizerConsistentSamples: number;
  setOptimizerConsistentSamples: React.Dispatch<React.SetStateAction<number>>;
  optimizerRrStart: number;
  setOptimizerRrStart: React.Dispatch<React.SetStateAction<number>>;
  optimizerRrEnd: number;
  setOptimizerRrEnd: React.Dispatch<React.SetStateAction<number>>;
  optimizerRrStep: number;
  setOptimizerRrStep: React.Dispatch<React.SetStateAction<number>>;
  optimizerVwapStartFrom: number;
  setOptimizerVwapStartFrom: React.Dispatch<React.SetStateAction<number>>;
  optimizerVwapStartTo: number;
  setOptimizerVwapStartTo: React.Dispatch<React.SetStateAction<number>>;
  optimizerVwapStartStepMinutes: number;
  setOptimizerVwapStartStepMinutes: React.Dispatch<React.SetStateAction<number>>;
  optimizerActiveStartFrom: number;
  setOptimizerActiveStartFrom: React.Dispatch<React.SetStateAction<number>>;
  optimizerActiveStartTo: number;
  setOptimizerActiveStartTo: React.Dispatch<React.SetStateAction<number>>;
  optimizerActiveStartStepMinutes: number;
  setOptimizerActiveStartStepMinutes: React.Dispatch<React.SetStateAction<number>>;
  optimizerActiveEndFrom: number;
  setOptimizerActiveEndFrom: React.Dispatch<React.SetStateAction<number>>;
  optimizerActiveEndTo: number;
  setOptimizerActiveEndTo: React.Dispatch<React.SetStateAction<number>>;
  optimizerActiveEndStepMinutes: number;
  setOptimizerActiveEndStepMinutes: React.Dispatch<React.SetStateAction<number>>;
  optimizerDojiBodyToRangeMaxFrom: number;
  setOptimizerDojiBodyToRangeMaxFrom: React.Dispatch<React.SetStateAction<number>>;
  optimizerDojiBodyToRangeMaxTo: number;
  setOptimizerDojiBodyToRangeMaxTo: React.Dispatch<React.SetStateAction<number>>;
  optimizerDojiBodyToRangeMaxStep: number;
  setOptimizerDojiBodyToRangeMaxStep: React.Dispatch<React.SetStateAction<number>>;
  optimizerMixSize: number;
  setOptimizerMixSize: React.Dispatch<React.SetStateAction<number>>;
  optimizerDrawdownWeight: number;
  setOptimizerDrawdownWeight: React.Dispatch<React.SetStateAction<number>>;
  optimizerLossWeight: number;
  setOptimizerLossWeight: React.Dispatch<React.SetStateAction<number>>;
  optimizerAssetSelection: string;
  setOptimizerAssetSelection: React.Dispatch<React.SetStateAction<string>>;
  optimizerSessionScope: "filtered" | "selected";
  setOptimizerSessionScope: React.Dispatch<React.SetStateAction<"filtered" | "selected">>;
  optimizerSessionTypeFilter: "all" | SessionType;
  setOptimizerSessionTypeFilter: React.Dispatch<React.SetStateAction<"all" | SessionType>>;
  optimizerTargetSessionCount: number;
  optimizeScenarios: () => void;
  optimizing: boolean;
  running: boolean;
  batchRunning: boolean;
  optimizationProgress: { done: number; total: number; current: string };
  bestOptimizationScenario: OptimizationScenarioResult | null;
  bestRrAssetMix: OptimizationAssetRow[];
  optimizationResults: OptimizationScenarioResult[];
  optimizationLeaderboards: OptimizationLeaderboards;
}

export function OptimizerWorkspace({
  strategyId,
  optimizerSettings,
  setOptimizerSettings,
  optimizerStepMode,
  setOptimizerStepMode,
  optimizerConsistentSamples,
  setOptimizerConsistentSamples,
  optimizerRrStart,
  setOptimizerRrStart,
  optimizerRrEnd,
  setOptimizerRrEnd,
  optimizerRrStep,
  setOptimizerRrStep,
  optimizerVwapStartFrom,
  setOptimizerVwapStartFrom,
  optimizerVwapStartTo,
  setOptimizerVwapStartTo,
  optimizerVwapStartStepMinutes,
  setOptimizerVwapStartStepMinutes,
  optimizerActiveStartFrom,
  setOptimizerActiveStartFrom,
  optimizerActiveStartTo,
  setOptimizerActiveStartTo,
  optimizerActiveStartStepMinutes,
  setOptimizerActiveStartStepMinutes,
  optimizerActiveEndFrom,
  setOptimizerActiveEndFrom,
  optimizerActiveEndTo,
  setOptimizerActiveEndTo,
  optimizerActiveEndStepMinutes,
  setOptimizerActiveEndStepMinutes,
  optimizerDojiBodyToRangeMaxFrom,
  setOptimizerDojiBodyToRangeMaxFrom,
  optimizerDojiBodyToRangeMaxTo,
  setOptimizerDojiBodyToRangeMaxTo,
  optimizerDojiBodyToRangeMaxStep,
  setOptimizerDojiBodyToRangeMaxStep,
  optimizerMixSize,
  setOptimizerMixSize,
  optimizerDrawdownWeight,
  setOptimizerDrawdownWeight,
  optimizerLossWeight,
  setOptimizerLossWeight,
  optimizerAssetSelection,
  setOptimizerAssetSelection,
  optimizerSessionScope,
  setOptimizerSessionScope,
  optimizerSessionTypeFilter,
  setOptimizerSessionTypeFilter,
  optimizerTargetSessionCount,
  optimizeScenarios,
  optimizing,
  running,
  batchRunning,
  optimizationProgress,
  bestOptimizationScenario,
  bestRrAssetMix,
  optimizationResults,
  optimizationLeaderboards
}: OptimizerWorkspaceProps) {
  const isOrbStrategy = strategyId === "orb-avwap-930" || strategyId === "orb-avwap-930-open-avwap-sl";
  const isOriginalOrbStrategy = strategyId === "orb-avwap-930";
  const isOpenOrAvwapStopStrategy = strategyId === "orb-avwap-930-open-avwap-sl";
  if (!isOrbStrategy) {
    return (
      <div className="card">
        <h3>Optimizer</h3>
        <div className="sub">
          Switch strategy to `orb-avwap-930` or `orb-avwap-930-open-avwap-sl` to enable optimizer workspaces.
        </div>
      </div>
    );
  }

  return (
    <>
      <section className="grid2">
        <div className="card">
          <h3>Strategy Optimizer</h3>
          <div className="optimizer-row">
            <label>
              Take Profit (R)
              <input
                type="number"
                min={0.1}
                max={20}
                step={0.1}
                value={optimizerSettings.takeProfitRR}
                onChange={(e) =>
                  setOptimizerSettings((prev) => ({
                    ...prev,
                    takeProfitRR: Math.max(0.1, Number(e.target.value || 2))
                  }))
                }
              />
            </label>
            <label>
              VWAP Start (HHMM)
              <input
                type="number"
                min={0}
                max={2359}
                step={1}
                value={optimizerSettings.vwapStartHHMM}
                onChange={(e) =>
                  setOptimizerSettings((prev) => ({
                    ...prev,
                    vwapStartHHMM: Math.max(0, Math.min(2359, Number(e.target.value || 930)))
                  }))
                }
              />
            </label>
            <label>
              Start (HHMM)
              <input
                type="number"
                min={0}
                max={2359}
                step={1}
                value={optimizerSettings.activeStartHHMM}
                onChange={(e) =>
                  setOptimizerSettings((prev) => ({
                    ...prev,
                    activeStartHHMM: Math.max(0, Math.min(2359, Number(e.target.value || 930)))
                  }))
                }
              />
            </label>
            <label>
              End (HHMM)
              <input
                type="number"
                min={0}
                max={2359}
                step={1}
                value={optimizerSettings.activeEndHHMM}
                onChange={(e) =>
                  setOptimizerSettings((prev) => ({
                    ...prev,
                    activeEndHHMM: Math.max(0, Math.min(2359, Number(e.target.value || 1600)))
                  }))
                }
              />
            </label>
            {isOriginalOrbStrategy && (
              <label>
                Doji body/range max
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={optimizerSettings.dojiBodyToRangeMax}
                  onChange={(e) =>
                    setOptimizerSettings((prev) => ({
                      ...prev,
                      dojiBodyToRangeMax: Math.max(0, Math.min(1, Number(e.target.value || 0.3)))
                    }))
                  }
                />
              </label>
            )}
            {isOpenOrAvwapStopStrategy && (
              <label>
                Stop Loss Source
                <select
                  value={optimizerSettings.stopLossSource}
                  onChange={(e) =>
                    setOptimizerSettings((prev) => ({
                      ...prev,
                      stopLossSource:
                        (e.target.value as BacktestOptimizerSettings["stopLossSource"]) || "open"
                    }))
                  }
                >
                  <option value="open">open</option>
                  <option value="avwap">avwap</option>
                  <option value="extreme">candle low (long) / high (short)</option>
                  <option value="low">candle low (long only)</option>
                  <option value="high">candle high (short only)</option>
                </select>
              </label>
            )}
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={optimizerSettings.ignoreWeekends}
                onChange={(e) =>
                  setOptimizerSettings((prev) => ({
                    ...prev,
                    ignoreWeekends: e.target.checked
                  }))
                }
              />
              Ignore weekends
            </label>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={optimizerSettings.ignoreUsHolidays}
                onChange={(e) =>
                  setOptimizerSettings((prev) => ({
                    ...prev,
                    ignoreUsHolidays: e.target.checked
                  }))
                }
              />
              Ignore US holidays
            </label>
            <span className="sub">
              Current run: {Number(optimizerSettings.takeProfitRR).toFixed(1)}R · VWAP{" "}
              {optimizerSettings.vwapStartHHMM} · active {optimizerSettings.activeStartHHMM}-
              {optimizerSettings.activeEndHHMM} ET · weekends{" "}
              {optimizerSettings.ignoreWeekends ? "off" : "on"} · holidays{" "}
              {optimizerSettings.ignoreUsHolidays ? "off" : "on"}
              {isOpenOrAvwapStopStrategy ? ` · stop ${optimizerSettings.stopLossSource}` : ""}
              {isOriginalOrbStrategy
                ? ` · doji=${Number(optimizerSettings.dojiBodyToRangeMax ?? 0.3).toFixed(2)}`
                : ""}
            </span>
          </div>
        </div>
        <div className="card">
          <h3>Optimize</h3>
          <div className="filter-row" style={{ borderBottom: "none", padding: "0", marginBottom: 6 }}>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Step mode
              <select
                value={optimizerStepMode}
                onChange={(e) => setOptimizerStepMode(e.target.value as "per_variable" | "consistent")}
              >
                <option value="per_variable">per-variable steps</option>
                <option value="consistent">consistent samples</option>
              </select>
            </label>
            {optimizerStepMode === "consistent" && (
              <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Samples per variable
                <input
                  type="number"
                  min={2}
                  step={1}
                  value={optimizerConsistentSamples}
                  onChange={(e) => setOptimizerConsistentSamples(Math.max(2, Number(e.target.value || 3)))}
                  style={{ width: 70 }}
                />
              </label>
            )}
          </div>
          <div className="filter-row" style={{ borderBottom: "none", padding: "0", marginBottom: 6 }}>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              RR start
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={optimizerRrStart}
                onChange={(e) => setOptimizerRrStart(Math.max(0.1, Number(e.target.value || 1)))}
                style={{ width: 70 }}
              />
            </label>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              RR end
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={optimizerRrEnd}
                onChange={(e) => setOptimizerRrEnd(Math.max(0.1, Number(e.target.value || 3)))}
                style={{ width: 70 }}
              />
            </label>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              RR step
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={optimizerRrStep}
                onChange={(e) => setOptimizerRrStep(Math.max(0.1, Number(e.target.value || 0.5)))}
                style={{ width: 70 }}
                disabled={optimizerStepMode === "consistent"}
              />
            </label>
          </div>
          <div className="filter-row" style={{ borderBottom: "none", padding: "0", marginBottom: 6 }}>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              VWAP from
              <input
                type="number"
                min={0}
                max={2359}
                step={1}
                value={optimizerVwapStartFrom}
                onChange={(e) => setOptimizerVwapStartFrom(Math.max(0, Math.min(2359, Number(e.target.value || 930))))}
                style={{ width: 80 }}
              />
            </label>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              VWAP to
              <input
                type="number"
                min={0}
                max={2359}
                step={1}
                value={optimizerVwapStartTo}
                onChange={(e) => setOptimizerVwapStartTo(Math.max(0, Math.min(2359, Number(e.target.value || 930))))}
                style={{ width: 80 }}
              />
            </label>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              VWAP step (min)
              <input
                type="number"
                min={1}
                step={1}
                value={optimizerVwapStartStepMinutes}
                onChange={(e) => setOptimizerVwapStartStepMinutes(Math.max(1, Number(e.target.value || 15)))}
                style={{ width: 80 }}
                disabled={optimizerStepMode === "consistent"}
              />
            </label>
          </div>
          <div className="filter-row" style={{ borderBottom: "none", padding: "0", marginBottom: 6 }}>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Start from
              <input
                type="number"
                min={0}
                max={2359}
                step={1}
                value={optimizerActiveStartFrom}
                onChange={(e) => setOptimizerActiveStartFrom(Math.max(0, Math.min(2359, Number(e.target.value || 930))))}
                style={{ width: 80 }}
              />
            </label>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Start to
              <input
                type="number"
                min={0}
                max={2359}
                step={1}
                value={optimizerActiveStartTo}
                onChange={(e) => setOptimizerActiveStartTo(Math.max(0, Math.min(2359, Number(e.target.value || 1000))))}
                style={{ width: 80 }}
              />
            </label>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Start step (min)
              <input
                type="number"
                min={1}
                step={1}
                value={optimizerActiveStartStepMinutes}
                onChange={(e) => setOptimizerActiveStartStepMinutes(Math.max(1, Number(e.target.value || 15)))}
                style={{ width: 80 }}
                disabled={optimizerStepMode === "consistent"}
              />
            </label>
          </div>
          <div className="filter-row" style={{ borderBottom: "none", padding: "0", marginBottom: 6 }}>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              End from
              <input
                type="number"
                min={0}
                max={2359}
                step={1}
                value={optimizerActiveEndFrom}
                onChange={(e) => setOptimizerActiveEndFrom(Math.max(0, Math.min(2359, Number(e.target.value || 1500))))}
                style={{ width: 80 }}
              />
            </label>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              End to
              <input
                type="number"
                min={0}
                max={2359}
                step={1}
                value={optimizerActiveEndTo}
                onChange={(e) => setOptimizerActiveEndTo(Math.max(0, Math.min(2359, Number(e.target.value || 1600))))}
                style={{ width: 80 }}
              />
            </label>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              End step (min)
              <input
                type="number"
                min={1}
                step={1}
                value={optimizerActiveEndStepMinutes}
                onChange={(e) => setOptimizerActiveEndStepMinutes(Math.max(1, Number(e.target.value || 15)))}
                style={{ width: 80 }}
                disabled={optimizerStepMode === "consistent"}
              />
            </label>
          </div>
          {isOriginalOrbStrategy && (
            <>
              <div className="filter-row" style={{ borderBottom: "none", padding: "0", marginBottom: 6 }}>
                <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Doji from
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={optimizerDojiBodyToRangeMaxFrom}
                    onChange={(e) => setOptimizerDojiBodyToRangeMaxFrom(Math.max(0, Math.min(1, Number(e.target.value || 0.05))))}
                    style={{ width: 80 }}
                  />
                </label>
                <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Doji to
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={optimizerDojiBodyToRangeMaxTo}
                    onChange={(e) => setOptimizerDojiBodyToRangeMaxTo(Math.max(0, Math.min(1, Number(e.target.value || 0.2))))}
                    style={{ width: 80 }}
                  />
                </label>
                <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Doji step
                  <input
                    type="number"
                    min={0.0001}
                    step={0.01}
                    value={optimizerDojiBodyToRangeMaxStep}
                    onChange={(e) => setOptimizerDojiBodyToRangeMaxStep(Math.max(0.0001, Number(e.target.value || 0.05)))}
                    style={{ width: 80 }}
                    disabled={optimizerStepMode === "consistent"}
                  />
                </label>
              </div>
            </>
          )}
          <div className="filter-row" style={{ borderBottom: "none", padding: "0", marginBottom: 6 }}>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Mix size
              <input
                type="number"
                min={1}
                step={1}
                value={optimizerMixSize}
                onChange={(e) => setOptimizerMixSize(Math.max(1, Number(e.target.value || 3)))}
                style={{ width: 70 }}
              />
            </label>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Drawdown weight
              <input
                type="number"
                min={0}
                step={0.1}
                value={optimizerDrawdownWeight}
                onChange={(e) => setOptimizerDrawdownWeight(Math.max(0, Number(e.target.value || 1)))}
                style={{ width: 70 }}
              />
            </label>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Loss weight
              <input
                type="number"
                min={0}
                step={0.1}
                value={optimizerLossWeight}
                onChange={(e) => setOptimizerLossWeight(Math.max(0, Number(e.target.value || 1)))}
                style={{ width: 70 }}
              />
            </label>
          </div>
          <div className="filter-row" style={{ borderBottom: "none", padding: "0", marginBottom: 6 }}>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Session scope
              <select
                value={optimizerSessionScope}
                onChange={(e) => setOptimizerSessionScope(e.target.value as "filtered" | "selected")}
              >
                <option value="filtered">All filtered sessions</option>
                <option value="selected">Selected session only</option>
              </select>
            </label>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Session type
              <select
                value={optimizerSessionTypeFilter}
                onChange={(e) => setOptimizerSessionTypeFilter((e.target.value as "all" | SessionType) || "all")}
              >
                <option value="all">All types</option>
                <option value="live">Live only</option>
                <option value="historical">Historical only</option>
              </select>
            </label>
            <span className="sub">Target sessions: {optimizerTargetSessionCount}</span>
          </div>
          <div className="filter-row" style={{ borderBottom: "none", padding: "0", marginBottom: 6 }}>
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6, width: "100%" }}>
              Assets (optional, comma-separated)
              <input
                type="text"
                placeholder="All assets, or e.g. XRP,BTC,ETH"
                value={optimizerAssetSelection}
                onChange={(e) => setOptimizerAssetSelection(e.target.value)}
                style={{ width: "100%" }}
              />
            </label>
          </div>
          <button type="button" disabled={optimizing || running || batchRunning} onClick={optimizeScenarios}>
            {optimizing ? "Optimizing..." : "Run Optimize"}
          </button>
          <div className="sub" style={{ marginTop: 6 }}>
            Progress: {optimizationProgress.done}/{optimizationProgress.total}{" "}
            {optimizationProgress.current ? `· ${optimizationProgress.current}` : ""}
          </div>
          {bestOptimizationScenario ? (
            <>
              <div className="sub" style={{ marginTop: 6 }}>
                Best RR (all assets): {bestOptimizationScenario.rr.toFixed(2)} · Score:{" "}
                {bestOptimizationScenario.score.toFixed(3)}
              </div>
              <div className="sub">Best VWAP start (ET HHMM): {bestOptimizationScenario.anchorHHMM}</div>
              <div className="sub">
                Best active window (ET): {bestOptimizationScenario.activeStartHHMM}-
                {bestOptimizationScenario.activeEndHHMM}
              </div>
              <div className="sub">
                Doji body/range max: {Number(bestOptimizationScenario.dojiBodyToRangeMax ?? 0.3).toFixed(3)}
              </div>
              <div className="sub">
                Scenario rating: {bestOptimizationScenario.rating.toFixed(1)}/100 · Profit rank:{" "}
                {bestOptimizationScenario.profitRankScore.toFixed(1)} · Drawdown rank:{" "}
                {bestOptimizationScenario.drawdownRankScore.toFixed(1)}
              </div>
              <div className="sub">
                All-asset runs: {bestOptimizationScenario.runCount} · Total R:{" "}
                {bestOptimizationScenario.totalR.toFixed(3)}R
              </div>
              <div className="sub">
                Win rate: {(bestOptimizationScenario.winRate * 100).toFixed(2)}% ·{" "}
                Avg R/run: {bestOptimizationScenario.avgRPerRun.toFixed(3)}R · Avg DD:{" "}
                {bestOptimizationScenario.avgDrawdown.toFixed(4)} · Neg run rate:{" "}
                {(bestOptimizationScenario.negativeRunRate * 100).toFixed(2)}%
              </div>
              <div className="sub">
                Best RR asset mix ({bestRrAssetMix.length}): {bestRrAssetMix.map((row) => row.symbol).join(", ") || "--"}
              </div>
            </>
          ) : (
            <div className="sub" style={{ marginTop: 6 }}>
              Run optimization to find best RR first, then best asset mix for that RR.
            </div>
          )}
        </div>
      </section>

      <section className="grid2">
        <div className="card table-card">
          <h3>Optimize Scenarios</h3>
          {optimizationResults.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>RR</th>
                  <th>VWAP Start (ET HHMM)</th>
                  <th>Start (ET HHMM)</th>
                  <th>End (ET HHMM)</th>
                  <th>Doji max</th>
                  <th>Runs (All Assets)</th>
                  <th>Win Rate</th>
                  <th>Total R</th>
                  <th>Avg R/Run</th>
                  <th>Avg DD</th>
                  <th>Neg Run %</th>
                  <th>Rating</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {optimizationResults
                  .slice()
                  .sort((a, b) => b.score - a.score)
                  .map((row) => (
                    <tr
                      key={`opt-${row.rr}-${row.anchorHHMM}-${row.activeStartHHMM}-${row.activeEndHHMM}-${Number(row.dojiBodyToRangeMax ?? 0.3)}`}
                    >
                      <td>{row.rr.toFixed(2)}</td>
                      <td>{row.anchorHHMM}</td>
                      <td>{row.activeStartHHMM}</td>
                      <td>{row.activeEndHHMM}</td>
                      <td>{Number(row.dojiBodyToRangeMax ?? 0.3).toFixed(3)}</td>
                      <td>{row.runCount}</td>
                      <td>{(row.winRate * 100).toFixed(2)}%</td>
                      <td>{row.totalR.toFixed(3)}R</td>
                      <td>{row.avgRPerRun.toFixed(3)}R</td>
                      <td>{row.avgDrawdown.toFixed(4)}</td>
                      <td>{(row.negativeRunRate * 100).toFixed(2)}%</td>
                      <td>{row.rating.toFixed(1)}</td>
                      <td>{row.score.toFixed(3)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <div className="sub">No optimize runs yet.</div>
          )}
        </div>
        <div className="card">
          <h3>Optimize Leaderboards</h3>
          <div className="sub">
            Top by balanced score:{" "}
            {optimizationLeaderboards.byScore
              .map(
                (x) =>
                  `${x.rr.toFixed(2)}@v${x.anchorHHMM}/a${x.activeStartHHMM}-${x.activeEndHHMM}/d${Number(
                    x.dojiBodyToRangeMax ?? 0.3
                  ).toFixed(2)}`
              )
              .join(", ") || "--"}
          </div>
          <div className="sub">
            Top by profit (Total R):{" "}
            {optimizationLeaderboards.byProfit
              .map(
                (x) =>
                  `${x.rr.toFixed(2)}@v${x.anchorHHMM}/a${x.activeStartHHMM}-${x.activeEndHHMM}/d${Number(
                    x.dojiBodyToRangeMax ?? 0.3
                  ).toFixed(2)}`
              )
              .join(", ") || "--"}
          </div>
          <div className="sub">
            Top by lowest drawdown:{" "}
            {optimizationLeaderboards.byDrawdown
              .map(
                (x) =>
                  `${x.rr.toFixed(2)}@v${x.anchorHHMM}/a${x.activeStartHHMM}-${x.activeEndHHMM}/d${Number(
                    x.dojiBodyToRangeMax ?? 0.3
                  ).toFixed(2)}`
              )
              .join(", ") || "--"}
          </div>
          <div className="sub">
            Balanced positive alternatives:{" "}
            {optimizationLeaderboards.balancedAlt
              .map(
                (x) =>
                  `${x.rr.toFixed(2)}@v${x.anchorHHMM}/a${x.activeStartHHMM}-${x.activeEndHHMM}/d${Number(
                    x.dojiBodyToRangeMax ?? 0.3
                  ).toFixed(2)}`
              )
              .join(", ") || "--"}
          </div>
          <div className="sub">
            Variables optimized: `rr`, `anchorHHMM`, `activeStartHHMM`, `activeEndHHMM`, `dojiBodyToRangeMax`
            (per-variable steps or consistent samples).
          </div>
        </div>
      </section>
    </>
  );
}
