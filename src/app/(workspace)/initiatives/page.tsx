"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ClipboardCheck, Clock, FileText, Gavel, Hourglass, Plus, Search, TriangleAlert, UserCheck } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useCompanyMap, useUserMap } from "@/lib/selectors";
import { PROJECT_ROLES, type CurveAdjustment, type Initiative, type InitiativeStatus, type ProjectType } from "@/lib/initiatives/types";
import { addBusinessDays, approvalTier, businessDaysBetween, curveInForce, deferralShare, deferralTriggers, projectRate, proposalEconomics, revenueShareRate } from "@/lib/initiatives/engine";
import { POLICY, POLICY_STATUS, POLICY_VERSION, PROJECT_TYPE_META, ROLE_META, SPECIALIST_RANGE, TIER_META, type ApprovalTier } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Avatar, Chip, EmptyState, Kbd } from "@/components/ui/misc";
import { Tabs } from "@/components/ui/overlays";
import { Cite, Money, Rate, SampleChip, StatusChip, TierChip, TypeChip } from "@/components/initiatives/shared";

type Segment = "queue" | "review" | "active" | "completed" | "rejected" | "drafts" | "all";

const SEGMENTS: Record<Segment, { label: string; statuses: InitiativeStatus[] | null }> = {
  queue: { label: "PRC queue", statuses: ["submitted", "screening", "evaluation"] },
  review: { label: "In review", statuses: ["submitted", "screening", "evaluation", "conditional", "deferred"] },
  active: { label: "Active", statuses: ["approved", "active"] },
  completed: { label: "Completed", statuses: ["completed"] },
  rejected: { label: "Rejected", statuses: ["rejected"] },
  drafts: { label: "Drafts", statuses: ["draft"] },
  all: { label: "All", statuses: null },
};
const AWAITING: InitiativeStatus[] = ["submitted", "screening", "evaluation"];
const SOURCE_SHORT = { fixed: "fixed", v3_flat: "v3.0 flat", curve: "curve", provisional: "provisional" } as const;

export default function InitiativesPage() {
  const router = useRouter();
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const profiles = useCrm((s) => s.employeeProfiles);
  const amendments = useCrm((s) => s.teamAmendments);
  const currentUserId = useCrm((s) => s.currentUserId);
  const userMap = useUserMap();
  const companyMap = useCompanyMap();
  const [segment, setSegment] = useState<Segment>("review");
  const touched = useRef(false);
  const [q, setQ] = useState("");

  const nowIso = useMemo(() => new Date().toISOString(), []);
  const isPrc = useMemo(() => !!profiles.find((p) => p.userId === currentUserId)?.governanceRoles?.includes("prc"), [profiles, currentUserId]);

  const rows = useMemo(
    () =>
      initiatives.map((i) => {
        const team = members.filter((m) => m.initiativeId === i.id && (!m.leftAt || Date.parse(m.leftAt) > Date.parse(nowIso)) && m.consent !== "declined");
        const lead = team.find((m) => m.roles.includes("project_lead"));
        const econ = proposalEconomics(i, adjustments);
        const rate = projectRate(i, adjustments);
        const tier = approvalTier(i);
        const tierDays = TIER_META[tier.tier].decisionBusinessDays;
        const deferral = deferralTriggers(i, adjustments);
        const deferralPct = deferralShare(i, adjustments);
        const awaiting = AWAITING.includes(i.status);
        const decisionDue = i.submittedAt ? addBusinessDays(i.submittedAt, tierDays) : null;
        const ackDue = i.submittedAt ? addBusinessDays(i.submittedAt, POLICY.sla.acknowledgeBusinessDays) : null;
        const end = i.decision?.decidedAt ?? nowIso;
        const elapsed = i.submittedAt ? businessDaysBetween(i.submittedAt, end) : null;
        const decisionBreached = !!decisionDue && (awaiting ? Date.parse(decisionDue) < Date.parse(nowIso) : !!i.decision && Date.parse(i.decision.decidedAt) > Date.parse(decisionDue));
        const ackBreached = !!ackDue && i.status === "submitted" && !i.acknowledgedAt && Date.parse(ackDue) < Date.parse(nowIso);
        return { i, team, lead, econ, rate, tier: tier.tier, tierDays, deferral, deferralPct, awaiting, decisionDue, elapsed, decisionBreached, ackBreached };
      }),
    [initiatives, members, adjustments, nowIso],
  );

  const queue = useMemo(() => rows.filter((r) => r.awaiting).sort((a, b) => (a.decisionDue ?? "9").localeCompare(b.decisionDue ?? "9")), [rows]);

  // PRC members land on their queue when it has work in it
  useEffect(() => {
    if (touched.current) return;
    if (isPrc && queue.length) setSegment("queue");
  }, [isPrc, queue.length]);
  const pick = (s: Segment) => {
    touched.current = true;
    setSegment(s);
  };

  const kpi = useMemo(() => {
    const live = rows.filter((r) => r.i.status === "approved" || r.i.status === "active");
    return {
      active: live.length,
      activeRunning: live.filter((r) => r.i.status === "active").length,
      awaiting: queue.length,
      decisionBreached: queue.filter((r) => r.decisionBreached).length,
      ackBreached: queue.filter((r) => r.ackBreached).length,
      pool: live.reduce((s, r) => s + r.econ.expected.pool, 0),
      appeals: rows.filter((r) => r.i.appeal?.status === "pending").length,
      votes: amendments.filter((a) => a.status === "open" || a.status === "tied").length,
      ties: amendments.filter((a) => a.status === "tied").length,
    };
  }, [rows, queue, amendments]);

  const counts = useMemo(() => {
    const c = {} as Record<Segment, number>;
    (Object.keys(SEGMENTS) as Segment[]).forEach((k) => {
      const st = SEGMENTS[k].statuses;
      c[k] = st ? rows.filter((r) => st.includes(r.i.status)).length : rows.length;
    });
    return c;
  }, [rows]);

  const matches = (r: (typeof rows)[number], needle: string) => {
    if (!needle) return true;
    const hay = [r.i.title, r.i.trackingNo, r.i.code ?? "", companyMap.get(r.i.companyId ?? "")?.name ?? "", userMap.get(r.i.initiatorId)?.name ?? "", userMap.get(r.lead?.userId ?? "")?.name ?? "", PROJECT_TYPE_META[r.i.type].short, `tier ${r.tier}`].join(" ").toLowerCase();
    return hay.includes(needle);
  };

  const filtered = useMemo(() => {
    const st = SEGMENTS[segment].statuses;
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => !st || st.includes(r.i.status))
      .filter((r) => matches(r, needle))
      .sort((a, b) => (b.i.submittedAt ?? b.i.updatedAt).localeCompare(a.i.submittedAt ?? a.i.updatedAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, segment, q, companyMap, userMap]);
  const filteredQueue = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return queue.filter((r) => matches(r, needle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, q, companyMap, userMap]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Initiatives" meta={<span className="text-2xs text-sg-dim">Project Initiative and Compensation Policy v{POLICY_VERSION}</span>}>
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
              <span className={cn(kpi.decisionBreached && "font-semibold text-soft-red")}>{kpi.decisionBreached} past the tier&apos;s decision time</span>
              <span className={cn(kpi.ackBreached && "font-semibold text-soft-orange")}>{kpi.ackBreached} unacknowledged &gt; 1 day</span>
              <Cite s="4.2" />
            </span>
          }
        />
        <Stat label="Expected bonus pool" value={formatIDR(kpi.pool)} tone="green" hint="Approved + active projects · expected case at each project's rate" />
        <Stat
          label="Appeals · team votes"
          value={`${kpi.appeals} · ${kpi.votes}`}
          tone={kpi.appeals || kpi.ties ? "orange" : undefined}
          hint={
            <>
              {kpi.appeals} pending appeal{kpi.appeals === 1 ? "" : "s"}
              <Cite s="4.6" /> · {kpi.votes} amendment{kpi.votes === 1 ? "" : "s"} open{kpi.ties ? `, ${kpi.ties} tied for the PRC` : ""}
              <Cite s="6.8" />
            </>
          }
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[minmax(0,1fr)_310px] xl:overflow-hidden">
        <section className="flex min-h-0 flex-col xl:overflow-hidden">
          <Tabs value={segment} onChange={pick} className="shrink-0 px-4" items={(Object.keys(SEGMENTS) as Segment[]).map((k) => ({ value: k, label: SEGMENTS[k].label, count: counts[k] }))} />
          <div className="min-h-0 flex-1 overflow-auto">
            {segment === "queue" ? (
              <PrcQueue rows={filteredQueue} isPrc={isPrc} />
            ) : filtered.length ? (
              <table className="w-full min-w-[1360px] text-sm">
                <thead className="sticky top-0 z-10 bg-sg-bg">
                  <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-[0.1em] text-sg-dim">
                    <th className="px-4 py-2 font-semibold">Ref</th>
                    <th className="px-2 py-2 font-semibold">Initiative</th>
                    <th className="px-2 py-2 font-semibold">Status</th>
                    <th className="px-2 py-2 font-semibold">Tier</th>
                    <th className="px-2 py-2 font-semibold">Proposer</th>
                    <th className="px-2 py-2 font-semibold">Project Lead</th>
                    <th className="px-2 py-2 font-semibold">Client</th>
                    <th className="px-2 py-2 text-right font-semibold">Exp. revenue</th>
                    <th className="px-2 py-2 text-right font-semibold">Net revenue</th>
                    <th className="px-2 py-2 text-right font-semibold">Rate y</th>
                    <th className="px-2 py-2 text-right font-semibold">Pool</th>
                    <th className="px-2 py-2 text-right font-semibold">Team</th>
                    <th className="px-2 py-2 font-semibold">PRC SLA</th>
                    <th className="px-4 py-2 font-semibold">Flags</th>
                  </tr>
                </thead>
                <tbody>{filtered.map((r) => renderRow(r))}</tbody>
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
                {initiatives.length ? "Try another tab or clear the filter." : "Any eligible employee — permanent, fixed-term, part-time or probationary — can propose a project to the Project Review Committee (§3.1)."}
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
          <div className="sg-num text-xs font-semibold text-sg-white">{r.i.code ?? (r.i.trackingNo || (r.i.status === "draft" ? "Draft" : "—"))}</div>
          {r.i.code && r.i.trackingNo ? <div className="sg-num text-2xs text-sg-dim">{r.i.trackingNo}</div> : null}
        </td>
        <td className="max-w-[320px] px-2 py-2 align-top">
          <div className="flex items-center gap-1.5">
            <Link href={`/initiatives/${r.i.id}`} onClick={(e) => e.stopPropagation()} className="line-clamp-1 font-semibold text-sg-white hover:underline">
              {r.i.title}
            </Link>
            {r.i.demo ? <SampleChip /> : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <TypeChip type={r.i.type} />
            {r.i.registeredRetroactively ? <span className="text-2xs text-sg-dim">registered after start</span> : null}
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
          <TierChip tier={r.tier} />
        </td>
        <td className="px-2 py-2 align-top">
          <span className="flex items-center gap-1.5 text-xs text-sg-muted">
            <Avatar user={initiator} size="xs" /> <span className="truncate">{initiator?.name.split(" ")[0] ?? "—"}</span>
          </span>
          {r.i.origination === "company" ? <div className="text-2xs text-sg-dim">company channel</div> : null}
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
        <td className="px-2 py-2 text-right align-top text-xs">{r.i.revenue.expected > 0 ? <Money value={r.i.revenue.expected} className="font-semibold text-sg-white" /> : <span className="text-2xs text-sg-dim">not entered</span>}</td>
        <td className="px-2 py-2 text-right align-top text-xs">
          <Money value={r.econ.expected.net} className={cn("font-semibold", r.econ.expected.net < 0 ? "text-soft-red" : "text-sg-text")} />
        </td>
        <td className="px-2 py-2 text-right align-top text-xs" title={`x = ${formatIDR(r.rate.x, "full")} over ${r.rate.months} months`}>
          <Rate value={r.rate.rate} className={cn("font-semibold", r.rate.source === "provisional" ? "text-soft-yellow" : "text-sg-white")} />
          <div className="text-2xs text-sg-dim">{SOURCE_SHORT[r.rate.source]}</div>
        </td>
        <td className="px-2 py-2 text-right align-top text-xs">
          <Money value={r.econ.expected.pool} className="font-semibold text-soft-green" />
        </td>
        <td className="sg-num px-2 py-2 text-right align-top text-xs text-sg-muted">{r.team.length}</td>
        <td className="px-2 py-2 align-top">
          <SlaCell row={r} />
        </td>
        <td className="px-4 py-2 align-top">
          <div className="flex flex-col items-start gap-1">
            {r.deferral.length > 0 ? (
              <span title={`§9.3 — ${Math.round(r.deferralPct * 100)}% of each bonus deferred ${r.i.deferralMonths} months after close:\n• ${r.deferral.join("\n• ")}`}>
                <Chip color="orange">
                  <Hourglass className="size-3" /> {Math.round(r.deferralPct * 100)}% deferred
                </Chip>
              </span>
            ) : null}
            {r.i.type === "C" ? <span className="text-2xs text-sg-dim">min. {formatIDR(Math.max(POLICY.typeCMinimum.standardBonus, r.i.standardBonus ?? 0))}/mo</span> : null}
            {r.i.policyVersion === "3.0" ? <span className="text-2xs text-sg-dim">v3.0 terms</span> : null}
            {!r.deferral.length && r.i.type !== "C" && r.i.policyVersion !== "3.0" ? <span className="text-2xs text-sg-dim">—</span> : null}
          </div>
        </td>
      </tr>
    );
  }
}

/* ───────────────────────── PRC queue (Part 2 #1) ───────────────────────── */

type QueueRow = { i: Initiative; tier: ApprovalTier; tierDays: number; decisionDue: string | null; elapsed: number | null; decisionBreached: boolean; ackBreached: boolean; econ: ReturnType<typeof proposalEconomics>; rate: ReturnType<typeof projectRate> };

function dueLabel(dueIso: string | null) {
  if (!dueIso) return { text: "—", tone: "dim" as const };
  const diff = Date.parse(dueIso) - Date.now();
  const days = Math.ceil(Math.abs(diff) / 86_400_000);
  if (diff < 0) return { text: `overdue ${days}d`, tone: "red" as const };
  if (days <= 1) return { text: days === 0 ? "due today" : "due in 1d", tone: "yellow" as const };
  return { text: `due in ${days}d`, tone: "green" as const };
}

function PrcQueue({ rows, isPrc }: { rows: QueueRow[]; isPrc: boolean }) {
  const router = useRouter();
  const users = useCrm((s) => s.users);
  const profiles = useCrm((s) => s.employeeProfiles);
  const currentUserId = useCrm((s) => s.currentUserId);
  const acknowledgeInitiative = useCrm((s) => s.acknowledgeInitiative);
  const startEvaluation = useCrm((s) => s.startEvaluation);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const reviewers = useMemo(() => {
    const prc = new Set(profiles.filter((p) => p.governanceRoles?.includes("prc")).map((p) => p.userId));
    return users.filter((u) => prc.has(u.id));
  }, [users, profiles]);
  const [picked, setPicked] = useState<Record<string, string>>({});

  if (!rows.length)
    return (
      <EmptyState icon={Gavel} title="The PRC queue is empty">
        Submitted proposals appear here ordered by their decision deadline — Tier 1 in 3, Tier 2 in 5 and Tier 3 in 10 business days (§4.2).
      </EmptyState>
    );

  return (
    <div>
      <p className="border-b border-sg-line px-4 py-2 text-2xs text-sg-dim">
        Ordered by the decision deadline of each proposal&apos;s tier, overdue first. The PMO acknowledges within 1 business day and checks completeness within 2; a PRC reviewer evaluates with Finance<Cite s="4.5" />.
        {!isPrc ? " You are not a PRC member — actions are recorded on the PRC's behalf." : ""}
      </p>
      <table className="w-full min-w-[1180px] text-sm">
        <thead className="sticky top-0 z-10 bg-sg-bg">
          <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-[0.1em] text-sg-dim">
            <th className="px-4 py-2 font-semibold">Decision due</th>
            <th className="px-2 py-2 font-semibold">Proposal</th>
            <th className="px-2 py-2 font-semibold">Tier</th>
            <th className="px-2 py-2 font-semibold">Stage</th>
            <th className="px-2 py-2 text-right font-semibold">Exp. revenue</th>
            <th className="px-2 py-2 text-right font-semibold">Rate · pool</th>
            <th className="px-2 py-2 font-semibold">Reviewer</th>
            <th className="px-4 py-2 text-right font-semibold">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const due = dueLabel(r.decisionDue);
            const proposer = userMap.get(r.i.initiatorId);
            const reviewer = r.i.primaryReviewerId ? userMap.get(r.i.primaryReviewerId) : undefined;
            const options = reviewers.filter((u) => u.id !== r.i.initiatorId);
            const choice = picked[r.i.id] ?? options.find((u) => u.id === currentUserId)?.id ?? options[0]?.id ?? "";
            return (
              <tr key={r.i.id} className={cn("border-b border-sg-line align-top", r.decisionBreached && "bg-soft-red/5")}>
                <td className="px-4 py-2">
                  <div className={cn("flex items-center gap-1 text-xs font-semibold", due.tone === "red" ? "text-soft-red" : due.tone === "yellow" ? "text-soft-yellow" : "text-soft-green")}>
                    {due.tone === "red" ? <TriangleAlert className="size-3.5" /> : <Clock className="size-3.5" />}
                    {due.text}
                  </div>
                  <div className="sg-num text-2xs text-sg-dim">
                    {formatDate(r.decisionDue, "medium")} · {r.elapsed ?? 0}/{r.tierDays} business days
                  </div>
                  {r.ackBreached ? <div className="text-2xs font-semibold text-soft-orange">Not acknowledged (1-day SLA)</div> : null}
                </td>
                <td className="max-w-[320px] px-2 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="sg-num text-2xs text-sg-dim">{r.i.trackingNo}</span>
                    <Link href={`/initiatives/${r.i.id}`} className="line-clamp-1 font-semibold text-sg-white hover:underline">
                      {r.i.title}
                    </Link>
                    {r.i.demo ? <SampleChip /> : null}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-sg-muted">
                    <TypeChip type={r.i.type} />
                    <Avatar user={proposer} size="xs" /> {proposer?.name ?? r.i.initiatorId} · submitted {formatDate(r.i.submittedAt, "medium")}
                  </div>
                </td>
                <td className="px-2 py-2">
                  <TierChip tier={r.tier} />
                  <div className="mt-0.5 max-w-[140px] text-2xs text-sg-dim">{TIER_META[r.tier].decides}</div>
                </td>
                <td className="px-2 py-2">
                  <StatusChip status={r.i.status} />
                </td>
                <td className="px-2 py-2 text-right text-xs">
                  <Money value={r.i.revenue.expected} className="font-semibold text-sg-white" />
                </td>
                <td className="px-2 py-2 text-right text-xs">
                  <Rate value={r.rate.rate} className="text-sg-white" />
                  <div>
                    <Money value={r.econ.expected.pool} className="text-2xs text-soft-green" />
                  </div>
                </td>
                <td className="px-2 py-2 text-xs">
                  {r.i.status === "submitted" ? (
                    options.length ? (
                      <Select value={choice} onChange={(e) => setPicked((p) => ({ ...p, [r.i.id]: e.target.value }))} wrapperClassName="w-[170px]" className="h-7 text-xs" aria-label="PRC reviewer">
                        {options.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="text-2xs text-soft-orange">No PRC members on record</span>
                    )
                  ) : reviewer ? (
                    <span className="flex items-center gap-1.5 text-sg-muted">
                      <Avatar user={reviewer} size="xs" /> {reviewer.name}
                    </span>
                  ) : (
                    <span className="text-2xs text-sg-dim">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-1.5">
                    {r.i.status === "submitted" ? (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!choice}
                        onClick={() => {
                          acknowledgeInitiative(r.i.id, choice);
                          notify(`${r.i.trackingNo} acknowledged — ${userMap.get(choice)?.name ?? "reviewer"} assigned`);
                        }}
                      >
                        <UserCheck /> Acknowledge
                      </Button>
                    ) : null}
                    {r.i.status === "screening" ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          startEvaluation(r.i.id);
                          notify(`${r.i.trackingNo} — evaluation started with Finance`);
                        }}
                      >
                        <ClipboardCheck /> Start evaluation
                      </Button>
                    ) : null}
                    <Button size="sm" variant={r.i.status === "evaluation" ? "primary" : "outline"} onClick={() => router.push(`/initiatives/${r.i.id}`)}>
                      {r.i.status === "evaluation" ? "Open to decide" : "Open"} <ArrowRight />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SlaCell({ row: r }: { row: { i: Initiative; awaiting: boolean; elapsed: number | null; decisionBreached: boolean; ackBreached: boolean; tierDays: number; tier: ApprovalTier } }) {
  if (r.elapsed == null) return <span className="text-2xs text-sg-dim">{r.i.registeredRetroactively ? "Registered" : "Not submitted"}</span>;
  const target = r.tierDays;
  if (r.awaiting) {
    const pct = Math.min(100, (r.elapsed / target) * 100);
    return (
      <div className="w-[118px]" title={`${r.elapsed} business days since submission (${formatDate(r.i.submittedAt, "medium")}); Tier ${r.tier} decides within ${target} business days (§4.2)`}>
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
      <span className={cn("sg-num text-2xs font-semibold", r.decisionBreached ? "text-soft-red" : "text-sg-muted")} title={`Decided ${formatDate(r.i.decision.decidedAt, "medium")} · Tier ${r.tier} limit ${target} business days`}>
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

/* ───────────────────────── policy at a glance (v4.0) ───────────────────────── */

const CURVE_POINTS = [100_000_000, 250_000_000, 500_000_000, 1_000_000_000, 1_500_000_000, 2_000_000_000];

function PolicyCard({ adjustments, nowIso }: { adjustments: CurveAdjustment[]; nowIso: string }) {
  const types: ProjectType[] = ["A", "B", "C"];
  const curve = curveInForce(adjustments, nowIso);
  const scheduled = adjustments.filter((a) => Date.parse(a.effectiveFrom) > Date.parse(nowIso)).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return (
    <div className="rounded-xl border border-sg-line bg-sg-card">
      <div className="border-b border-sg-line px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-sm font-extrabold text-sg-white">Policy at a glance</span>
          <Link href="/policy" className="text-2xs font-semibold text-sg-muted hover:text-sg-white">
            Full text →
          </Link>
        </div>
        <div className="text-2xs text-sg-dim">
          Project Initiative and Compensation Policy v{POLICY_VERSION} · {POLICY_STATUS}
        </div>
      </div>
      <div className="space-y-4 px-4 py-3 text-xs">
        <div>
          <div className="sg-eyebrow mb-1.5">
            Revenue-share curve — one rate per project
            <Cite s="5.1" />
          </div>
          <p className="text-2xs text-sg-muted">
            y = {Math.round(curve.start * 100)}% ÷ (1 + {(curve.start / curve.floor - 1).toFixed(0)}x ÷ {formatIDR(curve.decay)}); {Math.round(curve.floor * 100)}% at and above {formatIDR(curve.decay)}. x = projected annual net revenue (total if ≤ 12 months, else × 12 ÷ months). A flat rate on all net revenue; more revenue never pays less.
          </p>
          <table className="mt-1.5 w-full text-2xs">
            <thead>
              <tr className="text-left text-sg-dim">
                <th className="py-0.5 font-semibold">x</th>
                <th className="py-0.5 text-right font-semibold">y</th>
                <th className="py-0.5 text-right font-semibold">Pool / year</th>
              </tr>
            </thead>
            <tbody>
              {CURVE_POINTS.map((x) => (
                <tr key={x} className="border-t border-sg-line/60 text-sg-muted">
                  <td className="sg-num py-0.5">{formatIDR(x)}</td>
                  <td className="py-0.5 text-right">
                    <Rate value={revenueShareRate(x, curve)} className="text-sg-white" />
                  </td>
                  <td className="py-0.5 text-right">
                    <Money value={Math.floor(x * revenueShareRate(x, curve))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {scheduled.map((a) => (
            <p key={a.id} className="mt-1 text-2xs font-semibold text-soft-yellow" title={a.rationale}>
              → {Math.round(a.to.start * 100)}% / {Math.round(a.to.floor * 100)}% at {formatIDR(a.to.decay)} for projects approved from {formatDate(a.effectiveFrom, "medium")}
              <Cite s="9.5" />
            </p>
          ))}
        </div>
        <div>
          <div className="sg-eyebrow mb-1.5">
            Approval tiers
            <Cite s="4.2" />
          </div>
          <ul className="space-y-1.5">
            {([1, 2, 3] as ApprovalTier[]).map((t) => (
              <li key={t}>
                <div className="flex items-center justify-between gap-2">
                  <TierChip tier={t} long />
                  <span className="sg-num font-semibold text-sg-white">{TIER_META[t].decisionBusinessDays} days</span>
                </div>
                <div className="mt-0.5 text-2xs text-sg-dim">
                  {t === 1 ? `Type A/B under ${formatIDR(POLICY.tiers.fastTrackBelow)}, existing client · ` : t === 2 ? `${formatIDR(POLICY.tiers.fastTrackBelow)}–${formatIDR(POLICY.tiers.majorAbove)} · ` : `Over ${formatIDR(POLICY.tiers.majorAbove)}, any Type C, new market or unusual terms · `}
                  {TIER_META[t].decides}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="sg-eyebrow mb-1.5">
            Net revenue &amp; tax
            <Cite s="5.4" />
          </div>
          <p className="text-2xs text-sg-muted">Net revenue = revenue − direct costs − estimated taxes. UMKM final tax 0.5% of revenue excl. VAT — due even on a loss-making project. Team salaries are not direct costs; contingency 10–20%.</p>
        </div>
        <div>
          <div className="sg-eyebrow mb-1.5">
            Payment cycle &amp; controls
            <Cite s="8.2" />
          </div>
          <p className="text-2xs text-sg-muted">
            Bonuses follow cash that is earned and collected, cumulatively. Collected by the {POLICY.cycle.cutoffDay}th → paid on the {POLICY.cycle.salaryDay}th with salary. Rolling three-month break-even test and a cash floor of {POLICY.breakEven.cashFloorMonths} months of fixed costs; if either fails, pay pro rata and carry forward<Cite s="9.1" />.
          </p>
        </div>
        <div>
          <div className="sg-eyebrow mb-1.5">
            Deferral
            <Cite s="9.3" />
          </div>
          <p className="text-2xs text-sg-muted">
            Up to {Math.round(POLICY.deferral.maxPct * 100)}% deferred {POLICY.deferral.minMonths}–{POLICY.deferral.maxMonths} months after close when projected net revenue is over {formatIDR(POLICY.deferral.netRevenueThreshold)}, Type C with a warranty, payment terms over {POLICY.deferral.paymentTermsDays} days, a new client, or PRC-rated high risk.
          </p>
        </div>
        <div>
          <div className="sg-eyebrow mb-1.5">
            Types &amp; leadership capacity
            <Cite s="7.3" />
          </div>
          <ul className="space-y-1">
            {types.map((t) => (
              <li key={t} className="flex justify-between text-sg-muted">
                <span>
                  Type {t} · {PROJECT_TYPE_META[t].short}
                </span>
                <span className="sg-num font-semibold text-sg-white">{PROJECT_TYPE_META[t].capacityFactor.toFixed(2)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-2xs text-sg-dim">
            Lead roles ≤ {POLICY.leadershipCapacity.toFixed(1)} in total; up to {POLICY.maxConcurrentNonLeadRoles} concurrent non-lead roles<Cite s="7.1" />. Type C guaranteed minimum pool ≥ {formatIDR(POLICY.typeCMinimum.standardBonus, "full")}/month<Cite s="8.6" />.
          </p>
        </div>
        <div>
          <div className="sg-eyebrow mb-1.5">
            Role weights
            <Cite s="6.1" />
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
            Weights add up<Cite s="6.3" /> · allocation factor 0.25–1.0<Cite s="6.4" /> · B<sub>i</sub> = E<sub>i</sub> ÷ ΣE × Q, E = W × A × days<Cite s="6.6" />
          </p>
        </div>
      </div>
    </div>
  );
}
