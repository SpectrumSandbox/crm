"use client";

import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Ban, ClipboardCheck, ClipboardList, Gavel, Hourglass, ListChecks, Scale, Search, ShieldCheck, SlidersHorizontal, UserCheck } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { DecisionOutcome, Initiative, PrcScores } from "@/lib/initiatives/types";
import { addBusinessDays, capacityCheck, deferralTriggers, isLiveMember, participationEligibility, proposalEconomics, proposalGaps } from "@/lib/initiatives/engine";
import { POLICY, ROLE_META } from "@/lib/initiatives/policy";
import { cn, formatDate, fromDateInput, toDateInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Avatar, Chip } from "@/components/ui/misc";
import { Cite, Money, Pct } from "@/components/initiatives/shared";
import { Card, CheckRow, KV, SlaTimer, onCmdEnter } from "./ui";

const CRITERIA: { key: keyof Omit<PrcScores, "notes">; label: string; hint: string }[] = [
  { key: "feasibility", label: "Technical feasibility", hint: "Can the team deliver the scope with the proposed approach?" },
  { key: "profitability", label: "Profitability", hint: "Margin after costs, taxes and the bonus pool" },
  { key: "resources", label: "Resource availability", hint: "People, capacity and equipment without starving other work" },
  { key: "strategic", label: "Strategic alignment", hint: "Fit with company capabilities and direction" },
  { key: "risk", label: "Risk profile", hint: "5 = low, well-mitigated risk · 1 = high, unmitigated" },
];

const OUTCOMES: { value: DecisionOutcome; label: string; hint: string; color: "green" | "orange" | "red" | "yellow" }[] = [
  { value: "approved", label: "Full approval", hint: "Project code, budget and team formation", color: "green" },
  { value: "conditional", label: "Conditional approval", hint: "Proceeds once stated conditions are met", color: "orange" },
  { value: "rejected", label: "Rejection", hint: "With rationale; appeal possible within 10 business days", color: "red" },
  { value: "deferred", label: "Deferral", hint: "More information or better timing needed", color: "yellow" },
];

const outcomeColor: Record<DecisionOutcome, "green" | "orange" | "red" | "yellow"> = { approved: "green", conditional: "orange", rejected: "red", deferred: "yellow" };
const outcomeLabel: Record<DecisionOutcome, string> = { approved: "Full approval", conditional: "Conditional approval", rejected: "Rejected", deferred: "Deferred" };

export function PrcTab({ ini }: { ini: Initiative }) {
  if (ini.status === "draft") {
    return (
      <Card title="PRC review" icon={Gavel} cite="2.3">
        <p className="text-sm text-sg-muted">This proposal has not been submitted yet. Once submitted, the PRC acknowledges it within 1 business day, screens it, evaluates it against five criteria and records a decision within 5 business days.</p>
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
        <Card title="Automated checks" icon={ListChecks} cite="2.3.3">
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
    <Card title="Screening" icon={Search} cite="2.3.2">
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
          <p className="mb-2 text-xs text-sg-muted">The PRC Secretary checks completeness and eligibility, issues the tracking number and assigns a primary reviewer from the PRC.</p>
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
          <p className="flex-1 text-xs text-sg-muted">Screening complete? Move the proposal into detailed evaluation (Day 2–5).</p>
          <Button
            variant="primary"
            onClick={() => {
              startEvaluation(ini.id);
              notify("Detailed evaluation started");
            }}
          >
            <ClipboardCheck /> Start detailed evaluation
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
      cite="2.3.3"
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
            {notYet ? " · scoring opens when detailed evaluation starts" : !editable ? " · scorecard is locked after the decision" : ""}
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
  const adjustments = useCrm((s) => s.shareAdjustments);
  const userMap = useUserMap();

  const data = useMemo(() => {
    const gaps = proposalGaps(ini, members);
    const team = members.filter((m) => m.initiativeId === ini.id && isLiveMember(m));
    const eligibility = team.map((m) => ({ m, r: participationEligibility(profiles.find((p) => p.userId === m.userId)) }));
    const leads = team.filter((m) => m.roles.some((r) => ROLE_META[r].leadership)).map((m) => ({ m, c: capacityCheck(m.userId, ini, m.roles, initiatives, members) }));
    const econ = proposalEconomics(ini, adjustments, ini.approvedAt ?? new Date().toISOString());
    const deferral = deferralTriggers(ini, adjustments);
    return { gaps, eligibility, leads, econ, deferral };
  }, [ini, members, initiatives, profiles, adjustments]);

  const ineligible = data.eligibility.filter((e) => !e.r.ok);
  const warned = data.eligibility.filter((e) => e.r.ok && e.r.warnings.length);
  const breaches = data.leads.filter((l) => !l.c.ok);
  const margin = data.econ.expected.marginPct;

  return (
    <div className="divide-y divide-sg-line/60">
      <CheckRow ok={data.gaps.length === 0} title={data.gaps.length ? `Proposal completeness — ${data.gaps.length} gap${data.gaps.length === 1 ? "" : "s"}` : "Proposal complete"}>
        {data.gaps.length ? (
          <ul className="list-disc pl-4">
            {data.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        ) : (
          <>
            All required sections present <Cite s="2.2" />
          </>
        )}
      </CheckRow>

      <CheckRow ok={ineligible.length === 0} warn={warned.length > 0} title={ineligible.length ? `Team eligibility — ${ineligible.length} not eligible` : `Team eligibility — ${data.eligibility.length} member${data.eligibility.length === 1 ? "" : "s"} eligible`}>
        {data.eligibility.length === 0 ? "No team members proposed." : null}
        <ul className="mt-0.5 space-y-1">
          {data.eligibility.map(({ m, r }) => (
            <li key={m.id} className="flex items-start gap-1.5">
              <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", !r.ok ? "bg-soft-red" : r.warnings.length ? "bg-soft-yellow" : "bg-soft-green")} />
              <span>
                <span className="text-sg-text">{userMap.get(m.userId)?.name ?? m.userId}</span>
                {r.blockers.length ? <span className="text-soft-red"> — {r.blockers.join("; ")}</span> : null}
                {r.warnings.length ? <span className="text-soft-yellow"> — {r.warnings.join("; ")}</span> : null}
              </span>
            </li>
          ))}
        </ul>
        <Cite s="2.1" />
      </CheckRow>

      <CheckRow ok={breaches.length === 0} title={breaches.length ? `Leadership capacity — ${breaches.length} breach${breaches.length === 1 ? "" : "es"}` : "Leadership capacity within 2.0"}>
        {data.leads.length === 0 ? "No leads assigned." : null}
        <ul className="mt-0.5 space-y-0.5">
          {data.leads.map(({ m, c }) => (
            <li key={m.id}>
              <span className="text-sg-text">{userMap.get(m.userId)?.name ?? m.userId}</span>:{" "}
              <span className={cn("sg-num", c.ok ? "text-sg-muted" : "text-soft-red")}>
                {c.before.toFixed(2)} + {c.adds.toFixed(2)} = {c.after.toFixed(2)} / {POLICY.leadershipCapacity.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
        <Cite s="5.1" />
      </CheckRow>

      <CheckRow ok={data.econ.expected.pool > 0 && margin > 0} warn={margin > 0 && margin < 0.1} title={`Profitability — expected company margin ${Math.round(margin * 1000) / 10}%`}>
        Expected P <Money value={data.econ.expected.net} /> · pool <Money value={data.econ.expected.pool} /> at <Pct value={data.econ.share} /> · company keeps <Money value={data.econ.expected.companyMargin} />.
        {data.econ.expected.pool <= 0 ? <span className="text-soft-red"> No bonus pool in the expected case.</span> : null}
        {data.econ.worst.net < 0 ? <span className="text-soft-orange"> Worst case is loss-making.</span> : null}
        <Cite s="3.4" />
      </CheckRow>

      <CheckRow ok warn={data.deferral.length > 0} title={data.deferral.length ? `Deferral triggers — 30% deferred ${ini.deferralMonths || POLICY.deferral.minMonths} months` : "No deferral triggers"}>
        {data.deferral.length ? data.deferral.join("; ") : "Bonuses pay in full on schedule."} <Cite s="6.3" />
      </CheckRow>
    </div>
  );
}

/* ───────────── (c) decision ───────────── */

function JiraProjectSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const projects = useCrm((s) => s.projects);
  return (
    <Field label="Jira project for the delivery epic" hint="Creates an epic and a kickoff task with Finance & PMO (§2.3.6).">
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

function DecisionForm({ ini }: { ini: Initiative }) {
  const decideInitiative = useCrm((s) => s.decideInitiative);
  const profiles = useCrm((s) => s.employeeProfiles);
  const currentUserId = useCrm((s) => s.currentUserId);
  const projects = useCrm((s) => s.projects);
  const adjustments = useCrm((s) => s.shareAdjustments);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const me = userMap.get(currentUserId);
  const isCeo = !!profiles.find((p) => p.userId === currentUserId)?.governanceRoles?.includes("ceo");

  const [outcome, setOutcome] = useState<DecisionOutcome>("approved");
  const [rationale, setRationale] = useState("");
  const [conditions, setConditions] = useState("");
  const [conditionsDue, setConditionsDue] = useState(() => toDateInput(addBusinessDays(new Date().toISOString(), 10)));
  const [votesFor, setVotesFor] = useState("3");
  const [votesAgainst, setVotesAgainst] = useState("0");
  const [veto, setVeto] = useState(false);
  const [highRisk, setHighRisk] = useState(ini.highRisk);
  const [deferralMonths, setDeferralMonths] = useState(Math.min(POLICY.deferral.maxMonths, Math.max(POLICY.deferral.minMonths, ini.deferralMonths || POLICY.deferral.minMonths)));
  const [jiraProjectId, setJiraProjectId] = useState(() => projects[0]?.id ?? "");
  const [tried, setTried] = useState(false);

  const effective: DecisionOutcome = veto ? "rejected" : outcome;
  const otherTriggers = useMemo(() => deferralTriggers({ ...ini, highRisk: false }, adjustments), [ini, adjustments]);
  const willDefer = highRisk || otherTriggers.length > 0;

  const errors: string[] = [];
  if (!rationale.trim()) errors.push("Rationale is required");
  if (effective === "conditional" && !conditions.trim()) errors.push("State the conditions for conditional approval");
  if (effective === "conditional" && !conditionsDue) errors.push("Set a due date for the conditions");
  const vf = Math.max(0, Math.floor(Number(votesFor) || 0));
  const va = Math.max(0, Math.floor(Number(votesAgainst) || 0));
  const voteMismatch = !veto && (effective === "approved" || effective === "conditional") && va >= vf;

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
      { jiraProjectId: effective === "approved" && jiraProjectId ? jiraProjectId : undefined, highRisk, deferralMonths },
    );
    notify(veto ? "CEO veto recorded — proposal rejected" : `PRC decision recorded: ${outcomeLabel[effective]}`);
  };

  return (
    <Card title="PRC decision" icon={Gavel} cite="2.3.4">
      <div className="space-y-4" onKeyDown={onCmdEnter(submit)}>
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

        <Field label="Rationale (required)">
          <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why the PRC reached this decision — recorded in the minutes and shared with the initiator." className={cn(tried && !rationale.trim() && "border-soft-red/60")} />
        </Field>

        {effective === "conditional" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
            <Field label="Conditions (required)">
              <Textarea value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="e.g. Signed LOI from the client; revised cost estimate with subcontractor quote" className={cn("min-h-[64px]", tried && !conditions.trim() && "border-soft-red/60")} />
            </Field>
            <Field label="Conditions due">
              <Input type="date" value={conditionsDue} onChange={(e) => setConditionsDue(e.target.value)} className={cn(tried && !conditionsDue && "border-soft-red/60")} />
            </Field>
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
                <Ban className="size-3.5" /> CEO veto — forces rejection <Cite s="2.3.4" />
              </label>
            ) : (
              <span className="text-2xs text-sg-dim">Only the CEO may exercise a veto.</span>
            )}
          </div>
        </div>
        {voteMismatch ? <p className="-mt-2 text-2xs text-soft-yellow">Votes against are not fewer than votes for — check the tally before recording an approval.</p> : null}

        <div className="rounded-md border border-sg-line p-3">
          <div className="sg-eyebrow mb-2 flex items-center">
            PRC risk classification <Cite s="6.3" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-sg-text">
              <input type="checkbox" checked={highRisk} onChange={(e) => setHighRisk(e.target.checked)} className="accent-white" />
              High technical / execution risk
            </label>
            <label className="flex items-center gap-2 text-xs text-sg-muted">
              Deferral period
              <Select value={String(deferralMonths)} onChange={(e) => setDeferralMonths(Number(e.target.value))} wrapperClassName="w-28" className="h-7 text-xs">
                {Array.from({ length: POLICY.deferral.maxMonths - POLICY.deferral.minMonths + 1 }, (_, i) => POLICY.deferral.minMonths + i).map((n) => (
                  <option key={n} value={n}>
                    {n} months
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <p className="mt-2 text-2xs text-sg-dim">
            {willDefer
              ? `30% of each bonus will be deferred for ${deferralMonths} months${otherTriggers.length ? ` (also triggered by: ${otherTriggers.join("; ")})` : ""}.`
              : "No deferral will apply unless classified high risk."}
          </p>
        </div>

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
  const [jiraProjectId, setJiraProjectId] = useState(() => (ini.epicId ? "" : projects[0]?.id ?? ""));
  const due = ini.decision?.conditionsDueAt;

  return (
    <Card title="Conditions for approval" icon={BadgeCheck} cite="2.3.4">
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
            notify("Conditions confirmed — project approved");
          }}
        >
          <ShieldCheck /> Confirm conditions met
        </Button>
      </div>
    </Card>
  );
}

function DecisionRecord({ ini }: { ini: Initiative }) {
  const userMap = useUserMap();
  const d = ini.decision!;
  const by = userMap.get(d.decidedById);
  const superseded = ini.status === "evaluation";
  return (
    <Card title={superseded ? "Previous decision" : "Decision record"} icon={ClipboardCheck} cite="2.3.4" actions={<Chip color={outcomeColor[d.outcome]} dot>{outcomeLabel[d.outcome]}</Chip>}>
      {superseded ? <p className="mb-2 text-2xs text-soft-yellow">The appeal was upheld — the proposal returned to evaluation for a fresh decision.</p> : null}
      <div className="space-y-3">
        <div>
          <div className="sg-eyebrow mb-1">Rationale</div>
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
          <KV label="High risk">{ini.highRisk ? <span className="text-soft-orange">Yes · {ini.deferralMonths}m</span> : "No"}</KV>
        </div>
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
      <Card title="Appeal" icon={Scale} cite="2.3.7">
        <p className="text-xs text-sg-muted">
          The initiator may appeal a {ini.status === "rejected" ? "rejection" : "conditional approval"} to the Executive Committee within 10 business days of the decision. The Committee decides within 10 business days.
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
      cite="2.3.7"
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
