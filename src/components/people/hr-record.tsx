"use client";

/* Editable HR record for one employee — every change goes through updateProfile (audited). */
import { useMemo } from "react";
import { CalendarClock, ShieldAlert } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { EmployeeProfile, EmploymentType } from "@/lib/initiatives/types";
import { EMPLOYMENT_TYPES } from "@/lib/initiatives/types";
import { EMPLOYMENT_META, POLICY } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR, fromDateInput, toDateInput } from "@/lib/utils";
import { Field, Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Cite } from "@/components/initiatives/shared";
import { Block, CommitInput, Toggle } from "./fields";

export function HrRecordForm({ profile }: { profile: EmployeeProfile }) {
  const users = useCrm((s) => s.users);
  const updateProfile = useCrm((s) => s.updateProfile);
  const notify = useUi((s) => s.notify);
  const managers = useMemo(() => users.filter((u) => u.id !== profile.userId), [users, profile.userId]);

  const patch = (p: Partial<EmployeeProfile>, message?: string) => {
    updateProfile(profile.userId, p);
    if (message) notify(message);
  };

  const probationOpen = profile.employmentType === "probationary";
  const monthlySalary = profile.annualBaseSalary / 12;

  return (
    <Block
      title={
        <>
          HR record <Cite s="2.1" />
          <Cite s="4.5" />
        </>
      }
      action={<span className="text-2xs text-sg-dim">Changes are logged as HR updates</span>}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Employment type" hint={EMPLOYMENT_META[profile.employmentType].eligible ? "Eligible to participate (§1.2)" : "Not eligible to propose, join or receive project bonuses (§1.2)"}>
          <Select
            value={profile.employmentType}
            onChange={(e) => {
              const v = e.target.value as EmploymentType;
              patch({ employmentType: v }, `Employment type → ${EMPLOYMENT_META[v].label}`);
            }}
            className={cn(!EMPLOYMENT_META[profile.employmentType].eligible && "text-soft-red")}
          >
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EMPLOYMENT_META[t].label}
                {EMPLOYMENT_META[t].eligible ? "" : " — not eligible"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Direct manager" hint="Manager approval is part of team formation (§7.1)">
          <Select value={profile.directManagerId ?? ""} onChange={(e) => patch({ directManagerId: e.target.value || null }, "Direct manager updated")}>
            <option value="">No manager</option>
            {managers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {u.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Hire date">
          <Input type="date" value={toDateInput(profile.hireDate)} onChange={(e) => e.target.value && patch({ hireDate: fromDateInput(e.target.value) })} />
        </Field>
        <Field label="Probation end date" hint={probationOpen ? "Bonuses accrue and are withheld until this date (§6.8)" : profile.probationEndDate ? `Probation completed ${formatDate(profile.probationEndDate)}` : "Not on probation"}>
          <Input type="date" value={toDateInput(profile.probationEndDate)} onChange={(e) => patch({ probationEndDate: e.target.value ? fromDateInput(e.target.value) : null })} />
        </Field>
        <Field label="Annual base salary (IDR)" hint={`${formatIDR(monthlySalary)} / month · 200% cap ${formatIDR(profile.annualBaseSalary * POLICY.personAnnualCapOfSalary)} (§6.2)`}>
          <CommitInput
            type="number"
            min={0}
            step={1_000_000}
            value={profile.annualBaseSalary}
            className="sg-num"
            onCommit={(v) => {
              const n = Math.max(0, Math.round(Number(v) || 0));
              patch({ annualBaseSalary: n }, `Base salary → ${formatIDR(n, "full")}`);
            }}
          />
        </Field>
        <Field label="Consecutive unpaid leave (days)" hint={profile.unpaidLeaveDays > POLICY.unpaidLeaveMaxDays ? `Over ${POLICY.unpaidLeaveMaxDays} days — ineligible, bonuses held until return (§2.1, §4.5)` : `Ineligible above ${POLICY.unpaidLeaveMaxDays} days`}>
          <CommitInput
            type="number"
            min={0}
            value={profile.unpaidLeaveDays}
            className={cn("sg-num", profile.unpaidLeaveDays > POLICY.unpaidLeaveMaxDays && "text-soft-red")}
            onCommit={(v) => patch({ unpaidLeaveDays: Math.max(0, Math.round(Number(v) || 0)) }, "Unpaid leave updated")}
          />
        </Field>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <div>
          <div className="sg-eyebrow mb-1 flex items-center">
            Standing <Cite s="2.1" />
          </div>
          <Toggle checked={profile.goodStanding} onChange={(v) => patch({ goodStanding: v }, v ? "Returned to good standing" : "Marked not in good standing")} label="In good standing" hint="No active disciplinary action" />
          <Toggle checked={profile.activeWrittenWarning} danger onChange={(v) => patch({ activeWrittenWarning: v }, v ? "Written warning recorded" : "Written warning cleared")} label="Active written warning" hint="Blocks participation; payments held" />
          <Toggle checked={profile.onPIP} danger onChange={(v) => patch(v ? { onPIP: true } : { onPIP: false, pipApprovedByPRC: false }, v ? "PIP recorded" : "PIP closed")} label="On performance improvement plan" />
          <Toggle
            checked={profile.pipApprovedByPRC}
            disabled={!profile.onPIP}
            onChange={(v) => patch({ pipApprovedByPRC: v }, v ? "PRC approval for participation while on PIP recorded" : "PRC PIP approval withdrawn")}
            label="PIP participation approved by PRC"
            hint={profile.onPIP ? "Recorded by Bennaya Kusuma (PRC chair)" : "Only applies while on a PIP"}
          />
        </div>
        <div>
          <div className="sg-eyebrow mb-1 flex items-center">
            Disciplinary <Cite s="4.5" />
          </div>
          <Toggle checked={profile.underInvestigation} danger onChange={(v) => patch({ underInvestigation: v }, v ? "Investigation opened" : "Investigation closed")} label="Under investigation for serious misconduct" hint="Blocks participation" />
          <Toggle checked={profile.suspended} danger onChange={(v) => patch({ suspended: v }, v ? "Suspension recorded" : "Suspension lifted")} label="Suspended" hint="Bonuses for months under suspension are forfeited" />
          <div className="mt-2 rounded-md border border-sg-line bg-sg-bg/40 p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-sg-white">
              <CalendarClock className="size-3.5 text-sg-muted" /> Bonus acknowledgment form <Cite s="4.5" />
              <Cite s="6.8" />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Input type="date" value={toDateInput(profile.acknowledgmentSignedAt)} onChange={(e) => patch({ acknowledgmentSignedAt: e.target.value ? fromDateInput(e.target.value) : null }, e.target.value ? "Acknowledgment date recorded" : "Acknowledgment cleared")} className="w-40" />
              <Button size="sm" variant={profile.acknowledgmentSignedAt ? "ghost" : "outline"} onClick={() => patch({ acknowledgmentSignedAt: new Date().toISOString() }, "Acknowledgment marked signed today")}>
                Mark signed today
              </Button>
            </div>
            {!profile.acknowledgmentSignedAt && (
              <p className="mt-1.5 flex items-center gap-1 text-2xs text-soft-yellow">
                <ShieldAlert className="size-3" /> Missing — the employee has not acknowledged the forfeiture and probation conditions.
              </p>
            )}
          </div>
        </div>
      </div>
    </Block>
  );
}
