"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Database, Pencil, Trash2 } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import type { Deal, ForecastCategory, PipelineStage } from "@/lib/types";

import { cn, formatDate, formatIDR, relativeTime } from "@/lib/utils";
import { csvDate, type CsvColumn } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/input";
import { Avatar, Chip } from "@/components/ui/misc";
import { Modal } from "@/components/ui/overlays";
import { MoneyInput } from "@/components/ui/money-input";
import { FORECAST_META, FORECAST_ORDER, forecastOf } from "@/components/crm/deal-signals";
import type { PipelineSnapshot } from "@/lib/automation-types";
import { BarList, Kpi, KpiRow, Legend, Panel, StackBar, Td, Th, type ReportFilters } from "./shared";
import { closedAtOf, DAY, fmtDays, inPeriod, mean, median, monthPeriod, monthsOfQuarter, pct, quarterKey, quarterPeriod, shiftQuarter, stageVisits, days as daysBetween } from "./data";

/* ───────────── shared deal data ───────────── */

function useDealData(f: ReportFilters) {
  const deals = useCrm((s) => s.deals);
  const pipelines = useCrm((s) => s.pipelines);
  const history = useCrm((s) => s.dealHistory);
  return useMemo(() => {
    const dealPipelines = pipelines.filter((p) => p.objectType === "deal");
    const stageMap = new Map<string, PipelineStage>(dealPipelines.flatMap((p) => p.stages.map((s) => [s.id, s] as const)));
    const scoped = deals.filter((d) => (!f.pipelineId || d.pipelineId === f.pipelineId) && (!f.ownerId || d.ownerId === f.ownerId) && dealPipelines.some((p) => p.id === d.pipelineId));
    const closedAt = new Map<string, string | null>(scoped.map((d) => [d.id, closedAtOf(d, stageMap.get(d.stageId), history ?? [])] as const));
    return { scoped, stageMap, closedAt, dealPipelines, history: history ?? [] };
  }, [deals, pipelines, history, f.pipelineId, f.ownerId]);
}

const userName = (users: { id: string; name: string }[], id: string) => users.find((u) => u.id === id)?.name ?? "—";

/* ───────────── win / loss ───────────── */

export function WinLossReport({ filters }: { filters: ReportFilters }) {
  const { scoped, stageMap, closedAt } = useDealData(filters);
  const users = useCrm((s) => s.users);
  const companies = useCrm((s) => s.companies);
  const data = useMemo(() => {
    const closed = scoped.filter((d) => stageMap.get(d.stageId)?.closed && inPeriod(closedAt.get(d.id), filters.period));
    const won = closed.filter((d) => stageMap.get(d.stageId)?.closed === "won");
    const lost = closed.filter((d) => stageMap.get(d.stageId)?.closed === "lost");
    const sum = (a: Deal[]) => a.reduce((s, d) => s + d.amount, 0);
    const group = (key: (d: Deal) => string) => {
      const m = new Map<string, { won: Deal[]; lost: Deal[] }>();
      closed.forEach((d) => {
        const k = key(d);
        const x = m.get(k) ?? { won: [], lost: [] };
        (stageMap.get(d.stageId)?.closed === "won" ? x.won : x.lost).push(d);
        m.set(k, x);
      });
      return Array.from(m.entries()).map(([k, v]) => ({ key: k, won: v.won.length, lost: v.lost.length, wonValue: sum(v.won), lostValue: sum(v.lost), rate: pct(v.won.length, v.won.length + v.lost.length) }));
    };
    const reasons = new Map<string, { n: number; value: number }>();
    lost.forEach((d) => {
      const r = d.lostReason || "Not recorded";
      const x = reasons.get(r) ?? { n: 0, value: 0 };
      x.n += 1;
      x.value += d.amount;
      reasons.set(r, x);
    });
    const reasonRows = Array.from(reasons.entries()).sort((a, b) => b[1].value - a[1].value);
    const competitors = new Map<string, number>();
    lost.forEach((d) => d.lostToCompetitor && competitors.set(d.lostToCompetitor, (competitors.get(d.lostToCompetitor) ?? 0) + 1));
    const winReasons = new Map<string, number>();
    won.forEach((d) => winReasons.set(d.winReason || "Not recorded", (winReasons.get(d.winReason || "Not recorded") ?? 0) + 1));
    return {
      closed: closed.sort((a, b) => (closedAt.get(b.id) ?? "").localeCompare(closedAt.get(a.id) ?? "")),
      won,
      lost,
      wonValue: sum(won),
      lostValue: sum(lost),
      byCapability: group((d) => d.capability).sort((a, b) => b.wonValue + b.lostValue - (a.wonValue + a.lostValue)),
      byOwner: group((d) => d.ownerId).sort((a, b) => b.rate - a.rate),
      byType: group((d) => d.dealType),
      reasonRows,
      competitors: Array.from(competitors.entries()).sort((a, b) => b[1] - a[1]),
      winReasons: Array.from(winReasons.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [scoped, stageMap, closedAt, filters.period]);

  const columns: CsvColumn<Deal>[] = [
    { header: "Deal", value: (d) => d.name },
    { header: "Result", value: (d) => (stageMap.get(d.stageId)?.closed === "won" ? "Won" : "Lost") },
    { header: "Closed (WIB)", value: (d) => csvDate(closedAt.get(d.id)) },
    { header: "Amount (IDR)", value: (d) => d.amount },
    { header: "Capability", value: (d) => d.capability },
    { header: "Deal type", value: (d) => d.dealType },
    { header: "Owner", value: (d) => userName(users, d.ownerId) },
    { header: "Company", value: (d) => companies.find((c) => c.id === d.companyId)?.name ?? "" },
    { header: "Lost reason", value: (d) => d.lostReason ?? "" },
    { header: "Lost to", value: (d) => d.lostToCompetitor ?? "" },
    { header: "Win reason", value: (d) => d.winReason ?? "" },
    { header: "Note", value: (d) => d.closeNote ?? "" },
  ];
  const decided = data.won.length + data.lost.length;
  let cum = 0;
  const lostTotal = data.lostValue || 1;

  return (
    <div className="space-y-4">
      <KpiRow>
        <Kpi label="Win rate (count)" value={decided ? `${pct(data.won.length, decided)}%` : "—"} hint={`${data.won.length} won · ${data.lost.length} lost`} tone="green" />
        <Kpi label="Win rate (value)" value={data.wonValue + data.lostValue ? `${pct(data.wonValue, data.wonValue + data.lostValue)}%` : "—"} hint={`${formatIDR(data.wonValue)} of ${formatIDR(data.wonValue + data.lostValue)}`} />
        <Kpi label="Average won deal" value={data.won.length ? formatIDR(data.wonValue / data.won.length) : "—"} />
        <Kpi label="Lost value" value={formatIDR(data.lostValue)} tone={data.lostValue ? "red" : undefined} hint={data.lost.length ? `avg ${formatIDR(data.lostValue / data.lost.length)}` : undefined} />
      </KpiRow>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Lost reasons" hint="Pareto by value — the reasons behind most of the lost pipeline come first. Recorded in the lost-deal dialog.">
          {data.reasonRows.length ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-sg-line">
                  <Th>Reason</Th>
                  <Th right>Deals</Th>
                  <Th right>Value</Th>
                  <Th right>Cum. %</Th>
                </tr>
              </thead>
              <tbody>
                {data.reasonRows.map(([r, x]) => {
                  cum += x.value;
                  return (
                    <tr key={r} className="border-b border-sg-line last:border-b-0">
                      <Td className={r === "Not recorded" ? "text-sg-dim" : "text-sg-text"}>
                        {r}
                        <div className="mt-1 h-1 rounded-full bg-sg-card-3">
                          <div className="h-full rounded-full bg-soft-red" style={{ width: `${(x.value / lostTotal) * 100}%` }} />
                        </div>
                      </Td>
                      <Td right>{x.n}</Td>
                      <Td right>{formatIDR(x.value)}</Td>
                      <Td right className="text-sg-muted">{Math.round((cum / lostTotal) * 100)}%</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="py-4 text-center text-xs text-sg-dim">No deals lost in this period.</p>
          )}
          {data.competitors.length ? <p className="mt-3 text-2xs text-sg-muted">Lost to: {data.competitors.map(([c, n]) => `${c} (${n})`).join(" · ")}</p> : null}
          {data.winReasons.length ? <p className="mt-1 text-2xs text-sg-muted">Why we won: {data.winReasons.map(([c, n]) => `${c} (${n})`).join(" · ")}</p> : null}
        </Panel>
        <Panel title="Win rate by capability" hint="Count-based win rate; bar shows won share of closed value.">
          <BarList
            rows={data.byCapability.map((r) => ({ key: r.key, label: r.key, value: r.wonValue + r.lostValue ? (r.wonValue / (r.wonValue + r.lostValue)) * 100 : 0, right: `${r.rate}% · ${r.won}/${r.won + r.lost}`, color: "green", sub: `${formatIDR(r.wonValue)} won · ${formatIDR(r.lostValue)} lost` }))}
          />
          <div className="mt-4 border-t border-sg-line pt-3">
            <div className="sg-eyebrow mb-2">By owner</div>
            <BarList rows={data.byOwner.map((r) => ({ key: r.key, label: userName(users, r.key), value: r.rate, right: `${r.rate}% · ${formatIDR(r.wonValue)}`, color: "cyan" }))} />
          </div>
          <div className="mt-4 border-t border-sg-line pt-3">
            <div className="sg-eyebrow mb-2">By deal type</div>
            <BarList rows={data.byType.map((r) => ({ key: r.key, label: r.key, value: r.rate, right: `${r.rate}% · ${r.won}/${r.won + r.lost}`, color: "magenta" }))} />
          </div>
        </Panel>
      </div>
      <Panel title={`Closed deals · ${data.closed.length}`} csv={{ name: "win-loss", rows: data.closed, columns }}>
        <DealTable
          deals={data.closed}
          extra={(d) => (
            <>
              <Td>{stageMap.get(d.stageId)?.closed === "won" ? <Chip color="green">Won</Chip> : <Chip color="red">Lost</Chip>}</Td>
              <Td className="text-sg-muted">{formatDate(closedAt.get(d.id))}</Td>
              <Td className="max-w-[240px] truncate text-2xs text-sg-muted" title={d.closeNote}>
                {stageMap.get(d.stageId)?.closed === "lost" ? [d.lostReason ?? "No reason recorded", d.lostToCompetitor].filter(Boolean).join(" · ") : (d.winReason ?? d.poNumber ?? "")}
              </Td>
            </>
          )}
          extraHead={
            <>
              <Th>Result</Th>
              <Th>Closed</Th>
              <Th>Reason</Th>
            </>
          }
        />
      </Panel>
    </div>
  );
}

function DealTable({ deals, extra, extraHead }: { deals: Deal[]; extra?: (d: Deal) => React.ReactNode; extraHead?: React.ReactNode }) {
  const users = useCrm((s) => s.users);
  if (!deals.length) return <p className="py-4 text-center text-xs text-sg-dim">No deals.</p>;
  return (
    <div className="-mx-4 -mb-4 overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-sg-line">
            <Th className="pl-4">Deal</Th>
            <Th right>Amount</Th>
            <Th>Owner</Th>
            {extraHead}
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => {
            const owner = users.find((u) => u.id === d.ownerId);
            return (
              <tr key={d.id} className="border-b border-sg-line last:border-b-0 hover:bg-sg-card-2/50">
                <Td className="pl-4">
                  <Link href={`/deals/${d.id}`} className="font-semibold text-sg-white hover:underline">
                    {d.name}
                  </Link>
                  <div className="text-2xs text-sg-dim">{d.capability}</div>
                </Td>
                <Td right className="font-semibold text-sg-white">
                  {formatIDR(d.amount)}
                </Td>
                <Td>
                  <span className="flex items-center gap-1.5 text-xs text-sg-muted">
                    <Avatar user={owner} size="xs" /> {owner?.name.split(" ")[0]}
                  </span>
                </Td>
                {extra?.(d)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────── sales cycle & time in stage ───────────── */

export function CycleTimeReport({ filters }: { filters: ReportFilters }) {
  const { scoped, stageMap, closedAt, dealPipelines, history } = useDealData(filters);
  const activities = useCrm((s) => s.activities);
  const data = useMemo(() => {
    const now = Date.now();
    const won = scoped.filter((d) => stageMap.get(d.stageId)?.closed === "won" && inPeriod(closedAt.get(d.id), filters.period));
    const cycles = won.map((d) => ({ d, days: Math.max(0, daysBetween(d.createdAt, closedAt.get(d.id) ?? d.stageEnteredAt)) }));
    const values = cycles.map((c) => c.days);
    const groupMedian = (key: (d: Deal) => string) => {
      const m = new Map<string, number[]>();
      cycles.forEach((c) => m.set(key(c.d), [...(m.get(key(c.d)) ?? []), c.days]));
      return Array.from(m.entries()).map(([k, v]) => ({ key: k, median: median(v) ?? 0, n: v.length })).sort((a, b) => b.median - a.median);
    };
    const size = (d: Deal) => (d.amount < 1_000_000_000 ? "Under Rp 1 M" : d.amount < 5_000_000_000 ? "Rp 1–5 M" : "Rp 5 M and above");
    // time in stage from stage visits (history / timeline), open deals count up to now
    const stageByName = new Map<string, string>();
    dealPipelines.forEach((p) => p.stages.forEach((s) => stageByName.set(s.name, s.id)));
    const durations = new Map<string, number[]>();
    scoped.forEach((d) => {
      const visits = stageVisits(d, history, activities, stageByName);
      visits.forEach((v, i) => {
        const st = stageMap.get(v.stageId);
        if (!st || st.closed) return;
        const end = visits[i + 1]?.at ?? (stageMap.get(d.stageId)?.closed ? null : new Date(now).toISOString());
        if (!end) return;
        durations.set(v.stageId, [...(durations.get(v.stageId) ?? []), Math.max(0, daysBetween(v.at, end))]);
      });
    });
    const pipelineStages = (filters.pipelineId ? dealPipelines.filter((p) => p.id === filters.pipelineId) : dealPipelines).flatMap((p) => p.stages.filter((s) => !s.closed).map((s) => ({ stage: s, pipeline: p.name })));
    const open = scoped.filter((d) => !stageMap.get(d.stageId)?.closed);
    return {
      won: cycles.sort((a, b) => b.days - a.days),
      median: median(values),
      mean: mean(values),
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      byCapability: groupMedian((d) => d.capability),
      bySize: groupMedian(size),
      stages: pipelineStages.map(({ stage, pipeline }) => ({ stage, pipeline, median: median(durations.get(stage.id) ?? []), mean: mean(durations.get(stage.id) ?? []), n: (durations.get(stage.id) ?? []).length })),
      openAge: median(open.map((d) => daysBetween(d.createdAt, now))),
      openCount: open.length,
    };
  }, [scoped, stageMap, closedAt, dealPipelines, history, activities, filters.period, filters.pipelineId]);

  const slowest = data.stages.reduce<number>((m, s) => Math.max(m, s.median ?? 0), 0);
  const columns: CsvColumn<{ d: Deal; days: number }>[] = [
    { header: "Deal", value: (r) => r.d.name },
    { header: "Created", value: (r) => csvDate(r.d.createdAt) },
    { header: "Won", value: (r) => csvDate(closedAt.get(r.d.id)) },
    { header: "Cycle (days)", value: (r) => Math.round(r.days) },
    { header: "Amount (IDR)", value: (r) => r.d.amount },
    { header: "Capability", value: (r) => r.d.capability },
  ];
  return (
    <div className="space-y-4">
      <KpiRow>
        <Kpi label="Median sales cycle" value={fmtDays(data.median)} hint={`${data.won.length} won deal${data.won.length === 1 ? "" : "s"} · created → won`} tone="cyan" />
        <Kpi label="Average" value={fmtDays(data.mean)} />
        <Kpi label="Fastest · slowest" value={`${fmtDays(data.min)} · ${fmtDays(data.max)}`} />
        <Kpi label="Open deal age (median)" value={fmtDays(data.openAge)} hint={`${data.openCount} open deals`} />
      </KpiRow>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Time in stage" hint="Median days a deal spends in each stage (from the deal history; open deals count up to today). The longest stage is the bottleneck.">
          <BarList rows={data.stages.map((s) => ({ key: s.stage.id, label: filters.pipelineId ? s.stage.name : `${s.stage.name} · ${s.pipeline}`, value: s.median ?? 0, right: `${fmtDays(s.median)} median · ${s.n}`, color: (s.median ?? 0) === slowest && slowest > 0 ? "orange" : "blue", sub: s.mean !== null ? `avg ${fmtDays(s.mean)}` : undefined }))} />
        </Panel>
        <Panel title="Cycle by capability and size" hint="Median created → won days.">
          <BarList rows={data.byCapability.map((r) => ({ key: r.key, label: r.key, value: r.median, right: `${fmtDays(r.median)} · ${r.n}`, color: "cyan" }))} />
          <div className="mt-4 border-t border-sg-line pt-3">
            <BarList rows={data.bySize.map((r) => ({ key: r.key, label: r.key, value: r.median, right: `${fmtDays(r.median)} · ${r.n}`, color: "magenta" }))} />
          </div>
        </Panel>
      </div>
      <Panel title="Won deals" csv={{ name: "sales-cycle", rows: data.won, columns }}>
        <DealTable
          deals={data.won.map((r) => r.d)}
          extraHead={
            <>
              <Th>Created</Th>
              <Th>Won</Th>
              <Th right>Cycle</Th>
            </>
          }
          extra={(d) => (
            <>
              <Td className="text-sg-muted">{formatDate(d.createdAt)}</Td>
              <Td className="text-sg-muted">{formatDate(closedAt.get(d.id))}</Td>
              <Td right className="text-sg-white">
                {fmtDays(data.won.find((r) => r.d.id === d.id)?.days ?? null)}
              </Td>
            </>
          )}
        />
      </Panel>
    </div>
  );
}

/* ───────────── stage conversion funnel ───────────── */

export function FunnelReport({ filters }: { filters: ReportFilters }) {
  const { scoped, stageMap, dealPipelines, history } = useDealData(filters);
  const activities = useCrm((s) => s.activities);
  const pipeline = dealPipelines.find((p) => p.id === filters.pipelineId) ?? dealPipelines[0];
  const data = useMemo(() => {
    if (!pipeline) return null;
    const open = pipeline.stages.filter((s) => !s.closed);
    const idx = new Map(open.map((s, i) => [s.id, i] as const));
    const stageByName = new Map(pipeline.stages.map((s) => [s.name, s.id] as const));
    const cohort = scoped.filter((d) => d.pipelineId === pipeline.id && inPeriod(d.createdAt, filters.period));
    const reached = open.map(() => 0);
    const lostAt = open.map(() => 0);
    let won = 0;
    let lost = 0;
    cohort.forEach((d) => {
      const closed = stageMap.get(d.stageId)?.closed;
      const visits = stageVisits(d, history, activities, stageByName);
      const maxIdx = closed === "won" ? open.length - 1 : visits.reduce((m, v) => Math.max(m, idx.get(v.stageId) ?? -1), idx.get(d.stageId) ?? -1);
      const top = Math.max(0, maxIdx);
      for (let i = 0; i <= top; i++) reached[i] += 1;
      if (closed === "won") won += 1;
      if (closed === "lost") {
        lost += 1;
        lostAt[top] += 1;
      }
    });
    return { open, reached, lostAt, won, lost, total: cohort.length };
  }, [pipeline, scoped, stageMap, history, activities, filters.period]);
  if (!pipeline || !data) return null;
  return (
    <div className="space-y-4">
      <KpiRow>
        <Kpi label="Deals in cohort" value={data.total} hint={`created in ${filters.period.label.toLowerCase()} · ${pipeline.name}`} />
        <Kpi label="Won" value={data.won} tone="green" hint={`${pct(data.won, data.total)}% of the cohort`} />
        <Kpi label="Lost" value={data.lost} tone={data.lost ? "red" : undefined} />
        <Kpi label="Still open" value={data.total - data.won - data.lost} />
      </KpiRow>
      <Panel title={`Stage conversion — ${pipeline.name}`} hint={filters.pipelineId ? "Deals that reached each stage (from deal history and stage-change notes); conversion is to the next stage." : `Showing ${pipeline.name}; pick a pipeline in the filters for another.`}>
        <ol className="space-y-3">
          {data.open.map((s, i) => {
            const n = data.reached[i];
            const next = i < data.open.length - 1 ? data.reached[i + 1] : data.won;
            return (
              <li key={s.id}>
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="font-semibold text-sg-text">{s.name}</span>
                  <span className="sg-num ml-auto text-sg-white">{n}</span>
                  <span className="w-48 text-right text-2xs text-sg-dim">
                    {n ? `${pct(next, n)}% → ${i < data.open.length - 1 ? data.open[i + 1].name : "won"}` : "—"}
                    {data.lostAt[i] ? ` · ${data.lostAt[i]} lost here` : ""}
                  </span>
                </div>
                <div className="mt-1 h-5 rounded bg-sg-card-3">
                  <div className="flex h-full items-center rounded bg-soft-blue/70 px-2 text-[10px] font-semibold text-sg-bg" style={{ width: `${data.total ? Math.max(4, (n / data.total) * 100) : 0}%` }}>
                    {data.total ? `${pct(n, data.total)}%` : ""}
                  </div>
                </div>
              </li>
            );
          })}
          <li>
            <div className="flex items-baseline gap-2 text-xs">
              <span className="font-semibold text-soft-green">Won</span>
              <span className="sg-num ml-auto text-sg-white">{data.won}</span>
              <span className="w-48" />
            </div>
            <div className="mt-1 h-5 rounded bg-sg-card-3">
              <div className="h-full rounded bg-soft-green/70" style={{ width: `${data.total ? (data.won / data.total) * 100 : 0}%` }} />
            </div>
          </li>
        </ol>
      </Panel>
    </div>
  );
}

/* ───────────── forecast categories vs target ───────────── */

const CAT_COLOR: Record<ForecastCategory, "green" | "cyan" | "blue" | "red"> = { commit: "green", best_case: "cyan", pipeline: "blue", omitted: "red" };

export function ForecastReport({ filters }: { filters: ReportFilters }) {
  const { scoped, stageMap, closedAt } = useDealData(filters);
  const users = useCrm((s) => s.users);
  const targets = useCrm((s) => s.salesTargets);
  const me = useCrm((s) => s.currentUserId);
  const changeDeal = useCrm((s) => s.changeDeal);
  const undoDealChange = useCrm((s) => s.undoDealChange);
  const notify = useUi((s) => s.notify);
  const access = useAccess();
  const meUser = users.find((u) => u.id === me);
  const canTarget = access.admin || access.prc || meUser?.team === "Leadership" || /head of sales/i.test(meUser?.title ?? "");
  const [quarter, setQuarter] = useState(() => (/^\d{4}-Q\d$/.test(filters.period.key) ? filters.period.key : quarterKey(Date.now())));
  const [editing, setEditing] = useState(false);
  const qp = quarterPeriod(quarter);

  const targetFor = (period: string, ownerId: string | null) => targets.find((t) => t.period === period && t.ownerId === ownerId)?.amount ?? null;
  const monthTarget = (m: string, ownerId: string | null) => targetFor(m, ownerId) ?? ((targetFor(quarter, ownerId) ?? 0) / 3 || null);

  const data = useMemo(() => {
    const now = Date.now();
    const won = scoped.filter((d) => stageMap.get(d.stageId)?.closed === "won");
    const open = scoped.filter((d) => !stageMap.get(d.stageId)?.closed);
    const months = monthsOfQuarter(quarter).map((m) => {
      const p = monthPeriod(m);
      const closed = won.filter((d) => inPeriod(closedAt.get(d.id), p)).reduce((s, d) => s + d.amount, 0);
      const cats: Record<ForecastCategory, number> = { commit: 0, best_case: 0, pipeline: 0, omitted: 0 };
      let weighted = 0;
      open.filter((d) => inPeriod(d.closeDate, p)).forEach((d) => {
        cats[forecastOf(d, stageMap.get(d.stageId))] += d.amount;
        weighted += d.amount * (stageMap.get(d.stageId)?.probability ?? 0);
      });
      return { key: m, label: p.label, closed, ...cats, weighted, target: monthTarget(m, filters.ownerId || null), past: p.to < now };
    });
    const tot = months.reduce((a, m) => ({ closed: a.closed + m.closed, commit: a.commit + m.commit, best_case: a.best_case + m.best_case, pipeline: a.pipeline + m.pipeline, weighted: a.weighted + m.weighted }), { closed: 0, commit: 0, best_case: 0, pipeline: 0, weighted: 0 });
    const overdue = open.filter((d) => Date.parse(d.closeDate) < now);
    const inQuarter = open.filter((d) => inPeriod(d.closeDate, qp)).sort((a, b) => a.closeDate.localeCompare(b.closeDate));
    const owners = Array.from(new Set([...scoped.map((d) => d.ownerId), ...targets.filter((t) => t.ownerId && t.period === quarter).map((t) => t.ownerId as string)]));
    const byOwner = owners
      .map((o) => {
        const mine = (arr: Deal[]) => arr.filter((d) => d.ownerId === o);
        const closed = mine(won).filter((d) => inPeriod(closedAt.get(d.id), qp)).reduce((s, d) => s + d.amount, 0);
        const cat = (c: ForecastCategory) => mine(inQuarter).filter((d) => forecastOf(d, stageMap.get(d.stageId)) === c).reduce((s, d) => s + d.amount, 0);
        return { ownerId: o, target: targetFor(quarter, o), closed, commit: cat("commit"), best: cat("best_case"), pipeline: cat("pipeline") };
      })
      .filter((r) => r.target || r.closed || r.commit || r.best || r.pipeline)
      .sort((a, b) => (b.target ?? 0) - (a.target ?? 0));
    return { months, tot, overdue, inQuarter, byOwner };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, stageMap, closedAt, quarter, targets, filters.ownerId]);

  const qTarget = targetFor(quarter, filters.ownerId || null) ?? (data.months.every((m) => m.target) ? data.months.reduce((s, m) => s + (m.target ?? 0), 0) : null);
  const committed = data.tot.closed + data.tot.commit;
  const gap = qTarget !== null ? qTarget - committed : null;
  const coverage = gap && gap > 0 ? (data.tot.best_case + data.tot.pipeline) / gap : null;

  const setCategory = (d: Deal, v: string) => {
    const undo = changeDeal(d.id, { forecastCategory: v ? (v as ForecastCategory) : undefined });
    if (undo) notify(`${d.name.split(" — ")[0]} → ${v ? FORECAST_META[v as ForecastCategory].label : "stage default"}`, { label: "Undo", run: () => undoDealChange(undo) });
  };

  const columns: CsvColumn<Deal>[] = [
    { header: "Deal", value: (d) => d.name },
    { header: "Close date", value: (d) => csvDate(d.closeDate) },
    { header: "Amount (IDR)", value: (d) => d.amount },
    { header: "Stage", value: (d) => stageMap.get(d.stageId)?.name ?? "" },
    { header: "Probability %", value: (d) => Math.round((stageMap.get(d.stageId)?.probability ?? 0) * 100) },
    { header: "Forecast category", value: (d) => FORECAST_META[forecastOf(d, stageMap.get(d.stageId))].label },
    { header: "Category set by owner", value: (d) => (d.forecastCategory ? "yes" : "no (stage default)") },
    { header: "Owner", value: (d) => userName(users, d.ownerId) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={quarter} onChange={(e) => setQuarter(e.target.value)} wrapperClassName="w-40" aria-label="Quarter">
          {[-2, -1, 0, 1, 2].map((n) => {
            const k = shiftQuarter(quarterKey(Date.now()), n);
            return (
              <option key={k} value={k}>
                {quarterPeriod(k).label}
              </option>
            );
          })}
        </Select>
        <span className="text-2xs text-sg-dim">Open deals count in the month of their close date (WIB). {filters.ownerId ? `Target and deals for ${userName(users, filters.ownerId)}.` : "Team target."}</span>
        {canTarget ? (
          <Button className="ml-auto print:hidden" variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil /> Edit targets
          </Button>
        ) : null}
      </div>
      <KpiRow>
        <Kpi label={`Target ${qp.label}`} value={qTarget !== null ? formatIDR(qTarget) : "Not set"} hint={canTarget ? undefined : "Set by Leadership / Head of Sales"} />
        <Kpi label="Closed won + Commit" value={formatIDR(committed)} hint={qTarget ? `${pct(committed, qTarget)}% of target` : `${formatIDR(data.tot.closed)} closed`} tone="green" />
        <Kpi label="Gap to target" value={gap === null ? "—" : gap <= 0 ? "Covered" : formatIDR(gap)} tone={gap !== null && gap > 0 ? "orange" : "green"} hint={coverage !== null ? `Best case + pipeline cover ${coverage.toFixed(1)}× the gap` : undefined} />
        <Kpi label="Weighted (stage %)" value={formatIDR(data.tot.weighted + data.tot.closed)} hint="closed + Σ amount × probability" />
      </KpiRow>
      <Panel title="By close month" hint="Closed won, then open deals by forecast category. The owner sets the category on the deal (or here); otherwise it follows the stage probability.">
        <Legend items={[{ label: "Closed won", color: "orange" }, ...FORECAST_ORDER.filter((c) => c !== "omitted").map((c) => ({ label: FORECAST_META[c].label, color: CAT_COLOR[c] }))]} />
        <div className="mt-3 space-y-4">
          {data.months.map((m) => {
            const total = Math.max(m.closed + m.commit + m.best_case + m.pipeline, m.target ?? 0, 1);
            return (
              <div key={m.key}>
                <div className="mb-1 flex flex-wrap items-baseline gap-x-3 text-xs">
                  <span className="font-semibold text-sg-white">{m.label}</span>
                  <span className="text-sg-muted">closed {formatIDR(m.closed)}</span>
                  <span className="text-soft-green">commit {formatIDR(m.commit)}</span>
                  <span className="text-soft-cyan">best {formatIDR(m.best_case)}</span>
                  <span className="text-soft-blue">pipeline {formatIDR(m.pipeline)}</span>
                  <span className="ml-auto text-sg-dim">target {m.target ? formatIDR(m.target) : "—"}</span>
                </div>
                <div className="relative">
                  <StackBar
                    label={m.label}
                    total={total}
                    segments={[
                      { key: "closed", value: m.closed, color: "orange", label: "Closed won" },
                      { key: "commit", value: m.commit, color: "green", label: "Commit" },
                      { key: "best", value: m.best_case, color: "cyan", label: "Best case" },
                      { key: "pipe", value: m.pipeline, color: "blue", label: "Pipeline" },
                    ]}
                  />
                  {m.target ? <div aria-hidden className="absolute -top-1 h-5 w-0.5 bg-sg-white" style={{ left: `${(m.target / total) * 100}%` }} title={`Target ${formatIDR(m.target)}`} /> : null}
                </div>
              </div>
            );
          })}
        </div>
        {data.overdue.length ? <p className="mt-3 text-2xs text-soft-orange">{data.overdue.length} open deal{data.overdue.length === 1 ? " has" : "s have"} a close date in the past ({formatIDR(data.overdue.reduce((s, d) => s + d.amount, 0))}) — update them so the forecast is real.</p> : null}
      </Panel>
      {!filters.ownerId ? (
        <Panel title={`By owner — ${qp.label}`}>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-sg-line">
                <Th>Owner</Th>
                <Th right>Target</Th>
                <Th right>Closed</Th>
                <Th right>Commit</Th>
                <Th right>Best case</Th>
                <Th right>Pipeline</Th>
                <Th right>Gap</Th>
              </tr>
            </thead>
            <tbody>
              {data.byOwner.map((r) => {
                const g = r.target !== null ? r.target - r.closed - r.commit : null;
                return (
                  <tr key={r.ownerId} className="border-b border-sg-line last:border-b-0">
                    <Td className="text-sg-text">{userName(users, r.ownerId)}</Td>
                    <Td right>{r.target !== null ? formatIDR(r.target) : "—"}</Td>
                    <Td right>{formatIDR(r.closed)}</Td>
                    <Td right className="text-soft-green">{formatIDR(r.commit)}</Td>
                    <Td right className="text-soft-cyan">{formatIDR(r.best)}</Td>
                    <Td right className="text-soft-blue">{formatIDR(r.pipeline)}</Td>
                    <Td right className={g !== null && g > 0 ? "text-soft-orange" : "text-soft-green"}>{g === null ? "—" : g <= 0 ? "covered" : formatIDR(g)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      ) : null}
      <Panel title={`Open deals closing in ${qp.label} · ${data.inQuarter.length}`} csv={{ name: `forecast-${quarter}`, rows: data.inQuarter, columns }}>
        <DealTable
          deals={data.inQuarter}
          extraHead={
            <>
              <Th>Close</Th>
              <Th>Stage</Th>
              <Th>Category</Th>
            </>
          }
          extra={(d) => {
            const st = stageMap.get(d.stageId);
            const cat = forecastOf(d, st);
            const mayEdit = d.ownerId === me || canTarget;
            return (
              <>
                <Td className="text-sg-muted">{formatDate(d.closeDate)}</Td>
                <Td className="text-2xs text-sg-muted">
                  {st?.name} · {Math.round((st?.probability ?? 0) * 100)}%
                </Td>
                <Td>
                  {mayEdit ? (
                    <Select value={d.forecastCategory ?? ""} onChange={(e) => setCategory(d, e.target.value)} wrapperClassName="w-36 print:hidden" aria-label={`Forecast category for ${d.name}`}>
                      <option value="">{FORECAST_META[forecastOf({ forecastCategory: undefined }, st)].label} (stage)</option>
                      {FORECAST_ORDER.map((c) => (
                        <option key={c} value={c}>
                          {FORECAST_META[c].label}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                  <Chip color={CAT_COLOR[cat]} className={mayEdit ? "hidden print:inline-flex" : undefined}>
                    {FORECAST_META[cat].label}
                  </Chip>
                </Td>
              </>
            );
          }}
        />
      </Panel>
      <TargetsDialog open={editing} onOpenChange={setEditing} quarter={quarter} />
    </div>
  );
}

function TargetsDialog({ open, onOpenChange, quarter }: { open: boolean; onOpenChange: (v: boolean) => void; quarter: string }) {
  const users = useCrm((s) => s.users);
  const targets = useCrm((s) => s.salesTargets);
  const setSalesTarget = useCrm((s) => s.setSalesTarget);
  const notify = useUi((s) => s.notify);
  const sellers = users.filter((u) => u.team === "Sales" || u.team === "Service" || targets.some((t) => t.ownerId === u.id && t.period === quarter));
  const initial = () => Object.fromEntries([["team", targets.find((t) => t.period === quarter && !t.ownerId)?.amount ?? null], ...sellers.map((u) => [u.id, targets.find((t) => t.period === quarter && t.ownerId === u.id)?.amount ?? null])]) as Record<string, number | null>;
  const [values, setValues] = useState<Record<string, number | null>>(initial);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setValues(initial());
  }
  const sumOwners = sellers.reduce((s, u) => s + (values[u.id] ?? 0), 0);
  const save = () => {
    setSalesTarget(quarter, null, values.team ?? null);
    sellers.forEach((u) => setSalesTarget(quarter, u.id, values[u.id] ?? null));
    notify(`Targets for ${quarterPeriod(quarter).label} saved`);
    onOpenChange(false);
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Sales targets — ${quarterPeriod(quarter).label}`}
      description="Closed-won value (excl. VAT). Months without their own target use a third of the quarter."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save targets
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Team target" hint={sumOwners ? `Owner targets add up to ${formatIDR(sumOwners, "full")}` : undefined}>
          <MoneyInput value={values.team} onValueChange={(v) => setValues((x) => ({ ...x, team: v }))} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          {sellers.map((u) => (
            <Field key={u.id} label={u.name}>
              <MoneyInput value={values[u.id]} onValueChange={(v) => setValues((x) => ({ ...x, [u.id]: v }))} />
            </Field>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/* ───────────── pipeline changes vs a snapshot ───────────── */

type Bucket = "new" | "increased" | "decreased" | "won" | "lost" | "removed" | "forward" | "back" | "pushed" | "pulled";
const BUCKET: Record<Bucket, { label: string; color: "green" | "red" | "cyan" | "orange" | "yellow" | "blue" | "magenta"; sign: 1 | -1 | 0 }> = {
  new: { label: "New / reopened", color: "cyan", sign: 1 },
  increased: { label: "Amount increased", color: "green", sign: 1 },
  decreased: { label: "Amount decreased", color: "orange", sign: -1 },
  won: { label: "Closed won", color: "green", sign: -1 },
  lost: { label: "Closed lost", color: "red", sign: -1 },
  removed: { label: "Deleted", color: "red", sign: -1 },
  forward: { label: "Moved forward", color: "blue", sign: 0 },
  back: { label: "Moved back", color: "yellow", sign: 0 },
  pushed: { label: "Close date pushed", color: "magenta", sign: 0 },
  pulled: { label: "Close date pulled in", color: "cyan", sign: 0 },
};

export function PipelineChangesReport({ filters }: { filters: ReportFilters }) {
  const deals = useCrm((s) => s.deals);
  const pipelines = useCrm((s) => s.pipelines);
  const snapshots = useCrm((s) => s.pipelineSnapshots);
  const history = useCrm((s) => s.dealHistory);
  const users = useCrm((s) => s.users);
  const take = useCrm((s) => s.takePipelineSnapshot);
  const remove = useCrm((s) => s.deletePipelineSnapshot);
  const notify = useUi((s) => s.notify);
  const sorted = useMemo(() => [...snapshots].sort((a, b) => b.at.localeCompare(a.at)), [snapshots]);
  const defaultSnap = sorted.find((s) => Date.now() - Date.parse(s.at) >= 6 * DAY) ?? sorted[sorted.length - 1];
  const [snapId, setSnapId] = useState<string>("");
  const snap: PipelineSnapshot | undefined = sorted.find((s) => s.id === snapId) ?? defaultSnap;
  const [open, setOpen] = useState<Bucket | null>(null);

  const data = useMemo(() => {
    if (!snap) return null;
    const stageMap = new Map(pipelines.flatMap((p) => p.stages.map((s, i) => [s.id, { ...s, i, pipelineId: p.id }] as const)));
    const keep = (d: { pipelineId: string; ownerId: string }) => pipelines.some((p) => p.id === d.pipelineId && p.objectType === "deal") && (!filters.pipelineId || d.pipelineId === filters.pipelineId) && (!filters.ownerId || d.ownerId === filters.ownerId);
    const before = new Map(snap.deals.filter(keep).map((d) => [d.id, d] as const));
    const now = new Map(deals.filter(keep).map((d) => [d.id, d] as const));
    const isOpen = (stageId: string) => !stageMap.get(stageId)?.closed;
    const out: Record<Bucket, { id: string; name: string; delta: number; detail: string }[]> = { new: [], increased: [], decreased: [], won: [], lost: [], removed: [], forward: [], back: [], pushed: [], pulled: [] };
    let start = 0;
    let end = 0;
    before.forEach((b) => isOpen(b.stageId) && (start += b.amount));
    now.forEach((d) => isOpen(d.stageId) && (end += d.amount));
    now.forEach((d) => {
      const b = before.get(d.id);
      const openNow = isOpen(d.stageId);
      if (!b || !isOpen(b.stageId)) {
        if (openNow) out.new.push({ id: d.id, name: d.name, delta: d.amount, detail: b ? `reopened from ${stageMap.get(b.stageId)?.name}` : "not in the snapshot" });
        return;
      }
      if (!openNow) {
        const closed = stageMap.get(d.stageId)?.closed;
        out[closed === "won" ? "won" : "lost"].push({ id: d.id, name: d.name, delta: -b.amount, detail: `from ${stageMap.get(b.stageId)?.name}` });
        return;
      }
      if (d.amount !== b.amount) out[d.amount > b.amount ? "increased" : "decreased"].push({ id: d.id, name: d.name, delta: d.amount - b.amount, detail: `${formatIDR(b.amount)} → ${formatIDR(d.amount)}` });
      const si = stageMap.get(d.stageId)?.i ?? 0;
      const bi = stageMap.get(b.stageId)?.i ?? 0;
      if (d.stageId !== b.stageId) out[si > bi ? "forward" : "back"].push({ id: d.id, name: d.name, delta: 0, detail: `${stageMap.get(b.stageId)?.name} → ${stageMap.get(d.stageId)?.name}` });
      const dd = Math.round((Date.parse(d.closeDate) - Date.parse(b.closeDate)) / DAY);
      if (Math.abs(dd) >= 1) out[dd > 0 ? "pushed" : "pulled"].push({ id: d.id, name: d.name, delta: 0, detail: `${formatDate(b.closeDate)} → ${formatDate(d.closeDate)} (${dd > 0 ? "+" : ""}${dd}d)` });
    });
    before.forEach((b) => {
      if (!now.has(b.id) && isOpen(b.stageId)) out.removed.push({ id: b.id, name: b.name, delta: -b.amount, detail: "deleted since the snapshot" });
    });
    const log = (history ?? []).filter((h) => h.at >= snap.at && now.has(h.dealId)).sort((a, b) => b.at.localeCompare(a.at));
    return { out, start, end, log, stageMap, nowMap: now };
  }, [snap, deals, pipelines, history, filters.pipelineId, filters.ownerId]);

  if (!snap || !data)
    return (
      <Panel title="Pipeline changes" hint="Compares today’s pipeline with a saved snapshot.">
        <div className="py-6 text-center">
          <p className="text-xs text-sg-dim">No snapshots yet — one is taken automatically every week.</p>
          <Button className="mt-2" size="sm" variant="outline" onClick={() => take()}>
            <Database /> Take a snapshot now
          </Button>
        </div>
      </Panel>
    );

  const sum = (b: Bucket) => data.out[b].reduce((s, x) => s + x.delta, 0);
  const steps: { key: Bucket | "start" | "end"; label: string; value: number; color: "blue" | "green" | "red" | "cyan" | "orange" | "yellow" | "magenta" }[] = [
    { key: "start", label: `Open pipeline ${formatDate(snap.at)}`, value: data.start, color: "blue" },
    ...(["new", "increased", "decreased", "won", "lost", "removed"] as Bucket[]).map((b) => ({ key: b, label: BUCKET[b].label, value: sum(b), color: BUCKET[b].color })),
    { key: "end", label: "Open pipeline today", value: data.end, color: "blue" },
  ];
  const max = Math.max(1, data.start, data.end);
  let running = 0;
  const fieldLabel: Record<string, string> = { amount: "Amount", closeDate: "Close date", stageId: "Stage", ownerId: "Owner", forecastCategory: "Forecast" };
  const fmtVal = (field: string, v: string | number | null) => (v === null || v === undefined || v === "" ? "—" : field === "amount" ? formatIDR(Number(v)) : field === "closeDate" ? formatDate(String(v)) : field === "stageId" ? (data.stageMap.get(String(v))?.name ?? String(v)) : field === "ownerId" ? userName(users, String(v)) : String(v).replace("_", " "));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={snap.id} onChange={(e) => setSnapId(e.target.value)} wrapperClassName="w-72" aria-label="Compare with snapshot">
          {sorted.map((s) => (
            <option key={s.id} value={s.id}>
              {formatDate(s.at, "datetime")} · {s.label} ({relativeTime(s.at)})
            </option>
          ))}
        </Select>
        <Button size="sm" variant="outline" className="print:hidden" onClick={() => { const id = take(); setSnapId(id); notify("Snapshot saved — compare against it next week"); }}>
          <Database /> Snapshot now
        </Button>
        {snap.source === "manual" ? (
          <Button size="sm" variant="ghost" className="print:hidden" onClick={() => { remove(snap.id); setSnapId(""); notify("Snapshot deleted"); }}>
            <Trash2 /> Delete snapshot
          </Button>
        ) : null}
        <span className="ml-auto text-2xs text-sg-dim">Weekly snapshots are taken automatically; the default compares with the latest one at least 6 days old.</span>
      </div>
      <KpiRow>
        <Kpi label="Open pipeline then" value={formatIDR(data.start)} hint={formatDate(snap.at)} />
        <Kpi label="Open pipeline now" value={formatIDR(data.end)} />
        <Kpi label="Net change" value={`${data.end - data.start >= 0 ? "+" : "−"}${formatIDR(Math.abs(data.end - data.start))}`} tone={data.end >= data.start ? "green" : "red"} hint={data.start ? `${Math.round(((data.end - data.start) / data.start) * 100)}%` : undefined} />
        <Kpi label="Won since" value={formatIDR(-sum("won"))} tone="green" hint={`${data.out.won.length} deal${data.out.won.length === 1 ? "" : "s"}`} />
      </KpiRow>
      <Panel title="What changed" hint="Waterfall from the snapshot’s open pipeline to today’s. Click a row for the deals behind it.">
        <ul className="space-y-1">
          {steps.map((s) => {
            const isTotal = s.key === "start" || s.key === "end";
            const from = isTotal ? 0 : s.value >= 0 ? running : running + s.value;
            const width = Math.abs(s.value);
            if (s.key === "start") running = s.value;
            else if (!isTotal) running += s.value;
            const bucket = isTotal ? null : (s.key as Bucket);
            const count = bucket ? data.out[bucket].length : null;
            return (
              <li key={s.key}>
                <button type="button" disabled={!bucket || !count} aria-expanded={bucket ? open === bucket : undefined} onClick={() => bucket && setOpen(open === bucket ? null : bucket)} className="grid w-full grid-cols-[180px_minmax(0,1fr)_120px] items-center gap-3 rounded px-1 py-1 text-left text-xs hover:bg-sg-card-2/50 disabled:hover:bg-transparent">
                  <span className={cn("flex items-center gap-1", isTotal ? "font-semibold text-sg-white" : "text-sg-text")}>
                    {bucket && count ? open === bucket ? <ChevronDown className="size-3" aria-hidden /> : <ChevronRight className="size-3" aria-hidden /> : <span className="w-3" />}
                    {s.label}
                    {count !== null ? <span className="text-sg-dim"> · {count}</span> : null}
                  </span>
                  <span className="relative h-4 rounded-sm bg-sg-card-3">
                    <span className={cn("absolute top-0 h-full rounded-sm", s.color === "blue" ? "bg-soft-blue" : s.color === "green" ? "bg-soft-green" : s.color === "red" ? "bg-soft-red" : s.color === "cyan" ? "bg-soft-cyan" : s.color === "orange" ? "bg-soft-orange" : s.color === "yellow" ? "bg-soft-yellow" : "bg-soft-magenta")} style={{ left: `${(from / max) * 100}%`, width: `${Math.max(width ? 0.5 : 0, (width / max) * 100)}%` }} />
                  </span>
                  <span className={cn("sg-num text-right font-semibold", isTotal ? "text-sg-white" : s.value > 0 ? "text-soft-green" : s.value < 0 ? "text-soft-red" : "text-sg-dim")}>
                    {isTotal ? formatIDR(s.value) : `${s.value > 0 ? "+" : s.value < 0 ? "−" : ""}${formatIDR(Math.abs(s.value))}`}
                  </span>
                </button>
                {bucket && open === bucket ? <BucketList rows={data.out[bucket]} /> : null}
              </li>
            );
          })}
        </ul>
        <div className="mt-4 grid gap-2 border-t border-sg-line pt-3 sm:grid-cols-2 lg:grid-cols-4">
          {(["forward", "back", "pushed", "pulled"] as Bucket[]).map((b) => (
            <button key={b} type="button" disabled={!data.out[b].length} onClick={() => setOpen(open === b ? null : b)} aria-expanded={open === b} className="rounded border border-sg-line px-3 py-2 text-left hover:border-sg-line-2 disabled:opacity-60">
              <div className="sg-eyebrow">{BUCKET[b].label}</div>
              <div className="sg-num text-lg font-bold text-sg-white">{data.out[b].length}</div>
            </button>
          ))}
        </div>
        {open && BUCKET[open].sign === 0 ? <BucketList rows={data.out[open]} /> : null}
      </Panel>
      <Panel
        title={`Change log since ${formatDate(snap.at)} · ${data.log.length}`}
        hint="Every tracked edit to amount, close date, stage, owner and forecast category (deal history)."
        csv={{
          name: "deal-changes",
          rows: data.log,
          columns: [
            { header: "When (WIB)", value: (h) => csvDate(h.at) },
            { header: "Deal", value: (h) => data.nowMap.get(h.dealId)?.name ?? h.dealId },
            { header: "Field", value: (h) => fieldLabel[h.field] ?? h.field },
            { header: "From", value: (h) => fmtVal(h.field, h.from) },
            { header: "To", value: (h) => fmtVal(h.field, h.to) },
            { header: "By", value: (h) => userName(users, h.byId) },
          ],
        }}
      >
        {data.log.length ? (
          <ul className="divide-y divide-sg-line text-xs">
            {data.log.slice(0, 60).map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline gap-2 py-1.5">
                <span className="w-24 shrink-0 text-2xs text-sg-dim">{formatDate(h.at, "short")}</span>
                <Link href={`/deals/${h.dealId}`} className="font-semibold text-sg-white hover:underline">
                  {data.nowMap.get(h.dealId)?.name}
                </Link>
                <span className="text-sg-muted">
                  {fieldLabel[h.field] ?? h.field}: {fmtVal(h.field, h.from)} → <span className="text-sg-text">{fmtVal(h.field, h.to)}</span>
                </span>
                <span className="ml-auto text-2xs text-sg-dim">{userName(users, h.byId)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-4 text-center text-xs text-sg-dim">No tracked edits since this snapshot.</p>
        )}
      </Panel>
    </div>
  );
}

function BucketList({ rows }: { rows: { id: string; name: string; delta: number; detail: string }[] }) {
  return (
    <ul className="mb-2 ml-5 mt-1 space-y-0.5 border-l border-sg-line pl-3">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-baseline gap-2 text-xs">
          <Link href={`/deals/${r.id}`} className="text-sg-white hover:underline">
            {r.name}
          </Link>
          <span className="text-2xs text-sg-dim">{r.detail}</span>
          {r.delta ? <span className={cn("sg-num ml-auto", r.delta > 0 ? "text-soft-green" : "text-soft-red")}>{`${r.delta > 0 ? "+" : "−"}${formatIDR(Math.abs(r.delta))}`}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/* ───────────── team activity ───────────── */

export function ActivityReport({ filters }: { filters: ReportFilters }) {
  const activities = useCrm((s) => s.activities);
  const deals = useCrm((s) => s.deals);
  const users = useCrm((s) => s.users);
  const pipelines = useCrm((s) => s.pipelines);
  const [win, setWin] = useState<7 | 30 | 90>(30);
  const data = useMemo(() => {
    const now = Date.now();
    const from = now - win * DAY;
    const wonStages = new Set(pipelines.flatMap((p) => p.stages).filter((s) => s.closed === "won").map((s) => s.id));
    const rows = users
      .map((u) => {
        const mine = activities.filter((a) => a.ownerId === u.id && Date.parse(a.timestamp) >= from && Date.parse(a.timestamp) <= now);
        const wa = mine.filter((a) => (a.type as string) === "whatsapp" || a.subject.startsWith("WhatsApp")).length;
        const count = (t: string) => mine.filter((a) => a.type === t && !a.subject.startsWith("WhatsApp")).length;
        const created = deals.filter((d) => d.ownerId === u.id && Date.parse(d.createdAt) >= from);
        const won = deals.filter((d) => d.ownerId === u.id && wonStages.has(d.stageId) && Date.parse(d.stageEnteredAt) >= from);
        return {
          user: u,
          calls: count("call"),
          connected: mine.filter((a) => a.type === "call" && a.callOutcome === "connected").length,
          emails: count("email"),
          meetings: count("meeting"),
          whatsapp: wa,
          tasksDone: mine.filter((a) => a.type === "task" && a.done).length,
          notes: count("note"),
          createdValue: created.reduce((s, d) => s + d.amount, 0),
          createdN: created.length,
          wonValue: won.reduce((s, d) => s + d.amount, 0),
          total: mine.filter((a) => a.type !== "jira").length,
        };
      })
      .filter((r) => (!filters.ownerId || r.user.id === filters.ownerId) && (r.total || r.createdN || r.wonValue))
      .sort((a, b) => b.total - a.total);
    return rows;
  }, [activities, deals, users, pipelines, win, filters.ownerId]);
  type Row = (typeof data)[number];
  const columns: CsvColumn<Row>[] = [
    { header: "Person", value: (r) => r.user.name },
    { header: "Team", value: (r) => r.user.team },
    { header: "Calls", value: (r) => r.calls },
    { header: "Connected calls", value: (r) => r.connected },
    { header: "Emails", value: (r) => r.emails },
    { header: "Meetings", value: (r) => r.meetings },
    { header: "WhatsApp", value: (r) => r.whatsapp },
    { header: "Tasks done", value: (r) => r.tasksDone },
    { header: "Notes", value: (r) => r.notes },
    { header: "Deals created", value: (r) => r.createdN },
    { header: "Pipeline created (IDR)", value: (r) => r.createdValue },
    { header: "Won (IDR)", value: (r) => r.wonValue },
  ];
  const max = Math.max(1, ...data.map((r) => r.total));
  return (
    <Panel
      title="Team activity"
      hint="Logged activities by owner (Jira mirrors excluded); WhatsApp counts messages logged from sequences or the WhatsApp quick action."
      csv={{ name: `team-activity-${win}d`, rows: data, columns }}
      actions={
        <div className="flex rounded border border-sg-line p-0.5 print:hidden" role="group" aria-label="Window">
          {([7, 30, 90] as const).map((w) => (
            <button key={w} type="button" aria-pressed={win === w} onClick={() => setWin(w)} className={cn("h-6 rounded-sm px-2 text-xs font-semibold", win === w ? "bg-sg-card-3 text-sg-white" : "text-sg-dim hover:text-sg-white")}>
              {w} days
            </button>
          ))}
        </div>
      }
    >
      <div className="-mx-4 -mb-4 overflow-x-auto">
        <table className="w-full min-w-[860px] text-xs">
          <thead>
            <tr className="border-b border-sg-line">
              <Th className="pl-4">Person</Th>
              <Th right>Calls</Th>
              <Th right>Emails</Th>
              <Th right>Meetings</Th>
              <Th right>WhatsApp</Th>
              <Th right>Tasks done</Th>
              <Th>Activity</Th>
              <Th right>Pipeline created</Th>
              <Th right>Won</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.user.id} className="border-b border-sg-line last:border-b-0">
                <Td className="pl-4">
                  <span className="flex items-center gap-2 text-sg-text">
                    <Avatar user={r.user} size="xs" /> {r.user.name}
                  </span>
                  <div className="pl-7 text-[10px] text-sg-dim">{r.user.team}</div>
                </Td>
                <Td right title={`${r.connected} connected`}>
                  {r.calls}
                  {r.calls ? <span className="text-[10px] text-sg-dim"> ({r.connected})</span> : null}
                </Td>
                <Td right>{r.emails}</Td>
                <Td right>{r.meetings}</Td>
                <Td right className="text-soft-green">{r.whatsapp}</Td>
                <Td right>{r.tasksDone}</Td>
                <Td className="w-40">
                  <div className="h-1.5 rounded-full bg-sg-card-3">
                    <div className="h-full rounded-full bg-soft-magenta" style={{ width: `${(r.total / max) * 100}%` }} />
                  </div>
                </Td>
                <Td right>
                  {formatIDR(r.createdValue)}
                  <span className="text-[10px] text-sg-dim"> · {r.createdN}</span>
                </Td>
                <Td right className="text-soft-green">{formatIDR(r.wonValue)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.length ? <p className="py-6 text-center text-xs text-sg-dim">No logged activity in this window.</p> : null}
      </div>
    </Panel>
  );
}


