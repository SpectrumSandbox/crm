/*
 * Store slice "ProgramExtras" (W9) — §14 disputes and appeals, Annex B/C e-signatures and the §9.6 monthly company
 * financial summary. Mixed into useCrm. Pure rules (deadlines, recusal, tallies, the summary builder) are exported
 * so pages and the notification centre share one definition.
 *
 * Relative imports only: src/lib/seed-ext/me.ts imports this module and is compiled by scripts/tsconfig.json.
 */
import { addBusinessDays, businessDaysBetween, clawbackAmount, cycleMonth, nextMonth, paymentDate } from "../initiatives/engine";
import { POLICY, POLICY_VERSION } from "../initiatives/policy";
import type {
  AgreementSignature,
  AuditEntry,
  BonusRun,
  Clawback,
  CompanySummary,
  DeferredBonus,
  Dispute,
  DisputeCategory,
  DisputeEvent,
  DisputeOutcome,
  DisputeStage,
  EmployeeProfile,
  GovernanceRole,
  InitiativeMember,
  ProbationOutcome,
} from "../initiatives/types";
import type { GetFn, SetFn, Uid } from "./types";

const DAY = 86_400_000;

/* ───────────────────────── pure rules ───────────────────────── */

export const DISPUTE_CATEGORY_META: Record<DisputeCategory, { label: string; basis: "statement" | "event"; hint: string }> = {
  calculation: { label: "Bonus calculation", basis: "statement", hint: "A figure on a monthly statement is wrong (§8.4)" },
  ledger: { label: "Ledger entry", basis: "statement", hint: "Work period, role, weight or allocation on the Team Allocation Ledger (§6.5)" },
  origination: { label: "Origination", basis: "event", hint: "Who originated the opportunity — the Initiator role (§4.1)" },
  role: { label: "Role assignment", basis: "event", hint: "Role or weight given to you (§6.1–6.3, §6.7–6.8)" },
  rating: { label: "Performance rating", basis: "event", hint: "A monthly rating by the Project Lead (§7.4)" },
  removal: { label: "Removal", basis: "event", hint: "Removal from a project (§7.5)" },
  probation: { label: "Probation", basis: "event", hint: "Probation balance or outcome (§11)" },
  forfeiture: { label: "Forfeiture", basis: "event", hint: "A bonus forfeited after a status change (§10)" },
  clawback: { label: "Clawback", basis: "event", hint: "A clawback notice — figures or mitigating factors (§9.4)" },
};

export const DISPUTE_STAGE_META: Record<DisputeStage, { label: string; step: string }> = {
  direct: { label: "Direct resolution", step: "§14 step 2" },
  prc: { label: "PRC decision", step: "§14 step 3" },
  exco: { label: "Executive Committee appeal", step: "§14 step 4" },
  closed: { label: "Closed", step: "" },
};

export const DISPUTE_OUTCOME_LABEL: Record<DisputeOutcome, string> = {
  upheld: "Upheld",
  partially_upheld: "Partly upheld",
  rejected: "Not upheld",
  withdrawn: "Withdrawn",
  settled: "Settled directly",
};

/** Teams whose shares a dispute of this kind affects — they are parties and are recused (§14 step 3). */
const TEAM_PARTIES: DisputeCategory[] = ["ledger", "role", "origination", "rating", "removal"];

/** §14 step 1: 30 days from the statement date (calculation, ledger) or from the decision / event. */
export function disputeTimeLimit(eventAt: string) {
  return new Date(Date.parse(eventAt) + POLICY.statementDisputeDays * DAY).toISOString();
}
export const isLateDispute = (eventAt: string, at = Date.now()) => Date.parse(disputeTimeLimit(eventAt)) < at;

/** Statement date of a salary cycle: the salary date the statement is issued with (§8.4). */
export const statementDate = (month: string) => paymentDate(month);

/** Business-day deadline of a stage that starts at `from` — 10 business days for steps 2, 3 and 4 (§14). */
export const stageDeadline = (from: string) => addBusinessDays(from, POLICY.sla.disputeResolveBusinessDays);

const roleSet = (userId: string, profiles: EmployeeProfile[]) => new Set<GovernanceRole>(profiles.find((p) => p.userId === userId)?.governanceRoles ?? []);
const hasAny = (userId: string, profiles: EmployeeProfile[], roles: GovernanceRole[]) => {
  const r = roleSet(userId, profiles);
  return roles.some((x) => r.has(x));
};
export const isPrcMember = (userId: string, profiles: EmployeeProfile[]) => hasAny(userId, profiles, ["prc", "ceo"]);
export const isExcoMember = (userId: string, profiles: EmployeeProfile[]) => hasAny(userId, profiles, ["executive_committee"]);
export const isDisputeAdmin = (userId: string, profiles: EmployeeProfile[]) => hasAny(userId, profiles, ["finance", "cfo", "hr", "prc", "ceo", "executive_committee"]);

/** Who settles it directly: Finance for figures, the Project Lead for team matters, HR for probation (§14 step 2). */
export function defaultHandler(category: DisputeCategory, raisedById: string, initiativeId: string | null, members: InitiativeMember[], profiles: EmployeeProfile[]): string | null {
  const firstWith = (roles: GovernanceRole[]) => profiles.find((p) => p.userId !== raisedById && roles.some((r) => p.governanceRoles.includes(r)))?.userId ?? null;
  if (category === "probation") return firstWith(["hr"]) ?? firstWith(["finance", "cfo"]);
  if (["role", "rating", "removal", "origination"].includes(category) && initiativeId) {
    const lead = members.find((m) => m.initiativeId === initiativeId && m.roles.includes("project_lead") && m.userId !== raisedById && !m.leftAt)?.userId;
    if (lead) return lead;
  }
  return firstWith(["finance"]) ?? firstWith(["cfo"]);
}

/** Parties to the dispute: the employee, and for team matters everyone on that project's ledger. */
export function disputeParties(category: DisputeCategory, raisedById: string, initiativeId: string | null, members: InitiativeMember[]): string[] {
  const ids = new Set<string>([raisedById]);
  if (initiativeId && TEAM_PARTIES.includes(category)) for (const m of members) if (m.initiativeId === initiativeId) ids.add(m.userId);
  return [...ids];
}

/** Members of the deciding body at a stage, split into eligible and recused. */
export function decidingBody(d: Pick<Dispute, "involvedIds">, stage: "prc" | "exco", profiles: EmployeeProfile[]) {
  const all = profiles.filter((p) => (stage === "prc" ? isPrcMember(p.userId, profiles) : isExcoMember(p.userId, profiles))).map((p) => p.userId);
  return { eligible: all.filter((u) => !d.involvedIds.includes(u)), recused: all.filter((u) => d.involvedIds.includes(u)) };
}

/** Vote tally for the current deciding stage — quorum is a majority of the eligible (non-recused) members. */
export function disputeTally(d: Pick<Dispute, "involvedIds" | "votes">, stage: "prc" | "exco", profiles: EmployeeProfile[]) {
  const body = decidingBody(d, stage, profiles);
  const valid = d.votes.filter((v) => v.stage === stage && body.eligible.includes(v.userId));
  const uphold = valid.filter((v) => v.vote === "uphold").length;
  const reject = valid.filter((v) => v.vote === "reject").length;
  const quorum = Math.floor(body.eligible.length / 2) + 1;
  const cast = uphold + reject;
  return {
    ...body,
    uphold,
    reject,
    cast,
    quorum,
    /** null until the quorum is reached and the vote is not tied */
    result: cast >= quorum && uphold !== reject ? (uphold > reject ? ("uphold" as const) : ("reject" as const)) : null,
    tied: cast >= quorum && uphold === reject,
  };
}

/** Business days left (negative = overdue) on the current stage. */
export function disputeSla(d: Pick<Dispute, "dueAt" | "stage">, now = Date.now()) {
  if (!d.dueAt || d.stage === "closed") return null;
  const nowIso = new Date(now).toISOString();
  const overdue = Date.parse(d.dueAt) < now;
  return { overdue, days: overdue ? -businessDaysBetween(d.dueAt, nowIso) : businessDaysBetween(nowIso, d.dueAt) };
}

/** May this person see the dispute? The employee, the handler, the parties and Finance / HR / PRC / ExCo (§13.4). */
export const canSeeDispute = (d: Dispute, userId: string, profiles: EmployeeProfile[]) => d.raisedById === userId || d.handlerId === userId || isDisputeAdmin(userId, profiles);

/** Next salary cycle still open for a correction: the cycle of today, or the one after if its run is certified (§8.5). */
export function correctionCycle(runs: BonusRun[], now = Date.now()) {
  let m = cycleMonth(new Date(now).toISOString());
  for (let i = 0; i < 24 && runs.some((r) => r.month === m && (r.status === "certified" || r.status === "released")); i++) m = nextMonth(m);
  return m;
}

/** FNV-1a 32-bit fingerprint, hex — identifies the exact text signed. */
export function fingerprint(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** §9.6 aggregate summary of one cycle's run — no individual amounts. */
export function buildCompanySummary(
  run: BonusRun,
  ctx: { runs: BonusRun[]; deferred: DeferredBonus[]; clawbacks: Clawback[]; outcomes: ProbationOutcome[] },
  meta: { id: string; publishedAt: string; publishedById: string; note?: string },
): CompanySummary {
  const lines = run.lines;
  const counted = ctx.runs.filter((r) => r.status === "released" || r.status === "certified" || r.id === run.id);
  const withheldTotal = counted.reduce((s, r) => s + r.lines.reduce((a, l) => a + l.withheld, 0), 0);
  const paidOut = ctx.outcomes.reduce((s, o) => s + o.amount, 0);
  const latest = [...ctx.runs].filter((r) => r.month <= run.month).sort((a, b) => b.month.localeCompare(a.month))[0] ?? run;
  return {
    id: meta.id,
    month: run.month,
    publishedAt: meta.publishedAt,
    publishedById: meta.publishedById,
    companyRevenue: run.companyRevenue,
    directCosts: run.directCosts,
    overheads: run.overheads,
    operatingResult: run.operatingResult,
    /* stored runs record one combined result: failed when either check failed (§9.2 pro rata) */
    breakEvenPassed: run.status !== "failed" && run.payoutPct >= 1,
    cashPassed: run.cashAfter >= 2 * run.fixedCostsMonthly,
    payoutPct: run.payoutPct,
    projects: new Set(lines.map((l) => l.initiativeId)).size,
    participants: new Set(lines.map((l) => l.userId)).size,
    pool: run.totals.pool,
    payable: run.totals.payable,
    deferred: run.totals.deferred,
    carriedOver: run.totals.carriedOver,
    probationHeld: run.totals.withheld,
    held: run.totals.held,
    forfeited: run.totals.forfeited,
    balances: {
      deferredPending: ctx.deferred.filter((d) => d.status === "pending").reduce((s, d) => s + d.amount, 0),
      carriedForward: latest.totals.carriedOver,
      probationHeld: Math.max(0, withheldTotal - paidOut),
      clawbackOutstanding: ctx.clawbacks.filter((c) => !["closed", "waived"].includes(c.status)).reduce((s, c) => s + Math.max(0, clawbackAmount(c) - c.recovered), 0),
    },
    note: meta.note ?? "",
  };
}

/* ───────────────────────── slice ───────────────────────── */

export interface RaiseDisputeInput {
  category: DisputeCategory;
  subject: string;
  detail: string;
  initiativeId: string | null;
  runMonth: string | null;
  lineRef: string | null;
  amount: number | null;
  claimedAmount: number | null;
  eventAt: string;
  lateReason?: string;
}

export interface DisputeDecisionInput {
  outcome: "upheld" | "partially_upheld" | "rejected";
  text: string;
  correction: number | null;
}

export interface SignAgreementInput {
  typedName: string;
  language: "id" | "en";
  annexC: boolean;
  fingerprint: string;
  details: { label: string; value: string }[];
}

export interface ProgramExtrasSlice {
  /** §14 — raise a dispute for the current user; returns its id, or null when it cannot be raised. */
  raiseDispute: (input: RaiseDisputeInput) => string | null;
  commentDispute: (id: string, text: string) => void;
  /** §14 step 2 — the handler proposes a settlement; the employee accepts it or escalates. */
  proposeDisputeResolution: (id: string, input: { outcome: "upheld" | "partially_upheld" | "rejected"; text: string; correction: number | null }) => void;
  acceptDisputeProposal: (id: string) => void;
  /** §14 step 3 — either party escalates to the PRC. */
  escalateDispute: (id: string, reason: string) => void;
  /** PRC / ExCo vote; `onBehalfOf` records another member's vote from the meeting minutes. */
  voteDispute: (id: string, vote: "uphold" | "reject", onBehalfOf?: string) => void;
  /** Record the PRC (step 3) or Executive Committee (step 4) decision. */
  decideDispute: (id: string, input: DisputeDecisionInput) => void;
  /** §14 step 4 — appeal a PRC decision within 10 business days. */
  appealDispute: (id: string, reason: string) => void;
  withdrawDispute: (id: string, reason: string) => void;
  /** Add or remove a recusal (a conflict found later, §13.1). */
  setDisputeRecusal: (id: string, userId: string, recused: boolean) => void;
  reassignDispute: (id: string, handlerId: string) => void;
  /** §8.5 Finance records that the correction was paid with the salary. */
  markCorrectionPaid: (id: string) => void;
  /** Annex B (+ C) typed-name e-signature for the current user; updates the HR record's signature date. */
  signAgreement: (input: SignAgreementInput) => string | null;
  /** §9.6 publish the month's aggregate summary to every employee (Finance / PRC). */
  publishCompanySummary: (month: string, note?: string) => string | null;
}

type Needs = {
  currentUserId: string;
  users: { id: string; name: string; email: string }[];
  employeeProfiles: EmployeeProfile[];
  initiativeMembers: InitiativeMember[];
  bonusRuns: BonusRun[];
  deferredBonuses: DeferredBonus[];
  clawbacks: Clawback[];
  probationOutcomes: ProbationOutcome[];
  auditLog: AuditEntry[];
  disputes: Dispute[];
  agreementSignatures: AgreementSignature[];
  companySummaries: CompanySummary[];
  identity: { email: string | null; source: "access" | "demo"; userId: string | null };
  updateProfile: (userId: string, patch: Partial<EmployeeProfile>) => void;
};

export function createProgramExtrasSlice<S extends ProgramExtrasSlice & Needs>(set: SetFn<S>, get: GetFn<S>, uid: Uid): ProgramExtrasSlice {
  const now = () => new Date().toISOString();
  const me = () => get().currentUserId;
  const name = (id: string | null) => get().users.find((u) => u.id === id)?.name ?? id ?? "—";
  const find = (id: string) => get().disputes.find((d) => d.id === id);
  const event = (kind: DisputeEvent["kind"], stage: DisputeStage, text: string, actorId = me()): DisputeEvent => ({ id: uid("dev"), at: now(), actorId, kind, stage, text });
  const audit = (entity: AuditEntry["entity"], entityId: string, action: string, detail = ""): AuditEntry => ({ id: uid("au"), at: now(), actorId: me(), entity, entityId, action, detail });
  const patch = (id: string, fn: (d: Dispute) => Dispute, log?: AuditEntry) =>
    set((s) => ({ disputes: s.disputes.map((d) => (d.id === id ? fn(d) : d)), ...(log ? { auditLog: [log, ...s.auditLog] } : {}) }) as Partial<S>);
  const isParty = (d: Dispute, u: string) => d.raisedById === u || d.handlerId === u;
  const profiles = () => get().employeeProfiles;

  return {
    raiseDispute: (input) => {
      const userId = me();
      const subject = input.subject.trim();
      if (!subject || !input.detail.trim() || Number.isNaN(Date.parse(input.eventAt))) return null;
      const ts = now();
      const late = isLateDispute(input.eventAt, Date.parse(ts));
      if (late && !input.lateReason?.trim()) return null;
      const st = get();
      const year = ts.slice(0, 4);
      const seq = st.disputes.filter((d) => d.number.startsWith(`DSP-${year}-`)).reduce((n, d) => Math.max(n, Number(d.number.slice(9)) || 0), 0) + 1;
      const handlerId = defaultHandler(input.category, userId, input.initiativeId, st.initiativeMembers, st.employeeProfiles);
      const id = uid("dsp");
      const d: Dispute = {
        id,
        number: `DSP-${year}-${String(seq).padStart(4, "0")}`,
        raisedById: userId,
        category: input.category,
        subject,
        detail: input.detail.trim(),
        initiativeId: input.initiativeId,
        runMonth: input.runMonth,
        lineRef: input.lineRef,
        amount: input.amount,
        claimedAmount: input.claimedAmount,
        eventAt: input.eventAt,
        raisedAt: ts,
        late,
        ...(late ? { lateReason: input.lateReason?.trim() } : {}),
        stage: "direct",
        stageStartedAt: ts,
        dueAt: stageDeadline(ts),
        handlerId,
        involvedIds: disputeParties(input.category, userId, input.initiativeId, st.initiativeMembers),
        proposal: null,
        votes: [],
        prcDecision: null,
        excoDecision: null,
        outcome: null,
        closedAt: null,
        correction: null,
        events: [event("raised", "direct", `${DISPUTE_CATEGORY_META[input.category].label} dispute raised${handlerId ? ` · handled by ${name(handlerId)}` : ""}${late ? ` · after the 30-day limit: ${input.lateReason?.trim()}` : ""}`, userId)],
      };
      set((s) => ({ disputes: [d, ...s.disputes], auditLog: [audit("policy", id, `§14 dispute ${d.number} raised`, `${DISPUTE_CATEGORY_META[d.category].label}: ${subject}`), ...s.auditLog] }) as Partial<S>);
      return id;
    },

    commentDispute: (id, text) => {
      const d = find(id);
      const t = text.trim();
      if (!d || !t || !canSeeDispute(d, me(), profiles())) return;
      patch(id, (x) => ({ ...x, events: [...x.events, event("comment", x.stage, t)] }));
    },

    proposeDisputeResolution: (id, input) => {
      const d = find(id);
      const u = me();
      if (!d || d.stage !== "direct" || u === d.raisedById || !(d.handlerId === u || isDisputeAdmin(u, profiles())) || !input.text.trim()) return;
      const proposal = { outcome: input.outcome, text: input.text.trim(), correction: input.correction && input.correction > 0 ? Math.floor(input.correction) : null, byId: u, at: now() };
      patch(id, (x) => ({ ...x, proposal, events: [...x.events, event("proposed", "direct", `${DISPUTE_OUTCOME_LABEL[input.outcome]} proposed: ${proposal.text}${proposal.correction ? ` · correction Rp ${proposal.correction.toLocaleString("id-ID")}` : ""}`)] }));
    },

    acceptDisputeProposal: (id) => {
      const d = find(id);
      if (!d || d.stage !== "direct" || !d.proposal || d.raisedById !== me()) return;
      const p = d.proposal;
      const ts = now();
      const correction = p.correction ? { amount: p.correction, cycle: correctionCycle(get().bonusRuns), paidAt: null, paidById: null } : null;
      patch(
        id,
        (x) => ({ ...x, stage: "closed", dueAt: null, outcome: "settled", closedAt: ts, correction, events: [...x.events, event("accepted", "direct", `Settled directly — ${DISPUTE_OUTCOME_LABEL[p.outcome].toLowerCase()}${correction ? ` · Rp ${correction.amount.toLocaleString("id-ID")} corrected in the ${correction.cycle} cycle (§8.5)` : ""}`)] }),
        audit("policy", id, `§14 dispute ${d.number} settled directly`, p.text),
      );
    },

    escalateDispute: (id, reason) => {
      const d = find(id);
      const u = me();
      if (!d || d.stage !== "direct" || !(isParty(d, u) || isDisputeAdmin(u, profiles())) || !reason.trim()) return;
      const ts = now();
      patch(
        id,
        (x) => ({ ...x, stage: "prc", stageStartedAt: ts, dueAt: stageDeadline(ts), events: [...x.events, event("escalated", "prc", `Escalated to the PRC: ${reason.trim()}`)] }),
        audit("policy", id, `§14 dispute ${d.number} escalated to the PRC`, reason.trim()),
      );
    },

    voteDispute: (id, vote, onBehalfOf) => {
      const d = find(id);
      if (!d || (d.stage !== "prc" && d.stage !== "exco")) return;
      const stage = d.stage;
      const voter = onBehalfOf ?? me();
      const ps = profiles();
      const member = (u: string) => (stage === "prc" ? isPrcMember(u, ps) : isExcoMember(u, ps));
      // the recorder must sit on the body and not be recused; the voter must be eligible
      if (!member(me()) || d.involvedIds.includes(me()) || !member(voter) || d.involvedIds.includes(voter)) return;
      const ts = now();
      patch(id, (x) => ({
        ...x,
        votes: [...x.votes.filter((v) => !(v.stage === stage && v.userId === voter)), { userId: voter, stage, vote, at: ts }],
        events: [...x.events, event("vote", stage, `${name(voter)} voted to ${vote === "uphold" ? "uphold" : "reject"} the dispute${voter !== me() ? ` (recorded by ${name(me())})` : ""}`)],
      }));
    },

    decideDispute: (id, input) => {
      const d = find(id);
      if (!d || (d.stage !== "prc" && d.stage !== "exco") || !input.text.trim()) return;
      const stage = d.stage;
      const ps = profiles();
      const u = me();
      const member = stage === "prc" ? isPrcMember(u, ps) : isExcoMember(u, ps);
      if (!member || d.involvedIds.includes(u)) return;
      const t = disputeTally(d, stage, ps);
      if (!t.result) return;
      // the outcome must follow the vote: a majority to reject cannot be recorded as upheld
      if ((t.result === "reject") !== (input.outcome === "rejected")) return;
      const ts = now();
      const correction = input.outcome !== "rejected" && input.correction && input.correction > 0 ? Math.floor(input.correction) : null;
      const corr = correction ? { amount: correction, cycle: correctionCycle(get().bonusRuns), paidAt: null, paidById: null } : null;
      if (stage === "prc") {
        const appealBy = stageDeadline(ts);
        patch(
          id,
          (x) => ({
            ...x,
            stage: "closed",
            dueAt: null,
            outcome: input.outcome,
            closedAt: ts,
            correction: corr,
            prcDecision: { outcome: input.outcome, text: input.text.trim(), correction, byId: u, at: ts, appealBy },
            events: [...x.events, event("decided", "prc", `PRC decision (${t.uphold}–${t.reject}${t.recused.length ? `, ${t.recused.length} recused` : ""}): ${DISPUTE_OUTCOME_LABEL[input.outcome].toLowerCase()} — ${input.text.trim()} · appeal to the Executive Committee by ${appealBy.slice(0, 10)}`)],
          }),
          audit("policy", id, `§14 dispute ${d.number}: PRC decided ${input.outcome}`, input.text.trim()),
        );
      } else {
        patch(
          id,
          (x) => ({
            ...x,
            stage: "closed",
            dueAt: null,
            outcome: input.outcome,
            closedAt: ts,
            correction: corr ?? x.correction,
            excoDecision: { outcome: input.outcome, text: input.text.trim(), correction, byId: u, at: ts },
            events: [...x.events, event("decided", "exco", `Executive Committee decision (${t.uphold}–${t.reject}), final within the company: ${DISPUTE_OUTCOME_LABEL[input.outcome].toLowerCase()} — ${input.text.trim()}`)],
          }),
          audit("policy", id, `§14 dispute ${d.number}: Executive Committee decided ${input.outcome}`, input.text.trim()),
        );
      }
    },

    appealDispute: (id, reason) => {
      const d = find(id);
      const u = me();
      if (!d || d.stage !== "closed" || !d.prcDecision || d.excoDecision || !reason.trim()) return;
      if (!(isParty(d, u) || d.involvedIds.includes(u))) return;
      if (Date.parse(d.prcDecision.appealBy) < Date.now()) return;
      const ts = now();
      patch(
        id,
        (x) => ({ ...x, stage: "exco", stageStartedAt: ts, dueAt: stageDeadline(ts), outcome: null, closedAt: null, events: [...x.events, event("appealed", "exco", `Appealed to the Executive Committee: ${reason.trim()}`)] }),
        audit("policy", id, `§14 dispute ${d.number} appealed to the Executive Committee`, reason.trim()),
      );
    },

    withdrawDispute: (id, reason) => {
      const d = find(id);
      if (!d || d.stage === "closed" || d.raisedById !== me()) return;
      const ts = now();
      patch(
        id,
        (x) => ({ ...x, stage: "closed", dueAt: null, outcome: "withdrawn", closedAt: ts, events: [...x.events, event("withdrawn", x.stage, `Withdrawn by the employee${reason.trim() ? `: ${reason.trim()}` : ""}`)] }),
        audit("policy", id, `§14 dispute ${d.number} withdrawn`, reason.trim()),
      );
    },

    setDisputeRecusal: (id, userId, recused) => {
      const d = find(id);
      const u = me();
      if (!d || d.stage === "closed" || !isDisputeAdmin(u, profiles())) return;
      if (userId === d.raisedById && !recused) return; // the employee is always a party
      patch(id, (x) => ({
        ...x,
        involvedIds: recused ? [...new Set([...x.involvedIds, userId])] : x.involvedIds.filter((v) => v !== userId),
        votes: recused ? x.votes.filter((v) => v.userId !== userId) : x.votes,
        events: [...x.events, event("comment", x.stage, `${name(userId)} ${recused ? "recused (involved in the dispute, §14 step 3)" : "no longer recused"}`)],
      }));
    },

    reassignDispute: (id, handlerId) => {
      const d = find(id);
      if (!d || d.stage !== "direct" || handlerId === d.raisedById || !isDisputeAdmin(me(), profiles())) return;
      patch(id, (x) => ({ ...x, handlerId, events: [...x.events, event("assigned", "direct", `Handled by ${name(handlerId)}`)] }));
    },

    markCorrectionPaid: (id) => {
      const d = find(id);
      const u = me();
      const r = roleSet(u, profiles());
      if (!d?.correction || d.correction.paidAt || !(r.has("finance") || r.has("cfo"))) return;
      const ts = now();
      patch(
        id,
        (x) => ({ ...x, correction: x.correction ? { ...x.correction, paidAt: ts, paidById: u } : null, events: [...x.events, event("correction_paid", x.stage, `Correction paid with the ${x.correction?.cycle} salary (§8.5)`)] }),
        audit("policy", id, `§14 dispute ${d.number}: correction paid`, `Rp ${d.correction.amount.toLocaleString("id-ID")}`),
      );
    },

    signAgreement: (input) => {
      const st = get();
      const userId = st.currentUserId;
      const user = st.users.find((u) => u.id === userId);
      const profile = st.employeeProfiles.find((p) => p.userId === userId);
      if (!user || !profile) return null;
      const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
      if (norm(input.typedName) !== norm(user.name)) return null;
      const ts = now();
      const id = uid("sig");
      const sig: AgreementSignature = {
        id,
        userId,
        policyVersion: POLICY_VERSION,
        annexC: input.annexC,
        language: input.language,
        typedName: input.typedName.trim().replace(/\s+/g, " "),
        email: st.identity.source === "access" ? st.identity.email : user.email,
        identitySource: st.identity.source === "access" && st.identity.userId === userId ? "access" : "demo",
        signedAt: ts,
        fingerprint: input.fingerprint,
        details: input.details,
        ...(typeof navigator !== "undefined" ? { userAgent: navigator.userAgent.slice(0, 160) } : {}),
      };
      set((s) => ({ agreementSignatures: [sig, ...s.agreementSignatures], auditLog: [audit("employee", userId, `signed Annex B${input.annexC ? " + Annex C" : ""} v${POLICY_VERSION} (${input.language === "id" ? "Bahasa Indonesia" : "English"})`, `typed name "${sig.typedName}" · ${sig.identitySource === "access" ? `Access ${sig.email}` : `demo, acting as ${sig.email}`} · fingerprint ${sig.fingerprint}`), ...s.auditLog] }) as Partial<S>);
      st.updateProfile(userId, { acknowledgmentSignedAt: ts });
      return id;
    },

    publishCompanySummary: (month, note) => {
      const st = get();
      const r = roleSet(st.currentUserId, st.employeeProfiles);
      if (!(r.has("finance") || r.has("cfo") || r.has("prc") || r.has("ceo"))) return null;
      const run = st.bonusRuns.find((x) => x.month === month);
      if (!run || run.status === "draft") return null;
      const existing = st.companySummaries.find((x) => x.month === month);
      const id = existing?.id ?? uid("csum");
      const summary = buildCompanySummary(run, { runs: st.bonusRuns, deferred: st.deferredBonuses, clawbacks: st.clawbacks, outcomes: st.probationOutcomes }, { id, publishedAt: now(), publishedById: st.currentUserId, note });
      set((s) => ({ companySummaries: [summary, ...s.companySummaries.filter((x) => x.month !== month)].sort((a, b) => b.month.localeCompare(a.month)), auditLog: [audit("policy", id, `§9.6 company summary ${existing ? "republished" : "published"} for ${month}`, note ?? ""), ...s.auditLog] }) as Partial<S>);
      return id;
    },
  };
}
