"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Briefcase, Clock, Gavel, History, Kanban, ListTodo, Plus, Ticket as TicketIcon } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { ticketSla, useCompanyMap, useStageMap, useUserMap } from "@/lib/selectors";
import { activityMeta, issueStatusMeta, issueTypeMeta, priorityMeta, ticketPriorityMeta } from "@/lib/meta";
import type { Activity, ActivityLinks } from "@/lib/types";
import { cn, daysFromNow, formatDate, formatIDR, relativeTime, softText, titleCase } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Avatar, Chip, EmptyState } from "@/components/ui/misc";

const DAY = 86_400_000;
const WIB = 7 * 3_600_000;

/** initiative statuses on which the PRC has the next move */
const PRC_ACTION = new Map<string, string>([
  ["submitted", "Acknowledge & screen"],
  ["screening", "Complete screening"],
  ["evaluation", "Score & decide"],
  ["conditional", "Confirm conditions"],
  ["deferred", "Re-review"],
]);

function greeting(now: number) {
  const h = new Date(now + WIB).getUTCHours();
  return h < 11 ? "Good morning" : h < 15 ? "Good afternoon" : "Good evening";
}

/** "2026-11" in WIB */
const wibMonth = (t: number) => new Date(t + WIB).toISOString().slice(0, 7);

export default function HomePage() {
  const currentUserId = useCrm((s) => s.currentUserId);
  const users = useCrm((s) => s.users);
  const activities = useCrm((s) => s.activities);
  const deals = useCrm((s) => s.deals);
  const tickets = useCrm((s) => s.tickets);
  const issues = useCrm((s) => s.issues);
  const sprints = useCrm((s) => s.sprints);
  const projects = useCrm((s) => s.projects);
  const initiatives = useCrm((s) => s.initiatives);
  const employeeProfiles = useCrm((s) => s.employeeProfiles);
  const toggleTask = useCrm((s) => s.toggleTask);
  const openIssue = useUi((s) => s.openIssue);
  const openDialog = useUi((s) => s.openDialog);
  const notify = useUi((s) => s.notify);
  const stageMap = useStageMap();
  const userMap = useUserMap();
  const companyMap = useCompanyMap();
  const recordLabel = useRecordLabel();

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const me = users.find((u) => u.id === currentUserId);
  const isPrc = !!employeeProfiles.find((p) => p.userId === currentUserId)?.governanceRoles.includes("prc");

  /* ── my open tasks: overdue first, then by due date ── */
  const myTasks = useMemo(
    () =>
      activities
        .filter((a) => a.type === "task" && !a.done && a.ownerId === currentUserId)
        .map((a) => ({ a, due: a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY }))
        .sort((x, y) => {
          const ox = x.due < now ? 0 : 1;
          const oy = y.due < now ? 0 : 1;
          return ox - oy || x.due - y.due;
        }),
    [activities, currentUserId, now],
  );

  /* ── my deals closing in 30 days or overdue ── */
  const myDeals = useMemo(
    () => deals.filter((d) => d.ownerId === currentUserId && !stageMap.get(d.stageId)?.closed && Date.parse(d.closeDate) <= now + 30 * DAY).sort((a, b) => a.closeDate.localeCompare(b.closeDate)),
    [deals, currentUserId, stageMap, now],
  );

  /* ── tickets breached or due within 24h (everyone's) ── */
  const slaTickets = useMemo(
    () =>
      tickets
        .filter((t) => !t.closedAt && !stageMap.get(t.stageId)?.closed && Date.parse(t.slaDueAt) <= now + 24 * 3_600_000)
        .sort((a, b) => a.slaDueAt.localeCompare(b.slaDueAt)),
    [tickets, stageMap, now],
  );

  /* ── my open issues in active sprints ── */
  const activeSprints = useMemo(() => new Map(sprints.filter((s) => s.state === "active").map((s) => [s.id, s] as const)), [sprints]);
  const myIssues = useMemo(
    () =>
      issues
        .filter((i) => i.assigneeId === currentUserId && i.status !== "done" && i.sprintId && activeSprints.has(i.sprintId))
        .sort((a, b) => priorityMeta[b.priority].weight - priorityMeta[a.priority].weight || a.rank - b.rank),
    [issues, currentUserId, activeSprints],
  );

  /* ── initiatives waiting on the PRC ── */
  const prcQueue = useMemo(
    () => (isPrc ? initiatives.filter((i) => PRC_ACTION.has(i.status)).sort((a, b) => (a.submittedAt ?? a.updatedAt).localeCompare(b.submittedAt ?? b.updatedAt)) : []),
    [initiatives, isPrc],
  );

  /* ── workspace activity ── */
  const recent = useMemo(() => [...activities].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 10), [activities]);

  /* ── KPI strip ── */
  const kpi = useMemo(() => {
    const open = deals.filter((d) => !stageMap.get(d.stageId)?.closed);
    const month = wibMonth(now);
    const wonMonth = deals.filter((d) => stageMap.get(d.stageId)?.closed === "won" && wibMonth(Date.parse(d.closeDate)) === month);
    const openIssues = issues.filter((i) => i.status !== "done");
    return {
      pipeline: open.reduce((s, d) => s + d.amount, 0),
      openCount: open.length,
      weighted: open.reduce((s, d) => s + d.amount * (stageMap.get(d.stageId)?.probability ?? 0), 0),
      won: wonMonth.reduce((s, d) => s + d.amount, 0),
      wonCount: wonMonth.length,
      breaches: tickets.filter((t) => ticketSla(t, now).state === "breached" && !stageMap.get(t.stageId)?.closed).length,
      openIssues: openIssues.length,
      mineIssues: openIssues.filter((i) => i.assigneeId === currentUserId).length,
    };
  }, [deals, tickets, issues, stageMap, now, currentUserId]);

  const completeTask = (a: Activity) => {
    toggleTask(a.id);
    notify(`Task done: ${a.subject}`, { label: "Undo", run: () => toggleTask(a.id) });
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Home" meta={<span className="text-sm text-sg-dim">· My day</span>}>
        <Button variant="outline" size="sm" onClick={() => openDialog({ kind: "logActivity", activityType: "task" })}>
          <Plus /> Task
        </Button>
        <Button variant="primary" size="sm" onClick={() => openDialog({ kind: "createDeal" })}>
          <Plus /> Deal
        </Button>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-sg-line px-5 py-5">
          <div className="sg-eyebrow">{formatDate(new Date(now).toISOString(), "long")} · {formatDate(new Date(now).toISOString(), "time")} WIB</div>
          <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-sg-white">
            {greeting(now)}, {me?.name.split(" ")[0] ?? "there"}
          </h2>
          <p className="mt-1 text-sm text-sg-muted">
            {myTasks.filter((t) => t.due < now).length ? (
              <span className="font-semibold text-soft-orange">{myTasks.filter((t) => t.due < now).length} overdue tasks · </span>
            ) : null}
            {myTasks.length} open tasks · {myDeals.length} deals to close · {slaTickets.length} tickets at SLA risk
            {isPrc ? ` · ${prcQueue.length} initiatives awaiting the PRC` : ""}
          </p>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 border-b border-sg-line sm:grid-cols-3 lg:grid-cols-5">
          <Kpi label="Open pipeline" value={formatIDR(kpi.pipeline)} hint={`${kpi.openCount} open deals`} href="/deals" />
          <Kpi label="Weighted forecast" value={formatIDR(kpi.weighted)} hint="Σ amount × stage probability" href="/deals" />
          <Kpi label="Won this month" value={formatIDR(kpi.won)} hint={`${kpi.wonCount} deals · ${new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "Asia/Jakarta" }).format(now)}`} tone="green" href="/deals?view=table" />
          <Kpi label="SLA breaches" value={String(kpi.breaches)} hint="open tickets past due" tone={kpi.breaches ? "red" : undefined} href="/tickets" />
          <Kpi label="Open issues" value={String(kpi.openIssues)} hint={`${kpi.mineIssues} assigned to you`} href="/issues" />
        </div>

        <div className="grid gap-4 p-5 xl:grid-cols-2">
          {/* tasks */}
          <Card title="My open tasks" icon={ListTodo} count={myTasks.length}>
            {myTasks.length ? (
              <ul className="divide-y divide-sg-line">
                {myTasks.slice(0, 8).map(({ a, due }) => {
                  const overdue = due < now;
                  const rec = recordLabel(a.links);
                  return (
                    <li key={a.id} className="flex items-start gap-3 px-4 py-2.5">
                      <input type="checkbox" aria-label={`Complete ${a.subject}`} checked={false} onChange={() => completeTask(a)} className="mt-0.5 size-4 shrink-0 cursor-pointer accent-white" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-sg-white">{a.subject}</div>
                        {rec ? (
                          <Link href={rec.href} className="truncate text-2xs text-sg-dim hover:text-sg-white hover:underline">
                            {rec.label}
                          </Link>
                        ) : null}
                      </div>
                      <span className={cn("shrink-0 text-2xs", overdue ? "font-semibold text-soft-red" : "text-sg-muted")} title={a.dueAt ? formatDate(a.dueAt, "datetime") : undefined}>
                        {a.dueAt ? (overdue ? `Overdue ${relativeTime(a.dueAt, now).replace(" ago", "")}` : `Due ${formatDate(a.dueAt, "short")}`) : "No due date"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={ListTodo} title="No open tasks">
                You’re all caught up. Tasks you log on contacts, companies, deals or tickets land here.
              </EmptyState>
            )}
            {myTasks.length > 8 && <p className="border-t border-sg-line px-4 py-2 text-2xs text-sg-dim">+ {myTasks.length - 8} more</p>}
          </Card>

          {/* deals */}
          <Card title="My deals closing soon" icon={Briefcase} count={myDeals.length} action={<CardLink href="/deals">Pipeline</CardLink>}>
            {myDeals.length ? (
              <ul className="divide-y divide-sg-line">
                {myDeals.slice(0, 8).map((d) => {
                  const days = daysFromNow(d.closeDate, now);
                  const stage = stageMap.get(d.stageId);
                  return (
                    <li key={d.id}>
                      <Link href={`/deals/${d.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-sg-card-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-sg-white">{d.name}</div>
                          <div className="truncate text-2xs text-sg-dim">
                            {companyMap.get(d.companyId ?? "")?.name ?? "No company"} · {stage?.name}
                          </div>
                        </div>
                        <span className="sg-num shrink-0 font-display text-sm font-extrabold text-sg-white">{formatIDR(d.amount)}</span>
                        <span className={cn("w-20 shrink-0 text-right text-2xs", days < 0 ? "font-semibold text-soft-orange" : "text-sg-muted")}>
                          {days < 0 ? `${-days}d overdue` : days === 0 ? "today" : `in ${days}d`}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={Briefcase} title="Nothing closing in the next 30 days">
                Open deals you own with a close date in the next 30 days — or already past it — show up here.
              </EmptyState>
            )}
          </Card>

          {/* tickets */}
          <Card title="Tickets at SLA risk" icon={TicketIcon} count={slaTickets.length} action={<CardLink href="/tickets">All tickets</CardLink>}>
            {slaTickets.length ? (
              <ul className="divide-y divide-sg-line">
                {slaTickets.slice(0, 8).map((t) => {
                  const sla = ticketSla(t, now);
                  return (
                    <li key={t.id}>
                      <Link href={`/tickets/${t.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-sg-card-2">
                        <Chip color={ticketPriorityMeta[t.priority].color}>{ticketPriorityMeta[t.priority].label}</Chip>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-sg-white">{t.subject}</div>
                          <div className="truncate text-2xs text-sg-dim">
                            {t.id.toUpperCase()} · {companyMap.get(t.companyId ?? "")?.name ?? "No company"}
                          </div>
                        </div>
                        <span className={cn("flex shrink-0 items-center gap-1 text-2xs", sla.state === "breached" ? "font-semibold text-soft-red" : sla.state === "due_soon" ? "font-semibold text-soft-orange" : "text-sg-muted")}>
                          <Clock className="size-3" /> {sla.label}
                        </span>
                        <Avatar user={userMap.get(t.ownerId)} size="xs" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={TicketIcon} title="Every open ticket is inside its SLA">
                Tickets that have breached or are due within 24 hours appear here, soonest first.
              </EmptyState>
            )}
          </Card>

          {/* issues */}
          <Card title="My sprint work" icon={Kanban} count={myIssues.length} action={<CardLink href="/board">Board</CardLink>}>
            {myIssues.length ? (
              <ul className="divide-y divide-sg-line">
                {myIssues.slice(0, 8).map((i) => {
                  const T = issueTypeMeta[i.type];
                  const P = priorityMeta[i.priority];
                  const sprint = activeSprints.get(i.sprintId ?? "");
                  return (
                    <li key={i.id}>
                      <button type="button" onClick={() => openIssue(i.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-sg-card-2">
                        <T.icon className={cn("size-3.5 shrink-0", softText[T.color])} />
                        <span className="sg-num shrink-0 text-2xs font-semibold text-sg-muted">{i.key}</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-sg-white">{i.summary}</div>
                          <div className="truncate text-2xs text-sg-dim">
                            {sprint?.name} · {projects.find((p) => p.id === i.projectId)?.name ?? ""}
                          </div>
                        </div>
                        <P.icon className={cn("size-3.5 shrink-0", softText[P.color])} aria-label={P.label} />
                        <Chip color={issueStatusMeta[i.status].color}>{issueStatusMeta[i.status].label}</Chip>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={Kanban} title="No sprint work assigned to you">
                Open issues assigned to you in an active sprint appear here.
              </EmptyState>
            )}
          </Card>

          {/* PRC queue */}
          {isPrc && (
            <Card title="Awaiting PRC action" icon={Gavel} count={prcQueue.length} action={<CardLink href="/initiatives">Initiatives</CardLink>}>
              {prcQueue.length ? (
                <ul className="divide-y divide-sg-line">
                  {prcQueue.slice(0, 8).map((i) => (
                    <li key={i.id}>
                      <Link href={`/initiatives/${i.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-sg-card-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-sg-white">{i.title}</div>
                          <div className="truncate text-2xs text-sg-dim">
                            {[i.trackingNo, userMap.get(i.initiatorId)?.name, i.submittedAt ? `submitted ${relativeTime(i.submittedAt, now)}` : ""].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <Chip color="yellow">{titleCase(i.status)}</Chip>
                        <span className="w-32 shrink-0 text-right text-2xs font-semibold text-sg-text">{PRC_ACTION.get(i.status)} →</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={Gavel} title="The PRC queue is clear">
                  Initiatives submitted for review, in screening or evaluation, or approved with conditions show up here.
                </EmptyState>
              )}
            </Card>
          )}

          {/* recent activity */}
          <Card title="Recent activity" icon={History} count={recent.length} className={isPrc ? undefined : "xl:col-span-2"}>
            {recent.length ? (
              <ul className="divide-y divide-sg-line">
                {recent.map((a) => {
                  const M = activityMeta[a.type];
                  const rec = recordLabel(a.links);
                  return (
                    <li key={a.id} className="flex items-start gap-3 px-4 py-2.5">
                      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-sg-line-2">
                        <M.icon className={cn("size-3", softText[M.color])} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-sg-white">{a.subject}</div>
                        <div className="flex min-w-0 items-center gap-1 text-2xs text-sg-dim">
                          <span className="shrink-0">{M.label}</span>
                          {rec ? (
                            <>
                              <span>·</span>
                              <Link href={rec.href} className="truncate hover:text-sg-white hover:underline">
                                {rec.label}
                              </Link>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <span className="shrink-0 text-2xs text-sg-dim" title={formatDate(a.timestamp, "datetime")}>
                        {relativeTime(a.timestamp, now)}
                      </span>
                      <Avatar user={userMap.get(a.ownerId)} size="xs" />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={History} title="No activity yet">
                Calls, emails, meetings, notes and Jira updates across the workspace will stream in here.
              </EmptyState>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** best record to point an activity at: deal → ticket → contact → company */
function useRecordLabel() {
  const deals = useCrm((s) => s.deals);
  const tickets = useCrm((s) => s.tickets);
  const contacts = useCrm((s) => s.contacts);
  const companies = useCrm((s) => s.companies);
  return useMemo(() => {
    const d = new Map(deals.map((x) => [x.id, x.name] as const));
    const t = new Map(tickets.map((x) => [x.id, x.subject] as const));
    const k = new Map(contacts.map((x) => [x.id, `${x.firstName} ${x.lastName}`] as const));
    const c = new Map(companies.map((x) => [x.id, x.name] as const));
    return (links: ActivityLinks): { href: string; label: string } | null => {
      const deal = links.dealIds.find((id) => d.has(id));
      if (deal) return { href: `/deals/${deal}`, label: d.get(deal)! };
      const ticket = links.ticketIds.find((id) => t.has(id));
      if (ticket) return { href: `/tickets/${ticket}`, label: t.get(ticket)! };
      const contact = links.contactIds.find((id) => k.has(id));
      if (contact) return { href: `/contacts/${contact}`, label: k.get(contact)! };
      const company = links.companyIds.find((id) => c.has(id));
      if (company) return { href: `/companies/${company}`, label: c.get(company)! };
      return null;
    };
  }, [deals, tickets, contacts, companies]);
}

function Kpi({ label, value, hint, tone, href }: { label: string; value: string; hint?: string; tone?: "green" | "red"; href: string }) {
  return (
    <Link href={href} className="border-b border-r border-sg-line px-5 py-3 hover:bg-sg-card/70 lg:border-b-0 lg:last:border-r-0">
      <div className="sg-eyebrow">{label}</div>
      <div className={cn("sg-num mt-1 font-display text-xl font-extrabold", tone === "green" ? "text-soft-green" : tone === "red" ? "text-soft-red" : "text-sg-white")}>{value}</div>
      {hint ? <div className="truncate text-2xs text-sg-dim">{hint}</div> : null}
    </Link>
  );
}

function Card({ title, icon: Icon, count, action, children, className }: { title: string; icon: React.ComponentType<{ className?: string }>; count?: number; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col overflow-hidden rounded-xl border border-sg-line bg-sg-card", className)}>
      <header className="flex items-center gap-2 border-b border-sg-line px-4 py-2.5">
        <Icon className="size-3.5 text-sg-dim" />
        <h3 className="font-display text-sm font-extrabold text-sg-white">{title}</h3>
        {typeof count === "number" ? <span className="rounded-sm bg-sg-card-3 px-1.5 text-2xs font-semibold text-sg-muted">{count}</span> : null}
        <div className="ml-auto">{action}</div>
      </header>
      {children}
    </section>
  );
}

function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-1 text-2xs font-semibold text-sg-muted hover:text-sg-white">
      {children} →
    </Link>
  );
}
