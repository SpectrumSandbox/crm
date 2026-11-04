import type { Company, Contact } from "./types";

export interface ContactContext {
  now: number;
  /** sum of open-deal amounts each contact is associated with */
  openPipelineByContact: Map<string, number>;
}

export interface CompanyContext {
  now: number;
  openPipelineByCompany: Map<string, number>;
  childCount: Map<string, number>;
}

export interface SmartList<T, C> {
  id: string;
  name: string;
  description: string;
  test: (record: T, ctx: C) => boolean;
}

const DAY = 86_400_000;

export const SMART_LISTS: SmartList<Contact, ContactContext>[] = [
  { id: "all", name: "All contacts", description: "Every contact in the CRM", test: () => true },
  {
    id: "hot-leads",
    name: "Hot leads",
    description: "Lead score ≥ 75 and not yet a customer",
    test: (c) => c.leadScore >= 75 && c.lifecycleStage !== "customer" && c.lifecycleStage !== "evangelist",
  },
  {
    id: "handoff",
    name: "MQL → SQL handoff",
    description: "Marketing- and sales-qualified leads",
    test: (c) => c.lifecycleStage === "mql" || c.lifecycleStage === "sql",
  },
  {
    id: "stale",
    name: "Going cold (14d+)",
    description: "Active stages, not contacted in 14 days or never",
    test: (c, ctx) => c.lifecycleStage !== "subscriber" && (!c.lastContactedAt || ctx.now - Date.parse(c.lastContactedAt) > 14 * DAY),
  },
  {
    id: "big-pipeline",
    name: "On deals ≥ Rp 2B",
    description: "Associated with ≥ Rp 2B of open pipeline",
    test: (c, ctx) => (ctx.openPipelineByContact.get(c.id) ?? 0) >= 2_000_000_000,
  },
  { id: "customers", name: "Customers & evangelists", description: "Lifecycle stage customer or evangelist", test: (c) => c.lifecycleStage === "customer" || c.lifecycleStage === "evangelist" },
];

export const COMPANY_LISTS: SmartList<Company, CompanyContext>[] = [
  { id: "all", name: "All companies", description: "Every company", test: () => true },
  { id: "strategic", name: "Strategic accounts", description: "Tier = Strategic", test: (c) => c.tier === "Strategic" },
  { id: "customers", name: "Customers", description: "Lifecycle stage customer", test: (c) => c.lifecycleStage === "customer" || c.lifecycleStage === "evangelist" },
  { id: "pipeline", name: "Open pipeline ≥ Rp 5B", description: "Sum of open deals ≥ Rp 5B", test: (c, ctx) => (ctx.openPipelineByCompany.get(c.id) ?? 0) >= 5_000_000_000 },
  { id: "hierarchy", name: "Parent accounts", description: "Companies with child business units", test: (c, ctx) => (ctx.childCount.get(c.id) ?? 0) > 0 },
  { id: "unenriched", name: "Needs enrichment", description: "Domain enrichment not yet run", test: (c) => !c.enriched },
];
