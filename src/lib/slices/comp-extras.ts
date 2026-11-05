/*
 * Store slice "CompExtras" (W8 — compensation & people UI). Persisted records live in src/lib/seed-ext/comp.ts:
 *  - ledgerConfirmations: §8.2 each Project Lead confirms the Team Allocation Ledger by the 22nd (or Finance overrides)
 *  - exceptionReviews:    Finance reviews the cycle's exception population before CFO certification (§3.5, §9.1)
 *  - recoveryDeductions:  §9.4 clawback recovery netted from a cycle's project bonus / carried-forward payment
 *  - releaseApprovals:    §8.2 / §13.1 PRC members authorising release of a certified run (maker-checker, quorum)
 *  - cycleNotes:          certification references, late-release reasons
 * Every action writes an AuditEntry (§13.3) and re-checks the §13.2 role of the current user.
 */
import type { AuditEntry, EmployeeProfile, GovernanceRole } from "../initiatives/types";
import type { CrmState } from "../store";
import { can, rolesOf } from "../access-control";
import { clawbackAmount } from "../initiatives/engine";
import type { GetFn, SetFn, Uid } from "./types";

export interface LedgerConfirmation {
  id: string;
  month: string;
  initiativeId: string;
  confirmedById: string;
  at: string;
  /** Finance confirmed without the Project Lead — reason recorded (§8.2) */
  override?: string;
}

export interface ExceptionReview {
  id: string;
  month: string;
  /** stable key of the exception, e.g. "joiner:u-rafi:ini-1" */
  key: string;
  reviewedById: string;
  at: string;
  note?: string;
}

export interface RecoveryDeduction {
  id: string;
  clawbackId: string;
  userId: string;
  initiativeId: string;
  /** salary cycle whose payroll nets the deduction */
  month: string;
  amount: number;
  source: "bonus" | "carried";
  recordedById: string;
  at: string;
  note: string;
  cancelledAt?: string | null;
}

export interface ReleaseApproval {
  id: string;
  runId: string;
  month: string;
  userId: string;
  /** the certification this approval refers to — a re-certification invalidates earlier approvals */
  certifiedAt: string | null;
  at: string;
  /** recorded by someone else from the member's written approval */
  recordedById: string;
  withdrawnAt?: string | null;
}

export interface CycleNote {
  id: string;
  month: string;
  kind: "certification_reference" | "late_release" | "early_certification";
  text: string;
  byId: string;
  at: string;
}

export interface CompExtrasSlice {
  confirmLedger: (month: string, initiativeId: string, override?: string) => void;
  unconfirmLedger: (id: string) => void;
  reviewException: (month: string, key: string, label: string, note?: string) => void;
  unreviewException: (id: string) => void;
  scheduleRecoveryDeduction: (input: Pick<RecoveryDeduction, "clawbackId" | "month" | "amount" | "source" | "note">) => string | null;
  cancelRecoveryDeduction: (id: string) => void;
  approveRelease: (runId: string, onBehalfOf?: string) => string | null;
  withdrawReleaseApproval: (id: string) => void;
  addCycleNote: (month: string, kind: CycleNote["kind"], text: string) => void;
  /** §10 withdraw a recorded separation (e.g. rescinded resignation): clears it and reopens the ledger rows it closed. */
  withdrawSeparation: (userId: string, reason: string) => boolean;
  /** §10 PRC confirms a recorded retirement later — held retirement payments become payable. */
  confirmRetirement: (userId: string, note: string) => boolean;
  /** §13.1 HR maintains governance roles; appointed PRC members serve two-year terms. */
  setGovernanceRoles: (userId: string, roles: GovernanceRole[], prcTermEndsAt: string | null) => boolean;
  /** HR identifiers used on statements and the payroll export. */
  updateHrIdentifiers: (userId: string, patch: Pick<EmployeeProfile, "employeeNumber" | "npwp" | "ptkpStatus">) => boolean;
}

type S0 = CompExtrasSlice & Pick<CrmState, "currentUserId" | "employeeProfiles" | "users" | "initiativeMembers" | "probationOutcomes" | "clawbacks" | "bonusRuns" | "auditLog" | "updateClawback" | "ledgerConfirmations" | "exceptionReviews" | "recoveryDeductions" | "releaseApprovals" | "cycleNotes">;

const ROLE_LABEL: Record<GovernanceRole, string> = { prc: "PRC", ceo: "CEO", cfo: "CFO", hr: "HR", finance: "Finance", executive_committee: "ExCo" };

export function createCompExtrasSlice<S extends S0>(set: SetFn<S>, get: GetFn<S>, uid: Uid): CompExtrasSlice {
  const now = () => new Date().toISOString();
  const me = () => get().currentUserId;
  const myRoles = () => rolesOf(me(), get().employeeProfiles);
  const name = (id: string) => get().users.find((u) => u.id === id)?.name ?? id;
  const audit = (entity: AuditEntry["entity"], entityId: string, action: string, detail = "") =>
    set((s) => ({ auditLog: [{ id: uid("au"), at: now(), actorId: s.currentUserId, entity, entityId, action, detail }, ...s.auditLog] }) as Partial<S>);

  return {
    confirmLedger: (month, initiativeId, override) => {
      const roles = myRoles();
      // the Project Lead confirms their own project; Finance may confirm with a reason
      const isLead = get().initiativeMembers.some((m) => m.initiativeId === initiativeId && m.userId === me() && m.roles.includes("project_lead") && !m.leftAt);
      if (!isLead && !(can.certify(roles) && override && override.trim().length >= 5)) return;
      const rec: LedgerConfirmation = { id: uid("lc"), month, initiativeId, confirmedById: me(), at: now(), override: isLead ? undefined : override?.trim() };
      set((s) => ({ ledgerConfirmations: [...s.ledgerConfirmations.filter((c) => !(c.month === month && c.initiativeId === initiativeId)), rec] }) as Partial<S>);
      audit("initiative", initiativeId, isLead ? `Team Allocation Ledger confirmed by the Project Lead for ${month} (§8.2)` : `Ledger confirmation for ${month} recorded by Finance without the Project Lead (§8.2)`, rec.override ?? "");
    },
    unconfirmLedger: (id) => {
      const c = get().ledgerConfirmations.find((x) => x.id === id);
      if (!c || (c.confirmedById !== me() && !can.certify(myRoles()))) return;
      set((s) => ({ ledgerConfirmations: s.ledgerConfirmations.filter((x) => x.id !== id) }) as Partial<S>);
      audit("initiative", c.initiativeId, `ledger confirmation for ${c.month} withdrawn`);
    },
    reviewException: (month, key, label, note) => {
      if (!can.certify(myRoles())) return;
      const rec: ExceptionReview = { id: uid("ex"), month, key, reviewedById: me(), at: now(), note: note?.trim() || undefined };
      set((s) => ({ exceptionReviews: [...s.exceptionReviews.filter((r) => !(r.month === month && r.key === key)), rec] }) as Partial<S>);
      audit("run", month, "exception reviewed before certification", `${label}${rec.note ? ` — ${rec.note}` : ""}`);
    },
    unreviewException: (id) => {
      if (!can.certify(myRoles())) return;
      const r = get().exceptionReviews.find((x) => x.id === id);
      if (!r) return;
      set((s) => ({ exceptionReviews: s.exceptionReviews.filter((x) => x.id !== id) }) as Partial<S>);
      audit("run", r.month, "exception review withdrawn", r.key);
    },

    scheduleRecoveryDeduction: (input) => {
      if (!can.certify(myRoles())) return null;
      const c = get().clawbacks.find((x) => x.id === input.clawbackId);
      if (!c || c.status !== "recovering" || input.amount <= 0) return null;
      const run = get().bonusRuns.find((r) => r.month === input.month);
      if (run?.status === "released") return null; // payroll for a released cycle is closed
      const id = uid("rd");
      const amount = Math.floor(input.amount);
      const rec: RecoveryDeduction = { id, clawbackId: c.id, userId: c.userId, initiativeId: c.initiativeId, month: input.month, amount, source: input.source, recordedById: me(), at: now(), note: input.note.trim(), cancelledAt: null };
      set((s) => ({ recoveryDeductions: [...s.recoveryDeductions, rec] }) as Partial<S>);
      get().updateClawback(c.id, { recovered: Math.min(clawbackAmount(c), c.recovered + amount), status: c.recovered + amount >= clawbackAmount(c) - 0.5 ? "closed" : c.status, notes: `${c.notes}${c.notes ? "\n" : ""}${now().slice(0, 10)} · Rp${amount.toLocaleString("id-ID")} netted from the ${input.month} ${input.source === "carried" ? "carried-forward payment" : "project bonus"} in payroll${rec.note ? ` — ${rec.note}` : ""}` });
      audit("clawback", c.id, `recovery of Rp${amount.toLocaleString("id-ID")} scheduled against the ${input.month} payroll (${input.source === "carried" ? "carried-forward amount" : "project bonus"}, §9.4)`, rec.note);
      return id;
    },
    cancelRecoveryDeduction: (id) => {
      if (!can.certify(myRoles())) return;
      const d = get().recoveryDeductions.find((x) => x.id === id);
      if (!d || d.cancelledAt) return;
      const run = get().bonusRuns.find((r) => r.month === d.month);
      if (run?.status === "released") return;
      set((s) => ({ recoveryDeductions: s.recoveryDeductions.map((x) => (x.id === id ? { ...x, cancelledAt: now() } : x)) }) as Partial<S>);
      const c = get().clawbacks.find((x) => x.id === d.clawbackId);
      if (c) get().updateClawback(c.id, { recovered: Math.max(0, c.recovered - d.amount), status: c.status === "closed" ? "recovering" : c.status });
      audit("clawback", d.clawbackId, `scheduled recovery for ${d.month} cancelled`, `Rp${d.amount.toLocaleString("id-ID")}`);
    },

    approveRelease: (runId, onBehalfOf) => {
      const run = get().bonusRuns.find((r) => r.id === runId);
      if (!run || run.status !== "certified") return null;
      const approver = onBehalfOf ?? me();
      const approverRoles = rolesOf(approver, get().employeeProfiles);
      if (!can.prc(approverRoles)) return null;
      // recording someone else's written approval needs a PRC member at the keyboard
      if (onBehalfOf && onBehalfOf !== me() && !can.prc(myRoles())) return null;
      // §13.1 recusal: members with their own lines in the run, and the certifier (maker-checker)
      if (run.lines.some((l) => l.userId === approver) || run.certifiedById === approver) return null;
      const existing = get().releaseApprovals.find((a) => a.runId === runId && a.userId === approver && !a.withdrawnAt && a.certifiedAt === run.certifiedAt);
      if (existing) return existing.id;
      const id = uid("ra");
      const rec: ReleaseApproval = { id, runId, month: run.month, userId: approver, certifiedAt: run.certifiedAt, at: now(), recordedById: me(), withdrawnAt: null };
      set((s) => ({ releaseApprovals: [...s.releaseApprovals, rec] }) as Partial<S>);
      audit("run", runId, `PRC approval to release ${run.month} — ${name(approver)}`, approver !== me() ? `recorded by ${name(me())} from the written approval` : "");
      return id;
    },
    withdrawReleaseApproval: (id) => {
      const a = get().releaseApprovals.find((x) => x.id === id);
      if (!a || a.withdrawnAt) return;
      if (a.userId !== me() && a.recordedById !== me()) return;
      const run = get().bonusRuns.find((r) => r.id === a.runId);
      if (run?.status === "released") return;
      set((s) => ({ releaseApprovals: s.releaseApprovals.map((x) => (x.id === id ? { ...x, withdrawnAt: now() } : x)) }) as Partial<S>);
      audit("run", a.runId, `PRC approval withdrawn — ${name(a.userId)}`);
    },
    addCycleNote: (month, kind, text) => {
      const t = text.trim();
      if (!t) return;
      const roles = myRoles();
      if (!can.certify(roles) && !can.prc(roles)) return;
      set((s) => ({ cycleNotes: [...s.cycleNotes, { id: uid("cn"), month, kind, text: t, byId: s.currentUserId, at: now() }] }) as Partial<S>);
      audit("run", month, kind === "late_release" ? "reason for a late release recorded (§8.2)" : kind === "early_certification" ? "certification before the cut-off justified (§8.2)" : "CFO written certification reference recorded (§9.1)", t);
    },

    withdrawSeparation: (userId, reason) => {
      if (!can.manageHr(myRoles()) || reason.trim().length < 5) return false;
      const p = get().employeeProfiles.find((x) => x.userId === userId);
      const sep = p?.separation;
      if (!p || !sep) return false;
      const closedAt = Date.parse(sep.effectiveAt);
      set((s) => ({
        employeeProfiles: s.employeeProfiles.map((x) => (x.userId === userId ? { ...x, separation: null, resignationNoticeAt: sep.kind === "resignation" ? null : x.resignationNoticeAt, terminationNoticeAt: sep.kind.startsWith("termination") ? null : x.terminationNoticeAt } : x)),
        // reopen the ledger rows recordSeparation closed on the effective date (§6.5)
        initiativeMembers: s.initiativeMembers.map((m) => (m.userId === userId && m.leftAt && Math.abs(Date.parse(m.leftAt) - closedAt) < 1000 && m.removal.stage !== "removed" ? { ...m, leftAt: null } : m)),
        // a probation outcome created automatically with the separation is undone with it (§11.4)
        probationOutcomes: s.probationOutcomes.filter((o) => !(o.userId === userId && o.outcome !== "completed" && Math.abs(Date.parse(o.decidedAt) - Date.parse(sep.recordedAt)) < 5000)),
      }) as Partial<S>);
      audit("employee", userId, `status change withdrawn: ${sep.kind.replace(/_/g, " ")} (effective ${sep.effectiveAt.slice(0, 10)})`, reason.trim());
      return true;
    },
    confirmRetirement: (userId, note) => {
      if (!can.prc(myRoles())) return false;
      const p = get().employeeProfiles.find((x) => x.userId === userId);
      if (!p?.separation || p.separation.kind !== "retirement" || p.separation.prcConfirmed) return false;
      set((s) => ({ employeeProfiles: s.employeeProfiles.map((x) => (x.userId === userId && x.separation ? { ...x, separation: { ...x.separation, prcConfirmed: true } } : x)) }) as Partial<S>);
      audit("employee", userId, "PRC confirmed the retirement — held retirement payments become payable (§10)", note.trim());
      return true;
    },
    setGovernanceRoles: (userId, roles, prcTermEndsAt) => {
      if (!can.manageHr(myRoles())) return false;
      const p = get().employeeProfiles.find((x) => x.userId === userId);
      if (!p) return false;
      const next = Array.from(new Set(roles));
      const added = next.filter((r) => !p.governanceRoles.includes(r));
      const removed = p.governanceRoles.filter((r) => !next.includes(r));
      const term = next.includes("prc") ? prcTermEndsAt : null;
      if (!added.length && !removed.length && (p.prcTermEndsAt ?? null) === term) return true;
      set((s) => ({ employeeProfiles: s.employeeProfiles.map((x) => (x.userId === userId ? { ...x, governanceRoles: next, prcTermEndsAt: term } : x)) }) as Partial<S>);
      const parts = [added.length ? `added ${added.map((r) => ROLE_LABEL[r]).join(", ")}` : "", removed.length ? `removed ${removed.map((r) => ROLE_LABEL[r]).join(", ")}` : "", term ? `PRC term to ${term.slice(0, 10)}` : ""].filter(Boolean);
      audit("employee", userId, "governance roles changed (§13.1, §13.2)", parts.join(" · "));
      return true;
    },
    updateHrIdentifiers: (userId, patch) => {
      if (!can.manageHr(myRoles())) return false;
      if (!get().employeeProfiles.some((x) => x.userId === userId)) return false;
      set((s) => ({ employeeProfiles: s.employeeProfiles.map((x) => (x.userId === userId ? { ...x, ...patch } : x)) }) as Partial<S>);
      audit("employee", userId, "HR identifiers updated", Object.keys(patch).join(", "));
      return true;
    },
  };
}
