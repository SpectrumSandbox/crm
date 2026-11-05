/* Record → condition fields, label, link and token context for workflows (W10). Pure; only type imports from the store. */
import type { CrmState } from "../../lib/store";
import type { CrmObjectType } from "../../lib/types";
import { issueStatusMeta } from "../../lib/meta";
import type { RecordFields } from "./conditions";
import type { WfObject } from "./types";

const DAY = 86_400_000;
const HOUR = 3_600_000;

export interface WfEvent {
  object: WfObject;
  event: string;
  recordId: string;
  /** previous value for *_changed events (stage id, status, lifecycle) */
  from?: string;
  to?: string;
  /** deal fields that changed (updated) */
  changed?: string[];
  activityId?: string;
  linkId?: string;
  /** time-based events fire once per key */
  dedupeKey?: string;
  /** human sentence for {{trigger}} */
  description?: string;
}

export interface RecordCtx {
  exists: boolean;
  label: string;
  href: string | null;
  fields: RecordFields;
  ownerId: string | null;
  /** CRM target used for tokens, timeline notes and links */
  crm: { type: CrmObjectType; id: string } | null;
  contactIds: string[];
  /** extra template values ({{record.name}}, {{trigger}}, {{issue.key}}, {{idle_days}} …) */
  extra: Record<string, string>;
}

type S = Pick<
  CrmState,
  "deals" | "contacts" | "companies" | "tickets" | "issues" | "epics" | "projects" | "users" | "pipelines" | "activities" | "crossLinks" | "quotes" | "sequenceEnrollments"
>;

const daysSince = (iso: string | null | undefined, now: number) => (iso ? Math.floor((now - Date.parse(iso)) / DAY) : 0);

export function lastActivityAt(s: Pick<S, "activities">, key: "dealIds" | "contactIds" | "companyIds" | "ticketIds", id: string) {
  let best = "";
  for (const a of s.activities) if (a.links[key].includes(id) && a.type !== "jira" && a.timestamp > best && Date.parse(a.timestamp) <= Date.now()) best = a.timestamp;
  return best || null;
}

/** Simple SLA state (independent of the tickets page): paused tickets never breach. */
export function slaState(t: CrmState["tickets"][number], now: number) {
  if (t.closedAt) return { state: Date.parse(t.closedAt) <= Date.parse(t.slaDueAt) ? "met" : "breached", hoursLeft: 0 } as const;
  if (t.slaPausedAt) return { state: "on_track", hoursLeft: (Date.parse(t.slaDueAt) - Date.parse(t.slaPausedAt)) / HOUR } as const;
  const left = (Date.parse(t.slaDueAt) - now) / HOUR;
  return { state: left < 0 ? "breached" : left <= 4 ? "due_soon" : "on_track", hoursLeft: left } as const;
}

export function issueLinks(s: Pick<S, "crossLinks">, issueId: string) {
  return s.crossLinks.filter((x) => x.agileType === "issue" && x.agileId === issueId);
}

export function recordContext(s: S, object: WfObject, id: string, ev?: Partial<WfEvent>, now = Date.now()): RecordCtx {
  const stages = s.pipelines.flatMap((p) => p.stages);
  const userName = (uid: string | null | undefined) => s.users.find((u) => u.id === uid)?.name ?? "";
  const empty: RecordCtx = { exists: false, label: id, href: null, fields: {}, ownerId: null, crm: null, contactIds: [], extra: { "record.name": id } };
  const trigger = ev?.description ?? (ev?.event ? ev.event.replace(/_/g, " ") : "");

  if (object === "deal") {
    const d = s.deals.find((x) => x.id === id);
    if (!d) return empty;
    const stage = stages.find((x) => x.id === d.stageId);
    const company = s.companies.find((c) => c.id === d.companyId);
    const last = lastActivityAt(s, "dealIds", d.id);
    const quotes = s.quotes.filter((q) => q.dealId === d.id && (q.status === "sent" || q.status === "approved"));
    const quoteDays = quotes.length ? Math.min(...quotes.map((q) => Math.ceil((Date.parse(q.expiresAt) - now) / DAY))) : null;
    const blocked = s.crossLinks.some((x) => x.crmType === "deal" && x.crmId === d.id && x.linkType === "blocks" && s.issues.some((i) => i.id === x.agileId && i.status !== "done"));
    const fields: RecordFields = {
      name: d.name,
      stage: stage?.name ?? "",
      from_stage: ev?.from ? (stages.find((x) => x.id === ev.from)?.name ?? ev.from) : "",
      closed: stage?.closed ?? "open",
      pipeline: s.pipelines.find((p) => p.id === d.pipelineId)?.name ?? "",
      amount: d.amount,
      probability: Math.round((stage?.probability ?? 0) * 100),
      owner: userName(d.ownerId),
      owner_id: d.ownerId,
      capability: d.capability,
      priority: d.priority,
      deal_type: d.dealType,
      company: company?.name ?? "",
      company_tier: company?.tier ?? "",
      days_in_stage: daysSince(d.stageEnteredAt, now),
      idle_days: daysSince(last ?? d.createdAt, now),
      close_in_days: Math.ceil((Date.parse(d.closeDate) - now) / DAY),
      quote_expires_in_days: quoteDays,
      changed: ev?.changed ?? [],
      blocked,
    };
    return {
      exists: true,
      label: d.name,
      href: `/deals/${d.id}`,
      fields,
      ownerId: d.ownerId,
      crm: { type: "deal", id: d.id },
      contactIds: d.contactIds,
      extra: { "record.name": d.name, trigger, idle_days: String(fields.idle_days), quote_expires_in_days: quoteDays === null ? "" : String(quoteDays) },
    };
  }

  if (object === "contact") {
    const c = s.contacts.find((x) => x.id === id);
    if (!c) return empty;
    const act = ev?.activityId ? s.activities.find((a) => a.id === ev.activityId) : undefined;
    const name = `${c.firstName} ${c.lastName}`.trim();
    const fields: RecordFields = {
      name,
      first_name: c.firstName,
      email: c.email,
      lifecycle: c.lifecycleStage,
      from_lifecycle: ev?.from ?? "",
      lead_status: c.leadStatus,
      owner: userName(c.ownerId),
      owner_id: c.ownerId,
      source: c.source,
      company: s.companies.find((x) => x.id === c.companyId)?.name ?? "",
      score: c.leadScore,
      city: c.city,
      job_title: c.jobTitle,
      in_sequence: s.sequenceEnrollments.some((e) => e.contactId === c.id && e.status === "active"),
      activity_type: act?.type ?? "",
      direction: act?.direction ?? "",
      call_outcome: act?.callOutcome ?? "",
    };
    return { exists: true, label: name, href: `/contacts/${c.id}`, fields, ownerId: c.ownerId, crm: { type: "contact", id: c.id }, contactIds: [c.id], extra: { "record.name": name, trigger } };
  }

  if (object === "company") {
    const c = s.companies.find((x) => x.id === id);
    if (!c) return empty;
    const fields: RecordFields = { name: c.name, industry: c.industry, tier: c.tier, city: c.city, lifecycle: c.lifecycleStage, owner: userName(c.ownerId), owner_id: c.ownerId };
    const contactIds = s.contacts.filter((x) => x.companyId === c.id).sort((a, b) => b.leadScore - a.leadScore).slice(0, 1).map((x) => x.id);
    return { exists: true, label: c.name, href: `/companies/${c.id}`, fields, ownerId: c.ownerId, crm: { type: "company", id: c.id }, contactIds, extra: { "record.name": c.name, trigger } };
  }

  if (object === "ticket") {
    const t = s.tickets.find((x) => x.id === id);
    if (!t) return empty;
    const stage = stages.find((x) => x.id === t.stageId);
    const company = s.companies.find((c) => c.id === t.companyId);
    const sla = slaState(t, now);
    const fields: RecordFields = {
      subject: t.subject,
      stage: stage?.name ?? "",
      from_stage: ev?.from ? (stages.find((x) => x.id === ev.from)?.name ?? ev.from) : "",
      priority: t.priority,
      category: t.category,
      company: company?.name ?? "",
      company_tier: company?.tier ?? "",
      owner: userName(t.ownerId),
      owner_id: t.ownerId,
      sla: sla.state,
      hours_left: Math.round(sla.hoursLeft * 10) / 10,
      escalated: s.crossLinks.some((x) => x.crmType === "ticket" && x.crmId === t.id && x.linkType === "escalated_from"),
    };
    return { exists: true, label: `${t.id.toUpperCase()} ${t.subject}`, href: `/tickets/${t.id}`, fields, ownerId: t.ownerId, crm: { type: "ticket", id: t.id }, contactIds: t.contactId ? [t.contactId] : [], extra: { "record.name": t.subject, trigger } };
  }

  if (object === "issue") {
    const i = s.issues.find((x) => x.id === id);
    if (!i) return empty;
    const project = s.projects.find((p) => p.id === i.projectId);
    const links = issueLinks(s, i.id);
    const link = ev?.linkId ? s.crossLinks.find((x) => x.id === ev.linkId) : undefined;
    const siblings = i.parentId ? s.issues.filter((x) => x.parentId === i.parentId) : [];
    const firstCrm = links.find((x) => x.crmType === "deal") ?? links.find((x) => x.crmType === "ticket") ?? links[0];
    const contactIds = Array.from(
      new Set(
        links.flatMap((x) => {
          if (x.crmType === "contact") return [x.crmId];
          if (x.crmType === "ticket") return s.tickets.filter((t) => t.id === x.crmId && t.contactId).map((t) => t.contactId as string);
          if (x.crmType === "deal") return s.deals.find((d) => d.id === x.crmId)?.contactIds.slice(0, 1) ?? [];
          return [];
        }),
      ),
    );
    const fields: RecordFields = {
      key: i.key,
      summary: i.summary,
      status: issueStatusMeta[i.status]?.label ?? i.status,
      from_status: ev?.from ? (issueStatusMeta[ev.from as keyof typeof issueStatusMeta]?.label ?? ev.from) : "",
      type: i.type,
      priority: i.priority,
      project: project?.key ?? "",
      assignee: userName(i.assigneeId),
      assignee_id: i.assigneeId ?? "",
      points: i.storyPoints ?? 0,
      labels: i.labels,
      link: links.map((x) => `${x.linkType} ${x.crmType}`),
      crm: Array.from(new Set(links.map((x) => x.crmType))),
      is_subtask: !!i.parentId,
      siblings_done: siblings.length > 0 && siblings.every((x) => x.status === "done"),
      idle_days: daysSince(i.updatedAt, now),
      due_in_days: i.dueDate ? Math.ceil((Date.parse(i.dueDate) - now) / DAY) : null,
      linktype: link?.linkType ?? "",
      link_crm: link?.crmType ?? "",
    };
    return {
      exists: true,
      label: `${i.key} ${i.summary}`,
      href: `/board?issue=${i.key}`,
      fields,
      ownerId: i.assigneeId ?? project?.leadId ?? null,
      crm: firstCrm ? { type: firstCrm.crmType, id: firstCrm.crmId } : null,
      contactIds,
      extra: { "record.name": i.summary, "issue.key": i.key, trigger, idle_days: String(fields.idle_days) },
    };
  }

  const e = s.epics.find((x) => x.id === id);
  if (!e) return empty;
  const project = s.projects.find((p) => p.id === e.projectId);
  return {
    exists: true,
    label: `${e.key} ${e.name}`,
    href: `/board?project=${e.projectId}`,
    fields: { name: e.name, status: issueStatusMeta[e.status]?.label ?? e.status, project: project?.key ?? "" },
    ownerId: e.ownerId,
    crm: null,
    contactIds: [],
    extra: { "record.name": e.name, trigger },
  };
}

/** Records a manual test run can target, for the builder's record picker. */
export function recordsFor(s: S, object: WfObject): { id: string; label: string }[] {
  switch (object) {
    case "deal":
      return s.deals.map((d) => ({ id: d.id, label: d.name }));
    case "contact":
      return s.contacts.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}` }));
    case "company":
      return s.companies.map((c) => ({ id: c.id, label: c.name }));
    case "ticket":
      return s.tickets.map((t) => ({ id: t.id, label: `${t.id.toUpperCase()} ${t.subject}` }));
    case "issue":
      return s.issues.map((i) => ({ id: i.id, label: `${i.key} ${i.summary}` }));
    default:
      return s.epics.map((e) => ({ id: e.id, label: `${e.key} ${e.name}` }));
  }
}
