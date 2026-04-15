import type { RunConfig, RunUploadData, TradeRow } from "../types";

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((cell) => cell.trim());
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/** Keep in sync with server `parseTradeCsv` in `server/index.cjs` (numeric columns). */
function parseTradeCsv(content: string): TradeRow[] {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const rows: TradeRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const row: Record<string, string | number> = {};
    headers.forEach((h, idx) => {
      const raw = cols[idx] ?? "";
      const lower = h.toLowerCase();
      if (
        lower.includes("price") ||
        lower.includes("risk") ||
        lower.includes("mfe") ||
        lower.includes("lock") ||
        lower.includes("tp_r") ||
        lower.includes("side") ||
        lower.includes("bars") ||
        lower === "baseline_r" ||
        lower === "managed_r" ||
        lower === "stop_init" ||
        lower === "sl_n" ||
        lower === "fee_bps"
      ) {
        row[h] = toNumber(raw);
      } else {
        row[h] = raw;
      }
    });

    if (!row.symbol || !row.entry_ts_utc || !row.exit_ts_utc) continue;
    rows.push(row as unknown as TradeRow);
  }
  return rows;
}

function extractRunFolderName(relativePath: string): string {
  const cleaned = relativePath.replaceAll("\\", "/");
  const root = cleaned.split("/")[0];
  return root || "run";
}

export async function loadRunFromFolderFiles(fileList: FileList): Promise<RunUploadData> {
  const files = Array.from(fileList);
  if (files.length === 0) {
    throw new Error("No files selected.");
  }

  const runConfigFile = files.find((f) => f.webkitRelativePath.endsWith("/run_config.json"));
  if (!runConfigFile) {
    throw new Error("Missing run_config.json in selected folder.");
  }

  const runFolderName = extractRunFolderName(runConfigFile.webkitRelativePath || runConfigFile.name);
  const configText = await runConfigFile.text();
  const runConfig = JSON.parse(configText) as RunConfig;

  /** Same basename pattern as API: `trade_details_v1_tp1p0.csv` or `trade_details_v1fix_tp1p0.csv` (not *_all_tp). */
  const tradeCsvFiles = files.filter((f) =>
    /\/trades\/trade_details_(v1fix|v1)_(tp[0-9p]+)\.csv$/i.test(f.webkitRelativePath)
  );
  if (tradeCsvFiles.length === 0) {
    throw new Error(
      "No TP trade files found under trades/. Expected trades/trade_details_v1_tp*.csv or trades/trade_details_v1fix_tp*.csv"
    );
  }

  const tpTrades: Record<string, TradeRow[]> = {};
  const tradeFiles: string[] = [];
  for (const file of tradeCsvFiles) {
    const match = file.webkitRelativePath.match(/trade_details_(v1fix|v1)_(tp[0-9p]+)\.csv$/i);
    if (!match) continue;
    const tpTag = match[2].toLowerCase();
    const rows = parseTradeCsv(await file.text());
    tpTrades[tpTag] = rows;
    tradeFiles.push(file.webkitRelativePath);
  }

  if (Object.keys(tpTrades).length === 0) {
    throw new Error("Trade files exist but could not parse TP tags.");
  }

  return {
    runConfig,
    tpTrades,
    tradeFiles,
    runFolderName
  };
}
