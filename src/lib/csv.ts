/* CSV export — RFC 4180 quoting, CRLF line endings and a UTF-8 BOM so Excel opens Rupiah names / accents correctly.
 * Two dialects: "comma" (standard CSV, Google Sheets, Numbers, en-US Excel) and "excel-id" — semicolon-separated with
 * decimal commas, which is what Excel on Indonesian-locale Windows expects (its list separator is ";"). The user's choice
 * is remembered per browser and applies to every export in the app. */

export type CsvValue = string | number | boolean | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

export type CsvFormat = "comma" | "excel-id";

export const CSV_FORMATS: { id: CsvFormat; label: string; hint: string }[] = [
  { id: "comma", label: "CSV (comma)", hint: "Google Sheets, Numbers, Excel in English" },
  { id: "excel-id", label: "Excel — Indonesian locale (;)", hint: "Semicolons and decimal commas for Excel set to Bahasa Indonesia" },
];

const FORMAT_KEY = "sg-csv-format";

export function getCsvFormat(): CsvFormat {
  if (typeof window === "undefined") return "comma";
  try {
    return window.localStorage.getItem(FORMAT_KEY) === "excel-id" ? "excel-id" : "comma";
  } catch {
    return "comma";
  }
}

export function setCsvFormat(format: CsvFormat) {
  try {
    window.localStorage.setItem(FORMAT_KEY, format);
  } catch {
    /* storage unavailable — the choice applies to this export only */
  }
}

/** characters that make spreadsheet apps treat a cell as a formula (CSV injection) */
const FORMULA_START = /^[=+\-@\t\r]/;
/** a phone number or plain number written as text ("+62 21 5790 1120", "-12.5") — safe, never a formula */
const PHONE_OR_NUMBER = /^[+-]?\d+([.,]\d+)?$|^\+?\d[\d\s().-]{5,}$/;

export function escapeCsvCell(value: CsvValue, format: CsvFormat = "comma"): string {
  const sep = format === "excel-id" ? ";" : ",";
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return format === "excel-id" ? String(value).replace(".", ",") : String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  let s = String(value);
  // neutralise formulas in free text, but leave phone numbers like "+62 812-3456-7890" intact
  if (FORMULA_START.test(s) && !PHONE_OR_NUMBER.test(s.trim())) s = `'${s}`;
  const needsQuote = s.includes('"') || s.includes("\r") || s.includes("\n") || s.includes(sep) || /^\s|\s$/.test(s);
  if (needsQuote) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[], format: CsvFormat = "comma"): string {
  const sep = format === "excel-id" ? ";" : ",";
  const lines = [columns.map((c) => escapeCsvCell(c.header, format)).join(sep)];
  rows.forEach((r) => lines.push(columns.map((c) => escapeCsvCell(c.value(r), format)).join(sep)));
  return lines.join("\r\n") + "\r\n";
}

/** yyyy-mm-dd in WIB — stable, sortable and recognised by Excel */
export function csvDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** yyyy-mm-dd hh:mm in WIB */
export function csvDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + 7 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
}

/** "contacts" → "contacts-2026-11-04.csv" */
export function csvFilename(base: string) {
  return `${base}-${csvDate(new Date().toISOString())}.csv`;
}

/** Download rows as CSV. Without `format`, the user's remembered dialect is used (see CSV_FORMATS). */
export function downloadCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[], format: CsvFormat = getCsvFormat()) {
  const blob = new Blob(["﻿" + toCsv(rows, columns, format)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
