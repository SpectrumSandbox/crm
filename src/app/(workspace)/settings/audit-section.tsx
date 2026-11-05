"use client";

/* Settings › Audit trail and Settings › Version history (workspace admins; data from the append-only D1 tables). */
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileDown, History, RefreshCw, RotateCcw, Search, ShieldCheck } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { describeActor } from "@/lib/sync/collections";
import { reloadFromServer } from "@/lib/sync/engine";
import { cn, formatDate, formatNumber, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Chip } from "@/components/ui/misc";
import { AdminOnly, download, useWorkspaceAdmin } from "./data-sections";
import { Callout, ConfirmModal, Section } from "./ui";

interface Change {
  key: string;
  added: number;
  removed: number;
  updated: number;
  count: number;
}

interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  source: string;
  userId: string | null;
  scope: string;
  action: string;
  reason: string;
  baseVersion: number;
  version: number | null;
  bytes: number;
  changed: Change[];
  protected: string[];
  note: string;
  userAgent: string;
}

const ACTION_META: Record<string, { label: string; color: "blue" | "green" | "orange" | "red" | "magenta" | "cyan" | "yellow" }> = {
  create: { label: "Created", color: "green" },
  update: { label: "Saved", color: "blue" },
  rejected: { label: "Rejected", color: "red" },
  rollback: { label: "Rollback", color: "orange" },
  admin_seed: { label: "D1 seed", color: "magenta" },
};
const REASON_LABEL: Record<string, string> = {
  edit: "edit",
  bootstrap: "first upload",
  upgrade: "format upgrade",
  overwrite: "overwrite",
  restore: "backup restore",
  reset: "demo reset",
  merge: "merge",
  rollback: "rollback",
  admin_seed: "admin seed",
};
const FILTERS = [
  { value: "", label: "All writes" },
  { value: "restore", label: "Restores" },
  { value: "reset", label: "Resets" },
  { value: "overwrite", label: "Overwrites" },
  { value: "rejected", label: "Rejected" },
  { value: "rollback", label: "Rollbacks" },
  { value: "admin_seed", label: "D1 seeding" },
];

function changeText(c: Change) {
  const parts = [c.added ? `+${c.added}` : "", c.updated ? `~${c.updated}` : "", c.removed ? `−${c.removed}` : ""].filter(Boolean);
  return `${c.key} ${parts.join(" ")}`;
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Can the server answer the admin endpoints? `ready` once /api/me has been asked; `blocked` says why not when the
 * server locked this browser out (no Cloudflare Access sign-in) or there is no server at all — asking anyway only
 * earns a 401 / network error, so the sections show the reason instead.
 */
function useServerTrail(): { ready: boolean; blocked: string | null } {
  const identity = useCrm((s) => s.identity);
  if (!identity.resolved) return { ready: false, blocked: null };
  if (identity.mode === "locked") return { ready: true, blocked: identity.lockHint || "The server requires a Cloudflare Access sign-in before it serves the shared workspace." };
  if (identity.mode === "offline") return { ready: true, blocked: "No shared server is reachable here — the trail lives on the server." };
  return { ready: true, blocked: null };
}

export function AuditSection() {
  const admin = useWorkspaceAdmin();
  const server = useServerTrail();
  const users = useCrm((s) => s.users);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actor, setActor] = useState("");
  /** actor filter applied on submit (typing doesn't refetch) */
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(
    async (before?: number) => {
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams({ limit: "50" });
        if (before) q.set("before", String(before));
        if (query) q.set("actor", query);
        if (action) q.set("action", action);
        const res = await fetch(`/api/audit?${q.toString()}`, { cache: "no-store", headers: { Accept: "application/json" } });
        const body = (await res.json().catch(() => null)) as { entries?: AuditEntry[]; next?: number | null; error?: string; hint?: string } | null;
        if (!res.ok || !body?.entries) {
          setError([body?.error ?? `HTTP ${res.status}`, body?.hint].filter(Boolean).join(" — "));
          if (!before) setEntries([]);
          return;
        }
        setEntries((prev) => (before ? [...prev, ...(body.entries ?? [])] : body.entries ?? []));
        setNext(body.next ?? null);
      } catch {
        setError("Audit endpoint unreachable — the trail lives on the server.");
      } finally {
        setLoading(false);
      }
    },
    [query, action],
  );

  useEffect(() => {
    if (admin && server.ready && !server.blocked) void load();
  }, [admin, server.ready, server.blocked, load]);

  const exportCsv = () => {
    const head = ["id", "at", "actor", "source", "user_id", "scope", "action", "reason", "base_version", "version", "bytes", "changed", "protected", "note"];
    const lines = entries.map((e) =>
      [e.id, e.at, e.actor, e.source, e.userId ?? "", e.scope, e.action, e.reason, e.baseVersion, e.version ?? "", e.bytes, e.changed.map(changeText).join(" | "), e.protected.join(" | "), e.note].map(csvCell).join(","),
    );
    download(`spectrum-crm-audit-${new Date().toISOString().slice(0, 10)}.csv`, [head.join(","), ...lines].join("\n"), "text/csv");
  };

  if (!admin) {
    return (
      <Section id="audit" title="Audit trail" icon={ShieldCheck} subtitle="Server-side, append-only">
        <AdminOnly what="Reading the server audit trail" />
      </Section>
    );
  }

  return (
    <Section
      id="audit"
      title="Audit trail"
      icon={ShieldCheck}
      subtitle="Every shared-workspace write · append-only in D1 (§9.1, §13.3)"
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={exportCsv} disabled={!entries.length}>
            <FileDown /> CSV
          </Button>
          <Button size="sm" variant="subtle" onClick={() => void load()} disabled={loading || !server.ready || !!server.blocked}>
            <RefreshCw className={loading ? "animate-spin" : undefined} /> Refresh
          </Button>
        </>
      }
    >
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          if (!server.ready || server.blocked) return;
          if (actor.trim() === query) void load();
          else setQuery(actor.trim());
        }}
      >
        <label className="block w-full max-w-xs">
          <span className="mb-1 block text-2xs font-semibold uppercase tracking-[0.12em] text-sg-dim">Actor</span>
          <Input placeholder="email contains…" value={actor} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setActor(String(e.target.value))} />
        </label>
        <label className="block w-44">
          <span className="mb-1 block text-2xs font-semibold uppercase tracking-[0.12em] text-sg-dim">Kind</span>
          <Select value={action} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAction(String(e.target.value))}>
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" size="md" variant="outline">
          <Search /> Search
        </Button>
      </form>

      {server.blocked ? <Callout tone="info">Audit trail unavailable — {server.blocked}</Callout> : error && <Callout tone="warn">{error}</Callout>}

      <div className="overflow-x-auto rounded-lg border border-sg-line">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-sg-bg/40 text-left">
            <tr>
              <th className="sg-eyebrow px-3 py-2">When</th>
              <th className="sg-eyebrow px-3 py-2">Who</th>
              <th className="sg-eyebrow px-3 py-2">What</th>
              <th className="sg-eyebrow px-3 py-2 text-right">Version</th>
              <th className="sg-eyebrow px-3 py-2">Collections</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const meta = ACTION_META[e.action] ?? { label: e.action, color: "blue" as const };
              const expanded = open === e.id;
              return (
                <tr key={e.id} className={cn("cursor-pointer border-t border-sg-line align-top hover:bg-sg-card-2/50", expanded && "bg-sg-card-2/40")} onClick={() => setOpen(expanded ? null : e.id)}>
                  <td className="whitespace-nowrap px-3 py-1.5 text-sg-muted" title={formatDate(e.at, "datetime")}>
                    {relativeTime(e.at)}
                    <div className="text-2xs text-sg-dim">{formatDate(e.at, "datetime")}</div>
                  </td>
                  <td className="px-3 py-1.5 text-sg-text">
                    {describeActor(e.actor, users)}
                    <div className="text-2xs text-sg-dim">
                      {e.source} · scope {e.scope}
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <Chip color={meta.color}>{meta.label}</Chip>
                    {e.reason && e.reason !== "edit" && <span className="ml-1 text-2xs text-sg-dim">{REASON_LABEL[e.reason] ?? e.reason}</span>}
                    {e.note && <div className="mt-0.5 text-2xs text-sg-muted">{e.note}</div>}
                  </td>
                  <td className="sg-num whitespace-nowrap px-3 py-1.5 text-right text-sg-white">
                    {e.version ? `v${e.baseVersion}→v${e.version}` : "—"}
                    <div className="text-2xs text-sg-dim">{e.bytes ? `${formatNumber(Math.round(e.bytes / 1024))} KB` : ""}</div>
                  </td>
                  <td className="px-3 py-1.5 text-sg-muted">
                    {e.changed.length === 0 ? (
                      <span className="text-sg-dim">—</span>
                    ) : expanded ? (
                      <ul className="space-y-0.5">
                        {e.changed.map((c) => (
                          <li key={c.key} className="sg-num">
                            {changeText(c)} <span className="text-sg-dim">({formatNumber(c.count)} now)</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="sg-num">
                        {e.changed.slice(0, 3).map(changeText).join(", ")}
                        {e.changed.length > 3 ? ` +${e.changed.length - 3} more` : ""}
                      </span>
                    )}
                    {expanded && e.protected.length > 0 && <div className="mt-1 text-2xs text-soft-yellow">Kept server copy: {e.protected.join(", ")}</div>}
                    {expanded && e.userAgent && <div className="mt-1 truncate text-2xs text-sg-dim">{e.userAgent}</div>}
                  </td>
                </tr>
              );
            })}
            {!entries.length && !loading && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sg-dim">
                  {error || server.blocked ? "No audit entries loaded." : "No writes recorded yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-2xs text-sg-dim">
        <span>+ added · ~ changed · − removed records. Rows can&apos;t be edited or deleted — D1 triggers reject it. Click a row for details.</span>
        {next && (
          <Button size="xs" variant="ghost" className="ml-auto" onClick={() => void load(next)} disabled={loading}>
            Load older
          </Button>
        )}
      </div>
    </Section>
  );
}

interface VersionRow {
  version: number;
  savedAt: string;
  savedBy: string;
  bytes: number;
}

export function HistorySection() {
  const admin = useWorkspaceAdmin();
  const server = useServerTrail();
  const users = useCrm((s) => s.users);
  const notify = useUi((s) => s.notify);
  const [rows, setRows] = useState<VersionRow[]>([]);
  const [current, setCurrent] = useState<VersionRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<VersionRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workspace/history", { cache: "no-store", headers: { Accept: "application/json" } });
      const body = (await res.json().catch(() => null)) as { versions?: VersionRow[]; current?: VersionRow | null; error?: string; hint?: string } | null;
      if (!res.ok || !body?.versions) {
        setError([body?.error ?? `HTTP ${res.status}`, body?.hint].filter(Boolean).join(" — "));
        return;
      }
      setRows(body.versions);
      setCurrent(body.current ?? null);
    } catch {
      setError("History endpoint unreachable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (admin && server.ready && !server.blocked) void load();
  }, [admin, server.ready, server.blocked, load]);

  const byDay = useMemo(() => {
    const days = new Map<string, number>();
    for (const r of rows) days.set(r.savedAt.slice(0, 10), (days.get(r.savedAt.slice(0, 10)) ?? 0) + 1);
    return days.size;
  }, [rows]);

  const rollback = async () => {
    if (!target) return;
    const res = await fetch("/api/workspace/history", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ version: target.version, currentVersion: current?.version }),
    }).catch(() => null);
    const body = res ? ((await res.json().catch(() => null)) as { version?: number; error?: string; hint?: string } | null) : null;
    if (!res?.ok || !body?.version) {
      notify([body?.error ?? "Rollback failed", body?.hint].filter(Boolean).join(" — "));
      return;
    }
    const err = await reloadFromServer();
    notify(err ?? `Rolled back: v${body.version} now holds the data of v${target.version}`);
    void load();
  };

  if (!admin) {
    return (
      <Section id="history" title="Version history" icon={History} subtitle="Server snapshots">
        <AdminOnly what="Rolling the shared workspace back" />
      </Section>
    );
  }

  return (
    <Section
      id="history"
      title="Version history"
      icon={History}
      subtitle="Last 20 versions + one per day for 30 days"
      actions={
        <Button size="sm" variant="subtle" onClick={() => void load()} disabled={loading || !server.ready || !!server.blocked}>
          <RefreshCw className={loading ? "animate-spin" : undefined} /> Refresh
        </Button>
      }
    >
      {server.blocked ? <Callout tone="info">Version history unavailable — {server.blocked}</Callout> : error && <Callout tone="warn">{error}</Callout>}
      {current && (
        <p className="text-xs text-sg-muted">
          Current: <Chip color="green">v{current.version}</Chip> saved {relativeTime(current.savedAt)} by {describeActor(current.savedBy, users)} · {rows.length} earlier version
          {rows.length === 1 ? "" : "s"} kept across {byDay} day{byDay === 1 ? "" : "s"}.
        </p>
      )}
      {rows.length > 0 && (
        <div className="max-h-72 overflow-y-auto rounded-lg border border-sg-line">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-sg-card text-left">
              <tr>
                <th className="sg-eyebrow px-3 py-2">Version</th>
                <th className="sg-eyebrow px-3 py-2">Saved</th>
                <th className="sg-eyebrow px-3 py-2">By</th>
                <th className="sg-eyebrow px-3 py-2 text-right">Size</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.version} className="border-t border-sg-line">
                  <td className="sg-num px-3 py-1.5 text-sg-white">v{r.version}</td>
                  <td className="px-3 py-1.5 text-sg-muted" title={formatDate(r.savedAt, "datetime")}>
                    {formatDate(r.savedAt, "datetime")}
                  </td>
                  <td className="px-3 py-1.5 text-sg-text">{describeActor(r.savedBy, users)}</td>
                  <td className="sg-num px-3 py-1.5 text-right text-sg-muted">{formatNumber(Math.round(r.bytes / 1024))} KB</td>
                  <td className="px-3 py-1.5 text-right">
                    <Button size="xs" variant="ghost" onClick={() => setTarget(r)}>
                      <RotateCcw /> Roll back
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!rows.length && !error && !loading && <p className="text-xs text-sg-dim">No earlier versions kept yet — they appear after the next save.</p>}
      <ConfirmModal
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title={target ? `Roll back to v${target.version}?` : "Roll back?"}
        description="The old data becomes a new version for everyone."
        confirmLabel="Roll back"
        danger
        onConfirm={rollback}
      >
        <p>
          Everyone&apos;s workspace returns to the data saved {target ? formatDate(target.savedAt, "datetime") : ""}. The current version stays in this history, and audit-log entries
          recorded since are kept. Unsynced edits in this browser are replaced.
        </p>
      </ConfirmModal>
    </Section>
  );
}
