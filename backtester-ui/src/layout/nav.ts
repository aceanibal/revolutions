export type NavSection =
  | "overview"
  | "sessions"
  | "scanner"
  | "runs-batch"
  | "runs-optimizer"
  | "trades"
  | "data"
  | "about";

export const NAV_SECTIONS: Array<{ id: NavSection; label: string; hint: string }> = [
  { id: "overview", label: "Overview", hint: "Summary workspace" },
  { id: "sessions", label: "Sessions", hint: "Select + run + inspect" },
  { id: "scanner", label: "Scanner", hint: "Compute per-asset indicators" },
  { id: "runs-batch", label: "Batch Runs", hint: "Run all targets" },
  { id: "runs-optimizer", label: "Optimizer", hint: "Parameter sweep" },
  { id: "trades", label: "Trades", hint: "Drill down trades" },
  { id: "data", label: "Data", hint: "Import and provenance" },
  { id: "about", label: "About", hint: "How the simulator works" }
];
