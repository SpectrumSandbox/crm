/*
 * Store slice "CompExtras" (W8 — compensation & people UI). Persisted records live in src/lib/seed-ext/comp.ts:
 *  - ledgerConfirmations: §8.2 each Project Lead confirms the Team Allocation Ledger by the 22nd (or Finance overrides)
 *  - exceptionReviews:    Finance reviews the cycle's exception population before CFO certification (§3.5, §9.1)
 *  - releaseApprovals:    §13.1 PRC members' votes on releasing a certified run, passed to releaseRun (W7) as the vote
 *  - cycleNotes:          the reference of the CFO's written certification when Finance records it on her behalf
 * Every action writes an AuditEntry (§13.3) and re-checks the §13.2 role of the current user.
 */
import type { AuditEntry, EmployeeProfile, GovernanceRole } from "../initiatives/types";
import type { CrmState } from "../store";
import { can, rolesOf } from "../access-control";
import { prcRoster } from "../initiatives/engine";
import type { GetFn, SetFn, Uid } from "./types";
import type { CycleNote, ExceptionReview, LedgerConfirmation, ReleaseApproval } from "../seed-ext/comp";

export type { CycleNote, ExceptionReview, LedgerConfirmation, ReleaseApproval } from "../seed-ext/comp";

export interface CompExtrasSlice {
  confirmLedger: (month: string, initiativeId: string, override?: string) => void;
  unconfirmLedger: (id: string) => void;
  reviewException: (month: string, key: string, label: string, note?: string) => void;
  unreviewException: (id: string) => void;
  /** Record a PRC member's vote on releasing a certified run (their own, or another member's written vote). */
  approveRelease: (runId: string, vote: "for" | "against", onBehalfOf?: string) => string | null;
  withdrawReleaseApproval: (id: string) => void;
  addCycleNote: (month: string, kind: CycleNote["kind"], text: string) => void;
  /** §10 withdraw a recorded separation (e.g. rescinded resignation): clears it, reopens the ledger rows it closed and restores what it forfeited. HR only. */
  withdrawSeparation: (userId: string, reason: string) => boolean;
  /** §10 PRC confirms a recorded retirement later — held retirement payments are paid in the next run. */
  confirmRetirement: (userId: string, note: string) => boolean;
  /** §13.1 HR maintains governance roles; appointed PRC members serve two-year terms. */
  setGovernanceRoles: (userId: string, roles: GovernanceRole[], prcTermEndsAt: string | null) => boolean;
  /** HR identifiers used on statements and the payroll export. */
  updateHrIdentifiers: (userId: string, patch: Pick<EmployeeProfile, "employeeNumber" | "npwp" | "ptkpStatus">) => boolean;
}

type S0 = CompExtrasSlice & Pick<CrmState, "currentUserId" | "employeeProfiles" | "users" | "initiativeMembers" | "deferredBonuses" | "probationOutcomes" | "bonusRuns" | "auditLog" | "ledgerConfirmations" | "exceptionReviews" | "releaseApprovals" | "cycleNotes">;

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

    approveRelease: (runId, vote, onBehalfOf) => {
      const run = get().bonusRuns.find((r) => r.id === runId);
      if (!run || run.status !== "certified") return null;
      const voter = onBehalfOf ?? me();
      const roster = prcRoster(get().employeeProfiles).map((p) => p.userId);
      if (!roster.includes(voter)) return null;
      // recording someone else's written vote needs a PRC member at the keyboard
      if (voter !== me() && !can.prc(myRoles())) return null;
      // §13.1 recusal: members with their own amounts in the run do not take part
      if (run.lines.some((l) => l.userId === voter && l.payable + l.deferred + l.withheld + l.held + l.carriedOver + l.carriedIn > 0)) return null;
      const id = uid("ra");
      const rec: ReleaseApproval = { id, runId, month: run.month, userId: voter, vote, certifiedAt: run.certifiedAt, at: now(), recordedById: me(), withdrawnAt: null };
      set((s) => ({ releaseApprovals: [...s.releaseApprovals.map((a) => (a.runId === runId && a.userId === voter && !a.withdrawnAt ? { ...a, withdrawnAt: rec.at } : a)), rec] }) as Partial<S>);
      audit("run", runId, `PRC vote on releasing ${run.month} — ${name(voter)}: ${vote}`, voter !== me() ? `recorded by ${name(me())} from the written vote` : "");
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
      audit("run", month, "CFO written certification reference recorded (§9.1)", t);
    },

    withdrawSeparation: (userId, reason) => {
      if (!can.manageHr(myRoles()) || reason.trim().length < 5) return false;
      const p = get().employeeProfiles.find((x) => x.userId === userId);
      const sep = p?.separation;
      if (!p || !sep) return false;
      const rows = sep.closedRowIds ?? get().initiativeMembers.filter((m) => m.userId === userId && m.leftAt === sep.effectiveAt).map((m) => m.id);
      const runs = get().bonusRuns;
      set((s) => ({
        employeeProfiles: s.employeeProfiles.map((x) => (x.userId === userId ? { ...x, separation: null, resignationNoticeAt: sep.kind === "resignation" ? null : x.resignationNoticeAt, terminationNoticeAt: sep.kind.startsWith("termination") ? null : x.terminationNoticeAt } : x)),
        // reopen the ledger rows the separation closed on its effective date (§6.5)
        initiativeMembers: s.initiativeMembers.map((m) => (rows.includes(m.id) && m.leftAt === sep.effectiveAt && m.removal.stage !== "removed" ? { ...m, leftAt: null } : m)),
        // deferrals forfeited by a dismissal that is withdrawn are restored
        deferredBonuses: s.deferredBonuses.map((d) => (d.userId === userId && d.status === "forfeited" && d.note.startsWith("Forfeited — dismissal") ? { ...d, status: "pending" as const, note: `High-risk deferral restored — separation withdrawn: ${reason.trim()}` } : d)),
        // a final-pay / forfeiture probation outcome not yet paid by a released run is undone (§11.4)
        probationOutcomes: s.probationOutcomes.filter((o) => !(o.userId === userId && o.outcome !== "completed" && !(o.payMonth && runs.some((r) => r.month === o.payMonth && r.status === "released")))),
      }) as Partial<S>);
      audit("employee", userId, `separation withdrawn (${sep.kind.replace(/_/g, " ")} of ${sep.effectiveAt.slice(0, 10)})`, `${rows.length} ledger row${rows.length === 1 ? "" : "s"} reopened · ${reason.trim()}`);
      return true;
    },
    confirmRetirement: (userId, note) => {
      if (!can.prc(myRoles())) return false;
      const p = get().employeeProfiles.find((x) => x.userId === userId);
      if (!p?.separation || p.separation.kind !== "retirement" || p.separation.prcConfirmed) return false;
      const ts = now();
      set((s) => ({ employeeProfiles: s.employeeProfiles.map((x) => (x.userId === userId && x.separation ? { ...x, separation: { ...x.separation, prcConfirmed: true, prcConfirmedAt: ts, prcConfirmedById: s.currentUserId } } : x)) }) as Partial<S>);
      audit("employee", userId, "PRC confirmed the retirement — held payments are paid in the next run (§10)", note.trim());
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
