"use client";

/* Right-side sheet with one employee's HR record, status changes, Annex E statements and Team Allocation Ledger rows. */
import { CircleAlert, CircleX, Lock, X } from "lucide-react";
import { useCrm } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import { EMPLOYMENT_META, POLICY } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { Sheet, SheetClose } from "@/components/ui/overlays";
import { Avatar, Chip, EmptyState } from "@/components/ui/misc";
import { CapacityMeter, Cite, EligibilityBadge, Metric, Money } from "@/components/initiatives/shared";
import { GOVERNANCE_META, SEPARATION_LABEL, type PersonRow } from "./data";
import { HrRecordForm } from "./hr-record";
import { SeparationSection } from "./separation";
import { BonusStatement, Memberships } from "./statement";
import { GovernanceRolesBlock, IdentifiersBlock } from "./governance";

export function EmployeeSheet({ row, onClose }: { row: PersonRow | null; onClose: () => void }) {
  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()} title={row ? `${row.user.name} — people record` : "Employee"} width="w-[min(860px,100vw)]">
      {row && <SheetBody row={row} />}
    </Sheet>
  );
}

function SheetBody({ row }: { row: PersonRow }) {
  const users = useCrm((s) => s.users);
  const access = useAccess();
  const { user, profile, eligibility } = row;
  // §13.4 pay and status data: Finance, HR, the PRC and the employee concerned only
  const canPay = access.seePayOf(user.id);
  const canEdit = access.manageHr;
  const manager = profile?.directManagerId ? users.find((u) => u.id === profile.directManagerId) : undefined;
  const overRoles = row.nonLeadRoles > POLICY.maxConcurrentNonLeadRoles;

  return (
    <>
      <div className="sg-spectrum-rule h-[2px] shrink-0" />
      <header className="flex shrink-0 items-start gap-3 border-b border-sg-line px-5 py-4">
        <Avatar user={user} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-lg font-extrabold text-sg-white">{user.name}</h2>
          <div className="truncate text-xs text-sg-muted">
            {user.title} · {user.team} · {user.email}
            {manager ? ` · reports to ${manager.name}` : ""}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {canPay ? <EligibilityBadge userId={user.id} /> : null}
            {canPay && profile && <Chip color={EMPLOYMENT_META[profile.employmentType].eligible ? (profile.employmentType === "probationary" ? "yellow" : "green") : "red"}>{EMPLOYMENT_META[profile.employmentType].label}</Chip>}
            {!canPay ? null : row.annexB === "missing" ? <Chip color="orange">Annex B missing — payments held</Chip> : row.annexB === "pre_v4" ? <Chip color="yellow">Annex B pre-v4.0</Chip> : null}
            {profile?.governanceRoles.map((g) => (
              <Chip key={g} color={GOVERNANCE_META[g].color}>
                <span title={GOVERNANCE_META[g].title}>{GOVERNANCE_META[g].label}</span>
              </Chip>
            ))}
            {canPay && profile?.separation && (
              <Chip color="orange">
                {SEPARATION_LABEL[profile.separation.kind]} · {formatDate(profile.separation.effectiveAt, "short")}
              </Chip>
            )}
          </div>
        </div>
        <SheetClose className="rounded p-1 text-sg-dim hover:bg-sg-card-2 hover:text-sg-white" aria-label="Close">
          <X className="size-4" />
        </SheetClose>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {!canPay ? (
          <div className="flex items-start gap-2 rounded-xl border border-sg-line bg-sg-card p-3 text-xs text-sg-muted">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Directory view — employment status, eligibility, salary and bonus balances are personal data limited to Finance, HR, the PRC and {user.name.split(" ")[0]} <Cite s="13.4" />.
            </span>
          </div>
        ) : null}
        {canPay && (eligibility.blockers.length > 0 || eligibility.warnings.length > 0) && (
          <div className="space-y-1 rounded-xl border border-sg-line bg-sg-card p-3">
            <div className="sg-eyebrow mb-1 flex items-center">
              Eligibility <Cite s="3" />
            </div>
            {eligibility.blockers.map((b) => (
              <div key={b} className="flex items-start gap-1.5 text-xs text-soft-red">
                <CircleX className="mt-0.5 size-3.5 shrink-0" /> {b}
              </div>
            ))}
            {eligibility.warnings.map((w) => (
              <div key={w} className="flex items-start gap-1.5 text-xs text-soft-yellow">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {w}
              </div>
            ))}
          </div>
        )}

        <div className={cn("grid grid-cols-2 gap-4 rounded-xl border border-sg-line bg-sg-card p-4", canPay ? "sm:grid-cols-4" : "sm:grid-cols-2")}>
          <Metric label="Non-lead roles" value={`${row.nonLeadRoles} / ${POLICY.maxConcurrentNonLeadRoles}`} tone={overRoles ? "orange" : undefined} hint={overRoles ? "More than 3 needs line manager + PRC approval (§7.1)" : "Engineer, Secretary, Specialist (§7.1)"} />
          <div>
            <div className="sg-eyebrow">Leadership capacity</div>
            <CapacityMeter userId={user.id} className="mt-2" />
            <div className="mt-1 text-2xs text-sg-dim">Σ capacity factors as PL/TL, max {POLICY.leadershipCapacity.toFixed(1)} (§7.3)</div>
          </div>
          {canPay ? <Metric label="Paid this year" value={<Money value={row.ytdPaid} />} hint={profile?.employmentType === "part_time" ? `Part-time · allocation factor ≤ ${row.allocationCap}` : "Released bonuses and deferred releases"} /> : null}
          {canPay ? <Metric label={row.probationary ? "Held · probation" : "Deferred, not yet due"} value={<Money value={row.probationary ? row.probation : row.pendingDeferred} />} tone={row.probationary && row.probation > 0 ? "yellow" : undefined} hint={row.probationary ? `Deferred ${row.pendingDeferred > 0 ? formatIDR(row.pendingDeferred) : "none"} · §11.3` : "Vests 6–12 months after project close (§9.3)"} /> : null}
        </div>

        {!canPay ? null : profile ? (
          <>
            <HrRecordForm profile={profile} readOnly={!canEdit} />
            <IdentifiersBlock profile={profile} readOnly={!canEdit} />
            <GovernanceRolesBlock profile={profile} readOnly={!canEdit} />
            <SeparationSection profile={profile} readOnly={!canEdit} />
          </>
        ) : (
          <div className="rounded-xl border border-soft-red/40 bg-sg-card">
            <EmptyState icon={CircleX} title="No HR record">
              Eligibility cannot be verified, so this person cannot propose or join projects and any bonus lines are held until HR confirms their status (§3.5). Add them with &ldquo;Add person&rdquo; or ask HR to create the record.
            </EmptyState>
          </div>
        )}

        {canPay ? <BonusStatement userId={user.id} probationary={row.probationary} /> : null}
        <Memberships userId={user.id} />
        <p className="text-center text-2xs text-sg-dim">{canEdit ? "HR changes are recorded in the audit log under your name (§13.3)." : canPay ? "Read-only — HR maintains this record (§13.2)." : "Directory information only (§13.4)."}</p>
      </div>
    </>
  );
}
