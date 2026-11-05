/* What a workflow can listen to and do — drives the builder UI, the runtime and the recipe gallery (W10). */
import type { EmailTemplate, Workflow } from "@/lib/types";
import type { WfObject } from "./types";

export const OBJECT_LABEL: Record<WfObject, string> = { deal: "Deal", contact: "Contact", company: "Company", ticket: "Ticket", issue: "Jira issue", epic: "Jira epic" };

export interface TriggerDef {
  object: WfObject;
  event: string;
  label: string;
  /** evaluated by the scheduler (every minute) instead of on a change */
  timed?: boolean;
  hint?: string;
}

export const TRIGGERS: TriggerDef[] = [
  { object: "deal", event: "created", label: "Deal created" },
  { object: "deal", event: "stage_changed", label: "Deal stage changed", hint: "Use stage = Closed Won / closed = lost / from_stage = …" },
  { object: "deal", event: "updated", label: "Deal amount, owner or close date changed", hint: "changed contains amount / owner / close_date" },
  { object: "deal", event: "idle", label: "Deal idle (no activity)", timed: true, hint: "Fires once per quiet spell: idle_days >= 14" },
  { object: "deal", event: "quote_expiring", label: "Quote expiring", timed: true, hint: "quote_expires_in_days <= 3" },
  { object: "contact", event: "created", label: "Contact created" },
  { object: "contact", event: "lifecycle_changed", label: "Contact lifecycle stage changed" },
  { object: "contact", event: "activity_logged", label: "Activity logged with contact", hint: "activity_type = email AND direction = inbound" },
  { object: "company", event: "created", label: "Company created" },
  { object: "ticket", event: "created", label: "Ticket created" },
  { object: "ticket", event: "stage_changed", label: "Ticket stage changed" },
  { object: "ticket", event: "sla_breached", label: "Ticket SLA breached", timed: true, hint: "Fires once per SLA deadline" },
  { object: "issue", event: "created", label: "Jira issue created" },
  { object: "issue", event: "status_changed", label: "Jira issue status changed", hint: "status = Done AND link = escalated_from ticket" },
  { object: "issue", event: "assigned", label: "Jira issue assigned" },
  { object: "issue", event: "link_created", label: "Jira issue linked to a CRM record", hint: "linktype = blocks AND crm = deal" },
  { object: "issue", event: "idle", label: "Jira issue idle (no update)", timed: true, hint: "status = In progress AND idle_days > 7" },
  { object: "epic", event: "created", label: "Jira epic created" },
];

export const triggerDef = (object: string, event: string) => TRIGGERS.find((t) => t.object === object && t.event === event);
export const triggerLabel = (w: Pick<Workflow, "trigger">) => triggerDef(w.trigger.object, w.trigger.event)?.label ?? `${OBJECT_LABEL[w.trigger.object as WfObject] ?? w.trigger.object} · ${w.trigger.event.replace(/_/g, " ")}`;

/** Fields a condition can test, per object (values are what the runtime puts in the record context). */
export const FIELDS: Record<WfObject, { field: string; label: string; kind: "text" | "number" | "list" | "bool"; options?: string[] }[]> = {
  deal: [
    { field: "stage", label: "Stage", kind: "text" },
    { field: "from_stage", label: "Previous stage", kind: "text" },
    { field: "closed", label: "Closed (won / lost / open)", kind: "text", options: ["won", "lost", "open"] },
    { field: "pipeline", label: "Pipeline", kind: "text" },
    { field: "amount", label: "Amount (IDR)", kind: "number" },
    { field: "probability", label: "Probability %", kind: "number" },
    { field: "owner", label: "Owner", kind: "text" },
    { field: "capability", label: "Capability", kind: "text" },
    { field: "priority", label: "Priority", kind: "text", options: ["high", "medium", "low"] },
    { field: "deal_type", label: "Deal type", kind: "text", options: ["New Business", "Expansion", "Renewal"] },
    { field: "company", label: "Company", kind: "text" },
    { field: "company_tier", label: "Company tier", kind: "text", options: ["Strategic", "Enterprise", "Mid-Market", "Emerging"] },
    { field: "days_in_stage", label: "Days in stage", kind: "number" },
    { field: "idle_days", label: "Days since last activity", kind: "number" },
    { field: "close_in_days", label: "Days to close date", kind: "number" },
    { field: "quote_expires_in_days", label: "Days to quote expiry", kind: "number" },
    { field: "changed", label: "Changed fields", kind: "list", options: ["amount", "owner", "close_date"] },
    { field: "blocked", label: "Blocked by Jira", kind: "bool" },
  ],
  contact: [
    { field: "lifecycle", label: "Lifecycle stage", kind: "text" },
    { field: "from_lifecycle", label: "Previous lifecycle", kind: "text" },
    { field: "lead_status", label: "Lead status", kind: "text" },
    { field: "owner", label: "Owner", kind: "text" },
    { field: "source", label: "Source", kind: "text", options: ["Website", "Referral", "Event", "Outbound", "Partner", "LinkedIn"] },
    { field: "company", label: "Company", kind: "text" },
    { field: "score", label: "Lead score", kind: "number" },
    { field: "city", label: "City", kind: "text" },
    { field: "job_title", label: "Job title", kind: "text" },
    { field: "in_sequence", label: "Active in a sequence", kind: "bool" },
    { field: "activity_type", label: "Activity type", kind: "text", options: ["email", "call", "meeting", "note", "task"] },
    { field: "direction", label: "Activity direction", kind: "text", options: ["inbound", "outbound"] },
    { field: "call_outcome", label: "Call outcome", kind: "text" },
  ],
  company: [
    { field: "industry", label: "Industry", kind: "text" },
    { field: "tier", label: "Tier", kind: "text", options: ["Strategic", "Enterprise", "Mid-Market", "Emerging"] },
    { field: "city", label: "City", kind: "text" },
    { field: "lifecycle", label: "Lifecycle stage", kind: "text" },
    { field: "owner", label: "Owner", kind: "text" },
  ],
  ticket: [
    { field: "stage", label: "Stage", kind: "text" },
    { field: "from_stage", label: "Previous stage", kind: "text" },
    { field: "priority", label: "Priority", kind: "text", options: ["urgent", "high", "medium", "low"] },
    { field: "category", label: "Category", kind: "text" },
    { field: "company", label: "Company", kind: "text" },
    { field: "company_tier", label: "Company tier", kind: "text" },
    { field: "owner", label: "Owner", kind: "text" },
    { field: "sla", label: "SLA state", kind: "text", options: ["on_track", "due_soon", "breached", "met"] },
    { field: "hours_left", label: "SLA hours left", kind: "number" },
    { field: "escalated", label: "Escalated to Jira", kind: "bool" },
  ],
  issue: [
    { field: "status", label: "Status", kind: "text", options: ["Backlog", "To do", "In progress", "In review", "Done"] },
    { field: "from_status", label: "Previous status", kind: "text" },
    { field: "type", label: "Type", kind: "text", options: ["story", "task", "bug", "deal_action", "support_escalation", "subtask"] },
    { field: "priority", label: "Priority", kind: "text", options: ["highest", "high", "medium", "low", "lowest"] },
    { field: "project", label: "Project key", kind: "text" },
    { field: "assignee", label: "Assignee", kind: "text" },
    { field: "points", label: "Story points", kind: "number" },
    { field: "labels", label: "Labels", kind: "list" },
    { field: "link", label: "CRM links (type + record)", kind: "list", options: ["escalated_from ticket", "blocks deal", "implements deal", "relates_to company"] },
    { field: "crm", label: "Linked CRM record types", kind: "list", options: ["deal", "ticket", "company", "contact"] },
    { field: "is_subtask", label: "Is a sub-task", kind: "bool" },
    { field: "siblings_done", label: "All sub-tasks of the parent done", kind: "bool" },
    { field: "idle_days", label: "Days since last update", kind: "number" },
    { field: "due_in_days", label: "Days to due date", kind: "number" },
    { field: "linktype", label: "New link type (link_created)", kind: "text", options: ["blocks", "blocked_by", "relates_to", "escalated_from", "implements"] },
    { field: "link_crm", label: "New link record type (link_created)", kind: "text", options: ["deal", "ticket", "company", "contact"] },
  ],
  epic: [
    { field: "name", label: "Name", kind: "text" },
    { field: "status", label: "Status", kind: "text" },
    { field: "project", label: "Project key", kind: "text" },
  ],
};

export const OPERATORS = ["=", "!=", ">", ">=", "<", "<=", "contains"] as const;
export type Operator = (typeof OPERATORS)[number];

/* ───────────── actions ───────────── */

export interface ActionField {
  key: string;
  label: string;
  kind: "text" | "textarea" | "number" | "select" | "user" | "users" | "project" | "template" | "sequence" | "stage";
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  default?: string;
}

export interface ActionDef {
  kind: string;
  label: string;
  objects: WfObject[] | "all";
  fields: ActionField[];
  summary: (c: Record<string, string>) => string;
}

const ASSIGNEE_OPTIONS = [
  { value: "record.owner", label: "Record owner / assignee" },
  { value: "project.lead", label: "Jira project lead" },
  { value: "me", label: "Whoever triggered it" },
];

const ISSUE_TYPE_OPTIONS = ["task", "story", "bug", "deal_action", "support_escalation"].map((v) => ({ value: v, label: v.replace(/_/g, " ") }));
const LINK_OPTIONS = ["relates_to", "implements", "blocks", "escalated_from"].map((v) => ({ value: v, label: v.replace(/_/g, " ") }));
const STATUS_OPTIONS = ["backlog", "todo", "in_progress", "in_review", "done"].map((v) => ({ value: v, label: v.replace(/_/g, " ") }));

export const ACTIONS: ActionDef[] = [
  {
    kind: "create_task",
    label: "Create task",
    objects: "all",
    fields: [
      { key: "title", label: "Task title", kind: "text", placeholder: "Follow up with {{contact.first_name}}", default: "Follow up" },
      { key: "due_in_days", label: "Due in (business days)", kind: "number", default: "1" },
      { key: "assignee", label: "Assign to", kind: "user", options: ASSIGNEE_OPTIONS, default: "record.owner" },
    ],
    summary: (c) => `Task “${c.title || "Follow up"}” in ${c.due_in_days || 1} business day(s)`,
  },
  {
    kind: "create_issue",
    label: "Create Jira issue",
    objects: "all",
    fields: [
      { key: "project", label: "Project", kind: "project", default: "auto-by-capability", hint: "“By capability” picks UAV / IOT / SWD from the deal’s capability" },
      { key: "type", label: "Type", kind: "select", options: ISSUE_TYPE_OPTIONS, default: "task" },
      { key: "summary", label: "Summary", kind: "text", default: "{{record.name}}" },
      { key: "priority", label: "Priority", kind: "select", options: ["highest", "high", "medium", "low", "lowest"].map((v) => ({ value: v, label: v })), default: "medium" },
      { key: "assignee", label: "Assignee", kind: "user", options: [{ value: "", label: "Unassigned" }, ...ASSIGNEE_OPTIONS], default: "project.lead" },
      { key: "link_type", label: "Link to the record as", kind: "select", options: LINK_OPTIONS, default: "relates_to" },
    ],
    summary: (c) => `Jira ${c.type || "task"} “${c.summary || "{{record.name}}"}”, linked ${String(c.link_type || "relates_to").replace(/_/g, " ")}`,
  },
  {
    kind: "create_epic",
    label: "Create Jira epic",
    objects: ["deal", "company", "ticket"],
    fields: [
      { key: "project", label: "Project", kind: "project", default: "auto-by-capability" },
      { key: "name", label: "Epic name", kind: "text", default: "{{deal.name}} Onboarding" },
    ],
    summary: (c) => `Epic “${c.name || "{{deal.name}} Onboarding"}”`,
  },
  {
    kind: "create_issues",
    label: "Create issues from a checklist",
    objects: "all",
    fields: [
      {
        key: "template",
        label: "Checklist",
        kind: "select",
        options: [
          { value: "onboarding-5-tasks", label: "Onboarding — 5 tasks" },
          { value: "fat-sat-handover", label: "FAT → SAT → handover — 4 tasks" },
          { value: "escalation-triage", label: "Escalation triage — 3 tasks" },
        ],
        default: "onboarding-5-tasks",
      },
    ],
    summary: (c) => `Issues: ${CHECKLISTS[c.template || "onboarding-5-tasks"]?.label ?? c.template}`,
  },
  {
    kind: "notify",
    label: "Notify someone",
    objects: "all",
    fields: [
      { key: "to", label: "Notify", kind: "user", options: [{ value: "deal.owner", label: "Record owner / assignee" }, { value: "project.lead", label: "Jira project lead" }, { value: "me", label: "Whoever triggered it" }], default: "deal.owner" },
      { key: "message", label: "Message", kind: "text", default: "{{record.name}}: {{trigger}}" },
    ],
    summary: (c) => `Notify ${c.to === "deal.owner" || c.to === "record.owner" || !c.to ? "the owner" : c.to === "project.lead" ? "the project lead" : c.to === "me" ? "the actor" : "a teammate"}`,
  },
  {
    kind: "update_ticket_stage",
    label: "Move ticket stage",
    objects: ["ticket", "issue"],
    fields: [{ key: "stage", label: "Stage", kind: "stage", default: "Resolved", hint: "On a Jira issue this moves the tickets linked to it" }],
    summary: (c) => `Ticket → ${c.stage || "Resolved"}`,
  },
  {
    kind: "email_contact",
    label: "Email the contact (logged)",
    objects: ["deal", "contact", "ticket", "company", "issue"],
    fields: [{ key: "template", label: "Template", kind: "template" }],
    summary: (c) => `Email from template ${c.template || "—"}`,
  },
  {
    kind: "set_property",
    label: "Set a property",
    objects: ["deal", "ticket", "contact", "issue"],
    fields: [
      { key: "field", label: "Property", kind: "select", options: [{ value: "priority", label: "Priority" }, { value: "owner", label: "Owner / assignee" }, { value: "lead_status", label: "Lead status (contact)" }, { value: "lifecycle", label: "Lifecycle (contact)" }, { value: "label", label: "Add label (issue)" }], default: "priority" },
      { key: "value", label: "Value", kind: "text", placeholder: "high · u-rani · connected · customer" },
    ],
    summary: (c) => `Set ${c.field || "priority"} = ${c.value || "—"}`,
  },
  {
    kind: "post_note",
    label: "Post a timeline note",
    objects: "all",
    fields: [{ key: "body", label: "Note", kind: "textarea", default: "{{trigger}} — logged by workflow." }],
    summary: () => "Timeline note",
  },
  {
    kind: "enrol_sequence",
    label: "Enrol in sequence",
    objects: ["contact", "deal", "company", "ticket"],
    fields: [{ key: "sequence", label: "Sequence", kind: "sequence" }],
    summary: (c) => `Enrol in ${c.sequence || "—"}`,
  },
  {
    kind: "comment_issue",
    label: "Comment on Jira issues",
    objects: ["issue", "deal", "ticket"],
    fields: [
      { key: "scope", label: "Which issues", kind: "select", options: [{ value: "self", label: "This issue" }, { value: "linked_open", label: "Open issues linked to the record" }, { value: "deal_action_open", label: "Open deal-action issues linked to the record" }], default: "linked_open" },
      { key: "body", label: "Comment", kind: "textarea", default: "{{trigger}}" },
    ],
    summary: (c) => `Comment on ${c.scope === "self" ? "the issue" : c.scope === "deal_action_open" ? "open deal-action issues" : "linked open issues"}`,
  },
  {
    kind: "move_issue",
    label: "Move Jira issue",
    objects: ["issue"],
    fields: [
      { key: "target", label: "Which issue", kind: "select", options: [{ value: "parent", label: "Parent issue" }, { value: "self", label: "This issue" }], default: "parent" },
      { key: "status", label: "Status", kind: "select", options: STATUS_OPTIONS, default: "in_review" },
    ],
    summary: (c) => `Move ${c.target === "self" ? "issue" : "parent"} → ${String(c.status || "in_review").replace(/_/g, " ")}`,
  },
  {
    kind: "assign_round_robin",
    label: "Assign owner (round robin)",
    objects: ["deal", "contact", "company", "ticket", "issue"],
    fields: [{ key: "pool", label: "Rotate between", kind: "users", hint: "Pick 2+ people, e.g. the capability specialists" }],
    summary: (c) => `Round robin over ${(c.pool || "").split(",").filter(Boolean).length || 0} people`,
  },
];

export const actionDef = (kind: string) => ACTIONS.find((a) => a.kind === kind);
export const actionAllowed = (def: ActionDef, object: WfObject) => def.objects === "all" || def.objects.includes(object);

/* ───────────── issue checklists for create_issues ───────────── */

export const CHECKLISTS: Record<string, { label: string; items: { summary: string; type: "task" | "story"; points: number }[] }> = {
  "onboarding-5-tasks": {
    label: "Onboarding — 5 tasks",
    items: [
      { summary: "Kick-off meeting and RACI with the client", type: "task", points: 1 },
      { summary: "Confirm site access, permits and HSE induction", type: "task", points: 2 },
      { summary: "Baseline scope, milestones and acceptance criteria", type: "task", points: 3 },
      { summary: "Order long-lead hardware and set up the project ledger", type: "task", points: 2 },
      { summary: "Schedule monthly status report and Finance kick-off (§6.1)", type: "task", points: 1 },
    ],
  },
  "fat-sat-handover": {
    label: "FAT → SAT → handover — 4 tasks",
    items: [
      { summary: "Factory acceptance test (FAT) with client witness", type: "story", points: 5 },
      { summary: "Install and commission on site", type: "story", points: 8 },
      { summary: "Site acceptance test (SAT) and punch list", type: "story", points: 5 },
      { summary: "Handover pack: as-built drawings, manuals, training", type: "task", points: 3 },
    ],
  },
  "escalation-triage": {
    label: "Escalation triage — 3 tasks",
    items: [
      { summary: "Reproduce the fault and collect logs", type: "task", points: 2 },
      { summary: "Root-cause analysis and fix plan", type: "task", points: 3 },
      { summary: "Customer update and verification on site", type: "task", points: 1 },
    ],
  },
};

/* ───────────── recipes (one-click workflows) ───────────── */

export interface Recipe {
  id: string;
  name: string;
  description: string;
  area: "Sales" | "Service" | "Delivery";
  workflow: Pick<Workflow, "name" | "trigger" | "actions"> & { description: string };
}

export const RECIPES: Recipe[] = [
  {
    id: "rc-won-onboarding",
    name: "Deal won → onboarding epic",
    area: "Delivery",
    description: "When a deal closes won, open an onboarding epic in the right Jira project with five kick-off tasks, and tell the owner.",
    workflow: {
      name: "Deal won → onboarding epic",
      description: "Closed-won hand-off to delivery.",
      trigger: { object: "deal", event: "stage_changed", condition: "closed = won" },
      actions: [
        { kind: "create_epic", config: { project: "auto-by-capability", name: "{{deal.name}} Onboarding" } },
        { kind: "create_issues", config: { template: "onboarding-5-tasks" } },
        { kind: "notify", config: { to: "deal.owner", message: "{{deal.name}} won — onboarding epic created. Propose the initiative (§4.1)." } },
      ],
    },
  },
  {
    id: "rc-sla-breach",
    name: "SLA breach → escalate",
    area: "Service",
    description: "When a ticket breaches its SLA, notify the owner and open a support escalation in Jira linked to the ticket.",
    workflow: {
      name: "SLA breach → escalate",
      description: "Breached tickets never sit unnoticed.",
      trigger: { object: "ticket", event: "sla_breached", condition: "escalated = false" },
      actions: [
        { kind: "notify", config: { to: "deal.owner", message: "SLA breached on {{ticket.subject}}" } },
        { kind: "create_issue", config: { project: "auto-by-capability", type: "support_escalation", summary: "{{ticket.subject}} — SLA breached", priority: "high", assignee: "project.lead", link_type: "escalated_from" } },
      ],
    },
  },
  {
    id: "rc-escalation-done",
    name: "Escalation done → resolve ticket",
    area: "Service",
    description: "When an escalated Jira issue is done, resolve the linked ticket and log a note on its timeline.",
    workflow: {
      name: "Escalation done → resolve ticket",
      description: "Close the loop with field support.",
      trigger: { object: "issue", event: "status_changed", condition: "status = Done AND link = escalated_from ticket" },
      actions: [
        { kind: "update_ticket_stage", config: { stage: "Resolved" } },
        { kind: "post_note", config: { body: "Engineering fix {{issue.key}} is done — ticket resolved by workflow." } },
      ],
    },
  },
  {
    id: "rc-subtasks-done",
    name: "All sub-tasks done → parent in review",
    area: "Delivery",
    description: "When the last sub-task of a story is done, move the parent to In review.",
    workflow: {
      name: "All sub-tasks done → parent in review",
      description: "No scrum master needed for the obvious transition.",
      trigger: { object: "issue", event: "status_changed", condition: "status = Done AND is_subtask = true AND siblings_done = true" },
      actions: [{ kind: "move_issue", config: { target: "parent", status: "in_review" } }],
    },
  },
  {
    id: "rc-deal-lost",
    name: "Deal lost → tell engineering",
    area: "Delivery",
    description: "When a deal is lost, comment on its open deal-action issues so engineering can stop work.",
    workflow: {
      name: "Deal lost → tell engineering",
      description: "Stop pre-sales effort on lost deals.",
      trigger: { object: "deal", event: "stage_changed", condition: "closed = lost" },
      actions: [{ kind: "comment_issue", config: { scope: "deal_action_open", body: "{{deal.name}} was closed lost — please stop or re-scope this work." } }],
    },
  },
  {
    id: "rc-stale-issue",
    name: "Stale in-progress issue → nudge",
    area: "Delivery",
    description: "When an issue sits in progress for more than 7 days without an update, notify the assignee.",
    workflow: {
      name: "Stale in-progress issue → nudge",
      description: "Weekly hygiene for the board.",
      trigger: { object: "issue", event: "idle", condition: "status = In progress AND idle_days > 7" },
      actions: [{ kind: "notify", config: { to: "deal.owner", message: "{{issue.key}} has not moved for {{idle_days}} days" } }],
    },
  },
  {
    id: "rc-inbound-reply",
    name: "Inbound reply → follow-up task",
    area: "Sales",
    description: "When a contact emails in, create a follow-up task for the owner due the next business day.",
    workflow: {
      name: "Inbound reply → follow-up task",
      description: "Answer every inbound within one business day.",
      trigger: { object: "contact", event: "activity_logged", condition: "activity_type = email AND direction = inbound" },
      actions: [{ kind: "create_task", config: { title: "Reply to {{contact.first_name}} ({{company.name}})", due_in_days: "1", assignee: "record.owner" } }],
    },
  },
  {
    id: "rc-quote-expiring",
    name: "Quote expiring → owner task",
    area: "Sales",
    description: "Three days before a sent quote expires, give the deal owner a task to extend or chase it.",
    workflow: {
      name: "Quote expiring → owner task",
      description: "Quotes never lapse silently.",
      trigger: { object: "deal", event: "quote_expiring", condition: "quote_expires_in_days <= 3" },
      actions: [{ kind: "create_task", config: { title: "Quote for {{deal.name}} expires soon — extend or chase", due_in_days: "1", assignee: "record.owner" } }],
    },
  },
  {
    id: "rc-rotting",
    name: "Deal idle 14 days → reminder",
    area: "Sales",
    description: "When an open deal has no logged activity for 14 days, remind the owner and post a note on the deal.",
    workflow: {
      name: "Deal idle 14 days → reminder",
      description: "Catch deals that stall quietly between site visits.",
      trigger: { object: "deal", event: "idle", condition: "closed = open AND idle_days >= 14" },
      actions: [
        { kind: "notify", config: { to: "deal.owner", message: "{{deal.name}} has had no activity for {{idle_days}} days" } },
        { kind: "create_task", config: { title: "Re-engage {{contact.first_name}} on {{deal.name}}", due_in_days: "2", assignee: "record.owner" } },
      ],
    },
  },
  {
    id: "rc-uas-roundrobin",
    name: "New Unmanned Systems deal → specialist owner",
    area: "Sales",
    description: "Rotate new Unmanned Systems deals between the maritime/aerospace AE and the UAV engineer as co-owner.",
    workflow: {
      name: "New Unmanned Systems deal → specialist owner",
      description: "Capability-based assignment (round robin).",
      trigger: { object: "deal", event: "created", condition: "capability = Unmanned Systems" },
      actions: [{ kind: "assign_round_robin", config: { pool: "u-sinta,u-rani" } }],
    },
  },
];

/* ───────────── starter template library ───────────── */

export const STARTER_TEMPLATES: (Omit<EmailTemplate, "ownerId"> & { note: string })[] = [
  {
    id: "tpl-resolved",
    name: "Ticket resolved",
    subject: "Resolved: {{ticket.subject}}",
    body: "Hi {{contact.first_name}},\n\nGood news — our engineers have fixed “{{ticket.subject}}” ({{ticket.id}}). Please let us know within 5 business days if anything still looks wrong and we will reopen it.\n\n{{owner.first_name}}\nSpectrum Group field support",
    category: "Support",
    templateChannel: "email",
    templateLanguage: "en",
    note: "Used by the seeded “Escalated bug done → resolve ticket” workflow.",
  },
  {
    id: "tpl-wa-intro-id",
    name: "WA — Perkenalan",
    subject: "Perkenalan Spectrum Group",
    body: "Selamat pagi Bapak/Ibu {{contact.first_name}}, saya {{owner.first_name}} dari Spectrum Group. Kami membantu {{company.name}} di bidang {{deal.capability}} — dari konsep sampai implementasi bersertifikat. Boleh saya kirimkan profil singkat dan studi kasus kami? Terima kasih.",
    category: "Prospecting",
    templateChannel: "whatsapp",
    templateLanguage: "id",
    note: "Bahasa Indonesia opening message for WhatsApp steps.",
  },
  {
    id: "tpl-wa-followup-id",
    name: "WA — Tindak lanjut",
    subject: "Tindak lanjut",
    body: "Halo Bapak/Ibu {{contact.first_name}}, menindaklanjuti email saya tentang {{deal.name}}. Apakah ada waktu 20 menit minggu ini untuk diskusi singkat? Saya bisa menyesuaikan jadwal Bapak/Ibu. Salam, {{owner.first_name}}",
    category: "Follow-up",
    templateChannel: "whatsapp",
    templateLanguage: "id",
    note: "Second touch after an intro email.",
  },
  {
    id: "tpl-wa-meeting-id",
    name: "WA — Konfirmasi meeting",
    subject: "Konfirmasi meeting",
    body: "Halo Bapak/Ibu {{contact.first_name}}, terima kasih atas waktunya. Berikut tautan untuk memilih jadwal diskusi teknis dengan tim engineer kami: {{owner.meeting_link}}. Sampai jumpa! — {{owner.first_name}}, Spectrum Group",
    category: "Meeting",
    templateChannel: "whatsapp",
    templateLanguage: "id",
    note: "Meeting booking link in Bahasa Indonesia.",
  },
  {
    id: "tpl-wa-followup-en",
    name: "WA — Quick follow-up (EN)",
    subject: "Quick follow-up",
    body: "Hi {{contact.first_name}}, {{owner.first_name}} from Spectrum Group here. Following up on {{deal.name}} — would a 20-minute call this week work for you?",
    category: "Follow-up",
    templateChannel: "whatsapp",
    templateLanguage: "en",
    note: "English WhatsApp follow-up for regional clients.",
  },
  {
    id: "tpl-quote-chase",
    name: "Quote expiring — chase",
    subject: "Your Spectrum Group quotation for {{deal.name}}",
    body: "Hi {{contact.first_name}},\n\nOur quotation for {{deal.name}} ({{deal.amount}}) is valid until {{deal.close_date}}. Shall we extend it, or is there anything you need from us to move ahead?\n\n{{owner.first_name}}",
    category: "Follow-up",
    templateChannel: "email",
    templateLanguage: "en",
    note: "Pairs with the “Quote expiring → owner task” recipe.",
  },
];
