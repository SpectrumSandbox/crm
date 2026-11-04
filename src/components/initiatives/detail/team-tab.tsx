"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Layers } from "lucide-react";
import { useCrm } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { Initiative } from "@/lib/initiatives/types";
import { isLiveMember, leadershipLoad } from "@/lib/initiatives/engine";
import { POLICY, PROJECT_TYPE_META, ROLE_META } from "@/lib/initiatives/policy";
import { cn } from "@/lib/utils";
import { Avatar, Chip } from "@/components/ui/misc";
import { TeamEditor } from "@/components/initiatives/team-editor";
import { CapacityMeter, RoleChips, StatusChip, TypeChip } from "@/components/initiatives/shared";
import { Card } from "./ui";

const LIVE = new Set(["approved", "active", "completed", "conditional"]);

export function TeamTab({ ini }: { ini: Initiative }) {
  return (
    <div className="space-y-4">
      <TeamEditor initiativeId={ini.id} mode={LIVE.has(ini.status) ? "live" : "proposal"} />
      <LeadershipCapacity ini={ini} />
    </div>
  );
}

function LeadershipCapacity({ ini }: { ini: Initiative }) {
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const userMap = useUserMap();

  const leads = useMemo(() => {
    const seen = new Set<string>();
    return members
      .filter((m) => m.initiativeId === ini.id && isLiveMember(m) && m.roles.some((r) => ROLE_META[r].leadership))
      .filter((m) => (seen.has(m.userId) ? false : (seen.add(m.userId), true)))
      .map((m) => {
        const load = leadershipLoad(m.userId, initiatives, members, { includePending: true });
        const countsHere = load.items.some((it) => it.initiativeId === ini.id);
        return { member: m, load, countsHere };
      });
  }, [ini.id, initiatives, members]);

  return (
    <Card title="Leadership capacity" icon={Layers} cite="7.3" bodyClassName="p-0">
      {leads.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-sg-dim">No Project Lead or Technical Lead on this project yet.</p>
      ) : (
        <div className="divide-y divide-sg-line">
          {leads.map(({ member, load, countsHere }) => {
            const u = userMap.get(member.userId);
            const over = load.used > POLICY.leadershipCapacity + 1e-9;
            return (
              <div key={member.userId} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar user={u} size="sm" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-sg-white">{u?.name ?? member.userId}</div>
                    <RoleChips roles={member.roles.filter((r) => ROLE_META[r].leadership)} />
                  </div>
                  <div className="ml-auto flex items-center gap-3">
                    <CapacityMeter userId={member.userId} />
                    {over ? <Chip color="red">Over 2.0 limit</Chip> : <Chip color="green">{load.remaining.toFixed(2)} remaining</Chip>}
                  </div>
                </div>
                <table className="mt-2 w-full text-xs">
                  <thead>
                    <tr className="text-left">
                      <th className="sg-eyebrow py-1 font-semibold">Project</th>
                      <th className="sg-eyebrow py-1 font-semibold">Type</th>
                      <th className="sg-eyebrow py-1 font-semibold">Lead role</th>
                      <th className="sg-eyebrow py-1 font-semibold">Status</th>
                      <th className="sg-eyebrow py-1 text-right font-semibold">Factor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {load.items.map((it) => {
                      const other = initiatives.find((x) => x.id === it.initiativeId);
                      return (
                        <tr key={it.initiativeId} className={cn("border-t border-sg-line/60", it.initiativeId === ini.id && "bg-sg-bg/40")}>
                          <td className="py-1.5 pr-2">
                            {it.initiativeId === ini.id ? (
                              <span className="font-semibold text-sg-white">This project</span>
                            ) : (
                              <Link href={`/initiatives/${it.initiativeId}`} className="text-sg-text hover:text-sg-white hover:underline">
                                {other?.code ?? other?.trackingNo ?? ""} {other?.title ?? it.initiativeId}
                              </Link>
                            )}
                          </td>
                          <td className="py-1.5 pr-2">
                            <TypeChip type={it.type} />
                          </td>
                          <td className="py-1.5 pr-2 text-sg-muted">{it.roles.map((r) => ROLE_META[r].label).join(" + ")}</td>
                          <td className="py-1.5 pr-2">{other ? <StatusChip status={other.status} /> : null}</td>
                          <td className="sg-num py-1.5 text-right text-sg-white">{it.factor.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                    {!countsHere ? (
                      <tr className="border-t border-sg-line/60 bg-sg-bg/40">
                        <td className="py-1.5 pr-2 font-semibold text-sg-white">This project</td>
                        <td className="py-1.5 pr-2">
                          <TypeChip type={ini.type} />
                        </td>
                        <td className="py-1.5 pr-2 text-sg-muted">{member.roles.filter((r) => ROLE_META[r].leadership).map((r) => ROLE_META[r].label).join(" + ")}</td>
                        <td className="py-1.5 pr-2 text-2xs text-sg-dim">counts once submitted</td>
                        <td className="sg-num py-1.5 text-right text-sg-dim">+{PROJECT_TYPE_META[ini.type].capacityFactor.toFixed(2)}</td>
                      </tr>
                    ) : null}
                    <tr className="border-t border-sg-line">
                      <td colSpan={4} className="py-1.5 text-right font-semibold text-sg-muted">
                        Total of {POLICY.leadershipCapacity.toFixed(1)}
                      </td>
                      <td className={cn("sg-num py-1.5 text-right font-semibold", over ? "text-soft-red" : "text-sg-white")}>{load.used.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
      <p className="border-t border-sg-line px-4 py-2 text-2xs text-sg-dim">
        Capacity factors: Type A 0.25 · Type B 0.5 · Type C 1.0; the total may not exceed 2.0 at any time. Holding both lead roles on one project counts once. Includes projects awaiting PRC review. Lead roles also count toward the time agreed with the line manager (§7.1).
      </p>
    </Card>
  );
}
