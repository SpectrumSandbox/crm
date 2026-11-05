/* Pure helpers shared by /me and the notification centre (Policy v4.0). */
import { addBusinessDays, cycleMonth, isLiveMember, type ProjectRate } from "@/lib/initiatives/engine";
import { POLICY, POLICY_DATED, ROLE_META } from "@/lib/initiatives/policy";
import type { EmployeeProfile, InitiativeMember, ProjectRole, TeamAmendment } from "@/lib/initiatives/types";
import type { User } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

export const pct3 = (rate: number) => `${(rate * 100).toFixed(3)}%`;

/** §5.1 basis of a project's revenue-share rate, in words. */
export function rateBasis(r: ProjectRate) {
  switch (r.source) {
    case "fixed":
      return `Fixed by the PRC at approval · x = Rp${formatNumber(Math.round(r.x))}, ${r.months} month${r.months === 1 ? "" : "s"} (§5.1)`;
    case "v3_flat":
      return "v3.0 flat share kept (§15.1)";
    case "curve":
      return `Curve · x = Rp${formatNumber(Math.round(r.x))} projected annual net, ${r.months} contracted month${r.months === 1 ? "" : "s"} (§5.1)`;
    case "provisional":
      return "Provisional — enter the expected case to set the rate (§5.1)";
  }
}

export const rolesLabel = (roles: ProjectRole[]) => roles.map((r) => ROLE_META[r].label).join(" + ");

/** Distinct current voters on a project: live, signed, PRC-checked ledger rows (§6.8 step 2). */
export function currentVoters(members: InitiativeMember[], initiativeId: string, now = Date.now()) {
  return [...new Set(members.filter((m) => m.initiativeId === initiativeId && m.consent === "accepted" && m.prcApproved && (!m.leftAt || Date.parse(m.leftAt) > now)).map((m) => m.userId))];
}

/** May `userId` vote on this amendment? A person joining does not vote on their own admission (§6.8 step 4). */
export function canVote(a: TeamAmendment, members: InitiativeMember[], userId: string, now = Date.now()) {
  if (a.change.kind === "add" && a.change.userId === userId) return false;
  return currentVoters(members, a.initiativeId, now).includes(userId);
}

/** §6.8 vote window: 5 business days from circulation. */
export const voteDeadline = (a: TeamAmendment) => addBusinessDays(a.circulatedAt, POLICY.sla.amendmentVoteBusinessDays);

export function tallyOf(a: TeamAmendment, members: InitiativeMember[], now = Date.now()) {
  const joining = a.change.kind === "add" ? a.change.userId : undefined;
  const voters = currentVoters(members, a.initiativeId, now).filter((u) => u !== joining);
  const valid = a.votes.filter((v) => voters.includes(v.userId));
  return { voters: voters.length, for: valid.filter((v) => v.vote === "for").length, against: valid.filter((v) => v.vote === "against").length };
}

/** Plain-language description of a §6.8 amendment. */
export function describeAmendment(a: TeamAmendment, users: User[], members: InitiativeMember[]) {
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? id;
  const alloc = (f: number) => (f === 1 ? "" : ` at allocation ${f}`);
  const c = a.change;
  if (c.kind === "add") return `Add ${name(c.userId)} as ${rolesLabel(c.roles)}${c.weightOverride != null ? ` (agreed weight ${c.weightOverride})` : ""}${alloc(c.allocationFactor)}`;
  const m = members.find((x) => x.id === c.memberId);
  if (c.kind === "remove") return `Remove ${m ? name(m.userId) : "a member"}${m ? ` (${rolesLabel(m.roles)})` : ""} from the team`;
  return `Change ${m ? name(m.userId) : "a member"} to ${rolesLabel(c.roles)}${c.weightOverride != null ? ` (agreed weight ${c.weightOverride})` : ""}${alloc(c.allocationFactor)}`;
}

/** Annex B state: missing, signed for an earlier version (re-sign before the first v4.0 payment, §15.1), or current. */
export function annexBState(p: EmployeeProfile | undefined): "none" | "missing" | "stale" | "current" {
  if (!p) return "none";
  if (!p.acknowledgmentSignedAt) return "missing";
  return Date.parse(p.acknowledgmentSignedAt) < Date.parse(`${POLICY_DATED}T00:00:00+07:00`) ? "stale" : "current";
}

/** Members on my side: every ledger row of mine, newest first. */
export function myRows(members: InitiativeMember[], userId: string) {
  return members.filter((m) => m.userId === userId).sort((a, b) => b.joinedAt.localeCompare(a.joinedAt));
}

/** Salary cycle open today (§8.2): collections from the 21st belong to next month's cycle. */
export const currentCycle = (now = Date.now()) => cycleMonth(new Date(now).toISOString());

/** "2026-12" → "December 2026" */
export function cycleLabel(month: string, short = false) {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: short ? "short" : "long", year: "numeric", timeZone: "UTC" });
}

export { isLiveMember };
