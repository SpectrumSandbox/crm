/* Store slice "CrmExtras" — state + actions mixed into useCrm. Owned by the CRM experience workstream. */
import type { CrmState } from "../store";
import type { Activity, ActivityLinks, Ticket, TicketPriority } from "../types";
import type { GetFn, SetFn, Uid } from "./types";

/* ───────────────────────── delete snapshots (undo) ───────────────────────── */

/** collections a delete can touch; restoring a snapshot puts every one back exactly */
type SnapCollection = "contacts" | "deals" | "tickets" | "activities" | "crossLinks" | "lineItems" | "quotes" | "sequenceEnrollments" | "initiatives";

interface CollectionDiff<T> {
  /** records removed, with their original index so they go back in the same place */
  removed: { index: number; item: T }[];
  /** previous versions of records that were modified (references stripped) */
  changed: T[];
}

type ElementOf<A> = A extends (infer E)[] ? E : never;

export interface DeleteSnapshot {
  kind: "contact" | "deal";
  id: string;
  label: string;
  diffs: { [K in SnapCollection]?: CollectionDiff<ElementOf<CrmState[K]>> };
  /** human summary of what was removed, e.g. "2 deals updated · 5 activities removed" */
  summary: string[];
}

function diffOut<T extends { id: string }>(arr: T[], remove: (x: T) => boolean, change: (x: T) => T | null) {
  const diff: CollectionDiff<T> = { removed: [], changed: [] };
  const next: T[] = [];
  arr.forEach((x, index) => {
    if (remove(x)) {
      diff.removed.push({ index, item: x });
      return;
    }
    const changed = change(x);
    if (changed) {
      diff.changed.push(x);
      next.push(changed);
    } else next.push(x);
  });
  return { next, diff, touched: diff.removed.length + diff.changed.length > 0 };
}

function diffIn<T extends { id: string }>(arr: T[], diff: CollectionDiff<T> | undefined): T[] {
  if (!diff) return arr;
  const prev = new Map(diff.changed.map((x) => [x.id, x] as const));
  const out = arr.map((x) => prev.get(x.id) ?? x);
  const present = new Set(out.map((x) => x.id));
  [...diff.removed]
    .sort((a, b) => a.index - b.index)
    .forEach(({ index, item }) => {
      if (present.has(item.id)) return;
      out.splice(Math.min(index, out.length), 0, item);
      present.add(item.id);
    });
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const linkCount = (l: ActivityLinks) => l.contactIds.length + l.companyIds.length + l.dealIds.length + l.ticketIds.length;

/* ───────────────────────── tickets ───────────────────────── */

export interface NewTicketInput {
  subject: string;
  description: string;
  companyId: string | null;
  contactId: string | null;
  priority: TicketPriority;
  category: Ticket["category"];
  ownerId: string;
  /** defaults to the Field Support pipeline */
  pipelineId?: string;
  /** defaults to the pipeline's first stage */
  stageId?: string;
  /** defaults by priority — see defaultSlaDue */
  slaDueAt?: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WIB = 7 * HOUR;

/** add n business days (Mon–Fri, WIB calendar), keeping the time of day */
export function addBusinessDaysWib(fromMs: number, n: number) {
  let t = fromMs;
  let left = n;
  while (left > 0) {
    t += DAY;
    const dow = new Date(t + WIB).getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return t;
}

/** SLA response targets: urgent 4h · high 24h · medium 3 business days · low 7 days */
export const SLA_TARGETS: Record<TicketPriority, string> = {
  urgent: "4 hours",
  high: "24 hours",
  medium: "3 business days",
  low: "7 days",
};

export function defaultSlaDue(priority: TicketPriority, from = Date.now()) {
  const t = priority === "urgent" ? from + 4 * HOUR : priority === "high" ? from + 24 * HOUR : priority === "medium" ? addBusinessDaysWib(from, 3) : from + 7 * DAY;
  return new Date(t).toISOString();
}

/* ───────────────────────── slice ───────────────────────── */

export interface CrmExtrasSlice {
  /** open a support ticket and log it on the company / contact timeline; returns the ticket id */
  createTicket: (input: NewTicketInput) => string;
  /** move a ticket between pipeline stages (sets/clears closedAt) and log the change */
  moveTicket: (id: string, stageId: string) => void;
  /** delete a contact and strip it from deals, tickets, Jira links, activities and sequences */
  deleteContact: (id: string) => DeleteSnapshot | null;
  /** delete a deal with its line items, quotes and Jira links; strip it from activities and initiatives */
  deleteDeal: (id: string) => DeleteSnapshot | null;
  /** put back everything a delete removed or changed */
  restoreSnapshot: (snapshot: DeleteSnapshot) => void;
}

type Needs = Pick<CrmState, SnapCollection | "pipelines" | "currentUserId" | "addActivity" | "companies">;

export function createCrmExtrasSlice<S extends CrmExtrasSlice & Needs>(set: SetFn<S>, get: GetFn<S>, _uid: Uid): CrmExtrasSlice {
  const nowIso = () => new Date().toISOString();

  /** strip an id from activity links; activities left pointing at nothing are removed */
  const stripActivities = (key: keyof ActivityLinks, id: string) =>
    diffOut<Activity>(
      get().activities,
      (a) => a.links[key].includes(id) && linkCount(a.links) === 1,
      (a) => (a.links[key].includes(id) ? { ...a, links: { ...a.links, [key]: a.links[key].filter((x) => x !== id) } } : null),
    );

  return {
    createTicket: (input) => {
      const s = get();
      const pipeline = s.pipelines.find((p) => p.id === input.pipelineId) ?? s.pipelines.find((p) => p.objectType === "ticket" && p.name === "Field Support") ?? s.pipelines.find((p) => p.objectType === "ticket");
      const stageId = input.stageId ?? pipeline?.stages.find((st) => !st.closed)?.id ?? pipeline?.stages[0]?.id ?? "";
      const seq = s.tickets.reduce((m, t) => Math.max(m, Number(t.id.split("-")[1]) || 0), 1000) + 1;
      let id = `t-${seq}`;
      while (s.tickets.some((t) => t.id === id)) id = `t-${Number(id.split("-")[1]) + 1}`;
      const ts = nowIso();
      const ticket: Ticket = {
        id,
        subject: input.subject.trim(),
        description: input.description.trim(),
        pipelineId: pipeline?.id ?? "",
        stageId,
        priority: input.priority,
        category: input.category,
        companyId: input.companyId,
        contactId: input.contactId,
        ownerId: input.ownerId,
        createdAt: ts,
        slaDueAt: input.slaDueAt ?? defaultSlaDue(input.priority, Date.parse(ts)),
        closedAt: null,
      };
      set((st) => ({ tickets: [ticket, ...st.tickets] }) as Partial<S>);
      get().addActivity({
        type: "note",
        subject: `Ticket opened: ${ticket.subject}`,
        body: `${id.toUpperCase()} · ${ticket.priority} priority · ${ticket.category}. SLA due ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" }).format(new Date(ticket.slaDueAt))} WIB.${ticket.description ? `\n\n${ticket.description}` : ""}`,
        links: { contactIds: ticket.contactId ? [ticket.contactId] : [], companyIds: ticket.companyId ? [ticket.companyId] : [], dealIds: [], ticketIds: [id] },
      });
      return id;
    },

    moveTicket: (id, stageId) => {
      const s = get();
      const t = s.tickets.find((x) => x.id === id);
      if (!t || t.stageId === stageId) return;
      const stages = s.pipelines.flatMap((p) => p.stages);
      const from = stages.find((x) => x.id === t.stageId);
      const to = stages.find((x) => x.id === stageId);
      const closedAt = to?.closed ? nowIso() : null;
      set((st) => ({ tickets: st.tickets.map((x) => (x.id === id ? { ...x, stageId, closedAt } : x)) }) as Partial<S>);
      get().addActivity({
        type: "note",
        subject: `Ticket ${to?.closed ? "closed" : "moved"}: ${from?.name ?? "—"} → ${to?.name ?? "—"}`,
        body: t.subject,
        links: { contactIds: t.contactId ? [t.contactId] : [], companyIds: t.companyId ? [t.companyId] : [], dealIds: [], ticketIds: [id] },
      });
    },

    deleteContact: (id) => {
      const s = get();
      const contact = s.contacts.find((c) => c.id === id);
      if (!contact) return null;
      const contacts = diffOut(s.contacts, (c) => c.id === id, () => null);
      const deals = diffOut(s.deals, () => false, (d) => (d.contactIds.includes(id) ? { ...d, contactIds: d.contactIds.filter((x) => x !== id) } : null));
      const tickets = diffOut(s.tickets, () => false, (t) => (t.contactId === id ? { ...t, contactId: null } : null));
      const crossLinks = diffOut(s.crossLinks, (x) => x.crmType === "contact" && x.crmId === id, () => null);
      const activities = stripActivities("contactIds", id);
      const sequenceEnrollments = diffOut(s.sequenceEnrollments, (e) => e.contactId === id, () => null);

      set({
        contacts: contacts.next,
        deals: deals.next,
        tickets: tickets.next,
        crossLinks: crossLinks.next,
        activities: activities.next,
        sequenceEnrollments: sequenceEnrollments.next,
      } as Partial<S>);

      const summary = [
        deals.diff.changed.length ? `removed from ${plural(deals.diff.changed.length, "deal")}` : "",
        tickets.diff.changed.length ? `unlinked from ${plural(tickets.diff.changed.length, "ticket")}` : "",
        crossLinks.diff.removed.length ? `${plural(crossLinks.diff.removed.length, "Jira link")} removed` : "",
        activities.diff.removed.length ? `${plural(activities.diff.removed.length, "activity", "activities")} deleted` : "",
        activities.diff.changed.length ? `${plural(activities.diff.changed.length, "shared activity", "shared activities")} kept on other records` : "",
        sequenceEnrollments.diff.removed.length ? `${plural(sequenceEnrollments.diff.removed.length, "sequence enrolment")} ended` : "",
      ].filter(Boolean);

      return {
        kind: "contact",
        id,
        label: `${contact.firstName} ${contact.lastName}`.trim(),
        diffs: { contacts: contacts.diff, deals: deals.diff, tickets: tickets.diff, crossLinks: crossLinks.diff, activities: activities.diff, sequenceEnrollments: sequenceEnrollments.diff },
        summary,
      };
    },

    deleteDeal: (id) => {
      const s = get();
      const deal = s.deals.find((d) => d.id === id);
      if (!deal) return null;
      const deals = diffOut(s.deals, (d) => d.id === id, () => null);
      const lineItems = diffOut(s.lineItems, (l) => l.dealId === id, () => null);
      const quotes = diffOut(s.quotes, (q) => q.dealId === id, () => null);
      const crossLinks = diffOut(s.crossLinks, (x) => x.crmType === "deal" && x.crmId === id, () => null);
      const activities = stripActivities("dealIds", id);
      const initiatives = diffOut(s.initiatives, () => false, (i) => (i.dealId === id ? { ...i, dealId: null } : null));

      set({
        deals: deals.next,
        lineItems: lineItems.next,
        quotes: quotes.next,
        crossLinks: crossLinks.next,
        activities: activities.next,
        initiatives: initiatives.next,
      } as Partial<S>);

      const summary = [
        lineItems.diff.removed.length ? `${plural(lineItems.diff.removed.length, "line item")} deleted` : "",
        quotes.diff.removed.length ? `${plural(quotes.diff.removed.length, "quote")} deleted` : "",
        crossLinks.diff.removed.length ? `${plural(crossLinks.diff.removed.length, "Jira link")} removed` : "",
        activities.diff.removed.length ? `${plural(activities.diff.removed.length, "activity", "activities")} deleted` : "",
        activities.diff.changed.length ? `${plural(activities.diff.changed.length, "shared activity", "shared activities")} kept on other records` : "",
        initiatives.diff.changed.length ? `unlinked from ${plural(initiatives.diff.changed.length, "initiative")}` : "",
      ].filter(Boolean);

      return {
        kind: "deal",
        id,
        label: deal.name,
        diffs: { deals: deals.diff, lineItems: lineItems.diff, quotes: quotes.diff, crossLinks: crossLinks.diff, activities: activities.diff, initiatives: initiatives.diff },
        summary,
      };
    },

    restoreSnapshot: (snap) => {
      const s = get();
      const d = snap.diffs;
      set({
        contacts: diffIn(s.contacts, d.contacts),
        deals: diffIn(s.deals, d.deals),
        tickets: diffIn(s.tickets, d.tickets),
        activities: diffIn(s.activities, d.activities),
        crossLinks: diffIn(s.crossLinks, d.crossLinks),
        lineItems: diffIn(s.lineItems, d.lineItems),
        quotes: diffIn(s.quotes, d.quotes),
        sequenceEnrollments: diffIn(s.sequenceEnrollments, d.sequenceEnrollments),
        initiatives: diffIn(s.initiatives, d.initiatives),
      } as Partial<S>);
    },
  };
}

/** a short preview of what deleting a record will do (for the confirm dialog) */
export function previewDelete(state: Pick<CrmState, "deals" | "tickets" | "activities" | "crossLinks" | "lineItems" | "quotes" | "sequenceEnrollments" | "initiatives">, kind: "contact" | "deal", id: string): string[] {
  const key = kind === "contact" ? "contactIds" : "dealIds";
  const acts = state.activities.filter((a) => a.links[key].includes(id));
  const onlyHere = acts.filter((a) => linkCount(a.links) === 1).length;
  const links = state.crossLinks.filter((x) => x.crmType === kind && x.crmId === id).length;
  if (kind === "contact") {
    const deals = state.deals.filter((d) => d.contactIds.includes(id)).length;
    const tickets = state.tickets.filter((t) => t.contactId === id).length;
    const seq = state.sequenceEnrollments.filter((e) => e.contactId === id).length;
    return [
      deals ? `Removed from ${plural(deals, "deal")}` : "",
      tickets ? `Unlinked from ${plural(tickets, "ticket")}` : "",
      links ? `${plural(links, "Jira link")} removed` : "",
      onlyHere ? `${plural(onlyHere, "activity", "activities")} only on this contact deleted` : "",
      acts.length - onlyHere ? `${plural(acts.length - onlyHere, "shared activity", "shared activities")} stay on the other records` : "",
      seq ? `${plural(seq, "sequence enrolment")} ended` : "",
    ].filter(Boolean);
  }
  const items = state.lineItems.filter((l) => l.dealId === id).length;
  const quotes = state.quotes.filter((q) => q.dealId === id).length;
  const inits = state.initiatives.filter((i) => i.dealId === id).length;
  return [
    items ? `${plural(items, "line item")} deleted` : "",
    quotes ? `${plural(quotes, "quote")} deleted` : "",
    links ? `${plural(links, "Jira link")} removed` : "",
    onlyHere ? `${plural(onlyHere, "activity", "activities")} only on this deal deleted` : "",
    acts.length - onlyHere ? `${plural(acts.length - onlyHere, "shared activity", "shared activities")} stay on the other records` : "",
    inits ? `Unlinked from ${plural(inits, "initiative")}` : "",
  ].filter(Boolean);
}
