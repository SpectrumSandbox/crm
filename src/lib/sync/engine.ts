"use client";

/**
 * Workspace ⇄ D1 snapshot sync.
 *
 * The whole set of seed collections is one JSON snapshot on the server (GET/PUT /api/workspace) with a
 * monotonically increasing `version`. This browser remembers the version its data is based on
 * ("sg-crm-sync" in localStorage) and whether it has local edits the server hasn't accepted yet (`dirty`).
 *   - load / poll (30 s, visible tab only): newer server version → replace local collections;
 *     no snapshot yet → bootstrap the server from this browser.
 *   - local edit → debounced (1.5 s) PUT with baseVersion; 409 → record-level three-way merge with the newer server
 *     copy (theirs kept where both changed the same record), then push the merge.
 *   - API unreachable / D1 not bound → status "offline", exponential back-off (30 s → 10 min), local work continues.
 *   - 401/403 sign-in errors → status "locked": no polling or pushing (retry every 10 min or on "Sync now").
 *   - The server redacts other people's pay data for viewers without a pay role (scope "own", §13.4); the engine
 *     replaces those collections locally so a former full copy never lingers in localStorage.
 * Only one request (GET or PUT) is in flight at a time.
 */

import { seed } from "@/lib/seed";
import { useCrm, useUi, type CrmState } from "@/lib/store";
import { COLLECTION_KEYS, collectionsChanged, describeActor, pickCollections, sanitizeCollections, schemaVersion } from "./collections";
import { actingEmail, noteLocked, noteServerAccess, rematchIdentity, resolveIdentity } from "./identity";
import { threeWayMerge } from "./merge";
import type { DataScope, SyncInfo } from "../slices/platform";

export const SYNC_META_KEY = "sg-crm-sync";
export const PUSH_DEBOUNCE_MS = 1500;
export const POLL_INTERVAL_MS = 30_000;
/** The server accepts 4 MB bodies, but D1 stores one snapshot per row and caps a row at ~2 MB. */
export const MAX_SNAPSHOT_BYTES = 1_900_000;
export const SNAPSHOT_WARN_BYTES = 1_500_000;
const BACKOFF_MAX_MS = 10 * 60_000;
const LOCKED_RETRY_MS = 10 * 60_000;
/** server error codes that mean "this browser may not use the shared workspace" */
const LOCK_CODES = new Set(["access_not_configured", "sign_in_required", "invalid_access_token"]);

export type WriteReason = "edit" | "bootstrap" | "upgrade" | "overwrite" | "restore" | "reset" | "merge";

interface Meta {
  version: number;
  syncedAt: string | null;
  dirty: boolean;
  /** data scope the local copy was last synced under */
  scope: DataScope | null;
}

interface AccessHint {
  scope: DataScope | null;
  restricted: string[];
  roles?: string[];
  admin?: boolean;
}

interface Snapshot {
  version: number;
  data: Record<string, unknown> | null;
  updatedAt: string | null;
  updatedBy: string | null;
  access: AccessHint | null;
}

type Failure = { kind: "error"; error: string } | { kind: "locked"; error: string; hint: string | null };
type GetResult = { kind: "ok"; snap: Snapshot } | { kind: "none" } | Failure;
type PutResult = { kind: "ok"; version: number; updatedAt: string; updatedBy: string; protectedKeys: string[]; scope: DataScope | null } | { kind: "conflict"; snap: Snapshot } | Failure;

type StoreApi = { subscribe(listener: (state: CrmState, prev: CrmState) => void): () => void };

/* ───────────── persisted meta (per browser) ───────────── */

function loadMeta(): Meta {
  try {
    const raw = window.localStorage.getItem(SYNC_META_KEY);
    if (raw) {
      const m = JSON.parse(raw) as Partial<Meta>;
      return {
        version: typeof m.version === "number" ? m.version : 0,
        syncedAt: typeof m.syncedAt === "string" ? m.syncedAt : null,
        dirty: m.dirty === true,
        scope: m.scope === "full" || m.scope === "own" ? m.scope : null,
      };
    }
  } catch {
    // unreadable — start fresh
  }
  return { version: 0, syncedAt: null, dirty: false, scope: null };
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
  /** the server refused this browser (sign-in) — stay quiet until retryAt or a manual sync */
  locked: false,
  failures: 0,
  retryAt: 0,
  /** why the next push happens (sent as X-Sg-Write-Reason and kept in the server audit trail) */
  reason: "edit" as WriteReason,
  /** the server kept its own copy of something on the last write: take the server data on the next pull */
  forceApply: false,
  /** server data this browser last synced with (in memory) — the base of three-way merges */
  base: null as { version: number; data: Record<string, unknown> } | null,
  meta: { version: 0, syncedAt: null, dirty: false, scope: null } as Meta,
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

/* ───────────── failure handling: back-off and lock ───────────── */

function succeeded() {
  engine.failures = 0;
  engine.retryAt = 0;
  engine.locked = false;
  setInfo({ nextRetryAt: null });
  // the server let us in again after a lock: refresh who we are (roles, scope)
  if (useCrm.getState().identity.mode === "locked") void resolveIdentity();
}

function failed(res: Failure, dirty?: boolean) {
  if (res.kind === "locked") {
    engine.locked = true;
    engine.retryAt = Date.now() + LOCKED_RETRY_MS;
    noteLocked(res.error, res.hint);
    setInfo({ status: "locked", lastError: res.hint ?? res.error, nextRetryAt: new Date(engine.retryAt).toISOString(), ...(dirty === undefined ? {} : { dirty }) });
    return;
  }
  engine.failures += 1;
  const delay = Math.min(BACKOFF_MAX_MS, POLL_INTERVAL_MS * 2 ** Math.max(0, engine.failures - 1));
  engine.retryAt = Date.now() + delay;
  setInfo({ status: "offline", lastError: res.error, nextRetryAt: new Date(engine.retryAt).toISOString(), ...(dirty === undefined ? {} : { dirty }) });
}

/* ───────────── HTTP ───────────── */

function failureOf(status: number, body: unknown): Failure {
  const b = (body ?? {}) as { error?: unknown; hint?: unknown };
  const code = typeof b.error === "string" ? b.error : `HTTP ${status}`;
  const hint = typeof b.hint === "string" ? b.hint : null;
  if ((status === 401 || status === 403) && LOCK_CODES.has(code)) return { kind: "locked", error: code, hint };
  return { kind: "error", error: hint ? `${code} — ${hint}` : code };
}

function toAccess(raw: unknown): AccessHint | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as { scope?: unknown; restricted?: unknown; roles?: unknown; admin?: unknown };
  return {
    scope: a.scope === "full" || a.scope === "own" ? a.scope : null,
    restricted: Array.isArray(a.restricted) ? a.restricted.filter((k): k is string => typeof k === "string") : [],
    roles: Array.isArray(a.roles) ? a.roles.filter((k): k is string => typeof k === "string") : undefined,
    admin: typeof a.admin === "boolean" ? a.admin : undefined,
  };
}

function toSnapshot(body: Record<string, unknown>): Snapshot {
  return {
    version: typeof body.version === "number" ? body.version : 0,
    data: body.data && typeof body.data === "object" && !Array.isArray(body.data) ? (body.data as Record<string, unknown>) : null,
    updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : null,
    updatedBy: typeof body.updatedBy === "string" ? body.updatedBy : null,
    access: toAccess(body.access),
  };
}

function headers(json: boolean): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (json) h["Content-Type"] = "application/json";
  const acting = useCrm.getState().identity.source === "access" ? null : actingEmail();
  if (acting) h["X-Sg-Acting-As"] = acting;
  return h;
}

async function getSnapshot(): Promise<GetResult> {
  try {
    const res = await fetch("/api/workspace", { cache: "no-store", headers: headers(false) });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok && body && typeof body.version === "number") return { kind: "ok", snap: toSnapshot(body) };
    if (res.status === 404 && body?.error === "not_found") return { kind: "none" };
    return failureOf(res.status, body);
  } catch {
    return { kind: "error", error: "Workspace API unreachable" };
  }
}

async function putSnapshot(payload: string, reason: WriteReason): Promise<PutResult> {
  const h = headers(true);
  h["X-Sg-Write-Reason"] = reason;
  try {
    const res = await fetch("/api/workspace", { method: "PUT", cache: "no-store", headers: h, body: payload });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok && body && typeof body.version === "number") {
      return {
        kind: "ok",
        version: body.version,
        updatedAt: String(body.updatedAt ?? nowIso()),
        updatedBy: String(body.updatedBy ?? ""),
        protectedKeys: Array.isArray(body.protected) ? body.protected.filter((k): k is string => typeof k === "string") : [],
        scope: body.scope === "full" || body.scope === "own" ? body.scope : null,
      };
    }
    if (res.status === 409 && body) return { kind: "conflict", snap: toSnapshot(body) };
    return failureOf(res.status, body);
  } catch {
    return { kind: "error", error: "Workspace API unreachable" };
  }
}

/* ───────────── applying server data ───────────── */

function differsFromSeed(state: CrmState) {
  return COLLECTION_KEYS.some((k) => JSON.stringify(state[k]) !== JSON.stringify(seed[k]));
}

function rememberBase(version: number, data: Record<string, unknown> | null) {
  engine.base = data ? { version, data } : null;
}

function noteAccess(snap: Snapshot) {
  if (!snap.access) return;
  setInfo({ scope: snap.access.scope, restricted: snap.access.restricted });
  noteServerAccess({ scope: snap.access.scope, roles: snap.access.roles, admin: snap.access.admin });
}

function applyRemote(snap: Snapshot, opts: { toast?: string; keepMine?: boolean; conflict?: string } = {}) {
  engine.forceApply = false;
  const before = pickCollections(useCrm.getState());
  engine.applying = true;
  try {
    useCrm.getState().replaceWorkspaceData(sanitizeCollections(snap.data));
  } finally {
    engine.applying = false;
  }
  rememberBase(snap.version, snap.data);
  const at = nowIso();
  setMeta({ version: snap.version, syncedAt: at, dirty: false, scope: snap.access?.scope ?? engine.meta.scope });
  setInfo({
    status: opts.conflict ? "conflict" : "synced",
    lastError: opts.conflict ?? null,
    serverVersion: snap.version,
    updatedBy: snap.updatedBy,
    updatedAt: snap.updatedAt,
    lastSyncedAt: at,
    dirty: false,
  });
  noteAccess(snap);
  rematchIdentity();
  if (opts.toast) {
    useUi.getState().notify(
      opts.toast,
      opts.keepMine
        ? {
            label: "Keep mine",
            run: () => {
              useCrm.getState().replaceWorkspaceData(before);
              engine.reason = "overwrite";
              void push();
            },
          }
        : undefined,
    );
  }
}

/**
 * Scope "own": make sure the redacted collections in this browser are exactly the server's redacted copy, even when the
 * versions match (a full copy from an earlier session or the demo seed must not stay in localStorage).
 */
function enforceRedaction(snap: Snapshot): boolean {
  const keys = snap.access?.scope === "own" ? snap.access.restricted : [];
  if (!keys.length || !snap.data) return false;
  const state = useCrm.getState() as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of keys) {
    if (!(COLLECTION_KEYS as string[]).includes(k)) continue;
    const remote = snap.data[k];
    if (Array.isArray(remote) && JSON.stringify(state[k]) !== JSON.stringify(remote)) patch[k] = remote;
  }
  if (!Object.keys(patch).length) return false;
  engine.applying = true;
  try {
    useCrm.getState().replaceWorkspaceData(patch);
  } finally {
    engine.applying = false;
  }
  return true;
}

/** Re-apply local edits on top of a newer server copy (record by record), then push the merge. */
async function mergeAndPush(snap: Snapshot): Promise<boolean> {
  if (!engine.base || !snap.data) return false;
  const local = pickCollections(useCrm.getState()) as unknown as Record<string, unknown>;
  const outcome = threeWayMerge(engine.base.data, local, snap.data);
  engine.applying = true;
  try {
    useCrm.getState().replaceWorkspaceData(sanitizeCollections(outcome.data));
  } finally {
    engine.applying = false;
  }
  rememberBase(snap.version, snap.data);
  setMeta({ version: snap.version, dirty: true, scope: snap.access?.scope ?? engine.meta.scope });
  noteAccess(snap);
  rematchIdentity();
  const at = nowIso();
  setInfo({ serverVersion: snap.version, updatedBy: snap.updatedBy, updatedAt: snap.updatedAt, lastMerge: { at, merged: outcome.merged, conflicts: outcome.conflicts, version: snap.version } });
  useUi
    .getState()
    .notify(
      outcome.conflicts
        ? `Merged your changes with v${snap.version} from ${who(snap.updatedBy)} — ${outcome.conflicts} record${outcome.conflicts === 1 ? "" : "s"} changed on both sides kept their version`
        : `Merged your changes with v${snap.version} from ${who(snap.updatedBy)}`,
    );
  engine.reason = "merge";
  await push();
  return true;
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
    engine.reason = "upgrade";
    await push();
    return;
  }

  if (mode === "reload") {
    applyRemote(snap, { toast: `Reloaded workspace v${snap.version} from the server` });
    return;
  }

  const meta = engine.meta;
  const scope = snap.access?.scope ?? null;
  if (snap.version !== meta.version) {
    if (meta.dirty) {
      if (await mergeAndPush(snap)) return;
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

  // the server protected part of our last write (roles, emails, approvals…): show what it actually stored
  if (engine.forceApply && !meta.dirty) {
    engine.forceApply = false;
    applyRemote(snap);
    return;
  }
  // same version: a scope change (e.g. a new pay role) needs the server's copy of the restricted collections
  if (!meta.dirty && scope && meta.scope && scope !== meta.scope) {
    applyRemote(snap, { toast: scope === "full" ? "Your role now includes pay data — loaded the full workspace" : "Pay data of other people removed from this browser (§13.4)" });
    return;
  }
  if (!engine.base) rememberBase(snap.version, snap.data);
  const purged = enforceRedaction(snap);
  noteAccess(snap);
  if (scope && scope !== meta.scope) setMeta({ scope });
  if (meta.dirty) {
    await push();
    return;
  }
  const at = nowIso();
  setMeta({ syncedAt: at });
  setInfo({ status: "synced", lastError: null, serverVersion: snap.version, updatedBy: snap.updatedBy, updatedAt: snap.updatedAt, lastSyncedAt: at, dirty: false });
  if (purged && mode === "initial") useUi.getState().notify("Other people's pay data is not kept in this browser (§13.4)");
}

/* ───────────── pull / push ───────────── */

async function pull(mode: "initial" | "auto" | "reload"): Promise<string | null> {
  if (engine.busy) return "A sync is already in progress — try again in a moment.";
  engine.busy = true;
  // background polls don't flash the indicator
  if (mode !== "auto") setInfo({ status: "syncing" });
  const res = await getSnapshot();
  engine.busy = false;

  if (res.kind === "error" || res.kind === "locked") {
    failed(res);
    return res.kind === "locked" ? res.hint ?? res.error : res.error;
  }
  succeeded();
  if (res.kind === "none") {
    if (mode === "reload") {
      setInfo({ status: "synced", lastError: null, serverVersion: null });
      return "The server has no workspace snapshot yet.";
    }
    // nothing shared yet: bootstrap the server from this browser
    setMeta({ version: 0, dirty: true });
    engine.reason = "bootstrap";
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
    // stay quiet while locked or backing off — the edit is kept (dirty) and goes out on the next attempt
    if (engine.locked || Date.now() < engine.retryAt) return;
    void push();
  }, PUSH_DEBOUNCE_MS);
}

/** Size of the JSON this browser would push (bytes). */
export function snapshotBytes(): number {
  return new TextEncoder().encode(JSON.stringify({ baseVersion: engine.meta.version, data: { ...pickCollections(useCrm.getState()), __schema: schemaVersion() } })).byteLength;
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
  const collections = { ...pickCollections(useCrm.getState()), __schema: schemaVersion() } as Record<string, unknown>;
  const payload = JSON.stringify({ baseVersion, data: collections });
  if (new TextEncoder().encode(payload).byteLength > MAX_SNAPSHOT_BYTES) {
    const error = "Workspace data is larger than D1's ~2 MB row limit — not synced. Settings › Data inventory shows the largest collections; trim old records.";
    setInfo({ status: "offline", lastError: error, dirty: true });
    return error;
  }

  const reason = engine.reason;
  engine.busy = true;
  setInfo({ status: "syncing" });
  const res = await putSnapshot(payload, reason);
  engine.busy = false;
  const queued = engine.queued;
  engine.queued = false;

  if (res.kind === "ok") {
    succeeded();
    engine.reason = "edit";
    const stillDirty = engine.editSeq !== seq;
    rememberBase(res.version, collections);
    setMeta({ version: res.version, syncedAt: nowIso(), dirty: stillDirty, scope: res.scope ?? engine.meta.scope });
    setInfo({
      status: "synced",
      lastError: null,
      serverVersion: res.version,
      updatedBy: res.updatedBy,
      updatedAt: res.updatedAt,
      lastSyncedAt: engine.meta.syncedAt,
      dirty: stillDirty,
      protectedKeys: res.protectedKeys,
      ...(res.scope ? { scope: res.scope } : {}),
    });
    if (stillDirty || queued) schedulePush();
    else {
      const redacted = new Set(useCrm.getState().sync.restricted ?? []);
      if (res.protectedKeys.some((k) => !redacted.has(k.split(/[ .]/)[0]))) {
        engine.forceApply = true;
        void pull("auto");
      }
    }
    return null;
  }
  if (res.kind === "conflict") {
    succeeded();
    if (res.snap.data === null) {
      if (retried) {
        const error = "The server rejected the snapshot twice — try Sync now again shortly.";
        setInfo({ status: "offline", lastError: error, dirty: true });
        return error;
      }
      // the server lost its snapshot (D1 reset): re-create it from this browser
      setMeta({ version: 0 });
      engine.reason = "bootstrap";
      return push(true);
    }
    await reconcile(res.snap, "auto");
    return null;
  }
  failed(res, true);
  return res.kind === "locked" ? res.hint ?? res.error : res.error;
}

/* ───────────── loop ───────────── */

function tick() {
  if (!engine.running || engine.busy || engine.debounce !== undefined) return;
  if (document.visibilityState !== "visible") return;
  if (Date.now() < engine.retryAt) return;
  void (engine.meta.dirty ? push() : pull("auto"));
}

function onVisible() {
  if (document.visibilityState !== "visible") return;
  // coming back to the tab after an outage: try again now instead of waiting out the back-off (not when locked)
  if (!engine.locked) engine.retryAt = 0;
  tick();
}

/** Start syncing (idempotent). Returns the stop function. Call after the store has hydrated. */
export function startSync(): () => void {
  if (engine.running) return stopSync;
  engine.running = true;
  engine.meta = loadMeta();
  setInfo({ status: "syncing", dirty: engine.meta.dirty, serverVersion: engine.meta.version || null, lastSyncedAt: engine.meta.syncedAt, scope: engine.meta.scope });

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

  const { identity } = useCrm.getState();
  if (identity.mode === "locked") {
    // /api/me already said no: don't ask the workspace API until the retry time or a manual sync
    failed({ kind: "locked", error: identity.lockReason ?? "locked", hint: identity.lockHint ?? null });
  } else if (identity.mode === "offline") {
    failed({ kind: "error", error: "Workspace API unavailable (no server runtime) — working locally" });
  } else {
    void pull("initial");
  }
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

/** Push pending edits, or check the server for newer data. Clears a lock / back-off. Resolves to an error message or null. */
export function syncNow(): Promise<string | null> {
  engine.locked = false;
  engine.retryAt = 0;
  return engine.meta.dirty || engine.debounce !== undefined ? push() : pull(engine.meta.version ? "auto" : "initial");
}

/** Label the next push (restore / reset) for the server audit trail and send it right away. */
export function pushNow(reason: WriteReason): Promise<string | null> {
  engine.reason = reason;
  if (!engine.running) return Promise.resolve(null);
  if (engine.locked) return Promise.resolve("The shared workspace is locked for this browser — the change stays on this device.");
  return push();
}

/** Replace the server snapshot with this browser's data (regardless of what changed there). */
export async function overwriteServer(): Promise<string | null> {
  if (engine.busy) return "A sync is already in progress — try again in a moment.";
  engine.busy = true;
  const res = await getSnapshot();
  engine.busy = false;
  if (res.kind === "error" || res.kind === "locked") {
    failed(res);
    return res.kind === "locked" ? res.hint ?? res.error : res.error;
  }
  succeeded();
  if (res.kind === "ok" && remoteSchema(res.snap) > schemaVersion()) {
    engine.blocked = "The shared workspace was saved by a newer version of the app — reload the page to update.";
    setInfo({ status: "conflict", lastError: engine.blocked });
    return engine.blocked;
  }
  engine.blocked = null;
  setMeta({ version: res.kind === "ok" ? res.snap.version : 0, dirty: true });
  engine.reason = "overwrite";
  return push();
}

/** Discard local data and load the server snapshot. */
export function reloadFromServer(): Promise<string | null> {
  if (engine.debounce !== undefined) {
    window.clearTimeout(engine.debounce);
    engine.debounce = undefined;
  }
  engine.locked = false;
  engine.retryAt = 0;
  return pull("reload");
}

/** The version this browser's data is based on (from "sg-crm-sync"). */
export function localSyncedVersion(): number {
  return engine.meta.version;
}
