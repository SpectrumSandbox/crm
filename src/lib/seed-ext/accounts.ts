/* Extra persisted + synced collections for the "accounts" workstream. Every key must be an array (it is spread into
 * the seed bundle in src/lib/seed.ts, persisted to localStorage and synced to the D1 workspace snapshot). */
import type { Capability, CrmObjectType, ID, ISODate } from "../types";

/* ───────────────────────── account plans (Strategic accounts and groups) ───────────────────────── */

export type RelationshipRating = "champion" | "supporter" | "neutral" | "detractor" | "unknown";
export type ReviewCadence = "monthly" | "quarterly" | "semiannual";

export interface AccountPlanGoal {
  id: ID;
  text: string;
  /** "2026-Q4" */
  quarter: string;
  done: boolean;
}

export interface AccountPlanAction {
  id: ID;
  text: string;
  ownerId: ID;
  dueAt: ISODate | null;
  capability: Capability | null;
  /** business unit (the company itself or one of its child units) the action is aimed at */
  unitId: ID | null;
  status: "open" | "done" | "converted";
  /** deal created from this action */
  dealId: ID | null;
}

/** manual whitespace mark for a unit × capability cell that has no won/open deal yet */
export interface WhitespaceMark {
  unitId: ID;
  capability: Capability;
  mark: "target" | "not_fit";
}

export interface AccountPlan {
  id: ID;
  /** the account (usually the parent of a group) */
  companyId: ID;
  ownerId: ID;
  strategy: string;
  cadence: ReviewCadence;
  lastReviewedAt: ISODate | null;
  lastReviewedById: ID | null;
  relationships: { contactId: ID; rating: RelationshipRating; note: string }[];
  whitespace: WhitespaceMark[];
  goals: AccountPlanGoal[];
  actions: AccountPlanAction[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

/* ───────────────────────── saved list views ───────────────────────── */

export interface SavedView {
  id: ID;
  object: Extract<CrmObjectType, "contact" | "company" | "ticket">;
  name: string;
  ownerId: ID;
  /** URL query of the list page, e.g. "view=hot-leads&stage=sql,opportunity&owner=u-rani" */
  query: string;
  /** visible to everyone in the workspace (otherwise only to the owner) */
  shared: boolean;
  createdAt: ISODate;
}

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-04T02:00:00.000Z");
const iso = (days: number) => new Date(NOW + days * DAY).toISOString();

const accountPlans: AccountPlan[] = [
  {
    id: "ap-spl",
    companyId: "c-spl",
    ownerId: "u-rani",
    strategy:
      "Become Selat Port's automation partner across both terminals: land the Priok crane-telemetry rollout as the reference, then expand IT/OT integration and AI yard planning to Surabaya in 2027.",
    cadence: "monthly",
    lastReviewedAt: iso(-41),
    lastReviewedById: "u-rani",
    relationships: [
      { contactId: "k-dian", rating: "champion", note: "Sponsors the digital terminal programme; wants one integrator for both terminals." },
      { contactId: "k-rizky", rating: "supporter", note: "Owns the RTG telemetry pilot — keep the T-1002 fix visible to him." },
      { contactId: "k-fitri", rating: "neutral", note: "Cautious about OT network changes; involve her early in design reviews." },
    ],
    whitespace: [
      { unitId: "c-spl", capability: "Artificial Intelligence", mark: "target" },
      { unitId: "c-spl-tpk", capability: "Unmanned Systems", mark: "not_fit" },
    ],
    goals: [
      { id: "apg-1", text: "Close the Priok crane-telemetry expansion before year end", quarter: "2026-Q4", done: false },
      { id: "apg-2", text: "Run an AI yard-planning discovery workshop in Surabaya", quarter: "2027-Q1", done: false },
    ],
    actions: [
      { id: "apa-1", text: "Propose an IT/OT segmentation assessment for the Surabaya terminal", ownerId: "u-rani", dueAt: iso(10), capability: "IT / OT", unitId: "c-spl", status: "open", dealId: null },
      { id: "apa-2", text: "Share the RTG-07 telemetry root-cause report with Rizky", ownerId: "u-yoga", dueAt: iso(3), capability: null, unitId: "c-spl-tpk", status: "open", dealId: null },
    ],
    createdAt: iso(-90),
    updatedAt: iso(-41),
  },
];

const savedViews: SavedView[] = [
  { id: "sv-energy-hot", object: "contact", name: "Energy & utilities — active", ownerId: "u-arif", query: "view=all&stage=sql,opportunity&q=energy", shared: true, createdAt: iso(-20) },
];

export const accountsSeed = { accountPlans, savedViews };
