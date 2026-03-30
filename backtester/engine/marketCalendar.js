const { DateTime } = require("luxon");

const ET_ZONE = "America/New_York";

function getEtDateParts(dayKey) {
  const dt = DateTime.fromISO(String(dayKey || ""), { zone: ET_ZONE });
  if (!dt.isValid) return null;
  return { year: dt.year, month: dt.month, day: dt.day, weekday: dt.weekday };
}

function toDayKey(year, month, day) {
  return DateTime.fromObject({ year, month, day }, { zone: ET_ZONE }).toISODate();
}

function observedDayKey(year, month, day) {
  const dt = DateTime.fromObject({ year, month, day }, { zone: ET_ZONE });
  if (!dt.isValid) return null;
  if (dt.weekday === 6) return dt.minus({ days: 1 }).toISODate(); // Saturday -> Friday
  if (dt.weekday === 7) return dt.plus({ days: 1 }).toISODate(); // Sunday -> Monday
  return dt.toISODate();
}

function nthWeekdayOfMonth(year, month, weekday, n) {
  let dt = DateTime.fromObject({ year, month, day: 1 }, { zone: ET_ZONE });
  while (dt.weekday !== weekday) dt = dt.plus({ days: 1 });
  dt = dt.plus({ days: (n - 1) * 7 });
  return dt.toISODate();
}

function lastWeekdayOfMonth(year, month, weekday) {
  let dt = DateTime.fromObject({ year, month, day: dtDaysInMonth(year, month) }, { zone: ET_ZONE });
  while (dt.weekday !== weekday) dt = dt.minus({ days: 1 });
  return dt.toISODate();
}

function dtDaysInMonth(year, month) {
  return DateTime.fromObject({ year, month, day: 1 }, { zone: ET_ZONE }).daysInMonth;
}

function easterSunday(year) {
  // Anonymous Gregorian algorithm.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return DateTime.fromObject({ year, month, day }, { zone: ET_ZONE });
}

function buildHolidaySetsForYear(year) {
  const closed = new Set();
  const earlyClose = new Set();

  // Full-day market holidays (NYSE observed).
  closed.add(observedDayKey(year, 1, 1)); // New Year's Day
  closed.add(nthWeekdayOfMonth(year, 1, 1, 3)); // MLK Day (3rd Monday Jan)
  closed.add(nthWeekdayOfMonth(year, 2, 1, 3)); // Presidents Day (3rd Monday Feb)
  closed.add(easterSunday(year).minus({ days: 2 }).toISODate()); // Good Friday
  closed.add(lastWeekdayOfMonth(year, 5, 1)); // Memorial Day (last Monday May)
  if (year >= 2022) closed.add(observedDayKey(year, 6, 19)); // Juneteenth (observed, from 2022)
  closed.add(observedDayKey(year, 7, 4)); // Independence Day
  closed.add(nthWeekdayOfMonth(year, 9, 1, 1)); // Labor Day
  closed.add(nthWeekdayOfMonth(year, 11, 4, 4)); // Thanksgiving (4th Thursday Nov)
  closed.add(observedDayKey(year, 12, 25)); // Christmas Day

  // Early closes to exclude when ignoreUsHolidays is true.
  const july4 = DateTime.fromObject({ year, month: 7, day: 4 }, { zone: ET_ZONE });
  if (july4.weekday >= 2 && july4.weekday <= 5) {
    // Tue-Fri: prior weekday is usually early close (if not holiday/weekend).
    let prior = july4.minus({ days: 1 });
    while (prior.weekday >= 6) prior = prior.minus({ days: 1 });
    const priorKey = prior.toISODate();
    if (!closed.has(priorKey)) earlyClose.add(priorKey);
  }

  const thanksgiving = DateTime.fromISO(nthWeekdayOfMonth(year, 11, 4, 4), { zone: ET_ZONE });
  const blackFriday = thanksgiving.plus({ days: 1 }).toISODate();
  if (!closed.has(blackFriday)) earlyClose.add(blackFriday);

  const christmasEve = toDayKey(year, 12, 24);
  const christmasEveDt = DateTime.fromISO(christmasEve, { zone: ET_ZONE });
  if (christmasEveDt.weekday <= 5 && !closed.has(christmasEve)) earlyClose.add(christmasEve);

  closed.delete(null);
  earlyClose.delete(null);

  return { closed, earlyClose };
}

const cache = new Map();

function holidaySetsForYear(year) {
  const y = Number(year || 0);
  if (!cache.has(y)) cache.set(y, buildHolidaySetsForYear(y));
  return cache.get(y);
}

function getEtDayKey(ms) {
  return DateTime.fromMillis(Number(ms || 0), { zone: ET_ZONE }).toISODate() || "0000-00-00";
}

function isWeekendEt(dayKey) {
  const parts = getEtDateParts(dayKey);
  if (!parts) return false;
  return parts.weekday === 6 || parts.weekday === 7;
}

function isUsHolidayOrEarlyCloseEt(dayKey) {
  const parts = getEtDateParts(dayKey);
  if (!parts) return false;
  const sets = holidaySetsForYear(parts.year);
  return sets.closed.has(dayKey) || sets.earlyClose.has(dayKey);
}

module.exports = {
  getEtDayKey,
  isWeekendEt,
  isUsHolidayOrEarlyCloseEt
};
