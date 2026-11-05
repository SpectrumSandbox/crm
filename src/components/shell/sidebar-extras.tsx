"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useMemo } from "react";
import { Cloud, CloudOff, Lock, RefreshCw, Settings, UserX } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { describeActor } from "@/lib/sync/collections";
import { syncNow } from "@/lib/sync/engine";
import { actAs, canActAs, isUnmatched } from "@/lib/sync/identity";
import { governanceByUser } from "@/lib/sync/roles";
import type { SyncInfo } from "@/lib/slices/platform";
import { cn, formatDate, relativeTime } from "@/lib/utils";
import { Avatar, Chip } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlays";

/** Sidebar footer slot (platform workstream): sync status, acting-as switcher, settings link. */
export function SidebarExtras({ collapsed }: { collapsed: boolean }) {
  const identity = useCrm((s) => s.identity);
  return (
    <div className="space-y-px">
      <SyncIndicator collapsed={collapsed} />
      {canActAs(identity) && <ActingAs collapsed={collapsed} />}
      {isUnmatched(identity) && <Unmatched collapsed={collapsed} email={identity.email} />}
      <SettingsLink collapsed={collapsed} />
    </div>
  );
}

/* ───────────── sync status ───────────── */

export function syncLabel(sync: SyncInfo): string {
  switch (sync.status) {
    case "syncing":
      return "Syncing…";
    case "synced":
      return sync.dirty ? "Saving soon…" : `Synced${sync.serverVersion ? ` · v${sync.serverVersion}` : ""}`;
    case "offline":
      return "Offline · local only";
    case "conflict":
      return "Sync conflict";
    case "locked":
      return "Locked · local only";
    default:
      return "Not synced yet";
  }
}

export function syncTooltip(sync: SyncInfo, users: { email: string; name: string }[] = []): string {
  const lines = [syncLabel(sync)];
  lines.push(sync.lastSyncedAt ? `Last sync ${formatDate(sync.lastSyncedAt, "datetime")} (${relativeTime(sync.lastSyncedAt)})` : "Never synced with the server");
  if (sync.updatedBy) lines.push(`Last change by ${describeActor(sync.updatedBy, users)}${sync.updatedAt ? ` · ${formatDate(sync.updatedAt, "datetime")} (${relativeTime(sync.updatedAt)})` : ""}`);
  if (sync.dirty) lines.push("Local changes not on the server yet");
  if (sync.scope === "own") lines.push("Your copy holds only your own pay data (§13.4)");
  if (sync.lastMerge) lines.push(`Last merge: ${sync.lastMerge.merged} change${sync.lastMerge.merged === 1 ? "" : "s"} re-applied on v${sync.lastMerge.version}${sync.lastMerge.conflicts ? `, ${sync.lastMerge.conflicts} kept theirs` : ""}`);
  if (sync.lastError) lines.push(sync.lastError);
  if (sync.nextRetryAt && (sync.status === "offline" || sync.status === "locked")) lines.push(`Next try ${relativeTime(sync.nextRetryAt)}`);
  lines.push("Click to sync now");
  return lines.join("\n");
}

function SyncIcon({ sync, className }: { sync: SyncInfo; className?: string }) {
  if (sync.status === "syncing") return <RefreshCw className={cn("animate-spin text-sg-muted", className)} />;
  if (sync.status === "offline") return <CloudOff className={cn("text-soft-yellow", className)} />;
  if (sync.status === "conflict") return <CloudOff className={cn("text-soft-orange", className)} />;
  if (sync.status === "locked") return <Lock className={cn("text-soft-yellow", className)} />;
  if (sync.status === "synced") return <Cloud className={cn(sync.dirty ? "text-sg-muted" : "text-soft-green", className)} />;
  return <Cloud className={cn("text-sg-dim", className)} />;
}

function SyncIndicator({ collapsed }: { collapsed: boolean }) {
  const sync = useCrm((s) => s.sync);
  const users = useCrm((s) => s.users);
  const notify = useUi((s) => s.notify);
  return (
    <button
      type="button"
      title={syncTooltip(sync, users)}
      aria-label={`${syncLabel(sync)} — sync now`}
      onClick={() => {
        void syncNow().then((err) => {
          if (err) notify(err);
        });
      }}
      className={cn("flex h-7 w-full items-center gap-2 rounded text-xs text-sg-dim hover:bg-sg-card hover:text-sg-white", collapsed ? "justify-center px-0" : "px-2")}
    >
      <SyncIcon sync={sync} className="size-3.5 shrink-0" />
      {!collapsed && (
        <>
          <span className="truncate">{syncLabel(sync)}</span>
          {sync.lastSyncedAt && sync.status !== "syncing" && <span className="ml-auto shrink-0 text-2xs text-sg-dim">{relativeTime(sync.lastSyncedAt)}</span>}
        </>
      )}
    </button>
  );
}

/* ───────────── demo "acting as" ───────────── */

function ActingAs({ collapsed }: { collapsed: boolean }) {
  const users = useCrm((s) => s.users);
  const profiles = useCrm((s) => s.employeeProfiles);
  const currentUserId = useCrm((s) => s.currentUserId);
  const notify = useUi((s) => s.notify);
  const me = users.find((u) => u.id === currentUserId);

  const rows = useMemo(() => {
    const roles = governanceByUser(profiles);
    const list = users.map((u) => ({ user: u, roles: roles.get(u.id) ?? [] }));
    // governance role holders (PRC, CEO, CFO, HR…) first — they're who demos switch between most
    return [...list.filter((r) => r.roles.length), ...list.filter((r) => !r.roles.length)];
  }, [users, profiles]);
  const firstPlain = rows.findIndex((r) => !r.roles.length);

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          title={`Acting as ${me?.name ?? "—"} (demo mode — no Cloudflare Access sign-in). Click to switch.`}
          className={cn("flex h-7 w-full items-center gap-2 rounded text-xs text-sg-muted hover:bg-sg-card hover:text-sg-white", collapsed ? "justify-center px-0" : "px-2")}
        >
          <Avatar user={me} size="xs" />
          {!collapsed && (
            <>
              <span className="min-w-0 truncate">
                <span className="text-sg-dim">Acting as </span>
                {me?.name.split(" ")[0] ?? "—"}
              </span>
              <Chip color="yellow" className="ml-auto h-4 px-1 text-[10px]">
                Demo
              </Chip>
            </>
          )}
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-[280px]">
        <MenuLabel>Act as (demo mode)</MenuLabel>
        {rows.map((r, i) => (
          <Fragment key={r.user.id}>
            {i === firstPlain && firstPlain > 0 && <MenuSeparator />}
            <MenuItem
              active={r.user.id === currentUserId}
              onSelect={() => {
                if (r.user.id === currentUserId) return;
                actAs(r.user.id);
                notify(`Now acting as ${r.user.name}`);
              }}
            >
              <Avatar user={r.user} size="xs" />
              <span className="min-w-0 flex-1 truncate">
                {r.user.name}
                <span className="ml-1 text-2xs text-sg-dim">{r.user.title}</span>
              </span>
              {r.roles.length > 0 && <span className="shrink-0 text-2xs font-semibold text-soft-cyan">{r.roles.join(" · ")}</span>}
            </MenuItem>
          </Fragment>
        ))}
      </MenuContent>
    </Menu>
  );
}

/* ───────────── signed in, but not a workspace user ───────────── */

function Unmatched({ collapsed, email }: { collapsed: boolean; email: string | null }) {
  return (
    <Link
      href="/settings#identity"
      title={`Signed in as ${email ?? "—"} — no workspace user has this email, so you have no roles. Ask HR to add it.`}
      className={cn("flex h-7 w-full items-center gap-2 rounded text-xs text-soft-yellow hover:bg-sg-card", collapsed ? "justify-center px-0" : "px-2")}
    >
      <UserX className="size-3.5 shrink-0" />
      {!collapsed && <span className="min-w-0 truncate">No workspace user</span>}
    </Link>
  );
}

/* ───────────── settings ───────────── */

function SettingsLink({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  const active = pathname === "/settings" || pathname.startsWith("/settings/");
  return (
    <Link
      href="/settings"
      title={collapsed ? "Settings" : undefined}
      className={cn(
        "flex h-7 items-center gap-2 rounded text-xs",
        collapsed ? "justify-center px-0" : "px-2",
        active ? "bg-sg-card-2 text-sg-white" : "text-sg-dim hover:bg-sg-card hover:text-sg-white",
      )}
    >
      <Settings className="size-3.5 shrink-0" />
      {!collapsed && "Settings"}
    </Link>
  );
}
