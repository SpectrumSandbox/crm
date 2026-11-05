/*
 * Pure helpers for the monthly cycle controls (Policy v4.0 §8.2, §9.1, §13.1): held-line conditions, the
 * exception population Finance reviews before certification and the PRC votes recorded for a release.
 */
import type { BonusLine, BonusRun, EmployeeProfile, InitiativeMember } from "@/lib/initiatives/types";
import { monthEnd, monthStart, paymentDate, type ReleaseVote } from "@/lib/initiatives/engine";
import type { ReleaseApproval } from "@/lib/slices/comp-extras";

/* ───────────── held lines (§10, §15.1) ───────────── */

/** What releases a held amount, from the engine's hold reason. */
export function heldCondition(reason: string): { when: string; where: string | null } {
  if (/annex b.*not signed/i.test(reason)) return { when: "Paid with the first salary after the employee signs Annex B", where: "/people" };
  if (/before version 4\.0|before v4/i.test(reason)) return { when: "Paid once the employee signs the v4.0 Project Participation Agreement", where: "/people" };
  if (/suspension/i.test(reason)) return { when: "Paid if the employee is cleared; forfeited only if a serious violation is confirmed", where: "/people" };
  if (/unpaid leave/i.test(reason)) return { when: "Paid on the employee's return from unpaid leave", where: "/people" };
  if (/retirement/i.test(reason)) return { when: "Paid once the PRC confirms the retirement", where: "/people" };
  if (/no hr record/i.test(reason)) return { when: "Paid once HR records the employee's status (§3.5)", where: "/people" };
  return { when: "Paid in the first cycle the hold clears", where: null };
}

const HOLD_RE = /annex b|suspension|unpaid leave|retirement|no hr record|held/i;
export function holdReasons(line: BonusLine) {
  const fromItems = (line.heldItems ?? []).map((h) => h.reason).filter((r): r is string => !!r);
  return fromItems.length ? Array.from(new Set(fromItems)) : line.notes.filter((n) => HOLD_RE.test(n) && !/probation|released — the hold has cleared/i.test(n));
}

/* ───────────── exception population (research: ICM exception review, §3.5) ───────────── */

export interface CycleException {
  key: string;
  kind: "joiner" | "leaver" | "large" | "weight" | "held" | "forfeited" | "probation" | "status" | "no_record";
  label: string;
  detail: string;
  userId?: string;
  initiativeId?: string;
}

export const LARGE_LINE = 50_000_000;
const inMonth = (iso: string | null | undefined, month: string) => !!iso && Date.parse(iso) >= Date.parse(monthStart(month)) && Date.parse(iso) <= Date.parse(monthEnd(month));

export function runExceptions({ month, lines, members, profiles, initiativeIds }: { month: string; lines: BonusLine[]; members: InitiativeMember[]; profiles: EmployeeProfile[]; initiativeIds: string[] }): CycleException[] {
  const out: CycleException[] = [];
  const onRun = new Set(initiativeIds);
  for (const m of members) {
    if (!onRun.has(m.initiativeId) || m.consent !== "accepted") continue;
    if (inMonth(m.joinedAt, month)) out.push({ key: `join:${m.id}`, kind: "joiner", label: "Joined the ledger this cycle", detail: `from ${m.joinedAt.slice(0, 10)} · ${m.authority ?? "Role and Weight Agreement"}`, userId: m.userId, initiativeId: m.initiativeId });
    if (inMonth(m.leftAt, month)) out.push({ key: `leave:${m.id}`, kind: "leaver", label: "Ledger row closed this cycle", detail: `to ${m.leftAt!.slice(0, 10)}`, userId: m.userId, initiativeId: m.initiativeId });
    if (m.weightOverride != null && (!m.leftAt || Date.parse(m.leftAt) >= Date.parse(monthStart(month)))) out.push({ key: `weight:${m.id}`, kind: "weight", label: "Non-standard weight", detail: `W ${m.weightOverride}${m.weightNote ? ` — ${m.weightNote}` : ""} (§6.7)`, userId: m.userId, initiativeId: m.initiativeId });
  }
  for (const l of lines) {
    const total = l.gross + l.topUp + l.carriedIn;
    if (total >= LARGE_LINE) out.push({ key: `large:${l.userId}:${l.initiativeId}`, kind: "large", label: `Line of ${Math.round(total / 1e6)} jt or more`, detail: "Check the work period and weight-days", userId: l.userId, initiativeId: l.initiativeId });
    if (l.held > 0) out.push({ key: `held:${l.userId}:${l.initiativeId}`, kind: "held", label: "Payment held", detail: holdReasons(l)[0] ?? "Held (§10)", userId: l.userId, initiativeId: l.initiativeId });
    if (l.forfeited > 0) out.push({ key: `forfeit:${l.userId}:${l.initiativeId}`, kind: "forfeited", label: "Amount forfeited", detail: l.notes.find((n) => /§10|§3\.2/.test(n)) ?? "Forfeited under §10", userId: l.userId, initiativeId: l.initiativeId });
  }
  const pay = Date.parse(paymentDate(month));
  const onLines = new Set(lines.map((l) => l.userId));
  for (const p of profiles) {
    if (!onLines.has(p.userId)) continue;
    if (p.employmentType === "probationary" && p.probationEndDate && Date.parse(p.probationEndDate) <= pay + 31 * 86_400_000) out.push({ key: `probation:${p.userId}`, kind: "probation", label: "Probation ends around this salary date", detail: `ends ${p.probationEndDate.slice(0, 10)} — HR records the §11.4 outcome`, userId: p.userId });
    if (p.separation || p.resignationNoticeAt || p.terminationNoticeAt || p.suspended) out.push({ key: `status:${p.userId}:${p.separation?.recordedAt ?? p.resignationNoticeAt ?? p.terminationNoticeAt ?? "s"}`, kind: "status", label: "Status change on record", detail: p.separation ? `${p.separation.kind.replace(/_/g, " ")} effective ${p.separation.effectiveAt.slice(0, 10)}` : p.suspended ? "Disciplinary suspension" : "Under notice", userId: p.userId });
  }
  for (const u of onLines) if (!profiles.some((p) => p.userId === u)) out.push({ key: `norecord:${u}`, kind: "no_record", label: "No HR record", detail: "Finance re-checks status before payment (§3.5)", userId: u });
  return out;
}

/* ───────────── PRC release votes (§13.1) ───────────── */

/** Current votes recorded for a run's present certification — passed to releaseRun / releaseCheck (W7) as the PRC vote. */
export function liveVotes(run: Pick<BonusRun, "id" | "certifiedAt">, approvals: ReleaseApproval[]): ReleaseVote[] {
  return approvals.filter((a) => a.runId === run.id && !a.withdrawnAt && a.certifiedAt === run.certifiedAt).map((a) => ({ userId: a.userId, vote: a.vote }));
}
