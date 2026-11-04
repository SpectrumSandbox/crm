/*
 * Project Initiative and Compensation Policy v4.0 — data model.
 * Section references (§) point at docs/policy/v4.0.md.
 */
import type { ID, ISODate } from "../types";

/** §3 project classification */
export type ProjectType = "A" | "B" | "C";

/** §4.1 standard project roles */
export const PROJECT_ROLES = ["initiator", "project_lead", "technical_lead", "engineer", "secretary", "specialist"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** §1.3 / §3.1 — permanent and fixed-term staff (full- or part-time) and probationary hires may participate */
export const EMPLOYMENT_TYPES = ["full_time_permanent", "probationary", "part_time", "fixed_term_contract", "contractor", "intern", "temporary", "secondment"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export type GovernanceRole = "prc" | "ceo" | "cfo" | "hr" | "finance" | "executive_committee";

/** §10 changes in employment status */
export type SeparationKind = "resignation" | "termination_for_cause" | "termination_without_cause" | "contract_end" | "retirement" | "death_disability" | "probation_failed" | "ineligible_status";

/** HR record that drives eligibility (§3) and payment conditions (§10, §11). */
export interface EmployeeProfile {
  userId: ID;
  employmentType: EmploymentType;
  hireDate: ISODate;
  probationEndDate: ISODate | null;
  annualBaseSalary: number; // IDR
  /** Part-time: contracted hours as % of full-time — caps the allocation factor (§3.1). */
  contractedHoursPct?: number;
  /** Fixed-term (PKWT): roles only for work periods within the contract term (§3.1). */
  contractEndDate?: ISODate | null;
  directManagerId: ID | null;
  goodStanding: boolean; // no active disciplinary action
  activeWrittenWarning: boolean;
  onPIP: boolean;
  pipApprovedByPRC: boolean;
  underInvestigation: boolean;
  suspended: boolean;
  unpaidLeaveDays: number; // current consecutive unpaid leave
  resignationNoticeAt: ISODate | null; // notice stops new roles; earned bonuses still paid (§10)
  terminationNoticeAt: ISODate | null;
  /** effectiveAt = last working day / termination / contract end / event date. Retirement needs PRC confirmation (§10). */
  separation: { kind: SeparationKind; effectiveAt: ISODate; recordedAt: ISODate; retirementNoticeDays?: number; prcConfirmed?: boolean } | null;
  /** Project Participation Agreement (Annex B) signed as employment-agreement addendum; probationers also sign Annex C. */
  acknowledgmentSignedAt: ISODate | null;
  governanceRoles: GovernanceRole[];
}

/** §4.5 approval workflow */
export const INITIATIVE_STATUSES = ["draft", "submitted", "screening", "evaluation", "conditional", "deferred", "rejected", "approved", "active", "completed"] as const;
export type InitiativeStatus = (typeof INITIATIVE_STATUSES)[number];

export type DecisionOutcome = "approved" | "conditional" | "rejected" | "deferred";
export type ContractStatus = "none" | "verbal" | "loi" | "signed";
export type RiskCategory = "technical" | "schedule" | "financial" | "operational" | "reputation";

export interface Milestone {
  id: ID;
  name: string;
  dueDate: ISODate;
  paymentAmount: number; // 0 when not a payment milestone
  done: boolean;
}

/** §5.3 direct cost estimate */
export interface CostBreakdown {
  materials: number;
  subcontractors: number;
  equipment: number;
  travel: number;
  other: number;
  contingencyPct: number; // typically 10–20 %
}

export interface RiskItem {
  id: ID;
  category: RiskCategory;
  description: string;
  mitigation: string;
  level: "low" | "medium" | "high";
}

/** §4.4 evaluation criteria, scored 1–5 by the PRC reviewer with Finance */
export interface PrcScores {
  feasibility: number;
  profitability: number;
  resources: number;
  strategic: number;
  risk: number;
  notes: string;
}

export interface Decision {
  outcome: DecisionOutcome;
  rationale: string;
  conditions: string;
  conditionsDueAt: ISODate | null;
  votesFor: number;
  votesAgainst: number;
  ceoVeto: boolean;
  decidedAt: ISODate;
  decidedById: ID;
}

/** §4.6 appeals — within 10 business days, Executive Committee decides within 10 business days */
export interface Appeal {
  filedAt: ISODate;
  filedById: ID;
  reason: string;
  status: "pending" | "upheld" | "denied";
  decidedAt: ISODate | null;
  notes: string;
}

export interface Initiative {
  id: ID;
  trackingNo: string; // assigned at submission (§4.5)
  code: string | null; // project code issued on approval (§4.5)
  title: string;
  type: ProjectType;
  status: InitiativeStatus;
  initiatorId: ID;
  /** §4.1 how the opportunity arose — company channels carry no Initiator weight. */
  origination?: "personal" | "follow_on" | "company";
  /** Earliest documented client contact in the CRM — origination evidence (§4.1). */
  firstContactAt?: ISODate | null;
  // §4.3 business case & scope
  summary: string;
  valueProposition: string;
  scope: string;
  deliverables: string;
  exclusions: string;
  successCriteria: string;
  // §4.3 schedule — contracted duration runs start → final delivery in the signed contract (§5.1)
  startDate: ISODate;
  endDate: ISODate;
  milestones: Milestone[];
  // §4.3 client
  companyId: ID | null;
  dealId: ID | null;
  contractStatus: ContractStatus;
  newClient: boolean;
  paymentTermsDays: number;
  // §4.3 financials (expected case sets the revenue-share rate)
  revenue: { expected: number; best: number; worst: number };
  costs: CostBreakdown;
  risks: RiskItem[];
  highRisk: boolean; // PRC rates technical/execution risk high (§9.3)
  warranty: boolean; // Type C with a warranty period (§9.3)
  /** New country or market, or unusual liability terms → Tier 3 (§4.2). */
  unusualTerms?: boolean;
  deferralMonths: number; // 6–12 after project close, set by PRC (§9.3)
  /** Share of each interim bonus deferred when a §9.3 trigger applies (≤ 30 %). */
  deferralPct?: number;
  /**
   * Revenue-share rate y fixed by the PRC at approval (§5.1), or the flat percentage kept by a
   * project approved under Version 3.0 (§15.1). Null → computed from the curve on the expected case.
   */
  lockedSharePct: number | null;
  /** Policy version the project was approved under (§15.1). */
  policyVersion?: "3.0" | "4.0";
  /** Type C guaranteed minimum monthly pool, ≥ Rp1,000,000, fixed by the PRC at approval (§8.6). */
  standardBonus?: number;
  /** PRC selected this project for the Version 4.0 pilot (§15.2). */
  pilot?: boolean;
  // §4.5 review
  submittedAt: ISODate | null;
  acknowledgedAt: ISODate | null;
  primaryReviewerId: ID | null;
  scores: PrcScores | null;
  decision: Decision | null;
  appeal: Appeal | null;
  approvedAt: ISODate | null;
  completedAt: ISODate | null;
  // PMO opens the project in the project system (§4.5)
  epicId: ID | null;
  /** Jira project used for delivery of this initiative (ongoing projects). */
  jiraProjectId?: ID | null;
  /** Sample record shipped with the demo seed (hidden from the ongoing-projects register by default). */
  demo?: boolean;
  /** Ongoing project brought under the policy after it started — PRC ratification required. */
  registeredRetroactively?: boolean;
  /** Justification when the revenue share differs from the share in force (§6.5–6.6, PRC approval). */
  shareNote?: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type RemovalStage = "none" | "verbal" | "written" | "removed";

export interface InitiativeMember {
  id: ID;
  initiativeId: ID;
  userId: ID;
  roles: ProjectRole[];
  specialistWeight: number | null; // 1.5–2.5 (§6.2)
  /** Agreed non-standard combined weight — every initial member agrees in writing (§6.7) or by amendment (§6.8). */
  weightOverride: number | null;
  /** §6.4 allocation factor 0.25 / 0.5 / 0.75 / 1.0 (default 1.0). */
  allocationFactor?: number;
  consent: "pending" | "accepted" | "declined"; // member signs the Role and Weight Agreement / consents to admission
  managerApproved: boolean; // line manager's written agreement to the time (§3.1)
  prcApproved: boolean; // PRC eligibility & capacity check (§6.7)
  application: boolean; // joined by amendment after the start (§6.8)
  allocationPct: number; // planned share of working time agreed with the line manager (§7.1)
  /** Ledger row start / end on the team (§6.5). An amendment closes rows and opens new ones. */
  joinedAt: ISODate;
  leftAt: ISODate | null;
  removal: { stage: RemovalStage; updatedAt: ISODate | null; note: string };
  /** Reason for a non-standard weight or allocation (Annex D "reason for any non-standard weight"). */
  weightNote?: string;
  /** Ledger authority: Role and Weight Agreement or amendment reference (Annex D Part 3). */
  authority?: string;
}

/** §6.8 amendment to roles and weights, decided by majority of current members (PRC breaks ties). */
export interface TeamAmendment {
  id: ID;
  initiativeId: ID;
  proposedById: ID;
  circulatedAt: ISODate;
  effectiveDate: ISODate;
  reason: string;
  change:
    | { kind: "add"; userId: ID; roles: ProjectRole[]; specialistWeight: number | null; weightOverride: number | null; allocationFactor: number; consent: boolean }
    | { kind: "remove"; memberId: ID }
    | { kind: "change"; memberId: ID; roles: ProjectRole[]; specialistWeight: number | null; weightOverride: number | null; allocationFactor: number };
  votes: { userId: ID; vote: "for" | "against"; at: ISODate }[];
  status: "open" | "passed" | "failed" | "tied" | "blocked";
  prcDecision: { outcome: "passed" | "failed" | "blocked"; note: string; at: ISODate; byId: ID } | null;
  recordedAt: ISODate | null; // PMO updated the ledger
}

/**
 * A client payment (§8.1): earned (milestone accepted / period billed) and, once `received`, collected.
 * `month` is the salary cycle it falls in — collected by the 20th → that month, after the 20th → next month (§8.2).
 */
export interface RevenueEntry {
  id: ID;
  initiativeId: ID;
  month: string; // YYYY-MM salary cycle
  revenue: number; // excl. VAT
  directCosts: number; // incurred or accrued for this payment
  basis: "recognized" | "milestone"; // period billed | milestone accepted
  received: boolean; // collected into the company's bank account
  collectedAt?: ISODate | null;
  /** §6.5 work period the payment pays for; defaults to the calendar month of `month`. */
  workPeriodStart?: ISODate | null;
  workPeriodEnd?: ISODate | null;
  note: string;
}

export type LineStatus = "payable" | "withheld_probation" | "partially_deferred" | "carried_forward" | "forfeited" | "held" | "ineligible";

export interface BonusLine {
  initiativeId: ID;
  userId: ID;
  weight: number; // effective weight W × A (§6.6)
  totalWeight: number; // Σ effective weight of the team
  weightDays: number; // E_i over the cycle's work periods
  totalWeightDays: number; // Σ E_j
  sharePct: number; // revenue-share rate y
  netRevenue: number; // project net revenue collected this cycle
  pool: number; // project revenue-based pool this cycle (cumulative, §8.1)
  gross: number; // revenue-based share before top-up deduction
  topUp: number; // Type C top-up share (§8.6)
  topUpDeducted: number; // earlier top-ups recovered from this cycle's revenue-based share
  guaranteed: number; // part of payable protected as the Type C standard bonus (paid even if checks fail)
  carriedIn: number; // carried forward from a failed month, paid first (§9.2)
  payable: number;
  deferred: number; // §9.3 high-risk deferral
  carriedOver: number; // §9.2 unpaid part carried forward to the next passing month
  withheld: number; // §11 probation
  forfeited: number;
  held: number; // suspension, unpaid leave, missing Annex B, PRC confirmation
  status: LineStatus;
  notes: string[];
}

export interface BonusRun {
  id: ID;
  month: string; // YYYY-MM
  status: "draft" | "failed" | "certified" | "released";
  policyVersion: "4.0";
  /** §9.1 rolling three months: the month just closed and the two before it. */
  companyRevenue: number; // accrual basis, excl. VAT, incl. work outside the policy
  directCosts: number; // direct project costs, all projects
  overheads: number; // all other operating costs incl. every salary
  cash: number; // cash before paying bonuses
  fixedCostsMonthly: number; // cash floor = 2 × this
  operatingResult: number; // after the bonuses released
  cashAfter: number;
  /** Share of non-guaranteed bonuses released (1 = in full; < 1 = pro rata, rest carried forward §9.2). */
  payoutPct: number;
  totals: { netRevenue: number; pool: number; topUps: number; topUpDeducted: number; carriedIn: number; payable: number; deferred: number; withheld: number; forfeited: number; held: number; carriedOver: number };
  lines: BonusLine[];
  certifiedById: ID | null;
  certifiedAt: ISODate | null;
  releasedById: ID | null;
  releasedAt: ISODate | null;
}

export interface DeferredBonus {
  id: ID;
  month: string;
  initiativeId: ID;
  userId: ID;
  amount: number;
  vestAt: ISODate;
  status: "pending" | "released" | "forfeited";
  releasedAmount: number;
  note: string;
}

export interface ProbationOutcome {
  userId: ID;
  /** §11.4 confirmed → Probation Completion Bonus; ended in probation → paid with final pay; dismissal for a serious violation → forfeited. */
  outcome: "completed" | "paid_final_pay" | "forfeited";
  amount: number;
  decidedAt: ISODate;
}

/** §9.4 — cost overruns, rework, warranty, penalties and settlements are never clawback triggers. */
export type ClawbackTrigger = "revenue_reversal" | "misconduct" | "data_error";

export interface Clawback {
  id: ID;
  userId: ID;
  initiativeId: ID;
  trigger: ClawbackTrigger;
  paidAt: ISODate; // original bonus payment date (24-month window)
  originalPaid: number;
  recalculated: number;
  personallyAtFault: boolean;
  /** Employee's specific written agreement to salary deductions for this recovery (§9.4 step 5). */
  writtenAgreement?: boolean;
  status: "identified" | "prc_approved" | "disputed" | "recovering" | "closed" | "waived";
  notifiedAt: ISODate | null;
  months: number;
  monthlyDeduction: number;
  recovered: number;
  notes: string;
  createdAt: ISODate;
}

/** §9.5 change to the revenue-share curve — applies only to projects approved after the effective date. */
export interface CurveAdjustment {
  id: ID;
  from: { start: number; floor: number; decay: number };
  to: { start: number; floor: number; decay: number };
  proposedAt: ISODate;
  effectiveFrom: ISODate; // ≥ 30 days' written notice
  rationale: string;
  approvedById: ID;
}

export interface AuditEntry {
  id: ID;
  at: ISODate;
  actorId: ID;
  entity: "initiative" | "member" | "amendment" | "run" | "deferred" | "probation" | "clawback" | "employee" | "policy";
  entityId: ID;
  action: string;
  detail: string;
}
