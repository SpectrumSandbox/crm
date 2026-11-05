"use client";

/*
 * Bonus liabilities roll-forward for Finance's month-end (Policy v4.0 §9.2, §9.3, §10, §11.3, §11.5):
 * opening + additions − payments − forfeitures/reductions = closing, per salary cycle, with a CSV for the GL.
 */
import { useMemo } from "react";
import { Download, Landmark } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import type { AuditEntry, BonusRun, DeferredBonus, ProbationOutcome } from "@/lib/initiatives/types";
import { cycleMonth, nextMonth } from "@/lib/initiatives/engine";
import { csvFilename, downloadCsv, type CsvColumn } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Cite, Metric } from "@/components/initiatives/shared";
import { Callout, Panel, RoleNote, exactIdr, monthLabel, shortMonthLabel, tdCls, tdNum, thCls, thRight } from "./common";

type Account = "deferred" | "carried" | "probation" | "held";
const ACCOUNTS: { key: Account; label: string; cite: string; hint: string }[] = [
  { key: "deferred", label: "Deferred bonuses", cite: "9.3", hint: "High-risk deferral, vests 6–12 months after project close" },
  { key: "carried", label: "Carried forward", cite: "9.2", hint: "Unpaid after a failed check, paid first next passing month" },
  { key: "probation", label: "Probationary Bonus Accrual", cite: "11.3", hint: "Held until probation ends" },
  { key: "held", label: "Held payments", cite: "10", hint: "Annex B, suspension, unpaid leave, PRC confirmation" },
];

export interface RollRow {
  month: string;
  account: Account;
  opening: number;
  additions: number;
  payments: number;
  reductions: number;
  closing: number;
}

const counted = (r: BonusRun) => r.status === "certified" || r.status === "released";

/** Roll-forward of every bonus liability account for each cycle up to `upto`. */
export function rollForward(upto: string, ctx: { runs: BonusRun[]; deferred: DeferredBonus[]; outcomes: ProbationOutcome[]; auditLog: AuditEntry[] }): RollRow[] {
  const runs = ctx.runs.filter(counted).sort((a, b) => a.month.localeCompare(b.month));
  const first = [runs[0]?.month, ...ctx.deferred.map((d) => d.month), ...ctx.outcomes.map((o) => cycleMonth(o.decidedAt))].filter((m): m is string => !!m && m <= upto).sort()[0];
  if (!first) return [];
  const runOf = (m: string) => runs.find((r) => r.month === m);
  const sumLines = (m: string, k: "deferred" | "withheld" | "held" | "carriedOver" | "carriedIn") => runOf(m)?.lines.reduce((s, l) => s + l[k], 0) ?? 0;

  // deferred: original amount from the releasing run's lines; release / reduction dates from the audit trail
  const events = ctx.deferred.map((d) => {
    const original = Math.max(d.amount, runOf(d.month)?.lines.find((l) => l.userId === d.userId && l.initiativeId === d.initiativeId)?.deferred ?? d.amount);
    const log = ctx.auditLog.filter((a) => a.entity === "deferred" && a.entityId === d.id);
    const releasedAt = log.find((a) => /released/i.test(a.action))?.at;
    const reducedAt = log.find((a) => /reduced|forfeit/i.test(a.action))?.at;
    const paid = d.status === "released" ? d.releasedAmount : 0;
    const reduced = d.status === "pending" ? original - d.amount : original - paid;
    return { add: d.month, original, paid, payMonth: releasedAt ? cycleMonth(releasedAt) : null, reduced, reduceMonth: reduced > 0 ? cycleMonth(reducedAt ?? releasedAt ?? new Date().toISOString()) : null };
  });

  const rows: RollRow[] = [];
  const closing: Record<Account, number> = { deferred: 0, carried: 0, probation: 0, held: 0 };
  for (let m = first; m <= upto; m = nextMonth(m)) {
    // deferred
    {
      const additions = events.filter((e) => e.add === m).reduce((s, e) => s + e.original, 0);
      const payments = events.filter((e) => e.payMonth === m).reduce((s, e) => s + e.paid, 0);
      const reductions = events.filter((e) => e.reduceMonth === m).reduce((s, e) => s + e.reduced, 0);
      const opening = closing.deferred;
      closing.deferred = opening + additions - payments - reductions;
      rows.push({ month: m, account: "deferred", opening, additions, payments, reductions, closing: closing.deferred });
    }
    // carried forward: the run's carried-in is paid first (§9.2) — in full whenever any new bonus is paid
    {
      const r = runOf(m);
      const opening = closing.carried;
      const close = r ? sumLines(m, "carriedOver") : opening;
      const carriedIn = r ? sumLines(m, "carriedIn") : 0;
      const payments = !r ? 0 : r.payoutPct > 0 ? carriedIn : Math.max(0, carriedIn - close);
      const reductions = r ? Math.max(0, opening - carriedIn) : 0; // dropped under §10 before it reached the run
      const additions = Math.max(0, close - (opening - reductions - payments));
      closing.carried = close;
      rows.push({ month: m, account: "carried", opening, additions, payments, reductions, closing: close });
    }
    // probation accrual
    {
      const additions = sumLines(m, "withheld");
      const settled = ctx.outcomes.filter((o) => cycleMonth(o.decidedAt) === m);
      const payments = settled.filter((o) => o.outcome !== "forfeited").reduce((s, o) => s + o.amount, 0);
      const reductions = settled.filter((o) => o.outcome === "forfeited").reduce((s, o) => s + o.amount, 0);
      const opening = closing.probation;
      closing.probation = Math.max(0, opening + additions - payments - reductions);
      rows.push({ month: m, account: "probation", opening, additions, payments, reductions, closing: closing.probation });
    }
    // held payments: what the cycle's run holds (re-checked and carried by the engine each cycle)
    {
      const r = runOf(m);
      const opening = closing.held;
      const close = r ? sumLines(m, "held") : opening;
      closing.held = close;
      rows.push({ month: m, account: "held", opening, additions: Math.max(0, close - opening), payments: Math.max(0, opening - close), reductions: 0, closing: close });
    }
  }
  return rows;
}

export function LiabilitiesTab({ month }: { month: string }) {
  const runs = useCrm((s) => s.bonusRuns);
  const deferred = useCrm((s) => s.deferredBonuses);
  const outcomes = useCrm((s) => s.probationOutcomes);
  const auditLog = useCrm((s) => s.auditLog);
  const notify = useUi((s) => s.notify);
  const access = useAccess();

  const rows = useMemo(() => rollForward(month, { runs, deferred, outcomes, auditLog }), [month, runs, deferred, outcomes, auditLog]);
  const current = rows.filter((r) => r.month === month);
  const months = useMemo(() => Array.from(new Set(rows.map((r) => r.month))).slice(-6), [rows]);
  const total = current.reduce((s, r) => s + r.closing, 0);
  const pendingNow = deferred.filter((d) => d.status === "pending").reduce((s, d) => s + d.amount, 0);
  const deferredClose = current.find((r) => r.account === "deferred")?.closing ?? 0;

  const cols: CsvColumn<RollRow>[] = [
    { header: "Cycle", value: (r) => r.month },
    { header: "Account", value: (r) => ACCOUNTS.find((a) => a.key === r.account)?.label ?? r.account },
    { header: "Opening (IDR)", value: (r) => Math.floor(r.opening) },
    { header: "Additions (IDR)", value: (r) => Math.floor(r.additions) },
    { header: "Paid (IDR)", value: (r) => -Math.floor(r.payments) },
    { header: "Forfeited / reduced (IDR)", value: (r) => -Math.floor(r.reductions) },
    { header: "Closing (IDR)", value: (r) => Math.floor(r.closing) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-sg-line bg-sg-card px-4 py-3">
        <Metric label={`Bonus liabilities · ${monthLabel(month)}`} value={exactIdr(total)} tone={total ? "orange" : undefined} hint="closing balance, all accounts" />
        {current.map((r) => (
          <Metric key={r.account} label={ACCOUNTS.find((a) => a.key === r.account)!.label} value={exactIdr(r.closing)} />
        ))}
        <div className="ml-auto flex items-center gap-2">
          {access.certify ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!rows.length}
              onClick={() => {
                downloadCsv(csvFilename(`bonus-liabilities-${month}`), rows, cols);
                notify(`${rows.length} rows exported for the general ledger`);
              }}
            >
              <Download /> Journal CSV
            </Button>
          ) : (
            <RoleNote>Finance exports the journal.</RoleNote>
          )}
        </div>
      </div>

      {months.length && month >= months[months.length - 1] && Math.abs(deferredClose - pendingNow) > 1 ? (
        <Callout tone="warn">The deferred roll-forward ({exactIdr(deferredClose)}) differs from the pending ledger ({exactIdr(pendingNow)}) — an entry was changed outside the release flow; check the audit log.</Callout>
      ) : null}

      {ACCOUNTS.map((a) => {
        const list = rows.filter((r) => r.account === a.key && months.includes(r.month));
        return (
          <Panel key={a.key} title={a.label} icon={Landmark} cite={a.cite} subtitle={a.hint} bodyClassName="p-0">
            {list.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-sg-line">
                      <th className={thCls}>Cycle</th>
                      <th className={thRight}>Opening</th>
                      <th className={thRight}>+ Additions</th>
                      <th className={thRight}>− Paid</th>
                      <th className={thRight}>− Forfeited / reduced</th>
                      <th className={thRight}>Closing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.month} className={cn("border-b border-sg-line last:border-b-0", r.month === month && "bg-sg-card-2/40")}>
                        <td className={cn(tdCls, "text-sg-text")}>{shortMonthLabel(r.month)}</td>
                        <td className={tdNum}>{exactIdr(r.opening)}</td>
                        <td className={cn(tdNum, r.additions ? "text-sg-text" : "text-sg-dim")}>{exactIdr(r.additions)}</td>
                        <td className={cn(tdNum, r.payments ? "text-soft-green" : "text-sg-dim")}>{exactIdr(-r.payments)}</td>
                        <td className={cn(tdNum, r.reductions ? "text-soft-red" : "text-sg-dim")}>{exactIdr(-r.reductions)}</td>
                        <td className={cn(tdNum, "font-semibold text-sg-white")}>{exactIdr(r.closing)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-3 text-xs text-sg-muted">No movements yet.</p>
            )}
          </Panel>
        );
      })}
      <p className="text-2xs text-sg-dim">
        Amounts come from certified and released runs, the deferred ledger and probation outcomes; payments and reductions are dated by the cycle they were recorded in. The CFO reviews the probationary exposure with the PRC each quarter <Cite s="11.5" />. Balances are reported in aggregate outside Finance (§9.6).
      </p>
    </div>
  );
}
