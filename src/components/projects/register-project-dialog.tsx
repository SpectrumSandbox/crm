"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useCrm, useUi } from "@/lib/store";
import { PROJECT_TYPE_META, POLICY, ORIGINATION_META } from "@/lib/initiatives/policy";
import type { Initiative, ProjectType } from "@/lib/initiatives/types";
import { contractedMonths, endDateForMonths } from "@/lib/initiatives/engine";
import { lastDayEnd, ledgerDate, todayWib, wibDay } from "@/lib/initiatives/team-rules";

/** six contracted months from a yyyy-mm-dd start (§5.1) — engine.endDateForMonths */
const sixMonthsFrom = (day: string) => wibDay(endDateForMonths(ledgerDate(day), 6));
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
  const addMember = useCrm((s) => s.addMember);
  const notify = useUi((s) => s.notify);
  const today = useMemo(() => todayWib(), []);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ProjectType>("B");
  const [start, setStart] = useState(today);
  // six-month contract by default: start + 6 months − 1 day, counted as 6 contracted months (§5.1)
  const [end, setEnd] = useState(sixMonthsFrom(today));
  const [endTouched, setEndTouched] = useState(false);
  const [seedLead, setSeedLead] = useState(true);
  const [initiatorId, setInitiatorId] = useState(currentUserId);
  const [origination, setOrigination] = useState<NonNullable<Initiative["origination"]>>("personal");
  const [jira, setJira] = useState("");

  const valid = title.trim().length >= 2 && start && end && end > start;
  const months = start && end && end > start ? contractedMonths({ startDate: ledgerDate(start), endDate: lastDayEnd(end) }) : null;
  const initiatorName = users.find((u) => u.id === initiatorId)?.name ?? "the initiator";
  const leadRoles = origination === "company" ? (["project_lead"] as const) : (["initiator", "project_lead"] as const);
  const submit = () => {
    if (!valid) return;
    const id = saveInitiative({
      title: title.trim(),
      type,
      status: "active",
      initiatorId,
      origination,
      startDate: ledgerDate(start),
      endDate: lastDayEnd(end), // contracted final delivery, end of that day in WIB (as engine.endDateForMonths)
      demo: false,
      registeredRetroactively: true,
      policyVersion: "4.0",
      jiraProjectId: jira || null,
      standardBonus: type === "C" ? POLICY.typeCMinimum.standardBonus : undefined,
    });
    // §4.9 the Initiator leads unless they delegate; company channels carry no Initiator weight (§4.1). Consent and line
    // manager agreement stay pending until they are actually given (§6.7, §3.1).
    if (seedLead && !useCrm.getState().initiativeMembers.some((m) => m.initiativeId === id && m.userId === initiatorId)) {
      addMember(id, initiatorId, [...leadRoles], { consent: "pending", managerApproved: false, prcApproved: false, allocationPct: 30, joinedAt: ledgerDate(start), authority: "Ledger built from existing team records (§15.1)" });
    }
    notify(`${title.trim()} added to the register${seedLead ? ` — ${initiatorName} added as Project Lead, signature pending` : ""}`);
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
            <Input
              type="date"
              lang="en-GB"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (!endTouched && e.target.value) setEnd(sixMonthsFrom(e.target.value));
              }}
            />
          </Field>
          <Field label="Contracted final delivery" hint={months ? `${months} contracted month${months === 1 ? "" : "s"} (§5.1)` : "Sets the contracted duration (§5.1)"}>
            <Input
              type="date"
              lang="en-GB"
              value={end}
              onChange={(e) => {
                setEnd(e.target.value);
                setEndTouched(true);
              }}
            />
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
        <label className="flex items-start gap-2 text-xs text-sg-muted">
          <input type="checkbox" className="mt-0.5 size-3.5 accent-white" checked={seedLead} onChange={(e) => setSeedLead(e.target.checked)} />
          <span>
            Add {initiatorName} to the team as {origination === "company" ? "Project Lead" : "Project Initiator + Project Lead"} — signature and line manager agreement stay pending until given (§4.9, §6.7)
          </span>
        </label>
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
