"use client";

import { useEffect, useMemo, useState } from "react";
import { BadgeCheck } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Initiative, ProjectType } from "@/lib/initiatives/types";
import { contractedMonths, deferralTriggers, directCostTotal, netRevenue, projectRate, projectedAnnualNet, revenueShareRate } from "@/lib/initiatives/engine";
import { ORIGINATION_META, POLICY, PROJECT_TYPE_META } from "@/lib/initiatives/policy";
import { formatIDR, fromDateInput, toDateInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/overlays";
import { PolicyRef } from "./shared";
import type { ProjectRegister } from "./model";

const num = (v: string) => {
  const n = Number(v.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const M = 1_000_000;

/** Project figures that set the rate (§5.1) and the policy flags; edited in millions of rupiah. */
export function FiguresCard({ reg }: { reg: ProjectRegister }) {
  const { ini } = reg;
  const users = useCrm((s) => s.users);
  const projects = useCrm((s) => s.projects);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const saveInitiative = useCrm((s) => s.saveInitiative);
  const notify = useUi((s) => s.notify);

  const init = useMemo(
    () => ({
      type: ini.type,
      start: toDateInput(ini.startDate),
      end: toDateInput(ini.endDate),
      expected: String(ini.revenue.expected / M),
      best: String(ini.revenue.best / M),
      worst: String(ini.revenue.worst / M),
      costs: String((ini.costs.materials + ini.costs.subcontractors + ini.costs.equipment + ini.costs.travel + ini.costs.other) / M),
      contingency: String(ini.costs.contingencyPct),
      terms: String(ini.paymentTermsDays),
      newClient: ini.newClient,
      warranty: ini.warranty,
      highRisk: ini.highRisk,
      unusual: !!ini.unusualTerms,
      origination: ini.origination ?? "personal",
      initiatorId: ini.initiatorId,
      standard: String(ini.standardBonus ?? POLICY.typeCMinimum.standardBonus),
      deferralPct: String(Math.round((ini.deferralPct ?? POLICY.deferral.defaultPct) * 100)),
      deferralMonths: String(ini.deferralMonths),
      jira: ini.jiraProjectId ?? "",
    }),
    [ini],
  );
  const [f, setF] = useState(init);
  useEffect(() => setF(init), [init]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(init);

  const draft: Initiative = useMemo(() => {
    const base = num(f.costs) * M;
    return {
      ...ini,
      type: f.type as ProjectType,
      startDate: fromDateInput(f.start),
      endDate: fromDateInput(f.end),
      revenue: { expected: num(f.expected) * M, best: Math.max(num(f.best), num(f.expected)) * M, worst: Math.min(num(f.worst) || num(f.expected), num(f.expected)) * M },
      costs: { materials: base, subcontractors: 0, equipment: 0, travel: 0, other: 0, contingencyPct: num(f.contingency) },
      paymentTermsDays: num(f.terms),
      newClient: f.newClient,
      warranty: f.warranty,
      highRisk: f.highRisk,
      unusualTerms: f.unusual,
      origination: f.origination as Initiative["origination"],
      initiatorId: f.initiatorId,
      standardBonus: f.type === "C" ? Math.max(POLICY.typeCMinimum.standardBonus, num(f.standard)) : undefined,
      deferralPct: Math.min(POLICY.deferral.maxPct, num(f.deferralPct) / 100),
      deferralMonths: Math.min(POLICY.deferral.maxMonths, Math.max(POLICY.deferral.minMonths, num(f.deferralMonths))),
      jiraProjectId: f.jira || null,
    };
  }, [f, ini]);
  const preview = projectRate(draft, adjustments);
  const triggers = deferralTriggers(draft, adjustments);
  const costTotal = directCostTotal(draft.costs);
  const n = netRevenue(draft.revenue.expected, costTotal);

  const save = () => {
    // keep the original cost breakdown when only the total changed
    const prevBase = ini.costs.materials + ini.costs.subcontractors + ini.costs.equipment + ini.costs.travel + ini.costs.other;
    const costs = Math.abs(prevBase - draft.costs.materials) < 1 ? { ...ini.costs, contingencyPct: draft.costs.contingencyPct } : draft.costs;
    saveInitiative({ ...draft, id: ini.id, costs });
    notify("Project figures saved");
  };

  return (
    <section className="rounded-xl border border-sg-line bg-sg-card">
      <header className="flex items-center justify-between border-b border-sg-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-sm font-extrabold text-sg-white">Project figures</h2>
          <PolicyRef s="4.3" />
        </div>
        <Button size="xs" variant="primary" disabled={!dirty || f.end <= f.start} onClick={save}>
          Save
        </Button>
      </header>
      <div className="grid gap-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type (§5.1)">
            <Select value={f.type} onChange={(e) => set("type", e.target.value as ProjectType)}>
              {(["A", "B", "C"] as ProjectType[]).map((t) => (
                <option key={t} value={t}>
                  {PROJECT_TYPE_META[t].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Jira project">
            <Select value={f.jira} onChange={(e) => set("jira", e.target.value)}>
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key} · {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Work start">
            <Input type="date" value={f.start} onChange={(e) => set("start", e.target.value)} />
          </Field>
          <Field label="Contracted final delivery" hint={`${contractedMonths(draft)} months (§5.1)`}>
            <Input type="date" value={f.end} onChange={(e) => set("end", e.target.value)} />
          </Field>
          <Field label="Origination (§4.1)">
            <Select value={f.origination} onChange={(e) => set("origination", e.target.value as typeof f.origination)}>
              {(Object.keys(ORIGINATION_META) as (keyof typeof ORIGINATION_META)[]).map((k) => (
                <option key={k} value={k}>
                  {ORIGINATION_META[k].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={f.origination === "company" ? "Proposed by" : "Project Initiator"}>
            <Select value={f.initiatorId} onChange={(e) => set("initiatorId", e.target.value)}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="sg-eyebrow mt-1">Expected case, Rp million excl. VAT</div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Expected revenue">
            <Input inputMode="decimal" value={f.expected} onChange={(e) => set("expected", e.target.value)} />
          </Field>
          <Field label="Best">
            <Input inputMode="decimal" value={f.best} onChange={(e) => set("best", e.target.value)} />
          </Field>
          <Field label="Worst">
            <Input inputMode="decimal" value={f.worst} onChange={(e) => set("worst", e.target.value)} />
          </Field>
          <Field label="Direct costs" hint="Materials, subcontractors, equipment, travel… (§5.3)">
            <Input inputMode="decimal" value={f.costs} onChange={(e) => set("costs", e.target.value)} />
          </Field>
          <Field label="Contingency %" hint="10–20% (§4.3)">
            <Input inputMode="decimal" value={f.contingency} onChange={(e) => set("contingency", e.target.value)} />
          </Field>
          <Field label="Payment terms (days)">
            <Input inputMode="numeric" value={f.terms} onChange={(e) => set("terms", e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-sg-muted">
          {(
            [
              ["newClient", "New client, no payment history"],
              ["highRisk", "Technical / execution risk high"],
              ["warranty", "Warranty period (Type C)"],
              ["unusual", "New market or unusual liability terms"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="checkbox" className="size-3.5 accent-white" checked={f[k]} onChange={(e) => set(k, e.target.checked)} /> {label}
            </label>
          ))}
        </div>

        {f.type === "C" ? (
          <Field label="Type C standard bonus — Rp a month (§8.6)" hint="At least Rp1,000,000; fixed by the PRC at approval, can be raised at kickoff, then fixed">
            <Input inputMode="numeric" value={f.standard} onChange={(e) => set("standard", e.target.value)} />
          </Field>
        ) : null}
        {triggers.length ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Deferral % (≤ 30%, §9.3)">
              <Input inputMode="numeric" value={f.deferralPct} onChange={(e) => set("deferralPct", e.target.value)} />
            </Field>
            <Field label="Months after close (6–12)">
              <Input inputMode="numeric" value={f.deferralMonths} onChange={(e) => set("deferralMonths", e.target.value)} />
            </Field>
            <p className="col-span-2 text-2xs text-sg-dim">Deferral applies: {triggers.join("; ")}.</p>
          </div>
        ) : null}

        <div className="rounded-lg border border-sg-line bg-sg-bg/40 p-3 text-xs">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <span className="text-sg-dim">Direct costs incl. contingency</span>
            <span className="sg-num text-right text-sg-white">{formatIDR(costTotal, "full")}</span>
            <span className="text-sg-dim">UMKM final tax 0.5% (§5.4)</span>
            <span className="sg-num text-right text-sg-white">{formatIDR(n.tax, "full")}</span>
            <span className="text-sg-dim">Projected net revenue</span>
            <span className="sg-num text-right text-sg-white">{formatIDR(n.net, "full")}</span>
            <span className="text-sg-dim">x — projected annual net revenue</span>
            <span className="sg-num text-right text-sg-white">{formatIDR(projectedAnnualNet(n.net, contractedMonths(draft)), "full")}</span>
            <span className="text-sg-dim">Revenue-share rate y</span>
            <span className="sg-num text-right font-semibold text-sg-white">{(preview.rate * 100).toFixed(3)}%{preview.source === "fixed" || preview.source === "v3_flat" ? " (fixed)" : ""}</span>
            <span className="text-sg-dim">Bonus pool, expected case</span>
            <span className="sg-num text-right text-sg-white">{formatIDR(Math.floor(Math.max(0, n.net) * preview.rate), "full")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** §4.5 / §15.1 — the PRC brings an ongoing project under v4.0: project code, rate fixed, team checked. */
export function RatifyDialog({ reg, open, onOpenChange }: { reg: ProjectRegister; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { ini, rate } = reg;
  const initiatives = useCrm((s) => s.initiatives);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const saveInitiative = useCrm((s) => s.saveInitiative);
  const approveMembers = useCrm((s) => s.approveMembers);
  const notify = useUi((s) => s.notify);
  const curve = projectRate({ ...ini, lockedSharePct: null }, adjustments);
  const [override, setOverride] = useState("");
  const [reason, setReason] = useState("");
  const [pilot, setPilot] = useState(true);
  useEffect(() => {
    if (open) {
      setOverride(ini.lockedSharePct != null ? (ini.lockedSharePct * 100).toFixed(3) : "");
      setReason(ini.shareNote ?? "");
      setPilot(ini.pilot ?? true);
    }
  }, [open, ini]);
  const overrideRate = override.trim() ? Number(override) / 100 : null;
  const finalRate = overrideRate ?? (curve.source === "curve" ? curve.rate : null);
  const differs = overrideRate != null && curve.source === "curve" && Math.abs(overrideRate - curve.rate) > 1e-6;
  const blocking = reg.compliance.filter((c) => c.status === "fail" && !["code", "rate", "rate-note", "projection"].includes(c.id));
  const valid = finalRate != null && finalRate > 0 && finalRate <= 0.6 && (!differs || reason.trim().length > 5) && blocking.length === 0;
  const year = new Date().getFullYear();

  const ratify = () => {
    if (!valid || finalRate == null) return;
    const seq = initiatives.filter((x) => x.code?.startsWith(`PRJ-${year}`)).length + 1;
    const code = ini.code ?? `PRJ-${year}-${String(seq).padStart(3, "0")}`;
    saveInitiative({ id: ini.id, code, approvedAt: ini.approvedAt ?? new Date().toISOString(), lockedSharePct: finalRate, shareNote: reason.trim(), pilot, policyVersion: "4.0" });
    approveMembers(ini.id);
    notify(`${ini.title} brought under Policy v4.0 — ${code}`);
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`PRC ratification — ${ini.title}`}
      description="Issues the project code, fixes the revenue-share rate and confirms the team's eligibility, leadership capacity and line manager agreement (§4.5, §6.7, §15.1)."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} onClick={ratify}>
            <BadgeCheck /> Record PRC ratification
          </Button>
        </>
      }
    >
      <div className="grid gap-3 text-sm">
        <div className="rounded-lg border border-sg-line p-3 text-xs text-sg-muted">
          Curve rate from the expected case: <span className="sg-num font-semibold text-sg-white">{curve.source === "curve" ? `${(curve.rate * 100).toFixed(3)}%` : "—"}</span>
          {curve.source === "curve" ? ` (x = ${formatIDR(curve.x, "full")}, ${curve.months} months; floor 10% from Rp1.5 bn)` : " — enter the expected case first (§5.1)"}
          <div className="mt-1">Current: {(rate.rate * 100).toFixed(3)}% · Rate check y(x) = {(revenueShareRate(curve.x) * 100).toFixed(3)}%</div>
        </div>
        <Field label="Rate fixed by the PRC, % (leave empty to use the curve)" hint="A different rate needs a recorded reason — e.g. a rate kept from Version 3.0 (§15.1)">
          <Input inputMode="decimal" value={override} onChange={(e) => setOverride(e.target.value)} placeholder={curve.source === "curve" ? (curve.rate * 100).toFixed(3) : ""} />
        </Field>
        <Field label={differs ? "Reason for a rate different from the curve (required)" : "Notes / other considerations"}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <label className="flex items-center gap-1.5 text-xs text-sg-muted">
          <input type="checkbox" className="size-3.5 accent-white" checked={pilot} onChange={(e) => setPilot(e.target.checked)} /> Selected for the v4.0 pilot from 1 January 2027 (§15.2)
        </label>
        {blocking.length ? (
          <div className="rounded-lg border border-soft-red/40 p-3 text-xs text-soft-red">
            Fix first: {blocking.map((b) => b.label).join(" · ")}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
