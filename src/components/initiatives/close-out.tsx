"use client";

/* Annex G project close-out report (§8.3). The Project Lead submits it when all deliverables are accepted, the final invoice
 * is paid or written off (or 90 days past due) and final costs are booked; submitting closes the project and starts the
 * 30-day Finance reconciliation clock. "Mark completed" is not available without it. */
import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, CircleCheck, TriangleAlert } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import { useUserMap } from "@/lib/selectors";
import type { CloseOutReport, Initiative } from "@/lib/initiatives/types";
import { netRevenue, projectRate, projectedAnnualNet, contractedMonths, proposalEconomics } from "@/lib/initiatives/engine";
import { POLICY } from "@/lib/initiatives/policy";
import { changeOrderImpact, ledgerDate, parseAmount, todayWib, wibDay, withChangeOrders } from "@/lib/initiatives/team-rules";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/overlays";
import { Cite } from "./shared";
import { Card, SlaTimer } from "./detail/ui";

const DAY = 86_400_000;

function useCloseOutFacts(ini: Initiative) {
  const entries = useCrm((s) => s.revenueEntries);
  const runs = useCrm((s) => s.bonusRuns);
  const cos = useCrm((s) => s.changeOrders);
  const adjustments = useCrm((s) => s.curveAdjustments);
  return useMemo(() => {
    const mine = entries.filter((e) => e.initiativeId === ini.id);
    const revenue = mine.reduce((s, e) => s + e.revenue, 0);
    const costs = mine.reduce((s, e) => s + e.directCosts, 0);
    const taxes = mine.reduce((s, e) => s + netRevenue(e.revenue, e.directCosts).tax, 0);
    const unpaid = mine.filter((e) => !e.received);
    const unpaidAmount = unpaid.reduce((s, e) => s + e.revenue, 0);
    const paid = runs.filter((r) => r.status === "released").reduce((s, r) => s + r.lines.filter((l) => l.initiativeId === ini.id).reduce((a, l) => a + l.payable, 0), 0);
    const approvedIni = withChangeOrders(ini, cos);
    const econ = proposalEconomics(approvedIni, adjustments);
    const impact = changeOrderImpact(ini, cos, adjustments);
    const openMilestones = ini.milestones.filter((m) => !m.done);
    return { revenue, costs, taxes, unpaid, unpaidAmount, paid, econ, impact, openMilestones, rate: projectRate(ini, adjustments) };
  }, [entries, runs, cos, adjustments, ini]);
}

export function CloseOutModal({ ini, open, onOpenChange }: { ini: Initiative; open: boolean; onOpenChange: (o: boolean) => void }) {
  const members = useCrm((s) => s.initiativeMembers);
  const users = useCrm((s) => s.users);
  const currentUserId = useCrm((s) => s.currentUserId);
  const submitCloseOut = useCrm((s) => s.submitCloseOut);
  const notify = useUi((s) => s.notify);
  const access = useAccess();
  const facts = useCloseOutFacts(ini);
  const live = useMemo(() => members.filter((m) => m.initiativeId === ini.id && m.consent !== "declined"), [members, ini.id]);
  const lead = live.find((m) => m.roles.includes("project_lead") && !m.leftAt)?.userId ?? live.find((m) => m.roles.includes("project_lead"))?.userId ?? "";
  const tl = live.find((m) => m.roles.includes("technical_lead") && !m.leftAt)?.userId ?? "";

  const [actualStart, setActualStart] = useState(wibDay(ini.startDate));
  const [actualEnd, setActualEnd] = useState(todayWib());
  const [acceptance, setAcceptance] = useState(todayWib());
  const [revenue, setRevenue] = useState("");
  const [costs, setCosts] = useState("");
  const [taxes, setTaxes] = useState("");
  const [writtenOff, setWrittenOff] = useState("0");
  const [overdue90, setOverdue90] = useState(false);
  const [warrantyUntil, setWarrantyUntil] = useState("");
  const [openWarranty, setOpenWarranty] = useState("");
  const [recalc, setRecalc] = useState(false);
  const [recalcWhy, setRecalcWhy] = useState("");
  const [noRework, setNoRework] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [safety, setSafety] = useState("None");
  const [wentWell, setWentWell] = useState("");
  const [different, setDifferent] = useState("");
  const [plId, setPlId] = useState(lead);
  const [tlId, setTlId] = useState(tl);
  const [costsBooked, setCostsBooked] = useState(false);
  useEffect(() => {
    if (!open) return;
    setRevenue(String(Math.round(facts.revenue)));
    setCosts(String(Math.round(facts.costs)));
    setTaxes(String(Math.round(facts.taxes)));
    setPlId(lead);
    setTlId(tl);
  }, [open, facts.revenue, facts.costs, facts.taxes, lead, tl]);

  const rev = parseAmount(revenue);
  const cost = parseAmount(costs);
  const tax = parseAmount(taxes);
  const wo = parseAmount(writtenOff);
  const net = rev - cost - tax;
  const months = contractedMonths({ startDate: ledgerDate(actualStart || wibDay(ini.startDate)), endDate: ledgerDate(actualEnd || todayWib()) });
  const xActual = projectedAnnualNet(net, months);
  const projected = facts.econ.expected;
  const variance = (a: number, p: number) => (p ? `${(((a - p) / Math.abs(p)) * 100).toFixed(1)}%` : "—");

  const errors: string[] = [];
  if (facts.openMilestones.length) errors.push(`All deliverables accepted first — open: ${facts.openMilestones.map((m) => m.name).join(", ")} (§8.3)`);
  if (facts.unpaidAmount > 0 && !(wo + 1 >= facts.unpaidAmount) && !overdue90) errors.push(`Final invoice paid or written off — ${formatIDR(facts.unpaidAmount, "full")} not collected; record the write-off or confirm it is 90+ days past due (§8.3)`);
  if (!costsBooked) errors.push("Confirm final costs are booked");
  if (![rev, cost, tax, wo].every(Number.isFinite)) errors.push("Final financials must be numbers");
  if (!actualStart || !actualEnd || actualEnd < actualStart) errors.push("Actual start and end dates");
  if (!acceptance) errors.push("Date of final client acceptance");
  if (recalc && recalcWhy.trim().length < 5) errors.push("Why a rate recalculation is needed (§5.1)");
  if (feedback.trim().length < 3) errors.push("Client feedback");
  if (wentWell.trim().length < 3 || different.trim().length < 3) errors.push("Lessons learned — what went well and what to do differently");
  if (!plId) errors.push("Project Lead sign-off");
  if (plId && plId !== currentUserId && !access.prc) errors.push("Only the Project Lead or the PRC submits the close-out report");

  const submit = () => {
    if (errors.length) return;
    const report: Omit<CloseOutReport, "id" | "submittedById" | "submittedAt"> = {
      initiativeId: ini.id,
      actualStart: ledgerDate(actualStart),
      actualEnd: ledgerDate(actualEnd),
      acceptanceDate: ledgerDate(acceptance),
      actualRevenue: rev,
      actualDirectCosts: cost,
      actualTaxes: tax,
      bonusesPaid: facts.paid,
      unpaidInvoices: facts.unpaidAmount,
      writtenOff: wo,
      warrantyUntil: warrantyUntil ? ledgerDate(warrantyUntil) : null,
      openWarranty: openWarranty.trim(),
      rateRecalculation: { needed: recalc, why: recalcWhy.trim() },
      acceptedWithoutRework: noRework,
      clientFeedback: feedback.trim(),
      safetyIncidents: safety.trim(),
      wentWell: wentWell.trim(),
      doDifferently: different.trim(),
      signOff: { projectLeadId: plId || null, technicalLeadId: tlId || null, financeId: null, pmoId: access.prc ? currentUserId : null },
    };
    submitCloseOut(report);
    notify("Close-out report submitted — project closed; Finance reconciles within 30 days (§8.3)");
    onOpenChange(false);
  };

  const row = (label: string, p: number | null, a: number | null, pct = false) => (
    <tr key={label} className="border-t border-sg-line/60">
      <td className="py-1 pr-2 text-sg-muted">{label}</td>
      <td className="sg-num py-1 pr-2 text-right">{p == null ? "—" : pct ? `${(p * 100).toFixed(3)}%` : formatIDR(p, "full")}</td>
      <td className="sg-num py-1 pr-2 text-right text-sg-white">{a == null || !Number.isFinite(a) ? "—" : pct ? `${(a * 100).toFixed(3)}%` : formatIDR(a, "full")}</td>
      <td className="sg-num py-1 text-right">{p == null || a == null || !Number.isFinite(a) ? "—" : variance(a, p)}</td>
    </tr>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Close-out report — ${ini.code ?? ini.trackingNo} ${ini.title}`}
      description="Annex G. Submitted by the Project Lead when all deliverables are accepted, the final invoice is paid or written off and final costs are booked (§8.3)."
      className="max-w-3xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={errors.length > 0} title={errors.join("\n")} onClick={submit}>
            <ClipboardCheck /> Submit report &amp; close project
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Actual start">
            <Input type="date" lang="en-GB" value={actualStart} onChange={(e) => setActualStart(e.target.value)} />
          </Field>
          <Field label="Actual end" hint={`Contracted ${formatDate(ini.startDate, "short")} – ${formatDate(ini.endDate, "short")}`}>
            <Input type="date" lang="en-GB" value={actualEnd} onChange={(e) => setActualEnd(e.target.value)} />
          </Field>
          <Field label="Final client acceptance">
            <Input type="date" lang="en-GB" value={acceptance} onChange={(e) => setAcceptance(e.target.value)} />
          </Field>
        </div>

        <div>
          <div className="sg-eyebrow mb-1">Final financials (Rp) — approved projection incl. approved change orders</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Revenue excl. VAT">
              <Input inputMode="numeric" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
            </Field>
            <Field label="Direct costs">
              <Input inputMode="numeric" value={costs} onChange={(e) => setCosts(e.target.value)} />
            </Field>
            <Field label="Taxes">
              <Input inputMode="numeric" value={taxes} onChange={(e) => setTaxes(e.target.value)} />
            </Field>
          </div>
          <table className="mt-2 w-full text-xs">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wider text-sg-dim">
                <th className="py-1 font-semibold">Item</th>
                <th className="py-1 text-right font-semibold">Approved projection</th>
                <th className="py-1 text-right font-semibold">Actual</th>
                <th className="py-1 text-right font-semibold">Variance</th>
              </tr>
            </thead>
            <tbody>
              {row("Revenue", projected.revenue, rev)}
              {row("Direct costs", projected.costs, cost)}
              {row("Taxes", projected.tax, tax)}
              {row("Net revenue", projected.net, net)}
              {row("Annual net revenue x", facts.econ.rate.x, xActual)}
              {row("Revenue-share rate y", facts.rate.rate, facts.rate.rate, true)}
              {row("Bonus pool", projected.pool, Math.max(0, net) * facts.rate.rate)}
              {access.seeAllPay ? row("Bonuses already paid", null, facts.paid) : null}
            </tbody>
          </table>
          {facts.impact.approved.length ? <p className="mt-1 text-2xs text-sg-dim">Change orders approved: {facts.impact.approved.map((c) => `${c.ref} ${formatIDR(c.priceDelta)}`).join(", ")}.</p> : <p className="mt-1 text-2xs text-sg-dim">No change orders raised.</p>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Unpaid invoices" hint={facts.unpaid.length ? `${facts.unpaid.length} not collected` : "All collected"}>
            <Input value={formatIDR(facts.unpaidAmount, "full")} disabled />
          </Field>
          <Field label="Amount written off (Rp)">
            <Input inputMode="numeric" value={writtenOff} onChange={(e) => setWrittenOff(e.target.value)} />
          </Field>
          {facts.unpaidAmount > 0 ? (
            <label className="flex items-start gap-2 text-xs text-sg-text sm:col-span-2">
              <input type="checkbox" checked={overdue90} onChange={(e) => setOverdue90(e.target.checked)} className="mt-0.5 size-3.5 accent-sg-white" />
              The final invoice is unpaid {POLICY.unpaidInvoiceCloseDays} days after its due date — close without it; a later collection earns a late-collection bonus (§8.3)
            </label>
          ) : null}
          <Field label="Warranty until (if any)">
            <Input type="date" lang="en-GB" value={warrantyUntil} onChange={(e) => setWarrantyUntil(e.target.value)} />
          </Field>
          <Field label="Open warranty obligations">
            <Input value={openWarranty} onChange={(e) => setOpenWarranty(e.target.value)} />
          </Field>
          <label className="flex items-start gap-2 text-xs text-sg-text sm:col-span-2">
            <input type="checkbox" checked={recalc} onChange={(e) => setRecalc(e.target.checked)} className="mt-0.5 size-3.5 accent-sg-white" />
            Rate recalculation needed under §5.1 (actual x more than 20% above the figure used, or change orders moved x by more than 10%)
          </label>
          {recalc ? (
            <Field label="Why" className="sm:col-span-2">
              <Input value={recalcWhy} onChange={(e) => setRecalcWhy(e.target.value)} />
            </Field>
          ) : null}
        </div>

        <div>
          <div className="sg-eyebrow mb-1">Delivery review</div>
          <div className="grid gap-3">
            <label className="flex items-center gap-2 text-xs text-sg-text">
              <input type="checkbox" checked={noRework} onChange={(e) => setNoRework(e.target.checked)} className="size-3.5 accent-sg-white" /> All deliverables accepted without rework
            </label>
            <Field label="Client feedback">
              <Textarea rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            </Field>
            <Field label="Safety incidents">
              <Input value={safety} onChange={(e) => setSafety(e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="What went well">
                <Textarea rows={2} value={wentWell} onChange={(e) => setWentWell(e.target.value)} />
              </Field>
              <Field label="What to do differently next time">
                <Textarea rows={2} value={different} onChange={(e) => setDifferent(e.target.value)} />
              </Field>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Project Lead sign-off">
            <Select value={plId} onChange={(e) => setPlId(e.target.value)}>
              <option value="">—</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Technical Lead sign-off">
            <Select value={tlId} onChange={(e) => setTlId(e.target.value)}>
              <option value="">—</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-xs text-sg-text sm:col-span-2">
            <input type="checkbox" checked={costsBooked} onChange={(e) => setCostsBooked(e.target.checked)} className="size-3.5 accent-sg-white" /> Final costs are booked in the finance system
          </label>
        </div>

        {errors.length ? (
          <ul className="space-y-0.5 rounded-md border border-soft-yellow/40 bg-soft-yellow/10 p-2 text-2xs text-soft-yellow">
            {errors.map((e) => (
              <li key={e} className="flex gap-1.5">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" /> {e}
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-1.5 text-2xs text-soft-green">
            <CircleCheck className="size-3.5" /> Ready to close. Finance signs the final reconciliation within 30 days; deferred amounts vest {ini.deferralMonths || 6} months after close (§9.3).
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Submitted report + the Finance reconciliation clock, on completed projects. */
export function CloseOutCard({ ini }: { ini: Initiative }) {
  const reports = useCrm((s) => s.closeOutReports);
  const reconcileCloseOut = useCrm((s) => s.reconcileCloseOut);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const access = useAccess();
  const [recNote, setRecNote] = useState("");
  const r = reports.find((x) => x.initiativeId === ini.id);
  if (!r) {
    if (ini.status !== "completed") return null;
    return (
      <Card title="Close-out report" icon={ClipboardCheck} cite={["8.3", "Annex G"]}>
        <p className="text-xs text-soft-orange">This project was closed before close-out reports were recorded — the Project Lead should still file Annex G with Finance.</p>
      </Card>
    );
  }
  const due = new Date(Date.parse(r.submittedAt) + POLICY.closeReconciliationDays * DAY).toISOString();
  const name = (id: string | null) => (id ? userMap.get(id)?.name ?? id : "—");
  return (
    <Card title="Close-out report" icon={ClipboardCheck} cite={["8.3", "Annex G"]}>
      <div className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        <span className="text-sg-muted">
          Actual {formatDate(r.actualStart, "short")} – {formatDate(r.actualEnd, "short")} · accepted {formatDate(r.acceptanceDate, "medium")}
        </span>
        <span className="text-sg-muted">
          Revenue <span className="sg-num text-sg-white">{formatIDR(r.actualRevenue)}</span> · costs <span className="sg-num text-sg-white">{formatIDR(r.actualDirectCosts)}</span> · taxes <span className="sg-num">{formatIDR(r.actualTaxes)}</span>
        </span>
        {r.writtenOff > 0 || r.unpaidInvoices > 0 ? (
          <span className="text-soft-orange">
            Unpaid {formatIDR(r.unpaidInvoices)} · written off {formatIDR(r.writtenOff)}
          </span>
        ) : null}
        {r.rateRecalculation.needed ? <span className="text-soft-orange">Rate recalculation needed — {r.rateRecalculation.why}</span> : null}
        <span className="text-sg-muted">Client feedback: {r.clientFeedback}</span>
        <span className="text-sg-muted">Went well: {r.wentWell} · Next time: {r.doDifferently}</span>
        <span className="text-2xs text-sg-dim">
          Signed: PL {name(r.signOff.projectLeadId)} · TL {name(r.signOff.technicalLeadId)} · PMO {name(r.signOff.pmoId)} · Finance {name(r.signOff.financeId)}
        </span>
        <span className="text-2xs text-sg-dim">Submitted {formatDate(r.submittedAt, "datetime")} by {name(r.submittedById)}</span>
      </div>
      {ini.reconciliation ? (
        <div className="mt-3 rounded-md border border-sg-line p-2 text-xs text-sg-muted">
          <span className="font-semibold text-sg-text">Final reconciliation</span> {formatDate(ini.reconciliation.at, "medium")} by {name(ini.reconciliation.byId)} · final pool <span className="sg-num text-sg-white">{formatIDR(ini.reconciliation.finalPool)}</span> at {(ini.reconciliation.finalRate * 100).toFixed(3)}% vs allocated <span className="sg-num">{formatIDR(ini.reconciliation.allocated)}</span> ·{" "}
          {ini.reconciliation.difference >= 0 ? (
            <span className="text-soft-green">
              top-up {formatIDR(ini.reconciliation.difference)}
              {ini.reconciliation.payMonth ? ` paid in the ${ini.reconciliation.payMonth} cycle` : ""}
            </span>
          ) : (
            <span className="text-soft-orange">
              overpayment {formatIDR(-ini.reconciliation.difference)}: {formatIDR(ini.reconciliation.offsetFromDeferred)} from deferrals, {formatIDR(ini.reconciliation.absorbedOrClawback)} to clawback review or absorbed
            </span>
          )}
          {ini.reconciliation.note ? <div className="mt-0.5 text-2xs text-sg-dim">{ini.reconciliation.note}</div> : null}
        </div>
      ) : null}
      <div className={cn("mt-3 flex flex-wrap items-center gap-3 border-t border-sg-line pt-3")}>
        <SlaTimer label="Finance final reconciliation" dueIso={due} doneIso={r.reconciledAt ?? ini.reconciliation?.at} cite="8.3" />
        {!r.reconciledAt && access.certify ? (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <Input value={recNote} onChange={(e) => setRecNote(e.target.value)} placeholder="Finance note (optional)" aria-label="Reconciliation note" className="h-7 w-56 text-xs" />
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                reconcileCloseOut(r.id, recNote.trim());
                const rec = useCrm.getState().initiatives.find((x) => x.id === ini.id)?.reconciliation;
                notify(rec ? `Final reconciliation recorded — ${rec.difference >= 0 ? `top-up ${formatIDR(rec.difference)}` : `overpayment ${formatIDR(-rec.difference)}`} (§8.3)` : "Final reconciliation refused — Finance records it (§8.3)");
                setRecNote("");
              }}
            >
              Recalculate &amp; record final reconciliation
            </Button>
          </span>
        ) : null}
        {!r.reconciledAt && !access.certify ? (
          <span className="ml-auto text-2xs text-sg-dim">Finance records it <Cite s="8.3" /></span>
        ) : null}
      </div>
    </Card>
  );
}
