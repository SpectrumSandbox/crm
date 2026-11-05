import { identify, type AccessConfig } from "@/lib/sync/access";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

/** Tables reported in `d1.counts`; a table that does not exist yet (migration not applied) counts as null. */
const COUNTED_TABLES = ["contacts", "companies", "deals", "issues", "cross_links", "initiatives", "employee_profiles", "workspace_snapshots"] as const;

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

/** Liveness + D1 connectivity: GET /api/health */
export async function GET(request: Request) {
  const started = Date.now();
  let envName = "unknown";
  try {
    const { env } = await getCloudflareContext({ async: true });
    envName = env.APP_ENV ?? "unknown";
    await env.DB.prepare("SELECT 1 AS ok").first();
    const pingMs = Date.now() - started;
    const values = await Promise.all(COUNTED_TABLES.map((t) => count(env.DB, t)));
    const counts = Object.fromEntries(COUNTED_TABLES.map((t, i) => [t, values[i]])) as Record<(typeof COUNTED_TABLES)[number], number | null>;
    // who last wrote the workspace is personal data — only for callers allowed to use the workspace
    const who = await identify(request, env as unknown as AccessConfig);
    const info = await workspaceInfo(env.DB);
    const workspace = info && !who.ok ? { ...info, updatedBy: "hidden" } : info;
    return Response.json(
      { ok: true, env: envName, d1: { connected: true, pingMs, counts }, workspace, latencyMs: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return Response.json(
      { ok: false, env: envName, d1: { connected: false, error: err instanceof Error ? err.message : String(err) }, workspace: null, latencyMs: Date.now() - started },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
