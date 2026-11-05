"use client";

/* /me — my projects & roles (§6, §7) and this cycle's projected bonus (§8, before the §9.1 test). */
import { useMemo } from "react";
import Link from "next/link";
import { Check, Info, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import {
  allocationFactorOf,
  approvalTier,
  carriedForward,
  collectionWindow,
  computeRun,
  cycleDates,
  effectiveWeight,
  isLiveMember,
  memberWeight,
  paymentDate,
  projectRate,
  topUpBalance,
} from "@/lib/initiatives/engine";
import { POLICY, TIER_META } from "@/lib/initiatives/policy";
import type { Initiative, InitiativeMember } from "@/lib/initiatives/types";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState } from "@/components/ui/misc";
import { Cite, RoleChips, StatusChip, TypeChip } from "@/components/initiatives/shared";
import { RaiseDisputeButton } from "./disputes";
import { currentCycle, cycleLabel, pct3, rateBasis } from "./helpers";
import { Card, NumCell, RpFull, SampleChip, TH, THEAD_ROW } from "./ui";

const projectLabel = (i: Initiative) => i.code || i.trackingNo || "Draft";
/** statuses after which a role no longer counts as live */
export const ENDED = new Set<Initiative["status"]>(["rejected", "completed"]);
/** statuses in which the Team Allocation Ledger is in force (after PRC approval) */
const LEDGER = new Set<Initiative["status"]>(["approved", "active", "completed"]);

interface ProjectRow {
  ini: Initiative;
  row: InitiativeMember;
  rows: InitiativeMember[];
  live: boolean;
  w: number;
  a: number;
  eff: number;
  share: number;
  rate: ReturnType<typeof projectRate>;
  tier: 1 | 2 | 3;
  topUp: number | null;
}

export function MyProjects({ userId }: { userId: string }) {
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const entries = useCrm((s) => s.revenueEntries);
  const profiles = useCrm((s) => s.employeeProfiles);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const setConsent = useCrm((s) => s.setConsent);
  const notify = useUi((s) => s.notify);
  // §8.2 the salary cycle open today (21st → 20th), not the calendar month
  const month = useMemo(() => currentCycle(), []);

  const rows = useMemo<ProjectRow[]>(() => {
    const mine = members.filter((m) => m.userId === userId);
    const byIni = new Map<string, InitiativeMember[]>();
    for (const m of mine) byIni.set(m.initiativeId, [...(byIni.get(m.initiativeId) ?? []), m]);
    const out: ProjectRow[] = [];
    for (const [iniId, rs] of byIni) {
      const ini = initiatives.find((i) => i.id === iniId);
      if (!ini) continue;
      const sorted = [...rs].sort((x, y) => y.joinedAt.localeCompare(x.joinedAt));
      const ended = ENDED.has(ini.status);
      const liveRow = ended ? undefined : sorted.find((m) => isLiveMember(m) && m.consent !== "declined");
      const row = liveRow ?? sorted[0];
      // §6.6 share of a full-period pool: my W × A over the team's Σ W × A — the proposed team before approval,
      // the agreed and PRC-checked ledger rows after it (mine counted as if agreed)
      const proposed = !LEDGER.has(ini.status);
      const team = new Map<string, number>();
      for (const m of members) {
        if (m.initiativeId !== iniId || !isLiveMember(m) || m.consent === "declined") continue;
        if (m.userId !== userId && !proposed && !(m.consent === "accepted" && m.prcApproved)) continue;
        team.set(m.userId, Math.max(team.get(m.userId) ?? 0, effectiveWeight(m)));
      }
      const eff = effectiveWeight(row);
      if (!team.has(userId) && liveRow) team.set(userId, eff);
      const total = [...team.values()].reduce((s, v) => s + v, 0);
      out.push({
        ini,
        row,
        rows: sorted,
        live: !!liveRow,
        w: memberWeight(row),
        a: allocationFactorOf(row),
        eff,
        share: liveRow && total > 0 ? eff / total : 0,
        rate: projectRate(ini, adjustments),
        tier: approvalTier(ini).tier,
        topUp: ini.type === "C" ? topUpBalance(userId, ini, { members, entries, profiles, adjustments }, month) : null,
      });
    }
    return out.sort((x, y) => Number(y.live) - Number(x.live) || x.ini.title.localeCompare(y.ini.title));
  }, [members, initiatives, entries, profiles, adjustments, userId, month]);

  const sign = (m: InitiativeMember, consent: "accepted" | "declined") => {
    setConsent(m.id, consent);
    notify(consent === "accepted" ? "Role and Weight Agreement signed (§6.7)" : "Role declined", { label: "Undo", run: () => setConsent(m.id, "pending") });
  };

  return (
    <Card
      title={
        <>
          My projects &amp; roles <Cite s="6.1" />
          <Cite s="6.4" />
          <Cite s="5.1" />
        </>
      }
      action={<span className="text-2xs text-sg-dim">{rows.filter((r) => r.live).length} live · {rows.length} total</span>}
    >
      {rows.length === 0 ? (
        <EmptyState title="No project roles yet">
          Propose a project or ask a Project Lead to add you by amendment (§6.8).{" "}
          <Link href="/initiatives" className="text-soft-cyan hover:underline">
            Browse initiatives
          </Link>
        </EmptyState>
      ) : (
        <div className="-mx-4 -my-4 overflow-x-auto">
          <table className="w-full min-w-[980px] text-xs">
            <thead>
              <tr className={THEAD_ROW}>
                <th className={cn(TH, "pl-4")}>Project</th>
                <th className={TH}>My roles</th>
                <th className={cn(TH, "text-right")} title="Combined role weight (§6.1–6.3)">
                  W
                </th>
                <th className={cn(TH, "text-right")} title="Allocation factor (§6.4)">
                  A
                </th>
                <th className={cn(TH, "text-right")} title="Effective weight W × A (§6.6)">
                  W × A
                </th>
                <th className={cn(TH, "text-right")} title="My share of a full-period pool with the team as it is now (§6.6)">
                  Share of pool
                </th>
                <th className={TH}>Tier</th>
                <th className={cn(TH, "text-right")}>Rate y</th>
                <th className={TH}>Status</th>
                <th className={cn(TH, "text-right")} title="Type C top-ups still to deduct from my later bonuses on the project (§8.6)">
                  Top-up balance
                </th>
                <th className={cn(TH, "pr-4")}>Agreement</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ini.id} className={cn("border-b border-sg-line align-top last:border-b-0", !r.live && "opacity-60")}>
                  <td className="py-2 pl-4 pr-2">
                    <Link href={`/initiatives/${r.ini.id}`} className="font-semibold text-sg-white hover:underline">
                      {r.ini.title}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      <span className="sg-num text-2xs text-sg-dim">{projectLabel(r.ini)}</span>
                      <TypeChip type={r.ini.type} />
                      {r.ini.demo && <SampleChip />}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <RoleChips roles={r.row.roles} />
                    <div className="mt-0.5 text-2xs text-sg-dim">
                      {r.live ? `on team since ${formatDate(r.row.joinedAt, "medium")}` : r.rows.some((m) => m.leftAt) ? `left ${formatDate(r.rows.find((m) => m.leftAt)?.leftAt, "medium")}` : `project ${r.ini.status}`}
                      {r.rows.length > 1 ? ` · ${r.rows.length} ledger rows` : ""}
                    </div>
                  </td>
                  <td className="sg-num px-2 py-2 text-right text-sg-text">{r.w.toFixed(2)}</td>
                  <td className="sg-num px-2 py-2 text-right text-sg-text">{r.a.toFixed(2)}</td>
                  <td className="sg-num px-2 py-2 text-right font-semibold text-sg-white">{r.eff.toFixed(2)}</td>
                  <td className="sg-num px-2 py-2 text-right text-sg-white">{r.live ? `${(r.share * 100).toFixed(1)}%` : "—"}</td>
                  <td className="px-2 py-2 text-sg-text" title={TIER_META[r.tier].label}>
                    Tier {r.tier}
                  </td>
                  <td className="px-2 py-2 text-right" title={rateBasis(r.rate)}>
                    <div className="sg-num font-semibold text-sg-white">{pct3(r.rate.rate)}</div>
                    <div className="max-w-[180px] text-2xs leading-tight text-sg-dim">{r.rate.source === "v3_flat" ? "v3.0 flat share kept (§15.1)" : r.rate.source === "provisional" ? "provisional — enter the expected case" : r.rate.source === "fixed" ? "fixed by the PRC" : "curve (expected case)"}</div>
                  </td>
                  <td className="px-2 py-2">
                    <StatusChip status={r.ini.status} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    {r.topUp == null ? <span className="text-2xs text-sg-dim">n/a</span> : r.topUp > 0 ? <RpFull value={r.topUp} className="text-soft-yellow" /> : <span className="text-sg-dim">Rp 0</span>}
                  </td>
                  <td className="py-2 pl-2 pr-4">
                    {r.row.consent === "pending" && r.live ? (
                      <div className="flex gap-1">
                        <Button size="xs" variant="primary" onClick={() => sign(r.row, "accepted")}>
                          <Check /> Sign
                        </Button>
                        <Button size="xs" variant="danger" onClick={() => sign(r.row, "declined")} aria-label="Decline this role">
                          <X />
                        </Button>
                      </div>
                    ) : r.row.consent === "declined" ? (
                      <Chip color="red">Declined</Chip>
                    ) : (
                      <div className="space-y-0.5">
                        <Chip color="green">Signed</Chip>
                        {r.live && !r.row.prcApproved && <div className="text-2xs text-soft-yellow">{r.ini.status === "draft" ? "Submit the proposal first — the PRC checks the team after submission (§4.5, §6.7)" : "Awaiting PRC check (§6.7)"}</div>}
                        {r.live && !r.row.managerApproved && <div className="text-2xs text-soft-yellow">Line manager agreement pending (§3.1)</div>}
                      </div>
                    )}
                    {LEDGER.has(r.ini.status) && r.row.consent !== "pending" && (
                      <RaiseDisputeButton
                        className="mt-1 -ml-1.5"
                        label="Dispute ledger"
                        prefill={{
                          category: "ledger",
                          subject: `Ledger entry — ${r.ini.title}`,
                          initiativeId: r.ini.id,
                          lineRef: `member:${r.row.id}`,
                          eventAt: r.row.joinedAt,
                          source: `${r.ini.title} · ${r.row.roles.join(" + ").replace(/_/g, " ")} · W ${r.w.toFixed(2)} × A ${r.a.toFixed(2)} · from ${formatDate(r.row.joinedAt, "medium")}`,
                        }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ───────────────────────── this cycle's projection ───────────────────────── */

const GENEROUS = { companyRevenue: 1e15, directCosts: 0, overheads: 0, cash: 1e15, fixedCostsMonthly: 0 };

export function CycleProjection({ userId }: { userId: string }) {
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const entries = useCrm((s) => s.revenueEntries);
  const profiles = useCrm((s) => s.employeeProfiles);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const runs = useCrm((s) => s.bonusRuns);
  const month = useMemo(() => currentCycle(), []);

  const data = useMemo(() => {
    const myIni = new Set(members.filter((m) => m.userId === userId).map((m) => m.initiativeId));
    const carriedIn = carriedForward(runs, month);
    const base = { month, initiatives, members, profiles, adjustments, carriedIn, ...GENEROUS };
    const collected = computeRun({ ...base, entries });
    // what-if: payments on my projects expected in this cycle are collected by the 20th
    const pending = entries.filter((e) => myIni.has(e.initiativeId) && !e.received && e.month === month);
    const win = collectionWindow(month);
    const ifCollected = pending.length ? computeRun({ ...base, entries: entries.map((e) => (pending.includes(e) ? { ...e, received: true, collectedAt: e.collectedAt ?? win.to } : e)) }) : null;
    const lines = collected.lines.filter((l) => l.userId === userId);
    const alt = ifCollected?.lines.filter((l) => l.userId === userId) ?? [];
    const ids = [...new Set([...lines.map((l) => l.initiativeId), ...alt.map((l) => l.initiativeId)])];
    return {
      window: win,
      pending,
      rows: ids.map((id) => ({
        ini: initiatives.find((i) => i.id === id),
        line: lines.find((l) => l.initiativeId === id),
        alt: alt.find((l) => l.initiativeId === id),
        project: collected.projects.find((p) => p.initiativeId === id),
      })),
      run: runs.find((r) => r.month === month),
    };
  }, [initiatives, members, entries, profiles, adjustments, runs, userId, month]);

  const total = (k: "gross" | "topUp" | "topUpDeducted" | "deferred" | "withheld" | "held" | "forfeited" | "payable" | "carriedIn") => data.rows.reduce((s, r) => s + (r.line?.[k] ?? 0), 0);
  const altShare = (l: (typeof data.rows)[number]["alt"]) => (l ? l.gross + l.topUp - l.topUpDeducted : 0);
  const altTotal = data.rows.reduce((s, r) => s + altShare(r.alt), 0);

  return (
    <Card
      title={
        <>
          This cycle · projected bonus <Cite s="8.1" />
          <Cite s="8.2" />
        </>
      }
      action={
        <>
          <Chip color="yellow" title="Company figures are assumed generous: the §9.1 break-even test and cash check may still reduce what is paid (§9.2)">
            Projection — before the break-even test
          </Chip>
          {data.run && <Chip color={data.run.status === "released" ? "green" : data.run.status === "certified" ? "cyan" : data.run.status === "failed" ? "red" : "blue"}>{cycleLabel(month)} run {data.run.status}</Chip>}
        </>
      }
    >
      <p className="mb-3 flex gap-1.5 text-2xs text-sg-muted">
        <Info className="mt-px size-3.5 shrink-0 text-sg-dim" />
        <span>
          Salary cycle {cycleLabel(month)}: revenue collected {formatDate(data.window.from, "short")} – {formatDate(data.window.to, "short")} is paid with the {formatDate(paymentDate(month), "medium")} salary; later collections move to next month (§8.2).
          {cycleDates(month).notes.length > 0 && <> {cycleDates(month).notes.join(" · ")}.</>} Assumes the company passes the break-even test and cash check — if not, the PRC pays pro rata and carries the rest forward (§9.2). Type C standard bonuses are paid in full either way (§8.6).
        </span>
      </p>
      {data.rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-sg-dim">No collected payment on your projects in this cycle&apos;s window{data.pending.length ? ` yet — ${data.pending.length} payment${data.pending.length === 1 ? " is" : "s are"} still expected` : ""}.</p>
      ) : (
        <div className="-mx-4 -mb-4 overflow-x-auto">
          <table className="w-full min-w-[1080px] text-xs">
            <thead>
              <tr className={THEAD_ROW}>
                <th className={cn(TH, "pl-4")}>Project</th>
                <th className={cn(TH, "text-right")}>Project pool</th>
                <th className={cn(TH, "text-right")}>My share</th>
                <th className={cn(TH, "text-right")}>Top-up</th>
                <th className={cn(TH, "text-right")}>Deducted</th>
                <th className={cn(TH, "text-right")}>Deferred</th>
                <th className={cn(TH, "text-right")}>Withheld</th>
                <th className={cn(TH, "text-right")}>Held / forfeited</th>
                <th className={cn(TH, "text-right")}>Projected payable</th>
                {data.pending.length > 0 && (
                  <th className={cn(TH, "pr-4 text-right")} title="My share (after top-up deductions, before deferral / probation holds) if the payments still expected in this window are collected by the 20th">
                    My share if expected payments land by the 20th
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.ini?.id ?? r.line?.initiativeId} className="border-b border-sg-line align-top last:border-b-0">
                  <td className="py-1.5 pl-4 pr-2">
                    <span className="font-semibold text-sg-white">{r.ini?.title ?? "Project"}</span>
                    {r.ini?.demo && <SampleChip />}
                    {r.line && r.line.notes.length > 0 && <div className="mt-0.5 max-w-[300px] text-2xs text-sg-dim">{r.line.notes.join(" · ")}</div>}
                  </td>
                  <NumCell v={r.project?.pool ?? 0} />
                  <NumCell v={r.line?.gross ?? 0} />
                  <NumCell v={r.line?.topUp ?? 0} tone="text-soft-cyan" />
                  <NumCell v={-(r.line?.topUpDeducted ?? 0)} tone="text-soft-orange" />
                  <NumCell v={r.line?.deferred ?? 0} tone="text-soft-cyan" />
                  <NumCell v={r.line?.withheld ?? 0} tone="text-soft-yellow" />
                  <NumCell v={(r.line?.held ?? 0) + (r.line?.forfeited ?? 0)} tone="text-soft-red" />
                  <NumCell v={r.line?.payable ?? 0} tone="text-soft-green" strong />
                  {data.pending.length > 0 && <NumCell v={altShare(r.alt)} tone="text-sg-muted" />}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-sg-line-2 bg-sg-bg/40 font-semibold">
                <td className="py-1.5 pl-4 pr-2 text-2xs uppercase tracking-wider text-sg-dim">Total</td>
                <td />
                <NumCell v={total("gross")} />
                <NumCell v={total("topUp")} tone="text-soft-cyan" />
                <NumCell v={-total("topUpDeducted")} tone="text-soft-orange" />
                <NumCell v={total("deferred")} tone="text-soft-cyan" />
                <NumCell v={total("withheld")} tone="text-soft-yellow" />
                <NumCell v={total("held") + total("forfeited")} tone="text-soft-red" />
                <NumCell v={total("payable")} tone="text-soft-green" strong />
                {data.pending.length > 0 && <NumCell v={altTotal} tone="text-sg-muted" />}
              </tr>
            </tfoot>
          </table>
          {total("carriedIn") > 0 && <p className="px-4 py-2 text-2xs text-sg-dim">Includes <RpFull value={total("carriedIn")} /> carried forward from an earlier failed month, paid first (§9.2).</p>}
        </div>
      )}
    </Card>
  );
}
