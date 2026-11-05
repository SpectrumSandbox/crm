"use client";

/* /policy — "What changed from Version 3.0": the §17.3 table as a filterable list, each area linked to the v4.0 rules. */
import { useMemo, useState } from "react";
import { ArrowUpRight, History, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { findSub, plainText, policyDoc } from "./model";
import { Inline } from "./render";

/** §17.3 area → the v4.0 sections that carry the new rule. */
export const CHANGE_ANCHORS: Record<string, string[]> = {
  "break-even formula": ["s-9-1"],
  "basis for bonuses": ["s-8-1", "s-8-2"],
  "failed break-even test": ["s-9-2"],
  "team changes": ["s-6-7", "s-6-8", "s-6-5"],
  "part-time contributors": ["s-6-4"],
  "project initiator": ["s-4-1"],
  approval: ["s-4-2"],
  "team-member limit vs. leadership limit": ["s-7-3"],
  "pip and probation": ["s-3-2", "s-11"],
  resignation: ["s-10"],
  "protected leave": ["s-3-3"],
  "prc membership": ["s-13-1"],
  "new sections": ["s-2", "s-4-7", "s-4-8", "s-5-6", "s-5-7", "s-12", "s-12-4", "s-13-4", "s-15-1"],
  "tax estimate": ["s-5-4", "s-5-5"],
  "revenue share": ["s-5-1"],
  "type c minimum pool": ["s-8-6"],
  "bonus caps": ["s-9"],
  "failed probation": ["s-11-4"],
  clawback: ["s-9-4"],
  "fixed-term and part-time staff": ["s-3-1"],
  "legal basis and rollout": ["s-1-5", "s-15-2"],
};

export interface ChangeRow {
  area: string;
  v3: string;
  v4: string;
  anchors: string[];
}

/** Rows of the §17.3 table (first row of the Google Docs export is the header). */
export function changeRows(): ChangeRow[] {
  const sub = findSub("s-17-3");
  const t = sub?.blocks.find((b) => b.kind === "table");
  if (!t || t.kind !== "table") return [];
  const rows = [t.head, ...t.rows].filter((r) => r.length >= 3 && plainText(r[0]).trim() && !/^area$/i.test(plainText(r[0]).trim()));
  return rows.map((r) => {
    const area = plainText(r[0]).trim();
    return { area, v3: r[1], v4: r[2], anchors: (CHANGE_ANCHORS[area.toLowerCase()] ?? []).filter((id) => policyDoc().ids.has(id)) };
  });
}

/** Top-level section ids touched by a change (for "changed" markers in the contents). */
export function changedSections(): Set<string> {
  const out = new Set<string>();
  for (const r of changeRows()) for (const a of r.anchors) out.add(a.split("-").slice(0, 2).join("-"));
  return out;
}

const labelOf = (id: string) => {
  const doc = policyDoc();
  for (const s of doc.sections) {
    if (s.id === id) return `${s.label} ${s.title}`.trim();
    const x = s.subs.find((y) => y.id === id);
    if (x) return `§${x.num ?? ""} ${plainText(x.title)}`.trim();
  }
  return id;
};

export function V3Changes({ onNavigate }: { onNavigate: (id: string) => void }) {
  const rows = useMemo(() => changeRows(), []);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((r) => `${r.area} ${plainText(r.v3)} ${plainText(r.v4)}`.toLowerCase().includes(t)) : rows;
  }, [rows, q]);
  return (
    <section aria-labelledby="v3-changes" className="mb-8">
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-sg-line pb-2">
        <h2 id="v3-changes" className="flex items-center gap-2 font-display text-xl font-extrabold tracking-tight text-sg-white">
          <History className="size-5 text-soft-cyan print:hidden" /> What changed from Version 3.0
        </h2>
        <button type="button" onClick={() => onNavigate("s-17-3")} className="text-2xs text-sg-dim hover:text-sg-white print:hidden">
          Source: §17.3
        </button>
        <div className="relative ml-auto w-full sm:w-60 print:hidden">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-sg-dim" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter changes" aria-label="Filter changes" className="pl-8 pr-7" />
          {q && (
            <button type="button" aria-label="Clear filter" onClick={() => setQ("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-sg-dim hover:text-sg-white">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <p className="mb-3 text-xs text-sg-muted">
        {rows.length} areas changed. Projects approved under Version 3.0 keep their type, flat revenue-share percentage and team weights; the cash-based calculation, timing and statements apply to all projects from the full rollout date (§15.1).
      </p>
      {shown.length === 0 ? (
        <EmptyState icon={Search} title="No change matches">
          Try another word.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => (
            <li key={r.area} className="rounded-xl border border-sg-line bg-sg-card p-3 print:break-inside-avoid">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-sm font-bold text-sg-white">{r.area}</h3>
                <span className="ml-auto flex flex-wrap gap-1 print:hidden">
                  {r.anchors.map((a) => (
                    <button key={a} type="button" onClick={() => onNavigate(a)} className="inline-flex h-5 items-center gap-1 rounded-sm border border-soft-cyan/30 bg-soft-cyan/[0.06] px-1.5 text-2xs font-semibold text-soft-cyan hover:border-soft-cyan/60">
                      {labelOf(a)}
                      <ArrowUpRight className="size-3" />
                    </button>
                  ))}
                </span>
              </div>
              <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded-lg border border-sg-line bg-sg-bg/40 px-2.5 py-1.5">
                  <div className="sg-eyebrow mb-0.5 text-soft-red">Version 3.0</div>
                  <div className="leading-relaxed text-sg-muted">
                    <Inline text={r.v3} />
                  </div>
                </div>
                <div className="rounded-lg border border-soft-green/25 bg-soft-green/[0.04] px-2.5 py-1.5">
                  <div className="sg-eyebrow mb-0.5 text-soft-green">Version 4.0</div>
                  <div className="leading-relaxed text-sg-text">
                    <Inline text={r.v4} />
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
