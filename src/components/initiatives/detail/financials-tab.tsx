"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { ArrowUpRight, Banknote, Check, ChevronDown, Coins, Info, Lock, Pencil, PiggyBank, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { Initiative, Milestone, RevenueEntry } from "@/lib/initiatives/types";
import { revenueEntryLock, workPeriodFromDates, computeRun, cycleMonth, directCostTotal, monthEnd, monthKey, monthStart, netRevenue, paymentDate, projectCycles, projectPayments, proposalEconomics, rateReview, standardBonusOf } from "@/lib/initiatives/engine";
import { POLICY } from "@/lib/initiatives/policy";
import { cn, formatDate, fromDateInput, toDateInput } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Avatar, Chip, EmptyState } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/overlays";
import { Cite, Money, Rate, milestoneWorkPeriods } from "@/components/initiatives/shared";
import { Card, onCmdEnter } from "./ui";
import { parseAmount } from "@/lib/initiatives/team-rules";
import { paymentLocked } from "@/lib/slices/governance";
import { ChangeOrdersCard } from "@/components/projects/change-orders";
import { CorrectionDialog } from "@/components/projects/correction-dialog";

const FIN_STATUSES = new Set(["approved", "active", "completed"]);
/** Company figures large enough that the §9.1 checks pass in a per-project projection. */
const PASS = 1e15;

type Draft = { basis: RevenueEntry["basis"]; received: boolean; collectedAt: string; workStart: string; workEnd: string; revenue: string; directCosts: string; note: string };

const todayInput = () => toDateInput(new Date().toISOString());
const emptyDraft = (): Draft => {
  const m = monthKey(new Date());
  return { basis: "recognized", received: false, collectedAt: todayInput(), workStart: toDateInput(monthStart(m)), workEnd: toDateInput(monthEnd(m)), revenue: "", directCosts: "", note: "" };
};
const toDraft = (e: RevenueEntry): Draft => ({
  basis: e.basis,
  received: e.received,
  collectedAt: e.collectedAt ? toDateInput(e.collectedAt) : todayInput(),
  workStart: toDateInput(e.workPeriodStart ?? monthStart(e.month)),
  workEnd: toDateInput(e.workPeriodEnd ?? monthEnd(e.month)),
  revenue: String(e.revenue),
  directCosts: String(e.directCosts),
  note: e.note ?? "",
});
/** Rupiah amount typed in id-ID or en style ("7.200.000", "7,2" …) — team-rules.parseAmount. */
const num = (s: string) => {
  const n = parseAmount(String(s));
  return Number.isFinite(n) ? n : 0;
};
/** Collected at 12:00 WIB on the chosen day (the cut-off is the 20th, §8.2). */
const collectedIso = (d: string) => new Date(`${d}T12:00:00+07:00`).toISOString();

export function FinancialsTab({ ini }: { ini: Initiative }) {
  if (!FIN_STATUSES.has(ini.status)) {
    return (
      <div className="rounded-xl border border-sg-line bg-sg-card">
        <EmptyState icon={Lock} title="Financials open after PRC approval">
          Client payments are recorded against approved, active or completed projects. Bonuses follow revenue that is both earned and collected, cumulatively, less direct costs and the UMKM final tax (§8.1, §5.4).
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <PaymentsCard ini={ini} />
      <ChangeOrdersCard ini={ini} />
      {ini.type === "C" ? <TypeCCyclesCard ini={ini} /> : null}
      <BonusByMember ini={ini} />
    </div>
  );
}

/** Payment milestones that have no payment entry yet (matched by name or by the work period's end). */
function openMilestones(ini: Initiative, entries: RevenueEntry[]) {
  const mine = entries.filter((e) => e.initiativeId === ini.id);
  return [...ini.milestones]
    .filter((m) => m.paymentAmount > 0)
    .filter((m) => !mine.some((e) => (m.name && e.note.trim().toLowerCase().startsWith(m.name.trim().toLowerCase())) || (e.basis === "milestone" && e.workPeriodEnd && toDateInput(e.workPeriodEnd) === toDateInput(m.dueDate))))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function PaymentsCard({ ini }: { ini: Initiative }) {
  const allEntries = useCrm((s) => s.revenueEntries);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const addRevenueEntry = useCrm((s) => s.addRevenueEntry);
  const updateRevenueEntry = useCrm((s) => s.updateRevenueEntry);
  const deletePayment = useCrm((s) => s.deletePayment);
  const restorePayment = useCrm((s) => s.restorePayment);
  const runs = useCrm((s) => s.bonusRuns);
  const notify = useUi((s) => s.notify);
  const [editing, setEditing] = useState<string | null>(null); // entry id or "new"
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<RevenueEntry | null>(null);

  const econ = useMemo(() => proposalEconomics(ini, adjustments), [ini, adjustments]);
  const review = useMemo(() => rateReview(ini, allEntries, adjustments), [ini, allEntries, adjustments]);
  const pools = useMemo(() => new Map(projectPayments(ini, allEntries, adjustments).map((p) => [p.entry.id, p] as const)), [ini, allEntries, adjustments]);
  const rows = useMemo(
    () =>
      allEntries
        .filter((e) => e.initiativeId === ini.id)
        .map((e) => {
          const { tax, net } = netRevenue(e.revenue, e.directCosts);
          const p = pools.get(e.id);
          const cycle = e.received && e.collectedAt ? cycleMonth(e.collectedAt) : e.month;
          return { e, tax, net, p, cycle };
        })
        .sort((a, b) => b.cycle.localeCompare(a.cycle) || (b.e.collectedAt ?? "").localeCompare(a.e.collectedAt ?? "")),
    [allEntries, ini.id, pools],
  );
  const totals = useMemo(
    () => rows.reduce((s, r) => ({ revenue: s.revenue + r.e.revenue, costs: s.costs + r.e.directCosts, tax: s.tax + r.tax, net: s.net + r.net, pool: s.pool + (r.p?.pool ?? 0), collected: s.collected + (r.e.received ? r.e.revenue : 0), collectedNet: s.collectedNet + (r.e.received ? r.net : 0) }), { revenue: 0, costs: 0, tax: 0, net: 0, pool: 0, collected: 0, collectedNet: 0 }),
    [rows],
  );
  const pending = useMemo(() => openMilestones(ini, allEntries), [ini, allEntries]);
  const periods = useMemo(() => milestoneWorkPeriods(ini.milestones, ini.startDate), [ini.milestones, ini.startDate]);
  const costRatio = ini.revenue.expected > 0 ? directCostTotal(ini.costs) / ini.revenue.expected : 0;

  // §9.3 / §5.1 hints: actual net vs the forecast net margin on what has been collected
  const forecastNet = ini.revenue.expected > 0 ? totals.collected * (econ.expected.net / ini.revenue.expected) : 0;
  const deviation = forecastNet > 0 && totals.collected > 0 ? totals.collectedNet / forecastNet - 1 : null;

  const startNew = () => {
    setDraft(emptyDraft());
    setEditing("new");
  };
  const fromMilestone = (m: Milestone) => {
    const wp = periods.get(m.id);
    setDraft({
      basis: "milestone",
      received: false,
      collectedAt: todayInput(),
      workStart: toDateInput(wp?.from ?? ini.startDate),
      workEnd: toDateInput(m.dueDate),
      revenue: String(Math.round(m.paymentAmount)),
      directCosts: String(Math.round(m.paymentAmount * costRatio)),
      note: m.name,
    });
    setEditing("new");
  };
  const startEdit = (e: RevenueEntry) => {
    setDraft(toDraft(e));
    setEditing(e.id);
  };
  const cancel = () => setEditing(null);
  const errors: string[] = [];
  if (draft.revenue.trim() === "" || !Number.isFinite(parseAmount(draft.revenue)) || num(draft.revenue) < 0) errors.push("Revenue");
  if (draft.directCosts.trim() && !Number.isFinite(parseAmount(draft.directCosts))) errors.push("Direct costs is not a number");
  const editingEntry = editing && editing !== "new" ? allEntries.find((e) => e.id === editing) : undefined;
  if (editingEntry && paymentLocked(editingEntry, runs)) errors.push(`The ${editingEntry.month} cycle has been released — record a correcting payment instead (§8.5)`);
  if (num(draft.directCosts) < 0) errors.push("Direct costs");
  if (!draft.workStart || !draft.workEnd || draft.workEnd < draft.workStart) errors.push("Work period");
  if (draft.received && !draft.collectedAt) errors.push("Collection date");
  const valid = errors.length === 0;
  const draftCycle = draft.received && draft.collectedAt ? cycleMonth(collectedIso(draft.collectedAt)) : draft.workEnd ? monthKey(fromDateInput(draft.workEnd)) : monthKey(new Date());

  const save = () => {
    if (!valid) return;
    const payload: Omit<RevenueEntry, "id" | "initiativeId"> = {
      month: draftCycle,
      basis: draft.basis,
      received: draft.received,
      collectedAt: draft.received ? collectedIso(draft.collectedAt) : null,
      workPeriodStart: workPeriodFromDates(draft.workStart, draft.workEnd).start,
      workPeriodEnd: workPeriodFromDates(draft.workStart, draft.workEnd).end,
      revenue: num(draft.revenue),
      directCosts: num(draft.directCosts),
      note: draft.note.trim(),
    };
    if (editing === "new") {
      addRevenueEntry({ initiativeId: ini.id, ...payload });
      notify(payload.received ? `Payment collected — salary cycle ${payload.month}, paid ${formatDate(paymentDate(payload.month), "medium")}` : "Payment recorded as earned, awaiting collection");
    } else if (editing) {
      // the engine refuses (false) amount/date edits of a payment paid in a released cycle — record a correction instead (§8.5)
      if (!updateRevenueEntry(editing, payload)) {
        notify("Refused — this payment was paid in a released cycle; record a correction (§8.5)");
        return;
      }
      notify("Payment updated");
    }
    setEditing(null);
  };

  const preview = (() => {
    const { tax, net } = netRevenue(num(draft.revenue), num(draft.directCosts));
    return { tax, net };
  })();

  const editor = (
    <tr className="border-b border-sg-line bg-sg-card-2/60 align-top" onKeyDown={onCmdEnter(save)}>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <Input type="date" value={draft.workStart} onChange={(e) => setDraft({ ...draft, workStart: e.target.value })} className="h-7 w-[124px] text-xs" aria-label="Work period start" autoFocus />
          <span className="text-sg-dim">→</span>
          <Input type="date" value={draft.workEnd} onChange={(e) => setDraft({ ...draft, workEnd: e.target.value })} className="h-7 w-[124px] text-xs" aria-label="Work period end" />
        </div>
        <Input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Milestone / invoice no." className="mt-1 h-7 text-xs" aria-label="Note" />
      </td>
      <td className="px-2 py-2">
        <Select value={draft.basis} onChange={(e) => setDraft({ ...draft, basis: e.target.value as RevenueEntry["basis"] })} className="h-7 text-xs" wrapperClassName="w-[130px]" aria-label="Earned basis">
          <option value="milestone">Milestone accepted</option>
          <option value="recognized">Period billed</option>
        </Select>
      </td>
      <td className="px-2 py-2">
        <label className="flex items-center gap-1.5 text-2xs text-sg-muted">
          <input type="checkbox" checked={draft.received} onChange={(e) => setDraft({ ...draft, received: e.target.checked })} aria-label="Collected" className="size-3.5 cursor-pointer accent-white" />
          Collected
        </label>
        {draft.received ? <Input type="date" value={draft.collectedAt} onChange={(e) => setDraft({ ...draft, collectedAt: e.target.value })} className="mt-1 h-7 w-[124px] text-xs" aria-label="Collection date" /> : null}
      </td>
      <td className="sg-num px-2 py-2 text-xs text-sg-muted">
        {draftCycle}
        <div className="text-2xs text-sg-dim">{draft.received ? `paid ${formatDate(paymentDate(draftCycle), "short")}` : "expected"}</div>
      </td>
      <td className="px-2 py-2">
        <Input type="number" min={0} step={1000} value={draft.revenue} onChange={(e) => setDraft({ ...draft, revenue: e.target.value })} placeholder="Revenue" className="h-7 w-[120px] text-right text-xs" aria-label="Revenue excl. VAT" />
      </td>
      <td className="px-2 py-2">
        <Input type="number" min={0} step={1000} value={draft.directCosts} onChange={(e) => setDraft({ ...draft, directCosts: e.target.value })} placeholder="Direct costs" className="h-7 w-[120px] text-right text-xs" aria-label="Direct costs" />
      </td>
      <td colSpan={4} className="px-2 py-2 text-2xs text-sg-dim">
        UMKM tax <Money value={preview.tax} /> · net <Money value={preview.net} className={preview.net < 0 ? "text-soft-red" : undefined} />
        <div>pool calculated cumulatively once collected (§8.1)</div>
        {!valid ? <div className="text-soft-yellow">Check: {errors.join(", ")}</div> : null}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex justify-end gap-1">
          <Button size="icon-sm" variant="primary" onClick={save} disabled={!valid} aria-label="Save payment" title="Save (⌘↵)">
            <Check />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={cancel} aria-label="Cancel">
            <X />
          </Button>
        </div>
      </td>
    </tr>
  );

  return (
    <Card
      title="Client payments"
      icon={Banknote}
      cite={["8.1", "8.2", "6.5"]}
      actions={
        <>
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={!pending.length || editing === "new"} title={pending.length ? "Prefill a payment from a payment milestone" : "Every payment milestone already has a payment entry"}>
                <Plus /> Add from milestone <ChevronDown className="size-3" />
              </Button>
            </MenuTrigger>
            <MenuContent align="end" className="w-80">
              <MenuLabel>Payment milestones without a payment</MenuLabel>
              {pending.map((m) => (
                <MenuItem key={m.id} onSelect={() => fromMilestone(m)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{m.name || "Milestone"}</span>
                    <span className="text-2xs text-sg-dim">
                      due {formatDate(m.dueDate, "medium")} · <Money value={m.paymentAmount} />
                    </span>
                  </span>
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
          <Button size="sm" variant="primary" onClick={startNew} disabled={editing === "new"}>
            <Plus /> Add payment
          </Button>
        </>
      }
      bodyClassName="p-0"
    >
      {deviation != null && Math.abs(deviation) > POLICY.deferral.forecastShortfallReviewPct ? (
        <div className={cn("flex items-start gap-2 border-b border-sg-line px-4 py-2 text-2xs", deviation < 0 ? "bg-soft-red/5 text-soft-red" : "bg-soft-yellow/5 text-soft-yellow")}>
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          <span>
            Actual net revenue on the revenue collected so far is {(Math.abs(deviation) * 100).toFixed(1)}% {deviation < 0 ? "below" : "above"} the approved forecast (<Money value={totals.collectedNet} /> vs <Money value={forecastNet} />).{" "}
            {deviation < 0 ? (
              <>
                If final net revenue ends more than 10% below forecast, the PRC reviews the reasons and may reduce deferred amounts where figures were misstated at approval<Cite s="9.3" />.
              </>
            ) : (
              <>
                Finance re-forecasts x every 12 months; more than 20% above the x used to set the rate → recalculation for the whole project<Cite s="5.1" />.
              </>
            )}
          </span>
        </div>
      ) : null}
      {review.flags.map((f) => (
        <div key={f} className="flex items-start gap-2 border-b border-sg-line bg-soft-yellow/5 px-4 py-2 text-2xs text-soft-yellow">
          <TriangleAlert className="mt-px size-3.5 shrink-0" /> {f}
        </div>
      ))}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-xs">
          <thead>
            <tr className="border-b border-sg-line text-left">
              <th className="sg-eyebrow px-3 py-2 font-semibold">Work period</th>
              <th className="sg-eyebrow px-2 py-2 font-semibold">Earned</th>
              <th className="sg-eyebrow px-2 py-2 font-semibold">Collected</th>
              <th className="sg-eyebrow px-2 py-2 font-semibold">Salary cycle</th>
              <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Revenue</th>
              <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Direct costs</th>
              <th className="sg-eyebrow px-2 py-2 text-right font-semibold">UMKM tax 0.5%</th>
              <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Net</th>
              <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Cum. net</th>
              <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Payment pool</th>
              <th className="w-20 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {editing === "new" ? editor : null}
            {rows.length === 0 && editing !== "new" ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-sg-dim">
                  No client payments recorded yet.{pending.length ? " Use “Add from milestone” to prefill one from the delivery plan." : ""}
                </td>
              </tr>
            ) : null}
            {rows.map((r) =>
              editing === r.e.id ? (
                <Fragment key={r.e.id}>{editor}</Fragment>
              ) : (
                <tr key={r.e.id} className="group border-b border-sg-line/60 hover:bg-sg-card-2/40">
                  <td className="px-3 py-2">
                    <div className="sg-num text-sg-white">
                      {formatDate(r.e.workPeriodStart ?? monthStart(r.e.month), "short")} → {formatDate(r.e.workPeriodEnd ?? monthEnd(r.e.month), "medium")}
                    </div>
                    {r.e.note ? (
                      <div className="max-w-[220px] truncate text-2xs text-sg-dim" title={r.e.note}>
                        {r.e.note}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    <Chip color={r.e.basis === "recognized" ? "blue" : "magenta"}>{r.e.basis === "recognized" ? "Period billed" : "Milestone accepted"}</Chip>
                  </td>
                  <td className="px-2 py-2">
                    {r.e.received ? (
                      <span className="sg-num text-soft-green">{r.e.collectedAt ? formatDate(r.e.collectedAt, "medium") : "Collected"}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit({ ...r.e, received: true, collectedAt: new Date().toISOString() })}
                        className="text-2xs font-semibold text-soft-yellow hover:underline"
                        title="Record the collection date"
                      >
                        Awaiting collection
                      </button>
                    )}
                  </td>
                  <td className="sg-num px-2 py-2">
                    <span className={r.e.received ? "text-sg-white" : "text-sg-dim"}>{r.cycle}</span>
                    <div className="text-2xs text-sg-dim">{r.e.received ? `paid ${formatDate(paymentDate(r.cycle), "short")}` : "on collection"}</div>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Money value={r.e.revenue} className="text-sg-white" />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Money value={r.e.directCosts} />
                  </td>
                  <td className="px-2 py-2 text-right text-sg-muted">
                    <Money value={r.tax} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Money value={r.net} className={r.net < 0 ? "text-soft-red" : "text-sg-white"} />
                  </td>
                  <td className="px-2 py-2 text-right text-sg-muted">{r.p ? <Money value={r.p.cumNet} /> : <span className="text-sg-dim">—</span>}</td>
                  <td className="px-2 py-2 text-right" title={r.p ? `y × cumulative net ${Math.round(r.p.cumPool).toLocaleString("en-US")} − pool already allocated (§8.1)` : "Counts once the payment is collected (§8.1)"}>
                    {r.p ? <Money value={r.p.pool} className="font-semibold text-soft-cyan" /> : <span className="text-2xs text-sg-dim">not collected</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {paymentLocked(r.e, runs) ? (
                      <Button size="xs" variant="ghost" title={revenueEntryLock(r.e, runs) ?? undefined} onClick={() => setCorrecting(r.e)}>
                        <Lock /> Correction
                      </Button>
                    ) : confirmDelete === r.e.id ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="xs"
                          variant="danger"
                          onClick={() => {
                            const removed = deletePayment(r.e.id);
                            setConfirmDelete(null);
                            if (removed) notify("Payment deleted — recorded in the audit trail", { label: "Undo", run: () => restorePayment(removed) });
                          }}
                        >
                          Delete
                        </Button>
                        <Button size="icon-sm" variant="ghost" onClick={() => setConfirmDelete(null)} aria-label="Keep payment">
                          <X />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1 opacity-60 group-hover:opacity-100 focus-within:opacity-100">
                        <Button size="icon-sm" variant="ghost" onClick={() => startEdit(r.e)} aria-label="Edit payment">
                          <Pencil />
                        </Button>
                        <Button size="icon-sm" variant="ghost" onClick={() => setConfirmDelete(r.e.id)} aria-label="Delete payment">
                          <Trash2 />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
          {rows.length ? (
            <tfoot>
              <tr className="border-t border-sg-line bg-sg-bg/40 font-semibold">
                <td colSpan={4} className="px-3 py-2 text-sg-white">
                  Total · {rows.length} payment{rows.length === 1 ? "" : "s"} · collected <Money value={totals.collected} />
                </td>
                <td className="px-2 py-2 text-right">
                  <Money value={totals.revenue} className="text-sg-white" />
                </td>
                <td className="px-2 py-2 text-right">
                  <Money value={totals.costs} />
                </td>
                <td className="px-2 py-2 text-right text-sg-muted">
                  <Money value={totals.tax} />
                </td>
                <td className="px-2 py-2 text-right">
                  <Money value={totals.net} className="text-sg-white" />
                </td>
                <td />
                <td className="px-2 py-2 text-right">
                  <Money value={totals.pool} className="text-soft-cyan" />
                </td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <p className="border-t border-sg-line px-4 py-2 text-2xs text-sg-dim">
        Rate <Rate value={review.rate} /> · a payment counts once it is earned (milestone accepted or period billed) and collected. Each payment&apos;s pool = y × cumulative net revenue − pool already allocated, never negative (early losses are recovered first)<Cite s="8.1" />. Collected by the {POLICY.cycle.cutoffDay}th → paid with that month&apos;s salary on the {POLICY.cycle.salaryDay}th; after the {POLICY.cycle.cutoffDay}th → the following month<Cite s="8.2" />. The pool is shared by effective weight-days in the payment&apos;s work period<Cite s="6.5" />.
        {costRatio > 0 ? ` Milestone prefill uses the proposal's cost ratio (${(costRatio * 100).toFixed(1)}% of revenue).` : ""}
      </p>
      <CorrectionDialog entry={correcting} onClose={() => setCorrecting(null)} />
    </Card>
  );
}

/* ───────────────────────── §8.6 Type C month by month ───────────────────────── */

function TypeCCyclesCard({ ini }: { ini: Initiative }) {
  const members = useCrm((s) => s.initiativeMembers);
  const entries = useCrm((s) => s.revenueEntries);
  const profiles = useCrm((s) => s.employeeProfiles);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const month = useMemo(() => monthKey(new Date()), []);
  const cycles = useMemo(() => projectCycles(ini, { members, entries, profiles, adjustments }, month), [ini, members, entries, profiles, adjustments, month]);
  const sb = standardBonusOf(ini);
  const totals = cycles.reduce((s, c) => ({ topUp: s.topUp + c.topUp, deducted: s.deducted + c.members.reduce((a, m) => a + m.deducted, 0) }), { topUp: 0, deducted: 0 });
  const endedAt = cycles.find((c) => c.minimumEndsThisMonth)?.month;

  return (
    <Card
      title="Type C guaranteed minimum — month by month"
      icon={PiggyBank}
      cite={["8.6", "16.8"]}
      actions={
        <span className="text-2xs text-sg-muted">
          Standard bonus <Money value={sb} className="font-semibold text-sg-white" /> a month
        </span>
      }
      bodyClassName="p-0"
    >
      {cycles.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-sg-dim">The minimum applies from the month project work starts ({formatDate(ini.startDate, "medium")}).</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead>
              <tr className="border-b border-sg-line text-left">
                <th className="sg-eyebrow px-4 py-2 font-semibold">Month</th>
                <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Standard</th>
                <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Revenue-based pool</th>
                <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Top-up</th>
                <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Top-up deducted</th>
                <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Paid to team</th>
                <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Top-ups still to deduct</th>
                <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Months in a row above</th>
                <th className="sg-eyebrow px-4 py-2 font-semibold">Minimum</th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((c) => {
                const deducted = c.members.reduce((a, m) => a + m.deducted, 0);
                const balance = c.members.reduce((a, m) => a + m.balanceAfter, 0);
                const paid = c.revPool + c.topUp - deducted;
                return (
                  <tr key={c.month} className={cn("border-b border-sg-line/60 last:border-0", c.month === month && "bg-sg-bg/40")}>
                    <td className="sg-num px-4 py-1.5 text-sg-white">
                      {c.month}
                      {c.month === month ? <span className="ml-1 text-2xs text-sg-dim">(current)</span> : null}
                    </td>
                    <td className="px-2 py-1.5 text-right text-sg-muted">{c.minimumActive ? <Money value={c.standard} /> : "—"}</td>
                    <td className="px-2 py-1.5 text-right">
                      <Money value={c.revPool} className="text-sg-white" />
                    </td>
                    <td className="px-2 py-1.5 text-right">{c.topUp > 0 ? <Money value={c.topUp} className="text-soft-magenta" /> : <span className="text-sg-dim">—</span>}</td>
                    <td className="px-2 py-1.5 text-right">{deducted > 0 ? <Money value={deducted} className="text-soft-orange" /> : <span className="text-sg-dim">—</span>}</td>
                    <td className="px-2 py-1.5 text-right">
                      <Money value={paid} className="font-semibold text-soft-green" />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Money value={balance} className={balance > 0 ? "text-sg-text" : "text-sg-dim"} />
                    </td>
                    <td className="sg-num px-2 py-1.5 text-right text-sg-muted">{c.aboveStreak}</td>
                    <td className="px-4 py-1.5">
                      {c.minimumEndsThisMonth ? <Chip color="cyan">Ends this month</Chip> : c.minimumActive ? c.noTeam ? <Chip color="orange">Active · no ledger</Chip> : <Chip color="magenta">Active</Chip> : <Chip color="blue">Ended</Chip>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="space-y-1 border-t border-sg-line px-4 py-2 text-2xs text-sg-dim">
        <p>
          Company top-ups so far <Money value={totals.topUp} className="text-sg-muted" />, deducted from later revenue-based bonuses <Money value={totals.deducted} className="text-sg-muted" />.
          {endedAt ? ` The minimum ended in ${endedAt}.` : " The minimum stops after three months in a row above the standard bonus, or one month at 12× or more."}
        </p>
        <p>While the minimum applies only each member&apos;s share of the pool above the standard bonus is used for deductions, so the team always receives at least the standard bonus; balances lapse at close or when a member leaves. Top-ups are paid in full even when the monthly checks fail (§9.2) and to probationary members with salary.</p>
        {cycles.some((c) => c.noTeam) ? (
          <p className="flex items-center gap-1 text-soft-orange">
            <Info className="size-3" /> No signed, PRC-checked ledger rows yet — top-ups are shared by effective weight-days of the members on the team, so none can be paid until the Team Allocation Ledger exists.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/* ───────────────────────── bonus by member ───────────────────────── */

type Agg = { gross: number; topUp: number; deducted: number; payable: number; deferred: number; carried: number; withheld: number; forfeited: number; held: number; runs: number };
const zero = (): Agg => ({ gross: 0, topUp: 0, deducted: 0, payable: 0, deferred: 0, carried: 0, withheld: 0, forfeited: 0, held: 0, runs: 0 });

function BonusByMember({ ini }: { ini: Initiative }) {
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const entries = useCrm((s) => s.revenueEntries);
  const profiles = useCrm((s) => s.employeeProfiles);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const userMap = useUserMap();
  const month = useMemo(() => monthKey(new Date()), []);

  const stored = useMemo(() => {
    const byUser = new Map<string, Agg>();
    const total = zero();
    const months: string[] = [];
    for (const run of bonusRuns) {
      const lines = run.lines.filter((l) => l.initiativeId === ini.id);
      if (!lines.length) continue;
      months.push(run.month);
      for (const l of lines) {
        const a = byUser.get(l.userId) ?? zero();
        for (const t of [a, total]) {
          t.gross += l.gross;
          t.topUp += l.topUp;
          t.deducted += l.topUpDeducted;
          t.payable += l.payable;
          t.deferred += l.deferred;
          t.carried += l.carriedOver;
          t.withheld += l.withheld;
          t.forfeited += l.forfeited;
          t.held += l.held;
        }
        a.runs += 1;
        byUser.set(l.userId, a);
      }
    }
    return { rows: [...byUser.entries()].sort((a, b) => b[1].gross - a[1].gross), total, months: months.sort() };
  }, [bonusRuns, ini.id]);

  const projection = useMemo(() => {
    const result = computeRun({ month, initiatives: initiatives.filter((i) => i.id === ini.id), members, entries, profiles, adjustments, companyRevenue: PASS, directCosts: 0, overheads: 0, cash: PASS, fixedCostsMonthly: 0 });
    return { lines: result.lines, project: result.projects[0] ?? null };
  }, [month, initiatives, ini.id, members, entries, profiles, adjustments]);

  const storedRun = bonusRuns.find((r) => r.month === month);
  const projTotal = projection.lines.reduce(
    (a, l) => ({ ...a, gross: a.gross + l.gross, topUp: a.topUp + l.topUp, deducted: a.deducted + l.topUpDeducted, payable: a.payable + l.payable, deferred: a.deferred + l.deferred, carried: a.carried + l.carriedOver, withheld: a.withheld + l.withheld, forfeited: a.forfeited + l.forfeited, held: a.held + l.held }),
    zero(),
  );

  const cells = (a: Agg, strong?: boolean) => (
    <>
      <td className="px-2 py-2 text-right">
        <Money value={a.gross} className={strong ? "font-semibold text-sg-white" : "text-sg-white"} />
      </td>
      <td className="px-2 py-2 text-right">{a.topUp || a.deducted ? <span className="sg-num text-2xs"><Money value={a.topUp} className="text-soft-magenta" /> / −<Money value={a.deducted} className="text-soft-orange" /></span> : <span className="text-sg-dim">—</span>}</td>
      <td className="px-2 py-2 text-right">
        <Money value={a.payable} className="text-soft-green" />
      </td>
      <td className="px-2 py-2 text-right">
        <Money value={a.deferred} className={a.deferred ? "text-soft-orange" : "text-sg-dim"} />
      </td>
      <td className="px-2 py-2 text-right">
        <Money value={a.carried} className={a.carried ? "text-soft-yellow" : "text-sg-dim"} />
      </td>
      <td className="px-2 py-2 text-right">
        <Money value={a.withheld + a.held} className={a.withheld + a.held ? "text-soft-magenta" : "text-sg-dim"} />
      </td>
      <td className="px-3 py-2 text-right">
        <Money value={a.forfeited} className={a.forfeited ? "text-soft-red" : "text-sg-dim"} />
      </td>
    </>
  );

  return (
    <Card
      title="Bonus by member"
      icon={Coins}
      cite={["6.6", "9.1"]}
      actions={
        <Link href="/compensation" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Open monthly cycle <ArrowUpRight />
        </Link>
      }
      bodyClassName="p-0 overflow-x-auto"
    >
      <table className="w-full min-w-[860px] text-xs">
        <thead>
          <tr className="border-b border-sg-line text-left">
            <th className="sg-eyebrow px-3 py-2 font-semibold">Member</th>
            <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Revenue share</th>
            <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Top-up / deducted</th>
            <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Paid</th>
            <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Deferred</th>
            <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Carried fwd</th>
            <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Held</th>
            <th className="sg-eyebrow px-3 py-2 text-right font-semibold">Forfeited</th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-sg-bg/40">
            <td colSpan={8} className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-sg-muted">
              Monthly cycles on record{stored.months.length ? ` · ${stored.months[0]}${stored.months.length > 1 ? ` – ${stored.months[stored.months.length - 1]}` : ""} (${stored.months.length})` : ""}
            </td>
          </tr>
          {stored.rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-3 py-4 text-center text-sg-dim">
                No monthly cycle includes this project yet.
              </td>
            </tr>
          ) : (
            stored.rows.map(([userId, a]) => {
              const u = userMap.get(userId);
              return (
                <tr key={userId} className="border-b border-sg-line/60">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <Avatar user={u} size="xs" />
                      <span className="text-sg-text">{u?.name ?? userId}</span>
                      <span className="text-2xs text-sg-dim">{a.runs} cycle{a.runs === 1 ? "" : "s"}</span>
                    </span>
                  </td>
                  {cells(a)}
                </tr>
              );
            })
          )}
          {stored.rows.length ? (
            <tr className="border-b border-sg-line bg-sg-bg/30">
              <td className="px-3 py-2 font-semibold text-sg-white">Total to date</td>
              {cells(stored.total, true)}
            </tr>
          ) : null}

          <tr className="bg-sg-bg/40">
            <td colSpan={8} className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-soft-cyan">
              Provisional · cycle {month} (paid {formatDate(paymentDate(month), "medium")}) — before the break-even test and cash check
              {storedRun ? <span className="ml-2 normal-case tracking-normal text-sg-dim">(a {storedRun.status} cycle for this month is on record)</span> : null}
            </td>
          </tr>
          {projection.lines.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-3 py-4 text-center text-sg-dim">
                {projection.project?.noTeam ? "No signed, PRC-checked ledger rows to share the pool." : `Nothing collected for cycle ${month} yet (collected ${formatDate(monthStart(month), "short")} – 20th, or after the 20th of last month).`}
              </td>
            </tr>
          ) : (
            projection.lines.map((l) => {
              const u = userMap.get(l.userId);
              return (
                <tr key={l.userId} className="border-b border-sg-line/60 italic">
                  <td className="px-3 py-2 not-italic">
                    <span className="flex items-center gap-2">
                      <Avatar user={u} size="xs" />
                      <span className="text-sg-text">{u?.name ?? l.userId}</span>
                      <span className="sg-num text-2xs text-sg-dim">W×A {l.weight.toFixed(2)}</span>
                      {l.notes.length ? (
                        <span className="truncate text-2xs text-sg-dim" title={l.notes.join("\n")}>
                          · {l.notes[0]}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  {cells({ ...zero(), gross: l.gross, topUp: l.topUp, deducted: l.topUpDeducted, payable: l.payable, deferred: l.deferred, carried: l.carriedOver, withheld: l.withheld, forfeited: l.forfeited, held: l.held })}
                </tr>
              );
            })
          )}
          {projection.lines.length ? (
            <tr className="bg-sg-bg/30">
              <td className="px-3 py-2 font-semibold text-soft-cyan">Provisional total</td>
              {cells(projTotal, true)}
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-sg-line px-4 py-2 text-2xs text-sg-dim">
        {projection.project ? (
          <span>
            Cycle {month}: net <Money value={projection.project.net} /> → pool <Money value={projection.project.pool} /> at <Rate value={projection.project.sharePct} />
            {projection.project.topUp ? (
              <>
                {" "}
                + top-up <Money value={projection.project.topUp} />
              </>
            ) : null}
          </span>
        ) : null}
        <span>
          The monthly cycle applies the rolling three-month break-even test and cash check; if either fails, bonuses are paid pro rata and the rest is carried forward and paid first next time <Cite s="9.1" /> <Cite s="9.2" />.
        </span>
      </div>
    </Card>
  );
}
