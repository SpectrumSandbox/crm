/* Sequence scheduling helpers (W10): due dates in WIB business days, progress and queue rows. Pure. */
import type { Sequence, SequenceEnrollment, SequenceStep } from "@/lib/types";
import { addBusinessDaysWib } from "@/lib/slices/crm-extras";
import type { SequenceEvent } from "./types";

const WIB = 7 * 3_600_000;

/** Add WIB business days (Mon–Fri) and land at 09:00 WIB when days > 0; 0 days keeps the instant. */
export function addBusinessDaysAt9(fromMs: number, days: number) {
  if (days <= 0) return fromMs;
  const t = addBusinessDaysWib(fromMs, days);
  const d = new Date(t + WIB);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9, 0, 0) - WIB;
}

export function sortedSteps(seq: Pick<Sequence, "steps">) {
  return [...seq.steps].sort((a, b) => a.order - b.order);
}

/** the step the enrolment is waiting on (currentStep is 1-based position in the ordered steps) */
export function currentStepOf(seq: Pick<Sequence, "steps">, e: Pick<SequenceEnrollment, "currentStep">): SequenceStep | null {
  const steps = sortedSteps(seq);
  return steps[e.currentStep - 1] ?? null;
}

export function lastStepAtOf(e: SequenceEnrollment, events: SequenceEvent[]) {
  if (e.lastStepAt) return e.lastStepAt;
  let best: string | null = null;
  for (const ev of events) if (ev.enrollmentId === e.id && (ev.kind === "executed" || ev.kind === "skipped") && (!best || ev.at > best)) best = ev.at;
  return best ?? e.enrolledAt;
}

/** When the current step is due (ISO), or null when nothing is pending. */
export function dueAtOf(seq: Pick<Sequence, "steps">, e: SequenceEnrollment, events: SequenceEvent[]): string | null {
  if (e.status !== "active") return null;
  const step = currentStepOf(seq, e);
  if (!step) return null;
  if (e.dueOverrideAt) return e.dueOverrideAt;
  const base = Date.parse(lastStepAtOf(e, events));
  return new Date(addBusinessDaysAt9(base, step.delayDays)).toISOString();
}

export type DueBucket = "overdue" | "today" | "upcoming";

/** WIB calendar-day bucket relative to now */
export function dueBucket(dueIso: string, now = Date.now()): DueBucket {
  const day = (ms: number) => Math.floor((ms + WIB) / 86_400_000);
  const d = day(Date.parse(dueIso));
  const today = day(now);
  if (d < today) return "overdue";
  if (d === today) return Date.parse(dueIso) < now - 4 * 3_600_000 ? "overdue" : "today";
  return "upcoming";
}

export const STEP_KIND_LABEL: Record<SequenceStep["kind"], string> = { email: "Email", whatsapp: "WhatsApp", call: "Call", task: "Task" };

export const ENROLLMENT_STATUS_META: Record<SequenceEnrollment["status"], { label: string; color: "green" | "yellow" | "cyan" | "blue" | "red" }> = {
  active: { label: "Active", color: "green" },
  paused: { label: "Paused", color: "yellow" },
  replied: { label: "Replied", color: "cyan" },
  finished: { label: "Finished", color: "blue" },
  bounced: { label: "Bounced", color: "red" },
};
