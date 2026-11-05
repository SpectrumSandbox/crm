"use client";

import { useMemo } from "react";
import { useCrm } from "./store";
import { slaRemainingMs } from "./slices/crm-service";
import type { Activity, Company, Contact, CrmObjectType, CrossLink, Deal, Epic, Issue, PipelineStage, Quote, Ticket } from "./types";

/** stage id → stage, across all pipelines */
export function useStageMap() {
  const pipelines = useCrm((s) => s.pipelines);
  return useMemo(() => new Map<string, PipelineStage & { pipelineId: string }>(pipelines.flatMap((p) => p.stages.map((s) => [s.id, { ...s, pipelineId: p.id }] as const))), [pipelines]);
}

export function useUserMap() {
  const users = useCrm((s) => s.users);
  return useMemo(() => new Map(users.map((u) => [u.id, u] as const)), [users]);
}

export function useCompanyMap() {
  const companies = useCrm((s) => s.companies);
  return useMemo(() => new Map(companies.map((c) => [c.id, c] as const)), [companies]);
}

export function isOpenStage(stage: PipelineStage | undefined) {
  return !!stage && !stage.closed;
}

export interface Associations {
  contacts: Contact[];
  companies: Company[];
  deals: Deal[];
  tickets: Ticket[];
  quotes: Quote[];
  links: (CrossLink & { issue?: Issue; epic?: Epic })[];
}

/** HubSpot-style association graph for any CRM record, including linked Jira work. */
export function useAssociations(type: CrmObjectType, id: string): Associations {
  const contacts = useCrm((s) => s.contacts);
  const companies = useCrm((s) => s.companies);
  const deals = useCrm((s) => s.deals);
  const tickets = useCrm((s) => s.tickets);
  const quotes = useCrm((s) => s.quotes);
  const crossLinks = useCrm((s) => s.crossLinks);
  const issues = useCrm((s) => s.issues);
  const epics = useCrm((s) => s.epics);

  return useMemo(() => {
    let aContacts: Contact[] = [];
    let aCompanies: Company[] = [];
    let aDeals: Deal[] = [];
    let aTickets: Ticket[] = [];

    if (type === "contact") {
      const c = contacts.find((x) => x.id === id);
      aCompanies = companies.filter((x) => x.id === c?.companyId);
      aDeals = deals.filter((d) => d.contactIds.includes(id));
      aTickets = tickets.filter((t) => t.contactId === id);
    } else if (type === "company") {
      const childIds = companies.filter((x) => x.parentId === id).map((x) => x.id);
      const parent = companies.find((x) => x.id === companies.find((c) => c.id === id)?.parentId);
      aCompanies = [...(parent ? [parent] : []), ...companies.filter((x) => childIds.includes(x.id))];
      aContacts = contacts.filter((x) => x.companyId === id);
      aDeals = deals.filter((d) => d.companyId === id);
      aTickets = tickets.filter((t) => t.companyId === id);
    } else if (type === "deal") {
      const d = deals.find((x) => x.id === id);
      aContacts = contacts.filter((x) => d?.contactIds.includes(x.id));
      aCompanies = companies.filter((x) => x.id === d?.companyId);
      aTickets = tickets.filter((t) => t.companyId && t.companyId === d?.companyId && !t.closedAt);
    } else {
      const t = tickets.find((x) => x.id === id);
      aContacts = contacts.filter((x) => x.id === t?.contactId);
      aCompanies = companies.filter((x) => x.id === t?.companyId);
      aDeals = deals.filter((d) => d.companyId && d.companyId === t?.companyId);
    }

    const dealIds = new Set(type === "deal" ? [id] : aDeals.map((d) => d.id));
    const aQuotes = quotes.filter((q) => dealIds.has(q.dealId));
    const links = crossLinks
      .filter((x) => x.crmType === type && x.crmId === id)
      .map((x) => ({ ...x, issue: x.agileType === "issue" ? issues.find((i) => i.id === x.agileId) : undefined, epic: x.agileType === "epic" ? epics.find((e) => e.id === x.agileId) : undefined }))
      .filter((x) => x.issue || x.epic);

    return { contacts: aContacts, companies: aCompanies, deals: aDeals, tickets: aTickets, quotes: aQuotes, links };
  }, [type, id, contacts, companies, deals, tickets, quotes, crossLinks, issues, epics]);
}

/** Timeline items for a record: anything whose links include it (plus company roll-up of its contacts). */
export function useTimeline(type: CrmObjectType, id: string): Activity[] {
  const activities = useCrm((s) => s.activities);
  const contacts = useCrm((s) => s.contacts);
  return useMemo(() => {
    const companyContactIds = type === "company" ? new Set(contacts.filter((c) => c.companyId === id).map((c) => c.id)) : null;
    return activities
      .filter((a) => {
        if (type === "contact") return a.links.contactIds.includes(id);
        if (type === "deal") return a.links.dealIds.includes(id);
        if (type === "ticket") return a.links.ticketIds.includes(id);
        return a.links.companyIds.includes(id) || (companyContactIds !== null && a.links.contactIds.some((c) => companyContactIds.has(c)));
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [activities, contacts, type, id]);
}

/** CRM records linked to an issue/epic */
export function useLinksForAgile(agileType: "issue" | "epic", agileId: string) {
  const crossLinks = useCrm((s) => s.crossLinks);
  const contacts = useCrm((s) => s.contacts);
  const companies = useCrm((s) => s.companies);
  const deals = useCrm((s) => s.deals);
  const tickets = useCrm((s) => s.tickets);
  return useMemo(
    () =>
      crossLinks
        .filter((x) => x.agileType === agileType && x.agileId === agileId)
        .map((x) => {
          let label = "";
          let sub = "";
          let href = "";
          if (x.crmType === "deal") {
            const d = deals.find((r) => r.id === x.crmId);
            label = d?.name ?? "";
            href = `/deals/${x.crmId}`;
            sub = d ? `${companies.find((c) => c.id === d.companyId)?.name ?? ""}` : "";
          } else if (x.crmType === "ticket") {
            const t = tickets.find((r) => r.id === x.crmId);
            label = t?.subject ?? "";
            href = `/tickets/${x.crmId}`;
            sub = x.crmId.toUpperCase();
          } else if (x.crmType === "company") {
            const c = companies.find((r) => r.id === x.crmId);
            label = c?.name ?? "";
            href = `/companies/${x.crmId}`;
            sub = c?.domain ?? "";
          } else {
            const c = contacts.find((r) => r.id === x.crmId);
            label = c ? `${c.firstName} ${c.lastName}` : "";
            href = `/contacts/${x.crmId}`;
            sub = c?.jobTitle ?? "";
          }
          return { ...x, label, sub, href };
        })
        .filter((x) => x.label),
    [crossLinks, agileType, agileId, contacts, companies, deals, tickets],
  );
}

/* ───────────────────────── record navigation & ticket helpers ───────────────────────── */

/**
 * Ids of every record of a type, sorted the way its default list is:
 * contacts by lead score (desc), companies by name (children under their parent),
 * deals by close date, tickets by SLA due.
 */
export function useRecordSequence(type: CrmObjectType): string[] {
  const contacts = useCrm((s) => s.contacts);
  const companies = useCrm((s) => s.companies);
  const deals = useCrm((s) => s.deals);
  const tickets = useCrm((s) => s.tickets);
  return useMemo(() => {
    if (type === "contact") {
      return [...contacts]
        .sort((a, b) => b.leadScore - a.leadScore || `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`))
        .map((c) => c.id);
    }
    if (type === "company") {
      const byId = new Map(companies.map((c) => [c.id, c] as const));
      const key = (c: Company) => (c.parentId ? `${byId.get(c.parentId)?.name ?? ""} ~ ${c.name}` : c.name).toLowerCase();
      return [...companies].sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0)).map((c) => c.id);
    }
    if (type === "deal") return [...deals].sort((a, b) => a.closeDate.localeCompare(b.closeDate) || a.name.localeCompare(b.name)).map((d) => d.id);
    return [...tickets].sort((a, b) => a.slaDueAt.localeCompare(b.slaDueAt) || a.id.localeCompare(b.id)).map((t) => t.id);
  }, [type, contacts, companies, deals, tickets]);
}

/* ───────────────────────── Jira escalations on tickets ───────────────────────── */

/** link types that mean "engineering is working this ticket" (not a loose relates_to) */
const ESCALATION_LINKS = new Set(["escalated_from", "blocks", "blocked_by"]);

export interface TicketEscalation {
  /** escalation issues still open */
  open: number;
  /** escalation issues already done */
  done: number;
  /** keys of the escalation issues, open first */
  keys: string[];
}

/** ticket id → escalation detail (escalated_from / blocks links to issues or epics) */
export function useTicketEscalationInfo() {
  const crossLinks = useCrm((s) => s.crossLinks);
  const issues = useCrm((s) => s.issues);
  const epics = useCrm((s) => s.epics);
  return useMemo(() => {
    const issueMap = new Map(issues.map((i) => [i.id, i] as const));
    const epicMap = new Map(epics.map((e) => [e.id, e] as const));
    const m = new Map<string, TicketEscalation>();
    crossLinks.forEach((x) => {
      if (x.crmType !== "ticket" || !ESCALATION_LINKS.has(x.linkType)) return;
      const target = x.agileType === "issue" ? issueMap.get(x.agileId) : epicMap.get(x.agileId);
      if (!target) return;
      const e = m.get(x.crmId) ?? { open: 0, done: 0, keys: [] };
      if (target.status === "done") {
        e.done += 1;
        e.keys.push(target.key);
      } else {
        e.open += 1;
        e.keys.unshift(target.key);
      }
      m.set(x.crmId, e);
    });
    return m;
  }, [crossLinks, issues, epics]);
}

/** ticket id → number of OPEN Jira escalations (escalated_from / blocks links whose issue is not done) */
export function useTicketEscalations() {
  const info = useTicketEscalationInfo();
  return useMemo(() => {
    const m = new Map<string, number>();
    info.forEach((e, id) => e.open && m.set(id, e.open));
    return m;
  }, [info]);
}

/* ───────────────────────── SLA business hours (logic lives in the service slice; re-exported for the UI) ───────────────────────── */

export { BUSINESS_HOURS, SLA_POLICY, addBusinessMs, businessMsBetween, isServiceDay, resumedSlaDue, slaDueFor, slaRemainingMs, type SlaPolicy } from "./slices/crm-service";
export { holidayOn } from "./calendar";

const HOUR = 3_600_000;
const DAY_MS = 24 * HOUR;

export type SlaState = "met" | "late" | "breached" | "due_soon" | "on_track" | "paused";

const spanLabel = (ms: number) => {
  const abs = Math.abs(ms);
  return abs < HOUR ? `${Math.max(1, Math.round(abs / 60_000))}m` : abs < 48 * HOUR ? `${Math.round(abs / HOUR)}h` : `${Math.round(abs / DAY_MS)}d`;
};

/**
 * SLA health of a ticket: breached (red), < 12h left (orange), otherwise on track; "paused" while waiting on the
 * customer (the clock is frozen); closed tickets are "met" or "late".
 */
export function ticketSla(t: Pick<Ticket, "slaDueAt" | "closedAt"> & Partial<Pick<Ticket, "slaPausedAt" | "slaBasis">>, now = Date.now()): { state: SlaState; hoursLeft: number; label: string } {
  const due = Date.parse(t.slaDueAt);
  if (t.closedAt) {
    const late = Date.parse(t.closedAt) > due;
    return { state: late ? "late" : "met", hoursLeft: (due - Date.parse(t.closedAt)) / HOUR, label: late ? `Closed ${spanLabel(Date.parse(t.closedAt) - due)} late` : "SLA met" };
  }
  if (t.slaPausedAt) {
    const left = slaRemainingMs(t, Date.parse(t.slaPausedAt));
    return { state: "paused", hoursLeft: left / HOUR, label: left < 0 ? `Paused · breached ${spanLabel(left)} before` : `Paused · ${spanLabel(left)}${t.slaBasis === "business" ? " business" : ""} left` };
  }
  const ms = due - now;
  const hoursLeft = ms / HOUR;
  if (ms < 0) return { state: "breached", hoursLeft, label: `Breached ${spanLabel(ms)} ago` };
  return { state: hoursLeft < 12 ? "due_soon" : "on_track", hoursLeft, label: `${spanLabel(ms)} left` };
}

/* ───────────────────────── engagement / relationship strength ───────────────────────── */

export type Strength = "strong" | "medium" | "weak" | "none";

export interface Engagement {
  lastAt: string | null;
  /** next scheduled touch: open task due date or a future meeting */
  nextAt: string | null;
  touches30: number;
  touches90: number;
  /** recency-weighted score (meeting 3 · connected call 2 · email/WhatsApp 1, halving every ~30 days) */
  score: number;
  strength: Strength;
  /** team member with the strongest relationship (highest weighted touches) */
  strongestUserId: string | null;
}

export const strengthMeta: Record<Strength, { label: string; color: "green" | "yellow" | "orange" | "blue" }> = {
  strong: { label: "Strong", color: "green" },
  medium: { label: "Medium", color: "yellow" },
  weak: { label: "Weak", color: "orange" },
  none: { label: "No contact", color: "blue" },
};

const isWhatsApp = (a: Activity) => a.type === "note" && /^whatsapp\b/i.test(a.subject);

function touchWeight(a: Activity) {
  if (a.type === "meeting") return 3;
  if (a.type === "call") return a.callOutcome === "connected" || !a.callOutcome ? 2 : 0.5;
  if (a.type === "email") return a.direction === "inbound" ? 1.5 : 1;
  if (isWhatsApp(a)) return 1;
  return 0;
}

function emptyEngagement(): Engagement {
  return { lastAt: null, nextAt: null, touches30: 0, touches90: 0, score: 0, strength: "none", strongestUserId: null };
}

function finish(e: Engagement, byUser: Map<string, number>) {
  e.strength = e.score >= 6 ? "strong" : e.score >= 2.5 ? "medium" : e.score > 0 ? "weak" : "none";
  let best: [string, number] | null = null;
  byUser.forEach((v, k) => {
    if (!best || v > best[1]) best = [k, v];
  });
  e.strongestUserId = best ? (best as [string, number])[0] : null;
  e.score = Math.round(e.score * 10) / 10;
  return e;
}

/** per-contact and per-company engagement derived from the timeline (plus each contact's last-contacted stamp) */
export function computeEngagement(activities: Activity[], contacts: Contact[], now = Date.now()) {
  const contactAcc = new Map<string, { e: Engagement; byUser: Map<string, number> }>();
  const companyAcc = new Map<string, { e: Engagement; byUser: Map<string, number> }>();
  const companyOf = new Map(contacts.map((c) => [c.id, c.companyId] as const));
  const acc = (m: typeof contactAcc, id: string) => {
    let v = m.get(id);
    if (!v) {
      v = { e: emptyEngagement(), byUser: new Map() };
      m.set(id, v);
    }
    return v;
  };
  const apply = (v: { e: Engagement; byUser: Map<string, number> }, a: Activity, w: number) => {
    const t = Date.parse(a.timestamp);
    if (t > now) return;
    const age = now - t;
    if (!v.e.lastAt || a.timestamp > v.e.lastAt) v.e.lastAt = a.timestamp;
    if (age <= 30 * DAY_MS) v.e.touches30 += 1;
    if (age <= 90 * DAY_MS) v.e.touches90 += 1;
    const decayed = w * Math.pow(0.5, age / (30 * DAY_MS));
    v.e.score += decayed;
    v.byUser.set(a.ownerId, (v.byUser.get(a.ownerId) ?? 0) + decayed);
  };
  const scheduleNext = (v: { e: Engagement }, at: string) => {
    if (!v.e.nextAt || at < v.e.nextAt) v.e.nextAt = at;
  };

  activities.forEach((a) => {
    const companies = new Set(a.links.companyIds);
    a.links.contactIds.forEach((cid) => {
      const co = companyOf.get(cid);
      if (co) companies.add(co);
    });
    const future = Date.parse(a.timestamp) > now;
    const nextAt = a.type === "task" && !a.done && a.dueAt && Date.parse(a.dueAt) >= now - DAY_MS ? a.dueAt : a.type === "meeting" && future ? a.timestamp : null;
    if (nextAt) {
      a.links.contactIds.forEach((cid) => scheduleNext(acc(contactAcc, cid), nextAt));
      companies.forEach((co) => scheduleNext(acc(companyAcc, co), nextAt));
    }
    const w = touchWeight(a);
    if (!w) return;
    a.links.contactIds.forEach((cid) => apply(acc(contactAcc, cid), a, w));
    companies.forEach((co) => apply(acc(companyAcc, co), a, w));
  });

  // contacts whose last touch predates the timeline still count once, at their last-contacted date
  contacts.forEach((c) => {
    if (!c.lastContactedAt) return;
    const v = acc(contactAcc, c.id);
    if (v.e.lastAt && v.e.lastAt >= c.lastContactedAt) return;
    const pseudo = { type: "email", timestamp: c.lastContactedAt, ownerId: c.ownerId } as Activity;
    apply(v, pseudo, 1);
    if (c.companyId) apply(acc(companyAcc, c.companyId), pseudo, 1);
  });

  const byContact = new Map<string, Engagement>();
  contactAcc.forEach((v, id) => byContact.set(id, finish(v.e, v.byUser)));
  const byCompany = new Map<string, Engagement>();
  companyAcc.forEach((v, id) => byCompany.set(id, finish(v.e, v.byUser)));
  return { byContact, byCompany };
}

/** engagement per contact and company — recomputed at most once a minute */
export function useEngagement() {
  const activities = useCrm((s) => s.activities);
  const contacts = useCrm((s) => s.contacts);
  const minute = Math.floor(Date.now() / 60_000);
  return useMemo(() => computeEngagement(activities, contacts, minute * 60_000), [activities, contacts, minute]);
}

/* ───────────────────────── account hierarchy roll-ups ───────────────────────── */

export interface GroupRollup {
  /** the company plus every descendant business unit */
  unitIds: string[];
  openPipeline: number;
  openDeals: number;
  /** won in the trailing twelve months (by close date) */
  wonTtm: number;
  openTickets: number;
  breaches: number;
  /** most recent engagement across the group */
  lastAt: string | null;
  /** average CSAT of resolved tickets across the group, or null */
  csat: number | null;
  csatCount: number;
}

/** company id → descendants (children, grandchildren…) */
export function descendantsOf(companies: Company[], id: string): string[] {
  const kids = new Map<string, string[]>();
  companies.forEach((c) => c.parentId && kids.set(c.parentId, [...(kids.get(c.parentId) ?? []), c.id]));
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const walk = (x: string) =>
    (kids.get(x) ?? []).forEach((k) => {
      if (seen.has(k)) return;
      seen.add(k);
      out.push(k);
      walk(k);
    });
  walk(id);
  return out;
}

/** own figures (`self`) and whole-group figures (`group`) for every company */
export function useGroupRollups() {
  const companies = useCrm((s) => s.companies);
  const deals = useCrm((s) => s.deals);
  const tickets = useCrm((s) => s.tickets);
  const pipelines = useCrm((s) => s.pipelines);
  const engagement = useEngagement();
  const minute = Math.floor(Date.now() / 60_000);
  return useMemo(() => {
    const now = minute * 60_000;
    const stages = new Map(pipelines.flatMap((p) => p.stages.map((st) => [st.id, st] as const)));
    const own = new Map<string, Omit<GroupRollup, "unitIds">>();
    const blank = (): Omit<GroupRollup, "unitIds"> => ({ openPipeline: 0, openDeals: 0, wonTtm: 0, openTickets: 0, breaches: 0, lastAt: null, csat: null, csatCount: 0 });
    companies.forEach((c) => own.set(c.id, { ...blank(), lastAt: engagement.byCompany.get(c.id)?.lastAt ?? null }));
    const csatSum = new Map<string, number>();
    deals.forEach((d) => {
      const r = d.companyId ? own.get(d.companyId) : undefined;
      if (!r) return;
      const st = stages.get(d.stageId);
      if (!st?.closed) {
        r.openPipeline += d.amount;
        r.openDeals += 1;
      } else if (st.closed === "won" && now - Date.parse(d.closeDate) <= 365 * DAY_MS) r.wonTtm += d.amount;
    });
    tickets.forEach((t) => {
      const r = t.companyId ? own.get(t.companyId) : undefined;
      if (!r) return;
      const closed = !!t.closedAt || !!stages.get(t.stageId)?.closed;
      if (!closed) {
        r.openTickets += 1;
        if (ticketSla(t, now).state === "breached") r.breaches += 1;
      }
      if (typeof t.csat === "number") {
        csatSum.set(t.companyId!, (csatSum.get(t.companyId!) ?? 0) + t.csat);
        r.csatCount += 1;
      }
    });
    own.forEach((r, id) => (r.csat = r.csatCount ? (csatSum.get(id) ?? 0) / r.csatCount : null));

    const self = new Map<string, GroupRollup>();
    const group = new Map<string, GroupRollup>();
    companies.forEach((c) => {
      const mine = own.get(c.id)!;
      self.set(c.id, { ...mine, unitIds: [c.id] });
      const unitIds = [c.id, ...descendantsOf(companies, c.id)];
      const g: GroupRollup = { ...blank(), unitIds };
      let sum = 0;
      unitIds.forEach((u) => {
        const r = own.get(u);
        if (!r) return;
        g.openPipeline += r.openPipeline;
        g.openDeals += r.openDeals;
        g.wonTtm += r.wonTtm;
        g.openTickets += r.openTickets;
        g.breaches += r.breaches;
        if (r.lastAt && (!g.lastAt || r.lastAt > g.lastAt)) g.lastAt = r.lastAt;
        sum += csatSum.get(u) ?? 0;
        g.csatCount += r.csatCount;
      });
      g.csat = g.csatCount ? sum / g.csatCount : null;
      group.set(c.id, g);
    });
    return { self, group };
  }, [companies, deals, tickets, pipelines, engagement, minute]);
}
