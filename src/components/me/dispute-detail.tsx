"use client";

/* /disputes/[id] — one §14 dispute: what is disputed, the stage stepper with business-day deadlines, the action for
 * the current user (propose / accept / escalate / vote / decide / appeal / withdraw), recusal and the audit trail. */
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Check, CircleAlert, Gavel, MessageSquare, Scale, Send, Undo2, UserMinus, UserPlus, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import { POLICY } from "@/lib/initiatives/policy";
import type { DisputeStage } from "@/lib/initiatives/types";
import {
  DISPUTE_CATEGORY_META,
  DISPUTE_OUTCOME_LABEL,
  DISPUTE_STAGE_META,
  canSeeDispute,
  disputeTally,
  disputeTimeLimit,
  isDisputeAdmin,
  isExcoMember,
  isPrcMember,
} from "@/lib/slices/program-extras";
import { cn, formatDate, formatIDR, relativeTime } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Avatar, Chip, EmptyState } from "@/components/ui/misc";
import { Cite } from "@/components/initiatives/shared";
import { DisputeSlaChip, DisputeStageChip, parseRupiah } from "./disputes";
import { cycleLabel } from "./helpers";
import { Card, RpFull } from "./ui";

type Outcome = "upheld" | "partially_upheld" | "rejected";
const STEPS: DisputeStage[] = ["direct", "prc", "exco"];

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,40%)_1fr] gap-x-3 gap-y-1.5 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-sg-dim">{k}</dt>
          <dd className="text-sg-text">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function DecisionForm({ allowed, submitLabel, onSubmit, showAmounts }: { allowed: Outcome[]; submitLabel: string; onSubmit: (o: { outcome: Outcome; text: string; correction: number | null }) => void; showAmounts: boolean }) {
  const [outcome, setOutcome] = useState<Outcome>(allowed[0]);
  const [text, setText] = useState("");
  const [corr, setCorr] = useState("");
  const correction = parseRupiah(corr);
  const bad = corr.trim() !== "" && correction == null;
  const ok = text.trim().length >= 5 && !bad && allowed.includes(outcome);
  return (
    <div
      className="space-y-2"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ok) {
          e.preventDefault();
          onSubmit({ outcome, text, correction: outcome === "rejected" ? null : correction });
        }
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Outcome">
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>
            {allowed.map((o) => (
              <option key={o} value={o}>
                {DISPUTE_OUTCOME_LABEL[o]}
              </option>
            ))}
          </Select>
        </Field>
        {outcome !== "rejected" && showAmounts && (
          <Field label="Correction to pay (optional)" hint={bad ? "Use digits, e.g. 1.250.000" : correction ? `${formatIDR(correction, "full")} — paid in the next open cycle (§8.5)` : "Underpayment corrected next cycle (§8.5)"}>
            <Input value={corr} onChange={(e) => setCorr(e.target.value)} inputMode="numeric" placeholder="Rp" className={cn(bad && "border-soft-red")} />
          </Field>
        )}
      </div>
      <Field label="Reasons (shared with the employee)">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[64px]" />
      </Field>
      <div className="flex justify-end">
        <Button size="sm" variant="primary" disabled={!ok} onClick={() => onSubmit({ outcome, text, correction: outcome === "rejected" ? null : correction })}>
          <Gavel /> {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function ReasonAction({ label, placeholder, icon: Icon, variant = "outline", onSubmit, required = true }: { label: string; placeholder: string; icon: React.ComponentType<{ className?: string }>; variant?: "outline" | "primary" | "danger" | "ghost"; onSubmit: (reason: string) => void; required?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        <Icon /> {label}
      </Button>
    );
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1" onKeyDown={(e) => e.key === "Escape" && setOpen(false)} />
      <Button
        size="sm"
        variant={variant === "ghost" ? "outline" : variant}
        disabled={required && reason.trim().length < 5}
        onClick={() => {
          onSubmit(reason);
          setOpen(false);
          setReason("");
        }}
      >
        <Icon /> {label}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)} aria-label="Cancel">
        <X />
      </Button>
    </div>
  );
}

export function DisputeDetail({ id }: { id: string }) {
  const d = useCrm((s) => s.disputes.find((x) => x.id === id));
  const users = useCrm((s) => s.users);
  const initiatives = useCrm((s) => s.initiatives);
  const profiles = useCrm((s) => s.employeeProfiles);
  const members = useCrm((s) => s.initiativeMembers);
  const access = useAccess();
  const a = useCrm.getState;
  const notify = useUi((s) => s.notify);
  const [comment, setComment] = useState("");
  const [onBehalf, setOnBehalf] = useState("");
  const [addRecusal, setAddRecusal] = useState("");

  const name = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? uid ?? "—";
  const me = access.userId;

  const tally = useMemo(() => (d && (d.stage === "prc" || d.stage === "exco") ? disputeTally(d, d.stage, profiles) : null), [d, profiles]);

  if (!d || !canSeeDispute(d, me, profiles)) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader title="Dispute" crumbs={[{ href: "/disputes", label: "Disputes" }]} />
        <EmptyState icon={Scale} title={d ? "Restricted" : "Dispute not found"} action={<Link href="/disputes" className="text-xs text-soft-cyan hover:underline">Back to disputes</Link>}>
          {d ? "Disputes are visible to the employee who raised them, the handler, and Finance, HR, the PRC and the Executive Committee (§13.4)." : "It may have been removed, or the link is wrong."}
        </EmptyState>
      </div>
    );
  }

  const ini = initiatives.find((i) => i.id === d.initiativeId);
  const raiser = users.find((u) => u.id === d.raisedById);
  const isRaiser = d.raisedById === me;
  const isHandler = d.handlerId === me;
  const admin = isDisputeAdmin(me, profiles);
  const showAmounts = access.seePayOf(d.raisedById);
  const stage = d.stage;
  const member = stage === "prc" ? isPrcMember(me, profiles) : stage === "exco" ? isExcoMember(me, profiles) : false;
  const recusedMe = d.involvedIds.includes(me);
  const canDecideHere = member && !recusedMe;
  const appealOpen = stage === "closed" && !!d.prcDecision && !d.excoDecision && Date.parse(d.prcDecision.appealBy) >= Date.now() && (isRaiser || isHandler || d.involvedIds.includes(me));
  const finance = access.roles.includes("finance") || access.roles.includes("cfo");
  const handlers = profiles.filter((p) => p.userId !== d.raisedById && (p.governanceRoles.length > 0 || initiatives.some((i) => i.id === d.initiativeId))).map((p) => p.userId);
  const leadIds = members.filter((m) => m.initiativeId === d.initiativeId && m.roles.includes("project_lead")).map((m) => m.userId);
  const handlerOptions = [...new Set([...handlers, ...leadIds])].filter((u) => u !== d.raisedById);
  const run = <T,>(fn: () => T, msg: string) => {
    fn();
    notify(msg);
  };

  const stepState = (s: DisputeStage) => {
    const reached = s === "direct" || d.events.some((e) => (s === "prc" ? e.kind === "escalated" : e.kind === "appealed"));
    const current = stage === s;
    return { reached, current };
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={d.subject} docTitle={`${d.number} · Disputes`} crumbs={[{ href: "/disputes", label: "Disputes" }]} meta={<><span className="sg-num text-xs text-sg-dim">{d.number}</span><DisputeStageChip d={d} /><DisputeSlaChip d={d} /></>}>
        <Link href="/disputes" className="inline-flex items-center gap-1 text-2xs text-sg-dim hover:text-sg-white">
          <ArrowLeft className="size-3.5" /> Queue
        </Link>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <div className="mx-auto grid max-w-[1240px] gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            {/* stepper */}
            <ol className="grid grid-cols-3 gap-2" aria-label="Dispute stages">
              {STEPS.map((s, i) => {
                const st = stepState(s);
                return (
                  <li key={s} aria-current={st.current ? "step" : undefined} className={cn("rounded-lg border px-3 py-2", st.current ? "border-soft-orange/50 bg-soft-orange/[0.06]" : st.reached ? "border-sg-line bg-sg-card" : "border-dashed border-sg-line bg-transparent opacity-60")}>
                    <div className="text-2xs font-semibold uppercase tracking-wider text-sg-dim">
                      Step {i + 2} · {DISPUTE_STAGE_META[s].step}
                    </div>
                    <div className="text-xs font-semibold text-sg-white">{DISPUTE_STAGE_META[s].label}</div>
                    <div className="text-2xs text-sg-dim">{st.current && d.dueAt ? `due ${formatDate(d.dueAt, "medium")}` : st.reached ? "done" : "10 business days"}</div>
                  </li>
                );
              })}
            </ol>

            <Card
              title={
                <>
                  What is disputed <Cite s="14" />
                </>
              }
            >
              <p className="mb-3 whitespace-pre-line text-xs leading-relaxed text-sg-text">{d.detail}</p>
              <Facts
                rows={[
                  ["Employee", <span key="e" className="inline-flex items-center gap-1.5"><Avatar user={raiser} size="xs" /> {raiser?.name ?? d.raisedById}</span>],
                  ["Concerns", `${DISPUTE_CATEGORY_META[d.category].label} — ${DISPUTE_CATEGORY_META[d.category].hint}`],
                  ["Project", ini ? <Link key="p" href={`/initiatives/${ini.id}`} className="text-soft-cyan hover:underline">{ini.code ? `${ini.code} · ` : ""}{ini.title}</Link> : "—"],
                  ...(d.runMonth ? ([["Salary cycle", `${cycleLabel(d.runMonth)}`]] as [string, React.ReactNode][]) : []),
                  ...(d.lineRef ? ([["Source record", <span key="s" className="sg-num text-2xs text-sg-dim">{d.lineRef}</span>]] as [string, React.ReactNode][]) : []),
                  ...(showAmounts && d.amount != null ? ([["Figure on the record", <RpFull key="a" value={d.amount} className="font-semibold text-sg-white" />]] as [string, React.ReactNode][]) : []),
                  ...(showAmounts && d.claimedAmount != null ? ([["Employee says it should be", <RpFull key="c" value={d.claimedAmount} className="font-semibold text-soft-yellow" />]] as [string, React.ReactNode][]) : []),
                  [DISPUTE_CATEGORY_META[d.category].basis === "statement" ? "Statement date" : "Decision / event date", formatDate(d.eventAt, "medium")],
                  ["Raised", `${formatDate(d.raisedAt, "datetime")} WIB · limit ${formatDate(disputeTimeLimit(d.eventAt), "medium")} (${POLICY.statementDisputeDays} days)`],
                  ...(d.late ? ([["Raised late", <span key="l" className="text-soft-orange">{d.lateReason ?? "—"}</span>]] as [string, React.ReactNode][]) : []),
                  ["Direct resolution by", name(d.handlerId)],
                ]}
              />
            </Card>

            {/* actions for the current user */}
            <Card title={<>{stage === "closed" ? "Outcome" : "Next step"}</>}>
              {stage === "direct" && (
                <div className="space-y-3">
                  <p className="text-xs text-sg-muted">
                    The parties, with the Project Lead or Finance as relevant, try to settle it within 10 business days (§14 step 2). If it is not settled, either party escalates to the PRC.
                  </p>
                  {d.proposal && (
                    <div className="rounded-lg border border-soft-cyan/30 bg-soft-cyan/[0.05] px-3 py-2 text-xs">
                      <div className="font-semibold text-sg-white">
                        {name(d.proposal.byId)} proposes: {DISPUTE_OUTCOME_LABEL[d.proposal.outcome].toLowerCase()}
                        {d.proposal.correction && showAmounts ? <> · correction <RpFull value={d.proposal.correction} /></> : null}
                      </div>
                      <p className="mt-0.5 text-sg-text">{d.proposal.text}</p>
                      <div className="mt-0.5 text-2xs text-sg-dim">{relativeTime(d.proposal.at)}</div>
                    </div>
                  )}
                  {isRaiser && d.proposal && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="primary" onClick={() => run(() => a().acceptDisputeProposal(d.id), "Settled — the dispute is closed (§14 step 2)")}>
                        <Check /> Accept the proposal
                      </Button>
                    </div>
                  )}
                  {!isRaiser && (isHandler || admin) && (
                    <div className="rounded-lg border border-sg-line p-3">
                      <div className="sg-eyebrow mb-2">{d.proposal ? "Revise the proposal" : `Propose a resolution${isHandler ? "" : ` (on behalf of ${name(d.handlerId)})`}`}</div>
                      <DecisionForm allowed={["upheld", "partially_upheld", "rejected"]} submitLabel="Send to the employee" showAmounts={showAmounts} onSubmit={(o) => run(() => a().proposeDisputeResolution(d.id, o), "Proposal sent to the employee")} />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {(isRaiser || isHandler || admin) && <ReasonAction label="Escalate to the PRC" placeholder="Why it is not settled" icon={Send} onSubmit={(r) => run(() => a().escalateDispute(d.id, r), "Escalated — the PRC decides within 10 business days (§14 step 3)")} />}
                    {admin && !isRaiser && (
                      <Select aria-label="Reassign the handler" value={d.handlerId ?? ""} onChange={(e) => e.target.value && run(() => a().reassignDispute(d.id, e.target.value), `Handled by ${name(e.target.value)}`)} wrapperClassName="w-52">
                        <option value="">Reassign handler…</option>
                        {handlerOptions.map((u) => (
                          <option key={u} value={u}>
                            {name(u)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                </div>
              )}

              {(stage === "prc" || stage === "exco") && tally && (
                <div className="space-y-3">
                  <p className="text-xs text-sg-muted">
                    {stage === "prc" ? "The PRC decides within 10 business days of escalation; members involved in the dispute are recused (§14 step 3, §13.1)." : "The Executive Committee decides within 10 business days; its decision is final within the company (§14 step 4)."} Decision by majority of the members who are not recused — quorum {tally.quorum} of {tally.eligible.length}.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Chip color="green">{tally.uphold} uphold</Chip>
                    <Chip color="red">{tally.reject} reject</Chip>
                    <span className="text-sg-dim">
                      {tally.cast} of {tally.eligible.length} voted{tally.tied ? " · tied — further votes needed" : tally.result ? ` · majority to ${tally.result}` : ""}
                    </span>
                  </div>
                  {canDecideHere ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => run(() => a().voteDispute(d.id, "uphold"), "Vote recorded: uphold")}>
                          <Check /> Vote to uphold
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => run(() => a().voteDispute(d.id, "reject"), "Vote recorded: reject")}>
                          <X /> Vote to reject
                        </Button>
                        <span className="text-2xs text-sg-dim">Record from the minutes for</span>
                        <Select aria-label="Record a vote for" value={onBehalf} onChange={(e) => setOnBehalf(e.target.value)} wrapperClassName="w-44">
                          <option value="">member…</option>
                          {tally.eligible
                            .filter((u) => u !== me)
                            .map((u) => (
                              <option key={u} value={u}>
                                {name(u)}
                              </option>
                            ))}
                        </Select>
                        {onBehalf && (
                          <>
                            <Button size="xs" variant="ghost" onClick={() => run(() => a().voteDispute(d.id, "uphold", onBehalf), `${name(onBehalf)}: uphold (recorded by you)`)}>
                              uphold
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => run(() => a().voteDispute(d.id, "reject", onBehalf), `${name(onBehalf)}: reject (recorded by you)`)}>
                              reject
                            </Button>
                          </>
                        )}
                      </div>
                      {tally.result ? (
                        <div className="rounded-lg border border-sg-line p-3">
                          <div className="sg-eyebrow mb-2">Record the {stage === "prc" ? "PRC" : "Executive Committee"} decision</div>
                          <DecisionForm
                            key={tally.result}
                            allowed={tally.result === "uphold" ? ["upheld", "partially_upheld"] : ["rejected"]}
                            submitLabel={stage === "prc" ? "Record PRC decision" : "Record final decision"}
                            showAmounts={showAmounts}
                            onSubmit={(o) => run(() => a().decideDispute(d.id, o), stage === "prc" ? "PRC decision recorded — 10 business days to appeal (§14 step 4)" : "Executive Committee decision recorded — final within the company")}
                          />
                        </div>
                      ) : (
                        <p className="flex gap-1.5 text-2xs text-sg-dim">
                          <CircleAlert className="size-3.5 shrink-0" /> The decision can be recorded once a quorum has voted and the vote is not tied.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-2xs text-sg-dim">{member && recusedMe ? "You are recused from deciding this dispute — you are involved in it." : `Waiting for the ${stage === "prc" ? "PRC" : "Executive Committee"}.`}</p>
                  )}
                </div>
              )}

              {stage === "closed" && (
                <div className="space-y-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <DisputeStageChip d={d} />
                    <span className="text-sg-dim">closed {formatDate(d.closedAt, "datetime")} WIB</span>
                  </div>
                  {d.excoDecision && (
                    <p className="text-sg-text">
                      <span className="font-semibold text-sg-white">Executive Committee (final):</span> {d.excoDecision.text} <span className="text-2xs text-sg-dim">— {name(d.excoDecision.byId)}, {formatDate(d.excoDecision.at, "medium")}</span>
                    </p>
                  )}
                  {d.prcDecision && (
                    <p className="text-sg-text">
                      <span className="font-semibold text-sg-white">PRC:</span> {d.prcDecision.text} <span className="text-2xs text-sg-dim">— {name(d.prcDecision.byId)}, {formatDate(d.prcDecision.at, "medium")}</span>
                    </p>
                  )}
                  {d.outcome === "settled" && d.proposal && (
                    <p className="text-sg-text">
                      <span className="font-semibold text-sg-white">Settled directly:</span> {d.proposal.text}
                    </p>
                  )}
                  {d.correction && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sg-line bg-sg-bg/40 px-3 py-2">
                      <span className="text-sg-text">
                        Correction {showAmounts ? <RpFull value={d.correction.amount} className="font-semibold text-soft-green" /> : null} with the {cycleLabel(d.correction.cycle)} salary (§8.5)
                      </span>
                      {d.correction.paidAt ? (
                        <Chip color="green">Paid {formatDate(d.correction.paidAt, "medium")}</Chip>
                      ) : finance ? (
                        <Button size="xs" variant="primary" className="ml-auto" onClick={() => run(() => a().markCorrectionPaid(d.id), "Correction marked as paid")}>
                          <Check /> Mark paid with payroll
                        </Button>
                      ) : (
                        <Chip color="yellow">To be paid</Chip>
                      )}
                    </div>
                  )}
                  {d.prcDecision && !d.excoDecision && (
                    <p className="text-2xs text-sg-dim">
                      {Date.parse(d.prcDecision.appealBy) >= Date.now() ? `Either party may appeal to the Executive Committee until ${formatDate(d.prcDecision.appealBy, "medium")} (§14 step 4).` : "The appeal window has closed — the PRC decision stands."}
                    </p>
                  )}
                  {appealOpen && <ReasonAction label="Appeal to the Executive Committee" placeholder="Grounds for the appeal" icon={Scale} variant="primary" onSubmit={(r) => run(() => a().appealDispute(d.id, r), "Appeal filed — the Executive Committee decides within 10 business days")} />}
                  <p className="text-2xs text-sg-dim">This process does not limit the employee&apos;s rights under Indonesian industrial relations law, including bipartite negotiation (§14).</p>
                </div>
              )}

              {isRaiser && stage !== "closed" && (
                <div className="mt-3 border-t border-sg-line pt-3">
                  <ReasonAction label="Withdraw the dispute" placeholder="Reason (optional)" icon={Undo2} variant="ghost" required={false} onSubmit={(r) => run(() => a().withdrawDispute(d.id, r), "Dispute withdrawn")} />
                </div>
              )}
            </Card>

            {/* thread + audit trail */}
            <Card
              title={
                <>
                  <MessageSquare className="mr-1.5 size-3.5 text-sg-dim" /> Activity and audit trail
                </>
              }
            >
              <ol className="space-y-2.5">
                {d.events.map((e) => (
                  <li key={e.id} className="flex gap-2 text-xs">
                    <Avatar user={users.find((u) => u.id === e.actorId)} size="xs" />
                    <div className="min-w-0 flex-1">
                      <div className="text-2xs text-sg-dim">
                        <span className="font-semibold text-sg-muted">{name(e.actorId)}</span> · {DISPUTE_STAGE_META[e.stage].label} · {formatDate(e.at, "datetime")} WIB
                      </div>
                      <p className={cn("whitespace-pre-line", e.kind === "comment" ? "text-sg-text" : "font-semibold text-sg-white")}>{e.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-3 flex items-end gap-2 border-t border-sg-line pt-3">
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add a comment or evidence (⌘/Ctrl+Enter to post)"
                  aria-label="Comment"
                  className="min-h-[56px] flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && comment.trim()) {
                      e.preventDefault();
                      a().commentDispute(d.id, comment);
                      setComment("");
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!comment.trim()}
                  onClick={() => {
                    a().commentDispute(d.id, comment);
                    setComment("");
                  }}
                >
                  <Send /> Post
                </Button>
              </div>
            </Card>
          </div>

          {/* parties, body, recusal */}
          <div className="space-y-4">
            <Card title={<>Parties &amp; recusal</>}>
              <div className="sg-eyebrow mb-1">Involved — recused from deciding</div>
              <ul className="space-y-1">
                {d.involvedIds.map((u) => (
                  <li key={u} className="flex items-center gap-1.5 text-xs text-sg-text">
                    <Avatar user={users.find((x) => x.id === u)} size="xs" /> {name(u)}
                    {u === d.raisedById && <span className="text-2xs text-sg-dim">employee</span>}
                    {u !== d.raisedById && admin && stage !== "closed" && (
                      <button type="button" className="ml-auto rounded p-0.5 text-sg-dim hover:text-sg-white" aria-label={`Remove recusal of ${name(u)}`} title="Not involved — remove recusal" onClick={() => run(() => a().setDisputeRecusal(d.id, u, false), `${name(u)} no longer recused`)}>
                        <UserMinus className="size-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {admin && stage !== "closed" && (
                <div className="mt-2 flex items-center gap-2">
                  <Select aria-label="Recuse a member" value={addRecusal} onChange={(e) => setAddRecusal(e.target.value)} wrapperClassName="flex-1">
                    <option value="">Recuse someone (conflict found)…</option>
                    {profiles
                      .filter((p) => (isPrcMember(p.userId, profiles) || isExcoMember(p.userId, profiles)) && !d.involvedIds.includes(p.userId))
                      .map((p) => (
                        <option key={p.userId} value={p.userId}>
                          {name(p.userId)}
                        </option>
                      ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!addRecusal}
                    onClick={() => {
                      a().setDisputeRecusal(d.id, addRecusal, true);
                      notify(`${name(addRecusal)} recused`);
                      setAddRecusal("");
                    }}
                  >
                    <UserPlus /> Recuse
                  </Button>
                </div>
              )}
              {(["prc", "exco"] as const).map((b) => {
                const t = disputeTally(d, b, profiles);
                return (
                  <div key={b} className="mt-3">
                    <div className="sg-eyebrow mb-1">{b === "prc" ? "PRC" : "Executive Committee"}</div>
                    <ul className="space-y-1">
                      {[...t.eligible, ...t.recused].map((u) => {
                        const v = d.votes.find((x) => x.stage === b && x.userId === u);
                        const rec = t.recused.includes(u);
                        return (
                          <li key={u} className={cn("flex items-center gap-1.5 text-xs", rec ? "text-sg-dim line-through" : "text-sg-text")}>
                            <Avatar user={users.find((x) => x.id === u)} size="xs" /> {name(u)}
                            <span className="ml-auto text-2xs no-underline">
                              {rec ? (
                                <span className="inline-flex items-center gap-0.5">
                                  <Ban className="size-3" /> recused
                                </span>
                              ) : v ? (
                                <span className={v.vote === "uphold" ? "text-soft-green" : "text-soft-red"}>{v.vote}</span>
                              ) : stage === b ? (
                                "not voted"
                              ) : (
                                ""
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </Card>
            <Card title={<>The §14 process</>}>
              <ol className="list-decimal space-y-1 pl-4 text-2xs leading-relaxed text-sg-muted">
                <li>Raise it within {POLICY.statementDisputeDays} days of the statement date (calculation, ledger) or of the decision or event.</li>
                <li>Try to resolve it directly within 10 business days.</li>
                <li>Escalate to the PRC, which decides within 10 business days; members involved are recused.</li>
                <li>Either party may appeal to the Executive Committee within 10 business days; it decides within 10 business days, final within the company.</li>
              </ol>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

