"use client";

/*
 * §9.4 clawbacks: Finance identifies → PRC majority decision → written notice → 10-business-day dispute window →
 * recovery in order (deferred & carried forward → future project bonuses → salary with written agreement) → closed.
 */
import { useMemo, useState } from "react";
import { Check, FileText, Gavel, Plus, Receipt, ShieldAlert, Undo2 } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { Clawback, ClawbackTrigger, DeferredBonus, EmployeeProfile } from "@/lib/initiatives/types";
import { addBusinessDays, addMonths, carriedForward, clawbackAmount, clawbackExempt, clawbackSchedule, deferralVestDate, paymentDate } from "@/lib/initiatives/engine";
import { POLICY } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR, fromDateInput, toDateInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Chip, EmptyState } from "@/components/ui/misc";
import { Modal } from "@/components/ui/overlays";
import { Cite, Metric, Money } from "@/components/initiatives/shared";
import { Callout, InitiativeLink, NOT_CLAWBACK, Panel, UserCell, dueText, monthLabel, parseAmount, tdCls, tdNum, thCls, thRight, triggerMeta, useInitiativeMap } from "./common";

const STEPS = [
  { key: "identified", label: "Identified" },
  { key: "prc_approved", label: "PRC decided" },
  { key: "notified", label: "Notice sent" },
  { key: "disputed", label: "Disputed" },
  { key: "recovering", label: "Recovering" },
  { key: "closed", label: "Closed" },
] as const;

const appendNote = (c: Clawback, text: string) => `${c.notes}${c.notes ? "\n" : ""}${new Date().toISOString().slice(0, 10)} · ${text}`;

function stepIndex(c: Clawback) {
  switch (c.status) {
    case "identified":
      return 0;
    case "prc_approved":
      return c.notifiedAt ? 2 : 1;
    case "disputed":
      return 3;
    case "recovering":
      return 4;
    case "closed":
      return 5;
    default:
      return -1;
  }
}

function Stepper({ c }: { c: Clawback }) {
  if (c.status === "waived")
    return (
      <Chip color="blue" dot>
        Not pursued
      </Chip>
    );
  const idx = stepIndex(c);
  const disputed = c.status === "disputed" || /disputed by employee/i.test(c.notes);
  return (
    <ol className="flex flex-wrap items-center gap-1">
      {STEPS.map((s, i) => {
        if (s.key === "disputed" && !disputed && idx !== 3) return null;
        const done = i < idx;
        const current = i === idx;
        return (
          <li key={s.key} className="flex items-center gap-1">
            <span className={cn("inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-2xs font-semibold ring-1 ring-inset", current ? "bg-sg-white text-sg-bg ring-sg-white" : done ? "bg-soft-green/15 text-soft-green ring-soft-green/30" : "text-sg-dim ring-sg-line")}>
              {done ? <Check className="size-3" /> : null}
              {s.label}
            </span>
            {i < STEPS.length - 1 ? <span className="text-sg-dim">›</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** §9.4 order of recovery: what is available from each source for this employee. */
function useRecoverySources(userId: string) {
  const deferred = useCrm((s) => s.deferredBonuses);
  const bonusRuns = useCrm((s) => s.bonusRuns);
  return useMemo(() => {
    const pending = deferred.filter((d) => d.userId === userId && d.status === "pending");
    const carried = carriedForward(bonusRuns, "9999-12").filter((c) => c.userId === userId);
    return { pending, deferredTotal: pending.reduce((s, d) => s + d.amount, 0), carried, carriedTotal: carried.reduce((s, c) => s + c.amount, 0) };
  }, [deferred, bonusRuns, userId]);
}

export function ClawbacksTab() {
  const clawbacks = useCrm((s) => s.clawbacks);
  const profiles = useCrm((s) => s.employeeProfiles);
  const updateClawback = useCrm((s) => s.updateClawback);
  const notify = useUi((s) => s.notify);
  const [creating, setCreating] = useState(false);
  const [modal, setModal] = useState<{ kind: "decide" | "dispute" | "disputeDecision" | "recover"; c: Clawback } | null>(null);

  const rows = useMemo(() => [...clawbacks].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [clawbacks]);
  const stats = useMemo(() => {
    const open = clawbacks.filter((c) => !["closed", "waived"].includes(c.status));
    return {
      open: open.length,
      outstanding: open.reduce((s, c) => s + Math.max(0, clawbackAmount(c) - c.recovered), 0),
      recovered: clawbacks.reduce((s, c) => s + c.recovered, 0),
      waived: clawbacks.filter((c) => c.status === "waived").reduce((s, c) => s + clawbackAmount(c), 0),
    };
  }, [clawbacks]);

  const set = (c: Clawback, patch: Partial<Clawback>, msg: string) => {
    updateClawback(c.id, patch);
    notify(msg);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-sg-line bg-sg-card px-4 py-3">
        <Metric label="Open cases" value={String(stats.open)} tone={stats.open ? "orange" : undefined} />
        <Metric label="Outstanding" value={formatIDR(stats.outstanding)} tone={stats.outstanding ? "red" : undefined} />
        <Metric label="Recovered" value={formatIDR(stats.recovered)} tone="green" />
        <Metric label="Not pursued" value={formatIDR(stats.waived)} />
        <div className="ml-auto flex items-center gap-3">
          <p className="max-w-sm text-2xs text-sg-dim">
            Within {POLICY.clawback.windowMonths} months of payment, for a revenue reversal, proven misconduct or a data error only. Never for {NOT_CLAWBACK.slice(0, 5).join(", ")} <Cite s="9.4" />.
          </p>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus /> New clawback
          </Button>
        </div>
      </div>

      <Panel title="Clawbacks" icon={Undo2} cite="9.4" bodyClassName="p-0">
        {!rows.length ? (
          <EmptyState
            icon={Receipt}
            title="No clawbacks"
            action={
              <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                <Plus /> New clawback
              </Button>
            }
          >
            Finance identifies a clawback when revenue is reversed, misconduct is proven, or a data error led to an overpayment.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1320px] text-sm">
              <thead>
                <tr className="border-b border-sg-line">
                  <th className={thCls}>Employee / project</th>
                  <th className={thCls}>Trigger</th>
                  <th className={thRight}>Paid</th>
                  <th className={thRight}>Corrected</th>
                  <th className={thRight}>Clawback</th>
                  <th className={thCls}>Recovery plan</th>
                  <th className={thCls}>Process</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <ClawbackRow key={c.id} c={c} profile={profiles.find((p) => p.userId === c.userId)} onModal={(kind) => setModal({ kind, c })} set={set} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {creating ? <NewClawbackModal onClose={() => setCreating(false)} /> : null}
      {modal?.kind === "decide" ? <DecisionModal c={modal.c} onClose={() => setModal(null)} /> : null}
      {modal?.kind === "dispute" ? <DisputeModal c={modal.c} onClose={() => setModal(null)} /> : null}
      {modal?.kind === "disputeDecision" ? <DecisionModal c={modal.c} dispute onClose={() => setModal(null)} /> : null}
      {modal?.kind === "recover" ? <RecoverModal c={modal.c} onClose={() => setModal(null)} /> : null}
    </div>
  );
}

function ClawbackRow({ c, profile, onModal, set }: { c: Clawback; profile: EmployeeProfile | undefined; onModal: (k: "decide" | "dispute" | "disputeDecision" | "recover") => void; set: (c: Clawback, patch: Partial<Clawback>, msg: string) => void }) {
  const sources = useRecoverySources(c.userId);
  const amount = clawbackAmount(c);
  const exempt = clawbackExempt(c);
  const sched = clawbackSchedule(Math.max(0, amount - c.recovered), profile?.annualBaseSalary ?? 0);
  const disputeDeadline = c.notifiedAt ? addBusinessDays(c.notifiedAt, POLICY.clawback.disputeBusinessDays) : null;
  const inWindow = disputeDeadline ? Date.parse(disputeDeadline) >= Date.now() : false;
  const remaining = Math.max(0, amount - c.recovered);
  const live = !["closed", "waived"].includes(c.status);
  const left = !!profile?.separation && Date.parse(profile.separation.effectiveAt) <= Date.now();
  const windowEnds = addMonths(c.paidAt, POLICY.clawback.windowMonths);

  return (
    <tr className="border-b border-sg-line align-top">
      <td className={cn(tdCls, "max-w-[240px]")}>
        <UserCell userId={c.userId} sub={left ? "Has left the company" : undefined} />
        <div className="mt-1 pl-7">
          <InitiativeLink id={c.initiativeId} compact />
          <div className="text-2xs text-sg-dim">
            paid {formatDate(c.paidAt, "medium")} · window to {formatDate(windowEnds, "short")}
          </div>
        </div>
      </td>
      <td className={cn(tdCls, "max-w-[220px]")}>
        <div className="text-sg-text" title={triggerMeta[c.trigger].description}>
          {triggerMeta[c.trigger].label}
        </div>
        {c.trigger === "data_error" ? <div className={cn("text-2xs", c.personallyAtFault ? "text-soft-orange" : "text-sg-dim")}>{c.personallyAtFault ? "caused by the employee" : `not caused by the employee — first ${formatIDR(POLICY.clawback.dataErrorSafeHarbour)} not recovered`}</div> : null}
        {c.notes ? (
          <div className="mt-0.5 line-clamp-3 whitespace-pre-line text-2xs text-sg-dim" title={c.notes}>
            {c.notes}
          </div>
        ) : null}
      </td>
      <td className={tdNum}>
        <Money value={c.originalPaid} />
      </td>
      <td className={tdNum}>
        <Money value={c.recalculated} />
      </td>
      <td className={cn(tdNum, "font-semibold text-sg-white")}>
        <Money value={amount} />
        {c.trigger === "data_error" && !c.personallyAtFault && c.originalPaid - c.recalculated > amount ? <div className="text-2xs font-normal text-sg-dim">of {formatIDR(c.originalPaid - c.recalculated)} overpaid</div> : null}
        {exempt ? <div className="mt-1 max-w-[180px] text-left text-2xs font-normal text-soft-yellow">{exempt}</div> : null}
      </td>
      <td className={cn(tdCls, "min-w-[250px] text-2xs")}>
        <ol className="space-y-0.5">
          <li className="text-sg-muted">
            <span className="font-semibold text-sg-text">1</span> Deferred &amp; carried forward: <Money value={sources.deferredTotal + sources.carriedTotal} className="text-sg-text" /> available
          </li>
          <li className="text-sg-muted">
            <span className="font-semibold text-sg-text">2</span> Future project bonuses
          </li>
          <li className="text-sg-muted">
            <span className="font-semibold text-sg-text">3</span> {left ? "Final pay set-off (separation agreement) or civil recovery" : `Salary: ${sched.months} × ${formatIDR(sched.monthly)} (≤ ${formatIDR(sched.monthlyCap)}/mo)`}
            {!left ? <span className={c.writtenAgreement ? "text-soft-green" : "text-soft-yellow"}> · {c.writtenAgreement ? "written agreement on file" : "needs written agreement"}</span> : null}
          </li>
        </ol>
        {!sched.feasible && !left && remaining > 0 ? <div className="mt-0.5 text-soft-red">Not recoverable from salary within 12 months at ≤ 20% — rely on bonuses or agreement</div> : null}
        {c.recovered > 0 || c.status === "recovering" ? (
          <div className="mt-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-sg-card-3">
              <div className="h-full bg-soft-green" style={{ width: `${amount ? Math.min(100, (c.recovered / amount) * 100) : 0}%` }} />
            </div>
            <div className="mt-0.5 text-sg-muted">
              recovered {formatIDR(c.recovered)} · {formatIDR(remaining)} left
            </div>
          </div>
        ) : null}
      </td>
      <td className={cn(tdCls, "min-w-[260px]")}>
        <Stepper c={c} />
        {c.notifiedAt && disputeDeadline && (c.status === "prc_approved" || c.status === "disputed") ? (
          <div className={cn("mt-1 text-2xs", inWindow ? "text-soft-yellow" : "text-sg-dim")}>
            Notice {formatDate(c.notifiedAt, "short")} · dispute window to {formatDate(disputeDeadline, "medium")} ({inWindow ? dueText(disputeDeadline) : "closed"})
          </div>
        ) : null}
      </td>
      <td className={cn(tdCls, "text-right")}>
        <div className="flex flex-col items-end gap-1">
          {c.status === "identified" ? (
            <Button size="xs" variant="primary" title="The CFO presents the case; the PRC decides by majority vote" onClick={() => onModal("decide")}>
              <Gavel /> Record PRC decision
            </Button>
          ) : null}
          {c.status === "prc_approved" && !c.notifiedAt ? (
            <Button size="xs" variant="primary" onClick={() => set(c, { notifiedAt: new Date().toISOString(), notes: appendNote(c, `Written notice with the calculation sent: ${formatIDR(c.originalPaid, "full")} paid − ${formatIDR(c.recalculated, "full")} on corrected figures = ${formatIDR(amount, "full")}`) }, "Written notice recorded — 10 business-day dispute window open")}>
              <FileText /> Send written notice
            </Button>
          ) : null}
          {c.status === "prc_approved" && c.notifiedAt ? (
            <>
              <Button size="xs" variant="outline" disabled={!inWindow} title={inWindow ? "Employee disputes the figures or raises mitigating factors" : "The dispute window has closed"} onClick={() => onModal("dispute")}>
                Record dispute
              </Button>
              <Button
                size="xs"
                variant="primary"
                disabled={inWindow}
                title={inWindow ? "Wait for the 10 business-day dispute window to close" : "Begin recovery in the §9.4 order"}
                onClick={() => set(c, { status: "recovering", months: c.months || sched.months, monthlyDeduction: c.monthlyDeduction || sched.monthly }, "Recovery started")}
              >
                Start recovery
              </Button>
              {inWindow ? <span className="text-2xs text-sg-dim">dispute window open</span> : null}
            </>
          ) : null}
          {c.status === "disputed" ? (
            <Button size="xs" variant="primary" onClick={() => onModal("disputeDecision")}>
              <Gavel /> PRC decides dispute
            </Button>
          ) : null}
          {c.status === "recovering" ? (
            <>
              <Button size="xs" variant="primary" disabled={remaining <= 0} onClick={() => onModal("recover")}>
                Record recovery
              </Button>
              {!c.writtenAgreement && !left ? (
                <Button size="xs" variant="outline" title="Salary deductions need the employee's specific written agreement for this recovery (§9.4 step 5)" onClick={() => set(c, { writtenAgreement: true, notes: appendNote(c, "Employee's written agreement to salary deductions received") }, "Written agreement recorded")}>
                  Written agreement received
                </Button>
              ) : null}
              <Button size="xs" variant="ghost" onClick={() => set(c, { status: "closed", notes: appendNote(c, `Closed with ${formatIDR(remaining, "full")} outstanding${left ? " — referred for civil recovery" : " — absorbed by the company"}`) }, "Clawback closed")}>
                Close
              </Button>
            </>
          ) : null}
          {live && exempt ? (
            <Button size="xs" variant="danger" title={exempt} onClick={() => set(c, { status: "waived", notes: appendNote(c, `Not pursued — ${exempt}`) }, "Clawback not pursued (exempt)")}>
              Not pursued
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

/** PRC majority decision on a case, or on a dispute (§9.4 step 2, §14). The CEO may veto (§13.1). */
function DecisionModal({ c, dispute, onClose }: { c: Clawback; dispute?: boolean; onClose: () => void }) {
  const updateClawback = useCrm((s) => s.updateClawback);
  const notify = useUi((s) => s.notify);
  const [forVotes, setFor] = useState("3");
  const [against, setAgainst] = useState("0");
  const [veto, setVeto] = useState(false);
  const [recalc, setRecalc] = useState(String(c.recalculated));
  const [reasons, setReasons] = useState("");
  const yes = Math.max(0, Math.round(parseAmount(forVotes)));
  const no = Math.max(0, Math.round(parseAmount(against)));
  const carried = yes > no && !veto;
  const newRecalc = Math.max(0, parseAmount(recalc));
  const valid = yes + no > 0 && reasons.trim().length >= 5;

  const submit = () => {
    if (!valid) return;
    const tally = `${yes}–${no}${veto ? ", CEO veto" : ""}`;
    if (dispute) {
      const patch: Partial<Clawback> = carried
        ? { status: "recovering", recalculated: newRecalc, notes: appendNote(c, `PRC upheld the clawback after the dispute (${tally})${newRecalc !== c.recalculated ? `; corrected bonus revised to ${formatIDR(newRecalc, "full")}` : ""}: ${reasons.trim()}`) }
        : { status: "waived", notes: appendNote(c, `PRC accepted the dispute (${tally}) — not pursued: ${reasons.trim()}`) };
      updateClawback(c.id, patch);
      notify(carried ? "Dispute decided — recovery continues" : "Dispute accepted — clawback not pursued");
    } else {
      updateClawback(c.id, carried ? { status: "prc_approved", notes: appendNote(c, `PRC approved by majority (${tally}): ${reasons.trim()}`) } : { status: "waived", notes: appendNote(c, `PRC did not approve (${tally}): ${reasons.trim()}`) });
      notify(carried ? "PRC approved the clawback — send the written notice" : "PRC decided not to claw back");
    }
    onClose();
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={dispute ? "PRC decision on the dispute" : "Record PRC decision"}
      description={`${formatIDR(clawbackAmount(c), "full")} · decided by simple majority; the chair has the casting vote; every decision is recorded with its reasons (§9.4, §13.1)`}
      footer={
        <>
          <span className={cn("mr-auto text-2xs font-semibold", carried ? "text-soft-green" : "text-soft-red")}>{yes + no > 0 ? (carried ? "Carried" : veto ? "Vetoed by the CEO" : "Not carried") : ""}</span>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!valid} onClick={submit}>
            <Gavel /> Record decision
          </Button>
        </>
      }
    >
      <div
        className="grid grid-cols-2 gap-3"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      >
        <Field label={dispute ? "Votes to uphold" : "Votes for"}>
          <Input type="number" min={0} value={forVotes} onChange={(e) => setFor(e.target.value)} className="sg-num" autoFocus />
        </Field>
        <Field label="Votes against">
          <Input type="number" min={0} value={against} onChange={(e) => setAgainst(e.target.value)} className="sg-num" />
        </Field>
        {dispute ? (
          <Field label="Corrected bonus after review (IDR)" hint={`Clawback becomes ${formatIDR(clawbackAmount({ ...c, recalculated: newRecalc }), "full")}`} className="col-span-2">
            <Input type="number" min={0} value={recalc} onChange={(e) => setRecalc(e.target.value)} className="sg-num" />
          </Field>
        ) : null}
        <label className="col-span-2 flex cursor-pointer items-center gap-2 text-xs text-sg-text">
          <input type="checkbox" className="accent-sg-white" checked={veto} onChange={(e) => setVeto(e.target.checked)} />
          CEO veto (recorded in writing and reported to the Board of Commissioners)
        </label>
        <Field label="Reasons" className="col-span-2">
          <Textarea value={reasons} onChange={(e) => setReasons(e.target.value)} placeholder="Summary of the CFO's case and the PRC's reasoning" className="min-h-[72px]" />
        </Field>
        <p className="col-span-2 text-2xs text-sg-dim">Members on the project&apos;s team or with a conflict of interest are recused (§13.1).</p>
      </div>
    </Modal>
  );
}

function DisputeModal({ c, onClose }: { c: Clawback; onClose: () => void }) {
  const updateClawback = useCrm((s) => s.updateClawback);
  const notify = useUi((s) => s.notify);
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    updateClawback(c.id, { status: "disputed", notes: appendNote(c, `Disputed by employee: ${text.trim()}`) });
    notify("Dispute recorded — PRC to decide");
    onClose();
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Record employee dispute"
      description="Within 10 business days of the written notice the employee may dispute the figures or raise mitigating factors (§9.4 step 4)"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!text.trim()} onClick={submit}>
            Record dispute
          </Button>
        </>
      }
    >
      <Field label="Grounds">
        <Textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder="e.g. the reversed invoice relates to a change order outside the work period I was on the team"
        />
      </Field>
    </Modal>
  );
}

type Source = "deferred" | "bonus" | "salary" | "final";

/** Record one recovery step in the §9.4 order. */
function RecoverModal({ c, onClose }: { c: Clawback; onClose: () => void }) {
  const updateClawback = useCrm((s) => s.updateClawback);
  const releaseDeferred = useCrm((s) => s.releaseDeferred);
  const forfeitDeferred = useCrm((s) => s.forfeitDeferred);
  const profiles = useCrm((s) => s.employeeProfiles);
  const initiatives = useCrm((s) => s.initiatives);
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const notify = useUi((s) => s.notify);
  const iniMap = useInitiativeMap();
  const sources = useRecoverySources(c.userId);
  const profile = profiles.find((p) => p.userId === c.userId);
  const left = !!profile?.separation && Date.parse(profile.separation.effectiveAt) <= Date.now();
  const amount = clawbackAmount(c);
  const remaining = Math.max(0, amount - c.recovered);
  const monthlyGross = (profile?.annualBaseSalary ?? 0) / 12;
  const sched = clawbackSchedule(remaining, profile?.annualBaseSalary ?? 0);

  const vested = (d: DeferredBonus) => {
    const ini = initiatives.find((i) => i.id === d.initiativeId);
    return !!ini?.completedAt && Date.parse(deferralVestDate(ini)) <= Date.now();
  };
  const usable = sources.pending.filter((d) => d.amount <= remaining + 0.5 || vested(d));

  const [source, setSource] = useState<Source>(usable.length ? "deferred" : "bonus");
  const [deferredId, setDeferredId] = useState(usable[0]?.id ?? "");
  const [bonusMonth, setBonusMonth] = useState("");
  const [value, setValue] = useState(String(Math.round(Math.min(remaining, c.monthlyDeduction || sched.monthly))));
  const [otherDeductions, setOtherDeductions] = useState("0");
  const [orderOk, setOrderOk] = useState(false);
  const [agreement, setAgreement] = useState(!!c.writtenAgreement);

  const runMonths = useMemo(() => bonusRuns.filter((r) => (r.status === "certified" || r.status === "released") && r.lines.some((l) => l.userId === c.userId && (l.payable > 0 || l.carriedOver > 0))).map((r) => r.month).sort((a, b) => b.localeCompare(a)), [bonusRuns, c.userId]);
  const d = sources.pending.find((x) => x.id === deferredId);
  const take = source === "deferred" ? Math.min(remaining, d?.amount ?? 0) : Math.min(remaining, Math.max(0, parseAmount(value)));
  const other = Math.max(0, parseAmount(otherDeductions));
  const salaryCapOk = take <= sched.monthlyCap + 0.5;
  const wageCapOk = take + other <= monthlyGross * POLICY.clawback.maxWageDeductionPct + 0.5;
  const earlierAvailable = sources.deferredTotal + sources.carriedTotal > 0;

  const errors: string[] = [];
  if (take <= 0) errors.push("Enter an amount");
  if (source === "deferred" && !d) errors.push("Choose a deferred entry");
  if (source === "bonus" && !bonusMonth) errors.push("Choose the bonus cycle it was deducted from");
  if ((source === "salary" || source === "final") && !agreement) errors.push(source === "final" ? "Set-off against final pay needs the employee's written agreement in the separation agreement" : "Salary deductions need the employee's specific written agreement for this recovery");
  if (source === "salary" && !salaryCapOk) errors.push(`Above 20% of monthly gross salary (${formatIDR(sched.monthlyCap, "full")})`);
  if (source === "salary" && !wageCapOk) errors.push(`Total deductions from this wage payment would exceed 50% (${formatIDR(monthlyGross * POLICY.clawback.maxWageDeductionPct, "full")})`);
  if (source === "salary" && earlierAvailable && !orderOk) errors.push("Confirm deferred, carried-forward and future project bonuses have been used first");

  const submit = () => {
    if (errors.length) return;
    let detail = "";
    if (source === "deferred" && d) {
      const label = `${iniMap.get(d.initiativeId)?.code ?? d.initiativeId} ${d.month}`;
      if (d.amount <= remaining + 0.5) forfeitDeferred(d.id, `Offset in full against clawback ${c.id} (§9.4 recovery order)`);
      else releaseDeferred(d.id, d.amount - take, `Vested; ${formatIDR(take, "full")} offset against clawback ${c.id} (§9.4), remainder paid`);
      detail = `${formatIDR(take, "full")} recovered from deferred entry ${label}`;
    } else if (source === "bonus") detail = `${formatIDR(take, "full")} deducted from the ${monthLabel(bonusMonth)} project bonus / carried-forward amount`;
    else if (source === "salary") detail = `${formatIDR(take, "full")} salary deduction (written agreement on file; ≤ 20% of monthly gross; total deductions ${formatIDR(take + other, "full")} ≤ 50%)`;
    else detail = `${formatIDR(take, "full")} set off against final pay under the separation agreement`;
    const recovered = Math.min(amount, c.recovered + take);
    const done = recovered >= amount - 0.5;
    const agreed = (source === "salary" || source === "final") && agreement && !c.writtenAgreement;
    updateClawback(c.id, { recovered: done ? amount : recovered, status: done ? "closed" : "recovering", notes: appendNote(c, agreed ? `Employee's written agreement to the deduction received · ${detail}` : detail), ...(agreed ? { writtenAgreement: true } : {}) });
    notify(done ? "Final recovery recorded — clawback closed" : `${formatIDR(take)} recovered`);
    onClose();
  };

  const OPTIONS: { value: Source; label: string; disabled?: boolean }[] = [
    { value: "deferred", label: `1 · Deferred amount (${sources.pending.length} pending · ${formatIDR(sources.deferredTotal)})`, disabled: !sources.pending.length },
    { value: "bonus", label: `1–2 · Carried-forward amount or a future project bonus${sources.carriedTotal ? ` (${formatIDR(sources.carriedTotal)} carried)` : ""}` },
    { value: "salary", label: "3 · Salary deduction", disabled: left },
    { value: "final", label: "Final pay set-off (leaver)", disabled: !left },
  ];

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Record recovery"
      description={`${formatIDR(remaining, "full")} outstanding · order: deferred & carried forward → future project bonuses → salary (§9.4)`}
      className="w-[min(600px,calc(100vw-32px))]"
      footer={
        <>
          <span className="mr-auto text-2xs text-sg-dim">No penalties or interest are added.</span>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={errors.length > 0} onClick={submit} title={errors.join("\n")}>
            Record {take > 0 ? formatIDR(take) : ""}
          </Button>
        </>
      }
    >
      <div
        className="space-y-3"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      >
        <Field label="Source">
          <Select value={source} onChange={(e) => setSource(e.target.value as Source)}>
            {OPTIONS.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        {source === "deferred" ? (
          <Field label="Deferred entry" hint="An entry no larger than the balance is offset in full; a larger one only once it has vested (the rest is then paid)">
            <Select value={deferredId} onChange={(e) => setDeferredId(e.target.value)}>
              <option value="">Choose…</option>
              {sources.pending.map((x) => (
                <option key={x.id} value={x.id} disabled={!usable.includes(x)}>
                  {iniMap.get(x.initiativeId)?.code ?? x.initiativeId} · {monthLabel(x.month)} · {formatIDR(x.amount, "full")}
                  {usable.includes(x) ? "" : " — larger than the balance and not vested yet"}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {source === "bonus" ? (
          <>
            <Field label="Bonus cycle deducted from" hint="Finance nets the amount in payroll for that salary date">
              <Select value={bonusMonth} onChange={(e) => setBonusMonth(e.target.value)}>
                <option value="">Choose…</option>
                {runMonths.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)} · salary {formatDate(paymentDate(m), "short")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount (IDR)">
              <Input type="number" min={0} max={remaining} value={value} onChange={(e) => setValue(e.target.value)} className="sg-num" />
            </Field>
          </>
        ) : null}

        {source === "salary" || source === "final" ? (
          <>
            <label className="flex cursor-pointer items-start gap-2 text-xs text-sg-text">
              <input type="checkbox" className="mt-0.5 accent-sg-white" checked={agreement} disabled={!!c.writtenAgreement} onChange={(e) => setAgreement(e.target.checked)} />
              <span>
                {source === "final" ? "The separation agreement contains the employee's written agreement to this set-off" : "The employee has given specific written agreement to salary deductions for this recovery"}
                <span className="block text-2xs text-sg-dim">{source === "final" ? "Without it the company may only pursue civil recovery." : "Required for each recovery; deductions are spread over 6–12 months."} (§9.4 steps 5–6)</span>
              </span>
            </label>
            <Field label={source === "final" ? "Amount set off (IDR)" : "This month's deduction (IDR)"} hint={source === "salary" ? `Schedule ${sched.months} months × ${formatIDR(sched.monthly, "full")} · cap ${formatIDR(sched.monthlyCap, "full")} (20% of ${formatIDR(monthlyGross, "full")})` : undefined}>
              <Input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} className={cn("sg-num", source === "salary" && !salaryCapOk && "text-soft-red")} />
            </Field>
            {source === "salary" ? (
              <>
                <Field label="Other deductions from the same wage payment (IDR)" hint={`Total ${formatIDR(take + other, "full")} of the 50% limit ${formatIDR(monthlyGross * POLICY.clawback.maxWageDeductionPct, "full")}`}>
                  <Input type="number" min={0} value={otherDeductions} onChange={(e) => setOtherDeductions(e.target.value)} className={cn("sg-num", !wageCapOk && "text-soft-red")} />
                </Field>
                {earlierAvailable ? (
                  <label className="flex cursor-pointer items-start gap-2 text-xs text-sg-text">
                    <input type="checkbox" className="mt-0.5 accent-sg-white" checked={orderOk} onChange={(e) => setOrderOk(e.target.checked)} />
                    Deferred ({formatIDR(sources.deferredTotal)}) and carried-forward ({formatIDR(sources.carriedTotal)}) amounts and future project bonuses have been used first, or are not yet due
                  </label>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}

        {errors.length && take > 0 ? (
          <ul className="list-disc pl-4 text-2xs text-soft-yellow">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Modal>
  );
}

function NewClawbackModal({ onClose }: { onClose: () => void }) {
  const users = useCrm((s) => s.users);
  const profiles = useCrm((s) => s.employeeProfiles);
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const initiatives = useCrm((s) => s.initiatives);
  const createClawback = useCrm((s) => s.createClawback);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const iniMap = useInitiativeMap();

  const released = useMemo(() => bonusRuns.filter((r) => r.status === "released"), [bonusRuns]);
  const paidPeople = useMemo(() => {
    const ids = new Set<string>(profiles.map((p) => p.userId));
    released.forEach((r) => r.lines.forEach((l) => ids.add(l.userId)));
    return Array.from(ids)
      .map((id) => userMap.get(id))
      .filter((u): u is NonNullable<typeof u> => !!u)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [profiles, released, userMap]);

  const [userId, setUserId] = useState(paidPeople[0]?.id ?? users[0]?.id ?? "");
  const [initiativeId, setInitiativeId] = useState("");
  const [trigger, setTrigger] = useState<ClawbackTrigger>("revenue_reversal");
  const [payment, setPayment] = useState("");
  const [paidAt, setPaidAt] = useState(toDateInput(new Date().toISOString()));
  const [originalPaid, setOriginalPaid] = useState("");
  const [recalculated, setRecalculated] = useState("");
  const [fault, setFault] = useState(false);
  const [notes, setNotes] = useState("");

  const payments = useMemo(
    () =>
      released
        .flatMap((r) => r.lines.filter((l) => l.userId === userId && l.payable > 0 && (!initiativeId || l.initiativeId === initiativeId)).map((l) => ({ key: `${r.month}|${l.initiativeId}`, month: r.month, initiativeId: l.initiativeId, payable: l.payable })))
        .sort((a, b) => b.month.localeCompare(a.month)),
    [released, userId, initiativeId],
  );
  const projectOptions = useMemo(() => {
    const fromPayments = new Set(released.flatMap((r) => r.lines.filter((l) => l.userId === userId).map((l) => l.initiativeId)));
    return initiatives.filter((i) => fromPayments.has(i.id) || ["active", "completed", "approved"].includes(i.status)).sort((a, b) => Number(fromPayments.has(b.id)) - Number(fromPayments.has(a.id)) || a.title.localeCompare(b.title));
  }, [initiatives, released, userId]);

  const orig = parseAmount(originalPaid);
  const recalc = parseAmount(recalculated);
  const draft = { trigger, personallyAtFault: fault, originalPaid: orig, recalculated: recalc, paidAt: fromDateInput(paidAt || toDateInput(new Date().toISOString())) };
  const amount = clawbackAmount(draft);
  const profile = profiles.find((p) => p.userId === userId);
  const sched = clawbackSchedule(amount, profile?.annualBaseSalary ?? 0);
  const exempt = paidAt && orig > 0 ? clawbackExempt(draft) : null;
  const valid = !!userId && !!initiativeId && !!paidAt && orig > 0 && orig > recalc && notes.trim().length >= 5;

  const pickPayment = (key: string) => {
    setPayment(key);
    const p = payments.find((x) => x.key === key);
    if (!p) return;
    setInitiativeId(p.initiativeId);
    setOriginalPaid(String(Math.round(p.payable)));
    setPaidAt(toDateInput(paymentDate(p.month)));
  };

  const submit = () => {
    if (!valid) return;
    createClawback({ userId, initiativeId, trigger, paidAt: draft.paidAt, originalPaid: orig, recalculated: recalc, personallyAtFault: fault, writtenAgreement: false, notes: notes.trim(), months: sched.months, monthlyDeduction: sched.monthly });
    notify(`Clawback of ${formatIDR(amount)} identified — CFO to present it to the PRC`);
    onClose();
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="New clawback"
      description="Finance identifies the trigger and calculates the amount; the CFO presents the case to the PRC (§9.4 steps 1–2)"
      className="w-[min(660px,calc(100vw-32px))]"
      footer={
        <>
          <span className="mr-auto text-2xs text-sg-dim">⌘/Ctrl+Enter to create</span>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!valid} onClick={submit}>
            <ShieldAlert /> Create clawback
          </Button>
        </>
      }
    >
      <div
        className="grid grid-cols-2 gap-3"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      >
        <Field label="Employee">
          <Select
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              setPayment("");
              setInitiativeId("");
            }}
          >
            {(paidPeople.length ? paidPeople : users).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Project">
          <Select
            value={initiativeId}
            onChange={(e) => {
              setInitiativeId(e.target.value);
              setPayment("");
            }}
          >
            <option value="">Select project…</option>
            {projectOptions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.code ? `${i.code} · ` : ""}
                {i.title}
                {i.demo ? " (sample)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Prefill from a released bonus payment" className="col-span-2" hint={payments.length ? "Sets project, amount paid and payment date" : "No released payments for this employee / project"}>
          <Select value={payment} onChange={(e) => pickPayment(e.target.value)} disabled={!payments.length}>
            <option value="">{payments.length ? "Choose payment…" : "—"}</option>
            {payments.map((p) => (
              <option key={p.key} value={p.key}>
                {monthLabel(p.month)} · {iniMap.get(p.initiativeId)?.title ?? p.initiativeId} · {formatIDR(p.payable, "full")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Trigger" className="col-span-2" hint={triggerMeta[trigger].description}>
          <Select value={trigger} onChange={(e) => setTrigger(e.target.value as ClawbackTrigger)}>
            {(Object.keys(triggerMeta) as ClawbackTrigger[]).map((t) => (
              <option key={t} value={t}>
                {triggerMeta[t].label}
              </option>
            ))}
          </Select>
        </Field>
        <Callout className="col-span-2">
          Not a clawback trigger: {NOT_CLAWBACK.join(", ")}. These are absorbed through deferral (§9.3) or by the company.
        </Callout>
        <Field label="Bonus paid (IDR)">
          <Input type="number" min={0} value={originalPaid} onChange={(e) => setOriginalPaid(e.target.value)} className="sg-num" />
        </Field>
        <Field label="Bonus on corrected figures (IDR)" hint="What should have been paid">
          <Input type="number" min={0} value={recalculated} onChange={(e) => setRecalculated(e.target.value)} className="sg-num" />
        </Field>
        <Field label="Payment date" hint={`24-month window ends ${paidAt ? formatDate(addMonths(fromDateInput(paidAt), POLICY.clawback.windowMonths), "medium") : "—"}`}>
          <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </Field>
        {trigger === "data_error" ? (
          <label className="mt-5 flex cursor-pointer items-start gap-2 text-sm text-sg-text">
            <input type="checkbox" checked={fault} onChange={(e) => setFault(e.target.checked)} className="mt-1 accent-sg-white" />
            <span>
              The employee caused the data error
              <span className="block text-2xs text-sg-dim">Otherwise the first {formatIDR(POLICY.clawback.dataErrorSafeHarbour, "full")} per person per project is not clawed back</span>
            </span>
          </label>
        ) : (
          <div />
        )}
        <Field label="Calculation & evidence" className="col-span-2">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Credit note / write-off reference, misconduct finding, corrected ledger figures…" className="min-h-[64px]" />
        </Field>

        <div className="col-span-2 space-y-2 rounded-lg border border-sg-line bg-sg-card-2/50 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-sg-muted">Clawback (paid − corrected{trigger === "data_error" && !fault ? ` − ${formatIDR(POLICY.clawback.dataErrorSafeHarbour)} safe harbour` : ""})</span>
            <span className="sg-num font-display text-base font-extrabold text-sg-white">{formatIDR(amount, "full")}</span>
          </div>
          {amount > 0 ? (
            <div className="flex items-center justify-between">
              <span className="text-sg-muted">If recovered from salary {profile ? "" : "(no HR record — salary unknown)"}</span>
              <span className="sg-num text-sg-white">
                {sched.months} months × {formatIDR(sched.monthly, "full")} <span className="text-sg-dim">(cap {formatIDR(sched.monthlyCap)}/mo)</span>
              </span>
            </div>
          ) : null}
          {amount > 0 && !sched.feasible ? <Callout tone="warn">Cannot be recovered from salary within 12 months at ≤ 20% of monthly gross — recover from deferred, carried-forward and future bonuses first.</Callout> : null}
          {exempt ? <Callout tone="warn">{exempt}. You can still record it, then mark it not pursued.</Callout> : null}
          <p className="text-2xs text-sg-dim">No penalties or interest are added (§9.4).</p>
        </div>
      </div>
    </Modal>
  );
}
