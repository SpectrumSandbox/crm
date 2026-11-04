"use client";

/* Per-employee bonus statement (§6.8 monthly statement for probationers) and project memberships. */
import { useMemo } from "react";
import Link from "next/link";
import { useCrm } from "@/lib/store";
import type { BonusLine, BonusRun, LineStatus } from "@/lib/initiatives/types";
import { isLiveMember, memberWeight, paymentDate } from "@/lib/initiatives/engine";
import type { SpectrumColor } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { Chip } from "@/components/ui/misc";
import { Cite, Money, RoleChips, StatusChip, TypeChip } from "@/components/initiatives/shared";
import { Block } from "./fields";

const LINE_STATUS: Record<LineStatus, { label: string; color: SpectrumColor }> = {
  payable: { label: "Payable", color: "green" },
  partially_deferred: { label: "Part deferred", color: "cyan" },
  withheld_probation: { label: "Probation accrual", color: "yellow" },
  forfeited: { label: "Forfeited", color: "red" },
  held: { label: "Held", color: "orange" },
  cap_review: { label: "Cap review", color: "orange" },
  ineligible: { label: "Ineligible", color: "red" },
};
const RUN_STATUS: Record<BonusRun["status"], { label: string; color: SpectrumColor }> = {
  draft: { label: "Draft", color: "blue" },
  failed: { label: "Failed test", color: "red" },
  certified: { label: "Certified", color: "cyan" },
  released: { label: "Released", color: "green" },
};
const DEFERRED_STATUS = { pending: { label: "Pending", color: "yellow" }, released: { label: "Released", color: "green" }, forfeited: { label: "Forfeited", color: "red" } } as const;

export function BonusStatement({ userId, probationary }: { userId: string; probationary: boolean }) {
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const deferredBonuses = useCrm((s) => s.deferredBonuses);
  const initiatives = useCrm((s) => s.initiatives);
  const outcomes = useCrm((s) => s.probationOutcomes);

  const { lines, deferred, totals, myOutcomes } = useMemo(() => {
    const lines: { run: BonusRun; line: BonusLine }[] = [];
    for (const run of bonusRuns) for (const line of run.lines) if (line.userId === userId) lines.push({ run, line });
    lines.sort((a, b) => b.run.month.localeCompare(a.run.month));
    const deferred = deferredBonuses.filter((d) => d.userId === userId).sort((a, b) => a.vestAt.localeCompare(b.vestAt));
    const sum = (k: "gross" | "payable" | "deferred" | "withheld" | "forfeited" | "held" | "carriedOver") => lines.reduce((s, x) => s + x.line[k], 0);
    return {
      lines,
      deferred,
      totals: { gross: sum("gross"), payable: sum("payable"), deferred: sum("deferred") + sum("carriedOver"), withheld: sum("withheld"), forfeited: sum("forfeited"), held: sum("held") },
      myOutcomes: outcomes.filter((o) => o.userId === userId),
    };
  }, [bonusRuns, deferredBonuses, outcomes, userId]);

  const label = (id: string) => {
    const i = initiatives.find((x) => x.id === id);
    return i ? (i.code ?? i.trackingNo) || i.title : id;
  };

  return (
    <Block
      title={
        <>
          Bonus statement {probationary && <Cite s="6.8" />}
          <Cite s="6.1" />
        </>
      }
      action={probationary ? <span className="text-2xs text-soft-yellow">Monthly probation statement — accrued, not paid</span> : undefined}
    >
      {lines.length ? (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-[0.1em] text-sg-dim">
                <th className="px-4 py-1.5 font-semibold">Month</th>
                <th className="px-2 py-1.5 font-semibold">Project</th>
                <th className="px-2 py-1.5 text-right font-semibold">Gross</th>
                <th className="px-2 py-1.5 text-right font-semibold">Payable</th>
                <th className="px-2 py-1.5 text-right font-semibold">Deferred</th>
                <th className="px-2 py-1.5 text-right font-semibold">Withheld</th>
                <th className="px-2 py-1.5 text-right font-semibold">Forfeited</th>
                <th className="px-4 py-1.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(({ run, line }) => (
                <tr key={`${run.id}-${line.initiativeId}`} className="border-b border-sg-line align-top last:border-b-0">
                  <td className="px-4 py-1.5">
                    <div className="sg-num font-semibold text-sg-white">{run.month}</div>
                    <Chip color={RUN_STATUS[run.status].color} className="mt-0.5">
                      {RUN_STATUS[run.status].label}
                    </Chip>
                  </td>
                  <td className="px-2 py-1.5">
                    <Link href={`/initiatives/${line.initiativeId}`} className="font-semibold text-sg-text hover:text-sg-white hover:underline">
                      {label(line.initiativeId)}
                    </Link>
                    <div className="text-2xs text-sg-dim">
                      w {line.weight.toFixed(2)} / {line.totalWeight.toFixed(2)} · pays {formatDate(paymentDate(run.month), "short")}
                    </div>
                    {line.notes.length > 0 && <div className="mt-0.5 max-w-[240px] text-2xs text-sg-dim">{line.notes.join(" · ")}</div>}
                  </td>
                  <Num v={line.gross} strong />
                  <Num v={line.payable} tone="text-soft-green" />
                  <Num v={line.deferred + line.carriedOver} tone="text-soft-cyan" />
                  <Num v={line.withheld} tone="text-soft-yellow" />
                  <Num v={line.forfeited} tone="text-soft-red" />
                  <td className="px-4 py-1.5">
                    <Chip color={LINE_STATUS[line.status].color}>{LINE_STATUS[line.status].label}</Chip>
                    {line.held > 0 && (
                      <div className="mt-0.5 text-2xs text-soft-orange">
                        Held <Money value={line.held} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-sg-line-2 bg-sg-bg/40">
                <td className="px-4 py-1.5 text-2xs font-semibold uppercase tracking-wider text-sg-dim" colSpan={2}>
                  Total · {lines.length} line{lines.length === 1 ? "" : "s"}
                </td>
                <Num v={totals.gross} strong />
                <Num v={totals.payable} tone="text-soft-green" />
                <Num v={totals.deferred} tone="text-soft-cyan" />
                <Num v={totals.withheld} tone="text-soft-yellow" />
                <Num v={totals.forfeited} tone="text-soft-red" />
                <td className="px-4 py-1.5 text-2xs text-soft-orange">{totals.held > 0 ? <>Held <Money value={totals.held} /></> : null}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="text-xs text-sg-dim">No bonus lines in any monthly run yet.</p>
      )}

      {myOutcomes.length > 0 && (
        <div className="mt-3 space-y-1">
          {myOutcomes.map((o, i) => (
            <div key={i} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-xs", o.outcome === "completed" ? "bg-soft-green/10 text-soft-green" : "bg-soft-red/10 text-soft-red")}>
              {o.outcome === "completed" ? "Probation completed — completion bonus payable within 30 days" : "Probation accrual forfeited"} · <Money value={o.amount} className="font-semibold" />
              <span className="ml-auto text-2xs text-sg-dim">{formatDate(o.decidedAt)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        <div className="sg-eyebrow mb-1.5 flex items-center">
          Deferred bonuses <Cite s="6.3" />
        </div>
        {deferred.length ? (
          <ul className="divide-y divide-sg-line rounded-md border border-sg-line">
            {deferred.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                <div className="min-w-0 flex-1">
                  <Link href={`/initiatives/${d.initiativeId}`} className="font-semibold text-sg-text hover:text-sg-white hover:underline">
                    {label(d.initiativeId)}
                  </Link>
                  <span className="text-sg-dim"> · from {d.month}</span>
                  <div className="truncate text-2xs text-sg-dim">{d.note}</div>
                </div>
                <div className="text-right">
                  <Money value={d.status === "released" ? d.releasedAmount : d.amount} className={cn("font-semibold", d.status === "forfeited" ? "text-soft-red line-through" : "text-sg-white")} />
                  <div className="text-2xs text-sg-dim">vests {formatDate(d.vestAt)}</div>
                </div>
                <Chip color={DEFERRED_STATUS[d.status].color}>{DEFERRED_STATUS[d.status].label}</Chip>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-sg-dim">No deferred bonuses.</p>
        )}
      </div>
    </Block>
  );
}

function Num({ v, tone, strong }: { v: number; tone?: string; strong?: boolean }) {
  return <td className="px-2 py-1.5 text-right">{v > 0.5 ? <Money value={v} className={cn(strong ? "font-semibold text-sg-white" : tone)} /> : <span className="text-sg-dim">—</span>}</td>;
}

export function Memberships({ userId }: { userId: string }) {
  const members = useCrm((s) => s.initiativeMembers);
  const initiatives = useCrm((s) => s.initiatives);
  const rows = useMemo(
    () =>
      members
        .filter((m) => m.userId === userId)
        .map((m) => ({ m, ini: initiatives.find((i) => i.id === m.initiativeId) }))
        .filter((x) => x.ini)
        .sort((a, b) => Number(isLiveMember(b.m)) - Number(isLiveMember(a.m)) || b.m.joinedAt.localeCompare(a.m.joinedAt)),
    [members, initiatives, userId],
  );
  return (
    <Block
      title={
        <>
          Project memberships <Cite s="5.1" />
        </>
      }
    >
      {rows.length ? (
        <ul className="space-y-1.5">
          {rows.map(({ m, ini }) => {
            const live = isLiveMember(m);
            return (
              <li key={m.id} className={cn("rounded-md border border-sg-line bg-sg-bg/40 p-2.5", !live && "opacity-60")}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <Link href={`/initiatives/${ini!.id}`} className="text-sm font-semibold text-sg-white hover:underline">
                      <span className="mr-1.5 text-sg-muted">{ini!.code ?? ini!.trackingNo}</span>
                      {ini!.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <RoleChips roles={m.roles} />
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusChip status={ini!.status} />
                    <TypeChip type={ini!.type} />
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-sg-dim">
                  <span>
                    Weight <span className="sg-num font-semibold text-sg-text">{memberWeight(m).toFixed(2)}</span>
                    {m.weightOverride != null ? " (PRC override)" : ""}
                  </span>
                  <span>{m.allocationPct}% time</span>
                  <span className={cn(m.consent === "accepted" ? "text-soft-green" : m.consent === "declined" ? "text-soft-red" : "text-soft-yellow")}>Consent {m.consent}</span>
                  <span className={m.prcApproved ? "text-soft-green" : "text-soft-yellow"}>{m.prcApproved ? "PRC approved" : "Awaiting PRC"}</span>
                  {m.removal.stage !== "none" && <span className="text-soft-red">Removal: {m.removal.stage}</span>}
                  <span className="ml-auto">
                    joined {formatDate(m.joinedAt)}
                    {m.leftAt ? ` · left ${formatDate(m.leftAt)}` : ""}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-sg-dim">Not a member of any initiative.</p>
      )}
    </Block>
  );
}
