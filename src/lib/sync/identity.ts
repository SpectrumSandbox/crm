"use client";

import { useCrm } from "@/lib/store";
import type { DataScope, Identity } from "@/lib/slices/platform";

/** localStorage key for the demo-mode "acting as" choice. */
export const ACTING_AS_KEY = "sg-crm-acting-as";
/**
 * currentUserId of a person Cloudflare Access signed in who has no workspace user record. It matches no user and no HR
 * record, so the app grants no roles (useAccess() → nothing) and nobody can be impersonated.
 */
export const GUEST_USER_ID = "u-guest";

function readActingAs(): string | null {
  try {
    return window.localStorage.getItem(ACTING_AS_KEY);
  } catch {
    return null;
  }
}

function matchUser(email: string | null): string | null {
  if (!email) return null;
  const e = email.toLowerCase();
  return useCrm.getState().users.find((u) => u.email.toLowerCase() === e)?.id ?? null;
}

/**
 * True when the viewer may pick who to act as: demo / local dev only. A verified Cloudflare Access identity can never
 * act as someone else — not even when no workspace user matches its email (qa-finance #4).
 */
export function canActAs(identity: Pick<Identity, "source"> & Partial<Identity>): boolean {
  return identity.source !== "access";
}

/** Signed in through Access, but no workspace user has that email. */
export function isUnmatched(identity: Identity): boolean {
  return identity.source === "access" && identity.resolved && !identity.userId;
}

interface MeResponse {
  email?: unknown;
  authenticated?: unknown;
  workspace?: unknown;
  mode?: unknown;
  reason?: unknown;
  hint?: unknown;
  access?: { userId?: unknown; roles?: unknown; scope?: unknown; admin?: unknown } | null;
}

const MODES = ["access", "development", "anonymous-allowed", "locked", "offline"] as const;

/**
 * Ask /api/me who Cloudflare Access says this is (resolved on the server against the stored HR records).
 * A matching workspace user becomes currentUserId; an unmatched Access user becomes the no-privilege guest;
 * demo mode restores the saved "acting as" choice.
 */
export async function resolveIdentity(): Promise<void> {
  let email: string | null = null;
  let extra: Partial<Identity> = { mode: "offline" };
  let serverUserId: string | null = null;
  try {
    const res = await fetch("/api/me", { cache: "no-store", headers: { Accept: "application/json" } });
    if (res.ok) {
      const body = (await res.json()) as MeResponse;
      if (body.authenticated === true && typeof body.email === "string") email = body.email;
      const mode = (MODES as readonly string[]).includes(String(body.mode)) ? (body.mode as Identity["mode"]) : body.workspace === "locked" ? "locked" : "offline";
      const a = body.access ?? null;
      serverUserId = a && typeof a.userId === "string" ? a.userId : null;
      extra = {
        mode,
        roles: a && Array.isArray(a.roles) ? a.roles.filter((r): r is string => typeof r === "string") : undefined,
        scope: a && (a.scope === "full" || a.scope === "own") ? (a.scope as DataScope) : null,
        admin: a ? a.admin === true : undefined,
        lockReason: body.workspace === "locked" && typeof body.reason === "string" ? body.reason : null,
        lockHint: body.workspace === "locked" && typeof body.hint === "string" ? body.hint : null,
      };
    }
  } catch {
    // offline / no API — demo mode
  }
  applyIdentity(email, extra, serverUserId);
}

function applyIdentity(email: string | null, extra: Partial<Identity>, serverUserId: string | null = null) {
  const st = useCrm.getState();
  const local = matchUser(email);
  // the server's match wins when it names a user this browser knows; otherwise use the local match
  const userId = serverUserId && st.users.some((u) => u.id === serverUserId) ? serverUserId : local;
  st.setIdentity({ ...st.identity, ...extra, email, source: email ? "access" : "demo", userId, resolved: true });
  if (email) {
    // verified identity: never fall back to a saved "acting as" choice or the default user
    st.setCurrentUser(userId ?? GUEST_USER_ID);
    return;
  }
  const saved = readActingAs();
  if (saved && st.users.some((u) => u.id === saved)) st.setCurrentUser(saved);
}

/** Re-match after the users collection was replaced (e.g. a server snapshot arrived). */
export function rematchIdentity() {
  const { identity } = useCrm.getState();
  if (identity.resolved) applyIdentity(identity.email, {});
}

/** Update the server-reported access (scope/roles/admin) without re-asking /api/me. */
export function noteServerAccess(access: { scope?: DataScope | null; roles?: string[]; admin?: boolean }) {
  const st = useCrm.getState();
  const next: Identity = { ...st.identity };
  if (access.scope !== undefined) next.scope = access.scope;
  if (access.roles) next.roles = access.roles;
  if (access.admin !== undefined) next.admin = access.admin;
  st.setIdentity(next);
}

/** Record that the server locked this browser out (sign-in required / Access not configured). */
export function noteLocked(reason: string | null, hint: string | null) {
  const st = useCrm.getState();
  st.setIdentity({ ...st.identity, mode: "locked", lockReason: reason, lockHint: hint });
}

/** Demo mode: act as another workspace user and remember the choice for the next visit. No-op for Access users. */
export function actAs(userId: string) {
  const st = useCrm.getState();
  if (!canActAs(st.identity)) return;
  if (!st.users.some((u) => u.id === userId)) return;
  try {
    window.localStorage.setItem(ACTING_AS_KEY, userId);
  } catch {
    // storage blocked — the switch still applies for this session
  }
  st.setCurrentUser(userId);
}

/** Email the browser reports in demo mode (sent as X-Sg-Acting-As so the server can label writes). */
export function actingEmail(): string | null {
  const st = useCrm.getState();
  return st.users.find((u) => u.id === st.currentUserId)?.email ?? null;
}
