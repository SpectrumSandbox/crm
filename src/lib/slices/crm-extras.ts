/* Store slice "CrmExtras" — state + actions mixed into useCrm. Owned by the CRM deals/records/quotes workstream (W3). */
import type { CrmState } from "../store";
import type { Activity, ActivityLinks, CrossLink, Deal, DealChange, DealOrigination, LineItem, Quote, QuoteSettings, Ticket, TicketPriority } from "../types";
import type { GetFn, SetFn, Uid } from "./types";
import { originationLocks, originationOf } from "../../components/crm/deal-signals";
import { approvalNeeds, isQuoteExpired, quoteTotals, settingsOf, suggestedFakturCode } from "../../components/crm/quote-math";

/* ───────────────────────── delete snapshots (undo) ───────────────────────── */

/** collections a delete can touch; restoring a snapshot puts every one back exactly */
type SnapCollection = "contacts" | "companies" | "deals" | "tickets" | "activities" | "crossLinks" | "lineItems" | "quotes" | "sequenceEnrollments" | "initiatives";

interface CollectionDiff<T> {
  /** records removed, with their original index so they go back in the same place */
  removed: { index: number; item: T }[];
  /** previous versions of records that were modified (references stripped) */
  changed: T[];
}

type ElementOf<A> = A extends (infer E)[] ? E : never;

export interface DeleteSnapshot {
  kind: "contact" | "deal" | "company" | "ticket";
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

/** put one removed record back at its original index (no-op when it is already there) */
function reinsert<T extends { id: string }>(arr: T[], item: T, index: number): T[] {
  if (arr.some((x) => x.id === item.id)) return arr;
  const out = [...arr];
  out.splice(Math.max(0, Math.min(index, out.length)), 0, item);
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const linkCount = (l: ActivityLinks) => l.contactIds.length + l.companyIds.length + l.dealIds.length + l.ticketIds.length;
const wibDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date(iso));
const rp = (n: number) => `Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Math.round(n))}`;

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

/* ───────────────────────── deals: tracked changes ───────────────────────── */

/** everything needed to undo one deal change exactly */
export interface DealUndo {
  dealId: string;
  before: Deal;
  activityIds: string[];
  historyIds: string[];
}

const TRACKED: DealChange["field"][] = ["amount", "closeDate", "stageId", "ownerId", "forecastCategory"];

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
  /** delete a company: child units are re-parented to its parent, contacts/deals/tickets keep existing without it */
  deleteCompany: (id: string) => DeleteSnapshot | null;
  /** delete a ticket with its Jira links; activities only on the ticket are removed */
  deleteTicket: (id: string) => DeleteSnapshot | null;
  /** put back everything a delete removed or changed */
  restoreSnapshot: (snapshot: DeleteSnapshot) => void;

  /**
   * The one way W3 screens change a deal: records history (amount, close date, stage, owner, forecast category),
   * stamps the close date when the deal is closed (won or lost), locks origination from Proposal Sent (§4.1), logs
   * amount/close-date/owner edits on the timeline, and returns an undo token for the toast.
   */
  changeDeal: (id: string, patch: Partial<Deal>) => DealUndo | null;
  /** revert a changeDeal exactly: deal fields, the activities it logged and its history rows */
  undoDealChange: (undo: DealUndo) => void;
  /** record or amend origination evidence; once locked only the PRC may amend (returns an error message) */
  setDealOrigination: (id: string, origination: DealOrigination, reason?: string) => string | null;

  /* small exact restores for Undo toasts */
  restoreActivity: (activity: Activity, index: number) => void;
  restoreLineItem: (item: LineItem, index: number) => void;
  restoreCrossLink: (link: CrossLink, index: number) => void;

  /* quotes (§4.7) */
  /** draft quote from the deal's line items with PPN 12 % × DPP 11/12, suggested faktur code and default termin */
  createQuoteFromDeal: (dealId: string) => string | null;
  updateQuote: (id: string, patch: Partial<Pick<Quote, "title" | "language" | "fakturCode" | "paymentSchedule" | "terms">>) => string | null;
  submitQuote: (id: string) => string | null;
  approveQuote: (id: string, kind: "finance" | "director") => string | null;
  quoteToDraft: (id: string) => string | null;
  sendQuote: (id: string) => string | null;
  signQuote: (id: string) => string | null;
  extendQuote: (id: string, days: number) => string | null;
  /** clone as the next revision (…-B, …-C) in draft; the old one is marked superseded and expired */
  reissueQuote: (id: string) => string | null;
  /** mark every open quote past its expiry date as expired (logged); returns how many changed */
  expireQuotes: () => number;
  updateQuoteSettings: (patch: Partial<QuoteSettings>) => void;
}

type Needs = Pick<
  CrmState,
  SnapCollection | "pipelines" | "currentUserId" | "addActivity" | "updateDeal" | "dealHistory" | "quoteSettings" | "products" | "users" | "employeeProfiles" | "setQuoteStatus" | "generateQuote"
>;

export function createCrmExtrasSlice<S extends CrmExtrasSlice & Needs>(set: SetFn<S>, get: GetFn<S>, uid: Uid): CrmExtrasSlice {
  const nowIso = () => new Date().toISOString();

  /** strip an id from activity links; activities left pointing at nothing are removed */
  const stripActivities = (key: keyof ActivityLinks, id: string) =>
    diffOut<Activity>(
      get().activities,
      (a) => a.links[key].includes(id) && linkCount(a.links) === 1,
      (a) => (a.links[key].includes(id) ? { ...a, links: { ...a.links, [key]: a.links[key].filter((x) => x !== id) } } : null),
    );

  const rolesOf = (userId: string) => get().employeeProfiles.find((p) => p.userId === userId)?.governanceRoles ?? [];
  const userName = (id: string | null | undefined) => get().users.find((u) => u.id === id)?.name ?? "—";

  const dealLinks = (dealId: string): ActivityLinks => {
    const d = get().deals.find((x) => x.id === dealId);
    return { contactIds: [], companyIds: d?.companyId ? [d.companyId] : [], dealIds: [dealId], ticketIds: [] };
  };
  const logQuote = (q: Quote, subject: string, body = q.title) => get().addActivity({ type: "note", subject, body, links: dealLinks(q.dealId) });
  const patchQuote = (id: string, patch: Partial<Quote>) => set((st) => ({ quotes: st.quotes.map((q) => (q.id === id ? { ...q, ...patch } : q)) }) as Partial<S>);
  const totalsOf = (q: Quote) => {
    const s = get();
    const deal = s.deals.find((d) => d.id === q.dealId);
    return quoteTotals(q.lineItems, { quote: q, settings: settingsOf(s.quoteSettings), products: s.products, company: s.companies.find((c) => c.id === deal?.companyId) });
  };

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

    deleteCompany: (id) => {
      const s = get();
      const company = s.companies.find((c) => c.id === id);
      if (!company) return null;
      const companies = diffOut(s.companies, (c) => c.id === id, (c) => (c.parentId === id ? { ...c, parentId: company.parentId } : null));
      const contacts = diffOut(s.contacts, () => false, (c) => (c.companyId === id ? { ...c, companyId: null } : null));
      const deals = diffOut(s.deals, () => false, (d) => (d.companyId === id ? { ...d, companyId: null } : null));
      const tickets = diffOut(s.tickets, () => false, (t) => (t.companyId === id ? { ...t, companyId: null } : null));
      const crossLinks = diffOut(s.crossLinks, (x) => x.crmType === "company" && x.crmId === id, () => null);
      const activities = stripActivities("companyIds", id);
      const initiatives = diffOut(s.initiatives, () => false, (i) => (i.companyId === id ? { ...i, companyId: null } : null));
      set({ companies: companies.next, contacts: contacts.next, deals: deals.next, tickets: tickets.next, crossLinks: crossLinks.next, activities: activities.next, initiatives: initiatives.next } as Partial<S>);
      const summary = [
        companies.diff.changed.length ? `${plural(companies.diff.changed.length, "child unit")} moved up` : "",
        contacts.diff.changed.length ? `${plural(contacts.diff.changed.length, "contact")} unlinked` : "",
        deals.diff.changed.length ? `${plural(deals.diff.changed.length, "deal")} unlinked` : "",
        tickets.diff.changed.length ? `${plural(tickets.diff.changed.length, "ticket")} unlinked` : "",
        activities.diff.removed.length ? `${plural(activities.diff.removed.length, "activity", "activities")} deleted` : "",
      ].filter(Boolean);
      return {
        kind: "company",
        id,
        label: company.name,
        diffs: { companies: companies.diff, contacts: contacts.diff, deals: deals.diff, tickets: tickets.diff, crossLinks: crossLinks.diff, activities: activities.diff, initiatives: initiatives.diff },
        summary,
      };
    },

    deleteTicket: (id) => {
      const s = get();
      const ticket = s.tickets.find((t) => t.id === id);
      if (!ticket) return null;
      const tickets = diffOut(s.tickets, (t) => t.id === id, () => null);
      const crossLinks = diffOut(s.crossLinks, (x) => x.crmType === "ticket" && x.crmId === id, () => null);
      const activities = stripActivities("ticketIds", id);
      set({ tickets: tickets.next, crossLinks: crossLinks.next, activities: activities.next } as Partial<S>);
      const summary = [
        crossLinks.diff.removed.length ? `${plural(crossLinks.diff.removed.length, "Jira link")} removed` : "",
        activities.diff.removed.length ? `${plural(activities.diff.removed.length, "activity", "activities")} deleted` : "",
      ].filter(Boolean);
      return { kind: "ticket", id, label: `${id.toUpperCase()} ${ticket.subject}`, diffs: { tickets: tickets.diff, crossLinks: crossLinks.diff, activities: activities.diff }, summary };
    },

    restoreSnapshot: (snap) => {
      const s = get();
      const d = snap.diffs;
      set({
        contacts: diffIn(s.contacts, d.contacts),
        companies: diffIn(s.companies, d.companies),
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

    /* ───────────── deals ───────────── */

    changeDeal: (id, patch) => {
      const s = get();
      const before = s.deals.find((d) => d.id === id);
      if (!before) return null;
      const stages = s.pipelines.flatMap((p) => p.stages);
      const fromStage = stages.find((x) => x.id === before.stageId);
      const stageChanged = !!patch.stageId && patch.stageId !== before.stageId;
      const toStage = stageChanged ? stages.find((x) => x.id === patch.stageId) : undefined;
      const ts = nowIso();
      const next: Partial<Deal> = { ...patch };
      const extra: string[] = [];

      if (toStage?.closed && patch.closeDate === undefined) {
        next.closeDate = ts;
        extra.push(`Close date set to ${wibDate(ts)} (expected ${wibDate(before.closeDate)}).`);
      }
      if (toStage?.closed === "lost" && (patch.lostReason || patch.lostToCompetitor)) extra.push(`Lost reason: ${patch.lostReason ?? "—"}${patch.lostToCompetitor ? ` · to ${patch.lostToCompetitor}` : ""}.`);
      if (toStage?.closed === "won" && (patch.winReason || patch.poNumber)) extra.push(`${patch.winReason ? `Won on: ${patch.winReason}.` : ""}${patch.poNumber ? ` PO / contract ${patch.poNumber}.` : ""}`.trim());
      if (patch.closeNote) extra.push(patch.closeNote);
      if (stageChanged && fromStage?.closed && !toStage?.closed) {
        // reopened: the close outcome no longer applies
        if (patch.lostReason === undefined) next.lostReason = undefined;
        if (patch.lostToCompetitor === undefined) next.lostToCompetitor = undefined;
        if (patch.winReason === undefined) next.winReason = undefined;
        extra.push(`Reopened from ${fromStage.name}.`);
      }
      // §4.1 — origination evidence freezes once the deal reaches Proposal Sent
      if (stageChanged && originationLocks(toStage) && !originationLocks(fromStage) && !before.origination?.lockedAt) {
        const { derived: _d, ...o } = originationOf({ ...before, ...next } as Deal, s.activities);
        next.origination = { ...(patch.origination ?? o), lockedAt: ts, recordedById: patch.origination?.recordedById ?? before.origination?.recordedById ?? s.currentUserId, recordedAt: before.origination?.recordedAt ?? ts };
        extra.push("Origination evidence locked (§4.1).");
      }

      const actIds = new Set(s.activities.map((a) => a.id));
      get().updateDeal(id, next);

      // history rows for tracked fields
      const after = get().deals.find((d) => d.id === id) ?? before;
      const rows: DealChange[] = [];
      TRACKED.forEach((field) => {
        const from = (before[field] ?? null) as string | number | null;
        const to = (after[field] ?? null) as string | number | null;
        if (from === to) return;
        if (field === "closeDate" && from && to && String(from).slice(0, 10) === String(to).slice(0, 10) && toStage === undefined) return;
        rows.push({ id: uid("dh"), dealId: id, field, from, to, at: ts, byId: s.currentUserId });
      });
      if (rows.length) set((st) => ({ dealHistory: [...(st.dealHistory ?? []), ...rows] }) as Partial<S>);

      // annotate the stage-change entry, or log field edits that moveDeal does not
      const created = get().activities.filter((a) => !actIds.has(a.id));
      const stageAct = created.find((a) => a.subject.startsWith("Stage changed"));
      if (stageAct && extra.length) {
        set((st) => ({ activities: st.activities.map((a) => (a.id === stageAct.id ? { ...a, body: [a.body, ...extra].filter(Boolean).join("\n") } : a)) }) as Partial<S>);
      }
      if (!stageChanged) {
        const lines: string[] = [];
        if (after.amount !== before.amount) lines.push(`Amount ${rp(before.amount)} → ${rp(after.amount)}`);
        if (after.closeDate !== before.closeDate && wibDate(after.closeDate) !== wibDate(before.closeDate)) lines.push(`Close date ${wibDate(before.closeDate)} → ${wibDate(after.closeDate)}`);
        if (after.ownerId !== before.ownerId) lines.push(`Owner ${userName(before.ownerId)} → ${userName(after.ownerId)}`);
        if (lines.length) {
          get().addActivity({ type: "note", subject: "Deal updated", body: lines.join("\n"), links: { contactIds: [], companyIds: after.companyId ? [after.companyId] : [], dealIds: [id], ticketIds: [] } });
        }
      }
      const activityIds = get()
        .activities.filter((a) => !actIds.has(a.id))
        .map((a) => a.id);
      return { dealId: id, before, activityIds, historyIds: rows.map((r) => r.id) };
    },

    undoDealChange: (u) => {
      const drop = new Set(u.activityIds);
      const dropH = new Set(u.historyIds);
      set((st) => ({
        deals: st.deals.map((d) => (d.id === u.dealId ? u.before : d)),
        activities: drop.size ? st.activities.filter((a) => !drop.has(a.id)) : st.activities,
        dealHistory: dropH.size ? (st.dealHistory ?? []).filter((h) => !dropH.has(h.id)) : st.dealHistory,
      }) as Partial<S>);
    },

    setDealOrigination: (id, origination, reason) => {
      const s = get();
      const deal = s.deals.find((d) => d.id === id);
      if (!deal) return "Deal not found";
      const stage = s.pipelines.flatMap((p) => p.stages).find((x) => x.id === deal.stageId);
      const locked = !!deal.origination?.lockedAt || originationLocks(stage);
      const roles = rolesOf(s.currentUserId);
      if (locked && !(roles.includes("prc") || roles.includes("ceo"))) return "Origination is locked from Proposal Sent — only the PRC can amend it (§4.1, disputes §14)";
      if (locked && !reason?.trim()) return "Give a reason for amending locked origination evidence";
      const ts = nowIso();
      const next: DealOrigination = { ...origination, recordedById: s.currentUserId, recordedAt: ts, lockedAt: locked ? (deal.origination?.lockedAt ?? ts) : null };
      set((st) => ({ deals: st.deals.map((d) => (d.id === id ? { ...d, origination: next } : d)) }) as Partial<S>);
      const channel = { personal: "personally originated", follow_on: "follow-on scope", company: "company channel" }[next.channel];
      get().addActivity({
        type: "note",
        subject: locked ? "Origination amended by the PRC" : "Origination recorded",
        body: `${channel}${next.source ? ` (${next.source.replace(/_/g, " ")})` : ""} · originator ${userName(next.originatorId)}${next.firstContactAt ? ` · first contact ${wibDate(next.firstContactAt)}` : ""}${reason ? `\nReason: ${reason.trim()}` : ""}`,
        links: dealLinks(id),
      });
      return null;
    },

    restoreActivity: (activity, index) => set((st) => ({ activities: reinsert(st.activities, activity, index) }) as Partial<S>),
    restoreLineItem: (item, index) => set((st) => ({ lineItems: reinsert(st.lineItems, item, index) }) as Partial<S>),
    restoreCrossLink: (link, index) => set((st) => ({ crossLinks: reinsert(st.crossLinks, link, index) }) as Partial<S>),

    /* ───────────── quotes ───────────── */

    createQuoteFromDeal: (dealId) => {
      const s = get();
      const id = s.generateQuote(dealId);
      if (!id) return null;
      const settings = settingsOf(s.quoteSettings);
      const deal = s.deals.find((d) => d.id === dealId);
      const company = s.companies.find((c) => c.id === deal?.companyId);
      patchQuote(id, {
        vatRate: 12,
        dppFactor: 11 / 12,
        taxPct: settings.supplierPkp ? 11 : 0,
        fakturCode: suggestedFakturCode(company),
        language: "id",
        expiresAt: new Date(Date.now() + settings.defaultValidityDays * DAY).toISOString(),
        paymentSchedule: [{ id: uid("pm"), label: "Pelunasan / Full payment", pct: 100, trigger: "acceptance", dueAt: null }],
        financeCheckedAt: null,
        financeCheckedById: null,
        directorApprovedAt: null,
        directorApprovedById: null,
      });
      return id;
    },

    updateQuote: (id, patch) => {
      const q = get().quotes.find((x) => x.id === id);
      if (!q) return "Quote not found";
      const commercial = "paymentSchedule" in patch || "terms" in patch || "title" in patch;
      if (commercial && q.status !== "draft") return "Commercial terms are locked once the quote leaves draft — move it back to draft or re-issue it";
      if (patch.paymentSchedule) {
        const sum = patch.paymentSchedule.reduce((a, m) => a + (Number.isFinite(m.pct) ? m.pct : 0), 0);
        if (patch.paymentSchedule.some((m) => !(m.pct > 0))) return "Each termin needs a percentage above 0";
        if (Math.abs(sum - 100) > 0.001) return `Termin add up to ${sum}% — they must total 100%`;
      }
      patchQuote(id, patch);
      return null;
    },

    submitQuote: (id) => {
      const s = get();
      const q = s.quotes.find((x) => x.id === id);
      if (!q) return "Quote not found";
      if (q.status !== "draft") return "Only a draft can be submitted";
      if (!q.lineItems.length) return "The quote has no line items";
      if (isQuoteExpired(q)) return "The quote has expired — extend or re-issue it first";
      if (q.paymentSchedule?.length && Math.abs(q.paymentSchedule.reduce((a, m) => a + m.pct, 0) - 100) > 0.001) return "Payment milestones must total 100%";
      const needs = approvalNeeds({ financeCheckedAt: null, directorApprovedAt: null }, totalsOf(q), settingsOf(s.quoteSettings));
      patchQuote(id, { submittedAt: nowIso(), financeCheckedAt: null, financeCheckedById: null, directorApprovedAt: null, directorApprovedById: null });
      get().setQuoteStatus(id, needs.complete ? "approved" : "pending_approval");
      return null;
    },

    approveQuote: (id, kind) => {
      const s = get();
      const q = s.quotes.find((x) => x.id === id);
      if (!q) return "Quote not found";
      if (q.status !== "pending_approval") return "The quote is not awaiting approval";
      if (isQuoteExpired(q)) return "The quote has expired";
      const roles = rolesOf(s.currentUserId);
      if (kind === "finance" && !(roles.includes("finance") || roles.includes("cfo"))) return "Only Finance (CFO or finance team) can check a quotation (§4.7)";
      if (kind === "director" && !(roles.includes("ceo") || roles.includes("executive_committee"))) return "Director approval needs the CEO or an Executive Committee member";
      if (q.ownerId === s.currentUserId) return "The quote owner cannot approve their own quote (maker-checker)";
      const ts = nowIso();
      const patch: Partial<Quote> = kind === "finance" ? { financeCheckedAt: ts, financeCheckedById: s.currentUserId } : { directorApprovedAt: ts, directorApprovedById: s.currentUserId };
      patchQuote(id, patch);
      const updated = { ...q, ...patch };
      logQuote(q, `Quote ${q.number} ${kind === "finance" ? "checked by Finance" : "approved by director"}`, `${userName(s.currentUserId)} · ${kind === "finance" ? "§4.7 Finance check" : "over the approval threshold"}`);
      const needs = approvalNeeds(updated, totalsOf(updated), settingsOf(s.quoteSettings));
      if (needs.complete) get().setQuoteStatus(id, "approved");
      return null;
    },

    quoteToDraft: (id) => {
      const q = get().quotes.find((x) => x.id === id);
      if (!q) return "Quote not found";
      if (q.status !== "pending_approval" && q.status !== "approved") return "Only a quote awaiting approval or approved can go back to draft";
      patchQuote(id, { financeCheckedAt: null, financeCheckedById: null, directorApprovedAt: null, directorApprovedById: null, submittedAt: null });
      get().setQuoteStatus(id, "draft");
      return null;
    },

    sendQuote: (id) => {
      const s = get();
      const q = s.quotes.find((x) => x.id === id);
      if (!q) return "Quote not found";
      if (isQuoteExpired(q)) return "The quote has expired — extend or re-issue it first";
      if (q.status !== "approved") return q.status === "sent" ? "Already sent" : "Quotations must be checked and approved before they are sent (§4.7)";
      patchQuote(id, { sentAt: nowIso() });
      get().setQuoteStatus(id, "sent");
      return null;
    },

    signQuote: (id) => {
      const q = get().quotes.find((x) => x.id === id);
      if (!q) return "Quote not found";
      if (q.status !== "sent") return "Only a sent quote can be marked signed";
      patchQuote(id, { signedAt: nowIso() });
      get().setQuoteStatus(id, "signed");
      return null;
    },

    extendQuote: (id, days) => {
      const q = get().quotes.find((x) => x.id === id);
      if (!q) return "Quote not found";
      if (q.status === "signed") return "A signed quote does not expire";
      if (q.supersededById) return "This quote was superseded by a revision";
      const base = Math.max(Date.now(), Date.parse(q.expiresAt));
      const expiresAt = new Date(base + days * DAY).toISOString();
      patchQuote(id, { expiresAt });
      if (q.status === "expired") {
        const s = get();
        const back = q.sentAt ? "sent" : approvalNeeds(q, totalsOf(q), settingsOf(s.quoteSettings)).complete && q.submittedAt ? "approved" : "draft";
        set((st) => ({ quotes: st.quotes.map((x) => (x.id === id ? { ...x, status: back } : x)) }) as Partial<S>);
      }
      logQuote(q, `Quote ${q.number} extended`, `Valid until ${wibDate(expiresAt)} (+${days} days).`);
      return null;
    },

    reissueQuote: (id) => {
      const s = get();
      const q = s.quotes.find((x) => x.id === id);
      if (!q) return null;
      if (q.supersededById) return null;
      const base = q.number.replace(/-[A-Z]$/, "");
      const used = new Set(s.quotes.map((x) => x.number));
      let letter = "B";
      while (used.has(`${base}-${letter}`) && letter < "Z") letter = String.fromCharCode(letter.charCodeAt(0) + 1);
      const settings = settingsOf(s.quoteSettings);
      const ts = nowIso();
      const nid = uid("q");
      const copy: Quote = {
        ...q,
        id: nid,
        number: `${base}-${letter}`,
        status: "draft",
        ownerId: s.currentUserId,
        createdAt: ts,
        expiresAt: new Date(Date.now() + settings.defaultValidityDays * DAY).toISOString(),
        lineItems: q.lineItems.map((l) => ({ ...l, id: uid("qli") })),
        paymentSchedule: q.paymentSchedule?.map((m) => ({ ...m, id: uid("pm") })),
        financeCheckedAt: null,
        financeCheckedById: null,
        directorApprovedAt: null,
        directorApprovedById: null,
        submittedAt: null,
        sentAt: null,
        signedAt: null,
        supersedesId: q.id,
        supersededById: null,
      };
      set((st) => ({ quotes: [copy, ...st.quotes.map((x) => (x.id === id ? { ...x, supersededById: nid, status: x.status === "signed" ? x.status : "expired" } : x))] }) as Partial<S>);
      logQuote(copy, `Quote ${copy.number} re-issued`, `Revision of ${q.number}; the previous quote is superseded.`);
      return nid;
    },

    expireQuotes: () => {
      const now = Date.now();
      const due = get().quotes.filter((q) => q.status !== "expired" && q.status !== "signed" && isQuoteExpired(q, now));
      if (!due.length) return 0;
      const ids = new Set(due.map((q) => q.id));
      set((st) => ({ quotes: st.quotes.map((q) => (ids.has(q.id) ? { ...q, status: "expired" } : q)) }) as Partial<S>);
      due.forEach((q) => logQuote(q, `Quote ${q.number} expired`, `Validity ended ${wibDate(q.expiresAt)} — extend it or re-issue a revision.`));
      return due.length;
    },

    updateQuoteSettings: (patch) => {
      const s = get();
      const cur = settingsOf(s.quoteSettings);
      const next: QuoteSettings = { ...cur, ...patch, updatedAt: nowIso(), updatedById: s.currentUserId };
      const rows = s.quoteSettings ?? [];
      set({ quoteSettings: rows.length ? rows.map((r, i) => (i === 0 ? next : r)) : [next] } as Partial<S>);
    },
  };
}

/** a short preview of what deleting a record will do (for the confirm dialog) */
export function previewDelete(
  state: Pick<CrmState, "companies" | "contacts" | "deals" | "tickets" | "activities" | "crossLinks" | "lineItems" | "quotes" | "sequenceEnrollments" | "initiatives">,
  kind: "contact" | "deal" | "company" | "ticket",
  id: string,
): string[] {
  const key = kind === "contact" ? "contactIds" : kind === "deal" ? "dealIds" : kind === "company" ? "companyIds" : "ticketIds";
  const acts = state.activities.filter((a) => a.links[key].includes(id));
  const onlyHere = acts.filter((a) => linkCount(a.links) === 1).length;
  const links = state.crossLinks.filter((x) => x.crmType === kind && x.crmId === id).length;
  const shared = acts.length - onlyHere;
  if (kind === "company") {
    const children = state.companies.filter((c) => c.parentId === id).length;
    const contacts = state.contacts.filter((c) => c.companyId === id).length;
    const deals = state.deals.filter((d) => d.companyId === id).length;
    const tickets = state.tickets.filter((t) => t.companyId === id).length;
    return [
      children ? `${plural(children, "child unit")} moved up to the parent level` : "",
      contacts ? `${plural(contacts, "contact")} kept without a company` : "",
      deals ? `${plural(deals, "deal")} kept without a company` : "",
      tickets ? `${plural(tickets, "ticket")} kept without a company` : "",
      links ? `${plural(links, "Jira link")} removed` : "",
      onlyHere ? `${plural(onlyHere, "activity", "activities")} only on this company deleted` : "",
      shared ? `${plural(shared, "shared activity", "shared activities")} stay on the other records` : "",
    ].filter(Boolean);
  }
  if (kind === "ticket") {
    return [
      links ? `${plural(links, "Jira link")} removed` : "",
      onlyHere ? `${plural(onlyHere, "activity", "activities")} only on this ticket deleted` : "",
      shared ? `${plural(shared, "shared activity", "shared activities")} stay on the other records` : "",
    ].filter(Boolean);
  }
  if (kind === "contact") {
    const deals = state.deals.filter((d) => d.contactIds.includes(id)).length;
    const tickets = state.tickets.filter((t) => t.contactId === id).length;
    const seq = state.sequenceEnrollments.filter((e) => e.contactId === id).length;
    return [
      deals ? `Removed from ${plural(deals, "deal")}` : "",
      tickets ? `Unlinked from ${plural(tickets, "ticket")}` : "",
      links ? `${plural(links, "Jira link")} removed` : "",
      onlyHere ? `${plural(onlyHere, "activity", "activities")} only on this contact deleted` : "",
      shared ? `${plural(shared, "shared activity", "shared activities")} stay on the other records` : "",
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
    shared ? `${plural(shared, "shared activity", "shared activities")} stay on the other records` : "",
    inits ? `Unlinked from ${plural(inits, "initiative")}` : "",
  ].filter(Boolean);
}
