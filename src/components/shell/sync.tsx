"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Lock, RefreshCw, UserX, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { startSync, stopSync, syncNow } from "@/lib/sync/engine";
import { isUnmatched, resolveIdentity } from "@/lib/sync/identity";
import { relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Mount point for workspace ⇄ D1 synchronisation. Mounted inside the hydrated app shell, so the
 * persisted store is already restored: resolve who this is (Cloudflare Access / demo "acting as"),
 * then start the sync loop. Renders the access banner (locked workspace / signed-in user without a record).
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
  return <AccessBanner />;
}

const DISMISS_KEY = "sg-crm-banner-dismissed";

function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/** Bottom-right banner while the shared workspace is locked for this browser or the signed-in person has no user record. */
function AccessBanner() {
  const status = useCrm((s) => s.sync.status);
  const nextRetryAt = useCrm((s) => s.sync.nextRetryAt);
  const lastError = useCrm((s) => s.sync.lastError);
  const identity = useCrm((s) => s.identity);
  const notify = useUi((s) => s.notify);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDismissed(readDismissed()), []);

  const kind = status === "locked" ? "locked" : isUnmatched(identity) ? "unmatched" : null;
  if (!kind || dismissed === kind) return null;

  const dismiss = () => {
    setDismissed(kind);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, kind);
    } catch {
      // storage blocked — dismissed for this render only
    }
  };

  const retry = async () => {
    setBusy(true);
    try {
      const err = await syncNow();
      notify(err ?? "Connected to the shared workspace");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 right-4 z-[65] w-[360px] max-w-[calc(100vw-32px)] rounded-xl border border-soft-yellow/30 bg-sg-card-2 p-3 text-xs text-sg-text shadow-pop"
    >
      <div className="flex items-start gap-2">
        {kind === "locked" ? <Lock className="mt-0.5 size-4 shrink-0 text-soft-yellow" /> : <UserX className="mt-0.5 size-4 shrink-0 text-soft-yellow" />}
        <div className="min-w-0 flex-1 leading-relaxed">
          {kind === "locked" ? (
            <>
              <div className="font-semibold text-sg-white">Shared workspace locked — working on this device only</div>
              <p className="mt-0.5 text-sg-muted">{identity.lockHint ?? lastError ?? "Sign in through Cloudflare Access to load the shared workspace."}</p>
              <p className="mt-1 text-2xs text-sg-dim">
                Your edits stay in this browser and sync once you&apos;re let in.{nextRetryAt ? ` Next automatic try ${relativeTime(nextRetryAt)}.` : ""}
              </p>
            </>
          ) : (
            <>
              <div className="font-semibold text-sg-white">No workspace user for {identity.email}</div>
              <p className="mt-0.5 text-sg-muted">
                Cloudflare Access signed you in, but no person in the workspace has this email, so you have no roles and can&apos;t act as anyone. Ask HR to add your email to your
                user record.
              </p>
            </>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {kind === "locked" && (
              <Button size="xs" variant="subtle" onClick={() => void retry()} disabled={busy}>
                <RefreshCw className={busy ? "animate-spin" : undefined} /> Retry now
              </Button>
            )}
            <Link href="/settings#identity" className="rounded px-1.5 py-0.5 text-2xs font-semibold text-soft-cyan hover:bg-sg-card hover:text-sg-white">
              Details in Settings
            </Link>
          </div>
        </div>
        <button type="button" aria-label="Dismiss" onClick={dismiss} className="rounded p-0.5 text-sg-dim hover:bg-sg-card hover:text-sg-white">
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
