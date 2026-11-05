"use client";

/* Policy v4.0 parameters (live from policy.ts), the §5.1 revenue-share curve, §9.5 curve changes and the §9.6 summary. */
import { useMemo, useState } from "react";
import { CalendarClock, Landmark, Layers, ShieldCheck, TrendingDown } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { Curve } from "@/lib/initiatives/policy";
import { addMonths, clawbackAmount, curveInForce, floorRp, revenueShareRate } from "@/lib/initiatives/engine";
import { CURVE, CURVE_LIMITS, EMPLOYMENT_META, POLICY, POLICY_DATED, POLICY_EFFECTIVE, POLICY_STATUS, POLICY_SUPERSEDES, POLICY_VERSION, PROJECT_TYPE_META, TIER_META } from "@/lib/initiatives/policy";
import { EMPLOYMENT_TYPES } from "@/lib/initiatives/types";
import { cn, formatDate, formatIDR, fromDateInput, toDateInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Chip, EmptyState } from "@/components/ui/misc";
import { Cite, Metric, TypeChip } from "@/components/initiatives/shared";
import { AmountInput, Callout, Panel, monthLabel, ratePct, tdCls, tdNum, thCls, thRight } from "./common";
import { useAccess } from "@/lib/access-control";

const DAY = 86_400_000;
/** §5.1 table rows. */
const SAMPLE_X = [100_000_000, 250_000_000, 500_000_000, 750_000_000, 1_000_000_000, 1_500_000_000, 2_000_000_000];
/** §9.5 permitted grounds for a change. */
const GROUNDS = ["Profitability declined for three consecutive months", "Quarterly targets are at risk", "Major unforeseen costs or economic conditions", "Long-term investment needs capital"];
const curveText = (c: Curve) => `${Math.round(c.start * 1000) / 10}% → ${Math.round(c.floor * 1000) / 10}% at ${formatIDR(c.decay)}`;

export function PolicyTab() {
  const adjustments = useCrm((s) => s.curveAdjustments);
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const clawbacks = useCrm((s) => s.clawbacks);
  const deferred = useCrm((s) => s.deferredBonuses);
  const userMap = useUserMap();

  const nowIso = useMemo(() => new Date().toISOString(), []);
  const curve = useMemo(() => curveInForce(adjustments, nowIso), [adjustments, nowIso]);
  const next = useMemo(() => [...adjustments].filter((a) => Date.parse(a.effectiveFrom) > Date.parse(nowIso)).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0], [adjustments, nowIso]);
  const history = useMemo(() => [...adjustments].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)), [adjustments]);
  const lastReleased = useMemo(() => [...bonusRuns].filter((r) => r.status === "released").sort((a, b) => b.month.localeCompare(a.month))[0], [bonusRuns]);
  const agg = useMemo(() => {
    const active = clawbacks.filter((c) => c.status !== "waived");
    return { count: active.length, amount: active.reduce((s, c) => s + clawbackAmount(c), 0), recovered: active.reduce((s, c) => s + c.recovered, 0), deferred: deferred.filter((d) => d.status === "pending").reduce((s, d) => s + d.amount, 0) };
  }, [clawbacks, deferred]);

  const [tryX, setTryX] = useState(600_000_000);
  const x = Math.max(0, tryX);
  const y = revenueShareRate(x, curve);

  return (
    <div className="space-y-4">
      <Callout>
        <span className="font-semibold text-sg-white">Project Initiative and Compensation Policy v{POLICY_VERSION}</span> · {POLICY_STATUS} dated {formatDate(POLICY_DATED, "medium")} · pilot from {formatDate(POLICY_EFFECTIVE, "medium")} · supersedes v{POLICY_SUPERSEDES}. Every figure below is read live from the policy configuration <Cite s="9.6" />.
      </Callout>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title="Revenue-share curve in force" icon={TrendingDown} cite="5.1" subtitle={next ? `change scheduled ${formatDate(next.effectiveFrom, "medium")}` : "one curve for all project types"} bodyClassName="p-0">
          <div className="grid gap-4 border-b border-sg-line p-4 sm:grid-cols-3">
            <Metric label="Starting rate S (at Rp0)" value={`${Math.round(curve.start * 1000) / 10}%`} hint={`allowed ${CURVE_LIMITS.start[0] * 100}–${CURVE_LIMITS.start[1] * 100}%`} />
            <Metric label="Floor rate F" value={`${Math.round(curve.floor * 1000) / 10}%`} hint={`allowed ${CURVE_LIMITS.floor[0] * 100}–${CURVE_LIMITS.floor[1] * 100}%`} />
            <Metric label="Decay point D" value={formatIDR(curve.decay)} hint={`allowed ${formatIDR(CURVE_LIMITS.decay[0])}–${formatIDR(CURVE_LIMITS.decay[1])}`} />
          </div>
          <p className="px-4 pt-3 font-mono text-2xs text-sg-muted">y = S ÷ (1 + (S ÷ F − 1) × x ÷ D) for x ≤ D; y = F above D · x = projected annual net revenue</p>
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-sg-line">
                  <th className={thCls}>Projected annual net revenue (x)</th>
                  <th className={thRight}>Rate (y)</th>
                  <th className={thRight}>Bonus pool per year if met</th>
                  <th className={thRight}>Company keeps</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_X.map((v) => {
                  const r = revenueShareRate(v, curve);
                  return (
                    <tr key={v} className="border-b border-sg-line">
                      <td className={cn(tdCls, "sg-num text-sg-text")}>{formatIDR(v, "full")}</td>
                      <td className={cn(tdNum, "font-semibold text-sg-white")}>{ratePct(r)}</td>
                      <td className={tdNum}>{formatIDR(floorRp(v * r), "full")}</td>
                      <td className={cn(tdNum, "text-sg-muted")}>{Math.round((1 - r) * 1000) / 10}%</td>
                    </tr>
                  );
                })}
                <tr className="bg-sg-card-2/40">
                  <td className={tdCls}>
                    <span className="block w-48">
                      <AmountInput value={tryX} onChange={setTryX} aria-label="Try a projected annual net revenue" />
                    </span>
                  </td>
                  <td className={cn(tdNum, "font-semibold text-soft-cyan")}>{ratePct(y)}</td>
                  <td className={cn(tdNum, "text-soft-cyan")}>{formatIDR(floorRp(x * y), "full")}</td>
                  <td className={cn(tdNum, "text-sg-muted")}>{Math.round((1 - y) * 1000) / 10}%</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-2xs text-sg-dim">
            A flat rate on the project&apos;s whole net revenue, fixed by the PRC at approval from the expected case; projects of more than 12 months use total net × 12 ÷ contracted months. The rate is never rounded — only amounts, rounded down to whole rupiah (§8.5) — so more revenue never pays less. Projects keep the curve in force when they were approved; v3.0 projects keep their flat share (§15.1).
          </p>
        </Panel>

        <CurveChangeForm curve={curve} />
      </div>

      <Panel title="Curve change history" icon={CalendarClock} cite="9.5" bodyClassName="p-0">
        {!history.length ? (
          <EmptyState icon={CalendarClock} title="No curve changes">
            The policy curve {curveText(CURVE)} has applied since v{POLICY_VERSION}.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-sg-line">
                  <th className={thCls}>From</th>
                  <th className={thCls}>To</th>
                  <th className={thCls}>Announced</th>
                  <th className={thCls}>Effective</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Grounds & rationale</th>
                  <th className={thCls}>Approved by</th>
                </tr>
              </thead>
              <tbody>
                {history.map((a) => {
                  const scheduled = Date.parse(a.effectiveFrom) > Date.now();
                  return (
                    <tr key={a.id} className="border-b border-sg-line align-top">
                      <td className={cn(tdCls, "sg-num text-sg-muted")}>{curveText(a.from)}</td>
                      <td className={cn(tdCls, "sg-num font-semibold text-sg-white")}>{curveText(a.to)}</td>
                      <td className={cn(tdCls, "text-sg-muted")}>{formatDate(a.proposedAt, "medium")}</td>
                      <td className={cn(tdCls, "text-sg-text")}>{formatDate(a.effectiveFrom, "medium")}</td>
                      <td className={tdCls}>
                        <Chip color={scheduled ? "yellow" : "green"} dot>
                          {scheduled ? "Announced" : "In effect"}
                        </Chip>
                      </td>
                      <td className={cn(tdCls, "max-w-[360px] whitespace-pre-line text-xs text-sg-muted")}>{a.rationale}</td>
                      <td className={cn(tdCls, "text-xs text-sg-muted")}>{userMap.get(a.approvedById)?.name ?? a.approvedById}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Parameters" icon={Landmark} cite="9.6">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Const
              label="Approval tiers"
              cite="4.2"
              value={`${TIER_META[1].label} < ${formatIDR(POLICY.tiers.fastTrackBelow)} · ${TIER_META[3].label} > ${formatIDR(POLICY.tiers.majorAbove)}`}
              hint={`PRC decides in ${TIER_META[1].decisionBusinessDays} / ${TIER_META[2].decisionBusinessDays} / ${TIER_META[3].decisionBusinessDays} business days · every Type C, a new country/market or unusual liability terms is Tier 3`}
            />
            <Const
              label="Estimated taxes"
              cite="5.4"
              value={POLICY.tax.regime === "umkm" ? `UMKM final tax ${POLICY.tax.umkmRate * 100}% of revenue` : `Corporate income tax on revenue − direct costs`}
              hint={`Due even on a loss-making project. The UMKM rate ends if turnover passes ${formatIDR(POLICY.tax.umkmTurnoverLimit)} in a tax year (from the next tax year), the eligibility period ends, or the company opts out; then corporate income tax on revenue − direct costs at an effective rate set by Finance applies to revenue earned from the switch date, with at least 30 days' notice. Bonuses already paid are not recalculated.`}
            />
            <Const label="Tax reconciliation" cite="5.5" value={`Variance > ${POLICY.tax.varianceReviewPct * 100}% reviewed by the CFO`} hint="Lower actual tax → adjustment bonus next cycle; higher → absorbed by the company, no clawback" />
            <Const
              label="High-risk deferral"
              cite="9.3"
              value={`Up to ${POLICY.deferral.maxPct * 100}% for ${POLICY.deferral.minMonths}–${POLICY.deferral.maxMonths} months after close`}
              hint={`Triggers: projected net > ${formatIDR(POLICY.deferral.netRevenueThreshold)}; Type C with warranty; payment terms > ${POLICY.deferral.paymentTermsDays} days; new client; PRC rates risk high. Forecast shortfall review above ${POLICY.deferral.forecastShortfallReviewPct * 100}%.`}
            />
            <Const label="Type C guaranteed minimum" cite="8.6" value={`Standard bonus ≥ ${formatIDR(POLICY.typeCMinimum.standardBonus, "full")} / month`} hint={`Topped up from the month work starts (first month pro-rated); ends after ${POLICY.typeCMinimum.consecutiveMonthsToEnd} consecutive months above it or one month ≥ ${POLICY.typeCMinimum.singleMonthMultipleToEnd}×. Top-ups are deducted from later bonuses on the same project; paid in full even when a check fails.`} />
            <Const label="Monthly cycle" cite="8.2" value={`Cut-off ${POLICY.cycle.cutoffDay}th · provisional ${POLICY.cycle.provisionalDay}nd · certify ${POLICY.cycle.certifyDay}rd · salary ${POLICY.cycle.salaryDay}th`} hint="Revenue collected after the 20th is paid with the following month's salary" />
            <Const label="Break-even test & cash floor" cite="9.1" value={`Rolling ${POLICY.breakEven.rollingMonths} months · cash ≥ ${POLICY.breakEven.cashFloorMonths} months of fixed costs`} hint={`On failure: pro rata, carry forward, PRC review after ${POLICY.breakEven.failReviewMonths} failing months (§9.2)`} />
            <Const
              label="Clawback limits"
              cite="9.4"
              value={`${POLICY.clawback.windowMonths} months from payment`}
              hint={`Salary deductions with written agreement, over ${POLICY.clawback.minMonths}–${POLICY.clawback.maxMonths} months, ≤ ${POLICY.clawback.maxSalaryDeductionPct * 100}% of monthly gross; total wage deductions ≤ ${POLICY.clawback.maxWageDeductionPct * 100}%. Safe harbour ${formatIDR(POLICY.clawback.dataErrorSafeHarbour, "full")} for data errors not caused by the employee. Dispute within ${POLICY.clawback.disputeBusinessDays} business days.`}
            />
            <Const label="Capacity" cite="7.3" value={`Leadership ≤ ${POLICY.leadershipCapacity.toFixed(1)} · ≤ ${POLICY.maxConcurrentNonLeadRoles} non-lead roles`} hint={`Capacity factors: ${(["A", "B", "C"] as const).map((t) => `Type ${t} ${PROJECT_TYPE_META[t].capacityFactor}`).join(" · ")} (§7.1, §7.3)`} />
            <Const label="Probation" cite="11" value={`Held up to ${POLICY.probationMaxMonths} months`} hint={`Completion bonus within ${POLICY.probationPayoutDays} days of the end date; paid with final pay if probation ends; forfeited only on dismissal for a serious violation`} />
            <Const label="Status changes" cite="10" value={`Later collections paid for up to ${POLICY.separationTrailMonths} months`} hint={`Termination on other grounds, PKWT end, PRC-confirmed retirement, death or disability (paid within ${POLICY.deathPayoutDays} days of documents). Unpaid leave over ${POLICY.unpaidLeaveMaxDays} days holds payments.`} />
            <Const label="Eligible employment" cite="3" value={EMPLOYMENT_TYPES.filter((t) => EMPLOYMENT_META[t].eligible).map((t) => EMPLOYMENT_META[t].label).join(" · ")} hint={`Not eligible: ${EMPLOYMENT_TYPES.filter((t) => !EMPLOYMENT_META[t].eligible).map((t) => EMPLOYMENT_META[t].label).join(" · ")}`} />
            <Const label="Statement disputes" cite="14" value={`${POLICY.statementDisputeDays} days from the statement date`} hint={`Settled directly within ${POLICY.sla.disputeResolveBusinessDays} business days, then the PRC`} />
            <Const label="Curve change notice" cite="9.5" value={`${POLICY.curveNoticeDays} days' written notice`} hint="Applies only to projects approved after the effective date" />
          </dl>
        </Panel>

        <Panel title="Transparency summary" icon={ShieldCheck} cite="9.6" subtitle={lastReleased ? `last released cycle · ${monthLabel(lastReleased.month)}` : undefined}>
          {lastReleased ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Metric label="Revenue-based pools" value={formatIDR(lastReleased.totals.pool)} hint={lastReleased.totals.topUps ? `+ ${formatIDR(lastReleased.totals.topUps)} Type C top-ups` : undefined} />
                <Metric label="Paid with salary" value={formatIDR(lastReleased.totals.payable)} tone="green" />
                <Metric label="Released" value={`${(lastReleased.payoutPct * 100).toFixed(lastReleased.payoutPct >= 1 ? 0 : 2)}%`} tone={lastReleased.payoutPct >= 1 ? "green" : "yellow"} hint="of proposed bonuses (§9.2)" />
                <Metric label="Deferred (all open)" value={formatIDR(agg.deferred)} tone={agg.deferred ? "yellow" : undefined} />
                <Metric label="Carried forward" value={formatIDR(lastReleased.totals.carriedOver)} tone={lastReleased.totals.carriedOver ? "yellow" : undefined} />
                <Metric label="Probation held" value={formatIDR(lastReleased.totals.withheld)} tone={lastReleased.totals.withheld ? "orange" : undefined} />
                <Metric label="Clawbacks" value={formatIDR(agg.amount)} hint={`${agg.count} case${agg.count === 1 ? "" : "s"} · ${formatIDR(agg.recovered)} recovered`} tone={agg.amount ? "red" : undefined} />
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-sg-line pt-3 text-2xs text-sg-dim">
                <span>Participants: {new Set(lastReleased.lines.map((l) => l.userId)).size}</span>
                <span>Projects: {new Set(lastReleased.lines.map((l) => l.initiativeId)).size}</span>
                <span>Operating result: {formatIDR(lastReleased.operatingResult)}</span>
                <span>Released {formatDate(lastReleased.releasedAt, "medium")}</span>
                <span>Clawback window for this cycle ends {formatDate(addMonths(lastReleased.releasedAt ?? nowIso, POLICY.clawback.windowMonths), "medium")}</span>
              </div>
              <Callout>Aggregates only. The curve, thresholds and tax method are published with their history; individual amounts are confidential (§9.6).</Callout>
            </div>
          ) : (
            <EmptyState icon={ShieldCheck} title="No released cycles yet">
              Once the PRC authorises the first monthly release, aggregate totals are published here.
            </EmptyState>
          )}
        </Panel>
      </div>

      <Panel title="Project types" icon={Layers} cite="5.1" bodyClassName="p-0">
        <table className="w-full text-sm">
          <tbody>
            {(["A", "B", "C"] as const).map((t) => (
              <tr key={t} className="border-b border-sg-line last:border-b-0">
                <td className={cn(tdCls, "w-60")}>
                  <TypeChip type={t} long />
                </td>
                <td className={cn(tdCls, "text-xs text-sg-muted")}>
                  {PROJECT_TYPE_META[t].description} <span className="text-sg-dim">e.g. {PROJECT_TYPE_META[t].examples}</span>
                </td>
                <td className={cn(tdNum, "w-40 text-xs")}>capacity {PROJECT_TYPE_META[t].capacityFactor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function CurveChangeForm({ curve }: { curve: Curve }) {
  const scheduleCurveAdjustment = useCrm((s) => s.scheduleCurveAdjustment);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const access = useAccess();
  const minDate = toDateInput(new Date(Date.now() + (POLICY.curveNoticeDays + 1) * DAY).toISOString());

  const [start, setStart] = useState(String(Math.round(curve.start * 1000) / 10));
  const [floor, setFloor] = useState(String(Math.round(curve.floor * 1000) / 10));
  const [decay, setDecay] = useState(curve.decay);
  const [effective, setEffective] = useState(minDate);
  const [grounds, setGrounds] = useState<string[]>([]);
  const [rationale, setRationale] = useState("");

  const next: Curve = { start: Number(start) / 100, floor: Number(floor) / 100, decay };
  const inRange = (v: number, [lo, hi]: readonly [number, number]) => Number.isFinite(v) && v >= lo - 1e-9 && v <= hi + 1e-9;
  const errors: string[] = [];
  if (!inRange(next.start, CURVE_LIMITS.start)) errors.push(`Starting rate must be ${CURVE_LIMITS.start[0] * 100}–${CURVE_LIMITS.start[1] * 100}%`);
  if (!inRange(next.floor, CURVE_LIMITS.floor)) errors.push(`Floor rate must be ${CURVE_LIMITS.floor[0] * 100}–${CURVE_LIMITS.floor[1] * 100}%`);
  if (!inRange(next.decay, CURVE_LIMITS.decay)) errors.push(`Decay point must be ${formatIDR(CURVE_LIMITS.decay[0], "full")}–${formatIDR(CURVE_LIMITS.decay[1], "full")}`);
  if (next.start <= next.floor) errors.push("The starting rate must be higher than the floor rate");
  if (next.start === curve.start && next.floor === curve.floor && next.decay === curve.decay) errors.push("Change at least one parameter");
  if (!effective || effective < minDate) errors.push(`At least ${POLICY.curveNoticeDays} days' written notice — effective on or after ${formatDate(fromDateInput(minDate), "medium")}`);
  if (!grounds.length) errors.push("Select the ground(s) for the change");
  if (rationale.trim().length < 20) errors.push("Give the reasons and financial context for the notice (20+ characters)");
  if (!access.prc) errors.push("Only the PRC approves a curve change (§9.5, §13.2)");

  const submit = () => {
    if (errors.length) return;
    const id = scheduleCurveAdjustment(next, fromDateInput(effective), `${grounds.join("; ")}.\n${rationale.trim()}`);
    if (!id) {
      notify("Curve change rejected — check the §9.5 limits");
      return;
    }
    notify(`Curve ${curveText(next)} announced from ${formatDate(fromDateInput(effective), "medium")} — projects approved after that date only`);
    setRationale("");
    setGrounds([]);
  };

  return (
    <Panel title="Change the curve" icon={CalendarClock} cite="9.5">
      <div
        className="space-y-3"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      >
        <div className="grid grid-cols-3 gap-2">
          <Field label="Start S (%)" hint={`${CURVE_LIMITS.start[0] * 100}–${CURVE_LIMITS.start[1] * 100}`}>
            <Input type="number" step={0.5} value={start} onChange={(e) => setStart(e.target.value)} className="sg-num" />
          </Field>
          <Field label="Floor F (%)" hint={`${CURVE_LIMITS.floor[0] * 100}–${CURVE_LIMITS.floor[1] * 100}`}>
            <Input type="number" step={0.5} value={floor} onChange={(e) => setFloor(e.target.value)} className="sg-num" />
          </Field>
          <Field label="Decay D (Rp)" hint={`${CURVE_LIMITS.decay[0] / 1e9}–${CURVE_LIMITS.decay[1] / 1e9} M (miliar)`}>
            <AmountInput value={decay} onChange={setDecay} aria-label="Decay point" />
          </Field>
        </div>
        {errors.some((e) => e.startsWith("Starting") || e.startsWith("Floor") || e.startsWith("Decay") || e.startsWith("The starting")) ? null : (
          <table className="w-full text-2xs">
            <thead>
              <tr className="text-sg-dim">
                <th className="py-0.5 text-left font-semibold">x</th>
                <th className="py-0.5 text-right font-semibold">now</th>
                <th className="py-0.5 text-right font-semibold">proposed</th>
              </tr>
            </thead>
            <tbody>
              {[250_000_000, 1_000_000_000, 3_000_000_000].map((x) => (
                <tr key={x} className="border-t border-sg-line">
                  <td className="sg-num py-0.5 text-sg-muted">{formatIDR(x)}</td>
                  <td className="sg-num py-0.5 text-right text-sg-muted">{ratePct(revenueShareRate(x, curve))}</td>
                  <td className="sg-num py-0.5 text-right font-semibold text-sg-white">{ratePct(revenueShareRate(x, next))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Field label="Effective date" hint={`At least ${POLICY.curveNoticeDays} days' written notice; applies only to projects approved after it`}>
          <Input type="date" min={minDate} value={effective} onChange={(e) => setEffective(e.target.value)} />
        </Field>
        <div>
          <div className="mb-1 text-2xs font-semibold uppercase tracking-[0.12em] text-sg-dim">Grounds</div>
          {GROUNDS.map((g) => (
            <label key={g} className="flex cursor-pointer items-center gap-2 py-0.5 text-xs text-sg-text">
              <input type="checkbox" className="accent-sg-white" checked={grounds.includes(g)} onChange={(e) => setGrounds((s) => (e.target.checked ? [...s, g] : s.filter((x) => x !== g)))} />
              {g}
            </label>
          ))}
        </div>
        <Field label="Reasons & financial context (sent with the notice)">
          <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="The CFO's analysis and recommendation; how the PRC approved or modified it…" className="min-h-[72px]" />
        </Field>
        {errors.length ? (
          <ul className="list-disc space-y-0.5 pl-4 text-2xs text-soft-yellow">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-center gap-2">
          <span className="text-2xs text-sg-dim">Approved by {userMap.get(access.userId)?.name ?? "you"} for the PRC · changes outside these limits need a Company Regulations amendment · ⌘/Ctrl+Enter</span>
          <Button variant="primary" size="sm" className="ml-auto shrink-0" disabled={errors.length > 0} onClick={submit} title={errors.join("\n")}>
            Announce change
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function Const({ label, value, hint, cite }: { label: string; value: string; hint?: string; cite?: string }) {
  return (
    <div>
      <dt className="sg-eyebrow flex items-center">
        {label}
        {cite ? <Cite s={cite} /> : null}
      </dt>
      <dd className="mt-0.5 font-semibold text-sg-white">{value}</dd>
      {hint ? <dd className="text-2xs leading-relaxed text-sg-dim">{hint}</dd> : null}
    </div>
  );
}
