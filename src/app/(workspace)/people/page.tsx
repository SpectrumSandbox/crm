"use client";

/*
 * People — HR eligibility register for the Project Initiative and Compensation Policy v4.0 (§3, §7.1, §7.3, §9.3, §10,
 * §11, §15.1). Pay and status data is personal (§13.4): viewers without a Finance, HR or PRC role get the directory only.
 */
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CircleAlert, Lock, Mail, Search, TriangleAlert, UserPlus } from "lucide-react";
import { useCrm } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import { EMPLOYMENT_META, POLICY, POLICY_VERSION } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Avatar, Chip, EmptyState, Kbd } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/overlays";
import { CapacityMeter, Cite, EligibilityBadge, Money } from "@/components/initiatives/shared";
import { GOVERNANCE_META, usePeopleRows, type PersonRow } from "@/components/people/data";
import { EmployeeSheet } from "@/components/people/employee-sheet";
import { AddPersonModal } from "@/components/people/add-person";
import { FIRST_V4_PAYMENT } from "@/components/people/annex-b";
import { AnnexBReminderModal } from "@/components/people/reminder";

type Filter = "all" | "eligible" | "ineligible" | "probation" | "notice" | "annexb" | "resign" | "fixed" | "part";

const FILTERS: { value: Filter; label: string; test: (r: PersonRow) => boolean }[] = [
  { value: "all", label: "All", test: () => true },
  { value: "eligible", label: "Eligible", test: (r) => r.eligibility.ok },
  { value: "ineligible", label: "Not eligible", test: (r) => !r.eligibility.ok },
  { value: "probation", label: "Probation", test: (r) => r.probationary },
  { value: "fixed", label: "Fixed-term", test: (r) => r.profile?.employmentType === "fixed_term_contract" },
  { value: "part", label: "Part-time", test: (r) => r.profile?.employmentType === "part_time" },
  { value: "notice", label: "Notice / leaving", test: (r) => r.inNotice },
  { value: "annexb", label: "Missing Annex B", test: (r) => r.annexB === "missing" },
  { value: "resign", label: `Annex B before v${POLICY_VERSION}`, test: (r) => r.annexB === "pre_v4" },
];

export default function PeoplePage() {
  const rows = usePeopleRows();
  const access = useAccess();
  const full = access.seeAllPay;
  const [filter, setFilter] = useState<Filter>("all");
  const [reminding, setReminding] = useState<PersonRow[] | null>(null);
  const searchParams = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const kpis = useMemo(
    () => ({
      eligible: rows.filter((r) => r.eligibility.ok).length,
      probation: rows.filter((r) => r.probationary && !r.separated).length,
      notice: rows.filter((r) => r.inNotice).length,
      annexMissing: rows.filter((r) => r.participant && r.annexB === "missing").length,
      annexOld: rows.filter((r) => r.participant && r.annexB === "pre_v4").length,
      deferred: rows.reduce((s, r) => s + r.pendingDeferred, 0),
      probationLiability: rows.reduce((s, r) => s + (r.probationary ? r.probation : 0), 0),
      noRecord: rows.filter((r) => !r.profile).length,
    }),
    [rows],
  );

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, rows.filter(f.test).length])) as Record<Filter, number>, [rows]);
  const visible = useMemo(() => {
    const test = full ? FILTERS.find((f) => f.value === filter)!.test : () => true;
    const needle = q.trim().toLowerCase();
    return rows
      .filter(test)
      .filter((r) => !needle || `${r.user.name} ${r.user.email} ${r.user.title} ${r.user.team} ${full && r.profile ? EMPLOYMENT_META[r.profile.employmentType].label : ""} ${r.profile?.governanceRoles.map((g) => GOVERNANCE_META[g].label).join(" ") ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => (full ? Number(a.eligibility.ok) - Number(b.eligibility.ok) : 0) || a.user.name.localeCompare(b.user.name));
  }, [rows, filter, q, full]);

  const missing = useMemo(() => rows.filter((r) => r.participant && r.annexB === "missing"), [rows]);
  const missingOrOld = useMemo(() => rows.filter((r) => r.participant && (r.annexB === "missing" || r.annexB === "pre_v4")), [rows]);
  const remind = (targets: PersonRow[]) => {
    if (targets.length) setReminding(targets);
  };

  const rollout = Date.now() < Date.parse(FIRST_V4_PAYMENT);
  const daysToPayment = Math.ceil((Date.parse(FIRST_V4_PAYMENT) - Date.now()) / 86_400_000);
  const openRow = rows.find((r) => r.user.id === openId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="People" meta={<span className="hidden text-xs text-sg-dim sm:inline">{full ? "HR eligibility register" : "Directory"} · Compensation Policy v{POLICY_VERSION}</span>}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sg-dim" />
          <input data-page-filter value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter people" className="h-8 w-52 rounded border border-sg-line bg-sg-bg/60 pl-7 pr-8 text-sm text-sg-text placeholder:text-sg-dim focus:border-sg-white/60 focus:outline-none" />
          <Kbd className="absolute right-1.5 top-1/2 -translate-y-1/2">/</Kbd>
        </div>
        {access.manageHr ? (
        <Menu>
          <MenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={!missingOrOld.length} title={missingOrOld.length ? "Email everyone who still has to sign the v4.0 Project Participation Agreement" : "Everyone has signed the v4.0 agreement"}>
              <Mail /> Annex B reminder
            </Button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuLabel>Draft an email (BCC) and log it</MenuLabel>
            <MenuItem onSelect={() => missing.length && remind(missing)}>
              Missing Annex B <span className="sg-num ml-auto pl-4 text-sg-dim">{missing.length}</span>
            </MenuItem>
            <MenuItem onSelect={() => missingOrOld.length && remind(missingOrOld)}>
              Missing or signed before v{POLICY_VERSION} <span className="sg-num ml-auto pl-4 text-sg-dim">{missingOrOld.length}</span>
            </MenuItem>
          </MenuContent>
        </Menu>
        ) : null}
        {access.manageHr ? (
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            <UserPlus /> Add person
          </Button>
        ) : null}
      </PageHeader>

      {!full ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-sg-line bg-sg-card/60 px-5 py-2 text-xs text-sg-muted">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Directory view. Employment status, eligibility, salaries and bonus balances are personal data limited to Finance, HR, the PRC and the employee concerned <Cite s="13.4" />. Your own record and statements are on{" "}
            <a href="/me" className="text-sg-text underline-offset-2 hover:underline">
              your page
            </a>
            .
          </span>
        </div>
      ) : null}

      {full && access.manageHr && rollout && missingOrOld.length ? (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-soft-yellow/30 bg-soft-yellow/10 px-5 py-2 text-xs text-soft-yellow">
          <TriangleAlert className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">Policy v{POLICY_VERSION} rollout:</span> every participant signs the updated Project Participation Agreement (Annex B) before the first v{POLICY_VERSION} payment with the {formatDate(FIRST_V4_PAYMENT, "medium")} salary — {daysToPayment} days away <Cite s="15.1" />
            <Cite s="15.2" />. {kpis.annexMissing} not signed (payments held) · {kpis.annexOld} signed before v{POLICY_VERSION}.
          </span>
          <Button size="xs" variant="outline" onClick={() => remind(missingOrOld)}>
            <Mail /> Remind {missingOrOld.length}
          </Button>
          <button type="button" className="text-2xs underline-offset-2 hover:underline" onClick={() => setFilter("annexb")}>
            Show missing
          </button>
        </div>
      ) : null}

      {full ? (
      <div className="grid shrink-0 grid-cols-2 border-b border-sg-line sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Eligible" value={String(kpis.eligible)} hint={`of ${rows.length} people${kpis.noRecord ? ` · ${kpis.noRecord} without HR record` : ""}`} tone="green" cite="3.1" />
        <Stat label="On probation" value={String(kpis.probation)} hint="bonuses held until probation ends" tone={kpis.probation ? "yellow" : undefined} cite="11" />
        <Stat label="Notice / leaving" value={String(kpis.notice)} hint="no new roles; earned bonuses still paid" tone={kpis.notice ? "orange" : undefined} cite="10" />
        <Stat label="Annex B missing" value={String(kpis.annexMissing)} hint={kpis.annexMissing ? "all their payments are held" : "everyone has signed"} tone={kpis.annexMissing ? "red" : undefined} cite="15.1" />
        <Stat label="Deferred liability" value={formatIDR(kpis.deferred)} hint="vests 6–12 months after close" cite="9.3" />
        <Stat label="Probation liability" value={formatIDR(kpis.probationLiability)} hint="Probationary Bonus Accrual" tone={kpis.probationLiability ? "yellow" : undefined} cite="11.5" />
      </div>
      ) : null}

      {full ? (
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
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {visible.length ? (
          <table className={cn("w-full text-sm", full ? "min-w-[1240px]" : "min-w-[720px]")}>
            <thead className="sticky top-0 z-10 bg-sg-bg">
              <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-[0.1em] text-sg-dim">
                <th className="px-5 py-2 font-semibold">Employee</th>
                {full ? <th className="px-3 py-2 font-semibold">Employment</th> : null}
                {full ? <th className="px-3 py-2 font-semibold">Eligibility</th> : null}
                <th className="px-3 py-2 font-semibold">Governance</th>
                <th className="px-3 py-2 text-right font-semibold" title="Concurrent Engineer / Secretary / Specialist roles (§7.1)">
                  Non-lead roles
                </th>
                <th className="px-3 py-2 font-semibold">Leadership §7.3</th>
                {full ? <th className="px-3 py-2 text-right font-semibold">Paid this year</th> : null}
                {full ? <th className="px-3 py-2 text-right font-semibold">Deferred</th> : null}
                {full ? <th className="px-3 py-2 text-right font-semibold">Probation held</th> : null}
                {full ? <th className="px-5 py-2 font-semibold">Annex B</th> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <PersonTableRow key={r.user.id} row={r} full={full} onOpen={() => setOpenId(r.user.id)} />
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            icon={Search}
            title={rows.length ? "No one matches" : "No people yet"}
            action={
              !rows.length && access.manageHr ? (
                <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                  <UserPlus /> Add person
                </Button>
              ) : undefined
            }
          >
            {rows.length ? "Try another filter or clear the search." : "Add the real staff who work on projects."}
          </EmptyState>
        )}
      </div>

      <EmployeeSheet row={openRow} onClose={() => setOpenId(null)} />
      {reminding ? <AnnexBReminderModal recipients={reminding.map((r) => r.user)} onClose={() => setReminding(null)} /> : null}
      {adding ? (
        <AddPersonModal
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false);
            setFilter("all");
            setOpenId(id);
          }}
        />
      ) : null}
    </div>
  );
}

function PersonTableRow({ row, onOpen, full }: { row: PersonRow; onOpen: () => void; full: boolean }) {
  const { user, profile, eligibility } = row;
  const tooltip = [...eligibility.blockers, ...eligibility.warnings].join("\n") || "Eligible (§3.1)";
  const meta = profile ? EMPLOYMENT_META[profile.employmentType] : null;
  const overRoles = row.nonLeadRoles > POLICY.maxConcurrentNonLeadRoles;
  const sub = !profile
    ? null
    : profile.employmentType === "fixed_term_contract"
      ? profile.contractEndDate
        ? `Contract ends ${formatDate(profile.contractEndDate, "medium")}`
        : "Contract end date missing"
      : profile.employmentType === "part_time"
        ? `${profile.contractedHoursPct ?? 50}% hours · A ≤ ${row.allocationCap}`
        : profile.employmentType === "probationary"
          ? `Probation ends ${formatDate(profile.probationEndDate, "medium")}`
          : null;
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
      className={cn("cursor-pointer border-b border-sg-line align-middle hover:bg-sg-card/70 focus:bg-sg-card/70 focus:outline-none", full && row.separated && "opacity-60")}
    >
      <td className="px-5 py-2">
        <div className="flex items-center gap-2.5">
          <Avatar user={user} size="sm" />
          <div className="min-w-0">
            <div className="truncate font-semibold text-sg-white">{user.name}</div>
            <div className="truncate text-2xs text-sg-dim">
              {user.title} · {user.team}
            </div>
          </div>
        </div>
      </td>
      {full ? (
      <td className="px-3 py-2">
        {meta ? <span className={cn("text-xs font-semibold", meta.eligible ? (profile!.employmentType === "probationary" ? "text-soft-yellow" : "text-sg-text") : "text-soft-red")}>{meta.label}</span> : <span className="text-xs font-semibold text-soft-red">No HR record</span>}
        {sub ? <div className={cn("text-2xs", sub.includes("missing") ? "text-soft-yellow" : "text-sg-dim")}>{sub}</div> : null}
        {profile?.separation ? <div className="text-2xs text-soft-orange">Leaving {formatDate(profile.separation.effectiveAt, "short")}</div> : row.inNotice ? <div className="text-2xs text-soft-orange">Under notice</div> : null}
      </td>
      ) : null}
      {full ? (
      <td className="px-3 py-2" title={tooltip}>
        <EligibilityBadge userId={user.id} />
        {(eligibility.blockers[0] || eligibility.warnings[0]) && (
          <div className={cn("max-w-[220px] truncate text-2xs", eligibility.blockers.length ? "text-soft-red/80" : "text-sg-dim")}>
            {eligibility.blockers[0] ?? eligibility.warnings[0]}
            {eligibility.blockers.length + eligibility.warnings.length > 1 ? ` +${eligibility.blockers.length + eligibility.warnings.length - 1}` : ""}
          </div>
        )}
      </td>
      ) : null}
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
        <span className={cn("sg-num inline-flex items-center gap-1 font-semibold", overRoles ? "text-soft-orange" : row.nonLeadRoles ? "text-sg-white" : "text-sg-dim")} title={overRoles ? `More than ${POLICY.maxConcurrentNonLeadRoles} concurrent non-lead roles needs line manager and PRC approval (§7.1)` : "Concurrent Engineer / Secretary / Specialist roles on live projects (§7.1)"}>
          {overRoles && <TriangleAlert className="size-3" />}
          {row.nonLeadRoles}
          <span className="text-2xs font-normal text-sg-dim">/{POLICY.maxConcurrentNonLeadRoles}</span>
        </span>
      </td>
      <td className="px-3 py-2">
        <CapacityMeter userId={user.id} />
      </td>
      {full ? (
        <>
      <td className="px-3 py-2 text-right">{row.ytdPaid > 0 ? <Money value={row.ytdPaid} className="font-semibold text-sg-white" /> : <span className="text-sg-dim">—</span>}</td>
      <td className="px-3 py-2 text-right">{row.pendingDeferred > 0 ? <Money value={row.pendingDeferred} className="font-semibold text-soft-cyan" /> : <span className="text-sg-dim">—</span>}</td>
      <td className="px-3 py-2 text-right">{row.probationary ? <Money value={row.probation} className={cn("font-semibold", row.probation > 0 ? "text-soft-yellow" : "text-sg-muted")} /> : <span className="text-sg-dim">—</span>}</td>
      <td className="px-5 py-2">
        {row.annexB === "signed" ? (
          <span className="text-xs text-sg-muted">Signed {formatDate(profile!.acknowledgmentSignedAt)}</span>
        ) : row.annexB === "pre_v4" ? (
          <span className="inline-flex flex-col text-xs text-soft-yellow" title={`Signed before Policy v${POLICY_VERSION} — sign the updated agreement before the first v${POLICY_VERSION} payment (§15.1)`}>
            <span>Signed {formatDate(profile!.acknowledgmentSignedAt)}</span>
            <span className="text-2xs">re-sign v{POLICY_VERSION}</span>
          </span>
        ) : row.annexB === "missing" ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-soft-red" title="Payments are held until the Project Participation Agreement is signed (§15.1)">
            <CircleAlert className="size-3.5" /> Missing · held
          </span>
        ) : (
          <span className="text-sg-dim">—</span>
        )}
      </td>
        </>
      ) : null}
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
