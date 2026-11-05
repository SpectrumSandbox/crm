"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, CircleCheck, Clock, Mail, MessageSquare, Phone, SquareCheck, TriangleAlert } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Activity, SequenceEnrollment, SequenceStep } from "@/lib/types";
import { callOutcomeLabel } from "@/lib/meta";
import { cn, formatDate, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Chip, EmptyState } from "@/components/ui/misc";
import { Modal } from "@/components/ui/overlays";
import { currentStepOf, dueAtOf, dueBucket, STEP_KIND_LABEL, type DueBucket } from "./sequences";
import { renderTemplate, tokenContext, unresolvedTokens, waLink, waNumber, isLikelyMobile, WA_SOFT_LIMIT } from "./tokens";

export const STEP_ICON: Record<SequenceStep["kind"], typeof Mail> = { email: Mail, whatsapp: MessageSquare, call: Phone, task: SquareCheck };

export interface QueueRow {
  enrollment: SequenceEnrollment;
  step: SequenceStep;
  dueAt: string;
  bucket: DueBucket;
  sequenceName: string;
  stepCount: number;
  contactName: string;
  company: string;
  ownerId: string;
}

/** Due steps across active enrolments (optionally only the ones the current user owns). */
export function useQueue(scope: "mine" | "all", sequenceId?: string) {
  const enrollments = useCrm((s) => s.sequenceEnrollments);
  const sequences = useCrm((s) => s.sequences);
  const events = useCrm((s) => s.sequenceEvents);
  const contacts = useCrm((s) => s.contacts);
  const companies = useCrm((s) => s.companies);
  const me = useCrm((s) => s.currentUserId);
  return useMemo(() => {
    const rows: QueueRow[] = [];
    const now = Date.now();
    enrollments.forEach((e) => {
      if (e.status !== "active" || (sequenceId && e.sequenceId !== sequenceId)) return;
      const seq = sequences.find((q) => q.id === e.sequenceId);
      if (!seq || !seq.active) return;
      const step = currentStepOf(seq, e);
      const dueAt = dueAtOf(seq, e, events);
      if (!step || !dueAt) return;
      const c = contacts.find((x) => x.id === e.contactId);
      if (!c) return;
      const ownerId = e.enrolledById ?? c.ownerId;
      if (scope === "mine" && ownerId !== me && c.ownerId !== me && seq.ownerId !== me) return;
      rows.push({ enrollment: e, step, dueAt, bucket: dueBucket(dueAt, now), sequenceName: seq.name, stepCount: seq.steps.length, contactName: `${c.firstName} ${c.lastName}`, company: companies.find((x) => x.id === c.companyId)?.name ?? "", ownerId });
    });
    return rows.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }, [enrollments, sequences, events, contacts, companies, me, scope, sequenceId]);
}

const BUCKET_META: Record<DueBucket, { label: string; color: "red" | "yellow" | "blue" }> = {
  overdue: { label: "Overdue", color: "red" },
  today: { label: "Due today", color: "yellow" },
  upcoming: { label: "Upcoming", color: "blue" },
};

export function StepQueue({ rows, compact }: { rows: QueueRow[]; compact?: boolean }) {
  const skip = useCrm((s) => s.skipSequenceStep);
  const snooze = useCrm((s) => s.snoozeSequenceStep);
  const setStatus = useCrm((s) => s.setEnrollmentStatus);
  const notify = useUi((s) => s.notify);
  const [executing, setExecuting] = useState<QueueRow | null>(null);
  const counts = useMemo(() => ({ overdue: rows.filter((r) => r.bucket === "overdue").length, today: rows.filter((r) => r.bucket === "today").length, upcoming: rows.filter((r) => r.bucket === "upcoming").length }), [rows]);

  if (!rows.length)
    return (
      <EmptyState icon={CircleCheck} title="No steps due">
        Enrol contacts in a sequence and their emails, WhatsApp messages, calls and tasks show up here on the day they’re due.
      </EmptyState>
    );

  return (
    <>
      {!compact ? (
        <div className="flex flex-wrap gap-3 border-b border-sg-line px-4 py-2 text-xs">
          {(Object.keys(BUCKET_META) as DueBucket[]).map((b) => (
            <span key={b} className="flex items-center gap-1.5">
              <Chip color={BUCKET_META[b].color}>{BUCKET_META[b].label}</Chip>
              <span className="sg-num font-semibold text-sg-white">{counts[b]}</span>
            </span>
          ))}
        </div>
      ) : null}
      <ul>
        {rows.map((r) => {
          const Icon = STEP_ICON[r.step.kind];
          return (
            <li key={r.enrollment.id} className="flex flex-wrap items-center gap-3 border-b border-sg-line px-4 py-2.5 last:border-b-0">
              <Icon className={cn("size-4 shrink-0", r.step.kind === "whatsapp" ? "text-soft-green" : r.step.kind === "call" ? "text-soft-cyan" : r.step.kind === "email" ? "text-soft-blue" : "text-soft-orange")} aria-label={STEP_KIND_LABEL[r.step.kind]} />
              <div className="min-w-0 flex-1">
                <Link href={`/contacts/${r.enrollment.contactId}`} className="font-semibold text-sg-white hover:underline">
                  {r.contactName}
                </Link>
                <span className="ml-2 text-2xs text-sg-dim">{r.company}</span>
                <div className="text-2xs text-sg-muted">
                  {r.sequenceName} · step {r.enrollment.currentStep} of {r.stepCount} · {STEP_KIND_LABEL[r.step.kind]}
                  {r.step.taskNote ? ` — ${r.step.taskNote}` : ""}
                </div>
              </div>
              <span className={cn("shrink-0 text-2xs font-semibold", r.bucket === "overdue" ? "text-soft-red" : r.bucket === "today" ? "text-soft-yellow" : "text-sg-dim")} title={formatDate(r.dueAt, "datetime")}>
                {r.bucket === "upcoming" ? formatDate(r.dueAt, "short") : r.bucket === "overdue" ? `overdue · ${relativeTime(r.dueAt)}` : "today"}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="xs" variant="primary" onClick={() => setExecuting(r)}>
                  {r.step.kind === "email" ? "Email" : r.step.kind === "whatsapp" ? "WhatsApp" : r.step.kind === "call" ? "Call" : "Do task"}
                </Button>
                <Button size="xs" variant="ghost" onClick={() => { snooze(r.enrollment.id, 1); notify(`Snoozed ${r.contactName} by one business day`); }} title="Push this step one business day">
                  <Clock /> Snooze
                </Button>
                <Button size="xs" variant="ghost" onClick={() => { skip(r.enrollment.id); notify(`Skipped step ${r.enrollment.currentStep} for ${r.contactName}`); }}>
                  Skip
                </Button>
                {!compact ? (
                  <Button size="xs" variant="ghost" onClick={() => { setStatus(r.enrollment.id, "paused", "Paused from the queue"); notify(`Paused ${r.contactName}`, { label: "Undo", run: () => setStatus(r.enrollment.id, "active", "Resumed") }); }}>
                    Pause
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <StepDialog row={executing} onClose={() => setExecuting(null)} />
    </>
  );
}

/** Execute one sequence step: edit the rendered message, open mail / WhatsApp / phone, then log it. */
export function StepDialog({ row, onClose }: { row: QueueRow | null; onClose: () => void }) {
  const state = useCrm((s) => s);
  const execute = useCrm((s) => s.executeSequenceStep);
  const notify = useUi((s) => s.notify);
  const contact = row ? state.contacts.find((c) => c.id === row.enrollment.contactId) : undefined;
  const seq = row ? state.sequences.find((q) => q.id === row.enrollment.sequenceId) : undefined;
  const step = row && seq ? currentStepOf(seq, row.enrollment) : null;
  const tpl = step?.templateId ? state.emailTemplates.find((t) => t.id === step.templateId) : undefined;
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState<NonNullable<Activity["callOutcome"]>>("connected");
  const [duration, setDuration] = useState("10");
  const [note, setNote] = useState("");
  const key = row?.enrollment.id ?? "";
  useEffect(() => {
    if (!row || !contact) return;
    const ctx = tokenContext(state, { type: "contact", id: contact.id }, contact.id);
    setSubject(tpl ? renderTemplate(tpl.subject, ctx) : (step?.taskNote ?? ""));
    setBody(tpl ? renderTemplate(tpl.body, ctx) : (step?.taskNote ?? ""));
    setOutcome("connected");
    setDuration("10");
    setNote(step?.taskNote ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!row || !contact || !step) return null;
  const left = unresolvedTokens([subject, body]);
  const wa = waLink(contact.phone, body);
  const done = () => {
    execute(row.enrollment.id, step.kind === "call" ? { callOutcome: outcome, durationMin: Number(duration) || 0, note } : step.kind === "task" ? { note } : { subject, body });
    notify(`${STEP_KIND_LABEL[step.kind]} logged for ${contact.firstName} — ${row.enrollment.currentStep >= row.stepCount ? "sequence finished" : "next step scheduled"}`);
    onClose();
  };
  return (
    <Modal
      open={!!row}
      onOpenChange={(v) => !v && onClose()}
      title={`${STEP_KIND_LABEL[step.kind]} · ${contact.firstName} ${contact.lastName}`}
      description={`${row.sequenceName} — step ${row.enrollment.currentStep} of ${row.stepCount}${tpl ? ` · template “${tpl.name}”` : ""}`}
      footer={
        <>
          {step.kind === "email" && contact.email ? (
            <a className="mr-auto text-xs font-semibold text-sg-muted hover:text-sg-white" href={`mailto:${contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>
              Open in mail app
            </a>
          ) : step.kind === "whatsapp" && wa ? (
            <a className="mr-auto text-xs font-semibold text-soft-green hover:underline" href={wa} target="_blank" rel="noreferrer">
              Open WhatsApp (+{waNumber(contact.phone)})
            </a>
          ) : step.kind === "call" && contact.phone ? (
            <a className="mr-auto text-xs font-semibold text-sg-muted hover:text-sg-white" href={`tel:${contact.phone.replace(/\s+/g, "")}`}>
              Call {contact.phone}
            </a>
          ) : (
            <span className="mr-auto" />
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={done}>
            {step.kind === "call" ? "Log call" : step.kind === "task" ? "Mark done" : "Log as sent"}
          </Button>
        </>
      }
    >
      <div
        className="space-y-3"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") done();
        }}
      >
        {step.kind === "email" ? (
          <>
            <p className="text-2xs text-sg-dim">To: {contact.email || <span className="text-soft-orange">no email address on file</span>}</p>
            <Field label="Subject">
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field label="Message">
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[160px]" />
            </Field>
          </>
        ) : step.kind === "whatsapp" ? (
          <>
            {!wa ? (
              <p className="flex items-center gap-1.5 text-xs text-soft-orange">
                <TriangleAlert className="size-3.5" aria-hidden /> {contact.phone ? `${contact.phone} can’t be used for WhatsApp` : "No phone number on file"} — add a mobile number on the contact.
              </p>
            ) : !isLikelyMobile(contact.phone) ? (
              <p className="flex items-center gap-1.5 text-xs text-soft-orange">
                <TriangleAlert className="size-3.5" aria-hidden /> {contact.phone} looks like a landline; WhatsApp needs a mobile (08…/+628…).
              </p>
            ) : (
              <p className="text-2xs text-sg-dim">To: +{waNumber(contact.phone)} — opens wa.me with the message pre-filled; send it in WhatsApp, then log it here.</p>
            )}
            <Field label="Message" hint={`${body.length} characters${body.length > WA_SOFT_LIMIT ? " — long for a chat message" : ""}`}>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[140px]" />
            </Field>
          </>
        ) : step.kind === "call" ? (
          <>
            <p className="text-2xs text-sg-dim">{contact.phone || "No phone number on file"}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Outcome">
                <Select value={outcome} onChange={(e) => setOutcome(e.target.value as NonNullable<Activity["callOutcome"]>)}>
                  {Object.entries(callOutcomeLabel).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Duration (min)">
                <Input value={duration} onChange={(e) => setDuration(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" />
              </Field>
            </div>
            <Field label="Notes">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="Task">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
        {left.length && step.kind !== "call" && step.kind !== "task" ? (
          <p className="flex items-center gap-1.5 text-2xs text-soft-orange">
            <TriangleAlert className="size-3" aria-hidden /> Not filled in: {left.map((t) => `{{${t}}}`).join(", ")}
          </p>
        ) : null}
        <p className="flex items-center gap-1.5 text-2xs text-sg-dim">
          <CalendarClock className="size-3" aria-hidden /> Logged on {contact.firstName}’s timeline. A reply (inbound email or WhatsApp, connected inbound call or a meeting) pauses the sequence automatically.
        </p>
      </div>
    </Modal>
  );
}
