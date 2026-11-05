"use client";

/*
 * Monthly bonus cycle (Policy v4.0 §8.2, §9.1–9.2): collection window, provisional bonuses, Project Lead ledger
 * confirmations, Finance's exception review, the CFO's break-even test and cash check on a rolling three months,
 * maker-checker PRC release with the salary (§13.1 recusal and quorum), §9.2 pro rata and carry-forward, held lines,
 * and payroll / accrual exports.
 */
import { Fragment, useMemo, useState } from "react";
import { BadgeCheck, Calculator, CalendarClock, ChevronDown, ChevronRight, CircleCheck, CircleX, ClipboardCheck, Coins, Download, Gavel, Hourglass, Info, Landmark, ListChecks, Lock, RotateCcw, Scale, Send, ShieldCheck, SlidersHorizontal, TriangleAlert, UserCheck, Users, Wallet } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import { useAccess } from "@/lib/access-control";
import type { AuditEntry, BonusLine, BonusRun, Initiative, LineStatus } from "@/lib/initiatives/types";
import type { ExceptionReview } from "@/lib/slices/comp-extras";
import {
  breakEvenDeadline,
  buildRunInputs,
  carriedOnly,
  certifyCheck,
  collectionWindow,
  computeRun,
  cycleTiming,
  deferralVestDate,
  nextMonth,
  paymentDate,
  probationBalance,
  projectCycles,
  projectPayments,
  provisionalDeadline,
  releaseCheck,
  type RunResult,
} from "@/lib/initiatives/engine";
import { POLICY } from "@/lib/initiatives/policy";
import { csvDate, downloadCsv, type CsvColumn } from "@/lib/csv";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Chip, EmptyState } from "@/components/ui/misc";
import { Modal } from "@/components/ui/overlays";
import { Cite, Money, TypeChip } from "@/components/initiatives/shared";
import {
  AmountInput,
  Callout,
  EMPTY_INPUTS,
  ExactMoney,
  InitiativeLink,
  LineStatusChip,
  Panel,
  RateCell,
  RoleNote,
  UserCell,
  dueText,
  exactIdr,
  lineStatusMeta,
  monthLabel,
  pctLabel,
  runStatusMeta,
  shortMonthLabel,
  tdCls,
  tdNum,
  thCls,
  thRight,
  useCfoId,
  useInitiativeMap,
  type RunInputValues,
} from "./common";
import { heldCondition, holdReasons, liveVotes, runExceptions, type CycleException } from "./run-controls";

const INPUT_KEYS: (keyof RunInputValues)[] = ["companyRevenue", "directCosts", "overheads", "cash", "fixedCostsMonthly"];
const sameInputs = (a: RunInputValues, b: RunInputValues) => INPUT_KEYS.every((k) => Math.round(a[k]) === Math.round(b[k]));
const pickInputs = (r: RunInputValues): RunInputValues => ({ companyRevenue: r.companyRevenue, directCosts: r.directCosts, overheads: r.overheads, cash: r.cash, fixedCostsMonthly: r.fixedCostsMonthly });
const codeOf = (i: Initiative | undefined, id: string) => i?.code ?? (i?.trackingNo || id);

export function MonthlyRunTab({ month }: { month: string }) {
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const entries = useCrm((s) => s.revenueEntries);
  const profiles = useCrm((s) => s.employeeProfiles);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const deferredBonuses = useCrm((s) => s.deferredBonuses);
  const probationOutcomes = useCrm((s) => s.probationOutcomes);
  const clawbacks = useCrm((s) => s.clawbacks);
  const bonusAdjustments = useCrm((s) => s.bonusAdjustments);
  const taxRegimeChanges = useCrm((s) => s.taxRegimeChanges);
  const ledgerConfirmations = useCrm((s) => s.ledgerConfirmations);
  const exceptionReviews = useCrm((s) => s.exceptionReviews);
  const cycleNotes = useCrm((s) => s.cycleNotes);
  const recordRun = useCrm((s) => s.recordRun);
  const addCycleNote = useCrm((s) => s.addCycleNote);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const access = useAccess();
  const cfoId = useCfoId();

  const run = bonusRuns.find((r) => r.month === month);
  const released = run?.status === "released";

  // inputs: the stored run, else the latest earlier run as a starting point (Finance overwrites with this month's figures)
  const prior = useMemo(() => [...bonusRuns].filter((r) => r.month < month).sort((a, b) => b.month.localeCompare(a.month))[0], [bonusRuns, month]);
  const [draft, setDraft] = useState<RunInputValues>(() => (run ? pickInputs(run) : prior ? pickInputs(prior) : EMPTY_INPUTS));
  const [showIndividual, setShowIndividual] = useState(false);
  const [reference, setReference] = useState("");
  const inp: RunInputValues = released && run ? pickInputs(run) : draft;

  // everything the cycle pays: new pools, carried-forward and held amounts re-tested under §10, late collections,
  // deferred releases, Probation Completion Bonuses, §8.3/§8.5 adjustments and §9.4 recoveries (W7 engine)
  const runInputs = useMemo(
    () =>
      buildRunInputs(
        { initiatives, initiativeMembers: members, revenueEntries: entries, employeeProfiles: profiles, curveAdjustments: adjustments, bonusRuns, deferredBonuses, probationOutcomes, clawbacks, bonusAdjustments, taxRegimeChanges },
        month,
        { companyRevenue: inp.companyRevenue, directCosts: inp.directCosts, overheads: inp.overheads, cash: inp.cash, fixedCostsMonthly: inp.fixedCostsMonthly },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [month, initiatives, members, entries, profiles, adjustments, bonusRuns, deferredBonuses, probationOutcomes, clawbacks, bonusAdjustments, taxRegimeChanges, inp.companyRevenue, inp.directCosts, inp.overheads, inp.cash, inp.fixedCostsMonthly],
  );
  const carriedIn = useMemo(() => carriedOnly(bonusRuns, month), [bonusRuns, month]);
  const result = useMemo(() => computeRun(runInputs), [runInputs]);

  const lines: BonusLine[] = released && run ? run.lines : result.lines;
  const totals: BonusRun["totals"] = released && run ? run.totals : result.totals;
  const view = released && run ? { payoutPct: run.payoutPct, operatingResult: run.operatingResult, cashAfter: run.cashAfter } : { payoutPct: result.payoutPct, operatingResult: result.operatingResult, cashAfter: result.cashAfter };

  const dirty = !!run && !released && (!sameInputs(pickInputs(run), draft) || Math.abs(run.totals.payable - result.totals.payable) > 1 || Math.abs(run.totals.carriedOver - result.totals.carriedOver) > 1 || Math.abs(run.payoutPct - result.payoutPct) > 1e-6);

  // §9.2 review: three failing months in a row
  const failStreak = useMemo(() => {
    const failed = (r: Pick<BonusRun, "payoutPct" | "status">) => r.status === "failed" || r.payoutPct < 1 - 1e-9;
    let n = released && run ? (failed(run) ? 1 : 0) : result.passed ? 0 : 1;
    if (n === 0) return 0;
    const earlier = bonusRuns.filter((r) => r.month < month && r.status !== "draft").sort((a, b) => b.month.localeCompare(a.month));
    for (const r of earlier) {
      if (!failed(r)) break;
      n++;
    }
    return n;
  }, [bonusRuns, month, released, run, result.passed]);

  /* §8.2 controls before certification */
  const confirmations = useMemo(() => ledgerConfirmations.filter((c) => c.month === month), [ledgerConfirmations, month]);
  const unconfirmed = result.projects.filter((p) => !confirmations.some((c) => c.initiativeId === p.initiativeId));
  const exceptions = useMemo(() => runExceptions({ month, lines: result.lines, members, profiles, initiativeIds: result.projects.map((p) => p.initiativeId) }), [month, result.lines, result.projects, members, profiles]);
  const reviews = useMemo(() => exceptionReviews.filter((r) => r.month === month), [exceptionReviews, month]);
  const unreviewed = exceptions.filter((e) => !reviews.some((r) => r.key === e.key));
  const notes = useMemo(() => cycleNotes.filter((n) => n.month === month), [cycleNotes, month]);

  const timing = useMemo(() => cycleTiming(month), [month]);
  const certifyLate = timing.phase === "release" || timing.phase === "late";
  const salaryPassed = timing.phase === "late";

  const rollingLabel = `${shortMonthLabel(nextMonth(month, -3))} – ${shortMonthLabel(nextMonth(month, -1))}`;
  const status = run?.status ?? "none";
  const isCfo = access.roles.includes("cfo");
  const onBehalf = access.certify && !isCfo;
  const missingInputs = inp.companyRevenue <= 0 || inp.fixedCostsMonthly <= 0;
  const check = certifyCheck(month, { profiles, actorId: access.userId, certifiedById: onBehalf ? cfoId : null });
  const certifyBlock = !access.certify
    ? "Only the CFO, or Finance recording the CFO's written certification, certifies the checks (§9.1, §13.2)"
    : onBehalf && !cfoId
      ? "No HR record holds the CFO role — HR assigns it on /people before a certification can be recorded"
      : missingInputs
        ? "Enter the rolling three-month company revenue and the monthly fixed operating costs first (§9.1)"
        : !check.ok
          ? check.blockers.join(" · ")
          : unconfirmed.length
            ? `${unconfirmed.length} project${unconfirmed.length === 1 ? "" : "s"} still need the Project Lead's ledger confirmation (§8.2)`
            : unreviewed.length
              ? `${unreviewed.length} exception${unreviewed.length === 1 ? "" : "s"} still to review`
              : onBehalf && reference.trim().length < 5
                ? `Enter the reference of ${userMap.get(cfoId ?? "")?.name ?? "the CFO"}'s written certification`
                : null;

  const save = (st: "draft" | "certified") => {
    if (!access.certify) return;
    if (st === "certified" && certifyBlock) return;
    const opts = st === "certified" && onBehalf && cfoId ? { certifiedById: cfoId } : {};
    const id = recordRun(result as RunResult, draft, st, opts);
    if (!id) return;
    if (st === "certified" && onBehalf) addCycleNote(month, "certification_reference", `${userMap.get(cfoId ?? "")?.name ?? "CFO"}'s written certification: ${reference.trim()}`);
    notify(st === "certified" ? `${monthLabel(month)} checks certified${onBehalf ? ` for ${userMap.get(cfoId ?? "")?.name ?? "the CFO"}` : ""}${result.passed ? " — passed" : ` — ${pctLabel(result.payoutPct)} pro rata (§9.2)`}; awaiting PRC release` : `Provisional bonuses saved for ${monthLabel(month)}`);
    setReference("");
  };

  return (
    <div className="space-y-4">
      <CycleTimeline month={month} run={run} />

      {!released && certifyLate && status !== "certified" ? (
        <Callout tone="warn">
          <span className="font-semibold">Certification overdue.</span> The CFO certifies the break-even test and cash check by {formatDate(breakEvenDeadline(month), "datetime")} (§8.2). {salaryPassed ? `The ${formatDate(paymentDate(month), "medium")} salary date has passed (${timing.lateDays} business day${timing.lateDays === 1 ? "" : "s"} late) — a late release records its reason.` : ""}
        </Callout>
      ) : null}
      {!released && status === "certified" && salaryPassed ? (
        <Callout tone="warn">
          <span className="font-semibold">Release is late.</span> The {formatDate(paymentDate(month), "medium")} salary date passed {timing.lateDays} business day{timing.lateDays === 1 ? "" : "s"} ago — the PRC records the reason with the release (§8.2).
        </Callout>
      ) : null}
      {result.dateNotes?.length ? (
        <Callout>
          {result.dateNotes.join(" · ")} <Cite s="8.2" />
        </Callout>
      ) : null}

      {released && run ? (
        <Callout tone="ok">
          <span className="font-semibold">Released — read-only.</span> Certified by {userMap.get(run.certifiedById ?? "")?.name ?? "—"} {run.certifiedAt ? `on ${formatDate(run.certifiedAt, "datetime")}` : ""}; release authorised by {userMap.get(run.releasedById ?? "")?.name ?? "—"} {run.releasedAt ? `on ${formatDate(run.releasedAt, "datetime")}` : ""}. Bonus lines and totals are the stored snapshot; project figures are recomputed from the current payment records.
        </Callout>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Panel title="Finance inputs" icon={SlidersHorizontal} cite="9.1" subtitle={`rolling ${rollingLabel}`}>
          <div
            className="space-y-3"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !released && access.certify) save("draft");
            }}
          >
            <AmountField label="Company revenue (3 months)" hint="Accrual basis, excl. VAT, incl. work outside this policy" value={inp.companyRevenue} disabled={released || !access.certify} onChange={(v) => setDraft((d) => ({ ...d, companyRevenue: v }))} />
            <AmountField label="Direct project costs (3 months)" hint="§5.3 direct costs of all projects" value={inp.directCosts} disabled={released || !access.certify} onChange={(v) => setDraft((d) => ({ ...d, directCosts: v }))} />
            <AmountField label="Operating overheads (3 months)" hint="All other operating costs incl. every salary, rent, depreciation, interest" value={inp.overheads} disabled={released || !access.certify} onChange={(v) => setDraft((d) => ({ ...d, overheads: v }))} />
            <AmountField label="Cash before bonuses" value={inp.cash} disabled={released || !access.certify} onChange={(v) => setDraft((d) => ({ ...d, cash: v }))} />
            <AmountField label="Fixed operating costs per month" hint={`Cash floor = ${POLICY.breakEven.cashFloorMonths} × = ${formatIDR(POLICY.breakEven.cashFloorMonths * inp.fixedCostsMonthly, "full")}`} value={inp.fixedCostsMonthly} disabled={released || !access.certify} onChange={(v) => setDraft((d) => ({ ...d, fixedCostsMonthly: v }))} />
            {!access.certify && !released ? <RoleNote>Finance enters these figures (§13.2) — shown read-only.</RoleNote> : null}
            {!run && prior ? (
              <p className="flex items-start gap-1.5 text-2xs text-sg-dim">
                <Info className="mt-0.5 size-3 shrink-0" /> Prefilled from the {monthLabel(prior.month)} run — overwrite with the latest three closed months before certifying.
              </p>
            ) : null}
            {run && !released && access.certify && !sameInputs(pickInputs(run), draft) ? (
              <button type="button" onClick={() => setDraft(pickInputs(run))} className="flex items-center gap-1 text-2xs text-sg-muted hover:text-sg-white">
                <RotateCcw className="size-3" /> Revert to the saved figures
              </button>
            ) : null}
          </div>
        </Panel>

        <Panel title="Break-even test & cash check" icon={Scale} cite="9.1" subtitle={`${monthLabel(month)} · CFO certifies by ${formatDate(breakEvenDeadline(month), "short")}`}>
          <ChecksView result={result} inp={inp} view={view} />

          {!result.passed ? (
            <Callout tone="danger" className="mt-4">
              <div className="font-semibold">
                {!result.breakEvenPassed && !result.cashPassed ? "Both checks fail" : !result.breakEvenPassed ? "Break-even test fails" : "Cash check fails"} — §9.2 applies <Cite s="9.2" />
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>
                  Type C standard bonuses are paid in full first: <span className="sg-num font-semibold">{exactIdr(result.guaranteed)}</span> <Cite s="8.6" />
                </li>
                {carriedIn.length ? (
                  <li>
                    Amounts carried forward from earlier months are paid next: <span className="sg-num font-semibold">{pctLabel(result.carriedPaidPct)}</span> of {exactIdr(carriedIn.reduce((s, c) => s + c.amount, 0))}
                  </li>
                ) : null}
                <li>
                  Every employee receives the same <span className="sg-num font-semibold">{(view.payoutPct * 100).toFixed(2)}%</span> of their new bonus — the largest share that still passes both checks.
                </li>
                <li>
                  <span className="sg-num font-semibold">{exactIdr(totals.carriedOver)}</span> is carried forward and paid first in the next month both checks pass. It is not forfeited (§10 still applies on a status change).
                </li>
                <li>The revenue-share curve is never cut retroactively or without notice in response to a failed test.</li>
              </ul>
            </Callout>
          ) : null}
          {failStreak >= POLICY.breakEven.failReviewMonths ? (
            <Callout tone="warn" className="mt-2">
              The checks have failed {failStreak} months in a row — the PRC reviews the project portfolio and may propose a curve change under §9.5 (§9.2 step 3).
            </Callout>
          ) : null}

          {/* workflow */}
          <div className="mt-4 border-t border-sg-line pt-4">
            {released ? (
              <span className="flex items-center gap-1.5 text-xs text-sg-muted">
                <Lock className="size-3.5" /> Released {run?.releasedAt ? formatDate(run.releasedAt, "datetime") : ""} — paid with the {formatDate(paymentDate(month), "medium")} salary
              </span>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" disabled={!access.certify} onClick={() => save("draft")} title="Finance calculates provisional bonuses by the 22nd; Project Leads confirm the Team Allocation Ledger (§8.2) · ⌘/Ctrl+Enter">
                    {run?.status === "certified" ? "Reopen as provisional" : "Save provisional"}
                  </Button>
                  <Button variant="primary" size="sm" disabled={!!certifyBlock} onClick={() => save("certified")}>
                    <BadgeCheck /> {isCfo ? "Certify as CFO" : `Record ${userMap.get(cfoId ?? "")?.name ?? "CFO"}'s certification`}
                  </Button>
                  <span className="ml-auto">
                    <Chip color={runStatusMeta[status].color} dot>
                      {runStatusMeta[status].label}
                    </Chip>
                  </span>
                </div>
                {onBehalf && cfoId && !certifyBlock?.startsWith("Only") ? (
                  <Field label={`Reference of ${userMap.get(cfoId)?.name ?? "the CFO"}'s written certification`} hint={`Recorded by ${userMap.get(access.userId)?.name ?? "you"} for the CFO; the audit log names both (§9.1, §13.3)`}>
                    <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. signed memo FIN-2026-11-23, or e-mail of 23 Nov 16:02" />
                  </Field>
                ) : null}
                {certifyBlock ? <RoleNote>{certifyBlock}</RoleNote> : null}
                {run?.status === "certified" && dirty ? <Callout tone="warn">Figures changed since the CFO certified on {formatDate(run.certifiedAt, "datetime")}. Re-certify before the PRC can authorise release.</Callout> : null}
                {run?.status === "certified" && !dirty ? (
                  <p className="text-2xs text-sg-muted">
                    Certified by {userMap.get(run.certifiedById ?? "")?.name ?? "—"} on {formatDate(run.certifiedAt, "datetime")}. Release creates the §9.3 deferred entries; carried-forward amounts are fed into the next run and paid first.
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </Panel>
      </div>

      {run && (run.status === "certified" || run.status === "released") ? <ReleasePanel run={run} dirty={dirty} salaryPassed={salaryPassed} /> : null}

      {!released ? <ControlsPanel month={month} exceptions={exceptions} reviews={reviews} unconfirmed={unconfirmed.length} projects={result.projects.length} /> : null}

      {carriedIn.length ? <CarriedInPanel carriedIn={carriedIn} paidPct={result.carriedPaidPct} /> : null}

      <HeldPanel lines={lines} month={month} />

      <ProjectsTable result={result} month={month} released={released} />

      <LinesPanel lines={lines} totals={totals} showIndividual={showIndividual && access.seeAllPay} setShowIndividual={setShowIndividual} canSeeIndividual={access.seeAllPay} />

      <ExportsPanel run={run} />

      {notes.length ? (
        <Panel title="Cycle notes" icon={ClipboardCheck} cite="13.3" bodyClassName="p-0">
          <ul className="divide-y divide-sg-line">
            {notes.map((n) => (
              <li key={n.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2 text-xs">
                <span className="font-semibold text-sg-white">Certification reference</span>
                <span className="min-w-0 flex-1 text-sg-muted">{n.text}</span>
                <span className="text-2xs text-sg-dim">
                  {userMap.get(n.byId)?.name ?? n.byId} · {formatDate(n.at, "datetime")}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

function AmountField({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <Field label={label} hint={hint ? `${hint} · ${formatIDR(value, "full")}` : formatIDR(value, "full")}>
      <AmountInput value={value} disabled={disabled} onChange={onChange} aria-label={label} />
    </Field>
  );
}

/* ───────────── §8.2 timeline ───────────── */

function CycleTimeline({ month, run }: { month: string; run: BonusRun | undefined }) {
  const w = collectionWindow(month);
  const steps = [
    { label: "Collection window", date: `${formatDate(w.from, "short")} → ${formatDate(w.to, "short")}`, hint: `Revenue collected by the ${POLICY.cycle.cutoffDay}th is paid this month; later collections move to next month`, due: w.to, done: Date.now() > Date.parse(w.to) },
    { label: "Provisional bonuses", date: `by ${formatDate(provisionalDeadline(month), "short")}`, hint: "Finance calculates; each Project Lead confirms the Team Allocation Ledger", due: provisionalDeadline(month), done: !!run },
    { label: "CFO certifies checks", date: `by ${formatDate(breakEvenDeadline(month), "short")}`, hint: "Break-even test and cash check on the latest three closed months", due: breakEvenDeadline(month), done: !!run?.certifiedAt },
    { label: "Paid with salary", date: formatDate(paymentDate(month), "medium"), hint: "PRC authorises release; every participant receives a statement (Annex E)", due: paymentDate(month), done: run?.status === "released" },
  ];
  return (
    <ol className="grid gap-px overflow-hidden rounded-xl border border-sg-line bg-sg-line sm:grid-cols-2 xl:grid-cols-4">
      {steps.map((s, i) => {
        const overdue = !s.done && Date.parse(s.due) < Date.now();
        return (
          <li key={s.label} className="flex items-start gap-3 bg-sg-card px-4 py-3">
            <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold", s.done ? "bg-soft-green/20 text-soft-green" : overdue ? "bg-soft-orange/20 text-soft-orange" : "bg-sg-card-3 text-sg-muted")}>{s.done ? <CircleCheck className="size-3.5" /> : i + 1}</span>
            <div className="min-w-0">
              <div className="sg-eyebrow flex items-center">
                {s.label}
                {i === 0 ? <Cite s="8.2" /> : null}
              </div>
              <div className="sg-num mt-0.5 text-sm font-semibold text-sg-white">{s.date}</div>
              <div className="text-2xs text-sg-dim">{s.hint}</div>
              {!s.done && i > 0 ? <div className={cn("text-2xs", overdue ? "text-soft-orange" : "text-sg-muted")}>{dueText(s.due)}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ───────────── §9.1 checks ───────────── */

function ChecksView({ result, inp, view }: { result: RunResult; inp: RunInputValues; view: { payoutPct: number; operatingResult: number; cashAfter: number } }) {
  const base = inp.companyRevenue - inp.directCosts - inp.overheads;
  const carried = result.totals.carriedIn;
  const fresh = Math.max(0, result.proposed - result.guaranteed - carried);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <div className="sg-eyebrow mb-1">Break-even test · rolling three months</div>
        <table className="w-full text-sm">
          <tbody>
            <FormulaRow label="Company revenue" value={inp.companyRevenue} />
            <FormulaRow label="− Direct project costs" value={-inp.directCosts} cite="5.3" />
            <FormulaRow label="− Operating overheads" value={-inp.overheads} />
            <FormulaRow label="= Result before bonuses" value={base} strong />
            <FormulaRow label="− Proposed project bonuses" value={-result.proposed} />
            <FormulaRow label="Type C standard bonuses" value={result.guaranteed} sub cite="8.6" />
            <FormulaRow label="carried forward from earlier months" value={carried} sub />
            <FormulaRow label="new bonuses this cycle" value={fresh} sub />
            <VerdictRow label="Operating result" value={result.operatingResultBefore} passed={result.breakEvenPassed} />
            {!result.passed ? <FormulaRow label="Operating result after the §9.2 release" value={view.operatingResult} /> : null}
          </tbody>
        </table>
      </div>
      <div>
        <div className="sg-eyebrow mb-1">Cash check</div>
        <table className="w-full text-sm">
          <tbody>
            <FormulaRow label="Cash before bonuses" value={inp.cash} />
            <FormulaRow label="− Proposed project bonuses" value={-result.proposed} />
            <FormulaRow label="= Cash after proposed bonuses" value={inp.cash - result.proposed} strong />
            <FormulaRow label={`Floor: ${POLICY.breakEven.cashFloorMonths} months of fixed operating costs`} value={result.cashFloor} />
            <VerdictRow label="Headroom over the floor" value={inp.cash - result.proposed - result.cashFloor} passed={result.cashPassed} />
            <FormulaRow label="Cash after bonuses released" value={view.cashAfter} />
          </tbody>
        </table>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Verdict label="Break-even" passed={result.breakEvenPassed} />
          <Verdict label="Cash check" passed={result.cashPassed} />
          <div className={cn("rounded-lg border px-2 py-2 text-center", view.payoutPct >= 1 - 1e-9 ? "border-soft-green/40 bg-soft-green/10" : "border-soft-yellow/40 bg-soft-yellow/10")}>
            <div className="sg-eyebrow">Released</div>
            <div className={cn("sg-num font-display text-lg font-extrabold", view.payoutPct >= 1 - 1e-9 ? "text-soft-green" : "text-soft-yellow")}>{(view.payoutPct * 100).toFixed(view.payoutPct >= 1 - 1e-9 ? 0 : 2)}%</div>
          </div>
        </div>
        <p className="mt-2 text-2xs leading-relaxed text-sg-dim">Gross company revenue is used, not project net revenue, so direct costs and taxes are not deducted twice. Workings are kept for audit.</p>
      </div>
    </div>
  );
}

function FormulaRow({ label, value, strong, cite, sub }: { label: string; value: number; strong?: boolean; cite?: string; sub?: boolean }) {
  return (
    <tr className={cn(strong && "border-t border-sg-line")}>
      <td className={cn("py-1 text-xs", sub ? "pl-4 text-2xs text-sg-dim" : strong ? "font-semibold text-sg-white" : "text-sg-muted")}>
        {label}
        {cite ? <Cite s={cite} /> : null}
      </td>
      <td className={cn("sg-num py-1 text-right", sub ? "text-2xs text-sg-dim" : "text-xs", strong ? "font-semibold text-sg-white" : !sub ? "text-sg-text" : "")} title={exactIdr(value)}>
        {formatIDR(Math.abs(value) < 0.5 ? 0 : value)}
      </td>
    </tr>
  );
}

function VerdictRow({ label, value, passed }: { label: string; value: number; passed: boolean }) {
  return (
    <tr className="border-t border-sg-line-2">
      <td className="py-2 font-display font-extrabold text-sg-white">{label}</td>
      <td className={cn("sg-num py-2 text-right font-display text-base font-extrabold", passed ? "text-soft-green" : "text-soft-red")} title={exactIdr(value)}>
        {formatIDR(Math.abs(value) < 0.5 ? 0 : value)}
      </td>
    </tr>
  );
}

function Verdict({ label, passed }: { label: string; passed: boolean }) {
  return (
    <div className={cn("flex flex-col items-center rounded-lg border px-2 py-2 text-center", passed ? "border-soft-green/40 bg-soft-green/10" : "border-soft-red/40 bg-soft-red/10")}>
      <div className="sg-eyebrow">{label}</div>
      <div className={cn("flex items-center gap-1 font-display text-lg font-extrabold", passed ? "text-soft-green" : "text-soft-red")}>
        {passed ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}
        {passed ? "PASS" : "FAIL"}
      </div>
    </div>
  );
}

/* ───────────── §9.2 carried in ───────────── */

function CarriedInPanel({ carriedIn, paidPct }: { carriedIn: { initiativeId: string; userId: string; amount: number }[]; paidPct: number }) {
  const total = carriedIn.reduce((s, c) => s + c.amount, 0);
  return (
    <Panel title="Carried forward from earlier months" icon={Hourglass} cite="9.2" subtitle={`${carriedIn.length} line${carriedIn.length === 1 ? "" : "s"} · ${exactIdr(total)} · paid first, before new bonuses`} bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-sg-line">
              <th className={thCls}>Employee</th>
              <th className={thCls}>Project</th>
              <th className={thRight}>Carried in</th>
              <th className={thRight}>Paid this cycle</th>
              <th className={thRight}>Still carried</th>
            </tr>
          </thead>
          <tbody>
            {carriedIn.map((c) => {
              const paid = Math.floor(c.amount * paidPct + 1e-6);
              return (
                <tr key={`${c.userId}-${c.initiativeId}`} className="border-b border-sg-line">
                  <td className={tdCls}>
                    <UserCell userId={c.userId} />
                  </td>
                  <td className={cn(tdCls, "max-w-[260px]")}>
                    <InitiativeLink id={c.initiativeId} />
                  </td>
                  <td className={tdNum}>
                    <ExactMoney value={c.amount} />
                  </td>
                  <td className={cn(tdNum, "text-soft-green")}>
                    <ExactMoney value={paid} />
                  </td>
                  <td className={cn(tdNum, c.amount - paid > 0 ? "text-soft-yellow" : "text-sg-dim")}>
                    <ExactMoney value={c.amount - paid} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ───────────── §8.2 / §13.1 maker-checker release ───────────── */

function ReleasePanel({ run, dirty, lateReason, salaryPassed, auditLog }: { run: BonusRun; dirty: boolean; lateReason: string | null; salaryPassed: boolean; auditLog: AuditEntry[] }) {
  const profiles = useCrm((s) => s.employeeProfiles);
  const approvalsAll = useCrm((s) => s.releaseApprovals);
  const approveRelease = useCrm((s) => s.approveRelease);
  const withdrawReleaseApproval = useCrm((s) => s.withdrawReleaseApproval);
  const releaseRun = useCrm((s) => s.releaseRun);
  const addCycleNote = useCrm((s) => s.addCycleNote);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const access = useAccess();
  const [reason, setReason] = useState("");

  const st = useMemo(() => releaseState({ run, profiles, approvals: approvalsAll, auditLog }), [run, profiles, approvalsAll, auditLog]);
  const released = run.status === "released";
  const me = access.userId;
  const myRecusal = st.recused.find((r) => r.userId === me);
  const isMaker = me === run.certifiedById || me === st.recordedById;
  const conflicted = run.lines.some((l) => l.userId === me);
  const approved = st.approvals.some((a) => a.userId === me);
  const releaseBlock = released
    ? null
    : dirty
      ? "Figures changed since certification — re-certify first"
      : !access.prc
        ? "Only the PRC authorises release (§8.2, §13.2)"
        : isMaker
          ? "You certified or recorded this certification — a different PRC member authorises release (maker-checker, §8.2)"
          : conflicted && !st.quorumMet
            ? `You have bonus lines in this run and are recused (§13.1) — release needs a quorum: approvals recorded by ${st.quorumNeeded} PRC members present including the CFO or a Finance delegate`
            : salaryPassed && !lateReason
              ? "The salary date has passed — record the reason for the late release first"
              : null;

  const release = () => {
    if (releaseBlock) return;
    if (!conflicted && !approved) approveRelease(run.id);
    releaseRun(run.id);
    const after = useCrm.getState().bonusRuns.find((r) => r.id === run.id);
    if (after?.status === "released") notify(`PRC authorised release for ${monthLabel(run.month)} — paid with the ${formatDate(paymentDate(run.month), "medium")} salary`);
    else notify("Release was refused by the policy checks — see the maker-checker panel");
  };

  return (
    <Panel title="PRC release · maker-checker" icon={Gavel} cite="13.1" subtitle={released ? `released by ${userMap.get(run.releasedById ?? "")?.name ?? "—"}` : "certifier ≠ releaser · recusal · quorum"}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <Step label="Prepared (provisional)" who={st.preparedById} />
          <Step label="Certified by" who={run.certifiedById} at={run.certifiedAt} />
          <Step label="Entered by" who={st.recordedById} sub={st.recordedById && st.recordedById !== run.certifiedById ? "on the CFO's behalf" : undefined} />
          <Step label="Released by" who={run.releasedById} at={run.releasedAt} />
          <div className="col-span-2">
            <dt className="text-2xs text-sg-dim">Quorum (§13.1)</dt>
            <dd className={cn("font-semibold", st.quorumMet ? "text-soft-green" : "text-sg-text")}>
              {st.present.length} of {st.roster.length} present · {st.quorumNeeded} needed · {st.financePresent ? "CFO / Finance present" : "CFO or a Finance delegate must be present"}
            </dd>
          </div>
        </dl>
        <div>
          <div className="sg-eyebrow mb-1">PRC members</div>
          <ul className="divide-y divide-sg-line rounded-lg border border-sg-line">
            {st.roster.map((u) => {
              const a = st.approvals.find((x) => x.userId === u);
              const rec = st.recused.find((r) => r.userId === u);
              const canRecord = !released && !rec && !a && access.prc && !dirty && (u === me || !isMaker);
              return (
                <li key={u} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
                  <span className="min-w-0 flex-1">
                    <UserCell userId={u} sub={rec ? `Recused — ${rec.reason}` : a ? `Approved ${formatDate(a.at, "datetime")}${a.recordedById !== a.userId ? ` · recorded by ${userMap.get(a.recordedById)?.name ?? a.recordedById}` : ""}` : "No approval recorded"} />
                  </span>
                  {a ? (
                    <>
                      <Chip color="green" dot>
                        Approved
                      </Chip>
                      {!released && (a.userId === me || a.recordedById === me) ? (
                        <Button size="xs" variant="ghost" onClick={() => withdrawReleaseApproval(a.id)}>
                          Withdraw
                        </Button>
                      ) : null}
                    </>
                  ) : rec ? (
                    <Chip color="blue">Recused</Chip>
                  ) : canRecord ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        const id = approveRelease(run.id, u === me ? undefined : u);
                        notify(id ? `${u === me ? "Your" : `${userMap.get(u)?.name ?? "Member"}'s`} approval recorded` : "Approval not recorded — check recusal and the certification");
                      }}
                    >
                      <UserCheck /> {u === me ? "Approve release" : "Record written approval"}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {!released ? (
        <div className="mt-4 space-y-2 border-t border-sg-line pt-3">
          {salaryPassed && !lateReason && access.prc ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Reason for releasing after the salary date (§8.2)" className="min-w-[260px] flex-1">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. PRC quorum only reached on the 26th; paid in an off-cycle payroll run" />
              </Field>
              <Button size="sm" variant="outline" disabled={reason.trim().length < 5} onClick={() => addCycleNote(run.month, "late_release", reason)}>
                Record reason
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="pill" size="sm" disabled={!!releaseBlock} onClick={release}>
              <Send /> Authorise release (PRC)
            </Button>
            {myRecusal && !isMaker ? <span className="text-2xs text-sg-dim">You are recused: {myRecusal.reason}</span> : null}
            {lateReason ? <span className="text-2xs text-soft-yellow">Late release · {lateReason}</span> : null}
          </div>
          {releaseBlock ? <RoleNote>{releaseBlock}</RoleNote> : <RoleNote>Your release is recorded as the PRC authorisation together with the approvals above (§13.3).</RoleNote>}
        </div>
      ) : null}
    </Panel>
  );
}

function Step({ label, who, at, sub }: { label: string; who: string | null | undefined; at?: string | null; sub?: string }) {
  const userMap = useUserMap();
  return (
    <div>
      <dt className="text-2xs text-sg-dim">{label}</dt>
      <dd className="font-semibold text-sg-white">{who ? userMap.get(who)?.name ?? who : "—"}</dd>
      {at || sub ? <dd className="text-2xs text-sg-dim">{[at ? formatDate(at, "datetime") : "", sub ?? ""].filter(Boolean).join(" · ")}</dd> : null}
    </div>
  );
}

/* ───────────── §8.2 ledger confirmations & exception review ───────────── */

function ControlsPanel({ month, exceptions, reviews, unconfirmed, projects }: { month: string; exceptions: CycleException[]; reviews: ExceptionReview[]; unconfirmed: number; projects: number }) {
  const reviewException = useCrm((s) => s.reviewException);
  const unreviewException = useCrm((s) => s.unreviewException);
  const userMap = useUserMap();
  const access = useAccess();
  const done = exceptions.filter((e) => reviews.some((r) => r.key === e.key)).length;
  return (
    <Panel title="Before certification" icon={ListChecks} cite="8.2" subtitle={`${projects - unconfirmed}/${projects} ledgers confirmed · ${done}/${exceptions.length} exceptions reviewed`} bodyClassName="p-0">
      <p className="border-b border-sg-line px-4 py-2 text-2xs text-sg-dim">
        Each Project Lead confirms the Team Allocation Ledger by the 22nd (in &ldquo;Projects this cycle&rdquo; below). Finance re-checks employment status before each payment (§3.5) and reviews the exception population — joiners and leavers, large lines, non-standard weights, held and forfeited amounts, probations ending and status changes. The CFO certifies once both are complete.
      </p>
      {exceptions.length ? (
        <ul className="divide-y divide-sg-line">
          {exceptions.map((e) => {
            const r = reviews.find((x) => x.key === e.key);
            return (
              <li key={e.key} className="flex flex-wrap items-center gap-3 px-4 py-2 text-xs">
                <span className="w-44 shrink-0">{e.userId ? <UserCell userId={e.userId} /> : null}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-sg-white">{e.label}</span>
                  <span className="text-sg-muted"> · {e.detail}</span>
                  {e.initiativeId ? (
                    <span className="block max-w-[320px]">
                      <InitiativeLink id={e.initiativeId} compact />
                    </span>
                  ) : null}
                </span>
                {r ? (
                  <span className="flex items-center gap-2">
                    <span className="text-2xs text-soft-green">
                      <CircleCheck className="mr-1 inline size-3" />
                      Reviewed by {userMap.get(r.reviewedById)?.name ?? r.reviewedById} · {formatDate(r.at, "short")}
                    </span>
                    {access.certify ? (
                      <Button size="xs" variant="ghost" onClick={() => unreviewException(r.id)}>
                        Undo
                      </Button>
                    ) : null}
                  </span>
                ) : access.certify ? (
                  <Button size="xs" variant="outline" onClick={() => reviewException(month, e.key, `${userMap.get(e.userId ?? "")?.name ?? ""} — ${e.label}`)}>
                    <ClipboardCheck /> Mark reviewed
                  </Button>
                ) : (
                  <span className="text-2xs text-sg-dim">Finance to review</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-3 text-xs text-sg-muted">No exceptions in this cycle.</p>
      )}
    </Panel>
  );
}

/* ───────────── held lines (§10, §15.1) ───────────── */

function HeldPanel({ lines, month }: { lines: BonusLine[]; month: string }) {
  const held = lines.filter((l) => l.held > 0);
  if (!held.length) return null;
  const total = held.reduce((s, l) => s + l.held, 0);
  return (
    <Panel title="Held — paid when the condition clears" icon={Hourglass} cite="10" subtitle={`${held.length} line${held.length === 1 ? "" : "s"} · ${exactIdr(total)}`} bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-sg-line">
              <th className={thCls}>Employee</th>
              <th className={thCls}>Project</th>
              <th className={thRight}>Held</th>
              <th className={thCls}>Why</th>
              <th className={thCls}>Paid when</th>
            </tr>
          </thead>
          <tbody>
            {held.map((l) => {
              const reason = holdReasons(l)[0] ?? "Held (§10)";
              const c = heldCondition(reason);
              return (
                <tr key={`${l.userId}-${l.initiativeId}`} className="border-b border-sg-line align-top">
                  <td className={tdCls}>
                    <UserCell userId={l.userId} />
                  </td>
                  <td className={cn(tdCls, "max-w-[240px]")}>
                    <InitiativeLink id={l.initiativeId} />
                  </td>
                  <td className={cn(tdNum, "font-semibold text-soft-orange")}>
                    <ExactMoney value={l.held} />
                  </td>
                  <td className={cn(tdCls, "max-w-[280px] text-2xs text-sg-muted")}>{reason}</td>
                  <td className={cn(tdCls, "max-w-[280px] text-2xs")}>
                    <span className="text-sg-text">{c.when}</span>
                    {c.where ? (
                      <a href={c.where} className="ml-1 text-sg-muted underline-offset-2 hover:text-sg-white hover:underline">
                        HR record
                      </a>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-2xs text-sg-dim">
        Held amounts are not forfeited. They stay on the {monthLabel(month)} run, are re-checked against §10 every cycle and are paid with the first salary after the hold clears; a confirmed serious violation forfeits them.
      </p>
    </Panel>
  );
}

/* ───────────── projects ───────────── */

function ProjectsTable({ result, month, released }: { result: RunResult; month: string; released: boolean }) {
  const iniMap = useInitiativeMap();
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const entries = useCrm((s) => s.revenueEntries);
  const profiles = useCrm((s) => s.employeeProfiles);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const [open, setOpen] = useState<string | null>(null);
  const [overrideFor, setOverrideFor] = useState<string | null>(null);

  const payments = useMemo(() => {
    const m = new Map<string, ReturnType<typeof projectPayments>>();
    for (const p of result.projects) {
      const ini = iniMap.get(p.initiativeId);
      if (ini) m.set(p.initiativeId, projectPayments(ini, entries, adjustments).filter((x) => x.month === month));
    }
    return m;
  }, [result.projects, iniMap, entries, adjustments, month]);

  // live Type C projects in their minimum period that produced no line (e.g. no one on the ledger yet)
  const unpaidMinimum = useMemo(() => {
    const shown = new Set(result.projects.map((p) => p.initiativeId));
    return initiatives
      .filter((i) => i.type === "C" && ["approved", "active"].includes(i.status) && !shown.has(i.id))
      .map((i) => ({ ini: i, cycle: projectCycles(i, { members, entries, profiles, adjustments }, month).find((c) => c.month === month) }))
      .filter((x) => x.cycle?.minimumActive && x.cycle.noTeam);
  }, [initiatives, result.projects, members, entries, profiles, adjustments, month]);

  const awaiting = useMemo(() => entries.filter((e) => e.month === month && !e.received), [entries, month]);
  const sum = (k: "revenue" | "directCosts" | "tax" | "net" | "pool" | "topUp") => result.projects.reduce((s, p) => s + p[k], 0);

  return (
    <Panel title="Projects this cycle" icon={Landmark} cite="8.1" subtitle="pool = y × cumulative net revenue − pool already allocated" bodyClassName="p-0">
      {result.projects.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1420px] text-sm">
            <thead>
              <tr className="border-b border-sg-line">
                <th className={thCls}>Project</th>
                <th className={thRight}>Collected</th>
                <th className={thRight}>Direct costs</th>
                <th className={thRight}>UMKM tax 0.5%</th>
                <th className={thRight}>Net revenue</th>
                <th className={thCls}>Rate y</th>
                <th className={thRight}>Pool §8.1</th>
                <th className={thCls}>Type C minimum §8.6</th>
                <th className={thCls}>Deferral §9.3</th>
                <th className={thCls}>Ledger §8.2</th>
              </tr>
            </thead>
            <tbody>
              {result.projects.map((p) => {
                const ini = iniMap.get(p.initiativeId);
                const pays = payments.get(p.initiativeId) ?? [];
                const expanded = open === p.initiativeId;
                return (
                  <Fragment key={p.initiativeId}>
                    <tr className="border-b border-sg-line hover:bg-sg-card-2/40">
                      <td className={cn(tdCls, "max-w-[260px]")}>
                        <div className="flex items-start gap-1.5">
                          <button type="button" className="mt-0.5 text-sg-dim hover:text-sg-white disabled:opacity-30" disabled={!pays.length} onClick={() => setOpen(expanded ? null : p.initiativeId)} aria-label="Show payments">
                            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                          </button>
                          <div className="min-w-0">
                            <InitiativeLink id={p.initiativeId} />
                            {ini ? (
                              <div className="mt-0.5">
                                <TypeChip type={ini.type} />
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className={tdNum}>
                        <Money value={p.revenue} />
                        <div className="text-2xs text-sg-dim">
                          {p.payments} payment{p.payments === 1 ? "" : "s"}
                        </div>
                      </td>
                      <td className={tdNum}>
                        <Money value={p.directCosts} />
                      </td>
                      <td className={tdNum}>
                        <Money value={p.tax} />
                      </td>
                      <td className={cn(tdNum, "font-semibold", p.net < 0 ? "text-soft-red" : "text-sg-white")}>
                        <Money value={p.net} />
                      </td>
                      <td className={cn(tdCls, "max-w-[200px]")}>
                        <RateCell rate={{ rate: p.sharePct, x: p.x, source: p.rateSource }} />
                      </td>
                      <td className={cn(tdNum, "font-semibold text-sg-white")}>
                        <Money value={p.pool} />
                        {p.net > 0 && p.pool === 0 ? <div className="text-2xs font-normal text-sg-dim">earlier shortfall recovered</div> : null}
                      </td>
                      <td className={cn(tdCls, "text-2xs")}>
                        {p.standardBonus == null ? (
                          <span className="text-sg-dim">—</span>
                        ) : (
                          <div className="space-y-0.5">
                            <div className="text-sg-muted">
                              Standard <Money value={p.standardBonus} className="font-semibold text-sg-text" />
                              /mo
                            </div>
                            {p.minimumActive ? (
                              p.topUp > 0 ? (
                                <div className="text-soft-magenta">
                                  Top-up <Money value={p.topUp} className="font-semibold" />
                                </div>
                              ) : (
                                <div className="text-soft-green">Pool covers the minimum</div>
                              )
                            ) : (
                              <div className="text-sg-dim">Minimum ended</div>
                            )}
                            {p.minimumEndsThisMonth ? <div className="text-soft-yellow">Minimum ends this month</div> : null}
                            {p.noTeam ? <div className="text-soft-orange">No one on the ledger — top-up not paid</div> : null}
                          </div>
                        )}
                      </td>
                      <td className={cn(tdCls, "max-w-[220px] text-2xs")}>
                        {p.deferralPct > 0 ? (
                          <span className="text-soft-cyan" title={p.deferralReasons.join("\n")}>
                            {Math.round(p.deferralPct * 100)}% until {ini ? formatDate(deferralVestDate(ini), "short") : "—"} · {p.deferralReasons.join("; ")}
                          </span>
                        ) : (
                          <span className="text-sg-dim">None</span>
                        )}
                      </td>
                      <td className={cn(tdCls, "min-w-[190px] text-2xs")}>
                        <LedgerCell month={month} initiativeId={p.initiativeId} released={released} onOverride={() => setOverrideFor(p.initiativeId)} />
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="border-b border-sg-line bg-sg-bg/40">
                        <td colSpan={10} className="px-10 py-2">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-2xs uppercase tracking-[0.1em] text-sg-dim">
                                <th className="py-1 text-left font-semibold">Collected</th>
                                <th className="py-1 text-left font-semibold">Work period</th>
                                <th className="py-1 text-right font-semibold">Revenue</th>
                                <th className="py-1 text-right font-semibold">Net</th>
                                <th className="py-1 text-right font-semibold">Cumulative net</th>
                                <th className="py-1 text-right font-semibold">Cumulative pool</th>
                                <th className="py-1 text-right font-semibold">Payment pool</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pays.map((x) => (
                                <tr key={x.entry.id} className="border-t border-sg-line">
                                  <td className="py-1 text-sg-text">{formatDate(x.collectedAt, "medium")}</td>
                                  <td className="py-1 text-sg-muted">
                                    {formatDate(x.workStart, "short")} – {formatDate(x.workEnd, "short")}
                                    {x.entry.note ? <span className="text-sg-dim"> · {x.entry.note}</span> : null}
                                  </td>
                                  <td className="sg-num py-1 text-right">
                                    <Money value={x.revenue} />
                                  </td>
                                  <td className="sg-num py-1 text-right">
                                    <Money value={x.net} />
                                  </td>
                                  <td className="sg-num py-1 text-right">
                                    <Money value={x.cumNet} />
                                  </td>
                                  <td className="sg-num py-1 text-right">
                                    <Money value={x.cumPool} />
                                  </td>
                                  <td className="sg-num py-1 text-right font-semibold text-sg-white">
                                    <Money value={x.pool} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              <tr className="bg-sg-card-2/40 font-semibold">
                <td className={cn(tdCls, "text-sg-white")}>Total</td>
                <td className={tdNum}>
                  <Money value={sum("revenue")} />
                </td>
                <td className={tdNum}>
                  <Money value={sum("directCosts")} />
                </td>
                <td className={tdNum}>
                  <Money value={sum("tax")} />
                </td>
                <td className={cn(tdNum, "text-sg-white")}>
                  <Money value={sum("net")} />
                </td>
                <td className={tdCls} />
                <td className={cn(tdNum, "text-sg-white")}>
                  <Money value={sum("pool")} />
                </td>
                <td className={cn(tdCls, "text-2xs text-soft-magenta")}>{sum("topUp") > 0 ? <>Top-ups {formatIDR(sum("topUp"))}</> : null}</td>
                <td className={tdCls} />
                <td className={tdCls} />
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={Calculator} title={`No collections or Type C top-ups in ${monthLabel(month)}`}>
          Bonuses follow collected cash: a payment counts once the work is delivered and the client&apos;s money is in the bank by the {POLICY.cycle.cutoffDay}th (§8.1–8.2).
        </EmptyState>
      )}
      {unpaidMinimum.length ? (
        <div className="border-t border-sg-line px-4 py-3 text-xs text-sg-muted">
          <div className="sg-eyebrow mb-1 flex items-center">
            Type C minimum not paid this month <Cite s="8.6" />
          </div>
          {unpaidMinimum.map(({ ini }) => (
            <div key={ini.id} className="flex items-center gap-2 py-0.5">
              <span className="min-w-0 max-w-[320px]">
                <InitiativeLink id={ini.id} compact />
              </span>
              <span className="text-2xs text-sg-dim">no PRC-approved members on the Team Allocation Ledger yet, so the standard bonus cannot be shared (§6.5)</span>
            </div>
          ))}
        </div>
      ) : null}
      {awaiting.length ? (
        <div className="border-t border-sg-line p-4">
          <div className="sg-eyebrow mb-2 flex items-center gap-1.5">
            <Hourglass className="size-3" /> Earned, not yet collected — no bonus until the cash arrives (§8.1)
          </div>
          <ul className="divide-y divide-sg-line rounded-lg border border-sg-line">
            {awaiting.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1">
                  <InitiativeLink id={e.initiativeId} />
                </span>
                {e.note ? <span className="text-sg-dim">{e.note}</span> : null}
                <span className="text-sg-muted">
                  Revenue <Money value={e.revenue} className="font-semibold text-sg-white" />
                </span>
                <span className="text-sg-muted">
                  costs <Money value={e.directCosts} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {overrideFor ? <LedgerOverrideModal month={month} initiativeId={overrideFor} onClose={() => setOverrideFor(null)} /> : null}
    </Panel>
  );
}

/** §8.2 the Project Lead confirms the Team Allocation Ledger by the 22nd; Finance may record it with a reason. */
function LedgerCell({ month, initiativeId, released, onOverride }: { month: string; initiativeId: string; released: boolean; onOverride: () => void }) {
  const confirmations = useCrm((s) => s.ledgerConfirmations);
  const members = useCrm((s) => s.initiativeMembers);
  const confirmLedger = useCrm((s) => s.confirmLedger);
  const unconfirmLedger = useCrm((s) => s.unconfirmLedger);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const access = useAccess();
  const c = confirmations.find((x) => x.month === month && x.initiativeId === initiativeId);
  const leads = Array.from(new Set(members.filter((m) => m.initiativeId === initiativeId && m.roles.includes("project_lead") && !m.leftAt).map((m) => m.userId)));
  const isLead = leads.includes(access.userId);
  if (c)
    return (
      <div>
        <span className="flex items-center gap-1 text-soft-green">
          <CircleCheck className="size-3" /> {c.override ? "Recorded by Finance" : "Confirmed"} · {userMap.get(c.confirmedById)?.name ?? c.confirmedById}
        </span>
        <span className="block text-sg-dim">{formatDate(c.at, "datetime")}</span>
        {c.override ? <span className="block text-sg-muted">{c.override}</span> : null}
        {!released && (c.confirmedById === access.userId || access.certify) ? (
          <button type="button" className="text-sg-dim hover:text-sg-white" onClick={() => unconfirmLedger(c.id)}>
            Withdraw
          </button>
        ) : null}
      </div>
    );
  const overdue = Date.now() > Date.parse(provisionalDeadline(month));
  return (
    <div className="space-y-1">
      <span className={overdue ? "text-soft-orange" : "text-sg-muted"}>
        {overdue ? "Not confirmed — due " : "Due "}
        {formatDate(provisionalDeadline(month), "short")} · PL {leads.map((u) => userMap.get(u)?.name ?? u).join(", ") || "—"}
      </span>
      {!released && isLead ? (
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            confirmLedger(month, initiativeId);
            notify("Team Allocation Ledger confirmed for this cycle (§8.2)");
          }}
        >
          <UserCheck /> Confirm ledger
        </Button>
      ) : !released && access.certify ? (
        <Button size="xs" variant="ghost" onClick={onOverride}>
          Record for the PL…
        </Button>
      ) : null}
    </div>
  );
}

function LedgerOverrideModal({ month, initiativeId, onClose }: { month: string; initiativeId: string; onClose: () => void }) {
  const confirmLedger = useCrm((s) => s.confirmLedger);
  const notify = useUi((s) => s.notify);
  const [reason, setReason] = useState("");
  const submit = () => {
    if (reason.trim().length < 5) return;
    confirmLedger(month, initiativeId, reason);
    notify("Ledger confirmation recorded by Finance");
    onClose();
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Record the ledger confirmation"
      description={`${monthLabel(month)} · the Project Lead normally confirms the Team Allocation Ledger by the 22nd (§8.2)`}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={reason.trim().length < 5} onClick={submit}>
            Record confirmation
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <InitiativeLink id={initiativeId} />
        <Field label="Reason and evidence" hint="e.g. confirmed by e-mail on the 22nd while the PL was on site; the audit log records you as the person who entered it">
          <Textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            className="min-h-[64px]"
          />
        </Field>
      </div>
    </Modal>
  );
}

/* ───────────── lines ───────────── */

const STATUS_ORDER: LineStatus[] = ["payable", "partially_deferred", "carried_forward", "withheld_probation", "held", "forfeited", "ineligible"];
type SumKey = "gross" | "topUp" | "topUpDeducted" | "guaranteed" | "carriedIn" | "payable" | "deferred" | "withheld" | "held" | "forfeited" | "carriedOver";

function LinesPanel({ lines, totals, showIndividual, setShowIndividual, canSeeIndividual }: { lines: BonusLine[]; totals: BonusRun["totals"]; showIndividual: boolean; setShowIndividual: (v: boolean) => void; canSeeIndividual: boolean }) {
  const userMap = useUserMap();
  const groups = useMemo(() => {
    const m = new Map<string, BonusLine[]>();
    lines.forEach((l) => m.set(l.userId, [...(m.get(l.userId) ?? []), l]));
    return Array.from(m.entries()).sort((a, b) => (userMap.get(a[0])?.name ?? a[0]).localeCompare(userMap.get(b[0])?.name ?? b[0]));
  }, [lines, userMap]);

  const byStatus = useMemo(
    () =>
      STATUS_ORDER.map((st) => {
        const ls = lines.filter((l) => l.status === st);
        const s = (k: SumKey) => ls.reduce((a, l) => a + l[k], 0);
        return { status: st, lines: ls.length, people: new Set(ls.map((l) => l.userId)).size, gross: s("gross") + s("topUp"), payable: s("payable"), later: s("deferred") + s("carriedOver"), held: s("withheld") + s("held"), forfeited: s("forfeited") };
      }).filter((r) => r.lines > 0),
    [lines],
  );
  const grossTotal = lines.reduce((s, l) => s + l.gross + l.topUp, 0);

  return (
    <Panel
      title="Bonus lines"
      icon={Users}
      cite="6.6"
      subtitle={`${lines.length} line${lines.length === 1 ? "" : "s"} · ${groups.length} employee${groups.length === 1 ? "" : "s"} · B = E ÷ ΣE × pool`}
      bodyClassName="p-0"
      actions={
        !canSeeIndividual ? null : (
        <label className="flex cursor-pointer items-center gap-2 text-xs text-sg-muted">
          <input type="checkbox" checked={showIndividual} onChange={(e) => setShowIndividual(e.target.checked)} className="accent-sg-white" />
          Show individual amounts
          <span title="Individual amounts are confidential; balances are reported in aggregate (§9.6)">
            <Lock className="size-3.5" />
          </span>
        </label>
        )
      }
    >
      {!lines.length ? (
        <EmptyState icon={Coins} title="No bonus lines">
          Lines appear for members on the Team Allocation Ledger (signed, PRC-checked) during the work period of a collected payment, and for Type C top-ups.
        </EmptyState>
      ) : !showIndividual ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-sg-line">
                <th className={thCls}>Status</th>
                <th className={thRight}>Employees</th>
                <th className={thRight}>Lines</th>
                <th className={thRight}>Share + top-up</th>
                <th className={thRight}>Payable</th>
                <th className={thRight}>Deferred / carried</th>
                <th className={thRight}>Held</th>
                <th className={thRight}>Forfeited</th>
              </tr>
            </thead>
            <tbody>
              {byStatus.map((r) => (
                <tr key={r.status} className="border-b border-sg-line">
                  <td className={tdCls}>
                    <LineStatusChip status={r.status} />
                    <div className="mt-0.5 max-w-[360px] text-2xs text-sg-dim">{lineStatusMeta[r.status].hint}</div>
                  </td>
                  <td className={tdNum}>{r.people}</td>
                  <td className={tdNum}>{r.lines}</td>
                  <td className={tdNum}>
                    <Money value={r.gross} />
                  </td>
                  <td className={tdNum}>
                    <Money value={r.payable} />
                  </td>
                  <td className={tdNum}>
                    <Money value={r.later} />
                  </td>
                  <td className={tdNum}>
                    <Money value={r.held} />
                  </td>
                  <td className={tdNum}>
                    <Money value={r.forfeited} />
                  </td>
                </tr>
              ))}
              <tr className="bg-sg-card-2/40 font-semibold text-sg-white">
                <td className={tdCls} colSpan={3}>
                  Total
                </td>
                <td className={tdNum}>
                  <Money value={grossTotal} />
                </td>
                <td className={tdNum}>
                  <Money value={totals.payable} />
                </td>
                <td className={tdNum}>
                  <Money value={totals.deferred + totals.carriedOver} />
                </td>
                <td className={tdNum}>
                  <Money value={totals.withheld + totals.held} />
                </td>
                <td className={tdNum}>
                  <Money value={totals.forfeited} />
                </td>
              </tr>
            </tbody>
          </table>
          <p className="flex items-center gap-1.5 px-4 py-2 text-2xs text-sg-dim">
            <Info className="size-3" /> Aggregate view — the curve, rates and weights are published; individual amounts are confidential (§9.6).
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1880px] text-sm">
            <thead>
              <tr className="border-b border-sg-line">
                <th className={thCls}>Employee / project</th>
                <th className={thRight}>E ÷ ΣE</th>
                <th className={thRight}>Share</th>
                <th className={thRight}>Top-up</th>
                <th className={thRight}>Top-up deducted</th>
                <th className={thRight}>Guaranteed</th>
                <th className={thRight}>Carried in</th>
                <th className={thRight}>Payable</th>
                <th className={thRight}>Deferred</th>
                <th className={thRight}>Probation</th>
                <th className={thRight}>Held</th>
                <th className={thRight}>Forfeited</th>
                <th className={thRight}>Carried over</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([userId, ls]) => (
                <Fragment key={userId}>
                  <tr className="border-b border-sg-line bg-sg-card-2/30">
                    <td className={tdCls}>
                      <UserCell userId={userId} sub={userMap.get(userId)?.title} />
                    </td>
                    <td className={tdNum} />
                    {(["gross", "topUp", "topUpDeducted", "guaranteed", "carriedIn", "payable", "deferred", "withheld", "held", "forfeited", "carriedOver"] as SumKey[]).map((k) => (
                      <Sum key={k} ls={ls} k={k} />
                    ))}
                    <td className={tdCls} colSpan={2} />
                  </tr>
                  {ls.map((l) => (
                    <tr key={`${l.userId}-${l.initiativeId}`} className="border-b border-sg-line text-sg-muted">
                      <td className={cn(tdCls, "max-w-[260px] pl-10")}>
                        <InitiativeLink id={l.initiativeId} />
                      </td>
                      <td className={tdNum} title={`E = ${l.weightDays.toFixed(2)} weight-days of ΣE ${l.totalWeightDays.toFixed(2)} · effective weight ${l.weight.toFixed(2)} of ${l.totalWeight.toFixed(2)}`}>
                        {l.totalWeightDays > 0 ? `${((l.weightDays / l.totalWeightDays) * 100).toFixed(2)}%` : "—"}
                        <div className="text-2xs text-sg-dim">W×A {l.weight.toFixed(2)}</div>
                      </td>
                      <Cell v={l.gross} />
                      <Cell v={l.topUp} />
                      <Cell v={-l.topUpDeducted} />
                      <Cell v={l.guaranteed} />
                      <Cell v={l.carriedIn} />
                      <Cell v={l.payable} strong />
                      <Cell v={l.deferred} />
                      <Cell v={l.withheld} />
                      <Cell v={l.held} />
                      <Cell v={l.forfeited} />
                      <Cell v={l.carriedOver} />
                      <td className={tdCls}>
                        <LineStatusChip status={l.status} />
                      </td>
                      <td className={cn(tdCls, "max-w-[260px]")}>
                        {l.notes.length ? (
                          <span title={l.notes.join("\n")} className="flex cursor-help items-start gap-1 text-2xs text-sg-dim">
                            <Info className="mt-0.5 size-3 shrink-0" />
                            <span className="line-clamp-3">{l.notes.join(" · ")}</span>
                          </span>
                        ) : (
                          <span className="text-2xs text-sg-dim">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr className="bg-sg-card-2/40 font-semibold text-sg-white">
                <td className={tdCls} colSpan={2}>
                  Totals
                </td>
                <TotalCell v={lines.reduce((s, l) => s + l.gross, 0)} />
                <TotalCell v={totals.topUps} />
                <TotalCell v={-totals.topUpDeducted} />
                <TotalCell v={lines.reduce((s, l) => s + l.guaranteed, 0)} />
                <TotalCell v={totals.carriedIn} />
                <TotalCell v={totals.payable} />
                <TotalCell v={totals.deferred} />
                <TotalCell v={totals.withheld} />
                <TotalCell v={totals.held} />
                <TotalCell v={totals.forfeited} />
                <TotalCell v={totals.carriedOver} />
                <td className={tdCls} colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Sum({ ls, k }: { ls: BonusLine[]; k: SumKey }) {
  const raw = ls.reduce((s, l) => s + l[k], 0);
  const v = k === "topUpDeducted" ? -raw : raw;
  return <td className={cn(tdNum, "font-semibold", v ? "text-sg-white" : "text-sg-dim")}>{v ? <ExactMoney value={v} /> : "—"}</td>;
}

function Cell({ v, strong }: { v: number; strong?: boolean }) {
  return <td className={cn(tdNum, v ? (strong ? "font-semibold text-sg-white" : "text-sg-text") : "text-sg-dim")}>{v ? <ExactMoney value={v} /> : "—"}</td>;
}

function TotalCell({ v }: { v: number }) {
  return <td className={tdNum}>{v ? <ExactMoney value={v} /> : "—"}</td>;
}

/* ───────────── payroll & accrual exports ───────────── */

interface ExportRow {
  line: BonusLine;
  name: string;
  email: string;
  code: string;
}

/** One payroll row per employee for the cycle (§8.5): project lines plus deferred releases, probation bonuses and recoveries. */
interface PayrollRow {
  userId: string;
  name: string;
  email: string;
  employeeNumber: string;
  npwp: string;
  ptkp: string;
  projectBonus: number;
  deferredRelease: number;
  probationBonus: number;
  recovery: number; // ≤ 0
  gross: number;
  pph: { withheld: number; net: number } | null;
  split: string;
  notes: string[];
}

function ExportsPanel({ run }: { run: BonusRun | undefined }) {
  const users = useCrm((s) => s.users);
  const initiatives = useCrm((s) => s.initiatives);
  const profiles = useCrm((s) => s.employeeProfiles);
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const outcomes = useCrm((s) => s.probationOutcomes);
  const deferredBonuses = useCrm((s) => s.deferredBonuses);
  const recoveryDeductions = useCrm((s) => s.recoveryDeductions);
  const auditLog = useCrm((s) => s.auditLog);
  const notify = useUi((s) => s.notify);
  const access = useAccess();

  const rows = useMemo<ExportRow[]>(() => {
    if (!run) return [];
    return run.lines
      .map((line) => {
        const u = users.find((x) => x.id === line.userId);
        const ini = initiatives.find((i) => i.id === line.initiativeId);
        return { line, name: u?.name ?? line.userId, email: u?.email ?? "", code: codeOf(ini, line.initiativeId) };
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
  }, [run, users, initiatives]);

  const payroll = useMemo<PayrollRow[]>(() => {
    if (!run) return [];
    const extras = payrollExtras(run.month, { deferredBonuses, probationOutcomes: outcomes, recoveryDeductions, auditLog });
    const ids = Array.from(new Set([...run.lines.filter((l) => l.payable > 0).map((l) => l.userId), ...extras.map((e) => e.userId)]));
    return ids
      .map((userId) => {
        const u = users.find((x) => x.id === userId);
        const p = profiles.find((x) => x.userId === userId);
        const mine = run.lines.filter((l) => l.userId === userId && l.payable > 0);
        const ex = extras.filter((e) => e.userId === userId);
        const projectBonus = mine.reduce((s, l) => s + Math.floor(l.payable), 0);
        const deferredRelease = ex.filter((e) => e.kind === "deferred_release").reduce((s, e) => s + e.amount, 0);
        const probationBonus = ex.filter((e) => e.kind === "probation_completion" || e.kind === "probation_final_pay").reduce((s, e) => s + e.amount, 0);
        const due = projectBonus + deferredRelease + probationBonus;
        const wanted = -ex.filter((e) => e.kind === "clawback_recovery").reduce((s, e) => s + e.amount, 0);
        const recovery = -Math.min(due, wanted);
        const pphs = mine.map(pph21Of);
        const pph = pphs.length && pphs.every((x) => x) ? { withheld: pphs.reduce((s, x) => s + x!.withheld, 0), net: due + recovery - pphs.reduce((s, x) => s + x!.withheld, 0) } : null;
        const split = [
          ...mine.map((l) => `${codeOf(initiatives.find((i) => i.id === l.initiativeId), l.initiativeId)}:${Math.floor(l.payable)}`),
          ...ex.filter((e) => e.kind === "deferred_release").map((e) => `${codeOf(initiatives.find((i) => i.id === e.initiativeId), e.initiativeId ?? "")}/deferred:${e.amount}`),
        ].join("; ");
        const notes = [...ex.map((e) => e.label), ...(wanted > -recovery ? [`Recovery capped at the bonus due — ${wanted + recovery} carried to a later cycle`] : [])];
        return { userId, name: u?.name ?? userId, email: u?.email ?? "", employeeNumber: p?.employeeNumber ?? "", npwp: p?.npwp ?? "", ptkp: p?.ptkpStatus ?? "", projectBonus, deferredRelease, probationBonus, recovery, gross: due + recovery, pph, split, notes };
      })
      .filter((r) => r.gross > 0 || r.recovery < 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [run, users, profiles, deferredBonuses, outcomes, recoveryDeductions, auditLog, initiatives]);

  if (!run) return null;
  const ready = run.status === "certified" || run.status === "released";
  const final = run.status === "released";
  const salaryDate = csvDate(paymentDate(run.month));
  const probation = rows.filter((r) => r.line.withheld > 0);
  const deferred = rows.filter((r) => r.line.deferred > 0);
  const counted = bonusRuns.filter((r) => r.month <= run.month);
  const settled = (userId: string) => outcomes.filter((o) => o.userId === userId).reduce((s, o) => s + o.amount, 0);
  const hasPph = payroll.some((r) => r.pph);
  const missingIds = payroll.filter((r) => !r.employeeNumber || !r.npwp).length;

  const payrollCols: CsvColumn<PayrollRow>[] = [
    { header: "Status", value: () => (final ? "FINAL — released by PRC" : "DRAFT — certified, not yet released") },
    { header: "Employee number", value: (r) => r.employeeNumber },
    { header: "Employee", value: (r) => r.name },
    { header: "Email", value: (r) => r.email },
    { header: "NPWP", value: (r) => r.npwp },
    { header: "PTKP", value: (r) => r.ptkp },
    { header: "Cycle", value: () => run.month },
    { header: "Salary date", value: () => salaryDate },
    { header: "Component", value: () => "PROJECT_BONUS (irregular income, PPh 21)" },
    { header: "Project bonus (IDR)", value: (r) => r.projectBonus },
    { header: "Deferred release (IDR)", value: (r) => r.deferredRelease },
    { header: "Probation bonus (IDR)", value: (r) => r.probationBonus },
    { header: "Clawback recovery (IDR)", value: (r) => r.recovery },
    { header: "Gross bonus payable (IDR)", value: (r) => r.gross },
    ...(hasPph
      ? ([
          { header: "PPh 21 withheld — estimate (IDR)", value: (r) => (r.pph ? r.pph.withheld : "") },
          { header: "Net bonus — estimate (IDR)", value: (r) => (r.pph ? r.pph.net : "") },
        ] as CsvColumn<PayrollRow>[])
      : []),
    { header: "Cost centres (project:amount)", value: (r) => r.split },
    { header: "Notes", value: (r) => r.notes.join(" · ") },
  ];
  const probationCols: CsvColumn<ExportRow>[] = [
    { header: "Employee", value: (r) => r.name },
    { header: "Email", value: (r) => r.email },
    { header: "Month", value: () => run.month },
    { header: "Project code", value: (r) => r.code },
    { header: "Held this month (IDR)", value: (r) => Math.floor(r.line.withheld) },
    { header: "Cumulative balance held (IDR)", value: (r) => Math.max(0, Math.floor(probationBalance(r.line.userId, counted) - settled(r.line.userId))) },
    { header: "Expected probation end", value: (r) => csvDate(profiles.find((p) => p.userId === r.line.userId)?.probationEndDate) },
  ];
  const deferredCols: CsvColumn<ExportRow>[] = [
    { header: "Employee", value: (r) => r.name },
    { header: "Email", value: (r) => r.email },
    { header: "Month", value: () => run.month },
    { header: "Project code", value: (r) => r.code },
    { header: "Deferred (IDR)", value: (r) => Math.floor(r.line.deferred) },
    {
      header: "Vests (6-12 months after close)",
      value: (r) => {
        const ini = initiatives.find((i) => i.id === r.line.initiativeId);
        return ini ? csvDate(deferralVestDate(ini)) : "";
      },
    },
    { header: "Project closed", value: (r) => (initiatives.find((i) => i.id === r.line.initiativeId)?.completedAt ? "yes" : "no — estimated from the contracted end") },
  ];

  const tag = final ? "released" : "DRAFT";
  const exp = <T,>(kind: string, list: T[], cols: CsvColumn<T>[]) => {
    const file = `${kind}-${run.month}-${tag}.csv`;
    downloadCsv(file, list, cols);
    notify(`${list.length} row${list.length === 1 ? "" : "s"} exported · ${file}`);
  };

  return (
    <Panel title="Payroll & accrual exports" icon={Wallet} cite="8.5" subtitle={ready ? `${runStatusMeta[run.status].label} · salary ${formatDate(paymentDate(run.month), "medium")}` : "available once certified"}>
      {!ready ? (
        <p className="flex items-center gap-1.5 text-xs text-sg-muted">
          <CalendarClock className="size-3.5" /> Payroll, probation-accrual and deferred exports unlock once the CFO certifies this month&apos;s checks; the payroll file is final once the PRC releases the run.
        </p>
      ) : (
        <div className="space-y-3">
          {payroll.length ? (
            <div className="overflow-x-auto rounded-lg border border-sg-line">
              <table className="w-full min-w-[980px] text-xs">
                <thead>
                  <tr className="border-b border-sg-line">
                    <th className={thCls}>Employee</th>
                    <th className={thRight}>Project bonus</th>
                    <th className={thRight}>Deferred release</th>
                    <th className={thRight}>Probation bonus</th>
                    <th className={thRight}>Recovery</th>
                    <th className={thRight}>Gross payable</th>
                    {hasPph ? <th className={thRight}>PPh 21 est.</th> : null}
                    {hasPph ? <th className={thRight}>Net est.</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {payroll.map((r) => (
                    <tr key={r.userId} className="border-b border-sg-line last:border-b-0">
                      <td className={tdCls}>
                        <UserCell userId={r.userId} sub={[r.employeeNumber || "no employee no.", r.npwp ? `NPWP ${r.npwp}` : "no NPWP"].join(" · ")} />
                      </td>
                      <td className={tdNum}>{r.projectBonus ? exactIdr(r.projectBonus) : "—"}</td>
                      <td className={tdNum}>{r.deferredRelease ? exactIdr(r.deferredRelease) : "—"}</td>
                      <td className={tdNum}>{r.probationBonus ? exactIdr(r.probationBonus) : "—"}</td>
                      <td className={cn(tdNum, r.recovery ? "text-soft-red" : "")}>{r.recovery ? exactIdr(r.recovery) : "—"}</td>
                      <td className={cn(tdNum, "font-semibold text-sg-white")}>{exactIdr(r.gross)}</td>
                      {hasPph ? <td className={tdNum}>{r.pph ? exactIdr(r.pph.withheld) : "—"}</td> : null}
                      {hasPph ? <td className={cn(tdNum, "text-soft-green")}>{r.pph ? exactIdr(r.pph.net) : "—"}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-sg-muted">Nothing payable with this salary.</p>
          )}
          {access.certify ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant={final ? "primary" : "outline"} disabled={!payroll.length} onClick={() => exp("payroll", payroll, payrollCols)}>
                <Download /> {final ? "Export payroll CSV" : "Export DRAFT payroll"} <span className="sg-num text-2xs opacity-70">{payroll.length}</span>
              </Button>
              <Button size="sm" variant="outline" disabled={!probation.length} onClick={() => exp("probation-accrual", probation, probationCols)}>
                <Download /> Probation accrual <span className="sg-num text-2xs opacity-70">{probation.length}</span>
              </Button>
              <Button size="sm" variant="outline" disabled={!deferred.length} onClick={() => exp("deferred", deferred, deferredCols)}>
                <Download /> Deferred <span className="sg-num text-2xs opacity-70">{deferred.length}</span>
              </Button>
            </div>
          ) : (
            <RoleNote>Finance exports the payroll files (§13.2).</RoleNote>
          )}
          <p className="text-2xs text-sg-dim">
            One row per employee: project lines, deferred releases and Probation Completion Bonuses paid with this salary, less any §9.4 recovery netted in payroll. Amounts are gross, rounded down to whole rupiah; payroll withholds PPh 21 <Cite s="8.5" />
            {hasPph ? " — the PPh 21 and net columns are estimates (TER), payroll's figure is final" : ""}.{!final ? " The run is certified but not released — the file is marked DRAFT and must not be paid." : ""}
            {missingIds ? ` ${missingIds} employee${missingIds === 1 ? "" : "s"} without an employee number or NPWP — HR completes the record on /people.` : ""} The files contain confidential individual amounts (§13.4).
          </p>
        </div>
      )}
    </Panel>
  );
}
