"use client";

/* Derived HR register rows for /people (policy §1.2, §2.1, §4.5, §5.1, §6.2, §6.8). */
import { useMemo } from "react";
import { useCrm } from "@/lib/store";
import type { User, SpectrumColor } from "@/lib/types";
import type { EmployeeProfile, GovernanceRole, SeparationKind } from "@/lib/initiatives/types";
import { concurrentMemberships, leadershipLoad, paidInYear, participationEligibility, probationBalance, type EligibilityResult } from "@/lib/initiatives/engine";
import { POLICY } from "@/lib/initiatives/policy";

export const GOVERNANCE_META: Record<GovernanceRole, { label: string; title: string; color: SpectrumColor }> = {
  prc: { label: "PRC", title: "Project Review Committee member", color: "magenta" },
  ceo: { label: "CEO", title: "Chief Executive Officer", color: "magenta" },
  cfo: { label: "CFO", title: "Chief Financial Officer", color: "yellow" },
  hr: { label: "HR", title: "Human Resources", color: "cyan" },
  finance: { label: "Finance", title: "Finance department", color: "yellow" },
  executive_committee: { label: "ExCo", title: "Executive Committee", color: "blue" },
};

export const SEPARATION_LABEL: Record<SeparationKind, string> = {
  resignation: "Resignation",
  termination_for_cause: "Termination for cause",
  termination_without_cause: "Termination without cause",
  retirement: "Retirement",
  death_disability: "Death / permanent disability",
  probation_failed: "Probation not completed",
};

export interface PersonRow {
  user: User;
  profile: EmployeeProfile | undefined;
  eligibility: EligibilityResult;
  projects: number;
  leadership: number;
  ytdPaid: number;
  cap: number;
  capPct: number; // 0–1+
  pendingDeferred: number;
  probation: number; // outstanding accrual (withheld, not yet settled by an outcome)
  probationary: boolean;
  separated: boolean;
  inNotice: boolean;
}

export const currentYear = () => String(new Date().getFullYear());

/** Notice period: a resignation/termination notice or a future-dated separation that has not yet taken effect. */
export function noticeState(p: EmployeeProfile | undefined, nowMs = Date.now()) {
  if (!p) return { separated: false, inNotice: false };
  const separated = !!p.separation && Date.parse(p.separation.effectiveAt) <= nowMs;
  const inNotice = !separated && (!!p.resignationNoticeAt || !!p.terminationNoticeAt || !!p.separation);
  return { separated, inNotice };
}

export function usePeopleRows(): PersonRow[] {
  const users = useCrm((s) => s.users);
  const profiles = useCrm((s) => s.employeeProfiles);
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const deferred = useCrm((s) => s.deferredBonuses);
  const outcomes = useCrm((s) => s.probationOutcomes);

  return useMemo(() => {
    const year = currentYear();
    const now = Date.now();
    return users.map((user) => {
      const profile = profiles.find((p) => p.userId === user.id);
      const ytdPaid = paidInYear(user.id, bonusRuns, year, deferred);
      const cap = (profile?.annualBaseSalary ?? 0) * POLICY.personAnnualCapOfSalary;
      const settled = outcomes.filter((o) => o.userId === user.id).reduce((s, o) => s + o.amount, 0);
      const { separated, inNotice } = noticeState(profile, now);
      return {
        user,
        profile,
        eligibility: participationEligibility(profile),
        projects: concurrentMemberships(user.id, initiatives, members),
        leadership: leadershipLoad(user.id, initiatives, members, { includePending: true }).used,
        ytdPaid,
        cap,
        capPct: cap > 0 ? ytdPaid / cap : 0,
        pendingDeferred: deferred.filter((d) => d.userId === user.id && d.status === "pending").reduce((s, d) => s + d.amount, 0),
        probation: Math.max(0, probationBalance(user.id, bonusRuns) - settled),
        probationary: profile?.employmentType === "probationary",
        separated,
        inNotice,
      };
    });
  }, [users, profiles, initiatives, members, bonusRuns, deferred, outcomes]);
}
