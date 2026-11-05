"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, BadgeCheck, Download, Kanban, ListChecks, ListTodo, Pencil, Plus, UserMinus, Users } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { InitiativeMember } from "@/lib/initiatives/types";
import { ROLE_META } from "@/lib/initiatives/policy";
import { csvFilename, downloadCsv } from "@/lib/csv";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Avatar, Chip, EmptyState } from "@/components/ui/misc";
import { Modal } from "@/components/ui/overlays";
import { Textarea, Field, Input } from "@/components/ui/input";
import { RoleChips, StatusChip, TypeChip } from "@/components/initiatives/shared";
import { pct, rateLabel, type ProjectRegister } from "./model";
import { ComplianceList, ComplianceSummary, PolicyRef, useProjectRegister } from "./shared";
import { MemberDialog } from "./member-dialog";
import { FiguresCard, RatifyDialog } from "./figures-card";
import { PaymentsCard } from "./payments-card";
import { StatusUpdatesCard } from "./status-updates";
import { CoiCard } from "@/components/initiatives/coi";
import { ChangeOrdersCard } from "./change-orders";
import { useAccess } from "@/lib/access-control";
import { amendmentCount, amendmentIssues, isPastDay, lastDayEnd, openLeads, prcCanDecide, requiresAmendment, todayWib, wibDay } from "@/lib/initiatives/team-rules";

export function ProjectRegisterView({ id }: { id: string }) {
  const reg = useProjectRegister(id);
  if (!reg)
    return (
      <div className="p-10">
        <EmptyState icon={Users} title="Project not found" action={<Link href="/projects" className="text-sm font-semibold text-sg-white hover:underline">Back to the register</Link>}>
          It may have been removed.
        </EmptyState>
      </div>
    );
  return <Register reg={reg} />;
}

function Register({ reg }: { reg: ProjectRegister }) {
  const { ini, rate, econ } = reg;
  const users = useCrm((s) => s.users);
  const projects = useCrm((s) => s.projects);
  const [editing, setEditing] = useState<InitiativeMember | null>(null);
  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState<InitiativeMember | null>(null);
  const [ratifying, setRatifying] = useState(false);
  const closeOverdueAmendments = useCrm((s) => s.closeOverdueAmendments);
  // §6.8.2 resolve amendments whose 5-business-day vote has ended before showing the panel
  useEffect(() => {
    const n = closeOverdueAmendments();
    if (n) useUi.getState().notify(`${n} amendment${n === 1 ? "" : "s"} closed — the 5-business-day vote ended (§6.8)`);
  }, [closeOverdueAmendments]);
  const jira = projects.find((p) => p.id === ini.jiraProjectId);
  const userName = (uid: string) => users.find((u) => u.id === uid)?.name ?? uid;
  const othersE = (m: InitiativeMember | null) => reg.rows.filter((r) => r.member.id !== m?.id).reduce((s, r) => s + r.E, 0);

  const exportCsv = () =>
    downloadCsv(csvFilename(`register-${ini.title.toLowerCase().replace(/\W+/g, "-")}`), reg.rows, [
      { header: "Member", value: (r) => r.user?.name ?? r.member.userId },
      { header: "Roles", value: (r) => r.member.roles.map((x) => ROLE_META[x].label).join(" + ") },
      { header: "W", value: (r) => r.W },
      { header: "Standard W", value: (r) => r.standardW },
      { header: "A", value: (r) => r.A },
      { header: "E = W×A", value: (r) => r.E },
      { header: "Share of pool", value: (r) => (r.shareOfPool * 100).toFixed(2) + "%" },
      { header: "% of net revenue", value: (r) => (r.pctOfNet * 100).toFixed(3) + "%" },
      { header: "% of revenue", value: (r) => (r.pctOfRevenue == null ? "" : (r.pctOfRevenue * 100).toFixed(3) + "%") },
      { header: "Expected bonus (IDR)", value: (r) => r.expectedBonus ?? "" },
      { header: "Type C minimum / month (IDR)", value: (r) => r.monthlyMinimum ?? "" },
      { header: "Start on team", value: (r) => r.member.joinedAt.slice(0, 10) },
      { header: "Signed Annex D", value: (r) => (r.member.consent === "accepted" ? "yes" : "no") },
      { header: "Line manager agreed", value: (r) => (r.member.managerApproved ? "yes" : "no") },
      { header: "Considerations", value: (r) => r.member.weightNote ?? "" },
      { header: "Authority", value: (r) => r.member.authority ?? "" },
    ]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={ini.title}
        crumbs={[{ href: "/projects", label: "Ongoing projects" }]}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <TypeChip type={ini.type} long />
            <StatusChip status={ini.status} />
            {ini.demo ? <Chip color="blue">Sample</Chip> : null}
            {ini.pilot ? <Chip color="green">v4.0 pilot</Chip> : null}
            <span className="sg-num text-xs text-sg-dim">{ini.code ?? "No project code yet"}</span>
            <ComplianceSummary failing={reg.failing} warnings={reg.warnings} />
          </div>
        }
      >
        {jira ? (
          <div className="flex items-center gap-1">
            <Link href={`/board?project=${jira.id}`} className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-semibold text-sg-muted hover:bg-sg-card hover:text-sg-white" title={`${jira.key} board`}>
              <Kanban className="size-3.5" /> Board
            </Link>
            <Link href={`/backlog?project=${jira.id}`} className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-semibold text-sg-muted hover:bg-sg-card hover:text-sg-white">
              <ListChecks className="size-3.5" /> Backlog
            </Link>
            <Link href={`/issues?project=${jira.id}`} className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-semibold text-sg-muted hover:bg-sg-card hover:text-sg-white">
              <ListTodo className="size-3.5" /> Issues
            </Link>
          </div>
        ) : null}
        <Link href={`/initiatives/${ini.id}`} className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-semibold text-sg-muted hover:bg-sg-card hover:text-sg-white">
          Full record <ArrowUpRight className="size-3.5" />
        </Link>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!reg.rows.length}>
          <Download /> CSV
        </Button>
        {!ini.code ? (
          <Button size="sm" variant="primary" onClick={() => setRatifying(true)}>
            <BadgeCheck /> PRC ratification
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setRatifying(true)}>
            <BadgeCheck /> Rate & notes
          </Button>
        )}
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 pb-10 pt-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0 space-y-4">
            {/* compensation summary */}
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Revenue-share rate y" value={pct(rate.rate, 3)} hint={`${rateLabel(rate)} · §5.1`} />
              <Kpi label="Team share of revenue" value={reg.teamPctOfRevenue != null ? pct(reg.teamPctOfRevenue, 2) : "—"} hint={reg.netToRevenue != null ? `y × net ÷ revenue (${pct(reg.netToRevenue, 1)}) in the expected case` : "Enter the expected case"} />
              <Kpi label="Expected bonus pool" value={econ.expected.revenue > 0 ? formatIDR(econ.expected.pool) : "—"} hint={`${reg.months} months · x ${formatIDR(rate.x)}`} />
              {ini.type === "C" ? (
                <Kpi label="Guaranteed minimum" value={`${formatIDR(ini.standardBonus ?? 1_000_000)}/mo`} hint="Standard bonus, topped up until revenue takes over (§8.6)" />
              ) : (
                <Kpi label="Collected so far" value={formatIDR(reg.collected.revenue)} hint={`${reg.collected.payments} payment${reg.collected.payments === 1 ? "" : "s"} · pool ${formatIDR(reg.collected.pool)}`} />
              )}
            </section>

            {/* register */}
            <section className="rounded-xl border border-sg-line bg-sg-card">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-sg-line px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-sm font-extrabold text-sg-white">Team register</h2>
                  <PolicyRef s="6.5" />
                  <span className="text-2xs text-sg-dim">B = E ÷ ΣE × y × net revenue, E = W × A × days on the team (§6.6)</span>
                </div>
                <Button size="xs" variant="primary" onClick={() => setAdding(true)}>
                  <Plus /> Add person
                </Button>
              </header>
              {reg.rows.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[920px] text-sm">
                    <thead>
                      <tr className="text-left text-2xs uppercase tracking-wider text-sg-dim">
                        <th className="px-4 py-2 font-semibold">Who</th>
                        <th className="px-2 py-2 font-semibold">Role</th>
                        <th className="px-2 py-2 text-right font-semibold" title="Combined role weight (§6.1–6.3)">W</th>
                        <th className="px-2 py-2 text-right font-semibold" title="Allocation factor (§6.4)">A</th>
                        <th className="px-2 py-2 text-right font-semibold">Pool share</th>
                        <th className="px-2 py-2 text-right font-semibold">% of net</th>
                        <th className="px-2 py-2 text-right font-semibold">% of revenue</th>
                        <th className="px-2 py-2 text-right font-semibold">{ini.type === "C" ? "Min. / month" : "Expected"}</th>
                        <th className="px-2 py-2 font-semibold">Considerations</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sg-line">
                      {reg.rows.map((r) => (
                        <tr key={r.member.id} className="align-top">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <Avatar user={r.user} size="sm" />
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-sg-white">{r.user?.name ?? r.member.userId}</div>
                                <div className="text-2xs text-sg-dim">
                                  since {formatDate(r.member.joinedAt, "short")}
                                  {r.member.consent !== "accepted" ? " · unsigned" : ""}
                                  {!r.member.managerApproved ? " · no manager OK" : ""}
                                </div>
                              </div>
                            </div>
                            {r.issues.length ? (
                              <ul className="mt-1 space-y-0.5">
                                {r.issues.map((x) => (
                                  <li key={x} className="text-2xs text-soft-red">
                                    {x}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </td>
                          <td className="px-2 py-2.5">
                            <RoleChips roles={r.member.roles} />
                          </td>
                          <td className="sg-num px-2 py-2.5 text-right text-sg-white">
                            {r.W}
                            {r.nonStandard ? <div className="text-2xs text-soft-orange">std {r.standardW}</div> : null}
                          </td>
                          <td className={cn("sg-num px-2 py-2.5 text-right", r.A < 1 ? "text-soft-orange" : "text-sg-muted")}>{r.A}</td>
                          <td className="sg-num px-2 py-2.5 text-right text-sg-muted">{pct(r.shareOfPool, 1)}</td>
                          <td className="sg-num px-2 py-2.5 text-right font-semibold text-sg-white">{pct(r.pctOfNet, 3)}</td>
                          <td className="sg-num px-2 py-2.5 text-right text-sg-muted">{pct(r.pctOfRevenue, 3)}</td>
                          <td className="sg-num px-2 py-2.5 text-right text-sg-muted">{ini.type === "C" ? formatIDR(r.monthlyMinimum ?? 0, "full") : r.expectedBonus != null ? formatIDR(r.expectedBonus) : "—"}</td>
                          <td className="max-w-[220px] px-2 py-2.5 text-xs text-sg-muted">
                            {r.member.weightNote || <span className="text-sg-dim">Standard</span>}
                            {r.member.authority && !r.member.authority.startsWith("Role and Weight Agreement") ? <div className="text-2xs text-sg-dim">{r.member.authority}</div> : null}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right">
                            <Button size="icon-sm" variant="ghost" aria-label={`Edit ${r.user?.name}`} onClick={() => setEditing(r.member)}>
                              <Pencil />
                            </Button>
                            <Button size="icon-sm" variant="ghost" aria-label={`End ${r.user?.name} on the team`} onClick={() => setEnding(r.member)}>
                              <UserMinus />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-sg-line text-xs">
                        <td className="px-4 py-2 font-semibold text-sg-muted" colSpan={2}>
                          Team · ΣE {reg.totalE.toFixed(2)}
                        </td>
                        <td colSpan={2} />
                        <td className="sg-num px-2 py-2 text-right text-sg-muted">100%</td>
                        <td className="sg-num px-2 py-2 text-right font-semibold text-sg-white">{pct(rate.rate, 3)}</td>
                        <td className="sg-num px-2 py-2 text-right text-sg-muted">{pct(reg.teamPctOfRevenue, 3)}</td>
                        <td className="sg-num px-2 py-2 text-right text-sg-muted">{ini.type === "C" ? formatIDR(ini.standardBonus ?? 1_000_000, "full") : econ.expected.revenue > 0 ? formatIDR(econ.expected.pool) : "—"}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="px-4 py-8">
                  <EmptyState icon={Users} title={`Who is working on ${ini.title}?`} action={<Button variant="primary" onClick={() => setAdding(true)}><Plus /> Add person</Button>}>
                    Add each person with their role(s), weight and allocation factor. People not yet in the system can be added as new staff. No work counts toward a bonus until the Role and Weight Agreement is in place (§6.7).
                  </EmptyState>
                </div>
              )}
            </section>

            {reg.openAmendments.length ? <Amendments reg={reg} /> : null}

            {reg.closedRows.length ? (
              <section className="rounded-xl border border-sg-line bg-sg-card">
                <header className="flex items-center gap-2 border-b border-sg-line px-4 py-2.5">
                  <h2 className="font-display text-sm font-extrabold text-sg-white">Ledger history</h2>
                  <PolicyRef s="annex-d" />
                  <span className="text-2xs text-sg-dim">Closed rows still earn their share of payments for work periods while on the team (§6.5)</span>
                </header>
                <ul className="divide-y divide-sg-line text-xs">
                  {reg.closedRows.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sg-muted">
                      <span className="font-semibold text-sg-white">{userName(m.userId)}</span>
                      <RoleChips roles={m.roles} />
                      <span className="sg-num">A {m.allocationFactor ?? 1}</span>
                      <span>
                        {formatDate(m.joinedAt, "short")} – {m.leftAt ? formatDate(m.leftAt, "short") : "—"}
                      </span>
                      <span className="text-sg-dim">{m.consent === "declined" ? "declined" : m.removal.stage === "removed" ? "removed (§7.5)" : m.authority}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <StatusUpdatesCard ini={ini} />
            <PaymentsCard ini={ini} />
            <ChangeOrdersCard ini={ini} />
          </div>

          <aside className="space-y-4">
            <section className="rounded-xl border border-sg-line bg-sg-card">
              <header className="flex items-center justify-between border-b border-sg-line px-4 py-2.5">
                <h2 className="font-display text-sm font-extrabold text-sg-white">Policy compliance</h2>
                <ComplianceSummary failing={reg.failing} warnings={reg.warnings} />
              </header>
              <div className="px-4">
                <ComplianceList items={reg.compliance} compact />
              </div>
            </section>
            <FiguresCard reg={reg} />
            <CoiCard ini={ini} />
          </aside>
        </div>
      </div>

      <MemberDialog ini={ini} open={adding} onOpenChange={setAdding} othersE={othersE(null)} rate={rate.rate} />
      <MemberDialog ini={ini} open={!!editing} onOpenChange={(o) => !o && setEditing(null)} member={editing} othersE={othersE(editing)} rate={rate.rate} />
      <EndDialog reg={reg} member={ending} onClose={() => setEnding(null)} />
      <RatifyDialog reg={reg} open={ratifying} onOpenChange={setRatifying} />
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-sg-line bg-sg-card px-4 py-3">
      <div className="sg-eyebrow">{label}</div>
      <div className="sg-num mt-1 font-display text-xl font-extrabold text-sg-white">{value}</div>
      {hint ? <div className="mt-0.5 text-2xs text-sg-dim">{hint}</div> : null}
    </div>
  );
}

function Amendments({ reg }: { reg: ProjectRegister }) {
  const users = useCrm((s) => s.users);
  const members = useCrm((s) => s.initiativeMembers);
  const initiatives = useCrm((s) => s.initiatives);
  const profiles = useCrm((s) => s.employeeProfiles);
  const currentUserId = useCrm((s) => s.currentUserId);
  const recordAmendmentVote = useCrm((s) => s.recordAmendmentVote);
  const prcDecideAmendment = useCrm((s) => s.prcDecideAmendment);
  const notify = useUi((s) => s.notify);
  const access = useAccess();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? id;
  const describe = (a: ProjectRegister["openAmendments"][number]) => {
    const c = a.change;
    if (c.kind === "add") return `Add ${name(c.userId)} — ${c.roles.map((r) => ROLE_META[r].label).join(" + ")}, A ${c.allocationFactor}`;
    const m = members.find((x) => x.id === c.memberId);
    if (c.kind === "remove") return `End ${m ? name(m.userId) : "member"} on the team`;
    return `Change ${m ? name(m.userId) : "member"} — ${c.roles.map((r) => ROLE_META[r].label).join(" + ")}, A ${c.allocationFactor}${c.weightOverride != null ? `, W ${c.weightOverride}` : ""}`;
  };
  return (
    <section className="rounded-xl border border-sg-line bg-sg-card">
      <header className="flex flex-wrap items-center gap-2 border-b border-sg-line px-4 py-2.5">
        <h2 className="font-display text-sm font-extrabold text-sg-white">Open amendments</h2>
        <PolicyRef s="6.8" />
        <span className="text-2xs text-sg-dim">Passes when more than half of current members vote for it within 5 business days; a tie goes to the PRC</span>
      </header>
      <ul className="divide-y divide-sg-line">
        {reg.openAmendments.map((a) => {
          const count = amendmentCount(a, members);
          const mine = a.votes.find((v) => v.userId === currentUserId);
          const canVote = a.status === "open" && count.voters.includes(currentUserId);
          const issues = amendmentIssues(a, reg.ini, { initiatives, members, profiles });
          const note = notes[a.id] ?? "";
          const decide = (outcome: "passed" | "failed" | "blocked") => {
            if (!prcCanDecide(a)) return;
            if (outcome === "blocked" && (!issues.length || note.trim().length < 5)) return;
            prcDecideAmendment(a.id, outcome, note.trim() || (outcome === "passed" ? "PRC deciding vote for" : "PRC deciding vote against"));
            setNotes((n) => ({ ...n, [a.id]: "" }));
            notify(outcome === "blocked" ? "Amendment blocked by the PRC — breaks the policy" : outcome === "passed" ? "PRC passed the amendment — ledger updated" : "PRC rejected the amendment");
          };
          return (
            <li key={a.id} className="space-y-2 px-4 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sg-white">{describe(a)}</div>
                  <div className="text-2xs text-sg-dim">
                    From {formatDate(a.effectiveDate, "short")} · proposed by {name(a.proposedById)} · {count.yes} for / {count.no} against of {count.n} current member{count.n === 1 ? "" : "s"} (needs {count.need})
                    {a.status === "tied" ? " · tied — PRC decides" : ""}
                  </div>
                  {a.reason ? <div className="text-xs text-sg-muted">{a.reason}</div> : null}
                  {issues.length ? <div className="text-2xs text-soft-red">Policy issues: {issues.join("; ")}</div> : null}
                </div>
                {canVote ? (
                  <div className="flex gap-1">
                    <Button size="xs" variant={mine?.vote === "for" ? "primary" : "outline"} onClick={() => (recordAmendmentVote(a.id, currentUserId, "for", ""), notify("You voted for"))}>
                      For
                    </Button>
                    <Button size="xs" variant={mine?.vote === "against" ? "danger" : "outline"} onClick={() => (recordAmendmentVote(a.id, currentUserId, "against", ""), notify("You voted against"))}>
                      Against
                    </Button>
                  </div>
                ) : null}
                <Link href={`/initiatives/${a.initiativeId}?tab=team`} className="text-xs font-semibold text-sg-muted hover:text-sg-white" title="Votes for other members are recorded on the Team tab from their signed forms">
                  Open on Team tab
                </Link>
              </div>
              {access.prc && prcCanDecide(a) && (a.status === "tied" || issues.length) ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-sg-line p-2">
                  <Input value={note} onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))} placeholder={a.status === "tied" ? "Reason for the PRC deciding vote" : "Which rule the amendment breaks"} aria-label="PRC note" className="h-7 min-w-[200px] flex-1 text-xs" />
                  {a.status === "tied" ? (
                    <>
                      <Button size="xs" variant="primary" onClick={() => decide("passed")}>
                        PRC: pass
                      </Button>
                      <Button size="xs" variant="outline" onClick={() => decide("failed")}>
                        PRC: reject
                      </Button>
                    </>
                  ) : null}
                  {issues.length ? (
                    <Button size="xs" variant="danger" disabled={note.trim().length < 5} onClick={() => decide("blocked")}>
                      Block
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EndDialog({ reg, member, onClose }: { reg: ProjectRegister; member: InitiativeMember | null; onClose: () => void }) {
  const users = useCrm((s) => s.users);
  const members = useCrm((s) => s.initiativeMembers);
  const updateMember = useCrm((s) => s.updateMember);
  const proposeAmendment = useCrm((s) => s.proposeAmendment);
  const notify = useUi((s) => s.notify);
  const [date, setDate] = useState(todayWib());
  const [reason, setReason] = useState("");
  // reset every time the dialog opens for a (different) member
  useEffect(() => {
    if (member) {
      setDate(todayWib());
      setReason("");
    }
  }, [member]);
  const name = useMemo(() => users.find((u) => u.id === member?.userId)?.name ?? "", [users, member]);
  const amend = requiresAmendment(reg.ini, members);
  const joinedDay = member ? wibDay(member.joinedAt) : "";
  const leavesNoLead = !!member?.roles.includes("project_lead") && !openLeads(members, reg.ini.id, member.id).length;
  const errors: string[] = [];
  if (!date) errors.push("Choose the last day");
  else {
    // after the ledger exists changes apply forward only; while it is being set up from existing records (§15.1) a past last day is allowed
    if (amend && isPastDay(date)) errors.push("Amendments apply from their effective date forward — never to past work (§6.8 step 6)");
    if (joinedDay && date < joinedDay) errors.push(`The last day can't be before they joined (${formatDate(member!.joinedAt, "short")})`);
  }
  if (leavesNoLead) errors.push("This leaves the project without a Project Lead — delegate the role first (§6.1, §4.9)");
  if (amend && reason.trim().length < 5) errors.push("State the reason (circulated with the amendment)");
  const end = () => {
    if (!member || errors.length) return;
    if (amend) {
      const id = proposeAmendment(reg.ini.id, { kind: "remove", memberId: member.id }, lastDayEnd(date), reason.trim() || `${name} leaves the team`);
      const status = useCrm.getState().teamAmendments.find((a) => a.id === id)?.status;
      notify(status === "passed" ? `${name} ends on the team ${date} — ledger updated` : "Amendment circulated to the team (§6.8)");
    } else {
      updateMember(member.id, { leftAt: lastDayEnd(date), weightNote: [member.weightNote, reason && `Left: ${reason}`].filter(Boolean).join(" · ") });
      notify(`${name} ends on the team ${date}`);
    }
    onClose();
  };
  return (
    <Modal
      open={!!member}
      onOpenChange={(o) => !o && onClose()}
      title={`End ${name} on the team`}
      description="They keep their share of payments for work periods while they were on the team, provided they are still eligible on the payment date (§6.5, §10). Removal for poor performance follows §7.5 instead."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={errors.length > 0} title={errors.join("\n")} onClick={end}>
            {amend ? "Circulate amendment" : "End on team"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Last day on the team" hint="Counts in full — the row closes at 23:59 WIB">
          <Input type="date" lang="en-GB" min={amend ? [todayWib(), joinedDay].sort().pop() : joinedDay || undefined} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={amend ? "Reason (required)" : "Reason"}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {errors.length && (date || reason) ? (
          <ul className="space-y-0.5 text-2xs text-soft-yellow">
            {errors.map((e) => (
              <li key={e}>• {e}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Modal>
  );
}
