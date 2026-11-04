"use client";

/* §11 probationary employees: held balance (Probationary Bonus Accrual), monthly statement, outcomes. */
import { useMemo, useState } from "react";
import { Ban, CalendarClock, FileText, Hourglass, UserCheck, UserX } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { BonusRun, EmployeeProfile, ProbationOutcome } from "@/lib/initiatives/types";
import { addMonths, probationBalance } from "@/lib/initiatives/engine";
import { EMPLOYMENT_META, POLICY } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState } from "@/components/ui/misc";
import { Modal } from "@/components/ui/overlays";
import { Cite, Metric, Money } from "@/components/initiatives/shared";
import { Callout, InitiativeLink, Panel, UserCell, dueText, monthLabel, tdCls, tdNum, thCls, thRight } from "./common";

const DAY = 86_400_000;

interface Row {
  profile: EmployeeProfile;
  gross: number;
  settled: number;
  balance: number;
  outcomes: ProbationOutcome[];
  projects: string[];
  statement: { month: string; status: BonusRun["status"]; items: { initiativeId: string; amount: number; paidTopUpMonth: boolean }[]; total: number; cumulative: number }[];
  open: boolean;
  /** §11.1 statutory maximum end date (hire + 3 months) */
  maxEnd: string;
  overMax: boolean;
}

export const outcomeMeta: Record<ProbationOutcome["outcome"], { label: string; color: "green" | "cyan" | "red"; detail: string }> = {
  completed: { label: "Confirmed · Probation Completion Bonus", color: "green", detail: "Paid as a lump sum within 30 days of the probation end date, taxed as normal" },
  paid_final_pay: { label: "Paid with final pay", color: "cyan", detail: "Probation not passed or employment ended — the held balance is paid with final pay, less PPh 21" },
  forfeited: { label: "Forfeited · serious violation", color: "red", detail: "Dismissal for a serious violation (§10) — the held balance is forfeited" },
};

export function ProbationTab() {
  const profiles = useCrm((s) => s.employeeProfiles);
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const outcomes = useCrm((s) => s.probationOutcomes);
  const members = useCrm((s) => s.initiativeMembers);
  const userMap = useUserMap();
  const [statementFor, setStatementFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "complete" | "fail" | "dismiss"; userId: string } | null>(null);

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
            const mine = r.lines.filter((l) => l.userId === p.userId);
            const items = mine.filter((l) => l.withheld > 0 || (l.topUp > 0 && l.payable > 0)).map((l) => ({ initiativeId: l.initiativeId, amount: l.withheld, paidTopUpMonth: l.topUp > 0 && l.withheld === 0 }));
            const total = items.reduce((s, i) => s + i.amount, 0);
            cumulative += total;
            return { month: r.month, status: r.status, items, total, cumulative };
          })
          .filter((m) => m.items.length);
        const projects = Array.from(new Set([...statement.flatMap((m) => m.items.map((i) => i.initiativeId)), ...members.filter((m) => m.userId === p.userId && m.consent === "accepted").map((m) => m.initiativeId)]));
        const open = p.employmentType === "probationary" && !(p.separation && Date.parse(p.separation.effectiveAt) <= Date.now());
        const maxEnd = addMonths(p.hireDate, POLICY.probationMaxMonths);
        const overMax = !!p.probationEndDate && Date.parse(p.probationEndDate) > Date.parse(maxEnd) + DAY;
        return { profile: p, gross, settled, balance: Math.max(0, gross - settled), outcomes: own, projects, statement, open, maxEnd, overMax };
      })
      .sort((a, b) => Number(b.open) - Number(a.open) || (a.profile.probationEndDate ?? "").localeCompare(b.profile.probationEndDate ?? ""));
  }, [profiles, bonusRuns, outcomes, members]);

  const liability = rows.filter((r) => r.open).reduce((s, r) => s + r.balance, 0);
  const openCount = rows.filter((r) => r.open).length;
  const selected = rows.find((r) => r.profile.userId === statementFor);
  const total = (o: ProbationOutcome["outcome"]) => outcomes.filter((x) => x.outcome === o).reduce((s, x) => s + x.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-sg-line bg-sg-card px-4 py-3">
        <Metric label="Probationary bonus liability" value={formatIDR(liability)} tone={liability ? "orange" : undefined} hint="held, not yet paid (§11.5)" />
        <Metric label="On probation" value={String(openCount)} />
        <Metric label="Completion bonuses" value={formatIDR(total("completed"))} tone="green" />
        <Metric label="Paid with final pay" value={formatIDR(total("paid_final_pay"))} />
        <Metric label="Forfeited" value={formatIDR(total("forfeited"))} tone={total("forfeited") ? "red" : undefined} />
        <div className="ml-auto max-w-md text-2xs text-sg-dim">
          Probationary hires take part fully; their bonuses are calculated normally and held in the Probationary Bonus Accrual account until probation ends (max {POLICY.probationMaxMonths} months, cannot be extended) <Cite s="11" />. Exception: in a month a Type C top-up is paid, their share of that month&apos;s pool is paid with salary <Cite s="8.6" />.
        </div>
      </div>

      <Panel title="Probationary employees" icon={Hourglass} cite="11.3" bodyClassName="p-0">
        {!rows.length ? (
          <EmptyState icon={UserCheck} title="No probationary employees">
            New permanent (PKWTT) hires on probation appear here with their held balance. Fixed-term (PKWT) contracts cannot include probation (§11.1).
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead>
                <tr className="border-b border-sg-line">
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Expected end</th>
                  <th className={thCls}>Projects</th>
                  <th className={thRight}>Held to date</th>
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
                  const due = p.probationEndDate ? new Date(Date.parse(p.probationEndDate) + POLICY.probationPayoutDays * DAY).toISOString() : null;
                  return (
                    <tr key={p.userId} className="border-b border-sg-line align-top">
                      <td className={tdCls}>
                        <UserCell userId={p.userId} sub={`${EMPLOYMENT_META[p.employmentType].label} · hired ${formatDate(p.hireDate, "medium")}`} />
                      </td>
                      <td className={tdCls}>
                        <div className="text-sg-text">{formatDate(p.probationEndDate, "medium")}</div>
                        {r.open && p.probationEndDate ? <div className={cn("text-2xs", Date.parse(p.probationEndDate) < Date.now() ? "text-soft-orange" : "text-sg-dim")}>{Date.parse(p.probationEndDate) < Date.now() ? `${dueText(p.probationEndDate)} — record the outcome` : dueText(p.probationEndDate)}</div> : null}
                        {r.open && r.overMax ? <div className="text-2xs text-soft-red">Beyond the 3-month legal maximum ({formatDate(r.maxEnd, "short")}) — correct the HR record (§11.1)</div> : null}
                        {r.open && !p.probationEndDate ? <div className="text-2xs text-soft-yellow">No end date — at most {formatDate(r.maxEnd, "short")} (§11.1)</div> : null}
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
                          <span title={`${outcomeMeta[last.outcome].detail} · ${formatIDR(last.amount, "full")} · ${formatDate(last.decidedAt, "medium")}`}>
                            <Chip color={outcomeMeta[last.outcome].color} dot>
                              {outcomeMeta[last.outcome].label}
                            </Chip>
                          </span>
                        ) : (
                          <Chip color="blue">Closed</Chip>
                        )}
                        {last?.outcome === "completed" && due ? <div className="mt-1 text-2xs text-sg-dim">pay by {formatDate(due, "medium")}</div> : null}
                      </td>
                      <td className={cn(tdCls, "text-right")}>
                        <div className="flex flex-col items-end gap-1">
                          <Button size="xs" variant="outline" onClick={() => setStatementFor(p.userId)}>
                            <FileText /> Statement
                          </Button>
                          {r.open ? (
                            <>
                              <Button size="xs" variant="primary" onClick={() => setConfirm({ kind: "complete", userId: p.userId })}>
                                <UserCheck /> Confirmed → completion bonus
                              </Button>
                              <Button size="xs" variant="outline" onClick={() => setConfirm({ kind: "fail", userId: p.userId })}>
                                <UserX /> Not passed / ended → final pay
                              </Button>
                              <Button size="xs" variant="danger" onClick={() => setConfirm({ kind: "dismiss", userId: p.userId })}>
                                <Ban /> Serious violation → forfeit
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
        <Modal open onOpenChange={(o) => !o && setStatementFor(null)} title={`Probation statement · ${userMap.get(selected.profile.userId)?.name ?? ""}`} description="Projects, amounts calculated, cumulative balance held and expected probation end date (§11.3)" className="w-[min(720px,calc(100vw-32px))]">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <Metric label="Cumulative balance held" value={formatIDR(selected.balance)} tone={selected.balance ? "orange" : undefined} />
              <Metric label="Expected probation end" value={formatDate(selected.profile.probationEndDate, "medium")} hint={selected.open && selected.profile.probationEndDate ? dueText(selected.profile.probationEndDate) : undefined} />
              <Metric label="Completion bonus due by" value={selected.profile.probationEndDate ? formatDate(new Date(Date.parse(selected.profile.probationEndDate) + POLICY.probationPayoutDays * DAY).toISOString(), "medium") : "—"} hint="within 30 days of the end date if confirmed (§11.4)" />
            </div>
            {selected.statement.length ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sg-line">
                    <th className={thCls}>Cycle</th>
                    <th className={thCls}>Projects</th>
                    <th className={thRight}>Held</th>
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
                            {i.paidTopUpMonth ? <span className="text-2xs text-soft-magenta">Type C top-up month — paid with salary (§8.6)</span> : <Money value={i.amount} className="text-sg-muted" />}
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
              <EmptyState icon={CalendarClock} title="Nothing held yet">
                Held amounts appear once a run with this employee&apos;s project lines is certified.
              </EmptyState>
            )}
            {selected.settled ? <p className="text-2xs text-sg-dim">Already settled: {formatIDR(selected.settled, "full")} — the balance is net of earlier settlements.</p> : null}
          </div>
        </Modal>
      ) : null}

      {confirm ? <ConfirmProbation kind={confirm.kind} row={rows.find((r) => r.profile.userId === confirm.userId)} onClose={() => setConfirm(null)} /> : null}
    </div>
  );
}

function ConfirmProbation({ kind, row, onClose }: { kind: "complete" | "fail" | "dismiss"; row: Row | undefined; onClose: () => void }) {
  const completeProbation = useCrm((s) => s.completeProbation);
  const failProbation = useCrm((s) => s.failProbation);
  const recordSeparation = useCrm((s) => s.recordSeparation);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  if (!row) return null;
  const name = userMap.get(row.profile.userId)?.name ?? "employee";
  const end = row.profile.probationEndDate ?? new Date().toISOString();
  const payBy = new Date(Math.max(Date.parse(end), Date.now()) + POLICY.probationPayoutDays * DAY).toISOString();

  const submit = () => {
    if (kind === "complete") {
      completeProbation(row.profile.userId);
      notify(`${name}: confirmed — ${formatIDR(row.balance)} Probation Completion Bonus due by ${formatDate(payBy, "medium")}`);
    } else if (kind === "fail") {
      failProbation(row.profile.userId);
      notify(`${name}: probation ended — ${formatIDR(row.balance)} paid with final pay`);
    } else {
      recordSeparation(row.profile.userId, "termination_for_cause", new Date().toISOString(), { noticeAt: new Date().toISOString() });
      notify(`${name}: dismissal for a serious violation recorded — ${formatIDR(row.balance)} held balance forfeited`);
    }
    onClose();
  };

  const title = kind === "complete" ? "Probation passed — confirm as permanent" : kind === "fail" ? "Probation not passed, or employment ended" : "Dismissal for a serious violation";
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={`${name} · held balance ${formatIDR(row.balance, "full")} (§11.4)`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={kind === "dismiss" ? "danger" : "primary"} size="sm" onClick={submit}>
            {kind === "complete" ? "Confirm — pay completion bonus" : kind === "fail" ? "Confirm — pay with final pay" : "Confirm dismissal — forfeit"}
          </Button>
        </>
      }
    >
      {kind === "complete" ? (
        <Callout tone="ok">
          The full held balance of {formatIDR(row.balance, "full")} is paid as a lump sum labelled &ldquo;Probation Completion Bonus&rdquo; within {POLICY.probationPayoutDays} days of the probation end date (by {formatDate(payBy, "medium")}), taxed as normal. From then on bonuses are paid with salary. The HR record moves to permanent (PKWTT). <Cite s="11.4" />
        </Callout>
      ) : kind === "fail" ? (
        <div className="space-y-2">
          <Callout tone="info">
            The full held balance of {formatIDR(row.balance, "full")} is paid with final pay, less income tax, because it was earned for work already done. Bonuses on revenue collected after the last working day follow the resignation rules in §10. <Cite s="11.4" />
          </Callout>
          <p className="text-2xs text-sg-dim">Records the end of employment during probation today on the HR record; ledger rows close on the same date.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <Callout tone="danger">
            Only dismissal for a serious violation defined in the Company Regulations, after the procedure required by law, forfeits the held balance ({formatIDR(row.balance, "full")}). Forfeited amounts return to the company and are not redistributed. <Cite s="10" />
          </Callout>
          <p className="text-2xs text-sg-dim">Records a dismissal for a serious violation effective today; pending deferred amounts are forfeited too.</p>
        </div>
      )}
    </Modal>
  );
}
