/*
 * Project Initiative and Compensation Policy v4.0 (draft of 29 Oct 2026; pilot from 1 Jan 2027) — constants.
 * Full text: docs/policy/v4.0.md. Section references (§) point at that document. All amounts are rupiah.
 */
import type { EmploymentType, ProjectRole, ProjectType, RiskCategory } from "./types";

export const POLICY_VERSION = "4.0";
export const POLICY_STATUS = "Draft for approval";
export const POLICY_DATED = "2026-10-29";
/** Pilot start (§15.2). Full rollout follows the pilot review and the Company Regulations approval. */
export const POLICY_EFFECTIVE = "2027-01-01";
export const POLICY_SUPERSEDES = "3.0 (effective 1 Apr 2026)";
/** Work contracted before this date stays outside the policy unless the PRC brings it in (§1.4, §15.1). */
export const QUALIFYING_CONTRACT_FROM = "2026-04-01";

/** §5.1 / §9.5 regressive revenue-share curve: y = S ÷ (1 + (S ÷ F − 1) × x ÷ D), floor F at and above D. */
export interface Curve {
  start: number; // S
  floor: number; // F
  decay: number; // D, rupiah of projected annual net revenue
}
export const CURVE: Curve = { start: 0.4, floor: 0.1, decay: 1_500_000_000 };
/** §9.5 limits set in the Company Regulations. */
export const CURVE_LIMITS = { start: [0.2, 0.6], floor: [0.05, 0.3], decay: [500_000_000, 5_000_000_000] } as const;

export const PROJECT_TYPE_META: Record<ProjectType, { label: string; short: string; description: string; examples: string; capacityFactor: number; color: "cyan" | "yellow" | "magenta" }> = {
  A: {
    label: "Type A · Consulting",
    short: "Consulting",
    description: "Professional services with intellectual output only.",
    examples: "Advisory, engineering design and analysis, feasibility studies, process optimisation, training",
    capacityFactor: 0.25,
    color: "cyan",
  },
  B: {
    label: "Type B · Engineering services",
    short: "Engineering",
    description: "Engineering work with moderate company investment.",
    examples: "Installation and commissioning, custom engineering, EPC, troubleshooting, system integration",
    capacityFactor: 0.5,
    color: "yellow",
  },
  C: {
    label: "Type C · Product development & manufacturing",
    short: "Product",
    description: "Physical products needing significant company capital. Guaranteed minimum project bonus (§8.6).",
    examples: "Custom equipment fabrication, prototyping, manufacturing runs, proprietary product lines",
    capacityFactor: 1.0,
    color: "magenta",
  },
};

export const ROLE_META: Record<ProjectRole, { label: string; weight: number; leadership: boolean; description: string }> = {
  initiator: { label: "Project Initiator", weight: 0.5, leadership: false, description: "Personally originated the opportunity; business development and client acquisition (§4.1)" },
  project_lead: { label: "Project Lead", weight: 2.0, leadership: true, description: "Delivery, client relationship, budget, schedule, team coordination, change orders, monthly reporting" },
  technical_lead: { label: "Technical Lead", weight: 2.0, leadership: true, description: "Technical direction, design authority, quality assurance, technical sign-off" },
  specialist: { label: "Specialist", weight: 2.0, leadership: false, description: "Domain expertise such as QA/QC, procurement, HSE, commissioning — 1.5 to 2.5 (§6.2)" },
  engineer: { label: "Engineer", weight: 1.0, leadership: false, description: "Technical execution: analysis, design, calculations, drafting, documentation, site work" },
  secretary: { label: "Project Secretary", weight: 1.0, leadership: false, description: "Administration, scheduling, document control, meeting records, client correspondence" },
};
export const SPECIALIST_RANGE: [number, number] = [1.5, 2.5];
/** §6.2 guide for agreeing a Specialist's weight. */
export const SPECIALIST_GUIDE: { weight: number; label: string }[] = [
  { weight: 1.5, label: "Supporting specialist with a defined, limited input" },
  { weight: 2.0, label: "Key specialist whose work is central to a deliverable" },
  { weight: 2.5, label: "Accountable specialist who signs off a regulated or safety-critical deliverable" },
];
/** §6.4 allocation factors. */
export const ALLOCATION_FACTORS = [0.25, 0.5, 0.75, 1] as const;

/** §1.3 / §3.1 / §3.2 eligibility by employment status. */
export const EMPLOYMENT_META: Record<EmploymentType, { label: string; eligible: boolean }> = {
  full_time_permanent: { label: "Permanent (PKWTT)", eligible: true },
  probationary: { label: "Permanent · probation", eligible: true },
  part_time: { label: "Part-time (PKWTT/PKWT)", eligible: true },
  fixed_term_contract: { label: "Fixed-term (PKWT)", eligible: true },
  contractor: { label: "Contractor / consultant", eligible: false },
  intern: { label: "Intern / trainee", eligible: false },
  temporary: { label: "Outsourced / agency / casual", eligible: false },
  secondment: { label: "Seconded in from another organisation", eligible: false },
};

export const RISK_CATEGORIES: Record<RiskCategory, string> = {
  technical: "Technical",
  schedule: "Schedule",
  financial: "Financial",
  operational: "Safety & operational",
  reputation: "Legal & reputational",
};

export const ORIGINATION_META = {
  personal: { label: "Personally originated", description: "Own business development, network or idea — Initiator weight 0.5 applies (§4.1)" },
  follow_on: { label: "Follow-on scope originated by an employee", description: "Belongs to the employee who originated the follow-on scope (§4.1)" },
  company: { label: "Company channel", description: "Website/email enquiry, tender sent to the company, management referral or repeat order — no Initiator weight; PRC appoints the Project Lead (§4.1)" },
} as const;

/** §4.2 approval tiers. */
export const TIER_META = {
  1: { label: "Tier 1 · Fast-track", proposal: "Short form (Annex A, Part 1)", decides: "Two PRC members, one from Finance", decisionBusinessDays: 3 },
  2: { label: "Tier 2 · Standard", proposal: "Full proposal (Annex A)", decides: "Full PRC", decisionBusinessDays: 5 },
  3: { label: "Tier 3 · Major", proposal: "Full proposal plus legal and tax review", decides: "Full PRC with the CEO present", decisionBusinessDays: 10 },
} as const;
export type ApprovalTier = keyof typeof TIER_META;

export const POLICY = {
  tax: {
    regime: "umkm" as "umkm" | "corporate",
    umkmRate: 0.005, // §5.4 PPh Final 0.5 % of revenue excl. VAT
    umkmTurnoverLimit: 4_800_000_000,
    corporateEffectiveRate: 0.22, // statutory rate used once the UMKM regime ends (Finance sets the effective rate)
    varianceReviewPct: 0.15, // §5.5
  },
  tiers: { fastTrackBelow: 400_000_000, majorAbove: 2_000_000_000 }, // §4.2
  leadershipCapacity: 2.0, // §7.3
  maxConcurrentNonLeadRoles: 3, // §7.1
  deferral: { maxPct: 0.3, defaultPct: 0.3, netRevenueThreshold: 1_000_000_000, paymentTermsDays: 90, minMonths: 6, maxMonths: 12, forecastShortfallReviewPct: 0.1 }, // §9.3
  rate: { resetOnChangePct: 0.1, recalcIfAbovePct: 0.2 }, // §5.1
  typeCMinimum: { standardBonus: 1_000_000, consecutiveMonthsToEnd: 3, singleMonthMultipleToEnd: 12 }, // §8.6
  breakEven: { rollingMonths: 3, cashFloorMonths: 2, failReviewMonths: 3 }, // §9.1–9.2
  cycle: { cutoffDay: 20, provisionalDay: 22, certifyDay: 23, salaryDay: 25 }, // §8.2
  closeReconciliationDays: 30, // §8.3
  unpaidInvoiceCloseDays: 90, // §8.3
  statementDisputeDays: 30, // §8.4, §14
  clawback: { windowMonths: 24, maxSalaryDeductionPct: 0.2, maxWageDeductionPct: 0.5, minMonths: 6, maxMonths: 12, dataErrorSafeHarbour: 10_000_000, disputeBusinessDays: 10 }, // §9.4
  sla: { acknowledgeBusinessDays: 1, completenessBusinessDays: 2, appealBusinessDays: 10, amendmentVoteBusinessDays: 5, prcTieBusinessDays: 5, removalAppealBusinessDays: 5, disputeResolveBusinessDays: 10 }, // §4.5, §6.8, §7.5, §14
  statusChangeReportBusinessDays: 2, // §3.5
  unpaidLeaveMaxDays: 30, // §3.2
  probationMaxMonths: 3, // §11.1
  probationPayoutDays: 30, // §11.4
  separationTrailMonths: 12, // §10 later collections paid for up to 12 months
  deathPayoutDays: 60, // §10
  curveNoticeDays: 30, // §9.5
  removalWarningDays: { verbal: 14, written: 7 }, // §7.5
};
