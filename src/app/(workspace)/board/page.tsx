"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { Gauge, Handshake, Kanban, Keyboard, ListTodo, ListTree, OctagonAlert, Plus, Target, Ticket, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useStageMap, useUserMap } from "@/lib/selectors";
import { ISSUE_STATUSES, type Deal, type Epic, type Issue, type IssueStatus, type SpectrumColor } from "@/lib/types";
import { issueStatusMeta, issueTypeMeta, priorityMeta } from "@/lib/meta";
import { wibDaysUntil } from "@/lib/slices/agile-extras";
import { cn, formatIDR, softText, spectrumDot } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Avatar, Dot, EmptyState, Kbd } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { JqlBar, useJql, useUrlQuery } from "@/components/agile/jql-bar";
import { Burndown } from "@/components/agile/burndown";
import { useProjectParam } from "@/components/agile/project-param";
import { createIssueKey, useAgileHotkeys } from "@/components/agile/use-agile-hotkeys";
import { BlockedBadge, DueChip, dueState, hiddenByTriage, useIssueQuickKeys, useOpenBlockers } from "@/components/agile/agile-ui";
import { ProjectPicker } from "@/components/agile/create-project-dialog";
import { TriageInbox, useTriageQueue } from "@/components/agile/triage";
import { assignedPoints } from "@/components/agile/sprint-dialogs";

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
interface LinkInfo {
  dealId?: string;
  ticketIds: string[];
  companyIds: Set<string>;
  blocks: boolean;
}

const NONE = "__none__";
const EMPTY: Issue[] = [];
type WipStatus = "in_progress" | "in_review";
const WIP_STATUSES: WipStatus[] = ["in_progress", "in_review"];

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
  const captureIssues = useCrm((s) => s.captureIssues);
  const restoreIssueFields = useCrm((s) => s.restoreIssueFields);
  const setProjectWip = useCrm((s) => s.setProjectWip);
  const moveDeal = useCrm((s) => s.moveDeal);
  const openIssue = useUi((s) => s.openIssue);
  const openDialog = useUi((s) => s.openDialog);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const stageMap = useStageMap();
  const blockersOf = useOpenBlockers();
  const quickKeys = useIssueQuickKeys();

  const [scope, setScope] = useState<Scope>("active");
  const [projectId, setProjectId] = useProjectParam("all", (pid) => {
    // linked from the ongoing-projects register: show all open work when there's no active sprint
    if (!sprints.some((s) => s.projectId === pid && s.state === "active")) setScope("all");
    else setScope((cur) => (cur === "active" || cur === "all" ? cur : "active"));
  });
  const [groupBy, setGroupByRaw] = useState<GroupBy>("status");
  const [lane, setLane] = useState<Swimlane>("none");
  const [q, setQ] = useUrlQuery();
  const jql = useJql(q);
  const [epicFilter, setEpicFilter] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyCrm, setOnlyCrm] = useState(false);
  const [onlyBlocking, setOnlyBlocking] = useState(false);
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [onlyDueSoon, setOnlyDueSoon] = useState(false);
  const [showSubtasks, setShowSubtasks] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [triageOpen, setTriageOpen] = useState(false);
  const triage = useTriageQueue(projectId);

  /** Columns = Sprint shows every open sprint, so a sprint picked in Scope must not keep filtering. */
  const setGroupBy = (g: GroupBy) => {
    setGroupByRaw(g);
    if (g === "sprint" && scope !== "active" && scope !== "all") setScope("active");
  };

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

  const dealById = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);
  const epicById = useMemo(() => new Map(epics.map((e) => [e.id, e])), [epics]);
  const sprintById = useMemo(() => new Map(sprints.map((s) => [s.id, s])), [sprints]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  /** sub-task counts per parent, computed once per store change instead of once per card */
  const subtaskStats = useMemo(() => {
    const m = new Map<string, { done: number; total: number }>();
    issues.forEach((i) => {
      if (!i.parentId) return;
      const st = m.get(i.parentId) ?? { done: 0, total: 0 };
      st.total += 1;
      if (i.status === "done") st.done += 1;
      m.set(i.parentId, st);
    });
    return m;
  }, [issues]);

  /* derived link info per issue */
  const linkInfo = useMemo(() => {
    const m = new Map<string, LinkInfo>();
    crossLinks.forEach((x) => {
      if (x.agileType !== "issue") return;
      const info = m.get(x.agileId) ?? { ticketIds: [], companyIds: new Set<string>(), blocks: false };
      if (x.crmType === "deal") {
        info.dealId ??= x.crmId;
        const d = dealById.get(x.crmId);
        if (d?.companyId) info.companyIds.add(d.companyId);
        if (x.linkType === "blocks") info.blocks = true;
      }
      if (x.crmType === "ticket") info.ticketIds.push(x.crmId);
      if (x.crmType === "company") info.companyIds.add(x.crmId);
      m.set(x.agileId, info);
    });
    return m;
  }, [crossLinks, dealById]);

  const project = projectById.get(projectId);
  const projectIssueCount = useMemo(() => (projectId === "all" ? issues.length : issues.filter((i) => i.projectId === projectId).length), [issues, projectId]);
  const activeSprintIds = useMemo(() => new Set(sprints.filter((s) => s.state === "active").map((s) => s.id)), [sprints]);
  const selectionHasActiveSprint = sprints.some((s) => s.state === "active" && (projectId === "all" || s.projectId === projectId));
  const projectSprints = useMemo(() => sprints.filter((s) => (projectId === "all" || s.projectId === projectId) && s.state !== "closed"), [sprints, projectId]);

  /** project + scope only (no filters) — what WIP limits count against */
  const inScope = (i: Issue) => {
    if (projectId !== "all" && i.projectId !== projectId) return false;
    if (hiddenByTriage(i)) return false;
    if (groupBy === "sprint") return sprintById.get(i.sprintId ?? "")?.state !== "closed";
    if (scope === "active") return !!i.sprintId && activeSprintIds.has(i.sprintId);
    if (scope !== "all") return i.sprintId === scope;
    return true;
  };
  const scopeIssues = useMemo(
    () => issues.filter(inScope),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [issues, projectId, scope, groupBy, activeSprintIds, sprintById],
  );
  const now = Date.now();

  /** everything except the epic filter — feeds the epic strip */
  const baseVisible = useMemo(() => {
    return scopeIssues.filter((i) => {
      if (!showSubtasks && i.type === "subtask") return false;
      if (onlyMine && i.assigneeId !== currentUserId && i.reporterId !== currentUserId) return false;
      if (onlyCrm && !linkInfo.has(i.id)) return false;
      if (onlyBlocking && !linkInfo.get(i.id)?.blocks) return false;
      if (onlyBlocked && !blockersOf.get(i.id)?.length) return false;
      if (onlyDueSoon) {
        const st = dueState(i, now);
        if (st !== "overdue" && !(i.dueDate && i.status !== "done" && wibDaysUntil(i.dueDate, now) <= 6)) return false;
      }
      if (jql.active && !jql.match(i)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeIssues, jql, onlyMine, onlyCrm, onlyBlocking, onlyBlocked, onlyDueSoon, showSubtasks, currentUserId, linkInfo, blockersOf]);

  const visible = useMemo(() => (epicFilter ? baseVisible.filter((i) => i.epicId === epicFilter) : baseVisible), [baseVisible, epicFilter]);

  /* epic progress strip: epics present on the board, progress over the whole epic */
  const epicStrip = useMemo(() => {
    const present = new Set(baseVisible.map((i) => i.epicId).filter((x): x is string => !!x));
    if (epicFilter) present.add(epicFilter);
    const per = new Map<string, Issue[]>();
    issues.forEach((i) => {
      if (i.epicId && present.has(i.epicId) && i.type !== "subtask") per.set(i.epicId, [...(per.get(i.epicId) ?? []), i]);
    });
    return epics
      .filter((e) => present.has(e.id))
      .map((e) => {
        const its = per.get(e.id) ?? [];
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
          .map((s) => {
            const d = wibDaysUntil(s.endDate, now);
            return {
              id: s.id,
              label: s.name,
              color: (s.state === "active" ? "cyan" : "blue") as SpectrumColor,
              hint: s.state === "active" ? (d < 0 ? `${-d}d over` : `${d}d left`) : "future",
            };
          }),
        { id: NONE, label: "Backlog", color: "magenta" as SpectrumColor },
      ];
    }
    if (groupBy === "dealStage") {
      const stages = [...(newBusiness?.stages ?? []), ...(renewals?.stages ?? [])].filter((s) => !s.closed || s.closed === "won");
      return [{ id: NONE, label: "No linked deal", color: "blue" as SpectrumColor }, ...stages.map((s) => ({ id: s.id, label: s.name, color: s.color, hint: `${Math.round(s.probability * 100)}%` }))];
    }
    return ISSUE_STATUSES.filter((s) => s !== "backlog" || scope === "all").map((s) => ({ id: s, label: issueStatusMeta[s].label, color: issueStatusMeta[s].color }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, projectSprints, newBusiness, renewals, scope]);

  const columnOf = (i: Issue): string => {
    if (groupBy === "sprint") return i.sprintId && sprintById.has(i.sprintId) ? i.sprintId : NONE;
    if (groupBy === "dealStage") {
      const dealId = linkInfo.get(i.id)?.dealId;
      return dealId ? (dealById.get(dealId)?.stageId ?? NONE) : NONE;
    }
    return i.status;
  };

  const laneOf = (i: Issue): string => {
    if (lane === "epic") return i.epicId ?? NONE;
    if (lane === "assignee") return i.assigneeId ?? NONE;
    if (lane === "account") return [...(linkInfo.get(i.id)?.companyIds ?? [])][0] ?? NONE;
    return "all";
  };

  /** every (lane, column) cell, computed once per change */
  const cells = useMemo(() => {
    const m = new Map<string, Issue[]>();
    visible.forEach((i) => {
      const k = `${laneOf(i)}::${columnOf(i)}`;
      const list = m.get(k);
      if (list) list.push(i);
      else m.set(k, [i]);
    });
    const order = jql.order;
    m.forEach((list) => list.sort(order ?? ((a, b) => a.rank - b.rank || priorityMeta[b.priority].weight - priorityMeta[a.priority].weight)));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, lane, groupBy, linkInfo, dealById, sprintById, jql.order]);
  const cell = (laneId: string, colId: string) => cells.get(`${laneId}::${colId}`) ?? EMPTY;

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

  /** column → issues top-to-bottom across lanes (keyboard navigation order) */
  const navColumns = useMemo(() => columns.map((c) => lanes.flatMap((l) => cell(l.id, c.id))), [columns, lanes, cells]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ───────────── WIP limits: shared on the project, counted against everything in scope (filters ignored) ───────────── */
  const wip = project?.wipLimits ?? {};
  const wipCount = useMemo(() => {
    const m = new Map<string, number>();
    scopeIssues.forEach((i) => i.type !== "subtask" && m.set(i.status, (m.get(i.status) ?? 0) + 1));
    return m;
  }, [scopeIssues]);
  const wipState = (status: string): "ok" | "at" | "over" => {
    const limit = groupBy === "status" && project ? wip[status as WipStatus] : undefined;
    if (!limit) return "ok";
    const count = wipCount.get(status) ?? 0;
    return count > limit ? "over" : count === limit ? "at" : "ok";
  };
  const warnWip = (issue: Issue, status: IssueStatus) => {
    const limit = project ? project.wipLimits?.[status] : projectById.get(issue.projectId)?.wipLimits?.[status];
    if (!limit || issue.status === status || issue.type === "subtask") return;
    const count = issues.filter((i) => i.projectId === issue.projectId && i.status === status && i.type !== "subtask" && !!i.sprintId && activeSprintIds.has(i.sprintId) && !hiddenByTriage(i)).length + 1;
    if (count > limit) notify(`${issueStatusMeta[status].label} is over its WIP limit (${count}/${limit}) — finish work before pulling more`);
  };

  /* ───────────── moves (with Undo) ───────────── */

  const withUndo = (issue: Issue, message: string, run: () => void) => {
    const snap = captureIssues([issue.id]);
    run();
    notify(message, { label: "Undo", run: () => restoreIssueFields(snap) });
  };

  const onDragEnd = (r: DropResult) => {
    if (!r.destination) return;
    const [toLane, toCol] = r.destination.droppableId.split("::") as [string, string];
    const [fromLane, fromCol] = r.source.droppableId.split("::") as [string, string];
    const issue = issues.find((i) => i.id === r.draggableId);
    if (!issue) return;
    if (toLane === fromLane && toCol === fromCol && r.destination.index === r.source.index) return;
    const pkey = projectById.get(issue.projectId)?.key ?? "its project";

    const patch: Partial<Issue> = {};
    const parts: string[] = [];
    if (toCol !== fromCol) {
      if (groupBy === "status") {
        patch.status = toCol as IssueStatus;
        warnWip(issue, toCol as IssueStatus);
        parts.push(issueStatusMeta[toCol as IssueStatus].label);
      }
      if (groupBy === "sprint") {
        const target = toCol === NONE ? null : sprintById.get(toCol);
        if (target && target.projectId !== issue.projectId) {
          notify(`${issue.key} belongs to ${pkey} — it can't be planned into ${target.name}`);
          return;
        }
        if (issue.type === "subtask") {
          notify(`Sub-tasks follow their parent — move ${issues.find((i) => i.id === issue.parentId)?.key ?? "the parent"} instead`);
          return;
        }
        patch.sprintId = target ? target.id : null;
        parts.push(target ? target.name : "Backlog");
      }
      if (groupBy === "dealStage") {
        const dealId = linkInfo.get(issue.id)?.dealId;
        if (!dealId || toCol === NONE) {
          notify(dealId ? "Unlink the deal from the issue drawer instead" : `${issue.key} has no linked deal — link one first`);
          return;
        }
        const deal = dealById.get(dealId);
        const target = stageMap.get(toCol);
        if (deal && target && target.pipelineId !== deal.pipelineId) {
          notify(`${deal.name.split(" — ")[0]} is in a different pipeline`);
          return;
        }
        if (deal) {
          const prevStage = deal.stageId;
          moveDeal(dealId, toCol);
          notify(`${deal.name.split(" — ")[0]} moved to ${target?.name ?? "stage"} from the board`, { label: "Undo", run: () => moveDeal(dealId, prevStage) });
        }
      }
    }
    if (toLane !== fromLane) {
      if (lane === "epic") {
        const target = toLane === NONE ? null : epicById.get(toLane);
        if (target && target.projectId !== issue.projectId) {
          notify(`${issue.key} belongs to ${pkey} — it can't join epic ${target.key}`);
          return;
        }
        if (issue.type === "subtask") {
          notify("Sub-tasks follow their parent's epic — change the parent instead");
          return;
        }
        patch.epicId = target ? target.id : null;
        parts.push(target ? `epic ${target.key}` : "no epic");
      }
      if (lane === "assignee") {
        patch.assigneeId = toLane === NONE ? null : toLane;
        parts.push(toLane === NONE ? "unassigned" : (userMap.get(toLane)?.name ?? "assignee"));
      }
      if (lane === "account") {
        notify("Customer account comes from CRM links — link a record to change it");
        if (toCol === fromCol) return;
      }
    }
    if (jql.order && !Object.keys(patch).length) {
      notify("Ranking is off while the query has ORDER BY — remove it to reorder cards");
      return;
    }
    // rank between the new neighbours in the destination cell (hidden issues keep their order)
    const dest = cell(toLane, toCol).filter((i) => i.id !== issue.id);
    dest.splice(r.destination.index, 0, issue);
    const ordered = jql.order ? [] : dest.map((i) => i.id);
    if (groupBy === "dealStage" && !Object.keys(patch).length && toCol !== fromCol) return;
    withUndo(issue, parts.length ? `${issue.key} → ${parts.join(" · ")}` : `${issue.key} re-ranked`, () => moveIssueTracked(issue.id, patch, ordered));
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
    const destList = groupBy === "status" ? cell(laneOf(issue), next).filter((i) => i.id !== issue.id) : visible.filter((i) => i.status === next && i.id !== issue.id).sort((a, b) => a.rank - b.rank);
    warnWip(issue, next);
    withUndo(issue, `${issue.key} → ${issueStatusMeta[next].label}`, () => moveIssueTracked(issue.id, { status: next }, [...destList.map((i) => i.id), issue.id]));
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
    if (!e.shiftKey && pos && (k === "i" || k === "p" || k === "e")) {
      const issue = issues.find((i) => i.id === focusedId);
      return issue ? quickKeys(issue, k) : false;
    }
    if (k === "Escape" && focusedId) {
      setFocusedId(null);
      (document.activeElement as HTMLElement | null)?.blur?.();
      return true;
    }
    return false;
  });

  // j/k/h/l move real focus (screen readers follow), not just the highlight
  useEffect(() => {
    if (!focusedId) return;
    const el = document.querySelector<HTMLElement>(`[data-issue-card="${focusedId}"]`);
    if (!el) return;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusedId]);

  /* sprint header for the active scope */
  const focusSprints = scope === "active" ? sprints.filter((s) => s.state === "active" && (projectId === "all" || s.projectId === projectId)) : sprints.filter((s) => s.id === scope);
  const sprintStats = focusSprints.map((s) => {
    const its = issues.filter((i) => i.sprintId === s.id && i.type !== "subtask");
    const total = its.reduce((a, i) => a + (i.storyPoints ?? 0), 0);
    const done = its.filter((i) => i.status === "done").reduce((a, i) => a + (i.storyPoints ?? 0), 0);
    const inProgress = its.filter((i) => i.status === "in_progress" || i.status === "in_review").reduce((a, i) => a + (i.storyPoints ?? 0), 0);
    return { s, total, done, inProgress, daysLeft: wibDaysUntil(s.endDate, now) };
  });

  const filtersOn = jql.active || onlyMine || onlyCrm || onlyBlocking || onlyBlocked || onlyDueSoon || !!epicFilter;
  const clearFilters = () => {
    setQ("");
    setOnlyMine(false);
    setOnlyCrm(false);
    setOnlyBlocking(false);
    setOnlyBlocked(false);
    setOnlyDueSoon(false);
    setEpicFilter(null);
  };
  const backlogHref = `/backlog${projectId !== "all" ? `?project=${projectId}` : ""}`;
  const projectEmpty = projectId !== "all" && projectIssueCount === 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Agile Board" meta={project ? <span className="text-sm text-sg-dim">{project.name}</span> : undefined}>
        <ProjectPicker
          allowAll
          value={projectId}
          onChange={(pid) => {
            setProjectId(pid);
            if (scope !== "active" && scope !== "all") setScope("active");
          }}
        />
        <Select value={scope} onChange={(e) => setScope(e.target.value)} wrapperClassName="w-44" disabled={groupBy === "sprint"} aria-label="Scope" title={groupBy === "sprint" ? "Columns show every open sprint" : undefined}>
          <option value="active">Active sprints</option>
          <option value="all">All open work</option>
          {projectSprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Button variant="outline" onClick={() => setTriageOpen(true)} title="Escalations and requests waiting for the team">
          <ListTodo /> Triage
          {triage.pending.length > 0 && <span className="rounded-sm bg-soft-cyan/20 px-1 text-2xs font-bold text-soft-cyan">{triage.pending.length}</span>}
        </Button>
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
          <Toggle on={onlyDueSoon} onClick={() => setOnlyDueSoon((v) => !v)}>
            Due this week
          </Toggle>
          <Toggle on={onlyBlocked} onClick={() => setOnlyBlocked((v) => !v)}>
            Blocked
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
            <span className="hidden items-center gap-1 md:flex" title="Board keyboard: j/k up-down, h/l left-right, Enter opens, Shift+→/← moves status, i assign to me, p priority, e estimate, Esc clears focus">
              <Keyboard className="size-3.5" />
              <Kbd>j</Kbd>
              <Kbd>k</Kbd>
              <Kbd>h</Kbd>
              <Kbd>l</Kbd>
              <Kbd>⇧→</Kbd>
              <Kbd>i</Kbd>
              <Kbd>p</Kbd>
              <Kbd>e</Kbd>
            </span>
            {visible.length} issues
          </span>
        </div>
      </div>

      {groupBy !== "sprint" && sprintStats.length > 0 && !projectEmpty && (
        <div className="flex shrink-0 gap-3 overflow-x-auto border-b border-sg-line px-5 py-2.5">
          {sprintStats.map(({ s, total, done, inProgress, daysLeft }) => {
            const p = projectById.get(s.projectId);
            const over = total > s.capacity;
            const assigned = assignedPoints(s.id, issues);
            const members = Object.entries(s.memberCapacity ?? {});
            return (
              <div key={s.id} className="flex min-w-[340px] flex-1 gap-3 rounded-lg border border-sg-line bg-sg-card px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    {p && <Dot color={p.color} />}
                    <Link href={`/backlog?project=${s.projectId}`} className="font-bold text-sg-white hover:underline">
                      {s.name}
                    </Link>
                    <span className={cn("ml-auto", daysLeft < 0 ? "text-soft-red" : daysLeft <= 2 ? "text-soft-orange" : "text-sg-dim")}>{daysLeft < 0 ? `${-daysLeft}d over` : daysLeft === 0 ? "ends today" : `${daysLeft}d left`}</span>
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
                  {members.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1" aria-label="Points assigned per person against their capacity">
                      {members.map(([uid, cap]) => {
                        const a = assigned.get(uid) ?? 0;
                        return (
                          <span key={uid} title={`${userMap.get(uid)?.name}: ${a} pts assigned of ${cap} capacity`} className={cn("rounded-sm px-1 text-[10px] font-semibold", a > cap ? "bg-soft-orange/15 text-soft-orange" : "bg-sg-card-3 text-sg-muted")}>
                            {userMap.get(uid)?.name.split(" ")[0]} {a}/{cap}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="w-[120px] shrink-0 self-center" title="Burndown from recorded status changes">
                  <Burndown sprint={s} issues={issues} mini />
                  <div className="mt-0.5 text-center text-[10px] text-sg-dim">burndown</div>
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
                  const items = lanes.flatMap((l) => cell(l.id, c.id));
                  const pts = items.reduce((a, i) => a + (i.storyPoints ?? 0), 0);
                  const wipable = groupBy === "status" && !!project && (WIP_STATUSES as string[]).includes(c.id);
                  const limit = wipable ? wip[c.id as WipStatus] : undefined;
                  const state = wipState(c.id);
                  const inScopeCount = wipCount.get(c.id) ?? 0;
                  const tip = limit ? (state === "over" ? `Over WIP limit: ${inScopeCount}/${limit} — finish work before pulling more` : state === "at" ? `At WIP limit: ${inScopeCount}/${limit}` : `WIP limit ${limit} (${inScopeCount} now)`) + (inScopeCount !== items.length ? ` · ${items.length} shown with the current filters` : "") : undefined;
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
                        {limit ? `${inScopeCount}/${limit}` : items.length}
                      </span>
                      {wipable && project && <WipPopover label={c.label} projectKey={project.key} limit={limit} onSave={(n) => setProjectWip(project.id, c.id as IssueStatus, n)} />}
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
                      <span className="text-sg-dim">({columns.reduce((a, c) => a + cell(l.id, c.id).length, 0)})</span>
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
                              {items.map((issue, index) => {
                                const info = linkInfo.get(issue.id);
                                const open = () => {
                                  setFocusedId(issue.id);
                                  openIssue(issue.id);
                                };
                                return (
                                  <Draggable key={issue.id} draggableId={issue.id} index={index}>
                                    {(p, s) => (
                                      // one focusable element per card: the drag handle is the card itself
                                      <div
                                        ref={p.innerRef}
                                        {...p.draggableProps}
                                        {...p.dragHandleProps}
                                        style={p.draggableProps.style}
                                        data-issue-card={issue.id}
                                        aria-label={`${issue.key} ${issue.summary}`}
                                        onClick={open}
                                        onFocus={() => setFocusedId(issue.id)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                            e.preventDefault();
                                            open();
                                          }
                                        }}
                                        className="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70"
                                      >
                                        <IssueCard
                                          issue={issue}
                                          dragging={s.isDragging}
                                          focused={focusedId === issue.id}
                                          info={info}
                                          epic={issue.epicId ? epicById.get(issue.epicId) : undefined}
                                          deal={info?.dealId ? dealById.get(info.dealId) : undefined}
                                          subtasks={subtaskStats.get(issue.id)}
                                          blockers={blockersOf.get(issue.id)}
                                          assignee={issue.assigneeId ? userMap.get(issue.assigneeId) : null}
                                        />
                                      </div>
                                    )}
                                  </Draggable>
                                );
                              })}
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
                      <p>
                        No issues match.{scope === "active" ? " Try “All open work”" : ""}
                        {filtersOn ? " or clear the filters." : "."}
                      </p>
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
      <TriageInbox open={triageOpen} onOpenChange={setTriageOpen} projectId={projectId} />
    </div>
  );
}

function WipPopover({ label, projectKey, limit, onSave }: { label: string; projectKey: string; limit?: number; onSave: (n: number | null) => void }) {
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
          <p className="mb-2 text-2xs text-sg-dim">Shared with everyone on {projectKey}. Counts every issue in the board scope, whatever filters are on. The header turns orange at the limit and red above it.</p>
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

function IssueCard({
  issue,
  dragging,
  focused,
  info,
  epic,
  deal,
  subtasks,
  blockers,
  assignee,
}: {
  issue: Issue;
  dragging: boolean;
  focused: boolean;
  info?: LinkInfo;
  epic?: Epic;
  deal?: Deal;
  subtasks?: { done: number; total: number };
  blockers?: Issue[];
  assignee?: { initials: string; color: SpectrumColor; name: string } | null;
}) {
  const TypeIcon = issueTypeMeta[issue.type].icon;
  const PrioIcon = priorityMeta[issue.priority].icon;
  const blockedOpen = !!blockers?.length && issue.status !== "done";
  return (
    <div
      className={cn(
        "cursor-pointer rounded-md border bg-sg-card p-2.5 transition-[border-color,box-shadow] hover:border-sg-line-2",
        (info?.blocks || blockedOpen) && issue.status !== "done" ? "border-soft-red/40" : "border-sg-line",
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
      {(blockedOpen || (issue.dueDate && issue.status !== "done")) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {blockedOpen && <BlockedBadge blockers={blockers} />}
          {issue.status !== "done" && <DueChip issue={issue} compact />}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <TypeIcon className={cn("size-3.5", softText[issueTypeMeta[issue.type].color])} aria-label={issueTypeMeta[issue.type].label} />
        <span className="text-2xs font-semibold text-sg-dim">{issue.key}</span>
        {subtasks && subtasks.total > 0 && (
          <span className="flex items-center gap-0.5 text-2xs text-sg-dim" title={`${subtasks.done} of ${subtasks.total} sub-tasks done`}>
            <ListTree className="size-3" />
            {subtasks.done}/{subtasks.total}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <PrioIcon className={cn("size-3.5", softText[priorityMeta[issue.priority].color])} aria-label={priorityMeta[issue.priority].label} />
          {issue.storyPoints != null && <span className="min-w-[18px] rounded-full bg-sg-card-3 px-1.5 text-center text-[10px] font-bold text-sg-muted">{issue.storyPoints}</span>}
          <Avatar user={assignee ?? null} size="xs" />
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
          <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={cn("h-6 rounded-sm px-2 text-xs font-semibold", value === o.value ? "bg-sg-card-3 text-sg-white" : "text-sg-muted hover:text-sg-white")}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("h-6 rounded-pill border px-2.5 text-xs font-semibold transition-colors", on ? "border-sg-white bg-sg-white text-sg-bg" : "border-sg-line text-sg-muted hover:border-sg-line-2 hover:text-sg-white")}>
      {children}
    </button>
  );
}
