import { NextResponse } from "next/server";

/**
 * Security headers on every page and API response (Edge runtime — Web APIs only).
 * Static build assets are skipped via the matcher; they are immutable and served by the assets binding.
 *
 * Content-Security-Policy: everything is same-origin (fonts are self-hosted by next/font, images are local or data:
 * / blob: URLs, the API is same-origin). Next.js inlines its bootstrap scripts, so script-src needs 'unsafe-inline'
 * (no eval in production; `next dev` needs it for fast refresh). Cloudflare Web Analytics is allowed in case the zone
 * injects it. frame-ancestors 'none' replaces X-Frame-Options for modern browsers (both are sent).
 */
const dev = process.env.NODE_ENV !== "production";

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://static.cloudflareinsights.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' https://cloudflareinsights.com${dev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Permitted-Cross-Domain-Policies": "none",
};

export function middleware(request: Request) {
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  // API responses carry workspace data: never cache them anywhere, never sniff them
  if (new URL(request.url).pathname.startsWith("/api/")) {
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Robots-Tag", "noindex");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
