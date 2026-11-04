"use client";

import { useEffect } from "react";
import { startSync, stopSync } from "@/lib/sync/engine";
import { resolveIdentity } from "@/lib/sync/identity";

/**
 * Mount point for workspace ⇄ D1 synchronisation. Mounted inside the hydrated app shell, so the
 * persisted store is already restored: resolve who this is (Cloudflare Access / demo "acting as"),
 * then start the sync loop. Renders nothing.
 */
export function WorkspaceSync() {
  useEffect(() => {
    let cancelled = false;
    void resolveIdentity().then(() => {
      if (!cancelled) startSync();
    });
    return () => {
      cancelled = true;
      stopSync();
    };
  }, []);
  return null;
}
