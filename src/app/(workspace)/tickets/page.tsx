"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { Building2, CircleCheck, Clock, Columns3, Hourglass, Kanban, Plus, Rows3, Search, Star, Ticket as TicketIcon } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { slaDueFor, ticketSla, useCompanyMap, useStageMap, useTicketEscalationInfo, useUserMap, type SlaState, type TicketEscalation } from "@/lib/selectors";
import { isWaitingStage } from "@/lib/slices/crm-service";
import { ticketPriorityMeta } from "@/lib/meta";
import type { Company, PipelineStage, Ticket, TicketPriority, User } from "@/lib/types";
import { cn, formatDate, softBorderLeft } from "@/lib/utils";
import { csvDateTime, csvFilename, downloadCsv, getCsvFormat, setCsvFormat, type CsvColumn, type CsvFormat } from "@/lib/csv";
import { PageHeader } from "@/components/shell/page-header";
import { CsvExportMenu, SmartTable, type Column } from "@/components/crm/smart-table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Avatar, Chip, Dot, EmptyState, Kbd } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/overlays";
import { SavedViewsMenu } from "../contacts/saved-views";
import { TicketComposer, type ComposerPrefill } from "./ticket-composer";
import { CsatDialog } from "./csat-dialog";

type View = "board" | "table";

const PRIORITIES: TicketPriority[] = ["urgent", "high", "medium", "low"];
const PRIORITY_RANK: Record<TicketPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const slaText: Record<SlaState, string> = {
  met: "text-soft-green",
  late: "text-soft-orange",
  breached: "font-semibold text-soft-red",
  due_soon: "font-semibold text-soft-orange",
  on_track: "text-sg-muted",
  paused: "text-soft-yellow",
};
const slaBg: Record<SlaState, string> = { met: "bg-sg-card-2", late: "bg-soft-orange/10", breached: "bg-soft-red/10", due_soon: "bg-soft-orange/10", on_track: "bg-sg-card-2", paused: "bg-soft-yellow/10" };

export default function TicketsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const pipelines = useCrm((s) => s.pipelines);
  const tickets = useCrm((s) => s.tickets);
  const users = useCrm((s) => s.users);
  const contacts = useCrm((s) => s.contacts);
  const moveServiceTicket = useCrm((s) => s.moveServiceTicket);
  const undoTicketMove = useCrm((s) => s.undoTicketMove);
  const reconcileSlaPauses = useCrm((s) => s.reconcileSlaPauses);
  const updateTicket = useCrm((s) => s.updateTicket);
  const notify = useUi((s) => s.notify);
  const stageMap = useStageMap();
  const userMap = useUserMap();
  const companyMap = useCompanyMap();
  const escalations = useTicketEscalationInfo();

  const pipeline = useMemo(() => pipelines.find((p) => p.objectType === "ticket" && p.name === "Field Support") ?? pipelines.find((p) => p.objectType === "ticket"), [pipelines]);

  /* filters live in the URL (shareable, survive reloads, can be saved as views) */
  const view: View = params.get("view") === "table" ? "table" : "board";
  const q = params.get("q") ?? "";
  const ownerId = params.get("owner") ?? "";
  const priorityParam = params.get("priority") ?? "";
  const priority = (PRIORITIES as string[]).includes(priorityParam) ? (priorityParam as TicketPriority) : "";
  const hideClosed = params.get("open") === "1";
  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      const s = next.toString();
      router.replace(s ? `/tickets?${s}` : "/tickets");
    },
    [params, router],
  );

  /* "/tickets?new=1&companyId=…&contactId=…" opens the composer prefilled (used from contact / company lists) */
  const [creating, setCreating] = useState<ComposerPrefill | null>(null);
  useEffect(() => {
    if (params.get("new") !== "1") return;
    setCreating({ companyId: params.get("companyId") ?? undefined, contactId: params.get("contactId") ?? undefined });
    setParams({ new: null, companyId: null, contactId: null });
  }, [params, setParams]);
  const [rating, setRating] = useState<string | null>(null);

  /* live SLA countdown */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  /* tickets moved into / out of "Waiting on Customer" from another screen get their SLA clock paused / resumed */
  useEffect(() => {
    reconcileSlaPauses();
  }, [tickets, reconcileSlaPauses]);

  /* "C" creates a ticket on this page (the global hotkey would open "Create deal") */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "c" && e.key !== "C") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const ui = useUi.getState();
      if (ui.dialog || ui.paletteOpen || ui.issueId || document.querySelector("[role=dialog],[role=menu]")) return;
      e.preventDefault();
      e.stopPropagation();
      setCreating({});
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const contactName = useMemo(() => new Map(contacts.map((c) => [c.id, `${c.firstName} ${c.lastName}`] as const)), [contacts]);
  const isClosed = useCallback((t: Ticket) => !!t.closedAt || !!stageMap.get(t.stageId)?.closed, [stageMap]);

  /* board filters (the table applies the search itself, so it can drive j/k over exactly what is shown) */
  const base = useMemo(
    () =>
      tickets.filter((t) => {
        if (pipeline && t.pipelineId !== pipeline.id) return false;
        if (ownerId && t.ownerId !== ownerId) return false;
        if (priority && t.priority !== priority) return false;
        if (hideClosed && isClosed(t)) return false;
        return true;
      }),
    [tickets, pipeline, ownerId, priority, hideClosed, isClosed],
  );
  const searchText = useCallback((t: Ticket) => `${t.id} ${t.subject} ${t.category} ${companyMap.get(t.companyId ?? "")?.name ?? ""} ${contactName.get(t.contactId ?? "") ?? ""}`, [companyMap, contactName]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? base.filter((t) => searchText(t).toLowerCase().includes(needle)) : base;
  }, [base, q, searchText]);

  const stats = useMemo(() => {
    const open = filtered.filter((t) => !isClosed(t));
    const states = open.map((t) => ticketSla(t, now).state);
    const rated = filtered.filter((t) => typeof t.csat === "number");
    return {
      open: open.length,
      breached: states.filter((s) => s === "breached").length,
      dueSoon: states.filter((s) => s === "due_soon").length,
      paused: states.filter((s) => s === "paused").length,
      urgent: open.filter((t) => t.priority === "urgent" || t.priority === "high").length,
      escalated: open.filter((t) => (escalations.get(t.id)?.open ?? 0) > 0).length,
      readyToResolve: open.filter((t) => isReady(escalations.get(t.id))).length,
      csat: rated.length ? rated.reduce((s, t) => s + (t.csat ?? 0), 0) / rated.length : null,
      csatCount: rated.length,
    };
  }, [filtered, isClosed, now, escalations]);

  /** move with a clean undo; resolving asks for an optional CSAT */
  const move = (t: Ticket, stageId: string) => {
    const undo = moveServiceTicket(t.id, stageId);
    if (!undo) return;
    const to = stageMap.get(stageId);
    const paused = isWaitingStage(to);
    notify(to?.closed ? `${t.id.toUpperCase()} resolved` : paused ? `${t.id.toUpperCase()} waiting on customer · SLA paused` : `${t.id.toUpperCase()} → ${to?.name ?? "stage"}`, { label: "Undo", run: () => undoTicketMove(undo) });
    if (to?.closed === "won") setRating(t.id);
  };

  const onDragEnd = (r: DropResult) => {
    if (!r.destination || r.destination.droppableId === r.source.droppableId) return;
    const t = tickets.find((x) => x.id === r.draggableId);
    if (t) move(t, r.destination.droppableId);
  };

  const setPriority = (t: Ticket, p: TicketPriority) => {
    if (t.priority === p) return;
    const prev = { priority: t.priority, slaDueAt: t.slaDueAt, slaBasis: t.slaBasis };
    updateTicket(t.id, { priority: p });
    notify(`${t.id.toUpperCase()} → ${ticketPriorityMeta[p].label}. Reset the SLA to the ${ticketPriorityMeta[p].label.toLowerCase()} target?`, {
      label: "Reset SLA",
      run: () => {
        const sla = slaDueFor(p, Date.parse(t.createdAt));
        updateTicket(t.id, { slaDueAt: sla.dueAt, slaBasis: sla.basis });
        notify(`${t.id.toUpperCase()} SLA now due ${formatDate(sla.dueAt, "datetime")} WIB`, { label: "Undo", run: () => updateTicket(t.id, prev) });
      },
    });
  };

  const csvColumns: CsvColumn<Ticket>[] = [
    { header: "Ticket", value: (t) => t.id.toUpperCase() },
    { header: "Subject", value: (t) => t.subject },
    { header: "Status", value: (t) => stageMap.get(t.stageId)?.name ?? "" },
    { header: "Priority", value: (t) => ticketPriorityMeta[t.priority].label },
    { header: "Category", value: (t) => t.category },
    { header: "Company", value: (t) => companyMap.get(t.companyId ?? "")?.name ?? "" },
    { header: "Contact", value: (t) => contactName.get(t.contactId ?? "") ?? "" },
    { header: "Owner", value: (t) => userMap.get(t.ownerId)?.name ?? "" },
    { header: "SLA due (WIB)", value: (t) => csvDateTime(t.slaDueAt) },
    { header: "SLA basis", value: (t) => (t.slaBasis === "business" ? "Business hours" : "24/7") },
    { header: "SLA status", value: (t) => ticketSla(t, now).label },
    { header: "SLA paused (hours)", value: (t) => Math.round(((t.slaPausedMs ?? 0) + (t.slaPausedAt ? now - Date.parse(t.slaPausedAt) : 0)) / 360_000) / 10 },
    { header: "Open Jira escalations", value: (t) => escalations.get(t.id)?.open ?? 0 },
    { header: "CSAT (1-5)", value: (t) => (typeof t.csat === "number" ? t.csat : "") },
    { header: "CSAT comment", value: (t) => t.csatComment ?? "" },
    { header: "Created (WIB)", value: (t) => csvDateTime(t.createdAt) },
    { header: "Closed (WIB)", value: (t) => csvDateTime(t.closedAt) },
    { header: "Description", value: (t) => t.description },
  ];

  const [csvFormat, setFormat] = useState<CsvFormat>("comma");
  useEffect(() => setFormat(getCsvFormat()), []);

  if (!pipeline) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Tickets" />
        <EmptyState icon={TicketIcon} title="No ticket pipeline configured">
          Add a pipeline with objectType “ticket” to start tracking support work.
        </EmptyState>
      </div>
    );
  }

  const stageMenu = (t: Ticket, trigger: React.ReactNode) => (
    <Menu>
      <MenuTrigger asChild>{trigger}</MenuTrigger>
      <MenuContent>
        <MenuLabel>Move {t.id.toUpperCase()} to</MenuLabel>
        {pipeline.stages.map((s) => (
          <MenuItem key={s.id} active={s.id === t.stageId} onSelect={() => s.id !== t.stageId && move(t, s.id)}>
            <Dot color={s.color} /> {s.name}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );

  const columns: Column<Ticket>[] = [
    { id: "id", header: "Ticket", sortValue: (t) => Number(t.id.split("-")[1]) || 0, cell: (t) => <span className="sg-num whitespace-nowrap text-2xs font-semibold text-sg-dim">{t.id.toUpperCase()}</span> },
    {
      id: "subject",
      header: "Subject",
      hideable: false,
      sortValue: (t) => t.subject.toLowerCase(),
      cell: (t) => (
        <div className="min-w-[220px]">
          <Link href={`/tickets/${t.id}`} className="font-semibold text-sg-white hover:underline">
            {t.subject}
          </Link>
          <div className="text-2xs text-sg-dim">{t.category}</div>
        </div>
      ),
    },
    {
      id: "stage",
      header: "Status",
      sortValue: (t) => pipeline.stages.findIndex((s) => s.id === t.stageId),
      cell: (t) => {
        const stage = stageMap.get(t.stageId);
        return stageMenu(
          t,
          <button type="button" title="Change status" className="rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-sg-white">
            {stage ? (
              <Chip color={stage.color} dot>
                {stage.name}
              </Chip>
            ) : (
              <Chip color="blue">—</Chip>
            )}
          </button>,
        );
      },
    },
    {
      id: "priority",
      header: "Priority",
      sortValue: (t) => PRIORITY_RANK[t.priority],
      cell: (t) => (
        <Menu>
          <MenuTrigger asChild>
            <button type="button" title="Change priority" className="rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-sg-white">
              <Chip color={ticketPriorityMeta[t.priority].color}>{ticketPriorityMeta[t.priority].label}</Chip>
            </button>
          </MenuTrigger>
          <MenuContent>
            <MenuLabel>Priority</MenuLabel>
            {PRIORITIES.map((p) => (
              <MenuItem key={p} active={p === t.priority} onSelect={() => setPriority(t, p)}>
                {ticketPriorityMeta[p].label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      ),
    },
    {
      id: "sla",
      header: "SLA",
      sortValue: (t) => `${isClosed(t) ? 2 : t.slaPausedAt ? 1 : 0}${t.slaDueAt}`,
      cell: (t) => {
        const sla = ticketSla(t, now);
        return (
          <span className={cn("whitespace-nowrap", slaText[sla.state])} title={`Due ${formatDate(t.slaDueAt, "datetime")} WIB · ${t.slaBasis === "business" ? "business hours" : "24/7 clock"}`}>
            {sla.label}
          </span>
        );
      },
    },
    {
      id: "company",
      header: "Company",
      sortValue: (t) => (companyMap.get(t.companyId ?? "")?.name ?? "~").toLowerCase(),
      cell: (t) =>
        t.companyId && companyMap.get(t.companyId) ? (
          <Link href={`/companies/${t.companyId}`} className="whitespace-nowrap text-sg-muted hover:text-sg-white hover:underline">
            {companyMap.get(t.companyId)!.name}
          </Link>
        ) : (
          <span className="text-sg-dim">—</span>
        ),
    },
    {
      id: "contact",
      header: "Contact",
      sortValue: (t) => contactName.get(t.contactId ?? "") ?? "~",
      cell: (t) =>
        t.contactId && contactName.get(t.contactId) ? (
          <Link href={`/contacts/${t.contactId}`} className="whitespace-nowrap text-sg-muted hover:text-sg-white hover:underline">
            {contactName.get(t.contactId)}
          </Link>
        ) : (
          <span className="text-sg-dim">—</span>
        ),
    },
    {
      id: "owner",
      header: "Owner",
      sortValue: (t) => userMap.get(t.ownerId)?.name ?? "",
      cell: (t) => (
        <Menu>
          <MenuTrigger asChild>
            <button type="button" title="Change owner" className="flex items-center gap-1.5 whitespace-nowrap rounded-sm px-1 py-0.5 text-sg-muted hover:bg-sg-card-3 hover:text-sg-white focus:outline-none focus-visible:ring-1 focus-visible:ring-sg-white">
              <Avatar user={userMap.get(t.ownerId)} size="xs" /> {userMap.get(t.ownerId)?.name.split(" ")[0] ?? "Unassigned"}
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuLabel>Ticket owner</MenuLabel>
            {users.map((u) => (
              <MenuItem
                key={u.id}
                active={u.id === t.ownerId}
                onSelect={() => {
                  if (u.id === t.ownerId) return;
                  const prev = t.ownerId;
                  updateTicket(t.id, { ownerId: u.id });
                  notify(`${t.id.toUpperCase()} assigned to ${u.name}`, { label: "Undo", run: () => updateTicket(t.id, { ownerId: prev }) });
                }}
              >
                <Avatar user={u} size="xs" /> {u.name}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      ),
    },
    { id: "jira", header: "Jira", align: "right", sortValue: (t) => escalations.get(t.id)?.open ?? 0, cell: (t) => <EscalationChip esc={escalations.get(t.id)} closed={isClosed(t)} /> },
    {
      id: "csat",
      header: "CSAT",
      align: "right",
      sortValue: (t) => t.csat ?? -1,
      cell: (t) =>
        typeof t.csat === "number" ? (
          <button type="button" onClick={() => setRating(t.id)} title={t.csatComment || "Edit rating"} className={cn("sg-num font-semibold", t.csat >= 4 ? "text-soft-green" : t.csat === 3 ? "text-soft-yellow" : "text-soft-red")}>
            {t.csat}/5
          </button>
        ) : isClosed(t) ? (
          <button type="button" onClick={() => setRating(t.id)} className="text-2xs text-sg-dim hover:text-sg-white">
            Rate
          </button>
        ) : (
          <span className="text-sg-dim">—</span>
        ),
    },
    { id: "created", header: "Created", sortValue: (t) => t.createdAt, cell: (t) => <span className="whitespace-nowrap text-sg-muted">{formatDate(t.createdAt)}</span> },
  ];

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Tickets" meta={<span className="text-sm text-sg-dim">· {pipeline.name}</span>}>
        {view === "board" && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sg-dim" />
            <input data-page-filter value={q} onChange={(e) => setParams({ q: e.target.value || null })} placeholder="Filter tickets" aria-label="Filter tickets" className="h-8 w-52 rounded border border-sg-line bg-sg-bg/60 pl-7 pr-8 text-sm text-sg-text placeholder:text-sg-dim focus:border-sg-white/60 focus:outline-none" />
            <Kbd className="absolute right-1.5 top-1/2 -translate-y-1/2">/</Kbd>
          </div>
        )}
        <Select value={ownerId} onChange={(e) => setParams({ owner: e.target.value || null })} wrapperClassName="w-40" aria-label="Owner">
          <option value="">All owners</option>
          {users
            .filter((u) => tickets.some((t) => t.ownerId === u.id))
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
        </Select>
        <Select value={priority} onChange={(e) => setParams({ priority: e.target.value || null })} wrapperClassName="w-36" aria-label="Priority">
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {ticketPriorityMeta[p].label}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-sg-muted">
          <input type="checkbox" checked={hideClosed} onChange={(e) => setParams({ open: e.target.checked ? "1" : null })} className="size-3.5 accent-white" /> Hide resolved
        </label>
        <div className="flex rounded border border-sg-line p-0.5">
          {(
            [
              ["board", Columns3],
              ["table", Rows3],
            ] as const
          ).map(([v, Icon]) => (
            <button key={v} type="button" onClick={() => setParams({ view: v === "board" ? null : v })} aria-label={`${v} view`} aria-pressed={view === v} className={cn("flex h-6 w-7 items-center justify-center rounded-sm", view === v ? "bg-sg-card-3 text-sg-white" : "text-sg-dim hover:text-sg-white")}>
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
        <SavedViewsMenu object="ticket" basePath="/tickets" query={params.toString()} />
        {view === "board" && (
          <CsvExportMenu
            count={filtered.length}
            format={csvFormat}
            variant="outline"
            size="md"
            onExport={(f) => {
              setCsvFormat(f);
              setFormat(f);
              downloadCsv(csvFilename("tickets"), [...filtered].sort((a, b) => a.slaDueAt.localeCompare(b.slaDueAt)), csvColumns, f);
            }}
          />
        )}
        <Button variant="primary" size="md" onClick={() => setCreating({})}>
          <Plus /> New ticket <Kbd className="ml-1 border-sg-bg/30 bg-transparent text-sg-bg/70">C</Kbd>
        </Button>
      </PageHeader>

      <div className="grid shrink-0 grid-cols-2 border-b border-sg-line sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Open tickets" value={String(stats.open)} hint={`${stats.urgent} urgent or high`} />
        <Stat label="SLA breached" value={String(stats.breached)} tone={stats.breached ? "red" : undefined} hint="past due, still open" />
        <Stat label="Due in < 12h" value={String(stats.dueSoon)} tone={stats.dueSoon ? "orange" : undefined} hint="at risk" />
        <Stat label="SLA paused" value={String(stats.paused)} hint="waiting on the customer" />
        <Stat label="Escalated to Jira" value={String(stats.escalated)} hint={stats.readyToResolve ? `${stats.readyToResolve} ready to resolve` : "open engineering work"} />
        <Stat label="CSAT" value={stats.csat === null ? "—" : `${stats.csat.toFixed(1)}/5`} tone={stats.csat !== null && stats.csat < 3.5 ? "orange" : undefined} hint={stats.csatCount ? `${stats.csatCount} ${stats.csatCount === 1 ? "rating" : "ratings"}` : "no ratings yet"} />
      </div>

      {view === "board" ? (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
            {pipeline.stages.map((stage) => {
              const col = filtered.filter((t) => t.stageId === stage.id).sort((a, b) => a.slaDueAt.localeCompare(b.slaDueAt));
              const breached = col.filter((t) => ticketSla(t, now).state === "breached").length;
              return (
                <div key={stage.id} className="flex w-[272px] shrink-0 flex-col rounded-xl border border-sg-line bg-sg-card/60">
                  <div className="border-b border-sg-line px-3 pb-2 pt-3">
                    <div className="flex items-center gap-2">
                      <Dot color={stage.color} />
                      <span className="truncate text-xs font-bold uppercase tracking-[0.08em] text-sg-white">{stage.name}</span>
                      <span className="ml-auto rounded-sm bg-sg-card-3 px-1.5 text-2xs font-semibold text-sg-muted">{col.length}</span>
                    </div>
                    <div className="mt-1.5 text-2xs text-sg-dim">
                      {stage.closed ? "Closed — SLA clock stopped" : isWaitingStage(stage) ? "SLA clock paused" : breached ? <span className="font-semibold text-soft-red">{breached} breached</span> : "All within SLA"}
                    </div>
                  </div>
                  <Droppable droppableId={stage.id}>
                    {(provided, snapshot) => (
                      <div ref={provided.innerRef} {...provided.droppableProps} className={cn("flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors", snapshot.isDraggingOver && "bg-sg-card-2/60")}>
                        {col.map((t, index) => (
                          <Draggable key={t.id} draggableId={t.id} index={index}>
                            {(p, s) => (
                              <div ref={p.innerRef} {...p.draggableProps} {...p.dragHandleProps} style={p.draggableProps.style}>
                                <TicketCard ticket={t} now={now} dragging={s.isDragging} esc={escalations.get(t.id)} stage={stageMap.get(t.stageId)} company={companyMap.get(t.companyId ?? "")} owner={userMap.get(t.ownerId)} />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {!col.length && !snapshot.isDraggingOver && <p className="py-6 text-center text-2xs text-sg-dim">{stage.closed ? "Drop here to resolve" : "No tickets"}</p>}
                      </div>
                    )}
                  </Droppable>
                  {!stage.closed && (
                    <button type="button" onClick={() => setCreating({ stageId: stage.id })} className="flex h-8 items-center gap-1.5 border-t border-sg-line px-3 text-xs text-sg-dim hover:text-sg-white">
                      <Plus className="size-3.5" /> Add ticket
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </DragDropContext>
      ) : (
        <SmartTable
          rows={base}
          columns={columns}
          hrefFor={(t) => `/tickets/${t.id}`}
          searchText={searchText}
          query={q}
          onQueryChange={(v) => setParams({ q: v || null })}
          initialSort={{ id: "sla", dir: 1 }}
          tableId="tickets"
          emptyText="No tickets match these filters — clear the search or filters, or press C to open a new ticket."
          exportCsv={{ filename: () => csvFilename("tickets"), columns: csvColumns }}
          bulkActions={(ids, clear) => {
            const selected = tickets.filter((t) => ids.includes(t.id));
            return (
              <>
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
                          const prev = selected.map((t) => [t.id, t.ownerId] as const);
                          selected.forEach((t) => updateTicket(t.id, { ownerId: u.id }));
                          notify(`${selected.length === 1 ? "1 ticket" : `${selected.length} tickets`} assigned to ${u.name}`, { label: "Undo", run: () => prev.forEach(([id, o]) => updateTicket(id, { ownerId: o })) });
                          clear();
                        }}
                      >
                        <Avatar user={u} size="xs" /> {u.name}
                      </MenuItem>
                    ))}
                  </MenuContent>
                </Menu>
                <Menu>
                  <MenuTrigger asChild>
                    <Button size="sm" variant="outline">
                      Set priority
                    </Button>
                  </MenuTrigger>
                  <MenuContent>
                    {PRIORITIES.map((p) => (
                      <MenuItem
                        key={p}
                        onSelect={() => {
                          const prev = selected.map((t) => [t.id, t.priority] as const);
                          selected.forEach((t) => updateTicket(t.id, { priority: p }));
                          notify(`${selected.length === 1 ? "1 ticket" : `${selected.length} tickets`} → ${ticketPriorityMeta[p].label} (SLA deadlines unchanged)`, { label: "Undo", run: () => prev.forEach(([id, pr]) => updateTicket(id, { priority: pr })) });
                          clear();
                        }}
                      >
                        {ticketPriorityMeta[p].label}
                      </MenuItem>
                    ))}
                  </MenuContent>
                </Menu>
                <Menu>
                  <MenuTrigger asChild>
                    <Button size="sm" variant="outline">
                      Move to
                    </Button>
                  </MenuTrigger>
                  <MenuContent>
                    {pipeline.stages.map((s) => (
                      <MenuItem
                        key={s.id}
                        onSelect={() => {
                          const undos = selected.map((t) => moveServiceTicket(t.id, s.id)).filter((u): u is NonNullable<typeof u> => !!u);
                          notify(`${undos.length === 1 ? "1 ticket" : `${undos.length} tickets`} → ${s.name}`, { label: "Undo", run: () => [...undos].reverse().forEach((u) => undoTicketMove(u)) });
                          clear();
                        }}
                      >
                        <Dot color={s.color} /> {s.name}
                      </MenuItem>
                    ))}
                  </MenuContent>
                </Menu>
              </>
            );
          }}
        />
      )}

      {creating && <TicketComposer prefill={creating} onClose={() => setCreating(null)} />}
      {rating && <CsatDialog ticketId={rating} onClose={() => setRating(null)} />}
    </div>
  );
}

/** every escalation issue is done but the ticket is still open → the owner can resolve it */
function isReady(esc: TicketEscalation | undefined) {
  return !!esc && esc.open === 0 && esc.done > 0;
}

function EscalationChip({ esc, closed }: { esc: TicketEscalation | undefined; closed: boolean }) {
  if (!esc) return <span className="text-sg-dim">—</span>;
  if (esc.open) return <Chip color="cyan" title={`Open: ${esc.keys.slice(0, esc.open).join(", ")}`}>{esc.open} open</Chip>;
  if (!closed)
    return (
      <Chip color="green" title={`${esc.keys.join(", ")} done`}>
        Jira done
      </Chip>
    );
  return <span className="text-2xs text-sg-dim">{esc.done} done</span>;
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "orange" | "red" }) {
  return (
    <div className="border-b border-r border-sg-line px-5 py-3 lg:border-b-0 lg:last:border-r-0">
      <div className="sg-eyebrow">{label}</div>
      <div className={cn("sg-num mt-1 font-display text-xl font-extrabold", tone === "orange" ? "text-soft-orange" : tone === "red" ? "text-soft-red" : "text-sg-white")}>{value}</div>
      {hint ? <div className="truncate text-2xs text-sg-dim">{hint}</div> : null}
    </div>
  );
}

function TicketCard({ ticket, now, dragging, esc, stage, company, owner }: { ticket: Ticket; now: number; dragging: boolean; esc: TicketEscalation | undefined; stage: PipelineStage | undefined; company: Company | undefined; owner: User | undefined }) {
  const sla = ticketSla(ticket, now);
  const prio = ticketPriorityMeta[ticket.priority];
  const ready = !ticket.closedAt && isReady(esc);
  return (
    <Link
      href={`/tickets/${ticket.id}`}
      draggable={false}
      className={cn(
        "block rounded-lg border border-sg-line border-l-2 bg-sg-card p-3 transition-[border-color,box-shadow] hover:border-sg-line-2",
        stage ? softBorderLeft[stage.color] : "",
        sla.state === "breached" && "border-soft-red/50",
        dragging && "rotate-[1.5deg] border-sg-white/50 shadow-pop",
      )}
    >
      <div className="flex items-center gap-2 text-2xs">
        <span className="sg-num font-semibold text-sg-dim">{ticket.id.toUpperCase()}</span>
        {typeof ticket.csat === "number" && (
          <span className="flex items-center gap-0.5 text-sg-muted" title={`CSAT ${ticket.csat}/5`}>
            <Star className="size-3 text-soft-yellow" /> {ticket.csat}
          </span>
        )}
        <Chip color={prio.color} className="ml-auto">
          {prio.label}
        </Chip>
      </div>
      <div className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-sg-white">{ticket.subject}</div>
      <div className="mt-0.5 flex items-center gap-1 truncate text-2xs text-sg-dim">
        <Building2 className="size-3 shrink-0" /> {company?.name ?? "No company"}
      </div>
      <div className={cn("mt-2 flex items-center gap-1 rounded-sm px-1.5 py-1 text-2xs", slaBg[sla.state], slaText[sla.state])} title={`SLA due ${formatDate(ticket.slaDueAt, "datetime")} WIB · ${ticket.slaBasis === "business" ? "business hours" : "24/7 clock"}`}>
        {sla.state === "paused" ? <Hourglass className="size-3" /> : <Clock className="size-3" />} {sla.label}
        {!ticket.closedAt && sla.state !== "paused" && <span className="ml-auto text-sg-dim">{formatDate(ticket.slaDueAt, "short")}</span>}
      </div>
      {ready && (
        <div className="mt-1.5 flex items-center gap-1 rounded-sm bg-soft-green/10 px-1.5 py-1 text-2xs font-semibold text-soft-green" title={`${esc?.keys.join(", ")} done in Jira`}>
          <CircleCheck className="size-3" /> Jira done — ready to resolve
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 border-t border-sg-line pt-2 text-2xs text-sg-dim">
        <span>{ticket.category}</span>
        {esc && esc.open > 0 && (
          <span className="flex items-center gap-0.5 font-semibold text-soft-cyan" title={`${esc.open} open Jira ${esc.open === 1 ? "escalation" : "escalations"}: ${esc.keys.slice(0, esc.open).join(", ")}`}>
            <Kanban className="size-3" /> {esc.open}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {owner?.name.split(" ")[0]}
          <Avatar user={owner} size="xs" />
        </span>
      </div>
    </Link>
  );
}
