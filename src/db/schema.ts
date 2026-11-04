/**
 * Unified HubSpot + Jira schema for Cloudflare D1 (SQLite) via Drizzle ORM.
 * The hand-written migration in drizzle/migrations/0000_init.sql matches this file;
 * after editing, run `npm run db:generate` to produce the next migration.
 */
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey();
const createdAt = () => text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);

/* ───────────── people ───────────── */

export const users = sqliteTable("users", {
  id: id(),
  name: text("name").notNull(),
  initials: text("initials").notNull(),
  email: text("email").notNull().unique(),
  title: text("title").notNull(),
  team: text("team").notNull(),
  color: text("color").notNull(),
});

/* ───────────── CRM objects ───────────── */

export const companies = sqliteTable(
  "companies",
  {
    id: id(),
    name: text("name").notNull(),
    domain: text("domain").notNull(),
    industry: text("industry").notNull(),
    city: text("city").notNull(),
    country: text("country").notNull().default("Indonesia"),
    employees: integer("employees").notNull().default(0),
    annualRevenue: integer("annual_revenue").notNull().default(0),
    phone: text("phone").notNull().default(""),
    description: text("description").notNull().default(""),
    tier: text("tier").notNull(),
    parentId: text("parent_id"),
    ownerId: text("owner_id").notNull().references(() => users.id),
    lifecycleStage: text("lifecycle_stage").notNull(),
    enriched: integer("enriched", { mode: "boolean" }).notNull().default(false),
    linkedin: text("linkedin"),
    techStack: text("tech_stack", { mode: "json" }).$type<string[]>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("companies_domain_uq").on(t.domain), index("companies_parent_idx").on(t.parentId), index("companies_owner_idx").on(t.ownerId)],
);

export const contacts = sqliteTable(
  "contacts",
  {
    id: id(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull().default(""),
    jobTitle: text("job_title").notNull().default(""),
    companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
    ownerId: text("owner_id").notNull().references(() => users.id),
    lifecycleStage: text("lifecycle_stage").notNull(),
    leadStatus: text("lead_status").notNull(),
    leadScore: integer("lead_score").notNull().default(0),
    city: text("city").notNull().default(""),
    source: text("source").notNull(),
    lastContactedAt: text("last_contacted_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("contacts_email_uq").on(t.email), index("contacts_company_idx").on(t.companyId), index("contacts_score_idx").on(t.leadScore)],
);

export const pipelines = sqliteTable("pipelines", {
  id: id(),
  name: text("name").notNull(),
  objectType: text("object_type").notNull(), // deal | ticket
});

export const pipelineStages = sqliteTable(
  "pipeline_stages",
  {
    id: id(),
    pipelineId: text("pipeline_id").notNull().references(() => pipelines.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    probability: real("probability").notNull().default(0),
    color: text("color").notNull(),
    closed: text("closed"), // won | lost | null
  },
  (t) => [index("stages_pipeline_idx").on(t.pipelineId, t.position)],
);

export const deals = sqliteTable(
  "deals",
  {
    id: id(),
    name: text("name").notNull(),
    amount: integer("amount").notNull().default(0),
    pipelineId: text("pipeline_id").notNull().references(() => pipelines.id),
    stageId: text("stage_id").notNull().references(() => pipelineStages.id),
    closeDate: text("close_date").notNull(),
    ownerId: text("owner_id").notNull().references(() => users.id),
    companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
    priority: text("priority").notNull(),
    dealType: text("deal_type").notNull(),
    capability: text("capability").notNull(),
    description: text("description").notNull().default(""),
    stageEnteredAt: text("stage_entered_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("deals_stage_idx").on(t.pipelineId, t.stageId), index("deals_company_idx").on(t.companyId), index("deals_close_idx").on(t.closeDate)],
);

export const dealContacts = sqliteTable(
  "deal_contacts",
  {
    dealId: text("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
    contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.dealId, t.contactId] })],
);

export const tickets = sqliteTable(
  "tickets",
  {
    id: id(),
    subject: text("subject").notNull(),
    description: text("description").notNull().default(""),
    pipelineId: text("pipeline_id").notNull().references(() => pipelines.id),
    stageId: text("stage_id").notNull().references(() => pipelineStages.id),
    priority: text("priority").notNull(),
    category: text("category").notNull(),
    companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    ownerId: text("owner_id").notNull().references(() => users.id),
    slaDueAt: text("sla_due_at").notNull(),
    closedAt: text("closed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("tickets_stage_idx").on(t.stageId), index("tickets_sla_idx").on(t.slaDueAt)],
);

export const products = sqliteTable("products", {
  id: id(),
  sku: text("sku").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  unitPrice: integer("unit_price").notNull(),
  billing: text("billing").notNull(), // one_time | monthly | annual
  category: text("category").notNull(),
});

export const lineItems = sqliteTable(
  "line_items",
  {
    id: id(),
    dealId: text("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull().references(() => products.id),
    quantity: real("quantity").notNull().default(1),
    unitPrice: integer("unit_price").notNull(),
    discountPct: real("discount_pct").notNull().default(0),
  },
  (t) => [index("line_items_deal_idx").on(t.dealId)],
);

export const quotes = sqliteTable(
  "quotes",
  {
    id: id(),
    number: text("number").notNull().unique(),
    dealId: text("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status").notNull(), // draft | pending_approval | approved | sent | signed | expired
    ownerId: text("owner_id").notNull().references(() => users.id),
    taxPct: real("tax_pct").notNull().default(11),
    expiresAt: text("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("quotes_deal_idx").on(t.dealId)],
);

export const quoteLineItems = sqliteTable("quote_line_items", {
  id: id(),
  quoteId: text("quote_id").notNull().references(() => quotes.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => products.id),
  quantity: real("quantity").notNull(),
  unitPrice: integer("unit_price").notNull(),
  discountPct: real("discount_pct").notNull().default(0),
});

/* ───────────── activities (timeline) ───────────── */

export const activities = sqliteTable(
  "activities",
  {
    id: id(),
    type: text("type").notNull(), // note | email | call | meeting | task | jira
    subject: text("subject").notNull(),
    body: text("body").notNull().default(""),
    timestamp: text("timestamp").notNull(),
    ownerId: text("owner_id").notNull().references(() => users.id),
    direction: text("direction"),
    callOutcome: text("call_outcome"),
    durationMin: integer("duration_min"),
    dueAt: text("due_at"),
    done: integer("done", { mode: "boolean" }),
    issueId: text("issue_id"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("activities_ts_idx").on(t.timestamp)],
);

/** polymorphic association: one activity can sit on many contact/company/deal/ticket timelines */
export const activityLinks = sqliteTable(
  "activity_links",
  {
    activityId: text("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
    objectType: text("object_type").notNull(), // contact | company | deal | ticket
    objectId: text("object_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.activityId, t.objectType, t.objectId] }), index("activity_links_obj_idx").on(t.objectType, t.objectId)],
);

/* ───────────── agile objects ───────────── */

export const projects = sqliteTable("projects", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  leadId: text("lead_id").notNull().references(() => users.id),
  description: text("description").notNull().default(""),
  color: text("color").notNull(),
});

export const sprints = sqliteTable(
  "sprints",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal").notNull().default(""),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    state: text("state").notNull(), // active | future | closed
    capacity: integer("capacity").notNull().default(0),
  },
  (t) => [index("sprints_project_idx").on(t.projectId, t.state)],
);

export const epics = sqliteTable("epics", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  summary: text("summary").notNull().default(""),
  color: text("color").notNull(),
  status: text("status").notNull(),
  ownerId: text("owner_id").notNull().references(() => users.id),
});

export const issues = sqliteTable(
  "issues",
  {
    id: id(),
    key: text("key").notNull().unique(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // story | task | bug | deal_action | support_escalation | subtask
    summary: text("summary").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull(), // backlog | todo | in_progress | in_review | done
    priority: text("priority").notNull(),
    assigneeId: text("assignee_id").references(() => users.id, { onDelete: "set null" }),
    reporterId: text("reporter_id").notNull().references(() => users.id),
    epicId: text("epic_id").references(() => epics.id, { onDelete: "set null" }),
    sprintId: text("sprint_id").references(() => sprints.id, { onDelete: "set null" }),
    parentId: text("parent_id"),
    storyPoints: integer("story_points"),
    labels: text("labels", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    rank: real("rank").notNull(),
    dueDate: text("due_date"),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("issues_board_idx").on(t.projectId, t.status, t.rank), index("issues_sprint_idx").on(t.sprintId), index("issues_epic_idx").on(t.epicId)],
);

export const issueComments = sqliteTable(
  "issue_comments",
  {
    id: id(),
    issueId: text("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull().references(() => users.id),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("issue_comments_issue_idx").on(t.issueId)],
);

/* ───────────── HubSpot ⇄ Jira bridge ───────────── */

export const crossLinks = sqliteTable(
  "cross_links",
  {
    id: id(),
    agileType: text("agile_type").notNull(), // issue | epic
    agileId: text("agile_id").notNull(),
    crmType: text("crm_type").notNull(), // contact | company | deal | ticket
    crmId: text("crm_id").notNull(),
    linkType: text("link_type").notNull(), // blocks | blocked_by | relates_to | escalated_from | implements
    createdById: text("created_by_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("cross_links_uq").on(t.agileType, t.agileId, t.crmType, t.crmId, t.linkType),
    index("cross_links_crm_idx").on(t.crmType, t.crmId),
    index("cross_links_agile_idx").on(t.agileType, t.agileId),
  ],
);

/* ───────────── engagement & automation ───────────── */

export const emailTemplates = sqliteTable("email_templates", {
  id: id(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  category: text("category").notNull(),
  ownerId: text("owner_id").notNull().references(() => users.id),
});

export const sequences = sqliteTable("sequences", {
  id: id(),
  name: text("name").notNull(),
  ownerId: text("owner_id").notNull().references(() => users.id),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const sequenceSteps = sqliteTable("sequence_steps", {
  id: id(),
  sequenceId: text("sequence_id").notNull().references(() => sequences.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  kind: text("kind").notNull(), // email | task | call
  delayDays: integer("delay_days").notNull().default(0),
  templateId: text("template_id").references(() => emailTemplates.id, { onDelete: "set null" }),
  taskNote: text("task_note").notNull().default(""),
});

export const sequenceEnrollments = sqliteTable("sequence_enrollments", {
  id: id(),
  sequenceId: text("sequence_id").notNull().references(() => sequences.id, { onDelete: "cascade" }),
  contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  currentStep: integer("current_step").notNull().default(1),
  status: text("status").notNull(),
  enrolledAt: text("enrolled_at").notNull(),
});

export const workflows = sqliteTable("workflows", {
  id: id(),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  trigger: text("trigger", { mode: "json" }).$type<{ object: string; event: string; condition: string }>().notNull(),
  actions: text("actions", { mode: "json" }).$type<{ kind: string; config: Record<string, string> }[]>().notNull(),
  runs: integer("runs").notNull().default(0),
  lastRunAt: text("last_run_at"),
});
