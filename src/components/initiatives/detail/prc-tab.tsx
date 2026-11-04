"use client";

import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Ban, ClipboardCheck, ClipboardList, Gavel, Hourglass, Landmark, ListChecks, Lock, Scale, Search, ShieldCheck, SlidersHorizontal, UserCheck } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { DecisionOutcome, Initiative, PrcScores } from "@/lib/initiatives/types";
import { addBusinessDays, approvalTier, capacityCheck, concurrentNonLeadRoles, deferralTriggers, isLiveMember, maxAllocationFactor, participationEligibility, proposalEconomics, proposalGaps, standardBonusOf } from "@/lib/initiatives/engine";
import { POLICY, ROLE_META, TIER_META } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR, fromDateInput, toDateInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Avatar, Chip } from "@/components/ui/misc";
import { Cite, Money, Rate, TierChip, rateSourceLabel } from "@/components/initiatives/shared";
import { Card, CheckRow, KV, SlaTimer, onCmdEnter } from "./ui";

const CRITERIA: { key: keyof Omit<PrcScores, "notes">; label: string; hint: string }[] = [
  { key: "feasibility", label: "Feasibility", hint: "Technical approach, realistic schedule, team skills and certifications, equipment availability" },
  { key: "profitability", label: "Profitability", hint: "Credible revenue, complete costs, margin above the CFO's minimum, payment terms that support cash flow" },
  { key: "resources", label: "Resources", hint: "Team capacity and line manager agreement, leadership capacity (§7.3), no clash with higher-priority work" },
  { key: "strategic", label: "Strategy & classification", hint: "Fit with the company's markets, client value, no conflict with existing clients; correct project type (§5.1)" },
  { key: "risk", label: "Risk and compliance", hint: "5 = risks identified and mitigated, no unacceptable legal, safety, tax or reputational exposure · 1 = unmitigated" },
];

const OUTCOMES: { value: DecisionOutcome; label: string; hint: string; color: "green" | "orange" | "red" | "yellow" }[] = [
  { value: "approved", label: "Approved", hint: "Project code, budget, type and revenue-share rate are issued", color: "green" },
  { value: "conditional", label: "Conditionally approved", hint: "Conditions and a deadline; the code is issued once the PMO confirms them", color: "orange" },
  { value: "rejected", label: "Rejected", hint: "Written reasons and guidance on resubmission; appeal within 10 business days", color: "red" },
  { value: "deferred", label: "Deferred", hint: "The information needed and a new decision date", color: "yellow" },
];

const outcomeColor: Record<DecisionOutcome, "green" | "orange" | "red" | "yellow"> = { approved: "green", conditional: "orange", rejected: "red", deferred: "yellow" };
const outcomeLabel: Record<DecisionOutcome, string> = { approved: "Approved", conditional: "Conditionally approved", rejected: "Rejected", deferred: "Deferred" };

export function PrcTab({ ini }: { ini: Initiative }) {
  if (ini.status === "draft") {
    return (
      <Card title="PRC review" icon={Gavel} cite="4.5">
        <p className="text-sm text-sg-muted">
          This proposal has not been submitted yet. Once submitted, the PMO acknowledges it within 1 business day and checks completeness within 2; a PRC reviewer evaluates it with Finance against §4.4, and {TIER_META[approvalTier(ini).tier].label} decides within {TIER_META[approvalTier(ini).tier].decisionBusinessDays} business days.
        </p>
        <div className="mt-4">
          <AutomatedChecks ini={ini} />
        </div>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-4">
        <ScreeningCard ini={ini} />
        <ScorecardCard ini={ini} />
        {ini.status === "evaluation" ? <DecisionForm ini={ini} /> : null}
        {ini.status === "conditional" ? <ConditionsCard ini={ini} /> : null}
        {ini.decision ? <DecisionRecord ini={ini} /> : null}
        <AppealCard ini={ini} />
      </div>
      <div className="min-w-0">
        <Card title="Automated checks" icon={ListChecks} cite="4.4">
          <AutomatedChecks ini={ini} />
        </Card>
      </div>
    </div>
  );
}

/* ───────────── (a) screening ───────────── */

function ScreeningCard({ ini }: { ini: Initiative }) {
  const users = useCrm((s) => s.users);
  const profiles = useCrm((s) => s.employeeProfiles);
  const acknowledgeInitiative = useCrm((s) => s.acknowledgeInitiative);
  const startEvaluation = useCrm((s) => s.startEvaluation);
  const currentUserId = useCrm((s) => s.currentUserId);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();

  const reviewers = useMemo(() => {
    const prc = new Set(profiles.filter((p) => p.governanceRoles?.includes("prc")).map((p) => p.userId));
    return users.filter((u) => prc.has(u.id) && u.id !== ini.initiatorId);
  }, [users, profiles, ini.initiatorId]);
  const [reviewerId, setReviewerId] = useState("");
  useEffect(() => {
    if (!reviewerId && reviewers.length) setReviewerId(reviewers.find((r) => r.id === currentUserId)?.id ?? reviewers[0].id);
  }, [reviewers, reviewerId, currentUserId]);

  const ackDue = ini.submittedAt ? addBusinessDays(ini.submittedAt, POLICY.sla.acknowledgeBusinessDays) : null;
  const reviewer = ini.primaryReviewerId ? userMap.get(ini.primaryReviewerId) : undefined;

  return (
    <Card title="Acknowledgment & completeness" icon={Search} cite="4.5">
      <div className="space-y-1">
        <KV label="Tracking number">
          <span className="sg-num font-semibold text-sg-white">{ini.trackingNo || "—"}</span>
        </KV>
        <KV label="Submitted">{formatDate(ini.submittedAt, "datetime")}</KV>
        <KV label="Acknowledged">{ini.acknowledgedAt ? formatDate(ini.acknowledgedAt, "datetime") : <span className="text-sg-dim">pending</span>}</KV>
        <KV label="Primary reviewer">
          {reviewer ? (
            <span className="inline-flex items-center gap-1.5">
              <Avatar user={reviewer} size="xs" /> {reviewer.name}
            </span>
          ) : (
            <span className="text-sg-dim">not assigned</span>
          )}
        </KV>
        {ackDue ? (
          <div className="pt-1">
            <SlaTimer label="Acknowledgment SLA" dueIso={ackDue} doneIso={ini.acknowledgedAt} />
          </div>
        ) : null}
      </div>

      {ini.status === "submitted" ? (
        <div className="mt-4 border-t border-sg-line pt-4">
          <p className="mb-2 text-xs text-sg-muted">The PMO acknowledges the proposal (tracking number issued at submission), checks completeness within 2 business days and assigns a PRC reviewer, who evaluates it with Finance.</p>
          {reviewers.length ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Primary reviewer (PRC member)" className="min-w-[220px] flex-1">
                <Select value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
                  {reviewers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} — {u.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                variant="primary"
                disabled={!reviewerId}
                onClick={() => {
                  acknowledgeInitiative(ini.id, reviewerId);
                  notify(`Acknowledged — ${userMap.get(reviewerId)?.name ?? "reviewer"} assigned`);
                }}
              >
                <UserCheck /> Acknowledge &amp; assign reviewer
              </Button>
            </div>
          ) : (
            <p className="text-xs text-soft-orange">No PRC members found in the HR records (governance role “prc”). Add the role to an employee profile to assign a reviewer.</p>
          )}
        </div>
      ) : null}

      {ini.status === "screening" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-sg-line pt-4">
          <p className="flex-1 text-xs text-sg-muted">Complete? Move the proposal to evaluation with Finance against §4.4. Incomplete proposals go back to the proposer with a list of what is missing; the clock restarts on resubmission.</p>
          <Button
            variant="primary"
            onClick={() => {
              startEvaluation(ini.id);
              notify("Evaluation started with Finance");
            }}
          >
            <ClipboardCheck /> Start evaluation
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/* ───────────── (b) scorecard ───────────── */

function ScorecardCard({ ini }: { ini: Initiative }) {
  const scoreInitiative = useCrm((s) => s.scoreInitiative);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const editable = ini.status === "evaluation";
  const notYet = ini.status === "submitted" || ini.status === "screening";
  const initial = (): PrcScores => ini.scores ?? { feasibility: 3, profitability: 3, resources: 3, strategic: 3, risk: 3, notes: "" };
  const [scores, setScores] = useState<PrcScores>(initial);
  useEffect(() => {
    setScores(ini.scores ?? { feasibility: 3, profitability: 3, resources: 3, strategic: 3, risk: 3, notes: "" });
  }, [ini.scores]);

  const avg = CRITERIA.reduce((s, c) => s + scores[c.key], 0) / CRITERIA.length;
  const dirty = JSON.stringify(scores) !== JSON.stringify(ini.scores);
  const save = () => {
    if (!editable) return;
    scoreInitiative(ini.id, scores);
    notify("Evaluation scorecard saved");
  };
  const reviewer = ini.primaryReviewerId ? userMap.get(ini.primaryReviewerId) : undefined;

  return (
    <Card
      title="Evaluation scorecard"
      icon={SlidersHorizontal}
      cite="4.4"
      actions={
        <span className="flex items-center gap-2 text-xs text-sg-muted">
          Average <span className={cn("sg-num font-display text-base font-extrabold", avg >= 4 ? "text-soft-green" : avg >= 3 ? "text-soft-yellow" : "text-soft-red")}>{avg.toFixed(1)}</span>/5
        </span>
      }
    >
      <div className="space-y-3" onKeyDown={onCmdEnter(save)}>
        {CRITERIA.map((c) => (
          <div key={c.key} className="flex flex-wrap items-center gap-3">
            <div className="min-w-[200px] flex-1">
              <div className="text-sm font-semibold text-sg-white">{c.label}</div>
              <div className="text-2xs text-sg-dim">{c.hint}</div>
            </div>
            <div role="radiogroup" aria-label={c.label} className="flex rounded border border-sg-line p-0.5">
              {[1, 2, 3, 4, 5].map((n) => {
                const active = scores[c.key] === n;
                return (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!editable}
                    onClick={() => setScores({ ...scores, [c.key]: n })}
                    className={cn(
                      "sg-num h-7 w-8 rounded-sm text-xs font-semibold transition-colors disabled:cursor-not-allowed",
                      active ? (n >= 4 ? "bg-soft-green text-sg-bg" : n === 3 ? "bg-soft-yellow text-sg-bg" : "bg-soft-red text-sg-bg") : "text-sg-muted hover:bg-sg-card-3 hover:text-sg-white",
                    )}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <Field label="Reviewer notes">
          <Textarea value={scores.notes} disabled={!editable} onChange={(e) => setScores({ ...scores, notes: e.target.value })} placeholder="Observations for the PRC meeting…" className="min-h-[64px]" />
        </Field>
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xs text-sg-dim">
            {reviewer ? `Primary reviewer: ${reviewer.name}` : "No primary reviewer assigned"}
            {notYet ? " · scoring opens when evaluation starts" : !editable ? " · scorecard is locked after the decision" : ""}
          </span>
          {editable ? (
            <Button variant="primary" size="sm" onClick={save} disabled={!dirty}>
              <ClipboardList /> Save scorecard
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/* ───────────── automated checks (side panel) ───────────── */

function AutomatedChecks({ ini }: { ini: Initiative }) {
  const members = useCrm((s) => s.initiativeMembers);
  const initiatives = useCrm((s) => s.initiatives);
  const profiles = useCrm((s) => s.employeeProfiles);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const userMap = useUserMap();

  const data = useMemo(() => {
    const gaps = proposalGaps(ini, members);
    const team = members.filter((m) => m.initiativeId === ini.id && isLiveMember(m));
    const eligibility = team.map((m) => ({ m, r: participationEligibility(profiles.find((p) => p.userId === m.userId)) }));
    const leads = team.filter((m) => m.roles.some((r) => ROLE_META[r].leadership)).map((m) => ({ m, c: capacityCheck(m.userId, ini, m.roles, initiatives, members) }));
    const econ = proposalEconomics(ini, adjustments);
    const deferral = deferralTriggers(ini, adjustments);
    const nonLead = team.filter((m) => m.roles.some((r) => r === "engineer" || r === "secretary" || r === "specialist")).map((m) => ({ m, n: concurrentNonLeadRoles(m.userId, initiatives, members, ini.id) })).filter((x) => x.n >= POLICY.maxConcurrentNonLeadRoles);
    const allocation = team.filter((m) => (m.allocationFactor ?? 1) > maxAllocationFactor(profiles.find((p) => p.userId === m.userId)) + 1e-9);
    const unsigned = team.filter((m) => m.consent !== "accepted" || !m.managerApproved);
    const tier = approvalTier(ini);
    return { gaps, eligibility, leads, econ, deferral, nonLead, allocation, unsigned, tier };
  }, [ini, members, initiatives, profiles, adjustments]);

  const ineligible = data.eligibility.filter((e) => !e.r.ok);
  const warned = data.eligibility.filter((e) => e.r.ok && e.r.warnings.length);
  const breaches = data.leads.filter((l) => !l.c.ok);
  const margin = data.econ.expected.marginPct;
  const name = (id: string) => userMap.get(id)?.name ?? id;

  return (
    <div className="divide-y divide-sg-line/60">
      <CheckRow ok title={`${TIER_META[data.tier.tier].label} — ${TIER_META[data.tier.tier].decides}`}>
        {data.tier.reasons.join("; ")}. {TIER_META[data.tier.tier].proposal}; decision within {TIER_META[data.tier.tier].decisionBusinessDays} business days. <Cite s="4.2" />
      </CheckRow>

      <CheckRow ok={data.gaps.length === 0} title={data.gaps.length ? `Completeness — ${data.gaps.length} gap${data.gaps.length === 1 ? "" : "s"}` : "Proposal complete"}>
        {data.gaps.length ? (
          <ul className="list-disc pl-4">
            {data.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        ) : (
          <>
            Everything §4.3 requires is present <Cite s="4.3" />
          </>
        )}
      </CheckRow>

      <CheckRow ok={data.unsigned.length === 0} title={data.unsigned.length ? `Role and Weight Agreement — ${data.unsigned.length} not signed or without line manager agreement` : "Role and Weight Agreement signed, line managers agreed"}>
        {data.unsigned.length ? data.unsigned.map((m) => `${name(m.userId)}${m.consent !== "accepted" ? " (not signed)" : ""}${!m.managerApproved ? " (no line manager agreement)" : ""}`).join("; ") : "Every member signed Annex D Part 1."} <Cite s="6.7" />
      </CheckRow>

      <CheckRow ok={ineligible.length === 0} warn={warned.length > 0} title={ineligible.length ? `Eligibility — ${ineligible.length} not eligible` : `Eligibility — ${data.eligibility.length} member${data.eligibility.length === 1 ? "" : "s"} eligible`}>
        {data.eligibility.length === 0 ? "No team members proposed." : null}
        <ul className="mt-0.5 space-y-1">
          {data.eligibility.map(({ m, r }) => (
            <li key={m.id} className="flex items-start gap-1.5">
              <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", !r.ok ? "bg-soft-red" : r.warnings.length ? "bg-soft-yellow" : "bg-soft-green")} />
              <span>
                <span className="text-sg-text">{name(m.userId)}</span>
                {r.blockers.length ? <span className="text-soft-red"> — {r.blockers.join("; ")}</span> : null}
                {r.warnings.length ? <span className="text-soft-yellow"> — {r.warnings.join("; ")}</span> : null}
              </span>
            </li>
          ))}
        </ul>
        {data.allocation.length ? <p className="text-soft-red">Allocation factor above the part-time cap: {data.allocation.map((m) => name(m.userId)).join(", ")} (§3.1)</p> : null}
        <Cite s="3.1" />
      </CheckRow>

      <CheckRow ok={breaches.length === 0} warn={data.nonLead.length > 0} title={breaches.length ? `Leadership capacity — ${breaches.length} breach${breaches.length === 1 ? "" : "es"}` : "Leadership capacity within 2.0"}>
        {data.leads.length === 0 ? "No leads assigned." : null}
        <ul className="mt-0.5 space-y-0.5">
          {data.leads.map(({ m, c }) => (
            <li key={m.id}>
              <span className="text-sg-text">{name(m.userId)}</span>:{" "}
              <span className={cn("sg-num", c.ok ? "text-sg-muted" : "text-soft-red")}>
                {c.before.toFixed(2)} + {c.adds.toFixed(2)} = {c.after.toFixed(2)} / {POLICY.leadershipCapacity.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
        {data.nonLead.length ? (
          <p className="text-soft-yellow">
            {data.nonLead.map((x) => `${name(x.m.userId)} (${x.n + 1} non-lead roles)`).join(", ")} — more than 3 concurrent non-lead roles need line manager and PRC approval (§7.1)
          </p>
        ) : null}
        <Cite s="7.3" />
      </CheckRow>

      <CheckRow ok={data.econ.expected.pool > 0 && margin > 0} warn={margin > 0 && margin < 0.1} title={`Profitability — expected company margin ${Math.round(margin * 1000) / 10}%`}>
        Expected net <Money value={data.econ.expected.net} /> · x <Money value={data.econ.rate.x} /> over {data.econ.rate.months} months · rate <Rate value={data.econ.rate.rate} /> · pool <Money value={data.econ.expected.pool} /> · company keeps <Money value={data.econ.expected.companyMargin} />.
        {data.econ.expected.pool <= 0 ? <span className="text-soft-red"> No bonus pool in the expected case.</span> : null}
        {data.econ.worst.net < 0 ? <span className="text-soft-orange"> Worst case is loss-making.</span> : null}
        <Cite s="5.1" />
      </CheckRow>

      <CheckRow ok warn={data.deferral.length > 0} title={data.deferral.length ? `Deferral — ${Math.round((ini.deferralPct ?? POLICY.deferral.defaultPct) * 100)}% for ${ini.deferralMonths || POLICY.deferral.minMonths} months proposed` : "No deferral triggers"}>
        {data.deferral.length ? data.deferral.join("; ") : "Bonuses are paid with the next salary after collection."} <Cite s="9.3" />
      </CheckRow>

      {ini.type === "C" ? (
        <CheckRow ok={standardBonusOf(ini) >= POLICY.typeCMinimum.standardBonus} title={`Type C standard bonus ${formatIDR(standardBonusOf(ini), "full")} a month`}>
          Guaranteed minimum monthly pool, at least Rp1,000,000; the PRC fixes it at approval. <Cite s="8.6" />
        </CheckRow>
      ) : null}
    </div>
  );
}

/* ───────────── (c) decision ───────────── */

function JiraProjectSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const projects = useCrm((s) => s.projects);
  return (
    <Field label="Jira project for the delivery epic" hint="The PMO opens the project: an epic and a kickoff task with Finance & PMO (§4.5).">
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Don’t create an epic</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.key} · {p.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

const DEFERRAL_PCTS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];

function DecisionForm({ ini }: { ini: Initiative }) {
  const decideInitiative = useCrm((s) => s.decideInitiative);
  const profiles = useCrm((s) => s.employeeProfiles);
  const currentUserId = useCrm((s) => s.currentUserId);
  const projects = useCrm((s) => s.projects);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const me = userMap.get(currentUserId);
  const isCeo = !!profiles.find((p) => p.userId === currentUserId)?.governanceRoles?.includes("ceo");
  const tier = useMemo(() => approvalTier(ini), [ini]);
  const econ = useMemo(() => proposalEconomics(ini, adjustments), [ini, adjustments]);

  const [outcome, setOutcome] = useState<DecisionOutcome>("approved");
  const [rationale, setRationale] = useState("");
  const [conditions, setConditions] = useState("");
  const [conditionsDue, setConditionsDue] = useState(() => toDateInput(addBusinessDays(new Date().toISOString(), 10)));
  const [votesFor, setVotesFor] = useState(tier.tier === 1 ? "2" : "3");
  const [votesAgainst, setVotesAgainst] = useState("0");
  const [veto, setVeto] = useState(false);
  const [highRisk, setHighRisk] = useState(ini.highRisk);
  const [deferralPct, setDeferralPct] = useState(Math.min(POLICY.deferral.maxPct, ini.deferralPct ?? POLICY.deferral.defaultPct) || POLICY.deferral.defaultPct);
  const [deferralMonths, setDeferralMonths] = useState(Math.min(POLICY.deferral.maxMonths, Math.max(POLICY.deferral.minMonths, ini.deferralMonths || POLICY.deferral.minMonths)));
  const [standardBonus, setStandardBonus] = useState(String(standardBonusOf(ini)));
  const [rateChecked, setRateChecked] = useState(false);
  const [jiraProjectId, setJiraProjectId] = useState(() => ini.jiraProjectId ?? projects[0]?.id ?? "");
  const [tried, setTried] = useState(false);

  const effective: DecisionOutcome = veto ? "rejected" : outcome;
  const otherTriggers = useMemo(() => deferralTriggers({ ...ini, highRisk: false }, adjustments), [ini, adjustments]);
  const willDefer = highRisk || otherTriggers.length > 0;
  const approving = effective === "approved" || effective === "conditional";
  const sb = Math.floor(Number(standardBonus.replace(/\D/g, "")) || 0);

  const errors: string[] = [];
  if (!rationale.trim()) errors.push("Reasons are required");
  if (effective === "conditional" && !conditions.trim()) errors.push("State the conditions for conditional approval");
  if (effective === "conditional" && !conditionsDue) errors.push("Set a deadline for the conditions");
  if (approving && econ.rate.source === "curve" && !rateChecked) errors.push("Confirm Finance checked the expected case that sets the rate");
  if (approving && ini.type === "C" && sb < POLICY.typeCMinimum.standardBonus) errors.push("Type C standard bonus must be at least Rp1,000,000 a month");
  if (tier.tier === 3 && !isCeo && approving) errors.push("Tier 3 is decided by the full PRC with the CEO present");
  const vf = Math.max(0, Math.floor(Number(votesFor) || 0));
  const va = Math.max(0, Math.floor(Number(votesAgainst) || 0));
  const voteMismatch = !veto && approving && va >= vf;

  const submit = () => {
    setTried(true);
    if (errors.length) return;
    decideInitiative(
      ini.id,
      {
        outcome: effective,
        rationale: rationale.trim(),
        conditions: effective === "conditional" ? conditions.trim() : "",
        conditionsDueAt: effective === "conditional" && conditionsDue ? fromDateInput(conditionsDue) : null,
        votesFor: vf,
        votesAgainst: va,
        ceoVeto: veto,
      },
      { jiraProjectId: effective === "approved" && jiraProjectId ? jiraProjectId : undefined, highRisk, deferralMonths, deferralPct: willDefer ? deferralPct : 0, standardBonus: ini.type === "C" ? sb : undefined },
    );
    notify(veto ? "CEO veto recorded — proposal rejected" : `PRC decision recorded: ${outcomeLabel[effective]}${effective === "approved" && econ.rate.source !== "provisional" ? ` · rate ${(econ.rate.rate * 100).toFixed(3)}% fixed` : ""}`);
  };

  return (
    <Card title="PRC decision" icon={Gavel} cite={["4.5", "Annex A"]} actions={<TierChip tier={tier.tier} long />}>
      <div className="space-y-4" onKeyDown={onCmdEnter(submit)}>
        <p className="text-2xs text-sg-dim">
          {TIER_META[tier.tier].decides} decides within {TIER_META[tier.tier].decisionBusinessDays} business days<Cite s="4.2" />.
        </p>
        <div role="radiogroup" aria-label="Outcome" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {OUTCOMES.map((o) => {
            const active = outcome === o.value;
            return (
              <label
                key={o.value}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-md border p-2.5 transition-colors",
                  active ? "border-sg-white/60 bg-sg-card-2" : "border-sg-line hover:border-sg-line-2",
                  veto && o.value !== "rejected" && "opacity-40",
                )}
              >
                <input type="radio" name="outcome" value={o.value} checked={active} onChange={() => setOutcome(o.value)} disabled={veto} className="mt-0.5 accent-white" />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-sg-white">
                    <Chip color={o.color} dot>
                      {o.label}
                    </Chip>
                  </span>
                  <span className="mt-0.5 block text-2xs text-sg-dim">{o.hint}</span>
                </span>
              </label>
            );
          })}
        </div>

        <Field label="Reasons (required)">
          <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why the PRC reached this decision — recorded and sent to the proposer in writing." className={cn(tried && !rationale.trim() && "border-soft-red/60")} />
        </Field>

        {effective === "conditional" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
            <Field label="Conditions (required)">
              <Textarea value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="e.g. Signed LOI from the client; revised cost estimate with subcontractor quote" className={cn("min-h-[64px]", tried && !conditions.trim() && "border-soft-red/60")} />
            </Field>
            <Field label="Deadline">
              <Input type="date" value={conditionsDue} onChange={(e) => setConditionsDue(e.target.value)} className={cn(tried && !conditionsDue && "border-soft-red/60")} />
            </Field>
          </div>
        ) : null}

        {approving ? (
          <div className="rounded-md border border-sg-line p-3">
            <div className="sg-eyebrow mb-2 flex items-center gap-1">
              <Landmark className="size-3" /> Confirmed type, x and revenue-share rate <Cite s="5.1" />
            </div>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <Rate value={econ.rate.rate} className="font-display text-xl font-extrabold text-sg-white" />
              <span className="text-xs text-sg-muted">
                x <Money value={econ.rate.x} className="text-sg-white" /> · {econ.rate.months} contracted month{econ.rate.months === 1 ? "" : "s"} · Type {ini.type}
              </span>
            </div>
            <p className="mt-1 text-2xs text-sg-dim">{econ.rate.source === "curve" ? "The PRC fixes this rate in the approval decision; it applies to all of the project's net revenue for its whole life." : rateSourceLabel(econ.rate.source)}</p>
            {econ.rate.source === "curve" ? (
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-sg-text">
                <input type="checkbox" checked={rateChecked} onChange={(e) => setRateChecked(e.target.checked)} className="accent-white" />
                <Lock className="size-3.5" /> Finance checked the expected case — fix y at {(econ.rate.rate * 100).toFixed(3)}%
              </label>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Votes for">
            <Input type="number" min={0} value={votesFor} onChange={(e) => setVotesFor(e.target.value)} />
          </Field>
          <Field label="Votes against">
            <Input type="number" min={0} value={votesAgainst} onChange={(e) => setVotesAgainst(e.target.value)} />
          </Field>
          <div className="col-span-2 flex items-end">
            {isCeo ? (
              <label className={cn("flex w-full cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-xs", veto ? "border-soft-red/60 bg-soft-red/10 text-soft-red" : "border-sg-line text-sg-text hover:border-sg-line-2")}>
                <input type="checkbox" checked={veto} onChange={(e) => setVeto(e.target.checked)} className="accent-white" />
                <Ban className="size-3.5" /> CEO veto — forces rejection
              </label>
            ) : (
              <span className="text-2xs text-sg-dim">Only the CEO may exercise a veto.</span>
            )}
          </div>
        </div>
        {voteMismatch ? <p className="-mt-2 text-2xs text-soft-yellow">Votes against are not fewer than votes for — check the tally before recording an approval.</p> : null}

        {approving ? (
          <div className="rounded-md border border-sg-line p-3">
            <div className="sg-eyebrow mb-2 flex items-center">
              Risk and deferral <Cite s="9.3" />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-sg-text">
                <input type="checkbox" checked={highRisk} onChange={(e) => setHighRisk(e.target.checked)} className="accent-white" />
                Technical or execution risk rated high
              </label>
              <label className={cn("flex items-center gap-2 text-xs text-sg-muted", !willDefer && "opacity-50")}>
                Deferral
                <Select value={String(deferralPct)} disabled={!willDefer} onChange={(e) => setDeferralPct(Number(e.target.value))} wrapperClassName="w-28" className="h-7 text-xs">
                  {DEFERRAL_PCTS.map((p) => (
                    <option key={p} value={p}>
                      {Math.round(p * 100)}% of each bonus
                    </option>
                  ))}
                </Select>
              </label>
              <label className={cn("flex items-center gap-2 text-xs text-sg-muted", !willDefer && "opacity-50")}>
                for
                <Select value={String(deferralMonths)} disabled={!willDefer} onChange={(e) => setDeferralMonths(Number(e.target.value))} wrapperClassName="w-40" className="h-7 text-xs">
                  {Array.from({ length: POLICY.deferral.maxMonths - POLICY.deferral.minMonths + 1 }, (_, i) => POLICY.deferral.minMonths + i).map((n) => (
                    <option key={n} value={n}>
                      {n} months after close
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <p className="mt-2 text-2xs text-sg-dim">
              {willDefer
                ? `Deferral applies: ${[...(highRisk ? ["rated high risk by the PRC"] : []), ...otherTriggers].join("; ")}. Up to 30%, 6–12 months after close, based on the warranty period and risk.`
                : "No trigger applies — no deferral unless the PRC rates the risk high."}
            </p>
          </div>
        ) : null}

        {approving && ini.type === "C" ? (
          <div className="rounded-md border border-sg-line p-3">
            <div className="sg-eyebrow mb-2 flex items-center">
              Type C standard bonus approved <Cite s="8.6" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-48">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-2xs font-semibold text-sg-dim">Rp</span>
                <Input inputMode="numeric" value={standardBonus} onChange={(e) => setStandardBonus(e.target.value.replace(/\D/g, ""))} className="sg-num pl-8 text-right" aria-label="Standard bonus per month" />
              </div>
              <span className="text-2xs text-sg-dim">a month · proposed {formatIDR(standardBonusOf(ini), "full")} · at least Rp1,000,000</span>
            </div>
          </div>
        ) : null}

        {effective === "approved" ? <JiraProjectSelect value={jiraProjectId} onChange={setJiraProjectId} /> : null}

        {tried && errors.length ? (
          <ul className="space-y-0.5 text-xs text-soft-red">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sg-line pt-3">
          <span className="flex items-center gap-1.5 text-2xs text-sg-dim">
            <Avatar user={me} size="xs" /> Recorded by {me?.name ?? currentUserId} as PRC chair · ⌘↵
          </span>
          <Button variant={effective === "rejected" ? "danger" : "primary"} onClick={submit}>
            <Gavel /> Record PRC decision{effective !== "approved" ? ` · ${outcomeLabel[effective]}` : ""}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ConditionsCard({ ini }: { ini: Initiative }) {
  const confirmConditions = useCrm((s) => s.confirmConditions);
  const projects = useCrm((s) => s.projects);
  const notify = useUi((s) => s.notify);
  const [jiraProjectId, setJiraProjectId] = useState(() => (ini.epicId ? "" : ini.jiraProjectId ?? projects[0]?.id ?? ""));
  const due = ini.decision?.conditionsDueAt;

  return (
    <Card title="Conditions for approval" icon={BadgeCheck} cite="4.5">
      <p className="whitespace-pre-wrap text-sm text-sg-text">{ini.decision?.conditions || <span className="text-sg-dim">No conditions recorded.</span>}</p>
      {due ? (
        <div className="mt-2">
          <SlaTimer label="Conditions due" dueIso={due} />
        </div>
      ) : null}
      <div className="mt-4 grid grid-cols-1 items-end gap-3 border-t border-sg-line pt-4 sm:grid-cols-[1fr_auto]">
        {ini.epicId ? <p className="text-xs text-sg-muted">A delivery epic is already linked.</p> : <JiraProjectSelect value={jiraProjectId} onChange={setJiraProjectId} />}
        <Button
          variant="primary"
          onClick={() => {
            confirmConditions(ini.id, { jiraProjectId: jiraProjectId || undefined });
            notify("Conditions confirmed by the PMO — project code issued");
          }}
        >
          <ShieldCheck /> Confirm conditions met (PMO)
        </Button>
      </div>
    </Card>
  );
}

function DecisionRecord({ ini }: { ini: Initiative }) {
  const userMap = useUserMap();
  const adjustments = useCrm((s) => s.curveAdjustments);
  const econ = useMemo(() => proposalEconomics(ini, adjustments), [ini, adjustments]);
  const deferral = useMemo(() => deferralTriggers(ini, adjustments), [ini, adjustments]);
  const d = ini.decision!;
  const by = userMap.get(d.decidedById);
  const superseded = ini.status === "evaluation";
  return (
    <Card title={superseded ? "Previous decision" : "Decision record"} icon={ClipboardCheck} cite={["4.5", "Annex A"]} actions={<Chip color={outcomeColor[d.outcome]} dot>{outcomeLabel[d.outcome]}</Chip>}>
      {superseded ? <p className="mb-2 text-2xs text-soft-yellow">The appeal was upheld — the proposal returned to evaluation for a fresh decision.</p> : null}
      <div className="space-y-3">
        <div>
          <div className="sg-eyebrow mb-1">Reasons</div>
          <p className="whitespace-pre-wrap text-sm text-sg-text">{d.rationale || "—"}</p>
        </div>
        {d.conditions ? (
          <div>
            <div className="sg-eyebrow mb-1">Conditions</div>
            <p className="whitespace-pre-wrap text-sm text-sg-text">{d.conditions}</p>
            {d.conditionsDueAt ? <p className="mt-0.5 text-2xs text-sg-muted">Due {formatDate(d.conditionsDueAt, "medium")}</p> : null}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-x-6 border-t border-sg-line pt-2 sm:grid-cols-4">
          <KV label="For">
            <span className="sg-num text-soft-green">{d.votesFor}</span>
          </KV>
          <KV label="Against">
            <span className="sg-num text-soft-red">{d.votesAgainst}</span>
          </KV>
          <KV label="CEO veto">{d.ceoVeto ? <span className="text-soft-red">Yes</span> : "No"}</KV>
          <KV label="High risk">{ini.highRisk ? <span className="text-soft-orange">Yes</span> : "No"}</KV>
        </div>
        {d.outcome === "approved" || d.outcome === "conditional" ? (
          <div className="grid grid-cols-1 gap-x-6 border-t border-sg-line pt-2 sm:grid-cols-2">
            <KV label="Type · x · rate">
              <span className="sg-num">
                {ini.type} · <Money value={econ.rate.x} /> · <Rate value={econ.rate.rate} />
              </span>
            </KV>
            <KV label="Rate basis">{rateSourceLabel(econ.rate.source)}</KV>
            <KV label="Deferral applied">{deferral.length ? `${Math.round((ini.deferralPct ?? POLICY.deferral.defaultPct) * 100)}% for ${ini.deferralMonths} months after close` : "None"}</KV>
            {ini.type === "C" ? <KV label="Standard bonus approved">{formatIDR(standardBonusOf(ini), "full")} a month</KV> : null}
          </div>
        ) : null}
        <div className="flex items-center gap-2 text-2xs text-sg-muted">
          <Avatar user={by} size="xs" /> Decided by {by?.name ?? d.decidedById} · {formatDate(d.decidedAt, "datetime")}
          {ini.code ? (
            <span>
              · project code <span className="sg-num font-semibold text-sg-white">{ini.code}</span>
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/* ───────────── (d) appeals ───────────── */

function AppealCard({ ini }: { ini: Initiative }) {
  const fileAppeal = useCrm((s) => s.fileAppeal);
  const resolveAppeal = useCrm((s) => s.resolveAppeal);
  const currentUserId = useCrm((s) => s.currentUserId);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const me = userMap.get(currentUserId);

  const appealable = (ini.status === "rejected" || ini.status === "conditional") && !!ini.decision;
  if (!ini.appeal && !appealable) return null;

  if (!ini.appeal) {
    const deadline = addBusinessDays(ini.decision!.decidedAt, POLICY.sla.appealBusinessDays);
    const open = Date.now() <= Date.parse(deadline);
    const submit = () => {
      if (!open || !reason.trim()) return;
      fileAppeal(ini.id, reason.trim());
      setReason("");
      notify("Appeal filed with the Executive Committee");
    };
    return (
      <Card title="Appeal" icon={Scale} cite="4.6">
        <p className="text-xs text-sg-muted">
          The proposer may appeal a {ini.status === "rejected" ? "rejection" : "condition"} within 10 business days. The appeal must bring new information or show a procedural error; the Executive Committee decides within 10 business days and its decision is final within the company.
        </p>
        <div className="mt-2">
          <SlaTimer label="Appeal window closes" dueIso={deadline} />
        </div>
        {open ? (
          <div className="mt-3 space-y-2" onKeyDown={onCmdEnter(submit)}>
            <Field label="Grounds for appeal (required)">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="New information, procedural concerns, or why the PRC’s assessment should be revisited…" className="min-h-[64px]" />
            </Field>
            <div className="flex justify-end">
              <Button variant="primary" onClick={submit} disabled={!reason.trim()}>
                <Scale /> File appeal
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-sg-line px-3 py-2">
            <span className="text-xs text-sg-muted">The 10-business-day window closed on {formatDate(deadline, "medium")} — the decision is final.</span>
            <Button variant="subtle" size="sm" disabled>
              <Scale /> File appeal
            </Button>
          </div>
        )}
      </Card>
    );
  }

  const a = ini.appeal;
  const due = addBusinessDays(a.filedAt, POLICY.sla.appealBusinessDays);
  const filer = userMap.get(a.filedById);
  return (
    <Card
      title="Appeal to the Executive Committee"
      icon={Scale}
      cite="4.6"
      actions={
        <Chip color={a.status === "pending" ? "yellow" : a.status === "upheld" ? "green" : "red"} dot>
          {a.status === "pending" ? "Pending" : a.status === "upheld" ? "Upheld" : "Denied"}
        </Chip>
      }
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-2xs text-sg-muted">
          <Avatar user={filer} size="xs" /> Filed by {filer?.name ?? a.filedById} · {formatDate(a.filedAt, "datetime")}
        </div>
        <p className="whitespace-pre-wrap text-sm text-sg-text">{a.reason}</p>
        {a.status === "pending" ? (
          <SlaTimer label="Committee decision due" dueIso={due} />
        ) : (
          <div className="border-t border-sg-line pt-2">
            <div className="sg-eyebrow mb-1">Resolution · {formatDate(a.decidedAt, "medium")}</div>
            <p className="whitespace-pre-wrap text-sm text-sg-text">{a.notes || <span className="text-sg-dim">No notes.</span>}</p>
            <p className="mt-1 text-2xs text-sg-dim">{a.status === "upheld" ? "The proposal returned to detailed evaluation for a new PRC decision." : "The original PRC decision stands."}</p>
          </div>
        )}
      </div>
      {a.status === "pending" ? (
        <div className="mt-3 space-y-2 border-t border-sg-line pt-3">
          <Field label="Executive Committee notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Resolution and reasoning" className="min-h-[56px]" />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-2xs text-sg-dim">
              <Hourglass className="size-3" /> Recorded by {me?.name ?? currentUserId} on behalf of the Executive Committee
            </span>
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={() => {
                  resolveAppeal(ini.id, "denied", notes.trim());
                  notify("Appeal denied — PRC decision stands");
                }}
              >
                Deny appeal
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  resolveAppeal(ini.id, "upheld", notes.trim());
                  notify("Appeal upheld — proposal returned to evaluation");
                }}
              >
                Uphold appeal
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
