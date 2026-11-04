/*
 * Project Initiative & Compensation Policy v3.0 (effective 1 Apr 2026) — data model.
 * Section references (§) point at the policy document.
 */
import type { ID, ISODate } from "../types";

/** §3 project classification */
export type ProjectType = "A" | "B" | "C";

/** §4.1 standard project roles */
export const PROJECT_ROLES = ["initiator", "project_lead", "technical_lead", "engineer", "secretary", "specialist"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** §1.2 / §2.1 — only full-time permanent (and probationary full-time) staff may participate */
export const EMPLOYMENT_TYPES = ["full_time_permanent", "probationary", "part_time", "fixed_term_contract", "contractor", "intern", "temporary", "secondment"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export type GovernanceRole = "prc" | "ceo" | "cfo" | "hr" | "finance" | "executive_committee";

export type SeparationKind = "resignation" | "termination_for_cause" | "termination_without_cause" | "retirement" | "death_disability" | "probation_failed";

/** HR record that drives eligibility (§2.1) and payment conditions (§4.5). */
export interface EmployeeProfile {
  userId: ID;
  employmentType: EmploymentType;
  hireDate: ISODate;
  probationEndDate: ISODate | null;
  annualBaseSalary: number; // IDR
  directManagerId: ID | null;
  goodStanding: boolean; // no active disciplinary action
  activeWrittenWarning: boolean;
  onPIP: boolean;
  pipApprovedByPRC: boolean;
  underInvestigation: boolean;
  suspended: boolean;
  unpaidLeaveDays: number; // current consecutive unpaid leave
  resignationNoticeAt: ISODate | null; // forfeiture effective from this date (§4.5)
  terminationNoticeAt: ISODate | null;
  separation: { kind: SeparationKind; effectiveAt: ISODate; recordedAt: ISODate; retirementNoticeDays?: number } | null;
  acknowledgmentSignedAt: ISODate | null; // §4.5 notice + §6.8 probation acknowledgment
  governanceRoles: GovernanceRole[];
}

/** §2.3 approval workflow */
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

/** §2.2.5 direct cost estimate */
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

/** §2.3.3 evaluation criteria, scored 1–5 by the primary reviewer */
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

/** §2.3.7 appeals — within 10 business days, Executive Committee decides within 10 business days */
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
  trackingNo: string; // assigned at submission (§2.3.2)
  code: string | null; // project code issued on approval (§2.3.4)
  title: string;
  type: ProjectType;
  status: InitiativeStatus;
  initiatorId: ID;
  // §2.2.1–2.2.2
  summary: string;
  valueProposition: string;
  scope: string;
  deliverables: string;
  exclusions: string;
  successCriteria: string;
  // §2.2.3
  startDate: ISODate;
  endDate: ISODate;
  milestones: Milestone[];
  // §2.2.6
  companyId: ID | null;
  dealId: ID | null;
  contractStatus: ContractStatus;
  newClient: boolean;
  paymentTermsDays: number;
  // §2.2.5
  revenue: { expected: number; best: number; worst: number };
  costs: CostBreakdown;
  // §2.2.7
  risks: RiskItem[];
  highRisk: boolean; // PRC classification (§6.3)
  warranty: boolean; // Type C manufacturing warranty (§6.3)
  deferralMonths: number; // 6–12, set by PRC
  lockedSharePct: number | null; // revenue share honoured for this project (§6.6 step 5)
  capException: boolean; // CEO-approved higher pool cap (§6.2)
  // §2.3 review
  submittedAt: ISODate | null;
  acknowledgedAt: ISODate | null;
  primaryReviewerId: ID | null;
  scores: PrcScores | null;
  decision: Decision | null;
  appeal: Appeal | null;
  approvedAt: ISODate | null;
  completedAt: ISODate | null;
  // Jira bridge (§2.3.6 "entered into project management system")
  epicId: ID | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type RemovalStage = "none" | "verbal" | "written" | "removed";

export interface InitiativeMember {
  id: ID;
  initiativeId: ID;
  userId: ID;
  roles: ProjectRole[];
  specialistWeight: number | null; // 1.5–2.5
  weightOverride: number | null; // §4.1 consensus adjustment, PRC-approved
  consent: "pending" | "accepted" | "declined"; // §7.1 step 1
  managerApproved: boolean;
  prcApproved: boolean; // §7.1 step 2
  application: boolean; // joined via employee application (§7.1)
  allocationPct: number; // time commitment (§2.2.4)
  joinedAt: ISODate;
  leftAt: ISODate | null;
  removal: { stage: RemovalStage; updatedAt: ISODate | null; note: string };
}

/** Revenue recognised (or milestone payment received) for a project in a month (§4.4). */
export interface RevenueEntry {
  id: ID;
  initiativeId: ID;
  month: string; // YYYY-MM
  revenue: number;
  directCosts: number;
  basis: "recognized" | "milestone";
  received: boolean; // milestone bonuses distribute on payment receipt
  note: string;
}

export type LineStatus = "payable" | "withheld_probation" | "partially_deferred" | "forfeited" | "held" | "cap_review" | "ineligible";

export interface BonusLine {
  initiativeId: ID;
  userId: ID;
  weight: number;
  totalWeight: number;
  sharePct: number;
  netRevenue: number;
  pool: number;
  gross: number;
  payable: number;
  deferred: number; // §6.3 high-risk deferral
  carriedOver: number; // §6.1 partial deferral (corrective action)
  withheld: number; // §6.8 probation
  forfeited: number;
  held: number; // §6.2 per-person cap review, unpaid leave, etc.
  status: LineStatus;
  notes: string[];
}

export interface BonusRun {
  id: ID;
  month: string; // YYYY-MM
  status: "draft" | "failed" | "certified" | "released";
  overheads: number;
  ebitda: number;
  shareOverrides: Partial<Record<ProjectType, number>>;
  partialDeferralPct: number;
  operatingResult: number;
  totals: { netRevenue: number; pool: number; payable: number; deferred: number; withheld: number; forfeited: number; held: number; carriedOver: number };
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
  outcome: "completed" | "forfeited";
  amount: number;
  decidedAt: ISODate;
}

export type ClawbackTrigger = "revenue_reversal" | "cost_overrun" | "misconduct" | "data_error";

export interface Clawback {
  id: ID;
  userId: ID;
  initiativeId: ID;
  trigger: ClawbackTrigger;
  paidAt: ISODate; // original bonus payment date (24-month window)
  originalPaid: number;
  recalculated: number;
  personallyAtFault: boolean;
  status: "identified" | "prc_approved" | "disputed" | "recovering" | "closed" | "waived";
  notifiedAt: ISODate | null;
  months: number;
  monthlyDeduction: number;
  recovered: number;
  notes: string;
  createdAt: ISODate;
}

export interface ShareAdjustment {
  id: ID;
  type: ProjectType;
  fromPct: number;
  toPct: number;
  proposedAt: ISODate;
  effectiveFrom: ISODate; // ≥ 30 days after announcement (§6.6)
  rationale: string;
  approvedById: ID;
}

export interface AuditEntry {
  id: ID;
  at: ISODate;
  actorId: ID;
  entity: "initiative" | "member" | "run" | "deferred" | "probation" | "clawback" | "employee" | "policy";
  entityId: ID;
  action: string;
  detail: string;
}
