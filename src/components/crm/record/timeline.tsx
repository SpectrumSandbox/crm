"use client";

import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Clock, Pin, PinOff, Trash2 } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useTimeline, useUserMap } from "@/lib/selectors";
import type { Activity, ActivityType, CrmObjectType } from "@/lib/types";
import { activityMeta, callOutcomeLabel } from "@/lib/meta";
import { cn, formatDate, relativeTime, softChip } from "@/lib/utils";
import { Tabs } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Avatar, EmptyState } from "@/components/ui/misc";

type Filter = "all" | ActivityType;

export function Timeline({ type, id }: { type: CrmObjectType; id: string }) {
  const items = useTimeline(type, id);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    items.forEach((a) => (m[a.type] = (m[a.type] ?? 0) + 1));
    return m;
  }, [items]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((a) => (filter === "all" || a.type === filter) && (!needle || `${a.subject} ${a.body}`.toLowerCase().includes(needle)));
  }, [items, filter, q]);

  const pinned = visible.filter((a) => a.pinned);
  const openTasks = visible.filter((a) => a.type === "task" && !a.done && !a.pinned).sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
  const rest = visible.filter((a) => !a.pinned && !(a.type === "task" && !a.done));

  // group remaining history by month
  const groups = useMemo(() => {
    const g = new Map<string, Activity[]>();
    rest.forEach((a) => {
      const k = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date(a.timestamp));
      g.set(k, [...(g.get(k) ?? []), a]);
    });
    return Array.from(g.entries());
  }, [rest]);

  const tabs: { value: Filter; label: string; count?: number }[] = [
    { value: "all", label: "Activity", count: items.length },
    ...(["note", "email", "call", "meeting", "task", "jira"] as ActivityType[]).map((t) => ({ value: t as Filter, label: activityMeta[t].plural, count: counts[t] ?? 0 })),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tabs value={filter} onChange={setFilter} items={tabs} className="px-4" />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-4">
        <Composer type={type} id={id} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search activity" className="mb-4 h-8 w-full rounded border border-sg-line bg-transparent px-2.5 text-sm text-sg-text placeholder:text-sg-dim focus:border-sg-white/50 focus:outline-none" />

        {pinned.length > 0 && (
          <Section title="Pinned">
            {pinned.map((a) => (
              <Item key={a.id} a={a} />
            ))}
          </Section>
        )}
        {openTasks.length > 0 && (
          <Section title="Upcoming tasks">
            {openTasks.map((a) => (
              <Item key={a.id} a={a} />
            ))}
          </Section>
        )}
        {groups.map(([month, list]) => (
          <Section key={month} title={month}>
            {list.map((a) => (
              <Item key={a.id} a={a} />
            ))}
          </Section>
        ))}
        {!visible.length && <EmptyState title="Nothing here yet" icon={Clock}>Log a call, email, meeting or note — or link Jira work — and it will appear on this timeline.</EmptyState>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <div className="sg-eyebrow mb-2">{title}</div>
      <ol className="relative space-y-2 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-sg-line">{children}</ol>
    </section>
  );
}

function Item({ a }: { a: Activity }) {
  const userMap = useUserMap();
  const toggleTask = useCrm((s) => s.toggleTask);
  const togglePin = useCrm((s) => s.togglePin);
  const deleteActivity = useCrm((s) => s.deleteActivity);
  const restoreActivity = useCrm((s) => s.restoreActivity);
  const notify = useUi((s) => s.notify);
  const openIssue = useUi((s) => s.openIssue);
  const [expanded, setExpanded] = useState(false);
  const meta = activityMeta[a.type];
  const Icon = meta.icon;
  const owner = userMap.get(a.ownerId);
  const overdue = a.type === "task" && !a.done && a.dueAt && Date.parse(a.dueAt) < Date.now();
  const long = a.body.length > 220;

  return (
    <li className="group relative flex gap-3">
      <span className={cn("relative z-[1] mt-1 flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", softChip[meta.color])}>
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 rounded-lg border border-sg-line bg-sg-card px-3.5 py-2.5 transition-colors group-hover:border-sg-line-2">
        <div className="flex items-start gap-2">
          {a.type === "task" && (
            <input type="checkbox" checked={!!a.done} onChange={() => toggleTask(a.id)} aria-label="Complete task" className="mt-0.5 size-4 shrink-0 cursor-pointer accent-white" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={cn("font-semibold text-sg-white", a.done && "text-sg-dim line-through")}>
                {a.type === "jira" && a.issueId ? (
                  <button type="button" onClick={() => openIssue(a.issueId!)} className="hover:underline">
                    {a.subject}
                  </button>
                ) : (
                  a.subject
                )}
              </span>
              {a.direction && (a.type === "email" || a.type === "call") && (
                <span className="flex items-center gap-0.5 text-2xs text-sg-dim">
                  {a.direction === "inbound" ? <ArrowDownLeft className="size-3" /> : <ArrowUpRight className="size-3" />}
                  {a.direction}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-sg-dim">
              <span>{meta.label}</span>
              <span>·</span>
              <span title={formatDate(a.timestamp, "datetime")}>{formatDate(a.timestamp, "datetime")}</span>
              {owner && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Avatar user={owner} size="xs" className="size-4 text-[8px]" /> {owner.name}
                  </span>
                </>
              )}
              {a.callOutcome && <span className="rounded-sm bg-sg-card-3 px-1 text-sg-muted">{callOutcomeLabel[a.callOutcome]}</span>}
              {a.durationMin ? <span className="rounded-sm bg-sg-card-3 px-1 text-sg-muted">{a.durationMin} min</span> : null}
              {a.type === "task" && a.dueAt && <span className={cn("rounded-sm px-1", overdue ? "bg-soft-red/15 text-soft-red" : "bg-sg-card-3 text-sg-muted")}>Due {formatDate(a.dueAt, "short")} ({relativeTime(a.dueAt)})</span>}
            </div>
          </div>
          <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <button type="button" onClick={() => togglePin(a.id)} className="rounded p-1 text-sg-dim hover:bg-sg-card-2 hover:text-sg-white" aria-label={a.pinned ? `Unpin “${a.subject}”` : `Pin “${a.subject}”`}>
              {a.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            </button>
            {a.type !== "jira" && (
              <button
                type="button"
                onClick={() => {
                  const all = useCrm.getState().activities;
                  const index = all.findIndex((x) => x.id === a.id);
                  const snapshot = all[index];
                  if (!snapshot) return;
                  deleteActivity(a.id);
                  notify(`${meta.label} “${a.subject.slice(0, 40)}${a.subject.length > 40 ? "…" : ""}” deleted`, { label: "Undo", run: () => restoreActivity(snapshot, index) });
                }}
                className="rounded p-1 text-sg-dim hover:bg-sg-card-2 hover:text-soft-red"
                aria-label={`Delete “${a.subject}”`}
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        </div>
        {a.body && (
          <div className={cn("mt-2 whitespace-pre-line text-sm leading-relaxed text-sg-muted", !expanded && long && "line-clamp-3")}>
            {a.body}
          </div>
        )}
        {long && (
          <button type="button" onClick={() => setExpanded((e) => !e)} className="mt-1 text-2xs font-semibold text-sg-dim hover:text-sg-white">
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    </li>
  );
}

/** Inline note composer + quick log buttons at the top of the timeline. */
function Composer({ type, id }: { type: CrmObjectType; id: string }) {
  const addActivity = useCrm((s) => s.addActivity);
  const contacts = useCrm((s) => s.contacts);
  const deals = useCrm((s) => s.deals);
  const tickets = useCrm((s) => s.tickets);
  const openDialog = useUi((s) => s.openDialog);
  const notify = useUi((s) => s.notify);
  const [note, setNote] = useState("");

  const save = () => {
    if (!note.trim()) return;
    const links = { contactIds: [] as string[], companyIds: [] as string[], dealIds: [] as string[], ticketIds: [] as string[] };
    if (type === "contact") {
      links.contactIds.push(id);
      const c = contacts.find((x) => x.id === id);
      if (c?.companyId) links.companyIds.push(c.companyId);
    } else if (type === "company") links.companyIds.push(id);
    else if (type === "deal") {
      links.dealIds.push(id);
      const d = deals.find((x) => x.id === id);
      if (d?.companyId) links.companyIds.push(d.companyId);
      // notes on a deal also show on its contacts' timelines (notes don't change "last contacted")
      links.contactIds.push(...(d?.contactIds ?? []));
    } else {
      links.ticketIds.push(id);
      const t = tickets.find((x) => x.id === id);
      if (t?.companyId) links.companyIds.push(t.companyId);
      if (t?.contactId) links.contactIds.push(t.contactId);
    }
    const [first, ...restLines] = note.trim().split("\n");
    addActivity({ type: "note", subject: first.slice(0, 90), body: restLines.join("\n").trim() || (first.length > 90 ? first : ""), links });
    setNote("");
    notify("Note added");
  };

  return (
    <div className="mb-3 rounded-lg border border-sg-line bg-sg-card focus-within:border-sg-line-2">
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
        placeholder="Write a note… (⌘↵ to save)"
        className="min-h-[56px] border-0 bg-transparent hover:border-0 focus:border-0"
      />
      <div className="flex flex-wrap items-center gap-1 border-t border-sg-line px-2 py-1.5">
        {(["call", "email", "meeting", "task"] as const).map((t) => {
          const Icon = activityMeta[t].icon;
          return (
            <Button key={t} size="xs" variant="ghost" onClick={() => openDialog({ kind: "logActivity", activityType: t, target: { type, id } })}>
              <Icon /> {t === "task" ? "Create task" : `Log ${t}`}
            </Button>
          );
        })}
        <Button size="xs" variant="primary" className="ml-auto" onClick={save} disabled={!note.trim()}>
          Save note
        </Button>
      </div>
    </div>
  );
}
