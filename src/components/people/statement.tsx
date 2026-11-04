"use client";

/* Annex E monthly bonus statement (§8.4) per project and cycle, and the employee's Team Allocation Ledger rows (§6.5). */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useCrm } from "@/lib/store";
import type { BonusLine, BonusRun, LineStatus } from "@/lib/initiatives/types";
import { allocationFactorOf, collectionWindow, effectiveWeight, isLiveMember, memberWeight, overlapDays, paymentDate, projectPayments, projectRate, topUpBalance } from "@/lib/initiatives/engine";
import { POLICY, ROLE_META } from "@/lib/initiatives/policy";
import type { SpectrumColor } from "@/lib/types";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { Chip } from "@/components/ui/misc";
import { Cite, Money, RoleChips, StatusChip, TypeChip } from "@/components/initiatives/shared";
import { Block } from "./fields";

const LINE_STATUS: Record<LineStatus, { label: string; color: SpectrumColor }> = {
  payable: { label: "Paid", color: "green" },
  partially_deferred: { label: "Part deferred", color: "cyan" },
  carried_forward: { label: "Part carried forward", color: "yellow" },
  withheld_probation: { label: "Held · probation", color: "yellow" },
  forfeited: { label: "Forfeited", color: "red" },
  held: { label: "Held", color: "orange" },
  ineligible: { label: "Ineligible", color: "red" },
};
const RUN_STATUS: Record<BonusRun["status"], { label: string; color: SpectrumColor }> = {
  draft: { label: "Provisional", color: "blue" },
  failed: { label: "Checks failed", color: "red" },
  certified: { label: "Certified", color: "cyan" },
  released: { label: "Released", color: "green" },
};
const DEFERRED_STATUS = { pending: { label: "Pending", color: "yellow" }, released: { label: "Released", color: "green" }, forfeited: { label: "Forfeited", color: "red" } } as const;
const DAY = 86_400_000;

export function BonusStatement({ userId, probationary }: { userId: string; probationary: boolean }) {
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const deferredBonuses = useCrm((s) => s.deferredBonuses);
  const initiatives = useCrm((s) => s.initiatives);
  const outcomes = useCrm((s) => s.probationOutcomes);

  const { lines, deferred, myOutcomes } = useMemo(() => {
    const lines: { run: BonusRun; line: BonusLine }[] = [];
    for (const run of bonusRuns) if (run.status === "certified" || run.status === "released") for (const line of run.lines) if (line.userId === userId) lines.push({ run, line });
    lines.sort((a, b) => b.run.month.localeCompare(a.run.month) || a.line.initiativeId.localeCompare(b.line.initiativeId));
    return { lines, deferred: deferredBonuses.filter((d) => d.userId === userId).sort((a, b) => a.vestAt.localeCompare(b.vestAt)), myOutcomes: outcomes.filter((o) => o.userId === userId) };
  }, [bonusRuns, deferredBonuses, outcomes, userId]);
  const [selected, setSelected] = useState<string | null>(null);
  const key = (x: { run: BonusRun; line: BonusLine }) => `${x.run.id}|${x.line.initiativeId}`;
  const current = lines.find((x) => key(x) === selected) ?? lines[0];

  const label = (id: string) => {
    const i = initiatives.find((x) => x.id === id);
    return i ? (i.code ?? i.trackingNo) || i.title : id;
  };

  return (
    <Block
      title={
        <>
          Monthly bonus statements <Cite s="8.4" />
          {probationary ? <Cite s="11.3" /> : null}
        </>
      }
      action={<span className="text-2xs text-sg-dim">Annex E · issued on the salary date for each project</span>}
    >
      {lines.length ? (
        <>
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-[0.1em] text-sg-dim">
                  <th className="px-4 py-1.5 font-semibold">Salary date</th>
                  <th className="px-2 py-1.5 font-semibold">Project</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Share + top-up</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Paid</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Deferred / carried</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Held</th>
                  <th className="px-4 py-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((x) => {
                  const active = current && key(x) === key(current);
                  return (
                    <tr key={key(x)} onClick={() => setSelected(key(x))} className={cn("cursor-pointer border-b border-sg-line last:border-b-0 hover:bg-sg-card-2/60", active && "bg-sg-card-2")}>
                      <td className="px-4 py-1.5">
                        <div className="sg-num font-semibold text-sg-white">{formatDate(paymentDate(x.run.month), "medium")}</div>
                        <Chip color={RUN_STATUS[x.run.status].color} className="mt-0.5">
                          {RUN_STATUS[x.run.status].label}
                        </Chip>
                      </td>
                      <td className="px-2 py-1.5 font-semibold text-sg-text">{label(x.line.initiativeId)}</td>
                      <Num v={x.line.gross + x.line.topUp - x.line.topUpDeducted} />
                      <Num v={x.line.payable} tone="text-soft-green" />
                      <Num v={x.line.deferred + x.line.carriedOver} tone="text-soft-cyan" />
                      <Num v={x.line.withheld + x.line.held} tone="text-soft-yellow" />
                      <td className="px-4 py-1.5">
                        <Chip color={LINE_STATUS[x.line.status].color}>{LINE_STATUS[x.line.status].label}</Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {current ? <AnnexE run={current.run} line={current.line} /> : null}
        </>
      ) : (
        <p className="text-xs text-sg-dim">No statements yet — one is issued for each project once a monthly cycle with this employee&apos;s lines is certified.</p>
      )}

      {myOutcomes.length > 0 && (
        <div className="mt-3 space-y-1">
          {myOutcomes.map((o, i) => (
            <div key={i} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-xs", o.outcome === "forfeited" ? "bg-soft-red/10 text-soft-red" : "bg-soft-green/10 text-soft-green")}>
              {o.outcome === "completed" ? "Probation passed — Probation Completion Bonus payable within 30 days" : o.outcome === "paid_final_pay" ? "Probation ended — held balance paid with final pay" : "Held balance forfeited — dismissal for a serious violation"} · <Money value={o.amount} className="font-semibold" />
              <span className="ml-auto text-2xs text-sg-dim">{formatDate(o.decidedAt)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        <div className="sg-eyebrow mb-1.5 flex items-center">
          Deferred bonuses <Cite s="9.3" />
        </div>
        {deferred.length ? (
          <ul className="divide-y divide-sg-line rounded-md border border-sg-line">
            {deferred.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                <div className="min-w-0 flex-1">
                  <Link href={`/initiatives/${d.initiativeId}`} className="font-semibold text-sg-text hover:text-sg-white hover:underline">
                    {label(d.initiativeId)}
                  </Link>
                  <span className="text-sg-dim"> · from {d.month}</span>
                  <div className="truncate text-2xs text-sg-dim">{d.note}</div>
                </div>
                <div className="text-right">
                  <Money value={d.status === "released" ? d.releasedAmount : d.amount} className={cn("font-semibold", d.status === "forfeited" ? "text-soft-red line-through" : "text-sg-white")} />
                  <div className="text-2xs text-sg-dim">vests {formatDate(d.vestAt)}</div>
                </div>
                <Chip color={DEFERRED_STATUS[d.status].color}>{DEFERRED_STATUS[d.status].label}</Chip>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-sg-dim">No deferred bonuses.</p>
        )}
      </div>
    </Block>
  );
}

/** Annex E for one project and cycle. */
function AnnexE({ run, line }: { run: BonusRun; line: BonusLine }) {
  const users = useCrm((s) => s.users);
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const entries = useCrm((s) => s.revenueEntries);
  const profiles = useCrm((s) => s.employeeProfiles);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const deferredBonuses = useCrm((s) => s.deferredBonuses);
  const clawbacks = useCrm((s) => s.clawbacks);

  const user = users.find((u) => u.id === line.userId);
  const ini = initiatives.find((i) => i.id === line.initiativeId);
  const data = useMemo(() => {
    if (!ini) return null;
    const rate = projectRate(ini, adjustments);
    const pays = projectPayments(ini, entries, adjustments);
    const period = pays.filter((p) => p.month === run.month);
    const toDate = pays.filter((p) => p.month <= run.month);
    const sum = (list: typeof pays, k: "revenue" | "directCosts" | "tax" | "net" | "pool") => list.reduce((s, p) => s + p[k], 0);
    const periods = Array.from(new Set(period.map((p) => `${formatDate(p.workStart, "medium")} – ${formatDate(p.workEnd, "medium")}`)));
    const rows = members.filter((m) => m.initiativeId === ini.id && m.userId === line.userId && m.consent === "accepted" && (!period.length || period.some((p) => overlapDays(m.joinedAt, m.leftAt, p.workStart, p.workEnd) > 0)));
    const released = bonusRuns.filter((r) => r.status === "released" && r.month <= run.month);
    const paidOnProject = released.reduce((s, r) => s + r.lines.filter((l) => l.userId === line.userId && l.initiativeId === ini.id).reduce((a, l) => a + l.payable, 0), 0) + deferredBonuses.filter((d) => d.userId === line.userId && d.initiativeId === ini.id && d.status === "released").reduce((s, d) => s + d.releasedAmount, 0);
    const pendingDeferred = deferredBonuses.filter((d) => d.userId === line.userId && d.initiativeId === ini.id && d.status === "pending").reduce((s, d) => s + d.amount, 0);
    const heldProbation = bonusRuns.filter((r) => (r.status === "released" || r.status === "certified") && r.month <= run.month).reduce((s, r) => s + r.lines.filter((l) => l.userId === line.userId && l.initiativeId === ini.id).reduce((a, l) => a + l.withheld, 0), 0);
    const topUps = ini.type === "C" ? topUpBalance(line.userId, ini, { members, entries, profiles, adjustments }, run.month) : 0;
    const claw = clawbacks.filter((c) => c.userId === line.userId && c.initiativeId === ini.id && c.status !== "waived");
    return { rate, period, toDate, sum, periods, rows, paidOnProject, pendingDeferred, heldProbation, topUps, claw };
  }, [ini, adjustments, entries, run.month, members, line.userId, bonusRuns, deferredBonuses, profiles, clawbacks]);

  if (!ini || !data) return <p className="mt-3 text-xs text-sg-dim">The project for this statement no longer exists.</p>;
  const w = collectionWindow(run.month);
  const salary = paymentDate(run.month);
  const disputeBy = new Date(Date.parse(salary) + POLICY.statementDisputeDays * DAY).toISOString();
  const disputeOpen = Date.parse(disputeBy) >= Date.now();
  const passed = run.payoutPct >= 1 - 1e-9;
  const share = line.totalWeightDays > 0 ? line.weightDays / line.totalWeightDays : 0;
  const { sum } = data;

  return (
    <div className="mt-4 rounded-lg border border-sg-line-2 bg-sg-bg/40">
      <div className="flex flex-wrap items-start gap-3 border-b border-sg-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="sg-eyebrow">Annex E · monthly bonus statement</div>
          <div className="font-display text-base font-extrabold text-sg-white">
            {ini.title} <span className="sg-num text-sm text-sg-muted">{ini.code ?? ini.trackingNo}</span>
          </div>
          <div className="text-2xs text-sg-dim">
            {user?.name ?? line.userId} · employee no. {line.userId} {run.status !== "released" ? "· certified, awaiting PRC release" : ""}
          </div>
        </div>
        <TypeChip type={ini.type} />
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 text-xs sm:grid-cols-4">
        <Item label="Salary date" value={formatDate(salary, "medium")} />
        <Item label="Collection period" value={`${formatDate(w.from, "short")} – ${formatDate(w.to, "short")}`} />
        <Item label="Annual net revenue used for the rate, x" value={data.rate.source === "v3_flat" || data.rate.source === "provisional" ? "—" : formatIDR(data.rate.x, "full")} />
        <Item label="Revenue-share rate, y" value={`${(line.sharePct * 100).toFixed(3)}%`} sub={data.rate.source === "v3_flat" ? "v3.0 flat share kept (§15.1)" : data.rate.source === "provisional" ? "provisional" : data.rate.source === "fixed" ? "fixed by the PRC" : "from the curve"} />
      </dl>

      <div className="px-4 pb-3">
        <div className="sg-eyebrow mb-1">Project figures</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-2xs uppercase tracking-[0.1em] text-sg-dim">
              <th className="py-1 text-left font-semibold">Item</th>
              <th className="py-1 text-right font-semibold">This period</th>
              <th className="py-1 text-right font-semibold">Project to date</th>
            </tr>
          </thead>
          <tbody>
            <Pair label="Revenue collected, excl. VAT" a={sum(data.period, "revenue")} b={sum(data.toDate, "revenue")} />
            <Pair label="Direct costs" a={sum(data.period, "directCosts")} b={sum(data.toDate, "directCosts")} />
            <Pair label={`Estimated taxes (UMKM final tax ${POLICY.tax.umkmRate * 100}% of revenue, §5.4)`} a={sum(data.period, "tax")} b={sum(data.toDate, "tax")} />
            <Pair label="Net revenue" a={sum(data.period, "net")} b={sum(data.toDate, "net")} strong />
            <Pair label="Bonus pool (y × net revenue, after any shortfall recovered)" a={line.pool} b={sum(data.toDate, "pool")} strong />
          </tbody>
        </table>
      </div>

      <div className="border-t border-sg-line px-4 py-3">
        <div className="sg-eyebrow mb-1">Your share</div>
        <table className="w-full text-xs">
          <tbody>
            <Row label="Work period(s) the collected payments relate to">{data.periods.length ? data.periods.join("; ") : line.topUp > 0 ? "Type C top-up month" : "—"}</Row>
            <Row label="Your role(s), weight and allocation factor">
              {data.rows.length ? (
                <span className="flex flex-col items-end gap-0.5">
                  {data.rows.map((m) => (
                    <span key={m.id}>
                      {m.roles.map((r) => ROLE_META[r].label).join(" + ")} · W {memberWeight(m).toFixed(2)} × A {allocationFactorOf(m)} = {effectiveWeight(m).toFixed(2)}
                    </span>
                  ))}
                </span>
              ) : (
                `W×A ${line.weight.toFixed(2)}`
              )}
            </Row>
            <Row label="Your effective weight-days / team total">
              {line.weightDays.toFixed(2)} / {line.totalWeightDays.toFixed(2)} = {(share * 100).toFixed(2)}%
            </Row>
            <MoneyRow label="Your share of this period's pool" v={line.gross} />
            {ini.type === "C" ? <MoneyRow label="Type C top-up paid (+) / deducted from this bonus (−)" v={line.topUp - line.topUpDeducted} signed cite="8.6" /> : null}
            <Row label="Break-even test result and percentage released">
              <span className={passed ? "text-soft-green" : "text-soft-yellow"}>{passed ? "Passed · 100% released" : `Failed · ${(run.payoutPct * 100).toFixed(2)}% released (§9.2)`}</span>
            </Row>
            <MoneyRow label="Carried forward from earlier months, paid now" v={Math.max(0, Math.min(line.carriedIn, line.payable - line.guaranteed))} />
            <MoneyRow label="Carried forward to later months" v={line.carriedOver} />
            <MoneyRow label="Deferred (high-risk project)" v={line.deferred} cite="9.3" />
            <MoneyRow label="Held (probation)" v={line.withheld} cite="11.3" />
            {line.held > 0 ? <MoneyRow label="Held (Annex B, suspension, unpaid leave or PRC confirmation)" v={line.held} /> : null}
            {line.forfeited > 0 ? <MoneyRow label="Forfeited (§10)" v={-line.forfeited} signed /> : null}
            <Row label="Adjustments, recoveries or clawback">{data.claw.length ? data.claw.map((c) => `${c.status.replace(/_/g, " ")} · recovered ${formatIDR(c.recovered)}`).join("; ") : "None"}</Row>
            <tr className="border-t border-sg-line-2">
              <td className="py-1.5 font-semibold text-sg-white">Gross bonus paid this salary</td>
              <td className="sg-num py-1.5 text-right font-display text-sm font-extrabold text-soft-green">{formatIDR(line.payable, "full")}</td>
            </tr>
            <Row label="PPh 21 withheld / net bonus paid">Calculated by payroll with the salary (§8.5)</Row>
          </tbody>
        </table>
        {line.notes.length ? <p className="mt-1.5 text-2xs text-sg-dim">{line.notes.join(" · ")}</p> : null}
      </div>

      <div className="border-t border-sg-line px-4 py-3">
        <div className="sg-eyebrow mb-1">Balances to date</div>
        <table className="w-full text-xs">
          <tbody>
            <MoneyRow label="Total paid on this project" v={data.paidOnProject} />
            <MoneyRow label="Deferred, not yet due" v={data.pendingDeferred} />
            <MoneyRow label="Carried forward, not yet paid" v={line.carriedOver} />
            <MoneyRow label="Held during probation" v={data.heldProbation} />
            {ini.type === "C" ? <MoneyRow label="Type C top-ups still to be deducted from later bonuses" v={data.topUps} /> : null}
          </tbody>
        </table>
      </div>

      <p className={cn("border-t border-sg-line px-4 py-2 text-2xs", disputeOpen ? "text-soft-yellow" : "text-sg-dim")}>
        Queries and corrections must be raised with Finance within {POLICY.statementDisputeDays} days of the statement date — by {formatDate(disputeBy, "medium")}
        {disputeOpen ? "" : " (window closed)"} (§14).
      </p>
    </div>
  );
}

function Item({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-2xs text-sg-dim">{label}</dt>
      <dd className="sg-num font-semibold text-sg-white">{value}</dd>
      {sub ? <dd className="text-2xs text-sg-dim">{sub}</dd> : null}
    </div>
  );
}

function Pair({ label, a, b, strong }: { label: string; a: number; b: number; strong?: boolean }) {
  return (
    <tr className="border-t border-sg-line">
      <td className={cn("py-1", strong ? "font-semibold text-sg-white" : "text-sg-muted")}>{label}</td>
      <td className={cn("sg-num py-1 text-right", strong ? "font-semibold text-sg-white" : "text-sg-text")}>{formatIDR(a, "full")}</td>
      <td className={cn("sg-num py-1 text-right", strong ? "font-semibold text-sg-white" : "text-sg-text")}>{formatIDR(b, "full")}</td>
    </tr>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-t border-sg-line align-top">
      <td className="py-1 pr-3 text-sg-muted">{label}</td>
      <td className="py-1 text-right text-sg-text">{children}</td>
    </tr>
  );
}

function MoneyRow({ label, v, signed, cite }: { label: string; v: number; signed?: boolean; cite?: string }) {
  return (
    <tr className="border-t border-sg-line">
      <td className="py-1 pr-3 text-sg-muted">
        {label}
        {cite ? <Cite s={cite} /> : null}
      </td>
      <td className={cn("sg-num py-1 text-right", v ? "text-sg-text" : "text-sg-dim")}>{v ? `${signed && v > 0 ? "+" : ""}${formatIDR(v, "full")}` : "—"}</td>
    </tr>
  );
}

function Num({ v, tone }: { v: number; tone?: string }) {
  return <td className="px-2 py-1.5 text-right">{v > 0.5 ? <Money value={v} className={tone ?? "font-semibold text-sg-white"} /> : <span className="text-sg-dim">—</span>}</td>;
}

export function Memberships({ userId }: { userId: string }) {
  const members = useCrm((s) => s.initiativeMembers);
  const initiatives = useCrm((s) => s.initiatives);
  const rows = useMemo(
    () =>
      members
        .filter((m) => m.userId === userId)
        .map((m) => ({ m, ini: initiatives.find((i) => i.id === m.initiativeId) }))
        .filter((x) => x.ini)
        .sort((a, b) => Number(isLiveMember(b.m)) - Number(isLiveMember(a.m)) || b.m.joinedAt.localeCompare(a.m.joinedAt)),
    [members, initiatives, userId],
  );
  return (
    <Block
      title={
        <>
          Team Allocation Ledger rows <Cite s="6.5" />
        </>
      }
    >
      {rows.length ? (
        <ul className="space-y-1.5">
          {rows.map(({ m, ini }) => {
            const live = isLiveMember(m);
            return (
              <li key={m.id} className={cn("rounded-md border border-sg-line bg-sg-bg/40 p-2.5", !live && "opacity-60")}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <Link href={`/initiatives/${ini!.id}`} className="text-sm font-semibold text-sg-white hover:underline">
                      <span className="mr-1.5 text-sg-muted">{ini!.code ?? ini!.trackingNo}</span>
                      {ini!.title}
                    </Link>
                    {ini!.demo ? (
                      <Chip color="blue" className="ml-1.5">
                        Sample
                      </Chip>
                    ) : null}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <RoleChips roles={m.roles} />
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusChip status={ini!.status} />
                    <TypeChip type={ini!.type} />
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-sg-dim">
                  <span>
                    W <span className="sg-num font-semibold text-sg-text">{memberWeight(m).toFixed(2)}</span>
                    {m.weightOverride != null ? " (agreed non-standard)" : ""} × A <span className="sg-num font-semibold text-sg-text">{allocationFactorOf(m)}</span> = <span className="sg-num font-semibold text-sg-text">{effectiveWeight(m).toFixed(2)}</span>
                  </span>
                  <span className={cn(m.consent === "accepted" ? "text-soft-green" : m.consent === "declined" ? "text-soft-red" : "text-soft-yellow")}>{m.consent === "accepted" ? "Role and Weight Agreement signed" : `Agreement ${m.consent}`}</span>
                  <span className={m.managerApproved ? "text-soft-green" : "text-soft-yellow"}>{m.managerApproved ? "Line manager agreed" : "Line manager pending"}</span>
                  <span className={m.prcApproved ? "text-soft-green" : "text-soft-yellow"}>{m.prcApproved ? "PRC checked" : "Awaiting PRC"}</span>
                  {m.removal.stage !== "none" && <span className="text-soft-red">Removal: {m.removal.stage}</span>}
                  {m.authority ? <span>{m.authority}</span> : null}
                  <span className="ml-auto">
                    {formatDate(m.joinedAt)} → {m.leftAt ? formatDate(m.leftAt) : "open"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-sg-dim">Not on any project&apos;s Team Allocation Ledger.</p>
      )}
    </Block>
  );
}
