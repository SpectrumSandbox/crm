"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, Check, Clock, Copy, ListTodo, Search } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Issue } from "@/lib/types";
import { issueTypeMeta, priorityMeta } from "@/lib/meta";
import { useUserMap } from "@/lib/selectors";
import { cn, relativeTime, softText } from "@/lib/utils";
import { Modal } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { Avatar, Kbd } from "@/components/ui/misc";
import { inTriage } from "./agile-ui";

const DAY = 86_400_000;

/** Pending triage issues for a project selection ("all" = every project). */
export function useTriageQueue(projectId: string) {
  const issues = useCrm((s) => s.issues);
  return useMemo(() => {
    const now = Date.now();
    const mine = issues.filter((i) => i.triage === "pending" && (projectId === "all" || i.projectId === projectId));
    const isEsc = (i: Issue) => (i.type === "support_escalation" ? 0 : 1);
    const pending = mine.filter((i) => inTriage(i, now)).sort((a, b) => isEsc(a) - isEsc(b) || priorityMeta[b.priority].weight - priorityMeta[a.priority].weight || a.createdAt.localeCompare(b.createdAt));
    const snoozed = mine.filter((i) => !inTriage(i, now));
    return { pending, snoozed };
  }, [issues, projectId]);
}

type Mode = { kind: "decline"; id: string } | { kind: "duplicate"; id: string } | { kind: "snooze"; id: string } | null;

/**
 * Triage inbox: escalations, deal actions and other unplanned requests wait here until the team accepts them.
 * Keys: j/k move · 1 accept · 2 decline · 3 duplicate · H snooze.
 */
export function TriageInbox({ open, onOpenChange, projectId }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string }) {
  const { pending, snoozed } = useTriageQueue(projectId);
  const triageIssue = useCrm((s) => s.triageIssue);
  const captureIssues = useCrm((s) => s.captureIssues);
  const restoreIssueFields = useCrm((s) => s.restoreIssueFields);
  const sprints = useCrm((s) => s.sprints);
  const crossLinks = useCrm((s) => s.crossLinks);
  const projects = useCrm((s) => s.projects);
  const openIssue = useUi((s) => s.openIssue);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const [focus, setFocus] = useState(0);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const list = showSnoozed ? [...pending, ...snoozed] : pending;

  useEffect(() => {
    if (open) {
      setFocus(0);
      setMode(null);
    }
  }, [open]);
  useEffect(() => {
    if (focus >= list.length) setFocus(Math.max(0, list.length - 1));
  }, [list.length, focus]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-triage-row="${focus}"]`)?.focus({ preventScroll: false });
  }, [focus, open, list.length]);

  const projectKey = new Map(projects.map((p) => [p.id, p.key]));
  const activeOf = (i: Issue) => sprints.find((s) => s.projectId === i.projectId && s.state === "active");

  const act = (i: Issue, action: Parameters<typeof triageIssue>[1], message: string) => {
    const snap = captureIssues([i.id]);
    triageIssue(i.id, action);
    setMode(null);
    notify(message, { label: "Undo", run: () => restoreIssueFields(snap) });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
    const i = list[focus];
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      setFocus((f) => Math.min(list.length - 1, f + 1));
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      setFocus((f) => Math.max(0, f - 1));
    } else if (i && e.key === "1") {
      e.preventDefault();
      act(i, { kind: "accept" }, `${i.key} accepted into the backlog`);
    } else if (i && e.key === "2") {
      e.preventDefault();
      setMode({ kind: "decline", id: i.id });
    } else if (i && e.key === "3") {
      e.preventDefault();
      setMode({ kind: "duplicate", id: i.id });
    } else if (i && (e.key === "h" || e.key === "H")) {
      e.preventDefault();
      setMode({ kind: "snooze", id: i.id });
    } else if (i && e.key === "Enter" && t.hasAttribute("data-triage-row")) {
      e.preventDefault();
      onOpenChange(false);
      openIssue(i.id);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Triage${pending.length ? ` · ${pending.length}` : ""}`} description="Escalations, deal actions and requests from outside the team wait here until the team accepts them." className="w-[min(760px,calc(100vw-32px))]">
      <div onKeyDown={onKeyDown} ref={listRef} className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-2xs text-sg-dim">
          <Kbd>j</Kbd>
          <Kbd>k</Kbd> move · <Kbd>1</Kbd> accept · <Kbd>2</Kbd> decline · <Kbd>3</Kbd> duplicate · <Kbd>H</Kbd> snooze · <Kbd>↵</Kbd> open
          {snoozed.length > 0 && (
            <label className="ml-auto flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={showSnoozed} onChange={(e) => setShowSnoozed(e.target.checked)} className="size-3 accent-white" /> Show snoozed ({snoozed.length})
            </label>
          )}
        </div>
        {list.map((i, idx) => {
          const T = issueTypeMeta[i.type].icon;
          const P = priorityMeta[i.priority].icon;
          const active = activeOf(i);
          const crm = crossLinks.filter((x) => x.agileType === "issue" && x.agileId === i.id);
          const snoozedNow = !inTriage(i);
          return (
            <div
              key={i.id}
              data-triage-row={idx}
              tabIndex={idx === focus ? 0 : -1}
              onFocus={() => setFocus(idx)}
              className={cn("rounded-lg border px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70", idx === focus ? "border-sg-line-2 bg-sg-card-2" : "border-sg-line bg-sg-bg/40")}
            >
              <div className="flex items-center gap-2 text-xs">
                <T className={cn("size-3.5 shrink-0", softText[issueTypeMeta[i.type].color])} aria-label={issueTypeMeta[i.type].label} />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    onOpenChange(false);
                    openIssue(i.id);
                  }}
                  className="font-semibold text-sg-muted hover:text-sg-white hover:underline"
                >
                  {i.key}
                </button>
                <span className="min-w-0 flex-1 truncate text-sm text-sg-text">{i.summary}</span>
                <P className={cn("size-3.5 shrink-0", softText[priorityMeta[i.priority].color])} aria-label={priorityMeta[i.priority].label} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-sg-dim">
                <span className="flex items-center gap-1">
                  <Avatar user={userMap.get(i.reporterId)} size="xs" /> {userMap.get(i.reporterId)?.name ?? "Someone"} · {relativeTime(i.createdAt)}
                </span>
                {projectId === "all" && <span>{projectKey.get(i.projectId)}</span>}
                {crm.length > 0 && <span className="text-soft-yellow">{crm.map((x) => `${x.linkType.replace("_", " ")} ${x.crmType}`).join(" · ")}</span>}
                {snoozedNow && i.snoozedUntil && <span className="text-soft-cyan">snoozed until {new Date(Date.parse(i.snoozedUntil)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" })}</span>}
                <span className="ml-auto flex flex-wrap items-center gap-1">
                  <Button size="xs" variant="subtle" tabIndex={-1} onClick={() => act(i, { kind: "accept" }, `${i.key} accepted into the backlog`)} title="Accept into the backlog (1)">
                    <Check /> Accept
                  </Button>
                  {active && (
                    <Button size="xs" variant="subtle" tabIndex={-1} onClick={() => act(i, { kind: "accept", sprintId: active.id }, `${i.key} accepted into ${active.name}`)} title={`Accept straight into ${active.name}`}>
                      → {active.name}
                    </Button>
                  )}
                  <Button size="xs" variant="ghost" tabIndex={-1} onClick={() => setMode({ kind: "decline", id: i.id })} title="Decline (2)">
                    <Ban /> Decline
                  </Button>
                  <Button size="xs" variant="ghost" tabIndex={-1} onClick={() => setMode({ kind: "duplicate", id: i.id })} title="Mark duplicate (3)">
                    <Copy /> Duplicate
                  </Button>
                  <Button size="xs" variant="ghost" tabIndex={-1} onClick={() => setMode({ kind: "snooze", id: i.id })} title="Snooze (H)">
                    <Clock /> Snooze
                  </Button>
                </span>
              </div>
              {mode?.id === i.id && mode.kind === "decline" && <DeclineForm onCancel={() => setMode(null)} onSubmit={(reason) => act(i, { kind: "decline", reason }, `${i.key} declined`)} />}
              {mode?.id === i.id && mode.kind === "duplicate" && <DuplicatePicker issue={i} onCancel={() => setMode(null)} onPick={(of) => act(i, { kind: "duplicate", ofIssueId: of.id }, `${i.key} closed as a duplicate of ${of.key}`)} />}
              {mode?.id === i.id && mode.kind === "snooze" && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-2xs text-sg-muted">
                  Snooze until
                  {[
                    { label: "Tomorrow", days: 1 },
                    { label: "3 days", days: 3 },
                    { label: "Next week", days: 7 },
                    { label: "2 weeks", days: 14 },
                  ].map((o) => (
                    <Button key={o.days} size="xs" variant="outline" onClick={() => act(i, { kind: "snooze", until: new Date(Date.now() + o.days * DAY).toISOString() }, `${i.key} snoozed (${o.label.toLowerCase()})`)}>
                      {o.label}
                    </Button>
                  ))}
                  <Button size="xs" variant="ghost" onClick={() => setMode(null)}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        {!list.length && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-sg-muted">
            <ListTodo className="size-6 text-sg-dim" />
            Triage is clear.
            <span className="max-w-sm text-2xs text-sg-dim">Escalations from tickets, deal actions and requests from people outside the project lead land here when they aren't planned into a sprint.</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

function DeclineForm({ onSubmit, onCancel }: { onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <form
      className="mt-2 flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim().length >= 3) onSubmit(reason);
      }}
    >
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}
        placeholder="Reason (shared with the reporter), e.g. out of scope for this contract"
        aria-label="Decline reason"
        className="h-7 min-w-0 flex-1 rounded border border-sg-line bg-sg-bg/60 px-2 text-xs text-sg-text placeholder:text-sg-dim focus:border-sg-white/50 focus:outline-none"
      />
      <Button size="xs" variant="danger" type="submit" disabled={reason.trim().length < 3}>
        Decline
      </Button>
      <Button size="xs" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

function DuplicatePicker({ issue, onPick, onCancel }: { issue: Issue; onPick: (of: Issue) => void; onCancel: () => void }) {
  const issues = useCrm((s) => s.issues);
  const [q, setQ] = useState("");
  const options = useMemo(() => {
    const n = q.trim().toLowerCase();
    return issues
      .filter((i) => i.id !== issue.id && i.projectId === issue.projectId && i.triage !== "declined" && (!n || `${i.key} ${i.summary}`.toLowerCase().includes(n)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 8);
  }, [issues, issue.id, issue.projectId, q]);
  return (
    <div className="mt-2 rounded border border-sg-line bg-sg-bg/60 p-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sg-dim" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              onCancel();
            }
            if (e.key === "Enter" && options[0]) {
              e.preventDefault();
              onPick(options[0]);
            }
          }}
          placeholder={`Duplicate of… (search ${issue.key.split("-")[0]} issues)`}
          aria-label="Search the original issue"
          className="h-7 w-full rounded border border-sg-line bg-transparent pl-7 pr-2 text-xs text-sg-text placeholder:text-sg-dim focus:border-sg-white/50 focus:outline-none"
        />
      </div>
      <div className="mt-1 max-h-40 overflow-y-auto">
        {options.map((o) => (
          <button key={o.id} type="button" onClick={() => onPick(o)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-sg-card-3">
            <span className="w-16 shrink-0 font-semibold text-sg-dim">{o.key}</span>
            <span className="min-w-0 flex-1 truncate text-sg-text">{o.summary}</span>
          </button>
        ))}
        {!options.length && <p className="px-1.5 py-2 text-center text-2xs text-sg-dim">No matching issues.</p>}
      </div>
    </div>
  );
}
