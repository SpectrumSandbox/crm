"use client";

/*
 * Changes in employment status (Policy v4.0 §10) with an impact preview before anything is recorded.
 * The preview runs the real compensation engine twice for the current salary cycle (before / after the change),
 * so it shows exactly what the monthly cycle will do; deferred, carried-forward and probation balances follow §10 / §11.4.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Ban, CircleCheck, Clock, Gavel, Hourglass, Info, ShieldAlert, TriangleAlert, Undo2, UserMinus, UserX } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import type { EmployeeProfile, SeparationKind } from "@/lib/initiatives/types";
import { addMonths, carriedForward, computeRun, cycleMonth, paymentDate, probationBalance } from "@/lib/initiatives/engine";
import { POLICY } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR, fromDateInput, toDateInput } from "@/lib/utils";
import { Modal } from "@/components/ui/overlays";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Cite, Money } from "@/components/initiatives/shared";
import { Block, Toggle } from "./fields";
import { SEPARATION_LABEL } from "./data";

type Event = SeparationKind | "suspension" | "unpaid_leave";

/** §10 table: what is paid and what is forfeited. */
export const SECTION_10: Record<Event, { title: string; paid: string; forfeited: string }> = {
  resignation: {
    title: "Resignation (incl. mutual agreement unless the separation agreement says otherwise)",
    paid: "Bonuses on revenue collected up to the last working day, including carried-forward amounts, on the normal salary date or with final pay. Deferred bonuses for work before the last working day, at their normal time if the usual conditions are met.",
    forfeited: "Bonuses on revenue collected after the last working day.",
  },
  termination_for_cause: { title: "Dismissal for a serious violation (after the procedure required by law)", paid: "Nothing further.", forfeited: "All unpaid amounts. Clawback (§9.4) may also apply." },
  termination_without_cause: {
    title: "Termination on other grounds (redundancy, restructuring, efficiency, closure, other PP 35/2021 grounds)",
    paid: "Bonuses on revenue collected up to the termination date. Deferred bonuses for work before that date, at their normal time. Later collections for work periods before that date, as they arrive, for up to 12 months.",
    forfeited: "Bonuses for work after the termination date.",
  },
  contract_end: { title: "End of a fixed-term (PKWT) contract", paid: "As for termination on other grounds.", forfeited: "Bonuses for work after the contract end date." },
  retirement: { title: "Retirement", paid: "As for termination on other grounds. Requires PRC confirmation.", forfeited: "Bonuses for work after the retirement date." },
  death_disability: {
    title: "Death or permanent disability",
    paid: "All bonuses for work periods before the event. Deferred bonuses vest at once. Later collections for that work as they arrive, for up to 12 months. Paid to the employee or heirs within 60 days of receiving the required documents.",
    forfeited: "Nothing.",
  },
  ineligible_status: { title: "Move to an ineligible status (e.g. secondment out of the company)", paid: "Bonuses for work periods before the change, on the normal schedule.", forfeited: "Further participation." },
  probation_failed: { title: "Employment ends during probation", paid: "The held balance with final pay, less income tax (§11.4). Collections after the last working day follow the resignation rules.", forfeited: "Only on dismissal for a serious violation." },
  suspension: { title: "Disciplinary suspension", paid: "Payments falling due during suspension are held, and paid if the employee is cleared.", forfeited: "Held payments, if a serious violation is confirmed under the Company Regulations." },
  unpaid_leave: { title: "Unpaid leave over 30 days", paid: "Bonuses for earlier work are held and paid on return. If the employee does not return, the resignation rules apply.", forfeited: "Participation during the leave." },
};

type Kind = SeparationKind;
const ACTIONS: { kind: Kind; icon: React.ComponentType<{ className?: string }>; tone: string }[] = [
  { kind: "resignation", icon: UserMinus, tone: "text-soft-orange" },
  { kind: "termination_for_cause", icon: Ban, tone: "text-soft-red" },
  { kind: "termination_without_cause", icon: UserX, tone: "text-soft-orange" },
  { kind: "contract_end", icon: UserX, tone: "text-soft-orange" },
  { kind: "retirement", icon: Hourglass, tone: "text-soft-orange" },
  { kind: "death_disability", icon: ShieldAlert, tone: "text-soft-blue" },
  { kind: "ineligible_status", icon: UserMinus, tone: "text-soft-yellow" },
  { kind: "probation_failed", icon: UserX, tone: "text-soft-orange" },
];
/** later collections for earlier work are paid for up to 12 months */
const TRAIL: Kind[] = ["termination_without_cause", "contract_end", "retirement", "death_disability"];

const DAY = 86_400_000;
const today = () => toDateInput(new Date().toISOString());
const plusDays = (n: number) => toDateInput(new Date(Date.now() + n * DAY).toISOString());

export function SeparationSection({ profile, readOnly }: { profile: EmployeeProfile; readOnly?: boolean }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [hold, setHold] = useState<"suspension" | "unpaid_leave" | null>(null);
  const [follow, setFollow] = useState<"withdraw" | "confirm" | null>(null);
  const access = useAccess();
  const sep = profile.separation;
  const actions = ACTIONS.filter((a) => (a.kind === "contract_end" ? profile.employmentType === "fixed_term_contract" : a.kind === "probation_failed" ? profile.employmentType === "probationary" : true));
  return (
    <Block
      title={
        <>
          Change in employment status <Cite s="10" />
        </>
      }
      action={<span className="text-2xs text-sg-dim">Exit letters state the amounts paid and forfeited</span>}
    >
      {sep && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-soft-orange/40 bg-soft-orange/10 p-2.5 text-xs text-soft-orange">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <span className="font-semibold">{SEPARATION_LABEL[sep.kind]}</span> effective {formatDate(sep.effectiveAt)} · recorded {formatDate(sep.recordedAt)}
            {sep.retirementNoticeDays != null ? ` · ${sep.retirementNoticeDays} days notice` : ""}
            {sep.kind === "retirement" ? (sep.prcConfirmed ? " · PRC confirmed" : " · awaiting PRC confirmation — payments held") : ""}
            {profile.resignationNoticeAt ? ` · resignation notice ${formatDate(profile.resignationNoticeAt)}` : ""}
            {profile.terminationNoticeAt ? ` · termination notice ${formatDate(profile.terminationNoticeAt)}` : ""}
            <div className="mt-0.5 text-sg-muted">Recording another change replaces this record.</div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {!readOnly && access.manageHr ? (
                <Button size="xs" variant="outline" onClick={() => setFollow("withdraw")} title="e.g. a resignation rescinded with the company's agreement — reopens the ledger rows it closed">
                  <Undo2 /> Withdraw this change
                </Button>
              ) : null}
              {sep.kind === "retirement" && !sep.prcConfirmed ? (
                access.prc ? (
                  <Button size="xs" variant="primary" onClick={() => setFollow("confirm")}>
                    <Gavel /> PRC confirms the retirement
                  </Button>
                ) : (
                  <span className="text-2xs text-sg-muted">A PRC member records the confirmation (§10).</span>
                )
              ) : null}
            </div>
          </div>
        </div>
      )}
      {follow && sep ? <FollowUpDialog profile={profile} kind={follow} onClose={() => setFollow(null)} /> : null}
      {readOnly ? <p className="text-2xs text-sg-dim">HR records changes in employment status (§13.2).</p> : null}
      {!readOnly ? (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {actions.map((a) => (
          <button key={a.kind} type="button" onClick={() => setKind(a.kind)} className="flex items-start gap-2.5 rounded-md border border-sg-line bg-sg-bg/40 p-2.5 text-left transition-colors hover:border-sg-line-2 hover:bg-sg-card-2">
            <a.icon className={cn("mt-0.5 size-4 shrink-0", a.tone)} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-sg-white">{SEPARATION_LABEL[a.kind]}</span>
              <span className="block text-2xs text-sg-dim">Forfeited: {SECTION_10[a.kind].forfeited}</span>
            </span>
          </button>
        ))}
        <button type="button" onClick={() => setHold("suspension")} className="flex items-start gap-2.5 rounded-md border border-sg-line bg-sg-bg/40 p-2.5 text-left transition-colors hover:border-sg-line-2 hover:bg-sg-card-2">
          <Clock className="mt-0.5 size-4 shrink-0 text-soft-yellow" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-sg-white">{profile.suspended ? "Lift suspension" : "Disciplinary suspension"}</span>
            <span className="block text-2xs text-sg-dim">Payments falling due are held (§10)</span>
          </span>
        </button>
        <button type="button" onClick={() => setHold("unpaid_leave")} className="flex items-start gap-2.5 rounded-md border border-sg-line bg-sg-bg/40 p-2.5 text-left transition-colors hover:border-sg-line-2 hover:bg-sg-card-2">
          <Hourglass className="mt-0.5 size-4 shrink-0 text-soft-yellow" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-sg-white">Unpaid leave over {POLICY.unpaidLeaveMaxDays} days</span>
            <span className="block text-2xs text-sg-dim">Earlier bonuses held, paid on return · currently {profile.unpaidLeaveDays} day{profile.unpaidLeaveDays === 1 ? "" : "s"}</span>
          </span>
        </button>
      </div>
      ) : null}
      <details className="mt-3 rounded-md border border-sg-line bg-sg-bg/40">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-sg-muted hover:text-sg-white">What is paid and forfeited — the §10 table</summary>
        <table className="w-full text-2xs">
          <thead>
            <tr className="border-y border-sg-line text-left uppercase tracking-[0.1em] text-sg-dim">
              <th className="px-3 py-1.5 font-semibold">Event</th>
              <th className="px-3 py-1.5 font-semibold">What is paid</th>
              <th className="px-3 py-1.5 font-semibold">What is forfeited</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(SECTION_10) as Event[]).filter((e) => e !== "probation_failed").map((e) => (
              <tr key={e} className="border-b border-sg-line align-top last:border-b-0">
                <td className="px-3 py-1.5 font-semibold text-sg-text">{SECTION_10[e].title}</td>
                <td className="px-3 py-1.5 text-sg-muted">{SECTION_10[e].paid}</td>
                <td className="px-3 py-1.5 text-sg-muted">{SECTION_10[e].forfeited}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-sg-line px-3 py-1.5 text-2xs text-sg-dim">Statutory paid leave does not affect payment (§3.3). Forfeited amounts return to the company; they are not redistributed.</p>
      </details>
      {kind && <SeparationDialog key={kind} profile={profile} kind={kind} onClose={() => setKind(null)} />}
      {hold && <HoldDialog profile={profile} kind={hold} onClose={() => setHold(null)} />}
    </Block>
  );
}

function RuleBox({ event }: { event: Event }) {
  const r = SECTION_10[event];
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-sg-line bg-sg-line text-xs sm:grid-cols-2">
      <div className="bg-sg-card px-3 py-2">
        <div className="sg-eyebrow mb-0.5 text-soft-green">What is paid</div>
        <div className="text-sg-text">{r.paid}</div>
      </div>
      <div className="bg-sg-card px-3 py-2">
        <div className="sg-eyebrow mb-0.5 text-soft-red">What is forfeited</div>
        <div className="text-sg-text">{r.forfeited}</div>
      </div>
    </div>
  );
}

interface ImpactRow {
  label: React.ReactNode;
  sub: string;
  amount: number;
  outcome: "forfeit" | "pay" | "vest" | "hold" | "keep";
  reason: string;
}

function SeparationDialog({ profile, kind, onClose }: { profile: EmployeeProfile; kind: Kind; onClose: () => void }) {
  const recordSeparation = useCrm((s) => s.recordSeparation);
  const users = useCrm((s) => s.users);
  const currentUserId = useCrm((s) => s.currentUserId);
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const entries = useCrm((s) => s.revenueEntries);
  const profiles = useCrm((s) => s.employeeProfiles);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const deferredBonuses = useCrm((s) => s.deferredBonuses);
  const outcomes = useCrm((s) => s.probationOutcomes);
  const notify = useUi((s) => s.notify);
  const access = useAccess();
  const me = users.find((u) => u.id === currentUserId);
  const employee = users.find((u) => u.id === profile.userId);

  const usesNotice = kind === "resignation" || kind === "retirement" || kind === "termination_without_cause";
  const [noticeDate, setNoticeDate] = useState(today());
  const [effectiveDate, setEffectiveDate] = useState(kind === "resignation" ? plusDays(30) : kind === "retirement" ? plusDays(90) : kind === "contract_end" && profile.contractEndDate ? toDateInput(profile.contractEndDate) : today());
  const [prcConfirmed, setPrcConfirmed] = useState(false);

  const effectiveAt = effectiveDate ? fromDateInput(effectiveDate) : "";
  const noticeAt = noticeDate ? fromDateInput(noticeDate) : "";
  const noticeDays = effectiveAt && noticeAt ? Math.max(0, Math.round((Date.parse(effectiveAt) - Date.parse(noticeAt)) / DAY)) : 0;
  const valid = !!effectiveAt && (!usesNotice || (!!noticeAt && Date.parse(noticeAt) <= Date.parse(effectiveAt)));

  const impact = useMemo(() => {
    const month = cycleMonth(new Date().toISOString());
    const userId = profile.userId;
    const nowIso = new Date().toISOString();
    const hypothetical: EmployeeProfile = {
      ...profile,
      resignationNoticeAt: kind === "resignation" ? noticeAt || nowIso : profile.resignationNoticeAt,
      terminationNoticeAt: kind.startsWith("termination") ? noticeAt || effectiveAt || nowIso : profile.terminationNoticeAt,
      separation: effectiveAt ? { kind, effectiveAt, recordedAt: nowIso, retirementNoticeDays: kind === "retirement" ? noticeDays : undefined, prcConfirmed: kind === "retirement" ? prcConfirmed : undefined } : profile.separation,
    };
    // project lines only: company checks set to pass so the preview isolates the §10 effect
    const base = { month, initiatives, members, entries, adjustments, companyRevenue: 1e15, directCosts: 0, overheads: 0, cash: 1e15, fixedCostsMonthly: 0 };
    const before = computeRun({ ...base, profiles }).lines.filter((l) => l.userId === userId);
    const after = computeRun({ ...base, profiles: profiles.map((p) => (p.userId === userId ? hypothetical : p)) }).lines.filter((l) => l.userId === userId);
    const title = (id: string) => {
      const i = initiatives.find((x) => x.id === id);
      return i ? `${i.code ?? i.trackingNo} · ${i.title}` : id;
    };
    const link = (id: string) => (
      <Link href={`/initiatives/${id}`} className="hover:underline" onClick={onClose}>
        {title(id)}
      </Link>
    );

    const rows: ImpactRow[] = [];
    for (const b of before) {
      const a = after.find((l) => l.initiativeId === b.initiativeId);
      if (!a) continue;
      const total = b.gross + b.topUp - b.topUpDeducted;
      const outcome: ImpactRow["outcome"] = a.forfeited > 0 && a.payable + a.held + a.withheld + a.deferred === 0 ? "forfeit" : a.held > 0 && a.payable === 0 ? "hold" : "pay";
      rows.push({ label: link(b.initiativeId), sub: `${month} cycle · salary ${formatDate(paymentDate(month))}`, amount: total, outcome, reason: a.notes.find((n) => n.includes("§10") || n.includes("§11")) ?? (outcome === "pay" ? "Collected before the end date — paid on schedule" : a.notes[a.notes.length - 1] ?? "") });
    }
    for (const d of deferredBonuses.filter((x) => x.userId === userId && x.status === "pending")) {
      const outcome: ImpactRow["outcome"] = kind === "termination_for_cause" ? "forfeit" : kind === "death_disability" ? "vest" : "keep";
      rows.push({
        label: link(d.initiativeId),
        sub: `Deferred from ${d.month} · vests ${formatDate(d.vestAt)}`,
        amount: d.amount,
        outcome,
        reason: outcome === "forfeit" ? "All unpaid amounts are forfeited" : outcome === "vest" ? "Vests at once — paid within 60 days of the required documents" : "Work before the end date — paid at its normal time if the usual conditions are met",
      });
    }
    for (const c of carriedForward(bonusRuns, "9999-12").filter((x) => x.userId === userId)) {
      rows.push({ label: link(c.initiativeId), sub: "Carried forward after a failed check (§9.2)", amount: c.amount, outcome: kind === "termination_for_cause" ? "forfeit" : "pay", reason: kind === "termination_for_cause" ? "All unpaid amounts are forfeited" : "Collected before the end date — paid first in the next passing month" });
    }
    const settled = outcomes.some((o) => o.userId === userId);
    const probation = probationBalance(userId, bonusRuns);
    if (profile.employmentType === "probationary" && probation > 0 && !settled) {
      rows.push({
        label: "Probationary Bonus Accrual",
        sub: `Held since hire · probation ends ${formatDate(profile.probationEndDate)}`,
        amount: probation,
        outcome: kind === "termination_for_cause" ? "forfeit" : "pay",
        reason: kind === "termination_for_cause" ? "Dismissal for a serious violation forfeits the held balance (§11.4)" : "Earned for work already done — paid with final pay, less PPh 21 (§11.4)",
      });
    }
    const unreleased = bonusRuns.filter((r) => r.status !== "released" && r.month !== month && r.lines.some((l) => l.userId === userId && (l.payable > 0 || l.withheld > 0)));
    const total = (o: ImpactRow["outcome"]) => rows.filter((r) => r.outcome === o).reduce((s, r) => s + r.amount, 0);
    return { month, rows, unreleased, forfeit: total("forfeit"), pay: total("pay") + total("vest"), hold: total("hold"), keep: total("keep") };
  }, [profile, kind, noticeAt, effectiveAt, noticeDays, prcConfirmed, initiatives, members, entries, adjustments, profiles, bonusRuns, deferredBonuses, outcomes, onClose]);

  const confirm = () => {
    if (!valid) return;
    recordSeparation(profile.userId, kind, effectiveAt, {
      noticeAt: usesNotice ? noticeAt : kind === "termination_for_cause" ? effectiveAt : undefined,
      retirementNoticeDays: kind === "retirement" ? noticeDays : undefined,
      prcConfirmed: kind === "retirement" ? prcConfirmed && access.prc : undefined,
    });
    notify(`${SEPARATION_LABEL[kind]} recorded for ${employee?.name ?? "employee"}${impact.forfeit > 0 ? ` — ${formatIDR(impact.forfeit)} forfeited` : ""}`);
    onClose();
  };

  const effLabel = kind === "resignation" ? "Last working day" : kind === "retirement" ? "Retirement date" : kind === "death_disability" ? "Date of the event" : kind === "contract_end" ? "Contract end date" : kind === "ineligible_status" ? "Date of the change" : kind === "probation_failed" ? "Last working day" : "Termination date";

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${SEPARATION_LABEL[kind]} — ${employee?.name ?? ""}`}
      description={`Recorded by ${me?.name ?? "you"} on behalf of HR · review the §10 impact before confirming`}
      className="w-[min(720px,calc(100vw-32px))]"
      footer={
        <>
          <span className="mr-auto text-2xs text-sg-dim">Cannot be undone from the register · ⌘/Ctrl+Enter</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={impact.forfeit > 0 ? "danger" : "primary"} disabled={!valid} onClick={confirm}>
            <Gavel /> Confirm
          </Button>
        </>
      }
    >
      <div
        className="space-y-4"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            confirm();
          }
        }}
      >
        <div>
          <div className="mb-1 text-xs font-semibold text-sg-white">{SECTION_10[kind].title}</div>
          <RuleBox event={kind} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {usesNotice && (
            <Field label={kind === "resignation" ? "Resignation notice given" : kind === "retirement" ? "Retirement notice given" : "Notice of termination"} hint="Stops new project roles; bonuses already earned are still paid (§3.1)">
              <Input type="date" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} />
            </Field>
          )}
          <Field label={effLabel}>
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </Field>
        </div>
        {kind === "retirement" && (
          <Toggle checked={prcConfirmed} disabled={!access.prc} onChange={setPrcConfirmed} label="PRC confirms the retirement" hint={!access.prc ? "Payments are held until a PRC member confirms it on the record — it can be confirmed later (§10)" : prcConfirmed ? `Recorded by ${me?.name ?? "you"} for the PRC · ${noticeDays} days' notice` : "Until confirmed, payments are held (§10); it can also be confirmed later"} />
        )}
        {TRAIL.includes(kind) && effectiveAt ? (
          <p className="flex items-start gap-1.5 text-2xs text-sg-muted">
            <Info className="mt-0.5 size-3 shrink-0" /> Later collections for work periods before {formatDate(effectiveAt, "medium")} are paid as they arrive until {formatDate(addMonths(effectiveAt, POLICY.separationTrailMonths), "medium")}.
            {kind === "death_disability" ? ` Paid to the employee or heirs within ${POLICY.deathPayoutDays} days of receiving the required documents.` : ""}
          </p>
        ) : null}
        {usesNotice && noticeAt && effectiveAt && Date.parse(noticeAt) > Date.parse(effectiveAt) && <p className="text-2xs text-soft-red">The notice date must be on or before the effective date.</p>}

        <div className="rounded-lg border border-sg-line">
          <div className="flex items-center gap-2 border-b border-sg-line px-3 py-2">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-sg-white">Impact preview</span>
            <span className="text-2xs text-sg-dim">{impact.month} cycle · deferred · carried forward · probation</span>
          </div>
          {impact.rows.length ? (
            <ul className="divide-y divide-sg-line">
              {impact.rows.map((r, i) => (
                <li key={i} className="flex items-start gap-3 px-3 py-2">
                  <OutcomeIcon outcome={r.outcome} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-sg-white">{r.label}</div>
                    <div className="text-2xs text-sg-dim">{r.sub}</div>
                    {r.reason && <div className={cn("text-2xs", r.outcome === "forfeit" ? "text-soft-red" : r.outcome === "hold" ? "text-soft-yellow" : "text-sg-muted")}>{r.reason}</div>}
                  </div>
                  <div className="text-right">
                    <Money value={r.amount} className={cn("text-sm font-semibold", r.outcome === "forfeit" ? "text-soft-red line-through decoration-soft-red/60" : "text-sg-white")} />
                    <div className={cn("text-2xs font-semibold uppercase tracking-wider", outcomeTone[r.outcome])}>{outcomeLabel[r.outcome]}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-1.5 px-3 py-4 text-xs text-sg-muted">
              <Info className="size-3.5" /> Nothing unpaid: no collections this cycle on this employee&apos;s projects, no deferred or carried-forward amounts and no probation balance.
            </p>
          )}
          <div className="grid grid-cols-4 border-t border-sg-line text-center">
            <Total label="Forfeited" value={impact.forfeit} tone="text-soft-red" />
            <Total label="Paid / vests" value={impact.pay} tone="text-soft-green" />
            <Total label="Held" value={impact.hold} tone="text-soft-yellow" />
            <Total label="Normal time" value={impact.keep} tone="text-sg-muted" />
          </div>
        </div>
        {impact.unreleased.length > 0 && (
          <p className="flex items-start gap-1.5 text-2xs text-soft-yellow">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" />
            {impact.unreleased.map((r) => r.month).join(", ")} {impact.unreleased.length > 1 ? "cycles are" : "cycle is"} not yet released and include{impact.unreleased.length > 1 ? "" : "s"} lines for this employee — recalculate before release so the §10 outcome applies.
          </p>
        )}
        <p className="text-2xs text-sg-dim">Forfeited amounts return to the company and are never redistributed. The PRC may approve exceptions in writing in genuinely exceptional cases; the CEO has a veto.</p>
      </div>
    </Modal>
  );
}

function HoldDialog({ profile, kind, onClose }: { profile: EmployeeProfile; kind: "suspension" | "unpaid_leave"; onClose: () => void }) {
  const updateProfile = useCrm((s) => s.updateProfile);
  const notify = useUi((s) => s.notify);
  const [days, setDays] = useState(String(Math.max(profile.unpaidLeaveDays, POLICY.unpaidLeaveMaxDays + 1)));
  const lifting = kind === "suspension" && profile.suspended;
  const submit = () => {
    if (kind === "suspension") {
      updateProfile(profile.userId, { suspended: !profile.suspended });
      notify(lifting ? "Suspension lifted — held payments are paid" : "Suspension recorded — payments falling due are held");
    } else {
      const n = Math.max(0, Math.round(Number(days) || 0));
      updateProfile(profile.userId, { unpaidLeaveDays: n });
      notify(n > POLICY.unpaidLeaveMaxDays ? `Unpaid leave ${n} days — earlier bonuses held until return` : `Unpaid leave ${n} days recorded`);
    }
    onClose();
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={kind === "suspension" ? (lifting ? "Lift disciplinary suspension" : "Record disciplinary suspension") : "Record unpaid leave"}
      description={SECTION_10[kind].title}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={submit}>
            {kind === "suspension" ? (lifting ? "Lift suspension (cleared)" : "Record suspension") : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <RuleBox event={kind} />
        {kind === "unpaid_leave" ? (
          <Field label="Consecutive unpaid leave (days)" hint={`Over ${POLICY.unpaidLeaveMaxDays} days: no participation and payments for earlier work are held; set back to 0 on return to release them`}>
            <Input type="number" min={0} value={days} onChange={(e) => setDays(e.target.value)} className="sg-num w-32" autoFocus />
          </Field>
        ) : lifting ? (
          <p className="text-xs text-sg-muted">Lifting the suspension because the employee was cleared releases the held payments in the next cycle. If a serious violation is confirmed instead, record a dismissal for a serious violation.</p>
        ) : null}
        <p className="text-2xs text-sg-dim">Statutory paid leave (annual, sick, maternity, paternity) never affects eligibility or payment (§3.3).</p>
      </div>
    </Modal>
  );
}

/** §10 follow-ups on a recorded separation: withdraw it (audited, ledger rows reopened) or record the PRC's retirement confirmation. */
function FollowUpDialog({ profile, kind, onClose }: { profile: EmployeeProfile; kind: "withdraw" | "confirm"; onClose: () => void }) {
  const withdrawSeparation = useCrm((s) => s.withdrawSeparation);
  const confirmRetirement = useCrm((s) => s.confirmRetirement);
  const users = useCrm((s) => s.users);
  const notify = useUi((s) => s.notify);
  const [text, setText] = useState("");
  const sep = profile.separation;
  const name = users.find((u) => u.id === profile.userId)?.name ?? "employee";
  if (!sep) return null;
  const valid = text.trim().length >= 5;
  const submit = () => {
    if (!valid) return;
    const ok = kind === "withdraw" ? withdrawSeparation(profile.userId, text) : confirmRetirement(profile.userId, text);
    notify(ok ? (kind === "withdraw" ? `${SEPARATION_LABEL[sep.kind]} withdrawn for ${name} — ledger rows reopened` : `Retirement confirmed by the PRC — ${name}'s held payments are paid in the next cycle`) : "Not recorded — check your role");
    onClose();
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={kind === "withdraw" ? `Withdraw: ${SEPARATION_LABEL[sep.kind]}` : "PRC confirms the retirement"}
      description={`${name} · effective ${formatDate(sep.effectiveAt, "medium")} · recorded ${formatDate(sep.recordedAt, "medium")}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!valid} onClick={submit}>
            {kind === "withdraw" ? "Withdraw change" : "Record PRC confirmation"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {kind === "withdraw" ? (
          <p className="text-xs text-sg-muted">The record is cleared and the Team Allocation Ledger rows it closed on {formatDate(sep.effectiveAt, "medium")} are reopened; a probation balance settled with it is restored. Amounts already released are not affected. The withdrawal is kept in the audit log (§13.3).</p>
        ) : (
          <p className="text-xs text-sg-muted">Retirement bonuses follow the rules for termination on other grounds once the PRC confirms (§10): held payments become payable with the next salary, and later collections for earlier work are paid for up to 12 months.</p>
        )}
        <Field label={kind === "withdraw" ? "Reason and evidence" : "PRC decision reference"}>
          <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && submit()} placeholder={kind === "withdraw" ? "e.g. resignation rescinded on 12 Nov with the line manager's and HR's agreement" : "e.g. PRC minute 2026-11-26 item 2"} className="min-h-[64px]" />
        </Field>
      </div>
    </Modal>
  );
}

const outcomeLabel: Record<ImpactRow["outcome"], string> = { forfeit: "Forfeited", pay: "Paid", vest: "Vests now", hold: "Held", keep: "Normal time" };
const outcomeTone: Record<ImpactRow["outcome"], string> = { forfeit: "text-soft-red", pay: "text-soft-green", vest: "text-soft-green", hold: "text-soft-yellow", keep: "text-sg-dim" };

function OutcomeIcon({ outcome }: { outcome: ImpactRow["outcome"] }) {
  if (outcome === "forfeit") return <Ban className="mt-0.5 size-3.5 shrink-0 text-soft-red" />;
  if (outcome === "hold") return <Hourglass className="mt-0.5 size-3.5 shrink-0 text-soft-yellow" />;
  if (outcome === "keep") return <Info className="mt-0.5 size-3.5 shrink-0 text-sg-dim" />;
  return <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-soft-green" />;
}

function Total({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="border-r border-sg-line px-2 py-2 last:border-r-0">
      <div className="sg-eyebrow">{label}</div>
      <Money value={value} className={cn("font-display text-sm font-extrabold", tone)} />
    </div>
  );
}
