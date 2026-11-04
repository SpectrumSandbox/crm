"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleAlert, UserPlus } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Team } from "@/lib/types";
import type { EmploymentType, Initiative, InitiativeMember, ProjectRole } from "@/lib/initiatives/types";
import { EMPLOYMENT_TYPES, PROJECT_ROLES } from "@/lib/initiatives/types";
import { ALLOCATION_FACTORS, EMPLOYMENT_META, ROLE_META, SPECIALIST_GUIDE } from "@/lib/initiatives/policy";
import { capacityCheck, concurrentNonLeadRoles, maxAllocationFactor, memberWeight, participationEligibility } from "@/lib/initiatives/engine";
import { cn, fromDateInput, toDateInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/overlays";
import { PolicyRef } from "./shared";

const TEAMS: Team[] = ["Engineering", "Sales", "Service", "Leadership", "Marketing", "Finance", "People"];

interface Props {
  ini: Initiative;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** editing an existing ledger row */
  member?: InitiativeMember | null;
  /** Σ effective weight of the other current members — for the live share preview */
  othersE: number;
  rate: number;
}

export function MemberDialog({ ini, open, onOpenChange, member, othersE, rate }: Props) {
  const users = useCrm((s) => s.users);
  const profiles = useCrm((s) => s.employeeProfiles);
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const addMember = useCrm((s) => s.addMember);
  const updateMember = useCrm((s) => s.updateMember);
  const addPerson = useCrm((s) => s.addPerson);
  const proposeAmendment = useCrm((s) => s.proposeAmendment);
  const notify = useUi((s) => s.notify);
  const approved = !!ini.code;
  const editing = !!member;

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [userId, setUserId] = useState("");
  const [roles, setRoles] = useState<ProjectRole[]>(["engineer"]);
  const [specialistWeight, setSpecialistWeight] = useState(2);
  const [allocation, setAllocation] = useState(1);
  const [override, setOverride] = useState("");
  const [note, setNote] = useState("");
  const [joined, setJoined] = useState(toDateInput(ini.startDate));
  const [effective, setEffective] = useState(toDateInput(new Date().toISOString()));
  const [signed, setSigned] = useState(true);
  const [manager, setManager] = useState(true);
  const [allocationPct, setAllocationPct] = useState(20);
  // new person
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [team, setTeam] = useState<Team>("Engineering");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("full_time_permanent");
  const [hireDate, setHireDate] = useState("");
  const [managerId, setManagerId] = useState("");
  const [hoursPct, setHoursPct] = useState(50);
  const [contractEnd, setContractEnd] = useState("");
  const [annexB, setAnnexB] = useState("");

  useEffect(() => {
    if (!open) return;
    if (member) {
      setMode("existing");
      setUserId(member.userId);
      setRoles(member.roles);
      setSpecialistWeight(member.specialistWeight ?? 2);
      setAllocation(member.allocationFactor ?? 1);
      setOverride(member.weightOverride != null ? String(member.weightOverride) : "");
      setNote(member.weightNote ?? "");
      setJoined(toDateInput(member.joinedAt));
      setSigned(member.consent === "accepted");
      setManager(member.managerApproved);
      setAllocationPct(member.allocationPct);
    } else {
      setMode("existing");
      setUserId("");
      setRoles(["engineer"]);
      setSpecialistWeight(2);
      setAllocation(1);
      setOverride("");
      setNote("");
      setJoined(toDateInput(Date.parse(ini.startDate) > Date.now() ? ini.startDate : approved ? new Date().toISOString() : ini.startDate));
      setSigned(true);
      setManager(true);
      setAllocationPct(20);
      setName("");
      setEmail("");
      setTitle("");
      setHireDate("");
      setManagerId("");
      setAnnexB("");
    }
    setEffective(toDateInput(new Date().toISOString()));
  }, [open, member, ini.startDate, approved]);

  const onTeam = useMemo(() => new Set(members.filter((m) => m.initiativeId === ini.id && m.consent !== "declined" && (!m.leftAt || Date.parse(m.leftAt) > Date.now())).map((m) => m.userId)), [members, ini.id]);
  const candidates = useMemo(() => users.filter((u) => editing || !onTeam.has(u.id)).sort((a, b) => a.name.localeCompare(b.name)), [users, onTeam, editing]);
  const profile = profiles.find((p) => p.userId === userId);
  const maxA = mode === "new" ? (employmentType === "part_time" ? Math.max(0.25, Math.floor((hoursPct / 100) * 4) / 4) : 1) : maxAllocationFactor(profile);
  const overrideNum = override.trim() === "" ? null : Number(override);
  const W = memberWeight({ roles, specialistWeight: roles.includes("specialist") ? specialistWeight : null, weightOverride: overrideNum != null && Number.isFinite(overrideNum) ? overrideNum : null });
  const standardW = memberWeight({ roles, specialistWeight: roles.includes("specialist") ? specialistWeight : null, weightOverride: null });
  const E = W * allocation;
  const share = othersE + E > 0 ? E / (othersE + E) : 0;
  const eligibility = mode === "existing" && userId ? participationEligibility(profile) : null;
  const cap = mode === "existing" && userId ? capacityCheck(userId, ini, roles, initiatives, members) : null;
  const nonLead = mode === "existing" && userId ? concurrentNonLeadRoles(userId, initiatives, members, ini.id) + (roles.some((r) => r === "engineer" || r === "secretary" || r === "specialist") ? 1 : 0) : 0;
  const needsNote = (overrideNum != null && Math.abs((overrideNum ?? 0) - standardW) > 1e-9) || allocation < 1;
  const newValid = mode === "new" ? name.trim().length > 1 && /.+@.+\..+/.test(email) && !!hireDate && EMPLOYMENT_META[employmentType].eligible : true;
  const valid = (mode === "new" ? newValid : !!userId) && roles.length > 0 && (!needsNote || note.trim().length > 3) && allocation <= maxA && (overrideNum == null || (Number.isFinite(overrideNum) && overrideNum > 0));

  const toggleRole = (r: ProjectRole) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  const save = () => {
    if (!valid) return;
    const sw = roles.includes("specialist") ? specialistWeight : null;
    const wo = overrideNum;
    if (editing && member) {
      if (approved && Date.parse(member.joinedAt) < Date.now()) {
        proposeAmendment(ini.id, { kind: "change", memberId: member.id, roles, specialistWeight: sw, weightOverride: wo, allocationFactor: allocation }, fromDateInput(effective), note || "Change of role, weight or allocation");
        notify("Amendment circulated to the team — majority of current members decides (§6.8)");
      } else {
        updateMember(member.id, { roles, specialistWeight: sw, weightOverride: wo, allocationFactor: allocation, weightNote: note, joinedAt: fromDateInput(joined), consent: signed ? "accepted" : "pending", managerApproved: manager, allocationPct });
        notify("Register updated");
      }
      onOpenChange(false);
      return;
    }
    let uid = userId;
    if (mode === "new") {
      uid = addPerson({
        name,
        email,
        title: title || "Staff",
        team,
        employmentType,
        hireDate: fromDateInput(hireDate),
        directManagerId: managerId || null,
        contractedHoursPct: employmentType === "part_time" ? hoursPct : undefined,
        contractEndDate: employmentType === "fixed_term_contract" && contractEnd ? fromDateInput(contractEnd) : null,
        acknowledgmentSignedAt: annexB ? fromDateInput(annexB) : null,
      });
    }
    if (approved && Date.parse(fromDateInput(joined)) <= Date.now() && onTeam.size > 0) {
      proposeAmendment(ini.id, { kind: "add", userId: uid, roles, specialistWeight: sw, weightOverride: wo, allocationFactor: allocation, consent: signed }, fromDateInput(joined), note || `Add ${mode === "new" ? name : users.find((u) => u.id === uid)?.name ?? "member"} to the team`);
      notify("Admission circulated to the team — the new member doesn't vote on their own admission (§6.8)");
    } else {
      addMember(ini.id, uid, roles, { specialistWeight: sw, weightOverride: wo, weightNote: note, allocationFactor: allocation, joinedAt: fromDateInput(joined), consent: signed ? "accepted" : "pending", managerApproved: manager, prcApproved: false, allocationPct, authority: "Role and Weight Agreement (Annex D Part 1)" });
      notify("Added to the register");
    }
    onOpenChange(false);
  };

  const amendmentMode = editing ? approved && !!member && Date.parse(member.joinedAt) < Date.now() : approved && onTeam.size > 0 && Date.parse(fromDateInput(joined)) <= Date.now();

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit register entry" : "Add to the project team"}
      description={amendmentMode ? "This project has a code, so changes go to the team as an amendment: more than half of current members must agree, and it applies from the effective date only (§6.8)." : "Initial Role and Weight Agreement — standard weights apply unless every initial member agrees to different ones (§6.7)."}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} onClick={save}>
            {amendmentMode ? "Circulate amendment" : editing ? "Save" : "Add to register"}
          </Button>
        </>
      }
    >
      <div
        className="grid gap-4"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
      >
        {!editing ? (
          <div className="inline-flex w-fit rounded-md border border-sg-line p-0.5 text-xs font-semibold">
            <button type="button" className={cn("rounded px-2.5 py-1", mode === "existing" ? "bg-sg-card-3 text-sg-white" : "text-sg-muted")} onClick={() => setMode("existing")}>
              Existing person
            </button>
            <button type="button" className={cn("inline-flex items-center gap-1 rounded px-2.5 py-1", mode === "new" ? "bg-sg-card-3 text-sg-white" : "text-sg-muted")} onClick={() => setMode("new")}>
              <UserPlus className="size-3.5" /> New person
            </button>
          </div>
        ) : null}

        {mode === "existing" ? (
          <Field label="Person">
            <Select value={userId} onChange={(e) => setUserId(e.target.value)} disabled={editing}>
              <option value="">Choose…</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.title}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <div className="grid gap-3 rounded-lg border border-sg-line p-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Full name">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Work email">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@spectrumgroup.id" />
              </Field>
              <Field label="Job title">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Team">
                <Select value={team} onChange={(e) => setTeam(e.target.value as Team)}>
                  {TEAMS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Employment status (§3)" hint={EMPLOYMENT_META[employmentType].eligible ? undefined : "Not eligible — their cost is a direct cost (§3.2)"}>
                <Select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {EMPLOYMENT_META[t].label}
                      {EMPLOYMENT_META[t].eligible ? "" : " — not eligible"}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Hire date">
                <Input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
              </Field>
              <Field label="Line manager">
                <Select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                  <option value="">—</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Annex B signed on" hint="Bonuses are held until signed (§15.1)">
                <Input type="date" value={annexB} onChange={(e) => setAnnexB(e.target.value)} />
              </Field>
              {employmentType === "part_time" ? (
                <Field label="Contracted hours (% of full-time)" hint="Caps the allocation factor (§3.1)">
                  <Input type="number" min={10} max={100} value={hoursPct} onChange={(e) => setHoursPct(Number(e.target.value))} />
                </Field>
              ) : null}
              {employmentType === "fixed_term_contract" ? (
                <Field label="Contract end (PKWT)">
                  <Input type="date" value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} />
                </Field>
              ) : null}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="sg-eyebrow">Roles — weights add up</span>
            <PolicyRef s="6.3" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PROJECT_ROLES.map((r) => {
              const on = roles.includes(r);
              const blocked = r === "initiator" && ini.origination === "company";
              return (
                <button
                  key={r}
                  type="button"
                  disabled={blocked}
                  title={blocked ? "No Initiator weight on company-channel opportunities (§4.1)" : ROLE_META[r].description}
                  onClick={() => toggleRole(r)}
                  className={cn("rounded-md border px-2 py-1 text-xs font-semibold", on ? "border-sg-white bg-sg-card-3 text-sg-white" : "border-sg-line text-sg-muted hover:text-sg-white", blocked && "cursor-not-allowed opacity-40")}
                >
                  {ROLE_META[r].label} <span className="sg-num text-sg-dim">{r === "specialist" ? "1.5–2.5" : ROLE_META[r].weight}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {roles.includes("specialist") ? (
            <Field label="Specialist weight (§6.2)">
              <Select value={specialistWeight} onChange={(e) => setSpecialistWeight(Number(e.target.value))}>
                {SPECIALIST_GUIDE.map((g) => (
                  <option key={g.weight} value={g.weight}>
                    {g.weight} — {g.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Allocation factor (§6.4)" hint={maxA < 1 ? `Part-time cap ${maxA}` : "1.0 unless materially less time"}>
            <Select value={allocation} onChange={(e) => setAllocation(Number(e.target.value))}>
              {ALLOCATION_FACTORS.map((a) => (
                <option key={a} value={a} disabled={a > maxA}>
                  {a.toFixed(2)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Agreed weight (optional)" hint={`Standard ${standardW}`}>
            <Input type="number" step={0.25} min={0.25} value={override} onChange={(e) => setOverride(e.target.value)} placeholder={String(standardW)} />
          </Field>
          <Field label={amendmentMode && editing ? "Effective from" : "Start on team"}>
            {amendmentMode && editing ? <Input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} /> : <Input type="date" value={joined} onChange={(e) => setJoined(e.target.value)} />}
          </Field>
          <Field label="Planned time (%)" hint="Agreed with the line manager (§7.1)">
            <Input type="number" min={5} max={100} value={allocationPct} onChange={(e) => setAllocationPct(Number(e.target.value))} />
          </Field>
        </div>

        <Field label={needsNote ? "Reason for the non-standard weight / allocation (required)" : "Other considerations (optional)"} hint="Recorded in the register and the Role and Weight Agreement (Annex D)">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Engineer of record signing the regulated design; half-time while also on another project" />
        </Field>

        {!amendmentMode ? (
          <div className="flex flex-wrap gap-4 text-xs text-sg-muted">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="size-3.5 accent-white" checked={signed} onChange={(e) => setSigned(e.target.checked)} /> Signed the Role and Weight Agreement <PolicyRef s="6.7" />
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="size-3.5 accent-white" checked={manager} onChange={(e) => setManager(e.target.checked)} /> Line manager agreed the time <PolicyRef s="3.1" />
            </label>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 rounded-lg border border-sg-line bg-sg-bg/40 p-3 text-xs md:grid-cols-4">
          <Preview label="Weight W" value={W.toFixed(2)} />
          <Preview label="Effective W×A" value={E.toFixed(2)} />
          <Preview label="Share of pool" value={`${(share * 100).toFixed(1)}%`} />
          <Preview label="% of net revenue" value={`${(share * rate * 100).toFixed(3)}%`} />
        </div>

        {eligibility && (eligibility.blockers.length || eligibility.warnings.length) ? (
          <ul className="space-y-1 text-xs">
            {eligibility.blockers.map((b) => (
              <li key={b} className="flex items-start gap-1.5 text-soft-red">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {b}
              </li>
            ))}
            {eligibility.warnings.map((w) => (
              <li key={w} className="flex items-start gap-1.5 text-soft-orange">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {w}
              </li>
            ))}
          </ul>
        ) : null}
        {cap && !cap.ok ? <p className="text-xs text-soft-red">Leadership capacity would reach {cap.after.toFixed(2)} — the limit is 2.0 (§7.3).</p> : null}
        {nonLead > 3 ? <p className="text-xs text-soft-orange">That would be {nonLead} concurrent non-lead roles — more than 3 needs line manager and PRC approval (§7.1).</p> : null}
      </div>
    </Modal>
  );
}

function Preview({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="sg-eyebrow">{label}</div>
      <div className="sg-num mt-0.5 text-sm font-semibold text-sg-white">{value}</div>
    </div>
  );
}
