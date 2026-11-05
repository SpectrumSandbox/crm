"use client";

/* /me — Annex E statement history, pending deferred bonuses (§9.3), probation balance (§11), my clawbacks (§9.4). */
import { useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Hourglass } from "lucide-react";
import { useCrm } from "@/lib/store";
import { addBusinessDays, clawbackAmount, paymentDate, probationBalance } from "@/lib/initiatives/engine";
import { POLICY } from "@/lib/initiatives/policy";
import type { BonusLine, BonusRun, EmployeeProfile, LineStatus } from "@/lib/initiatives/types";
import type { SpectrumColor } from "@/lib/types";
import { cn, daysFromNow, formatDate } from "@/lib/utils";
import { Chip, EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Cite, Metric } from "@/components/initiatives/shared";
import { RaiseDisputeButton } from "./disputes";
import { cycleLabel } from "./helpers";
import { StatementSheet } from "./statement-sheet";
import { AnnexCite, Card, NumCell, RpFull, SampleChip, TH, THEAD_ROW } from "./ui";

const LINE_STATUS: Record<LineStatus, { label: string; color: SpectrumColor }> = {
  payable: { label: "Paid", color: "green" },
  partially_deferred: { label: "Part deferred", color: "cyan" },
  carried_forward: { label: "Carried forward", color: "orange" },
  withheld_probation: { label: "Held · probation", color: "yellow" },
  forfeited: { label: "Forfeited", color: "red" },
  held: { label: "Held", color: "orange" },
  ineligible: { label: "Ineligible", color: "red" },
};
const RUN_STATUS: Record<BonusRun["status"], { label: string; color: SpectrumColor }> = {
  draft: { label: "Draft", color: "blue" },
  failed: { label: "Failed test", color: "red" },
  certified: { label: "Certified", color: "cyan" },
  released: { label: "Released", color: "green" },
};

type Key = "gross" | "topUp" | "topUpDeducted" | "payable" | "deferred" | "withheld" | "held" | "forfeited" | "carriedOver";

export function StatementHistory({ userId }: { userId: string }) {
  const runs = useCrm((s) => s.bonusRuns);
  const initiatives = useCrm((s) => s.initiatives);
  const [sheet, setSheet] = useState<{ run: BonusRun; line: BonusLine } | null>(null);

  const lines = useMemo(() => {
    const out: { run: BonusRun; line: BonusLine }[] = [];
    for (const run of runs) for (const line of run.lines) if (line.userId === userId) out.push({ run, line });
    return out.sort((a, b) => b.run.month.localeCompare(a.run.month) || a.line.initiativeId.localeCompare(b.line.initiativeId));
  }, [runs, userId]);
  const released = lines.filter((x) => x.run.status === "released");
  const sum = (k: Key) => released.reduce((s, x) => s + x.line[k], 0);

  return (
    <Card
      id="statements"
      title={
        <>
          Bonus statements <Cite s="8.4" />
          <AnnexCite annex="E" />
        </>
      }
      action={<span className="text-2xs text-sg-dim">Exact whole rupiah (§8.5) · dispute an error within {POLICY.statementDisputeDays} days of the statement date (§14)</span>}
    >
      {lines.length === 0 ? (
        <EmptyState title="No statements yet">A statement is issued on each salary date for every project you were paid from (Annex E).</EmptyState>
      ) : (
        <div className="-mx-4 -my-4 overflow-x-auto">
          <table className="w-full min-w-[1320px] text-xs">
            <thead>
              <tr className={THEAD_ROW}>
                <th className={cn(TH, "pl-4")}>Month</th>
                <th className={TH}>Project</th>
                <th className={cn(TH, "text-right")}>Gross share</th>
                <th className={cn(TH, "text-right")} title="Type C top-up paid (§8.6)">
                  Top-up +
                </th>
                <th className={cn(TH, "text-right")} title="Earlier top-ups deducted (§8.6)">
                  Deducted −
                </th>
                <th className={cn(TH, "text-right")}>Payable</th>
                <th className={cn(TH, "text-right")}>Deferred</th>
                <th className={cn(TH, "text-right")} title="Held during probation (§11.3)">
                  Withheld
                </th>
                <th className={cn(TH, "text-right")} title="Suspension, unpaid leave, Annex B missing, PRC confirmation (§10, §15.1)">
                  Held
                </th>
                <th className={cn(TH, "text-right")}>Forfeited</th>
                <th className={cn(TH, "text-right")} title="Carried forward after a failed test (§9.2)">
                  Carried
                </th>
                <th className={TH}>Status</th>
                <th className={cn(TH, "pr-4 text-right")}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map(({ run, line }) => {
                const ini = initiatives.find((i) => i.id === line.initiativeId);
                return (
                  <tr key={`${run.id}-${line.initiativeId}`} className="border-b border-sg-line align-top last:border-b-0">
                    <td className="py-1.5 pl-4 pr-2">
                      <div className="whitespace-nowrap font-semibold text-sg-white">{cycleLabel(run.month)}</div>
                      <div className="text-2xs text-sg-dim">
                        {run.status === "released" ? "paid" : "pays"} {formatDate(paymentDate(run.month), "short")}
                      </div>
                      <Chip color={RUN_STATUS[run.status].color} className="mt-0.5">
                        {RUN_STATUS[run.status].label}
                      </Chip>
                    </td>
                    <td className="px-2 py-1.5">
                      <Link href={`/initiatives/${line.initiativeId}`} className="font-semibold text-sg-text hover:text-sg-white hover:underline">
                        {ini?.title ?? line.initiativeId}
                      </Link>
                      {ini?.demo && <SampleChip />}
                      <div className="text-2xs text-sg-dim">
                        y {(line.sharePct * 100).toFixed(3)}% · weight {line.weight.toFixed(2)}
                        {line.totalWeightDays > 0 ? ` · ${((line.weightDays / line.totalWeightDays) * 100).toFixed(1)}% of weight-days` : ` / ${line.totalWeight.toFixed(2)}`}
                        {run.payoutPct < 1 ? ` · ${Math.round(run.payoutPct * 10_000) / 100}% released (§9.2)` : ""}
                      </div>
                      {line.notes.length > 0 && <div className="mt-0.5 max-w-[320px] text-2xs text-sg-dim">{line.notes.join(" · ")}</div>}
                    </td>
                    <NumCell v={line.gross} />
                    <NumCell v={line.topUp} tone="text-soft-cyan" />
                    <NumCell v={line.topUpDeducted} tone="text-soft-orange" />
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      {line.payable ? <RpFull value={line.payable} className="font-semibold text-soft-green" /> : <span className="text-sg-dim">—</span>}
                      {line.carriedIn > 0 && (
                        <div className="text-2xs text-sg-dim">
                          incl. <RpFull value={line.carriedIn} /> carried in
                        </div>
                      )}
                    </td>
                    <NumCell v={line.deferred} tone="text-soft-cyan" />
                    <NumCell v={line.withheld} tone="text-soft-yellow" />
                    <NumCell v={line.held} tone="text-soft-orange" />
                    <NumCell v={line.forfeited} tone="text-soft-red" />
                    <NumCell v={line.carriedOver} tone="text-soft-orange" />
                    <td className="px-2 py-1.5">
                      <Chip color={LINE_STATUS[line.status].color}>{LINE_STATUS[line.status].label}</Chip>
                    </td>
                    <td className="whitespace-nowrap py-1 pl-2 pr-4 text-right">
                      <Button size="xs" variant="ghost" onClick={() => setSheet({ run, line })} title="Open the full Annex E statement">
                        <FileText /> Statement
                      </Button>
                      <RaiseDisputeButton
                        prefill={{
                          category: "calculation",
                          subject: `${cycleLabel(run.month)} statement — ${ini?.title ?? "project"}`,
                          initiativeId: line.initiativeId,
                          runMonth: run.month,
                          lineRef: `line:${run.id}:${line.initiativeId}`,
                          amount: line.payable,
                          source: `${cycleLabel(run.month)} · ${ini?.title ?? "Project"} · payable`,
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-sg-line-2 bg-sg-bg/40 font-semibold">
                <td className="py-1.5 pl-4 pr-2 text-2xs uppercase tracking-wider text-sg-dim" colSpan={2}>
                  Totals of released runs · {released.length} line{released.length === 1 ? "" : "s"}
                </td>
                <NumCell v={sum("gross")} />
                <NumCell v={sum("topUp")} tone="text-soft-cyan" />
                <NumCell v={sum("topUpDeducted")} tone="text-soft-orange" />
                <NumCell v={sum("payable")} tone="text-soft-green" strong />
                <NumCell v={sum("deferred")} tone="text-soft-cyan" />
                <NumCell v={sum("withheld")} tone="text-soft-yellow" />
                <NumCell v={sum("held")} tone="text-soft-orange" />
                <NumCell v={sum("forfeited")} tone="text-soft-red" />
                <NumCell v={sum("carriedOver")} tone="text-soft-orange" />
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {sheet && <StatementSheet open={!!sheet} onOpenChange={(v) => !v && setSheet(null)} run={sheet.run} line={sheet.line} />}
    </Card>
  );
}

export function DeferredList({ userId }: { userId: string }) {
  const deferred = useCrm((s) => s.deferredBonuses);
  const initiatives = useCrm((s) => s.initiatives);
  const { pending, released, forfeited } = useMemo(() => {
    const mine = deferred.filter((d) => d.userId === userId);
    return {
      pending: mine.filter((d) => d.status === "pending").sort((a, b) => a.vestAt.localeCompare(b.vestAt)),
      released: mine.filter((d) => d.status === "released").reduce((s, d) => s + d.releasedAmount, 0),
      forfeited: mine.filter((d) => d.status === "forfeited").reduce((s, d) => s + d.amount, 0),
    };
  }, [deferred, userId]);
  const total = pending.reduce((s, d) => s + d.amount, 0);
  return (
    <Card
      title={
        <>
          Deferred bonuses <Cite s="9.3" />
        </>
      }
      action={pending.length ? <RpFull value={total} className="text-xs font-semibold text-soft-cyan" /> : undefined}
    >
      {pending.length === 0 ? (
        <p className="text-xs text-sg-dim">Nothing deferred. On high-risk projects up to 30% of each interim bonus is deferred for 6–12 months after close (§9.3).</p>
      ) : (
        <ul className="space-y-2">
          {pending.map((d) => {
            const ini = initiatives.find((i) => i.id === d.initiativeId);
            const days = daysFromNow(d.vestAt);
            return (
              <li key={d.id} className="flex items-start gap-2 text-xs">
                <Hourglass className="mt-0.5 size-3.5 shrink-0 text-soft-cyan" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-sg-white">{ini?.title ?? d.initiativeId}</div>
                  <div className="text-2xs text-sg-dim">
                    from the {cycleLabel(d.month)} cycle · vests {formatDate(d.vestAt, "medium")} ({days >= 0 ? `in ${days} days` : `due ${-days} days ago`}) · no interest
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <RpFull value={d.amount} className="font-semibold text-sg-white" />
                  <RaiseDisputeButton
                    className="-mr-1.5"
                    prefill={{ category: "calculation", subject: `Deferred bonus — ${ini?.title ?? "project"}`, initiativeId: d.initiativeId, runMonth: d.month, lineRef: `deferred:${d.id}`, amount: d.amount, source: `Deferred from the ${cycleLabel(d.month)} cycle · vests ${formatDate(d.vestAt, "medium")}` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {(released > 0 || forfeited > 0) && (
        <p className="mt-3 border-t border-sg-line pt-2 text-2xs text-sg-dim">
          Released so far <RpFull value={released} />
          {forfeited > 0 && (
            <>
              {" "}
              · forfeited <RpFull value={forfeited} className="text-soft-red" />
            </>
          )}
        </p>
      )}
    </Card>
  );
}

export function ProbationCard({ userId, profile }: { userId: string; profile: EmployeeProfile }) {
  const runs = useCrm((s) => s.bonusRuns);
  const outcomes = useCrm((s) => s.probationOutcomes);
  const paidOut = outcomes.filter((o) => o.userId === userId).reduce((s, o) => s + o.amount, 0);
  const balance = Math.max(0, probationBalance(userId, runs) - paidOut);
  const end = profile.probationEndDate;
  const days = end ? daysFromNow(end) : null;
  return (
    <Card
      title={
        <>
          Probation balance <Cite s="11.3" />
          <Cite s="11.4" />
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Metric label="Held so far" value={<RpFull value={balance} />} tone="yellow" hint="Probationary Bonus Accrual (company liability)" />
        <Metric label="Probation ends" value={end ? formatDate(end, "medium") : "—"} hint={days == null ? "Record the end date with HR" : days >= 0 ? `in ${days} days` : `${-days} days ago`} />
      </div>
      <p className="mt-3 text-2xs leading-relaxed text-sg-muted">
        Bonuses are calculated normally but held until probation ends — except your share of a Type C pool in a month a top-up is paid, which is paid with salary (§8.6). If confirmed, the full balance is paid as a Probation Completion Bonus within {POLICY.probationPayoutDays} days of the end date; if probation is not passed it is paid with final pay, unless dismissed for a serious violation (§11.4).
      </p>
    </Card>
  );
}

export function MyClawbacks({ userId }: { userId: string }) {
  const clawbacks = useCrm((s) => s.clawbacks);
  const initiatives = useCrm((s) => s.initiatives);
  const mine = useMemo(() => clawbacks.filter((c) => c.userId === userId && !["closed", "waived"].includes(c.status)), [clawbacks, userId]);
  if (!mine.length) return null;
  return (
    <Card
      id="clawbacks"
      title={
        <>
          Clawback notices <Cite s="9.4" />
        </>
      }
    >
      <ul className="space-y-2">
        {mine.map((c) => {
          const deadline = c.notifiedAt ? addBusinessDays(c.notifiedAt, POLICY.clawback.disputeBusinessDays) : null;
          const open = deadline && Date.parse(deadline) >= Date.now() && ["identified", "prc_approved"].includes(c.status);
          return (
            <li key={c.id} className="rounded-lg border border-sg-line px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sg-white">{initiatives.find((i) => i.id === c.initiativeId)?.title ?? c.initiativeId}</span>
                <Chip color="orange">{c.status.replace(/_/g, " ")}</Chip>
                <RpFull value={clawbackAmount(c)} className="ml-auto font-semibold text-soft-red" />
              </div>
              <div className="mt-0.5 text-2xs text-sg-dim">
                {c.trigger.replace(/_/g, " ")} · paid {formatDate(c.paidAt, "medium")}
                {deadline ? ` · ${open ? "dispute by" : "dispute window closed"} ${formatDate(deadline, "medium")}` : " · written notice not yet sent"}
                {" · "}salary deductions need your written agreement{c.writtenAgreement ? " (given)" : ""}
              </div>
              {c.status !== "disputed" && (
                <div className="mt-1 flex justify-end">
                  <RaiseDisputeButton
                    variant="outline"
                    label={open ? "Dispute or raise mitigating factors" : "Dispute"}
                    prefill={{ category: "clawback", subject: `Clawback — ${initiatives.find((i) => i.id === c.initiativeId)?.title ?? "project"}`, initiativeId: c.initiativeId, lineRef: `clawback:${c.id}`, amount: clawbackAmount(c), eventAt: c.notifiedAt ?? c.createdAt, source: `Clawback notice · ${c.trigger.replace(/_/g, " ")}` }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
