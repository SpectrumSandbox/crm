"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CornerDownRight, Plus, Sparkles } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useStageMap, useUserMap } from "@/lib/selectors";
import { COMPANY_LISTS } from "@/lib/smart-lists";
import type { Company } from "@/lib/types";
import { lifecycleMeta } from "@/lib/meta";
import { cn, formatIDR, formatNumber } from "@/lib/utils";
import { csvDate, csvFilename, type CsvColumn } from "@/lib/csv";
import { PageHeader } from "@/components/shell/page-header";
import { SmartTable, type Column } from "@/components/crm/smart-table";
import { Button } from "@/components/ui/button";
import { Avatar, Chip, Kbd, RecordAvatar } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/overlays";

const tierColor = { Strategic: "magenta", Enterprise: "blue", "Mid-Market": "cyan", Emerging: "green" } as const;

export default function CompaniesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const view = COMPANY_LISTS.find((l) => l.id === (params.get("view") ?? "all")) ?? COMPANY_LISTS[0];
  const companies = useCrm((s) => s.companies);
  const contacts = useCrm((s) => s.contacts);
  const deals = useCrm((s) => s.deals);
  const users = useCrm((s) => s.users);
  const enrichCompany = useCrm((s) => s.enrichCompany);
  const updateCompany = useCrm((s) => s.updateCompany);
  const openDialog = useUi((s) => s.openDialog);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const stageMap = useStageMap();

  const ctx = useMemo(() => {
    const openPipelineByCompany = new Map<string, number>();
    deals.forEach((d) => {
      if (!d.companyId || stageMap.get(d.stageId)?.closed) return;
      openPipelineByCompany.set(d.companyId, (openPipelineByCompany.get(d.companyId) ?? 0) + d.amount);
    });
    const childCount = new Map<string, number>();
    companies.forEach((c) => c.parentId && childCount.set(c.parentId, (childCount.get(c.parentId) ?? 0) + 1));
    return { now: Date.now(), openPipelineByCompany, childCount };
  }, [deals, companies, stageMap]);

  const contactCount = useMemo(() => {
    const m = new Map<string, number>();
    contacts.forEach((c) => c.companyId && m.set(c.companyId, (m.get(c.companyId) ?? 0) + 1));
    return m;
  }, [contacts]);

  /** parents first, children directly beneath (org hierarchy) */
  const rows = useMemo(() => companies.filter((c) => view.test(c, ctx)), [companies, view, ctx]);
  const parentName = (c: Company) => companies.find((p) => p.id === c.parentId)?.name;

  const columns: Column<Company>[] = [
    {
      id: "name",
      header: "Company",
      sortValue: (c) => (c.parentId ? `${parentName(c) ?? ""} ~ ${c.name}` : c.name).toLowerCase(),
      cell: (c) => (
        <div className={cn("flex min-w-[240px] items-center gap-2.5", c.parentId && "pl-5")}>
          {c.parentId && <CornerDownRight className="-ml-5 size-3.5 text-sg-dim" />}
          <RecordAvatar label={c.name} color={tierColor[c.tier]} size="sm" square />
          <div className="min-w-0">
            <Link href={`/companies/${c.id}`} className="block truncate font-semibold text-sg-white hover:underline">
              {c.name}
            </Link>
            <div className="truncate text-2xs text-sg-dim">{c.domain}</div>
          </div>
        </div>
      ),
    },
    { id: "industry", header: "Industry", sortValue: (c) => c.industry, cell: (c) => <span className="whitespace-nowrap text-sg-muted">{c.industry}</span> },
    { id: "tier", header: "Tier", sortValue: (c) => c.tier, cell: (c) => <Chip color={tierColor[c.tier]}>{c.tier}</Chip> },
    { id: "stage", header: "Lifecycle", sortValue: (c) => c.lifecycleStage, cell: (c) => <Chip color={lifecycleMeta[c.lifecycleStage].color}>{lifecycleMeta[c.lifecycleStage].label}</Chip> },
    { id: "city", header: "City", sortValue: (c) => c.city, cell: (c) => <span className="text-sg-muted">{c.city}</span> },
    { id: "employees", header: "Employees", align: "right", sortValue: (c) => c.employees, cell: (c) => <span className="sg-num text-sg-muted">{formatNumber(c.employees)}</span> },
    { id: "revenue", header: "Revenue", align: "right", sortValue: (c) => c.annualRevenue, cell: (c) => <span className="sg-num text-sg-muted">{formatIDR(c.annualRevenue)}</span> },
    {
      id: "pipeline",
      header: "Open pipeline",
      align: "right",
      sortValue: (c) => ctx.openPipelineByCompany.get(c.id) ?? 0,
      cell: (c) => {
        const v = ctx.openPipelineByCompany.get(c.id);
        return v ? <span className="sg-num font-semibold text-sg-white">{formatIDR(v)}</span> : <span className="text-sg-dim">—</span>;
      },
    },
    { id: "contacts", header: "Contacts", align: "right", sortValue: (c) => contactCount.get(c.id) ?? 0, cell: (c) => <span className="sg-num text-sg-muted">{contactCount.get(c.id) ?? 0}</span> },
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
  ];

  const csvColumns: CsvColumn<Company>[] = [
    { header: "Company ID", value: (c) => c.id },
    { header: "Name", value: (c) => c.name },
    { header: "Domain", value: (c) => c.domain },
    { header: "Parent company", value: (c) => parentName(c) ?? "" },
    { header: "Industry", value: (c) => c.industry },
    { header: "Tier", value: (c) => c.tier },
    { header: "Lifecycle stage", value: (c) => lifecycleMeta[c.lifecycleStage].label },
    { header: "City", value: (c) => c.city },
    { header: "Country", value: (c) => c.country },
    { header: "Employees", value: (c) => c.employees },
    { header: "Annual revenue (IDR)", value: (c) => c.annualRevenue },
    { header: "Open pipeline (IDR)", value: (c) => ctx.openPipelineByCompany.get(c.id) ?? 0 },
    { header: "Contacts", value: (c) => contactCount.get(c.id) ?? 0 },
    { header: "Phone", value: (c) => c.phone },
    { header: "Owner", value: (c) => userMap.get(c.ownerId)?.name ?? "" },
    { header: "Enriched", value: (c) => c.enriched },
    { header: "Created", value: (c) => csvDate(c.createdAt) },
  ];

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Companies" meta={<span className="text-sm text-sg-dim">· {view.name}</span>}>
        <Button variant="primary" onClick={() => openDialog({ kind: "createCompany" })}>
          <Plus /> Create company <Kbd className="ml-1 border-sg-bg/30 bg-transparent text-sg-bg/70">C</Kbd>
        </Button>
      </PageHeader>
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-sg-line px-4">
        {COMPANY_LISTS.map((l) => (
          <button
            key={l.id}
            type="button"
            title={l.description}
            onClick={() => router.replace(l.id === "all" ? "/companies" : `/companies?view=${l.id}`)}
            className={cn("-mb-px flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm font-semibold", l.id === view.id ? "border-sg-white text-sg-white" : "border-transparent text-sg-muted hover:text-sg-white")}
          >
            {l.name}
            <span className="rounded-sm bg-sg-card-3 px-1 text-[10px] text-sg-muted">{companies.filter((c) => l.test(c, ctx)).length}</span>
          </button>
        ))}
      </div>
      <SmartTable
        rows={rows}
        columns={columns}
        hrefFor={(c) => `/companies/${c.id}`}
        searchText={(c) => `${c.name} ${c.domain} ${c.industry} ${c.city}`}
        initialSort={{ id: "name", dir: 1 }}
        tableId="companies"
        exportCsv={{ filename: () => csvFilename(view.id === "all" ? "companies" : `companies-${view.id}`), columns: csvColumns }}
        bulkActions={(ids, clear) => (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              ids.forEach((id) => enrichCompany(id));
              notify(`${ids.length} companies enriched`);
              clear();
            }}
          >
            <Sparkles /> Enrich from domain
          </Button>
        )}
      />
    </div>
  );
}
