/*
 * Alerts for the current user, derived from the store.
 *  Programme (Policy v4.0): PRC review queue with tier SLAs (§4.2, §4.5), Role and Weight Agreement sign requests
 *  (§6.7), §6.8 amendment votes, ties and ledger updates, appeals (§4.6), Annex B, §14 disputes, HR duties (§3.5,
 *  §11.5). Pay: the monthly break-even test and release (§8.2, §9.1), deferred bonuses (§9.3), clawback windows (§9.4),
 *  statements issued (§8.4), probation outcomes (§11.4), curve-change notices (§9.5), the §9.6 company summary.
 *  Sales & service: ticket SLAs, overdue tasks, deals past close date or stale, quotes awaiting approval.
 *  Delivery: issues assigned to me, due soon, blocked; monthly project status updates (§6.1, before the §8.2 cut-off).
 * Role checks use the HR record's governance roles (the same source as useAccess); amounts of other people's pay are
 * only ever shown to pay roles (§13.4).
 */
import { addBusinessDays, approvalTier, breakEvenDeadline, businessDaysBetween, cycleMonth, memberWeight, monthKey, nextMonth } from "@/lib/initiatives/engine";
import { POLICY, TIER_META } from "@/lib/initiatives/policy";
import type { BonusRun, ChangeOrder, Clawback, CloseOutReport, CoiDeclaration, CompanySummary, CurveAdjustment, DeferredBonus, Dispute, EmployeeProfile, Initiative, InitiativeMember, ProbationOutcome, ProjectUpdate, TeamAmendment } from "@/lib/initiatives/types";
import type { Activity, Company, Deal, Issue, IssueHistoryEntry, IssueLink, Pipeline, Product, Project, Quote, Ticket, User } from "@/lib/types";
import type { AccountPlan } from "@/lib/seed-ext/accounts";
import { DISPUTE_STAGE_META, decidingBody, disputeSla, outcomeLabel, pendingCorrection } from "@/lib/slices/program-extras";
import { openBlockersOf } from "@/lib/slices/agile-extras";
import { changeOrderImpact, coiGaps, updateState } from "@/lib/initiatives/team-rules";
import { ticketSla } from "@/lib/selectors";
import { dealActivityIndex, idleDays, isRotting, nextStepOf, rottingThreshold } from "@/components/crm/deal-signals";
import { approvalNeeds, isQuoteExpired, quoteTotals, settingsOf } from "@/components/crm/quote-math";
import { dueState, inTriage } from "@/components/agile/agile-ui";
import { reviewOverdue } from "@/app/(workspace)/companies/account-utils";
import { formatDate, formatIDR } from "@/lib/utils";
import { annexBState, canVote, cycleLabel, describeAmendment, rolesLabel, voteDeadline } from "./helpers";

export type AlertKind =
  | "prc_review"
  | "sla"
  | "consent"
  | "vote"
  | "tie"
  | "break_even"
  | "release"
  | "vesting"
  | "clawback"
  | "appeal"
  | "annex_b"
  | "ticket_sla"
  | "task_due"
  | "deal_overdue"
  | "deal_stale"
  | "quote_approval"
  | "issue_assigned"
  | "issue_due"
  | "issue_blocked"
  | "status_update"
  | "amendment_record"
  | "hr"
  | "statement"
  | "probation"
  | "curve"
  | "company_summary"
  | "dispute"
  | "quote_expiry"
  | "account_plan"
  | "issue_triage"
  | "coi"
  | "rate_reset"
  | "close_out"
  | "proposal_return";
export type AlertTone = "red" | "orange" | "yellow" | "cyan" | "green" | "blue";
export type AlertCategory = "sales" | "delivery" | "programme" | "pay";

export const ALERT_CATEGORY: Record<AlertKind, AlertCategory> = {
  prc_review: "programme",
  sla: "programme",
  consent: "programme",
  vote: "programme",
  tie: "programme",
  appeal: "programme",
  annex_b: "programme",
  hr: "programme",
  dispute: "programme",
  coi: "programme",
  rate_reset: "programme",
  proposal_return: "programme",
  close_out: "pay",
  status_update: "delivery",
  issue_triage: "delivery",
  quote_expiry: "sales",
  account_plan: "sales",
  amendment_record: "delivery",
  issue_assigned: "delivery",
  issue_due: "delivery",
  issue_blocked: "delivery",
  ticket_sla: "sales",
  task_due: "sales",
  deal_overdue: "sales",
  deal_stale: "sales",
  quote_approval: "sales",
  break_even: "pay",
  release: "pay",
  vesting: "pay",
  clawback: "pay",
  statement: "pay",
  probation: "pay",
  curve: "pay",
  company_summary: "pay",
};
export const CATEGORY_LABEL: Record<AlertCategory, string> = { sales: "Sales & service", delivery: "Delivery", programme: "Programme", pay: "Pay" };

export interface Alert {
  /** stable key — changes when the alert's state changes, so it shows as unread again */
  id: string;
  kind: AlertKind;
  tone: AlertTone;
  title: string;
  detail: string;
  href: string;
  /** due date or event date */
  at: string | null;
  cite: string;
  action?: { type: "consent"; memberId: string } | { type: "vote"; amendmentId: string };
}

export interface AlertInputs {
  userId: string;
  users: User[];
  profiles: EmployeeProfile[];
  initiatives: Initiative[];
  members: InitiativeMember[];
  amendments: TeamAmendment[];
  runs: BonusRun[];
  deferred: DeferredBonus[];
  clawbacks: Clawback[];
  /* optional sources — alerts of a kind are skipped when its source is not passed */
  outcomes?: ProbationOutcome[];
  curveAdjustments?: CurveAdjustment[];
  summaries?: CompanySummary[];
  disputes?: Dispute[];
  projectUpdates?: ProjectUpdate[];
  tickets?: Ticket[];
  activities?: Activity[];
  deals?: Deal[];
  pipelines?: Pipeline[];
  quotes?: Quote[];
  issues?: Issue[];
  issueLinks?: IssueLink[];
  issueHistory?: IssueHistoryEntry[];
  projects?: Project[];
  changeOrders?: ChangeOrder[];
  closeOutReports?: CloseOutReport[];
  coiDeclarations?: CoiDeclaration[];
  accountPlans?: AccountPlan[];
  quoteSettings?: Parameters<typeof settingsOf>[0];
  products?: Product[];
  companies?: Company[];
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const wibDate = (t: number) => new Date(t + 7 * HOUR).toISOString().slice(0, 10);
const WIB = 7 * 3_600_000;
const wibDay = (t: number) => Number(new Date(t + WIB).toISOString().slice(8, 10));
const TONE_RANK: Record<AlertTone, number> = { red: 0, orange: 1, yellow: 2, cyan: 3, blue: 4, green: 5 };

export function deriveAlerts(inp: AlertInputs, now = Date.now()): Alert[] {
  const { userId, users, profiles, initiatives, members, amendments, runs, deferred, clawbacks } = inp;
  const me = profiles.find((p) => p.userId === userId);
  const roles = new Set(me?.governanceRoles ?? []);
  const nowIso = new Date(now).toISOString();
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? id;
  const ini = (id: string) => initiatives.find((i) => i.id === id);
  const label = (i: Initiative | undefined) => (i ? `${i.code ?? i.trackingNo ?? ""}${i.code || i.trackingNo ? " · " : ""}${i.title}` : "Project");
  const out: Alert[] = [];

  /* §4.2 / §4.5 proposals awaiting PRC action, with the tier decision limit (recused if on the team, §13.1) */
  if (roles.has("prc")) {
    for (const i of initiatives) {
      if (!["submitted", "screening", "evaluation"].includes(i.status) || !i.submittedAt) continue;
      if (members.some((m) => m.initiativeId === i.id && m.userId === userId && m.consent !== "declined")) continue;
      const tier = approvalTier(i).tier;
      const limit = TIER_META[tier].decisionBusinessDays;
      const elapsed = businessDaysBetween(i.submittedAt, nowIso);
      const due = addBusinessDays(i.submittedAt, limit);
      if (i.status === "submitted" && !i.acknowledgedAt) {
        const ackDue = addBusinessDays(i.submittedAt, POLICY.sla.acknowledgeBusinessDays);
        const late = Date.parse(ackDue) < now;
        out.push({
          id: `prc:${i.id}:ack:${late ? "late" : "ok"}`,
          kind: late ? "sla" : "prc_review",
          tone: late ? "red" : "orange",
          title: late ? `Acknowledgement overdue — ${i.title}` : `New proposal to acknowledge — ${i.title}`,
          detail: `${TIER_META[tier].label} · PMO acknowledges within 1 business day and checks completeness within 2; decision due ${formatDate(due, "medium")}`,
          href: `/initiatives/${i.id}`,
          at: ackDue,
          cite: "4.5",
        });
        continue;
      }
      const breach = elapsed > limit;
      out.push({
        id: `prc:${i.id}:${i.status}:${breach ? "breach" : "ok"}`,
        kind: breach ? "sla" : "prc_review",
        tone: breach ? "red" : elapsed >= limit - 1 ? "orange" : "yellow",
        title: breach ? `Decision overdue — ${i.title}` : `Awaiting PRC ${i.status === "evaluation" ? "decision" : "review"} — ${i.title}`,
        detail: `${TIER_META[tier].label}: ${TIER_META[tier].decides.toLowerCase()} decide within ${limit} business days · ${elapsed} elapsed · due ${formatDate(due, "medium")}`,
        href: `/initiatives/${i.id}`,
        at: due,
        cite: "4.2",
      });
    }
  }

  /* §6.7 Role and Weight Agreement — rows waiting for my signature */
  for (const m of members) {
    if (m.userId !== userId || m.consent !== "pending" || m.removal.stage === "removed") continue;
    const i = ini(m.initiativeId);
    if (!i || ["rejected", "completed"].includes(i.status)) continue;
    const w = memberWeight(m);
    out.push({
      id: `consent:${m.id}`,
      kind: "consent",
      tone: "orange",
      title: `Sign the Role and Weight Agreement — ${i.title}`,
      detail: `${rolesLabel(m.roles)} · weight ${w} × allocation ${m.allocationFactor ?? 1}${m.application ? " · joining by amendment — you consent to your role, weight and allocation (§6.8)" : ""}`,
      href: `/initiatives/${i.id}`,
      at: m.joinedAt,
      cite: "6.7",
      action: { type: "consent", memberId: m.id },
    });
  }

  /* §6.8 open amendments where I am a current member and have not voted */
  for (const a of amendments) {
    if (a.status !== "open" || !canVote(a, members, userId, now) || a.votes.some((v) => v.userId === userId)) continue;
    const i = ini(a.initiativeId);
    const due = voteDeadline(a);
    out.push({
      id: `vote:${a.id}`,
      kind: "vote",
      tone: Date.parse(due) < now ? "red" : businessDaysBetween(nowIso, due) <= 1 ? "orange" : "yellow",
      title: `${businessDaysBetween(nowIso, due) <= 1 && Date.parse(due) >= now ? "Vote closes soon" : "Vote on a team amendment"} — ${i?.title ?? "project"}`,
      detail: `${describeAmendment(a, users, members)} · from ${formatDate(a.effectiveDate, "medium")} · proposed by ${name(a.proposedById)} · vote by ${formatDate(due, "medium")}`,
      href: `/initiatives/${a.initiativeId}`,
      at: due,
      cite: "6.8",
      action: { type: "vote", amendmentId: a.id },
    });
  }

  /* §6.8 step 3 tied amendments — the PRC casts the deciding vote within 5 business days */
  if (roles.has("prc")) {
    for (const a of amendments) {
      if (a.status !== "tied" || a.prcDecision) continue;
      const lastVote = a.votes.map((v) => v.at).sort().pop() ?? a.circulatedAt;
      const due = addBusinessDays(lastVote, POLICY.sla.prcTieBusinessDays);
      out.push({
        id: `tie:${a.id}`,
        kind: "tie",
        tone: Date.parse(due) < now ? "red" : "orange",
        title: `Tied amendment needs the PRC's deciding vote — ${ini(a.initiativeId)?.title ?? "project"}`,
        detail: `${describeAmendment(a, users, members)} · decide by ${formatDate(due, "medium")}`,
        href: `/initiatives/${a.initiativeId}`,
        at: due,
        cite: "6.8",
      });
    }
  }

  /* §8.2 / §9.1 break-even test and cash check, certified by the 23rd — raised for every decided salary cycle up to
     the current one that has no certified or released run, so an uncertified month never silently drops out */
  if (roles.has("cfo") || roles.has("finance")) {
    const open = cycleMonth(nowIso); // collections from the 21st belong to the next cycle
    const known = [...runs.map((r) => r.month), ...(inp.summaries ?? []).map((x) => x.month)].sort();
    const first = known[0] ?? monthKey(now);
    const floor = nextMonth(monthKey(now), -6);
    for (let m = first < floor ? floor : first; m < open || (m === monthKey(now) && wibDay(now) >= POLICY.cycle.cutoffDay); m = nextMonth(m)) {
      if (m > monthKey(now)) break;
      const run = runs.find((r) => r.month === m);
      if (run && (run.status === "certified" || run.status === "released")) continue;
      const deadline = breakEvenDeadline(m);
      const late = Date.parse(deadline) < now;
      out.push({
        id: `breakeven:${m}:${late ? "late" : "due"}:${run?.status ?? "none"}`,
        kind: "break_even",
        tone: late ? "red" : "orange",
        title: late ? `Break-even test overdue for ${cycleLabel(m)}` : `Certify the break-even test and cash check for ${cycleLabel(m)}`,
        detail: `${run ? (run.status === "failed" ? "A failed run is recorded — PRC applies §9.2 pro rata" : "Draft run recorded") : "No run recorded yet"} · CFO certifies by the 23rd using the latest three closed months; salary date ${formatDate(`${m}-${POLICY.cycle.salaryDay}T09:00:00+07:00`, "medium")}`,
        href: `/compensation?month=${m}`,
        at: deadline,
        cite: "9.1",
      });
    }
  }

  /* §8.2 certified runs awaiting PRC release */
  if (roles.has("prc")) {
    for (const r of runs) {
      if (r.status !== "certified") continue;
      out.push({
        id: `release:${r.id}`,
        kind: "release",
        tone: "cyan",
        title: `Release ${r.month} bonuses — certified by the CFO`,
        detail: `${formatIDR(r.totals.payable, "full")} payable${r.payoutPct < 1 ? ` · ${Math.round(r.payoutPct * 10_000) / 100}% pro rata, rest carried forward (§9.2)` : ""} · paid with the ${POLICY.cycle.salaryDay}th salary`,
        href: `/compensation?month=${r.month}`,
        at: r.certifiedAt,
        cite: "8.2",
      });
    }
  }

  /* §9.3 deferred bonuses vesting within 30 days */
  if (roles.has("finance") || roles.has("cfo")) {
    const soon = deferred.filter((d) => d.status === "pending" && Date.parse(d.vestAt) <= now + 30 * DAY).sort((a, b) => a.vestAt.localeCompare(b.vestAt));
    if (soon.length) {
      const due = soon.filter((d) => Date.parse(d.vestAt) <= now);
      const total = soon.reduce((s, d) => s + d.amount, 0);
      out.push({
        id: `vesting:${soon.map((d) => d.id).join(",")}:${due.length}`,
        kind: "vesting",
        tone: due.length ? "orange" : "cyan",
        title: `${soon.length} deferred bonus${soon.length === 1 ? "" : "es"} vest${soon.length === 1 ? "s" : ""} within 30 days`,
        detail: `${formatIDR(total, "full")} · earliest ${formatDate(soon[0].vestAt, "medium")}${due.length ? ` · ${due.length} already due — pay in the next cycle, subject to §10` : ""}`,
        href: "/compensation?tab=deferred",
        at: soon[0].vestAt,
        cite: "9.3",
      });
    }
  }

  /* §9.4 step 4 — 10 business days to dispute a clawback */
  for (const c of clawbacks) {
    if (!c.notifiedAt || !["identified", "prc_approved"].includes(c.status)) continue;
    const deadline = addBusinessDays(c.notifiedAt, POLICY.clawback.disputeBusinessDays);
    if (Date.parse(deadline) < now) continue;
    const left = businessDaysBetween(nowIso, deadline);
    if (c.userId === userId) {
      out.push({
        id: `claw:${c.id}:me`,
        kind: "clawback",
        tone: left <= 3 ? "red" : "orange",
        title: `Clawback notice — dispute window closes ${formatDate(deadline, "medium")}`,
        detail: `${ini(c.initiativeId)?.title ?? "Project"} · ${left} business day${left === 1 ? "" : "s"} left to dispute the figures or raise mitigating factors; salary deductions need your written agreement`,
        href: "/me#clawbacks",
        at: deadline,
        cite: "9.4",
      });
    } else if ((roles.has("finance") || roles.has("cfo")) && left <= 3) {
      out.push({
        id: `claw:${c.id}:finance`,
        kind: "clawback",
        tone: "yellow",
        title: `Clawback dispute window closing — ${name(c.userId)}`,
        detail: `${ini(c.initiativeId)?.title ?? "Project"} · closes ${formatDate(deadline, "medium")} (${left} business day${left === 1 ? "" : "s"})`,
        href: "/compensation?tab=clawbacks",
        at: deadline,
        cite: "9.4",
      });
    }
  }

  /* §4.6 appeals — the Executive Committee decides within 10 business days */
  if (roles.has("executive_committee")) {
    for (const i of initiatives) {
      if (i.appeal?.status !== "pending") continue;
      const due = addBusinessDays(i.appeal.filedAt, POLICY.sla.appealBusinessDays);
      out.push({
        id: `appeal:${i.id}:${Date.parse(due) < now ? "late" : "open"}`,
        kind: "appeal",
        tone: Date.parse(due) < now ? "red" : "orange",
        title: `Appeal awaiting the Executive Committee — ${i.title}`,
        detail: `Filed by ${name(i.appeal.filedById)} ${formatDate(i.appeal.filedAt, "medium")} · decide by ${formatDate(due, "medium")}; the decision is final within the company`,
        href: `/initiatives/${i.id}`,
        at: due,
        cite: "4.6",
      });
    }
  }

  /* §3.1 / §15.1 Annex B */
  const annex = annexBState(me);
  if (annex === "missing")
    out.push({
      id: "annexb:missing",
      kind: "annex_b",
      tone: "red",
      title: "Sign the Project Participation Agreement (Annex B)",
      detail: `Required to join a project, and bonuses are held until it is signed${me?.employmentType === "probationary" ? " · probationers also sign Annex C" : ""}`,
      href: "/me#annex-b",
      at: null,
      cite: "3.1",
    });
  else if (annex === "stale")
    out.push({
      id: `annexb:stale:${me?.acknowledgmentSignedAt}`,
      kind: "annex_b",
      tone: "yellow",
      title: "Sign the updated v4.0 Project Participation Agreement",
      detail: `Your Annex B was signed ${formatDate(me?.acknowledgmentSignedAt, "medium")}, before v4.0 — sign the updated agreement before the first payment under v4.0`,
      href: "/me#annex-b",
      at: null,
      cite: "15.1",
    });

  /* ───────── §14 disputes ───────── */
  for (const d of inp.disputes ?? []) {
    const sla = disputeSla(d, now);
    const late = !!sla?.overdue;
    const soon = !!sla && !sla.overdue && sla.days <= 2;
    const stageLabel = DISPUTE_STAGE_META[d.stage].label;
    const base = { kind: "dispute" as const, href: `/disputes/${d.id}`, cite: "14" };
    if (d.stage === "direct" && d.handlerId === userId && !d.proposal) {
      out.push({ ...base, id: `dsp:${d.id}:handle:${late ? "late" : soon ? "soon" : "ok"}`, tone: late ? "red" : soon ? "orange" : "yellow", title: `${late ? "Dispute overdue" : "Dispute to resolve"} — ${d.subject}`, detail: `${d.number} raised by ${name(d.raisedById)} · settle directly within 10 business days, by ${formatDate(d.dueAt, "medium")}`, at: d.dueAt });
    }
    if (d.raisedById === userId && d.stage === "direct" && d.proposal) {
      out.push({ ...base, id: `dsp:${d.id}:proposal:${d.proposal.at}`, tone: "orange", title: `Respond to the proposed resolution — ${d.subject}`, detail: `${name(d.proposal.byId)} proposes: ${d.proposal.text.slice(0, 120)} · accept it or escalate to the PRC`, at: d.proposal.at });
    }
    if (d.raisedById === userId && d.stage === "direct" && !d.proposal && late) {
      out.push({ ...base, id: `dsp:${d.id}:unsettled`, tone: "orange", title: `Not settled in 10 business days — ${d.subject}`, detail: `${d.number} · you may escalate it to the PRC (§14 step 3)`, at: d.dueAt });
    }
    if (d.stage === "prc" || d.stage === "exco") {
      const body = decidingBody(d, d.stage, profiles);
      if (body.eligible.includes(userId) && !d.votes.some((v) => v.stage === d.stage && v.userId === userId))
        out.push({ ...base, id: `dsp:${d.id}:${d.stage}:${late ? "late" : soon ? "soon" : "ok"}`, tone: late ? "red" : soon ? "orange" : "yellow", title: `Dispute awaiting the ${d.stage === "prc" ? "PRC" : "Executive Committee"} — ${d.subject}`, detail: `${d.number} · ${stageLabel} due ${formatDate(d.dueAt, "medium")}${body.recused.length ? ` · ${body.recused.length} recused` : ""}`, at: d.dueAt });
    }
    const corr = pendingCorrection(d, runs, now);
    if ((roles.has("finance") || roles.has("cfo")) && corr)
      out.push({ ...base, id: `dsp:${d.id}:correction`, tone: "cyan", title: `Pay a dispute correction with the ${cycleLabel(corr.cycle)} salary`, detail: `${d.number} · ${name(d.raisedById)} · ${formatIDR(corr.amount, "full")}${corr.recorded ? "" : " · from an accepted direct settlement"} (§8.5)`, at: null, cite: "8.5" });
    if (d.raisedById === userId && d.closedAt && now - Date.parse(d.closedAt) < 14 * DAY && d.outcome !== "withdrawn") {
      const appeal = d.prcDecision && !d.excoDecision && Date.parse(d.prcDecision.appealBy) >= now;
      out.push({ ...base, id: `dsp:${d.id}:closed:${d.closedAt}`, tone: appeal ? "yellow" : "green", title: `Decision on your dispute — ${d.subject}`, detail: `${outcomeLabel(d)}${appeal && d.prcDecision ? ` · you may appeal to the Executive Committee by ${formatDate(d.prcDecision.appealBy, "medium")}` : ""}`, at: d.closedAt });
    }
  }

  /* ───────── HR duties (§3.2, §3.5, §11.5, §15.1) ───────── */
  if (roles.has("hr")) {
    for (const p of profiles) {
      const who = name(p.userId);
      if (p.employmentType === "probationary" && p.probationEndDate && !(inp.outcomes ?? []).some((o) => o.userId === p.userId)) {
        const left = Math.ceil((Date.parse(p.probationEndDate) - now) / DAY);
        if (left <= 14)
          out.push({ id: `hr:probation:${p.userId}:${left < 0 ? "over" : "soon"}`, kind: "hr", tone: left < 0 ? "red" : "orange", title: left < 0 ? `Probation ended without an outcome — ${who}` : `Probation ends in ${left} day${left === 1 ? "" : "s"} — ${who}`, detail: `End date ${formatDate(p.probationEndDate, "medium")} · record confirmation or the outcome; the Probation Completion Bonus is paid within ${POLICY.probationPayoutDays} days (§11.4, §11.5)`, href: "/compensation?tab=probation", at: p.probationEndDate, cite: "11.5" });
      }
      if (p.employmentType === "fixed_term_contract" && p.contractEndDate && !p.separation) {
        const left = Math.ceil((Date.parse(p.contractEndDate) - now) / DAY);
        if (left <= 30 && left >= -7)
          out.push({ id: `hr:contract:${p.userId}:${p.contractEndDate}`, kind: "hr", tone: left < 0 ? "red" : "yellow", title: `Fixed-term contract ${left < 0 ? "ended" : `ends in ${left} days`} — ${who}`, detail: `${formatDate(p.contractEndDate, "medium")} · renew, or record the contract end so roles and bonuses follow §10`, href: "/people", at: p.contractEndDate, cite: "10" });
      }
      if (p.unpaidLeaveDays > POLICY.unpaidLeaveMaxDays)
        out.push({ id: `hr:leave:${p.userId}:${p.unpaidLeaveDays > 60 ? 60 : 30}`, kind: "hr", tone: "orange", title: `Unpaid leave over ${POLICY.unpaidLeaveMaxDays} days — ${who}`, detail: `${p.unpaidLeaveDays} consecutive days · no new roles, bonuses held until the return (§3.2)`, href: "/people", at: null, cite: "3.2" });
    }
    const unsigned = profiles.filter((p) => !p.separation && ["missing", "stale"].includes(annexBState(p)) && members.some((m) => m.userId === p.userId && !m.leftAt && m.consent !== "declined"));
    if (unsigned.length)
      out.push({ id: `hr:annexb:${unsigned.map((p) => p.userId).join(",")}`, kind: "hr", tone: "yellow", title: `${unsigned.length} project participant${unsigned.length === 1 ? " has" : "s have"} no current Annex B`, detail: `${unsigned.slice(0, 4).map((p) => name(p.userId)).join(", ")}${unsigned.length > 4 ? ` +${unsigned.length - 4}` : ""} · bonuses are held until the v4.0 agreement is signed (§15.1)`, href: "/people", at: null, cite: "15.1" });
  }

  /* ───────── my pay events (§8.4, §9.3, §9.5, §9.6, §11.4) ───────── */
  for (const r of runs) {
    if (r.status !== "released" || !r.releasedAt || now - Date.parse(r.releasedAt) > 35 * DAY) continue;
    const mine = r.lines.filter((l) => l.userId === userId);
    if (!mine.length) continue;
    const pay = mine.reduce((s, l) => s + l.payable, 0);
    out.push({ id: `stmt:${r.id}`, kind: "statement", tone: "green", title: `Your ${cycleLabel(r.month)} bonus statement is issued`, detail: `${mine.length} project${mine.length === 1 ? "" : "s"} · ${formatIDR(pay, "full")} payable with the salary · check it and raise any error within ${POLICY.statementDisputeDays} days (§14)`, href: "/me#statements", at: r.releasedAt, cite: "8.4" });
  }
  const myVesting = deferred.filter((d) => d.userId === userId && d.status === "pending" && Date.parse(d.vestAt) <= now + 30 * DAY);
  if (myVesting.length)
    out.push({ id: `myvest:${myVesting.map((d) => d.id).join(",")}`, kind: "vesting", tone: "cyan", title: `${myVesting.length} of your deferred bonuses vest${myVesting.length === 1 ? "s" : ""} soon`, detail: `${formatIDR(myVesting.reduce((s, d) => s + d.amount, 0), "full")} · earliest ${formatDate(myVesting.map((d) => d.vestAt).sort()[0], "medium")} · paid in the next cycle, subject to §10`, href: "/me", at: myVesting.map((d) => d.vestAt).sort()[0], cite: "9.3" });
  for (const o of inp.outcomes ?? []) {
    if (o.userId !== userId || now - Date.parse(o.decidedAt) > 30 * DAY) continue;
    out.push({ id: `prob:${o.userId}:${o.decidedAt}`, kind: "probation", tone: o.outcome === "forfeited" ? "red" : "green", title: o.outcome === "completed" ? "Probation passed — Probation Completion Bonus" : o.outcome === "paid_final_pay" ? "Probation balance paid with final pay" : "Probation balance forfeited", detail: `${formatIDR(o.amount, "full")} · ${o.outcome === "completed" ? `paid within ${POLICY.probationPayoutDays} days of the end date` : "see §11.4"}`, href: "/me", at: o.decidedAt, cite: "11.4" });
  }
  if (me && me.employmentType === "probationary" && me.probationEndDate) {
    const left = Math.ceil((Date.parse(me.probationEndDate) - now) / DAY);
    if (left >= 0 && left <= 14) out.push({ id: `myprob:${me.probationEndDate}`, kind: "probation", tone: "blue", title: `Your probation ends in ${left} day${left === 1 ? "" : "s"}`, detail: `${formatDate(me.probationEndDate, "medium")} · if confirmed, your held balance is paid as a Probation Completion Bonus within ${POLICY.probationPayoutDays} days (§11.4)`, href: "/me", at: me.probationEndDate, cite: "11.4" });
  }
  for (const c of inp.curveAdjustments ?? []) {
    if (Date.parse(c.effectiveFrom) < now - 7 * DAY) continue;
    out.push({ id: `curve:${c.id}`, kind: "curve", tone: "yellow", title: `Revenue-share curve changes on ${formatDate(c.effectiveFrom, "medium")}`, detail: `${Math.round(c.from.start * 100)}% → ${Math.round(c.to.start * 100)}% start, floor ${Math.round(c.to.floor * 100)}% · applies only to projects approved after that date, with at least ${POLICY.curveNoticeDays} days' notice (§9.5)`, href: "/policy#s-9-5", at: c.effectiveFrom, cite: "9.5" });
  }
  const latestSummary = [...(inp.summaries ?? [])].sort((a, b) => b.month.localeCompare(a.month))[0];
  if (latestSummary && now - Date.parse(latestSummary.publishedAt) < 14 * DAY)
    out.push({ id: `csum:${latestSummary.id}:${latestSummary.publishedAt}`, kind: "company_summary", tone: "blue", title: `Company results for ${cycleLabel(latestSummary.month)}`, detail: `Revenue ${formatIDR(latestSummary.companyRevenue)} · ${latestSummary.breakEvenPassed ? "break-even test passed" : `checks failed — ${Math.round(latestSummary.payoutPct * 100)}% released`} (§9.6)`, href: "/me/company", at: latestSummary.publishedAt, cite: "9.6" });

  /* ───────── governance: §6.1 status updates, Annex F, §5.1 rate resets, §8.3 close-out, §4.5 returns, §6.8 ledger ───────── */
  if (inp.projectUpdates) {
    const month = monthKey(now);
    const cutoff = `${month}-${String(POLICY.cycle.cutoffDay).padStart(2, "0")}T17:00:00+07:00`;
    // due 3 business days before the 20th collection cut-off, so the update lands before Finance runs the cycle (§8.2)
    let due = new Date(cutoff);
    for (let n = 0; n < 3; ) {
      due = new Date(due.getTime() - DAY);
      const wd = new Date(due.getTime() + WIB).getUTCDay();
      if (wd !== 0 && wd !== 6) n++;
    }
    const dueIso = due.toISOString();
    const showFrom = Date.parse(dueIso) - 5 * DAY;
    const missing: Initiative[] = [];
    for (const i of initiatives) {
      // one rule with the register (team-rules.updateState): due when this month has no update, overdue after 35 days
      const st = updateState(i, inp.projectUpdates, now);
      if (st.state !== "due" && st.state !== "overdue") continue;
      if (st.state === "due" && now < showFrom) continue;
      missing.push(i);
      const leads = members.filter((m) => m.initiativeId === i.id && m.roles.includes("project_lead") && !m.leftAt && m.consent !== "declined").map((m) => m.userId);
      if (!leads.includes(userId)) continue;
      const late = st.state === "overdue" || now > Date.parse(dueIso);
      const pastCut = now > Date.parse(cutoff);
      out.push({
        id: `upd:${i.id}:${month}:${st.state === "overdue" ? "overdue" : pastCut ? "cut" : late ? "late" : "due"}`,
        kind: "status_update",
        tone: st.state === "overdue" || pastCut ? "red" : late ? "orange" : "yellow",
        title: `${late ? "Status update overdue" : "Monthly status update due"} — ${i.title}`,
        detail: `${cycleLabel(month)} update with RAG health${st.days != null ? ` · last one ${st.days} days ago` : " · none yet"} · due ${formatDate(dueIso, "medium")}, before the ${POLICY.cycle.cutoffDay}th cut-off (§6.1, §8.2)`,
        href: `/projects/${i.id}`,
        at: dueIso,
        cite: "6.1",
      });
    }
    if (roles.has("prc") && missing.length && now > Date.parse(dueIso))
      out.push({ id: `upd:digest:${month}:${missing.map((i) => i.id).join(",")}`, kind: "status_update", tone: "yellow", title: `${missing.length} project${missing.length === 1 ? "" : "s"} without a ${cycleLabel(month)} status update`, detail: `${missing.slice(0, 4).map((i) => i.code ?? i.title).join(", ")}${missing.length > 4 ? ` +${missing.length - 4}` : ""} · PMO digest (§6.1)`, href: "/projects", at: dueIso, cite: "6.1" });
  }

  /* Annex F (§12.2): declarations before approval; the PRC decides declared conflicts */
  if (inp.coiDeclarations) {
    for (const i of initiatives) {
      if (!["draft", "submitted", "screening", "evaluation", "conditional", "approved", "active"].includes(i.status)) continue;
      const gaps = coiGaps(i, members, inp.coiDeclarations);
      if (gaps.missing.includes(userId))
        out.push({ id: `coi:${i.id}:${userId}`, kind: "coi", tone: "orange", title: `Declare conflicts of interest — ${i.title}`, detail: "Annex F declaration before approval, and within 2 business days of any new conflict (§12.2)", href: `/initiatives/${i.id}`, at: null, cite: "12.2" });
      if (roles.has("prc") && gaps.undecided.length && !members.some((m) => m.initiativeId === i.id && m.userId === userId))
        out.push({ id: `coi:${i.id}:prc:${gaps.undecided.join(",")}`, kind: "coi", tone: "yellow", title: `Declared conflict awaiting the PRC — ${i.title}`, detail: `${gaps.undecided.map(name).join(", ")} · decide the action: none, team change, independent price check or rejection (§12.2)`, href: `/initiatives/${i.id}`, at: null, cite: "12.2" });
    }
  }

  /* §5.1 / §5.6 approved change orders moved x by more than 10 % — the PRC resets the rate */
  if (inp.changeOrders?.length && roles.has("prc")) {
    for (const i of initiatives) {
      if (!inp.changeOrders.some((c) => c.initiativeId === i.id && c.status === "approved")) continue;
      const imp = changeOrderImpact(i, inp.changeOrders, inp.curveAdjustments ?? []);
      if (!imp.resetNeeded) continue;
      out.push({ id: `reset:${i.id}:${imp.approved.length}`, kind: "rate_reset", tone: "orange", title: `Reset the revenue-share rate — ${i.title}`, detail: `Approved change orders moved x by ${Math.round(imp.movePct * 1000) / 10}% (over ${Math.round(POLICY.rate.resetOnChangePct * 100)}%) · the new rate applies to revenue realised after the reset (§5.1, §5.6)`, href: `/projects/${i.id}`, at: imp.approved.map((c) => c.decidedAt ?? "").sort().pop() || null, cite: "5.6" });
    }
  }

  /* §8.3 Finance reconciles within 30 days of the close-out report */
  if (inp.closeOutReports && (roles.has("finance") || roles.has("cfo"))) {
    for (const r of inp.closeOutReports) {
      if (r.reconciledAt) continue;
      const due = Date.parse(r.submittedAt) + POLICY.closeReconciliationDays * DAY;
      if (now < due - 7 * DAY) continue;
      out.push({ id: `close:${r.id}:${now > due ? "late" : "soon"}`, kind: "close_out", tone: now > due ? "red" : "yellow", title: `${now > due ? "Final reconciliation overdue" : "Final reconciliation due"} — ${ini(r.initiativeId)?.title ?? "project"}`, detail: `Close-out report ${formatDate(r.submittedAt, "medium")} · reconcile by ${formatDate(new Date(due).toISOString(), "medium")} (§8.3)`, href: `/projects/${r.initiativeId}`, at: new Date(due).toISOString(), cite: "8.3" });
    }
  }

  /* §4.5 proposals returned as incomplete — the proposer resubmits */
  for (const i of initiatives) {
    const ret = (i.returns ?? []).filter((r) => !r.resubmittedAt).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!ret || i.initiatorId !== userId) continue;
    out.push({ id: `ret:${i.id}:${ret.at}`, kind: "proposal_return", tone: "orange", title: `Proposal returned — complete and resubmit ${i.title}`, detail: `${name(ret.byId)}: ${ret.missing.slice(0, 3).join(", ")}${ret.missing.length > 3 ? ` +${ret.missing.length - 3}` : ""}${ret.note ? ` · ${ret.note}` : ""}`, href: `/initiatives/${i.id}`, at: ret.at, cite: "4.5" });
  }

  for (const a of amendments) {
    if (a.status !== "passed" || a.recordedAt) continue;
    if (!(a.proposedById === userId || roles.has("prc"))) continue;
    out.push({ id: `amrec:${a.id}`, kind: "amendment_record", tone: "cyan", title: `Record the passed amendment in the ledger — ${ini(a.initiativeId)?.title ?? "project"}`, detail: `${describeAmendment(a, users, members)} · PMO closes and opens the ledger rows from ${formatDate(a.effectiveDate, "medium")} (§6.5, §6.8)`, href: `/initiatives/${a.initiativeId}`, at: a.effectiveDate, cite: "6.8" });
  }

  /* ───────── sales & service ───────── */
  const meUser = users.find((u) => u.id === userId);
  const serviceLead = !!meUser && meUser.team === "Service" && /manager|lead|head/i.test(meUser.title);
  const breachedOthers: Ticket[] = [];
  for (const t of inp.tickets ?? []) {
    // the service workstream's SLA reading (business hours, paused while waiting on the customer)
    const sla = ticketSla(t, now);
    if (sla.state === "paused" || sla.state === "met" || sla.state === "late") continue;
    const breached = sla.state === "breached";
    if (t.ownerId === userId && (breached || sla.hoursLeft <= 2))
      out.push({ id: `tkt:${t.id}:${breached ? "breach" : "soon"}`, kind: "ticket_sla", tone: breached ? "red" : "orange", title: breached ? `SLA breached — ${t.subject}` : `SLA due within 2 hours — ${t.subject}`, detail: `${t.priority} · ${t.category} · ${sla.label} · due ${formatDate(t.slaDueAt, "datetime")} WIB`, href: `/tickets/${t.id}`, at: t.slaDueAt, cite: "SLA" });
    else if (t.ownerId !== userId && breached) breachedOthers.push(t);
  }
  if (serviceLead && breachedOthers.length)
    out.push({ id: `tkt:team:${breachedOthers.map((t) => t.id).join(",")}`, kind: "ticket_sla", tone: "orange", title: `${breachedOthers.length} team ticket${breachedOthers.length === 1 ? "" : "s"} past SLA`, detail: breachedOthers.slice(0, 3).map((t) => `${t.subject} (${name(t.ownerId)})`).join(" · "), href: "/tickets", at: breachedOthers.map((t) => t.slaDueAt).sort()[0], cite: "SLA" });

  const activities = inp.activities ?? [];
  const myTasks = activities.filter((a) => a.type === "task" && !a.done && a.dueAt && a.ownerId === userId);
  const today = wibDate(now);
  const overdue = myTasks.filter((a) => Date.parse(a.dueAt!) < now && wibDate(Date.parse(a.dueAt!)) < today);
  const dueToday = myTasks.filter((a) => wibDate(Date.parse(a.dueAt!)) === today);
  const taskHref = (a: Activity) => (a.links.dealIds[0] ? `/deals/${a.links.dealIds[0]}` : a.links.ticketIds?.[0] ? `/tickets/${a.links.ticketIds[0]}` : a.links.contactIds[0] ? `/contacts/${a.links.contactIds[0]}` : a.links.companyIds[0] ? `/companies/${a.links.companyIds[0]}` : "/home");
  if (overdue.length)
    out.push({ id: `task:overdue:${overdue.map((a) => a.id).join(",")}`, kind: "task_due", tone: "red", title: overdue.length === 1 ? `Overdue task — ${overdue[0].subject}` : `${overdue.length} overdue tasks`, detail: overdue.slice(0, 3).map((a) => `${a.subject} (due ${formatDate(a.dueAt, "short")})`).join(" · "), href: overdue.length === 1 ? taskHref(overdue[0]) : "/home", at: overdue.map((a) => a.dueAt!).sort()[0], cite: "Tasks" });
  if (dueToday.length)
    out.push({ id: `task:today:${today}:${dueToday.map((a) => a.id).join(",")}`, kind: "task_due", tone: "yellow", title: dueToday.length === 1 ? `Task due today — ${dueToday[0].subject}` : `${dueToday.length} tasks due today`, detail: dueToday.slice(0, 3).map((a) => `${a.subject}${a.dueAt ? ` · ${formatDate(a.dueAt, "time")}` : ""}`).join(" · "), href: dueToday.length === 1 ? taskHref(dueToday[0]) : "/home", at: dueToday.map((a) => a.dueAt!).sort()[0], cite: "Tasks" });

  /* deals: past the close date, rotting (no touch beyond the stage's threshold), no next step — the deal-card signals */
  const stageOf = new Map<string, Pipeline["stages"][number]>();
  for (const p of inp.pipelines ?? []) for (const st of p.stages) stageOf.set(st.id, st);
  const sigs = dealActivityIndex(activities);
  const rotting: Deal[] = [];
  const noNext: Deal[] = [];
  for (const d of inp.deals ?? []) {
    if (d.ownerId !== userId) continue;
    const st = stageOf.get(d.stageId);
    if (!st || st.closed) continue;
    if (Date.parse(d.closeDate) < now)
      out.push({ id: `deal:${d.id}:overdue:${d.closeDate}`, kind: "deal_overdue", tone: "orange", title: `Close date passed — ${d.name}`, detail: `${formatIDR(d.amount)} · ${st.name} · expected to close ${formatDate(d.closeDate, "medium")} — update the date or the stage`, href: `/deals/${d.id}`, at: d.closeDate, cite: "Pipeline" });
    if (isRotting(d, st, sigs.get(d.id), now)) rotting.push(d);
    else if (nextStepOf(sigs.get(d.id), now).task === null) noNext.push(d);
  }
  if (rotting.length)
    out.push({ id: `deal:rot:${rotting.map((d) => d.id).join(",")}`, kind: "deal_stale", tone: "orange", title: rotting.length === 1 ? `Deal going cold — ${rotting[0].name}` : `${rotting.length} deals going cold`, detail: rotting.slice(0, 3).map((d) => `${d.name} (${idleDays(d, sigs.get(d.id), now)}d idle, limit ${rottingThreshold(stageOf.get(d.stageId))}d)`).join(" · "), href: rotting.length === 1 ? `/deals/${rotting[0].id}` : "/deals", at: null, cite: "Pipeline" });
  if (noNext.length)
    out.push({ id: `deal:nonext:${noNext.map((d) => d.id).join(",")}`, kind: "deal_stale", tone: "yellow", title: noNext.length === 1 ? `No next step — ${noNext[0].name}` : `${noNext.length} open deals with no next step`, detail: `${noNext.slice(0, 3).map((d) => d.name).join(" · ")} · add a task with a due date`, href: noNext.length === 1 ? `/deals/${noNext[0].id}` : "/deals", at: null, cite: "Pipeline" });

  /* quotes: §4.7 Finance check / director approval (maker-checker), and expiry within 3 days for the owner */
  const settings = settingsOf(inp.quoteSettings);
  const canFinance = roles.has("finance") || roles.has("cfo");
  const canDirector = roles.has("ceo") || roles.has("executive_committee");
  for (const q of inp.quotes ?? []) {
    if (q.status === "pending_approval" && q.ownerId !== userId && (canFinance || canDirector)) {
      const deal = inp.deals?.find((d) => d.id === q.dealId);
      const totals = quoteTotals(q.lineItems, { quote: q, settings, products: inp.products ?? [], company: inp.companies?.find((c) => c.id === deal?.companyId) });
      const needs = approvalNeeds(q, totals, settings);
      const mine = [canFinance && !needs.financeDone ? "Finance check" : "", canDirector && !needs.directorDone ? "director approval" : ""].filter(Boolean);
      if (mine.length)
        out.push({ id: `quote:${q.id}:${mine.join("+")}`, kind: "quote_approval", tone: "orange", title: `Quote awaiting your ${mine.join(" and ")} — ${q.number}`, detail: `${q.title} · ${formatIDR(totals.subtotal)} excl. VAT · by ${name(q.ownerId)}${q.submittedAt ? ` ${formatDate(q.submittedAt, "medium")}` : ""}${needs.reasons.length ? ` · ${needs.reasons[needs.reasons.length - 1]}` : ""}`, href: `/quotes/${q.id}`, at: q.submittedAt ?? q.createdAt, cite: "4.7" });
    }
    if (q.ownerId === userId && ["draft", "pending_approval", "approved", "sent"].includes(q.status) && !isQuoteExpired(q, now)) {
      const left = Date.parse(q.expiresAt) - now;
      if (left <= 3 * DAY)
        out.push({ id: `qexp:${q.id}:${q.expiresAt}`, kind: "quote_expiry", tone: left <= DAY ? "orange" : "yellow", title: `Quote expires ${left <= DAY ? "within a day" : "in 3 days or less"} — ${q.number}`, detail: `${q.title} · ${q.status.replace(/_/g, " ")} · expires ${formatDate(q.expiresAt, "medium")} — extend or re-issue it`, href: `/quotes/${q.id}`, at: q.expiresAt, cite: "Quotes" });
    }
  }

  /* account plans: review overdue for the cadence, overdue plan actions */
  for (const plan of inp.accountPlans ?? []) {
    const company = inp.companies?.find((c) => c.id === plan.companyId);
    if (plan.ownerId === userId && reviewOverdue(plan.cadence, plan.lastReviewedAt, now))
      out.push({ id: `plan:${plan.id}:${plan.lastReviewedAt ?? "never"}`, kind: "account_plan", tone: "yellow", title: `Account plan review overdue — ${company?.name ?? "account"}`, detail: `${plan.cadence} review · last ${plan.lastReviewedAt ? formatDate(plan.lastReviewedAt, "medium") : "never"}`, href: `/companies/${plan.companyId}/plan`, at: null, cite: "Accounts" });
    const late = plan.actions.filter((x) => x.status === "open" && x.ownerId === userId && x.dueAt && Date.parse(x.dueAt) < now);
    if (late.length)
      out.push({ id: `plan:${plan.id}:actions:${late.map((x) => x.id).join(",")}`, kind: "account_plan", tone: "orange", title: `${late.length} overdue account-plan action${late.length === 1 ? "" : "s"} — ${company?.name ?? "account"}`, detail: late.slice(0, 3).map((x) => x.text).join(" · "), href: `/companies/${plan.companyId}/plan`, at: late.map((x) => x.dueAt!).sort()[0], cite: "Accounts" });
  }

  /* ───────── delivery ───────── */
  const issues = inp.issues ?? [];
  if (issues.length) {
    // the agile workstream's rules: open "blocks" links, WIB due state, triage visibility
    const blockers = openBlockersOf(inp.issueLinks ?? [], issues);
    const assignedAt = new Map<string, { at: string; by: string }>();
    for (const h of inp.issueHistory ?? [])
      if (h.field === "assigneeId" && h.to === userId && h.actorId !== userId) {
        const prev = assignedAt.get(h.issueId);
        if (!prev || prev.at < h.at) assignedAt.set(h.issueId, { at: h.at, by: h.actorId });
      }
    let assignedCount = 0;
    for (const i of issues) {
      if (i.assigneeId !== userId || i.status === "done") continue;
      const href = `/board?issue=${encodeURIComponent(i.key)}`;
      const asg = assignedAt.get(i.id) ?? (i.reporterId !== userId ? { at: i.createdAt, by: i.reporterId } : null);
      if (asg && now - Date.parse(asg.at) < 7 * DAY && assignedCount < 10) {
        assignedCount++;
        out.push({ id: `iss:${i.id}:asg:${asg.at}`, kind: "issue_assigned", tone: "blue", title: `${i.key} assigned to you — ${i.summary}`, detail: `by ${name(asg.by)} · ${i.priority} priority · ${i.status.replace(/_/g, " ")}`, href, at: asg.at, cite: "Jira" });
      }
      const due = dueState(i, now);
      if (i.dueDate && (due === "overdue" || due === "soon"))
        out.push({ id: `iss:${i.id}:due:${due}`, kind: "issue_due", tone: due === "overdue" ? "red" : "orange", title: `${due === "overdue" ? "Overdue" : "Due soon"} — ${i.key} ${i.summary}`, detail: `due ${formatDate(i.dueDate, "medium")} · ${i.status.replace(/_/g, " ")}`, href, at: i.dueDate, cite: "Jira" });
      const bl = blockers.get(i.id);
      if (bl?.length)
        out.push({ id: `iss:${i.id}:blocked:${bl.map((b) => b.id).join(",")}`, kind: "issue_blocked", tone: "orange", title: `Blocked — ${i.key} ${i.summary}`, detail: `waiting on ${bl.map((b) => `${b.key} (${b.status.replace(/_/g, " ")}${b.assigneeId ? `, ${name(b.assigneeId)}` : ""})`).join(", ")}`, href, at: null, cite: "Jira" });
    }
    // triage inbox for the Jira project lead
    for (const p of inp.projects ?? []) {
      if (p.leadId !== userId) continue;
      const waiting = issues.filter((i) => i.projectId === p.id && inTriage(i, now));
      if (waiting.length)
        out.push({ id: `triage:${p.id}:${waiting.map((i) => i.id).join(",")}`, kind: "issue_triage", tone: "yellow", title: `${waiting.length} issue${waiting.length === 1 ? "" : "s"} waiting in ${p.key} triage — open the Triage inbox on the backlog`, detail: waiting.slice(0, 3).map((i) => `${i.key} ${i.summary}`).join(" · "), href: "/backlog", at: waiting.map((i) => i.createdAt).sort()[0], cite: "Jira" });
    }
  }

  return out.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || (a.at ?? "9999").localeCompare(b.at ?? "9999"));
}
