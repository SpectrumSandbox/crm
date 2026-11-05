"use client";

/*
 * Team editor for an initiative — Policy v4.0.
 *  · proposal mode: the Role and Weight Agreement (§6.7, Annex D Part 1) is edited directly: roles (weights add up, §6.3),
 *    specialist weight (§6.2), allocation factor (§6.4), agreed non-standard weight with a reason, line manager agreement (§3.1)
 *    and signature; eligibility (§3), leadership capacity (§7.3) and concurrent non-lead roles (§7.1) are checked inline.
 *  · live mode (after approval): changes go through §6.8 amendments voted by the current team (Annex D Part 2); a passed
 *    amendment updates the Team Allocation Ledger (Annex D Part 3), which is shown with its closed rows.
 *    A live project with no ledger yet (e.g. an ongoing project registered retroactively) is set up directly (§15.1).
 */
import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Ban, Check, ChevronDown, ChevronRight, CircleAlert, ClipboardList, Gavel, History, Info, Lock, Pencil, Plus, Scale, Send, ShieldCheck, Trash2, TriangleAlert, UserCheck, UserMinus, UserPlus, Users, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import { PROJECT_ROLES, type EmployeeProfile, type Initiative, type InitiativeMember, type ProjectRole, type TeamAmendment } from "@/lib/initiatives/types";
import { addBusinessDays, capacityCheck, concurrentNonLeadRoles, effectiveWeight, maxAllocationFactor, memberWeight, proposalEconomics, splitBonus } from "@/lib/initiatives/engine";
import { amendmentIssues, canProceed, currentVoters, hasStarted, isOpenRow, ledgerDate, ledgerExists, NON_LEAD_ROLES, openLeads, overrideRule, OVERRIDE_MAX, prcCanDecide, requiresAmendment, todayWib } from "@/lib/initiatives/team-rules";
import { CandidateNotices, useCandidateCheck } from "./candidate-notices";
import { PersonCombobox } from "./person-combobox";
import { ALLOCATION_FACTORS, POLICY, PROJECT_TYPE_META, ROLE_META, SPECIALIST_GUIDE, SPECIALIST_RANGE } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR, relativeTime, spectrumDot, toDateInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Avatar, Chip, EmptyState } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Modal, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { CapacityMeter, Cite, EligibilityBadge, Money, Pct, RoleChips } from "./shared";

type Mode = "proposal" | "live";
type Dialog = { kind: "override"; memberId: string } | { kind: "removal"; memberId: string } | { kind: "amend"; preset?: Partial<AmendDraft> } | null;

const DAY = 86_400_000;
const SPECIALIST_OPTIONS = Array.from({ length: Math.round((SPECIALIST_RANGE[1] - SPECIALIST_RANGE[0]) * 10) + 1 }, (_, i) => Math.round((SPECIALIST_RANGE[0] + i * 0.1) * 10) / 10);
const ASSIGNABLE_ROLES = PROJECT_ROLES.filter((r) => r !== "initiator");
const NON_LEAD = NON_LEAD_ROLES;
/** WIB midnight of a yyyy-mm-dd date — amendments take effect from the start of their effective date (team-rules). */
const startOfDay = ledgerDate;
const todayInput = todayWib;

function RoleToggles({ value, onChange, roles, disabledRoles = {} }: { value: ProjectRole[]; onChange: (v: ProjectRole[]) => void; roles: readonly ProjectRole[]; disabledRoles?: Partial<Record<ProjectRole, string>> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((r) => {
        const on = value.includes(r);
        const disabled = disabledRoles[r];
        return (
          <button
            key={r}
            type="button"
            disabled={!!disabled}
            title={disabled ?? `${ROLE_META[r].description} · weight ${r === "specialist" ? `${SPECIALIST_RANGE[0]}–${SPECIALIST_RANGE[1]}` : ROLE_META[r].weight}`}
            onClick={() => onChange(on ? value.filter((x) => x !== r) : [...value, r])}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-sm border px-1.5 text-2xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              on ? "border-sg-white/70 bg-sg-card-3 text-sg-white" : "border-sg-line text-sg-muted hover:border-sg-line-2 hover:text-sg-white",
            )}
          >
            {on ? <Check className="size-3" /> : null}
            {ROLE_META[r].label}
            <span className="sg-num text-sg-dim">{r === "specialist" ? "1.5–2.5" : ROLE_META[r].weight.toFixed(1)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** §6.2 specialist weight with the guide's anchors labelled. */
function SpecialistSelect({ value, onChange, className }: { value: number; onChange: (v: number) => void; className?: string }) {
  return (
    <Select aria-label="Specialist weight" value={value.toFixed(1)} onChange={(e) => onChange(Number(e.target.value))} wrapperClassName={cn("w-[210px]", className)} className="h-6 px-1.5 pr-6 text-2xs" title="Specialist weight 1.5–2.5, agreed by the team (§6.2)">
      {SPECIALIST_OPTIONS.map((w) => {
        const guide = SPECIALIST_GUIDE.find((g) => Math.abs(g.weight - w) < 1e-9);
        return (
          <option key={w} value={w.toFixed(1)}>
            {w.toFixed(1)}
            {guide ? ` — ${guide.label}` : ""}
          </option>
        );
      })}
    </Select>
  );
}

/** §6.4 allocation factor, capped for part-time staff (§3.1). */
function AllocationSelect({ value, max, onChange, disabled }: { value: number; max: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <Select aria-label="Allocation factor" value={String(value)} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} wrapperClassName="w-[74px]" className={cn("h-6 px-1.5 pr-6 text-2xs", value > max + 1e-9 && "border-soft-red/60 text-soft-red")} title={`Allocation factor (§6.4)${max < 1 ? ` — part-time, at most ${max}` : ""}`}>
      {ALLOCATION_FACTORS.map((a) => (
        <option key={a} value={String(a)} disabled={a > max + 1e-9}>
          {a.toFixed(2)}
        </option>
      ))}
    </Select>
  );
}

/* ───────────────────────── main component ───────────────────────── */

export function TeamEditor({ initiativeId, mode }: { initiativeId: string; mode: Mode }) {
  const initiatives = useCrm((s) => s.initiatives);
  const allMembers = useCrm((s) => s.initiativeMembers);
  const amendments = useCrm((s) => s.teamAmendments);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const profiles = useCrm((s) => s.employeeProfiles);
  const currentUserId = useCrm((s) => s.currentUserId);
  const approveMembers = useCrm((s) => s.approveMembers);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const initiative = initiatives.find((i) => i.id === initiativeId);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [now] = useState(() => Date.now());

  const rows = useMemo(() => allMembers.filter((m) => m.initiativeId === initiativeId), [allMembers, initiativeId]);
  const hasLedger = ledgerExists(allMembers, initiativeId);
  /** setup: a live project whose ledger has not been built yet is set up directly, as at proposal stage (§15.1) — same rule as /projects (team-rules.requiresAmendment) */
  const direct = mode === "proposal" || !(initiative ? requiresAmendment(initiative, allMembers) : hasLedger);

  const { current, upcoming } = useMemo(() => {
    const rank = (m: InitiativeMember) => (m.roles.includes("project_lead") ? 0 : m.roles.includes("initiator") ? 1 : m.roles.includes("technical_lead") ? 2 : 3);
    const open = rows.filter((m) => isOpenRow(m, now));
    const cur = direct ? open : open.filter((m) => hasStarted(m, now));
    return {
      current: cur.sort((a, b) => rank(a) - rank(b) || a.joinedAt.localeCompare(b.joinedAt)),
      upcoming: direct ? [] : open.filter((m) => !hasStarted(m, now)).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)),
    };
  }, [rows, direct, now]);

  const econ = useMemo(() => (initiative ? proposalEconomics(initiative, adjustments) : null), [initiative, adjustments]);
  const counted = useMemo(() => current.filter((m) => m.consent !== "declined"), [current]);
  const split = useMemo(() => splitBonus(counted.map((m) => ({ userId: m.userId, weight: effectiveWeight(m) })), econ?.rate.rate ?? 0, econ?.expected.net ?? 0), [counted, econ]);
  const bonusByUser = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of split.shares) map.set(s.userId, (map.get(s.userId) ?? 0) + s.bonus);
    return map;
  }, [split]);
  const myAmendments = useMemo(() => amendments.filter((a) => a.initiativeId === initiativeId).sort((a, b) => Number(b.status === "open" || b.status === "tied") - Number(a.status === "open" || a.status === "tied") || b.circulatedAt.localeCompare(a.circulatedAt)), [amendments, initiativeId]);

  if (!initiative || !econ) return <EmptyState icon={Users} title="Initiative not found">Save the proposal first so a team can be attached.</EmptyState>;

  const unapproved = current.filter((m) => m.consent === "accepted" && !m.prcApproved);
  const pendingSign = current.filter((m) => m.consent === "pending");
  const pendingManager = current.filter((m) => m.consent !== "declined" && !m.managerApproved);
  const overrides = current.filter((m) => m.weightOverride != null && m.consent !== "declined");
  const dialogMember = dialog && "memberId" in dialog ? allMembers.find((m) => m.id === dialog.memberId) : undefined;
  const onTeam = current.some((m) => m.userId === currentUserId && m.consent !== "declined");
  const v3 = initiative.policyVersion === "3.0";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sg-line bg-sg-card">
        {/* header */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-sg-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-sg-muted" />
            <span className="font-display text-sm font-extrabold text-sg-white">{direct ? "Role and Weight Agreement" : "Team"}</span>
            <Cite s={direct ? "6.7" : "6.5"} />
            <span className="rounded-sm bg-sg-card-3 px-1.5 text-2xs font-semibold text-sg-muted">{counted.length}</span>
          </div>
          <div className="text-2xs text-sg-dim">
            Σ W×A <span className="sg-num font-semibold text-sg-white">{split.total.toFixed(2)}</span>
            <Cite s="6.6" />
          </div>
          {pendingSign.length > 0 && <Chip color="yellow">{pendingSign.length} to sign</Chip>}
          {pendingManager.length > 0 && <Chip color="orange">{pendingManager.length} without line manager agreement</Chip>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {mode === "live" && unapproved.length > 0 && (
              <Button
                size="sm"
                variant="primary"
                title={`${unapproved.length} signed row(s) not yet PRC-checked. Recorded by ${userMap.get(currentUserId)?.name ?? "current user"} as PRC (§6.7).`}
                onClick={() => {
                  approveMembers(initiativeId);
                  notify(`PRC check recorded — ${unapproved.length} ledger row${unapproved.length === 1 ? "" : "s"} confirmed`);
                }}
              >
                <ShieldCheck /> PRC check
              </Button>
            )}
            {!direct && (
              <Button size="sm" variant="primary" onClick={() => setDialog({ kind: "amend" })} title={onTeam ? "Propose a change to the team (§6.8)" : "Propose a change — you are not on this team, so you don't vote on it"}>
                <Send /> Propose amendment
              </Button>
            )}
          </div>
        </div>

        {mode === "live" && !hasLedger ? (
          <div className="flex items-start gap-2 border-b border-sg-line bg-soft-cyan/5 px-4 py-2 text-2xs text-sg-text">
            <Info className="mt-0.5 size-3.5 shrink-0 text-soft-cyan" />
            <span>
              No Team Allocation Ledger yet. The PMO builds it from the existing team records, confirmed by the Project Lead{initiative.registeredRetroactively ? " — this project was registered after it started, so the PRC ratifies the ledger" : ""}
              <Cite s="15.1" />. Add the members below, then record the PRC check; later changes go through amendments<Cite s="6.8" />.
            </span>
          </div>
        ) : null}
        {v3 ? (
          <div className="flex items-start gap-2 border-b border-sg-line px-4 py-2 text-2xs text-sg-muted">
            <Lock className="mt-0.5 size-3.5 shrink-0" /> Approved under Version 3.0 — the project keeps its type, flat share and team weights<Cite s="15.1" />.
          </div>
        ) : null}
        {overrides.length > 0 ? (
          <div className="flex items-start gap-2 border-b border-sg-line bg-soft-yellow/5 px-4 py-2 text-2xs text-soft-yellow">
            <Scale className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Non-standard weight for {overrides.map((m) => userMap.get(m.userId)?.name ?? m.userId).join(", ")} — every initial member signs and the reason is recorded<Cite s="6.7" />.
            </span>
          </div>
        ) : null}

        {/* members */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm">
            <thead>
              <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-[0.1em] text-sg-dim">
                <th className="px-4 py-2 font-semibold">Member</th>
                <th className="px-2 py-2 font-semibold">Role(s)</th>
                <th className="px-2 py-2 text-right font-semibold" title="Standard weight (§6.1–6.3)">Std W</th>
                <th className="px-2 py-2 font-semibold" title="Agreed weight W">Agreed W</th>
                <th className="px-2 py-2 font-semibold" title="Allocation factor A (§6.4)">A</th>
                <th className="px-2 py-2 text-right font-semibold" title="Effective weight W × A (§6.6)">W×A</th>
                <th className="px-2 py-2 text-right font-semibold">Pool share</th>
                <th className="px-2 py-2 text-right font-semibold">Exp. bonus</th>
                <th className="px-2 py-2 font-semibold">Line mgr</th>
                <th className="px-2 py-2 font-semibold">Signed</th>
                <th className="px-2 py-2 font-semibold">Checks</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {current.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  initiative={initiative}
                  direct={direct}
                  live={mode === "live"}
                  totalWeight={split.total}
                  bonus={bonusByUser.get(m.userId) ?? 0}
                  profile={profiles.find((p) => p.userId === m.userId)}
                  onOverride={() => setDialog({ kind: "override", memberId: m.id })}
                  onRemoval={() => setDialog({ kind: "removal", memberId: m.id })}
                  onAmend={() => setDialog({ kind: "amend", preset: { kind: "change", memberId: m.id } })}
                />
              ))}
              {upcoming.map((m) => (
                <tr key={m.id} className="border-b border-sg-line bg-sg-bg/30 text-xs">
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <Avatar user={userMap.get(m.userId)} size="xs" />
                      <span className="font-semibold text-sg-muted">{userMap.get(m.userId)?.name ?? m.userId}</span>
                      <Chip color="blue">from {formatDate(m.joinedAt, "medium")}</Chip>
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <RoleChips roles={m.roles} />
                  </td>
                  <td className="sg-num px-2 py-2 text-right text-sg-dim">{memberWeight({ ...m, weightOverride: null }).toFixed(2)}</td>
                  <td className="sg-num px-2 py-2 text-sg-muted">{memberWeight(m).toFixed(2)}</td>
                  <td className="sg-num px-2 py-2 text-sg-muted">{(m.allocationFactor ?? 1).toFixed(2)}</td>
                  <td className="sg-num px-2 py-2 text-right text-sg-muted">{effectiveWeight(m).toFixed(2)}</td>
                  <td colSpan={6} className="px-2 py-2 text-2xs text-sg-dim">
                    Upcoming ledger row — {m.authority ?? "amendment"}
                  </td>
                </tr>
              ))}
              {!current.length && !upcoming.length && (
                <tr>
                  <td colSpan={12} className="px-4 py-6 text-center text-xs text-sg-dim">
                    No team members yet. Every project needs a Project Lead<Cite s="6.1" />.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {direct ? <AddMemberPanel initiative={initiative} current={current} setup={mode === "live"} /> : null}

        {/* bonus split preview */}
        <div className="border-t border-sg-line px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="sg-eyebrow">
              Bonus-split preview
              <Cite s="6.6" />
            </span>
            <span className="text-2xs text-sg-dim">
              Expected net revenue <Money value={econ.expected.net} className="font-semibold text-sg-muted" /> × {(econ.rate.rate * 100).toFixed(3)}% = pool <Money value={split.pool} className="font-semibold text-sg-white" />, shared by W×A ÷ {split.total.toFixed(2)}
            </span>
          </div>
          {split.pool > 0 && split.total > 0 ? (
            <>
              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-sg-card-3">
                {split.shares.map((s, i) => {
                  const u = userMap.get(s.userId);
                  return <span key={`${s.userId}-${i}`} title={`${u?.name ?? s.userId}: ${formatIDR(s.bonus)} (${((s.weight / split.total) * 100).toFixed(1)}%)`} className={cn("h-full border-r-2 border-sg-card last:border-r-0", u ? spectrumDot[u.color] : "bg-sg-dim")} style={{ width: `${(s.weight / split.total) * 100}%` }} />;
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {split.shares.map((s, i) => {
                  const u = userMap.get(s.userId);
                  return (
                    <span key={`${s.userId}-${i}`} className="flex items-center gap-1.5 text-2xs text-sg-muted">
                      <span className={cn("size-2 rounded-full", u ? spectrumDot[u.color] : "bg-sg-dim")} />
                      {u?.name.split(" ")[0] ?? s.userId} <Money value={s.bonus} className="font-semibold text-sg-white" />
                    </span>
                  );
                })}
              </div>
              <p className="mt-1.5 text-2xs text-sg-dim">
                Projection over the project&apos;s life at the expected case, with everyone on the team throughout. Actual bonuses follow collected cash, shared by effective weight-days in each payment&apos;s work period (§6.5, §8.1), after the monthly break-even test and cash check (§9.1).
              </p>
            </>
          ) : (
            <p className="mt-1 text-2xs text-sg-dim">Enter an expected case with revenue above direct costs to preview the split.</p>
          )}
        </div>
      </div>

      {!direct || myAmendments.length ? <AmendmentsCard initiative={initiative} amendments={myAmendments} onPropose={() => setDialog({ kind: "amend" })} canPropose={!direct} /> : null}
      <LedgerCard initiative={initiative} rows={rows} defaultOpen={mode === "live"} />

      {dialog?.kind === "override" && dialogMember && <OverrideModal member={dialogMember} onClose={() => setDialog(null)} />}
      {dialog?.kind === "removal" && dialogMember && <RemovalModal member={dialogMember} onClose={() => setDialog(null)} />}
      {dialog?.kind === "amend" && <AmendmentModal initiative={initiative} current={current} preset={dialog.preset} onClose={() => setDialog(null)} />}
    </div>
  );
}

/* ───────────────────────── member row ───────────────────────── */

function MemberRow({
  member: m,
  initiative,
  direct,
  live,
  totalWeight,
  bonus,
  profile,
  onOverride,
  onRemoval,
  onAmend,
}: {
  member: InitiativeMember;
  initiative: Initiative;
  direct: boolean;
  live: boolean;
  totalWeight: number;
  bonus: number;
  profile: EmployeeProfile | undefined;
  onOverride: () => void;
  onRemoval: () => void;
  onAmend: () => void;
}) {
  const userMap = useUserMap();
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const updateMember = useCrm((s) => s.updateMember);
  const setConsent = useCrm((s) => s.setConsent);
  const removeMember = useCrm((s) => s.removeMember);
  const notify = useUi((s) => s.notify);
  const u = userMap.get(m.userId);
  const std = memberWeight({ ...m, weightOverride: null });
  const weight = memberWeight(m);
  const a = m.allocationFactor ?? 1;
  const eff = effectiveWeight(m);
  const maxA = maxAllocationFactor(profile);
  const leadership = m.roles.some((r) => ROLE_META[r].leadership);
  const declined = m.consent === "declined";
  const sharePct = !declined && totalWeight > 0 ? eff / totalWeight : 0;
  const warningDays = m.removal.stage === "verbal" ? POLICY.removalWarningDays.verbal : m.removal.stage === "written" ? POLICY.removalWarningDays.written : 0;
  const nonLead = useMemo(() => concurrentNonLeadRoles(m.userId, initiatives, members, initiative.id), [m.userId, initiatives, members, initiative.id]);
  const holdsNonLead = m.roles.some((r) => NON_LEAD.includes(r));
  const isProposer = m.userId === initiative.initiatorId && m.roles.includes("initiator");

  return (
    <tr className={cn("border-b border-sg-line align-middle", declined && "opacity-55")}>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <Avatar user={u} size="sm" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate font-semibold text-sg-white">
              {u?.name ?? m.userId}
              {m.application ? (
                <span className="rounded-sm bg-sg-card-3 px-1 text-[9px] font-semibold uppercase text-sg-muted" title={`Joined by amendment (§6.8) — ${m.authority ?? ""}`}>
                  amendment
                </span>
              ) : null}
            </div>
            <div className="truncate text-2xs text-sg-dim">
              {u?.title ?? "—"}
              {live ? ` · since ${formatDate(m.joinedAt, "medium")}` : ""}
            </div>
            {m.removal.stage !== "none" && m.removal.stage !== "removed" && (
              <div className="mt-0.5 text-2xs font-semibold text-soft-orange" title={m.removal.note}>
                {m.removal.stage === "verbal" ? "Verbal project warning" : "Written project warning"} · {relativeTime(m.removal.updatedAt)}
                {m.removal.updatedAt ? ` · improve by ${formatDate(new Date(Date.parse(m.removal.updatedAt) + warningDays * DAY).toISOString(), "short")}` : ""}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1">
          <RoleChips roles={m.roles} />
          {direct ? <RoleEditor member={m} initiative={initiative} /> : null}
        </div>
        {m.roles.includes("specialist") && direct && m.weightOverride == null ? (
          <div className="mt-1">
            <SpecialistSelect value={m.specialistWeight ?? ROLE_META.specialist.weight} onChange={(v) => updateMember(m.id, { specialistWeight: v })} />
          </div>
        ) : null}
      </td>
      <td className="sg-num px-2 py-2 text-right text-xs text-sg-muted">{std.toFixed(2)}</td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5">
          <span className={cn("sg-num font-semibold", m.weightOverride != null ? "text-soft-yellow" : "text-sg-white")} title={m.weightOverride != null ? `Agreed non-standard weight — standard ${std.toFixed(2)}${m.weightNote ? `\nReason: ${m.weightNote}` : ""}` : "Standard weights add up across roles (§6.3)"}>
            {weight.toFixed(2)}
          </span>
          {direct ? (
            <button type="button" onClick={onOverride} title="Agree a non-standard weight (§6.7)" className="rounded p-0.5 text-sg-dim hover:bg-sg-card-2 hover:text-sg-white">
              <Scale className="size-3.5" />
            </button>
          ) : null}
        </div>
        {m.weightOverride != null && m.weightNote ? (
          <div className="max-w-[160px] truncate text-2xs text-sg-dim" title={m.weightNote}>
            {m.weightNote}
          </div>
        ) : null}
      </td>
      <td className="px-2 py-2">
        {direct ? <AllocationSelect value={a} max={maxA} onChange={(v) => updateMember(m.id, { allocationFactor: v })} /> : <span className="sg-num text-xs text-sg-white">{a.toFixed(2)}</span>}
        {a > maxA + 1e-9 ? <div className="text-2xs font-semibold text-soft-red">max {maxA} (§3.1)</div> : null}
      </td>
      <td className="sg-num px-2 py-2 text-right text-xs font-semibold text-sg-white">{declined ? "—" : eff.toFixed(2)}</td>
      <td className="sg-num px-2 py-2 text-right text-xs font-semibold text-sg-white">{declined ? "—" : <Pct value={sharePct} />}</td>
      <td className="px-2 py-2 text-right text-xs">{declined ? <span className="text-sg-dim">—</span> : <Money value={bonus} className="font-semibold text-sg-white" />}</td>
      <td className="px-2 py-2">
        {direct ? (
          <label className="flex cursor-pointer items-center gap-1.5 text-2xs text-sg-muted" title="Line manager's written agreement to the time (§3.1, §7.1)">
            <input type="checkbox" checked={m.managerApproved} onChange={(e) => updateMember(m.id, { managerApproved: e.target.checked })} className="size-3.5 accent-sg-white" />
            {m.managerApproved ? "Agreed" : "Pending"}
          </label>
        ) : m.managerApproved ? (
          <span className="text-2xs font-semibold text-soft-green">Agreed</span>
        ) : (
          <span className="text-2xs font-semibold text-soft-orange">Missing</span>
        )}
      </td>
      <td className="px-2 py-2">
        {direct ? (
          <Menu>
            <MenuTrigger asChild>
              <button type="button" className="inline-flex items-center gap-1" title="Signature on the Role and Weight Agreement (Annex D)">
                <ConsentChip consent={m.consent} />
                <ChevronDown className="size-3 text-sg-dim" />
              </button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Role and Weight Agreement · Annex D</MenuLabel>
              <MenuItem active={m.consent === "accepted"} onSelect={() => (setConsent(m.id, "accepted"), notify(`${u?.name ?? "Member"} signed the agreement`))}>
                <UserCheck className="size-3.5 text-soft-green" /> Signed
              </MenuItem>
              <MenuItem active={m.consent === "pending"} onSelect={() => setConsent(m.id, "pending")}>
                <CircleAlert className="size-3.5 text-soft-yellow" /> Not yet signed
              </MenuItem>
              {!isProposer ? (
                <MenuItem active={m.consent === "declined"} onSelect={() => (setConsent(m.id, "declined"), notify(`${u?.name ?? "Member"} declined`))}>
                  <X className="size-3.5 text-soft-red" /> Declined
                </MenuItem>
              ) : null}
            </MenuContent>
          </Menu>
        ) : (
          <span className="flex flex-col gap-0.5">
            <ConsentChip consent={m.consent} />
            {m.prcApproved ? (
              <span className="inline-flex items-center gap-1 text-2xs font-semibold text-soft-green" title="Checked by the PRC (§6.7)">
                <BadgeCheck className="size-3" /> PRC checked
              </span>
            ) : (
              <span className="text-2xs text-sg-dim">PRC check pending</span>
            )}
          </span>
        )}
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-col gap-1">
          <EligibilityBadge userId={m.userId} />
          {leadership ? <CapacityMeter userId={m.userId} /> : null}
          {holdsNonLead && nonLead >= POLICY.maxConcurrentNonLeadRoles ? (
            <span className="text-2xs font-semibold text-soft-yellow" title="More than 3 concurrent non-lead roles need line manager and PRC approval (§7.1)">
              {nonLead + 1} non-lead roles
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-2 text-right">
        {direct ? (
          !isProposer ? (
            <Button
              size="icon-sm"
              variant="ghost"
              title="Remove from the agreement"
              onClick={() => {
                removeMember(m.id);
                notify(`${u?.name ?? "Member"} removed from the Role and Weight Agreement`);
              }}
            >
              <Trash2 />
            </Button>
          ) : (
            <span className="text-2xs text-sg-dim" title="The proposer stays on the agreement; delegate the Project Lead role by moving it to another member (§4.9)">
              <Lock className="inline size-3" />
            </span>
          )
        ) : (
          <div className="flex justify-end gap-1">
            <Button size="xs" variant="ghost" title="Propose an amendment to this member's roles, weight or allocation (§6.8)" onClick={onAmend}>
              <Pencil /> Amend
            </Button>
            <Button size="xs" variant="ghost" title="Removal for poor performance (§7.5)" onClick={onRemoval}>
              <UserMinus /> {m.removal.stage === "none" ? "Remove…" : m.removal.stage === "verbal" ? "Step 2" : "Step 3"}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

function ConsentChip({ consent }: { consent: InitiativeMember["consent"] }) {
  if (consent === "accepted") return <Chip color="green">Signed</Chip>;
  if (consent === "declined") return <Chip color="red">Declined</Chip>;
  return <Chip color="yellow">To sign</Chip>;
}

/* ───────────────────────── role editor (agreement stage) ───────────────────────── */

function RoleEditor({ member, initiative }: { member: InitiativeMember; initiative: Initiative }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const updateMember = useCrm((s) => s.updateMember);
  const removeMember = useCrm((s) => s.removeMember);
  const userMap = useUserMap();
  const [swap, setSwap] = useState<ProjectRole[] | null>(null);
  const currentLead = openLeads(members, initiative.id, member.id)[0];
  const company = initiative.origination === "company";

  const apply = (next: ProjectRole[]) => {
    setError(null);
    const keepInitiator = member.roles.includes("initiator") && !company;
    const roles = [...(keepInitiator ? (["initiator"] as ProjectRole[]) : []), ...next.filter((r) => r !== "initiator")];
    if (!roles.length) return setError("A member needs at least one role.");
    const addsLeadership = roles.some((r) => ROLE_META[r].leadership) && !member.roles.some((r) => ROLE_META[r].leadership);
    if (addsLeadership) {
      const cap = capacityCheck(member.userId, initiative, roles, initiatives, members);
      if (!cap.ok) return setError(`Blocked: leadership capacity would reach ${cap.after.toFixed(2)} / ${POLICY.leadershipCapacity.toFixed(1)} (§7.3).`);
    }
    // one Project Lead per project — moving the role takes it from the current holder (§4.9 delegation; the Initiator keeps 0.5, §6.3)
    if (roles.includes("project_lead") && !member.roles.includes("project_lead") && currentLead) {
      const rest = currentLead.roles.filter((r) => r !== "project_lead");
      if (!rest.length) {
        // never two Project Leads (§6.1): the old lead holds only that role, so their row ends — ask first
        setSwap(roles);
        return;
      }
      updateMember(currentLead.id, { roles: rest });
    }
    updateMember(member.id, { roles, specialistWeight: roles.includes("specialist") ? member.specialistWeight ?? ROLE_META.specialist.weight : null });
  };
  const confirmSwap = () => {
    if (!swap || !currentLead) return;
    removeMember(currentLead.id);
    updateMember(member.id, { roles: swap, specialistWeight: swap.includes("specialist") ? member.specialistWeight ?? ROLE_META.specialist.weight : null });
    setSwap(null);
  };

  return (
    <Popover open={open} onOpenChange={(v) => (setOpen(v), setError(null), setSwap(null))}>
      <PopoverTrigger asChild>
        <button type="button" title="Edit roles" className="rounded p-0.5 text-sg-dim hover:bg-sg-card-2 hover:text-sg-white">
          <Pencil className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px]">
        <div className="sg-eyebrow mb-2">
          Roles — weights add up
          <Cite s="6.3" />
        </div>
        {member.roles.includes("initiator") && (
          <div className="mb-2 flex items-center gap-1.5 text-2xs text-sg-dim">
            <Lock className="size-3" /> Project Initiator (0.5) follows the origination (§4.1) and can&apos;t be toggled here.
          </div>
        )}
        <RoleToggles value={member.roles.filter((r) => r !== "initiator")} onChange={apply} roles={ASSIGNABLE_ROLES} />
        {currentLead && !member.roles.includes("project_lead") && <p className="mt-2 text-2xs text-sg-dim">Choosing Project Lead delegates it from {userMap.get(currentLead.userId)?.name} (§4.9).</p>}
        {error && <p className="mt-2 text-2xs font-semibold text-soft-red">{error}</p>}
        {swap && currentLead ? (
          <div className="mt-2 rounded-md border border-soft-orange/40 bg-soft-orange/10 p-2 text-2xs text-soft-orange">
            {userMap.get(currentLead.userId)?.name ?? "The current lead"} holds only the Project Lead role. Making {userMap.get(member.userId)?.name ?? "this member"} Project Lead removes them from the agreement — a project has one Project Lead (§6.1, §4.9).
            <div className="mt-1.5 flex gap-1.5">
              <Button size="xs" variant="primary" onClick={confirmSwap}>
                Move Project Lead
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setSwap(null)}>
                Keep current lead
              </Button>
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/* ───────────────────────── add member (agreement stage / ledger setup) ───────────────────────── */

function AddMemberPanel({ initiative, current, setup }: { initiative: Initiative; current: InitiativeMember[]; setup: boolean }) {
  const users = useCrm((s) => s.users);
  const profiles = useCrm((s) => s.employeeProfiles);
  const addMember = useCrm((s) => s.addMember);
  const updateMember = useCrm((s) => s.updateMember);
  const removeMember = useCrm((s) => s.removeMember);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [roles, setRoles] = useState<ProjectRole[]>(["engineer"]);
  const [specialistWeight, setSpecialistWeight] = useState(ROLE_META.specialist.weight);
  const [allocationFactor, setAllocationFactor] = useState(1);
  // attestations are never pre-ticked — each is an explicit statement recorded on the agreement (§3.1, §6.7)
  const [manager, setManager] = useState(false);
  const [signed, setSigned] = useState(false);
  const [ack, setAck] = useState(false);
  const [leadSwap, setLeadSwap] = useState(false);
  const maxA = maxAllocationFactor(profiles.find((p) => p.userId === userId));
  useEffect(() => {
    if (allocationFactor > maxA) setAllocationFactor(maxA);
  }, [maxA, allocationFactor]);
  const check = useCandidateCheck(userId, roles, allocationFactor, initiative);

  const available = useMemo(() => users.filter((u) => !current.some((m) => m.userId === u.id && m.consent !== "declined")), [users, current]);
  const lead = current.find((m) => m.roles.includes("project_lead"));
  const leadOnlyLead = !!lead && roles.includes("project_lead") && lead.roles.every((r) => r === "project_lead");
  const ok = canProceed(check, ack) && roles.length > 0 && (!leadOnlyLead || leadSwap);

  const reset = () => {
    setUserId("");
    setRoles(["engineer"]);
    setAllocationFactor(1);
    setManager(false);
    setSigned(false);
    setAck(false);
    setLeadSwap(false);
  };

  const submit = () => {
    if (!ok) return;
    if (roles.includes("project_lead") && lead) {
      const rest = lead.roles.filter((r) => r !== "project_lead");
      // one Project Lead per project (§6.1): strip the role, or end the old lead's row when it was their only role
      if (rest.length) updateMember(lead.id, { roles: rest });
      else removeMember(lead.id);
    }
    addMember(initiative.id, userId, roles, {
      specialistWeight: roles.includes("specialist") ? specialistWeight : null,
      allocationFactor,
      managerApproved: manager,
      consent: signed ? "accepted" : "pending",
      joinedAt: setup ? initiative.startDate : undefined,
      authority: setup ? "Ledger built from existing team records (§15.1)" : "Role and Weight Agreement (Annex D Part 1)",
    });
    notify(`${userMap.get(userId)?.name ?? "Member"} added${signed ? "" : " — awaiting signature"}${manager ? "" : " · line manager agreement pending"}`);
    reset();
  };

  if (!open)
    return (
      <div className="border-t border-sg-line px-4 py-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          <Plus /> Add team member
        </Button>
      </div>
    );

  return (
    <div className="space-y-3 border-t border-sg-line bg-sg-bg/30 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="sg-eyebrow">
          Add to the {setup ? "Team Allocation Ledger" : "Role and Weight Agreement"}
          <Cite s={setup ? "15.1" : "6.7"} />
        </span>
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => (setOpen(false), reset())}>
          <X />
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-[240px_minmax(0,1fr)_100px]">
        <div>
          <Label>Employee</Label>
          <PersonCombobox value={userId} onChange={(v) => (setUserId(v), setAck(false), setSigned(false), setManager(false))} users={available} ariaLabel="Employee" />
        </div>
        <div>
          <Label>Role(s)</Label>
          <RoleToggles value={roles} onChange={setRoles} roles={ASSIGNABLE_ROLES} />
          {roles.includes("specialist") && (
            <div className="mt-1.5 flex items-center gap-2 text-2xs text-sg-dim">
              Specialist weight
              <SpecialistSelect value={specialistWeight} onChange={setSpecialistWeight} />
              <Cite s="6.2" />
            </div>
          )}
          {roles.includes("project_lead") && lead ? (
            leadOnlyLead ? (
              <label className="mt-1 flex cursor-pointer items-start gap-1.5 text-2xs text-soft-orange">
                <input type="checkbox" checked={leadSwap} onChange={(e) => setLeadSwap(e.target.checked)} className="mt-0.5 size-3.5 accent-sg-white" />
                {userMap.get(lead.userId)?.name} holds only the Project Lead role — their row ends so the project keeps one Project Lead (§6.1)
              </label>
            ) : (
              <p className="mt-1 text-2xs text-sg-dim">Takes over Project Lead from {userMap.get(lead.userId)?.name}.</p>
            )
          ) : null}
        </div>
        <div>
          <Label>Allocation A</Label>
          <AllocationSelect value={allocationFactor} max={maxA} onChange={setAllocationFactor} />
          <p className="mt-0.5 text-2xs text-sg-dim">default 1.0</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-sg-text">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={manager} onChange={(e) => setManager(e.target.checked)} className="size-3.5 accent-sg-white" />
          Line manager agreed the time<Cite s="3.1" />
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} className="size-3.5 accent-sg-white" />
          Signed the Role and Weight Agreement<Cite s="6.7" />
        </label>
        {userId ? (
          <span className="flex items-center gap-3 text-2xs text-sg-dim">
            <EligibilityBadge userId={userId} />
            {check?.leadership && <CapacityMeter userId={userId} adding={check.capacity.adds} />}
            <span>
              Non-lead roles elsewhere: <span className="sg-num font-semibold text-sg-muted">{check?.nonLead ?? 0}</span> / {POLICY.maxConcurrentNonLeadRoles}
            </span>
          </span>
        ) : null}
      </div>
      <CandidateNotices check={check} ack={ack} onAck={setAck} />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={!ok} onClick={submit}>
          <UserPlus /> Add to team
        </Button>
        {!roles.length && <span className="text-2xs text-soft-red">Pick at least one role.</span>}
        <span className="text-2xs text-sg-dim">Weight {memberWeight({ roles, specialistWeight: roles.includes("specialist") ? specialistWeight : null, weightOverride: null }).toFixed(2)} × A {allocationFactor.toFixed(2)} = {(memberWeight({ roles, specialistWeight: roles.includes("specialist") ? specialistWeight : null, weightOverride: null }) * allocationFactor).toFixed(2)}</span>
      </div>
    </div>
  );
}

/* ───────────────────────── §6.8 amendments ───────────────────────── */

interface AmendDraft {
  kind: "add" | "remove" | "change";
  userId: string;
  memberId: string;
  roles: ProjectRole[];
  specialistWeight: number;
  override: string;
  allocationFactor: number;
  consent: boolean;
  manager: boolean;
  effective: string;
  reason: string;
}

function describeChange(a: TeamAmendment, members: InitiativeMember[], name: (id: string) => string) {
  const c = a.change;
  const roles = (r: ProjectRole[]) => r.map((x) => ROLE_META[x].label).join(" + ");
  const w = (r: ProjectRole[], sw: number | null, o: number | null) => memberWeight({ roles: r, specialistWeight: sw, weightOverride: o }).toFixed(2);
  if (c.kind === "add") return `Add ${name(c.userId)} as ${roles(c.roles)} · W ${w(c.roles, c.specialistWeight, c.weightOverride)} × A ${c.allocationFactor.toFixed(2)}`;
  const m = members.find((x) => x.id === c.memberId);
  if (c.kind === "remove") return `Remove ${m ? name(m.userId) : "member"}${m ? ` (${roles(m.roles)})` : ""} from the team`;
  return `Change ${m ? name(m.userId) : "member"} to ${roles(c.roles)} · W ${w(c.roles, c.specialistWeight, c.weightOverride)} × A ${c.allocationFactor.toFixed(2)}${m ? ` (was ${roles(m.roles)} · W ${memberWeight(m).toFixed(2)} × A ${(m.allocationFactor ?? 1).toFixed(2)})` : ""}`;
}

const AMEND_STATUS: Record<TeamAmendment["status"], { label: string; color: "yellow" | "green" | "red" | "orange" | "magenta" }> = {
  open: { label: "Voting", color: "yellow" },
  passed: { label: "Passed", color: "green" },
  failed: { label: "Failed", color: "red" },
  tied: { label: "Tied — PRC decides", color: "orange" },
  blocked: { label: "Blocked by PRC", color: "magenta" },
};

function AmendmentsCard({ initiative, amendments, onPropose, canPropose }: { initiative: Initiative; amendments: TeamAmendment[]; onPropose: () => void; canPropose: boolean }) {
  return (
    <section className="rounded-xl border border-sg-line bg-sg-card">
      <header className="flex flex-wrap items-center gap-2 border-b border-sg-line px-4 py-2.5">
        <ClipboardList className="size-4 text-sg-muted" />
        <h3 className="font-display text-sm font-extrabold text-sg-white">Amendments to roles and weights</h3>
        <Cite s="6.8" />
        <Cite s="Annex D" />
        <span className="text-2xs text-sg-dim">Passes with more than half of all current members voting for it within {POLICY.sla.amendmentVoteBusinessDays} business days; exactly half → the PRC decides. Applies from its effective date, never to past work.</span>
        {canPropose ? (
          <Button size="sm" variant="outline" className="ml-auto" onClick={onPropose}>
            <Plus /> Propose amendment
          </Button>
        ) : null}
      </header>
      {amendments.length === 0 ? (
        <p className="px-4 py-5 text-center text-xs text-sg-dim">No amendments yet. Use one to add or remove a member, change a role, weight or allocation factor, or delegate the Project Lead role.</p>
      ) : (
        <ul className="divide-y divide-sg-line">
          {amendments.map((a) => (
            <AmendmentItem key={a.id} a={a} initiative={initiative} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AmendmentItem({ a, initiative }: { a: TeamAmendment; initiative: Initiative }) {
  const members = useCrm((s) => s.initiativeMembers);
  const initiatives = useCrm((s) => s.initiatives);
  const profiles = useCrm((s) => s.employeeProfiles);
  const currentUserId = useCrm((s) => s.currentUserId);
  const recordAmendmentVote = useCrm((s) => s.recordAmendmentVote);
  const prcDecideAmendment = useCrm((s) => s.prcDecideAmendment);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const [note, setNote] = useState("");
  const [proxyFor, setProxyFor] = useState<string | null>(null);
  const [evidence, setEvidence] = useState("");
  const [expanded, setExpanded] = useState(a.status === "open" || a.status === "tied");
  const name = (id: string) => userMap.get(id)?.name ?? id;
  const live = a.status === "open" || a.status === "tied";
  const joining = a.change.kind === "add" ? a.change.userId : undefined;
  // closed amendments show the votes as cast; open ones show the current team
  const voters = useMemo(() => (live ? currentVoters(members, initiative.id, joining) : [...new Set(a.votes.map((v) => v.userId))]), [live, members, initiative.id, joining, a.votes]);
  const vote = (u: string) => a.votes.find((v) => v.userId === u)?.vote;
  const yes = voters.filter((u) => vote(u) === "for").length;
  const no = voters.filter((u) => vote(u) === "against").length;
  const n = voters.length;
  const need = Math.floor(n / 2) + 1;
  const issues = useMemo(() => amendmentIssues(a, initiative, { initiatives, members, profiles }), [a, initiative, initiatives, members, profiles]);
  const voteDue = addBusinessDays(a.circulatedAt, POLICY.sla.amendmentVoteBusinessDays);
  const st = AMEND_STATUS[a.status];

  const castVote = (u: string, v: "for" | "against") => {
    if (u !== currentUserId && evidence.trim().length < 5) return;
    recordAmendmentVote(a.id, u, v, u === currentUserId ? "" : evidence);
    notify(u === currentUserId ? `You voted ${v}` : `${name(u)}'s vote (${v}) recorded from their signed form`);
    setProxyFor(null);
    setEvidence("");
  };
  const decide = (outcome: "passed" | "failed" | "blocked") => {
    if (!prcCanDecide(a)) return;
    if (outcome === "blocked" && (!issues.length || note.trim().length < 5)) return;
    prcDecideAmendment(a.id, outcome, note.trim() || (outcome === "passed" ? "PRC deciding vote for" : "PRC deciding vote against"));
    setNote("");
    notify(outcome === "blocked" ? "Amendment blocked by the PRC — breaks the policy" : outcome === "passed" ? "PRC passed the amendment — ledger updated" : "PRC rejected the amendment");
  };

  return (
    <li className="px-4 py-3">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full flex-wrap items-center gap-2 text-left">
        {expanded ? <ChevronDown className="size-3.5 text-sg-dim" /> : <ChevronRight className="size-3.5 text-sg-dim" />}
        <Chip color={st.color} dot>
          {st.label}
        </Chip>
        <span className="min-w-0 flex-1 text-sm font-semibold text-sg-white">{describeChange(a, members, name)}</span>
        <span className="sg-num text-2xs text-sg-muted">
          for {yes} · against {no} · not voted {Math.max(0, n - yes - no)} of {n}
        </span>
        <span className="text-2xs text-sg-dim">effective {formatDate(a.effectiveDate, "medium")}</span>
      </button>
      {expanded ? (
        <div className="mt-2 space-y-3 pl-5">
          <div className="grid gap-x-6 gap-y-1 text-2xs text-sg-muted sm:grid-cols-2">
            <span>
              Proposed by <span className="text-sg-text">{name(a.proposedById)}</span> · circulated {formatDate(a.circulatedAt, "datetime")}
            </span>
            <span>
              Reason: <span className="text-sg-text">{a.reason}</span>
            </span>
            {a.change.kind === "add" ? (
              <span>
                New member&apos;s consent: {a.change.consent ? <span className="text-soft-green">given</span> : <span className="text-soft-red">missing</span>} · joining member does not vote on their own admission
              </span>
            ) : null}
            {live ? (
              <span>
                Vote closes {formatDate(voteDue, "medium")} · needs {need} of {n} for
              </span>
            ) : null}
          </div>

          {/* votes */}
          <table className="w-full max-w-[560px] text-xs">
            <thead>
              <tr className="text-left">
                <th className="sg-eyebrow py-1 font-semibold">Current member</th>
                <th className="sg-eyebrow py-1 font-semibold">Vote</th>
                <th className="sg-eyebrow py-1 text-right font-semibold">{live ? "Record vote" : "Date"}</th>
              </tr>
            </thead>
            <tbody>
              {voters.map((u) => {
                const v = a.votes.find((x) => x.userId === u);
                return (
                  <tr key={u} className="border-t border-sg-line/60">
                    <td className="py-1.5">
                      <span className="flex items-center gap-1.5">
                        <Avatar user={userMap.get(u)} size="xs" /> {name(u)}
                        {u === currentUserId ? <span className="text-2xs text-sg-dim">(you)</span> : null}
                      </span>
                    </td>
                    <td className="py-1.5">
                      {v ? <Chip color={v.vote === "for" ? "green" : "red"}>{v.vote === "for" ? "For" : "Against"}</Chip> : <span className="text-2xs text-sg-dim">Not voted</span>}
                      {v?.recordedById && v.recordedById !== u ? (
                        <div className="text-2xs text-sg-dim" title={v.evidence}>
                          recorded by {name(v.recordedById)}
                          {v.evidence ? ` · ${v.evidence}` : ""}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-1.5 text-right">
                      {a.status === "open" ? (
                        u === currentUserId ? (
                          <span className="inline-flex gap-1">
                            <Button size="xs" variant={v?.vote === "for" ? "primary" : "outline"} onClick={() => castVote(u, "for")}>
                              For
                            </Button>
                            <Button size="xs" variant={v?.vote === "against" ? "danger" : "outline"} onClick={() => castVote(u, "against")}>
                              Against
                            </Button>
                          </span>
                        ) : proxyFor === u ? (
                          <span className="inline-flex flex-wrap items-center justify-end gap-1">
                            <Input autoFocus value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Signed form ref / email (required)" aria-label={`Evidence for ${name(u)}'s vote`} className="h-6 w-48 text-2xs" />
                            <Button size="xs" variant="outline" disabled={evidence.trim().length < 5} onClick={() => castVote(u, "for")}>
                              For
                            </Button>
                            <Button size="xs" variant="outline" disabled={evidence.trim().length < 5} onClick={() => castVote(u, "against")}>
                              Against
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => (setProxyFor(null), setEvidence(""))}>
                              Cancel
                            </Button>
                          </span>
                        ) : (
                          <Button size="xs" variant="ghost" title="Record this member's vote from their signed amendment form (Annex D Part 2) — you are recorded as the person who entered it" onClick={() => (setProxyFor(u), setEvidence(""))}>
                            Record from signed form…
                          </Button>
                        )
                      ) : (
                        <span className="text-2xs text-sg-dim">{v ? formatDate(v.at, "short") : "—"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!voters.length ? (
                <tr>
                  <td colSpan={3} className="py-2 text-2xs text-sg-dim">
                    No current members on the ledger to vote — the PRC decides.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {a.status === "open" ? <p className="text-2xs text-sg-dim">Members vote for themselves; a vote entered for someone else needs their signed amendment form (Annex D Part 2) as evidence and records who entered it. One vote each, regardless of weight.</p> : null}

          {/* PRC */}
          {issues.length ? (
            <div className="rounded-md border border-soft-red/40 bg-soft-red/10 p-2 text-2xs text-soft-red">
              <div className="mb-0.5 flex items-center gap-1.5 font-semibold">
                <Ban className="size-3" /> Policy issues — grounds for a PRC block
              </div>
              <ul className="list-disc pl-4">
                {issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          ) : live ? (
            <p className="flex items-center gap-1.5 text-2xs text-soft-green">
              <ShieldCheck className="size-3.5" /> Complies with the policy — eligibility, leadership capacity and allocation limits; the PRC may not block it.
            </p>
          ) : null}
          {live ? (
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-sg-line p-2">
              <div className="min-w-[220px] flex-1">
                <Label>PRC note{a.status === "tied" ? " (deciding vote)" : " (required to block)"}</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={a.status === "tied" ? "Reason for the deciding vote" : "Which rule the amendment breaks"} className="h-7 text-xs" />
              </div>
              {a.status === "tied" ? (
                <>
                  <Button size="sm" variant="primary" onClick={() => decide("passed")}>
                    <Gavel /> PRC: pass
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => decide("failed")}>
                    PRC: reject
                  </Button>
                </>
              ) : null}
              <Button size="sm" variant="danger" disabled={!issues.length || note.trim().length < 5} title={issues.length ? "Block — the amendment breaks the policy" : "The PRC may block only an amendment that breaks the policy (§6.8)"} onClick={() => decide("blocked")}>
                <Ban /> Block
              </Button>
            </div>
          ) : null}
          {a.prcDecision ? (
            <p className="text-2xs text-sg-muted">
              PRC {a.prcDecision.outcome} · {name(a.prcDecision.byId)} · {formatDate(a.prcDecision.at, "medium")} — “{a.prcDecision.note}”
            </p>
          ) : null}
          {a.recordedAt ? (
            <p className="flex items-center gap-1.5 text-2xs text-soft-green">
              <Check className="size-3" /> Recorded in the Team Allocation Ledger {formatDate(a.recordedAt, "datetime")}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function AmendmentModal({ initiative, current, preset, onClose }: { initiative: Initiative; current: InitiativeMember[]; preset?: Partial<AmendDraft>; onClose: () => void }) {
  const users = useCrm((s) => s.users);
  const members = useCrm((s) => s.initiativeMembers);
  const profiles = useCrm((s) => s.employeeProfiles);
  const initiatives = useCrm((s) => s.initiatives);
  const proposeAmendment = useCrm((s) => s.proposeAmendment);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const live = useMemo(() => current.filter((m) => m.consent !== "declined"), [current]);
  const candidates = useMemo(() => users.filter((u) => !live.some((m) => m.userId === u.id)), [users, live]);
  const fromMember = (memberId: string): Partial<AmendDraft> => {
    const m = members.find((x) => x.id === memberId);
    return m ? { memberId, roles: m.roles.filter((r) => r !== "initiator" || initiative.origination !== "company"), specialistWeight: m.specialistWeight ?? ROLE_META.specialist.weight, override: m.weightOverride != null ? String(m.weightOverride) : "", allocationFactor: m.allocationFactor ?? 1 } : { memberId };
  };
  const [d, setD] = useState<AmendDraft>(() => ({
    kind: "add",
    userId: "",
    memberId: "",
    roles: ["engineer"],
    specialistWeight: ROLE_META.specialist.weight,
    override: "",
    allocationFactor: 1,
    consent: false,
    manager: false,
    effective: todayInput(),
    reason: "",
    ...preset,
    ...(preset?.kind === "change" && preset.memberId ? fromMember(preset.memberId) : {}),
  }));
  const set = (p: Partial<AmendDraft>) => setD((x) => ({ ...x, ...p }));
  const subjectUser = d.kind === "add" ? d.userId : members.find((m) => m.id === d.memberId)?.userId ?? "";
  const override = d.override.trim() ? Number(d.override) : null;
  const ovr = overrideRule({ value: override, standard: memberWeight({ roles: d.roles, specialistWeight: d.roles.includes("specialist") ? d.specialistWeight : null, weightOverride: null }), reason: d.reason, allSigned: false, viaAmendment: true });
  const change: TeamAmendment["change"] | null =
    d.kind === "add"
      ? d.userId
        ? { kind: "add", userId: d.userId, roles: d.roles, specialistWeight: d.roles.includes("specialist") ? d.specialistWeight : null, weightOverride: override, allocationFactor: d.allocationFactor, consent: d.consent, managerApproved: d.manager, weightNote: override != null ? d.reason.trim() : "" }
        : null
      : d.kind === "remove"
        ? d.memberId
          ? { kind: "remove", memberId: d.memberId }
          : null
        : d.memberId
          ? { kind: "change", memberId: d.memberId, roles: d.roles, specialistWeight: d.roles.includes("specialist") ? d.specialistWeight : null, weightOverride: override, allocationFactor: d.allocationFactor }
          : null;
  const effectiveIso = d.effective ? startOfDay(d.effective) : "";
  const issues = useMemo(() => (change && effectiveIso ? amendmentIssues({ change, effectiveDate: effectiveIso }, initiative, { initiatives, members, profiles }) : []), [change, effectiveIso, initiative, initiatives, members, profiles]);
  const maxA = maxAllocationFactor(profiles.find((p) => p.userId === subjectUser));
  const past = !!d.effective && d.effective < todayInput();
  const errors: string[] = [];
  if (!change) errors.push(d.kind === "add" ? "Choose who joins" : "Choose the member");
  if (d.kind !== "remove" && !d.roles.length) errors.push("Pick at least one role");
  errors.push(...ovr.errors);
  if (d.kind === "add" && d.userId && !d.manager) errors.push("Record the line manager's agreement to the joining member's time (§3.1)");
  if (d.kind === "add" && !d.consent) errors.push("The joining member must consent to their role, weight and allocation factor");
  if (!d.effective) errors.push("Set the effective date");
  if (past) errors.push("Amendments apply from their effective date forward — never to past work (§6.8 step 6)");
  if (d.reason.trim().length < 5) errors.push("State the reason");
  const voters = currentVoters(members, initiative.id, d.kind === "add" ? d.userId : undefined);

  const submit = () => {
    if (errors.length || !change) return;
    const id = proposeAmendment(initiative.id, change, effectiveIso, d.reason.trim());
    const status = useCrm.getState().teamAmendments.find((a) => a.id === id)?.status;
    notify(status === "passed" ? "Amendment passed — Team Allocation Ledger updated" : status === "tied" ? "Amendment circulated — no voting members, the PRC decides" : `Amendment circulated to ${voters.length} member${voters.length === 1 ? "" : "s"} — vote within ${POLICY.sla.amendmentVoteBusinessDays} business days`);
    onClose();
  };

  return (
    <Modal
      open
      onOpenChange={(v) => !v && onClose()}
      title="Propose an amendment"
      description="Annex D Part 2 — circulated in writing to the whole team (§6.8)"
      className="max-w-2xl"
      footer={
        <>
          <span className="mr-auto text-2xs text-sg-dim">{voters.length} current member{voters.length === 1 ? "" : "s"} vote · passes with {Math.floor(voters.length / 2) + 1}</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={errors.length > 0} onClick={submit} title={errors.join("\n")}>
            <Send /> Circulate to the team
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex rounded border border-sg-line p-0.5" role="radiogroup" aria-label="Change">
          {(
            [
              ["add", "Add a member"],
              ["change", "Change role / weight / allocation"],
              ["remove", "Remove a member"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={d.kind === k} onClick={() => set({ kind: k, ...(k === "add" ? { roles: ["engineer"] as ProjectRole[], override: "", allocationFactor: 1 } : {}) })} className={cn("h-7 flex-1 rounded-sm px-2 text-xs font-semibold", d.kind === k ? "bg-sg-card-3 text-sg-white" : "text-sg-dim hover:text-sg-white")}>
              {l}
            </button>
          ))}
        </div>

        {d.kind === "add" ? (
          <div>
            <Label>Joining member</Label>
            <PersonCombobox value={d.userId} onChange={(v) => set({ userId: v, consent: false, manager: false })} users={candidates} ariaLabel="Joining member" />
          </div>
        ) : (
          <div>
            <Label>Member</Label>
            <Select value={d.memberId} onChange={(e) => set(d.kind === "change" ? fromMember(e.target.value) : { memberId: e.target.value })}>
              <option value="">Choose…</option>
              {live.map((m) => (
                <option key={m.id} value={m.id}>
                  {userMap.get(m.userId)?.name ?? m.userId} — {m.roles.map((r) => ROLE_META[r].label).join(" + ")} · W {memberWeight(m).toFixed(2)} × A {(m.allocationFactor ?? 1).toFixed(2)}
                </option>
              ))}
            </Select>
          </div>
        )}

        {d.kind !== "remove" ? (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px_110px]">
            <div>
              <Label>Role(s)</Label>
              <RoleToggles value={d.roles.filter((r) => r !== "initiator")} onChange={(v) => set({ roles: [...(d.roles.includes("initiator") ? (["initiator"] as ProjectRole[]) : []), ...v] })} roles={ASSIGNABLE_ROLES} />
              {d.roles.includes("specialist") ? (
                <div className="mt-1.5">
                  <SpecialistSelect value={d.specialistWeight} onChange={(v) => set({ specialistWeight: v })} />
                </div>
              ) : null}
              {d.roles.includes("initiator") ? <p className="mt-1 text-2xs text-sg-dim">Keeps the Initiator weight 0.5 (§6.3).</p> : null}
            </div>
            <div>
              <Label>Allocation A</Label>
              <AllocationSelect value={d.allocationFactor} max={maxA} onChange={(v) => set({ allocationFactor: v })} />
            </div>
            <div>
              <Label>Agreed W (optional)</Label>
              <Input inputMode="decimal" value={d.override} placeholder={memberWeight({ roles: d.roles, specialistWeight: d.specialistWeight, weightOverride: null }).toFixed(2)} onChange={(e) => set({ override: e.target.value.replace(/[^\d.]/g, "") })} className="sg-num h-8" />
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
          <div>
            <Label>Effective date</Label>
            <Input type="date" min={todayInput()} value={d.effective} onChange={(e) => set({ effective: e.target.value })} />
          </div>
          <div>
            <Label>Reason</Label>
            <Textarea value={d.reason} onChange={(e) => set({ reason: e.target.value })} placeholder={d.kind === "remove" ? "e.g. Moves to another project at the end of the design phase" : "Why the change reflects actual responsibilities"} className="min-h-[56px]" />
          </div>
        </div>

        {d.kind === "add" && d.userId ? (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-sg-text">
            <input type="checkbox" checked={d.consent} onChange={(e) => set({ consent: e.target.checked })} className="size-3.5 accent-sg-white" />
            {userMap.get(d.userId)?.name} consents to the role, weight and allocation factor (does not vote on their own admission)
          </label>
        ) : null}
        {d.kind === "add" && d.userId ? (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-sg-text">
            <input type="checkbox" checked={d.manager} onChange={(e) => set({ manager: e.target.checked })} className="size-3.5 accent-sg-white" />
            Their line manager agreed the time in writing<Cite s="3.1" />
          </label>
        ) : null}

        {issues.length ? (
          <div className="rounded-lg border border-soft-red/40 bg-soft-red/10 p-2.5 text-xs text-soft-red">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <TriangleAlert className="size-3.5" /> The PRC may block this amendment
              <Cite s="6.8" />
            </div>
            <ul className="list-disc space-y-0.5 pl-5">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {errors.length && (d.reason || d.userId || d.memberId) ? (
          <ul className="space-y-0.5 text-2xs text-soft-yellow">
            {errors.map((e) => (
              <li key={e}>• {e}</li>
            ))}
          </ul>
        ) : null}
        <p className="text-2xs text-sg-dim">
          A member whose role is removed or weight reduced by an amendment they voted against may appeal to the PRC (§14). Removal for poor performance follows §7.5 instead. Type {initiative.type} lead roles count {PROJECT_TYPE_META[initiative.type].capacityFactor} toward the 2.0 leadership capacity (§7.3).
        </p>
      </div>
    </Modal>
  );
}

/* ───────────────────────── Annex D Part 3 ledger ───────────────────────── */

function LedgerCard({ initiative, rows, defaultOpen }: { initiative: Initiative; rows: InitiativeMember[]; defaultOpen: boolean }) {
  const userMap = useUserMap();
  const [open, setOpen] = useState(defaultOpen);
  const [now] = useState(() => Date.now());
  const sorted = useMemo(
    () => [...rows].filter((m) => m.consent !== "declined").sort((a, b) => (userMap.get(a.userId)?.name ?? a.userId).localeCompare(userMap.get(b.userId)?.name ?? b.userId) || a.joinedAt.localeCompare(b.joinedAt)),
    [rows, userMap],
  );
  const closed = sorted.filter((m) => !isOpenRow(m, now)).length;
  if (!sorted.length) return null;
  return (
    <section className="rounded-xl border border-sg-line bg-sg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-sg-line px-4 py-2.5">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-2 text-left">
          {open ? <ChevronDown className="size-3.5 text-sg-dim" /> : <ChevronRight className="size-3.5 text-sg-dim" />}
          <History className="size-4 text-sg-muted" />
          <span className="font-display text-sm font-extrabold text-sg-white">Team Allocation Ledger</span>
        </button>
        <Cite s="Annex D" />
        <span className="text-2xs text-sg-dim">
          {sorted.length} row{sorted.length === 1 ? "" : "s"} · {closed} closed — one row per member per period of unchanged role, weight and allocation; each amendment closes rows and opens new ones (§6.5)
        </span>
      </div>
      {open ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead>
              <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-[0.1em] text-sg-dim">
                <th className="px-4 py-2 font-semibold">Member</th>
                <th className="px-2 py-2 font-semibold">Role(s)</th>
                <th className="px-2 py-2 text-right font-semibold">Weight W</th>
                <th className="px-2 py-2 text-right font-semibold">Allocation A</th>
                <th className="px-2 py-2 font-semibold">Start on team</th>
                <th className="px-2 py-2 font-semibold">End on team</th>
                <th className="px-2 py-2 font-semibold">Authority</th>
                <th className="px-4 py-2 font-semibold">State</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => {
                const isClosed = !isOpenRow(m, now);
                const future = !hasStarted(m, now) && initiative.status !== "draft";
                return (
                  <tr key={m.id} className={cn("border-b border-sg-line/60 last:border-0", isClosed && "text-sg-dim")}>
                    <td className="px-4 py-1.5">
                      <span className="flex items-center gap-1.5">
                        <Avatar user={userMap.get(m.userId)} size="xs" />
                        <span className={isClosed ? "text-sg-muted" : "text-sg-white"}>{userMap.get(m.userId)?.name ?? m.userId}</span>
                      </span>
                    </td>
                    <td className="px-2 py-1.5">{m.roles.map((r) => ROLE_META[r].label).join(" + ")}</td>
                    <td className="sg-num px-2 py-1.5 text-right">
                      {memberWeight(m).toFixed(2)}
                      {m.weightOverride != null ? <span className="text-soft-yellow" title={m.weightNote || "Agreed non-standard weight"}> *</span> : null}
                    </td>
                    <td className="sg-num px-2 py-1.5 text-right">{(m.allocationFactor ?? 1).toFixed(2)}</td>
                    <td className="sg-num px-2 py-1.5">{formatDate(m.joinedAt, "medium")}</td>
                    <td className="sg-num px-2 py-1.5">{m.leftAt ? formatDate(m.leftAt, "medium") : "—"}</td>
                    <td className="max-w-[240px] truncate px-2 py-1.5" title={m.authority ?? ""}>
                      {m.authority ?? "Role and Weight Agreement"}
                    </td>
                    <td className="px-4 py-1.5">
                      {m.removal.stage === "removed" ? (
                        <Chip color="red">Removed (§7.5)</Chip>
                      ) : isClosed ? (
                        <Chip color="blue">Closed</Chip>
                      ) : future ? (
                        <Chip color="cyan">Upcoming</Chip>
                      ) : m.consent !== "accepted" ? (
                        <Chip color="yellow">Not signed</Chip>
                      ) : m.prcApproved ? (
                        <Chip color="green">Open</Chip>
                      ) : (
                        <Chip color="orange">PRC check</Chip>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/* ───────────────────────── modals ───────────────────────── */

function OverrideModal({ member, onClose }: { member: InitiativeMember; onClose: () => void }) {
  const updateMember = useCrm((s) => s.updateMember);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const standard = memberWeight({ ...member, weightOverride: null });
  const [value, setValue] = useState((member.weightOverride ?? standard).toFixed(2));
  const [reason, setReason] = useState(member.weightNote ?? "");
  const [allSigned, setAllSigned] = useState(false);
  const n = Number(value);
  const rule = overrideRule({ value: Number.isFinite(n) ? n : Number.NaN, standard, reason, allSigned });
  const valid = Number.isFinite(n) && n > 0 && n <= OVERRIDE_MAX;
  const name = userMap.get(member.userId)?.name ?? "member";
  const ok = rule.errors.length === 0 && (rule.nonStandard ? true : allSigned);

  return (
    <Modal
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Agreed weight — ${name}`}
      description="A non-standard weight in the Role and Weight Agreement (§6.7, Annex D)"
      footer={
        <>
          {member.weightOverride != null && (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={() => {
                updateMember(member.id, { weightOverride: null, weightNote: "" });
                notify("Standard weights apply again");
                onClose();
              }}
            >
              Use the standard weight
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ok}
            onClick={() => {
              updateMember(member.id, { weightOverride: Math.round(n * 100) / 100, weightNote: reason.trim() });
              notify(`Agreed weight for ${name} set to ${n.toFixed(2)}`);
              onClose();
            }}
          >
            Record agreed weight
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-soft-yellow/40 bg-soft-yellow/10 p-3 text-xs text-soft-yellow">
          The standard weights apply unless <strong>every initial member agrees in writing</strong> to different weights that reflect actual responsibilities. The reason is recorded on the agreement; the PRC checks it at approval.
          <Cite s="6.7" />
        </div>
        <div className="flex items-end gap-3">
          <div className="w-32">
            <Label>Agreed weight</Label>
            <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} className="sg-num" autoFocus />
          </div>
          <p className="pb-1.5 text-xs text-sg-dim">
            Standard: <span className="sg-num font-semibold text-sg-muted">{standard.toFixed(2)}</span> ({member.roles.map((r) => ROLE_META[r].label).join(" + ")})
          </p>
        </div>
        <div>
          <Label>Reason for the non-standard weight (required)</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Signs off the pressure-vessel design as engineer of record in addition to the TL role" className="min-h-[64px]" />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-sg-text">
          <input type="checkbox" checked={allSigned} onChange={(e) => setAllSigned(e.target.checked)} className="size-3.5 accent-sg-white" />
          Every initial team member has signed the agreement with this weight
        </label>
        {!valid ? <p className="text-2xs text-soft-red">Enter a weight above 0 and at most {OVERRIDE_MAX}.</p> : rule.errors.length && (reason || allSigned) ? (
          <ul className="space-y-0.5 text-2xs text-soft-yellow">
            {rule.errors.map((e) => (
              <li key={e}>• {e}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Modal>
  );
}

const REMOVAL_STEPS = [
  { stage: "verbal", label: "Verbal warning", desc: `The Project Lead names the areas to improve; ${POLICY.removalWarningDays.verbal} days to improve.` },
  { stage: "written", label: "Written project warning", desc: `${POLICY.removalWarningDays.written}-day improvement period. Not a disciplinary warning (§3.4).` },
  { stage: "removed", label: "Removal with PRC approval", desc: "Keeps the share of payments for work periods up to the removal date; reported to HR and the line manager; appeal to the PRC within 5 business days." },
] as const;

function RemovalModal({ member, onClose }: { member: InitiativeMember; onClose: () => void }) {
  const advanceRemoval = useCrm((s) => s.advanceRemoval);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const [note, setNote] = useState("");
  const [prc, setPrc] = useState(false);
  const name = userMap.get(member.userId)?.name ?? "member";
  const stage = member.removal.stage;
  const idx: number = stage === "none" ? 0 : stage === "verbal" ? 1 : stage === "written" ? 2 : 3;
  const next = REMOVAL_STEPS[idx] as (typeof REMOVAL_STEPS)[number] | undefined;
  const waitDays = stage === "verbal" ? POLICY.removalWarningDays.verbal : stage === "written" ? POLICY.removalWarningDays.written : 0;
  const periodEnd = member.removal.updatedAt ? Date.parse(member.removal.updatedAt) + waitDays * DAY : 0;
  const early = waitDays > 0 && periodEnd > Date.now();
  const needsPrc = next?.stage === "removed";

  return (
    <Modal
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Removal from the project — ${name}`}
      description="Poor project performance follows three documented steps (§7.5). Other team changes use an amendment (§6.8)."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {next && (
            <Button
              variant={next.stage === "removed" ? "danger" : "primary"}
              disabled={note.trim().length < 5 || (needsPrc && !prc)}
              onClick={() => {
                advanceRemoval(member.id, note.trim());
                notify(next.stage === "removed" ? `${name} removed — HR and line manager notified` : `${next.label} recorded for ${name}`);
                onClose();
              }}
            >
              {next.stage === "removed" ? <UserMinus className="size-4" /> : null}
              Record {next.label.toLowerCase()}
            </Button>
          )}
        </>
      }
    >
      <ol className="space-y-2">
        {REMOVAL_STEPS.map((s, i) => {
          const done = i < idx;
          const isNext = i === idx;
          return (
            <li key={s.stage} className={cn("flex gap-3 rounded-lg border p-2.5", done ? "border-sg-line bg-sg-bg/40" : isNext ? "border-sg-white/40" : "border-sg-line opacity-60")}>
              <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold", done ? "bg-soft-orange/25 text-soft-orange" : isNext ? "bg-sg-white text-sg-bg" : "bg-sg-card-3 text-sg-dim")}>{done ? <Check className="size-3" /> : i + 1}</span>
              <div className="min-w-0 text-xs">
                <div className="font-semibold text-sg-white">{s.label}</div>
                <div className="text-sg-muted">{s.desc}</div>
                {done && i === idx - 1 && member.removal.note && (
                  <div className="mt-1 text-sg-dim">
                    “{member.removal.note}” · {formatDate(member.removal.updatedAt, "medium")}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {early && (
        <p className="mt-3 flex items-start gap-1.5 text-2xs text-soft-yellow">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> The improvement period runs until {formatDate(new Date(periodEnd).toISOString(), "medium")}. Advancing earlier should be justified in the note.
        </p>
      )}
      {next && (
        <div className="mt-3 space-y-2">
          <div>
            <Label>Documentation note (required)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was discussed, expectations, evidence…" className="min-h-[72px]" />
          </div>
          {needsPrc ? (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-sg-text">
              <input type="checkbox" checked={prc} onChange={(e) => setPrc(e.target.checked)} className="size-3.5 accent-sg-white" />
              The PRC approved the removal<Cite s="7.5" />
            </label>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
