"use client";

/*
 * Notification centre (programme workstream), mounted next to the sidebar search. Alerts are derived live from the
 * store for the current user (src/components/me/alerts.ts); read state is remembered per user in localStorage.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Banknote, Bell, BellDot, Check, ClipboardCheck, Clock, FileText, Gavel, Hourglass, Landmark, RotateCcw, Scale, Users, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { cn, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { deriveAlerts, type Alert, type AlertKind, type AlertTone } from "@/components/me/alerts";

const READ_KEY = (userId: string) => `sg-notifications-read:${userId}`;

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
  // re-evaluate time-based alerts (SLA breaches, the 20th / 23rd) every few minutes
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 5 * 60_000);
    return () => window.clearInterval(t);
  }, []);
  return useMemo(
    () => deriveAlerts({ userId, users, profiles, initiatives, members, amendments, runs, deferred, clawbacks }, Date.now()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, users, profiles, initiatives, members, amendments, runs, deferred, clawbacks, tick],
  );
}

export function NotificationBell({ collapsed }: { collapsed: boolean }) {
  const userId = useCrm((s) => s.currentUserId);
  const setConsent = useCrm((s) => s.setConsent);
  const voteAmendment = useCrm((s) => s.voteAmendment);
  const notify = useUi((s) => s.notify);
  const alerts = useMyAlerts();
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<Set<string>>(() => new Set());

  useEffect(() => setRead(loadRead(userId)), [userId]);

  const unread = alerts.filter((a) => !read.has(a.id)).length;
  const markRead = (ids: string[]) => {
    const current = new Set(alerts.map((a) => a.id));
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
          <Button variant="ghost" size="xs" className="ml-auto" disabled={!unread} onClick={() => markRead(alerts.map((a) => a.id))}>
            <Check /> Mark all read
          </Button>
        </div>
        <div className="max-h-[min(520px,70vh)] overflow-y-auto">
          {alerts.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Bell className="mx-auto size-5 text-sg-dim" />
              <p className="mt-2 font-display text-sm font-bold text-sg-white">You&apos;re all caught up</p>
              <p className="mt-0.5 text-2xs text-sg-muted">Sign requests, votes, PRC queues and payment deadlines for you appear here.</p>
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
                          <span className="rounded-sm border border-sg-line px-1 font-semibold">§{a.cite}</span>
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
          <Link href="/policy" onClick={() => setOpen(false)} className="text-sg-dim hover:text-sg-white">
            Policy v4.0
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
