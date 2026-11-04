/**
 * Unified HubSpot + Jira schema for Cloudflare D1 (SQLite) via Drizzle ORM.
 * The hand-written migration in drizzle/migrations/0000_init.sql matches this file;
 * after editing, run `npm run db:generate` to produce the next migration.
 */
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Appeal, BonusRun, CostBreakdown, Decision, EmployeeProfile, GovernanceRole, Milestone, PrcScores, ProjectRole, RiskItem, TeamAmendment } from "../lib/initiatives/types";

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

/* ───────────── Project Initiative & Compensation Policy v3.0 ───────────── */
/* Money columns are IDR. Revenue/salary inputs are whole rupiah (integer); computed bonus amounts keep fractions (real). */

/** HR record driving eligibility (§2.1) and payment conditions (§4.5). One row per user. */
export const employeeProfiles = sqliteTable(
  "employee_profiles",
  {
    userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    employmentType: text("employment_type").notNull(), // full_time_permanent | probationary | part_time | fixed_term_contract | contractor | intern | temporary | secondment
    hireDate: text("hire_date").notNull(),
    probationEndDate: text("probation_end_date"),
    annualBaseSalary: integer("annual_base_salary").notNull().default(0),
    contractedHoursPct: integer("contracted_hours_pct"), // part-time: caps the allocation factor (§3.1)
    contractEndDate: text("contract_end_date"), // fixed-term (PKWT)
    directManagerId: text("direct_manager_id").references(() => users.id, { onDelete: "set null" }),
    goodStanding: integer("good_standing", { mode: "boolean" }).notNull().default(true),
    activeWrittenWarning: integer("active_written_warning", { mode: "boolean" }).notNull().default(false),
    onPip: integer("on_pip", { mode: "boolean" }).notNull().default(false),
    pipApprovedByPrc: integer("pip_approved_by_prc", { mode: "boolean" }).notNull().default(false),
    underInvestigation: integer("under_investigation", { mode: "boolean" }).notNull().default(false),
    suspended: integer("suspended", { mode: "boolean" }).notNull().default(false),
    unpaidLeaveDays: integer("unpaid_leave_days").notNull().default(0),
    resignationNoticeAt: text("resignation_notice_at"),
    terminationNoticeAt: text("termination_notice_at"),
    separation: text("separation", { mode: "json" }).$type<EmployeeProfile["separation"]>(),
    acknowledgmentSignedAt: text("acknowledgment_signed_at"),
    governanceRoles: text("governance_roles", { mode: "json" }).$type<GovernanceRole[]>().notNull().default(sql`'[]'`),
  },
  (t) => [index("employee_profiles_manager_idx").on(t.directManagerId)],
);

/** Policy v4.0 §4 proposal → approval → delivery (ongoing projects register). */
export const initiatives = sqliteTable(
  "initiatives",
  {
    id: id(),
    trackingNo: text("tracking_no").notNull().default(""),
    code: text("code"),
    title: text("title").notNull(),
    type: text("type").notNull(), // A | B | C
    status: text("status").notNull(), // draft | submitted | screening | evaluation | conditional | deferred | rejected | approved | active | completed
    initiatorId: text("initiator_id").notNull().references(() => users.id),
    origination: text("origination"), // personal | follow_on | company (§4.1)
    firstContactAt: text("first_contact_at"),
    summary: text("summary").notNull().default(""),
    valueProposition: text("value_proposition").notNull().default(""),
    scope: text("scope").notNull().default(""),
    deliverables: text("deliverables").notNull().default(""),
    exclusions: text("exclusions").notNull().default(""),
    successCriteria: text("success_criteria").notNull().default(""),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    milestones: text("milestones", { mode: "json" }).$type<Milestone[]>().notNull().default(sql`'[]'`),
    companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
    dealId: text("deal_id").references(() => deals.id, { onDelete: "set null" }),
    contractStatus: text("contract_status").notNull().default("none"), // none | verbal | loi | signed
    newClient: integer("new_client", { mode: "boolean" }).notNull().default(false),
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),
    revenue: text("revenue", { mode: "json" }).$type<{ expected: number; best: number; worst: number }>().notNull(),
    costs: text("costs", { mode: "json" }).$type<CostBreakdown>().notNull(),
    risks: text("risks", { mode: "json" }).$type<RiskItem[]>().notNull().default(sql`'[]'`),
    highRisk: integer("high_risk", { mode: "boolean" }).notNull().default(false),
    warranty: integer("warranty", { mode: "boolean" }).notNull().default(false),
    deferralMonths: integer("deferral_months").notNull().default(6),
    lockedSharePct: real("locked_share_pct"), // PRC-fixed rate y, or v3.0 flat share kept (§15.1)
    unusualTerms: integer("unusual_terms", { mode: "boolean" }).notNull().default(false),
    deferralPct: real("deferral_pct"),
    policyVersion: text("policy_version").notNull().default("4.0"),
    standardBonus: integer("standard_bonus"), // Type C guaranteed minimum (§8.6)
    pilot: integer("pilot", { mode: "boolean" }).notNull().default(false),
    jiraProjectId: text("jira_project_id"),
    demo: integer("demo", { mode: "boolean" }).notNull().default(false),
    registeredRetroactively: integer("registered_retroactively", { mode: "boolean" }).notNull().default(false),
    shareNote: text("share_note").notNull().default(""),
    submittedAt: text("submitted_at"),
    acknowledgedAt: text("acknowledged_at"),
    primaryReviewerId: text("primary_reviewer_id").references(() => users.id, { onDelete: "set null" }),
    scores: text("scores", { mode: "json" }).$type<PrcScores>(),
    decision: text("decision", { mode: "json" }).$type<Decision>(),
    appeal: text("appeal", { mode: "json" }).$type<Appeal>(),
    approvedAt: text("approved_at"),
    completedAt: text("completed_at"),
    epicId: text("epic_id").references(() => epics.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("initiatives_code_uq").on(t.code),
    index("initiatives_status_idx").on(t.status),
    index("initiatives_tracking_idx").on(t.trackingNo),
    index("initiatives_initiator_idx").on(t.initiatorId),
    index("initiatives_company_idx").on(t.companyId),
    index("initiatives_deal_idx").on(t.dealId),
  ],
);

/** §6.5 Team Allocation Ledger rows: roles, weights, allocation factor, dates on the team. */
export const initiativeMembers = sqliteTable(
  "initiative_members",
  {
    id: id(),
    initiativeId: text("initiative_id").notNull().references(() => initiatives.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id),
    roles: text("roles", { mode: "json" }).$type<ProjectRole[]>().notNull().default(sql`'[]'`),
    specialistWeight: real("specialist_weight"),
    weightOverride: real("weight_override"),
    consent: text("consent").notNull().default("pending"), // pending | accepted | declined
    managerApproved: integer("manager_approved", { mode: "boolean" }).notNull().default(false),
    prcApproved: integer("prc_approved", { mode: "boolean" }).notNull().default(false),
    application: integer("application", { mode: "boolean" }).notNull().default(false),
    allocationPct: real("allocation_pct").notNull().default(20),
    joinedAt: text("joined_at").notNull(),
    leftAt: text("left_at"),
    removal: text("removal", { mode: "json" }).$type<{ stage: "none" | "verbal" | "written" | "removed"; updatedAt: string | null; note: string }>().notNull(),
    allocationFactor: real("allocation_factor").notNull().default(1),
    weightNote: text("weight_note").notNull().default(""),
    authority: text("authority").notNull().default(""),
  },
  (t) => [index("initiative_members_initiative_idx").on(t.initiativeId), index("initiative_members_user_idx").on(t.userId)],
);

/** §8.1 client payments: earned and collected, with the work period they pay for (§6.5). */
export const revenueEntries = sqliteTable(
  "revenue_entries",
  {
    id: id(),
    initiativeId: text("initiative_id").notNull().references(() => initiatives.id, { onDelete: "cascade" }),
    month: text("month").notNull(), // YYYY-MM
    revenue: integer("revenue").notNull().default(0),
    directCosts: integer("direct_costs").notNull().default(0),
    basis: text("basis").notNull(), // recognized | milestone
    received: integer("received", { mode: "boolean" }).notNull().default(false),
    collectedAt: text("collected_at"),
    workPeriodStart: text("work_period_start"),
    workPeriodEnd: text("work_period_end"),
    note: text("note").notNull().default(""),
  },
  (t) => [index("revenue_entries_initiative_idx").on(t.initiativeId, t.month), index("revenue_entries_month_idx").on(t.month)],
);

/** §8.2 monthly cycle with the §9.1 break-even test and cash check. */
export const bonusRuns = sqliteTable(
  "bonus_runs",
  {
    id: id(),
    month: text("month").notNull(), // YYYY-MM
    status: text("status").notNull(), // draft | failed | certified | released
    policyVersion: text("policy_version").notNull().default("4.0"),
    companyRevenue: integer("company_revenue").notNull().default(0),
    directCosts: integer("direct_costs").notNull().default(0),
    overheads: integer("overheads").notNull().default(0),
    cash: integer("cash").notNull().default(0),
    fixedCostsMonthly: integer("fixed_costs_monthly").notNull().default(0),
    operatingResult: real("operating_result").notNull(),
    cashAfter: real("cash_after").notNull().default(0),
    payoutPct: real("payout_pct").notNull().default(1),
    totals: text("totals", { mode: "json" }).$type<BonusRun["totals"]>().notNull(),
    certifiedById: text("certified_by_id").references(() => users.id),
    certifiedAt: text("certified_at"),
    releasedById: text("released_by_id").references(() => users.id),
    releasedAt: text("released_at"),
  },
  (t) => [uniqueIndex("bonus_runs_month_uq").on(t.month)],
);

/** One line per member per project in a cycle (§6.6 split, §8.6 top-ups, §9.2–9.3, §10–11 outcomes). */
export const bonusLines = sqliteTable(
  "bonus_lines",
  {
    runId: text("run_id").notNull().references(() => bonusRuns.id, { onDelete: "cascade" }),
    initiativeId: text("initiative_id").notNull().references(() => initiatives.id),
    userId: text("user_id").notNull().references(() => users.id),
    weight: real("weight").notNull(),
    totalWeight: real("total_weight").notNull(),
    sharePct: real("share_pct").notNull(),
    netRevenue: real("net_revenue").notNull(),
    pool: real("pool").notNull(),
    gross: real("gross").notNull(),
    weightDays: real("weight_days").notNull().default(0),
    totalWeightDays: real("total_weight_days").notNull().default(0),
    topUp: real("top_up").notNull().default(0),
    topUpDeducted: real("top_up_deducted").notNull().default(0),
    guaranteed: real("guaranteed").notNull().default(0),
    carriedIn: real("carried_in").notNull().default(0),
    payable: real("payable").notNull().default(0),
    deferred: real("deferred").notNull().default(0),
    carriedOver: real("carried_over").notNull().default(0),
    withheld: real("withheld").notNull().default(0),
    forfeited: real("forfeited").notNull().default(0),
    held: real("held").notNull().default(0),
    status: text("status").notNull(), // payable | withheld_probation | partially_deferred | carried_forward | forfeited | held | ineligible
    notes: text("notes", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  },
  (t) => [primaryKey({ columns: [t.runId, t.initiativeId, t.userId] }), index("bonus_lines_user_idx").on(t.userId), index("bonus_lines_initiative_idx").on(t.initiativeId)],
);

/** §9.3 high-risk deferrals (released 6–12 months after close). */
export const deferredBonuses = sqliteTable(
  "deferred_bonuses",
  {
    id: id(),
    month: text("month").notNull(),
    initiativeId: text("initiative_id").notNull().references(() => initiatives.id),
    userId: text("user_id").notNull().references(() => users.id),
    amount: real("amount").notNull(),
    vestAt: text("vest_at").notNull(),
    status: text("status").notNull().default("pending"), // pending | released | forfeited
    releasedAmount: real("released_amount").notNull().default(0),
    note: text("note").notNull().default(""),
  },
  (t) => [index("deferred_bonuses_user_idx").on(t.userId), index("deferred_bonuses_vest_idx").on(t.status, t.vestAt)],
);

/** §11.4 probation outcome — held balance paid on confirmation or with final pay. */
export const probationOutcomes = sqliteTable(
  "probation_outcomes",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    outcome: text("outcome").notNull(), // completed | forfeited
    amount: real("amount").notNull().default(0),
    decidedAt: text("decided_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.decidedAt] })],
);

/** §9.4 clawback cases. */
export const clawbacks = sqliteTable(
  "clawbacks",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id),
    initiativeId: text("initiative_id").notNull().references(() => initiatives.id),
    trigger: text("trigger").notNull(), // revenue_reversal | misconduct | data_error
    paidAt: text("paid_at").notNull(),
    originalPaid: real("original_paid").notNull(),
    recalculated: real("recalculated").notNull(),
    personallyAtFault: integer("personally_at_fault", { mode: "boolean" }).notNull().default(false),
    writtenAgreement: integer("written_agreement", { mode: "boolean" }).notNull().default(false),
    status: text("status").notNull().default("identified"), // identified | prc_approved | disputed | recovering | closed | waived
    notifiedAt: text("notified_at"),
    months: integer("months").notNull().default(6),
    monthlyDeduction: real("monthly_deduction").notNull().default(0),
    recovered: real("recovered").notNull().default(0),
    notes: text("notes").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("clawbacks_user_idx").on(t.userId), index("clawbacks_initiative_idx").on(t.initiativeId)],
);

/** §9.5 announced changes to the revenue-share curve (≥ 30 days notice; only projects approved afterwards). */
export const curveAdjustments = sqliteTable(
  "curve_adjustments",
  {
    id: id(),
    fromCurve: text("from_curve", { mode: "json" }).$type<{ start: number; floor: number; decay: number }>().notNull(),
    toCurve: text("to_curve", { mode: "json" }).$type<{ start: number; floor: number; decay: number }>().notNull(),
    proposedAt: text("proposed_at").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    rationale: text("rationale").notNull().default(""),
    approvedById: text("approved_by_id").notNull().references(() => users.id),
  },
  (t) => [index("curve_adjustments_effective_idx").on(t.effectiveFrom)],
);

/** §6.8 amendments to roles and weights — majority of current members, PRC breaks ties. */
export const teamAmendments = sqliteTable(
  "team_amendments",
  {
    id: id(),
    initiativeId: text("initiative_id").notNull().references(() => initiatives.id, { onDelete: "cascade" }),
    proposedById: text("proposed_by_id").notNull().references(() => users.id),
    circulatedAt: text("circulated_at").notNull(),
    effectiveDate: text("effective_date").notNull(),
    reason: text("reason").notNull().default(""),
    change: text("change", { mode: "json" }).$type<TeamAmendment["change"]>().notNull(),
    votes: text("votes", { mode: "json" }).$type<TeamAmendment["votes"]>().notNull().default(sql`'[]'`),
    status: text("status").notNull().default("open"), // open | passed | failed | tied | blocked
    prcDecision: text("prc_decision", { mode: "json" }).$type<TeamAmendment["prcDecision"]>(),
    recordedAt: text("recorded_at"),
  },
  (t) => [index("team_amendments_initiative_idx").on(t.initiativeId, t.status)],
);

/** §9.2 record keeping — every state change in the module. */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: id(),
    at: text("at").notNull(),
    actorId: text("actor_id").notNull().references(() => users.id),
    entity: text("entity").notNull(), // initiative | member | run | deferred | probation | clawback | employee | policy
    entityId: text("entity_id").notNull(), // polymorphic — no FK
    action: text("action").notNull(),
    detail: text("detail").notNull().default(""),
  },
  (t) => [index("audit_log_at_idx").on(t.at), index("audit_log_entity_idx").on(t.entity, t.entityId), index("audit_log_actor_idx").on(t.actorId)],
);

/* ───────────── shared workspace (drizzle/migrations/0002_workspace.sql) ───────────── */

/** Whole-workspace JSON snapshot synced by the client store; `version` drives optimistic concurrency. */
export const workspaceSnapshots = sqliteTable("workspace_snapshots", {
  id: id(), // "default"
  version: integer("version").notNull().default(0),
  data: text("data").notNull().default("{}"),
  updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  updatedBy: text("updated_by").notNull().default(""),
});
