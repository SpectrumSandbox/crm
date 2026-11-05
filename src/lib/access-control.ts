"use client";

/*
 * Role-based access for personal data (Policy v4.0 §13.4, UU PDP): individual pay and status information is visible
 * only to Finance, HR, the PRC (CEO, CFO, COO…) and the employee concerned. Roles come from the HR record
 * (EmployeeProfile.governanceRoles) of the current user. The server enforces the same rule on the workspace
 * snapshot (see src/app/api/workspace); this module is the client-side gate for pages and components.
 */
import { useMemo } from "react";
import { useCrm } from "@/lib/store";
import type { EmployeeProfile, GovernanceRole } from "@/lib/initiatives/types";

export function rolesOf(userId: string, profiles: EmployeeProfile[]): GovernanceRole[] {
  return profiles.find((p) => p.userId === userId)?.governanceRoles ?? [];
}

const PAY_ROLES: GovernanceRole[] = ["finance", "hr", "prc", "cfo", "ceo", "executive_committee"];

export const can = {
  /** see every employee's pay, bonus lines, deferred/probation balances and clawbacks */
  seeAllPay: (r: GovernanceRole[]) => r.some((x) => PAY_ROLES.includes(x)),
  /** edit HR records, record separations, add people */
  manageHr: (r: GovernanceRole[]) => r.includes("hr") || r.includes("ceo"),
  /** enter finance figures and certify the break-even test / cash check (§8.2) */
  certify: (r: GovernanceRole[]) => r.includes("cfo") || r.includes("finance"),
  /** authorise release, decide proposals, ratify projects, break amendment ties (§13.1) */
  prc: (r: GovernanceRole[]) => r.includes("prc") || r.includes("ceo"),
  /** decide appeals (§4.6, §14) */
  executive: (r: GovernanceRole[]) => r.includes("executive_committee"),
  /** change workspace-wide settings: restore backups, reset data, admin seeding */
  admin: (r: GovernanceRole[]) => r.includes("ceo") || r.includes("cfo"),
};

/** Current user's governance roles and permission flags (derive-only; stable across renders). */
export function useAccess() {
  const currentUserId = useCrm((s) => s.currentUserId);
  const profiles = useCrm((s) => s.employeeProfiles);
  return useMemo(() => {
    const roles = rolesOf(currentUserId, profiles);
    return {
      userId: currentUserId,
      roles,
      seeAllPay: can.seeAllPay(roles),
      manageHr: can.manageHr(roles),
      certify: can.certify(roles),
      prc: can.prc(roles),
      executive: can.executive(roles),
      admin: can.admin(roles),
      /** may this viewer see the personal pay data of `userId`? */
      seePayOf: (userId: string) => userId === currentUserId || can.seeAllPay(roles),
    };
  }, [currentUserId, profiles]);
}
