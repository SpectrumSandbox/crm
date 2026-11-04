"use client";

/*
 * Reusable team editor for an initiative (§4 roles & weights, §5.1 capacity, §5.3 removal, §7 team changes).
 * Used by the proposal form (mode "proposal") and the initiative detail page (mode "live").
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BadgeCheck, Ban, Check, ChevronDown, ChevronRight, CircleAlert, Info, Lock, Pencil, Plus, Scale, ShieldCheck, Trash2, TriangleAlert, UserCheck, UserMinus, UserPlus, Users, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import { PROJECT_ROLES, type Initiative, type InitiativeMember, type ProjectRole } from "@/lib/initiatives/types";
import { capacityCheck, concurrentMemberships, memberWeight, participationEligibility, proposalEconomics, splitBonus } from "@/lib/initiatives/engine";
import { POLICY, PROJECT_TYPE_META, ROLE_META, SPECIALIST_RANGE } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR, relativeTime, spectrumDot } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Avatar, Chip, EmptyState } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Modal, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { CapacityMeter, Cite, EligibilityBadge, Money, Pct, RoleChips } from "./shared";

type Mode = "proposal" | "live";
type Dialog = { kind: "override"; memberId: string } | { kind: "removal"; memberId: string } | { kind: "transfer" } | { kind: "apply" } | null;

const DAY = 86_400_000;
const SPECIALIST_OPTIONS = Array.from({ length: Math.round((SPECIALIST_RANGE[1] - SPECIALIST_RANGE[0]) * 10) + 1 }, (_, i) => Math.round((SPECIALIST_RANGE[0] + i * 0.1) * 10) / 10);
const ASSIGNABLE_ROLES = PROJECT_ROLES.filter((r) => r !== "initiator");

/* ───────────────────────── candidate checks (§2.1, §5.1, §6.8) ───────────────────────── */

interface CandidateCheck {
  blockers: string[];
  warnings: string[];
  probationary: boolean;
  leadership: boolean;
  concurrent: number;
  capacity: ReturnType<typeof capacityCheck>;
}

function useCandidateCheck(userId: string, roles: ProjectRole[], initiative: Initiative | undefined): CandidateCheck | null {
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const profiles = useCrm((s) => s.employeeProfiles);
  return useMemo(() => {
    if (!userId || !initiative) return null;
    const profile = profiles.find((p) => p.userId === userId);
    const elig = participationEligibility(profile);
    const leadership = roles.some((r) => ROLE_META[r].leadership);
    const capacity = capacityCheck(userId, initiative, roles, initiatives, members);
    const concurrent = concurrentMemberships(userId, initiatives, members, initiative.id);
    const blockers = [...elig.blockers];
    if (leadership && !capacity.ok)
      blockers.push(
        `Leadership capacity would reach ${capacity.after.toFixed(2)} of ${POLICY.leadershipCapacity.toFixed(1)} (${capacity.before.toFixed(2)} already used + ${capacity.adds.toFixed(2)} for a Type ${initiative.type} lead role). Project/Technical Lead roles count 0.25 (A), 0.5 (B) or 1.0 (C) each and must not exceed 2.0 (§5.1).`,
      );
    const warnings = elig.warnings.filter((w) => !w.startsWith("Probationary"));
    if (concurrent >= POLICY.maxConcurrentMemberships)
      warnings.push(`Already on ${concurrent} live project${concurrent === 1 ? "" : "s"} — the policy recommends no more than ${POLICY.maxConcurrentMemberships} concurrent memberships (§5.1). Allowed, but confirm workload with the direct manager.`);
    return { blockers, warnings, probationary: profile?.employmentType === "probationary", leadership, concurrent, capacity };
  }, [userId, roles, initiative, initiatives, members, profiles]);
}

function CandidateNotices({ check, ack, onAck }: { check: CandidateCheck | null; ack: boolean; onAck: (v: boolean) => void }) {
  if (!check) return null;
  return (
    <div className="space-y-2">
      {check.blockers.length > 0 && (
        <div className="rounded-lg border border-soft-red/40 bg-soft-red/10 p-2.5 text-xs text-soft-red">
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <Ban className="size-3.5" /> Cannot be added
            <Cite s="2.1" />
          </div>
          <ul className="list-disc space-y-0.5 pl-5">
            {check.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {check.warnings.length > 0 && (
        <div className="rounded-lg border border-soft-yellow/40 bg-soft-yellow/10 p-2.5 text-xs text-soft-yellow">
          <ul className="space-y-0.5">
            {check.warnings.map((w) => (
              <li key={w} className="flex gap-1.5">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {w}
              </li>
            ))}
          </ul>
        </div>
      )}
      {check.probationary && check.blockers.length === 0 && (
        <div className="rounded-lg border border-soft-orange/40 bg-soft-orange/10 p-2.5 text-xs text-soft-orange">
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <CircleAlert className="size-3.5" /> Probationary employee — bonus withholding
            <Cite s="6.8" />
          </div>
          <p className="text-sg-text">
            Bonuses earned during probation are calculated monthly but withheld, and paid as a Probation Completion Bonus within 30 days of successfully completing probation. If probation is not completed (resignation, termination or failed probation), the accumulated amount is forfeited in full.
          </p>
          <label className="mt-2 flex cursor-pointer items-center gap-2 font-semibold text-sg-white">
            <input type="checkbox" checked={ack} onChange={(e) => onAck(e.target.checked)} className="size-3.5 accent-sg-white" />
            The employee has been informed and acknowledges the withholding
          </label>
        </div>
      )}
      {check.leadership && check.blockers.length === 0 && (
        <div className="flex items-center gap-2 text-2xs text-sg-dim">
          Leadership capacity after this role: <span className="sg-num font-semibold text-sg-muted">{check.capacity.after.toFixed(2)}</span> / {POLICY.leadershipCapacity.toFixed(1)}
          <Cite s="5.1" />
        </div>
      )}
    </div>
  );
}

function canProceed(check: CandidateCheck | null, ack: boolean) {
  return !!check && check.blockers.length === 0 && (!check.probationary || ack);
}

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

/* ───────────────────────── main component ───────────────────────── */

export function TeamEditor({ initiativeId, mode }: { initiativeId: string; mode: "proposal" | "live" }) {
  const initiatives = useCrm((s) => s.initiatives);
  const allMembers = useCrm((s) => s.initiativeMembers);
  const adjustments = useCrm((s) => s.shareAdjustments);
  const currentUserId = useCrm((s) => s.currentUserId);
  const approveMembers = useCrm((s) => s.approveMembers);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const initiative = initiatives.find((i) => i.id === initiativeId);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [showFormer, setShowFormer] = useState(false);

  const { current, former } = useMemo(() => {
    const mine = allMembers.filter((m) => m.initiativeId === initiativeId);
    const rank = (m: InitiativeMember) => (m.roles.includes("initiator") ? 0 : m.roles.includes("project_lead") ? 1 : m.roles.includes("technical_lead") ? 2 : 3);
    return {
      current: mine.filter((m) => !m.leftAt).sort((a, b) => rank(a) - rank(b) || a.joinedAt.localeCompare(b.joinedAt)),
      former: mine.filter((m) => m.leftAt).sort((a, b) => (b.leftAt ?? "").localeCompare(a.leftAt ?? "")),
    };
  }, [allMembers, initiativeId]);

  const econ = useMemo(() => (initiative ? proposalEconomics(initiative, adjustments) : null), [initiative, adjustments]);
  const counted = useMemo(() => current.filter((m) => m.consent !== "declined"), [current]);
  const split = useMemo(() => splitBonus(counted.map((m) => ({ userId: m.userId, weight: memberWeight(m) })), econ?.share ?? 0, econ?.expected.net ?? 0), [counted, econ]);
  const bonusByUser = useMemo(() => new Map(split.shares.map((s) => [s.userId, s.bonus] as const)), [split]);

  if (!initiative || !econ) return <EmptyState icon={Users} title="Initiative not found">Save the proposal first so a team can be attached.</EmptyState>;

  const lead = current.find((m) => m.roles.includes("project_lead"));
  const unapproved = current.filter((m) => m.consent === "accepted" && !m.prcApproved);
  const pendingConsent = current.filter((m) => m.consent === "pending");
  const onTeam = current.some((m) => m.userId === currentUserId);
  const me = userMap.get(currentUserId);
  const dialogMember = dialog && "memberId" in dialog ? allMembers.find((m) => m.id === dialog.memberId) : undefined;

  return (
    <div className="rounded-xl border border-sg-line bg-sg-card">
      {/* header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-sg-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-sg-muted" />
          <span className="font-display text-sm font-extrabold text-sg-white">Team</span>
          <span className="rounded-sm bg-sg-card-3 px-1.5 text-2xs font-semibold text-sg-muted">{current.length}</span>
        </div>
        <div className="text-2xs text-sg-dim">
          Total weight <span className="sg-num font-semibold text-sg-white">{split.total.toFixed(2)}</span>
          <Cite s="4.1" />
        </div>
        {pendingConsent.length > 0 && <Chip color="yellow">{pendingConsent.length} awaiting consent</Chip>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {mode === "live" && unapproved.length > 0 && (
            <Button
              size="sm"
              variant="primary"
              title={`${unapproved.length} accepted member(s) not yet PRC-approved. Recorded by ${me?.name ?? "current user"} as PRC (§7.1 step 2).`}
              onClick={() => {
                approveMembers(initiativeId);
                notify(`Team approved by PRC — ${unapproved.length} member${unapproved.length === 1 ? "" : "s"}`);
              }}
            >
              <ShieldCheck /> Approve team (PRC)
            </Button>
          )}
          {mode === "live" && (
            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "transfer" })}>
              <ArrowRight /> Transfer Project Lead
            </Button>
          )}
          {mode === "live" && !onTeam && (
            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "apply" })}>
              <UserPlus /> Apply to join
            </Button>
          )}
        </div>
      </div>

      {mode === "live" && unapproved.length > 0 && (
        <div className="flex items-start gap-2 border-b border-sg-line bg-soft-yellow/5 px-4 py-2 text-2xs text-soft-yellow">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {unapproved.map((m) => userMap.get(m.userId)?.name ?? m.userId).join(", ")} accepted but {unapproved.length === 1 ? "is" : "are"} not yet PRC-approved — members only share in the pool once approved. PRC reviews team changes within {POLICY.sla.applicationBusinessDays} business days
            <Cite s="7.1" />
          </span>
        </div>
      )}

      {/* members */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-sm">
          <thead>
            <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-[0.1em] text-sg-dim">
              <th className="px-4 py-2 font-semibold">Member</th>
              <th className="px-2 py-2 font-semibold">Roles</th>
              <th className="px-2 py-2 font-semibold">Weight</th>
              <th className="px-2 py-2 font-semibold">Alloc.</th>
              <th className="px-2 py-2 font-semibold">Consent</th>
              <th className="px-2 py-2 font-semibold">PRC</th>
              <th className="px-2 py-2 font-semibold">Eligibility</th>
              <th className="px-2 py-2 font-semibold">Lead capacity</th>
              <th className="px-2 py-2 text-right font-semibold">Share</th>
              <th className="px-2 py-2 text-right font-semibold">Exp. bonus</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {current.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                initiative={initiative}
                mode={mode}
                totalWeight={split.total}
                bonus={bonusByUser.get(m.userId) ?? 0}
                onOverride={() => setDialog({ kind: "override", memberId: m.id })}
                onRemoval={() => setDialog({ kind: "removal", memberId: m.id })}
              />
            ))}
            {!current.length && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-xs text-sg-dim">
                  No team members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AddMemberPanel initiative={initiative} mode={mode} current={current} />

      {/* bonus split preview */}
      <div className="border-t border-sg-line px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="sg-eyebrow">
            Bonus-split preview
            <Cite s="4.2" />
          </span>
          <span className="text-2xs text-sg-dim">
            Expected net revenue <Money value={econ.expected.net} className="font-semibold text-sg-muted" /> × <Pct value={econ.share} /> share = pool <Money value={split.pool} className="font-semibold text-sg-white" />, split by weight ÷ {split.total.toFixed(2)}
          </span>
        </div>
        {split.pool > 0 && split.total > 0 ? (
          <>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-sg-card-3">
              {split.shares.map((s) => {
                const u = userMap.get(s.userId);
                return <span key={s.userId} title={`${u?.name ?? s.userId}: ${formatIDR(s.bonus)} (${((s.weight / split.total) * 100).toFixed(1)}%)`} className={cn("h-full border-r border-sg-card last:border-r-0", u ? spectrumDot[u.color] : "bg-sg-dim")} style={{ width: `${(s.weight / split.total) * 100}%` }} />;
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {split.shares.map((s) => {
                const u = userMap.get(s.userId);
                return (
                  <span key={s.userId} className="flex items-center gap-1.5 text-2xs text-sg-muted">
                    <span className={cn("size-2 rounded-full", u ? spectrumDot[u.color] : "bg-sg-dim")} />
                    {u?.name.split(" ")[0] ?? s.userId} <Money value={s.bonus} className="font-semibold text-sg-white" />
                  </span>
                );
              })}
            </div>
            <p className="mt-1.5 text-2xs text-sg-dim">Projection over the project&apos;s life at the expected scenario, assuming pending members accept. Actual bonuses are computed monthly on recognised revenue after the break-even test (§6.1){econ.expected.net > POLICY.deferral.netRevenueThreshold ? "; 30% may be deferred (§6.3)" : ""}.</p>
          </>
        ) : (
          <p className="mt-1 text-2xs text-sg-dim">Enter a revenue forecast above direct costs to preview the split.</p>
        )}
      </div>

      {/* former members */}
      {former.length > 0 && (
        <div className="border-t border-sg-line">
          <button type="button" onClick={() => setShowFormer((v) => !v)} className="flex w-full items-center gap-1.5 px-4 py-2 text-left text-xs font-semibold text-sg-muted hover:text-sg-white">
            {showFormer ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            Former members
            <span className="rounded-sm bg-sg-card-3 px-1 text-[10px] text-sg-muted">{former.length}</span>
          </button>
          {showFormer && (
            <ul className="divide-y divide-sg-line border-t border-sg-line">
              {former.map((m) => {
                const u = userMap.get(m.userId);
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-xs">
                    <Avatar user={u} size="xs" />
                    <span className="font-semibold text-sg-muted">{u?.name ?? m.userId}</span>
                    <RoleChips roles={m.roles} />
                    <span className="text-sg-dim">
                      {formatDate(m.joinedAt, "short")} → {formatDate(m.leftAt, "medium")}
                    </span>
                    {m.removal.stage === "removed" ? <Chip color="red">Removed (§5.3)</Chip> : <Chip color="blue">Left</Chip>}
                    {m.removal.note ? <span className="truncate text-sg-dim">“{m.removal.note}”</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {dialog?.kind === "override" && dialogMember && <OverrideModal member={dialogMember} onClose={() => setDialog(null)} />}
      {dialog?.kind === "removal" && dialogMember && <RemovalModal member={dialogMember} onClose={() => setDialog(null)} />}
      {dialog?.kind === "transfer" && <TransferModal initiative={initiative} current={current} lead={lead} onClose={() => setDialog(null)} />}
      {dialog?.kind === "apply" && <ApplyModal initiative={initiative} onClose={() => setDialog(null)} />}
    </div>
  );
}

/* ───────────────────────── member row ───────────────────────── */

function MemberRow({ member: m, initiative, mode, totalWeight, bonus, onOverride, onRemoval }: { member: InitiativeMember; initiative: Initiative; mode: Mode; totalWeight: number; bonus: number; onOverride: () => void; onRemoval: () => void }) {
  const userMap = useUserMap();
  const updateMember = useCrm((s) => s.updateMember);
  const setConsent = useCrm((s) => s.setConsent);
  const removeMember = useCrm((s) => s.removeMember);
  const notify = useUi((s) => s.notify);
  const u = userMap.get(m.userId);
  const weight = memberWeight(m);
  const isInitiator = m.roles.includes("initiator");
  const leadership = m.roles.some((r) => ROLE_META[r].leadership);
  const declined = m.consent === "declined";
  const sharePct = !declined && totalWeight > 0 ? weight / totalWeight : 0;
  const warningDays = m.removal.stage === "verbal" ? POLICY.removalWarningDays.verbal : m.removal.stage === "written" ? POLICY.removalWarningDays.written : 0;

  return (
    <tr className={cn("border-b border-sg-line align-middle", declined && "opacity-55")}>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <Avatar user={u} size="sm" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate font-semibold text-sg-white">
              {u?.name ?? m.userId}
              {m.application ? <span className="rounded-sm bg-sg-card-3 px-1 text-[9px] font-semibold uppercase text-sg-muted" title="Joined via employee application (§7.1)">applied</span> : null}
            </div>
            <div className="truncate text-2xs text-sg-dim">{u?.title ?? "—"}</div>
            {m.removal.stage !== "none" && m.removal.stage !== "removed" && (
              <div className="mt-0.5 text-2xs font-semibold text-soft-orange" title={m.removal.note}>
                {m.removal.stage === "verbal" ? "Verbal warning" : "Written warning"} · {relativeTime(m.removal.updatedAt)}
                {m.removal.updatedAt ? ` · improve by ${formatDate(new Date(Date.parse(m.removal.updatedAt) + warningDays * DAY).toISOString(), "short")}` : ""}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1">
          <RoleChips roles={m.roles} />
          <RoleEditor member={m} initiative={initiative} mode={mode} />
        </div>
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5">
          <span className={cn("sg-num font-semibold", m.weightOverride != null ? "text-soft-yellow" : "text-sg-white")} title={m.weightOverride != null ? `Consensus override (§4.1) — standard ${memberWeight({ ...m, weightOverride: null }).toFixed(2)}` : "Σ role weights (§4.3)"}>
            {weight.toFixed(2)}
          </span>
          {m.roles.includes("specialist") && m.weightOverride == null && (
            <Select
              aria-label="Specialist weight"
              value={(m.specialistWeight ?? ROLE_META.specialist.weight).toFixed(1)}
              onChange={(e) => updateMember(m.id, { specialistWeight: Number(e.target.value) })}
              wrapperClassName="w-[68px]"
              className="h-6 px-1.5 pr-6 text-2xs"
              title="Specialist weight 1.5–2.5 (§4.1)"
            >
              {SPECIALIST_OPTIONS.map((w) => (
                <option key={w} value={w.toFixed(1)}>
                  {w.toFixed(1)}
                </option>
              ))}
            </Select>
          )}
          <button type="button" onClick={onOverride} title="Consensus weight override (§4.1)" className="rounded p-0.5 text-sg-dim hover:bg-sg-card-2 hover:text-sg-white">
            <Scale className="size-3.5" />
          </button>
        </div>
      </td>
      <td className="px-2 py-2">
        <AllocationInput value={m.allocationPct} onCommit={(v) => updateMember(m.id, { allocationPct: v })} />
      </td>
      <td className="px-2 py-2">
        {isInitiator ? (
          <Chip color="green" className="cursor-default">
            <Lock className="size-3" /> Initiator
          </Chip>
        ) : (
          <Menu>
            <MenuTrigger asChild>
              <button type="button" className="inline-flex items-center gap-1" title="Record consent (§7.1 step 1)">
                <ConsentChip consent={m.consent} />
                <ChevronDown className="size-3 text-sg-dim" />
              </button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Record consent · §7.1</MenuLabel>
              <MenuItem active={m.consent === "accepted"} onSelect={() => (setConsent(m.id, "accepted"), notify(`${u?.name ?? "Member"} accepted`))}>
                <UserCheck className="size-3.5 text-soft-green" /> Accepted
              </MenuItem>
              <MenuItem active={m.consent === "declined"} onSelect={() => (setConsent(m.id, "declined"), notify(`${u?.name ?? "Member"} declined`))}>
                <X className="size-3.5 text-soft-red" /> Declined
              </MenuItem>
              <MenuItem active={m.consent === "pending"} onSelect={() => setConsent(m.id, "pending")}>
                <CircleAlert className="size-3.5 text-soft-yellow" /> Pending
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
      </td>
      <td className="px-2 py-2">
        {m.prcApproved ? (
          <span className="inline-flex items-center gap-1 text-2xs font-semibold text-soft-green" title="Team membership approved by PRC (§7.1 step 2)">
            <BadgeCheck className="size-3.5" /> Approved
          </span>
        ) : (
          <span className="text-2xs text-sg-dim" title={mode === "proposal" ? "Approved together with the proposal" : "Awaiting PRC approval"}>
            {mode === "proposal" ? "With proposal" : "Pending"}
          </span>
        )}
      </td>
      <td className="px-2 py-2">
        <EligibilityBadge userId={m.userId} />
      </td>
      <td className="px-2 py-2">{leadership ? <CapacityMeter userId={m.userId} /> : <span className="text-2xs text-sg-dim">—</span>}</td>
      <td className="sg-num px-2 py-2 text-right text-xs font-semibold text-sg-white">{declined ? "—" : <Pct value={sharePct} />}</td>
      <td className="px-2 py-2 text-right text-xs">{declined ? <span className="text-sg-dim">—</span> : <Money value={bonus} className="font-semibold text-sg-white" />}</td>
      <td className="px-4 py-2 text-right">
        {!isInitiator &&
          (mode === "proposal" || m.consent !== "accepted" ? (
            <Button
              size="icon-sm"
              variant="ghost"
              title={mode === "proposal" ? "Remove from proposal" : "Withdraw (not yet accepted)"}
              onClick={() => {
                removeMember(m.id);
                notify(`${u?.name ?? "Member"} removed from the team`);
              }}
            >
              <Trash2 />
            </Button>
          ) : (
            <Button size="xs" variant="ghost" title="Removal protocol (§5.3)" onClick={onRemoval}>
              <UserMinus /> {m.removal.stage === "none" ? "Remove…" : m.removal.stage === "verbal" ? "Step 2" : "Step 3"}
            </Button>
          ))}
      </td>
    </tr>
  );
}

function ConsentChip({ consent }: { consent: InitiativeMember["consent"] }) {
  if (consent === "accepted") return <Chip color="green">Accepted</Chip>;
  if (consent === "declined") return <Chip color="red">Declined</Chip>;
  return <Chip color="yellow">Pending</Chip>;
}

function AllocationInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.max(0, Math.min(100, Math.round(Number(text.replace(/[^\d.]/g, "")) || 0)));
    setText(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <span className="inline-flex items-center gap-0.5">
      <input
        aria-label="Allocation percent"
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        className="sg-num h-6 w-11 rounded border border-sg-line bg-sg-bg/60 px-1.5 text-right text-xs text-sg-text focus:border-sg-white/60 focus:outline-none"
      />
      <span className="text-2xs text-sg-dim">%</span>
    </span>
  );
}

/* ───────────────────────── role editor (existing member) ───────────────────────── */

function RoleEditor({ member, initiative, mode }: { member: InitiativeMember; initiative: Initiative; mode: Mode }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const updateMember = useCrm((s) => s.updateMember);
  const userMap = useUserMap();
  const currentLead = members.find((m) => m.initiativeId === initiative.id && !m.leftAt && m.id !== member.id && m.roles.includes("project_lead"));
  const disabled: Partial<Record<ProjectRole, string>> = {};
  if (mode === "live") disabled.project_lead = "Project Lead changes use “Transfer Project Lead” (§7.2)";

  const apply = (next: ProjectRole[]) => {
    setError(null);
    const roles = [...(member.roles.includes("initiator") ? (["initiator"] as ProjectRole[]) : []), ...next.filter((r) => r !== "initiator")];
    if (!roles.length) return setError("A member needs at least one role.");
    const addsLeadership = roles.some((r) => ROLE_META[r].leadership) && !member.roles.some((r) => ROLE_META[r].leadership);
    if (addsLeadership) {
      const cap = capacityCheck(member.userId, initiative, roles, initiatives, members);
      if (!cap.ok) return setError(`Blocked: leadership capacity would reach ${cap.after.toFixed(2)} / ${POLICY.leadershipCapacity.toFixed(1)} (§5.1).`);
    }
    // §2.4 a project has a single Project Lead — moving the role in a proposal takes it from the current holder
    if (roles.includes("project_lead") && !member.roles.includes("project_lead") && currentLead) {
      const rest = currentLead.roles.filter((r) => r !== "project_lead");
      if (!rest.length) return setError(`${userMap.get(currentLead.userId)?.name ?? "The current lead"} holds only the Project Lead role — give them another role first.`);
      updateMember(currentLead.id, { roles: rest });
    }
    updateMember(member.id, { roles, specialistWeight: roles.includes("specialist") ? member.specialistWeight ?? ROLE_META.specialist.weight : null });
  };

  return (
    <Popover open={open} onOpenChange={(v) => (setOpen(v), setError(null))}>
      <PopoverTrigger asChild>
        <button type="button" title="Edit roles" className="rounded p-0.5 text-sg-dim hover:bg-sg-card-2 hover:text-sg-white">
          <Pencil className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px]">
        <div className="sg-eyebrow mb-2">
          Roles — weights are cumulative
          <Cite s="4.3" />
        </div>
        {member.roles.includes("initiator") && (
          <div className="mb-2 flex items-center gap-1.5 text-2xs text-sg-dim">
            <Lock className="size-3" /> Project Initiator (0.5) is automatic for the proposer and can&apos;t be changed.
          </div>
        )}
        <RoleToggles value={member.roles.filter((r) => r !== "initiator")} onChange={apply} roles={ASSIGNABLE_ROLES} disabledRoles={disabled} />
        {mode === "proposal" && currentLead && !member.roles.includes("project_lead") && <p className="mt-2 text-2xs text-sg-dim">Choosing Project Lead moves it from {userMap.get(currentLead.userId)?.name}.</p>}
        {error && <p className="mt-2 text-2xs font-semibold text-soft-red">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}

/* ───────────────────────── add member ───────────────────────── */

function AddMemberPanel({ initiative, mode, current }: { initiative: Initiative; mode: Mode; current: InitiativeMember[] }) {
  const users = useCrm((s) => s.users);
  const currentUserId = useCrm((s) => s.currentUserId);
  const addMember = useCrm((s) => s.addMember);
  const updateMember = useCrm((s) => s.updateMember);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [roles, setRoles] = useState<ProjectRole[]>(["engineer"]);
  const [specialistWeight, setSpecialistWeight] = useState(ROLE_META.specialist.weight);
  const [allocation, setAllocation] = useState("20");
  const [ack, setAck] = useState(false);
  const check = useCandidateCheck(userId, roles, initiative);

  const available = useMemo(() => users.filter((u) => !current.some((m) => m.userId === u.id)), [users, current]);
  const lead = current.find((m) => m.roles.includes("project_lead"));
  const disabled: Partial<Record<ProjectRole, string>> = {};
  if (mode === "live") disabled.project_lead = "Use “Transfer Project Lead” (§7.2)";
  const ok = canProceed(check, ack) && roles.length > 0;

  const reset = () => {
    setUserId("");
    setRoles(["engineer"]);
    setAllocation("20");
    setAck(false);
  };

  const submit = () => {
    if (!ok) return;
    if (roles.includes("project_lead") && lead) {
      const rest = lead.roles.filter((r) => r !== "project_lead");
      if (rest.length) updateMember(lead.id, { roles: rest });
    }
    addMember(initiative.id, userId, roles, {
      specialistWeight: roles.includes("specialist") ? specialistWeight : null,
      allocationPct: Math.max(0, Math.min(100, Number(allocation) || 0)),
      consent: userId === currentUserId ? "accepted" : "pending",
    });
    notify(`${userMap.get(userId)?.name ?? "Member"} added — ${userId === currentUserId ? "consent recorded" : "awaiting consent (§7.1)"}`);
    reset();
  };

  if (!open)
    return (
      <div className="border-t border-sg-line px-4 py-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          <Plus /> {mode === "live" ? "Propose a team member" : "Add team member"}
        </Button>
      </div>
    );

  return (
    <div className="space-y-3 border-t border-sg-line bg-sg-bg/30 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="sg-eyebrow">
          Add team member
          <Cite s="7.1" />
        </span>
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => (setOpen(false), reset())}>
          <X />
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-[240px_minmax(0,1fr)_90px]">
        <div>
          <Label>Employee</Label>
          <Select value={userId} onChange={(e) => (setUserId(e.target.value), setAck(false))}>
            <option value="">Choose…</option>
            {available.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {u.title}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Roles</Label>
          <RoleToggles value={roles} onChange={setRoles} roles={ASSIGNABLE_ROLES} disabledRoles={disabled} />
          {roles.includes("specialist") && (
            <div className="mt-1.5 flex items-center gap-2 text-2xs text-sg-dim">
              Specialist weight
              <Select value={specialistWeight.toFixed(1)} onChange={(e) => setSpecialistWeight(Number(e.target.value))} wrapperClassName="w-[68px]" className="h-6 px-1.5 pr-6 text-2xs">
                {SPECIALIST_OPTIONS.map((w) => (
                  <option key={w} value={w.toFixed(1)}>
                    {w.toFixed(1)}
                  </option>
                ))}
              </Select>
              <Cite s="4.1" />
            </div>
          )}
          {roles.includes("project_lead") && lead && mode === "proposal" && <p className="mt-1 text-2xs text-sg-dim">Replaces {userMap.get(lead.userId)?.name} as Project Lead.</p>}
        </div>
        <div>
          <Label>Allocation %</Label>
          <Input inputMode="numeric" value={allocation} onChange={(e) => setAllocation(e.target.value.replace(/\D/g, ""))} className="sg-num" />
        </div>
      </div>
      {userId && (
        <div className="flex items-center gap-3 text-2xs text-sg-dim">
          <EligibilityBadge userId={userId} />
          {check?.leadership && <CapacityMeter userId={userId} adding={check.capacity.adds} />}
          <span>
            Live projects: <span className="sg-num font-semibold text-sg-muted">{check?.concurrent ?? 0}</span>
          </span>
        </div>
      )}
      <CandidateNotices check={check} ack={ack} onAck={setAck} />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={!ok} onClick={submit}>
          <UserPlus /> Add to team
        </Button>
        {!roles.length && <span className="text-2xs text-soft-red">Pick at least one role.</span>}
        {mode === "live" && <span className="text-2xs text-sg-dim">Needs member consent, then PRC approval within {POLICY.sla.applicationBusinessDays} business days (§7.1).</span>}
      </div>
    </div>
  );
}

/* ───────────────────────── modals ───────────────────────── */

function OverrideModal({ member, onClose }: { member: InitiativeMember; onClose: () => void }) {
  const updateMember = useCrm((s) => s.updateMember);
  const notify = useUi((s) => s.notify);
  const currentUserId = useCrm((s) => s.currentUserId);
  const userMap = useUserMap();
  const standard = memberWeight({ ...member, weightOverride: null });
  const [value, setValue] = useState((member.weightOverride ?? standard).toFixed(2));
  const [unanimous, setUnanimous] = useState(false);
  const [prc, setPrc] = useState(false);
  const n = Number(value);
  const valid = Number.isFinite(n) && n > 0 && n <= 10;
  const name = userMap.get(member.userId)?.name ?? "member";

  return (
    <Modal
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Weight override — ${name}`}
      description="Consensus adjustment of standard role weights (§4.1)"
      footer={
        <>
          {member.weightOverride != null && (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={() => {
                updateMember(member.id, { weightOverride: null });
                notify("Override cleared — standard weights apply");
                onClose();
              }}
            >
              Clear override
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid || !unanimous || !prc}
            onClick={() => {
              updateMember(member.id, { weightOverride: Math.round(n * 100) / 100 });
              notify(`Weight for ${name} set to ${n.toFixed(2)}`);
              onClose();
            }}
          >
            Apply override
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-soft-yellow/40 bg-soft-yellow/10 p-3 text-xs text-soft-yellow">
          Standard weights may only be changed when <strong>both</strong> conditions hold: (1) all team members agree unanimously, and (2) the Project Review Committee approves the adjustment.
          <Cite s="4.1" />
        </div>
        <div className="flex items-end gap-3">
          <div className="w-32">
            <Label>New weight</Label>
            <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} className="sg-num" autoFocus />
          </div>
          <p className="pb-1.5 text-xs text-sg-dim">
            Standard: <span className="sg-num font-semibold text-sg-muted">{standard.toFixed(2)}</span> ({member.roles.map((r) => ROLE_META[r].label).join(" + ")})
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-sg-text">
          <input type="checkbox" checked={unanimous} onChange={(e) => setUnanimous(e.target.checked)} className="size-3.5 accent-sg-white" />
          All team members have agreed unanimously
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-sg-text">
          <input type="checkbox" checked={prc} onChange={(e) => setPrc(e.target.checked)} className="size-3.5 accent-sg-white" />
          Approved by the PRC — recorded by {userMap.get(currentUserId)?.name ?? "current user"}
        </label>
        {!valid && <p className="text-2xs text-soft-red">Enter a weight greater than 0.</p>}
      </div>
    </Modal>
  );
}

const REMOVAL_STEPS = [
  { stage: "verbal", label: "Verbal warning", desc: `Project Lead documents the concern; ${POLICY.removalWarningDays.verbal} days to improve.` },
  { stage: "written", label: "Written warning", desc: `Formal written warning; ${POLICY.removalWarningDays.written} days to improve.` },
  { stage: "removed", label: "Removal", desc: "Removed from the team and reported to HR and the direct manager. Bonus prorated for satisfactory work to date." },
] as const;

function RemovalModal({ member, onClose }: { member: InitiativeMember; onClose: () => void }) {
  const advanceRemoval = useCrm((s) => s.advanceRemoval);
  const removeMember = useCrm((s) => s.removeMember);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const [note, setNote] = useState("");
  const name = userMap.get(member.userId)?.name ?? "member";
  const stage = member.removal.stage;
  const idx: number = stage === "none" ? 0 : stage === "verbal" ? 1 : stage === "written" ? 2 : 3;
  const next = REMOVAL_STEPS[idx] as (typeof REMOVAL_STEPS)[number] | undefined;
  const waitDays = stage === "verbal" ? POLICY.removalWarningDays.verbal : stage === "written" ? POLICY.removalWarningDays.written : 0;
  const periodEnd = member.removal.updatedAt ? Date.parse(member.removal.updatedAt) + waitDays * DAY : 0;
  const early = waitDays > 0 && periodEnd > Date.now();

  return (
    <Modal
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Removal protocol — ${name}`}
      description="Performance-based removal follows three documented steps (§5.3)"
      footer={
        <>
          {stage === "none" && (
            <Button
              variant="ghost"
              className="mr-auto"
              title="Voluntary departure or reassignment — compensation adjusts prospectively (§7.2)"
              onClick={() => {
                removeMember(member.id);
                notify(`${name} left the team`);
                onClose();
              }}
            >
              Record voluntary departure
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {next && (
            <Button
              variant={next.stage === "removed" ? "danger" : "primary"}
              disabled={note.trim().length < 5}
              onClick={() => {
                advanceRemoval(member.id, note.trim());
                notify(next.stage === "removed" ? `${name} removed — HR and manager notified` : `${next.label} recorded for ${name}`);
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
        <div className="mt-3">
          <Label>Documentation note (required)</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was discussed, expectations, evidence…" className="min-h-[72px]" />
        </div>
      )}
    </Modal>
  );
}

function TransferModal({ initiative, current, lead, onClose }: { initiative: Initiative; current: InitiativeMember[]; lead: InitiativeMember | undefined; onClose: () => void }) {
  const users = useCrm((s) => s.users);
  const transferLead = useCrm((s) => s.transferLead);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const roles = useMemo<ProjectRole[]>(() => ["project_lead"], []);
  const check = useCandidateCheck(to, roles, initiative);
  const teamIds = new Set(current.filter((m) => m.consent !== "declined").map((m) => m.userId));
  const ok = canProceed(check, ack) && reason.trim().length >= 5;

  return (
    <Modal
      open
      onOpenChange={(v) => !v && onClose()}
      title="Transfer Project Lead"
      description="Role changes need PRC approval; compensation adjusts prospectively from the effective date (§7.2)"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ok}
            onClick={() => {
              transferLead(initiative.id, to, reason.trim());
              notify(`Project Lead transferred to ${userMap.get(to)?.name ?? "new lead"}`);
              onClose();
            }}
          >
            Transfer lead
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-sg-muted">
          Current lead:
          {lead ? (
            <>
              <Avatar user={userMap.get(lead.userId)} size="xs" /> <span className="font-semibold text-sg-white">{userMap.get(lead.userId)?.name}</span>
            </>
          ) : (
            <span className="text-soft-orange">none assigned</span>
          )}
        </div>
        <div>
          <Label>New Project Lead</Label>
          <Select value={to} onChange={(e) => (setTo(e.target.value), setAck(false))}>
            <option value="">Choose…</option>
            <optgroup label="Current team">
              {users
                .filter((u) => teamIds.has(u.id) && u.id !== lead?.userId)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.title}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Other employees">
              {users
                .filter((u) => !teamIds.has(u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.title}
                  </option>
                ))}
            </optgroup>
          </Select>
        </div>
        {to && <CapacityMeter userId={to} adding={check?.capacity.adds ?? 0} />}
        <CandidateNotices check={check} ack={ack} onAck={setAck} />
        <div>
          <Label>Reason (recorded in the audit log)</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Rani reassigned to the Selat rollout; Fajar takes over delivery from 1 Dec" className="min-h-[64px]" />
        </div>
        <p className="text-2xs text-sg-dim">
          {lead ? `${userMap.get(lead.userId)?.name} keeps any other roles; the Project Lead weight (2.0) moves to the new lead.` : "The new lead joins with the Project Lead role (weight 2.0)."} Type {initiative.type} lead roles count {PROJECT_TYPE_META[initiative.type].capacityFactor} toward the 2.0 capacity limit
          <Cite s="5.1" />
        </p>
      </div>
    </Modal>
  );
}

function ApplyModal({ initiative, onClose }: { initiative: Initiative; onClose: () => void }) {
  const currentUserId = useCrm((s) => s.currentUserId);
  const addMember = useCrm((s) => s.addMember);
  const notify = useUi((s) => s.notify);
  const [roles, setRoles] = useState<ProjectRole[]>(["engineer"]);
  const [specialistWeight, setSpecialistWeight] = useState(ROLE_META.specialist.weight);
  const [allocation, setAllocation] = useState("20");
  const [ack, setAck] = useState(false);
  const check = useCandidateCheck(currentUserId, roles, initiative);
  const ok = canProceed(check, ack) && roles.length > 0;
  const applyRoles = ASSIGNABLE_ROLES.filter((r) => r !== "project_lead");

  return (
    <Modal
      open
      onOpenChange={(v) => !v && onClose()}
      title="Apply to join"
      description={`Applications are reviewed by the Project Lead and PRC within ${POLICY.sla.applicationBusinessDays} business days (§7.1)`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ok}
            onClick={() => {
              addMember(initiative.id, currentUserId, roles, { application: true, consent: "accepted", allocationPct: Math.max(0, Math.min(100, Number(allocation) || 0)), specialistWeight: roles.includes("specialist") ? specialistWeight : null });
              notify("Application submitted — awaiting PRC approval");
              onClose();
            }}
          >
            <UserPlus className="size-4" /> Submit application
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-sg-muted">
          Your eligibility: <EligibilityBadge userId={currentUserId} />
        </div>
        <div>
          <Label>Roles you&apos;re applying for</Label>
          <RoleToggles value={roles} onChange={setRoles} roles={applyRoles} />
          {roles.includes("specialist") && (
            <div className="mt-1.5 flex items-center gap-2 text-2xs text-sg-dim">
              Proposed specialist weight
              <Select value={specialistWeight.toFixed(1)} onChange={(e) => setSpecialistWeight(Number(e.target.value))} wrapperClassName="w-[68px]" className="h-6 px-1.5 pr-6 text-2xs">
                {SPECIALIST_OPTIONS.map((w) => (
                  <option key={w} value={w.toFixed(1)}>
                    {w.toFixed(1)}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
        <div className="w-32">
          <Label>Allocation %</Label>
          <Input inputMode="numeric" value={allocation} onChange={(e) => setAllocation(e.target.value.replace(/\D/g, ""))} className="sg-num" />
        </div>
        <CandidateNotices check={check} ack={ack} onAck={setAck} />
      </div>
    </Modal>
  );
}
