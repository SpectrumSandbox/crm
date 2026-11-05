"use client";

/* Finance / PRC compensation workspace — Project Initiative and Compensation Policy v4.0 §8–§11 (monthly cycle, deferral, clawback, probation, curve). */
import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { useCrm } from "@/lib/store";
import { cycleMonth, monthKey } from "@/lib/initiatives/engine";
import { POLICY_VERSION } from "@/lib/initiatives/policy";
import { PageHeader } from "@/components/shell/page-header";
import { Select } from "@/components/ui/input";
import { Chip } from "@/components/ui/misc";
import { Tabs } from "@/components/ui/overlays";
import { useAccess } from "@/lib/access-control";
import { NoAccess, monthLabel, runStatusMeta } from "@/components/compensation/common";
import { LiabilitiesTab } from "@/components/compensation/liabilities";
import { MonthlyRunTab } from "@/components/compensation/monthly-run";
import { DeferredTab } from "@/components/compensation/deferred";
import { ProbationTab } from "@/components/compensation/probation";
import { ClawbacksTab } from "@/components/compensation/clawbacks";
import { PolicyTab } from "@/components/compensation/policy-tab";

type Tab = "run" | "deferred" | "probation" | "clawbacks" | "liabilities" | "policy";
const TABS: Tab[] = ["run", "deferred", "probation", "clawbacks", "liabilities", "policy"];

export default function CompensationPage() {
  const access = useAccess();
  if (!access.seeAllPay)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader title="Compensation" meta={<span className="hidden text-2xs text-sg-dim md:inline">Finance &amp; PRC workspace · Policy v{POLICY_VERSION}</span>} />
        <NoAccess what="The compensation workspace">The monthly company financial summary and break-even result are published to everyone in aggregate (§9.6).</NoAccess>
      </div>
    );
  return <CompensationWorkspace />;
}

function CompensationWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const revenueEntries = useCrm((s) => s.revenueEntries);
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const deferredBonuses = useCrm((s) => s.deferredBonuses);
  const clawbacks = useCrm((s) => s.clawbacks);
  const profiles = useCrm((s) => s.employeeProfiles);

  // the salary cycle today's collections fall in (collected after the 20th → next month, §8.2)
  const current = useMemo(() => cycleMonth(new Date().toISOString()), []);
  const months = useMemo(() => {
    const set = new Set<string>([current]);
    set.add(monthKey(Date.now()));
    revenueEntries.forEach((e) => set.add(e.collectedAt ? cycleMonth(e.collectedAt) : e.month));
    bonusRuns.forEach((r) => set.add(r.month));
    return Array.from(set)
      .filter((m) => /^\d{4}-\d{2}$/.test(m))
      .sort((a, b) => b.localeCompare(a));
  }, [revenueEntries, bonusRuns, current]);

  const rawTab = params.get("tab") as Tab | null;
  const tab: Tab = rawTab && TABS.includes(rawTab) ? rawTab : "run";
  const rawMonth = params.get("month");
  const month = rawMonth && months.includes(rawMonth) ? rawMonth : current;

  const go = (next: { tab?: Tab; month?: string }) => {
    const t = next.tab ?? tab;
    const m = next.month ?? month;
    const q = new URLSearchParams();
    if (t !== "run") q.set("tab", t);
    if (m !== current) q.set("month", m);
    const s = q.toString();
    router.replace(s ? `/compensation?${s}` : "/compensation");
  };

  const run = bonusRuns.find((r) => r.month === month);
  const counts = useMemo(
    () => ({
      deferred: deferredBonuses.filter((d) => d.status === "pending").length,
      probation: profiles.filter((p) => p.employmentType === "probationary" && !(p.separation && Date.parse(p.separation.effectiveAt) <= Date.now())).length,
      clawbacks: clawbacks.filter((c) => !["closed", "waived"].includes(c.status)).length,
    }),
    [deferredBonuses, profiles, clawbacks],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Compensation"
        meta={
          <Chip color={runStatusMeta[run?.status ?? "none"].color} dot className="ml-1">
            {monthLabel(month)} · {runStatusMeta[run?.status ?? "none"].label}
          </Chip>
        }
      >
        <span className="hidden text-2xs text-sg-dim md:inline">Finance &amp; PRC workspace · Policy v{POLICY_VERSION}</span>
        <div className="flex items-center gap-1.5">
          <CalendarDays className="size-3.5 text-sg-dim" />
          <Select value={month} onChange={(e) => go({ month: e.target.value })} wrapperClassName="w-44" aria-label="Month">
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
                {m === current ? " (current)" : ""}
              </option>
            ))}
          </Select>
        </div>
      </PageHeader>

      <div className="shrink-0 px-5 pt-2">
        <Tabs<Tab>
          value={tab}
          onChange={(t) => go({ tab: t })}
          items={[
            { value: "run", label: "Monthly cycle" },
            { value: "deferred", label: "Deferred", count: counts.deferred },
            { value: "probation", label: "Probation", count: counts.probation },
            { value: "clawbacks", label: "Clawbacks", count: counts.clawbacks },
            { value: "liabilities", label: "Liabilities" },
            { value: "policy", label: "Policy" },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {tab === "run" ? <MonthlyRunTab key={month} month={month} /> : null}
        {tab === "deferred" ? <DeferredTab /> : null}
        {tab === "probation" ? <ProbationTab /> : null}
        {tab === "clawbacks" ? <ClawbacksTab /> : null}
        {tab === "liabilities" ? <LiabilitiesTab month={month} /> : null}
        {tab === "policy" ? <PolicyTab /> : null}
      </div>
    </div>
  );
}
