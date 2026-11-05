"use client";

/* Small shared pieces for the agile pages: due-date chip, Blocked badge, dependency index hook, WIB date input. */
import { useMemo } from "react";
import { CalendarClock, OctagonAlert } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Issue } from "@/lib/types";
import { openBlockersOf, wibDaysUntil } from "@/lib/slices/agile-extras";
import { cn, formatDate } from "@/lib/utils";

export type DueState = "overdue" | "soon" | "later";

/** overdue = before today (WIB) and not done; soon = within 3 days */
export function dueState(issue: Pick<Issue, "dueDate" | "status">, now = Date.now()): DueState | null {
  if (!issue.dueDate) return null;
  if (issue.status === "done") return "later";
  const d = wibDaysUntil(issue.dueDate, now);
  return d < 0 ? "overdue" : d <= 3 ? "soon" : "later";
}

export function dueLabel(iso: string, now = Date.now()) {
  const d = wibDaysUntil(iso, now);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "1d overdue";
  if (d < 0) return `${-d}d overdue`;
  if (d <= 6) return `in ${d}d`;
  return formatDate(iso, "short");
}

/** Due chip: red when overdue, amber within 3 days. */
export function DueChip({ issue, className, compact }: { issue: Pick<Issue, "dueDate" | "status">; className?: string; compact?: boolean }) {
  const state = dueState(issue);
  if (!state || !issue.dueDate) return null;
  const label = dueLabel(issue.dueDate);
  return (
    <span
      title={`Due ${formatDate(issue.dueDate, "medium")}`}
      aria-label={`Due ${formatDate(issue.dueDate, "medium")}${state === "overdue" ? ", overdue" : ""}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-sm px-1 text-[10px] font-semibold",
        state === "overdue" ? "bg-soft-red/15 text-soft-red" : state === "soon" ? "bg-soft-orange/15 text-soft-orange" : "bg-sg-card-3 text-sg-dim",
        className,
      )}
    >
      <CalendarClock className="size-3" />
      {compact ? (state === "later" ? formatDate(issue.dueDate, "short") : label) : label}
    </span>
  );
}

/** Red "Blocked" badge listing the open blockers. */
export function BlockedBadge({ blockers, className }: { blockers: Issue[] | undefined; className?: string }) {
  if (!blockers?.length) return null;
  const keys = blockers.map((b) => b.key).join(", ");
  return (
    <span title={`Blocked by ${keys}`} aria-label={`Blocked by ${keys}`} className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-soft-red/15 px-1 text-[10px] font-semibold text-soft-red", className)}>
      <OctagonAlert className="size-3" /> Blocked
    </span>
  );
}

/** issueId → open blockers, from the shared issue links. */
export function useOpenBlockers() {
  const links = useCrm((s) => s.issueLinks);
  const issues = useCrm((s) => s.issues);
  return useMemo(() => openBlockersOf(links, issues), [links, issues]);
}

/** Visible in triage now (pending and not snoozed). */
export function inTriage(i: Issue, now = Date.now()) {
  return i.triage === "pending" && !(i.snoozedUntil && Date.parse(i.snoozedUntil) > now);
}

/** Kept off the board and backlog: waiting in triage (incl. snoozed) or declined there. */
export function hiddenByTriage(i: Issue) {
  return i.triage === "pending" || i.triage === "declined";
}

const PRIORITY_CYCLE: Issue["priority"][] = ["highest", "high", "medium", "low", "lowest"];
const ESTIMATE_CYCLE: (number | null)[] = [1, 2, 3, 5, 8, 13, null];

/**
 * Single-key actions on a focused issue (board card or /issues row):
 * i = assign to me / unassign, p = next priority, e = next estimate. Each posts an Undo toast.
 * Returns true when the key was handled.
 */
export function useIssueQuickKeys() {
  const currentUserId = useCrm((s) => s.currentUserId);
  const updateIssueTracked = useCrm((s) => s.updateIssueTracked);
  const captureIssues = useCrm((s) => s.captureIssues);
  const restoreIssueFields = useCrm((s) => s.restoreIssueFields);
  const users = useCrm((s) => s.users);
  const notify = useUi((s) => s.notify);
  return (issue: Issue, key: string): boolean => {
    let patch: Partial<Issue> | null = null;
    let msg = "";
    if (key === "i") {
      const mine = issue.assigneeId === currentUserId;
      patch = { assigneeId: mine ? null : currentUserId };
      msg = mine ? `${issue.key} unassigned` : `${issue.key} assigned to ${users.find((u) => u.id === currentUserId)?.name.split(" ")[0] ?? "you"}`;
    } else if (key === "p") {
      const next = PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(issue.priority) + 1) % PRIORITY_CYCLE.length]!;
      patch = { priority: next };
      msg = `${issue.key} priority → ${next}`;
    } else if (key === "e") {
      const at = ESTIMATE_CYCLE.indexOf(issue.storyPoints);
      const next = ESTIMATE_CYCLE[(at + 1) % ESTIMATE_CYCLE.length] ?? null;
      patch = { storyPoints: next };
      msg = `${issue.key} estimate → ${next ?? "none"}`;
    }
    if (!patch) return false;
    const snap = captureIssues([issue.id]);
    updateIssueTracked(issue.id, patch);
    notify(msg, { label: "Undo", run: () => restoreIssueFields(snap) });
    return true;
  };
}
