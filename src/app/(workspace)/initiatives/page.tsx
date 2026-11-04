"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, FileText, Hourglass, Plus, Search, TriangleAlert } from "lucide-react";
import { useCrm } from "@/lib/store";
import { useCompanyMap, useUserMap } from "@/lib/selectors";
import { PROJECT_ROLES, type Initiative, type InitiativeStatus, type ProjectType, type ShareAdjustment } from "@/lib/initiatives/types";
import { addBusinessDays, businessDaysBetween, deferralTriggers, proposalEconomics, shareInForce } from "@/lib/initiatives/engine";
import { POLICY, POLICY_VERSION, PROJECT_TYPE_META, ROLE_META, SPECIALIST_RANGE } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Avatar, Chip, EmptyState, Kbd } from "@/components/ui/misc";
import { Tabs } from "@/components/ui/overlays";
import { Cite, Money, Pct, StatusChip, TypeChip } from "@/components/initiatives/shared";

type Segment = "review" | "active" | "completed" | "rejected" | "drafts" | "all";

const SEGMENTS: Record<Segment, { label: string; statuses: InitiativeStatus[] | null }> = {
  review: { label: "In review", statuses: ["submitted", "screening", "evaluation", "conditional", "deferred"] },
  active: { label: "Active", statuses: ["approved", "active"] },
  completed: { label: "Completed", statuses: ["completed"] },
  rejected: { label: "Rejected", statuses: ["rejected"] },
  drafts: { label: "Drafts", statuses: ["draft"] },
  all: { label: "All", statuses: null },
};
const AWAITING: InitiativeStatus[] = ["submitted", "screening", "evaluation"];

export default function InitiativesPage() {
  const router = useRouter();
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const adjustments = useCrm((s) => s.shareAdjustments);
  const userMap = useUserMap();
  const companyMap = useCompanyMap();
  const [segment, setSegment] = useState<Segment>("review");
  const [q, setQ] = useState("");

  const nowIso = useMemo(() => new Date().toISOString(), []);

  const rows = useMemo(
    () =>
      initiatives.map((i) => {
        const team = members.filter((m) => m.initiativeId === i.id && !m.leftAt && m.consent !== "declined");
        const lead = team.find((m) => m.roles.includes("project_lead"));
        const econ = proposalEconomics(i, adjustments, i.approvedAt ?? nowIso);
        const deferral = deferralTriggers(i, adjustments);
        const awaiting = AWAITING.includes(i.status);
        const decisionDue = i.submittedAt ? addBusinessDays(i.submittedAt, POLICY.sla.decisionBusinessDays) : null;
        const ackDue = i.submittedAt ? addBusinessDays(i.submittedAt, POLICY.sla.acknowledgeBusinessDays) : null;
        const end = i.decision?.decidedAt ?? nowIso;
        const elapsed = i.submittedAt ? businessDaysBetween(i.submittedAt, end) : null;
        const decisionBreached = !!decisionDue && (awaiting ? Date.parse(decisionDue) < Date.parse(nowIso) : !!i.decision && Date.parse(i.decision.decidedAt) > Date.parse(decisionDue));
        const ackBreached = !!ackDue && i.status === "submitted" && !i.acknowledgedAt && Date.parse(ackDue) < Date.parse(nowIso);
        return { i, team, lead, econ, deferral, awaiting, elapsed, decisionBreached, ackBreached };
      }),
    [initiatives, members, adjustments, nowIso],
  );

  const kpi = useMemo(() => {
    const live = rows.filter((r) => r.i.status === "approved" || r.i.status === "active");
    const awaiting = rows.filter((r) => r.awaiting);
    return {
      active: live.length,
      activeRunning: live.filter((r) => r.i.status === "active").length,
      awaiting: awaiting.length,
      decisionBreached: awaiting.filter((r) => r.decisionBreached).length,
      ackBreached: awaiting.filter((r) => r.ackBreached).length,
      pool: live.reduce((s, r) => s + r.econ.expected.pool, 0),
      appeals: rows.filter((r) => r.i.appeal?.status === "pending").length,
    };
  }, [rows]);

  const counts = useMemo(() => {
    const c = {} as Record<Segment, number>;
    (Object.keys(SEGMENTS) as Segment[]).forEach((k) => {
      const st = SEGMENTS[k].statuses;
      c[k] = st ? rows.filter((r) => st.includes(r.i.status)).length : rows.length;
    });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const st = SEGMENTS[segment].statuses;
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => !st || st.includes(r.i.status))
      .filter((r) => {
        if (!needle) return true;
        const hay = [r.i.title, r.i.trackingNo, r.i.code ?? "", companyMap.get(r.i.companyId ?? "")?.name ?? "", userMap.get(r.i.initiatorId)?.name ?? "", userMap.get(r.lead?.userId ?? "")?.name ?? "", PROJECT_TYPE_META[r.i.type].short].join(" ").toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => (b.i.submittedAt ?? b.i.updatedAt).localeCompare(a.i.submittedAt ?? a.i.updatedAt));
  }, [rows, segment, q, companyMap, userMap]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Initiatives" meta={<span className="text-2xs text-sg-dim">Project Initiative &amp; Compensation Policy v{POLICY_VERSION}</span>}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sg-dim" />
          <input
            data-page-filter
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter initiatives"
            className="h-8 w-56 rounded border border-sg-line bg-sg-bg/60 pl-7 pr-8 text-sm text-sg-text placeholder:text-sg-dim focus:border-sg-white/60 focus:outline-none"
          />
          <Kbd className="absolute right-1.5 top-1/2 -translate-y-1/2">/</Kbd>
        </div>
        <Button variant="primary" size="md" onClick={() => router.push("/initiatives/new")}>
          <Plus /> Propose project
        </Button>
      </PageHeader>

      {/* KPI strip */}
      <div className="grid shrink-0 grid-cols-2 border-b border-sg-line lg:grid-cols-4">
        <Stat label="Active projects" value={String(kpi.active)} hint={`${kpi.activeRunning} kicked off · ${kpi.active - kpi.activeRunning} approved`} />
        <Stat
          label="Awaiting PRC"
          value={String(kpi.awaiting)}
          tone={kpi.decisionBreached ? "red" : undefined}
          hint={
            <span className="flex flex-wrap gap-x-2">
              <span className={cn(kpi.decisionBreached && "font-semibold text-soft-red")}>{kpi.decisionBreached} past 5-day decision SLA</span>
              <span className={cn(kpi.ackBreached && "font-semibold text-soft-orange")}>{kpi.ackBreached} unacknowledged &gt; 1 day</span>
              <Cite s="2.3" />
            </span>
          }
        />
        <Stat label="Expected bonus pool" value={formatIDR(kpi.pool)} tone="green" hint="Approved + active projects · expected scenario" />
        <Stat label="Pending appeals" value={String(kpi.appeals)} tone={kpi.appeals ? "orange" : undefined} hint={<>Executive Committee decides within 10 business days<Cite s="2.3.7" /></>} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[minmax(0,1fr)_300px] xl:overflow-hidden">
        <section className="flex min-h-0 flex-col xl:overflow-hidden">
          <Tabs value={segment} onChange={setSegment} className="shrink-0 px-4" items={(Object.keys(SEGMENTS) as Segment[]).map((k) => ({ value: k, label: SEGMENTS[k].label, count: counts[k] }))} />
          <div className="min-h-0 flex-1 overflow-auto">
            {filtered.length ? (
              <table className="w-full min-w-[1280px] text-sm">
                <thead className="sticky top-0 z-10 bg-sg-bg">
                  <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-[0.1em] text-sg-dim">
                    <th className="px-4 py-2 font-semibold">Ref</th>
                    <th className="px-2 py-2 font-semibold">Initiative</th>
                    <th className="px-2 py-2 font-semibold">Status</th>
                    <th className="px-2 py-2 font-semibold">Initiator</th>
                    <th className="px-2 py-2 font-semibold">Project Lead</th>
                    <th className="px-2 py-2 font-semibold">Client</th>
                    <th className="px-2 py-2 text-right font-semibold">Exp. revenue</th>
                    <th className="px-2 py-2 text-right font-semibold">Net revenue</th>
                    <th className="px-2 py-2 text-right font-semibold">Pool</th>
                    <th className="px-2 py-2 text-right font-semibold">Team</th>
                    <th className="px-2 py-2 font-semibold">PRC SLA</th>
                    <th className="px-4 py-2 font-semibold">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    renderRow(r)
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                icon={FileText}
                title={initiatives.length ? "No initiatives match" : "No initiatives yet"}
                action={
                  <Button variant="outline" size="sm" onClick={() => router.push("/initiatives/new")}>
                    <Plus /> Propose project
                  </Button>
                }
              >
                {initiatives.length ? "Try another tab or clear the filter." : "Any eligible full-time employee can propose a project to the Project Review Committee (§2.1)."}
              </EmptyState>
            )}
          </div>
        </section>
        <aside className="border-sg-line p-4 xl:overflow-y-auto xl:border-l">
          <PolicyCard adjustments={adjustments} nowIso={nowIso} />
        </aside>
      </div>
    </div>
  );

  function renderRow(r: (typeof rows)[number]) {
    const onOpen = () => router.push(`/initiatives/${r.i.id}`);
    const initiator = userMap.get(r.i.initiatorId);
    const lead = r.lead ? userMap.get(r.lead.userId) : undefined;
    const company = r.i.companyId ? companyMap.get(r.i.companyId) : undefined;
    return (
      <tr
        key={r.i.id}
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter") onOpen();
        }}
        className="cursor-pointer border-b border-sg-line hover:bg-sg-card/70 focus:bg-sg-card/70 focus:outline-none"
      >
        <td className="px-4 py-2 align-top">
          <div className="sg-num text-xs font-semibold text-sg-white">{r.i.code ?? (r.i.trackingNo || "Draft")}</div>
          {r.i.code && r.i.trackingNo ? <div className="sg-num text-2xs text-sg-dim">{r.i.trackingNo}</div> : null}
        </td>
        <td className="max-w-[320px] px-2 py-2 align-top">
          <Link href={`/initiatives/${r.i.id}`} onClick={(e) => e.stopPropagation()} className="line-clamp-1 font-semibold text-sg-white hover:underline">
            {r.i.title}
          </Link>
          <div className="mt-0.5">
            <TypeChip type={r.i.type} />
          </div>
        </td>
        <td className="px-2 py-2 align-top">
          <StatusChip status={r.i.status} />
          {r.i.appeal?.status === "pending" && (
            <div className="mt-1">
              <Chip color="orange">Appeal pending</Chip>
            </div>
          )}
        </td>
        <td className="px-2 py-2 align-top">
          <span className="flex items-center gap-1.5 text-xs text-sg-muted">
            <Avatar user={initiator} size="xs" /> <span className="truncate">{initiator?.name.split(" ")[0] ?? "—"}</span>
          </span>
        </td>
        <td className="px-2 py-2 align-top">
          {lead ? (
            <span className="flex items-center gap-1.5 text-xs text-sg-muted">
              <Avatar user={lead} size="xs" /> <span className="truncate">{lead.name}</span>
            </span>
          ) : (
            <span className="text-xs text-soft-orange">Unassigned</span>
          )}
        </td>
        <td className="max-w-[180px] px-2 py-2 align-top text-xs">
          {company ? (
            <Link href={`/companies/${company.id}`} onClick={(e) => e.stopPropagation()} className="line-clamp-1 text-sg-muted hover:text-sg-white hover:underline">
              {company.name}
            </Link>
          ) : (
            <span className="text-sg-dim">—</span>
          )}
          {r.i.newClient ? <div className="text-2xs text-sg-dim">New client</div> : null}
        </td>
        <td className="px-2 py-2 text-right align-top text-xs">
          <Money value={r.i.revenue.expected} className="font-semibold text-sg-white" />
        </td>
        <td className="px-2 py-2 text-right align-top text-xs">
          <Money value={r.econ.expected.net} className={cn("font-semibold", r.econ.expected.net < 0 ? "text-soft-red" : "text-sg-text")} />
        </td>
        <td className="px-2 py-2 text-right align-top text-xs">
          <Money value={r.econ.expected.pool} className="font-semibold text-soft-green" />
          <div className="sg-num text-2xs text-sg-dim">
            @ <Pct value={r.econ.share} />
          </div>
        </td>
        <td className="sg-num px-2 py-2 text-right align-top text-xs text-sg-muted">{r.team.length}</td>
        <td className="px-2 py-2 align-top">
          <SlaCell row={r} />
        </td>
        <td className="px-4 py-2 align-top">
          {r.deferral.length > 0 ? (
            <span title={`§6.3 — 30% of each bonus deferred ${r.i.deferralMonths} months:\n• ${r.deferral.join("\n• ")}`}>
              <Chip color="orange">
                <Hourglass className="size-3" /> 30% deferred
              </Chip>
            </span>
          ) : (
            <span className="text-2xs text-sg-dim">—</span>
          )}
        </td>
      </tr>
    );
  }
}

function SlaCell({ row: r }: { row: { i: Initiative; awaiting: boolean; elapsed: number | null; decisionBreached: boolean; ackBreached: boolean } }) {
  if (r.elapsed == null) return <span className="text-2xs text-sg-dim">Not submitted</span>;
  const target = POLICY.sla.decisionBusinessDays;
  if (r.awaiting) {
    const pct = Math.min(100, (r.elapsed / target) * 100);
    return (
      <div className="w-[118px]" title={`${r.elapsed} business days since submission (${formatDate(r.i.submittedAt, "medium")}); PRC decides within ${target} business days (§2.3)`}>
        <div className={cn("flex items-center gap-1 text-2xs font-semibold", r.decisionBreached ? "text-soft-red" : r.elapsed >= target - 1 ? "text-soft-yellow" : "text-sg-muted")}>
          {r.decisionBreached ? <TriangleAlert className="size-3" /> : <Clock className="size-3" />}
          <span className="sg-num">
            {r.elapsed}d / {target}d
          </span>
          {r.decisionBreached ? "breached" : ""}
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-sg-card-3">
          <div className={cn("h-full", r.decisionBreached ? "bg-soft-red" : r.elapsed >= target - 1 ? "bg-soft-yellow" : "bg-soft-cyan")} style={{ width: `${pct}%` }} />
        </div>
        {r.ackBreached && <div className="mt-0.5 text-2xs font-semibold text-soft-orange">Not acknowledged (1-day SLA)</div>}
      </div>
    );
  }
  if (r.i.decision)
    return (
      <span className={cn("sg-num text-2xs font-semibold", r.decisionBreached ? "text-soft-red" : "text-sg-muted")} title={`Decided ${formatDate(r.i.decision.decidedAt, "medium")}`}>
        Decided in {r.elapsed}d{r.decisionBreached ? " · late" : ""}
      </span>
    );
  return <span className="sg-num text-2xs text-sg-dim">{r.elapsed}d since submission</span>;
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: React.ReactNode; tone?: "green" | "orange" | "red" }) {
  return (
    <div className="border-b border-r border-sg-line px-5 py-3 lg:border-b-0 lg:last:border-r-0">
      <div className="sg-eyebrow">{label}</div>
      <div className={cn("sg-num mt-1 font-display text-xl font-extrabold", tone === "green" ? "text-soft-green" : tone === "orange" ? "text-soft-orange" : tone === "red" ? "text-soft-red" : "text-sg-white")}>{value}</div>
      {hint ? <div className="text-2xs text-sg-dim">{hint}</div> : null}
    </div>
  );
}

function PolicyCard({ adjustments, nowIso }: { adjustments: ShareAdjustment[]; nowIso: string }) {
  const types: ProjectType[] = ["A", "B", "C"];
  const scheduled = adjustments.filter((a) => Date.parse(a.effectiveFrom) > Date.parse(nowIso)).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return (
    <div className="rounded-xl border border-sg-line bg-sg-card">
      <div className="border-b border-sg-line px-4 py-3">
        <div className="font-display text-sm font-extrabold text-sg-white">Policy at a glance</div>
        <div className="text-2xs text-sg-dim">Project Initiative &amp; Compensation Policy v{POLICY_VERSION}</div>
      </div>
      <div className="space-y-4 px-4 py-3 text-xs">
        <div>
          <div className="sg-eyebrow mb-1.5">
            Revenue share by type
            <Cite s="3.2" />
          </div>
          <ul className="space-y-1.5">
            {types.map((t) => {
              const now = shareInForce(t, adjustments, nowIso);
              const next = scheduled.filter((a) => a.type === t);
              return (
                <li key={t}>
                  <div className="flex items-center justify-between gap-2">
                    <TypeChip type={t} />
                    <span className="sg-num font-semibold text-sg-white">
                      <Pct value={now} />
                    </span>
                  </div>
                  <div className="mt-0.5 text-2xs text-sg-dim">
                    Range <Pct value={PROJECT_TYPE_META[t].range[0]} />–<Pct value={PROJECT_TYPE_META[t].range[1]} /> of net revenue
                  </div>
                  {next.map((a) => (
                    <div key={a.id} className="mt-0.5 text-2xs font-semibold text-soft-yellow" title={a.rationale}>
                      → <Pct value={a.toPct} /> from {formatDate(a.effectiveFrom, "medium")}
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
          {scheduled.length > 0 && (
            <p className="mt-1.5 text-2xs text-sg-dim">
              Approved projects keep the share in force at approval<Cite s="6.6" />
            </p>
          )}
        </div>
        <div>
          <div className="sg-eyebrow mb-1.5">
            Leadership capacity factors
            <Cite s="5.1" />
          </div>
          <ul className="space-y-1">
            {types.map((t) => (
              <li key={t} className="flex justify-between text-sg-muted">
                <span>Type {t} · {PROJECT_TYPE_META[t].short}</span>
                <span className="sg-num font-semibold text-sg-white">{PROJECT_TYPE_META[t].capacityFactor.toFixed(2)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-2xs text-sg-dim">Σ factors for Project/Technical Lead roles ≤ {POLICY.leadershipCapacity.toFixed(1)}; recommended ≤ {POLICY.maxConcurrentMemberships} concurrent projects.</p>
        </div>
        <div>
          <div className="sg-eyebrow mb-1.5">
            Role weights
            <Cite s="4.1" />
          </div>
          <ul className="space-y-1">
            {PROJECT_ROLES.map((r) => (
              <li key={r} className="flex justify-between text-sg-muted" title={ROLE_META[r].description}>
                <span>{ROLE_META[r].label}</span>
                <span className="sg-num font-semibold text-sg-white">{r === "specialist" ? `${SPECIALIST_RANGE[0]}–${SPECIALIST_RANGE[1]}` : ROLE_META[r].weight.toFixed(1)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-2xs text-sg-dim">
            Weights are cumulative across roles<Cite s="4.3" /> · B<sub>i</sub> = W<sub>i</sub> ÷ ΣW × R × P<Cite s="4.2" />
          </p>
        </div>
        <div>
          <div className="sg-eyebrow mb-1.5">
            Deferral &amp; tax
            <Cite s="6.3" />
          </div>
          <p className="text-2xs text-sg-muted">
            30% of bonuses deferred {POLICY.deferral.minMonths}–{POLICY.deferral.maxMonths} months when net revenue &gt; US$200k ({formatIDR(POLICY.deferral.netRevenueThreshold)}), Type C with warranty, payment terms &gt; {POLICY.deferral.paymentTermsDays} days, new client, or PRC high-risk. Estimated tax {Math.round(POLICY.corporateTaxRate * 100)}% of profit<Cite s="3.4" />.
          </p>
        </div>
      </div>
    </div>
  );
}
