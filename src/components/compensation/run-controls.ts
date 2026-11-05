/*
 * Pure helpers for the monthly cycle controls (Policy v4.0 §8.2, §9.1, §13.1): held-line conditions, the
 * exception population Finance reviews before certification, the PRC roster, maker-checker release state and
 * the extra payroll items of a cycle (deferred releases, probation bonuses, clawback recoveries).
 */
import type { AuditEntry, BonusLine, BonusRun, DeferredBonus, EmployeeProfile, InitiativeMember, ProbationOutcome } from "@/lib/initiatives/types";
import { can } from "@/lib/access-control";
import { cycleMonth, monthEnd, monthStart, paymentDate } from "@/lib/initiatives/engine";
import type { RecoveryDeduction, ReleaseApproval } from "@/lib/slices/comp-extras";

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
  return line.notes.filter((n) => HOLD_RE.test(n) && !/probation/i.test(n));
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

/* ───────────── PRC roster, maker-checker and quorum (§8.2, §13.1) ───────────── */

export function prcRoster(profiles: EmployeeProfile[], nowMs = Date.now()) {
  return profiles.filter((p) => can.prc(p.governanceRoles) && !(p.separation && Date.parse(p.separation.effectiveAt) <= nowMs) && !(p.prcTermEndsAt && Date.parse(p.prcTermEndsAt) < nowMs && !p.governanceRoles.includes("ceo"))).map((p) => p.userId);
}

export interface ReleaseState {
  roster: string[];
  approvals: ReleaseApproval[];
  /** members who may not approve: certifier / recorder (maker) and members with their own lines (§13.1) */
  recused: { userId: string; reason: string }[];
  eligible: string[];
  present: string[];
  quorumNeeded: number;
  financePresent: boolean;
  quorumMet: boolean;
  preparedById: string | null;
  recordedById: string | null;
}

export function releaseState({ run, profiles, approvals, auditLog }: { run: BonusRun; profiles: EmployeeProfile[]; approvals: ReleaseApproval[]; auditLog: AuditEntry[] }): ReleaseState {
  const roster = prcRoster(profiles);
  const runLog = auditLog.filter((a) => a.entity === "run" && a.entityId === run.id);
  const recordedById = runLog.find((a) => /certified/i.test(a.action))?.actorId ?? run.certifiedById;
  const preparedById = runLog.find((a) => /provisional/i.test(a.action))?.actorId ?? null;
  const withLines = new Set(run.lines.map((l) => l.userId));
  const recused: ReleaseState["recused"] = [];
  for (const u of roster) {
    if (u === run.certifiedById) recused.push({ userId: u, reason: "certified the checks (maker)" });
    else if (u === recordedById) recused.push({ userId: u, reason: "recorded the certification (maker)" });
    else if (withLines.has(u)) recused.push({ userId: u, reason: "has own bonus lines in this run (§13.1)" });
  }
  const live = approvals.filter((a) => a.runId === run.id && !a.withdrawnAt && a.certifiedAt === run.certifiedAt && roster.includes(a.userId));
  const eligible = roster.filter((u) => !recused.some((r) => r.userId === u));
  // the CFO who certified presents her certification to the meeting — present for the quorum, not an approver
  const present = Array.from(new Set([...live.map((a) => a.userId), ...(run.certifiedById && roster.includes(run.certifiedById) ? [run.certifiedById] : [])]));
  const isFinance = (u: string) => {
    const r = profiles.find((p) => p.userId === u)?.governanceRoles ?? [];
    return r.includes("cfo") || r.includes("finance");
  };
  const quorumNeeded = Math.floor(roster.length / 2) + 1;
  const financePresent = present.some(isFinance);
  return { roster, approvals: live, recused, eligible, present, quorumNeeded, financePresent, quorumMet: present.length >= quorumNeeded && financePresent && live.length > 0, preparedById, recordedById };
}

/* ───────────── payroll extras of a cycle (§8.5, §9.3, §11.4, §9.4) ───────────── */

export interface PayrollExtra {
  userId: string;
  initiativeId: string | null;
  kind: "deferred_release" | "probation_completion" | "probation_final_pay" | "clawback_recovery";
  amount: number; // negative for recoveries
  label: string;
}

export function payrollExtras(month: string, ctx: { deferredBonuses: DeferredBonus[]; probationOutcomes: ProbationOutcome[]; recoveryDeductions: RecoveryDeduction[]; auditLog: AuditEntry[] }): PayrollExtra[] {
  const out: PayrollExtra[] = [];
  for (const d of ctx.deferredBonuses) {
    if (d.status !== "released" || d.releasedAmount <= 0) continue;
    const at = ctx.auditLog.find((a) => a.entity === "deferred" && a.entityId === d.id && /released/i.test(a.action))?.at ?? d.vestAt;
    if (cycleMonth(at) !== month) continue;
    out.push({ userId: d.userId, initiativeId: d.initiativeId, kind: "deferred_release", amount: Math.floor(d.releasedAmount), label: `Deferred bonus from ${d.month} released (§9.3)` });
  }
  for (const o of ctx.probationOutcomes) {
    if (o.outcome === "forfeited" || o.amount <= 0 || cycleMonth(o.decidedAt) !== month) continue;
    out.push({ userId: o.userId, initiativeId: null, kind: o.outcome === "completed" ? "probation_completion" : "probation_final_pay", amount: Math.floor(o.amount), label: o.outcome === "completed" ? "Probation Completion Bonus (§11.4)" : "Held probation balance with final pay (§11.4)" });
  }
  for (const r of ctx.recoveryDeductions) {
    if (r.cancelledAt || r.month !== month) continue;
    out.push({ userId: r.userId, initiativeId: r.initiativeId, kind: "clawback_recovery", amount: -Math.floor(r.amount), label: `Clawback recovery (${r.source === "carried" ? "carried-forward amount" : "project bonus"}, §9.4)` });
  }
  return out;
}

/* ───────────── PPh 21 estimate on a line (§8.5, Annex E) ───────────── */

export function pph21Of(_line: BonusLine): { gross: number; withheld: number; net: number } | null {
  return null;
}
