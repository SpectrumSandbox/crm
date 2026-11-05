/*
 * Demo data for the Project Initiative & Compensation module (Policy v4.0). All figures IDR, all demo people fictional.
 * Projects approved before v4.0 keep their v3.0 flat share (§15.1); everything else uses the v4.0 curve.
 * Bonus runs are produced by the pure engine so stored runs are exactly what the UI would compute.
 * Must not import ../seed (that module imports this one).
 */
import type { AuditEntry, BonusRun, Clawback, CurveAdjustment, DeferredBonus, EmployeeProfile, Initiative, InitiativeMember, ProbationOutcome, ProjectRole, RevenueEntry, TeamAmendment } from "./types";
import { carriedForward, clawbackAmount, clawbackSchedule, computeRun, cycleMonth, deferralVestDate, paymentDate, projectCycles, releaseCheck } from "./engine";
import { ongoingProjects } from "./ongoing";

/* ───────────────────────── time & money helpers ───────────────────────── */

/** Anchor: Wed 4 Nov 2026, 09:00 WIB (UTC+7) — same as src/lib/seed.ts. */
const SEED_NOW = Date.UTC(2026, 10, 4, 2, 0, 0);
const DAY = 86_400_000;
const at = (days: number, hour = 9, minute = 0) => new Date(SEED_NOW + days * DAY + (hour - 9) * 3_600_000 + minute * 60_000).toISOString();
const pad = (n: number) => String(n).padStart(2, "0");
/** Absolute WIB wall-clock time → ISO (UTC). */
const wib = (date: string, hour = 9, minute = 0) => new Date(`${date}T${pad(hour)}:${pad(minute)}:00+07:00`).toISOString();

const M = 1_000_000;
const B = 1_000_000_000;

/* ───────────────────────── HR records (§3, §10, §11) ───────────────────────── */

const ACK = wib("2026-04-10", 10);

const profile = (userId: string, hireDate: string, annualBaseSalary: number, directManagerId: string | null, extra: Partial<EmployeeProfile> = {}): EmployeeProfile => ({
  userId,
  employmentType: "full_time_permanent",
  hireDate: wib(hireDate),
  probationEndDate: null,
  annualBaseSalary,
  directManagerId,
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
  acknowledgmentSignedAt: ACK,
  governanceRoles: [],
  ...extra,
});

export const employeeProfiles: EmployeeProfile[] = [
  profile("u-ben", "2015-02-02", 2_400 * M, null, { governanceRoles: ["prc", "ceo", "executive_committee"] }),
  profile("u-rani", "2019-03-04", 960 * M, "u-ben", { governanceRoles: ["prc"] }),
  profile("u-arif", "2021-06-14", 600 * M, "u-rani"),
  profile("u-sinta", "2020-09-07", 600 * M, "u-rani"),
  profile("u-yoga", "2021-01-11", 480 * M, "u-ben"),
  profile("u-putri", "2022-04-04", 450 * M, "u-yoga"),
  profile("u-fajar", "2018-08-01", 900 * M, "u-ben", { governanceRoles: ["prc"] }),
  profile("u-dimas", "2022-02-07", 540 * M, "u-fajar"),
  profile("u-nadia", "2023-03-06", 540 * M, "u-fajar"),
  profile("u-kevin", "2022-10-03", 600 * M, "u-fajar"),
  profile("u-ayu", "2021-11-01", 540 * M, "u-fajar"),
  profile("u-bima", "2023-07-03", 420 * M, "u-fajar", {
    resignationNoticeAt: wib("2026-10-20", 10),
    separation: { kind: "resignation", effectiveAt: wib("2026-11-20", 17), recordedAt: wib("2026-10-20", 10) },
  }),
  profile("u-maria", "2019-11-04", 1_200 * M, "u-ben", { governanceRoles: ["prc", "cfo", "finance", "executive_committee"] }),
  profile("u-dina", "2022-05-09", 480 * M, "u-ben", { governanceRoles: ["hr"] }),
  profile("u-lia", "2024-08-05", 300 * M, "u-fajar", { acknowledgmentSignedAt: null }),
  profile("u-rafi", "2026-09-01", 216 * M, "u-fajar", { employmentType: "probationary", probationEndDate: wib("2026-12-01", 17), acknowledgmentSignedAt: wib("2026-09-02", 10) }),
  profile("u-tomi", "2026-03-16", 180 * M, "u-fajar", { employmentType: "fixed_term_contract", contractEndDate: wib("2027-03-15", 17) }),
];

/* ───────────────────────── initiatives (§4–§5) ───────────────────────── */

const defaults: Omit<Initiative, "id" | "title" | "type" | "status" | "initiatorId"> = {
  trackingNo: "",
  code: null,
  summary: "",
  valueProposition: "",
  scope: "",
  deliverables: "",
  exclusions: "",
  successCriteria: "",
  startDate: at(0),
  endDate: at(90),
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
  policyVersion: "4.0",
  origination: "personal",
  submittedAt: null,
  acknowledgedAt: null,
  primaryReviewerId: null,
  scores: null,
  decision: null,
  appeal: null,
  approvedAt: null,
  completedAt: null,
  epicId: null,
  createdAt: at(0),
  updatedAt: at(0),
};
const mk = (o: Partial<Initiative> & Pick<Initiative, "id" | "title" | "type" | "status" | "initiatorId">): Initiative => ({ ...defaults, ...o });

const demoInitiatives: Initiative[] = [
  mk({
    id: "ini-sbs-pdm",
    trackingNo: "PRC-2026-006",
    code: "PRJ-2026-004",
    title: "SBS Blast Furnace Predictive Maintenance",
    type: "B",
    status: "active",
    initiatorId: "u-arif",
    summary: "Instrument 42 critical blast-furnace assets at Sinar Baja with vibration and thermal sensing, stream the data to our IIoT platform and run anomaly detection that warns reliability engineers days before a failure.",
    valueProposition: "Largest single engineering contract of 2026 and a reference site for heavy industry. One avoided BF-2 blower trip (≈ Rp 9 B lost production) pays for the programme; opens the hot-strip-mill and OT-segmentation follow-ons already in the pipeline.",
    scope: "Sensor selection, mounting and calibration on 42 assets (blowers, cooling fans, stoves, conveyors); edge gateways and plant-network integration with OSIsoft PI; anomaly models per asset class; operator alert workflow and 24-month platform subscription.",
    deliverables: "42 instrumented assets with calibration certificates; PI tag mapping; anomaly model v1 with per-asset thresholds; alert runbook; FAT/SAT reports. Accepted when 40 of 42 assets stream ≥ 98 % of samples for 30 days and SAT is signed.",
    exclusions: "Mechanical repairs found by the system; replacement of plant PLCs; cybersecurity remediation of the OT network (separate proposal d-sbs-ot).",
    successCriteria: "≥ 98 % data availability; ≤ 3 false alerts per asset per month after tuning; at least one validated early warning in the first 90 days; gross margin ≥ 55 %.",
    startDate: wib("2026-10-21"),
    endDate: wib("2027-02-26", 17),
    milestones: [
      { id: "ms-sbs-1", name: "BF-2 cooling & blower assets instrumented (14)", dueDate: wib("2026-10-30", 17), paymentAmount: 1_400 * M, done: true },
      { id: "ms-sbs-2", name: "BF-1 and hot-blast stoves instrumented (16)", dueDate: wib("2026-11-27", 17), paymentAmount: 1_200 * M, done: false },
      { id: "ms-sbs-3", name: "Remaining 12 assets + anomaly model tuning", dueDate: wib("2027-01-29", 17), paymentAmount: 2_300 * M, done: false },
      { id: "ms-sbs-4", name: "SAT sign-off and platform go-live", dueDate: wib("2027-02-26", 17), paymentAmount: 2_000 * M, done: false },
    ],
    companyId: "c-sbs",
    dealId: "d-sbs-pdm",
    contractStatus: "signed",
    paymentTermsDays: 60,
    revenue: { expected: 6_900 * M, best: 7_400 * M, worst: 6_200 * M },
    costs: { materials: 1_400 * M, subcontractors: 350 * M, equipment: 200 * M, travel: 120 * M, other: 80 * M, contingencyPct: 10 },
    risks: [
      { id: "rk-sbs-1", category: "operational", description: "Sensor installation needs furnace-side access during planned outages only.", mitigation: "Install schedule locked to SBS outage calendar; pre-assembled mounting kits to halve time on site.", level: "high" },
      { id: "rk-sbs-2", category: "technical", description: "Alert storms after furnace restarts erode operator trust.", mitigation: "Warm-up suppression windows and per-asset thresholds before go-live (IOT-205/206).", level: "medium" },
      { id: "rk-sbs-3", category: "financial", description: "Sensor prices exposed to USD movements.", mitigation: "Supplier quotes fixed in IDR for the first two batches; 10 % contingency.", level: "low" },
    ],
    deferralMonths: 6,
    lockedSharePct: 0.3, // v3.0 flat Type B share kept (§15.1)
    policyVersion: "3.0",
    submittedAt: wib("2026-10-06", 14),
    acknowledgedAt: wib("2026-10-07", 10),
    primaryReviewerId: "u-fajar",
    scores: { feasibility: 4, profitability: 5, resources: 3, strategic: 5, risk: 3, notes: "Strong margin; resourcing tight because Dimas also technical-leads SPL. Net revenue above US$200k → 30 % deferral applies." },
    decision: { outcome: "approved", rationale: "Signed client with payment history, margin well above threshold, strategic reference site.", conditions: "", conditionsDueAt: null, votesFor: 4, votesAgainst: 0, ceoVeto: false, decidedAt: wib("2026-10-20", 15), decidedById: "u-ben" },
    approvedAt: wib("2026-10-20", 15),
    epicId: "e-pdm",
    createdAt: wib("2026-09-29", 11),
    updatedAt: wib("2026-11-03", 16),
  }),
  mk({
    id: "ini-spl-crane",
    trackingNo: "PRC-2026-004",
    code: "PRJ-2026-003",
    title: "SPL Crane Telemetry Phase 2",
    type: "B",
    status: "active",
    initiatorId: "u-rani",
    summary: "Extend the Phase 1 ship-to-shore crane telemetry at Priok Terminal to all 18 rubber-tyred gantries, with edge gateways that buffer data through cellular dropouts and feed the existing dashboards.",
    valueProposition: "Protects and grows our largest recurring IIoT account; Phase 2 is the prerequisite for the Terminal Digital Twin (d-spl-twin, Rp 4.75 B) and the platform renewal.",
    scope: "Gateway installation on RTG-01 to RTG-18 in three batches; 72-hour store-and-forward buffering; PLC tag mapping; dashboard extension; operator training for the terminal engineering team.",
    deliverables: "18 RTGs streaming to the platform; batch handover packs; buffering firmware; training records. Accepted per batch once each crane streams ≥ 99 % of samples for 14 days.",
    exclusions: "Crane PLC upgrades; civil works; Navis N4 integration (Digital Twin scope).",
    successCriteria: "≥ 99 % telemetry completeness per RTG; zero unplanned crane downtime caused by installation; batch handovers on schedule.",
    startDate: wib("2026-10-01"),
    endDate: wib("2027-01-29", 17),
    milestones: [
      { id: "ms-spl-1", name: "Batch 1 — RTG-01 to RTG-06 live", dueDate: wib("2026-10-23", 17), paymentAmount: 1_100 * M, done: true },
      { id: "ms-spl-2", name: "Batch 2 — RTG-07 to RTG-12 live", dueDate: wib("2026-11-27", 17), paymentAmount: 950 * M, done: false },
      { id: "ms-spl-3", name: "Batch 3 — RTG-13 to RTG-18 + final handover", dueDate: wib("2027-01-29", 17), paymentAmount: 1_250 * M, done: false },
    ],
    companyId: "c-spl-tpk",
    dealId: "d-spl-crane",
    contractStatus: "signed",
    paymentTermsDays: 45,
    revenue: { expected: 3_300 * M, best: 3_500 * M, worst: 3_000 * M },
    costs: { materials: 720 * M, subcontractors: 300 * M, equipment: 60 * M, travel: 90 * M, other: 30 * M, contingencyPct: 10 },
    risks: [
      { id: "rk-spl-1", category: "technical", description: "Cellular dead zones in the yard cause overnight telemetry gaps (seen on RTG-07).", mitigation: "Store-and-forward buffer (IOT-202) and modem sleep-policy fix before batch 2.", level: "high" },
      { id: "rk-spl-2", category: "schedule", description: "Crane access windows depend on vessel schedules.", mitigation: "Weekly access plan agreed with terminal ops; two crews on call.", level: "medium" },
      { id: "rk-spl-3", category: "reputation", description: "Failed gateways after power cuts (GW-14) visible to client management.", mitigation: "Hardware watchdog + remote reboot path; field support SLA 12 h.", level: "medium" },
    ],
    lockedSharePct: 0.3, // v3.0 flat Type B share kept (§15.1)
    policyVersion: "3.0",
    submittedAt: wib("2026-09-15", 13),
    acknowledgedAt: wib("2026-09-16", 10),
    primaryReviewerId: "u-maria",
    scores: { feasibility: 5, profitability: 4, resources: 3, strategic: 4, risk: 4, notes: "Proven Phase 1 design. Reviewer is Finance because initiator and lead sit on the PRC." },
    decision: { outcome: "approved", rationale: "Repeat client, known design, healthy margin. Rani and Fajar recused.", conditions: "", conditionsDueAt: null, votesFor: 2, votesAgainst: 0, ceoVeto: false, decidedAt: wib("2026-09-28", 15), decidedById: "u-ben" },
    approvedAt: wib("2026-09-28", 15),
    epicId: "e-crane",
    createdAt: wib("2026-09-08", 10),
    updatedAt: wib("2026-11-02", 14),
  }),
  mk({
    id: "ini-cam-uas",
    trackingNo: "PRC-2026-002",
    code: "PRJ-2026-002",
    title: "CAM UAS Maintenance Certification Pack",
    type: "A",
    status: "completed",
    initiatorId: "u-sinta",
    summary: "Write the procedures, tooling lists and documentation Cakrawala Aerospace needs to have its new UAS maintenance line certified by the regulator, and coach their quality team through the audit.",
    valueProposition: "High-margin consulting that positions Spectrum as the UAS maintenance authority for Indonesian MROs and leads into the 2027 engineering retainer (d-cam-renew).",
    scope: "Gap analysis against the UAS maintenance requirements; maintenance manual and task cards; tooling and calibration list; training syllabus; audit preparation and mock audit.",
    deliverables: "Gap analysis report; UAS Maintenance Manual rev C; 64 task cards; tooling list; mock-audit report. Accepted on regulator approval of the manual.",
    exclusions: "Physical tooling supply; airframe-specific OEM data licences; staff training delivery beyond the train-the-trainer session.",
    successCriteria: "Manual approved without major findings; delivered within 14 weeks; client NPS ≥ 8.",
    startDate: wib("2026-07-27"),
    endDate: wib("2026-10-30", 17),
    milestones: [
      { id: "ms-cam-1", name: "Gap analysis & manual skeleton", dueDate: wib("2026-08-28", 17), paymentAmount: 460 * M, done: true },
      { id: "ms-cam-2", name: "Manual rev B + task cards", dueDate: wib("2026-09-25", 17), paymentAmount: 620 * M, done: true },
      { id: "ms-cam-3", name: "Mock audit & regulator submission", dueDate: wib("2026-10-30", 17), paymentAmount: 300 * M, done: true },
    ],
    companyId: "c-cam",
    dealId: "d-cam-uas",
    contractStatus: "signed",
    paymentTermsDays: 30,
    revenue: { expected: 1_380 * M, best: 1_450 * M, worst: 1_250 * M },
    costs: { materials: 0, subcontractors: 40 * M, equipment: 30 * M, travel: 25 * M, other: 14 * M, contingencyPct: 10 },
    risks: [
      { id: "rk-cam-1", category: "schedule", description: "Regulator review queue could push approval past contract end.", mitigation: "Early informal review of the manual skeleton with the regulator.", level: "medium" },
      { id: "rk-cam-2", category: "technical", description: "OEM torque tables conflict with legacy procedures.", mitigation: "Single source-of-truth table signed off by client engineering (ticket t-1004).", level: "low" },
    ],
    lockedSharePct: 0.5, // v3.0 flat Type A share kept (§15.1)
    policyVersion: "3.0",
    submittedAt: wib("2026-07-08", 11),
    acknowledgedAt: wib("2026-07-09", 9),
    primaryReviewerId: "u-fajar",
    scores: { feasibility: 5, profitability: 5, resources: 4, strategic: 4, risk: 4, notes: "Low-risk consulting; started under LOI, contract signed 5 Sep." },
    decision: { outcome: "approved", rationale: "Existing client, pure consulting, margin above 60 %.", conditions: "", conditionsDueAt: null, votesFor: 4, votesAgainst: 0, ceoVeto: false, decidedAt: wib("2026-07-24", 15), decidedById: "u-ben" },
    approvedAt: wib("2026-07-24", 15),
    completedAt: wib("2026-10-31", 16),
    createdAt: wib("2026-07-01", 10),
    updatedAt: wib("2026-11-03", 11),
  }),
  mk({
    id: "ini-nhs-seabed",
    trackingNo: "PRC-2026-001",
    code: "PRJ-2026-001",
    title: "NHS Seabed Classification Model",
    type: "A",
    status: "active",
    initiatorId: "u-sinta",
    summary: "Train a model that classifies multibeam backscatter into seabed classes for Nusantara Hydrographic, replacing days of manual interpretation per survey block, with a QC viewer for their hydrographers.",
    valueProposition: "First AI product sold into maritime survey; reusable model IP and a beachhead for the vessel retrofit and fleet renewals at our largest maritime customer.",
    scope: "Data audit of the 2025 campaign; labelling with NHS hydrographers; baseline and production models; QC viewer; S-57 attribute export; handover and retraining guide.",
    deliverables: "Baseline evaluation report; production model ≥ 85 % class accuracy; QC viewer; S-57 export; retraining guide. Accepted on NHS sign-off of two pilot blocks.",
    exclusions: "Survey acquisition; bathymetry processing; hosting beyond 12 months.",
    successCriteria: "≥ 85 % accuracy on held-out blocks; interpretation time per block reduced by 70 %; three payment milestones received.",
    startDate: wib("2026-07-13"),
    endDate: wib("2026-12-18", 17),
    milestones: [
      { id: "ms-nhs-1", name: "Baseline model on 2025 campaign data", dueDate: wib("2026-08-14", 17), paymentAmount: 700 * M, done: true },
      { id: "ms-nhs-2", name: "QC viewer + pilot classification of two blocks", dueDate: wib("2026-10-16", 17), paymentAmount: 500 * M, done: true },
      { id: "ms-nhs-3", name: "Production model, S-57 export and handover", dueDate: wib("2026-12-11", 17), paymentAmount: 900 * M, done: false },
    ],
    companyId: "c-nhs",
    dealId: null,
    contractStatus: "signed",
    paymentTermsDays: 120,
    revenue: { expected: 2_100 * M, best: 2_300 * M, worst: 1_900 * M },
    costs: { materials: 0, subcontractors: 60 * M, equipment: 45 * M, travel: 20 * M, other: 15 * M, contingencyPct: 15 },
    risks: [
      { id: "rk-nhs-1", category: "financial", description: "120-day payment terms delay cash and bonus distribution.", mitigation: "Milestone billing; §6.3 deferral applied; Finance chases invoices at day 90.", level: "medium" },
      { id: "rk-nhs-2", category: "technical", description: "Backscatter calibration differs between vessels.", mitigation: "Per-vessel normalisation layer and held-out validation by vessel.", level: "medium" },
      { id: "rk-nhs-3", category: "operational", description: "Labelling depends on NHS hydrographer availability.", mitigation: "Labelling sprints booked in advance; vendor pre-labelling for review.", level: "low" },
    ],
    deferralMonths: 6,
    lockedSharePct: 0.5, // v3.0 flat Type A share kept (§15.1)
    policyVersion: "3.0",
    submittedAt: wib("2026-06-24", 14),
    acknowledgedAt: wib("2026-06-25", 9),
    primaryReviewerId: "u-maria",
    scores: { feasibility: 4, profitability: 4, resources: 4, strategic: 5, risk: 3, notes: "Payment terms > 90 days — 30 % deferral for 6 months." },
    decision: { outcome: "approved", rationale: "Strategic AI reference with a key account; payment-term risk handled by deferral.", conditions: "", conditionsDueAt: null, votesFor: 4, votesAgainst: 0, ceoVeto: false, decidedAt: wib("2026-07-10", 15), decidedById: "u-ben" },
    approvedAt: wib("2026-07-10", 15),
    epicId: "e-seabed",
    createdAt: wib("2026-06-15", 10),
    updatedAt: wib("2026-10-30", 15),
  }),
  mk({
    id: "ini-nhs-asv",
    trackingNo: "PRC-2026-011",
    title: "NHS Autonomous Survey Vessel Retrofit",
    type: "C",
    status: "evaluation",
    standardBonus: 2_500_000, // proposed in the Role and Weight Agreement (§8.6)
    initiatorId: "u-sinta",
    summary: "Build and fit our autonomy retrofit kit v2 — autopilot, perception stack and remote-operations link — to two 9 m Nusantara Hydrographic survey launches, with a 12-month manufacturing warranty.",
    valueProposition: "First production order for the vessel autonomy kit; turns our R&D into a product with a warranty-backed reference customer and a path to fleet-wide orders.",
    scope: "Kit v2 fabrication (2 units + spares); integration and harbour trials; sea trials and acceptance on both vessels; operator training (12 seats); 12-month warranty support.",
    deliverables: "Two retrofitted vessels passing the acceptance test procedure; spares kit; operator certification; warranty plan.",
    exclusions: "Hull or propulsion modifications; survey sensor supply; vessel crew.",
    successCriteria: "Both vessels pass acceptance; ≥ 95 % autonomous line-keeping on survey runs; warranty claims < 5 % of contract value.",
    startDate: wib("2026-12-01"),
    endDate: wib("2027-05-28", 17),
    milestones: [
      { id: "ms-asv-1", name: "Kit v2 factory acceptance (2 units)", dueDate: wib("2027-01-29", 17), paymentAmount: 2_520 * M, done: false },
      { id: "ms-asv-2", name: "Vessel 1 sea trials & acceptance", dueDate: wib("2027-03-26", 17), paymentAmount: 2_940 * M, done: false },
      { id: "ms-asv-3", name: "Vessel 2 acceptance + operator training", dueDate: wib("2027-05-28", 17), paymentAmount: 2_940 * M, done: false },
    ],
    companyId: "c-nhs",
    dealId: "d-nhs-asv",
    contractStatus: "loi",
    paymentTermsDays: 60,
    revenue: { expected: 8_400 * M, best: 8_900 * M, worst: 7_600 * M },
    costs: { materials: 2_600 * M, subcontractors: 900 * M, equipment: 400 * M, travel: 180 * M, other: 120 * M, contingencyPct: 15 },
    risks: [
      { id: "rk-asv-1", category: "technical", description: "RTK multipath near quay walls (UAV-102) unresolved.", mitigation: "Dual-antenna heading and radar/camera fusion before factory acceptance.", level: "high" },
      { id: "rk-asv-2", category: "financial", description: "Warranty exposure on a first production run.", mitigation: "Warranty reserve of 4 % of revenue; 12-month bonus deferral.", level: "high" },
      { id: "rk-asv-3", category: "schedule", description: "Component lead times for perception sensors (12–16 weeks).", mitigation: "Long-lead items ordered on LOI at Spectrum risk, capped at Rp 600 M.", level: "medium" },
    ],
    warranty: true,
    deferralMonths: 12,
    submittedAt: wib("2026-11-02", 10),
    acknowledgedAt: wib("2026-11-03", 9, 30),
    primaryReviewerId: "u-fajar",
    // partial evaluation: 0 = not yet scored
    scores: { feasibility: 4, profitability: 0, resources: 3, strategic: 5, risk: 0, notes: "Profitability and risk pending Finance review of the warranty reserve. Dimas would reach 2.0/2.0 leadership capacity." },
    epicId: null,
    createdAt: wib("2026-10-12", 10),
    updatedAt: wib("2026-11-03", 14),
  }),
  mk({
    id: "ini-ptt-insp",
    trackingNo: "PRC-2026-012",
    title: "PTT Drone Tower Inspection Programme",
    type: "B",
    status: "submitted",
    initiatorId: "u-kevin",
    summary: "Automated drone inspection of 2,500 Pelita towers a year: generated flight plans, VTOL data capture and AI detection of corrosion, missing bolts and antenna defects, delivered as a maintenance work list.",
    valueProposition: "Productises the tower defect model (SWD-303) into a recurring programme with a 9,400-site tower company; engineer-originated idea from the AI team.",
    scope: "Flight-plan generator per tower type; four VTOL airframes with operators; defect detection model v2; inspection portal; integration with PTT maintenance ticketing.",
    deliverables: "2,500 inspected towers per year with defect reports; inspection portal; model accuracy report ≥ 90 % recall on corrosion.",
    exclusions: "Climbing repairs; RF performance testing; permits for restricted airspace sites.",
    successCriteria: "≥ 90 % corrosion recall; cost per tower 40 % below manual climb; 200 towers/month by month 3.",
    startDate: wib("2026-12-07"),
    endDate: wib("2027-11-30", 17),
    milestones: [
      { id: "ms-ptt-1", name: "Pilot: 100 towers in Jabodetabek", dueDate: wib("2027-01-29", 17), paymentAmount: 600 * M, done: false },
      { id: "ms-ptt-2", name: "Scale-up: 200 towers per month", dueDate: wib("2027-04-30", 17), paymentAmount: 2_400 * M, done: false },
      { id: "ms-ptt-3", name: "Year-1 completion (2,500 towers)", dueDate: wib("2027-11-30", 17), paymentAmount: 4_200 * M, done: false },
    ],
    companyId: "c-ptt",
    dealId: "d-ptt-insp",
    contractStatus: "none",
    newClient: true,
    paymentTermsDays: 60,
    revenue: { expected: 7_200 * M, best: 7_800 * M, worst: 5_900 * M },
    costs: { materials: 200 * M, subcontractors: 600 * M, equipment: 1_100 * M, travel: 350 * M, other: 150 * M, contingencyPct: 10 },
    risks: [
      { id: "rk-ptt-1", category: "technical", description: "Model recall on heavy corrosion below target in coastal sites.", mitigation: "Vendor labelling batch 2 (SWD-304) focused on coastal towers.", level: "medium" },
      { id: "rk-ptt-2", category: "operational", description: "Flight permits near airports and military zones.", mitigation: "Exclude restricted sites from year 1; PTT handles permits.", level: "medium" },
      { id: "rk-ptt-3", category: "financial", description: "New client without payment history.", mitigation: "Monthly billing; §6.3 deferral; credit check by Finance.", level: "medium" },
    ],
    submittedAt: at(0, 8),
    createdAt: wib("2026-10-27", 10),
    updatedAt: at(0, 8),
  }),
  mk({
    id: "ini-twu-nrw",
    trackingNo: "PRC-2026-007",
    title: "TWU Non-Revenue Water Analytics",
    type: "A",
    status: "conditional",
    lockedSharePct: 0.5, // decided under v3.0 — flat Type A share kept (§15.1)
    policyVersion: "3.0",
    initiatorId: "u-nadia",
    summary: "Fuse pressure and flow data across six district metered areas at Tirta Water to localise leaks and rank pipe segments for repair, cutting non-revenue water in the pilot DMAs.",
    valueProposition: "Opens the water-utility vertical; analytics IP reusable across municipal concessions; the leak-localisation POC (SWD-306) already shows promising results on DMA-3.",
    scope: "Data onboarding from ClearSCADA; sensor placement advice; leak localisation model per DMA; weekly repair priority list; quarterly NRW impact report.",
    deliverables: "Leak localisation model for 6 DMAs; weekly priority list; NRW impact reports; operator handover. Accepted when 70 % of top-10 flagged segments are confirmed by field crews.",
    exclusions: "Sensor hardware supply and installation (procured by TWU); pipe repairs.",
    successCriteria: "NRW reduced by 5 percentage points in pilot DMAs within 6 months; ≥ 70 % field confirmation rate.",
    startDate: wib("2026-11-16"),
    endDate: wib("2027-04-30", 17),
    milestones: [
      { id: "ms-twu-1", name: "Data onboarding & DMA baselines", dueDate: wib("2026-12-18", 17), paymentAmount: 600 * M, done: false },
      { id: "ms-twu-2", name: "Leak localisation live in 6 DMAs", dueDate: wib("2027-02-26", 17), paymentAmount: 1_000 * M, done: false },
      { id: "ms-twu-3", name: "6-month NRW impact report", dueDate: wib("2027-04-30", 17), paymentAmount: 800 * M, done: false },
    ],
    companyId: "c-twu",
    dealId: "d-twu-nrw",
    contractStatus: "loi",
    newClient: true,
    paymentTermsDays: 60,
    revenue: { expected: 2_400 * M, best: 2_600 * M, worst: 2_000 * M },
    costs: { materials: 0, subcontractors: 180 * M, equipment: 40 * M, travel: 60 * M, other: 30 * M, contingencyPct: 10 },
    risks: [
      { id: "rk-twu-1", category: "technical", description: "SCADA data quality (gaps, unsynchronised clocks).", mitigation: "Two-week data audit before model work; clock alignment in ingestion.", level: "medium" },
      { id: "rk-twu-2", category: "operational", description: "Field crews may not act on the priority list.", mitigation: "Weekly review with the NRW programme manager; confirmation tracked in the portal.", level: "medium" },
      { id: "rk-twu-3", category: "financial", description: "Municipal budget cycle may delay payments.", mitigation: "Milestones aligned to TWU budget releases; contingency raised per PRC condition.", level: "low" },
    ],
    submittedAt: wib("2026-10-14", 11),
    acknowledgedAt: wib("2026-10-15", 9),
    primaryReviewerId: "u-rani",
    scores: { feasibility: 4, profitability: 3, resources: 3, strategic: 4, risk: 3, notes: "Contingency light for a new client; no QA/QC cover on a model-heavy delivery." },
    decision: {
      outcome: "conditional",
      rationale: "Attractive new vertical and solid POC, but cost buffer and quality assurance are below standard for a first engagement with a new client.",
      conditions: "Raise contingency to 15% and add a QA/QC specialist before kickoff",
      conditionsDueAt: wib("2026-11-11", 17),
      votesFor: 3,
      votesAgainst: 1,
      ceoVeto: false,
      decidedAt: wib("2026-10-30", 15),
      decidedById: "u-ben",
    },
    createdAt: wib("2026-10-05", 10),
    updatedAt: wib("2026-10-30", 15),
  }),
  mk({
    id: "ini-mcd-light",
    trackingNo: "PRC-2026-010",
    title: "MCD Smart Streetlight Network",
    type: "B",
    status: "rejected",
    initiatorId: "u-dimas",
    summary: "Deploy 1,800 connected streetlight nodes with air-quality and flood sensors across Metro Cerdas's new township, on a LoRaWAN backbone with a city operations dashboard.",
    valueProposition: "Entry into smart-city infrastructure with a developer planning 1,200 ha of connected township; reusable node reference design (IOT-213).",
    scope: "Node reference design; 1,800 pole retrofits; LoRaWAN gateways; dashboard and alerting; 12-month maintenance.",
    deliverables: "1,800 live nodes; operations dashboard; maintenance plan. Accepted on 95 % node availability over 30 days.",
    exclusions: "Pole civil works; electricity supply; luminaire replacement.",
    successCriteria: "95 % node availability; flood alerts within 5 minutes; gross margin ≥ 25 %.",
    startDate: wib("2026-11-02"),
    endDate: wib("2027-03-31", 17),
    milestones: [
      { id: "ms-mcd-1", name: "Reference node design & pilot street (60 poles)", dueDate: wib("2026-12-18", 17), paymentAmount: 350 * M, done: false },
      { id: "ms-mcd-2", name: "Phase 1 rollout (1,800 poles)", dueDate: wib("2027-03-31", 17), paymentAmount: 1_600 * M, done: false },
    ],
    companyId: "c-mcd",
    dealId: "d-mcd-iot",
    contractStatus: "none",
    newClient: true,
    paymentTermsDays: 90,
    revenue: { expected: 1_950 * M, best: 2_200 * M, worst: 1_200 * M },
    costs: { materials: 900 * M, subcontractors: 350 * M, equipment: 80 * M, travel: 40 * M, other: 30 * M, contingencyPct: 10 },
    risks: [
      { id: "rk-mcd-1", category: "financial", description: "Discovery-stage client with no LOI or payment history.", mitigation: "Require LOI and 20 % advance before procurement.", level: "high" },
      { id: "rk-mcd-2", category: "technical", description: "Flood sensors untested in Bekasi drainage conditions.", mitigation: "Pilot street before committing to full rollout.", level: "medium" },
    ],
    submittedAt: wib("2026-10-21", 13),
    acknowledgedAt: wib("2026-10-22", 9),
    primaryReviewerId: "u-maria",
    scores: { feasibility: 3, profitability: 2, resources: 2, strategic: 3, risk: 2, notes: "Projected margin ~10 % after pool; Dimas has no leadership capacity left." },
    decision: {
      outcome: "rejected",
      rationale: "Discovery-stage client without LOI; projected company margin below the 15 % threshold after the bonus pool; lead engineer at leadership capacity.",
      conditions: "",
      conditionsDueAt: null,
      votesFor: 1,
      votesAgainst: 3,
      ceoVeto: false,
      decidedAt: wib("2026-10-28", 15),
      decidedById: "u-ben",
    },
    appeal: {
      filedAt: wib("2026-10-31", 11),
      filedById: "u-dimas",
      reason: "New information: Metro Cerdas expects to issue an LOI with a 20 % advance in November, and a cheaper node BOM lifts projected margin to ~22 %. Requesting re-evaluation.",
      status: "pending",
      decidedAt: null,
      notes: "",
    },
    createdAt: wib("2026-10-12", 10),
    updatedAt: wib("2026-10-31", 11),
  }),
  mk({
    id: "ini-academy",
    title: "Spectrum UAV Operator Academy",
    type: "A",
    status: "draft",
    initiatorId: "u-ben",
    summary: "Package our operator and maintenance courses into an accredited academy offering open-enrolment classes to survey, plantation and MRO clients.",
    valueProposition: "Recurring training revenue with almost no capital; every trained operator is a future fleet customer. Builds on CAM and AAM training demand.",
    scope: "Curriculum, accreditation, two classrooms and a flight range.",
    deliverables: "",
    exclusions: "",
    successCriteria: "",
    startDate: wib("2027-01-11"),
    endDate: wib("2027-06-30", 17),
    milestones: [
      { id: "ms-acd-1", name: "Curriculum & accreditation application", dueDate: wib("2027-02-26", 17), paymentAmount: 0, done: false },
      { id: "ms-acd-2", name: "First open-enrolment cohort", dueDate: wib("2027-04-23", 17), paymentAmount: 0, done: false },
    ],
    companyId: null,
    dealId: null,
    revenue: { expected: 900 * M, best: 1_200 * M, worst: 600 * M },
    costs: { materials: 0, subcontractors: 0, equipment: 150 * M, travel: 0, other: 120 * M, contingencyPct: 10 },
    risks: [{ id: "rk-acd-1", category: "operational", description: "Accreditation timeline outside our control.", mitigation: "", level: "medium" }],
    createdAt: wib("2026-10-26", 20),
    updatedAt: at(-1, 21),
  }),
];

/** Demo samples are flagged so the ongoing-projects register shows real projects only. */
export const initiatives: Initiative[] = [...demoInitiatives.map((d) => ({ ...d, demo: true })), ...ongoingProjects];

/* ───────────────────────── teams (§4, §7) ───────────────────────── */

const mem = (id: string, initiativeId: string, userId: string, roles: ProjectRole[], joinedAt: string, extra: Partial<InitiativeMember> = {}): InitiativeMember => ({
  id,
  initiativeId,
  userId,
  roles,
  specialistWeight: null,
  weightOverride: null,
  consent: "accepted",
  managerApproved: true,
  prcApproved: true,
  application: false,
  allocationPct: 20,
  joinedAt,
  leftAt: null,
  removal: { stage: "none", updatedAt: null, note: "" },
  allocationFactor: 1,
  authority: "Role and Weight Agreement (Annex D Part 1)",
  ...extra,
});
const pendingTeam = { prcApproved: false } as const;

export const initiativeMembers: InitiativeMember[] = [
  // SBS — Arif initiates, delegates Project Lead to Dimas (§2.4)
  mem("im-sbs-arif", "ini-sbs-pdm", "u-arif", ["initiator"], wib("2026-09-29", 11), { allocationPct: 10 }),
  mem("im-sbs-dimas", "ini-sbs-pdm", "u-dimas", ["project_lead"], wib("2026-09-29", 11), { allocationPct: 40 }),
  mem("im-sbs-kevin", "ini-sbs-pdm", "u-kevin", ["technical_lead"], wib("2026-09-29", 11), { allocationPct: 30 }),
  mem("im-sbs-nadia", "ini-sbs-pdm", "u-nadia", ["engineer"], wib("2026-09-29", 11), { allocationPct: 25 }),
  mem("im-sbs-rafi", "ini-sbs-pdm", "u-rafi", ["engineer"], wib("2026-10-01", 0), { allocationPct: 60, application: true, authority: "Amendment am-sbs-1 (passed 4 of 5)" }),
  mem("im-sbs-lia", "ini-sbs-pdm", "u-lia", ["secretary"], wib("2026-09-29", 11), { allocationPct: 20, allocationFactor: 0.5, weightNote: "Secretary for two projects at once — half the usual time (§6.4)" }),
  // SPL
  mem("im-spl-rani", "ini-spl-crane", "u-rani", ["initiator"], wib("2026-09-08", 10), { allocationPct: 10 }),
  mem("im-spl-fajar", "ini-spl-crane", "u-fajar", ["project_lead"], wib("2026-09-08", 10), { allocationPct: 25 }),
  mem("im-spl-dimas", "ini-spl-crane", "u-dimas", ["technical_lead"], wib("2026-09-08", 10), { allocationPct: 30 }),
  mem("im-spl-nadia", "ini-spl-crane", "u-nadia", ["engineer"], wib("2026-09-08", 10), { allocationPct: 20 }),
  mem("im-spl-bima", "ini-spl-crane", "u-bima", ["specialist"], wib("2026-09-08", 10), { specialistWeight: 1.5, allocationPct: 20 }),
  // CAM
  mem("im-cam-sinta", "ini-cam-uas", "u-sinta", ["initiator", "project_lead"], wib("2026-07-01", 10), { allocationPct: 30 }),
  mem("im-cam-bima", "ini-cam-uas", "u-bima", ["technical_lead"], wib("2026-07-01", 10), { allocationPct: 40 }),
  mem("im-cam-ayu", "ini-cam-uas", "u-ayu", ["engineer"], wib("2026-07-01", 10), { allocationPct: 25 }),
  mem("im-cam-lia", "ini-cam-uas", "u-lia", ["secretary"], wib("2026-07-01", 10), { allocationPct: 20, allocationFactor: 0.5, weightNote: "Shared with SBS document control (§6.4)" }),
  // NHS seabed — Kevin holds both leadership roles (counts once for capacity)
  mem("im-nhs-sinta", "ini-nhs-seabed", "u-sinta", ["initiator"], wib("2026-06-15", 10), { allocationPct: 10 }),
  mem("im-nhs-kevin", "ini-nhs-seabed", "u-kevin", ["project_lead", "technical_lead"], wib("2026-06-15", 10), { allocationPct: 40 }),
  mem("im-nhs-nadia", "ini-nhs-seabed", "u-nadia", ["engineer"], wib("2026-06-15", 10), { allocationPct: 25 }),
  // NHS ASV — under evaluation, team not yet PRC-approved
  mem("im-asv-sinta", "ini-nhs-asv", "u-sinta", ["initiator"], wib("2026-10-12", 10), { ...pendingTeam, allocationPct: 10 }),
  mem("im-asv-ayu", "ini-nhs-asv", "u-ayu", ["project_lead"], wib("2026-10-12", 10), { ...pendingTeam, allocationPct: 50 }),
  mem("im-asv-dimas", "ini-nhs-asv", "u-dimas", ["technical_lead"], wib("2026-10-12", 10), { ...pendingTeam, allocationPct: 30 }),
  mem("im-asv-rafi", "ini-nhs-asv", "u-rafi", ["engineer"], wib("2026-10-19", 10), { ...pendingTeam, consent: "pending", managerApproved: false, allocationPct: 30 }),
  mem("im-asv-kevin", "ini-nhs-asv", "u-kevin", ["specialist"], wib("2026-10-12", 10), { ...pendingTeam, specialistWeight: 2.0, allocationPct: 15 }),
  // PTT — engineer-originated
  mem("im-ptt-kevin", "ini-ptt-insp", "u-kevin", ["initiator", "technical_lead"], wib("2026-10-27", 10), { ...pendingTeam, allocationPct: 30 }),
  mem("im-ptt-fajar", "ini-ptt-insp", "u-fajar", ["project_lead"], wib("2026-10-27", 10), { ...pendingTeam, allocationPct: 20 }),
  mem("im-ptt-ayu", "ini-ptt-insp", "u-ayu", ["engineer"], wib("2026-10-28", 10), { ...pendingTeam, consent: "pending", managerApproved: false, allocationPct: 25 }),
  // TWU — conditional approval
  mem("im-twu-nadia", "ini-twu-nrw", "u-nadia", ["initiator", "project_lead"], wib("2026-10-05", 10), { ...pendingTeam, allocationPct: 35 }),
  mem("im-twu-kevin", "ini-twu-nrw", "u-kevin", ["technical_lead"], wib("2026-10-05", 10), { ...pendingTeam, allocationPct: 20 }),
  mem("im-twu-yoga", "ini-twu-nrw", "u-yoga", ["secretary"], wib("2026-10-05", 10), { ...pendingTeam, allocationPct: 10 }),
  // MCD — rejected, under appeal
  mem("im-mcd-dimas", "ini-mcd-light", "u-dimas", ["initiator", "project_lead"], wib("2026-10-12", 10), { ...pendingTeam, allocationPct: 30 }),
  // Academy — draft
  mem("im-acd-ben", "ini-academy", "u-ben", ["initiator", "project_lead"], wib("2026-10-26", 20), { ...pendingTeam, allocationPct: 10 }),
];

/* ───────────────────────── client payments (§8.1) ───────────────────────── */

/** Payment entry: `collectedAt` sets the salary cycle (cut-off on the 20th, §8.2); the work period defaults to the billed month. */
const pay = (id: string, initiativeId: string, workMonth: string, revenue: number, directCosts: number, basis: RevenueEntry["basis"], collected: string | null, note: string, cycle?: string): RevenueEntry => ({
  id,
  initiativeId,
  // §8.2 cut-off on the 20th, moved to the previous business day for weekends and holidays
  month: cycle ?? (collected ? cycleMonth(wib(collected, 10)) : workMonth),
  revenue,
  directCosts,
  basis,
  received: collected != null,
  collectedAt: collected ? wib(collected, 10) : null,
  workPeriodStart: wib(`${workMonth}-01`, 0),
  workPeriodEnd: lastDay(workMonth),
  note,
});
function lastDay(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 1) - 7 * 3_600_000 - 1).toISOString();
}

export const revenueEntries: RevenueEntry[] = [
  pay("rev-cam-2026-08", "ini-cam-uas", "2026-07", 460 * M, 40 * M, "recognized", "2026-08-14", "Gap analysis & manual skeleton — billed July, collected 14 Aug"),
  pay("rev-cam-2026-09", "ini-cam-uas", "2026-08", 620 * M, 55 * M, "recognized", "2026-09-11", "Manual rev B + task cards — billed August, collected 11 Sep"),
  pay("rev-cam-2026-10", "ini-cam-uas", "2026-09", 300 * M, 25 * M, "recognized", "2026-10-16", "Mock audit & submission — collected 16 Oct; project completed"),
  { ...pay("rev-nhs-2026-08", "ini-nhs-seabed", "2026-07", 700 * M, 60 * M, "milestone", "2026-08-19", "Milestone 1 — baseline model accepted, collected 19 Aug"), workPeriodStart: wib("2026-07-13", 0), workPeriodEnd: wib("2026-08-07", 17) },
  { ...pay("rev-nhs-2026-10", "ini-nhs-seabed", "2026-10", 500 * M, 30 * M, "milestone", null, "Milestone 2 — accepted, invoice outstanding (120-day terms); bonus follows collection (§8.1)"), workPeriodStart: wib("2026-08-08", 0), workPeriodEnd: wib("2026-10-09", 17) },
  pay("rev-spl-2026-10", "ini-spl-crane", "2026-10", 1_100 * M, 420 * M, "recognized", "2026-10-20", "Batch 1 — RTG-01 to RTG-06, collected 20 Oct (inside the cut-off)"),
  pay("rev-spl-2026-11", "ini-spl-crane", "2026-11", 950 * M, 380 * M, "recognized", null, "Batch 2 — billed on completion; not yet collected"),
  pay("rev-sbs-2026-10", "ini-sbs-pdm", "2026-10", 1_400 * M, 650 * M, "recognized", "2026-10-15", "BF-2 cooling & blower assets — 20% advance counted once the work was delivered (§8.1)"),
  pay("rev-sbs-2026-11", "ini-sbs-pdm", "2026-11", 1_200 * M, 520 * M, "recognized", null, "BF-1 & stoves — billed on completion; not yet collected"),
];

/* ───────────────────────── monthly cycles (§8.2, §9.1) — computed by the engine ───────────────────────── */

/** Finance's rolling three-month company figures, cash and fixed costs for each cycle (§9.1). */
const RUN_PLAN: { month: string; companyRevenue: number; directCosts: number; overheads: number; cash: number; fixedCostsMonthly: number; certifiedAt: string; releasedAt: string | null }[] = [
  { month: "2026-08", companyRevenue: 6_100 * M, directCosts: 1_250 * M, overheads: 3_900 * M, cash: 5_200 * M, fixedCostsMonthly: 1_300 * M, certifiedAt: wib("2026-08-21", 16), releasedAt: wib("2026-08-24", 11) },
  { month: "2026-09", companyRevenue: 6_400 * M, directCosts: 1_300 * M, overheads: 3_950 * M, cash: 5_050 * M, fixedCostsMonthly: 1_300 * M, certifiedAt: wib("2026-09-23", 16), releasedAt: wib("2026-09-24", 11) },
  { month: "2026-10", companyRevenue: 7_200 * M, directCosts: 1_900 * M, overheads: 4_000 * M, cash: 5_400 * M, fixedCostsMonthly: 1_350 * M, certifiedAt: wib("2026-10-23", 16), releasedAt: null },
];

export const bonusRuns: BonusRun[] = (() => {
  const runs: BonusRun[] = [];
  for (const plan of RUN_PLAN) {
    const r = computeRun({ ...plan, initiatives, members: initiativeMembers, entries: revenueEntries, profiles: employeeProfiles, adjustments: [], carriedIn: carriedForward(runs, plan.month), runs: [...runs] });
    // §13.1 PRC members on a team in this run are recused from its release
    const recused = releaseCheck({ status: "certified", month: plan.month, lines: r.lines, certifiedById: "u-maria" }, { profiles: employeeProfiles, actorId: "u-ben", atIso: plan.releasedAt ?? plan.certifiedAt }).recused;
    runs.push({
      id: `run-${plan.month}`,
      month: plan.month,
      status: plan.releasedAt ? "released" : "certified",
      policyVersion: "4.0",
      companyRevenue: plan.companyRevenue,
      directCosts: plan.directCosts,
      overheads: plan.overheads,
      cash: plan.cash,
      fixedCostsMonthly: plan.fixedCostsMonthly,
      operatingResult: r.operatingResult,
      cashAfter: r.cashAfter,
      payoutPct: r.payoutPct,
      totals: r.totals,
      lines: r.lines,
      certifiedById: "u-maria",
      certifiedAt: plan.certifiedAt,
      releasedById: plan.releasedAt ? "u-ben" : null,
      releasedAt: plan.releasedAt,
      preparedById: "u-maria",
      recordedById: "u-maria",
      approvals: plan.releasedAt ? [{ userId: "u-ben", vote: "for", at: plan.releasedAt }] : [],
      recusedIds: plan.releasedAt ? recused : [],
      entryIds: r.entryIds ?? [],
      lateReleaseReason: null,
    });
  }
  return runs;
})();

/* ───────────────────────── ledgers (§9.3, §9.4, §11) ───────────────────────── */

export const deferredBonuses: DeferredBonus[] = bonusRuns
  .filter((r) => r.status === "released")
  .flatMap((r) =>
    r.lines
      .filter((l) => l.deferred > 0)
      .map((l) => ({
        id: `def-${r.month}-${l.initiativeId.replace(/^ini-/, "")}-${l.userId.replace(/^u-/, "")}`,
        month: r.month,
        initiativeId: l.initiativeId,
        userId: l.userId,
        amount: l.deferred,
        vestAt: deferralVestDate(initiatives.find((i) => i.id === l.initiativeId)!),
        status: "pending" as const,
        releasedAmount: 0,
        collectedAt: l.lastCollectedAt ?? null,
        workStart: l.firstWorkStart ?? null,
        payMonth: null,
        note: "High-risk deferral, released 6–12 months after project close (§9.3)",
      })),
  );

export const probationOutcomes: ProbationOutcome[] = [];

/** CAM disputed Rp 120 M of the September invoice → credit note; September payment restated at Rp 500 M (costs unchanged). */
export const clawbacks: Clawback[] = (() => {
  const cam = initiatives.find((i) => i.id === "ini-cam-uas")!;
  const restated = revenueEntries.map((e) => (e.id === "rev-cam-2026-09" ? { ...e, revenue: 500 * M } : e));
  const ctx = (entries: RevenueEntry[]) => ({ members: initiativeMembers, entries, profiles: employeeProfiles });
  const share = (entries: RevenueEntry[]) => projectCycles(cam, ctx(entries), "2026-09").find((c) => c.month === "2026-09")?.members.find((m) => m.userId === "u-sinta")?.revShare ?? 0;
  // the bonus allocated to Sinta for that cycle (paid now + deferred) vs the bonus on corrected figures (§9.4 "Amount")
  const originalPaid = bonusRuns.find((r) => r.month === "2026-09")?.lines.find((l) => l.initiativeId === cam.id && l.userId === "u-sinta")?.gross ?? share(revenueEntries);
  const recalculated = share(restated);
  const salary = employeeProfiles.find((p) => p.userId === "u-sinta")!.annualBaseSalary;
  const base = { trigger: "revenue_reversal" as const, originalPaid, recalculated, personallyAtFault: false };
  const schedule = clawbackSchedule(clawbackAmount(base), salary);
  return [
    {
      id: "cb-1",
      userId: "u-sinta",
      initiativeId: cam.id,
      ...base,
      paidAt: paymentDate("2026-09"),
      writtenAgreement: false,
      status: "identified",
      notifiedAt: null,
      months: schedule.months,
      monthlyDeduction: schedule.monthly,
      recovered: 0,
      notes: "CAM disputed Rp 120 M of the September invoice (task cards outside the agreed scope) and a credit note was issued — a revenue reversal (§9.4). The September payment is restated from Rp 620 M to Rp 500 M with costs unchanged; Sinta's 2.5 / 6.5 share of that cycle's pool is recalculated. Recovery order: deferred and carried-forward amounts, then future project bonuses, and only then salary with her written agreement. Other team members' differences are pending Finance review.",
      createdAt: wib("2026-11-03", 15),
      triggeredAt: wib("2026-11-02", 11),
    },
  ];
})();

/** §9.5 curve changes — none announced; the curve in force is 40 % → 10 % at Rp1.5 billion. */
export const curveAdjustments: CurveAdjustment[] = [];

/* ───────────────────────── team amendments (§6.8) ───────────────────────── */

export const teamAmendments: TeamAmendment[] = [
  {
    id: "am-sbs-1",
    initiativeId: "ini-sbs-pdm",
    proposedById: "u-dimas",
    circulatedAt: wib("2026-09-29", 15),
    effectiveDate: wib("2026-10-01", 0),
    reason: "Vibration data labelling for BF-2 needs a second engineer; Rafi has the signal-processing background.",
    change: { kind: "add", userId: "u-rafi", roles: ["engineer"], specialistWeight: null, weightOverride: null, allocationFactor: 1, consent: true },
    votes: [
      { userId: "u-dimas", vote: "for", at: wib("2026-09-29", 15) },
      { userId: "u-arif", vote: "for", at: wib("2026-09-29", 16) },
      { userId: "u-kevin", vote: "for", at: wib("2026-09-30", 9) },
      { userId: "u-nadia", vote: "for", at: wib("2026-09-30", 10) },
    ],
    status: "passed",
    prcDecision: null,
    recordedAt: wib("2026-09-30", 14),
  },
  {
    id: "am-spl-1",
    initiativeId: "ini-spl-crane",
    proposedById: "u-fajar",
    circulatedAt: wib("2026-11-02", 10),
    effectiveDate: wib("2026-11-20", 17),
    reason: "Bima's last working day is 20 Nov (resignation). His procurement specialist role ends that day; payments for work before then are still his (§6.5, §10).",
    change: { kind: "remove", memberId: "im-spl-bima" },
    votes: [
      { userId: "u-fajar", vote: "for", at: wib("2026-11-02", 10) },
      { userId: "u-rani", vote: "for", at: wib("2026-11-03", 11) },
    ],
    status: "open",
    prcDecision: null,
    recordedAt: null,
  },
];

/* ───────────────────────── audit trail (§9.2) ───────────────────────── */

const run = (m: string) => bonusRuns.find((r) => r.month === m)!;
const rp = (n: number) => `Rp ${Math.round(n / M).toLocaleString("en-US")} M`;

export const auditLog: AuditEntry[] = (
  [
    [wib("2026-06-24", 14), "u-sinta", "initiative", "ini-nhs-seabed", "submitted to PRC", "PRC-2026-001"],
    [wib("2026-06-25", 9), "u-maria", "initiative", "ini-nhs-seabed", "acknowledged & screened", "Primary reviewer assigned"],
    [wib("2026-07-10", 15), "u-ben", "initiative", "ini-nhs-seabed", "PRC decision: approved", "Project code PRJ-2026-001 · 30 % deferral (payment terms 120 days, §9.3)"],
    [wib("2026-07-08", 11), "u-sinta", "initiative", "ini-cam-uas", "submitted to PRC", "PRC-2026-002"],
    [wib("2026-07-24", 15), "u-ben", "initiative", "ini-cam-uas", "PRC decision: approved", "Project code PRJ-2026-002"],
    [wib("2026-08-24", 16), "u-maria", "run", "run-2026-08", "break-even test passed — certified by CFO (2026-08)", `Rolling three-month operating result ${rp(run("2026-08").operatingResult)}; cash floor met`],
    [wib("2026-08-24", 11), "u-ben", "run", "run-2026-08", "PRC authorised release for 2026-08 — paid with the 24 Aug salary (25 Aug is Maulid Nabi, §8.2)", `${deferredBonuses.filter((d) => d.month === "2026-08").length} deferred entries created`],
    [wib("2026-09-02", 10), "u-dina", "employee", "u-rafi", "HR record created — probationary hire", "Probation ends 2026-12-01; Annex B and Annex C signed (§11.2)"],
    [wib("2026-09-15", 13), "u-rani", "initiative", "ini-spl-crane", "submitted to PRC", "PRC-2026-004"],
    [wib("2026-09-24", 16), "u-maria", "run", "run-2026-09", "break-even test passed — certified by CFO (2026-09)", `Rolling three-month operating result ${rp(run("2026-09").operatingResult)}; cash floor met`],
    [wib("2026-09-25", 11), "u-ben", "run", "run-2026-09", "PRC authorised release for 2026-09 — paid with the 25 Sep salary", `${deferredBonuses.filter((d) => d.month === "2026-09").length} deferred entries created`],
    [wib("2026-09-28", 15), "u-ben", "initiative", "ini-spl-crane", "PRC decision: approved", "Project code PRJ-2026-003 · Rani and Fajar recused"],
    [wib("2026-10-01", 9), "u-fajar", "initiative", "ini-spl-crane", "kicked off — project active"],
    [wib("2026-10-01", 10), "u-dimas", "member", "im-sbs-rafi", "proposed for team", "Engineer by team amendment (§6.8) — probationary, bonuses held until probation ends (§11)"],
    [wib("2026-10-06", 14), "u-arif", "initiative", "ini-sbs-pdm", "submitted to PRC", "PRC-2026-006"],
    [wib("2026-10-14", 11), "u-nadia", "initiative", "ini-twu-nrw", "submitted to PRC", "PRC-2026-007"],
    [wib("2026-10-20", 10), "u-dina", "employee", "u-bima", "separation recorded: resignation", "Notice 2026-10-20, last working day 2026-11-20 — no new roles; bonuses on revenue collected up to the last working day are paid (§10)"],
    [wib("2026-10-20", 15), "u-ben", "initiative", "ini-sbs-pdm", "PRC decision: approved", "Project code PRJ-2026-004 · 30 % deferral (projected net revenue over Rp1 billion, §9.3)"],
    [wib("2026-10-21", 9), "u-dimas", "initiative", "ini-sbs-pdm", "kicked off — project active"],
    [wib("2026-10-21", 13), "u-dimas", "initiative", "ini-mcd-light", "submitted to PRC", "PRC-2026-010"],
    [wib("2026-10-24", 16), "u-maria", "run", "run-2026-10", "break-even test passed — certified by CFO (2026-10)", `Rolling three-month operating result ${rp(run("2026-10").operatingResult)}; cash floor met`],
    [wib("2026-10-28", 15), "u-ben", "initiative", "ini-mcd-light", "PRC decision: rejected", "Discovery-stage client without LOI; margin below threshold (1–3)"],
    [wib("2026-10-30", 15), "u-ben", "initiative", "ini-twu-nrw", "PRC decision: conditional", "Raise contingency to 15% and add a QA/QC specialist before kickoff (3–1)"],
    [wib("2026-10-31", 11), "u-dimas", "initiative", "ini-mcd-light", "appeal filed with Executive Committee", "Client LOI with 20 % advance expected in November"],
    [wib("2026-10-31", 16), "u-sinta", "initiative", "ini-cam-uas", "completed — final reconciliation due within 30 days (§8.3)"],
    [wib("2026-11-02", 10), "u-sinta", "initiative", "ini-nhs-asv", "submitted to PRC", "PRC-2026-011"],
    [wib("2026-10-29", 17), "u-ben", "policy", "4.0", "Policy v4.0 draft circulated for approval", "Regressive revenue-share curve, UMKM tax, Team Allocation Ledger, Type C minimum; pilot from 1 Jan 2027 (§15.2)"],
    [wib("2026-11-03", 9, 30), "u-fajar", "initiative", "ini-nhs-asv", "acknowledged & screened", "Primary reviewer assigned"],
    [wib("2026-11-03", 14), "u-fajar", "initiative", "ini-nhs-asv", "detailed evaluation started", "Type C with warranty — Tier 3 review, 12-month deferral proposed; standard bonus Rp2.5 M a month proposed (§8.6)"],
    [wib("2026-11-03", 15), "u-maria", "clawback", "cb-1", "clawback trigger identified by Finance (§9.4)", `revenue_reversal — ${rp(clawbackAmount(clawbacks[0]))}; recovery from deferred / future bonuses first`],
    [at(0, 8), "u-kevin", "initiative", "ini-ptt-insp", "submitted to PRC", "PRC-2026-012"],
  ] as [string, string, AuditEntry["entity"], string, string, string?][]
)
  .sort((a, b) => b[0].localeCompare(a[0]))
  .map(([atIso, actorId, entity, entityId, action, detail], i, arr) => ({ id: `au-${String(arr.length - i).padStart(3, "0")}`, at: atIso, actorId, entity, entityId, action, detail: detail ?? "" }));

export const initiativeSeed = {
  employeeProfiles,
  initiatives,
  initiativeMembers,
  revenueEntries,
  bonusRuns,
  deferredBonuses,
  probationOutcomes,
  clawbacks,
  curveAdjustments,
  teamAmendments,
  auditLog,
};
