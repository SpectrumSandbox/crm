"use client";

import { useMemo } from "react";
import { ClipboardList } from "lucide-react";
import { useCrm } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { AuditEntry, Initiative } from "@/lib/initiatives/types";
import { formatDate, relativeTime } from "@/lib/utils";
import type { SpectrumColor } from "@/lib/types";
import { Avatar, Chip, EmptyState } from "@/components/ui/misc";
import { Card } from "./ui";

const entityColor: Record<AuditEntry["entity"], SpectrumColor> = {
  initiative: "cyan",
  member: "magenta",
  amendment: "yellow",
  run: "green",
  deferred: "orange",
  probation: "yellow",
  clawback: "red",
  employee: "blue",
  policy: "blue",
};

/** §13.3 records — every state change on this initiative, its ledger rows and its amendments. */
export function ActivityTab({ ini }: { ini: Initiative }) {
  const auditLog = useCrm((s) => s.auditLog);
  const members = useCrm((s) => s.initiativeMembers);
  const amendments = useCrm((s) => s.teamAmendments);
  const userMap = useUserMap();

  const entries = useMemo(() => {
    const memberUser = new Map(members.filter((m) => m.initiativeId === ini.id).map((m) => [m.id, m.userId] as const));
    const amendmentIds = new Set(amendments.filter((a) => a.initiativeId === ini.id).map((a) => a.id));
    return auditLog
      .filter((a) => a.entityId === ini.id || memberUser.has(a.entityId) || amendmentIds.has(a.entityId))
      .map((a) => ({ a, subjectUserId: memberUser.get(a.entityId) }))
      .sort((x, y) => y.a.at.localeCompare(x.a.at));
  }, [auditLog, members, amendments, ini.id]);

  return (
    <Card title="Audit trail" icon={ClipboardList} cite="13.3" actions={<span className="text-2xs text-sg-muted">{entries.length} entries</span>} bodyClassName="p-0">
      {entries.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No recorded activity yet">
          Every submission, review step, decision, ledger change, amendment vote and client payment is logged here with who acted and when.
        </EmptyState>
      ) : (
        <ol className="divide-y divide-sg-line/60">
          {entries.map(({ a, subjectUserId }) => {
            const actor = userMap.get(a.actorId);
            const subject = subjectUserId ? userMap.get(subjectUserId) : undefined;
            return (
              <li key={a.id} className="flex items-start gap-3 px-4 py-2.5">
                <Avatar user={actor} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <span className="font-semibold text-sg-white">{actor?.name ?? a.actorId}</span>
                    <span className="text-sg-text">{a.action}</span>
                    {subject ? (
                      <span className="inline-flex items-center gap-1 text-xs text-sg-muted">
                        · <Avatar user={subject} size="xs" /> {subject.name}
                      </span>
                    ) : null}
                    <Chip color={entityColor[a.entity] ?? "blue"} className="ml-auto">
                      {a.entity}
                    </Chip>
                  </div>
                  {a.detail ? <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-sg-muted">{a.detail}</p> : null}
                </div>
                <time dateTime={a.at} title={formatDate(a.at, "datetime")} className="sg-num shrink-0 pt-0.5 text-right text-2xs text-sg-dim">
                  {formatDate(a.at, "datetime")}
                  <span className="block">{relativeTime(a.at)}</span>
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
