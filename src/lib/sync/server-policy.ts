/**
 * Server-side data-protection rules for the shared workspace snapshot (Policy v4.0 §13.4, UU PDP 27/2022).
 *
 * Pure functions (no I/O, no React, no store) so the API routes can use them and scripts can test them.
 *
 *  - resolveViewer(): who is asking — verified Access email → workspace user → HR record → governance roles.
 *  - redactForViewer(): what that viewer may receive. Individual pay and status data goes in full only to holders of a
 *    pay role (Finance, HR, the PRC, CEO, CFO, ExCo — same list as src/lib/access-control.ts); everyone else gets
 *    their OWN lines and a neutral HR record for colleagues (no salary, no disciplinary detail).
 *  - mergeWrite(): what a write may change. Restricted collections are read-only for non-privileged writers (the server
 *    keeps its stored copy), governance roles and login emails are admin-only, rows in `users`/`employeeProfiles`
 *    cannot be deleted by non-admins, and `auditLog` is append-only for everyone.
 *  - diffCollections() / bulkDeleteViolation(): per-collection change summary for the audit trail and the
 *    mass-deletion guard.
 */

export const PAY_ROLES = ["finance", "hr", "prc", "cfo", "ceo", "executive_committee"] as const;
export const ADMIN_ROLES = ["ceo", "cfo"] as const;
/** may change login emails and user rows (HR administers people) */
const PEOPLE_ROLES = ["hr", "ceo", "cfo"] as const;

export type DataScope = "full" | "own";
export type ViewerSource = "access" | "development" | "anonymous-allowed";

export interface Viewer {
  source: ViewerSource;
  /** verified Cloudflare Access email (null in development / anonymous demo) */
  email: string | null;
  /** workspace user matched to the email (development: the "acting as" user, informational) */
  userId: string | null;
  roles: string[];
  scope: DataScope;
  /** workspace admin: restore/reset, audit trail, version history, D1 seeding */
  admin: boolean;
  /** may change user emails / user rows */
  people: boolean;
  /** listed in the WORKSPACE_ADMINS env var (break-glass, works without a user record) */
  breakGlass: boolean;
}

export interface PolicyEnv {
  /** comma-separated emails that are always workspace admins with full data access */
  WORKSPACE_ADMINS?: string;
  /** demo only, with ALLOW_ANONYMOUS_WORKSPACE: anonymous browsers also receive and write pay data (fictional seed) */
  ALLOW_ANONYMOUS_PAY_DATA?: string;
}

type Row = Record<string, unknown>;
export type WorkspaceData = Record<string, unknown>;

const isRow = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const rowsOf = (data: WorkspaceData | null | undefined, key: string): Row[] => {
  const v = data?.[key];
  return Array.isArray(v) ? (v.filter(isRow) as Row[]) : [];
};
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const lower = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");

export function adminEmails(env: PolicyEnv): string[] {
  return (env.WORKSPACE_ADMINS ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Roles held on the HR record of `userId` in a snapshot. */
export function rolesInSnapshot(data: WorkspaceData | null, userId: string | null): string[] {
  if (!userId) return [];
  const p = rowsOf(data, "employeeProfiles").find((r) => r.userId === userId);
  return Array.isArray(p?.governanceRoles) ? (p.governanceRoles as unknown[]).filter((r): r is string => typeof r === "string") : [];
}

export function userIdForEmail(data: WorkspaceData | null, email: string | null): string | null {
  if (!email) return null;
  const e = email.toLowerCase();
  return str(rowsOf(data, "users").find((u) => lower(u.email) === e)?.id);
}

/** Work out the viewer of a request from the verified identity and the stored snapshot. */
export function resolveViewer(input: { source: ViewerSource; email: string | null; actingAs?: string | null }, data: WorkspaceData | null, env: PolicyEnv): Viewer {
  if (input.source === "development") {
    // local dev / CI: demo identities, full data (nothing here is real)
    const userId = userIdForEmail(data, input.actingAs ?? null);
    return { source: "development", email: null, userId, roles: rolesInSnapshot(data, userId), scope: "full", admin: true, people: true, breakGlass: false };
  }
  if (input.source === "anonymous-allowed") {
    const full = env.ALLOW_ANONYMOUS_PAY_DATA === "1";
    return { source: "anonymous-allowed", email: null, userId: null, roles: [], scope: full ? "full" : "own", admin: full, people: full, breakGlass: false };
  }
  const email = input.email?.toLowerCase() ?? null;
  const userId = userIdForEmail(data, email);
  const roles = rolesInSnapshot(data, userId);
  const breakGlass = !!email && adminEmails(env).includes(email);
  const admin = breakGlass || roles.some((r) => (ADMIN_ROLES as readonly string[]).includes(r));
  const pay = breakGlass || roles.some((r) => (PAY_ROLES as readonly string[]).includes(r));
  const people = admin || roles.some((r) => (PEOPLE_ROLES as readonly string[]).includes(r));
  return { source: "access", email, userId, roles, scope: pay ? "full" : "own", admin, people, breakGlass };
}

/* ───────────── classification ───────────── */

/** Collections of individual pay rows: the field naming whose row it is. */
export const OWNED_PAY_COLLECTIONS: Record<string, string> = {
  deferredBonuses: "userId",
  probationOutcomes: "userId",
  clawbacks: "userId",
};
/** Specially handled restricted collections. */
const SPECIAL = new Set(["employeeProfiles", "bonusRuns", "auditLog", "disputes"]);
/** Readable by everyone, but only pay roles (full scope) may change them — cycle workflow and company figures. */
export const PRIVILEGED_WRITE = new Set<string>(["releaseApprovals", "exceptionReviews", "cycleNotes", "companySummaries", "companyTurnover", "taxRegimeChanges", "curveAdjustments"]);
/** Readable by everyone; a non-privileged writer may only add, change or remove rows whose owner field is themselves. */
export const OWN_ROW_WRITE: Record<string, string> = { ledgerConfirmations: "confirmedById", agreementSignatures: "userId" };
/** Rows are never changed or removed once stored — for every writer (union by id, stored copy wins). */
export const APPEND_ONLY = new Set<string>(["auditLog", "agreementSignatures"]);
/** §14 dispute fields only Finance / PRC / ExCo (full scope) may set. */
const DISPUTE_DECISION_FIELDS = ["prcDecision", "excoDecision", "votes", "correction"] as const;
/**
 * Collections other workstreams add later are restricted automatically when their name says they hold pay data
 * (payroll, payslip, salary, bonus, clawback, deferral, probation, statement, PPh, withholding, payout, compensation).
 */
const PAY_NAME_RE = /(payroll|payslip|salary|salaries|bonus|clawback|deferr|probation|statement|pph|withhold|payout|compensation|taxestimate)/i;
/** Collections that match the pattern but hold no individual pay data. */
const NOT_PAY = new Set<string>(["curveAdjustments"]);
/** Restricted collections whose OWN rows a non-privileged writer may add or change (e.g. acknowledging a statement). */
export const SELF_WRITABLE = new Set<string>([]);

export function isRestrictedKey(key: string): boolean {
  if (SPECIAL.has(key) || key in OWNED_PAY_COLLECTIONS) return true;
  return !NOT_PAY.has(key) && PAY_NAME_RE.test(key);
}

/** Restricted collection keys present in a snapshot. */
export function restrictedKeys(data: WorkspaceData | null): string[] {
  return Object.keys(data ?? {}).filter((k) => k !== "__schema" && isRestrictedKey(k));
}

const OWNER_FIELDS = ["userId", "employeeId", "personId", "memberId"];
function ownerField(key: string, rows: Row[]): string | null {
  if (OWNED_PAY_COLLECTIONS[key]) return OWNED_PAY_COLLECTIONS[key];
  for (const f of OWNER_FIELDS) if (rows.some((r) => typeof r[f] === "string")) return f;
  return null;
}

/* ───────────── redaction (GET) ───────────── */

/** HR fields a colleague may see (eligibility needs them); everything else is removed or neutralised. */
const PROFILE_PUBLIC_FIELDS = [
  "userId",
  "employmentType",
  "hireDate",
  "probationEndDate",
  "contractedHoursPct",
  "contractEndDate",
  "directManagerId",
  "resignationNoticeAt",
  "terminationNoticeAt",
  "acknowledgmentSignedAt",
  "governanceRoles",
];
/** §3.2 unpaid-leave threshold (POLICY.unpaidLeaveMaxDays) */
const UNPAID_LEAVE_MAX_DAYS = 30;

export function redactProfile(p: Row): Row {
  const flagged =
    p.activeWrittenWarning === true ||
    (p.onPIP === true && p.pipApprovedByPRC !== true) ||
    p.underInvestigation === true ||
    p.suspended === true ||
    (typeof p.unpaidLeaveDays === "number" && p.unpaidLeaveDays > UNPAID_LEAVE_MAX_DAYS);
  const out: Row = {};
  for (const f of PROFILE_PUBLIC_FIELDS) if (f in p) out[f] = p[f];
  const sep = isRow(p.separation) ? p.separation : null;
  return {
    ...out,
    annualBaseSalary: 0,
    // eligibility still blocks (§3.1–3.2) without saying why
    goodStanding: p.goodStanding !== false && !flagged,
    activeWrittenWarning: false,
    onPIP: false,
    pipApprovedByPRC: false,
    underInvestigation: false,
    suspended: false,
    unpaidLeaveDays: 0,
    // that someone left (and when) matters for teams; the kind of separation (e.g. for cause) is personal
    separation: sep ? { kind: "ineligible_status", effectiveAt: sep.effectiveAt ?? null, recordedAt: sep.recordedAt ?? null } : null,
    redacted: true,
  };
}

const SENSITIVE_AUDIT = new Set(["employee", "deferred", "probation", "clawback"]);

/** The person who raised a dispute, its handler and the people involved may see it (§14). */
function disputeParty(d: Row, userId: string): boolean {
  return d.raisedById === userId || d.handlerId === userId || (Array.isArray(d.involvedIds) && d.involvedIds.includes(userId));
}

/**
 * Non-privileged write to `disputes`: rows the writer is not party to stay as stored; new rows must be raised by the
 * writer; decisions, votes and corrections stay as stored; the outcome may only become "withdrawn" or the outcome of
 * the stored direct-resolution proposal (accepting it).
 */
function mergeDisputes(stored: Row[], incoming: Row[], userId: string | null): Row[] {
  const storedMap = byKey(stored);
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const r of incoming) {
    const k = rowKey(r);
    if (!k || seen.has(k)) continue;
    const before = storedMap.get(k);
    if (!userId) continue;
    if (!before) {
      if (r.raisedById !== userId) continue;
      const fresh: Row = { ...r, prcDecision: null, excoDecision: null, votes: [], correction: null };
      if (fresh.outcome !== null && fresh.outcome !== undefined && fresh.outcome !== "withdrawn") fresh.outcome = null;
      out.push(fresh);
      seen.add(k);
      continue;
    }
    seen.add(k);
    if (!disputeParty(before, userId)) {
      out.push(before);
      continue;
    }
    const next: Row = { ...r };
    for (const f of DISPUTE_DECISION_FIELDS) next[f] = before[f];
    next.raisedById = before.raisedById;
    const proposed = isRow(before.proposal) ? before.proposal.outcome : undefined;
    if (next.outcome !== before.outcome && next.outcome !== "withdrawn" && next.outcome !== proposed) next.outcome = before.outcome;
    out.push(next);
  }
  // rows the writer can't see (or tried to delete) are kept
  for (const r of stored) {
    const k = rowKey(r);
    if (k && !seen.has(k)) out.push(r);
  }
  return out;
}

/** Copy of `data` the viewer may receive. Full scope → unchanged. */
export function redactForViewer(data: WorkspaceData, viewer: Viewer): WorkspaceData {
  if (viewer.scope === "full") return data;
  const me = viewer.userId;
  const out: WorkspaceData = { ...data };
  for (const key of restrictedKeys(data)) {
    const rows = rowsOf(data, key);
    if (key === "employeeProfiles") out[key] = rows.map((p) => (me && p.userId === me ? p : redactProfile(p)));
    else if (key === "bonusRuns")
      out[key] = rows.map((run) => ({ ...run, lines: me && Array.isArray(run.lines) ? (run.lines as unknown[]).filter((l) => isRow(l) && l.userId === me) : [], redacted: true }));
    else if (key === "auditLog") out[key] = rows.filter((e) => !SENSITIVE_AUDIT.has(String(e.entity)) || (!!me && (e.entityId === me || e.actorId === me)));
    else if (key === "disputes") out[key] = me ? rows.filter((d) => disputeParty(d, me)) : [];
    else {
      const f = ownerField(key, rows);
      out[key] = me && f ? rows.filter((r) => r[f] === me) : [];
    }
  }
  return out;
}

/* ───────────── merge (PUT) ───────────── */

/** HR-record fields only HR / Finance / PRC may change. */
const PROTECTED_PROFILE_FIELDS = new Set([
  "userId",
  "employmentType",
  "hireDate",
  "probationEndDate",
  "annualBaseSalary",
  "contractedHoursPct",
  "contractEndDate",
  "directManagerId",
  "goodStanding",
  "activeWrittenWarning",
  "onPIP",
  "pipApprovedByPRC",
  "underInvestigation",
  "suspended",
  "unpaidLeaveDays",
  "resignationNoticeAt",
  "terminationNoticeAt",
  "separation",
  "governanceRoles",
  "redacted",
]);

const rowKey = (r: Row): string | null => str(r.id) ?? str(r.userId);

function byKey(rows: Row[]): Map<string, Row> {
  const m = new Map<string, Row>();
  for (const r of rows) {
    const k = rowKey(r);
    if (k && !m.has(k)) m.set(k, r);
  }
  return m;
}

/** Stored entries are immutable; new ids are appended. Entries the writer doesn't have are kept (at the end — oldest). */
export function unionAppendOnly(stored: Row[], incoming: Row[]): Row[] {
  const storedMap = byKey(stored);
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const r of incoming) {
    const k = rowKey(r);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(storedMap.get(k) ?? r);
  }
  for (const r of stored) {
    const k = rowKey(r);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}

export interface MergeResult {
  data: WorkspaceData;
  /** collections (or "collection.field") where the server kept its stored copy over the writer's */
  protectedKeys: string[];
}

/**
 * What a write may change. `stored` is the current server snapshot (null when creating).
 * Rules apply to every writer unless noted:
 *  - auditLog: append-only (union by id, stored entries win);
 *  - rows marked `redacted` (a stale redacted copy) never replace stored rows;
 *  - governanceRoles change only for admins; user emails / user rows only for people admins (HR, CEO, CFO);
 *  - scope "own": restricted collections are read-only (stored copy kept), except self-service fields on one's own
 *    HR row and own rows of SELF_WRITABLE collections; HR rows can't be added or removed.
 */
export function mergeWrite(stored: WorkspaceData | null, incoming: WorkspaceData, viewer: Viewer): MergeResult {
  const out: WorkspaceData = { ...incoming };
  const kept = new Set<string>();
  if (!stored) return { data: out, protectedKeys: [] };

  // append-only collections (audit log, signatures): stored rows are immutable for everyone
  for (const key of APPEND_ONLY) {
    if (!Array.isArray(stored[key]) && !Array.isArray(incoming[key])) continue;
    const merged = unionAppendOnly(rowsOf(stored, key), rowsOf(incoming, key));
    if (JSON.stringify(merged) !== JSON.stringify(incoming[key] ?? [])) kept.add(key);
    out[key] = merged;
  }

  if (viewer.scope !== "full") {
    // workflow collections only pay roles may change
    for (const key of PRIVILEGED_WRITE) {
      if (!(key in stored) && !(key in incoming)) continue;
      if (Array.isArray(stored[key])) out[key] = stored[key];
      else delete out[key];
      if (JSON.stringify(out[key] ?? null) !== JSON.stringify(incoming[key] ?? null)) kept.add(key);
    }
    // own rows only
    for (const [key, field] of Object.entries(OWN_ROW_WRITE)) {
      if (!Array.isArray(out[key]) && !Array.isArray(stored[key])) continue;
      const mine = viewer.userId ? rowsOf(out, key).filter((r) => r[field] === viewer.userId) : [];
      const others = rowsOf(stored, key).filter((r) => !viewer.userId || r[field] !== viewer.userId);
      // keep stored order for others, own rows first (newest-first lists)
      const next = [...mine, ...others];
      if (JSON.stringify(next) !== JSON.stringify(out[key] ?? [])) kept.add(key);
      out[key] = APPEND_ONLY.has(key) ? unionAppendOnly(rowsOf(stored, key), next) : next;
    }
  }

  const storedProfiles = byKey(rowsOf(stored, "employeeProfiles"));

  if (viewer.scope === "full") {
    // a stale redacted copy (scope changed) must never overwrite real data
    for (const key of ["employeeProfiles", "bonusRuns"]) {
      if (!Array.isArray(incoming[key])) continue;
      const storedMap = byKey(rowsOf(stored, key));
      let changed = false;
      out[key] = rowsOf(incoming, key).map((r) => {
        const k = rowKey(r);
        if (r.redacted === true && k && storedMap.has(k)) {
          changed = true;
          return storedMap.get(k) as Row;
        }
        return r;
      });
      if (changed) kept.add(`${key} (redacted rows)`);
    }
  } else {
    for (const key of new Set([...restrictedKeys(stored), ...restrictedKeys(incoming)])) {
      if (key === "auditLog") continue;
      if (key === "disputes") {
        out[key] = mergeDisputes(rowsOf(stored, key), rowsOf(incoming, key), viewer.userId);
        if (JSON.stringify(out[key]) !== JSON.stringify(incoming[key] ?? [])) kept.add(key);
        continue;
      }
      if (key === "employeeProfiles") {
        const own = viewer.userId ? rowsOf(incoming, key).find((p) => p.userId === viewer.userId) : undefined;
        out[key] = rowsOf(stored, key).map((p) => {
          if (!own || p.userId !== viewer.userId) return p;
          const next: Row = { ...p };
          for (const [f, v] of Object.entries(own)) if (!PROTECTED_PROFILE_FIELDS.has(f)) next[f] = v;
          return next;
        });
        if (JSON.stringify(out[key]) !== JSON.stringify(incoming[key] ?? [])) kept.add(key);
        continue;
      }
      if (SELF_WRITABLE.has(key) && viewer.userId) {
        const storedRows = rowsOf(stored, key);
        const f = ownerField(key, [...storedRows, ...rowsOf(incoming, key)]);
        if (f) {
          const others = storedRows.filter((r) => r[f] !== viewer.userId);
          out[key] = [...rowsOf(incoming, key).filter((r) => r[f] === viewer.userId), ...others];
          if (JSON.stringify(out[key]) !== JSON.stringify(incoming[key] ?? [])) kept.add(key);
          continue;
        }
      }
      if (Array.isArray(stored[key])) out[key] = stored[key];
      else delete out[key];
      if (JSON.stringify(out[key] ?? null) !== JSON.stringify(incoming[key] ?? null)) kept.add(key);
    }
  }

  // governance roles: admins only (otherwise anyone could make themselves PRC/CEO)
  if (!viewer.admin && Array.isArray(out.employeeProfiles)) {
    let changed = false;
    out.employeeProfiles = rowsOf(out, "employeeProfiles").map((p) => {
      const before = p.userId && typeof p.userId === "string" ? storedProfiles.get(p.userId) : undefined;
      const roles = before ? before.governanceRoles ?? [] : [];
      if (JSON.stringify(p.governanceRoles ?? []) === JSON.stringify(roles)) return p;
      changed = true;
      return { ...p, governanceRoles: roles };
    });
    if (changed) kept.add("employeeProfiles.governanceRoles");
  }
  // HR records cannot be deleted by non-admins
  if (!viewer.admin && Array.isArray(out.employeeProfiles)) {
    const present = new Set(rowsOf(out, "employeeProfiles").map((p) => p.userId));
    const missing = [...storedProfiles.values()].filter((p) => !present.has(p.userId));
    if (missing.length) {
      out.employeeProfiles = [...rowsOf(out, "employeeProfiles"), ...missing];
      kept.add("employeeProfiles (deleted rows)");
    }
  }

  // login emails decide who is who: only HR/CEO/CFO may change them or remove users
  if (!viewer.people && Array.isArray(out.users)) {
    const storedUsers = rowsOf(stored, "users");
    const storedById = byKey(storedUsers);
    const taken = new Set(storedUsers.map((u) => lower(u.email)).filter(Boolean));
    let changed = false;
    const next = rowsOf(out, "users").map((u) => {
      const before = typeof u.id === "string" ? storedById.get(u.id) : undefined;
      if (before) {
        if (lower(u.email) === lower(before.email)) return u;
        changed = true;
        return { ...u, email: before.email };
      }
      const e = lower(u.email);
      if (!e || !taken.has(e)) {
        if (e) taken.add(e);
        return u;
      }
      changed = true;
      return { ...u, email: "" };
    });
    const present = new Set(next.map((u) => u.id));
    const missing = storedUsers.filter((u) => !present.has(u.id));
    if (missing.length) changed = true;
    out.users = [...next, ...missing];
    if (changed) kept.add("users.email");
  }

  return { data: out, protectedKeys: [...kept] };
}

/* ───────────── diff + guards ───────────── */

export interface CollectionChange {
  key: string;
  added: number;
  removed: number;
  updated: number;
  /** rows after the write */
  count: number;
}

/** Per-collection change summary between two snapshots (rows keyed by id / userId, else compared by position). */
export function diffCollections(before: WorkspaceData | null, after: WorkspaceData): CollectionChange[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  keys.delete("__schema");
  const out: CollectionChange[] = [];
  for (const key of [...keys].sort()) {
    const a = Array.isArray(before?.[key]) ? (before?.[key] as unknown[]) : [];
    const b = Array.isArray(after[key]) ? (after[key] as unknown[]) : [];
    let added = 0;
    let removed = 0;
    let updated = 0;
    const keyed = [...a, ...b].every((r) => isRow(r) && rowKey(r) !== null);
    if (keyed) {
      const am = byKey(a as Row[]);
      const bm = byKey(b as Row[]);
      for (const [k, r] of bm) {
        const prev = am.get(k);
        if (!prev) added++;
        else if (JSON.stringify(prev) !== JSON.stringify(r)) updated++;
      }
      for (const k of am.keys()) if (!bm.has(k)) removed++;
    } else {
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) updated++;
      added = Math.max(0, b.length - a.length);
      removed = Math.max(0, a.length - b.length);
    }
    if (added || removed || updated) out.push({ key, added, removed, updated, count: b.length });
  }
  return out;
}

export const BULK_DELETE = { maxTotal: 200, minRows: 20, maxShare: 0.5 } as const;

/** Non-admin writes may not wipe large parts of the workspace (a reset, a bad restore, a script). */
export function bulkDeleteViolation(before: WorkspaceData | null, changes: CollectionChange[], viewer: Viewer): string | null {
  if (viewer.admin || !before) return null;
  const total = changes.reduce((n, c) => n + c.removed, 0);
  if (total > BULK_DELETE.maxTotal) return `This write would delete ${total} records (limit ${BULK_DELETE.maxTotal} for non-admins).`;
  for (const c of changes) {
    const had = Array.isArray(before[c.key]) ? (before[c.key] as unknown[]).length : 0;
    if (had >= BULK_DELETE.minRows && c.removed / had > BULK_DELETE.maxShare) return `This write would delete ${c.removed} of ${had} ${c.key} (more than half) — only a workspace admin can do that.`;
  }
  return null;
}

/* ───────────── input validation ───────────── */

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const LIMITS = { maxCollections: 200, maxRowsPerCollection: 50_000, maxDepth: 24 } as const;

function depthOk(v: unknown, depth: number): boolean {
  if (depth > LIMITS.maxDepth) return false;
  if (Array.isArray(v)) return v.every((x) => depthOk(x, depth + 1));
  if (v && typeof v === "object") return Object.values(v as Row).every((x) => depthOk(x, depth + 1));
  return true;
}

/** null when `data` is an acceptable snapshot, else the reason. */
export function validateSnapshot(data: unknown): string | null {
  if (!isRow(data)) return "data must be an object of collection arrays";
  const keys = Object.keys(data);
  if (keys.length > LIMITS.maxCollections) return `too many collections (${keys.length} > ${LIMITS.maxCollections})`;
  for (const k of keys) {
    const v = data[k];
    if (k === "__schema") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return "__schema must be a non-negative integer";
      continue;
    }
    if (!KEY_RE.test(k)) return `invalid collection name ${JSON.stringify(k.slice(0, 80))}`;
    if (!Array.isArray(v)) return `${k} must be an array`;
    if (v.length > LIMITS.maxRowsPerCollection) return `${k} has too many records (${v.length})`;
    if (!v.every(isRow)) return `${k} must contain only objects`;
  }
  if (!depthOk(data, 0)) return `data is nested deeper than ${LIMITS.maxDepth} levels`;
  return null;
}
