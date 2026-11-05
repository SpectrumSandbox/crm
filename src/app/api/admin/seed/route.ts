import { buildSeedStatements } from "@/lib/seed-sql";
import { crossSite, json, requireAdmin, serverEnv, writeAudit } from "@/lib/sync/server";

export const dynamic = "force-dynamic";

/**
 * Loads the demo seed into D1's relational tables (wipes the CRM/agile tables first; the workspace snapshot is untouched).
 *   curl -X POST https://crm.spectrumgroup.id/api/admin/seed -H "Authorization: Bearer $SEED_TOKEN"   (+ the Access service token / cookie)
 * Needs BOTH the SEED_TOKEN secret (`wrangler secret put SEED_TOKEN`; absent = disabled) AND a workspace admin identity
 * (CEO/CFO HR role, or an email in WORKSPACE_ADMINS; any caller in local dev). Every run is written to the audit trail.
 */
export async function POST(request: Request) {
  const env = await serverEnv();
  const token = env.SEED_TOKEN;
  if (!token) return Response.json({ ok: false, error: "Seeding disabled: SEED_TOKEN secret is not set" }, { status: 403 });
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return gate.response;
  const blocked = crossSite(request);
  if (blocked) return json({ ok: false, error: "cross_site", hint: blocked }, 403);
  if (request.headers.get("authorization") !== `Bearer ${token}`) {
    await writeAudit(env.DB, request, gate.viewer, gate.who, { action: "rejected", reason: "admin_seed", baseVersion: 0, version: null, bytes: 0, note: "Wrong SEED_TOKEN" });
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const statements = buildSeedStatements().filter((s) => s.startsWith("INSERT") || s.startsWith("DELETE"));
  const CHUNK = 80;
  let executed = 0;
  for (let i = 0; i < statements.length; i += CHUNK) {
    const batch = statements.slice(i, i + CHUNK).map((sql) => env.DB.prepare(sql));
    await env.DB.batch(batch);
    executed += batch.length;
  }
  await writeAudit(env.DB, request, gate.viewer, gate.who, { action: "admin_seed", reason: "admin_seed", baseVersion: 0, version: null, bytes: 0, note: `Relational tables reseeded (${executed} statements)` });
  return Response.json({ ok: true, executed });
}
