"use client";

/*
 * Bonus liabilities roll-forward for Finance's month-end (Policy v4.0 §9.2, §9.3, §10, §11.3, §11.5):
 * opening + additions − payments − forfeitures/reductions = closing, per salary cycle, with a CSV for the GL.
 */
import { useMemo } from "react";
import { Download, Landmark } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import type { BonusRun, DeferredBonus, ProbationOutcome } from "@/lib/initiatives/types";
import { cycleMonth, liabilityRollForward, nextMonth } from "@/lib/initiatives/engine";
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

/**
 * Roll-forward of every bonus liability account for each cycle up to `upto`. Opening and closing balances come from
 * the engine's liabilityRollForward (W7); additions and payments are taken from the runs, the deferred ledger and the
 * probation outcomes, and the balancing figure is shown as forfeited / reduced.
 */
export function rollForward(upto: string, ctx: { runs: BonusRun[]; deferred: DeferredBonus[]; outcomes: ProbationOutcome[] }): RollRow[] {
  const runs = ctx.runs.filter(counted);
  const first = [...runs.map((r) => r.month), ...ctx.deferred.map((d) => d.month)].filter((m) => m <= upto).sort()[0];
  if (!first) return [];
  const runOf = (m: string) => runs.find((r) => r.month === m);
  const sumLines = (m: string, k: "deferred" | "withheld" | "held" | "carriedOver" | "carriedIn") => runOf(m)?.lines.reduce((s, l) => s + l[k], 0) ?? 0;
  const rows: RollRow[] = [];
  for (let m = first; m <= upto; m = nextMonth(m)) {
    const lr = liabilityRollForward(m, { runs: ctx.runs, deferred: ctx.deferred, probationOutcomes: ctx.outcomes });
    const acc = (k: Account) => lr.accounts.find((a) => a.key === k)!;
    const r = runOf(m);
    const movements: Record<Account, { additions: number; payments: number }> = {
      // deferred: amounts deferred by this cycle's run; paid when a release lands in this cycle's payroll
      deferred: { additions: sumLines(m, "deferred"), payments: ctx.deferred.filter((d) => d.status === "released" && (d.payMonth ?? (d.releasedAt ? cycleMonth(d.releasedAt) : null)) === m).reduce((s, d) => s + d.releasedAmount, 0) },
      // carried: paid first whenever any new bonus is paid (§9.2)
      carried: (() => {
        const carriedIn = r ? r.lines.reduce((s, l) => s + Math.max(0, l.carriedIn - (l.heldIn ?? 0)), 0) : 0;
        const payments = !r ? 0 : r.payoutPct > 0 ? carriedIn : 0;
        return { payments, additions: Math.max(0, acc("carried").closing - (acc("carried").opening - payments)) };
      })(),
      probation: { additions: sumLines(m, "withheld"), payments: ctx.outcomes.filter((o) => o.outcome !== "forfeited" && (o.payMonth ?? cycleMonth(o.decidedAt)) === m).reduce((s, o) => s + o.amount, 0) },
      held: { additions: r ? r.lines.reduce((s, l) => s + (l.heldItems ?? []).filter((h) => h.fromMonth === m).reduce((a, h) => a + h.amount, 0), 0) || Math.max(0, acc("held").closing - acc("held").opening) : 0, payments: r ? r.lines.reduce((s, l) => s + (l.heldIn ?? 0), 0) : 0 },
    };
    for (const k of ["deferred", "carried", "probation", "held"] as Account[]) {
      const a = acc(k);
      const mv = movements[k];
      rows.push({ month: m, account: k, opening: a.opening, additions: mv.additions, payments: mv.payments, reductions: Math.max(0, a.opening + mv.additions - mv.payments - a.closing), closing: a.closing });
    }
  }
  return rows;
}

export function LiabilitiesTab({ month }: { month: string }) {
  const runs = useCrm((s) => s.bonusRuns);
  const deferred = useCrm((s) => s.deferredBonuses);
  const outcomes = useCrm((s) => s.probationOutcomes);
  const notify = useUi((s) => s.notify);
  const access = useAccess();

  const rows = useMemo(() => rollForward(month, { runs, deferred, outcomes }), [month, runs, deferred, outcomes]);
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
        Opening and closing balances come from certified and released runs, the deferred ledger and probation outcomes; additions and payments are dated by the salary cycle they belong to, and the balancing figure is forfeited or reduced (§9.3, §10). The CFO reviews the probationary exposure with the PRC each quarter <Cite s="11.5" />. Balances are reported in aggregate outside Finance (§9.6).
      </p>
    </div>
  );
}
