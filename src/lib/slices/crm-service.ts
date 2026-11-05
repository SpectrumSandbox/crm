/* Store slice "CrmService" — accounts, service desk and list-view state mixed into useCrm (workstream W4):
 * SLA pause/resume and business-hours deadlines on tickets, clean undo of ticket moves, CSAT, WhatsApp touches,
 * phone clean-up, duplicate merges with undo, account plans and saved list views. */
import type { CrmState } from "../store";
import type { Activity, Company, Contact, LifecycleStage, Ticket } from "../types";
import { LIFECYCLE_STAGES } from "../types";
import type { NewTicketInput } from "./crm-extras";
import type { AccountPlan, SavedView } from "../seed-ext/accounts";
import { formatPhone, normalisePhone } from "../smart-lists";
import { resumedSlaDue, slaDueFor } from "../selectors";
import type { GetFn, SetFn, Uid } from "./types";

/* ───────────────────────── helpers ───────────────────────── */

/** the "Waiting on Customer" stage — the SLA clock stops while a ticket sits here */
export function isWaitingStage(stage: { id: string; name: string } | undefined) {
  return !!stage && (stage.id === "ts-waiting" || /waiting on (the )?customer/i.test(stage.name));
}

const TIER_RANK: Record<Company["tier"], number> = { Strategic: 0, Enterprise: 1, "Mid-Market": 2, Emerging: 3 };
const further = (a: LifecycleStage, b: LifecycleStage) => (LIFECYCLE_STAGES.indexOf(a) >= LIFECYCLE_STAGES.indexOf(b) ? a : b);
const uniq = <T,>(xs: T[]) => Array.from(new Set(xs));

type Collection = "contacts" | "companies" | "deals" | "tickets" | "activities" | "crossLinks" | "sequenceEnrollments" | "initiatives" | "accountPlans";
type Row = { id: string };

interface CollectionChange {
  /** previous versions of modified records */
  changed: Row[];
  /** removed records with their original index */
  removed: { index: number; item: Row }[];
  /** ids of records added by the operation */
  added: string[];
}

/** what a merge changed, so Undo can put every collection back without clobbering unrelated edits */
export interface MergeSnapshot {
  kind: "contact" | "company";
  keepId: string;
  dropId: string;
  label: string;
  changes: Partial<Record<Collection, CollectionChange>>;
  summary: string[];
}

export interface TicketMoveUndo {
  ticket: Ticket;
  /** the "Ticket moved" activity the move logged — deleted on undo */
  activityId: string | null;
}

export interface PhoneFixUndo {
  phones: { id: string; phone: string }[];
}

/** rewrite a collection, recording what changed */
function rewrite<T extends Row>(arr: T[], fn: (x: T) => T | null | "remove"): { next: T[]; change: CollectionChange } {
  const change: CollectionChange = { changed: [], removed: [], added: [] };
  const next: T[] = [];
  arr.forEach((x, index) => {
    const r = fn(x);
    if (r === "remove") change.removed.push({ index, item: x });
    else if (r) {
      change.changed.push(x);
      next.push(r);
    } else next.push(x);
  });
  return { next, change };
}

function restore<T extends Row>(arr: T[], change: CollectionChange | undefined): T[] {
  if (!change) return arr;
  const prev = new Map(change.changed.map((x) => [x.id, x as T] as const));
  const added = new Set(change.added);
  const out = arr.filter((x) => !added.has(x.id)).map((x) => prev.get(x.id) ?? x);
  const present = new Set(out.map((x) => x.id));
  [...change.removed]
    .sort((a, b) => a.index - b.index)
    .forEach(({ index, item }) => {
      if (present.has(item.id)) return;
      out.splice(Math.min(index, out.length), 0, item as T);
      present.add(item.id);
    });
  return out;
}

const count = (c: CollectionChange | undefined) => (c ? c.changed.length + c.removed.length : 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ───────────────────────── slice ───────────────────────── */

export interface ServiceTicketInput extends Omit<NewTicketInput, "slaDueAt"> {
  /** explicit deadline; otherwise the business-hours SLA for the priority */
  slaDueAt?: string;
}

export interface CrmServiceSlice {
  /** open a ticket with a business-hours (or 24/7 for urgent) SLA deadline; returns the ticket id */
  openServiceTicket: (input: ServiceTicketInput) => string;
  /** move a ticket between stages, pausing the SLA in "Waiting on Customer" and resuming it on exit */
  moveServiceTicket: (id: string, stageId: string) => TicketMoveUndo | null;
  /** put a ticket back exactly as before a move and delete the activity the move logged */
  undoTicketMove: (undo: TicketMoveUndo) => void;
  /** pause/resume SLA clocks of tickets that were moved by another screen; returns how many changed */
  reconcileSlaPauses: () => number;
  /** record (or clear) the customer's 1–5 satisfaction rating for a ticket */
  rateTicket: (id: string, score: number | null, comment?: string) => void;
  /** log a WhatsApp touch on a contact (click-to-chat) and bump "last contacted" */
  logWhatsApp: (contactId: string, text?: string) => string | null;
  /** rewrite phone numbers in the +62 grouped format; returns what to undo */
  normaliseContactPhones: (ids: string[]) => PhoneFixUndo;
  undoPhoneFix: (undo: PhoneFixUndo) => void;
  /** merge `dropId` into `keepId` (contacts) — re-points deals, tickets, activities, Jira links, sequences */
  mergeContacts: (keepId: string, dropId: string) => MergeSnapshot | null;
  /** merge `dropId` into `keepId` (companies) — re-points contacts, deals, tickets, activities, links, initiatives, units */
  mergeCompanies: (keepId: string, dropId: string) => MergeSnapshot | null;
  undoMerge: (snap: MergeSnapshot) => void;
  /** the account plan of a company, created on first use; returns the plan id */
  ensureAccountPlan: (companyId: string) => string;
  updateAccountPlan: (id: string, patch: Partial<Omit<AccountPlan, "id" | "companyId" | "createdAt">>) => void;
  markPlanReviewed: (id: string) => void;
  /** turn a plan action into a deal on the New Business pipeline; returns the deal id */
  convertPlanAction: (planId: string, actionId: string, input: { amount: number; closeDate: string }) => string | null;
  saveView: (input: Omit<SavedView, "id" | "ownerId" | "createdAt">) => string;
  deleteView: (id: string) => SavedView | null;
  restoreView: (view: SavedView) => void;
}

type Needs = Pick<
  CrmState,
  | Collection
  | "savedViews"
  | "pipelines"
  | "currentUserId"
  | "addActivity"
  | "deleteActivity"
  | "moveTicket"
  | "createTicket"
  | "createDeal"
>;

export function createCrmServiceSlice<S extends CrmServiceSlice & Needs>(set: SetFn<S>, get: GetFn<S>, uid: Uid): CrmServiceSlice {
  const nowIso = () => new Date().toISOString();
  const stageOf = (stageId: string) => get().pipelines.flatMap((p) => p.stages).find((s) => s.id === stageId);
  const patchTicket = (id: string, patch: Partial<Ticket>) => set((s) => ({ tickets: s.tickets.map((t) => (t.id === id ? { ...t, ...patch } : t)) }) as Partial<S>);

  /** pause / resume patch for a ticket entering `stageId` at `atMs` */
  const pausePatch = (t: Ticket, stageId: string, atMs: number): Partial<Ticket> | null => {
    const stage = stageOf(stageId);
    const closed = !!stage?.closed;
    if (isWaitingStage(stage) && !closed && !t.slaPausedAt && !t.closedAt) return { slaPausedAt: new Date(atMs).toISOString() };
    if ((!isWaitingStage(stage) || closed) && t.slaPausedAt) {
      return { slaDueAt: resumedSlaDue(t, atMs), slaPausedAt: null, slaPausedMs: (t.slaPausedMs ?? 0) + Math.max(0, atMs - Date.parse(t.slaPausedAt)) };
    }
    return null;
  };

  return {
    openServiceTicket: (input) => {
      const sla = input.slaDueAt ? { dueAt: input.slaDueAt, basis: SLA_BASIS_FOR(input.priority) } : slaDueFor(input.priority);
      const id = get().createTicket({ ...input, slaDueAt: sla.dueAt });
      patchTicket(id, { slaBasis: sla.basis, slaPausedAt: null, slaPausedMs: 0 });
      // a ticket opened straight into "Waiting on Customer" starts paused
      const t = get().tickets.find((x) => x.id === id);
      if (t) {
        const p = pausePatch(t, t.stageId, Date.now());
        if (p) patchTicket(id, p);
      }
      return id;
    },

    moveServiceTicket: (id, stageId) => {
      const before = get().tickets.find((t) => t.id === id);
      if (!before || before.stageId === stageId) return null;
      const topBefore = get().activities[0]?.id;
      get().moveTicket(id, stageId);
      const top = get().activities[0];
      const activityId = top && top.id !== topBefore && top.links.ticketIds.includes(id) ? top.id : null;
      const moved = get().tickets.find((t) => t.id === id);
      if (moved) {
        const p = pausePatch(moved, stageId, Date.now());
        if (p) {
          patchTicket(id, p);
          if (activityId) {
            const note = p.slaPausedAt ? "SLA clock paused while waiting on the customer." : `SLA clock resumed — new deadline ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" }).format(new Date(p.slaDueAt ?? moved.slaDueAt))} WIB.`;
            set((s) => ({ activities: s.activities.map((a) => (a.id === activityId ? { ...a, body: `${a.body}\n${note}` } : a)) }) as Partial<S>);
          }
        }
      }
      return { ticket: before, activityId };
    },

    undoTicketMove: ({ ticket, activityId }) => {
      patchTicket(ticket.id, {
        stageId: ticket.stageId,
        closedAt: ticket.closedAt,
        slaDueAt: ticket.slaDueAt,
        slaPausedAt: ticket.slaPausedAt ?? null,
        slaPausedMs: ticket.slaPausedMs ?? 0,
        csat: ticket.csat ?? null,
        csatComment: ticket.csatComment,
      });
      if (activityId && get().activities.some((a) => a.id === activityId)) get().deleteActivity(activityId);
    },

    reconcileSlaPauses: () => {
      const s = get();
      let changed = 0;
      const now = Date.now();
      const next = s.tickets.map((t) => {
        if (t.closedAt && !t.slaPausedAt) return t;
        const stage = stageOf(t.stageId);
        let at = now;
        if (isWaitingStage(stage) && !t.slaPausedAt && stage) {
          // pause from the moment it entered the stage, when the timeline knows it
          const entered = s.activities.find((a) => a.links.ticketIds.includes(t.id) && a.subject.includes(`→ ${stage.name}`));
          if (entered && Date.parse(entered.timestamp) <= now) at = Date.parse(entered.timestamp);
        }
        const p = pausePatch(t, t.stageId, at);
        if (!p) return t;
        changed += 1;
        return { ...t, ...p };
      });
      if (changed) set({ tickets: next } as Partial<S>);
      return changed;
    },

    rateTicket: (id, score, comment = "") => {
      const t = get().tickets.find((x) => x.id === id);
      if (!t) return;
      const value = score === null ? null : Math.min(5, Math.max(1, Math.round(score)));
      patchTicket(id, { csat: value, csatComment: comment.trim() });
      if (value !== null) {
        get().addActivity({
          type: "note",
          subject: `CSAT ${value}/5 on ${id.toUpperCase()}`,
          body: comment.trim() || t.subject,
          links: { contactIds: t.contactId ? [t.contactId] : [], companyIds: t.companyId ? [t.companyId] : [], dealIds: [], ticketIds: [id] },
        });
      }
    },

    logWhatsApp: (contactId, text) => {
      const c = get().contacts.find((x) => x.id === contactId);
      if (!c) return null;
      const id = get().addActivity({
        type: "note",
        subject: `WhatsApp chat with ${c.firstName} ${c.lastName}`.trim(),
        body: text?.trim() ? text.trim() : `Opened WhatsApp click-to-chat to ${formatPhone(c.phone)}.`,
        direction: "outbound",
        links: { contactIds: [contactId], companyIds: c.companyId ? [c.companyId] : [], dealIds: [], ticketIds: [] },
      });
      const ts = nowIso();
      set((s) => ({ contacts: s.contacts.map((x) => (x.id === contactId ? { ...x, lastContactedAt: ts } : x)) }) as Partial<S>);
      return id;
    },

    normaliseContactPhones: (ids) => {
      const wanted = new Set(ids);
      const phones: { id: string; phone: string }[] = [];
      set(
        (s) =>
          ({
            contacts: s.contacts.map((c) => {
              if (!wanted.has(c.id)) return c;
              const info = normalisePhone(c.phone);
              const pretty = formatPhone(c.phone);
              if (!info.valid || pretty === c.phone) return c;
              phones.push({ id: c.id, phone: c.phone });
              return { ...c, phone: pretty };
            }),
          }) as Partial<S>,
      );
      return { phones };
    },

    undoPhoneFix: ({ phones }) => {
      const prev = new Map(phones.map((p) => [p.id, p.phone] as const));
      set((s) => ({ contacts: s.contacts.map((c) => (prev.has(c.id) ? { ...c, phone: prev.get(c.id)! } : c)) }) as Partial<S>);
    },

    mergeContacts: (keepId, dropId) => {
      const s = get();
      const keep = s.contacts.find((c) => c.id === keepId);
      const drop = s.contacts.find((c) => c.id === dropId);
      if (!keep || !drop || keepId === dropId) return null;
      const fill = <K extends keyof Contact>(k: K) => (keep[k] === "" || keep[k] === null || keep[k] === undefined ? drop[k] : keep[k]);
      const merged: Contact = {
        ...keep,
        email: fill("email"),
        phone: fill("phone"),
        jobTitle: fill("jobTitle"),
        companyId: fill("companyId"),
        city: fill("city"),
        leadScore: Math.max(keep.leadScore, drop.leadScore),
        lifecycleStage: further(keep.lifecycleStage, drop.lifecycleStage),
        lastContactedAt: [keep.lastContactedAt, drop.lastContactedAt].filter((x): x is string => !!x).sort().pop() ?? null,
        createdAt: [keep.createdAt, drop.createdAt].sort()[0],
      };
      const swap = (ids: string[]) => (ids.includes(dropId) ? uniq(ids.map((x) => (x === dropId ? keepId : x))) : null);

      const contacts = rewrite(s.contacts, (c) => (c.id === dropId ? "remove" : c.id === keepId ? merged : null));
      const deals = rewrite(s.deals, (d) => {
        const ids = swap(d.contactIds);
        return ids ? { ...d, contactIds: ids } : null;
      });
      const tickets = rewrite(s.tickets, (t) => (t.contactId === dropId ? { ...t, contactId: keepId } : null));
      const activities = rewrite(s.activities, (a) => {
        const ids = swap(a.links.contactIds);
        return ids ? { ...a, links: { ...a.links, contactIds: ids } } : null;
      });
      const linkKey = (x: { agileType: string; agileId: string; linkType: string }) => `${x.agileType}:${x.agileId}:${x.linkType}`;
      const keepLinks = new Set(s.crossLinks.filter((x) => x.crmType === "contact" && x.crmId === keepId).map(linkKey));
      const crossLinks = rewrite(s.crossLinks, (x) => (x.crmType === "contact" && x.crmId === dropId ? (keepLinks.has(linkKey(x)) ? "remove" : { ...x, crmId: keepId }) : null));
      const keepSeqs = new Set(s.sequenceEnrollments.filter((e) => e.contactId === keepId).map((e) => e.sequenceId));
      const sequenceEnrollments = rewrite(s.sequenceEnrollments, (e) => (e.contactId === dropId ? (keepSeqs.has(e.sequenceId) ? "remove" : { ...e, contactId: keepId }) : null));
      const accountPlans = rewrite(s.accountPlans, (p) =>
        p.relationships.some((r) => r.contactId === dropId)
          ? { ...p, relationships: p.relationships.filter((r) => !(r.contactId === dropId && p.relationships.some((k) => k.contactId === keepId))).map((r) => (r.contactId === dropId ? { ...r, contactId: keepId } : r)) }
          : null,
      );

      set({
        contacts: contacts.next,
        deals: deals.next,
        tickets: tickets.next,
        activities: activities.next,
        crossLinks: crossLinks.next,
        sequenceEnrollments: sequenceEnrollments.next,
        accountPlans: accountPlans.next,
      } as Partial<S>);
      const dropName = `${drop.firstName} ${drop.lastName}`.trim();
      const noteId = get().addActivity({
        type: "note",
        subject: `Merged duplicate contact ${dropName}`,
        body: `${dropName}${drop.email ? ` <${drop.email}>` : ""} was merged into ${merged.firstName} ${merged.lastName}. Deals, tickets, activities, Jira links and sequence enrolments now point here.`,
        links: { contactIds: [keepId], companyIds: merged.companyId ? [merged.companyId] : [], dealIds: [], ticketIds: [] },
      });
      const changes = { contacts: contacts.change, deals: deals.change, tickets: tickets.change, activities: { ...activities.change, added: [noteId] }, crossLinks: crossLinks.change, sequenceEnrollments: sequenceEnrollments.change, accountPlans: accountPlans.change };
      return {
        kind: "contact",
        keepId,
        dropId,
        label: dropName,
        changes,
        summary: [
          count(deals.change) ? plural(count(deals.change), "deal") : "",
          count(tickets.change) ? plural(count(tickets.change), "ticket") : "",
          count(activities.change) ? plural(count(activities.change), "activity", "activities") : "",
          count(crossLinks.change) ? plural(count(crossLinks.change), "Jira link") : "",
          count(sequenceEnrollments.change) ? plural(count(sequenceEnrollments.change), "sequence enrolment") : "",
        ].filter(Boolean),
      };
    },

    mergeCompanies: (keepId, dropId) => {
      const s = get();
      const keep = s.companies.find((c) => c.id === keepId);
      const drop = s.companies.find((c) => c.id === dropId);
      if (!keep || !drop || keepId === dropId) return null;
      const blank = (v: unknown) => v === "" || v === null || v === undefined;
      const merged: Company = {
        ...keep,
        domain: blank(keep.domain) ? drop.domain : keep.domain,
        phone: blank(keep.phone) ? drop.phone : keep.phone,
        description: blank(keep.description) ? drop.description : keep.description,
        city: blank(keep.city) ? drop.city : keep.city,
        linkedin: keep.linkedin ?? drop.linkedin,
        techStack: uniq([...(keep.techStack ?? []), ...(drop.techStack ?? [])]),
        employees: Math.max(keep.employees, drop.employees),
        annualRevenue: Math.max(keep.annualRevenue, drop.annualRevenue),
        tier: TIER_RANK[keep.tier] <= TIER_RANK[drop.tier] ? keep.tier : drop.tier,
        lifecycleStage: further(keep.lifecycleStage, drop.lifecycleStage),
        enriched: keep.enriched || drop.enriched,
        // never make a company its own parent
        parentId: keep.parentId === dropId ? (drop.parentId === keepId ? null : drop.parentId) : keep.parentId,
        createdAt: [keep.createdAt, drop.createdAt].sort()[0],
      };
      const companies = rewrite(s.companies, (c) => (c.id === dropId ? "remove" : c.id === keepId ? merged : c.parentId === dropId ? { ...c, parentId: keepId } : null));
      const contacts = rewrite(s.contacts, (c) => (c.companyId === dropId ? { ...c, companyId: keepId } : null));
      const deals = rewrite(s.deals, (d) => (d.companyId === dropId ? { ...d, companyId: keepId } : null));
      const tickets = rewrite(s.tickets, (t) => (t.companyId === dropId ? { ...t, companyId: keepId } : null));
      const activities = rewrite(s.activities, (a: Activity) => (a.links.companyIds.includes(dropId) ? { ...a, links: { ...a.links, companyIds: uniq(a.links.companyIds.map((x) => (x === dropId ? keepId : x))) } } : null));
      const linkKey = (x: { agileType: string; agileId: string; linkType: string }) => `${x.agileType}:${x.agileId}:${x.linkType}`;
      const keepLinks = new Set(s.crossLinks.filter((x) => x.crmType === "company" && x.crmId === keepId).map(linkKey));
      const crossLinks = rewrite(s.crossLinks, (x) => (x.crmType === "company" && x.crmId === dropId ? (keepLinks.has(linkKey(x)) ? "remove" : { ...x, crmId: keepId }) : null));
      const initiatives = rewrite(s.initiatives, (i) => (i.companyId === dropId ? { ...i, companyId: keepId } : null));
      const keepPlan = s.accountPlans.find((p) => p.companyId === keepId);
      const dropPlan = s.accountPlans.find((p) => p.companyId === dropId);
      const unit = (u: string | null) => (u === dropId ? keepId : u);
      const accountPlans = rewrite(s.accountPlans, (p) => {
        if (dropPlan && keepPlan && p.id === dropPlan.id) return "remove";
        let next = p;
        if (keepPlan && dropPlan && p.id === keepPlan.id) {
          next = {
            ...p,
            strategy: p.strategy || dropPlan.strategy,
            relationships: [...p.relationships, ...dropPlan.relationships.filter((r) => !p.relationships.some((k) => k.contactId === r.contactId))],
            whitespace: [...p.whitespace, ...dropPlan.whitespace],
            goals: [...p.goals, ...dropPlan.goals],
            actions: [...p.actions, ...dropPlan.actions],
          };
        } else if (p.companyId === dropId) next = { ...p, companyId: keepId };
        const touches = next !== p || next.whitespace.some((w) => w.unitId === dropId) || next.actions.some((a) => a.unitId === dropId);
        if (!touches) return null;
        const seen = new Set<string>();
        return {
          ...next,
          whitespace: next.whitespace
            .map((w) => ({ ...w, unitId: unit(w.unitId) ?? keepId }))
            .filter((w) => {
              const k = `${w.unitId}|${w.capability}`;
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            }),
          actions: next.actions.map((a) => ({ ...a, unitId: unit(a.unitId) })),
        };
      });

      set({
        companies: companies.next,
        contacts: contacts.next,
        deals: deals.next,
        tickets: tickets.next,
        activities: activities.next,
        crossLinks: crossLinks.next,
        initiatives: initiatives.next,
        accountPlans: accountPlans.next,
      } as Partial<S>);
      const noteId = get().addActivity({
        type: "note",
        subject: `Merged duplicate company ${drop.name}`,
        body: `${drop.name} (${drop.domain}) was merged into ${merged.name}. Contacts, deals, tickets, activities, Jira links, initiatives and business units now point here.`,
        links: { contactIds: [], companyIds: [keepId], dealIds: [], ticketIds: [] },
      });
      return {
        kind: "company",
        keepId,
        dropId,
        label: drop.name,
        changes: {
          companies: companies.change,
          contacts: contacts.change,
          deals: deals.change,
          tickets: tickets.change,
          activities: { ...activities.change, added: [noteId] },
          crossLinks: crossLinks.change,
          initiatives: initiatives.change,
          accountPlans: accountPlans.change,
        },
        summary: [
          count(contacts.change) ? plural(count(contacts.change), "contact") : "",
          count(deals.change) ? plural(count(deals.change), "deal") : "",
          count(tickets.change) ? plural(count(tickets.change), "ticket") : "",
          count(activities.change) ? plural(count(activities.change), "activity", "activities") : "",
          count(initiatives.change) ? plural(count(initiatives.change), "initiative") : "",
          companies.change.changed.length > 1 ? plural(companies.change.changed.length - 1, "business unit") : "",
        ].filter(Boolean),
      };
    },

    undoMerge: (snap) => {
      const s = get();
      const c = snap.changes;
      set({
        contacts: restore(s.contacts, c.contacts),
        companies: restore(s.companies, c.companies),
        deals: restore(s.deals, c.deals),
        tickets: restore(s.tickets, c.tickets),
        activities: restore(s.activities, c.activities),
        crossLinks: restore(s.crossLinks, c.crossLinks),
        sequenceEnrollments: restore(s.sequenceEnrollments, c.sequenceEnrollments),
        initiatives: restore(s.initiatives, c.initiatives),
        accountPlans: restore(s.accountPlans, c.accountPlans),
      } as Partial<S>);
    },

    ensureAccountPlan: (companyId) => {
      const existing = get().accountPlans.find((p) => p.companyId === companyId);
      if (existing) return existing.id;
      const company = get().companies.find((c) => c.id === companyId);
      const ts = nowIso();
      const plan: AccountPlan = {
        id: uid("ap"),
        companyId,
        ownerId: company?.ownerId ?? get().currentUserId,
        strategy: "",
        cadence: company?.tier === "Strategic" ? "monthly" : "quarterly",
        lastReviewedAt: null,
        lastReviewedById: null,
        relationships: [],
        whitespace: [],
        goals: [],
        actions: [],
        createdAt: ts,
        updatedAt: ts,
      };
      set((s) => ({ accountPlans: [...s.accountPlans, plan] }) as Partial<S>);
      return plan.id;
    },

    updateAccountPlan: (id, patch) => set((s) => ({ accountPlans: s.accountPlans.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: nowIso() } : p)) }) as Partial<S>),

    markPlanReviewed: (id) => {
      const plan = get().accountPlans.find((p) => p.id === id);
      if (!plan) return;
      const ts = nowIso();
      set((s) => ({ accountPlans: s.accountPlans.map((p) => (p.id === id ? { ...p, lastReviewedAt: ts, lastReviewedById: s.currentUserId, updatedAt: ts } : p)) }) as Partial<S>);
      get().addActivity({ type: "note", subject: "Account plan reviewed", body: plan.strategy || "Account plan review recorded.", links: { contactIds: [], companyIds: [plan.companyId], dealIds: [], ticketIds: [] } });
    },

    convertPlanAction: (planId, actionId, input) => {
      const s = get();
      const plan = s.accountPlans.find((p) => p.id === planId);
      const action = plan?.actions.find((a) => a.id === actionId);
      if (!plan || !action || action.status === "converted") return null;
      const unitId = action.unitId ?? plan.companyId;
      const company = s.companies.find((c) => c.id === unitId);
      const pipeline = s.pipelines.find((p) => p.id === "pl-new") ?? s.pipelines.find((p) => p.objectType === "deal");
      const stage = pipeline?.stages.find((st) => !st.closed);
      if (!pipeline || !stage) return null;
      const contactIds = s.contacts.filter((c) => c.companyId === unitId && plan.relationships.some((r) => r.contactId === c.id && (r.rating === "champion" || r.rating === "supporter"))).map((c) => c.id);
      const dealId = s.createDeal({
        name: `${company?.name ?? "Account"} — ${action.capability ?? action.text}`.slice(0, 120),
        amount: Math.max(0, Math.round(input.amount)),
        pipelineId: pipeline.id,
        stageId: stage.id,
        closeDate: input.closeDate,
        ownerId: action.ownerId,
        companyId: unitId,
        contactIds,
        priority: "medium",
        dealType: company?.lifecycleStage === "customer" || company?.lifecycleStage === "evangelist" ? "Expansion" : "New Business",
        capability: action.capability ?? "Engineering Management",
        description: `From the account plan: ${action.text}`,
      });
      set((st) => ({ accountPlans: st.accountPlans.map((p) => (p.id === planId ? { ...p, updatedAt: nowIso(), actions: p.actions.map((a) => (a.id === actionId ? { ...a, status: "converted" as const, dealId } : a)) } : p)) }) as Partial<S>);
      return dealId;
    },

    saveView: (input) => {
      const view: SavedView = { ...input, name: input.name.trim() || "Saved view", id: uid("sv"), ownerId: get().currentUserId, createdAt: nowIso() };
      set((s) => ({ savedViews: [...s.savedViews, view] }) as Partial<S>);
      return view.id;
    },
    deleteView: (id) => {
      const v = get().savedViews.find((x) => x.id === id) ?? null;
      if (v) set((s) => ({ savedViews: s.savedViews.filter((x) => x.id !== id) }) as Partial<S>);
      return v;
    },
    restoreView: (view) => set((s) => ({ savedViews: s.savedViews.some((x) => x.id === view.id) ? s.savedViews : [...s.savedViews, view] }) as Partial<S>),
  };
}

/** basis of an SLA deadline that was typed in explicitly — same basis as the priority's policy */
function SLA_BASIS_FOR(priority: Ticket["priority"]): "business" | "clock" {
  return priority === "urgent" ? "clock" : "business";
}
