"use client";

import { useCrm } from "@/lib/store";

/** localStorage key for the demo-mode "acting as" choice. */
export const ACTING_AS_KEY = "sg-crm-acting-as";

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

/** True when the app must let the viewer pick who to act as (no Access identity mapped to a workspace user). */
export function canActAs(identity: { source: "access" | "demo"; userId: string | null }): boolean {
  return identity.source !== "access" || !identity.userId;
}

/**
 * Ask /api/me who Cloudflare Access says this is. A matching workspace user becomes currentUserId;
 * otherwise (demo mode, or an Access email that isn't a workspace user) the saved "acting as" choice is restored.
 */
export async function resolveIdentity(): Promise<void> {
  let email: string | null = null;
  try {
    const res = await fetch("/api/me", { cache: "no-store", headers: { Accept: "application/json" } });
    if (res.ok) {
      const body = (await res.json()) as { email?: unknown; authenticated?: unknown };
      if (body.authenticated === true && typeof body.email === "string") email = body.email;
    }
  } catch {
    // offline / no API — demo mode
  }
  applyIdentity(email);
}

function applyIdentity(email: string | null) {
  const st = useCrm.getState();
  const userId = matchUser(email);
  st.setIdentity({ email, source: email ? "access" : "demo", userId, resolved: true });
  if (userId) {
    st.setCurrentUser(userId);
    return;
  }
  const saved = readActingAs();
  if (saved && st.users.some((u) => u.id === saved)) st.setCurrentUser(saved);
}

/** Re-match after the users collection was replaced (e.g. a server snapshot arrived). */
export function rematchIdentity() {
  const { identity } = useCrm.getState();
  if (identity.resolved) applyIdentity(identity.email);
}

/** Demo mode: act as another workspace user and remember the choice for the next visit. */
export function actAs(userId: string) {
  const st = useCrm.getState();
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
