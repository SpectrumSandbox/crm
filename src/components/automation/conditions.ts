/* Workflow condition strings: `field op value` clauses joined by AND, groups joined by OR.
 * Examples (all from the seed): "stage = Closed Won", "status = Done AND link = escalated_from ticket", "linkType = blocks AND crm = deal".
 * Comparison is case-insensitive and treats "_", "-" and spaces alike, so "in_progress" matches "In progress". */
import { OPERATORS, type Operator } from "./catalog";

export interface Clause {
  field: string;
  op: Operator;
  value: string;
}

export type ContextValue = string | number | boolean | string[] | null | undefined;
export type RecordFields = Record<string, ContextValue>;

const CLAUSE_RE = /^\s*([A-Za-z_][\w.]*)\s*(!=|>=|<=|=|>|<|\bcontains\b)\s*(.*?)\s*$/i;

/** OR-groups of AND-clauses. Unparseable fragments are returned in `errors`. */
export function parseCondition(condition: string): { groups: Clause[][]; errors: string[] } {
  const text = condition.trim();
  if (!text) return { groups: [], errors: [] };
  const errors: string[] = [];
  const groups = text
    .split(/\s+OR\s+/i)
    .map((g) =>
      g
        .split(/\s+AND\s+/i)
        .map((c) => {
          const m = CLAUSE_RE.exec(c);
          if (!m) {
            errors.push(c.trim());
            return null;
          }
          const op = m[2].toLowerCase() as Operator;
          return { field: m[1].toLowerCase(), op: (OPERATORS as readonly string[]).includes(op) ? op : "=", value: m[3].replace(/^["']|["']$/g, "") } satisfies Clause;
        })
        .filter((c): c is Clause => !!c),
    )
    .filter((g) => g.length);
  return { groups, errors };
}

export function serializeCondition(groups: Clause[][]) {
  return groups
    .map((g) => g.filter((c) => c.field && c.value.trim() !== "").map((c) => `${c.field} ${c.op} ${c.value.trim()}`).join(" AND "))
    .filter(Boolean)
    .join(" OR ");
}

const norm = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/[_\-\s]+/g, " ")
    .trim();

function toNumber(v: unknown) {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : NaN;
}

function compareOne(actual: ContextValue, op: Operator, expected: string): boolean {
  if (op === ">" || op === ">=" || op === "<" || op === "<=") {
    const a = toNumber(actual);
    const b = toNumber(expected);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return op === ">" ? a > b : op === ">=" ? a >= b : op === "<" ? a < b : a <= b;
  }
  if (typeof actual === "boolean") {
    const e = norm(expected);
    const eb = e === "true" || e === "yes" || e === "1";
    return op === "!=" ? actual !== eb : op === "contains" ? false : actual === eb;
  }
  if (typeof actual === "number" && op !== "contains") {
    const b = toNumber(expected);
    return op === "!=" ? actual !== b : actual === b;
  }
  const a = norm(actual);
  const e = norm(expected);
  if (op === "contains") return a.includes(e);
  return op === "!=" ? a !== e : a === e;
}

export interface ClauseResult extends Clause {
  pass: boolean;
  actual: string;
  known: boolean;
}

function evaluateClause(fields: RecordFields, c: Clause): ClauseResult {
  const key = c.field.toLowerCase();
  const known = Object.prototype.hasOwnProperty.call(fields, key);
  const actual = fields[key];
  let pass: boolean;
  if (!known) pass = false;
  else if (Array.isArray(actual)) {
    pass = c.op === "!=" ? actual.every((x) => compareOne(x, "=", c.value) === false) : actual.some((x) => compareOne(x, c.op, c.value));
  } else pass = compareOne(actual, c.op, c.value);
  const shown = Array.isArray(actual) ? (actual.length ? actual.join(", ") : "none") : actual === null || actual === undefined || actual === "" ? "empty" : String(actual);
  return { ...c, pass, actual: known ? shown : "unknown field", known };
}

/** Evaluate; an empty condition always passes. Returns the per-clause trace for the test panel. */
export function evaluateCondition(condition: string, fields: RecordFields): { pass: boolean; groups: ClauseResult[][]; errors: string[] } {
  const { groups, errors } = parseCondition(condition);
  if (!groups.length) return { pass: errors.length === 0, groups: [], errors };
  const results = groups.map((g) => g.map((c) => evaluateClause(fields, c)));
  return { pass: errors.length === 0 && results.some((g) => g.every((c) => c.pass)), groups: results, errors };
}
