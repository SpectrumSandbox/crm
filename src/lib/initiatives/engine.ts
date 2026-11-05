/*
 * Compensation engine for the Project Initiative and Compensation Policy v4.0 (docs/policy/v4.0.md).
 * Pure functions only — no store / React — so they can be verified against the policy's worked
 * examples (§16) by scripts/verify-policy.ts.
 */
import type {
  BonusAdjustment,
  BonusLine,
  BonusRun,
  CarryItem,
  Clawback,
  CompanyTurnover,
  CurveAdjustment,
  DeferredBonus,
  EmployeeProfile,
  ExtraPaymentKind,
  Initiative,
  InitiativeMember,
  Pph21Estimate,
  ProbationOutcome,
  ProjectRole,
  ProjectType,
  RevenueEntry,
  TaxRegimeChange,
  TeamAmendment,
} from "./types";
import { CURVE, EMPLOYMENT_META, POLICY, POLICY_DATED, POLICY_EFFECTIVE, PPH21_TER, PROJECT_TYPE_META, PTKP_TER_CATEGORY, ROLE_META, SPECIALIST_RANGE, type ApprovalTier, type Curve } from "./policy";
import * as cal from "../calendar";

const DAY = 86_400_000;
const WIB = 7 * 3_600_000;
/** §8.5 amounts are rounded down to the nearest whole rupiah. */
export const floorRp = (n: number) => Math.floor(n + 1e-6);
export const round = (n: number) => Math.round(n);
const nowIso = () => new Date().toISOString();

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

/** WIB helpers re-exported from src/lib/calendar.ts */
export const wibDayStart = cal.wibDayStart;
export const wibDayEnd = cal.wibDayEnd;
export const wibDateKey = cal.wibDateKey;

export interface CycleDate {
  /** nominal policy date (YYYY-MM-DD) */
  nominal: string;
  /** date that applies after the §8.2 weekend / holiday move */
  date: string;
  moved: boolean;
  /** why the nominal date was not a business day */
  reason: string | null;
  /** instant used by the engine (cut-off: end of day; deadlines: 17:00; salary: 09:00 WIB) */
  at: string;
}
const cycleDay = (month: string, day: number, hour: number, minute = 0, second = 0, ms = 0): CycleDate => {
  const nominal = `${month}-${String(day).padStart(2, "0")}`;
  const adj = cal.onOrBeforeBusinessDay(nominal);
  return { nominal, date: adj.date, moved: adj.moved, reason: adj.reason, at: cal.wibAt(adj.date, hour, minute, second, ms) };
};

/**
 * §8.2 dates of a salary cycle. "If the salary date moves for a weekend or public holiday, bonuses move with it. The
 * other dates move to the previous business day." Payroll pays on the last business day on or before the 25th, so the
 * salary date moves the same way. Holidays and cuti bersama come from src/lib/calendar.ts.
 */
const cycleCache = new Map<string, ReturnType<typeof buildCycleDates>>();
export function cycleDates(month: string) {
  let d = cycleCache.get(month);
  if (!d) {
    d = buildCycleDates(month);
    cycleCache.set(month, d);
  }
  return d;
}
function buildCycleDates(month: string) {
  const cutoff = cycleDay(month, POLICY.cycle.cutoffDay, 23, 59, 59, 999);
  const provisional = cycleDay(month, POLICY.cycle.provisionalDay, 17);
  const certify = cycleDay(month, POLICY.cycle.certifyDay, 17);
  const salary = cycleDay(month, POLICY.cycle.salaryDay, 9);
  const label = { cutoff: "Collection cut-off", provisional: "Provisional bonuses", certify: "CFO certification", salary: "Salary date" } as const;
  const notes = (Object.keys(label) as (keyof typeof label)[])
    .map((k) => ({ k, d: { cutoff, provisional, certify, salary }[k] }))
    .filter((x) => x.d.moved)
    .map((x) => `${label[x.k]} moved from ${x.d.nominal} (${x.d.reason}) to ${x.d.date} — previous business day (§8.2)`);
  return { month, cutoff, provisional, certify, salary, notes, calendarCovered: cal.calendarCovers(Number(month.slice(0, 4))) };
}
/** §8.2 salary date (usually the 25th, moved to the previous business day) on which a cycle's authorised bonuses are paid. */
export function paymentDate(month: string) {
  return cycleDates(month).salary.at;
}
/** End of the cycle's collection cut-off day (the 20th, or the previous business day). */
export function cutoffDate(month: string) {
  return cycleDates(month).cutoff.at;
}
/** §8.2 revenue collected by the cut-off (the 20th, or the business day before) is paid that month; after it, the following month. */
export function cycleMonth(collectedIso: string) {
  const m = monthKey(collectedIso);
  return cal.wibDateKey(collectedIso) <= cycleDates(m).cutoff.date ? m : nextMonth(m);
}
/** Collection window of a cycle: the day after the previous cycle's cut-off → end of this cycle's cut-off day. */
export function collectionWindow(month: string) {
  const prev = cycleDates(nextMonth(month, -1)).cutoff.date;
  return { from: cal.wibAt(cal.shiftDateKey(prev, 1)), to: cutoffDate(month) };
}
/** §8.2 the CFO certifies the break-even test and cash check by the 23rd (or the previous business day). */
export function breakEvenDeadline(month: string) {
  return cycleDates(month).certify.at;
}
/** §8.2 provisional bonuses and Project Lead ledger confirmation by the 22nd (or the previous business day). */
export function provisionalDeadline(month: string) {
  return cycleDates(month).provisional.at;
}
export function addMonths(iso: string, n: number) {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString();
}
/** Business days after `iso` (weekends, national holidays and cuti bersama skipped — src/lib/calendar.ts). */
export function addBusinessDays(iso: string, days: number) {
  return cal.addBusinessDays(iso, days);
}
export function businessDaysBetween(fromIso: string, toIso: string) {
  return cal.businessDaysBetween(fromIso, toIso);
}
const dayIndex = (iso: string) => Math.floor((Date.parse(iso) + WIB) / DAY);
/** Inclusive calendar days two WIB date ranges share. */
export function overlapDays(aStart: string, aEnd: string | null, bStart: string, bEnd: string) {
  const s = Math.max(dayIndex(aStart), dayIndex(bStart));
  const e = Math.min(aEnd ? dayIndex(aEnd) : Number.POSITIVE_INFINITY, dayIndex(bEnd));
  return Math.max(0, e - s + 1);
}
export const daysInMonth = (month: string) => dayIndex(monthEnd(month)) - dayIndex(monthStart(month)) + 1;

/** Where a salary cycle stands on `atIso` (§8.2): collecting → provisional → certification → release → paid / late. */
export function cycleTiming(month: string, atIso: string = nowIso()) {
  const d = cycleDates(month);
  const t = Date.parse(atIso);
  const salaryEnd = Date.parse(cal.wibDayEnd(d.salary.at));
  const phase = t <= Date.parse(d.cutoff.at) ? "collecting" : t <= Date.parse(d.provisional.at) ? "provisional" : t <= Date.parse(d.certify.at) ? "certify" : t <= salaryEnd ? "release" : "late";
  return { ...d, phase: phase as "collecting" | "provisional" | "certify" | "release" | "late", cutoffPassed: t > Date.parse(d.cutoff.at), lateDays: phase === "late" ? cal.businessDaysBetween(d.salary.at, atIso) : 0 };
}
/** §8.2 certification is only possible once the collection window has closed. Returns the reason it is blocked, or null. */
export function certifyBlock(month: string, atIso: string = nowIso()) {
  const d = cycleDates(month);
  if (Date.parse(atIso) <= Date.parse(d.cutoff.at)) return `Collections for the ${month} cycle are open until the end of ${d.cutoff.date}${d.cutoff.moved ? ` (moved from the 20th: ${d.cutoff.reason})` : ""} — certify after the cut-off (§8.2)`;
  return null;
}

/** Contract end date for a duration of whole months: the day before the same date `months` later, 23:59:59 WIB (6 months from 4 Nov ends 3 May = 6 contracted months, §5.1). */
export function endDateForMonths(startIso: string, months: number) {
  const key = cal.wibDateKey(addMonths(cal.wibAt(cal.wibDateKey(startIso), 12), months));
  return cal.wibAt(cal.shiftDateKey(key, -1), 23, 59, 59, 999);
}
/** §6.5 work period from two WIB calendar dates (YYYY-MM-DD): 00:00:00 WIB on the first day to 23:59:59.999 WIB on the last. */
export function workPeriodFromDates(fromKey: string, toKey: string) {
  return { start: cal.wibAt(fromKey), end: cal.wibAt(toKey, 23, 59, 59, 999) };
}
/** Work-period start → 00:00 WIB on its WIB date. */
export const normalizeWorkPeriodStart = (iso: string) => cal.wibDayStart(iso);
/**
 * Work-period end → 23:59:59.999 WIB on the last day worked. Accepts the forms date inputs produce: end of day,
 * 17:00 WIB on the day (fromDateInput), 17:00 + 23:59:59 (16:59:59 the next day) and an exclusive 00:00 next day.
 */
export const normalizeWorkPeriodEnd = (iso: string) => cal.wibDayEnd(Date.parse(iso) - 17 * 3_600_000);

/* ───────────────────────── §5 net revenue & the revenue-share curve ───────────────────────── */

export type TaxRegime = { regime: "umkm" | "corporate"; corporateRate?: number };

/** §5.4 regime in force on a date: the latest recorded switch on or before it, otherwise the regime in POLICY. */
export function taxRegimeAt(atIso: string | null | undefined, changes: TaxRegimeChange[] = []): TaxRegime {
  const t = atIso ? Date.parse(atIso) : Date.now();
  const applicable = changes.filter((c) => Date.parse(c.effectiveFrom) <= t).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const last = applicable[applicable.length - 1];
  return last ? { regime: last.regime, corporateRate: last.corporateEffectiveRate } : { regime: POLICY.tax.regime, corporateRate: POLICY.tax.corporateEffectiveRate };
}

/** §5.4 estimated taxes: UMKM final tax 0.5 % of revenue (due even at a loss; a credit note reverses it); corporate income tax on margin after the switch. */
export function estimatedTax(revenue: number, directCosts: number, otherTaxes = 0, tax?: TaxRegime) {
  const regime = tax?.regime ?? POLICY.tax.regime;
  if (regime === "umkm") return revenue * POLICY.tax.umkmRate + otherTaxes;
  return Math.max(0, revenue - directCosts) * (tax?.corporateRate ?? POLICY.tax.corporateEffectiveRate) + otherTaxes;
}

/** §5.2 Net revenue = Project revenue − Direct costs − Estimated taxes. */
export function netRevenue(revenue: number, directCosts: number, otherTaxes = 0, tax?: TaxRegime) {
  const profit = revenue - directCosts;
  const t = estimatedTax(revenue, directCosts, otherTaxes, tax);
  return { profit, tax: t, net: profit - t };
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

const LIVE_OR_DONE = new Set(["approved", "conditional", "active", "completed"]);

/**
 * The project's revenue-share rate: fixed by the PRC (or kept flat from v3.0, §15.1); otherwise computed from the
 * expected case on the curve in force at approval (§9.5.4 — projects approved after a change's effective date use the
 * new curve). `atIso` is the approval time when the PRC is approving now; a proposal not yet approved previews the
 * curve in force today.
 */
export function projectRate(i: Initiative, adjustments: CurveAdjustment[] = [], atIso?: string): ProjectRate {
  const months = contractedMonths(i);
  const projectedNet = netRevenue(i.revenue.expected, directCostTotal(i.costs)).net;
  const x = projectedAnnualNet(projectedNet, months);
  const curveDate = i.approvedAt ?? atIso ?? (LIVE_OR_DONE.has(i.status) ? i.submittedAt ?? i.createdAt : nowIso());
  const curve = adjustments.length ? curveInForce(adjustments, curveDate) : CURVE;
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

/* ───────────────────────── §4.5 project codes & tracking numbers ───────────────────────── */

/** Next `PREFIX-YYYY-NNN` for the WIB year of `atIso`: highest sequence already issued that year + 1 (never reuses a number). */
export function nextSequenceCode(prefix: string, existing: (string | null | undefined)[], atIso: string = nowIso()) {
  const year = cal.wibDateKey(atIso).slice(0, 4);
  const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  const max = existing.reduce((m, c) => {
    const hit = c ? re.exec(c) : null;
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return `${prefix}-${year}-${String(max + 1).padStart(3, "0")}`;
}
/** §4.5 project code issued on PRC approval or ratification — one sequence per year shared by both paths. */
export const nextProjectCode = (initiatives: Pick<Initiative, "code">[], atIso?: string) => nextSequenceCode("PRJ", initiatives.map((i) => i.code), atIso);
/** §4.5 tracking number assigned on submission. */
export const nextTrackingNo = (initiatives: Pick<Initiative, "trackingNo">[], atIso?: string) => nextSequenceCode("PRC", initiatives.map((i) => i.trackingNo), atIso);

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

/* ───────────────────────── §6.8 amendments ───────────────────────── */

/** §6.8.2 voting deadline: 5 business days after circulation. */
export const amendmentDeadline = (a: Pick<TeamAmendment, "circulatedAt">) => addBusinessDays(a.circulatedAt, POLICY.sla.amendmentVoteBusinessDays);

/**
 * §6.8 tally among the current members (`voterIds`, excluding a person joining). Passes with more than half of all
 * members for; fails only once a tie is no longer possible ((n − against) × 2 < n); exactly half for with every vote in
 * → tied (the PRC decides). With `closed` (deadline passed) the open outcome resolves: majority → passed, half → tied,
 * otherwise failed.
 */
export function amendmentTally(votes: TeamAmendment["votes"], voterIds: string[], closed = false): TeamAmendment["status"] {
  const valid = votes.filter((v) => voterIds.includes(v.userId));
  const yes = valid.filter((v) => v.vote === "for").length;
  const no = valid.filter((v) => v.vote === "against").length;
  const n = voterIds.length;
  if (n === 0) return "tied";
  if (yes > n / 2) return "passed";
  if ((n - no) * 2 < n) return "failed";
  if (yes * 2 === n && (yes + no === n || closed)) return "tied";
  if (closed) return "failed";
  return "open";
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

/** Version 4.0 Annex B counts from 00:00 WIB on the policy date (29 Oct 2026). */
export const ANNEX_B_V4_FROM = `${POLICY_DATED}T00:00:00+07:00`;
const V4_PAYMENTS_FROM = `${POLICY_EFFECTIVE}T00:00:00+07:00`;

/**
 * §3.1 / §15.1 Annex B (Project Participation Agreement) status — the one rule used by eligibility, payment outcomes,
 * /people and /me. `blocksPayment` once a v4.0 payment is due (from 1 Jan 2027) and only a v3.0 agreement is on file.
 */
export function annexBStatus(p: Pick<EmployeeProfile, "acknowledgmentSignedAt"> | undefined | null, atIso: string = nowIso()) {
  const signedAt = p?.acknowledgmentSignedAt ?? null;
  const v4Due = Date.parse(atIso) >= Date.parse(V4_PAYMENTS_FROM);
  if (!signedAt) return { signed: false, current: false, version: null as "3.0" | "4.0" | null, signedAt, needsSigning: true, blocksPayment: true, label: "Not signed" };
  const current = Date.parse(signedAt) >= Date.parse(ANNEX_B_V4_FROM);
  return { signed: true, current, version: (current ? "4.0" : "3.0") as "3.0" | "4.0" | null, signedAt, needsSigning: !current, blocksPayment: !current && v4Due, label: current ? "Signed (v4.0)" : "Signed under v3.0 — re-sign v4.0" };
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
  const annexB = annexBStatus(p, atIso);
  if (!annexB.signed) warnings.push("Project Participation Agreement (Annex B) not signed — required to join and before any payment (§3.1, §15.1)");
  else if (!annexB.current) warnings.push("Annex B signed under Version 3.0 — sign the updated agreement before the first v4.0 payment (§15.1)");
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
  const annexB = annexBStatus(p, payIso);
  if (!annexB.signed) return { kind: "hold", reason: "Annex B Project Participation Agreement not signed — paid once signed (§15.1)" };
  // §15.1 every participant signs the updated (v4.0) agreement before the first payment under Version 4.0
  if (annexB.blocksPayment) return { kind: "hold", reason: "Annex B signed before Version 4.0 — sign the updated agreement before the first v4.0 payment (§15.1)" };
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
/** Vest date of a deferred entry, always derived from its project (stays right after the project closes). */
export function deferredVestAt(d: Pick<DeferredBonus, "initiativeId" | "vestAt">, initiatives: Initiative[]) {
  const i = initiatives.find((x) => x.id === d.initiativeId);
  return i ? deferralVestDate(i) : d.vestAt;
}

/**
 * §9.3 warranty / rework costs during the deferral period, deducted from the project's deferred pool ONCE and shared
 * in proportion to each pending entry; costs beyond the pool are absorbed by the company. Floors each deduction and
 * gives the rounding remainder to the largest entry so the total deduction is exact.
 */
export function allocateDeferralCosts(entries: Pick<DeferredBonus, "id" | "amount">[], costs: number) {
  const pool = entries.reduce((s, d) => s + d.amount, 0);
  const total = Math.min(pool, Math.max(0, Math.floor(costs)));
  const rows = entries.map((d) => ({ id: d.id, amount: d.amount, deduction: pool > 0 ? Math.floor((d.amount / pool) * total) : 0, net: 0 }));
  let rest = total - rows.reduce((s, r) => s + r.deduction, 0);
  for (const r of [...rows].sort((a, b) => b.amount - a.amount)) {
    if (rest <= 0) break;
    const add = Math.min(rest, r.amount - r.deduction);
    r.deduction += add;
    rest -= add;
  }
  for (const r of rows) r.net = r.amount - r.deduction;
  return { pool, deducted: total, absorbedByCompany: Math.max(0, Math.floor(costs) - total), rows };
}

/* ───────────────────────── §8.1 payments & §8.6 Type C minimum ───────────────────────── */

/**
 * Salary cycle a received payment is paid in: its collection cycle (§8.2), or — when that cycle was already released
 * without it (it was entered late) — the next cycle not yet released, as an §8.5 correction. Runs record the entries they
 * paid (`entryIds`); a released run without that record is treated as having paid every entry of its month.
 */
export function entryCycle(e: RevenueEntry, runs: BonusRun[] = []) {
  let m = e.received && e.collectedAt ? cycleMonth(e.collectedAt) : e.month;
  if (!e.received || !runs.length) return m;
  for (let i = 0; i < 240; i++) {
    const r = runs.find((x) => x.month === m && x.status === "released");
    if (!r || !r.entryIds || r.entryIds.includes(e.id)) return m;
    m = nextMonth(m);
  }
  return m;
}

/** Is a payment locked because the cycle that paid it is released? (edits would silently change later bonuses, §8.5/§9.4) */
export function revenueEntryLock(e: RevenueEntry, runs: BonusRun[]) {
  if (!e.received) return null;
  const m = entryCycle(e, runs);
  const r = runs.find((x) => x.month === m && x.status === "released");
  if (!r) return null;
  return `Paid in the released ${m} cycle — record a correction instead; it is settled in the next open cycle (§8.5) or through a clawback (§9.4)`;
}

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
  /** collection cycle that was already released when the payment was entered (§8.5 correction) */
  rolledFrom?: string | null;
}

export interface PaymentContext {
  /** earlier runs — late payments for released cycles roll into the next open cycle */
  runs?: BonusRun[];
  /** §5.4 dated tax-regime switches */
  taxChanges?: TaxRegimeChange[];
}

/** §8.1 cumulative pool: y × cumulative net revenue, less pool already allocated (never negative; shortfalls recovered later). */
export function projectPayments(ini: Initiative, entries: RevenueEntry[], adjustments: CurveAdjustment[] = [], opts: PaymentContext = {}): PaymentPool[] {
  const rate = projectRate(ini, adjustments).rate;
  const runs = opts.runs ?? [];
  const rows = entries
    .filter((e) => e.initiativeId === ini.id && e.received)
    .map((e) => {
      const natural = e.collectedAt ? cycleMonth(e.collectedAt) : e.month;
      const month = runs.length ? entryCycle(e, runs) : natural;
      return { e, month, rolledFrom: month !== natural ? natural : null };
    })
    .sort((a, b) => a.month.localeCompare(b.month) || (a.e.collectedAt ?? "").localeCompare(b.e.collectedAt ?? "") || a.e.id.localeCompare(b.e.id));
  let cumNet = 0;
  let allocated = 0;
  return rows.map(({ e, month, rolledFrom }) => {
    const tax = opts.taxChanges?.length ? taxRegimeAt(e.collectedAt ?? monthStart(month), opts.taxChanges) : undefined;
    const n = netRevenue(e.revenue, e.directCosts, 0, tax);
    cumNet += n.net;
    const cumPool = rate * cumNet;
    const pool = Math.max(0, floorRp(cumPool - allocated));
    allocated += pool;
    return {
      entry: e,
      month,
      revenue: e.revenue,
      directCosts: e.directCosts,
      tax: n.tax,
      net: n.net,
      cumNet,
      cumPool,
      pool,
      workStart: e.workPeriodStart ?? monthStart(e.month),
      workEnd: e.workPeriodEnd ?? monthEnd(e.month),
      collectedAt: e.collectedAt ?? dayOf(month, POLICY.cycle.cutoffDay),
      rolledFrom,
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
export function projectCycles(ini: Initiative, ctx: { members: InitiativeMember[]; entries: RevenueEntry[]; profiles: EmployeeProfile[]; adjustments?: CurveAdjustment[] } & PaymentContext, uptoMonth: string): ProjectCycle[] {
  const payments = projectPayments(ini, ctx.entries, ctx.adjustments, { runs: ctx.runs, taxChanges: ctx.taxChanges });
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

/* ───────────────────────── §8.5 PPh 21 estimate (PP 58/2023 TER) ───────────────────────── */

/** TER category from a PTKP status (TK/0 assumed when HR has not recorded one). */
export function terCategory(ptkp: string | null | undefined): "A" | "B" | "C" {
  return PTKP_TER_CATEGORY[(ptkp ?? "TK/0").toUpperCase().replace(/\s+/g, "")] ?? "A";
}
/** Monthly TER rate for a gross monthly income (PP 58/2023). */
export function terRate(category: "A" | "B" | "C", monthlyGross: number) {
  const table = PPH21_TER[category];
  for (const [upper, rate] of table) if (monthlyGross <= upper) return rate;
  return table[table.length - 1][1];
}
/**
 * PPh 21 withheld on a bonus paid with salary: TER(salary + bonus) × (salary + bonus) − TER(salary) × salary. An
 * ESTIMATE for statements (§8.5, Annex E) — payroll computes the real figure with allowances, and December uses the
 * annual Article 17 calculation.
 */
export function pph21BonusEstimate(monthlySalary: number, bonus: number, ptkp?: string | null, month?: string) {
  const category = terCategory(ptkp);
  const S = Math.max(0, monthlySalary);
  const B = Math.max(0, bonus);
  const withSalary = terRate(category, S + B) * (S + B);
  const salaryOnly = terRate(category, S) * S;
  const withheld = Math.max(0, Math.floor(withSalary - salaryOnly + 1e-6));
  const notes = [`Estimate — TER category ${category} (PTKP ${ptkp || "TK/0, assumed"}) on base salary ${Math.round(S).toLocaleString("en-US")} + bonus; payroll withholds the actual PPh 21 (§8.5)`];
  if (month?.endsWith("-12")) notes.push("December: payroll applies the annual Article 17 true-up, so the actual withholding may differ");
  return { gross: B, withheld, net: B - withheld, category, rate: terRate(category, S + B), monthlySalary: S, note: notes.join(". ") };
}

/* ───────────────────────── §8.2 / §9.1–9.2 monthly cycle ───────────────────────── */

/** Brought-forward amount for a run (§9.2 carried forward, or held until a §10 / §15.1 condition clears). */
export interface CarryInput {
  initiativeId: string;
  userId: string;
  amount: number;
  kind?: "carried" | "held";
  collectedAt?: string | null;
  workStart?: string | null;
  fromMonth?: string;
  reason?: string;
}
/** Amounts that become payable in a cycle outside the project pools: deferred releases, Probation Completion Bonus, §8.3/§8.5 adjustments. */
export interface ExtraPayment {
  kind: ExtraPaymentKind;
  refId: string;
  userId: string;
  initiativeId: string;
  amount: number;
  collectedAt?: string | null;
  workStart?: string | null;
  note: string;
}
/** §9.4 clawback still to recover from this employee's bonuses (recovery order: future project bonuses before salary). */
export interface RecoveryInput {
  clawbackId: string;
  userId: string;
  initiativeId?: string | null;
  amount: number;
}

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
  /** amounts carried forward from earlier failed months, paid first (§9.2), and held amounts re-tested (§10) */
  carriedIn?: CarryInput[];
  /** earlier runs: late collections for released cycles roll into the next open one (§8.5) */
  runs?: BonusRun[];
  /** deferred releases, probation balances and adjustments payable this cycle (§9.1 tested, paid first) */
  extraPayments?: ExtraPayment[];
  /** §9.4 clawbacks recovered from this cycle's bonuses */
  recoveries?: RecoveryInput[];
  /** §5.4 dated tax-regime switches */
  taxChanges?: TaxRegimeChange[];
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
  /** cycles whose late collections are paid here (§8.5) */
  rolledFrom?: string[];
  entryIds?: string[];
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
  /** revenue entries paid in this cycle — stored on the run at release (§8.5 late-entry rule) */
  entryIds?: string[];
  /** §8.2 date moves for this cycle */
  dateNotes?: string[];
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
  heldItems: [],
  carriedItems: [],
  heldIn: 0,
  extraIn: 0,
  extras: [],
  recovered: 0,
  recoveries: [],
  lastCollectedAt: null,
  firstWorkStart: null,
  rolledFrom: [],
});

type Piece = { amount: number; collectedAt: string | null; workStart: string | null; fromMonth: string };
interface LineWork {
  freshPay: Piece[];
  freshWithhold: Piece[];
  carriedPay: Piece[];
  carriedWithhold: Piece[];
}
const sumPieces = (p: Piece[]) => p.reduce((s, x) => s + x.amount, 0);
/** Split `unpaid` across pieces in proportion to their amounts (floors, remainder to the last) — keeps original dates. */
function remainderItems(pieces: Piece[], unpaid: number): CarryItem[] {
  if (unpaid <= 0 || !pieces.length) return [];
  const total = sumPieces(pieces);
  const out: CarryItem[] = [];
  let left = unpaid;
  pieces.forEach((p, i) => {
    const share = i === pieces.length - 1 ? left : Math.min(left, Math.floor((p.amount / total) * unpaid));
    left -= share;
    if (share > 0) out.push({ kind: "carried", amount: share, collectedAt: p.collectedAt, workStart: p.workStart, fromMonth: p.fromMonth });
  });
  return out;
}
const addNote = (l: BonusLine, n: string) => {
  if (!l.notes.includes(n)) l.notes.push(n);
};
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function computeRun(inp: RunInputs): RunResult {
  const payIso = paymentDate(inp.month);
  const projects: ProjectRunResult[] = [];
  const lines: BonusLine[] = [];
  const work = new Map<BonusLine, LineWork>();
  const ctx = { members: inp.members, entries: inp.entries, profiles: inp.profiles, adjustments: inp.adjustments, runs: inp.runs, taxChanges: inp.taxChanges };
  const entryIds: string[] = [];
  const workOf = (l: BonusLine) => {
    let w = work.get(l);
    if (!w) {
      w = { freshPay: [], freshWithhold: [], carriedPay: [], carriedWithhold: [] };
      work.set(l, w);
    }
    return w;
  };
  const lineFor = (initiativeId: string, userId: string) => {
    let line = lines.find((l) => l.initiativeId === initiativeId && l.userId === userId);
    if (!line) {
      line = emptyLine(initiativeId, userId);
      lines.push(line);
    }
    return line;
  };
  const stamp = (l: BonusLine, collectedAt: string | null, workStart: string | null) => {
    if (collectedAt && (!l.lastCollectedAt || collectedAt > l.lastCollectedAt)) l.lastCollectedAt = collectedAt;
    if (workStart && (!l.firstWorkStart || workStart < l.firstWorkStart)) l.firstWorkStart = workStart;
  };

  for (const ini of inp.initiatives) {
    if (!["approved", "active", "completed"].includes(ini.status)) continue;
    const cycle = projectCycles(ini, ctx, inp.month).find((c) => c.month === inp.month);
    if (!cycle || (!cycle.payments.length && !cycle.topUp && !cycle.members.some((m) => m.revShare > 0))) continue;
    const rate = projectRate(ini, inp.adjustments);
    const deferralReasons = deferralTriggers(ini, inp.adjustments);
    const defPct = deferralShare(ini, inp.adjustments);
    const rows = ledgerRows(inp.members, ini.id);
    const totalWeight = [...new Set(rows.filter((r) => !r.leftAt || Date.parse(r.leftAt) >= Date.parse(monthStart(inp.month))).map((r) => r.userId))].reduce((s, u) => s + Math.max(...rows.filter((r) => r.userId === u).map(effectiveWeight)), 0);
    const rolledFrom = [...new Set(cycle.payments.map((p) => p.rolledFrom).filter(Boolean) as string[])];
    const ids = cycle.payments.map((p) => p.entry.id);
    entryIds.push(...ids);
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
      rolledFrom,
      entryIds: ids,
    };
    projects.push(pr);
    const topUpMonth = cycle.topUp > 0;

    for (const mc of cycle.members) {
      if (mc.revShare <= 0 && mc.topUp <= 0) continue;
      const line = lineFor(ini.id, mc.userId);
      const w = workOf(line);
      Object.assign(line, { weight: mc.weight, totalWeight, weightDays: mc.weightDays, totalWeightDays: cycle.totalWeightDays, sharePct: rate.rate, netRevenue: pr.net, pool: cycle.revPool, gross: mc.revShare, topUp: mc.topUp, topUpDeducted: mc.deducted, rolledFrom });
      if (mc.topUp > 0) line.notes.push(`Type C top-up to the standard bonus (§8.6) — balance to deduct Rp${Math.round(mc.balanceAfter).toLocaleString("en-US")}`);
      if (mc.deducted > 0) line.notes.push(`Earlier top-ups deducted Rp${mc.deducted.toLocaleString("en-US")} (§8.6)`);
      if (rolledFrom.length) addNote(line, `Includes payments collected for the released ${rolledFrom.join(", ")} cycle${rolledFrom.length > 1 ? "s" : ""}, entered late — paid now as an underpayment correction (§8.5)`);
      const profile = inp.profiles.find((p) => p.userId === mc.userId);
      let protectedLeft = mc.guaranteed;
      for (const piece of mc.pieces) {
        if (piece.amount <= 0) continue;
        const o = paymentOutcome(profile, payIso, piece.collectedAt, piece.workStart);
        if (o.kind === "forfeit") {
          line.forfeited += piece.amount;
          addNote(line, o.reason);
          continue;
        }
        let amount = piece.amount;
        const guard = Math.min(amount, protectedLeft);
        protectedLeft -= guard;
        // §9.3 deferral never takes a Type C monthly pool below its standard bonus
        if (defPct > 0) {
          const d = floorRp((amount - guard) * defPct);
          line.deferred += d;
          amount -= d;
        }
        stamp(line, piece.collectedAt, piece.workStart);
        if (o.kind === "hold") {
          // held with its dates; re-tested and paid in a later cycle once the condition clears (§10, §15.1)
          line.held += amount;
          line.heldItems!.push({ kind: "held", amount, collectedAt: piece.collectedAt, workStart: piece.workStart, fromMonth: inp.month, reason: o.reason });
          addNote(line, o.reason);
          continue;
        }
        if (o.kind === "pay" && o.note) addNote(line, o.note);
        const p: Piece = { amount: amount - guard, collectedAt: piece.collectedAt, workStart: piece.workStart, fromMonth: inp.month };
        if (o.kind === "withhold_probation" && !topUpMonth) {
          // §11.3 held in the Probationary Bonus Accrual — the guarantee is not paid in cash either
          w.freshWithhold.push({ ...p, amount });
          continue;
        }
        if (o.kind === "withhold_probation") addNote(line, "Probationary — paid with salary in a top-up month (§8.6, §11.3)");
        line.guaranteed += guard;
        if (p.amount > 0) w.freshPay.push(p);
      }
      if (line.deferred > 0) line.notes.push(`${Math.round(defPct * 100)}% deferred to ${deferralVestDate(ini).slice(0, 10)}: ${deferralReasons.join("; ")} (§9.3)`);
    }
  }

  // carried-forward and held amounts from earlier months — re-tested against §10 with their original dates (§9.2)
  const fallbackCollected = new Date(Date.parse(collectionWindow(inp.month).from) - 1).toISOString();
  for (const c of inp.carriedIn ?? []) {
    if (c.amount <= 0) continue;
    const line = lineFor(c.initiativeId, c.userId);
    const w = workOf(line);
    const profile = inp.profiles.find((p) => p.userId === c.userId);
    const collectedAt = c.collectedAt ?? fallbackCollected;
    const workStart = c.workStart ?? collectedAt;
    const o = paymentOutcome(profile, payIso, collectedAt, workStart);
    const from = c.fromMonth ? ` from ${c.fromMonth}` : "";
    if (o.kind === "forfeit") {
      line.forfeited += c.amount;
      addNote(line, `${c.kind === "held" ? "Held" : "Carried-forward"} amount Rp${fmt(c.amount)}${from} forfeited — ${o.reason}`);
      continue;
    }
    if (o.kind === "hold") {
      line.held += c.amount;
      line.heldItems!.push({ kind: "held", amount: c.amount, collectedAt: c.collectedAt ?? null, workStart: c.workStart ?? null, fromMonth: c.fromMonth ?? inp.month, reason: o.reason });
      addNote(line, `${o.reason}${c.fromMonth ? ` — still held (since ${c.fromMonth})` : ""}`);
      continue;
    }
    stamp(line, c.collectedAt ?? null, c.workStart ?? null);
    line.carriedIn += c.amount;
    if (c.kind === "held") {
      line.heldIn = (line.heldIn ?? 0) + c.amount;
      addNote(line, `Held amount Rp${fmt(c.amount)}${from} released — the hold has cleared${c.reason ? ` (was: ${c.reason.replace(/ \(§[^)]*\)$/, "")})` : ""} (§10)`);
    }
    const p: Piece = { amount: c.amount, collectedAt: c.collectedAt ?? null, workStart: c.workStart ?? null, fromMonth: c.fromMonth ?? inp.month };
    if (o.kind === "withhold_probation") w.carriedWithhold.push(p);
    else w.carriedPay.push(p);
  }

  // deferred releases, Probation Completion Bonuses and adjustments — §9.1 tested, paid first with carried amounts
  for (const x of inp.extraPayments ?? []) {
    if (x.amount <= 0) continue;
    const line = lineFor(x.initiativeId, x.userId);
    const w = workOf(line);
    const profile = inp.profiles.find((p) => p.userId === x.userId);
    const collectedAt = x.collectedAt ?? fallbackCollected;
    const o = x.kind === "probation_completion" ? ({ kind: "pay" } as PaymentOutcome) : paymentOutcome(profile, payIso, collectedAt, x.workStart ?? collectedAt);
    if (o.kind === "forfeit") {
      line.forfeited += x.amount;
      addNote(line, `${x.note} — forfeited: ${o.reason}`);
      continue;
    }
    if (o.kind === "hold") {
      line.held += x.amount;
      line.heldItems!.push({ kind: "held", amount: x.amount, collectedAt: x.collectedAt ?? null, workStart: x.workStart ?? null, fromMonth: inp.month, reason: o.reason });
      addNote(line, `${x.note} — held: ${o.reason}`);
      continue;
    }
    line.extraIn = (line.extraIn ?? 0) + x.amount;
    line.extras!.push({ kind: x.kind, refId: x.refId, amount: x.amount, note: x.note });
    addNote(line, `${x.note} — Rp${fmt(x.amount)}`);
    const p: Piece = { amount: x.amount, collectedAt: x.collectedAt ?? null, workStart: x.workStart ?? null, fromMonth: inp.month };
    if (o.kind === "withhold_probation" && x.kind !== "probation_final_pay") w.carriedWithhold.push(p);
    else w.carriedPay.push(p);
  }

  // §9.1 break-even test (rolling three months) and cash check, §9.2 pro rata
  const allWork = lines.map((l) => [l, workOf(l)] as const);
  const guaranteed = lines.reduce((s, l) => s + l.guaranteed, 0);
  const carried = allWork.reduce((s, [, w]) => s + sumPieces(w.carriedPay), 0);
  const fresh = allWork.reduce((s, [, w]) => s + sumPieces(w.freshPay), 0);
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

  for (const [l, w] of allWork) {
    const carriedPayTotal = sumPieces(w.carriedPay);
    const carriedPaid = floorRp(carriedPayTotal * carriedPaidPct);
    const freshPart = sumPieces(w.freshPay);
    const freshPaid = floorRp(freshPart * payoutPct);
    // §9.2 every employee receives the same percentage — probation accruals included (§11.3)
    const cwTotal = sumPieces(w.carriedWithhold);
    const cwPaid = floorRp(cwTotal * carriedPaidPct);
    const fwTotal = sumPieces(w.freshWithhold);
    const fwPaid = floorRp(fwTotal * payoutPct);
    l.carriedItems = [
      ...remainderItems(w.carriedPay, carriedPayTotal - carriedPaid),
      ...remainderItems(w.freshPay, freshPart - freshPaid),
      ...remainderItems(w.carriedWithhold, cwTotal - cwPaid),
      ...remainderItems(w.freshWithhold, fwTotal - fwPaid),
    ];
    l.carriedOver = l.carriedItems.reduce((s, x) => s + x.amount, 0);
    l.payable = l.guaranteed + freshPaid + carriedPaid;
    l.withheld = fwPaid + cwPaid;
    if (l.carriedOver > 0) l.notes.push(`Break-even test or cash check failed — ${Math.round(payoutPct * 10_000) / 100}% paid; rest carried forward and paid first next passing month (§9.2)`);
    if (l.carriedIn > 0) l.notes.push(`Includes Rp${floorRp(l.carriedIn * carriedPaidPct).toLocaleString("en-US")} carried forward from an earlier month (§9.2)`);
    if (l.withheld > 0) addNote(l, "Probationary — held until probation ends (§11.3)");
  }

  // §9.4 clawback recovery from this cycle's bonuses (after deferred / carried amounts, before salary)
  for (const r of inp.recoveries ?? []) {
    let left = Math.max(0, Math.floor(r.amount));
    const own = lines.filter((l) => l.userId === r.userId && l.payable > 0).sort((a, b) => Number(b.initiativeId === r.initiativeId) - Number(a.initiativeId === r.initiativeId) || b.payable - a.payable);
    for (const l of own) {
      if (left <= 0) break;
      const take = Math.min(l.payable, left);
      l.payable -= take;
      l.recovered = (l.recovered ?? 0) + take;
      l.recoveries!.push({ clawbackId: r.clawbackId, amount: take });
      left -= take;
      addNote(l, `Clawback ${r.clawbackId} — Rp${fmt(take)} recovered from this bonus (§9.4 order of recovery)`);
    }
  }

  // §8.5 PPh 21 estimate per person on everything paid with this salary
  const byUser = new Map<string, BonusLine[]>();
  for (const l of lines) byUser.set(l.userId, [...(byUser.get(l.userId) ?? []), l]);
  for (const [userId, ls] of byUser) {
    const total = ls.reduce((s, l) => s + l.payable, 0);
    if (total <= 0) continue;
    const prof = inp.profiles.find((p) => p.userId === userId);
    const est = pph21BonusEstimate((prof?.annualBaseSalary ?? 0) / 12, total, prof?.ptkpStatus, inp.month);
    let left = est.withheld;
    const paying = ls.filter((l) => l.payable > 0);
    paying.forEach((l, i) => {
      const share = i === paying.length - 1 ? left : Math.min(left, Math.floor((l.payable / total) * est.withheld));
      left -= share;
      const pph: Pph21Estimate = { gross: l.payable, withheld: share, net: l.payable - share, category: est.category, ptkp: prof?.ptkpStatus || "TK/0", rate: est.rate, monthlySalary: est.monthlySalary, basis: "estimate", note: est.note };
      l.pph21 = pph;
    });
  }

  for (const l of lines) {
    l.status =
      l.payable <= 0 && l.forfeited > 0 && !l.held && !l.withheld && !l.carriedOver
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
      extraIn: lines.reduce((s, l) => s + (l.extraIn ?? 0), 0),
      heldIn: lines.reduce((s, l) => s + (l.heldIn ?? 0), 0),
      recovered: lines.reduce((s, l) => s + (l.recovered ?? 0), 0),
      pph21Estimate: lines.reduce((s, l) => s + (l.pph21?.withheld ?? 0), 0),
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
    entryIds,
    dateNotes: cycleDates(inp.month).notes,
  };
}

/**
 * Amounts brought forward into the cycle `beforeMonth` from the latest certified or released run before it: §9.2
 * carried-forward amounts (kind "carried") and §10 / §15.1 held amounts (kind "held"), each with the collection and
 * work dates computeRun needs to re-test them. Runs saved before held tracking existed fall back to the line totals.
 */
export function carriedForward(runs: BonusRun[], beforeMonth: string): CarryInput[] {
  const prior = runs.filter((r) => r.month < beforeMonth && (r.status === "released" || r.status === "certified")).sort((a, b) => a.month.localeCompare(b.month));
  const last = prior[prior.length - 1];
  if (!last) return [];
  const out: CarryInput[] = [];
  for (const l of last.lines) {
    if (l.carriedItems) for (const c of l.carriedItems) out.push({ initiativeId: l.initiativeId, userId: l.userId, amount: c.amount, kind: "carried", collectedAt: c.collectedAt, workStart: c.workStart, fromMonth: c.fromMonth });
    else if (l.carriedOver > 0) out.push({ initiativeId: l.initiativeId, userId: l.userId, amount: l.carriedOver, kind: "carried", fromMonth: last.month });
    if (l.heldItems) for (const c of l.heldItems) out.push({ initiativeId: l.initiativeId, userId: l.userId, amount: c.amount, kind: "held", collectedAt: c.collectedAt, workStart: c.workStart, fromMonth: c.fromMonth, reason: c.reason });
    else if (l.held > 0) out.push({ initiativeId: l.initiativeId, userId: l.userId, amount: l.held, kind: "held", fromMonth: last.month });
  }
  return out;
}
/** Only the §9.2 carried-forward part of carriedForward(). */
export const carriedOnly = (runs: BonusRun[], beforeMonth: string) => carriedForward(runs, beforeMonth).filter((c) => c.kind !== "held");
/** Only the held part of carriedForward() — amounts waiting for Annex B, a suspension, unpaid leave or PRC confirmation. */
export const heldForward = (runs: BonusRun[], beforeMonth: string) => carriedForward(runs, beforeMonth).filter((c) => c.kind === "held");

/** Next salary cycle (from `atIso`) whose run is neither certified nor released — where late items are paid. */
export function nextOpenCycle(runs: BonusRun[], atIso: string = nowIso()) {
  let m = cycleMonth(atIso);
  for (let i = 0; i < 240; i++) {
    const r = runs.find((x) => x.month === m);
    if (!r || r.status === "draft" || r.status === "failed") return m;
    m = nextMonth(m);
  }
  return m;
}

/** §11.3 probation accrual (withheld amounts) by project for a person, from certified and released runs. */
export function probationBalanceByProject(userId: string, runs: BonusRun[]) {
  const by = new Map<string, number>();
  for (const r of runs) {
    if (r.status !== "released" && r.status !== "certified") continue;
    for (const l of r.lines) if (l.userId === userId && l.withheld > 0) by.set(l.initiativeId, (by.get(l.initiativeId) ?? 0) + l.withheld);
  }
  return [...by.entries()].map(([initiativeId, amount]) => ({ initiativeId, amount }));
}
/** Scale a by-project balance to a total (floors; remainder to the largest) — e.g. a probation outcome net of earlier payments. */
export function splitByProject(parts: { initiativeId: string; amount: number }[], total: number) {
  const sum = parts.reduce((s, p) => s + p.amount, 0);
  if (sum <= 0 || total <= 0) return [];
  const out = parts.map((p) => ({ initiativeId: p.initiativeId, amount: Math.floor((p.amount / sum) * total) }));
  const rest = Math.floor(total) - out.reduce((s, p) => s + p.amount, 0);
  if (rest > 0) out.sort((a, b) => b.amount - a.amount)[0].amount += rest;
  return out.filter((p) => p.amount > 0);
}

/**
 * Extra payments due in `month`: deferred releases (status released, payMonth = month), probation balances (completed
 * → Probation Completion Bonus; ended → with final pay) and §8.3/§8.5 adjustments.
 */
export function extraPaymentsFor(month: string, src: { deferred?: DeferredBonus[]; probationOutcomes?: ProbationOutcome[]; bonusAdjustments?: BonusAdjustment[]; runs?: BonusRun[] }): ExtraPayment[] {
  const out: ExtraPayment[] = [];
  for (const d of src.deferred ?? []) {
    if (d.status !== "released" || d.payMonth !== month || d.releasedAmount <= 0) continue;
    out.push({ kind: "deferred_release", refId: d.id, userId: d.userId, initiativeId: d.initiativeId, amount: d.releasedAmount, collectedAt: d.collectedAt ?? null, workStart: d.workStart ?? null, note: `Deferred bonus from ${d.month} released (§9.3)` });
  }
  for (const o of src.probationOutcomes ?? []) {
    if (o.payMonth !== month || o.outcome === "forfeited" || o.amount <= 0) continue;
    const parts = o.byProject?.length ? o.byProject : splitByProject(probationBalanceByProject(o.userId, src.runs ?? []), o.amount);
    for (const p of parts)
      out.push({
        kind: o.outcome === "completed" ? "probation_completion" : "probation_final_pay",
        refId: o.id ?? `po-${o.userId}`,
        userId: o.userId,
        initiativeId: p.initiativeId,
        amount: p.amount,
        collectedAt: o.endedAt ?? o.decidedAt,
        workStart: null,
        note: o.outcome === "completed" ? "Probation Completion Bonus — held balance paid within 30 days of the probation end (§11.4)" : "Probation balance paid with final pay, less PPh 21 (§11.4)",
      });
  }
  for (const a of src.bonusAdjustments ?? []) {
    if (a.payMonth !== month || a.amount <= 0) continue;
    out.push({ kind: a.kind, refId: a.id, userId: a.userId, initiativeId: a.initiativeId, amount: a.amount, collectedAt: a.createdAt, workStart: null, note: a.kind === "reconciliation_topup" ? "Final reconciliation top-up (§8.3)" : "Underpayment corrected in the next cycle (§8.5)" });
  }
  return out;
}

/** §9.4 clawbacks being recovered from future project bonuses: what is still outstanding per case. */
export function clawbackRecoveriesFor(clawbacks: Clawback[]): RecoveryInput[] {
  return clawbacks
    .filter((c) => c.status === "recovering" && c.recoverFromBonuses)
    .map((c) => ({ clawbackId: c.id, userId: c.userId, initiativeId: c.initiativeId, amount: Math.max(0, clawbackAmount(c, clawbacks) - c.recovered) }))
    .filter((r) => r.amount > 0);
}

export interface RunState {
  initiatives: Initiative[];
  initiativeMembers: InitiativeMember[];
  revenueEntries: RevenueEntry[];
  employeeProfiles: EmployeeProfile[];
  curveAdjustments: CurveAdjustment[];
  bonusRuns: BonusRun[];
  deferredBonuses?: DeferredBonus[];
  probationOutcomes?: ProbationOutcome[];
  clawbacks?: Clawback[];
  bonusAdjustments?: BonusAdjustment[];
  taxRegimeChanges?: TaxRegimeChange[];
}
/**
 * Everything computeRun needs for a cycle, from store state: carried-forward and held amounts, late collections for
 * released cycles, deferred releases, Probation Completion Bonuses, adjustments and clawback recoveries.
 *   computeRun(buildRunInputs(useCrm.getState(), month, financeFigures))
 */
export function buildRunInputs(state: RunState, month: string, finance: Pick<RunInputs, "companyRevenue" | "directCosts" | "overheads" | "cash" | "fixedCostsMonthly">): RunInputs {
  const runs = state.bonusRuns.filter((r) => r.month !== month);
  return {
    month,
    initiatives: state.initiatives,
    members: state.initiativeMembers,
    entries: state.revenueEntries,
    profiles: state.employeeProfiles,
    adjustments: state.curveAdjustments,
    companyRevenue: finance.companyRevenue,
    directCosts: finance.directCosts,
    overheads: finance.overheads,
    cash: finance.cash,
    fixedCostsMonthly: finance.fixedCostsMonthly,
    carriedIn: carriedForward(state.bonusRuns, month),
    runs,
    extraPayments: extraPaymentsFor(month, { deferred: state.deferredBonuses, probationOutcomes: state.probationOutcomes, bonusAdjustments: state.bonusAdjustments, runs: state.bonusRuns }),
    recoveries: clawbackRecoveriesFor(state.clawbacks ?? []),
    taxChanges: state.taxRegimeChanges,
  };
}

/* ───────────────────────── §8.2 / §13.1 certification & release controls ───────────────────────── */

const hasRole = (p: EmployeeProfile | undefined, ...roles: string[]) => !!p && p.governanceRoles.some((r) => roles.includes(r));
/** PRC members (§13.1: CEO as chair, CFO, COO, appointed technical managers) still employed. */
export function prcRoster(profiles: EmployeeProfile[], atIso: string = nowIso()) {
  return profiles.filter((p) => hasRole(p, "prc", "ceo") && !(p.separation && Date.parse(p.separation.effectiveAt) <= Date.parse(atIso)) && (!p.prcTermEndsAt || Date.parse(p.prcTermEndsAt) > Date.parse(atIso)));
}

/** §8.2 / §9.1 may `actorId` record the CFO's certification for `month` (themselves or on behalf of `certifiedById`)? */
export function certifyCheck(month: string, ctx: { profiles: EmployeeProfile[]; actorId: string; certifiedById?: string | null; atIso?: string }) {
  const blockers: string[] = [];
  const timing = certifyBlock(month, ctx.atIso);
  if (timing) blockers.push(timing);
  const certifierId = ctx.certifiedById ?? ctx.actorId;
  const certifier = ctx.profiles.find((p) => p.userId === certifierId);
  if (!hasRole(certifier, "cfo", "finance")) blockers.push("Only the CFO or a named Finance delegate certifies the break-even test and cash check (§8.2, §9.1)");
  const onBehalf = certifierId !== ctx.actorId;
  if (onBehalf && !hasRole(ctx.profiles.find((p) => p.userId === ctx.actorId), "finance", "cfo", "prc", "ceo")) blockers.push("Only Finance or the PRC secretary may enter the CFO's written certification on her behalf");
  return { ok: blockers.length === 0, blockers, certifierId, onBehalf };
}

export type ReleaseVote = { userId: string; vote: "for" | "against" };
/**
 * §8.2 / §13.1 may the PRC release this run, recorded by `actorId`?
 * Maker-checker: whoever certified or entered the certification may not also release it. A PRC member with lines in
 * the run (on a project team) is recused. A single uninvolved PRC member may record the release; otherwise — or when
 * `votes` are given — a PRC vote is needed: a quorum of more than half of the members, including the CFO or a Finance
 * delegate, recused members not counting; simple majority, chair's casting vote on a tie.
 */
export function releaseCheck(run: Pick<BonusRun, "status" | "month" | "lines" | "certifiedById"> & Partial<Pick<BonusRun, "recordedById">>, ctx: { profiles: EmployeeProfile[]; actorId: string; votes?: ReleaseVote[]; atIso?: string }) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const at = ctx.atIso ?? nowIso();
  const roster = prcRoster(ctx.profiles, at);
  const rosterIds = roster.map((p) => p.userId);
  const inRun = new Set(run.lines.filter((l) => l.payable + l.deferred + l.withheld + l.held + l.carriedOver + l.carriedIn > 0).map((l) => l.userId));
  const recused = rosterIds.filter((u) => inRun.has(u));
  const actor = ctx.profiles.find((p) => p.userId === ctx.actorId);
  if (run.status !== "certified") blockers.push(run.status === "released" ? "Already released" : "The CFO must certify the break-even test and cash check first (§8.2)");
  if (!rosterIds.includes(ctx.actorId) && !hasRole(actor, "prc", "ceo")) blockers.push("Only the PRC authorises release (§8.2, §13.2)");
  if (run.certifiedById && run.certifiedById === ctx.actorId) blockers.push("Maker-checker: the person who certified the checks cannot also release the run");
  if (run.recordedById && run.recordedById === ctx.actorId && run.recordedById !== run.certifiedById) blockers.push("Maker-checker: you entered the CFO's certification — another PRC member must release");
  const votes = (ctx.votes ?? []).filter((v, i, a) => a.findIndex((x) => x.userId === v.userId) === i);
  const mode: "single" | "vote" = votes.length ? "vote" : "single";
  const counted = votes.filter((v) => rosterIds.includes(v.userId) && !recused.includes(v.userId));
  const forIds = counted.filter((v) => v.vote === "for").map((v) => v.userId);
  const againstIds = counted.filter((v) => v.vote === "against").map((v) => v.userId);
  const financePresent = counted.some((v) => hasRole(ctx.profiles.find((p) => p.userId === v.userId), "cfo", "finance"));
  const needed = Math.floor(roster.length * POLICY.prcQuorum.majority) + 1;
  const chair = roster.find((p) => hasRole(p, "ceo"))?.userId ?? null;
  const carried = forIds.length > againstIds.length || (forIds.length === againstIds.length && forIds.length > 0 && !!chair && forIds.includes(chair));
  if (mode === "single") {
    if (recused.includes(ctx.actorId)) blockers.push("You have lines in this run (you are on a project team) — you are recused; record a PRC vote with a quorum instead (§13.1)");
  } else {
    if (counted.length < needed) blockers.push(`No quorum: ${counted.length} of ${roster.length} PRC members voting (need ${needed}${recused.length ? `; ${recused.length} recused` : ""}) (§13.1)`);
    if (POLICY.prcQuorum.requireFinance && !financePresent) blockers.push("The quorum must include the CFO or a named Finance delegate (§13.1)");
    if (!carried) blockers.push(`Release not carried: ${forIds.length} for, ${againstIds.length} against${forIds.length === againstIds.length ? " — the chair did not cast the deciding vote for" : ""} (§13.1)`);
    const ignored = votes.filter((v) => !counted.includes(v)).map((v) => v.userId);
    if (ignored.length) warnings.push(`${ignored.length} vote${ignored.length > 1 ? "s" : ""} not counted (recused or not a PRC member)`);
  }
  const timing = cycleTiming(run.month, at);
  if (timing.phase === "late") warnings.push(`Released after the ${timing.salary.date} salary date — the reason is recorded with the release`);
  if (!timing.cutoffPassed) blockers.push(certifyBlock(run.month, at) ?? "Collections still open");
  return { ok: blockers.length === 0, blockers, warnings, mode, roster: rosterIds, recused, quorum: { needed, present: counted.length, financePresent, for: forIds, against: againstIds, carried }, late: timing.phase === "late" };
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

/* ───────────────────────── §8.3 final reconciliation ───────────────────────── */

/**
 * §8.3 within 30 days of close: final pool on final figures (with the §5.1 recalculation when actual x ran > 20% above
 * the x used for the rate) vs the revenue-based bonus already allocated. A positive difference is paid with the next
 * salary (shared like the allocations so far); a negative one is taken first from the member's pending deferred amounts,
 * and any remainder is a §9.4 data-error clawback (a rate recalculation counts) or absorbed by the company.
 */
export function finalReconciliation(ini: Initiative, ctx: { entries: RevenueEntry[]; runs: BonusRun[]; deferred?: DeferredBonus[]; adjustments?: CurveAdjustment[] }) {
  const review = rateReview(ini, ctx.entries.filter((e) => e.received), ctx.adjustments);
  const received = ctx.entries.filter((e) => e.initiativeId === ini.id && e.received);
  const unpaid = ctx.entries.filter((e) => e.initiativeId === ini.id && !e.received);
  const totalNet = received.reduce((s, e) => s + netRevenue(e.revenue, e.directCosts).net, 0);
  const rateChanged = review.source === "curve" && review.flags.some((f) => f.includes("20% above"));
  const finalRate = rateChanged ? review.recalculatedRate : review.rate;
  const finalPool = floorRp(Math.max(0, totalNet) * finalRate);
  const byUser = new Map<string, number>();
  for (const r of ctx.runs) {
    if (r.status !== "released") continue;
    for (const l of r.lines) if (l.initiativeId === ini.id) byUser.set(l.userId, (byUser.get(l.userId) ?? 0) + Math.max(0, l.gross - l.topUpDeducted));
  }
  const allocated = [...byUser.values()].reduce((s, v) => s + v, 0);
  const difference = finalPool - allocated;
  const pendingDeferred = (u: string) => (ctx.deferred ?? []).filter((d) => d.initiativeId === ini.id && d.userId === u && d.status === "pending").reduce((s, d) => s + d.amount, 0);
  const members = [...byUser.entries()].map(([userId, alloc]) => {
    const share = allocated > 0 ? alloc / allocated : 0;
    const amount = difference >= 0 ? floorRp(difference * share) : -Math.floor(-difference * share);
    const offset = amount < 0 ? Math.min(pendingDeferred(userId), -amount) : 0;
    return { userId, allocated: alloc, share, amount, offsetFromDeferred: offset, remainder: amount < 0 ? -amount - offset : 0 };
  });
  const closedAt = ini.completedAt;
  return {
    initiativeId: ini.id,
    totalNet,
    rate: review.rate,
    finalRate,
    rateChanged,
    finalPool,
    allocated,
    difference,
    members,
    topUpTotal: members.reduce((s, m) => s + Math.max(0, m.amount), 0),
    offsetTotal: members.reduce((s, m) => s + m.offsetFromDeferred, 0),
    remainderTotal: members.reduce((s, m) => s + m.remainder, 0),
    unpaidInvoices: unpaid.length,
    unpaidAmount: unpaid.reduce((s, e) => s + e.revenue, 0),
    dueBy: closedAt ? new Date(Date.parse(closedAt) + POLICY.closeReconciliationDays * DAY).toISOString() : null,
    notes: [
      rateChanged ? `Rate recalculated for the whole project: ${(review.rate * 100).toFixed(3)}% → ${(finalRate * 100).toFixed(3)}% (actual x ${fmt(review.actualX)}) (§5.1)` : null,
      unpaid.length ? `${unpaid.length} payment${unpaid.length > 1 ? "s" : ""} not yet collected — a final invoice unpaid 90 days after its due date may be left out; a late collection pays a late-collection bonus (§8.3)` : null,
      difference < 0 ? "Overpayment taken first from deferred amounts; any remainder is recovered under §9.4 only for a revenue reversal, misconduct or data error (a rate recalculation counts), otherwise absorbed" : null,
    ].filter(Boolean) as string[],
  };
}

/* ───────────────────────── §5.4 UMKM turnover ───────────────────────── */

/**
 * §5.4 gross turnover for a tax year against the Rp4.8bn UMKM limit. Uses Finance's company turnover records (all
 * revenue, incl. work outside the policy) when present for the year, else the programme's collected payments (a lower
 * bound). Once the limit is passed the 0.5% rate runs to the end of that tax year and normal rates apply from the next.
 */
export function umkmTurnover(year: string | number, src: { entries: RevenueEntry[]; companyTurnover?: CompanyTurnover[] }) {
  const y = String(year);
  const company = (src.companyTurnover ?? []).filter((c) => c.month.startsWith(y)).sort((a, b) => a.month.localeCompare(b.month));
  const source: "company" | "programme" = company.length ? "company" : "programme";
  const months =
    source === "company"
      ? company.map((c) => ({ month: c.month, revenue: c.revenue }))
      : Object.entries(
          src.entries
            .filter((e) => e.received && (e.collectedAt ? cal.wibDateKey(e.collectedAt) : e.month).startsWith(y))
            .reduce<Record<string, number>>((acc, e) => {
              const m = e.collectedAt ? monthKey(e.collectedAt) : e.month;
              acc[m] = (acc[m] ?? 0) + e.revenue;
              return acc;
            }, {}),
        )
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, revenue]) => ({ month, revenue }));
  let cum = 0;
  let crossedIn: string | null = null;
  const limit = POLICY.tax.umkmTurnoverLimit;
  const rows = months.map((m) => {
    cum += m.revenue;
    if (!crossedIn && cum > limit) crossedIn = m.month;
    return { ...m, cumulative: cum };
  });
  const pct = cum / limit;
  const level: "ok" | "watch" | "warning" | "exceeded" = pct > 1 ? "exceeded" : pct >= POLICY.umkmAlerts.warning ? "warning" : pct >= POLICY.umkmAlerts.watch ? "watch" : "ok";
  return {
    year: y,
    source,
    turnover: cum,
    limit,
    pct,
    level,
    remaining: Math.max(0, limit - cum),
    crossedIn,
    switchFrom: crossedIn ? `${Number(y) + 1}-01-01T00:00:00+07:00` : null,
    months: rows,
    note:
      level === "exceeded"
        ? `Turnover passed Rp4.8bn in ${crossedIn} — 0.5% continues to 31 Dec ${y}; corporate income tax from 1 Jan ${Number(y) + 1}. Finance confirms the switch date with the tax adviser and gives 30 days' notice (§5.4)`
        : level === "warning"
          ? "Over 90% of the Rp4.8bn UMKM limit — prepare the §5.4 switch notice"
          : level === "watch"
            ? "Over 70% of the Rp4.8bn UMKM limit"
            : "Within the UMKM limit",
  };
}

/* ───────────────────────── §9.4 clawback ───────────────────────── */

type ClawbackLike = Pick<Clawback, "originalPaid" | "recalculated"> & Partial<Pick<Clawback, "id" | "trigger" | "personallyAtFault" | "userId" | "initiativeId" | "createdAt">>;
const harbourCase = (c: ClawbackLike) => c.trigger === "data_error" && c.personallyAtFault === false;
const caseBefore = (a: ClawbackLike, b: ClawbackLike) => {
  const ka = a.createdAt ?? "";
  const kb = b.createdAt ?? "￿";
  return ka < kb || (ka === kb && (a.id ?? "") < (b.id ?? ""));
};
/** §9.4 safe harbour still available to this case: Rp10,000,000 per person per project, less what earlier data-error cases used. */
export function safeHarbourLeft(c: ClawbackLike, others: ClawbackLike[] = []) {
  let left = POLICY.clawback.dataErrorSafeHarbour;
  if (!c.userId || !c.initiativeId) return left;
  const earlier = others.filter((o) => o !== c && (o.id == null || o.id !== c.id) && o.userId === c.userId && o.initiativeId === c.initiativeId && harbourCase(o) && caseBefore(o, c)).sort((a, b) => (caseBefore(a, b) ? -1 : 1));
  for (const o of earlier) left -= Math.min(left, Math.max(0, o.originalPaid - o.recalculated));
  return Math.max(0, left);
}

/**
 * Bonus paid minus the bonus on corrected figures. For a data error the employee did not cause, the first
 * Rp10,000,000 per person per project is not clawed back — pass the other cases (`others`) so the harbour is used once.
 */
export function clawbackAmount(c: ClawbackLike, others: ClawbackLike[] = []) {
  const diff = Math.max(0, c.originalPaid - c.recalculated);
  if (harbourCase(c)) return Math.max(0, diff - safeHarbourLeft(c, others));
  return diff;
}

/**
 * Why a case cannot be clawed back, or null. The 24-month window runs from the payment date to the trigger date
 * (`triggeredAt`, else when Finance identified it, else `atIso` for a case being drafted) — never to today.
 */
export function clawbackExempt(c: Pick<Clawback, "trigger" | "personallyAtFault" | "originalPaid" | "recalculated" | "paidAt"> & Partial<Pick<Clawback, "id" | "userId" | "initiativeId" | "createdAt" | "triggeredAt">>, atIso?: string, others: ClawbackLike[] = []) {
  const triggerAt = c.triggeredAt ?? c.createdAt ?? atIso ?? nowIso();
  if (Date.parse(triggerAt) > Date.parse(addMonths(c.paidAt, POLICY.clawback.windowMonths))) return "Outside the 24-month clawback window (§9.4)";
  if (!["revenue_reversal", "misconduct", "data_error"].includes(c.trigger)) return "Normal business or market risk is never clawed back (§9.4)";
  if (clawbackAmount(c, others) <= 0) return c.trigger === "data_error" ? "Data error not caused by the employee — within the Rp10,000,000 safe harbour per person per project (§9.4)" : "No overpayment";
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

/**
 * Month-end bonus liabilities for Finance's accruals (§9.2, §9.3, §10, §11.3 Probationary Bonus Accrual account; §11.5
 * reporting): balance of each account at the end of `month` and of the month before, from certified and released
 * runs, the deferred ledger and probation outcomes. Aggregates only (§9.6).
 */
export function liabilityRollForward(month: string, src: { runs: BonusRun[]; deferred?: DeferredBonus[]; probationOutcomes?: ProbationOutcome[] }) {
  const counted = src.runs.filter((r) => r.status === "released" || r.status === "certified").sort((a, b) => a.month.localeCompare(b.month));
  const latest = (m: string) => counted.filter((r) => r.month <= m).pop();
  const balances = (m: string) => {
    const end = Date.parse(monthEnd(m));
    const probation = counted.filter((r) => r.month <= m).reduce((s, r) => s + r.lines.reduce((a, l) => a + l.withheld, 0), 0) - (src.probationOutcomes ?? []).filter((o) => Date.parse(o.decidedAt) <= end).reduce((s, o) => s + o.amount, 0);
    const deferred = (src.deferred ?? [])
      .filter((d) => d.month <= m && (d.status === "pending" || (d.status === "released" && d.releasedAt && Date.parse(d.releasedAt) > end)))
      .reduce((s, d) => s + (d.status === "pending" ? d.amount : d.releasedAmount + (d.costDeduction ?? 0)), 0);
    const run = latest(m);
    return { probation: Math.max(0, probation), deferred, carried: run?.totals.carriedOver ?? 0, held: run?.totals.held ?? 0 };
  };
  const close = balances(month);
  const open = balances(nextMonth(month, -1));
  const meta = [
    { key: "probation", label: "Probationary Bonus Accrual", cite: "11.3" },
    { key: "deferred", label: "Deferred bonuses (high-risk projects)", cite: "9.3" },
    { key: "carried", label: "Carried forward after a failed check", cite: "9.2" },
    { key: "held", label: "Held — Annex B, suspension, unpaid leave, PRC confirmation", cite: "10" },
  ] as const;
  const accounts = meta.map((a) => ({ ...a, opening: open[a.key], closing: close[a.key], change: close[a.key] - open[a.key] }));
  return { month, accounts, opening: accounts.reduce((s, a) => s + a.opening, 0), closing: accounts.reduce((s, a) => s + a.closing, 0) };
}

/** Paid in a calendar year: released runs (which now include deferred releases and probation payments) plus deferred releases paid outside a run. */
export function paidInYear(userId: string, runs: BonusRun[], year: string, deferred: DeferredBonus[] = []) {
  const fromRuns = runs.filter((r) => r.status === "released" && r.month.startsWith(year)).reduce((s, r) => s + r.lines.filter((l) => l.userId === userId).reduce((a, l) => a + l.payable, 0), 0);
  const fromDeferred = deferred.filter((d) => d.userId === userId && d.status === "released" && !d.payMonth && d.vestAt.startsWith(year)).reduce((s, d) => s + d.releasedAmount, 0);
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
