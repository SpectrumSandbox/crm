/* Store slice "Platform" — workspace sync status, identity and the data-replacement actions used by the sync engine. */
import type { SeedData } from "../seed";
import type { GetFn, SetFn, Uid } from "./types";

export type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "conflict";

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
}

export interface Identity {
  /** email asserted by Cloudflare Access (null in demo mode) */
  email: string | null;
  source: "access" | "demo";
  /** workspace user matching the Access email, if any */
  userId: string | null;
  /** false until /api/me has been asked */
  resolved: boolean;
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

export const initialSyncInfo: SyncInfo = { status: "idle", lastSyncedAt: null, lastError: null, serverVersion: null, updatedBy: null, updatedAt: null, dirty: false };

export function createPlatformSlice<S extends PlatformSlice & { currentUserId: string }>(set: SetFn<S>, get: GetFn<S>, _uid: Uid): PlatformSlice {
  return {
    sync: initialSyncInfo,
    identity: { email: null, source: "demo", userId: null, resolved: false },

    setSyncInfo: (patch) => {
      const current = get().sync;
      const changed = (Object.keys(patch) as (keyof SyncInfo)[]).some((k) => current[k] !== patch[k]);
      if (changed) set({ sync: { ...current, ...patch } } as Partial<S>);
    },
    setIdentity: (identity) => set({ identity } as Partial<S>),
    replaceWorkspaceData: (data) => set(data as unknown as Partial<S>),
    setCurrentUser: (userId) => {
      if (get().currentUserId !== userId) set({ currentUserId: userId } as Partial<S>);
    },
  };
}
