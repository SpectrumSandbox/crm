import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

/** Liveness + D1 connectivity: GET /api/health */
export async function GET() {
  const started = Date.now();
  try {
    const { env } = await getCloudflareContext({ async: true });
    const row = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM contacts) AS contacts, (SELECT COUNT(*) FROM companies) AS companies, (SELECT COUNT(*) FROM deals) AS deals, (SELECT COUNT(*) FROM issues) AS issues, (SELECT COUNT(*) FROM cross_links) AS cross_links",
    ).first<Record<string, number>>();
    return Response.json({ ok: true, env: env.APP_ENV ?? "unknown", d1: { connected: true, counts: row }, latencyMs: Date.now() - started });
  } catch (err) {
    return Response.json({ ok: false, d1: { connected: false, error: err instanceof Error ? err.message : String(err) }, latencyMs: Date.now() - started }, { status: 503 });
  }
}
