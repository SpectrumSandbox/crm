"use client";

/* §6.1 monthly bonus run: inputs, break-even test, project pools, bonus lines, CFO/PRC workflow. */
import { Fragment, useMemo, useState } from "react";
import {
  BadgeCheck,
  Ban,
  Calculator,
  CalendarClock,
  CircleCheck,
  CircleX,
  Coins,
  Hourglass,
  Info,
  Landmark,
  Lock,
  RotateCcw,
  Scale,
  Send,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { BonusLine, BonusRun, LineStatus, ProjectType } from "@/lib/initiatives/types";
import { breakEvenDeadline, computeRun, monthStart, paidInYear, paymentDate, shareInForce, type RunResult } from "@/lib/initiatives/engine";
import { POLICY, PROJECT_TYPE_META } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Chip, EmptyState } from "@/components/ui/misc";
import { Cite, Metric, Money, Pct, TypeChip } from "@/components/initiatives/shared";
import {
  Callout,
  DEFAULT_EBITDA,
  DEFAULT_OVERHEADS,
  InitiativeLink,
  LineStatusChip,
  Panel,
  UserCell,
  dueText,
  lineStatusMeta,
  monthLabel,
  pctLabel,
  runStatusMeta,
  tdCls,
  tdNum,
  thCls,
  thRight,
  useInitiativeMap,
} from "./common";

const TYPES: ProjectType[] = ["A", "B", "C"];
const CFO_ID = "u-maria";

type Overrides = Partial<Record<ProjectType, number>>;

function sameOverrides(a: Overrides, b: Overrides) {
  return TYPES.every((t) => (a[t] ?? null) === (b[t] ?? null));
}

export function MonthlyRunTab({ month }: { month: string }) {
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const entries = useCrm((s) => s.revenueEntries);
  const profiles = useCrm((s) => s.employeeProfiles);
  const adjustments = useCrm((s) => s.shareAdjustments);
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const deferredBonuses = useCrm((s) => s.deferredBonuses);
  const recordRun = useCrm((s) => s.recordRun);
  const releaseRun = useCrm((s) => s.releaseRun);
  const notify = useUi((s) => s.notify);
  const currentUserId = useCrm((s) => s.currentUserId);
  const userMap = useUserMap();

  const run = bonusRuns.find((r) => r.month === month);
  const released = run?.status === "released";

  const [overheads, setOverheads] = useState<number>(run?.overheads ?? DEFAULT_OVERHEADS);
  const [ebitda, setEbitda] = useState<number>(run?.ebitda ?? DEFAULT_EBITDA);
  const [overrides, setOverrides] = useState<Overrides>(run?.shareOverrides ?? {});
  const [partialPct, setPartialPct] = useState<number>(run?.partialDeferralPct ?? 0);
  const [showIndividual, setShowIndividual] = useState(false);

  // released runs are read-only: always evaluate with the stored inputs
  const inp = released && run ? { overheads: run.overheads, ebitda: run.ebitda, overrides: run.shareOverrides, partialPct: run.partialDeferralPct } : { overheads, ebitda, overrides, partialPct };

  const year = month.slice(0, 4);
  const paidYtd = useMemo(() => {
    const others = bonusRuns.filter((r) => r.month !== month);
    const ids = new Set<string>([...profiles.map((p) => p.userId), ...members.map((m) => m.userId)]);
    const m = new Map<string, number>();
    ids.forEach((id) => m.set(id, paidInYear(id, others, year, deferredBonuses)));
    return m;
  }, [bonusRuns, deferredBonuses, profiles, members, month, year]);

  const result = useMemo(
    () =>
      computeRun({
        month,
        initiatives,
        members,
        entries,
        profiles,
        adjustments,
        overheads: inp.overheads,
        ebitda: inp.ebitda,
        shareOverrides: inp.overrides,
        partialDeferralPct: inp.partialPct,
        paidYtd,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [month, initiatives, members, entries, profiles, adjustments, inp.overheads, inp.ebitda, inp.overrides, inp.partialPct, paidYtd],
  );

  // the engine already treats a §6.1 partial deferral as not released this month; shown as its own formula row
  const carriedFromPool = inp.partialPct > 0 ? (result.totals.pool * inp.partialPct) / 100 : 0;
  const effectiveResult = result.operatingResult;
  const passed = result.passed;

  const lines: BonusLine[] = released && run ? run.lines : result.lines;
  const totals: BonusRun["totals"] = released && run ? run.totals : result.totals;
  const headlineResult = released && run ? run.operatingResult : effectiveResult;

  const dirty =
    !!run &&
    !released &&
    (run.overheads !== overheads || run.ebitda !== ebitda || run.partialDeferralPct !== partialPct || !sameOverrides(run.shareOverrides, overrides) || Math.abs(run.operatingResult - effectiveResult) > 1 || Math.abs(run.totals.payable - result.totals.payable) > 1);

  const awaiting = useMemo(() => entries.filter((e) => e.month === month && e.basis === "milestone" && !e.received), [entries, month]);

  const inputsForRecord = { overheads, ebitda, shareOverrides: overrides, partialDeferralPct: partialPct };
  const resultForRecord: RunResult = { ...result, operatingResult: effectiveResult, passed };

  const save = (status: "draft" | "failed" | "certified") => {
    recordRun(resultForRecord, inputsForRecord, status);
    notify(status === "certified" ? `Break-even certified for ${monthLabel(month)} — awaiting PRC release` : status === "failed" ? `Failed break-even test recorded for ${monthLabel(month)}` : `Draft saved for ${monthLabel(month)}`);
  };

  const deadline = breakEvenDeadline(month);
  const pay = paymentDate(month);
  const status = run?.status ?? "none";
  const poolCapBase = Math.min(Math.max(0, inp.ebitda) * POLICY.poolCapEbitdaPct, POLICY.poolCapAbsolute);
  const shareDefaults = useMemo(() => Object.fromEntries(TYPES.map((t) => [t, shareInForce(t, adjustments, monthStart(month))])) as Record<ProjectType, number>, [adjustments, month]);

  return (
    <div className="space-y-4">
      {/* status strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-sg-line bg-sg-card px-4 py-3">
        <div>
          <div className="sg-eyebrow">Run status</div>
          <div className="mt-1">
            <Chip color={runStatusMeta[status].color} dot>
              {runStatusMeta[status].label}
            </Chip>
          </div>
        </div>
        <Metric label="Break-even deadline" value={formatDate(deadline, "medium")} hint={<span className={cn(Date.parse(deadline) < Date.now() && !run?.certifiedAt ? "text-soft-orange" : "")}>{run?.certifiedAt ? `certified ${formatDate(run.certifiedAt, "short")}` : dueText(deadline)}</span>} />
        <Metric label="Payment date" value={formatDate(pay, "medium")} hint="5th of the following month" />
        <Metric label="Planned pool" value={formatIDR(totals.pool)} hint={`${result.projects.length} project${result.projects.length === 1 ? "" : "s"} with revenue`} />
        <Metric label="Payable now" value={formatIDR(totals.payable)} tone={totals.payable > 0 ? "green" : undefined} />
        <Metric label="Deferred + carried" value={formatIDR(totals.deferred + totals.carriedOver)} tone={totals.deferred + totals.carriedOver > 0 ? "yellow" : undefined} />
        <Metric label="Withheld / held" value={formatIDR(totals.withheld + totals.held)} tone={totals.withheld + totals.held > 0 ? "orange" : undefined} />
      </div>

      {released && run ? (
        <Callout tone="ok">
          <span className="font-semibold">Released — read-only.</span> Certified by {userMap.get(run.certifiedById ?? "")?.name ?? "—"} {run.certifiedAt ? `on ${formatDate(run.certifiedAt, "datetime")}` : ""}; release authorised by {userMap.get(run.releasedById ?? "")?.name ?? "—"} {run.releasedAt ? `on ${formatDate(run.releasedAt, "datetime")}` : ""}. Bonus lines and totals below are the stored snapshot; project figures are recomputed from current revenue entries with the stored inputs.
        </Callout>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        {/* inputs */}
        <Panel title="Inputs" icon={SlidersHorizontal} cite="6.1">
          <div className="space-y-4">
            <Field label="Monthly overheads (IDR)" hint={formatIDR(inp.overheads, "full")}>
              <Input type="number" min={0} step={1_000_000} value={inp.overheads} disabled={released} onChange={(e) => setOverheads(Math.max(0, Number(e.target.value) || 0))} className="sg-num" />
            </Field>
            <Field label="Company monthly EBITDA (IDR)" hint={`${formatIDR(inp.ebitda, "full")} · per-project pool cap ${formatIDR(poolCapBase)} = min(5% EBITDA, US$500k) (§6.2)`}>
              <Input type="number" min={0} step={10_000_000} value={inp.ebitda} disabled={released} onChange={(e) => setEbitda(Math.max(0, Number(e.target.value) || 0))} className="sg-num" />
            </Field>

            <div className="border-t border-sg-line pt-3">
              <div className="sg-eyebrow mb-2 flex items-center">
                Corrective controls <Cite s="6.1" /> <Cite s="6.6" />
              </div>
              <div className="space-y-3">
                {TYPES.map((t) => {
                  const [min, max] = PROJECT_TYPE_META[t].range;
                  const override = inp.overrides[t];
                  const value = override ?? shareDefaults[t];
                  return (
                    <div key={t}>
                      <div className="mb-1 flex items-center gap-2 text-xs">
                        <TypeChip type={t} />
                        <span className={cn("sg-num ml-auto font-semibold", override != null ? "text-soft-yellow" : "text-sg-white")}>{pctLabel(value)}</span>
                        {override != null && !released ? (
                          <button type="button" title="Reset to the share in force (projects keep their locked share)" onClick={() => setOverrides((o) => ({ ...o, [t]: undefined }))} className="text-sg-dim hover:text-sg-white">
                            <RotateCcw className="size-3.5" />
                          </button>
                        ) : null}
                      </div>
                      <input
                        type="range"
                        min={Math.round(min * 100)}
                        max={Math.round(max * 100)}
                        step={1}
                        value={Math.round(value * 100)}
                        disabled={released}
                        onChange={(e) => setOverrides((o) => ({ ...o, [t]: Number(e.target.value) / 100 }))}
                        className="w-full accent-sg-white disabled:opacity-50"
                        aria-label={`Type ${t} revenue share override`}
                      />
                      <div className="flex justify-between text-2xs text-sg-dim">
                        <span>min {pctLabel(min)}</span>
                        <span>{override != null ? "override for this run" : `in force ${pctLabel(shareDefaults[t])} · locked shares apply`}</span>
                        <span>max {pctLabel(max)}</span>
                      </div>
                    </div>
                  );
                })}
                <Field label="Partial deferral to next month (%)" hint="§6.1 option 2 — part of every payable line is carried to next month if results improve">
                  <div className="flex items-center gap-3">
                    <input type="range" min={0} max={100} step={1} value={inp.partialPct} disabled={released} onChange={(e) => setPartialPct(Number(e.target.value))} className="w-full accent-sg-white disabled:opacity-50" aria-label="Partial deferral percentage" />
                    <Input type="number" min={0} max={100} value={inp.partialPct} disabled={released} onChange={(e) => setPartialPct(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} className="sg-num w-16 text-right" />
                  </div>
                </Field>
              </div>
            </div>
          </div>
        </Panel>

        {/* break-even */}
        <Panel title="Break-even test" icon={Scale} cite="6.1" subtitle={`${monthLabel(month)} · CFO certifies by the 25th`}>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div>
              <p className="mb-2 font-mono text-2xs text-sg-muted">Operating Result = Σ net project revenue − Σ direct project costs − monthly overheads − planned bonus pool</p>
              <table className="w-full text-sm">
                <tbody>
                  <FormulaRow label="Recognised project revenue" value={result.revenue} />
                  <FormulaRow label="− Estimated taxes (22% on project profit)" value={-result.taxes} cite="3.4" />
                  <FormulaRow label="= Σ net project revenue" value={result.revenue - result.taxes} strong />
                  <FormulaRow label="− Σ direct project costs" value={-result.directCosts} />
                  <FormulaRow label="− Monthly overheads" value={-inp.overheads} />
                  <FormulaRow label="− Planned bonus pool" value={-result.totals.pool} cite="6.2" />
                  {carriedFromPool > 0 ? <FormulaRow label={`+ Pool carried to next month (${inp.partialPct}% × pool)`} value={carriedFromPool} cite="6.1" /> : null}
                  <tr className="border-t border-sg-line-2">
                    <td className="py-2 font-display font-extrabold text-sg-white">Operating result</td>
                    <td className={cn("sg-num py-2 text-right font-display text-base font-extrabold", headlineResult >= 0 ? "text-soft-green" : "text-soft-red")} title={formatIDR(headlineResult, "full")}>
                      {formatIDR(headlineResult)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-2 text-2xs leading-relaxed text-sg-dim">
                Interpretation: the policy&apos;s &ldquo;net project revenue&rdquo; is taken as recognised revenue less estimated taxes, so direct costs are subtracted once (not twice). Milestone revenue counts only once the payment is received (§4.4). When a partial deferral is applied, the carried-over share of the pool is not released this month and so is excluded from the test.
              </p>
            </div>
            <div className={cn("flex flex-col items-center justify-center rounded-xl border px-4 py-5 text-center", (released ? (run?.operatingResult ?? 0) >= 0 : passed) ? "border-soft-green/40 bg-soft-green/10" : "border-soft-red/40 bg-soft-red/10")}>
              {(released ? (run?.operatingResult ?? 0) >= 0 : passed) ? <CircleCheck className="size-8 text-soft-green" /> : <CircleX className="size-8 text-soft-red" />}
              <div className={cn("mt-1 font-display text-3xl font-extrabold tracking-tight", (released ? (run?.operatingResult ?? 0) >= 0 : passed) ? "text-soft-green" : "text-soft-red")}>{(released ? (run?.operatingResult ?? 0) >= 0 : passed) ? "PASS" : "FAIL"}</div>
              <div className="mt-1 flex items-center gap-1 text-2xs text-sg-muted">
                <CalendarClock className="size-3" /> Deadline {formatDate(deadline, "short")} · {dueText(deadline)}
              </div>
            </div>
          </div>

          {!released && !passed ? (
            <div className="mt-4 space-y-2">
              <Callout tone="danger">
                <span className="font-semibold">No bonus is earned or payable until the test passes and PRC authorises release.</span> The shortfall is {formatIDR(-effectiveResult, "full")}. Corrective action <Cite s="6.1" />:
              </Callout>
              {result.suggestion?.kind === "reduce_share" ? (
                <div className="rounded-lg border border-sg-line bg-sg-card-2/50 p-3">
                  <div className="mb-2 text-xs font-semibold text-sg-white">Option 1 · reduce revenue share percentages (within §6.6 ranges)</div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    {TYPES.filter((t) => result.suggestion?.kind === "reduce_share" && result.suggestion.overrides[t] != null).map((t) => (
                      <span key={t} className="flex items-center gap-1.5">
                        <TypeChip type={t} />
                        <span className="sg-num text-sg-muted">{pctLabel(inp.overrides[t] ?? shareDefaults[t])}</span>→
                        <span className="sg-num font-semibold text-soft-yellow">{pctLabel((result.suggestion as { overrides: Overrides }).overrides[t]!)}</span>
                      </span>
                    ))}
                    <span className="text-sg-muted">
                      → operating result <span className={cn("sg-num font-semibold", result.suggestion.operatingResult >= 0 ? "text-soft-green" : "text-soft-red")}>{formatIDR(result.suggestion.operatingResult)}</span>
                    </span>
                    <Button
                      size="xs"
                      variant="primary"
                      className="ml-auto"
                      onClick={() => {
                        if (result.suggestion?.kind === "reduce_share") setOverrides({ ...result.suggestion.overrides });
                        notify("Proposed share overrides applied");
                      }}
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              ) : result.suggestion?.kind === "partial_deferral" ? (
                <div className="rounded-lg border border-sg-line bg-sg-card-2/50 p-3">
                  <div className="mb-2 text-xs font-semibold text-sg-white">Option 2 · partial deferral — even the 10% floor share cannot close the gap</div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-sg-muted">
                    Carry <span className="sg-num font-semibold text-soft-yellow">{result.suggestion.pct}%</span> of the pool to next month → operating result{" "}
                    <span className={cn("sg-num font-semibold", result.suggestion.operatingResult >= 0 ? "text-soft-green" : "text-soft-red")}>{formatIDR(result.suggestion.operatingResult)}</span>
                    <Button
                      size="xs"
                      variant="primary"
                      className="ml-auto"
                      onClick={() => {
                        if (result.suggestion?.kind === "partial_deferral") setPartialPct(result.suggestion.pct);
                        notify("Partial deferral applied");
                      }}
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              ) : (
                <Callout>{result.totals.pool > 0 ? "Adjust the corrective controls on the left until the test passes." : "There is no planned bonus pool to reduce — the shortfall comes from overheads and costs, so no bonuses are payable this month. Record the failed test."}</Callout>
              )}
            </div>
          ) : null}

          {/* workflow */}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-sg-line pt-4">
            {released ? (
              <span className="flex items-center gap-1.5 text-xs text-sg-muted">
                <Lock className="size-3.5" /> Run released {run?.releasedAt ? formatDate(run.releasedAt, "datetime") : ""} — payment {formatDate(pay, "medium")}
              </span>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => save("draft")}>
                  Save draft
                </Button>
                {passed ? (
                  <Button variant="primary" size="sm" onClick={() => save("certified")} title={`Recorded by ${userMap.get(currentUserId)?.name ?? "current user"} on behalf of ${userMap.get(CFO_ID)?.name ?? "the CFO"}`}>
                    <BadgeCheck /> Certify break-even (CFO)
                  </Button>
                ) : (
                  <>
                    <Button variant="primary" size="sm" disabled title="The break-even test must pass before the CFO can certify">
                      <BadgeCheck /> Certify break-even (CFO)
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => save("failed")}>
                      <Ban /> Record failed test
                    </Button>
                  </>
                )}
                {run?.status === "certified" ? (
                  <Button
                    variant="pill"
                    size="sm"
                    disabled={dirty}
                    onClick={() => {
                      releaseRun(run.id);
                      notify(`PRC authorised release for ${monthLabel(month)} — payment ${formatDate(pay, "medium")}`);
                    }}
                  >
                    <Send /> Authorise release (PRC)
                  </Button>
                ) : null}
                <span className="ml-auto text-2xs text-sg-dim">
                  CFO: {userMap.get(CFO_ID)?.name ?? "Maria Gunadi"} · recorded by {userMap.get(currentUserId)?.name ?? "you"} (PRC chair) — audit-logged
                </span>
              </>
            )}
          </div>
          {!released && !passed ? <p className="mt-2 text-2xs text-sg-dim">Certification is blocked because the operating result is negative — apply a corrective action or record the failed test.</p> : null}
          {run?.status === "certified" && dirty ? <Callout tone="warn" className="mt-2">Inputs or results changed since the CFO certified on {formatDate(run.certifiedAt, "datetime")}. Re-certify before PRC can authorise release.</Callout> : null}
          {run?.status === "certified" && !dirty ? (
            <p className="mt-2 text-2xs text-sg-muted">
              Certified by {userMap.get(run.certifiedById ?? "")?.name ?? "—"} on {formatDate(run.certifiedAt, "datetime")}. Releasing creates deferred-ledger entries for §6.3 deferrals and §6.1 carry-overs.
            </p>
          ) : null}
        </Panel>
      </div>

      <ProjectsTable result={result} month={month} awaiting={awaiting} />

      <LinesPanel lines={lines} totals={totals} showIndividual={showIndividual} setShowIndividual={setShowIndividual} />
    </div>
  );
}

function FormulaRow({ label, value, strong, cite }: { label: string; value: number; strong?: boolean; cite?: string }) {
  return (
    <tr className={cn(strong && "border-t border-sg-line")}>
      <td className={cn("py-1 text-xs", strong ? "font-semibold text-sg-white" : "text-sg-muted")}>
        {label}
        {cite ? <Cite s={cite} /> : null}
      </td>
      <td className={cn("sg-num py-1 text-right text-xs", strong ? "font-semibold text-sg-white" : value < 0 ? "text-sg-text" : "text-sg-white")} title={formatIDR(value, "full")}>
        {formatIDR(value)}
      </td>
    </tr>
  );
}

function ProjectsTable({ result, month, awaiting }: { result: RunResult; month: string; awaiting: { id: string; initiativeId: string; revenue: number; directCosts: number; note: string }[] }) {
  const iniMap = useInitiativeMap();
  return (
    <Panel title="Project pools" icon={Landmark} cite="6.2" subtitle="B = W / ΣW × R × P, capped per project" bodyClassName="p-0">
      {result.projects.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead>
              <tr className="border-b border-sg-line">
                <th className={thCls}>Project</th>
                <th className={thCls}>Type</th>
                <th className={thRight}>Revenue</th>
                <th className={thRight}>Direct costs</th>
                <th className={thRight}>Tax</th>
                <th className={thRight}>Net revenue P</th>
                <th className={thRight}>Share R</th>
                <th className={thRight}>Raw pool</th>
                <th className={thRight}>Cap</th>
                <th className={thRight}>Pool</th>
                <th className={thCls}>Deferral (§6.3)</th>
              </tr>
            </thead>
            <tbody>
              {result.projects.map((p) => {
                const ini = iniMap.get(p.initiativeId);
                return (
                  <tr key={p.initiativeId} className="border-b border-sg-line hover:bg-sg-card-2/40">
                    <td className={cn(tdCls, "max-w-[240px]")}>
                      <InitiativeLink id={p.initiativeId} />
                    </td>
                    <td className={tdCls}>{ini ? <TypeChip type={ini.type} /> : "—"}</td>
                    <td className={tdNum}>
                      <Money value={p.revenue} />
                    </td>
                    <td className={tdNum}>
                      <Money value={p.directCosts} />
                    </td>
                    <td className={tdNum}>
                      <Money value={p.tax} />
                    </td>
                    <td className={cn(tdNum, "font-semibold text-sg-white")}>
                      <Money value={p.net} />
                    </td>
                    <td className={tdNum}>
                      <Pct value={p.sharePct} />
                    </td>
                    <td className={tdNum}>
                      <Money value={p.poolRaw} />
                    </td>
                    <td className={tdNum}>{p.poolCap === -1 ? <Chip color="magenta">CEO exception</Chip> : <Money value={p.poolCap} />}</td>
                    <td className={cn(tdNum, "font-semibold text-sg-white")}>
                      <Money value={p.pool} />
                      {p.capped ? (
                        <div>
                          <Chip color="orange">Capped</Chip>
                        </div>
                      ) : null}
                    </td>
                    <td className={cn(tdCls, "max-w-[240px] text-2xs")}>
                      {p.deferralReasons.length ? (
                        <span className="text-soft-yellow" title={p.deferralReasons.join("\n")}>
                          30% for {ini?.deferralMonths ?? 6} mo · {p.deferralReasons.join("; ")}
                        </span>
                      ) : (
                        <span className="text-sg-dim">None</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-sg-card-2/40 font-semibold">
                <td className={cn(tdCls, "text-sg-white")} colSpan={2}>
                  Total
                </td>
                <td className={tdNum}>
                  <Money value={result.revenue} />
                </td>
                <td className={tdNum}>
                  <Money value={result.directCosts} />
                </td>
                <td className={tdNum}>
                  <Money value={result.taxes} />
                </td>
                <td className={cn(tdNum, "text-sg-white")}>
                  <Money value={result.totals.netRevenue} />
                </td>
                <td className={tdNum} />
                <td className={tdNum}>
                  <Money value={result.projects.reduce((s, p) => s + p.poolRaw, 0)} />
                </td>
                <td className={tdNum} />
                <td className={cn(tdNum, "text-sg-white")}>
                  <Money value={result.totals.pool} />
                </td>
                <td className={tdCls} />
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={Calculator} title={`No recognised revenue in ${monthLabel(month)}`}>
          Only approved, active or completed projects with revenue recognised (or milestone payments received) this month generate a pool (§4.4).
        </EmptyState>
      )}
      {awaiting.length ? (
        <div className="border-t border-sg-line p-4">
          <div className="sg-eyebrow mb-2 flex items-center gap-1.5">
            <Hourglass className="size-3" /> Awaiting payment (excluded until received, §4.4)
          </div>
          <ul className="divide-y divide-sg-line rounded-lg border border-sg-line">
            {awaiting.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1">
                  <InitiativeLink id={e.initiativeId} />
                </span>
                {e.note ? <span className="text-sg-dim">{e.note}</span> : null}
                <span className="text-sg-muted">
                  Milestone <Money value={e.revenue} className="font-semibold text-sg-white" />
                </span>
                <span className="text-sg-muted">
                  costs <Money value={e.directCosts} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

const STATUS_ORDER: LineStatus[] = ["payable", "partially_deferred", "withheld_probation", "cap_review", "held", "forfeited", "ineligible"];

function LinesPanel({ lines, totals, showIndividual, setShowIndividual }: { lines: BonusLine[]; totals: BonusRun["totals"]; showIndividual: boolean; setShowIndividual: (v: boolean) => void }) {
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
        return { status: st, lines: ls.length, people: new Set(ls.map((l) => l.userId)).size, gross: ls.reduce((s, l) => s + l.gross, 0), payable: ls.reduce((s, l) => s + l.payable, 0), deferred: ls.reduce((s, l) => s + l.deferred + l.carriedOver, 0), withheld: ls.reduce((s, l) => s + l.withheld + l.held + l.forfeited, 0) };
      }).filter((r) => r.lines > 0),
    [lines],
  );
  const grossTotal = lines.reduce((s, l) => s + l.gross, 0);

  return (
    <Panel
      title="Bonus lines"
      icon={Users}
      cite="6.7"
      subtitle={`${lines.length} line${lines.length === 1 ? "" : "s"} · ${groups.length} employee${groups.length === 1 ? "" : "s"}`}
      bodyClassName="p-0"
      actions={
        <label className="flex cursor-pointer items-center gap-2 text-xs text-sg-muted">
          <input type="checkbox" checked={showIndividual} onChange={(e) => setShowIndividual(e.target.checked)} className="accent-sg-white" />
          Show individual amounts
          <span title="Individual bonus amounts are confidential (§6.7). Only aggregates are shown by default.">
            <Lock className="size-3.5" />
          </span>
        </label>
      }
    >
      {!lines.length ? (
        <EmptyState icon={Coins} title="No bonus lines">
          Lines appear for each PRC-approved team member who consented, once their project has revenue this month.
        </EmptyState>
      ) : !showIndividual ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-sg-line">
                <th className={thCls}>Status</th>
                <th className={thRight}>Employees</th>
                <th className={thRight}>Lines</th>
                <th className={thRight}>Gross</th>
                <th className={thRight}>Payable</th>
                <th className={thRight}>Deferred / carried</th>
                <th className={thRight}>Withheld / held / forfeited</th>
              </tr>
            </thead>
            <tbody>
              {byStatus.map((r) => (
                <tr key={r.status} className="border-b border-sg-line">
                  <td className={tdCls}>
                    <LineStatusChip status={r.status} />
                    <div className="mt-0.5 text-2xs text-sg-dim">{lineStatusMeta[r.status].hint}</div>
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
                    <Money value={r.deferred} />
                  </td>
                  <td className={tdNum}>
                    <Money value={r.withheld} />
                  </td>
                </tr>
              ))}
              <TotalsRow label="Total" gross={grossTotal} totals={totals} aggregate />
            </tbody>
          </table>
          <p className="flex items-center gap-1.5 px-4 py-2 text-2xs text-sg-dim">
            <Info className="size-3" /> Aggregate view per §6.7 transparency — the formula and weights are public, individual amounts are confidential.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm">
            <thead>
              <tr className="border-b border-sg-line">
                <th className={thCls}>Employee / project</th>
                <th className={thRight}>Weight</th>
                <th className={thRight}>Gross</th>
                <th className={thRight}>Payable</th>
                <th className={thRight}>Deferred §6.3</th>
                <th className={thRight}>Carried §6.1</th>
                <th className={thRight}>Withheld §6.8</th>
                <th className={thRight}>Held</th>
                <th className={thRight}>Forfeited</th>
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
                    <Sum ls={ls} k="gross" />
                    <Sum ls={ls} k="payable" />
                    <Sum ls={ls} k="deferred" />
                    <Sum ls={ls} k="carriedOver" />
                    <Sum ls={ls} k="withheld" />
                    <Sum ls={ls} k="held" />
                    <Sum ls={ls} k="forfeited" />
                    <td className={tdCls} colSpan={2} />
                  </tr>
                  {ls.map((l) => (
                    <tr key={`${l.userId}-${l.initiativeId}`} className="border-b border-sg-line text-sg-muted">
                      <td className={cn(tdCls, "max-w-[260px] pl-10")}>
                        <InitiativeLink id={l.initiativeId} />
                      </td>
                      <td className={tdNum}>
                        {l.weight.toFixed(2)} / {l.totalWeight.toFixed(2)}
                      </td>
                      <td className={tdNum}>
                        <Money value={l.gross} />
                      </td>
                      <Cell v={l.payable} strong />
                      <Cell v={l.deferred} />
                      <Cell v={l.carriedOver} />
                      <Cell v={l.withheld} />
                      <Cell v={l.held} />
                      <Cell v={l.forfeited} />
                      <td className={tdCls}>
                        <LineStatusChip status={l.status} />
                      </td>
                      <td className={cn(tdCls, "max-w-[220px]")}>
                        {l.notes.length ? (
                          <span title={l.notes.join("\n")} className="flex cursor-help items-start gap-1 text-2xs text-sg-dim">
                            <Info className="mt-0.5 size-3 shrink-0" />
                            <span className="line-clamp-2">{l.notes.join(" · ")}</span>
                          </span>
                        ) : (
                          <span className="text-2xs text-sg-dim">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              <TotalsRow label="Totals" gross={grossTotal} totals={totals} />
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Sum({ ls, k }: { ls: BonusLine[]; k: "gross" | "payable" | "deferred" | "carriedOver" | "withheld" | "held" | "forfeited" }) {
  const v = ls.reduce((s, l) => s + l[k], 0);
  return (
    <td className={cn(tdNum, "font-semibold", v ? "text-sg-white" : "text-sg-dim")}>
      <Money value={v} />
    </td>
  );
}

function Cell({ v, strong }: { v: number; strong?: boolean }) {
  return <td className={cn(tdNum, v ? (strong ? "font-semibold text-sg-white" : "text-sg-text") : "text-sg-dim")}>{v ? <Money value={v} /> : "—"}</td>;
}

function TotalsRow({ label, gross, totals, aggregate }: { label: string; gross: number; totals: BonusRun["totals"]; aggregate?: boolean }) {
  if (aggregate)
    return (
      <tr className="bg-sg-card-2/40 font-semibold text-sg-white">
        <td className={tdCls} colSpan={3}>
          {label}
        </td>
        <td className={tdNum}>
          <Money value={gross} />
        </td>
        <td className={tdNum}>
          <Money value={totals.payable} />
        </td>
        <td className={tdNum}>
          <Money value={totals.deferred + totals.carriedOver} />
        </td>
        <td className={tdNum}>
          <Money value={totals.withheld + totals.held + totals.forfeited} />
        </td>
      </tr>
    );
  return (
    <tr className="bg-sg-card-2/40 font-semibold text-sg-white">
      <td className={tdCls} colSpan={2}>
        {label}
      </td>
      <td className={tdNum}>
        <Money value={gross} />
      </td>
      <td className={tdNum}>
        <Money value={totals.payable} />
      </td>
      <td className={tdNum}>
        <Money value={totals.deferred} />
      </td>
      <td className={tdNum}>
        <Money value={totals.carriedOver} />
      </td>
      <td className={tdNum}>
        <Money value={totals.withheld} />
      </td>
      <td className={tdNum}>
        <Money value={totals.held} />
      </td>
      <td className={tdNum}>
        <Money value={totals.forfeited} />
      </td>
      <td className={tdCls} colSpan={2} />
    </tr>
  );
}
