"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { Gauge, Handshake, Kanban, Keyboard, ListTree, OctagonAlert, Plus, Target, Ticket, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useStageMap, useUserMap } from "@/lib/selectors";
import { ISSUE_STATUSES, type Issue, type IssueStatus, type SpectrumColor } from "@/lib/types";
import { issueStatusMeta, issueTypeMeta, priorityMeta } from "@/lib/meta";
import { cn, daysFromNow, formatIDR, softText, spectrumDot } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Avatar, Dot, EmptyState, Kbd } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { JqlBar, useJql, useUrlQuery } from "@/components/agile/jql-bar";
import { Burndown } from "@/components/agile/burndown";
import { useProjectParam } from "@/components/agile/project-param";
import { createIssueKey, useAgileHotkeys } from "@/components/agile/use-agile-hotkeys";

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

/* ───────────── WIP limits (localStorage, per project selection) ───────────── */

type WipStatus = "in_progress" | "in_review";
type WipLimits = Partial<Record<WipStatus, number>>;
const WIP_STATUSES: WipStatus[] = ["in_progress", "in_review"];
const wipKey = (projectId: string) => `sg-board-wip:${projectId}`;

function readWip(projectId: string): WipLimits {
  try {
    const raw = window.localStorage.getItem(wipKey(projectId));
    const v = raw ? (JSON.parse(raw) as WipLimits) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function useWipLimits(projectId: string): [WipLimits, (status: WipStatus, limit: number | null) => void] {
  const [limits, setLimits] = useState<WipLimits>({});
  useEffect(() => setLimits(readWip(projectId)), [projectId]);
  const set = (status: WipStatus, limit: number | null) => {
    const next = { ...limits };
    if (limit && limit > 0) next[status] = Math.round(limit);
    else delete next[status];
    setLimits(next);
    try {
      window.localStorage.setItem(wipKey(projectId), JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  return [limits, set];
}

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
  const moveIssueTracked = useCrm((s) => s.moveIssueTracked);
  const moveDeal = useCrm((s) => s.moveDeal);
  const openIssue = useUi((s) => s.openIssue);
  const openDialog = useUi((s) => s.openDialog);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const stageMap = useStageMap();

  const [scope, setScope] = useState<Scope>("active");
  const [projectId, setProjectId] = useProjectParam("all", (pid) => {
    // linked from the ongoing-projects register: show all open work when there's no active sprint
    if (!sprints.some((s) => s.projectId === pid && s.state === "active")) setScope("all");
    else setScope((cur) => (cur === "active" || cur === "all" ? cur : "active"));
  });
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [lane, setLane] = useState<Swimlane>("none");
  const [q, setQ] = useUrlQuery();
  const jql = useJql(q);
  const [epicFilter, setEpicFilter] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyCrm, setOnlyCrm] = useState(false);
  const [onlyBlocking, setOnlyBlocking] = useState(false);
  const [showSubtasks, setShowSubtasks] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [wip, setWip] = useWipLimits(projectId);

  // deep link: /board?issue=UAV-102
  const issueParam = params.get("issue");
  useEffect(() => {
    if (!issueParam) return;
    const found = issues.find((i) => i.key.toLowerCase() === issueParam.toLowerCase());
    if (found) openIssue(found.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueParam]);

  useEffect(() => {
    if (epicFilter && projectId !== "all" && epics.find((e) => e.id === epicFilter)?.projectId !== projectId) setEpicFilter(null);
  }, [projectId, epicFilter, epics]);

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

  const project = projects.find((p) => p.id === projectId);
  const projectIssueCount = useMemo(() => (projectId === "all" ? issues.length : issues.filter((i) => i.projectId === projectId).length), [issues, projectId]);
  const activeSprintIds = useMemo(() => new Set(sprints.filter((s) => s.state === "active").map((s) => s.id)), [sprints]);
  const selectionHasActiveSprint = sprints.some((s) => s.state === "active" && (projectId === "all" || s.projectId === projectId));
  const projectSprints = sprints.filter((s) => (projectId === "all" || s.projectId === projectId) && s.state !== "closed");

  /** everything except the epic filter — feeds the epic strip */
  const baseVisible = useMemo(() => {
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
      if (jql.active && !jql.match(i)) return false;
      return true;
    });
  }, [issues, projectId, scope, groupBy, jql, onlyMine, onlyCrm, onlyBlocking, showSubtasks, activeSprintIds, sprints, currentUserId, linkInfo]);

  const visible = useMemo(() => (epicFilter ? baseVisible.filter((i) => i.epicId === epicFilter) : baseVisible), [baseVisible, epicFilter]);

  /* epic progress strip: epics present on the board, progress over the whole epic */
  const epicStrip = useMemo(() => {
    const present = new Set(baseVisible.map((i) => i.epicId).filter((x): x is string => !!x));
    if (epicFilter) present.add(epicFilter);
    return epics
      .filter((e) => present.has(e.id))
      .map((e) => {
        const its = issues.filter((i) => i.epicId === e.id && i.type !== "subtask");
        const done = its.filter((i) => i.status === "done");
        const pts = its.reduce((a, i) => a + (i.storyPoints ?? 0), 0);
        const donePts = done.reduce((a, i) => a + (i.storyPoints ?? 0), 0);
        return { e, total: its.length, done: done.length, pts, donePts };
      });
  }, [baseVisible, epics, issues, epicFilter]);

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

  /** column → issues top-to-bottom across lanes (keyboard navigation order) */
  const navColumns = columns.map((c) => lanes.flatMap((l) => cell(l.id, c.id)));

  const wipState = (status: string, count: number): "ok" | "at" | "over" => {
    const limit = groupBy === "status" ? wip[status as WipStatus] : undefined;
    if (!limit) return "ok";
    return count > limit ? "over" : count === limit ? "at" : "ok";
  };
  const warnWip = (status: IssueStatus, addingTo: number) => {
    const limit = groupBy === "status" ? wip[status as WipStatus] : undefined;
    if (limit && addingTo + 1 > limit) notify(`${issueStatusMeta[status].label} is over its WIP limit (${addingTo + 1}/${limit})`);
  };

  const onDragEnd = (r: DropResult) => {
    if (!r.destination) return;
    const [toLane, toCol] = r.destination.droppableId.split("::");
    const [fromLane, fromCol] = r.source.droppableId.split("::");
    const issue = issues.find((i) => i.id === r.draggableId);
    if (!issue) return;
    if (toLane === fromLane && toCol === fromCol && r.destination.index === r.source.index) return;

    const patch: Partial<Issue> = {};
    if (toCol !== fromCol) {
      if (groupBy === "status") {
        patch.status = toCol as IssueStatus;
        warnWip(toCol as IssueStatus, visible.filter((i) => i.status === toCol).length);
      }
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
    moveIssueTracked(issue.id, patch, dest.map((i) => i.id));
    setFocusedId(issue.id);
  };

  /* ───────────── keyboard navigation ───────────── */

  const statusOrder: IssueStatus[] = groupBy === "status" ? (columns.map((c) => c.id) as IssueStatus[]) : ISSUE_STATUSES.filter((s) => s !== "backlog" || scope === "all");

  const shiftStatus = (issue: Issue, dir: 1 | -1) => {
    const idx = statusOrder.indexOf(issue.status);
    const next = idx < 0 ? (dir === 1 ? statusOrder[0] : undefined) : statusOrder[idx + dir];
    if (!next) {
      notify(dir === 1 ? `${issue.key} is already in the last column` : `${issue.key} is already in the first column`);
      return;
    }
    const destList =
      groupBy === "status"
        ? cell(laneOf(issue), next).filter((i) => i.id !== issue.id)
        : visible.filter((i) => i.status === next && i.id !== issue.id).sort((a, b) => a.rank - b.rank);
    warnWip(next, visible.filter((i) => i.status === next && i.id !== issue.id).length);
    moveIssueTracked(issue.id, { status: next }, [...destList.map((i) => i.id), issue.id]);
    notify(`${issue.key} → ${issueStatusMeta[next].label}`);
  };

  useAgileHotkeys((e) => {
    if (createIssueKey(e, projectId === "all" ? undefined : projectId)) return true;
    const pos = (() => {
      if (!focusedId) return null;
      for (let c = 0; c < navColumns.length; c++) {
        const r = navColumns[c]!.findIndex((i) => i.id === focusedId);
        if (r >= 0) return { c, r };
      }
      return null;
    })();
    const firstFocus = () => {
      const c = navColumns.findIndex((col) => col.length > 0);
      if (c >= 0) setFocusedId(navColumns[c]![0]!.id);
    };
    const k = e.key;
    if (!e.shiftKey && (k === "j" || k === "k" || k === "h" || k === "l")) {
      if (!pos) {
        firstFocus();
        return true;
      }
      if (k === "j" || k === "k") {
        const col = navColumns[pos.c]!;
        const r = Math.min(col.length - 1, Math.max(0, pos.r + (k === "j" ? 1 : -1)));
        setFocusedId(col[r]!.id);
      } else {
        const dir = k === "l" ? 1 : -1;
        for (let c = pos.c + dir; c >= 0 && c < navColumns.length; c += dir) {
          const col = navColumns[c]!;
          if (col.length) {
            setFocusedId(col[Math.min(pos.r, col.length - 1)]!.id);
            break;
          }
        }
      }
      return true;
    }
    if (k === "Enter" && pos) {
      const t = e.target as HTMLElement | null;
      if (t && t !== document.body && !t.hasAttribute("data-issue-card")) return false;
      openIssue(focusedId);
      return true;
    }
    if (e.shiftKey && (k === "ArrowRight" || k === "ArrowLeft") && pos) {
      const issue = issues.find((i) => i.id === focusedId);
      if (issue) shiftStatus(issue, k === "ArrowRight" ? 1 : -1);
      return true;
    }
    if (k === "Escape" && focusedId) {
      setFocusedId(null);
      return true;
    }
    return false;
  });

  useEffect(() => {
    if (!focusedId) return;
    document.querySelector<HTMLElement>(`[data-issue-card="${focusedId}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusedId]);

  /* sprint header for the active scope */
  const focusSprints = scope === "active" ? sprints.filter((s) => s.state === "active" && (projectId === "all" || s.projectId === projectId)) : sprints.filter((s) => s.id === scope);
  const sprintStats = focusSprints.map((s) => {
    const its = issues.filter((i) => i.sprintId === s.id && i.type !== "subtask");
    const total = its.reduce((a, i) => a + (i.storyPoints ?? 0), 0);
    const done = its.filter((i) => i.status === "done").reduce((a, i) => a + (i.storyPoints ?? 0), 0);
    const inProgress = its.filter((i) => i.status === "in_progress" || i.status === "in_review").reduce((a, i) => a + (i.storyPoints ?? 0), 0);
    return { s, total, done, inProgress, daysLeft: daysFromNow(s.endDate) };
  });

  const filtersOn = jql.active || onlyMine || onlyCrm || onlyBlocking || !!epicFilter;
  const clearFilters = () => {
    setQ("");
    setOnlyMine(false);
    setOnlyCrm(false);
    setOnlyBlocking(false);
    setEpicFilter(null);
  };
  const backlogHref = `/backlog${projectId !== "all" ? `?project=${projectId}` : ""}`;
  const projectEmpty = projectId !== "all" && projectIssueCount === 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Agile Board" meta={project ? <span className="text-sm text-sg-dim">{project.name}</span> : undefined}>
        <Select
          value={projectId}
          onChange={(e) => {
            const pid = e.target.value;
            setProjectId(pid);
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
        <Link href={backlogHref} className="flex h-8 items-center rounded border border-sg-line-2 px-3 text-sm font-semibold text-sg-text hover:border-sg-white hover:text-sg-white">
          Backlog
        </Link>
        <Button variant="primary" onClick={() => openDialog({ kind: "createIssue", projectId: projectId === "all" ? undefined : projectId })}>
          <Plus /> Create issue <Kbd className="ml-1 border-sg-bg/30 bg-transparent text-sg-bg/70">C</Kbd>
        </Button>
      </PageHeader>

      {/* query + configuration bar */}
      <div className="shrink-0 space-y-2 border-b border-sg-line px-5 py-2 text-xs">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <JqlBar value={q} onChange={setQ} issues={issues} errors={jql.errors} className="w-full min-w-[260px] flex-1 lg:max-w-[560px]" />
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
        </div>
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
          {filtersOn && (
            <button type="button" onClick={clearFilters} className="ml-1 text-2xs font-semibold text-sg-dim hover:text-sg-white">
              Clear filters
            </button>
          )}
          <span className="ml-auto flex items-center gap-3 text-sg-dim">
            <span className="hidden items-center gap-1 md:flex" title="Board keyboard: j/k up-down, h/l left-right, Enter opens, Shift+→/← moves status, Esc clears focus">
              <Keyboard className="size-3.5" />
              <Kbd>j</Kbd>
              <Kbd>k</Kbd>
              <Kbd>h</Kbd>
              <Kbd>l</Kbd>
              <Kbd>⇧→</Kbd>
            </span>
            {visible.length} issues
          </span>
        </div>
      </div>

      {groupBy !== "sprint" && sprintStats.length > 0 && !projectEmpty && (
        <div className="flex shrink-0 gap-3 overflow-x-auto border-b border-sg-line px-5 py-2.5">
          {sprintStats.map(({ s, total, done, inProgress, daysLeft }) => {
            const p = projects.find((pp) => pp.id === s.projectId);
            const over = total > s.capacity;
            return (
              <div key={s.id} className="flex min-w-[340px] flex-1 gap-3 rounded-lg border border-sg-line bg-sg-card px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    {p && <Dot color={p.color} />}
                    <Link href={`/backlog?project=${s.projectId}`} className="font-bold text-sg-white hover:underline">
                      {s.name}
                    </Link>
                    <span className={cn("ml-auto", daysLeft < 0 ? "text-soft-red" : daysLeft <= 2 ? "text-soft-orange" : "text-sg-dim")}>{daysLeft < 0 ? `${-daysLeft}d over` : `${daysLeft}d left`}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 truncate text-2xs text-sg-dim">
                    <Target className="size-3 shrink-0" /> {s.goal || "No sprint goal"}
                  </div>
                  <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-sg-card-3" title={`${done} done · ${inProgress} in progress · ${total} committed · capacity ${s.capacity}`}>
                    <div className="bg-soft-green" style={{ width: `${(done / Math.max(total, s.capacity, 1)) * 100}%` }} />
                    <div className="bg-soft-cyan" style={{ width: `${(inProgress / Math.max(total, s.capacity, 1)) * 100}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between gap-2 text-2xs">
                    <span className="text-sg-muted">
                      <span className="font-semibold text-soft-green">{done}</span> / {total} pts done
                    </span>
                    <span className={over ? "font-semibold text-soft-orange" : "text-sg-dim"}>
                      {total}/{s.capacity} capacity{over ? " · over" : ""}
                    </span>
                  </div>
                </div>
                <div className="w-[120px] shrink-0 self-center" title="Burndown (approximation)">
                  <Burndown sprint={s} issues={issues} mini />
                  <div className="mt-0.5 text-center text-[10px] text-sg-dim">burndown ≈</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {epicStrip.length > 0 && !projectEmpty && (
        <div className="flex shrink-0 items-stretch gap-2 overflow-x-auto border-b border-sg-line px-5 py-2">
          <span className="sg-eyebrow self-center pr-1">Epics</span>
          {epicStrip.map(({ e, total, done, pts, donePts }) => {
            const on = epicFilter === e.id;
            const pct = pts ? (donePts / pts) * 100 : total ? (done / total) * 100 : 0;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setEpicFilter(on ? null : e.id)}
                aria-pressed={on}
                title={`${e.key} · ${e.name}\n${done}/${total} issues done · ${donePts}/${pts} pts (whole epic)`}
                className={cn("w-[190px] shrink-0 rounded-md border px-2.5 py-1.5 text-left transition-colors", on ? "border-sg-white bg-sg-card-2" : "border-sg-line bg-sg-card hover:border-sg-line-2")}
              >
                <div className="flex items-center gap-1.5 text-2xs">
                  <span className={cn("size-2 shrink-0 rounded-sm", spectrumDot[e.color])} />
                  <span className="truncate font-semibold text-sg-white">{e.name}</span>
                  {on && <X className="ml-auto size-3 shrink-0 text-sg-muted" />}
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-sg-card-3">
                  <div className={cn("h-full", spectrumDot[e.color])} style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-0.5 flex justify-between text-[10px] text-sg-dim">
                  <span>
                    {done}/{total} issues
                  </span>
                  <span>
                    {donePts}/{pts} pts
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {projectEmpty ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="w-full max-w-md rounded-xl border border-dashed border-sg-line-2 bg-sg-card/40">
            <EmptyState
              icon={Kanban}
              title={`${project?.name ?? "This project"} has no issues yet`}
              action={
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => openDialog({ kind: "createIssue", projectId })}>
                    <Plus /> Create the first issue
                  </Button>
                  <Link href={backlogHref} className="flex h-7 items-center rounded border border-sg-line-2 px-2.5 text-xs font-semibold text-sg-text hover:border-sg-white hover:text-sg-white">
                    Plan sprints in the backlog
                  </Link>
                </div>
              }
            >
              {project?.key} issues will appear here once they're created. Start with a few stories in the backlog, create a sprint, then start it to work from this board.
            </EmptyState>
          </div>
        </div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-max p-4">
              {/* column headers */}
              <div className="sticky top-0 z-10 -mt-4 flex gap-3 bg-sg-bg pb-2 pt-4">
                {columns.map((c) => {
                  const items = visible.filter((i) => columnOf(i) === c.id);
                  const pts = items.reduce((a, i) => a + (i.storyPoints ?? 0), 0);
                  const wipable = groupBy === "status" && (WIP_STATUSES as string[]).includes(c.id);
                  const limit = wipable ? wip[c.id as WipStatus] : undefined;
                  const state = wipState(c.id, items.length);
                  const tip = limit ? (state === "over" ? `Over WIP limit: ${items.length}/${limit} — finish work before pulling more` : state === "at" ? `At WIP limit: ${items.length}/${limit}` : `WIP limit ${limit} (${items.length} now)`) : undefined;
                  return (
                    <div
                      key={c.id}
                      title={tip}
                      className={cn(
                        "flex w-[280px] shrink-0 items-center gap-2 rounded-lg border px-3 py-2",
                        state === "over" ? "border-soft-red/60 bg-soft-red/10" : state === "at" ? "border-soft-orange/60 bg-soft-orange/10" : "border-sg-line bg-sg-card",
                      )}
                    >
                      <span className={cn("size-2 rounded-full", spectrumDot[c.color])} />
                      <span className="truncate text-xs font-bold uppercase tracking-[0.08em] text-sg-white">{c.label}</span>
                      {c.hint && <span className="text-2xs text-sg-dim">{c.hint}</span>}
                      <span className="ml-auto text-2xs text-sg-dim">{pts} pts</span>
                      <span className={cn("rounded-sm px-1.5 text-2xs font-semibold", state === "over" ? "bg-soft-red/20 text-soft-red" : state === "at" ? "bg-soft-orange/20 text-soft-orange" : "bg-sg-card-3 text-sg-muted")}>
                        {items.length}
                        {limit ? `/${limit}` : ""}
                      </span>
                      {wipable && <WipPopover label={c.label} limit={limit} onSave={(n) => setWip(c.id as WipStatus, n)} />}
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
                                      <IssueCard
                                        issue={issue}
                                        dragging={s.isDragging}
                                        focused={focusedId === issue.id}
                                        info={linkInfo.get(issue.id)}
                                        onOpen={() => {
                                          setFocusedId(issue.id);
                                          openIssue(issue.id);
                                        }}
                                      />
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
              {!visible.length && (
                <div className="sticky left-0 w-[min(100%,calc(100vw-2rem))] py-12 text-center text-sm text-sg-muted">
                  {scope === "active" && groupBy !== "sprint" && !selectionHasActiveSprint ? (
                    <>
                      <p>{project ? `${project.key} has no active sprint.` : "No project has an active sprint."}</p>
                      <div className="mt-3 flex justify-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => setScope("all")}>
                          Show all open work
                        </Button>
                        <Link href={backlogHref} className="flex h-7 items-center rounded bg-sg-card-2 px-2.5 text-xs font-semibold text-sg-text hover:bg-sg-card-3 hover:text-sg-white">
                          Start a sprint in the backlog
                        </Link>
                      </div>
                    </>
                  ) : (
                    <>
                      <p>No issues match.{scope === "active" ? " Try “All open work”" : ""}{filtersOn ? " or clear the filters." : "."}</p>
                      {filtersOn && (
                        <Button size="sm" variant="outline" className="mt-3" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </DragDropContext>
      )}
    </div>
  );
}

function WipPopover({ label, limit, onSave }: { label: string; limit?: number; onSave: (n: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(limit ? String(limit) : "");
  useEffect(() => {
    if (open) setDraft(limit ? String(limit) : "");
  }, [open, limit]);
  const save = (n: number | null) => {
    onSave(n);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn("rounded p-0.5 hover:bg-sg-card-3 hover:text-sg-white", limit ? "text-sg-muted" : "text-sg-dim")} aria-label={`WIP limit for ${label}`} title="Set WIP limit">
          <Gauge className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(draft);
            save(draft.trim() && Number.isFinite(n) && n > 0 ? n : null);
          }}
        >
          <div className="sg-eyebrow mb-1">WIP limit · {label}</div>
          <p className="mb-2 text-2xs text-sg-dim">The header turns orange at the limit and red above it. Saved in this browser for the current project selection.</p>
          <Input autoFocus type="number" min={1} max={99} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="No limit" />
          <div className="mt-2 flex justify-between">
            <Button size="xs" variant="ghost" onClick={() => save(null)} disabled={!limit}>
              Remove limit
            </Button>
            <Button size="xs" variant="primary" type="submit">
              Save
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function IssueCard({ issue, dragging, focused, info, onOpen }: { issue: Issue; dragging: boolean; focused: boolean; info?: { dealId?: string; ticketIds: string[]; blocks: boolean }; onOpen: () => void }) {
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
      data-issue-card={issue.id}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className={cn(
        "cursor-pointer rounded-md border bg-sg-card p-2.5 transition-[border-color,box-shadow] hover:border-sg-line-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70",
        info?.blocks && issue.status !== "done" ? "border-soft-red/40" : "border-sg-line",
        focused && "border-sg-white/70 ring-2 ring-sg-white/80 ring-offset-2 ring-offset-sg-bg",
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
              <span className="truncate">
                {deal.name.split(" — ")[0]} · {formatIDR(deal.amount)}
              </span>
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
