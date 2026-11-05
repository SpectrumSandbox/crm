/* Unified HubSpot + Jira entity model. Mirrors src/db/schema.ts (D1). */

export type ID = string;
export type ISODate = string;

/* ───────────────────────── People ───────────────────────── */

export type Team = "Sales" | "Service" | "Engineering" | "Leadership" | "Marketing" | "Finance" | "People";

export interface User {
  id: ID;
  name: string;
  initials: string;
  email: string;
  title: string;
  team: Team;
  color: SpectrumColor;
}

export type SpectrumColor = "magenta" | "blue" | "cyan" | "green" | "yellow" | "orange" | "red";

/* ───────────────────────── CRM ───────────────────────── */

export const LIFECYCLE_STAGES = [
  "subscriber",
  "lead",
  "mql",
  "sql",
  "opportunity",
  "customer",
  "evangelist",
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const LEAD_STATUSES = ["new", "open", "in_progress", "connected", "unqualified", "bad_timing"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const CAPABILITIES = [
  "Artificial Intelligence",
  "Unmanned Systems",
  "Sensor Integration",
  "Control Systems Engineering",
  "Industrial IoT",
  "Prototyping & Manufacturing",
  "IT / OT",
  "Engineering Management",
  "Full Stack Software Development",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export type CompanyTier = "Strategic" | "Enterprise" | "Mid-Market" | "Emerging";

export interface Company {
  id: ID;
  name: string;
  domain: string;
  industry: string;
  city: string;
  country: string;
  employees: number;
  annualRevenue: number; // IDR
  phone: string;
  description: string;
  tier: CompanyTier;
  parentId: ID | null;
  ownerId: ID;
  lifecycleStage: LifecycleStage;
  createdAt: ISODate;
  /** filled by "domain enrichment" */
  enriched: boolean;
  linkedin?: string;
  techStack?: string[];
  /** W3: registered legal name for quotes/invoices, e.g. "PT Nusantara Hydrographic Survey" */
  legalName?: string;
  /** W3: NPWP (15 or 16 digits) */
  npwp?: string;
  /** W3: legal entity kind — drives the suggested faktur code (02 government, 03 BUMN collectors) */
  entityType?: CompanyEntityType;
  /** W3: customer is a VAT-registered entrepreneur (PKP) */
  pkp?: boolean;
  /** W3: billing / tax address printed on quotes */
  billingAddress?: string;
}

/** W3 */
export type CompanyEntityType = "swasta" | "bumn" | "pemerintah" | "asing";

export interface Contact {
  id: ID;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  companyId: ID | null;
  ownerId: ID;
  lifecycleStage: LifecycleStage;
  leadStatus: LeadStatus;
  leadScore: number; // 0..100
  city: string;
  lastContactedAt: ISODate | null;
  createdAt: ISODate;
  source: "Website" | "Referral" | "Event" | "Outbound" | "Partner" | "LinkedIn";
}

export interface PipelineStage {
  id: ID;
  name: string;
  probability: number; // 0..1
  color: SpectrumColor;
  closed?: "won" | "lost";
  /** W3: days without activity before a deal in this stage counts as rotting (defaults per stage in deal-signals.ts) */
  rottingDays?: number;
}

export interface Pipeline {
  id: ID;
  name: string;
  objectType: "deal" | "ticket";
  stages: PipelineStage[];
}

export type Priority3 = "high" | "medium" | "low";

export interface Deal {
  id: ID;
  name: string;
  amount: number; // IDR
  pipelineId: ID;
  stageId: ID;
  closeDate: ISODate;
  ownerId: ID;
  companyId: ID | null;
  contactIds: ID[];
  priority: Priority3;
  dealType: "New Business" | "Expansion" | "Renewal";
  capability: Capability;
  createdAt: ISODate;
  stageEnteredAt: ISODate;
  description: string;
  /** W3: why a closed-lost deal was lost (one of LOST_REASONS in components/crm/deal-signals.ts) */
  lostReason?: string;
  /** W3: competitor that won, when lost to a competitor */
  lostToCompetitor?: string;
  /** W3: free-text note captured when the deal was closed (won or lost) */
  closeNote?: string;
  /** W3: why the deal was won */
  winReason?: string;
  /** W3: client PO / contract number captured on Closed Won */
  poNumber?: string;
  /** W3: owner's forecast category; when absent it is derived from the stage probability */
  forecastCategory?: ForecastCategory;
  /** W3: origination evidence (Policy v4.0 §4.1) */
  origination?: DealOrigination;
}

/** W3 */
export type ForecastCategory = "pipeline" | "best_case" | "commit" | "omitted";

/** W3: who originated the opportunity and the evidence for it (§4.1). Locked once the deal reaches Proposal Sent. */
export interface DealOrigination {
  channel: "personal" | "follow_on" | "company";
  /** for company channels: website / tender / management_referral / repeat_order; for personal: network / own_idea / event */
  source?: string;
  originatorId: ID | null;
  /** earliest documented client contact in the CRM */
  firstContactAt: ISODate | null;
  evidenceActivityId: ID | null;
  note?: string;
  lockedAt?: ISODate | null;
  recordedById?: ID;
  recordedAt?: ISODate;
}

/** W3: one tracked change on a deal (persisted collection `dealHistory`) */
export interface DealChange {
  id: ID;
  dealId: ID;
  field: "amount" | "closeDate" | "stageId" | "ownerId" | "forecastCategory";
  from: string | number | null;
  to: string | number | null;
  at: ISODate;
  byId: ID;
}

/** W3: workspace quote rules + supplier identity (persisted collection `quoteSettings`, one row) */
export interface QuoteSettings {
  id: ID;
  /** Policy v4.0 §4.7 — quotations must be checked by Finance before they are sent */
  financeCheckRequired: boolean;
  /** any line discount at or above this % also needs director approval */
  directorDiscountPct: number;
  /** quotes at or above this total (excl. VAT, IDR) also need director approval */
  directorTotalIdr: number;
  defaultValidityDays: number;
  supplierLegalName: string;
  supplierNpwp: string;
  supplierAddress: string;
  supplierBank: string;
  /** supplier is VAT-registered (PKP) — charges PPN */
  supplierPkp: boolean;
  /** supplier pays UMKM final tax (PP 55/2022, Policy §5.4) — clients withhold 0.5 % instead of PPh 23 */
  umkmFinalTax: boolean;
  updatedAt?: ISODate;
  updatedById?: ID;
}

/** W3: one termin on a quote */
export interface PaymentMilestone {
  id: ID;
  label: string;
  pct: number;
  trigger: "signing" | "delivery" | "acceptance" | "date";
  dueAt?: ISODate | null;
}

export type TicketPriority = "urgent" | "high" | "medium" | "low";

export interface Ticket {
  id: ID;
  subject: string;
  description: string;
  pipelineId: ID;
  stageId: ID;
  priority: TicketPriority;
  category: "Hardware Fault" | "Software Defect" | "Field Support" | "Documentation" | "Training";
  companyId: ID | null;
  contactId: ID | null;
  ownerId: ID;
  createdAt: ISODate;
  slaDueAt: ISODate;
  closedAt: ISODate | null;
  /** SLA clock paused (ticket waiting on the customer) since this instant; slaDueAt is pushed out on resume */
  slaPausedAt?: ISODate | null;
  /** total time the SLA clock has spent paused, ms (for reporting) */
  slaPausedMs?: number;
  /** how the SLA deadline is counted: "business" = Mon–Fri 08:00–17:00 WIB excl. public holidays, "clock" = 24/7 */
  slaBasis?: "business" | "clock";
  /** customer satisfaction captured on resolve, 1–5 */
  csat?: number | null;
  csatComment?: string;
}

export interface Product {
  id: ID;
  sku: string;
  name: string;
  description: string;
  unitPrice: number; // IDR
  billing: "one_time" | "monthly" | "annual";
  category: Capability;
  /** W3: goods or services for withholding (PPh 23 applies to services); derived from the SKU when absent */
  taxKind?: "goods" | "service";
}

export interface LineItem {
  id: ID;
  dealId: ID;
  productId: ID;
  quantity: number;
  unitPrice: number;
  discountPct: number;
}

export type QuoteStatus = "draft" | "pending_approval" | "approved" | "sent" | "signed" | "expired";

export interface Quote {
  id: ID;
  number: string;
  dealId: ID;
  title: string;
  status: QuoteStatus;
  ownerId: ID;
  createdAt: ISODate;
  expiresAt: ISODate;
  /** snapshot of line items at quote time */
  lineItems: Omit<LineItem, "dealId">[];
  taxPct: number;
  /** W3: PPN rate (12 since 2025) applied to DPP; absent on legacy quotes (taxPct 11 = 12 % × 11/12) */
  vatRate?: number;
  /** W3: DPP nilai lain factor (11/12 per PMK 131/2024) */
  dppFactor?: number;
  /** W3: faktur pajak transaction code (04 DPP nilai lain, 02 government collector, 03 other collector) */
  fakturCode?: string;
  /** W3: document language */
  language?: "id" | "en" | "both";
  paymentSchedule?: PaymentMilestone[];
  /** W3: Finance check (§4.7) */
  financeCheckedById?: ID | null;
  financeCheckedAt?: ISODate | null;
  /** W3: director approval when over the threshold */
  directorApprovedById?: ID | null;
  directorApprovedAt?: ISODate | null;
  submittedAt?: ISODate | null;
  sentAt?: ISODate | null;
  signedAt?: ISODate | null;
  /** W3: the quote this one revises (re-issue) */
  supersedesId?: ID | null;
  supersededById?: ID | null;
  /** W3: payment terms / notes printed on the quote */
  terms?: string;
}

/* ───────────────────────── Activities ───────────────────────── */

export type ActivityType = "note" | "email" | "call" | "meeting" | "task" | "jira";

export interface ActivityLinks {
  contactIds: ID[];
  companyIds: ID[];
  dealIds: ID[];
  ticketIds: ID[];
}

export interface Activity {
  id: ID;
  type: ActivityType;
  subject: string;
  body: string;
  timestamp: ISODate;
  ownerId: ID;
  links: ActivityLinks;
  // type-specific
  direction?: "inbound" | "outbound";
  callOutcome?: "connected" | "left_voicemail" | "no_answer" | "busy" | "wrong_number";
  durationMin?: number;
  dueAt?: ISODate;
  done?: boolean;
  issueId?: ID;
  pinned?: boolean;
  /** W3: who logged it when different from the owner (e.g. a task assigned to someone else) */
  createdById?: ID;
}

/* ───────────────────────── Agile ───────────────────────── */

export interface Project {
  id: ID;
  key: string;
  name: string;
  leadId: ID;
  description: string;
  color: SpectrumColor;
  /** next issue number to hand out (keys are never reused after a delete) */
  nextIssueNumber?: number;
  /** board WIP limits per status, shared by everyone on the workspace */
  wipLimits?: Partial<Record<IssueStatus, number>>;
}

export type SprintState = "active" | "future" | "closed";

export interface Sprint {
  id: ID;
  projectId: ID;
  name: string;
  goal: string;
  startDate: ISODate;
  endDate: ISODate;
  state: SprintState;
  capacity: number; // story points
  /** per-person capacity in story points for this sprint (userId → points) */
  memberCapacity?: Record<ID, number>;
}

export interface Epic {
  id: ID;
  projectId: ID;
  key: string;
  name: string;
  summary: string;
  color: SpectrumColor;
  status: IssueStatus;
  ownerId: ID;
}

export const ISSUE_TYPES = ["story", "task", "bug", "deal_action", "support_escalation", "subtask"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_STATUSES = ["backlog", "todo", "in_progress", "in_review", "done"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_PRIORITIES = ["highest", "high", "medium", "low", "lowest"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

export interface Issue {
  id: ID;
  key: string;
  projectId: ID;
  type: IssueType;
  summary: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  assigneeId: ID | null;
  reporterId: ID;
  epicId: ID | null;
  sprintId: ID | null;
  parentId: ID | null;
  storyPoints: number | null;
  labels: string[];
  rank: number; // ordering within a status column
  createdAt: ISODate;
  updatedAt: ISODate;
  dueDate: ISODate | null;
  /** triage inbox state; undefined = never needed triage */
  triage?: TriageState;
  triageNote?: string;
  /** snoozed in triage until this time */
  snoozedUntil?: ISODate | null;
  /** set when declined as a duplicate */
  duplicateOfId?: ID | null;
}

export type TriageState = "pending" | "accepted" | "declined";

export const ISSUE_LINK_TYPES = ["blocks", "relates_to", "duplicates"] as const;
/** read as "<from issue> blocks / relates to / duplicates <to issue>" */
export type IssueLinkType = (typeof ISSUE_LINK_TYPES)[number];

export interface IssueLink {
  id: ID;
  fromIssueId: ID;
  toIssueId: ID;
  type: IssueLinkType;
  createdAt: ISODate;
  createdById: ID;
}

export const TRACKED_ISSUE_FIELDS = ["status", "assigneeId", "priority", "sprintId", "storyPoints", "epicId", "parentId", "type", "summary", "description", "labels", "dueDate"] as const;
export type TrackedIssueField = (typeof TRACKED_ISSUE_FIELDS)[number];

/** One recorded change on an issue (persisted + synced; capped per issue). */
export interface IssueHistoryEntry {
  id: ID;
  issueId: ID;
  /** a tracked field, or "created" for free-form notes (clone, restore, triage…) */
  field: TrackedIssueField | "created";
  from: string | number | null;
  to: string | number | null;
  actorId: ID;
  at: ISODate;
  note?: string;
}

/** Saved when a sprint is completed (Jira-style sprint report). Points exclude sub-tasks. */
export interface SprintReport {
  id: ID;
  sprintId: ID;
  projectId: ID;
  sprintName: string;
  startDate: ISODate;
  endDate: ISODate;
  closedAt: ISODate;
  closedById: ID;
  committed: { count: number; points: number };
  added: { count: number; points: number };
  removed: { count: number; points: number };
  completed: { count: number; points: number };
  carriedOver: { count: number; points: number };
  /** null = backlog */
  carriedToSprintId: ID | null;
  /** remaining points at the end of each sprint day (WIB yyyy-mm-dd) */
  daily: { day: string; remaining: number }[];
}

export interface IssueComment {
  id: ID;
  issueId: ID;
  authorId: ID;
  body: string;
  createdAt: ISODate;
}

/* ───────────────────────── Cross-domain links ───────────────────────── */

export type CrmObjectType = "contact" | "company" | "deal" | "ticket";
export type AgileObjectType = "issue" | "epic";

export const LINK_TYPES = ["blocks", "blocked_by", "relates_to", "escalated_from", "implements"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export interface CrossLink {
  id: ID;
  agileType: AgileObjectType;
  agileId: ID;
  crmType: CrmObjectType;
  crmId: ID;
  /** read from the Jira side: "<issue> <linkType> <crm record>" */
  linkType: LinkType;
  createdAt: ISODate;
  createdById: ID;
}

/* ───────────────────────── Engagement / automation (Phase 3 UI) ───────────────────────── */

export interface EmailTemplate {
  id: ID;
  name: string;
  subject: string;
  body: string; // supports {{contact.first_name}} style tokens
  ownerId: ID;
  category: "Prospecting" | "Follow-up" | "Meeting" | "Onboarding" | "Support";
  /** W10: delivery channel of the template (default "email") */
  templateChannel?: "email" | "whatsapp";
  /** W10: language of the template text (default "en") */
  templateLanguage?: "id" | "en";
  /** W10: last edit */
  templateUpdatedAt?: ISODate;
}

export interface SequenceStep {
  id: ID;
  order: number;
  kind: "email" | "task" | "call" | "whatsapp";
  delayDays: number;
  templateId: ID | null;
  taskNote: string;
}

export interface Sequence {
  id: ID;
  name: string;
  ownerId: ID;
  active: boolean;
  steps: SequenceStep[];
  /** W10: what the sequence is for */
  description?: string;
  /** W10: auto-pause an enrolment when the contact replies (default true) */
  stopOnReply?: boolean;
  /** W10 */
  createdAt?: ISODate;
}

export interface SequenceEnrollment {
  id: ID;
  sequenceId: ID;
  contactId: ID;
  currentStep: number;
  status: "active" | "paused" | "finished" | "replied" | "bounced";
  enrolledAt: ISODate;
  /** W10: when the previous step was executed or skipped (the next step's delay counts from here) */
  lastStepAt?: ISODate | null;
  /** W10: snoozed / rescheduled due time of the current step */
  dueOverrideAt?: ISODate | null;
  /** W10: why the enrolment is paused / replied / finished */
  statusReason?: string;
  /** W10: who enrolled the contact */
  enrolledById?: ID;
}

export interface Workflow {
  id: ID;
  name: string;
  enabled: boolean;
  trigger: { object: CrmObjectType | AgileObjectType; event: string; condition: string };
  actions: { kind: string; config: Record<string, string> }[];
  runs: number;
  lastRunAt: ISODate | null;
  /** W10 */
  description?: string;
  createdById?: ID;
  createdAt?: ISODate;
  updatedAt?: ISODate;
}

/* ───────────────────────── Records (generic helpers) ───────────────────────── */

export type CrmRecord =
  | { type: "contact"; record: Contact }
  | { type: "company"; record: Company }
  | { type: "deal"; record: Deal }
  | { type: "ticket"; record: Ticket };
