"use client";

/* People — HR eligibility register for the Project Initiative & Compensation Policy (§1.2, §2.1, §4.5, §5.1, §6.2, §6.8). */
import { useMemo, useState } from "react";
import { CircleAlert, Search, TriangleAlert } from "lucide-react";
import { EMPLOYMENT_META, POLICY, POLICY_VERSION } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Avatar, Chip, EmptyState, Kbd } from "@/components/ui/misc";
import { CapacityMeter, Cite, EligibilityBadge, Money } from "@/components/initiatives/shared";
import { GOVERNANCE_META, usePeopleRows, type PersonRow } from "@/components/people/data";
import { Bar } from "@/components/people/fields";
import { EmployeeSheet } from "@/components/people/employee-sheet";

type Filter = "all" | "eligible" | "ineligible" | "probation" | "notice" | "ack";

const FILTERS: { value: Filter; label: string; test: (r: PersonRow) => boolean }[] = [
  { value: "all", label: "All", test: () => true },
  { value: "eligible", label: "Eligible", test: (r) => r.eligibility.ok },
  { value: "ineligible", label: "Not eligible", test: (r) => !r.eligibility.ok },
  { value: "probation", label: "Probation", test: (r) => r.probationary },
  { value: "notice", label: "Notice period", test: (r) => r.inNotice },
  { value: "ack", label: "Missing acknowledgment", test: (r) => !!r.profile && !r.profile.acknowledgmentSignedAt },
];

const NEAR_CAP = 0.8;

export default function PeoplePage() {
  const rows = usePeopleRows();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const kpis = useMemo(
    () => ({
      eligible: rows.filter((r) => r.eligibility.ok).length,
      probation: rows.filter((r) => r.probationary && !r.separated).length,
      notice: rows.filter((r) => r.inNotice).length,
      deferred: rows.reduce((s, r) => s + r.pendingDeferred, 0),
      probationLiability: rows.reduce((s, r) => s + (r.probationary ? r.probation : 0), 0),
      nearCap: rows.filter((r) => r.cap > 0 && r.capPct >= NEAR_CAP).length,
      overCap: rows.filter((r) => r.cap > 0 && r.capPct >= 1).length,
      noRecord: rows.filter((r) => !r.profile).length,
    }),
    [rows],
  );

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, rows.filter(f.test).length])) as Record<Filter, number>, [rows]);

  const visible = useMemo(() => {
    const test = FILTERS.find((f) => f.value === filter)!.test;
    const needle = q.trim().toLowerCase();
    return rows
      .filter(test)
      .filter((r) => !needle || `${r.user.name} ${r.user.title} ${r.user.team} ${r.profile ? EMPLOYMENT_META[r.profile.employmentType].label : ""} ${r.profile?.governanceRoles.map((g) => GOVERNANCE_META[g].label).join(" ") ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(a.eligibility.ok) - Number(b.eligibility.ok) || a.user.name.localeCompare(b.user.name));
  }, [rows, filter, q]);

  const openRow = rows.find((r) => r.user.id === openId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="People" meta={<span className="hidden text-xs text-sg-dim sm:inline">HR eligibility register · Compensation Policy v{POLICY_VERSION}</span>}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sg-dim" />
          <input data-page-filter value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter people" className="h-8 w-52 rounded border border-sg-line bg-sg-bg/60 pl-7 pr-8 text-sm text-sg-text placeholder:text-sg-dim focus:border-sg-white/60 focus:outline-none" />
          <Kbd className="absolute right-1.5 top-1/2 -translate-y-1/2">/</Kbd>
        </div>
      </PageHeader>

      <div className="grid shrink-0 grid-cols-2 border-b border-sg-line sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Eligible headcount" value={String(kpis.eligible)} hint={`of ${rows.length} people${kpis.noRecord ? ` · ${kpis.noRecord} without HR record` : ""}`} tone="green" cite="2.1" />
        <Stat label="On probation" value={String(kpis.probation)} hint="bonuses accrue, paid on completion" tone={kpis.probation ? "yellow" : undefined} cite="6.8" />
        <Stat label="In notice period" value={String(kpis.notice)} hint="unpaid bonuses at risk" tone={kpis.notice ? "orange" : undefined} cite="4.5" />
        <Stat label="Pending deferred liability" value={formatIDR(kpis.deferred)} hint="high-risk & corrective deferrals" cite="6.3" />
        <Stat label="Probation liability" value={formatIDR(kpis.probationLiability)} hint="withheld, not yet settled" tone={kpis.probationLiability ? "yellow" : undefined} cite="6.8" />
        <Stat label="Near 200% cap" value={String(kpis.nearCap)} hint={kpis.overCap ? `${kpis.overCap} at or over cap — CEO + PRC review` : `≥ ${Math.round(NEAR_CAP * 100)}% of annual cap paid YTD`} tone={kpis.overCap ? "red" : kpis.nearCap ? "yellow" : undefined} cite="6.2" />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-sg-line px-5 py-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={cn("flex h-7 items-center gap-1.5 rounded-pill border px-3 text-xs font-semibold transition-colors", filter === f.value ? "border-sg-white bg-sg-white text-sg-bg" : "border-sg-line text-sg-muted hover:border-sg-line-2 hover:text-sg-white")}
          >
            {f.label}
            <span className={cn("sg-num text-2xs", filter === f.value ? "text-sg-bg/70" : "text-sg-dim")}>{counts[f.value]}</span>
          </button>
        ))}
        <span className="ml-auto text-2xs text-sg-dim">Click a row to open the HR record</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {visible.length ? (
          <table className="w-full min-w-[1180px] text-sm">
            <thead className="sticky top-0 z-10 bg-sg-bg">
              <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-[0.1em] text-sg-dim">
                <th className="px-5 py-2 font-semibold">Employee</th>
                <th className="px-3 py-2 font-semibold">Employment</th>
                <th className="px-3 py-2 font-semibold">Eligibility</th>
                <th className="px-3 py-2 font-semibold">Governance</th>
                <th className="px-3 py-2 text-right font-semibold">Projects</th>
                <th className="px-3 py-2 font-semibold">Leadership</th>
                <th className="px-3 py-2 font-semibold">YTD vs 200% cap</th>
                <th className="px-3 py-2 text-right font-semibold">Deferred</th>
                <th className="px-3 py-2 text-right font-semibold">Probation</th>
                <th className="px-5 py-2 font-semibold">Acknowledgment</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <PersonTableRow key={r.user.id} row={r} onOpen={() => setOpenId(r.user.id)} />
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={Search} title={rows.length ? "No one matches" : "No people yet"}>
            {rows.length ? "Try another filter or clear the search." : "Users appear here once they exist in the workspace."}
          </EmptyState>
        )}
      </div>

      <EmployeeSheet row={openRow} onClose={() => setOpenId(null)} />
    </div>
  );
}

function PersonTableRow({ row, onOpen }: { row: PersonRow; onOpen: () => void }) {
  const { user, profile, eligibility } = row;
  const tooltip = [...eligibility.blockers, ...eligibility.warnings].join("\n") || "Eligible (§2.1)";
  const capTone = row.capPct >= 1 ? "red" : row.capPct >= NEAR_CAP ? "yellow" : "cyan";
  const meta = profile ? EMPLOYMENT_META[profile.employmentType] : null;
  return (
    <tr
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn("cursor-pointer border-b border-sg-line align-middle hover:bg-sg-card/70 focus:bg-sg-card/70 focus:outline-none", row.separated && "opacity-60")}
    >
      <td className="px-5 py-2">
        <div className="flex items-center gap-2.5">
          <Avatar user={user} size="sm" />
          <div className="min-w-0">
            <div className="truncate font-semibold text-sg-white">{user.name}</div>
            <div className="truncate text-2xs text-sg-dim">{user.title}</div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2">
        {meta ? <span className={cn("text-xs font-semibold", meta.eligible ? (profile!.employmentType === "probationary" ? "text-soft-yellow" : "text-sg-text") : "text-soft-red")}>{meta.label}</span> : <span className="text-xs font-semibold text-soft-red">No HR record</span>}
        {profile?.separation ? <div className="text-2xs text-soft-orange">Leaving {formatDate(profile.separation.effectiveAt, "short")}</div> : row.inNotice ? <div className="text-2xs text-soft-orange">Under notice</div> : null}
      </td>
      <td className="px-3 py-2" title={tooltip}>
        <EligibilityBadge userId={user.id} />
        {(eligibility.blockers[0] || eligibility.warnings[0]) && <div className={cn("max-w-[200px] truncate text-2xs", eligibility.blockers.length ? "text-soft-red/80" : "text-sg-dim")}>{eligibility.blockers[0] ?? eligibility.warnings[0]}{eligibility.blockers.length + eligibility.warnings.length > 1 ? ` +${eligibility.blockers.length + eligibility.warnings.length - 1}` : ""}</div>}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {profile?.governanceRoles.length ? (
            profile.governanceRoles.map((g) => (
              <Chip key={g} color={GOVERNANCE_META[g].color}>
                <span title={GOVERNANCE_META[g].title}>{GOVERNANCE_META[g].label}</span>
              </Chip>
            ))
          ) : (
            <span className="text-sg-dim">—</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-right">
        <span className={cn("sg-num inline-flex items-center gap-1 font-semibold", row.projects > POLICY.maxConcurrentMemberships ? "text-soft-orange" : row.projects ? "text-sg-white" : "text-sg-dim")} title={row.projects > POLICY.maxConcurrentMemberships ? `More than ${POLICY.maxConcurrentMemberships} concurrent projects (§5.1 recommends at most ${POLICY.maxConcurrentMemberships})` : "Live project memberships"}>
          {row.projects > POLICY.maxConcurrentMemberships && <TriangleAlert className="size-3" />}
          {row.projects}
        </span>
      </td>
      <td className="px-3 py-2">
        <CapacityMeter userId={user.id} />
      </td>
      <td className="px-3 py-2">
        {row.cap > 0 ? (
          <div className="w-40" title={`${formatIDR(row.ytdPaid, "full")} paid of ${formatIDR(row.cap, "full")} cap (200% of base salary, §6.2)`}>
            <div className="flex items-baseline justify-between gap-2 text-2xs">
              <Money value={row.ytdPaid} className="font-semibold text-sg-white" />
              <span className={cn("sg-num font-semibold", capTone === "red" ? "text-soft-red" : capTone === "yellow" ? "text-soft-yellow" : "text-sg-dim")}>{Math.round(row.capPct * 100)}%</span>
            </div>
            <Bar pct={row.capPct * 100} tone={capTone} className="mt-1 w-full" />
          </div>
        ) : (
          <span className="text-2xs text-sg-dim">No salary on record</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">{row.pendingDeferred > 0 ? <Money value={row.pendingDeferred} className="font-semibold text-soft-cyan" /> : <span className="text-sg-dim">—</span>}</td>
      <td className="px-3 py-2 text-right">{row.probationary ? <Money value={row.probation} className={cn("font-semibold", row.probation > 0 ? "text-soft-yellow" : "text-sg-muted")} /> : <span className="text-sg-dim">—</span>}</td>
      <td className="px-5 py-2">
        {profile?.acknowledgmentSignedAt ? (
          <span className="text-xs text-sg-muted">Signed {formatDate(profile.acknowledgmentSignedAt)}</span>
        ) : profile ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-soft-yellow">
            <CircleAlert className="size-3.5" /> Missing
          </span>
        ) : (
          <span className="text-sg-dim">—</span>
        )}
      </td>
    </tr>
  );
}

function Stat({ label, value, hint, tone, cite }: { label: string; value: string; hint?: string; tone?: "green" | "orange" | "red" | "yellow"; cite?: string }) {
  return (
    <div className="border-r border-sg-line px-5 py-3 last:border-r-0">
      <div className="sg-eyebrow flex items-center">
        {label}
        {cite && <Cite s={cite} />}
      </div>
      <div className={cn("sg-num mt-1 font-display text-xl font-extrabold", tone === "green" ? "text-soft-green" : tone === "orange" ? "text-soft-orange" : tone === "red" ? "text-soft-red" : tone === "yellow" ? "text-soft-yellow" : "text-sg-white")}>{value}</div>
      {hint ? <div className="text-2xs text-sg-dim">{hint}</div> : null}
    </div>
  );
}
