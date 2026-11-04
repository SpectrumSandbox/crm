"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { CalendarClock, Columns3, Download, OctagonAlert, Pencil, Plus, Rows3, Search, Users } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useCompanyMap, useStageMap, useUserMap } from "@/lib/selectors";
import type { Deal } from "@/lib/types";
import { cn, daysFromNow, formatDate, formatIDR, fromDateInput, softBorderLeft, toDateInput } from "@/lib/utils";
import { csvDate, csvFilename, downloadCsv, type CsvColumn } from "@/lib/csv";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Avatar, Chip, Dot, Kbd } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";

type View = "board" | "table";
type SortKey = "name" | "amount" | "closeDate" | "stage" | "owner";

export default function DealsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const pipelines = useCrm((s) => s.pipelines);
  const deals = useCrm((s) => s.deals);
  const crossLinks = useCrm((s) => s.crossLinks);
  const issues = useCrm((s) => s.issues);
  const users = useCrm((s) => s.users);
  const moveDeal = useCrm((s) => s.moveDeal);
  const openDialog = useUi((s) => s.openDialog);
  const notify = useUi((s) => s.notify);
  const stageMap = useStageMap();
  const userMap = useUserMap();
  const companyMap = useCompanyMap();

  const dealPipelines = pipelines.filter((p) => p.objectType === "deal");
  // filters live in the URL (?pipeline=&owner=&view=&q=) so a view can be shared or bookmarked
  const [pipelineId, setPipelineId] = useState(() => {
    const fromUrl = params.get("pipeline");
    return fromUrl && dealPipelines.some((p) => p.id === fromUrl) ? fromUrl : (dealPipelines[0]?.id ?? "");
  });
  const [ownerId, setOwnerId] = useState(() => params.get("owner") ?? "");
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [view, setView] = useState<View>(() => (params.get("view") === "table" ? "table" : "board"));
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "closeDate", dir: 1 });
  const pipeline = dealPipelines.find((p) => p.id === pipelineId) ?? dealPipelines[0];

  // keep state in step with the URL when it changes from outside (back/forward, a shared link, the sidebar)
  const URL_KEYS = ["pipeline", "owner", "view", "q"] as const;
  const urlKey = URL_KEYS.map((k) => params.get(k) ?? "").join("|");
  const lastWritten = useRef(urlKey);
  useEffect(() => {
    if (urlKey === lastWritten.current) return;
    lastWritten.current = urlKey;
    const p = params.get("pipeline");
    setPipelineId(p && dealPipelines.some((x) => x.id === p) ? p : (dealPipelines[0]?.id ?? ""));
    setOwnerId(params.get("owner") ?? "");
    setView(params.get("view") === "table" ? "table" : "board");
    setQ(params.get("q") ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);

  useEffect(() => {
    const sp = new URLSearchParams();
    if (pipeline && pipeline.id !== dealPipelines[0]?.id) sp.set("pipeline", pipeline.id);
    if (ownerId) sp.set("owner", ownerId);
    if (view !== "board") sp.set("view", view);
    if (q.trim()) sp.set("q", q.trim());
    const qs = sp.toString();
    lastWritten.current = URL_KEYS.map((k) => sp.get(k) ?? "").join("|");
    const current = typeof window !== "undefined" ? window.location.search.replace(/^\?/, "") : "";
    if (qs !== current) router.replace(qs ? `${pathname}?${qs}` : pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline?.id, ownerId, view, q]);

  /** open Jira issues that block each deal */
  const blockers = useMemo(() => {
    const m = new Map<string, string[]>();
    crossLinks.forEach((x) => {
      if (x.crmType !== "deal" || x.linkType !== "blocks") return;
      const issue = issues.find((i) => i.id === x.agileId);
      if (!issue || issue.status === "done") return;
      m.set(x.crmId, [...(m.get(x.crmId) ?? []), issue.key]);
    });
    return m;
  }, [crossLinks, issues]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return deals.filter(
      (d) =>
        d.pipelineId === pipeline?.id &&
        (!ownerId || d.ownerId === ownerId) &&
        (!needle || `${d.name} ${companyMap.get(d.companyId ?? "")?.name ?? ""} ${d.capability}`.toLowerCase().includes(needle)),
    );
  }, [deals, pipeline, ownerId, q, companyMap]);

  const stats = useMemo(() => {
    const now = Date.now();
    const open = filtered.filter((d) => !stageMap.get(d.stageId)?.closed);
    const won = filtered.filter((d) => stageMap.get(d.stageId)?.closed === "won");
    return {
      openValue: open.reduce((s, d) => s + d.amount, 0),
      weighted: open.reduce((s, d) => s + d.amount * (stageMap.get(d.stageId)?.probability ?? 0), 0),
      closing30: open.filter((d) => {
        const days = (Date.parse(d.closeDate) - now) / 86_400_000;
        return days >= 0 && days <= 30;
      }),
      overdue: open.filter((d) => Date.parse(d.closeDate) < now).length,
      wonValue: won.reduce((s, d) => s + d.amount, 0),
      blocked: open.filter((d) => blockers.has(d.id)).length,
    };
  }, [filtered, stageMap, blockers]);

  const onDragEnd = (r: DropResult) => {
    if (!r.destination || r.destination.droppableId === r.source.droppableId) return;
    const stage = stageMap.get(r.destination.droppableId);
    moveDeal(r.draggableId, r.destination.droppableId);
    if (stage?.closed === "won") notify("Closed won — logged on the deal timeline");
  };

  const sorted = useMemo(() => {
    const rows = [...filtered];
    const val = (d: Deal): string | number => {
      switch (sort.key) {
        case "amount":
          return d.amount;
        case "closeDate":
          return d.closeDate;
        case "stage":
          return pipeline?.stages.findIndex((s) => s.id === d.stageId) ?? 0;
        case "owner":
          return userMap.get(d.ownerId)?.name ?? "";
        default:
          return d.name;
      }
    };
    rows.sort((a, b) => (val(a) > val(b) ? sort.dir : val(a) < val(b) ? -sort.dir : 0));
    return rows;
  }, [filtered, sort, pipeline, userMap]);

  const csvColumns: CsvColumn<Deal>[] = [
    { header: "Deal ID", value: (d) => d.id },
    { header: "Deal", value: (d) => d.name },
    { header: "Pipeline", value: (d) => pipelines.find((p) => p.id === d.pipelineId)?.name ?? "" },
    { header: "Stage", value: (d) => stageMap.get(d.stageId)?.name ?? "" },
    { header: "Probability %", value: (d) => Math.round((stageMap.get(d.stageId)?.probability ?? 0) * 100) },
    { header: "Amount (IDR)", value: (d) => d.amount },
    { header: "Weighted (IDR)", value: (d) => Math.round(d.amount * (stageMap.get(d.stageId)?.probability ?? 0)) },
    { header: "Close date", value: (d) => csvDate(d.closeDate) },
    { header: "Owner", value: (d) => userMap.get(d.ownerId)?.name ?? "" },
    { header: "Company", value: (d) => companyMap.get(d.companyId ?? "")?.name ?? "" },
    { header: "Contacts", value: (d) => d.contactIds.length },
    { header: "Priority", value: (d) => d.priority },
    { header: "Deal type", value: (d) => d.dealType },
    { header: "Capability", value: (d) => d.capability },
    { header: "Blocked by", value: (d) => (blockers.get(d.id) ?? []).join(" ") },
    { header: "In stage since", value: (d) => csvDate(d.stageEnteredAt) },
    { header: "Created", value: (d) => csvDate(d.createdAt) },
  ];
  const exportRows = () => {
    // board view exports column order (stage, then close date); table view exports its current sort
    const rows = view === "table" ? sorted : [...filtered].sort((a, b) => (pipeline?.stages.findIndex((s) => s.id === a.stageId) ?? 0) - (pipeline?.stages.findIndex((s) => s.id === b.stageId) ?? 0) || a.closeDate.localeCompare(b.closeDate));
    downloadCsv(csvFilename(`deals-${(pipeline?.name ?? "pipeline").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`), rows, csvColumns);
  };

  if (!pipeline) return null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Deals">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sg-dim" />
          <input data-page-filter value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter deals" className="h-8 w-52 rounded border border-sg-line bg-sg-bg/60 pl-7 pr-8 text-sm text-sg-text placeholder:text-sg-dim focus:border-sg-white/60 focus:outline-none" />
          <Kbd className="absolute right-1.5 top-1/2 -translate-y-1/2">/</Kbd>
        </div>
        <Select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} wrapperClassName="w-44">
          {dealPipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} wrapperClassName="w-40">
          <option value="">All owners</option>
          {users
            .filter((u) => deals.some((d) => d.ownerId === u.id))
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
        </Select>
        <div className="flex rounded border border-sg-line p-0.5">
          {(
            [
              ["board", Columns3],
              ["table", Rows3],
            ] as const
          ).map(([v, Icon]) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-label={`${v} view`} className={cn("flex h-6 w-7 items-center justify-center rounded-sm", view === v ? "bg-sg-card-3 text-sg-white" : "text-sg-dim hover:text-sg-white")}>
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
        <Button variant="outline" size="md" onClick={exportRows} disabled={!filtered.length} title={`Export the ${filtered.length} deals in view`}>
          <Download /> Export CSV
        </Button>
        <Button variant="primary" size="md" onClick={() => openDialog({ kind: "createDeal", pipelineId: pipeline.id })}>
          <Plus /> Create deal <Kbd className="ml-1 border-sg-bg/30 bg-transparent text-sg-bg/70">C</Kbd>
        </Button>
      </PageHeader>

      {/* forecast strip */}
      <div className="grid shrink-0 grid-cols-2 border-b border-sg-line sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Open pipeline" value={formatIDR(stats.openValue)} />
        <Stat label="Weighted forecast" value={formatIDR(stats.weighted)} hint="Σ amount × stage probability" />
        <Stat label="Closing in 30 days" value={formatIDR(stats.closing30.reduce((s, d) => s + d.amount, 0))} hint={`${stats.closing30.length} deals`} />
        <Stat label="Closed won" value={formatIDR(stats.wonValue)} tone="green" />
        <Stat label="Past close date" value={String(stats.overdue)} tone={stats.overdue ? "orange" : undefined} hint="open deals" />
        <Stat label="Blocked by engineering" value={String(stats.blocked)} tone={stats.blocked ? "red" : undefined} hint="open Jira blockers" />
      </div>

      {view === "board" ? (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
            {pipeline.stages.map((stage) => {
              const col = filtered.filter((d) => d.stageId === stage.id).sort((a, b) => a.closeDate.localeCompare(b.closeDate));
              const total = col.reduce((s, d) => s + d.amount, 0);
              return (
                <div key={stage.id} className="flex w-[272px] shrink-0 flex-col rounded-xl border border-sg-line bg-sg-card/60">
                  <div className="border-b border-sg-line px-3 pb-2 pt-3">
                    <div className="flex items-center gap-2">
                      <Dot color={stage.color} />
                      <span className="truncate text-xs font-bold uppercase tracking-[0.08em] text-sg-white">{stage.name}</span>
                      <span className="ml-auto rounded-sm bg-sg-card-3 px-1.5 text-2xs font-semibold text-sg-muted">{col.length}</span>
                    </div>
                    <div className="mt-1.5 flex items-baseline justify-between text-2xs text-sg-dim">
                      <span className="sg-num font-semibold text-sg-muted">{formatIDR(total)}</span>
                      <span>{Math.round(stage.probability * 100)}% · {formatIDR(total * stage.probability)} wtd</span>
                    </div>
                  </div>
                  <Droppable droppableId={stage.id}>
                    {(provided, snapshot) => (
                      <div ref={provided.innerRef} {...provided.droppableProps} className={cn("flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors", snapshot.isDraggingOver && "bg-sg-card-2/60")}>
                        {col.map((deal, index) => (
                          <Draggable key={deal.id} draggableId={deal.id} index={index}>
                            {(p, s) => (
                              <div ref={p.innerRef} {...p.draggableProps} {...p.dragHandleProps} style={p.draggableProps.style}>
                                <DealCard deal={deal} dragging={s.isDragging} blockedBy={blockers.get(deal.id)} />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {!col.length && !snapshot.isDraggingOver && <p className="py-6 text-center text-2xs text-sg-dim">Drop deals here</p>}
                      </div>
                    )}
                  </Droppable>
                  {!stage.closed && (
                    <button type="button" onClick={() => openDialog({ kind: "createDeal", pipelineId: pipeline.id, stageId: stage.id })} className="flex h-8 items-center gap-1.5 border-t border-sg-line px-3 text-xs text-sg-dim hover:text-sg-white">
                      <Plus className="size-3.5" /> Add deal
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </DragDropContext>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="sticky top-0 z-10 bg-sg-bg">
              <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-[0.1em] text-sg-dim">
                {(
                  [
                    ["name", "Deal"],
                    ["stage", "Stage"],
                    ["amount", "Amount"],
                    ["closeDate", "Close date"],
                    ["owner", "Owner"],
                  ] as [SortKey, string][]
                ).map(([key, label]) => (
                  <th key={key} className={cn("px-4 py-2 font-semibold", key === "amount" && "text-right")}>
                    <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))} className="hover:text-sg-white">
                      {label} {sort.key === key ? (sort.dir === 1 ? "↑" : "↓") : ""}
                    </button>
                  </th>
                ))}
                <th className="px-4 py-2 font-semibold">Company</th>
                <th className="px-4 py-2 font-semibold">Engineering</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => {
                const stage = stageMap.get(d.stageId);
                const days = daysFromNow(d.closeDate);
                return (
                  <tr key={d.id} className="border-b border-sg-line hover:bg-sg-card/70">
                    <td className="px-4 py-2">
                      <Link href={`/deals/${d.id}`} className="font-semibold text-sg-white hover:underline">
                        {d.name}
                      </Link>
                      <div className="text-2xs text-sg-dim">{d.capability}</div>
                    </td>
                    <td className="px-4 py-2">{stage ? <Chip color={stage.color} dot>{stage.name}</Chip> : null}</td>
                    <td className="sg-num px-4 py-2 text-right font-semibold text-sg-white">{formatIDR(d.amount)}</td>
                    <td className={cn("px-4 py-2", !stage?.closed && days < 0 ? "text-soft-orange" : "text-sg-muted")}>{formatDate(d.closeDate)}</td>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2 text-sg-muted">
                        <Avatar user={userMap.get(d.ownerId)} size="xs" /> {userMap.get(d.ownerId)?.name}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-sg-muted">{companyMap.get(d.companyId ?? "")?.name ?? "—"}</td>
                    <td className="px-4 py-2">{blockers.get(d.id) ? <Chip color="red">Blocked · {blockers.get(d.id)!.join(", ")}</Chip> : <span className="text-sg-dim">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "green" | "orange" | "red" }) {
  return (
    <div className="border-r border-sg-line px-5 py-3 last:border-r-0">
      <div className="sg-eyebrow">{label}</div>
      <div className={cn("sg-num mt-1 font-display text-xl font-extrabold", tone === "green" ? "text-soft-green" : tone === "orange" ? "text-soft-orange" : tone === "red" ? "text-soft-red" : "text-sg-white")}>{value}</div>
      {hint ? <div className="text-2xs text-sg-dim">{hint}</div> : null}
    </div>
  );
}

function DealCard({ deal, dragging, blockedBy }: { deal: Deal; dragging: boolean; blockedBy?: string[] }) {
  const userMap = useUserMap();
  const companyMap = useCompanyMap();
  const stageMap = useStageMap();
  const stage = stageMap.get(deal.stageId);
  const days = daysFromNow(deal.closeDate);
  const overdue = !stage?.closed && days < 0;
  const company = companyMap.get(deal.companyId ?? "");
  const daysInStage = Math.max(0, -daysFromNow(deal.stageEnteredAt));
  return (
    <div className="group relative">
    <Link
      href={`/deals/${deal.id}`}
      draggable={false}
      className={cn(
        "block rounded-lg border border-sg-line border-l-2 bg-sg-card p-3 transition-[border-color,box-shadow] hover:border-sg-line-2",
        stage ? softBorderLeft[stage.color] : "",
        dragging && "rotate-[1.5deg] border-sg-white/50 shadow-pop",
      )}
    >
      <div className="line-clamp-2 pr-6 text-sm font-semibold leading-snug text-sg-white">{deal.name.split(" — ")[1] ?? deal.name}</div>
      <div className="mt-0.5 truncate text-2xs text-sg-dim">{company?.name ?? "No company"}</div>
      <div className="mt-2 flex items-center justify-between">
        <span className="sg-num font-display text-base font-extrabold text-sg-white">{formatIDR(deal.amount)}</span>
        {deal.priority === "high" && <Chip color="orange">High</Chip>}
      </div>
      {blockedBy && (
        <div className="mt-2 flex items-center gap-1 rounded-sm bg-soft-red/10 px-1.5 py-1 text-2xs font-semibold text-soft-red">
          <OctagonAlert className="size-3" /> Blocked by {blockedBy.join(", ")}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 border-t border-sg-line pt-2 text-2xs text-sg-dim">
        <span className={cn("flex items-center gap-1", overdue && "font-semibold text-soft-orange")}>
          <CalendarClock className="size-3" />
          {formatDate(deal.closeDate, "short")}
          {!stage?.closed && <span>({overdue ? `${-days}d late` : `${days}d`})</span>}
        </span>
        <span className="flex items-center gap-0.5" title={`${deal.contactIds.length} contacts`}>
          <Users className="size-3" /> {deal.contactIds.length}
        </span>
        <span className="ml-auto flex items-center gap-1.5" title={`${daysInStage} days in stage`}>
          {daysInStage}d
          <Avatar user={userMap.get(deal.ownerId)} size="xs" />
        </span>
      </div>
    </Link>
    <QuickEdit deal={deal} />
    </div>
  );
}

/** pencil on each card: edit amount + close date in place (no navigation) */
function QuickEdit({ deal }: { deal: Deal }) {
  const updateDeal = useCrm((s) => s.updateDeal);
  const notify = useUi((s) => s.notify);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [closeDate, setCloseDate] = useState("");
  const parsed = Number(amount.replace(/[^\d]/g, ""));
  const valid = amount.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(closeDate);
  const changed = valid && (parsed !== deal.amount || closeDate !== toDateInput(deal.closeDate));

  const save = () => {
    if (!valid) return;
    if (changed) {
      const prev = { amount: deal.amount, closeDate: deal.closeDate };
      updateDeal(deal.id, { amount: parsed, closeDate: closeDate === toDateInput(deal.closeDate) ? deal.closeDate : fromDateInput(closeDate) });
      notify(`${deal.name.split(" — ")[1] ?? deal.name} updated`, { label: "Undo", run: () => updateDeal(deal.id, prev) });
    }
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setAmount(String(deal.amount));
          setCloseDate(toDateInput(deal.closeDate));
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Quick edit ${deal.name}`}
          title="Edit amount and close date"
          className={cn("absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded text-sg-dim hover:bg-sg-card-3 hover:text-sg-white focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-sg-white", open ? "bg-sg-card-3 text-sg-white opacity-100" : "opacity-0 group-hover:opacity-100")}
        >
          <Pencil className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          className="space-y-2.5"
        >
          <div className="sg-eyebrow truncate">{deal.name.split(" — ")[1] ?? deal.name}</div>
          <label className="block">
            <span className="mb-1 block text-2xs font-semibold uppercase tracking-[0.12em] text-sg-dim">Amount (IDR)</span>
            <Input autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span className="mt-1 block text-2xs text-sg-dim">{valid ? formatIDR(parsed, "full") : "Enter a whole number"}</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-2xs font-semibold uppercase tracking-[0.12em] text-sg-dim">Close date</span>
            <Input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
          </label>
          <div className="flex justify-end gap-1.5 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={!valid}>
              Save
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
