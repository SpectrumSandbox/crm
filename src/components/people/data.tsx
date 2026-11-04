"use client";

/* Derived HR register rows for /people (Policy v4.0 §3, §7.1, §7.3, §9.3, §10, §11, §15.1). */
import { useMemo } from "react";
import { useCrm } from "@/lib/store";
import type { User, SpectrumColor } from "@/lib/types";
import type { EmployeeProfile, GovernanceRole, SeparationKind } from "@/lib/initiatives/types";
import { concurrentNonLeadRoles, leadershipLoad, maxAllocationFactor, paidInYear, participationEligibility, probationBalance, type EligibilityResult } from "@/lib/initiatives/engine";
import { EMPLOYMENT_META, POLICY_DATED } from "@/lib/initiatives/policy";

export const GOVERNANCE_META: Record<GovernanceRole, { label: string; title: string; color: SpectrumColor }> = {
  prc: { label: "PRC", title: "Project Review Committee member", color: "magenta" },
  ceo: { label: "CEO", title: "Chief Executive Officer — PRC chair, holds the veto (§13.1)", color: "magenta" },
  cfo: { label: "CFO", title: "Chief Financial Officer — certifies the break-even test and cash check (§9.1)", color: "yellow" },
  hr: { label: "HR", title: "Human Resources — verifies eligibility and status (§3.5)", color: "cyan" },
  finance: { label: "Finance", title: "Finance — calculates bonuses, issues statements (§13.2)", color: "yellow" },
  executive_committee: { label: "ExCo", title: "Executive Committee — decides appeals (§4.6, §14)", color: "blue" },
};

export const SEPARATION_LABEL: Record<SeparationKind, string> = {
  resignation: "Resignation",
  termination_for_cause: "Dismissal for a serious violation",
  termination_without_cause: "Termination on other grounds",
  contract_end: "End of fixed-term (PKWT) contract",
  retirement: "Retirement",
  death_disability: "Death or permanent disability",
  probation_failed: "Employment ended in probation",
  ineligible_status: "Move to an ineligible status",
};

/** Annex B signature state: missing → payments held (§15.1); signed before v4.0 was issued → re-sign the updated agreement. */
export type AnnexBState = "missing" | "pre_v4" | "signed";
export function annexBState(p: EmployeeProfile | undefined): AnnexBState | null {
  if (!p) return null;
  if (!p.acknowledgmentSignedAt) return "missing";
  return Date.parse(p.acknowledgmentSignedAt) < Date.parse(POLICY_DATED) ? "pre_v4" : "signed";
}

export interface PersonRow {
  user: User;
  profile: EmployeeProfile | undefined;
  eligibility: EligibilityResult;
  /** §7.1 concurrent non-lead roles (Engineer, Secretary, Specialist) on live projects */
  nonLeadRoles: number;
  leadership: number;
  ytdPaid: number;
  pendingDeferred: number;
  probation: number; // held balance not yet settled by an outcome
  probationary: boolean;
  separated: boolean;
  inNotice: boolean;
  annexB: AnnexBState | null;
  /** employee may take part (eligible employment type) and is still employed */
  participant: boolean;
  allocationCap: number;
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
      const settled = outcomes.filter((o) => o.userId === user.id).reduce((s, o) => s + o.amount, 0);
      const { separated, inNotice } = noticeState(profile, now);
      return {
        user,
        profile,
        eligibility: participationEligibility(profile),
        nonLeadRoles: concurrentNonLeadRoles(user.id, initiatives, members),
        leadership: leadershipLoad(user.id, initiatives, members, { includePending: true }).used,
        ytdPaid: paidInYear(user.id, bonusRuns, year, deferred),
        pendingDeferred: deferred.filter((d) => d.userId === user.id && d.status === "pending").reduce((s, d) => s + d.amount, 0),
        probation: Math.max(0, probationBalance(user.id, bonusRuns) - settled),
        probationary: profile?.employmentType === "probationary",
        separated,
        inNotice,
        annexB: annexBState(profile),
        participant: !!profile && EMPLOYMENT_META[profile.employmentType].eligible && !separated,
        allocationCap: maxAllocationFactor(profile),
      };
    });
  }, [users, profiles, initiatives, members, bonusRuns, deferred, outcomes]);
}
