"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  Briefcase,
  CircleAlert,
  ClipboardCheck,
  Clock,
  Gavel,
  History,
  Kanban,
  Landmark,
  ListTodo,
  MessageSquare,
  Phone,
  Plus,
  ShieldCheck,
  Sparkles,
  Ticket as TicketIcon,
  Users,
  Wallet,
} from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import { ticketSla, useCompanyMap, useEngagement, useStageMap, useTicketEscalationInfo, useUserMap } from "@/lib/selectors";
import { whatsappLink } from "@/lib/smart-lists";
import { activityMeta, issueStatusMeta, issueTypeMeta, priorityMeta, ticketPriorityMeta } from "@/lib/meta";
import { breakEvenDeadline, monthKey, paymentDate } from "@/lib/initiatives/engine";
import { buildRegister, LIVE_PROJECT_STATUSES } from "@/components/projects/model";
import type { Activity, ActivityLinks, Team, User } from "@/lib/types";
import type { BonusRun } from "@/lib/initiatives/types";
import { cn, countLabel, daysFromNow, dueLabel, formatDate, formatIDR, relativeTime, softText, titleCase } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Avatar, Chip, EmptyState } from "@/components/ui/misc";
import { reviewOverdue } from "../companies/account-utils";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const WIB = 7 * HOUR;

/** initiative statuses on which the PRC has the next move */
const PRC_ACTION = new Map<string, string>([
  ["submitted", "Acknowledge & screen"],
  ["screening", "Complete screening"],
  ["evaluation", "Score & decide"],
  ["conditional", "Confirm conditions"],
  ["deferred", "Re-review"],
]);

type Persona = "leadership" | "finance" | "hr" | "sales" | "service" | "engineering";
const PERSONAS: { id: Persona; label: string; hint: string }[] = [
  { id: "leadership", label: "Leadership & PRC", hint: "Pipeline, service health, PRC queue and project compliance first" },
  { id: "finance", label: "Finance", hint: "Compensation cycle, company results and pipeline value first" },
  { id: "hr", label: "HR", hint: "People actions, Annex B, probation and compliance first" },
  { id: "sales", label: "Sales", hint: "Your deals, quotes and accounts first" },
  { id: "service", label: "Service", hint: "Tickets, SLAs and customer satisfaction first" },
  { id: "engineering", label: "Engineering", hint: "Sprint work and escalations first" },
];
const TEAM_PERSONA: Record<Team, Persona> = { Leadership: "leadership", Finance: "finance", People: "hr", Sales: "sales", Marketing: "sales", Service: "service", Engineering: "engineering" };
const PERSONA_KEY = "sg-home-persona";
const SNOOZE_KEY = "sg-home-snoozed";

function greeting(now: number) {
  const h = new Date(now + WIB).getUTCHours();
  return h < 11 ? "Good morning" : h < 15 ? "Good afternoon" : "Good evening";
}

/** "2026-11" in WIB */
const wibMonth = (t: number) => new Date(t + WIB).toISOString().slice(0, 7);
const wibDay = (t: number) => new Date(t + WIB).toISOString().slice(0, 10);
const monthName = (t: number) => new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "Asia/Jakarta" }).format(t);

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — the choice lasts for this visit */
  }
}

interface AttentionItem {
  id: string;
  tone: "red" | "orange" | "yellow" | "blue";
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  href?: string;
  action?: { label: string; run: () => void };
  /** sort key: lower first */
  rank: number;
}

export default function HomePage() {
  const currentUserId = useCrm((s) => s.currentUserId);
  const users = useCrm((s) => s.users);
  const activities = useCrm((s) => s.activities);
  const deals = useCrm((s) => s.deals);
  const tickets = useCrm((s) => s.tickets);
  const contacts = useCrm((s) => s.contacts);
  const quotes = useCrm((s) => s.quotes);
  const issues = useCrm((s) => s.issues);
  const sprints = useCrm((s) => s.sprints);
  const projects = useCrm((s) => s.projects);
  const initiatives = useCrm((s) => s.initiatives);
  const initiativeMembers = useCrm((s) => s.initiativeMembers);
  const revenueEntries = useCrm((s) => s.revenueEntries);
  const curveAdjustments = useCrm((s) => s.curveAdjustments);
  const teamAmendments = useCrm((s) => s.teamAmendments);
  const employeeProfiles = useCrm((s) => s.employeeProfiles);
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const accountPlans = useCrm((s) => s.accountPlans);
  const toggleTask = useCrm((s) => s.toggleTask);
  const reconcileSlaPauses = useCrm((s) => s.reconcileSlaPauses);
  const logWhatsApp = useCrm((s) => s.logWhatsApp);
  const deleteActivity = useCrm((s) => s.deleteActivity);
  const openIssue = useUi((s) => s.openIssue);
  const openDialog = useUi((s) => s.openDialog);
  const notify = useUi((s) => s.notify);
  const access = useAccess();
  const stageMap = useStageMap();
  const userMap = useUserMap();
  const companyMap = useCompanyMap();
  const engagement = useEngagement();
  const escalations = useTicketEscalationInfo();
  const recordLabel = useRecordLabel();

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    reconcileSlaPauses();
  }, [tickets, reconcileSlaPauses]);

  const me = users.find((u) => u.id === currentUserId);
  const roles = access.roles;
  const isPrc = access.prc;
  const detected: Persona = roles.includes("cfo") || roles.includes("finance") ? "finance" : roles.includes("hr") ? "hr" : roles.includes("ceo") || roles.includes("executive_committee") ? "leadership" : me ? TEAM_PERSONA[me.team] : "sales";

  /* per-viewer conveniences: chosen layout, My day / Team, snoozed attention items */
  const [personaPick, setPersonaPick] = useState<Record<string, Persona>>({});
  const [teamView, setTeamView] = useState(false);
  const [snoozed, setSnoozed] = useState<Record<string, string>>({});
  const [showAllTasks, setShowAllTasks] = useState(false);
  useEffect(() => {
    setPersonaPick(readLocal<Record<string, Persona>>(PERSONA_KEY, {}));
    setSnoozed(readLocal<Record<string, string>>(SNOOZE_KEY, {}));
  }, []);
  const persona: Persona = personaPick[currentUserId] ?? detected;
  const pickPersona = (p: Persona) => {
    const next = { ...personaPick };
    if (p === detected) delete next[currentUserId];
    else next[currentUserId] = p;
    setPersonaPick(next);
    writeLocal(PERSONA_KEY, next);
  };
  const today = wibDay(now);
  const snooze = (id: string) => {
    const next = { ...Object.fromEntries(Object.entries(snoozed).filter(([, d]) => d >= today)), [id]: today };
    setSnoozed(next);
    writeLocal(SNOOZE_KEY, next);
    notify("Hidden until tomorrow", {
      label: "Undo",
      run: () => {
        const back = { ...next };
        delete back[id];
        setSnoozed(back);
        writeLocal(SNOOZE_KEY, back);
      },
    });
  };

  const isClosedStage = (stageId: string) => !!stageMap.get(stageId)?.closed;

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
  const overdueTasks = myTasks.filter((t) => t.due < now).length;

  /* ── my deals closing in 30 days or overdue ── */
  const myDeals = useMemo(
    () => deals.filter((d) => d.ownerId === currentUserId && !stageMap.get(d.stageId)?.closed && Date.parse(d.closeDate) <= now + 30 * DAY).sort((a, b) => a.closeDate.localeCompare(b.closeDate)),
    [deals, currentUserId, stageMap, now],
  );

  /* ── tickets breached or due within 24h (everyone's), paused ones excluded ── */
  const slaTickets = useMemo(
    () =>
      tickets
        .filter((t) => !t.closedAt && !stageMap.get(t.stageId)?.closed && !t.slaPausedAt && Date.parse(t.slaDueAt) <= now + 24 * HOUR)
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

  /* ── live projects and their policy-compliance checks ── */
  const compliance = useMemo(() => {
    const inp = { initiatives, members: initiativeMembers, profiles: employeeProfiles, users, entries: revenueEntries, adjustments: curveAdjustments, amendments: teamAmendments };
    return initiatives
      .filter((i) => !i.demo && (LIVE_PROJECT_STATUSES as readonly string[]).includes(i.status))
      .map((i) => {
        const r = buildRegister(i, inp);
        return { id: i.id, title: i.title, type: i.type, failing: r.failing, warnings: r.warnings, first: r.compliance.find((c) => c.status === "fail") ?? r.compliance.find((c) => c.status === "warn") };
      })
      .sort((a, b) => b.failing - a.failing || b.warnings - a.warnings || a.title.localeCompare(b.title));
  }, [initiatives, initiativeMembers, employeeProfiles, users, revenueEntries, curveAdjustments, teamAmendments]);
  const projectsWithGaps = compliance.filter((c) => c.failing > 0).length;

  /* ── compensation cycle (§8.2) and the published company result (§9.6) ── */
  const runs = useMemo(() => [...bonusRuns].sort((a, b) => b.month.localeCompare(a.month)), [bonusRuns]);
  const published = runs.find((r) => r.status === "released" || r.status === "certified" || r.status === "failed");
  const cycleMonthNow = monthKey(now);
  const currentRun = runs.find((r) => r.month === cycleMonthNow);

  /* ── HR signals (counts only; shown to HR / pay roles) ── */
  const hr = useMemo(() => {
    const live = employeeProfiles.filter((p) => !p.separation);
    return {
      unsigned: live.filter((p) => !p.acknowledgmentSignedAt).length,
      probationSoon: live.filter((p) => p.probationEndDate && Date.parse(p.probationEndDate) - now <= 30 * DAY && Date.parse(p.probationEndDate) >= now - DAY).length,
      restricted: live.filter((p) => p.suspended || p.onPIP || p.underInvestigation || p.activeWrittenWarning).length,
      separations: employeeProfiles.filter((p) => p.separation && Date.parse(p.separation.effectiveAt) >= now - 30 * DAY).length,
    };
  }, [employeeProfiles, now]);

  /* ── workspace activity ── */
  const recent = useMemo(() => [...activities].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 10), [activities]);

  /* ── KPI figures ── */
  const kpi = useMemo(() => {
    const open = deals.filter((d) => !stageMap.get(d.stageId)?.closed);
    const month = wibMonth(now);
    const wonMonth = deals.filter((d) => stageMap.get(d.stageId)?.closed === "won" && wibMonth(Date.parse(d.closeDate)) === month);
    const openTickets = tickets.filter((t) => !t.closedAt && !stageMap.get(t.stageId)?.closed);
    const states = openTickets.map((t) => ticketSla(t, now).state);
    const openIssues = issues.filter((i) => i.status !== "done");
    const rated = tickets.filter((t) => typeof t.csat === "number" && t.closedAt && now - Date.parse(t.closedAt) <= 90 * DAY);
    const mineOpen = open.filter((d) => d.ownerId === currentUserId);
    return {
      pipeline: open.reduce((s, d) => s + d.amount, 0),
      openCount: open.length,
      minePipeline: mineOpen.reduce((s, d) => s + d.amount, 0),
      mineCount: mineOpen.length,
      weighted: open.reduce((s, d) => s + d.amount * (stageMap.get(d.stageId)?.probability ?? 0), 0),
      won: wonMonth.reduce((s, d) => s + d.amount, 0),
      wonCount: wonMonth.length,
      openTickets: openTickets.length,
      myTickets: openTickets.filter((t) => t.ownerId === currentUserId).length,
      breaches: states.filter((s) => s === "breached").length,
      dueSoon: states.filter((s) => s === "due_soon").length,
      paused: states.filter((s) => s === "paused").length,
      csat: rated.length ? rated.reduce((s, t) => s + (t.csat ?? 0), 0) / rated.length : null,
      csatCount: rated.length,
      openIssues: openIssues.length,
      mineIssues: openIssues.filter((i) => i.assigneeId === currentUserId).length,
      inReview: openIssues.filter((i) => i.status === "in_review").length,
      myOverdueIssues: openIssues.filter((i) => i.assigneeId === currentUserId && i.dueDate && Date.parse(i.dueDate) < now).length,
      escalationsOpen: Array.from(escalations.values()).reduce((s, e) => s + e.open, 0),
      quotesPending: quotes.filter((q) => q.status === "pending_approval").length,
    };
  }, [deals, tickets, issues, quotes, stageMap, now, currentUserId, escalations]);

  /* ── needs your attention: generated actions that disappear once handled ── */
  const attention = useMemo(() => {
    const items: AttentionItem[] = [];
    const lastTouch = new Map<string, string>();
    activities.forEach((a) => {
      if (a.type === "task" || Date.parse(a.timestamp) > now) return;
      a.links.dealIds.forEach((id) => {
        if (!lastTouch.has(id) || a.timestamp > lastTouch.get(id)!) lastTouch.set(id, a.timestamp);
      });
    });
    const hasNextStep = new Set<string>();
    activities.forEach((a) => a.type === "task" && !a.done && a.links.dealIds.forEach((id) => hasNextStep.add(id)));

    deals
      .filter((d) => d.ownerId === currentUserId && !isClosedStage(d.stageId))
      .forEach((d) => {
        const days = daysFromNow(d.closeDate, now);
        if (days < 0) {
          items.push({ id: `deal-late-${d.id}`, tone: "red", icon: Briefcase, title: `${d.name} is past its close date`, detail: `Expected ${formatDate(d.closeDate)} (${dueLabel(d.closeDate, now)}) · ${formatIDR(d.amount)} — update the date or close it`, href: `/deals/${d.id}`, rank: 0 });
          return;
        }
        const last = lastTouch.get(d.id) ?? d.stageEnteredAt;
        const idle = Math.floor((now - Date.parse(last)) / DAY);
        if (!hasNextStep.has(d.id)) {
          items.push({
            id: `deal-next-${d.id}`,
            tone: "yellow",
            icon: ListTodo,
            title: `No next step on ${d.name}`,
            detail: `${stageMap.get(d.stageId)?.name ?? "Open"} · ${formatIDR(d.amount)} · last touch ${relativeTime(last, now)}`,
            href: `/deals/${d.id}`,
            action: { label: "Add task", run: () => openDialog({ kind: "logActivity", activityType: "task", target: { type: "deal", id: d.id } }) },
            rank: 3,
          });
        } else if (idle >= 14) {
          items.push({
            id: `deal-idle-${d.id}`,
            tone: "orange",
            icon: Phone,
            title: `${d.name} has gone quiet`,
            detail: `No call, email or meeting for ${idle} days`,
            href: `/deals/${d.id}`,
            action: { label: "Log call", run: () => openDialog({ kind: "logActivity", activityType: "call", target: { type: "deal", id: d.id } }) },
            rank: 2,
          });
        }
      });

    tickets
      .filter((t) => t.ownerId === currentUserId && !t.closedAt && !isClosedStage(t.stageId))
      .forEach((t) => {
        const sla = ticketSla(t, now);
        const esc = escalations.get(t.id);
        if (sla.state === "breached" || (sla.state === "due_soon" && sla.hoursLeft < 4)) {
          items.push({ id: `ticket-sla-${t.id}`, tone: sla.state === "breached" ? "red" : "orange", icon: TicketIcon, title: `${t.id.toUpperCase()} ${sla.state === "breached" ? "has breached its SLA" : "is about to breach"}`, detail: `${t.subject} · ${sla.label}`, href: `/tickets/${t.id}`, rank: sla.state === "breached" ? 0 : 1 });
        } else if (esc && esc.open === 0 && esc.done > 0) {
          items.push({ id: `ticket-ready-${t.id}`, tone: "blue", icon: ShieldCheck, title: `${t.id.toUpperCase()} is ready to resolve`, detail: `${esc.keys.join(", ")} done in Jira — confirm with the customer and resolve`, href: `/tickets/${t.id}`, rank: 2 });
        }
      });

    quotes.forEach((q) => {
      const deal = deals.find((d) => d.id === q.dealId);
      const open = q.status === "draft" || q.status === "pending_approval" || q.status === "approved" || q.status === "sent";
      if (open && q.ownerId === currentUserId) {
        const left = Date.parse(q.expiresAt) - now;
        if (left < 0) items.push({ id: `quote-exp-${q.id}`, tone: "red", icon: Briefcase, title: `Quote ${q.number} has expired`, detail: `${q.title} — re-issue it or mark it expired`, href: deal ? `/deals/${deal.id}` : undefined, rank: 1 });
        else if (left <= 7 * DAY) items.push({ id: `quote-soon-${q.id}`, tone: "orange", icon: Briefcase, title: `Quote ${q.number} expires ${dueLabel(q.expiresAt, now)}`, detail: q.title, href: deal ? `/deals/${deal.id}` : undefined, rank: 2 });
      }
      if (q.status === "pending_approval" && (access.prc || access.certify) && q.ownerId !== currentUserId) {
        items.push({ id: `quote-approve-${q.id}`, tone: "yellow", icon: ClipboardCheck, title: `Quote ${q.number} is waiting for approval`, detail: `${q.title} · from ${userMap.get(q.ownerId)?.name ?? "—"}`, href: deal ? `/deals/${deal.id}` : undefined, rank: 2 });
      }
    });

    contacts
      .filter((c) => c.ownerId === currentUserId && (c.lifecycleStage === "customer" || c.lifecycleStage === "opportunity" || c.lifecycleStage === "sql"))
      .forEach((c) => {
        const last = engagement.byContact.get(c.id)?.lastAt ?? c.lastContactedAt;
        const idle = last ? Math.floor((now - Date.parse(last)) / DAY) : null;
        if (idle !== null && idle < 21) return;
        const wa = whatsappLink(c.phone, `Halo ${c.firstName}, `);
        items.push({
          id: `contact-cold-${c.id}`,
          tone: "blue",
          icon: MessageSquare,
          title: `${c.firstName} ${c.lastName} is going cold`,
          detail: `${companyMap.get(c.companyId ?? "")?.name ?? "No company"} · ${idle === null ? "never contacted" : `last touch ${idle} days ago`}`,
          href: `/contacts/${c.id}`,
          action: wa
            ? {
                label: "WhatsApp",
                run: () => {
                  window.open(wa, "_blank", "noopener,noreferrer");
                  const id = logWhatsApp(c.id);
                  notify(`WhatsApp opened for ${c.firstName} · logged on the timeline`, id ? { label: "Undo", run: () => deleteActivity(id) } : undefined);
                },
              }
            : { label: "Log call", run: () => openDialog({ kind: "logActivity", activityType: "call", target: { type: "contact", id: c.id } }) },
          rank: 4,
        });
      });

    accountPlans
      .filter((p) => p.ownerId === currentUserId && reviewOverdue(p.cadence, p.lastReviewedAt, now))
      .forEach((p) => items.push({ id: `plan-${p.id}`, tone: "yellow", icon: ClipboardCheck, title: `Account plan review due: ${companyMap.get(p.companyId)?.name ?? "account"}`, detail: p.lastReviewedAt ? `Last reviewed ${relativeTime(p.lastReviewedAt, now)}` : "Never reviewed", href: `/companies/${p.companyId}/plan`, rank: 3 }));

    return items.filter((i) => snoozed[i.id] !== today).sort((a, b) => a.rank - b.rank);
  }, [activities, deals, tickets, quotes, contacts, accountPlans, currentUserId, now, stageMap, escalations, engagement, companyMap, userMap, access, snoozed, today, openDialog, logWhatsApp, deleteActivity, notify]);

  /* ── team view: per-person engagement and workload ── */
  const team = useMemo(() => {
    const since7 = now - 7 * DAY;
    const since30 = now - 30 * DAY;
    const month = wibMonth(now);
    const rows = users.map((u) => {
      const mine = activities.filter((a) => a.ownerId === u.id && Date.parse(a.timestamp) <= now);
      const touches = (since: number) => mine.filter((a) => Date.parse(a.timestamp) >= since && (a.type === "call" || a.type === "meeting" || a.type === "email" || (a.type === "note" && /^whatsapp\b/i.test(a.subject))));
      const t7 = touches(since7);
      const t30 = touches(since30);
      const tasks = activities.filter((a) => a.type === "task" && !a.done && a.ownerId === u.id);
      const open = deals.filter((d) => d.ownerId === u.id && !stageMap.get(d.stageId)?.closed);
      const won = deals.filter((d) => d.ownerId === u.id && stageMap.get(d.stageId)?.closed === "won" && wibMonth(Date.parse(d.closeDate)) === month);
      const created = deals.filter((d) => d.ownerId === u.id && wibMonth(Date.parse(d.createdAt)) === month);
      const tk = tickets.filter((t) => t.ownerId === u.id && !t.closedAt && !stageMap.get(t.stageId)?.closed);
      return {
        user: u,
        calls7: t7.filter((a) => a.type === "call").length,
        meetings7: t7.filter((a) => a.type === "meeting").length,
        messages7: t7.filter((a) => a.type === "email" || a.type === "note").length,
        touches30: t30.length,
        tasks: tasks.length,
        overdue: tasks.filter((a) => a.dueAt && Date.parse(a.dueAt) < now).length,
        pipeline: open.reduce((s, d) => s + d.amount, 0),
        openDeals: open.length,
        created: created.reduce((s, d) => s + d.amount, 0),
        won: won.reduce((s, d) => s + d.amount, 0),
        tickets: tk.length,
        breached: tk.filter((t) => ticketSla(t, now).state === "breached").length,
      };
    });
    return rows.filter((r) => r.touches30 || r.tasks || r.openDeals || r.tickets || r.won).sort((a, b) => b.pipeline - a.pipeline || b.touches30 - a.touches30);
  }, [users, activities, deals, tickets, stageMap, now]);

  const completeTask = (a: Activity) => {
    toggleTask(a.id);
    notify(`Task done: ${a.subject}`, { label: "Undo", run: () => toggleTask(a.id) });
  };

  /* ── KPI strip per persona: always six tiles, each labelled with its scope ── */
  const monthLabel = monthName(now);
  const tiles: KpiProps[] = (() => {
    const pipeline: KpiProps = { label: "Open pipeline", scope: "All pipelines", value: formatIDR(kpi.pipeline), hint: countLabel(kpi.openCount, "open deal"), href: "/deals" };
    const weighted: KpiProps = { label: "Weighted forecast", scope: "All pipelines", value: formatIDR(kpi.weighted), hint: "Σ amount × stage probability", href: "/deals" };
    const won: KpiProps = { label: "Won this month", scope: "All pipelines", value: formatIDR(kpi.won), hint: `${countLabel(kpi.wonCount, "deal")} · ${monthLabel}`, tone: "green", href: "/deals?view=table&stage=won" };
    const mine: KpiProps = { label: "My open pipeline", scope: "You", value: formatIDR(kpi.minePipeline), hint: `${countLabel(kpi.mineCount, "deal")} · ${myDeals.length} closing ≤ 30 days`, href: `/deals?owner=${currentUserId}` };
    const breaches: KpiProps = { label: "SLA breaches", scope: "Workspace", value: String(kpi.breaches), hint: `${kpi.dueSoon} due < 12 h · ${kpi.paused} paused`, tone: kpi.breaches ? "red" : undefined, href: "/tickets" };
    const openTickets: KpiProps = { label: "Open tickets", scope: "Workspace", value: String(kpi.openTickets), hint: `${kpi.myTickets} yours`, href: "/tickets?open=1" };
    const csat: KpiProps = { label: "CSAT, 90 days", scope: "Workspace", value: kpi.csat === null ? "—" : `${kpi.csat.toFixed(1)}/5`, hint: kpi.csatCount ? countLabel(kpi.csatCount, "rating") : "no ratings yet", href: "/tickets?view=table" };
    const quotesTile: KpiProps = { label: "Quotes awaiting approval", scope: "Workspace", value: String(kpi.quotesPending), hint: "pending approval", tone: kpi.quotesPending ? "orange" : undefined, href: "/deals" };
    const prc: KpiProps = { label: "Awaiting the PRC", scope: "Workspace", value: String(initiatives.filter((i) => PRC_ACTION.has(i.status)).length), hint: "proposals to screen or decide", href: "/initiatives" };
    const gaps: KpiProps = { label: "Projects with policy gaps", scope: "Live projects", value: `${projectsWithGaps}/${compliance.length}`, hint: "failing register checks", tone: projectsWithGaps ? "orange" : undefined, href: "/projects" };
    const issuesMine: KpiProps = { label: "My open issues", scope: "You", value: String(kpi.mineIssues), hint: `${myIssues.length} in active sprints`, href: "/issues" };
    const issuesAll: KpiProps = { label: "Open issues", scope: "Workspace", value: String(kpi.openIssues), hint: `${kpi.inReview} in review`, href: "/issues" };
    const escal: KpiProps = { label: "Open escalations", scope: "Workspace", value: String(kpi.escalationsOpen), hint: "support issues from tickets", href: "/board" };
    const overdueIssues: KpiProps = { label: "My overdue issues", scope: "You", value: String(kpi.myOverdueIssues), hint: "past their due date", tone: kpi.myOverdueIssues ? "red" : undefined, href: "/issues" };
    const tasks: KpiProps = { label: "My open tasks", scope: "You", value: String(myTasks.length), hint: overdueTasks ? `${overdueTasks} overdue` : "none overdue", tone: overdueTasks ? "orange" : undefined, href: "/home" };
    const result: KpiProps = published
      ? { label: "Company result", scope: `Cycle ${published.month}`, value: published.status === "failed" ? "Below break-even" : "Break-even met", hint: `${Math.round(published.payoutPct * 100)}% of bonuses released`, tone: published.status === "failed" ? "red" : "green", href: "/compensation" }
      : { label: "Company result", scope: "§9.6", value: "—", hint: "no cycle certified yet", href: "/compensation" };
    const cycle: KpiProps = currentRun
      ? { label: "This salary cycle", scope: cycleMonthNow, value: titleCase(currentRun.status), hint: currentRun.status === "draft" ? `certify by ${formatDate(breakEvenDeadline(cycleMonthNow), "short")}` : `pay date ${formatDate(paymentDate(cycleMonthNow), "short")}`, tone: currentRun.status === "released" ? "green" : undefined, href: "/compensation" }
      : { label: "This salary cycle", scope: cycleMonthNow, value: "Not started", hint: `certify by ${formatDate(breakEvenDeadline(cycleMonthNow), "short")}`, tone: "orange", href: "/compensation" };
    const annex: KpiProps = { label: "Annex B unsigned", scope: "People", value: String(hr.unsigned), hint: "participation agreement missing", tone: hr.unsigned ? "orange" : undefined, href: "/people" };
    const probation: KpiProps = { label: "Probation ending", scope: "Next 30 days", value: String(hr.probationSoon), hint: "§9.5 completion review", href: "/people" };
    const restricted: KpiProps = { label: "Status restrictions", scope: "People", value: String(hr.restricted), hint: "PIP, warning, suspension or investigation", href: "/people" };

    switch (persona) {
      case "finance":
        return access.seeAllPay ? [result, cycle, pipeline, weighted, won, gaps] : [result, pipeline, weighted, won, quotesTile, tasks];
      case "hr":
        return access.seeAllPay ? [annex, probation, restricted, cycle, gaps, tasks] : [result, tasks, prc, gaps, openTickets, issuesAll];
      case "sales":
        return [mine, pipeline, weighted, won, quotesTile, tasks];
      case "service":
        return [openTickets, breaches, csat, escal, tasks, pipeline];
      case "engineering":
        return [issuesMine, overdueIssues, issuesAll, escal, breaches, tasks];
      default:
        return [pipeline, weighted, won, breaches, prc, gaps];
    }
  })();

  /* ── cards ── */
  const tasksCard = (
    <Card key="tasks" title="My open tasks" icon={ListTodo} count={myTasks.length}>
      {myTasks.length ? (
        <ul className="divide-y divide-sg-line">
          {(showAllTasks ? myTasks : myTasks.slice(0, 8)).map(({ a, due }) => {
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
                <span className={cn("shrink-0 text-2xs", overdue ? "font-semibold text-soft-red" : "text-sg-muted")} title={a.dueAt ? `${formatDate(a.dueAt, "datetime")} WIB` : undefined}>
                  {a.dueAt ? (overdue ? `Overdue · ${dueLabel(a.dueAt, now)}` : `Due ${dueLabel(a.dueAt, now)}`) : "No due date"}
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
      {myTasks.length > 8 && (
        <button type="button" onClick={() => setShowAllTasks((v) => !v)} className="border-t border-sg-line px-4 py-2 text-left text-2xs font-semibold text-sg-muted hover:text-sg-white">
          {showAllTasks ? "Show fewer" : `Show all ${myTasks.length} tasks (${myTasks.length - 8} more)`}
        </button>
      )}
    </Card>
  );

  const dealsCard = (
    <Card key="deals" title="My deals closing soon" icon={Briefcase} count={myDeals.length} action={<CardLink href="/deals">Pipeline</CardLink>}>
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
                  <span className={cn("w-24 shrink-0 text-right text-2xs", days < 0 ? "font-semibold text-soft-orange" : "text-sg-muted")} title={`Close date ${formatDate(d.closeDate)}`}>
                    {dueLabel(d.closeDate, now)}
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
  );

  const ticketsCard = (
    <Card key="tickets" title="Tickets at SLA risk" icon={TicketIcon} count={slaTickets.length} action={<CardLink href="/tickets">All tickets</CardLink>}>
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
                  <span className={cn("flex shrink-0 items-center gap-1 text-2xs", sla.state === "breached" ? "font-semibold text-soft-red" : sla.state === "due_soon" ? "font-semibold text-soft-orange" : "text-sg-muted")} title={`Due ${formatDate(t.slaDueAt, "datetime")} WIB`}>
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
          Tickets that have breached or are due within 24 hours appear here, soonest first. Tickets waiting on the customer are paused.
        </EmptyState>
      )}
    </Card>
  );

  const issuesCard = (
    <Card key="issues" title="My sprint work" icon={Kanban} count={myIssues.length} action={<CardLink href="/board">Board</CardLink>}>
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
                      {i.dueDate ? ` · due ${dueLabel(i.dueDate, now)}` : ""}
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
  );

  const prcCard = isPrc ? (
    <Card key="prc" title="Awaiting PRC action" icon={Gavel} count={prcQueue.length} action={<CardLink href="/initiatives">Initiatives</CardLink>}>
      {prcQueue.length ? (
        <ul className="divide-y divide-sg-line">
          {prcQueue.slice(0, 8).map((i) => (
            <li key={i.id}>
              <Link href={`/initiatives/${i.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-sg-card-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-sg-white">{i.title}</div>
                  <div className="truncate text-2xs text-sg-dim">{[i.trackingNo, userMap.get(i.initiatorId)?.name, i.submittedAt ? `submitted ${relativeTime(i.submittedAt, now)}` : ""].filter(Boolean).join(" · ")}</div>
                </div>
                <Chip color="yellow">{titleCase(i.status)}</Chip>
                <span className="hidden w-32 shrink-0 text-right text-2xs font-semibold text-sg-text sm:block">{PRC_ACTION.get(i.status)} →</span>
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
  ) : null;

  const complianceCard =
    isPrc || access.seeAllPay ? (
      <Card key="compliance" title="Live projects — policy compliance" icon={ShieldCheck} count={compliance.length} action={<CardLink href="/projects">Register</CardLink>}>
        {compliance.length ? (
          <ul className="divide-y divide-sg-line">
            {compliance.slice(0, 8).map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-sg-card-2">
                  <Chip color={p.type === "A" ? "magenta" : p.type === "B" ? "cyan" : "green"}>Type {p.type}</Chip>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-sg-white">{p.title}</div>
                    <div className="truncate text-2xs text-sg-dim">{p.first ? `${p.first.label} (§${p.first.cite}) — ${p.first.detail}` : "All register checks pass"}</div>
                  </div>
                  {p.failing ? <Chip color="red">{countLabel(p.failing, "gap")}</Chip> : p.warnings ? <Chip color="yellow">{countLabel(p.warnings, "warning")}</Chip> : <Chip color="green">OK</Chip>}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={ShieldCheck} title="No live projects registered">
            Approved and active projects appear here with their register checks.
          </EmptyState>
        )}
      </Card>
    ) : null;

  const cycleCard =
    access.seeAllPay ? (
      <Card key="cycle" title="Compensation cycles" icon={Wallet} count={runs.length} action={<CardLink href="/compensation">Compensation</CardLink>}>
        <div className="border-b border-sg-line px-4 py-2.5 text-2xs text-sg-muted">
          Cycle <b className="text-sg-white">{cycleMonthNow}</b>: certify the break-even test by <b className="text-sg-white">{formatDate(breakEvenDeadline(cycleMonthNow), "medium")}</b>, pay with salary on <b className="text-sg-white">{formatDate(paymentDate(cycleMonthNow), "medium")}</b> (§8.2).
        </div>
        {runs.length ? (
          <ul className="divide-y divide-sg-line">
            {runs.slice(0, 4).map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="sg-num w-16 shrink-0 text-sm font-semibold text-sg-white">{r.month}</span>
                <Chip color={r.status === "released" ? "green" : r.status === "certified" ? "cyan" : r.status === "failed" ? "red" : "yellow"}>{titleCase(r.status)}</Chip>
                <span className="min-w-0 flex-1 truncate text-2xs text-sg-dim">
                  {r.certifiedAt ? `certified ${formatDate(r.certifiedAt, "short")} by ${userMap.get(r.certifiedById ?? "")?.name.split(" ")[0] ?? "—"}` : "not certified"}
                  {r.releasedAt ? ` · released ${formatDate(r.releasedAt, "short")}` : ""}
                </span>
                <span className="sg-num shrink-0 text-right text-xs text-sg-text" title="Total payable this cycle (aggregate)">
                  {r.totals ? formatIDR(r.totals.payable) : "—"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Wallet} title="No monthly runs yet">
            Runs appear here once Finance records the first cycle.
          </EmptyState>
        )}
      </Card>
    ) : null;

  const resultsCard = <CompanyResults key="results" run={published} />;

  const attentionCard = (
    <Card key="attention" title="Needs your attention" icon={Sparkles} count={attention.length} className="xl:col-span-2">
      {attention.length ? (
        <ul className="divide-y divide-sg-line">
          {attention.slice(0, 8).map((it) => (
            <li key={it.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", it.tone === "red" ? "bg-soft-red/15 text-soft-red" : it.tone === "orange" ? "bg-soft-orange/15 text-soft-orange" : it.tone === "yellow" ? "bg-soft-yellow/15 text-soft-yellow" : "bg-soft-blue/15 text-soft-blue")}>
                <it.icon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                {it.href ? (
                  <Link href={it.href} className="block truncate text-sm font-semibold text-sg-white hover:underline">
                    {it.title}
                  </Link>
                ) : (
                  <div className="truncate text-sm font-semibold text-sg-white">{it.title}</div>
                )}
                <div className="truncate text-2xs text-sg-dim">{it.detail}</div>
              </div>
              {it.action ? (
                <Button size="xs" variant="outline" onClick={it.action.run}>
                  {it.action.label}
                </Button>
              ) : null}
              <button type="button" onClick={() => snooze(it.id)} className="shrink-0 text-2xs text-sg-dim hover:text-sg-white" aria-label={`Hide “${it.title}” until tomorrow`}>
                Later
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Sparkles} title="Nothing needs you right now">
          Late or quiet deals, deals without a next step, tickets about to breach, expiring quotes, cooling contacts and overdue account reviews show up here.
        </EmptyState>
      )}
      {attention.length > 8 && <p className="border-t border-sg-line px-4 py-2 text-2xs text-sg-dim">{attention.length - 8} more — handle the ones above first; the list refreshes as you go.</p>}
    </Card>
  );

  const recentCard = (
    <Card key="recent" title="Recent activity" icon={History} count={recent.length}>
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
  );

  /* card order per persona — the role's own work first */
  const order: Record<Persona, (React.ReactNode | null)[]> = {
    leadership: [attentionCard, prcCard, complianceCard, dealsCard, ticketsCard, cycleCard, resultsCard, tasksCard, issuesCard, recentCard],
    finance: [attentionCard, cycleCard, resultsCard, complianceCard, prcCard, dealsCard, tasksCard, ticketsCard, recentCard],
    hr: [attentionCard, complianceCard, cycleCard, resultsCard, prcCard, tasksCard, recentCard],
    sales: [attentionCard, dealsCard, tasksCard, prcCard, ticketsCard, resultsCard, recentCard],
    service: [attentionCard, ticketsCard, tasksCard, issuesCard, resultsCard, recentCard],
    engineering: [attentionCard, issuesCard, ticketsCard, tasksCard, prcCard, resultsCard, recentCard],
  };
  const cards = order[persona].filter(Boolean);
  // a lone last card spans both columns so the grid has no hole
  const lastSpans = (cards.length - 1) % 2 === 1;

  const summary = [
    overdueTasks ? <span key="o" className="font-semibold text-soft-orange">{countLabel(overdueTasks, "overdue task")}</span> : null,
    <span key="t">{countLabel(myTasks.length, "open task")}</span>,
    persona === "sales" || persona === "leadership" || myDeals.length ? <span key="d">{countLabel(myDeals.length, "deal")} to close</span> : null,
    persona === "service" || persona === "leadership" || slaTickets.length ? <span key="s">{countLabel(slaTickets.length, "ticket")} at SLA risk</span> : null,
    persona === "engineering" || myIssues.length ? <span key="i">{countLabel(myIssues.length, "sprint issue")}</span> : null,
    isPrc ? <span key="p">{countLabel(prcQueue.length, "initiative")} awaiting the PRC</span> : null,
  ].filter(Boolean);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Home" meta={<span className="text-sm text-sg-dim">· {teamView ? "Team" : "My day"}</span>}>
        <div className="flex rounded border border-sg-line p-0.5" role="group" aria-label="Home view">
          {(
            [
              [false, "My day"],
              [true, "Team"],
            ] as const
          ).map(([v, label]) => (
            <button key={label} type="button" aria-pressed={teamView === v} onClick={() => setTeamView(v)} className={cn("h-6 rounded-sm px-2 text-xs font-semibold", teamView === v ? "bg-sg-card-3 text-sg-white" : "text-sg-dim hover:text-sg-white")}>
              {label}
            </button>
          ))}
        </div>
        <Select value={persona} onChange={(e) => pickPersona(e.target.value as Persona)} wrapperClassName="w-44" aria-label="Home layout" title={PERSONAS.find((p) => p.id === persona)?.hint}>
          {PERSONAS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.id === detected ? " (your role)" : ""}
            </option>
          ))}
        </Select>
        <Button variant="outline" size="sm" onClick={() => openDialog({ kind: "logActivity", activityType: "task" })}>
          <Plus /> Task
        </Button>
        <Button variant="primary" size="sm" onClick={() => openDialog({ kind: "createDeal" })}>
          <Plus /> Deal
        </Button>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-sg-line px-5 py-5">
          <div className="sg-eyebrow">
            {formatDate(new Date(now).toISOString(), "long")} · {formatDate(new Date(now).toISOString(), "time")} WIB · {PERSONAS.find((p) => p.id === persona)?.label} view
          </div>
          <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-sg-white">
            {greeting(now)}, {me?.name.split(" ")[0] ?? "there"}
          </h2>
          <p className="mt-1 flex flex-wrap gap-x-1.5 text-sm text-sg-muted">
            {summary.map((s, i) => (
              <span key={i} className="flex gap-1.5">
                {i > 0 ? <span aria-hidden>·</span> : null}
                {s}
              </span>
            ))}
          </p>
        </div>

        {/* KPI strip — six tiles: 2 × 3 on phones, 3 × 2 on tablets, one row on desktop */}
        <div className="grid grid-cols-2 border-b border-sg-line sm:grid-cols-3 xl:grid-cols-6">
          {tiles.map((t) => (
            <Kpi key={t.label} {...t} />
          ))}
        </div>

        {teamView ? (
          <TeamTable rows={team} userMap={userMap} />
        ) : (
          <div className="grid gap-4 p-5 xl:grid-cols-2">
            {cards.map((c, i) => (i === cards.length - 1 && lastSpans ? <div key="last" className="min-w-0 xl:col-span-2 [&>section]:h-full">{c}</div> : c))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── §9.6 company results (aggregate only, every employee) ───────────────────────── */

function CompanyResults({ run }: { run: BonusRun | undefined }) {
  if (!run) {
    return (
      <Card title="Company results" icon={Landmark} action={<Link href="/me/company" className="text-2xs font-semibold text-sg-muted hover:text-sg-white">Company results →</Link>}>
        <EmptyState icon={BarChart3} title="No cycle published yet">
          Each month Finance publishes the company’s revenue, costs, margin and the break-even result here (§9.6).
        </EmptyState>
      </Card>
    );
  }
  const costs = run.directCosts + run.overheads;
  const margin = run.companyRevenue - costs;
  const marginPct = run.companyRevenue ? margin / run.companyRevenue : 0;
  const passed = run.status !== "failed" && run.payoutPct > 0;
  return (
    <Card title={`Company results — ${run.month}`} icon={Landmark} action={<Link href="/me/company" className="text-2xs font-semibold text-sg-muted hover:text-sg-white">§9.6 · details →</Link>}>
      <div className="grid grid-cols-2 gap-px bg-sg-line sm:grid-cols-4">
        <Figure label="Revenue (3 months)" value={formatIDR(run.companyRevenue)} />
        <Figure label="Costs" value={formatIDR(costs)} hint={`direct ${formatIDR(run.directCosts)} · overheads ${formatIDR(run.overheads)}`} />
        <Figure label="Margin" value={formatIDR(margin)} hint={`${(marginPct * 100).toFixed(1)}% of revenue`} tone={margin >= 0 ? "green" : "red"} />
        <Figure label="Break-even test" value={passed ? "Passed" : "Not met"} hint={`${Math.round(run.payoutPct * 100)}% of bonuses released`} tone={passed ? "green" : "red"} />
      </div>
      <p className="flex items-start gap-1.5 px-4 py-2.5 text-2xs text-sg-dim">
        <CircleAlert className="mt-px size-3 shrink-0" />
        {run.status === "released" ? `Released ${formatDate(run.releasedAt, "medium")}.` : run.status === "certified" ? `Certified ${formatDate(run.certifiedAt, "medium")}; release pending.` : "The cycle did not pass — unpaid amounts carry forward (§9.2)."} Individual amounts are only on your own statement in My compensation.
      </p>
    </Card>
  );
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "green" | "red" }) {
  return (
    <div className="bg-sg-card px-4 py-3">
      <div className="sg-eyebrow">{label}</div>
      <div className={cn("sg-num mt-1 font-display text-lg font-extrabold", tone === "green" ? "text-soft-green" : tone === "red" ? "text-soft-red" : "text-sg-white")}>{value}</div>
      {hint ? <div className="truncate text-2xs text-sg-dim">{hint}</div> : null}
    </div>
  );
}

/* ───────────────────────── team view ───────────────────────── */

interface TeamRow {
  user: User;
  calls7: number;
  meetings7: number;
  messages7: number;
  touches30: number;
  tasks: number;
  overdue: number;
  pipeline: number;
  openDeals: number;
  created: number;
  won: number;
  tickets: number;
  breached: number;
}

function TeamTable({ rows, userMap }: { rows: TeamRow[]; userMap: Map<string, User> }) {
  if (!rows.length) {
    return (
      <div className="p-5">
        <EmptyState icon={Users} title="No team activity yet">
          Once people log calls, meetings and deals, their week shows up here.
        </EmptyState>
      </div>
    );
  }
  const th = "whitespace-nowrap border-b border-sg-line px-3 py-2 text-right font-semibold";
  const td = "sg-num border-b border-sg-line px-3 py-2 text-right";
  return (
    <div className="p-5">
      <section className="overflow-hidden rounded-xl border border-sg-line bg-sg-card">
        <header className="flex flex-wrap items-center gap-2 border-b border-sg-line px-4 py-2.5">
          <Users className="size-3.5 text-sg-dim" />
          <h3 className="font-display text-sm font-extrabold text-sg-white">Team this week</h3>
          <span className="text-2xs text-sg-dim">Activity counts are logged calls, meetings, emails and WhatsApp; pipeline and won are deal amounts owned (all pipelines).</span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
            <thead className="text-2xs uppercase tracking-[0.1em] text-sg-dim">
              <tr>
                <th className="border-b border-sg-line px-4 py-2 text-left font-semibold">Person</th>
                <th className={th}>Calls 7d</th>
                <th className={th}>Meetings 7d</th>
                <th className={th}>Emails + WA 7d</th>
                <th className={th}>Touches 30d</th>
                <th className={th}>Open tasks</th>
                <th className={th}>Open pipeline</th>
                <th className={th}>Created this month</th>
                <th className={th}>Won this month</th>
                <th className={th}>Open tickets</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user.id} className="hover:bg-sg-card-2">
                  <td className="border-b border-sg-line px-4 py-2">
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <Avatar user={userMap.get(r.user.id)} size="xs" />
                      <span className="font-semibold text-sg-white">{r.user.name}</span>
                      <span className="text-2xs text-sg-dim">{r.user.team}</span>
                    </span>
                  </td>
                  <td className={td}>{r.calls7 || <span className="text-sg-dim">0</span>}</td>
                  <td className={td}>{r.meetings7 || <span className="text-sg-dim">0</span>}</td>
                  <td className={td}>{r.messages7 || <span className="text-sg-dim">0</span>}</td>
                  <td className={cn(td, r.touches30 ? "text-sg-white" : "text-soft-orange")}>{r.touches30}</td>
                  <td className={td}>
                    {r.tasks}
                    {r.overdue ? <span className="ml-1 text-2xs font-semibold text-soft-red">({r.overdue} late)</span> : null}
                  </td>
                  <td className={td}>
                    {r.pipeline ? formatIDR(r.pipeline) : <span className="text-sg-dim">—</span>}
                    {r.openDeals ? <span className="ml-1 text-2xs text-sg-dim">· {r.openDeals}</span> : null}
                  </td>
                  <td className={td}>{r.created ? formatIDR(r.created) : <span className="text-sg-dim">—</span>}</td>
                  <td className={cn(td, r.won ? "text-soft-green" : undefined)}>{r.won ? formatIDR(r.won) : <span className="text-sg-dim">—</span>}</td>
                  <td className={td}>
                    {r.tickets || <span className="text-sg-dim">0</span>}
                    {r.breached ? <span className="ml-1 text-2xs font-semibold text-soft-red">({r.breached} breached)</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-sg-line px-4 py-2 text-2xs text-sg-dim">{countLabel(rows.length, "person", "people")} with activity, deals or tickets in the last 30 days.</p>
      </section>
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

interface KpiProps {
  label: string;
  /** what the figure covers: "All pipelines", "Workspace", "You", a cycle… */
  scope: string;
  value: string;
  hint?: string;
  tone?: "green" | "red" | "orange";
  href: string;
}

function Kpi({ label, scope, value, hint, tone, href }: KpiProps) {
  return (
    <Link href={href} className="min-w-0 border-b border-r border-sg-line px-5 py-3 hover:bg-sg-card/70 xl:border-b-0 xl:last:border-r-0">
      <div className="flex items-center gap-1.5">
        <span className="sg-eyebrow truncate">{label}</span>
        <span className="shrink-0 rounded-sm bg-sg-card-3 px-1 text-[10px] font-semibold text-sg-muted">{scope}</span>
      </div>
      <div className={cn("sg-num mt-1 truncate font-display text-xl font-extrabold", tone === "green" ? "text-soft-green" : tone === "red" ? "text-soft-red" : tone === "orange" ? "text-soft-orange" : "text-sg-white")}>{value}</div>
      {hint ? <div className="truncate text-2xs text-sg-dim">{hint}</div> : null}
    </Link>
  );
}

function Card({ title, icon: Icon, count, action, children, className }: { title: string; icon: React.ComponentType<{ className?: string }>; count?: number; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col overflow-hidden rounded-xl border border-sg-line bg-sg-card", className)}>
      <header className="flex items-center gap-2 border-b border-sg-line px-4 py-2.5">
        <Icon className="size-3.5 text-sg-dim" />
        <h3 className="truncate font-display text-sm font-extrabold text-sg-white">{title}</h3>
        {typeof count === "number" ? <span className="rounded-sm bg-sg-card-3 px-1.5 text-2xs font-semibold text-sg-muted">{count}</span> : null}
        <div className="ml-auto shrink-0">{action}</div>
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
