"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
import { useCrm } from "@/lib/store";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Tabs } from "@/components/ui/overlays";
import { periodPresets, quarterKey, quarterPeriod, shiftQuarter, type Period } from "@/components/reports/data";
import type { ReportFilters } from "@/components/reports/shared";
import { ActivityReport, CycleTimeReport, ForecastReport, FunnelReport, PipelineChangesReport, WinLossReport } from "@/components/reports/sales-reports";
import { DeliveryCycleReport, PortfolioReport, ThroughputReport } from "@/components/reports/delivery-reports";

type ReportKey = "win-loss" | "cycle" | "funnel" | "forecast" | "changes" | "activity" | "throughput" | "delivery-cycle" | "portfolio";

const REPORTS: { key: ReportKey; label: string; group: "Sales" | "Delivery"; uses: ("period" | "pipeline" | "owner" | "project")[]; blurb: string }[] = [
  { key: "changes", label: "What changed", group: "Sales", uses: ["pipeline", "owner"], blurb: "Pipeline movement since a weekly snapshot — new, increased, won, lost, pushed." },
  { key: "forecast", label: "Forecast vs target", group: "Sales", uses: ["pipeline", "owner"], blurb: "Closed, Commit, Best case and Pipeline by close month against the quarter target." },
  { key: "win-loss", label: "Win / loss", group: "Sales", uses: ["period", "pipeline", "owner"], blurb: "Win rate by count and value, by capability and owner, and the lost-reason Pareto." },
  { key: "cycle", label: "Sales cycle", group: "Sales", uses: ["period", "pipeline", "owner"], blurb: "Days from created to won, and median time in each stage." },
  { key: "funnel", label: "Stage funnel", group: "Sales", uses: ["period", "pipeline", "owner"], blurb: "Stage-to-stage conversion for deals created in the period." },
  { key: "activity", label: "Team activity", group: "Sales", uses: ["owner"], blurb: "Calls, emails, meetings and WhatsApp per person, with pipeline created and won." },
  { key: "throughput", label: "Throughput", group: "Delivery", uses: ["period", "project"], blurb: "Issues and points done per week, and committed vs completed per sprint." },
  { key: "delivery-cycle", label: "Cycle time & WIP", group: "Delivery", uses: ["period", "project"], blurb: "In progress → done cycle time and the work that has been open longest." },
  { key: "portfolio", label: "Portfolio margin", group: "Delivery", uses: [], blurb: "Approved projects: forecast vs billed revenue, costs and margin, with policy flags." },
];

export default function ReportsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const pipelines = useCrm((s) => s.pipelines);
  const users = useCrm((s) => s.users);
  const deals = useCrm((s) => s.deals);
  const projects = useCrm((s) => s.projects);

  const raw = params.get("r") as ReportKey | null;
  const report = REPORTS.find((r) => r.key === raw) ?? REPORTS[0];
  const presets = useMemo(() => periodPresets(), []);
  const quarters = useMemo(() => [-1, -2, -3, -4].map((n) => quarterPeriod(shiftQuarter(quarterKey(Date.now()), n))), []);
  const allPeriods: Period[] = useMemo(() => [...presets, ...quarters], [presets, quarters]);
  const [periodKey, setPeriodKey] = useState(() => params.get("period") ?? "12m");
  const [pipelineId, setPipelineId] = useState(() => params.get("pipeline") ?? "");
  const [ownerId, setOwnerId] = useState(() => params.get("owner") ?? "");
  const [projectId, setProjectId] = useState(() => params.get("project") ?? "");
  const period = allPeriods.find((p) => p.key === periodKey) ?? presets[3];

  // filters live in the URL so a report can be bookmarked or shared
  useEffect(() => {
    const sp = new URLSearchParams();
    sp.set("r", report.key);
    if (periodKey !== "12m") sp.set("period", periodKey);
    if (pipelineId) sp.set("pipeline", pipelineId);
    if (ownerId) sp.set("owner", ownerId);
    if (projectId) sp.set("project", projectId);
    const qs = sp.toString();
    if (qs !== (typeof window !== "undefined" ? window.location.search.replace(/^\?/, "") : "")) router.replace(`${pathname}?${qs}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.key, periodKey, pipelineId, ownerId, projectId]);

  const filters: ReportFilters = { period, pipelineId, ownerId, projectId };
  const owners = users.filter((u) => deals.some((d) => d.ownerId === u.id));
  const setReport = (k: ReportKey) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("r", k);
    router.replace(`${pathname}?${sp.toString()}`);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Reports" docTitle={`${report.label} · Reports`}>
        <Button variant="outline" size="md" onClick={() => window.print()} className="print:hidden">
          <Printer /> Print
        </Button>
      </PageHeader>
      <div className="shrink-0 border-b border-sg-line px-3 print:hidden sm:px-4">
        <Tabs<ReportKey>
          value={report.key}
          onChange={setReport}
          aria-label="Report"
          className="border-b-0"
          items={REPORTS.map((r) => ({ value: r.key, label: r.label }))}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-auto min-w-0">
              <div className="sg-eyebrow">{report.group}</div>
              <p className="text-sm text-sg-muted">{report.blurb}</p>
            </div>
            {report.uses.includes("period") ? (
              <Select value={period.key} onChange={(e) => setPeriodKey(e.target.value)} wrapperClassName="w-56 print:hidden" aria-label="Period">
                {presets.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
                <optgroup label="Earlier quarters">
                  {quarters.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              </Select>
            ) : null}
            {report.uses.includes("pipeline") ? (
              <Select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} wrapperClassName="w-48 print:hidden" aria-label="Pipeline">
                <option value="">All deal pipelines</option>
                {pipelines
                  .filter((p) => p.objectType === "deal")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            ) : null}
            {report.uses.includes("owner") ? (
              <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} wrapperClassName="w-44 print:hidden" aria-label="Owner">
                <option value="">Everyone</option>
                {owners.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            ) : null}
            {report.uses.includes("project") ? (
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} wrapperClassName="w-48 print:hidden" aria-label="Jira project">
                <option value="">All Jira projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.key} — {p.name}
                  </option>
                ))}
              </Select>
            ) : null}
            <p className="hidden w-full text-2xs text-sg-dim print:block">
              {report.label} · {report.uses.includes("period") ? period.label : "current"} · {pipelines.find((p) => p.id === pipelineId)?.name ?? "all pipelines"} · {users.find((u) => u.id === ownerId)?.name ?? "everyone"} · printed {new Date().toLocaleString("en-GB", { timeZone: "Asia/Jakarta" })} WIB
            </p>
          </div>
          {report.key === "win-loss" ? <WinLossReport filters={filters} /> : null}
          {report.key === "cycle" ? <CycleTimeReport filters={filters} /> : null}
          {report.key === "funnel" ? <FunnelReport filters={filters} /> : null}
          {report.key === "forecast" ? <ForecastReport key={period.key} filters={filters} /> : null}
          {report.key === "changes" ? <PipelineChangesReport filters={filters} /> : null}
          {report.key === "activity" ? <ActivityReport filters={filters} /> : null}
          {report.key === "throughput" ? <ThroughputReport filters={filters} /> : null}
          {report.key === "delivery-cycle" ? <DeliveryCycleReport filters={filters} /> : null}
          {report.key === "portfolio" ? <PortfolioReport /> : null}
        </div>
      </div>
    </div>
  );
}
