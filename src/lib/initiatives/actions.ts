/*
 * Store slice for the Project Initiative & Compensation module (Policy v4.0). Mixed into useCrm (src/lib/store.ts).
 * Every state change writes an AuditEntry (§13.3 records).
 */
import type { Activity, ActivityLinks, SpectrumColor, Team, User } from "../types";
import type {
  AuditEntry,
  BonusRun,
  Clawback,
  Decision,
  DeferredBonus,
  EmployeeProfile,
  EmploymentType,
  Initiative,
  InitiativeMember,
  PrcScores,
  ProjectRole,
  RevenueEntry,
  SeparationKind,
  TeamAmendment,
} from "./types";
import { addMonths, curveInForce, deferralTriggers, deferralVestDate, paymentDate, probationBalance, projectRate, type RunResult } from "./engine";
import { CURVE_LIMITS, POLICY, PROJECT_TYPE_META, ROLE_META, type Curve } from "./policy";
import type { SeedData } from "../seed";

type Uid = (prefix: string) => string;
type Get<S> = () => S;
type SetFn<S> = (partial: Partial<S> | ((s: S) => Partial<S>)) => void;

export type MemberInput = Partial<Pick<InitiativeMember, "specialistWeight" | "weightOverride" | "weightNote" | "allocationFactor" | "allocationPct" | "application" | "consent" | "managerApproved" | "prcApproved" | "joinedAt" | "authority">>;

export interface NewPersonInput {
  name: string;
  email: string;
  title: string;
  team: Team;
  employmentType: EmploymentType;
  hireDate: string;
  directManagerId: string | null;
  annualBaseSalary?: number;
  probationEndDate?: string | null;
  contractEndDate?: string | null;
  contractedHoursPct?: number;
  acknowledgmentSignedAt?: string | null;
}

export interface InitiativeActions {
  /* proposals (§4) */
  saveInitiative: (input: Partial<Initiative> & { id?: string }) => string;
  submitInitiative: (id: string) => void;
  acknowledgeInitiative: (id: string, reviewerId: string) => void;
  startEvaluation: (id: string) => void;
  scoreInitiative: (id: string, scores: PrcScores) => void;
  /** PRC decision. For approval, fixes the revenue-share rate and optionally creates the delivery epic in a Jira project. */
  decideInitiative: (id: string, decision: Omit<Decision, "decidedAt" | "decidedById">, opts?: { jiraProjectId?: string; highRisk?: boolean; deferralMonths?: number; deferralPct?: number; standardBonus?: number }) => void;
  confirmConditions: (id: string, opts?: { jiraProjectId?: string }) => void;
  fileAppeal: (id: string, reason: string) => void;
  resolveAppeal: (id: string, status: "upheld" | "denied", notes: string) => void;
  activateInitiative: (id: string) => void;
  completeInitiative: (id: string) => void;
  deleteDraft: (id: string) => void;

  /* team & Team Allocation Ledger (§6.5–6.8, §7) */
  addMember: (initiativeId: string, userId: string, roles: ProjectRole[], opts?: MemberInput) => string;
  updateMember: (id: string, patch: Partial<InitiativeMember>) => void;
  /** Close a ledger row on `effectiveFrom` and open a new one with the change (amendments never change past work, §6.8). */
  amendLedgerRow: (id: string, patch: Partial<Pick<InitiativeMember, "roles" | "specialistWeight" | "weightOverride" | "allocationFactor" | "weightNote">>, effectiveFrom: string, authority: string) => string | null;
  setConsent: (id: string, consent: InitiativeMember["consent"]) => void;
  approveMembers: (initiativeId: string) => void;
  advanceRemoval: (id: string, note: string) => void;
  removeMember: (id: string) => void;
  transferLead: (initiativeId: string, toUserId: string, reason: string) => void;
  /* §6.8 amendments */
  proposeAmendment: (initiativeId: string, change: TeamAmendment["change"], effectiveDate: string, reason: string) => string;
  voteAmendment: (id: string, vote: "for" | "against", userId?: string) => void;
  prcDecideAmendment: (id: string, outcome: "passed" | "failed" | "blocked", note: string) => void;

  /* client payments (§8.1) */
  addRevenueEntry: (entry: Omit<RevenueEntry, "id">) => string;
  updateRevenueEntry: (id: string, patch: Partial<RevenueEntry>) => void;
  deleteRevenueEntry: (id: string) => void;

  /* monthly cycle (§8.2, §9.1–9.2) */
  /** `certifiedById` records the CFO when someone else enters her certification (audit shows who recorded it). */
  recordRun: (result: RunResult, inputs: Pick<BonusRun, "companyRevenue" | "directCosts" | "overheads" | "cash" | "fixedCostsMonthly">, status: "draft" | "failed" | "certified", opts?: { certifiedById?: string }) => string;
  releaseRun: (id: string) => void;

  /* ledgers (§9.3, §9.4, §11) */
  releaseDeferred: (id: string, amount?: number, note?: string) => void;
  forfeitDeferred: (id: string, note: string) => void;
  /** §9.3 reduce a pending deferred amount (warranty/rework costs, written-off invoice, misstated forecast) or offset a clawback (§9.4) without paying it. */
  reduceDeferred: (id: string, amount: number, note: string) => void;
  completeProbation: (userId: string) => void;
  failProbation: (userId: string) => void;
  createClawback: (input: Omit<Clawback, "id" | "createdAt" | "recovered" | "status" | "notifiedAt">) => string;
  updateClawback: (id: string, patch: Partial<Clawback>) => void;

  /* HR (§3, §10) */
  updateProfile: (userId: string, patch: Partial<EmployeeProfile>) => void;
  recordSeparation: (userId: string, kind: SeparationKind, effectiveAt: string, opts?: { noticeAt?: string; retirementNoticeDays?: number; prcConfirmed?: boolean }) => void;
  /** Add a real employee who is not yet in the workspace (user + HR record). Returns the user id. */
  addPerson: (input: NewPersonInput) => string;

  /* policy (§9.5) */
  scheduleCurveAdjustment: (to: Curve, effectiveFrom: string, rationale: string) => string | null;
}

type CoreState = SeedData & {
  currentUserId: string;
  addActivity: (input: Omit<Activity, "id" | "ownerId" | "timestamp"> & Partial<Pick<Activity, "ownerId" | "timestamp">>) => string;
  createIssue: (input: { projectId: string; type: "task" | "story"; summary: string; description?: string; epicId?: string | null; status?: "todo" | "backlog"; priority?: "high" | "medium" }) => string;
};

const COLORS: SpectrumColor[] = ["magenta", "blue", "cyan", "green", "yellow", "orange", "red"];
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export function createInitiativeActions<S extends CoreState>(set: SetFn<S>, get: Get<S>, uid: Uid): InitiativeActions {
  const now = () => new Date().toISOString();
  const audit = (entity: AuditEntry["entity"], entityId: string, action: string, detail = ""): AuditEntry => ({ id: uid("au"), at: now(), actorId: get().currentUserId, entity, entityId, action, detail });
  const log = (entries: AuditEntry[]) => set((s) => ({ auditLog: [...entries, ...s.auditLog] }) as Partial<S>);
  const patchInitiative = (id: string, patch: Partial<Initiative>) => set((s) => ({ initiatives: s.initiatives.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: now() } : i)) }) as Partial<S>);
  const ini = (id: string) => get().initiatives.find((i) => i.id === id);
  const year = () => String(new Date().getFullYear());
  const crmLinks = (i: Initiative): ActivityLinks => ({ contactIds: [], companyIds: i.companyId ? [i.companyId] : [], dealIds: i.dealId ? [i.dealId] : [], ticketIds: [] });
  const userName = (id: string) => get().users.find((u) => u.id === id)?.name ?? id;
  const blankRow = (initiativeId: string, userId: string, roles: ProjectRole[], opts: MemberInput = {}): InitiativeMember => ({
    id: uid("im"),
    initiativeId,
    userId,
    roles,
    specialistWeight: roles.includes("specialist") ? opts.specialistWeight ?? 2 : null,
    weightOverride: opts.weightOverride ?? null,
    weightNote: opts.weightNote ?? "",
    allocationFactor: opts.allocationFactor ?? 1,
    consent: opts.consent ?? "pending",
    managerApproved: opts.managerApproved ?? false,
    prcApproved: opts.prcApproved ?? false,
    application: opts.application ?? false,
    allocationPct: opts.allocationPct ?? 20,
    joinedAt: opts.joinedAt ?? now(),
    leftAt: null,
    removal: { stage: "none", updatedAt: null, note: "" },
    authority: opts.authority ?? "Role and Weight Agreement (Annex D Part 1)",
  });
  /** day before `iso` at 23:59 WIB — the closing date of a ledger row that changes on `iso` */
  const dayBefore = (iso: string) => new Date(Date.parse(iso) - 1).toISOString();

  /** §4.5 after approval: project code, budget, type and revenue-share rate; PMO opens the project and the ledger. */
  const approve = (id: string, opts: { jiraProjectId?: string } = {}) => {
    const i = ini(id);
    if (!i) return;
    const seq = get().initiatives.filter((x) => x.code).length + 1;
    const code = i.code ?? `PRJ-${year()}-${String(seq).padStart(3, "0")}`;
    let epicId = i.epicId;
    const jiraProjectId = opts.jiraProjectId ?? i.jiraProjectId ?? undefined;
    if (!epicId && jiraProjectId) {
      const project = get().projects.find((p) => p.id === jiraProjectId);
      if (project) {
        const n = get().epics.filter((e) => e.projectId === project.id).length + 1;
        epicId = uid("e");
        const epic = { id: epicId, projectId: project.id, key: `${project.key}-E${n}`, name: i.title, summary: `${code} · ${PROJECT_TYPE_META[i.type].short}`, color: PROJECT_TYPE_META[i.type].color, status: "todo" as const, ownerId: get().initiativeMembers.find((m) => m.initiativeId === id && m.roles.includes("project_lead"))?.userId ?? i.initiatorId };
        set((s) => ({ epics: [...s.epics, epic] }) as Partial<S>);
        get().createIssue({ projectId: project.id, type: "task", summary: `Kickoff with Finance & PMO — ${code}`, description: "Baseline budget and schedule recorded, Team Allocation Ledger set up, work periods for each payment milestone agreed (§4.5, §6.5).", epicId, status: "todo", priority: "high" });
      }
    }
    const rate = projectRate(i, get().curveAdjustments);
    // the PRC fixes the rate in its approval decision (§5.1); a project with no projection keeps it open
    const lockedSharePct = i.lockedSharePct ?? (rate.source === "curve" ? rate.rate : null);
    patchInitiative(id, { status: "approved", code, approvedAt: now(), epicId, jiraProjectId: jiraProjectId ?? i.jiraProjectId ?? null, lockedSharePct, policyVersion: i.policyVersion ?? "4.0" });
    set((s) => ({ initiativeMembers: s.initiativeMembers.map((m) => (m.initiativeId === id && m.consent === "accepted" ? { ...m, prcApproved: true } : m)) }) as Partial<S>);
    get().addActivity({ type: "note", subject: `${code} approved by PRC`, body: `${i.title} — ${PROJECT_TYPE_META[i.type].label}. Revenue-share rate ${lockedSharePct != null ? `${(lockedSharePct * 100).toFixed(3)}%` : "to be fixed once the expected case is entered"}.`, links: crmLinks(i) });
    log([audit("initiative", id, "approved", `Project code ${code} · rate ${lockedSharePct != null ? `${(lockedSharePct * 100).toFixed(3)}%` : "open"}${epicId ? " · epic created" : ""}`)]);
  };

  /** Apply a passed §6.8 amendment to the ledger. */
  const applyAmendment = (a: TeamAmendment) => {
    const authority = `Amendment ${a.id}`;
    if (a.change.kind === "add") {
      const c = a.change;
      const row = blankRow(a.initiativeId, c.userId, c.roles, { specialistWeight: c.specialistWeight, weightOverride: c.weightOverride, allocationFactor: c.allocationFactor, consent: c.consent ? "accepted" : "pending", managerApproved: true, prcApproved: true, application: true, joinedAt: a.effectiveDate, authority });
      set((s) => ({ initiativeMembers: [...s.initiativeMembers, row] }) as Partial<S>);
    } else if (a.change.kind === "remove") {
      const memberId = a.change.memberId;
      set((s) => ({ initiativeMembers: s.initiativeMembers.map((m) => (m.id === memberId ? { ...m, leftAt: a.effectiveDate } : m)) }) as Partial<S>);
    } else {
      const c = a.change;
      actions.amendLedgerRow(c.memberId, { roles: c.roles, specialistWeight: c.specialistWeight, weightOverride: c.weightOverride, allocationFactor: c.allocationFactor }, a.effectiveDate, authority);
    }
    set((s) => ({ teamAmendments: s.teamAmendments.map((x) => (x.id === a.id ? { ...x, recordedAt: now() } : x)) }) as Partial<S>);
  };

  /** Current team for voting: distinct people with a live ledger row (a joining person does not vote on their own admission). */
  const voters = (initiativeId: string, excludeUserId?: string) =>
    [...new Set(get().initiativeMembers.filter((m) => m.initiativeId === initiativeId && m.consent === "accepted" && m.prcApproved && (!m.leftAt || Date.parse(m.leftAt) > Date.now())).map((m) => m.userId))].filter((u) => u !== excludeUserId);

  const tally = (a: TeamAmendment): TeamAmendment["status"] => {
    const joining = a.change.kind === "add" ? a.change.userId : undefined;
    const team = voters(a.initiativeId, joining);
    const valid = a.votes.filter((v) => team.includes(v.userId));
    const yes = valid.filter((v) => v.vote === "for").length;
    const no = valid.filter((v) => v.vote === "against").length;
    const n = team.length;
    if (n === 0) return "tied";
    if (yes > n / 2) return "passed";
    if (yes * 2 === n && yes + no === n) return "tied";
    if (no >= n - Math.floor(n / 2) && yes * 2 < n) return "failed";
    return "open";
  };

  const actions: InitiativeActions = {
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
        origination: "personal",
        firstContactAt: null,
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
        unusualTerms: false,
        deferralMonths: 6,
        deferralPct: POLICY.deferral.defaultPct,
        lockedSharePct: null,
        policyVersion: "4.0",
        standardBonus: input.type === "C" ? POLICY.typeCMinimum.standardBonus : undefined,
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
      // §4.9 the Initiator becomes Project Lead unless they delegate; no Initiator weight for company channels (§4.1)
      const exists = get().initiativeMembers.some((m) => m.initiativeId === id && m.userId === created.initiatorId);
      if (!exists && created.status === "draft") {
        const roles: ProjectRole[] = created.origination === "company" ? ["project_lead"] : ["initiator", "project_lead"];
        set((s) => ({ initiativeMembers: [...s.initiativeMembers, blankRow(id, created.initiatorId, roles, { consent: "accepted", managerApproved: true, allocationPct: 30, joinedAt: created.startDate })] }) as Partial<S>);
      }
      log([audit("initiative", id, created.status === "draft" ? "draft created" : `registered (${created.status})`, created.title)]);
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
      log([audit("initiative", id, "acknowledged & completeness checked", `Reviewer: ${userName(reviewerId)}`)]);
    },
    startEvaluation: (id) => {
      patchInitiative(id, { status: "evaluation" });
      log([audit("initiative", id, "evaluation started with Finance (§4.4)")]);
    },
    scoreInitiative: (id, scores) => {
      patchInitiative(id, { scores });
      log([audit("initiative", id, "evaluation scored", `F${scores.feasibility} P${scores.profitability} R${scores.resources} S${scores.strategic} Risk${scores.risk}`)]);
    },
    decideInitiative: (id, decision, opts = {}) => {
      const full: Decision = { ...decision, decidedAt: now(), decidedById: get().currentUserId };
      const outcome = decision.ceoVeto ? "rejected" : decision.outcome;
      const cur = ini(id);
      patchInitiative(id, {
        decision: { ...full, outcome },
        highRisk: opts.highRisk ?? cur?.highRisk ?? false,
        deferralMonths: opts.deferralMonths ?? cur?.deferralMonths ?? 6,
        deferralPct: opts.deferralPct ?? cur?.deferralPct ?? POLICY.deferral.defaultPct,
        standardBonus: cur?.type === "C" ? Math.max(POLICY.typeCMinimum.standardBonus, opts.standardBonus ?? cur.standardBonus ?? 0) : cur?.standardBonus,
        status: outcome === "approved" ? "approved" : outcome,
      });
      log([audit("initiative", id, `PRC decision: ${outcome}${decision.ceoVeto ? " (CEO veto)" : ""}`, decision.rationale)]);
      if (outcome === "approved") approve(id, { jiraProjectId: opts.jiraProjectId });
      const i = ini(id);
      if (i && outcome !== "approved") get().addActivity({ type: "note", subject: `PRC decision on ${i.trackingNo}: ${outcome}`, body: decision.rationale, links: crmLinks(i) });
    },
    confirmConditions: (id, opts = {}) => {
      log([audit("initiative", id, "conditions confirmed by PMO")]);
      approve(id, opts);
    },
    fileAppeal: (id, reason) => {
      patchInitiative(id, { appeal: { filedAt: now(), filedById: get().currentUserId, reason, status: "pending", decidedAt: null, notes: "" } });
      log([audit("initiative", id, "appeal filed with Executive Committee (§4.6)", reason)]);
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
      log([audit("initiative", id, "closed — final reconciliation within 30 days; deferrals vest 6–12 months after close (§8.3, §9.3)")]);
    },
    deleteDraft: (id) => {
      if (ini(id)?.status !== "draft") return;
      set((s) => ({ initiatives: s.initiatives.filter((i) => i.id !== id), initiativeMembers: s.initiativeMembers.filter((m) => m.initiativeId !== id), teamAmendments: s.teamAmendments.filter((a) => a.initiativeId !== id) }) as Partial<S>);
    },

    addMember: (initiativeId, userId, roles, opts = {}) => {
      const i = ini(initiativeId);
      const row = blankRow(initiativeId, userId, roles, { joinedAt: opts.joinedAt ?? (i && i.status === "draft" ? i.startDate : now()), ...opts });
      set((s) => ({ initiativeMembers: [...s.initiativeMembers, row] }) as Partial<S>);
      log([audit("member", row.id, opts.application ? "added by amendment" : "added to the Role and Weight Agreement", `${userName(userId)} — ${roles.map((r) => ROLE_META[r].label).join(" + ")} · A ${row.allocationFactor}`)]);
      return row.id;
    },
    updateMember: (id, patch) => {
      set((s) => ({ initiativeMembers: s.initiativeMembers.map((m) => (m.id === id ? { ...m, ...patch } : m)) }) as Partial<S>);
      log([audit("member", id, "ledger row updated", Object.keys(patch).join(", "))]);
    },
    amendLedgerRow: (id, patch, effectiveFrom, authority) => {
      const m = get().initiativeMembers.find((x) => x.id === id);
      if (!m) return null;
      // a row that has not started yet (or a draft) is edited in place
      if (Date.parse(effectiveFrom) <= Date.parse(m.joinedAt)) {
        set((s) => ({ initiativeMembers: s.initiativeMembers.map((x) => (x.id === id ? { ...x, ...patch, authority } : x)) }) as Partial<S>);
        log([audit("member", id, "ledger row amended", authority)]);
        return id;
      }
      const next: InitiativeMember = { ...m, ...patch, id: uid("im"), joinedAt: effectiveFrom, leftAt: m.leftAt && Date.parse(m.leftAt) > Date.parse(effectiveFrom) ? m.leftAt : null, authority, application: true };
      set((s) => ({ initiativeMembers: [...s.initiativeMembers.map((x) => (x.id === id ? { ...x, leftAt: dayBefore(effectiveFrom) } : x)), next] }) as Partial<S>);
      log([audit("member", next.id, "ledger row closed and reopened (§6.8)", `${userName(m.userId)} from ${effectiveFrom.slice(0, 10)} — ${authority}`)]);
      return next.id;
    },
    setConsent: (id, consent) => {
      set((s) => ({ initiativeMembers: s.initiativeMembers.map((m) => (m.id === id ? { ...m, consent } : m)) }) as Partial<S>);
      log([audit("member", id, consent === "accepted" ? "signed the Role and Weight Agreement" : `consent ${consent}`)]);
    },
    approveMembers: (initiativeId) => {
      set((s) => ({ initiativeMembers: s.initiativeMembers.map((m) => (m.initiativeId === initiativeId && m.consent === "accepted" ? { ...m, prcApproved: true } : m)) }) as Partial<S>);
      log([audit("initiative", initiativeId, "PRC checked the Role and Weight Agreement — eligibility, leadership capacity, line manager agreement (§6.7)")]);
    },
    advanceRemoval: (id, note) => {
      const m = get().initiativeMembers.find((x) => x.id === id);
      if (!m) return;
      const next = m.removal.stage === "none" ? "verbal" : m.removal.stage === "verbal" ? "written" : "removed";
      set((s) => ({ initiativeMembers: s.initiativeMembers.map((x) => (x.id === id ? { ...x, removal: { stage: next, updatedAt: now(), note }, leftAt: next === "removed" ? now() : x.leftAt } : x)) }) as Partial<S>);
      log([audit("member", id, next === "removed" ? "removed with PRC approval (§7.5) — keeps share for work periods up to today; reported to HR and line manager" : `${next} project warning (§7.5) — not a disciplinary warning (§3.4)`, note)]);
    },
    removeMember: (id) => {
      const m = get().initiativeMembers.find((x) => x.id === id);
      if (!m) return;
      const i = ini(m.initiativeId);
      if (i && (i.status === "draft" || m.consent !== "accepted")) set((s) => ({ initiativeMembers: s.initiativeMembers.filter((x) => x.id !== id) }) as Partial<S>);
      else set((s) => ({ initiativeMembers: s.initiativeMembers.map((x) => (x.id === id ? { ...x, leftAt: now() } : x)) }) as Partial<S>);
      log([audit("member", id, "left the team — paid for work periods while on the team (§6.5)")]);
    },
    transferLead: (initiativeId, toUserId, reason) => {
      const ts = now();
      const authority = `Lead delegation ${ts.slice(0, 10)}`;
      for (const m of get().initiativeMembers.filter((x) => x.initiativeId === initiativeId && x.roles.includes("project_lead") && x.userId !== toUserId && (!x.leftAt || Date.parse(x.leftAt) > Date.now()))) {
        const roles = m.roles.filter((r) => r !== "project_lead");
        if (roles.length) actions.amendLedgerRow(m.id, { roles }, ts, authority);
        else set((s) => ({ initiativeMembers: s.initiativeMembers.map((x) => (x.id === m.id ? { ...x, leftAt: ts } : x)) }) as Partial<S>);
      }
      const target = get().initiativeMembers.find((m) => m.initiativeId === initiativeId && m.userId === toUserId && (!m.leftAt || Date.parse(m.leftAt) > Date.now()));
      if (target) actions.amendLedgerRow(target.id, { roles: Array.from(new Set([...target.roles, "project_lead" as const])) }, ts, authority);
      else actions.addMember(initiativeId, toUserId, ["project_lead"], { consent: "accepted", managerApproved: true, prcApproved: true, application: true, allocationPct: 40, joinedAt: ts, authority });
      log([audit("initiative", initiativeId, "Project Lead delegated (§4.9, §6.3) — Initiator keeps 0.5; applies from today, never to past work", reason)]);
    },

    proposeAmendment: (initiativeId, change, effectiveDate, reason) => {
      const id = uid("am");
      const me = get().currentUserId;
      const a: TeamAmendment = { id, initiativeId, proposedById: me, circulatedAt: now(), effectiveDate, reason, change, votes: voters(initiativeId).includes(me) ? [{ userId: me, vote: "for", at: now() }] : [], status: "open", prcDecision: null, recordedAt: null };
      a.status = tally(a);
      set((s) => ({ teamAmendments: [...s.teamAmendments, a] }) as Partial<S>);
      log([audit("amendment", id, "amendment circulated to the team (§6.8)", reason)]);
      if (a.status === "passed") applyAmendment(a);
      return id;
    },
    voteAmendment: (id, vote, userId) => {
      const voter = userId ?? get().currentUserId;
      const a = get().teamAmendments.find((x) => x.id === id);
      if (!a || a.status !== "open") return;
      const votes = [...a.votes.filter((v) => v.userId !== voter), { userId: voter, vote, at: now() }];
      const updated = { ...a, votes };
      updated.status = tally(updated);
      set((s) => ({ teamAmendments: s.teamAmendments.map((x) => (x.id === id ? updated : x)) }) as Partial<S>);
      log([audit("amendment", id, `${userName(voter)} voted ${vote}`, updated.status !== "open" ? `result: ${updated.status}` : "")]);
      if (updated.status === "passed") applyAmendment(updated);
    },
    prcDecideAmendment: (id, outcome, note) => {
      const a = get().teamAmendments.find((x) => x.id === id);
      if (!a) return;
      const updated: TeamAmendment = { ...a, status: outcome, prcDecision: { outcome, note, at: now(), byId: get().currentUserId } };
      set((s) => ({ teamAmendments: s.teamAmendments.map((x) => (x.id === id ? updated : x)) }) as Partial<S>);
      log([audit("amendment", id, outcome === "blocked" ? "PRC blocked the amendment — breaks the policy (§6.8)" : `PRC deciding vote: ${outcome}`, note)]);
      if (outcome === "passed") applyAmendment(updated);
    },

    addRevenueEntry: (entry) => {
      const id = uid("rev");
      set((s) => ({ revenueEntries: [...s.revenueEntries, { ...entry, id }] }) as Partial<S>);
      log([audit("initiative", entry.initiativeId, entry.received ? `payment collected — cycle ${entry.month}` : `payment earned, awaiting collection (${entry.month})`, `${entry.revenue} revenue / ${entry.directCosts} direct costs`)]);
      return id;
    },
    updateRevenueEntry: (id, patch) => {
      set((s) => ({ revenueEntries: s.revenueEntries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }) as Partial<S>);
      const e = get().revenueEntries.find((x) => x.id === id);
      if (e) log([audit("initiative", e.initiativeId, `payment ${e.month} updated`, Object.keys(patch).join(", "))]);
    },
    deleteRevenueEntry: (id) => set((s) => ({ revenueEntries: s.revenueEntries.filter((e) => e.id !== id) }) as Partial<S>),

    recordRun: (result, inputs, status, opts = {}) => {
      const existing = get().bonusRuns.find((r) => r.month === result.month);
      if (existing && existing.status === "released") return existing.id;
      const id = existing?.id ?? uid("run");
      const ts = now();
      const run: BonusRun = {
        id,
        month: result.month,
        status,
        policyVersion: "4.0",
        ...inputs,
        operatingResult: result.operatingResult,
        cashAfter: result.cashAfter,
        payoutPct: result.payoutPct,
        totals: result.totals,
        lines: result.lines,
        certifiedById: status === "certified" ? opts.certifiedById ?? get().currentUserId : null,
        certifiedAt: status === "certified" ? ts : null,
        releasedById: null,
        releasedAt: null,
      };
      set((s) => ({ bonusRuns: existing ? s.bonusRuns.map((r) => (r.id === id ? run : r)) : [...s.bonusRuns, run] }) as Partial<S>);
      const verdict = result.passed ? "break-even test and cash check passed" : `checks failed — ${(result.payoutPct * 100).toFixed(2)}% pro rata, rest carried forward (§9.2)`;
      const onBehalf = status === "certified" && opts.certifiedById && opts.certifiedById !== get().currentUserId ? ` — recorded by ${userName(get().currentUserId)} for ${userName(opts.certifiedById)}` : "";
      log([audit("run", id, status === "certified" ? `${verdict} — certified by CFO (${result.month})${onBehalf}` : status === "failed" ? `checks failed (${result.month})` : `provisional bonuses saved (${result.month})`, `Operating result ${Math.round(result.operatingResult)} · cash after ${Math.round(result.cashAfter)}`)]);
      return id;
    },
    releaseRun: (id) => {
      const run = get().bonusRuns.find((r) => r.id === id);
      if (!run || run.status !== "certified") return;
      const pay = paymentDate(run.month);
      const deferred: DeferredBonus[] = [];
      for (const l of run.lines) {
        if (l.deferred <= 0) continue;
        const i = ini(l.initiativeId);
        deferred.push({ id: uid("def"), month: run.month, initiativeId: l.initiativeId, userId: l.userId, amount: l.deferred, vestAt: i ? deferralVestDate(i) : addMonths(pay, POLICY.deferral.minMonths), status: "pending", releasedAmount: 0, note: "High-risk deferral, released 6–12 months after project close (§9.3)" });
      }
      set((s) => ({ bonusRuns: s.bonusRuns.map((r) => (r.id === id ? { ...r, status: "released", releasedById: s.currentUserId, releasedAt: now() } : r)), deferredBonuses: [...s.deferredBonuses, ...deferred] }) as Partial<S>);
      const carried = run.lines.reduce((s, l) => s + l.carriedOver, 0);
      log([audit("run", id, `PRC authorised release for ${run.month} — paid with the ${pay.slice(0, 10)} salary`, `${deferred.length} deferred entries${carried > 0 ? ` · Rp${Math.round(carried).toLocaleString("en-US")} carried forward` : ""}`)]);
    },

    releaseDeferred: (id, amount, note = "") => {
      set((s) => ({ deferredBonuses: s.deferredBonuses.map((d) => (d.id === id ? { ...d, status: "released", releasedAmount: amount ?? d.amount, note: note || d.note } : d)) }) as Partial<S>);
      log([audit("deferred", id, "deferred bonus released", note)]);
    },
    forfeitDeferred: (id, note) => {
      set((s) => ({ deferredBonuses: s.deferredBonuses.map((d) => (d.id === id ? { ...d, status: "forfeited", note } : d)) }) as Partial<S>);
      log([audit("deferred", id, "deferred bonus reduced / forfeited", note)]);
    },
    reduceDeferred: (id, amount, note) => {
      const d = get().deferredBonuses.find((x) => x.id === id);
      if (!d || d.status !== "pending") return;
      const cut = Math.min(d.amount, Math.max(0, amount));
      const left = d.amount - cut;
      set((s) => ({ deferredBonuses: s.deferredBonuses.map((x) => (x.id === id ? { ...x, amount: left, status: left <= 0 ? ("forfeited" as const) : x.status, note: `${x.note} · reduced Rp${Math.round(cut).toLocaleString("en-US")}: ${note}` } : x)) }) as Partial<S>);
      log([audit("deferred", id, `deferred bonus reduced by Rp${Math.round(cut).toLocaleString("en-US")}`, note)]);
    },
    completeProbation: (userId) => {
      const amount = probationBalance(userId, get().bonusRuns) - get().probationOutcomes.filter((o) => o.userId === userId).reduce((s, o) => s + o.amount, 0);
      set((s) => ({
        employeeProfiles: s.employeeProfiles.map((p) => (p.userId === userId ? { ...p, employmentType: "full_time_permanent", probationEndDate: p.probationEndDate ?? now() } : p)),
        probationOutcomes: [...s.probationOutcomes, { userId, outcome: "completed", amount, decidedAt: now() }],
      }) as Partial<S>);
      log([audit("probation", userId, "confirmed as permanent — Probation Completion Bonus payable within 30 days (§11.4)", String(Math.round(amount)))]);
    },
    failProbation: (userId) => {
      const amount = probationBalance(userId, get().bonusRuns) - get().probationOutcomes.filter((o) => o.userId === userId).reduce((s, o) => s + o.amount, 0);
      set((s) => ({
        employeeProfiles: s.employeeProfiles.map((p) => (p.userId === userId ? { ...p, separation: { kind: "probation_failed", effectiveAt: now(), recordedAt: now() } } : p)),
        probationOutcomes: [...s.probationOutcomes, { userId, outcome: "paid_final_pay", amount, decidedAt: now() }],
      }) as Partial<S>);
      log([audit("probation", userId, "probation not passed — held balance paid with final pay, less PPh 21 (§11.4)", String(Math.round(amount)))]);
    },
    createClawback: (input) => {
      const id = uid("cb");
      set((s) => ({ clawbacks: [...s.clawbacks, { ...input, id, createdAt: now(), recovered: 0, status: "identified", notifiedAt: null }] }) as Partial<S>);
      log([audit("clawback", id, "clawback trigger identified by Finance (§9.4)", input.trigger)]);
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
      set((s) => ({
        employeeProfiles: s.employeeProfiles.map((p) =>
          p.userId === userId
            ? {
                ...p,
                resignationNoticeAt: kind === "resignation" ? opts.noticeAt ?? ts : p.resignationNoticeAt,
                terminationNoticeAt: kind.startsWith("termination") ? opts.noticeAt ?? ts : p.terminationNoticeAt,
                separation: { kind, effectiveAt, recordedAt: ts, retirementNoticeDays: opts.retirementNoticeDays, prcConfirmed: opts.prcConfirmed },
              }
            : p,
        ),
        deferredBonuses: s.deferredBonuses.map((d) => {
          if (d.userId !== userId || d.status !== "pending") return d;
          if (kind === "termination_for_cause") return { ...d, status: "forfeited" as const, note: "Forfeited — dismissal for a serious violation (§10)" };
          if (kind === "death_disability") return { ...d, status: "released" as const, releasedAmount: d.amount, note: "Vested at once — death or permanent disability; paid within 60 days of documents (§10)" };
          return { ...d, note: `${d.note} · Work before ${effectiveAt.slice(0, 10)} — paid at its normal time if the usual conditions are met (§10)` };
        }),
      }) as Partial<S>);
      // end ledger rows on the last day (§6.5)
      set((s) => ({ initiativeMembers: s.initiativeMembers.map((m) => (m.userId === userId && (!m.leftAt || Date.parse(m.leftAt) > Date.parse(effectiveAt)) ? { ...m, leftAt: effectiveAt } : m)) }) as Partial<S>);
      log([audit("employee", userId, `status change recorded: ${kind.replace(/_/g, " ")}`, `effective ${effectiveAt.slice(0, 10)} — exit letter states amounts paid and forfeited (§10)`)]);
      const p = get().employeeProfiles.find((x) => x.userId === userId);
      if (p?.employmentType === "probationary" && !get().probationOutcomes.some((o) => o.userId === userId)) {
        const amount = probationBalance(userId, get().bonusRuns);
        const outcome = kind === "termination_for_cause" ? "forfeited" : "paid_final_pay";
        set((s) => ({ probationOutcomes: [...s.probationOutcomes, { userId, outcome, amount, decidedAt: ts }] }) as Partial<S>);
      }
    },
    addPerson: (input) => {
      const id = uid("u");
      const user: User = { id, name: input.name.trim(), initials: initialsOf(input.name), email: input.email.trim(), title: input.title.trim(), team: input.team, color: COLORS[get().users.length % COLORS.length] };
      const profile: EmployeeProfile = {
        userId: id,
        employmentType: input.employmentType,
        hireDate: input.hireDate,
        probationEndDate: input.employmentType === "probationary" ? input.probationEndDate ?? addMonths(input.hireDate, POLICY.probationMaxMonths) : null,
        annualBaseSalary: input.annualBaseSalary ?? 0,
        contractedHoursPct: input.employmentType === "part_time" ? input.contractedHoursPct ?? 50 : undefined,
        contractEndDate: input.employmentType === "fixed_term_contract" ? input.contractEndDate ?? null : null,
        directManagerId: input.directManagerId,
        goodStanding: true,
        activeWrittenWarning: false,
        onPIP: false,
        pipApprovedByPRC: false,
        underInvestigation: false,
        suspended: false,
        unpaidLeaveDays: 0,
        resignationNoticeAt: null,
        terminationNoticeAt: null,
        separation: null,
        acknowledgmentSignedAt: input.acknowledgmentSignedAt ?? null,
        governanceRoles: [],
      };
      set((s) => ({ users: [...s.users, user], employeeProfiles: [...s.employeeProfiles, profile] }) as Partial<S>);
      log([audit("employee", id, "person added — HR to confirm eligibility (§3.5)", `${user.name} · ${input.employmentType.replace(/_/g, " ")}`)]);
      return id;
    },

    scheduleCurveAdjustment: (to, effectiveFrom, rationale) => {
      const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
      const next: Curve = { start: clamp(to.start, CURVE_LIMITS.start), floor: clamp(to.floor, CURVE_LIMITS.floor), decay: clamp(to.decay, CURVE_LIMITS.decay) };
      if (next.start <= next.floor) return null;
      const earliest = Date.now() + POLICY.curveNoticeDays * 86_400_000;
      const eff = new Date(Math.max(earliest, Date.parse(effectiveFrom))).toISOString();
      const from = curveInForce(get().curveAdjustments, eff);
      const id = uid("ca");
      set((s) => ({ curveAdjustments: [...s.curveAdjustments, { id, from, to: next, proposedAt: now(), effectiveFrom: eff, rationale, approvedById: s.currentUserId }] }) as Partial<S>);
      log([audit("policy", id, `revenue-share curve ${Math.round(from.start * 100)}%→${Math.round(from.floor * 100)}% @ Rp${from.decay / 1e9}bn changes to ${Math.round(next.start * 100)}%→${Math.round(next.floor * 100)}% @ Rp${next.decay / 1e9}bn from ${eff.slice(0, 10)} — projects approved afterwards only (§9.5)`, rationale)]);
      return id;
    },
  };
  return actions;
}

/** Deferral is needed and set when any §9.3 trigger applies. */
export const needsDeferral = (i: Initiative) => deferralTriggers(i).length > 0;
