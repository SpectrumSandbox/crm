import { getCloudflareContext } from "@opennextjs/cloudflare";
import { identify, type AccessConfig } from "@/lib/sync/access";

export const dynamic = "force-dynamic";

/**
 * Who is signed in: GET /api/me → { email, authenticated, workspace: "allowed" | "locked", reason? }.
 * `authenticated` is true only for a verified Cloudflare Access token.
 */
export async function GET(request: Request) {
  let env: AccessConfig = {};
  try {
    env = (await getCloudflareContext({ async: true })).env as unknown as AccessConfig;
  } catch {
    /* outside Workers (next dev) */
  }
  const who = await identify(request, env);
  const body = who.ok
    ? { email: who.email, authenticated: who.source === "access", workspace: "allowed", mode: who.source }
    : { email: null, authenticated: false, workspace: "locked", reason: who.error, hint: who.hint };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
