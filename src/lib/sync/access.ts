/**
 * Server-side identity helpers (API routes only).
 * Production sits behind Cloudflare Access (Google SSO), which injects `Cf-Access-Authenticated-User-Email`
 * on every request it lets through. Without Access (local dev, CI) the header is absent and the app runs in
 * demo mode, where the browser says who it is "acting as" via `X-Sg-Acting-As` (informational only).
 */

export const ACCESS_EMAIL_HEADER = "cf-access-authenticated-user-email";
export const ACTING_AS_HEADER = "x-sg-acting-as";

const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}$/;

function cleanEmail(value: string | null): string | null {
  const v = value?.trim().toLowerCase() ?? "";
  return v && v.length <= 254 && EMAIL_RE.test(v) ? v : null;
}

/** Email asserted by Cloudflare Access, or null when the request did not come through Access. */
export function accessEmail(request: Request): string | null {
  return cleanEmail(request.headers.get(ACCESS_EMAIL_HEADER));
}

/** Who to record as the author of a write: the Access email, else "demo:<acting-as email>", else "anonymous". */
export function actorLabel(request: Request): string {
  const email = accessEmail(request);
  if (email) return email;
  const acting = cleanEmail(request.headers.get(ACTING_AS_HEADER));
  return acting ? `demo:${acting}` : "anonymous";
}
