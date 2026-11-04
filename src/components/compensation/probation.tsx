"use client";

/* §6.8 probationary employees: withheld accrual, monthly statement, completion / forfeiture. */
import { useMemo, useState } from "react";
import { CalendarClock, FileText, Hourglass, UserCheck, UserX } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { BonusRun, EmployeeProfile, ProbationOutcome } from "@/lib/initiatives/types";
import { probationBalance } from "@/lib/initiatives/engine";
import { EMPLOYMENT_META, POLICY } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState } from "@/components/ui/misc";
import { Modal } from "@/components/ui/overlays";
import { Cite, Metric, Money } from "@/components/initiatives/shared";
import { Callout, InitiativeLink, Panel, UserCell, dueText, monthLabel, tdCls, tdNum, thCls, thRight } from "./common";

interface Row {
  profile: EmployeeProfile;
  gross: number;
  settled: number;
  balance: number;
  outcomes: ProbationOutcome[];
  projects: string[];
  statement: { month: string; status: BonusRun["status"]; items: { initiativeId: string; amount: number }[]; total: number; cumulative: number }[];
  open: boolean;
}

export function ProbationTab() {
  const profiles = useCrm((s) => s.employeeProfiles);
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const outcomes = useCrm((s) => s.probationOutcomes);
  const members = useCrm((s) => s.initiativeMembers);
  const userMap = useUserMap();
  const [statementFor, setStatementFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "complete" | "fail"; userId: string } | null>(null);

  const rows = useMemo<Row[]>(() => {
    const counted = bonusRuns.filter((r) => r.status === "released" || r.status === "certified").sort((a, b) => a.month.localeCompare(b.month));
    return profiles
      .filter((p) => p.employmentType === "probationary" || outcomes.some((o) => o.userId === p.userId))
      .map((p) => {
        const own = outcomes.filter((o) => o.userId === p.userId);
        const gross = probationBalance(p.userId, bonusRuns);
        const settled = own.reduce((s, o) => s + o.amount, 0);
        let cumulative = 0;
        const statement = counted
          .map((r) => {
            const items = r.lines.filter((l) => l.userId === p.userId && l.withheld > 0).map((l) => ({ initiativeId: l.initiativeId, amount: l.withheld }));
            const total = items.reduce((s, i) => s + i.amount, 0);
            cumulative += total;
            return { month: r.month, status: r.status, items, total, cumulative };
          })
          .filter((m) => m.items.length);
        const projects = Array.from(new Set([...statement.flatMap((m) => m.items.map((i) => i.initiativeId)), ...members.filter((m) => m.userId === p.userId && m.consent === "accepted").map((m) => m.initiativeId)]));
        const open = p.employmentType === "probationary" && !(p.separation && Date.parse(p.separation.effectiveAt) <= Date.now());
        return { profile: p, gross, settled, balance: Math.max(0, gross - settled), outcomes: own, projects, statement, open };
      })
      .sort((a, b) => Number(b.open) - Number(a.open) || (a.profile.probationEndDate ?? "").localeCompare(b.profile.probationEndDate ?? ""));
  }, [profiles, bonusRuns, outcomes, members]);

  const liability = rows.filter((r) => r.open).reduce((s, r) => s + r.balance, 0);
  const openCount = rows.filter((r) => r.open).length;
  const selected = rows.find((r) => r.profile.userId === statementFor);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-sg-line bg-sg-card px-4 py-3">
        <Metric label="Aggregate probation liability" value={formatIDR(liability)} tone={liability ? "orange" : undefined} hint="withheld, not yet settled" />
        <Metric label="Employees on probation" value={String(openCount)} />
        <Metric label="Paid on completion" value={formatIDR(outcomes.filter((o) => o.outcome === "completed").reduce((s, o) => s + o.amount, 0))} tone="green" />
        <Metric label="Forfeited" value={formatIDR(outcomes.filter((o) => o.outcome === "forfeited").reduce((s, o) => s + o.amount, 0))} tone={outcomes.some((o) => o.outcome === "forfeited") ? "red" : undefined} />
        <div className="ml-auto max-w-md text-2xs text-sg-dim">
          Probationary employees participate fully but their bonuses accrue and are paid as one Probation Completion Bonus within 30 days of completing probation <Cite s="6.8" />. Balances count certified and released runs.
        </div>
      </div>

      <Panel title="Probationary employees" icon={Hourglass} cite="6.8" bodyClassName="p-0">
        {!rows.length ? (
          <EmptyState icon={UserCheck} title="No probationary employees">
            Employees on probation (per their HR record) appear here with their accrued, withheld bonus balance.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead>
                <tr className="border-b border-sg-line">
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Probation ends</th>
                  <th className={thCls}>Projects</th>
                  <th className={thRight}>Withheld to date</th>
                  <th className={thRight}>Settled</th>
                  <th className={thRight}>Balance</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const p = r.profile;
                  const last = r.outcomes[r.outcomes.length - 1];
                  return (
                    <tr key={p.userId} className="border-b border-sg-line align-top">
                      <td className={tdCls}>
                        <UserCell userId={p.userId} sub={`${EMPLOYMENT_META[p.employmentType].label} · hired ${formatDate(p.hireDate, "medium")}`} />
                      </td>
                      <td className={tdCls}>
                        <div className="text-sg-text">{formatDate(p.probationEndDate, "medium")}</div>
                        {r.open && p.probationEndDate ? <div className={cn("text-2xs", Date.parse(p.probationEndDate) < Date.now() ? "text-soft-orange" : "text-sg-dim")}>{Date.parse(p.probationEndDate) < Date.now() ? `${dueText(p.probationEndDate)} — decide now` : dueText(p.probationEndDate)}</div> : null}
                      </td>
                      <td className={cn(tdCls, "max-w-[260px]")}>
                        {r.projects.length ? (
                          <div className="space-y-1">
                            {r.projects.map((id) => (
                              <InitiativeLink key={id} id={id} compact />
                            ))}
                          </div>
                        ) : (
                          <span className="text-2xs text-sg-dim">None yet</span>
                        )}
                      </td>
                      <td className={tdNum}>
                        <Money value={r.gross} />
                      </td>
                      <td className={tdNum}>{r.settled ? <Money value={r.settled} /> : "—"}</td>
                      <td className={cn(tdNum, "font-semibold", r.balance ? "text-soft-orange" : "text-sg-dim")}>
                        <Money value={r.balance} />
                      </td>
                      <td className={tdCls}>
                        {r.open ? (
                          <Chip color="orange" dot>
                            On probation
                          </Chip>
                        ) : last ? (
                          <span title={`${formatIDR(last.amount, "full")} · ${formatDate(last.decidedAt, "medium")}`}>
                            <Chip color={last.outcome === "completed" ? "green" : "red"} dot>
                              {last.outcome === "completed" ? "Completed · paid" : "Forfeited"}
                            </Chip>
                          </span>
                        ) : (
                          <Chip color="blue">Closed</Chip>
                        )}
                        {last && r.open ? <div className="mt-1 text-2xs text-sg-dim">earlier settlement {formatDate(last.decidedAt, "short")}</div> : null}
                      </td>
                      <td className={cn(tdCls, "text-right")}>
                        <div className="flex flex-col items-end gap-1">
                          <Button size="xs" variant="outline" onClick={() => setStatementFor(p.userId)}>
                            <FileText /> Statement
                          </Button>
                          {r.open ? (
                            <>
                              <Button size="xs" variant="primary" onClick={() => setConfirm({ kind: "complete", userId: p.userId })}>
                                <UserCheck /> Completed → pay lump sum
                              </Button>
                              <Button size="xs" variant="danger" onClick={() => setConfirm({ kind: "fail", userId: p.userId })}>
                                <UserX /> Not completed → forfeit
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {selected ? (
        <Modal open onOpenChange={(o) => !o && setStatementFor(null)} title={`Probation statement · ${userMap.get(selected.profile.userId)?.name ?? ""}`} description="Monthly statement of withheld bonuses (§6.8)" className="w-[min(720px,calc(100vw-32px))]">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <Metric label="Cumulative balance" value={formatIDR(selected.balance)} tone={selected.balance ? "orange" : undefined} />
              <Metric label="Probation ends" value={formatDate(selected.profile.probationEndDate, "medium")} hint={selected.open && selected.profile.probationEndDate ? dueText(selected.profile.probationEndDate) : undefined} />
              <Metric label="Estimated completion payment" value={selected.profile.probationEndDate ? formatDate(new Date(Date.parse(selected.profile.probationEndDate) + 30 * 86_400_000).toISOString(), "medium") : "—"} hint="within 30 days of completion" />
            </div>
            {selected.statement.length ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sg-line">
                    <th className={thCls}>Month</th>
                    <th className={thCls}>Projects</th>
                    <th className={thRight}>Withheld</th>
                    <th className={thRight}>Cumulative</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.statement.map((m) => (
                    <tr key={m.month} className="border-b border-sg-line align-top">
                      <td className={tdCls}>
                        <div className="text-sg-white">{monthLabel(m.month)}</div>
                        <div className="text-2xs text-sg-dim">{m.status === "released" ? "released run" : "certified run"}</div>
                      </td>
                      <td className={tdCls}>
                        {m.items.map((i) => (
                          <div key={i.initiativeId} className="flex items-center justify-between gap-3 text-xs">
                            <InitiativeLink id={i.initiativeId} compact />
                            <Money value={i.amount} className="text-sg-muted" />
                          </div>
                        ))}
                      </td>
                      <td className={cn(tdNum, "text-sg-white")}>
                        <Money value={m.total} />
                      </td>
                      <td className={cn(tdNum, "font-semibold text-soft-orange")}>
                        <Money value={m.cumulative} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState icon={CalendarClock} title="No withheld amounts yet">
                Withheld amounts appear once a run containing this employee&apos;s project lines is certified.
              </EmptyState>
            )}
            {selected.settled ? <p className="text-2xs text-sg-dim">Already settled: {formatIDR(selected.settled, "full")} — the balance above is net of earlier settlements.</p> : null}
          </div>
        </Modal>
      ) : null}

      {confirm ? <ConfirmProbation kind={confirm.kind} row={rows.find((r) => r.profile.userId === confirm.userId)} onClose={() => setConfirm(null)} /> : null}
    </div>
  );
}

function ConfirmProbation({ kind, row, onClose }: { kind: "complete" | "fail"; row: Row | undefined; onClose: () => void }) {
  const completeProbation = useCrm((s) => s.completeProbation);
  const failProbation = useCrm((s) => s.failProbation);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  if (!row) return null;
  const name = userMap.get(row.profile.userId)?.name ?? "employee";
  const cap = row.profile.annualBaseSalary * POLICY.personAnnualCapOfSalary;
  const overCap = row.balance > cap;

  const submit = () => {
    if (kind === "complete") {
      completeProbation(row.profile.userId);
      notify(`${name}: probation completed — ${formatIDR(row.balance)} Probation Completion Bonus due within 30 days`);
    } else {
      failProbation(row.profile.userId);
      notify(`${name}: probation not completed — ${formatIDR(row.balance)} forfeited`);
    }
    onClose();
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={kind === "complete" ? "Probation completed" : "Probation not completed"}
      description={`${name} · accumulated balance ${formatIDR(row.balance, "full")}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={kind === "complete" ? "primary" : "danger"} size="sm" onClick={submit}>
            {kind === "complete" ? "Confirm — pay lump sum" : "Confirm — forfeit"}
          </Button>
        </>
      }
    >
      {kind === "complete" ? (
        <div className="space-y-2">
          <Callout tone="ok">
            The accumulated {formatIDR(row.balance, "full")} is paid as a single Probation Completion Bonus within 30 days <Cite s="6.8" />. The employee&apos;s HR record moves to full-time permanent.
          </Callout>
          <Callout tone={overCap ? "warn" : "info"}>
            {overCap
              ? `The lump sum exceeds the 200% annual salary cap (${formatIDR(cap, "full")}) — the excess needs CEO approval before payment (§6.2).`
              : `Any amount above the 200% annual salary cap (${formatIDR(cap)}) would require CEO approval (§6.2).`}
          </Callout>
        </div>
      ) : (
        <div className="space-y-2">
          <Callout tone="danger">
            All accumulated bonuses ({formatIDR(row.balance, "full")}) are forfeited in full <Cite s="6.8" />. Forfeited amounts do <span className="font-semibold">not</span> redistribute to other team members.
          </Callout>
          <p className="text-2xs text-sg-dim">A probation-failed separation is recorded on the HR record and in the audit log.</p>
        </div>
      )}
    </Modal>
  );
}
