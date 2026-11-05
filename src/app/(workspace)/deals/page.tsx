"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { ArrowDown, ArrowUp, CalendarClock, Columns3, Download, Flame, ListTodo, OctagonAlert, Pencil, Plus, Rows3, Search, Users, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useCompanyMap, useStageMap, useUserMap } from "@/lib/selectors";
import type { Company, Deal, DealChange, ForecastCategory, PipelineStage, User } from "@/lib/types";
import { cn, daysFromNow, formatDate, formatIDR, fromDateInput, isDateInput, parseIDR, softBorderLeft, toDateInput } from "@/lib/utils";
import { csvDate, csvFilename, downloadCsv, type CsvColumn } from "@/lib/csv";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Avatar, Chip, Dot, Kbd } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { applyDealChange, requestDealStage } from "@/components/crm/deal-close";
import { dealActivityIndex, FORECAST_META, FORECAST_ORDER, forecastOf, idleDays, isRotting, nextStepOf, originationOf, ORIGINATION_LABEL, rottingThreshold, wibMonthKey, type DealActivitySignals } from "@/components/crm/deal-signals";

type View = "board" | "table";
type SortKey = "name" | "amount" | "closeDate" | "stage" | "owner";
type StripMode = "summary" | "forecast" | "changes";
type StageInfo = PipelineStage & { pipelineId: string };

const EMPTY_HISTORY: DealChange[] = [];
const DAY = 86_400_000;

/** per-deal derived signals the cards and table share (built once per render of the page) */
interface DealCtx {
  userMap: Map<string, User>;
  companyMap: Map<string, Company>;
  stageMap: Map<string, StageInfo>;
  signals: Map<string, DealActivitySignals>;
  lineTotals: Map<string, number>;
  history7: Map<string, { amountDelta: number; pushes: number }>;
  now: number;
}

export default function DealsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const pipelines = useCrm((s) => s.pipelines);
  const deals = useCrm((s) => s.deals);
  const crossLinks = useCrm((s) => s.crossLinks);
  const issues = useCrm((s) => s.issues);
  const users = useCrm((s) => s.users);
  const activities = useCrm((s) => s.activities);
  const lineItems = useCrm((s) => s.lineItems);
  const historyRaw = useCrm((s) => s.dealHistory);
  const history = historyRaw ?? EMPTY_HISTORY;
  const openDialog = useUi((s) => s.openDialog);
  const stageMap = useStageMap();
  const userMap = useUserMap();
  const companyMap = useCompanyMap();
  const [now] = useState(() => Date.now());

  const dealPipelines = useMemo(() => pipelines.filter((p) => p.objectType === "deal"), [pipelines]);
  // filters live in the URL (?pipeline=&owner=&view=&q=&stage=) so a view can be shared or bookmarked
  const [pipelineId, setPipelineId] = useState(() => {
    const fromUrl = params.get("pipeline");
    return fromUrl && dealPipelines.some((p) => p.id === fromUrl) ? fromUrl : (dealPipelines[0]?.id ?? "");
  });
  const [ownerId, setOwnerId] = useState(() => params.get("owner") ?? "");
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [view, setView] = useState<View>(() => (params.get("view") === "table" ? "table" : "board"));
  const [stageFilter, setStageFilter] = useState(() => params.get("stage") ?? "");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "closeDate", dir: 1 });
  const [strip, setStrip] = useState<StripMode>("summary");
  const [windowDays, setWindowDays] = useState<7 | 30>(7);
  const [focus, setFocus] = useState<{ label: string; ids: Set<string> } | null>(null);
  const pipeline = dealPipelines.find((p) => p.id === pipelineId) ?? dealPipelines[0];

  // keep state in step with the URL when it changes from outside (back/forward, a shared link, the sidebar)
  const URL_KEYS = ["pipeline", "owner", "view", "q", "stage"] as const;
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
    setStageFilter(params.get("stage") ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);

  useEffect(() => {
    const sp = new URLSearchParams();
    if (pipeline && pipeline.id !== dealPipelines[0]?.id) sp.set("pipeline", pipeline.id);
    if (ownerId) sp.set("owner", ownerId);
    if (view !== "board") sp.set("view", view);
    if (q.trim()) sp.set("q", q.trim());
    if (stageFilter) sp.set("stage", stageFilter);
    const qs = sp.toString();
    lastWritten.current = URL_KEYS.map((k) => sp.get(k) ?? "").join("|");
    const current = typeof window !== "undefined" ? window.location.search.replace(/^\?/, "") : "";
    if (qs !== current) router.replace(qs ? `${pathname}?${qs}` : pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline?.id, ownerId, view, q, stageFilter]);

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

  const signals = useMemo(() => dealActivityIndex(activities), [activities]);
  const lineTotals = useMemo(() => {
    const m = new Map<string, number>();
    lineItems.forEach((l) => m.set(l.dealId, (m.get(l.dealId) ?? 0) + l.quantity * l.unitPrice * (1 - l.discountPct / 100)));
    return m;
  }, [lineItems]);
  const history7 = useMemo(() => {
    const since = now - 7 * DAY;
    const m = new Map<string, { amountDelta: number; pushes: number }>();
    history.forEach((h) => {
      const cur = m.get(h.dealId) ?? { amountDelta: 0, pushes: 0 };
      if (h.field === "amount" && Date.parse(h.at) >= since) cur.amountDelta += Number(h.to ?? 0) - Number(h.from ?? 0);
      // a push = the expected close moved to a later WIB month (counted over the deal's whole life)
      if (h.field === "closeDate" && h.from && h.to && wibMonthKey(String(h.to)) > wibMonthKey(String(h.from))) cur.pushes += 1;
      m.set(h.dealId, cur);
    });
    return m;
  }, [history, now]);

  const ctx: DealCtx = { userMap, companyMap, stageMap, signals, lineTotals, history7, now };

  const inPipeline = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return deals.filter(
      (d) =>
        d.pipelineId === pipeline?.id &&
        (!ownerId || d.ownerId === ownerId) &&
        (!needle || `${d.name} ${companyMap.get(d.companyId ?? "")?.name ?? ""} ${d.capability} ${d.lostReason ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [deals, pipeline, ownerId, q, companyMap]);

  const filtered = useMemo(() => {
    return inPipeline.filter((d) => {
      if (focus && !focus.ids.has(d.id)) return false;
      const st = stageMap.get(d.stageId);
      if (stageFilter === "won") return st?.closed === "won";
      if (stageFilter === "lost") return st?.closed === "lost";
      if (stageFilter === "open") return !st?.closed;
      if (stageFilter === "rotting") return isRotting(d, st, signals.get(d.id), now);
      if (stageFilter === "no_next") return !st?.closed && !signals.get(d.id)?.nextTask;
      if (stageFilter) return d.stageId === stageFilter;
      return true;
    });
  }, [inPipeline, focus, stageFilter, stageMap, signals, now]);

  const stats = useMemo(() => {
    const open = filtered.filter((d) => !stageMap.get(d.stageId)?.closed);
    const quarterStart = (() => {
      const wib = new Date(now + 7 * 3_600_000);
      const m = Math.floor(wib.getUTCMonth() / 3) * 3;
      return Date.UTC(wib.getUTCFullYear(), m, 1) - 7 * 3_600_000;
    })();
    const wonQ = filtered.filter((d) => stageMap.get(d.stageId)?.closed === "won" && Date.parse(d.closeDate) >= quarterStart);
    return {
      openValue: open.reduce((s, d) => s + d.amount, 0),
      openCount: open.length,
      weighted: open.reduce((s, d) => s + d.amount * (stageMap.get(d.stageId)?.probability ?? 0), 0),
      closing30: open.filter((d) => {
        const days = daysFromNow(d.closeDate, now);
        return days >= 0 && days <= 30;
      }),
      overdue: open.filter((d) => daysFromNow(d.closeDate, now) < 0).length,
      wonValue: wonQ.reduce((s, d) => s + d.amount, 0),
      wonCount: wonQ.length,
      blocked: open.filter((d) => blockers.has(d.id)).length,
      rotting: open.filter((d) => isRotting(d, stageMap.get(d.stageId), signals.get(d.id), now)).length,
      noNext: open.filter((d) => !signals.get(d.id)?.nextTask).length,
    };
  }, [filtered, stageMap, blockers, signals, now]);

  const onDragEnd = (r: DropResult) => {
    if (!r.destination || r.destination.droppableId === r.source.droppableId) return;
    requestDealStage(r.draggableId, r.destination.droppableId);
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
    { header: "Forecast category", value: (d) => FORECAST_META[forecastOf(d, stageMap.get(d.stageId))].label },
    { header: "Amount (IDR)", value: (d) => d.amount },
    { header: "Weighted (IDR)", value: (d) => Math.round(d.amount * (stageMap.get(d.stageId)?.probability ?? 0)) },
    { header: "Close date", value: (d) => csvDate(d.closeDate) },
    { header: "Owner", value: (d) => userMap.get(d.ownerId)?.name ?? "" },
    { header: "Company", value: (d) => companyMap.get(d.companyId ?? "")?.name ?? "" },
    { header: "Contacts", value: (d) => d.contactIds.length },
    { header: "Priority", value: (d) => d.priority },
    { header: "Deal type", value: (d) => d.dealType },
    { header: "Capability", value: (d) => d.capability },
    { header: "Origination (§4.1)", value: (d) => ORIGINATION_LABEL[originationOf(d, activities).channel] + (d.origination ? "" : " (derived)") },
    { header: "Next step", value: (d) => signals.get(d.id)?.nextTask?.subject ?? "" },
    { header: "Next step due", value: (d) => csvDate(signals.get(d.id)?.nextTask?.dueAt ?? null) },
    { header: "Idle days", value: (d) => idleDays(d, signals.get(d.id), now) },
    { header: "Lost reason", value: (d) => d.lostReason ?? "" },
    { header: "Lost to", value: (d) => d.lostToCompetitor ?? "" },
    { header: "Win reason", value: (d) => d.winReason ?? "" },
    { header: "PO / contract", value: (d) => d.poNumber ?? "" },
    { header: "Close note", value: (d) => d.closeNote ?? "" },
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
          <input data-page-filter value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter deals" aria-label="Filter deals" className="h-8 w-52 rounded border border-sg-line bg-sg-bg/60 pl-7 pr-8 text-sm text-sg-text placeholder:text-sg-dim focus:border-sg-white/60 focus:outline-none" />
          <Kbd className="absolute right-1.5 top-1/2 -translate-y-1/2 [@media(hover:none)]:hidden">/</Kbd>
        </div>
        <Select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} wrapperClassName="w-44" aria-label="Pipeline">
          {dealPipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} wrapperClassName="w-40" aria-label="Owner">
          <option value="">All owners</option>
          {users
            .filter((u) => deals.some((d) => d.ownerId === u.id))
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
        </Select>
        <Select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} wrapperClassName="w-40" aria-label="Show deals">
          <option value="">All deals</option>
          <option value="open">Open</option>
          <option value="rotting">Rotting (idle)</option>
          <option value="no_next">No next step</option>
          <option value="won">Closed won</option>
          <option value="lost">Closed lost</option>
          {pipeline.stages
            .filter((s) => !s.closed)
            .map((s) => (
              <option key={s.id} value={s.id}>
                Stage: {s.name}
              </option>
            ))}
        </Select>
        <div className="flex rounded border border-sg-line p-0.5" role="group" aria-label="View">
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
        <Button variant="outline" size="md" onClick={exportRows} disabled={!filtered.length} title={`Export the ${filtered.length} deals in view`}>
          <Download /> Export CSV
        </Button>
        <Button variant="primary" size="md" onClick={() => openDialog({ kind: "createDeal", pipelineId: pipeline.id })}>
          <Plus /> Create deal <Kbd className="ml-1 border-sg-bg/30 bg-transparent text-sg-bg/70 [@media(hover:none)]:hidden">C</Kbd>
        </Button>
      </PageHeader>

      {/* strip: summary · forecast categories · what changed */}
      <div className="flex shrink-0 items-center gap-2 border-b border-sg-line px-4 py-1.5 text-2xs">
        <div className="flex rounded border border-sg-line p-0.5" role="group" aria-label="Summary strip">
          {(
            [
              ["summary", "Summary"],
              ["forecast", "Forecast"],
              ["changes", "What changed"],
            ] as const
          ).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={strip === v} onClick={() => setStrip(v)} className={cn("h-6 rounded-sm px-2 font-semibold", strip === v ? "bg-sg-card-3 text-sg-white" : "text-sg-dim hover:text-sg-white")}>
              {label}
            </button>
          ))}
        </div>
        <span className="text-sg-dim">
          Scope: <span className="font-semibold text-sg-muted">{pipeline.name}</span> pipeline{ownerId ? ` · ${userMap.get(ownerId)?.name}` : " · all owners"}
        </span>
        {strip === "changes" && (
          <div className="ml-auto flex rounded border border-sg-line p-0.5" role="group" aria-label="Window">
            {([7, 30] as const).map((w) => (
              <button key={w} type="button" aria-pressed={windowDays === w} onClick={() => setWindowDays(w)} className={cn("h-6 rounded-sm px-2 font-semibold", windowDays === w ? "bg-sg-card-3 text-sg-white" : "text-sg-dim hover:text-sg-white")}>
                {w}d
              </button>
            ))}
          </div>
        )}
        {focus && (
          <button type="button" onClick={() => setFocus(null)} className={cn("flex items-center gap-1 rounded-full bg-sg-card-3 px-2 py-0.5 font-semibold text-sg-white hover:bg-sg-card-2", strip !== "changes" && "ml-auto")}>
            Showing: {focus.label} ({focus.ids.size}) <X className="size-3" />
          </button>
        )}
      </div>
      {strip === "summary" && (
        <div className="grid shrink-0 grid-cols-2 border-b border-sg-line sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Open pipeline" value={formatIDR(stats.openValue)} hint={`${stats.openCount} open deals`} />
          <Stat label="Weighted forecast" value={formatIDR(stats.weighted)} hint="Σ amount × stage probability" />
          <Stat label="Closing in 30 days" value={formatIDR(stats.closing30.reduce((s, d) => s + d.amount, 0))} hint={`${stats.closing30.length} deals`} />
          <Stat label="Closed won · this quarter" value={formatIDR(stats.wonValue)} tone="green" hint={`${stats.wonCount} deals (by close date, WIB)`} onClick={() => setStageFilter(stageFilter === "won" ? "" : "won")} active={stageFilter === "won"} />
          <Stat label="Past close date" value={String(stats.overdue)} tone={stats.overdue ? "orange" : undefined} hint="open deals" />
          <Stat label="Rotting" value={String(stats.rotting)} tone={stats.rotting ? "red" : undefined} hint={`idle past stage limit · ${stats.noNext} without next step`} onClick={() => setStageFilter(stageFilter === "rotting" ? "" : "rotting")} active={stageFilter === "rotting"} />
          <Stat label="Blocked by engineering" value={String(stats.blocked)} tone={stats.blocked ? "red" : undefined} hint="open Jira blockers" />
        </div>
      )}
      {strip === "forecast" && <ForecastStrip deals={inPipeline} stageMap={stageMap} now={now} />}
      {strip === "changes" && <ChangesStrip deals={inPipeline} history={history} stageMap={stageMap} windowDays={windowDays} now={now} onFocus={setFocus} focusLabel={focus?.label} />}

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
                      <span>
                        {Math.round(stage.probability * 100)}% · {formatIDR(total * stage.probability)} wtd{!stage.closed ? ` · rots ${rottingThreshold(stage)}d` : ""}
                      </span>
                    </div>
                  </div>
                  <Droppable droppableId={stage.id}>
                    {(provided, snapshot) => (
                      <div ref={provided.innerRef} {...provided.droppableProps} className={cn("flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors", snapshot.isDraggingOver && "bg-sg-card-2/60")}>
                        {col.map((deal, index) => (
                          <Draggable key={deal.id} draggableId={deal.id} index={index}>
                            {(p, s) => (
                              <div ref={p.innerRef} {...p.draggableProps} {...p.dragHandleProps} style={p.draggableProps.style}>
                                <DealCard deal={deal} dragging={s.isDragging} blockedBy={blockers.get(deal.id)} ctx={ctx} />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {!col.length && !snapshot.isDraggingOver && <p className="py-6 text-center text-2xs text-sg-dim">{stage.closed ? "Drop here to close — you'll be asked for the outcome" : "Drop deals here"}</p>}
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
          <table className="w-full min-w-[1180px] text-sm">
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
                  <th key={key} className={cn("px-4 py-2 font-semibold", key === "amount" && "text-right")} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                    <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))} className="hover:text-sg-white">
                      {label} {sort.key === key ? (sort.dir === 1 ? "↑" : "↓") : ""}
                    </button>
                  </th>
                ))}
                <th className="px-4 py-2 font-semibold">Forecast</th>
                <th className="px-4 py-2 font-semibold">Next step</th>
                <th className="px-4 py-2 font-semibold">Company</th>
                <th className="px-4 py-2 font-semibold">Engineering</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => (
                <DealRow key={d.id} d={d} ctx={ctx} blockedBy={blockers.get(d.id)} />
              ))}
            </tbody>
          </table>
          {!sorted.length && <p className="py-10 text-center text-sm text-sg-dim">No deals match these filters.</p>}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone, onClick, active }: { label: string; value: string; hint?: string; tone?: "green" | "orange" | "red"; onClick?: () => void; active?: boolean }) {
  const body = (
    <>
      <div className="sg-eyebrow">{label}</div>
      <div className={cn("sg-num mt-1 font-display text-xl font-extrabold", tone === "green" ? "text-soft-green" : tone === "orange" ? "text-soft-orange" : tone === "red" ? "text-soft-red" : "text-sg-white")}>{value}</div>
      {hint ? <div className="text-2xs text-sg-dim">{hint}</div> : null}
    </>
  );
  if (onClick)
    return (
      <button type="button" onClick={onClick} aria-pressed={active} className={cn("border-r border-sg-line px-5 py-3 text-left last:border-r-0 hover:bg-sg-card/60", active && "bg-sg-card")}>
        {body}
      </button>
    );
  return <div className="border-r border-sg-line px-5 py-3 last:border-r-0">{body}</div>;
}

/* ───────────── forecast categories ───────────── */

function ForecastStrip({ deals, stageMap, now }: { deals: Deal[]; stageMap: Map<string, StageInfo>; now: number }) {
  const data = useMemo(() => {
    const open = deals.filter((d) => !stageMap.get(d.stageId)?.closed);
    const by = new Map<ForecastCategory, { sum: number; n: number }>();
    FORECAST_ORDER.forEach((c) => by.set(c, { sum: 0, n: 0 }));
    const months: string[] = [];
    const start = new Date(now + 7 * 3_600_000);
    for (let i = 0; i < 3; i++) months.push(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
    const grid = new Map<string, Record<ForecastCategory, number>>(months.map((m) => [m, { commit: 0, best_case: 0, pipeline: 0, omitted: 0 }]));
    open.forEach((d) => {
      const c = forecastOf(d, stageMap.get(d.stageId));
      const b = by.get(c)!;
      b.sum += d.amount;
      b.n += 1;
      const row = grid.get(wibMonthKey(d.closeDate));
      if (row) row[c] += d.amount;
    });
    return { by, months, grid };
  }, [deals, stageMap, now]);
  const commit = data.by.get("commit")!.sum;
  const best = data.by.get("best_case")!.sum;
  const monthLabel = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
  return (
    <div className="grid shrink-0 grid-cols-2 border-b border-sg-line sm:grid-cols-4 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,2fr)]">
      {(["commit", "best_case", "pipeline", "omitted"] as const).map((c) => (
        <div key={c} className="border-r border-sg-line px-5 py-3" title={FORECAST_META[c].hint}>
          <div className="sg-eyebrow flex items-center gap-1.5">
            <Dot color={FORECAST_META[c].color} /> {FORECAST_META[c].label}
          </div>
          <div className="sg-num mt-1 font-display text-xl font-extrabold text-sg-white">{formatIDR(data.by.get(c)!.sum)}</div>
          <div className="text-2xs text-sg-dim">
            {data.by.get(c)!.n} deals{c === "best_case" ? ` · commit + best ${formatIDR(commit + best)}` : ""}
          </div>
        </div>
      ))}
      <div className="col-span-2 px-5 py-2 sm:col-span-4 lg:col-span-1">
        <div className="sg-eyebrow mb-1">By close month (WIB)</div>
        <table className="w-full text-2xs">
          <thead>
            <tr className="text-sg-dim">
              <th className="text-left font-semibold">Month</th>
              <th className="text-right font-semibold">Commit</th>
              <th className="text-right font-semibold">Best case</th>
              <th className="text-right font-semibold">Pipeline</th>
            </tr>
          </thead>
          <tbody>
            {data.months.map((m) => {
              const r = data.grid.get(m)!;
              return (
                <tr key={m} className="text-sg-muted">
                  <td>{monthLabel(m)}</td>
                  <td className="sg-num text-right font-semibold text-soft-green">{formatIDR(r.commit)}</td>
                  <td className="sg-num text-right text-soft-cyan">{formatIDR(r.best_case)}</td>
                  <td className="sg-num text-right">{formatIDR(r.pipeline)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ───────────── what changed (7d / 30d) ───────────── */

function ChangesStrip({ deals, history, stageMap, windowDays, now, onFocus, focusLabel }: { deals: Deal[]; history: DealChange[]; stageMap: Map<string, StageInfo>; windowDays: number; now: number; onFocus: (f: { label: string; ids: Set<string> } | null) => void; focusLabel?: string }) {
  const groups = useMemo(() => {
    const since = now - windowDays * DAY;
    const inScope = new Set(deals.map((d) => d.id));
    const recent = history.filter((h) => inScope.has(h.dealId) && Date.parse(h.at) >= since);
    const ids = (pred: (h: DealChange) => boolean) => new Set(recent.filter(pred).map((h) => h.dealId));
    const value = (set: Set<string>) => deals.filter((d) => set.has(d.id)).reduce((s, d) => s + d.amount, 0);
    const created = new Set(deals.filter((d) => Date.parse(d.createdAt) >= since).map((d) => d.id));
    const amountDelta = (pred: (n: number) => boolean) => {
      const net = new Map<string, number>();
      recent.filter((h) => h.field === "amount").forEach((h) => net.set(h.dealId, (net.get(h.dealId) ?? 0) + Number(h.to ?? 0) - Number(h.from ?? 0)));
      return { ids: new Set([...net].filter(([, n]) => pred(n)).map(([id]) => id)), sum: [...net.values()].filter(pred).reduce((a, b) => a + b, 0) };
    };
    const inc = amountDelta((n) => n > 0);
    const dec = amountDelta((n) => n < 0);
    const pushed = ids((h) => h.field === "closeDate" && !!h.from && !!h.to && String(h.to) > String(h.from) && wibMonthKey(String(h.to)) > wibMonthKey(String(h.from)));
    const won = ids((h) => h.field === "stageId" && stageMap.get(String(h.to))?.closed === "won");
    const lost = ids((h) => h.field === "stageId" && stageMap.get(String(h.to))?.closed === "lost");
    return [
      { label: "New", ids: created, value: formatIDR(value(created)), tone: "text-sg-white" },
      { label: "Increased", ids: inc.ids, value: `+${formatIDR(inc.sum)}`, tone: "text-soft-green" },
      { label: "Decreased", ids: dec.ids, value: formatIDR(dec.sum), tone: "text-soft-red" },
      { label: "Pushed out", ids: pushed, value: formatIDR(value(pushed)), tone: "text-soft-orange" },
      { label: "Won", ids: won, value: formatIDR(value(won)), tone: "text-soft-green" },
      { label: "Lost", ids: lost, value: formatIDR(value(lost)), tone: "text-soft-red" },
    ];
  }, [deals, history, stageMap, windowDays, now]);
  return (
    <div className="grid shrink-0 grid-cols-3 border-b border-sg-line lg:grid-cols-6">
      {groups.map((g) => {
        const label = `${g.label} · ${windowDays}d`;
        const active = focusLabel === label;
        return (
          <button key={g.label} type="button" aria-pressed={active} disabled={!g.ids.size} onClick={() => onFocus(active ? null : { label, ids: g.ids })} className={cn("border-r border-sg-line px-5 py-3 text-left last:border-r-0 enabled:hover:bg-sg-card/60 disabled:opacity-60", active && "bg-sg-card")}>
            <div className="sg-eyebrow">{g.label}</div>
            <div className={cn("sg-num mt-1 font-display text-xl font-extrabold", g.tone)}>{g.ids.size}</div>
            <div className="sg-num text-2xs text-sg-dim">{g.value}</div>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────── table row ───────────── */

function DealRow({ d, ctx, blockedBy }: { d: Deal; ctx: DealCtx; blockedBy?: string[] }) {
  const openDialog = useUi((s) => s.openDialog);
  const stage = ctx.stageMap.get(d.stageId);
  const days = daysFromNow(d.closeDate, ctx.now);
  const h = ctx.history7.get(d.id);
  const sig = ctx.signals.get(d.id);
  const next = nextStepOf(sig, ctx.now);
  const fc = forecastOf(d, stage);
  const rotting = isRotting(d, stage, sig, ctx.now);
  return (
    <tr className="border-b border-sg-line hover:bg-sg-card/70">
      <td className="px-4 py-2">
        <Link href={`/deals/${d.id}`} className="font-semibold text-sg-white hover:underline">
          {d.name}
        </Link>
        <div className="flex items-center gap-1.5 text-2xs text-sg-dim">
          {d.capability}
          {rotting && (
            <span className="flex items-center gap-0.5 font-semibold text-soft-red">
              <Flame className="size-3" /> idle {idleDays(d, sig, ctx.now)}d
            </span>
          )}
          {stage?.closed === "lost" && d.lostReason ? <span className="text-soft-red">· {d.lostReason}</span> : null}
        </div>
      </td>
      <td className="px-4 py-2">{stage ? <Chip color={stage.color} dot>{stage.name}</Chip> : null}</td>
      <td className="sg-num px-4 py-2 text-right font-semibold text-sg-white">
        {formatIDR(d.amount)}
        {h && h.amountDelta !== 0 ? (
          <span className={cn("ml-1 inline-flex items-center text-2xs", h.amountDelta > 0 ? "text-soft-green" : "text-soft-red")} title={`Amount ${h.amountDelta > 0 ? "up" : "down"} ${formatIDR(Math.abs(h.amountDelta), "full")} in the last 7 days`}>
            {h.amountDelta > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
            {formatIDR(Math.abs(h.amountDelta))}
          </span>
        ) : null}
      </td>
      <td className={cn("px-4 py-2", !stage?.closed && days < 0 ? "text-soft-orange" : "text-sg-muted")}>
        {formatDate(d.closeDate)}
        {!stage?.closed && <span className="ml-1 text-2xs">({days < 0 ? `${-days}d late` : `${days}d`})</span>}
        {h?.pushes ? (
          <span className="ml-1 rounded-sm bg-soft-orange/15 px-1 text-2xs font-semibold text-soft-orange" title="Times the expected close moved to a later month">
            Pushed ×{h.pushes}
          </span>
        ) : null}
      </td>
      <td className="px-4 py-2">
        <span className="flex items-center gap-2 text-sg-muted">
          <Avatar user={ctx.userMap.get(d.ownerId)} size="xs" /> {ctx.userMap.get(d.ownerId)?.name}
        </span>
      </td>
      <td className="px-4 py-2">
        {stage?.closed ? (
          <span className="text-2xs text-sg-dim">—</span>
        ) : (
          <select
            value={fc}
            onChange={(e) => applyDealChange(d.id, { forecastCategory: e.target.value as ForecastCategory }, `Forecast → ${FORECAST_META[e.target.value as ForecastCategory].label}`)}
            aria-label={`Forecast category for ${d.name}`}
            className="h-6 rounded border border-sg-line bg-transparent px-1 text-2xs text-sg-muted [&>option]:bg-sg-card"
          >
            {FORECAST_ORDER.map((c) => (
              <option key={c} value={c}>
                {FORECAST_META[c].label}
                {!d.forecastCategory && c === fc ? " (auto)" : ""}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="max-w-[220px] px-4 py-2">
        {stage?.closed ? (
          <span className="text-2xs text-sg-dim">—</span>
        ) : (
          <button
            type="button"
            onClick={() => openDialog({ kind: "logActivity", activityType: "task", target: { type: "deal", id: d.id } })}
            className={cn("flex max-w-full items-center gap-1 truncate text-left text-2xs font-semibold", next.tone === "green" ? "text-soft-green" : next.tone === "red" ? "text-soft-red" : "text-soft-yellow")}
            title={next.task ? `${next.task.subject} — click to add another task` : "No open task — click to schedule the next step"}
          >
            <ListTodo className="size-3 shrink-0" />
            <span className="truncate">{next.label}</span>
          </button>
        )}
      </td>
      <td className="px-4 py-2 text-sg-muted">{ctx.companyMap.get(d.companyId ?? "")?.name ?? "—"}</td>
      <td className="px-4 py-2">{blockedBy ? <Chip color="red">Blocked · {blockedBy.join(", ")}</Chip> : <span className="text-sg-dim">—</span>}</td>
    </tr>
  );
}

/* ───────────── board card ───────────── */

function DealCard({ deal, dragging, blockedBy, ctx }: { deal: Deal; dragging: boolean; blockedBy?: string[]; ctx: DealCtx }) {
  const stage = ctx.stageMap.get(deal.stageId);
  const days = daysFromNow(deal.closeDate, ctx.now);
  const overdue = !stage?.closed && days < 0;
  const company = ctx.companyMap.get(deal.companyId ?? "");
  const daysInStage = Math.max(0, -(daysFromNow(deal.stageEnteredAt, ctx.now) || 0));
  const sig = ctx.signals.get(deal.id);
  const rotting = isRotting(deal, stage, sig, ctx.now);
  const idle = idleDays(deal, sig, ctx.now);
  const next = nextStepOf(sig, ctx.now);
  const lines = ctx.lineTotals.get(deal.id);
  const drift = lines !== undefined && deal.amount > 0 && Math.abs(lines - deal.amount) / deal.amount > 0.05;
  return (
    <div className="group relative">
      <Link
        href={`/deals/${deal.id}`}
        draggable={false}
        className={cn(
          "block rounded-lg border border-sg-line border-l-2 bg-sg-card p-3 transition-[border-color,box-shadow] hover:border-sg-line-2",
          rotting ? "border-soft-red/50 border-l-soft-red" : stage ? softBorderLeft[stage.color] : "",
          dragging && "rotate-[1.5deg] border-sg-white/50 shadow-pop",
        )}
      >
        <div className="line-clamp-2 pr-6 text-sm font-semibold leading-snug text-sg-white">{deal.name.split(" — ")[1] ?? deal.name}</div>
        <div className="mt-0.5 truncate text-2xs text-sg-dim">{company?.name ?? "No company"}</div>
        <div className="mt-2 flex items-center justify-between gap-1">
          <span className="sg-num font-display text-base font-extrabold text-sg-white">{formatIDR(deal.amount)}</span>
          <span className="flex items-center gap-1">
            {drift && (
              <span className="rounded-sm bg-soft-yellow/15 px-1 text-2xs font-semibold text-soft-yellow" title={`Line items total ${formatIDR(lines ?? 0, "full")} — more than 5% away from the deal amount`}>
                Δ items
              </span>
            )}
            {deal.priority === "high" && <Chip color="orange">High</Chip>}
          </span>
        </div>
        {stage?.closed === "lost" && deal.lostReason && <div className="mt-1 truncate text-2xs text-soft-red">Lost · {deal.lostReason}{deal.lostToCompetitor ? ` (${deal.lostToCompetitor})` : ""}</div>}
        {blockedBy && (
          <div className="mt-2 flex items-center gap-1 rounded-sm bg-soft-red/10 px-1.5 py-1 text-2xs font-semibold text-soft-red">
            <OctagonAlert className="size-3" /> Blocked by {blockedBy.join(", ")}
          </div>
        )}
        {!stage?.closed && (
          <div className={cn("mt-2 flex items-center gap-1 truncate text-2xs font-semibold", next.tone === "green" ? "text-soft-green" : next.tone === "red" ? "text-soft-red" : "text-soft-yellow")} title={next.task ? `Next step: ${next.task.subject}` : "No open task on this deal"}>
            <ListTodo className="size-3 shrink-0" />
            <span className="truncate">{next.label}</span>
          </div>
        )}
        <div className="mt-2 flex items-center gap-2 border-t border-sg-line pt-2 text-2xs text-sg-dim">
          <span className={cn("flex items-center gap-1", overdue && "font-semibold text-soft-orange")} title={stage?.closed ? `Closed ${formatDate(deal.closeDate)}` : `Expected close ${formatDate(deal.closeDate)}`}>
            <CalendarClock className="size-3" />
            {formatDate(deal.closeDate, "short")}
            {!stage?.closed && <span>({overdue ? `${-days}d late` : `${days}d`})</span>}
          </span>
          <span className="flex items-center gap-0.5" title={`${deal.contactIds.length} contacts`}>
            <Users className="size-3" /> {deal.contactIds.length}
          </span>
          {rotting ? (
            <span className="flex items-center gap-0.5 font-semibold text-soft-red" title={`No activity for ${idle} days — this stage's limit is ${rottingThreshold(stage)} days`} aria-label={`Rotting: idle ${idle} days`}>
              <Flame className="size-3" /> {idle}d
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-1.5" title={`${daysInStage} days in stage`} aria-label={`${daysInStage} days in stage`}>
            {daysInStage}d in stage
            <Avatar user={ctx.userMap.get(deal.ownerId)} size="xs" />
          </span>
        </div>
      </Link>
      <QuickEdit deal={deal} />
    </div>
  );
}

/** pencil on each card: edit amount + close date in place (no navigation) */
function QuickEdit({ deal }: { deal: Deal }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [closeDate, setCloseDate] = useState("");
  const parsed = parseIDR(amount);
  const amountOk = parsed !== null && parsed >= 0;
  const dateOk = isDateInput(closeDate);
  const valid = amountOk && dateOk;
  const changed = valid && (parsed !== deal.amount || closeDate !== toDateInput(deal.closeDate));

  const save = () => {
    if (!valid) return;
    if (changed) applyDealChange(deal.id, { amount: parsed!, closeDate: closeDate === toDateInput(deal.closeDate) ? deal.closeDate : fromDateInput(closeDate) });
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
          className={cn(
            "absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded text-sg-dim hover:bg-sg-card-3 hover:text-sg-white focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-sg-white [@media(hover:none)]:opacity-100",
            open ? "bg-sg-card-3 text-sg-white opacity-100" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
          )}
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
            <Input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!amountOk} className={amountOk ? undefined : "border-soft-red/60"} />
            <span className={cn("mt-1 block text-2xs", amountOk ? "text-sg-dim" : "text-soft-red")}>{amountOk ? formatIDR(parsed!, "full") : "Enter an amount, e.g. 8.400.000.000 or 8,4 M"}</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-2xs font-semibold uppercase tracking-[0.12em] text-sg-dim">Close date</span>
            <Input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} aria-invalid={!dateOk} className={dateOk ? undefined : "border-soft-red/60"} />
            {!dateOk && <span className="mt-1 block text-2xs text-soft-red">Pick a close date</span>}
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
