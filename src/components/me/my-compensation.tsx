"use client";

/* /me — "My compensation" for the current user (useCrm currentUserId; the demo "acting as" switcher changes it). */
import { useMemo } from "react";
import Link from "next/link";
import { BookOpen, CircleAlert, CircleCheck, CircleX, UserX } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { concurrentNonLeadRoles, isLiveMember, leadershipLoad, paidInYear, participationEligibility, probationBalance } from "@/lib/initiatives/engine";
import { EMPLOYMENT_META, POLICY, PROJECT_TYPE_META, ROLE_META } from "@/lib/initiatives/policy";
import type { EmployeeProfile } from "@/lib/initiatives/types";
import { actAs, canActAs } from "@/lib/sync/identity";
import { cn, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Select } from "@/components/ui/input";
import { Avatar, Chip, EmptyState } from "@/components/ui/misc";
import { Cite, Metric, Money } from "@/components/initiatives/shared";
import { AgreementCard } from "./agreement";
import { MyAmendments } from "./amendments";
import { CycleProjection, ENDED, MyProjects } from "./projects";
import { DeferredList, MyClawbacks, ProbationCard, StatementHistory } from "./statements";
import { Card } from "./ui";

export function MyCompensation() {
  const userId = useCrm((s) => s.currentUserId);
  const users = useCrm((s) => s.users);
  const profiles = useCrm((s) => s.employeeProfiles);
  const identity = useCrm((s) => s.identity);
  const notify = useUi((s) => s.notify);
  const runs = useCrm((s) => s.bonusRuns);
  const deferred = useCrm((s) => s.deferredBonuses);
  const outcomes = useCrm((s) => s.probationOutcomes);
  const members = useCrm((s) => s.initiativeMembers);
  const initiatives = useCrm((s) => s.initiatives);

  const me = users.find((u) => u.id === userId);
  const profile = profiles.find((p) => p.userId === userId);
  const switchable = canActAs(identity);

  const stats = useMemo(() => {
    const year = String(new Date().getFullYear());
    return {
      year,
      paid: paidInYear(userId, runs, year, deferred),
      deferred: deferred.filter((d) => d.userId === userId && d.status === "pending").reduce((s, d) => s + d.amount, 0),
      held: Math.max(0, probationBalance(userId, runs) - outcomes.filter((o) => o.userId === userId).reduce((s, o) => s + o.amount, 0)),
      live: new Set(members.filter((m) => m.userId === userId && isLiveMember(m) && m.consent !== "declined" && !ENDED.has(initiatives.find((i) => i.id === m.initiativeId)?.status ?? "rejected")).map((m) => m.initiativeId)).size,
    };
  }, [userId, runs, deferred, outcomes, members, initiatives]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="My compensation"
        meta={
          me ? (
            <span className="flex items-center gap-1.5 text-xs text-sg-muted">
              <Avatar user={me} size="xs" /> {me.name}
            </span>
          ) : null
        }
      >
        <Link href="/policy" className="inline-flex items-center gap-1 text-2xs text-sg-dim hover:text-sg-white">
          <BookOpen className="size-3.5" /> Policy v4.0
        </Link>
        {switchable ? (
          <Select
            aria-label="Acting as"
            value={userId}
            onChange={(e) => {
              actAs(e.target.value);
              notify(`Now acting as ${users.find((u) => u.id === e.target.value)?.name ?? e.target.value}`);
            }}
            wrapperClassName="w-56"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                Acting as {u.name}
              </option>
            ))}
          </Select>
        ) : (
          <Chip color="green" title={identity.email ?? undefined}>
            Signed in
          </Chip>
        )}
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        {!me ? (
          <EmptyState icon={UserX} title="No workspace user">
            The signed-in identity does not match a workspace user. Ask an admin to add you, or pick who to act as.
          </EmptyState>
        ) : (
          <div className="mx-auto max-w-[1240px] space-y-4">
            <div className="grid grid-cols-2 gap-4 rounded-xl border border-sg-line bg-sg-card px-4 py-3 md:grid-cols-4">
              <Metric label={`Paid in ${stats.year}`} value={<Money value={stats.paid} />} tone="green" hint="released runs + vested deferrals" />
              <Metric label="Deferred, not yet due" value={<Money value={stats.deferred} />} hint="§9.3" />
              <Metric label="Held during probation" value={<Money value={stats.held} />} tone={stats.held ? "yellow" : undefined} hint="§11.3" />
              <Metric label="Live project roles" value={stats.live} hint={me.title} />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <EligibilityCard profile={profile} />
              <AgreementCard user={me} profile={profile} />
              <CapacityCard userId={userId} />
            </div>

            <MyAmendments userId={userId} />
            <MyProjects userId={userId} />
            <CycleProjection userId={userId} />

            <div className="grid gap-4 lg:grid-cols-2">
              <DeferredList userId={userId} />
              {profile?.employmentType === "probationary" ? <ProbationCard userId={userId} profile={profile} /> : <MyClawbacks userId={userId} />}
            </div>
            {profile?.employmentType === "probationary" && <MyClawbacks userId={userId} />}

            <StatementHistory userId={userId} />
          </div>
        )}
      </div>
    </div>
  );
}

function EligibilityCard({ profile }: { profile: EmployeeProfile | undefined }) {
  const users = useCrm((s) => s.users);
  const result = useMemo(() => participationEligibility(profile), [profile]);
  const manager = users.find((u) => u.id === profile?.directManagerId);
  return (
    <Card
      title={
        <>
          Eligibility <Cite s="3.1" />
          <Cite s="3.2" />
        </>
      }
      action={
        result.ok ? (
          <Chip color={result.warnings.length ? "yellow" : "green"} dot>
            {result.warnings.length ? "Eligible · note" : "Eligible"}
          </Chip>
        ) : (
          <Chip color="red" dot>
            Not eligible for new roles
          </Chip>
        )
      }
    >
      {profile && (
        <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-2xs">
          <dt className="text-sg-dim">Employment</dt>
          <dd className="text-right font-semibold text-sg-white">{EMPLOYMENT_META[profile.employmentType].label}</dd>
          <dt className="text-sg-dim">Hired</dt>
          <dd className="text-right text-sg-text">{formatDate(profile.hireDate, "medium")}</dd>
          <dt className="text-sg-dim">Line manager</dt>
          <dd className="text-right text-sg-text">{manager?.name ?? "—"}</dd>
          {profile.governanceRoles.length > 0 && (
            <>
              <dt className="text-sg-dim">Governance</dt>
              <dd className="text-right font-semibold uppercase text-soft-cyan">{profile.governanceRoles.join(" · ").replace(/_/g, " ")}</dd>
            </>
          )}
        </dl>
      )}
      {result.blockers.length === 0 && result.warnings.length === 0 ? (
        <p className="flex gap-2 text-xs text-sg-text">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-soft-green" /> You may propose, join and lead projects, subject to line manager agreement on your time (§3.1, §7.1).
        </p>
      ) : (
        <ul className="space-y-1.5">
          {result.blockers.map((b) => (
            <li key={b} className="flex gap-2 text-xs text-sg-text">
              <CircleX className="mt-0.5 size-3.5 shrink-0 text-soft-red" /> {b}
            </li>
          ))}
          {result.warnings.map((w) => (
            <li key={w} className="flex gap-2 text-xs text-sg-text">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-soft-yellow" /> {w}
            </li>
          ))}
        </ul>
      )}
      {!result.ok && <p className="mt-2 text-2xs text-sg-dim">Bonuses you have already earned are still paid when due (§10).</p>}
    </Card>
  );
}

function CapacityCard({ userId }: { userId: string }) {
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const load = useMemo(() => leadershipLoad(userId, initiatives, members, { includePending: true }), [userId, initiatives, members]);
  const nonLead = useMemo(() => concurrentNonLeadRoles(userId, initiatives, members), [userId, initiatives, members]);
  const cap = POLICY.leadershipCapacity;
  const max = POLICY.maxConcurrentNonLeadRoles;
  const left = load.remaining;
  const canLead = [
    { type: "A" as const, n: Math.floor((left + 1e-9) / PROJECT_TYPE_META.A.capacityFactor) },
    { type: "B" as const, n: Math.floor((left + 1e-9) / PROJECT_TYPE_META.B.capacityFactor) },
    { type: "C" as const, n: Math.floor((left + 1e-9) / PROJECT_TYPE_META.C.capacityFactor) },
  ].filter((x) => x.n > 0);
  return (
    <Card
      title={
        <>
          Workload &amp; capacity <Cite s="7.3" />
          <Cite s="7.1" />
        </>
      }
    >
      <div className="sg-eyebrow">Leadership capacity</div>
      <div className="mt-1 flex items-center gap-3">
        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-sg-card-3" role="meter" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={load.used} aria-label="Leadership capacity used">
          <span className={cn("absolute inset-y-0 left-0", load.used > cap + 1e-9 ? "bg-soft-red" : load.used >= cap - 1e-9 ? "bg-soft-orange" : "bg-soft-cyan")} style={{ width: `${Math.min(100, (load.used / cap) * 100)}%` }} />
          {[0.25, 0.5, 0.75].map((f) => (
            <span key={f} className="absolute inset-y-0 w-px bg-sg-bg/60" style={{ left: `${f * 100}%` }} />
          ))}
        </div>
        <span className="sg-num text-sm font-bold text-sg-white">
          {load.used.toFixed(2)} <span className="text-2xs font-normal text-sg-dim">/ {cap.toFixed(1)}</span>
        </span>
      </div>
      {load.items.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {load.items.map((it) => (
            <li key={it.initiativeId} className="flex items-center gap-2 text-2xs">
              <Link href={`/initiatives/${it.initiativeId}`} className="min-w-0 flex-1 truncate text-sg-text hover:text-sg-white hover:underline">
                {initiatives.find((i) => i.id === it.initiativeId)?.title ?? it.initiativeId}
              </Link>
              <span className="text-sg-dim">{it.roles.map((r) => ROLE_META[r].label).join(" + ")}</span>
              <span className="sg-num w-16 text-right text-sg-muted">
                Type {it.type} · {it.factor}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-2xs text-sg-dim">No lead roles. PL + TL on the same project counts that project once.</p>
      )}
      <p className="mt-2 text-2xs text-sg-muted">{canLead.length ? `You can still lead ${canLead.map((c) => `${c.n} Type ${c.type}`).join(", or ")}.` : "Nothing more to lead until a lead role ends."}</p>

      <div className="mt-4 sg-eyebrow">Non-lead roles</div>
      <div className="mt-1 flex items-center gap-2">
        <div className="flex gap-1" aria-label={`${nonLead} of ${max} concurrent non-lead roles`}>
          {Array.from({ length: Math.max(max, nonLead) }, (_, i) => (
            <span key={i} className={cn("h-2 w-6 rounded-sm", i < nonLead ? (i >= max ? "bg-soft-red" : "bg-soft-cyan") : "bg-sg-card-3")} />
          ))}
        </div>
        <span className="sg-num text-xs font-semibold text-sg-white">
          {nonLead} / {max}
        </span>
      </div>
      <p className="mt-1 text-2xs text-sg-dim">Engineer, Secretary or Specialist roles on live projects. More than {max} needs line manager and PRC approval.</p>
    </Card>
  );
}
