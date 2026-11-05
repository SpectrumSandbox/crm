"use client";

import { useEffect, useMemo, useState } from "react";
import { BadgeCheck } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Initiative, ProjectType } from "@/lib/initiatives/types";
import { contractedMonths, deferralTriggers, directCostTotal, netRevenue, nextProjectCode, projectRate, projectedAnnualNet, revenueShareRate } from "@/lib/initiatives/engine";
import { ORIGINATION_META, POLICY, PROJECT_TYPE_META } from "@/lib/initiatives/policy";
import { formatIDR } from "@/lib/utils";
import { formatMillionsInput, ledgerDate, parseAmount, wibDay } from "@/lib/initiatives/team-rules";
import { Lock } from "lucide-react";
import { useAccess } from "@/lib/access-control";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/overlays";
import { PolicyRef } from "./shared";
import type { ProjectRegister } from "./model";

/** Rp-million field value — accepts id-ID ("1.500", "1,5") and en ("1,500.5") formats (team-rules.parseAmount). */
const num = (v: string) => {
  const n = parseAmount(v);
  return Number.isFinite(n) ? n : 0;
};
const bad = (v: string) => !Number.isFinite(parseAmount(v));
const M = 1_000_000;

/** Project figures that set the rate (§5.1) and the policy flags; edited in millions of rupiah. */
export function FiguresCard({ reg }: { reg: ProjectRegister }) {
  const { ini } = reg;
  const users = useCrm((s) => s.users);
  const projects = useCrm((s) => s.projects);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const recordInitiativeChange = useCrm((s) => s.recordInitiativeChange);
  const notify = useUi((s) => s.notify);
  // §5 the type is assigned at approval; contract dates set x — both are locked once the PRC has issued a code (change via "Rate & notes")
  const locked = !!ini.code;

  const init = useMemo(
    () => ({
      type: ini.type,
      start: wibDay(ini.startDate),
      end: wibDay(ini.endDate),
      expected: formatMillionsInput(ini.revenue.expected / M),
      best: formatMillionsInput(ini.revenue.best / M),
      worst: formatMillionsInput(ini.revenue.worst / M),
      costs: formatMillionsInput((ini.costs.materials + ini.costs.subcontractors + ini.costs.equipment + ini.costs.travel + ini.costs.other) / M),
      contingency: String(ini.costs.contingencyPct),
      terms: String(ini.paymentTermsDays),
      newClient: ini.newClient,
      warranty: ini.warranty,
      highRisk: ini.highRisk,
      unusual: !!ini.unusualTerms,
      origination: (ini.origination ?? "") as NonNullable<Initiative["origination"]> | "",
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
      type: locked ? ini.type : (f.type as ProjectType),
      startDate: locked ? ini.startDate : ledgerDate(f.start),
      endDate: locked ? ini.endDate : ledgerDate(f.end),
      revenue: { expected: num(f.expected) * M, best: Math.max(num(f.best), num(f.expected)) * M, worst: Math.min(num(f.worst) || num(f.expected), num(f.expected)) * M },
      costs: { materials: base, subcontractors: 0, equipment: 0, travel: 0, other: 0, contingencyPct: num(f.contingency) },
      paymentTermsDays: num(f.terms),
      newClient: f.newClient,
      warranty: f.warranty,
      highRisk: f.highRisk,
      unusualTerms: f.unusual,
      origination: f.origination || undefined,
      initiatorId: f.initiatorId,
      standardBonus: f.type === "C" ? Math.max(POLICY.typeCMinimum.standardBonus, num(f.standard)) : undefined,
      deferralPct: Math.min(POLICY.deferral.maxPct, num(f.deferralPct) / 100),
      deferralMonths: Math.min(POLICY.deferral.maxMonths, Math.max(POLICY.deferral.minMonths, num(f.deferralMonths))),
      jiraProjectId: f.jira || null,
    };
  }, [f, ini, locked]);
  const preview = projectRate(draft, adjustments);
  const triggers = deferralTriggers(draft, adjustments);
  const costTotal = directCostTotal(draft.costs);
  const n = netRevenue(draft.revenue.expected, costTotal);

  const invalid = (["expected", "best", "worst", "costs", "contingency", "terms", "standard", "deferralPct", "deferralMonths"] as const).filter((k) => bad(f[k]));
  const save = () => {
    if (invalid.length) return;
    // keep the original cost breakdown when only the total changed
    const prevBase = ini.costs.materials + ini.costs.subcontractors + ini.costs.equipment + ini.costs.travel + ini.costs.other;
    const costs = Math.abs(prevBase - draft.costs.materials) < 1 ? { ...ini.costs, contingencyPct: draft.costs.contingencyPct } : draft.costs;
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = { ...draft, costs };
    recordInitiativeChange(ini.id, rest, "Edited in the project register");
    notify("Project figures saved");
  };
  const echo = (v: string) => (bad(v) ? "Not a number — use 1.500 or 1,5" : v.trim() ? formatIDR(num(v) * M, "full") : undefined);

  return (
    <section className="rounded-xl border border-sg-line bg-sg-card">
      <header className="flex items-center justify-between border-b border-sg-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-sm font-extrabold text-sg-white">Project figures</h2>
          <PolicyRef s="4.3" />
        </div>
        <Button size="xs" variant="primary" disabled={!dirty || f.end <= f.start || invalid.length > 0} title={invalid.length ? `Fix: ${invalid.join(", ")}` : undefined} onClick={save}>
          Save
        </Button>
      </header>
      <div className="grid gap-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type (§5.1)" hint={locked ? "Locked at approval" : undefined}>
            <Select value={f.type} disabled={locked} onChange={(e) => set("type", e.target.value as ProjectType)}>
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
            <Input type="date" lang="en-GB" disabled={locked} value={f.start} onChange={(e) => set("start", e.target.value)} />
          </Field>
          <Field label="Contracted final delivery" hint={`${contractedMonths(draft)} months (§5.1)`}>
            <Input type="date" lang="en-GB" disabled={locked} value={f.end} onChange={(e) => set("end", e.target.value)} />
          </Field>
          {locked ? (
            <p className="col-span-2 -mt-1 flex items-start gap-1.5 text-2xs text-sg-dim">
              <Lock className="mt-0.5 size-3 shrink-0" /> Type and contract dates were fixed when the PRC issued {ini.code}. Change them through “Rate &amp; notes” with a recorded reason (§5.1).
            </p>
          ) : null}
          <Field label="Origination (§4.1)" hint={!f.origination ? "Not recorded — the compliance check fails until it is" : undefined}>
            <Select value={f.origination} onChange={(e) => set("origination", e.target.value as typeof f.origination)}>
              <option value="">Not recorded</option>
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
          <Field label="Expected revenue" hint={echo(f.expected)}>
            <Input inputMode="decimal" value={f.expected} onChange={(e) => set("expected", e.target.value)} className={bad(f.expected) ? "border-soft-red/60" : undefined} />
          </Field>
          <Field label="Best" hint={echo(f.best)}>
            <Input inputMode="decimal" value={f.best} onChange={(e) => set("best", e.target.value)} className={bad(f.best) ? "border-soft-red/60" : undefined} />
          </Field>
          <Field label="Worst" hint={echo(f.worst)}>
            <Input inputMode="decimal" value={f.worst} onChange={(e) => set("worst", e.target.value)} className={bad(f.worst) ? "border-soft-red/60" : undefined} />
          </Field>
          <Field label="Direct costs" hint={echo(f.costs) ?? "Materials, subcontractors, equipment, travel… (§5.3)"}>
            <Input inputMode="decimal" value={f.costs} onChange={(e) => set("costs", e.target.value)} className={bad(f.costs) ? "border-soft-red/60" : undefined} />
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
  const recordInitiativeChange = useCrm((s) => s.recordInitiativeChange);
  const approveMembers = useCrm((s) => s.approveMembers);
  const notify = useUi((s) => s.notify);
  const access = useAccess();
  const curve = projectRate({ ...ini, lockedSharePct: null }, adjustments);
  const [override, setOverride] = useState("");
  const [reason, setReason] = useState("");
  const [pilot, setPilot] = useState(true);
  // after the code is issued, type and contract dates change only here, with a recorded reason (§5.1)
  const [type, setType] = useState<ProjectType>(ini.type);
  const [start, setStart] = useState(wibDay(ini.startDate));
  const [end, setEnd] = useState(wibDay(ini.endDate));
  const [changeReason, setChangeReason] = useState("");
  useEffect(() => {
    if (open) {
      setOverride(ini.lockedSharePct != null ? (ini.lockedSharePct * 100).toFixed(3) : "");
      setReason(ini.shareNote ?? "");
      setPilot(ini.pilot ?? true);
      setType(ini.type);
      setStart(wibDay(ini.startDate));
      setEnd(wibDay(ini.endDate));
      setChangeReason("");
    }
  }, [open, ini]);
  const termsChanged = !!ini.code && (type !== ini.type || start !== wibDay(ini.startDate) || end !== wibDay(ini.endDate));
  const termsValid = !termsChanged || (end > start && changeReason.trim().length >= 10);
  const overrideRate = override.trim() ? Number(override) / 100 : null;
  const finalRate = overrideRate ?? (curve.source === "curve" ? curve.rate : null);
  const differs = overrideRate != null && curve.source === "curve" && Math.abs(overrideRate - curve.rate) > 1e-6;
  const blocking = reg.compliance.filter((c) => c.status === "fail" && !["code", "rate", "rate-note", "projection"].includes(c.id));
  const valid = access.prc && finalRate != null && finalRate > 0 && finalRate <= 0.6 && (!differs || reason.trim().length > 5) && blocking.length === 0 && termsValid;

  const ratify = () => {
    if (!valid || finalRate == null) return;
    // one numbering scheme for PRC approvals and ratifications: per year, max(seq) + 1 (shared with actions.approve)
    const code = ini.code ?? nextProjectCode(initiatives);
    if (termsChanged) recordInitiativeChange(ini.id, { type, startDate: ledgerDate(start), endDate: ledgerDate(end) }, `PRC changed the type / contract dates after approval: ${changeReason.trim()}`);
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
        {ini.code ? (
          <div className="grid gap-3 rounded-lg border border-sg-line p-3">
            <div className="sg-eyebrow">Type and contract dates (fixed at approval)</div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Type">
                <Select value={type} onChange={(e) => setType(e.target.value as ProjectType)}>
                  {(["A", "B", "C"] as ProjectType[]).map((t) => (
                    <option key={t} value={t}>
                      {PROJECT_TYPE_META[t].short}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Work start">
                <Input type="date" lang="en-GB" value={start} onChange={(e) => setStart(e.target.value)} />
              </Field>
              <Field label="Contracted end">
                <Input type="date" lang="en-GB" value={end} onChange={(e) => setEnd(e.target.value)} />
              </Field>
            </div>
            {termsChanged ? (
              <Field label="Reason for the change (required, recorded in the audit trail)" hint="A different type changes leadership capacity, the approval tier and the Type C minimum; different dates change x (§5.1)">
                <Textarea rows={2} value={changeReason} onChange={(e) => setChangeReason(e.target.value)} />
              </Field>
            ) : null}
          </div>
        ) : null}
        <label className="flex items-center gap-1.5 text-xs text-sg-muted">
          <input type="checkbox" className="size-3.5 accent-white" checked={pilot} onChange={(e) => setPilot(e.target.checked)} /> Selected for the v4.0 pilot from 1 January 2027 (§15.2)
        </label>
        {!access.prc ? <p className="text-xs text-soft-orange">Only a PRC member can record the ratification (§13.1).</p> : null}
        {blocking.length ? (
          <div className="rounded-lg border border-soft-red/40 p-3 text-xs text-soft-red">
            Fix first: {blocking.map((b) => b.label).join(" · ")}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
