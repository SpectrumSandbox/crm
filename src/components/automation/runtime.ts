/* Workflow runtime (W10): turns store changes into trigger events, evaluates conditions and executes actions
 * client-side through the store's own actions. Every run is logged to `workflowRuns`. Only type imports from the store
 * (the watcher in the automation slice loads the store lazily to avoid an import cycle). */
import type { CrmState } from "../../lib/store";
import type { Activity, ActivityLinks, CrmObjectType, Epic, Issue, IssuePriority, IssueStatus, IssueType, LinkType, Workflow } from "../../lib/types";
import { ISSUE_PRIORITIES, ISSUE_STATUSES, LEAD_STATUSES, LIFECYCLE_STAGES } from "../../lib/types";
import { formatDate } from "../../lib/utils";
import { actionDef, CHECKLISTS, triggerDef, triggerLabel } from "./catalog";
import { evaluateCondition } from "./conditions";
import { issueLinks, lastActivityAt, recordContext, slaState, type RecordCtx, type WfEvent } from "./context";
import { addBusinessDaysAt9 } from "./sequences";
import { renderTemplate, tokenContext } from "./tokens";
import type { AutomationNotice, RunSource, WorkflowRun, WorkflowRunStep } from "./types";

export type { WfEvent } from "./context";

export interface Api {
  get: () => CrmState;
  set: (partial: Partial<CrmState> | ((s: CrmState) => Partial<CrmState>)) => void;
  uid: (prefix: string) => string;
}

export const RUN_LOG_CAP = 500;
const DAY = 86_400_000;

const emptyLinks = (): ActivityLinks => ({ contactIds: [], companyIds: [], dealIds: [], ticketIds: [] });

function linksFor(crm: { type: CrmObjectType; id: string } | null, contactIds: string[] = []): ActivityLinks {
  const l = emptyLinks();
  if (crm?.type === "contact") l.contactIds.push(crm.id);
  if (crm?.type === "company") l.companyIds.push(crm.id);
  if (crm?.type === "deal") l.dealIds.push(crm.id);
  if (crm?.type === "ticket") l.ticketIds.push(crm.id);
  contactIds.forEach((c) => {
    if (!l.contactIds.includes(c)) l.contactIds.push(c);
  });
  return l;
}

/** capability → delivery project (UAV / IOT / SWD) */
export function projectForCapability(capability: string | undefined) {
  if (capability === "Unmanned Systems") return "pr-uav";
  if (capability && ["Industrial IoT", "Sensor Integration", "Control Systems Engineering", "IT / OT", "Prototyping & Manufacturing"].includes(capability)) return "pr-iot";
  return "pr-swd";
}

function resolveProject(s: CrmState, value: string | undefined, object: string, recordId: string, ctx: RecordCtx) {
  if (value && value !== "auto-by-capability" && s.projects.some((p) => p.id === value)) return value;
  if (object === "issue") return s.issues.find((i) => i.id === recordId)?.projectId ?? "pr-swd";
  if (object === "epic") return s.epics.find((e) => e.id === recordId)?.projectId ?? "pr-swd";
  const cap = ctx.fields.capability;
  if (typeof cap === "string" && cap) return projectForCapability(cap);
  // tickets / companies / contacts: capability of the most recent deal at the company
  const companyId = object === "ticket" ? s.tickets.find((t) => t.id === recordId)?.companyId : object === "company" ? recordId : s.contacts.find((c) => c.id === recordId)?.companyId;
  const deal = s.deals.filter((d) => d.companyId === companyId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return deal ? projectForCapability(deal.capability) : object === "ticket" ? "pr-iot" : "pr-swd";
}

function resolveUser(s: CrmState, value: string | undefined, ctx: RecordCtx, actorId: string, projectId?: string): string | null {
  const v = (value ?? "").trim();
  if (!v || v === "record.owner" || v === "deal.owner" || v === "owner") return ctx.ownerId ?? actorId;
  if (v === "me") return actorId;
  if (v === "project.lead") return s.projects.find((p) => p.id === projectId)?.leadId ?? ctx.ownerId ?? actorId;
  const byId = s.users.find((u) => u.id === v);
  if (byId) return byId.id;
  const byName = s.users.find((u) => u.name.toLowerCase() === v.toLowerCase() || u.name.split(" ")[0].toLowerCase() === v.toLowerCase());
  return byName?.id ?? null;
}

const userName = (s: CrmState, id: string | null | undefined) => s.users.find((u) => u.id === id)?.name ?? "someone";

/* ───────────── action executor ───────────── */

interface Scope {
  epicId?: string;
  projectId?: string;
  createdIssueIds: string[];
  notices: AutomationNotice[];
}

type Exec = (args: { api: Api; wf: Workflow; config: Record<string, string>; index: number; ev: WfEvent; ctx: RecordCtx; actorId: string; scope: Scope; dryRun: boolean }) => WorkflowRunStep;

function render(api: Api, text: string, ctx: RecordCtx, contactId?: string | null) {
  const s = api.get();
  return renderTemplate(text, tokenContext(s, ctx.crm, contactId ?? ctx.contactIds[0] ?? null), ctx.extra);
}

const EXEC: Record<string, Exec> = {
  create_task: ({ api, wf, config, ctx, actorId, dryRun }) => {
    const s = api.get();
    const assignee = resolveUser(s, config.assignee || "record.owner", ctx, actorId) ?? actorId;
    const days = Math.max(0, Math.round(Number(config.due_in_days ?? 1) || 0));
    const due = new Date(addBusinessDaysAt9(Date.now(), days) + 8 * 3_600_000).toISOString();
    const title = render(api, config.title || "Follow up", ctx);
    const detail = `Task “${title}” for ${userName(s, assignee)}, due ${formatDate(due)}`;
    if (dryRun) return { kind: "create_task", ok: true, detail };
    s.addActivity({ type: "task", subject: title, body: `Created by workflow “${wf.name}”.`, links: linksFor(ctx.crm, ctx.contactIds.slice(0, 1)), dueAt: due, done: false, ownerId: assignee });
    return { kind: "create_task", ok: true, detail, href: ctx.href ?? undefined };
  },

  create_issue: ({ api, ev, config, ctx, actorId, scope, dryRun }) => {
    const s = api.get();
    const projectId = resolveProject(s, config.project, ev.object, ev.recordId, ctx);
    const project = s.projects.find((p) => p.id === projectId);
    if (!project) return { kind: "create_issue", ok: false, detail: `Project ${config.project} not found` };
    const type = (["story", "task", "bug", "deal_action", "support_escalation"].includes(config.type) ? config.type : "task") as IssueType;
    const priority = ((ISSUE_PRIORITIES as readonly string[]).includes(config.priority) ? config.priority : "medium") as IssuePriority;
    const assigneeId = config.assignee ? resolveUser(s, config.assignee, ctx, actorId, projectId) : null;
    const summary = render(api, config.summary || "{{record.name}}", ctx);
    const linkType = (["relates_to", "implements", "blocks", "escalated_from", "blocked_by"].includes(config.link_type) ? config.link_type : "relates_to") as LinkType;
    const detail = `${project.key} ${type.replace(/_/g, " ")} “${summary}”${assigneeId ? ` for ${userName(s, assigneeId)}` : ""}${ctx.crm ? `, linked ${linkType.replace(/_/g, " ")}` : ""}`;
    if (dryRun) return { kind: "create_issue", ok: true, detail: `Would create ${detail}` };
    const id = s.createIssue({
      projectId,
      type,
      summary,
      priority,
      assigneeId,
      epicId: scope.epicId && s.epics.find((e) => e.id === scope.epicId)?.projectId === projectId ? scope.epicId : null,
      description: `Created by workflow from ${ctx.label}.`,
      link: ctx.crm ? { crmType: ctx.crm.type, crmId: ctx.crm.id, linkType } : undefined,
    });
    const issue = api.get().issues.find((i) => i.id === id);
    if (!issue) return { kind: "create_issue", ok: false, detail: "Jira issue could not be created" };
    scope.createdIssueIds.push(id);
    return { kind: "create_issue", ok: true, detail: `Created ${issue.key} — ${detail.replace(`${project.key} `, "")}`, href: `/board?issue=${issue.key}` };
  },

  create_epic: ({ api, ev, config, ctx, scope, dryRun }) => {
    const s = api.get();
    const projectId = resolveProject(s, config.project, ev.object, ev.recordId, ctx);
    const project = s.projects.find((p) => p.id === projectId);
    if (!project) return { kind: "create_epic", ok: false, detail: "Project not found" };
    const name = render(api, config.name || "{{deal.name}} Onboarding", ctx);
    const max = s.epics.filter((e) => e.projectId === projectId).reduce((m, e) => Math.max(m, Number(e.key.split("-")[1]) || 0), 0);
    const key = `${project.key}-${max + 1}`;
    if (dryRun) return { kind: "create_epic", ok: true, detail: `Would create epic ${key} “${name}”` };
    const epic: Epic = { id: api.uid("e"), projectId, key, name, summary: `Opened by workflow from ${ctx.label}.`, color: project.color, status: "todo", ownerId: project.leadId };
    api.set((st) => ({ epics: [...st.epics, epic] }));
    if (ctx.crm) api.get().link({ agileType: "epic", agileId: epic.id, crmType: ctx.crm.type, crmId: ctx.crm.id, linkType: "implements" });
    scope.epicId = epic.id;
    scope.projectId = projectId;
    return { kind: "create_epic", ok: true, detail: `Created epic ${key} ${name}`, href: `/board?project=${projectId}` };
  },

  create_issues: ({ api, ev, config, ctx, scope, dryRun }) => {
    const list = CHECKLISTS[config.template || "onboarding-5-tasks"];
    if (!list) return { kind: "create_issues", ok: false, detail: `Checklist ${config.template} not found` };
    const s = api.get();
    const projectId = scope.projectId ?? resolveProject(s, undefined, ev.object, ev.recordId, ctx);
    const project = s.projects.find((p) => p.id === projectId);
    if (!project) return { kind: "create_issues", ok: false, detail: "Project not found" };
    if (dryRun) return { kind: "create_issues", ok: true, detail: `Would create ${list.items.length} issues in ${project.key}${scope.epicId ? " under the new epic" : ""}` };
    const keys: string[] = [];
    list.items.forEach((item) => {
      const id = api.get().createIssue({
        projectId,
        type: item.type,
        summary: item.summary,
        storyPoints: item.points,
        epicId: scope.epicId ?? null,
        assigneeId: project.leadId,
        description: `${list.label} — created by workflow for ${ctx.label}.`,
        link: !scope.epicId && ctx.crm ? { crmType: ctx.crm.type, crmId: ctx.crm.id, linkType: "implements" } : undefined,
      });
      const key = api.get().issues.find((i) => i.id === id)?.key;
      if (key) keys.push(key);
      scope.createdIssueIds.push(id);
    });
    return { kind: "create_issues", ok: keys.length === list.items.length, detail: `Created ${keys.length} issues in ${project.key}: ${keys.join(", ")}`, href: `/board?project=${projectId}` };
  },

  notify: ({ api, wf, config, ctx, actorId, scope, dryRun, ev }) => {
    const s = api.get();
    const projectId = ev.object === "issue" ? s.issues.find((i) => i.id === ev.recordId)?.projectId : undefined;
    const to = resolveUser(s, config.to || "record.owner", ctx, actorId, projectId);
    if (!to) return { kind: "notify", ok: false, detail: `No user matches “${config.to}”` };
    const title = render(api, config.message || "{{record.name}}: {{trigger}}", ctx);
    if (dryRun) return { kind: "notify", ok: true, detail: `Would notify ${userName(s, to)}: ${title}` };
    const notice: AutomationNotice = { id: api.uid("an"), userId: to, title, body: `${wf.name} · ${ctx.label}`, href: ctx.href ?? undefined, at: new Date().toISOString(), readAt: null, workflowId: wf.id };
    api.set((st) => ({ automationNotices: [notice, ...st.automationNotices].slice(0, 300) }));
    scope.notices.push(notice);
    return { kind: "notify", ok: true, detail: `Notified ${userName(s, to)}: ${title}`, href: "/automation?tab=inbox" };
  },

  update_ticket_stage: ({ api, ev, config, dryRun }) => {
    const s = api.get();
    const ticketIds = ev.object === "ticket" ? [ev.recordId] : ev.object === "issue" ? issueLinks(s, ev.recordId).filter((x) => x.crmType === "ticket").map((x) => x.crmId) : [];
    if (!ticketIds.length) return { kind: "update_ticket_stage", ok: false, detail: "No ticket linked to this record" };
    const target = (config.stage || "Resolved").toLowerCase();
    const done: string[] = [];
    const skipped: string[] = [];
    for (const tid of ticketIds) {
      const t = s.tickets.find((x) => x.id === tid);
      if (!t) continue;
      const stage = s.pipelines.find((p) => p.id === t.pipelineId)?.stages.find((st) => st.name.toLowerCase() === target || st.id === config.stage);
      if (!stage) return { kind: "update_ticket_stage", ok: false, detail: `Stage “${config.stage}” is not in the ticket pipeline` };
      if (t.stageId === stage.id) {
        skipped.push(tid.toUpperCase());
        continue;
      }
      if (!dryRun) s.moveTicket(tid, stage.id);
      done.push(tid.toUpperCase());
    }
    const verb = dryRun ? "Would move" : "Moved";
    const detail = [done.length ? `${verb} ${done.join(", ")} to ${config.stage || "Resolved"}` : "", skipped.length ? `${skipped.join(", ")} already there` : ""].filter(Boolean).join(" · ");
    return { kind: "update_ticket_stage", ok: true, detail: detail || "Nothing to move", href: ticketIds.length === 1 ? `/tickets/${ticketIds[0]}` : "/tickets" };
  },

  email_contact: ({ api, wf, config, ctx, dryRun }) => {
    const s = api.get();
    const tpl = s.emailTemplates.find((t) => t.id === config.template);
    if (!tpl) return { kind: "email_contact", ok: false, detail: `Template ${config.template || "(none)"} not found — pick one or add it from the starter library` };
    const contacts = ctx.contactIds.map((id) => s.contacts.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c && !!c.email).slice(0, 3);
    if (!contacts.length) return { kind: "email_contact", ok: false, detail: "No contact with an email address on this record" };
    const names = contacts.map((c) => `${c.firstName} ${c.lastName}`).join(", ");
    if (dryRun) return { kind: "email_contact", ok: true, detail: `Would log “${tpl.name}” to ${names}` };
    contacts.forEach((c) => {
      const tctx = tokenContext(s, ctx.crm, c.id);
      const l = linksFor(ctx.crm, [c.id]);
      if (c.companyId && !l.companyIds.includes(c.companyId)) l.companyIds.push(c.companyId);
      s.addActivity({ type: "email", direction: "outbound", subject: renderTemplate(tpl.subject, tctx, ctx.extra), body: `${renderTemplate(tpl.body, tctx, ctx.extra)}\n\n— logged by workflow “${wf.name}” (no mail server is connected; send it from your mail client)`, links: l });
    });
    return { kind: "email_contact", ok: true, detail: `Logged “${tpl.name}” email to ${names}`, href: `/contacts/${contacts[0].id}` };
  },

  set_property: ({ api, ev, config, ctx, actorId, dryRun }) => {
    const s = api.get();
    const field = config.field || "priority";
    const value = (config.value ?? "").trim();
    if (!value) return { kind: "set_property", ok: false, detail: "No value configured" };
    const fail = (why: string): WorkflowRunStep => ({ kind: "set_property", ok: false, detail: why });
    const ok = (what: string): WorkflowRunStep => ({ kind: "set_property", ok: true, detail: dryRun ? `Would set ${what}` : `Set ${what}`, href: ctx.href ?? undefined });
    if (field === "owner") {
      const uid = resolveUser(s, value, ctx, actorId);
      if (!uid) return fail(`No user matches “${value}”`);
      if (dryRun) return ok(`owner = ${userName(s, uid)}`);
      if (ev.object === "deal") s.updateDeal(ev.recordId, { ownerId: uid });
      else if (ev.object === "contact") s.updateContact(ev.recordId, { ownerId: uid });
      else if (ev.object === "company") s.updateCompany(ev.recordId, { ownerId: uid });
      else if (ev.object === "ticket") s.updateTicket(ev.recordId, { ownerId: uid });
      else if (ev.object === "issue") s.updateIssue(ev.recordId, { assigneeId: uid });
      else return fail("Owner can't be set on this object");
      return ok(`owner = ${userName(s, uid)}`);
    }
    if (field === "priority") {
      const v = value.toLowerCase();
      if (ev.object === "deal") {
        if (!["high", "medium", "low"].includes(v)) return fail("Deal priority must be high, medium or low");
        if (!dryRun) s.updateDeal(ev.recordId, { priority: v as "high" | "medium" | "low" });
      } else if (ev.object === "ticket") {
        if (!["urgent", "high", "medium", "low"].includes(v)) return fail("Ticket priority must be urgent, high, medium or low");
        if (!dryRun) s.updateTicket(ev.recordId, { priority: v as "urgent" | "high" | "medium" | "low" });
      } else if (ev.object === "issue") {
        if (!(ISSUE_PRIORITIES as readonly string[]).includes(v)) return fail("Issue priority must be highest … lowest");
        if (!dryRun) s.updateIssue(ev.recordId, { priority: v as IssuePriority });
      } else return fail("Priority can't be set on this object");
      return ok(`priority = ${v}`);
    }
    if (field === "lead_status" && ev.object === "contact") {
      if (!(LEAD_STATUSES as readonly string[]).includes(value)) return fail(`Lead status must be one of ${LEAD_STATUSES.join(", ")}`);
      if (!dryRun) s.updateContact(ev.recordId, { leadStatus: value as (typeof LEAD_STATUSES)[number] });
      return ok(`lead status = ${value}`);
    }
    if (field === "lifecycle" && ev.object === "contact") {
      if (!(LIFECYCLE_STAGES as readonly string[]).includes(value)) return fail(`Lifecycle must be one of ${LIFECYCLE_STAGES.join(", ")}`);
      if (!dryRun) s.updateContact(ev.recordId, { lifecycleStage: value as (typeof LIFECYCLE_STAGES)[number] });
      return ok(`lifecycle = ${value}`);
    }
    if (field === "label" && ev.object === "issue") {
      const issue = s.issues.find((i) => i.id === ev.recordId);
      if (!issue) return fail("Issue not found");
      if (!dryRun && !issue.labels.includes(value)) s.updateIssue(issue.id, { labels: [...issue.labels, value] });
      return ok(`label ${value}`);
    }
    return fail(`“${field}” can't be set on a ${ev.object}`);
  },

  post_note: ({ api, wf, config, ctx, ev, dryRun }) => {
    const s = api.get();
    const body = render(api, config.body || "{{trigger}} — logged by workflow.", ctx);
    if (ctx.crm) {
      if (dryRun) return { kind: "post_note", ok: true, detail: `Would post a note on ${ctx.label}` };
      s.addActivity({ type: "note", subject: `Workflow: ${wf.name}`, body, links: linksFor(ctx.crm) });
      return { kind: "post_note", ok: true, detail: `Note posted on ${ctx.label}`, href: ctx.href ?? undefined };
    }
    if (ev.object === "issue") {
      if (dryRun) return { kind: "post_note", ok: true, detail: "Would comment on the issue (no CRM record linked)" };
      s.addComment(ev.recordId, body);
      return { kind: "post_note", ok: true, detail: "Commented on the issue (no CRM record linked)", href: ctx.href ?? undefined };
    }
    return { kind: "post_note", ok: false, detail: "Nothing to post on" };
  },

  enrol_sequence: ({ api, config, ctx, dryRun }) => {
    const s = api.get();
    const seq = s.sequences.find((q) => q.id === config.sequence);
    if (!seq) return { kind: "enrol_sequence", ok: false, detail: `Sequence ${config.sequence || "(none)"} not found` };
    if (!seq.active) return { kind: "enrol_sequence", ok: false, detail: `${seq.name} is paused` };
    if (!ctx.contactIds.length) return { kind: "enrol_sequence", ok: false, detail: "No contact on this record" };
    if (dryRun) return { kind: "enrol_sequence", ok: true, detail: `Would enrol ${ctx.contactIds.length} contact(s) in ${seq.name}` };
    const r = s.enrollContacts(seq.id, ctx.contactIds);
    return { kind: "enrol_sequence", ok: r.enrolled.length > 0, detail: `${r.enrolled.length} enrolled in ${seq.name}${r.skipped.length ? ` · skipped: ${r.skipped.map((x) => x.reason).join("; ")}` : ""}`, href: `/automation/sequences?seq=${seq.id}` };
  },

  comment_issue: ({ api, config, ctx, ev, dryRun }) => {
    const s = api.get();
    const scopeKind = config.scope || "linked_open";
    let targets: Issue[] = [];
    if (scopeKind === "self" || (ev.object === "issue" && !ctx.crm)) targets = s.issues.filter((i) => i.id === ev.recordId);
    else if (ctx.crm) {
      const ids = new Set(s.crossLinks.filter((x) => x.agileType === "issue" && x.crmType === ctx.crm!.type && x.crmId === ctx.crm!.id).map((x) => x.agileId));
      targets = s.issues.filter((i) => ids.has(i.id) && i.status !== "done" && (scopeKind !== "deal_action_open" || i.type === "deal_action"));
    }
    if (!targets.length) return { kind: "comment_issue", ok: true, detail: "No matching open issues — nothing to comment on" };
    const body = render(api, config.body || "{{trigger}}", ctx);
    if (dryRun) return { kind: "comment_issue", ok: true, detail: `Would comment on ${targets.map((i) => i.key).join(", ")}` };
    targets.forEach((i) => s.addComment(i.id, `[Automation] ${body}`));
    return { kind: "comment_issue", ok: true, detail: `Commented on ${targets.map((i) => i.key).join(", ")}`, href: `/board?issue=${targets[0].key}` };
  },

  move_issue: ({ api, config, ev, dryRun }) => {
    const s = api.get();
    const issue = s.issues.find((i) => i.id === ev.recordId);
    if (!issue) return { kind: "move_issue", ok: false, detail: "Issue not found" };
    const target = config.target === "self" ? issue : s.issues.find((i) => i.id === issue.parentId);
    if (!target) return { kind: "move_issue", ok: false, detail: "The issue has no parent" };
    const status = ((ISSUE_STATUSES as readonly string[]).includes(config.status) ? config.status : "in_review") as IssueStatus;
    if (target.status === status) return { kind: "move_issue", ok: true, detail: `${target.key} is already ${status.replace(/_/g, " ")}` };
    if (dryRun) return { kind: "move_issue", ok: true, detail: `Would move ${target.key} to ${status.replace(/_/g, " ")}` };
    const tracked = (s as unknown as { updateIssueTracked?: (id: string, patch: Partial<Issue>) => void }).updateIssueTracked;
    if (typeof tracked === "function") tracked(target.id, { status });
    else s.updateIssue(target.id, { status });
    return { kind: "move_issue", ok: true, detail: `Moved ${target.key} to ${status.replace(/_/g, " ")}`, href: `/board?issue=${target.key}` };
  },

  assign_round_robin: ({ api, wf, config, index, ev, ctx, dryRun }) => {
    const s = api.get();
    const pool = (config.pool ?? "").split(",").map((x) => x.trim()).filter((id) => s.users.some((u) => u.id === id));
    if (pool.length < 1) return { kind: "assign_round_robin", ok: false, detail: "No people in the rotation" };
    const cursorId = `${wf.id}:${index}`;
    const cur = s.assignmentCursors.find((c) => c.id === cursorId);
    const nextIndex = cur ? (cur.index + 1) % pool.length : 0;
    const uid = pool[nextIndex];
    if (dryRun) return { kind: "assign_round_robin", ok: true, detail: `Would assign ${userName(s, uid)} (next in rotation of ${pool.length})` };
    if (ev.object === "deal") s.updateDeal(ev.recordId, { ownerId: uid });
    else if (ev.object === "contact") s.updateContact(ev.recordId, { ownerId: uid });
    else if (ev.object === "company") s.updateCompany(ev.recordId, { ownerId: uid });
    else if (ev.object === "ticket") s.updateTicket(ev.recordId, { ownerId: uid });
    else if (ev.object === "issue") s.updateIssue(ev.recordId, { assigneeId: uid });
    else return { kind: "assign_round_robin", ok: false, detail: "Owner can't be set on this object" };
    const at = new Date().toISOString();
    api.set((st) => ({ assignmentCursors: [...st.assignmentCursors.filter((c) => c.id !== cursorId), { id: cursorId, index: nextIndex, updatedAt: at }] }));
    if (ctx.crm) s.addActivity({ type: "note", subject: `Owner assigned: ${userName(s, uid)}`, body: `Round-robin rule “${wf.name}” (${nextIndex + 1} of ${pool.length}: ${pool.map((p) => userName(s, p)).join(" → ")}).`, links: linksFor(ctx.crm) });
    return { kind: "assign_round_robin", ok: true, detail: `Assigned ${userName(s, uid)} (${nextIndex + 1} of ${pool.length})`, href: ctx.href ?? undefined };
  },
};

/* ───────────── run one workflow ───────────── */

export interface RunResult {
  run: WorkflowRun | null;
  trace: ReturnType<typeof evaluateCondition>;
  ctx: RecordCtx;
  steps: WorkflowRunStep[];
  notices: AutomationNotice[];
}

export function runWorkflow(api: Api, wf: Workflow, ev: WfEvent, opts: { source: RunSource; dryRun?: boolean; ignoreCondition?: boolean; actorId?: string }): RunResult {
  const s = api.get();
  const actorId = opts.actorId ?? s.currentUserId;
  const description = ev.description ?? describeEvent(s, ev);
  const ctx = recordContext(s, ev.object, ev.recordId, { ...ev, description });
  const trace = evaluateCondition(wf.trigger.condition, ctx.fields);
  const scope: Scope = { createdIssueIds: [], notices: [] };
  if (!ctx.exists) return { run: null, trace, ctx, steps: [{ kind: "record", ok: false, detail: "Record not found" }], notices: [] };
  if (!trace.pass && !opts.ignoreCondition) return { run: null, trace, ctx, steps: [], notices: [] };

  const steps: WorkflowRunStep[] = wf.actions.map((a, index) => {
    const exec = EXEC[a.kind];
    if (!exec) return { kind: a.kind, ok: false, detail: `Unknown action “${a.kind}”` };
    const def = actionDef(a.kind);
    if (def && def.objects !== "all" && !def.objects.includes(ev.object)) return { kind: a.kind, ok: false, detail: `${def.label} doesn't apply to a ${ev.object}` };
    try {
      return exec({ api, wf, config: a.config, index, ev, ctx, actorId, scope, dryRun: !!opts.dryRun });
    } catch (err) {
      return { kind: a.kind, ok: false, detail: err instanceof Error ? err.message : "Action failed" };
    }
  });
  if (opts.dryRun) return { run: null, trace, ctx, steps, notices: [] };

  const okCount = steps.filter((x) => x.ok).length;
  const outcome = !steps.length ? "skipped" : okCount === steps.length ? "success" : okCount === 0 ? "failed" : "partial";
  const at = new Date().toISOString();
  const run: WorkflowRun = { id: api.uid("wr"), workflowId: wf.id, workflowName: wf.name, at, source: opts.source, event: ev.event, object: ev.object, recordId: ev.recordId, recordLabel: ctx.label, outcome, steps, actorId, dedupeKey: ev.dedupeKey };
  api.set((st) => ({
    workflowRuns: [run, ...st.workflowRuns].slice(0, RUN_LOG_CAP),
    workflows: st.workflows.map((w) => (w.id === wf.id ? { ...w, runs: w.runs + 1, lastRunAt: at } : w)),
  }));
  return { run, trace, ctx, steps, notices: scope.notices };
}

/* ───────────── change detection ───────────── */

function describeEvent(s: CrmState, ev: WfEvent) {
  const stages = s.pipelines.flatMap((p) => p.stages);
  const stageName = (id?: string) => stages.find((x) => x.id === id)?.name ?? id ?? "";
  switch (ev.event) {
    case "stage_changed":
      return `stage changed ${stageName(ev.from)} → ${stageName(ev.to)}`;
    case "status_changed":
      return `status changed ${String(ev.from ?? "").replace(/_/g, " ")} → ${String(ev.to ?? "").replace(/_/g, " ")}`;
    case "lifecycle_changed":
      return `lifecycle changed ${ev.from} → ${ev.to}`;
    case "updated":
      return `${(ev.changed ?? []).join(", ").replace(/_/g, " ")} changed`;
    default:
      return triggerDef(ev.object, ev.event)?.label.toLowerCase() ?? ev.event.replace(/_/g, " ");
  }
}

const RECENT_MS = 2 * 60_000;
const recent = (iso: string | undefined, ms = RECENT_MS) => !!iso && Date.now() - Date.parse(iso) < ms;

function diffById<T extends { id: string }>(prev: T[], next: T[]) {
  if (prev === next) return { added: [] as T[], changed: [] as [T, T][] };
  const before = new Map(prev.map((x) => [x.id, x] as const));
  const added: T[] = [];
  const changed: [T, T][] = [];
  for (const x of next) {
    const b = before.get(x.id);
    if (!b) added.push(x);
    else if (b !== x) changed.push([b, x]);
  }
  return { added, changed };
}

/** Trigger events implied by one store transition (prev → next). */
export function detectEvents(prev: CrmState, next: CrmState): WfEvent[] {
  const out: WfEvent[] = [];
  const deals = diffById(prev.deals, next.deals);
  deals.added.filter((d) => recent(d.createdAt)).forEach((d) => out.push({ object: "deal", event: "created", recordId: d.id }));
  deals.changed.forEach(([a, b]) => {
    if (a.stageId !== b.stageId) out.push({ object: "deal", event: "stage_changed", recordId: b.id, from: a.stageId, to: b.stageId });
    const changed = [a.amount !== b.amount ? "amount" : "", a.ownerId !== b.ownerId ? "owner" : "", a.closeDate !== b.closeDate ? "close_date" : ""].filter(Boolean);
    if (changed.length) out.push({ object: "deal", event: "updated", recordId: b.id, changed });
  });
  const contacts = diffById(prev.contacts, next.contacts);
  contacts.added.filter((c) => recent(c.createdAt)).forEach((c) => out.push({ object: "contact", event: "created", recordId: c.id }));
  contacts.changed.forEach(([a, b]) => {
    if (a.lifecycleStage !== b.lifecycleStage) out.push({ object: "contact", event: "lifecycle_changed", recordId: b.id, from: a.lifecycleStage, to: b.lifecycleStage });
  });
  diffById(prev.companies, next.companies).added.filter((c) => recent(c.createdAt)).forEach((c) => out.push({ object: "company", event: "created", recordId: c.id }));
  const tickets = diffById(prev.tickets, next.tickets);
  tickets.added.filter((t) => recent(t.createdAt)).forEach((t) => out.push({ object: "ticket", event: "created", recordId: t.id }));
  tickets.changed.forEach(([a, b]) => {
    if (a.stageId !== b.stageId) out.push({ object: "ticket", event: "stage_changed", recordId: b.id, from: a.stageId, to: b.stageId });
  });
  const issues = diffById(prev.issues, next.issues);
  issues.added.filter((i) => recent(i.createdAt)).forEach((i) => out.push({ object: "issue", event: "created", recordId: i.id }));
  issues.changed.forEach(([a, b]) => {
    if (a.status !== b.status) out.push({ object: "issue", event: "status_changed", recordId: b.id, from: a.status, to: b.status });
    if (a.assigneeId !== b.assigneeId && b.assigneeId) out.push({ object: "issue", event: "assigned", recordId: b.id, from: a.assigneeId ?? "", to: b.assigneeId });
  });
  diffById(prev.epics, next.epics).added.forEach((e) => out.push({ object: "epic", event: "created", recordId: e.id }));
  diffById(prev.crossLinks, next.crossLinks)
    .added.filter((x) => x.agileType === "issue" && recent(x.createdAt))
    .forEach((x) => out.push({ object: "issue", event: "link_created", recordId: x.agileId, linkId: x.id }));
  newActivities(prev, next).forEach((a) => a.links.contactIds.forEach((cid) => out.push({ object: "contact", event: "activity_logged", recordId: cid, activityId: a.id, description: `${a.type}${a.direction ? ` (${a.direction})` : ""} logged: ${a.subject}` })));
  return out;
}

export function newActivities(prev: CrmState, next: CrmState): Activity[] {
  if (prev.activities === next.activities) return [];
  const before = new Set(prev.activities.map((a) => a.id));
  // backdated logs (a call from yesterday) still count; restored records from days ago don't
  return next.activities.filter((a) => !before.has(a.id) && Date.now() - Date.parse(a.timestamp) < 3 * DAY);
}

/** an inbound reply that should stop a sequence for this contact */
export function isReply(a: Activity) {
  const type = a.type as string;
  if (type === "meeting") return true;
  if (a.direction !== "inbound") return false;
  return type === "email" || type === "whatsapp" || (type === "call" && a.callOutcome === "connected");
}

/* ───────────── time-based (scheduled) triggers ───────────── */

export function scheduledEvents(s: CrmState, wf: Workflow, now = Date.now()): WfEvent[] {
  const def = triggerDef(wf.trigger.object, wf.trigger.event);
  if (!def?.timed) return [];
  const out: WfEvent[] = [];
  const closedStages = new Set(s.pipelines.flatMap((p) => p.stages).filter((x) => x.closed).map((x) => x.id));
  if (wf.trigger.object === "ticket" && wf.trigger.event === "sla_breached") {
    s.tickets.forEach((t) => {
      if (t.closedAt || closedStages.has(t.stageId)) return;
      if (slaState(t, now).state !== "breached") return;
      out.push({ object: "ticket", event: "sla_breached", recordId: t.id, dedupeKey: `${wf.id}:${t.id}:${t.slaDueAt}`, description: `SLA breached (due ${formatDate(t.slaDueAt, "datetime")} WIB)` });
    });
  }
  if (wf.trigger.object === "issue" && wf.trigger.event === "idle") {
    s.issues.forEach((i) => {
      if (i.status === "done") return;
      out.push({ object: "issue", event: "idle", recordId: i.id, dedupeKey: `${wf.id}:${i.id}:${i.updatedAt}`, description: `no update since ${formatDate(i.updatedAt)}` });
    });
  }
  if (wf.trigger.object === "deal" && wf.trigger.event === "idle") {
    s.deals.forEach((d) => {
      if (closedStages.has(d.stageId)) return;
      const last = lastActivityAt(s, "dealIds", d.id) ?? d.createdAt;
      out.push({ object: "deal", event: "idle", recordId: d.id, dedupeKey: `${wf.id}:${d.id}:${last}`, description: `no activity since ${formatDate(last)}` });
    });
  }
  if (wf.trigger.object === "deal" && wf.trigger.event === "quote_expiring") {
    s.quotes.forEach((q) => {
      if (q.status !== "sent" && q.status !== "approved") return;
      if (Date.parse(q.expiresAt) < now) return;
      out.push({ object: "deal", event: "quote_expiring", recordId: q.dealId, dedupeKey: `${wf.id}:${q.id}:${q.expiresAt}`, description: `quote ${q.number} expires ${formatDate(q.expiresAt)}` });
    });
  }
  return out;
}

export { triggerLabel };
