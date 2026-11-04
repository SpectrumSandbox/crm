"use client";

/* §3 / §6.5–6.7 revenue share policy, adjustments, caps and the transparency summary. */
import { useMemo, useState } from "react";
import { CalendarClock, Landmark, Layers, ShieldCheck } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { ProjectType } from "@/lib/initiatives/types";
import { addMonths, clawbackAmount, shareInForce } from "@/lib/initiatives/engine";
import { FX_USD_IDR, POLICY, POLICY_EFFECTIVE, POLICY_VERSION, PROJECT_TYPE_META } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR, fromDateInput, toDateInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Chip, EmptyState } from "@/components/ui/misc";
import { Cite, Metric, Pct, TypeChip } from "@/components/initiatives/shared";
import { Callout, Panel, monthLabel, pctLabel, tdCls, tdNum, thCls, thRight } from "./common";

const TYPES: ProjectType[] = ["A", "B", "C"];
const DAY = 86_400_000;

export function PolicyTab() {
  const adjustments = useCrm((s) => s.shareAdjustments);
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const clawbacks = useCrm((s) => s.clawbacks);
  const scheduleShareAdjustment = useCrm((s) => s.scheduleShareAdjustment);
  const notify = useUi((s) => s.notify);
  const currentUserId = useCrm((s) => s.currentUserId);
  const userMap = useUserMap();

  const nowIso = useMemo(() => new Date().toISOString(), []);
  const minDate = toDateInput(new Date(Date.now() + POLICY.shareAdjustmentNoticeDays * DAY).toISOString());

  const [type, setType] = useState<ProjectType>("A");
  const [pct, setPct] = useState<string>(String(Math.round(shareInForce("A", adjustments, nowIso) * 100)));
  const [effective, setEffective] = useState(minDate);
  const [rationale, setRationale] = useState("");

  const [min, max] = PROJECT_TYPE_META[type].range;
  const pctNum = Number(pct) / 100;
  const errors: string[] = [];
  if (!Number.isFinite(pctNum) || pct === "") errors.push("Enter a percentage");
  else if (pctNum < min - 1e-9 || pctNum > max + 1e-9) errors.push(`Type ${type} must stay within ${pctLabel(min)}–${pctLabel(max)} (§6.6)`);
  if (!effective || effective < minDate) errors.push(`Effective date must be at least ${POLICY.shareAdjustmentNoticeDays} days from today (on or after ${formatDate(fromDateInput(minDate), "medium")})`);
  if (rationale.trim().length < 10) errors.push("Give a rationale (at least 10 characters) for the announcement");

  const submit = () => {
    if (errors.length) return;
    scheduleShareAdjustment(type, pctNum, fromDateInput(effective), rationale.trim());
    notify(`Type ${type} share → ${pctLabel(pctNum)} from ${formatDate(fromDateInput(effective), "medium")} announced`);
    setRationale("");
  };

  const history = useMemo(() => [...adjustments].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)), [adjustments]);
  const lastReleased = useMemo(() => [...bonusRuns].filter((r) => r.status === "released").sort((a, b) => b.month.localeCompare(a.month))[0], [bonusRuns]);
  const clawAgg = useMemo(() => {
    const active = clawbacks.filter((c) => c.status !== "waived");
    return { count: active.length, amount: active.reduce((s, c) => s + clawbackAmount(c), 0), recovered: active.reduce((s, c) => s + c.recovered, 0) };
  }, [clawbacks]);

  const poolCapUsd = POLICY.poolCapAbsolute / FX_USD_IDR;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel title="Revenue share in force" icon={Layers} cite="3" subtitle={`Policy v${POLICY_VERSION} · effective ${formatDate(POLICY_EFFECTIVE, "medium")}`} bodyClassName="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sg-line">
                <th className={thCls}>Type</th>
                <th className={thRight}>Policy default</th>
                <th className={thRight}>In force today</th>
                <th className={thRight}>Range (§6.6)</th>
                <th className={thCls}>Next scheduled</th>
              </tr>
            </thead>
            <tbody>
              {TYPES.map((t) => {
                const meta = PROJECT_TYPE_META[t];
                const now = shareInForce(t, adjustments, nowIso);
                const next = adjustments.filter((a) => a.type === t && Date.parse(a.effectiveFrom) > Date.now()).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
                return (
                  <tr key={t} className="border-b border-sg-line align-top">
                    <td className={cn(tdCls, "max-w-[340px]")}>
                      <TypeChip type={t} long />
                      <div className="mt-1 text-2xs text-sg-dim">{meta.description}</div>
                    </td>
                    <td className={tdNum}>
                      <Pct value={meta.share} />
                    </td>
                    <td className={cn(tdNum, "font-display text-base font-extrabold text-sg-white")}>
                      <Pct value={now} />
                    </td>
                    <td className={cn(tdNum, "text-sg-muted")}>
                      {pctLabel(meta.range[0])}–{pctLabel(meta.range[1])}
                    </td>
                    <td className={cn(tdCls, "text-xs")}>
                      {next ? (
                        <span className="text-soft-yellow">
                          {pctLabel(next.toPct)} from {formatDate(next.effectiveFrom, "medium")}
                        </span>
                      ) : (
                        <span className="text-sg-dim">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-4 py-2 text-2xs text-sg-dim">
            Approved projects keep the share locked at approval; adjustments apply to projects approved after the effective date (§6.6). Shares are reviewed quarterly by PRC and Finance (§6.5).
          </p>
        </Panel>

        <Panel title="Schedule adjustment" icon={CalendarClock} cite="6.6">
          <div
            className="space-y-3"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="Project type">
                <Select
                  value={type}
                  onChange={(e) => {
                    const t = e.target.value as ProjectType;
                    setType(t);
                    setPct(String(Math.round(shareInForce(t, adjustments, nowIso) * 100)));
                  }}
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      Type {t} · {PROJECT_TYPE_META[t].short}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="New share (%)" hint={`${Math.round(min * 100)}–${Math.round(max * 100)}% · now ${pctLabel(shareInForce(type, adjustments, nowIso))}`}>
                <Input type="number" min={Math.round(min * 100)} max={Math.round(max * 100)} step={1} value={pct} onChange={(e) => setPct(e.target.value)} className="sg-num" />
              </Field>
            </div>
            <Field label="Effective date" hint={`At least ${POLICY.shareAdjustmentNoticeDays} days' notice to all employees`}>
              <Input type="date" min={minDate} value={effective} onChange={(e) => setEffective(e.target.value)} />
            </Field>
            <Field label="Rationale">
              <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Market conditions, profitability, competitive position, strategic priorities (§6.5)…" className="min-h-[72px]" />
            </Field>
            {errors.length ? (
              <Callout tone={rationale || pct !== String(Math.round(shareInForce(type, adjustments, nowIso) * 100)) ? "warn" : "info"}>
                <ul className="list-disc pl-4">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Callout>
            ) : null}
            <div className="flex items-center gap-2">
              <span className="text-2xs text-sg-dim">Approved by {userMap.get(currentUserId)?.name ?? "you"} (CEO, PRC chair) · ⌘/Ctrl+Enter</span>
              <Button variant="primary" size="sm" className="ml-auto" disabled={errors.length > 0} onClick={submit} title={errors.join("\n")}>
                Announce adjustment
              </Button>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Adjustment history" icon={CalendarClock} cite="6.6" bodyClassName="p-0">
        {!history.length ? (
          <EmptyState icon={CalendarClock} title="No adjustments yet">
            All types are on the policy default shares.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-sg-line">
                  <th className={thCls}>Type</th>
                  <th className={thRight}>From</th>
                  <th className={thRight}>To</th>
                  <th className={thCls}>Announced</th>
                  <th className={thCls}>Effective</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Rationale</th>
                  <th className={thCls}>Approved by</th>
                </tr>
              </thead>
              <tbody>
                {history.map((a) => {
                  const scheduled = Date.parse(a.effectiveFrom) > Date.now();
                  return (
                    <tr key={a.id} className="border-b border-sg-line align-top">
                      <td className={tdCls}>
                        <TypeChip type={a.type} />
                      </td>
                      <td className={cn(tdNum, "text-sg-muted")}>{pctLabel(a.fromPct)}</td>
                      <td className={cn(tdNum, "font-semibold text-sg-white")}>{pctLabel(a.toPct)}</td>
                      <td className={cn(tdCls, "text-sg-muted")}>{formatDate(a.proposedAt, "medium")}</td>
                      <td className={cn(tdCls, "text-sg-text")}>{formatDate(a.effectiveFrom, "medium")}</td>
                      <td className={tdCls}>
                        <Chip color={scheduled ? "yellow" : "green"} dot>
                          {scheduled ? "Scheduled" : "In effect"}
                        </Chip>
                      </td>
                      <td className={cn(tdCls, "max-w-[320px] text-xs text-sg-muted")}>{a.rationale}</td>
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
        <Panel title="Caps & constants" icon={Landmark} cite="6.2">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Const label="Project pool cap" cite="6.2" value={`min(5% of company monthly EBITDA, US$${poolCapUsd.toLocaleString("en-US")})`} hint={`US$500k ≈ ${formatIDR(POLICY.poolCapAbsolute, "full")} at Rp ${FX_USD_IDR.toLocaleString("id-ID")}/USD · CEO may approve exceptions`} />
            <Const label="Per-person annual cap" cite="6.2" value={`${POLICY.personAnnualCapOfSalary * 100}% of annual base salary`} hint="Excess needs CEO + PRC approval" />
            <Const label="High-risk deferral" cite="6.3" value={`${POLICY.deferral.pct * 100}% for ${POLICY.deferral.minMonths}–${POLICY.deferral.maxMonths} months`} hint={`Net revenue > US$200k (${formatIDR(POLICY.deferral.netRevenueThreshold)}), Type C warranty, terms > ${POLICY.deferral.paymentTermsDays} days, new client, or PRC high-risk`} />
            <Const label="Clawback window" cite="6.4" value={`${POLICY.clawback.windowMonths} months from payment`} hint={`Recovery ${POLICY.clawback.minMonths}–${POLICY.clawback.maxMonths} months, ≤ ${POLICY.clawback.maxSalaryDeductionPct * 100}% of monthly gross; data-error de minimis US$10k (${formatIDR(POLICY.clawback.dataErrorDeMinimis)})`} />
            <Const label="Corporate tax estimate" cite="3.4" value={`${POLICY.corporateTaxRate * 100}% of project profit`} hint="Used for net revenue P" />
            <Const label="Break-even certification" cite="6.1" value={`By the ${POLICY.breakEvenDeadlineDay}th of each month`} hint={`Payment on the ${POLICY.paymentDay}th of the following month`} />
            <Const label="Share adjustment notice" cite="6.6" value={`${POLICY.shareAdjustmentNoticeDays} days minimum`} hint="Locked shares honoured for approved projects" />
            <Const label="Dispute window" cite="6.4" value={`${POLICY.clawback.disputeBusinessDays} business days`} hint="From written notice of a clawback" />
          </dl>
        </Panel>

        <Panel title="Transparency summary" icon={ShieldCheck} cite="6.7" subtitle={lastReleased ? `Last released run · ${monthLabel(lastReleased.month)}` : undefined}>
          {lastReleased ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Metric label="Bonus pool" value={formatIDR(lastReleased.totals.pool)} />
                <Metric label="Paid out" value={formatIDR(lastReleased.totals.payable)} tone="green" />
                <Metric label="Deferred (§6.3)" value={formatIDR(lastReleased.totals.deferred + lastReleased.totals.carriedOver)} tone={lastReleased.totals.deferred + lastReleased.totals.carriedOver ? "yellow" : undefined} hint={lastReleased.totals.carriedOver ? `incl. ${formatIDR(lastReleased.totals.carriedOver)} carried (§6.1)` : undefined} />
                <Metric label="Withheld (probation)" value={formatIDR(lastReleased.totals.withheld)} tone={lastReleased.totals.withheld ? "orange" : undefined} />
                <Metric label="Held / forfeited" value={formatIDR(lastReleased.totals.held + lastReleased.totals.forfeited)} />
                <Metric label="Clawbacks (all open & closed)" value={formatIDR(clawAgg.amount)} hint={`${clawAgg.count} case${clawAgg.count === 1 ? "" : "s"} · ${formatIDR(clawAgg.recovered)} recovered`} tone={clawAgg.amount ? "red" : undefined} />
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-sg-line pt-3 text-2xs text-sg-dim">
                <span>Participants: {new Set(lastReleased.lines.map((l) => l.userId)).size}</span>
                <span>Projects: {new Set(lastReleased.lines.map((l) => l.initiativeId)).size}</span>
                <span>Operating result: {formatIDR(lastReleased.operatingResult)}</span>
                <span>Released {formatDate(lastReleased.releasedAt, "medium")}</span>
                <span>Clawback window for this run ends {formatDate(addMonths(lastReleased.releasedAt ?? nowIso, POLICY.clawback.windowMonths), "medium")}</span>
              </div>
              <Callout>Aggregates only — the formula, weights and shares are published; individual bonus amounts are confidential and never shown here (§6.7).</Callout>
            </div>
          ) : (
            <EmptyState icon={ShieldCheck} title="No released runs yet">
              Once PRC authorises the first monthly release, aggregate totals are published here for all employees.
            </EmptyState>
          )}
        </Panel>
      </div>
    </div>
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
      {hint ? <dd className="text-2xs text-sg-dim">{hint}</dd> : null}
    </div>
  );
}
