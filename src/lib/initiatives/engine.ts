/*
 * Compensation engine for Project Initiative & Compensation Policy v3.0.
 * Pure functions only — no store / React — so they can be verified against the policy's
 * worked examples (§10) by scripts/verify-policy.ts.
 */
import type {
  BonusLine,
  BonusRun,
  Clawback,
  DeferredBonus,
  EmployeeProfile,
  Initiative,
  InitiativeMember,
  ProjectRole,
  ProjectType,
  RevenueEntry,
  ShareAdjustment,
} from "./types";
import { EMPLOYMENT_META, POLICY, PROJECT_TYPE_META, ROLE_META, SPECIALIST_RANGE } from "./policy";

const DAY = 86_400_000;
export const round = (n: number) => Math.round(n);

/* ───────────────────────── dates ───────────────────────── */

export function monthKey(iso: string | number | Date) {
  const d = new Date(typeof iso === "string" ? Date.parse(iso) + 7 * 3_600_000 : new Date(iso).getTime() + 7 * 3_600_000);
  return d.toISOString().slice(0, 7);
}
export function monthStart(month: string) {
  return new Date(`${month}-01T00:00:00+07:00`).toISOString();
}
export function monthEnd(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1) - 7 * 3_600_000 - 1).toISOString();
}
export function nextMonth(month: string, n = 1) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
/** Bonuses for month M are paid on the 5th of M+1. */
export function paymentDate(month: string) {
  return new Date(`${nextMonth(month)}-${String(POLICY.paymentDay).padStart(2, "0")}T09:00:00+07:00`).toISOString();
}
/** Break-even test deadline: the 25th of the month (§6.1). */
export function breakEvenDeadline(month: string) {
  return new Date(`${month}-${POLICY.breakEvenDeadlineDay}T17:00:00+07:00`).toISOString();
}
export function addMonths(iso: string, n: number) {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString();
}
export function addBusinessDays(iso: string, days: number) {
  const d = new Date(iso);
  let added = 0;
  while (added < days) {
    d.setTime(d.getTime() + DAY);
    const wd = new Date(d.getTime() + 7 * 3_600_000).getUTCDay();
    if (wd !== 0 && wd !== 6) added++;
  }
  return d.toISOString();
}
export function businessDaysBetween(fromIso: string, toIso: string) {
  let n = 0;
  const end = Date.parse(toIso);
  for (let t = Date.parse(fromIso) + DAY; t <= end; t += DAY) {
    const wd = new Date(t + 7 * 3_600_000).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/* ───────────────────────── §3 revenue sharing ───────────────────────── */

/** §3.4 Net Revenue = Total Project Revenue − Direct Costs − Estimated Taxes (corporate tax on profit). */
export function netRevenue(revenue: number, directCosts: number, otherTaxes = 0) {
  const profit = revenue - directCosts;
  const tax = Math.max(0, profit) * POLICY.corporateTaxRate + otherTaxes;
  return { profit, tax, net: profit - tax };
}

export function directCostTotal(c: Initiative["costs"]) {
  const base = c.materials + c.subcontractors + c.equipment + c.travel + c.other;
  return base * (1 + c.contingencyPct / 100);
}

/** Company-wide share in force for a type on a date, after any announced adjustments (§6.5–6.6). */
export function shareInForce(type: ProjectType, adjustments: ShareAdjustment[], atIso: string) {
  const applicable = adjustments.filter((a) => a.type === type && Date.parse(a.effectiveFrom) <= Date.parse(atIso)).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return applicable.length ? applicable[applicable.length - 1].toPct : PROJECT_TYPE_META[type].share;
}

/** Share applied to a project: run-level corrective override → project's locked share → share in force. */
export function projectShare(initiative: Initiative, adjustments: ShareAdjustment[], atIso: string, override?: number) {
  const [min, max] = PROJECT_TYPE_META[initiative.type].range;
  const base = override ?? initiative.lockedSharePct ?? shareInForce(initiative.type, adjustments, atIso);
  return Math.min(max, Math.max(min, base));
}

/** §2.2.5 proposal profitability preview for each scenario. */
export function proposalEconomics(initiative: Initiative, adjustments: ShareAdjustment[] = [], atIso = new Date().toISOString()) {
  const costs = directCostTotal(initiative.costs);
  const share = projectShare(initiative, adjustments, atIso);
  const scenario = (revenue: number) => {
    const { profit, tax, net } = netRevenue(revenue, costs);
    const pool = Math.max(0, net) * share;
    return { revenue, costs, profit, tax, net, pool, companyMargin: net - pool, marginPct: revenue > 0 ? (net - pool) / revenue : 0 };
  };
  // break-even: revenue at which net revenue = 0 is simply the cost base
  return { share, costs, expected: scenario(initiative.revenue.expected), best: scenario(initiative.revenue.best), worst: scenario(initiative.revenue.worst), breakEvenRevenue: costs };
}

/* ───────────────────────── §4 roles & bonus split ───────────────────────── */

export function roleWeight(role: ProjectRole, specialistWeight: number | null = null) {
  if (role === "specialist") {
    const w = specialistWeight ?? ROLE_META.specialist.weight;
    return Math.min(SPECIALIST_RANGE[1], Math.max(SPECIALIST_RANGE[0], w));
  }
  return ROLE_META[role].weight;
}

/** §4.3 weights are cumulative across roles; §4.1 consensus override replaces the total. */
export function memberWeight(m: Pick<InitiativeMember, "roles" | "specialistWeight" | "weightOverride">) {
  if (m.weightOverride != null) return m.weightOverride;
  return m.roles.reduce((s, r) => s + roleWeight(r, m.specialistWeight), 0);
}

/** §4.2  B_i = W_i / ΣW_j × R × P */
export function splitBonus(weights: { userId: string; weight: number }[], sharePct: number, net: number) {
  const total = weights.reduce((s, w) => s + w.weight, 0);
  const pool = Math.max(0, net) * sharePct;
  return {
    total,
    pool,
    shares: weights.map((w) => ({ userId: w.userId, weight: w.weight, bonus: total > 0 ? (w.weight / total) * pool : 0 })),
  };
}

/* ───────────────────────── §5 multi-project participation ───────────────────────── */

const LIVE_STATUSES = new Set(["approved", "conditional", "active"]);

export function isLiveMember(m: InitiativeMember, atIso = new Date().toISOString()) {
  return m.consent !== "declined" && m.removal.stage !== "removed" && (!m.leftAt || Date.parse(m.leftAt) > Date.parse(atIso));
}

/**
 * §5.1 leadership capacity: Σ capacity factors of projects where the employee is Project Lead or Technical Lead
 * (counted once per project when holding both). Must not exceed 2.0.
 */
export function leadershipLoad(userId: string, initiatives: Initiative[], members: InitiativeMember[], opts: { includePending?: boolean; excludeInitiativeId?: string } = {}) {
  const items: { initiativeId: string; type: ProjectType; factor: number; roles: ProjectRole[] }[] = [];
  for (const m of members) {
    if (m.userId !== userId || !isLiveMember(m)) continue;
    if (!m.roles.some((r) => ROLE_META[r].leadership)) continue;
    if (opts.excludeInitiativeId && m.initiativeId === opts.excludeInitiativeId) continue;
    const ini = initiatives.find((i) => i.id === m.initiativeId);
    if (!ini) continue;
    const pending = ini.status === "submitted" || ini.status === "screening" || ini.status === "evaluation";
    if (!LIVE_STATUSES.has(ini.status) && !(opts.includePending && pending)) continue;
    items.push({ initiativeId: ini.id, type: ini.type, factor: PROJECT_TYPE_META[ini.type].capacityFactor, roles: m.roles.filter((r) => ROLE_META[r].leadership) });
  }
  const used = items.reduce((s, i) => s + i.factor, 0);
  return { used, remaining: Math.max(0, POLICY.leadershipCapacity - used), items };
}

/** Would adding a leadership role on this initiative breach the 2.0 limit? */
export function capacityCheck(userId: string, initiative: Pick<Initiative, "id" | "type">, roles: ProjectRole[], initiatives: Initiative[], members: InitiativeMember[]) {
  const load = leadershipLoad(userId, initiatives, members, { includePending: true, excludeInitiativeId: initiative.id });
  const adds = roles.some((r) => ROLE_META[r].leadership) ? PROJECT_TYPE_META[initiative.type].capacityFactor : 0;
  const after = load.used + adds;
  return { before: load.used, after, ok: after <= POLICY.leadershipCapacity + 1e-9, adds };
}

export function concurrentMemberships(userId: string, initiatives: Initiative[], members: InitiativeMember[], excludeInitiativeId?: string) {
  return members.filter((m) => m.userId === userId && m.initiativeId !== excludeInitiativeId && isLiveMember(m) && LIVE_STATUSES.has(initiatives.find((i) => i.id === m.initiativeId)?.status ?? "")).length;
}

/* ───────────────────────── §1.2 / §2.1 / §4.5 eligibility ───────────────────────── */

export interface EligibilityResult {
  ok: boolean;
  blockers: string[];
  warnings: string[];
}

/** §2.1 — may this employee propose or join a project? */
export function participationEligibility(p: EmployeeProfile | undefined, atIso = new Date().toISOString()): EligibilityResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!p) return { ok: false, blockers: ["No HR record — eligibility cannot be verified"], warnings };
  if (!EMPLOYMENT_META[p.employmentType].eligible) blockers.push(`${EMPLOYMENT_META[p.employmentType].label} staff are not eligible (§1.2)`);
  if (p.separation && Date.parse(p.separation.effectiveAt) <= Date.parse(atIso)) blockers.push("No longer employed");
  if (p.resignationNoticeAt) blockers.push("Under notice of resignation");
  if (p.terminationNoticeAt) blockers.push("Under notice of termination");
  if (!p.goodStanding) blockers.push("Not in good standing (active disciplinary action)");
  if (p.activeWrittenWarning) blockers.push("Active written warning");
  if (p.onPIP && !p.pipApprovedByPRC) blockers.push("On a performance improvement plan (needs PRC approval)");
  if (p.underInvestigation) blockers.push("Under investigation for serious misconduct");
  if (p.suspended) blockers.push("Suspended");
  if (p.unpaidLeaveDays > POLICY.unpaidLeaveMaxDays) blockers.push(`Unpaid leave over ${POLICY.unpaidLeaveMaxDays} consecutive days`);
  if (p.employmentType === "probationary") warnings.push("Probationary — bonuses are withheld until probation is completed (§6.8)");
  if (!p.acknowledgmentSignedAt) warnings.push("Bonus acknowledgment form not yet signed (§4.5)");
  if (p.onPIP && p.pipApprovedByPRC) warnings.push("On PIP — participation approved by PRC");
  return { ok: blockers.length === 0, blockers, warnings };
}

export type PaymentOutcome =
  | { kind: "pay" }
  | { kind: "withhold_probation" }
  | { kind: "forfeit"; reason: string }
  | { kind: "hold"; reason: string };

/** §4.5 / §6.8 — conditions on the scheduled payment date. `revenueMonth` is the month the bonus was earned. */
export function paymentOutcome(p: EmployeeProfile | undefined, payIso: string, revenueMonth: string): PaymentOutcome {
  if (!p) return { kind: "hold", reason: "No HR record" };
  const pay = Date.parse(payIso);
  if (!EMPLOYMENT_META[p.employmentType].eligible) return { kind: "forfeit", reason: `${EMPLOYMENT_META[p.employmentType].label} — not eligible` };
  if (p.resignationNoticeAt && Date.parse(p.resignationNoticeAt) <= pay) return { kind: "forfeit", reason: "Resignation submitted — unpaid bonuses forfeited (§4.5)" };
  const sep = p.separation;
  if (sep && Date.parse(sep.effectiveAt) <= pay) {
    switch (sep.kind) {
      case "termination_for_cause":
        return { kind: "forfeit", reason: "Terminated for cause (§4.5)" };
      case "resignation":
      case "probation_failed":
        return { kind: "forfeit", reason: sep.kind === "resignation" ? "Resigned (§4.5)" : "Probation not completed (§6.8)" };
      case "termination_without_cause":
        // completed work where revenue recognised before the termination date is paid
        return Date.parse(monthEnd(revenueMonth)) < Date.parse(sep.effectiveAt) ? { kind: "pay" } : { kind: "forfeit", reason: "Revenue recognised after termination date (§4.5)" };
      case "retirement":
        if ((sep.retirementNoticeDays ?? 0) < POLICY.retirementNoticeDays) return { kind: "hold", reason: "Retirement with < 60 days notice — PRC decision required" };
        return Date.parse(monthStart(revenueMonth)) <= Date.parse(sep.effectiveAt) ? { kind: "pay" } : { kind: "forfeit", reason: "After retirement date" };
      case "death_disability":
        return Date.parse(monthStart(revenueMonth)) <= Date.parse(sep.effectiveAt) ? { kind: "pay" } : { kind: "forfeit", reason: "After event date" };
    }
  }
  if (p.terminationNoticeAt && Date.parse(p.terminationNoticeAt) <= pay) return { kind: "hold", reason: "Under notice of termination — PRC determines final payment within 30 days" };
  if (p.suspended) return { kind: "forfeit", reason: "Disciplinary suspension — bonuses during suspension forfeited (§4.5)" };
  if (!p.goodStanding || p.activeWrittenWarning || (p.onPIP && !p.pipApprovedByPRC)) return { kind: "hold", reason: "Not in good standing — payment resumes on return to good standing" };
  if (p.unpaidLeaveDays > POLICY.unpaidLeaveMaxDays) return { kind: "hold", reason: "Unpaid leave > 30 days — payable on return" };
  if (p.employmentType === "probationary" && (!p.probationEndDate || Date.parse(p.probationEndDate) > pay)) return { kind: "withhold_probation" };
  return { kind: "pay" };
}

/* ───────────────────────── §6.3 deferral ───────────────────────── */

export function deferralTriggers(i: Initiative, adjustments: ShareAdjustment[] = []) {
  const reasons: string[] = [];
  const econ = proposalEconomics(i, adjustments, i.approvedAt ?? i.createdAt);
  if (econ.expected.net > POLICY.deferral.netRevenueThreshold) reasons.push("Net revenue above US$200k equivalent");
  if (i.type === "C" && i.warranty) reasons.push("Type C with manufacturing warranty");
  if (i.paymentTermsDays > POLICY.deferral.paymentTermsDays) reasons.push(`Payment terms ${i.paymentTermsDays} days (> 90)`);
  if (i.newClient) reasons.push("New client without payment history");
  if (i.highRisk) reasons.push("Classified high risk by PRC");
  return reasons;
}

/* ───────────────────────── §6.1 monthly run ───────────────────────── */

export interface RunInputs {
  month: string;
  initiatives: Initiative[];
  members: InitiativeMember[];
  entries: RevenueEntry[];
  profiles: EmployeeProfile[];
  adjustments: ShareAdjustment[];
  overheads: number;
  ebitda: number;
  shareOverrides?: Partial<Record<ProjectType, number>>;
  partialDeferralPct?: number; // 0–100 corrective carry-over
  /** bonuses already paid this fiscal year per user (for the 200 % cap) */
  paidYtd?: Map<string, number>;
}

export interface ProjectRunResult {
  initiativeId: string;
  revenue: number;
  directCosts: number;
  tax: number;
  net: number;
  sharePct: number;
  poolRaw: number;
  poolCap: number;
  pool: number;
  capped: boolean;
  deferralReasons: string[];
  totalWeight: number;
}

export interface RunResult {
  month: string;
  projects: ProjectRunResult[];
  lines: BonusLine[];
  totals: BonusRun["totals"];
  revenue: number;
  directCosts: number;
  taxes: number;
  operatingResult: number;
  passed: boolean;
  suggestion: { kind: "reduce_share"; overrides: Partial<Record<ProjectType, number>>; operatingResult: number } | { kind: "partial_deferral"; pct: number; operatingResult: number } | null;
}

export function computeRun(inp: RunInputs): RunResult {
  const payIso = paymentDate(inp.month);
  const start = Date.parse(monthStart(inp.month));
  const end = Date.parse(monthEnd(inp.month));
  const poolCapBase = Math.min(Math.max(0, inp.ebitda) * POLICY.poolCapEbitdaPct, POLICY.poolCapAbsolute);
  const carryPct = Math.min(100, Math.max(0, inp.partialDeferralPct ?? 0)) / 100;

  const projects: ProjectRunResult[] = [];
  const lines: BonusLine[] = [];

  for (const ini of inp.initiatives) {
    if (!["active", "completed", "approved"].includes(ini.status)) continue;
    const entries = inp.entries.filter((e) => e.initiativeId === ini.id && e.month === inp.month && (e.basis === "recognized" || e.received));
    if (!entries.length) continue;
    const revenue = entries.reduce((s, e) => s + e.revenue, 0);
    const directCosts = entries.reduce((s, e) => s + e.directCosts, 0);
    const { tax, net } = netRevenue(revenue, directCosts);
    const sharePct = projectShare(ini, inp.adjustments, monthStart(inp.month), inp.shareOverrides?.[ini.type]);
    const poolRaw = Math.max(0, net) * sharePct;
    const poolCap = ini.capException ? Number.POSITIVE_INFINITY : poolCapBase;
    const pool = Math.min(poolRaw, poolCap);
    const deferralReasons = deferralTriggers(ini, inp.adjustments);

    const team = inp.members.filter(
      (m) =>
        m.initiativeId === ini.id &&
        m.consent === "accepted" &&
        m.prcApproved &&
        Date.parse(m.joinedAt) <= end &&
        (!m.leftAt || Date.parse(m.leftAt) >= start),
    );
    const weights = team.map((m) => ({ userId: m.userId, weight: memberWeight(m) }));
    const split = splitBonus(weights, 1, pool); // pool already = R × P (capped)
    projects.push({ initiativeId: ini.id, revenue, directCosts, tax, net, sharePct, poolRaw, poolCap: Number.isFinite(poolCap) ? poolCap : -1, pool, capped: poolRaw > pool + 0.5, deferralReasons, totalWeight: split.total });

    for (const s of split.shares) {
      const profile = inp.profiles.find((p) => p.userId === s.userId);
      const member = team.find((m) => m.userId === s.userId)!;
      const line: BonusLine = {
        initiativeId: ini.id,
        userId: s.userId,
        weight: s.weight,
        totalWeight: split.total,
        sharePct,
        netRevenue: net,
        pool,
        gross: s.bonus,
        payable: 0,
        deferred: 0,
        carriedOver: 0,
        withheld: 0,
        forfeited: 0,
        held: 0,
        status: "payable",
        notes: [],
      };
      if (member.removal.stage === "removed") line.notes.push("Removed from project — prorated for satisfactory work (§5.3)");
      if (member.leftAt && Date.parse(member.leftAt) < end) line.notes.push("Left during month — role change effective prospectively (§7.2)");

      const outcome = paymentOutcome(profile, payIso, inp.month);
      let amount = s.bonus;
      if (outcome.kind === "forfeit") {
        line.forfeited = amount;
        line.status = "forfeited";
        line.notes.push(outcome.reason);
        lines.push(line);
        continue;
      }
      if (outcome.kind === "hold") {
        line.held = amount;
        line.status = "held";
        line.notes.push(outcome.reason);
        lines.push(line);
        continue;
      }
      // §6.3 high-risk deferral (30 %)
      if (deferralReasons.length) {
        line.deferred = amount * POLICY.deferral.pct;
        amount -= line.deferred;
        line.notes.push(`30% deferred ${ini.deferralMonths} months: ${deferralReasons.join("; ")}`);
      }
      // §6.1 corrective partial deferral to next month
      if (carryPct > 0) {
        line.carriedOver = amount * carryPct;
        amount -= line.carriedOver;
      }
      if (outcome.kind === "withhold_probation") {
        line.withheld = amount;
        line.status = "withheld_probation";
        line.notes.push("Probationary — accrued until probation completion (§6.8)");
        lines.push(line);
        continue;
      }
      line.payable = amount;
      line.status = line.deferred || line.carriedOver ? "partially_deferred" : "payable";
      lines.push(line);
    }
  }

  // §6.2 per-person annual cap: 200 % of base salary
  const ytd = new Map(inp.paidYtd ?? []);
  for (const line of lines) {
    if (line.payable <= 0) continue;
    const profile = inp.profiles.find((p) => p.userId === line.userId);
    if (!profile) continue;
    const cap = profile.annualBaseSalary * POLICY.personAnnualCapOfSalary;
    const already = ytd.get(line.userId) ?? 0;
    const room = Math.max(0, cap - already);
    if (line.payable > room) {
      line.held += line.payable - room;
      line.payable = room;
      line.status = "cap_review";
      line.notes.push("Exceeds 200% of annual base salary — needs CEO + PRC approval (§6.2)");
    }
    ytd.set(line.userId, already + line.payable);
  }

  const sum = (k: keyof Pick<BonusLine, "payable" | "deferred" | "withheld" | "forfeited" | "held" | "carriedOver">) => lines.reduce((s, l) => s + l[k], 0);
  const revenue = projects.reduce((s, p) => s + p.revenue, 0);
  const directCosts = projects.reduce((s, p) => s + p.directCosts, 0);
  const taxes = projects.reduce((s, p) => s + p.tax, 0);
  const poolTotal = projects.reduce((s, p) => s + p.pool, 0);
  // §6.1 Operating Result = Σ net project revenue − Σ direct project costs − monthly overheads − planned bonus pool.
  // "Net project revenue" here is recognised revenue less estimated taxes, so direct costs are subtracted once.
  // A corrective partial deferral (§6.1 option 2) moves part of the pool to next month, so only the remainder is planned now.
  const plannedPool = poolTotal * (1 - carryPct);
  const operatingResult = revenue - taxes - directCosts - inp.overheads - plannedPool;
  const passed = operatingResult >= 0;

  let suggestion: RunResult["suggestion"] = null;
  if (!passed) suggestion = suggestCorrection(inp, projects, operatingResult);

  return {
    month: inp.month,
    projects,
    lines,
    totals: { netRevenue: projects.reduce((s, p) => s + p.net, 0), pool: poolTotal, payable: sum("payable"), deferred: sum("deferred"), withheld: sum("withheld"), forfeited: sum("forfeited"), held: sum("held"), carriedOver: sum("carriedOver") },
    revenue,
    directCosts,
    taxes,
    operatingResult,
    passed,
    suggestion,
  };
}

/** §6.1 corrective action: lower shares toward the 10 % floor; if still failing, propose a partial deferral. */
function suggestCorrection(inp: RunInputs, projects: ProjectRunResult[], operatingResult: number): RunResult["suggestion"] {
  const shortfall = -operatingResult;
  const poolTotal = projects.reduce((s, p) => s + p.pool, 0);
  if (poolTotal <= 0) return null;
  // pool reachable at the 10 % floor
  const floorPool = projects.reduce((s, p) => {
    const ini = inp.initiatives.find((i) => i.id === p.initiativeId)!;
    return s + Math.min(Math.max(0, p.net) * PROJECT_TYPE_META[ini.type].range[0], p.pool);
  }, 0);
  if (poolTotal - floorPool >= shortfall) {
    const k = (poolTotal - shortfall) / poolTotal; // uniform scale on every project's share
    const overrides: Partial<Record<ProjectType, number>> = {};
    for (const p of projects) {
      const ini = inp.initiatives.find((i) => i.id === p.initiativeId)!;
      const min = PROJECT_TYPE_META[ini.type].range[0];
      const proposed = Math.max(min, Math.floor(p.sharePct * k * 100) / 100);
      overrides[ini.type] = Math.min(overrides[ini.type] ?? 1, proposed);
    }
    const check = computeRun({ ...inp, shareOverrides: overrides });
    return { kind: "reduce_share", overrides, operatingResult: check.operatingResult };
  }
  // still failing at the floor → defer part of the payout to next month (pool is still "planned", so report what is released now)
  const pct = Math.min(100, Math.ceil((shortfall / poolTotal) * 100));
  const check = computeRun({ ...inp, partialDeferralPct: pct });
  return { kind: "partial_deferral", pct, operatingResult: check.operatingResult };
}

/* ───────────────────────── §6.4 clawback ───────────────────────── */

export function clawbackAmount(c: Pick<Clawback, "originalPaid" | "recalculated">) {
  return Math.max(0, c.originalPaid - c.recalculated);
}

export function clawbackExempt(c: Pick<Clawback, "trigger" | "personallyAtFault" | "originalPaid" | "recalculated" | "paidAt">, atIso = new Date().toISOString()) {
  if (Date.parse(atIso) > Date.parse(addMonths(c.paidAt, POLICY.clawback.windowMonths))) return "Outside the 24-month clawback window";
  if (c.trigger === "data_error" && !c.personallyAtFault && clawbackAmount(c) <= POLICY.clawback.dataErrorDeMinimis) return "Data error not caused by employee and overpayment ≤ US$10k equivalent";
  return null;
}

/** Recovery by salary deduction over 6–12 months, max 20 % of monthly gross salary. */
export function clawbackSchedule(amount: number, annualBaseSalary: number) {
  const monthlyCap = (annualBaseSalary / 12) * POLICY.clawback.maxSalaryDeductionPct;
  for (let n = POLICY.clawback.minMonths; n <= POLICY.clawback.maxMonths; n++) {
    if (amount / n <= monthlyCap + 0.5) return { months: n, monthly: amount / n, feasible: true, monthlyCap };
  }
  return { months: POLICY.clawback.maxMonths, monthly: monthlyCap, feasible: false, monthlyCap };
}

/* ───────────────────────── ledgers ───────────────────────── */

export function probationBalance(userId: string, runs: BonusRun[]) {
  return runs.filter((r) => r.status === "released" || r.status === "certified").reduce((s, r) => s + r.lines.filter((l) => l.userId === userId).reduce((a, l) => a + l.withheld, 0), 0);
}

export function paidInYear(userId: string, runs: BonusRun[], year: string, deferred: DeferredBonus[] = []) {
  const fromRuns = runs.filter((r) => r.status === "released" && r.month.startsWith(year)).reduce((s, r) => s + r.lines.filter((l) => l.userId === userId).reduce((a, l) => a + l.payable, 0), 0);
  const fromDeferred = deferred.filter((d) => d.userId === userId && d.status === "released" && d.vestAt.startsWith(year)).reduce((s, d) => s + d.releasedAmount, 0);
  return fromRuns + fromDeferred;
}

/* ───────────────────────── §2.2 completeness ───────────────────────── */

export function proposalGaps(i: Initiative, members: InitiativeMember[]) {
  const gaps: string[] = [];
  if (i.title.trim().length < 4) gaps.push("Project title");
  if (i.summary.trim().length < 40) gaps.push("Executive summary (2.2.1)");
  if (!i.valueProposition.trim()) gaps.push("Value proposition & strategic rationale (2.2.1)");
  if (i.scope.trim().length < 20) gaps.push("Scope of work (2.2.2)");
  if (!i.deliverables.trim()) gaps.push("Deliverables & acceptance criteria (2.2.2)");
  if (!i.successCriteria.trim()) gaps.push("Performance metrics & success criteria (2.2.2)");
  if (!i.startDate || !i.endDate || Date.parse(i.endDate) <= Date.parse(i.startDate)) gaps.push("Timeline with start and completion dates (2.2.3)");
  if (!i.milestones.length) gaps.push("At least one milestone (2.2.3)");
  if (i.revenue.expected <= 0) gaps.push("Revenue forecast (2.2.5)");
  if (!(i.revenue.worst <= i.revenue.expected && i.revenue.expected <= i.revenue.best)) gaps.push("Scenarios must satisfy worst ≤ expected ≤ best (2.2.5)");
  if (!i.companyId) gaps.push("Client (2.2.6)");
  if (i.risks.length < 2) gaps.push("Risk assessment — at least two risks with mitigations (2.2.7)");
  const live = members.filter((m) => m.initiativeId === i.id && m.consent !== "declined");
  if (!live.some((m) => m.roles.includes("project_lead"))) gaps.push("Project Lead assigned (2.4)");
  if (live.length < 2) gaps.push("Proposed team composition (2.2.4)");
  return gaps;
}
