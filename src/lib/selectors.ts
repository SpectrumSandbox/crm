"use client";

import { useMemo } from "react";
import { useCrm } from "./store";
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
