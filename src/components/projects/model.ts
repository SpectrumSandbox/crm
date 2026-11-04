/*
 * Ongoing-projects register (Policy v4.0): who works on each project, in what role, at what weight, and what share of
 * revenue goes to them as compensation — computed from the policy formula (§5.1, §6.6) plus any recorded considerations.
 */
import type { User } from "@/lib/types";
import type { CurveAdjustment, EmployeeProfile, Initiative, InitiativeMember, RevenueEntry, TeamAmendment } from "@/lib/initiatives/types";
import {
  allocationFactorOf,
  approvalTier,
  concurrentNonLeadRoles,
  contractedMonths,
  effectiveWeight,
  leadershipLoad,
  maxAllocationFactor,
  memberWeight,
  participationEligibility,
  projectRate,
  proposalEconomics,
  projectPayments,
  standardBonusOf,
  type ProjectRate,
} from "@/lib/initiatives/engine";
import { POLICY, ROLE_META } from "@/lib/initiatives/policy";

export interface RegisterInputs {
  initiatives: Initiative[];
  members: InitiativeMember[];
  profiles: EmployeeProfile[];
  users: User[];
  entries: RevenueEntry[];
  adjustments: CurveAdjustment[];
  amendments: TeamAmendment[];
}

export interface RegisterRow {
  member: InitiativeMember;
  user: User | undefined;
  profile: EmployeeProfile | undefined;
  /** combined role weight W (§6.1–6.3) */
  W: number;
  /** allocation factor A (§6.4) */
  A: number;
  /** effective weight W × A */
  E: number;
  standardW: number;
  nonStandard: boolean;
  /** E ÷ ΣE — share of the bonus pool for a full work period */
  shareOfPool: number;
  /** share × y — the member's compensation as % of project net revenue */
  pctOfNet: number;
  /** % of project revenue (excl. VAT), using the expected case's net ÷ revenue */
  pctOfRevenue: number | null;
  /** expected-case bonus over the whole project */
  expectedBonus: number | null;
  /** Type C guaranteed minimum share per month (§8.6) */
  monthlyMinimum: number | null;
  eligibility: ReturnType<typeof participationEligibility>;
  leadUsed: number;
  nonLeadRoles: number;
  issues: string[];
}

export type ComplianceStatus = "ok" | "warn" | "fail";
export interface ComplianceItem {
  id: string;
  label: string;
  cite: string;
  status: ComplianceStatus;
  detail: string;
}

export interface ProjectRegister {
  ini: Initiative;
  rate: ProjectRate;
  econ: ReturnType<typeof proposalEconomics>;
  tier: ReturnType<typeof approvalTier>;
  months: number;
  rows: RegisterRow[];
  closedRows: InitiativeMember[];
  totalE: number;
  netToRevenue: number | null;
  teamPctOfRevenue: number | null;
  collected: { revenue: number; net: number; pool: number; payments: number };
  openAmendments: TeamAmendment[];
  compliance: ComplianceItem[];
  failing: number;
  warnings: number;
}

const isCurrent = (m: InitiativeMember, now: number) => m.consent !== "declined" && m.removal.stage !== "removed" && (!m.leftAt || Date.parse(m.leftAt) > now);
export const LIVE_PROJECT_STATUSES = ["approved", "conditional", "active"] as const;

export function buildRegister(ini: Initiative, inp: RegisterInputs, nowIso = new Date().toISOString()): ProjectRegister {
  const now = Date.parse(nowIso);
  const rate = projectRate(ini, inp.adjustments);
  const econ = proposalEconomics(ini, inp.adjustments);
  const tier = approvalTier(ini);
  const months = contractedMonths(ini);
  const all = inp.members.filter((m) => m.initiativeId === ini.id);
  const current = all.filter((m) => isCurrent(m, now));
  const closedRows = all.filter((m) => !isCurrent(m, now)).sort((a, b) => (b.leftAt ?? "").localeCompare(a.leftAt ?? ""));
  const totalE = current.reduce((s, m) => s + effectiveWeight(m), 0);
  const exp = econ.expected;
  const netToRevenue = exp.revenue > 0 ? exp.net / exp.revenue : null;
  const isC = ini.type === "C";
  const std = isC ? standardBonusOf(ini) : 0;

  const rows: RegisterRow[] = current.map((m) => {
    const profile = inp.profiles.find((p) => p.userId === m.userId);
    const user = inp.users.find((u) => u.id === m.userId);
    const W = memberWeight(m);
    const A = allocationFactorOf(m);
    const E = W * A;
    const standardW = memberWeight({ ...m, weightOverride: null });
    const shareOfPool = totalE > 0 ? E / totalE : 0;
    const pctOfNet = shareOfPool * rate.rate;
    const eligibility = participationEligibility(profile, nowIso);
    const leadUsed = leadershipLoad(m.userId, inp.initiatives, inp.members, { includePending: true }).used;
    const nonLeadRoles = concurrentNonLeadRoles(m.userId, inp.initiatives, inp.members);
    const issues: string[] = [];
    if (!eligibility.ok) issues.push(...eligibility.blockers);
    if (m.consent !== "accepted") issues.push("Role and Weight Agreement not signed (§6.7)");
    if (!m.managerApproved) issues.push("Line manager agreement to the time not recorded (§3.1)");
    if (m.weightOverride != null && !m.weightNote?.trim()) issues.push("Non-standard weight without a recorded reason (§6.7, Annex D)");
    if (A < 1 && !m.weightNote?.trim()) issues.push("Allocation factor below 1.0 without a note on the time committed (§6.4)");
    if (A > maxAllocationFactor(profile)) issues.push(`Allocation factor above the part-time cap of ${maxAllocationFactor(profile)} (§3.1)`);
    if (m.roles.includes("initiator") && ini.origination === "company") issues.push("Initiator weight on a company-channel opportunity (§4.1)");
    if (leadUsed > POLICY.leadershipCapacity + 1e-9 && m.roles.some((r) => ROLE_META[r].leadership)) issues.push(`Leadership capacity ${leadUsed.toFixed(2)} > 2.0 (§7.3)`);
    if (nonLeadRoles > POLICY.maxConcurrentNonLeadRoles) issues.push(`${nonLeadRoles} concurrent non-lead roles — more than 3 needs line manager and PRC approval (§7.1)`);
    if (!profile?.acknowledgmentSignedAt) issues.push("Annex B not signed — bonuses held until signed (§15.1)");
    return {
      member: m,
      user,
      profile,
      W,
      A,
      E,
      standardW,
      nonStandard: m.weightOverride != null && Math.abs(m.weightOverride - standardW) > 1e-9,
      shareOfPool,
      pctOfNet,
      pctOfRevenue: netToRevenue != null ? pctOfNet * netToRevenue : null,
      expectedBonus: exp.revenue > 0 ? Math.floor(exp.pool * shareOfPool) : null,
      monthlyMinimum: isC ? Math.floor(std * shareOfPool) : null,
      eligibility,
      leadUsed,
      nonLeadRoles,
      issues,
    };
  });
  rows.sort((a, b) => b.E - a.E || (a.user?.name ?? "").localeCompare(b.user?.name ?? ""));

  const pays = projectPayments(ini, inp.entries, inp.adjustments);
  const collected = { revenue: pays.reduce((s, p) => s + p.revenue, 0), net: pays.reduce((s, p) => s + p.net, 0), pool: pays.reduce((s, p) => s + p.pool, 0), payments: pays.length };
  const openAmendments = inp.amendments.filter((a) => a.initiativeId === ini.id && (a.status === "open" || a.status === "tied"));

  /* ── policy compliance checklist ── */
  const c: ComplianceItem[] = [];
  const add = (id: string, label: string, cite: string, status: ComplianceStatus, detail: string) => c.push({ id, label, cite, status, detail });
  const leads = rows.filter((r) => r.member.roles.includes("project_lead"));
  add("lead", "Project Lead assigned", "6.1", leads.length === 1 ? "ok" : leads.length > 1 ? "warn" : "fail", leads.length === 1 ? `${leads[0].user?.name ?? leads[0].member.userId}` : leads.length > 1 ? "More than one Project Lead — confirm the split" : "Every project needs a Project Lead");
  add("team", "Team registered with roles, weights and allocation factors", "6.5", rows.length ? "ok" : "fail", rows.length ? `${rows.length} member${rows.length === 1 ? "" : "s"} · ΣE ${totalE.toFixed(2)}` : "Add everyone working on the project — no work counts toward a bonus until the Role and Weight Agreement is in place (§6.7)");
  const unsigned = rows.filter((r) => r.member.consent !== "accepted");
  if (rows.length) add("rwa", "Role and Weight Agreement signed by every member", "6.7", unsigned.length ? "fail" : "ok", unsigned.length ? `Awaiting ${unsigned.map((r) => r.user?.name ?? r.member.userId).join(", ")}` : "All members signed (Annex D Part 1)");
  const noMgr = rows.filter((r) => !r.member.managerApproved);
  if (rows.length) add("manager", "Line manager agreement to the time", "3.1", noMgr.length ? "fail" : "ok", noMgr.length ? `Missing for ${noMgr.map((r) => r.user?.name ?? r.member.userId).join(", ")}` : "Recorded for every member");
  const inel = rows.filter((r) => !r.eligibility.ok);
  if (rows.length) add("eligible", "Every member eligible", "3", inel.length ? "fail" : "ok", inel.length ? inel.map((r) => `${r.user?.name ?? r.member.userId}: ${r.eligibility.blockers[0]}`).join(" · ") : "Permanent, fixed-term, part-time or probationary and in good standing");
  const noAnnexB = rows.filter((r) => !r.profile?.acknowledgmentSignedAt);
  if (rows.length) add("annexb", "Project Participation Agreement (Annex B) signed", "15.1", noAnnexB.length ? "warn" : "ok", noAnnexB.length ? `Bonuses held until signed: ${noAnnexB.map((r) => r.user?.name ?? r.member.userId).join(", ")}` : "Signed by every member");
  const cap = rows.filter((r) => r.leadUsed > POLICY.leadershipCapacity + 1e-9 && r.member.roles.some((x) => ROLE_META[x].leadership));
  const nl = rows.filter((r) => r.nonLeadRoles > POLICY.maxConcurrentNonLeadRoles);
  if (rows.length) add("capacity", "Leadership capacity ≤ 2.0 and ≤ 3 non-lead roles", "7.3", cap.length || nl.length ? "fail" : "ok", cap.length || nl.length ? [...cap.map((r) => `${r.user?.name}: capacity ${r.leadUsed.toFixed(2)}`), ...nl.map((r) => `${r.user?.name}: ${r.nonLeadRoles} non-lead roles`)].join(" · ") : "Within limits for everyone");
  const nonStd = rows.filter((r) => (r.nonStandard || r.A < 1) && !r.member.weightNote?.trim());
  add("weights", "Non-standard weights and allocation factors explained", "6.7", nonStd.length ? "fail" : "ok", nonStd.length ? `Record the reason for ${nonStd.map((r) => r.user?.name ?? r.member.userId).join(", ")}` : rows.some((r) => r.nonStandard || r.A < 1) ? "Reasons recorded" : "Standard weights");
  add("origination", "Origination recorded", "4.1", !ini.origination ? "fail" : ini.origination === "company" && rows.some((r) => r.member.roles.includes("initiator")) ? "fail" : "ok", !ini.origination ? "Personally originated, follow-on, or company channel (no Initiator weight)" : ini.origination === "company" ? "Company channel — no Initiator weight" : "Initiator weight 0.5 applies");
  add("projection", "Expected case entered — sets the revenue-share rate", "5.1", rate.source === "provisional" ? "fail" : "ok", rate.source === "provisional" ? "Enter expected revenue and direct costs; until then the rate shown is the top of the curve (40%)" : `x = Rp${Math.round(rate.x).toLocaleString("en-US")} over ${months} months → y = ${(rate.rate * 100).toFixed(3)}%`);
  add("rate", "Rate fixed by the PRC", "5.1", rate.source === "fixed" || rate.source === "v3_flat" ? "ok" : "warn", rate.source === "fixed" ? `Fixed at ${(rate.rate * 100).toFixed(3)}%${ini.shareNote ? ` — ${ini.shareNote}` : ""}` : rate.source === "v3_flat" ? "v3.0 flat share kept (§15.1)" : "Computed from the curve — the PRC fixes it in its approval decision");
  if (ini.lockedSharePct != null && rate.source === "fixed") {
    const curveRate = projectRate({ ...ini, lockedSharePct: null }, inp.adjustments);
    const off = curveRate.source === "curve" && Math.abs(curveRate.rate - ini.lockedSharePct) > 1e-6;
    if (off) add("rate-note", "Rate differs from the curve — reason recorded", "5.1", ini.shareNote?.trim() ? "ok" : "fail", ini.shareNote?.trim() ? ini.shareNote : `Curve gives ${(curveRate.rate * 100).toFixed(3)}% — record the PRC's reason`);
  }
  if (ini.type === "C") add("minimum", "Type C standard bonus set (≥ Rp1,000,000 a month)", "8.6", (ini.standardBonus ?? 0) >= POLICY.typeCMinimum.standardBonus ? "ok" : "fail", `Rp${standardBonusOf(ini).toLocaleString("en-US")} a month from the month work starts, shared by weight-days`);
  add("code", "PRC approval and project code", "4.5", ini.code ? "ok" : "fail", ini.code ? `${ini.code}${ini.approvedAt ? ` · approved ${ini.approvedAt.slice(0, 10)}` : ""}` : ini.registeredRetroactively ? "Ongoing project registered after it started — the PRC brings it under v4.0 with a project code (§15.1)" : "Approve through the PRC workflow");
  add("tier", `Approval tier ${tier.tier}`, "4.2", "ok", tier.reasons.join("; "));
  add("pmo", "Project opened in the project system", "4.5", ini.jiraProjectId || ini.epicId ? "ok" : "warn", ini.jiraProjectId || ini.epicId ? "Linked to Jira" : "Link a Jira project for delivery tracking");
  if (openAmendments.length) add("amend", "Team amendments awaiting a vote", "6.8", "warn", `${openAmendments.length} open — majority of current members decides; PRC breaks ties`);

  return {
    ini,
    rate,
    econ,
    tier,
    months,
    rows,
    closedRows,
    totalE,
    netToRevenue,
    teamPctOfRevenue: netToRevenue != null ? rate.rate * netToRevenue : null,
    collected,
    openAmendments,
    compliance: c,
    failing: c.filter((x) => x.status === "fail").length,
    warnings: c.filter((x) => x.status === "warn").length,
  };
}

export const pct = (v: number | null | undefined, digits = 2) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`);
export const rateLabel = (r: ProjectRate) => (r.source === "v3_flat" ? "v3.0 flat share (§15.1)" : r.source === "fixed" ? "Fixed by PRC" : r.source === "curve" ? "Curve · expected case" : "Provisional — no projection yet");
