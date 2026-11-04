/* Demo data for the Project Initiative & Compensation module — filled in by the seed task. */
import type { AuditEntry, BonusRun, Clawback, DeferredBonus, EmployeeProfile, Initiative, InitiativeMember, ProbationOutcome, RevenueEntry, ShareAdjustment } from "./types";

export const employeeProfiles: EmployeeProfile[] = [];
export const initiatives: Initiative[] = [];
export const initiativeMembers: InitiativeMember[] = [];
export const revenueEntries: RevenueEntry[] = [];
export const bonusRuns: BonusRun[] = [];
export const deferredBonuses: DeferredBonus[] = [];
export const probationOutcomes: ProbationOutcome[] = [];
export const clawbacks: Clawback[] = [];
export const shareAdjustments: ShareAdjustment[] = [];
export const auditLog: AuditEntry[] = [];

export const initiativeSeed = {
  employeeProfiles,
  initiatives,
  initiativeMembers,
  revenueEntries,
  bonusRuns,
  deferredBonuses,
  probationOutcomes,
  clawbacks,
  shareAdjustments,
  auditLog,
};
