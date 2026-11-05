"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Bell, Check, CircleAlert, CircleCheck, CircleX, Copy, History, Pencil, Play, Plus, RefreshCw, Search, Sparkles, Trash2, Workflow } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Workflow as WorkflowT } from "@/lib/types";
import { cn, formatDate, relativeTime } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Chip, EmptyState } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlays";
import { AutomationNav, Toggle } from "@/components/automation/nav";
import { actionDef, OBJECT_LABEL, RECIPES, triggerDef, triggerLabel } from "@/components/automation/catalog";
import type { RunOutcome, WfObject } from "@/components/automation/types";
import { recordContext } from "@/components/automation/context";

type Tab = "workflows" | "recipes" | "runs" | "inbox";
const TABS: Tab[] = ["workflows", "recipes", "runs", "inbox"];

const OUTCOME: Record<RunOutcome, { label: string; color: "green" | "yellow" | "red" | "blue" }> = {
  success: { label: "Success", color: "green" },
  partial: { label: "Partial", color: "yellow" },
  failed: { label: "Failed", color: "red" },
  skipped: { label: "Skipped", color: "blue" },
};

export default function AutomationPage() {
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get("tab") as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : "workflows";
  const automationTick = useCrm((s) => s.automationTick);
  const notify = useUi((s) => s.notify);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Automation" meta={<span className="hidden text-xs text-sg-dim sm:inline">Workflows run in this browser on every change you make; time-based triggers are checked every minute.</span>}>
        <Button
          variant="outline"
          size="md"
          onClick={() => {
            const n = automationTick();
            notify(n ? `Scheduled checks ran ${n} workflow${n === 1 ? "" : "s"}` : "Scheduled checks done — nothing due");
          }}
          title="Evaluate SLA-breach, idle and quote-expiry triggers now"
        >
          <RefreshCw /> Run scheduled checks
        </Button>
        <Button variant="primary" size="md" onClick={() => router.push("/automation/workflows/new")}>
          <Plus /> New workflow
        </Button>
      </PageHeader>
      <AutomationNav />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "workflows" ? <WorkflowList /> : tab === "recipes" ? <Recipes onAdded={(id) => router.push(`/automation/workflows/${id}`)} /> : tab === "runs" ? <RunLog /> : <Inbox />}
      </div>
    </div>
  );
}

/* ───────────── workflows ───────────── */

function WorkflowList() {
  const workflows = useCrm((s) => s.workflows);
  const runs = useCrm((s) => s.workflowRuns);
  const updateWorkflow = useCrm((s) => s.updateWorkflow);
  const createWorkflow = useCrm((s) => s.createWorkflow);
  const deleteWorkflow = useCrm((s) => s.deleteWorkflow);
  const restoreWorkflow = useCrm((s) => s.restoreWorkflow);
  const notify = useUi((s) => s.notify);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [object, setObject] = useState<"" | WfObject>("");

  const failing = useMemo(() => {
    const m = new Map<string, number>();
    runs.forEach((r) => {
      if (r.outcome === "failed" || r.outcome === "partial") m.set(r.workflowId, (m.get(r.workflowId) ?? 0) + 1);
    });
    return m;
  }, [runs]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return workflows.filter((w) => (!object || w.trigger.object === object) && (!needle || `${w.name} ${w.description ?? ""} ${triggerLabel(w)} ${w.trigger.condition}`.toLowerCase().includes(needle)));
  }, [workflows, q, object]);

  const duplicate = (w: WorkflowT) => {
    const id = createWorkflow({ name: `${w.name} (copy)`, description: w.description, trigger: { ...w.trigger }, actions: w.actions.map((a) => ({ kind: a.kind, config: { ...a.config } })), enabled: false });
    notify("Workflow duplicated (off until you turn it on)", { label: "Open", run: () => router.push(`/automation/workflows/${id}`) });
  };
  const remove = (w: WorkflowT) => {
    const snap = deleteWorkflow(w.id);
    if (snap) notify(`Deleted “${w.name}”`, { label: "Undo", run: () => restoreWorkflow(snap) });
  };

  return (
    <div className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sg-dim" aria-hidden />
          <Input data-page-filter value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter workflows" className="pl-7" aria-label="Filter workflows" />
        </div>
        <Select value={object} onChange={(e) => setObject(e.target.value as "" | WfObject)} wrapperClassName="w-40" aria-label="Trigger object">
          <option value="">All objects</option>
          {(Object.keys(OBJECT_LABEL) as WfObject[]).map((o) => (
            <option key={o} value={o}>
              {OBJECT_LABEL[o]}
            </option>
          ))}
        </Select>
        <span className="ml-auto text-xs text-sg-dim">
          {workflows.filter((w) => w.enabled).length} of {workflows.length} on
        </span>
      </div>
      {!rows.length ? (
        <div className="rounded-xl border border-sg-line bg-sg-card">
          <EmptyState icon={Workflow} title={workflows.length ? "No workflows match" : "No workflows yet"} action={<Button variant="outline" size="sm" onClick={() => router.push("/automation?tab=recipes")}><Sparkles /> Start from a recipe</Button>}>
            Workflows react to changes — a deal closing, a ticket breaching its SLA, an issue moving to Done — and create tasks, Jira issues or notifications for you.
          </EmptyState>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-sg-line bg-sg-card">
          {rows.map((w) => {
            const timed = triggerDef(w.trigger.object, w.trigger.event)?.timed;
            const issues = failing.get(w.id) ?? 0;
            return (
              <li key={w.id} className="flex flex-wrap items-center gap-3 border-b border-sg-line px-4 py-3 last:border-b-0 hover:bg-sg-card-2/50">
                <Toggle checked={w.enabled} onChange={(v) => { updateWorkflow(w.id, { enabled: v }); notify(v ? `“${w.name}” is on` : `“${w.name}” is off`); }} label={w.enabled ? `Turn off ${w.name}` : `Turn on ${w.name}`} />
                <div className="min-w-0 flex-1">
                  <Link href={`/automation/workflows/${w.id}`} className="font-semibold text-sg-white hover:underline">
                    {w.name}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-sg-dim">
                    <Chip color={timed ? "yellow" : "cyan"}>{OBJECT_LABEL[w.trigger.object as WfObject] ?? w.trigger.object}</Chip>
                    <span className="text-sg-muted">{triggerLabel(w)}</span>
                    {w.trigger.condition ? <code className="rounded-sm bg-sg-bg px-1 font-mono text-[10px] text-sg-muted">if {w.trigger.condition}</code> : null}
                    <span aria-hidden>→</span>
                    {w.actions.map((a, i) => (
                      <Chip key={i} color="blue">
                        {actionDef(a.kind)?.label ?? a.kind}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-right text-2xs text-sg-dim">
                  {issues ? (
                    <Link href={`/automation?tab=runs&wf=${w.id}`} className="flex items-center gap-1 text-soft-orange hover:underline">
                      <CircleAlert className="size-3" aria-hidden /> {issues} with errors
                    </Link>
                  ) : null}
                  <div>
                    <div className="sg-num text-sm font-semibold text-sg-white">{w.runs}</div>
                    runs
                  </div>
                  <div className="w-20">
                    <div className="text-sg-muted">{w.lastRunAt ? relativeTime(w.lastRunAt) : "never"}</div>
                    last run
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Edit ${w.name}`} onClick={() => router.push(`/automation/workflows/${w.id}`)}>
                    <Pencil />
                  </Button>
                  <Menu>
                    <MenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`More actions for ${w.name}`}>
                        <span aria-hidden className="text-base leading-none">⋯</span>
                      </Button>
                    </MenuTrigger>
                    <MenuContent align="end">
                      <MenuItem onSelect={() => router.push(`/automation/workflows/${w.id}?test=1`)}>
                        <Play className="size-3.5" /> Test on a record
                      </MenuItem>
                      <MenuItem onSelect={() => router.push(`/automation?tab=runs&wf=${w.id}`)}>
                        <History className="size-3.5" /> Run history
                      </MenuItem>
                      <MenuItem onSelect={() => duplicate(w)}>
                        <Copy className="size-3.5" /> Duplicate
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem destructive onSelect={() => remove(w)}>
                        <Trash2 className="size-3.5" /> Delete
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-2xs text-sg-dim">
        Loop protection: changes made by a workflow never trigger other workflows. Loading the shared workspace, restoring a backup or undoing a delete doesn’t trigger them either.
      </p>
    </div>
  );
}

/* ───────────── recipes ───────────── */

function Recipes({ onAdded }: { onAdded: (id: string) => void }) {
  const workflows = useCrm((s) => s.workflows);
  const createWorkflow = useCrm((s) => s.createWorkflow);
  const notify = useUi((s) => s.notify);
  const areas = ["Sales", "Service", "Delivery"] as const;
  return (
    <div className="space-y-6 p-4 sm:p-5">
      <p className="max-w-2xl text-sm text-sg-muted">One-click workflows for the hand-offs Spectrum does every week. They’re added switched off so you can check the conditions and test them on a real record first.</p>
      {areas.map((area) => (
        <section key={area}>
          <h2 className="sg-eyebrow mb-2">{area}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {RECIPES.filter((r) => r.area === area).map((r) => {
              const added = workflows.find((w) => w.name === r.workflow.name);
              return (
                <div key={r.id} className="flex flex-col rounded-xl border border-sg-line bg-sg-card p-4">
                  <div className="flex items-start gap-2">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-soft-magenta" aria-hidden />
                    <h3 className="font-display text-sm font-bold text-sg-white">{r.name}</h3>
                  </div>
                  <p className="mt-1 flex-1 text-xs text-sg-muted">{r.description}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Chip color="cyan">{triggerDef(r.workflow.trigger.object, r.workflow.trigger.event)?.label ?? r.workflow.trigger.event}</Chip>
                    {r.workflow.actions.map((a, i) => (
                      <Chip key={i} color="blue">
                        {actionDef(a.kind)?.label ?? a.kind}
                      </Chip>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    {added ? (
                      <>
                        <span className="flex items-center gap-1 text-2xs text-soft-green">
                          <Check className="size-3" aria-hidden /> Added
                        </span>
                        <Link href={`/automation/workflows/${added.id}`} className="ml-auto text-xs font-semibold text-sg-muted hover:text-sg-white">
                          Open →
                        </Link>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const id = createWorkflow({ ...r.workflow, trigger: { ...r.workflow.trigger }, actions: r.workflow.actions.map((a) => ({ kind: a.kind, config: { ...a.config } })), enabled: false });
                          notify(`Added “${r.name}” — switched off until you turn it on`);
                          onAdded(id);
                        }}
                      >
                        <Plus /> Add workflow
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ───────────── run log ───────────── */

function RunLog() {
  const runs = useCrm((s) => s.workflowRuns);
  const workflows = useCrm((s) => s.workflows);
  const users = useCrm((s) => s.users);
  const state = useCrm((s) => s);
  const params = useSearchParams();
  const router = useRouter();
  const [outcome, setOutcome] = useState<"" | RunOutcome>("");
  const wf = params.get("wf") ?? "";
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => runs.filter((r) => (!outcome || r.outcome === outcome) && (!wf || r.workflowId === wf)), [runs, outcome, wf]);
  const counts = useMemo(() => {
    const c: Record<RunOutcome, number> = { success: 0, partial: 0, failed: 0, skipped: 0 };
    runs.filter((r) => !wf || r.workflowId === wf).forEach((r) => (c[r.outcome] += 1));
    return c;
  }, [runs, wf]);

  const setWf = (id: string) => {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set("wf", id);
    else sp.delete("wf");
    sp.set("tab", "runs");
    router.replace(`/automation?${sp.toString()}`);
  };

  return (
    <div className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={wf} onChange={(e) => setWf(e.target.value)} wrapperClassName="w-64" aria-label="Workflow">
          <option value="">All workflows</option>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Outcome">
          {(["", "success", "partial", "failed"] as const).map((o) => (
            <button
              key={o || "all"}
              type="button"
              aria-pressed={outcome === o}
              onClick={() => setOutcome(o)}
              className={cn("h-7 rounded border px-2 text-xs font-semibold", outcome === o ? "border-sg-white/60 bg-sg-card-3 text-sg-white" : "border-sg-line text-sg-muted hover:text-sg-white")}
            >
              {o ? `${OUTCOME[o].label} · ${counts[o]}` : `All · ${counts.success + counts.partial + counts.failed + counts.skipped}`}
            </button>
          ))}
        </div>
        <span className="ml-auto text-2xs text-sg-dim">Newest first · last {runs.length} runs kept</span>
      </div>
      {!rows.length ? (
        <div className="rounded-xl border border-sg-line bg-sg-card">
          <EmptyState icon={History} title="No runs yet">
            Runs appear here when a workflow’s trigger fires and its condition matches, or when you run it on a record.
          </EmptyState>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-sg-line bg-sg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-[0.1em] text-sg-dim">
                <th className="px-4 py-2 font-semibold">When (WIB)</th>
                <th className="px-4 py-2 font-semibold">Workflow</th>
                <th className="px-4 py-2 font-semibold">Record</th>
                <th className="px-4 py-2 font-semibold">Trigger</th>
                <th className="px-4 py-2 font-semibold">Outcome</th>
                <th className="px-4 py-2 font-semibold">By</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r) => {
                const ctx = recordContext(state, r.object, r.recordId);
                const expanded = open === r.id;
                return (
                  <FragmentRow key={r.id}>
                    <tr className="cursor-pointer border-b border-sg-line hover:bg-sg-card-2/60" onClick={() => setOpen(expanded ? null : r.id)} aria-expanded={expanded}>
                      <td className="whitespace-nowrap px-4 py-2 text-sg-muted">{formatDate(r.at, "datetime")}</td>
                      <td className="px-4 py-2 font-semibold text-sg-white">{r.workflowName}</td>
                      <td className="max-w-[260px] truncate px-4 py-2">
                        {ctx.exists && ctx.href ? (
                          <Link href={ctx.href} onClick={(e) => e.stopPropagation()} className="text-sg-text hover:underline">
                            {ctx.label}
                          </Link>
                        ) : (
                          <span className="text-sg-dim" title="This record no longer exists">
                            {r.recordLabel}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-2xs text-sg-muted">
                        {r.source === "manual" ? "Manual run" : r.source === "schedule" ? "Scheduled check" : r.event.replace(/_/g, " ")}
                      </td>
                      <td className="px-4 py-2">
                        <Chip color={OUTCOME[r.outcome].color} dot>
                          {OUTCOME[r.outcome].label}
                        </Chip>
                      </td>
                      <td className="px-4 py-2 text-2xs text-sg-muted">{users.find((u) => u.id === r.actorId)?.name ?? "—"}</td>
                    </tr>
                    {expanded ? (
                      <tr className="border-b border-sg-line bg-sg-bg/40">
                        <td colSpan={6} className="px-4 py-3">
                          <ol className="space-y-1.5">
                            {r.steps.map((st, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs">
                                {st.ok ? <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-soft-green" aria-label="ok" /> : <CircleX className="mt-0.5 size-3.5 shrink-0 text-soft-red" aria-label="failed" />}
                                <span className="font-semibold text-sg-muted">{actionDef(st.kind)?.label ?? st.kind}</span>
                                <span className="text-sg-text">{st.detail}</span>
                                {st.href ? (
                                  <Link href={st.href} className="ml-auto shrink-0 text-2xs text-sg-dim hover:text-sg-white">
                                    Open →
                                  </Link>
                                ) : null}
                              </li>
                            ))}
                          </ol>
                        </td>
                      </tr>
                    ) : null}
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/* ───────────── inbox ───────────── */

function Inbox() {
  const notices = useCrm((s) => s.automationNotices);
  const me = useCrm((s) => s.currentUserId);
  const markNoticeRead = useCrm((s) => s.markNoticeRead);
  const markAllNoticesRead = useCrm((s) => s.markAllNoticesRead);
  const router = useRouter();
  const mine = useMemo(() => notices.filter((n) => n.userId === me).sort((a, b) => b.at.localeCompare(a.at)), [notices, me]);
  const unread = mine.filter((n) => !n.readAt).length;
  return (
    <div className="p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <p className="text-sm text-sg-muted">Notifications that workflows sent to you.</p>
        <Button className="ml-auto" variant="outline" size="sm" disabled={!unread} onClick={markAllNoticesRead}>
          <Check /> Mark all read
        </Button>
      </div>
      {!mine.length ? (
        <div className="rounded-xl border border-sg-line bg-sg-card">
          <EmptyState icon={Bell} title="Nothing for you yet">
            When a workflow’s “Notify someone” action targets you, the message lands here.
          </EmptyState>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-sg-line bg-sg-card">
          {mine.map((n) => (
            <li key={n.id} className={cn("flex items-start gap-3 border-b border-sg-line px-4 py-3 last:border-b-0", !n.readAt && "bg-sg-card-2/50")}>
              <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-sg-line-2" : "bg-soft-magenta")} />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="text-left font-semibold text-sg-white hover:underline"
                  onClick={() => {
                    markNoticeRead(n.id);
                    if (n.href) router.push(n.href);
                  }}
                >
                  {n.title}
                </button>
                <div className="text-2xs text-sg-dim">
                  {n.body} · {relativeTime(n.at)}
                </div>
              </div>
              {!n.readAt ? (
                <Button variant="ghost" size="xs" onClick={() => markNoticeRead(n.id)}>
                  Mark read
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
