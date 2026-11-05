"use client";

import { seed, type SeedData } from "@/lib/seed";
import { useCrm, type CrmState } from "@/lib/store";
import { isRestrictedKey } from "./server-policy";

/** Persisted/synced collections — always derived from the seed bundle so new collections sync automatically. */
export const COLLECTION_KEYS = Object.keys(seed) as (keyof SeedData)[];

export const BACKUP_APP = "spectrum-crm";

type PersistApi = { persist: { getOptions(): { version?: number } } };

/** Store schema version (the persist `version` in src/lib/store.ts); snapshots and backups are tagged with it. */
export function schemaVersion(): number {
  try {
    return (useCrm as unknown as PersistApi).persist.getOptions().version ?? 0;
  } catch {
    return 0;
  }
}

export function pickCollections(state: CrmState): SeedData {
  const out: Record<string, unknown> = {};
  for (const k of COLLECTION_KEYS) out[k] = state[k];
  return out as SeedData;
}

/** True when any synced collection changed identity between two store states. */
export function collectionsChanged(a: CrmState, b: CrmState): boolean {
  return COLLECTION_KEYS.some((k) => a[k] !== b[k]);
}

/** Keep only known collection keys whose value is an array (server data may predate a new collection). */
export function sanitizeCollections(raw: unknown): Partial<SeedData> {
  const out: Record<string, unknown> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const src = raw as Record<string, unknown>;
    for (const k of COLLECTION_KEYS) if (Array.isArray(src[k])) out[k] = src[k];
  }
  return out as Partial<SeedData>;
}

export interface Backup {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  data: SeedData;
}

export function buildBackup(state: CrmState): Backup {
  return { app: BACKUP_APP, version: schemaVersion(), exportedAt: new Date().toISOString(), data: pickCollections(state) };
}

export type BackupCheck = { ok: true; backup: Backup; counts: { key: string; n: number }[] } | { ok: false; error: string };

/** Validate a parsed backup file: right app, same schema version, and every expected collection is an array. */
export function validateBackup(raw: unknown): BackupCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Not a backup file (expected a JSON object)." };
  const b = raw as Partial<Backup> & Record<string, unknown>;
  if (b.app !== BACKUP_APP) return { ok: false, error: `Not a Spectrum CRM backup (app = ${JSON.stringify(b.app ?? null)}).` };
  const current = schemaVersion();
  if (b.version !== current) return { ok: false, error: `Backup was made with data version ${String(b.version)}; this app uses version ${current}. Export a fresh backup from a matching version.` };
  if (!b.data || typeof b.data !== "object" || Array.isArray(b.data)) return { ok: false, error: "Backup has no data object." };
  const data = b.data as Record<string, unknown>;
  const bad = COLLECTION_KEYS.filter((k) => !Array.isArray(data[k]));
  if (bad.length) return { ok: false, error: `Missing or invalid collections: ${bad.join(", ")}.` };
  const clean = sanitizeCollections(data) as SeedData;
  return {
    ok: true,
    backup: { app: BACKUP_APP, version: current, exportedAt: typeof b.exportedAt === "string" ? b.exportedAt : "", data: clean },
    counts: COLLECTION_KEYS.map((k) => ({ key: k, n: (clean[k] as unknown[]).length })),
  };
}

/** "demo:rani@…" / "rani@…" → the workspace user's name when known. */
export function describeActor(updatedBy: string | null | undefined, users: { email: string; name: string }[]): string {
  if (!updatedBy) return "another user";
  if (updatedBy === "anonymous") return "an anonymous user";
  const demo = updatedBy.startsWith("demo:");
  const email = demo ? updatedBy.slice(5) : updatedBy;
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  return `${user?.name ?? email}${demo ? " (demo)" : ""}`;
}

/** Synced collections that hold individual pay or HR status data (same classification the server applies). */
export function restrictedCollectionKeys(): string[] {
  return COLLECTION_KEYS.filter((k) => isRestrictedKey(k));
}

/**
 * Drop the restricted collections from a backup's data (used when the restorer has no full data scope, §13.4):
 * the current local copies are kept instead, and the server would ignore them anyway.
 */
export function withoutRestricted(data: SeedData, current: CrmState): SeedData {
  const out = { ...data } as Record<string, unknown>;
  for (const k of restrictedCollectionKeys()) out[k] = current[k as keyof SeedData];
  return out as SeedData;
}

export interface InventoryRow {
  key: string;
  rows: number;
  bytes: number;
  restricted: boolean;
}

/** Record count and JSON size of every synced collection, largest first. */
export function dataInventory(state: CrmState): InventoryRow[] {
  const enc = new TextEncoder();
  return COLLECTION_KEYS.map((k) => {
    const v = state[k] as unknown;
    return { key: k as string, rows: Array.isArray(v) ? v.length : 0, bytes: enc.encode(JSON.stringify(v ?? [])).byteLength, restricted: isRestrictedKey(k as string) };
  }).sort((a, b) => b.bytes - a.bytes);
}
