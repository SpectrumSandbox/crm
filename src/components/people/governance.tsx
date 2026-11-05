"use client";

/* HR identifiers (employee number, NPWP, PTKP) and governance roles with PRC terms (§13.1, §13.2) — audited. */
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { EmployeeProfile, GovernanceRole } from "@/lib/initiatives/types";
import { PTKP_STATUSES } from "@/lib/initiatives/policy";
import { addMonths } from "@/lib/initiatives/engine";
import { cn, formatDate, fromDateInput, toDateInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Chip } from "@/components/ui/misc";
import { Cite } from "@/components/initiatives/shared";
import { GOVERNANCE_META } from "./data";
import { Block, CommitInput } from "./fields";

const ROLES: GovernanceRole[] = ["prc", "ceo", "cfo", "finance", "hr", "executive_committee"];

export function IdentifiersBlock({ profile, readOnly }: { profile: EmployeeProfile; readOnly?: boolean }) {
  const updateHrIdentifiers = useCrm((s) => s.updateHrIdentifiers);
  const notify = useUi((s) => s.notify);
  const save = (patch: Pick<EmployeeProfile, "employeeNumber" | "npwp" | "ptkpStatus">, msg: string) => {
    if (updateHrIdentifiers(profile.userId, patch)) notify(msg);
  };
  const npwpDigits = (profile.npwp ?? "").replace(/\D/g, "");
  const npwpOk = !profile.npwp || npwpDigits.length === 15 || npwpDigits.length === 16;
  return (
    <Block
      title={
        <>
          Payroll identifiers <Cite s="8.5" />
        </>
      }
      action={<span className="text-2xs text-sg-dim">Used on Annex B/E statements and the payroll export</span>}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Employee number" hint="Company employee ID (NIK karyawan)">
          <CommitInput value={profile.employeeNumber ?? ""} disabled={readOnly} placeholder="e.g. SG-0142" onCommit={(v) => save({ employeeNumber: v.trim() || undefined }, "Employee number updated")} />
        </Field>
        <Field label="NPWP" hint={npwpOk ? "15-digit NPWP or 16-digit NIK used as NPWP" : "Should be 15 or 16 digits"}>
          <CommitInput value={profile.npwp ?? ""} disabled={readOnly} placeholder="00.000.000.0-000.000" className={cn(!npwpOk && "text-soft-yellow")} onCommit={(v) => save({ npwp: v.trim() || undefined }, "NPWP updated")} />
        </Field>
        <Field label="PTKP status" hint="Sets the PPh 21 TER category of the bonus estimate (PMK 168/2023)">
          <Select value={profile.ptkpStatus ?? ""} disabled={readOnly} onChange={(e) => save({ ptkpStatus: e.target.value || undefined }, "PTKP status updated")}>
            <option value="">Not recorded</option>
            {PTKP_STATUSES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="mt-2 text-2xs text-sg-dim">Project bonuses are irregular income: payroll adds them to that month&apos;s gross for PPh 21 (TER), and they are outside the base wage, the THR base and the BPJS wage base (§1.5).</p>
    </Block>
  );
}

export function GovernanceRolesBlock({ profile, readOnly }: { profile: EmployeeProfile; readOnly?: boolean }) {
  const setGovernanceRoles = useCrm((s) => s.setGovernanceRoles);
  const notify = useUi((s) => s.notify);
  const [roles, setRoles] = useState<GovernanceRole[]>(profile.governanceRoles);
  const [term, setTerm] = useState(toDateInput(profile.prcTermEndsAt ?? null));
  useEffect(() => {
    setRoles(profile.governanceRoles);
    setTerm(toDateInput(profile.prcTermEndsAt ?? null));
  }, [profile.governanceRoles, profile.prcTermEndsAt]);
  const changed = roles.slice().sort().join() !== profile.governanceRoles.slice().sort().join() || (roles.includes("prc") ? term : "") !== toDateInput(profile.prcTermEndsAt ?? null);
  const appointed = roles.includes("prc") && !roles.includes("ceo") && !roles.includes("cfo");
  const needsTerm = appointed && !term;
  const expired = !!profile.prcTermEndsAt && Date.parse(profile.prcTermEndsAt) < Date.now();
  const save = () => {
    if (needsTerm) return;
    if (setGovernanceRoles(profile.userId, roles, roles.includes("prc") && term ? fromDateInput(term) : null)) notify("Governance roles updated — recorded in the audit log");
  };
  return (
    <Block
      title={
        <>
          Governance roles <Cite s="13.1" />
          <Cite s="13.2" />
        </>
      }
      action={expired ? <Chip color="orange">PRC term ended {formatDate(profile.prcTermEndsAt, "medium")}</Chip> : null}
    >
      <div className="flex flex-wrap gap-2">
        {ROLES.map((r) => (
          <label key={r} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs", roles.includes(r) ? "border-sg-white/50 bg-sg-card-2 text-sg-white" : "border-sg-line text-sg-muted", readOnly && "cursor-not-allowed opacity-70")} title={GOVERNANCE_META[r].title}>
            <input type="checkbox" className="accent-sg-white" disabled={readOnly} checked={roles.includes(r)} onChange={(e) => setRoles((x) => (e.target.checked ? [...x, r] : x.filter((y) => y !== r)))} />
            {GOVERNANCE_META[r].label}
          </label>
        ))}
      </div>
      {roles.includes("prc") ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="PRC term ends" hint={appointed ? "Senior technical managers are appointed by the CEO for two-year terms (§13.1)" : "Ex officio members (CEO, CFO) need no term"}>
            <Input type="date" disabled={readOnly} value={term} onChange={(e) => setTerm(e.target.value)} className="w-44" />
          </Field>
          {!readOnly && appointed ? (
            <Button size="xs" variant="ghost" onClick={() => setTerm(toDateInput(addMonths(new Date().toISOString(), 24)))}>
              Two years from today
            </Button>
          ) : null}
        </div>
      ) : null}
      {!readOnly ? (
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={!changed || needsTerm} onClick={save}>
            <ShieldCheck /> Save roles
          </Button>
          {needsTerm ? <span className="text-2xs text-soft-yellow">Set the end of the two-year PRC term</span> : <span className="text-2xs text-sg-dim">Roles decide who certifies, releases, manages HR records and sees pay data (§13.4)</span>}
        </div>
      ) : (
        <p className="mt-2 text-2xs text-sg-dim">HR maintains governance roles.</p>
      )}
    </Block>
  );
}
