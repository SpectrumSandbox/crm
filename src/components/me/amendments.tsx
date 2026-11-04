"use client";

/* /me — §6.8 amendments to roles and weights on my projects: vote for / against, see ties awaiting the PRC. */
import { useMemo } from "react";
import Link from "next/link";
import { Check, Scale, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { TeamAmendment } from "@/lib/initiatives/types";
import { cn, formatDate, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/misc";
import { Cite } from "@/components/initiatives/shared";
import { canVote, currentVoters, describeAmendment, tallyOf, voteDeadline } from "./helpers";
import { Card } from "./ui";

export function MyAmendments({ userId }: { userId: string }) {
  const amendments = useCrm((s) => s.teamAmendments);
  const members = useCrm((s) => s.initiativeMembers);
  const users = useCrm((s) => s.users);
  const initiatives = useCrm((s) => s.initiatives);
  const voteAmendment = useCrm((s) => s.voteAmendment);
  const notify = useUi((s) => s.notify);

  const { open, tied } = useMemo(() => {
    const now = Date.now();
    const onMyTeam = (a: TeamAmendment) => currentVoters(members, a.initiativeId, now).includes(userId);
    return {
      open: amendments.filter((a) => a.status === "open" && canVote(a, members, userId, now)).sort((a, b) => voteDeadline(a).localeCompare(voteDeadline(b))),
      tied: amendments.filter((a) => a.status === "tied" && !a.prcDecision && onMyTeam(a)),
    };
  }, [amendments, members, userId]);

  if (!open.length && !tied.length) return null;
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? id;

  return (
    <Card
      title={
        <>
          Team amendments <Cite s="6.8" />
        </>
      }
      action={<span className="text-2xs text-sg-dim">One vote per current member; passes with more than half within 5 business days</span>}
    >
      <ul className="space-y-3">
        {open.map((a) => {
          const mine = a.votes.find((v) => v.userId === userId)?.vote;
          const t = tallyOf(a, members);
          const due = voteDeadline(a);
          const late = Date.parse(due) < Date.now();
          const ini = initiatives.find((i) => i.id === a.initiativeId);
          return (
            <li key={a.id} className="rounded-lg border border-sg-line bg-sg-bg/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/initiatives/${a.initiativeId}`} className="text-xs font-semibold text-sg-white hover:underline">
                  {ini?.title ?? "Project"}
                </Link>
                <Chip color={late ? "red" : "yellow"}>{late ? "Vote window closed" : `Vote by ${formatDate(due, "medium")}`}</Chip>
                {mine && <Chip color={mine === "for" ? "green" : "red"}>You voted {mine}</Chip>}
              </div>
              <p className="mt-1 text-xs text-sg-text">{describeAmendment(a, users, members)}</p>
              <p className="mt-0.5 text-2xs text-sg-dim">
                Effective {formatDate(a.effectiveDate, "medium")} · proposed by {name(a.proposedById)} {relativeTime(a.circulatedAt)}
                {a.reason ? ` · “${a.reason}”` : ""}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="flex h-1.5 w-32 overflow-hidden rounded-full bg-sg-card-3" title={`${t.for} for · ${t.against} against · ${t.voters - t.for - t.against} not voted`}>
                  <span className="bg-soft-green" style={{ width: `${t.voters ? (t.for / t.voters) * 100 : 0}%` }} />
                  <span className="bg-soft-red" style={{ width: `${t.voters ? (t.against / t.voters) * 100 : 0}%` }} />
                </div>
                <span className="sg-num text-2xs text-sg-muted">
                  {t.for} for · {t.against} against · {t.voters} voter{t.voters === 1 ? "" : "s"} (needs {Math.floor(t.voters / 2) + 1})
                </span>
                <span className="ml-auto flex gap-1.5">
                  <Button
                    size="xs"
                    variant={mine === "for" ? "subtle" : "primary"}
                    disabled={mine === "for"}
                    onClick={() => {
                      voteAmendment(a.id, "for", userId);
                      notify("Voted for the amendment (§6.8)");
                    }}
                  >
                    <Check /> For
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={mine === "against"}
                    className={cn(mine === "against" && "opacity-40")}
                    onClick={() => {
                      voteAmendment(a.id, "against", userId);
                      notify("Voted against the amendment (§6.8)");
                    }}
                  >
                    <X /> Against
                  </Button>
                </span>
              </div>
              {a.change.kind === "remove" && members.find((m) => m.id === (a.change as { memberId: string }).memberId)?.userId === userId && (
                <p className="mt-1.5 text-2xs text-soft-yellow">This removes your own role. If it passes over your vote against, you may appeal to the PRC (§6.8, §14).</p>
              )}
            </li>
          );
        })}
        {tied.map((a) => (
          <li key={a.id} className="flex items-start gap-2 rounded-lg border border-soft-orange/30 bg-soft-orange/[0.05] p-3 text-xs">
            <Scale className="mt-0.5 size-3.5 shrink-0 text-soft-orange" />
            <div>
              <span className="font-semibold text-sg-white">{initiatives.find((i) => i.id === a.initiativeId)?.title ?? "Project"}</span> — tied vote. The PRC casts the deciding vote within 5 business days.
              <div className="mt-0.5 text-2xs text-sg-dim">{describeAmendment(a, users, members)}</div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
