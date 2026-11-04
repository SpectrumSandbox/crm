"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useCrm, useUi } from "@/lib/store";
import { PROJECT_TYPE_META, POLICY, ORIGINATION_META } from "@/lib/initiatives/policy";
import type { Initiative, ProjectType } from "@/lib/initiatives/types";
import { addMonths } from "@/lib/initiatives/engine";
import { fromDateInput, toDateInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/overlays";

/** Bring an ongoing project into the register (§15.1: the PRC then issues a project code under v4.0). */
export function RegisterProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const users = useCrm((s) => s.users);
  const projects = useCrm((s) => s.projects);
  const currentUserId = useCrm((s) => s.currentUserId);
  const saveInitiative = useCrm((s) => s.saveInitiative);
  const notify = useUi((s) => s.notify);
  const today = useMemo(() => new Date().toISOString(), []);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ProjectType>("B");
  const [start, setStart] = useState(toDateInput(today));
  const [end, setEnd] = useState(toDateInput(addMonths(today, 6)));
  const [initiatorId, setInitiatorId] = useState(currentUserId);
  const [origination, setOrigination] = useState<NonNullable<Initiative["origination"]>>("personal");
  const [jira, setJira] = useState("");

  const valid = title.trim().length >= 2 && start && end && end > start;
  const submit = () => {
    if (!valid) return;
    const id = saveInitiative({
      title: title.trim(),
      type,
      status: "active",
      initiatorId,
      origination,
      startDate: fromDateInput(start),
      endDate: fromDateInput(end),
      demo: false,
      registeredRetroactively: true,
      policyVersion: "4.0",
      jiraProjectId: jira || null,
      standardBonus: type === "C" ? POLICY.typeCMinimum.standardBonus : undefined,
    });
    notify(`${title.trim()} added to the register`);
    onOpenChange(false);
    setTitle("");
    router.push(`/projects/${id}`);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Register an ongoing project"
      description="Every project must follow Policy v4.0. Register it here, then record the team, weights and figures; the PRC issues the project code (§15.1)."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            Register project
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      >
        <Field label="Project name">
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Elang" />
        </Field>
        <Field label="Project type (§5.1)" hint={PROJECT_TYPE_META[type].examples}>
          <Select value={type} onChange={(e) => setType(e.target.value as ProjectType)}>
            {(["A", "B", "C"] as ProjectType[]).map((t) => (
              <option key={t} value={t}>
                {PROJECT_TYPE_META[t].label} — capacity factor {PROJECT_TYPE_META[t].capacityFactor}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Work start">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Contracted final delivery" hint="Sets the contracted duration (§5.1)">
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Origination (§4.1)" hint={ORIGINATION_META[origination].description}>
            <Select value={origination} onChange={(e) => setOrigination(e.target.value as typeof origination)}>
              {(Object.keys(ORIGINATION_META) as (keyof typeof ORIGINATION_META)[]).map((k) => (
                <option key={k} value={k}>
                  {ORIGINATION_META[k].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={origination === "company" ? "Proposed by" : "Project Initiator"}>
            <Select value={initiatorId} onChange={(e) => setInitiatorId(e.target.value)}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Jira project (optional)">
          <Select value={jira} onChange={(e) => setJira(e.target.value)}>
            <option value="">None yet</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} · {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}
