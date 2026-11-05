"use client";

/* Settings › Workspace sync and Settings › Identity & security. */
import { useMemo, useState } from "react";
import { CloudOff, Download, KeyRound, Lock, RefreshCw, Shield, Upload, User, UserX } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { localSyncedVersion, overwriteServer, reloadFromServer, syncNow } from "@/lib/sync/engine";
import { describeActor } from "@/lib/sync/collections";
import { actAs, canActAs, isUnmatched } from "@/lib/sync/identity";
import { governanceByUser, governanceLabel } from "@/lib/sync/roles";
import { cn, formatDate, relativeTime } from "@/lib/utils";
import { syncLabel } from "@/components/shell/sidebar-extras";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Avatar, Chip } from "@/components/ui/misc";
import { useWorkspaceAdmin, type HealthState } from "./data-sections";
import { Callout, ConfirmModal, Section, Stat } from "./ui";

const statusTone = { idle: undefined, syncing: undefined, synced: "green", offline: "yellow", conflict: "orange", locked: "yellow" } as const;

export function SyncSection() {
  const sync = useCrm((s) => s.sync);
  const users = useCrm((s) => s.users);
  const notify = useUi((s) => s.notify);
  const admin = useWorkspaceAdmin();
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
          <RefreshCw className={busy === "sync" ? "animate-spin" : undefined} /> {sync.status === "locked" ? "Retry now" : "Sync now"}
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Status" value={syncLabel(sync)} tone={statusTone[sync.status]} hint={sync.nextRetryAt && (sync.status === "offline" || sync.status === "locked") ? `next try ${relativeTime(sync.nextRetryAt)}` : undefined} />
        <Stat label="Server version" value={sync.serverVersion ? `v${sync.serverVersion}` : "—"} />
        <Stat label="This browser" value={localVersion ? `v${localVersion}` : "—"} hint={sync.dirty ? "has unsynced changes" : "up to date"} tone={sync.dirty ? "yellow" : undefined} />
        <Stat label="Last sync" value={sync.lastSyncedAt ? relativeTime(sync.lastSyncedAt) : "never"} hint={sync.lastSyncedAt ? formatDate(sync.lastSyncedAt, "datetime") : undefined} />
        <Stat label="Last change by" value={sync.updatedBy ? describeActor(sync.updatedBy, users) : "—"} hint={sync.updatedAt ? `${formatDate(sync.updatedAt, "datetime")} · ${relativeTime(sync.updatedAt)}` : undefined} />
        <Stat label="Data scope" value={sync.scope === "own" ? "Own pay data" : sync.scope === "full" ? "Full" : "—"} hint={sync.scope === "own" ? "others' pay data redacted (§13.4)" : sync.scope === "full" ? "pay role on your HR record" : "not synced yet"} />
      </div>

      {sync.lastError && (
        <Callout tone={sync.status === "conflict" || sync.status === "locked" ? "warn" : "danger"}>
          <span className="font-semibold">{sync.status === "offline" ? "Working offline. " : sync.status === "locked" ? "Locked — working on this device only. " : ""}</span>
          {sync.lastError}
        </Callout>
      )}
      {sync.lastMerge && (
        <Callout tone={sync.lastMerge.conflicts ? "warn" : "ok"}>
          {formatDate(sync.lastMerge.at, "datetime")}: someone saved v{sync.lastMerge.version} while you had unsynced edits. {sync.lastMerge.merged} of your change
          {sync.lastMerge.merged === 1 ? " was" : "s were"} re-applied on top
          {sync.lastMerge.conflicts ? `; ${sync.lastMerge.conflicts} record${sync.lastMerge.conflicts === 1 ? "" : "s"} changed on both sides kept the server version` : ""}.
        </Callout>
      )}
      {sync.scope === "own" && (sync.protectedKeys?.length ?? 0) > 0 && (
        <Callout>
          On your last save the server kept its own copy of: <span className="font-semibold">{sync.protectedKeys?.join(", ")}</span>. Pay and HR data can only be changed by
          Finance, HR or the PRC, and the audit log is append-only.
        </Callout>
      )}

      <Callout>
        Every browser keeps a local copy (localStorage) and syncs the whole workspace as one versioned snapshot. Edits are sent 1.5 s after you stop typing; if someone else
        saved first, your changes are merged record by record on top of theirs (where you both changed the same record, theirs is kept). The server sends other people&apos;s pay
        data only to Finance, HR and the PRC, keeps its audit log append-only, and records every write in an audit trail. Without the API (local <code>next dev</code> without
        D1, CI) the app keeps working locally and shows <CloudOff className="inline size-3" /> offline; when sign-in is required it shows <Lock className="inline size-3" />{" "}
        locked and stops polling.
      </Callout>

      <div className="flex flex-wrap items-center gap-2">
        {admin && (
          <Button size="sm" variant="outline" onClick={() => setConfirm("push")} disabled={busy !== null}>
            <Upload /> Overwrite server with this browser
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setConfirm("pull")} disabled={busy !== null}>
          <Download /> Reload from server
        </Button>
        {!admin && <span className="text-2xs text-sg-dim">Overwriting the shared workspace is limited to workspace admins.</span>}
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
        <p className="text-xs text-sg-dim">The replaced version stays in the server&apos;s version history, and the audit log is kept either way.</p>
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

function Check({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className={cn("mt-1 size-2 shrink-0 rounded-full", ok ? "bg-soft-green" : warn ? "bg-soft-yellow" : "bg-soft-red")} aria-hidden />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

export function IdentitySection({ health }: { health: HealthState }) {
  const identity = useCrm((s) => s.identity);
  const users = useCrm((s) => s.users);
  const profiles = useCrm((s) => s.employeeProfiles);
  const currentUserId = useCrm((s) => s.currentUserId);
  const status = useCrm((s) => s.sync.status);
  const notify = useUi((s) => s.notify);
  const roles = useMemo(() => governanceByUser(profiles), [profiles]);
  const me = users.find((u) => u.id === currentUserId);
  const switchable = canActAs(identity);
  const unmatched = isUnmatched(identity);
  const sec = health.health?.security;
  const locked = identity.mode === "locked" || status === "locked";

  return (
    <Section
      id="identity"
      title="Identity & security"
      icon={Shield}
      subtitle={identity.source === "access" ? "Cloudflare Access" : locked ? "Locked — local only" : identity.mode === "anonymous-allowed" ? "Anonymous demo" : "Demo mode"}
    >
      <div className="flex flex-wrap items-center gap-3">
        {unmatched ? (
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-soft-yellow/15 text-soft-yellow">
            <UserX className="size-5" />
          </span>
        ) : (
          <Avatar user={me} size="lg" />
        )}
        <div className="min-w-0 leading-tight">
          <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-sg-white">
            {unmatched ? identity.email : me?.name ?? "Unknown user"}
            {identity.source === "access" && identity.userId ? (
              <Chip color="green" dot>
                Signed in
              </Chip>
            ) : unmatched ? (
              <Chip color="yellow">No workspace user</Chip>
            ) : (
              <Chip color="yellow">Demo</Chip>
            )}
            {(roles.get(currentUserId) ?? []).map((r) => (
              <Chip key={r} color="cyan">
                {r}
              </Chip>
            ))}
            {identity.scope && (
              <Chip color={identity.scope === "full" ? "magenta" : "blue"}>{identity.scope === "full" ? "Full pay data" : "Own pay data only"}</Chip>
            )}
          </div>
          <div className="truncate text-xs text-sg-dim">{unmatched ? "Signed in through Cloudflare Access" : `${me?.title ?? ""} · ${me?.email ?? ""}`}</div>
        </div>
      </div>

      {identity.source === "access" ? (
        identity.userId ? (
          <Callout tone="ok">
            Cloudflare Access signed you in as <span className="font-semibold">{identity.email}</span>. The server matched the workspace user and the roles on their HR record
            {identity.roles?.length ? ` (${identity.roles.map(governanceLabel).join(", ")})` : " (no governance roles)"}; every write is recorded under your email. Signed-in
            people can&apos;t act as anyone else.
          </Callout>
        ) : (
          <Callout tone="warn">
            Cloudflare Access signed you in as <span className="font-semibold">{identity.email}</span>, but no workspace user has that email. You have no roles, receive no one&apos;s
            pay data and can&apos;t act as anyone. Ask HR to put this email on your user record{identity.admin ? " — you are listed in WORKSPACE_ADMINS, so admin tools stay available" : ""}.
          </Callout>
        )
      ) : locked ? (
        <Callout tone="warn">
          <span className="font-semibold">The shared workspace is locked for this browser.</span> {identity.lockHint ?? "Sign in through Cloudflare Access to load it."} Until then the
          app works on this device only (demo data plus your edits); nothing is sent to the server and the app checks again every 10 minutes or when you press Retry.
        </Callout>
      ) : (
        <Callout>
          {identity.resolved ? "No Cloudflare Access sign-in on this request" : "Checking for a Cloudflare Access sign-in…"} — the app runs in{" "}
          {identity.mode === "anonymous-allowed" ? "anonymous demo mode (ALLOW_ANONYMOUS_WORKSPACE)" : "demo mode"}. Switch who you act as to walk through PRC, CFO or HR steps as
          the right person; the choice is remembered in this browser. Production sits behind Access, which identifies people automatically and turns this switch off.
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
            <KeyRound className="size-3" /> Demo identities aren&apos;t authentication — anyone can pick any user. Never use demo mode with real data.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-sg-line bg-sg-bg/40 p-3">
        <div className="sg-eyebrow mb-2">Security checklist</div>
        {sec ? (
          <ul className="space-y-1.5 text-xs text-sg-text">
            <Check ok={sec.accessConfigured} warn={!sec.production}>
              Cloudflare Access {sec.accessConfigured ? "configured (CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD) — every API call needs a verified token" : "not configured on this Worker"}
              {!sec.accessConfigured && sec.production ? " — shared data stays locked until it is" : ""}.
            </Check>
            <Check ok={!sec.anonymousWorkspace} warn>
              {sec.anonymousWorkspace ? "ALLOW_ANONYMOUS_WORKSPACE is on: anyone can read and write the shared workspace (demo only — never with real data)." : "Anonymous access is off."}
            </Check>
            {sec.anonymousWorkspace && (
              <Check ok={!sec.anonymousPayData}>
                {sec.anonymousPayData ? "ALLOW_ANONYMOUS_PAY_DATA is on: anonymous browsers also receive pay data." : "Anonymous browsers get no one's pay data."}
              </Check>
            )}
            <Check ok={sec.workspaceAdmins > 0} warn>
              {sec.workspaceAdmins > 0 ? `${sec.workspaceAdmins} break-glass admin${sec.workspaceAdmins === 1 ? "" : "s"} in WORKSPACE_ADMINS.` : "No WORKSPACE_ADMINS — admins come only from CEO/CFO roles on HR records."}
            </Check>
            <Check ok={sec.auditTable && sec.historyTable}>
              {sec.auditTable && sec.historyTable ? "Server audit trail and version history are on (migration 0004)." : "Migration 0004 missing — no server audit trail or version history yet."}
            </Check>
            <Check ok warn>
              <code>workers_dev</code> and <code>preview_urls</code> are enabled in wrangler.jsonc: put those hostnames behind the same Access application (or turn them off). The
              API verifies the Access JWT, so a request that skips Access gets no data either way.
            </Check>
          </ul>
        ) : (
          <p className="text-xs text-sg-dim">
            {health.loading ? "Checking the server configuration…" : health.health?.detail === "restricted" ? "Shown once you are signed in." : "Server configuration unavailable (API offline)."}
          </p>
        )}
      </div>
    </Section>
  );
}
