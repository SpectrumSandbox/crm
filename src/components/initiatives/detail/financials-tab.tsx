"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { ArrowUpRight, Banknote, Check, Coins, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { Initiative, RevenueEntry } from "@/lib/initiatives/types";
import { computeRun, monthKey, monthStart, netRevenue, paidInYear, projectShare } from "@/lib/initiatives/engine";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Avatar, Chip, EmptyState } from "@/components/ui/misc";
import { Cite, Money, Pct } from "@/components/initiatives/shared";
import { Card, onCmdEnter } from "./ui";

const FIN_STATUSES = new Set(["approved", "active", "completed"]);
/** EBITDA large enough that the 5 % of EBITDA pool cap never binds in the projection. */
const NO_CAP_EBITDA = 1e18;

type Draft = { month: string; basis: RevenueEntry["basis"]; received: boolean; revenue: string; directCosts: string; note: string };

const emptyDraft = (): Draft => ({ month: monthKey(new Date()), basis: "recognized", received: false, revenue: "", directCosts: "", note: "" });
const toDraft = (e: RevenueEntry): Draft => ({ month: e.month, basis: e.basis, received: e.received, revenue: String(e.revenue), directCosts: String(e.directCosts), note: e.note ?? "" });
const num = (s: string) => {
  const n = Number(String(s).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export function FinancialsTab({ ini }: { ini: Initiative }) {
  if (!FIN_STATUSES.has(ini.status)) {
    return (
      <div className="rounded-xl border border-sg-line bg-sg-card">
        <EmptyState icon={Lock} title="Financials open after PRC approval">
          Monthly revenue is recorded against approved, active or completed projects. Bonuses are computed from recognised revenue (or received milestone payments) less direct costs and estimated taxes (§3.4, §4.4).
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <RevenueCard ini={ini} />
      <BonusByMember ini={ini} />
    </div>
  );
}

function RevenueCard({ ini }: { ini: Initiative }) {
  const allEntries = useCrm((s) => s.revenueEntries);
  const adjustments = useCrm((s) => s.shareAdjustments);
  const addRevenueEntry = useCrm((s) => s.addRevenueEntry);
  const updateRevenueEntry = useCrm((s) => s.updateRevenueEntry);
  const deleteRevenueEntry = useCrm((s) => s.deleteRevenueEntry);
  const notify = useUi((s) => s.notify);
  const [editing, setEditing] = useState<string | null>(null); // entry id or "new"
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      allEntries
        .filter((e) => e.initiativeId === ini.id)
        .sort((a, b) => b.month.localeCompare(a.month))
        .map((e) => {
          const { tax, net } = netRevenue(e.revenue, e.directCosts);
          const share = projectShare(ini, adjustments, monthStart(e.month));
          const counts = e.basis === "recognized" || e.received;
          return { e, tax, net, share, pool: Math.max(0, net) * share, counts };
        }),
    [allEntries, ini, adjustments],
  );
  const totals = useMemo(
    () =>
      rows.reduce(
        (s, r) => ({ revenue: s.revenue + r.e.revenue, costs: s.costs + r.e.directCosts, tax: s.tax + r.tax, net: s.net + r.net, pool: s.pool + (r.counts ? r.pool : 0) }),
        { revenue: 0, costs: 0, tax: 0, net: 0, pool: 0 },
      ),
    [rows],
  );

  const startNew = () => {
    setDraft(emptyDraft());
    setEditing("new");
  };
  const startEdit = (e: RevenueEntry) => {
    setDraft(toDraft(e));
    setEditing(e.id);
  };
  const cancel = () => setEditing(null);
  const valid = /^\d{4}-\d{2}$/.test(draft.month) && num(draft.revenue) >= 0 && num(draft.directCosts) >= 0 && draft.revenue.trim() !== "";
  const save = () => {
    if (!valid) return;
    const payload = { month: draft.month, basis: draft.basis, received: draft.basis === "recognized" ? true : draft.received, revenue: num(draft.revenue), directCosts: num(draft.directCosts), note: draft.note.trim() };
    if (editing === "new") {
      addRevenueEntry({ initiativeId: ini.id, ...payload });
      notify(`Revenue recorded for ${payload.month}`);
    } else if (editing) {
      updateRevenueEntry(editing, payload);
      notify(`Revenue entry ${payload.month} updated`);
    }
    setEditing(null);
  };

  const editor = (
    <tr className="border-b border-sg-line bg-sg-card-2/60 align-top" onKeyDown={onCmdEnter(save)}>
      <td className="px-3 py-2">
        <Input type="month" value={draft.month} onChange={(e) => setDraft({ ...draft, month: e.target.value })} className="h-7 w-[132px] text-xs" aria-label="Month" autoFocus />
      </td>
      <td className="px-2 py-2">
        <Select value={draft.basis} onChange={(e) => setDraft({ ...draft, basis: e.target.value as RevenueEntry["basis"] })} className="h-7 text-xs" wrapperClassName="w-[120px]" aria-label="Basis">
          <option value="recognized">Recognized</option>
          <option value="milestone">Milestone</option>
        </Select>
      </td>
      <td className="px-2 py-2 text-center">
        <input type="checkbox" checked={draft.basis === "recognized" || draft.received} disabled={draft.basis === "recognized"} onChange={(e) => setDraft({ ...draft, received: e.target.checked })} aria-label="Payment received" className="mt-1.5 size-3.5 cursor-pointer accent-white disabled:opacity-40" />
      </td>
      <td className="px-2 py-2">
        <Input type="number" min={0} step={1000} value={draft.revenue} onChange={(e) => setDraft({ ...draft, revenue: e.target.value })} placeholder="Revenue" className="h-7 w-[130px] text-right text-xs" aria-label="Revenue" />
      </td>
      <td className="px-2 py-2">
        <Input type="number" min={0} step={1000} value={draft.directCosts} onChange={(e) => setDraft({ ...draft, directCosts: e.target.value })} placeholder="Direct costs" className="h-7 w-[130px] text-right text-xs" aria-label="Direct costs" />
      </td>
      <td colSpan={4} className="px-2 py-2">
        <Input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Note (invoice no., milestone…)" className="h-7 text-xs" aria-label="Note" />
        {(() => {
          const { tax, net } = netRevenue(num(draft.revenue), num(draft.directCosts));
          const share = projectShare(ini, adjustments, /^\d{4}-\d{2}$/.test(draft.month) ? monthStart(draft.month) : new Date().toISOString());
          return (
            <div className="mt-1 text-2xs text-sg-dim">
              Tax <Money value={tax} /> · P <Money value={net} /> · pool <Money value={Math.max(0, net) * share} /> at <Pct value={share} />
            </div>
          );
        })()}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex justify-end gap-1">
          <Button size="icon-sm" variant="primary" onClick={save} disabled={!valid} aria-label="Save entry" title="Save (⌘↵)">
            <Check />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={cancel} aria-label="Cancel">
            <X />
          </Button>
        </div>
      </td>
    </tr>
  );

  return (
    <Card
      title="Monthly revenue"
      icon={Banknote}
      cite={["3.4", "4.4"]}
      actions={
        <Button size="sm" variant="primary" onClick={startNew} disabled={editing === "new"}>
          <Plus /> Add month
        </Button>
      }
      bodyClassName="p-0 overflow-x-auto"
    >
      <table className="w-full min-w-[920px] text-xs">
        <thead>
          <tr className="border-b border-sg-line text-left">
            <th className="sg-eyebrow px-3 py-2 font-semibold">Month</th>
            <th className="sg-eyebrow px-2 py-2 font-semibold">Basis</th>
            <th className="sg-eyebrow px-2 py-2 text-center font-semibold">Received</th>
            <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Revenue</th>
            <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Direct costs</th>
            <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Est. tax 22%</th>
            <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Net revenue P</th>
            <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Share R</th>
            <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Pool</th>
            <th className="w-20 px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {editing === "new" ? editor : null}
          {rows.length === 0 && editing !== "new" ? (
            <tr>
              <td colSpan={10} className="px-4 py-8 text-center text-sg-dim">
                No revenue recorded yet. Add the first month to see the bonus pool.
              </td>
            </tr>
          ) : null}
          {rows.map((r) =>
            editing === r.e.id ? (
              <Fragment key={r.e.id}>{editor}</Fragment>
            ) : (
              <tr key={r.e.id} className="group border-b border-sg-line/60 hover:bg-sg-card-2/40">
                <td className="sg-num px-3 py-2 font-semibold text-sg-white">
                  {r.e.month}
                  {r.e.note ? <div className="max-w-[160px] truncate text-2xs font-normal text-sg-dim" title={r.e.note}>{r.e.note}</div> : null}
                </td>
                <td className="px-2 py-2">
                  <Chip color={r.e.basis === "recognized" ? "blue" : "magenta"}>{r.e.basis === "recognized" ? "Recognized" : "Milestone"}</Chip>
                </td>
                <td className="px-2 py-2 text-center">
                  {r.e.basis === "milestone" ? (
                    <input
                      type="checkbox"
                      checked={r.e.received}
                      onChange={(ev) => {
                        updateRevenueEntry(r.e.id, { received: ev.target.checked });
                        notify(ev.target.checked ? "Milestone payment received — bonus distributes in this month's run" : "Marked as not yet received");
                      }}
                      aria-label="Payment received"
                      className="size-3.5 cursor-pointer accent-white"
                    />
                  ) : (
                    <span className="text-2xs text-sg-dim">n/a</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  <Money value={r.e.revenue} className="text-sg-white" />
                </td>
                <td className="px-2 py-2 text-right">
                  <Money value={r.e.directCosts} />
                </td>
                <td className="px-2 py-2 text-right text-sg-muted">
                  <Money value={r.tax} />
                </td>
                <td className="px-2 py-2 text-right">
                  <Money value={r.net} className={r.net < 0 ? "text-soft-red" : "text-sg-white"} />
                </td>
                <td className="sg-num px-2 py-2 text-right text-sg-muted">
                  <Pct value={r.share} />
                </td>
                <td className="px-2 py-2 text-right" title={r.counts ? "" : "Milestone payment not yet received — excluded from the run (§4.4)"}>
                  <Money value={r.pool} className={r.counts ? "font-semibold text-soft-cyan" : "text-sg-dim line-through"} />
                </td>
                <td className="px-3 py-2 text-right">
                  {confirmDelete === r.e.id ? (
                    <div className="flex justify-end gap-1">
                      <Button
                        size="xs"
                        variant="danger"
                        onClick={() => {
                          deleteRevenueEntry(r.e.id);
                          setConfirmDelete(null);
                          notify(`Revenue entry ${r.e.month} deleted`);
                        }}
                      >
                        Delete
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => setConfirmDelete(null)} aria-label="Keep entry">
                        <X />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-1 opacity-60 group-hover:opacity-100">
                      <Button size="icon-sm" variant="ghost" onClick={() => startEdit(r.e)} aria-label={`Edit ${r.e.month}`}>
                        <Pencil />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => setConfirmDelete(r.e.id)} aria-label={`Delete ${r.e.month}`}>
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ),
          )}
        </tbody>
        {rows.length ? (
          <tfoot>
            <tr className="border-t border-sg-line bg-sg-bg/40 font-semibold">
              <td colSpan={3} className="px-3 py-2 text-sg-white">
                Total · {rows.length} month{rows.length === 1 ? "" : "s"}
              </td>
              <td className="px-2 py-2 text-right">
                <Money value={totals.revenue} className="text-sg-white" />
              </td>
              <td className="px-2 py-2 text-right">
                <Money value={totals.costs} />
              </td>
              <td className="px-2 py-2 text-right text-sg-muted">
                <Money value={totals.tax} />
              </td>
              <td className="px-2 py-2 text-right">
                <Money value={totals.net} className="text-sg-white" />
              </td>
              <td />
              <td className="px-2 py-2 text-right">
                <Money value={totals.pool} className="text-soft-cyan" />
              </td>
              <td />
            </tr>
          </tfoot>
        ) : null}
      </table>
      <p className="border-t border-sg-line px-4 py-2 text-2xs text-sg-dim">
        Recognized revenue counts in its month; milestone-based revenue counts once the payment is received <Cite s="4.4" />. Pool shown before the per-run caps and break-even test <Cite s="6.1" />.
      </p>
    </Card>
  );
}

type Agg = { gross: number; payable: number; deferred: number; withheld: number; forfeited: number; held: number; runs: number };
const zero = (): Agg => ({ gross: 0, payable: 0, deferred: 0, withheld: 0, forfeited: 0, held: 0, runs: 0 });

function BonusByMember({ ini }: { ini: Initiative }) {
  const bonusRuns = useCrm((s) => s.bonusRuns);
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const entries = useCrm((s) => s.revenueEntries);
  const profiles = useCrm((s) => s.employeeProfiles);
  const adjustments = useCrm((s) => s.shareAdjustments);
  const deferredBonuses = useCrm((s) => s.deferredBonuses);
  const userMap = useUserMap();
  const month = useMemo(() => monthKey(new Date()), []);

  const stored = useMemo(() => {
    const byUser = new Map<string, Agg>();
    const total = zero();
    const months: string[] = [];
    for (const run of bonusRuns) {
      const lines = run.lines.filter((l) => l.initiativeId === ini.id);
      if (!lines.length) continue;
      months.push(run.month);
      for (const l of lines) {
        const a = byUser.get(l.userId) ?? zero();
        a.gross += l.gross;
        a.payable += l.payable;
        a.deferred += l.deferred + l.carriedOver;
        a.withheld += l.withheld;
        a.forfeited += l.forfeited;
        a.held += l.held;
        a.runs += 1;
        byUser.set(l.userId, a);
        total.gross += l.gross;
        total.payable += l.payable;
        total.deferred += l.deferred + l.carriedOver;
        total.withheld += l.withheld;
        total.forfeited += l.forfeited;
        total.held += l.held;
      }
    }
    return { rows: [...byUser.entries()].sort((a, b) => b[1].gross - a[1].gross), total, months: months.sort() };
  }, [bonusRuns, ini.id]);

  const projection = useMemo(() => {
    const year = month.slice(0, 4);
    const paidYtd = new Map<string, number>();
    for (const m of members) if (m.initiativeId === ini.id) paidYtd.set(m.userId, paidInYear(m.userId, bonusRuns, year, deferredBonuses));
    const result = computeRun({ month, initiatives: initiatives.filter((i) => i.id === ini.id), members, entries, profiles, adjustments, overheads: 0, ebitda: NO_CAP_EBITDA, paidYtd });
    return { lines: result.lines, project: result.projects[0] ?? null, totals: result.totals };
  }, [month, initiatives, ini.id, members, entries, profiles, adjustments, bonusRuns, deferredBonuses]);

  const storedRun = bonusRuns.find((r) => r.month === month);
  const projTotal = projection.lines.reduce((a, l) => ({ ...a, gross: a.gross + l.gross, payable: a.payable + l.payable, deferred: a.deferred + l.deferred + l.carriedOver, withheld: a.withheld + l.withheld, forfeited: a.forfeited + l.forfeited, held: a.held + l.held }), zero());

  const cells = (a: Agg, strong?: boolean) => (
    <>
      <td className="px-2 py-2 text-right">
        <Money value={a.gross} className={strong ? "font-semibold text-sg-white" : "text-sg-white"} />
      </td>
      <td className="px-2 py-2 text-right">
        <Money value={a.payable} className="text-soft-green" />
      </td>
      <td className="px-2 py-2 text-right">
        <Money value={a.deferred} className={a.deferred ? "text-soft-orange" : "text-sg-dim"} />
      </td>
      <td className="px-2 py-2 text-right">
        <Money value={a.withheld} className={a.withheld ? "text-soft-yellow" : "text-sg-dim"} />
      </td>
      <td className="px-2 py-2 text-right">
        <Money value={a.forfeited} className={a.forfeited ? "text-soft-red" : "text-sg-dim"} />
      </td>
      <td className="px-3 py-2 text-right">
        <Money value={a.held} className={a.held ? "text-soft-magenta" : "text-sg-dim"} />
      </td>
    </>
  );

  return (
    <Card
      title="Bonus by member"
      icon={Coins}
      cite={["4.2", "6.1"]}
      actions={
        <Link href="/compensation" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Open monthly run <ArrowUpRight />
        </Link>
      }
      bodyClassName="p-0 overflow-x-auto"
    >
      <table className="w-full min-w-[760px] text-xs">
        <thead>
          <tr className="border-b border-sg-line text-left">
            <th className="sg-eyebrow px-3 py-2 font-semibold">Member</th>
            <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Gross</th>
            <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Payable</th>
            <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Deferred</th>
            <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Withheld</th>
            <th className="sg-eyebrow px-2 py-2 text-right font-semibold">Forfeited</th>
            <th className="sg-eyebrow px-3 py-2 text-right font-semibold">Held</th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-sg-bg/40">
            <td colSpan={7} className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-sg-muted">
              Stored runs{stored.months.length ? ` · ${stored.months[0]}${stored.months.length > 1 ? ` – ${stored.months[stored.months.length - 1]}` : ""} (${stored.months.length})` : ""}
            </td>
          </tr>
          {stored.rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-4 text-center text-sg-dim">
                No monthly runs include this project yet.
              </td>
            </tr>
          ) : (
            stored.rows.map(([userId, a]) => {
              const u = userMap.get(userId);
              return (
                <tr key={userId} className="border-b border-sg-line/60">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <Avatar user={u} size="xs" />
                      <span className="text-sg-text">{u?.name ?? userId}</span>
                      <span className="text-2xs text-sg-dim">{a.runs} run{a.runs === 1 ? "" : "s"}</span>
                    </span>
                  </td>
                  {cells(a)}
                </tr>
              );
            })
          )}
          {stored.rows.length ? (
            <tr className="border-b border-sg-line bg-sg-bg/30">
              <td className="px-3 py-2 font-semibold text-sg-white">Total to date</td>
              {cells({ ...stored.total }, true)}
            </tr>
          ) : null}

          <tr className="bg-sg-bg/40">
            <td colSpan={7} className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-soft-cyan">
              Projection · {month} — before break-even test
              {storedRun ? <span className="ml-2 normal-case tracking-normal text-sg-dim">(a {storedRun.status} run for this month is already stored)</span> : null}
            </td>
          </tr>
          {projection.lines.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-4 text-center text-sg-dim">
                {projection.project ? "No PRC-approved, consenting members to split the pool." : `No countable revenue recorded for ${month} — add a recognized entry or a received milestone payment.`}
              </td>
            </tr>
          ) : (
            projection.lines.map((l) => {
              const u = userMap.get(l.userId);
              return (
                <tr key={l.userId} className="border-b border-sg-line/60 italic">
                  <td className="px-3 py-2 not-italic">
                    <span className="flex items-center gap-2">
                      <Avatar user={u} size="xs" />
                      <span className="text-sg-text">{u?.name ?? l.userId}</span>
                      <span className="sg-num text-2xs text-sg-dim">
                        W {l.weight.toFixed(1)}/{l.totalWeight.toFixed(1)}
                      </span>
                      {l.notes.length ? (
                        <span className="truncate text-2xs text-sg-dim" title={l.notes.join("\n")}>
                          · {l.notes[0]}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  {cells({ ...zero(), gross: l.gross, payable: l.payable, deferred: l.deferred + l.carriedOver, withheld: l.withheld, forfeited: l.forfeited, held: l.held })}
                </tr>
              );
            })
          )}
          {projection.lines.length ? (
            <tr className="bg-sg-bg/30">
              <td className="px-3 py-2 font-semibold text-soft-cyan">Projected total</td>
              {cells(projTotal, true)}
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-sg-line px-4 py-2 text-2xs text-sg-dim")}>
        {projection.project ? (
          <span>
            {month}: P <Money value={projection.project.net} /> × R <Pct value={projection.project.sharePct} /> = pool <Money value={projection.project.pool} />
            {projection.project.capped ? " (capped at the absolute pool limit §6.2)" : ""}
          </span>
        ) : null}
        <span>Projection assumes zero overheads and no EBITDA cap; the monthly run applies the break-even test and pool caps <Cite s="6.1" /> <Cite s="6.2" />.</span>
      </div>
    </Card>
  );
}
