/*
 * Store slice for the Project Initiative & Compensation module. Mixed into useCrm (src/lib/store.ts).
 * Every state change writes an AuditEntry (§9.2 record keeping).
 */
import type { Activity, ActivityLinks } from "../types";
import type {
  AuditEntry,
  BonusRun,
  Clawback,
  Decision,
  DeferredBonus,
  EmployeeProfile,
  Initiative,
  InitiativeMember,
  PrcScores,
  ProjectRole,
  ProjectType,
  RevenueEntry,
  SeparationKind,
} from "./types";
import { addMonths, paymentDate, probationBalance, shareInForce, type RunResult } from "./engine";
import { PROJECT_TYPE_META, ROLE_META } from "./policy";
import type { SeedData } from "../seed";

type Uid = (prefix: string) => string;
type Get<S> = () => S;
type SetFn<S> = (partial: Partial<S> | ((s: S) => Partial<S>)) => void;

export interface InitiativeActions {
  /* proposals (§2.2–2.3) */
  saveInitiative: (input: Partial<Initiative> & { id?: string }) => string;
  submitInitiative: (id: string) => void;
  acknowledgeInitiative: (id: string, reviewerId: string) => void;
  startEvaluation: (id: string) => void;
  scoreInitiative: (id: string, scores: PrcScores) => void;
  /** PRC decision. For approval, optionally creates the delivery epic in a Jira project. */
  decideInitiative: (id: string, decision: Omit<Decision, "decidedAt" | "decidedById">, opts?: { jiraProjectId?: string; highRisk?: boolean; deferralMonths?: number }) => void;
  confirmConditions: (id: string, opts?: { jiraProjectId?: string }) => void;
  fileAppeal: (id: string, reason: string) => void;
  resolveAppeal: (id: string, status: "upheld" | "denied", notes: string) => void;
  activateInitiative: (id: string) => void;
  completeInitiative: (id: string) => void;
  deleteDraft: (id: string) => void;

  /* team (§4, §5.3, §7) */
  addMember: (initiativeId: string, userId: string, roles: ProjectRole[], opts?: Partial<Pick<InitiativeMember, "specialistWeight" | "allocationPct" | "application" | "consent">>) => string;
  updateMember: (id: string, patch: Partial<InitiativeMember>) => void;
  setConsent: (id: string, consent: InitiativeMember["consent"]) => void;
  approveMembers: (initiativeId: string) => void;
  advanceRemoval: (id: string, note: string) => void;
  removeMember: (id: string) => void;
  transferLead: (initiativeId: string, toUserId: string, reason: string) => void;

  /* revenue (§4.4) */
  addRevenueEntry: (entry: Omit<RevenueEntry, "id">) => string;
  updateRevenueEntry: (id: string, patch: Partial<RevenueEntry>) => void;
  deleteRevenueEntry: (id: string) => void;

  /* monthly run (§6.1) */
  recordRun: (result: RunResult, inputs: Pick<BonusRun, "overheads" | "ebitda" | "shareOverrides" | "partialDeferralPct">, status: "draft" | "failed" | "certified") => string;
  releaseRun: (id: string) => void;

  /* ledgers (§6.3, §6.4, §6.8) */
  releaseDeferred: (id: string, amount?: number, note?: string) => void;
  forfeitDeferred: (id: string, note: string) => void;
  completeProbation: (userId: string) => void;
  failProbation: (userId: string) => void;
  createClawback: (input: Omit<Clawback, "id" | "createdAt" | "recovered" | "status" | "notifiedAt">) => string;
  updateClawback: (id: string, patch: Partial<Clawback>) => void;

  /* HR (§1.2, §2.1, §4.5) */
  updateProfile: (userId: string, patch: Partial<EmployeeProfile>) => void;
  recordSeparation: (userId: string, kind: SeparationKind, effectiveAt: string, opts?: { noticeAt?: string; retirementNoticeDays?: number; deferredException?: boolean }) => void;

  /* policy (§6.5–6.6) */
  scheduleShareAdjustment: (type: ProjectType, toPct: number, effectiveFrom: string, rationale: string) => void;
}

type CoreState = SeedData & {
  currentUserId: string;
  addActivity: (input: Omit<Activity, "id" | "ownerId" | "timestamp"> & Partial<Pick<Activity, "ownerId" | "timestamp">>) => string;
  createIssue: (input: { projectId: string; type: "task" | "story"; summary: string; description?: string; epicId?: string | null; status?: "todo" | "backlog"; priority?: "high" | "medium" }) => string;
};

export function createInitiativeActions<S extends CoreState>(set: SetFn<S>, get: Get<S>, uid: Uid): InitiativeActions {
  const now = () => new Date().toISOString();
  const audit = (entity: AuditEntry["entity"], entityId: string, action: string, detail = ""): AuditEntry => ({ id: uid("au"), at: now(), actorId: get().currentUserId, entity, entityId, action, detail });
  const log = (entries: AuditEntry[]) => set((s) => ({ auditLog: [...entries, ...s.auditLog] }) as Partial<S>);
  const patchInitiative = (id: string, patch: Partial<Initiative>) =>
    set((s) => ({ initiatives: s.initiatives.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: now() } : i)) }) as Partial<S>);
  const ini = (id: string) => get().initiatives.find((i) => i.id === id);
  const year = () => String(new Date().getFullYear());

  const crmLinks = (i: Initiative): ActivityLinks => ({ contactIds: [], companyIds: i.companyId ? [i.companyId] : [], dealIds: i.dealId ? [i.dealId] : [], ticketIds: [] });

  /** §2.3.6 post-approval: project code, budget, PM system entry, kickoff, locked share */
  const approve = (id: string, opts: { jiraProjectId?: string } = {}) => {
    const i = ini(id);
    if (!i) return;
    const seq = get().initiatives.filter((x) => x.code).length + 1;
    const code = i.code ?? `PRJ-${year()}-${String(seq).padStart(3, "0")}`;
    let epicId = i.epicId;
    if (!epicId && opts.jiraProjectId) {
      const project = get().projects.find((p) => p.id === opts.jiraProjectId);
      if (project) {
        const n = get().epics.filter((e) => e.projectId === project.id).length + 1;
        epicId = uid("e");
        const epic = { id: epicId, projectId: project.id, key: `${project.key}-E${n}`, name: i.title, summary: `${code} · ${PROJECT_TYPE_META[i.type].short}`, color: PROJECT_TYPE_META[i.type].color, status: "todo" as const, ownerId: get().initiativeMembers.find((m) => m.initiativeId === id && m.roles.includes("project_lead"))?.userId ?? i.initiatorId };
        set((s) => ({ epics: [...s.epics, epic] }) as Partial<S>);
        get().createIssue({ projectId: project.id, type: "task", summary: `Kickoff meeting with Finance & PMO — ${code}`, description: "Baseline schedule and budget, monthly reporting requirements (§2.3.6).", epicId, status: "todo", priority: "high" });
      }
    }
    patchInitiative(id, { status: "approved", code, approvedAt: now(), epicId, lockedSharePct: i.lockedSharePct ?? shareInForce(i.type, get().shareAdjustments, now()) });
    set((s) => ({ initiativeMembers: s.initiativeMembers.map((m) => (m.initiativeId === id && m.consent === "accepted" ? { ...m, prcApproved: true } : m)) }) as Partial<S>);
    get().addActivity({ type: "note", subject: `${code} approved by PRC`, body: `${i.title} — ${PROJECT_TYPE_META[i.type].label}. Budget authorised; team formation can proceed.`, links: crmLinks(i) });
    log([audit("initiative", id, "approved", `Project code ${code}${epicId ? `, epic created` : ""}`)]);
  };

  return {
    saveInitiative: (input) => {
      const ts = now();
      if (input.id && ini(input.id)) {
        patchInitiative(input.id, input);
        return input.id;
      }
      const id = uid("ini");
      const blank: Initiative = {
        id,
        trackingNo: "",
        code: null,
        title: "Untitled initiative",
        type: "A",
        status: "draft",
        initiatorId: get().currentUserId,
        summary: "",
        valueProposition: "",
        scope: "",
        deliverables: "",
        exclusions: "",
        successCriteria: "",
        startDate: ts,
        endDate: addMonths(ts, 3),
        milestones: [],
        companyId: null,
        dealId: null,
        contractStatus: "none",
        newClient: false,
        paymentTermsDays: 30,
        revenue: { expected: 0, best: 0, worst: 0 },
        costs: { materials: 0, subcontractors: 0, equipment: 0, travel: 0, other: 0, contingencyPct: 10 },
        risks: [],
        highRisk: false,
        warranty: false,
        deferralMonths: 6,
        lockedSharePct: null,
        capException: false,
        submittedAt: null,
        acknowledgedAt: null,
        primaryReviewerId: null,
        scores: null,
        decision: null,
        appeal: null,
        approvedAt: null,
        completedAt: null,
        epicId: null,
        createdAt: ts,
        updatedAt: ts,
      };
      const created = { ...blank, ...input, id };
      set((s) => ({ initiatives: [created, ...s.initiatives] }) as Partial<S>);
      // §4.3 the initiator is automatically the Project Initiator; §2.4 and default Project Lead
      const exists = get().initiativeMembers.some((m) => m.initiativeId === id && m.userId === created.initiatorId);
      if (!exists) {
        const m: InitiativeMember = { id: uid("im"), initiativeId: id, userId: created.initiatorId, roles: ["initiator", "project_lead"], specialistWeight: null, weightOverride: null, consent: "accepted", managerApproved: true, prcApproved: false, application: false, allocationPct: 30, joinedAt: ts, leftAt: null, removal: { stage: "none", updatedAt: null, note: "" } };
        set((s) => ({ initiativeMembers: [...s.initiativeMembers, m] }) as Partial<S>);
      }
      log([audit("initiative", id, "draft created", created.title)]);
      return id;
    },
    submitInitiative: (id) => {
      const n = get().initiatives.filter((x) => x.trackingNo).length + 1;
      const trackingNo = ini(id)?.trackingNo || `PRC-${year()}-${String(n).padStart(3, "0")}`;
      patchInitiative(id, { status: "submitted", trackingNo, submittedAt: now() });
      log([audit("initiative", id, "submitted to PRC", trackingNo)]);
    },
    acknowledgeInitiative: (id, reviewerId) => {
      patchInitiative(id, { status: "screening", acknowledgedAt: now(), primaryReviewerId: reviewerId });
      log([audit("initiative", id, "acknowledged & screened", `Primary reviewer assigned`)]);
    },
    startEvaluation: (id) => {
      patchInitiative(id, { status: "evaluation" });
      log([audit("initiative", id, "detailed evaluation started")]);
    },
    scoreInitiative: (id, scores) => {
      patchInitiative(id, { scores });
      log([audit("initiative", id, "evaluation scored", `F${scores.feasibility} P${scores.profitability} R${scores.resources} S${scores.strategic} Risk${scores.risk}`)]);
    },
    decideInitiative: (id, decision, opts = {}) => {
      const full: Decision = { ...decision, decidedAt: now(), decidedById: get().currentUserId };
      const outcome = decision.ceoVeto ? "rejected" : decision.outcome;
      patchInitiative(id, { decision: { ...full, outcome }, highRisk: opts.highRisk ?? ini(id)?.highRisk ?? false, deferralMonths: opts.deferralMonths ?? ini(id)?.deferralMonths ?? 6, status: outcome === "approved" ? "approved" : outcome });
      log([audit("initiative", id, `PRC decision: ${outcome}${decision.ceoVeto ? " (CEO veto)" : ""}`, decision.rationale)]);
      if (outcome === "approved") approve(id, { jiraProjectId: opts.jiraProjectId });
      const i = ini(id);
      if (i && outcome !== "approved") get().addActivity({ type: "note", subject: `PRC decision on ${i.trackingNo}: ${outcome}`, body: decision.rationale, links: crmLinks(i) });
    },
    confirmConditions: (id, opts = {}) => {
      log([audit("initiative", id, "conditions satisfied")]);
      approve(id, opts);
    },
    fileAppeal: (id, reason) => {
      patchInitiative(id, { appeal: { filedAt: now(), filedById: get().currentUserId, reason, status: "pending", decidedAt: null, notes: "" } });
      log([audit("initiative", id, "appeal filed with Executive Committee", reason)]);
    },
    resolveAppeal: (id, status, notes) => {
      const i = ini(id);
      if (!i?.appeal) return;
      patchInitiative(id, { appeal: { ...i.appeal, status, decidedAt: now(), notes }, status: status === "upheld" ? "evaluation" : i.status });
      log([audit("initiative", id, `appeal ${status} by Executive Committee`, notes)]);
    },
    activateInitiative: (id) => {
      patchInitiative(id, { status: "active" });
      log([audit("initiative", id, "kicked off — project active")]);
    },
    completeInitiative: (id) => {
      patchInitiative(id, { status: "completed", completedAt: now() });
      log([audit("initiative", id, "completed — final reconciliation due within 30 days (§4.4)")]);
    },
    deleteDraft: (id) => {
      if (ini(id)?.status !== "draft") return;
      set((s) => ({ initiatives: s.initiatives.filter((i) => i.id !== id), initiativeMembers: s.initiativeMembers.filter((m) => m.initiativeId !== id) }) as Partial<S>);
    },

    addMember: (initiativeId, userId, roles, opts = {}) => {
      const id = uid("im");
      const i = ini(initiativeId);
      const live = i && ["approved", "active", "conditional"].includes(i.status);
      const m: InitiativeMember = {
        id,
        initiativeId,
        userId,
        roles,
        specialistWeight: roles.includes("specialist") ? opts.specialistWeight ?? 2 : null,
        weightOverride: null,
        consent: opts.consent ?? "pending",
        managerApproved: false,
        prcApproved: false,
        application: opts.application ?? false,
        allocationPct: opts.allocationPct ?? 20,
        joinedAt: now(),
        leftAt: null,
        removal: { stage: "none", updatedAt: null, note: "" },
      };
      set((s) => ({ initiativeMembers: [...s.initiativeMembers, m] }) as Partial<S>);
      log([audit("member", id, opts.application ? "applied to join" : "proposed for team", `${roles.map((r) => ROLE_META[r].label).join(" + ")}${live ? " — PRC approval required within 3 business days" : ""}`)]);
      return id;
    },
    updateMember: (id, patch) => {
      set((s) => ({ initiativeMembers: s.initiativeMembers.map((m) => (m.id === id ? { ...m, ...patch } : m)) }) as Partial<S>);
      log([audit("member", id, "updated", Object.keys(patch).join(", "))]);
    },
    setConsent: (id, consent) => {
      set((s) => ({ initiativeMembers: s.initiativeMembers.map((m) => (m.id === id ? { ...m, consent } : m)) }) as Partial<S>);
      log([audit("member", id, `consent ${consent}`)]);
    },
    approveMembers: (initiativeId) => {
      set((s) => ({ initiativeMembers: s.initiativeMembers.map((m) => (m.initiativeId === initiativeId && m.consent === "accepted" ? { ...m, prcApproved: true, managerApproved: true } : m)) }) as Partial<S>);
      log([audit("initiative", initiativeId, "team composition approved by PRC")]);
    },
    advanceRemoval: (id, note) => {
      const m = get().initiativeMembers.find((x) => x.id === id);
      if (!m) return;
      const next = m.removal.stage === "none" ? "verbal" : m.removal.stage === "verbal" ? "written" : "removed";
      set((s) => ({ initiativeMembers: s.initiativeMembers.map((x) => (x.id === id ? { ...x, removal: { stage: next, updatedAt: now(), note }, leftAt: next === "removed" ? now() : x.leftAt } : x)) }) as Partial<S>);
      log([audit("member", id, next === "removed" ? "removed from project (§5.3) — reported to HR and manager" : `${next} warning issued (§5.3)`, note)]);
    },
    removeMember: (id) => {
      const m = get().initiativeMembers.find((x) => x.id === id);
      if (!m) return;
      const i = ini(m.initiativeId);
      if (i && (i.status === "draft" || m.consent !== "accepted")) set((s) => ({ initiativeMembers: s.initiativeMembers.filter((x) => x.id !== id) }) as Partial<S>);
      else set((s) => ({ initiativeMembers: s.initiativeMembers.map((x) => (x.id === id ? { ...x, leftAt: now() } : x)) }) as Partial<S>);
      log([audit("member", id, "left the team")]);
    },
    transferLead: (initiativeId, toUserId, reason) => {
      const ts = now();
      set((s) => {
        let members = s.initiativeMembers.map((m) => (m.initiativeId === initiativeId && m.roles.includes("project_lead") && m.userId !== toUserId ? { ...m, roles: m.roles.filter((r) => r !== "project_lead") } : m));
        const target = members.find((m) => m.initiativeId === initiativeId && m.userId === toUserId && !m.leftAt);
        if (target) members = members.map((m) => (m.id === target.id ? { ...m, roles: Array.from(new Set([...m.roles, "project_lead" as const])) } : m));
        else members = [...members, { id: uid("im"), initiativeId, userId: toUserId, roles: ["project_lead"], specialistWeight: null, weightOverride: null, consent: "accepted", managerApproved: true, prcApproved: true, application: false, allocationPct: 40, joinedAt: ts, leftAt: null, removal: { stage: "none", updatedAt: null, note: "" } }];
        return { initiativeMembers: members } as Partial<S>;
      });
      log([audit("initiative", initiativeId, "Project Lead transferred (§7.2) — compensation adjusts prospectively", reason)]);
    },

    addRevenueEntry: (entry) => {
      const id = uid("rev");
      set((s) => ({ revenueEntries: [...s.revenueEntries, { ...entry, id }] }) as Partial<S>);
      log([audit("initiative", entry.initiativeId, `revenue recorded for ${entry.month}`, `${entry.revenue} revenue / ${entry.directCosts} direct costs`)]);
      return id;
    },
    updateRevenueEntry: (id, patch) => {
      set((s) => ({ revenueEntries: s.revenueEntries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }) as Partial<S>);
      const e = get().revenueEntries.find((x) => x.id === id);
      if (e) log([audit("initiative", e.initiativeId, `revenue entry ${e.month} updated`, Object.keys(patch).join(", "))]);
    },
    deleteRevenueEntry: (id) => set((s) => ({ revenueEntries: s.revenueEntries.filter((e) => e.id !== id) }) as Partial<S>),

    recordRun: (result, inputs, status) => {
      const existing = get().bonusRuns.find((r) => r.month === result.month);
      if (existing && existing.status === "released") return existing.id;
      const id = existing?.id ?? uid("run");
      const ts = now();
      const run: BonusRun = {
        id,
        month: result.month,
        status,
        ...inputs,
        operatingResult: result.operatingResult,
        totals: result.totals,
        lines: result.lines,
        certifiedById: status === "certified" ? get().currentUserId : null,
        certifiedAt: status === "certified" ? ts : null,
        releasedById: null,
        releasedAt: null,
      };
      set((s) => ({ bonusRuns: existing ? s.bonusRuns.map((r) => (r.id === id ? run : r)) : [...s.bonusRuns, run] }) as Partial<S>);
      log([audit("run", id, status === "certified" ? `break-even test passed — certified by CFO (${result.month})` : status === "failed" ? `break-even test FAILED (${result.month})` : `draft saved (${result.month})`, `Operating result ${Math.round(result.operatingResult)}`)]);
      return id;
    },
    releaseRun: (id) => {
      const run = get().bonusRuns.find((r) => r.id === id);
      if (!run || run.status !== "certified") return;
      const pay = paymentDate(run.month);
      const deferred: DeferredBonus[] = [];
      for (const l of run.lines) {
        if (l.deferred > 0) {
          const i = ini(l.initiativeId);
          deferred.push({ id: uid("def"), month: run.month, initiativeId: l.initiativeId, userId: l.userId, amount: l.deferred, vestAt: addMonths(pay, i?.deferralMonths ?? 6), status: "pending", releasedAmount: 0, note: "High-risk deferral (§6.3)" });
        }
        if (l.carriedOver > 0) {
          deferred.push({ id: uid("def"), month: run.month, initiativeId: l.initiativeId, userId: l.userId, amount: l.carriedOver, vestAt: addMonths(pay, 1), status: "pending", releasedAmount: 0, note: "Partial deferral after failed break-even test (§6.1) — payable next month if results improve" });
        }
      }
      set((s) => ({ bonusRuns: s.bonusRuns.map((r) => (r.id === id ? { ...r, status: "released", releasedById: s.currentUserId, releasedAt: now() } : r)), deferredBonuses: [...s.deferredBonuses, ...deferred] }) as Partial<S>);
      log([audit("run", id, `PRC authorised release for ${run.month} — payment ${pay.slice(0, 10)}`, `${deferred.length} deferred entries created`)]);
    },

    releaseDeferred: (id, amount, note = "") => {
      set((s) => ({ deferredBonuses: s.deferredBonuses.map((d) => (d.id === id ? { ...d, status: "released", releasedAmount: amount ?? d.amount, note: note || d.note } : d)) }) as Partial<S>);
      log([audit("deferred", id, "deferred bonus released", note)]);
    },
    forfeitDeferred: (id, note) => {
      set((s) => ({ deferredBonuses: s.deferredBonuses.map((d) => (d.id === id ? { ...d, status: "forfeited", note } : d)) }) as Partial<S>);
      log([audit("deferred", id, "deferred bonus forfeited", note)]);
    },
    completeProbation: (userId) => {
      const amount = probationBalance(userId, get().bonusRuns) - get().probationOutcomes.filter((o) => o.userId === userId).reduce((s, o) => s + o.amount, 0);
      set((s) => ({
        employeeProfiles: s.employeeProfiles.map((p) => (p.userId === userId ? { ...p, employmentType: "full_time_permanent", probationEndDate: p.probationEndDate ?? now() } : p)),
        probationOutcomes: [...s.probationOutcomes, { userId, outcome: "completed", amount, decidedAt: now() }],
      }) as Partial<S>);
      log([audit("probation", userId, "probation completed — Probation Completion Bonus payable within 30 days (§6.8)", String(Math.round(amount)))]);
    },
    failProbation: (userId) => {
      const amount = probationBalance(userId, get().bonusRuns) - get().probationOutcomes.filter((o) => o.userId === userId).reduce((s, o) => s + o.amount, 0);
      set((s) => ({
        employeeProfiles: s.employeeProfiles.map((p) => (p.userId === userId ? { ...p, separation: { kind: "probation_failed", effectiveAt: now(), recordedAt: now() } } : p)),
        probationOutcomes: [...s.probationOutcomes, { userId, outcome: "forfeited", amount, decidedAt: now() }],
      }) as Partial<S>);
      log([audit("probation", userId, "probation not completed — accumulated bonuses forfeited in full (§6.8)", String(Math.round(amount)))]);
    },
    createClawback: (input) => {
      const id = uid("cb");
      set((s) => ({ clawbacks: [...s.clawbacks, { ...input, id, createdAt: now(), recovered: 0, status: "identified", notifiedAt: null }] }) as Partial<S>);
      log([audit("clawback", id, "clawback trigger identified by Finance (§6.4)", input.trigger)]);
      return id;
    },
    updateClawback: (id, patch) => {
      set((s) => ({ clawbacks: s.clawbacks.map((c) => (c.id === id ? { ...c, ...patch } : c)) }) as Partial<S>);
      log([audit("clawback", id, patch.status ? `status → ${patch.status}` : "updated", patch.notes ?? "")]);
    },

    updateProfile: (userId, patch) => {
      set((s) => ({ employeeProfiles: s.employeeProfiles.map((p) => (p.userId === userId ? { ...p, ...patch } : p)) }) as Partial<S>);
      log([audit("employee", userId, "HR record updated", Object.keys(patch).join(", "))]);
    },
    recordSeparation: (userId, kind, effectiveAt, opts = {}) => {
      const ts = now();
      const forfeitAll = kind === "resignation" || kind === "termination_for_cause" || kind === "probation_failed";
      set((s) => ({
        employeeProfiles: s.employeeProfiles.map((p) =>
          p.userId === userId
            ? {
                ...p,
                resignationNoticeAt: kind === "resignation" ? opts.noticeAt ?? ts : p.resignationNoticeAt,
                terminationNoticeAt: kind.startsWith("termination") ? opts.noticeAt ?? ts : p.terminationNoticeAt,
                separation: { kind, effectiveAt, recordedAt: ts, retirementNoticeDays: opts.retirementNoticeDays },
              }
            : p,
        ),
        deferredBonuses: s.deferredBonuses.map((d) => {
          if (d.userId !== userId || d.status !== "pending") return d;
          if (forfeitAll) return { ...d, status: "forfeited" as const, note: `Forfeited — ${kind.replace(/_/g, " ")} (§4.5)` };
          if (kind === "termination_without_cause" && !opts.deferredException) return { ...d, status: "forfeited" as const, note: "Forfeited — no deferred bonuses on termination without cause unless CEO + PRC approve (§4.5)" };
          if (kind === "death_disability") return { ...d, status: "released" as const, releasedAmount: d.amount, note: "Vested immediately — death or permanent disability (§4.5)" };
          return d;
        }),
      }) as Partial<S>);
      log([audit("employee", userId, `separation recorded: ${kind.replace(/_/g, " ")}`, `effective ${effectiveAt.slice(0, 10)}`)]);
      // probationary employees who resign or are terminated forfeit the accrual (§6.8)
      const p = get().employeeProfiles.find((x) => x.userId === userId);
      if (p?.employmentType === "probationary" && kind !== "death_disability" && !get().probationOutcomes.some((o) => o.userId === userId)) {
        const amount = probationBalance(userId, get().bonusRuns);
        set((s) => ({ probationOutcomes: [...s.probationOutcomes, { userId, outcome: "forfeited", amount, decidedAt: ts }] }) as Partial<S>);
      }
    },

    scheduleShareAdjustment: (type, toPct, effectiveFrom, rationale) => {
      const [min, max] = PROJECT_TYPE_META[type].range;
      const pct = Math.min(max, Math.max(min, toPct));
      const fromPct = shareInForce(type, get().shareAdjustments, effectiveFrom);
      set((s) => ({ shareAdjustments: [...s.shareAdjustments, { id: uid("sa"), type, fromPct, toPct: pct, proposedAt: now(), effectiveFrom, rationale, approvedById: s.currentUserId }] }) as Partial<S>);
      log([audit("policy", type, `revenue share Type ${type}: ${Math.round(fromPct * 100)}% → ${Math.round(pct * 100)}% from ${effectiveFrom.slice(0, 10)}`, rationale)]);
    },
  };
}
