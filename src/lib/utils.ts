import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { SpectrumColor } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const TZ = "Asia/Jakarta";
const WIB_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
const fullFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

/*
 * Rupiah convention (one for the whole app, Indonesian usage):
 *   full     "Rp 7.200.000.000"  — "." groups thousands
 *   compact  "Rp 1,5 rb" (ribu) · "Rp 570 jt" (juta) · "Rp 8,4 M" (miliar) · "Rp 70,1 T" (triliun) — "," is the decimal
 * so a dot never means a decimal point anywhere. Negative amounts print "-Rp …"; negative zero prints "Rp 0".
 */
const SCALES = [
  { at: 1e12, unit: "T" },
  { at: 1e9, unit: "M" },
  { at: 1e6, unit: "jt" },
  { at: 1e3, unit: "rb" },
] as const;

function compactIdr(abs: number) {
  for (let i = 0; i < SCALES.length; i++) {
    const { at, unit } = SCALES[i]!;
    if (abs < at) continue;
    const scaled = Math.round((abs / at) * 10) / 10;
    // 999,95 jt rounds to 1.000 jt → promote to the next scale ("1 M")
    if (scaled >= 1000 && i > 0) return `${oneDecimal.format(Math.round((abs / SCALES[i - 1]!.at) * 10) / 10)} ${SCALES[i - 1]!.unit}`;
    return `${oneDecimal.format(scaled)} ${unit}`;
  }
  return fullFmt.format(Math.round(abs));
}

/** Rupiah: compact ("Rp 8,4 M", "Rp 570 jt") by default, or full ("Rp 8.400.000.000"). */
export function formatIDR(amount: number, mode: "compact" | "full" = "compact") {
  if (!Number.isFinite(amount)) return "—";
  const value = mode === "full" ? Math.round(amount) : amount;
  const abs = Math.abs(value);
  // Math.round(-0.4) and -0 both read as zero — never "Rp -0"
  if (mode === "full" ? abs === 0 : Math.round(abs) === 0) return "Rp 0";
  const body = mode === "compact" ? compactIdr(abs) : fullFmt.format(abs);
  return `${value < 0 ? "-" : ""}Rp ${body}`;
}

/** Plain number with Indonesian grouping ("3.200", "1.234,5"). */
export function formatNumber(n: number, maxDecimals = 0) {
  if (!Number.isFinite(n)) return "—";
  const v = Object.is(n, -0) ? 0 : n;
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: maxDecimals }).format(v);
}

const SUFFIX: Record<string, number> = {
  rb: 1e3, ribu: 1e3, k: 1e3,
  jt: 1e6, juta: 1e6, mn: 1e6, mio: 1e6, million: 1e6,
  m: 1e9, miliar: 1e9, milyar: 1e9, b: 1e9, bn: 1e9, billion: 1e9,
  t: 1e12, tn: 1e12, triliun: 1e12, trillion: 1e12,
};

/**
 * Parse a Rupiah amount typed by a person. Accepts Indonesian and English forms:
 *   "7.200.000.000", "7200000000", "Rp 7.200.000.000", "7,2 M", "7,2M", "1,5 miliar", "720 jt", "720jt", "7.2B", "15 rb",
 *   "7,200,000" (English grouping), "-1.500.000".
 * "M" is miliar (billion) — the Indonesian reading; use "jt" / "mn" for millions. Returns null when there is no number.
 */
export function parseIDR(input: string | number | null | undefined): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (!input) return null;
  let s = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  let negative = false;
  if (/^[-−(]/.test(s)) negative = true;
  s = s.replace(/^[-−(]\s*/, "").replace(/\)$/, "").replace(/^rp\.?\s*/, "").replace(/^idr\s*/, "");
  if (/^[-−]/.test(s)) {
    negative = true;
    s = s.slice(1);
  }
  const m = s.match(/^([\d.,\s]*\d[\d.,]*)\s*([a-z]*)\.?$/);
  if (!m) return null;
  const numText = m[1]!.replace(/\s/g, "");
  const suffix = m[2] ?? "";
  let mult = 1;
  if (suffix) {
    const f = SUFFIX[suffix];
    if (!f) return null;
    mult = f;
  }
  const dots = (numText.match(/\./g) ?? []).length;
  const commas = (numText.match(/,/g) ?? []).length;
  const grouped = (sep: "." | ",") => new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(numText);
  let normal: string;
  if (dots && commas) {
    // the separator that comes last is the decimal one: "1.234,5" (id) or "1,234.5" (en)
    normal = numText.lastIndexOf(",") > numText.lastIndexOf(".") ? numText.replace(/\./g, "").replace(",", ".") : numText.replace(/,/g, "");
  } else if (dots) {
    // Indonesian "7.200.000" / "1.500 jt" group thousands; a dot that doesn't group 3 digits is a decimal ("7.2B")
    normal = grouped(".") ? numText.replace(/\./g, "") : dots > 1 ? "" : numText;
  } else if (commas) {
    // "7,2 M" is a decimal; "7,200,000" (several groups) or a bare "7,200" with no unit is English grouping
    normal = commas > 1 ? (grouped(",") ? numText.replace(/,/g, "") : "") : grouped(",") && !suffix ? numText.replace(",", "") : numText.replace(",", ".");
  } else normal = numText;
  if (!normal || !/^\d+(\.\d+)?$/.test(normal)) return null;
  const value = Math.round(Number(normal) * mult);
  if (!Number.isFinite(value)) return null;
  return negative && value !== 0 ? -value : value;
}

/** Group digits of a whole rupiah amount for an input field: 7200000000 → "7.200.000.000". */
export function groupIDR(n: number) {
  return fullFmt.format(Math.round(n));
}

/** "1 deal", "3 deals"; pass the plural for irregular words: plural(2, "person", "people"). */
export function plural(n: number, singular: string, pluralForm?: string) {
  return n === 1 ? singular : (pluralForm ?? `${singular}s`);
}

/** "1 deal", "3 deals", "1.204 contacts" (count formatted with Indonesian grouping). */
export function countLabel(n: number, singular: string, pluralForm?: string) {
  return `${formatNumber(n)} ${plural(n, singular, pluralForm)}`;
}

export function formatDate(iso: string | null | undefined, style: "short" | "medium" | "long" | "datetime" | "time" = "medium") {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions =
    style === "short"
      ? { day: "numeric", month: "short", timeZone: TZ }
      : style === "medium"
        ? { day: "numeric", month: "short", year: "numeric", timeZone: TZ }
        : style === "long"
          ? { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: TZ }
          : style === "time"
            ? { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }
            : { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ };
  return new Intl.DateTimeFormat("en-GB", opts).format(d);
}

/** "3d ago", "in 2h", "just now" */
export function relativeTime(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "never";
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  let value: string;
  if (abs < min) return "just now";
  if (abs < hr) value = `${Math.round(abs / min)}m`;
  else if (abs < day) value = `${Math.round(abs / hr)}h`;
  else if (abs < 30 * day) value = `${Math.round(abs / day)}d`;
  else if (abs < 365 * day) value = `${Math.round(abs / (30 * day))}mo`;
  else value = `${Math.round(abs / (365 * day))}y`;
  return diff < 0 ? `${value} ago` : `in ${value}`;
}

/** WIB calendar day of an instant as "yyyy-mm-dd". */
export function wibDayKey(iso: string | number | Date | null | undefined) {
  if (iso === null || iso === undefined || iso === "") return "";
  const ms = typeof iso === "number" ? iso : iso instanceof Date ? iso.getTime() : Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + WIB_MS).toISOString().slice(0, 10);
}

/**
 * Whole WIB calendar days from `now` to `iso`: 0 = today (WIB), 1 = tomorrow, -1 = yesterday — whatever the hour.
 * (A deal due yesterday at 17:00 viewed at 04:00 WIB is -1, not "0d".)
 */
export function daysFromNow(iso: string, now = Date.now()) {
  const a = wibDayKey(iso);
  const b = wibDayKey(now);
  if (!a || !b) return Number.NaN;
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
}

/** "today", "tomorrow", "in 3 days", "yesterday", "2 days late" (WIB calendar days). */
export function dueLabel(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "no date";
  const d = daysFromNow(iso, now);
  if (!Number.isFinite(d)) return "no date";
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  return d > 0 ? `in ${d} days` : `${-d} days late`;
}

/** yyyy-mm-dd for <input type="date"> in WIB */
export function toDateInput(iso: string | null | undefined) {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + WIB_MS).toISOString().slice(0, 10);
}

const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in "yyyy-mm-dd" form (rejects "", "2026-02-30", partial input). */
export function isDateInput(value: string | null | undefined): value is string {
  if (!value) return false;
  const m = DATE_INPUT.exec(value);
  if (!m) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * <input type="date"> value → ISO at 17:00 WIB (end of the working day). Never throws: an empty or invalid value
 * returns "" — validate with isDateInput() or use fromDateInputOrNull() when the field is optional.
 */
export function fromDateInput(value: string) {
  return isDateInput(value) ? new Date(`${value}T17:00:00+07:00`).toISOString() : "";
}

/** Like fromDateInput, but null for an empty / invalid value. */
export function fromDateInputOrNull(value: string | null | undefined) {
  return value && isDateInput(value) ? new Date(`${value}T17:00:00+07:00`).toISOString() : null;
}

/** Today's WIB date as "yyyy-mm-dd" (not the UTC day, which is yesterday between 00:00 and 07:00 WIB). */
export function todayInput(now = Date.now()) {
  return wibDayKey(now);
}

/** 00:00:00.000 WIB on a "yyyy-mm-dd" day, as ISO ("" when invalid). Use for period starts. */
export function startOfDayWib(value: string) {
  return isDateInput(value) ? new Date(`${value}T00:00:00.000+07:00`).toISOString() : "";
}

/** 23:59:59.999 WIB on a "yyyy-mm-dd" day, as ISO ("" when invalid). Use for inclusive period ends. */
export function endOfDayWib(value: string) {
  return isDateInput(value) ? new Date(`${value}T23:59:59.999+07:00`).toISOString() : "";
}

/** ISO → "yyyy-mm-ddThh:mm" in WIB for <input type="datetime-local">. */
export function toDateTimeInput(iso: string | null | undefined) {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + WIB_MS).toISOString().slice(0, 16);
}

/** <input type="datetime-local"> value (read as WIB) → ISO; "" for an empty / invalid value. Never throws. */
export function fromDateTimeInput(value: string | null | undefined) {
  if (!value) return "";
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m || !isDateInput(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59) return "";
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}+07:00`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

export function uid(prefix: string) {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function titleCase(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* Spectrum colour → literal Tailwind classes (kept literal so the JIT sees them). */
export const spectrumDot: Record<SpectrumColor, string> = {
  magenta: "bg-spectrum-magenta",
  blue: "bg-spectrum-blue",
  cyan: "bg-spectrum-cyan",
  green: "bg-spectrum-green",
  yellow: "bg-spectrum-yellow",
  orange: "bg-spectrum-orange",
  red: "bg-spectrum-red",
};
export const softText: Record<SpectrumColor, string> = {
  magenta: "text-soft-magenta",
  blue: "text-soft-blue",
  cyan: "text-soft-cyan",
  green: "text-soft-green",
  yellow: "text-soft-yellow",
  orange: "text-soft-orange",
  red: "text-soft-red",
};
export const softChip: Record<SpectrumColor, string> = {
  magenta: "bg-soft-magenta/15 text-soft-magenta ring-soft-magenta/30",
  blue: "bg-soft-blue/15 text-soft-blue ring-soft-blue/30",
  cyan: "bg-soft-cyan/15 text-soft-cyan ring-soft-cyan/30",
  green: "bg-soft-green/15 text-soft-green ring-soft-green/30",
  yellow: "bg-soft-yellow/15 text-soft-yellow ring-soft-yellow/30",
  orange: "bg-soft-orange/15 text-soft-orange ring-soft-orange/30",
  red: "bg-soft-red/15 text-soft-red ring-soft-red/30",
};
export const softBorderLeft: Record<SpectrumColor, string> = {
  magenta: "border-l-soft-magenta",
  blue: "border-l-soft-blue",
  cyan: "border-l-soft-cyan",
  green: "border-l-soft-green",
  yellow: "border-l-soft-yellow",
  orange: "border-l-soft-orange",
  red: "border-l-soft-red",
};

export function scoreColor(score: number): SpectrumColor {
  if (score >= 80) return "green";
  if (score >= 60) return "yellow";
  if (score >= 40) return "orange";
  return "red";
}
