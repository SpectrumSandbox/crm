"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleCheck, Play, TriangleAlert } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Sprint } from "@/lib/types";
import { issueStatusMeta, issueTypeMeta } from "@/lib/meta";
import { cn, formatDate, fromDateInput, softText, toDateInput } from "@/lib/utils";
import { Modal } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";

const DAY = 86_400_000;

export function StartSprintModal({ sprint, open, onOpenChange }: { sprint: Sprint | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const startSprint = useCrm((s) => s.startSprint);
  const issues = useCrm((s) => s.issues);
  const notify = useUi((s) => s.notify);
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !sprint) return;
    const today = toDateInput(new Date().toISOString());
    const s = toDateInput(sprint.startDate) >= today ? toDateInput(sprint.startDate) : today;
    const lengthDays = Math.max(1, Math.round((Date.parse(sprint.endDate) - Date.parse(sprint.startDate)) / DAY));
    setName(sprint.name);
    setStart(s);
    setEnd(toDateInput(new Date(Date.parse(`${s}T10:00:00Z`) + lengthDays * DAY).toISOString()));
    setGoal(sprint.goal);
    setError(null);
  }, [open, sprint]);

  if (!sprint) return null;
  const its = issues.filter((i) => i.sprintId === sprint.id && i.type !== "subtask");
  const pts = its.reduce((a, i) => a + (i.storyPoints ?? 0), 0);
  const days = start && end ? Math.round((Date.parse(end) - Date.parse(start)) / DAY) : 0;

  const submit = () => {
    const err = startSprint(sprint.id, { name, startDate: fromDateInput(start), endDate: fromDateInput(end), goal });
    if (err) {
      setError(err);
      return;
    }
    notify(`${name.trim()} started — ${its.length} issues, ${pts} pts`);
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Start ${sprint.name}`}
      description={`${its.length} issues · ${pts} of ${sprint.capacity} pts capacity`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim() || !start || !end}>
            <Play /> Start sprint
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
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <Field label="Sprint name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="End date" hint={days > 0 ? `${days} days` : undefined}>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="Sprint goal">
          <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What should this sprint achieve?" className="min-h-[72px]" />
        </Field>
        {its.length === 0 && (
          <p className="flex items-center gap-1.5 text-xs text-soft-yellow">
            <TriangleAlert className="size-3.5 shrink-0" /> This sprint has no issues yet — you can still start it and pull work in later.
          </p>
        )}
        {pts > sprint.capacity && (
          <p className="flex items-center gap-1.5 text-xs text-soft-orange">
            <TriangleAlert className="size-3.5 shrink-0" /> Committed {pts} pts is above the {sprint.capacity} pt capacity.
          </p>
        )}
        {its.some((i) => i.status === "backlog") && <p className="text-2xs text-sg-dim">Issues still in “Backlog” status move to “To Do” so they appear on the board.</p>}
        {error && <p className="rounded border border-soft-red/40 bg-soft-red/10 px-2.5 py-1.5 text-xs text-soft-red">{error}</p>}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

export function CompleteSprintModal({ sprint, open, onOpenChange }: { sprint: Sprint | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const completeSprint = useCrm((s) => s.completeSprint);
  const undoCompleteSprint = useCrm((s) => s.undoCompleteSprint);
  const issues = useCrm((s) => s.issues);
  const sprints = useCrm((s) => s.sprints);
  const notify = useUi((s) => s.notify);
  const future = useMemo(() => (sprint ? sprints.filter((s) => s.projectId === sprint.projectId && s.state === "future").sort((a, b) => a.startDate.localeCompare(b.startDate)) : []), [sprints, sprint]);
  const [target, setTarget] = useState<string>("");

  useEffect(() => {
    if (open) setTarget(future[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sprint?.id]);

  if (!sprint) return null;
  const its = issues.filter((i) => i.sprintId === sprint.id);
  const parents = its.filter((i) => i.type !== "subtask");
  const done = parents.filter((i) => i.status === "done");
  const incomplete = its.filter((i) => i.status !== "done");
  const pts = (list: typeof its) => list.reduce((a, i) => a + (i.storyPoints ?? 0), 0);
  const targetName = target ? future.find((s) => s.id === target)?.name : "the backlog";

  const submit = () => {
    const snap = completeSprint(sprint.id, target || null);
    if (!snap) {
      notify(`${sprint.name} is not active`);
      return;
    }
    onOpenChange(false);
    notify(`${sprint.name} completed — ${done.length} done, ${incomplete.length} moved to ${targetName}`, { label: "Undo", run: () => undoCompleteSprint(snap) });
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Complete ${sprint.name}`}
      description={`${formatDate(sprint.startDate, "short")} – ${formatDate(sprint.endDate, "short")}${sprint.goal ? ` · ${sprint.goal}` : ""}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit}>
            <CircleCheck /> Complete sprint
          </Button>
        </>
      }
    >
      <div
        className="space-y-4"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-sg-line bg-sg-bg/40 px-3 py-2.5">
            <div className="sg-eyebrow">Done</div>
            <div className="sg-num mt-0.5 font-display text-2xl font-extrabold text-soft-green">{done.length}</div>
            <div className="text-2xs text-sg-dim">{pts(done)} pts completed</div>
          </div>
          <div className="rounded-lg border border-sg-line bg-sg-bg/40 px-3 py-2.5">
            <div className="sg-eyebrow">Incomplete</div>
            <div className={cn("sg-num mt-0.5 font-display text-2xl font-extrabold", incomplete.length ? "text-soft-orange" : "text-sg-white")}>{incomplete.length}</div>
            <div className="text-2xs text-sg-dim">{pts(incomplete.filter((i) => i.type !== "subtask"))} pts not finished</div>
          </div>
        </div>

        {incomplete.length > 0 ? (
          <>
            <Field label="Move incomplete issues to" hint={future.length ? undefined : "No future sprint in this project — create one first to carry work over, or send it to the backlog."}>
              <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                {future.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (future)
                  </option>
                ))}
                <option value="">Backlog</option>
              </Select>
            </Field>
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-sg-line p-1.5">
              {incomplete.map((i) => {
                const T = issueTypeMeta[i.type].icon;
                return (
                  <li key={i.id} className="flex items-center gap-2 px-1.5 py-1 text-xs">
                    <T className={cn("size-3.5 shrink-0", softText[issueTypeMeta[i.type].color])} />
                    <span className="font-semibold text-sg-dim">{i.key}</span>
                    <span className="min-w-0 flex-1 truncate text-sg-text">{i.summary}</span>
                    <span className={cn("shrink-0 text-2xs", softText[issueStatusMeta[i.status].color])}>{issueStatusMeta[i.status].label}</span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="text-sm text-sg-muted">Every issue in this sprint is done.</p>
        )}
        <p className="text-2xs text-sg-dim">The sprint closes and counts towards the project's velocity. You can undo from the confirmation toast.</p>
      </div>
    </Modal>
  );
}
