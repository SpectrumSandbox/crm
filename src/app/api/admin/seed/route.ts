import { getCloudflareContext } from "@opennextjs/cloudflare";
import { buildSeedStatements } from "@/lib/seed-sql";

export const dynamic = "force-dynamic";

/**
 * Loads the demo seed into D1 (wipes the CRM/agile tables first).
 *   curl -X POST https://crm.spectrumgroup.id/api/admin/seed -H "Authorization: Bearer $SEED_TOKEN"
 * Requires the SEED_TOKEN secret: `wrangler secret put SEED_TOKEN`. Without it the route is disabled.
 */
export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const token = (env as unknown as { SEED_TOKEN?: string }).SEED_TOKEN;
  if (!token) return Response.json({ ok: false, error: "Seeding disabled: SEED_TOKEN secret is not set" }, { status: 403 });
  if (request.headers.get("authorization") !== `Bearer ${token}`) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const statements = buildSeedStatements().filter((s) => s.startsWith("INSERT") || s.startsWith("DELETE"));
  const CHUNK = 80;
  let executed = 0;
  for (let i = 0; i < statements.length; i += CHUNK) {
    const batch = statements.slice(i, i + CHUNK).map((sql) => env.DB.prepare(sql));
    await env.DB.batch(batch);
    executed += batch.length;
  }
  return Response.json({ ok: true, executed });
}
