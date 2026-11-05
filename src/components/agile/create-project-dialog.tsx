"use client";

import { useEffect, useState } from "react";
import { Kanban } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { SpectrumColor } from "@/lib/types";
import { cn, spectrumDot } from "@/lib/utils";
import { Modal } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";

const COLORS: SpectrumColor[] = ["green", "cyan", "blue", "magenta", "yellow", "orange", "red"];

/** "Industrial IoT Pilot" → "IIP"; single words → first 3 letters. */
export function suggestProjectKey(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "";
  const key = words.length === 1 ? words[0]!.slice(0, 3) : words.map((w) => w[0]).join("").slice(0, 4);
  return key.toUpperCase().replace(/^[0-9]+/, "");
}

/**
 * Create a Jira-style project (key, name, lead, colour). Exported for the ongoing-projects register and the PRC
 * Jira-project pickers: pass `defaultName` and get the new id back in `onCreated`.
 */
export function CreateProjectDialog({ open, onOpenChange, onCreated, defaultName = "" }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (projectId: string) => void; defaultName?: string }) {
  const createProject = useCrm((s) => s.createProject);
  const users = useCrm((s) => s.users);
  const currentUserId = useCrm((s) => s.currentUserId);
  const projects = useCrm((s) => s.projects);
  const notify = useUi((s) => s.notify);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [leadId, setLeadId] = useState("");
  const [color, setColor] = useState<SpectrumColor>("cyan");
  const [description, setDescription] = useState("");
  const [withSprint, setWithSprint] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setKey(suggestProjectKey(defaultName));
    setKeyTouched(false);
    setLeadId(currentUserId);
    setColor(COLORS[projects.length % COLORS.length]!);
    setDescription("");
    setWithSprint(true);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const taken = projects.some((p) => p.key === key.trim().toUpperCase());
  const submit = () => {
    const res = createProject({ key, name, leadId: leadId || currentUserId, color, description, withSprint });
    if ("error" in res) {
      setError(res.error);
      return;
    }
    notify(`Project ${key.trim().toUpperCase()} · ${name.trim()} created`);
    onOpenChange(false);
    onCreated?.(res.id);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Create Jira project"
      description="A board, backlog and issue keys of its own (e.g. MGE-1, MGE-2 …)."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim() || !key.trim() || taken}>
            <Kanban /> Create project
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
        <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
          <Field label="Project name">
            <Input
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!keyTouched) setKey(suggestProjectKey(e.target.value));
                setError(null);
              }}
              placeholder="e.g. MGE Wellhead Monitoring"
            />
          </Field>
          <Field label="Key" hint={taken ? "Already used" : "2–10 letters/digits"}>
            <Input
              value={key}
              maxLength={10}
              onChange={(e) => {
                setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                setKeyTouched(true);
                setError(null);
              }}
              className={cn("font-mono uppercase", taken && "border-soft-red/60")}
              aria-invalid={taken}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Project lead">
            <Select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Colour">
            <div className="flex h-8 items-center gap-1.5" role="radiogroup" aria-label="Project colour">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className={cn("size-5 rounded-full ring-offset-2 ring-offset-sg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70", spectrumDot[c], color === c && "ring-2 ring-sg-white")}
                />
              ))}
            </div>
          </Field>
        </div>
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the team delivers here" className="min-h-[56px]" />
        </Field>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-sg-muted">
          <input type="checkbox" checked={withSprint} onChange={(e) => setWithSprint(e.target.checked)} className="size-3.5 accent-white" />
          Create {key.trim() ? `${key.trim().toUpperCase()} ` : ""}Sprint 1 (future) so the team can start planning
        </label>
        {error && <p className="rounded border border-soft-red/40 bg-soft-red/10 px-2.5 py-1.5 text-xs text-soft-red">{error}</p>}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

const NEW = "__new_project__";

/** Project select for the agile pages with a "+ Create project…" entry that opens CreateProjectDialog. */
export function ProjectPicker({ value, onChange, allowAll, className }: { value: string; onChange: (id: string) => void; allowAll?: boolean; className?: string }) {
  const projects = useCrm((s) => s.projects);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Select
        value={value}
        onChange={(e) => {
          if (e.target.value === NEW) setCreating(true);
          else onChange(e.target.value);
        }}
        wrapperClassName={className ?? "w-48"}
        aria-label="Project"
      >
        {allowAll && <option value="all">All projects</option>}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.key} · {p.name}
          </option>
        ))}
        <option value={NEW}>+ Create project…</option>
      </Select>
      <CreateProjectDialog open={creating} onOpenChange={setCreating} onCreated={onChange} />
    </>
  );
}
