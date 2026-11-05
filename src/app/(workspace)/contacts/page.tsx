"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Briefcase, MessageSquare, Plus, SlidersHorizontal, Ticket as TicketIcon, Users, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { strengthMeta, useCompanyMap, useEngagement, useStageMap, useUserMap } from "@/lib/selectors";
import { contactDuplicates, formatPhone, normalisePhone, SMART_LISTS, whatsappLink, type ContactContext } from "@/lib/smart-lists";
import { LEAD_STATUSES, LIFECYCLE_STAGES, type Contact, type LifecycleStage } from "@/lib/types";
import { csvDate, csvDateTime, csvFilename, type CsvColumn } from "@/lib/csv";
import { leadStatusMeta, lifecycleMeta } from "@/lib/meta";
import { cn, formatDate, formatIDR, relativeTime, scoreColor, softText } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { SmartTable, type Column } from "@/components/crm/smart-table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Avatar, Chip, Kbd, RecordAvatar } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { SavedViewsMenu } from "./saved-views";
import { MergeContactsDialog } from "./merge-contacts";

const DAY = 86_400_000;
const barColor = { green: "bg-soft-green", yellow: "bg-soft-yellow", orange: "bg-soft-orange", red: "bg-soft-red", blue: "bg-soft-blue", cyan: "bg-soft-cyan", magenta: "bg-soft-magenta" } as const;

export default function ContactsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const viewId = params.get("view") ?? "all";
  const view = SMART_LISTS.find((l) => l.id === viewId) ?? SMART_LISTS[0];

  /* filters live in the URL so they survive reloads and can be saved / shared */
  const stages = useMemo(() => (params.get("stage") ?? "").split(",").filter((s): s is LifecycleStage => (LIFECYCLE_STAGES as readonly string[]).includes(s)), [params]);
  const ownerId = params.get("owner") ?? "";
  const minScore = Math.max(0, Math.min(100, Number(params.get("min")) || 0));
  const q = params.get("q") ?? "";
  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      if (next.get("view") === "all") next.delete("view");
      const s = next.toString();
      router.replace(s ? `/contacts?${s}` : "/contacts");
    },
    [params, router],
  );
  const setStages = (next: LifecycleStage[]) => setParams({ stage: next.length ? next.join(",") : null });

  const contacts = useCrm((s) => s.contacts);
  const deals = useCrm((s) => s.deals);
  const users = useCrm((s) => s.users);
  const currentUserId = useCrm((s) => s.currentUserId);
  const updateContact = useCrm((s) => s.updateContact);
  const logWhatsApp = useCrm((s) => s.logWhatsApp);
  const deleteActivity = useCrm((s) => s.deleteActivity);
  const normaliseContactPhones = useCrm((s) => s.normaliseContactPhones);
  const undoPhoneFix = useCrm((s) => s.undoPhoneFix);
  const openDialog = useUi((s) => s.openDialog);
  const notify = useUi((s) => s.notify);
  const companyMap = useCompanyMap();
  const userMap = useUserMap();
  const stageMap = useStageMap();
  const engagement = useEngagement();
  const [merging, setMerging] = useState<[string, string] | null>(null);

  const openPipelineByContact = useMemo(() => {
    const m = new Map<string, number>();
    deals.forEach((d) => {
      if (stageMap.get(d.stageId)?.closed) return;
      d.contactIds.forEach((c) => m.set(c, (m.get(c) ?? 0) + d.amount));
    });
    return m;
  }, [deals, stageMap]);
  const duplicates = useMemo(() => contactDuplicates(contacts), [contacts]);
  const ctx: ContactContext = useMemo(() => ({ now: Date.now(), openPipelineByContact, currentUserId, duplicates }), [openPipelineByContact, currentUserId, duplicates]);

  /* tab counts — computed once per data change, not on every keystroke */
  const counts = useMemo(() => new Map(SMART_LISTS.map((l) => [l.id, contacts.filter((c) => l.test(c, ctx)).length] as const)), [contacts, ctx]);

  const rows = useMemo(
    () => contacts.filter((c) => view.test(c, ctx) && (!stages.length || stages.includes(c.lifecycleStage)) && (!ownerId || c.ownerId === ownerId) && c.leadScore >= minScore),
    [contacts, view, ctx, stages, ownerId, minScore],
  );

  const whatsapp = (c: Contact) => {
    const href = whatsappLink(c.phone, `Halo ${c.firstName}, `);
    if (!href) {
      notify(`${c.firstName} ${c.lastName} has no WhatsApp-capable mobile number — fix the phone first`);
      return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
    const prevLast = c.lastContactedAt;
    const id = logWhatsApp(c.id);
    notify(`WhatsApp opened for ${c.firstName} · logged on the timeline`, {
      label: "Undo",
      run: () => {
        if (id) deleteActivity(id);
        updateContact(c.id, { lastContactedAt: prevLast });
      },
    });
  };

  const newTicketHref = (c: Contact) => `/tickets?new=1&contactId=${encodeURIComponent(c.id)}${c.companyId ? `&companyId=${encodeURIComponent(c.companyId)}` : ""}`;

  const columns: Column<Contact>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (c) => `${c.firstName} ${c.lastName}`.toLowerCase(),
      cell: (c) => {
        const dups = duplicates.get(c.id);
        return (
          <div className="flex min-w-[200px] items-center gap-2.5">
            <RecordAvatar label={`${c.firstName} ${c.lastName}`} color={lifecycleMeta[c.lifecycleStage].color} size="sm" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Link href={`/contacts/${c.id}`} className="block truncate font-semibold text-sg-white hover:underline">
                  {c.firstName} {c.lastName}
                </Link>
                {dups?.length ? (
                  <button type="button" onClick={() => setMerging([c.id, dups[0]])} title="Looks like a duplicate — review and merge">
                    <Chip color="yellow">Duplicate?</Chip>
                  </button>
                ) : null}
              </div>
              <div className="truncate text-2xs text-sg-dim">{c.email}</div>
            </div>
          </div>
        );
      },
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
      id: "phone",
      header: "Phone",
      sortValue: (c) => normalisePhone(c.phone).e164 ?? "~",
      cell: (c) => {
        const info = normalisePhone(c.phone);
        const wa = whatsappLink(c.phone);
        return (
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            {info.valid ? (
              <a href={`tel:${info.e164}`} className="sg-num text-sg-muted hover:text-sg-white hover:underline">
                {formatPhone(c.phone)}
              </a>
            ) : (
              <span className="text-soft-orange" title="Missing or undialable — use +62 8xx-xxxx-xxxx">
                {c.phone || "No phone"}
              </span>
            )}
            {wa ? (
              <button type="button" onClick={() => whatsapp(c)} aria-label={`WhatsApp ${c.firstName} ${c.lastName}`} title="WhatsApp click-to-chat (logs the touch)" className="rounded p-0.5 text-soft-green hover:bg-soft-green/15">
                <MessageSquare className="size-3.5" />
              </button>
            ) : null}
          </div>
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
              <MenuItem
                key={s}
                active={s === c.lifecycleStage}
                onSelect={() => {
                  if (s === c.lifecycleStage) return;
                  const prev = c.lifecycleStage;
                  updateContact(c.id, { lifecycleStage: s });
                  notify(`${c.firstName} ${c.lastName} → ${lifecycleMeta[s].label}`, { label: "Undo", run: () => updateContact(c.id, { lifecycleStage: prev }) });
                }}
              >
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
            <div className={cn("h-full rounded-full", barColor[scoreColor(c.leadScore)])} style={{ width: `${c.leadScore}%` }} />
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
      id: "strength",
      header: "Relationship",
      sortValue: (c) => engagement.byContact.get(c.id)?.score ?? 0,
      cell: (c) => {
        const e = engagement.byContact.get(c.id);
        const meta = strengthMeta[e?.strength ?? "none"];
        const best = userMap.get(e?.strongestUserId ?? "");
        return (
          <div className="flex items-center gap-1.5 whitespace-nowrap" title={e ? `${e.touches30} touches in 30 days · ${e.touches90} in 90 days · score ${e.score}${best ? ` · strongest connection: ${best.name}` : ""}` : "No logged calls, meetings, emails or WhatsApp yet"}>
            <Chip color={meta.color}>{meta.label}</Chip>
            {best ? <Avatar user={best} size="xs" title={`Strongest connection: ${best.name}`} /> : null}
          </div>
        );
      },
    },
    {
      id: "last",
      header: "Last · next",
      sortValue: (c) => engagement.byContact.get(c.id)?.lastAt ?? c.lastContactedAt ?? "",
      cell: (c) => {
        const e = engagement.byContact.get(c.id);
        const last = e?.lastAt ?? c.lastContactedAt;
        const stale = !last || Date.now() - Date.parse(last) > 14 * DAY;
        return (
          <div className="whitespace-nowrap">
            <span className={cn(stale ? "text-soft-orange" : "text-sg-muted")} title={last ? `Last touch ${formatDate(last, "datetime")} WIB` : undefined}>
              {relativeTime(last)}
            </span>
            <div className={cn("text-2xs", e?.nextAt ? (Date.parse(e.nextAt) < Date.now() ? "text-soft-red" : "text-sg-dim") : "text-sg-dim")} title={e?.nextAt ? `Next touch ${formatDate(e.nextAt, "datetime")} WIB` : undefined}>
              {e?.nextAt ? `next ${relativeTime(e.nextAt)}` : "no next step"}
            </div>
          </div>
        );
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
    {
      id: "actions",
      header: "",
      hideable: false,
      cell: (c) => (
        <Menu>
          <MenuTrigger asChild>
            <button type="button" aria-label={`Actions for ${c.firstName} ${c.lastName}`} className="rounded px-1.5 py-0.5 text-sg-dim hover:bg-sg-card-3 hover:text-sg-white focus:outline-none focus-visible:ring-1 focus-visible:ring-sg-white">
              ⋯
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuLabel>
              {c.firstName} {c.lastName}
            </MenuLabel>
            <MenuItem onSelect={() => router.push(newTicketHref(c))}>
              <TicketIcon className="size-3.5" /> New ticket
            </MenuItem>
            <MenuItem onSelect={() => openDialog({ kind: "createDeal", contactId: c.id, companyId: c.companyId ?? undefined })}>
              <Briefcase className="size-3.5" /> New deal
            </MenuItem>
            <MenuItem onSelect={() => whatsapp(c)}>
              <MessageSquare className="size-3.5" /> WhatsApp
            </MenuItem>
            {duplicates.get(c.id)?.length ? (
              <>
                <MenuSeparator />
                <MenuLabel>Possible duplicates</MenuLabel>
                {duplicates.get(c.id)!.map((d) => {
                  const other = contacts.find((x) => x.id === d);
                  return other ? (
                    <MenuItem key={d} onSelect={() => setMerging([c.id, d])}>
                      <Users className="size-3.5" /> Merge with {other.firstName} {other.lastName}
                    </MenuItem>
                  ) : null;
                })}
              </>
            ) : null}
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
    { header: "Phone", value: (c) => formatPhone(c.phone) },
    { header: "Phone (E.164)", value: (c) => normalisePhone(c.phone).e164 ?? "" },
    { header: "Job title", value: (c) => c.jobTitle },
    { header: "Company", value: (c) => companyMap.get(c.companyId ?? "")?.name ?? "" },
    { header: "Lifecycle stage", value: (c) => lifecycleMeta[c.lifecycleStage].label },
    { header: "Lead status", value: (c) => leadStatusMeta[c.leadStatus] },
    { header: "Lead score", value: (c) => c.leadScore },
    { header: "Open pipeline (IDR)", value: (c) => openPipelineByContact.get(c.id) ?? 0 },
    { header: "Relationship", value: (c) => strengthMeta[engagement.byContact.get(c.id)?.strength ?? "none"].label },
    { header: "Strongest connection", value: (c) => userMap.get(engagement.byContact.get(c.id)?.strongestUserId ?? "")?.name ?? "" },
    { header: "Next touch (WIB)", value: (c) => csvDateTime(engagement.byContact.get(c.id)?.nextAt) },
    { header: "Owner", value: (c) => userMap.get(c.ownerId)?.name ?? "" },
    { header: "City", value: (c) => c.city },
    { header: "Source", value: (c) => c.source },
    { header: "Last contacted (WIB)", value: (c) => csvDateTime(c.lastContactedAt) },
    { header: "Created", value: (c) => csvDate(c.createdAt) },
  ];

  const activeFilters = stages.length + (ownerId ? 1 : 0) + (minScore ? 1 : 0);
  const queryString = params.toString();

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Contacts" meta={<span className="text-sm text-sg-dim">· {view.name}</span>}>
        <SavedViewsMenu object="contact" basePath="/contacts" query={queryString} />
        <Button variant="primary" onClick={() => openDialog({ kind: "createContact" })}>
          <Plus /> Create contact <Kbd className="ml-1 border-sg-bg/30 bg-transparent text-sg-bg/70">C</Kbd>
        </Button>
      </PageHeader>

      {/* smart list tabs */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-sg-line px-4" role="tablist" aria-label="Contact lists">
        {SMART_LISTS.map((l) => (
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
        hrefFor={(c) => `/contacts/${c.id}`}
        searchText={(c) => `${c.firstName} ${c.lastName} ${c.email} ${c.jobTitle} ${companyMap.get(c.companyId ?? "")?.name ?? ""} ${c.city} ${c.phone} ${normalisePhone(c.phone).e164 ?? ""} ${(normalisePhone(c.phone).e164 ?? "").replace(/^\+62/, "0")}`}
        initialSort={{ id: "score", dir: -1 }}
        tableId="contacts"
        query={q}
        onQueryChange={(v) => setParams({ q: v || null })}
        emptyText={view.id === "duplicates" ? "No likely duplicates — every contact has a unique email, phone and name at its company." : view.id === "bad-phone" ? "Every contact has a dialable phone number." : "No contacts match these filters."}
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
                        aria-pressed={stages.includes(s)}
                        onClick={() => setStages(stages.includes(s) ? stages.filter((x) => x !== s) : [...stages, s])}
                        className={cn("rounded-sm border px-1.5 py-0.5 text-2xs font-semibold", stages.includes(s) ? "border-sg-white text-sg-white" : "border-sg-line text-sg-muted hover:text-sg-white")}
                      >
                        {lifecycleMeta[s].label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="sg-eyebrow mb-1.5">Owner</div>
                  <Select value={ownerId} onChange={(e) => setParams({ owner: e.target.value || null })} aria-label="Owner">
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
                  <input type="range" min={0} max={100} step={5} value={minScore} aria-label="Minimum lead score" onChange={(e) => setParams({ min: Number(e.target.value) ? e.target.value : null })} className="w-full accent-white" />
                </div>
                {activeFilters > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setParams({ stage: null, owner: null, min: null })}>
                    Clear filters
                  </Button>
                )}
              </PopoverContent>
            </Popover>
            {stages.map((s) => (
              <button key={s} type="button" onClick={() => setStages(stages.filter((x) => x !== s))} className="flex h-6 items-center gap-1 rounded-sm bg-sg-card-2 px-2 text-2xs font-semibold text-sg-text hover:bg-sg-card-3">
                {lifecycleMeta[s].label} <X className="size-3" />
              </button>
            ))}
            {minScore > 0 && (
              <button type="button" onClick={() => setParams({ min: null })} className="flex h-6 items-center gap-1 rounded-sm bg-sg-card-2 px-2 text-2xs font-semibold text-sg-text hover:bg-sg-card-3">
                Score ≥ {minScore} <X className="size-3" />
              </button>
            )}
            {ownerId && (
              <button type="button" onClick={() => setParams({ owner: null })} className="flex h-6 items-center gap-1 rounded-sm bg-sg-card-2 px-2 text-2xs font-semibold text-sg-text hover:bg-sg-card-3">
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
                      const prev = ids.map((id) => [id, contacts.find((c) => c.id === id)?.lifecycleStage] as const);
                      ids.forEach((id) => updateContact(id, { lifecycleStage: s }));
                      notify(`${ids.length === 1 ? "1 contact" : `${ids.length} contacts`} → ${lifecycleMeta[s].label}`, { label: "Undo", run: () => prev.forEach(([id, st]) => st && updateContact(id, { lifecycleStage: st })) });
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
                      const prev = ids.map((id) => [id, contacts.find((c) => c.id === id)?.ownerId] as const);
                      ids.forEach((id) => updateContact(id, { ownerId: u.id }));
                      notify(`${ids.length === 1 ? "1 contact" : `${ids.length} contacts`} assigned to ${u.name}`, { label: "Undo", run: () => prev.forEach(([id, o]) => o && updateContact(id, { ownerId: o })) });
                      clear();
                    }}
                  >
                    <Avatar user={u} size="xs" /> {u.name}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            <Button
              size="sm"
              variant="outline"
              title="Rewrite phone numbers as +62 8xx-xxxx-xxxx / +62 21 xxxx xxxx"
              onClick={() => {
                const undo = normaliseContactPhones(ids);
                notify(undo.phones.length ? `${undo.phones.length === 1 ? "1 phone number" : `${undo.phones.length} phone numbers`} normalised to +62` : "Phone numbers are already in +62 format (invalid ones are left for you to fix)", undo.phones.length ? { label: "Undo", run: () => undoPhoneFix(undo) } : undefined);
              }}
            >
              Normalise phones
            </Button>
            {ids.length === 2 && (
              <Button size="sm" variant="outline" onClick={() => setMerging([ids[0], ids[1]])}>
                <Users /> Merge 2 contacts
              </Button>
            )}
          </>
        )}
      />

      {merging && <MergeContactsDialog key={merging.join("|")} ids={merging} onClose={() => setMerging(null)} />}
    </div>
  );
}
