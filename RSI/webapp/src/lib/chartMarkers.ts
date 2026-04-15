import type { Time } from "lightweight-charts";
import type { ChartMarker } from "../types";

/** lightweight-charts requires markers strictly ascending by time; merge same-second markers. */
export function normalizeMarkers(markers: ChartMarker[]) {
  const rows = markers
    .filter((m) => Number.isFinite(m.timeSec))
    .map((m) => ({
      time: m.timeSec as Time,
      position: m.position,
      color: m.color,
      shape: m.shape,
      text: m.text ?? ""
    }))
    .sort((a, b) => (a.time as number) - (b.time as number));

  const merged: typeof rows = [];
  for (const m of rows) {
    const prev = merged[merged.length - 1];
    if (prev && prev.time === m.time) {
      prev.text = [prev.text, m.text].filter(Boolean).join(" · ");
      continue;
    }
    merged.push({ ...m });
  }
  return merged;
}
