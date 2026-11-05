"use client";

import { useMemo, useState } from "react";
import { Link2, OctagonAlert, Plus, Search, Unlink } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Issue, IssueLinkType } from "@/lib/types";
import { issueStatusMeta, issueTypeMeta } from "@/lib/meta";
import { cn, softText } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { Select } from "@/components/ui/input";

/** Direction-aware choices: "blocked_by" stores a blocks-link from the other issue. */
type Choice = "blocks" | "blocked_by" | "relates_to" | "duplicates";
const CHOICES: { value: Choice; label: string }[] = [
  { value: "blocks", label: "blocks" },
  { value: "blocked_by", label: "is blocked by" },
  { value: "relates_to", label: "relates to" },
  { value: "duplicates", label: "duplicates" },
];

/** "Linked issues" section in the issue drawer. */
export function IssueLinksSection({ issue }: { issue: Issue }) {
  const links = useCrm((s) => s.issueLinks);
  const issues = useCrm((s) => s.issues);
  const removeIssueLink = useCrm((s) => s.removeIssueLink);
  const restoreIssueLink = useCrm((s) => s.restoreIssueLink);
  const openIssue = useUi((s) => s.openIssue);
  const notify = useUi((s) => s.notify);

  const rows = useMemo(() => {
    const byId = new Map(issues.map((i) => [i.id, i]));
    return links
      .filter((l) => l.fromIssueId === issue.id || l.toIssueId === issue.id)
      .map((l) => {
        const outgoing = l.fromIssueId === issue.id;
        const other = byId.get(outgoing ? l.toIssueId : l.fromIssueId);
        const label = l.type === "blocks" ? (outgoing ? "blocks" : "is blocked by") : l.type === "duplicates" ? (outgoing ? "duplicates" : "is duplicated by") : "relates to";
        const blocking = l.type === "blocks" && !outgoing && other && other.status !== "done";
        return { l, other, label, blocking };
      })
      .filter((r): r is typeof r & { other: Issue } => !!r.other)
      .sort((a, b) => Number(b.blocking) - Number(a.blocking) || a.label.localeCompare(b.label));
  }, [links, issues, issue.id]);
  const openBlockers = rows.filter((r) => r.blocking).length;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <span className="sg-eyebrow flex items-center gap-1.5">
          <Link2 className="size-3" /> Linked issues ({rows.length})
          {openBlockers > 0 && (
            <span className="ml-1 inline-flex items-center gap-0.5 rounded-sm bg-soft-red/15 px-1 text-[10px] font-semibold normal-case tracking-normal text-soft-red">
              <OctagonAlert className="size-3" /> Blocked by {openBlockers}
            </span>
          )}
        </span>
        <AddIssueLink issue={issue} />
      </div>
      <div className="space-y-1">
        {rows.map(({ l, other, label, blocking }) => {
          const T = issueTypeMeta[other.type].icon;
          return (
            <div key={l.id} className={cn("group flex items-center gap-2 rounded-md border px-2.5 py-1.5", blocking ? "border-soft-red/40 bg-soft-red/5" : "border-sg-line bg-sg-bg/40")}>
              <span className={cn("w-[92px] shrink-0 text-2xs font-semibold", blocking ? "text-soft-red" : "text-sg-dim")}>{label}</span>
              <T className={cn("size-3.5 shrink-0", softText[issueTypeMeta[other.type].color])} />
              <button type="button" onClick={() => openIssue(other.id)} className="shrink-0 text-xs font-semibold text-sg-muted hover:text-sg-white hover:underline">
                {other.key}
              </button>
              <span className={cn("min-w-0 flex-1 truncate text-sm", other.status === "done" ? "text-sg-dim line-through" : "text-sg-text")}>{other.summary}</span>
              <span className={cn("shrink-0 text-2xs", softText[issueStatusMeta[other.status].color])}>{issueStatusMeta[other.status].label}</span>
              <button
                type="button"
                onClick={() => {
                  const removed = removeIssueLink(l.id);
                  if (removed) notify(`Link to ${other.key} removed`, { label: "Undo", run: () => restoreIssueLink(removed) });
                }}
                className="rounded p-1 text-sg-dim opacity-0 hover:text-soft-red focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/60 group-hover:opacity-100"
                aria-label={`Remove link to ${other.key}`}
                title="Remove link"
              >
                <Unlink className="size-3.5" />
              </button>
            </div>
          );
        })}
        {!rows.length && <p className="rounded-md border border-dashed border-sg-line-2 px-3 py-2.5 text-center text-xs text-sg-dim">No dependencies. Link work this issue blocks or waits on.</p>}
      </div>
    </section>
  );
}

function AddIssueLink({ issue }: { issue: Issue }) {
  const issues = useCrm((s) => s.issues);
  const projects = useCrm((s) => s.projects);
  const addIssueLink = useCrm((s) => s.addIssueLink);
  const notify = useUi((s) => s.notify);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice>("blocks");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const projectKey = new Map(projects.map((p) => [p.id, p.key]));

  const candidates = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return issues
      .filter((i) => i.id !== issue.id && (!needle || `${i.key} ${i.summary}`.toLowerCase().includes(needle)))
      .sort((a, b) => Number(b.projectId === issue.projectId) - Number(a.projectId === issue.projectId) || Number(a.status === "done") - Number(b.status === "done") || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 30);
  }, [issues, issue.id, issue.projectId, q]);

  const pick = (other: Issue) => {
    const [from, type, to]: [string, IssueLinkType, string] = choice === "blocked_by" ? [other.id, "blocks", issue.id] : [issue.id, choice, other.id];
    const err = addIssueLink(from, type, to);
    if (err) {
      setError(err);
      return;
    }
    notify(`${issue.key} ${CHOICES.find((c) => c.value === choice)!.label} ${other.key}`);
    setOpen(false);
    setQ("");
    setError(null);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button size="xs" variant="ghost">
          <Plus /> Link issue
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-2">
        <div className="mb-1.5 flex items-center gap-2 px-1 text-xs text-sg-muted">
          <span className="font-semibold text-sg-white">{issue.key}</span>
          <Select value={choice} onChange={(e) => setChoice(e.target.value as Choice)} wrapperClassName="w-36" aria-label="Link type">
            {CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <span>…</span>
        </div>
        <div className="relative mb-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sg-dim" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && candidates[0]) {
                e.preventDefault();
                pick(candidates[0]);
              }
            }}
            placeholder="Search issues by key or summary"
            aria-label="Search issues to link"
            className="h-8 w-full rounded border border-sg-line bg-sg-bg/60 pl-7 pr-2 text-sm text-sg-text placeholder:text-sg-dim focus:border-sg-white/50 focus:outline-none"
          />
        </div>
        {error && <p className="mb-1 rounded border border-soft-red/40 bg-soft-red/10 px-2 py-1 text-2xs text-soft-red">{error}</p>}
        <div className="max-h-64 overflow-y-auto">
          {candidates.map((c) => {
            const T = issueTypeMeta[c.type].icon;
            return (
              <button key={c.id} type="button" onClick={() => pick(c)} className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-xs hover:bg-sg-card-3 focus-visible:bg-sg-card-3 focus-visible:outline-none">
                <T className={cn("size-3.5 shrink-0", softText[issueTypeMeta[c.type].color])} />
                <span className="w-16 shrink-0 font-semibold text-sg-dim">{c.key}</span>
                <span className={cn("min-w-0 flex-1 truncate", c.status === "done" ? "text-sg-dim line-through" : "text-sg-text")}>{c.summary}</span>
                {c.projectId !== issue.projectId && <span className="shrink-0 text-[10px] text-sg-dim">{projectKey.get(c.projectId)}</span>}
              </button>
            );
          })}
          {!candidates.length && <p className="px-1.5 py-3 text-center text-xs text-sg-dim">No matching issues.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
