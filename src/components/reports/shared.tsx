"use client";

import * as React from "react";
import { Download } from "lucide-react";
import type { CsvColumn } from "@/lib/csv";
import { csvFilename, downloadCsv } from "@/lib/csv";
import type { SpectrumColor } from "@/lib/types";
import { cn, spectrumDot } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Period } from "./data";

export interface ReportFilters {
  period: Period;
  /** "" = all deal pipelines */
  pipelineId: string;
  /** "" = everyone */
  ownerId: string;
  /** "" = all Jira projects */
  projectId: string;
}

/** Card with a title, an optional explanation and a CSV export of the rows behind it. */
export function Panel<T>({ title, hint, children, csv, className, actions }: { title: string; hint?: React.ReactNode; children: React.ReactNode; csv?: { name: string; rows: T[]; columns: CsvColumn<T>[] }; className?: string; actions?: React.ReactNode }) {
  return (
    <section className={cn("break-inside-avoid rounded-xl border border-sg-line bg-sg-card", className)}>
      <header className="flex flex-wrap items-start gap-2 border-b border-sg-line px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-bold text-sg-white">{title}</h2>
          {hint ? <p className="mt-0.5 text-2xs text-sg-dim">{hint}</p> : null}
        </div>
        {actions}
        {csv ? (
          <Button variant="ghost" size="xs" className="print:hidden" disabled={!csv.rows.length} onClick={() => downloadCsv(csvFilename(csv.name), csv.rows, csv.columns)} title={`Export ${csv.rows.length} rows`}>
            <Download /> CSV
          </Button>
        ) : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Kpi({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "green" | "red" | "orange" | "cyan" }) {
  return (
    <div className="rounded-xl border border-sg-line bg-sg-card px-4 py-3">
      <div className="sg-eyebrow">{label}</div>
      <div className={cn("sg-num mt-1 font-display text-xl font-extrabold", tone === "green" ? "text-soft-green" : tone === "red" ? "text-soft-red" : tone === "orange" ? "text-soft-orange" : tone === "cyan" ? "text-soft-cyan" : "text-sg-white")}>{value}</div>
      {hint ? <div className="mt-0.5 text-2xs text-sg-dim">{hint}</div> : null}
    </div>
  );
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>;
}

/** Horizontal bars; value drives the width, `label` and `right` are text. */
export function BarList({ rows, color = "blue", empty = "No data for this period" }: { rows: { key: string; label: React.ReactNode; value: number; right: React.ReactNode; color?: SpectrumColor; sub?: React.ReactNode }[]; color?: SpectrumColor; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  if (!rows.length) return <p className="py-4 text-center text-xs text-sg-dim">{empty}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-sg-text">{r.label}</span>
            <span className="sg-num shrink-0 font-semibold text-sg-white">{r.right}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-sg-card-3">
            <div className={cn("h-full rounded-full", spectrumDot[r.color ?? color])} style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} />
          </div>
          {r.sub ? <div className="mt-0.5 text-[10px] text-sg-dim">{r.sub}</div> : null}
        </li>
      ))}
    </ul>
  );
}

/** One stacked horizontal bar from segments (values ≥ 0). */
export function StackBar({ segments, total, label }: { segments: { key: string; value: number; color: SpectrumColor; label: string }[]; total?: number; label: string }) {
  const sum = total ?? segments.reduce((s, x) => s + x.value, 0);
  return (
    <div className="flex h-3 overflow-hidden rounded-full bg-sg-card-3" role="img" aria-label={`${label}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
      {segments.map((s) => (
        <div key={s.key} className={cn("h-full", spectrumDot[s.color])} style={{ width: `${sum ? (s.value / sum) * 100 : 0}%` }} title={s.label} />
      ))}
    </div>
  );
}

/** Vertical column chart (e.g. weekly throughput). */
export function Columns({ cols, height = 120, format = (n: number) => String(n) }: { cols: { key: string; label: string; value: number; tone?: "dim" | "normal"; title?: string }[]; height?: number; format?: (n: number) => string }) {
  const max = Math.max(1, ...cols.map((c) => c.value));
  return (
    <div className="flex items-end gap-1" style={{ height: height + 28 }} role="img" aria-label={cols.map((c) => `${c.label}: ${format(c.value)}`).join("; ")}>
      {cols.map((c) => (
        <div key={c.key} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={c.title ?? `${c.label}: ${format(c.value)}`}>
          <span className="sg-num text-[10px] text-sg-muted">{c.value ? format(c.value) : ""}</span>
          <div className={cn("w-full rounded-t-sm", c.tone === "dim" ? "bg-soft-blue/40" : "bg-soft-blue")} style={{ height: `${(c.value / max) * height}px`, minHeight: c.value ? 2 : 0 }} />
          <span className="w-full truncate text-center text-[9px] text-sg-dim">{c.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: SpectrumColor }[] }) {
  return (
    <div className="flex flex-wrap gap-3 text-2xs text-sg-muted">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2 rounded-sm", spectrumDot[i.color])} /> {i.label}
        </span>
      ))}
    </div>
  );
}

export function Th({ children, right, className }: { children?: React.ReactNode; right?: boolean; className?: string }) {
  return <th className={cn("px-3 py-2 text-2xs font-semibold uppercase tracking-[0.1em] text-sg-dim", right ? "text-right" : "text-left", className)}>{children}</th>;
}
export function Td({ children, right, className, title }: { children?: React.ReactNode; right?: boolean; className?: string; title?: string }) {
  return (
    <td title={title} className={cn("px-3 py-2", right && "sg-num text-right", className)}>
      {children}
    </td>
  );
}
