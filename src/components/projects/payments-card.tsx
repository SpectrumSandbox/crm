"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Initiative } from "@/lib/initiatives/types";
import { cycleMonth, monthEnd, monthKey, monthStart, netRevenue, paymentDate, projectCycles, projectPayments } from "@/lib/initiatives/engine";
import { cn, formatDate, formatIDR, fromDateInput, toDateInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/overlays";
import { PolicyRef } from "./shared";

const M = 1_000_000;

/** §8.1 client payments: earned and collected, the work period each pays for, and the cumulative pool it releases. */
export function PaymentsCard({ ini }: { ini: Initiative }) {
  const entries = useCrm((s) => s.revenueEntries);
  const members = useCrm((s) => s.initiativeMembers);
  const profiles = useCrm((s) => s.employeeProfiles);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const deleteRevenueEntry = useCrm((s) => s.deleteRevenueEntry);
  const updateRevenueEntry = useCrm((s) => s.updateRevenueEntry);
  const notify = useUi((s) => s.notify);
  const [adding, setAdding] = useState(false);

  const mine = useMemo(() => entries.filter((e) => e.initiativeId === ini.id).sort((a, b) => (a.collectedAt ?? a.month).localeCompare(b.collectedAt ?? b.month)), [entries, ini.id]);
  const pools = useMemo(() => new Map(projectPayments(ini, entries, adjustments).map((p) => [p.entry.id, p])), [ini, entries, adjustments]);
  const thisMonth = monthKey(new Date().toISOString());
  const cycles = useMemo(() => (ini.type === "C" ? projectCycles(ini, { members, entries, profiles, adjustments }, thisMonth) : []), [ini, members, entries, profiles, adjustments, thisMonth]);

  return (
    <section className="rounded-xl border border-sg-line bg-sg-card">
      <header className="flex items-center justify-between border-b border-sg-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-sm font-extrabold text-sg-white">Client payments</h2>
          <PolicyRef s="8.1" />
          <span className="text-2xs text-sg-dim">Bonuses follow collected cash, cumulatively; collected by the 20th → paid with that month&apos;s 25th salary</span>
        </div>
        <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
          <Plus /> Record payment
        </Button>
      </header>
      {mine.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wider text-sg-dim">
                <th className="px-4 py-2 font-semibold">Work period</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2 text-right font-semibold">Revenue</th>
                <th className="px-2 py-2 text-right font-semibold">Direct costs</th>
                <th className="px-2 py-2 text-right font-semibold">Net</th>
                <th className="px-2 py-2 text-right font-semibold">Pool released</th>
                <th className="px-4 py-2 font-semibold">Paid with</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-sg-line">
              {mine.map((e) => {
                const p = pools.get(e.id);
                const n = netRevenue(e.revenue, e.directCosts);
                return (
                  <tr key={e.id}>
                    <td className="px-4 py-2 text-xs text-sg-muted">
                      {formatDate(e.workPeriodStart ?? monthStart(e.month), "short")} – {formatDate(e.workPeriodEnd ?? monthEnd(e.month), "short")}
                      {e.note ? <div className="truncate text-2xs text-sg-dim">{e.note}</div> : null}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {e.received ? (
                        <span className="text-soft-green">Collected {e.collectedAt ? formatDate(e.collectedAt, "short") : ""}</span>
                      ) : (
                        <button
                          type="button"
                          className="text-soft-orange hover:underline"
                          onClick={() => {
                            const at = new Date().toISOString();
                            updateRevenueEntry(e.id, { received: true, collectedAt: at, month: cycleMonth(at) });
                            notify("Marked as collected");
                          }}
                        >
                          Earned · mark collected
                        </button>
                      )}
                    </td>
                    <td className="sg-num px-2 py-2 text-right text-sg-white">{formatIDR(e.revenue)}</td>
                    <td className="sg-num px-2 py-2 text-right text-sg-muted">{formatIDR(e.directCosts)}</td>
                    <td className="sg-num px-2 py-2 text-right text-sg-muted">{formatIDR(n.net)}</td>
                    <td className="sg-num px-2 py-2 text-right font-semibold text-sg-white">{p ? formatIDR(p.pool) : "—"}</td>
                    <td className="px-4 py-2 text-xs text-sg-muted">{e.received ? formatDate(paymentDate(p?.month ?? e.month), "short") : "On collection"}</td>
                    <td className="pr-3">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Delete payment"
                        onClick={() => {
                          deleteRevenueEntry(e.id);
                          notify("Payment removed");
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-4 text-sm text-sg-muted">No client payments recorded yet. Record each payment with the work period it pays for (§6.5) — the bonus pool is shared among whoever was on the team during that period.</p>
      )}

      {ini.type === "C" && cycles.length ? (
        <div className="border-t border-sg-line">
          <div className="flex items-center gap-2 px-4 pt-3">
            <span className="sg-eyebrow">Guaranteed minimum</span>
            <PolicyRef s="8.6" />
          </div>
          <div className="overflow-x-auto">
            <table className="mt-1 w-full min-w-[640px] text-xs">
              <thead>
                <tr className="text-left text-2xs uppercase tracking-wider text-sg-dim">
                  <th className="px-4 py-1.5 font-semibold">Month</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Revenue pool</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Top-up</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Deducted</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Paid to team</th>
                  <th className="px-2 py-1.5 text-right font-semibold">To deduct</th>
                  <th className="px-4 py-1.5 font-semibold">Minimum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sg-line">
                {cycles.map((c) => {
                  const ded = c.members.reduce((s, m) => s + m.deducted, 0);
                  const paid = c.members.reduce((s, m) => s + m.revShare - m.deducted + m.topUp, 0);
                  const bal = c.members.reduce((s, m) => s + m.balanceAfter, 0);
                  return (
                    <tr key={c.month}>
                      <td className="px-4 py-1.5 text-sg-muted">{c.month}</td>
                      <td className="sg-num px-2 py-1.5 text-right text-sg-white">{formatIDR(c.revPool, "full")}</td>
                      <td className="sg-num px-2 py-1.5 text-right text-sg-white">{formatIDR(c.topUp, "full")}</td>
                      <td className="sg-num px-2 py-1.5 text-right text-sg-muted">{formatIDR(ded, "full")}</td>
                      <td className="sg-num px-2 py-1.5 text-right text-sg-white">{formatIDR(paid, "full")}</td>
                      <td className="sg-num px-2 py-1.5 text-right text-sg-muted">{formatIDR(bal, "full")}</td>
                      <td className={cn("px-4 py-1.5", c.noTeam ? "text-soft-orange" : "text-sg-dim")}>{c.noTeam ? "No team on the ledger — nothing paid" : c.minimumEndsThisMonth ? "Ends this month" : c.minimumActive ? `Applies (${formatIDR(c.standard, "full")})` : "Ended"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <PaymentDialog ini={ini} open={adding} onOpenChange={setAdding} />
    </section>
  );
}

function PaymentDialog({ ini, open, onOpenChange }: { ini: Initiative; open: boolean; onOpenChange: (o: boolean) => void }) {
  const addRevenueEntry = useCrm((s) => s.addRevenueEntry);
  const notify = useUi((s) => s.notify);
  const today = toDateInput(new Date().toISOString());
  const [revenue, setRevenue] = useState("");
  const [costs, setCosts] = useState("");
  const [basis, setBasis] = useState<"milestone" | "recognized">("milestone");
  const [collected, setCollected] = useState(true);
  const [collectedAt, setCollectedAt] = useState(today);
  const [from, setFrom] = useState(toDateInput(ini.startDate));
  const [to, setTo] = useState(today);
  const [note, setNote] = useState("");
  const rev = Number(revenue) * M;
  const cost = Number(costs || "0") * M;
  const valid = rev > 0 && Number.isFinite(cost) && from && to && to >= from && (!collected || !!collectedAt);
  const n = netRevenue(rev || 0, cost || 0);
  const save = () => {
    if (!valid) return;
    const cIso = collected ? fromDateInput(collectedAt) : null;
    addRevenueEntry({ initiativeId: ini.id, month: cIso ? cycleMonth(cIso) : monthKey(fromDateInput(to)), revenue: rev, directCosts: cost, basis, received: collected, collectedAt: cIso, workPeriodStart: fromDateInput(from), workPeriodEnd: new Date(Date.parse(fromDateInput(to)) + 86_399_000).toISOString(), note });
    notify(collected ? `Payment recorded — cycle ${cycleMonth(cIso!)}` : "Earned payment recorded — bonus follows collection");
    onOpenChange(false);
    setRevenue("");
    setCosts("");
    setNote("");
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Record a client payment"
      description="Revenue excludes VAT. Direct costs are those incurred or accrued for this work (§5.3). Advance payments count once the work they relate to is delivered (§8.1)."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} onClick={save}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Revenue, Rp million">
            <Input autoFocus inputMode="decimal" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
          </Field>
          <Field label="Direct costs, Rp million">
            <Input inputMode="decimal" value={costs} onChange={(e) => setCosts(e.target.value)} />
          </Field>
          <Field label="Basis">
            <Select value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)}>
              <option value="milestone">Milestone accepted</option>
              <option value="recognized">Period billed</option>
            </Select>
          </Field>
          <Field label="Collected on" hint={collected && collectedAt ? `Cycle ${cycleMonth(fromDateInput(collectedAt))} — paid ${formatDate(paymentDate(cycleMonth(fromDateInput(collectedAt))), "short")}` : "Not yet collected"}>
            <div className="flex items-center gap-2">
              <input type="checkbox" aria-label="Collected" className="size-3.5 accent-white" checked={collected} onChange={(e) => setCollected(e.target.checked)} />
              <Input type="date" value={collectedAt} disabled={!collected} onChange={(e) => setCollectedAt(e.target.value)} />
            </div>
          </Field>
          <Field label="Work period from (§6.5)">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Work period to">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Invoice / milestone reference" />
        </Field>
        <p className="text-xs text-sg-muted">
          Net revenue <span className="sg-num text-sg-white">{formatIDR(n.net, "full")}</span> after UMKM tax {formatIDR(n.tax, "full")} (§5.4).
        </p>
      </div>
    </Modal>
  );
}
