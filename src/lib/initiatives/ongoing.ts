/*
 * Spectrum Group's ongoing projects, registered under the Project Initiative & Compensation Policy v3.0.
 * Types confirmed by management (Elang: B; Navora, DMS, Tennis: C). Team, revenue and costs are completed
 * in the project register (/projects/[id]); until then the compliance check lists what is missing.
 */
import type { Initiative, ProjectType } from "./types";

const REGISTERED_AT = "2026-11-04T02:00:00.000Z";
/** six whole contracted months (§5.1): 4 Nov 2026 → 3 May 2027 23:59:59 WIB (endDateForMonths) */
const SIX_MONTHS = "2027-05-03T16:59:59.999Z";

const ongoing = (id: string, title: string, type: ProjectType, jiraProjectId: string): Initiative => ({
  id,
  trackingNo: "",
  code: null,
  title,
  type,
  status: "active",
  initiatorId: "u-ben",
  summary: "",
  valueProposition: "",
  scope: "",
  deliverables: "",
  exclusions: "",
  successCriteria: "",
  startDate: REGISTERED_AT,
  endDate: SIX_MONTHS,
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
  deferralPct: 0.3,
  standardBonus: type === "C" ? 1_000_000 : undefined,
  lockedSharePct: null,
  policyVersion: "4.0",
  pilot: false,
  submittedAt: null,
  acknowledgedAt: null,
  primaryReviewerId: null,
  scores: null,
  decision: null,
  appeal: null,
  approvedAt: null,
  completedAt: null,
  epicId: null,
  jiraProjectId,
  demo: false,
  registeredRetroactively: true,
  shareNote: "",
  createdAt: REGISTERED_AT,
  updatedAt: REGISTERED_AT,
});

export const ongoingProjects: Initiative[] = [
  ongoing("prj-elang", "Elang", "B", "pr-elang"),
  ongoing("prj-navora", "Navora", "C", "pr-navora"),
  ongoing("prj-dms", "DMS", "C", "pr-dms"),
  ongoing("prj-tennis", "Tennis", "C", "pr-tennis"),
];
