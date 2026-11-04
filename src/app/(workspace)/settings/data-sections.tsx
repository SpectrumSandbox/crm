"use client";

/* Settings › Data (backup / restore / reset), System health and Admin seeding. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Database, FileDown, FileUp, Gauge, KeyRound, RefreshCw, RotateCcw, Server } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { buildBackup, pickCollections, validateBackup, type Backup } from "@/lib/sync/collections";
import { cn, formatDate, formatNumber, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/misc";
import { Callout, ConfirmModal, Section, Stat } from "./ui";

/* ───────────── Data ───────────── */

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DataSection() {
  const notify = useUi((s) => s.notify);
  const resetDemo = useCrm((s) => s.resetDemo);
  const replaceWorkspaceData = useCrm((s) => s.replaceWorkspaceData);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; backup: Backup; counts: { key: string; n: number }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const exportBackup = () => {
    const backup = buildBackup(useCrm.getState());
    const day = backup.exportedAt.slice(0, 10);
    download(`spectrum-crm-backup-${day}.json`, JSON.stringify(backup, null, 2));
    notify("Backup downloaded");
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

  const restore = () => {
    if (!pending) return;
    const previous = pickCollections(useCrm.getState());
    replaceWorkspaceData(pending.backup.data);
    setPending(null);
    notify("Backup restored", { label: "Undo", run: () => replaceWorkspaceData(previous) });
  };

  const reset = () => {
    const previous = pickCollections(useCrm.getState());
    resetDemo();
    notify("Demo data reset", { label: "Undo", run: () => replaceWorkspaceData(previous) });
  };

  return (
    <Section id="data" title="Data" icon={Database} subtitle="Backup, restore and reset">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-sg-line bg-sg-bg/40 p-3">
          <div className="text-sm font-semibold text-sg-white">Download backup</div>
          <p className="mt-1 text-xs text-sg-dim">Every collection in this browser as one .json file, with export time and data version.</p>
          <Button size="sm" variant="subtle" className="mt-3" onClick={exportBackup}>
            <FileDown /> Download backup (.json)
          </Button>
        </div>
        <div className="rounded-lg border border-sg-line bg-sg-bg/40 p-3">
          <div className="text-sm font-semibold text-sg-white">Restore from backup</div>
          <p className="mt-1 text-xs text-sg-dim">Replaces all data after checking the file. Restored data syncs to the shared workspace.</p>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e: React.ChangeEvent<HTMLInputElement>) => void onFile(e.target.files?.[0])} />
          <Button size="sm" variant="subtle" className="mt-3" onClick={() => fileRef.current?.click()}>
            <FileUp /> Restore from backup…
          </Button>
        </div>
        <div className="rounded-lg border border-sg-line bg-sg-bg/40 p-3">
          <div className="text-sm font-semibold text-sg-white">Reset to demo data</div>
          <p className="mt-1 text-xs text-sg-dim">Back to the original seed. With sync on, this resets the shared workspace for everyone.</p>
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
        <p>All current data in this browser is replaced (and then synced to the shared workspace). You can undo from the toast right after.</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-sg-line bg-sg-bg/40 p-3 text-xs sm:grid-cols-3">
          {pending?.counts.map((c) => (
            <div key={c.key} className="flex justify-between gap-2">
              <span className="truncate text-sg-dim">{c.key}</span>
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
        <p>Your changes are replaced by the demo seed and the reset syncs to the shared workspace. Undo is available from the toast for a few seconds — download a backup first if in doubt.</p>
      </ConfirmModal>
    </Section>
  );
}

/* ───────────── System health ───────────── */

interface Health {
  ok: boolean;
  env?: string;
  latencyMs?: number;
  d1?: { connected: boolean; pingMs?: number; error?: string; counts?: Record<string, number | null> };
  workspace?: { version: number; updatedAt: string; updatedBy: string; bytes: number } | null;
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
};

export function HealthSection() {
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
        <Stat label="Environment" value={health?.env ?? "—"} hint="APP_ENV on the Worker" />
      </div>

      {error && <Callout tone="danger">{error} The app keeps working on local data.</Callout>}
      {health?.d1?.error && <Callout tone="danger">D1: {health.d1.error}</Callout>}

      {connected && (
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

      {connected && (
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
  const [token, setToken] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const seedD1 = async () => {
    setResult(null);
    try {
      const res = await fetch("/api/admin/seed", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; executed?: number; error?: string } | null;
      if (res.ok && body?.ok) {
        setResult({ ok: true, text: `Seeded D1 — ${formatNumber(body.executed ?? 0)} statements executed.` });
        setToken("");
      } else {
        setResult({ ok: false, text: body?.error ?? `Seeding failed (HTTP ${res.status}).` });
      }
    } catch {
      setResult({ ok: false, text: "Seed endpoint unreachable." });
    }
  };

  return (
    <Section id="admin" title="Admin · seed D1" icon={KeyRound} subtitle="Requires the SEED_TOKEN secret">
      <Callout tone="warn">
        Wipes and reloads D1&apos;s relational tables (contacts, companies, deals, issues, initiatives…) from the demo seed. The shared workspace snapshot that the app syncs is
        <span className="font-semibold"> not</span> touched — use Settings › Data to reset that.
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
        <span className="pb-2 text-2xs text-sg-dim">The token is sent once as a Bearer header and never stored.</span>
      </form>
      {result && <Callout tone={result.ok ? "ok" : "danger"}>{result.text}</Callout>}
      <ConfirmModal open={confirm} onOpenChange={setConfirm} title="Wipe and reseed D1?" confirmLabel="Wipe & seed" danger onConfirm={seedD1}>
        <p>All rows in D1&apos;s relational tables are deleted and replaced with the demo seed. This can&apos;t be undone from the app.</p>
      </ConfirmModal>
    </Section>
  );
}
