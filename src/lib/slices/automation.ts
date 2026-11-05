/* Store slice "Automation" (W10) — sequences, templates, workflows (runtime + run log), automation notices, pipeline
 * snapshots, forecast categories and sales targets. Persisted collections live in src/lib/seed-ext/automation.ts. */
import type { CrmState } from "../store";
import type { Activity, ActivityLinks, EmailTemplate, Sequence, SequenceEnrollment, SequenceStep, Workflow } from "../types";
import type { GetFn, SetFn, Uid } from "./types";
import type { PipelineSnapshot, SequenceEvent, SequenceEventKind } from "../../components/automation/types";
import { detectEvents, isReply, newActivities, runWorkflow, scheduledEvents, type Api, type RunResult, type WfEvent } from "../../components/automation/runtime";
import { addBusinessDaysAt9, currentStepOf, dueAtOf, sortedSteps } from "../../components/automation/sequences";
import { renderTemplate, tokenContext } from "../../components/automation/tokens";
import { triggerDef } from "../../components/automation/catalog";
import type { WfObject } from "../../components/automation/types";

const nowIso = () => new Date().toISOString();
const emptyLinks = (): ActivityLinks => ({ contactIds: [], companyIds: [], dealIds: [], ticketIds: [] });

export interface EnrollResult {
  enrolled: string[];
  skipped: { contactId: string; reason: string }[];
}

export interface StepExecutionInput {
  subject?: string;
  body?: string;
  callOutcome?: Activity["callOutcome"];
  durationMin?: number;
  note?: string;
}

export interface SequenceSnapshot {
  sequence: Sequence;
  index: number;
  enrollments: SequenceEnrollment[];
  events: SequenceEvent[];
}

export interface AutomationSlice {
  /* templates */
  createTemplate: (input: Omit<EmailTemplate, "id" | "ownerId"> & { id?: string; ownerId?: string }) => string;
  updateTemplate: (id: string, patch: Partial<EmailTemplate>) => void;
  deleteTemplate: (id: string) => { template: EmailTemplate; index: number } | null;
  restoreTemplate: (snap: { template: EmailTemplate; index: number }) => void;

  /* sequences */
  createSequence: (input: { name: string; description?: string; ownerId?: string; steps?: SequenceStep[] }) => string;
  updateSequence: (id: string, patch: Partial<Sequence>) => void;
  duplicateSequence: (id: string) => string | null;
  deleteSequence: (id: string) => SequenceSnapshot | null;
  restoreSequence: (snap: SequenceSnapshot) => void;
  enrollContacts: (sequenceId: string, contactIds: string[]) => EnrollResult;
  /** log the current step (email / WhatsApp / call / task) on the contact's timeline and advance */
  executeSequenceStep: (enrollmentId: string, input?: StepExecutionInput) => string | null;
  skipSequenceStep: (enrollmentId: string, note?: string) => void;
  snoozeSequenceStep: (enrollmentId: string, businessDays: number) => void;
  setEnrollmentStatus: (enrollmentId: string, status: SequenceEnrollment["status"], reason?: string) => void;
  unenroll: (enrollmentId: string) => SequenceEnrollment | null;
  restoreEnrollment: (e: SequenceEnrollment) => void;

  /* workflows */
  createWorkflow: (input: Pick<Workflow, "name" | "trigger" | "actions"> & { description?: string; enabled?: boolean }) => string;
  updateWorkflow: (id: string, patch: Partial<Workflow>) => void;
  deleteWorkflow: (id: string) => { workflow: Workflow; index: number } | null;
  restoreWorkflow: (snap: { workflow: Workflow; index: number }) => void;
  /** manual run (or dry run) against one record */
  runWorkflowNow: (id: string, object: WfObject, recordId: string, opts?: { dryRun?: boolean; ignoreCondition?: boolean }) => RunResult | null;
  /** evaluate time-based triggers now; returns the number of runs */
  automationTick: () => number;
  markNoticeRead: (id: string) => void;
  markAllNoticesRead: () => void;

  /* reporting */
  takePipelineSnapshot: (label?: string, source?: PipelineSnapshot["source"]) => string;
  deletePipelineSnapshot: (id: string) => void;
  setSalesTarget: (period: string, ownerId: string | null, amount: number | null) => void;
}

/* ───────────── watcher (app-wide, client only) ───────────── */

let watcherStarted = false;

function enabledFor(s: CrmState, ev: WfEvent) {
  return s.workflows.filter((w) => w.enabled && w.trigger.object === ev.object && w.trigger.event === ev.event);
}

function isBulk(prev: CrmState, next: CrmState) {
  let changed = 0;
  for (const k of Object.keys(next) as (keyof CrmState)[]) {
    const v = next[k];
    if (Array.isArray(v) && v !== prev[k]) changed += 1;
    if (changed > 6) return true;
  }
  return false;
}

function startWatcher(api: Api) {
  if (watcherStarted || typeof window === "undefined") return;
  watcherStarted = true;
  // Lazy so the store ⇄ slice import cycle resolves; the node16 resolver used by scripts/tsconfig.json wants an explicit
  // extension on dynamic imports, which the Next bundler doesn't — hence the ignore (scripts never run this code).
  // @ts-ignore TS2835 under moduleResolution node16 only
  void import("../store").then(({ useCrm, useUi }) => {
    const hydrated = () => {
      const p = (useCrm as unknown as { persist?: { hasHydrated?: () => boolean } }).persist;
      return p?.hasHydrated ? p.hasHydrated() : true;
    };
    const toast = (message: string) => {
      try {
        useUi.getState().notify(message);
      } catch {
        /* toasts are best-effort */
      }
    };
    let prev = useCrm.getState();
    let busy = false;
    const store = useCrm as unknown as { subscribe: (listener: (state: CrmState) => void) => () => void; getState: () => CrmState };
    store.subscribe((next) => {
      if (busy) return;
      const before = prev;
      prev = next;
      if (!hydrated() || isBulk(before, next)) return;
      const events = detectEvents(before, next);
      const replies = newActivities(before, next).filter(isReply);
      if (!events.length && !replies.length) return;
      busy = true;
      try {
        const me = next.currentUserId;
        replies.forEach((a) => {
          const paused = pauseOnReply(api, a);
          if (paused.length) toast(`${paused.join(", ")} replied — sequence paused`);
        });
        for (const ev of events) {
          for (const wf of enabledFor(api.get(), ev)) {
            const r = runWorkflow(api, wf, ev, { source: "event" });
            r.notices.filter((n) => n.userId === me).forEach((n) => toast(`Automation: ${n.title}`));
          }
        }
      } finally {
        busy = false;
        prev = useCrm.getState();
      }
    });
    const tick = () => {
      if (!hydrated() || document.visibilityState === "hidden") return;
      busy = true;
      try {
        runTick(api, (n) => toast(n));
      } finally {
        busy = false;
        prev = useCrm.getState();
      }
    };
    window.setTimeout(tick, 15_000);
    window.setInterval(tick, 60_000);
  });
}

/** inbound reply / meeting → active enrolments of that contact become "replied" (when the sequence stops on reply) */
function pauseOnReply(api: Api, a: Activity): string[] {
  const s = api.get();
  const hits = s.sequenceEnrollments.filter((e) => e.status === "active" && a.links.contactIds.includes(e.contactId) && s.sequences.find((q) => q.id === e.sequenceId)?.stopOnReply !== false);
  if (!hits.length) return [];
  const at = nowIso();
  const reason = `${a.type === "meeting" ? "Meeting" : "Reply"}: ${a.subject}`;
  const events: SequenceEvent[] = hits.map((e) => ({ id: api.uid("sqe"), enrollmentId: e.id, sequenceId: e.sequenceId, contactId: e.contactId, at, kind: "replied", actorId: s.currentUserId, note: reason, activityId: a.id }));
  const ids = new Set(hits.map((e) => e.id));
  api.set((st) => ({
    sequenceEnrollments: st.sequenceEnrollments.map((e) => (ids.has(e.id) ? { ...e, status: "replied", statusReason: reason } : e)),
    sequenceEvents: [...events, ...st.sequenceEvents],
  }));
  return Array.from(new Set(hits.map((e) => s.contacts.find((c) => c.id === e.contactId)?.firstName ?? "A contact")));
}

function runTick(api: Api, toast?: (m: string) => void) {
  const s = api.get();
  let count = 0;
  const fired = new Set(s.workflowRuns.map((r) => r.dedupeKey).filter(Boolean) as string[]);
  s.workflows
    .filter((w) => w.enabled && triggerDef(w.trigger.object, w.trigger.event)?.timed)
    .forEach((wf) => {
      scheduledEvents(api.get(), wf).forEach((ev) => {
        if (ev.dedupeKey && fired.has(ev.dedupeKey)) return;
        const r = runWorkflow(api, wf, ev, { source: "schedule" });
        if (r.run) {
          count += 1;
          if (ev.dedupeKey) fired.add(ev.dedupeKey);
          r.notices.filter((n) => n.userId === api.get().currentUserId).forEach((n) => toast?.(`Automation: ${n.title}`));
        }
      });
    });
  // weekly pipeline snapshot for "what changed this week"
  const latest = api.get().pipelineSnapshots.reduce((m, p) => (p.at > m ? p.at : m), "");
  if (!latest || Date.now() - Date.parse(latest) > 7 * 86_400_000) takeSnapshot(api, "Weekly snapshot", "auto");
  return count;
}

function takeSnapshot(api: Api, label: string, source: PipelineSnapshot["source"]) {
  const s = api.get();
  const snap: PipelineSnapshot = {
    id: api.uid("ps"),
    at: nowIso(),
    label,
    source,
    takenById: s.currentUserId,
    deals: s.deals.map((d) => ({ id: d.id, name: d.name, amount: d.amount, pipelineId: d.pipelineId, stageId: d.stageId, closeDate: d.closeDate, ownerId: d.ownerId })),
  };
  // keep the latest 26 (half a year of weekly snapshots) plus every manual one
  api.set((st) => {
    const all = [snap, ...st.pipelineSnapshots].sort((a, b) => b.at.localeCompare(a.at));
    const autos = all.filter((p) => p.source !== "manual").slice(0, 26);
    const keep = new Set([...autos.map((p) => p.id), ...all.filter((p) => p.source === "manual").map((p) => p.id)]);
    return { pipelineSnapshots: all.filter((p) => keep.has(p.id)) };
  });
  return snap.id;
}

/* ───────────── slice ───────────── */

export function createAutomationSlice<S extends CrmState>(set: SetFn<S>, get: GetFn<S>, uid: Uid): AutomationSlice {
  const api: Api = {
    get: () => get() as unknown as CrmState,
    set: (partial) => set(partial as unknown as Partial<S> | ((s: S) => Partial<S>)),
    uid,
  };
  const put = (partial: Partial<CrmState> | ((s: CrmState) => Partial<CrmState>)) => api.set(partial);
  if (typeof window !== "undefined") window.setTimeout(() => startWatcher(api), 0);

  const seqEvent = (e: SequenceEnrollment, kind: SequenceEventKind, extra: Partial<SequenceEvent> = {}): SequenceEvent => ({
    id: uid("sqe"),
    enrollmentId: e.id,
    sequenceId: e.sequenceId,
    contactId: e.contactId,
    at: nowIso(),
    kind,
    actorId: get().currentUserId,
    ...extra,
  });

  /** advance an enrolment past its current step (finished after the last one) */
  const advance = (e: SequenceEnrollment, seq: Sequence, at: string): SequenceEnrollment => {
    const next = e.currentStep + 1;
    const done = next > sortedSteps(seq).length;
    return { ...e, currentStep: done ? e.currentStep : next, status: done ? "finished" : e.status, statusReason: done ? "All steps done" : e.statusReason, lastStepAt: at, dueOverrideAt: null };
  };

  return {
    /* ───────── templates ───────── */
    createTemplate: (input) => {
      const id = input.id && !get().emailTemplates.some((t) => t.id === input.id) ? input.id : uid("tpl");
      const tpl: EmailTemplate = { ...input, id, ownerId: input.ownerId ?? get().currentUserId, templateUpdatedAt: nowIso() };
      put((s) => ({ emailTemplates: [tpl, ...s.emailTemplates] }));
      return id;
    },
    updateTemplate: (id, patch) => put((s) => ({ emailTemplates: s.emailTemplates.map((t) => (t.id === id ? { ...t, ...patch, id, templateUpdatedAt: nowIso() } : t)) })),
    deleteTemplate: (id) => {
      const s = get();
      const index = s.emailTemplates.findIndex((t) => t.id === id);
      if (index < 0) return null;
      const template = s.emailTemplates[index];
      put((st) => ({ emailTemplates: st.emailTemplates.filter((t) => t.id !== id) }));
      return { template, index };
    },
    restoreTemplate: ({ template, index }) =>
      put((s) => {
        if (s.emailTemplates.some((t) => t.id === template.id)) return {};
        const next = [...s.emailTemplates];
        next.splice(Math.min(index, next.length), 0, template);
        return { emailTemplates: next };
      }),

    /* ───────── sequences ───────── */
    createSequence: ({ name, description, ownerId, steps }) => {
      const id = uid("seq");
      const seq: Sequence = {
        id,
        name: name.trim() || "Untitled sequence",
        ownerId: ownerId ?? get().currentUserId,
        active: true,
        description: description ?? "",
        stopOnReply: true,
        createdAt: nowIso(),
        steps: steps?.length ? steps : [{ id: uid("ss"), order: 1, kind: "email", delayDays: 0, templateId: get().emailTemplates[0]?.id ?? null, taskNote: "" }],
      };
      put((s) => ({ sequences: [seq, ...s.sequences] }));
      return id;
    },
    updateSequence: (id, patch) =>
      put((s) => ({
        sequences: s.sequences.map((q) => {
          if (q.id !== id) return q;
          const steps = patch.steps ? patch.steps.map((st, i) => ({ ...st, order: i + 1 })) : q.steps;
          return { ...q, ...patch, id, steps };
        }),
      })),
    duplicateSequence: (id) => {
      const src = get().sequences.find((q) => q.id === id);
      if (!src) return null;
      const copy: Sequence = { ...src, id: uid("seq"), name: `${src.name} (copy)`, active: false, ownerId: get().currentUserId, createdAt: nowIso(), steps: src.steps.map((st) => ({ ...st, id: uid("ss") })) };
      put((s) => ({ sequences: [copy, ...s.sequences] }));
      return copy.id;
    },
    deleteSequence: (id) => {
      const s = get();
      const index = s.sequences.findIndex((q) => q.id === id);
      if (index < 0) return null;
      const snap: SequenceSnapshot = {
        sequence: s.sequences[index],
        index,
        enrollments: s.sequenceEnrollments.filter((e) => e.sequenceId === id),
        events: s.sequenceEvents.filter((e) => e.sequenceId === id),
      };
      put((st) => ({
        sequences: st.sequences.filter((q) => q.id !== id),
        sequenceEnrollments: st.sequenceEnrollments.filter((e) => e.sequenceId !== id),
        sequenceEvents: st.sequenceEvents.filter((e) => e.sequenceId !== id),
      }));
      return snap;
    },
    restoreSequence: (snap) =>
      put((s) => {
        if (s.sequences.some((q) => q.id === snap.sequence.id)) return {};
        const sequences = [...s.sequences];
        sequences.splice(Math.min(snap.index, sequences.length), 0, snap.sequence);
        return { sequences, sequenceEnrollments: [...s.sequenceEnrollments, ...snap.enrollments], sequenceEvents: [...snap.events, ...s.sequenceEvents] };
      }),

    enrollContacts: (sequenceId, contactIds) => {
      const s = get();
      const result: EnrollResult = { enrolled: [], skipped: [] };
      const seq = s.sequences.find((q) => q.id === sequenceId);
      if (!seq) return { enrolled: [], skipped: contactIds.map((contactId) => ({ contactId, reason: "sequence not found" })) };
      const at = nowIso();
      const created: SequenceEnrollment[] = [];
      Array.from(new Set(contactIds)).forEach((contactId) => {
        const c = s.contacts.find((x) => x.id === contactId);
        if (!c) return result.skipped.push({ contactId, reason: "contact not found" });
        const existing = s.sequenceEnrollments.find((e) => e.sequenceId === sequenceId && e.contactId === contactId && (e.status === "active" || e.status === "paused"));
        if (existing) return result.skipped.push({ contactId, reason: `${c.firstName} is already enrolled` });
        created.push({ id: uid("se"), sequenceId, contactId, currentStep: 1, status: "active", enrolledAt: at, lastStepAt: at, enrolledById: s.currentUserId });
        result.enrolled.push(contactId);
      });
      if (created.length)
        put((st) => ({
          sequenceEnrollments: [...st.sequenceEnrollments, ...created],
          sequenceEvents: [...created.map((e) => seqEvent(e, "enrolled")), ...st.sequenceEvents],
        }));
      return result;
    },

    executeSequenceStep: (enrollmentId, input = {}) => {
      const s = get();
      const e = s.sequenceEnrollments.find((x) => x.id === enrollmentId);
      const seq = e ? s.sequences.find((q) => q.id === e.sequenceId) : undefined;
      const step = e && seq ? currentStepOf(seq, e) : null;
      const contact = e ? s.contacts.find((c) => c.id === e.contactId) : undefined;
      if (!e || !seq || !step || !contact || e.status !== "active") return null;
      const tpl = step.templateId ? s.emailTemplates.find((t) => t.id === step.templateId) : undefined;
      const tctx = tokenContext(s, { type: "contact", id: contact.id }, contact.id);
      const links: ActivityLinks = { ...emptyLinks(), contactIds: [contact.id], companyIds: contact.companyId ? [contact.companyId] : [] };
      const ownerId = s.currentUserId;
      const tag = `Sequence “${seq.name}” · step ${e.currentStep} of ${seq.steps.length}`;
      let activityId: string;
      if (step.kind === "email") {
        const subject = input.subject ?? (tpl ? renderTemplate(tpl.subject, tctx) : step.taskNote || "Follow-up");
        const body = input.body ?? (tpl ? renderTemplate(tpl.body, tctx) : step.taskNote);
        activityId = s.addActivity({ type: "email", direction: "outbound", subject, body: `${body}\n\n— ${tag}`, links, ownerId });
      } else if (step.kind === "whatsapp") {
        const body = input.body ?? (tpl ? renderTemplate(tpl.body, tctx) : step.taskNote);
        activityId = s.addActivity({ type: "note", direction: "outbound", subject: `WhatsApp to ${contact.firstName}: ${input.subject ?? tpl?.name ?? "message"}`, body: `${body}\n\n— sent via WhatsApp (wa.me) · ${tag}`, links, ownerId });
      } else if (step.kind === "call") {
        const outcome = input.callOutcome ?? "connected";
        activityId = s.addActivity({ type: "call", direction: "outbound", subject: `Call with ${contact.firstName}`, body: `${input.note || step.taskNote || "Sequence call"}\n\n— ${tag}`, callOutcome: outcome, durationMin: input.durationMin ?? (outcome === "connected" ? 10 : 1), links, ownerId });
      } else {
        activityId = s.addActivity({ type: "task", subject: step.taskNote || `Follow up with ${contact.firstName}`, body: `${input.note ?? ""}\n\n— ${tag}`.trim(), done: true, dueAt: nowIso(), links, ownerId });
      }
      const at = nowIso();
      put((st) => ({
        sequenceEnrollments: st.sequenceEnrollments.map((x) => (x.id === e.id ? advance(x, seq, at) : x)),
        sequenceEvents: [
          ...(e.currentStep >= seq.steps.length ? [seqEvent(e, "finished", { note: "All steps done" })] : []),
          seqEvent(e, "executed", { stepId: step.id, stepOrder: e.currentStep, channel: step.kind, activityId, note: input.note ?? tpl?.name }),
          ...st.sequenceEvents,
        ],
      }));
      return activityId;
    },
    skipSequenceStep: (enrollmentId, note) => {
      const s = get();
      const e = s.sequenceEnrollments.find((x) => x.id === enrollmentId);
      const seq = e ? s.sequences.find((q) => q.id === e.sequenceId) : undefined;
      const step = e && seq ? currentStepOf(seq, e) : null;
      if (!e || !seq || !step) return;
      const at = nowIso();
      put((st) => ({
        sequenceEnrollments: st.sequenceEnrollments.map((x) => (x.id === e.id ? advance(x, seq, at) : x)),
        sequenceEvents: [
          ...(e.currentStep >= seq.steps.length ? [seqEvent(e, "finished", { note: "All steps done" })] : []),
          seqEvent(e, "skipped", { stepId: step.id, stepOrder: e.currentStep, channel: step.kind, note }),
          ...st.sequenceEvents,
        ],
      }));
    },
    snoozeSequenceStep: (enrollmentId, businessDays) => {
      const s = get();
      const e = s.sequenceEnrollments.find((x) => x.id === enrollmentId);
      const seq = e ? s.sequences.find((q) => q.id === e.sequenceId) : undefined;
      if (!e || !seq) return;
      const due = dueAtOf(seq, e, s.sequenceEvents);
      const base = Math.max(Date.now(), due ? Date.parse(due) : Date.now());
      const until = new Date(addBusinessDaysAt9(base, Math.max(1, businessDays))).toISOString();
      put((st) => ({
        sequenceEnrollments: st.sequenceEnrollments.map((x) => (x.id === e.id ? { ...x, dueOverrideAt: until } : x)),
        sequenceEvents: [seqEvent(e, "snoozed", { stepOrder: e.currentStep, note: `until ${until}` }), ...st.sequenceEvents],
      }));
    },
    setEnrollmentStatus: (enrollmentId, status, reason) => {
      const e = get().sequenceEnrollments.find((x) => x.id === enrollmentId);
      if (!e || e.status === status) return;
      const kind: SequenceEventKind = status === "active" ? "resumed" : status === "paused" ? "paused" : status === "finished" ? "finished" : status === "bounced" ? "bounced" : "replied";
      put((st) => ({
        sequenceEnrollments: st.sequenceEnrollments.map((x) => (x.id === e.id ? { ...x, status, statusReason: reason ?? x.statusReason, dueOverrideAt: status === "active" ? null : x.dueOverrideAt, lastStepAt: status === "active" ? nowIso() : x.lastStepAt } : x)),
        sequenceEvents: [seqEvent(e, kind, { note: reason }), ...st.sequenceEvents],
      }));
    },
    unenroll: (enrollmentId) => {
      const e = get().sequenceEnrollments.find((x) => x.id === enrollmentId);
      if (!e) return null;
      put((st) => ({ sequenceEnrollments: st.sequenceEnrollments.filter((x) => x.id !== enrollmentId), sequenceEvents: [seqEvent(e, "unenrolled"), ...st.sequenceEvents] }));
      return e;
    },
    restoreEnrollment: (e) =>
      put((st) => (st.sequenceEnrollments.some((x) => x.id === e.id) ? {} : { sequenceEnrollments: [...st.sequenceEnrollments, e], sequenceEvents: st.sequenceEvents.filter((x) => !(x.enrollmentId === e.id && x.kind === "unenrolled")) })),

    /* ───────── workflows ───────── */
    createWorkflow: ({ name, trigger, actions, description, enabled }) => {
      const id = uid("wf");
      const ts = nowIso();
      const wf: Workflow = { id, name: name.trim() || "Untitled workflow", enabled: enabled ?? false, trigger, actions, runs: 0, lastRunAt: null, description: description ?? "", createdById: get().currentUserId, createdAt: ts, updatedAt: ts };
      put((s) => ({ workflows: [wf, ...s.workflows] }));
      return id;
    },
    updateWorkflow: (id, patch) => put((s) => ({ workflows: s.workflows.map((w) => (w.id === id ? { ...w, ...patch, id, updatedAt: nowIso() } : w)) })),
    deleteWorkflow: (id) => {
      const s = get();
      const index = s.workflows.findIndex((w) => w.id === id);
      if (index < 0) return null;
      const workflow = s.workflows[index];
      put((st) => ({ workflows: st.workflows.filter((w) => w.id !== id) }));
      return { workflow, index };
    },
    restoreWorkflow: ({ workflow, index }) =>
      put((s) => {
        if (s.workflows.some((w) => w.id === workflow.id)) return {};
        const next = [...s.workflows];
        next.splice(Math.min(index, next.length), 0, workflow);
        return { workflows: next };
      }),
    runWorkflowNow: (id, object, recordId, opts = {}) => {
      const wf = get().workflows.find((w) => w.id === id);
      if (!wf) return null;
      const ev: WfEvent = { object, event: wf.trigger.event, recordId, description: "run manually" };
      return runWorkflow(api, wf, ev, { source: "manual", dryRun: opts.dryRun, ignoreCondition: opts.ignoreCondition });
    },
    automationTick: () => runTick(api),
    markNoticeRead: (id) => put((s) => ({ automationNotices: s.automationNotices.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: nowIso() } : n)) })),
    markAllNoticesRead: () => {
      const me = get().currentUserId;
      const at = nowIso();
      put((s) => ({ automationNotices: s.automationNotices.map((n) => (n.userId === me && !n.readAt ? { ...n, readAt: at } : n)) }));
    },

    /* ───────── reporting ───────── */
    takePipelineSnapshot: (label = "Manual snapshot", source = "manual") => takeSnapshot(api, label, source),
    deletePipelineSnapshot: (id) => put((s) => ({ pipelineSnapshots: s.pipelineSnapshots.filter((p) => p.id !== id) })),
    setSalesTarget: (period, ownerId, amount) => {
      const me = get().currentUserId;
      put((s) => {
        const rest = s.salesTargets.filter((t) => !(t.period === period && t.ownerId === ownerId));
        if (amount === null || !Number.isFinite(amount) || amount <= 0) return { salesTargets: rest };
        return { salesTargets: [...rest, { id: uid("tg"), period, ownerId, amount: Math.round(amount), updatedById: me, updatedAt: nowIso() }] };
      });
    },
  };
}
