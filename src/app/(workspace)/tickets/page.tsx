"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { Building2, Clock, Columns3, Download, Kanban, Plus, Rows3, Search, Ticket as TicketIcon } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { ticketSla, useCompanyMap, useStageMap, useTicketEscalations, useUserMap, type SlaState } from "@/lib/selectors";
import { ticketPriorityMeta } from "@/lib/meta";
import type { Ticket, TicketPriority } from "@/lib/types";
import { cn, formatDate, softBorderLeft } from "@/lib/utils";
import { csvDateTime, csvFilename, downloadCsv, type CsvColumn } from "@/lib/csv";
import { PageHeader } from "@/components/shell/page-header";
import { NewTicketDialog } from "@/components/shell/dialogs";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Avatar, Chip, Dot, EmptyState, Kbd } from "@/components/ui/misc";

type View = "board" | "table";
type SortKey = "id" | "subject" | "stage" | "priority" | "sla" | "company" | "owner" | "escalations" | "created";

const PRIORITY_RANK: Record<TicketPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const slaText: Record<SlaState, string> = { met: "text-soft-green", breached: "font-semibold text-soft-red", due_soon: "font-semibold text-soft-orange", on_track: "text-sg-muted" };

export default function TicketsPage() {
  const pipelines = useCrm((s) => s.pipelines);
  const tickets = useCrm((s) => s.tickets);
  const users = useCrm((s) => s.users);
  const contacts = useCrm((s) => s.contacts);
  const moveTicket = useCrm((s) => s.moveTicket);
  const notify = useUi((s) => s.notify);
  const stageMap = useStageMap();
  const userMap = useUserMap();
  const companyMap = useCompanyMap();
  const escalations = useTicketEscalations();

  const pipeline = useMemo(() => pipelines.find((p) => p.objectType === "ticket" && p.name === "Field Support") ?? pipelines.find((p) => p.objectType === "ticket"), [pipelines]);
  const [view, setView] = useState<View>("board");
  const [q, setQ] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [priority, setPriority] = useState<"" | TicketPriority>("");
  const [hideClosed, setHideClosed] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "sla", dir: 1 });
  const [creating, setCreating] = useState<{ stageId?: string } | null>(null);

  /* live SLA countdown */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tickets.filter((t) => {
      if (pipeline && t.pipelineId !== pipeline.id) return false;
      if (ownerId && t.ownerId !== ownerId) return false;
      if (priority && t.priority !== priority) return false;
      if (hideClosed && (t.closedAt || stageMap.get(t.stageId)?.closed)) return false;
      if (!needle) return true;
      return `${t.id} ${t.subject} ${t.category} ${companyMap.get(t.companyId ?? "")?.name ?? ""} ${contactName.get(t.contactId ?? "") ?? ""}`.toLowerCase().includes(needle);
    });
  }, [tickets, pipeline, ownerId, priority, hideClosed, q, companyMap, contactName, stageMap]);

  const stats = useMemo(() => {
    const open = filtered.filter((t) => !t.closedAt && !stageMap.get(t.stageId)?.closed);
    const states = open.map((t) => ticketSla(t, now).state);
    return {
      open: open.length,
      breached: states.filter((s) => s === "breached").length,
      dueSoon: states.filter((s) => s === "due_soon").length,
      urgent: open.filter((t) => t.priority === "urgent" || t.priority === "high").length,
      escalated: open.filter((t) => (escalations.get(t.id) ?? 0) > 0).length,
    };
  }, [filtered, stageMap, now, escalations]);

  const sorted = useMemo(() => {
    const stageIdx = (t: Ticket) => pipeline?.stages.findIndex((s) => s.id === t.stageId) ?? 0;
    const val = (t: Ticket): string | number => {
      switch (sort.key) {
        case "id":
          return Number(t.id.split("-")[1]) || 0;
        case "subject":
          return t.subject.toLowerCase();
        case "stage":
          return stageIdx(t);
        case "priority":
          return PRIORITY_RANK[t.priority];
        case "company":
          return (companyMap.get(t.companyId ?? "")?.name ?? "~").toLowerCase();
        case "owner":
          return userMap.get(t.ownerId)?.name ?? "";
        case "escalations":
          return escalations.get(t.id) ?? 0;
        case "created":
          return t.createdAt;
        default:
          // closed tickets sink below open ones when sorting by SLA
          return `${t.closedAt ? 1 : 0}${t.slaDueAt}`;
      }
    };
    return [...filtered].sort((a, b) => (val(a) > val(b) ? sort.dir : val(a) < val(b) ? -sort.dir : 0));
  }, [filtered, sort, pipeline, companyMap, userMap, escalations]);

  const onDragEnd = (r: DropResult) => {
    if (!r.destination || r.destination.droppableId === r.source.droppableId) return;
    const t = tickets.find((x) => x.id === r.draggableId);
    if (!t) return;
    const from = t.stageId;
    const to = stageMap.get(r.destination.droppableId);
    moveTicket(t.id, r.destination.droppableId);
    notify(to?.closed ? `${t.id.toUpperCase()} resolved` : `${t.id.toUpperCase()} → ${to?.name ?? "stage"}`, { label: "Undo", run: () => moveTicket(t.id, from) });
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
    { header: "SLA status", value: (t) => ticketSla(t, now).label },
    { header: "Jira escalations", value: (t) => escalations.get(t.id) ?? 0 },
    { header: "Created (WIB)", value: (t) => csvDateTime(t.createdAt) },
    { header: "Closed (WIB)", value: (t) => csvDateTime(t.closedAt) },
    { header: "Description", value: (t) => t.description },
  ];

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

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Tickets" meta={<span className="text-sm text-sg-dim">· {pipeline.name}</span>}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sg-dim" />
          <input data-page-filter value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter tickets" className="h-8 w-52 rounded border border-sg-line bg-sg-bg/60 pl-7 pr-8 text-sm text-sg-text placeholder:text-sg-dim focus:border-sg-white/60 focus:outline-none" />
          <Kbd className="absolute right-1.5 top-1/2 -translate-y-1/2">/</Kbd>
        </div>
        <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} wrapperClassName="w-40" aria-label="Owner">
          <option value="">All owners</option>
          {users
            .filter((u) => tickets.some((t) => t.ownerId === u.id))
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
        </Select>
        <Select value={priority} onChange={(e) => setPriority(e.target.value as "" | TicketPriority)} wrapperClassName="w-36" aria-label="Priority">
          <option value="">All priorities</option>
          {(Object.keys(ticketPriorityMeta) as TicketPriority[]).map((p) => (
            <option key={p} value={p}>
              {ticketPriorityMeta[p].label}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-sg-muted">
          <input type="checkbox" checked={hideClosed} onChange={(e) => setHideClosed(e.target.checked)} className="size-3.5 accent-white" /> Hide resolved
        </label>
        <div className="flex rounded border border-sg-line p-0.5">
          {(
            [
              ["board", Columns3],
              ["table", Rows3],
            ] as const
          ).map(([v, Icon]) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-label={`${v} view`} aria-pressed={view === v} className={cn("flex h-6 w-7 items-center justify-center rounded-sm", view === v ? "bg-sg-card-3 text-sg-white" : "text-sg-dim hover:text-sg-white")}>
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
        <Button variant="outline" size="md" disabled={!sorted.length} onClick={() => downloadCsv(csvFilename("tickets"), sorted, csvColumns)} title={`Export the ${sorted.length} tickets in view`}>
          <Download /> Export CSV
        </Button>
        <Button variant="primary" size="md" onClick={() => setCreating({})}>
          <Plus /> New ticket <Kbd className="ml-1 border-sg-bg/30 bg-transparent text-sg-bg/70">C</Kbd>
        </Button>
      </PageHeader>

      <div className="grid shrink-0 grid-cols-2 border-b border-sg-line sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Open tickets" value={stats.open} />
        <Stat label="SLA breached" value={stats.breached} tone={stats.breached ? "red" : undefined} hint="past due, still open" />
        <Stat label="Due in < 12h" value={stats.dueSoon} tone={stats.dueSoon ? "orange" : undefined} hint="at risk" />
        <Stat label="Urgent + high" value={stats.urgent} hint="open" />
        <Stat label="Escalated to Jira" value={stats.escalated} hint="open with linked issues" />
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
                    <div className="mt-1.5 text-2xs text-sg-dim">{stage.closed ? "Closed — SLA clock stopped" : breached ? <span className="font-semibold text-soft-red">{breached} breached</span> : "All within SLA"}</div>
                  </div>
                  <Droppable droppableId={stage.id}>
                    {(provided, snapshot) => (
                      <div ref={provided.innerRef} {...provided.droppableProps} className={cn("flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors", snapshot.isDraggingOver && "bg-sg-card-2/60")}>
                        {col.map((t, index) => (
                          <Draggable key={t.id} draggableId={t.id} index={index}>
                            {(p, s) => (
                              <div ref={p.innerRef} {...p.draggableProps} {...p.dragHandleProps} style={p.draggableProps.style}>
                                <TicketCard ticket={t} now={now} dragging={s.isDragging} escalations={escalations.get(t.id) ?? 0} />
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
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="sticky top-0 z-10 bg-sg-bg">
              <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-[0.1em] text-sg-dim">
                {(
                  [
                    ["id", "Ticket"],
                    ["subject", "Subject"],
                    ["stage", "Status"],
                    ["priority", "Priority"],
                    ["sla", "SLA"],
                    ["company", "Company"],
                    ["owner", "Owner"],
                    ["escalations", "Jira"],
                    ["created", "Created"],
                  ] as [SortKey, string][]
                ).map(([key, label]) => (
                  <th key={key} className={cn("whitespace-nowrap px-4 py-2 font-semibold", key === "escalations" && "text-right")}>
                    <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))} className={cn("hover:text-sg-white", sort.key === key && "text-sg-white")}>
                      {label} {sort.key === key ? (sort.dir === 1 ? "↑" : "↓") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => {
                const stage = stageMap.get(t.stageId);
                const sla = ticketSla(t, now);
                const esc = escalations.get(t.id) ?? 0;
                return (
                  <tr key={t.id} className="border-b border-sg-line hover:bg-sg-card/70">
                    <td className="sg-num whitespace-nowrap px-4 py-2 text-2xs font-semibold text-sg-dim">{t.id.toUpperCase()}</td>
                    <td className="px-4 py-2">
                      <Link href={`/tickets/${t.id}`} className="font-semibold text-sg-white hover:underline">
                        {t.subject}
                      </Link>
                      <div className="text-2xs text-sg-dim">{t.category}</div>
                    </td>
                    <td className="px-4 py-2">{stage ? <Chip color={stage.color} dot>{stage.name}</Chip> : null}</td>
                    <td className="px-4 py-2">
                      <Chip color={ticketPriorityMeta[t.priority].color}>{ticketPriorityMeta[t.priority].label}</Chip>
                    </td>
                    <td className={cn("whitespace-nowrap px-4 py-2", slaText[sla.state])} title={`Due ${formatDate(t.slaDueAt, "datetime")} WIB`}>
                      {sla.label}
                    </td>
                    <td className="px-4 py-2 text-sg-muted">
                      {t.companyId && companyMap.get(t.companyId) ? (
                        <Link href={`/companies/${t.companyId}`} className="hover:text-sg-white hover:underline">
                          {companyMap.get(t.companyId)!.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2 whitespace-nowrap text-sg-muted">
                        <Avatar user={userMap.get(t.ownerId)} size="xs" /> {userMap.get(t.ownerId)?.name}
                      </span>
                    </td>
                    <td className="sg-num px-4 py-2 text-right">{esc ? <Chip color="cyan">{esc}</Chip> : <span className="text-sg-dim">—</span>}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-sg-muted">{formatDate(t.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!sorted.length && (
            <EmptyState icon={TicketIcon} title="No tickets match these filters" action={<Button size="sm" variant="outline" onClick={() => setCreating({})}><Plus /> New ticket</Button>}>
              Clear the search or filters, or open a new ticket.
            </EmptyState>
          )}
        </div>
      )}

      {creating && <NewTicketDialog stageId={creating.stageId} onClose={() => setCreating(null)} />}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "orange" | "red" }) {
  return (
    <div className="border-r border-sg-line px-5 py-3 last:border-r-0">
      <div className="sg-eyebrow">{label}</div>
      <div className={cn("sg-num mt-1 font-display text-xl font-extrabold", tone === "orange" ? "text-soft-orange" : tone === "red" ? "text-soft-red" : "text-sg-white")}>{value}</div>
      {hint ? <div className="text-2xs text-sg-dim">{hint}</div> : null}
    </div>
  );
}

function TicketCard({ ticket, now, dragging, escalations }: { ticket: Ticket; now: number; dragging: boolean; escalations: number }) {
  const userMap = useUserMap();
  const companyMap = useCompanyMap();
  const stageMap = useStageMap();
  const stage = stageMap.get(ticket.stageId);
  const sla = ticketSla(ticket, now);
  const company = companyMap.get(ticket.companyId ?? "");
  const owner = userMap.get(ticket.ownerId);
  const prio = ticketPriorityMeta[ticket.priority];
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
        <Chip color={prio.color} className="ml-auto">
          {prio.label}
        </Chip>
      </div>
      <div className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-sg-white">{ticket.subject}</div>
      <div className="mt-0.5 flex items-center gap-1 truncate text-2xs text-sg-dim">
        <Building2 className="size-3 shrink-0" /> {company?.name ?? "No company"}
      </div>
      <div className={cn("mt-2 flex items-center gap-1 rounded-sm px-1.5 py-1 text-2xs", sla.state === "breached" ? "bg-soft-red/10" : sla.state === "due_soon" ? "bg-soft-orange/10" : "bg-sg-card-2", slaText[sla.state])} title={`SLA due ${formatDate(ticket.slaDueAt, "datetime")} WIB`}>
        <Clock className="size-3" /> {sla.label}
        {!ticket.closedAt && <span className="ml-auto text-sg-dim">{formatDate(ticket.slaDueAt, "short")}</span>}
      </div>
      <div className="mt-2 flex items-center gap-2 border-t border-sg-line pt-2 text-2xs text-sg-dim">
        <span>{ticket.category}</span>
        {escalations > 0 && (
          <span className="flex items-center gap-0.5 font-semibold text-soft-cyan" title={`${escalations} linked Jira ${escalations === 1 ? "issue" : "issues"}`}>
            <Kanban className="size-3" /> {escalations}
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
