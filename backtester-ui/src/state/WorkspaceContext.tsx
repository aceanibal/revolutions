import { createContext, useContext } from "react";
import type { ReplayMode, StrategyId, TickPolicy, Timeframe } from "../types";

export interface WorkspaceState {
  selectedSessionId: string;
  selectedSymbol: string;
  timeframe: Timeframe;
  mode: ReplayMode;
  tickPolicy: TickPolicy;
  strategyId: StrategyId;
}

export interface WorkspaceActions {
  setSelectedSessionId: (value: string) => void;
  setSelectedSymbol: (value: string) => void;
  setTimeframe: (value: Timeframe) => void;
  setMode: (value: ReplayMode) => void;
  setTickPolicy: (value: TickPolicy) => void;
  setStrategyId: (value: StrategyId) => void;
}

export const WorkspaceContext = createContext<(WorkspaceState & WorkspaceActions) | null>(null);

export function useWorkspaceContext() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspaceContext must be used within WorkspaceContext.Provider");
  return value;
}
