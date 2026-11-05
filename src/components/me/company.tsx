"use client";

/*
 * §9.6 transparency — the monthly company financial summary every employee receives: revenue, costs, margin and the
 * break-even test result, plus deferral, carry-forward, clawback and probation balances in aggregate. Individual
 * amounts are confidential and never shown here. Finance / the PRC publish each cycle's snapshot.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3, CircleCheck, CircleX, Printer, Send } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import { buildCompanySummary } from "@/lib/slices/program-extras";
import type { CompanySummary } from "@/lib/initiatives/types";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Chip, EmptyState } from "@/components/ui/misc";
import { Cite, Metric } from "@/components/initiatives/shared";
import { cycleLabel } from "./helpers";
import { Card, TH, THEAD_ROW } from "./ui";

const pct = (n: number) => `${(Math.round(n * 1000) / 10).toLocaleString("id-ID")}%`;
const margin = (s: CompanySummary) => (s.companyRevenue > 0 ? s.operatingResult / s.companyRevenue : 0);

function Fig({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "green" | "red" | "yellow" | "orange" }) {
  return <Metric label={label} value={<span title={formatIDR(value, "full")}>{formatIDR(value)}</span>} hint={hint} tone={tone} />;
}

function Result({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", ok ? "text-soft-green" : "text-soft-red")}>
      {ok ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />} {label} {ok ? "passed" : "failed"}
    </span>
  );
}

function SummaryView({ s }: { s: CompanySummary }) {
  const users = useCrm((st) => st.users);
  return (
    <div className="space-y-4">
      <Card
        title={
          <>
            {cycleLabel(s.month)} · company results <Cite s="9.6" />
          </>
        }
        action={
          <span className="text-2xs text-sg-dim">
            Published {formatDate(s.publishedAt, "medium")} by {users.find((u) => u.id === s.publishedById)?.name ?? "Finance"}
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fig label="Revenue" value={s.companyRevenue} hint="rolling three months, excl. VAT" />
          <Fig label="Direct project costs" value={s.directCosts} />
          <Fig label="Other operating costs" value={s.overheads} hint="incl. every salary" />
          <Metric label="Operating margin" value={pct(margin(s))} tone={s.operatingResult >= 0 ? "green" : "red"} hint={`${formatIDR(s.operatingResult)} after bonuses`} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-sg-line bg-sg-bg/40 px-3 py-2">
          <Result ok={s.breakEvenPassed} label="Break-even test and cash check" />
          <span className="text-xs text-sg-text">
            {s.payoutPct >= 1 ? "Bonuses released in full" : `${pct(s.payoutPct)} of bonuses released, the rest carried forward (§9.2)`} <Cite s="9.1" />
          </span>
          <span className="text-2xs text-sg-dim">
            {s.projects} project{s.projects === 1 ? "" : "s"} · {s.participants} participant{s.participants === 1 ? "" : "s"} paid from the cycle
          </span>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={<>Bonuses this cycle — in aggregate</>}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Fig label="Bonus pools" value={s.pool} />
            <Fig label="Paid with the salary" value={s.payable} tone="green" />
            <Fig label="Deferred (high risk)" value={s.deferred} hint="§9.3" />
            <Fig label="Carried forward" value={s.carriedOver} tone={s.carriedOver ? "orange" : undefined} hint="§9.2" />
            <Fig label="Held during probation" value={s.probationHeld} hint="§11.3" />
            <Fig label="Held (Annex B, status)" value={s.held} hint="§10, §15.1" />
          </div>
        </Card>
        <Card title={<>Balances to date — in aggregate</>}>
          <div className="grid grid-cols-2 gap-4">
            <Fig label="Deferred, not yet due" value={s.balances.deferredPending} />
            <Fig label="Carried forward, not yet paid" value={s.balances.carriedForward} />
            <Fig label="Probation balances" value={s.balances.probationHeld} />
            <Fig label="Clawbacks outstanding" value={s.balances.clawbackOutstanding} hint="§9.4" />
          </div>
        </Card>
      </div>
      {s.note && <p className="text-2xs text-sg-muted">{s.note}</p>}
    </div>
  );
}

export function CompanyResults() {
  const summaries = useCrm((s) => s.companySummaries);
  const runs = useCrm((s) => s.bonusRuns);
  const deferred = useCrm((s) => s.deferredBonuses);
  const clawbacks = useCrm((s) => s.clawbacks);
  const outcomes = useCrm((s) => s.probationOutcomes);
  const publish = useCrm((s) => s.publishCompanySummary);
  const notify = useUi((s) => s.notify);
  const access = useAccess();
  const canPublish = access.certify || access.prc;
  const sorted = useMemo(() => [...summaries].sort((a, b) => b.month.localeCompare(a.month)), [summaries]);
  const [month, setMonth] = useState<string>("");
  const shown = sorted.find((s) => s.month === month) ?? sorted[0];
  const [note, setNote] = useState("");

  // Finance / PRC: cycles with a decided run that have no published summary yet, with a preview
  const unpublished = useMemo(
    () =>
      canPublish
        ? runs
            .filter((r) => r.status !== "draft" && !summaries.some((s) => s.month === r.month))
            .sort((a, b) => b.month.localeCompare(a.month))
            .map((r) => buildCompanySummary(r, { runs, deferred, clawbacks, outcomes }, { id: "preview", publishedAt: new Date().toISOString(), publishedById: access.userId }))
        : [],
    [canPublish, runs, summaries, deferred, clawbacks, outcomes, access.userId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Company results" crumbs={[{ href: "/me", label: "My compensation" }]} meta={<Chip color="cyan">§9.6 · aggregate only</Chip>} className="print:hidden">
        {sorted.length > 0 && (
          <Select aria-label="Cycle" value={shown?.month ?? ""} onChange={(e) => setMonth(e.target.value)} wrapperClassName="w-44">
            {sorted.map((s) => (
              <option key={s.month} value={s.month}>
                {cycleLabel(s.month)}
              </option>
            ))}
          </Select>
        )}
        <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!shown}>
          <Printer /> Print
        </Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <div className="mx-auto max-w-[1100px] space-y-4">
          <p className="text-xs text-sg-muted">
            Every month all employees receive the company financial summary and the break-even test result. Deferral, carry-forward, clawback and probationary balances are reported in aggregate; individual amounts are confidential and detailed figures go to the PRC only (§9.6). Quarterly town halls review the results.{" "}
            <Link href="/me" className="text-soft-cyan hover:underline">
              <ArrowLeft className="mr-0.5 inline size-3" />
              My compensation
            </Link>
          </p>

          {canPublish && unpublished.length > 0 && (
            <Card title={<>Publish to all employees</>} action={<span className="text-2xs text-sg-dim">Finance / PRC · preview of the aggregate snapshot</span>} className="print:hidden">
              <ul className="space-y-2">
                {unpublished.map((p) => (
                  <li key={p.month} className="flex flex-wrap items-center gap-3 rounded-lg border border-sg-line bg-sg-bg/40 px-3 py-2 text-xs">
                    <span className="font-semibold text-sg-white">{cycleLabel(p.month)}</span>
                    <span className="text-sg-muted">
                      Revenue {formatIDR(p.companyRevenue)} · margin {pct(margin(p))} · {p.breakEvenPassed ? "checks passed" : "checks failed"} · {pct(p.payoutPct)} released
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to employees (optional)" className="h-7 w-56 text-xs" />
                      <Button
                        size="xs"
                        variant="primary"
                        onClick={() => {
                          const id = publish(p.month, note.trim() || undefined);
                          if (id) {
                            setNote("");
                            setMonth(p.month);
                            notify(`${cycleLabel(p.month)} company summary published to every employee (§9.6)`);
                          } else notify("Only Finance or the PRC can publish a decided cycle");
                        }}
                      >
                        <Send /> Publish
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {!shown ? (
            <EmptyState icon={BarChart3} title="No summary published yet">
              Finance publishes the summary each month after the break-even test (§9.1, §9.6).
            </EmptyState>
          ) : (
            <div id="company-print">
              <SummaryView s={shown} />
            </div>
          )}

          {sorted.length > 1 && (
            <Card title={<>Trend</>} className="print:hidden">
              <div className="-mx-4 -my-4 overflow-x-auto">
                <table className="w-full min-w-[720px] text-xs">
                  <thead>
                    <tr className={THEAD_ROW}>
                      <th className={cn(TH, "pl-4")}>Cycle</th>
                      <th className={cn(TH, "text-right")}>Revenue</th>
                      <th className={cn(TH, "text-right")}>Costs</th>
                      <th className={cn(TH, "text-right")}>Margin</th>
                      <th className={TH}>Checks</th>
                      <th className={cn(TH, "text-right")}>Released</th>
                      <th className={cn(TH, "pr-4 text-right")}>Bonuses paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((s) => (
                      <tr key={s.month} className={cn("cursor-pointer border-b border-sg-line last:border-b-0 hover:bg-sg-card-2/40", s.month === shown?.month && "bg-sg-card-2/60")} onClick={() => setMonth(s.month)}>
                        <td className="py-1.5 pl-4 pr-2 font-semibold text-sg-white">{cycleLabel(s.month)}</td>
                        <td className="sg-num px-2 py-1.5 text-right text-sg-text">{formatIDR(s.companyRevenue)}</td>
                        <td className="sg-num px-2 py-1.5 text-right text-sg-text">{formatIDR(s.directCosts + s.overheads)}</td>
                        <td className={cn("sg-num px-2 py-1.5 text-right", s.operatingResult >= 0 ? "text-soft-green" : "text-soft-red")}>{pct(margin(s))}</td>
                        <td className="px-2 py-1.5">{s.breakEvenPassed ? <Chip color="green">Passed</Chip> : <Chip color="red">Failed</Chip>}</td>
                        <td className="sg-num px-2 py-1.5 text-right text-sg-text">{pct(s.payoutPct)}</td>
                        <td className="sg-num py-1.5 pl-2 pr-4 text-right text-sg-white">{formatIDR(s.payable)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>
      <style>{`@media print { body * { visibility: hidden !important; } #company-print, #company-print * { visibility: visible !important; color: #111 !important; background: transparent !important; } #company-print { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
    </div>
  );
}

/** Compact card for /me: the latest published summary. */
export function CompanyResultsCard() {
  const summaries = useCrm((s) => s.companySummaries);
  const latest = useMemo(() => [...summaries].sort((a, b) => b.month.localeCompare(a.month))[0], [summaries]);
  return (
    <Card
      title={
        <>
          Company results <Cite s="9.6" />
        </>
      }
      action={
        <Link href="/me/company" className="text-2xs font-semibold text-sg-muted hover:text-sg-white">
          All months →
        </Link>
      }
    >
      {!latest ? (
        <p className="text-xs text-sg-dim">Finance publishes the monthly company summary after the break-even test.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-sg-white">{cycleLabel(latest.month)}</span>
            {latest.breakEvenPassed ? <Chip color="green">Checks passed</Chip> : <Chip color="red">Checks failed · {pct(latest.payoutPct)} released</Chip>}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Fig label="Revenue" value={latest.companyRevenue} hint="rolling 3 months" />
            <Fig label="Costs" value={latest.directCosts + latest.overheads} />
            <Metric label="Margin" value={pct(margin(latest))} tone={latest.operatingResult >= 0 ? "green" : "red"} />
          </div>
          <p className="text-2xs text-sg-dim">Aggregate figures only — individual amounts are confidential (§9.6).</p>
        </div>
      )}
    </Card>
  );
}
