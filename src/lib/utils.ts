import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { SpectrumColor } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const TZ = "Asia/Jakarta";
const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const fullFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/** Rupiah: compact ("Rp 8.4B") by default, or full ("Rp 8.400.000.000"). */
export function formatIDR(amount: number, mode: "compact" | "full" = "compact") {
  if (!Number.isFinite(amount)) return "—";
  return mode === "compact" ? `Rp ${compactFmt.format(amount)}` : `Rp ${fullFmt.format(Math.round(amount))}`;
}

export function formatNumber(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
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

export function daysFromNow(iso: string, now = Date.now()) {
  return Math.round((Date.parse(iso) - now) / 86_400_000);
}

/** yyyy-mm-dd for <input type="date"> in WIB */
export function toDateInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(Date.parse(iso) + 7 * 3_600_000);
  return d.toISOString().slice(0, 10);
}

/** <input type="date"> value → ISO at 17:00 WIB */
export function fromDateInput(value: string) {
  return new Date(`${value}T17:00:00+07:00`).toISOString();
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
