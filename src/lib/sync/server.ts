/**
 * Helpers shared by the API route handlers (server only — never import from client components).
 * Identity (Cloudflare Access JWT) lives in ./access, data-protection rules in ./server-policy.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ACTING_AS_HEADER, actorLabel, identify, type AccessConfig, type Identity } from "./access";
import { resolveViewer, type CollectionChange, type PolicyEnv, type Viewer, type WorkspaceData } from "./server-policy";

/** Single shared workspace for now; the column exists so more can be added later. */
export const WORKSPACE_ID = "default";
export const WRITE_REASON_HEADER = "x-sg-write-reason";
export const WRITE_REASONS = ["edit", "bootstrap", "upgrade", "overwrite", "restore", "reset", "merge", "rollback"] as const;
export type WriteReason = (typeof WRITE_REASONS)[number];

export type ServerEnv = CloudflareEnv & AccessConfig & PolicyEnv & { SEED_TOKEN?: string };

export const noStore = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...noStore, ...headers } });
}

export async function serverEnv(): Promise<ServerEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env as unknown as ServerEnv;
}

/** Map D1/runtime errors to helpful HTTP responses. */
export function failure(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (/no such table/i.test(message)) {
    return json({ error: message, hint: "Apply the D1 migrations (npm run db:migrate:remote, or db:migrate:local for next dev)." }, 503);
  }
  if (/too (big|large)|SQLITE_TOOBIG/i.test(message)) {
    return json({ error: "Workspace snapshot is too large for a single D1 row (~2 MB).", detail: message }, 507);
  }
  return json({ error: message }, 503);
}

export interface SnapshotRow {
  version: number;
  data: string;
  updated_at: string;
  updated_by: string;
}

export async function readRow(db: SgD1Database): Promise<SnapshotRow | null> {
  return db.prepare("SELECT version, data, updated_at, updated_by FROM workspace_snapshots WHERE id = ?").bind(WORKSPACE_ID).first<SnapshotRow>();
}

export function parseData(row: SnapshotRow | null): WorkspaceData | null {
  if (!row?.data) return null;
  try {
    const v = JSON.parse(row.data) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as WorkspaceData) : null;
  } catch {
    return null;
  }
}

/** Identity → viewer, using the users/HR records of the stored snapshot. */
export function viewerOf(request: Request, who: Extract<Identity, { ok: true }>, data: WorkspaceData | null, env: PolicyEnv): Viewer {
  return resolveViewer({ source: who.source, email: who.email, actingAs: request.headers.get(ACTING_AS_HEADER) }, data, env);
}

/** What the client is told about its access (sent with snapshots and /api/me). */
export function accessInfo(viewer: Viewer, restricted: string[]) {
  return {
    source: viewer.source,
    email: viewer.email,
    userId: viewer.userId,
    roles: viewer.roles,
    scope: viewer.scope,
    admin: viewer.admin,
    breakGlass: viewer.breakGlass,
    /** collections the server redacted for this viewer (empty for full scope) */
    restricted: viewer.scope === "full" ? [] : restricted,
  };
}

/**
 * CSRF guard for writes: the request must come from this origin. Browsers send Origin on every cross-origin POST/PUT
 * and Sec-Fetch-Site on modern engines; non-browser clients (curl with a token) send neither and pass.
 */
export function crossSite(request: Request): string | null {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return `cross-site request blocked (Sec-Fetch-Site: ${site})`;
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      return "cross-site request blocked (bad Origin)";
    }
    const own = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
    if (host !== own) return `cross-site request blocked (Origin ${origin})`;
  } else if (origin === "null") {
    return "cross-site request blocked (opaque Origin)";
  }
  return null;
}

export function writeReason(request: Request): WriteReason {
  const v = (request.headers.get(WRITE_REASON_HEADER) ?? "edit").toLowerCase();
  return (WRITE_REASONS as readonly string[]).includes(v) ? (v as WriteReason) : "edit";
}

/* ───────────── append-only audit trail (migration 0004) ───────────── */

export interface AuditInput {
  action: string;
  reason?: string;
  baseVersion: number;
  version: number | null;
  bytes: number;
  changed?: CollectionChange[];
  protectedKeys?: string[];
  note?: string;
}

/** Best-effort insert into workspace_audit; returns false when the table is missing (migration 0004 not applied). */
export async function writeAudit(db: SgD1Database, request: Request, viewer: Viewer, who: Extract<Identity, { ok: true }>, entry: AuditInput): Promise<boolean> {
  try {
    await db
      .prepare(
        "INSERT INTO workspace_audit (workspace_id, at, actor, actor_source, actor_user_id, scope, action, reason, base_version, version, bytes, changed, protected, note, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        WORKSPACE_ID,
        new Date().toISOString(),
        actorLabel(request, who.email),
        viewer.source,
        viewer.userId,
        viewer.scope,
        entry.action,
        entry.reason ?? "",
        entry.baseVersion,
        entry.version,
        entry.bytes,
        JSON.stringify(entry.changed ?? []),
        JSON.stringify(entry.protectedKeys ?? []),
        (entry.note ?? "").slice(0, 500),
        (request.headers.get("user-agent") ?? "").slice(0, 200),
        request.headers.get("cf-connecting-ip") ?? "",
      )
      .run();
    return true;
  } catch {
    return false;
  }
}

/** True when a table exists (used by /api/health and to degrade gracefully before migration 0004). */
export async function tableExists(db: SgD1Database, table: string): Promise<boolean> {
  try {
    const row = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(table).first<{ name: string }>();
    return !!row;
  } catch {
    return false;
  }
}

/** Resolve the caller for admin-only endpoints: 401/403 response or the viewer. */
export async function requireAdmin(request: Request, env: ServerEnv): Promise<{ ok: true; viewer: Viewer; who: Extract<Identity, { ok: true }> } | { ok: false; response: Response }> {
  const who = await identify(request, env);
  if (!who.ok) return { ok: false, response: json({ error: who.error, hint: who.hint }, who.status) };
  const row = await readRow(env.DB).catch(() => null);
  const viewer = viewerOf(request, who, parseData(row), env);
  if (!viewer.admin) return { ok: false, response: json({ error: "forbidden", hint: "Only workspace admins (CEO, CFO or WORKSPACE_ADMINS) can do this." }, 403) };
  return { ok: true, viewer, who };
}
