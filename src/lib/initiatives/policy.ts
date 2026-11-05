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
  /** §5.4 turnover alert levels against the Rp4.8bn UMKM limit */
  umkmAlerts: { watch: 0.7, warning: 0.9 },
  /** §13.1 a quorum is a majority of PRC members including the CFO or a named Finance delegate */
  prcQuorum: { majority: 0.5, requireFinance: true },
};

/**
 * PPh 21 monthly effective rates (Tarif Efektif Rata-rata, TER) — PP 58/2023 Annex, PMK 168/2023. Each bracket is
 * [upper bound of monthly gross income (inclusive), rate]. Category A: TK/0, TK/1, K/0; B: TK/2, TK/3, K/1, K/2;
 * C: K/3. Used only for the "estimate" shown on bonus lines and statements (§8.5, Annex E) — payroll withholds the
 * actual tax, and December uses the annual Article 17 true-up.
 */
const J = 1_000_000;
export const PPH21_TER: Record<"A" | "B" | "C", [number, number][]> = {
  A: [
    [5.4 * J, 0], [5.65 * J, 0.0025], [5.95 * J, 0.005], [6.3 * J, 0.0075], [6.75 * J, 0.01], [7.5 * J, 0.0125], [8.55 * J, 0.015], [9.65 * J, 0.0175],
    [10.05 * J, 0.02], [10.35 * J, 0.0225], [10.7 * J, 0.025], [11.05 * J, 0.03], [11.6 * J, 0.035], [12.5 * J, 0.04], [13.75 * J, 0.05], [15.1 * J, 0.06],
    [16.95 * J, 0.07], [19.75 * J, 0.08], [24.15 * J, 0.09], [26.45 * J, 0.1], [28 * J, 0.11], [30.05 * J, 0.12], [32.4 * J, 0.13], [35.4 * J, 0.14],
    [39.1 * J, 0.15], [43.85 * J, 0.16], [47.8 * J, 0.17], [51.4 * J, 0.18], [56.3 * J, 0.19], [62.2 * J, 0.2], [68.6 * J, 0.21], [77.5 * J, 0.22],
    [89 * J, 0.23], [103 * J, 0.24], [125 * J, 0.25], [157 * J, 0.26], [206 * J, 0.27], [337 * J, 0.28], [454 * J, 0.29], [550 * J, 0.3],
    [695 * J, 0.31], [910 * J, 0.32], [1_400 * J, 0.33], [Number.POSITIVE_INFINITY, 0.34],
  ],
  B: [
    [6.2 * J, 0], [6.5 * J, 0.0025], [6.85 * J, 0.005], [7.3 * J, 0.0075], [9.2 * J, 0.01], [10.75 * J, 0.015], [11.25 * J, 0.02], [11.6 * J, 0.025],
    [12.6 * J, 0.03], [13.6 * J, 0.04], [14.95 * J, 0.05], [16.4 * J, 0.06], [18.45 * J, 0.07], [21.85 * J, 0.08], [26 * J, 0.09], [27.7 * J, 0.1],
    [29.35 * J, 0.11], [31.45 * J, 0.12], [33.95 * J, 0.13], [37.1 * J, 0.14], [41.1 * J, 0.15], [45.8 * J, 0.16], [49.5 * J, 0.17], [53.8 * J, 0.18],
    [58.5 * J, 0.19], [64 * J, 0.2], [71 * J, 0.21], [80 * J, 0.22], [93 * J, 0.23], [109 * J, 0.24], [129 * J, 0.25], [163 * J, 0.26],
    [211 * J, 0.27], [374 * J, 0.28], [459 * J, 0.29], [555 * J, 0.3], [704 * J, 0.31], [957 * J, 0.32], [1_405 * J, 0.33], [Number.POSITIVE_INFINITY, 0.34],
  ],
  C: [
    [6.6 * J, 0], [6.95 * J, 0.0025], [7.35 * J, 0.005], [7.8 * J, 0.0075], [8.85 * J, 0.01], [9.8 * J, 0.0125], [10.95 * J, 0.015], [11.2 * J, 0.0175],
    [12.05 * J, 0.02], [12.95 * J, 0.03], [14.15 * J, 0.04], [15.55 * J, 0.05], [17.05 * J, 0.06], [19.5 * J, 0.07], [22.7 * J, 0.08], [26.6 * J, 0.09],
    [28.1 * J, 0.1], [30.1 * J, 0.11], [32.6 * J, 0.12], [35.4 * J, 0.13], [38.9 * J, 0.14], [43 * J, 0.15], [47.4 * J, 0.16], [51.2 * J, 0.17],
    [55.8 * J, 0.18], [60.4 * J, 0.19], [66.7 * J, 0.2], [74.5 * J, 0.21], [83.2 * J, 0.22], [95.6 * J, 0.23], [110 * J, 0.24], [134 * J, 0.25],
    [169 * J, 0.26], [221 * J, 0.27], [390 * J, 0.28], [463 * J, 0.29], [561 * J, 0.3], [709 * J, 0.31], [965 * J, 0.32], [1_419 * J, 0.33], [Number.POSITIVE_INFINITY, 0.34],
  ],
};
/** PTKP status → TER category (PP 58/2023 art. 2). */
export const PTKP_TER_CATEGORY: Record<string, "A" | "B" | "C"> = { "TK/0": "A", "TK/1": "A", "K/0": "A", "TK/2": "B", "TK/3": "B", "K/1": "B", "K/2": "B", "K/3": "C" };
export const PTKP_STATUSES = Object.keys(PTKP_TER_CATEGORY);
