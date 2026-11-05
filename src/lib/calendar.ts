/*
 * Indonesian business-day calendar (WIB, UTC+7). Pure functions, no imports — safe to use from the engine, the
 * store, scripts and UI alike.
 *
 * Holidays: national public holidays (hari libur nasional) and collective leave (cuti bersama) set by the joint
 * decree of the three ministers (SKB 3 Menteri):
 *   2026 — SKB No. 1497/2025, No. 2/2025, No. 5/2025
 *   2027 — SKB published 15 Sep 2026 (18 national holidays, 8 cuti bersama)
 * HR updates this table each year when the next SKB is issued. Policy v4.0 §8.2 ("the other dates move to the
 * previous business day") and every business-day deadline (§4.5, §4.6, §6.8, §9.4, §14) use it.
 */

export const WIB_OFFSET_MS = 7 * 3_600_000;
const DAY = 86_400_000;

export type HolidayKind = "national" | "cuti_bersama";
export interface Holiday {
  /** YYYY-MM-DD (WIB calendar date) */
  date: string;
  /** English name */
  name: string;
  /** Bahasa Indonesia name as in the SKB */
  nameId: string;
  kind: HolidayKind;
}

const h = (date: string, name: string, nameId: string, kind: HolidayKind = "national"): Holiday => ({ date, name, nameId, kind });

export const HOLIDAYS: Holiday[] = [
  // 2026 — national holidays
  h("2026-01-01", "New Year's Day", "Tahun Baru 2026 Masehi"),
  h("2026-01-16", "Isra Mi'raj", "Isra Mikraj Nabi Muhammad SAW"),
  h("2026-02-17", "Chinese New Year", "Tahun Baru Imlek 2577 Kongzili"),
  h("2026-03-19", "Nyepi (Saka New Year)", "Hari Suci Nyepi (Tahun Baru Saka 1948)"),
  h("2026-03-21", "Eid al-Fitr", "Idulfitri 1447 H"),
  h("2026-03-22", "Eid al-Fitr (day 2)", "Idulfitri 1447 H"),
  h("2026-04-03", "Good Friday", "Wafat Yesus Kristus"),
  h("2026-04-05", "Easter Sunday", "Kebangkitan Yesus Kristus (Paskah)"),
  h("2026-05-01", "Labour Day", "Hari Buruh Internasional"),
  h("2026-05-14", "Ascension of Jesus", "Kenaikan Yesus Kristus"),
  h("2026-05-27", "Eid al-Adha", "Iduladha 1447 H"),
  h("2026-05-31", "Vesak", "Hari Raya Waisak 2570 BE"),
  h("2026-06-01", "Pancasila Day", "Hari Lahir Pancasila"),
  h("2026-06-16", "Islamic New Year", "1 Muharam Tahun Baru Islam 1448 H"),
  h("2026-08-17", "Independence Day", "Hari Proklamasi Kemerdekaan"),
  h("2026-08-25", "Prophet's Birthday", "Maulid Nabi Muhammad SAW"),
  h("2026-12-25", "Christmas Day", "Kelahiran Yesus Kristus"),
  // 2026 — cuti bersama
  h("2026-02-16", "Chinese New Year (collective leave)", "Cuti bersama Tahun Baru Imlek", "cuti_bersama"),
  h("2026-03-18", "Nyepi (collective leave)", "Cuti bersama Hari Suci Nyepi", "cuti_bersama"),
  h("2026-03-20", "Eid al-Fitr (collective leave)", "Cuti bersama Idulfitri", "cuti_bersama"),
  h("2026-03-23", "Eid al-Fitr (collective leave)", "Cuti bersama Idulfitri", "cuti_bersama"),
  h("2026-03-24", "Eid al-Fitr (collective leave)", "Cuti bersama Idulfitri", "cuti_bersama"),
  h("2026-05-15", "Ascension (collective leave)", "Cuti bersama Kenaikan Yesus Kristus", "cuti_bersama"),
  h("2026-05-28", "Eid al-Adha (collective leave)", "Cuti bersama Iduladha", "cuti_bersama"),
  h("2026-12-24", "Christmas (collective leave)", "Cuti bersama Kelahiran Yesus Kristus", "cuti_bersama"),
  // 2027 — national holidays
  h("2027-01-01", "New Year's Day", "Tahun Baru 2027 Masehi"),
  h("2027-01-05", "Isra Mi'raj", "Isra Mikraj Nabi Muhammad SAW"),
  h("2027-02-06", "Chinese New Year", "Tahun Baru Imlek 2578 Kongzili"),
  h("2027-03-08", "Nyepi (Saka New Year)", "Hari Suci Nyepi (Tahun Baru Saka 1949)"),
  h("2027-03-10", "Eid al-Fitr", "Idulfitri 1448 H"),
  h("2027-03-11", "Eid al-Fitr (day 2)", "Idulfitri 1448 H"),
  h("2027-03-26", "Good Friday", "Wafat Yesus Kristus"),
  h("2027-03-28", "Easter Sunday", "Kebangkitan Yesus Kristus (Paskah)"),
  h("2027-05-01", "Labour Day", "Hari Buruh Internasional"),
  h("2027-05-06", "Ascension of Jesus", "Kenaikan Yesus Kristus"),
  h("2027-05-17", "Eid al-Adha", "Iduladha 1448 H"),
  h("2027-05-20", "Vesak", "Hari Raya Waisak 2571 BE"),
  h("2027-06-01", "Pancasila Day", "Hari Lahir Pancasila"),
  h("2027-06-06", "Islamic New Year", "1 Muharam Tahun Baru Islam 1449 H"),
  h("2027-08-15", "Prophet's Birthday", "Maulid Nabi Muhammad SAW"),
  h("2027-08-17", "Independence Day", "Hari Proklamasi Kemerdekaan"),
  h("2027-12-25", "Christmas Day", "Kelahiran Yesus Kristus"),
  h("2027-12-26", "Isra Mi'raj", "Isra Mikraj Nabi Muhammad SAW"),
  // 2027 — cuti bersama
  h("2027-02-05", "Chinese New Year (collective leave)", "Cuti bersama Tahun Baru Imlek", "cuti_bersama"),
  h("2027-03-09", "Eid al-Fitr (collective leave)", "Cuti bersama Idulfitri", "cuti_bersama"),
  h("2027-03-12", "Eid al-Fitr (collective leave)", "Cuti bersama Idulfitri", "cuti_bersama"),
  h("2027-03-15", "Eid al-Fitr (collective leave)", "Cuti bersama Idulfitri", "cuti_bersama"),
  h("2027-03-25", "Good Friday (collective leave)", "Cuti bersama Wafat Yesus Kristus", "cuti_bersama"),
  h("2027-05-18", "Eid al-Adha (collective leave)", "Cuti bersama Iduladha", "cuti_bersama"),
  h("2027-05-19", "Vesak (collective leave)", "Cuti bersama Waisak", "cuti_bersama"),
  h("2027-12-24", "Christmas (collective leave)", "Cuti bersama Kelahiran Yesus Kristus", "cuti_bersama"),
].sort((a, b) => a.date.localeCompare(b.date));

/** Years the holiday table covers. Outside them only weekends are skipped (see calendarCovers). */
export const HOLIDAY_YEARS = [2026, 2027] as const;

const BY_DATE = new Map(HOLIDAYS.map((x) => [x.date, x]));

/* ───────────────────────── WIB date keys ───────────────────────── */

const toMs = (v: string | number | Date) => (typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : v.getTime());

/** WIB calendar date (YYYY-MM-DD) of an instant. */
export function wibDateKey(v: string | number | Date): string {
  return new Date(toMs(v) + WIB_OFFSET_MS).toISOString().slice(0, 10);
}
/** Instant (ISO) for a WIB date key at the given WIB time. */
export function wibAt(dateKey: string, hour = 0, minute = 0, second = 0, ms = 0): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour, minute, second, ms) - WIB_OFFSET_MS).toISOString();
}
/** 00:00:00.000 WIB on the WIB date of `v`. */
export const wibDayStart = (v: string | number | Date) => wibAt(wibDateKey(v));
/** 23:59:59.999 WIB on the WIB date of `v`. */
export const wibDayEnd = (v: string | number | Date) => wibAt(wibDateKey(v), 23, 59, 59, 999);
/** Day of week (0 = Sunday … 6 = Saturday) of a WIB date key. */
export function weekdayOf(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
/** Shift a WIB date key by whole calendar days. */
export function shiftDateKey(dateKey: string, days: number) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY).toISOString().slice(0, 10);
}

/* ───────────────────────── business days ───────────────────────── */

export const isWeekend = (dateKey: string) => {
  const wd = weekdayOf(dateKey);
  return wd === 0 || wd === 6;
};
export const holidayOn = (dateKey: string): Holiday | undefined => BY_DATE.get(dateKey);
export const isHoliday = (dateKey: string) => BY_DATE.has(dateKey);
/** Monday–Friday and not a national holiday or cuti bersama. */
export const isBusinessDay = (dateKey: string) => !isWeekend(dateKey) && !isHoliday(dateKey);
/** Does the holiday table cover this year? (Outside it only weekends are skipped.) */
export const calendarCovers = (year: number) => (HOLIDAY_YEARS as readonly number[]).includes(year);

/** Why a date is not a business day ("Sunday", "Christmas Day (national holiday)"), or null. */
export function nonBusinessReason(dateKey: string): string | null {
  const hol = holidayOn(dateKey);
  if (hol) return `${hol.name} (${hol.kind === "national" ? "national holiday" : "cuti bersama"})`;
  const wd = weekdayOf(dateKey);
  if (wd === 0) return "Sunday";
  if (wd === 6) return "Saturday";
  return null;
}

/** The business day on or before `dateKey` (strictly before when includeSelf is false). */
export function previousBusinessDay(dateKey: string, includeSelf = true) {
  let k = includeSelf ? dateKey : shiftDateKey(dateKey, -1);
  for (let i = 0; i < 30 && !isBusinessDay(k); i++) k = shiftDateKey(k, -1);
  return k;
}
/** The business day on or after `dateKey` (strictly after when includeSelf is false). */
export function nextBusinessDay(dateKey: string, includeSelf = true) {
  let k = includeSelf ? dateKey : shiftDateKey(dateKey, 1);
  for (let i = 0; i < 30 && !isBusinessDay(k); i++) k = shiftDateKey(k, 1);
  return k;
}

/**
 * Add (or, with a negative n, subtract) business days to an instant, keeping its WIB time of day. Day 1 is the first
 * business day after the start date, so a deadline "within 5 business days" of a Friday submission is the next Friday
 * (or later when holidays fall in between).
 */
export function addBusinessDays(v: string | number | Date, n: number): string {
  const t = toMs(v);
  const startKey = wibDateKey(t);
  const timeOfDay = t - Date.parse(wibAt(startKey));
  let k = startKey;
  let left = Math.abs(Math.trunc(n));
  const step = n < 0 ? -1 : 1;
  while (left > 0) {
    k = shiftDateKey(k, step);
    if (isBusinessDay(k)) left--;
  }
  return new Date(Date.parse(wibAt(k)) + timeOfDay).toISOString();
}

/** Business days after `from` up to and including `to` (0 when to ≤ from). */
export function businessDaysBetween(from: string | number | Date, to: string | number | Date): number {
  const a = wibDateKey(from);
  const b = wibDateKey(to);
  if (b <= a) return 0;
  let n = 0;
  for (let k = shiftDateKey(a, 1); k <= b; k = shiftDateKey(k, 1)) if (isBusinessDay(k)) n++;
  return n;
}

/** Holidays and cuti bersama between two WIB date keys (inclusive). */
export function holidaysBetween(fromKey: string, toKey: string): Holiday[] {
  return HOLIDAYS.filter((x) => x.date >= fromKey && x.date <= toKey);
}

/**
 * A nominal date moved to the previous business day when it falls on a weekend or holiday (§8.2 "the other dates
 * move to the previous business day"). Returns the adjusted key and why it moved.
 */
export function onOrBeforeBusinessDay(dateKey: string): { date: string; moved: boolean; reason: string | null } {
  const reason = nonBusinessReason(dateKey);
  if (!reason) return { date: dateKey, moved: false, reason: null };
  return { date: previousBusinessDay(dateKey), moved: true, reason };
}
