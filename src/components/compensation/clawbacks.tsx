"use client";

/* §6.4 clawbacks: identification → PRC approval → notice → (dispute) → salary-deduction recovery → closed. */
import { useMemo, useState } from "react";
import { Check, Gavel, Plus, Receipt, ShieldAlert, Undo2 } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { Clawback, ClawbackTrigger } from "@/lib/initiatives/types";
import { addBusinessDays, clawbackAmount, clawbackExempt, clawbackSchedule, paymentDate } from "@/lib/initiatives/engine";
import { POLICY } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR, fromDateInput, toDateInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Chip, EmptyState } from "@/components/ui/misc";
import { Modal } from "@/components/ui/overlays";
import { Cite, Metric, Money } from "@/components/initiatives/shared";
import { Callout, InitiativeLink, Panel, UserCell, dueText, monthLabel, parseAmount, tdCls, tdNum, thCls, thRight, triggerMeta, useInitiativeMap } from "./common";

const STEPS = [
  { key: "identified", label: "Identified" },
  { key: "prc_approved", label: "PRC approved" },
  { key: "notified", label: "Notified" },
  { key: "disputed", label: "Disputed" },
  { key: "recovering", label: "Recovering" },
  { key: "closed", label: "Closed" },
] as const;

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
        Waived
      </Chip>
    );
  const idx = stepIndex(c);
  const disputed = c.status === "disputed" || /dispute/i.test(c.notes);
  return (
    <ol className="flex flex-wrap items-center gap-1">
      {STEPS.map((s, i) => {
        const optional = s.key === "disputed";
        if (optional && !disputed && idx !== 3) return null;
        const done = i < idx;
        const current = i === idx;
        return (
          <li key={s.key} className="flex items-center gap-1">
            <span
              className={cn(
                "inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-2xs font-semibold ring-1 ring-inset",
                current ? "bg-sg-white text-sg-bg ring-sg-white" : done ? "bg-soft-green/15 text-soft-green ring-soft-green/30" : "text-sg-dim ring-sg-line",
              )}
            >
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

export function ClawbacksTab() {
  const clawbacks = useCrm((s) => s.clawbacks);
  const profiles = useCrm((s) => s.employeeProfiles);
  const updateClawback = useCrm((s) => s.updateClawback);
  const notify = useUi((s) => s.notify);
  const [creating, setCreating] = useState(false);
  const [disputeFor, setDisputeFor] = useState<Clawback | null>(null);

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
        <Metric label="Open clawbacks" value={String(stats.open)} tone={stats.open ? "orange" : undefined} />
        <Metric label="Outstanding" value={formatIDR(stats.outstanding)} tone={stats.outstanding ? "red" : undefined} />
        <Metric label="Recovered" value={formatIDR(stats.recovered)} tone="green" />
        <Metric label="Waived" value={formatIDR(stats.waived)} />
        <div className="ml-auto flex items-center gap-3">
          <p className="max-w-xs text-2xs text-sg-dim">
            24-month window from payment. Recovery by salary deduction over 6–12 months, max 20% of monthly gross. No penalties or interest <Cite s="6.4" />.
          </p>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus /> New clawback
          </Button>
        </div>
      </div>

      <Panel title="Clawbacks" icon={Undo2} cite="6.4" bodyClassName="p-0">
        {!rows.length ? (
          <EmptyState icon={Receipt} title="No clawbacks" action={<Button size="sm" variant="outline" onClick={() => setCreating(true)}><Plus /> New clawback</Button>}>
            Finance identifies a clawback when revenue is reversed, costs overrun materially, misconduct is found, or a data error led to an overpayment.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1240px] text-sm">
              <thead>
                <tr className="border-b border-sg-line">
                  <th className={thCls}>Employee / project</th>
                  <th className={thCls}>Trigger</th>
                  <th className={thRight}>Original paid</th>
                  <th className={thRight}>Recalculated</th>
                  <th className={thRight}>Clawback</th>
                  <th className={thCls}>Recovery</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const amount = clawbackAmount(c);
                  const exempt = clawbackExempt(c);
                  const profile = profiles.find((p) => p.userId === c.userId);
                  const sched = clawbackSchedule(amount, profile?.annualBaseSalary ?? 0);
                  const disputeDeadline = c.notifiedAt ? addBusinessDays(c.notifiedAt, POLICY.clawback.disputeBusinessDays) : null;
                  const inWindow = disputeDeadline ? Date.parse(disputeDeadline) >= Date.now() : false;
                  const remaining = Math.max(0, amount - c.recovered);
                  const live = !["closed", "waived"].includes(c.status);
                  return (
                    <tr key={c.id} className="border-b border-sg-line align-top">
                      <td className={cn(tdCls, "max-w-[240px]")}>
                        <UserCell userId={c.userId} />
                        <div className="mt-1 pl-7">
                          <InitiativeLink id={c.initiativeId} compact />
                          <div className="text-2xs text-sg-dim">paid {formatDate(c.paidAt, "medium")}</div>
                        </div>
                      </td>
                      <td className={cn(tdCls, "max-w-[200px]")}>
                        <div className="text-sg-text" title={triggerMeta[c.trigger].description}>
                          {triggerMeta[c.trigger].label}
                        </div>
                        {c.personallyAtFault ? <div className="text-2xs text-soft-orange">employee at fault</div> : null}
                        {c.notes ? <div className="mt-0.5 line-clamp-3 text-2xs text-sg-dim" title={c.notes}>{c.notes}</div> : null}
                      </td>
                      <td className={tdNum}>
                        <Money value={c.originalPaid} />
                      </td>
                      <td className={tdNum}>
                        <Money value={c.recalculated} />
                      </td>
                      <td className={cn(tdNum, "font-semibold text-sg-white")}>
                        <Money value={amount} />
                        {exempt ? <div className="mt-1 max-w-[180px] text-left text-2xs font-normal text-soft-yellow">Exempt: {exempt}</div> : null}
                      </td>
                      <td className={cn(tdCls, "min-w-[200px] text-2xs")}>
                        <div className="text-sg-text">
                          <span className="sg-num font-semibold">{c.months || sched.months}</span> months × <Money value={c.monthlyDeduction || sched.monthly} className="font-semibold" />
                        </div>
                        <div className="text-sg-dim">max {formatIDR(sched.monthlyCap)}/mo (20% of gross)</div>
                        {!sched.feasible ? <div className="text-soft-red">Not recoverable in 12 months within the 20% limit — remainder via civil recovery</div> : null}
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
                            Notified {formatDate(c.notifiedAt, "short")} · dispute window to {formatDate(disputeDeadline, "medium")} ({inWindow ? dueText(disputeDeadline) : "closed"})
                          </div>
                        ) : null}
                      </td>
                      <td className={cn(tdCls, "text-right")}>
                        <div className="flex flex-col items-end gap-1">
                          {c.status === "identified" ? (
                            <Button size="xs" variant="primary" title="PRC majority vote; the CEO holds a veto" onClick={() => set(c, { status: "prc_approved" }, "Clawback approved by PRC (majority, no CEO veto)")}>
                              <Gavel /> Record PRC approval
                            </Button>
                          ) : null}
                          {c.status === "identified" ? (
                            <Button size="xs" variant="ghost" title="The CEO may veto a PRC clawback decision" onClick={() => set(c, { status: "waived", notes: `${c.notes}${c.notes ? "\n" : ""}CEO veto — clawback not pursued.` }, "CEO veto recorded — clawback waived")}>
                              CEO veto
                            </Button>
                          ) : null}
                          {c.status === "prc_approved" && !c.notifiedAt ? (
                            <Button size="xs" variant="primary" onClick={() => set(c, { notifiedAt: new Date().toISOString() }, "Employee notified in writing — 10 business-day dispute window open")}>
                              Notify employee
                            </Button>
                          ) : null}
                          {c.status === "prc_approved" && c.notifiedAt ? (
                            <>
                              <Button size="xs" variant="outline" disabled={!inWindow} title={inWindow ? "Employee disputes within the window" : "Dispute window has closed"} onClick={() => setDisputeFor(c)}>
                                Record dispute
                              </Button>
                              <Button
                                size="xs"
                                variant="primary"
                                title={inWindow ? "Starting recovery before the window closes is only appropriate if the employee accepted in writing" : "Begin salary deductions"}
                                onClick={() => set(c, { status: "recovering", months: c.months || sched.months, monthlyDeduction: c.monthlyDeduction || sched.monthly }, "Recovery started by salary deduction")}
                              >
                                Start recovery
                              </Button>
                              {inWindow ? <span className="text-2xs text-sg-dim">window open — start only if accepted</span> : null}
                            </>
                          ) : null}
                          {c.status === "disputed" ? (
                            <>
                              <Button size="xs" variant="primary" onClick={() => set(c, { status: "recovering", months: c.months || sched.months, monthlyDeduction: c.monthlyDeduction || sched.monthly, notes: `${c.notes}${c.notes ? "\n" : ""}Dispute reviewed by PRC — clawback upheld.` }, "Dispute rejected — recovery started")}>
                                Uphold → recover
                              </Button>
                              <Button size="xs" variant="outline" onClick={() => set(c, { status: "waived", notes: `${c.notes}${c.notes ? "\n" : ""}Dispute upheld by PRC — clawback waived.` }, "Dispute upheld — clawback waived")}>
                                Accept dispute → waive
                              </Button>
                            </>
                          ) : null}
                          {c.status === "recovering" ? (
                            <>
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={remaining <= 0}
                                onClick={() => {
                                  const recovered = Math.min(amount, c.recovered + (c.monthlyDeduction || sched.monthly));
                                  set(c, recovered >= amount - 0.5 ? { recovered: amount, status: "closed" } : { recovered }, recovered >= amount - 0.5 ? "Final deduction recorded — clawback closed" : "Monthly deduction recorded");
                                }}
                              >
                                Record deduction
                              </Button>
                              <Button size="xs" variant="ghost" onClick={() => set(c, { status: "closed", notes: `${c.notes}${c.notes ? "\n" : ""}Closed with ${formatIDR(remaining, "full")} outstanding — referred for civil recovery / settlement.` }, "Clawback closed")}>
                                Close
                              </Button>
                            </>
                          ) : null}
                          {live && exempt ? (
                            <Button size="xs" variant="danger" title={exempt} onClick={() => set(c, { status: "waived", notes: `${c.notes}${c.notes ? "\n" : ""}Waived — exempt: ${exempt}` }, "Clawback waived (exempt)")}>
                              Waive
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {creating ? <NewClawbackModal onClose={() => setCreating(false)} /> : null}
      {disputeFor ? <DisputeModal c={disputeFor} onClose={() => setDisputeFor(null)} /> : null}
    </div>
  );
}

function DisputeModal({ c, onClose }: { c: Clawback; onClose: () => void }) {
  const updateClawback = useCrm((s) => s.updateClawback);
  const notify = useUi((s) => s.notify);
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    updateClawback(c.id, { status: "disputed", notes: `${c.notes}${c.notes ? "\n" : ""}Disputed by employee: ${text.trim()}` });
    notify("Dispute recorded — PRC to review");
    onClose();
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Record employee dispute"
      description="Disputes must be lodged within 10 business days of notice (§6.4)"
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
      <Field label="Grounds for dispute">
        <Textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder="e.g. revenue reversal relates to a change order outside the project scope"
        />
      </Field>
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
  const amount = Math.max(0, orig - recalc);
  const profile = profiles.find((p) => p.userId === userId);
  const sched = clawbackSchedule(amount, profile?.annualBaseSalary ?? 0);
  const draft = { trigger, personallyAtFault: fault, originalPaid: orig, recalculated: recalc, paidAt: fromDateInput(paidAt || toDateInput(new Date().toISOString())) };
  const exempt = paidAt ? clawbackExempt(draft) : null;
  const valid = !!userId && !!initiativeId && !!paidAt && orig > 0 && amount > 0;

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
    createClawback({ userId, initiativeId, trigger, paidAt: draft.paidAt, originalPaid: orig, recalculated: recalc, personallyAtFault: fault, notes: notes.trim(), months: sched.months, monthlyDeduction: sched.monthly });
    notify(`Clawback of ${formatIDR(amount)} identified — awaiting PRC approval`);
    onClose();
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="New clawback"
      description="Finance identifies the trigger; PRC approves by majority (CEO veto) before the employee is notified (§6.4)"
      className="w-[min(640px,calc(100vw-32px))]"
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
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Prefill from a released bonus payment" className="col-span-2" hint={payments.length ? "Sets project, original amount paid and payment date" : "No released payments for this employee / project"}>
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
        <Field label="Original bonus paid (IDR)">
          <Input type="number" min={0} value={originalPaid} onChange={(e) => setOriginalPaid(e.target.value)} className="sg-num" />
        </Field>
        <Field label="Recalculated bonus (IDR)" hint="What should have been paid">
          <Input type="number" min={0} value={recalculated} onChange={(e) => setRecalculated(e.target.value)} className="sg-num" />
        </Field>
        <Field label="Payment date">
          <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </Field>
        <label className="mt-5 flex cursor-pointer items-center gap-2 text-sm text-sg-text">
          <input type="checkbox" checked={fault} onChange={(e) => setFault(e.target.checked)} className="accent-sg-white" />
          Employee personally at fault
        </label>
        <Field label="Notes" className="col-span-2">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Evidence, invoice / credit note references…" className="min-h-[64px]" />
        </Field>

        <div className="col-span-2 space-y-2 rounded-lg border border-sg-line bg-sg-card-2/50 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-sg-muted">Clawback amount (original − recalculated)</span>
            <span className="sg-num font-display text-base font-extrabold text-sg-white">{formatIDR(amount, "full")}</span>
          </div>
          {amount > 0 ? (
            <div className="flex items-center justify-between">
              <span className="text-sg-muted">Recovery schedule {profile ? "" : "(no HR record — salary unknown)"}</span>
              <span className="sg-num text-sg-white">
                {sched.months} months × {formatIDR(sched.monthly, "full")} <span className="text-sg-dim">(cap {formatIDR(sched.monthlyCap)}/mo)</span>
              </span>
            </div>
          ) : null}
          {amount > 0 && !sched.feasible ? <Callout tone="danger">Cannot be recovered within 12 months at ≤ 20% of monthly gross salary — the balance would be pursued by civil recovery or settlement.</Callout> : null}
          {exempt ? <Callout tone="warn">Exempt: {exempt}. You can still record it, then waive.</Callout> : null}
          <p className="text-2xs text-sg-dim">No penalties or interest are charged on clawbacks.</p>
        </div>
      </div>
    </Modal>
  );
}
