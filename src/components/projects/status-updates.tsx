"use client";

/* §6.1 the Project Lead's monthly report — overall health with schedule / budget / scope RAG, path to green, next steps. */
import { useMemo, useState } from "react";
import { Gauge, Plus, Trash2 } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Initiative, Rag } from "@/lib/initiatives/types";
import { monthWib, RAG_META, updateState } from "@/lib/initiatives/team-rules";
import { cn, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, Chip } from "@/components/ui/misc";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/overlays";
import { PolicyRef } from "./shared";

const RAGS: Rag[] = ["green", "amber", "red"];

export function HealthChip({ rag, className }: { rag: Rag; className?: string }) {
  return (
    <span className={className}>
      <Chip color={RAG_META[rag].color} dot>
        {RAG_META[rag].label}
      </Chip>
    </span>
  );
}

/** Small "health · 12d ago" / "update due" badge for register cards and tables. */
export function HealthBadge({ ini }: { ini: Initiative }) {
  const updates = useCrm((s) => s.projectUpdates);
  const st = useMemo(() => updateState(ini, updates), [ini, updates]);
  if (st.state === "n/a") return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-2xs text-sg-dim" title={st.latest ? `Latest monthly update ${st.latest.month}: ${st.latest.summary}` : "No monthly status update yet (§6.1)"}>
      {st.latest ? <HealthChip rag={st.latest.health} /> : null}
      {st.latest ? <span>{st.days === 0 ? "today" : `${st.days}d ago`}</span> : null}
      {st.state === "due" ? <span className="font-semibold text-soft-yellow">update due</span> : st.state === "overdue" ? <span className="font-semibold text-soft-red">update overdue</span> : null}
    </span>
  );
}

export function StatusUpdatesCard({ ini }: { ini: Initiative }) {
  const updates = useCrm((s) => s.projectUpdates);
  const users = useCrm((s) => s.users);
  const deleteProjectUpdate = useCrm((s) => s.deleteProjectUpdate);
  const restoreProjectUpdate = useCrm((s) => s.restoreProjectUpdate);
  const notify = useUi((s) => s.notify);
  const [posting, setPosting] = useState(false);
  const mine = useMemo(() => updates.filter((u) => u.initiativeId === ini.id).sort((a, b) => b.at.localeCompare(a.at)), [updates, ini.id]);
  const st = useMemo(() => updateState(ini, updates), [ini, updates]);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? mine : mine.slice(0, 3);

  return (
    <section className="rounded-xl border border-sg-line bg-sg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-sg-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Gauge className="size-4 text-sg-muted" />
          <h2 className="font-display text-sm font-extrabold text-sg-white">Monthly status</h2>
          <PolicyRef s="6.1" />
          {st.state === "due" ? <Chip color="yellow">{monthWib()} update due</Chip> : st.state === "overdue" ? <Chip color="red">Update overdue</Chip> : null}
        </div>
        <Button size="xs" variant={st.state === "ok" ? "outline" : "primary"} onClick={() => setPosting(true)}>
          <Plus /> Post update
        </Button>
      </header>
      {mine.length ? (
        <ul className="divide-y divide-sg-line">
          {shown.map((u) => {
            const author = users.find((x) => x.id === u.authorId);
            return (
              <li key={u.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <HealthChip rag={u.health} />
                  <span className="sg-num text-xs font-semibold text-sg-white">{u.month}</span>
                  <span className="flex items-center gap-1 text-2xs text-sg-dim">
                    <Avatar user={author} size="xs" /> {author?.name ?? u.authorId} · {relativeTime(u.at)}
                  </span>
                  <span className="ml-auto flex items-center gap-1 text-2xs text-sg-muted">
                    Schedule <Dot rag={u.schedule} /> Budget <Dot rag={u.budget} /> Scope <Dot rag={u.scope} />
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Withdraw the ${u.month} update`}
                    onClick={() => {
                      const removed = deleteProjectUpdate(u.id);
                      if (removed) notify("Status update withdrawn", { label: "Undo", run: () => restoreProjectUpdate(removed) });
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sg-text">{u.summary}</p>
                {u.pathToGreen ? (
                  <p className="mt-1 text-xs text-soft-orange">
                    <span className="font-semibold">Path to green:</span> {u.pathToGreen}
                  </p>
                ) : null}
                {u.nextSteps ? (
                  <p className="mt-1 text-xs text-sg-muted">
                    <span className="font-semibold text-sg-text">Next:</span> {u.nextSteps}
                  </p>
                ) : null}
                {u.decisionsNeeded ? (
                  <p className="mt-1 text-xs text-sg-muted">
                    <span className="font-semibold text-sg-text">Decisions needed:</span> {u.decisionsNeeded}
                  </p>
                ) : null}
              </li>
            );
          })}
          {mine.length > 3 ? (
            <li className="px-4 py-2">
              <button type="button" className="text-xs font-semibold text-sg-muted hover:text-sg-white" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `Show all ${mine.length} updates`}
              </button>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="px-4 py-4 text-sm text-sg-muted">No status update yet. The Project Lead reports each month on delivery, budget, schedule and scope (§6.1); the latest health shows on the register and the portfolio table.</p>
      )}
      <PostUpdateDialog ini={ini} open={posting} onOpenChange={setPosting} />
    </section>
  );
}

const DOT: Record<Rag, string> = { green: "bg-soft-green", amber: "bg-soft-yellow", red: "bg-soft-red" };
function Dot({ rag }: { rag: Rag }) {
  return <span className={cn("mr-1.5 inline-block size-2 rounded-full", DOT[rag])} title={RAG_META[rag].label} aria-label={RAG_META[rag].label} />;
}

function RagPicker({ label, value, onChange }: { label: string; value: Rag; onChange: (r: Rag) => void }) {
  return (
    <div>
      <div className="sg-eyebrow mb-1">{label}</div>
      <div role="radiogroup" aria-label={label} className="flex rounded border border-sg-line p-0.5">
        {RAGS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={value === r}
            onClick={() => onChange(r)}
            className={cn("h-7 flex-1 rounded-sm px-2 text-2xs font-semibold", value === r ? (r === "green" ? "bg-soft-green text-sg-bg" : r === "amber" ? "bg-soft-yellow text-sg-bg" : "bg-soft-red text-sg-bg") : "text-sg-muted hover:bg-sg-card-3 hover:text-sg-white")}
          >
            {RAG_META[r].label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PostUpdateDialog({ ini, open, onOpenChange }: { ini: Initiative; open: boolean; onOpenChange: (o: boolean) => void }) {
  const postProjectUpdate = useCrm((s) => s.postProjectUpdate);
  const notify = useUi((s) => s.notify);
  const [month, setMonth] = useState(monthWib());
  const [health, setHealth] = useState<Rag>("green");
  const [schedule, setSchedule] = useState<Rag>("green");
  const [budget, setBudget] = useState<Rag>("green");
  const [scope, setScope] = useState<Rag>("green");
  const [summary, setSummary] = useState("");
  const [pathToGreen, setPathToGreen] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [decisions, setDecisions] = useState("");
  const worst: Rag = [schedule, budget, scope].includes("red") ? "red" : [schedule, budget, scope].includes("amber") ? "amber" : "green";
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}$/.test(month)) errors.push("Month (YYYY-MM)");
  if (summary.trim().length < 10) errors.push("Summary of the month (at least 10 characters)");
  if (health !== "green" && pathToGreen.trim().length < 5) errors.push("Path to green for an at-risk / off-track project");
  const reset = () => {
    setHealth("green");
    setSchedule("green");
    setBudget("green");
    setScope("green");
    setSummary("");
    setPathToGreen("");
    setNextSteps("");
    setDecisions("");
  };
  const submit = () => {
    if (errors.length) return;
    postProjectUpdate({ initiativeId: ini.id, month, health, schedule, budget, scope, summary: summary.trim(), pathToGreen: pathToGreen.trim(), nextSteps: nextSteps.trim(), decisionsNeeded: decisions.trim() });
    notify(`Status update ${month} posted — ${RAG_META[health].label}`);
    reset();
    onOpenChange(false);
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Monthly status — ${ini.title}`}
      description="The Project Lead's monthly report (§6.1). Shared with the PRC and the PMO; no compensation data."
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={errors.length > 0} title={errors.join("\n")} onClick={submit}>
            Post update
          </Button>
        </>
      }
    >
      <div
        className="grid gap-3"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
          <Field label="Month">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          <RagPicker label="Overall health" value={health} onChange={setHealth} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <RagPicker label="Schedule" value={schedule} onChange={setSchedule} />
          <RagPicker label="Budget" value={budget} onChange={setBudget} />
          <RagPicker label="Scope" value={scope} onChange={setScope} />
        </div>
        {worst !== "green" && health === "green" ? <p className="text-2xs text-soft-yellow">Schedule, budget or scope is {RAG_META[worst].label.toLowerCase()} — check the overall health.</p> : null}
        <Field label="What happened this month">
          <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Deliverables completed, milestones accepted, issues…" />
        </Field>
        {health !== "green" ? (
          <Field label="Path to green (required)">
            <Textarea rows={2} value={pathToGreen} onChange={(e) => setPathToGreen(e.target.value)} placeholder="What will bring the project back on track, by when, and who owns it" />
          </Field>
        ) : null}
        <Field label="Next steps">
          <Textarea rows={2} value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} />
        </Field>
        <Field label="Decisions needed from the client or the PRC (optional)">
          <Input value={decisions} onChange={(e) => setDecisions(e.target.value)} />
        </Field>
        {errors.length && summary ? <p className="text-2xs text-soft-yellow">{errors.join(" · ")}</p> : null}
      </div>
    </Modal>
  );
}
