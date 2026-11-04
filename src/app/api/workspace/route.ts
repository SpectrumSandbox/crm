import { getCloudflareContext } from "@opennextjs/cloudflare";
import { actorLabel } from "@/lib/sync/access";

export const dynamic = "force-dynamic";

/** Single shared workspace for now; the column exists so more can be added later. */
const WORKSPACE_ID = "default";
/** Reject request bodies above 4 MB (D1 itself caps a row at ~2 MB, see README › Data). */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

interface SnapshotRow {
  version: number;
  data: string;
  updated_at: string;
  updated_by: string;
}

const noStore = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

/** Build the snapshot response without re-parsing the stored JSON (it was validated when written). */
function snapshotResponse(row: SnapshotRow, status = 200, extra: Record<string, unknown> = {}) {
  const head = JSON.stringify({ ...extra, version: row.version, updatedAt: row.updated_at, updatedBy: row.updated_by });
  const body = `${head.slice(0, -1)},"data":${row.data || "{}"}}`;
  return new Response(body, { status, headers: { ...noStore, "Content-Type": "application/json; charset=utf-8" } });
}

function failure(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (/no such table/i.test(message)) {
    return json({ error: message, hint: "Apply D1 migration 0002_workspace.sql (npm run db:migrate:remote, or db:migrate:local for next dev)." }, 503);
  }
  if (/too (big|large)|SQLITE_TOOBIG/i.test(message)) {
    return json({ error: "Workspace snapshot is too large for a single D1 row (~2 MB).", detail: message }, 507);
  }
  return json({ error: message }, 503);
}

async function readRow(db: SgD1Database) {
  return db.prepare("SELECT version, data, updated_at, updated_by FROM workspace_snapshots WHERE id = ?").bind(WORKSPACE_ID).first<SnapshotRow>();
}

/** GET /api/workspace → { version, data, updatedAt, updatedBy } | 404 { error: "not_found" } */
export async function GET() {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const row = await readRow(env.DB);
    if (!row) return json({ error: "not_found" }, 404);
    return snapshotResponse(row);
  } catch (err) {
    return failure(err);
  }
}

function isValidData(data: unknown): data is Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  return Object.entries(data as Record<string, unknown>).every(([k, v]) => (k === "__schema" ? typeof v === "number" : Array.isArray(v)));
}

function changes(result: SgD1Result): number {
  const n = (result.meta as { changes?: unknown }).changes;
  return typeof n === "number" ? n : 0;
}

/**
 * PUT /api/workspace  { baseVersion, data }
 * Optimistic concurrency: the write only lands when the stored version still equals baseVersion
 * (baseVersion 0 = create). 200 → { version, updatedAt, updatedBy }; 409 → current { version, data, … }.
 */
export async function PUT(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json({ error: `Payload too large (max ${MAX_BODY_BYTES} bytes)` }, 413);

  let text: string;
  try {
    text = await request.text();
  } catch {
    return json({ error: "Could not read request body" }, 400);
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return json({ error: `Payload too large (max ${MAX_BODY_BYTES} bytes)` }, 413);

  let body: { baseVersion?: unknown; data?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  const baseVersion = body.baseVersion;
  if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0) return json({ error: "baseVersion must be a non-negative integer" }, 400);
  if (!isValidData(body.data)) return json({ error: "data must be an object of collection arrays" }, 400);

  const data = JSON.stringify(body.data);
  const updatedAt = new Date().toISOString();
  const updatedBy = actorLabel(request);

  try {
    const { env } = await getCloudflareContext({ async: true });
    const result =
      baseVersion === 0
        ? await env.DB.prepare("INSERT INTO workspace_snapshots (id, version, data, updated_at, updated_by) VALUES (?, 1, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
            .bind(WORKSPACE_ID, data, updatedAt, updatedBy)
            .run()
        : await env.DB.prepare("UPDATE workspace_snapshots SET version = version + 1, data = ?, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?")
            .bind(data, updatedAt, updatedBy, WORKSPACE_ID, baseVersion)
            .run();

    if (changes(result) === 1) return json({ version: baseVersion + 1, updatedAt, updatedBy });

    const current = await readRow(env.DB);
    if (!current) return json({ error: "conflict", version: 0, data: null, updatedAt: null, updatedBy: null }, 409);
    return snapshotResponse(current, 409, { error: "conflict" });
  } catch (err) {
    return failure(err);
  }
}
