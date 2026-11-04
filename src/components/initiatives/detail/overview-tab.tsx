"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowUpRight, Briefcase, Building2, Calculator, CalendarDays, Hourglass, Kanban, Landmark, Lock, ShieldAlert, Target } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useStageMap } from "@/lib/selectors";
import type { Initiative, RiskCategory, RiskItem } from "@/lib/initiatives/types";
import { deferralTriggers, proposalEconomics, shareInForce } from "@/lib/initiatives/engine";
import { POLICY, PROJECT_TYPE_META, RISK_CATEGORIES } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { Chip, RecordAvatar } from "@/components/ui/misc";
import { Cite, Money, Pct } from "@/components/initiatives/shared";
import { Card, KV, Prose, RiskLevelChip } from "./ui";

const contractLabel: Record<Initiative["contractStatus"], string> = { none: "No contract yet", verbal: "Verbal agreement", loi: "Letter of intent", signed: "Signed contract" };
const levelOrder: Record<RiskItem["level"], number> = { high: 0, medium: 1, low: 2 };

export function OverviewTab({ ini }: { ini: Initiative }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <ProposalCard ini={ini} />
        <MilestonesCard ini={ini} />
        <RisksCard ini={ini} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ClientCard ini={ini} />
          <EpicCard ini={ini} />
        </div>
      </div>
      <div className="min-w-0 space-y-4">
        <EconomicsCard ini={ini} />
        <DeferralCard ini={ini} />
        <ShareCard ini={ini} />
      </div>
    </div>
  );
}

function ProposalCard({ ini }: { ini: Initiative }) {
  return (
    <Card title="Proposal" icon={Target} cite="2.2">
      <div className="space-y-4">
        <Prose label="Executive summary" text={ini.summary} cite="2.2.1" />
        <Prose label="Value proposition & strategic rationale" text={ini.valueProposition} cite="2.2.1" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Prose label="Scope of work" text={ini.scope} cite="2.2.2" />
          <Prose label="Deliverables & acceptance" text={ini.deliverables} cite="2.2.2" />
          <Prose label="Exclusions" text={ini.exclusions} cite="2.2.2" />
          <Prose label="Success criteria" text={ini.successCriteria} cite="2.2.2" />
        </div>
      </div>
    </Card>
  );
}

function MilestonesCard({ ini }: { ini: Initiative }) {
  const saveInitiative = useCrm((s) => s.saveInitiative);
  const notify = useUi((s) => s.notify);
  const milestones = useMemo(() => [...(ini.milestones ?? [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [ini.milestones]);
  const paymentTotal = milestones.reduce((s, m) => s + (m.paymentAmount || 0), 0);
  const doneCount = milestones.filter((m) => m.done).length;
  const now = Date.now();

  const toggle = (id: string) => {
    const next = (ini.milestones ?? []).map((m) => (m.id === id ? { ...m, done: !m.done } : m));
    saveInitiative({ id: ini.id, milestones: next });
    const m = next.find((x) => x.id === id);
    if (m) notify(m.done ? `Milestone “${m.name}” marked done` : `Milestone “${m.name}” reopened`);
  };

  return (
    <Card
      title="Timeline & milestones"
      icon={CalendarDays}
      cite="2.2.3"
      actions={
        <span className="text-2xs text-sg-muted">
          {formatDate(ini.startDate, "medium")} → {formatDate(ini.endDate, "medium")}
        </span>
      }
      bodyClassName="p-0"
    >
      {milestones.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-sg-dim">No milestones defined.</p>
      ) : (
        <>
          <ol className="relative px-4 py-3">
            {milestones.map((m, i) => {
              const overdue = !m.done && Date.parse(m.dueDate) < now;
              return (
                <li key={m.id} className="relative flex items-start gap-3 pb-3 last:pb-0">
                  {i < milestones.length - 1 ? <span className="absolute left-[7px] top-5 h-[calc(100%-12px)] w-px bg-sg-line" aria-hidden /> : null}
                  <input type="checkbox" checked={m.done} onChange={() => toggle(m.id)} aria-label={`Mark ${m.name} done`} className="relative mt-0.5 size-4 shrink-0 cursor-pointer accent-white" />
                  <div className="min-w-0 flex-1">
                    <div className={cn("text-sm font-semibold", m.done ? "text-sg-muted line-through" : "text-sg-white")}>{m.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-2xs">
                      <span className={cn("sg-num", overdue ? "text-soft-red" : "text-sg-muted")}>
                        {formatDate(m.dueDate, "medium")}
                        {overdue ? " · overdue" : ""}
                      </span>
                      {m.paymentAmount > 0 ? <Chip color="green">Payment milestone</Chip> : null}
                    </div>
                  </div>
                  <div className="text-right">{m.paymentAmount > 0 ? <Money value={m.paymentAmount} className="text-sm font-semibold text-sg-white" /> : <span className="text-2xs text-sg-dim">—</span>}</div>
                </li>
              );
            })}
          </ol>
          <div className="flex items-center justify-between border-t border-sg-line px-4 py-2 text-xs">
            <span className="text-sg-muted">
              {doneCount}/{milestones.length} done · milestone bonuses distribute on payment receipt <Cite s="4.4" />
            </span>
            <span className="text-sg-muted">
              Payments <Money value={paymentTotal} className="font-semibold text-sg-white" />
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

function RisksCard({ ini }: { ini: Initiative }) {
  const groups = useMemo(() => {
    const m = new Map<RiskCategory, RiskItem[]>();
    for (const r of ini.risks ?? []) m.set(r.category, [...(m.get(r.category) ?? []), r]);
    return (Object.keys(RISK_CATEGORIES) as RiskCategory[]).filter((c) => m.has(c)).map((c) => ({ category: c, items: m.get(c)!.sort((a, b) => levelOrder[a.level] - levelOrder[b.level]) }));
  }, [ini.risks]);
  const high = (ini.risks ?? []).filter((r) => r.level === "high").length;

  return (
    <Card title="Risk assessment" icon={ShieldAlert} cite="2.2.7" actions={high ? <Chip color="red">{high} high</Chip> : null} bodyClassName="p-0">
      {groups.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-sg-dim">No risks recorded. The PRC requires at least two risks with mitigations.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-sg-line text-left">
              <th className="sg-eyebrow px-4 py-2 font-semibold">Risk</th>
              <th className="sg-eyebrow px-2 py-2 font-semibold">Mitigation</th>
              <th className="sg-eyebrow w-20 px-4 py-2 text-right font-semibold">Level</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <RiskGroup key={g.category} category={g.category} items={g.items} />
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function RiskGroup({ category, items }: { category: RiskCategory; items: RiskItem[] }) {
  return (
    <>
      <tr className="bg-sg-bg/40">
        <td colSpan={3} className="px-4 py-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-sg-muted">
          {RISK_CATEGORIES[category]} · {items.length}
        </td>
      </tr>
      {items.map((r) => (
        <tr key={r.id} className="border-b border-sg-line/60 align-top last:border-0">
          <td className="px-4 py-2 text-sg-text">{r.description || <span className="text-sg-dim">—</span>}</td>
          <td className="px-2 py-2 text-sg-muted">{r.mitigation || <span className="text-soft-orange">No mitigation</span>}</td>
          <td className="px-4 py-2 text-right">
            <RiskLevelChip level={r.level} />
          </td>
        </tr>
      ))}
    </>
  );
}

function ClientCard({ ini }: { ini: Initiative }) {
  const company = useCrm((s) => (ini.companyId ? s.companies.find((c) => c.id === ini.companyId) : undefined));
  const deal = useCrm((s) => (ini.dealId ? s.deals.find((d) => d.id === ini.dealId) : undefined));
  const stageMap = useStageMap();
  const stage = deal ? stageMap.get(deal.stageId) : undefined;

  return (
    <Card title="Client" icon={Building2} cite="2.2.6">
      {company ? (
        <Link href={`/companies/${company.id}`} className="group flex items-center gap-3 rounded-md p-1 -m-1 hover:bg-sg-card-2">
          <RecordAvatar label={company.name} color="blue" size="md" square />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-sg-white group-hover:underline">{company.name}</div>
            <div className="truncate text-2xs text-sg-muted">
              {company.industry} · {company.city}
            </div>
          </div>
          <ArrowUpRight className="size-3.5 text-sg-dim group-hover:text-sg-white" />
        </Link>
      ) : (
        <p className="text-xs text-sg-dim">{ini.companyId ? "Client record not found." : "No client linked."}</p>
      )}
      <div className="mt-3 border-t border-sg-line pt-2">
        <KV label="Contract">{contractLabel[ini.contractStatus] ?? "—"}</KV>
        <KV label="Payment terms">
          <span className={cn("sg-num", ini.paymentTermsDays > POLICY.deferral.paymentTermsDays && "text-soft-orange")}>{ini.paymentTermsDays} days</span>
        </KV>
        <KV label="Client history">{ini.newClient ? <span className="text-soft-orange">New — no payment history</span> : "Existing client"}</KV>
      </div>
      <div className="mt-2 border-t border-sg-line pt-3">
        <div className="sg-eyebrow mb-1.5 flex items-center gap-1">
          <Briefcase className="size-3" /> Deal
        </div>
        {deal ? (
          <Link href={`/deals/${deal.id}`} className="group block rounded-md border border-sg-line p-2 hover:border-sg-line-2 hover:bg-sg-card-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-sg-white group-hover:underline">{deal.name}</span>
              <Money value={deal.amount} className="text-sm font-semibold text-sg-white" />
            </div>
            <div className="mt-1 flex items-center gap-2">
              {stage ? (
                <Chip color={stage.color} dot>
                  {stage.name}
                </Chip>
              ) : null}
              <span className="text-2xs text-sg-muted">close {formatDate(deal.closeDate, "medium")}</span>
            </div>
          </Link>
        ) : (
          <p className="text-xs text-sg-dim">{ini.dealId ? "Deal not found." : "No deal linked."}</p>
        )}
      </div>
    </Card>
  );
}

function EpicCard({ ini }: { ini: Initiative }) {
  const epic = useCrm((s) => (ini.epicId ? s.epics.find((e) => e.id === ini.epicId) : undefined));
  const projects = useCrm((s) => s.projects);
  const issues = useCrm((s) => s.issues);
  const stats = useMemo(() => {
    if (!epic) return { total: 0, done: 0, inProgress: 0 };
    const list = issues.filter((i) => i.epicId === epic.id);
    return { total: list.length, done: list.filter((i) => i.status === "done").length, inProgress: list.filter((i) => i.status === "in_progress" || i.status === "in_review").length };
  }, [epic, issues]);
  const project = epic ? projects.find((p) => p.id === epic.projectId) : undefined;
  const pct = stats.total ? stats.done / stats.total : 0;

  return (
    <Card title="Delivery epic" icon={Kanban} cite="2.3.6">
      {epic ? (
        <div>
          <div className="flex items-center gap-2">
            <Chip color={epic.color}>{epic.key}</Chip>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-sg-white">{epic.name}</span>
          </div>
          {project ? (
            <Link href="/board" className="mt-1 inline-flex items-center gap-1 text-2xs text-sg-muted hover:text-sg-white">
              {project.name} ({project.key}) <ArrowUpRight className="size-3" />
            </Link>
          ) : null}
          <div className="mt-3 flex items-baseline justify-between text-xs">
            <span className="text-sg-muted">Progress</span>
            <span className="sg-num text-sg-white">
              {stats.done}/{stats.total} issues done · <Pct value={pct} />
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sg-card-3">
            <div className="h-full bg-soft-green" style={{ width: `${Math.round(pct * 100)}%` }} />
          </div>
          <div className="mt-1 text-2xs text-sg-dim">{stats.inProgress} in progress</div>
        </div>
      ) : (
        <p className="text-xs text-sg-dim">
          {ini.epicId ? "Linked epic not found." : "No Jira epic yet — one is created automatically when the PRC approves the project with a Jira project selected."}
        </p>
      )}
    </Card>
  );
}

function EconomicsCard({ ini }: { ini: Initiative }) {
  const adjustments = useCrm((s) => s.shareAdjustments);
  const econ = useMemo(() => proposalEconomics(ini, adjustments, ini.approvedAt ?? new Date().toISOString()), [ini, adjustments]);
  const cols = [
    { key: "best", label: "Best", s: econ.best },
    { key: "expected", label: "Expected", s: econ.expected },
    { key: "worst", label: "Worst", s: econ.worst },
  ] as const;
  const rows: { label: React.ReactNode; get: (s: typeof econ.expected) => React.ReactNode; strong?: boolean }[] = [
    { label: "Revenue", get: (s) => <Money value={s.revenue} /> },
    { label: `Direct costs (incl. ${ini.costs?.contingencyPct ?? 0}% contingency)`, get: (s) => <Money value={-s.costs} /> },
    { label: `Estimated tax ${Math.round(POLICY.corporateTaxRate * 100)}%`, get: (s) => <Money value={-s.tax} /> },
    { label: "Net revenue (P)", get: (s) => <Money value={s.net} className={s.net < 0 ? "text-soft-red" : "text-sg-white"} />, strong: true },
    { label: "Revenue share (R)", get: () => <Pct value={econ.share} /> },
    { label: "Employee bonus pool", get: (s) => <Money value={s.pool} className="text-soft-cyan" />, strong: true },
    {
      label: "Company margin",
      get: (s) => (
        <span>
          <Money value={s.companyMargin} className={s.companyMargin < 0 ? "text-soft-red" : "text-sg-white"} />
          <span className="block text-[10px] text-sg-dim">
            <Pct value={s.marginPct} />
          </span>
        </span>
      ),
      strong: true,
    },
  ];
  const c = ini.costs;

  return (
    <Card title="Economics" icon={Calculator} cite={["3.4", "4.2"]} bodyClassName="p-0">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-sg-line">
            <th className="px-3 py-2 text-left" />
            {cols.map((col) => (
              <th key={col.key} className={cn("sg-eyebrow px-2 py-2 text-right font-semibold", col.key === "expected" && "text-sg-white")}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={cn("border-b border-sg-line/60 last:border-0", r.strong && "bg-sg-bg/30")}>
              <td className={cn("px-3 py-1.5", r.strong ? "font-semibold text-sg-white" : "text-sg-muted")}>{r.label}</td>
              {cols.map((col) => (
                <td key={col.key} className={cn("sg-num px-2 py-1.5 text-right", col.key === "expected" ? "text-sg-white" : "text-sg-text")}>
                  {r.get(col.s)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-1 border-t border-sg-line px-3 py-2 text-2xs text-sg-dim">
        <p>
          P = Revenue − Direct costs − Estimated taxes <Cite s="3.4" /> · Pool = R × P, split by role weight B<sub>i</sub> = W<sub>i</sub>/ΣW × R × P <Cite s="4.2" />
        </p>
        {c ? (
          <p>
            Cost base: materials {formatIDR(c.materials)}, subcontractors {formatIDR(c.subcontractors)}, equipment {formatIDR(c.equipment)}, travel {formatIDR(c.travel)}, other {formatIDR(c.other)}. Break-even at {formatIDR(econ.breakEvenRevenue)} revenue.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function DeferralCard({ ini }: { ini: Initiative }) {
  const adjustments = useCrm((s) => s.shareAdjustments);
  const reasons = useMemo(() => deferralTriggers(ini, adjustments), [ini, adjustments]);
  return (
    <Card title="High-risk deferral" icon={Hourglass} cite="6.3">
      {reasons.length ? (
        <>
          <p className="text-sm font-semibold text-soft-orange">
            {Math.round(POLICY.deferral.pct * 100)}% of each bonus deferred for {ini.deferralMonths || POLICY.deferral.minMonths} months
          </p>
          <ul className="mt-2 space-y-1">
            {reasons.map((r) => (
              <li key={r} className="flex items-start gap-1.5 text-xs text-sg-text">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-soft-orange" /> {r}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-2xs text-sg-dim">Deferred amounts vest after the deferral period if the project closes without clawback triggers.</p>
        </>
      ) : (
        <p className="text-xs text-sg-muted">No deferral triggers — bonuses are paid in full on the regular schedule (5th of the following month).</p>
      )}
    </Card>
  );
}

function ShareCard({ ini }: { ini: Initiative }) {
  const adjustments = useCrm((s) => s.shareAdjustments);
  const meta = PROJECT_TYPE_META[ini.type];
  const { inForce, scheduled } = useMemo(() => {
    const nowIso = new Date().toISOString();
    return {
      inForce: shareInForce(ini.type, adjustments, nowIso),
      scheduled: adjustments.filter((a) => a.type === ini.type && Date.parse(a.effectiveFrom) > Date.parse(nowIso)).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)),
    };
  }, [ini.type, adjustments]);
  const locked = ini.lockedSharePct;

  return (
    <Card title="Revenue share" icon={Landmark} cite="3.2">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-sg-line p-2.5">
          <div className="sg-eyebrow flex items-center gap-1">
            <Lock className="size-3" /> Locked for project
          </div>
          <div className="sg-num mt-0.5 font-display text-lg font-extrabold text-sg-white">{locked != null ? <Pct value={locked} /> : "—"}</div>
          <div className="text-2xs text-sg-dim">{locked != null ? `since ${formatDate(ini.approvedAt, "medium")}` : "locked on approval"}</div>
        </div>
        <div className="rounded-md border border-sg-line p-2.5">
          <div className="sg-eyebrow">Type {ini.type} in force</div>
          <div className="sg-num mt-0.5 font-display text-lg font-extrabold text-sg-white">
            <Pct value={inForce} />
          </div>
          <div className="text-2xs text-sg-dim">
            range <Pct value={meta.range[0]} />–<Pct value={meta.range[1]} />
          </div>
        </div>
      </div>
      {locked != null && Math.abs(locked - inForce) > 1e-9 ? <p className="mt-2 text-2xs text-soft-yellow">This project keeps its locked share; the company-wide rate has changed since approval.</p> : null}
      <div className="mt-3 border-t border-sg-line pt-2">
        <div className="sg-eyebrow mb-1 flex items-center">
          Scheduled adjustments <Cite s="6.6" />
        </div>
        {scheduled.length ? (
          <ul className="space-y-1">
            {scheduled.map((a) => (
              <li key={a.id} className="flex items-center justify-between text-xs">
                <span className="text-sg-text">
                  <Pct value={a.fromPct} /> → <Pct value={a.toPct} />
                </span>
                <span className="text-sg-muted">from {formatDate(a.effectiveFrom, "medium")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-sg-dim">None announced for Type {ini.type}.</p>
        )}
        <p className="mt-2 text-2xs text-sg-dim">Changes take effect at least 30 days after announcement. Projects with signed contracts honour original percentages.</p>
      </div>
    </Card>
  );
}
