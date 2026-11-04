/* Store slice "AgileExtras" — sprint lifecycle, tracked issue edits (activity history), bulk delete/restore. */
import type { CrossLink, Issue, IssueComment, IssueStatus, Project, Sprint } from "../types";
import type { GetFn, SetFn, Uid } from "./types";

/* ───────────── issue activity history (persisted in its own localStorage key) ───────────── */

export const ISSUE_HISTORY_KEY = "sg-crm-issue-history";
export const ISSUE_HISTORY_CAP = 500;

/** Fields whose changes are recorded in the drawer's History section. */
export const TRACKED_ISSUE_FIELDS = ["status", "assigneeId", "priority", "sprintId", "storyPoints", "epicId", "parentId", "type"] as const;
export type TrackedIssueField = (typeof TRACKED_ISSUE_FIELDS)[number];

export interface IssueHistoryEntry {
  id: string;
  issueId: string;
  /** a tracked field, or "created" for clone/creation notes */
  field: TrackedIssueField | "created";
  from: string | number | null;
  to: string | number | null;
  actorId: string;
  at: string;
  note?: string;
}

function loadHistory(): IssueHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ISSUE_HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as IssueHistoryEntry[]).slice(-ISSUE_HISTORY_CAP) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: IssueHistoryEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ISSUE_HISTORY_KEY, JSON.stringify(entries));
  } catch {
    /* storage full or blocked — history stays in memory for this session */
  }
}

/* ───────────── snapshots for undo ───────────── */

export interface DeletedIssuesSnapshot {
  issues: Issue[];
  crossLinks: CrossLink[];
  issueComments: IssueComment[];
}

export interface CompletedSprintSnapshot {
  sprint: Sprint;
  moved: { id: string; sprintId: string | null; status: IssueStatus }[];
}

export interface StartSprintInput {
  name: string;
  startDate: string;
  endDate: string;
  goal: string;
}

export interface AgileExtrasSlice {
  issueHistory: IssueHistoryEntry[];
  /** updateIssue + record the diff of tracked fields (actor = current user). */
  updateIssueTracked: (id: string, patch: Partial<Issue>) => void;
  /** moveIssue (re-rank a list) + record the diff of tracked fields. */
  moveIssueTracked: (id: string, patch: Partial<Issue>, orderedIds: string[]) => void;
  /** Append a free-form history note (e.g. "Cloned from UAV-101"). */
  noteIssueHistory: (issueId: string, note: string) => void;

  /** Adds the next numbered future sprint to a project; returns its id. */
  createSprint: (projectId: string) => string;
  /** Starts a future sprint. Returns an error message when blocked, otherwise null. */
  startSprint: (id: string, input: StartSprintInput) => string | null;
  /** Closes the active sprint; incomplete issues move to targetSprintId (null = backlog). */
  completeSprint: (id: string, targetSprintId: string | null) => CompletedSprintSnapshot | null;
  undoCompleteSprint: (snap: CompletedSprintSnapshot) => void;

  /** Deletes issues (plus their sub-tasks, CRM links and comments). Returns what was removed. */
  deleteIssues: (ids: string[]) => DeletedIssuesSnapshot;
  restoreIssues: (snap: DeletedIssuesSnapshot) => void;
}

type Needs = AgileExtrasSlice & {
  currentUserId: string;
  issues: Issue[];
  sprints: Sprint[];
  projects: Project[];
  crossLinks: CrossLink[];
  issueComments: IssueComment[];
  updateIssue: (id: string, patch: Partial<Issue>) => void;
  moveIssue: (id: string, patch: Partial<Issue>, orderedColumnIds: string[]) => void;
};

const DAY = 86_400_000;
const nowIso = () => new Date().toISOString();

export function sprintNumber(name: string): number {
  const m = name.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

export function createAgileExtrasSlice<S extends Needs>(set: SetFn<S>, get: GetFn<S>, uid: Uid): AgileExtrasSlice {
  const record = (entries: IssueHistoryEntry[]) => {
    if (!entries.length) return;
    const next = [...get().issueHistory, ...entries].slice(-ISSUE_HISTORY_CAP);
    set({ issueHistory: next } as Partial<S>);
    saveHistory(next);
  };

  const diff = (before: Issue, patch: Partial<Issue>): IssueHistoryEntry[] => {
    const actorId = get().currentUserId;
    const at = nowIso();
    const out: IssueHistoryEntry[] = [];
    TRACKED_ISSUE_FIELDS.forEach((f) => {
      if (!(f in patch)) return;
      const from = (before[f] ?? null) as string | number | null;
      const to = (patch[f] ?? null) as string | number | null;
      if (from === to) return;
      out.push({ id: uid("ih"), issueId: before.id, field: f, from, to, actorId, at });
    });
    return out;
  };

  return {
    issueHistory: loadHistory(),

    updateIssueTracked: (id, patch) => {
      const before = get().issues.find((i) => i.id === id);
      if (!before) return;
      get().updateIssue(id, patch);
      record(diff(before, patch));
    },

    moveIssueTracked: (id, patch, orderedIds) => {
      const before = get().issues.find((i) => i.id === id);
      if (!before) return;
      get().moveIssue(id, patch, orderedIds);
      record(diff(before, patch));
    },

    noteIssueHistory: (issueId, note) => record([{ id: uid("ih"), issueId, field: "created", from: null, to: null, actorId: get().currentUserId, at: nowIso(), note }]),

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
      };
      set((st) => ({ sprints: [...st.sprints, sprint] }) as Partial<S>);
      return id;
    },

    startSprint: (id, input) => {
      const s = get();
      const sprint = s.sprints.find((sp) => sp.id === id);
      if (!sprint) return "Sprint not found";
      if (sprint.state !== "future") return `${sprint.name} is not a future sprint`;
      const active = s.sprints.find((sp) => sp.projectId === sprint.projectId && sp.state === "active");
      if (active) return `Complete ${active.name} first — a project can only have one active sprint`;
      if (!input.name.trim()) return "Give the sprint a name";
      if (!(Date.parse(input.endDate) > Date.parse(input.startDate))) return "End date must be after the start date";
      set((st) => ({ sprints: st.sprints.map((sp) => (sp.id === id ? { ...sp, name: input.name.trim(), goal: input.goal.trim(), startDate: input.startDate, endDate: input.endDate, state: "active" as const } : sp)) }) as Partial<S>);
      // issues still in "Backlog" status would be hidden from the active board — bring them to To Do
      get()
        .issues.filter((i) => i.sprintId === id && i.status === "backlog")
        .forEach((i) => get().updateIssueTracked(i.id, { status: "todo" }));
      return null;
    },

    completeSprint: (id, targetSprintId) => {
      const s = get();
      const sprint = s.sprints.find((sp) => sp.id === id);
      if (!sprint || sprint.state !== "active") return null;
      const target = targetSprintId ? s.sprints.find((sp) => sp.id === targetSprintId && sp.projectId === sprint.projectId && sp.state === "future") : undefined;
      const targetId = target ? target.id : null;
      const incomplete = s.issues.filter((i) => i.sprintId === id && i.status !== "done");
      const snap: CompletedSprintSnapshot = { sprint: { ...sprint }, moved: incomplete.map((i) => ({ id: i.id, sprintId: i.sprintId, status: i.status })) };
      set((st) => ({ sprints: st.sprints.map((sp) => (sp.id === id ? { ...sp, state: "closed" as const } : sp)) }) as Partial<S>);
      incomplete.forEach((i) => get().updateIssueTracked(i.id, { sprintId: targetId }));
      return snap;
    },

    undoCompleteSprint: (snap) => {
      const active = get().sprints.find((sp) => sp.projectId === snap.sprint.projectId && sp.state === "active" && sp.id !== snap.sprint.id);
      if (active) return;
      set((st) => ({ sprints: st.sprints.map((sp) => (sp.id === snap.sprint.id ? snap.sprint : sp)) }) as Partial<S>);
      snap.moved.forEach((m) => get().updateIssueTracked(m.id, { sprintId: m.sprintId, status: m.status }));
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
      const snap: DeletedIssuesSnapshot = {
        issues: s.issues.filter((i) => doomed.has(i.id)),
        crossLinks: s.crossLinks.filter((x) => x.agileType === "issue" && doomed.has(x.agileId)),
        issueComments: s.issueComments.filter((c) => doomed.has(c.issueId)),
      };
      set(
        (st) =>
          ({
            issues: st.issues.filter((i) => !doomed.has(i.id)),
            crossLinks: st.crossLinks.filter((x) => !(x.agileType === "issue" && doomed.has(x.agileId))),
            issueComments: st.issueComments.filter((c) => !doomed.has(c.issueId)),
          }) as Partial<S>,
      );
      return snap;
    },

    restoreIssues: (snap) =>
      set((st) => {
        const haveI = new Set(st.issues.map((i) => i.id));
        const haveX = new Set(st.crossLinks.map((x) => x.id));
        const haveC = new Set(st.issueComments.map((c) => c.id));
        return {
          issues: [...st.issues, ...snap.issues.filter((i) => !haveI.has(i.id))],
          crossLinks: [...st.crossLinks, ...snap.crossLinks.filter((x) => !haveX.has(x.id))],
          issueComments: [...st.issueComments, ...snap.issueComments.filter((c) => !haveC.has(c.id))],
        } as Partial<S>;
      }),
  };
}
