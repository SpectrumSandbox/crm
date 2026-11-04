"use client";

/* Right-side sheet with one employee's HR record, status changes, Annex E statements and Team Allocation Ledger rows. */
import { CircleAlert, CircleX, X } from "lucide-react";
import { useCrm } from "@/lib/store";
import { EMPLOYMENT_META, POLICY } from "@/lib/initiatives/policy";
import { formatDate, formatIDR } from "@/lib/utils";
import { Sheet, SheetClose } from "@/components/ui/overlays";
import { Avatar, Chip, EmptyState } from "@/components/ui/misc";
import { CapacityMeter, Cite, EligibilityBadge, Metric, Money } from "@/components/initiatives/shared";
import { GOVERNANCE_META, SEPARATION_LABEL, type PersonRow } from "./data";
import { HrRecordForm } from "./hr-record";
import { SeparationSection } from "./separation";
import { BonusStatement, Memberships } from "./statement";

export function EmployeeSheet({ row, onClose }: { row: PersonRow | null; onClose: () => void }) {
  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()} title={row ? `${row.user.name} — HR record` : "Employee"} width="w-[min(860px,100vw)]">
      {row && <SheetBody row={row} />}
    </Sheet>
  );
}

function SheetBody({ row }: { row: PersonRow }) {
  const users = useCrm((s) => s.users);
  const { user, profile, eligibility } = row;
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
            <EligibilityBadge userId={user.id} />
            {profile && <Chip color={EMPLOYMENT_META[profile.employmentType].eligible ? (profile.employmentType === "probationary" ? "yellow" : "green") : "red"}>{EMPLOYMENT_META[profile.employmentType].label}</Chip>}
            {row.annexB === "missing" ? <Chip color="orange">Annex B missing — payments held</Chip> : row.annexB === "pre_v4" ? <Chip color="yellow">Annex B pre-v4.0</Chip> : null}
            {profile?.governanceRoles.map((g) => (
              <Chip key={g} color={GOVERNANCE_META[g].color}>
                <span title={GOVERNANCE_META[g].title}>{GOVERNANCE_META[g].label}</span>
              </Chip>
            ))}
            {profile?.separation && (
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
        {(eligibility.blockers.length > 0 || eligibility.warnings.length > 0) && (
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

        <div className="grid grid-cols-2 gap-4 rounded-xl border border-sg-line bg-sg-card p-4 sm:grid-cols-4">
          <Metric label="Non-lead roles" value={`${row.nonLeadRoles} / ${POLICY.maxConcurrentNonLeadRoles}`} tone={overRoles ? "orange" : undefined} hint={overRoles ? "More than 3 needs line manager + PRC approval (§7.1)" : "Engineer, Secretary, Specialist (§7.1)"} />
          <div>
            <div className="sg-eyebrow">Leadership capacity</div>
            <CapacityMeter userId={user.id} className="mt-2" />
            <div className="mt-1 text-2xs text-sg-dim">Σ capacity factors as PL/TL, max {POLICY.leadershipCapacity.toFixed(1)} (§7.3)</div>
          </div>
          <Metric label="Paid this year" value={<Money value={row.ytdPaid} />} hint={profile?.employmentType === "part_time" ? `Part-time · allocation factor ≤ ${row.allocationCap}` : "Released bonuses and deferred releases"} />
          <Metric label={row.probationary ? "Held · probation" : "Deferred, not yet due"} value={<Money value={row.probationary ? row.probation : row.pendingDeferred} />} tone={row.probationary && row.probation > 0 ? "yellow" : undefined} hint={row.probationary ? `Deferred ${row.pendingDeferred > 0 ? formatIDR(row.pendingDeferred) : "none"} · §11.3` : "Vests 6–12 months after project close (§9.3)"} />
        </div>

        {profile ? (
          <>
            <HrRecordForm profile={profile} />
            <SeparationSection profile={profile} />
          </>
        ) : (
          <div className="rounded-xl border border-soft-red/40 bg-sg-card">
            <EmptyState icon={CircleX} title="No HR record">
              Eligibility cannot be verified, so this person cannot propose or join projects and any bonus lines are held until HR confirms their status (§3.5). Add them with &ldquo;Add person&rdquo; or ask HR to create the record.
            </EmptyState>
          </div>
        )}

        <BonusStatement userId={user.id} probationary={row.probationary} />
        <Memberships userId={user.id} />
        <p className="text-center text-2xs text-sg-dim">HR changes are recorded in the audit log under your name (§13.3).</p>
      </div>
    </>
  );
}
