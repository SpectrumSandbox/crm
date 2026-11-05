/* Extra persisted + synced collections for the "automation" workstream. Every key must be an array (it is spread into
 * the seed bundle in src/lib/seed.ts, persisted to localStorage and synced to the D1 workspace snapshot).
 * NOTE: seed.ts imports this module before its own data is defined, so nothing here may import values from seed.ts. */
import type {
  AssignmentCursor,
  AutomationNotice,
  PipelineSnapshot,
  SalesTarget,
  SequenceEvent,
  SnapshotDeal,
  WorkflowRun,
} from "../automation-types";

/** Same anchor as seed.ts: Wed 4 Nov 2026, 09:00 WIB. */
const SEED_NOW = Date.UTC(2026, 10, 4, 2, 0, 0);
const DAY = 86_400_000;
const at = (days: number, hour = 9, minute = 0) => new Date(SEED_NOW + days * DAY + (hour - 9) * 3_600_000 + minute * 60_000).toISOString();
const M = 1_000_000;

/* ───────────── workflow run log ───────────── */

const workflowRuns: WorkflowRun[] = [
  {
    id: "wr-seed-1",
    workflowId: "wf-1",
    workflowName: "Closed-won → Onboarding epic",
    at: at(-12, 11, 2),
    source: "event",
    event: "stage_changed",
    object: "deal",
    recordId: "d-sbs-pdm",
    recordLabel: "SBS — Blast Furnace Predictive Maintenance",
    outcome: "success",
    steps: [
      { kind: "create_epic", ok: true, detail: "Created epic IOT-2 SBS Predictive Maintenance Onboarding", href: "/board?project=pr-iot" },
      { kind: "create_issues", ok: true, detail: "Created 5 onboarding issues in IOT" },
    ],
    actorId: "u-arif",
  },
  {
    id: "wr-seed-2",
    workflowId: "wf-2",
    workflowName: "Escalated bug done → resolve ticket",
    at: at(-16, 15, 40),
    source: "event",
    event: "status_changed",
    object: "issue",
    recordId: "i-swd-298",
    recordLabel: "SWD-298 Safari SSO redirect loop (archived)",
    outcome: "success",
    steps: [
      { kind: "update_ticket_stage", ok: true, detail: "T-1008 moved to Resolved", href: "/tickets/t-1008" },
      { kind: "email_contact", ok: true, detail: "Logged email to Dian Permata (Ticket resolved)", href: "/contacts/k-dian" },
    ],
    actorId: "u-nadia",
  },
  {
    id: "wr-seed-3",
    workflowId: "wf-2",
    workflowName: "Escalated bug done → resolve ticket",
    at: at(-24, 10, 15),
    source: "event",
    event: "status_changed",
    object: "issue",
    recordId: "i-uav-097",
    recordLabel: "UAV-097 Thruster controller watchdog reset (archived)",
    outcome: "partial",
    steps: [
      { kind: "update_ticket_stage", ok: true, detail: "Linked ticket moved to Resolved" },
      { kind: "email_contact", ok: false, detail: "Template tpl-resolved not found — add “Ticket resolved” from the starter library" },
    ],
    actorId: "u-ayu",
  },
];

/* ───────────── notices from the notify action ───────────── */

const automationNotices: AutomationNotice[] = [
  { id: "an-seed-1", userId: "u-ben", title: "Deal closed won: SBS — Blast Furnace Predictive Maintenance", body: "Onboarding epic IOT-2 was created automatically. Propose the initiative within 30 days of first contact (§4.1).", href: "/deals/d-sbs-pdm", at: at(-12, 11, 2), readAt: null, workflowId: "wf-1" },
  { id: "an-seed-2", userId: "u-yoga", title: "Ticket T-1008 resolved by engineering", body: "SWD fix shipped; the customer was emailed.", href: "/tickets/t-1008", at: at(-16, 15, 40), readAt: at(-16, 16), workflowId: "wf-2" },
];

/* ───────────── sequence history ───────────── */

const sequenceEvents: SequenceEvent[] = [
  { id: "sqe-1", enrollmentId: "se-1", sequenceId: "seq-outbound", contactId: "k-gilang", at: at(-4), kind: "enrolled", actorId: "u-rani" },
  { id: "sqe-2", enrollmentId: "se-1", sequenceId: "seq-outbound", contactId: "k-gilang", at: at(-4, 9, 5), kind: "executed", stepId: "ss-1", stepOrder: 1, channel: "email", actorId: "u-rani", note: "Intro — deep-tech partner" },
  { id: "sqe-3", enrollmentId: "se-2", sequenceId: "seq-outbound", contactId: "k-tasya", at: at(-30), kind: "enrolled", actorId: "u-rani" },
  { id: "sqe-4", enrollmentId: "se-2", sequenceId: "seq-outbound", contactId: "k-tasya", at: at(-30, 9, 10), kind: "executed", stepId: "ss-1", stepOrder: 1, channel: "email", actorId: "u-rani" },
  { id: "sqe-5", enrollmentId: "se-2", sequenceId: "seq-outbound", contactId: "k-tasya", at: at(-27, 10), kind: "executed", stepId: "ss-2", stepOrder: 2, channel: "call", actorId: "u-rani", note: "No answer" },
  { id: "sqe-6", enrollmentId: "se-2", sequenceId: "seq-outbound", contactId: "k-tasya", at: at(-23, 9), kind: "executed", stepId: "ss-3", stepOrder: 3, channel: "email", actorId: "u-rani" },
  { id: "sqe-7", enrollmentId: "se-2", sequenceId: "seq-outbound", contactId: "k-tasya", at: at(-16, 14), kind: "skipped", stepId: "ss-4", stepOrder: 4, channel: "task", actorId: "u-rani", note: "Not on LinkedIn" },
  { id: "sqe-8", enrollmentId: "se-2", sequenceId: "seq-outbound", contactId: "k-tasya", at: at(-16, 14, 1), kind: "finished", actorId: "u-rani", note: "All steps done" },
  { id: "sqe-9", enrollmentId: "se-3", sequenceId: "seq-event", contactId: "k-bayu", at: at(-2), kind: "enrolled", actorId: "u-sinta" },
  { id: "sqe-10", enrollmentId: "se-4", sequenceId: "seq-event", contactId: "k-yanti", at: at(-17), kind: "enrolled", actorId: "u-sinta" },
  { id: "sqe-11", enrollmentId: "se-4", sequenceId: "seq-event", contactId: "k-yanti", at: at(-16, 9), kind: "executed", stepId: "ss-5", stepOrder: 1, channel: "email", actorId: "u-sinta" },
  { id: "sqe-12", enrollmentId: "se-4", sequenceId: "seq-event", contactId: "k-yanti", at: at(-16, 10), kind: "replied", actorId: "u-sinta", note: "Connected call — fire season planning" },
];

/* ───────────── pipeline snapshots ("what changed this week") ───────────── */

type R = [id: string, name: string, amountM: number, pipelineId: string, stageId: string, closeDays: number, ownerId: string];
const snap = (rows: R[]): SnapshotDeal[] => rows.map(([id, name, a, pipelineId, stageId, closeDays, ownerId]) => ({ id, name, amount: a * M, pipelineId, stageId, closeDate: at(closeDays, 17), ownerId }));

const weekAgo: R[] = [
  ["d-nhs-asv", "NHS — Autonomous Survey Vessel Retrofit", 7_900, "pl-new", "st-proposal", 18, "u-sinta"],
  ["d-nhs-ai", "NHS — Seabed Classification AI", 2_150, "pl-new", "st-proposal", 32, "u-sinta"],
  ["d-aam-vtol", "AAM — VTOL Mapping Fleet (6 units)", 5_700, "pl-new", "st-solution", 45, "u-sinta"],
  ["d-aam-train", "AAM — Pilot & Maintenance Training", 640, "pl-new", "st-discovery", 60, "u-sinta"],
  ["d-sbs-pdm", "SBS — Blast Furnace Predictive Maintenance", 6_900, "pl-new", "st-won", -12, "u-arif"],
  ["d-sbs-ot", "SBS — OT Network Segmentation", 1_850, "pl-new", "st-solution", 25, "u-arif"],
  ["d-bap-crop", "BAP — Drone Crop Health Pilot (Sampit)", 1_250, "pl-new", "st-proposal", 5, "u-arif"],
  ["d-bap-group", "BAP — Group-wide Remote Sensing Programme", 9_800, "pl-new", "st-discovery", 120, "u-rani"],
  ["d-spl-crane", "SPL — Crane Telemetry Phase 2", 3_300, "pl-new", "st-won", -35, "u-rani"],
  ["d-spl-twin", "SPL — Terminal Digital Twin", 4_750, "pl-new", "st-solution", 70, "u-rani"],
  ["d-mge-sensor", "MGE — Wellhead Sensor Network", 2_900, "pl-new", "st-solution", 10, "u-arif"],
  ["d-mge-ctl", "MGE — Turbine Control Upgrade Study", 480, "pl-new", "st-qualified", 40, "u-arif"],
  ["d-apg-scada", "APG — SCADA Modernisation Phase 1", 11_500, "pl-new", "st-solution", 95, "u-rani"],
  ["d-cam-uas", "CAM — UAS Maintenance Certification Pack", 1_380, "pl-new", "st-won", -60, "u-sinta"],
  ["d-cam-renew", "CAM — Engineering Retainer 2027", 2_200, "pl-renew", "st-r-proposal", 50, "u-yoga"],
  ["d-bos-rov", "BOS — ROV Autonomy & Sonar Integration", 3_650, "pl-new", "st-discovery", 75, "u-sinta"],
  ["d-rct-fire", "RCT — Peatland Fire Detection UAV", 720, "pl-new", "st-discovery", 85, "u-sinta"],
  ["d-twu-nrw", "TWU — Non-Revenue Water Analytics", 2_400, "pl-new", "st-proposal", 2, "u-arif"],
  ["d-ptt-insp", "PTT — Drone Tower Inspection Programme", 6_500, "pl-new", "st-solution", 38, "u-sinta"],
  ["d-nhs-renew", "NHS — Fleet Support Renewal", 1_600, "pl-renew", "st-r-proposal", 12, "u-yoga"],
  ["d-spl-renew", "SPL — Telemetry Platform Renewal", 980, "pl-renew", "st-r-review", 64, "u-yoga"],
  ["d-aam-lost", "AAM — Fixed-wing Survey Drone", 1_100, "pl-new", "st-lost", -80, "u-sinta"],
  ["d-sbs-renew", "SBS — Reliability Analytics Renewal", 1_450, "pl-renew", "st-r-won", -20, "u-yoga"],
];

const monthAgo: R[] = [
  ["d-nhs-asv", "NHS — Autonomous Survey Vessel Retrofit", 7_900, "pl-new", "st-proposal", 10, "u-sinta"],
  ["d-nhs-ai", "NHS — Seabed Classification AI", 2_400, "pl-new", "st-solution", 32, "u-sinta"],
  ["d-aam-vtol", "AAM — VTOL Mapping Fleet (6 units)", 5_200, "pl-new", "st-qualified", 40, "u-sinta"],
  ["d-aam-train", "AAM — Pilot & Maintenance Training", 640, "pl-new", "st-discovery", 60, "u-sinta"],
  ["d-sbs-pdm", "SBS — Blast Furnace Predictive Maintenance", 6_900, "pl-new", "st-negotiation", -5, "u-arif"],
  ["d-sbs-ot", "SBS — OT Network Segmentation", 1_850, "pl-new", "st-solution", 18, "u-arif"],
  ["d-bap-crop", "BAP — Drone Crop Health Pilot (Sampit)", 1_400, "pl-new", "st-solution", 14, "u-arif"],
  ["d-spl-crane", "SPL — Crane Telemetry Phase 2", 3_300, "pl-new", "st-won", -35, "u-rani"],
  ["d-spl-twin", "SPL — Terminal Digital Twin", 4_750, "pl-new", "st-qualified", 45, "u-rani"],
  ["d-mge-sensor", "MGE — Wellhead Sensor Network", 2_600, "pl-new", "st-qualified", 21, "u-arif"],
  ["d-mge-ctl", "MGE — Turbine Control Upgrade Study", 480, "pl-new", "st-discovery", 40, "u-arif"],
  ["d-apg-scada", "APG — SCADA Modernisation Phase 1", 12_800, "pl-new", "st-qualified", 95, "u-rani"],
  ["d-cam-uas", "CAM — UAS Maintenance Certification Pack", 1_380, "pl-new", "st-won", -60, "u-sinta"],
  ["d-cam-renew", "CAM — Engineering Retainer 2027", 2_200, "pl-renew", "st-r-review", 50, "u-yoga"],
  ["d-bos-rov", "BOS — ROV Autonomy & Sonar Integration", 3_650, "pl-new", "st-discovery", 75, "u-sinta"],
  ["d-twu-nrw", "TWU — Non-Revenue Water Analytics", 2_400, "pl-new", "st-solution", 2, "u-arif"],
  ["d-ptt-insp", "PTT — Drone Tower Inspection Programme", 6_500, "pl-new", "st-qualified", 38, "u-sinta"],
  ["d-nhs-renew", "NHS — Fleet Support Renewal", 1_600, "pl-renew", "st-r-review", 12, "u-yoga"],
  ["d-spl-renew", "SPL — Telemetry Platform Renewal", 980, "pl-renew", "st-r-review", 64, "u-yoga"],
  ["d-aam-lost", "AAM — Fixed-wing Survey Drone", 1_100, "pl-new", "st-lost", -80, "u-sinta"],
  ["d-sbs-renew", "SBS — Reliability Analytics Renewal", 1_450, "pl-renew", "st-r-contract", -20, "u-yoga"],
];

const pipelineSnapshots: PipelineSnapshot[] = [
  { id: "ps-seed-4w", at: at(-28, 7), label: "Weekly snapshot", source: "seed", takenById: "u-rani", deals: snap(monthAgo) },
  { id: "ps-seed-1w", at: at(-7, 7), label: "Weekly snapshot", source: "seed", takenById: "u-rani", deals: snap(weekAgo) },
];

/* ───────────── sales targets (forecast vs target) ───────────── */

const salesTargets: SalesTarget[] = [
  { id: "tg-2026q4-team", period: "2026-Q4", ownerId: null, amount: 32_000 * M, updatedById: "u-rani", updatedAt: at(-36) },
  { id: "tg-2026q4-rani", period: "2026-Q4", ownerId: "u-rani", amount: 9_000 * M, updatedById: "u-rani", updatedAt: at(-36) },
  { id: "tg-2026q4-arif", period: "2026-Q4", ownerId: "u-arif", amount: 9_000 * M, updatedById: "u-rani", updatedAt: at(-36) },
  { id: "tg-2026q4-sinta", period: "2026-Q4", ownerId: "u-sinta", amount: 10_000 * M, updatedById: "u-rani", updatedAt: at(-36) },
  { id: "tg-2026q4-yoga", period: "2026-Q4", ownerId: "u-yoga", amount: 4_000 * M, updatedById: "u-rani", updatedAt: at(-36) },
  { id: "tg-2027q1-team", period: "2027-Q1", ownerId: null, amount: 30_000 * M, updatedById: "u-rani", updatedAt: at(-5) },
];

const assignmentCursors: AssignmentCursor[] = [];

export const automationSeed = {
  workflowRuns,
  automationNotices,
  sequenceEvents,
  pipelineSnapshots,
  salesTargets,
  assignmentCursors,
};
