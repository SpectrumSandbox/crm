"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, CircleX, Info, Play, Plus, Trash2, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Workflow } from "@/lib/types";
import { cn, formatDate, uid } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Chip, Kbd } from "@/components/ui/misc";
import { Combobox } from "@/components/ui/combobox";
import { confirm } from "@/components/ui/confirm";
import { ACTIONS, actionAllowed, actionDef, FIELDS, OBJECT_LABEL, OPERATORS, TRIGGERS, triggerDef, type ActionField, type Operator } from "./catalog";
import { parseCondition, serializeCondition, type Clause } from "./conditions";
import { recordsFor } from "./context";
import { runWorkflow, type Api, type RunResult } from "./runtime";
import { Toggle } from "./nav";
import type { WfObject } from "./types";

interface Draft {
  name: string;
  description: string;
  enabled: boolean;
  object: WfObject;
  event: string;
  groups: Clause[][];
  raw: string;
  advanced: boolean;
  actions: { key: string; kind: string; config: Record<string, string> }[];
}

const blankClause = (object: WfObject): Clause => ({ field: FIELDS[object][0]?.field ?? "", op: "=", value: "" });

function toDraft(w: Workflow | null): Draft {
  if (!w) return { name: "", description: "", enabled: false, object: "deal", event: "stage_changed", groups: [[{ field: "closed", op: "=", value: "won" }]], raw: "closed = won", advanced: false, actions: [{ key: uid("ak"), kind: "create_task", config: { title: "Follow up on {{deal.name}}", due_in_days: "1", assignee: "record.owner" } }] };
  const parsed = parseCondition(w.trigger.condition);
  return {
    name: w.name,
    description: w.description ?? "",
    enabled: w.enabled,
    object: w.trigger.object as WfObject,
    event: w.trigger.event,
    groups: parsed.groups,
    raw: w.trigger.condition,
    advanced: parsed.errors.length > 0,
    actions: w.actions.map((a) => ({ key: uid("ak"), kind: a.kind, config: { ...a.config } })),
  };
}

export function WorkflowBuilder({ workflowId, openTest }: { workflowId: string | null; openTest?: boolean }) {
  const workflows = useCrm((s) => s.workflows);
  const existing = workflowId ? (workflows.find((w) => w.id === workflowId) ?? null) : null;
  const createWorkflow = useCrm((s) => s.createWorkflow);
  const updateWorkflow = useCrm((s) => s.updateWorkflow);
  const deleteWorkflow = useCrm((s) => s.deleteWorkflow);
  const restoreWorkflow = useCrm((s) => s.restoreWorkflow);
  const notify = useUi((s) => s.notify);
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(existing));
  const [showErrors, setShowErrors] = useState(false);
  const loadedId = existing?.id ?? null;
  useEffect(() => {
    setDraft(toDraft(existing));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedId]);

  const condition = draft.advanced ? draft.raw.trim() : serializeCondition(draft.groups);
  const parsed = useMemo(() => parseCondition(condition), [condition]);
  const knownFields = new Set(FIELDS[draft.object].map((f) => f.field));
  const unknownFields = Array.from(new Set(parsed.groups.flat().map((c) => c.field).filter((f) => !knownFields.has(f))));

  const errors = useMemo(() => {
    const out: string[] = [];
    if (!draft.name.trim()) out.push("Give the workflow a name");
    if (!triggerDef(draft.object, draft.event)) out.push("Pick a trigger");
    if (!draft.actions.length) out.push("Add at least one action");
    if (parsed.errors.length) out.push(`Can't read condition: ${parsed.errors.join("; ")}`);
    draft.actions.forEach((a, i) => {
      const def = actionDef(a.kind);
      if (!def) return out.push(`Action ${i + 1}: unknown action ${a.kind}`);
      if (!actionAllowed(def, draft.object)) out.push(`Action ${i + 1}: ${def.label} doesn't apply to a ${OBJECT_LABEL[draft.object].toLowerCase()}`);
      if (a.kind === "email_contact" && !a.config.template) out.push(`Action ${i + 1}: pick a template`);
      if (a.kind === "enrol_sequence" && !a.config.sequence) out.push(`Action ${i + 1}: pick a sequence`);
      if (a.kind === "set_property" && !(a.config.value ?? "").trim()) out.push(`Action ${i + 1}: enter a value`);
      if (a.kind === "assign_round_robin" && (a.config.pool ?? "").split(",").filter(Boolean).length < 2) out.push(`Action ${i + 1}: pick at least two people to rotate between`);
    });
    return out;
  }, [draft, parsed]);

  const toWorkflow = (): Pick<Workflow, "name" | "trigger" | "actions"> & { description: string; enabled: boolean } => ({
    name: draft.name.trim(),
    description: draft.description.trim(),
    enabled: draft.enabled,
    trigger: { object: draft.object, event: draft.event, condition },
    actions: draft.actions.map((a) => ({ kind: a.kind, config: a.config })),
  });

  const save = (): string | null => {
    if (errors.length) {
      setShowErrors(true);
      return null;
    }
    const w = toWorkflow();
    if (existing) {
      updateWorkflow(existing.id, w);
      notify(`Saved “${w.name}”${w.enabled ? "" : " (off)"}`);
      return existing.id;
    }
    const id = createWorkflow(w);
    notify(`Created “${w.name}”${w.enabled ? "" : " — switched off until you turn it on"}`);
    router.replace(`/automation/workflows/${id}`);
    return id;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const setObject = (object: WfObject) => {
    const firstEvent = TRIGGERS.find((t) => t.object === object)?.event ?? "created";
    setDraft((d) => ({ ...d, object, event: firstEvent, groups: [], raw: "", actions: d.actions.filter((a) => { const def = actionDef(a.kind); return !def || actionAllowed(def, object); }) }));
  };

  const updateClause = (gi: number, ci: number, patch: Partial<Clause>) => setDraft((d) => ({ ...d, groups: d.groups.map((g, i) => (i === gi ? g.map((c, j) => (j === ci ? { ...c, ...patch } : c)) : g)) }));
  const removeClause = (gi: number, ci: number) => setDraft((d) => ({ ...d, groups: d.groups.map((g, i) => (i === gi ? g.filter((_, j) => j !== ci) : g)).filter((g) => g.length) }));
  const moveAction = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const next = [...d.actions];
      const j = i + dir;
      if (j < 0 || j >= next.length) return d;
      [next[i], next[j]] = [next[j], next[i]];
      return { ...d, actions: next };
    });

  const trig = triggerDef(draft.object, draft.event);

  return (
    <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        {/* basics */}
        <section className="rounded-xl border border-sg-line bg-sg-card p-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field label="Workflow name" required error={showErrors && !draft.name.trim() ? "Required" : undefined}>
              <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Deal won → onboarding epic" autoFocus={!existing} />
            </Field>
            <div className="flex items-end gap-2 pb-1.5">
              <Toggle checked={draft.enabled} onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))} label={draft.enabled ? "Workflow on" : "Workflow off"} />
              <span className="text-xs text-sg-muted">{draft.enabled ? "On" : "Off"}</span>
            </div>
          </div>
          <Field label="What it’s for" className="mt-3">
            <Input value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="One line for your teammates" />
          </Field>
        </section>

        {/* trigger */}
        <section className="rounded-xl border border-sg-line bg-sg-card p-4">
          <h2 className="sg-eyebrow mb-2">1 · When</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Object">
              <Select value={draft.object} onChange={(e) => setObject(e.target.value as WfObject)}>
                {(Object.keys(OBJECT_LABEL) as WfObject[]).map((o) => (
                  <option key={o} value={o}>
                    {OBJECT_LABEL[o]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Event" hint={trig?.timed ? "Time-based: checked every minute; fires once per record per occurrence." : undefined}>
              <Select value={draft.event} onChange={(e) => setDraft((d) => ({ ...d, event: e.target.value }))}>
                {TRIGGERS.filter((t) => t.object === draft.object).map((t) => (
                  <option key={t.event} value={t.event}>
                    {t.label}
                    {t.timed ? " (scheduled)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {trig?.hint ? (
            <p className="mt-2 flex items-center gap-1.5 text-2xs text-sg-dim">
              <Info className="size-3" aria-hidden /> Example condition: <code className="font-mono text-sg-muted">{trig.hint}</code>
            </p>
          ) : null}

          <div className="mt-4 flex items-center gap-2">
            <h3 className="sg-eyebrow">Only if</h3>
            <button type="button" className="ml-auto text-2xs font-semibold text-sg-dim hover:text-sg-white" onClick={() => setDraft((d) => (d.advanced ? { ...d, advanced: false, groups: parseCondition(d.raw).groups } : { ...d, advanced: true, raw: serializeCondition(d.groups) }))}>
              {draft.advanced ? "Use the condition builder" : "Edit as text"}
            </button>
          </div>
          {draft.advanced ? (
            <div className="mt-2">
              <Input value={draft.raw} onChange={(e) => setDraft((d) => ({ ...d, raw: e.target.value }))} placeholder="stage = Closed Won AND amount > 1000000000" className="font-mono text-xs" aria-label="Condition" />
              <p className="mt-1 text-2xs text-sg-dim">Clauses are <code className="font-mono">field op value</code> joined by AND; join groups with OR. Operators: {OPERATORS.join(" ")}.</p>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              {!draft.groups.length ? <p className="text-xs text-sg-dim">No condition — runs every time the event happens.</p> : null}
              {draft.groups.map((g, gi) => (
                <div key={gi} className="rounded-lg border border-sg-line bg-sg-bg/40 p-2">
                  {gi > 0 ? <div className="mb-1 text-2xs font-bold uppercase tracking-[0.12em] text-soft-yellow">or</div> : null}
                  {g.map((c, ci) => (
                    <ClauseRow key={ci} object={draft.object} clause={c} first={ci === 0} onChange={(p) => updateClause(gi, ci, p)} onRemove={() => removeClause(gi, ci)} />
                  ))}
                  <button type="button" className="mt-1 flex items-center gap-1 text-2xs font-semibold text-sg-dim hover:text-sg-white" onClick={() => setDraft((d) => ({ ...d, groups: d.groups.map((x, i) => (i === gi ? [...x, blankClause(d.object)] : x)) }))}>
                    <Plus className="size-3" aria-hidden /> And
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <Button variant="outline" size="xs" onClick={() => setDraft((d) => ({ ...d, groups: d.groups.length ? d.groups.map((x, i) => (i === d.groups.length - 1 ? [...x, blankClause(d.object)] : x)) : [[blankClause(d.object)]] }))}>
                  <Plus /> Condition
                </Button>
                {draft.groups.length ? (
                  <Button variant="ghost" size="xs" onClick={() => setDraft((d) => ({ ...d, groups: [...d.groups, [blankClause(d.object)]] }))}>
                    <Plus /> Or group
                  </Button>
                ) : null}
              </div>
              {condition ? <code className="block rounded bg-sg-bg px-2 py-1 font-mono text-[11px] text-sg-muted">if {condition}</code> : null}
            </div>
          )}
          {unknownFields.length ? (
            <p className="mt-2 flex items-center gap-1.5 text-2xs text-soft-orange">
              <CircleAlert className="size-3" aria-hidden /> Not a {OBJECT_LABEL[draft.object].toLowerCase()} field: {unknownFields.join(", ")} — those clauses never match.
            </p>
          ) : null}
        </section>

        {/* actions */}
        <section className="rounded-xl border border-sg-line bg-sg-card p-4">
          <h2 className="sg-eyebrow mb-2">2 · Then</h2>
          <ol className="space-y-3">
            {draft.actions.map((a, i) => (
              <li key={a.key} className="rounded-lg border border-sg-line bg-sg-bg/40 p-3">
                <div className="flex items-center gap-2">
                  <span className="sg-num flex size-5 shrink-0 items-center justify-center rounded-full bg-sg-card-3 text-2xs font-bold text-sg-muted">{i + 1}</span>
                  <Select
                    value={a.kind}
                    onChange={(e) => {
                      const def = actionDef(e.target.value);
                      const config: Record<string, string> = {};
                      def?.fields.forEach((f) => {
                        if (f.default !== undefined) config[f.key] = f.default;
                      });
                      setDraft((d) => ({ ...d, actions: d.actions.map((x) => (x.key === a.key ? { ...x, kind: e.target.value, config } : x)) }));
                    }}
                    wrapperClassName="w-64"
                    aria-label={`Action ${i + 1}`}
                  >
                    {ACTIONS.filter((def) => actionAllowed(def, draft.object) || def.kind === a.kind).map((def) => (
                      <option key={def.kind} value={def.kind}>
                        {def.label}
                      </option>
                    ))}
                  </Select>
                  <div className="ml-auto flex items-center gap-0.5">
                    <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} onClick={() => moveAction(i, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={i === draft.actions.length - 1} onClick={() => moveAction(i, 1)}>
                      <ArrowDown />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Remove action" onClick={() => setDraft((d) => ({ ...d, actions: d.actions.filter((x) => x.key !== a.key) }))}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {(actionDef(a.kind)?.fields ?? []).map((f) => (
                    <ActionFieldInput key={f.key} field={f} object={draft.object} value={a.config[f.key] ?? ""} onChange={(v) => setDraft((d) => ({ ...d, actions: d.actions.map((x) => (x.key === a.key ? { ...x, config: { ...x.config, [f.key]: v } } : x)) }))} />
                  ))}
                </div>
              </li>
            ))}
          </ol>
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            onClick={() => {
              const def = ACTIONS.find((x) => actionAllowed(x, draft.object))!;
              const config: Record<string, string> = {};
              def.fields.forEach((f) => {
                if (f.default !== undefined) config[f.key] = f.default;
              });
              setDraft((d) => ({ ...d, actions: [...d.actions, { key: uid("ak"), kind: def.kind, config }] }));
            }}
          >
            <Plus /> Add action
          </Button>
          <p className="mt-2 text-2xs text-sg-dim">
            Templates in text fields: {"{{record.name}}"}, {"{{trigger}}"}, {"{{contact.first_name}}"}, {"{{company.name}}"}, {"{{deal.name}}"}, {"{{issue.key}}"}, {"{{idle_days}}"} …
          </p>
        </section>

        {showErrors && errors.length ? (
          <div role="alert" className="rounded-xl border border-soft-red/40 bg-soft-red/10 p-3 text-xs text-soft-red">
            <ul className="list-inside list-disc space-y-0.5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={save}>
            {existing ? "Save workflow" : "Create workflow"} <Kbd className="ml-1 border-sg-bg/30 bg-transparent text-sg-bg/70">⌘↵</Kbd>
          </Button>
          <Button variant="ghost" onClick={() => router.push("/automation")}>
            Cancel
          </Button>
          {existing ? (
            <Button
              className="ml-auto"
              variant="danger"
              onClick={async () => {
                if (!(await confirm({ title: `Delete “${existing.name}”?`, body: "Its run history stays in the log. You can undo from the toast.", confirmLabel: "Delete", tone: "danger" }))) return;
                const snap = deleteWorkflow(existing.id);
                router.push("/automation");
                if (snap) notify(`Deleted “${existing.name}”`, { label: "Undo", run: () => restoreWorkflow(snap) });
              }}
            >
              <Trash2 /> Delete
            </Button>
          ) : null}
        </div>
      </div>

      <aside className="space-y-4">
        <TestPanel draft={{ ...toWorkflow(), id: existing?.id ?? "draft", runs: existing?.runs ?? 0, lastRunAt: existing?.lastRunAt ?? null }} saved={existing} onSave={save} defaultOpen={openTest} dirty={!existing || JSON.stringify(toWorkflow()) !== JSON.stringify({ name: existing.name, description: existing.description ?? "", enabled: existing.enabled, trigger: existing.trigger, actions: existing.actions })} />
        {existing ? <History workflowId={existing.id} /> : null}
      </aside>
    </div>
  );
}

function ClauseRow({ object, clause, first, onChange, onRemove }: { object: WfObject; clause: Clause; first: boolean; onChange: (p: Partial<Clause>) => void; onRemove: () => void }) {
  const fields = FIELDS[object];
  const def = fields.find((f) => f.field === clause.field);
  const listId = `opts-${object}-${clause.field}`;
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
      <span className="w-8 text-2xs font-bold uppercase tracking-[0.1em] text-sg-dim">{first ? "if" : "and"}</span>
      <Select value={def ? clause.field : "__custom"} onChange={(e) => onChange({ field: e.target.value === "__custom" ? clause.field : e.target.value })} wrapperClassName="w-48" aria-label="Field">
        {fields.map((f) => (
          <option key={f.field} value={f.field}>
            {f.label}
          </option>
        ))}
        {!def ? <option value="__custom">{clause.field} (unknown)</option> : null}
      </Select>
      <Select value={clause.op} onChange={(e) => onChange({ op: e.target.value as Operator })} wrapperClassName="w-24" aria-label="Operator">
        {OPERATORS.filter((o) => (def?.kind === "number" ? o !== "contains" : def?.kind === "bool" ? o === "=" || o === "!=" : true)).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
      {def?.kind === "bool" ? (
        <Select value={clause.value || "true"} onChange={(e) => onChange({ value: e.target.value })} wrapperClassName="w-28" aria-label="Value">
          <option value="true">true</option>
          <option value="false">false</option>
        </Select>
      ) : (
        <>
          <Input value={clause.value} onChange={(e) => onChange({ value: e.target.value })} list={def?.options ? listId : undefined} inputMode={def?.kind === "number" ? "decimal" : undefined} placeholder={def?.kind === "number" ? "0" : "value"} className="w-48" aria-label="Value" />
          {def?.options ? (
            <datalist id={listId}>
              {def.options.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          ) : null}
        </>
      )}
      <Button variant="ghost" size="icon-sm" aria-label="Remove condition" onClick={onRemove}>
        <X />
      </Button>
    </div>
  );
}

function ActionFieldInput({ field, value, onChange, object }: { field: ActionField; value: string; onChange: (v: string) => void; object: WfObject }) {
  const users = useCrm((s) => s.users);
  const projects = useCrm((s) => s.projects);
  const templates = useCrm((s) => s.emailTemplates);
  const sequences = useCrm((s) => s.sequences);
  const pipelines = useCrm((s) => s.pipelines);
  const wide = field.kind === "textarea" || field.kind === "users" || field.key === "summary" || field.key === "message" || field.key === "title";
  const cls = wide ? "sm:col-span-2" : undefined;
  if (field.kind === "textarea")
    return (
      <Field label={field.label} hint={field.hint} className={cls}>
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className="min-h-[64px]" />
      </Field>
    );
  if (field.kind === "select")
    return (
      <Field label={field.label} hint={field.hint} className={cls}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  if (field.kind === "user")
    return (
      <Field label={field.label} hint={field.hint} className={cls}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          <optgroup label="A specific person">
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </optgroup>
        </Select>
      </Field>
    );
  if (field.kind === "users") {
    const picked = new Set(value.split(",").filter(Boolean));
    return (
      <Field label={field.label} hint={field.hint} className={cls}>
        <div className="flex flex-wrap gap-1.5">
          {users.map((u) => {
            const on = picked.has(u.id);
            return (
              <button
                key={u.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = new Set(picked);
                  if (on) next.delete(u.id);
                  else next.add(u.id);
                  onChange(Array.from(next).join(","));
                }}
                className={cn("h-6 rounded-sm border px-1.5 text-2xs font-semibold", on ? "border-soft-cyan/50 bg-soft-cyan/15 text-soft-cyan" : "border-sg-line text-sg-muted hover:text-sg-white")}
              >
                {u.name}
              </button>
            );
          })}
        </div>
      </Field>
    );
  }
  if (field.kind === "project")
    return (
      <Field label={field.label} hint={field.hint} className={cls}>
        <Select value={value || "auto-by-capability"} onChange={(e) => onChange(e.target.value)}>
          <option value="auto-by-capability">{object === "issue" ? "Same project as the issue" : "By capability (UAV / IOT / SWD)"}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} — {p.name}
            </option>
          ))}
        </Select>
      </Field>
    );
  if (field.kind === "template")
    return (
      <Field label={field.label} hint={!templates.some((t) => t.id === value) && value ? `Template ${value} is missing — add it under Templates › Starter library` : field.hint} className={cls}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Pick a template…</option>
          {value && !templates.some((t) => t.id === value) ? <option value={value}>{value} (missing)</option> : null}
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.templateChannel === "whatsapp" ? " · WhatsApp" : ""}
            </option>
          ))}
        </Select>
      </Field>
    );
  if (field.kind === "sequence")
    return (
      <Field label={field.label} hint={field.hint} className={cls}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Pick a sequence…</option>
          {sequences.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}
              {q.active ? "" : " (paused)"}
            </option>
          ))}
        </Select>
      </Field>
    );
  if (field.kind === "stage") {
    const stages = pipelines.filter((p) => p.objectType === "ticket").flatMap((p) => p.stages);
    return (
      <Field label={field.label} hint={field.hint} className={cls}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          {stages.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  return (
    <Field label={field.label} hint={field.hint} className={cls}>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} inputMode={field.kind === "number" ? "numeric" : undefined} />
    </Field>
  );
}

/* ───────────── test panel ───────────── */

function TestPanel({ draft, saved, onSave, defaultOpen, dirty }: { draft: Workflow; saved: Workflow | null; onSave: () => string | null; defaultOpen?: boolean; dirty: boolean }) {
  const state = useCrm((s) => s);
  const runWorkflowNow = useCrm((s) => s.runWorkflowNow);
  const notify = useUi((s) => s.notify);
  const object = draft.trigger.object as WfObject;
  const options = useMemo(() => recordsFor(state, object).map((r) => ({ value: r.id, label: r.label })), [state, object]);
  const [recordId, setRecordId] = useState<string>("");
  const [ignore, setIgnore] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [mode, setMode] = useState<"dry" | "real" | null>(null);
  useEffect(() => {
    setRecordId("");
    setResult(null);
  }, [object]);

  const dryRun = () => {
    if (!recordId) return;
    const api: Api = { get: () => useCrm.getState(), set: () => undefined, uid };
    setResult(runWorkflow(api, draft, { object, event: draft.trigger.event, recordId, description: "test run" }, { source: "manual", dryRun: true, ignoreCondition: ignore }));
    setMode("dry");
  };
  const runNow = async () => {
    if (!recordId) return;
    const id = dirty ? onSave() : saved?.id;
    if (!id) return;
    if (!(await confirm({ title: "Run this workflow for real?", body: "Its actions will create and change records exactly as they would on a real trigger. The run is logged.", confirmLabel: "Run now" }))) return;
    const r = runWorkflowNow(id, object, recordId, { ignoreCondition: ignore });
    setResult(r);
    setMode("real");
    if (r?.run) notify(`Ran “${draft.name}” — ${r.run.outcome}`);
    else if (r && !r.trace.pass) notify("Condition didn't match — nothing ran");
  };

  return (
    <section className="rounded-xl border border-sg-line bg-sg-card p-4" aria-labelledby="wf-test">
      <h2 id="wf-test" className="sg-eyebrow mb-2">
        Test on a record
      </h2>
      <Combobox value={recordId} onChange={(v) => { setRecordId(v ?? ""); setResult(null); }} options={options} placeholder={`Pick a ${OBJECT_LABEL[object].toLowerCase()}…`} searchPlaceholder="Type to search…" />
      <label className="mt-2 flex items-center gap-2 text-2xs text-sg-muted">
        <input type="checkbox" checked={ignore} onChange={(e) => setIgnore(e.target.checked)} className="accent-current" /> Run even if the condition doesn’t match
      </label>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="outline" disabled={!recordId} onClick={dryRun} autoFocus={defaultOpen}>
          Dry run
        </Button>
        <Button size="sm" variant="subtle" disabled={!recordId} onClick={runNow} title={dirty ? "Saves your changes first" : undefined}>
          <Play /> Run now
        </Button>
      </div>
      {result ? (
        <div className="mt-3 space-y-2 text-xs">
          <div className="flex items-center gap-1.5 font-semibold">
            {result.trace.pass ? <CircleCheck className="size-3.5 text-soft-green" aria-hidden /> : <CircleX className="size-3.5 text-soft-red" aria-hidden />}
            <span className={result.trace.pass ? "text-soft-green" : "text-soft-red"}>{result.trace.groups.length ? (result.trace.pass ? "Condition matches" : "Condition doesn’t match") : "No condition — always runs"}</span>
          </div>
          {result.trace.groups.map((g, gi) => (
            <ul key={gi} className="space-y-0.5 rounded border border-sg-line p-2">
              {gi > 0 ? <li className="text-2xs font-bold uppercase text-soft-yellow">or</li> : null}
              {g.map((c, ci) => (
                <li key={ci} className="flex items-start gap-1.5">
                  {c.pass ? <CircleCheck className="mt-0.5 size-3 shrink-0 text-soft-green" aria-label="pass" /> : <CircleX className="mt-0.5 size-3 shrink-0 text-soft-red" aria-label="fail" />}
                  <span>
                    <code className="font-mono text-sg-muted">
                      {c.field} {c.op} {c.value}
                    </code>
                    <span className="text-sg-dim"> — actual: </span>
                    <span className="text-sg-text">{c.actual}</span>
                  </span>
                </li>
              ))}
            </ul>
          ))}
          {result.steps.length ? (
            <div>
              <div className="sg-eyebrow mb-1">{mode === "dry" ? "Would do" : "Did"}</div>
              <ol className="space-y-1">
                {result.steps.map((st, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    {st.ok ? <CircleCheck className="mt-0.5 size-3 shrink-0 text-soft-green" aria-label="ok" /> : <CircleX className="mt-0.5 size-3 shrink-0 text-soft-red" aria-label="failed" />}
                    <span className="text-sg-text">{st.detail}</span>
                    {st.href && mode === "real" ? (
                      <Link href={st.href} className="ml-auto shrink-0 text-2xs text-sg-dim hover:text-sg-white">
                        Open →
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-2xs text-sg-dim">A dry run shows every clause with the record’s actual value and what each action would do, without changing anything.</p>
      )}
    </section>
  );
}

function History({ workflowId }: { workflowId: string }) {
  const runs = useCrm((s) => s.workflowRuns);
  const mine = useMemo(() => runs.filter((r) => r.workflowId === workflowId).slice(0, 8), [runs, workflowId]);
  return (
    <section className="rounded-xl border border-sg-line bg-sg-card p-4">
      <div className="mb-2 flex items-center">
        <h2 className="sg-eyebrow">Recent runs</h2>
        <Link href={`/automation?tab=runs&wf=${workflowId}`} className="ml-auto text-2xs text-sg-dim hover:text-sg-white">
          All runs →
        </Link>
      </div>
      {!mine.length ? (
        <p className="text-2xs text-sg-dim">Not run yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {mine.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-xs">
              <Chip color={r.outcome === "success" ? "green" : r.outcome === "partial" ? "yellow" : r.outcome === "failed" ? "red" : "blue"}>{r.outcome}</Chip>
              <span className="min-w-0 flex-1 truncate text-sg-text">{r.recordLabel}</span>
              <span className="shrink-0 text-2xs text-sg-dim">{formatDate(r.at, "short")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
