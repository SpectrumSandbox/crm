/* Store slice "Governance" (W6) — projects register & initiatives governance: PRC returns (§4.5), monthly status updates
 * (§6.1), change orders (§5.6 / §5.1 rate reset), Annex G close-out (§8.3), Annex F conflicts (§12.2), audited payment
 * deletes with undo, and proxy-vote evidence on §6.8 amendments. Every change writes an AuditEntry (§13.3). */
import type { SeedData } from "../seed";
import type { AuditEntry, ChangeOrder, CloseOutReport, CoiDeclaration, Initiative, ProjectUpdate, RevenueEntry, TeamAmendment } from "../initiatives/types";
import { nextChangeOrderRef } from "../initiatives/team-rules";
import { revenueEntryLock } from "../initiatives/engine";
import type { GetFn, SetFn, Uid } from "./types";

export type NewChangeOrder = Omit<ChangeOrder, "id" | "ref" | "raisedById" | "raisedAt" | "status"> & { status?: ChangeOrder["status"] };

export interface GovernanceSlice {
  /* §4.5 step 2 */
  returnIncomplete: (initiativeId: string, missing: string[], note: string) => void;
  /** clear the return marker when the proposer resubmits (the completeness clock restarts) */
  markResubmitted: (initiativeId: string) => void;
  /** audited change to an initiative's register figures — records before → after and the reason (§13.3) */
  recordInitiativeChange: (initiativeId: string, patch: Partial<Initiative>, reason: string) => void;
  /* draft team rows follow the proposal's start date (§6.5) */
  syncDraftTeamStart: (initiativeId: string, startIso: string) => void;
  /* §6.1 */
  postProjectUpdate: (input: Omit<ProjectUpdate, "id" | "authorId" | "at">) => string;
  deleteProjectUpdate: (id: string) => ProjectUpdate | null;
  restoreProjectUpdate: (u: ProjectUpdate) => void;
  /* §5.6 */
  createChangeOrder: (input: NewChangeOrder) => string;
  updateChangeOrder: (id: string, patch: Partial<Omit<ChangeOrder, "id" | "initiativeId" | "ref">>) => void;
  setChangeOrderStatus: (id: string, status: ChangeOrder["status"], note?: string) => void;
  /** §5.1 PRC resets the rate after change orders moved x by more than 10 % — applies to revenue realised afterwards */
  recordRateReset: (changeOrderId: string, newRatePct: number, note: string) => void;
  /* §8.3 Annex G */
  submitCloseOut: (report: Omit<CloseOutReport, "id" | "submittedById" | "submittedAt">) => string;
  /** Annex G Finance sign-off — runs the engine's §8.3 final reconciliation, then marks the report reconciled */
  reconcileCloseOut: (id: string, note?: string) => void;
  /* §12.2 Annex F */
  saveCoiDeclaration: (input: Omit<CoiDeclaration, "id" | "recordedById" | "prc">) => string;
  decideCoi: (id: string, decision: Omit<NonNullable<CoiDeclaration["prc"]>, "decidedById" | "decidedAt">) => void;
  /* §8.1 payments — audited delete with undo; released cycles are protected (§8.5 corrections go to the next cycle) */
  deletePayment: (id: string) => RevenueEntry | null;
  restorePayment: (entry: RevenueEntry) => void;
  /* §6.8 votes — every vote records who recorded it; a vote for someone else needs the signed form as evidence */
  recordAmendmentVote: (amendmentId: string, userId: string, vote: "for" | "against", evidence: string) => void;
}

type Needs = GovernanceSlice &
  Pick<SeedData, "initiatives" | "initiativeMembers" | "auditLog" | "revenueEntries" | "bonusRuns" | "projectUpdates" | "changeOrders" | "closeOutReports" | "coiDeclarations" | "teamAmendments" | "users"> & {
    currentUserId: string;
    completeInitiative: (id: string) => void;
    deleteRevenueEntry: (id: string) => boolean;
    recordFinalReconciliation: (initiativeId: string, note?: string) => unknown;
    voteAmendment: (id: string, vote: "for" | "against", userId?: string) => void;
  };

/** Is a payment's cycle already in a released bonus run? Then it can't be changed or deleted (§8.5) — engine.revenueEntryLock. */
export function paymentLocked(entry: RevenueEntry, runs: SeedData["bonusRuns"]) {
  return !!revenueEntryLock(entry, runs);
}

export function createGovernanceSlice<S extends Needs>(set: SetFn<S>, get: GetFn<S>, uid: Uid): GovernanceSlice {
  const now = () => new Date().toISOString();
  const audit = (entityId: string, action: string, detail = "", entity: AuditEntry["entity"] = "initiative"): AuditEntry => ({ id: uid("au"), at: now(), actorId: get().currentUserId, entity, entityId, action, detail });
  const log = (...entries: AuditEntry[]) => set((s) => ({ auditLog: [...entries, ...s.auditLog] }) as Partial<S>);
  const patchIni = (id: string, patch: Partial<Initiative>) => set((s) => ({ initiatives: s.initiatives.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: now() } : i)) }) as Partial<S>);
  const name = (id: string | null | undefined) => (id ? get().users.find((u) => u.id === id)?.name ?? id : "—");
  const rp = (n: number) => `Rp${Math.round(n).toLocaleString("en-US")}`;

  return {
    returnIncomplete: (initiativeId, missing, note) => {
      const i = get().initiatives.find((x) => x.id === initiativeId);
      if (!i || !["submitted", "screening"].includes(i.status)) return;
      const ret = { at: now(), byId: get().currentUserId, missing, note: note.trim(), resubmittedAt: null };
      // back to the proposer: on resubmission the PMO acknowledges again and the completeness clock restarts (§4.5 step 2)
      patchIni(initiativeId, { status: "draft", returns: [...(i.returns ?? []), ret], acknowledgedAt: null });
      log(audit(initiativeId, "returned to the proposer as incomplete (§4.5) — completeness clock restarts on resubmission", [...missing, note.trim()].filter(Boolean).join("; ")));
    },
    markResubmitted: (initiativeId) => {
      const i = get().initiatives.find((x) => x.id === initiativeId);
      if (!i?.returns?.length) return;
      const returns = i.returns.map((r, idx) => (idx === i.returns!.length - 1 && !r.resubmittedAt ? { ...r, resubmittedAt: now() } : r));
      patchIni(initiativeId, { returns });
    },
    recordInitiativeChange: (initiativeId, patch, reason) => {
      const i = get().initiatives.find((x) => x.id === initiativeId);
      if (!i) return;
      const fmt = (v: unknown) => (v == null || v === "" ? "—" : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : typeof v === "object" ? JSON.stringify(v) : String(v));
      const changed = (Object.keys(patch) as (keyof Initiative)[]).filter((k) => JSON.stringify(i[k]) !== JSON.stringify(patch[k]));
      if (!changed.length) return;
      patchIni(initiativeId, patch);
      log(audit(initiativeId, `register figures changed: ${changed.join(", ")}`, [...changed.map((k) => `${k} ${fmt(i[k])} → ${fmt(patch[k])}`), reason.trim()].filter(Boolean).join(" · ")));
    },
    syncDraftTeamStart: (initiativeId, startIso) => {
      const i = get().initiatives.find((x) => x.id === initiativeId);
      if (!i || i.status !== "draft") return;
      const rows = get().initiativeMembers.filter((m) => m.initiativeId === initiativeId && m.joinedAt !== startIso && !m.leftAt);
      if (!rows.length) return;
      const ids = new Set(rows.map((m) => m.id));
      set((s) => ({ initiativeMembers: s.initiativeMembers.map((m) => (ids.has(m.id) ? { ...m, joinedAt: startIso } : m)) }) as Partial<S>);
      log(audit(initiativeId, "draft team start dates moved with the proposal start (§6.5)", `${rows.length} row${rows.length === 1 ? "" : "s"} → ${startIso.slice(0, 10)}`));
    },

    postProjectUpdate: (input) => {
      const id = uid("pu");
      const u: ProjectUpdate = { ...input, id, authorId: get().currentUserId, at: now() };
      set((s) => ({ projectUpdates: [u, ...s.projectUpdates] }) as Partial<S>);
      log(audit(input.initiativeId, `monthly status update ${input.month} — ${input.health.toUpperCase()} (§6.1)`, input.summary.slice(0, 160)));
      return id;
    },
    deleteProjectUpdate: (id) => {
      const u = get().projectUpdates.find((x) => x.id === id) ?? null;
      if (!u) return null;
      set((s) => ({ projectUpdates: s.projectUpdates.filter((x) => x.id !== id) }) as Partial<S>);
      log(audit(u.initiativeId, `status update ${u.month} withdrawn`, u.summary.slice(0, 120)));
      return u;
    },
    restoreProjectUpdate: (u) => {
      if (get().projectUpdates.some((x) => x.id === u.id)) return;
      set((s) => ({ projectUpdates: [u, ...s.projectUpdates] }) as Partial<S>);
      log(audit(u.initiativeId, `status update ${u.month} restored`));
    },

    createChangeOrder: (input) => {
      const id = uid("co");
      const ref = nextChangeOrderRef(get().changeOrders, input.initiativeId);
      const co: ChangeOrder = { ...input, id, ref, status: input.status ?? "draft", raisedById: get().currentUserId, raisedAt: now() };
      set((s) => ({ changeOrders: [...s.changeOrders, co] }) as Partial<S>);
      log(audit(input.initiativeId, `change order ${ref} raised (§5.6)`, `${input.title} · price ${rp(input.priceDelta)} · cost ${rp(input.costDelta)} · ${input.scheduleDeltaDays}d`));
      return id;
    },
    updateChangeOrder: (id, patch) => {
      const co = get().changeOrders.find((c) => c.id === id);
      if (!co || co.status === "approved" || co.status === "rejected") return;
      set((s) => ({ changeOrders: s.changeOrders.map((c) => (c.id === id ? { ...c, ...patch } : c)) }) as Partial<S>);
      log(audit(co.initiativeId, `change order ${co.ref} edited`, Object.keys(patch).join(", ")));
    },
    setChangeOrderStatus: (id, status, note = "") => {
      const co = get().changeOrders.find((c) => c.id === id);
      if (!co || co.status === "approved" || co.status === "rejected") return;
      const ts = now();
      const decided = status === "approved" || status === "rejected";
      set((s) => ({ changeOrders: s.changeOrders.map((c) => (c.id === id ? { ...c, status, clientSignedAt: status === "client_signed" ? ts : c.clientSignedAt ?? null, decidedById: decided ? s.currentUserId : c.decidedById ?? null, decidedAt: decided ? ts : c.decidedAt ?? null, note: note || c.note } : c)) }) as Partial<S>);
      const label = status === "approved" ? "approved — adds to project revenue (§5.6)" : status === "rejected" ? "rejected — out-of-scope work adds cost but no revenue (§5.6)" : status === "client_signed" ? "signed by the client" : status === "submitted" ? "sent to the client" : "returned to draft";
      log(audit(co.initiativeId, `change order ${co.ref} ${label}`, note));
    },
    recordRateReset: (changeOrderId, newRatePct, note) => {
      const co = get().changeOrders.find((c) => c.id === changeOrderId);
      if (!co || co.status !== "approved") return;
      set((s) => ({ changeOrders: s.changeOrders.map((c) => (c.id === changeOrderId ? { ...c, rateResetAt: now(), rateResetNote: note.trim(), rateResetPct: newRatePct } : c)) }) as Partial<S>);
      log(audit(co.initiativeId, `PRC reset the revenue-share rate to ${(newRatePct * 100).toFixed(3)}% after ${co.ref} (§5.1) — applies to revenue realised from today; bonuses already paid are not recalculated`, note.trim()));
    },

    submitCloseOut: (report) => {
      const id = uid("cor");
      const full: CloseOutReport = { ...report, id, submittedById: get().currentUserId, submittedAt: now(), reconciledAt: null };
      set((s) => ({ closeOutReports: [...s.closeOutReports.filter((r) => r.initiativeId !== report.initiativeId), full] }) as Partial<S>);
      log(audit(report.initiativeId, "Annex G close-out report submitted by the Project Lead (§8.3) — Finance reconciles within 30 days", `Revenue ${rp(report.actualRevenue)} · direct costs ${rp(report.actualDirectCosts)} · accepted ${report.acceptanceDate.slice(0, 10)}`));
      const i = get().initiatives.find((x) => x.id === report.initiativeId);
      if (i && i.status !== "completed") get().completeInitiative(report.initiativeId);
      return id;
    },
    reconcileCloseOut: (id, note = "") => {
      const r = get().closeOutReports.find((x) => x.id === id);
      if (!r || r.reconciledAt) return;
      // §8.3 Finance recalculates the pool on final figures (engine: top-ups to the next open cycle, overpayments off deferrals first)
      if (!get().recordFinalReconciliation(r.initiativeId, note)) return;
      set((s) => ({ closeOutReports: s.closeOutReports.map((x) => (x.id === id ? { ...x, reconciledAt: now(), signOff: { ...x.signOff, financeId: x.signOff.financeId ?? s.currentUserId } } : x)) }) as Partial<S>);
      log(audit(r.initiativeId, "Annex G signed off by Finance after the final reconciliation (§8.3)", `by ${name(get().currentUserId)}`));
    },

    saveCoiDeclaration: (input) => {
      const id = uid("coi");
      const d: CoiDeclaration = { ...input, id, recordedById: get().currentUserId, prc: null };
      set((s) => ({ coiDeclarations: [...s.coiDeclarations, d] }) as Partial<S>);
      const yes = Object.entries(input.answers).filter(([, a]) => a.yes).length;
      const onBehalf = input.userId !== get().currentUserId ? ` — recorded by ${name(get().currentUserId)} from the signed form` : "";
      log(audit(input.initiativeId, `Annex F conflict-of-interest declaration — ${name(input.userId)}: ${yes ? `${yes} relationship${yes === 1 ? "" : "s"} declared` : "no conflict"} (§12.2)${onBehalf}`));
      return id;
    },
    decideCoi: (id, decision) => {
      const d = get().coiDeclarations.find((x) => x.id === id);
      if (!d) return;
      set((s) => ({ coiDeclarations: s.coiDeclarations.map((x) => (x.id === id ? { ...x, prc: { ...decision, decidedById: s.currentUserId, decidedAt: now() } } : x)) }) as Partial<S>);
      log(audit(d.initiativeId, `PRC decided ${name(d.userId)}'s conflict: ${decision.conflict ? "conflict found" : "no conflict"} · action ${decision.action.replace(/_/g, " ")} (§12.2)`, decision.note));
    },

    deletePayment: (id) => {
      const e = get().revenueEntries.find((x) => x.id === id) ?? null;
      if (!e || paymentLocked(e, get().bonusRuns)) return null;
      // the engine action refuses (false) when a released cycle paid it, and writes the audit entry itself
      if (!get().deleteRevenueEntry(id)) return null;
      return e;
    },
    restorePayment: (entry) => {
      if (get().revenueEntries.some((x) => x.id === entry.id)) return;
      set((s) => ({ revenueEntries: [...s.revenueEntries, entry] }) as Partial<S>);
      log(audit(entry.initiativeId, `payment restored (cycle ${entry.month})`, `${rp(entry.revenue)} revenue`));
    },

    recordAmendmentVote: (amendmentId, userId, vote, evidence) => {
      const a: TeamAmendment | undefined = get().teamAmendments.find((x) => x.id === amendmentId);
      if (!a || a.status !== "open") return;
      const me = get().currentUserId;
      if (userId !== me && evidence.trim().length < 5) return;
      get().voteAmendment(amendmentId, vote, userId);
      set((s) => ({ teamAmendments: s.teamAmendments.map((x) => (x.id === amendmentId ? { ...x, votes: x.votes.map((v) => (v.userId === userId ? { ...v, recordedById: me, evidence: userId === me ? "" : evidence.trim() } : v)) } : x)) }) as Partial<S>);
      if (userId !== me) log(audit(amendmentId, `vote ${vote} for ${name(userId)} recorded by ${name(me)} from their signed amendment form (Annex D Part 2)`, evidence.trim(), "amendment"));
    },
  };
}
