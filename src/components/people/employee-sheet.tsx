"use client";

/* Right-side sheet with one employee's HR record, separation actions, bonus statement and memberships. */
import { CircleAlert, CircleX, X } from "lucide-react";
import { useCrm } from "@/lib/store";
import { EMPLOYMENT_META, POLICY } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { Sheet, SheetClose } from "@/components/ui/overlays";
import { Avatar, Chip, EmptyState } from "@/components/ui/misc";
import { CapacityMeter, Cite, EligibilityBadge, Metric, Money } from "@/components/initiatives/shared";
import { GOVERNANCE_META, SEPARATION_LABEL, type PersonRow } from "./data";
import { Bar } from "./fields";
import { HrRecordForm } from "./hr-record";
import { SeparationSection } from "./separation";
import { BonusStatement, Memberships } from "./statement";

export function EmployeeSheet({ row, onClose }: { row: PersonRow | null; onClose: () => void }) {
  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()} title={row ? `${row.user.name} — HR record` : "Employee"} width="w-[min(820px,100vw)]">
      {row && <SheetBody row={row} />}
    </Sheet>
  );
}

function SheetBody({ row }: { row: PersonRow }) {
  const users = useCrm((s) => s.users);
  const { user, profile, eligibility } = row;
  const manager = profile?.directManagerId ? users.find((u) => u.id === profile.directManagerId) : undefined;

  return (
    <>
      <div className="sg-spectrum-rule h-[2px] shrink-0" />
      <header className="flex shrink-0 items-start gap-3 border-b border-sg-line px-5 py-4">
        <Avatar user={user} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-lg font-extrabold text-sg-white">{user.name}</h2>
          <div className="truncate text-xs text-sg-muted">
            {user.title} · {user.team}
            {manager ? ` · reports to ${manager.name}` : ""}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <EligibilityBadge userId={user.id} />
            {profile && <Chip color={EMPLOYMENT_META[profile.employmentType].eligible ? (profile.employmentType === "probationary" ? "yellow" : "green") : "red"}>{EMPLOYMENT_META[profile.employmentType].label}</Chip>}
            {profile?.governanceRoles.map((g) => (
              <Chip key={g} color={GOVERNANCE_META[g].color}>
                <span title={GOVERNANCE_META[g].title}>{GOVERNANCE_META[g].label}</span>
              </Chip>
            ))}
            {profile?.separation && <Chip color="orange">{SEPARATION_LABEL[profile.separation.kind]} · {formatDate(profile.separation.effectiveAt, "short")}</Chip>}
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
              Participation eligibility <Cite s="2.1" />
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
          <Metric label="Active projects" value={row.projects} tone={row.projects > POLICY.maxConcurrentMemberships ? "orange" : undefined} hint={row.projects > POLICY.maxConcurrentMemberships ? `Above recommended ${POLICY.maxConcurrentMemberships} (§5.1)` : `Recommended ≤ ${POLICY.maxConcurrentMemberships}`} />
          <div>
            <div className="sg-eyebrow">Leadership capacity</div>
            <CapacityMeter userId={user.id} className="mt-2" />
            <div className="mt-1 text-2xs text-sg-dim">Σ type factors as PL/TL (§5.1)</div>
          </div>
          <div>
            <Metric label={`Paid YTD`} value={<Money value={row.ytdPaid} />} tone={row.capPct >= 1 ? "red" : row.capPct >= 0.8 ? "yellow" : undefined} hint={row.cap > 0 ? `${Math.round(row.capPct * 100)}% of 200% salary cap` : "No salary on record"} />
            <Bar pct={row.capPct * 100} tone={row.capPct >= 1 ? "red" : row.capPct >= 0.8 ? "yellow" : "cyan"} className="mt-1 w-full" />
          </div>
          <Metric label={row.probationary ? "Probation accrual" : "Pending deferred"} value={<Money value={row.probationary ? row.probation : row.pendingDeferred} />} tone={row.probationary && row.probation > 0 ? "yellow" : undefined} hint={row.probationary ? `Pending deferred ${row.pendingDeferred > 0 ? formatIDR(row.pendingDeferred) : "none"}` : "Vests per §6.3 schedule"} />
        </div>

        {profile ? (
          <>
            <HrRecordForm profile={profile} />
            <SeparationSection profile={profile} />
          </>
        ) : (
          <div className="rounded-xl border border-soft-red/40 bg-sg-card">
            <EmptyState icon={CircleX} title="No HR record">
              Eligibility cannot be verified, so this person cannot propose or join initiatives and any bonus lines are held (§2.1, §4.5). HR must create the employee profile in the HR system of record.
            </EmptyState>
          </div>
        )}

        <BonusStatement userId={user.id} probationary={row.probationary} />
        <Memberships userId={user.id} />
        <p className={cn("text-center text-2xs text-sg-dim")}>HR changes are recorded in the audit log under your name (§9.2).</p>
      </div>
    </>
  );
}

