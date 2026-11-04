import { accessEmail } from "@/lib/sync/access";

export const dynamic = "force-dynamic";

/** Who is signed in: GET /api/me → { email, authenticated } (from Cloudflare Access; null in demo mode). */
export async function GET(request: Request) {
  const email = accessEmail(request);
  return Response.json({ email, authenticated: email !== null }, { headers: { "Cache-Control": "no-store" } });
}
