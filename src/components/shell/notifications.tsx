"use client";

/*
 * Notification centre, mounted next to the sidebar search. Alerts are derived live from the store for the current
 * user (src/components/me/alerts.ts): sales & service, delivery, programme and pay. Read state and muted categories
 * are remembered per user in localStorage; pay alerts about other people only reach pay roles (useAccess, §13.4).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Ban,
  Banknote,
  BarChart3,
  Bell,
  BellDot,
  CalendarClock,
  CalendarDays,
  Check,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Eye,
  EyeOff,
  FileText,
  Gavel,
  Hourglass,
  Landmark,
  Layers,
  ListChecks,
  ListTodo,
  Receipt,
  RotateCcw,
  Scale,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Target,
  Ticket,
  Timer,
  TrendingDown,
  TrendingUp,
  Undo2,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import { cn, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { ALERT_CATEGORY, CATEGORY_LABEL, deriveAlerts, type Alert, type AlertCategory, type AlertKind, type AlertTone } from "@/components/me/alerts";

const READ_KEY = (userId: string) => `sg-notifications-read:${userId}`;
const MUTE_KEY = (userId: string) => `sg-notifications-muted:${userId}`;
const CATEGORIES: AlertCategory[] = ["sales", "delivery", "programme", "pay"];
/** pay alerts that carry other people's amounts — pay roles only */
const PAY_ROLE_KINDS = new Set<AlertKind>(["break_even", "release"]);

function loadMuted(userId: string): Set<AlertCategory> {
  try {
    const raw = window.localStorage.getItem(MUTE_KEY(userId));
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is AlertCategory => CATEGORIES.includes(x as AlertCategory)) : []);
  } catch {
    return new Set();
  }
}
function saveMuted(userId: string, muted: Set<AlertCategory>) {
  try {
    window.localStorage.setItem(MUTE_KEY(userId), JSON.stringify([...muted]));
  } catch {
    // storage blocked — the choice lasts for this session only
  }
}

function loadRead(userId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(READ_KEY(userId));
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
function saveRead(userId: string, ids: Set<string>) {
  try {
    window.localStorage.setItem(READ_KEY(userId), JSON.stringify([...ids]));
  } catch {
    // storage blocked — read state lasts for this session only
  }
}

const KIND_ICON: Record<AlertKind, React.ComponentType<{ className?: string }>> = {
  prc_review: Gavel,
  sla: Clock,
  consent: FileText,
  vote: Users,
  tie: Scale,
  break_even: Landmark,
  release: Banknote,
  vesting: Hourglass,
  clawback: RotateCcw,
  appeal: Gavel,
  annex_b: ClipboardCheck,
  ticket_sla: Ticket,
  task_due: ListTodo,
  deal_overdue: CalendarClock,
  deal_stale: Timer,
  quote_approval: Receipt,
  issue_assigned: UserCheck,
  issue_due: CalendarDays,
  issue_blocked: Ban,
  status_update: ClipboardList,
  amendment_record: Layers,
  hr: ShieldAlert,
  statement: FileText,
  probation: Hourglass,
  curve: TrendingDown,
  company_summary: BarChart3,
  dispute: Scale,
  quote_expiry: Hourglass,
  account_plan: Target,
  issue_triage: ListChecks,
  coi: ShieldCheck,
  rate_reset: TrendingUp,
  close_out: ClipboardCheck,
  proposal_return: Undo2,
};
const TONE_TEXT: Record<AlertTone, string> = {
  red: "text-soft-red",
  orange: "text-soft-orange",
  yellow: "text-soft-yellow",
  cyan: "text-soft-cyan",
  green: "text-soft-green",
  blue: "text-soft-blue",
};
const TONE_BG: Record<AlertTone, string> = {
  red: "bg-soft-red/15",
  orange: "bg-soft-orange/15",
  yellow: "bg-soft-yellow/15",
  cyan: "bg-soft-cyan/15",
  green: "bg-soft-green/15",
  blue: "bg-soft-blue/15",
};

/** Live alerts for the current user (raw slices selected; derived with useMemo). */
export function useMyAlerts(): Alert[] {
  const userId = useCrm((s) => s.currentUserId);
  const users = useCrm((s) => s.users);
  const profiles = useCrm((s) => s.employeeProfiles);
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const amendments = useCrm((s) => s.teamAmendments);
  const runs = useCrm((s) => s.bonusRuns);
  const deferred = useCrm((s) => s.deferredBonuses);
  const clawbacks = useCrm((s) => s.clawbacks);
  const outcomes = useCrm((s) => s.probationOutcomes);
  const curveAdjustments = useCrm((s) => s.curveAdjustments);
  const summaries = useCrm((s) => s.companySummaries);
  const disputes = useCrm((s) => s.disputes);
  const projectUpdates = useCrm((s) => s.projectUpdates);
  const tickets = useCrm((s) => s.tickets);
  const activities = useCrm((s) => s.activities);
  const deals = useCrm((s) => s.deals);
  const pipelines = useCrm((s) => s.pipelines);
  const quotes = useCrm((s) => s.quotes);
  const issues = useCrm((s) => s.issues);
  const issueLinks = useCrm((s) => s.issueLinks);
  const issueHistory = useCrm((s) => s.issueHistory);
  const projects = useCrm((s) => s.projects);
  const changeOrders = useCrm((s) => s.changeOrders);
  const closeOutReports = useCrm((s) => s.closeOutReports);
  const coiDeclarations = useCrm((s) => s.coiDeclarations);
  const accountPlans = useCrm((s) => s.accountPlans);
  const quoteSettings = useCrm((s) => s.quoteSettings);
  const products = useCrm((s) => s.products);
  const companies = useCrm((s) => s.companies);
  const access = useAccess();
  // re-evaluate time-based alerts (SLA breaches, the 20th / 23rd) every few minutes
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 5 * 60_000);
    return () => window.clearInterval(t);
  }, []);
  return useMemo(
    () =>
      deriveAlerts(
        { userId, users, profiles, initiatives, members, amendments, runs, deferred, clawbacks, outcomes, curveAdjustments, summaries, disputes, projectUpdates, tickets, activities, deals, pipelines, quotes, issues, issueLinks, issueHistory, projects, changeOrders, closeOutReports, coiDeclarations, accountPlans, quoteSettings, products, companies },
        Date.now(),
      ).filter((a) => access.seeAllPay || !PAY_ROLE_KINDS.has(a.kind)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, users, profiles, initiatives, members, amendments, runs, deferred, clawbacks, outcomes, curveAdjustments, summaries, disputes, projectUpdates, tickets, activities, deals, pipelines, quotes, issues, issueLinks, issueHistory, projects, changeOrders, closeOutReports, coiDeclarations, accountPlans, quoteSettings, products, companies, access.seeAllPay, tick],
  );
}

export function NotificationBell({ collapsed }: { collapsed: boolean }) {
  const userId = useCrm((s) => s.currentUserId);
  const setConsent = useCrm((s) => s.setConsent);
  const voteAmendment = useCrm((s) => s.voteAmendment);
  const notify = useUi((s) => s.notify);
  const all = useMyAlerts();
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<Set<string>>(() => new Set());
  const [muted, setMuted] = useState<Set<AlertCategory>>(() => new Set());
  const [tab, setTab] = useState<AlertCategory | "all">("all");

  useEffect(() => {
    setRead(loadRead(userId));
    setMuted(loadMuted(userId));
  }, [userId]);

  const live = useMemo(() => all.filter((a) => !muted.has(ALERT_CATEGORY[a.kind])), [all, muted]);
  const alerts = useMemo(() => (tab === "all" ? live : all.filter((a) => ALERT_CATEGORY[a.kind] === tab)), [tab, live, all]);
  const unreadBy = useMemo(() => {
    const m: Record<AlertCategory, number> = { sales: 0, delivery: 0, programme: 0, pay: 0 };
    for (const a of all) if (!read.has(a.id)) m[ALERT_CATEGORY[a.kind]]++;
    return m;
  }, [all, read]);
  const unread = live.filter((a) => !read.has(a.id)).length;
  const toggleMute = (c: AlertCategory) => {
    const next = new Set(muted);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setMuted(next);
    saveMuted(userId, next);
    notify(next.has(c) ? `${CATEGORY_LABEL[c]} notifications muted — still listed under their tab` : `${CATEGORY_LABEL[c]} notifications back on`);
  };
  const markRead = (ids: string[]) => {
    const current = new Set(all.map((a) => a.id));
    // keep only ids that still exist, so the stored list does not grow forever
    const next = new Set([...read].filter((id) => current.has(id)));
    ids.forEach((id) => next.add(id));
    setRead(next);
    saveRead(userId, next);
  };

  const sign = (a: Alert, consent: "accepted" | "declined") => {
    if (a.action?.type !== "consent") return;
    const id = a.action.memberId;
    setConsent(id, consent);
    notify(consent === "accepted" ? "Role and Weight Agreement signed (§6.7)" : "Role declined — you are not added to the team", { label: "Undo", run: () => setConsent(id, "pending") });
  };
  const vote = (a: Alert, v: "for" | "against") => {
    if (a.action?.type !== "vote") return;
    voteAmendment(a.action.amendmentId, v, userId);
    notify(`Voted ${v} the amendment (§6.8)`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          title={collapsed ? (unread ? `${unread} unread notifications` : "Notifications") : undefined}
          className={cn(
            "relative flex h-8 shrink-0 items-center justify-center rounded border border-sg-line bg-sg-card text-sg-dim transition-colors hover:border-sg-line-2 hover:text-sg-white data-[state=open]:border-sg-line-2 data-[state=open]:text-sg-white",
            collapsed ? "w-full" : "w-8",
          )}
        >
          {unread ? <BellDot className="size-3.5" /> : <Bell className="size-3.5" />}
          {unread > 0 && (
            <span aria-hidden className={cn("absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-soft-red px-1 text-[9px] font-bold leading-none text-sg-bg", collapsed ? "right-0.5 top-0.5" : "-right-1.5 -top-1.5")}>
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(400px,calc(100vw-24px))] p-0">
        <div className="flex items-center gap-2 border-b border-sg-line px-3 py-2">
          <span className="font-display text-sm font-bold text-sg-white">Notifications</span>
          {unread > 0 && <span className="rounded-sm bg-soft-red/15 px-1.5 text-2xs font-semibold text-soft-red">{unread} unread</span>}
          <Button variant="ghost" size="xs" className="ml-auto" disabled={!alerts.some((a) => !read.has(a.id))} onClick={() => markRead(alerts.map((a) => a.id))}>
            <Check /> Mark all read
          </Button>
          <Menu>
            <MenuTrigger asChild>
              <button type="button" aria-label="Notification settings" className="rounded p-1 text-sg-dim hover:bg-sg-card-3 hover:text-sg-white">
                <Settings className="size-3.5" />
              </button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuLabel>Show in the badge</MenuLabel>
              {CATEGORIES.map((c) => (
                <MenuItem key={c} onSelect={() => toggleMute(c)}>
                  {muted.has(c) ? <EyeOff className="size-3.5 text-sg-dim" /> : <Eye className="size-3.5 text-soft-green" />} {CATEGORY_LABEL[c]}
                  <span className="ml-auto pl-3 text-2xs text-sg-dim">{muted.has(c) ? "muted" : "on"}</span>
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        </div>
        <div role="tablist" aria-label="Notification categories" className="flex gap-1 overflow-x-auto border-b border-sg-line px-2 py-1.5">
          {(["all", ...CATEGORIES] as const).map((c) => {
            const n = c === "all" ? unread : unreadBy[c];
            return (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={tab === c}
                onClick={() => setTab(c)}
                className={cn("flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-2xs font-semibold transition-colors", tab === c ? "bg-sg-card-3 text-sg-white" : "text-sg-dim hover:text-sg-white", c !== "all" && muted.has(c) && "line-through decoration-sg-dim")}
              >
                {c === "all" ? "All" : CATEGORY_LABEL[c]}
                {n > 0 && <span className="sg-num rounded-sm bg-soft-red/15 px-1 text-soft-red">{n}</span>}
              </button>
            );
          })}
        </div>
        <div className="max-h-[min(520px,70vh)] overflow-y-auto">
          {alerts.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Bell className="mx-auto size-5 text-sg-dim" />
              <p className="mt-2 font-display text-sm font-bold text-sg-white">You&apos;re all caught up</p>
              <p className="mt-0.5 text-2xs text-sg-muted">
                {tab === "all" ? "Tickets, tasks, deals, issues, sign requests, votes, disputes, PRC queues and payment deadlines for you appear here." : `Nothing in ${CATEGORY_LABEL[tab]}.`}
                {tab === "all" && muted.size > 0 ? ` ${[...muted].map((c) => CATEGORY_LABEL[c]).join(", ")} muted — open the tab to see them.` : ""}
              </p>
            </div>
          ) : (
            <ul>
              {alerts.map((a) => {
                const Icon = KIND_ICON[a.kind];
                const isRead = read.has(a.id);
                return (
                  <li key={a.id} className={cn("border-b border-sg-line last:border-b-0", isRead && "opacity-60")}>
                    <div className="flex gap-2.5 px-3 py-2.5">
                      <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", TONE_BG[a.tone], TONE_TEXT[a.tone])}>
                        <Icon className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={a.href}
                          onClick={() => {
                            markRead([a.id]);
                            setOpen(false);
                          }}
                          className="block rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sg-white/60"
                        >
                          <span className="flex items-start gap-1.5">
                            {!isRead && <span aria-label="Unread" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-soft-red" />}
                            <span className="text-xs font-semibold leading-snug text-sg-white">{a.title}</span>
                          </span>
                        </Link>
                        <p className="mt-0.5 text-2xs leading-snug text-sg-muted">{a.detail}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-sg-dim">
                          <span className="rounded-sm border border-sg-line px-1 font-semibold">{/^[\dA-Z]/.test(a.cite) && /\d/.test(a.cite) ? `§${a.cite}` : a.cite}</span>
                          <span>{CATEGORY_LABEL[ALERT_CATEGORY[a.kind]]}</span>
                          {a.at && <span>{Date.parse(a.at) >= Date.now() ? `due ${relativeTime(a.at)}` : relativeTime(a.at)}</span>}
                          {!isRead && (
                            <button type="button" onClick={() => markRead([a.id])} className="ml-auto rounded px-1 hover:bg-sg-card-3 hover:text-sg-white">
                              Mark read
                            </button>
                          )}
                        </div>
                        {a.action?.type === "consent" && (
                          <div className="mt-1.5 flex gap-1.5">
                            <Button size="xs" variant="primary" onClick={() => sign(a, "accepted")}>
                              <Check /> Sign
                            </Button>
                            <Button size="xs" variant="danger" onClick={() => sign(a, "declined")}>
                              <X /> Decline
                            </Button>
                          </div>
                        )}
                        {a.action?.type === "vote" && (
                          <div className="mt-1.5 flex gap-1.5">
                            <Button size="xs" variant="primary" onClick={() => vote(a, "for")}>
                              <Check /> Vote for
                            </Button>
                            <Button size="xs" variant="outline" onClick={() => vote(a, "against")}>
                              <X /> Vote against
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-sg-line px-3 py-1.5 text-2xs">
          <Link href="/me" onClick={() => setOpen(false)} className="font-semibold text-sg-muted hover:text-sg-white">
            My compensation →
          </Link>
          <Link href="/disputes" onClick={() => setOpen(false)} className="text-sg-dim hover:text-sg-white">
            Disputes
          </Link>
          <Link href="/policy" onClick={() => setOpen(false)} className="text-sg-dim hover:text-sg-white">
            Policy v4.0
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
