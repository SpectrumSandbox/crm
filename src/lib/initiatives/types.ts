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
  separation: { kind: SeparationKind; effectiveAt: ISODate; recordedAt: ISODate; retirementNoticeDays?: number; prcConfirmed?: boolean; prcConfirmedAt?: ISODate | null; prcConfirmedById?: ID | null; closedRowIds?: ID[] } | null;
  /** Project Participation Agreement (Annex B) signed as employment-agreement addendum; probationers also sign Annex C. */
  acknowledgmentSignedAt: ISODate | null;
  governanceRoles: GovernanceRole[];
  /** W1: set by the server on a colleague's record sent to a viewer without a pay role (§13.4) — salary 0, disciplinary detail folded into goodStanding. Never written back. */
  redacted?: boolean;
  /** Company employee number (NIK karyawan) — shown on Annex B/E and the payroll export (W8). */
  employeeNumber?: string;
  /** Tax ID (NPWP / NIK used as NPWP) for PPh 21 withholding in payroll (W8). */
  npwp?: string;
  /** PTKP status for the PPh 21 TER category, e.g. "TK/0", "K/1" (PMK 168/2023) (W8). */
  ptkpStatus?: string;
  /** §13.1 end of a two-year PRC term for appointed technical managers (W8). */
  prcTermEndsAt?: ISODate | null;
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
  /** §13.1 recorded vote of every PRC member (recused members do not vote). votesFor/votesAgainst are derived from it. */
  votes?: PrcVote[];
  /** §13.1 the chair's casting vote broke a tie. */
  castingVote?: boolean;
  /** §13.1 quorum: a majority of members, including the CFO or a named Finance delegate. */
  quorum?: { present: number; members: number; finance: boolean; financeDelegateId?: ID | null };
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
  /** §4.5 step 2 — incomplete proposals returned to the proposer; the completeness clock restarts on resubmission. */
  returns?: ProposalReturn[];
  /** W7 §8.3 final reconciliation within 30 days of close. */
  reconciliation?: FinalReconciliationRecord | null;
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
    | { kind: "add"; userId: ID; roles: ProjectRole[]; specialistWeight: number | null; weightOverride: number | null; allocationFactor: number; consent: boolean; managerApproved?: boolean; weightNote?: string; allocationPct?: number }
    | { kind: "remove"; memberId: ID }
    | { kind: "change"; memberId: ID; roles: ProjectRole[]; specialistWeight: number | null; weightOverride: number | null; allocationFactor: number };
  votes: { userId: ID; vote: "for" | "against"; at: ISODate; recordedById?: ID; evidence?: string }[];
  status: "open" | "passed" | "failed" | "tied" | "blocked";
  prcDecision: { outcome: "passed" | "failed" | "blocked"; note: string; at: ISODate; byId: ID } | null;
  recordedAt: ISODate | null; // PMO updated the ledger
  /** Voting closed at the 5-business-day deadline (§6.8.2) without a majority (W7 closeOverdueAmendments). */
  closedAt?: ISODate | null;
  closedReason?: string;
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
  /** §8.5 correction of an entry in a released cycle (W7 addRevenueCorrection) — lands in the next open cycle. */
  correctionOf?: ID | null;
}

/** An amount brought forward into a later cycle with the dates §10 needs to re-check it (W7 engine). */
export interface CarryItem {
  kind: "carried" | "held";
  amount: number;
  /** collection date of the payment that generated it (§10 resignation / trail tests) */
  collectedAt: ISODate | null;
  /** start of the work period it pays for */
  workStart: ISODate | null;
  /** cycle it was first due in */
  fromMonth: string;
  reason?: string;
}

/** PPh 21 withholding estimate on a bonus line (PP 58/2023 TER, PMK 168/2023) — payroll computes the real figure (§8.5, Annex E). */
export interface Pph21Estimate {
  gross: number;
  withheld: number;
  net: number;
  category: "A" | "B" | "C";
  ptkp: string;
  /** TER rate on salary + all bonuses paid this salary */
  rate: number;
  monthlySalary: number;
  basis: "estimate";
  note: string;
}

export type ExtraPaymentKind = "deferred_release" | "probation_completion" | "probation_final_pay" | "reconciliation_topup" | "underpayment_correction";

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
  /** W7: held amounts still waiting for their condition to clear, with their original dates (§10, §15.1) */
  heldItems?: CarryItem[];
  /** W7: unpaid amounts carried forward (§9.2) with their original dates */
  carriedItems?: CarryItem[];
  /** W7: part of carriedIn that had been held earlier and is paid now that the condition cleared */
  heldIn?: number;
  /** W7: deferred releases, Probation Completion Bonus, reconciliation top-ups and corrections paid in this line */
  extraIn?: number;
  extras?: { kind: ExtraPaymentKind; refId: ID; amount: number; note: string }[];
  /** W7: clawback recovered from this bonus (§9.4 order of recovery) */
  recovered?: number;
  recoveries?: { clawbackId: ID; amount: number }[];
  /** W7: latest collection date / earliest work start among the payments in this line */
  lastCollectedAt?: ISODate | null;
  firstWorkStart?: ISODate | null;
  /** W7: cycles whose late collections were rolled into this one (§8.5) */
  rolledFrom?: string[];
  /** W7: PPh 21 TER estimate on the payable amount */
  pph21?: Pph21Estimate;
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
  totals: { netRevenue: number; pool: number; topUps: number; topUpDeducted: number; carriedIn: number; payable: number; deferred: number; withheld: number; forfeited: number; held: number; carriedOver: number; extraIn?: number; heldIn?: number; recovered?: number; pph21Estimate?: number };
  lines: BonusLine[];
  /** W1: set by the server when `lines` holds only the viewer's own lines (no pay role, §13.4); totals stay company-wide. */
  redacted?: boolean;
  certifiedById: ID | null;
  certifiedAt: ISODate | null;
  releasedById: ID | null;
  releasedAt: ISODate | null;
  /** W7 maker-checker: who saved the provisional figures and who entered the certification (on-behalf) */
  preparedById?: ID | null;
  recordedById?: ID | null;
  /** W7 §13.1 PRC release decision: votes recorded, members recused (on the team) */
  approvals?: { userId: ID; vote: "for" | "against"; at: ISODate }[];
  recusedIds?: ID[];
  /** W7 revenue entries paid in this cycle — later collections for it roll into the next open cycle (§8.5) */
  entryIds?: ID[];
  /** W7 recorded when the PRC releases after the salary date */
  lateReleaseReason?: string | null;
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
  /** W7: salary cycle the release is paid in (a payable line of that run, §9.1) */
  payMonth?: string | null;
  releasedAt?: ISODate | null;
  releasedById?: ID | null;
  /** W7: latest collection date / work start of the payments it came from (§10 checks at release) */
  collectedAt?: ISODate | null;
  workStart?: ISODate | null;
  /** W7: warranty / rework costs deducted at release (§9.3) */
  costDeduction?: number;
}

export interface ProbationOutcome {
  userId: ID;
  /** §11.4 confirmed → Probation Completion Bonus; ended in probation → paid with final pay; dismissal for a serious violation → forfeited. */
  outcome: "completed" | "paid_final_pay" | "forfeited";
  amount: number;
  decidedAt: ISODate;
  /** W7 */
  id?: ID;
  /** W7: salary cycle the balance is paid in — within 30 days of the probation end (§11.4) */
  payMonth?: string | null;
  /** W7: held balance by project, so the payment lands on project lines */
  byProject?: { initiativeId: ID; amount: number }[];
  /** W7: probation end / last working day used */
  endedAt?: ISODate | null;
}

/** W7 §8.3 final reconciliation top-ups and §8.5 underpayment corrections, paid as lines of `payMonth`. */
export interface BonusAdjustment {
  id: ID;
  kind: "reconciliation_topup" | "underpayment_correction";
  userId: ID;
  initiativeId: ID;
  amount: number;
  payMonth: string;
  note: string;
  createdAt: ISODate;
  createdById: ID;
}

/** W7 §5.4 company gross turnover by month (all revenue, incl. work outside the policy) for the UMKM Rp4.8bn limit. */
export interface CompanyTurnover {
  month: string;
  revenue: number;
  recordedAt: ISODate;
  recordedById: ID;
}

/** W7 §5.4 dated switch from the UMKM final tax to corporate income tax, confirmed by Finance with the tax adviser. */
export interface TaxRegimeChange {
  id: ID;
  regime: "umkm" | "corporate";
  effectiveFrom: ISODate;
  corporateEffectiveRate: number;
  note: string;
  recordedAt: ISODate;
  recordedById: ID;
}

/** W7 §8.3 final reconciliation recorded on a closed project. */
export interface FinalReconciliationRecord {
  at: ISODate;
  byId: ID;
  finalRate: number;
  finalPool: number;
  allocated: number;
  difference: number;
  payMonth: string | null;
  offsetFromDeferred: number;
  absorbedOrClawback: number;
  note: string;
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
  /** W7: date the trigger occurred / was identified (24-month window, §9.4); defaults to createdAt */
  triggeredAt?: ISODate | null;
  /** W7: recover from the employee's future project bonuses through the monthly run (§9.4 order of recovery) */
  recoverFromBonuses?: boolean;
  recoveries?: { month: string; amount: number; source: "bonus" | "deferred" | "carried" | "salary"; at: ISODate }[];
  /** W8 §9.4 step 2 / §13.1 recorded PRC decisions on the case and on any dispute: per-member votes, quorum, casting vote, veto, reasons. */
  prcDecisions?: { kind: "case" | "dispute"; at: ISODate; recordedById: ID; votes: PrcVote[]; castingVote: "for" | "against" | null; ceoVeto: boolean; quorumMet: boolean; carried: boolean; reasons: string }[];
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

/* ───────────────────────── governance records (W6) ───────────────────────── */

/** §13.1 one PRC member's vote on a decision. */
export interface PrcVote {
  userId: ID;
  vote: "for" | "against" | "abstain" | "absent";
  /** on the project's team or declared a conflict (§13.1, §12.2) — does not take part */
  recused: boolean;
  reason?: string;
}

/** §4.5 step 2 — the PMO returned an incomplete proposal with the list of what is missing. */
export interface ProposalReturn {
  at: ISODate;
  byId: ID;
  missing: string[];
  note: string;
  resubmittedAt?: ISODate | null;
}

export type Rag = "green" | "amber" | "red";

/** §6.1 the Project Lead's monthly report: overall health and schedule/budget/scope RAG. */
export interface ProjectUpdate {
  id: ID;
  initiativeId: ID;
  /** YYYY-MM month the report covers */
  month: string;
  health: Rag;
  schedule: Rag;
  budget: Rag;
  scope: Rag;
  summary: string;
  /** required when health is amber or red */
  pathToGreen: string;
  nextSteps: string;
  /** decisions or help needed from the client / PRC */
  decisionsNeeded?: string;
  authorId: ID;
  at: ISODate;
}

/** §5.6 change order: out-of-scope work only adds revenue once approved; §5.1 x moving > 10 % → PRC resets the rate. */
export interface ChangeOrder {
  id: ID;
  initiativeId: ID;
  /** CO-001 … per project */
  ref: string;
  title: string;
  description: string;
  /** contract value change, excl. VAT (IDR, may be negative) */
  priceDelta: number;
  /** direct cost change (IDR) */
  costDelta: number;
  scheduleDeltaDays: number;
  status: "draft" | "submitted" | "client_signed" | "approved" | "rejected";
  raisedById: ID;
  raisedAt: ISODate;
  clientSignedAt?: ISODate | null;
  decidedById?: ID | null;
  decidedAt?: ISODate | null;
  /** PRC reset the revenue-share rate for revenue realised after this CO (§5.1) */
  rateResetAt?: ISODate | null;
  rateResetNote?: string;
  /** the new rate y the PRC set at the reset (applies to revenue realised after rateResetAt) */
  rateResetPct?: number | null;
  note?: string;
}

/** Annex G close-out report, submitted by the Project Lead (§8.3); Finance reconciles within 30 days. */
export interface CloseOutReport {
  id: ID;
  initiativeId: ID;
  actualStart: ISODate;
  actualEnd: ISODate;
  acceptanceDate: ISODate;
  /** final financials (IDR) — projections come from the approved proposal */
  actualRevenue: number;
  actualDirectCosts: number;
  actualTaxes: number;
  bonusesPaid: number;
  unpaidInvoices: number;
  writtenOff: number;
  warrantyUntil: ISODate | null;
  openWarranty: string;
  rateRecalculation: { needed: boolean; why: string };
  acceptedWithoutRework: boolean;
  clientFeedback: string;
  safetyIncidents: string;
  wentWell: string;
  doDifferently: string;
  signOff: { projectLeadId: ID | null; technicalLeadId: ID | null; financeId: ID | null; pmoId: ID | null };
  submittedById: ID;
  submittedAt: ISODate;
  /** Finance final reconciliation (§8.3), due 30 days after close */
  reconciledAt?: ISODate | null;
}

export const COI_QUESTIONS = [
  { key: "employment", label: "Employment, directorship or advisory role" },
  { key: "financial", label: "Shareholding or other financial interest" },
  { key: "loan", label: "Loan, guarantee or debt" },
  { key: "family", label: "Family or close personal relationship with a decision-maker" },
  { key: "gift", label: "Gift, hospitality or benefit received in the last 12 months" },
  { key: "outside_work", label: "Paid work done outside the company for any of them" },
  { key: "other", label: "Any other interest that could affect, or appear to affect, your judgment" },
] as const;
export type CoiQuestion = (typeof COI_QUESTIONS)[number]["key"];

/** Annex F conflict-of-interest declaration (§12.2) — before approval and within 2 business days of any new conflict. */
export interface CoiDeclaration {
  id: ID;
  initiativeId: ID;
  userId: ID;
  role: string;
  answers: Record<CoiQuestion, { yes: boolean; details: string }>;
  signedAt: ISODate;
  /** recorded by someone other than the declarant (on their behalf from the signed form) */
  recordedById: ID;
  /** reference of the signed Annex F form when recorded on someone's behalf */
  formRef?: string;
  prc: { conflict: boolean; action: "none" | "team_change" | "price_check" | "rejected"; note: string; decidedById: ID; decidedAt: ISODate } | null;
}

/* ───────────── §14 disputes and appeals (W9) ───────────── */

/** §14 what a dispute may concern. */
export const DISPUTE_CATEGORIES = ["calculation", "ledger", "origination", "role", "rating", "removal", "probation", "forfeiture", "clawback"] as const;
export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];
/** direct resolution (step 2) → PRC (step 3) → Executive Committee appeal (step 4) → closed */
export type DisputeStage = "direct" | "prc" | "exco" | "closed";
export type DisputeOutcome = "upheld" | "partially_upheld" | "rejected" | "withdrawn" | "settled";

export interface DisputeEvent {
  id: ID;
  at: ISODate;
  actorId: ID;
  kind: "raised" | "comment" | "proposed" | "accepted" | "escalated" | "vote" | "decided" | "appealed" | "withdrawn" | "assigned" | "correction_paid";
  stage: DisputeStage;
  text: string;
}

/** §14 dispute — raised from a statement line, a ledger row, a deferred bonus, a clawback notice or a decision. */
export interface Dispute {
  id: ID;
  /** DSP-YYYY-NNNN */
  number: string;
  raisedById: ID;
  category: DisputeCategory;
  subject: string;
  detail: string;
  initiativeId: ID | null;
  /** salary cycle of the statement disputed (YYYY-MM) */
  runMonth: string | null;
  /** source record: "line:<runId>:<initiativeId>", "member:<id>", "deferred:<id>", "clawback:<id>" or null */
  lineRef: string | null;
  /** figure shown on the statement / record, and what the employee says it should be */
  amount: number | null;
  claimedAmount: number | null;
  /** statement date (calculation, ledger) or decision / event date (other categories) — §14 step 1 */
  eventAt: ISODate;
  raisedAt: ISODate;
  /** raised after the 30-day limit; lateReason explains why */
  late: boolean;
  lateReason?: string;
  stage: DisputeStage;
  stageStartedAt: ISODate;
  /** business-day deadline of the current stage (WIB) */
  dueAt: ISODate | null;
  /** person handling the direct resolution (Finance, the Project Lead or HR) */
  handlerId: ID | null;
  /** people involved — recused from deciding at the PRC and Executive Committee (§14 step 3, §13.1) */
  involvedIds: ID[];
  /** direct-resolution proposal awaiting the employee's acceptance */
  proposal: { outcome: Exclude<DisputeOutcome, "withdrawn">; text: string; correction: number | null; byId: ID; at: ISODate } | null;
  /** PRC (step 3) and Executive Committee (step 4) votes */
  votes: { userId: ID; stage: "prc" | "exco"; vote: "uphold" | "reject"; at: ISODate }[];
  prcDecision: { outcome: Exclude<DisputeOutcome, "withdrawn" | "settled">; text: string; correction: number | null; byId: ID; at: ISODate; appealBy: ISODate } | null;
  excoDecision: { outcome: Exclude<DisputeOutcome, "withdrawn" | "settled">; text: string; correction: number | null; byId: ID; at: ISODate } | null;
  outcome: DisputeOutcome | null;
  closedAt: ISODate | null;
  /** §8.5 underpayment corrected in the next cycle (set by Finance / PRC / ExCo only — server rule) */
  correction: { amount: number; cycle: string; paidAt: ISODate | null; paidById: ID | null } | null;
  /** closed because the employee accepted the direct-resolution proposal (outcome = the proposal's outcome) */
  settledDirectly?: boolean;
  events: DisputeEvent[];
  demo?: boolean;
}

/** Annex B (and Annex C for probationers) e-signature — typed-name signature record; never edited or deleted. */
export interface AgreementSignature {
  id: ID;
  userId: ID;
  policyVersion: string;
  annexC: boolean;
  /** language of the text shown and signed */
  language: "id" | "en";
  /** name typed by the signer — must match the HR record */
  typedName: string;
  /** identity of the signer: Cloudflare Access email, or the demo "acting as" choice */
  email: string | null;
  identitySource: "access" | "demo";
  signedAt: ISODate;
  /** fingerprint (FNV-1a) of the exact text and filled-in details signed */
  fingerprint: string;
  /** the filled-in Annex B / C details at signing */
  details: { label: string; value: string }[];
  userAgent?: string;
}

/** §9.6 monthly company financial summary — aggregate figures only, published to every employee. */
export interface CompanySummary {
  id: ID;
  month: string;
  publishedAt: ISODate;
  publishedById: ID;
  /** rolling three months used in the §9.1 test */
  companyRevenue: number;
  directCosts: number;
  overheads: number;
  operatingResult: number;
  breakEvenPassed: boolean;
  cashPassed: boolean;
  payoutPct: number;
  projects: number;
  participants: number;
  /** aggregate bonus figures of the cycle */
  pool: number;
  payable: number;
  deferred: number;
  carriedOver: number;
  probationHeld: number;
  held: number;
  forfeited: number;
  /** aggregate balances at publication (§9.6 bullet 4) */
  balances: { deferredPending: number; carriedForward: number; probationHeld: number; clawbackOutstanding: number };
  note: string;
}
