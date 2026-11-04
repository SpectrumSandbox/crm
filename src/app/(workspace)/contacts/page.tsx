"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, SlidersHorizontal, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useCompanyMap, useStageMap, useUserMap } from "@/lib/selectors";
import { SMART_LISTS } from "@/lib/smart-lists";
import { LEAD_STATUSES, LIFECYCLE_STAGES, type Contact, type LifecycleStage } from "@/lib/types";
import { csvDate, csvDateTime, csvFilename, type CsvColumn } from "@/lib/csv";
import { leadStatusMeta, lifecycleMeta } from "@/lib/meta";
import { cn, formatIDR, relativeTime, scoreColor, softText } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { SmartTable, type Column } from "@/components/crm/smart-table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Avatar, Chip, Kbd, RecordAvatar } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";

export default function ContactsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const viewId = params.get("view") ?? "all";
  const view = SMART_LISTS.find((l) => l.id === viewId) ?? SMART_LISTS[0];

  const contacts = useCrm((s) => s.contacts);
  const deals = useCrm((s) => s.deals);
  const users = useCrm((s) => s.users);
  const updateContact = useCrm((s) => s.updateContact);
  const openDialog = useUi((s) => s.openDialog);
  const notify = useUi((s) => s.notify);
  const companyMap = useCompanyMap();
  const userMap = useUserMap();
  const stageMap = useStageMap();

  const [stages, setStages] = useState<LifecycleStage[]>([]);
  const [ownerId, setOwnerId] = useState("");
  const [minScore, setMinScore] = useState(0);

  const openPipelineByContact = useMemo(() => {
    const m = new Map<string, number>();
    deals.forEach((d) => {
      if (stageMap.get(d.stageId)?.closed) return;
      d.contactIds.forEach((c) => m.set(c, (m.get(c) ?? 0) + d.amount));
    });
    return m;
  }, [deals, stageMap]);

  const rows = useMemo(() => {
    const ctx = { now: Date.now(), openPipelineByContact };
    return contacts.filter((c) => view.test(c, ctx) && (!stages.length || stages.includes(c.lifecycleStage)) && (!ownerId || c.ownerId === ownerId) && c.leadScore >= minScore);
  }, [contacts, view, stages, ownerId, minScore, openPipelineByContact]);

  const columns: Column<Contact>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (c) => `${c.firstName} ${c.lastName}`.toLowerCase(),
      cell: (c) => (
        <div className="flex min-w-[200px] items-center gap-2.5">
          <RecordAvatar label={`${c.firstName} ${c.lastName}`} color={lifecycleMeta[c.lifecycleStage].color} size="sm" />
          <div className="min-w-0">
            <Link href={`/contacts/${c.id}`} className="block truncate font-semibold text-sg-white hover:underline">
              {c.firstName} {c.lastName}
            </Link>
            <div className="truncate text-2xs text-sg-dim">{c.email}</div>
          </div>
        </div>
      ),
    },
    {
      id: "company",
      header: "Company",
      sortValue: (c) => companyMap.get(c.companyId ?? "")?.name ?? "~",
      cell: (c) => {
        const co = companyMap.get(c.companyId ?? "");
        return co ? (
          <div className="min-w-[160px]">
            <Link href={`/companies/${co.id}`} className="text-sg-text hover:text-sg-white hover:underline">
              {co.name}
            </Link>
            <div className="truncate text-2xs text-sg-dim">{c.jobTitle}</div>
          </div>
        ) : (
          <span className="text-sg-dim">—</span>
        );
      },
    },
    {
      id: "stage",
      header: "Lifecycle",
      sortValue: (c) => LIFECYCLE_STAGES.indexOf(c.lifecycleStage),
      cell: (c) => (
        <Menu>
          <MenuTrigger asChild>
            <button type="button" className="rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-sg-white">
              <Chip color={lifecycleMeta[c.lifecycleStage].color}>{lifecycleMeta[c.lifecycleStage].label}</Chip>
            </button>
          </MenuTrigger>
          <MenuContent>
            <MenuLabel>Lifecycle stage</MenuLabel>
            {LIFECYCLE_STAGES.map((s) => (
              <MenuItem key={s} active={s === c.lifecycleStage} onSelect={() => updateContact(c.id, { lifecycleStage: s })}>
                {lifecycleMeta[s].label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      ),
    },
    {
      id: "score",
      header: "Score",
      align: "right",
      sortValue: (c) => c.leadScore,
      cell: (c) => (
        <div className="flex items-center justify-end gap-2">
          <div className="h-1 w-12 overflow-hidden rounded-full bg-sg-card-3">
            <div className={cn("h-full rounded-full", { green: "bg-soft-green", yellow: "bg-soft-yellow", orange: "bg-soft-orange", red: "bg-soft-red", blue: "bg-soft-blue", cyan: "bg-soft-cyan", magenta: "bg-soft-magenta" }[scoreColor(c.leadScore)])} style={{ width: `${c.leadScore}%` }} />
          </div>
          <span className={cn("sg-num w-6 font-bold", softText[scoreColor(c.leadScore)])}>{c.leadScore}</span>
        </div>
      ),
    },
    {
      id: "status",
      header: "Lead status",
      sortValue: (c) => LEAD_STATUSES.indexOf(c.leadStatus),
      cell: (c) => (
        <Menu>
          <MenuTrigger asChild>
            <button type="button" title="Change lead status" className="whitespace-nowrap rounded-sm px-1 py-0.5 text-sg-muted hover:bg-sg-card-3 hover:text-sg-white focus:outline-none focus-visible:ring-1 focus-visible:ring-sg-white">
              {leadStatusMeta[c.leadStatus]}
            </button>
          </MenuTrigger>
          <MenuContent>
            <MenuLabel>Lead status</MenuLabel>
            {LEAD_STATUSES.map((s) => (
              <MenuItem
                key={s}
                active={s === c.leadStatus}
                onSelect={() => {
                  if (s === c.leadStatus) return;
                  const prev = c.leadStatus;
                  updateContact(c.id, { leadStatus: s });
                  notify(`${c.firstName} ${c.lastName} → ${leadStatusMeta[s]}`, { label: "Undo", run: () => updateContact(c.id, { leadStatus: prev }) });
                }}
              >
                {leadStatusMeta[s]}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      ),
    },
    {
      id: "pipeline",
      header: "Open pipeline",
      align: "right",
      sortValue: (c) => openPipelineByContact.get(c.id) ?? 0,
      cell: (c) => {
        const v = openPipelineByContact.get(c.id);
        return v ? <span className="sg-num font-semibold text-sg-white">{formatIDR(v)}</span> : <span className="text-sg-dim">—</span>;
      },
    },
    {
      id: "last",
      header: "Last contacted",
      sortValue: (c) => c.lastContactedAt ?? "",
      cell: (c) => {
        const stale = !c.lastContactedAt || Date.now() - Date.parse(c.lastContactedAt) > 14 * 86_400_000;
        return <span className={cn(stale ? "text-soft-orange" : "text-sg-muted")}>{relativeTime(c.lastContactedAt)}</span>;
      },
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
            <MenuLabel>Contact owner</MenuLabel>
            {users.map((u) => (
              <MenuItem
                key={u.id}
                active={u.id === c.ownerId}
                onSelect={() => {
                  if (u.id === c.ownerId) return;
                  const prev = c.ownerId;
                  updateContact(c.id, { ownerId: u.id });
                  notify(`${c.firstName} ${c.lastName} assigned to ${u.name}`, { label: "Undo", run: () => updateContact(c.id, { ownerId: prev }) });
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

  const csvColumns: CsvColumn<Contact>[] = [
    { header: "Contact ID", value: (c) => c.id },
    { header: "First name", value: (c) => c.firstName },
    { header: "Last name", value: (c) => c.lastName },
    { header: "Email", value: (c) => c.email },
    { header: "Phone", value: (c) => c.phone },
    { header: "Job title", value: (c) => c.jobTitle },
    { header: "Company", value: (c) => companyMap.get(c.companyId ?? "")?.name ?? "" },
    { header: "Lifecycle stage", value: (c) => lifecycleMeta[c.lifecycleStage].label },
    { header: "Lead status", value: (c) => leadStatusMeta[c.leadStatus] },
    { header: "Lead score", value: (c) => c.leadScore },
    { header: "Open pipeline (IDR)", value: (c) => openPipelineByContact.get(c.id) ?? 0 },
    { header: "Owner", value: (c) => userMap.get(c.ownerId)?.name ?? "" },
    { header: "City", value: (c) => c.city },
    { header: "Source", value: (c) => c.source },
    { header: "Last contacted (WIB)", value: (c) => csvDateTime(c.lastContactedAt) },
    { header: "Created", value: (c) => csvDate(c.createdAt) },
  ];

  const activeFilters = stages.length + (ownerId ? 1 : 0) + (minScore ? 1 : 0);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Contacts" meta={<span className="text-sm text-sg-dim">· {view.name}</span>}>
        <Button variant="primary" onClick={() => openDialog({ kind: "createContact" })}>
          <Plus /> Create contact <Kbd className="ml-1 border-sg-bg/30 bg-transparent text-sg-bg/70">C</Kbd>
        </Button>
      </PageHeader>

      {/* smart list tabs */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-sg-line px-4">
        {SMART_LISTS.map((l) => {
          const ctx = { now: Date.now(), openPipelineByContact };
          const count = contacts.filter((c) => l.test(c, ctx)).length;
          return (
            <button
              key={l.id}
              type="button"
              title={l.description}
              onClick={() => router.replace(l.id === "all" ? "/contacts" : `/contacts?view=${l.id}`)}
              className={cn("-mb-px flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm font-semibold", l.id === view.id ? "border-sg-white text-sg-white" : "border-transparent text-sg-muted hover:text-sg-white")}
            >
              {l.name}
              <span className="rounded-sm bg-sg-card-3 px-1 text-[10px] text-sg-muted">{count}</span>
            </button>
          );
        })}
      </div>

      <SmartTable
        rows={rows}
        columns={columns}
        hrefFor={(c) => `/contacts/${c.id}`}
        searchText={(c) => `${c.firstName} ${c.lastName} ${c.email} ${c.jobTitle} ${companyMap.get(c.companyId ?? "")?.name ?? ""} ${c.city}`}
        initialSort={{ id: "score", dir: -1 }}
        tableId="contacts"
        exportCsv={{ filename: () => csvFilename(view.id === "all" ? "contacts" : `contacts-${view.id}`), columns: csvColumns }}
        toolbar={
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <SlidersHorizontal /> Filters {activeFilters ? <span className="rounded-sm bg-sg-white px-1 text-[10px] text-sg-bg">{activeFilters}</span> : null}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 space-y-3">
                <div>
                  <div className="sg-eyebrow mb-1.5">Lifecycle stage</div>
                  <div className="flex flex-wrap gap-1">
                    {LIFECYCLE_STAGES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setStages((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))}
                        className={cn("rounded-sm border px-1.5 py-0.5 text-2xs font-semibold", stages.includes(s) ? "border-sg-white text-sg-white" : "border-sg-line text-sg-muted hover:text-sg-white")}
                      >
                        {lifecycleMeta[s].label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="sg-eyebrow mb-1.5">Owner</div>
                  <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                    <option value="">Any owner</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <div className="sg-eyebrow mb-1.5 flex justify-between">
                    <span>Lead score ≥</span>
                    <span className="text-sg-white">{minScore}</span>
                  </div>
                  <input type="range" min={0} max={100} step={5} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="w-full accent-white" />
                </div>
                {activeFilters > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setStages([]);
                      setOwnerId("");
                      setMinScore(0);
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </PopoverContent>
            </Popover>
            {stages.map((s) => (
              <button key={s} type="button" onClick={() => setStages((cur) => cur.filter((x) => x !== s))} className="flex h-6 items-center gap-1 rounded-sm bg-sg-card-2 px-2 text-2xs font-semibold text-sg-text hover:bg-sg-card-3">
                {lifecycleMeta[s].label} <X className="size-3" />
              </button>
            ))}
            {minScore > 0 && (
              <button type="button" onClick={() => setMinScore(0)} className="flex h-6 items-center gap-1 rounded-sm bg-sg-card-2 px-2 text-2xs font-semibold text-sg-text hover:bg-sg-card-3">
                Score ≥ {minScore} <X className="size-3" />
              </button>
            )}
            {ownerId && (
              <button type="button" onClick={() => setOwnerId("")} className="flex h-6 items-center gap-1 rounded-sm bg-sg-card-2 px-2 text-2xs font-semibold text-sg-text hover:bg-sg-card-3">
                {userMap.get(ownerId)?.name} <X className="size-3" />
              </button>
            )}
          </>
        }
        bulkActions={(ids, clear) => (
          <>
            <Menu>
              <MenuTrigger asChild>
                <Button size="sm" variant="outline">
                  Set lifecycle stage
                </Button>
              </MenuTrigger>
              <MenuContent>
                {LIFECYCLE_STAGES.map((s) => (
                  <MenuItem
                    key={s}
                    onSelect={() => {
                      ids.forEach((id) => updateContact(id, { lifecycleStage: s }));
                      notify(`${ids.length} contacts → ${lifecycleMeta[s].label}`);
                      clear();
                    }}
                  >
                    {lifecycleMeta[s].label}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
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
                      ids.forEach((id) => updateContact(id, { ownerId: u.id }));
                      notify(`${ids.length} contacts assigned to ${u.name}`);
                      clear();
                    }}
                  >
                    <Avatar user={u} size="xs" /> {u.name}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          </>
        )}
      />
    </div>
  );
}
