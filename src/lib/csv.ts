/* CSV export — RFC 4180 quoting, CRLF line endings and a UTF-8 BOM so Excel opens Rupiah names / accents correctly. */

export type CsvValue = string | number | boolean | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

/** characters that make spreadsheet apps treat a cell as a formula (CSV injection) */
const FORMULA_START = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  let s = String(value);
  // neutralise formulas in free text (numbers are emitted as numbers above, so negatives are unaffected)
  if (FORMULA_START.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => escapeCsvCell(c.header)).join(",")];
  rows.forEach((r) => lines.push(columns.map((c) => escapeCsvCell(c.value(r))).join(",")));
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

export function downloadCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]) {
  const blob = new Blob(["﻿" + toCsv(rows, columns)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
