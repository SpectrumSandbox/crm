/* Project Initiative & Compensation Policy v3.0 — constants. Currency: IDR (USD limits converted at FX_USD_IDR). */
import type { EmploymentType, ProjectRole, ProjectType, RiskCategory } from "./types";

export const POLICY_VERSION = "3.0";
export const POLICY_EFFECTIVE = "2026-04-01";

/** Finance-set conversion for the policy's USD-denominated limits. */
export const FX_USD_IDR = 16_500;
export const usd = (n: number) => n * FX_USD_IDR;

export const PROJECT_TYPE_META: Record<ProjectType, { label: string; short: string; description: string; share: number; range: [number, number]; capacityFactor: number; color: "cyan" | "yellow" | "magenta" }> = {
  A: {
    label: "Type A · Pure Consulting",
    short: "Consulting",
    description: "Advice, analysis, design or other intellectual output without physical deliverables.",
    share: 0.5,
    range: [0.1, 0.6],
    capacityFactor: 0.25,
    color: "cyan",
  },
  B: {
    label: "Type B · Engineering Services",
    short: "Engineering",
    description: "Installation, commissioning, custom engineering, EPC, system integration — moderate company investment.",
    share: 0.3,
    range: [0.1, 0.4],
    capacityFactor: 0.5,
    color: "yellow",
  },
  C: {
    label: "Type C · Product Development & Manufacturing",
    short: "Product",
    description: "Fabrication, manufacturing, product development or physical products needing substantial capital.",
    share: 0.3,
    range: [0.1, 0.4],
    capacityFactor: 1.0,
    color: "magenta",
  },
};

export const ROLE_META: Record<ProjectRole, { label: string; weight: number; leadership: boolean; description: string }> = {
  initiator: { label: "Project Initiator", weight: 0.5, leadership: false, description: "Originator of the idea, business development, client acquisition" },
  project_lead: { label: "Project Lead", weight: 2.0, leadership: true, description: "Delivery, client relations, budget, team coordination" },
  technical_lead: { label: "Technical Lead", weight: 2.0, leadership: true, description: "Technical direction, QA, design oversight" },
  engineer: { label: "Engineer", weight: 1.0, leadership: false, description: "Technical execution, analysis, design, documentation" },
  secretary: { label: "Project Secretary", weight: 1.0, leadership: false, description: "Administration, scheduling, documentation" },
  specialist: { label: "Specialist", weight: 2.0, leadership: false, description: "Domain expertise (QA/QC, procurement…) — weight 1.5–2.5" },
};
export const SPECIALIST_RANGE: [number, number] = [1.5, 2.5];

export const EMPLOYMENT_META: Record<EmploymentType, { label: string; eligible: boolean }> = {
  full_time_permanent: { label: "Full-time permanent", eligible: true },
  probationary: { label: "Full-time · probation", eligible: true },
  part_time: { label: "Part-time", eligible: false },
  fixed_term_contract: { label: "Fixed-term contract", eligible: false },
  contractor: { label: "Contractor / consultant", eligible: false },
  intern: { label: "Intern / trainee", eligible: false },
  temporary: { label: "Temporary / seasonal", eligible: false },
  secondment: { label: "On secondment", eligible: false },
};

export const RISK_CATEGORIES: Record<RiskCategory, string> = {
  technical: "Technical",
  schedule: "Schedule",
  financial: "Financial",
  operational: "Operational",
  reputation: "Reputation",
};

export const POLICY = {
  corporateTaxRate: 0.22, // §3.4
  leadershipCapacity: 2.0, // §5.1
  maxConcurrentMemberships: 3, // §5.1 (recommended)
  poolCapEbitdaPct: 0.05, // §6.2
  poolCapAbsolute: usd(500_000),
  personAnnualCapOfSalary: 2.0, // 200 %
  deferral: { pct: 0.3, netRevenueThreshold: usd(200_000), paymentTermsDays: 90, minMonths: 6, maxMonths: 12 }, // §6.3
  clawback: { windowMonths: 24, maxSalaryDeductionPct: 0.2, minMonths: 6, maxMonths: 12, dataErrorDeMinimis: usd(10_000), disputeBusinessDays: 10 }, // §6.4
  sla: { acknowledgeBusinessDays: 1, decisionBusinessDays: 5, appealBusinessDays: 10, teamReviewBusinessDays: 5, applicationBusinessDays: 3 }, // §2.3, §7.1
  breakEvenDeadlineDay: 25, // §6.1
  paymentDay: 5, // bonuses for month M paid on the 5th of M+1 (§10.6)
  unpaidLeaveMaxDays: 30,
  retirementNoticeDays: 60,
  shareAdjustmentNoticeDays: 30, // §6.6
  taxVarianceReviewPct: 0.15,
  removalWarningDays: { verbal: 14, written: 7 }, // §5.3
};
