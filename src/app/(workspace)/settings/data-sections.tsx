"use client";

/* Settings › Data (backup / restore / reset, admins only), Data inventory, System health and Admin seeding. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Database, FileDown, FileUp, Gauge, KeyRound, Lock, RefreshCw, RotateCcw, Server, Shield } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import { buildBackup, dataInventory, pickCollections, restrictedCollectionKeys, validateBackup, withoutRestricted, type Backup } from "@/lib/sync/collections";
import { MAX_SNAPSHOT_BYTES, pushNow, SNAPSHOT_WARN_BYTES } from "@/lib/sync/engine";
import { cn, formatDate, formatNumber, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/misc";
import { Callout, ConfirmModal, Section, Stat } from "./ui";

/* ───────────── who may administer the workspace ───────────── */

/**
 * Workspace admin = useAccess().admin (CEO/CFO on the HR record). A break-glass admin from WORKSPACE_ADMINS who is
 * signed in through Access but has no user record is also accepted (the server checks the same list).
 */
export function useWorkspaceAdmin(): boolean {
  const access = useAccess();
  const identity = useCrm((s) => s.identity);
  return access.admin || (identity.source === "access" && identity.admin === true);
}

export function AdminOnly({ what }: { what: string }) {
  return (
    <Callout tone="info">
      <span className="inline-flex items-center gap-1 font-semibold text-sg-white">
        <Lock className="size-3" /> Workspace admins only.
      </span>{" "}
      {what} is limited to the CEO and CFO (and break-glass admins listed in <code>WORKSPACE_ADMINS</code>) because it touches everyone&apos;s data, including personal pay data
      (Policy §13.4). Ask one of them if you need it.
    </Callout>
  );
}

/* ───────────── Data ───────────── */

function download(filename: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export { download };

export function DataSection() {
  const notify = useUi((s) => s.notify);
  const resetDemo = useCrm((s) => s.resetDemo);
  const replaceWorkspaceData = useCrm((s) => s.replaceWorkspaceData);
  const scope = useCrm((s) => s.sync.scope);
  const admin = useWorkspaceAdmin();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; backup: Backup; counts: { key: string; n: number }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  // pay data only comes back from a backup when the server gives this browser the full data scope
  const fullScope = scope !== "own";
  const restricted = useMemo(() => restrictedCollectionKeys(), []);

  if (!admin) {
    return (
      <Section id="data" title="Data" icon={Database} subtitle="Backup, restore and reset">
        <AdminOnly what="Downloading a backup, restoring one or resetting the shared workspace" />
      </Section>
    );
  }

  const exportBackup = () => {
    const backup = buildBackup(useCrm.getState());
    const day = backup.exportedAt.slice(0, 10);
    download(`spectrum-crm-backup-${day}.json`, JSON.stringify(backup, null, 2));
    notify(fullScope ? "Backup downloaded — it contains personal pay data; store it securely" : "Backup downloaded (without other people's pay data)");
  };

  const onFile = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const check = validateBackup(parsed);
      if (!check.ok) setError(check.error);
      else setPending({ name: file.name, backup: check.backup, counts: check.counts });
    } catch {
      setError(`${file.name} is not valid JSON.`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const restore = async () => {
    if (!pending) return;
    const state = useCrm.getState();
    const previous = pickCollections(state);
    const data = fullScope ? pending.backup.data : withoutRestricted(pending.backup.data, state);
    replaceWorkspaceData(data);
    setPending(null);
    notify(fullScope ? "Backup restored" : "Backup restored — pay and HR collections were kept as they are", {
      label: "Undo",
      run: () => {
        replaceWorkspaceData(previous);
        void pushNow("restore");
      },
    });
    const err = await pushNow("restore");
    if (err) notify(err);
  };

  const reset = async () => {
    const previous = pickCollections(useCrm.getState());
    resetDemo();
    notify("Demo data reset", {
      label: "Undo",
      run: () => {
        replaceWorkspaceData(previous);
        void pushNow("restore");
      },
    });
    const err = await pushNow("reset");
    if (err) notify(err);
  };

  return (
    <Section id="data" title="Data" icon={Database} subtitle="Backup, restore and reset · workspace admins">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-sg-line bg-sg-bg/40 p-3">
          <div className="text-sm font-semibold text-sg-white">Download backup</div>
          <p className="mt-1 text-xs text-sg-dim">
            Every collection in this browser as one .json file, with export time and data version.{" "}
            {fullScope ? "It includes personal pay and HR data — keep it encrypted and delete it when done (UU PDP)." : "Other people's pay data is not in this browser, so it isn't in the file."}
          </p>
          <Button size="sm" variant="subtle" className="mt-3" onClick={exportBackup}>
            <FileDown /> Download backup (.json)
          </Button>
        </div>
        <div className="rounded-lg border border-sg-line bg-sg-bg/40 p-3">
          <div className="text-sm font-semibold text-sg-white">Restore from backup</div>
          <p className="mt-1 text-xs text-sg-dim">
            Replaces all data after checking the file, then syncs it to the shared workspace (logged on the server as a restore). The audit log is append-only and is never
            replaced.
          </p>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e: React.ChangeEvent<HTMLInputElement>) => void onFile(e.target.files?.[0])} />
          <Button size="sm" variant="subtle" className="mt-3" onClick={() => fileRef.current?.click()}>
            <FileUp /> Restore from backup…
          </Button>
        </div>
        <div className="rounded-lg border border-sg-line bg-sg-bg/40 p-3">
          <div className="text-sm font-semibold text-sg-white">Reset to demo data</div>
          <p className="mt-1 text-xs text-sg-dim">Back to the original seed. With sync on, this resets the shared workspace for everyone (the server keeps the previous version in its history).</p>
          <Button size="sm" variant="danger" className="mt-3" onClick={() => setConfirmReset(true)}>
            <RotateCcw /> Reset to demo data…
          </Button>
        </div>
      </div>

      {error && <Callout tone="danger">{error}</Callout>}

      <ConfirmModal
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title="Restore this backup?"
        description={pending ? `${pending.name}${pending.backup.exportedAt ? ` · exported ${formatDate(pending.backup.exportedAt, "datetime")}` : ""}` : undefined}
        confirmLabel="Replace all data"
        danger
        onConfirm={restore}
      >
        <p>All current data in this browser is replaced and then synced to the shared workspace. You can undo from the toast right after.</p>
        {!fullScope && (
          <Callout tone="warn">
            Your data scope excludes other people&apos;s pay data, so these collections are not restored: {restricted.join(", ")}. The server would ignore them anyway.
          </Callout>
        )}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-sg-line bg-sg-bg/40 p-3 text-xs sm:grid-cols-3">
          {pending?.counts.map((c) => (
            <div key={c.key} className="flex justify-between gap-2">
              <span className={cn("truncate", !fullScope && restricted.includes(c.key) ? "text-sg-dim line-through" : "text-sg-dim")}>{c.key}</span>
              <span className="sg-num text-sg-text">{formatNumber(c.n)}</span>
            </div>
          ))}
        </div>
      </ConfirmModal>
      <ConfirmModal
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset to demo data?"
        description="Restores the original seed in every collection."
        confirmLabel="Reset data"
        danger
        onConfirm={reset}
      >
        <p>
          Your changes are replaced by the demo seed and the reset syncs to the shared workspace. Undo is available from the toast for a few seconds, and an admin can roll back
          to the previous server version under Version history.
        </p>
      </ConfirmModal>
    </Section>
  );
}

/* ───────────── Data inventory ───────────── */

export function InventorySection() {
  const state = useCrm((s) => s);
  const scope = useCrm((s) => s.sync.scope);
  const [open, setOpen] = useState(false);
  // recompute only when a synced collection changes (the store object changes on every update)
  const rows = useMemo(() => dataInventory(state), [state]);
  const total = rows.reduce((n, r) => n + r.bytes, 0);
  const pct = Math.min(100, Math.round((total / MAX_SNAPSHOT_BYTES) * 100));
  const tone = total > MAX_SNAPSHOT_BYTES ? "red" : total > SNAPSHOT_WARN_BYTES ? "orange" : "green";
  const shown = open ? rows : rows.slice(0, 8);

  return (
    <Section id="inventory" title="Data inventory" icon={Server} subtitle="What this browser stores and syncs">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Snapshot size" value={`${formatNumber(Math.round(total / 1024))} KB`} hint={`of ~${formatNumber(Math.round(MAX_SNAPSHOT_BYTES / 1024))} KB per D1 row`} tone={tone} />
        <Stat label="Collections" value={formatNumber(rows.length)} />
        <Stat label="Records" value={formatNumber(rows.reduce((n, r) => n + r.rows, 0))} />
        <Stat label="Pay data in this copy" value={scope === "own" ? "Own only" : scope === "full" ? "Everyone's" : "Demo seed"} hint="§13.4" tone={scope === "own" ? "green" : undefined} />
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-sg-bg" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Snapshot size against the D1 row limit">
        <div className={cn("h-full rounded-full", tone === "red" ? "bg-soft-red" : tone === "orange" ? "bg-soft-orange" : "bg-soft-green")} style={{ width: `${pct}%` }} />
      </div>
      {total > SNAPSHOT_WARN_BYTES && (
        <Callout tone={total > MAX_SNAPSHOT_BYTES ? "danger" : "warn"}>
          The workspace is {total > MAX_SNAPSHOT_BYTES ? "over" : "close to"} the ~2 MB that D1 stores in one row. Trim the largest collections below (old activities, history) or
          ask the platform owner to split the snapshot.
        </Callout>
      )}
      <div className="overflow-hidden rounded-lg border border-sg-line">
        <table className="w-full text-xs">
          <thead className="bg-sg-bg/40 text-left">
            <tr>
              <th className="sg-eyebrow px-3 py-2">Collection</th>
              <th className="sg-eyebrow px-3 py-2 text-right">Records</th>
              <th className="sg-eyebrow px-3 py-2 text-right">Size</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} className="border-t border-sg-line">
                <td className="px-3 py-1.5 text-sg-text">
                  {r.key}
                  {r.restricted && (
                    <Chip color="magenta" className="ml-2 h-4 px-1 text-[10px]">
                      personal data
                    </Chip>
                  )}
                </td>
                <td className="sg-num px-3 py-1.5 text-right text-sg-white">{formatNumber(r.rows)}</td>
                <td className="sg-num px-3 py-1.5 text-right text-sg-muted">{r.bytes >= 1024 ? `${formatNumber(r.bytes / 1024, 1)} KB` : `${r.bytes} B`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 8 && (
        <Button size="xs" variant="ghost" onClick={() => setOpen((o) => !o)}>
          {open ? "Show the largest 8" : `Show all ${rows.length} collections`}
        </Button>
      )}
    </Section>
  );
}

/* ───────────── System health (shared with Identity) ───────────── */

export interface HealthSecurity {
  mode: string;
  production: boolean;
  accessConfigured: boolean;
  anonymousWorkspace: boolean;
  anonymousPayData: boolean;
  workspaceAdmins: number;
  seedTokenSet: boolean;
  auditTable: boolean;
  historyTable: boolean;
}

export interface Health {
  ok: boolean;
  env?: string;
  latencyMs?: number;
  detail?: "restricted";
  hint?: string;
  d1?: { connected: boolean; pingMs?: number; error?: string; counts?: Record<string, number | null> };
  workspace?: { version: number; updatedAt: string; updatedBy: string; bytes: number } | null;
  security?: HealthSecurity;
}

export interface HealthState {
  health: Health | null;
  error: string | null;
  loading: boolean;
  checkedAt: string | null;
  check: () => Promise<void>;
}

export function useHealth(): HealthState {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const check = useCallback(async () => {
    setLoading(true);
    setError(null);
    const started = performance.now();
    try {
      const res = await fetch("/api/health", { cache: "no-store", headers: { Accept: "application/json" } });
      const body = (await res.json().catch(() => null)) as Health | null;
      if (!body) {
        setHealth(null);
        setError(`Health endpoint returned HTTP ${res.status} without JSON.`);
      } else {
        setHealth({ ...body, latencyMs: body.latencyMs ?? Math.round(performance.now() - started) });
      }
    } catch {
      setHealth(null);
      setError("Health endpoint unreachable.");
    } finally {
      setCheckedAt(new Date().toISOString());
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return { health, error, loading, checkedAt, check };
}

const TABLE_LABELS: Record<string, string> = {
  contacts: "Contacts",
  companies: "Companies",
  deals: "Deals",
  issues: "Issues",
  cross_links: "Cross links",
  initiatives: "Initiatives",
  employee_profiles: "Employee profiles",
  workspace_snapshots: "Workspace snapshots",
  workspace_audit: "Audit trail (append-only)",
  workspace_snapshot_history: "Snapshot history",
};

export function HealthSection({ state }: { state: HealthState }) {
  const { health, error, loading, checkedAt, check } = state;
  const counts = health?.d1?.counts ?? {};
  const connected = health?.d1?.connected === true;

  return (
    <Section
      id="health"
      title="System health"
      icon={Gauge}
      subtitle={checkedAt ? `checked ${relativeTime(checkedAt)}` : undefined}
      actions={
        <Button size="sm" variant="subtle" onClick={() => void check()} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : undefined} /> Re-check
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="API" value={health ? (health.ok ? "Healthy" : "Degraded") : error ? "Unreachable" : "…"} tone={health ? (health.ok ? "green" : "orange") : error ? "red" : undefined} />
        <Stat label="D1" value={connected ? "Connected" : health ? "Not connected" : "—"} tone={connected ? "green" : health ? "red" : undefined} hint={health?.d1?.pingMs !== undefined ? `ping ${health.d1.pingMs} ms` : undefined} />
        <Stat label="Latency" value={health?.latencyMs !== undefined ? `${health.latencyMs} ms` : "—"} hint="server time for all checks" />
        <Stat label="Environment" value={health?.env ?? (health?.detail === "restricted" ? "hidden" : "—")} hint="APP_ENV on the Worker" />
      </div>

      {error && <Callout tone="danger">{error} The app keeps working on local data.</Callout>}
      {health?.d1?.error && <Callout tone="danger">D1: {health.d1.error}</Callout>}
      {health?.detail === "restricted" && <Callout>Table counts and configuration are only shown to signed-in users. {health.hint}</Callout>}
      {health?.security && (!health.security.auditTable || !health.security.historyTable) && (
        <Callout tone="warn">
          Migration <code>0004_workspace_audit.sql</code> is not applied — writes still work, but the server audit trail and version history are off. Run{" "}
          <code>npm run db:migrate:remote</code>.
        </Callout>
      )}

      {connected && Object.keys(counts).length > 0 && (
        <div className="overflow-hidden rounded-lg border border-sg-line">
          <table className="w-full text-xs">
            <thead className="bg-sg-bg/40 text-left">
              <tr>
                <th className="sg-eyebrow px-3 py-2">D1 table</th>
                <th className="sg-eyebrow px-3 py-2 text-right">Rows</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(counts).map(([table, n]) => (
                <tr key={table} className="border-t border-sg-line">
                  <td className="px-3 py-1.5 text-sg-text">
                    {TABLE_LABELS[table] ?? table} <span className="text-sg-dim">({table})</span>
                  </td>
                  <td className={cn("sg-num px-3 py-1.5 text-right", n === null ? "text-soft-yellow" : "text-sg-white")}>{n === null ? "table missing — apply migrations" : formatNumber(n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {connected && health?.detail !== "restricted" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-sg-muted">
          <Server className="size-3.5" />
          {health?.workspace ? (
            <>
              Workspace snapshot <Chip color="blue">v{health.workspace.version}</Chip>
              {formatNumber(Math.round(health.workspace.bytes / 1024))} KB · saved {formatDate(health.workspace.updatedAt, "datetime")}
            </>
          ) : (
            "No workspace snapshot on the server yet (or migration 0002 not applied)."
          )}
        </div>
      )}
    </Section>
  );
}

/* ───────────── Admin seeding ───────────── */

export function AdminSeedSection() {
  const admin = useWorkspaceAdmin();
  const [token, setToken] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  if (!admin) {
    return (
      <Section id="admin" title="Admin · seed D1" icon={KeyRound} subtitle="Requires the SEED_TOKEN secret">
        <AdminOnly what="Reseeding D1" />
      </Section>
    );
  }

  const seedD1 = async () => {
    setResult(null);
    try {
      const res = await fetch("/api/admin/seed", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; executed?: number; error?: string; hint?: string } | null;
      if (res.ok && body?.ok) {
        setResult({ ok: true, text: `Seeded D1 — ${formatNumber(body.executed ?? 0)} statements executed.` });
        setToken("");
      } else {
        setResult({ ok: false, text: [body?.error ?? `Seeding failed (HTTP ${res.status}).`, body?.hint].filter(Boolean).join(" — ") });
      }
    } catch {
      setResult({ ok: false, text: "Seed endpoint unreachable." });
    }
  };

  return (
    <Section id="admin" title="Admin · seed D1" icon={KeyRound} subtitle="SEED_TOKEN + workspace admin">
      <Callout tone="warn">
        Wipes and reloads D1&apos;s relational tables (contacts, companies, deals, issues, initiatives…) from the demo seed. The shared workspace snapshot that the app syncs is
        <span className="font-semibold"> not</span> touched — use Settings › Data to reset that. The server checks the token <em>and</em> that you are a workspace admin, and
        records every attempt in the audit trail.
      </Callout>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          if (token.trim()) setConfirm(true);
        }}
      >
        <label className="block w-full max-w-xs">
          <span className="mb-1 block text-2xs font-semibold uppercase tracking-[0.12em] text-sg-dim">Seed token</span>
          <Input type="password" autoComplete="off" spellCheck={false} placeholder="SEED_TOKEN" value={token} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToken(String(e.target.value))} />
        </label>
        <Button type="submit" size="md" variant="outline" disabled={!token.trim()}>
          <Database /> Seed D1
        </Button>
        <span className="flex items-center gap-1 pb-2 text-2xs text-sg-dim">
          <Shield className="size-3" /> The token is sent once as a Bearer header and never stored.
        </span>
      </form>
      {result && <Callout tone={result.ok ? "ok" : "danger"}>{result.text}</Callout>}
      <ConfirmModal open={confirm} onOpenChange={setConfirm} title="Wipe and reseed D1?" confirmLabel="Wipe & seed" danger onConfirm={seedD1}>
        <p>All rows in D1&apos;s relational tables are deleted and replaced with the demo seed. This can&apos;t be undone from the app.</p>
      </ConfirmModal>
    </Section>
  );
}
