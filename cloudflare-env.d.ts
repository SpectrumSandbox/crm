// Bindings declared in wrangler.jsonc. `npm run cf-typegen` can regenerate the full
// workers-types version; this hand-written subset uses prefixed names so it never
// collides with @cloudflare/workers-types globals.

interface SgD1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

interface SgD1PreparedStatement {
  bind(...values: unknown[]): SgD1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SgD1Result<T>>;
  run(): Promise<SgD1Result>;
}

interface SgD1Database {
  prepare(query: string): SgD1PreparedStatement;
  batch(statements: SgD1PreparedStatement[]): Promise<SgD1Result[]>;
}

interface CloudflareEnv {
  DB: SgD1Database;
  APP_ENV: string;
  APP_URL: string;
  /** Secret (`wrangler secret put SEED_TOKEN`) enabling POST /api/admin/seed; absent = seeding disabled. */
  SEED_TOKEN?: string;
  /** Cloudflare Access team domain, e.g. "spectrumgroup.cloudflareaccess.com" — required for shared data in production. */
  CF_ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience (AUD) tag of the Access application. */
  CF_ACCESS_AUD?: string;
  /** "1" = demo: let unauthenticated browsers use the shared workspace (never with real data). */
  ALLOW_ANONYMOUS_WORKSPACE?: string;
}
