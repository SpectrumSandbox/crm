"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { notFound, useParams, useRouter } from "next/navigation";
import { CircleCheck, ClipboardCheck, Plus, Target, Trash2, TriangleAlert } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { descendantsOf, strengthMeta, useEngagement, useGroupRollups, useStageMap, useUserMap } from "@/lib/selectors";
import type { AccountPlan, AccountPlanAction, RelationshipRating, ReviewCadence, WhitespaceMark } from "@/lib/seed-ext/accounts";
import { CAPABILITIES, type Capability, type Deal } from "@/lib/types";
import { cn, formatDate, formatIDR, relativeTime, uid } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { DateInput } from "@/components/ui/date-input";
import { Avatar, Chip, EmptyState } from "@/components/ui/misc";
import { CADENCE_LABEL, nextReviewAt, quarterOf, reviewOverdue } from "../../account-utils";

const RATINGS: { id: RelationshipRating; label: string; color: "green" | "cyan" | "blue" | "red" | "yellow" }[] = [
  { id: "champion", label: "Champion", color: "green" },
  { id: "supporter", label: "Supporter", color: "cyan" },
  { id: "neutral", label: "Neutral", color: "blue" },
  { id: "detractor", label: "Detractor", color: "red" },
  { id: "unknown", label: "Unknown", color: "yellow" },
];
const ratingMeta = new Map(RATINGS.map((r) => [r.id, r] as const));
/** short column labels for the whitespace grid */
const CAP_SHORT: Record<Capability, string> = {
  "Artificial Intelligence": "AI",
  "Unmanned Systems": "Unmanned",
  "Sensor Integration": "Sensors",
  "Control Systems Engineering": "Controls",
  "Industrial IoT": "IIoT",
  "Prototyping & Manufacturing": "Prototyping",
  "IT / OT": "IT / OT",
  "Engineering Management": "Eng. mgmt",
  "Full Stack Software Development": "Software",
};

type Cell = { kind: "won" | "open" | "target" | "not_fit" | "none"; amount: number; deals: Deal[] };

export default function AccountPlanPage() {
  const { id: raw } = useParams<{ id: string }>();
  const id = decodeURIComponent(raw);
  const router = useRouter();
  const companies = useCrm((s) => s.companies);
  const contacts = useCrm((s) => s.contacts);
  const deals = useCrm((s) => s.deals);
  const users = useCrm((s) => s.users);
  const accountPlans = useCrm((s) => s.accountPlans);
  const ensureAccountPlan = useCrm((s) => s.ensureAccountPlan);
  const updateAccountPlan = useCrm((s) => s.updateAccountPlan);
  const markPlanReviewed = useCrm((s) => s.markPlanReviewed);
  const convertPlanAction = useCrm((s) => s.convertPlanAction);
  const notify = useUi((s) => s.notify);
  const stageMap = useStageMap();
  const userMap = useUserMap();
  const rollups = useGroupRollups();
  const engagement = useEngagement();

  const company = companies.find((c) => c.id === id);
  const plan = accountPlans.find((p) => p.companyId === id);
  const unitIds = useMemo(() => [id, ...descendantsOf(companies, id)], [companies, id]);
  const units = useMemo(() => unitIds.map((u) => companies.find((c) => c.id === u)).filter((c): c is NonNullable<typeof c> => !!c), [unitIds, companies]);
  const groupContacts = useMemo(() => contacts.filter((c) => c.companyId && unitIds.includes(c.companyId)), [contacts, unitIds]);

  /* whitespace: won / open deals per unit × capability, then manual marks */
  const grid = useMemo(() => {
    const m = new Map<string, Cell>();
    const won = new Map<string, number>();
    const open = new Map<string, number>();
    const key = (u: string, cap: string) => `${u}|${cap}`;
    deals.forEach((d) => {
      if (!d.companyId || !unitIds.includes(d.companyId)) return;
      const st = stageMap.get(d.stageId);
      if (st?.closed === "lost") return;
      const k = key(d.companyId, d.capability);
      const bucket = st?.closed === "won" ? won : open;
      bucket.set(k, (bucket.get(k) ?? 0) + d.amount);
      const cell = m.get(k) ?? { kind: "open", amount: 0, deals: [] };
      cell.deals.push(d);
      m.set(k, cell);
    });
    m.forEach((cell, k) => {
      cell.kind = won.has(k) ? "won" : "open";
      cell.amount = (won.has(k) ? won.get(k) : open.get(k)) ?? 0;
      // won deals first so a click opens the reference deal
      cell.deals.sort((a, b) => Number(stageMap.get(b.stageId)?.closed === "won") - Number(stageMap.get(a.stageId)?.closed === "won"));
    });
    plan?.whitespace.forEach((w) => {
      const k = key(w.unitId, w.capability);
      if (!m.has(k)) m.set(k, { kind: w.mark, amount: 0, deals: [] });
    });
    return m;
  }, [deals, unitIds, stageMap, plan]);
  const coverage = useMemo(() => {
    let won = 0;
    let open = 0;
    let target = 0;
    grid.forEach((c) => (c.kind === "won" ? won++ : c.kind === "open" ? open++ : c.kind === "target" ? target++ : null));
    const cells = units.length * CAPABILITIES.length;
    const notFit = Array.from(grid.values()).filter((c) => c.kind === "not_fit").length;
    return { won, open, target, whitespace: cells - won - open - notFit, cells };
  }, [grid, units.length]);

  const [goalText, setGoalText] = useState("");
  const [goalQuarter, setGoalQuarter] = useState(() => quarterOf(Date.now()));
  const [actionText, setActionText] = useState("");
  const [converting, setConverting] = useState<{ actionId: string; amount: number | null; closeDate: string | null } | null>(null);

  if (!company) notFound();

  /** run an edit against the plan, creating it on first use */
  const edit = (fn: (p: AccountPlan) => Partial<AccountPlan>) => {
    const planId = plan?.id ?? ensureAccountPlan(id);
    const current = useCrm.getState().accountPlans.find((p) => p.id === planId);
    if (current) updateAccountPlan(planId, fn(current));
  };

  const cycleMark = (unitId: string, cap: Capability) => {
    const cell = grid.get(`${unitId}|${cap}`);
    if (cell && (cell.kind === "won" || cell.kind === "open")) {
      router.push(`/deals/${cell.deals[0].id}`);
      return;
    }
    const next: WhitespaceMark["mark"] | null = !cell || cell.kind === "none" ? "target" : cell.kind === "target" ? "not_fit" : null;
    edit((p) => ({ whitespace: [...p.whitespace.filter((w) => !(w.unitId === unitId && w.capability === cap)), ...(next ? [{ unitId, capability: cap, mark: next }] : [])] }));
  };

  const group = rollups.group.get(id);
  const overdue = plan ? reviewOverdue(plan.cadence, plan.lastReviewedAt) : false;
  const ratings = plan?.relationships ?? [];
  const champions = ratings.filter((r) => r.rating === "champion").length;
  const detractors = ratings.filter((r) => r.rating === "detractor").length;
  const ratingOf = (contactId: string) => ratings.find((r) => r.contactId === contactId);
  const quarters = [0, 1, 2, 3].map((i) => quarterOf(Date.now() + i * 92 * 86_400_000));

  const setRating = (contactId: string, patch: Partial<{ rating: RelationshipRating; note: string }>) =>
    edit((p) => {
      const existing = p.relationships.find((r) => r.contactId === contactId);
      const next = { contactId, rating: existing?.rating ?? "unknown", note: existing?.note ?? "", ...patch };
      return { relationships: existing ? p.relationships.map((r) => (r.contactId === contactId ? next : r)) : [...p.relationships, next] };
    });
  const patchAction = (actionId: string, patch: Partial<AccountPlanAction>) => edit((p) => ({ actions: p.actions.map((a) => (a.id === actionId ? { ...a, ...patch } : a)) }));

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Account plan"
        docTitle={`${company.name} — account plan`}
        crumbs={[
          { href: "/companies", label: "Companies" },
          { href: `/companies/${id}`, label: company.name },
        ]}
        meta={company.tier === "Strategic" ? <Chip color="magenta">Strategic</Chip> : <Chip color="blue">{company.tier}</Chip>}
      >
        {plan ? (
          <span className={cn("text-xs", overdue ? "font-semibold text-soft-orange" : "text-sg-muted")}>
            {plan.lastReviewedAt ? `Reviewed ${relativeTime(plan.lastReviewedAt)} by ${userMap.get(plan.lastReviewedById ?? "")?.name.split(" ")[0] ?? "—"}` : "Never reviewed"}
            {overdue ? " · review due" : ` · next ${formatDate(nextReviewAt(plan.cadence, plan.lastReviewedAt), "short")}`}
          </span>
        ) : null}
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            const planId = plan?.id ?? ensureAccountPlan(id);
            markPlanReviewed(planId);
            notify(`Account plan review recorded for ${company.name}`);
          }}
        >
          <ClipboardCheck /> Mark reviewed
        </Button>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* group roll-up */}
        <div className="grid grid-cols-2 border-b border-sg-line sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label={units.length > 1 ? "Group open pipeline" : "Open pipeline"} value={formatIDR(group?.openPipeline ?? 0)} hint={`${group?.openDeals ?? 0} open ${group?.openDeals === 1 ? "deal" : "deals"} · ${units.length} ${units.length === 1 ? "unit" : "units"}`} />
          <Kpi label="Won, last 12 months" value={formatIDR(group?.wonTtm ?? 0)} tone="green" hint="by close date" />
          <Kpi label="Open tickets" value={String(group?.openTickets ?? 0)} tone={group?.breaches ? "red" : undefined} hint={group?.breaches ? `${group.breaches} past SLA` : "all within SLA"} />
          <Kpi label="CSAT" value={group?.csat === null || group?.csat === undefined ? "—" : `${group.csat.toFixed(1)}/5`} hint={group?.csatCount ? `${group.csatCount} ${group.csatCount === 1 ? "rating" : "ratings"}` : "no ratings yet"} />
          <Kpi label="Capability coverage" value={`${coverage.won + coverage.open}/${coverage.cells}`} hint={`${coverage.won} won · ${coverage.open} open · ${coverage.target} targeted`} />
          <Kpi label="Last interaction" value={group?.lastAt ? relativeTime(group.lastAt) : "never"} hint={group?.lastAt ? formatDate(group.lastAt, "medium") : "log a call or meeting"} />
        </div>

        <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-4">
            <Section title="Account strategy" icon={Target}>
              <div className="space-y-2 p-4">
                <Textarea
                  key={plan?.updatedAt ?? "new"}
                  defaultValue={plan?.strategy ?? ""}
                  onBlur={(e) => e.target.value !== (plan?.strategy ?? "") && edit(() => ({ strategy: e.target.value }))}
                  placeholder="Where do we want to be with this account in 12 months, and how do we get there?"
                />
                <div className="flex flex-wrap items-center gap-3 text-xs text-sg-muted">
                  <label className="flex items-center gap-2">
                    Review cadence
                    <Select value={plan?.cadence ?? (company.tier === "Strategic" ? "monthly" : "quarterly")} onChange={(e) => edit(() => ({ cadence: e.target.value as ReviewCadence }))} wrapperClassName="w-40" aria-label="Review cadence">
                      {(Object.keys(CADENCE_LABEL) as ReviewCadence[]).map((c) => (
                        <option key={c} value={c}>
                          {CADENCE_LABEL[c]}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="flex items-center gap-2">
                    Plan owner
                    <Select value={plan?.ownerId ?? company.ownerId} onChange={(e) => edit(() => ({ ownerId: e.target.value }))} wrapperClassName="w-44" aria-label="Plan owner">
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
              </div>
            </Section>

            {/* whitespace grid */}
            <Section title="Capability whitespace" icon={Target} hint={`${coverage.whitespace} open cells — click an empty cell to mark it as a target, again for “not a fit”`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-separate border-spacing-0 text-xs">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 border-b border-sg-line bg-sg-card px-3 py-2 text-left text-2xs uppercase tracking-[0.1em] text-sg-dim">Business unit</th>
                      {CAPABILITIES.map((cap) => (
                        <th key={cap} title={cap} className="border-b border-sg-line px-1.5 py-2 text-center text-2xs font-semibold text-sg-dim">
                          {CAP_SHORT[cap]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {units.map((u) => (
                      <tr key={u.id}>
                        <td className="sticky left-0 z-10 border-b border-sg-line bg-sg-card px-3 py-1.5">
                          <Link href={`/companies/${u.id}`} className={cn("block max-w-[200px] truncate font-semibold hover:underline", u.id === id ? "text-sg-white" : "pl-3 text-sg-text")}>
                            {u.name}
                          </Link>
                        </td>
                        {CAPABILITIES.map((cap) => {
                          const cell = grid.get(`${u.id}|${cap}`) ?? { kind: "none" as const, amount: 0, deals: [] };
                          const label =
                            cell.kind === "won"
                              ? `Won ${formatIDR(cell.amount)}`
                              : cell.kind === "open"
                                ? `Open ${formatIDR(cell.amount)}`
                                : cell.kind === "target"
                                  ? "Target"
                                  : cell.kind === "not_fit"
                                    ? "Not a fit"
                                    : "Whitespace";
                          return (
                            <td key={cap} className="border-b border-sg-line p-1">
                              <button
                                type="button"
                                onClick={() => cycleMark(u.id, cap)}
                                title={`${u.name} · ${cap}: ${label}${cell.deals.length ? ` — ${cell.deals.map((d) => d.name).join(", ")}` : ""}`}
                                aria-label={`${u.name}, ${cap}: ${label}`}
                                className={cn(
                                  "flex h-10 w-full min-w-[64px] flex-col items-center justify-center rounded text-[10px] font-semibold leading-tight focus:outline-none focus-visible:ring-1 focus-visible:ring-sg-white",
                                  cell.kind === "won" && "bg-soft-green/20 text-soft-green",
                                  cell.kind === "open" && "bg-soft-cyan/15 text-soft-cyan",
                                  cell.kind === "target" && "border border-dashed border-soft-yellow/60 text-soft-yellow",
                                  cell.kind === "not_fit" && "text-sg-dim line-through",
                                  cell.kind === "none" && "border border-dashed border-sg-line text-sg-dim hover:border-sg-line-2 hover:text-sg-white",
                                )}
                              >
                                {cell.kind === "won" || cell.kind === "open" ? (
                                  <>
                                    <span>{cell.kind === "won" ? "Won" : "Open"}</span>
                                    <span className="sg-num">{formatIDR(cell.amount)}</span>
                                  </>
                                ) : cell.kind === "target" ? (
                                  "Target"
                                ) : cell.kind === "not_fit" ? (
                                  "n/a"
                                ) : (
                                  "+"
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-3 border-t border-sg-line px-4 py-2 text-2xs text-sg-dim">
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-soft-green/40" /> Won
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-soft-cyan/30" /> Open deal
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-sm border border-dashed border-soft-yellow/60" /> Target
                </span>
                <span>Click a won / open cell to open the deal.</span>
              </div>
            </Section>

            {/* action plan */}
            <Section title="Action plan" icon={ClipboardCheck} hint="Actions become deals when they turn into an opportunity">
              <ul className="divide-y divide-sg-line">
                {(plan?.actions ?? []).map((a) => (
                  <li key={a.id} className="space-y-2 px-4 py-3">
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        aria-label={`Done: ${a.text}`}
                        checked={a.status !== "open"}
                        disabled={a.status === "converted"}
                        onChange={(e) => patchAction(a.id, { status: e.target.checked ? "done" : "open" })}
                        className="mt-1 size-4 shrink-0 accent-white"
                      />
                      <div className="min-w-0 flex-1">
                        <div className={cn("text-sm", a.status === "done" ? "text-sg-dim line-through" : "text-sg-white")}>{a.text}</div>
                        {a.status === "converted" && a.dealId ? (
                          <Link href={`/deals/${a.dealId}`} className="text-2xs font-semibold text-soft-green hover:underline">
                            Converted to deal → {deals.find((d) => d.id === a.dealId)?.name ?? "deal"}
                          </Link>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove action ${a.text}`}
                        onClick={() => {
                          const prev = plan!.actions;
                          edit((p) => ({ actions: p.actions.filter((x) => x.id !== a.id) }));
                          notify("Action removed", { label: "Undo", run: () => edit(() => ({ actions: prev })) });
                        }}
                        className="rounded p-1 text-sg-dim hover:bg-sg-card-3 hover:text-soft-red"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                    {a.status !== "converted" && (
                      <div className="grid grid-cols-2 gap-2 pl-6 sm:grid-cols-4">
                        <Select value={a.ownerId} onChange={(e) => patchAction(a.id, { ownerId: e.target.value })} aria-label="Owner">
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </Select>
                        <DateInput value={a.dueAt} onValueChange={(v) => patchAction(a.id, { dueAt: v })} aria-label="Due date" />
                        <Select value={a.unitId ?? id} onChange={(e) => patchAction(a.id, { unitId: e.target.value })} aria-label="Business unit">
                          {units.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </Select>
                        <Select value={a.capability ?? ""} onChange={(e) => patchAction(a.id, { capability: (e.target.value || null) as Capability | null })} aria-label="Capability">
                          <option value="">No capability</option>
                          {CAPABILITIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </Select>
                      </div>
                    )}
                    {a.status === "open" &&
                      (converting?.actionId === a.id ? (
                        <div className="flex flex-wrap items-end gap-2 pl-6">
                          <label className="min-w-[180px] flex-1 text-2xs text-sg-dim">
                            Deal amount
                            <MoneyInput value={converting.amount} onValueChange={(v) => setConverting({ ...converting, amount: v })} aria-label="Deal amount" />
                          </label>
                          <label className="min-w-[150px] text-2xs text-sg-dim">
                            Expected close
                            <DateInput value={converting.closeDate} onValueChange={(v) => setConverting({ ...converting, closeDate: v })} aria-label="Expected close date" />
                          </label>
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={!converting.amount || converting.amount <= 0 || !converting.closeDate}
                            onClick={() => {
                              if (!plan || !converting.amount || !converting.closeDate) return;
                              const dealId = convertPlanAction(plan.id, a.id, { amount: converting.amount, closeDate: converting.closeDate });
                              setConverting(null);
                              if (dealId) notify("Deal created from the account plan", { label: "Open", run: () => router.push(`/deals/${dealId}`) });
                            }}
                          >
                            Create deal
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConverting(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="pl-6">
                          <Button size="xs" variant="outline" onClick={() => setConverting({ actionId: a.id, amount: null, closeDate: new Date(Date.now() + 90 * 86_400_000).toISOString() })}>
                            Convert to deal
                          </Button>
                        </div>
                      ))}
                  </li>
                ))}
              </ul>
              <form
                className="flex gap-2 border-t border-sg-line p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!actionText.trim()) return;
                  edit((p) => ({ actions: [...p.actions, { id: uid("apa"), text: actionText.trim(), ownerId: p.ownerId, dueAt: null, capability: null, unitId: id, status: "open", dealId: null }] }));
                  setActionText("");
                }}
              >
                <Input value={actionText} onChange={(e) => setActionText(e.target.value)} placeholder="Add an action, e.g. “Run an AI yard-planning workshop”" aria-label="New action" />
                <Button type="submit" size="md" variant="outline" disabled={!actionText.trim()}>
                  <Plus /> Add
                </Button>
              </form>
            </Section>
          </div>

          <div className="min-w-0 space-y-4">
            {/* relationship map */}
            <Section title="Relationship map" icon={CircleCheck} hint={`${champions} ${champions === 1 ? "champion" : "champions"} · ${detractors} ${detractors === 1 ? "detractor" : "detractors"}`}>
              {!champions && groupContacts.length > 0 && (
                <p className="flex items-center gap-1.5 border-b border-sg-line bg-soft-orange/10 px-4 py-2 text-2xs font-semibold text-soft-orange">
                  <TriangleAlert className="size-3.5" /> No champion yet — the account is single-threaded on goodwill.
                </p>
              )}
              {groupContacts.length ? (
                <ul className="divide-y divide-sg-line">
                  {groupContacts.map((c) => {
                    const r = ratingOf(c.id);
                    const e = engagement.byContact.get(c.id);
                    const meta = ratingMeta.get(r?.rating ?? "unknown")!;
                    return (
                      <li key={c.id} className="space-y-1.5 px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <Link href={`/contacts/${c.id}`} className="block truncate text-sm font-semibold text-sg-white hover:underline">
                              {c.firstName} {c.lastName}
                            </Link>
                            <div className="truncate text-2xs text-sg-dim">
                              {c.jobTitle}
                              {c.companyId !== id ? ` · ${companies.find((x) => x.id === c.companyId)?.name ?? ""}` : ""}
                            </div>
                          </div>
                          <Chip color={strengthMeta[e?.strength ?? "none"].color} title={e?.lastAt ? `Last touch ${relativeTime(e.lastAt)}` : "No logged touches"}>
                            {strengthMeta[e?.strength ?? "none"].label}
                          </Chip>
                          <Select value={meta.id} onChange={(ev) => setRating(c.id, { rating: ev.target.value as RelationshipRating })} wrapperClassName="w-32" aria-label={`Stance of ${c.firstName} ${c.lastName}`}>
                            {RATINGS.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.label}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <Input key={`${c.id}-${r?.note ?? ""}`} defaultValue={r?.note ?? ""} onBlur={(ev) => ev.target.value !== (r?.note ?? "") && setRating(c.id, { note: ev.target.value })} placeholder="What do they care about?" aria-label={`Note on ${c.firstName}`} className="h-7 text-xs" />
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState title="No contacts at this account yet">Add the buying committee as contacts to map who supports you.</EmptyState>
              )}
            </Section>

            {/* goals */}
            <Section title="Goals" icon={Target}>
              <ul className="divide-y divide-sg-line">
                {(plan?.goals ?? []).map((g) => (
                  <li key={g.id} className="flex items-start gap-2 px-4 py-2.5">
                    <input type="checkbox" aria-label={`Achieved: ${g.text}`} checked={g.done} onChange={(e) => edit((p) => ({ goals: p.goals.map((x) => (x.id === g.id ? { ...x, done: e.target.checked } : x)) }))} className="mt-0.5 size-4 accent-white" />
                    <span className={cn("min-w-0 flex-1 text-sm", g.done ? "text-sg-dim line-through" : "text-sg-white")}>{g.text}</span>
                    <Chip color={g.quarter < quarterOf(Date.now()) && !g.done ? "red" : "blue"}>{g.quarter}</Chip>
                    <button
                      type="button"
                      aria-label={`Remove goal ${g.text}`}
                      onClick={() => {
                        const prev = plan!.goals;
                        edit((p) => ({ goals: p.goals.filter((x) => x.id !== g.id) }));
                        notify("Goal removed", { label: "Undo", run: () => edit(() => ({ goals: prev })) });
                      }}
                      className="rounded p-0.5 text-sg-dim hover:text-soft-red"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              <form
                className="flex gap-2 border-t border-sg-line p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!goalText.trim()) return;
                  edit((p) => ({ goals: [...p.goals, { id: uid("apg"), text: goalText.trim(), quarter: goalQuarter, done: false }] }));
                  setGoalText("");
                }}
              >
                <Input value={goalText} onChange={(e) => setGoalText(e.target.value)} placeholder="Add a goal" aria-label="New goal" />
                <Select value={goalQuarter} onChange={(e) => setGoalQuarter(e.target.value)} wrapperClassName="w-28" aria-label="Quarter">
                  {quarters.map((qq) => (
                    <option key={qq} value={qq}>
                      {qq}
                    </option>
                  ))}
                </Select>
                <Button type="submit" size="md" variant="outline" disabled={!goalText.trim()} aria-label="Add goal">
                  <Plus />
                </Button>
              </form>
            </Section>

            <p className="flex items-center gap-2 px-1 text-2xs text-sg-dim">
              <Avatar user={userMap.get(plan?.ownerId ?? company.ownerId)} size="xs" />
              {plan ? `Plan owned by ${userMap.get(plan.ownerId)?.name ?? "—"} · last edited ${relativeTime(plan.updatedAt)}` : "No plan saved yet — the first edit creates it."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "green" | "red" }) {
  return (
    <div className="border-b border-r border-sg-line px-5 py-3 lg:border-b-0 lg:last:border-r-0">
      <div className="sg-eyebrow">{label}</div>
      <div className={cn("sg-num mt-1 font-display text-xl font-extrabold", tone === "green" ? "text-soft-green" : tone === "red" ? "text-soft-red" : "text-sg-white")}>{value}</div>
      {hint ? <div className="truncate text-2xs text-sg-dim">{hint}</div> : null}
    </div>
  );
}

function Section({ title, icon: Icon, hint, children }: { title: string; icon: React.ComponentType<{ className?: string }>; hint?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-sg-line bg-sg-card">
      <header className="flex flex-wrap items-center gap-2 border-b border-sg-line px-4 py-2.5">
        <Icon className="size-3.5 text-sg-dim" />
        <h2 className="font-display text-sm font-extrabold text-sg-white">{title}</h2>
        {hint ? <span className="text-2xs text-sg-dim">{hint}</span> : null}
      </header>
      {children}
    </section>
  );
}
