"use client";

import Link from "next/link";
import { useMemo } from "react";
import { notFound } from "next/navigation";
import { CalendarDays, Globe, Mail, MapPin, Network, Phone, Sparkles, SquareCheck, StickyNote, Timer } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useStageMap, useUserMap } from "@/lib/selectors";
import { CAPABILITIES, LEAD_STATUSES, LIFECYCLE_STAGES, type CrmObjectType, type Deal, type Ticket } from "@/lib/types";
import { leadStatusMeta, lifecycleMeta, ticketPriorityMeta } from "@/lib/meta";
import { cn, daysFromNow, formatDate, formatIDR, formatNumber, relativeTime, softText, spectrumDot } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Avatar, Chip, RecordAvatar, ScoreRing } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { EditableProperty } from "./editable";
import { Timeline } from "./timeline";
import { AssociationsPane } from "./associations";

const crumbFor: Record<CrmObjectType, { href: string; label: string }> = {
  contact: { href: "/contacts", label: "Contacts" },
  company: { href: "/companies", label: "Companies" },
  deal: { href: "/deals", label: "Deals" },
  ticket: { href: "/deals", label: "Service" },
};

/**
 * HubSpot-style 3-pane record:
 *   left — identity, quick actions, editable "About" properties
 *   centre — unified activity timeline (notes, emails, calls, meetings, tasks, Jira updates)
 *   right — associations (CRM objects + linked Jira work)
 */
export function RecordView({ type, id }: { type: CrmObjectType; id: string }) {
  const exists = useCrm((s) =>
    type === "contact" ? s.contacts.some((x) => x.id === id) : type === "company" ? s.companies.some((x) => x.id === id) : type === "deal" ? s.deals.some((x) => x.id === id) : s.tickets.some((x) => x.id === id),
  );
  if (!exists) notFound();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={<RecordTitle type={type} id={id} />} crumbs={[crumbFor[type]]} />
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[320px_minmax(0,1fr)_340px] lg:overflow-hidden">
        <aside className="border-sg-line lg:overflow-y-auto lg:border-r">
          <LeftPane type={type} id={id} />
        </aside>
        <section className="flex min-h-[480px] flex-col lg:min-h-0">
          <Timeline type={type} id={id} />
        </section>
        <aside className="border-sg-line bg-sg-bg lg:overflow-y-auto lg:border-l">
          <AssociationsPane type={type} id={id} />
        </aside>
      </div>
    </div>
  );
}

function RecordTitle({ type, id }: { type: CrmObjectType; id: string }) {
  const label = useCrm((s) => {
    if (type === "contact") {
      const c = s.contacts.find((x) => x.id === id);
      return c ? `${c.firstName} ${c.lastName}` : "";
    }
    if (type === "company") return s.companies.find((x) => x.id === id)?.name ?? "";
    if (type === "deal") return s.deals.find((x) => x.id === id)?.name ?? "";
    return s.tickets.find((x) => x.id === id)?.subject ?? "";
  });
  return <>{label}</>;
}

function QuickActions({ type, id, email, phone }: { type: CrmObjectType; id: string; email?: string; phone?: string }) {
  const openDialog = useUi((s) => s.openDialog);
  const actions = [
    { key: "note", label: "Note", icon: StickyNote },
    { key: "email", label: "Email", icon: Mail },
    { key: "call", label: "Call", icon: Phone },
    { key: "task", label: "Task", icon: SquareCheck },
    { key: "meeting", label: "Meeting", icon: CalendarDays },
  ] as const;
  return (
    <div className="mt-4 grid grid-cols-5 gap-1">
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          onClick={() => openDialog({ kind: "logActivity", activityType: a.key, target: { type, id } })}
          className="flex flex-col items-center gap-1 rounded-md py-1.5 text-2xs font-semibold text-sg-muted hover:bg-sg-card-2 hover:text-sg-white"
          title={a.key === "email" && email ? `Log an email to ${email}` : a.key === "call" && phone ? `Log a call to ${phone}` : `Log ${a.label.toLowerCase()}`}
        >
          <span className="flex size-8 items-center justify-center rounded-full border border-sg-line-2">
            <a.icon className="size-3.5" />
          </span>
          {a.label}
        </button>
      ))}
    </div>
  );
}

function LeftPane({ type, id }: { type: CrmObjectType; id: string }) {
  if (type === "contact") return <ContactLeft id={id} />;
  if (type === "company") return <CompanyLeft id={id} />;
  if (type === "deal") return <DealLeft id={id} />;
  return <TicketLeft id={id} />;
}

/* ───────────── shared bits ───────────── */

function useOwnerOptions() {
  const users = useCrm((s) => s.users);
  return useMemo(() => users.map((u) => ({ value: u.id, label: u.name })), [users]);
}

function OwnerDisplay({ ownerId }: { ownerId: string }) {
  const userMap = useUserMap();
  const u = userMap.get(ownerId);
  return (
    <span className="flex items-center gap-2">
      <Avatar user={u} size="xs" /> {u?.name}
    </span>
  );
}

function AboutHeader({ children }: { children: React.ReactNode }) {
  return <div className="sg-eyebrow mb-1 mt-5 border-t border-sg-line pt-4">{children}</div>;
}

/* ───────────── contact ───────────── */

function ContactLeft({ id }: { id: string }) {
  const c = useCrm((s) => s.contacts.find((x) => x.id === id))!;
  const companies = useCrm((s) => s.companies);
  const update = useCrm((s) => s.updateContact);
  const owners = useOwnerOptions();
  const company = companies.find((x) => x.id === c.companyId);
  const stageIdx = LIFECYCLE_STAGES.indexOf(c.lifecycleStage);

  return (
    <div className="p-5">
      <div className="flex items-start gap-3">
        <RecordAvatar label={`${c.firstName} ${c.lastName}`} color={lifecycleMeta[c.lifecycleStage].color} size="xl" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-extrabold text-sg-white">
            {c.firstName} {c.lastName}
          </h2>
          <p className="text-sm text-sg-muted">{c.jobTitle}</p>
          {company && (
            <Link href={`/companies/${company.id}`} className="text-sm text-sg-text hover:text-sg-white hover:underline">
              {company.name}
            </Link>
          )}
        </div>
        <div className="text-center">
          <ScoreRing score={c.leadScore} />
          <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-sg-dim">Score</div>
        </div>
      </div>
      <div className="mt-3 space-y-1 text-xs text-sg-muted">
        <a href={`mailto:${c.email}`} className="flex items-center gap-2 hover:text-sg-white">
          <Mail className="size-3.5" /> {c.email}
        </a>
        <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-2 hover:text-sg-white">
          <Phone className="size-3.5" /> {c.phone}
        </a>
      </div>
      <QuickActions type="contact" id={id} email={c.email} phone={c.phone} />

      {/* lifecycle progress */}
      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-2xs text-sg-dim">
          <span>Lifecycle</span>
          <span className="font-semibold text-sg-white">{lifecycleMeta[c.lifecycleStage].label}</span>
        </div>
        <div className="flex gap-0.5">
          {LIFECYCLE_STAGES.map((s, i) => (
            <button
              key={s}
              type="button"
              title={`Set to ${lifecycleMeta[s].label}`}
              onClick={() => update(id, { lifecycleStage: s })}
              className={cn("h-1.5 flex-1 rounded-sm transition-opacity hover:opacity-100", i <= stageIdx ? spectrumDot[lifecycleMeta[s].color] : "bg-sg-card-3", i <= stageIdx ? "opacity-90" : "opacity-100")}
            />
          ))}
        </div>
      </div>

      <AboutHeader>About this contact</AboutHeader>
      <EditableProperty label="First name" display={c.firstName} editor={{ kind: "text", value: c.firstName }} onSave={(v) => update(id, { firstName: v })} />
      <EditableProperty label="Last name" display={c.lastName} editor={{ kind: "text", value: c.lastName }} onSave={(v) => update(id, { lastName: v })} />
      <EditableProperty label="Email" display={c.email} editor={{ kind: "email", value: c.email }} onSave={(v) => update(id, { email: v })} />
      <EditableProperty label="Phone" display={c.phone} editor={{ kind: "text", value: c.phone }} onSave={(v) => update(id, { phone: v })} />
      <EditableProperty label="Job title" display={c.jobTitle} editor={{ kind: "text", value: c.jobTitle }} onSave={(v) => update(id, { jobTitle: v })} />
      <EditableProperty
        label="Company"
        display={company?.name}
        editor={{ kind: "select", value: c.companyId ?? "", options: [{ value: "", label: "— none —" }, ...companies.map((x) => ({ value: x.id, label: x.name }))] }}
        onSave={(v) => update(id, { companyId: v || null })}
      />
      <EditableProperty
        label="Lifecycle stage"
        display={<Chip color={lifecycleMeta[c.lifecycleStage].color}>{lifecycleMeta[c.lifecycleStage].label}</Chip>}
        editor={{ kind: "select", value: c.lifecycleStage, options: LIFECYCLE_STAGES.map((s) => ({ value: s, label: lifecycleMeta[s].label })) }}
        onSave={(v) => update(id, { lifecycleStage: v as typeof c.lifecycleStage })}
      />
      <EditableProperty
        label="Lead status"
        display={leadStatusMeta[c.leadStatus]}
        editor={{ kind: "select", value: c.leadStatus, options: LEAD_STATUSES.map((s) => ({ value: s, label: leadStatusMeta[s] })) }}
        onSave={(v) => update(id, { leadStatus: v as typeof c.leadStatus })}
      />
      <EditableProperty label="Lead score" display={<span className={softText[c.leadScore >= 80 ? "green" : c.leadScore >= 60 ? "yellow" : c.leadScore >= 40 ? "orange" : "red"]}>{c.leadScore} / 100</span>} editor={{ kind: "number", value: c.leadScore }} onSave={(v) => update(id, { leadScore: Math.max(0, Math.min(100, Math.round(Number(v)))) })} />
      <EditableProperty label="Contact owner" display={<OwnerDisplay ownerId={c.ownerId} />} editor={{ kind: "select", value: c.ownerId, options: owners }} onSave={(v) => update(id, { ownerId: v })} />
      <EditableProperty label="City" display={c.city} editor={{ kind: "text", value: c.city }} onSave={(v) => update(id, { city: v })} />
      <EditableProperty label="Original source" display={c.source} readOnly />
      <EditableProperty label="Last contacted" display={c.lastContactedAt ? `${formatDate(c.lastContactedAt)} (${relativeTime(c.lastContactedAt)})` : "Never"} readOnly />
      <EditableProperty label="Create date" display={formatDate(c.createdAt)} readOnly />
    </div>
  );
}

/* ───────────── company ───────────── */

function CompanyLeft({ id }: { id: string }) {
  const c = useCrm((s) => s.companies.find((x) => x.id === id))!;
  const companies = useCrm((s) => s.companies);
  const update = useCrm((s) => s.updateCompany);
  const enrich = useCrm((s) => s.enrichCompany);
  const notify = useUi((s) => s.notify);
  const owners = useOwnerOptions();
  const parent = companies.find((x) => x.id === c.parentId);
  const children = companies.filter((x) => x.parentId === id);
  const tiers = ["Strategic", "Enterprise", "Mid-Market", "Emerging"] as const;

  return (
    <div className="p-5">
      <div className="flex items-start gap-3">
        <RecordAvatar label={c.name} size="xl" square color="blue" />
        <div className="min-w-0">
          <h2 className="font-display text-xl font-extrabold leading-tight text-sg-white">{c.name}</h2>
          <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="mt-0.5 flex items-center gap-1 text-sm text-sg-muted hover:text-sg-white">
            <Globe className="size-3.5" /> {c.domain}
          </a>
          <p className="flex items-center gap-1 text-xs text-sg-dim">
            <MapPin className="size-3" /> {c.city}, {c.country}
          </p>
        </div>
      </div>
      <QuickActions type="company" id={id} phone={c.phone} />

      {/* org hierarchy */}
      {(parent || children.length > 0) && (
        <div className="mt-4 rounded-lg border border-sg-line p-3">
          <div className="sg-eyebrow mb-2 flex items-center gap-1.5">
            <Network className="size-3" /> Org hierarchy
          </div>
          {parent && (
            <Link href={`/companies/${parent.id}`} className="block truncate text-sm text-sg-muted hover:text-sg-white">
              {parent.name}
            </Link>
          )}
          <div className={cn("truncate text-sm font-semibold text-sg-white", parent && "ml-3 border-l border-sg-line-2 pl-2")}>{c.name}</div>
          {children.map((ch) => (
            <Link key={ch.id} href={`/companies/${ch.id}`} className={cn("block truncate text-sm text-sg-muted hover:text-sg-white", parent ? "ml-6" : "ml-3", "border-l border-sg-line-2 pl-2")}>
              {ch.name}
            </Link>
          ))}
        </div>
      )}

      {/* enrichment */}
      <div className="mt-4 rounded-lg border border-sg-line p-3">
        <div className="flex items-center justify-between">
          <span className="sg-eyebrow flex items-center gap-1.5">
            <Sparkles className="size-3" /> Domain enrichment
          </span>
          <Button
            size="xs"
            variant={c.enriched ? "ghost" : "outline"}
            onClick={() => {
              enrich(id);
              notify(`Refreshed from ${c.domain}`);
            }}
          >
            {c.enriched ? "Refresh" : "Enrich now"}
          </Button>
        </div>
        {c.enriched ? (
          <div className="mt-2 space-y-1 text-xs text-sg-muted">
            {c.linkedin && <div>LinkedIn · linkedin.com/company/{c.linkedin}</div>}
            {c.techStack?.length ? (
              <div className="flex flex-wrap gap-1 pt-1">
                {c.techStack.map((t) => (
                  <span key={t} className="rounded-sm bg-sg-card-3 px-1.5 py-0.5 text-2xs text-sg-text">
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-1 text-2xs text-sg-dim">Pull firmographics and tech stack from the company domain.</p>
        )}
      </div>

      <AboutHeader>About this company</AboutHeader>
      <EditableProperty label="Name" display={c.name} editor={{ kind: "text", value: c.name }} onSave={(v) => update(id, { name: v })} />
      <EditableProperty label="Domain" display={c.domain} editor={{ kind: "text", value: c.domain }} onSave={(v) => update(id, { domain: v.toLowerCase() })} />
      <EditableProperty label="Industry" display={c.industry} editor={{ kind: "text", value: c.industry }} onSave={(v) => update(id, { industry: v })} />
      <EditableProperty label="Tier" display={c.tier} editor={{ kind: "select", value: c.tier, options: tiers.map((t) => ({ value: t, label: t })) }} onSave={(v) => update(id, { tier: v as (typeof tiers)[number] })} />
      <EditableProperty
        label="Lifecycle stage"
        display={<Chip color={lifecycleMeta[c.lifecycleStage].color}>{lifecycleMeta[c.lifecycleStage].label}</Chip>}
        editor={{ kind: "select", value: c.lifecycleStage, options: LIFECYCLE_STAGES.map((s) => ({ value: s, label: lifecycleMeta[s].label })) }}
        onSave={(v) => update(id, { lifecycleStage: v as typeof c.lifecycleStage })}
      />
      <EditableProperty
        label="Parent company"
        display={parent?.name}
        editor={{ kind: "select", value: c.parentId ?? "", options: [{ value: "", label: "— none —" }, ...companies.filter((x) => x.id !== id && x.parentId !== id).map((x) => ({ value: x.id, label: x.name }))] }}
        onSave={(v) => update(id, { parentId: v || null })}
      />
      <EditableProperty label="Employees" display={formatNumber(c.employees)} editor={{ kind: "number", value: c.employees }} onSave={(v) => update(id, { employees: Number(v) })} />
      <EditableProperty label="Annual revenue" display={formatIDR(c.annualRevenue, "full")} editor={{ kind: "number", value: c.annualRevenue }} onSave={(v) => update(id, { annualRevenue: Number(v) })} />
      <EditableProperty label="Phone" display={c.phone} editor={{ kind: "text", value: c.phone }} onSave={(v) => update(id, { phone: v })} />
      <EditableProperty label="City" display={c.city} editor={{ kind: "text", value: c.city }} onSave={(v) => update(id, { city: v })} />
      <EditableProperty label="Description" display={c.description} editor={{ kind: "textarea", value: c.description }} onSave={(v) => update(id, { description: v })} />
      <EditableProperty label="Company owner" display={<OwnerDisplay ownerId={c.ownerId} />} editor={{ kind: "select", value: c.ownerId, options: owners }} onSave={(v) => update(id, { ownerId: v })} />
      <EditableProperty label="Create date" display={formatDate(c.createdAt)} readOnly />
    </div>
  );
}

/* ───────────── deal ───────────── */

function DealLeft({ id }: { id: string }) {
  const d = useCrm((s) => s.deals.find((x) => x.id === id))!;
  const pipelines = useCrm((s) => s.pipelines);
  const update = useCrm((s) => s.updateDeal);
  const companies = useCrm((s) => s.companies);
  const owners = useOwnerOptions();
  const stageMap = useStageMap();
  const pipeline = pipelines.find((p) => p.id === d.pipelineId);
  const stage = stageMap.get(d.stageId);
  const company = companies.find((c) => c.id === d.companyId);
  const days = daysFromNow(d.closeDate);
  const openStages = pipeline?.stages.filter((s) => !s.closed) ?? [];
  const stageIdx = openStages.findIndex((s) => s.id === d.stageId);

  return (
    <div className="p-5">
      <div className="flex items-start gap-3">
        <span className={cn("mt-1 size-3 shrink-0 rounded-sm", stage ? spectrumDot[stage.color] : "bg-sg-dim")} />
        <div className="min-w-0">
          <h2 className="font-display text-xl font-extrabold leading-tight text-sg-white">{d.name}</h2>
          {company && (
            <Link href={`/companies/${company.id}`} className="text-sm text-sg-muted hover:text-sg-white hover:underline">
              {company.name}
            </Link>
          )}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-sg-line p-3">
        <div>
          <div className="sg-eyebrow">Amount</div>
          <div className="sg-num font-display text-xl font-extrabold text-sg-white">{formatIDR(d.amount)}</div>
        </div>
        <div>
          <div className="sg-eyebrow">Weighted</div>
          <div className="sg-num font-display text-xl font-extrabold text-sg-muted">{formatIDR(d.amount * (stage?.probability ?? 0))}</div>
        </div>
        <div className="col-span-2 flex items-center gap-1.5 text-xs">
          <Timer className="size-3.5 text-sg-dim" />
          {stage?.closed ? (
            <span className={stage.closed === "won" ? "text-soft-green" : "text-soft-red"}>Closed {stage.closed} · {formatDate(d.closeDate)}</span>
          ) : (
            <span className={days < 0 ? "font-semibold text-soft-orange" : "text-sg-muted"}>
              Close {formatDate(d.closeDate)} · {days < 0 ? `${-days} days overdue` : `${days} days left`}
            </span>
          )}
        </div>
      </div>
      <QuickActions type="deal" id={id} />

      {/* stage path — click to move */}
      {pipeline && (
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-2xs text-sg-dim">
            <span>{pipeline.name}</span>
            <span className="font-semibold text-sg-white">{stage?.name}</span>
          </div>
          <div className="flex gap-0.5">
            {openStages.map((s, i) => (
              <button
                key={s.id}
                type="button"
                title={`Move to ${s.name}`}
                onClick={() => update(id, { stageId: s.id })}
                className={cn("h-1.5 flex-1 rounded-sm", stage?.closed === "won" || (stageIdx >= 0 && i <= stageIdx) ? spectrumDot[s.color] : "bg-sg-card-3 hover:bg-sg-dim")}
              />
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            {pipeline.stages
              .filter((s) => s.closed)
              .map((s) => (
                <Button key={s.id} size="xs" variant={s.closed === "won" ? "outline" : "danger"} onClick={() => update(id, { stageId: s.id })} disabled={d.stageId === s.id}>
                  Mark {s.name.toLowerCase()}
                </Button>
              ))}
          </div>
        </div>
      )}

      <AboutHeader>About this deal</AboutHeader>
      <EditableProperty label="Deal name" display={d.name} editor={{ kind: "text", value: d.name }} onSave={(v) => update(id, { name: v })} />
      <EditableProperty label="Amount" display={formatIDR(d.amount, "full")} editor={{ kind: "number", value: d.amount }} onSave={(v) => update(id, { amount: Number(v) })} />
      <EditableProperty
        label="Deal stage"
        display={stage ? <Chip color={stage.color} dot>{stage.name} · {Math.round(stage.probability * 100)}%</Chip> : null}
        editor={{ kind: "select", value: d.stageId, options: (pipeline?.stages ?? []).map((s) => ({ value: s.id, label: `${s.name} (${Math.round(s.probability * 100)}%)` })) }}
        onSave={(v) => update(id, { stageId: v })}
      />
      <EditableProperty label="Close date" display={formatDate(d.closeDate)} editor={{ kind: "date", value: d.closeDate }} onSave={(v) => update(id, { closeDate: v })} />
      <EditableProperty
        label="Pipeline"
        display={pipeline?.name}
        editor={{ kind: "select", value: d.pipelineId, options: pipelines.filter((p) => p.objectType === "deal").map((p) => ({ value: p.id, label: p.name })) }}
        onSave={(v) => {
          const p = pipelines.find((x) => x.id === v);
          if (p) update(id, { pipelineId: p.id, stageId: p.stages[0].id } as Partial<Deal>);
        }}
      />
      <EditableProperty label="Priority" display={<span className="capitalize">{d.priority}</span>} editor={{ kind: "select", value: d.priority, options: ["high", "medium", "low"].map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) })) }} onSave={(v) => update(id, { priority: v as Deal["priority"] })} />
      <EditableProperty label="Deal type" display={d.dealType} editor={{ kind: "select", value: d.dealType, options: ["New Business", "Expansion", "Renewal"].map((t) => ({ value: t, label: t })) }} onSave={(v) => update(id, { dealType: v as Deal["dealType"] })} />
      <EditableProperty label="Capability" display={d.capability} editor={{ kind: "select", value: d.capability, options: CAPABILITIES.map((c) => ({ value: c, label: c })) }} onSave={(v) => update(id, { capability: v as Deal["capability"] })} />
      <EditableProperty label="Deal owner" display={<OwnerDisplay ownerId={d.ownerId} />} editor={{ kind: "select", value: d.ownerId, options: owners }} onSave={(v) => update(id, { ownerId: v })} />
      <EditableProperty label="Description" display={d.description} editor={{ kind: "textarea", value: d.description }} onSave={(v) => update(id, { description: v })} />
      <EditableProperty label="In stage since" display={`${formatDate(d.stageEnteredAt)} (${relativeTime(d.stageEnteredAt)})`} readOnly />
      <EditableProperty label="Create date" display={formatDate(d.createdAt)} readOnly />
    </div>
  );
}

/* ───────────── ticket ───────────── */

function TicketLeft({ id }: { id: string }) {
  const t = useCrm((s) => s.tickets.find((x) => x.id === id))!;
  const pipelines = useCrm((s) => s.pipelines);
  const update = useCrm((s) => s.updateTicket);
  const owners = useOwnerOptions();
  const stageMap = useStageMap();
  const stage = stageMap.get(t.stageId);
  const pipeline = pipelines.find((p) => p.id === t.pipelineId);
  const hoursLeft = Math.round((Date.parse(t.slaDueAt) - Date.now()) / 3_600_000);
  const breached = !t.closedAt && hoursLeft < 0;
  const categories: Ticket["category"][] = ["Hardware Fault", "Software Defect", "Field Support", "Documentation", "Training"];

  return (
    <div className="p-5">
      <div className="text-2xs font-semibold uppercase tracking-wider text-sg-dim">{t.id.toUpperCase()}</div>
      <h2 className="mt-1 font-display text-xl font-extrabold leading-tight text-sg-white">{t.subject}</h2>
      <div className={cn("mt-4 rounded-lg border p-3", breached ? "border-soft-red/50 bg-soft-red/10" : "border-sg-line")}>
        <div className="sg-eyebrow">SLA</div>
        <div className={cn("sg-num font-display text-xl font-extrabold", t.closedAt ? "text-soft-green" : breached ? "text-soft-red" : hoursLeft < 12 ? "text-soft-orange" : "text-sg-white")}>
          {t.closedAt ? "Met" : breached ? `Breached ${-hoursLeft}h ago` : `${hoursLeft}h remaining`}
        </div>
        <div className="text-2xs text-sg-dim">Due {formatDate(t.slaDueAt, "datetime")}</div>
      </div>
      <QuickActions type="ticket" id={id} />
      <AboutHeader>About this ticket</AboutHeader>
      <EditableProperty label="Subject" display={t.subject} editor={{ kind: "text", value: t.subject }} onSave={(v) => update(id, { subject: v })} />
      <EditableProperty
        label="Status"
        display={stage ? <Chip color={stage.color} dot>{stage.name}</Chip> : null}
        editor={{ kind: "select", value: t.stageId, options: (pipeline?.stages ?? []).map((s) => ({ value: s.id, label: s.name })) }}
        onSave={(v) => update(id, { stageId: v, closedAt: stageMap.get(v)?.closed ? new Date().toISOString() : null })}
      />
      <EditableProperty
        label="Priority"
        display={<span className={softText[ticketPriorityMeta[t.priority].color]}>{ticketPriorityMeta[t.priority].label}</span>}
        editor={{ kind: "select", value: t.priority, options: (["urgent", "high", "medium", "low"] as const).map((p) => ({ value: p, label: ticketPriorityMeta[p].label })) }}
        onSave={(v) => update(id, { priority: v as Ticket["priority"] })}
      />
      <EditableProperty label="Category" display={t.category} editor={{ kind: "select", value: t.category, options: categories.map((c) => ({ value: c, label: c })) }} onSave={(v) => update(id, { category: v as Ticket["category"] })} />
      <EditableProperty label="SLA due" display={formatDate(t.slaDueAt, "datetime")} editor={{ kind: "date", value: t.slaDueAt }} onSave={(v) => update(id, { slaDueAt: v })} />
      <EditableProperty label="Ticket owner" display={<OwnerDisplay ownerId={t.ownerId} />} editor={{ kind: "select", value: t.ownerId, options: owners }} onSave={(v) => update(id, { ownerId: v })} />
      <EditableProperty label="Description" display={t.description} editor={{ kind: "textarea", value: t.description }} onSave={(v) => update(id, { description: v })} />
      <EditableProperty label="Create date" display={formatDate(t.createdAt, "datetime")} readOnly />
    </div>
  );
}
