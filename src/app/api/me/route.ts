import { identify, type AccessConfig } from "@/lib/sync/access";
import { restrictedKeys } from "@/lib/sync/server-policy";
import { accessInfo, parseData, readRow, viewerOf, type ServerEnv } from "@/lib/sync/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

/**
 * Who is signed in, resolved on the server:
 *   GET /api/me → { email, authenticated, workspace: "allowed" | "locked", mode, access?: { userId, roles, scope, admin, … }, reason?, hint? }
 * `authenticated` is true only for a verified Cloudflare Access token. `access.userId` is the workspace user whose
 * email matches (null = signed in but not a workspace user — the client must not let them act as anyone).
 */
export async function GET(request: Request) {
  let env: ServerEnv | null = null;
  try {
    env = (await getCloudflareContext({ async: true })).env as unknown as ServerEnv;
  } catch {
    /* outside Workers (plain `next start` in CI): no identity source and no shared data — the client works offline */
  }
  if (!env) {
    return Response.json({ email: null, authenticated: false, workspace: "unavailable", mode: "offline", hint: "No Workers runtime — the shared workspace is unavailable here." }, { headers: { "Cache-Control": "no-store" } });
  }
  const who = await identify(request, env as AccessConfig);
  if (!who.ok) {
    return Response.json({ email: null, authenticated: false, workspace: "locked", mode: "locked", reason: who.error, hint: who.hint }, { headers: { "Cache-Control": "no-store" } });
  }
  let access: ReturnType<typeof accessInfo> | null = null;
  if (env.DB) {
    try {
      const data = parseData(await readRow(env.DB));
      access = accessInfo(viewerOf(request, who, data, env), restrictedKeys(data));
    } catch {
      access = null; // table missing / D1 down — the client falls back to its local match
    }
  }
  return Response.json(
    { email: who.email, authenticated: who.source === "access", workspace: "allowed", mode: who.source, access },
    { headers: { "Cache-Control": "no-store" } },
  );
}
