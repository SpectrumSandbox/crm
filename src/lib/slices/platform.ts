/* Store slice "Platform" — workspace sync status, identity and the data-replacement actions used by the sync engine. */
import type { SeedData } from "../seed";
import type { GetFn, SetFn, Uid } from "./types";

/** "locked" = the server refused this browser (no Cloudflare Access sign-in / not configured): local-only, no polling. */
export type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "conflict" | "locked";

/** Data scope the server granted: "full" = all pay data (pay roles), "own" = only the viewer's own pay lines (§13.4). */
export type DataScope = "full" | "own";

export interface SyncInfo {
  status: SyncStatus;
  /** ISO time of the last successful GET/PUT round-trip */
  lastSyncedAt: string | null;
  lastError: string | null;
  /** version of the server snapshot this browser last saw (null = unknown / none) */
  serverVersion: number | null;
  /** author of the server snapshot ("email", "demo:email" or "anonymous") */
  updatedBy: string | null;
  updatedAt: string | null;
  /** local changes not yet accepted by the server */
  dirty: boolean;
  /** data scope of the last server response (null = not known yet / offline) */
  scope?: DataScope | null;
  /** collections the server redacted for this viewer */
  restricted?: string[];
  /** collections/fields the server kept from its own copy on the last write (protected data) */
  protectedKeys?: string[];
  /** when the engine will try the server again after errors / a lock (ISO) */
  nextRetryAt?: string | null;
  /** records merged on the last conflict (theirs kept where both sides changed the same record) */
  lastMerge?: { at: string; merged: number; conflicts: number; version: number } | null;
}

export interface Identity {
  /** email asserted by Cloudflare Access (null in demo mode) */
  email: string | null;
  source: "access" | "demo";
  /** workspace user matching the Access email, if any */
  userId: string | null;
  /** false until /api/me has been asked */
  resolved: boolean;
  /** how the server sees this browser: verified Access user, local dev, anonymous demo, locked, or no server at all */
  mode?: "access" | "development" | "anonymous-allowed" | "locked" | "offline";
  /** server-resolved governance roles (from the stored HR record) */
  roles?: string[];
  scope?: DataScope | null;
  /** workspace admin according to the server (CEO/CFO or WORKSPACE_ADMINS) */
  admin?: boolean;
  /** why the server locked this browser out, and what fixes it */
  lockReason?: string | null;
  lockHint?: string | null;
}

export interface PlatformSlice {
  sync: SyncInfo;
  identity: Identity;
  setSyncInfo: (patch: Partial<SyncInfo>) => void;
  setIdentity: (identity: Identity) => void;
  /** Replace persisted collections wholesale (server snapshot, backup restore, undo). Unknown keys are the caller's job to strip. */
  replaceWorkspaceData: (data: Partial<SeedData>) => void;
  /** Switch who the app acts as (Access identity or the demo "acting as" menu). */
  setCurrentUser: (userId: string) => void;
}

export const initialSyncInfo: SyncInfo = {
  status: "idle",
  lastSyncedAt: null,
  lastError: null,
  serverVersion: null,
  updatedBy: null,
  updatedAt: null,
  dirty: false,
  scope: null,
  restricted: [],
  protectedKeys: [],
  nextRetryAt: null,
  lastMerge: null,
};

export function createPlatformSlice<S extends PlatformSlice & { currentUserId: string }>(set: SetFn<S>, get: GetFn<S>, _uid: Uid): PlatformSlice {
  return {
    sync: initialSyncInfo,
    identity: { email: null, source: "demo", userId: null, resolved: false },

    setSyncInfo: (patch) => {
      const current = get().sync;
      const changed = (Object.keys(patch) as (keyof SyncInfo)[]).some((k) => JSON.stringify(current[k]) !== JSON.stringify(patch[k]));
      if (changed) set({ sync: { ...current, ...patch } } as Partial<S>);
    },
    setIdentity: (identity) => {
      if (JSON.stringify(get().identity) !== JSON.stringify(identity)) set({ identity } as Partial<S>);
    },
    replaceWorkspaceData: (data) => set(data as unknown as Partial<S>),
    setCurrentUser: (userId) => {
      if (get().currentUserId !== userId) set({ currentUserId: userId } as Partial<S>);
    },
  };
}
