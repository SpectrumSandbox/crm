"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { CURRENT_USER_ID, seed, type SeedData } from "./seed";
import type {
  Activity,
  ActivityLinks,
  AgileObjectType,
  Company,
  Contact,
  CrmObjectType,
  CrossLink,
  Deal,
  Issue,
  IssueStatus,
  LineItem,
  LinkType,
  Quote,
  QuoteStatus,
  Ticket,
} from "./types";
import { uid } from "./utils";
import { issueStatusMeta } from "./meta";
import { createInitiativeActions, type InitiativeActions } from "./initiatives/actions";
import { createCrmExtrasSlice, type CrmExtrasSlice } from "./slices/crm-extras";
import { createAgileExtrasSlice, type AgileExtrasSlice } from "./slices/agile-extras";
import { createPlatformSlice, type PlatformSlice } from "./slices/platform";
import { createProgramExtrasSlice, type ProgramExtrasSlice } from "./slices/program-extras";
import { createCrmServiceSlice, type CrmServiceSlice } from "./slices/crm-service";
import { createGovernanceSlice, type GovernanceSlice } from "./slices/governance";
import { createAutomationSlice, type AutomationSlice } from "./slices/automation";
import { createCompExtrasSlice, type CompExtrasSlice } from "./slices/comp-extras";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const nowIso = () => new Date().toISOString();

const emptyLinks = (): ActivityLinks => ({ contactIds: [], companyIds: [], dealIds: [], ticketIds: [] });

function linksFor(type: CrmObjectType, id: string): ActivityLinks {
  const l = emptyLinks();
  if (type === "contact") l.contactIds.push(id);
  if (type === "company") l.companyIds.push(id);
  if (type === "deal") l.dealIds.push(id);
  if (type === "ticket") l.ticketIds.push(id);
  return l;
}

function mergeLinks(a: ActivityLinks, b: ActivityLinks): ActivityLinks {
  const u = (x: string[], y: string[]) => Array.from(new Set([...x, ...y]));
  return { contactIds: u(a.contactIds, b.contactIds), companyIds: u(a.companyIds, b.companyIds), dealIds: u(a.dealIds, b.dealIds), ticketIds: u(a.ticketIds, b.ticketIds) };
}

export type NewIssueInput = Pick<Issue, "projectId" | "type" | "summary"> & Partial<Omit<Issue, "id" | "key" | "createdAt" | "updatedAt" | "rank">> & {
  link?: { crmType: CrmObjectType; crmId: string; linkType: LinkType };
};

export interface CrmState extends SeedData, InitiativeActions, CrmExtrasSlice, AgileExtrasSlice, PlatformSlice, ProgramExtrasSlice, CrmServiceSlice, GovernanceSlice, AutomationSlice, CompExtrasSlice {
  currentUserId: string;

  /* CRM */
  updateContact: (id: string, patch: Partial<Contact>) => void;
  updateCompany: (id: string, patch: Partial<Company>) => void;
  updateDeal: (id: string, patch: Partial<Deal>) => void;
  updateTicket: (id: string, patch: Partial<Ticket>) => void;
  createContact: (input: Omit<Contact, "id" | "createdAt" | "lastContactedAt">) => string;
  createCompany: (input: Omit<Company, "id" | "createdAt" | "enriched">) => string;
  createDeal: (input: Omit<Deal, "id" | "createdAt" | "stageEnteredAt">) => string;
  moveDeal: (dealId: string, stageId: string) => void;
  enrichCompany: (id: string) => void;
  setDealContacts: (dealId: string, contactIds: string[]) => void;

  /* timeline */
  addActivity: (input: Omit<Activity, "id" | "ownerId" | "timestamp"> & Partial<Pick<Activity, "ownerId" | "timestamp">>) => string;
  toggleTask: (id: string) => void;
  togglePin: (id: string) => void;
  deleteActivity: (id: string) => void;

  /* agile */
  createIssue: (input: NewIssueInput) => string;
  updateIssue: (id: string, patch: Partial<Issue>) => void;
  /** move an issue into a column and re-rank that column in the given order */
  moveIssue: (id: string, patch: Partial<Issue>, orderedColumnIds: string[]) => void;
  addComment: (issueId: string, body: string) => void;

  /* bridge */
  link: (input: { agileType: AgileObjectType; agileId: string; crmType: CrmObjectType; crmId: string; linkType: LinkType }) => string | null;
  unlink: (linkId: string) => void;

  /* commerce */
  addLineItem: (dealId: string, productId: string, quantity: number, discountPct?: number) => void;
  updateLineItem: (id: string, patch: Partial<Pick<LineItem, "quantity" | "discountPct">>) => void;
  removeLineItem: (id: string) => void;
  setQuoteStatus: (id: string, status: QuoteStatus) => void;
  generateQuote: (dealId: string) => string | null;

  resetDemo: () => void;
}

function collections(): SeedData {
  return clone(seed);
}

export const useCrm = create<CrmState>()(
  persist(
    (set, get) => {
      /** log a Jira update on every CRM record linked to an issue */
      const mirrorToTimeline = (issueId: string, subject: string, body: string) => {
        const links = get().crossLinks.filter((x) => x.agileType === "issue" && x.agileId === issueId);
        if (!links.length) return;
        const merged = links.reduce((acc, x) => mergeLinks(acc, linksFor(x.crmType, x.crmId)), emptyLinks());
        const activity: Activity = { id: uid("a"), type: "jira", subject, body, timestamp: nowIso(), ownerId: get().currentUserId, links: merged, issueId };
        set((s) => ({ activities: [activity, ...s.activities] }));
      };

      return {
        ...collections(),
        currentUserId: CURRENT_USER_ID,

        updateContact: (id, patch) => set((s) => ({ contacts: s.contacts.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
        updateCompany: (id, patch) => set((s) => ({ companies: s.companies.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
        updateDeal: (id, patch) => {
          const before = get().deals.find((d) => d.id === id);
          if (patch.stageId && before && patch.stageId !== before.stageId) {
            get().moveDeal(id, patch.stageId);
            const { stageId: _s, ...rest } = patch;
            if (Object.keys(rest).length) set((s) => ({ deals: s.deals.map((d) => (d.id === id ? { ...d, ...rest } : d)) }));
            return;
          }
          set((s) => ({ deals: s.deals.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));
        },
        updateTicket: (id, patch) => set((s) => ({ tickets: s.tickets.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

        createContact: (input) => {
          const id = uid("k");
          const contact: Contact = { ...input, id, createdAt: nowIso(), lastContactedAt: null };
          set((s) => ({ contacts: [contact, ...s.contacts] }));
          return id;
        },
        createCompany: (input) => {
          const id = uid("c");
          const company: Company = { ...input, id, createdAt: nowIso(), enriched: false };
          set((s) => ({ companies: [company, ...s.companies] }));
          return id;
        },
        createDeal: (input) => {
          const id = uid("d");
          const ts = nowIso();
          const deal: Deal = { ...input, id, createdAt: ts, stageEnteredAt: ts };
          set((s) => ({ deals: [deal, ...s.deals] }));
          get().addActivity({ type: "note", subject: "Deal created", body: `${deal.name} created in ${get().pipelines.find((p) => p.id === deal.pipelineId)?.name ?? "pipeline"}.`, links: { ...emptyLinks(), dealIds: [id], companyIds: deal.companyId ? [deal.companyId] : [], contactIds: deal.contactIds } });
          return id;
        },
        moveDeal: (dealId, stageId) => {
          const deal = get().deals.find((d) => d.id === dealId);
          if (!deal || deal.stageId === stageId) return;
          const stages = get().pipelines.flatMap((p) => p.stages);
          const from = stages.find((s) => s.id === deal.stageId)?.name ?? "—";
          const to = stages.find((s) => s.id === stageId)?.name ?? "—";
          set((s) => ({ deals: s.deals.map((d) => (d.id === dealId ? { ...d, stageId, stageEnteredAt: nowIso() } : d)) }));
          get().addActivity({ type: "note", subject: `Stage changed: ${from} → ${to}`, body: `${deal.name} moved from ${from} to ${to}.`, links: { ...emptyLinks(), dealIds: [dealId], companyIds: deal.companyId ? [deal.companyId] : [] } });
        },
        enrichCompany: (id) => {
          const c = get().companies.find((x) => x.id === id);
          if (!c) return;
          const slug = c.domain.split(".")[0];
          const stacks: Record<string, string[]> = {
            Utilities: ["SCADA", "Oracle", "Esri"],
            Agriculture: ["SAP", "Google Workspace", "Power BI"],
            "Smart City": ["AWS", "LoRaWAN", "Grafana"],
            "Non-profit": ["Google Workspace", "QGIS"],
          };
          set((s) => ({
            companies: s.companies.map((x) =>
              x.id === id
                ? { ...x, enriched: true, linkedin: x.linkedin ?? slug, techStack: x.techStack?.length ? x.techStack : stacks[x.industry] ?? ["Microsoft 365", "AWS"] }
                : x,
            ),
          }));
          get().addActivity({ type: "note", subject: "Company enriched from domain", body: `Firmographics refreshed from ${c.domain}.`, links: { ...emptyLinks(), companyIds: [id] } });
        },
        setDealContacts: (dealId, contactIds) => set((s) => ({ deals: s.deals.map((d) => (d.id === dealId ? { ...d, contactIds } : d)) })),

        addActivity: (input) => {
          const id = uid("a");
          const activity: Activity = { ...input, id, ownerId: input.ownerId ?? get().currentUserId, timestamp: input.timestamp ?? nowIso() };
          set((s) => {
            // engagement types bump "last contacted" on the contacts involved
            const touches = activity.type === "email" || activity.type === "call" || activity.type === "meeting";
            return {
              activities: [activity, ...s.activities],
              contacts: touches ? s.contacts.map((c) => (activity.links.contactIds.includes(c.id) ? { ...c, lastContactedAt: activity.timestamp } : c)) : s.contacts,
            };
          });
          return id;
        },
        toggleTask: (id) => set((s) => ({ activities: s.activities.map((a) => (a.id === id ? { ...a, done: !a.done } : a)) })),
        togglePin: (id) => set((s) => ({ activities: s.activities.map((a) => (a.id === id ? { ...a, pinned: !a.pinned } : a)) })),
        deleteActivity: (id) => set((s) => ({ activities: s.activities.filter((a) => a.id !== id) })),

        createIssue: (input) => {
          const s = get();
          const project = s.projects.find((p) => p.id === input.projectId);
          if (!project) return "";
          const max = s.issues.filter((i) => i.projectId === project.id).reduce((m, i) => Math.max(m, Number(i.key.split("-")[1]) || 0), 0);
          const status: IssueStatus = input.status ?? "todo";
          const minRank = s.issues.filter((i) => i.projectId === project.id && i.status === status).reduce((m, i) => Math.min(m, i.rank), 1000);
          const id = uid("i");
          const ts = nowIso();
          const { link, ...rest } = input;
          const issue: Issue = {
            description: "",
            priority: "medium",
            assigneeId: null,
            reporterId: s.currentUserId,
            epicId: null,
            sprintId: null,
            parentId: null,
            storyPoints: null,
            labels: [],
            dueDate: null,
            ...rest,
            status,
            id,
            key: `${project.key}-${max + 1}`,
            rank: minRank - 1000,
            createdAt: ts,
            updatedAt: ts,
          };
          set((st) => ({ issues: [...st.issues, issue] }));
          if (link) get().link({ agileType: "issue", agileId: id, crmType: link.crmType, crmId: link.crmId, linkType: link.linkType });
          return id;
        },
        updateIssue: (id, patch) => {
          const before = get().issues.find((i) => i.id === id);
          if (!before) return;
          set((s) => ({ issues: s.issues.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: nowIso() } : i)) }));
          if (patch.status && patch.status !== before.status) {
            mirrorToTimeline(id, `${before.key} moved to ${issueStatusMeta[patch.status].label}`, before.summary);
          }
        },
        moveIssue: (id, patch, orderedColumnIds) => {
          const before = get().issues.find((i) => i.id === id);
          if (!before) return;
          const rankOf = new Map(orderedColumnIds.map((x, idx) => [x, (idx + 1) * 1000]));
          const ts = nowIso();
          set((s) => ({
            issues: s.issues.map((i) => {
              const rank = rankOf.get(i.id);
              if (i.id === id) return { ...i, ...patch, rank: rank ?? i.rank, updatedAt: ts };
              return rank !== undefined ? { ...i, rank } : i;
            }),
          }));
          if (patch.status && patch.status !== before.status) {
            mirrorToTimeline(id, `${before.key} moved to ${issueStatusMeta[patch.status].label}`, before.summary);
          }
        },
        addComment: (issueId, body) =>
          set((s) => ({ issueComments: [...s.issueComments, { id: uid("ic"), issueId, authorId: s.currentUserId, body, createdAt: nowIso() }] })),

        link: ({ agileType, agileId, crmType, crmId, linkType }) => {
          const exists = get().crossLinks.find((x) => x.agileType === agileType && x.agileId === agileId && x.crmType === crmType && x.crmId === crmId && x.linkType === linkType);
          if (exists) return exists.id;
          const link: CrossLink = { id: uid("x"), agileType, agileId, crmType, crmId, linkType, createdAt: nowIso(), createdById: get().currentUserId };
          set((s) => ({ crossLinks: [...s.crossLinks, link] }));
          const label = agileType === "issue" ? get().issues.find((i) => i.id === agileId) : get().epics.find((e) => e.id === agileId);
          if (label) {
            const key = label.key;
            const summary = "summary" in label ? label.summary : "";
            get().addActivity({ type: "jira", subject: `${key} linked (${linkType.replace("_", " ")})`, body: summary, links: linksFor(crmType, crmId), issueId: agileType === "issue" ? agileId : undefined });
          }
          return link.id;
        },
        unlink: (linkId) => set((s) => ({ crossLinks: s.crossLinks.filter((x) => x.id !== linkId) })),

        addLineItem: (dealId, productId, quantity, discountPct = 0) => {
          const product = get().products.find((p) => p.id === productId);
          if (!product) return;
          set((s) => ({ lineItems: [...s.lineItems, { id: uid("li"), dealId, productId, quantity, unitPrice: product.unitPrice, discountPct }] }));
        },
        updateLineItem: (id, patch) => set((s) => ({ lineItems: s.lineItems.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
        removeLineItem: (id) => set((s) => ({ lineItems: s.lineItems.filter((l) => l.id !== id) })),
        setQuoteStatus: (id, status) => {
          const quote = get().quotes.find((q) => q.id === id);
          if (!quote || quote.status === status) return;
          set((s) => ({ quotes: s.quotes.map((q) => (q.id === id ? { ...q, status } : q)) }));
          const deal = get().deals.find((d) => d.id === quote.dealId);
          get().addActivity({ type: "note", subject: `Quote ${quote.number} → ${status.replace("_", " ")}`, body: quote.title, links: { ...emptyLinks(), dealIds: [quote.dealId], companyIds: deal?.companyId ? [deal.companyId] : [] } });
        },
        generateQuote: (dealId) => {
          const s = get();
          const deal = s.deals.find((d) => d.id === dealId);
          if (!deal) return null;
          const items = s.lineItems.filter((l) => l.dealId === dealId);
          const seq = s.quotes.reduce((m, q) => Math.max(m, Number(q.number.split("-")[2]) || 0), 0) + 1;
          const id = uid("q");
          const ts = nowIso();
          const quote: Quote = {
            id,
            number: `SGQ-${new Date().getFullYear()}-${String(seq).padStart(4, "0")}`,
            dealId,
            title: deal.name.split(" — ")[1] ?? deal.name,
            status: "draft",
            ownerId: s.currentUserId,
            createdAt: ts,
            expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
            lineItems: items.map(({ dealId: _d, ...rest }) => ({ ...rest, id: uid("qli") })),
            taxPct: 11,
          };
          set((st) => ({ quotes: [quote, ...st.quotes] }));
          get().addActivity({ type: "note", subject: `Quote ${quote.number} drafted`, body: `${items.length} line item${items.length === 1 ? "" : "s"} from the deal.`, links: { ...emptyLinks(), dealIds: [dealId], companyIds: deal.companyId ? [deal.companyId] : [] } });
          return id;
        },

        resetDemo: () => set({ ...collections() }),

        ...createInitiativeActions<CrmState>(set, get, uid),
        ...createCrmExtrasSlice<CrmState>(set, get, uid),
        ...createAgileExtrasSlice<CrmState>(set, get, uid),
        ...createPlatformSlice<CrmState>(set, get, uid),
        ...createProgramExtrasSlice<CrmState>(set, get, uid),
        ...createCrmServiceSlice<CrmState>(set, get, uid),
        ...createGovernanceSlice<CrmState>(set, get, uid),
        ...createAutomationSlice<CrmState>(set, get, uid),
        ...createCompExtrasSlice<CrmState>(set, get, uid),
      };
    },
    {
      name: "sg-crm-v1",
      version: 3,
      // v3: Policy v4.0 data model (curve, ledger, cycles, amendments) and the ongoing-projects register — start from the fresh seed
      migrate: () => collections(),
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => {
        const { currentUserId: _c, ...rest } = s;
        const data: Partial<SeedData> = {};
        (Object.keys(seed) as (keyof SeedData)[]).forEach((k) => {
          (data as Record<string, unknown>)[k] = rest[k];
        });
        return data as SeedData;
      },
    },
  ),
);

/* ───────────────────────── UI state (not persisted) ───────────────────────── */

export type DialogState =
  | { kind: "createDeal"; companyId?: string; contactId?: string; stageId?: string; pipelineId?: string }
  | { kind: "createIssue"; projectId?: string; status?: IssueStatus; link?: { crmType: CrmObjectType; crmId: string; linkType: LinkType } }
  | { kind: "createContact"; companyId?: string }
  | { kind: "createCompany" }
  | { kind: "logActivity"; activityType: "call" | "email" | "meeting" | "note" | "task"; target?: { type: CrmObjectType; id: string } }
  | { kind: "linkIssue"; crmType: CrmObjectType; crmId: string }
  | { kind: "linkRecord"; agileType: AgileObjectType; agileId: string }
  | { kind: "generateQuote"; dealId?: string }
  | { kind: "shortcuts" };

interface UiState {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  issueId: string | null;
  openIssue: (id: string | null) => void;
  dialog: DialogState | null;
  openDialog: (d: DialogState) => void;
  closeDialog: () => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  toast: { id: number; message: string; action?: { label: string; run: () => void } } | null;
  /** Show a toast; pass an action for "Undo"-style follow-ups. */
  notify: (message: string, action?: { label: string; run: () => void }) => void;
}

export const useUi = create<UiState>()((set) => ({
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  issueId: null,
  openIssue: (issueId) => set({ issueId }),
  dialog: null,
  openDialog: (dialog) => set({ dialog, paletteOpen: false }),
  closeDialog: () => set({ dialog: null }),
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toast: null,
  notify: (message, action) => set({ toast: { id: Date.now(), message, action } }),
}));
