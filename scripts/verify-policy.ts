/**
 * Verifies the compensation engine against Project Initiative and Compensation Policy v4.0 (docs/policy/v4.0.md):
 * the §5.1 curve table, the §16 worked examples, eligibility, status changes, deferral, clawback and the demo seed.
 *   npm run test:policy
 */
import {
  approvalTier,
  capacityCheck,
  clawbackAmount,
  clawbackExempt,
  clawbackSchedule,
  computeRun,
  concurrentNonLeadRoles,
  contractedMonths,
  cycleMonth,
  deferralTriggers,
  leadershipLoad,
  maxAllocationFactor,
  memberWeight,
  netRevenue,
  participationEligibility,
  paymentOutcome,
  projectCycles,
  projectRate,
  proposalEconomics,
  revenueShareRate,
  splitBonus,
} from "../src/lib/initiatives/engine";
import { POLICY } from "../src/lib/initiatives/policy";
import { initiativeSeed } from "../src/lib/initiatives/seed";
import type { EmployeeProfile, Initiative, InitiativeMember, ProjectRole, ProjectType, RevenueEntry } from "../src/lib/initiatives/types";

let failures = 0;
let passes = 0;
function eq(label: string, actual: number, expected: number, tol = 0) {
  if (Math.abs(actual - expected) <= tol + 1e-9) passes++;
  else {
    failures++;
    console.error(`✗ ${label}: expected ${expected}, got ${actual}`);
  }
}
function ok(label: string, cond: boolean) {
  if (cond) passes++;
  else {
    failures++;
    console.error(`✗ ${label}`);
  }
}
const M = 1_000_000;
const wib = (d: string, h = 9) => new Date(`${d}T${String(h).padStart(2, "0")}:00:00+07:00`).toISOString();

/* ── fixtures ── */
let seq = 0;
const mkIni = (type: ProjectType, o: Partial<Initiative> = {}): Initiative => ({
  id: `p${++seq}`, trackingNo: "", code: null, title: "x", type, status: "active", initiatorId: "u", origination: "personal", summary: "", valueProposition: "", scope: "", deliverables: "", exclusions: "", successCriteria: "",
  startDate: wib("2027-01-01", 0), endDate: wib("2027-06-30", 17), milestones: [], companyId: null, dealId: null, contractStatus: "signed", newClient: false, paymentTermsDays: 30,
  revenue: { expected: 0, best: 0, worst: 0 }, costs: { materials: 0, subcontractors: 0, equipment: 0, travel: 0, other: 0, contingencyPct: 0 }, risks: [], highRisk: false, warranty: false, deferralMonths: 6,
  lockedSharePct: null, policyVersion: "4.0", submittedAt: null, acknowledgedAt: null, primaryReviewerId: null, scores: null, decision: null, appeal: null, approvedAt: wib("2026-12-20"), completedAt: null, epicId: null, createdAt: wib("2026-12-01"), updatedAt: wib("2026-12-01"),
  ...o,
});
const mkMem = (userId: string, ini: Initiative, roles: ProjectRole[], o: Partial<InitiativeMember> = {}): InitiativeMember => ({
  id: `m${++seq}`, initiativeId: ini.id, userId, roles, specialistWeight: null, weightOverride: null, allocationFactor: 1, consent: "accepted", managerApproved: true, prcApproved: true, application: false, allocationPct: 20,
  joinedAt: ini.startDate, leftAt: null, removal: { stage: "none", updatedAt: null, note: "" }, ...o,
});
const base: EmployeeProfile = {
  userId: "x", employmentType: "full_time_permanent", hireDate: "2024-01-01T00:00:00Z", probationEndDate: null, annualBaseSalary: 300 * M, directManagerId: null,
  goodStanding: true, activeWrittenWarning: false, onPIP: false, pipApprovedByPRC: false, underInvestigation: false, suspended: false, unpaidLeaveDays: 0,
  resignationNoticeAt: null, terminationNoticeAt: null, separation: null, acknowledgmentSignedAt: "2026-12-10T00:00:00Z", governanceRoles: [],
};
const profilesFor = (ids: string[], o: Partial<EmployeeProfile> = {}) => ids.map((userId) => ({ ...base, userId, ...o }));
const entry = (ini: Initiative, id: string, collected: string, revenue: number, directCosts: number, work?: [string, string]): RevenueEntry => ({
  id, initiativeId: ini.id, month: cycleMonth(collected), revenue, directCosts, basis: "milestone", received: true, collectedAt: collected, workPeriodStart: work?.[0] ?? null, workPeriodEnd: work?.[1] ?? null, note: "",
});
const RICH = { companyRevenue: 10_000 * M, directCosts: 0, overheads: 0, cash: 10_000 * M, fixedCostsMonthly: 0 };

/* ── §5.1 regressive curve table ── */
for (const [x, rate, pool] of [
  [100 * M, 0.3333, 33_333_333],
  [250 * M, 0.2667, 66_666_666],
  [500 * M, 0.2, 100_000_000],
  [750 * M, 0.16, 120_000_000],
  [1_000 * M, 0.1333, 133_333_333],
  [1_500 * M, 0.1, 150_000_000],
  [2_000 * M, 0.1, 200_000_000],
] as const) {
  eq(`5.1 rate at Rp${x / M}M`, Math.round(revenueShareRate(x) * 10_000) / 10_000, rate);
  eq(`5.1 annual pool at Rp${x / M}M`, Math.floor(x * revenueShareRate(x) + 1e-6), pool);
}
eq("5.1 rate at Rp0 = 40%", revenueShareRate(0), 0.4);
{
  let prev = -1;
  let monotone = true;
  for (let x = 0; x <= 3_000 * M; x += 5 * M) {
    const pool = x * revenueShareRate(x);
    if (pool < prev - 1e-6) monotone = false;
    prev = pool;
  }
  ok("5.1 more revenue never pays less", monotone);
}
eq("5.1 contracted months 1 Jan–30 Jun", contractedMonths({ startDate: wib("2027-01-01", 0), endDate: wib("2027-06-30", 17) }), 6);
eq("5.1 contracted months 15 Jan–20 Jul rounds up", contractedMonths({ startDate: wib("2027-01-15"), endDate: wib("2027-07-20") }), 7);

/* ── §5.4 UMKM tax ── */
eq("5.4 UMKM tax 0.5% of revenue", netRevenue(600 * M, 100 * M).tax, 3 * M);
eq("5.4 tax due even at a loss", netRevenue(100 * M, 150 * M).tax, 0.5 * M);

/* ── §16.1 Type A consulting ── */
{
  const n = netRevenue(600 * M, 100 * M);
  eq("16.1 net revenue", n.net, 497 * M);
  const rate = revenueShareRate(n.net);
  eq("16.1 rate 20.060%", Math.round(rate * 100_000) / 1000, 20.06);
  const w = (roles: ProjectRole[]) => memberWeight({ roles, specialistWeight: null, weightOverride: null });
  const s = splitBonus([{ userId: "lead", weight: w(["initiator", "project_lead"]) }, { userId: "tl", weight: w(["technical_lead"]) }, { userId: "e1", weight: w(["engineer"]) }, { userId: "e2", weight: w(["engineer"]) }], rate, n.net);
  eq("16.1 pool", s.pool, 99_699_097);
  eq("16.1 total weight", s.total, 6.5);
  eq("16.1 initiator + lead", s.shares[0].bonus, 38_345_806);
  eq("16.1 technical lead", s.shares[1].bonus, 30_676_645);
  eq("16.1 engineer", s.shares[2].bonus, 15_338_322);
  // same through the full engine: 8-month contract, all collected in one cycle
  const ini = mkIni("A", { startDate: wib("2027-01-01", 0), endDate: wib("2027-08-31", 17), revenue: { expected: 600 * M, best: 600 * M, worst: 600 * M }, costs: { materials: 100 * M, subcontractors: 0, equipment: 0, travel: 0, other: 0, contingencyPct: 0 } });
  const mems = [mkMem("lead", ini, ["initiator", "project_lead"]), mkMem("tl", ini, ["technical_lead"]), mkMem("e1", ini, ["engineer"]), mkMem("e2", ini, ["engineer"])];
  eq("16.1 x is total net (≤ 12 months)", projectRate(ini).x, 497 * M);
  const r = computeRun({ month: "2027-09", initiatives: [ini], members: mems, entries: [entry(ini, "e1", wib("2027-09-10"), 600 * M, 100 * M, [ini.startDate, ini.endDate])], profiles: profilesFor(["lead", "tl", "e1", "e2"]), adjustments: [], ...RICH });
  eq("16.1 engine pool", r.totals.pool, 99_699_097);
  eq("16.1 engine lead bonus", r.lines.find((l) => l.userId === "lead")?.payable ?? 0, 38_345_806);
}

/* ── §16.2 Type B with team changes (work periods, allocation factor) ── */
{
  const ini = mkIni("B", { revenue: { expected: 750 * M, best: 750 * M, worst: 750 * M }, costs: { materials: 250 * M, subcontractors: 0, equipment: 0, travel: 0, other: 0, contingencyPct: 0 } });
  eq("16.2 projected net", projectRate(ini).projectedNet, 496.25 * M);
  eq("16.2 rate 20.075%", Math.round(projectRate(ini).rate * 100_000) / 1000, 20.075);
  const end3 = wib("2027-03-31", 17);
  const mems = [
    mkMem("rina", ini, ["initiator", "project_lead"]),
    mkMem("budi", ini, ["technical_lead"]),
    mkMem("eko", ini, ["engineer"]),
    mkMem("dewi", ini, ["engineer"], { leftAt: end3 }),
    mkMem("fajar", ini, ["engineer"], { joinedAt: wib("2027-04-01", 0) }),
    mkMem("sari", ini, ["secretary"], { allocationFactor: 0.5 }),
  ];
  const entries = [entry(ini, "design", wib("2027-04-12"), 300 * M, 50 * M, [ini.startDate, end3]), entry(ini, "install", wib("2027-07-12"), 450 * M, 200 * M, [wib("2027-04-01", 0), ini.endDate])];
  const profiles = profilesFor(["rina", "budi", "eko", "dewi", "fajar", "sari"]);
  const apr = computeRun({ month: "2027-04", initiatives: [ini], members: mems, entries, profiles, adjustments: [], ...RICH });
  const jul = computeRun({ month: "2027-07", initiatives: [ini], members: mems, entries, profiles, adjustments: [], ...RICH });
  const b = (r: typeof apr, u: string) => r.lines.find((l) => l.userId === u)?.payable ?? 0;
  eq("16.2 design pool", apr.totals.pool, 49_887_076);
  eq("16.2 design: Rina", b(apr, "rina"), 17_816_812);
  eq("16.2 design: Budi", b(apr, "budi"), 14_253_450);
  eq("16.2 design: Dewi (left before payment)", b(apr, "dewi"), 7_126_725);
  eq("16.2 design: Fajar not yet on team", b(apr, "fajar"), 0);
  eq("16.2 design: Sari at 0.5 allocation", b(apr, "sari"), 3_563_362);
  // §8.1 cumulative rule gives 49,736,512; the policy's table rounds this payment on its own (…511). Rp1 tolerance.
  eq("16.2 installation pool (§8.1 cumulative)", jul.totals.pool, 49_736_511, 1);
  eq("16.2 installation: Rina", b(jul, "rina"), 17_763_039, 1);
  eq("16.2 installation: Fajar", b(jul, "fajar"), 7_105_215, 1);
  eq("16.2 installation: Dewi gone", b(jul, "dewi"), 0);
  eq("16.2 installation: Sari", b(jul, "sari"), 3_552_607, 1);
}

/* ── §16.3 leadership capacity, §7.1 non-lead roles ── */
{
  const inis = [mkIni("A"), mkIni("A"), mkIni("B"), mkIni("C")];
  const mems = inis.map((i) => mkMem("sarah", i, ["project_lead"]));
  eq("16.3 Sarah capacity", leadershipLoad("sarah", inis, mems).used, 2.0);
  const extra = mkIni("A");
  ok("16.3 Sarah cannot lead anything else", !capacityCheck("sarah", extra, ["project_lead"], [...inis, extra], mems).ok);
  ok("16.3 Sarah can still take a non-lead role", capacityCheck("sarah", extra, ["engineer"], [...inis, extra], mems).ok);
}
{
  const inis = Array.from({ length: 6 }, () => mkIni("A"));
  const mems = inis.map((i) => mkMem("david", i, ["technical_lead"]));
  eq("16.3 David capacity", leadershipLoad("david", inis, mems).used, 1.5);
  const b = mkIni("B");
  ok("16.3 David can take 1 Type B", capacityCheck("david", b, ["technical_lead"], [...inis, b], mems).ok);
  const c = mkIni("C");
  ok("16.3 David cannot take a Type C", !capacityCheck("david", c, ["project_lead"], [...inis, c], mems).ok);
}
{
  const ini = mkIni("C");
  eq("16.3 Maria PL+TL counted once", leadershipLoad("maria", [ini], [mkMem("maria", ini, ["project_lead", "technical_lead"])]).used, 1.0);
  const three = [mkIni("A"), mkIni("B"), mkIni("C")];
  eq("7.1 non-lead roles counted", concurrentNonLeadRoles("eng", three, three.map((i) => mkMem("eng", i, ["engineer"]))), 3);
}

/* ── §16.4 failed break-even test → pro rata + carry forward ── */
{
  const ini = mkIni("A", { lockedSharePct: 1 });
  const mems = [mkMem("a", ini, ["project_lead"]), mkMem("b", ini, ["engineer"])];
  const entries = [entry(ini, "e", wib("2027-03-10"), 320 * M, 158.4 * M, [wib("2027-02-01", 0), wib("2027-02-28", 17)])];
  const r = computeRun({ month: "2027-03", initiatives: [ini], members: mems, entries, profiles: profilesFor(["a", "b"]), adjustments: [], companyRevenue: 1_200 * M, directCosts: 380 * M, overheads: 690 * M, cash: 10_000 * M, fixedCostsMonthly: 100 * M });
  eq("16.4 proposed bonuses", r.proposed, 160 * M, 1);
  eq("16.4 operating result before", r.operatingResultBefore, -30 * M, 1);
  ok("16.4 test fails", !r.breakEvenPassed && !r.passed);
  eq("16.4 payout 81.25%", Math.round(r.payoutPct * 10_000) / 100, 81.25);
  eq("16.4 released", r.totals.payable, 130 * M, 2);
  eq("16.4 carried forward", r.totals.carriedOver, 30 * M, 2);
  const next = computeRun({ month: "2027-04", initiatives: [ini], members: mems, entries, profiles: profilesFor(["a", "b"]), adjustments: [], ...RICH, carriedIn: r.lines.map((l) => ({ initiativeId: l.initiativeId, userId: l.userId, amount: l.carriedOver })) });
  eq("9.2 carried amount paid first next passing month", next.totals.payable, 30 * M, 2);
  const cashFail = computeRun({ month: "2027-03", initiatives: [ini], members: mems, entries, profiles: profilesFor(["a", "b"]), adjustments: [], companyRevenue: 10_000 * M, directCosts: 0, overheads: 0, cash: 300 * M, fixedCostsMonthly: 100 * M });
  ok("9.1 cash check (2 months fixed costs) fails", !cashFail.cashPassed);
  eq("9.2 cash-limited payout", cashFail.totals.payable, 100 * M, 2);
}

/* ── §16.5 probation, §16.6 resignation, §10 status changes ── */
{
  const ahmad = { ...base, employmentType: "probationary" as const, probationEndDate: wib("2027-03-31", 17) };
  ok("16.5 January bonus held", paymentOutcome(ahmad, wib("2027-01-25"), wib("2027-01-15")).kind === "withhold_probation");
  ok("16.5 paid normally after probation", paymentOutcome(ahmad, wib("2027-04-25"), wib("2027-04-15")).kind === "pay");
  const failed = { ...ahmad, separation: { kind: "probation_failed" as const, effectiveAt: wib("2027-03-31", 17), recordedAt: wib("2027-03-20") } };
  ok("11.4 failed probation: earned amounts paid with final pay", paymentOutcome(failed, wib("2027-04-25"), wib("2027-03-15")).kind === "pay");
  const lisa = { ...base, resignationNoticeAt: wib("2027-06-15"), separation: { kind: "resignation" as const, effectiveAt: wib("2027-07-15", 17), recordedAt: wib("2027-06-15") } };
  ok("16.6 collected 21 May–20 Jun paid with June salary", paymentOutcome(lisa, wib("2027-06-25"), wib("2027-06-18")).kind === "pay");
  ok("16.6 collected 21 Jun–15 Jul paid with final pay", paymentOutcome(lisa, wib("2027-07-25"), wib("2027-07-10")).kind === "pay");
  ok("16.6 collected after 15 Jul forfeited", paymentOutcome(lisa, wib("2027-07-25"), wib("2027-07-18")).kind === "forfeit");
  ok("16.6 notice does not stop payment", paymentOutcome({ ...base, resignationNoticeAt: wib("2027-06-15") }, wib("2027-06-25"), wib("2027-06-18")).kind === "pay");
  ok("10 dismissal for serious violation forfeits", paymentOutcome({ ...base, separation: { kind: "termination_for_cause", effectiveAt: wib("2027-06-20"), recordedAt: wib("2027-06-20") } }, wib("2027-06-25"), wib("2027-06-10")).kind === "forfeit");
  const redundant = { ...base, separation: { kind: "termination_without_cause" as const, effectiveAt: wib("2027-06-30", 17), recordedAt: wib("2027-06-01") } };
  ok("10 redundancy: later collection for earlier work paid (≤12 months)", paymentOutcome(redundant, wib("2027-09-25"), wib("2027-09-10"), wib("2027-05-01")).kind === "pay");
  ok("10 redundancy: work after the date forfeited", paymentOutcome(redundant, wib("2027-09-25"), wib("2027-09-10"), wib("2027-07-01")).kind === "forfeit");
  ok("10 retirement needs PRC confirmation", paymentOutcome({ ...base, separation: { kind: "retirement", effectiveAt: wib("2027-06-30"), recordedAt: wib("2027-05-01") } }, wib("2027-07-25"), wib("2027-06-10")).kind === "hold");
  ok("10 suspension holds (not forfeits)", paymentOutcome({ ...base, suspended: true }, wib("2027-06-25"), wib("2027-06-10")).kind === "hold");
  ok("15.1 no Annex B → held", paymentOutcome({ ...base, acknowledgmentSignedAt: null }, wib("2027-06-25"), wib("2027-06-10")).kind === "hold");
}

/* ── §3 eligibility ── */
ok("3.1 permanent eligible", participationEligibility(base).ok);
ok("3.1 fixed-term eligible", participationEligibility({ ...base, employmentType: "fixed_term_contract", contractEndDate: wib("2028-01-01") }).ok);
ok("3.1 part-time eligible", participationEligibility({ ...base, employmentType: "part_time", contractedHoursPct: 60 }).ok);
eq("3.1 part-time 60% caps allocation at 0.5", maxAllocationFactor({ ...base, employmentType: "part_time", contractedHoursPct: 60 }), 0.5);
ok("3.2 contractor not eligible", !participationEligibility({ ...base, employmentType: "contractor" }).ok);
ok("3.2 PIP blocked without PRC exception", !participationEligibility({ ...base, onPIP: true }).ok);
ok("3.2 PIP allowed with PRC exception", participationEligibility({ ...base, onPIP: true, pipApprovedByPRC: true }).ok);
ok("3.2 unpaid leave > 30 days blocked", !participationEligibility({ ...base, unpaidLeaveDays: 31 }).ok);
ok("3.1 notice stops new roles", !participationEligibility({ ...base, resignationNoticeAt: wib("2027-01-10") }, wib("2027-01-11")).ok);

/* ── §4.2 approval tiers ── */
eq("4.2 Tier 1: Type B under Rp400M, existing client", approvalTier({ type: "B", revenue: { expected: 350 * M, best: 0, worst: 0 }, newClient: false }).tier, 1);
eq("4.2 Tier 2: Rp400M–2B", approvalTier({ type: "A", revenue: { expected: 900 * M, best: 0, worst: 0 }, newClient: false }).tier, 2);
eq("4.2 Tier 2: small but new client", approvalTier({ type: "A", revenue: { expected: 200 * M, best: 0, worst: 0 }, newClient: true }).tier, 2);
eq("4.2 Tier 3: any Type C", approvalTier({ type: "C", revenue: { expected: 100 * M, best: 0, worst: 0 }, newClient: false }).tier, 3);
eq("4.2 Tier 3: over Rp2B", approvalTier({ type: "B", revenue: { expected: 2_100 * M, best: 0, worst: 0 }, newClient: false }).tier, 3);

/* ── §16.7 multi-year project ── */
{
  const ini = mkIni("B", { startDate: wib("2027-01-01", 0), endDate: wib("2028-12-31", 17), revenue: { expected: 1_600 * M / 0.995, best: 0, worst: 0 } });
  eq("16.7 contracted 24 months", contractedMonths(ini), 24);
  eq("16.7 x = 1.6B × 12 ÷ 24", Math.round(projectRate(ini).x), 800 * M, 1);
  eq("16.7 rate 15.385%", Math.round(projectRate(ini).rate * 100_000) / 1000, 15.385);
  const fixed = { ...ini, lockedSharePct: revenueShareRate(800 * M) };
  const mems = [mkMem("a", fixed, ["project_lead"])];
  // net revenue of Rp700M then Rp900M (revenue grossed up for the 0.5 % tax, costs absorb the rounding)
  const e1 = { ...entry(fixed, "y1", wib("2027-12-10"), 700 * M, 0), revenue: 800 * M, directCosts: 800 * M * 0.995 - 700 * M };
  const e2 = { ...entry(fixed, "y2", wib("2028-12-10"), 900 * M, 0), revenue: 1_000 * M, directCosts: 1_000 * M * 0.995 - 900 * M };
  const y1 = computeRun({ month: "2027-12", initiatives: [fixed], members: mems, entries: [e1, e2], profiles: profilesFor(["a"]), adjustments: [], ...RICH });
  const y2 = computeRun({ month: "2028-12", initiatives: [fixed], members: mems, entries: [e1, e2], profiles: profilesFor(["a"]), adjustments: [], ...RICH });
  eq("16.7 first 12 months pool", y1.totals.pool, 107_692_307);
  eq("16.7 second 12 months pool", y2.totals.pool, 138_461_539);
}

/* ── §16.8 Type C guaranteed minimum ── */
{
  const months = ["2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09"];
  const pools = [0, 0, 0, 0.4, 3, 0.8, 2, 1.5, 4].map((x) => x * M);
  const run = (poolsByMonth: number[], extraMembers: (ini: Initiative) => InitiativeMember[] = () => []) => {
    const ini = mkIni("C", { lockedSharePct: 1, standardBonus: 1 * M, startDate: wib("2027-01-01", 0), endDate: wib("2027-12-31", 17) });
    // revenue R and cost C chosen so that net = pool exactly: R = 2·pool, C = 0.995R − pool
    const entries = poolsByMonth.flatMap((p, i) => (p > 0 ? [{ ...entry(ini, `c${i}`, wib(`${months[i]}-10`), 0, 0, [`${months[i]}-01T00:00:00+07:00`, `${months[i]}-28T17:00:00+07:00`]), revenue: 2 * p, directCosts: 2 * p * 0.995 - p }] : []));
    const members = [mkMem("team", ini, ["project_lead"]), ...extraMembers(ini)];
    return { ini, entries, members, cycles: projectCycles(ini, { members, entries, profiles: profilesFor(["team"]) }, "2027-09") };
  };
  const { cycles } = run(pools);
  const col = (k: "topUp" | "deducted" | "balanceAfter" | "paid") => cycles.map((c) => { const m = c.members.find((x) => x.userId === "team")!; return k === "paid" ? m.revShare - m.deducted + m.topUp : m[k]; });
  const exp = { topUp: [1, 1, 1, 0.6, 0, 0.2, 0, 0, 0], deducted: [0, 0, 0, 0, 2, 0, 1, 0.5, 0.3], paid: [1, 1, 1, 1, 1, 1, 1, 1, 3.7], balanceAfter: [1, 2, 3, 3.6, 1.6, 1.8, 0.8, 0.3, 0] };
  for (const k of Object.keys(exp) as (keyof typeof exp)[]) col(k).forEach((v, i) => eq(`16.8 ${months[i]} ${k}`, v, exp[k][i] * M, 1));
  ok("16.8 minimum ends after September", cycles[8].minimumEndsThisMonth && cycles.slice(0, 8).every((c) => c.minimumActive));
  const alt = run([0, 0, 0, 0.4, 12, 0, 0, 0, 0].map((x) => x * M)).cycles;
  const may = alt[4].members.find((m) => m.userId === "team")!;
  ok("16.8 alt: May pool 12× standard ends the minimum", alt[4].minimumEndsThisMonth && !alt[5].minimumActive);
  eq("16.8 alt: Rp3.6M deducted in May", may.deducted, 3.6 * M, 1);
  eq("16.8 alt: team receives Rp8.4M", may.revShare - may.deducted, 8.4 * M, 1);
  // probationary engineer joining 1 April: paid with salary in top-up months (April, June); May held
  const withProb = run(pools, (ini) => [mkMem("ahmad", ini, ["engineer"], { joinedAt: wib("2027-04-01", 0) })]);
  const profiles = [...profilesFor(["team"]), { ...base, userId: "ahmad", employmentType: "probationary" as const, probationEndDate: wib("2027-06-30", 17) }];
  const r = (m: string) => computeRun({ month: m, initiatives: [withProb.ini], members: withProb.members, entries: withProb.entries, profiles, adjustments: [], ...RICH }).lines.find((l) => l.userId === "ahmad");
  ok("16.8 probationer paid in April (top-up month)", (r("2027-04")?.payable ?? 0) > 0 && (r("2027-04")?.withheld ?? 1) === 0);
  ok("16.8 probationer May share held", (r("2027-05")?.withheld ?? 0) > 0 && (r("2027-05")?.payable ?? 1) === 0);
  ok("16.8 probationer paid in June (top-up month)", (r("2027-06")?.payable ?? 0) > 0);
  // §8.6 step 7: standard bonus paid in full even when the checks fail
  const failing = computeRun({ month: "2027-02", initiatives: [withProb.ini], members: withProb.members, entries: withProb.entries, profiles, adjustments: [], companyRevenue: 0, directCosts: 0, overheads: 500 * M, cash: 0, fixedCostsMonthly: 100 * M });
  eq("8.6 standard bonus paid even when the checks fail", failing.totals.payable, 1 * M, 1);
}

/* ── §9.3 deferral ── */
{
  const ini = mkIni("A", { lockedSharePct: 0.2, newClient: true, deferralPct: 0.3 });
  ok("9.3 new client triggers deferral", deferralTriggers(ini).length === 1);
  const big = mkIni("B", { revenue: { expected: 1_500 * M, best: 0, worst: 0 } });
  ok("9.3 projected net over Rp1B triggers deferral", deferralTriggers(big).some((r) => r.includes("1,000,000,000")));
  const mems = [mkMem("a", ini, ["project_lead"])];
  const r = computeRun({ month: "2027-03", initiatives: [ini], members: mems, entries: [entry(ini, "e", wib("2027-03-10"), 100 * M, 0)], profiles: profilesFor(["a"]), adjustments: [], ...RICH });
  eq("9.3 30% deferred", r.totals.deferred, Math.floor(r.totals.pool * 0.3), 1);
  eq("9.3 rest paid", r.totals.payable + r.totals.deferred, r.totals.pool, 1);
}

/* ── §9.4 clawback ── */
{
  const s = clawbackSchedule(60 * M, 240 * M); // monthly gross 20M → 20 % = 4M
  ok("9.4 schedule within 20% of salary over 6–12 months", s.monthly <= 4 * M + 1 && s.months >= 6 && s.months <= 12);
  eq("9.4 data error safe harbour: first Rp10M not recovered", clawbackAmount({ trigger: "data_error", personallyAtFault: false, originalPaid: 25 * M, recalculated: 10 * M }), 5 * M);
  ok("9.4 data error ≤ Rp10M not caused by employee is exempt", clawbackExempt({ trigger: "data_error", personallyAtFault: false, originalPaid: 8 * M, recalculated: 0, paidAt: wib("2027-01-25") }, wib("2027-02-01")) !== null);
  ok("9.4 misconduct recoverable in full", clawbackExempt({ trigger: "misconduct", personallyAtFault: true, originalPaid: 8 * M, recalculated: 0, paidAt: wib("2027-01-25") }, wib("2027-02-01")) === null);
  ok("9.4 outside 24 months exempt", clawbackExempt({ trigger: "revenue_reversal", personallyAtFault: false, originalPaid: 80 * M, recalculated: 0, paidAt: wib("2025-01-25") }, wib("2027-02-01")) !== null);
}

/* ── demo seed consistency (src/lib/initiatives/seed.ts) ── */
{
  const S = initiativeSeed;
  const iniIds = new Set(S.initiatives.map((i) => i.id));
  const userIds = new Set(S.employeeProfiles.map((p) => p.userId));
  ok("seed: every member references an initiative", S.initiativeMembers.every((m) => iniIds.has(m.initiativeId)));
  ok("seed: every member has an HR record", S.initiativeMembers.every((m) => userIds.has(m.userId)));
  ok("seed: every revenue entry references an initiative", S.revenueEntries.every((e) => iniIds.has(e.initiativeId)));
  ok("seed: every run line references an initiative", S.bonusRuns.every((r) => r.lines.every((l) => iniIds.has(l.initiativeId))));
  ok("seed: deferred / clawbacks reference initiatives", [...S.deferredBonuses, ...S.clawbacks].every((x) => iniIds.has(x.initiativeId)));
  for (const name of ["Elang", "Navora", "DMS", "Tennis"]) ok(`seed: ongoing project ${name} registered`, S.initiatives.some((i) => i.title === name && !i.demo && i.status === "active"));
  ok("seed: Elang is Type B, the others Type C", S.initiatives.find((i) => i.title === "Elang")?.type === "B" && ["Navora", "DMS", "Tennis"].every((t) => S.initiatives.find((i) => i.title === t)?.type === "C"));
  ok("seed: v3.0 projects keep their flat share (§15.1)", S.initiatives.filter((i) => i.policyVersion === "3.0").every((i) => i.lockedSharePct != null));
  for (const i of S.initiatives.filter((x) => ["approved", "active", "conditional"].includes(x.status))) {
    ok(`seed: ${i.title.slice(0, 24)} rate within curve limits`, projectRate(i, S.curveAdjustments).rate >= 0.05 && projectRate(i, S.curveAdjustments).rate <= 0.6);
  }
  for (const u of S.employeeProfiles) ok(`seed: ${u.userId} leadership ≤ 2.0`, leadershipLoad(u.userId, S.initiatives, S.initiativeMembers, { includePending: true }).used <= POLICY.leadershipCapacity + 1e-9);
  ok("seed: released runs Aug & Sep", ["2026-08", "2026-09"].every((m) => S.bonusRuns.find((r) => r.month === m)?.status === "released"));
  ok("seed: stored runs match the engine", S.bonusRuns.every((r) => {
    const live = computeRun({ month: r.month, initiatives: S.initiatives, members: S.initiativeMembers, entries: S.revenueEntries, profiles: S.employeeProfiles, adjustments: S.curveAdjustments, companyRevenue: r.companyRevenue, directCosts: r.directCosts, overheads: r.overheads, cash: r.cash, fixedCostsMonthly: r.fixedCostsMonthly });
    return Math.abs(live.operatingResult - r.operatingResult) < 1 && Math.abs(live.totals.pool - r.totals.pool) < 1 && Math.abs(live.totals.payable - r.totals.payable) < 1;
  }));
  const oct = S.bonusRuns.find((r) => r.month === "2026-10");
  const line = (u: string) => oct?.lines.filter((l) => l.userId === u) ?? [];
  ok("seed: Rafi Oct share held (probation §11)", line("u-rafi").length > 0 && line("u-rafi").every((l) => l.withheld > 0 && l.payable === 0));
  ok("seed: Bima (under notice) still paid for October (§10)", line("u-bima").some((l) => l.payable > 0));
  ok("seed: Lia held — Annex B not signed (§15.1)", line("u-lia").length === 0 || line("u-lia").every((l) => l.held > 0 && l.payable === 0));
  ok("seed: deferral on SBS (projected net > Rp1B)", S.initiatives.some((i) => i.id === "ini-sbs-pdm" && deferralTriggers(i).length > 0));
  const econ = proposalEconomics(S.initiatives.find((i) => i.id === "ini-academy")!);
  ok("seed: draft academy on the v4 curve", econ.rate.source === "curve" && econ.share < 0.4);
  const cb = S.clawbacks[0];
  ok("seed: clawback positive and within 20% of salary", !!cb && clawbackAmount(cb) > 0 && cb.monthlyDeduction <= (600 * M / 12) * POLICY.clawback.maxSalaryDeductionPct + 1);
}

console.log(`${passes} checks passed, ${failures} failed`);
if (failures) process.exit(1);
