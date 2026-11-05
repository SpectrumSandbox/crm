"use client";

/* Portfolio health table for /projects: health from the latest §6.1 monthly update, delivery and money signals per project. */
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useCrm } from "@/lib/store";
import type { Rag } from "@/lib/initiatives/types";
import { changeOrderImpact, RAG_META, updateState } from "@/lib/initiatives/team-rules";
import { cn, formatIDR } from "@/lib/utils";
import { Avatar } from "@/components/ui/misc";
import { TypeChip } from "@/components/initiatives/shared";
import type { ProjectRegister } from "./model";
import { HealthChip } from "./status-updates";

const DAY = 86_400_000;
type SortKey = "title" | "health" | "updated" | "milestones" | "collected" | "due" | "risks" | "gaps" | "cos";
const RAG_RANK: Record<Rag, number> = { red: 0, amber: 1, green: 2 };

export function PortfolioTable({ registers }: { registers: ProjectRegister[] }) {
  const updates = useCrm((s) => s.projectUpdates);
  const cos = useCrm((s) => s.changeOrders);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "health", dir: 1 });
  const [atRiskOnly, setAtRiskOnly] = useState(false);
  const [now] = useState(() => Date.now());

  const rows = useMemo(
    () =>
      registers.map((reg) => {
        const { ini } = reg;
        const st = updateState(ini, updates, now);
        const ms = ini.milestones;
        const accepted = ms.filter((m) => m.done).length;
        const impact = changeOrderImpact(ini, cos, adjustments);
        const expected = ini.revenue.expected + impact.priceDelta;
        const lead = reg.rows.find((r) => r.member.roles.includes("project_lead"));
        const end = Date.parse(ini.endDate) + impact.scheduleDeltaDays * DAY;
        return {
          reg,
          health: st.latest?.health ?? null,
          state: st.state,
          days: st.days,
          lead,
          milestonesPct: ms.length ? accepted / ms.length : null,
          milestones: `${accepted}/${ms.length}`,
          collected: reg.collected.revenue,
          expected,
          collectedPct: expected > 0 ? reg.collected.revenue / expected : null,
          openCos: impact.open.length,
          resetNeeded: impact.resetNeeded,
          daysToDue: Math.ceil((end - now) / DAY),
          highRisks: ini.risks.filter((r) => r.level === "high").length,
          gaps: reg.failing,
        };
      }),
    [registers, updates, cos, adjustments, now],
  );

  const shown = useMemo(() => {
    const list = atRiskOnly ? rows.filter((r) => r.health === "amber" || r.health === "red" || r.state === "overdue") : rows;
    const val = (r: (typeof rows)[number]): number | string => {
      switch (sort.key) {
        case "title":
          return r.reg.ini.title.toLowerCase();
        case "health":
          return r.health ? RAG_RANK[r.health] : -1;
        case "updated":
          return -(r.days ?? 10_000);
        case "milestones":
          return r.milestonesPct ?? -1;
        case "collected":
          return r.collectedPct ?? -1;
        case "due":
          return r.daysToDue;
        case "risks":
          return -r.highRisks;
        case "gaps":
          return -r.gaps;
        case "cos":
          return -r.openCos;
      }
    };
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.reg.ini.title.localeCompare(b.reg.ini.title);
    });
  }, [rows, sort, atRiskOnly]);

  const head = (key: SortKey, label: string, right?: boolean, title?: string) => (
    <th className={cn("px-2 py-2 font-semibold", right && "text-right")} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" title={title} onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : 1 }))} className={cn("inline-flex items-center gap-1 uppercase tracking-wider hover:text-sg-white", sort.key === key && "text-sg-white")}>
        {label}
        {sort.key === key ? sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
      </button>
    </th>
  );

  return (
    <div className="mt-4 space-y-2">
      <label className="flex w-fit items-center gap-1.5 text-xs text-sg-muted">
        <input type="checkbox" className="accent-white" checked={atRiskOnly} onChange={(e) => setAtRiskOnly(e.target.checked)} /> At risk, off track or update overdue only
      </label>
      <div className="overflow-x-auto rounded-xl border border-sg-line bg-sg-card">
        <table className="w-full min-w-[1080px] text-sm">
          <thead>
            <tr className="border-b border-sg-line text-left text-2xs text-sg-dim">
              {head("title", "Project")}
              <th className="px-2 py-2 font-semibold uppercase tracking-wider">Lead</th>
              {head("health", "Health", false, "Latest monthly status update (§6.1)")}
              {head("updated", "Updated")}
              {head("milestones", "Milestones", true, "Accepted / total")}
              {head("collected", "Collected", true, "Collected revenue vs expected incl. approved change orders")}
              {head("cos", "Open COs", true, "Change orders not yet decided (§5.6)")}
              {head("due", "Delivery", true, "Days to contracted final delivery (incl. approved schedule changes)")}
              {head("risks", "High risks", true)}
              {head("gaps", "Policy gaps", true)}
            </tr>
          </thead>
          <tbody className="divide-y divide-sg-line">
            {shown.map((r) => (
              <tr key={r.reg.ini.id}>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2 pl-2">
                    <Link href={`/projects/${r.reg.ini.id}`} className="font-semibold text-sg-white hover:underline">
                      {r.reg.ini.title}
                    </Link>
                    <TypeChip type={r.reg.ini.type} />
                  </div>
                  {r.reg.ini.code ? <div className="sg-num pl-2 text-2xs text-sg-dim">{r.reg.ini.code}</div> : null}
                </td>
                <td className="px-2 py-2">
                  {r.lead ? (
                    <span className="flex items-center gap-1.5 text-xs text-sg-text">
                      <Avatar user={r.lead.user} size="xs" /> {r.lead.user?.name ?? r.lead.member.userId}
                    </span>
                  ) : (
                    <span className="text-2xs text-soft-red">No Project Lead</span>
                  )}
                </td>
                <td className="px-2 py-2">{r.health ? <HealthChip rag={r.health} /> : <span className="text-2xs text-sg-dim">No update</span>}</td>
                <td className={cn("px-2 py-2 text-xs", r.state === "overdue" ? "text-soft-red" : r.state === "due" ? "text-soft-yellow" : "text-sg-muted")}>{r.days == null ? (r.state === "overdue" ? "overdue" : "—") : `${r.days}d ago${r.state === "due" ? " · due" : r.state === "overdue" ? " · overdue" : ""}`}</td>
                <td className="sg-num px-2 py-2 text-right text-xs text-sg-muted">
                  {r.milestones}
                  {r.milestonesPct != null ? <div className="text-2xs text-sg-dim">{Math.round(r.milestonesPct * 100)}%</div> : null}
                </td>
                <td className="sg-num whitespace-nowrap px-2 py-2 text-right text-xs">
                  <span className="text-sg-white">{formatIDR(r.collected)}</span>
                  <div className="text-2xs text-sg-dim">{r.expected > 0 ? `of ${formatIDR(r.expected)} · ${Math.round((r.collectedPct ?? 0) * 100)}%` : "no expected case"}</div>
                </td>
                <td className="sg-num px-2 py-2 text-right text-xs">
                  <span className={r.openCos ? "text-soft-yellow" : "text-sg-dim"}>{r.openCos}</span>
                  {r.resetNeeded ? <div className="text-2xs font-semibold text-soft-red">rate reset due</div> : null}
                </td>
                <td className={cn("sg-num whitespace-nowrap px-2 py-2 text-right text-xs", r.daysToDue < 0 ? "text-soft-red" : r.daysToDue <= 30 ? "text-soft-yellow" : "text-sg-muted")}>{r.daysToDue < 0 ? `${-r.daysToDue}d late` : `${r.daysToDue}d`}</td>
                <td className={cn("sg-num px-2 py-2 text-right text-xs", r.highRisks ? "text-soft-red" : "text-sg-dim")}>{r.highRisks}</td>
                <td className={cn("sg-num px-4 py-2 text-right text-xs", r.gaps ? "text-soft-red" : "text-soft-green")}>{r.gaps || "✓"}</td>
              </tr>
            ))}
            {!shown.length ? (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-xs text-sg-dim">
                  {atRiskOnly ? "No project is at risk, off track or overdue on its update." : "No projects."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-2xs text-sg-dim">Health comes from the Project Lead&apos;s monthly update ({Object.values(RAG_META).map((m) => m.label).join(" / ")}, §6.1). No compensation data is shown here.</p>
    </div>
  );
}
