"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { CalendarDays, ChevronDown, ChevronRight, CircleCheck, Gauge, History, Layers, ListChecks, ListTodo, Pencil, Play, Plus, Search, Target, TrendingUp } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { Issue, IssueType, Sprint, SprintReport } from "@/lib/types";
import { issueStatusMeta, issueTypeMeta, priorityMeta } from "@/lib/meta";
import { startBlocker, wibDaysUntil } from "@/lib/slices/agile-extras";
import { cn, formatDate, softText, spectrumDot } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Avatar, Chip, Dot, EmptyState, Kbd } from "@/components/ui/misc";
import { Burndown } from "@/components/agile/burndown";
import { assignedPoints, CompleteSprintModal, EditSprintModal, StartSprintModal } from "@/components/agile/sprint-dialogs";
import { useProjectParam } from "@/components/agile/project-param";
import { createIssueKey, useAgileHotkeys } from "@/components/agile/use-agile-hotkeys";
import { BlockedBadge, DueChip, hiddenByTriage, useOpenBlockers } from "@/components/agile/agile-ui";
import { ProjectPicker } from "@/components/agile/create-project-dialog";
import { TriageInbox, useTriageQueue } from "@/components/agile/triage";

const BACKLOG = "backlog";
const sumPts = (list: Issue[]) => list.reduce((a, i) => a + (i.storyPoints ?? 0), 0);

export default function BacklogPage() {
  const issues = useCrm((s) => s.issues);
  const projects = useCrm((s) => s.projects);
  const sprints = useCrm((s) => s.sprints);
  const epics = useCrm((s) => s.epics);
  const sprintReports = useCrm((s) => s.sprintReports);
  const createIssue = useCrm((s) => s.createIssue);
  const createSprint = useCrm((s) => s.createSprint);
  const moveIssueTracked = useCrm((s) => s.moveIssueTracked);
  const captureIssues = useCrm((s) => s.captureIssues);
  const restoreIssueFields = useCrm((s) => s.restoreIssueFields);
  const openDialog = useUi((s) => s.openDialog);
  const openIssue = useUi((s) => s.openIssue);
  const notify = useUi((s) => s.notify);

  const [projectId, setProjectId] = useProjectParam(projects[0]?.id ?? "");
  const project = projects.find((p) => p.id === projectId);
  const [filter, setFilter] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [starting, setStarting] = useState<Sprint | null>(null);
  const [completing, setCompleting] = useState<Sprint | null>(null);
  const [editing, setEditing] = useState<Sprint | null>(null);
  const [triageOpen, setTriageOpen] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftType, setDraftType] = useState<IssueType>("story");
  const triage = useTriageQueue(projectId);
  const blockersOf = useOpenBlockers();

  useAgileHotkeys((e) => createIssueKey(e, projectId || undefined));

  const projectSprints = useMemo(() => sprints.filter((s) => s.projectId === projectId), [sprints, projectId]);
  const openSprints = useMemo(
    () =>
      projectSprints
        .filter((s) => s.state !== "closed")
        .sort((a, b) => (a.state === b.state ? a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name) : a.state === "active" ? -1 : 1)),
    [projectSprints],
  );
  const activeSprint = openSprints.find((s) => s.state === "active");

  /** closed sprints (newest first) with their saved report when there is one */
  const closed = useMemo(() => {
    const byId = new Map(sprintReports.map((r) => [r.sprintId, r]));
    return projectSprints
      .filter((s) => s.state === "closed")
      .sort((a, b) => b.endDate.localeCompare(a.endDate))
      .map((s) => ({ s, report: byId.get(s.id) }));
  }, [projectSprints, sprintReports]);

  /* velocity: average completed points of the last three closed sprints (sprint reports, else done issues) */
  const velocity = useMemo(() => {
    const last = closed.slice(0, 3);
    if (!last.length) return null;
    const per = last.map(({ s, report }) => report?.completed.points ?? sumPts(issues.filter((i) => i.sprintId === s.id && i.status === "done" && i.type !== "subtask")));
    return { avg: Math.round(per.reduce((a, b) => a + b, 0) / per.length), n: last.length, per, names: last.map(({ s }) => s.name) };
  }, [closed, issues]);

  const openSprintIds = useMemo(() => new Set(openSprints.map((s) => s.id)), [openSprints]);
  const needle = filter.trim().toLowerCase();
  const matches = (i: Issue) => !needle || `${i.key} ${i.summary} ${i.labels.join(" ")}`.toLowerCase().includes(needle);

  const projectIssues = useMemo(() => issues.filter((i) => i.projectId === projectId && i.type !== "subtask" && !hiddenByTriage(i)), [issues, projectId]);
  /** unplanned: no sprint, a sprint that no longer exists, or left unfinished in a closed sprint */
  const inBacklog = (i: Issue) => {
    if (!i.sprintId) return true;
    if (openSprintIds.has(i.sprintId)) return false;
    const sp = projectSprints.find((s) => s.id === i.sprintId);
    return !sp || i.status !== "done";
  };
  const listFor = (sprintId: string | null) =>
    projectIssues
      .filter((i) => (sprintId ? i.sprintId === sprintId : inBacklog(i)))
      .filter((i) => (sprintId ? true : showDone || i.status !== "done"))
      .filter(matches)
      .sort((a, b) => a.rank - b.rank);

  const backlog = listFor(null);
  const hiddenDone = projectIssues.filter((i) => !i.sprintId && i.status === "done").length;

  const onDragEnd = (r: DropResult) => {
    if (!r.destination) return;
    const issue = issues.find((i) => i.id === r.draggableId);
    if (!issue) return;
    const from = r.source.droppableId;
    const to = r.destination.droppableId;
    if (from === to && r.source.index === r.destination.index) return;
    const toSprint = to === BACKLOG ? null : to;
    // rank between the visible neighbours; issues hidden by the filter keep their place
    const dest = listFor(toSprint).filter((i) => i.id !== issue.id);
    dest.splice(r.destination.index, 0, issue);
    const patch: Partial<Issue> = from !== to ? { sprintId: toSprint } : {};
    const snap = captureIssues([issue.id]);
    // the slice moves "Backlog"-status work into To Do for the running sprint and carries sub-tasks along
    moveIssueTracked(issue.id, patch, dest.map((i) => i.id));
    if (from !== to) {
      const target = sprints.find((s) => s.id === toSprint);
      const subs = issues.filter((i) => i.parentId === issue.id).length;
      notify(`${issue.key} moved to ${target ? target.name : "the backlog"}${subs ? ` with ${subs} sub-task${subs === 1 ? "" : "s"}` : ""}`, { label: "Undo", run: () => restoreIssueFields(snap) });
    }
  };

  const addIssue = () => {
    const summary = draft.trim();
    if (!summary || !projectId) return;
    // added by the team on its own backlog — no triage needed
    const id = createIssue({ projectId, type: draftType, summary, status: "backlog", sprintId: null, ...(draftType === "deal_action" || draftType === "support_escalation" ? { triage: "accepted" as const } : {}) });
    if (!id) return;
    // createIssue ranks new work first; the backlog adds it at the bottom instead
    moveIssueTracked(id, {}, [...listFor(null).map((i) => i.id).filter((x) => x !== id), id]);
    setDraft("");
    const key = useCrm.getState().issues.find((i) => i.id === id)?.key;
    notify(`${key ?? "Issue"} added to the ${project?.key ?? ""} backlog`);
  };

  const addSprint = () => {
    const id = createSprint(projectId);
    const sp = useCrm.getState().sprints.find((s) => s.id === id);
    if (sp) notify(`${sp.name} created`);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Backlog & sprints"
        meta={
          project ? (
            <span className="flex items-center gap-1.5 text-sm text-sg-dim">
              <Dot color={project.color} /> {project.name}
            </span>
          ) : undefined
        }
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sg-dim" />
          <input data-page-filter value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter issues" aria-label="Filter issues" className="h-8 w-44 rounded border border-sg-line bg-sg-bg/60 pl-7 pr-8 text-sm text-sg-text placeholder:text-sg-dim focus:border-sg-white/60 focus:outline-none" />
          <Kbd className="absolute right-1.5 top-1/2 -translate-y-1/2">/</Kbd>
        </div>
        <ProjectPicker value={projectId} onChange={setProjectId} className="w-52" />
        <Button variant="outline" onClick={() => setTriageOpen(true)} title="Escalations and requests waiting for the team">
          <ListTodo /> Triage
          {triage.pending.length > 0 && <span className="rounded-sm bg-soft-cyan/20 px-1 text-2xs font-bold text-soft-cyan">{triage.pending.length}</span>}
        </Button>
        <Link href={`/board?project=${projectId}`} className="flex h-8 items-center rounded border border-sg-line-2 px-3 text-sm font-semibold text-sg-text hover:border-sg-white hover:text-sg-white">
          Board
        </Link>
        <Button variant="outline" onClick={addSprint} disabled={!projectId}>
          <Plus /> Create sprint
        </Button>
        <Button variant="primary" onClick={() => openDialog({ kind: "createIssue", projectId })}>
          <Plus /> Create issue <Kbd className="ml-1 border-sg-bg/30 bg-transparent text-sg-bg/70">C</Kbd>
        </Button>
      </PageHeader>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
          <div className="flex flex-col-reverse gap-4 p-4 lg:grid lg:h-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-0 lg:p-0">
            {/* ───────── left: backlog ───────── */}
            <section className="min-h-0 lg:overflow-y-auto lg:border-r lg:border-sg-line lg:p-4">
              <div className="rounded-xl border border-sg-line bg-sg-card">
                <header className="flex flex-wrap items-center gap-2 border-b border-sg-line px-4 py-2.5">
                  <Layers className="size-4 text-sg-muted" />
                  <h2 className="font-display text-sm font-extrabold text-sg-white">Backlog</h2>
                  <span className="text-2xs text-sg-dim">
                    {backlog.length} issues · <span className="sg-num">{sumPts(backlog)}</span> pts
                  </span>
                  {triage.pending.length > 0 && (
                    <button type="button" onClick={() => setTriageOpen(true)} className="text-2xs font-semibold text-soft-cyan hover:underline">
                      {triage.pending.length} waiting in triage
                    </button>
                  )}
                  <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-2xs text-sg-muted">
                    <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="size-3 accent-white" />
                    Show done{hiddenDone && !showDone ? ` (${hiddenDone})` : ""}
                  </label>
                </header>
                <Droppable droppableId={BACKLOG}>
                  {(provided, snapshot) => (
                    <div ref={provided.innerRef} {...provided.droppableProps} className={cn("min-h-[96px] p-1.5 transition-colors", snapshot.isDraggingOver && "bg-sg-card-2")}>
                      {backlog.map((issue, index) => (
                        <DraggableRow key={issue.id} issue={issue} index={index} blockers={blockersOf.get(issue.id)} onOpen={() => openIssue(issue.id)} />
                      ))}
                      {provided.placeholder}
                      {!backlog.length && (
                        <p className="px-3 py-6 text-center text-xs text-sg-dim">
                          {needle ? "No backlog issues match the filter." : projectIssues.length ? "Backlog is empty — everything is planned into a sprint. Drag issues back here to unplan them." : `No issues in ${project?.key ?? "this project"} yet. Add the first one below.`}
                        </p>
                      )}
                    </div>
                  )}
                </Droppable>
                <form
                  className="flex items-center gap-2 border-t border-sg-line px-2 py-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addIssue();
                  }}
                >
                  <Select value={draftType} onChange={(e) => setDraftType(e.target.value as IssueType)} wrapperClassName="w-28 shrink-0" aria-label="Issue type">
                    {(["story", "task", "bug", "deal_action", "support_escalation"] as IssueType[]).map((t) => (
                      <option key={t} value={t}>
                        {issueTypeMeta[t].label}
                      </option>
                    ))}
                  </Select>
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setDraft("");
                    }}
                    placeholder="+ Create issue — what needs to be done? (Enter)"
                    aria-label="New backlog issue summary"
                    className="h-8 min-w-0 flex-1 rounded border border-sg-line bg-transparent px-2.5 text-sm text-sg-text placeholder:text-sg-dim focus:border-sg-white/50 focus:outline-none"
                  />
                  <Button size="sm" variant="subtle" type="submit" disabled={!draft.trim()}>
                    Add
                  </Button>
                </form>
              </div>
            </section>

            {/* ───────── right/top: sprints ───────── */}
            <section className="min-h-0 space-y-3 lg:overflow-y-auto lg:p-4">
              <div className="flex items-center gap-2">
                <span className="sg-eyebrow">Sprints</span>
                <span className="text-2xs text-sg-dim">
                  {velocity ? (
                    <span title={velocity.names.map((n, k) => `${n}: ${velocity.per[k]} pts`).join("\n")}>
                      <TrendingUp className="mr-0.5 inline size-3" /> Velocity ≈ <span className="sg-num font-semibold text-sg-muted">{velocity.avg}</span> pts / sprint (last {velocity.n} closed)
                    </span>
                  ) : (
                    "No closed sprints yet — velocity appears after the first sprint is completed."
                  )}
                </span>
              </div>
              {openSprints.map((s) => (
                <SprintPanel
                  key={s.id}
                  sprint={s}
                  items={listFor(s.id)}
                  allItems={issues.filter((i) => i.sprintId === s.id && i.type !== "subtask")}
                  velocity={velocity?.avg ?? null}
                  blocker={s.state === "future" ? startBlocker(s, sprints) : null}
                  filtered={!!needle}
                  onStart={() => setStarting(s)}
                  onComplete={() => setCompleting(s)}
                  onEdit={() => setEditing(s)}
                  blockersOf={blockersOf}
                  onOpen={(id) => openIssue(id)}
                />
              ))}
              {!openSprints.length && (
                <div className="rounded-xl border border-dashed border-sg-line-2 bg-sg-card/40">
                  <EmptyState
                    icon={CalendarDays}
                    title={`No open sprints in ${project?.key ?? "this project"}`}
                    action={
                      <Button size="sm" variant="primary" className="mt-2" onClick={addSprint} disabled={!projectId}>
                        <Plus /> Create sprint
                      </Button>
                    }
                  >
                    Create a sprint, drag issues into it from the backlog, then start it to work from the board.
                  </EmptyState>
                </div>
              )}
              {openSprints.length > 0 && (
                <button type="button" onClick={addSprint} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-sg-line-2 text-xs font-semibold text-sg-dim hover:border-sg-white/50 hover:text-sg-white">
                  <Plus className="size-3.5" /> Create sprint
                </button>
              )}
              {closed.length > 0 && (
                <div className="rounded-xl border border-sg-line bg-sg-card">
                  <button type="button" onClick={() => setShowClosed((v) => !v)} aria-expanded={showClosed} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
                    {showClosed ? <ChevronDown className="size-3.5 text-sg-dim" /> : <ChevronRight className="size-3.5 text-sg-dim" />}
                    <History className="size-3.5 text-sg-muted" />
                    <span className="font-display text-sm font-extrabold text-sg-white">Closed sprints</span>
                    <span className="text-2xs text-sg-dim">{closed.length} · sprint reports</span>
                  </button>
                  {showClosed && (
                    <div className="space-y-2 border-t border-sg-line p-3">
                      {closed.map(({ s, report }) => (
                        <ClosedSprint key={s.id} sprint={s} report={report} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      </DragDropContext>

      {/* epics legend for orientation */}
      {epics.some((e) => e.projectId === projectId) && (
        <div className="hidden shrink-0 flex-wrap items-center gap-3 border-t border-sg-line px-5 py-1.5 text-2xs text-sg-dim lg:flex">
          <span className="sg-eyebrow">Epics</span>
          {epics
            .filter((e) => e.projectId === projectId)
            .map((e) => (
              <span key={e.id} className="flex items-center gap-1">
                <span className={cn("size-2 rounded-sm", spectrumDot[e.color])} /> {e.key} · {e.name}
              </span>
            ))}
        </div>
      )}

      <StartSprintModal sprint={starting} open={!!starting} onOpenChange={(o) => !o && setStarting(null)} />
      <CompleteSprintModal sprint={completing} open={!!completing} onOpenChange={(o) => !o && setCompleting(null)} />
      <EditSprintModal sprint={editing} open={!!editing} onOpenChange={(o) => !o && setEditing(null)} />
      <TriageInbox open={triageOpen} onOpenChange={setTriageOpen} projectId={projectId} />
    </div>
  );
}

function SprintPanel({
  sprint,
  items,
  allItems,
  velocity,
  blocker,
  filtered,
  onStart,
  onComplete,
  onEdit,
  onOpen,
  blockersOf,
}: {
  sprint: Sprint;
  items: Issue[];
  allItems: Issue[];
  velocity: number | null;
  blocker: string | null;
  filtered: boolean;
  onStart: () => void;
  onComplete: () => void;
  onEdit: () => void;
  onOpen: (id: string) => void;
  blockersOf: Map<string, Issue[]>;
}) {
  const issues = useCrm((s) => s.issues);
  const userMap = useUserMap();
  const committed = sumPts(allItems);
  const done = sumPts(allItems.filter((i) => i.status === "done"));
  const over = committed > sprint.capacity;
  const active = sprint.state === "active";
  const pctCommitted = sprint.capacity ? Math.min(100, (committed / sprint.capacity) * 100) : committed ? 100 : 0;
  const daysLeft = wibDaysUntil(sprint.endDate);
  const members = Object.entries(sprint.memberCapacity ?? {});
  const assigned = useMemo(() => assignedPoints(sprint.id, issues), [sprint.id, issues]);
  const unestimated = allItems.filter((i) => i.storyPoints == null).length;

  return (
    <div className={cn("rounded-xl border bg-sg-card", active ? "border-soft-cyan/40" : "border-sg-line")}>
      <header className="space-y-2 border-b border-sg-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-sm font-extrabold text-sg-white">{sprint.name}</h2>
          <Chip color={active ? "cyan" : "blue"} dot>
            {active ? "Active" : "Future"}
          </Chip>
          <span className="flex items-center gap-1 text-2xs text-sg-dim">
            <CalendarDays className="size-3" /> {formatDate(sprint.startDate, "short")} – {formatDate(sprint.endDate, "short")}
            {active && <span className={cn("ml-1", daysLeft < 0 ? "text-soft-red" : daysLeft <= 2 ? "text-soft-orange" : "")}>{daysLeft < 0 ? `· ${-daysLeft}d overdue` : daysLeft === 0 ? "· ends today" : `· ${daysLeft}d left`}</span>}
          </span>
          <span className="flex items-center gap-1 text-2xs text-sg-dim">
            <ListChecks className="size-3" /> {allItems.length} issues
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="icon-sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${sprint.name}`} title="Edit sprint (name, dates, goal, capacity)">
              <Pencil />
            </Button>
            {active ? (
              <Button size="sm" variant="primary" onClick={onComplete}>
                <CircleCheck /> Complete sprint
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={onStart} disabled={!!blocker} title={blocker ?? "Start this sprint"}>
                <Play /> Start sprint
              </Button>
            )}
          </div>
        </div>
        {blocker && <p className="text-2xs text-sg-dim">{blocker}</p>}
        <div className="flex items-center gap-1.5 text-xs text-sg-muted">
          <Target className="size-3.5 shrink-0 text-sg-dim" />
          {sprint.goal ? <span className="truncate">{sprint.goal}</span> : <span className="text-sg-dim">No sprint goal — set one with Edit or when you start the sprint</span>}
        </div>
        <div>
          <div className="flex h-2 overflow-hidden rounded-full bg-sg-card-3" title={`${committed} committed of ${sprint.capacity} capacity`}>
            <div className={cn("h-full", over ? "bg-soft-red" : "bg-soft-cyan")} style={{ width: `${pctCommitted}%` }} />
          </div>
          <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-2xs">
            <span className={over ? "font-semibold text-soft-red" : "text-sg-muted"}>
              <span className="sg-num">{committed}</span> / {sprint.capacity} pts committed{over ? ` · ${committed - sprint.capacity} over capacity` : ""}
              {active ? <span className="text-sg-dim"> · {done} done</span> : null}
              {unestimated > 0 && <span className="text-soft-yellow"> · {unestimated} unestimated</span>}
            </span>
            <span className={cn("flex items-center gap-1", velocity != null && committed > velocity ? "text-soft-orange" : "text-sg-dim")}>
              <Gauge className="size-3" />
              {velocity == null ? "No velocity yet" : committed > velocity ? `Above velocity (~${velocity} pts)` : `Within velocity (~${velocity} pts)`}
            </span>
          </div>
          {members.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1" aria-label="Points assigned per person against their capacity">
              {members.map(([uid, cap]) => {
                const a = assigned.get(uid) ?? 0;
                return (
                  <span key={uid} title={`${userMap.get(uid)?.name}: ${a} pts assigned of ${cap} capacity`} className={cn("flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold", a > cap ? "bg-soft-orange/15 text-soft-orange" : "bg-sg-card-3 text-sg-muted")}>
                    <Avatar user={userMap.get(uid)} size="xs" /> {userMap.get(uid)?.name.split(" ")[0]} {a}/{cap}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        {active && (
          <div className="rounded-lg border border-sg-line bg-sg-bg/40 px-3 pb-2 pt-2.5">
            <div className="sg-eyebrow mb-1">Burndown</div>
            <Burndown sprint={sprint} issues={issues} />
          </div>
        )}
      </header>
      <Droppable droppableId={sprint.id}>
        {(provided, snapshot) => (
          <div ref={provided.innerRef} {...provided.droppableProps} className={cn("min-h-[64px] p-1.5 transition-colors", snapshot.isDraggingOver && "bg-sg-card-2")}>
            {items.map((issue, index) => (
              <DraggableRow key={issue.id} issue={issue} index={index} blockers={blockersOf.get(issue.id)} onOpen={() => onOpen(issue.id)} />
            ))}
            {provided.placeholder}
            {!items.length && <p className="px-3 py-4 text-center text-xs text-sg-dim">{filtered ? "No issues in this sprint match the filter." : "Drag issues here from the backlog to plan this sprint."}</p>}
          </div>
        )}
      </Droppable>
    </div>
  );
}

/** Saved sprint report (committed / added / removed / completed / carried over). */
function ClosedSprint({ sprint, report }: { sprint: Sprint; report?: SprintReport }) {
  const sprints = useCrm((s) => s.sprints);
  const issues = useCrm((s) => s.issues);
  const userMap = useUserMap();
  if (!report) {
    const done = issues.filter((i) => i.sprintId === sprint.id && i.status === "done" && i.type !== "subtask");
    return (
      <div className="rounded-lg border border-sg-line bg-sg-bg/40 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sg-white">{sprint.name}</span>
          <span className="text-2xs text-sg-dim">
            {formatDate(sprint.startDate, "short")} – {formatDate(sprint.endDate, "short")}
          </span>
        </div>
        <p className="mt-1 text-2xs text-sg-dim">
          No saved report (closed before reports were recorded) · {done.length} done issues, {sumPts(done)} pts
        </p>
      </div>
    );
  }
  const to = report.carriedToSprintId ? sprints.find((s) => s.id === report.carriedToSprintId)?.name : "the backlog";
  const max = Math.max(1, ...report.daily.map((d) => d.remaining));
  const stat = (label: string, v: { count: number; points: number }, tone: string) => (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.1em] text-sg-dim">{label}</div>
      <div className={cn("sg-num text-sm font-bold", tone)}>{v.points} pts</div>
      <div className="text-[10px] text-sg-dim">
        {v.count} issue{v.count === 1 ? "" : "s"}
      </div>
    </div>
  );
  return (
    <div className="rounded-lg border border-sg-line bg-sg-bg/40 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-sg-white">{report.sprintName}</span>
        <span className="text-2xs text-sg-dim">
          {formatDate(report.startDate, "short")} – {formatDate(report.endDate, "short")} · closed {formatDate(report.closedAt, "short")} by {userMap.get(report.closedById)?.name ?? "someone"}
        </span>
        <span className="ml-auto text-2xs text-sg-dim">{report.committed.points ? Math.round((report.completed.points / report.committed.points) * 100) : 0}% of commitment</span>
      </div>
      <div className="mt-2 grid grid-cols-5 gap-2">
        {stat("Committed", report.committed, "text-sg-white")}
        {stat("Added", report.added, report.added.points ? "text-soft-orange" : "text-sg-muted")}
        {stat("Removed", report.removed, "text-sg-muted")}
        {stat("Completed", report.completed, "text-soft-green")}
        {stat("Carried over", report.carriedOver, report.carriedOver.points ? "text-soft-yellow" : "text-sg-muted")}
      </div>
      {report.daily.length > 1 && (
        <div className="mt-2 flex h-8 items-end gap-px" role="img" aria-label={`Remaining points per day: ${report.daily.map((d) => d.remaining).join(", ")}`}>
          {report.daily.map((d) => (
            <div key={d.day} title={`${formatDate(`${d.day}T05:00:00Z`, "short")}: ${d.remaining} pts remaining`} className="flex-1 rounded-t-sm bg-soft-cyan/50" style={{ height: `${Math.max(4, (d.remaining / max) * 100)}%` }} />
          ))}
        </div>
      )}
      {report.carriedOver.count > 0 && <p className="mt-1 text-[10px] text-sg-dim">Unfinished work went to {to ?? "a deleted sprint"}.</p>}
    </div>
  );
}

/** A backlog/sprint row; the drag handle is the row itself (one tab stop). */
function DraggableRow({ issue, index, onOpen, blockers }: { issue: Issue; index: number; onOpen: () => void; blockers?: Issue[] }) {
  return (
    <Draggable draggableId={issue.id} index={index}>
      {(p, s) => (
        <div
          ref={p.innerRef}
          {...p.draggableProps}
          {...p.dragHandleProps}
          style={p.draggableProps.style}
          aria-label={`${issue.key} ${issue.summary}`}
          onClick={onOpen}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onOpen();
            }
          }}
          className="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/60"
        >
          <BacklogRow issue={issue} dragging={s.isDragging} blockers={blockers} />
        </div>
      )}
    </Draggable>
  );
}

function BacklogRow({ issue, dragging, blockers }: { issue: Issue; dragging: boolean; blockers?: Issue[] }) {
  const userMap = useUserMap();
  const epics = useCrm((s) => s.epics);
  const epic = epics.find((e) => e.id === issue.epicId);
  const T = issueTypeMeta[issue.type].icon;
  const P = priorityMeta[issue.priority].icon;
  return (
    <div className={cn("flex h-9 cursor-pointer items-center gap-2 rounded-md border px-2 text-sm transition-colors hover:bg-sg-card-2", dragging ? "border-sg-white/50 bg-sg-card-2 shadow-pop" : "border-transparent")}>
      <T className={cn("size-3.5 shrink-0", softText[issueTypeMeta[issue.type].color])} aria-label={issueTypeMeta[issue.type].label} />
      <span className="w-16 shrink-0 text-2xs font-semibold text-sg-dim">{issue.key}</span>
      <span className={cn("min-w-0 flex-1 truncate", issue.status === "done" ? "text-sg-dim line-through" : "text-sg-text")}>{issue.summary}</span>
      {issue.status !== "done" && <BlockedBadge blockers={blockers} />}
      {issue.status !== "done" && <DueChip issue={issue} compact className="hidden sm:inline-flex" />}
      {epic && (
        <span className={cn("hidden max-w-[140px] shrink-0 items-center gap-1 truncate rounded-sm bg-sg-card-3 px-1.5 py-0.5 text-[10px] font-semibold xl:inline-flex", softText[epic.color])}>
          <span className={cn("size-1.5 shrink-0 rounded-sm", spectrumDot[epic.color])} />
          <span className="truncate">{epic.name}</span>
        </span>
      )}
      <span className={cn("hidden w-[74px] shrink-0 truncate text-right text-2xs md:block", softText[issueStatusMeta[issue.status].color])}>{issueStatusMeta[issue.status].label}</span>
      <P className={cn("size-3.5 shrink-0", softText[priorityMeta[issue.priority].color])} aria-label={priorityMeta[issue.priority].label} />
      <span className="sg-num w-6 shrink-0 rounded-full bg-sg-card-3 text-center text-[10px] font-bold text-sg-muted" title="Story points">
        {issue.storyPoints ?? "–"}
      </span>
      <Avatar user={issue.assigneeId ? userMap.get(issue.assigneeId) : null} size="xs" />
    </div>
  );
}
