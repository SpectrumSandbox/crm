/* Extra persisted + synced collections for the "agile" workstream. Every key must be an array (it is spread into
 * the seed bundle in src/lib/seed.ts, persisted to localStorage and synced to the D1 workspace snapshot).
 * Pure TypeScript with type-only imports (scripts/generate-seed-sql.ts compiles the seed standalone). */
import type { IssueHistoryEntry, IssueLink, SprintReport } from "../types";

/** Same anchor as src/lib/seed.ts (Wed 4 Nov 2026, 09:00 WIB) — redeclared to avoid a circular import. */
const ANCHOR = Date.UTC(2026, 10, 4, 2, 0, 0);
const DAY = 86_400_000;
const at = (days: number, hour = 9, minute = 0) => new Date(ANCHOR + days * DAY + (hour - 9) * 3_600_000 + minute * 60_000).toISOString();
const iid = (key: string) => `i-${key.toLowerCase()}`;

let n = 0;
const h = (key: string, field: IssueHistoryEntry["field"], from: string | number | null, to: string | number | null, actorId: string, days: number, hour = 11): IssueHistoryEntry => ({
  id: `ih-seed-${++n}`,
  issueId: iid(key),
  field,
  from,
  to,
  actorId,
  at: at(days, hour),
});

/** Status and scope history for the active sprints (sprints started 9 days before the anchor). */
const issueHistory: IssueHistoryEntry[] = [
  // UAV Sprint 24
  h("UAV-109", "status", "todo", "in_progress", "u-dimas", -8, 10),
  h("UAV-109", "status", "in_progress", "done", "u-dimas", -6, 16),
  h("UAV-107", "status", "todo", "in_progress", "u-dimas", -7, 9),
  h("UAV-107", "status", "in_progress", "in_review", "u-dimas", -4, 15),
  h("UAV-107", "status", "in_review", "done", "u-ayu", -3, 11),
  h("UAV-114", "status", "in_progress", "done", "u-ayu", -5, 14),
  h("UAV-112", "sprintId", null, "sp-uav-24", "u-ayu", -4, 9),
  h("UAV-112", "status", "todo", "in_progress", "u-ayu", -4, 10),
  h("UAV-103", "status", "in_progress", "in_review", "u-dimas", -1, 17),
  // IOT Sprint 32
  h("IOT-207", "status", "todo", "in_progress", "u-dimas", -8, 13),
  h("IOT-207", "status", "in_progress", "done", "u-dimas", -5, 16),
  h("IOT-214", "status", "in_progress", "done", "u-dimas", -6, 18),
  h("IOT-204", "sprintId", null, "sp-iot-32", "u-dimas", -2, 10),
  h("IOT-202", "status", "in_progress", "in_review", "u-nadia", -2, 15),
  // SWD Sprint 18
  h("SWD-308", "status", "in_progress", "in_review", "u-nadia", -7, 15),
  h("SWD-308", "status", "in_review", "done", "u-kevin", -6, 10),
  h("SWD-301", "status", "in_progress", "in_review", "u-kevin", -2, 16),
  h("SWD-307", "status", "in_progress", "in_review", "u-kevin", -1, 11),
];

let l = 0;
const link = (from: string, type: IssueLink["type"], to: string, days: number, by: string): IssueLink => ({ id: `il-seed-${++l}`, fromIssueId: iid(from), toIssueId: iid(to), type, createdAt: at(days, 10), createdById: by });

/** Dependencies between delivery issues ("from blocks to"). */
const issueLinks: IssueLink[] = [
  link("UAV-102", "blocks", "UAV-104", -8, "u-ayu"),
  link("UAV-106", "blocks", "UAV-110", -7, "u-ayu"),
  link("UAV-112", "relates_to", "UAV-102", -4, "u-ayu"),
  link("IOT-202", "blocks", "IOT-203", -9, "u-dimas"),
  link("IOT-204", "relates_to", "IOT-201", -2, "u-dimas"),
  link("SWD-304", "blocks", "SWD-303", -9, "u-kevin"),
  link("SWD-303", "blocks", "SWD-305", -9, "u-kevin"),
];

const report = (sprintId: string, projectId: string, sprintName: string, committed: [number, number], added: [number, number], removed: [number, number], completed: [number, number], closedById: string, daily: number[]): SprintReport => {
  const startMs = ANCHOR - 23 * DAY;
  return {
    id: `sr-${sprintId}`,
    sprintId,
    projectId,
    sprintName,
    startDate: at(-23),
    endDate: at(-10),
    closedAt: at(-10, 17),
    closedById,
    committed: { count: committed[0], points: committed[1] },
    added: { count: added[0], points: added[1] },
    removed: { count: removed[0], points: removed[1] },
    completed: { count: completed[0], points: completed[1] },
    carriedOver: { count: committed[0] + added[0] - removed[0] - completed[0], points: committed[1] + added[1] - removed[1] - completed[1] },
    carriedToSprintId: null,
    daily: daily.map((remaining, d) => ({ day: new Date(startMs + d * DAY + 7 * 3_600_000).toISOString().slice(0, 10), remaining })),
  };
};

/** Reports for the closed seed sprints (their history predates the app, so the figures are recorded here). */
const sprintReports: SprintReport[] = [
  report("sp-uav-23", "pr-uav", "UAV Sprint 23", [11, 33], [1, 3], [1, 2], [10, 31], "u-ayu", [33, 33, 31, 28, 28, 25, 22, 22, 19, 14, 11, 8, 5, 3]),
  report("sp-iot-31", "pr-iot", "IOT Sprint 31", [10, 29], [1, 2], [0, 0], [9, 27], "u-dimas", [29, 29, 27, 27, 24, 21, 21, 18, 15, 12, 10, 7, 4, 4]),
  report("sp-swd-17", "pr-swd", "SWD Sprint 17", [12, 41], [0, 0], [1, 3], [11, 36], "u-fajar", [41, 41, 38, 38, 35, 33, 30, 25, 22, 22, 17, 12, 8, 2]),
];

export const agileSeed = {
  issueHistory,
  issueLinks,
  sprintReports,
};
