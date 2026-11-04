"use client";

/* §6.3 deferred bonus ledger with vesting conditions and release / forfeit actions. */
import { useMemo, useState } from "react";
import { CircleCheck, CircleX, Hourglass, PiggyBank, SquareCheck } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { DeferredBonus } from "@/lib/initiatives/types";
import { paymentOutcome } from "@/lib/initiatives/engine";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Chip, EmptyState } from "@/components/ui/misc";
import { Modal } from "@/components/ui/overlays";
import { Cite, Metric, Money } from "@/components/initiatives/shared";
import { Callout, InitiativeLink, Panel, UserCell, dueText, monthLabel, parseAmount, tdCls, tdNum, thCls, thRight } from "./common";

const CONDITIONS = [
  { key: "paid", label: "Client has paid all invoices" },
  { key: "warranty", label: "No material warranty claims" },
  { key: "overruns", label: "No significant cost overruns" },
  { key: "forecast", label: "Final net revenue within 10% of forecast" },
] as const;
type CondKey = (typeof CONDITIONS)[number]["key"];

const statusColor = { pending: "yellow", released: "green", forfeited: "red" } as const;

export function DeferredTab() {
  const deferred = useCrm((s) => s.deferredBonuses);
  const [filter, setFilter] = useState<"all" | DeferredBonus["status"]>("pending");
  const [checks, setChecks] = useState<Record<string, Partial<Record<CondKey, boolean>>>>({});
  const [action, setAction] = useState<{ kind: "partial" | "forfeit"; item: DeferredBonus } | null>(null);
  const releaseDeferred = useCrm((s) => s.releaseDeferred);
  const notify = useUi((s) => s.notify);
  const profiles = useCrm((s) => s.employeeProfiles);

  const rows = useMemo(() => [...deferred].filter((d) => filter === "all" || d.status === filter).sort((a, b) => a.vestAt.localeCompare(b.vestAt)), [deferred, filter]);
  const stats = useMemo(() => {
    const pending = deferred.filter((d) => d.status === "pending");
    return {
      pending: pending.reduce((s, d) => s + d.amount, 0),
      pendingCount: pending.length,
      vested: pending.filter((d) => Date.parse(d.vestAt) <= Date.now()).length,
      released: deferred.filter((d) => d.status === "released").reduce((s, d) => s + d.releasedAmount, 0),
      forfeited: deferred.filter((d) => d.status !== "pending").reduce((s, d) => s + (d.amount - (d.status === "released" ? d.releasedAmount : 0)), 0),
    };
  }, [deferred]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-sg-line bg-sg-card px-4 py-3">
        <Metric label="Pending deferred" value={formatIDR(stats.pending)} hint={`${stats.pendingCount} entries`} tone={stats.pending ? "yellow" : undefined} />
        <Metric label="Vested · awaiting review" value={String(stats.vested)} tone={stats.vested ? "orange" : undefined} hint="vest date reached" />
        <Metric label="Released to date" value={formatIDR(stats.released)} tone="green" />
        <Metric label="Forfeited to date" value={formatIDR(stats.forfeited)} tone={stats.forfeited ? "red" : undefined} />
        <div className="ml-auto max-w-sm text-2xs text-sg-dim">
          High-risk projects defer 30% of each bonus for 6–12 months <Cite s="6.3" />. Deferred bonuses earn no interest. Partial releases forfeit the remainder proportionally.
        </div>
      </div>

      <Panel
        title="Deferred bonus ledger"
        icon={PiggyBank}
        cite="6.3"
        bodyClassName="p-0"
        actions={
          <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} wrapperClassName="w-36">
            <option value="pending">Pending</option>
            <option value="released">Released</option>
            <option value="forfeited">Forfeited</option>
            <option value="all">All</option>
          </Select>
        }
      >
        {!rows.length ? (
          <EmptyState icon={Hourglass} title={filter === "pending" ? "Nothing pending" : "No deferred bonuses"}>
            Deferred entries are created when PRC authorises release of a run containing §6.3 deferrals or §6.1 carry-overs.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-sg-line">
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Project</th>
                  <th className={thCls}>Earned</th>
                  <th className={thRight}>Amount</th>
                  <th className={thCls}>Vests</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Vesting conditions</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const profile = profiles.find((p) => p.userId === d.userId);
                  const employed = paymentOutcome(profile, new Date().toISOString(), d.month);
                  const c = checks[d.id] ?? {};
                  const allTicked = CONDITIONS.every((k) => c[k.key]);
                  const vested = Date.parse(d.vestAt) <= Date.now();
                  return (
                    <tr key={d.id} className="border-b border-sg-line align-top">
                      <td className={tdCls}>
                        <UserCell userId={d.userId} />
                      </td>
                      <td className={cn(tdCls, "max-w-[220px]")}>
                        <InitiativeLink id={d.initiativeId} />
                        {d.note ? <div className="mt-0.5 text-2xs text-sg-dim">{d.note}</div> : null}
                      </td>
                      <td className={cn(tdCls, "text-sg-muted")}>{monthLabel(d.month)}</td>
                      <td className={cn(tdNum, "font-semibold text-sg-white")}>
                        <Money value={d.amount} />
                        {d.status === "released" && d.releasedAmount < d.amount ? <div className="text-2xs font-normal text-sg-dim">released {formatIDR(d.releasedAmount)}</div> : null}
                      </td>
                      <td className={tdCls}>
                        <div className="text-sg-text">{formatDate(d.vestAt, "medium")}</div>
                        {d.status === "pending" ? <div className={cn("text-2xs", vested ? "text-soft-orange" : "text-sg-dim")}>{vested ? "vested — review now" : dueText(d.vestAt)}</div> : null}
                      </td>
                      <td className={tdCls}>
                        <Chip color={statusColor[d.status]} dot>
                          {d.status === "pending" ? "Pending" : d.status === "released" ? (d.releasedAmount < d.amount ? "Partly released" : "Released") : "Forfeited"}
                        </Chip>
                      </td>
                      <td className={cn(tdCls, "min-w-[260px]")}>
                        {d.status === "pending" ? (
                          <ul className="space-y-1 text-2xs">
                            {CONDITIONS.map((k) => (
                              <li key={k.key}>
                                <label className="flex cursor-pointer items-center gap-1.5 text-sg-muted hover:text-sg-white">
                                  <input type="checkbox" className="accent-sg-white" checked={!!c[k.key]} onChange={(e) => setChecks((s) => ({ ...s, [d.id]: { ...s[d.id], [k.key]: e.target.checked } }))} />
                                  {k.label}
                                </label>
                              </li>
                            ))}
                            <li className={cn("flex items-center gap-1.5", employed.kind === "pay" ? "text-soft-green" : "text-soft-red")} title={employed.kind === "pay" ? "Computed from the HR record" : "reason" in employed ? employed.reason : "Probationary"}>
                              {employed.kind === "pay" ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
                              Still employed &amp; in good standing {employed.kind !== "pay" ? `— ${"reason" in employed ? employed.reason : "on probation"}` : "(HR record)"}
                            </li>
                          </ul>
                        ) : (
                          <span className="text-2xs text-sg-dim">—</span>
                        )}
                      </td>
                      <td className={cn(tdCls, "text-right")}>
                        {d.status === "pending" ? (
                          <div className="flex flex-col items-end gap-1">
                            <Button
                              size="xs"
                              variant="primary"
                              disabled={!allTicked || employed.kind !== "pay"}
                              title={!allTicked ? "Tick every vesting condition first" : employed.kind !== "pay" ? "Employee no longer meets the employment condition" : "Release the full deferred amount"}
                              onClick={() => {
                                releaseDeferred(d.id, d.amount, "All §6.3 vesting conditions met — released in full");
                                notify("Deferred bonus released in full");
                              }}
                            >
                              <SquareCheck /> Release
                            </Button>
                            <Button size="xs" variant="outline" disabled={employed.kind !== "pay"} onClick={() => setAction({ kind: "partial", item: d })}>
                              Release partially
                            </Button>
                            <Button size="xs" variant="danger" onClick={() => setAction({ kind: "forfeit", item: d })}>
                              Forfeit
                            </Button>
                            {!allTicked && employed.kind === "pay" ? <span className="text-2xs text-sg-dim">tick all conditions to release</span> : null}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {action ? <DeferredActionModal action={action} conditions={checks[action.item.id] ?? {}} onClose={() => setAction(null)} /> : null}
    </div>
  );
}

function DeferredActionModal({ action, conditions, onClose }: { action: { kind: "partial" | "forfeit"; item: DeferredBonus }; conditions: Partial<Record<CondKey, boolean>>; onClose: () => void }) {
  const releaseDeferred = useCrm((s) => s.releaseDeferred);
  const forfeitDeferred = useCrm((s) => s.forfeitDeferred);
  const notify = useUi((s) => s.notify);
  const d = action.item;
  const failed = CONDITIONS.filter((c) => !conditions[c.key]).map((c) => c.label);
  const [amount, setAmount] = useState(String(Math.round(d.amount / 2)));
  const [reason, setReason] = useState(failed.length ? `Not met: ${failed.join("; ")}` : "");
  const amt = Math.min(d.amount, Math.max(0, parseAmount(amount)));
  const valid = action.kind === "partial" ? amt > 0 && amt < d.amount && reason.trim().length > 0 : reason.trim().length > 0;

  const submit = () => {
    if (!valid) return;
    if (action.kind === "partial") {
      releaseDeferred(d.id, amt, `Partial release ${formatIDR(amt, "full")} of ${formatIDR(d.amount, "full")} — remainder ${formatIDR(d.amount - amt, "full")} forfeited proportionally. ${reason.trim()}`);
      notify("Deferred bonus partially released");
    } else {
      forfeitDeferred(d.id, reason.trim());
      notify("Deferred bonus forfeited");
    }
    onClose();
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={action.kind === "partial" ? "Release deferred bonus partially" : "Forfeit deferred bonus"}
      description={`${formatIDR(d.amount, "full")} earned ${monthLabel(d.month)} · vests ${formatDate(d.vestAt, "medium")}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={action.kind === "partial" ? "primary" : "danger"} size="sm" disabled={!valid} onClick={submit}>
            {action.kind === "partial" ? "Release partially" : "Forfeit"}
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
        {action.kind === "partial" ? (
          <>
            <Field label="Amount to release (IDR)" hint={`Remainder forfeited: ${formatIDR(d.amount - amt, "full")} (${d.amount ? Math.round(((d.amount - amt) / d.amount) * 100) : 0}%)`}>
              <Input type="number" min={0} max={d.amount} value={amount} onChange={(e) => setAmount(e.target.value)} className="sg-num" autoFocus />
            </Field>
            <Callout>Use when conditions are only partly met — e.g. final net revenue came in below forecast, so the deferral is reduced in proportion (§6.3).</Callout>
          </>
        ) : (
          <Callout tone="danger">The full deferred amount is forfeited. It does not redistribute to other team members.</Callout>
        )}
        <Field label={action.kind === "partial" ? "Rationale" : "Reason"}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Which §6.3 condition was not met?" autoFocus={action.kind === "forfeit"} />
        </Field>
        <p className="text-2xs text-sg-dim">Deferred bonuses earn no interest. ⌘/Ctrl+Enter to submit.</p>
      </div>
    </Modal>
  );
}
