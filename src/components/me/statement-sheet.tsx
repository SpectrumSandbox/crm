"use client";

/* /me — the full Annex E monthly bonus statement for one cycle × project, in exact rupiah, printable, with "Dispute". */
import { useMemo } from "react";
import { Printer } from "lucide-react";
import { useCrm } from "@/lib/store";
import { collectionWindow, estimatedTax, paymentDate, projectRate, topUpBalance } from "@/lib/initiatives/engine";
import { POLICY, ROLE_META } from "@/lib/initiatives/policy";
import type { BonusLine, BonusRun } from "@/lib/initiatives/types";
import { formatDate, formatIDR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { RaiseDisputeButton } from "./disputes";
import { EXTRA_LABEL, cycleLabel, pct3 } from "./helpers";
import { RpFull } from "./ui";

const PRINT_CSS = `
@media print {
  @page { margin: 14mm 12mm; }
  html, body { background: #fff !important; }
  body * { visibility: hidden !important; }
  #annex-e-print, #annex-e-print * { visibility: visible !important; color: #111 !important; background: transparent !important; }
  #annex-e-print { position: absolute; left: 0; top: 0; width: 100%; }
  #annex-e-print table, #annex-e-print td, #annex-e-print th { border-color: #bbb !important; }
}
`;

function Rows({ rows }: { rows: [string, React.ReactNode, React.ReactNode?][] }) {
  const three = rows.some((r) => r.length === 3);
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map(([k, v, w]) => (
          <tr key={k} className="border-b border-sg-line last:border-b-0">
            <th scope="row" className="w-1/2 py-1.5 pr-3 text-left font-medium text-sg-muted">
              {k}
            </th>
            <td className="py-1.5 text-right font-semibold text-sg-white">{v}</td>
            {three && <td className="py-1.5 pl-3 text-right text-sg-text">{w ?? ""}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function StatementSheet({ open, onOpenChange, run, line }: { open: boolean; onOpenChange: (v: boolean) => void; run: BonusRun; line: BonusLine }) {
  const users = useCrm((s) => s.users);
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const entries = useCrm((s) => s.revenueEntries);
  const profiles = useCrm((s) => s.employeeProfiles);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const runs = useCrm((s) => s.bonusRuns);
  const deferred = useCrm((s) => s.deferredBonuses);
  const clawbacks = useCrm((s) => s.clawbacks);

  const user = users.find((u) => u.id === line.userId);
  const ini = initiatives.find((i) => i.id === line.initiativeId);

  const d = useMemo(() => {
    const projectEntries = entries.filter((e) => e.initiativeId === line.initiativeId && e.received);
    const period = projectEntries.filter((e) => e.month === run.month);
    const toDate = projectEntries.filter((e) => e.month <= run.month);
    const fig = (list: typeof entries) => {
      const revenue = list.reduce((s, e) => s + e.revenue, 0);
      const costs = list.reduce((s, e) => s + e.directCosts, 0);
      const tax = list.reduce((s, e) => s + estimatedTax(e.revenue, e.directCosts), 0);
      return { revenue, costs, tax, net: revenue - costs - tax };
    };
    const rows = members.filter((m) => m.initiativeId === line.initiativeId && m.userId === line.userId);
    const myRuns = runs.filter((r) => r.month <= run.month).flatMap((r) => r.lines.filter((l) => l.initiativeId === line.initiativeId && l.userId === line.userId).map((l) => ({ r, l })));
    const poolToDate = runs.filter((r) => r.month <= run.month).reduce((s, r) => s + (r.lines.find((l) => l.initiativeId === line.initiativeId)?.pool ?? 0), 0);
    const paidOnProject =
      myRuns.filter((x) => x.r.status === "released").reduce((s, x) => s + x.l.payable, 0) +
      deferred.filter((x) => x.userId === line.userId && x.initiativeId === line.initiativeId && x.status === "released").reduce((s, x) => s + x.releasedAmount, 0);
    const deferredPending = deferred.filter((x) => x.userId === line.userId && x.initiativeId === line.initiativeId && x.status === "pending").reduce((s, x) => s + x.amount, 0);
    const held = myRuns.reduce((s, x) => s + x.l.withheld, 0);
    const recovered = clawbacks.filter((c) => c.userId === line.userId && c.initiativeId === line.initiativeId).reduce((s, c) => s + c.recovered, 0);
    const topUpLeft = ini?.type === "C" ? topUpBalance(line.userId, ini, { members, entries, profiles, adjustments }, run.month) : null;
    const workPeriods = period.map((e) => `${formatDate(e.workPeriodStart ?? `${e.month}-01T00:00:00+07:00`, "medium")} – ${formatDate(e.workPeriodEnd ?? e.collectedAt ?? paymentDate(e.month), "medium")}`);
    return { period: fig(period), toDate: fig(toDate), rows, poolToDate, paidOnProject, deferredPending, held, recovered, topUpLeft, workPeriods };
  }, [entries, members, runs, deferred, clawbacks, profiles, adjustments, ini, run.month, line.initiativeId, line.userId]);

  const rate = ini ? projectRate(ini, adjustments) : null;
  const win = collectionWindow(run.month);
  const roles = [...new Set(d.rows.flatMap((m) => m.roles))].map((r) => ROLE_META[r].label).join(" + ");
  const alloc = [...new Set(d.rows.map((m) => m.allocationFactor ?? 1))].join(" / ");
  const pph = line.pph21;
  const passed = run.status !== "failed" && run.payoutPct >= 1;
  const gross = line.payable;
  const paid = run.status === "released";
  const empNo = (profiles.find((p) => p.userId === line.userId) as { employeeNumber?: string } | undefined)?.employeeNumber;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Monthly bonus statement · ${cycleLabel(run.month)}`}
      description={`Annex E · ${ini?.title ?? "Project"} · issued on the salary date (§8.4)`}
      className="w-[min(760px,calc(100vw-32px))]"
      footer={
        <>
          <RaiseDisputeButton
            variant="outline"
            size="sm"
            label="Dispute this statement"
            prefill={{ category: "calculation", subject: `${cycleLabel(run.month)} statement — ${ini?.title ?? "project"}`, initiativeId: line.initiativeId, runMonth: run.month, lineRef: `line:${run.id}:${line.initiativeId}`, amount: line.payable, source: `${cycleLabel(run.month)} · ${ini?.title ?? "Project"} · payable` }}
          />
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
          <Button variant="primary" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </>
      }
    >
      <style>{PRINT_CSS}</style>
      <div id="annex-e-print" className="space-y-4">
        <Rows
          rows={[
            ["Employee name and number", `${user?.name ?? line.userId}${empNo ? ` · ${empNo}` : ""}`],
            ["Project name and code", `${ini?.title ?? line.initiativeId}${ini?.code ? ` · ${ini.code}` : ""}`],
            ["Salary date", `${formatDate(paymentDate(run.month), "long")}${paid ? "" : " (not yet paid)"}`],
            ["Collection period covered", `${formatDate(win.from, "medium")} to ${formatDate(win.to, "medium")}`],
            ["Project annual net revenue used for the rate, x", rate && rate.x > 0 ? <RpFull value={rate.x} /> : "—"],
            ["Revenue-share rate, y", pct3(line.sharePct)],
          ]}
        />
        <div>
          <h3 className="sg-eyebrow mb-1">Project figures</h3>
          <div className="mb-1 flex justify-end gap-3 text-2xs text-sg-dim">
            <span className="w-1/4 text-right">This period</span>
            <span className="w-1/4 text-right">Project to date</span>
          </div>
          <Rows
            rows={[
              ["Revenue collected, excluding VAT", <RpFull key="a" value={d.period.revenue} />, <RpFull key="b" value={d.toDate.revenue} />],
              ["Direct costs", <RpFull key="a" value={d.period.costs} />, <RpFull key="b" value={d.toDate.costs} />],
              ["Estimated taxes", <RpFull key="a" value={d.period.tax} />, <RpFull key="b" value={d.toDate.tax} />],
              ["Net revenue", <RpFull key="a" value={line.netRevenue || d.period.net} />, <RpFull key="b" value={d.toDate.net} />],
              ["Bonus pool (y × net revenue, after any shortfall recovered)", <RpFull key="a" value={line.pool} />, <RpFull key="b" value={d.poolToDate} />],
            ]}
          />
        </div>
        <div>
          <h3 className="sg-eyebrow mb-1">Your share</h3>
          <Rows
            rows={[
              ["Work period(s) the collected payments relate to", d.workPeriods.length ? d.workPeriods.join("; ") : "—"],
              ["Your role(s), weight and allocation factor", `${roles || "—"} · weight ${line.weight.toFixed(2)} · A ${alloc || "1"}`],
              ["Your effective weight-days / team total", line.totalWeightDays > 0 ? `${line.weightDays.toFixed(2)} / ${line.totalWeightDays.toFixed(2)} (${((line.weightDays / line.totalWeightDays) * 100).toFixed(2)}%)` : `${line.weight.toFixed(2)} / ${line.totalWeight.toFixed(2)}`],
              ["Your share of this period's pool", <RpFull key="g" value={line.gross} />],
              ["Type C top-up paid (+) or deducted (−) this period", line.topUp || line.topUpDeducted ? <span key="t">{line.topUp ? <RpFull value={line.topUp} /> : null}{line.topUp && line.topUpDeducted ? " / " : ""}{line.topUpDeducted ? <>−<RpFull value={line.topUpDeducted} /></> : null}</span> : "—"],
              ["Break-even test result and percentage released", `${passed ? "Passed" : "Failed"} · ${Math.round(run.payoutPct * 10_000) / 100}% released (§9.2)`],
              ["Carried forward from earlier months and paid now", <RpFull key="ci" value={line.carriedIn} />],
              ["Carried forward to later months", <RpFull key="co" value={line.carriedOver} />],
              ["Deferred (high-risk projects)", <RpFull key="df" value={line.deferred} />],
              ["Held (probation)", <RpFull key="w" value={line.withheld} />],
              ["Held (Annex B, suspension, unpaid leave, PRC confirmation)", <RpFull key="h" value={line.held} />],
              ["Forfeited", <RpFull key="f" value={line.forfeited} />],
              ...((line.extras ?? []).map((x) => [`+ ${EXTRA_LABEL[x.kind]}`, <RpFull key={x.refId} value={x.amount} className="text-soft-cyan" />]) as [string, React.ReactNode][]),
              ["Adjustments, recoveries or clawback", line.recovered ? <span key="r">−<RpFull value={line.recovered} /></span> : d.recovered ? <span key="r2" className="text-sg-muted">— this period · <RpFull value={d.recovered} /> recovered on the project to date</span> : "—"],
              ["Gross bonus paid this salary", <RpFull key="gp" value={pph?.gross ?? gross} className="text-soft-green" />],
              ["PPh 21 withheld (estimate)", pph ? <span key="p" title={pph.note}>≈ <RpFull value={pph.withheld} /> <span className="text-2xs font-normal text-sg-dim">TER {pph.category} · {pph.ptkp} · {(pph.rate * 100).toFixed(2)}%</span></span> : "Withheld by payroll with the salary (§8.5)"],
              ["Net bonus paid (estimate)", pph ? <span key="n">≈ <RpFull value={pph.net} /></span> : "Shown on the payslip"],
            ]}
          />
          {line.notes.length > 0 && <p className="mt-1 text-2xs text-sg-dim">{line.notes.join(" · ")}</p>}
          {(line.heldItems ?? []).length > 0 && (
            <p className="mt-1 text-2xs text-soft-orange">
              Held amounts: {(line.heldItems ?? []).map((h) => `${formatIDR(h.amount, "full")} from the ${cycleLabel(h.fromMonth)} cycle${h.reason ? ` (${h.reason})` : ""}`).join("; ")} — paid in the first cycle after the condition clears (§10, §15.1).
            </p>
          )}
          {pph && <p className="mt-1 text-2xs text-soft-yellow">PPh 21 and net are estimates ({pph.note}); payroll computes the final figures with the salary (§8.5, Annex E).</p>}
        </div>
        <div>
          <h3 className="sg-eyebrow mb-1">Balances to date</h3>
          <Rows
            rows={[
              ["Total paid on this project", <RpFull key="1" value={d.paidOnProject} />],
              ["Deferred, not yet due", <RpFull key="2" value={d.deferredPending} />],
              ["Carried forward, not yet paid", <RpFull key="3" value={line.carriedOver} />],
              ["Held during probation", <RpFull key="4" value={d.held} />],
              ["Type C top-ups still to be deducted from later bonuses", d.topUpLeft == null ? "n/a" : <RpFull key="5" value={d.topUpLeft} />],
            ]}
          />
        </div>
        <p className="text-2xs text-sg-dim">
          Amounts are rounded down to whole rupiah (§8.5). Queries and corrections must be raised with Finance within {POLICY.statementDisputeDays} days of the statement date (§14) — until {formatDate(new Date(Date.parse(paymentDate(run.month)) + POLICY.statementDisputeDays * 86_400_000).toISOString(), "medium")}.
        </p>
      </div>
    </Modal>
  );
}
