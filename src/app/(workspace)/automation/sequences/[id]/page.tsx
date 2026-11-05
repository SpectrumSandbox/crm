"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, History, ListChecks, Play, Plus, Square, Trash2, TriangleAlert, UserMinus, UserPlus } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { SequenceEnrollment, SequenceStep } from "@/lib/types";
import { cn, formatDate, relativeTime, uid } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Chip, EmptyState } from "@/components/ui/misc";
import { AutomationNav, Toggle } from "@/components/automation/nav";
import { EnrolDialog } from "@/components/automation/enrol-dialog";
import { STEP_ICON, StepQueue, useQueue } from "@/components/automation/step-queue";
import { dueAtOf, ENROLLMENT_STATUS_META, sortedSteps, STEP_KIND_LABEL } from "@/components/automation/sequences";
import { templateChannelOf } from "@/components/automation/tokens";

export default function SequencePage() {
  const { id } = useParams<{ id: string }>();
  const seq = useCrm((s) => s.sequences.find((q) => q.id === id));
  const [enrolOpen, setEnrolOpen] = useState(false);
  const queue = useQueue("all", id);
  if (!seq)
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Sequence" crumbs={[{ href: "/automation/sequences", label: "Sequences" }]} />
        <EmptyState icon={ListChecks} title="Sequence not found">
          It may have been deleted. <Link href="/automation/sequences" className="underline">Back to sequences</Link>
        </EmptyState>
      </div>
    );
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={seq.name} crumbs={[{ href: "/automation", label: "Automation" }, { href: "/automation/sequences?tab=sequences", label: "Sequences" }]}>
        <Button variant="primary" size="md" onClick={() => setEnrolOpen(true)} disabled={!seq.active} title={seq.active ? undefined : "Turn the sequence on to enrol contacts"}>
          <UserPlus /> Enrol contacts
        </Button>
      </PageHeader>
      <AutomationNav />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-4">
            <Settings key={seq.id} sequenceId={seq.id} />
            <StepsEditor key={`steps-${seq.id}`} sequenceId={seq.id} />
            <Enrolments sequenceId={seq.id} />
          </div>
          <aside className="space-y-4">
            <section className="overflow-hidden rounded-xl border border-sg-line bg-sg-card">
              <h2 className="sg-eyebrow border-b border-sg-line px-4 py-2.5">Due steps · {queue.length}</h2>
              <StepQueue rows={queue} compact />
            </section>
            <Analytics sequenceId={seq.id} />
          </aside>
        </div>
      </div>
      <EnrolDialog open={enrolOpen} onOpenChange={setEnrolOpen} sequenceId={seq.id} />
    </div>
  );
}

function Settings({ sequenceId }: { sequenceId: string }) {
  const seq = useCrm((s) => s.sequences.find((q) => q.id === sequenceId))!;
  const users = useCrm((s) => s.users);
  const updateSequence = useCrm((s) => s.updateSequence);
  const notify = useUi((s) => s.notify);
  const [name, setName] = useState(seq.name);
  const [description, setDescription] = useState(seq.description ?? "");
  return (
    <section className="rounded-xl border border-sg-line bg-sg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== seq.name && updateSequence(seq.id, { name: name.trim() })} />
        </Field>
        <Field label="Owner">
          <Select value={seq.ownerId} onChange={(e) => updateSequence(seq.id, { ownerId: e.target.value })}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What it’s for" className="sm:col-span-2">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => description !== (seq.description ?? "") && updateSequence(seq.id, { description })} placeholder="Who should be enrolled, and the goal" />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-5 text-xs text-sg-muted">
        <label className="flex items-center gap-2">
          <Toggle checked={seq.active} onChange={(v) => { updateSequence(seq.id, { active: v }); notify(v ? "Sequence running" : "Sequence paused — no steps come due"); }} label="Sequence running" /> Running
        </label>
        <label className="flex items-center gap-2">
          <Toggle checked={seq.stopOnReply !== false} onChange={(v) => updateSequence(seq.id, { stopOnReply: v })} label="Stop on reply" /> Pause a contact when they reply (inbound email / WhatsApp, connected inbound call or a meeting)
        </label>
      </div>
    </section>
  );
}

function StepsEditor({ sequenceId }: { sequenceId: string }) {
  const seq = useCrm((s) => s.sequences.find((q) => q.id === sequenceId))!;
  const templates = useCrm((s) => s.emailTemplates);
  const enrollments = useCrm((s) => s.sequenceEnrollments);
  const updateSequence = useCrm((s) => s.updateSequence);
  const notify = useUi((s) => s.notify);
  const [steps, setSteps] = useState<SequenceStep[]>(() => sortedSteps(seq));
  const savedKey = JSON.stringify(sortedSteps(seq));
  useEffect(() => setSteps(sortedSteps(seq)), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(steps.map((s, i) => ({ ...s, order: i + 1 }))) !== savedKey;
  const activeHere = enrollments.filter((e) => e.sequenceId === seq.id && (e.status === "active" || e.status === "paused"));
  const beyond = activeHere.filter((e) => e.currentStep > steps.length).length;

  const patch = (i: number, p: Partial<SequenceStep>) => setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, dir: -1 | 1) =>
    setSteps((all) => {
      const j = i + dir;
      if (j < 0 || j >= all.length) return all;
      const next = [...all];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const warn = (s: SequenceStep) => {
    const tpl = s.templateId ? templates.find((t) => t.id === s.templateId) : undefined;
    if ((s.kind === "email" || s.kind === "whatsapp") && !tpl && !s.taskNote.trim()) return "Pick a template or write the message in the note";
    if (s.templateId && !tpl) return "Template was deleted";
    if (tpl && s.kind === "whatsapp" && templateChannelOf(tpl) !== "whatsapp") return "Email template on a WhatsApp step — keep it short";
    if (tpl && s.kind === "email" && templateChannelOf(tpl) === "whatsapp") return "WhatsApp template on an email step";
    return null;
  };

  return (
    <section className="rounded-xl border border-sg-line bg-sg-card p-4">
      <div className="mb-2 flex items-center">
        <h2 className="sg-eyebrow">Steps</h2>
        <span className="ml-2 text-2xs text-sg-dim">Delays count WIB business days (Mon–Fri, skipping Indonesian public holidays and cuti bersama) from the previous step; steps come due at 09:00 WIB.</span>
      </div>
      <ol className="space-y-2">
        {steps.map((s, i) => {
          const Icon = STEP_ICON[s.kind];
          const w = warn(s);
          const options = templates.filter((t) => (s.kind === "whatsapp" ? templateChannelOf(t) === "whatsapp" : s.kind === "email" ? templateChannelOf(t) === "email" : true));
          return (
            <li key={s.id} className="rounded-lg border border-sg-line bg-sg-bg/40 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <span className="sg-num mb-1.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-sg-card-3 text-2xs font-bold text-sg-muted">
                  <Icon className="size-3.5" aria-label={`Step ${i + 1}`} />
                </span>
                <Field label="Type" className="w-32">
                  <Select value={s.kind} onChange={(e) => patch(i, { kind: e.target.value as SequenceStep["kind"], templateId: e.target.value === "call" || e.target.value === "task" ? null : s.templateId })}>
                    {(["email", "whatsapp", "call", "task"] as const).map((k) => (
                      <option key={k} value={k}>
                        {STEP_KIND_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={i === 0 ? "Wait (days)" : "Then wait"} className="w-24">
                  <Input value={String(s.delayDays)} onChange={(e) => patch(i, { delayDays: Math.min(60, Number(e.target.value.replace(/[^\d]/g, "")) || 0) })} inputMode="numeric" />
                </Field>
                {s.kind === "email" || s.kind === "whatsapp" ? (
                  <Field label="Template" className="min-w-[180px] flex-1">
                    <Select value={s.templateId ?? ""} onChange={(e) => patch(i, { templateId: e.target.value || null })}>
                      <option value="">No template</option>
                      {s.templateId && !options.some((t) => t.id === s.templateId) ? <option value={s.templateId}>{templates.find((t) => t.id === s.templateId)?.name ?? `${s.templateId} (deleted)`}</option> : null}
                      {options.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                <div className="mb-0.5 ml-auto flex items-center gap-0.5">
                  <Button variant="ghost" size="icon-sm" aria-label="Move step up" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Move step down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Remove step" disabled={steps.length === 1} onClick={() => setSteps((all) => all.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <Field label={s.kind === "call" ? "Talking points" : s.kind === "task" ? "Task" : "Note / message without a template"} className="mt-2">
                <Input value={s.taskNote} onChange={(e) => patch(i, { taskNote: e.target.value })} placeholder={s.kind === "call" ? "Reference the intro email; ask about the tender timeline" : s.kind === "task" ? "Connect on LinkedIn" : "Optional"} />
              </Field>
              {w ? (
                <p className="mt-1 flex items-center gap-1 text-2xs text-soft-orange">
                  <TriangleAlert className="size-3" aria-hidden /> {w}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setSteps((all) => [...all, { id: uid("ss"), order: all.length + 1, kind: "task", delayDays: 2, templateId: null, taskNote: "" }])}>
          <Plus /> Add step
        </Button>
        {dirty ? (
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                updateSequence(seq.id, { steps });
                notify(`Saved ${steps.length} steps${activeHere.length ? ` — ${activeHere.length} active enrolment${activeHere.length === 1 ? "" : "s"} continue from their current step` : ""}`);
              }}
            >
              Save steps
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSteps(sortedSteps(seq))}>
              Revert
            </Button>
          </>
        ) : null}
        {beyond ? (
          <span className="flex items-center gap-1 text-2xs text-soft-orange">
            <TriangleAlert className="size-3" aria-hidden /> {beyond} enrolment{beyond === 1 ? " is" : "s are"} past the last step and will finish
          </span>
        ) : null}
      </div>
    </section>
  );
}

function Enrolments({ sequenceId }: { sequenceId: string }) {
  const seq = useCrm((s) => s.sequences.find((q) => q.id === sequenceId))!;
  const enrollments = useCrm((s) => s.sequenceEnrollments);
  const events = useCrm((s) => s.sequenceEvents);
  const contacts = useCrm((s) => s.contacts);
  const users = useCrm((s) => s.users);
  const setStatus = useCrm((s) => s.setEnrollmentStatus);
  const unenroll = useCrm((s) => s.unenroll);
  const restoreEnrollment = useCrm((s) => s.restoreEnrollment);
  const notify = useUi((s) => s.notify);
  const router = useRouter();
  const [filter, setFilter] = useState<"" | SequenceEnrollment["status"]>("");
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const mine = useMemo(() => enrollments.filter((e) => e.sequenceId === seq.id), [enrollments, seq.id]);
  const rows = useMemo(() => mine.filter((e) => !filter || e.status === filter).sort((a, b) => b.enrolledAt.localeCompare(a.enrolledAt)), [mine, filter]);
  const steps = sortedSteps(seq);

  return (
    <section className="overflow-hidden rounded-xl border border-sg-line bg-sg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-sg-line px-4 py-2.5">
        <h2 className="sg-eyebrow">Enrolments · {mine.length}</h2>
        <div className="ml-auto flex flex-wrap gap-1" role="group" aria-label="Status">
          {(["", "active", "paused", "replied", "finished"] as const).map((st) => (
            <button key={st || "all"} type="button" aria-pressed={filter === st} onClick={() => setFilter(st)} className={cn("h-6 rounded-sm border px-1.5 text-2xs font-semibold", filter === st ? "border-sg-white/60 bg-sg-card-3 text-sg-white" : "border-sg-line text-sg-muted hover:text-sg-white")}>
              {st ? `${ENROLLMENT_STATUS_META[st].label} ${mine.filter((e) => e.status === st).length}` : "All"}
            </button>
          ))}
        </div>
      </div>
      {!rows.length ? (
        <EmptyState icon={UserPlus} title="Nobody here yet">
          Enrol contacts from this page or from the Contacts list.
        </EmptyState>
      ) : (
        <ul>
          {rows.map((e) => {
            const c = contacts.find((x) => x.id === e.contactId);
            const done = e.status === "finished" ? steps.length : Math.max(0, e.currentStep - 1);
            const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
            const step = steps[e.currentStep - 1];
            const due = dueAtOf(seq, e, events);
            const meta = ENROLLMENT_STATUS_META[e.status];
            const evs = events.filter((x) => x.enrollmentId === e.id).sort((a, b) => b.at.localeCompare(a.at));
            return (
              <li key={e.id} className="border-b border-sg-line px-4 py-2.5 last:border-b-0">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-[160px] flex-1">
                    {c ? (
                      <Link href={`/contacts/${c.id}`} className="font-semibold text-sg-white hover:underline">
                        {c.firstName} {c.lastName}
                      </Link>
                    ) : (
                      <span className="text-sg-dim">Deleted contact</span>
                    )}
                    <div className="text-2xs text-sg-dim">
                      Enrolled {formatDate(e.enrolledAt)}
                      {e.enrolledById ? ` by ${users.find((u) => u.id === e.enrolledById)?.name ?? "—"}` : ""}
                      {e.statusReason && e.status !== "active" ? ` · ${e.statusReason}` : ""}
                    </div>
                  </div>
                  <div className="w-40">
                    <div className="h-1.5 overflow-hidden rounded-full bg-sg-card-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${done} of ${steps.length} steps done`}>
                      <div className={cn("h-full rounded-full", e.status === "replied" ? "bg-soft-cyan" : e.status === "finished" ? "bg-soft-blue" : "bg-soft-green")} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-0.5 text-[10px] text-sg-dim">
                      {done} / {steps.length} steps
                      {e.status === "active" && step ? ` · next ${STEP_KIND_LABEL[step.kind]} ${due ? (Date.parse(due) < Date.now() ? "overdue" : formatDate(due, "short")) : ""}` : ""}
                    </div>
                  </div>
                  <Chip color={meta.color} dot>
                    {meta.label}
                  </Chip>
                  <div className="flex items-center gap-0.5">
                    {e.status === "active" ? (
                      <Button variant="ghost" size="icon-sm" aria-label="Pause" title="Pause" onClick={() => setStatus(e.id, "paused", "Paused manually")}>
                        <Square />
                      </Button>
                    ) : e.status !== "finished" ? (
                      <Button variant="ghost" size="icon-sm" aria-label="Resume" title="Resume (the next step counts its delay from now)" onClick={() => setStatus(e.id, "active", "Resumed")}>
                        <Play />
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="icon-sm" aria-label="History" title="History" aria-expanded={historyOf === e.id} onClick={() => setHistoryOf(historyOf === e.id ? null : e.id)}>
                      <History />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Unenrol"
                      title="Unenrol"
                      onClick={() => {
                        const removed = unenroll(e.id);
                        if (removed) notify(`Unenrolled ${c?.firstName ?? "contact"}`, { label: "Undo", run: () => restoreEnrollment(removed) });
                      }}
                    >
                      <UserMinus />
                    </Button>
                  </div>
                </div>
                {historyOf === e.id ? (
                  <ol className="mt-2 space-y-1 rounded border border-sg-line bg-sg-bg/40 p-2">
                    {evs.map((x) => (
                      <li key={x.id} className="flex gap-2 text-2xs">
                        <span className="w-28 shrink-0 text-sg-dim">{formatDate(x.at, "datetime")}</span>
                        <span className="font-semibold capitalize text-sg-muted">{x.kind}</span>
                        <span className="text-sg-text">
                          {x.stepOrder ? `step ${x.stepOrder}${x.channel ? ` · ${STEP_KIND_LABEL[x.channel]}` : ""}` : ""}
                          {x.note ? ` — ${x.note.startsWith("until ") ? `until ${formatDate(x.note.slice(6), "datetime")}` : x.note}` : ""}
                        </span>
                        <span className="ml-auto text-sg-dim">{users.find((u) => u.id === x.actorId)?.name.split(" ")[0]}</span>
                      </li>
                    ))}
                    {!evs.length ? <li className="text-2xs text-sg-dim">No history recorded.</li> : null}
                  </ol>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="border-t border-sg-line px-4 py-2 text-2xs text-sg-dim">
        Last activity {relativeTime(events.filter((x) => x.sequenceId === seq.id).reduce((m, x) => (x.at > m ? x.at : m), "") || null)} ·{" "}
        <button type="button" className="underline hover:text-sg-white" onClick={() => router.push(`/automation/sequences?enrol=&seq=${seq.id}`)}>
          bulk enrol
        </button>
      </div>
    </section>
  );
}

function Analytics({ sequenceId }: { sequenceId: string }) {
  const seq = useCrm((s) => s.sequences.find((q) => q.id === sequenceId))!;
  const enrollments = useCrm((s) => s.sequenceEnrollments);
  const events = useCrm((s) => s.sequenceEvents);
  const steps = sortedSteps(seq);
  const data = useMemo(() => {
    const mine = enrollments.filter((e) => e.sequenceId === seq.id);
    const evs = events.filter((e) => e.sequenceId === seq.id);
    const perStep = steps.map((st, i) => {
      const order = i + 1;
      const executed = evs.filter((e) => e.kind === "executed" && (e.stepId === st.id || (!e.stepId && e.stepOrder === order))).length;
      const skipped = evs.filter((e) => e.kind === "skipped" && (e.stepId === st.id || (!e.stepId && e.stepOrder === order))).length;
      const reached = mine.filter((e) => e.status === "finished" || e.currentStep >= order).length;
      // replies attributed to the last step executed before the reply
      const replied = evs
        .filter((e) => e.kind === "replied")
        .filter((r) => {
          const last = evs.filter((e) => e.enrollmentId === r.enrollmentId && e.kind === "executed" && e.at <= r.at).sort((a, b) => b.at.localeCompare(a.at))[0];
          return (last?.stepOrder ?? 0) === order;
        }).length;
      return { step: st, order, executed, skipped, reached, replied };
    });
    const total = mine.length;
    const replied = mine.filter((e) => e.status === "replied").length;
    return { perStep, total, replied, rate: total ? Math.round((replied / total) * 100) : 0 };
  }, [enrollments, events, seq.id, steps]);

  return (
    <section className="rounded-xl border border-sg-line bg-sg-card p-4">
      <h2 className="sg-eyebrow mb-2">Performance</h2>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded border border-sg-line py-1.5">
          <div className="sg-num text-sm font-bold text-sg-white">{data.total}</div>
          <div className="text-[10px] uppercase tracking-[0.1em] text-sg-dim">Enrolled</div>
        </div>
        <div className="rounded border border-sg-line py-1.5">
          <div className="sg-num text-sm font-bold text-soft-cyan">{data.replied}</div>
          <div className="text-[10px] uppercase tracking-[0.1em] text-sg-dim">Replied</div>
        </div>
        <div className="rounded border border-sg-line py-1.5">
          <div className="sg-num text-sm font-bold text-sg-white">{data.rate}%</div>
          <div className="text-[10px] uppercase tracking-[0.1em] text-sg-dim">Reply rate</div>
        </div>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.1em] text-sg-dim">
            <th className="pb-1 font-semibold">Step</th>
            <th className="pb-1 text-right font-semibold">Reached</th>
            <th className="pb-1 text-right font-semibold">Done</th>
            <th className="pb-1 text-right font-semibold">Skipped</th>
            <th className="pb-1 text-right font-semibold">Replies</th>
          </tr>
        </thead>
        <tbody>
          {data.perStep.map((r) => {
            const Icon = STEP_ICON[r.step.kind];
            const w = data.total ? (r.reached / data.total) * 100 : 0;
            return (
              <tr key={r.step.id} className="border-t border-sg-line">
                <td className="py-1.5">
                  <span className="flex items-center gap-1.5 text-sg-muted">
                    <Icon className="size-3" aria-hidden /> {r.order}. {STEP_KIND_LABEL[r.step.kind]}
                  </span>
                  <div className="mt-1 h-1 rounded-full bg-sg-card-3">
                    <div className="h-full rounded-full bg-soft-blue" style={{ width: `${w}%` }} />
                  </div>
                </td>
                <td className="sg-num py-1.5 text-right text-sg-white">{r.reached}</td>
                <td className="sg-num py-1.5 text-right text-sg-text">{r.executed}</td>
                <td className="sg-num py-1.5 text-right text-sg-dim">{r.skipped}</td>
                <td className="sg-num py-1.5 text-right text-soft-cyan">{r.replied}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-sg-dim">A reply is credited to the last step done before it.</p>
    </section>
  );
}
