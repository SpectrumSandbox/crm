/* JQL-style issue query language.
 *
 *   priority:high|highest  status:"in progress"  type:bug  assignee:me  sprint:current
 *   epic:UAV-1  project:IOT  label:field  points:>3  deal.stage:negotiation  lead_score:>75
 *   due:overdue  due:<7d  due:thisweek  created:>-14d  updated:<-30d  due:<=endOfMonth()
 *   is:blocked  is:blocking  is:overdue  is:triage  is:unestimated  blocks:UAV-104  triage:pending
 *   (type:bug OR priority:highest) AND NOT status:done ORDER BY due ASC, priority DESC
 *   -label:docs (negate a term)    "quoted free text"    plain words
 *
 * Terms next to each other are ANDed. OR / AND / NOT are keywords (any case); group with ( ).
 * Dates are compared as WIB (UTC+7) calendar days.
 */
import type { Contact, CrossLink, Deal, Epic, Issue, IssueLink, IssuePriority, IssueStatus, IssueType, Pipeline, Project, Sprint, TriageState, User } from "./types";
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
  /** issue-to-issue links (is:blocked, blocks:KEY) */
  issueLinks?: IssueLink[];
  /** all issues (resolves blocks:KEY and whether a blocker is still open) */
  issues?: Issue[];
  /** clock for relative dates (defaults to Date.now()) */
  now?: number;
}

export type JqlKey =
  | "priority"
  | "status"
  | "type"
  | "assignee"
  | "sprint"
  | "epic"
  | "project"
  | "label"
  | "points"
  | "deal.stage"
  | "lead_score"
  | "due"
  | "created"
  | "updated"
  | "is"
  | "blocks"
  | "triage";

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
  { key: "due", hint: "overdue, none, today, thisweek, <7d, >=2026-12-01, <=endOfMonth()" },
  { key: "created", hint: "created:>-14d (last 14 days), created:thismonth" },
  { key: "updated", hint: "updated:<-30d (stale for a month)" },
  { key: "is", hint: "blocked, blocking, overdue, triage, unestimated" },
  { key: "blocks", hint: "issues that block this key, e.g. blocks:UAV-104" },
  { key: "triage", hint: "pending, accepted, declined" },
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
  due: "due",
  duedate: "due",
  created: "created",
  updated: "updated",
  is: "is",
  blocks: "blocks",
  triage: "triage",
};

/** lowercase, spaces/hyphens → underscores */
export const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "_");

const STATUS_ALIASES: Record<string, IssueStatus> = { to_do: "todo", open: "todo", progress: "in_progress", wip: "in_progress", review: "in_review", closed: "done", resolved: "done" };
const TYPE_ALIASES: Record<string, IssueType> = { sub_task: "subtask", escalation: "support_escalation", deal: "deal_action", action: "deal_action" };
const IS_VALUES = ["blocked", "blocking", "overdue", "triage", "unestimated"] as const;
type IsValue = (typeof IS_VALUES)[number];
const TRIAGE_VALUES: TriageState[] = ["pending", "accepted", "declined"];

export interface JqlToken {
  raw: string;
  start: number;
  end: number;
  negate: boolean;
  key: string | null; // as typed (lower-case), null for free text / keywords / parentheses
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
  | { key: "assignee" | "sprint" | "epic" | "project" | "label" | "deal.stage" | "blocks"; values: string[]; negate: boolean; raw: string }
  | { key: "is"; values: IsValue[]; negate: boolean; raw: string }
  | { key: "triage"; values: TriageState[]; negate: boolean; raw: string }
  | { key: "points" | "lead_score"; cmp: Cmp; n: number; negate: boolean; raw: string }
  /** inclusive WIB day range; kind "none" = no date, "overdue" = due before today and not done */
  | { key: "due" | "created" | "updated"; kind: "range" | "none" | "overdue"; from: string | null; to: string | null; negate: boolean; raw: string };

export type JqlExpr = { op: "and" | "or"; args: JqlExpr[] } | { op: "not"; arg: JqlExpr } | { op: "term"; term: JqlTerm } | { op: "text"; word: string };

export type JqlSortField = "key" | "priority" | "status" | "due" | "created" | "updated" | "points" | "rank" | "assignee" | "type" | "summary";
export const JQL_SORT_FIELDS: JqlSortField[] = ["due", "priority", "status", "created", "updated", "points", "rank", "key", "assignee", "type", "summary"];

export interface JqlParsed {
  /** every valid term (flat, for display) */
  terms: JqlTerm[];
  /** free-text words */
  text: string[];
  errors: JqlError[];
  /** boolean expression; null = match everything */
  expr: JqlExpr | null;
  orderBy: { field: JqlSortField; dir: 1 | -1 }[];
}

const isKeyword = (t: JqlToken, word: string) => t.key === null && !t.raw.startsWith('"') && t.value.toUpperCase() === word;

/** Splits the query into tokens; quotes may wrap a whole token or just its value; ( and ) are their own tokens. */
export function tokenize(q: string): JqlToken[] {
  const out: JqlToken[] = [];
  let i = 0;
  while (i < q.length) {
    while (i < q.length && /\s/.test(q[i]!)) i++;
    if (i >= q.length) break;
    if (q[i] === "(" || q[i] === ")") {
      out.push({ raw: q[i]!, start: i, end: i + 1, negate: false, key: null, value: q[i]! });
      i++;
      continue;
    }
    const start = i;
    let inQuote = false;
    let buf = "";
    let depth = 0; // parentheses opened inside this token, e.g. endOfMonth()
    while (i < q.length && (inQuote || (!/\s/.test(q[i]!) && (q[i] !== ")" || depth > 0) && !(q[i] === "(" && !/\w$/.test(buf))))) {
      if (!inQuote && q[i] === "(") depth++;
      if (!inQuote && q[i] === ")") depth--;
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

/* ───────────── WIB calendar-day helpers ───────────── */

const DAY = 86_400_000;
const WIB = 7 * 3_600_000;
/** yyyy-mm-dd of an instant in WIB */
export const wibDay = (ms: number) => new Date(ms + WIB).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const addMonths = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), last))).toISOString().slice(0, 10);
};
/** Monday-based week (Indonesian convention) */
const startOfWeek = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const startOfMonth = (day: string) => `${day.slice(0, 8)}01`;
const endOfMonth = (day: string) => addDays(addMonths(startOfMonth(day), 1), -1);

const DATE_FUNCS: Record<string, (today: string) => string> = {
  "today()": (t) => t,
  today: (t) => t,
  "startofweek()": startOfWeek,
  "endofweek()": (t) => addDays(startOfWeek(t), 6),
  "startofmonth()": startOfMonth,
  "endofmonth()": endOfMonth,
};
const DATE_RANGES: Record<string, (today: string) => [string, string]> = {
  today: (t) => [t, t],
  thisweek: (t) => [startOfWeek(t), addDays(startOfWeek(t), 6)],
  this_week: (t) => [startOfWeek(t), addDays(startOfWeek(t), 6)],
  nextweek: (t) => [addDays(startOfWeek(t), 7), addDays(startOfWeek(t), 13)],
  next_week: (t) => [addDays(startOfWeek(t), 7), addDays(startOfWeek(t), 13)],
  lastweek: (t) => [addDays(startOfWeek(t), -7), addDays(startOfWeek(t), -1)],
  last_week: (t) => [addDays(startOfWeek(t), -7), addDays(startOfWeek(t), -1)],
  thismonth: (t) => [startOfMonth(t), endOfMonth(t)],
  this_month: (t) => [startOfMonth(t), endOfMonth(t)],
};

/** Parses one date value into a day key: 7d, -14d, +2w, 1m, 2026-12-01, today, startOfWeek() … */
function parseDay(v: string, today: string): string | null {
  const s = v.trim().toLowerCase();
  if (DATE_FUNCS[s]) return DATE_FUNCS[s]!(today);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return s;
  const m = s.match(/^([+-]?\d+)\s*([dwm])$/);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "m" ? addMonths(today, n) : addDays(today, m[2] === "w" ? n * 7 : n);
}

/* ───────────── parser ───────────── */

/** Parses and validates against the store context (unknown users, epics, stages…). */
export function parseJql(q: string, ctx: JqlContext): JqlParsed {
  const terms: JqlTerm[] = [];
  const text: string[] = [];
  const errors: JqlError[] = [];
  const orderBy: JqlParsed["orderBy"] = [];
  const dealStages = new Set(ctx.pipelines.filter((p) => p.objectType === "deal").flatMap((p) => p.stages.map((s) => norm(s.name))));
  const today = wibDay(ctx.now ?? Date.now());

  let tokens = tokenize(q);

  /* ORDER BY tail */
  const orderAt = tokens.findIndex((t) => isKeyword(t, "ORDER"));
  if (orderAt >= 0) {
    const tail = tokens.slice(orderAt + 1);
    tokens = tokens.slice(0, orderAt);
    if (!tail.length || !isKeyword(tail[0]!, "BY")) {
      errors.push({ token: "ORDER", message: "write ORDER BY followed by a field, e.g. ORDER BY due ASC" });
    } else {
      const spec = tail
        .slice(1)
        .map((t) => t.raw)
        .join(" ");
      if (!spec.trim()) errors.push({ token: "ORDER BY", message: `needs a field: ${JQL_SORT_FIELDS.join(", ")}` });
      spec
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
        .forEach((part) => {
          const [f, d, ...rest] = part.split(/\s+/);
          const field = (f ?? "").toLowerCase().replace(/date$/, "") as JqlSortField;
          const alias: Record<string, JqlSortField> = { duedate: "due", storypoints: "points", sp: "points", prio: "priority" };
          const resolved = (alias[(f ?? "").toLowerCase()] ?? field) as JqlSortField;
          if (!JQL_SORT_FIELDS.includes(resolved)) {
            errors.push({ token: part, message: `ORDER BY: unknown field “${f}” — use ${JQL_SORT_FIELDS.join(", ")}` });
            return;
          }
          const dirWord = (d ?? "asc").toLowerCase();
          if ((dirWord !== "asc" && dirWord !== "desc") || rest.length) {
            errors.push({ token: part, message: "ORDER BY: put ASC or DESC after the field and separate fields with commas" });
            return;
          }
          orderBy.push({ field: resolved, dir: dirWord === "desc" ? -1 : 1 });
        });
    }
  }

  /** one key:value term → a JqlTerm (or null when invalid; the error is recorded) */
  const parseTerm = (t: JqlToken): JqlTerm | null => {
    const key = KEY_ALIASES[t.key!];
    if (!key) {
      errors.push({ token: t.raw, message: `Unknown field “${t.key}” — try ${JQL_KEYS.map((k) => k.key).join(", ")}` });
      return null;
    }
    if (!t.value.trim()) {
      errors.push({ token: t.raw, message: `${key}: needs a value` });
      return null;
    }
    if (key === "points" || key === "lead_score") {
      const c = parseCmp(t.value);
      if (!c) {
        errors.push({ token: t.raw, message: `${key}: expected a number with an optional >, <, =, >= or <= (e.g. ${key}:>3)` });
        return null;
      }
      return { key, cmp: c.cmp, n: c.n, negate: t.negate, raw: t.raw };
    }
    if (key === "due" || key === "created" || key === "updated") {
      const v = t.value.trim().toLowerCase();
      if (v === "none" || v === "empty") return { key, kind: "none", from: null, to: null, negate: t.negate, raw: t.raw };
      if (v === "overdue") {
        if (key !== "due") {
          errors.push({ token: t.raw, message: `${key}: “overdue” only applies to due` });
          return null;
        }
        return { key, kind: "overdue", from: null, to: null, negate: t.negate, raw: t.raw };
      }
      if (DATE_RANGES[v]) {
        const [from, to] = DATE_RANGES[v]!(today);
        return { key, kind: "range", from, to, negate: t.negate, raw: t.raw };
      }
      const m = v.match(/^(>=|<=|>|<|=)?\s*(.+)$/);
      const cmp = ((m?.[1] as Cmp | undefined) ?? "=") as Cmp;
      const day = m ? parseDay(m[2]!, today) : null;
      if (!day) {
        errors.push({ token: t.raw, message: `${key}: expected overdue, none, today, thisweek, thismonth, a relative date (7d, -14d, 2w, 1m), yyyy-mm-dd or startOfWeek()/endOfMonth(), with an optional >, <, >=, <=` });
        return null;
      }
      const range = cmp === "=" ? [day, day] : cmp === ">" ? [addDays(day, 1), null] : cmp === ">=" ? [day, null] : cmp === "<" ? [null, addDays(day, -1)] : [null, day];
      return { key, kind: "range", from: range[0], to: range[1], negate: t.negate, raw: t.raw };
    }
    const parts = t.value
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean);
    const bad: string[] = [];
    if (key === "priority") {
      const vals = parts.map(norm).filter((p) => (ISSUE_PRIORITIES as readonly string[]).includes(p) || (bad.push(p), false)) as IssuePriority[];
      if (bad.length) errors.push({ token: t.raw, message: `priority: unknown “${bad.join(", ")}” — use ${ISSUE_PRIORITIES.join(", ")}` });
      return vals.length ? { key, values: vals, negate: t.negate, raw: t.raw } : null;
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
      return vals.length ? { key, values: vals, negate: t.negate, raw: t.raw } : null;
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
      return vals.length ? { key, values: vals, negate: t.negate, raw: t.raw } : null;
    }
    if (key === "is") {
      const vals: IsValue[] = [];
      parts.forEach((p) => ((IS_VALUES as readonly string[]).includes(norm(p)) ? vals.push(norm(p) as IsValue) : bad.push(p)));
      if (bad.length) errors.push({ token: t.raw, message: `is: unknown “${bad.join(", ")}” — use ${IS_VALUES.join(", ")}` });
      return vals.length ? { key, values: vals, negate: t.negate, raw: t.raw } : null;
    }
    if (key === "triage") {
      const vals: TriageState[] = [];
      parts.forEach((p) => ((TRIAGE_VALUES as string[]).includes(norm(p)) ? vals.push(norm(p) as TriageState) : bad.push(p)));
      if (bad.length) errors.push({ token: t.raw, message: `triage: unknown “${bad.join(", ")}” — use ${TRIAGE_VALUES.join(", ")}` });
      return vals.length ? { key, values: vals, negate: t.negate, raw: t.raw } : null;
    }
    const vals: string[] = [];
    parts.forEach((p) => {
      const n = p.toLowerCase();
      if (key === "assignee") {
        if (n === "me" || n === "unassigned" || n === "none" || n === "currentuser()") return vals.push(n === "currentuser()" ? "me" : n);
        const u = ctx.users.find((x) => firstName(x) === n || x.id === n || x.name.toLowerCase() === n);
        if (u) vals.push(u.id);
        else bad.push(p);
      } else if (key === "sprint") {
        if (["current", "active", "future", "closed", "none", "backlog", "opensprints()"].includes(n)) return vals.push(n === "active" || n === "opensprints()" ? "current" : n === "backlog" ? "none" : n);
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
      } else if (key === "blocks") {
        const target = (ctx.issues ?? []).find((x) => x.key.toLowerCase() === n || x.id === n);
        if (target) vals.push(target.id);
        else bad.push(p);
      }
    });
    if (bad.length) {
      const what = { assignee: "user", sprint: "sprint", epic: "epic key", project: "project key", label: "label", "deal.stage": "deal stage", blocks: "issue" }[key];
      errors.push({ token: t.raw, message: `${key}: no ${what} “${bad.join(", ")}”` });
    }
    return vals.length ? { key, values: vals, negate: t.negate, raw: t.raw } : null;
  };

  /* boolean expression: or := and (OR and)* ; and := unary (AND? unary)* ; unary := NOT unary | ( or ) | term */
  let pos = 0;
  const peek = () => tokens[pos];
  const isOr = (t?: JqlToken) => !!t && isKeyword(t, "OR");
  const isAnd = (t?: JqlToken) => !!t && isKeyword(t, "AND");
  const isNot = (t?: JqlToken) => !!t && (isKeyword(t, "NOT") || (t.key === null && (t.raw === "-" || t.raw === "!")));
  const isClose = (t?: JqlToken) => !!t && t.key === null && t.raw === ")";
  const combine = (op: "and" | "or", args: (JqlExpr | null)[]): JqlExpr | null => {
    const kept = args.filter((a): a is JqlExpr => !!a);
    return kept.length === 0 ? null : kept.length === 1 ? kept[0]! : { op, args: kept };
  };

  const unsupported = (t: JqlToken): boolean => {
    if (t.key !== null || t.raw.startsWith('"')) return false;
    const r = t.raw;
    if (["=", "!=", "~", "!~", ">", "<", ">=", "<=", "in", "IN", "is", "IS", "was", "WAS", "changed", "CHANGED"].includes(r)) {
      errors.push({ token: r, message: `Jira's “${r}” operator isn't supported — write key:value, e.g. status:done, status:todo|done or points:>3` });
      return true;
    }
    const m = r.match(/^([a-z_.]+)(!=|=|~)(.*)$/i);
    if (m && KEY_ALIASES[m[1]!.toLowerCase()]) {
      errors.push({ token: r, message: `use “${m[1]}:${m[3]}” — key:value, not key${m[2]}value` });
      return true;
    }
    return false;
  };

  const parseUnary = (): JqlExpr | null => {
    const t = peek();
    if (!t) return null;
    if (isNot(t)) {
      pos++;
      const arg = parseUnary();
      if (!arg) {
        errors.push({ token: t.raw, message: "NOT needs a term after it, e.g. NOT status:done" });
        return null;
      }
      return { op: "not", arg };
    }
    if (t.key === null && t.raw === "(") {
      pos++;
      const inner = parseOr();
      if (isClose(peek())) pos++;
      else errors.push({ token: "(", message: "missing closing parenthesis )" });
      return inner;
    }
    pos++;
    if (t.key === null) {
      if (unsupported(t)) return null;
      const word = t.value.trim().toLowerCase();
      if (!word) return null;
      text.push(word);
      return { op: "text", word };
    }
    const term = parseTerm(t);
    if (!term) return null;
    terms.push(term);
    return { op: "term", term };
  };

  const parseAnd = (): JqlExpr | null => {
    const args: (JqlExpr | null)[] = [];
    for (;;) {
      const t = peek();
      if (!t || isOr(t) || isClose(t)) break;
      if (isAnd(t)) {
        pos++;
        const nxt = peek();
        if (!nxt || isOr(nxt) || isClose(nxt) || isAnd(nxt)) errors.push({ token: t.raw, message: "AND needs a term on both sides" });
        if (!args.length) errors.push({ token: t.raw, message: "AND needs a term on both sides" });
        continue;
      }
      args.push(parseUnary());
    }
    return combine("and", args);
  };

  const parseOr = (): JqlExpr | null => {
    const args: (JqlExpr | null)[] = [];
    const first = parseAnd();
    args.push(first);
    let sawOr = false;
    while (isOr(peek())) {
      const orTok = peek()!;
      pos++;
      sawOr = true;
      const right = parseAnd();
      if (!right) errors.push({ token: orTok.raw, message: "OR needs a term on both sides, e.g. status:todo OR status:done (or status:todo|done)" });
      args.push(right);
    }
    if (sawOr && !first) errors.push({ token: "OR", message: "OR needs a term on both sides, e.g. status:todo OR status:done (or status:todo|done)" });
    return combine("or", args);
  };

  const parts: (JqlExpr | null)[] = [];
  while (pos < tokens.length) {
    parts.push(parseOr());
    if (pos < tokens.length) {
      const t = tokens[pos]!;
      if (isClose(t)) errors.push({ token: ")", message: "unmatched closing parenthesis" });
      pos++;
    }
  }
  return { terms, text, errors, expr: combine("and", parts), orderBy };
}

/* ───────────── evaluation ───────────── */

/** Compiles a parsed query into a predicate. Invalid terms were dropped by the parser. */
export function compileJql(parsed: JqlParsed, ctx: JqlContext): (i: Issue) => boolean {
  const sprintById = new Map(ctx.sprints.map((s) => [s.id, s]));
  const today = wibDay(ctx.now ?? Date.now());
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
  const needsDeps = parsed.terms.some((t) => t.key === "is" || t.key === "blocks");
  const dep = needsDeps ? dependencyIndex(ctx.issueLinks ?? [], ctx.issues ?? []) : null;

  const dayOf = (iso: string | null | undefined) => (iso ? wibDay(Date.parse(iso)) : null);
  const overdue = (i: Issue) => !!i.dueDate && i.status !== "done" && dayOf(i.dueDate)! < today;

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
      case "due":
      case "created":
      case "updated": {
        if (t.kind === "overdue") return overdue(i);
        const d = dayOf(t.key === "due" ? i.dueDate : t.key === "created" ? i.createdAt : i.updatedAt);
        if (t.kind === "none") return !d;
        if (!d) return false;
        return (!t.from || d >= t.from) && (!t.to || d <= t.to);
      }
      case "is":
        return t.values.some((v) =>
          v === "blocked" ? (dep?.openBlockers.get(i.id)?.length ?? 0) > 0 && i.status !== "done" : v === "blocking" ? (dep?.blocking.get(i.id)?.length ?? 0) > 0 && i.status !== "done" : v === "overdue" ? overdue(i) : v === "triage" ? i.triage === "pending" : i.storyPoints == null && i.type !== "subtask",
        );
      case "blocks":
        return t.values.some((target) => dep?.blockersOf.get(target)?.includes(i.id) ?? false);
      case "triage":
        return t.values.some((v) => (v === "accepted" ? i.triage === "accepted" : i.triage === v));
    }
  };

  const evalExpr = (e: JqlExpr, i: Issue): boolean => {
    switch (e.op) {
      case "and":
        return e.args.every((a) => evalExpr(a, i));
      case "or":
        return e.args.some((a) => evalExpr(a, i));
      case "not":
        return !evalExpr(e.arg, i);
      case "text":
        return `${i.key} ${i.summary} ${i.labels.join(" ")}`.toLowerCase().includes(e.word);
      case "term": {
        const ok = test(e.term, i);
        return e.term.negate ? !ok : ok;
      }
    }
  };

  const expr = parsed.expr;
  return (i) => (expr ? evalExpr(expr, i) : true);
}

/** Comparator for the query's ORDER BY (null when the query has none). Empty values sort last. */
export function compareJql(parsed: JqlParsed, ctx: Pick<JqlContext, "users" | "projects">): ((a: Issue, b: Issue) => number) | null {
  if (!parsed.orderBy.length) return null;
  const name = new Map(ctx.users.map((u) => [u.id, u.name]));
  const pkey = new Map(ctx.projects.map((p) => [p.id, p.key]));
  const prio: Record<IssuePriority, number> = { highest: 5, high: 4, medium: 3, low: 2, lowest: 1 };
  const val = (i: Issue, f: JqlSortField): string | number | null => {
    switch (f) {
      case "key":
        return `${pkey.get(i.projectId) ?? ""}-${String(Number(i.key.split("-")[1]) || 0).padStart(6, "0")}`;
      case "priority":
        return prio[i.priority];
      case "status":
        return ISSUE_STATUSES.indexOf(i.status);
      case "due":
        return i.dueDate;
      case "created":
        return i.createdAt;
      case "updated":
        return i.updatedAt;
      case "points":
        return i.storyPoints;
      case "rank":
        return i.rank;
      case "assignee":
        return i.assigneeId ? (name.get(i.assigneeId) ?? null) : null;
      case "type":
        return i.type;
      case "summary":
        return i.summary.toLowerCase();
    }
  };
  return (a, b) => {
    for (const { field, dir } of parsed.orderBy) {
      const x = val(a, field);
      const y = val(b, field);
      if (x === y) continue;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : 1) * dir;
    }
    return 0;
  };
}

/** Blocks-links resolved per issue: who blocks it (open blockers only), whom it blocks. */
export function dependencyIndex(links: IssueLink[], issues: Issue[]) {
  const status = new Map(issues.map((i) => [i.id, i.status]));
  const blockersOf = new Map<string, string[]>();
  const openBlockers = new Map<string, string[]>();
  const blocking = new Map<string, string[]>();
  links.forEach((l) => {
    if (l.type !== "blocks" || !status.has(l.fromIssueId) || !status.has(l.toIssueId)) return;
    blockersOf.set(l.toIssueId, [...(blockersOf.get(l.toIssueId) ?? []), l.fromIssueId]);
    if (status.get(l.fromIssueId) !== "done") {
      openBlockers.set(l.toIssueId, [...(openBlockers.get(l.toIssueId) ?? []), l.fromIssueId]);
      blocking.set(l.fromIssueId, [...(blocking.get(l.fromIssueId) ?? []), l.toIssueId]);
    }
  });
  return { blockersOf, openBlockers, blocking };
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
    case "due":
      return [
        { value: "overdue", hint: "past due and not done" },
        { value: "today" },
        { value: "thisweek", hint: "Mon–Sun, WIB" },
        { value: "<7d", hint: "due within a week (incl. overdue)" },
        { value: "<=endOfMonth()", hint: "due by the end of this month" },
        { value: "none", hint: "no due date" },
      ];
    case "created":
      return [{ value: ">-7d", hint: "last 7 days" }, { value: ">-14d", hint: "last 14 days" }, { value: "thisweek" }, { value: "thismonth" }];
    case "updated":
      return [{ value: "<-30d", hint: "not touched for a month" }, { value: "<-14d" }, { value: "today" }, { value: ">-7d" }];
    case "is":
      return [{ value: "blocked", hint: "an open issue blocks it" }, { value: "blocking", hint: "it blocks open work" }, { value: "overdue" }, { value: "triage", hint: "waiting in the triage inbox" }, { value: "unestimated", hint: "no story points" }];
    case "blocks":
      return (ctx.issues ?? issues)
        .filter((i) => i.status !== "done")
        .slice(0, 40)
        .map((i) => ({ value: i.key, hint: i.summary }));
    case "triage":
      return TRIAGE_VALUES.map((v) => ({ value: v }));
    case "deal.stage":
      return Array.from(new Map(ctx.pipelines.filter((p) => p.objectType === "deal").flatMap((p) => p.stages.map((s) => [norm(s.name), s.name] as const))).entries()).map(([v, name]) => ({ value: v, hint: name }));
    case "lead_score":
      return [{ value: ">75" }, { value: ">=60" }, { value: "<40" }];
  }
}

const KEYWORDS: { label: string; hint: string }[] = [
  { label: "OR", hint: "either side matches" },
  { label: "AND", hint: "both sides match (the default between terms)" },
  { label: "NOT", hint: "negate the next term or group" },
  { label: "ORDER BY", hint: "sort, e.g. ORDER BY due ASC, priority DESC" },
];

/** Suggestions for the token under the caret. */
export function suggestJql(q: string, caret: number, ctx: JqlContext, issues: Issue[]): { suggestions: JqlSuggestion[]; start: number; end: number } {
  const tokens = tokenize(q);
  const tok = tokens.find((t) => caret >= t.start && caret <= t.end && t.raw !== "(" && t.raw !== ")");
  const start = tok?.start ?? caret;
  const end = tok?.end ?? caret;
  const raw = tok?.raw ?? "";

  // after ORDER BY: sort fields and directions
  const byIdx = tokens.findIndex((t, k) => isKeyword(t, "BY") && k > 0 && isKeyword(tokens[k - 1]!, "ORDER"));
  if (byIdx >= 0 && start > tokens[byIdx]!.start) {
    const prefix = raw.replace(/,/g, "").toLowerCase();
    const prev = tokens.filter((t) => t.end <= start).pop();
    const afterField = prev && !isKeyword(prev, "BY") && !prev.raw.endsWith(",") && JQL_SORT_FIELDS.includes(prev.raw.toLowerCase() as JqlSortField);
    const pool = afterField ? [{ label: "ASC", hint: "ascending" }, { label: "DESC", hint: "descending" }] : JQL_SORT_FIELDS.map((f) => ({ label: f, hint: "sort field" }));
    const suggestions = pool.filter((p) => p.label.toLowerCase().startsWith(prefix) && p.label.toLowerCase() !== prefix).map((p) => ({ label: p.label, hint: p.hint, insert: `${p.label} ` }));
    return { suggestions, start, end };
  }

  const neg = raw.startsWith("-") || raw.startsWith("!") ? raw[0]! : "";
  const body = neg ? raw.slice(1) : raw;
  const colon = body.indexOf(":");
  if (colon < 0) {
    const prefix = body.toLowerCase();
    const keys = JQL_KEYS.filter((k) => k.key.startsWith(prefix) || (prefix.length > 1 && k.key.includes(prefix))).map((k) => ({ label: `${k.key}:`, hint: k.hint, insert: `${neg}${k.key}:` }));
    const kws = prefix && !neg && tokens.length > 1 ? KEYWORDS.filter((k) => k.label.toLowerCase().startsWith(prefix) && k.label.toLowerCase() !== prefix).map((k) => ({ label: k.label, hint: k.hint, insert: `${k.label} ` })) : [];
    const suggestions = [...keys, ...kws];
    return { suggestions: prefix && suggestions.length === 1 && suggestions[0]!.label === `${prefix}:` ? [] : suggestions, start, end };
  }
  const key = KEY_ALIASES[body.slice(0, colon).toLowerCase()];
  if (!key) return { suggestions: [], start, end };
  const valuePart = body.slice(colon + 1);
  const pipe = valuePart.lastIndexOf("|");
  const before = pipe >= 0 ? valuePart.slice(0, pipe + 1) : "";
  const current = (pipe >= 0 ? valuePart.slice(pipe + 1) : valuePart).replace(/"/g, "").toLowerCase();
  const numeric = key === "points" || key === "lead_score" || key === "due" || key === "created" || key === "updated";
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
