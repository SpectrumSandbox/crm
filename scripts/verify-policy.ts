/**
 * Verifies the compensation engine against the worked examples in
 * Project Initiative & Compensation Policy v3.0, §10 — plus eligibility, cap, deferral and clawback rules.
 *   npm run test:policy
 */
import { capacityCheck, clawbackExempt, clawbackSchedule, computeRun, deferralTriggers, leadershipLoad, memberWeight, netRevenue, paymentOutcome, participationEligibility, splitBonus } from "../src/lib/initiatives/engine";
import { POLICY, usd } from "../src/lib/initiatives/policy";
import { initiativeSeed } from "../src/lib/initiatives/seed";
import type { EmployeeProfile, Initiative, InitiativeMember, ProjectRole, ProjectType } from "../src/lib/initiatives/types";

let failures = 0;
let passes = 0;
function eq(label: string, actual: number, expected: number, tol = 0.5) {
  if (Math.abs(actual - expected) <= tol) passes++;
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

/* ── §10.1–10.3 bonus examples (USD figures, the formula is currency-agnostic) ── */
const team = (spec: [string, ProjectRole[]][]) => spec.map(([userId, roles]) => ({ userId, weight: memberWeight({ roles, specialistWeight: null, weightOverride: null }) }));

{
  const n = netRevenue(100_000, 10_000);
  eq("10.1 taxes", n.tax, 19_800);
  eq("10.1 net revenue", n.net, 70_200);
  const s = splitBonus(team([["lead", ["initiator", "project_lead"]], ["tl", ["technical_lead"]], ["e1", ["engineer"]], ["e2", ["engineer"]]]), 0.5, n.net);
  eq("10.1 pool", s.pool, 35_100);
  eq("10.1 total weight", s.total, 6.5, 1e-9);
  eq("10.1 initiator/lead", s.shares[0].bonus, 13_500);
  eq("10.1 technical lead", s.shares[1].bonus, 10_800);
  eq("10.1 engineer", s.shares[2].bonus, 5_400);
}
{
  const n = netRevenue(150_000, 50_000);
  eq("10.2 net revenue", n.net, 78_000);
  const s = splitBonus(team([["lead", ["initiator", "project_lead"]], ["tl", ["technical_lead"]], ["e1", ["engineer"]], ["e2", ["engineer"]], ["e3", ["engineer"]], ["sec", ["secretary"]]]), 0.3, n.net);
  eq("10.2 pool", s.pool, 23_400);
  eq("10.2 total weight", s.total, 8.5, 1e-9);
  eq("10.2 initiator/lead", s.shares[0].bonus, 6_882);
  eq("10.2 technical lead", s.shares[1].bonus, 5_506);
  eq("10.2 engineer", s.shares[2].bonus, 2_753);
  eq("10.2 secretary", s.shares[5].bonus, 2_753);
}
{
  const n = netRevenue(300_000, 150_000);
  eq("10.3 taxes", n.tax, 33_000);
  eq("10.3 net revenue", n.net, 117_000);
  const s = splitBonus(team([["lead", ["initiator", "project_lead"]], ["tl", ["technical_lead"]], ["e1", ["engineer"]], ["e2", ["engineer"]], ["e3", ["engineer"]], ["e4", ["engineer"]], ["e5", ["engineer"]], ["sec", ["secretary"]]]), 0.3, n.net);
  eq("10.3 pool", s.pool, 35_100);
  eq("10.3 total weight", s.total, 10.5, 1e-9);
  eq("10.3 initiator/lead", s.shares[0].bonus, 8_357);
  eq("10.3 technical lead", s.shares[1].bonus, 6_686);
  eq("10.3 engineer", s.shares[2].bonus, 3_343);
}

/* ── §4.3 cumulative weights ── */
eq("4.3 initiator + lead", memberWeight({ roles: ["initiator", "project_lead"], specialistWeight: null, weightOverride: null }), 2.5, 1e-9);
eq("4.3 lead + technical lead", memberWeight({ roles: ["project_lead", "technical_lead"], specialistWeight: null, weightOverride: null }), 4.0, 1e-9);
eq("4.1 specialist clamps to 2.5", memberWeight({ roles: ["specialist"], specialistWeight: 3, weightOverride: null }), 2.5, 1e-9);

/* ── §10.4 leadership capacity ── */
const NOW = "2026-11-04T02:00:00.000Z";
let seq = 0;
const mkIni = (type: ProjectType): Initiative => ({
  id: `p${++seq}`, trackingNo: "", code: null, title: "x", type, status: "active", initiatorId: "u", summary: "", valueProposition: "", scope: "", deliverables: "", exclusions: "", successCriteria: "",
  startDate: NOW, endDate: NOW, milestones: [], companyId: null, dealId: null, contractStatus: "signed", newClient: false, paymentTermsDays: 30,
  revenue: { expected: 0, best: 0, worst: 0 }, costs: { materials: 0, subcontractors: 0, equipment: 0, travel: 0, other: 0, contingencyPct: 0 }, risks: [], highRisk: false, warranty: false, deferralMonths: 6,
  lockedSharePct: null, capException: false, submittedAt: null, acknowledgedAt: null, primaryReviewerId: null, scores: null, decision: null, appeal: null, approvedAt: NOW, completedAt: null, epicId: null, createdAt: NOW, updatedAt: NOW,
});
const mkMem = (userId: string, ini: Initiative, roles: ProjectRole[]): InitiativeMember => ({
  id: `m${++seq}`, initiativeId: ini.id, userId, roles, specialistWeight: null, weightOverride: null, consent: "accepted", managerApproved: true, prcApproved: true, application: false, allocationPct: 20, joinedAt: "2026-01-01T00:00:00Z", leftAt: null, removal: { stage: "none", updatedAt: null, note: "" },
});
{
  const inis = [mkIni("A"), mkIni("A"), mkIni("B"), mkIni("C")];
  const mems = inis.map((i) => mkMem("sarah", i, ["project_lead"]));
  eq("10.4A Sarah capacity", leadershipLoad("sarah", inis, mems).used, 2.0, 1e-9);
  const extra = mkIni("A");
  ok("10.4A Sarah cannot take another lead", !capacityCheck("sarah", extra, ["project_lead"], [...inis, extra], mems).ok);
  ok("10.4A Sarah can still join as engineer", capacityCheck("sarah", extra, ["engineer"], [...inis, extra], mems).ok);
}
{
  const inis = Array.from({ length: 6 }, () => mkIni("A"));
  const mems = inis.map((i) => mkMem("david", i, ["technical_lead"]));
  eq("10.4B David capacity", leadershipLoad("david", inis, mems).used, 1.5, 1e-9);
  const b = mkIni("B");
  ok("10.4B David can take 1 Type B lead", capacityCheck("david", b, ["technical_lead"], [...inis, b], mems).ok);
  const c = mkIni("C");
  ok("10.4B David cannot take a Type C lead", !capacityCheck("david", c, ["project_lead"], [...inis, c], mems).ok);
}
{
  const ini = mkIni("C");
  const mems = [mkMem("maria", ini, ["project_lead", "technical_lead"])];
  eq("10.4C dual role counted once", leadershipLoad("maria", [ini], mems).used, 1.0, 1e-9);
}

/* ── §2.1 / §4.5 / §6.8 eligibility ── */
const base: EmployeeProfile = {
  userId: "x", employmentType: "full_time_permanent", hireDate: "2024-01-01T00:00:00Z", probationEndDate: null, annualBaseSalary: 300_000_000, directManagerId: null,
  goodStanding: true, activeWrittenWarning: false, onPIP: false, pipApprovedByPRC: false, underInvestigation: false, suspended: false, unpaidLeaveDays: 0,
  resignationNoticeAt: null, terminationNoticeAt: null, separation: null, acknowledgmentSignedAt: "2026-04-10T00:00:00Z", governanceRoles: [],
};
ok("2.1 FT permanent eligible", participationEligibility(base).ok);
ok("1.2 contractor not eligible", !participationEligibility({ ...base, employmentType: "contractor" }).ok);
ok("2.1 PIP without PRC approval blocked", !participationEligibility({ ...base, onPIP: true }).ok);
ok("2.1 PIP with PRC approval allowed", participationEligibility({ ...base, onPIP: true, pipApprovedByPRC: true }).ok);
ok("2.1 unpaid leave > 30 days blocked", !participationEligibility({ ...base, unpaidLeaveDays: 31 }).ok);
ok("4.5 pay", paymentOutcome(base, "2026-07-05T02:00:00Z", "2026-06").kind === "pay");
// §10.6 Lisa: resigns 15 June → June bonus (paid 5 July) forfeited, May bonus (paid 5 June) unaffected
const lisa = { ...base, resignationNoticeAt: "2026-06-15T02:00:00Z" };
ok("10.6 May bonus paid before notice", paymentOutcome(lisa, "2026-06-05T02:00:00Z", "2026-05").kind === "pay");
ok("10.6 June bonus forfeited", paymentOutcome(lisa, "2026-07-05T02:00:00Z", "2026-06").kind === "forfeit");
// §10.5 Ahmad: probation Jan–Mar → withheld
const ahmad = { ...base, employmentType: "probationary" as const, probationEndDate: "2026-03-31T10:00:00Z" };
ok("10.5 January bonus withheld", paymentOutcome(ahmad, "2026-02-05T02:00:00Z", "2026-01").kind === "withhold_probation");
ok("4.5 terminated for cause forfeits", paymentOutcome({ ...base, separation: { kind: "termination_for_cause", effectiveAt: "2026-06-20T00:00:00Z", recordedAt: "2026-06-20T00:00:00Z" } }, "2026-07-05T02:00:00Z", "2026-06").kind === "forfeit");
ok("4.5 without cause: revenue before termination paid", paymentOutcome({ ...base, separation: { kind: "termination_without_cause", effectiveAt: "2026-07-10T00:00:00Z", recordedAt: "2026-07-01T00:00:00Z" } }, "2026-07-05T02:00:00Z", "2026-06").kind === "pay");
ok("4.5 suspension forfeits", paymentOutcome({ ...base, suspended: true }, "2026-07-05T02:00:00Z", "2026-06").kind === "forfeit");

/* ── §6.1–6.3 monthly run ── */
{
  const ini = { ...mkIni("A"), id: "run1" };
  const users = ["a", "b"];
  const members = [mkMem("a", ini, ["initiator", "project_lead"]), mkMem("b", ini, ["engineer"])];
  const profiles = users.map((u) => ({ ...base, userId: u }));
  const entries = [{ id: "e", initiativeId: ini.id, month: "2026-10", revenue: usd(100_000), directCosts: usd(10_000), basis: "recognized" as const, received: true, note: "" }];
  const r = computeRun({ month: "2026-10", initiatives: [ini], members, entries, profiles, adjustments: [], overheads: 0, ebitda: usd(10_000_000) });
  eq("run pool (Type A 50 %)", r.totals.pool, usd(35_100), 1);
  eq("run payable = pool", r.totals.payable, usd(35_100), 1);
  ok("run passes with no overheads", r.passed);
  // pool cap: 5 % of EBITDA
  const capped = computeRun({ month: "2026-10", initiatives: [ini], members, entries, profiles, adjustments: [], overheads: 0, ebitda: usd(100_000) });
  eq("6.2 pool capped at 5% EBITDA", capped.totals.pool, usd(5_000), 1);
  // break-even failure → suggestion
  const failing = computeRun({ month: "2026-10", initiatives: [ini], members, entries, profiles, adjustments: [], overheads: usd(50_000), ebitda: usd(10_000_000) });
  ok("6.1 fails when overheads exceed margin", !failing.passed);
  ok("6.1 suggests a correction", failing.suggestion !== null);
  // §6.3 new client → 30 % deferred
  const risky = computeRun({ month: "2026-10", initiatives: [{ ...ini, newClient: true }], members, entries, profiles, adjustments: [], overheads: 0, ebitda: usd(10_000_000) });
  eq("6.3 30% deferred", risky.totals.deferred, usd(35_100) * POLICY.deferral.pct, 1);
  // §6.2 200 % salary cap
  const lowPaid = profiles.map((p) => ({ ...p, annualBaseSalary: usd(5_000) }));
  const cappedPerson = computeRun({ month: "2026-10", initiatives: [ini], members, entries, profiles: lowPaid, adjustments: [], overheads: 0, ebitda: usd(10_000_000) });
  ok("6.2 per-person cap flags review", cappedPerson.lines.some((l) => l.status === "cap_review"));
}

/* ── §6.4 clawback ── */
{
  const s = clawbackSchedule(60_000_000, 240_000_000); // monthly gross 20M → 20 % = 4M
  ok("6.4 schedule within 20% of salary", s.monthly <= 4_000_000 + 1 && s.months >= 6 && s.months <= 12);
  ok("6.4 de minimis data error exempt", clawbackExempt({ trigger: "data_error", personallyAtFault: false, originalPaid: usd(5_000), recalculated: 0, paidAt: NOW }, NOW) !== null);
  ok("6.4 misconduct not exempt", clawbackExempt({ trigger: "misconduct", personallyAtFault: true, originalPaid: usd(5_000), recalculated: 0, paidAt: NOW }, NOW) === null);
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
  ok("seed: 17 employee profiles", S.employeeProfiles.length === 17);
  const dimas = leadershipLoad("u-dimas", S.initiatives, S.initiativeMembers, { includePending: true });
  ok("seed: Dimas leadership load ≤ 2.0", dimas.used <= POLICY.leadershipCapacity + 1e-9);
  eq("seed: Dimas at exactly 2.0", dimas.used, 2.0, 1e-9);
  const oct = S.bonusRuns.find((r) => r.month === "2026-10");
  ok("seed: October run stored", !!oct);
  const line = (u: string) => oct?.lines.filter((l) => l.userId === u) ?? [];
  ok("seed: Bima Oct lines forfeited (resignation §4.5)", line("u-bima").length > 0 && line("u-bima").every((l) => l.status === "forfeited"));
  ok("seed: Rafi Oct line withheld (probation §6.8)", line("u-rafi").length > 0 && line("u-rafi").every((l) => l.status === "withheld_probation"));
  ok("seed: October passes break-even", (oct?.operatingResult ?? -1) >= 0);
  ok("seed: released runs Aug & Sep", ["2026-08", "2026-09"].every((m) => S.bonusRuns.find((r) => r.month === m)?.status === "released"));
  ok("seed: deferral on SBS (net revenue > US$200k)", S.initiatives.some((i) => i.id === "ini-sbs-pdm" && deferralTriggers(i).length > 0));
  ok("seed: no deferral on SPL", S.initiatives.some((i) => i.id === "ini-spl-crane" && deferralTriggers(i).length === 0));
  ok("seed: stored runs match the engine", S.bonusRuns.every((r) => {
    const live = computeRun({ month: r.month, initiatives: S.initiatives, members: S.initiativeMembers, entries: S.revenueEntries, profiles: S.employeeProfiles, adjustments: [], overheads: r.overheads, ebitda: r.ebitda });
    return Math.abs(live.operatingResult - r.operatingResult) < 1 && Math.abs(live.totals.pool - r.totals.pool) < 1;
  }));
  const ytd = new Map<string, number>();
  for (const r of S.bonusRuns) for (const l of r.lines) ytd.set(l.userId, (ytd.get(l.userId) ?? 0) + l.payable);
  const nov = computeRun({ month: "2026-11", initiatives: S.initiatives, members: S.initiativeMembers, entries: S.revenueEntries, profiles: S.employeeProfiles, adjustments: S.shareAdjustments, overheads: 750_000_000, ebitda: 4_000_000_000, paidYtd: ytd });
  ok("seed: November live run fails break-even", !nov.passed);
  ok("seed: November live run suggests a correction", nov.suggestion !== null);
  ok("seed: no stored November run", !S.bonusRuns.some((r) => r.month === "2026-11"));
  const cb = S.clawbacks[0];
  ok("seed: clawback amount positive and within 20 % of salary", !!cb && cb.originalPaid > cb.recalculated && cb.monthlyDeduction <= (600_000_000 / 12) * POLICY.clawback.maxSalaryDeductionPct + 1);
}

console.log(`${passes} checks passed, ${failures} failed`);
if (failures) process.exit(1);
