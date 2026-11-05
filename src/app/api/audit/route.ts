import { failure, json, requireAdmin, serverEnv, WORKSPACE_ID } from "@/lib/sync/server";

export const dynamic = "force-dynamic";

interface AuditRow {
  id: number;
  at: string;
  actor: string;
  actor_source: string;
  actor_user_id: string | null;
  scope: string;
  action: string;
  reason: string;
  base_version: number;
  version: number | null;
  bytes: number;
  changed: string;
  protected: string;
  note: string;
  user_agent: string;
}

const parseList = (s: string): unknown[] => {
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/**
 * GET /api/audit?limit=50&before=<id>&actor=<text>&action=<action>  — workspace admins only.
 * → { entries: [...], next: <id> | null }. Rows come from the append-only workspace_audit table (migration 0004).
 */
export async function GET(request: Request) {
  try {
    const env = await serverEnv();
    const gate = await requireAdmin(request, env);
    if (!gate.ok) return gate.response;

    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const before = Number(url.searchParams.get("before")) || 0;
    const actor = (url.searchParams.get("actor") ?? "").trim().toLowerCase().slice(0, 120);
    const action = (url.searchParams.get("action") ?? "").trim().toLowerCase().slice(0, 40);

    const where = ["workspace_id = ?"];
    const binds: unknown[] = [WORKSPACE_ID];
    if (before > 0) {
      where.push("id < ?");
      binds.push(before);
    }
    if (actor) {
      where.push("LOWER(actor) LIKE ?");
      binds.push(`%${actor.replace(/[%_]/g, "")}%`);
    }
    if (action) {
      where.push("(action = ? OR reason = ?)");
      binds.push(action, action);
    }
    const sql = `SELECT id, at, actor, actor_source, actor_user_id, scope, action, reason, base_version, version, bytes, changed, protected, note, user_agent FROM workspace_audit WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`;
    let rows: AuditRow[];
    try {
      rows = (await env.DB.prepare(sql).bind(...binds, limit + 1).all<AuditRow>()).results;
    } catch (err) {
      if (/no such table/i.test(err instanceof Error ? err.message : String(err))) {
        return json({ error: "audit_table_missing", hint: "Apply D1 migration 0004_workspace_audit.sql (npm run db:migrate:remote)." }, 503);
      }
      throw err;
    }
    const page = rows.slice(0, limit);
    return json({
      entries: page.map((r) => ({
        id: r.id,
        at: r.at,
        actor: r.actor,
        source: r.actor_source,
        userId: r.actor_user_id,
        scope: r.scope,
        action: r.action,
        reason: r.reason,
        baseVersion: r.base_version,
        version: r.version,
        bytes: r.bytes,
        changed: parseList(r.changed),
        protected: parseList(r.protected),
        note: r.note,
        userAgent: r.user_agent,
      })),
      next: rows.length > limit ? page[page.length - 1]?.id ?? null : null,
    });
  } catch (err) {
    return failure(err);
  }
}
