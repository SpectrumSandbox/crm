"use client";

/* /disputes — the §14 queue: what Finance, HR, the PRC and the Executive Committee must act on, with SLA and ageing. */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Scale, Search } from "lucide-react";
import { useCrm } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import { businessDaysBetween } from "@/lib/initiatives/engine";
import { DISPUTE_CATEGORIES, type Dispute, type DisputeCategory } from "@/lib/initiatives/types";
import { DISPUTE_CATEGORY_META, canSeeDispute, decidingBody, disputeSla, isDisputeAdmin } from "@/lib/slices/program-extras";
import { cn, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Avatar, EmptyState, Kbd } from "@/components/ui/misc";
import { Tabs } from "@/components/ui/overlays";
import { Cite } from "@/components/initiatives/shared";
import { DisputeSlaChip, DisputeStageChip, RaiseDisputeModal } from "./disputes";
import { cycleLabel } from "./helpers";
import { RpFull, TH, THEAD_ROW } from "./ui";

type View = "mine" | "open" | "overdue" | "closed" | "all";

/** Does the dispute wait on this user? */
export function awaitsUser(d: Dispute, userId: string, profiles: Parameters<typeof decidingBody>[2]) {
  if (d.stage === "direct") return d.proposal ? d.raisedById === userId : d.handlerId === userId;
  if (d.stage === "prc" || d.stage === "exco") {
    const body = decidingBody(d, d.stage, profiles);
    return body.eligible.includes(userId) && !d.votes.some((v) => v.stage === d.stage && v.userId === userId);
  }
  return false;
}

export function DisputesQueue() {
  const disputes = useCrm((s) => s.disputes);
  const users = useCrm((s) => s.users);
  const initiatives = useCrm((s) => s.initiatives);
  const profiles = useCrm((s) => s.employeeProfiles);
  const access = useAccess();
  const router = useRouter();
  const admin = isDisputeAdmin(access.userId, profiles);
  const [view, setView] = useState<View>("open");
  const [category, setCategory] = useState<DisputeCategory | "">("");
  const [q, setQ] = useState("");
  const [raising, setRaising] = useState(false);

  const visible = useMemo(() => disputes.filter((d) => canSeeDispute(d, access.userId, profiles)), [disputes, access.userId, profiles]);
  const now = Date.now();
  const counts = useMemo(
    () => ({
      mine: visible.filter((d) => d.stage !== "closed" && (awaitsUser(d, access.userId, profiles) || d.raisedById === access.userId)).length,
      open: visible.filter((d) => d.stage !== "closed").length,
      overdue: visible.filter((d) => disputeSla(d)?.overdue).length,
      closed: visible.filter((d) => d.stage === "closed").length,
      all: visible.length,
    }),
    [visible, access.userId, profiles],
  );
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return visible
      .filter((d) => {
        if (view === "mine" && !(d.stage !== "closed" && (awaitsUser(d, access.userId, profiles) || d.raisedById === access.userId))) return false;
        if (view === "open" && d.stage === "closed") return false;
        if (view === "overdue" && !disputeSla(d)?.overdue) return false;
        if (view === "closed" && d.stage !== "closed") return false;
        if (category && d.category !== category) return false;
        if (t) {
          const hay = `${d.number} ${d.subject} ${users.find((u) => u.id === d.raisedById)?.name ?? ""} ${initiatives.find((i) => i.id === d.initiativeId)?.title ?? ""}`.toLowerCase();
          if (!hay.includes(t)) return false;
        }
        return true;
      })
      .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") || b.raisedAt.localeCompare(a.raisedAt));
  }, [visible, view, category, q, users, initiatives, access.userId, profiles]);

  const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? "—";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Disputes" meta={<span className="text-xs text-sg-muted">§14 · direct → PRC → Executive Committee</span>}>
        <Button size="sm" variant="primary" onClick={() => setRaising(true)}>
          <Plus /> Raise a dispute
        </Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <div className="mx-auto max-w-[1240px] space-y-3">
          <p className="text-xs text-sg-muted">
            {admin ? "Disputes about origination, roles, the ledger, calculations, ratings, removals, probation, forfeiture and clawbacks. " : "Your disputes. Finance, HR, the PRC and the Executive Committee see all disputes. "}
            Each stage has 10 business days (WIB, public holidays excluded): settle directly with the Project Lead or Finance, escalate to the PRC (members involved are recused), then appeal to the Executive Committee — final within the company. <Cite s="14" />
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs<View>
              aria-label="Dispute views"
              value={view}
              onChange={setView}
              items={[
                { value: "mine", label: "Waiting on me", count: counts.mine },
                { value: "open", label: "Open", count: counts.open },
                { value: "overdue", label: "Overdue", count: counts.overdue },
                { value: "closed", label: "Closed", count: counts.closed },
                { value: "all", label: "All", count: counts.all },
              ]}
            />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as DisputeCategory | "")} wrapperClassName="w-44">
                <option value="">All categories</option>
                {DISPUTE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {DISPUTE_CATEGORY_META[c].label}
                  </option>
                ))}
              </Select>
              <div className="relative w-56">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-sg-dim" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search disputes" aria-label="Search disputes" className="pl-8" />
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-sg-line bg-sg-card">
            {rows.length === 0 ? (
              <EmptyState icon={Scale} title={visible.length ? "Nothing in this view" : "No disputes"}>
                {visible.length ? "Try another view or clear the filters." : "Raise a dispute from a statement line on My compensation, or with the button above."}
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] text-xs">
                  <thead>
                    <tr className={THEAD_ROW}>
                      <th className={cn(TH, "pl-4")}>Dispute</th>
                      <th className={TH}>Employee</th>
                      <th className={TH}>Concerns</th>
                      <th className={TH}>Handler</th>
                      <th className={TH}>Stage</th>
                      <th className={TH}>Deadline</th>
                      <th className={cn(TH, "text-right")} title="Business days since raised">
                        Age
                      </th>
                      <th className={cn(TH, "pr-4 text-right")}>Figure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => {
                      const raiser = users.find((u) => u.id === d.raisedById);
                      const ini = initiatives.find((i) => i.id === d.initiativeId);
                      const waiting = awaitsUser(d, access.userId, profiles);
                      return (
                        <tr
                          key={d.id}
                          tabIndex={0}
                          onClick={() => router.push(`/disputes/${d.id}`)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") router.push(`/disputes/${d.id}`);
                            if (e.key === "j" || e.key === "ArrowDown") (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
                            if (e.key === "k" || e.key === "ArrowUp") (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
                          }}
                          className="cursor-pointer border-b border-sg-line align-top last:border-b-0 hover:bg-sg-card-2/50 focus-visible:bg-sg-card-2/70 focus-visible:outline-none"
                        >
                          <td className="py-2 pl-4 pr-2">
                            <Link href={`/disputes/${d.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-sg-white hover:underline">
                              {d.subject}
                            </Link>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-sg-dim">
                              <span className="sg-num">{d.number}</span>
                              {d.late && <span className="text-soft-orange">raised late</span>}
                              {waiting && <span className="font-semibold text-soft-yellow">waiting on you</span>}
                              {d.demo && <span className="text-soft-blue">sample</span>}
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <span className="flex items-center gap-1.5">
                              <Avatar user={raiser} size="xs" /> <span className="text-sg-text">{raiser?.name ?? d.raisedById}</span>
                            </span>
                          </td>
                          <td className="px-2 py-2">
                            <div className="text-sg-text">{DISPUTE_CATEGORY_META[d.category].label}</div>
                            <div className="max-w-[220px] truncate text-2xs text-sg-dim">
                              {ini?.title ?? "No project"}
                              {d.runMonth ? ` · ${cycleLabel(d.runMonth, true)}` : ""}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-sg-muted">{d.stage === "direct" ? name(d.handlerId) : d.stage === "prc" ? "PRC" : d.stage === "exco" ? "Executive Committee" : "—"}</td>
                          <td className="px-2 py-2">
                            <DisputeStageChip d={d} />
                            {d.stage === "direct" && d.proposal && <div className="mt-0.5 text-2xs text-sg-dim">proposal awaiting the employee</div>}
                          </td>
                          <td className="px-2 py-2">
                            <DisputeSlaChip d={d} now={now} />
                            {d.dueAt && d.stage !== "closed" && <div className="mt-0.5 text-2xs text-sg-dim">{formatDate(d.dueAt, "medium")}</div>}
                            {d.stage === "closed" && <span className="text-2xs text-sg-dim">closed {formatDate(d.closedAt, "medium")}</span>}
                          </td>
                          <td className="sg-num px-2 py-2 text-right text-sg-muted">{businessDaysBetween(d.raisedAt, d.closedAt ?? new Date(now).toISOString())} bd</td>
                          <td className="py-2 pl-2 pr-4 text-right">{d.amount != null && access.seePayOf(d.raisedById) ? <RpFull value={d.amount} className="text-sg-text" /> : <span className="text-sg-dim">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-2xs text-sg-dim">
            <Kbd>j</Kbd> / <Kbd>k</Kbd> move between rows, <Kbd>Enter</Kbd> opens. This process does not limit an employee&apos;s rights under Indonesian industrial relations law, including bipartite negotiation (§14).
          </p>
        </div>
      </div>
      {raising && <RaiseDisputeModal open={raising} onOpenChange={setRaising} prefill={{}} />}
    </div>
  );
}
