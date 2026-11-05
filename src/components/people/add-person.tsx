"use client";

/* "Add person" — a real employee who works on projects but is not in the workspace yet (user + HR record, §3, §3.5). */
import { useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Team } from "@/lib/types";
import type { EmploymentType } from "@/lib/initiatives/types";
import { EMPLOYMENT_TYPES } from "@/lib/initiatives/types";
import { addMonths } from "@/lib/initiatives/engine";
import { EMPLOYMENT_META, POLICY, POLICY_VERSION, PTKP_STATUSES } from "@/lib/initiatives/policy";
import { formatDate, fromDateInput, toDateInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/overlays";
import { AmountInput, Callout } from "@/components/compensation/common";

const TEAMS: Team[] = ["Engineering", "Service", "Sales", "Marketing", "Finance", "People", "Leadership"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AddPersonModal({ onClose, onCreated }: { onClose: () => void; onCreated: (userId: string) => void }) {
  const users = useCrm((s) => s.users);
  const addPerson = useCrm((s) => s.addPerson);
  const updateHrIdentifiers = useCrm((s) => s.updateHrIdentifiers);
  const notify = useUi((s) => s.notify);
  const managers = useMemo(() => [...users].sort((a, b) => a.name.localeCompare(b.name)), [users]);

  const today = toDateInput(new Date().toISOString());
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [team, setTeam] = useState<Team>("Engineering");
  const [type, setType] = useState<EmploymentType>("full_time_permanent");
  const [hire, setHire] = useState(today);
  const [manager, setManager] = useState("");
  const [salary, setSalary] = useState(0);
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [npwp, setNpwp] = useState("");
  const [ptkp, setPtkp] = useState("");
  const [probationEnd, setProbationEnd] = useState("");
  const [contractEnd, setContractEnd] = useState("");
  const [hours, setHours] = useState("50");
  const [annexB, setAnnexB] = useState("");

  const hireIso = hire ? fromDateInput(hire) : "";
  const maxProbation = hireIso ? toDateInput(addMonths(hireIso, POLICY.probationMaxMonths)) : "";
  const probationValue = probationEnd || maxProbation;

  const errors: string[] = [];
  if (name.trim().length < 2) errors.push("Name");
  if (!EMAIL.test(email.trim())) errors.push("A valid work email");
  else if (users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) errors.push("This email already belongs to someone in the workspace");
  if (!title.trim()) errors.push("Job title");
  if (!hire) errors.push("Hire date");
  if (type === "probationary" && probationValue && probationValue > maxProbation) errors.push(`Probation may not run past ${formatDate(fromDateInput(maxProbation), "medium")} (3 months, §11.1)`);
  if (type === "fixed_term_contract" && !contractEnd) errors.push("Fixed-term contract end date (§3.1)");
  if (type === "fixed_term_contract" && contractEnd && hire && contractEnd <= hire) errors.push("Contract end must be after the hire date");
  const hoursPct = Math.round(Number(hours) || 0);
  if (type === "part_time" && (hoursPct < 1 || hoursPct > 99)) errors.push("Contracted hours as 1–99% of full-time");
  const allocationCap = Math.max(0.25, Math.floor((Math.min(100, hoursPct) / 100) * 4) / 4);

  const submit = () => {
    if (errors.length) return;
    const id = addPerson({
      name: name.trim(),
      email: email.trim(),
      title: title.trim(),
      team,
      employmentType: type,
      hireDate: hireIso,
      directManagerId: manager || null,
      annualBaseSalary: Math.max(0, Math.round(salary)),
      probationEndDate: type === "probationary" ? fromDateInput(probationValue) : null,
      contractEndDate: type === "fixed_term_contract" ? fromDateInput(contractEnd) : null,
      contractedHoursPct: type === "part_time" ? hoursPct : undefined,
      acknowledgmentSignedAt: annexB ? fromDateInput(annexB) : null,
    });
    if (employeeNumber.trim() || npwp.trim() || ptkp) updateHrIdentifiers(id, { employeeNumber: employeeNumber.trim() || undefined, npwp: npwp.trim() || undefined, ptkpStatus: ptkp || undefined });
    notify(`${name.trim()} added — HR to confirm eligibility (§3.5)${annexB ? "" : "; payments held until Annex B is signed"}`);
    onCreated(id);
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add person"
      description="A real employee who works on projects but is not in the workspace yet. Creates the user and their HR record (audit-logged)."
      className="w-[min(640px,calc(100vw-32px))]"
      footer={
        <>
          <span className="mr-auto text-2xs text-sg-dim">⌘/Ctrl+Enter to add</span>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={errors.length > 0} onClick={submit} title={errors.length ? `Missing: ${errors.join("; ")}` : undefined}>
            <UserPlus /> Add person
          </Button>
        </>
      }
    >
      <div
        className="grid grid-cols-2 gap-3"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      >
        <Field label="Full name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Rina Hartono" />
        </Field>
        <Field label="Work email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@spectrumgroup.id" />
        </Field>
        <Field label="Job title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mechanical Engineer" />
        </Field>
        <Field label="Team">
          <Select value={team} onChange={(e) => setTeam(e.target.value as Team)}>
            {TEAMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Employment status" hint={EMPLOYMENT_META[type].eligible ? "Eligible to take part (§3.1)" : "Not eligible — may work on projects as a direct cost, no share of the pool (§3.2)"}>
          <Select value={type} onChange={(e) => setType(e.target.value as EmploymentType)}>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EMPLOYMENT_META[t].label}
                {EMPLOYMENT_META[t].eligible ? "" : " — not eligible"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Hire date">
          <Input type="date" value={hire} onChange={(e) => setHire(e.target.value)} />
        </Field>

        {type === "probationary" ? (
          <Field label="Probation end date" hint={`Default and maximum: 3 months after hire (${maxProbation ? formatDate(fromDateInput(maxProbation), "medium") : "—"}), cannot be extended (§11.1)`} className="col-span-2">
            <Input type="date" max={maxProbation} value={probationValue} onChange={(e) => setProbationEnd(e.target.value)} />
          </Field>
        ) : null}
        {type === "fixed_term_contract" ? (
          <Field label="Contract end date" hint="Roles only for work periods within the contract; PKWT contracts cannot include probation (§3.1, §11.1)" className="col-span-2">
            <Input type="date" min={hire} value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} />
          </Field>
        ) : null}
        {type === "part_time" ? (
          <Field label="Contracted hours (% of full-time)" hint={`Allocation factor capped at ${allocationCap} — rounded down to the nearest 0.25 (§3.1)`} className="col-span-2">
            <Input type="number" min={1} max={99} value={hours} onChange={(e) => setHours(e.target.value)} className="sg-num w-32" />
          </Field>
        ) : null}

        <Field label="Line manager" hint="Agrees the time spent on projects (§3.1)">
          <Select value={manager} onChange={(e) => setManager(e.target.value)}>
            <option value="">No manager yet</option>
            {managers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {u.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Annual base salary" hint="Used for the §9.4 clawback deduction limits and the PPh 21 estimate">
          <AmountInput value={salary} onChange={setSalary} aria-label="Annual base salary" />
        </Field>
        <Field label="Employee number" hint="Company employee ID — on statements and payroll">
          <Input value={employeeNumber} onChange={(e) => setEmployeeNumber(e.target.value)} placeholder="e.g. SG-0142" />
        </Field>
        <Field label="NPWP" hint="Or the 16-digit NIK used as NPWP">
          <Input value={npwp} onChange={(e) => setNpwp(e.target.value)} placeholder="00.000.000.0-000.000" />
        </Field>
        <Field label="PTKP status" hint="PPh 21 TER category (PMK 168/2023)">
          <Select value={ptkp} onChange={(e) => setPtkp(e.target.value)}>
            <option value="">Not recorded</option>
            {PTKP_STATUSES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Annex B signed (Policy v${POLICY_VERSION})`} hint="Leave empty if not signed yet — payments are held until it is (§15.1)" className="col-span-2">
          <Input type="date" value={annexB} onChange={(e) => setAnnexB(e.target.value)} className="w-44" />
        </Field>
        {!EMPLOYMENT_META[type].eligible ? (
          <Callout tone="warn" className="col-span-2">
            {EMPLOYMENT_META[type].label} may not take part. They can still be recorded so their work can be tracked, but they receive no share of any bonus pool.
          </Callout>
        ) : null}
        {errors.length && name ? <p className="col-span-2 text-2xs text-soft-yellow">Still needed: {errors.join("; ")}</p> : null}
      </div>
    </Modal>
  );
}
