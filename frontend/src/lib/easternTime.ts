const EASTERN_TIME_ZONE = "America/New_York";

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts = dtf.formatToParts(date);
  const partMap = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(partMap.get("year") || 0);
  const month = Number(partMap.get("month") || 1);
  const day = Number(partMap.get("day") || 1);
  const hour = Number(partMap.get("hour") || 0);
  const minute = Number(partMap.get("minute") || 0);
  const second = Number(partMap.get("second") || 0);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return asUtc - date.getTime();
}

function parseHHMM(value: string): { hour: number; minute: number } | null {
  const trimmed = String(value || "").trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function getTodayEasternTimeAnchorSec(anchorTimeHHMM: string): number {
  const parsed = parseHHMM(anchorTimeHHMM);
  if (!parsed) return 0;

  const now = new Date();
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const partMap = new Map(dateParts.map((part) => [part.type, part.value]));
  const year = Number(partMap.get("year") || 0);
  const month = Number(partMap.get("month") || 1);
  const day = Number(partMap.get("day") || 1);

  const baseUtc = Date.UTC(year, month - 1, day, parsed.hour, parsed.minute, 0);
  let ts = baseUtc;
  for (let i = 0; i < 3; i += 1) {
    const offset = getTimeZoneOffsetMs(new Date(ts), EASTERN_TIME_ZONE);
    ts = baseUtc - offset;
  }
  return Math.floor(ts / 1000);
}
