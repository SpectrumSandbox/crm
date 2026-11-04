/*
 * Alerts for the current user, derived from the store (Policy v4.0): PRC review queue with tier SLAs (§4.2, §4.5),
 * Role and Weight Agreement sign requests (§6.7), §6.8 amendment votes and ties, the monthly break-even test and
 * release (§8.2, §9.1), deferred bonuses vesting (§9.3), clawback dispute windows (§9.4), appeals (§4.6) and Annex B.
 */
import { addBusinessDays, approvalTier, breakEvenDeadline, businessDaysBetween, memberWeight, monthKey } from "@/lib/initiatives/engine";
import { POLICY, TIER_META } from "@/lib/initiatives/policy";
import type { BonusRun, Clawback, DeferredBonus, EmployeeProfile, Initiative, InitiativeMember, TeamAmendment } from "@/lib/initiatives/types";
import type { User } from "@/lib/types";
import { formatDate, formatIDR } from "@/lib/utils";
import { annexBState, canVote, describeAmendment, rolesLabel, voteDeadline } from "./helpers";

export type AlertKind = "prc_review" | "sla" | "consent" | "vote" | "tie" | "break_even" | "release" | "vesting" | "clawback" | "appeal" | "annex_b";
export type AlertTone = "red" | "orange" | "yellow" | "cyan" | "green" | "blue";

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
}

const DAY = 86_400_000;
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
      tone: Date.parse(due) < now ? "red" : "yellow",
      title: `Vote on a team amendment — ${i?.title ?? "project"}`,
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

  /* §8.2 / §9.1 break-even test and cash check due by the 23rd (from the 20th, no certified run yet) */
  if (roles.has("cfo") || roles.has("finance")) {
    const month = monthKey(now);
    const run = runs.find((r) => r.month === month);
    const certified = run && (run.status === "certified" || run.status === "released");
    if (!certified && wibDay(now) >= POLICY.cycle.cutoffDay) {
      const deadline = breakEvenDeadline(month);
      const late = Date.parse(deadline) < now;
      out.push({
        id: `breakeven:${month}:${late ? "late" : "due"}:${run?.status ?? "none"}`,
        kind: "break_even",
        tone: late ? "red" : "orange",
        title: late ? `Break-even test overdue for ${month}` : `Certify the break-even test and cash check for ${month}`,
        detail: `${run ? (run.status === "failed" ? "A failed run is recorded — PRC applies §9.2 pro rata" : "Draft run recorded") : "No run recorded yet"} · CFO certifies by the 23rd using the latest three closed months; salary date ${formatDate(`${month}-${POLICY.cycle.salaryDay}T09:00:00+07:00`, "medium")}`,
        href: `/compensation?month=${month}`,
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
        href: "/me#statements",
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

  return out.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || (a.at ?? "9999").localeCompare(b.at ?? "9999"));
}
