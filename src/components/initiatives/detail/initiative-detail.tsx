"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { PageHeader } from "@/components/shell/page-header";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, Kbd } from "@/components/ui/misc";
import { Tabs } from "@/components/ui/overlays";
import { SampleChip, StatusChip, TypeChip } from "@/components/initiatives/shared";
import { HeaderActions } from "./header-actions";
import { WorkflowStepper } from "./workflow-stepper";
import { OverviewTab } from "./overview-tab";
import { TeamTab } from "./team-tab";
import { FinancialsTab } from "./financials-tab";
import { PrcTab } from "./prc-tab";
import { ActivityTab } from "./activity-tab";
import { isTypingTarget } from "./ui";

type Tab = "overview" | "team" | "financials" | "prc" | "activity";
const TAB_ORDER: Tab[] = ["overview", "team", "financials", "prc", "activity"];

export function InitiativeDetail({ id }: { id: string }) {
  const ini = useCrm((s) => s.initiatives.find((i) => i.id === id));
  const members = useCrm((s) => s.initiativeMembers);
  const auditLog = useCrm((s) => s.auditLog);
  const revenueEntries = useCrm((s) => s.revenueEntries);
  const amendments = useCrm((s) => s.teamAmendments);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const ui = useUi.getState();
      if (ui.paletteOpen || ui.dialog || ui.issueId) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= TAB_ORDER.length) {
        e.preventDefault();
        setTab(TAB_ORDER[n - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counts = useMemo(() => {
    const team = members.filter((m) => m.initiativeId === id && m.consent !== "declined" && m.removal.stage !== "removed" && !m.leftAt);
    const memberIds = new Set([...members.filter((m) => m.initiativeId === id).map((m) => m.id), ...amendments.filter((a) => a.initiativeId === id).map((a) => a.id)]);
    return {
      team: team.length,
      revenue: revenueEntries.filter((e) => e.initiativeId === id).length,
      activity: auditLog.filter((a) => a.entityId === id || memberIds.has(a.entityId)).length,
    };
  }, [members, revenueEntries, auditLog, amendments, id]);

  if (!ini) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Initiative not found" crumbs={[{ href: "/initiatives", label: "Initiatives" }]} />
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={Search}
            title="We couldn’t find that initiative"
            action={
              <Link href="/initiatives" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <ArrowLeft /> Back to initiatives
              </Link>
            }
          >
            No initiative with id “{id}” exists. It may have been a draft that was deleted, or the link is out of date.
          </EmptyState>
        </div>
      </div>
    );
  }

  const label = (text: string, n: number) => (
    <span className="flex items-center gap-1.5">
      {text}
      <Kbd className="hidden h-4 min-w-4 text-[9px] sm:inline-flex">{n}</Kbd>
    </span>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={ini.title}
        crumbs={[{ href: "/initiatives", label: "Initiatives" }]}
        meta={
          <span className="flex shrink-0 items-center gap-2">
            {ini.code || ini.trackingNo ? <span className="sg-num rounded-sm bg-sg-card-3 px-1.5 py-0.5 text-2xs font-semibold text-sg-text">{ini.code ?? ini.trackingNo}</span> : null}
            <TypeChip type={ini.type} />
            <StatusChip status={ini.status} />
            {ini.demo ? <SampleChip /> : null}
            {ini.policyVersion === "3.0" ? <span className="text-2xs text-sg-dim">v3.0 terms kept (§15.1)</span> : null}
          </span>
        }
      >
        <HeaderActions ini={ini} />
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkflowStepper ini={ini} />
        <div className="sticky top-0 z-10 bg-sg-bg px-5">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            items={[
              { value: "overview", label: label("Overview", 1) },
              { value: "team", label: label("Team", 2), count: counts.team },
              { value: "financials", label: label("Payments", 3), count: counts.revenue || undefined },
              { value: "prc", label: label("PRC review", 4) },
              { value: "activity", label: label("Activity", 5), count: counts.activity || undefined },
            ]}
          />
        </div>
        <div className="p-5">
          {tab === "overview" ? <OverviewTab ini={ini} /> : null}
          {tab === "team" ? <TeamTab ini={ini} /> : null}
          {tab === "financials" ? <FinancialsTab ini={ini} /> : null}
          {tab === "prc" ? <PrcTab ini={ini} /> : null}
          {tab === "activity" ? <ActivityTab ini={ini} /> : null}
        </div>
      </div>
    </div>
  );
}
