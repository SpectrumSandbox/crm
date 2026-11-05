"use client";

import { useEffect, useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Team } from "@/lib/types";
import type { EmploymentType, Initiative, InitiativeMember, ProjectRole } from "@/lib/initiatives/types";
import { EMPLOYMENT_TYPES, PROJECT_ROLES } from "@/lib/initiatives/types";
import { ALLOCATION_FACTORS, EMPLOYMENT_META, ROLE_META, SPECIALIST_GUIDE } from "@/lib/initiatives/policy";
import { memberWeight } from "@/lib/initiatives/engine";
import { amendmentVoters, canProceed, currentVoters, isPastDay, ledgerDate, overrideRule, requiresAmendment, todayWib, wibDay } from "@/lib/initiatives/team-rules";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/overlays";
import { CandidateNotices, useCandidateCheck } from "@/components/initiatives/candidate-notices";
import { PersonCombobox } from "@/components/initiatives/person-combobox";
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

/**
 * Add or edit a register row. The rules are the same as the initiative Team tab (src/lib/initiatives/team-rules.ts):
 * once the project has a Team Allocation Ledger every change is a §6.8 amendment; eligibility (§3), leadership capacity
 * (§7.3) and part-time caps (§3.1) block; non-standard weights need every initial member's written agreement (§6.7).
 */
export function MemberDialog({ ini, open, onOpenChange, member, othersE, rate }: Props) {
  const users = useCrm((s) => s.users);
  const profiles = useCrm((s) => s.employeeProfiles);
  const members = useCrm((s) => s.initiativeMembers);
  const addMember = useCrm((s) => s.addMember);
  const updateMember = useCrm((s) => s.updateMember);
  const addPerson = useCrm((s) => s.addPerson);
  const proposeAmendment = useCrm((s) => s.proposeAmendment);
  const notify = useUi((s) => s.notify);
  const editing = !!member;
  const amendmentMode = requiresAmendment(ini, members);

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [userId, setUserId] = useState("");
  const [roles, setRoles] = useState<ProjectRole[]>(["engineer"]);
  const [specialistWeight, setSpecialistWeight] = useState(2);
  const [allocation, setAllocation] = useState(1);
  const [override, setOverride] = useState("");
  const [note, setNote] = useState("");
  const [joined, setJoined] = useState(wibDay(ini.startDate));
  const [effective, setEffective] = useState(todayWib());
  // attestations are never pre-ticked: each is an explicit statement recorded on the agreement (§6.7, §3.1)
  const [signed, setSigned] = useState(false);
  const [manager, setManager] = useState(false);
  const [allSigned, setAllSigned] = useState(false);
  const [annexC, setAnnexC] = useState(false);
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
    const today = todayWib();
    if (member) {
      setMode("existing");
      setUserId(member.userId);
      setRoles(member.roles);
      setSpecialistWeight(member.specialistWeight ?? 2);
      setAllocation(member.allocationFactor ?? 1);
      setOverride(member.weightOverride != null ? String(member.weightOverride) : "");
      setNote(member.weightNote ?? "");
      setJoined(wibDay(member.joinedAt));
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
      const start = wibDay(ini.startDate);
      setJoined(amendmentMode ? (start > today ? start : today) : start);
      setSigned(false);
      setManager(false);
      setAllocationPct(20);
      setName("");
      setEmail("");
      setTitle("");
      setHireDate("");
      setManagerId("");
      setAnnexB("");
    }
    setAllSigned(false);
    setAnnexC(false);
    setEffective(today);
  }, [open, member, ini.startDate, amendmentMode]);

  const onTeam = useMemo(() => new Set(members.filter((m) => m.initiativeId === ini.id && m.consent !== "declined" && (!m.leftAt || Date.parse(m.leftAt) > Date.now())).map((m) => m.userId)), [members, ini.id]);
  const candidates = useMemo(() => users.filter((u) => editing || !onTeam.has(u.id)), [users, onTeam, editing]);
  const maxANew = employmentType === "part_time" ? Math.max(0.25, Math.floor((hoursPct / 100) * 4) / 4) : 1;
  const overrideNum = override.trim() === "" ? null : Number(override.replace(",", "."));
  const sw = roles.includes("specialist") ? specialistWeight : null;
  const standardW = memberWeight({ roles, specialistWeight: sw, weightOverride: null });
  const W = memberWeight({ roles, specialistWeight: sw, weightOverride: overrideNum != null && Number.isFinite(overrideNum) ? overrideNum : null });
  const E = W * allocation;
  const share = othersE + E > 0 ? E / (othersE + E) : 0;

  const dateField = amendmentMode ? (editing ? effective : joined) : joined;
  const effectiveIso = dateField ? ledgerDate(dateField) : undefined;
  const check = useCandidateCheck(mode === "existing" ? userId : "", roles, allocation, ini, effectiveIso, member?.id);
  const rule = overrideRule({ value: overrideNum, standard: standardW, reason: note, allSigned, viaAmendment: amendmentMode });

  // §3.5 duplicates when adding a new person
  const dupe = useMemo(() => {
    if (mode !== "new") return undefined;
    const e = email.trim().toLowerCase();
    const n = name.trim().toLowerCase().replace(/\s+/g, " ");
    return users.find((u) => (e && u.email.toLowerCase() === e) || (n.length > 3 && u.name.toLowerCase() === n));
  }, [mode, email, name, users]);

  const errors: string[] = [];
  if (mode === "existing" && !userId) errors.push("Choose who joins");
  if (mode === "new") {
    if (name.trim().length < 2) errors.push("Full name");
    if (!/.+@.+\..+/.test(email)) errors.push("A valid work email");
    if (!hireDate) errors.push("Hire date");
    if (!EMPLOYMENT_META[employmentType].eligible) errors.push(`${EMPLOYMENT_META[employmentType].label} may not take part (§3.2)`);
    if (dupe) errors.push(`${dupe.name} (${dupe.email}) is already in the workspace — use the existing person`);
    if (hireDate && dateField && hireDate > dateField) errors.push("Start on the team can't be before the hire date");
    if (employmentType === "probationary" && !annexC) errors.push("Annex C probationary acknowledgment (§11)");
    if (allocation > maxANew + 1e-9) errors.push(`Part-time — allocation factor may not exceed ${maxANew} (§3.1)`);
  }
  if (!roles.length) errors.push("Pick at least one role");
  if (mode === "existing" && userId && !canProceed(check, annexC)) errors.push(check?.blockers.length ? "The policy blocks this role — see below" : "Annex C probationary acknowledgment (§11)");
  errors.push(...rule.errors);
  if (allocation < 1 && note.trim().length < 4) errors.push("Note the time committed when the allocation factor is below 1.0 (§6.4)");
  if (!Number.isFinite(allocationPct) || allocationPct < 5 || allocationPct > 100) errors.push("Planned time must be 5–100%");
  if (!dateField) errors.push(amendmentMode && editing ? "Effective date" : "Start on team");
  if (amendmentMode && isPastDay(dateField)) errors.push("Amendments apply from their effective date forward — never to past work (§6.8 step 6)");
  if (amendmentMode && !editing && !signed) errors.push("The joining member must consent to their role, weight and allocation factor (§6.8 step 4)");
  if (amendmentMode && !editing && !manager) errors.push("Record the line manager's agreement to the time (§3.1)");
  const valid = errors.length === 0;

  const toggleRole = (r: ProjectRole) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  const save = () => {
    if (!valid) return;
    const wo = overrideNum;
    if (editing && member) {
      if (amendmentMode) {
        const id = proposeAmendment(ini.id, { kind: "change", memberId: member.id, roles, specialistWeight: sw, weightOverride: wo, allocationFactor: allocation }, ledgerDate(effective), note.trim() || "Change of role, weight or allocation");
        const status = useCrm.getState().teamAmendments.find((a) => a.id === id)?.status;
        notify(status === "passed" ? "Amendment passed — ledger updated (§6.8)" : status === "tied" ? "Amendment circulated — no voting members, the PRC decides (§6.8)" : "Amendment circulated to the team — more than half of current members decides (§6.8)");
      } else {
        updateMember(member.id, { roles, specialistWeight: sw, weightOverride: wo, allocationFactor: allocation, weightNote: note, joinedAt: ledgerDate(joined), consent: signed ? "accepted" : "pending", managerApproved: manager, allocationPct });
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
        hireDate: ledgerDate(hireDate),
        directManagerId: managerId || null,
        contractedHoursPct: employmentType === "part_time" ? hoursPct : undefined,
        contractEndDate: employmentType === "fixed_term_contract" && contractEnd ? ledgerDate(contractEnd) : null,
        acknowledgmentSignedAt: annexB ? ledgerDate(annexB) : null,
      });
    }
    const who = mode === "new" ? name : users.find((u) => u.id === uid)?.name ?? "member";
    if (amendmentMode) {
      // §6.8: every admission to a project with a ledger is an amendment, whatever its start date
      const id = proposeAmendment(ini.id, { kind: "add", userId: uid, roles, specialistWeight: sw, weightOverride: wo, allocationFactor: allocation, consent: signed, managerApproved: manager, weightNote: note.trim(), allocationPct }, ledgerDate(joined), note.trim() || `Add ${who} to the team`);
      const status = useCrm.getState().teamAmendments.find((a) => a.id === id)?.status;
      notify(status === "passed" ? `${who} admitted — ledger updated (§6.8)` : status === "tied" ? "Admission circulated — no voting members yet, the PRC decides (§6.8)" : "Admission circulated to the team — the new member doesn't vote on their own admission (§6.8)");
    } else {
      addMember(ini.id, uid, roles, { specialistWeight: sw, weightOverride: wo, weightNote: note, allocationFactor: allocation, joinedAt: ledgerDate(joined), consent: signed ? "accepted" : "pending", managerApproved: manager, prcApproved: false, allocationPct, authority: "Role and Weight Agreement (Annex D Part 1)" });
      notify(`Added to the register${signed ? "" : " — awaiting signature"}${manager ? "" : " · line manager agreement pending"}`);
    }
    onOpenChange(false);
  };

  const voters = amendmentMode ? (editing ? currentVoters(members, ini.id) : amendmentVoters({ initiativeId: ini.id, change: { kind: "add", userId: userId || "-", roles, specialistWeight: sw, weightOverride: null, allocationFactor: allocation, consent: signed } }, members)) : [];
  const probationNew = mode === "new" && employmentType === "probationary";

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit register entry" : "Add to the project team"}
      description={amendmentMode ? "This project has a Team Allocation Ledger, so every change goes to the team as an amendment: more than half of current members must agree, and it applies from the effective date only (§6.8)." : "Initial Role and Weight Agreement — standard weights apply unless every initial member agrees to different ones (§6.7)."}
      className="max-w-2xl"
      footer={
        <>
          {amendmentMode ? <span className="mr-auto text-2xs text-sg-dim">{voters.length} current member{voters.length === 1 ? "" : "s"} vote{voters.length ? ` · passes with ${Math.floor(voters.length / 2) + 1}` : " — the PRC decides"}</span> : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} onClick={save} title={errors.join("\n")}>
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
            <PersonCombobox value={userId} onChange={(v) => (setUserId(v), setAnnexC(false), setSigned(false), setManager(false))} users={candidates} disabled={editing} />
          </Field>
        ) : (
          <div className="grid gap-3 rounded-lg border border-sg-line p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Work email">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@spectrumgroup.id" />
              </Field>
              {dupe ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-soft-yellow/40 bg-soft-yellow/10 px-2.5 py-1.5 text-xs text-soft-yellow sm:col-span-2">
                  {dupe.name} ({dupe.email}) is already in the workspace.
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      setMode("existing");
                      setUserId(dupe.id);
                    }}
                  >
                    Use existing {dupe.name.split(" ")[0]}
                  </Button>
                </div>
              ) : null}
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
                <Input type="date" lang="en-GB" value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
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
                <Input type="date" lang="en-GB" value={annexB} onChange={(e) => setAnnexB(e.target.value)} />
              </Field>
              {employmentType === "part_time" ? (
                <Field label="Contracted hours (% of full-time)" hint="Caps the allocation factor (§3.1)">
                  <Input type="number" min={10} max={100} value={hoursPct} onChange={(e) => setHoursPct(Number(e.target.value))} />
                </Field>
              ) : null}
              {employmentType === "fixed_term_contract" ? (
                <Field label="Contract end (PKWT)">
                  <Input type="date" lang="en-GB" value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} />
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
                  aria-pressed={on}
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
          <Field label="Allocation factor (§6.4)" hint={(mode === "new" ? maxANew : check?.maxA ?? 1) < 1 ? `Part-time cap ${mode === "new" ? maxANew : check?.maxA}` : "1.0 unless materially less time"}>
            <Select value={allocation} onChange={(e) => setAllocation(Number(e.target.value))}>
              {ALLOCATION_FACTORS.map((a) => (
                <option key={a} value={a} disabled={a > (mode === "new" ? maxANew : check?.maxA ?? 1) + 1e-9}>
                  {a.toFixed(2)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Agreed weight (optional)" hint={`Standard ${standardW} · max 10`}>
            <Input inputMode="decimal" value={override} onChange={(e) => setOverride(e.target.value.replace(/[^\d.,]/g, ""))} placeholder={String(standardW)} />
          </Field>
          <Field label={amendmentMode && editing ? "Effective from" : "Start on team"} hint={amendmentMode ? "From today onward (§6.8)" : undefined}>
            {amendmentMode && editing ? (
              <Input type="date" lang="en-GB" min={todayWib()} value={effective} onChange={(e) => setEffective(e.target.value)} />
            ) : (
              <Input type="date" lang="en-GB" min={amendmentMode ? todayWib() : undefined} value={joined} onChange={(e) => setJoined(e.target.value)} />
            )}
          </Field>
          <Field label="Planned time (%)" hint="Agreed with the line manager (§7.1)">
            <Input type="number" min={5} max={100} value={allocationPct} onChange={(e) => setAllocationPct(Number(e.target.value))} />
          </Field>
        </div>

        <Field label={rule.nonStandard || allocation < 1 ? "Reason for the non-standard weight / allocation (required)" : "Other considerations (optional)"} hint="Recorded in the register and the Role and Weight Agreement (Annex D)">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Engineer of record signing the regulated design; half-time while also on another project" />
        </Field>

        <div className="flex flex-col gap-1.5 text-xs text-sg-muted">
          {!(amendmentMode && editing) ? (
            <>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" className="size-3.5 accent-white" checked={signed} onChange={(e) => setSigned(e.target.checked)} />
                {amendmentMode ? "The joining member consents to the role, weight and allocation factor (does not vote on their own admission)" : "Signed the Role and Weight Agreement"} <PolicyRef s={amendmentMode ? "6.8" : "6.7"} />
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" className="size-3.5 accent-white" checked={manager} onChange={(e) => setManager(e.target.checked)} /> Line manager agreed the time in writing <PolicyRef s="3.1" />
              </label>
            </>
          ) : null}
          {rule.nonStandard && !amendmentMode ? (
            <label className="flex items-center gap-1.5 text-soft-yellow">
              <input type="checkbox" className="size-3.5 accent-white" checked={allSigned} onChange={(e) => setAllSigned(e.target.checked)} /> Every initial member has agreed this weight in writing <PolicyRef s="6.7" />
            </label>
          ) : null}
          {probationNew ? (
            <label className="flex items-center gap-1.5 text-soft-orange">
              <input type="checkbox" className="size-3.5 accent-white" checked={annexC} onChange={(e) => setAnnexC(e.target.checked)} /> Annex C probationary acknowledgment signed — bonuses held until probation ends <PolicyRef s="11.3" />
            </label>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-lg border border-sg-line bg-sg-bg/40 p-3 text-xs md:grid-cols-4">
          <Preview label="Weight W" value={W.toFixed(2)} />
          <Preview label="Effective W×A" value={E.toFixed(2)} />
          <Preview label="Share of pool" value={`${(share * 100).toFixed(1)}%`} />
          <Preview label="% of net revenue" value={`${(share * rate * 100).toFixed(3)}%`} />
        </div>

        {mode === "existing" ? <CandidateNotices check={check} ack={annexC} onAck={setAnnexC} /> : null}
        {errors.length && (userId || name || email) ? (
          <ul className="space-y-0.5 text-2xs text-soft-yellow">
            {errors.map((e) => (
              <li key={e}>• {e}</li>
            ))}
          </ul>
        ) : null}
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
