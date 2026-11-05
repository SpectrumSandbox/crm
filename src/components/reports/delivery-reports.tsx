"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Lock, TriangleAlert } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import { issueStatusMeta, issueTypeMeta } from "@/lib/meta";
import type { Issue } from "@/lib/types";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { csvDate, type CsvColumn } from "@/lib/csv";
import { Chip } from "@/components/ui/misc";
import { directCostTotal, proposalEconomics, rateReview } from "@/lib/initiatives/engine";
import { changeOrderImpact, latestUpdate, withChangeOrders } from "@/lib/initiatives/team-rules";
import { Cite } from "@/components/initiatives/shared";
import { Columns, Kpi, KpiRow, Panel, Td, Th, type ReportFilters } from "./shared";
import { DAY, fmtDays, inPeriod, issueTimes, median, pct, quantile, weekStart, days as daysBetween } from "./data";

function useIssueData(f: ReportFilters) {
  const issues = useCrm((s) => s.issues);
  const history = useCrm((s) => s.issueHistory);
  const projects = useCrm((s) => s.projects);
  return useMemo(() => {
    const scoped = issues.filter((i) => !f.projectId || i.projectId === f.projectId);
    return { times: issueTimes(scoped, history ?? []), projects };
  }, [issues, history, projects, f.projectId]);
}

/* ───────────── throughput ───────────── */

export function ThroughputReport({ filters }: { filters: ReportFilters }) {
  const { times, projects } = useIssueData(filters);
  const reports = useCrm((s) => s.sprintReports);
  const [unit, setUnit] = useState<"issues" | "points">("issues");
  const data = useMemo(() => {
    const now = Date.now();
    const thisWeek = weekStart(now);
    const weeks = Array.from({ length: 12 }, (_, i) => thisWeek - (11 - i) * 7 * DAY);
    const done = times.filter((t) => t.doneAt && t.issue.type !== "subtask");
    const cols = weeks.map((w) => {
      const inWeek = done.filter((t) => Date.parse(t.doneAt!) >= w && Date.parse(t.doneAt!) < w + 7 * DAY);
      return { key: String(w), label: formatDate(new Date(w).toISOString(), "short"), issues: inWeek.length, points: inWeek.reduce((s, t) => s + (t.issue.storyPoints ?? 0), 0), estimated: inWeek.filter((t) => !t.exact).length };
    });
    const inPer = done.filter((t) => inPeriod(t.doneAt, filters.period));
    const byProject = projects
      .map((p) => {
        const mine = inPer.filter((t) => t.issue.projectId === p.id);
        return { project: p, n: mine.length, points: mine.reduce((s, t) => s + (t.issue.storyPoints ?? 0), 0) };
      })
      .filter((r) => r.n)
      .sort((a, b) => b.points - a.points);
    const last4 = cols.slice(-4);
    return { cols, inPer, byProject, avg4: last4.reduce((s, c) => s + c[unit], 0) / 4, estimated: cols.reduce((s, c) => s + c.estimated, 0) };
  }, [times, projects, filters.period, unit]);
  const sprintRows = useMemo(() => (reports ?? []).filter((r) => !filters.projectId || r.projectId === filters.projectId).sort((a, b) => b.closedAt.localeCompare(a.closedAt)).slice(0, 8), [reports, filters.projectId]);
  const columns: CsvColumn<(typeof data.inPer)[number]>[] = [
    { header: "Key", value: (t) => t.issue.key },
    { header: "Summary", value: (t) => t.issue.summary },
    { header: "Type", value: (t) => t.issue.type },
    { header: "Points", value: (t) => t.issue.storyPoints ?? "" },
    { header: "Done (WIB)", value: (t) => csvDate(t.doneAt) },
    { header: "From history", value: (t) => (t.exact ? "yes" : "estimated") },
  ];
  return (
    <div className="space-y-4">
      <KpiRow>
        <Kpi label={`Done in ${filters.period.label.toLowerCase()}`} value={data.inPer.length} hint={`${data.inPer.reduce((s, t) => s + (t.issue.storyPoints ?? 0), 0)} points · sub-tasks excluded`} tone="green" />
        <Kpi label={`Weekly average (4 wks, ${unit})`} value={data.avg4.toFixed(1)} />
        <Kpi label="Busiest project" value={data.byProject[0]?.project.key ?? "—"} hint={data.byProject[0] ? `${data.byProject[0].points} pts` : undefined} />
        <Kpi label="Estimated dates" value={data.estimated} hint="done without a status-history entry — dated by last update" tone={data.estimated ? "orange" : undefined} />
      </KpiRow>
      <Panel
        title="Weekly throughput"
        hint="Issues reaching Done per week (Monday, WIB), from the issue history. Lighter bars contain estimated dates."
        actions={
          <div className="flex rounded border border-sg-line p-0.5 print:hidden" role="group" aria-label="Unit">
            {(["issues", "points"] as const).map((u) => (
              <button key={u} type="button" aria-pressed={unit === u} onClick={() => setUnit(u)} className={cn("h-6 rounded-sm px-2 text-xs font-semibold capitalize", unit === u ? "bg-sg-card-3 text-sg-white" : "text-sg-dim hover:text-sg-white")}>
                {u}
              </button>
            ))}
          </div>
        }
        csv={{ name: "throughput", rows: data.inPer, columns }}
      >
        <Columns cols={data.cols.map((c) => ({ key: c.key, label: c.label, value: c[unit], tone: c.estimated ? "dim" : "normal", title: `Week of ${c.label}: ${c.issues} issues · ${c.points} pts${c.estimated ? ` (${c.estimated} estimated)` : ""}` }))} />
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="By project" hint={`Done in ${filters.period.label.toLowerCase()}.`}>
          <ul className="space-y-2 text-xs">
            {data.byProject.map((r) => (
              <li key={r.project.id} className="flex items-center gap-2">
                <Chip color={r.project.color}>{r.project.key}</Chip>
                <span className="min-w-0 flex-1 truncate text-sg-text">{r.project.name}</span>
                <span className="sg-num text-sg-white">{r.n} issues</span>
                <span className="sg-num w-16 text-right text-sg-muted">{r.points} pts</span>
              </li>
            ))}
            {!data.byProject.length ? <li className="py-4 text-center text-sg-dim">Nothing done in this period.</li> : null}
          </ul>
        </Panel>
        <Panel title="Closed sprints" hint="Committed vs completed points from the sprint reports saved at completion.">
          <ul className="space-y-2 text-xs">
            {sprintRows.map((r) => {
              const p = projects.find((x) => x.id === r.projectId);
              const rate = pct(r.completed.points, r.committed.points + r.added.points);
              return (
                <li key={r.id}>
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold text-sg-text">{r.sprintName}</span>
                    <span className="text-2xs text-sg-dim">{p?.key} · closed {formatDate(r.closedAt, "short")}</span>
                    <span className="sg-num ml-auto text-sg-white">
                      {r.completed.points}/{r.committed.points + r.added.points} pts
                    </span>
                    <span className={cn("sg-num w-10 text-right", rate >= 80 ? "text-soft-green" : rate >= 60 ? "text-soft-yellow" : "text-soft-orange")}>{rate}%</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-sg-card-3">
                    <div className="h-full rounded-full bg-soft-green" style={{ width: `${rate}%` }} />
                  </div>
                  {r.added.points ? <div className="text-[10px] text-sg-dim">+{r.added.points} pts added mid-sprint · {r.carriedOver.count} carried over</div> : null}
                </li>
              );
            })}
            {!sprintRows.length ? <li className="py-4 text-center text-sg-dim">No sprint reports yet — they’re saved when a sprint is completed.</li> : null}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

/* ───────────── cycle time & WIP ageing ───────────── */

export function DeliveryCycleReport({ filters }: { filters: ReportFilters }) {
  const { times, projects } = useIssueData(filters);
  const users = useCrm((s) => s.users);
  const openIssue = useUi((s) => s.openIssue);
  const data = useMemo(() => {
    const now = Date.now();
    const done = times.filter((t) => t.doneAt && inPeriod(t.doneAt, filters.period) && t.issue.type !== "subtask");
    const withCycle = done.filter((t) => t.startedAt && t.exact).map((t) => ({ t, cycle: Math.max(0, daysBetween(t.startedAt!, t.doneAt!)), lead: Math.max(0, daysBetween(t.issue.createdAt, t.doneAt!)) }));
    const lead = done.map((t) => Math.max(0, daysBetween(t.issue.createdAt, t.doneAt!)));
    const cycles = withCycle.map((x) => x.cycle);
    const p85 = quantile(cycles, 0.85);
    const group = (key: (i: Issue) => string) => {
      const m = new Map<string, number[]>();
      withCycle.forEach((x) => m.set(key(x.t.issue), [...(m.get(key(x.t.issue)) ?? []), x.cycle]));
      return Array.from(m.entries()).map(([k, v]) => ({ key: k, median: median(v), p85: quantile(v, 0.85), n: v.length })).sort((a, b) => (b.median ?? 0) - (a.median ?? 0));
    };
    const wip = times
      .filter((t) => t.issue.status === "in_progress" || t.issue.status === "in_review")
      .map((t) => ({ t, age: daysBetween(t.startedAt ?? t.issue.updatedAt, now), estimated: !t.startedAt }))
      .sort((a, b) => b.age - a.age);
    return { done, withCycle, median: median(cycles), p85, lead: median(lead), byProject: group((i) => projects.find((p) => p.id === i.projectId)?.key ?? i.projectId), byType: group((i) => i.type), wip };
  }, [times, projects, filters.period]);
  type W = (typeof data.wip)[number];
  const columns: CsvColumn<W>[] = [
    { header: "Key", value: (w) => w.t.issue.key },
    { header: "Summary", value: (w) => w.t.issue.summary },
    { header: "Status", value: (w) => w.t.issue.status },
    { header: "Assignee", value: (w) => users.find((u) => u.id === w.t.issue.assigneeId)?.name ?? "" },
    { header: "Age (days)", value: (w) => Math.round(w.age * 10) / 10 },
    { header: "Age from", value: (w) => (w.estimated ? "last update (no history)" : "moved to in progress") },
  ];
  return (
    <div className="space-y-4">
      <KpiRow>
        <Kpi label="Median cycle time" value={fmtDays(data.median)} hint={`in progress → done · ${data.withCycle.length} issues with history`} tone="cyan" />
        <Kpi label="85th percentile" value={fmtDays(data.p85)} hint="85% of work finishes within this" />
        <Kpi label="Median lead time" value={fmtDays(data.lead)} hint={`created → done · ${data.done.length} issues`} />
        <Kpi label="Work in progress" value={data.wip.length} hint={data.p85 !== null ? `${data.wip.filter((w) => w.age > data.p85!).length} older than the 85th percentile` : undefined} tone={data.p85 !== null && data.wip.some((w) => w.age > data.p85!) ? "orange" : undefined} />
      </KpiRow>
      <div className="grid gap-4 lg:grid-cols-2">
        {[
          { title: "By project", rows: data.byProject },
          { title: "By issue type", rows: data.byType },
        ].map((g) => (
          <Panel key={g.title} title={g.title} hint="Cycle time (median · 85th percentile); only issues whose start and finish are in the issue history.">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-sg-line">
                  <Th />
                  <Th right>Median</Th>
                  <Th right>85th pct</Th>
                  <Th right>Issues</Th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.key} className="border-b border-sg-line last:border-b-0">
                    <Td className="text-sg-text">{issueTypeMeta[r.key as keyof typeof issueTypeMeta]?.label ?? r.key}</Td>
                    <Td right>{fmtDays(r.median)}</Td>
                    <Td right className="text-sg-muted">{fmtDays(r.p85)}</Td>
                    <Td right className="text-sg-dim">{r.n}</Td>
                  </tr>
                ))}
                {!g.rows.length ? (
                  <tr>
                    <Td className="py-4 text-center text-sg-dim">No finished issues with history in this period.</Td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Panel>
        ))}
      </div>
      <Panel title={`Ageing work in progress · ${data.wip.length}`} hint="How long open work has been in progress. Items past the 85th-percentile cycle time are flagged." csv={{ name: "wip-ageing", rows: data.wip, columns }}>
        <ul className="divide-y divide-sg-line">
          {data.wip.map((w) => {
            const old = data.p85 !== null && w.age > data.p85;
            const a = users.find((u) => u.id === w.t.issue.assigneeId);
            return (
              <li key={w.t.issue.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                <button type="button" onClick={() => openIssue(w.t.issue.id)} className="font-mono text-2xs font-semibold text-sg-muted hover:text-sg-white">
                  {w.t.issue.key}
                </button>
                <span className="min-w-0 flex-1 truncate text-sg-text">{w.t.issue.summary}</span>
                <Chip color={issueStatusMeta[w.t.issue.status].color}>{issueStatusMeta[w.t.issue.status].label}</Chip>
                <span className="w-24 truncate text-2xs text-sg-dim">{a?.name ?? "Unassigned"}</span>
                <span className={cn("sg-num w-20 text-right font-semibold", old ? "text-soft-orange" : "text-sg-white")} title={w.estimated ? "No status history — aged from the last update" : undefined}>
                  {old ? <TriangleAlert className="mr-1 inline size-3" aria-label="ageing" /> : null}
                  {fmtDays(w.age)}
                  {w.estimated ? "*" : ""}
                </span>
              </li>
            );
          })}
          {!data.wip.length ? <li className="py-4 text-center text-xs text-sg-dim">Nothing in progress.</li> : null}
        </ul>
        {data.wip.some((w) => w.estimated) ? <p className="mt-2 text-[10px] text-sg-dim">* no status history — aged from the issue’s last update.</p> : null}
      </Panel>
    </div>
  );
}

/* ───────────── portfolio margin vs forecast ───────────── */

export function PortfolioReport() {
  const initiatives = useCrm((s) => s.initiatives);
  const entries = useCrm((s) => s.revenueEntries);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const changeOrders = useCrm((s) => s.changeOrders);
  const updates = useCrm((s) => s.projectUpdates);
  const access = useAccess();
  const rows = useMemo(() => {
    return initiatives
      .filter((i) => i.status === "approved" || i.status === "active" || i.status === "completed")
      .map((ini) => {
        const withCo = withChangeOrders(ini, changeOrders ?? []);
        const econ = proposalEconomics(withCo, adjustments);
        const mine = entries.filter((e) => e.initiativeId === ini.id);
        const billed = mine.reduce((s, e) => s + e.revenue, 0);
        const collected = mine.filter((e) => e.received).reduce((s, e) => s + e.revenue, 0);
        const costs = mine.reduce((s, e) => s + e.directCosts, 0);
        const forecastRevenue = withCo.revenue.expected;
        const forecastCosts = directCostTotal(withCo.costs);
        const forecastMargin = forecastRevenue - forecastCosts;
        const actualMargin = billed - costs;
        const review = rateReview(ini, mine, adjustments);
        const co = changeOrderImpact(ini, changeOrders ?? [], adjustments);
        const progress = forecastRevenue ? billed / forecastRevenue : 0;
        const costBurn = forecastCosts ? costs / forecastCosts : 0;
        const flags: { text: string; cite: string }[] = review.flags.filter((f) => !f.startsWith("No expected-case")).map((f) => ({ text: f.replace(/ \(§5\.1\)$/, ""), cite: "5.1" }));
        if (co.resetNeeded) flags.push({ text: `Approved change orders move x by ${Math.round(co.movePct * 100)}% — PRC resets the rate`, cite: "5.1" });
        if (ini.status === "completed" && econ.expected.net > 0 && review.actualNet < econ.expected.net * 0.9) flags.push({ text: "Final net revenue more than 10% below the approved forecast — PRC reviews the reasons", cite: "9.3" });
        if (costBurn > progress + 0.15 && costs > 0) flags.push({ text: `Direct costs ${Math.round(costBurn * 100)}% of budget vs ${Math.round(progress * 100)}% of revenue billed`, cite: "5.3" });
        return { ini, econ, billed, collected, costs, forecastRevenue, forecastCosts, forecastMargin, actualMargin, progress, costBurn, review, flags, coDelta: co.priceDelta, health: latestUpdate(updates ?? [], ini.id)?.health ?? null };
      })
      .sort((a, b) => b.forecastRevenue - a.forecastRevenue);
  }, [initiatives, entries, adjustments, changeOrders, updates]);

  type R = (typeof rows)[number];
  const tot = rows.reduce((a, r) => ({ fr: a.fr + r.forecastRevenue, fc: a.fc + r.forecastCosts, b: a.b + r.billed, col: a.col + r.collected, c: a.c + r.costs, net: a.net + r.review.actualNet, fnet: a.fnet + r.econ.expected.net, pool: a.pool + r.econ.expected.pool }), { fr: 0, fc: 0, b: 0, col: 0, c: 0, net: 0, fnet: 0, pool: 0 });
  const columns: CsvColumn<R>[] = [
    { header: "Code", value: (r) => r.ini.code ?? r.ini.trackingNo },
    { header: "Project", value: (r) => r.ini.title },
    { header: "Type", value: (r) => r.ini.type },
    { header: "Status", value: (r) => r.ini.status },
    { header: "Forecast revenue (IDR, incl. approved COs)", value: (r) => Math.round(r.forecastRevenue) },
    { header: "Forecast direct costs (IDR)", value: (r) => Math.round(r.forecastCosts) },
    { header: "Forecast gross margin %", value: (r) => (r.forecastRevenue ? Math.round((r.forecastMargin / r.forecastRevenue) * 100) : "") },
    { header: "Billed to date (IDR)", value: (r) => r.billed },
    { header: "Collected to date (IDR)", value: (r) => r.collected },
    { header: "Direct costs to date (IDR)", value: (r) => r.costs },
    { header: "Actual gross margin %", value: (r) => (r.billed ? Math.round((r.actualMargin / r.billed) * 100) : "") },
    ...(access.seeAllPay
      ? ([
          { header: "Forecast net revenue (IDR)", value: (r: R) => Math.round(r.econ.expected.net) },
          { header: "Actual net revenue (IDR)", value: (r: R) => Math.round(r.review.actualNet) },
          { header: "Forecast bonus pool (IDR)", value: (r: R) => Math.round(r.econ.expected.pool) },
          { header: "Revenue-share rate %", value: (r: R) => Math.round(r.econ.share * 1000) / 10 },
        ] as CsvColumn<R>[])
      : []),
    { header: "Flags", value: (r) => r.flags.map((f) => `${f.text} (§${f.cite})`).join("; ") },
  ];
  const marginPct = (m: number, r: number) => (r ? `${Math.round((m / r) * 100)}%` : "—");
  const healthColor = { green: "green", amber: "yellow", red: "red" } as const;

  return (
    <div className="space-y-4">
      <KpiRow>
        <Kpi label="Forecast revenue" value={formatIDR(tot.fr)} hint={`${rows.length} approved / active / completed projects`} />
        <Kpi label="Billed · collected" value={`${formatIDR(tot.b)} · ${formatIDR(tot.col)}`} hint={`${pct(tot.b, tot.fr)}% of forecast billed`} tone="green" />
        <Kpi label="Gross margin (forecast → actual)" value={`${marginPct(tot.fr - tot.fc, tot.fr)} → ${marginPct(tot.b - tot.c, tot.b)}`} hint="revenue − direct costs" />
        {access.seeAllPay ? <Kpi label="Net revenue (forecast · to date)" value={`${formatIDR(tot.fnet)} · ${formatIDR(tot.net)}`} hint={`forecast bonus pool ${formatIDR(tot.pool)}`} tone="cyan" /> : <Kpi label="Projects with flags" value={rows.filter((r) => r.flags.length).length} tone={rows.some((r) => r.flags.length) ? "orange" : undefined} />}
      </KpiRow>
      <Panel
        title="Portfolio margin vs forecast"
        hint={
          <>
            Approved figures plus approved change orders <Cite s="5.6" /> against payments recorded in the register (excl. VAT). Direct costs per <Cite s="5.3" />.{" "}
            {access.seeAllPay ? "Net revenue and bonus pools are shown because you have a Finance / HR / PRC role." : (
              <span className="inline-flex items-center gap-1">
                <Lock className="size-3" aria-hidden /> Net revenue, rates and bonus pools are visible to Finance, HR and the PRC only <Cite s="13.4" />.
              </span>
            )}
          </>
        }
        csv={{ name: "portfolio-margin", rows, columns }}
      >
        <div className="-mx-4 -mb-4 overflow-x-auto">
          <table className="w-full min-w-[980px] text-xs">
            <thead>
              <tr className="border-b border-sg-line">
                <Th className="pl-4">Project</Th>
                <Th right>Forecast revenue</Th>
                <Th right>Forecast margin</Th>
                <Th>Billed vs forecast</Th>
                <Th right>Costs to date</Th>
                <Th right>Actual margin</Th>
                {access.seeAllPay ? <Th right>Net (fcst · actual)</Th> : null}
                {access.seeAllPay ? <Th right>Pool (fcst)</Th> : null}
                <Th>Flags</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ini.id} className="border-b border-sg-line align-top last:border-b-0">
                  <Td className="pl-4">
                    <Link href={`/projects/${r.ini.id}`} className="font-semibold text-sg-white hover:underline">
                      {r.ini.title}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-sg-dim">
                      {r.ini.code ?? r.ini.trackingNo} · Type {r.ini.type} · {r.ini.status}
                      {r.health ? <Chip color={healthColor[r.health]}>{r.health}</Chip> : null}
                    </div>
                  </Td>
                  <Td right>
                    {formatIDR(r.forecastRevenue)}
                    {r.coDelta ? <div className="text-[10px] text-sg-dim">incl. COs {r.coDelta > 0 ? "+" : "−"}{formatIDR(Math.abs(r.coDelta))}</div> : null}
                  </Td>
                  <Td right>
                    {formatIDR(r.forecastMargin)}
                    <div className="text-[10px] text-sg-dim">{marginPct(r.forecastMargin, r.forecastRevenue)}</div>
                  </Td>
                  <Td className="w-44">
                    <div className="flex justify-between text-[10px] text-sg-muted">
                      <span>{formatIDR(r.billed)}</span>
                      <span>{Math.round(r.progress * 100)}%</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-sg-card-3">
                      <div className="h-full rounded-full bg-soft-green" style={{ width: `${Math.min(100, r.progress * 100)}%` }} />
                    </div>
                    <div className="mt-0.5 text-[10px] text-sg-dim">collected {formatIDR(r.collected)}</div>
                  </Td>
                  <Td right>
                    {formatIDR(r.costs)}
                    <div className={cn("text-[10px]", r.costBurn > 1 ? "text-soft-red" : "text-sg-dim")}>{Math.round(r.costBurn * 100)}% of budget</div>
                  </Td>
                  <Td right className={r.billed && r.actualMargin / r.billed < r.forecastMargin / Math.max(1, r.forecastRevenue) - 0.05 ? "text-soft-orange" : undefined}>
                    {r.billed ? formatIDR(r.actualMargin) : "—"}
                    <div className="text-[10px] text-sg-dim">{marginPct(r.actualMargin, r.billed)}</div>
                  </Td>
                  {access.seeAllPay ? (
                    <Td right>
                      {formatIDR(r.econ.expected.net)}
                      <div className="text-[10px] text-sg-dim">{formatIDR(r.review.actualNet)} to date</div>
                    </Td>
                  ) : null}
                  {access.seeAllPay ? (
                    <Td right>
                      {formatIDR(r.econ.expected.pool)}
                      <div className="text-[10px] text-sg-dim">rate {(r.econ.share * 100).toFixed(1)}%</div>
                    </Td>
                  ) : null}
                  <Td className="max-w-[260px]">
                    {r.flags.length ? (
                      <ul className="space-y-0.5">
                        {r.flags.map((f) => (
                          <li key={f.text} className="text-[11px] text-soft-orange">
                            {f.text}
                            <Cite s={f.cite} />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-sg-dim">—</span>
                    )}
                  </Td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <Td className="py-6 text-center text-sg-dim">No approved projects yet.</Td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

