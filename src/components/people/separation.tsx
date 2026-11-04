"use client";

/*
 * "Record employment change" — §4.5 separation rules with an impact preview before anything is recorded.
 * The preview runs the real compensation engine twice for the current month (before / after the change)
 * so what it shows is exactly what the monthly run will do.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Ban, CircleCheck, Gavel, Hourglass, Info, ShieldAlert, TriangleAlert, UserMinus, UserX } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { BonusLine, EmployeeProfile, SeparationKind } from "@/lib/initiatives/types";
import { computeRun, monthKey, paidInYear, paymentDate, probationBalance } from "@/lib/initiatives/engine";
import { POLICY } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR, fromDateInput, toDateInput } from "@/lib/utils";
import { Modal } from "@/components/ui/overlays";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Cite, Money } from "@/components/initiatives/shared";
import { Block, Toggle } from "./fields";
import { SEPARATION_LABEL, currentYear } from "./data";

type Kind = Exclude<SeparationKind, "probation_failed">;

const ACTIONS: { kind: Kind; icon: React.ComponentType<{ className?: string }>; hint: string; cite: string }[] = [
  { kind: "resignation", icon: UserMinus, hint: "Forfeits all unpaid bonuses from the notice date", cite: "4.5" },
  { kind: "termination_for_cause", icon: Ban, hint: "Forfeits all unpaid bonuses, including deferred", cite: "4.5" },
  { kind: "termination_without_cause", icon: UserX, hint: "Completed work paid; deferred forfeited unless CEO + PRC approve", cite: "4.5" },
  { kind: "retirement", icon: Hourglass, hint: "Paid to retirement date; < 60 days notice → PRC decides", cite: "4.5" },
  { kind: "death_disability", icon: ShieldAlert, hint: "Earned bonuses paid; deferred amounts vest immediately", cite: "4.5" },
];

const DAY = 86_400_000;
const today = () => toDateInput(new Date().toISOString());
const plusDays = (n: number) => toDateInput(new Date(Date.now() + n * DAY).toISOString());

export function SeparationSection({ profile }: { profile: EmployeeProfile }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const sep = profile.separation;
  return (
    <Block
      title={
        <>
          Record employment change <Cite s="4.5" />
        </>
      }
    >
      {sep && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-soft-orange/40 bg-soft-orange/10 p-2.5 text-xs text-soft-orange">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <span className="font-semibold">{SEPARATION_LABEL[sep.kind]}</span> effective {formatDate(sep.effectiveAt)} · recorded {formatDate(sep.recordedAt)}
            {sep.retirementNoticeDays != null ? ` · ${sep.retirementNoticeDays} days notice` : ""}
            {profile.resignationNoticeAt ? ` · resignation notice ${formatDate(profile.resignationNoticeAt)}` : ""}
            {profile.terminationNoticeAt ? ` · termination notice ${formatDate(profile.terminationNoticeAt)}` : ""}
            <div className="mt-0.5 text-sg-muted">Recording another change replaces this separation record.</div>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ACTIONS.map((a) => (
          <button key={a.kind} type="button" onClick={() => setKind(a.kind)} className="flex items-start gap-2.5 rounded-md border border-sg-line bg-sg-bg/40 p-2.5 text-left transition-colors hover:border-sg-line-2 hover:bg-sg-card-2">
            <a.icon className={cn("mt-0.5 size-4 shrink-0", a.kind === "termination_for_cause" || a.kind === "resignation" ? "text-soft-red" : a.kind === "death_disability" ? "text-soft-blue" : "text-soft-orange")} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-sg-white">{SEPARATION_LABEL[a.kind]}</span>
              <span className="block text-2xs text-sg-dim">{a.hint}</span>
            </span>
          </button>
        ))}
      </div>
      {kind && <SeparationDialog key={kind} profile={profile} kind={kind} onClose={() => setKind(null)} />}
    </Block>
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
  const adjustments = useCrm((s) => s.shareAdjustments);
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const deferredBonuses = useCrm((s) => s.deferredBonuses);
  const outcomes = useCrm((s) => s.probationOutcomes);
  const notify = useUi((s) => s.notify);
  const me = users.find((u) => u.id === currentUserId);
  const employee = users.find((u) => u.id === profile.userId);

  const [noticeDate, setNoticeDate] = useState(today());
  const [effectiveDate, setEffectiveDate] = useState(kind === "resignation" ? plusDays(30) : kind === "retirement" ? plusDays(90) : today());
  const [retirementDays, setRetirementDays] = useState<number | null>(null);
  const [deferredException, setDeferredException] = useState(false);

  const effectiveAt = effectiveDate ? fromDateInput(effectiveDate) : "";
  const noticeAt = noticeDate ? fromDateInput(noticeDate) : "";
  const derivedNoticeDays = effectiveAt && noticeAt ? Math.max(0, Math.round((Date.parse(effectiveAt) - Date.parse(noticeAt)) / DAY)) : 0;
  const noticeDays = retirementDays ?? derivedNoticeDays;
  const usesNotice = kind === "resignation" || kind === "retirement" || kind === "termination_without_cause";
  const valid = !!effectiveAt && (!usesNotice || (!!noticeAt && Date.parse(noticeAt) <= Date.parse(effectiveAt)));

  const impact = useMemo(() => {
    const month = monthKey(new Date().toISOString());
    const userId = profile.userId;
    const hypothetical: EmployeeProfile = {
      ...profile,
      resignationNoticeAt: kind === "resignation" ? noticeAt || new Date().toISOString() : profile.resignationNoticeAt,
      terminationNoticeAt: kind.startsWith("termination") ? (kind === "termination_without_cause" ? noticeAt : effectiveAt) || new Date().toISOString() : profile.terminationNoticeAt,
      separation: effectiveAt ? { kind, effectiveAt, recordedAt: new Date().toISOString(), retirementNoticeDays: kind === "retirement" ? noticeDays : undefined } : profile.separation,
    };
    const paidYtd = new Map([[userId, paidInYear(userId, bonusRuns, currentYear(), deferredBonuses)]]);
    const base = { month, initiatives, members, entries, adjustments, overheads: 0, ebitda: 1e15, paidYtd };
    const before = computeRun({ ...base, profiles }).lines.filter((l) => l.userId === userId);
    const after = computeRun({ ...base, profiles: profiles.map((p) => (p.userId === userId ? hypothetical : p)) }).lines.filter((l) => l.userId === userId);
    const title = (id: string) => {
      const i = initiatives.find((x) => x.id === id);
      return i ? `${i.code ?? i.trackingNo} · ${i.title}` : id;
    };

    const rows: ImpactRow[] = [];
    // current month projected lines
    for (const b of before) {
      const a = after.find((l) => l.initiativeId === b.initiativeId) as BonusLine | undefined;
      if (!a) continue;
      const outcome: ImpactRow["outcome"] = a.status === "forfeited" ? "forfeit" : a.status === "held" || a.status === "cap_review" ? "hold" : "pay";
      rows.push({
        label: (
          <Link href={`/initiatives/${b.initiativeId}`} className="hover:underline" onClick={onClose}>
            {title(b.initiativeId)}
          </Link>
        ),
        sub: `${month} projected bonus · pays ${formatDate(paymentDate(month))}`,
        amount: b.gross,
        outcome,
        reason: a.notes[a.notes.length - 1] ?? (outcome === "pay" ? "Payable on schedule" : ""),
      });
    }
    // pending deferred bonuses (§6.3)
    for (const d of deferredBonuses.filter((x) => x.userId === userId && x.status === "pending")) {
      const forfeitAll = kind === "resignation" || kind === "termination_for_cause";
      const outcome: ImpactRow["outcome"] = forfeitAll || (kind === "termination_without_cause" && !deferredException) ? "forfeit" : kind === "death_disability" ? "vest" : "keep";
      rows.push({
        label: (
          <Link href={`/initiatives/${d.initiativeId}`} className="hover:underline" onClick={onClose}>
            {title(d.initiativeId)}
          </Link>
        ),
        sub: `Deferred from ${d.month} · vests ${formatDate(d.vestAt)}`,
        amount: d.amount,
        outcome,
        reason:
          outcome === "forfeit"
            ? kind === "termination_without_cause"
              ? "No deferred payout on termination without cause unless CEO + PRC approve"
              : "Unpaid deferred bonuses are forfeited"
            : outcome === "vest"
              ? "Vests immediately — paid to the employee or estate"
              : kind === "termination_without_cause"
                ? "CEO + PRC exception — continues to vest on schedule"
                : "Continues to vest on its scheduled date",
      });
    }
    // probation accrual (§6.8)
    const settled = outcomes.some((o) => o.userId === userId);
    const probation = probationBalance(userId, bonusRuns);
    if (profile.employmentType === "probationary" && probation > 0 && !settled) {
      rows.push({
        label: "Probation accrual",
        sub: `Withheld since hire · probation ends ${formatDate(profile.probationEndDate)}`,
        amount: probation,
        outcome: kind === "death_disability" ? "keep" : "forfeit",
        reason: kind === "death_disability" ? "Not forfeited — settled by PRC with the estate" : "Probationers who leave before completion forfeit the accrual in full (§6.8)",
      });
    }
    const unreleased = bonusRuns.filter((r) => r.status !== "released" && r.month !== month && r.lines.some((l) => l.userId === userId && (l.payable > 0 || l.withheld > 0)));
    const total = (o: ImpactRow["outcome"]) => rows.filter((r) => r.outcome === o).reduce((s, r) => s + r.amount, 0);
    return { month, rows, unreleased, forfeit: total("forfeit"), pay: total("pay") + total("vest"), hold: total("hold"), keep: total("keep") };
  }, [profile, kind, noticeAt, effectiveAt, noticeDays, deferredException, initiatives, members, entries, adjustments, profiles, bonusRuns, deferredBonuses, outcomes, onClose]);

  const confirm = () => {
    if (!valid) return;
    recordSeparation(profile.userId, kind, effectiveAt, {
      noticeAt: kind === "resignation" || kind === "termination_without_cause" ? noticeAt : kind === "termination_for_cause" ? effectiveAt : undefined,
      retirementNoticeDays: kind === "retirement" ? noticeDays : undefined,
      deferredException: kind === "termination_without_cause" ? deferredException : undefined,
    });
    notify(`${SEPARATION_LABEL[kind]} recorded for ${employee?.name ?? "employee"}${impact.forfeit > 0 ? ` — ${formatIDR(impact.forfeit)} forfeited` : ""}`);
    onClose();
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${SEPARATION_LABEL[kind]} — ${employee?.name ?? ""}`}
      description={`Recorded by ${me?.name ?? "you"} on behalf of HR · review the impact before confirming (§4.5)`}
      className="w-[min(680px,calc(100vw-32px))]"
      footer={
        <>
          <span className="mr-auto text-2xs text-sg-dim">This cannot be undone from the register.</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={impact.forfeit > 0 ? "danger" : "primary"} disabled={!valid} onClick={confirm}>
            <Gavel /> Confirm {SEPARATION_LABEL[kind].toLowerCase()}
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {usesNotice && (
            <Field label={kind === "resignation" ? "Resignation notice submitted" : kind === "retirement" ? "Retirement notice given" : "Notice of termination"} hint={kind === "resignation" ? "Forfeiture is effective from this date (§4.5)" : undefined}>
              <Input type="date" value={noticeDate} onChange={(e) => (setNoticeDate(e.target.value), setRetirementDays(null))} />
            </Field>
          )}
          <Field label={kind === "resignation" ? "Last working day" : kind === "retirement" ? "Retirement date" : kind === "death_disability" ? "Date of event" : "Termination effective"}>
            <Input type="date" value={effectiveDate} onChange={(e) => (setEffectiveDate(e.target.value), setRetirementDays(null))} />
          </Field>
          {kind === "retirement" && (
            <Field label="Notice period (days)" hint={noticeDays < POLICY.retirementNoticeDays ? `Under ${POLICY.retirementNoticeDays} days — payments held for a PRC decision` : `${POLICY.retirementNoticeDays}+ days — paid through the retirement date`}>
              <Input type="number" min={0} value={noticeDays} onChange={(e) => setRetirementDays(e.target.value === "" ? null : Math.max(0, Number(e.target.value)))} className={cn("sg-num", noticeDays < POLICY.retirementNoticeDays && "text-soft-yellow")} />
            </Field>
          )}
        </div>
        {kind === "termination_without_cause" && (
          <Toggle checked={deferredException} onChange={setDeferredException} label="CEO + PRC approve deferred payout" hint={`Exception approved by ${me?.name ?? "the CEO"} (CEO, PRC chair) — pending deferred bonuses keep vesting instead of being forfeited`} />
        )}
        {usesNotice && noticeAt && effectiveAt && Date.parse(noticeAt) > Date.parse(effectiveAt) && <p className="text-2xs text-soft-red">The notice date must be on or before the effective date.</p>}

        <div className="rounded-lg border border-sg-line">
          <div className="flex items-center gap-2 border-b border-sg-line px-3 py-2">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-sg-white">Impact preview</span>
            <span className="text-2xs text-sg-dim">pending deferred · {impact.month} projection · probation accrual</span>
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
              <Info className="size-3.5" /> Nothing unpaid: no pending deferred bonuses, no revenue recorded for {impact.month} on this employee&apos;s projects, and no probation accrual.
            </p>
          )}
          <div className="grid grid-cols-4 border-t border-sg-line text-center">
            <Total label="Forfeited" value={impact.forfeit} tone="text-soft-red" />
            <Total label="Paid / vests" value={impact.pay} tone="text-soft-green" />
            <Total label="Held for PRC" value={impact.hold} tone="text-soft-yellow" />
            <Total label="Unchanged" value={impact.keep} tone="text-sg-muted" />
          </div>
        </div>
        {impact.unreleased.length > 0 && (
          <p className="flex items-start gap-1.5 text-2xs text-soft-yellow">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" />
            {impact.unreleased.map((r) => r.month).join(", ")} run{impact.unreleased.length > 1 ? "s are" : " is"} not yet released and include{impact.unreleased.length > 1 ? "" : "s"} lines for this employee — recompute before release so the §4.5 outcome applies.
          </p>
        )}
      </div>
    </Modal>
  );
}

const outcomeLabel: Record<ImpactRow["outcome"], string> = { forfeit: "Forfeited", pay: "Paid", vest: "Vests now", hold: "PRC decision", keep: "Unchanged" };
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
