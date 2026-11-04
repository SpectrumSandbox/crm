/* Unified HubSpot + Jira entity model. Mirrors src/db/schema.ts (D1). */

export type ID = string;
export type ISODate = string;

/* ───────────────────────── People ───────────────────────── */

export type Team = "Sales" | "Service" | "Engineering" | "Leadership" | "Marketing";

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
}

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
}

export interface Product {
  id: ID;
  sku: string;
  name: string;
  description: string;
  unitPrice: number; // IDR
  billing: "one_time" | "monthly" | "annual";
  category: Capability;
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
}

/* ───────────────────────── Agile ───────────────────────── */

export interface Project {
  id: ID;
  key: string;
  name: string;
  leadId: ID;
  description: string;
  color: SpectrumColor;
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
}

export interface SequenceStep {
  id: ID;
  order: number;
  kind: "email" | "task" | "call";
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
}

export interface SequenceEnrollment {
  id: ID;
  sequenceId: ID;
  contactId: ID;
  currentStep: number;
  status: "active" | "paused" | "finished" | "replied" | "bounced";
  enrolledAt: ISODate;
}

export interface Workflow {
  id: ID;
  name: string;
  enabled: boolean;
  trigger: { object: CrmObjectType | AgileObjectType; event: string; condition: string };
  actions: { kind: string; config: Record<string, string> }[];
  runs: number;
  lastRunAt: ISODate | null;
}

/* ───────────────────────── Records (generic helpers) ───────────────────────── */

export type CrmRecord =
  | { type: "contact"; record: Contact }
  | { type: "company"; record: Company }
  | { type: "deal"; record: Deal }
  | { type: "ticket"; record: Ticket };
