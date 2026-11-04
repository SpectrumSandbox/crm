"use client";

/**
 * Workspace ⇄ D1 snapshot sync.
 *
 * The whole set of seed collections is one JSON snapshot on the server (GET/PUT /api/workspace) with a
 * monotonically increasing `version`. This browser remembers the version its data is based on
 * ("sg-crm-sync" in localStorage) and whether it has local edits the server hasn't accepted yet (`dirty`).
 *   - load / poll (30 s, visible tab only): newer server version → replace local collections;
 *     no snapshot yet → bootstrap the server from this browser.
 *   - local edit → debounced (1.5 s) PUT with baseVersion; 409 → the server copy wins, toast offers "Keep mine".
 *   - API unreachable / D1 not bound → status "offline", everything keeps working locally, retried on poll.
 * Only one request (GET or PUT) is in flight at a time.
 */

import { seed } from "@/lib/seed";
import { useCrm, useUi, type CrmState } from "@/lib/store";
import { COLLECTION_KEYS, collectionsChanged, describeActor, pickCollections, sanitizeCollections, schemaVersion } from "./collections";
import { actingEmail, rematchIdentity } from "./identity";
import type { SyncInfo } from "../slices/platform";

export const SYNC_META_KEY = "sg-crm-sync";
export const PUSH_DEBOUNCE_MS = 1500;
export const POLL_INTERVAL_MS = 30_000;
export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

interface Meta {
  version: number;
  syncedAt: string | null;
  dirty: boolean;
}

interface Snapshot {
  version: number;
  data: Record<string, unknown> | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

type GetResult = { kind: "ok"; snap: Snapshot } | { kind: "none" } | { kind: "error"; error: string };
type PutResult = { kind: "ok"; version: number; updatedAt: string; updatedBy: string } | { kind: "conflict"; snap: Snapshot } | { kind: "error"; error: string };

type StoreApi = { subscribe(listener: (state: CrmState, prev: CrmState) => void): () => void };

/* ───────────── persisted meta (per browser) ───────────── */

function loadMeta(): Meta {
  try {
    const raw = window.localStorage.getItem(SYNC_META_KEY);
    if (raw) {
      const m = JSON.parse(raw) as Partial<Meta>;
      return { version: typeof m.version === "number" ? m.version : 0, syncedAt: typeof m.syncedAt === "string" ? m.syncedAt : null, dirty: m.dirty === true };
    }
  } catch {
    // unreadable — start fresh
  }
  return { version: 0, syncedAt: null, dirty: false };
}

/* ───────────── engine state (module singleton; one sync loop per tab) ───────────── */

const engine = {
  running: false,
  busy: false,
  queued: false,
  applying: false,
  editSeq: 0,
  /** set when the server holds data from a newer app version — never overwrite it from here */
  blocked: null as string | null,
  meta: { version: 0, syncedAt: null, dirty: false } as Meta,
  debounce: undefined as number | undefined,
  poll: undefined as number | undefined,
  unsub: null as (() => void) | null,
};

function setMeta(patch: Partial<Meta>) {
  engine.meta = { ...engine.meta, ...patch };
  try {
    window.localStorage.setItem(SYNC_META_KEY, JSON.stringify(engine.meta));
  } catch {
    // storage blocked — the in-memory copy still guards this tab
  }
}

function setInfo(patch: Partial<SyncInfo>) {
  useCrm.getState().setSyncInfo(patch);
}

const nowIso = () => new Date().toISOString();

function who(updatedBy: string | null) {
  return describeActor(updatedBy, useCrm.getState().users);
}

function isMine(updatedBy: string | null) {
  if (!updatedBy) return false;
  const { identity } = useCrm.getState();
  if (identity.email && identity.email.toLowerCase() === updatedBy.toLowerCase()) return true;
  const acting = actingEmail();
  return !!acting && updatedBy.toLowerCase() === `demo:${acting.toLowerCase()}`;
}

function remoteSchema(snap: Snapshot) {
  const v = snap.data?.__schema;
  return typeof v === "number" ? v : 0;
}

/* ───────────── HTTP ───────────── */

function errorText(status: number, body: unknown) {
  const b = (body ?? {}) as { error?: unknown; hint?: unknown };
  const msg = typeof b.error === "string" ? b.error : `HTTP ${status}`;
  return typeof b.hint === "string" ? `${msg} — ${b.hint}` : msg;
}

function toSnapshot(body: Record<string, unknown>): Snapshot {
  return {
    version: typeof body.version === "number" ? body.version : 0,
    data: body.data && typeof body.data === "object" && !Array.isArray(body.data) ? (body.data as Record<string, unknown>) : null,
    updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : null,
    updatedBy: typeof body.updatedBy === "string" ? body.updatedBy : null,
  };
}

async function getSnapshot(): Promise<GetResult> {
  try {
    const res = await fetch("/api/workspace", { cache: "no-store", headers: { Accept: "application/json" } });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok && body && typeof body.version === "number") return { kind: "ok", snap: toSnapshot(body) };
    if (res.status === 404 && body?.error === "not_found") return { kind: "none" };
    return { kind: "error", error: errorText(res.status, body) };
  } catch {
    return { kind: "error", error: "Workspace API unreachable" };
  }
}

async function putSnapshot(payload: string): Promise<PutResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  const acting = useCrm.getState().identity.source === "access" ? null : actingEmail();
  if (acting) headers["X-Sg-Acting-As"] = acting;
  try {
    const res = await fetch("/api/workspace", { method: "PUT", cache: "no-store", headers, body: payload });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok && body && typeof body.version === "number") {
      return { kind: "ok", version: body.version, updatedAt: String(body.updatedAt ?? nowIso()), updatedBy: String(body.updatedBy ?? "") };
    }
    if (res.status === 409 && body) return { kind: "conflict", snap: toSnapshot(body) };
    return { kind: "error", error: errorText(res.status, body) };
  } catch {
    return { kind: "error", error: "Workspace API unreachable" };
  }
}

/* ───────────── applying server data ───────────── */

function differsFromSeed(state: CrmState) {
  return COLLECTION_KEYS.some((k) => JSON.stringify(state[k]) !== JSON.stringify(seed[k]));
}

function applyRemote(snap: Snapshot, opts: { toast?: string; keepMine?: boolean; conflict?: string } = {}) {
  const before = pickCollections(useCrm.getState());
  engine.applying = true;
  try {
    useCrm.getState().replaceWorkspaceData(sanitizeCollections(snap.data));
  } finally {
    engine.applying = false;
  }
  const at = nowIso();
  setMeta({ version: snap.version, syncedAt: at, dirty: false });
  setInfo({
    status: opts.conflict ? "conflict" : "synced",
    lastError: opts.conflict ?? null,
    serverVersion: snap.version,
    updatedBy: snap.updatedBy,
    updatedAt: snap.updatedAt,
    lastSyncedAt: at,
    dirty: false,
  });
  rematchIdentity();
  if (opts.toast) {
    useUi.getState().notify(
      opts.toast,
      opts.keepMine
        ? {
            label: "Keep mine",
            run: () => {
              useCrm.getState().replaceWorkspaceData(before);
              void push();
            },
          }
        : undefined,
    );
  }
}

/** Decide what a fetched server snapshot means for this browser. */
async function reconcile(snap: Snapshot, mode: "initial" | "auto" | "reload") {
  const local = schemaVersion();
  const rs = remoteSchema(snap);
  if (rs > local) {
    engine.blocked = "The shared workspace was saved by a newer version of the app — reload the page to update.";
    setInfo({ status: "conflict", lastError: engine.blocked, serverVersion: snap.version, updatedBy: snap.updatedBy, updatedAt: snap.updatedAt });
    return;
  }
  engine.blocked = null;

  if (rs < local) {
    if (mode === "reload") {
      setInfo({ status: "conflict", lastError: `The server snapshot uses data version ${rs}; this app uses ${local}. Overwrite the server from this browser instead.` });
      return;
    }
    // the server copy predates the current data format: upgrade it with this browser's data
    setMeta({ version: snap.version, dirty: true });
    await push();
    return;
  }

  if (mode === "reload") {
    applyRemote(snap, { toast: `Reloaded workspace v${snap.version} from the server` });
    return;
  }

  const meta = engine.meta;
  if (snap.version !== meta.version) {
    if (meta.dirty) {
      applyRemote(snap, {
        toast: `Workspace updated by ${who(snap.updatedBy)} — reloaded`,
        keepMine: true,
        conflict: `Your unsynced changes were replaced by v${snap.version} from ${who(snap.updatedBy)}. Use "Keep mine" in the toast or restore a backup to bring them back.`,
      });
      return;
    }
    if (mode === "initial" && meta.version === 0) {
      // first sync in this browser: protect any local edits made before sync existed
      const hadLocalEdits = differsFromSeed(useCrm.getState());
      applyRemote(snap, { toast: `Loaded the shared workspace (v${snap.version})`, keepMine: hadLocalEdits });
      return;
    }
    applyRemote(snap, { toast: isMine(snap.updatedBy) ? undefined : `Workspace updated by ${who(snap.updatedBy)}` });
    return;
  }

  if (meta.dirty) {
    await push();
    return;
  }
  const at = nowIso();
  setMeta({ syncedAt: at });
  setInfo({ status: "synced", lastError: null, serverVersion: snap.version, updatedBy: snap.updatedBy, updatedAt: snap.updatedAt, lastSyncedAt: at, dirty: false });
}

/* ───────────── pull / push ───────────── */

async function pull(mode: "initial" | "auto" | "reload"): Promise<string | null> {
  if (engine.busy) return "A sync is already in progress — try again in a moment.";
  engine.busy = true;
  // background polls don't flash the indicator
  if (mode !== "auto") setInfo({ status: "syncing" });
  const res = await getSnapshot();
  engine.busy = false;

  if (res.kind === "error") {
    setInfo({ status: "offline", lastError: res.error });
    return res.error;
  }
  if (res.kind === "none") {
    if (mode === "reload") {
      setInfo({ status: "synced", lastError: null, serverVersion: null });
      return "The server has no workspace snapshot yet.";
    }
    // nothing shared yet: bootstrap the server from this browser
    setMeta({ version: 0, dirty: true });
    await push();
    return null;
  }
  await reconcile(res.snap, mode);
  return null;
}

function schedulePush() {
  if (!engine.running) return;
  if (engine.debounce !== undefined) window.clearTimeout(engine.debounce);
  engine.debounce = window.setTimeout(() => {
    engine.debounce = undefined;
    void push();
  }, PUSH_DEBOUNCE_MS);
}

async function push(retried = false): Promise<string | null> {
  if (engine.blocked) {
    setInfo({ status: "conflict", lastError: engine.blocked });
    return engine.blocked;
  }
  if (engine.busy) {
    engine.queued = true;
    return null;
  }
  if (engine.debounce !== undefined) {
    window.clearTimeout(engine.debounce);
    engine.debounce = undefined;
  }

  const seq = engine.editSeq;
  const baseVersion = engine.meta.version;
  const payload = JSON.stringify({ baseVersion, data: { ...pickCollections(useCrm.getState()), __schema: schemaVersion() } });
  if (new TextEncoder().encode(payload).byteLength > MAX_SNAPSHOT_BYTES) {
    const error = "Workspace data is larger than 4 MB — not synced. Download a backup and trim old records.";
    setInfo({ status: "offline", lastError: error, dirty: true });
    return error;
  }

  engine.busy = true;
  setInfo({ status: "syncing" });
  const res = await putSnapshot(payload);
  engine.busy = false;
  const queued = engine.queued;
  engine.queued = false;

  if (res.kind === "ok") {
    const stillDirty = engine.editSeq !== seq;
    setMeta({ version: res.version, syncedAt: nowIso(), dirty: stillDirty });
    setInfo({ status: "synced", lastError: null, serverVersion: res.version, updatedBy: res.updatedBy, updatedAt: res.updatedAt, lastSyncedAt: engine.meta.syncedAt, dirty: stillDirty });
    if (stillDirty || queued) schedulePush();
    return null;
  }
  if (res.kind === "conflict") {
    if (res.snap.data === null) {
      if (retried) {
        const error = "The server rejected the snapshot twice — try Sync now again shortly.";
        setInfo({ status: "offline", lastError: error, dirty: true });
        return error;
      }
      // the server lost its snapshot (D1 reset): re-create it from this browser
      setMeta({ version: 0 });
      return push(true);
    }
    await reconcile(res.snap, "auto");
    return null;
  }
  setInfo({ status: "offline", lastError: res.error, dirty: true });
  return res.error;
}

/* ───────────── loop ───────────── */

function tick() {
  if (!engine.running || engine.busy || engine.debounce !== undefined) return;
  if (document.visibilityState !== "visible") return;
  void (engine.meta.dirty ? push() : pull("auto"));
}

function onVisible() {
  if (document.visibilityState === "visible") tick();
}

/** Start syncing (idempotent). Returns the stop function. Call after the store has hydrated. */
export function startSync(): () => void {
  if (engine.running) return stopSync;
  engine.running = true;
  engine.meta = loadMeta();
  setInfo({ status: "syncing", dirty: engine.meta.dirty, serverVersion: engine.meta.version || null, lastSyncedAt: engine.meta.syncedAt });

  engine.unsub = (useCrm as unknown as StoreApi).subscribe((state, prev) => {
    if (engine.applying || !collectionsChanged(state, prev)) return;
    engine.editSeq += 1;
    if (!engine.meta.dirty) {
      setMeta({ dirty: true });
      setInfo({ dirty: true });
    }
    schedulePush();
  });
  engine.poll = window.setInterval(tick, POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onVisible);
  void pull("initial");
  return stopSync;
}

export function stopSync() {
  engine.running = false;
  engine.unsub?.();
  engine.unsub = null;
  if (engine.poll !== undefined) window.clearInterval(engine.poll);
  engine.poll = undefined;
  if (engine.debounce !== undefined) window.clearTimeout(engine.debounce);
  engine.debounce = undefined;
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("online", onVisible);
}

/** Push pending edits, or check the server for newer data. Resolves to an error message or null. */
export function syncNow(): Promise<string | null> {
  return engine.meta.dirty || engine.debounce !== undefined ? push() : pull("auto");
}

/** Replace the server snapshot with this browser's data (regardless of what changed there). */
export async function overwriteServer(): Promise<string | null> {
  if (engine.busy) return "A sync is already in progress — try again in a moment.";
  engine.busy = true;
  const res = await getSnapshot();
  engine.busy = false;
  if (res.kind === "error") {
    setInfo({ status: "offline", lastError: res.error });
    return res.error;
  }
  if (res.kind === "ok" && remoteSchema(res.snap) > schemaVersion()) {
    engine.blocked = "The shared workspace was saved by a newer version of the app — reload the page to update.";
    setInfo({ status: "conflict", lastError: engine.blocked });
    return engine.blocked;
  }
  engine.blocked = null;
  setMeta({ version: res.kind === "ok" ? res.snap.version : 0, dirty: true });
  return push();
}

/** Discard local data and load the server snapshot. */
export function reloadFromServer(): Promise<string | null> {
  if (engine.debounce !== undefined) {
    window.clearTimeout(engine.debounce);
    engine.debounce = undefined;
  }
  return pull("reload");
}

/** The version this browser's data is based on (from "sg-crm-sync"). */
export function localSyncedVersion(): number {
  return engine.meta.version;
}
