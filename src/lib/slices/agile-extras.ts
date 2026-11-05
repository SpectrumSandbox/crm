/* Store slice "AgileExtras" — tracked issue edits (synced history), ranking, sprint lifecycle + reports,
 * issue-to-issue links, triage inbox, project creation, WIP limits, bulk delete/restore.
 *
 * NOTE: this slice also provides `createIssue`. Slices are spread after the base actions in src/lib/store.ts, so this
 * implementation replaces the base one for every caller (dialogs, initiatives, drawer): it hands out keys from a
 * per-project counter that survives deletes, keeps "Backlog"-status work out of active sprints, refuses
 * parentless sub-tasks and routes CRM-originated unplanned work to triage. */
import type { CrossLink, Issue, IssueComment, IssueHistoryEntry, IssueLink, IssueLinkType, IssueStatus, Project, SpectrumColor, Sprint, SprintReport, TrackedIssueField } from "../types";
import { TRACKED_ISSUE_FIELDS } from "../types";
import type { NewIssueInput } from "../store";
import type { GetFn, SetFn, Uid } from "./types";

export type { IssueHistoryEntry, TrackedIssueField };
export { TRACKED_ISSUE_FIELDS };

/** Old per-browser history key (migrated into the synced collection on first use). */
export const ISSUE_HISTORY_KEY = "sg-crm-issue-history";
/** Entries kept per issue (oldest dropped first). */
export const ISSUE_HISTORY_PER_ISSUE = 100;

/* ───────────── pure helpers (also used by the pages) ───────────── */

const DAY = 86_400_000;
const WIB = 7 * 3_600_000;
const nowIso = () => new Date().toISOString();

/** yyyy-mm-dd in WIB for an ISO string or epoch ms */
export function wibDayKey(t: string | number): string {
  const ms = typeof t === "number" ? t : Date.parse(t);
  return new Date(ms + WIB).toISOString().slice(0, 10);
}

/** Whole WIB calendar days from today until `iso` (negative = past). */
export function wibDaysUntil(iso: string, now = Date.now()): number {
  return Math.round((Date.parse(`${wibDayKey(iso)}T00:00:00Z`) - Date.parse(`${wibDayKey(now)}T00:00:00Z`)) / DAY);
}

export function sprintNumber(name: string): number {
  const m = name.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

const keyNumber = (key: string) => Number(key.split("-")[1]) || 0;

/** Future sprints of a project in planned order (start date, then sprint number). */
export function futureSprintsInOrder(sprints: Sprint[], projectId: string): Sprint[] {
  return sprints.filter((s) => s.projectId === projectId && s.state === "future").sort((a, b) => a.startDate.localeCompare(b.startDate) || sprintNumber(a.name) - sprintNumber(b.name));
}

/** Why a future sprint can't be started yet (null = it can). */
export function startBlocker(sprint: Sprint, sprints: Sprint[]): string | null {
  if (sprint.state !== "future") return `${sprint.name} is not a future sprint`;
  const active = sprints.find((sp) => sp.projectId === sprint.projectId && sp.state === "active");
  if (active) return `Complete ${active.name} first — a project can only have one active sprint`;
  const first = futureSprintsInOrder(sprints, sprint.projectId)[0];
  if (first && first.id !== sprint.id) return `Start ${first.name} first — it is planned before ${sprint.name}. Change the dates to reorder.`;
  return null;
}

/** When the issue last became Done (from history), falling back to its last update. */
export function doneAt(issue: Issue, history: IssueHistoryEntry[]): string | null {
  if (issue.status !== "done") return null;
  for (let k = history.length - 1; k >= 0; k--) {
    const h = history[k]!;
    if (h.issueId === issue.id && h.field === "status" && h.to === "done") return h.at;
  }
  return issue.updatedAt;
}

/** When the issue was last moved into `sprintId` (null when no record — it was there from the start). */
export function joinedSprintAt(issueId: string, sprintId: string, history: IssueHistoryEntry[]): string | null {
  for (let k = history.length - 1; k >= 0; k--) {
    const h = history[k]!;
    if (h.issueId === issueId && h.field === "sprintId" && h.to === sprintId) return h.at;
  }
  return null;
}

const pts = (list: Issue[]) => list.reduce((a, i) => a + (i.storyPoints ?? 0), 0);

export interface BurndownSeries {
  points: { day: string; ideal: number; remaining: number | null }[];
  /** points committed at the start (issues that joined after the start excluded) */
  committed: number;
  /** points added after the start */
  added: number;
  total: number;
  remaining: number;
}

/**
 * Burndown from recorded history: an issue counts from the day it joined the sprint (start for the original scope)
 * and burns on the day its status changed to Done. Sub-tasks are excluded (their parent carries the points).
 */
export function computeBurndownSeries(sprint: Sprint, issues: Issue[], history: IssueHistoryEntry[], now = Date.now()): BurndownSeries {
  const its = issues.filter((i) => i.sprintId === sprint.id && i.type !== "subtask");
  const startKey = wibDayKey(sprint.startDate);
  const endKey = wibDayKey(sprint.endDate);
  const todayKey = wibDayKey(now);
  const startMs = Date.parse(`${startKey}T00:00:00Z`);
  const days = Math.max(1, Math.round((Date.parse(`${endKey}T00:00:00Z`) - startMs) / DAY) + 1);
  const keys = Array.from({ length: days }, (_, d) => new Date(startMs + d * DAY).toISOString().slice(0, 10));
  const clamp = (k: string) => (k < startKey ? startKey : k > endKey ? endKey : k);
  const rows = its.map((i) => {
    const joined = joinedSprintAt(i.id, sprint.id, history);
    const joinKey = joined && Date.parse(joined) > Date.parse(sprint.startDate) ? clamp(wibDayKey(joined)) : startKey;
    const d = doneAt(i, history);
    return { pts: i.storyPoints ?? 0, joinKey, doneKey: d ? clamp(wibDayKey(d)) : null };
  });
  const committed = rows.filter((r) => r.joinKey === startKey).reduce((a, r) => a + r.pts, 0);
  const total = rows.reduce((a, r) => a + r.pts, 0);
  const points = keys.map((day, d) => {
    const ideal = days === 1 ? 0 : committed * (1 - d / (days - 1));
    const remaining = rows.filter((r) => r.joinKey <= day && !(r.doneKey && r.doneKey <= day)).reduce((a, r) => a + r.pts, 0);
    return { day, ideal, remaining: day <= todayKey ? remaining : null };
  });
  const remaining = rows.filter((r) => !r.doneKey).reduce((a, r) => a + r.pts, 0);
  return { points, committed, added: total - committed, total, remaining };
}

/** Sprint report figures for a sprint as it stands now (before its unfinished work is moved). */
export function buildSprintReport(sprint: Sprint, issues: Issue[], history: IssueHistoryEntry[], opts: { now?: number; closedById: string; carriedTo: string | null; id: string }): SprintReport {
  const now = opts.now ?? Date.now();
  const startMs = Date.parse(sprint.startDate);
  const current = issues.filter((i) => i.sprintId === sprint.id && i.type !== "subtask");
  const added = current.filter((i) => {
    const j = joinedSprintAt(i.id, sprint.id, history);
    return !!j && Date.parse(j) > startMs;
  });
  const removedIds = new Set<string>();
  history.forEach((h) => {
    if (h.field === "sprintId" && h.from === sprint.id && Date.parse(h.at) > startMs) removedIds.add(h.issueId);
  });
  const removed = issues.filter((i) => removedIds.has(i.id) && i.sprintId !== sprint.id && i.type !== "subtask");
  const addedIds = new Set(added.map((i) => i.id));
  const committedList = [...current.filter((i) => !addedIds.has(i.id)), ...removed];
  const completed = current.filter((i) => i.status === "done");
  const carried = current.filter((i) => i.status !== "done");
  const series = computeBurndownSeries(sprint, issues, history, now);
  return {
    id: opts.id,
    sprintId: sprint.id,
    projectId: sprint.projectId,
    sprintName: sprint.name,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    closedAt: new Date(now).toISOString(),
    closedById: opts.closedById,
    committed: { count: committedList.length, points: pts(committedList) },
    added: { count: added.length, points: pts(added) },
    removed: { count: removed.length, points: pts(removed) },
    completed: { count: completed.length, points: pts(completed) },
    carriedOver: { count: carried.length, points: pts(carried) },
    carriedToSprintId: opts.carriedTo,
    daily: series.points.filter((p) => p.remaining !== null).map((p) => ({ day: p.day, remaining: p.remaining! })),
  };
}

/** Open blockers per issue (issues linked "X blocks Y" where X is not done). */
export function openBlockersOf(links: IssueLink[], issues: Issue[]): Map<string, Issue[]> {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const out = new Map<string, Issue[]>();
  links.forEach((l) => {
    if (l.type !== "blocks") return;
    const from = byId.get(l.fromIssueId);
    if (!from || from.status === "done" || !byId.has(l.toIssueId)) return;
    out.set(l.toIssueId, [...(out.get(l.toIssueId) ?? []), from]);
  });
  return out;
}

/** Fields captured for undo of board / bulk / keyboard edits. */
const UNDO_FIELDS = ["status", "sprintId", "epicId", "assigneeId", "priority", "rank", "storyPoints", "parentId", "type", "dueDate", "triage", "triageNote", "snoozedUntil", "duplicateOfId"] as const;
export type IssueFieldSnapshot = { id: string } & Partial<Pick<Issue, (typeof UNDO_FIELDS)[number]>>;

/* ───────────── snapshots for undo ───────────── */

export interface DeletedIssuesSnapshot {
  issues: Issue[];
  crossLinks: CrossLink[];
  issueComments: IssueComment[];
  issueLinks: IssueLink[];
}

export interface CompletedSprintSnapshot {
  sprint: Sprint;
  moved: { id: string; sprintId: string | null; status: IssueStatus }[];
  reportId: string;
}

export interface DeletedSprintSnapshot {
  sprint: Sprint;
  moved: { id: string; sprintId: string | null; status: IssueStatus }[];
}

export interface StartSprintInput {
  name: string;
  startDate: string;
  endDate: string;
  goal: string;
  capacity?: number;
  memberCapacity?: Record<string, number>;
}

export type SprintPatch = Partial<Pick<Sprint, "name" | "goal" | "startDate" | "endDate" | "capacity" | "memberCapacity">>;

export type TriageAction =
  | { kind: "accept"; sprintId?: string | null }
  | { kind: "decline"; reason: string }
  | { kind: "duplicate"; ofIssueId: string }
  | { kind: "snooze"; until: string }
  | { kind: "send" };

export interface NewProjectInput {
  key: string;
  name: string;
  leadId: string;
  color: SpectrumColor;
  description?: string;
  /** also create "<KEY> Sprint 1" (future) */
  withSprint?: boolean;
}

/** What happened to sub-tasks still open under a parent that is Done when its sprint completes. */
export type OpenSubtaskPolicy = "reopen" | "close";

/** Persisted collections of this workstream (they live in the seed bundle via src/lib/seed-ext/agile.ts). */
export interface AgileExtrasData {
  issueHistory: IssueHistoryEntry[];
  issueLinks: IssueLink[];
  sprintReports: SprintReport[];
}

export interface AgileExtrasSlice {
  /** Replaces the base createIssue (see the file header). Optional in this type only so the spread in store.ts
   *  doesn't trip TS2783; it is always provided. */
  createIssue?: (input: NewIssueInput) => string;
  /** updateIssue + rules (active-sprint status, sub-task parents, cascade to sub-tasks) + recorded history. */
  updateIssueTracked: (id: string, patch: Partial<Issue>) => void;
  /** Same as updateIssueTracked plus a rank between its neighbours in `orderedIds` (the visible destination order). */
  moveIssueTracked: (id: string, patch: Partial<Issue>, orderedIds: string[]) => void;
  /** Append a free-form history note (e.g. "Cloned from UAV-101"). */
  noteIssueHistory: (issueId: string, note: string) => void;
  /** Copy the given issues' editable fields (and their sub-tasks') for an Undo. */
  captureIssues: (ids: string[]) => IssueFieldSnapshot[];
  /** Put captured fields back (recorded in history). */
  restoreIssueFields: (snap: IssueFieldSnapshot[]) => void;
  /** Merge the old per-browser history (localStorage) into the synced collection, once. */
  migrateLegacyIssueHistory: () => void;

  /** Adds the next numbered future sprint to a project; returns its id. */
  createSprint: (projectId: string) => string;
  /** Starts the earliest future sprint. Returns an error message when blocked, otherwise null. */
  startSprint: (id: string, input: StartSprintInput) => string | null;
  /** Edit a future or active sprint. Returns an error message or null. */
  updateSprint: (id: string, patch: SprintPatch) => string | null;
  /** Deletes a future sprint; its issues go back to the backlog. */
  deleteSprint: (id: string) => DeletedSprintSnapshot | string;
  restoreSprint: (snap: DeletedSprintSnapshot) => void;
  /** Closes the active sprint; unfinished parents move with their sub-tasks to targetSprintId (null = backlog). */
  completeSprint: (id: string, targetSprintId: string | null, openSubtasks?: OpenSubtaskPolicy) => CompletedSprintSnapshot | null;
  undoCompleteSprint: (snap: CompletedSprintSnapshot) => void;

  /** Deletes issues (plus their sub-tasks, CRM links, issue links and comments). Returns what was removed. */
  deleteIssues: (ids: string[]) => DeletedIssuesSnapshot;
  restoreIssues: (snap: DeletedIssuesSnapshot) => void;

  /** "<from> blocks / relates to / duplicates <to>". Returns an error message or null. */
  addIssueLink: (fromIssueId: string, type: IssueLinkType, toIssueId: string) => string | null;
  removeIssueLink: (id: string) => IssueLink | null;
  restoreIssueLink: (link: IssueLink) => void;

  triageIssue: (id: string, action: TriageAction) => void;

  /** Creates a Jira-style project. Returns the id or an error message. */
  createProject: (input: NewProjectInput) => { id: string } | { error: string };
  /** Shared WIP limit for a status column (null removes it). */
  setProjectWip: (projectId: string, status: IssueStatus, limit: number | null) => void;
}

type Needs = AgileExtrasSlice & AgileExtrasData & {
  currentUserId: string;
  issues: Issue[];
  sprints: Sprint[];
  projects: Project[];
  epics: { id: string; projectId: string; key: string }[];
  crossLinks: CrossLink[];
  issueComments: IssueComment[];
  updateIssue: (id: string, patch: Partial<Issue>) => void;
  link: (input: { agileType: "issue" | "epic"; agileId: string; crmType: "contact" | "company" | "deal" | "ticket"; crmId: string; linkType: CrossLink["linkType"] }) => string | null;
};

const histValue = (f: TrackedIssueField, v: unknown): string | number | null => {
  if (v === undefined || v === null) return null;
  if (f === "labels") return (v as string[]).join(", ");
  if (f === "description") {
    const s = String(v).replace(/\s+/g, " ").trim();
    return s.length > 140 ? `${s.slice(0, 139)}…` : s;
  }
  return v as string | number;
};

export function createAgileExtrasSlice<S extends Needs>(set: SetFn<S>, get: GetFn<S>, uid: Uid): AgileExtrasSlice {
  const record = (entries: IssueHistoryEntry[]) => {
    if (!entries.length) return;
    const all = [...get().issueHistory, ...entries];
    // per-issue cap: walk from the newest, keep ISSUE_HISTORY_PER_ISSUE per issue
    const seen = new Map<string, number>();
    const keep: IssueHistoryEntry[] = [];
    for (let k = all.length - 1; k >= 0; k--) {
      const e = all[k]!;
      const c = (seen.get(e.issueId) ?? 0) + 1;
      seen.set(e.issueId, c);
      if (c <= ISSUE_HISTORY_PER_ISSUE) keep.push(e);
    }
    set({ issueHistory: keep.reverse() } as Partial<S>);
  };
  const note = (issueId: string, text: string) => record([{ id: uid("ih"), issueId, field: "created", from: null, to: null, actorId: get().currentUserId, at: nowIso(), note: text }]);

  const diff = (before: Issue, patch: Partial<Issue>): IssueHistoryEntry[] => {
    const actorId = get().currentUserId;
    const at = nowIso();
    const out: IssueHistoryEntry[] = [];
    TRACKED_ISSUE_FIELDS.forEach((f) => {
      if (!(f in patch)) return;
      const from = histValue(f, before[f]);
      const to = histValue(f, patch[f]);
      if (from === to) return;
      out.push({ id: uid("ih"), issueId: before.id, field: f, from, to, actorId, at });
    });
    return out;
  };

  /** Policy rules every edit goes through. */
  const normalize = (before: Issue, patch: Partial<Issue>): Partial<Issue> => {
    const s = get();
    const out: Partial<Issue> = { ...patch };
    if ("type" in patch) {
      const parentAfter = "parentId" in patch ? patch.parentId : before.parentId;
      if (patch.type === "subtask" && !parentAfter) delete out.type; // a sub-task needs a parent — use "Convert to sub-task"
      if (patch.type && patch.type !== "subtask" && before.parentId && !("parentId" in patch)) out.parentId = null;
    }
    if (patch.parentId) {
      const parent = s.issues.find((i) => i.id === patch.parentId);
      if (parent) {
        out.sprintId = parent.sprintId;
        out.epicId = parent.epicId;
      }
    }
    const sprintId = "sprintId" in out ? out.sprintId : before.sprintId;
    const sprint = sprintId ? s.sprints.find((sp) => sp.id === sprintId) : undefined;
    const status = out.status ?? before.status;
    if (sprint?.state === "active" && status === "backlog") {
      // explicitly setting "Backlog" on work in the running sprint takes it out of the sprint; anything else pulled
      // into the running sprint goes to To Do so it shows on the board
      if (patch.status === "backlog" && !("sprintId" in patch)) out.sprintId = null;
      else out.status = "todo";
    }
    return out;
  };

  /** Applies a normalised patch, records it, and carries sprint/epic to sub-tasks. */
  const apply = (before: Issue, patch: Partial<Issue>) => {
    const p = normalize(before, patch);
    if (!Object.keys(p).length) return;
    get().updateIssue(before.id, p);
    const entries = diff(before, p);
    if (before.type !== "subtask" && ("sprintId" in p || "epicId" in p)) {
      get()
        .issues.filter((c) => c.parentId === before.id)
        .forEach((c) => {
          const cp: Partial<Issue> = {};
          if ("sprintId" in p && c.sprintId !== p.sprintId) cp.sprintId = p.sprintId ?? null;
          if ("epicId" in p && c.epicId !== p.epicId) cp.epicId = p.epicId ?? null;
          if (!Object.keys(cp).length) return;
          const np = normalize(c, cp);
          get().updateIssue(c.id, np);
          entries.push(...diff(c, np));
        });
    }
    record(entries);
  };

  /** Renumber a project's ranks 1000, 2000… keeping the current order (rank, priority, key). */
  const renumber = (projectId: string) => {
    const weight: Record<Issue["priority"], number> = { highest: 5, high: 4, medium: 3, low: 2, lowest: 1 };
    const order = get()
      .issues.filter((i) => i.projectId === projectId)
      .sort((a, b) => a.rank - b.rank || weight[b.priority] - weight[a.priority] || keyNumber(a.key) - keyNumber(b.key));
    const rank = new Map(order.map((i, k) => [i.id, (k + 1) * 1000]));
    set((st) => ({ issues: st.issues.map((i) => (rank.has(i.id) ? { ...i, rank: rank.get(i.id)! } : i)) }) as Partial<S>);
  };

  const rankFor = (id: string, orderedIds: string[]): number | null => {
    const byId = new Map(get().issues.map((i) => [i.id, i]));
    const idx = orderedIds.indexOf(id);
    if (idx < 0) return null;
    const prev = idx > 0 ? byId.get(orderedIds[idx - 1]!)?.rank : undefined;
    const next = idx < orderedIds.length - 1 ? byId.get(orderedIds[idx + 1]!)?.rank : undefined;
    if (prev === undefined && next === undefined) return null;
    if (prev === undefined) return next! - 1000;
    if (next === undefined) return prev + 1000;
    if (next - prev > 1e-6) return (prev + next) / 2;
    return Number.NaN; // neighbours collide — renumber first
  };

  return {
    createIssue: (input) => {
      const s = get();
      const project = s.projects.find((p) => p.id === input.projectId);
      if (!project) return "";
      const maxKey = Math.max(
        s.issues.filter((i) => i.projectId === project.id).reduce((m, i) => Math.max(m, keyNumber(i.key)), 0),
        s.epics.filter((e) => e.projectId === project.id).reduce((m, e) => Math.max(m, keyNumber(e.key)), 0),
      );
      const num = Math.max(project.nextIssueNumber ?? 0, maxKey + 1);
      const { link, ...rest } = input;
      let type = rest.type;
      const notes: string[] = [];
      const parent = rest.parentId ? s.issues.find((i) => i.id === rest.parentId) : undefined;
      if (type === "subtask" && !parent) {
        type = "task";
        notes.push("Created as a task — a sub-task needs a parent issue");
      }
      let sprintId = parent ? parent.sprintId : (rest.sprintId ?? null);
      const epicId = parent ? parent.epicId : (rest.epicId ?? null);
      const sprint = sprintId ? s.sprints.find((sp) => sp.id === sprintId) : undefined;
      if (sprint && (sprint.projectId !== project.id || sprint.state === "closed")) sprintId = null;
      let status: IssueStatus = rest.status ?? "todo";
      if (sprint?.state === "active" && sprintId && status === "backlog") status = "todo";
      const reporterId = rest.reporterId ?? s.currentUserId;
      const fromCrm = !!link || type === "support_escalation" || type === "deal_action";
      const triage = rest.triage ?? (fromCrm && !sprintId && type !== "subtask" && reporterId !== project.leadId ? ("pending" as const) : undefined);
      const minRank = s.issues.filter((i) => i.projectId === project.id && i.status === status).reduce((m, i) => Math.min(m, i.rank), 1000);
      const id = uid("i");
      const ts = nowIso();
      const issue: Issue = {
        description: "",
        priority: "medium",
        assigneeId: null,
        storyPoints: null,
        labels: [],
        dueDate: null,
        ...rest,
        reporterId,
        type,
        parentId: parent ? parent.id : null,
        sprintId,
        epicId,
        status,
        ...(triage ? { triage } : {}),
        id,
        key: `${project.key}-${num}`,
        rank: minRank - 1000,
        createdAt: ts,
        updatedAt: ts,
      };
      set((st) => ({ issues: [...st.issues, issue], projects: st.projects.map((p) => (p.id === project.id ? { ...p, nextIssueNumber: num + 1 } : p)) }) as Partial<S>);
      if (link) get().link({ agileType: "issue", agileId: id, crmType: link.crmType, crmId: link.crmId, linkType: link.linkType });
      if (status !== (rest.status ?? "todo")) notes.push("Status set to To Do — it was created in the running sprint");
      if (triage === "pending") notes.push("Sent to triage — created from CRM / by someone outside the project lead");
      notes.forEach((n) => note(id, n));
      return id;
    },

    updateIssueTracked: (id, patch) => {
      const before = get().issues.find((i) => i.id === id);
      if (before) apply(before, patch);
    },

    moveIssueTracked: (id, patch, orderedIds) => {
      const before = get().issues.find((i) => i.id === id);
      if (!before) return;
      let rank = rankFor(id, orderedIds);
      if (rank !== null && Number.isNaN(rank)) {
        renumber(before.projectId);
        rank = rankFor(id, orderedIds);
        if (rank !== null && Number.isNaN(rank)) rank = null;
      }
      apply(get().issues.find((i) => i.id === id)!, rank === null ? patch : { ...patch, rank });
    },

    noteIssueHistory: (issueId, text) => note(issueId, text),

    captureIssues: (ids) => {
      const want = new Set(ids);
      const all = get().issues;
      all.forEach((i) => i.parentId && want.has(i.parentId) && want.add(i.id));
      return all
        .filter((i) => want.has(i.id))
        .map((i) => {
          const snap: IssueFieldSnapshot = { id: i.id };
          UNDO_FIELDS.forEach((f) => ((snap as Record<string, unknown>)[f] = i[f] ?? null));
          return snap;
        });
    },

    restoreIssueFields: (snap) => {
      const entries: IssueHistoryEntry[] = [];
      snap.forEach((sn) => {
        const before = get().issues.find((i) => i.id === sn.id);
        if (!before) return;
        const { id: _id, ...fields } = sn;
        const patch = fields as Partial<Issue>;
        get().updateIssue(sn.id, patch);
        entries.push(...diff(before, patch));
      });
      record(entries);
    },

    migrateLegacyIssueHistory: () => {
      if (typeof window === "undefined") return;
      try {
        const raw = window.localStorage.getItem(ISSUE_HISTORY_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as unknown;
        window.localStorage.removeItem(ISSUE_HISTORY_KEY);
        if (!Array.isArray(parsed)) return;
        const have = new Set(get().issueHistory.map((h) => h.id));
        const legacy = (parsed as IssueHistoryEntry[]).filter((h) => h && typeof h.id === "string" && !have.has(h.id));
        if (!legacy.length) return;
        const merged = [...get().issueHistory, ...legacy].sort((a, b) => a.at.localeCompare(b.at));
        set({ issueHistory: merged } as Partial<S>);
        record([]);
      } catch {
        /* storage blocked — nothing to migrate */
      }
    },

    createSprint: (projectId) => {
      const s = get();
      const project = s.projects.find((p) => p.id === projectId);
      if (!project) return "";
      const mine = s.sprints.filter((sp) => sp.projectId === projectId);
      const lastNo = mine.reduce((m, sp) => Math.max(m, sprintNumber(sp.name)), 0);
      const latest = mine.slice().sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
      const startMs = latest ? Math.max(Date.parse(latest.endDate) + DAY, Date.now()) : Date.now();
      const id = uid("sp");
      const sprint: Sprint = {
        id,
        projectId,
        name: `${project.key} Sprint ${lastNo + 1}`,
        goal: "",
        startDate: new Date(startMs).toISOString(),
        endDate: new Date(startMs + 13 * DAY).toISOString(),
        state: "future",
        capacity: latest?.capacity ?? 30,
        ...(latest?.memberCapacity ? { memberCapacity: { ...latest.memberCapacity } } : {}),
      };
      set((st) => ({ sprints: [...st.sprints, sprint] }) as Partial<S>);
      return id;
    },

    startSprint: (id, input) => {
      const s = get();
      const sprint = s.sprints.find((sp) => sp.id === id);
      if (!sprint) return "Sprint not found";
      const blocked = startBlocker(sprint, s.sprints);
      if (blocked) return blocked;
      if (!input.name.trim()) return "Give the sprint a name";
      if (!(Date.parse(input.endDate) > Date.parse(input.startDate))) return "End date must be after the start date";
      if (input.capacity !== undefined && !(input.capacity >= 0)) return "Capacity can't be negative";
      set(
        (st) =>
          ({
            sprints: st.sprints.map((sp) =>
              sp.id === id
                ? {
                    ...sp,
                    name: input.name.trim(),
                    goal: input.goal.trim(),
                    startDate: input.startDate,
                    endDate: input.endDate,
                    state: "active" as const,
                    ...(input.capacity !== undefined ? { capacity: Math.round(input.capacity) } : {}),
                    ...(input.memberCapacity ? { memberCapacity: input.memberCapacity } : {}),
                  }
                : sp,
            ),
          }) as Partial<S>,
      );
      // issues still in "Backlog" status would be hidden from the active board — bring them to To Do
      get()
        .issues.filter((i) => i.sprintId === id && i.status === "backlog")
        .forEach((i) => get().updateIssueTracked(i.id, { status: "todo" }));
      return null;
    },

    updateSprint: (id, patch) => {
      const sprint = get().sprints.find((sp) => sp.id === id);
      if (!sprint) return "Sprint not found";
      if (sprint.state === "closed") return `${sprint.name} is closed — closed sprints can't be edited`;
      const next = { ...sprint, ...patch };
      if (!next.name.trim()) return "Give the sprint a name";
      if (!(Date.parse(next.endDate) > Date.parse(next.startDate))) return "End date must be after the start date";
      if (!(next.capacity >= 0)) return "Capacity can't be negative";
      if (next.memberCapacity && Object.values(next.memberCapacity).some((v) => !(v >= 0))) return "Per-person capacity can't be negative";
      if (get().sprints.some((sp) => sp.id !== id && sp.projectId === sprint.projectId && sp.name.trim().toLowerCase() === next.name.trim().toLowerCase())) return `Another sprint is already called ${next.name.trim()}`;
      set((st) => ({ sprints: st.sprints.map((sp) => (sp.id === id ? { ...next, name: next.name.trim(), goal: next.goal.trim(), capacity: Math.round(next.capacity) } : sp)) }) as Partial<S>);
      return null;
    },

    deleteSprint: (id) => {
      const sprint = get().sprints.find((sp) => sp.id === id);
      if (!sprint) return "Sprint not found";
      if (sprint.state !== "future") return sprint.state === "active" ? `Complete ${sprint.name} instead — a running sprint can't be deleted` : "Closed sprints are kept for velocity and reports";
      const its = get().issues.filter((i) => i.sprintId === id);
      const snap: DeletedSprintSnapshot = { sprint: { ...sprint }, moved: its.map((i) => ({ id: i.id, sprintId: i.sprintId, status: i.status })) };
      its.forEach((i) => get().updateIssueTracked(i.id, { sprintId: null }));
      set((st) => ({ sprints: st.sprints.filter((sp) => sp.id !== id) }) as Partial<S>);
      return snap;
    },

    restoreSprint: (snap) => {
      if (get().sprints.some((sp) => sp.id === snap.sprint.id)) return;
      set((st) => ({ sprints: [...st.sprints, snap.sprint] }) as Partial<S>);
      snap.moved.forEach((m) => get().updateIssueTracked(m.id, { sprintId: m.sprintId, status: m.status }));
    },

    completeSprint: (id, targetSprintId, openSubtasks = "reopen") => {
      const s = get();
      const sprint = s.sprints.find((sp) => sp.id === id);
      if (!sprint || sprint.state !== "active") return null;
      const target = targetSprintId ? s.sprints.find((sp) => sp.id === targetSprintId && sp.projectId === sprint.projectId && sp.state === "future") : undefined;
      const targetId = target ? target.id : null;
      const inSprint = s.issues.filter((i) => i.sprintId === id);
      const childrenOf = (pid: string) => s.issues.filter((c) => c.parentId === pid);
      const statusChanges = new Map<string, IssueStatus>();
      const move = new Set<string>();
      inSprint
        .filter((i) => i.type !== "subtask")
        .forEach((p) => {
          const open = childrenOf(p.id).filter((c) => c.status !== "done");
          if (p.status !== "done") {
            move.add(p.id);
            open.forEach((c) => move.add(c.id));
          } else if (open.length) {
            if (openSubtasks === "close") open.forEach((c) => statusChanges.set(c.id, "done"));
            else {
              statusChanges.set(p.id, "in_progress");
              move.add(p.id);
              open.forEach((c) => move.add(c.id));
            }
          }
        });
      // sub-tasks whose parent isn't in this sprint travel on their own
      inSprint.filter((i) => i.type === "subtask" && i.status !== "done" && !inSprint.some((p) => p.id === i.parentId)).forEach((i) => move.add(i.id));

      const touched = new Set([...move, ...statusChanges.keys()]);
      const snap: CompletedSprintSnapshot = {
        sprint: { ...sprint },
        moved: s.issues.filter((i) => touched.has(i.id)).map((i) => ({ id: i.id, sprintId: i.sprintId, status: i.status })),
        reportId: uid("sr"),
      };
      statusChanges.forEach((st, iid) => {
        const before = get().issues.find((i) => i.id === iid);
        if (!before) return;
        get().updateIssue(iid, { status: st });
        record(diff(before, { status: st }));
      });
      const report = buildSprintReport(sprint, get().issues, get().issueHistory, { closedById: get().currentUserId, carriedTo: targetId, id: snap.reportId });
      set((st) => ({ sprints: st.sprints.map((sp) => (sp.id === id ? { ...sp, state: "closed" as const } : sp)), sprintReports: [...st.sprintReports.filter((r) => r.sprintId !== id), report] }) as Partial<S>);
      move.forEach((iid) => {
        const before = get().issues.find((i) => i.id === iid);
        if (!before || before.sprintId === targetId) return;
        // direct update: the cascade from parents would otherwise double-move sub-tasks
        get().updateIssue(iid, { sprintId: targetId });
        record(diff(before, { sprintId: targetId }));
      });
      return snap;
    },

    undoCompleteSprint: (snap) => {
      const active = get().sprints.find((sp) => sp.projectId === snap.sprint.projectId && sp.state === "active" && sp.id !== snap.sprint.id);
      if (active) return;
      set((st) => ({ sprints: st.sprints.map((sp) => (sp.id === snap.sprint.id ? snap.sprint : sp)), sprintReports: st.sprintReports.filter((r) => r.id !== snap.reportId) }) as Partial<S>);
      snap.moved.forEach((m) => {
        const before = get().issues.find((i) => i.id === m.id);
        if (!before) return;
        get().updateIssue(m.id, { sprintId: m.sprintId, status: m.status });
        record(diff(before, { sprintId: m.sprintId, status: m.status }));
      });
    },

    deleteIssues: (ids) => {
      const s = get();
      const doomed = new Set(ids);
      // include sub-tasks (recursively) so nothing is left orphaned
      let grew = true;
      while (grew) {
        grew = false;
        s.issues.forEach((i) => {
          if (i.parentId && doomed.has(i.parentId) && !doomed.has(i.id)) {
            doomed.add(i.id);
            grew = true;
          }
        });
      }
      const gone = s.issues.filter((i) => doomed.has(i.id));
      const snap: DeletedIssuesSnapshot = {
        issues: gone,
        crossLinks: s.crossLinks.filter((x) => x.agileType === "issue" && doomed.has(x.agileId)),
        issueComments: s.issueComments.filter((c) => doomed.has(c.issueId)),
        issueLinks: s.issueLinks.filter((l) => doomed.has(l.fromIssueId) || doomed.has(l.toIssueId)),
      };
      // keys are never handed out again: move each project's counter past the deleted keys
      const maxByProject = new Map<string, number>();
      gone.forEach((i) => maxByProject.set(i.projectId, Math.max(maxByProject.get(i.projectId) ?? 0, keyNumber(i.key))));
      set(
        (st) =>
          ({
            issues: st.issues.filter((i) => !doomed.has(i.id)),
            crossLinks: st.crossLinks.filter((x) => !(x.agileType === "issue" && doomed.has(x.agileId))),
            issueComments: st.issueComments.filter((c) => !doomed.has(c.issueId)),
            issueLinks: st.issueLinks.filter((l) => !doomed.has(l.fromIssueId) && !doomed.has(l.toIssueId)),
            projects: st.projects.map((p) => {
              const m = maxByProject.get(p.id);
              if (m === undefined) return p;
              const current = Math.max(p.nextIssueNumber ?? 0, st.issues.filter((i) => i.projectId === p.id).reduce((x, i) => Math.max(x, keyNumber(i.key)), 0) + 1);
              return { ...p, nextIssueNumber: Math.max(current, m + 1) };
            }),
          }) as Partial<S>,
      );
      return snap;
    },

    restoreIssues: (snap) => {
      const renamed: { id: string; from: string; to: string }[] = [];
      set((st) => {
        const haveI = new Set(st.issues.map((i) => i.id));
        const haveX = new Set(st.crossLinks.map((x) => x.id));
        const haveC = new Set(st.issueComments.map((c) => c.id));
        const haveL = new Set(st.issueLinks.map((l) => l.id));
        const keys = new Set(st.issues.map((i) => i.key));
        const counters = new Map(st.projects.map((p) => [p.id, p.nextIssueNumber ?? 0]));
        const back = snap.issues
          .filter((i) => !haveI.has(i.id))
          .map((i) => {
            if (!keys.has(i.key)) return i;
            // the key was taken meanwhile (another device created it) — give the restored issue a fresh one
            const project = st.projects.find((p) => p.id === i.projectId);
            const n = Math.max(counters.get(i.projectId) ?? 0, ...st.issues.filter((x) => x.projectId === i.projectId).map((x) => keyNumber(x.key) + 1));
            counters.set(i.projectId, n + 1);
            const key = `${project?.key ?? i.key.split("-")[0]}-${n}`;
            renamed.push({ id: i.id, from: i.key, to: key });
            return { ...i, key };
          });
        const restoredIds = new Set([...st.issues.map((i) => i.id), ...back.map((i) => i.id)]);
        return {
          issues: [...st.issues, ...back],
          crossLinks: [...st.crossLinks, ...snap.crossLinks.filter((x) => !haveX.has(x.id))],
          issueComments: [...st.issueComments, ...snap.issueComments.filter((c) => !haveC.has(c.id))],
          issueLinks: [...st.issueLinks, ...(snap.issueLinks ?? []).filter((l) => !haveL.has(l.id) && restoredIds.has(l.fromIssueId) && restoredIds.has(l.toIssueId))],
          projects: st.projects.map((p) => (counters.get(p.id) !== (p.nextIssueNumber ?? 0) ? { ...p, nextIssueNumber: counters.get(p.id) } : p)),
        } as Partial<S>;
      });
      renamed.forEach((r) => note(r.id, `Restored as ${r.to} — ${r.from} had been reused`));
    },

    addIssueLink: (fromIssueId, type, toIssueId) => {
      const s = get();
      const from = s.issues.find((i) => i.id === fromIssueId);
      const to = s.issues.find((i) => i.id === toIssueId);
      if (!from || !to) return "Issue not found";
      if (from.id === to.id) return "An issue can't link to itself";
      const dup = s.issueLinks.find((l) => l.type === type && ((l.fromIssueId === from.id && l.toIssueId === to.id) || (type !== "blocks" && l.fromIssueId === to.id && l.toIssueId === from.id)));
      if (dup) return `${from.key} is already linked to ${to.key}`;
      if (type === "blocks") {
        if (s.issueLinks.some((l) => l.type === "blocks" && l.fromIssueId === to.id && l.toIssueId === from.id)) return `${to.key} already blocks ${from.key} — that would be a circular dependency`;
        // transitive cycle: does `to` (directly or indirectly) block `from`?
        const seen = new Set<string>();
        const stack = [to.id];
        while (stack.length) {
          const cur = stack.pop()!;
          if (cur === from.id) return `${to.key} already blocks ${from.key} through other issues — that would be a circular dependency`;
          if (seen.has(cur)) continue;
          seen.add(cur);
          s.issueLinks.filter((l) => l.type === "blocks" && l.fromIssueId === cur).forEach((l) => stack.push(l.toIssueId));
        }
      }
      const link: IssueLink = { id: uid("il"), fromIssueId: from.id, toIssueId: to.id, type, createdAt: nowIso(), createdById: s.currentUserId };
      set((st) => ({ issueLinks: [...st.issueLinks, link] }) as Partial<S>);
      const verb = type === "blocks" ? "blocks" : type === "duplicates" ? "duplicates" : "relates to";
      note(from.id, `Linked: ${verb} ${to.key}`);
      note(to.id, `Linked: ${from.key} ${verb} this issue`);
      return null;
    },

    removeIssueLink: (id) => {
      const link = get().issueLinks.find((l) => l.id === id);
      if (!link) return null;
      set((st) => ({ issueLinks: st.issueLinks.filter((l) => l.id !== id) }) as Partial<S>);
      const from = get().issues.find((i) => i.id === link.fromIssueId);
      const to = get().issues.find((i) => i.id === link.toIssueId);
      if (from && to) {
        note(from.id, `Unlinked from ${to.key}`);
        note(to.id, `Unlinked from ${from.key}`);
      }
      return link;
    },

    restoreIssueLink: (link) => {
      if (get().issueLinks.some((l) => l.id === link.id)) return;
      set((st) => ({ issueLinks: [...st.issueLinks, link] }) as Partial<S>);
    },

    triageIssue: (id, action) => {
      const before = get().issues.find((i) => i.id === id);
      if (!before) return;
      if (action.kind === "accept") {
        const patch: Partial<Issue> = { triage: "accepted", snoozedUntil: null };
        if (action.sprintId !== undefined) patch.sprintId = action.sprintId;
        apply(before, patch);
        const sp = action.sprintId ? get().sprints.find((x) => x.id === action.sprintId) : undefined;
        note(id, `Accepted from triage${sp ? ` into ${sp.name}` : " into the backlog"}`);
      } else if (action.kind === "decline") {
        apply(before, { triage: "declined", triageNote: action.reason.trim(), snoozedUntil: null });
        note(id, `Declined in triage${action.reason.trim() ? `: ${action.reason.trim()}` : ""}`);
      } else if (action.kind === "duplicate") {
        const of = get().issues.find((i) => i.id === action.ofIssueId);
        if (!of || of.id === id) return;
        apply(before, { triage: "declined", duplicateOfId: of.id, triageNote: `Duplicate of ${of.key}`, snoozedUntil: null });
        if (!get().issueLinks.some((l) => l.type === "duplicates" && l.fromIssueId === id && l.toIssueId === of.id)) get().addIssueLink(id, "duplicates", of.id);
        note(id, `Closed in triage as a duplicate of ${of.key}`);
      } else if (action.kind === "snooze") {
        apply(before, { snoozedUntil: action.until });
        note(id, `Snoozed in triage until ${wibDayKey(action.until)}`);
      } else {
        apply(before, { triage: "pending", sprintId: null, snoozedUntil: null, duplicateOfId: null, triageNote: "" });
        note(id, "Sent to triage");
      }
    },

    createProject: (input) => {
      const key = input.key.trim().toUpperCase();
      const name = input.name.trim();
      if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) return { error: "Key: 2–10 letters or digits, starting with a letter (e.g. MGE)" };
      if (get().projects.some((p) => p.key === key)) return { error: `Key ${key} is already used by another project` };
      if (name.length < 2) return { error: "Give the project a name" };
      if (get().projects.some((p) => p.name.trim().toLowerCase() === name.toLowerCase())) return { error: `A project called ${name} already exists` };
      const id = uid("pr");
      const project: Project = { id, key, name, leadId: input.leadId, description: input.description?.trim() ?? "", color: input.color, nextIssueNumber: 1 };
      set((st) => ({ projects: [...st.projects, project] }) as Partial<S>);
      if (input.withSprint) get().createSprint(id);
      return { id };
    },

    setProjectWip: (projectId, status, limit) =>
      set(
        (st) =>
          ({
            projects: st.projects.map((p) => {
              if (p.id !== projectId) return p;
              const next = { ...(p.wipLimits ?? {}) };
              if (limit && limit > 0) next[status] = Math.round(limit);
              else delete next[status];
              return { ...p, wipLimits: next };
            }),
          }) as Partial<S>,
      ),
  };
}
