import { actorLabel, identify } from "@/lib/sync/access";
import { bulkDeleteViolation, diffCollections, mergeWrite, redactForViewer, restrictedKeys, validateSnapshot, type WorkspaceData } from "@/lib/sync/server-policy";
import {
  accessInfo,
  crossSite,
  failure,
  json,
  noStore,
  parseData,
  readRow,
  serverEnv,
  viewerOf,
  WORKSPACE_ID,
  writeAudit,
  writeReason,
  type SnapshotRow,
} from "@/lib/sync/server";

export const dynamic = "force-dynamic";

/** Reject request bodies above 4 MB (D1 itself caps a row at ~2 MB, see README › Data). */
const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** Snapshot history kept for rollback: the last N versions, plus the last version of each day for HISTORY_DAYS. */
const HISTORY_KEEP = 20;
const HISTORY_DAYS = 30;

/**
 * Build the snapshot response. Full-scope viewers get the stored JSON verbatim (no re-parse);
 * everyone else gets a redacted copy (§13.4 — individual pay data only for pay roles and the person concerned).
 */
function snapshotResponse(row: SnapshotRow, data: WorkspaceData | null, viewer: ReturnType<typeof viewerOf>, status = 200, extra: Record<string, unknown> = {}) {
  const restricted = restrictedKeys(data);
  const head = JSON.stringify({ ...extra, version: row.version, updatedAt: row.updated_at, updatedBy: row.updated_by, access: accessInfo(viewer, restricted) });
  const payload = viewer.scope === "full" || !data ? row.data || "{}" : JSON.stringify(redactForViewer(data, viewer));
  const body = `${head.slice(0, -1)},"data":${payload}}`;
  return new Response(body, { status, headers: { ...noStore, "Content-Type": "application/json; charset=utf-8" } });
}

/** GET /api/workspace → { version, data, updatedAt, updatedBy, access } | 404 { error: "not_found", access } */
export async function GET(request: Request) {
  try {
    const env = await serverEnv();
    const who = await identify(request, env);
    if (!who.ok) return json({ error: who.error, hint: who.hint }, who.status);
    const row = await readRow(env.DB);
    const data = parseData(row);
    const viewer = viewerOf(request, who, data, env);
    if (!row) return json({ error: "not_found", access: accessInfo(viewer, []) }, 404);
    return snapshotResponse(row, data, viewer);
  } catch (err) {
    return failure(err);
  }
}

function changes(result: SgD1Result): number {
  const n = (result.meta as { changes?: unknown }).changes;
  return typeof n === "number" ? n : 0;
}

/**
 * PUT /api/workspace  { baseVersion, data }   (header X-Sg-Write-Reason: edit | bootstrap | upgrade | overwrite | restore | reset | merge)
 * Optimistic concurrency: the write only lands when the stored version still equals baseVersion
 * (baseVersion 0 = create). 200 → { version, updatedAt, updatedBy, protected }; 409 → current { version, data, … }.
 * The server applies the data-protection merge (restricted collections, roles, emails, append-only audit log),
 * blocks mass deletions by non-admins, keeps the previous version in the history table and appends an audit row.
 */
export async function PUT(request: Request) {
  let env: Awaited<ReturnType<typeof serverEnv>>;
  let who: Awaited<ReturnType<typeof identify>>;
  try {
    env = await serverEnv();
    who = await identify(request, env);
    if (!who.ok) return json({ error: who.error, hint: who.hint }, who.status);
  } catch (err) {
    return failure(err);
  }
  const blocked = crossSite(request);
  if (blocked) return json({ error: "cross_site", hint: blocked }, 403);

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json({ error: `Payload too large (max ${MAX_BODY_BYTES} bytes)` }, 413);

  let text: string;
  try {
    text = await request.text();
  } catch {
    return json({ error: "Could not read request body" }, 400);
  }
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_BODY_BYTES) return json({ error: `Payload too large (max ${MAX_BODY_BYTES} bytes)` }, 413);

  let body: { baseVersion?: unknown; data?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  const baseVersion = body.baseVersion;
  if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0) return json({ error: "baseVersion must be a non-negative integer" }, 400);
  const invalid = validateSnapshot(body.data);
  if (invalid) return json({ error: invalid }, 400);
  const incoming = body.data as WorkspaceData;
  const reason = writeReason(request);

  try {
    const row = await readRow(env.DB);
    const stored = parseData(row);
    const viewer = viewerOf(request, who, stored, env);

    if (row && row.version !== baseVersion) return snapshotResponse(row, stored, viewer, 409, { error: "conflict" });

    if (!row) {
      // Creating the shared workspace: only someone who may hold all data (or anyone when no admin list is configured).
      const mayCreate = viewer.scope === "full" || (viewer.source === "access" && !env.WORKSPACE_ADMINS);
      if (!mayCreate) {
        return json({ error: "bootstrap_requires_admin", hint: "The shared workspace has not been created yet — a workspace admin (WORKSPACE_ADMINS) must open the app first." }, 403);
      }
    }

    const merged = mergeWrite(stored, incoming, viewer);
    const changed = diffCollections(stored, merged.data);
    const violation = bulkDeleteViolation(stored, changed, viewer);
    if (violation) {
      await writeAudit(env.DB, request, viewer, who, { action: "rejected", reason, baseVersion, version: null, bytes, changed, protectedKeys: merged.protectedKeys, note: violation });
      return json({ error: "bulk_delete_blocked", hint: violation }, 403);
    }

    const schemaChanged = (stored?.__schema ?? null) !== (merged.data.__schema ?? null);
    if (row && changed.length === 0 && !schemaChanged) {
      // nothing the writer may change actually changed — don't bump the version
      return json({ version: row.version, updatedAt: row.updated_at, updatedBy: row.updated_by, protected: merged.protectedKeys, unchanged: true });
    }

    const data = JSON.stringify(merged.data);
    const updatedAt = new Date().toISOString();
    const updatedBy = actorLabel(request, who.email);
    let landed: boolean;
    if (!row) {
      const result = await env.DB.prepare("INSERT INTO workspace_snapshots (id, version, data, updated_at, updated_by) VALUES (?, 1, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
        .bind(WORKSPACE_ID, data, updatedAt, updatedBy)
        .run();
      landed = changes(result) === 1;
    } else {
      landed = await updateWithHistory(env.DB, data, updatedAt, updatedBy, baseVersion);
    }

    if (!landed) {
      const current = await readRow(env.DB);
      if (!current) return json({ error: "conflict", version: 0, data: null, updatedAt: null, updatedBy: null }, 409);
      const currentData = parseData(current);
      return snapshotResponse(current, currentData, viewerOf(request, who, currentData, env), 409, { error: "conflict" });
    }

    const version = baseVersion + 1;
    await writeAudit(env.DB, request, viewer, who, {
      action: row ? "update" : "create",
      reason,
      baseVersion,
      version,
      bytes: new TextEncoder().encode(data).byteLength,
      changed,
      protectedKeys: merged.protectedKeys,
    });
    return json({ version, updatedAt, updatedBy, protected: merged.protectedKeys, scope: viewer.scope });
  } catch (err) {
    return failure(err);
  }
}

/**
 * Conditional update that also copies the version being replaced into workspace_snapshot_history (one D1 batch =
 * one transaction). Falls back to a plain update while migration 0004 is not applied.
 */
async function updateWithHistory(db: SgD1Database, data: string, updatedAt: string, updatedBy: string, baseVersion: number): Promise<boolean> {
  const update = () =>
    db.prepare("UPDATE workspace_snapshots SET version = version + 1, data = ?, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?").bind(data, updatedAt, updatedBy, WORKSPACE_ID, baseVersion);
  try {
    const results = await db.batch([
      db
        .prepare(
          "INSERT OR IGNORE INTO workspace_snapshot_history (workspace_id, version, data, saved_at, saved_by, bytes) SELECT id, version, data, updated_at, updated_by, LENGTH(data) FROM workspace_snapshots WHERE id = ? AND version = ?",
        )
        .bind(WORKSPACE_ID, baseVersion),
      update(),
    ]);
    const ok = changes(results[1]) === 1;
    if (ok) await pruneHistory(db, baseVersion + 1);
    return ok;
  } catch (err) {
    if (!/no such table/i.test(err instanceof Error ? err.message : String(err))) throw err;
    return changes(await update().run()) === 1;
  }
}

async function pruneHistory(db: SgD1Database, version: number) {
  const cutoff = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
  try {
    await db
      .prepare(
        `DELETE FROM workspace_snapshot_history WHERE workspace_id = ?1 AND version <= ?2 - ${HISTORY_KEEP}
           AND (saved_at < ?3 OR version NOT IN (SELECT MAX(version) FROM workspace_snapshot_history WHERE workspace_id = ?1 GROUP BY substr(saved_at, 1, 10)))`,
      )
      .bind(WORKSPACE_ID, version, cutoff)
      .run();
  } catch {
    /* pruning is housekeeping — never fail a write over it */
  }
}
