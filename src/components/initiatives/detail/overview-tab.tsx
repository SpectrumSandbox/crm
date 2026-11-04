"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowUpRight, BarChart3, Briefcase, Building2, Calculator, CalendarDays, Gavel, Hourglass, Kanban, Landmark, Lock, PiggyBank, ShieldAlert, Target, TriangleAlert } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useStageMap } from "@/lib/selectors";
import type { Initiative, RevenueEntry, RiskCategory, RiskItem } from "@/lib/initiatives/types";
import { addBusinessDays, approvalTier, deferralShare, deferralTriggers, deferralVestDate, netRevenue, projectedAnnualNet, proposalEconomics, rateReview, standardBonusOf } from "@/lib/initiatives/engine";
import { ORIGINATION_META, POLICY, RISK_CATEGORIES, TIER_META } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { Chip, RecordAvatar } from "@/components/ui/misc";
import { Cite, Money, Pct, Rate, RateCurve, SampleChip, StatusChip, TierChip, milestoneWorkPeriods, rateSourceLabel } from "@/components/initiatives/shared";
import { Card, KV, Prose, RiskLevelChip } from "./ui";

const contractLabel: Record<Initiative["contractStatus"], string> = { none: "No contract yet", verbal: "Verbal agreement", loi: "Letter of intent", signed: "Signed contract" };
const levelOrder: Record<RiskItem["level"], number> = { high: 0, medium: 1, low: 2 };

export function OverviewTab({ ini }: { ini: Initiative }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-4">
        <ProposalCard ini={ini} />
        <MilestonesCard ini={ini} />
        <EconomicsCard ini={ini} />
        <ComparablesCard ini={ini} />
        <RisksCard ini={ini} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ClientCard ini={ini} />
          <EpicCard ini={ini} />
        </div>
      </div>
      <div className="min-w-0 space-y-4">
        <RateCard ini={ini} />
        <TierCard ini={ini} />
        <DeferralCard ini={ini} />
        {ini.type === "C" ? <TypeCCard ini={ini} /> : null}
      </div>
    </div>
  );
}

function ProposalCard({ ini }: { ini: Initiative }) {
  return (
    <Card title="Proposal" icon={Target} cite={["4.3", "Annex A"]}>
      <div className="space-y-4">
        <Prose label="Business case" text={ini.summary} />
        <Prose label="Value to the company & strategic fit" text={ini.valueProposition} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Prose label="Scope" text={ini.scope} />
          <Prose label="Deliverables & acceptance" text={ini.deliverables} />
          <Prose label="Excluded" text={ini.exclusions} />
          <Prose label="Success criteria" text={ini.successCriteria} />
        </div>
      </div>
    </Card>
  );
}

function MilestonesCard({ ini }: { ini: Initiative }) {
  const saveInitiative = useCrm((s) => s.saveInitiative);
  const notify = useUi((s) => s.notify);
  const milestones = useMemo(() => [...(ini.milestones ?? [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [ini.milestones]);
  const periods = useMemo(() => milestoneWorkPeriods(ini.milestones ?? [], ini.startDate), [ini.milestones, ini.startDate]);
  const paymentTotal = milestones.reduce((s, m) => s + (m.paymentAmount || 0), 0);
  const doneCount = milestones.filter((m) => m.done).length;
  const now = Date.now();

  const toggle = (id: string) => {
    const next = (ini.milestones ?? []).map((m) => (m.id === id ? { ...m, done: !m.done } : m));
    saveInitiative({ id: ini.id, milestones: next });
    const m = next.find((x) => x.id === id);
    if (m) notify(m.done ? `Milestone “${m.name}” accepted` : `Milestone “${m.name}” reopened`);
  };

  return (
    <Card
      title="Schedule & milestones"
      icon={CalendarDays}
      cite={["4.3", "6.5"]}
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
              const wp = periods.get(m.id);
              return (
                <li key={m.id} className="relative flex items-start gap-3 pb-3 last:pb-0">
                  {i < milestones.length - 1 ? <span className="absolute left-[7px] top-5 h-[calc(100%-12px)] w-px bg-sg-line" aria-hidden /> : null}
                  <input type="checkbox" checked={m.done} onChange={() => toggle(m.id)} aria-label={`Mark ${m.name} accepted`} className="relative mt-0.5 size-4 shrink-0 cursor-pointer accent-white" />
                  <div className="min-w-0 flex-1">
                    <div className={cn("text-sm font-semibold", m.done ? "text-sg-muted line-through" : "text-sg-white")}>{m.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-2xs">
                      <span className={cn("sg-num", overdue ? "text-soft-red" : "text-sg-muted")}>
                        {formatDate(m.dueDate, "medium")}
                        {overdue ? " · overdue" : ""}
                      </span>
                      {m.paymentAmount > 0 ? <Chip color="green">Payment milestone</Chip> : null}
                      {m.paymentAmount > 0 && wp ? (
                        <span className="sg-num text-sg-dim">
                          work period {formatDate(wp.from, "short")} → {formatDate(wp.to, "short")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-right">{m.paymentAmount > 0 ? <Money value={m.paymentAmount} className="text-sm font-semibold text-sg-white" /> : <span className="text-2xs text-sg-dim">—</span>}</div>
                </li>
              );
            })}
          </ol>
          <div className="flex items-center justify-between border-t border-sg-line px-4 py-2 text-xs">
            <span className="text-sg-muted">
              {doneCount}/{milestones.length} accepted · a payment counts once earned and collected <Cite s="8.1" />
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
    <Card title="Risks" icon={ShieldAlert} cite="4.3" actions={high ? <Chip color="red">{high} high</Chip> : null} bodyClassName="p-0">
      {groups.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-sg-dim">No risks recorded. Tier 2 and 3 proposals list at least two risks, each with a mitigation.</p>
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
    <Card title="Client" icon={Building2} cite="4.3">
      {company ? (
        <Link href={`/companies/${company.id}`} className="group -m-1 flex items-center gap-3 rounded-md p-1 hover:bg-sg-card-2">
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
        <KV label="Market / liability terms">{ini.unusualTerms ? <span className="text-soft-magenta">New market or unusual terms</span> : "Standard"}</KV>
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
  const project = epic ? projects.find((p) => p.id === epic.projectId) : ini.jiraProjectId ? projects.find((p) => p.id === ini.jiraProjectId) : undefined;
  const pct = stats.total ? stats.done / stats.total : 0;

  return (
    <Card title="Delivery" icon={Kanban} cite="4.5">
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
      ) : project ? (
        <div className="text-xs text-sg-muted">
          Delivered in Jira project{" "}
          <Link href="/board" className="font-semibold text-sg-white hover:underline">
            {project.name} ({project.key})
          </Link>
          .
        </div>
      ) : (
        <p className="text-xs text-sg-dim">No Jira epic yet — the PMO opens the project in the project system after approval; choose a Jira project in the PRC decision to create the epic and kickoff task.</p>
      )}
    </Card>
  );
}

/** §5.1 the project's revenue-share rate, its basis and the rate-review checks. */
function RateCard({ ini }: { ini: Initiative }) {
  const adjustments = useCrm((s) => s.curveAdjustments);
  const entries = useCrm((s) => s.revenueEntries);
  const review = useMemo(() => rateReview(ini, entries, adjustments), [ini, entries, adjustments]);
  const fixed = review.source === "fixed" || review.source === "v3_flat";
  return (
    <Card title="Revenue-share rate" icon={Landmark} cite={["5.1", "9.5"]}>
      <div className="flex items-baseline justify-between gap-2">
        <Rate value={review.rate} className="font-display text-2xl font-extrabold text-sg-white" />
        <Chip color={review.source === "provisional" ? "yellow" : review.source === "v3_flat" ? "blue" : fixed ? "green" : "cyan"}>
          {fixed ? <Lock className="size-3" /> : null}
          {review.source === "fixed" ? "Fixed by PRC" : review.source === "v3_flat" ? "v3.0 flat share" : review.source === "curve" ? "Curve · not yet fixed" : "Provisional"}
        </Chip>
      </div>
      <p className="mt-0.5 text-2xs text-sg-dim">{rateSourceLabel(review.source)}</p>
      <div className="mt-2 border-t border-sg-line pt-2">
        <KV label="Projected annual net revenue x">
          <Money value={review.x} className="text-sg-white" />
        </KV>
        <KV label="Projected net revenue (expected case)">
          <Money value={review.projectedNet} />
        </KV>
        <KV label="Contracted duration">
          <span className="sg-num">
            {review.months} month{review.months === 1 ? "" : "s"}
            {review.months > 12 ? " — x = net × 12 ÷ months" : " — x = total net"}
          </span>
        </KV>
        <KV label="Curve">
          {Math.round(review.curve.start * 100)}% → {Math.round(review.curve.floor * 100)}% at {formatIDR(review.curve.decay)}
        </KV>
        <KV label="Actual net to date · re-forecast x">
          <span className="sg-num">
            <Money value={review.actualNet} /> · <Money value={review.actualX} />
          </span>
        </KV>
        {review.source !== "v3_flat" && review.actualX > 0 ? (
          <KV label="Rate on actual x">
            <Rate value={review.recalculatedRate} className="text-sg-muted" />
          </KV>
        ) : null}
      </div>
      {review.source === "v3_flat" ? (
        <p className="mt-2 rounded-md border border-sg-line bg-sg-bg/40 px-2 py-1.5 text-2xs text-sg-muted">
          Approved under Version 3.0 — the project keeps its flat revenue-share percentage, type and team weights<Cite s="15.1" />. The cash-based cumulative calculation and payment timing of §8 apply from the full rollout.
        </p>
      ) : (
        <div className="mt-3">
          <RateCurve x={review.x} curve={review.curve} months={review.months} />
        </div>
      )}
      {review.flags.length ? (
        <ul className="mt-2 space-y-1">
          {review.flags.map((f) => (
            <li key={f} className="flex items-start gap-1.5 rounded-md border border-soft-yellow/40 bg-soft-yellow/10 px-2 py-1.5 text-2xs text-soft-yellow">
              <TriangleAlert className="mt-px size-3 shrink-0" /> {f}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-2xs text-sg-dim">
        Finance recalculates x from actual and re-forecast net revenue every 12 months and at final reconciliation; more than 20% above the x used → the rate is recalculated for the whole project. Change orders moving x by more than 10% reset the rate for later revenue. Curve changes apply only to projects approved after their effective date<Cite s="9.5" />.
      </p>
    </Card>
  );
}

function TierCard({ ini }: { ini: Initiative }) {
  const users = useCrm((s) => s.users);
  const tier = useMemo(() => approvalTier(ini), [ini]);
  const t = TIER_META[tier.tier];
  const due = ini.submittedAt ? addBusinessDays(ini.submittedAt, t.decisionBusinessDays) : null;
  const initiator = users.find((u) => u.id === ini.initiatorId);
  const orig = ini.origination ? ORIGINATION_META[ini.origination] : null;
  return (
    <Card title="Origination & approval tier" icon={Gavel} cite={["4.1", "4.2"]}>
      <div className="flex flex-wrap items-center gap-2">
        <TierChip tier={tier.tier} long />
        {ini.demo ? <SampleChip /> : null}
        {ini.registeredRetroactively ? <Chip color="orange">Registered after start · PRC ratifies</Chip> : null}
        {ini.pilot ? <Chip color="cyan">v4.0 pilot</Chip> : null}
      </div>
      <ul className="mt-1.5 space-y-0.5 text-2xs text-sg-muted">
        {tier.reasons.map((r) => (
          <li key={r}>· {r}</li>
        ))}
      </ul>
      <div className="mt-2 border-t border-sg-line pt-2">
        <KV label="Proposal">{t.proposal}</KV>
        <KV label="Who decides">{t.decides}</KV>
        <KV label="Decision within">
          {t.decisionBusinessDays} business days{due ? ` · due ${formatDate(due, "medium")}` : ""}
        </KV>
        <KV label="Proposed by">{initiator?.name ?? ini.initiatorId}</KV>
        <KV label="Origination">{orig ? orig.label : <span className="text-soft-orange">Not recorded</span>}</KV>
        <KV label="First CRM contact">{ini.firstContactAt ? formatDate(ini.firstContactAt, "medium") : <span className="text-sg-dim">—</span>}</KV>
      </div>
      {ini.origination === "company" ? <p className="mt-1 text-2xs text-sg-dim">Company channel — no Initiator weight; the PRC appoints the Project Lead.</p> : null}
    </Card>
  );
}

function EconomicsCard({ ini }: { ini: Initiative }) {
  const adjustments = useCrm((s) => s.curveAdjustments);
  const econ = useMemo(() => proposalEconomics(ini, adjustments), [ini, adjustments]);
  const cols = [
    { key: "best", label: "Best", s: econ.best },
    { key: "expected", label: "Expected", s: econ.expected },
    { key: "worst", label: "Worst", s: econ.worst },
  ] as const;
  const rows: { label: React.ReactNode; get: (s: typeof econ.expected) => React.ReactNode; strong?: boolean }[] = [
    { label: "Revenue excl. VAT", get: (s) => <Money value={s.revenue} /> },
    { label: `Direct costs (incl. ${ini.costs?.contingencyPct ?? 0}% contingency)`, get: (s) => <Money value={-s.costs} /> },
    {
      label: (
        <>
          UMKM final tax 0.5% of revenue<Cite s="5.4" />
        </>
      ),
      get: (s) => <Money value={-s.tax} />,
    },
    { label: "Net revenue", get: (s) => <Money value={s.net} className={s.net < 0 ? "text-soft-red" : "text-sg-white"} />, strong: true },
    { label: "Projected annual net revenue x", get: (s) => <Money value={projectedAnnualNet(s.net, econ.rate.months)} className="text-sg-muted" /> },
    { label: "Revenue-share rate y", get: () => <Rate value={econ.rate.rate} /> },
    { label: "Bonus pool", get: (s) => <Money value={s.pool} className="text-soft-cyan" />, strong: true },
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
    <Card title="Financials — best, expected and worst" icon={Calculator} cite={["5.2", "Annex A"]} bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-xs">
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
      </div>
      <div className="space-y-1 border-t border-sg-line px-3 py-2 text-2xs text-sg-dim">
        <p>
          Net revenue = revenue − direct costs − estimated taxes <Cite s="5.2" /> · pool = y × net, one rate for every scenario, set from the expected case <Cite s="5.1" />
        </p>
        {c ? (
          <p>
            Cost base: materials {formatIDR(c.materials)}, subcontractors {formatIDR(c.subcontractors)}, equipment {formatIDR(c.equipment)}, travel {formatIDR(c.travel)}, other {formatIDR(c.other)}. Break-even at {formatIDR(econ.breakEvenRevenue)} revenue (UMKM tax is due even at a loss).
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function DeferralCard({ ini }: { ini: Initiative }) {
  const adjustments = useCrm((s) => s.curveAdjustments);
  const reasons = useMemo(() => deferralTriggers(ini, adjustments), [ini, adjustments]);
  const pct = useMemo(() => deferralShare(ini, adjustments), [ini, adjustments]);
  const vest = deferralVestDate(ini);
  return (
    <Card title="Deferral for high-risk projects" icon={Hourglass} cite="9.3">
      {reasons.length ? (
        <>
          <p className="text-sm font-semibold text-soft-orange">
            {Math.round(pct * 100)}% of each interim bonus deferred for {ini.deferralMonths || POLICY.deferral.minMonths} months after close
          </p>
          <ul className="mt-2 space-y-1">
            {reasons.map((r) => (
              <li key={r} className="flex items-start gap-1.5 text-xs text-sg-text">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-soft-orange" /> {r}
              </li>
            ))}
          </ul>
          <div className="mt-2 border-t border-sg-line pt-2">
            <KV label={ini.completedAt ? "Vests" : "Vests (from the contracted end)"}>{formatDate(vest, "medium")}</KV>
          </div>
          <p className="mt-2 text-2xs text-sg-dim">
            Warranty, rework and other costs in the deferral period are deducted from the deferred pool; amounts linked to unpaid invoices are held. If final net revenue is more than 10% below the approved forecast, the PRC reviews the reasons. Deferral never takes a Type C monthly pool below its standard bonus.
          </p>
        </>
      ) : (
        <p className="text-xs text-sg-muted">No deferral trigger — net revenue ≤ {formatIDR(POLICY.deferral.netRevenueThreshold)}, payment terms ≤ 90 days, existing client, no Type C warranty and not rated high risk. Bonuses are paid with the next salary after collection (§8.2).</p>
      )}
    </Card>
  );
}

function TypeCCard({ ini }: { ini: Initiative }) {
  const sb = standardBonusOf(ini);
  return (
    <Card title="Type C guaranteed minimum" icon={PiggyBank} cite="8.6">
      <div className="flex items-baseline justify-between">
        <Money value={sb} className="font-display text-xl font-extrabold text-sg-white" />
        <span className="text-2xs text-sg-dim">standard bonus a month</span>
      </div>
      <p className="mt-1 text-2xs text-sg-muted">
        {ini.approvedAt ? "Fixed by the PRC at approval; may be raised at kickoff by an amendment to the Role and Weight Agreement, then fixed for the life of the project." : "Proposed — the PRC fixes the amount at approval (at least Rp1,000,000 a month)."}
      </p>
      <p className="mt-2 text-2xs text-sg-dim">The company tops the revenue-based pool up to the standard bonus each cycle from the month work starts (first month pro-rated). Top-ups are paid even when the monthly checks fail and are deducted from later revenue-based bonuses on the project; unrecovered balances lapse at close. The month-by-month table is on the Financials tab.</p>
    </Card>
  );
}

/* ───────────────────────── comparable projects (Part 2 #4) ───────────────────────── */

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

function actualsOf(id: string, entries: RevenueEntry[]) {
  const mine = entries.filter((e) => e.initiativeId === id && e.received);
  const revenue = mine.reduce((s, e) => s + e.revenue, 0);
  const net = mine.reduce((s, e) => s + netRevenue(e.revenue, e.directCosts).net, 0);
  return { revenue, net, payments: mine.length };
}

function ComparablesCard({ ini }: { ini: Initiative }) {
  const initiatives = useCrm((s) => s.initiatives);
  const entries = useCrm((s) => s.revenueEntries);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const data = useMemo(() => {
    const rows = initiatives
      .filter((i) => i.id !== ini.id && i.type === ini.type && (i.status === "active" || i.status === "completed") && i.revenue.expected > 0)
      .map((i) => {
        const econ = proposalEconomics(i, adjustments);
        const act = actualsOf(i.id, entries);
        // forecast net for the revenue collected so far, at the approved expected-case net margin
        const forecastNet = i.revenue.expected > 0 ? act.revenue * (econ.expected.net / i.revenue.expected) : 0;
        const variance = forecastNet > 0 ? act.net / forecastNet - 1 : null;
        return { i, econ, act, forecastNet, variance };
      })
      .sort((a, b) => b.econ.expected.marginPct - a.econ.expected.marginPct);
    const mine = proposalEconomics(ini, adjustments).expected;
    const med = median(rows.map((r) => r.econ.expected.marginPct));
    return { rows, mineMargin: ini.revenue.expected > 0 ? mine.marginPct : null, med };
  }, [initiatives, entries, adjustments, ini]);
  const diff = data.mineMargin != null && data.med != null ? data.mineMargin - data.med : null;

  return (
    <Card
      title={`Comparable Type ${ini.type} projects`}
      icon={BarChart3}
      cite="4.4"
      actions={
        diff != null ? (
          <span className={cn("text-2xs font-semibold", diff < -0.05 ? "text-soft-red" : diff < 0 ? "text-soft-yellow" : "text-soft-green")}>
            This proposal <Pct value={data.mineMargin!} /> vs median <Pct value={data.med!} /> ({diff >= 0 ? "+" : ""}
            {(diff * 100).toFixed(1)} pp)
          </span>
        ) : null
      }
      bodyClassName="p-0"
    >
      {data.rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-sg-dim">No active or completed Type {ini.type} projects with an expected case to compare against yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="border-b border-sg-line text-left">
                <th className="sg-eyebrow px-4 py-2 font-semibold">Project</th>
                <th className="sg-eyebrow px-2 py-2 font-semibold">Status</th>
                <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Expected margin</th>
                <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Collected revenue</th>
                <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Actual net to date</th>
                <th className="sg-eyebrow px-4 py-2 text-right font-semibold" title="Actual net vs the expected-case net margin applied to the revenue collected so far">
                  vs forecast
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.i.id} className="border-b border-sg-line/60 last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/initiatives/${r.i.id}`} className="font-semibold text-sg-white hover:underline">
                      {r.i.title}
                    </Link>
                    <span className="ml-1.5 inline-flex items-center gap-1 align-middle">
                      {r.i.code ? <span className="sg-num text-2xs text-sg-dim">{r.i.code}</span> : null}
                      {r.i.demo ? <SampleChip /> : null}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <StatusChip status={r.i.status} />
                  </td>
                  <td className="sg-num px-2 py-2 text-right text-sg-white">
                    <Pct value={r.econ.expected.marginPct} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Money value={r.act.revenue} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Money value={r.act.net} className={r.act.net < 0 ? "text-soft-red" : "text-sg-white"} />
                  </td>
                  <td className="sg-num px-4 py-2 text-right">
                    {r.variance == null ? (
                      <span className="text-sg-dim">no collections</span>
                    ) : (
                      <span className={cn(Math.abs(r.variance) > POLICY.deferral.forecastShortfallReviewPct ? (r.variance < 0 ? "text-soft-red" : "text-soft-yellow") : "text-soft-green")}>
                        {r.variance >= 0 ? "+" : ""}
                        {(r.variance * 100).toFixed(1)}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-sg-line px-4 py-2 text-2xs text-sg-dim">
        Expected margin = company margin after the bonus pool ÷ revenue in the approved expected case. Variance compares actual net with the forecast net margin on the revenue collected so far; more than 10% below forecast at close is reviewed by the PRC<Cite s="9.3" />.
      </p>
    </Card>
  );
}
