"use client";

/* Candidate eligibility / capacity notices shared by the /projects and /initiatives team editors (rules: team-rules.ts). */
import { useMemo } from "react";
import { Ban, CircleAlert, TriangleAlert } from "lucide-react";
import { useCrm } from "@/lib/store";
import type { Initiative, ProjectRole } from "@/lib/initiatives/types";
import { candidateCheck, type CandidateCheck } from "@/lib/initiatives/team-rules";
import { POLICY } from "@/lib/initiatives/policy";
import { Cite } from "./shared";

export function useCandidateCheck(userId: string, roles: ProjectRole[], allocationFactor: number, initiative: Pick<Initiative, "id" | "type" | "endDate"> | undefined, effectiveIso?: string, excludeMemberId?: string): CandidateCheck | null {
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const profiles = useCrm((s) => s.employeeProfiles);
  return useMemo(
    () => (userId && initiative ? candidateCheck(userId, roles, allocationFactor, initiative, { initiatives, members: excludeMemberId ? members.filter((m) => m.id !== excludeMemberId) : members, profiles }, effectiveIso) : null),
    [userId, roles, allocationFactor, initiative, initiatives, members, profiles, effectiveIso, excludeMemberId],
  );
}

export function CandidateNotices({ check, ack, onAck }: { check: CandidateCheck | null; ack: boolean; onAck: (v: boolean) => void }) {
  if (!check) return null;
  return (
    <div className="space-y-2">
      {check.blockers.length > 0 && (
        <div className="rounded-lg border border-soft-red/40 bg-soft-red/10 p-2.5 text-xs text-soft-red" role="alert">
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <Ban className="size-3.5" /> Cannot take this role
            <Cite s="3.2" />
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
            <CircleAlert className="size-3.5" /> Probationary employee — bonuses held until probation ends
            <Cite s="11.3" />
          </div>
          <p className="text-sg-text">
            Bonuses are calculated normally but held, then paid as a Probation Completion Bonus within 30 days of confirmation. If employment ends in probation the held balance is paid with final pay, unless dismissed for a serious violation. In a Type C month with a top-up, the share is paid with salary (§8.6). The employee signs Annex C.
          </p>
          <label className="mt-2 flex cursor-pointer items-center gap-2 font-semibold text-sg-white">
            <input type="checkbox" checked={ack} onChange={(e) => onAck(e.target.checked)} className="size-3.5 accent-sg-white" />
            Annex C probationary acknowledgment signed
          </label>
        </div>
      )}
      {check.leadership && check.blockers.length === 0 && (
        <div className="flex items-center gap-2 text-2xs text-sg-dim">
          Leadership capacity after this role: <span className="sg-num font-semibold text-sg-muted">{check.capacity.after.toFixed(2)}</span> / {POLICY.leadershipCapacity.toFixed(1)}
          <Cite s="7.3" />
        </div>
      )}
    </div>
  );
}
