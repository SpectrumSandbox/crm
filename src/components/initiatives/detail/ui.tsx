"use client";

/* Small building blocks shared by the initiative detail tabs. */
import * as React from "react";
import { cn, formatDate } from "@/lib/utils";
import type { SpectrumColor } from "@/lib/types";
import type { RiskItem } from "@/lib/initiatives/types";
import { Chip } from "@/components/ui/misc";
import { Cite } from "@/components/initiatives/shared";

const DAY = 86_400_000;

export function Card({
  title,
  icon: Icon,
  cite,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  cite?: string | string[];
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const cites = cite == null ? [] : Array.isArray(cite) ? cite : [cite];
  return (
    <section className={cn("rounded-xl border border-sg-line bg-sg-card", className)}>
      <header className="flex min-h-10 items-center gap-2 border-b border-sg-line px-4 py-2">
        {Icon ? <Icon className="size-4 shrink-0 text-sg-muted" /> : null}
        <h2 className="flex min-w-0 items-center font-display text-sm font-extrabold text-sg-white">
          <span className="truncate">{title}</span>
          {cites.map((s) => (
            <Cite key={s} s={s} />
          ))}
        </h2>
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Labelled long-form proposal text; shows a muted placeholder when empty. */
export function Prose({ label, text, cite }: { label: string; text: string | null | undefined; cite?: string }) {
  const value = (text ?? "").trim();
  return (
    <div>
      <div className="sg-eyebrow mb-1 flex items-center">
        {label}
        {cite ? <Cite s={cite} /> : null}
      </div>
      {value ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-sg-text">{value}</p> : <p className="text-xs italic text-sg-dim">Not provided</p>}
    </div>
  );
}

export const riskLevelColor: Record<RiskItem["level"], SpectrumColor> = { low: "green", medium: "yellow", high: "red" };

export function RiskLevelChip({ level }: { level: RiskItem["level"] }) {
  return (
    <Chip color={riskLevelColor[level]} dot>
      {level[0].toUpperCase() + level.slice(1)}
    </Chip>
  );
}

export type SlaTone = "green" | "yellow" | "orange" | "red" | "dim";

/** SLA status against a due date: "due in Xd" / "overdue by Xd", or met / late once done. */
export function slaState(dueIso: string, doneIso: string | null | undefined, now = Date.now()): { label: string; tone: SlaTone } {
  const due = Date.parse(dueIso);
  if (doneIso) {
    const done = Date.parse(doneIso);
    if (done <= due) return { label: "met", tone: "green" };
    return { label: `late by ${Math.max(1, Math.ceil((done - due) / DAY))}d`, tone: "orange" };
  }
  const diff = due - now;
  if (diff >= 0) {
    const d = Math.ceil(diff / DAY);
    return { label: d <= 0 ? "due today" : `due in ${d}d`, tone: d <= 1 ? "yellow" : "green" };
  }
  return { label: `overdue by ${Math.max(1, Math.ceil(-diff / DAY))}d`, tone: "red" };
}

const toneText: Record<SlaTone, string> = {
  green: "text-soft-green",
  yellow: "text-soft-yellow",
  orange: "text-soft-orange",
  red: "text-soft-red",
  dim: "text-sg-dim",
};
const toneChip: Record<SlaTone, string> = {
  green: "bg-soft-green/15 text-soft-green ring-soft-green/30",
  yellow: "bg-soft-yellow/15 text-soft-yellow ring-soft-yellow/30",
  orange: "bg-soft-orange/15 text-soft-orange ring-soft-orange/30",
  red: "bg-soft-red/15 text-soft-red ring-soft-red/30",
  dim: "bg-sg-card-3 text-sg-muted ring-sg-line",
};

export function SlaTimer({ label, dueIso, doneIso, cite }: { label: string; dueIso: string; doneIso?: string | null; cite?: string }) {
  const st = slaState(dueIso, doneIso);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-sg-muted">{label}</span>
      <span className="sg-num text-sg-text" title={formatDate(dueIso, "datetime")}>
        {formatDate(dueIso, "medium")}
      </span>
      <span className={cn("inline-flex h-5 items-center rounded-sm px-1.5 text-2xs font-semibold ring-1 ring-inset", toneChip[st.tone])}>{st.label}</span>
      {cite ? <Cite s={cite} /> : null}
    </div>
  );
}

export function ToneText({ tone, children, className }: { tone: SlaTone; children: React.ReactNode; className?: string }) {
  return <span className={cn(toneText[tone], className)}>{children}</span>;
}

/** Row in a definition list. */
export function KV({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-xs">
      <span className="text-sg-muted">{label}</span>
      <span className="min-w-0 text-right text-sg-text">{children}</span>
    </div>
  );
}

/** Check-list item for automated checks. */
export function CheckRow({ ok, warn, title, children }: { ok: boolean; warn?: boolean; title: React.ReactNode; children?: React.ReactNode }) {
  const tone: SlaTone = ok ? (warn ? "yellow" : "green") : "red";
  return (
    <div className="flex gap-2 py-1.5">
      <span className={cn("mt-1 size-2 shrink-0 rounded-full", tone === "green" ? "bg-soft-green" : tone === "yellow" ? "bg-soft-yellow" : "bg-soft-red")} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-sg-white">{title}</div>
        {children ? <div className="mt-0.5 text-2xs leading-relaxed text-sg-muted">{children}</div> : null}
      </div>
    </div>
  );
}

/** Submit a form on ⌘/Ctrl+Enter. */
export function onCmdEnter(fn: () => void) {
  return (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      fn();
    }
  };
}

export function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
