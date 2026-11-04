/*
 * Compensation engine for the Project Initiative and Compensation Policy v4.0 (docs/policy/v4.0.md).
 * Pure functions only — no store / React — so they can be verified against the policy's worked
 * examples (§16) by scripts/verify-policy.ts.
 */
import type { BonusLine, BonusRun, Clawback, CurveAdjustment, DeferredBonus, EmployeeProfile, Initiative, InitiativeMember, ProjectRole, ProjectType, RevenueEntry } from "./types";
import { CURVE, EMPLOYMENT_META, POLICY, POLICY_DATED, POLICY_EFFECTIVE, PROJECT_TYPE_META, ROLE_META, SPECIALIST_RANGE, type ApprovalTier, type Curve } from "./policy";

const DAY = 86_400_000;
const WIB = 7 * 3_600_000;
/** §8.5 amounts are rounded down to the nearest whole rupiah. */
export const floorRp = (n: number) => Math.floor(n + 1e-6);
export const round = (n: number) => Math.round(n);

/* ───────────────────────── dates (WIB) ───────────────────────── */

export function monthKey(iso: string | number | Date) {
  const t = typeof iso === "string" ? Date.parse(iso) : new Date(iso).getTime();
  return new Date(t + WIB).toISOString().slice(0, 7);
}
export function monthStart(month: string) {
  return new Date(`${month}-01T00:00:00+07:00`).toISOString();
}
export function monthEnd(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1) - WIB - 1).toISOString();
}
export function nextMonth(month: string, n = 1) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
export function monthsBetween(fromMonth: string, toMonth: string) {
  const [y1, m1] = fromMonth.split("-").map(Number);
  const [y2, m2] = toMonth.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}
const dayOf = (month: string, day: number, hour = 9) => new Date(`${month}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+07:00`).toISOString();
/** §8.2 salary date (usually the 25th) on which a cycle's authorised bonuses are paid. */
export function paymentDate(month: string) {
  return dayOf(month, POLICY.cycle.salaryDay);
}
/** §8.2 revenue collected by the 20th is paid that month; after the 20th, the following month. */
export function cycleMonth(collectedIso: string) {
  const m = monthKey(collectedIso);
  const day = Number(new Date(Date.parse(collectedIso) + WIB).toISOString().slice(8, 10));
  return day <= POLICY.cycle.cutoffDay ? m : nextMonth(m);
}
/** Collection window of a cycle: 21st of the previous month → 20th of this month. */
export function collectionWindow(month: string) {
  return { from: dayOf(nextMonth(month, -1), POLICY.cycle.cutoffDay + 1, 0), to: dayOf(month, POLICY.cycle.cutoffDay, 23) };
}
/** §8.2 the CFO certifies the break-even test and cash check by the 23rd. */
export function breakEvenDeadline(month: string) {
  return dayOf(month, POLICY.cycle.certifyDay, 17);
}
export function provisionalDeadline(month: string) {
  return dayOf(month, POLICY.cycle.provisionalDay, 17);
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
    const wd = new Date(d.getTime() + WIB).getUTCDay();
    if (wd !== 0 && wd !== 6) added++;
  }
  return d.toISOString();
}
export function businessDaysBetween(fromIso: string, toIso: string) {
  let n = 0;
  const end = Date.parse(toIso);
  for (let t = Date.parse(fromIso) + DAY; t <= end; t += DAY) {
    const wd = new Date(t + WIB).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}
const dayIndex = (iso: string) => Math.floor((Date.parse(iso) + WIB) / DAY);
/** Inclusive calendar days two WIB date ranges share. */
export function overlapDays(aStart: string, aEnd: string | null, bStart: string, bEnd: string) {
  const s = Math.max(dayIndex(aStart), dayIndex(bStart));
  const e = Math.min(aEnd ? dayIndex(aEnd) : Number.POSITIVE_INFINITY, dayIndex(bEnd));
  return Math.max(0, e - s + 1);
}
export const daysInMonth = (month: string) => dayIndex(monthEnd(month)) - dayIndex(monthStart(month)) + 1;

/* ───────────────────────── §5 net revenue & the revenue-share curve ───────────────────────── */

/** §5.4 estimated taxes: UMKM final tax 0.5 % of revenue (due even at a loss); corporate income tax on margin after the switch. */
export function estimatedTax(revenue: number, directCosts: number, otherTaxes = 0) {
  if (POLICY.tax.regime === "umkm") return Math.max(0, revenue) * POLICY.tax.umkmRate + otherTaxes;
  return Math.max(0, revenue - directCosts) * POLICY.tax.corporateEffectiveRate + otherTaxes;
}

/** §5.2 Net revenue = Project revenue − Direct costs − Estimated taxes. */
export function netRevenue(revenue: number, directCosts: number, otherTaxes = 0) {
  const profit = revenue - directCosts;
  const tax = estimatedTax(revenue, directCosts, otherTaxes);
  return { profit, tax, net: profit - tax };
}

export function directCostTotal(c: Initiative["costs"]) {
  const base = c.materials + c.subcontractors + c.equipment + c.travel + c.other;
  return base * (1 + c.contingencyPct / 100);
}

/** §5.1 / §9.5 y = S ÷ (1 + (S ÷ F − 1) × x ÷ D); F at and above D. Not rounded (§5.1). */
export function revenueShareRate(x: number, curve: Curve = CURVE) {
  if (x >= curve.decay) return curve.floor;
  const xx = Math.max(0, x);
  return curve.start / (1 + (curve.start / curve.floor - 1) * (xx / curve.decay));
}

/** Curve in force on a date, after any announced §9.5 changes. */
export function curveInForce(adjustments: CurveAdjustment[], atIso: string): Curve {
  const applicable = adjustments.filter((a) => Date.parse(a.effectiveFrom) <= Date.parse(atIso)).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return applicable.length ? applicable[applicable.length - 1].to : CURVE;
}

/** §5.1 contracted duration in whole months, rounded up (start → final delivery). */
export function contractedMonths(i: Pick<Initiative, "startDate" | "endDate">) {
  const s = new Date(Date.parse(i.startDate) + WIB);
  const e = new Date(Date.parse(i.endDate) + WIB);
  // e.g. 1 Jan → 30 Jun = 6; 15 Jan → 14 Jul = 6; 15 Jan → 20 Jul = 7 (part month rounds up)
  let months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
  if (e.getUTCDate() >= s.getUTCDate()) months += 1;
  return Math.max(1, months);
}

/** §5.1 projected annual net revenue x. */
export function projectedAnnualNet(totalNet: number, months: number) {
  return months <= 12 ? totalNet : (totalNet * 12) / months;
}

export interface ProjectRate {
  rate: number;
  x: number;
  months: number;
  projectedNet: number;
  source: "fixed" | "v3_flat" | "curve" | "provisional";
  curve: Curve;
}

/**
 * The project's revenue-share rate: fixed by the PRC (or kept flat from v3.0, §15.1); otherwise
 * computed from the expected case on the curve in force at approval (projects keep their curve, §9.5).
 */
export function projectRate(i: Initiative, adjustments: CurveAdjustment[] = []): ProjectRate {
  const months = contractedMonths(i);
  const projectedNet = netRevenue(i.revenue.expected, directCostTotal(i.costs)).net;
  const x = projectedAnnualNet(projectedNet, months);
  const curve = curveInForce(adjustments, i.approvedAt ?? i.submittedAt ?? i.createdAt);
  if (i.lockedSharePct != null) return { rate: i.lockedSharePct, x, months, projectedNet, source: i.policyVersion === "3.0" ? "v3_flat" : "fixed", curve };
  if (i.revenue.expected <= 0) return { rate: revenueShareRate(0, curve), x: 0, months, projectedNet: 0, source: "provisional", curve };
  return { rate: revenueShareRate(x, curve), x, months, projectedNet, source: "curve", curve };
}

/** §4.3 / Annex A profitability preview for each scenario — one rate, set from the expected case. */
export function proposalEconomics(initiative: Initiative, adjustments: CurveAdjustment[] = []) {
  const costs = directCostTotal(initiative.costs);
  const r = projectRate(initiative, adjustments);
  const scenario = (revenue: number) => {
    const { profit, tax, net } = netRevenue(revenue, costs);
    const pool = floorRp(Math.max(0, net) * r.rate);
    return { revenue, costs, profit, tax, net, pool, companyMargin: net - pool, marginPct: revenue > 0 ? (net - pool) / revenue : 0 };
  };
  // break-even revenue: net = 0 → R × (1 − t) = costs under UMKM; R = costs under corporate tax
  const breakEvenRevenue = POLICY.tax.regime === "umkm" ? costs / (1 - POLICY.tax.umkmRate) : costs;
  return { share: r.rate, rate: r, costs, expected: scenario(initiative.revenue.expected), best: scenario(initiative.revenue.best), worst: scenario(initiative.revenue.worst), breakEvenRevenue, tier: approvalTier(initiative) };
}

/** §4.2 approval tier from contract value (expected revenue excl. VAT), type and risk. */
export function approvalTier(i: Pick<Initiative, "type" | "revenue" | "newClient" | "unusualTerms">): { tier: ApprovalTier; reasons: string[] } {
  const value = i.revenue.expected;
  const t3: string[] = [];
  if (i.type === "C") t3.push("Any Type C project is Tier 3");
  if (value > POLICY.tiers.majorAbove) t3.push("Contract value over Rp2,000,000,000");
  if (i.unusualTerms) t3.push("New country or market, or unusual liability terms");
  if (t3.length) return { tier: 3, reasons: t3 };
  const t2: string[] = [];
  if (value >= POLICY.tiers.fastTrackBelow) t2.push("Contract value Rp400,000,000 to Rp2,000,000,000");
  if (i.newClient) t2.push("Fast-track needs an existing client with good payment history");
  if (t2.length) return { tier: 2, reasons: t2 };
  return { tier: 1, reasons: ["Type A or B under Rp400,000,000 with an existing client"] };
}

/* ───────────────────────── §6 roles, weights & the bonus formula ───────────────────────── */

export function roleWeight(role: ProjectRole, specialistWeight: number | null = null) {
  if (role === "specialist") {
    const w = specialistWeight ?? ROLE_META.specialist.weight;
    return Math.min(SPECIALIST_RANGE[1], Math.max(SPECIALIST_RANGE[0], w));
  }
  return ROLE_META[role].weight;
}

/** §6.3 weights add up across roles; an agreed non-standard weight (§6.7/§6.8) replaces the total. */
export function memberWeight(m: Pick<InitiativeMember, "roles" | "specialistWeight" | "weightOverride">) {
  if (m.weightOverride != null) return m.weightOverride;
  return m.roles.reduce((s, r) => s + roleWeight(r, m.specialistWeight), 0);
}
export const allocationFactorOf = (m: Pick<InitiativeMember, "allocationFactor">) => m.allocationFactor ?? 1;
/** W × A */
export const effectiveWeight = (m: Pick<InitiativeMember, "roles" | "specialistWeight" | "weightOverride" | "allocationFactor">) => memberWeight(m) * allocationFactorOf(m);

/** §3.1 part-time allocation factor may not exceed contracted hours ÷ full-time, rounded down to 0.25. */
export function maxAllocationFactor(p: EmployeeProfile | undefined) {
  if (!p || p.employmentType !== "part_time") return 1;
  const pct = Math.min(100, Math.max(0, p.contractedHoursPct ?? 50));
  return Math.max(0.25, Math.floor((pct / 100) * 4) / 4);
}

/** §6.6 with everyone on the team for the whole work period at A = 1: B_i = W_i / ΣW × y × net (rounded down). */
export function splitBonus(weights: { userId: string; weight: number }[], sharePct: number, net: number) {
  const total = weights.reduce((s, w) => s + w.weight, 0);
  const pool = floorRp(Math.max(0, net) * sharePct);
  return { total, pool, shares: weights.map((w) => ({ userId: w.userId, weight: w.weight, bonus: total > 0 ? floorRp((w.weight / total) * pool) : 0 })) };
}

/** Ledger row interval on the team, clipped at the employee's last day (nobody earns for work after leaving). */
function rowEnd(m: InitiativeMember, profile: EmployeeProfile | undefined) {
  const ends = [m.leftAt, profile?.separation?.effectiveAt ?? null].filter(Boolean) as string[];
  return ends.length ? ends.sort()[0] : null;
}

/** Members whose ledger rows count: agreed (consent), PRC-checked, not declined. */
export function ledgerRows(members: InitiativeMember[], initiativeId: string) {
  return members.filter((m) => m.initiativeId === initiativeId && m.consent === "accepted" && m.prcApproved);
}

/**
 * §6.5–6.6 share a payment's pool Q among the people on the team during its work period:
 * B_i = E_i ÷ ΣE × Q with E_i = W_i × A_i × d_i (rows of the same person are summed).
 */
export function shareByWeightDays(rows: InitiativeMember[], periodStart: string, periodEnd: string, pool: number, profiles: EmployeeProfile[] = []) {
  const byUser = new Map<string, { e: number; w: number }>();
  for (const m of rows) {
    const d = overlapDays(m.joinedAt, rowEnd(m, profiles.find((p) => p.userId === m.userId)), periodStart, periodEnd);
    if (d <= 0) continue;
    const cur = byUser.get(m.userId) ?? { e: 0, w: 0 };
    cur.e += effectiveWeight(m) * d;
    cur.w = Math.max(cur.w, effectiveWeight(m));
    byUser.set(m.userId, cur);
  }
  const totalE = [...byUser.values()].reduce((s, v) => s + v.e, 0);
  return {
    totalE,
    shares: [...byUser.entries()].map(([userId, v]) => ({ userId, weightDays: v.e, weight: v.w, bonus: totalE > 0 ? floorRp((v.e / totalE) * pool) : 0 })),
  };
}

/* ───────────────────────── §7 workload & capacity ───────────────────────── */

const LIVE_STATUSES = new Set(["approved", "conditional", "active"]);
const NON_LEAD: ProjectRole[] = ["engineer", "secretary", "specialist"];

export function isLiveMember(m: InitiativeMember, atIso = new Date().toISOString()) {
  return m.consent !== "declined" && m.removal.stage !== "removed" && (!m.leftAt || Date.parse(m.leftAt) > Date.parse(atIso));
}

/** §7.3 leadership capacity: Σ capacity factors of projects led (PL and TL on one project count once); max 2.0. */
export function leadershipLoad(userId: string, initiatives: Initiative[], members: InitiativeMember[], opts: { includePending?: boolean; excludeInitiativeId?: string } = {}) {
  const items: { initiativeId: string; type: ProjectType; factor: number; roles: ProjectRole[] }[] = [];
  const seen = new Set<string>();
  for (const m of members) {
    if (m.userId !== userId || !isLiveMember(m)) continue;
    if (!m.roles.some((r) => ROLE_META[r].leadership)) continue;
    if (opts.excludeInitiativeId && m.initiativeId === opts.excludeInitiativeId) continue;
    if (seen.has(m.initiativeId)) continue;
    const ini = initiatives.find((i) => i.id === m.initiativeId);
    if (!ini) continue;
    const pending = ini.status === "submitted" || ini.status === "screening" || ini.status === "evaluation";
    if (!LIVE_STATUSES.has(ini.status) && !(opts.includePending && pending)) continue;
    seen.add(m.initiativeId);
    items.push({ initiativeId: ini.id, type: ini.type, factor: PROJECT_TYPE_META[ini.type].capacityFactor, roles: m.roles.filter((r) => ROLE_META[r].leadership) });
  }
  const used = items.reduce((s, i) => s + i.factor, 0);
  return { used, remaining: Math.max(0, POLICY.leadershipCapacity - used), items };
}

/** Would adding a lead role on this initiative breach the 2.0 limit? */
export function capacityCheck(userId: string, initiative: Pick<Initiative, "id" | "type">, roles: ProjectRole[], initiatives: Initiative[], members: InitiativeMember[]) {
  const load = leadershipLoad(userId, initiatives, members, { includePending: true, excludeInitiativeId: initiative.id });
  const adds = roles.some((r) => ROLE_META[r].leadership) ? PROJECT_TYPE_META[initiative.type].capacityFactor : 0;
  const after = load.used + adds;
  return { before: load.used, after, ok: after <= POLICY.leadershipCapacity + 1e-9, adds };
}

/** §7.1 concurrent non-lead roles (Engineer, Secretary, Specialist) on live projects; more than 3 needs line manager + PRC approval. */
export function concurrentNonLeadRoles(userId: string, initiatives: Initiative[], members: InitiativeMember[], excludeInitiativeId?: string) {
  const ids = new Set(
    members
      .filter((m) => m.userId === userId && m.initiativeId !== excludeInitiativeId && isLiveMember(m) && m.roles.some((r) => NON_LEAD.includes(r)) && LIVE_STATUSES.has(initiatives.find((i) => i.id === m.initiativeId)?.status ?? ""))
      .map((m) => m.initiativeId),
  );
  return ids.size;
}
/** @deprecated v3 name — counts §7.1 non-lead roles. */
export const concurrentMemberships = concurrentNonLeadRoles;

/* ───────────────────────── §3 eligibility, §10–11 payment conditions ───────────────────────── */

export interface EligibilityResult {
  ok: boolean;
  blockers: string[];
  warnings: string[];
}

/** §3 — may this employee propose or join a project (take a new role)? */
export function participationEligibility(p: EmployeeProfile | undefined, atIso = new Date().toISOString()): EligibilityResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!p) return { ok: false, blockers: ["No HR record — HR must confirm eligibility (§3.5)"], warnings };
  const at = Date.parse(atIso);
  if (!EMPLOYMENT_META[p.employmentType].eligible) blockers.push(`${EMPLOYMENT_META[p.employmentType].label} may not take part; their cost is a direct cost (§3.2)`);
  if (p.separation && Date.parse(p.separation.effectiveAt) <= at) blockers.push("No longer employed / in an eligible status");
  if (p.resignationNoticeAt || p.terminationNoticeAt) blockers.push("Under notice — no new project roles; earned bonuses are still paid (§3.1, §10)");
  if (p.activeWrittenWarning) blockers.push("Active formal written warning (Surat Peringatan) — no new roles (§3.1)");
  if (!p.goodStanding) blockers.push("Not in good standing (§2)");
  if (p.onPIP && !p.pipApprovedByPRC) blockers.push("On a Performance Improvement Plan — needs a written PRC exception (§3.2)");
  if (p.underInvestigation) blockers.push("Under investigation for serious misconduct (§3.2)");
  if (p.suspended) blockers.push("Suspended (§2)");
  if (p.unpaidLeaveDays > POLICY.unpaidLeaveMaxDays) blockers.push(`Unpaid leave over ${POLICY.unpaidLeaveMaxDays} consecutive days (§3.2)`);
  if (p.employmentType === "fixed_term_contract" && p.contractEndDate && Date.parse(p.contractEndDate) <= at) blockers.push("Fixed-term contract has ended (§3.1)");
  if (!p.acknowledgmentSignedAt) warnings.push("Project Participation Agreement (Annex B) not signed — required to join and before any payment (§3.1, §15.1)");
  else if (Date.parse(p.acknowledgmentSignedAt) < Date.parse(`${POLICY_DATED}T00:00:00+07:00`)) warnings.push("Annex B signed under Version 3.0 — sign the updated agreement before the first v4.0 payment (§15.1)");
  if (p.employmentType === "probationary") warnings.push("Probationary — bonuses are calculated normally but held until probation ends; signs Annex C (§11)");
  if (p.employmentType === "part_time") warnings.push(`Part-time — allocation factor capped at ${maxAllocationFactor(p)} (§3.1)`);
  if (p.employmentType === "fixed_term_contract") warnings.push(p.contractEndDate ? `Fixed-term — roles only for work periods up to ${p.contractEndDate.slice(0, 10)} (§3.1)` : "Fixed-term — record the contract end date (§3.1)");
  if (p.onPIP && p.pipApprovedByPRC) warnings.push("On PIP — participation approved by the PRC; paid normally (§11.1)");
  return { ok: blockers.length === 0, blockers, warnings };
}

export type PaymentOutcome = { kind: "pay"; note?: string } | { kind: "withhold_probation" } | { kind: "forfeit"; reason: string } | { kind: "hold"; reason: string };

/**
 * §10 / §11 — what happens on the salary date to a bonus from a payment collected on `collectedIso`
 * for a work period starting `workStartIso`.
 */
export function paymentOutcome(p: EmployeeProfile | undefined, payIso: string, collectedIso: string = payIso, workStartIso: string = collectedIso): PaymentOutcome {
  if (!p) return { kind: "hold", reason: "No HR record — Finance re-checks status before payment (§3.5)" };
  if (!EMPLOYMENT_META[p.employmentType].eligible) return { kind: "forfeit", reason: `${EMPLOYMENT_META[p.employmentType].label} — not eligible (§3.2)` };
  if (!p.acknowledgmentSignedAt) return { kind: "hold", reason: "Annex B Project Participation Agreement not signed — paid once signed (§15.1)" };
  // §15.1 every participant signs the updated (v4.0) agreement before the first payment under Version 4.0
  if (Date.parse(payIso) >= Date.parse(`${POLICY_EFFECTIVE}T00:00:00+07:00`) && Date.parse(p.acknowledgmentSignedAt) < Date.parse(`${POLICY_DATED}T00:00:00+07:00`))
    return { kind: "hold", reason: "Annex B signed before Version 4.0 — sign the updated agreement before the first v4.0 payment (§15.1)" };
  const sep = p.separation;
  if (sep && Date.parse(sep.effectiveAt) <= Date.parse(payIso)) {
    const last = Date.parse(sep.effectiveAt);
    const collected = Date.parse(collectedIso);
    const workedBefore = Date.parse(workStartIso) <= last;
    const trail = collected <= Date.parse(addMonths(sep.effectiveAt, POLICY.separationTrailMonths));
    switch (sep.kind) {
      case "termination_for_cause":
        return { kind: "forfeit", reason: "Dismissed for a serious violation — all unpaid amounts forfeited (§10)" };
      case "resignation":
        return collected <= last ? { kind: "pay", note: "Resigned — collected up to the last working day (§10)" } : { kind: "forfeit", reason: "Resigned — revenue collected after the last working day is forfeited (§10)" };
      case "probation_failed":
        return collected <= last ? { kind: "pay", note: "Employment ended in probation — paid with final pay (§11.4)" } : { kind: "forfeit", reason: "Collected after the last working day (§11.4, §10)" };
      case "retirement":
        if (!sep.prcConfirmed) return { kind: "hold", reason: "Retirement — PRC confirmation required (§10)" };
      // falls through: as for termination on other grounds
      case "termination_without_cause":
      case "contract_end":
        if (collected <= last) return { kind: "pay" };
        return workedBefore && trail ? { kind: "pay", note: "Later collection for work before the end date (§10)" } : { kind: "forfeit", reason: "Work after the end date, or collected more than 12 months later (§10)" };
      case "death_disability":
        return workedBefore && trail ? { kind: "pay", note: "Paid to the employee or heirs within 60 days of documents (§10)" } : { kind: "forfeit", reason: "Work after the event date (§10)" };
      case "ineligible_status":
        return workedBefore ? { kind: "pay" } : { kind: "forfeit", reason: "Work after the move to an ineligible status (§10)" };
    }
  }
  if (p.suspended) return { kind: "hold", reason: "Disciplinary suspension — held; paid if cleared (§10)" };
  if (p.unpaidLeaveDays > POLICY.unpaidLeaveMaxDays) return { kind: "hold", reason: "Unpaid leave over 30 days — paid on return (§10)" };
  if (p.employmentType === "probationary" && (!p.probationEndDate || Date.parse(p.probationEndDate) > Date.parse(payIso))) return { kind: "withhold_probation" };
  return { kind: "pay" };
}

/* ───────────────────────── §9.3 deferral ───────────────────────── */

export function deferralTriggers(i: Initiative, adjustments: CurveAdjustment[] = []) {
  const reasons: string[] = [];
  const econ = proposalEconomics(i, adjustments);
  if (econ.expected.net > POLICY.deferral.netRevenueThreshold) reasons.push("Projected net revenue over Rp1,000,000,000");
  if (i.type === "C" && i.warranty) reasons.push("Type C with a warranty period");
  if (i.paymentTermsDays > POLICY.deferral.paymentTermsDays) reasons.push(`Payment terms ${i.paymentTermsDays} days (> 90)`);
  if (i.newClient) reasons.push("New client with no payment history");
  if (i.highRisk) reasons.push("Technical or execution risk rated high by the PRC");
  return reasons;
}
export function deferralShare(i: Initiative, adjustments: CurveAdjustment[] = []) {
  if (!deferralTriggers(i, adjustments).length) return 0;
  return Math.min(POLICY.deferral.maxPct, Math.max(0, i.deferralPct ?? POLICY.deferral.defaultPct));
}
/** Deferred amounts vest 6–12 months after project close (§9.3); before close, estimated from the contracted end. */
export function deferralVestDate(i: Initiative) {
  return addMonths(i.completedAt ?? i.endDate, i.deferralMonths);
}

/* ───────────────────────── §8.1 payments & §8.6 Type C minimum ───────────────────────── */

export interface PaymentPool {
  entry: RevenueEntry;
  month: string;
  revenue: number;
  directCosts: number;
  tax: number;
  net: number;
  cumNet: number;
  cumPool: number;
  pool: number;
  workStart: string;
  workEnd: string;
  collectedAt: string;
}

/** §8.1 cumulative pool: y × cumulative net revenue, less pool already allocated (never negative; shortfalls recovered later). */
export function projectPayments(ini: Initiative, entries: RevenueEntry[], adjustments: CurveAdjustment[] = []): PaymentPool[] {
  const rate = projectRate(ini, adjustments).rate;
  const rows = entries
    .filter((e) => e.initiativeId === ini.id && e.received)
    .map((e) => ({ e, month: e.collectedAt ? cycleMonth(e.collectedAt) : e.month }))
    .sort((a, b) => a.month.localeCompare(b.month) || (a.e.collectedAt ?? "").localeCompare(b.e.collectedAt ?? "") || a.e.id.localeCompare(b.e.id));
  let cumNet = 0;
  let allocated = 0;
  return rows.map(({ e, month }) => {
    const { tax, net } = netRevenue(e.revenue, e.directCosts);
    cumNet += net;
    const cumPool = rate * cumNet;
    const pool = Math.max(0, floorRp(cumPool - allocated));
    allocated += pool;
    return {
      entry: e,
      month,
      revenue: e.revenue,
      directCosts: e.directCosts,
      tax,
      net,
      cumNet,
      cumPool,
      pool,
      workStart: e.workPeriodStart ?? monthStart(e.month),
      workEnd: e.workPeriodEnd ?? monthEnd(e.month),
      collectedAt: e.collectedAt ?? dayOf(month, POLICY.cycle.cutoffDay),
    };
  });
}

export const standardBonusOf = (i: Initiative) => Math.max(POLICY.typeCMinimum.standardBonus, i.standardBonus ?? POLICY.typeCMinimum.standardBonus);

export interface MemberCycle {
  userId: string;
  weight: number;
  weightDays: number;
  revShare: number; // revenue-based share of this cycle's pool
  topUp: number;
  deducted: number;
  guaranteed: number;
  balanceAfter: number; // top-up balance still to deduct (§8.6)
  pieces: { amount: number; collectedAt: string; workStart: string }[];
}
export interface ProjectCycle {
  month: string;
  payments: PaymentPool[];
  revPool: number;
  topUp: number;
  standard: number; // pro-rated in the first month
  minimumActive: boolean; // the guaranteed minimum applies this month
  minimumEndsThisMonth: boolean;
  aboveStreak: number;
  members: MemberCycle[];
  totalWeightDays: number;
  noTeam: boolean;
}

/**
 * Month-by-month cycles for a project up to `uptoMonth` (inclusive): revenue-based pools shared by work period,
 * plus for Type C the §8.6 top-ups, top-up balances and deductions. Deterministic from the records.
 */
export function projectCycles(ini: Initiative, ctx: { members: InitiativeMember[]; entries: RevenueEntry[]; profiles: EmployeeProfile[]; adjustments?: CurveAdjustment[] }, uptoMonth: string): ProjectCycle[] {
  const payments = projectPayments(ini, ctx.entries, ctx.adjustments);
  const rows = ledgerRows(ctx.members, ini.id);
  const isC = ini.type === "C" && ["approved", "active", "completed"].includes(ini.status);
  const startMonth = monthKey(ini.startDate);
  const firstMonth = [payments[0]?.month, isC ? startMonth : undefined].filter(Boolean).sort()[0] as string | undefined;
  if (!firstMonth || firstMonth > uptoMonth) return [];
  const closeMonth = ini.completedAt ? monthKey(ini.completedAt) : null;
  const standardFull = standardBonusOf(ini);
  const balances = new Map<string, number>();
  let streak = 0;
  let ended = !isC;
  const cycles: ProjectCycle[] = [];

  for (let m = firstMonth; m <= uptoMonth; m = nextMonth(m)) {
    const pays = payments.filter((p) => p.month === m);
    const revPool = pays.reduce((s, p) => s + p.pool, 0);
    const byUser = new Map<string, MemberCycle>();
    const get = (userId: string, weight: number) => {
      let c = byUser.get(userId);
      if (!c) {
        c = { userId, weight, weightDays: 0, revShare: 0, topUp: 0, deducted: 0, guaranteed: 0, balanceAfter: 0, pieces: [] };
        byUser.set(userId, c);
      }
      c.weight = Math.max(c.weight, weight);
      return c;
    };
    let totalE = 0;
    for (const p of pays) {
      const split = shareByWeightDays(rows, p.workStart, p.workEnd, p.pool, ctx.profiles);
      totalE += split.totalE;
      for (const s of split.shares) {
        const c = get(s.userId, s.weight);
        c.weightDays += s.weightDays;
        c.revShare += s.bonus;
        c.pieces.push({ amount: s.bonus, collectedAt: p.collectedAt, workStart: p.workStart });
      }
    }

    // §8.6 guaranteed minimum
    const inWork = isC && m >= startMonth && (!closeMonth || m <= closeMonth);
    const minimumActive = inWork && !ended;
    let standard = standardFull;
    if (m === startMonth) standard = floorRp((standardFull * overlapDays(ini.startDate, null, monthStart(m), monthEnd(m))) / daysInMonth(m));
    let topUp = 0;
    let endsNow = false;
    let noTeam = false;
    if (minimumActive) {
      streak = revPool > standard ? streak + 1 : 0;
      endsNow = streak >= POLICY.typeCMinimum.consecutiveMonthsToEnd || revPool >= POLICY.typeCMinimum.singleMonthMultipleToEnd * standardFull;
      if (revPool < standard) {
        const monthSplit = shareByWeightDays(rows, m === startMonth ? ini.startDate : monthStart(m), monthEnd(m), standard - revPool, ctx.profiles);
        if (monthSplit.totalE > 0) {
          topUp = standard - revPool;
          for (const s of monthSplit.shares) {
            const c = get(s.userId, s.weight);
            c.topUp += s.bonus;
            c.pieces.push({ amount: s.bonus, collectedAt: dayOf(m, POLICY.cycle.cutoffDay), workStart: monthStart(m) });
          }
        } else noTeam = true;
      }
    }
    // deductions from later revenue-based bonuses on the project
    for (const c of byUser.values()) {
      const bal = balances.get(c.userId) ?? 0;
      if (bal > 0 && c.revShare > 0) {
        if (minimumActive && !endsNow) {
          const excess = revPool > standard ? (c.revShare * (revPool - standard)) / revPool : 0;
          c.deducted = floorRp(Math.min(bal, excess));
        } else c.deducted = Math.min(bal, c.revShare);
      }
      if (minimumActive) c.guaranteed = revPool >= standard ? floorRp((c.revShare * standard) / revPool) : c.revShare + c.topUp;
      const after = bal - c.deducted + c.topUp;
      balances.set(c.userId, after);
      c.balanceAfter = after;
      // remove the deduction from the revenue pieces, earliest first
      let left = c.deducted;
      for (const piece of c.pieces) {
        if (left <= 0) break;
        const take = Math.min(piece.amount, left);
        piece.amount -= take;
        left -= take;
      }
    }
    if (endsNow) ended = true;
    if (closeMonth && m > closeMonth) ended = true;
    for (const [userId, bal] of balances) if (!byUser.has(userId) && bal > 0) byUser.set(userId, { userId, weight: 0, weightDays: 0, revShare: 0, topUp: 0, deducted: 0, guaranteed: 0, balanceAfter: bal, pieces: [] });
    cycles.push({ month: m, payments: pays, revPool, topUp, standard, minimumActive, minimumEndsThisMonth: endsNow, aboveStreak: streak, members: [...byUser.values()], totalWeightDays: totalE, noTeam });
  }
  return cycles;
}

/** A member's §8.6 top-up balance still to deduct on a project after `uptoMonth`. Lapses at close or on leaving. */
export function topUpBalance(userId: string, ini: Initiative, ctx: Parameters<typeof projectCycles>[1], uptoMonth: string) {
  const cycles = projectCycles(ini, ctx, uptoMonth);
  const last = cycles[cycles.length - 1];
  return last?.members.find((m) => m.userId === userId)?.balanceAfter ?? 0;
}

/* ───────────────────────── §8.2 / §9.1–9.2 monthly cycle ───────────────────────── */

export interface RunInputs {
  month: string;
  initiatives: Initiative[];
  members: InitiativeMember[];
  entries: RevenueEntry[];
  profiles: EmployeeProfile[];
  adjustments: CurveAdjustment[];
  /** §9.1 rolling three months */
  companyRevenue: number;
  directCosts: number;
  overheads: number;
  cash: number;
  fixedCostsMonthly: number;
  /** amounts carried forward from earlier failed months, paid first (§9.2) */
  carriedIn?: { initiativeId: string; userId: string; amount: number }[];
}

export interface ProjectRunResult {
  initiativeId: string;
  revenue: number;
  directCosts: number;
  tax: number;
  net: number;
  sharePct: number;
  x: number;
  rateSource: ProjectRate["source"];
  pool: number;
  topUp: number;
  standardBonus: number | null;
  minimumActive: boolean;
  minimumEndsThisMonth: boolean;
  payments: number;
  deferralReasons: string[];
  deferralPct: number;
  totalWeight: number;
  noTeam: boolean;
}

export interface RunResult {
  month: string;
  payDate: string;
  projects: ProjectRunResult[];
  lines: BonusLine[];
  totals: BonusRun["totals"];
  proposed: number; // bonuses due for release incl. carried forward (before pro rata)
  guaranteed: number; // Type C standard bonuses paid in full
  operatingResultBefore: number;
  operatingResult: number;
  cashFloor: number;
  cashAfter: number;
  breakEvenPassed: boolean;
  cashPassed: boolean;
  passed: boolean;
  payoutPct: number;
  carriedPaidPct: number;
}

const emptyLine = (initiativeId: string, userId: string): BonusLine => ({
  initiativeId,
  userId,
  weight: 0,
  totalWeight: 0,
  weightDays: 0,
  totalWeightDays: 0,
  sharePct: 0,
  netRevenue: 0,
  pool: 0,
  gross: 0,
  topUp: 0,
  topUpDeducted: 0,
  guaranteed: 0,
  carriedIn: 0,
  payable: 0,
  deferred: 0,
  carriedOver: 0,
  withheld: 0,
  forfeited: 0,
  held: 0,
  status: "payable",
  notes: [],
});

export function computeRun(inp: RunInputs): RunResult {
  const payIso = paymentDate(inp.month);
  const projects: ProjectRunResult[] = [];
  const lines: BonusLine[] = [];
  const ctx = { members: inp.members, entries: inp.entries, profiles: inp.profiles, adjustments: inp.adjustments };

  for (const ini of inp.initiatives) {
    if (!["approved", "active", "completed"].includes(ini.status)) continue;
    const cycle = projectCycles(ini, ctx, inp.month).find((c) => c.month === inp.month);
    if (!cycle || (!cycle.payments.length && !cycle.topUp && !cycle.members.some((m) => m.revShare > 0))) continue;
    const rate = projectRate(ini, inp.adjustments);
    const deferralReasons = deferralTriggers(ini, inp.adjustments);
    const defPct = deferralShare(ini, inp.adjustments);
    const rows = ledgerRows(inp.members, ini.id);
    const totalWeight = [...new Set(rows.filter((r) => !r.leftAt || Date.parse(r.leftAt) >= Date.parse(monthStart(inp.month))).map((r) => r.userId))].reduce((s, u) => s + Math.max(...rows.filter((r) => r.userId === u).map(effectiveWeight)), 0);
    const pr: ProjectRunResult = {
      initiativeId: ini.id,
      revenue: cycle.payments.reduce((s, p) => s + p.revenue, 0),
      directCosts: cycle.payments.reduce((s, p) => s + p.directCosts, 0),
      tax: cycle.payments.reduce((s, p) => s + p.tax, 0),
      net: cycle.payments.reduce((s, p) => s + p.net, 0),
      sharePct: rate.rate,
      x: rate.x,
      rateSource: rate.source,
      pool: cycle.revPool,
      topUp: cycle.topUp,
      standardBonus: ini.type === "C" ? standardBonusOf(ini) : null,
      minimumActive: cycle.minimumActive,
      minimumEndsThisMonth: cycle.minimumEndsThisMonth,
      payments: cycle.payments.length,
      deferralReasons,
      deferralPct: defPct,
      totalWeight,
      noTeam: cycle.noTeam,
    };
    projects.push(pr);
    const topUpMonth = cycle.topUp > 0;

    for (const mc of cycle.members) {
      if (mc.revShare <= 0 && mc.topUp <= 0) continue;
      const line = emptyLine(ini.id, mc.userId);
      Object.assign(line, { weight: mc.weight, totalWeight, weightDays: mc.weightDays, totalWeightDays: cycle.totalWeightDays, sharePct: rate.rate, netRevenue: pr.net, pool: cycle.revPool, gross: mc.revShare, topUp: mc.topUp, topUpDeducted: mc.deducted });
      if (mc.topUp > 0) line.notes.push(`Type C top-up to the standard bonus (§8.6) — balance to deduct Rp${Math.round(mc.balanceAfter).toLocaleString("en-US")}`);
      if (mc.deducted > 0) line.notes.push(`Earlier top-ups deducted Rp${mc.deducted.toLocaleString("en-US")} (§8.6)`);
      const profile = inp.profiles.find((p) => p.userId === mc.userId);
      let protectedLeft = mc.guaranteed;
      for (const piece of mc.pieces) {
        if (piece.amount <= 0) continue;
        const o = paymentOutcome(profile, payIso, piece.collectedAt, piece.workStart);
        if (o.kind === "forfeit") {
          line.forfeited += piece.amount;
          if (!line.notes.includes(o.reason)) line.notes.push(o.reason);
          continue;
        }
        if (o.kind === "hold") {
          line.held += piece.amount;
          if (!line.notes.includes(o.reason)) line.notes.push(o.reason);
          continue;
        }
        if (o.kind === "pay" && o.note && !line.notes.includes(o.note)) line.notes.push(o.note);
        let amount = piece.amount;
        const guard = Math.min(amount, protectedLeft);
        protectedLeft -= guard;
        // §9.3 deferral never takes a Type C monthly pool below its standard bonus
        if (defPct > 0) {
          const d = floorRp((amount - guard) * defPct);
          line.deferred += d;
          amount -= d;
        }
        if (o.kind === "withhold_probation" && !topUpMonth) {
          line.withheld += amount;
          continue;
        }
        if (o.kind === "withhold_probation") line.notes.push("Probationary — paid with salary in a top-up month (§8.6, §11.3)");
        line.payable += amount;
        line.guaranteed += guard;
      }
      if (line.deferred > 0) line.notes.push(`${Math.round(defPct * 100)}% deferred to ${deferralVestDate(ini).slice(0, 10)}: ${deferralReasons.join("; ")} (§9.3)`);
      if (line.withheld > 0) line.notes.push("Probationary — held until probation ends (§11.3)");
      lines.push(line);
    }
  }

  // carried-forward amounts from earlier failed months (§9.2)
  for (const c of inp.carriedIn ?? []) {
    if (c.amount <= 0) continue;
    let line = lines.find((l) => l.initiativeId === c.initiativeId && l.userId === c.userId);
    if (!line) {
      line = emptyLine(c.initiativeId, c.userId);
      lines.push(line);
    }
    line.carriedIn += c.amount;
  }

  // §9.1 break-even test (rolling three months) and cash check, §9.2 pro rata
  const guaranteed = lines.reduce((s, l) => s + l.guaranteed, 0);
  const carried = lines.reduce((s, l) => s + l.carriedIn, 0);
  const fresh = lines.reduce((s, l) => s + l.payable - l.guaranteed, 0);
  const proposed = guaranteed + carried + fresh;
  const base = inp.companyRevenue - inp.directCosts - inp.overheads;
  const cashFloor = POLICY.breakEven.cashFloorMonths * inp.fixedCostsMonthly;
  const operatingResultBefore = base - proposed;
  const breakEvenPassed = operatingResultBefore >= 0;
  const cashPassed = inp.cash - proposed >= cashFloor;
  const room = Math.min(base, inp.cash - cashFloor) - guaranteed; // standard bonuses are paid in full first
  const carriedPaidPct = carried > 0 ? Math.min(1, Math.max(0, room / carried)) : 1;
  const roomAfter = room - carried * carriedPaidPct;
  const payoutPct = fresh > 0 ? Math.min(1, Math.max(0, roomAfter / fresh)) : 1;

  for (const l of lines) {
    const carriedPaid = floorRp(l.carriedIn * carriedPaidPct);
    const freshPart = l.payable - l.guaranteed;
    const freshPaid = floorRp(freshPart * payoutPct);
    l.carriedOver = l.carriedIn - carriedPaid + (freshPart - freshPaid);
    l.payable = l.guaranteed + freshPaid + carriedPaid;
    if (l.carriedOver > 0) l.notes.push(`Break-even test or cash check failed — ${Math.round(payoutPct * 10_000) / 100}% paid; rest carried forward and paid first next passing month (§9.2)`);
    if (l.carriedIn > 0) l.notes.push(`Includes Rp${carriedPaid.toLocaleString("en-US")} carried forward from an earlier month (§9.2)`);
    l.status =
      l.payable <= 0 && l.forfeited > 0 && !l.held && !l.withheld
        ? "forfeited"
        : l.payable <= 0 && l.held > 0
          ? "held"
          : l.payable <= 0 && l.withheld > 0
            ? "withheld_probation"
            : l.carriedOver > 0
              ? "carried_forward"
              : l.deferred > 0
                ? "partially_deferred"
                : "payable";
  }

  const sum = (k: keyof Pick<BonusLine, "payable" | "deferred" | "withheld" | "forfeited" | "held" | "carriedOver" | "topUp" | "topUpDeducted" | "carriedIn">) => lines.reduce((s, l) => s + l[k], 0);
  const paidNow = sum("payable");
  return {
    month: inp.month,
    payDate: payIso,
    projects,
    lines,
    totals: {
      netRevenue: projects.reduce((s, p) => s + p.net, 0),
      pool: projects.reduce((s, p) => s + p.pool, 0),
      topUps: sum("topUp"),
      topUpDeducted: sum("topUpDeducted"),
      carriedIn: sum("carriedIn"),
      payable: paidNow,
      deferred: sum("deferred"),
      withheld: sum("withheld"),
      forfeited: sum("forfeited"),
      held: sum("held"),
      carriedOver: sum("carriedOver"),
    },
    proposed,
    guaranteed,
    operatingResultBefore,
    operatingResult: base - paidNow,
    cashFloor,
    cashAfter: inp.cash - paidNow,
    breakEvenPassed,
    cashPassed,
    passed: breakEvenPassed && cashPassed,
    payoutPct,
    carriedPaidPct,
  };
}

/** Carried-forward balances (§9.2) after the latest run that left any — fed into the next run as `carriedIn`. */
export function carriedForward(runs: BonusRun[], beforeMonth: string) {
  const prior = runs.filter((r) => r.month < beforeMonth && (r.status === "released" || r.status === "certified")).sort((a, b) => a.month.localeCompare(b.month));
  const last = prior[prior.length - 1];
  if (!last) return [];
  return last.lines.filter((l) => l.carriedOver > 0).map((l) => ({ initiativeId: l.initiativeId, userId: l.userId, amount: l.carriedOver }));
}

/* ───────────────────────── §5.1 rate review ───────────────────────── */

/** §5.1 checks Finance runs every 12 months and at final reconciliation. */
export function rateReview(ini: Initiative, entries: RevenueEntry[], adjustments: CurveAdjustment[] = []) {
  const r = projectRate(ini, adjustments);
  const collected = entries.filter((e) => e.initiativeId === ini.id);
  const actualNet = collected.reduce((s, e) => s + netRevenue(e.revenue, e.directCosts).net, 0);
  const actualX = projectedAnnualNet(actualNet, r.months);
  const flags: string[] = [];
  if (r.source === "provisional") flags.push("No expected-case projection yet — the rate shown is provisional (top of the curve)");
  if (r.source === "curve" && r.x > 0 && actualX > r.x * (1 + POLICY.rate.recalcIfAbovePct)) flags.push(`Actual and re-forecast annual net revenue is more than 20% above the x used to set the rate — recalculate for the whole project (§5.1)`);
  return { ...r, actualNet, actualX, recalculatedRate: revenueShareRate(actualX, r.curve), flags };
}

/* ───────────────────────── §9.4 clawback ───────────────────────── */

/** Bonus paid minus the bonus on corrected figures; the first Rp10,000,000 is not clawed back for a data error the employee did not cause. */
export function clawbackAmount(c: Pick<Clawback, "originalPaid" | "recalculated"> & Partial<Pick<Clawback, "trigger" | "personallyAtFault">>) {
  const diff = Math.max(0, c.originalPaid - c.recalculated);
  if (c.trigger === "data_error" && c.personallyAtFault === false) return Math.max(0, diff - POLICY.clawback.dataErrorSafeHarbour);
  return diff;
}

export function clawbackExempt(c: Pick<Clawback, "trigger" | "personallyAtFault" | "originalPaid" | "recalculated" | "paidAt">, atIso = new Date().toISOString()) {
  if (Date.parse(atIso) > Date.parse(addMonths(c.paidAt, POLICY.clawback.windowMonths))) return "Outside the 24-month clawback window (§9.4)";
  if (!["revenue_reversal", "misconduct", "data_error"].includes(c.trigger)) return "Normal business or market risk is never clawed back (§9.4)";
  if (clawbackAmount(c) <= 0) return c.trigger === "data_error" ? "Data error not caused by the employee — within the Rp10,000,000 safe harbour (§9.4)" : "No overpayment";
  return null;
}

/** §9.4 step 5: salary deductions over 6–12 months, ≤ 20 % of monthly gross salary, with written agreement. */
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

/* ───────────────────────── §4.3 completeness ───────────────────────── */

export function proposalGaps(i: Initiative, members: InitiativeMember[]) {
  const gaps: string[] = [];
  const tier = approvalTier(i).tier;
  if (i.title.trim().length < 4) gaps.push("Project name");
  if (!i.origination) gaps.push("Origination — how the opportunity arose and first CRM contact (§4.1)");
  if (i.summary.trim().length < 40) gaps.push("Business case (§4.3.1)");
  if (i.scope.trim().length < 20) gaps.push("Scope (§4.3.2)");
  if (!i.deliverables.trim()) gaps.push("Deliverables with acceptance criteria (§4.3.2)");
  if (!i.startDate || !i.endDate || Date.parse(i.endDate) <= Date.parse(i.startDate)) gaps.push("Start date and contracted end date (§4.3.3, §5.1)");
  if (tier > 1 && !i.milestones.length) gaps.push("Milestones and payment milestones with work periods (§4.3.3)");
  if (i.revenue.expected <= 0) gaps.push("Expected-case revenue — sets the revenue-share rate (§4.3.5, §5.1)");
  if (!(i.revenue.worst <= i.revenue.expected && i.revenue.expected <= i.revenue.best)) gaps.push("Best, expected and worst cases (worst ≤ expected ≤ best) (§4.3.5)");
  if (i.costs.contingencyPct < 10 || i.costs.contingencyPct > 20) gaps.push("Direct costs with a 10–20% contingency (§4.3.5)");
  if (!i.companyId) gaps.push("Client (§4.3.6)");
  if (tier > 1 && i.risks.length < 2) gaps.push("Risks, each with a mitigation (§4.3.7)");
  if (i.type === "C" && standardBonusOf(i) < POLICY.typeCMinimum.standardBonus) gaps.push("Type C standard bonus of at least Rp1,000,000 a month (§8.6)");
  const live = members.filter((m) => m.initiativeId === i.id && m.consent !== "declined");
  if (!live.some((m) => m.roles.includes("project_lead"))) gaps.push("Every project needs a Project Lead (§6.1)");
  if (!live.length) gaps.push("Team, roles, weights and allocation factors (§4.3.4)");
  if (live.some((m) => m.consent !== "accepted")) gaps.push("Role and Weight Agreement signed by every member (§6.7, Annex D)");
  if (live.some((m) => !m.managerApproved)) gaps.push("Line manager agreement for every member (§3.1)");
  if (i.origination === "company" && live.some((m) => m.roles.includes("initiator"))) gaps.push("No Initiator weight when the opportunity came through company channels (§4.1)");
  return gaps;
}
