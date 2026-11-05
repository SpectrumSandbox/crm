"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Briefcase, ClipboardList, CornerDownRight, Plus, Sparkles, Ticket as TicketIcon, Users } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { strengthMeta, useEngagement, useGroupRollups, useStageMap, useUserMap } from "@/lib/selectors";
import { COMPANY_LISTS, companyDuplicates, type CompanyContext } from "@/lib/smart-lists";
import { LIFECYCLE_STAGES, type Company } from "@/lib/types";
import { lifecycleMeta } from "@/lib/meta";
import { cn, formatIDR, formatNumber, relativeTime } from "@/lib/utils";
import { csvDate, csvDateTime, csvFilename, type CsvColumn } from "@/lib/csv";
import { PageHeader } from "@/components/shell/page-header";
import { SmartTable, type Column } from "@/components/crm/smart-table";
import { Button } from "@/components/ui/button";
import { Avatar, Chip, Kbd, RecordAvatar } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlays";
import { SavedViewsMenu } from "../contacts/saved-views";
import { MergeCompaniesDialog } from "./merge-companies";
import { reviewOverdue } from "./account-utils";

const tierColor = { Strategic: "magenta", Enterprise: "blue", "Mid-Market": "cyan", Emerging: "green" } as const;
/** account tiers, most important first */
const TIER_RANK: Record<Company["tier"], number> = { Strategic: 0, Enterprise: 1, "Mid-Market": 2, Emerging: 3 };

export default function CompaniesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const view = COMPANY_LISTS.find((l) => l.id === (params.get("view") ?? "all")) ?? COMPANY_LISTS[0];
  const q = params.get("q") ?? "";
  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      if (next.get("view") === "all") next.delete("view");
      const s = next.toString();
      router.replace(s ? `/companies?${s}` : "/companies");
    },
    [params, router],
  );

  const companies = useCrm((s) => s.companies);
  const contacts = useCrm((s) => s.contacts);
  const deals = useCrm((s) => s.deals);
  const users = useCrm((s) => s.users);
  const accountPlans = useCrm((s) => s.accountPlans);
  const currentUserId = useCrm((s) => s.currentUserId);
  const enrichCompany = useCrm((s) => s.enrichCompany);
  const updateCompany = useCrm((s) => s.updateCompany);
  const openDialog = useUi((s) => s.openDialog);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const stageMap = useStageMap();
  const rollups = useGroupRollups();
  const engagement = useEngagement();
  const [merging, setMerging] = useState<[string, string] | null>(null);

  const duplicates = useMemo(() => companyDuplicates(companies), [companies]);
  const ctx: CompanyContext = useMemo(() => {
    const openPipelineByCompany = new Map<string, number>();
    deals.forEach((d) => {
      if (!d.companyId || stageMap.get(d.stageId)?.closed) return;
      openPipelineByCompany.set(d.companyId, (openPipelineByCompany.get(d.companyId) ?? 0) + d.amount);
    });
    const childCount = new Map<string, number>();
    companies.forEach((c) => c.parentId && childCount.set(c.parentId, (childCount.get(c.parentId) ?? 0) + 1));
    return { now: Date.now(), openPipelineByCompany, childCount, currentUserId, duplicates };
  }, [deals, companies, stageMap, currentUserId, duplicates]);
  const counts = useMemo(() => new Map(COMPANY_LISTS.map((l) => [l.id, companies.filter((c) => l.test(c, ctx)).length] as const)), [companies, ctx]);

  const contactCount = useMemo(() => {
    const m = new Map<string, number>();
    contacts.forEach((c) => c.companyId && m.set(c.companyId, (m.get(c.companyId) ?? 0) + 1));
    return m;
  }, [contacts]);
  const planOf = useMemo(() => new Map(accountPlans.map((p) => [p.companyId, p] as const)), [accountPlans]);

  const rows = useMemo(() => companies.filter((c) => view.test(c, ctx)), [companies, view, ctx]);
  const nameOf = useMemo(() => new Map(companies.map((c) => [c.id, c.name] as const)), [companies]);
  const isParent = (c: Company) => (ctx.childCount.get(c.id) ?? 0) > 0;

  const columns: Column<Company>[] = [
    {
      id: "name",
      header: "Company",
      sortValue: (c) => (c.parentId ? `${nameOf.get(c.parentId) ?? ""} ~ ${c.name}` : c.name).toLowerCase(),
      cell: (c) => {
        const dups = duplicates.get(c.id);
        return (
          <div className={cn("flex min-w-[240px] items-center gap-2.5", c.parentId && "pl-5")}>
            {c.parentId && <CornerDownRight className="-ml-5 size-3.5 text-sg-dim" />}
            <RecordAvatar label={c.name} color={tierColor[c.tier]} size="sm" square />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Link href={`/companies/${c.id}`} className="block truncate font-semibold text-sg-white hover:underline">
                  {c.name}
                </Link>
                {dups?.length ? (
                  <button type="button" onClick={() => setMerging([c.id, dups[0]])} title="Looks like a duplicate — review and merge">
                    <Chip color="yellow">Duplicate?</Chip>
                  </button>
                ) : null}
              </div>
              <div className="truncate text-2xs text-sg-dim">
                {c.domain}
                {isParent(c) ? ` · ${ctx.childCount.get(c.id)} ${ctx.childCount.get(c.id) === 1 ? "unit" : "units"}` : ""}
              </div>
            </div>
          </div>
        );
      },
    },
    { id: "industry", header: "Industry", sortValue: (c) => c.industry, cell: (c) => <span className="whitespace-nowrap text-sg-muted">{c.industry}</span> },
    { id: "tier", header: "Tier", sortValue: (c) => TIER_RANK[c.tier], cell: (c) => <Chip color={tierColor[c.tier]}>{c.tier}</Chip> },
    { id: "stage", header: "Lifecycle", sortValue: (c) => LIFECYCLE_STAGES.indexOf(c.lifecycleStage), cell: (c) => <Chip color={lifecycleMeta[c.lifecycleStage].color}>{lifecycleMeta[c.lifecycleStage].label}</Chip> },
    { id: "city", header: "City", sortValue: (c) => c.city, cell: (c) => <span className="text-sg-muted">{c.city}</span> },
    { id: "employees", header: "Employees", align: "right", sortValue: (c) => c.employees, cell: (c) => <span className="sg-num text-sg-muted">{formatNumber(c.employees)}</span> },
    { id: "revenue", header: "Revenue", align: "right", sortValue: (c) => c.annualRevenue, cell: (c) => <span className="sg-num text-sg-muted">{formatIDR(c.annualRevenue)}</span> },
    {
      id: "pipeline",
      header: "Open pipeline",
      align: "right",
      sortValue: (c) => rollups.group.get(c.id)?.openPipeline ?? 0,
      cell: (c) => {
        const own = rollups.self.get(c.id)?.openPipeline ?? 0;
        const group = rollups.group.get(c.id);
        return (
          <div className="whitespace-nowrap">
            {own ? <span className="sg-num font-semibold text-sg-white">{formatIDR(own)}</span> : <span className="text-sg-dim">—</span>}
            {isParent(c) && group && group.openPipeline !== own ? (
              <div className="sg-num text-2xs text-soft-cyan" title={`Whole group: ${group.unitIds.length} units, ${group.openDeals} open deals`}>
                group {formatIDR(group.openPipeline)}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "won",
      header: "Won (12 mo)",
      align: "right",
      sortValue: (c) => rollups.group.get(c.id)?.wonTtm ?? 0,
      cell: (c) => {
        const own = rollups.self.get(c.id)?.wonTtm ?? 0;
        const group = rollups.group.get(c.id)?.wonTtm ?? 0;
        return (
          <div className="whitespace-nowrap">
            {own ? <span className="sg-num text-soft-green">{formatIDR(own)}</span> : <span className="text-sg-dim">—</span>}
            {isParent(c) && group !== own ? <div className="sg-num text-2xs text-soft-cyan">group {formatIDR(group)}</div> : null}
          </div>
        );
      },
    },
    {
      id: "tickets",
      header: "Tickets",
      align: "right",
      sortValue: (c) => (rollups.group.get(c.id)?.breaches ?? 0) * 1000 + (rollups.group.get(c.id)?.openTickets ?? 0),
      cell: (c) => {
        const r = (isParent(c) ? rollups.group : rollups.self).get(c.id);
        if (!r?.openTickets) return <span className="text-sg-dim">—</span>;
        return (
          <span className="whitespace-nowrap" title={isParent(c) ? "Open tickets across the whole group" : "Open tickets"}>
            <span className="sg-num text-sg-muted">{r.openTickets} open</span>
            {r.breaches ? <span className="ml-1 font-semibold text-soft-red">· {r.breaches} breached</span> : null}
          </span>
        );
      },
    },
    {
      id: "csat",
      header: "CSAT",
      align: "right",
      sortValue: (c) => rollups.group.get(c.id)?.csat ?? -1,
      cell: (c) => {
        const r = (isParent(c) ? rollups.group : rollups.self).get(c.id);
        if (r?.csat === null || r?.csat === undefined) return <span className="text-sg-dim">—</span>;
        return (
          <span className={cn("sg-num font-semibold", r.csat >= 4 ? "text-soft-green" : r.csat >= 3 ? "text-soft-yellow" : "text-soft-red")} title={`${r.csatCount} ${r.csatCount === 1 ? "rating" : "ratings"}`}>
            {r.csat.toFixed(1)}
          </span>
        );
      },
    },
    {
      id: "strength",
      header: "Relationship",
      sortValue: (c) => engagement.byCompany.get(c.id)?.score ?? 0,
      cell: (c) => {
        const e = engagement.byCompany.get(c.id);
        const last = isParent(c) ? rollups.group.get(c.id)?.lastAt : e?.lastAt;
        const best = userMap.get(e?.strongestUserId ?? "");
        return (
          <div className="flex items-center gap-1.5 whitespace-nowrap" title={e ? `${e.touches30} touches in 30 days · ${e.touches90} in 90 days${best ? ` · strongest connection: ${best.name}` : ""}` : "No logged engagement yet"}>
            <Chip color={strengthMeta[e?.strength ?? "none"].color}>{strengthMeta[e?.strength ?? "none"].label}</Chip>
            {best ? <Avatar user={best} size="xs" title={`Strongest connection: ${best.name}`} /> : null}
            <span className="text-2xs text-sg-dim">{last ? relativeTime(last) : ""}</span>
          </div>
        );
      },
    },
    { id: "contacts", header: "Contacts", align: "right", sortValue: (c) => contactCount.get(c.id) ?? 0, cell: (c) => <span className="sg-num text-sg-muted">{contactCount.get(c.id) ?? 0}</span> },
    {
      id: "plan",
      header: "Account plan",
      sortValue: (c) => planOf.get(c.id)?.lastReviewedAt ?? (planOf.has(c.id) ? "0" : ""),
      cell: (c) => {
        const plan = planOf.get(c.id);
        if (!plan) {
          return c.tier === "Strategic" || isParent(c) ? (
            <Link href={`/companies/${c.id}/plan`} className="whitespace-nowrap text-2xs font-semibold text-soft-yellow hover:text-sg-white">
              Start plan →
            </Link>
          ) : (
            <span className="text-sg-dim">—</span>
          );
        }
        const due = reviewOverdue(plan.cadence, plan.lastReviewedAt);
        return (
          <Link href={`/companies/${c.id}/plan`} className={cn("whitespace-nowrap text-2xs font-semibold hover:text-sg-white", due ? "text-soft-orange" : "text-sg-muted")}>
            {plan.lastReviewedAt ? `Reviewed ${relativeTime(plan.lastReviewedAt)}` : "Never reviewed"}
            {due ? " · due" : ""}
          </Link>
        );
      },
    },
    {
      id: "enriched",
      header: "Data",
      cell: (c) =>
        c.enriched ? (
          <span className="text-2xs font-semibold text-soft-green">Enriched</span>
        ) : (
          <button
            type="button"
            onClick={() => {
              enrichCompany(c.id);
              notify(`${c.name} enriched from ${c.domain}`);
            }}
            className="flex items-center gap-1 text-2xs font-semibold text-soft-yellow hover:text-sg-white"
          >
            <Sparkles className="size-3" /> Enrich
          </button>
        ),
    },
    {
      id: "owner",
      header: "Owner",
      sortValue: (c) => userMap.get(c.ownerId)?.name ?? "",
      cell: (c) => (
        <Menu>
          <MenuTrigger asChild>
            <button type="button" title="Change owner" className="flex items-center gap-1.5 whitespace-nowrap rounded-sm px-1 py-0.5 text-sg-muted hover:bg-sg-card-3 hover:text-sg-white focus:outline-none focus-visible:ring-1 focus-visible:ring-sg-white">
              <Avatar user={userMap.get(c.ownerId)} size="xs" />
              {userMap.get(c.ownerId)?.name.split(" ")[0] ?? "Unassigned"}
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuLabel>Company owner</MenuLabel>
            {users.map((u) => (
              <MenuItem
                key={u.id}
                active={u.id === c.ownerId}
                onSelect={() => {
                  if (u.id === c.ownerId) return;
                  const prev = c.ownerId;
                  updateCompany(c.id, { ownerId: u.id });
                  notify(`${c.name} assigned to ${u.name}`, { label: "Undo", run: () => updateCompany(c.id, { ownerId: prev }) });
                }}
              >
                <Avatar user={u} size="xs" /> {u.name}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      ),
    },
    {
      id: "actions",
      header: "",
      hideable: false,
      cell: (c) => (
        <Menu>
          <MenuTrigger asChild>
            <button type="button" aria-label={`Actions for ${c.name}`} className="rounded px-1.5 py-0.5 text-sg-dim hover:bg-sg-card-3 hover:text-sg-white focus:outline-none focus-visible:ring-1 focus-visible:ring-sg-white">
              ⋯
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuLabel>{c.name}</MenuLabel>
            <MenuItem onSelect={() => router.push(`/tickets?new=1&companyId=${encodeURIComponent(c.id)}`)}>
              <TicketIcon className="size-3.5" /> New ticket
            </MenuItem>
            <MenuItem onSelect={() => openDialog({ kind: "createDeal", companyId: c.id })}>
              <Briefcase className="size-3.5" /> New deal
            </MenuItem>
            <MenuItem onSelect={() => openDialog({ kind: "createContact", companyId: c.id })}>
              <Users className="size-3.5" /> New contact
            </MenuItem>
            <MenuItem onSelect={() => router.push(`/companies/${c.id}/plan`)}>
              <ClipboardList className="size-3.5" /> Account plan
            </MenuItem>
            {duplicates.get(c.id)?.length ? (
              <>
                <MenuSeparator />
                <MenuLabel>Possible duplicates</MenuLabel>
                {duplicates.get(c.id)!.map((d) => (
                  <MenuItem key={d} onSelect={() => setMerging([c.id, d])}>
                    Merge with {nameOf.get(d) ?? d}
                  </MenuItem>
                ))}
              </>
            ) : null}
          </MenuContent>
        </Menu>
      ),
    },
  ];

  const csvColumns: CsvColumn<Company>[] = [
    { header: "Company ID", value: (c) => c.id },
    { header: "Name", value: (c) => c.name },
    { header: "Domain", value: (c) => c.domain },
    { header: "Parent company", value: (c) => nameOf.get(c.parentId ?? "") ?? "" },
    { header: "Industry", value: (c) => c.industry },
    { header: "Tier", value: (c) => c.tier },
    { header: "Lifecycle stage", value: (c) => lifecycleMeta[c.lifecycleStage].label },
    { header: "City", value: (c) => c.city },
    { header: "Country", value: (c) => c.country },
    { header: "Employees", value: (c) => c.employees },
    { header: "Annual revenue (IDR)", value: (c) => c.annualRevenue },
    { header: "Open pipeline (IDR)", value: (c) => rollups.self.get(c.id)?.openPipeline ?? 0 },
    { header: "Group open pipeline (IDR)", value: (c) => rollups.group.get(c.id)?.openPipeline ?? 0 },
    { header: "Won last 12 months (IDR)", value: (c) => rollups.self.get(c.id)?.wonTtm ?? 0 },
    { header: "Group won last 12 months (IDR)", value: (c) => rollups.group.get(c.id)?.wonTtm ?? 0 },
    { header: "Open tickets (group)", value: (c) => rollups.group.get(c.id)?.openTickets ?? 0 },
    { header: "SLA breaches (group)", value: (c) => rollups.group.get(c.id)?.breaches ?? 0 },
    { header: "CSAT (group)", value: (c) => (rollups.group.get(c.id)?.csat ?? null) === null ? "" : Math.round((rollups.group.get(c.id)!.csat as number) * 10) / 10 },
    { header: "Relationship", value: (c) => strengthMeta[engagement.byCompany.get(c.id)?.strength ?? "none"].label },
    { header: "Last interaction (WIB)", value: (c) => csvDateTime(engagement.byCompany.get(c.id)?.lastAt) },
    { header: "Contacts", value: (c) => contactCount.get(c.id) ?? 0 },
    { header: "Phone", value: (c) => c.phone },
    { header: "Owner", value: (c) => userMap.get(c.ownerId)?.name ?? "" },
    { header: "Enriched", value: (c) => c.enriched },
    { header: "Created", value: (c) => csvDate(c.createdAt) },
  ];

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Companies" meta={<span className="text-sm text-sg-dim">· {view.name}</span>}>
        <SavedViewsMenu object="company" basePath="/companies" query={params.toString()} />
        <Button variant="primary" onClick={() => openDialog({ kind: "createCompany" })}>
          <Plus /> Create company <Kbd className="ml-1 border-sg-bg/30 bg-transparent text-sg-bg/70">C</Kbd>
        </Button>
      </PageHeader>
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-sg-line px-4" role="tablist" aria-label="Company lists">
        {COMPANY_LISTS.map((l) => (
          <button
            key={l.id}
            type="button"
            role="tab"
            aria-selected={l.id === view.id}
            title={l.description}
            onClick={() => setParams({ view: l.id === "all" ? null : l.id })}
            className={cn("-mb-px flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm font-semibold", l.id === view.id ? "border-sg-white text-sg-white" : "border-transparent text-sg-muted hover:text-sg-white")}
          >
            {l.name}
            <span className={cn("rounded-sm px-1 text-[10px]", l.id === "duplicates" && (counts.get(l.id) ?? 0) > 0 ? "bg-soft-yellow/20 text-soft-yellow" : "bg-sg-card-3 text-sg-muted")}>{counts.get(l.id) ?? 0}</span>
          </button>
        ))}
      </div>
      <SmartTable
        rows={rows}
        columns={columns}
        hrefFor={(c) => `/companies/${c.id}`}
        searchText={(c) => `${c.name} ${c.domain} ${c.industry} ${c.city} ${nameOf.get(c.parentId ?? "") ?? ""}`}
        initialSort={{ id: "name", dir: 1 }}
        tableId="companies"
        query={q}
        onQueryChange={(v) => setParams({ q: v || null })}
        emptyText={view.id === "duplicates" ? "No likely duplicates — every company has its own domain and name." : "No companies match these filters."}
        exportCsv={{ filename: () => csvFilename(view.id === "all" ? "companies" : `companies-${view.id}`), columns: csvColumns }}
        bulkActions={(ids, clear) => (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                ids.forEach((id) => enrichCompany(id));
                notify(`${ids.length === 1 ? "1 company" : `${ids.length} companies`} enriched`);
                clear();
              }}
            >
              <Sparkles /> Enrich from domain
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <Button size="sm" variant="outline">
                  Assign owner
                </Button>
              </MenuTrigger>
              <MenuContent>
                {users.map((u) => (
                  <MenuItem
                    key={u.id}
                    onSelect={() => {
                      const prev = ids.map((id) => [id, companies.find((c) => c.id === id)?.ownerId] as const);
                      ids.forEach((id) => updateCompany(id, { ownerId: u.id }));
                      notify(`${ids.length === 1 ? "1 company" : `${ids.length} companies`} assigned to ${u.name}`, { label: "Undo", run: () => prev.forEach(([id, o]) => o && updateCompany(id, { ownerId: o })) });
                      clear();
                    }}
                  >
                    <Avatar user={u} size="xs" /> {u.name}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            {ids.length === 2 && (
              <Button size="sm" variant="outline" onClick={() => setMerging([ids[0], ids[1]])}>
                Merge 2 companies
              </Button>
            )}
          </>
        )}
      />
      {merging && <MergeCompaniesDialog key={merging.join("|")} ids={merging} onClose={() => setMerging(null)} />}
    </div>
  );
}

