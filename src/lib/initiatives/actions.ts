/*
 * Store slice for the Project Initiative & Compensation module (Policy v4.0). Mixed into useCrm (src/lib/store.ts).
 * Every state change writes an AuditEntry (§13.3 records). Money actions enforce the §8.2 / §13.1 / §13.2 controls
 * (certify by Finance, maker-checker release by the PRC, recusal, quorum) and record refusals in the audit trail.
 */
import type { Activity, ActivityLinks, SpectrumColor, Team, User } from "../types";
import type {
  AuditEntry,
  BonusAdjustment,
  BonusRun,
  Clawback,
  CompanyTurnover,
  Decision,
  DeferredBonus,
  EmployeeProfile,
  EmploymentType,
  FinalReconciliationRecord,
  Initiative,
  InitiativeMember,
  PrcScores,
  ProbationOutcome,
  ProjectRole,
  RevenueEntry,
  SeparationKind,
  TaxRegimeChange,
  TeamAmendment,
} from "./types";
import {
  addMonths,
  allocateDeferralCosts,
  amendmentDeadline,
  amendmentTally,
  certifyCheck,
  curveInForce,
  cycleMonth,
  deferralTriggers,
  deferralVestDate,
  endDateForMonths,
  entryCycle,
  finalReconciliation,
  nextOpenCycle,
  nextProjectCode,
  nextTrackingNo,
  normalizeWorkPeriodEnd,
  normalizeWorkPeriodStart,
  paymentDate,
  probationBalance,
  probationBalanceByProject,
  projectRate,
  releaseCheck,
  revenueEntryLock,
  splitByProject,
  wibDayStart,
  type ReleaseVote,
  type RunResult,
} from "./engine";
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

/** Result of a guarded money action: `ok` false → nothing changed and `reason` says why (also written to the audit log). */
export type ActionResult = { ok: boolean; reason?: string };

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
  /** Closes the project; pending deferrals get their vest date from the close date (§9.3). */
  completeInitiative: (id: string) => void;
  deleteDraft: (id: string) => void;

  /* team & Team Allocation Ledger (§6.5–6.8, §7) */
  addMember: (initiativeId: string, userId: string, roles: ProjectRole[], opts?: MemberInput) => string;
  updateMember: (id: string, patch: Partial<InitiativeMember>) => void;
  /** Close a ledger row on `effectiveFrom` (normalised to 00:00 WIB) and open a new one with the change (amendments never change past work, §6.8). */
  amendLedgerRow: (id: string, patch: Partial<Pick<InitiativeMember, "roles" | "specialistWeight" | "weightOverride" | "allocationFactor" | "weightNote">>, effectiveFrom: string, authority: string) => string | null;
  setConsent: (id: string, consent: InitiativeMember["consent"]) => void;
  approveMembers: (initiativeId: string) => void;
  advanceRemoval: (id: string, note: string) => void;
  removeMember: (id: string) => void;
  transferLead: (initiativeId: string, toUserId: string, reason: string) => void;
  /* §6.8 amendments */
  proposeAmendment: (initiativeId: string, change: TeamAmendment["change"], effectiveDate: string, reason: string) => string;
  voteAmendment: (id: string, vote: "for" | "against", userId?: string) => void;
  /** PRC deciding vote on a tied amendment, or a block when it breaks the policy — only for open or tied amendments. */
  prcDecideAmendment: (id: string, outcome: "passed" | "failed" | "blocked", note: string) => void;
  /** §6.8.2 close amendments whose 5-business-day vote has ended: majority → passed, exactly half → tied (PRC), otherwise failed. Returns how many closed. */
  closeOverdueAmendments: (atIso?: string) => number;

  /* client payments (§8.1) */
  addRevenueEntry: (entry: Omit<RevenueEntry, "id">) => string;
  /** Refused (returns false) for amounts/dates of a payment whose cycle is released — use addRevenueCorrection. */
  updateRevenueEntry: (id: string, patch: Partial<RevenueEntry>) => boolean;
  /** Refused (returns false) for a payment whose cycle is released. Writes an audit entry. */
  deleteRevenueEntry: (id: string) => boolean;
  /** §8.5 correction of a payment in a released cycle: a new entry with the difference, paid in the next open cycle. */
  addRevenueCorrection: (entryId: string, delta: { revenue: number; directCosts: number }, note: string) => string | null;

  /* monthly cycle (§8.2, §9.1–9.2) */
  /**
   * `certifiedById` records the CFO when someone else enters her certification (audit shows who recorded it).
   * Certification is refused (saved as provisional, reason in the audit log) before the cut-off or for a certifier
   * without the cfo/finance role; reopening a certified run needs Finance. Check certifyCheck() first in the UI.
   */
  recordRun: (result: RunResult, inputs: Pick<BonusRun, "companyRevenue" | "directCosts" | "overheads" | "cash" | "fixedCostsMonthly">, status: "draft" | "failed" | "certified", opts?: { certifiedById?: string; atIso?: string }) => string;
  /** §8.2 / §13.1 PRC release with maker-checker, recusal and (when `votes` are given) quorum — see releaseCheck(). */
  releaseRun: (id: string, opts?: { votes?: ReleaseVote[]; lateReason?: string }) => ActionResult;

  /* ledgers (§9.3, §9.4, §11) */
  /** Release a vested deferred bonus — paid as a line of the next open cycle (§9.1 tested, §10 re-checked). */
  releaseDeferred: (id: string, amount?: number, note?: string) => boolean;
  forfeitDeferred: (id: string, note: string) => void;
  /** §9.3 reduce a pending deferred amount (warranty/rework costs, written-off invoice, misstated forecast) or offset a clawback (§9.4) without paying it. */
  reduceDeferred: (id: string, amount: number, note: string) => void;
  /** §9.3 release a project's pending deferrals at once, deducting warranty / rework costs a single time across them. */
  releaseProjectDeferrals: (initiativeId: string, costs: number, note: string, opts?: { ids?: string[] }) => { released: number; deducted: number; absorbed: number } | null;
  /** §11.4 confirmed as permanent: Probation Completion Bonus paid in the cycle within 30 days of the end date. */
  completeProbation: (userId: string, opts?: { endedAt?: string }) => void;
  /** §11.4 probation not passed / employment ended: recorded as a separation on the last working day; held balance paid with final pay. */
  failProbation: (userId: string, lastWorkingDay?: string) => void;
  createClawback: (input: Omit<Clawback, "id" | "createdAt" | "recovered" | "status" | "notifiedAt">) => string;
  updateClawback: (id: string, patch: Partial<Clawback>) => void;

  /* HR (§3, §10) */
  /** Changing a probationer to a permanent status runs the §11.4 completion so the held balance is paid. */
  updateProfile: (userId: string, patch: Partial<EmployeeProfile>) => void;
  recordSeparation: (userId: string, kind: SeparationKind, effectiveAt: string, opts?: { noticeAt?: string; retirementNoticeDays?: number; prcConfirmed?: boolean }) => void;
  /** Withdraw a recorded separation (rescinded resignation, error): reopens the ledger rows and deferrals it closed. */
  withdrawSeparation: (userId: string, reason: string) => void;
  /** §10 PRC confirms a recorded retirement — held retirement payments are paid in the next run. */
  confirmRetirement: (userId: string, note?: string) => boolean;
  /** Add a real employee who is not yet in the workspace (user + HR record). Returns the user id. */
  addPerson: (input: NewPersonInput) => string;

  /* policy (§9.5) */
  scheduleCurveAdjustment: (to: Curve, effectiveFrom: string, rationale: string) => string | null;

  /* §8.3 close, §5.4 tax */
  /** §8.3 final reconciliation: top-ups go to the next open cycle; overpayments come off pending deferrals first. */
  recordFinalReconciliation: (initiativeId: string, note?: string) => FinalReconciliationRecord | null;
  /** §5.4 Finance records the company's gross turnover for a month (all revenue, for the Rp4.8bn UMKM limit). */
  recordCompanyTurnover: (month: string, revenue: number) => void;
  /** §5.4 Finance records the dated switch out of (or back into) the UMKM regime. */
  recordTaxRegimeChange: (input: { regime: "umkm" | "corporate"; effectiveFrom: string; corporateEffectiveRate?: number; note: string }) => string | null;
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
const rp = (n: number) => `Rp${Math.round(n).toLocaleString("en-US")}`;
const AMOUNT_FIELDS: (keyof RevenueEntry)[] = ["revenue", "directCosts", "received", "collectedAt", "workPeriodStart", "workPeriodEnd", "initiativeId", "month"];

export function createInitiativeActions<S extends CoreState>(set: SetFn<S>, get: Get<S>, uid: Uid): InitiativeActions {
  const now = () => new Date().toISOString();
  const audit = (entity: AuditEntry["entity"], entityId: string, action: string, detail = ""): AuditEntry => ({ id: uid("au"), at: now(), actorId: get().currentUserId, entity, entityId, action, detail });
  const log = (entries: AuditEntry[]) => set((s) => ({ auditLog: [...entries, ...s.auditLog] }) as Partial<S>);
  const patchInitiative = (id: string, patch: Partial<Initiative>) => set((s) => ({ initiatives: s.initiatives.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: now() } : i)) }) as Partial<S>);
  const ini = (id: string) => get().initiatives.find((i) => i.id === id);
  const crmLinks = (i: Initiative): ActivityLinks => ({ contactIds: [], companyIds: i.companyId ? [i.companyId] : [], dealIds: i.dealId ? [i.dealId] : [], ticketIds: [] });
  const userName = (id: string) => get().users.find((u) => u.id === id)?.name ?? id;
  const rolesOf = (userId: string) => get().employeeProfiles.find((p) => p.userId === userId)?.governanceRoles ?? [];
  const has = (userId: string, ...roles: string[]) => rolesOf(userId).some((r) => roles.includes(r));
  const refuse = (entity: AuditEntry["entity"], id: string, what: string, reason: string) => {
    log([audit(entity, id, `refused: ${what}`, reason)]);
    return { ok: false, reason } as ActionResult;
  };
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
  /** 23:59:59.999 WIB on the day before `iso`'s WIB date — the closing time of a ledger row that changes on `iso` */
  const dayBefore = (iso: string) => new Date(Date.parse(wibDayStart(iso)) - 1).toISOString();
  /** next cycle that can still take a payment, never earlier than the cycle of `fromIso` */
  const openCycleFrom = (fromIso: string) => nextOpenCycle(get().bonusRuns, Date.parse(fromIso) > Date.now() ? fromIso : now());
  const normalizeEntry = <T extends Partial<RevenueEntry>>(e: T): T => ({
    ...e,
    ...(e.workPeriodStart ? { workPeriodStart: normalizeWorkPeriodStart(e.workPeriodStart) } : {}),
    ...(e.workPeriodEnd ? { workPeriodEnd: normalizeWorkPeriodEnd(e.workPeriodEnd) } : {}),
  });

  /** §4.5 after approval: project code, budget, type and revenue-share rate; PMO opens the project and the ledger. */
  const approve = (id: string, opts: { jiraProjectId?: string } = {}) => {
    const i = ini(id);
    if (!i) return;
    const approvedAt = now();
    const code = i.code ?? nextProjectCode(get().initiatives, approvedAt);
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
    // §9.5.4 the curve in force at the approval date applies
    const rate = projectRate(i, get().curveAdjustments, approvedAt);
    // the PRC fixes the rate in its approval decision (§5.1); a project with no projection keeps it open
    const lockedSharePct = i.lockedSharePct ?? (rate.source === "curve" ? rate.rate : null);
    patchInitiative(id, { status: "approved", code, approvedAt, epicId, jiraProjectId: jiraProjectId ?? i.jiraProjectId ?? null, lockedSharePct, policyVersion: i.policyVersion ?? "4.0" });
    set((s) => ({ initiativeMembers: s.initiativeMembers.map((m) => (m.initiativeId === id && m.consent === "accepted" ? { ...m, prcApproved: true } : m)) }) as Partial<S>);
    get().addActivity({ type: "note", subject: `${code} approved by PRC`, body: `${i.title} — ${PROJECT_TYPE_META[i.type].label}. Revenue-share rate ${lockedSharePct != null ? `${(lockedSharePct * 100).toFixed(3)}%` : "to be fixed once the expected case is entered"}.`, links: crmLinks(i) });
    log([audit("initiative", id, "approved", `Project code ${code} · rate ${lockedSharePct != null ? `${(lockedSharePct * 100).toFixed(3)}%` : "open"}${epicId ? " · epic created" : ""}`)]);
  };

  /** Apply a passed §6.8 amendment to the ledger. */
  const applyAmendment = (a: TeamAmendment) => {
    const authority = `Amendment ${a.id}`;
    if (a.change.kind === "add") {
      const c = a.change;
      // line-manager agreement is only recorded when the amendment captured it (§3.1, §6.8.5)
      const row = blankRow(a.initiativeId, c.userId, c.roles, { specialistWeight: c.specialistWeight, weightOverride: c.weightOverride, weightNote: c.weightNote, allocationFactor: c.allocationFactor, allocationPct: c.allocationPct, consent: c.consent ? "accepted" : "pending", managerApproved: c.managerApproved ?? false, prcApproved: true, application: true, joinedAt: wibDayStart(a.effectiveDate), authority });
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

  const tally = (a: TeamAmendment, closed = false): TeamAmendment["status"] => amendmentTally(a.votes, voters(a.initiativeId, a.change.kind === "add" ? a.change.userId : undefined), closed);

  /** Probation outcome amount (held balance less earlier outcomes) by project, paid in `payMonth`. */
  const probationPayout = (userId: string) => {
    const runs = get().bonusRuns;
    const amount = Math.max(0, probationBalance(userId, runs) - get().probationOutcomes.filter((o) => o.userId === userId).reduce((s, o) => s + o.amount, 0));
    return { amount, byProject: splitByProject(probationBalanceByProject(userId, runs), amount) };
  };

  const actions: InitiativeActions = {
    saveInitiative: (input) => {
      const ts = now();
      if (input.id && ini(input.id)) {
        const cur = ini(input.id)!;
        patchInitiative(input.id, input);
        // a draft's team starts with the project: moving the start date moves every row (§6.5)
        if (cur.status === "draft" && input.startDate && input.startDate !== cur.startDate) {
          const start = input.startDate;
          set((s) => ({ initiativeMembers: s.initiativeMembers.map((m) => (m.initiativeId === cur.id && !m.leftAt ? { ...m, joinedAt: start } : m)) }) as Partial<S>);
        }
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
        // three whole contracted months (§5.1): ends the day before the same date three months later
        endDate: endDateForMonths(ts, 3),
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
      const ts = now();
      const trackingNo = ini(id)?.trackingNo || nextTrackingNo(get().initiatives, ts);
      patchInitiative(id, { status: "submitted", trackingNo, submittedAt: ts });
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
      const completedAt = now();
      patchInitiative(id, { status: "completed", completedAt });
      // §9.3 deferrals vest 6–12 months after the actual close, not the contracted end
      const closed = ini(id);
      const vestAt = closed ? deferralVestDate(closed) : null;
      let moved = 0;
      if (vestAt)
        set((s) => ({
          deferredBonuses: s.deferredBonuses.map((d) => {
            if (d.initiativeId !== id || d.status !== "pending" || d.vestAt === vestAt) return d;
            moved++;
            return { ...d, vestAt };
          }),
        }) as Partial<S>);
      log([audit("initiative", id, "closed — final reconciliation within 30 days; deferrals vest 6–12 months after close (§8.3, §9.3)", moved ? `${moved} deferred entr${moved === 1 ? "y" : "ies"} now vest ${vestAt!.slice(0, 10)}` : "")]);
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
      // ledger changes take effect at 00:00 WIB on the effective date, so no day is counted on two rows (§6.5)
      const effective = wibDayStart(effectiveFrom);
      // a row that has not started yet (or a draft) is edited in place
      if (Date.parse(effective) <= Date.parse(m.joinedAt)) {
        set((s) => ({ initiativeMembers: s.initiativeMembers.map((x) => (x.id === id ? { ...x, ...patch, authority } : x)) }) as Partial<S>);
        log([audit("member", id, "ledger row amended", authority)]);
        return id;
      }
      const next: InitiativeMember = { ...m, ...patch, id: uid("im"), joinedAt: effective, leftAt: m.leftAt && Date.parse(m.leftAt) > Date.parse(effective) ? m.leftAt : null, authority, application: true };
      set((s) => ({ initiativeMembers: [...s.initiativeMembers.map((x) => (x.id === id ? { ...x, leftAt: dayBefore(effective) } : x)), next] }) as Partial<S>);
      log([audit("member", next.id, "ledger row closed and reopened (§6.8)", `${userName(m.userId)} from ${effective.slice(0, 10)} — ${authority}`)]);
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
      // "add" and "change" take effect from 00:00 WIB on the effective date; a removal keeps the last day given
      const effective = change.kind === "remove" ? effectiveDate : wibDayStart(effectiveDate);
      const a: TeamAmendment = { id, initiativeId, proposedById: me, circulatedAt: now(), effectiveDate: effective, reason, change, votes: voters(initiativeId).includes(me) ? [{ userId: me, vote: "for", at: now() }] : [], status: "open", prcDecision: null, recordedAt: null };
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
      // only an open or tied amendment can be decided — never apply a passed one twice
      if (!a || !(a.status === "tied" || a.status === "open") || a.recordedAt) return;
      if (outcome !== "blocked" && a.status === "open") return;
      const updated: TeamAmendment = { ...a, status: outcome, prcDecision: { outcome, note, at: now(), byId: get().currentUserId } };
      set((s) => ({ teamAmendments: s.teamAmendments.map((x) => (x.id === id ? updated : x)) }) as Partial<S>);
      log([audit("amendment", id, outcome === "blocked" ? "PRC blocked the amendment — breaks the policy (§6.8)" : `PRC deciding vote: ${outcome}`, note)]);
      if (outcome === "passed") applyAmendment(updated);
    },
    closeOverdueAmendments: (atIso) => {
      const at = Date.parse(atIso ?? now());
      const due = get().teamAmendments.filter((a) => a.status === "open" && Date.parse(amendmentDeadline(a)) < at);
      for (const a of due) {
        const status = tally(a, true);
        const updated: TeamAmendment = { ...a, status, closedAt: new Date(at).toISOString(), closedReason: `Voting closed after ${POLICY.sla.amendmentVoteBusinessDays} business days (§6.8.2)` };
        set((s) => ({ teamAmendments: s.teamAmendments.map((x) => (x.id === a.id ? updated : x)) }) as Partial<S>);
        log([audit("amendment", a.id, `vote closed at the deadline — ${status}`, status === "tied" ? "Exactly half voted for — the PRC casts the deciding vote within 5 business days (§6.8.3)" : status === "passed" ? "More than half of current members voted for (§6.8.2)" : "No majority for the amendment by the deadline (§6.8.2)")]);
        if (status === "passed") applyAmendment(updated);
      }
      return due.length;
    },

    addRevenueEntry: (entry) => {
      const id = uid("rev");
      const e = normalizeEntry({ ...entry, id, month: entry.received && entry.collectedAt ? cycleMonth(entry.collectedAt) : entry.month }) as RevenueEntry;
      set((s) => ({ revenueEntries: [...s.revenueEntries, e] }) as Partial<S>);
      const paidIn = entryCycle(e, get().bonusRuns);
      log([audit("initiative", entry.initiativeId, entry.received ? `payment collected — cycle ${paidIn}${paidIn !== e.month ? ` (the ${e.month} cycle is already released — paid as a §8.5 correction)` : ""}` : `payment earned, awaiting collection (${entry.month})`, `${entry.revenue} revenue / ${entry.directCosts} direct costs`)]);
      return id;
    },
    updateRevenueEntry: (id, patch) => {
      const cur = get().revenueEntries.find((x) => x.id === id);
      if (!cur) return false;
      const lock = revenueEntryLock(cur, get().bonusRuns);
      const touched = (Object.keys(patch) as (keyof RevenueEntry)[]).filter((k) => AMOUNT_FIELDS.includes(k) && patch[k] !== cur[k]);
      if (lock && touched.length) {
        refuse("initiative", cur.initiativeId, `edit payment ${cur.month}`, `${lock} — fields: ${touched.join(", ")}`);
        return false;
      }
      const next = normalizeEntry({ ...cur, ...patch });
      if (patch.collectedAt && next.received) next.month = cycleMonth(patch.collectedAt);
      set((s) => ({ revenueEntries: s.revenueEntries.map((e) => (e.id === id ? next : e)) }) as Partial<S>);
      log([audit("initiative", cur.initiativeId, `payment ${next.month} updated`, Object.keys(patch).map((k) => `${k}: ${String((cur as unknown as Record<string, unknown>)[k] ?? "—")} → ${String((patch as unknown as Record<string, unknown>)[k] ?? "—")}`).join("; "))]);
      return true;
    },
    deleteRevenueEntry: (id) => {
      const cur = get().revenueEntries.find((x) => x.id === id);
      if (!cur) return false;
      const lock = revenueEntryLock(cur, get().bonusRuns);
      if (lock) {
        refuse("initiative", cur.initiativeId, `delete payment ${cur.month}`, lock);
        return false;
      }
      set((s) => ({ revenueEntries: s.revenueEntries.filter((e) => e.id !== id) }) as Partial<S>);
      log([audit("initiative", cur.initiativeId, `payment ${cur.month} deleted`, `${rp(cur.revenue)} revenue / ${rp(cur.directCosts)} direct costs${cur.received ? ` · collected ${cur.collectedAt?.slice(0, 10) ?? ""}` : " · not collected"}${cur.note ? ` · ${cur.note}` : ""}`)]);
      return true;
    },
    addRevenueCorrection: (entryId, delta, note) => {
      const cur = get().revenueEntries.find((x) => x.id === entryId);
      if (!cur || (!delta.revenue && !delta.directCosts)) return null;
      const ts = now();
      const id = uid("rev");
      const e: RevenueEntry = { id, initiativeId: cur.initiativeId, month: cycleMonth(ts), revenue: delta.revenue, directCosts: delta.directCosts, basis: cur.basis, received: true, collectedAt: ts, workPeriodStart: cur.workPeriodStart ?? null, workPeriodEnd: cur.workPeriodEnd ?? null, note: `Correction of ${cur.month} payment — ${note}`, correctionOf: cur.id };
      set((s) => ({ revenueEntries: [...s.revenueEntries, e] }) as Partial<S>);
      log([audit("initiative", cur.initiativeId, `payment correction recorded — settled in the ${entryCycle(e, get().bonusRuns)} cycle (§8.5)`, `${delta.revenue >= 0 ? "+" : ""}${rp(delta.revenue)} revenue / ${delta.directCosts >= 0 ? "+" : ""}${rp(delta.directCosts)} costs · ${note}`)]);
      return id;
    },

    recordRun: (result, inputs, status, opts = {}) => {
      const me = get().currentUserId;
      const existing = get().bonusRuns.find((r) => r.month === result.month);
      if (existing && existing.status === "released") return existing.id;
      // reopening a certified run wipes the CFO's certification — Finance only (§13.2)
      if (existing?.status === "certified" && status !== "certified" && !has(me, "cfo", "finance")) {
        refuse("run", existing.id, `reopen ${result.month} as provisional`, "Only Finance can reopen a certified run (§13.2)");
        return existing.id;
      }
      let st = status;
      let refusal: string | null = null;
      let certifierId: string | null = null;
      if (status === "certified") {
        const chk = certifyCheck(result.month, { profiles: get().employeeProfiles, actorId: me, certifiedById: opts.certifiedById ?? null, atIso: opts.atIso });
        if (chk.ok) certifierId = chk.certifierId;
        else {
          refusal = chk.blockers.join(" · ");
          if (existing?.status === "certified") {
            refuse("run", existing.id, `re-certify ${result.month}`, refusal);
            return existing.id;
          }
          st = "draft";
        }
      }
      const id = existing?.id ?? uid("run");
      const ts = now();
      const run: BonusRun = {
        id,
        month: result.month,
        status: st,
        policyVersion: "4.0",
        ...inputs,
        operatingResult: result.operatingResult,
        cashAfter: result.cashAfter,
        payoutPct: result.payoutPct,
        totals: result.totals,
        lines: result.lines,
        certifiedById: st === "certified" ? certifierId : null,
        certifiedAt: st === "certified" ? ts : null,
        releasedById: null,
        releasedAt: null,
        preparedById: existing?.preparedById ?? me,
        recordedById: st === "certified" ? me : null,
        approvals: [],
        recusedIds: [],
        entryIds: result.entryIds ?? [],
        lateReleaseReason: null,
      };
      set((s) => ({ bonusRuns: existing ? s.bonusRuns.map((r) => (r.id === id ? run : r)) : [...s.bonusRuns, run] }) as Partial<S>);
      const verdict = result.passed ? "break-even test and cash check passed" : `checks failed — ${(result.payoutPct * 100).toFixed(2)}% pro rata, rest carried forward (§9.2)`;
      const onBehalf = st === "certified" && certifierId && certifierId !== me ? ` — recorded by ${userName(me)} for ${userName(certifierId)}` : "";
      log([
        audit("run", id, st === "certified" ? `${verdict} — certified by CFO (${result.month})${onBehalf}` : st === "failed" ? `checks failed (${result.month})` : `provisional bonuses saved (${result.month})`, `Operating result ${Math.round(result.operatingResult)} · cash after ${Math.round(result.cashAfter)}`),
        ...(refusal ? [audit("run", id, `refused: certify ${result.month} — saved as provisional`, refusal)] : []),
      ]);
      return id;
    },
    releaseRun: (id, opts = {}) => {
      const run = get().bonusRuns.find((r) => r.id === id);
      if (!run) return { ok: false, reason: "Run not found" };
      const me = get().currentUserId;
      const chk = releaseCheck(run, { profiles: get().employeeProfiles, actorId: me, votes: opts.votes });
      if (!chk.ok) return refuse("run", id, `release ${run.month}`, chk.blockers.join(" · "));
      const ts = now();
      const pay = paymentDate(run.month);
      const deferred: DeferredBonus[] = [];
      for (const l of run.lines) {
        if (l.deferred <= 0) continue;
        const i = ini(l.initiativeId);
        deferred.push({ id: uid("def"), month: run.month, initiativeId: l.initiativeId, userId: l.userId, amount: l.deferred, vestAt: i ? deferralVestDate(i) : addMonths(pay, POLICY.deferral.minMonths), status: "pending", releasedAmount: 0, note: "High-risk deferral, released 6–12 months after project close (§9.3)", collectedAt: l.lastCollectedAt ?? null, workStart: l.firstWorkStart ?? null, payMonth: null });
      }
      // revenue entries paid in this cycle — later collections for it roll into the next open cycle (§8.5)
      const entryIds = run.entryIds?.length ? run.entryIds : get().revenueEntries.filter((e) => e.received && entryCycle(e, get().bonusRuns) === run.month).map((e) => e.id);
      const approvals = opts.votes?.length ? opts.votes.map((v) => ({ userId: v.userId, vote: v.vote, at: ts })) : [{ userId: me, vote: "for" as const, at: ts }];
      const lateReleaseReason = chk.late ? opts.lateReason?.trim() || `Released after the ${pay.slice(0, 10)} salary date` : null;
      // §9.4 clawback amounts recovered from this run's bonuses
      const recovered = new Map<string, number>();
      for (const l of run.lines) for (const r of l.recoveries ?? []) recovered.set(r.clawbackId, (recovered.get(r.clawbackId) ?? 0) + r.amount);
      set((s) => ({
        bonusRuns: s.bonusRuns.map((r) => (r.id === id ? { ...r, status: "released", releasedById: me, releasedAt: ts, approvals, recusedIds: chk.recused, entryIds, lateReleaseReason } : r)),
        deferredBonuses: [...s.deferredBonuses, ...deferred],
        clawbacks: s.clawbacks.map((c) => {
          const amt = recovered.get(c.id);
          if (!amt) return c;
          const total = c.recovered + amt;
          const due = c.originalPaid - c.recalculated;
          return { ...c, recovered: total, recoveries: [...(c.recoveries ?? []), { month: run.month, amount: amt, source: "bonus" as const, at: ts }], status: total >= due ? ("closed" as const) : c.status };
        }),
      }) as Partial<S>);
      const carried = run.lines.reduce((s, l) => s + l.carriedOver, 0);
      const held = run.lines.reduce((s, l) => s + l.held, 0);
      log([
        audit(
          "run",
          id,
          `PRC authorised release for ${run.month} — paid with the ${pay.slice(0, 10)} salary`,
          [
            `${deferred.length} deferred entries`,
            carried > 0 ? `${rp(carried)} carried forward` : null,
            held > 0 ? `${rp(held)} held until the condition clears` : null,
            recovered.size ? `${rp([...recovered.values()].reduce((a, b) => a + b, 0))} clawback recovered` : null,
            chk.mode === "vote" ? `PRC vote ${chk.quorum.for.length}–${chk.quorum.against.length}, quorum ${chk.quorum.present}/${chk.roster.length}` : `recorded by ${userName(me)}`,
            chk.recused.length ? `recused: ${chk.recused.map(userName).join(", ")}` : null,
            lateReleaseReason ? `late: ${lateReleaseReason}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      ]);
      return { ok: true };
    },

    releaseDeferred: (id, amount, note = "") => {
      const d = get().deferredBonuses.find((x) => x.id === id);
      if (!d || d.status !== "pending") return false;
      const me = get().currentUserId;
      if (!has(me, "prc", "ceo", "cfo", "finance")) {
        refuse("deferred", id, "release deferred bonus", "Deferral releases are decided by the PRC with Finance (§9.3, §13.2)");
        return false;
      }
      const ts = now();
      // §9.3 paid in the cycle after the deferral period ends — never before the vest date
      const payMonth = openCycleFrom(d.vestAt);
      const releasedAmount = Math.max(0, Math.min(d.amount, amount ?? d.amount));
      set((s) => ({ deferredBonuses: s.deferredBonuses.map((x) => (x.id === id ? { ...x, status: "released", releasedAmount, note: note || x.note, payMonth, releasedAt: ts, releasedById: me } : x)) }) as Partial<S>);
      log([audit("deferred", id, `deferred bonus released — paid with the ${paymentDate(payMonth).slice(0, 10)} salary (${payMonth} cycle)`, `${rp(releasedAmount)}${note ? ` · ${note}` : ""}`)]);
      return true;
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
    releaseProjectDeferrals: (initiativeId, costs, note, opts = {}) => {
      const me = get().currentUserId;
      if (!has(me, "prc", "ceo", "cfo", "finance")) {
        refuse("deferred", initiativeId, "release project deferrals", "Deferral releases are decided by the PRC with Finance (§9.3, §13.2)");
        return null;
      }
      const pending = get().deferredBonuses.filter((d) => d.initiativeId === initiativeId && d.status === "pending" && (!opts.ids || opts.ids.includes(d.id)));
      if (!pending.length) return null;
      const alloc = allocateDeferralCosts(pending, costs);
      const ts = now();
      const vest = pending.reduce((m, d) => (d.vestAt > m ? d.vestAt : m), pending[0].vestAt);
      const payMonth = openCycleFrom(vest);
      set((s) => ({
        deferredBonuses: s.deferredBonuses.map((d) => {
          const r = alloc.rows.find((x) => x.id === d.id);
          if (!r) return d;
          const text = `${note}${r.deduction ? ` · ${rp(r.deduction)} of ${rp(alloc.deducted)} warranty / rework costs deducted (§9.3)` : ""}`;
          return r.net > 0 ? { ...d, status: "released" as const, releasedAmount: r.net, costDeduction: r.deduction, payMonth, releasedAt: ts, releasedById: me, note: text } : { ...d, status: "forfeited" as const, releasedAmount: 0, costDeduction: r.deduction, note: `${text} — nothing left to pay` };
        }),
      }) as Partial<S>);
      const released = alloc.rows.reduce((s, r) => s + r.net, 0);
      log([audit("initiative", initiativeId, `project deferrals released — paid in the ${payMonth} cycle (§9.3)`, `${pending.length} entries · ${rp(alloc.pool)} pool − ${rp(alloc.deducted)} costs = ${rp(released)}${alloc.absorbedByCompany ? ` · ${rp(alloc.absorbedByCompany)} costs beyond the deferred pool absorbed by the company` : ""} · ${note}`)]);
      return { released, deducted: alloc.deducted, absorbed: alloc.absorbedByCompany };
    },
    completeProbation: (userId, opts = {}) => {
      const p = get().employeeProfiles.find((x) => x.userId === userId);
      const endedAt = opts.endedAt ?? (p?.probationEndDate && Date.parse(p.probationEndDate) <= Date.now() ? p.probationEndDate : now());
      const { amount, byProject } = probationPayout(userId);
      // §11.4 paid as a lump sum within 30 days of the probation end date
      const payMonth = openCycleFrom(endedAt);
      const outcome: ProbationOutcome = { id: uid("po"), userId, outcome: "completed", amount, decidedAt: now(), payMonth: amount > 0 ? payMonth : null, byProject, endedAt };
      set((s) => ({
        employeeProfiles: s.employeeProfiles.map((x) => (x.userId === userId ? { ...x, employmentType: "full_time_permanent", probationEndDate: x.probationEndDate ?? endedAt } : x)),
        probationOutcomes: [...s.probationOutcomes, outcome],
      }) as Partial<S>);
      const late = amount > 0 && Date.parse(paymentDate(payMonth)) > Date.parse(endedAt) + POLICY.probationPayoutDays * 86_400_000;
      log([audit("probation", userId, `confirmed as permanent — Probation Completion Bonus ${rp(amount)}${amount > 0 ? ` paid with the ${paymentDate(payMonth).slice(0, 10)} salary` : ""} (§11.4)`, late ? "Later than 30 days after the probation end — Finance to pay off-cycle or record the reason" : String(Math.round(amount)))]);
    },
    failProbation: (userId, lastWorkingDay) => {
      // the held balance follows the separation (paid with final pay, §11.4); ledger rows close on the last day
      actions.recordSeparation(userId, "probation_failed", lastWorkingDay ?? now());
      log([audit("probation", userId, "probation not passed — held balance paid with final pay, less PPh 21 (§11.4)", `last working day ${(lastWorkingDay ?? now()).slice(0, 10)}`)]);
    },
    createClawback: (input) => {
      const id = uid("cb");
      const ts = now();
      set((s) => ({ clawbacks: [...s.clawbacks, { ...input, id, createdAt: ts, triggeredAt: input.triggeredAt ?? ts, recovered: 0, status: "identified", notifiedAt: null }] }) as Partial<S>);
      log([audit("clawback", id, "clawback trigger identified by Finance (§9.4)", input.trigger)]);
      return id;
    },
    updateClawback: (id, patch) => {
      set((s) => ({ clawbacks: s.clawbacks.map((c) => (c.id === id ? { ...c, ...patch } : c)) }) as Partial<S>);
      log([audit("clawback", id, patch.status ? `status → ${patch.status}` : patch.recoverFromBonuses != null ? (patch.recoverFromBonuses ? "recovery from future project bonuses switched on — deducted in the next released run (§9.4)" : "recovery from future bonuses switched off") : "updated", patch.notes ?? "")]);
    },

    updateProfile: (userId, patch) => {
      const cur = get().employeeProfiles.find((p) => p.userId === userId);
      // §11.4 leaving probation by an HR status change still pays the held balance as a Probation Completion Bonus
      if (cur?.employmentType === "probationary" && patch.employmentType && patch.employmentType !== "probationary" && !get().probationOutcomes.some((o) => o.userId === userId)) {
        const { employmentType, ...rest } = patch;
        actions.completeProbation(userId, { endedAt: patch.probationEndDate ?? undefined });
        if (employmentType !== "full_time_permanent" || Object.keys(rest).length) {
          set((s) => ({ employeeProfiles: s.employeeProfiles.map((p) => (p.userId === userId ? { ...p, ...rest, employmentType } : p)) }) as Partial<S>);
          log([audit("employee", userId, "HR record updated", Object.keys(patch).join(", "))]);
        }
        return;
      }
      set((s) => ({ employeeProfiles: s.employeeProfiles.map((p) => (p.userId === userId ? { ...p, ...patch } : p)) }) as Partial<S>);
      log([audit("employee", userId, "HR record updated", Object.keys(patch).join(", "))]);
    },
    recordSeparation: (userId, kind, effectiveAt, opts = {}) => {
      const ts = now();
      const closedRowIds = get()
        .initiativeMembers.filter((m) => m.userId === userId && (!m.leftAt || Date.parse(m.leftAt) > Date.parse(effectiveAt)))
        .map((m) => m.id);
      const deathPayMonth = kind === "death_disability" ? openCycleFrom(ts) : null;
      set((s) => ({
        employeeProfiles: s.employeeProfiles.map((p) =>
          p.userId === userId
            ? {
                ...p,
                resignationNoticeAt: kind === "resignation" ? opts.noticeAt ?? ts : p.resignationNoticeAt,
                terminationNoticeAt: kind.startsWith("termination") ? opts.noticeAt ?? ts : p.terminationNoticeAt,
                separation: { kind, effectiveAt, recordedAt: ts, retirementNoticeDays: opts.retirementNoticeDays, prcConfirmed: opts.prcConfirmed, prcConfirmedAt: opts.prcConfirmed ? ts : null, prcConfirmedById: opts.prcConfirmed ? s.currentUserId : null, closedRowIds },
              }
            : p,
        ),
        deferredBonuses: s.deferredBonuses.map((d) => {
          if (d.userId !== userId || d.status !== "pending") return d;
          if (kind === "termination_for_cause") return { ...d, status: "forfeited" as const, note: "Forfeited — dismissal for a serious violation (§10)" };
          if (kind === "death_disability") return { ...d, status: "released" as const, releasedAmount: d.amount, payMonth: deathPayMonth, releasedAt: ts, note: "Vested at once — death or permanent disability; paid within 60 days of documents (§10)" };
          return { ...d, note: `${d.note} · Work before ${effectiveAt.slice(0, 10)} — paid at its normal time if the usual conditions are met (§10)` };
        }),
      }) as Partial<S>);
      // end ledger rows on the last day (§6.5)
      set((s) => ({ initiativeMembers: s.initiativeMembers.map((m) => (closedRowIds.includes(m.id) ? { ...m, leftAt: effectiveAt } : m)) }) as Partial<S>);
      log([audit("employee", userId, `status change recorded: ${kind.replace(/_/g, " ")}`, `effective ${effectiveAt.slice(0, 10)} — exit letter states amounts paid and forfeited (§10)`)]);
      const p = get().employeeProfiles.find((x) => x.userId === userId);
      if (p?.employmentType === "probationary" && !get().probationOutcomes.some((o) => o.userId === userId)) {
        const { amount, byProject } = probationPayout(userId);
        const outcome = kind === "termination_for_cause" ? "forfeited" : "paid_final_pay";
        // with final pay: the cycle of the last working day (or the next open one)
        const payMonth = outcome === "paid_final_pay" && amount > 0 ? openCycleFrom(effectiveAt) : null;
        set((s) => ({ probationOutcomes: [...s.probationOutcomes, { id: uid("po"), userId, outcome, amount, decidedAt: ts, payMonth, byProject, endedAt: effectiveAt }] }) as Partial<S>);
      }
    },
    withdrawSeparation: (userId, reason) => {
      const p = get().employeeProfiles.find((x) => x.userId === userId);
      const sep = p?.separation;
      if (!p || !sep) return;
      const rows = sep.closedRowIds ?? get().initiativeMembers.filter((m) => m.userId === userId && m.leftAt === sep.effectiveAt).map((m) => m.id);
      const runs = get().bonusRuns;
      set((s) => ({
        employeeProfiles: s.employeeProfiles.map((x) => (x.userId === userId ? { ...x, separation: null, resignationNoticeAt: sep.kind === "resignation" ? null : x.resignationNoticeAt, terminationNoticeAt: sep.kind.startsWith("termination") ? null : x.terminationNoticeAt } : x)),
        initiativeMembers: s.initiativeMembers.map((m) => (rows.includes(m.id) && m.leftAt === sep.effectiveAt ? { ...m, leftAt: null } : m)),
        deferredBonuses: s.deferredBonuses.map((d) => (d.userId === userId && d.status === "forfeited" && d.note.startsWith("Forfeited — dismissal") ? { ...d, status: "pending" as const, note: `High-risk deferral restored — separation withdrawn: ${reason}` } : d)),
        // a final-pay probation outcome not yet paid by a released run is undone
        probationOutcomes: s.probationOutcomes.filter((o) => !(o.userId === userId && o.outcome !== "completed" && !(o.payMonth && runs.some((r) => r.month === o.payMonth && r.status === "released")))),
      }) as Partial<S>);
      log([audit("employee", userId, `separation withdrawn (${sep.kind.replace(/_/g, " ")} of ${sep.effectiveAt.slice(0, 10)})`, `${rows.length} ledger row${rows.length === 1 ? "" : "s"} reopened · ${reason}`)]);
    },
    confirmRetirement: (userId, note = "") => {
      const p = get().employeeProfiles.find((x) => x.userId === userId);
      const me = get().currentUserId;
      if (!p?.separation || p.separation.kind !== "retirement" || p.separation.prcConfirmed) return false;
      if (!has(me, "prc", "ceo")) {
        refuse("employee", userId, "confirm retirement", "Retirement is confirmed by the PRC (§10)");
        return false;
      }
      const ts = now();
      set((s) => ({ employeeProfiles: s.employeeProfiles.map((x) => (x.userId === userId && x.separation ? { ...x, separation: { ...x.separation, prcConfirmed: true, prcConfirmedAt: ts, prcConfirmedById: me } } : x)) }) as Partial<S>);
      log([audit("employee", userId, "PRC confirmed the retirement — held payments are paid in the next run (§10)", note)]);
      return true;
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
      const me = get().currentUserId;
      if (!has(me, "prc", "ceo")) {
        refuse("policy", "curve", "schedule revenue-share curve change", "The PRC approves curve changes on the CFO's recommendation (§9.5)");
        return null;
      }
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

    recordFinalReconciliation: (initiativeId, note = "") => {
      const i = ini(initiativeId);
      const me = get().currentUserId;
      if (!i) return null;
      if (!has(me, "cfo", "finance", "prc", "ceo")) {
        refuse("initiative", initiativeId, "record final reconciliation", "Finance recalculates the pool at close (§8.3, §13.2)");
        return null;
      }
      const rec = finalReconciliation(i, { entries: get().revenueEntries, runs: get().bonusRuns, deferred: get().deferredBonuses, adjustments: get().curveAdjustments });
      const ts = now();
      const payMonth = rec.topUpTotal > 0 ? openCycleFrom(ts) : null;
      const adjustments: BonusAdjustment[] = rec.members.filter((m) => m.amount > 0).map((m) => ({ id: uid("adj"), kind: "reconciliation_topup", userId: m.userId, initiativeId, amount: m.amount, payMonth: payMonth!, note: `Final reconciliation of ${i.code ?? i.title}${note ? ` — ${note}` : ""}`, createdAt: ts, createdById: me }));
      // overpayment: taken first from the member's pending deferrals on the project (§8.3)
      const cuts = new Map<string, number>();
      for (const m of rec.members.filter((x) => x.offsetFromDeferred > 0)) {
        let left = m.offsetFromDeferred;
        for (const d of get().deferredBonuses.filter((x) => x.initiativeId === initiativeId && x.userId === m.userId && x.status === "pending")) {
          if (left <= 0) break;
          const take = Math.min(d.amount, left);
          cuts.set(d.id, take);
          left -= take;
        }
      }
      const record: FinalReconciliationRecord = { at: ts, byId: me, finalRate: rec.finalRate, finalPool: rec.finalPool, allocated: rec.allocated, difference: rec.difference, payMonth, offsetFromDeferred: rec.offsetTotal, absorbedOrClawback: rec.remainderTotal, note: [note, ...rec.notes].filter(Boolean).join(" · ") };
      set((s) => ({
        bonusAdjustments: [...s.bonusAdjustments, ...adjustments],
        deferredBonuses: s.deferredBonuses.map((d) => {
          const cut = cuts.get(d.id);
          if (!cut) return d;
          const left = d.amount - cut;
          return { ...d, amount: left, status: left <= 0 ? ("forfeited" as const) : d.status, note: `${d.note} · reduced ${rp(cut)}: final reconciliation overpayment (§8.3)` };
        }),
      }) as Partial<S>);
      patchInitiative(initiativeId, { reconciliation: record });
      log([audit("initiative", initiativeId, `final reconciliation recorded (§8.3) — ${rec.difference >= 0 ? `top-up ${rp(rec.topUpTotal)}${payMonth ? ` paid in the ${payMonth} cycle` : ""}` : `overpayment ${rp(-rec.difference)}: ${rp(rec.offsetTotal)} from deferrals, ${rp(rec.remainderTotal)} to clawback review or absorbed`}`, `final pool ${rp(rec.finalPool)} at ${(rec.finalRate * 100).toFixed(3)}% vs allocated ${rp(rec.allocated)}`)]);
      return record;
    },
    recordCompanyTurnover: (month, revenue) => {
      const me = get().currentUserId;
      if (!has(me, "cfo", "finance")) {
        refuse("policy", `turnover-${month}`, "record company turnover", "Finance records company turnover (§5.4)");
        return;
      }
      const row: CompanyTurnover = { month, revenue: Math.max(0, Math.round(revenue)), recordedAt: now(), recordedById: me };
      const before = get().companyTurnover.find((t) => t.month === month);
      set((s) => ({ companyTurnover: [...s.companyTurnover.filter((t) => t.month !== month), row].sort((a, b) => a.month.localeCompare(b.month)) }) as Partial<S>);
      log([audit("policy", `turnover-${month}`, `company turnover for ${month} recorded (§5.4 UMKM limit)`, `${before ? `${rp(before.revenue)} → ` : ""}${rp(row.revenue)}`)]);
    },
    recordTaxRegimeChange: (input) => {
      const me = get().currentUserId;
      if (!has(me, "cfo", "finance")) {
        refuse("policy", "tax-regime", "record tax regime change", "Finance confirms the switch date with the tax adviser (§5.4)");
        return null;
      }
      const id = uid("tax");
      const row: TaxRegimeChange = { id, regime: input.regime, effectiveFrom: input.effectiveFrom, corporateEffectiveRate: input.corporateEffectiveRate ?? POLICY.tax.corporateEffectiveRate, note: input.note, recordedAt: now(), recordedById: me };
      set((s) => ({ taxRegimeChanges: [...s.taxRegimeChanges, row] }) as Partial<S>);
      log([audit("policy", id, `tax regime ${input.regime === "corporate" ? `switches to corporate income tax (${(row.corporateEffectiveRate * 100).toFixed(1)}% effective)` : "returns to the UMKM final tax"} from ${input.effectiveFrom.slice(0, 10)} — applies to revenue earned from that date; paid bonuses are not recalculated (§5.4)`, input.note)]);
      return id;
    },
  };
  return actions;
}

/** Deferral is needed and set when any §9.3 trigger applies. */
export const needsDeferral = (i: Initiative) => deferralTriggers(i).length > 0;
