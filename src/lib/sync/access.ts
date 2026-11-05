/**
 * Server-side identity helpers (API routes only).
 *
 * Production must sit behind Cloudflare Access. Access injects two headers on every request it lets through:
 *   - `Cf-Access-Jwt-Assertion`: a JWT signed by the team's Access keys (verified here — this is the proof);
 *   - `Cf-Access-Authenticated-User-Email`: convenience copy of the email (NOT trusted on its own, because a request
 *     that bypasses Access — e.g. the workers.dev hostname — could set it itself).
 *
 * Configuration (wrangler vars):
 *   CF_ACCESS_TEAM_DOMAIN  e.g. "spectrumgroup.cloudflareaccess.com"
 *   CF_ACCESS_AUD          the Application Audience (AUD) tag of the Access application
 *   ALLOW_ANONYMOUS_WORKSPACE="1"  demo only: lets unauthenticated browsers read/write the shared workspace
 * Without Access (local dev, CI) the app runs in demo mode, where the browser says who it is "acting as" via
 * `X-Sg-Acting-As` (informational only).
 */

export const ACCESS_EMAIL_HEADER = "cf-access-authenticated-user-email";
export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
export const ACTING_AS_HEADER = "x-sg-acting-as";

const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}$/;

function cleanEmail(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase() ?? "";
  return v && v.length <= 254 && EMAIL_RE.test(v) ? v : null;
}

export interface AccessConfig {
  APP_ENV?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ALLOW_ANONYMOUS_WORKSPACE?: string;
}

export type Identity =
  | { ok: true; email: string; source: "access" }
  | { ok: true; email: null; source: "anonymous-allowed" | "development" }
  | { ok: false; status: 401 | 403; error: string; hint: string };

/* ── JWT (RS256) verification against the team's Access certs ── */

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}
let certCache: { domain: string; at: number; keys: Jwk[] } | null = null;

async function accessKeys(domain: string): Promise<Jwk[]> {
  if (certCache && certCache.domain === domain && Date.now() - certCache.at < 60 * 60 * 1000) return certCache.keys;
  const res = await fetch(`https://${domain}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600 } } as RequestInit);
  if (!res.ok) throw new Error(`Access certs ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  certCache = { domain, at: Date.now(), keys: body.keys ?? [] };
  return certCache.keys;
}

const b64urlToBytes = (s: string) => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const b64urlJson = <T,>(s: string): T => JSON.parse(new TextDecoder().decode(b64urlToBytes(s))) as T;

/** Verify a Cloudflare Access JWT; returns the email claim or null. */
export async function verifyAccessJwt(token: string, cfg: Required<Pick<AccessConfig, "CF_ACCESS_TEAM_DOMAIN" | "CF_ACCESS_AUD">>): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: { kid?: string; alg?: string };
  let claims: { aud?: string | string[]; exp?: number; nbf?: number; iss?: string; email?: string };
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;
  const now = Math.floor(Date.now() / 1000);
  if (!claims.exp || claims.exp < now - 60 || (claims.nbf && claims.nbf > now + 60)) return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(cfg.CF_ACCESS_AUD)) return null;
  const domain = cfg.CF_ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (claims.iss && claims.iss.replace(/\/$/, "") !== `https://${domain}`) return null;
  const keys = await accessKeys(domain);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  return valid ? cleanEmail(claims.email) : null;
}

/**
 * Who is making this request, and may they touch the shared workspace?
 * Production: a verified Access JWT is required unless ALLOW_ANONYMOUS_WORKSPACE="1".
 * Non-production (local/CI): allowed as demo.
 */
export async function identify(request: Request, env: AccessConfig): Promise<Identity> {
  const production = (env.APP_ENV ?? "production") === "production";
  const token = request.headers.get(ACCESS_JWT_HEADER);
  if (env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD && token) {
    try {
      const email = await verifyAccessJwt(token, { CF_ACCESS_TEAM_DOMAIN: env.CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD: env.CF_ACCESS_AUD });
      if (email) return { ok: true, email, source: "access" };
    } catch {
      /* fall through to the decision below */
    }
    return { ok: false, status: 403, error: "invalid_access_token", hint: "The Cloudflare Access token could not be verified. Sign in again." };
  }
  if (!production) return { ok: true, email: null, source: "development" };
  if (env.ALLOW_ANONYMOUS_WORKSPACE === "1") return { ok: true, email: null, source: "anonymous-allowed" };
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD)
    return { ok: false, status: 401, error: "access_not_configured", hint: "Shared data is locked until Cloudflare Access protects this site (set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD). The app keeps working on this device." };
  return { ok: false, status: 401, error: "sign_in_required", hint: "Sign in through Cloudflare Access to load the shared workspace." };
}

/** Email asserted by Cloudflare Access header (display only — use identify() for authorisation). */
export function accessEmail(request: Request): string | null {
  return cleanEmail(request.headers.get(ACCESS_EMAIL_HEADER));
}

/** Who to record as the author of a write: the verified email, else "demo:<acting-as email>", else "anonymous". */
export function actorLabel(request: Request, verifiedEmail?: string | null): string {
  if (verifiedEmail) return verifiedEmail;
  const acting = cleanEmail(request.headers.get(ACTING_AS_HEADER));
  return acting ? `demo:${acting}` : "anonymous";
}
