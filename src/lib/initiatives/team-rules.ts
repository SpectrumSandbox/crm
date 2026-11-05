/*
 * Team rules shared by BOTH team editors — the ongoing-projects register (/projects/[id], MemberDialog / EndDialog) and
 * the initiative Team tab (/initiatives/[id], TeamEditor / AmendmentModal). One source for:
 *   · when a change must go through a §6.8 amendment instead of being edited directly (requiresAmendment)
 *   · who votes on an amendment (currentVoters) and what makes it break the policy (amendmentIssues)
 *   · candidate eligibility (§3), leadership capacity (§7.3), part-time caps (§3.1) and concurrent roles (§7.1)
 *   · the non-standard weight rule (§6.7: every initial member agrees in writing, with a reason; capped)
 *   · ledger dates in WIB (amendments apply from 00:00 WIB on their effective date; last day ends 23:59:59 WIB)
 *   · Indonesian number input for "Rp million" fields
 * Pure functions — no store / React.
 */
import type { ChangeOrder, CoiDeclaration, CurveAdjustment, EmployeeProfile, Initiative, InitiativeMember, ProjectRole, ProjectUpdate, Rag, TeamAmendment } from "./types";
import { capacityCheck, concurrentNonLeadRoles, maxAllocationFactor, memberWeight, participationEligibility, proposalEconomics } from "./engine";
import { POLICY, ROLE_META } from "./policy";

const DAY = 86_400_000;
const WIB = 7 * 3_600_000;

/* ───────────────────────── dates (WIB) ───────────────────────── */

/** yyyy-mm-dd of an instant in WIB */
export const wibDay = (iso: string | number = Date.now()) => new Date((typeof iso === "number" ? iso : Date.parse(iso)) + WIB).toISOString().slice(0, 10);
/** today in WIB as yyyy-mm-dd (for <input type="date" min>) */
export const todayWib = () => wibDay(Date.now());
/** A ledger row starts / an amendment takes effect at 00:00 WIB on its date (§6.8 step 6). */
export const ledgerDate = (day: string) => new Date(`${day}T00:00:00+07:00`).toISOString();
/** A "last day on the team" ends at 23:59:59.999 WIB, so that day still counts (§6.5). */
export const lastDayEnd = (day: string) => new Date(`${day}T23:59:59.999+07:00`).toISOString();
/** yyyy-mm-dd plus n calendar days */
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** Six-month contract: start + 6 months − 1 day, so contractedMonths() counts 6 (§5.1). */
export function sixMonthsFrom(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1 + 6, d));
  return new Date(end.getTime() - DAY).toISOString().slice(0, 10);
}
/** Is a yyyy-mm-dd date before today (WIB)? */
export const isPastDay = (day: string) => !!day && day < todayWib();

/* ───────────────────────── ledger state & amendments ───────────────────────── */

export const isOpenRow = (m: InitiativeMember, now = Date.now()) => !m.leftAt || Date.parse(m.leftAt) > now;
export const hasStarted = (m: InitiativeMember, now = Date.now()) => Date.parse(m.joinedAt) <= now;
const LIVE_STATUSES = new Set(["approved", "active", "completed", "conditional"]);

/** A Team Allocation Ledger exists once a signed row has been checked by the PRC (§6.7, Annex D Part 3). */
export function ledgerExists(members: InitiativeMember[], initiativeId: string) {
  return members.some((m) => m.initiativeId === initiativeId && m.consent === "accepted" && m.prcApproved);
}

/**
 * §6.7 / §6.8 — before the ledger exists (proposal stage, or an ongoing project being set up under §15.1) the Role and
 * Weight Agreement is edited directly. Once a live project has a ledger, EVERY change — admission (whatever its start
 * date), removal, role / weight / allocation change — goes to the team as an amendment.
 */
export function requiresAmendment(ini: Pick<Initiative, "id" | "status">, members: InitiativeMember[]) {
  return LIVE_STATUSES.has(ini.status) && ledgerExists(members, ini.id);
}

/** Distinct people with a live, signed, PRC-checked ledger row — each has one vote (§6.8 step 2); a joining person does not vote on their own admission (step 4). */
export function currentVoters(members: InitiativeMember[], initiativeId: string, excludeUserId?: string, now = Date.now()) {
  return [...new Set(members.filter((m) => m.initiativeId === initiativeId && m.consent === "accepted" && m.prcApproved && isOpenRow(m, now)).map((m) => m.userId))].filter((u) => u !== excludeUserId);
}

/** Voters for an amendment (the joining person excluded). */
export const amendmentVoters = (a: Pick<TeamAmendment, "initiativeId" | "change">, members: InitiativeMember[], now = Date.now()) => currentVoters(members, a.initiativeId, a.change.kind === "add" ? a.change.userId : undefined, now);

/** Live vote count of an amendment against its current voters. */
export function amendmentCount(a: TeamAmendment, members: InitiativeMember[], now = Date.now()) {
  const voters = amendmentVoters(a, members, now);
  const vote = (u: string) => a.votes.find((v) => v.userId === u)?.vote;
  const yes = voters.filter((u) => vote(u) === "for").length;
  const no = voters.filter((u) => vote(u) === "against").length;
  return { voters, yes, no, n: voters.length, need: Math.floor(voters.length / 2) + 1, notVoted: Math.max(0, voters.length - yes - no) };
}

/** Only an amendment still open or tied can be decided by the PRC (guards a double application). */
export const prcCanDecide = (a: Pick<TeamAmendment, "status">) => a.status === "open" || a.status === "tied";

/** Project Lead rows open at `now` (excluding one row). */
export const openLeads = (members: InitiativeMember[], initiativeId: string, excludeId?: string, now = Date.now()) => members.filter((m) => m.initiativeId === initiativeId && m.id !== excludeId && m.consent !== "declined" && isOpenRow(m, now) && m.roles.includes("project_lead"));

/* ───────────────────────── candidate checks (§3, §7.1, §7.3) ───────────────────────── */

export const NON_LEAD_ROLES: ProjectRole[] = ["engineer", "secretary", "specialist"];

export interface CandidateCheck {
  blockers: string[];
  warnings: string[];
  probationary: boolean;
  leadership: boolean;
  nonLead: number;
  maxA: number;
  capacity: ReturnType<typeof capacityCheck>;
}

export interface TeamCtx {
  initiatives: Initiative[];
  members: InitiativeMember[];
  profiles: EmployeeProfile[];
}

const fmtDay = (iso: string) => new Date(Date.parse(iso) + WIB).toISOString().slice(0, 10);

/** May this person take these roles on this project? Blockers stop the change; warnings are shown. */
export function candidateCheck(userId: string, roles: ProjectRole[], allocationFactor: number, initiative: Pick<Initiative, "id" | "type" | "endDate">, ctx: TeamCtx, effectiveIso?: string): CandidateCheck {
  const profile = ctx.profiles.find((p) => p.userId === userId);
  const elig = participationEligibility(profile, effectiveIso);
  const leadership = roles.some((r) => ROLE_META[r].leadership);
  const capacity = capacityCheck(userId, initiative, roles, ctx.initiatives, ctx.members);
  const nonLead = concurrentNonLeadRoles(userId, ctx.initiatives, ctx.members, initiative.id);
  const maxA = maxAllocationFactor(profile);
  const blockers = [...elig.blockers];
  if (leadership && !capacity.ok)
    blockers.push(`Leadership capacity would reach ${capacity.after.toFixed(2)} of ${POLICY.leadershipCapacity.toFixed(1)} (${capacity.before.toFixed(2)} used + ${capacity.adds.toFixed(2)} for a Type ${initiative.type} lead role) — §7.3`);
  if (allocationFactor > maxA + 1e-9) blockers.push(`Part-time — allocation factor may not exceed ${maxA} (contracted hours ÷ full-time, §3.1)`);
  const warnings = elig.warnings.filter((w) => !w.startsWith("Probationary") && !w.startsWith("Part-time") && !w.startsWith("Fixed-term —"));
  if (profile?.employmentType === "fixed_term_contract" && profile.contractEndDate)
    warnings.push(
      Date.parse(profile.contractEndDate) < Date.parse(initiative.endDate)
        ? `Fixed-term contract ends ${fmtDay(profile.contractEndDate)}, before the contracted end — the ledger row must end then (§3.1)`
        : `Fixed-term (PKWT) until ${fmtDay(profile.contractEndDate)} — roles only for work periods within the contract (§3.1)`,
    );
  else if (profile?.employmentType === "fixed_term_contract") warnings.push("Fixed-term — record the contract end date (§3.1)");
  if (profile?.employmentType === "part_time") warnings.push(`Part-time — allocation factor capped at ${maxA} (§3.1)`);
  if (roles.some((r) => NON_LEAD_ROLES.includes(r)) && nonLead >= POLICY.maxConcurrentNonLeadRoles)
    warnings.push(`Already holds non-lead roles on ${nonLead} live project${nonLead === 1 ? "" : "s"} — a ${nonLead + 1}th needs line manager and PRC approval (max ${POLICY.maxConcurrentNonLeadRoles}, §7.1)`);
  return { blockers, warnings: [...new Set(warnings)], probationary: profile?.employmentType === "probationary", leadership, nonLead, maxA, capacity };
}

/** Nothing blocks the change and a probationer's Annex C acknowledgment is recorded (§11). */
export const canProceed = (check: CandidateCheck | null, annexCAck: boolean) => !!check && check.blockers.length === 0 && (!check.probationary || annexCAck);

/** Where an amendment would break the policy — the only grounds on which the PRC may block it (§6.8 step 5). */
export function amendmentIssues(a: Pick<TeamAmendment, "change" | "effectiveDate">, initiative: Pick<Initiative, "id" | "type" | "endDate">, ctx: TeamCtx) {
  const issues: string[] = [];
  const c = a.change;
  if (c.kind === "remove") {
    const m = ctx.members.find((x) => x.id === c.memberId);
    if (m?.roles.includes("project_lead") && !openLeads(ctx.members, initiative.id, m.id).length) issues.push("Leaves the project without a Project Lead (§6.1)");
    return issues;
  }
  const userId = c.kind === "add" ? c.userId : ctx.members.find((x) => x.id === c.memberId)?.userId ?? "";
  const others = ctx.members.filter((x) => !(c.kind === "change" && x.id === c.memberId));
  const check = candidateCheck(userId, c.roles, c.allocationFactor, initiative, { ...ctx, members: others }, a.effectiveDate);
  issues.push(...check.blockers);
  if (c.roles.some((r) => NON_LEAD_ROLES.includes(r)) && check.nonLead >= POLICY.maxConcurrentNonLeadRoles) issues.push(`More than ${POLICY.maxConcurrentNonLeadRoles} concurrent non-lead roles without line manager and PRC approval (§7.1)`);
  if (c.kind === "add" && !c.consent) issues.push("The joining member has not consented to their role, weight and allocation factor (§6.8 step 4)");
  if (c.kind === "add" && c.managerApproved === false) issues.push("No line manager agreement to the joining member's time (§3.1, §6.8 step 5)");
  if (!c.roles.length) issues.push("No role");
  return issues;
}

/* ───────────────────────── §6.7 non-standard weights ───────────────────────── */

export const OVERRIDE_MAX = 10;
export const OVERRIDE_REASON_MIN = 10;

/**
 * §6.7 — standard weights apply unless every initial member agrees in writing to different weights that reflect actual
 * responsibilities; the reason goes on the agreement. Amendments (§6.8) are agreed by the team vote instead, so they
 * need the reason but not the "every member signed" confirmation.
 */
export function overrideRule(input: { value: number | null; standard: number; reason: string; allSigned: boolean; viaAmendment?: boolean }) {
  const errors: string[] = [];
  if (input.value == null) return { errors, nonStandard: false };
  if (!Number.isFinite(input.value) || input.value <= 0 || input.value > OVERRIDE_MAX) errors.push(`Agreed weight must be above 0 and at most ${OVERRIDE_MAX}`);
  const nonStandard = Math.abs(input.value - input.standard) > 1e-9;
  if (nonStandard && input.reason.trim().length < OVERRIDE_REASON_MIN) errors.push(`Record the reason for the non-standard weight (at least ${OVERRIDE_REASON_MIN} characters, Annex D)`);
  if (nonStandard && !input.viaAmendment && !input.allSigned) errors.push("Every initial member must agree to the non-standard weight in writing (§6.7)");
  return { errors, nonStandard };
}

/** Standard combined weight of a set of roles (§6.1–6.3). */
export const standardWeight = (roles: ProjectRole[], specialistWeight: number | null) => memberWeight({ roles, specialistWeight, weightOverride: null });

/* ───────────────────────── Indonesian number input ───────────────────────── */

/**
 * Parse an amount typed in id-ID or en style: "1.500" → 1500 (dot + 3 digits = thousands), "1,5" → 1.5 (comma = decimal),
 * "1.500,75" → 1500.75, "1,500.75" → 1500.75, "Rp 2.000" → 2000. Returns NaN when it isn't a number; "" → 0.
 */
export function parseAmount(raw: string): number {
  const s = raw.replace(/rp/gi, "").replace(/[\s_]/g, "").trim();
  if (!s) return 0;
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  if (!/^[\d.,]+$/.test(body)) return Number.NaN;
  let normal: string;
  const lastDot = body.lastIndexOf(".");
  const lastComma = body.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    normal = lastComma > lastDot ? body.replace(/\./g, "").replace(",", ".") : body.replace(/,/g, "");
  } else if (lastComma >= 0) {
    if ((body.match(/,/g) ?? []).length > 1) return Number.NaN;
    normal = body.replace(",", ".");
  } else if (lastDot >= 0) {
    normal = /^\d{1,3}(\.\d{3})+$/.test(body) ? body.replace(/\./g, "") : body;
    if ((normal.match(/\./g) ?? []).length > 1) return Number.NaN;
  } else normal = body;
  const n = Number(normal);
  return Number.isFinite(n) ? (neg ? -n : n) : Number.NaN;
}

/** Show a millions value back in the field in id-ID style ("1.500,5"). */
export const formatMillionsInput = (millions: number) => (Number.isFinite(millions) ? new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(millions) : "");

/* ───────────────────────── §6.1 monthly status updates ───────────────────────── */

export const RAG_META: Record<Rag, { label: string; color: "green" | "yellow" | "red" }> = {
  green: { label: "On track", color: "green" },
  amber: { label: "At risk", color: "yellow" },
  red: { label: "Off track", color: "red" },
};

export const monthWib = (iso: string | number = Date.now()) => wibDay(iso).slice(0, 7);

export function latestUpdate(updates: ProjectUpdate[], initiativeId: string) {
  let best: ProjectUpdate | undefined;
  for (const u of updates) if (u.initiativeId === initiativeId && (!best || u.at > best.at)) best = u;
  return best;
}

/** §6.1 the Project Lead reports monthly — due when this month (WIB) has no update; overdue when the last one is > 35 days old. */
export function updateState(ini: Pick<Initiative, "id" | "status" | "startDate">, updates: ProjectUpdate[], now = Date.now()): { state: "ok" | "due" | "overdue" | "n/a"; days: number | null; latest?: ProjectUpdate } {
  if (!["approved", "active", "conditional"].includes(ini.status)) return { state: "n/a", days: null };
  const latest = latestUpdate(updates, ini.id);
  const days = latest ? Math.floor((now - Date.parse(latest.at)) / DAY) : null;
  const sinceStart = Math.floor((now - Date.parse(ini.startDate)) / DAY);
  if (latest && latest.month === monthWib(now)) return { state: "ok", days, latest };
  if ((days != null && days > 35) || (!latest && sinceStart > 35)) return { state: "overdue", days, latest };
  return { state: "due", days, latest };
}

/* ───────────────────────── §5.6 change orders and the §5.1 rate reset ───────────────────────── */

export const CO_STATUS_META: Record<ChangeOrder["status"], { label: string; color: "blue" | "yellow" | "cyan" | "green" | "red" }> = {
  draft: { label: "Draft", color: "blue" },
  submitted: { label: "Sent to client", color: "yellow" },
  client_signed: { label: "Client signed", color: "cyan" },
  approved: { label: "Approved", color: "green" },
  rejected: { label: "Rejected", color: "red" },
};

/** Next CO-NNN reference on a project. */
export function nextChangeOrderRef(cos: ChangeOrder[], initiativeId: string) {
  const max = cos.filter((c) => c.initiativeId === initiativeId).reduce((m, c) => Math.max(m, Number(c.ref.replace(/\D/g, "")) || 0), 0);
  return `CO-${String(max + 1).padStart(3, "0")}`;
}

/** Initiative figures with approved change orders added: revenue, direct costs (to "other") and the contracted end date. */
export function withChangeOrders(ini: Initiative, cos: ChangeOrder[]): Initiative {
  const approved = cos.filter((c) => c.initiativeId === ini.id && c.status === "approved");
  if (!approved.length) return ini;
  const price = approved.reduce((s, c) => s + c.priceDelta, 0);
  const cost = approved.reduce((s, c) => s + c.costDelta, 0);
  const days = approved.reduce((s, c) => s + c.scheduleDeltaDays, 0);
  return {
    ...ini,
    revenue: { expected: ini.revenue.expected + price, best: ini.revenue.best + price, worst: ini.revenue.worst + price },
    costs: { ...ini.costs, other: ini.costs.other + cost / (1 + ini.costs.contingencyPct / 100) },
    endDate: new Date(Date.parse(ini.endDate) + days * DAY).toISOString(),
  };
}

/**
 * §5.1 — if approved change orders or contract amendments move x by more than 10 %, the PRC resets the rate; the new
 * rate applies to revenue realised after the reset (bonuses already paid are not recalculated).
 */
export function changeOrderImpact(ini: Initiative, cos: ChangeOrder[], adjustments: CurveAdjustment[] = []) {
  const mine = cos.filter((c) => c.initiativeId === ini.id);
  const approved = mine.filter((c) => c.status === "approved");
  const base = proposalEconomics({ ...ini, lockedSharePct: null }, adjustments);
  const after = proposalEconomics({ ...withChangeOrders(ini, cos), lockedSharePct: null }, adjustments);
  const xBefore = base.rate.x;
  const xAfter = after.rate.x;
  const movePct = xBefore > 0 ? (xAfter - xBefore) / xBefore : xAfter > 0 ? 1 : 0;
  const lastReset = approved.reduce<string | null>((m, c) => (c.rateResetAt && (!m || c.rateResetAt > m) ? c.rateResetAt : m), null);
  const latestApproval = approved.reduce<string | null>((m, c) => (c.decidedAt && (!m || c.decidedAt > m) ? c.decidedAt : m), null);
  const resetNeeded = Math.abs(movePct) > POLICY.rate.resetOnChangePct && (!lastReset || (!!latestApproval && latestApproval > lastReset));
  return {
    approved,
    open: mine.filter((c) => c.status === "draft" || c.status === "submitted" || c.status === "client_signed"),
    priceDelta: approved.reduce((s, c) => s + c.priceDelta, 0),
    costDelta: approved.reduce((s, c) => s + c.costDelta, 0),
    scheduleDeltaDays: approved.reduce((s, c) => s + c.scheduleDeltaDays, 0),
    xBefore,
    xAfter,
    movePct,
    curveRateAfter: after.rate.rate,
    resetNeeded,
    lastReset,
  };
}

/* ───────────────────────── Annex F conflicts and §13.1 recusal ───────────────────────── */

/** Latest declaration of a person on a project. */
export function latestCoi(cois: CoiDeclaration[], initiativeId: string, userId: string) {
  let best: CoiDeclaration | undefined;
  for (const c of cois) if (c.initiativeId === initiativeId && c.userId === userId && (!best || c.signedAt > best.signedAt)) best = c;
  return best;
}

export const coiDeclaresConflict = (c: CoiDeclaration | undefined) => !!c && Object.values(c.answers).some((a) => a.yes);

/** §13.1 PRC members (the CEO chairs). */
export function prcMemberIds(profiles: EmployeeProfile[]) {
  return profiles.filter((p) => p.governanceRoles?.includes("prc") || p.governanceRoles?.includes("ceo")).map((p) => p.userId);
}

/** §13.1 a PRC member on the project's team, or with a declared conflict, does not take part in decisions on it. */
export function recusalReason(userId: string, ini: Pick<Initiative, "id" | "initiatorId">, members: InitiativeMember[], cois: CoiDeclaration[]) {
  if (ini.initiatorId === userId) return "Proposer / Project Initiator";
  const onTeam = members.some((m) => m.initiativeId === ini.id && m.userId === userId && m.consent !== "declined" && m.removal.stage !== "removed");
  if (onTeam) return "On the project team";
  if (coiDeclaresConflict(latestCoi(cois, ini.id, userId))) return "Declared a conflict of interest (Annex F)";
  return null;
}

/** Annex F gaps before approval: every proposed member declares (§12.2). */
export function coiGaps(ini: Pick<Initiative, "id">, members: InitiativeMember[], cois: CoiDeclaration[]) {
  const people = [...new Set(members.filter((m) => m.initiativeId === ini.id && m.consent !== "declined" && isOpenRow(m)).map((m) => m.userId))];
  return {
    missing: people.filter((u) => !latestCoi(cois, ini.id, u)),
    undecided: people.filter((u) => {
      const c = latestCoi(cois, ini.id, u);
      return coiDeclaresConflict(c) && !c?.prc;
    }),
  };
}
