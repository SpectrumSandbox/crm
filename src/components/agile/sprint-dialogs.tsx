"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleCheck, ListTree, Pencil, Play, Trash2, TriangleAlert, Users } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Issue, Sprint } from "@/lib/types";
import { issueStatusMeta, issueTypeMeta } from "@/lib/meta";
import { futureSprintsInOrder, startBlocker, type OpenSubtaskPolicy } from "@/lib/slices/agile-extras";
import { cn, formatDate, fromDateInput, softText, toDateInput } from "@/lib/utils";
import { Modal } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Avatar } from "@/components/ui/misc";
import { useUserMap } from "@/lib/selectors";

const DAY = 86_400_000;
const sumPts = (list: Issue[]) => list.reduce((a, i) => a + (i.storyPoints ?? 0), 0);
const dateHint = (v: string) => (v ? formatDate(`${v}T05:00:00Z`, "medium") : undefined);

/** Points assigned per person in a sprint (sub-tasks excluded — the parent carries the estimate). */
export function assignedPoints(sprintId: string, issues: Issue[]) {
  const m = new Map<string | null, number>();
  issues.filter((i) => i.sprintId === sprintId && i.type !== "subtask").forEach((i) => m.set(i.assigneeId, (m.get(i.assigneeId) ?? 0) + (i.storyPoints ?? 0)));
  return m;
}

/** People to plan capacity for: assignees in the sprint plus anyone already given capacity. */
function capacityPeople(sprint: Sprint, issues: Issue[], draft: Record<string, number>) {
  const ids = new Set<string>(Object.keys(draft));
  issues.filter((i) => i.sprintId === sprint.id && i.assigneeId).forEach((i) => ids.add(i.assigneeId!));
  return [...ids];
}

/** Per-person capacity table used by Start and Edit sprint. */
function MemberCapacityEditor({ sprint, issues, value, onChange, total }: { sprint: Sprint; issues: Issue[]; value: Record<string, string>; onChange: (v: Record<string, string>) => void; total: number }) {
  const userMap = useUserMap();
  const users = useCrm((s) => s.users);
  const numeric = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, Number(v) || 0]));
  const people = capacityPeople(sprint, issues, numeric).filter((id) => userMap.has(id));
  const assigned = assignedPoints(sprint.id, issues);
  const others = users.filter((u) => !people.includes(u.id));
  const planned = Object.values(numeric).reduce((a, b) => a + b, 0);
  const unestimated = issues.filter((i) => i.sprintId === sprint.id && i.type !== "subtask" && i.storyPoints == null).length;
  return (
    <div className="rounded-lg border border-sg-line">
      <div className="flex items-center gap-2 border-b border-sg-line px-3 py-2 text-xs">
        <Users className="size-3.5 text-sg-muted" />
        <span className="font-semibold text-sg-white">Capacity per person</span>
        <span className={cn("ml-auto", planned > total && total > 0 ? "text-soft-orange" : "text-sg-dim")}>
          {planned} of {total} pts planned
        </span>
        <button
          type="button"
          className="text-2xs font-semibold text-sg-muted hover:text-sg-white disabled:opacity-40"
          disabled={!people.length || !total}
          onClick={() => {
            const each = Math.floor(total / people.length);
            onChange(Object.fromEntries(people.map((id, k) => [id, String(each + (k < total - each * people.length ? 1 : 0))])));
          }}
        >
          Split evenly
        </button>
      </div>
      <ul className="divide-y divide-sg-line">
        {people.map((id) => {
          const a = assigned.get(id) ?? 0;
          const cap = Number(value[id] ?? "");
          const over = value[id] !== undefined && value[id] !== "" && a > cap;
          return (
            <li key={id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
              <Avatar user={userMap.get(id)} size="xs" />
              <span className="min-w-0 flex-1 truncate text-sg-text">{userMap.get(id)?.name}</span>
              <span className={cn("sg-num w-24 text-right", over ? "font-semibold text-soft-orange" : "text-sg-dim")}>{a} pts assigned</span>
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                aria-label={`Capacity for ${userMap.get(id)?.name}`}
                value={value[id] ?? ""}
                placeholder="—"
                onChange={(e) => onChange({ ...value, [id]: e.target.value })}
                className="h-7 w-16 text-right"
              />
            </li>
          );
        })}
        {!people.length && <li className="px-3 py-2 text-2xs text-sg-dim">No one is assigned in this sprint yet — add people below to plan their capacity.</li>}
      </ul>
      <div className="flex items-center gap-2 border-t border-sg-line px-3 py-1.5">
        <Select value="" onChange={(e) => e.target.value && onChange({ ...value, [e.target.value]: "" })} wrapperClassName="w-48" aria-label="Add a person">
          <option value="">+ Add a person…</option>
          {others.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        {(assigned.get(null) ?? 0) > 0 && <span className="text-2xs text-sg-dim">{assigned.get(null)} pts unassigned</span>}
        {unestimated > 0 && (
          <span className="ml-auto flex items-center gap-1 text-2xs text-soft-yellow">
            <TriangleAlert className="size-3" /> {unestimated} unestimated
          </span>
        )}
      </div>
    </div>
  );
}

const toNumbers = (v: Record<string, string>) => {
  const out: Record<string, number> = {};
  Object.entries(v).forEach(([k, x]) => {
    if (x.trim() !== "" && Number.isFinite(Number(x))) out[k] = Math.max(0, Math.round(Number(x)));
  });
  return out;
};
const toStrings = (v?: Record<string, number>) => Object.fromEntries(Object.entries(v ?? {}).map(([k, n]) => [k, String(n)]));

export function StartSprintModal({ sprint, open, onOpenChange }: { sprint: Sprint | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const startSprint = useCrm((s) => s.startSprint);
  const issues = useCrm((s) => s.issues);
  const sprints = useCrm((s) => s.sprints);
  const notify = useUi((s) => s.notify);
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [goal, setGoal] = useState("");
  const [capacity, setCapacity] = useState("");
  const [members, setMembers] = useState<Record<string, string>>({});
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
    setCapacity(String(sprint.capacity));
    setMembers(toStrings(sprint.memberCapacity));
    setError(null);
  }, [open, sprint]);

  if (!sprint) return null;
  const its = issues.filter((i) => i.sprintId === sprint.id && i.type !== "subtask");
  const pts = sumPts(its);
  const cap = Number(capacity) || 0;
  const days = start && end ? Math.round((Date.parse(end) - Date.parse(start)) / DAY) : 0;
  const blocker = startBlocker(sprint, sprints);

  const submit = () => {
    if (blocker) {
      setError(blocker);
      return;
    }
    const err = startSprint(sprint.id, { name, startDate: fromDateInput(start), endDate: fromDateInput(end), goal, capacity: cap, memberCapacity: toNumbers(members) });
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
      description={`${its.length} issues · ${pts} of ${cap} pts capacity`}
      className="w-[min(620px,calc(100vw-32px))]"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim() || !start || !end || !!blocker}>
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
        {blocker && (
          <p role="alert" className="flex items-start gap-1.5 rounded border border-soft-orange/40 bg-soft-orange/10 px-2.5 py-1.5 text-xs text-soft-orange">
            <TriangleAlert className="mt-px size-3.5 shrink-0" /> {blocker}
          </p>
        )}
        <Field label="Sprint name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Start date" hint={dateHint(start)}>
            <Input type="date" lang="en-GB" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="End date" hint={days > 0 ? `${dateHint(end)} · ${days} days` : dateHint(end)}>
            <Input type="date" lang="en-GB" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="Capacity (pts)">
            <Input type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </Field>
        </div>
        <Field label="Sprint goal">
          <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What should this sprint achieve?" className="min-h-[64px]" />
        </Field>
        <MemberCapacityEditor sprint={sprint} issues={issues} value={members} onChange={setMembers} total={cap} />
        {its.length === 0 && (
          <p className="flex items-center gap-1.5 text-xs text-soft-yellow">
            <TriangleAlert className="size-3.5 shrink-0" /> This sprint has no issues yet — you can still start it and pull work in later.
          </p>
        )}
        {pts > cap && (
          <p className="flex items-center gap-1.5 text-xs text-soft-orange">
            <TriangleAlert className="size-3.5 shrink-0" /> Committed {pts} pts is above the {cap} pt capacity.
          </p>
        )}
        {its.some((i) => i.status === "backlog") && <p className="text-2xs text-sg-dim">Issues still in “Backlog” status move to “To Do” so they appear on the board.</p>}
        {error && error !== blocker && <p className="rounded border border-soft-red/40 bg-soft-red/10 px-2.5 py-1.5 text-xs text-soft-red">{error}</p>}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

/** Edit name, dates, goal and capacity of a future or active sprint; delete a future one. */
export function EditSprintModal({ sprint, open, onOpenChange }: { sprint: Sprint | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const updateSprint = useCrm((s) => s.updateSprint);
  const deleteSprint = useCrm((s) => s.deleteSprint);
  const restoreSprint = useCrm((s) => s.restoreSprint);
  const issues = useCrm((s) => s.issues);
  const notify = useUi((s) => s.notify);
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [goal, setGoal] = useState("");
  const [capacity, setCapacity] = useState("");
  const [members, setMembers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open || !sprint) return;
    setName(sprint.name);
    setStart(toDateInput(sprint.startDate));
    setEnd(toDateInput(sprint.endDate));
    setGoal(sprint.goal);
    setCapacity(String(sprint.capacity));
    setMembers(toStrings(sprint.memberCapacity));
    setError(null);
    setConfirmDelete(false);
  }, [open, sprint]);

  if (!sprint) return null;
  const its = issues.filter((i) => i.sprintId === sprint.id);
  const active = sprint.state === "active";
  const cap = Number(capacity);

  const save = () => {
    if (!start || !end) {
      setError("Pick a start and an end date");
      return;
    }
    if (capacity.trim() === "" || !Number.isFinite(cap)) {
      setError("Capacity must be a number of story points");
      return;
    }
    const err = updateSprint(sprint.id, { name, goal, startDate: fromDateInput(start), endDate: fromDateInput(end), capacity: cap, memberCapacity: toNumbers(members) });
    if (err) {
      setError(err);
      return;
    }
    notify(`${name.trim()} updated`);
    onOpenChange(false);
  };

  const remove = () => {
    const res = deleteSprint(sprint.id);
    if (typeof res === "string") {
      setError(res);
      return;
    }
    onOpenChange(false);
    notify(`${sprint.name} deleted${res.moved.length ? ` — ${res.moved.length} issue${res.moved.length === 1 ? "" : "s"} back in the backlog` : ""}`, { label: "Undo", run: () => restoreSprint(res) });
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${sprint.name}`}
      description={active ? "Active sprint — changing the dates moves the burndown window." : "Future sprint"}
      className="w-[min(620px,calc(100vw-32px))]"
      footer={
        <>
          {!active &&
            (confirmDelete ? (
              <span className="mr-auto flex items-center gap-2 text-xs text-sg-muted">
                Delete{its.length ? ` and move ${its.length} issue${its.length === 1 ? "" : "s"} to the backlog` : ""}?
                <Button size="sm" variant="danger" onClick={remove}>
                  <Trash2 /> Delete sprint
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </span>
            ) : (
              <Button variant="ghost" className="mr-auto text-soft-red" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Delete…
              </Button>
            ))}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!name.trim()}>
            <Pencil /> Save sprint
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
      >
        <Field label="Sprint name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Start date" hint={dateHint(start)}>
            <Input type="date" lang="en-GB" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="End date" hint={dateHint(end)}>
            <Input type="date" lang="en-GB" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="Capacity (pts)">
            <Input type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </Field>
        </div>
        <Field label="Sprint goal">
          <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What should this sprint achieve?" className="min-h-[64px]" />
        </Field>
        <MemberCapacityEditor sprint={sprint} issues={issues} value={members} onChange={setMembers} total={Number.isFinite(cap) ? cap : 0} />
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
  const future = useMemo(() => (sprint ? futureSprintsInOrder(sprints, sprint.projectId) : []), [sprints, sprint]);
  const [target, setTarget] = useState<string>("");
  const [policy, setPolicy] = useState<OpenSubtaskPolicy>("reopen");

  useEffect(() => {
    if (open) {
      setTarget(future[0]?.id ?? "");
      setPolicy("reopen");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sprint?.id]);

  if (!sprint) return null;
  const its = issues.filter((i) => i.sprintId === sprint.id);
  const parents = its.filter((i) => i.type !== "subtask");
  const subsOf = (id: string) => issues.filter((c) => c.parentId === id);
  const done = parents.filter((i) => i.status === "done");
  /** done parents that still have open sub-tasks */
  const doneWithOpen = done.filter((p) => subsOf(p.id).some((c) => c.status !== "done"));
  const unfinished = parents.filter((i) => i.status !== "done");
  const looseSubs = its.filter((i) => i.type === "subtask" && i.status !== "done" && !parents.some((p) => p.id === i.parentId));
  const carried = [...unfinished, ...(policy === "reopen" ? doneWithOpen : [])];
  const targetName = target ? future.find((s) => s.id === target)?.name : "the backlog";

  const submit = () => {
    const snap = completeSprint(sprint.id, target || null, policy);
    if (!snap) {
      notify(`${sprint.name} is not active`);
      return;
    }
    onOpenChange(false);
    const doneCount = done.length - (policy === "reopen" ? doneWithOpen.length : 0);
    notify(`${sprint.name} completed — ${doneCount} done, ${carried.length} moved to ${targetName}`, { label: "Undo", run: () => undoCompleteSprint(snap) });
  };

  const Row = ({ i, sub }: { i: Issue; sub?: boolean }) => {
    const T = issueTypeMeta[i.type].icon;
    return (
      <li className={cn("flex items-center gap-2 py-1 pr-1.5 text-xs", sub ? "pl-6" : "pl-1.5")}>
        <T className={cn("size-3.5 shrink-0", softText[issueTypeMeta[i.type].color])} />
        <span className="font-semibold text-sg-dim">{i.key}</span>
        <span className="min-w-0 flex-1 truncate text-sg-text">{i.summary}</span>
        <span className={cn("shrink-0 text-2xs", softText[issueStatusMeta[i.status].color])}>{issueStatusMeta[i.status].label}</span>
      </li>
    );
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
            <div className="text-2xs text-sg-dim">{sumPts(done)} pts completed</div>
          </div>
          <div className="rounded-lg border border-sg-line bg-sg-bg/40 px-3 py-2.5">
            <div className="sg-eyebrow">Incomplete</div>
            <div className={cn("sg-num mt-0.5 font-display text-2xl font-extrabold", unfinished.length ? "text-soft-orange" : "text-sg-white")}>{unfinished.length}</div>
            <div className="text-2xs text-sg-dim">{sumPts(unfinished)} pts not finished · sub-tasks move with their parent</div>
          </div>
        </div>

        {doneWithOpen.length > 0 && (
          <div className="rounded-lg border border-soft-yellow/40 bg-soft-yellow/5 px-3 py-2.5 text-xs">
            <p className="flex items-center gap-1.5 font-semibold text-soft-yellow">
              <ListTree className="size-3.5" /> {doneWithOpen.length} done issue{doneWithOpen.length === 1 ? " has" : "s have"} open sub-tasks
            </p>
            <p className="mt-0.5 text-sg-muted">{doneWithOpen.map((p) => p.key).join(", ")}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-sg-text">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" name="open-subtasks" checked={policy === "reopen"} onChange={() => setPolicy("reopen")} className="accent-white" />
                Reopen the parent and carry it over with them
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" name="open-subtasks" checked={policy === "close"} onChange={() => setPolicy("close")} className="accent-white" />
                Close the open sub-tasks
              </label>
            </div>
          </div>
        )}

        {carried.length + looseSubs.length > 0 ? (
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
            <ul className="max-h-56 overflow-y-auto rounded-lg border border-sg-line p-1">
              {carried.map((p) => (
                <li key={p.id}>
                  <ul>
                    <Row i={p} />
                    {subsOf(p.id)
                      .filter((c) => c.status !== "done")
                      .map((c) => (
                        <Row key={c.id} i={c} sub />
                      ))}
                  </ul>
                </li>
              ))}
              {looseSubs.map((c) => (
                <Row key={c.id} i={c} />
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-sg-muted">Every issue in this sprint is done.</p>
        )}
        <p className="text-2xs text-sg-dim">The sprint closes, its report (committed, added, removed, completed, carried over) is saved and counts towards velocity. You can undo from the confirmation toast.</p>
      </div>
    </Modal>
  );
}
