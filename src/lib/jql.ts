/* JQL-style issue query language: `key:value` terms ANDed together, plus free text.
 *
 *   priority:high|highest  status:"in progress"  type:bug  assignee:me  sprint:current
 *   epic:UAV-1  project:IOT  label:field  points:>3  deal.stage:negotiation  lead_score:>75
 *   -label:docs (negate a term)    "quoted free text"    plain words
 */
import type { Contact, CrossLink, Deal, Epic, Issue, IssuePriority, IssueStatus, IssueType, Pipeline, Project, Sprint, User } from "./types";
import { ISSUE_PRIORITIES, ISSUE_STATUSES, ISSUE_TYPES } from "./types";

export interface JqlContext {
  users: User[];
  sprints: Sprint[];
  epics: Epic[];
  projects: Project[];
  deals: Deal[];
  contacts: Contact[];
  crossLinks: CrossLink[];
  pipelines: Pipeline[];
  currentUserId: string;
}

export type JqlKey = "priority" | "status" | "type" | "assignee" | "sprint" | "epic" | "project" | "label" | "points" | "deal.stage" | "lead_score";

export const JQL_KEYS: { key: JqlKey; hint: string; numeric?: boolean }[] = [
  { key: "status", hint: "backlog, todo, in_progress, in_review, done" },
  { key: "priority", hint: "highest … lowest — use | for any of" },
  { key: "type", hint: "story, task, bug, deal_action, support_escalation, subtask" },
  { key: "assignee", hint: "me, unassigned or a first name" },
  { key: "sprint", hint: "current, future, closed, none" },
  { key: "epic", hint: "epic key, e.g. UAV-1, or none" },
  { key: "project", hint: "project key, e.g. IOT" },
  { key: "label", hint: "issue label" },
  { key: "points", hint: "story points: >3, <5, =8, >=2", numeric: true },
  { key: "deal.stage", hint: "linked deal in this stage, e.g. negotiation" },
  { key: "lead_score", hint: "linked contact lead score: >75", numeric: true },
];

const KEY_ALIASES: Record<string, JqlKey> = {
  priority: "priority",
  prio: "priority",
  status: "status",
  type: "type",
  issuetype: "type",
  assignee: "assignee",
  sprint: "sprint",
  epic: "epic",
  project: "project",
  label: "label",
  labels: "label",
  points: "points",
  sp: "points",
  storypoints: "points",
  "deal.stage": "deal.stage",
  dealstage: "deal.stage",
  lead_score: "lead_score",
  leadscore: "lead_score",
  "lead.score": "lead_score",
};

/** lowercase, spaces/hyphens → underscores */
export const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "_");

const STATUS_ALIASES: Record<string, IssueStatus> = { to_do: "todo", open: "todo", progress: "in_progress", wip: "in_progress", review: "in_review", closed: "done", resolved: "done" };
const TYPE_ALIASES: Record<string, IssueType> = { sub_task: "subtask", escalation: "support_escalation", deal: "deal_action", action: "deal_action" };

export interface JqlToken {
  raw: string;
  start: number;
  end: number;
  negate: boolean;
  key: string | null; // as typed (lower-case), null for free text
  value: string; // unquoted
}

export interface JqlError {
  message: string;
  token: string;
}

export type Cmp = ">" | "<" | "=" | ">=" | "<=";

export type JqlTerm =
  | { key: "priority"; values: IssuePriority[]; negate: boolean; raw: string }
  | { key: "status"; values: IssueStatus[]; negate: boolean; raw: string }
  | { key: "type"; values: IssueType[]; negate: boolean; raw: string }
  | { key: "assignee" | "sprint" | "epic" | "project" | "label" | "deal.stage"; values: string[]; negate: boolean; raw: string }
  | { key: "points" | "lead_score"; cmp: Cmp; n: number; negate: boolean; raw: string };

export interface JqlParsed {
  terms: JqlTerm[];
  text: string[];
  errors: JqlError[];
}

/** Splits the query into tokens; quotes may wrap a whole token or just its value. */
export function tokenize(q: string): JqlToken[] {
  const out: JqlToken[] = [];
  let i = 0;
  while (i < q.length) {
    while (i < q.length && /\s/.test(q[i]!)) i++;
    if (i >= q.length) break;
    const start = i;
    let inQuote = false;
    let buf = "";
    while (i < q.length && (inQuote || !/\s/.test(q[i]!))) {
      if (q[i] === '"') inQuote = !inQuote;
      buf += q[i];
      i++;
    }
    const raw = buf;
    let body = raw;
    let negate = false;
    if ((body.startsWith("-") || body.startsWith("!")) && body.length > 1 && body.includes(":")) {
      negate = true;
      body = body.slice(1);
    }
    const colon = body.startsWith('"') ? -1 : body.indexOf(":");
    if (colon > 0) {
      out.push({ raw, start, end: i, negate, key: body.slice(0, colon).toLowerCase(), value: body.slice(colon + 1).replace(/"/g, "") });
    } else {
      out.push({ raw, start, end: i, negate: false, key: null, value: raw.replace(/"/g, "") });
    }
  }
  return out;
}

function parseCmp(v: string): { cmp: Cmp; n: number } | null {
  const m = v.trim().match(/^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return { cmp: (m[1] as Cmp | undefined) ?? "=", n: Number(m[2]) };
}

export function compare(x: number, cmp: Cmp, n: number) {
  if (cmp === ">") return x > n;
  if (cmp === "<") return x < n;
  if (cmp === ">=") return x >= n;
  if (cmp === "<=") return x <= n;
  return x === n;
}

const firstName = (u: User) => u.name.split(/\s+/)[0]!.toLowerCase();

/** Parses and validates against the store context (unknown users, epics, stages…). */
export function parseJql(q: string, ctx: JqlContext): JqlParsed {
  const terms: JqlTerm[] = [];
  const text: string[] = [];
  const errors: JqlError[] = [];
  const dealStages = new Set(ctx.pipelines.filter((p) => p.objectType === "deal").flatMap((p) => p.stages.map((s) => norm(s.name))));

  tokenize(q).forEach((t) => {
    if (t.key === null) {
      if (t.value.toUpperCase() === "AND") return;
      if (t.value.trim()) text.push(t.value.toLowerCase());
      return;
    }
    const key = KEY_ALIASES[t.key];
    if (!key) {
      errors.push({ token: t.raw, message: `Unknown field “${t.key}” — try ${JQL_KEYS.map((k) => k.key).join(", ")}` });
      return;
    }
    if (!t.value.trim()) {
      errors.push({ token: t.raw, message: `${key}: needs a value` });
      return;
    }
    if (key === "points" || key === "lead_score") {
      const c = parseCmp(t.value);
      if (!c) {
        errors.push({ token: t.raw, message: `${key}: expected a number with an optional >, <, =, >= or <= (e.g. ${key}:>3)` });
        return;
      }
      terms.push({ key, cmp: c.cmp, n: c.n, negate: t.negate, raw: t.raw });
      return;
    }
    const parts = t.value
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean);
    const bad: string[] = [];
    if (key === "priority") {
      const vals = parts.map(norm).filter((p) => (ISSUE_PRIORITIES as readonly string[]).includes(p) || (bad.push(p), false)) as IssuePriority[];
      if (bad.length) errors.push({ token: t.raw, message: `priority: unknown “${bad.join(", ")}” — use ${ISSUE_PRIORITIES.join(", ")}` });
      if (vals.length) terms.push({ key, values: vals, negate: t.negate, raw: t.raw });
      return;
    }
    if (key === "status") {
      const vals: IssueStatus[] = [];
      parts.forEach((p) => {
        const n = norm(p);
        const s = (ISSUE_STATUSES as readonly string[]).includes(n) ? (n as IssueStatus) : STATUS_ALIASES[n];
        if (s) vals.push(s);
        else bad.push(p);
      });
      if (bad.length) errors.push({ token: t.raw, message: `status: unknown “${bad.join(", ")}” — use backlog, todo, "in progress", "in review", done` });
      if (vals.length) terms.push({ key, values: vals, negate: t.negate, raw: t.raw });
      return;
    }
    if (key === "type") {
      const vals: IssueType[] = [];
      parts.forEach((p) => {
        const n = norm(p);
        const s = (ISSUE_TYPES as readonly string[]).includes(n) ? (n as IssueType) : TYPE_ALIASES[n];
        if (s) vals.push(s);
        else bad.push(p);
      });
      if (bad.length) errors.push({ token: t.raw, message: `type: unknown “${bad.join(", ")}” — use ${ISSUE_TYPES.join(", ")}` });
      if (vals.length) terms.push({ key, values: vals, negate: t.negate, raw: t.raw });
      return;
    }
    const vals: string[] = [];
    parts.forEach((p) => {
      const n = p.toLowerCase();
      if (key === "assignee") {
        if (n === "me" || n === "unassigned" || n === "none") return vals.push(n);
        const u = ctx.users.find((x) => firstName(x) === n || x.id === n || x.name.toLowerCase() === n);
        if (u) vals.push(u.id);
        else bad.push(p);
      } else if (key === "sprint") {
        if (["current", "active", "future", "closed", "none", "backlog"].includes(n)) return vals.push(n === "active" ? "current" : n === "backlog" ? "none" : n);
        const sp = ctx.sprints.find((s) => norm(s.name) === norm(p) || s.id === n);
        if (sp) vals.push(sp.id);
        else bad.push(p);
      } else if (key === "epic") {
        if (n === "none") return vals.push(n);
        const e = ctx.epics.find((x) => x.key.toLowerCase() === n || x.id === n);
        if (e) vals.push(e.id);
        else bad.push(p);
      } else if (key === "project") {
        const pr = ctx.projects.find((x) => x.key.toLowerCase() === n || x.id === n);
        if (pr) vals.push(pr.id);
        else bad.push(p);
      } else if (key === "label") {
        vals.push(n);
      } else if (key === "deal.stage") {
        const ns = norm(p);
        if (dealStages.has(ns)) vals.push(ns);
        else bad.push(p);
      }
    });
    if (bad.length) {
      const what = { assignee: "user", sprint: "sprint", epic: "epic key", project: "project key", label: "label", "deal.stage": "deal stage" }[key];
      errors.push({ token: t.raw, message: `${key}: no ${what} “${bad.join(", ")}”` });
    }
    if (vals.length) terms.push({ key, values: vals, negate: t.negate, raw: t.raw });
  });
  return { terms, text, errors };
}

/** Compiles a parsed query into a predicate. Invalid terms were dropped by the parser. */
export function compileJql(parsed: JqlParsed, ctx: JqlContext): (i: Issue) => boolean {
  const sprintById = new Map(ctx.sprints.map((s) => [s.id, s]));
  const needsLinks = parsed.terms.some((t) => t.key === "deal.stage" || t.key === "lead_score");
  const dealStagesOf = new Map<string, Set<string>>();
  const scoresOf = new Map<string, number[]>();
  if (needsLinks) {
    const stageName = new Map(ctx.pipelines.flatMap((p) => p.stages.map((s) => [s.id, norm(s.name)] as const)));
    const dealById = new Map(ctx.deals.map((d) => [d.id, d]));
    const contactById = new Map(ctx.contacts.map((c) => [c.id, c]));
    ctx.crossLinks.forEach((x) => {
      if (x.agileType !== "issue") return;
      const scores = scoresOf.get(x.agileId) ?? [];
      if (x.crmType === "deal") {
        const d = dealById.get(x.crmId);
        if (d) {
          const set = dealStagesOf.get(x.agileId) ?? new Set<string>();
          const sn = stageName.get(d.stageId);
          if (sn) set.add(sn);
          dealStagesOf.set(x.agileId, set);
          d.contactIds.forEach((cid) => {
            const c = contactById.get(cid);
            if (c) scores.push(c.leadScore);
          });
        }
      }
      if (x.crmType === "contact") {
        const c = contactById.get(x.crmId);
        if (c) scores.push(c.leadScore);
      }
      scoresOf.set(x.agileId, scores);
    });
  }

  const test = (t: JqlTerm, i: Issue): boolean => {
    switch (t.key) {
      case "priority":
        return t.values.includes(i.priority);
      case "status":
        return t.values.includes(i.status);
      case "type":
        return t.values.includes(i.type);
      case "assignee":
        return t.values.some((v) => (v === "me" ? i.assigneeId === ctx.currentUserId : v === "unassigned" || v === "none" ? !i.assigneeId : i.assigneeId === v));
      case "sprint": {
        const sp = i.sprintId ? sprintById.get(i.sprintId) : undefined;
        return t.values.some((v) => (v === "current" ? sp?.state === "active" : v === "future" ? sp?.state === "future" : v === "closed" ? sp?.state === "closed" : v === "none" ? !sp : i.sprintId === v));
      }
      case "epic":
        return t.values.some((v) => (v === "none" ? !i.epicId : i.epicId === v));
      case "project":
        return t.values.includes(i.projectId);
      case "label":
        return t.values.some((v) => i.labels.some((l) => l.toLowerCase() === v));
      case "deal.stage": {
        const st = dealStagesOf.get(i.id);
        return !!st && t.values.some((v) => st.has(v));
      }
      case "points":
        return i.storyPoints != null && compare(i.storyPoints, t.cmp, t.n);
      case "lead_score":
        return (scoresOf.get(i.id) ?? []).some((s) => compare(s, t.cmp, t.n));
    }
  };

  return (i) => {
    for (const t of parsed.terms) {
      const ok = test(t, i);
      if (t.negate ? ok : !ok) return false;
    }
    if (parsed.text.length) {
      const hay = `${i.key} ${i.summary} ${i.labels.join(" ")}`.toLowerCase();
      if (!parsed.text.every((w) => hay.includes(w))) return false;
    }
    return true;
  };
}

/* ───────────── autocomplete ───────────── */

export interface JqlSuggestion {
  label: string;
  hint?: string;
  /** replacement text for the token under the caret */
  insert: string;
}

const quoteIfNeeded = (v: string) => (/\s/.test(v) ? `"${v}"` : v);

function valuesFor(key: JqlKey, ctx: JqlContext, issues: Issue[]): { value: string; hint?: string }[] {
  switch (key) {
    case "priority":
      return ISSUE_PRIORITIES.map((v) => ({ value: v }));
    case "status":
      return [{ value: "backlog" }, { value: "todo" }, { value: '"in progress"' }, { value: '"in review"' }, { value: "done" }];
    case "type":
      return ISSUE_TYPES.map((v) => ({ value: v }));
    case "assignee":
      return [{ value: "me", hint: "issues assigned to you" }, { value: "unassigned" }, ...ctx.users.filter((u) => issues.some((i) => i.assigneeId === u.id)).map((u) => ({ value: firstName(u), hint: u.name }))];
    case "sprint":
      return [{ value: "current", hint: "active sprints" }, { value: "future" }, { value: "closed" }, { value: "none", hint: "not in a sprint" }];
    case "epic":
      return [...ctx.epics.map((e) => ({ value: e.key, hint: e.name })), { value: "none" }];
    case "project":
      return ctx.projects.map((p) => ({ value: p.key, hint: p.name }));
    case "label":
      return Array.from(new Set(issues.flatMap((i) => i.labels)))
        .sort()
        .map((l) => ({ value: l }));
    case "points":
      return [{ value: ">3" }, { value: "<5" }, { value: "=8" }, { value: ">=13" }];
    case "deal.stage":
      return Array.from(new Map(ctx.pipelines.filter((p) => p.objectType === "deal").flatMap((p) => p.stages.map((s) => [norm(s.name), s.name] as const))).entries()).map(([v, name]) => ({ value: v, hint: name }));
    case "lead_score":
      return [{ value: ">75" }, { value: ">=60" }, { value: "<40" }];
  }
}

/** Suggestions for the token under the caret. */
export function suggestJql(q: string, caret: number, ctx: JqlContext, issues: Issue[]): { suggestions: JqlSuggestion[]; start: number; end: number } {
  const tokens = tokenize(q);
  const tok = tokens.find((t) => caret >= t.start && caret <= t.end);
  const start = tok?.start ?? caret;
  const end = tok?.end ?? caret;
  const raw = tok?.raw ?? "";
  const neg = raw.startsWith("-") || raw.startsWith("!") ? raw[0]! : "";
  const body = neg ? raw.slice(1) : raw;
  const colon = body.indexOf(":");
  if (colon < 0) {
    const prefix = body.toLowerCase();
    const suggestions = JQL_KEYS.filter((k) => k.key.startsWith(prefix) || (prefix.length > 1 && k.key.includes(prefix))).map((k) => ({ label: `${k.key}:`, hint: k.hint, insert: `${neg}${k.key}:` }));
    return { suggestions: prefix && suggestions.length === 1 && suggestions[0]!.label === `${prefix}:` ? [] : suggestions, start, end };
  }
  const key = KEY_ALIASES[body.slice(0, colon).toLowerCase()];
  if (!key) return { suggestions: [], start, end };
  const valuePart = body.slice(colon + 1);
  const pipe = valuePart.lastIndexOf("|");
  const before = pipe >= 0 ? valuePart.slice(0, pipe + 1) : "";
  const current = (pipe >= 0 ? valuePart.slice(pipe + 1) : valuePart).replace(/"/g, "").toLowerCase();
  const numeric = key === "points" || key === "lead_score";
  const already = new Set(before.split("|").map((p) => norm(p.replace(/"/g, ""))).filter(Boolean));
  const suggestions = valuesFor(key, ctx, issues)
    .filter((v) => !already.has(norm(v.value.replace(/"/g, ""))))
    .filter((v) => {
      const plain = v.value.replace(/"/g, "").toLowerCase();
      if (numeric) return !current || plain.startsWith(current);
      return plain.startsWith(current) || norm(plain).startsWith(norm(current)) || (current.length > 1 && (v.hint ?? "").toLowerCase().includes(current));
    })
    .filter((v) => v.value.replace(/"/g, "").toLowerCase() !== current || numeric)
    .slice(0, 12)
    .map((v) => ({ label: v.value.replace(/"/g, ""), hint: v.hint, insert: `${neg}${body.slice(0, colon)}:${before}${v.value.startsWith('"') ? v.value : quoteIfNeeded(v.value)} ` }));
  return { suggestions, start, end };
}
