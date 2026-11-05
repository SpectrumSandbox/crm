"use client";

/*
 * Project proposal form — Policy v4.0 §4.3 content, laid out as Annex A (Part 1 summary, Part 2 delivery plan,
 * Part 3 financials and risk). Sticky section nav on the left, sticky "Proposal check" panel (tier, gaps,
 * economics, submit) on the right. `fromDealId` prefills a new proposal from a CRM deal.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, CalendarDays, Check, CircleAlert, CircleCheck, Coins, FileText, Gavel, Hourglass, Info, Plus, Send, ShieldAlert, Sparkles, Target, Trash2, Users } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { Activity, Deal, LineItem, Pipeline, Product, Quote } from "@/lib/types";
import type { ContractStatus, Initiative, InitiativeMember, Milestone, ProjectType, RiskCategory, RiskItem } from "@/lib/initiatives/types";
import { addMonths, approvalTier, endDateForMonths, contractedMonths, deferralTriggers, directCostTotal, effectiveWeight, participationEligibility, projectedAnnualNet, proposalEconomics, proposalGaps, splitBonus } from "@/lib/initiatives/engine";
import { ORIGINATION_META, POLICY, PROJECT_TYPE_META, RISK_CATEGORIES, TIER_META } from "@/lib/initiatives/policy";
import { cn, formatDate, formatIDR, fromDateInput, toDateInput, uid } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Chip, EmptyState, Kbd } from "@/components/ui/misc";
import { Cite, Money, Pct, Rate, RateCurve, StatusChip, TierChip, milestoneWorkPeriods } from "./shared";
import { TeamEditor } from "./team-editor";

type Origination = NonNullable<Initiative["origination"]>;

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
  | "deferralMonths"
> & { origination: Origination; firstContactAt: string | null; unusualTerms: boolean; deferralPct: number; standardBonus: number };

const today = () => fromDateInput(toDateInput(new Date().toISOString()));

function blankForm(): FormState {
  const start = today();
  return {
    title: "",
    type: "A",
    origination: "personal",
    firstContactAt: null,
    summary: "",
    valueProposition: "",
    scope: "",
    deliverables: "",
    exclusions: "",
    successCriteria: "",
    startDate: start,
    endDate: endDateForMonths(start, 6), // six contracted months (§5.1)
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
    unusualTerms: false,
    deferralPct: POLICY.deferral.defaultPct,
    deferralMonths: POLICY.deferral.minMonths,
    standardBonus: POLICY.typeCMinimum.standardBonus,
  };
}

function pickForm(i: Initiative): FormState {
  const b = blankForm();
  return structuredClone({
    ...b,
    title: i.title,
    type: i.type,
    origination: i.origination ?? "personal",
    firstContactAt: i.firstContactAt ?? null,
    summary: i.summary,
    valueProposition: i.valueProposition,
    scope: i.scope,
    deliverables: i.deliverables,
    exclusions: i.exclusions,
    successCriteria: i.successCriteria,
    startDate: i.startDate,
    endDate: i.endDate,
    milestones: i.milestones,
    companyId: i.companyId,
    dealId: i.dealId,
    contractStatus: i.contractStatus,
    newClient: i.newClient,
    paymentTermsDays: i.paymentTermsDays,
    revenue: i.revenue,
    costs: i.costs,
    risks: i.risks,
    warranty: i.warranty,
    unusualTerms: i.unusualTerms ?? false,
    deferralPct: i.deferralPct ?? POLICY.deferral.defaultPct,
    deferralMonths: i.deferralMonths || POLICY.deferral.minMonths,
    standardBonus: i.standardBonus ?? POLICY.typeCMinimum.standardBonus,
  });
}

/* ───────────────────────── prefill from a CRM deal (Part 2 #3) ───────────────────────── */

interface DealContext {
  deals: Deal[];
  pipelines: Pipeline[];
  activities: Activity[];
  quotes: Quote[];
  lineItems: LineItem[];
  products: Product[];
}

const CONSULTING = /study|consult|advis|training|audit|feasib|assessment|certification|retainer/i;

/** "consulting-like → A, Prototyping & Manufacturing → C, else B" */
export function guessType(deal: Pick<Deal, "capability" | "name">): ProjectType {
  if (deal.capability === "Prototyping & Manufacturing") return "C";
  if (deal.capability === "Engineering Management" || CONSULTING.test(deal.name)) return "A";
  return "B";
}

/** Earliest activity linked to the deal or its company — origination evidence (§4.1). */
export function earliestContact(deal: Pick<Deal, "id" | "companyId">, activities: Activity[]) {
  const linked = activities.filter((a) => a.links.dealIds.includes(deal.id) || (deal.companyId && a.links.companyIds.includes(deal.companyId)));
  return linked.reduce<string | null>((min, a) => (!min || a.timestamp < min ? a.timestamp : min), null);
}

function formFromDeal(dealId: string, ctx: DealContext): { form: FormState; deal: Deal } | null {
  const deal = ctx.deals.find((d) => d.id === dealId);
  if (!deal) return null;
  const stage = ctx.pipelines.find((p) => p.id === deal.pipelineId)?.stages.find((s) => s.id === deal.stageId);
  const won = stage?.closed === "won";
  const base = blankForm();
  const close = Date.parse(deal.closeDate);
  const start = !won && close > Date.now() ? fromDateInput(toDateInput(deal.closeDate)) : base.startDate;
  const end = endDateForMonths(start, 6);
  const name = (productId: string) => ctx.products.find((p) => p.id === productId)?.name ?? "Deliverable";
  const amount = (l: Pick<LineItem, "quantity" | "unitPrice" | "discountPct">) => Math.round(l.quantity * l.unitPrice * (1 - l.discountPct / 100));
  // a signed / sent quote is the best record of what was sold; otherwise the deal's line items
  const quote = [...ctx.quotes.filter((q) => q.dealId === deal.id && q.status !== "expired")].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const items = quote?.lineItems.length ? quote.lineItems.map((l) => ({ name: name(l.productId), amount: amount(l) })) : ctx.lineItems.filter((l) => l.dealId === deal.id).map((l) => ({ name: name(l.productId), amount: amount(l) }));
  const span = Date.parse(end) - Date.parse(start);
  const milestones: Milestone[] = items.map((it, i) => ({
    id: uid("ms"),
    name: it.name,
    dueDate: fromDateInput(toDateInput(new Date(Date.parse(start) + (span * (i + 1)) / items.length).toISOString())),
    paymentAmount: it.amount,
    done: false,
  }));
  return {
    deal,
    form: {
      ...base,
      title: deal.name.replace(/^[A-Z][A-Za-z0-9&]{1,6}\s+[—–-]\s+/, ""),
      type: guessType(deal),
      origination: "personal",
      firstContactAt: earliestContact(deal, ctx.activities),
      summary: deal.description,
      companyId: deal.companyId,
      dealId: deal.id,
      contractStatus: won ? "signed" : "verbal",
      paymentTermsDays: 30,
      startDate: start,
      endDate: end,
      revenue: { expected: deal.amount, best: Math.round(deal.amount * 1.1), worst: Math.round(deal.amount * 0.85) },
      milestones,
      standardBonus: POLICY.typeCMinimum.standardBonus,
    },
  };
}

/** Full Initiative used to evaluate tier/gaps/economics before (or after) the draft exists in the store. */
function compose(form: FormState, base: Initiative | undefined, id: string, currentUserId: string): Initiative {
  const ts = base?.createdAt ?? new Date().toISOString();
  return {
    id,
    trackingNo: base?.trackingNo ?? "",
    code: base?.code ?? null,
    status: base?.status ?? "draft",
    initiatorId: base?.initiatorId ?? currentUserId,
    highRisk: base?.highRisk ?? false,
    lockedSharePct: base?.lockedSharePct ?? null,
    policyVersion: base?.policyVersion ?? "4.0",
    submittedAt: base?.submittedAt ?? null,
    acknowledgedAt: base?.acknowledgedAt ?? null,
    primaryReviewerId: base?.primaryReviewerId ?? null,
    scores: base?.scores ?? null,
    decision: base?.decision ?? null,
    appeal: base?.appeal ?? null,
    approvedAt: base?.approvedAt ?? null,
    completedAt: base?.completedAt ?? null,
    epicId: base?.epicId ?? null,
    jiraProjectId: base?.jiraProjectId ?? null,
    demo: base?.demo,
    createdAt: ts,
    updatedAt: base?.updatedAt ?? ts,
    ...form,
    standardBonus: form.type === "C" ? form.standardBonus : undefined,
  };
}

const SECTIONS = [
  { id: "sec-summary", n: 1, label: "Business case", cite: "4.3", icon: FileText },
  { id: "sec-scope", n: 2, label: "Scope", cite: "4.3", icon: Target },
  { id: "sec-timeline", n: 3, label: "Schedule", cite: "4.3", icon: CalendarDays },
  { id: "sec-team", n: 4, label: "Team & weights", cite: "6.7", icon: Users },
  { id: "sec-budget", n: 5, label: "Financials", cite: "5.1", icon: Coins },
  { id: "sec-client", n: 6, label: "Client", cite: "4.3", icon: Building2 },
  { id: "sec-risks", n: 7, label: "Risks", cite: "4.3", icon: ShieldAlert },
] as const;

export const CONTRACT_STATUS: Record<ContractStatus, string> = { none: "No contract yet", verbal: "Verbal agreement", loi: "Letter of intent", signed: "Signed contract" };
const COST_FIELDS = [
  ["materials", "Materials"],
  ["subcontractors", "Subcontractors"],
  ["equipment", "Equipment & workshops"],
  ["travel", "Travel"],
  ["other", "Other direct costs"],
] as const;
const DEFERRAL_PCTS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
const DEFERRAL_MONTHS = Array.from({ length: POLICY.deferral.maxMonths - POLICY.deferral.minMonths + 1 }, (_, i) => POLICY.deferral.minMonths + i);


/* ───────────────────────── component ───────────────────────── */

export function ProposalForm({ editId, fromDealId = null }: { editId: string | null; fromDealId?: string | null }) {
  const router = useRouter();
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const profiles = useCrm((s) => s.employeeProfiles);
  const companies = useCrm((s) => s.companies);
  const deals = useCrm((s) => s.deals);
  const activities = useCrm((s) => s.activities);
  const currentUserId = useCrm((s) => s.currentUserId);
  const saveInitiative = useCrm((s) => s.saveInitiative);
  const syncDraftTeamStart = useCrm((s) => s.syncDraftTeamStart);
  const submitInitiative = useCrm((s) => s.submitInitiative);
  const updateMember = useCrm((s) => s.updateMember);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();

  // id of the draft this form edits: from ?edit=, or the one we just created (before the URL catches up)
  const [ownId, setOwnId] = useState<string | null>(editId);
  const ownIdRef = useRef<string | null>(editId);
  const existing = ownId ? initiatives.find((i) => i.id === ownId) : undefined;
  const [prefill] = useState(() => (!editId && fromDealId ? formFromDeal(fromDealId, useCrm.getState()) : null));
  const [form, setForm] = useState<FormState>(() => (existing ? pickForm(existing) : prefill ? prefill.form : blankForm()));
  const [dirty, setDirty] = useState(!!prefill);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(existing?.updatedAt ?? null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);

  useEffect(() => {
    if (prefill) notify(`Prefilled from deal “${prefill.deal.name}” — check the figures before saving`);
    else if (!editId && fromDealId) notify("Deal not found — starting a blank proposal");
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const tier = useMemo(() => approvalTier(composed), [composed]);
  const team = useMemo(() => (id ? members.filter((m) => m.initiativeId === id && !m.leftAt && m.consent !== "declined") : []), [members, id]);
  const previewMembers = useMemo(() => {
    if (id) return members;
    // before the first save: the proposer will be Initiator (unless company channel) + Project Lead (§4.1, §4.9)
    const ghost: InitiativeMember = {
      id: "__ghost",
      initiativeId: "__new",
      userId: currentUserId,
      roles: form.origination === "company" ? ["project_lead"] : ["initiator", "project_lead"],
      specialistWeight: null,
      weightOverride: null,
      allocationFactor: 1,
      consent: "accepted",
      managerApproved: true,
      prcApproved: false,
      application: false,
      allocationPct: 30,
      joinedAt: form.startDate,
      leftAt: null,
      removal: { stage: "none", updatedAt: null, note: "" },
    };
    return [ghost];
  }, [id, members, currentUserId, form.origination, form.startDate]);
  const gaps = useMemo(() => proposalGaps(composed, previewMembers), [composed, previewMembers]);
  const deferral = useMemo(() => deferralTriggers(composed, adjustments), [composed, adjustments]);
  const proposer = useMemo(() => participationEligibility(profiles.find((p) => p.userId === (existing?.initiatorId ?? currentUserId))), [profiles, existing, currentUserId]);

  const myBonus = useMemo(() => {
    const rows = team.length ? team : previewMembers.filter((m) => m.initiativeId === "__new");
    const weights = rows.map((m) => ({ userId: m.userId, weight: effectiveWeight(m) }));
    const split = splitBonus(weights, econ.rate.rate, econ.expected.net);
    const mine = split.shares.find((s) => s.userId === currentUserId);
    return { bonus: mine?.bonus ?? 0, weight: mine?.weight ?? 0, total: split.total, onTeam: !!mine };
  }, [team, previewMembers, econ, currentUserId]);

  /** §4.1 company channels carry no Initiator weight — keep the proposer's ledger row in step with the origination. */
  const syncInitiatorRole = (iniId: string, origination: Origination, initiatorId: string) => {
    const rows = useCrm.getState().initiativeMembers.filter((m) => m.initiativeId === iniId && m.userId === initiatorId && !m.leftAt);
    for (const m of rows) {
      const has = m.roles.includes("initiator");
      if (origination === "company" && has) {
        const roles = m.roles.filter((r) => r !== "initiator");
        updateMember(m.id, { roles: roles.length ? roles : ["project_lead"] });
      }
      if (origination !== "company" && !has) updateMember(m.id, { roles: ["initiator", ...m.roles] });
    }
  };

  const save = (opts: { silent?: boolean } = {}) => {
    const payload: Partial<Initiative> = { ...form, title: form.title.trim() || "Untitled initiative", standardBonus: form.type === "C" ? Math.max(POLICY.typeCMinimum.standardBonus, form.standardBonus) : undefined };
    const savedId = saveInitiative(id ? { ...payload, id } : payload);
    if (id) syncInitiatorRole(savedId, form.origination, existing?.initiatorId ?? currentUserId);
    // §6.5 while the proposal is a draft, every team row starts with the project — move them with a changed start date
    if (form.startDate) syncDraftTeamStart(savedId, form.startDate);
    if (!id) {
      ownIdRef.current = savedId;
      setOwnId(savedId);
    }
    setForm((f) => ({ ...f, title: payload.title! }));
    setDirty(false);
    setLastSavedAt(new Date().toISOString());
    if (!id) router.replace(`/initiatives/new?edit=${savedId}`);
    if (!opts.silent) notify(id ? "Draft saved" : "Draft created — now build the Role and Weight Agreement");
    return savedId;
  };

  const canSubmit = gaps.length === 0 && proposer.ok && !!id;
  const submit = () => {
    if (!canSubmit) return;
    const savedId = save({ silent: true });
    submitInitiative(savedId);
    const trackingNo = useCrm.getState().initiatives.find((i) => i.id === savedId)?.trackingNo ?? "";
    notify(`Submitted to PRC — tracking no. ${trackingNo} · ${TIER_META[tier.tier].label}`);
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
              <Cite s="4.5" />. Follow its review, team and economics on the initiative page.
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
  const validDates = Date.parse(form.endDate) > Date.parse(form.startDate);
  const months = validDates ? contractedMonths(form) : 0;
  const crmContact = (() => {
    const deal = deals.find((d) => d.id === form.dealId);
    if (deal) return earliestContact(deal, activities);
    if (form.companyId) return earliestContact({ id: "__none", companyId: form.companyId }, activities);
    return null;
  })();

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={existing ? form.title || "Untitled initiative" : "New proposal"} crumbs={crumbs} meta={<StatusChip status="draft" />}>
        <span className="text-2xs text-sg-dim">{dirty ? "Unsaved changes" : lastSavedAt ? `Saved ${formatDate(lastSavedAt, "datetime")}` : "Not saved yet"}</span>
        <Button variant="outline" size="md" onClick={() => save()}>
          Save draft <Kbd className="ml-1">⌘↵</Kbd>
        </Button>
      </PageHeader>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1480px] grid-cols-1 gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_330px] xl:grid-cols-[180px_minmax(0,1fr)_330px]">
          {/* section nav */}
          <nav className="sticky top-5 hidden self-start xl:block" aria-label="Proposal sections">
            <div className="sg-eyebrow mb-2">Proposal · Annex A</div>
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
            <p className="mt-3 text-2xs leading-snug text-sg-dim">
              {TIER_META[tier.tier].label}: {TIER_META[tier.tier].proposal.toLowerCase()}
              <Cite s="4.2" />
            </p>
          </nav>

          {/* form */}
          <div className="min-w-0 space-y-5">
            {prefill ? (
              <div className="flex items-start gap-2 rounded-lg border border-soft-cyan/40 bg-soft-cyan/10 px-3 py-2 text-xs text-sg-text">
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-soft-cyan" />
                <span>
                  Prefilled from deal{" "}
                  <Link href={`/deals/${prefill.deal.id}`} className="font-semibold text-sg-white hover:underline">
                    {prefill.deal.name}
                  </Link>
                  : client, expected revenue (best 1.1×, worst 0.85×), type guess from “{prefill.deal.capability}”, contract status, first CRM contact{form.milestones.length ? ` and ${form.milestones.length} milestone${form.milestones.length === 1 ? "" : "s"} from the quote / line items` : ""}. Save the draft to keep it.
                </span>
              </div>
            ) : null}

            {/* 1 */}
            <Section id="sec-summary" n={1} title="Business case" cite="4.3">
              <Field label="Project name">
                <Input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="e.g. Crane telemetry rollout — Priok Terminal" autoFocus={!existing && !prefill} />
              </Field>
              <div>
                <Label>
                  Project type <Cite s="5.1" />
                </Label>
                <div className="grid gap-2 md:grid-cols-3">
                  {(["A", "B", "C"] as ProjectType[]).map((t) => (
                    <TypeCard key={t} type={t} selected={form.type === t} onSelect={() => update("type", t)} />
                  ))}
                </div>
                <p className="mt-1.5 text-2xs text-sg-dim">All types share one revenue-share curve; the type sets leadership capacity, the approval tier and deferral. Type C adds a guaranteed minimum monthly pool<Cite s="8.6" />.</p>
              </div>
              <div>
                <Label>
                  Origination — how the opportunity arose <Cite s="4.1" />
                </Label>
                <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label="Origination">
                  {(Object.keys(ORIGINATION_META) as Origination[]).map((o) => (
                    <button
                      key={o}
                      type="button"
                      role="radio"
                      aria-checked={form.origination === o}
                      onClick={() => update("origination", o)}
                      className={cn("rounded-lg border p-2.5 text-left transition-colors", form.origination === o ? "border-sg-white/70 bg-sg-card-2" : "border-sg-line hover:border-sg-line-2")}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-sg-white">
                        {ORIGINATION_META[o].label}
                        {form.origination === o ? <Check className="size-3.5" /> : null}
                      </div>
                      <p className="mt-1 text-2xs leading-snug text-sg-muted">{ORIGINATION_META[o].description}</p>
                    </button>
                  ))}
                </div>
                {form.origination === "company" ? (
                  <p className="mt-1.5 flex items-start gap-1.5 text-2xs text-soft-yellow">
                    <Info className="mt-px size-3.5 shrink-0" /> No Initiator weight (0.5) on this project — the PRC appoints the Project Lead. Saving removes the Initiator role from the Role and Weight Agreement.
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <div className="w-44">
                    <Label>First CRM contact date</Label>
                    <Input type="date" value={toDateInput(form.firstContactAt)} onChange={(e) => update("firstContactAt", e.target.value ? fromDateInput(e.target.value) : null)} />
                  </div>
                  {crmContact && toDateInput(crmContact) !== toDateInput(form.firstContactAt) ? (
                    <Button size="sm" variant="ghost" onClick={() => update("firstContactAt", crmContact)}>
                      Use earliest CRM activity · {formatDate(crmContact, "medium")}
                    </Button>
                  ) : null}
                  <p className="pb-1.5 text-2xs text-sg-dim">The earliest documented client contact in the CRM is the main evidence of origination.</p>
                </div>
              </div>
              <Field label="Business case — opportunity, client need, value and fit with strategy" hint={`${form.summary.trim().length} characters · at least 40`}>
                <Textarea value={form.summary} onChange={(e) => update("summary", e.target.value)} placeholder="The opportunity, the client's need and why the company should take it — in a paragraph the PRC can read in a minute." />
              </Field>
              <Field label="Value to the company & strategic fit">
                <Textarea value={form.valueProposition} onChange={(e) => update("valueProposition", e.target.value)} placeholder="Client relationship value, fit with Spectrum Group capabilities, follow-on potential." className="min-h-[64px]" />
              </Field>
            </Section>

            {/* 2 */}
            <Section id="sec-scope" n={2} title="Scope" cite="4.3">
              <Field label="Scope of work, technical standards and dependencies">
                <Textarea value={form.scope} onChange={(e) => update("scope", e.target.value)} placeholder="Work packages, sites, systems in scope; standards and dependencies." />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Deliverables & acceptance criteria">
                  <Textarea value={form.deliverables} onChange={(e) => update("deliverables", e.target.value)} placeholder="One deliverable per line, with how the client accepts it." />
                </Field>
                <Field label="What is excluded">
                  <Textarea value={form.exclusions} onChange={(e) => update("exclusions", e.target.value)} placeholder="What is explicitly out of scope." />
                </Field>
              </div>
              <Field label="Success criteria">
                <Textarea value={form.successCriteria} onChange={(e) => update("successCriteria", e.target.value)} placeholder="Measurable targets (uptime, accuracy, schedule, margin…)." className="min-h-[64px]" />
              </Field>
            </Section>

            {/* 3 */}
            <Section id="sec-timeline" n={3} title="Schedule & payment milestones" cite="4.3">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Start date">
                  <Input type="date" value={toDateInput(form.startDate)} onChange={(e) => e.target.value && update("startDate", fromDateInput(e.target.value))} />
                </Field>
                <Field label="Contracted end date (final delivery)">
                  <Input type="date" value={toDateInput(form.endDate)} onChange={(e) => e.target.value && update("endDate", fromDateInput(e.target.value))} />
                </Field>
                <div className="flex items-end pb-1.5 text-xs text-sg-muted">
                  {validDates ? (
                    <span>
                      Contracted duration <span className="sg-num font-semibold text-sg-white">{months}</span> month{months === 1 ? "" : "s"} (rounded up)
                      <Cite s="5.1" />
                    </span>
                  ) : (
                    <span className="font-semibold text-soft-red">The end date must be after the start</span>
                  )}
                </div>
              </div>
              <p className="-mt-2 text-2xs text-sg-dim">Contracted duration runs from the start date to final delivery in the signed client contract. Internal delays do not lengthen it{months > 12 ? "; over 12 months, x is the average annual net revenue" : ""}.</p>
              <MilestoneEditor milestones={form.milestones} startDate={form.startDate} endDate={form.endDate} onChange={(v) => update("milestones", v)} />
              {form.milestones.length > 0 && (
                <p className={cn("text-2xs", milestoneTotal > 0 && form.revenue.expected > 0 && Math.abs(milestoneTotal - form.revenue.expected) > 1 ? "text-soft-yellow" : "text-sg-dim")}>
                  Payment milestones total <Money value={milestoneTotal} className="font-semibold" />
                  {form.revenue.expected > 0 ? (
                    <>
                      {" "}
                      of <Money value={form.revenue.expected} /> expected revenue ({Math.round((milestoneTotal / form.revenue.expected) * 100)}%). Each payment&apos;s pool is shared among the people on the team during its work period
                      <Cite s="6.5" />
                    </>
                  ) : null}
                </p>
              )}
            </Section>

            {/* 4 */}
            <Section id="sec-team" n={4} title="Team — Role and Weight Agreement" cite="6.7">
              {id ? (
                <>
                  <p className="text-xs text-sg-muted">
                    You are added as {form.origination === "company" ? "Project Lead (2.0) — no Initiator weight for a company-channel opportunity" : "Project Initiator (0.5) and Project Lead (2.0)"}
                    <Cite s="4.9" />. Every member signs the Role and Weight Agreement and has line manager agreement before submission; the PRC checks eligibility and capacity at approval<Cite s="Annex D" />.
                  </p>
                  <TeamEditor initiativeId={id} mode="proposal" />
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-sg-line-2 p-4">
                  <Info className="size-4 text-sg-dim" />
                  <p className="min-w-0 flex-1 text-xs text-sg-muted">Save the draft first so team members can be attached. You&apos;ll be added automatically as {form.origination === "company" ? "Project Lead" : "Project Initiator and Project Lead"}.</p>
                  <Button variant="outline" size="sm" onClick={() => save()}>
                    Save draft & add team
                  </Button>
                </div>
              )}
            </Section>

            {/* 5 */}
            <Section id="sec-budget" n={5} title="Financials" cite="5.1">
              <div>
                <Label>
                  Revenue excl. VAT — the expected case sets the revenue-share rate <Cite s="4.3" />
                </Label>
                <div className="grid gap-4 sm:grid-cols-3">
                  <MoneyField label="Worst case" value={form.revenue.worst} onChange={(v) => update("revenue", { ...form.revenue, worst: v })} />
                  <MoneyField label="Expected case" value={form.revenue.expected} onChange={(v) => update("revenue", { ...form.revenue, expected: v })} emphasis />
                  <MoneyField label="Best case" value={form.revenue.best} onChange={(v) => update("revenue", { ...form.revenue, best: v })} />
                </div>
                {!(form.revenue.worst <= form.revenue.expected && form.revenue.expected <= form.revenue.best) && (form.revenue.best > 0 || form.revenue.worst > 0) && <p className="mt-1 text-2xs font-semibold text-soft-red">Scenarios must satisfy worst ≤ expected ≤ best.</p>}
              </div>
              <div>
                <Label>
                  Direct costs <Cite s="5.3" />
                </Label>
                <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  {COST_FIELDS.map(([k, label]) => (
                    <MoneyField key={k} label={label} value={form.costs[k]} onChange={(v) => update("costs", { ...form.costs, [k]: v })} />
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className="text-2xs font-semibold uppercase tracking-[0.12em] text-sg-dim">Contingency</span>
                  <input type="range" min={0} max={30} step={1} value={form.costs.contingencyPct} onChange={(e) => update("costs", { ...form.costs, contingencyPct: Number(e.target.value) })} className="w-56 accent-sg-white" aria-label="Contingency percent" />
                  <span className={cn("sg-num w-10 text-sm font-semibold", form.costs.contingencyPct < 10 || form.costs.contingencyPct > 20 ? "text-soft-red" : "text-sg-white")}>{form.costs.contingencyPct}%</span>
                  <span className={cn("text-2xs", form.costs.contingencyPct < 10 || form.costs.contingencyPct > 20 ? "font-semibold text-soft-red" : "text-sg-dim")}>must be 10–20%</span>
                  <span className="ml-auto text-xs text-sg-muted">
                    Direct costs incl. contingency <Money value={directCostTotal(form.costs)} className="font-semibold text-sg-white" />
                  </span>
                </div>
                <p className="mt-1 text-2xs text-sg-dim">Salaries and benefits of team members are not direct costs — they are covered by the company share.</p>
              </div>
              <EconomicsTable econ={econ} months={months} />
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="rounded-lg border border-sg-line p-3">
                  <div className="sg-eyebrow mb-1 flex items-center">
                    Revenue-share rate <Cite s="5.1" />
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <Rate value={econ.rate.rate} className="font-display text-2xl font-extrabold text-sg-white" />
                    <span className="text-xs text-sg-muted">
                      x = <Money value={econ.rate.x} className="text-sg-white" /> over {econ.rate.months} month{econ.rate.months === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="mt-1 text-2xs text-sg-dim">
                    {econ.rate.source === "provisional"
                      ? "Provisional — enter the expected case. Shown at the top of the curve."
                      : `y = ${Math.round(econ.rate.curve.start * 100)}% ÷ (1 + ${(econ.rate.curve.start / econ.rate.curve.floor - 1).toFixed(0)}x ÷ ${formatIDR(econ.rate.curve.decay)}), ${Math.round(econ.rate.curve.floor * 100)}% at and above ${formatIDR(econ.rate.curve.decay)}. A flat rate on all of the project's net revenue for its whole life; the PRC fixes it at approval.`}
                  </p>
                  <p className="mt-2 text-2xs text-sg-dim">More revenue never pays less: the pool rises with net revenue for any contract length.</p>
                </div>
                <div className="rounded-lg border border-sg-line p-3">
                  <RateCurve x={econ.rate.x} curve={econ.rate.curve} months={econ.rate.months} />
                </div>
              </div>

              {/* §9.3 deferral */}
              <div className={cn("rounded-lg border p-3", deferral.length ? "border-soft-orange/40 bg-soft-orange/5" : "border-sg-line")}>
                <div className="sg-eyebrow mb-1 flex items-center">
                  Deferral for high-risk projects <Cite s="9.3" />
                </div>
                {deferral.length ? (
                  <>
                    <ul className="mb-2 space-y-0.5 text-xs text-sg-text">
                      {deferral.map((d) => (
                        <li key={d} className="flex items-start gap-1.5">
                          <Hourglass className="mt-0.5 size-3 shrink-0 text-soft-orange" /> {d}
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="w-36">
                        <Label>Proposed deferral</Label>
                        <Select value={String(form.deferralPct)} onChange={(e) => update("deferralPct", Number(e.target.value))}>
                          {DEFERRAL_PCTS.map((p) => (
                            <option key={p} value={p}>
                              {Math.round(p * 100)}% of each bonus
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="w-40">
                        <Label>Deferred for</Label>
                        <Select value={String(form.deferralMonths)} onChange={(e) => update("deferralMonths", Number(e.target.value))}>
                          {DEFERRAL_MONTHS.map((n) => (
                            <option key={n} value={n}>
                              {n} months after close
                            </option>
                          ))}
                        </Select>
                      </div>
                      <p className="min-w-[200px] flex-1 pb-1.5 text-2xs text-sg-dim">Up to 30% for 6–12 months after close; the PRC sets the percentage and period at approval{form.type === "C" ? ". Deferral never takes a Type C monthly pool below its standard bonus" : ""}.</p>
                    </div>
                  </>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-sg-muted">
                    <CircleCheck className="size-3.5 text-soft-green" /> No deferral trigger applies — net revenue ≤ {formatIDR(POLICY.deferral.netRevenueThreshold)}, payment terms ≤ {POLICY.deferral.paymentTermsDays} days, existing client{form.type === "C" ? ", no warranty" : ""}.
                  </p>
                )}
              </div>

              {/* §8.6 Type C */}
              {form.type === "C" ? (
                <div className="rounded-lg border border-soft-magenta/40 bg-soft-magenta/5 p-3">
                  <div className="sg-eyebrow mb-1 flex items-center">
                    Type C guaranteed minimum <Cite s="8.6" />
                  </div>
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="w-56">
                      <Label>Proposed standard bonus (Rp a month)</Label>
                      <MoneyInput value={form.standardBonus} onChange={(v) => update("standardBonus", v)} ariaLabel="Standard bonus" />
                      {form.standardBonus < POLICY.typeCMinimum.standardBonus ? <p className="text-2xs font-semibold text-soft-red">At least {formatIDR(POLICY.typeCMinimum.standardBonus, "full")} a month.</p> : null}
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 pb-6 text-xs text-sg-text">
                      <input type="checkbox" checked={form.warranty} onChange={(e) => update("warranty", e.target.checked)} className="size-3.5 accent-sg-white" />
                      The product carries a warranty period <span className="text-sg-dim">(deferral trigger, §9.3)</span>
                    </label>
                  </div>
                  <p className="text-2xs text-sg-dim">A minimum monthly pool paid whatever revenue the project makes, from the month work starts; top-ups are deducted from later revenue-based bonuses on the project. It ends after three months in a row above the standard bonus, or one month at 12× or more.</p>
                </div>
              ) : null}
            </Section>

            {/* 6 */}
            <Section id="sec-client" n={6} title="Client" cite="4.3">
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
                <Field label="Linked deal (optional)" hint={form.companyId ? (companyDeals.length ? "Choosing a deal fills the revenue cases when they are empty." : "No deals for this company.") : "Choose a company first."}>
                  <Select
                    value={form.dealId ?? ""}
                    disabled={!form.companyId || !companyDeals.length}
                    onChange={(e) => {
                      const did = e.target.value || null;
                      const deal = deals.find((d) => d.id === did);
                      setForm((f) => ({ ...f, dealId: did, revenue: deal && f.revenue.expected <= 0 ? { expected: deal.amount, best: Math.round(deal.amount * 1.1), worst: Math.round(deal.amount * 0.85) } : f.revenue }));
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
                <Field label="Payment terms (days)" hint={form.paymentTermsDays > POLICY.deferral.paymentTermsDays ? "Over 90 days — deferral trigger (§9.3)" : undefined}>
                  <Input inputMode="numeric" value={String(form.paymentTermsDays)} onChange={(e) => update("paymentTermsDays", Number(e.target.value.replace(/\D/g, "")) || 0)} className="sg-num" />
                </Field>
                <div className="flex flex-col justify-end gap-1.5 pb-1.5">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-sg-text">
                    <input type="checkbox" checked={form.newClient} onChange={(e) => update("newClient", e.target.checked)} className="size-3.5 accent-sg-white" />
                    New client with no payment history <span className="text-sg-dim">(Tier 2+, deferral)</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-sg-text">
                    <input type="checkbox" checked={form.unusualTerms} onChange={(e) => update("unusualTerms", e.target.checked)} className="size-3.5 accent-sg-white" />
                    New country or market, or unusual liability terms <span className="text-sg-dim">(→ Tier 3)</span>
                  </label>
                </div>
              </div>
            </Section>

            {/* 7 */}
            <Section id="sec-risks" n={7} title="Risks" cite="4.3">
              <RiskEditor risks={form.risks} onChange={(v) => update("risks", v)} required={tier.tier > 1} />
            </Section>
          </div>

          {/* check panel */}
          <aside className="self-start lg:sticky lg:top-5 lg:max-h-[calc(100dvh-6.5rem)] lg:overflow-y-auto">
            <CheckPanel
              gaps={gaps}
              tier={tier}
              deferral={deferral}
              deferralPct={form.deferralPct}
              econ={econ}
              myBonus={myBonus}
              proposer={proposer}
              proposerName={userMap.get(existing?.initiatorId ?? currentUserId)?.name ?? "Proposer"}
              saved={!!id}
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

function TypeCard({ type, selected, onSelect }: { type: ProjectType; selected: boolean; onSelect: () => void }) {
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
      <p className="mt-1 text-2xs leading-snug text-sg-muted">{m.description}</p>
      <p className="mt-1 flex-1 text-2xs leading-snug text-sg-dim">{m.examples}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 border-t border-sg-line pt-2">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-sg-dim">Capacity factor</div>
          <div className="sg-num text-sm font-bold text-sg-white">{m.capacityFactor.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-sg-dim">Tier</div>
          <div className="text-2xs font-semibold text-sg-white">{type === "C" ? "Always Tier 3" : "By value & client"}</div>
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
  const periods = milestoneWorkPeriods(milestones, startDate);
  return (
    <div>
      <Label>
        Milestones, client approval points and payment milestones <Cite s="6.5" />
      </Label>
      {milestones.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-sg-line">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-[0.1em] text-sg-dim">
                <th className="px-3 py-1.5 font-semibold">Milestone / deliverable</th>
                <th className="w-[150px] px-2 py-1.5 font-semibold">Planned acceptance</th>
                <th className="w-[200px] px-2 py-1.5 font-semibold">Payment</th>
                <th className="w-[150px] px-2 py-1.5 font-semibold">Work period it pays for</th>
                <th className="w-10 px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {milestones.map((m) => {
                const outside = Date.parse(m.dueDate) < Date.parse(startDate) - 86_400_000 || Date.parse(m.dueDate) > Date.parse(endDate) + 86_400_000;
                const wp = periods.get(m.id);
                return (
                  <tr key={m.id} className="border-b border-sg-line align-top last:border-b-0">
                    <td className="px-3 py-2">
                      <Input value={m.name} onChange={(e) => patch(m.id, { name: e.target.value })} placeholder="e.g. Factory acceptance test" aria-label="Milestone name" />
                    </td>
                    <td className="px-2 py-2">
                      <Input type="date" value={toDateInput(m.dueDate)} onChange={(e) => e.target.value && patch(m.id, { dueDate: fromDateInput(e.target.value) })} aria-label="Planned acceptance date" />
                      {outside && <p className="mt-1 text-2xs text-soft-yellow">Outside the contracted dates</p>}
                    </td>
                    <td className="px-2 py-2">
                      <MoneyInput value={m.paymentAmount} onChange={(v) => patch(m.id, { paymentAmount: v })} ariaLabel="Payment amount" />
                    </td>
                    <td className="sg-num px-2 py-2 pt-3.5 text-2xs text-sg-muted">{m.paymentAmount > 0 && wp ? `${formatDate(wp.from, "short")} → ${formatDate(wp.to, "medium")}` : <span className="text-sg-dim">not a payment</span>}</td>
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
          const last = [...milestones].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[milestones.length - 1];
          const due = last ? addMonths(last.dueDate, 1) : addMonths(startDate, 1);
          onChange([...milestones, { id: uid("ms"), name: "", dueDate: Date.parse(due) > Date.parse(endDate) ? endDate : due, paymentAmount: 0, done: false }]);
        }}
      >
        <Plus /> Add milestone
      </Button>
      <p className="mt-1 text-2xs text-sg-dim">A milestone payment&apos;s work period runs from the previous milestone (or the project start) to its acceptance.</p>
    </div>
  );
}

const LEVEL_COLOR = { low: "green", medium: "yellow", high: "red" } as const;

function RiskEditor({ risks, onChange, required }: { risks: RiskItem[]; onChange: (v: RiskItem[]) => void; required: boolean }) {
  const patch = (rid: string, p: Partial<RiskItem>) => onChange(risks.map((r) => (r.id === rid ? { ...r, ...p } : r)));
  return (
    <div className="space-y-3">
      <p className="text-xs text-sg-muted">
        Technical, schedule, financial, safety, legal and reputational risks, each with a mitigation{required ? " — at least two for Tier 2 and 3" : ""}. The PRC may rate the technical or execution risk high, which triggers deferral<Cite s="9.3" />.
      </p>
      {risks.map((r, idx) => (
        <div key={r.id} className="rounded-lg border border-sg-line p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="sg-num text-2xs font-semibold text-sg-dim">R{idx + 1}</span>
            <Select value={r.category} onChange={(e) => patch(r.id, { category: e.target.value as RiskCategory })} wrapperClassName="w-44" aria-label="Risk category">
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

/** Annex A Part 3 — best / expected / worst with UMKM tax, x, y, pool and company margin. */
export function EconomicsTable({ econ, months }: { econ: Econ; months: number }) {
  const cols = [
    ["worst", "Worst"],
    ["expected", "Expected"],
    ["best", "Best"],
  ] as const;
  const m = Math.max(1, months || econ.rate.months);
  const rows: { label: React.ReactNode; get: (s: Econ["expected"]) => React.ReactNode; strong?: boolean }[] = [
    { label: "Revenue excl. VAT", get: (s) => <Money value={s.revenue} /> },
    { label: "Direct costs incl. contingency", get: (s) => <Money value={-s.costs} /> },
    {
      label: (
        <>
          UMKM final tax 0.5% of revenue<Cite s="5.4" />
        </>
      ),
      get: (s) => <Money value={-s.tax} />,
    },
    { label: "Net revenue", get: (s) => <Money value={s.net} className={s.net < 0 ? "text-soft-red" : "text-sg-white"} />, strong: true },
    { label: <>Projected annual net revenue x{m > 12 ? ` (× 12 ÷ ${m})` : ""}</>, get: (s) => <Money value={projectedAnnualNet(s.net, m)} className="text-sg-muted" /> },
    {
      label: (
        <>
          Revenue-share rate y — set on the expected case<Cite s="5.1" />
        </>
      ),
      get: () => <Rate value={econ.rate.rate} />,
    },
    { label: "Bonus pool", get: (s) => <Money value={s.pool} className="text-soft-green" />, strong: true },
    { label: "Company margin after the pool", get: (s) => <Money value={s.companyMargin} className={s.companyMargin < 0 ? "text-soft-red" : "text-sg-white"} /> },
    { label: "Margin % of revenue", get: (s) => <span className={cn("sg-num", s.marginPct < 0 ? "text-soft-red" : undefined)}>{s.revenue > 0 ? <Pct value={s.marginPct} /> : "—"}</span> },
  ];
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <Label className="mb-0">
          Best, expected and worst cases <Cite s="Annex A" />
        </Label>
        <span className="text-2xs text-sg-dim">
          Break-even revenue <Money value={econ.breakEvenRevenue} className="font-semibold text-sg-white" />
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-sg-line">
        <table className="w-full min-w-[560px] text-sm">
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
  tier,
  deferral,
  deferralPct,
  econ,
  myBonus,
  proposer,
  proposerName,
  saved,
  canSubmit,
  onSave,
  onSubmit,
}: {
  gaps: string[];
  tier: ReturnType<typeof approvalTier>;
  deferral: string[];
  deferralPct: number;
  econ: Econ;
  myBonus: { bonus: number; weight: number; total: number; onTeam: boolean };
  proposer: ReturnType<typeof participationEligibility>;
  proposerName: string;
  saved: boolean;
  canSubmit: boolean;
  onSave: () => void;
  onSubmit: () => void;
}) {
  const t = TIER_META[tier.tier];
  return (
    <div className="space-y-3">
      {/* §4.2 tier */}
      <div className="rounded-xl border border-sg-line bg-sg-card px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-display text-sm font-extrabold text-sg-white">
            <Gavel className="size-4 text-sg-muted" /> Approval tier
            <Cite s="4.2" />
          </span>
          <TierChip tier={tier.tier} long />
        </div>
        <ul className="mt-2 space-y-0.5 text-2xs text-sg-muted">
          {tier.reasons.map((r) => (
            <li key={r} className="flex items-start gap-1.5">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-sg-muted" /> {r}
            </li>
          ))}
        </ul>
        <div className="mt-2 grid grid-cols-3 gap-2 border-t border-sg-line pt-2 text-2xs">
          <div>
            <div className="text-sg-dim">Proposal</div>
            <div className="text-sg-text">{t.proposal}</div>
          </div>
          <div>
            <div className="text-sg-dim">Who decides</div>
            <div className="text-sg-text">{t.decides}</div>
          </div>
          <div>
            <div className="text-sg-dim">Decision within</div>
            <div className="sg-num font-semibold text-sg-white">{t.decisionBusinessDays} business days</div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-sg-line bg-sg-card">
        <div className="border-b border-sg-line px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="font-display text-sm font-extrabold text-sg-white">Proposal check</span>
            <span className={cn("sg-num text-xs font-semibold", gaps.length ? "text-soft-yellow" : "text-soft-green")}>{gaps.length ? `${gaps.length} to complete` : "Complete"}</span>
          </div>
        </div>
        <ul className="max-h-[260px] space-y-1 overflow-y-auto px-4 py-3">
          {gaps.length ? (
            gaps.map((c) => (
              <li key={c} className="flex items-start gap-1.5 text-2xs text-sg-muted">
                <CircleAlert className="mt-px size-3.5 shrink-0 text-soft-yellow" />
                <span>{c}</span>
              </li>
            ))
          ) : (
            <li className="flex items-start gap-1.5 text-2xs text-sg-muted">
              <CircleCheck className="mt-px size-3.5 shrink-0 text-soft-green" /> Everything the {t.proposal.toLowerCase()} requires is in place<Cite s="4.3" />
            </li>
          )}
        </ul>

        <div className="space-y-3 border-t border-sg-line px-4 py-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="sg-eyebrow">Expected pool</div>
              <Money value={econ.expected.pool} className="font-display text-lg font-extrabold text-soft-green" />
              <div className="text-2xs text-sg-dim">
                <Rate value={econ.rate.rate} /> of <Money value={econ.expected.net} /> net
              </div>
            </div>
            <div>
              <div className="sg-eyebrow">Your projected bonus</div>
              <Money value={myBonus.bonus} className="font-display text-lg font-extrabold text-sg-white" />
              <div className="text-2xs text-sg-dim">{myBonus.onTeam ? `W×A ${myBonus.weight.toFixed(2)} of ${myBonus.total.toFixed(2)}` : "not on this team"}</div>
            </div>
            <div>
              <div className="sg-eyebrow">Company margin</div>
              <Money value={econ.expected.companyMargin} className={cn("font-display text-base font-extrabold", econ.expected.companyMargin < 0 ? "text-soft-red" : "text-sg-white")} />
              <div className="text-2xs text-sg-dim">{econ.expected.revenue > 0 ? <Pct value={econ.expected.marginPct} /> : "—"} of revenue</div>
            </div>
            <div>
              <div className="sg-eyebrow">x · months</div>
              <Money value={econ.rate.x} className="font-display text-base font-extrabold text-sg-white" />
              <div className="text-2xs text-sg-dim">{econ.rate.months} contracted month{econ.rate.months === 1 ? "" : "s"}</div>
            </div>
          </div>
          {deferral.length > 0 ? (
            <div className="rounded-lg border border-soft-orange/40 bg-soft-orange/10 p-2.5 text-2xs text-soft-orange">
              <div className="mb-1 flex items-center gap-1.5 font-semibold">
                <Hourglass className="size-3.5" /> Deferral applies — proposed {Math.round(deferralPct * 100)}%
                <Cite s="9.3" />
              </div>
              <ul className="list-disc space-y-0.5 pl-4 text-sg-text">
                {deferral.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-2xs text-sg-dim">
              <CircleCheck className="size-3.5 text-soft-green" /> No deferral triggers<Cite s="9.3" />
            </p>
          )}
          {!proposer.ok && (
            <div className="rounded-lg border border-soft-red/40 bg-soft-red/10 p-2.5 text-2xs text-soft-red">
              <div className="mb-0.5 font-semibold">
                {proposerName} cannot propose a project
                <Cite s="3.1" />
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
          <Button variant="primary" size="md" className="w-full" disabled={!canSubmit} onClick={onSubmit} title={canSubmit ? "Submit to the Project Review Committee" : `Complete first:\n• ${[...(saved ? [] : ["Save the draft"]), ...gaps, ...proposer.blockers].join("\n• ")}`}>
            <Send /> Submit to PRC
          </Button>
          {!canSubmit && (gaps.length > 0 || !saved) && <p className="text-2xs text-sg-dim">{!saved ? "Save the draft and build the team first." : `${gaps.length} item${gaps.length === 1 ? "" : "s"} still missing — see the list above.`}</p>}
          <Button variant="outline" size="md" className="w-full" onClick={onSave}>
            Save draft <Kbd className="ml-1">⌘↵</Kbd>
          </Button>
          <p className="text-2xs leading-snug text-sg-dim">
            The PMO acknowledges within {POLICY.sla.acknowledgeBusinessDays} business day and checks completeness within {POLICY.sla.completenessBusinessDays}; {t.label} decides within {t.decisionBusinessDays} business days<Cite s="4.5" />. By submitting you confirm no commitment has been made to the client beyond this proposal and the figures are your honest expected case<Cite s="4.7" />.
          </p>
        </div>
      </div>
    </div>
  );
}
