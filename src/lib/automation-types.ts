/* W10 automation & reporting data model — persisted collections live in src/lib/seed-ext/automation.ts. */
import type { AgileObjectType, CrmObjectType, ID, ISODate } from "./types";

export type WfObject = CrmObjectType | AgileObjectType;

/* ───────────── workflow runs ───────────── */

export type RunOutcome = "success" | "partial" | "failed" | "skipped";
export type RunSource = "event" | "schedule" | "manual";

export interface WorkflowRunStep {
  kind: string;
  ok: boolean;
  detail: string;
  href?: string;
}

export interface WorkflowRun {
  id: ID;
  workflowId: ID;
  workflowName: string;
  at: ISODate;
  source: RunSource;
  /** trigger event, e.g. "stage_changed" */
  event: string;
  object: WfObject;
  recordId: ID;
  recordLabel: string;
  outcome: RunOutcome;
  steps: WorkflowRunStep[];
  /** the user whose action (or session) caused the run */
  actorId: ID;
  /** time-based runs fire once per key (e.g. workflow:ticket:slaDueAt) */
  dedupeKey?: string;
}

/** In-app notice written by the "notify" workflow action. */
export interface AutomationNotice {
  id: ID;
  userId: ID;
  title: string;
  body: string;
  href?: string;
  at: ISODate;
  readAt: ISODate | null;
  workflowId?: ID;
}

/** Rotation pointer for the round-robin owner action (one per workflow action). */
export interface AssignmentCursor {
  /** `${workflowId}:${actionIndex}` */
  id: string;
  index: number;
  updatedAt: ISODate;
}

/* ───────────── sequences ───────────── */

export type SequenceEventKind = "enrolled" | "executed" | "skipped" | "snoozed" | "paused" | "resumed" | "replied" | "finished" | "unenrolled" | "bounced";

export interface SequenceEvent {
  id: ID;
  enrollmentId: ID;
  sequenceId: ID;
  contactId: ID;
  at: ISODate;
  kind: SequenceEventKind;
  stepId?: ID;
  stepOrder?: number;
  channel?: "email" | "whatsapp" | "call" | "task";
  actorId: ID;
  note?: string;
  activityId?: ID;
}

/* ───────────── reporting ───────────── */

export interface SnapshotDeal {
  id: ID;
  name: string;
  amount: number;
  pipelineId: ID;
  stageId: ID;
  closeDate: ISODate;
  ownerId: ID;
}

export interface PipelineSnapshot {
  id: ID;
  at: ISODate;
  label: string;
  source: "seed" | "auto" | "manual";
  takenById: ID;
  deals: SnapshotDeal[];
}

/** Sales target for a quarter ("2026-Q4") or month ("2026-11"); ownerId null = whole team. */
export interface SalesTarget {
  id: ID;
  period: string;
  ownerId: ID | null;
  amount: number;
  updatedById: ID;
  updatedAt: ISODate;
}
