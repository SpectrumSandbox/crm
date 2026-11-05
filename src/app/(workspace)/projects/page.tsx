"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, Briefcase, Download, Plus, Users } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Avatar, Chip, EmptyState } from "@/components/ui/misc";
import { Tabs } from "@/components/ui/overlays";
import { RoleChips, StatusChip, TypeChip } from "@/components/initiatives/shared";
import { buildRegister, LIVE_PROJECT_STATUSES, pct, rateLabel, type ProjectRegister, type RegisterRow } from "@/components/projects/model";
import { ComplianceSummary, PolicyRef, useRegisterInputs } from "@/components/projects/shared";
import { RegisterProjectDialog } from "@/components/projects/register-project-dialog";
import { PortfolioTable } from "@/components/projects/portfolio-table";
import { HealthBadge } from "@/components/projects/status-updates";
import { updateState } from "@/lib/initiatives/team-rules";
import { useCrm } from "@/lib/store";
import { POLICY_STATUS, POLICY_VERSION, ROLE_META } from "@/lib/initiatives/policy";
import { csvFilename, downloadCsv } from "@/lib/csv";
import { cn, formatIDR } from "@/lib/utils";

type View = "projects" | "health" | "people";

export default function ProjectsRegisterPage() {
  const inp = useRegisterInputs();
  const [view, setView] = useState<View>("projects");
  const [samples, setSamples] = useState(false);
  const [registering, setRegistering] = useState(false);

  const registers = useMemo(
    () =>
      inp.initiatives
        .filter((i) => (LIVE_PROJECT_STATUSES as readonly string[]).includes(i.status) && (samples || !i.demo))
        .map((i) => buildRegister(i, inp))
        .sort((a, b) => Number(!!a.ini.demo) - Number(!!b.ini.demo) || a.ini.title.localeCompare(b.ini.title)),
    [inp, samples],
  );
  const people = useMemo(() => registers.flatMap((r) => r.rows.map((row) => ({ reg: r, row }))), [registers]);
  const distinctPeople = useMemo(() => new Set(people.map((p) => p.row.member.userId)).size, [people]);
  const failing = registers.reduce((s, r) => s + (r.failing ? 1 : 0), 0);
  const updates = useCrm((s) => s.projectUpdates);
  const health = useMemo(() => {
    let atRisk = 0;
    let due = 0;
    for (const r of registers) {
      const st = updateState(r.ini, updates);
      if (st.latest && st.latest.health !== "green") atRisk++;
      if (st.state === "due" || st.state === "overdue") due++;
    }
    return { atRisk, due };
  }, [registers, updates]);

  const exportCsv = () =>
    downloadCsv(csvFilename("project-register"), people, [
      { header: "Project", value: (p) => p.reg.ini.title },
      { header: "Project code", value: (p) => p.reg.ini.code ?? "" },
      { header: "Type", value: (p) => p.reg.ini.type },
      { header: "Revenue-share rate y", value: (p) => (p.reg.rate.rate * 100).toFixed(3) + "%" },
      { header: "Rate basis", value: (p) => rateLabel(p.reg.rate) },
      { header: "Member", value: (p) => p.row.user?.name ?? p.row.member.userId },
      { header: "Email", value: (p) => p.row.user?.email ?? "" },
      { header: "Roles", value: (p) => p.row.member.roles.map((r) => ROLE_META[r].label).join(" + ") },
      { header: "Weight W", value: (p) => p.row.W },
      { header: "Allocation factor A", value: (p) => p.row.A },
      { header: "Effective weight W×A", value: (p) => p.row.E },
      { header: "Share of pool", value: (p) => (p.row.shareOfPool * 100).toFixed(2) + "%" },
      { header: "% of net revenue", value: (p) => (p.row.pctOfNet * 100).toFixed(3) + "%" },
      { header: "% of revenue", value: (p) => (p.row.pctOfRevenue == null ? "" : (p.row.pctOfRevenue * 100).toFixed(3) + "%") },
      { header: "Expected bonus (IDR)", value: (p) => p.row.expectedBonus ?? "" },
      { header: "Type C minimum share / month (IDR)", value: (p) => p.row.monthlyMinimum ?? "" },
      { header: "Start on team", value: (p) => p.row.member.joinedAt.slice(0, 10) },
      { header: "Considerations", value: (p) => p.row.member.weightNote ?? "" },
      { header: "Authority", value: (p) => p.row.member.authority ?? "" },
      { header: "Issues", value: (p) => p.row.issues.join("; ") },
    ]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Ongoing projects"
        meta={
          <span className="text-xs text-sg-dim">
            Policy v{POLICY_VERSION} · {POLICY_STATUS} · who works on each project, in what role, at what weight, and what share of revenue is their compensation
          </span>
        }
      >
        <label className="flex items-center gap-1.5 text-xs text-sg-muted">
          <input type="checkbox" className="accent-white" checked={samples} onChange={(e) => setSamples(e.target.checked)} />
          Include sample projects
        </label>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!people.length}>
          <Download /> Export register
        </Button>
        <Button size="sm" variant="primary" onClick={() => setRegistering(true)}>
          <Plus /> Register project
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 pb-10 pt-4">
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Ongoing projects" value={String(registers.length)} />
          <Stat label="People on projects" value={String(distinctPeople)} />
          <Stat label="Projects with gaps" value={String(failing)} tone={failing ? "red" : "green"} />
          <Stat label="At risk / off track" value={String(health.atRisk)} tone={health.atRisk ? "red" : "green"} hint={health.due ? `${health.due} monthly update${health.due === 1 ? "" : "s"} due (§6.1)` : "All monthly updates in (§6.1)"} />
        </div>

        <Tabs<View>
          value={view}
          onChange={setView}
          items={[
            { value: "projects", label: "By project", count: registers.length },
            { value: "health", label: "Portfolio health" },
            { value: "people", label: "People register", count: people.length },
          ]}
        />

        {!registers.length ? (
          <div className="mt-6">
            <EmptyState icon={Briefcase} title="No ongoing projects" action={<Button variant="primary" onClick={() => setRegistering(true)}><Plus /> Register project</Button>}>
              Register each live project so its team, weights and compensation follow Policy v4.0.
            </EmptyState>
          </div>
        ) : view === "projects" ? (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {registers.map((r) => (
              <ProjectCard key={r.ini.id} reg={r} />
            ))}
          </div>
        ) : view === "health" ? (
          <PortfolioTable registers={registers} />
        ) : (
          <PeopleTable rows={people} />
        )}
      </div>
      <RegisterProjectDialog open={registering} onOpenChange={setRegistering} />
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "red" | "green" }) {
  return (
    <div className="rounded-xl border border-sg-line bg-sg-card px-4 py-3">
      <div className="sg-eyebrow">{label}</div>
      <div className={cn("sg-num mt-1 font-display text-xl font-extrabold", tone === "red" ? "text-soft-red" : tone === "green" ? "text-soft-green" : "text-sg-white")}>{value}</div>
      {hint ? <div className="mt-0.5 text-2xs text-sg-dim">{hint}</div> : null}
    </div>
  );
}

function ProjectCard({ reg }: { reg: ProjectRegister }) {
  const { ini, rate } = reg;
  return (
    <section className="rounded-xl border border-sg-line bg-sg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-sg-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/projects/${ini.id}`} className="font-display text-lg font-extrabold text-sg-white hover:underline">
              {ini.title}
            </Link>
            <TypeChip type={ini.type} />
            <StatusChip status={ini.status} />
            {ini.demo ? <Chip color="blue">Sample</Chip> : null}
            {ini.code ? <span className="sg-num text-2xs text-sg-dim">{ini.code}</span> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-sg-muted">
            <span>
              Rate <span className="sg-num font-semibold text-sg-white">{pct(rate.rate, 3)}</span> of net revenue · {rateLabel(rate)} <PolicyRef s="5.1" />
            </span>
            {reg.teamPctOfRevenue != null ? (
              <span>
                ≈ <span className="sg-num font-semibold text-sg-white">{pct(reg.teamPctOfRevenue, 2)}</span> of revenue
              </span>
            ) : null}
            {ini.type === "C" ? (
              <span>
                Minimum <span className="sg-num text-sg-white">{formatIDR(ini.standardBonus ?? 1_000_000, "full")}</span>/month <PolicyRef s="8.6" />
              </span>
            ) : null}
            <span>Tier {reg.tier.tier}</span>
            <HealthBadge ini={ini} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ComplianceSummary failing={reg.failing} warnings={reg.warnings} />
          <Link href={`/projects/${ini.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-sg-muted hover:text-sg-white">
            Open register <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </header>
      {reg.rows.length ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-2xs uppercase tracking-wider text-sg-dim">
              <th className="px-4 py-2 font-semibold">Who</th>
              <th className="px-2 py-2 font-semibold">Role</th>
              <th className="px-2 py-2 text-right font-semibold">W×A</th>
              <th className="px-2 py-2 text-right font-semibold">Pool</th>
              <th className="px-4 py-2 text-right font-semibold">% of net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sg-line">
            {reg.rows.map((row) => (
              <tr key={row.member.id}>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <Avatar user={row.user} size="xs" />
                    <span className="truncate text-sg-white">{row.user?.name ?? row.member.userId}</span>
                    {row.issues.length ? <span className="size-1.5 shrink-0 rounded-full bg-soft-red" title={row.issues.join("\n")} /> : null}
                  </div>
                </td>
                <td className="px-2 py-2">
                  <RoleChips roles={row.member.roles} />
                </td>
                <td className="sg-num px-2 py-2 text-right text-sg-muted">
                  {row.W}
                  {row.A < 1 ? `×${row.A}` : ""}
                </td>
                <td className="sg-num px-2 py-2 text-right text-sg-muted">{pct(row.shareOfPool, 1)}</td>
                <td className="sg-num px-4 py-2 text-right font-semibold text-sg-white">{pct(row.pctOfNet, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex items-center gap-3 px-4 py-5 text-sm text-sg-muted">
          <Users className="size-4 text-sg-dim" />
          No team registered yet — add who is working on {ini.title}, their roles and weights.
          <Link href={`/projects/${ini.id}`} className="ml-auto text-xs font-semibold text-sg-white hover:underline">
            Add team
          </Link>
        </div>
      )}
    </section>
  );
}

function PeopleTable({ rows }: { rows: { reg: ProjectRegister; row: RegisterRow }[] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-sg-line bg-sg-card">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-wider text-sg-dim">
            <th className="px-4 py-2 font-semibold">Member</th>
            <th className="px-2 py-2 font-semibold">Project</th>
            <th className="px-2 py-2 font-semibold">Roles</th>
            <th className="px-2 py-2 text-right font-semibold" title="Combined role weight (§6.1–6.3)">W</th>
            <th className="px-2 py-2 text-right font-semibold" title="Allocation factor (§6.4)">A</th>
            <th className="px-2 py-2 text-right font-semibold">Share of pool</th>
            <th className="px-2 py-2 text-right font-semibold">% of net revenue</th>
            <th className="px-2 py-2 text-right font-semibold">% of revenue</th>
            <th className="px-2 py-2 text-right font-semibold">Expected bonus</th>
            <th className="px-4 py-2 font-semibold">Considerations</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-sg-line">
          {rows.map(({ reg, row }) => (
            <tr key={row.member.id} className="align-top">
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <Avatar user={row.user} size="xs" />
                  <div className="min-w-0">
                    <div className="truncate text-sg-white">{row.user?.name ?? row.member.userId}</div>
                    {row.issues.length ? <div className="text-2xs text-soft-red">{row.issues[0]}</div> : null}
                  </div>
                </div>
              </td>
              <td className="px-2 py-2">
                <Link href={`/projects/${reg.ini.id}`} className="text-sg-white hover:underline">
                  {reg.ini.title}
                </Link>
                <div className="text-2xs text-sg-dim">
                  Type {reg.ini.type} · y {pct(reg.rate.rate, 3)}
                </div>
              </td>
              <td className="px-2 py-2">
                <RoleChips roles={row.member.roles} />
              </td>
              <td className="sg-num px-2 py-2 text-right text-sg-white">
                {row.W}
                {row.nonStandard ? <span className="text-soft-orange" title={`Standard ${row.standardW}`}>*</span> : null}
              </td>
              <td className="sg-num px-2 py-2 text-right text-sg-muted">{row.A}</td>
              <td className="sg-num px-2 py-2 text-right text-sg-muted">{pct(row.shareOfPool, 1)}</td>
              <td className="sg-num px-2 py-2 text-right font-semibold text-sg-white">{pct(row.pctOfNet, 3)}</td>
              <td className="sg-num px-2 py-2 text-right text-sg-muted">{pct(row.pctOfRevenue, 3)}</td>
              <td className="sg-num px-2 py-2 text-right text-sg-muted">{row.expectedBonus != null ? formatIDR(row.expectedBonus) : "—"}</td>
              <td className="max-w-[260px] px-4 py-2 text-xs text-sg-muted">{row.member.weightNote || <span className="text-sg-dim">Standard (§6.1)</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
