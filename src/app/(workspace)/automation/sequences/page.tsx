"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Copy, ListChecks, Plus, Trash2, UserPlus } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Sequence } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Avatar, Chip, EmptyState } from "@/components/ui/misc";
import { Modal, Tabs } from "@/components/ui/overlays";
import { AutomationNav, Toggle } from "@/components/automation/nav";
import { EnrolDialog } from "@/components/automation/enrol-dialog";
import { STEP_ICON, StepQueue, useQueue } from "@/components/automation/step-queue";
import { sortedSteps, STEP_KIND_LABEL } from "@/components/automation/sequences";

type Tab = "queue" | "sequences";

export default function SequencesPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(() => (params.get("tab") === "sequences" ? "sequences" : "queue"));
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const enrolParam = params.get("enrol");
  const seqParam = params.get("seq") ?? undefined;
  const enrolIds = useMemo(() => (enrolParam ? enrolParam.split(",").filter(Boolean) : []), [enrolParam]);
  useEffect(() => {
    if (enrolParam !== null) setEnrolOpen(true);
  }, [enrolParam]);
  const rows = useQueue(scope);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Sequences" crumbs={[{ href: "/automation", label: "Automation" }]}>
        <Button variant="outline" size="md" onClick={() => setEnrolOpen(true)}>
          <UserPlus /> Enrol contacts
        </Button>
        <Button variant="primary" size="md" onClick={() => setCreating(true)}>
          <Plus /> New sequence
        </Button>
      </PageHeader>
      <AutomationNav />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            aria-label="Sequences view"
            items={[
              { value: "queue", label: "Due steps", count: rows.filter((r) => r.bucket !== "upcoming").length },
              { value: "sequences", label: "All sequences" },
            ]}
            className="border-b-0"
          />
          {tab === "queue" ? (
            <div className="ml-auto flex rounded border border-sg-line p-0.5" role="group" aria-label="Whose steps">
              {(["mine", "all"] as const).map((s) => (
                <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)} className={cn("h-6 rounded-sm px-2 text-xs font-semibold", scope === s ? "bg-sg-card-3 text-sg-white" : "text-sg-dim hover:text-sg-white")}>
                  {s === "mine" ? "My steps" : "Everyone"}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {tab === "queue" ? (
          <div className="overflow-hidden rounded-xl border border-sg-line bg-sg-card">
            <StepQueue rows={rows} />
          </div>
        ) : (
          <SequenceList />
        )}
      </div>
      <EnrolDialog
        open={enrolOpen}
        onOpenChange={(v) => {
          setEnrolOpen(v);
          if (!v && enrolParam !== null) router.replace("/automation/sequences");
        }}
        sequenceId={seqParam}
        contactIds={enrolIds}
      />
      <CreateSequenceDialog open={creating} onOpenChange={setCreating} onCreated={(id) => router.push(`/automation/sequences/${id}`)} />
    </div>
  );
}

function SequenceList() {
  const sequences = useCrm((s) => s.sequences);
  const enrollments = useCrm((s) => s.sequenceEnrollments);
  const users = useCrm((s) => s.users);
  const updateSequence = useCrm((s) => s.updateSequence);
  const duplicateSequence = useCrm((s) => s.duplicateSequence);
  const deleteSequence = useCrm((s) => s.deleteSequence);
  const restoreSequence = useCrm((s) => s.restoreSequence);
  const notify = useUi((s) => s.notify);
  const router = useRouter();

  const stats = useMemo(() => {
    const m = new Map<string, { total: number; active: number; replied: number; finished: number; paused: number }>();
    enrollments.forEach((e) => {
      const x = m.get(e.sequenceId) ?? { total: 0, active: 0, replied: 0, finished: 0, paused: 0 };
      x.total += 1;
      if (e.status === "active") x.active += 1;
      if (e.status === "replied") x.replied += 1;
      if (e.status === "finished") x.finished += 1;
      if (e.status === "paused") x.paused += 1;
      m.set(e.sequenceId, x);
    });
    return m;
  }, [enrollments]);

  const remove = (q: Sequence) => {
    const snap = deleteSequence(q.id);
    if (snap) notify(`Deleted “${q.name}” and ${snap.enrollments.length} enrolment${snap.enrollments.length === 1 ? "" : "s"}`, { label: "Undo", run: () => restoreSequence(snap) });
  };

  if (!sequences.length)
    return (
      <div className="rounded-xl border border-sg-line bg-sg-card">
        <EmptyState icon={ListChecks} title="No sequences yet">
          A sequence is a cadence of emails, WhatsApp messages, calls and tasks spaced in business days.
        </EmptyState>
      </div>
    );

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {sequences.map((q) => {
        const st = stats.get(q.id) ?? { total: 0, active: 0, replied: 0, finished: 0, paused: 0 };
        const done = st.replied + st.finished;
        const replyRate = done ? Math.round((st.replied / Math.max(1, st.total - st.active - st.paused)) * 100) : 0;
        const owner = users.find((u) => u.id === q.ownerId);
        return (
          <div key={q.id} className="rounded-xl border border-sg-line bg-sg-card p-4">
            <div className="flex items-start gap-3">
              <Toggle checked={q.active} onChange={(v) => { updateSequence(q.id, { active: v }); notify(v ? `“${q.name}” is running` : `“${q.name}” paused — no steps come due until you turn it back on`); }} label={q.active ? `Pause ${q.name}` : `Run ${q.name}`} />
              <div className="min-w-0 flex-1">
                <Link href={`/automation/sequences/${q.id}`} className="font-display text-sm font-bold text-sg-white hover:underline">
                  {q.name}
                </Link>
                <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-sg-dim">
                  <Avatar user={owner} size="xs" /> {owner?.name ?? "—"} · {q.steps.length} steps · {q.stopOnReply === false ? "continues after reply" : "stops on reply"}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="icon-sm" aria-label={`Duplicate ${q.name}`} onClick={() => { const id = duplicateSequence(q.id); if (id) notify("Sequence duplicated (paused)", { label: "Open", run: () => router.push(`/automation/sequences/${id}`) }); }}>
                  <Copy />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${q.name}`} onClick={() => remove(q)}>
                  <Trash2 />
                </Button>
              </div>
            </div>
            <ol className="mt-3 flex flex-wrap items-center gap-1">
              {sortedSteps(q).map((s, i) => {
                const Icon = STEP_ICON[s.kind];
                return (
                  <li key={s.id} className="flex items-center gap-1">
                    {i > 0 ? <span className="text-[10px] text-sg-dim">+{s.delayDays}d</span> : s.delayDays ? <span className="text-[10px] text-sg-dim">day {s.delayDays}</span> : null}
                    <span className="flex h-6 items-center gap-1 rounded-sm border border-sg-line px-1.5 text-2xs text-sg-muted" title={s.taskNote || STEP_KIND_LABEL[s.kind]}>
                      <Icon className="size-3" aria-hidden /> {STEP_KIND_LABEL[s.kind]}
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[
                ["Active", st.active, "green"],
                ["Replied", st.replied, "cyan"],
                ["Finished", st.finished, "blue"],
                ["Reply rate", `${replyRate}%`, "magenta"],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded border border-sg-line bg-sg-bg/40 py-1.5">
                  <div className="sg-num text-sm font-bold text-sg-white">{value}</div>
                  <div className="text-[10px] uppercase tracking-[0.1em] text-sg-dim">{label}</div>
                </div>
              ))}
            </div>
            {!q.active ? <Chip color="yellow" className="mt-2">Paused</Chip> : null}
          </div>
        );
      })}
    </div>
  );
}

function CreateSequenceDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const createSequence = useCrm((s) => s.createSequence);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
    }
  }, [open]);
  const submit = () => {
    if (!name.trim()) return;
    const id = createSequence({ name, description });
    onOpenChange(false);
    onCreated(id);
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="New sequence"
      description="Starts with one email step; add WhatsApp, calls and tasks next."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim()} onClick={submit}>
            Create
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tender follow-up — 3 touch" autoFocus />
        </Field>
        <Field label="What it’s for">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who should be enrolled, and the goal" />
        </Field>
      </form>
    </Modal>
  );
}
