/**
 * Record-level three-way merge of workspace snapshots (pure; used by the sync engine on a 409 conflict).
 *
 *   base   = the server data this browser last synced with
 *   local  = this browser's data now (with unsynced edits)
 *   remote = the newer server data someone else saved
 *
 * Per collection, rows are keyed by `id` (or `userId` for HR-style rows). Local additions, edits and deletions are
 * re-applied on top of the remote copy. When both sides changed the same record differently, the REMOTE copy is kept
 * (a certification or release made elsewhere must never be undone silently) and the record counts as a conflict.
 * Collections whose rows have no key fall back to "whichever side changed it; remote if both did".
 */

type Row = Record<string, unknown>;
export type Collections = Record<string, unknown>;

export interface MergeOutcome {
  data: Collections;
  /** local changes re-applied on top of remote (rows) */
  merged: number;
  /** records both sides changed — remote kept */
  conflicts: number;
  conflictKeys: string[];
}

const isRow = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const keyOf = (r: unknown): string | null => (isRow(r) ? (typeof r.id === "string" && r.id ? r.id : typeof r.userId === "string" && r.userId ? `u:${r.userId}` : null) : null);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function mapOf(rows: unknown[]): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const r of rows) {
    const k = keyOf(r);
    if (k && !m.has(k)) m.set(k, r);
  }
  return m;
}

function mergeCollection(base: unknown[], local: unknown[], remote: unknown[]): { rows: unknown[]; merged: number; conflicts: number } {
  if (same(local, base)) return { rows: remote, merged: 0, conflicts: 0 };
  if (same(remote, base) || same(remote, local)) return { rows: local, merged: same(remote, local) ? 0 : 1, conflicts: 0 };
  const keyed = [...base, ...local, ...remote].every((r) => keyOf(r) !== null);
  if (!keyed) return { rows: remote, merged: 0, conflicts: 1 };

  const b = mapOf(base);
  const l = mapOf(local);
  const r = mapOf(remote);
  let merged = 0;
  let conflicts = 0;
  const out: unknown[] = [];
  const placed = new Set<string>();

  // local additions that sit before the first pre-existing row were prepended (newest-first lists) — keep them on top
  const leadingAdds: unknown[] = [];
  for (const row of local) {
    const k = keyOf(row) as string;
    if (b.has(k) || r.has(k)) break;
    leadingAdds.push(row);
  }
  for (const row of leadingAdds) {
    out.push(row);
    placed.add(keyOf(row) as string);
    merged++;
  }

  for (const row of remote) {
    const k = keyOf(row) as string;
    if (placed.has(k)) continue;
    const inBase = b.get(k);
    const inLocal = l.get(k);
    if (inBase !== undefined && inLocal === undefined) {
      // deleted here: drop it unless the other side changed it meanwhile
      if (same(row, inBase)) {
        merged++;
        placed.add(k);
        continue;
      }
      conflicts++;
      out.push(row);
      placed.add(k);
      continue;
    }
    if (inBase !== undefined && inLocal !== undefined && !same(inLocal, inBase)) {
      if (same(row, inBase) || same(row, inLocal)) {
        out.push(inLocal);
        if (!same(row, inLocal)) merged++;
      } else {
        conflicts++;
        out.push(row);
      }
      placed.add(k);
      continue;
    }
    out.push(row);
    placed.add(k);
  }
  // remaining local additions (not in base, not on the server) go at the end
  for (const row of local) {
    const k = keyOf(row) as string;
    if (placed.has(k) || b.has(k) || r.has(k)) continue;
    out.push(row);
    placed.add(k);
    merged++;
  }
  return { rows: out, merged, conflicts };
}

/** Merge every collection present in `remote` or `local`. `__schema` and non-array values come from remote. */
export function threeWayMerge(base: Collections, local: Collections, remote: Collections): MergeOutcome {
  const out: Collections = { ...remote };
  let merged = 0;
  let conflicts = 0;
  const conflictKeys: string[] = [];
  for (const key of new Set([...Object.keys(remote), ...Object.keys(local)])) {
    if (key === "__schema") continue;
    const l = Array.isArray(local[key]) ? (local[key] as unknown[]) : null;
    const r = Array.isArray(remote[key]) ? (remote[key] as unknown[]) : null;
    if (!l) continue;
    if (!r) {
      out[key] = l;
      continue;
    }
    const b = Array.isArray(base[key]) ? (base[key] as unknown[]) : [];
    const res = mergeCollection(b, l, r);
    out[key] = res.rows;
    merged += res.merged;
    conflicts += res.conflicts;
    if (res.conflicts) conflictKeys.push(key);
  }
  return { data: out, merged, conflicts, conflictKeys };
}
