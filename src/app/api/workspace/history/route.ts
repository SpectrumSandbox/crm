import { actorLabel } from "@/lib/sync/access";
import { diffCollections, validateSnapshot, type WorkspaceData } from "@/lib/sync/server-policy";
import { crossSite, failure, json, parseData, readRow, requireAdmin, serverEnv, WORKSPACE_ID, writeAudit } from "@/lib/sync/server";

export const dynamic = "force-dynamic";

const missing = () => json({ error: "history_table_missing", hint: "Apply D1 migration 0004_workspace_audit.sql (npm run db:migrate:remote)." }, 503);
const isMissing = (err: unknown) => /no such table/i.test(err instanceof Error ? err.message : String(err));

/** GET /api/workspace/history → { current, versions: [{ version, savedAt, savedBy, bytes }] } — workspace admins only. */
export async function GET(request: Request) {
  try {
    const env = await serverEnv();
    const gate = await requireAdmin(request, env);
    if (!gate.ok) return gate.response;
    const current = await readRow(env.DB);
    try {
      const rows = await env.DB.prepare("SELECT version, saved_at AS savedAt, saved_by AS savedBy, bytes FROM workspace_snapshot_history WHERE workspace_id = ? ORDER BY version DESC LIMIT 100")
        .bind(WORKSPACE_ID)
        .all<{ version: number; savedAt: string; savedBy: string; bytes: number }>();
      return json({ current: current ? { version: current.version, savedAt: current.updated_at, savedBy: current.updated_by, bytes: current.data.length } : null, versions: rows.results });
    } catch (err) {
      if (isMissing(err)) return missing();
      throw err;
    }
  } catch (err) {
    return failure(err);
  }
}

/**
 * POST /api/workspace/history { version, currentVersion } — roll the shared workspace back to an earlier version.
 * The old data becomes a NEW version (history is never rewritten); the version it replaces is kept in history.
 */
export async function POST(request: Request) {
  try {
    const env = await serverEnv();
    const gate = await requireAdmin(request, env);
    if (!gate.ok) return gate.response;
    const blocked = crossSite(request);
    if (blocked) return json({ error: "cross_site", hint: blocked }, 403);

    const body = (await request.json().catch(() => null)) as { version?: unknown; currentVersion?: unknown } | null;
    const target = body?.version;
    if (typeof target !== "number" || !Number.isInteger(target) || target < 1) return json({ error: "version must be a positive integer" }, 400);

    const current = await readRow(env.DB);
    if (!current) return json({ error: "not_found" }, 404);
    if (typeof body?.currentVersion === "number" && body.currentVersion !== current.version) {
      return json({ error: "conflict", hint: `The workspace moved on to v${current.version} — reload the list and try again.`, version: current.version }, 409);
    }

    let old: { data: string } | null;
    try {
      old = await env.DB.prepare("SELECT data FROM workspace_snapshot_history WHERE workspace_id = ? AND version = ?").bind(WORKSPACE_ID, target).first<{ data: string }>();
    } catch (err) {
      if (isMissing(err)) return missing();
      throw err;
    }
    if (!old) return json({ error: "version_not_kept", hint: `v${target} is no longer in the history.` }, 404);
    let parsed: unknown;
    try {
      parsed = JSON.parse(old.data);
    } catch {
      return json({ error: "history row is not valid JSON" }, 500);
    }
    const invalid = validateSnapshot(parsed);
    if (invalid) return json({ error: `history row is invalid: ${invalid}` }, 500);

    // the audit log stays append-only across a rollback: keep every entry recorded since
    const oldData = parsed as WorkspaceData;
    const curData = parseData(current);
    const curAudit = Array.isArray(curData?.auditLog) ? (curData?.auditLog as unknown[]) : [];
    const oldAudit = Array.isArray(oldData.auditLog) ? (oldData.auditLog as unknown[]) : [];
    const oldIds = new Set(oldAudit.map((e) => (e && typeof e === "object" ? (e as { id?: unknown }).id : undefined)));
    const next: WorkspaceData = { ...oldData, auditLog: [...curAudit.filter((e) => !oldIds.has(e && typeof e === "object" ? (e as { id?: unknown }).id : undefined)), ...oldAudit] };
    const data = JSON.stringify(next);
    const updatedAt = new Date().toISOString();
    const updatedBy = actorLabel(request, gate.who.email);

    const results = await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO workspace_snapshot_history (workspace_id, version, data, saved_at, saved_by, bytes) SELECT id, version, data, updated_at, updated_by, LENGTH(data) FROM workspace_snapshots WHERE id = ? AND version = ?",
      ).bind(WORKSPACE_ID, current.version),
      env.DB.prepare("UPDATE workspace_snapshots SET version = version + 1, data = ?, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?").bind(
        data,
        updatedAt,
        updatedBy,
        WORKSPACE_ID,
        current.version,
      ),
    ]);
    const n = (results[1].meta as { changes?: unknown }).changes;
    if (n !== 1) return json({ error: "conflict", hint: "Someone saved at the same moment — try again." }, 409);
    const version = current.version + 1;
    await writeAudit(env.DB, request, gate.viewer, gate.who, {
      action: "rollback",
      reason: "rollback",
      baseVersion: current.version,
      version,
      bytes: data.length,
      changed: diffCollections(curData, next),
      note: `Rolled back to the data of v${target}`,
    });
    return json({ version, updatedAt, updatedBy, restoredFrom: target });
  } catch (err) {
    return failure(err);
  }
}
