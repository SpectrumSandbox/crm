"use client";

/* Settings › Workspace sync and Settings › Identity. */
import { useMemo, useState } from "react";
import { CloudOff, Download, KeyRound, RefreshCw, Shield, Upload, User } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { localSyncedVersion, overwriteServer, reloadFromServer, syncNow } from "@/lib/sync/engine";
import { describeActor } from "@/lib/sync/collections";
import { actAs, canActAs } from "@/lib/sync/identity";
import { governanceByUser } from "@/lib/sync/roles";
import { formatDate, relativeTime } from "@/lib/utils";
import { syncLabel } from "@/components/shell/sidebar-extras";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Avatar, Chip } from "@/components/ui/misc";
import { Callout, ConfirmModal, Section, Stat } from "./ui";

const statusTone = { idle: undefined, syncing: undefined, synced: "green", offline: "yellow", conflict: "orange" } as const;

export function SyncSection() {
  const sync = useCrm((s) => s.sync);
  const users = useCrm((s) => s.users);
  const notify = useUi((s) => s.notify);
  const [busy, setBusy] = useState<null | "sync" | "push" | "pull">(null);
  const [confirm, setConfirm] = useState<null | "push" | "pull">(null);

  const run = async (kind: "sync" | "push" | "pull") => {
    setBusy(kind);
    try {
      const err = await (kind === "sync" ? syncNow() : kind === "push" ? overwriteServer() : reloadFromServer());
      if (err) notify(err);
      else if (kind === "push") notify("Server workspace overwritten with this browser's data");
      else if (kind === "sync") notify("Workspace synced");
    } finally {
      setBusy(null);
    }
  };

  const localVersion = localSyncedVersion();

  return (
    <Section
      id="sync"
      title="Workspace sync"
      icon={RefreshCw}
      subtitle="Shared snapshot in Cloudflare D1"
      actions={
        <Button size="sm" variant="subtle" onClick={() => void run("sync")} disabled={busy !== null}>
          <RefreshCw className={busy === "sync" ? "animate-spin" : undefined} /> Sync now
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Status" value={syncLabel(sync)} tone={statusTone[sync.status]} />
        <Stat label="Server version" value={sync.serverVersion ? `v${sync.serverVersion}` : "—"} />
        <Stat label="This browser" value={localVersion ? `v${localVersion}` : "—"} hint={sync.dirty ? "has unsynced changes" : "up to date"} tone={sync.dirty ? "yellow" : undefined} />
        <Stat label="Last sync" value={sync.lastSyncedAt ? relativeTime(sync.lastSyncedAt) : "never"} hint={sync.lastSyncedAt ? formatDate(sync.lastSyncedAt, "datetime") : undefined} />
        <Stat label="Last change by" value={sync.updatedBy ? describeActor(sync.updatedBy, users) : "—"} hint={sync.updatedAt ? formatDate(sync.updatedAt, "datetime") : undefined} />
        <Stat label="Poll" value="30 s" hint="while this tab is visible" />
      </div>

      {sync.lastError && (
        <Callout tone={sync.status === "conflict" ? "warn" : "danger"}>
          <span className="font-semibold">{sync.status === "offline" ? "Working offline. " : ""}</span>
          {sync.lastError}
        </Callout>
      )}

      <Callout>
        Every browser keeps a full local copy (localStorage) and syncs the whole workspace as one versioned snapshot. Edits are sent 1.5 s after you stop typing; if someone
        else saved first, their version wins and you get a toast with <span className="font-semibold">Keep mine</span>. Without the API (local <code>next dev</code> without
        D1, CI) the app keeps working locally and shows <CloudOff className="inline size-3" /> offline.
      </Callout>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setConfirm("push")} disabled={busy !== null}>
          <Upload /> Overwrite server with this browser
        </Button>
        <Button size="sm" variant="outline" onClick={() => setConfirm("pull")} disabled={busy !== null}>
          <Download /> Reload from server
        </Button>
      </div>

      <ConfirmModal
        open={confirm === "push"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Overwrite the shared workspace?"
        description="Everyone will get this browser's data on their next sync."
        confirmLabel="Overwrite server"
        danger
        onConfirm={() => run("push")}
      >
        <p>The server snapshot{sync.serverVersion ? ` (v${sync.serverVersion})` : ""} is replaced with the data in this browser, including any changes other people made that you haven&apos;t loaded.</p>
        <p className="text-xs text-sg-dim">Tip: download a backup first (Settings › Data) if you might need the server copy.</p>
      </ConfirmModal>
      <ConfirmModal
        open={confirm === "pull"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Reload from the server?"
        description="This browser's data is replaced with the shared snapshot."
        confirmLabel="Reload from server"
        danger
        onConfirm={() => run("pull")}
      >
        <p>Local changes that haven&apos;t synced{sync.dirty ? " (this browser has some)" : ""} are discarded.</p>
      </ConfirmModal>
    </Section>
  );
}

export function IdentitySection() {
  const identity = useCrm((s) => s.identity);
  const users = useCrm((s) => s.users);
  const profiles = useCrm((s) => s.employeeProfiles);
  const currentUserId = useCrm((s) => s.currentUserId);
  const notify = useUi((s) => s.notify);
  const roles = useMemo(() => governanceByUser(profiles), [profiles]);
  const me = users.find((u) => u.id === currentUserId);
  const switchable = canActAs(identity);

  return (
    <Section id="identity" title="Identity" icon={Shield} subtitle={identity.source === "access" ? "Cloudflare Access" : "Demo mode"}>
      <div className="flex flex-wrap items-center gap-3">
        <Avatar user={me} size="lg" />
        <div className="min-w-0 leading-tight">
          <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-sg-white">
            {me?.name ?? "Unknown user"}
            {identity.source === "access" && identity.userId ? (
              <Chip color="green" dot>
                Signed in
              </Chip>
            ) : (
              <Chip color="yellow">Demo</Chip>
            )}
            {(roles.get(currentUserId) ?? []).map((r) => (
              <Chip key={r} color="cyan">
                {r}
              </Chip>
            ))}
          </div>
          <div className="truncate text-xs text-sg-dim">
            {me?.title} · {me?.email}
          </div>
        </div>
      </div>

      {identity.source === "access" ? (
        identity.userId ? (
          <Callout tone="ok">
            Cloudflare Access (Google SSO) signed you in as <span className="font-semibold">{identity.email}</span>; the app acts as the matching workspace user and records your
            email on every sync.
          </Callout>
        ) : (
          <Callout tone="warn">
            Cloudflare Access signed you in as <span className="font-semibold">{identity.email}</span>, but no workspace user has that email. Pick who to act as below, or add
            the email to a user record.
          </Callout>
        )
      ) : (
        <Callout>
          {identity.resolved ? "No Cloudflare Access sign-in on this request" : "Checking for a Cloudflare Access sign-in…"} — the app runs in demo mode. Switch who you act as to
          walk through PRC, CFO or HR steps as the right person; the choice is remembered in this browser. Production sits behind Access, which identifies people automatically.
        </Callout>
      )}

      {switchable && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="block w-full max-w-sm">
            <span className="mb-1 flex items-center gap-1 text-2xs font-semibold uppercase tracking-[0.12em] text-sg-dim">
              <User className="size-3" /> Acting as
            </span>
            <Select
              value={currentUserId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                const id = String(e.target.value);
                actAs(id);
                notify(`Now acting as ${users.find((u) => u.id === id)?.name ?? id}`);
              }}
            >
              {users.map((u) => {
                const r = roles.get(u.id);
                return (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.title}
                    {r?.length ? ` (${r.join(", ")})` : ""}
                  </option>
                );
              })}
            </Select>
          </label>
          <p className="flex items-center gap-1 pb-2 text-2xs text-sg-dim">
            <KeyRound className="size-3" /> Demo identities aren&apos;t authentication — anyone can pick any user.
          </p>
        </div>
      )}
    </Section>
  );
}
