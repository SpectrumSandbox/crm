"use client";

/*
 * §9.3 deferred bonus ledger: vesting 6–12 months after project close, holds for invoiced-and-overdue payments
 * (future milestones are not invoices), project-level release that allocates warranty / rework costs once,
 * §10 status check at the collection date. Release and forfeiture are PRC decisions (§13.2).
 */
import { useMemo, useState } from "react";
import { CircleAlert, CircleCheck, CircleX, Hourglass, PiggyBank, SquareCheck } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { DeferredBonus, EmployeeProfile, Initiative, RevenueEntry } from "@/lib/initiatives/types";
import { collectionWindow, cycleMonth, deferralShare, deferralVestDate, monthStart, netRevenue, paymentDate, paymentOutcome, projectRate, proposalEconomics, type PaymentOutcome } from "@/lib/initiatives/engine";
import { useAccess } from "@/lib/access-control";
import { POLICY } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Chip, EmptyState } from "@/components/ui/misc";
import { Modal } from "@/components/ui/overlays";
import { Cite, Metric, Money } from "@/components/initiatives/shared";
import { AmountInput, Callout, InitiativeLink, Panel, RoleNote, UserCell, dueText, exactIdr, monthLabel, parseAmount, pctLabel, tdCls, tdNum, thCls, thRight, useInitiativeMap } from "./common";

const statusColor = { pending: "yellow", released: "green", forfeited: "red" } as const;

interface Review {
  d: DeferredBonus;
  ini: Initiative | undefined;
  vestAt: string;
  estimated: boolean;
  vested: boolean;
  closed: boolean;
  /** earned and invoiced, past the cut-off of the cycle it was due in, not collected (§9.3 hold) */
  unpaid: RevenueEntry[];
  /** milestones / payments not yet due — not invoices, no hold */
  upcoming: RevenueEntry[];
  outcome: PaymentOutcome;
  payOn: string;
  ready: boolean;
}

function review(d: DeferredBonus, ini: Initiative | undefined, entries: RevenueEntry[], profile: EmployeeProfile | undefined, now: number): Review {
  const vestAt = ini ? deferralVestDate(ini) : d.vestAt;
  const closed = !!ini?.completedAt;
  const vested = closed && Date.parse(vestAt) <= now;
  const open = entries.filter((e) => e.initiativeId === d.initiativeId && !e.received);
  const overdue = (e: RevenueEntry) => Date.parse(collectionWindow(e.month).to) < now;
  const unpaid = open.filter(overdue);
  const upcoming = open.filter((e) => !overdue(e));
  // the deferred bonus was earned on payments collected by the cut-off of its cycle, for work before it (§10)
  const collected = (d as DeferredBonus & { collectedAt?: string | null }).collectedAt ?? collectionWindow(d.month).to;
  const outcome = paymentOutcome(profile, new Date(now).toISOString(), collected, monthStart(d.month));
  const payOn = paymentDate(cycleMonth(new Date(Math.max(Date.parse(vestAt), now)).toISOString()));
  return { d, ini, vestAt, estimated: !closed, vested, closed, unpaid, upcoming, outcome, payOn, ready: vested && outcome.kind === "pay" };
}

export function DeferredTab() {
  const deferred = useCrm((s) => s.deferredBonuses);
  const entries = useCrm((s) => s.revenueEntries);
  const profiles = useCrm((s) => s.employeeProfiles);
  const iniMap = useInitiativeMap();
  const access = useAccess();
  const [filter, setFilter] = useState<"all" | DeferredBonus["status"]>("pending");
  const [releasing, setReleasing] = useState<string | null>(null);
  const [forfeiting, setForfeiting] = useState<Review | null>(null);

  const now = useMemo(() => Date.now(), []);
  const reviews = useMemo(() => deferred.map((d) => review(d, iniMap.get(d.initiativeId), entries, profiles.find((p) => p.userId === d.userId), now)), [deferred, iniMap, entries, profiles, now]);
  const rows = useMemo(() => reviews.filter((r) => filter === "all" || r.d.status === filter).sort((a, b) => a.vestAt.localeCompare(b.vestAt)), [reviews, filter]);
  const stats = useMemo(() => {
    const pending = reviews.filter((r) => r.d.status === "pending");
    return {
      pending: pending.reduce((s, r) => s + r.d.amount, 0),
      pendingCount: pending.length,
      ready: pending.filter((r) => r.ready && !r.unpaid.length).length,
      heldInvoices: pending.filter((r) => r.unpaid.length).reduce((s, r) => s + r.d.amount, 0),
      upcoming: new Set(pending.flatMap((r) => r.upcoming.map((e) => e.id))).size,
      released: deferred.filter((d) => d.status === "released").reduce((s, d) => s + d.releasedAmount, 0),
      reduced: deferred.filter((d) => d.status !== "pending").reduce((s, d) => s + (d.amount - (d.status === "released" ? d.releasedAmount : 0)), 0),
    };
  }, [reviews, deferred]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-sg-line bg-sg-card px-4 py-3">
        <Metric label="Deferred, not yet due" value={formatIDR(stats.pending)} hint={`${stats.pendingCount} entries`} tone={stats.pending ? "yellow" : undefined} />
        <Metric label="Ready to release" value={String(stats.ready)} tone={stats.ready ? "green" : undefined} hint="closed, vested, invoices paid" />
        <Metric label="Held · overdue invoices" value={formatIDR(stats.heldInvoices)} tone={stats.heldInvoices ? "orange" : undefined} hint={stats.upcoming ? `${stats.upcoming} future milestone${stats.upcoming === 1 ? "" : "s"} not yet due — no hold` : "invoiced, past the cycle cut-off"} />
        <Metric label="Released to date" value={formatIDR(stats.released)} tone="green" />
        <Metric label="Reduced / forfeited" value={formatIDR(stats.reduced)} tone={stats.reduced ? "red" : undefined} />
        <div className="ml-auto max-w-md text-2xs text-sg-dim">
          On high-risk projects up to {Math.round(POLICY.deferral.maxPct * 100)}% of each interim bonus is deferred for {POLICY.deferral.minMonths}–{POLICY.deferral.maxMonths} months after project close <Cite s="9.3" />. It earns no interest and is paid in the cycle after the deferral period ends, subject to §10.
        </div>
      </div>

      <Panel
        title="Deferred bonus ledger"
        icon={PiggyBank}
        cite="9.3"
        bodyClassName="p-0"
        actions={
          <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} wrapperClassName="w-36" aria-label="Filter">
            <option value="pending">Pending</option>
            <option value="released">Released</option>
            <option value="forfeited">Forfeited</option>
            <option value="all">All</option>
          </Select>
        }
      >
        {!rows.length ? (
          <EmptyState icon={Hourglass} title={filter === "pending" ? "Nothing pending" : "No deferred bonuses"}>
            Deferred entries are created when the PRC releases a monthly run with lines on a project where a §9.3 trigger applies.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1160px] text-sm">
              <thead>
                <tr className="border-b border-sg-line">
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Project</th>
                  <th className={thCls}>Earned</th>
                  <th className={thRight}>Amount</th>
                  <th className={thCls}>Vests</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Conditions</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const { d } = r;
                  return (
                    <tr key={d.id} className="border-b border-sg-line align-top">
                      <td className={tdCls}>
                        <UserCell userId={d.userId} />
                      </td>
                      <td className={cn(tdCls, "max-w-[240px]")}>
                        <InitiativeLink id={d.initiativeId} />
                        {d.note ? <div className="mt-0.5 line-clamp-3 text-2xs text-sg-dim" title={d.note}>{d.note}</div> : null}
                      </td>
                      <td className={cn(tdCls, "text-sg-muted")}>{monthLabel(d.month)}</td>
                      <td className={cn(tdNum, "font-semibold text-sg-white")}>
                        <Money value={d.amount} />
                        {d.status === "released" && d.releasedAmount < d.amount ? <div className="text-2xs font-normal text-sg-dim">released {formatIDR(d.releasedAmount)}</div> : null}
                      </td>
                      <td className={tdCls}>
                        <div className="text-sg-text">{formatDate(r.vestAt, "medium")}</div>
                        {d.status === "pending" ? (
                          <>
                            <div className={cn("text-2xs", r.vested ? "text-soft-green" : "text-sg-dim")}>{r.estimated ? `estimated · ${r.ini?.deferralMonths ?? POLICY.deferral.minMonths} months after the contracted end` : r.vested ? "deferral period ended" : dueText(r.vestAt)}</div>
                            <div className="text-2xs text-sg-dim">pays with the {formatDate(r.payOn, "short")} salary</div>
                          </>
                        ) : null}
                      </td>
                      <td className={tdCls}>
                        <Chip color={statusColor[d.status]} dot>
                          {d.status === "pending" ? "Pending" : d.status === "released" ? (d.releasedAmount < d.amount ? "Released · reduced" : "Released") : "Forfeited"}
                        </Chip>
                      </td>
                      <td className={cn(tdCls, "min-w-[280px] text-2xs")}>
                        {d.status === "pending" ? (
                          <ul className="space-y-1">
                            <Cond ok={r.closed} label={r.closed ? `Project closed ${formatDate(r.ini?.completedAt, "medium")}` : "Project not closed yet (§8.3)"} />
                            <Cond ok={r.vested} label={r.vested ? "Deferral period ended" : `Deferral period runs to ${formatDate(r.vestAt, "medium")}`} />
                            <Cond ok={!r.unpaid.length} warn label={r.unpaid.length ? `${r.unpaid.length} invoice${r.unpaid.length === 1 ? "" : "s"} overdue (${formatIDR(r.unpaid.reduce((s, e) => s + e.revenue, 0))}) — held until paid or written off` : "No overdue invoices on the project"} />
                            {r.upcoming.length ? (
                              <li className="flex items-start gap-1.5 pl-5 text-sg-dim">
                                {r.upcoming.length} future milestone{r.upcoming.length === 1 ? "" : "s"} ({formatIDR(r.upcoming.reduce((s, e) => s + e.revenue, 0))}) not yet due — not an invoice, no hold
                              </li>
                            ) : null}
                            <Cond ok={r.outcome.kind === "pay"} label={r.outcome.kind === "pay" ? r.outcome.note ?? "Employment status allows payment (§10)" : r.outcome.kind === "withhold_probation" ? "On probation — paid with the Probation Completion Bonus (§11)" : r.outcome.reason} />
                          </ul>
                        ) : (
                          <span className="text-sg-dim">—</span>
                        )}
                      </td>
                      <td className={cn(tdCls, "text-right")}>
                        {d.status === "pending" ? (
                          <div className="flex flex-col items-end gap-1">
                            {access.prc ? (
                              <>
                                <Button size="xs" variant="primary" disabled={!r.ready} onClick={() => setReleasing(d.initiativeId)}>
                                  <SquareCheck /> Review &amp; release project
                                </Button>
                                {!r.ready ? <span className="max-w-[180px] text-right text-2xs text-sg-dim">{!r.closed ? "Vests only after project close" : !r.vested ? "Deferral period has not ended" : "Status does not allow payment now (§10)"}</span> : null}
                                {r.outcome.kind === "forfeit" ? (
                                  <Button size="xs" variant="danger" onClick={() => setForfeiting(r)}>
                                    Forfeit (§10)…
                                  </Button>
                                ) : null}
                              </>
                            ) : (
                              <RoleNote>PRC decides release and forfeiture (§13.2)</RoleNote>
                            )}
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

      {releasing ? <ReleaseModal initiativeId={releasing} pending={reviews.filter((x) => x.d.status === "pending" && x.d.initiativeId === releasing)} onClose={() => setReleasing(null)} /> : null}
      {forfeiting ? <ForfeitModal r={forfeiting} onClose={() => setForfeiting(null)} /> : null}
    </div>
  );
}

function Cond({ ok, label, warn }: { ok: boolean; label: string; warn?: boolean }) {
  return (
    <li className={cn("flex items-start gap-1.5", ok ? "text-soft-green" : warn ? "text-soft-orange" : "text-sg-muted")}>
      {ok ? <CircleCheck className="mt-px size-3.5 shrink-0" /> : warn ? <CircleAlert className="mt-px size-3.5 shrink-0" /> : <CircleX className="mt-px size-3.5 shrink-0" />}
      <span>{label}</span>
    </li>
  );
}

/**
 * Project-level release (§9.3): warranty, rework and other deferral-period costs, written-off invoices and a
 * misstated-forecast shortfall are allocated ONCE across every pending entry of the project, pro rata to the amounts.
 * Entries whose holder may be paid now are released; the others keep their reduced amount pending (§10).
 */
function ReleaseModal({ initiativeId, pending, onClose }: { initiativeId: string; pending: Review[]; onClose: () => void }) {
  const releaseDeferred = useCrm((s) => s.releaseDeferred);
  const forfeitDeferred = useCrm((s) => s.forfeitDeferred);
  const reduceDeferred = useCrm((s) => s.reduceDeferred);
  const entries = useCrm((s) => s.revenueEntries);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const userMap = useUserMap();
  const notify = useUi((s) => s.notify);
  const iniMap = useInitiativeMap();
  const ini = iniMap.get(initiativeId);
  const unpaid = pending[0]?.unpaid ?? [];
  const projectPending = pending.reduce((s, x) => s + x.d.amount, 0);
  const earlier = useMemo(() => pending.filter((x) => /§9\.3 project costs/.test(x.d.note)).length, [pending]);

  // §9.3 written-off invoices: the deferred part of the bonus the invoices would have generated (project total)
  const writeOffEstimate = useMemo(() => {
    if (!ini || !unpaid.length) return 0;
    const rate = projectRate(ini, adjustments).rate;
    const defPct = deferralShare(ini, adjustments);
    const net = unpaid.reduce((s, e) => s + Math.max(0, netRevenue(e.revenue, e.directCosts).net), 0);
    return Math.min(projectPending, Math.floor(net * rate * defPct));
  }, [ini, unpaid, adjustments, projectPending]);

  // §9.3 forecast shortfall
  const shortfall = useMemo(() => {
    if (!ini) return null;
    const forecast = proposalEconomics(ini, adjustments).expected.net;
    const actual = entries.filter((e) => e.initiativeId === ini.id && e.received).reduce((s, e) => s + netRevenue(e.revenue, e.directCosts).net, 0);
    const pct = forecast > 0 ? Math.max(0, 1 - actual / forecast) : 0;
    return { forecast, actual, pct };
  }, [ini, entries, adjustments]);

  const [costs, setCosts] = useState(0);
  const [writtenOff, setWrittenOff] = useState(false);
  const [writeOff, setWriteOff] = useState(writeOffEstimate);
  const [misstated, setMisstated] = useState(false);
  const [shortPct, setShortPct] = useState(shortfall ? String(Math.round(shortfall.pct * 1000) / 10) : "0");
  const [note, setNote] = useState("");

  const writeOffTotal = unpaid.length && writtenOff ? Math.max(0, writeOff) : 0;
  const shortfallApplies = !!shortfall && shortfall.pct > POLICY.deferral.forecastShortfallReviewPct;
  const shortCutPct = shortfallApplies && misstated ? Math.min(shortfall!.pct, Math.max(0, parseAmount(shortPct) / 100)) : 0;
  const pool = Math.min(projectPending, costs + writeOffTotal); // costs beyond the deferred pool are absorbed by the company
  const absorbed = Math.max(0, costs + writeOffTotal - projectPending);

  const plan = useMemo(() => {
    let left = pool;
    return pending.map((x, i) => {
      const share = i === pending.length - 1 ? left : Math.min(left, Math.floor((pool * x.d.amount) / (projectPending || 1)));
      left -= share;
      const shortCut = Math.floor((x.d.amount - share) * shortCutPct);
      const cut = Math.min(x.d.amount, share + shortCut);
      return { x, cut, net: x.d.amount - cut, payNow: x.ready };
    });
  }, [pending, pool, projectPending, shortCutPct]);
  const releasing = plan.filter((p) => p.payNow);
  const releaseTotal = releasing.reduce((s, p) => s + p.net, 0);
  const cutTotal = plan.reduce((s, p) => s + p.cut, 0);
  const blockedInvoices = unpaid.length > 0 && !writtenOff;
  const valid = !blockedInvoices && releasing.length > 0 && (cutTotal === 0 || note.trim().length >= 5);

  const submit = () => {
    if (!valid) return;
    const parts = [
      costs ? `warranty/rework costs ${formatIDR(costs, "full")} for the project` : "",
      writeOffTotal ? `written-off invoices ${formatIDR(writeOffTotal, "full")}` : "",
      shortCutPct ? `forecast shortfall ${pctLabel(shortCutPct)} from misstated figures` : "",
    ].filter(Boolean);
    const basis = `${parts.length ? `§9.3 project costs allocated once across ${pending.length} entr${pending.length === 1 ? "y" : "ies"}: ${parts.join("; ")}. ` : "No deductions. "}${note.trim()}`.trim();
    for (const p of plan) {
      if (p.payNow) {
        if (p.net > 0) releaseDeferred(p.x.d.id, p.net, `Released ${formatIDR(p.net, "full")} with the ${formatDate(p.x.payOn, "medium")} salary${p.cut ? ` after ${formatIDR(p.cut, "full")}` : ""} — ${basis}`);
        else forfeitDeferred(p.x.d.id, `Deferred amount fully used by §9.3 deductions — ${basis}`);
      } else if (p.cut > 0) reduceDeferred(p.x.d.id, p.cut, basis);
    }
    notify(`${releasing.length} deferred entr${releasing.length === 1 ? "y" : "ies"} released — ${formatIDR(releaseTotal)}${cutTotal ? ` after ${formatIDR(cutTotal)} §9.3 deductions` : ""}`);
    onClose();
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Release project deferrals"
      description={`${ini?.code ?? ini?.title ?? ""} · ${pending.length} pending entr${pending.length === 1 ? "y" : "ies"} · ${formatIDR(projectPending, "full")} · deductions are allocated once, pro rata (§9.3)`}
      className="w-[min(720px,calc(100vw-32px))]"
      footer={
        <>
          <span className="mr-auto text-2xs text-sg-dim">PRC decision · ⌘/Ctrl+Enter</span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!valid} onClick={submit}>
            Release {formatIDR(releaseTotal)}
          </Button>
        </>
      }
    >
      <div
        className="space-y-4"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      >
        {earlier ? <Callout tone="info">{earlier} entr{earlier === 1 ? "y has" : "ies have"} already borne §9.3 project costs — enter only costs not deducted before.</Callout> : null}
        <div>
          <Field label="Warranty, rework and other costs during the deferral period (project total)" hint={`Deducted once from the project's deferred pool of ${formatIDR(projectPending, "full")}`}>
            <AmountInput value={costs} onChange={setCosts} autoFocus aria-label="Deferral-period costs" />
          </Field>
          {absorbed > 0 ? <p className="mt-1 text-2xs text-sg-muted">{formatIDR(absorbed, "full")} beyond the deferred pool is absorbed by the company — never recovered from salary.</p> : null}
        </div>

        {unpaid.length ? (
          <div className="rounded-lg border border-soft-orange/30 bg-soft-orange/5 p-3">
            <div className="text-xs font-semibold text-soft-orange">
              {unpaid.length} overdue invoice{unpaid.length === 1 ? "" : "s"} · {formatIDR(unpaid.reduce((s, e) => s + e.revenue, 0), "full")} <Cite s="9.3" />
            </div>
            <p className="mt-0.5 text-2xs text-sg-muted">Amounts linked to unpaid invoices are held until they are paid. If an invoice is written off, the deferred pool is reduced by the bonus it generated.</p>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-sg-text">
              <input type="checkbox" className="accent-sg-white" checked={writtenOff} onChange={(e) => setWrittenOff(e.target.checked)} />
              The overdue invoice(s) have been written off
            </label>
            {writtenOff ? (
              <Field label="Reduction for written-off invoices (project total)" hint={`Estimate: net revenue × rate × deferral % = ${formatIDR(writeOffEstimate, "full")}`} className="mt-2">
                <AmountInput value={writeOff} onChange={setWriteOff} aria-label="Write-off reduction" />
              </Field>
            ) : null}
          </div>
        ) : null}

        {shortfall ? (
          <div className={cn("rounded-lg border p-3", shortfallApplies ? "border-soft-yellow/30 bg-soft-yellow/5" : "border-sg-line")}>
            <div className="flex flex-wrap items-baseline gap-x-3 text-xs">
              <span className="font-semibold text-sg-white">Final net vs approved forecast</span>
              <span className="sg-num text-sg-muted">
                {formatIDR(shortfall.actual)} of {formatIDR(shortfall.forecast)}
              </span>
              <span className={cn("sg-num font-semibold", shortfallApplies ? "text-soft-yellow" : "text-sg-muted")}>{shortfall.pct > 0 ? `${pctLabel(shortfall.pct)} short` : "on or above forecast"}</span>
            </div>
            {shortfallApplies ? (
              <>
                <p className="mt-1 text-2xs text-sg-muted">More than {Math.round(POLICY.deferral.forecastShortfallReviewPct * 100)}% below forecast — the PRC reviews the reasons. Only if the shortfall came from figures misstated at approval may it reduce the deferred amounts, by up to the percentage shortfall.</p>
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-sg-text">
                  <input type="checkbox" className="accent-sg-white" checked={misstated} onChange={(e) => setMisstated(e.target.checked)} />
                  PRC finding: the shortfall came from figures misstated at approval
                </label>
                {misstated ? (
                  <Field label="Reduction (%)" hint={`Up to ${pctLabel(shortfall.pct)}`} className="mt-2">
                    <Input type="number" min={0} max={Math.round(shortfall.pct * 1000) / 10} step={0.1} value={shortPct} onChange={(e) => setShortPct(e.target.value)} className="sg-num w-28" />
                  </Field>
                ) : null}
              </>
            ) : (
              <p className="mt-1 text-2xs text-sg-dim">Within {Math.round(POLICY.deferral.forecastShortfallReviewPct * 100)}% of forecast — no shortfall reduction applies.</p>
            )}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-lg border border-sg-line">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-sg-line">
                <th className={thCls}>Entry</th>
                <th className={thRight}>Deferred</th>
                <th className={thRight}>Deduction</th>
                <th className={thRight}>Result</th>
              </tr>
            </thead>
            <tbody>
              {plan.map((p) => (
                <tr key={p.x.d.id} className="border-b border-sg-line last:border-b-0">
                  <td className={tdCls}>
                    <span className="font-semibold text-sg-white">{userMap.get(p.x.d.userId)?.name ?? p.x.d.userId}</span>
                    <span className="text-sg-dim"> · {monthLabel(p.x.d.month)}</span>
                    {!p.payNow ? <span className="block text-2xs text-soft-yellow">{p.x.outcome.kind === "pay" ? "Not vested" : p.x.outcome.kind === "withhold_probation" ? "On probation — stays pending" : p.x.outcome.reason} — stays pending at the reduced amount</span> : null}
                  </td>
                  <td className={tdNum}>{exactIdr(p.x.d.amount)}</td>
                  <td className={cn(tdNum, p.cut ? "text-soft-red" : "text-sg-dim")}>{exactIdr(-p.cut)}</td>
                  <td className={cn(tdNum, "font-semibold", p.payNow ? "text-soft-green" : "text-sg-muted")}>
                    {exactIdr(p.net)}
                    <span className="block text-2xs font-normal text-sg-dim">{p.payNow ? `paid ${formatDate(p.x.payOn, "short")}` : "pending"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Field label={cutTotal ? "PRC rationale for the deductions" : "Note (optional)"}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={cutTotal ? "Warranty claim reference, write-off approval, PRC minute…" : "e.g. vesting confirmed at the close-out review"} className="min-h-[64px]" />
        </Field>
        {blockedInvoices ? <Callout tone="warn">Held until the overdue invoices are paid, or tick the write-off box to reduce and release.</Callout> : null}
        {!releasing.length ? <Callout tone="warn">No entry on this project can be paid now — nothing to release.</Callout> : null}
      </div>
    </Modal>
  );
}

/** §10 forfeiture of a deferred amount — PRC decision with a confirmation (it cannot be undone). */
function ForfeitModal({ r, onClose }: { r: Review; onClose: () => void }) {
  const forfeitDeferred = useCrm((s) => s.forfeitDeferred);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const [ref, setRef] = useState("");
  const reason = r.outcome.kind === "forfeit" ? r.outcome.reason : "";
  const submit = () => {
    if (ref.trim().length < 5) return;
    forfeitDeferred(r.d.id, `Forfeited under §10 — ${reason}. ${ref.trim()}`);
    notify("Deferred bonus forfeited under §10");
    onClose();
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Forfeit deferred bonus (§10)"
      description={`${userMap.get(r.d.userId)?.name ?? r.d.userId} · ${formatIDR(r.d.amount, "full")} earned ${monthLabel(r.d.month)} — forfeited amounts return to the company and are not redistributed`}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" disabled={ref.trim().length < 5} onClick={submit}>
            Forfeit {formatIDR(r.d.amount)}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Callout tone="danger">{reason}</Callout>
        <Field label="PRC decision reference" hint="Minute or decision number; the audit log records you as the person who entered it (§13.3)">
          <Input autoFocus value={ref} onChange={(e) => setRef(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="e.g. PRC minute 2026-11-26 item 4" />
        </Field>
      </div>
    </Modal>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-sg-muted">{label}</span>
      <span className="sg-num text-sg-text">{formatIDR(value, "full")}</span>
    </div>
  );
}
