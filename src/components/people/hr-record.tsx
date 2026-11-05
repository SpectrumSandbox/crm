"use client";

/* Editable HR record for one employee (Policy v4.0 §3, §10, §11, §15.1) — every change goes through updateProfile (audited). */
import { useMemo, useState } from "react";
import { CalendarClock, ShieldAlert } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { EmployeeProfile, EmploymentType } from "@/lib/initiatives/types";
import { EMPLOYMENT_TYPES } from "@/lib/initiatives/types";
import { addMonths, maxAllocationFactor } from "@/lib/initiatives/engine";
import { EMPLOYMENT_META, POLICY, POLICY_VERSION } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR, fromDateInput, toDateInput } from "@/lib/utils";
import { Field, Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Cite } from "@/components/initiatives/shared";
import { annexBState } from "./data";
import { Block, CommitAmountInput, CommitInput, Toggle } from "./fields";
import { ProbationOutcomeModal } from "@/components/compensation/probation";

const DAY = 86_400_000;

export function HrRecordForm({ profile, readOnly }: { profile: EmployeeProfile; readOnly?: boolean }) {
  const users = useCrm((s) => s.users);
  const [leaving, setLeaving] = useState<EmploymentType | null>(null);
  const updateProfile = useCrm((s) => s.updateProfile);
  const notify = useUi((s) => s.notify);
  const managers = useMemo(() => users.filter((u) => u.id !== profile.userId), [users, profile.userId]);

  const patch = (p: Partial<EmployeeProfile>, message?: string) => {
    if (readOnly) return;
    updateProfile(profile.userId, p);
    if (message) notify(message);
  };

  const t = profile.employmentType;
  const probationary = t === "probationary";
  const maxProbationEnd = addMonths(profile.hireDate, POLICY.probationMaxMonths);
  const probationTooLong = probationary && !!profile.probationEndDate && Date.parse(profile.probationEndDate) > Date.parse(maxProbationEnd) + DAY;
  const contractEnded = t === "fixed_term_contract" && !!profile.contractEndDate && Date.parse(profile.contractEndDate) <= Date.now();
  const annexB = annexBState(profile);

  const changeType = (v: EmploymentType) => {
    // §11.4 leaving probation settles the held balance first (Probation Completion Bonus) — never strand it
    if (t === "probationary" && v !== "probationary") {
      setLeaving(v);
      return;
    }
    const extra: Partial<EmployeeProfile> = {};
    if (v === "probationary" && !profile.probationEndDate) extra.probationEndDate = maxProbationEnd;
    if (v === "part_time" && profile.contractedHoursPct == null) extra.contractedHoursPct = 50;
    if (v === "fixed_term_contract" && t === "probationary") extra.probationEndDate = null; // PKWT cannot include probation (§11.1)
    patch({ employmentType: v, ...extra }, `Employment status → ${EMPLOYMENT_META[v].label}`);
  };

  return (
    <Block
      title={
        <>
          HR record <Cite s="3" />
          <Cite s="3.5" />
        </>
      }
      action={<span className="text-2xs text-sg-dim">{readOnly ? "Read-only — HR maintains this record" : "Changes are logged as HR updates · report status changes within 2 business days"}</span>}
    >
      {leaving ? (
        <ProbationOutcomeModal
          kind="complete"
          userId={profile.userId}
          onClose={() => setLeaving(null)}
          onDone={() => {
            // completeProbation moves the record to permanent; apply any other target status afterwards
            if (leaving !== "full_time_permanent") updateProfile(profile.userId, { employmentType: leaving, probationEndDate: profile.probationEndDate ?? new Date().toISOString() });
          }}
        />
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Employment status" hint={EMPLOYMENT_META[t].eligible ? "May propose, join and be paid for projects (§3.1)" : "May work on a project, but the cost is a direct cost and there is no share of the pool (§3.2)"}>
          <Select value={t} disabled={readOnly} onChange={(e) => changeType(e.target.value as EmploymentType)} className={cn(!EMPLOYMENT_META[t].eligible && "text-soft-red")}>
            {EMPLOYMENT_TYPES.map((x) => (
              <option key={x} value={x}>
                {EMPLOYMENT_META[x].label}
                {EMPLOYMENT_META[x].eligible ? "" : " — not eligible"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Line manager" hint="Gives written agreement to the time spent on projects (§3.1, §7.1)">
          <Select value={profile.directManagerId ?? ""} disabled={readOnly} onChange={(e) => patch({ directManagerId: e.target.value || null }, "Line manager updated")}>
            <option value="">No manager</option>
            {managers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {u.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Hire date">
          <Input type="date" disabled={readOnly} value={toDateInput(profile.hireDate)} onChange={(e) => e.target.value && patch({ hireDate: fromDateInput(e.target.value) })} />
        </Field>

        {probationary ? (
          <div>
            <Field label="Probation end date" hint={`Bonuses held until this date; at most ${POLICY.probationMaxMonths} months after hire (${formatDate(maxProbationEnd, "medium")}), cannot be extended (§11.1)`}>
              <Input type="date" disabled={readOnly} max={toDateInput(maxProbationEnd)} value={toDateInput(profile.probationEndDate)} onChange={(e) => patch({ probationEndDate: e.target.value ? fromDateInput(e.target.value) : null }, "Probation end date updated")} className={cn(probationTooLong && "text-soft-red")} />
            </Field>
            {probationTooLong ? <p className="mt-1 text-2xs text-soft-red">Beyond the legal maximum of {POLICY.probationMaxMonths} months.</p> : null}
          </div>
        ) : t === "fixed_term_contract" ? (
          <div>
            <Field label="Fixed-term contract end date" hint="Roles only for work periods within the contract term; contract end follows the §10 rules (§3.1)">
              <Input type="date" disabled={readOnly} value={toDateInput(profile.contractEndDate)} onChange={(e) => patch({ contractEndDate: e.target.value ? fromDateInput(e.target.value) : null }, "Contract end date updated")} className={cn(contractEnded && "text-soft-red")} />
            </Field>
            {!profile.contractEndDate ? <p className="mt-1 text-2xs text-soft-yellow">Record the contract end date (§3.1).</p> : contractEnded ? <p className="mt-1 text-2xs text-soft-red">Contract has ended — record the end of contract below (§10).</p> : null}
          </div>
        ) : t === "part_time" ? (
          <Field label="Contracted hours (% of full-time)" hint={`Allocation factor capped at ${maxAllocationFactor(profile)} — hours ÷ full-time, rounded down to 0.25 (§3.1, §6.4)`}>
            <CommitInput type="number" disabled={readOnly} min={1} max={100} value={profile.contractedHoursPct ?? 50} className="sg-num" onCommit={(v) => patch({ contractedHoursPct: Math.min(100, Math.max(1, Math.round(Number(v) || 0))) }, "Contracted hours updated")} />
          </Field>
        ) : (
          <Field label="Probation" hint={profile.probationEndDate ? `Completed ${formatDate(profile.probationEndDate, "medium")}` : "Not on probation"}>
            <Input value={profile.probationEndDate ? formatDate(profile.probationEndDate, "medium") : "—"} disabled />
          </Field>
        )}

        <Field label="Annual base salary" hint={`${formatIDR(profile.annualBaseSalary / 12, "full")} monthly gross · clawback deductions ≤ ${POLICY.clawback.maxSalaryDeductionPct * 100}% of it (§9.4)`}>
          <CommitAmountInput value={profile.annualBaseSalary} disabled={readOnly} ariaLabel="Annual base salary" onCommit={(n) => patch({ annualBaseSalary: n }, `Base salary → ${formatIDR(n, "full")}`)} />
        </Field>
        <Field label="Consecutive unpaid leave (days)" hint={profile.unpaidLeaveDays > POLICY.unpaidLeaveMaxDays ? `Over ${POLICY.unpaidLeaveMaxDays} days — no participation; bonuses for earlier work held and paid on return (§3.2, §10)` : `Over ${POLICY.unpaidLeaveMaxDays} days holds payments · statutory paid leave never affects eligibility (§3.3)`}>
          <CommitInput type="number" disabled={readOnly} min={0} value={profile.unpaidLeaveDays} className={cn("sg-num", profile.unpaidLeaveDays > POLICY.unpaidLeaveMaxDays && "text-soft-red")} onCommit={(v) => patch({ unpaidLeaveDays: Math.max(0, Math.round(Number(v) || 0)) }, "Unpaid leave updated")} />
        </Field>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <div>
          <div className="sg-eyebrow mb-1 flex items-center">
            Standing <Cite s="3.1" />
            <Cite s="3.2" />
          </div>
          <Toggle disabled={readOnly} checked={profile.goodStanding} onChange={(v) => patch({ goodStanding: v }, v ? "Returned to good standing" : "Marked not in good standing")} label="In good standing" hint="Needed when joining a project" />
          <Toggle disabled={readOnly} checked={profile.activeWrittenWarning} danger onChange={(v) => patch({ activeWrittenWarning: v }, v ? "Formal written warning recorded" : "Written warning cleared")} label="Active formal written warning (SP)" hint="Stops new roles; bonuses already earned are still paid. Project-level warnings (§7.5) do not count (§3.4)" />
          <Toggle disabled={readOnly} checked={profile.onPIP} danger onChange={(v) => patch(v ? { onPIP: true } : { onPIP: false, pipApprovedByPRC: false }, v ? "PIP recorded" : "PIP closed")} label="On a Performance Improvement Plan" hint="May not take part unless the PRC approves in writing" />
          <Toggle checked={profile.pipApprovedByPRC} disabled={readOnly || !profile.onPIP} onChange={(v) => patch({ pipApprovedByPRC: v }, v ? "PRC written exception for PIP participation recorded" : "PRC PIP exception withdrawn")} label="PRC written exception for the PIP" hint={profile.onPIP ? "Paid normally when approved (§11.1)" : "Only applies while on a PIP"} />
        </div>
        <div>
          <div className="sg-eyebrow mb-1 flex items-center">
            Disciplinary <Cite s="10" />
          </div>
          <Toggle disabled={readOnly} checked={profile.underInvestigation} danger onChange={(v) => patch({ underInvestigation: v }, v ? "Investigation opened" : "Investigation closed")} label="Under investigation for serious misconduct" hint="No participation until the investigation closes (§3.2)" />
          <Toggle disabled={readOnly} checked={profile.suspended} danger onChange={(v) => patch({ suspended: v }, v ? "Suspension recorded — payments held" : "Suspension lifted — held payments are paid in the next cycle")} label="Disciplinary suspension" hint="Payments falling due are held; paid if cleared, forfeited if a serious violation is confirmed (§10)" />
          <div className="mt-2 rounded-md border border-sg-line bg-sg-bg/40 p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-sg-white">
              <CalendarClock className="size-3.5 text-sg-muted" /> Project Participation Agreement (Annex B) <Cite s="15.1" />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Input type="date" disabled={readOnly} value={toDateInput(profile.acknowledgmentSignedAt)} onChange={(e) => patch({ acknowledgmentSignedAt: e.target.value ? fromDateInput(e.target.value) : null }, e.target.value ? "Annex B signature date recorded" : "Annex B signature cleared")} className="w-40" />
              <Button size="sm" disabled={readOnly} variant={annexB === "signed" ? "ghost" : "outline"} onClick={() => patch({ acknowledgmentSignedAt: new Date().toISOString() }, `Annex B (Policy v${POLICY_VERSION}) marked signed today`)}>
                Signed v{POLICY_VERSION} today
              </Button>
            </div>
            {annexB === "missing" ? (
              <p className="mt-1.5 flex items-start gap-1 text-2xs text-soft-yellow">
                <ShieldAlert className="mt-px size-3 shrink-0" /> Not signed — required to join a project, and every payment is held until it is signed (§3.1, §15.1).
              </p>
            ) : annexB === "pre_v4" ? (
              <p className="mt-1.5 flex items-start gap-1 text-2xs text-soft-yellow">
                <ShieldAlert className="mt-px size-3 shrink-0" /> Signed before Policy v{POLICY_VERSION} was issued — all participants sign the updated agreement before the first v{POLICY_VERSION} payment (§15.1).
              </p>
            ) : (
              <p className="mt-1.5 text-2xs text-sg-dim">Addendum to the employment agreement, signed by the employee, line manager and HR.</p>
            )}
            {probationary ? <p className="mt-1 text-2xs text-sg-dim">Probationers also sign the Annex C acknowledgment before their first project (§11.2).</p> : null}
          </div>
        </div>
      </div>
    </Block>
  );
}
