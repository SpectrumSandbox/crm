import { identify } from "@/lib/sync/access";
import { adminEmails } from "@/lib/sync/server-policy";
import { serverEnv, tableExists } from "@/lib/sync/server";

export const dynamic = "force-dynamic";

/** Tables reported in `d1.counts`; a table that does not exist yet (migration not applied) counts as null. */
const COUNTED_TABLES = ["contacts", "companies", "deals", "issues", "cross_links", "initiatives", "employee_profiles", "workspace_snapshots", "workspace_audit", "workspace_snapshot_history"] as const;

async function count(db: SgD1Database, table: string): Promise<number | null> {
  try {
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
    return typeof row?.n === "number" ? row.n : null;
  } catch {
    return null;
  }
}

async function workspaceInfo(db: SgD1Database) {
  try {
    const row = await db.prepare("SELECT version, updated_at AS updatedAt, updated_by AS updatedBy, LENGTH(data) AS bytes FROM workspace_snapshots WHERE id = 'default'").first<{ version: number; updatedAt: string; updatedBy: string; bytes: number }>();
    return row ?? null;
  } catch {
    return null;
  }
}

/**
 * Liveness + D1 connectivity: GET /api/health.
 * Anyone gets { ok, d1.connected, pingMs }. Callers allowed to use the workspace (verified Access user, or demo/dev)
 * also get table counts, snapshot info and the security configuration shown in Settings.
 */
export async function GET(request: Request) {
  const started = Date.now();
  let envName = "unknown";
  try {
    const env = await serverEnv();
    envName = env.APP_ENV ?? "unknown";
    await env.DB.prepare("SELECT 1 AS ok").first();
    const pingMs = Date.now() - started;
    const who = await identify(request, env);
    if (!who.ok) {
      return Response.json(
        { ok: true, d1: { connected: true, pingMs }, detail: "restricted", hint: who.hint, latencyMs: Date.now() - started },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const values = await Promise.all(COUNTED_TABLES.map((t) => count(env.DB, t)));
    const counts = Object.fromEntries(COUNTED_TABLES.map((t, i) => [t, values[i]])) as Record<(typeof COUNTED_TABLES)[number], number | null>;
    const [workspace, auditTable, historyTable] = await Promise.all([workspaceInfo(env.DB), tableExists(env.DB, "workspace_audit"), tableExists(env.DB, "workspace_snapshot_history")]);
    const security = {
      mode: who.source,
      production: (env.APP_ENV ?? "production") === "production",
      accessConfigured: !!(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD),
      anonymousWorkspace: env.ALLOW_ANONYMOUS_WORKSPACE === "1",
      anonymousPayData: env.ALLOW_ANONYMOUS_PAY_DATA === "1",
      workspaceAdmins: adminEmails(env).length,
      seedTokenSet: !!env.SEED_TOKEN,
      auditTable,
      historyTable,
    };
    return Response.json(
      { ok: true, env: envName, d1: { connected: true, pingMs, counts }, workspace, security, latencyMs: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return Response.json(
      { ok: false, env: envName, d1: { connected: false, error: err instanceof Error ? err.message : String(err) }, workspace: null, latencyMs: Date.now() - started },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
