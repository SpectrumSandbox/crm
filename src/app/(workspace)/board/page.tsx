"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { Handshake, ListTree, OctagonAlert, Plus, Search, Target, Ticket } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useStageMap, useUserMap } from "@/lib/selectors";
import { ISSUE_STATUSES, type Issue, type IssueStatus, type SpectrumColor } from "@/lib/types";
import { issueStatusMeta, issueTypeMeta, priorityMeta } from "@/lib/meta";
import { cn, daysFromNow, formatIDR, softText, spectrumDot } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Avatar, Dot, Kbd } from "@/components/ui/misc";

type GroupBy = "status" | "sprint" | "dealStage";
type Swimlane = "none" | "epic" | "assignee" | "account";
type Scope = "active" | "all" | string; // string = sprint id

interface ColumnDef {
  id: string;
  label: string;
  color: SpectrumColor;
  hint?: string;
}
interface LaneDef {
  id: string;
  label: string;
  color?: SpectrumColor;
  avatar?: string;
}

const NONE = "__none__";

export default function BoardPage() {
  const params = useSearchParams();
  const issues = useCrm((s) => s.issues);
  const projects = useCrm((s) => s.projects);
  const sprints = useCrm((s) => s.sprints);
  const epics = useCrm((s) => s.epics);
  const users = useCrm((s) => s.users);
  const crossLinks = useCrm((s) => s.crossLinks);
  const deals = useCrm((s) => s.deals);
  const companies = useCrm((s) => s.companies);
  const pipelines = useCrm((s) => s.pipelines);
  const currentUserId = useCrm((s) => s.currentUserId);
  const moveIssue = useCrm((s) => s.moveIssue);
  const moveDeal = useCrm((s) => s.moveDeal);
  const openIssue = useUi((s) => s.openIssue);
  const openDialog = useUi((s) => s.openDialog);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const stageMap = useStageMap();

  const [projectId, setProjectId] = useState<string>("all");
  const [scope, setScope] = useState<Scope>("active");
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [lane, setLane] = useState<Swimlane>("none");
  const [q, setQ] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyCrm, setOnlyCrm] = useState(false);
  const [onlyBlocking, setOnlyBlocking] = useState(false);
  const [showSubtasks, setShowSubtasks] = useState(false);

  // deep link: /board?issue=UAV-102
  useEffect(() => {
    const key = params.get("issue");
    if (!key) return;
    const found = issues.find((i) => i.key.toLowerCase() === key.toLowerCase());
    if (found) openIssue(found.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  /* derived link info per issue */
  const linkInfo = useMemo(() => {
    const m = new Map<string, { dealId?: string; ticketIds: string[]; companyIds: Set<string>; blocks: boolean }>();
    crossLinks.forEach((x) => {
      if (x.agileType !== "issue") return;
      const info = m.get(x.agileId) ?? { ticketIds: [], companyIds: new Set<string>(), blocks: false };
      if (x.crmType === "deal") {
        info.dealId ??= x.crmId;
        const d = deals.find((dd) => dd.id === x.crmId);
        if (d?.companyId) info.companyIds.add(d.companyId);
        if (x.linkType === "blocks") info.blocks = true;
      }
      if (x.crmType === "ticket") {
        info.ticketIds.push(x.crmId);
      }
      if (x.crmType === "company") info.companyIds.add(x.crmId);
      m.set(x.agileId, info);
    });
    return m;
  }, [crossLinks, deals]);

  const activeSprintIds = useMemo(() => new Set(sprints.filter((s) => s.state === "active").map((s) => s.id)), [sprints]);
  const projectSprints = sprints.filter((s) => (projectId === "all" || s.projectId === projectId) && s.state !== "closed");

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return issues.filter((i) => {
      if (projectId !== "all" && i.projectId !== projectId) return false;
      if (!showSubtasks && i.type === "subtask") return false;
      if (scope === "active" && groupBy !== "sprint" && !(i.sprintId && activeSprintIds.has(i.sprintId))) return false;
      if (scope !== "active" && scope !== "all" && i.sprintId !== scope) return false;
      if (groupBy === "sprint") {
        const sp = sprints.find((s) => s.id === i.sprintId);
        if (sp?.state === "closed") return false;
      }
      if (onlyMine && i.assigneeId !== currentUserId && i.reporterId !== currentUserId) return false;
      if (onlyCrm && !linkInfo.has(i.id)) return false;
      if (onlyBlocking && !linkInfo.get(i.id)?.blocks) return false;
      if (needle && !`${i.key} ${i.summary} ${i.labels.join(" ")}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [issues, projectId, scope, groupBy, q, onlyMine, onlyCrm, onlyBlocking, showSubtasks, activeSprintIds, sprints, currentUserId, linkInfo]);

  const newBusiness = pipelines.find((p) => p.id === "pl-new");
  const renewals = pipelines.find((p) => p.id === "pl-renew");

  const columns: ColumnDef[] = useMemo(() => {
    if (groupBy === "sprint") {
      return [
        ...projectSprints
          .slice()
          .sort((a, b) => (a.state === b.state ? a.startDate.localeCompare(b.startDate) : a.state === "active" ? -1 : 1))
          .map((s) => ({ id: s.id, label: s.name, color: (s.state === "active" ? "cyan" : "blue") as SpectrumColor, hint: s.state === "active" ? `ends in ${daysFromNow(s.endDate)}d` : "future" })),
        { id: NONE, label: "Backlog", color: "magenta" as SpectrumColor },
      ];
    }
    if (groupBy === "dealStage") {
      const stages = [...(newBusiness?.stages ?? []), ...(renewals?.stages ?? [])].filter((s) => !s.closed || s.closed === "won");
      return [{ id: NONE, label: "No linked deal", color: "blue" as SpectrumColor }, ...stages.map((s) => ({ id: s.id, label: s.name, color: s.color, hint: `${Math.round(s.probability * 100)}%` }))];
    }
    return ISSUE_STATUSES.filter((s) => s !== "backlog" || scope === "all").map((s) => ({ id: s, label: issueStatusMeta[s].label, color: issueStatusMeta[s].color }));
  }, [groupBy, projectSprints, newBusiness, renewals, scope]);

  const columnOf = (i: Issue): string => {
    if (groupBy === "sprint") return i.sprintId ?? NONE;
    if (groupBy === "dealStage") {
      const dealId = linkInfo.get(i.id)?.dealId;
      return dealId ? deals.find((d) => d.id === dealId)?.stageId ?? NONE : NONE;
    }
    return i.status;
  };

  const laneOf = (i: Issue): string => {
    if (lane === "epic") return i.epicId ?? NONE;
    if (lane === "assignee") return i.assigneeId ?? NONE;
    if (lane === "account") return [...(linkInfo.get(i.id)?.companyIds ?? [])][0] ?? NONE;
    return "all";
  };

  const lanes: LaneDef[] = useMemo(() => {
    if (lane === "none") return [{ id: "all", label: "" }];
    const present = new Set(visible.map(laneOf));
    let defs: LaneDef[] = [];
    if (lane === "epic") defs = epics.filter((e) => present.has(e.id)).map((e) => ({ id: e.id, label: `${e.key} · ${e.name}`, color: e.color }));
    if (lane === "assignee") defs = users.filter((u) => present.has(u.id)).map((u) => ({ id: u.id, label: u.name, avatar: u.id }));
    if (lane === "account") defs = companies.filter((c) => present.has(c.id)).map((c) => ({ id: c.id, label: c.name }));
    if (present.has(NONE)) defs.push({ id: NONE, label: lane === "epic" ? "No epic" : lane === "assignee" ? "Unassigned" : "No customer account" });
    return defs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lane, visible, epics, users, companies, linkInfo]);

  const cell = (laneId: string, colId: string) =>
    visible
      .filter((i) => (lane === "none" || laneOf(i) === laneId) && columnOf(i) === colId)
      .sort((a, b) => a.rank - b.rank || priorityMeta[b.priority].weight - priorityMeta[a.priority].weight);

  const onDragEnd = (r: DropResult) => {
    if (!r.destination) return;
    const [toLane, toCol] = r.destination.droppableId.split("::");
    const [fromLane, fromCol] = r.source.droppableId.split("::");
    const issue = issues.find((i) => i.id === r.draggableId);
    if (!issue) return;
    if (toLane === fromLane && toCol === fromCol && r.destination.index === r.source.index) return;

    const patch: Partial<Issue> = {};
    if (toCol !== fromCol) {
      if (groupBy === "status") patch.status = toCol as IssueStatus;
      if (groupBy === "sprint") patch.sprintId = toCol === NONE ? null : toCol;
      if (groupBy === "dealStage") {
        const dealId = linkInfo.get(issue.id)?.dealId;
        if (!dealId || toCol === NONE) {
          notify(dealId ? "Unlink the deal from the issue drawer instead" : `${issue.key} has no linked deal — link one first`);
          return;
        }
        const deal = deals.find((d) => d.id === dealId);
        const target = stageMap.get(toCol);
        if (deal && target && target.pipelineId !== deal.pipelineId) {
          notify(`${deal.name.split(" — ")[0]} is in a different pipeline`);
          return;
        }
        moveDeal(dealId, toCol);
        notify(`Deal moved to ${target?.name ?? "stage"} from the board`);
      }
    }
    if (toLane !== fromLane) {
      if (lane === "epic") patch.epicId = toLane === NONE ? null : toLane;
      if (lane === "assignee") patch.assigneeId = toLane === NONE ? null : toLane;
      if (lane === "account") {
        notify("Customer account comes from CRM links — link a record to change it");
        if (toCol === fromCol) return;
      }
    }
    // re-rank the destination cell in its new visual order
    const dest = cell(toLane, toCol).filter((i) => i.id !== issue.id);
    dest.splice(r.destination.index, 0, issue);
    moveIssue(issue.id, patch, dest.map((i) => i.id));
  };

  /* sprint header for the active scope */
  const focusSprints = scope === "active" ? sprints.filter((s) => s.state === "active" && (projectId === "all" || s.projectId === projectId)) : sprints.filter((s) => s.id === scope);
  const sprintStats = focusSprints.map((s) => {
    const its = issues.filter((i) => i.sprintId === s.id && i.type !== "subtask");
    const total = its.reduce((a, i) => a + (i.storyPoints ?? 0), 0);
    const done = its.filter((i) => i.status === "done").reduce((a, i) => a + (i.storyPoints ?? 0), 0);
    const inProgress = its.filter((i) => i.status === "in_progress" || i.status === "in_review").reduce((a, i) => a + (i.storyPoints ?? 0), 0);
    return { s, total, done, inProgress, daysLeft: daysFromNow(s.endDate) };
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Agile Board">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sg-dim" />
          <input data-page-filter value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter issues" className="h-8 w-48 rounded border border-sg-line bg-sg-bg/60 pl-7 pr-8 text-sm text-sg-text placeholder:text-sg-dim focus:border-sg-white/60 focus:outline-none" />
          <Kbd className="absolute right-1.5 top-1/2 -translate-y-1/2">/</Kbd>
        </div>
        <Select
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            if (scope !== "active" && scope !== "all") setScope("active");
          }}
          wrapperClassName="w-48"
        >
          <option value="all">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} · {p.name}
            </option>
          ))}
        </Select>
        <Select value={scope} onChange={(e) => setScope(e.target.value)} wrapperClassName="w-44" disabled={groupBy === "sprint"}>
          <option value="active">Active sprints</option>
          <option value="all">All open work</option>
          {projectSprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Button variant="primary" onClick={() => openDialog({ kind: "createIssue", projectId: projectId === "all" ? undefined : projectId })}>
          <Plus /> Create issue <Kbd className="ml-1 border-sg-bg/30 bg-transparent text-sg-bg/70">C</Kbd>
        </Button>
      </PageHeader>

      {/* configuration bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-sg-line px-5 py-2 text-xs">
        <Segmented
          label="Columns"
          value={groupBy}
          onChange={(v) => setGroupBy(v)}
          options={[
            { value: "status", label: "Status" },
            { value: "sprint", label: "Sprint" },
            { value: "dealStage", label: "Deal stage" },
          ]}
        />
        <Segmented
          label="Swimlanes"
          value={lane}
          onChange={(v) => setLane(v)}
          options={[
            { value: "none", label: "None" },
            { value: "epic", label: "Epic" },
            { value: "assignee", label: "Assignee" },
            { value: "account", label: "Customer" },
          ]}
        />
        <div className="flex flex-wrap items-center gap-1">
          <Toggle on={onlyMine} onClick={() => setOnlyMine((v) => !v)}>
            My issues
          </Toggle>
          <Toggle on={onlyCrm} onClick={() => setOnlyCrm((v) => !v)}>
            CRM-linked
          </Toggle>
          <Toggle on={onlyBlocking} onClick={() => setOnlyBlocking((v) => !v)}>
            Blocking deals
          </Toggle>
          <Toggle on={showSubtasks} onClick={() => setShowSubtasks((v) => !v)}>
            Sub-tasks
          </Toggle>
        </div>
        <span className="ml-auto text-sg-dim">{visible.length} issues</span>
      </div>

      {groupBy !== "sprint" && sprintStats.length > 0 && (
        <div className="flex shrink-0 gap-3 overflow-x-auto border-b border-sg-line px-5 py-2.5">
          {sprintStats.map(({ s, total, done, inProgress, daysLeft }) => {
            const project = projects.find((p) => p.id === s.projectId);
            const over = total > s.capacity;
            return (
              <div key={s.id} className="min-w-[280px] flex-1 rounded-lg border border-sg-line bg-sg-card px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  {project && <Dot color={project.color} />}
                  <span className="font-bold text-sg-white">{s.name}</span>
                  <span className={cn("ml-auto", daysLeft < 0 ? "text-soft-red" : daysLeft <= 2 ? "text-soft-orange" : "text-sg-dim")}>{daysLeft < 0 ? `${-daysLeft}d over` : `${daysLeft}d left`}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1 truncate text-2xs text-sg-dim">
                  <Target className="size-3 shrink-0" /> {s.goal}
                </div>
                <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-sg-card-3" title={`${done} done · ${inProgress} in progress · ${total} committed · capacity ${s.capacity}`}>
                  <div className="bg-soft-green" style={{ width: `${(done / Math.max(total, s.capacity)) * 100}%` }} />
                  <div className="bg-soft-cyan" style={{ width: `${(inProgress / Math.max(total, s.capacity)) * 100}%` }} />
                </div>
                <div className="mt-1 flex justify-between text-2xs">
                  <span className="text-sg-muted">
                    <span className="font-semibold text-soft-green">{done}</span> / {total} pts done
                  </span>
                  <span className={over ? "font-semibold text-soft-orange" : "text-sg-dim"}>
                    {total}/{s.capacity} capacity{over ? " · over-committed" : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="min-w-max p-4">
            {/* column headers */}
            <div className="sticky top-0 z-10 -mt-4 flex gap-3 bg-sg-bg pb-2 pt-4">
              {columns.map((c) => {
                const items = visible.filter((i) => columnOf(i) === c.id);
                const pts = items.reduce((a, i) => a + (i.storyPoints ?? 0), 0);
                return (
                  <div key={c.id} className="flex w-[280px] shrink-0 items-center gap-2 rounded-lg border border-sg-line bg-sg-card px-3 py-2">
                    <span className={cn("size-2 rounded-full", spectrumDot[c.color])} />
                    <span className="truncate text-xs font-bold uppercase tracking-[0.08em] text-sg-white">{c.label}</span>
                    {c.hint && <span className="text-2xs text-sg-dim">{c.hint}</span>}
                    <span className="ml-auto text-2xs text-sg-dim">{pts} pts</span>
                    <span className="rounded-sm bg-sg-card-3 px-1.5 text-2xs font-semibold text-sg-muted">{items.length}</span>
                  </div>
                );
              })}
            </div>

            {lanes.map((l) => (
              <div key={l.id} className="mb-3">
                {lane !== "none" && (
                  <div className="sticky left-0 mb-2 flex w-max items-center gap-2 px-1 text-xs font-semibold text-sg-muted">
                    {l.color && <span className={cn("size-2 rounded-sm", spectrumDot[l.color])} />}
                    {l.avatar && <Avatar user={userMap.get(l.avatar)} size="xs" />}
                    {l.label}
                    <span className="text-sg-dim">({visible.filter((i) => laneOf(i) === l.id).length})</span>
                  </div>
                )}
                <div className="flex gap-3">
                  {columns.map((c) => {
                    const items = cell(l.id, c.id);
                    return (
                      <Droppable key={c.id} droppableId={`${l.id}::${c.id}`}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={cn("flex w-[280px] shrink-0 flex-col gap-2 rounded-lg p-1.5 transition-colors", lane === "none" ? "min-h-[60vh]" : "min-h-[72px]", snapshot.isDraggingOver ? "bg-sg-card-2" : "bg-sg-card/40")}
                          >
                            {items.map((issue, index) => (
                              <Draggable key={issue.id} draggableId={issue.id} index={index}>
                                {(p, s) => (
                                  <div ref={p.innerRef} {...p.draggableProps} {...p.dragHandleProps} style={p.draggableProps.style}>
                                    <IssueCard issue={issue} dragging={s.isDragging} info={linkInfo.get(issue.id)} onOpen={() => openIssue(issue.id)} />
                                  </div>
                                )}
                              </Draggable>
                            ))}
                            {provided.placeholder}
                            {groupBy === "status" && lane === "none" && c.id !== "done" && (
                              <button type="button" onClick={() => openDialog({ kind: "createIssue", status: c.id as IssueStatus, projectId: projectId === "all" ? undefined : projectId })} className="flex h-8 items-center gap-1.5 rounded px-2 text-xs text-sg-dim hover:bg-sg-card-2 hover:text-sg-white">
                                <Plus className="size-3.5" /> Create issue
                              </button>
                            )}
                          </div>
                        )}
                      </Droppable>
                    );
                  })}
                </div>
              </div>
            ))}
            {!visible.length && <p className="py-16 text-center text-sm text-sg-muted">No issues match. Try “All open work” or clear the quick filters.</p>}
          </div>
        </div>
      </DragDropContext>
    </div>
  );
}

function IssueCard({ issue, dragging, info, onOpen }: { issue: Issue; dragging: boolean; info?: { dealId?: string; ticketIds: string[]; blocks: boolean }; onOpen: () => void }) {
  const userMap = useUserMap();
  const epics = useCrm((s) => s.epics);
  const deals = useCrm((s) => s.deals);
  const issues = useCrm((s) => s.issues);
  const epic = epics.find((e) => e.id === issue.epicId);
  const deal = info?.dealId ? deals.find((d) => d.id === info.dealId) : undefined;
  const subtasks = issues.filter((i) => i.parentId === issue.id);
  const TypeIcon = issueTypeMeta[issue.type].icon;
  const PrioIcon = priorityMeta[issue.priority].icon;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className={cn(
        "cursor-pointer rounded-md border bg-sg-card p-2.5 transition-[border-color,box-shadow] hover:border-sg-line-2",
        info?.blocks && issue.status !== "done" ? "border-soft-red/40" : "border-sg-line",
        dragging && "rotate-[1.5deg] border-sg-white/50 shadow-pop",
      )}
    >
      <p className={cn("line-clamp-3 text-sm leading-snug text-sg-text", issue.status === "done" && "text-sg-dim line-through")}>{issue.summary}</p>
      {epic && (
        <span className={cn("mt-2 inline-flex max-w-full items-center gap-1 truncate rounded-sm px-1.5 py-0.5 text-[10px] font-semibold", softText[epic.color], "bg-sg-card-3")}>
          <span className={cn("size-1.5 rounded-sm", spectrumDot[epic.color])} />
          {epic.name}
        </span>
      )}
      {(deal || (info?.ticketIds.length ?? 0) > 0) && (
        <div className="mt-2 space-y-1">
          {deal && (
            <div className={cn("flex items-center gap-1 truncate rounded-sm px-1.5 py-1 text-2xs", info?.blocks && issue.status !== "done" ? "bg-soft-red/10 text-soft-red" : "bg-soft-yellow/10 text-soft-yellow")}>
              {info?.blocks && issue.status !== "done" ? <OctagonAlert className="size-3 shrink-0" /> : <Handshake className="size-3 shrink-0" />}
              <span className="truncate">{deal.name.split(" — ")[0]} · {formatIDR(deal.amount)}</span>
            </div>
          )}
          {(info?.ticketIds.length ?? 0) > 0 && (
            <div className="flex items-center gap-1 truncate rounded-sm bg-soft-orange/10 px-1.5 py-1 text-2xs text-soft-orange">
              <Ticket className="size-3 shrink-0" /> {info!.ticketIds.map((t) => t.toUpperCase()).join(", ")}
            </div>
          )}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <TypeIcon className={cn("size-3.5", softText[issueTypeMeta[issue.type].color])} aria-label={issueTypeMeta[issue.type].label} />
        <span className="text-2xs font-semibold text-sg-dim">{issue.key}</span>
        {subtasks.length > 0 && (
          <span className="flex items-center gap-0.5 text-2xs text-sg-dim">
            <ListTree className="size-3" />
            {subtasks.filter((s) => s.status === "done").length}/{subtasks.length}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <PrioIcon className={cn("size-3.5", softText[priorityMeta[issue.priority].color])} aria-label={priorityMeta[issue.priority].label} />
          {issue.storyPoints != null && <span className="min-w-[18px] rounded-full bg-sg-card-3 px-1.5 text-center text-[10px] font-bold text-sg-muted">{issue.storyPoints}</span>}
          <Avatar user={issue.assigneeId ? userMap.get(issue.assigneeId) : null} size="xs" />
        </span>
      </div>
    </div>
  );
}

function Segmented<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex items-center gap-2">
      <span className="sg-eyebrow">{label}</span>
      <div className="flex rounded border border-sg-line p-0.5">
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => onChange(o.value)} className={cn("h-6 rounded-sm px-2 text-xs font-semibold", value === o.value ? "bg-sg-card-3 text-sg-white" : "text-sg-muted hover:text-sg-white")}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("h-6 rounded-pill border px-2.5 text-xs font-semibold transition-colors", on ? "border-sg-white bg-sg-white text-sg-bg" : "border-sg-line text-sg-muted hover:border-sg-line-2 hover:text-sg-white")}>
      {children}
    </button>
  );
}
