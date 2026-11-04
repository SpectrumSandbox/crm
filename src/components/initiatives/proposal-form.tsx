"use client";

/*
 * Project proposal form (§2.2 required content, §2.3 submission to PRC).
 * Long single-page form: sticky section nav on the left, sticky "Proposal check" panel on the right.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, CalendarDays, Check, CircleAlert, CircleCheck, Coins, FileText, Hourglass, Info, Plus, Send, ShieldAlert, Target, Trash2, Users } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { ContractStatus, Initiative, Milestone, ProjectType, RiskCategory, RiskItem } from "@/lib/initiatives/types";
import { addMonths, deferralTriggers, directCostTotal, memberWeight, participationEligibility, proposalEconomics, proposalGaps, shareInForce, splitBonus } from "@/lib/initiatives/engine";
import { POLICY, PROJECT_TYPE_META, RISK_CATEGORIES } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR, fromDateInput, toDateInput, uid } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Chip, EmptyState, Kbd } from "@/components/ui/misc";
import { Cite, Money, Pct, StatusChip } from "./shared";
import { TeamEditor } from "./team-editor";

type FormState = Pick<
  Initiative,
  | "title"
  | "type"
  | "summary"
  | "valueProposition"
  | "scope"
  | "deliverables"
  | "exclusions"
  | "successCriteria"
  | "startDate"
  | "endDate"
  | "milestones"
  | "companyId"
  | "dealId"
  | "contractStatus"
  | "newClient"
  | "paymentTermsDays"
  | "revenue"
  | "costs"
  | "risks"
  | "warranty"
>;

const FORM_KEYS: (keyof FormState)[] = ["title", "type", "summary", "valueProposition", "scope", "deliverables", "exclusions", "successCriteria", "startDate", "endDate", "milestones", "companyId", "dealId", "contractStatus", "newClient", "paymentTermsDays", "revenue", "costs", "risks", "warranty"];

function blankForm(): FormState {
  const start = fromDateInput(toDateInput(new Date().toISOString()));
  return {
    title: "",
    type: "A",
    summary: "",
    valueProposition: "",
    scope: "",
    deliverables: "",
    exclusions: "",
    successCriteria: "",
    startDate: start,
    endDate: addMonths(start, 3),
    milestones: [],
    companyId: null,
    dealId: null,
    contractStatus: "none",
    newClient: false,
    paymentTermsDays: 30,
    revenue: { expected: 0, best: 0, worst: 0 },
    costs: { materials: 0, subcontractors: 0, equipment: 0, travel: 0, other: 0, contingencyPct: 10 },
    risks: [],
    warranty: false,
  };
}

function pickForm(i: Initiative): FormState {
  const f = {} as Record<keyof FormState, unknown>;
  for (const k of FORM_KEYS) f[k] = i[k];
  return structuredClone(f) as FormState;
}

/** Full Initiative used to evaluate gaps/economics before (or after) the draft exists in the store. */
function compose(form: FormState, base: Initiative | undefined, id: string, currentUserId: string): Initiative {
  const ts = base?.createdAt ?? new Date().toISOString();
  return {
    id,
    trackingNo: base?.trackingNo ?? "",
    code: base?.code ?? null,
    status: base?.status ?? "draft",
    initiatorId: base?.initiatorId ?? currentUserId,
    highRisk: base?.highRisk ?? false,
    deferralMonths: base?.deferralMonths ?? POLICY.deferral.minMonths,
    lockedSharePct: base?.lockedSharePct ?? null,
    capException: base?.capException ?? false,
    submittedAt: base?.submittedAt ?? null,
    acknowledgedAt: base?.acknowledgedAt ?? null,
    primaryReviewerId: base?.primaryReviewerId ?? null,
    scores: base?.scores ?? null,
    decision: base?.decision ?? null,
    appeal: base?.appeal ?? null,
    approvedAt: base?.approvedAt ?? null,
    completedAt: base?.completedAt ?? null,
    epicId: base?.epicId ?? null,
    createdAt: ts,
    updatedAt: base?.updatedAt ?? ts,
    ...form,
  };
}

const SECTIONS = [
  { id: "sec-summary", n: 1, label: "Executive summary", cite: "2.2.1", icon: FileText },
  { id: "sec-scope", n: 2, label: "Scope & deliverables", cite: "2.2.2", icon: Target },
  { id: "sec-timeline", n: 3, label: "Timeline & milestones", cite: "2.2.3", icon: CalendarDays },
  { id: "sec-team", n: 4, label: "Team & resources", cite: "2.2.4", icon: Users },
  { id: "sec-budget", n: 5, label: "Budget & revenue", cite: "2.2.5", icon: Coins },
  { id: "sec-client", n: 6, label: "Client", cite: "2.2.6", icon: Building2 },
  { id: "sec-risks", n: 7, label: "Risks", cite: "2.2.7", icon: ShieldAlert },
] as const;

const CONTRACT_STATUS: Record<ContractStatus, string> = { none: "No contract yet", verbal: "Verbal agreement", loi: "Letter of intent", signed: "Signed contract" };
const COST_FIELDS = [
  ["materials", "Materials"],
  ["subcontractors", "Subcontractors"],
  ["equipment", "Equipment"],
  ["travel", "Travel"],
  ["other", "Other direct costs"],
] as const;

/* ───────────────────────── component ───────────────────────── */

export function ProposalForm({ editId }: { editId: string | null }) {
  const router = useRouter();
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const adjustments = useCrm((s) => s.shareAdjustments);
  const profiles = useCrm((s) => s.employeeProfiles);
  const companies = useCrm((s) => s.companies);
  const deals = useCrm((s) => s.deals);
  const currentUserId = useCrm((s) => s.currentUserId);
  const saveInitiative = useCrm((s) => s.saveInitiative);
  const submitInitiative = useCrm((s) => s.submitInitiative);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();

  // id of the draft this form edits: from ?edit=, or the one we just created (before the URL catches up)
  const [ownId, setOwnId] = useState<string | null>(editId);
  const ownIdRef = useRef<string | null>(editId);
  const existing = ownId ? initiatives.find((i) => i.id === ownId) : undefined;
  const [form, setForm] = useState<FormState>(() => (existing ? pickForm(existing) : blankForm()));
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(existing?.updatedAt ?? null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);

  // ?edit= changed from outside (another draft, or "new proposal") → load it; ignore the URL update after our own first save
  useEffect(() => {
    if (editId === ownIdRef.current) return;
    ownIdRef.current = editId;
    setOwnId(editId);
    const ini = editId ? useCrm.getState().initiatives.find((i) => i.id === editId) : undefined;
    setForm(ini ? pickForm(ini) : blankForm());
    setDirty(false);
    setLastSavedAt(ini?.updatedAt ?? null);
  }, [editId]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  const id = existing?.id ?? null;
  const composed = useMemo(() => compose(form, existing, id ?? "__new", currentUserId), [form, existing, id, currentUserId]);
  const econ = useMemo(() => proposalEconomics(composed, adjustments), [composed, adjustments]);
  const team = useMemo(() => (id ? members.filter((m) => m.initiativeId === id && !m.leftAt && m.consent !== "declined") : []), [members, id]);
  const gaps = useMemo(() => proposalGaps(composed, id ? members : []), [composed, members, id]);
  const deferral = useMemo(() => deferralTriggers(composed, adjustments), [composed, adjustments]);
  const proposer = useMemo(() => participationEligibility(profiles.find((p) => p.userId === (existing?.initiatorId ?? currentUserId))), [profiles, existing, currentUserId]);

  const myBonus = useMemo(() => {
    // without a saved team the proposer is the default Initiator + Project Lead (§4.3, §2.4)
    const weights = team.length ? team.map((m) => ({ userId: m.userId, weight: memberWeight(m) })) : [{ userId: currentUserId, weight: 2.5 }];
    const split = splitBonus(weights, econ.share, econ.expected.net);
    const mine = split.shares.find((s) => s.userId === currentUserId);
    return { bonus: mine?.bonus ?? 0, weight: mine?.weight ?? 0, total: split.total, onTeam: !!mine };
  }, [team, econ, currentUserId]);

  const save = (opts: { silent?: boolean } = {}) => {
    const payload: Partial<Initiative> = { ...form, title: form.title.trim() || "Untitled initiative" };
    const savedId = saveInitiative(id ? { ...payload, id } : payload);
    if (!id) {
      ownIdRef.current = savedId;
      setOwnId(savedId);
    }
    setForm((f) => ({ ...f, title: payload.title! }));
    setDirty(false);
    setLastSavedAt(new Date().toISOString());
    if (!id) router.replace(`/initiatives/new?edit=${savedId}`);
    if (!opts.silent) notify(id ? "Draft saved" : "Draft created — you can now build the team");
    return savedId;
  };

  const canSubmit = gaps.length === 0 && proposer.ok;
  const submit = () => {
    if (!canSubmit) return;
    const savedId = save({ silent: true });
    submitInitiative(savedId);
    const trackingNo = useCrm.getState().initiatives.find((i) => i.id === savedId)?.trackingNo ?? "";
    notify(`Submitted to PRC — tracking no. ${trackingNo}`);
    router.push(`/initiatives/${savedId}`);
  };

  // ⌘/Ctrl+Enter saves
  const saveRef = useRef(save);
  saveRef.current = save;
  const editable = !existing || existing.status === "draft";
  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        saveRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable]);

  // highlight the section in view
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !editable) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { root, rootMargin: "0px 0px -65% 0px", threshold: 0 },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [editable]);

  const crumbs = [{ href: "/initiatives", label: "Initiatives" }];

  if (ownId && !existing)
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Proposal" crumbs={crumbs} />
        <EmptyState icon={FileText} title="Draft not found" action={<Link href="/initiatives/new" className="text-xs font-semibold text-sg-white underline">Start a new proposal</Link>}>
          The draft may have been deleted.
        </EmptyState>
      </div>
    );

  if (existing && existing.status !== "draft")
    return (
      <div className="flex h-full flex-col">
        <PageHeader title={existing.title} crumbs={crumbs} meta={<StatusChip status={existing.status} />} />
        <div className="p-6">
          <div className="mx-auto max-w-lg rounded-xl border border-sg-line bg-sg-card p-5">
            <div className="flex items-center gap-2 font-display text-base font-extrabold text-sg-white">
              <Info className="size-4 text-soft-cyan" /> This proposal has already been submitted
            </div>
            <p className="mt-2 text-sm text-sg-muted">
              {existing.trackingNo ? `${existing.trackingNo} · ` : ""}Submitted {formatDate(existing.submittedAt, "medium")}. Once a proposal is with the Project Review Committee it can no longer be edited as a draft
              <Cite s="2.3" />. Follow its review, team and economics on the initiative page.
            </p>
            <Button variant="primary" size="md" className="mt-4" onClick={() => router.push(`/initiatives/${existing.id}`)}>
              Open initiative <ArrowRight />
            </Button>
          </div>
        </div>
      </div>
    );

  const companyDeals = form.companyId ? deals.filter((d) => d.companyId === form.companyId) : [];
  const milestoneTotal = form.milestones.reduce((s, m) => s + m.paymentAmount, 0);
  const scrollTo = (sid: string) => document.getElementById(sid)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={existing ? form.title || "Untitled initiative" : "New proposal"} crumbs={crumbs} meta={<StatusChip status="draft" />}>
        <span className="text-2xs text-sg-dim">{dirty ? "Unsaved changes" : lastSavedAt ? `Saved ${formatDate(lastSavedAt, "datetime")}` : "Not saved yet"}</span>
        <Button variant="outline" size="md" onClick={() => save()}>
          Save draft <Kbd className="ml-1">⌘↵</Kbd>
        </Button>
      </PageHeader>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1480px] grid-cols-1 gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[180px_minmax(0,1fr)_320px]">
          {/* section nav */}
          <nav className="sticky top-5 hidden self-start xl:block" aria-label="Proposal sections">
            <div className="sg-eyebrow mb-2">Proposal · §2.2</div>
            <ul className="space-y-0.5">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      scrollTo(s.id);
                    }}
                    className={cn("flex items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold transition-colors", activeSection === s.id ? "bg-sg-card-2 text-sg-white" : "text-sg-muted hover:text-sg-white")}
                  >
                    <span className="sg-num w-3 text-sg-dim">{s.n}</span>
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {/* form */}
          <div className="min-w-0 space-y-5">
            {/* 1 */}
            <Section id="sec-summary" n={1} title="Executive summary & business case" cite="2.2.1">
              <Field label="Project title">
                <Input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="e.g. Crane telemetry rollout — Priok Terminal" autoFocus={!existing} />
              </Field>
              <div>
                <Label>
                  Project type <Cite s="3.1" />
                </Label>
                <div className="grid gap-2 md:grid-cols-3">
                  {(["A", "B", "C"] as ProjectType[]).map((t) => (
                    <TypeCard key={t} type={t} selected={form.type === t} share={shareInForce(t, adjustments, new Date().toISOString())} onSelect={() => update("type", t)} />
                  ))}
                </div>
                {form.type === "C" && (
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-sg-text">
                    <input type="checkbox" checked={form.warranty} onChange={(e) => update("warranty", e.target.checked)} className="size-3.5 accent-sg-white" />
                    Product carries a manufacturing warranty <span className="text-sg-dim">(triggers 30% bonus deferral, §6.3)</span>
                  </label>
                )}
              </div>
              <Field label="Executive summary" hint={`${form.summary.trim().length} characters · at least 40`}>
                <Textarea value={form.summary} onChange={(e) => update("summary", e.target.value)} placeholder="What the project is, who it is for and why now — in a paragraph the PRC can read in a minute." />
              </Field>
              <Field label="Value proposition & strategic rationale">
                <Textarea value={form.valueProposition} onChange={(e) => update("valueProposition", e.target.value)} placeholder="Client value, strategic fit with Spectrum Group capabilities, follow-on potential." className="min-h-[64px]" />
              </Field>
            </Section>

            {/* 2 */}
            <Section id="sec-scope" n={2} title="Scope & deliverables" cite="2.2.2">
              <Field label="Scope of work">
                <Textarea value={form.scope} onChange={(e) => update("scope", e.target.value)} placeholder="Work packages, sites, systems in scope." />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Deliverables & acceptance criteria">
                  <Textarea value={form.deliverables} onChange={(e) => update("deliverables", e.target.value)} placeholder="One deliverable per line, with how the client accepts it." />
                </Field>
                <Field label="Exclusions">
                  <Textarea value={form.exclusions} onChange={(e) => update("exclusions", e.target.value)} placeholder="What is explicitly out of scope." />
                </Field>
              </div>
              <Field label="Performance metrics & success criteria">
                <Textarea value={form.successCriteria} onChange={(e) => update("successCriteria", e.target.value)} placeholder="Measurable targets (uptime, accuracy, schedule, margin…)." className="min-h-[64px]" />
              </Field>
            </Section>

            {/* 3 */}
            <Section id="sec-timeline" n={3} title="Timeline & milestones" cite="2.2.3">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Start date">
                  <Input type="date" value={toDateInput(form.startDate)} onChange={(e) => e.target.value && update("startDate", fromDateInput(e.target.value))} />
                </Field>
                <Field label="Completion date">
                  <Input type="date" value={toDateInput(form.endDate)} onChange={(e) => e.target.value && update("endDate", fromDateInput(e.target.value))} />
                </Field>
                <div className="flex items-end pb-1.5 text-xs text-sg-muted">
                  {Date.parse(form.endDate) > Date.parse(form.startDate) ? (
                    <span>
                      Duration <span className="sg-num font-semibold text-sg-white">{Math.round((Date.parse(form.endDate) - Date.parse(form.startDate)) / 86_400_000)}</span> days
                    </span>
                  ) : (
                    <span className="font-semibold text-soft-red">Completion must be after start</span>
                  )}
                </div>
              </div>
              <MilestoneEditor milestones={form.milestones} startDate={form.startDate} endDate={form.endDate} onChange={(v) => update("milestones", v)} />
              {form.milestones.length > 0 && (
                <p className={cn("text-2xs", milestoneTotal > 0 && form.revenue.expected > 0 && Math.abs(milestoneTotal - form.revenue.expected) > 1 ? "text-soft-yellow" : "text-sg-dim")}>
                  Payment milestones total <Money value={milestoneTotal} className="font-semibold" />
                  {form.revenue.expected > 0 ? (
                    <>
                      {" "}
                      of <Money value={form.revenue.expected} /> expected revenue ({Math.round((milestoneTotal / form.revenue.expected) * 100)}%). Milestone-based bonuses distribute on payment receipt
                      <Cite s="4.4" />
                    </>
                  ) : null}
                </p>
              )}
            </Section>

            {/* 4 */}
            <Section id="sec-team" n={4} title="Team & resources" cite="2.2.4">
              {id ? (
                <>
                  <p className="text-xs text-sg-muted">
                    You are added automatically as Project Initiator (0.5) and default Project Lead (2.0)<Cite s="4.3" />. Proposed members must consent before the PRC reviews the team<Cite s="7.1" />.
                  </p>
                  <TeamEditor initiativeId={id} mode="proposal" />
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-sg-line-2 p-4">
                  <Info className="size-4 text-sg-dim" />
                  <p className="min-w-0 flex-1 text-xs text-sg-muted">Save the draft first so team members can be attached. You&apos;ll be added automatically as Project Initiator and default Project Lead.</p>
                  <Button variant="outline" size="sm" onClick={() => save()}>
                    Save draft & add team
                  </Button>
                </div>
              )}
            </Section>

            {/* 5 */}
            <Section id="sec-budget" n={5} title="Budget & revenue" cite="2.2.5">
              <div>
                <Label>Revenue forecast</Label>
                <div className="grid gap-4 sm:grid-cols-3">
                  <MoneyField label="Worst case" value={form.revenue.worst} onChange={(v) => update("revenue", { ...form.revenue, worst: v })} />
                  <MoneyField label="Expected" value={form.revenue.expected} onChange={(v) => update("revenue", { ...form.revenue, expected: v })} emphasis />
                  <MoneyField label="Best case" value={form.revenue.best} onChange={(v) => update("revenue", { ...form.revenue, best: v })} />
                </div>
                {!(form.revenue.worst <= form.revenue.expected && form.revenue.expected <= form.revenue.best) && (form.revenue.best > 0 || form.revenue.worst > 0) && <p className="mt-1 text-2xs font-semibold text-soft-red">Scenarios must satisfy worst ≤ expected ≤ best.</p>}
              </div>
              <div>
                <Label>Direct cost estimate</Label>
                <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  {COST_FIELDS.map(([k, label]) => (
                    <MoneyField key={k} label={label} value={form.costs[k]} onChange={(v) => update("costs", { ...form.costs, [k]: v })} />
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className="text-2xs font-semibold uppercase tracking-[0.12em] text-sg-dim">Contingency</span>
                  <input type="range" min={0} max={30} step={1} value={form.costs.contingencyPct} onChange={(e) => update("costs", { ...form.costs, contingencyPct: Number(e.target.value) })} className="w-56 accent-sg-white" aria-label="Contingency percent" />
                  <span className={cn("sg-num w-10 text-sm font-semibold", form.costs.contingencyPct < 10 || form.costs.contingencyPct > 20 ? "text-soft-yellow" : "text-sg-white")}>{form.costs.contingencyPct}%</span>
                  <span className="text-2xs text-sg-dim">typically 10–20%</span>
                  <span className="ml-auto text-xs text-sg-muted">
                    Direct costs incl. contingency <Money value={directCostTotal(form.costs)} className="font-semibold text-sg-white" />
                  </span>
                </div>
              </div>
              <ProfitabilityTable econ={econ} />
            </Section>

            {/* 6 */}
            <Section id="sec-client" n={6} title="Client" cite="2.2.6">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Client company">
                  <Select
                    value={form.companyId ?? ""}
                    onChange={(e) => {
                      const cid = e.target.value || null;
                      setForm((f) => ({ ...f, companyId: cid, dealId: f.dealId && deals.find((d) => d.id === f.dealId)?.companyId === cid ? f.dealId : null }));
                      setDirty(true);
                    }}
                  >
                    <option value="">Choose a company…</option>
                    {[...companies]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="Linked deal (optional)" hint={form.companyId ? (companyDeals.length ? "Choosing a deal fills expected revenue when it is empty." : "No deals for this company.") : "Choose a company first."}>
                  <Select
                    value={form.dealId ?? ""}
                    disabled={!form.companyId || !companyDeals.length}
                    onChange={(e) => {
                      const did = e.target.value || null;
                      const deal = deals.find((d) => d.id === did);
                      setForm((f) => ({ ...f, dealId: did, revenue: deal && f.revenue.expected <= 0 ? { ...f.revenue, expected: deal.amount } : f.revenue }));
                      setDirty(true);
                    }}
                  >
                    <option value="">No deal</option>
                    {companyDeals.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} — {formatIDR(d.amount)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Contract status">
                  <Select value={form.contractStatus} onChange={(e) => update("contractStatus", e.target.value as ContractStatus)}>
                    {(Object.keys(CONTRACT_STATUS) as ContractStatus[]).map((k) => (
                      <option key={k} value={k}>
                        {CONTRACT_STATUS[k]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Payment terms (days)" hint={form.paymentTermsDays > POLICY.deferral.paymentTermsDays ? "Over 90 days — triggers 30% deferral (§6.3)" : undefined}>
                  <Input inputMode="numeric" value={String(form.paymentTermsDays)} onChange={(e) => update("paymentTermsDays", Number(e.target.value.replace(/\D/g, "")) || 0)} className="sg-num" />
                </Field>
                <div className="flex items-end pb-1.5">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-sg-text">
                    <input type="checkbox" checked={form.newClient} onChange={(e) => update("newClient", e.target.checked)} className="size-3.5 accent-sg-white" />
                    New client without payment history
                  </label>
                </div>
              </div>
            </Section>

            {/* 7 */}
            <Section id="sec-risks" n={7} title="Risk assessment" cite="2.2.7">
              <RiskEditor risks={form.risks} onChange={(v) => update("risks", v)} />
            </Section>
          </div>

          {/* check panel */}
          <aside className="self-start lg:sticky lg:top-5 lg:max-h-[calc(100dvh-6.5rem)] lg:overflow-y-auto">
            <CheckPanel
              gaps={gaps}
              deferral={deferral}
              econ={econ}
              myBonus={myBonus}
              proposer={proposer}
              proposerName={userMap.get(existing?.initiatorId ?? currentUserId)?.name ?? "Proposer"}
              canSubmit={canSubmit}
              onSave={() => save()}
              onSubmit={submit}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── building blocks ───────────────────────── */

function Section({ id, n, title, cite, children }: { id: string; n: number; title: string; cite: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-5 rounded-xl border border-sg-line bg-sg-card">
      <header className="flex items-center gap-2 border-b border-sg-line px-5 py-3">
        <span className="sg-num flex size-5 items-center justify-center rounded-full bg-sg-card-3 text-2xs font-bold text-sg-white">{n}</span>
        <h2 className="font-display text-sm font-extrabold text-sg-white">{title}</h2>
        <Cite s={cite} />
      </header>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint ? <p className="mt-1 text-2xs text-sg-dim">{hint}</p> : null}
    </div>
  );
}

function TypeCard({ type, selected, share, onSelect }: { type: ProjectType; selected: boolean; share: number; onSelect: () => void }) {
  const m = PROJECT_TYPE_META[type];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn("flex flex-col rounded-lg border p-3 text-left transition-colors", selected ? "border-sg-white/70 bg-sg-card-2" : "border-sg-line hover:border-sg-line-2")}
    >
      <div className="flex items-center justify-between gap-2">
        <Chip color={m.color}>Type {type}</Chip>
        {selected ? <Check className="size-4 text-sg-white" /> : null}
      </div>
      <div className="mt-2 text-sm font-semibold text-sg-white">{m.short}</div>
      <p className="mt-1 flex-1 text-2xs leading-snug text-sg-muted">{m.description}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 border-t border-sg-line pt-2">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-sg-dim">Revenue share</div>
          <div className="sg-num text-sm font-bold text-sg-white">
            <Pct value={share} />
          </div>
        </div>
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-sg-dim">Capacity factor</div>
          <div className="sg-num text-sm font-bold text-sg-white">{m.capacityFactor.toFixed(2)}</div>
        </div>
      </div>
    </button>
  );
}

/** Plain-digit money input with the full Rupiah value below. */
function MoneyInput({ value, onChange, emphasis, ariaLabel }: { value: number; onChange: (v: number) => void; emphasis?: boolean; ariaLabel?: string }) {
  const [text, setText] = useState(value ? String(Math.round(value)) : "");
  useEffect(() => {
    setText((t) => ((Number(t) || 0) === Math.round(value) ? t : value ? String(Math.round(value)) : ""));
  }, [value]);
  return (
    <div>
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-2xs font-semibold text-sg-dim">Rp</span>
        <Input
          aria-label={ariaLabel}
          inputMode="numeric"
          value={text}
          placeholder="0"
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
            setText(digits);
            onChange(Number(digits) || 0);
          }}
          className={cn("sg-num pl-8 text-right", emphasis && "font-semibold text-sg-white")}
        />
      </div>
      <p className="sg-num mt-1 truncate text-2xs text-sg-dim">{formatIDR(value, "full")}</p>
    </div>
  );
}

function MoneyField({ label, value, onChange, emphasis }: { label: string; value: number; onChange: (v: number) => void; emphasis?: boolean }) {
  return (
    <div>
      <Label>{label}</Label>
      <MoneyInput value={value} onChange={onChange} emphasis={emphasis} ariaLabel={label} />
    </div>
  );
}

function MilestoneEditor({ milestones, startDate, endDate, onChange }: { milestones: Milestone[]; startDate: string; endDate: string; onChange: (v: Milestone[]) => void }) {
  const patch = (mid: string, p: Partial<Milestone>) => onChange(milestones.map((m) => (m.id === mid ? { ...m, ...p } : m)));
  return (
    <div>
      <Label>Milestones</Label>
      {milestones.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-sg-line">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-[0.1em] text-sg-dim">
                <th className="px-3 py-1.5 font-semibold">Milestone</th>
                <th className="w-[150px] px-2 py-1.5 font-semibold">Due</th>
                <th className="w-[220px] px-2 py-1.5 font-semibold">Payment</th>
                <th className="w-10 px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {milestones.map((m) => {
                const outside = Date.parse(m.dueDate) < Date.parse(startDate) - 86_400_000 || Date.parse(m.dueDate) > Date.parse(endDate) + 86_400_000;
                return (
                  <tr key={m.id} className="border-b border-sg-line align-top last:border-b-0">
                    <td className="px-3 py-2">
                      <Input value={m.name} onChange={(e) => patch(m.id, { name: e.target.value })} placeholder="e.g. Factory acceptance test" aria-label="Milestone name" />
                    </td>
                    <td className="px-2 py-2">
                      <Input type="date" value={toDateInput(m.dueDate)} onChange={(e) => e.target.value && patch(m.id, { dueDate: fromDateInput(e.target.value) })} aria-label="Due date" />
                      {outside && <p className="mt-1 text-2xs text-soft-yellow">Outside project dates</p>}
                    </td>
                    <td className="px-2 py-2">
                      <MoneyInput value={m.paymentAmount} onChange={(v) => patch(m.id, { paymentAmount: v })} ariaLabel="Payment amount" />
                    </td>
                    <td className="px-2 py-2">
                      <Button size="icon" variant="ghost" aria-label="Remove milestone" onClick={() => onChange(milestones.filter((x) => x.id !== m.id))}>
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="mt-2"
        onClick={() => {
          const last = milestones[milestones.length - 1];
          const due = last ? addMonths(last.dueDate, 1) : addMonths(startDate, 1);
          onChange([...milestones, { id: uid("ms"), name: "", dueDate: Date.parse(due) > Date.parse(endDate) ? endDate : due, paymentAmount: 0, done: false }]);
        }}
      >
        <Plus /> Add milestone
      </Button>
    </div>
  );
}

const LEVEL_COLOR = { low: "green", medium: "yellow", high: "red" } as const;

function RiskEditor({ risks, onChange }: { risks: RiskItem[]; onChange: (v: RiskItem[]) => void }) {
  const patch = (rid: string, p: Partial<RiskItem>) => onChange(risks.map((r) => (r.id === rid ? { ...r, ...p } : r)));
  return (
    <div className="space-y-3">
      <p className="text-xs text-sg-muted">List at least two risks with mitigations. High-risk projects may be classified by the PRC for 30% bonus deferral<Cite s="6.3" />.</p>
      {risks.map((r, idx) => (
        <div key={r.id} className="rounded-lg border border-sg-line p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="sg-num text-2xs font-semibold text-sg-dim">R{idx + 1}</span>
            <Select value={r.category} onChange={(e) => patch(r.id, { category: e.target.value as RiskCategory })} wrapperClassName="w-40" aria-label="Risk category">
              {(Object.keys(RISK_CATEGORIES) as RiskCategory[]).map((k) => (
                <option key={k} value={k}>
                  {RISK_CATEGORIES[k]}
                </option>
              ))}
            </Select>
            <div className="flex rounded border border-sg-line p-0.5" role="radiogroup" aria-label="Risk level">
              {(["low", "medium", "high"] as const).map((lv) => (
                <button key={lv} type="button" role="radio" aria-checked={r.level === lv} onClick={() => patch(r.id, { level: lv })} className={cn("h-6 rounded-sm px-2 text-2xs font-semibold capitalize", r.level === lv ? "bg-sg-card-3 text-sg-white" : "text-sg-dim hover:text-sg-white")}>
                  {lv}
                </button>
              ))}
            </div>
            <Chip color={LEVEL_COLOR[r.level]}>{r.level}</Chip>
            <Button size="icon" variant="ghost" className="ml-auto" aria-label="Remove risk" onClick={() => onChange(risks.filter((x) => x.id !== r.id))}>
              <Trash2 />
            </Button>
          </div>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <Textarea value={r.description} onChange={(e) => patch(r.id, { description: e.target.value })} placeholder="Risk description" className="min-h-[60px]" aria-label="Risk description" />
            <Textarea value={r.mitigation} onChange={(e) => patch(r.id, { mitigation: e.target.value })} placeholder="Mitigation" className="min-h-[60px]" aria-label="Mitigation" />
          </div>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => onChange([...risks, { id: uid("rk"), category: "technical", description: "", mitigation: "", level: "medium" }])}>
        <Plus /> Add risk
      </Button>
    </div>
  );
}

type Econ = ReturnType<typeof proposalEconomics>;

function ProfitabilityTable({ econ }: { econ: Econ }) {
  const cols = [
    ["worst", "Worst"],
    ["expected", "Expected"],
    ["best", "Best"],
  ] as const;
  const rows: { label: React.ReactNode; get: (s: Econ["expected"]) => React.ReactNode; strong?: boolean }[] = [
    { label: "Revenue", get: (s) => <Money value={s.revenue} /> },
    { label: "Direct costs incl. contingency", get: (s) => <Money value={-s.costs} /> },
    { label: "Profit", get: (s) => <Money value={s.profit} className={s.profit < 0 ? "text-soft-red" : undefined} /> },
    { label: <>Estimated tax {Math.round(POLICY.corporateTaxRate * 100)}%<Cite s="3.4" /></>, get: (s) => <Money value={-s.tax} /> },
    { label: "Net revenue", get: (s) => <Money value={s.net} className={s.net < 0 ? "text-soft-red" : "text-sg-white"} />, strong: true },
    { label: <>Bonus pool (<Pct value={econ.share} /> of net)<Cite s="4.2" /></>, get: (s) => <Money value={s.pool} className="text-soft-green" />, strong: true },
    { label: "Company margin", get: (s) => <Money value={s.companyMargin} className={s.companyMargin < 0 ? "text-soft-red" : "text-sg-white"} /> },
    { label: "Margin % of revenue", get: (s) => <span className={cn("sg-num", s.marginPct < 0 ? "text-soft-red" : undefined)}>{s.revenue > 0 ? <Pct value={s.marginPct} /> : "—"}</span> },
  ];
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <Label className="mb-0">Profitability by scenario</Label>
        <span className="text-2xs text-sg-dim">
          Break-even revenue <Money value={econ.breakEvenRevenue} className="font-semibold text-sg-white" />
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-sg-line">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-sg-line text-2xs uppercase tracking-[0.1em] text-sg-dim">
              <th className="px-3 py-1.5 text-left font-semibold" />
              {cols.map(([k, l]) => (
                <th key={k} className={cn("px-3 py-1.5 text-right font-semibold", k === "expected" && "text-sg-white")}>
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={cn("border-b border-sg-line last:border-b-0", r.strong && "bg-sg-bg/40")}>
                <td className={cn("px-3 py-1.5 text-xs", r.strong ? "font-semibold text-sg-white" : "text-sg-muted")}>{r.label}</td>
                {cols.map(([k]) => (
                  <td key={k} className={cn("px-3 py-1.5 text-right text-xs", r.strong && "font-semibold", k === "expected" && "bg-sg-card-2/40")}>
                    {r.get(econ[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CheckPanel({
  gaps,
  deferral,
  econ,
  myBonus,
  proposer,
  proposerName,
  canSubmit,
  onSave,
  onSubmit,
}: {
  gaps: string[];
  deferral: string[];
  econ: Econ;
  myBonus: { bonus: number; weight: number; total: number; onTeam: boolean };
  proposer: ReturnType<typeof participationEligibility>;
  proposerName: string;
  canSubmit: boolean;
  onSave: () => void;
  onSubmit: () => void;
}) {
  const ALL_CHECKS = [
    "Project title",
    "Executive summary (2.2.1)",
    "Value proposition & strategic rationale (2.2.1)",
    "Scope of work (2.2.2)",
    "Deliverables & acceptance criteria (2.2.2)",
    "Performance metrics & success criteria (2.2.2)",
    "Timeline with start and completion dates (2.2.3)",
    "At least one milestone (2.2.3)",
    "Proposed team composition (2.2.4)",
    "Project Lead assigned (2.4)",
    "Revenue forecast (2.2.5)",
    "Scenarios must satisfy worst ≤ expected ≤ best (2.2.5)",
    "Client (2.2.6)",
    "Risk assessment — at least two risks with mitigations (2.2.7)",
  ];
  const checks = [...ALL_CHECKS, ...gaps.filter((g) => !ALL_CHECKS.includes(g))];
  const done = checks.length - gaps.length;
  return (
    <div className="rounded-xl border border-sg-line bg-sg-card">
      <div className="border-b border-sg-line px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="font-display text-sm font-extrabold text-sg-white">Proposal check</span>
          <span className={cn("sg-num text-xs font-semibold", gaps.length ? "text-soft-yellow" : "text-soft-green")}>
            {done}/{checks.length}
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-sg-card-3">
          <div className={cn("h-full", gaps.length ? "bg-soft-yellow" : "bg-soft-green")} style={{ width: `${(done / checks.length) * 100}%` }} />
        </div>
      </div>
      <ul className="max-h-[300px] space-y-1 overflow-y-auto px-4 py-3">
        {checks.map((c) => {
          const missing = gaps.includes(c);
          return (
            <li key={c} className={cn("flex items-start gap-1.5 text-2xs", missing ? "text-sg-muted" : "text-sg-dim")}>
              {missing ? <CircleAlert className="mt-px size-3.5 shrink-0 text-soft-yellow" /> : <CircleCheck className="mt-px size-3.5 shrink-0 text-soft-green" />}
              <span className={cn(!missing && "line-through decoration-sg-line-2")}>{c}</span>
            </li>
          );
        })}
      </ul>

      <div className="space-y-3 border-t border-sg-line px-4 py-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="sg-eyebrow">Expected pool</div>
            <Money value={econ.expected.pool} className="font-display text-lg font-extrabold text-soft-green" />
            <div className="text-2xs text-sg-dim">
              <Pct value={econ.share} /> of <Money value={econ.expected.net} /> net
            </div>
          </div>
          <div>
            <div className="sg-eyebrow">Your projected bonus</div>
            <Money value={myBonus.bonus} className="font-display text-lg font-extrabold text-sg-white" />
            <div className="text-2xs text-sg-dim">{myBonus.onTeam ? `weight ${myBonus.weight.toFixed(2)} of ${myBonus.total.toFixed(2)}` : "not on this team"}</div>
          </div>
        </div>
        {deferral.length > 0 ? (
          <div className="rounded-lg border border-soft-orange/40 bg-soft-orange/10 p-2.5 text-2xs text-soft-orange">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <Hourglass className="size-3.5" /> 30% of bonuses will be deferred
              <Cite s="6.3" />
            </div>
            <ul className="list-disc space-y-0.5 pl-4 text-sg-text">
              {deferral.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            <p className="mt-1 text-sg-muted">Vests after {POLICY.deferral.minMonths}–{POLICY.deferral.maxMonths} months as set by the PRC.</p>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-2xs text-sg-dim">
            <CircleCheck className="size-3.5 text-soft-green" /> No deferral triggers<Cite s="6.3" />
          </p>
        )}
        {!proposer.ok && (
          <div className="rounded-lg border border-soft-red/40 bg-soft-red/10 p-2.5 text-2xs text-soft-red">
            <div className="mb-0.5 font-semibold">
              {proposerName} cannot submit proposals
              <Cite s="2.1" />
            </div>
            <ul className="list-disc pl-4">
              {proposer.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-sg-line px-4 py-3">
        <Button variant="primary" size="md" className="w-full" disabled={!canSubmit} onClick={onSubmit} title={canSubmit ? "Submit to the Project Review Committee" : `Complete first:\n• ${[...gaps, ...proposer.blockers].join("\n• ")}`}>
          <Send /> Submit to PRC
        </Button>
        {!canSubmit && gaps.length > 0 && <p className="text-2xs text-sg-dim">{gaps.length} item{gaps.length === 1 ? "" : "s"} still missing — see the checklist above.</p>}
        <Button variant="outline" size="md" className="w-full" onClick={onSave}>
          Save draft <Kbd className="ml-1">⌘↵</Kbd>
        </Button>
        <p className="text-2xs leading-snug text-sg-dim">
          The PRC acknowledges within {POLICY.sla.acknowledgeBusinessDays} business day and decides within {POLICY.sla.decisionBusinessDays} business days of submission<Cite s="2.3" />.
        </p>
      </div>
    </div>
  );
}
