"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { notFound, useRouter } from "next/navigation";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Globe, Mail, MapPin, Network, Phone, Sparkles, SquareCheck, StickyNote, Timer, Trash2, TriangleAlert } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { slaDueFor, ticketSla, useRecordSequence, useStageMap, useUserMap } from "@/lib/selectors";
import { previewDelete } from "@/lib/slices/crm-extras";
import { CAPABILITIES, LEAD_STATUSES, LIFECYCLE_STAGES, type CrmObjectType, type Deal, type Ticket } from "@/lib/types";
import { leadStatusMeta, lifecycleMeta, ticketPriorityMeta } from "@/lib/meta";
import { cn, daysFromNow, formatDate, formatIDR, formatNumber, relativeTime, softText, spectrumDot } from "@/lib/utils";
import type { CompanyEntityType, ForecastCategory } from "@/lib/types";
import { applyDealChange, requestDealStage } from "@/components/crm/deal-close";
import { DealOutcome, OriginationCard } from "@/components/crm/deal-panels";
import { FORECAST_META, FORECAST_ORDER, forecastOf, idleDays, isRotting, rottingThreshold, dealActivityIndex } from "@/components/crm/deal-signals";
import { formatNpwp, npwpValid } from "@/components/crm/quote-math";
import { PageHeader } from "@/components/shell/page-header";
import { Avatar, Chip, RecordAvatar, ScoreRing } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Modal } from "@/components/ui/overlays";
import { EditableProperty } from "./editable";
import { Timeline } from "./timeline";
import { AssociationsPane } from "./associations";

const crumbFor: Record<CrmObjectType, { href: string; label: string }> = {
  contact: { href: "/contacts", label: "Contacts" },
  company: { href: "/companies", label: "Companies" },
  deal: { href: "/deals", label: "Deals" },
  ticket: { href: "/tickets", label: "Tickets" },
};

const hrefFor: Record<CrmObjectType, string> = { contact: "/contacts", company: "/companies", deal: "/deals", ticket: "/tickets" };
const singular: Record<CrmObjectType, string> = { contact: "contact", company: "company", deal: "deal", ticket: "ticket" };
const plural: Record<CrmObjectType, string> = { contact: "contacts", company: "companies", deal: "deals", ticket: "tickets" };

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
  /** set while this record is being deleted from its own page, so we leave instead of rendering a 404 */
  const [leaving, setLeaving] = useState(false);
  if (!exists) {
    if (leaving) return null;
    notFound();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={<RecordTitle type={type} id={id} />} crumbs={[crumbFor[type]]}>
        <RecordNav type={type} id={id} />
        <RecordActions type={type} id={id} onLeave={() => setLeaving(true)} />
      </PageHeader>
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

/* ───────────── previous / next (Alt+← / Alt+→) ───────────── */

function RecordNav({ type, id }: { type: CrmObjectType; id: string }) {
  const router = useRouter();
  const seq = useRecordSequence(type);
  const idx = seq.indexOf(id);
  const prev = idx > 0 ? seq[idx - 1] : null;
  const next = idx >= 0 && idx < seq.length - 1 ? seq[idx + 1] : null;
  const base = hrefFor[type];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const ui = useUi.getState();
      if (ui.dialog || ui.paletteOpen || ui.issueId || document.querySelector("[role=dialog]")) return;
      // Alt+← / Alt+→ is browser history on Windows/Linux — take it over on record pages
      e.preventDefault();
      const to = e.key === "ArrowLeft" ? prev : next;
      if (to) router.push(`${base}/${encodeURIComponent(to)}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, base, router]);

  if (idx < 0) return null;
  const btn = "flex size-7 items-center justify-center rounded border border-sg-line text-sg-muted hover:border-sg-line-2 hover:text-sg-white disabled:pointer-events-none disabled:opacity-30";
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className={btn} disabled={!prev} onClick={() => prev && router.push(`${base}/${encodeURIComponent(prev)}`)} aria-label={`Previous ${singular[type]}`} title={`Previous ${singular[type]} (Alt+←)`}>
        <ChevronLeft className="size-4" />
      </button>
      <span className="sg-num min-w-[64px] text-center text-xs text-sg-muted" title={`Ordered like the ${plural[type]} list`}>
        <span className="font-semibold text-sg-white">{idx + 1}</span> of {seq.length}
      </span>
      <button type="button" className={btn} disabled={!next} onClick={() => next && router.push(`${base}/${encodeURIComponent(next)}`)} aria-label={`Next ${singular[type]}`} title={`Next ${singular[type]} (Alt+→)`}>
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

/* ───────────── header actions: delete with undo ───────────── */

function RecordActions({ type, id, onLeave }: { type: CrmObjectType; id: string; onLeave: () => void }) {
  const router = useRouter();
  const notify = useUi((s) => s.notify);
  const deleteContact = useCrm((s) => s.deleteContact);
  const deleteDeal = useCrm((s) => s.deleteDeal);
  const deleteCompany = useCrm((s) => s.deleteCompany);
  const deleteTicket = useCrm((s) => s.deleteTicket);
  const restoreSnapshot = useCrm((s) => s.restoreSnapshot);
  const [confirming, setConfirming] = useState(false);
  const [impact, setImpact] = useState<string[]>([]);
  const label = useCrm((s) => {
    if (type === "contact") {
      const c = s.contacts.find((x) => x.id === id);
      return c ? `${c.firstName} ${c.lastName}`.trim() : "";
    }
    if (type === "company") return s.companies.find((x) => x.id === id)?.name ?? "";
    if (type === "ticket") {
      const t = s.tickets.find((x) => x.id === id);
      return t ? `${t.id.toUpperCase()} · ${t.subject}` : "";
    }
    return s.deals.find((x) => x.id === id)?.name ?? "";
  });
  const Kind = { contact: "Contact", company: "Company", deal: "Deal", ticket: "Ticket" }[type];

  const open = () => {
    setImpact(previewDelete(useCrm.getState(), type, id));
    setConfirming(true);
  };

  const confirm = () => {
    setConfirming(false);
    onLeave();
    const snap = type === "contact" ? deleteContact(id) : type === "deal" ? deleteDeal(id) : type === "company" ? deleteCompany(id) : deleteTicket(id);
    router.push(hrefFor[type]);
    if (!snap) return;
    notify(`${Kind} “${snap.label}” deleted`, {
      label: "Undo",
      run: () => {
        restoreSnapshot(snap);
        notify(`${snap.label} restored`);
        router.push(`${hrefFor[type]}/${encodeURIComponent(snap.id)}`);
      },
    });
  };

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="outline" size="sm">
            Actions <ChevronDown />
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuLabel>{Kind}</MenuLabel>
          <MenuItem destructive onSelect={open}>
            <Trash2 className="size-3.5" /> Delete {singular[type]}
          </MenuItem>
        </MenuContent>
      </Menu>
      <Modal
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${singular[type]}?`}
        description={label}
        footer={
          <>
            <span className="mr-auto hidden items-center gap-1 text-2xs text-sg-dim sm:flex">
              You can undo from the toast for a few seconds
            </span>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirm} autoFocus>
              <Trash2 /> Delete {singular[type]}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="flex items-start gap-2 text-sg-text">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-soft-orange" />
            <span>
              <span className="font-semibold text-sg-white">{label}</span> will be removed from the CRM{type === "deal" ? " together with its line items and quotes" : type === "company" ? "; its contacts, deals and tickets are kept" : ""}.
            </span>
          </p>
          {impact.length ? (
            <ul className="space-y-1 rounded-lg border border-sg-line bg-sg-bg/50 px-3 py-2 text-xs text-sg-muted">
              {impact.map((x) => (
                <li key={x}>· {x}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-sg-dim">No other records reference this {singular[type]}.</p>
          )}
        </div>
      </Modal>
    </>
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
              aria-label={`Set lifecycle stage to ${lifecycleMeta[s].label}`}
              aria-pressed={i <= stageIdx}
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
      <EditableProperty label="Lead score" display={<span className={softText[c.leadScore >= 80 ? "green" : c.leadScore >= 60 ? "yellow" : c.leadScore >= 40 ? "orange" : "red"]}>{c.leadScore} / 100</span>} editor={{ kind: "number", value: c.leadScore, min: 0, max: 100 }} onSave={(v) => update(id, { leadScore: Math.max(0, Math.min(100, Math.round(Number(v)))) })} />
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
      <EditableProperty label="Employees" display={formatNumber(c.employees)} editor={{ kind: "number", value: c.employees, min: 0 }} onSave={(v) => update(id, { employees: Number(v) })} />
      <EditableProperty label="Annual revenue" display={formatIDR(c.annualRevenue, "full")} editor={{ kind: "money", value: c.annualRevenue, allowZero: true }} onSave={(v) => update(id, { annualRevenue: Number(v) })} />
      <EditableProperty label="Phone" display={c.phone} editor={{ kind: "text", value: c.phone }} onSave={(v) => update(id, { phone: v })} />
      <EditableProperty label="City" display={c.city} editor={{ kind: "text", value: c.city }} onSave={(v) => update(id, { city: v })} />
      <EditableProperty label="Description" display={c.description} editor={{ kind: "textarea", value: c.description }} onSave={(v) => update(id, { description: v })} />
      <EditableProperty label="Company owner" display={<OwnerDisplay ownerId={c.ownerId} />} editor={{ kind: "select", value: c.ownerId, options: owners }} onSave={(v) => update(id, { ownerId: v })} />
      <EditableProperty label="Create date" display={formatDate(c.createdAt)} readOnly />

      <AboutHeader>Tax & billing identity</AboutHeader>
      <EditableProperty label="Legal name" display={c.legalName || <span className="text-sg-dim">Not set — quotes use “{c.name}”</span>} editor={{ kind: "text", value: c.legalName ?? "" }} onSave={(v) => update(id, { legalName: v.trim() || undefined })} />
      <NpwpProperty value={c.npwp ?? ""} onSave={(v) => update(id, { npwp: v || undefined })} />
      <EditableProperty
        label="Entity type"
        display={ENTITY_LABEL[c.entityType ?? "swasta"] + (c.entityType ? "" : " (default)")}
        hint={c.entityType === "pemerintah" ? "Government VAT collector — suggested faktur code 02" : c.entityType === "bumn" ? "BUMN VAT collector — suggested faktur code 03" : "Suggested faktur code 04 (DPP nilai lain)"}
        editor={{ kind: "select", value: c.entityType ?? "swasta", options: (Object.keys(ENTITY_LABEL) as CompanyEntityType[]).map((k) => ({ value: k, label: ENTITY_LABEL[k] })) }}
        onSave={(v) => update(id, { entityType: v as CompanyEntityType })}
      />
      <EditableProperty label="Customer is PKP" display={c.pkp === undefined ? "Unknown" : c.pkp ? "Yes — VAT registered" : "No"} editor={{ kind: "select", value: c.pkp === undefined ? "" : c.pkp ? "yes" : "no", options: [{ value: "", label: "Unknown" }, { value: "yes", label: "Yes — VAT registered" }, { value: "no", label: "No" }] }} onSave={(v) => update(id, { pkp: v === "" ? undefined : v === "yes" })} />
      <EditableProperty label="Billing / tax address" display={c.billingAddress} editor={{ kind: "textarea", value: c.billingAddress ?? "" }} onSave={(v) => update(id, { billingAddress: v.trim() || undefined })} />
    </div>
  );
}

const ENTITY_LABEL: Record<CompanyEntityType, string> = { swasta: "Private (swasta)", bumn: "State-owned (BUMN / BUMD)", pemerintah: "Government (instansi pemerintah)", asing: "Foreign entity" };

function NpwpProperty({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const notify = useUi((s) => s.notify);
  return (
    <EditableProperty
      label="NPWP"
      display={value ? <span className={npwpValid(value) ? "sg-num" : "sg-num text-soft-orange"}>{formatNpwp(value)}{npwpValid(value) ? "" : " · check digits"}</span> : <span className="text-sg-dim">Not set — needed on quotes and faktur</span>}
      editor={{ kind: "text", value }}
      onSave={(v) => {
        const digits = v.replace(/\D/g, "");
        if (digits && !npwpValid(digits)) {
          notify("NPWP must have 15 digits (old format) or 16 digits (NIK-based) — not saved");
          return;
        }
        onSave(digits);
      }}
    />
  );
}

/* ───────────── deal ───────────── */

function DealLeft({ id }: { id: string }) {
  const d = useCrm((s) => s.deals.find((x) => x.id === id))!;
  const pipelines = useCrm((s) => s.pipelines);
  const companies = useCrm((s) => s.companies);
  const activities = useCrm((s) => s.activities);
  const owners = useOwnerOptions();
  const stageMap = useStageMap();
  const pipeline = pipelines.find((p) => p.id === d.pipelineId);
  const stage = stageMap.get(d.stageId);
  const company = companies.find((c) => c.id === d.companyId);
  const days = daysFromNow(d.closeDate);
  const openStages = pipeline?.stages.filter((s) => !s.closed) ?? [];
  const stageIdx = openStages.findIndex((s) => s.id === d.stageId);
  const sig = useMemo(() => dealActivityIndex(activities.filter((a) => a.links.dealIds.includes(id))).get(id), [activities, id]);
  const rotting = isRotting(d, stage, sig);
  const idle = idleDays(d, sig);
  const fc = forecastOf(d, stage);
  const update = (patch: Partial<Deal>, message?: string) => applyDealChange(id, patch, message);

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
            <span className={stage.closed === "won" ? "text-soft-green" : "text-soft-red"}>
              Closed {stage.closed} · {formatDate(d.closeDate)}
            </span>
          ) : (
            <span className={days < 0 ? "font-semibold text-soft-orange" : "text-sg-muted"}>
              Close {formatDate(d.closeDate)} · {days < 0 ? `${-days} ${-days === 1 ? "day" : "days"} overdue` : days === 0 ? "today" : `${days} ${days === 1 ? "day" : "days"} left`}
            </span>
          )}
        </div>
        {!stage?.closed && (
          <div className={cn("col-span-2 text-2xs", rotting ? "font-semibold text-soft-red" : "text-sg-dim")}>
            {rotting ? `Rotting — no activity for ${idle} days (limit in ${stage?.name}: ${rottingThreshold(stage)} days)` : `Last touch ${idle === 0 ? "today" : `${idle} ${idle === 1 ? "day" : "days"} ago`} · rots after ${rottingThreshold(stage)} days idle`}
          </div>
        )}
      </div>
      <DealOutcome deal={d} closed={stage?.closed} />
      <QuickActions type="deal" id={id} />

      {/* stage path — click to move */}
      {pipeline && (
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-2xs text-sg-dim">
            <span>{pipeline.name}</span>
            <span className="font-semibold text-sg-white">{stage?.name}</span>
          </div>
          <div className="flex gap-0.5" role="group" aria-label="Deal stage">
            {openStages.map((s, i) => (
              <button
                key={s.id}
                type="button"
                title={`Move to ${s.name}`}
                aria-label={`Move to ${s.name}`}
                aria-current={s.id === d.stageId ? "step" : undefined}
                onClick={() => requestDealStage(id, s.id)}
                className={cn("h-1.5 flex-1 rounded-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-sg-white", stage?.closed === "won" || (stageIdx >= 0 && i <= stageIdx) ? spectrumDot[s.color] : "bg-sg-card-3 hover:bg-sg-dim")}
              />
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            {pipeline.stages
              .filter((s) => s.closed)
              .map((s) => (
                <Button key={s.id} size="xs" variant={s.closed === "won" ? "outline" : "danger"} onClick={() => requestDealStage(id, s.id)} disabled={d.stageId === s.id}>
                  Mark {s.name.toLowerCase()}
                </Button>
              ))}
          </div>
        </div>
      )}

      <OriginationCard deal={d} />

      <AboutHeader>About this deal</AboutHeader>
      <EditableProperty label="Deal name" display={d.name} editor={{ kind: "text", value: d.name, required: true }} onSave={(v) => update({ name: v.trim() })} />
      <EditableProperty label="Amount" display={formatIDR(d.amount, "full")} editor={{ kind: "money", value: d.amount, allowZero: true }} onSave={(v) => update({ amount: Number(v) }, `Amount → ${formatIDR(Number(v), "full")}`)} />
      <EditableProperty
        label="Deal stage"
        display={stage ? <Chip color={stage.color} dot>{stage.name} · {Math.round(stage.probability * 100)}%</Chip> : null}
        editor={{ kind: "select", value: d.stageId, options: (pipeline?.stages ?? []).map((s) => ({ value: s.id, label: `${s.name} (${Math.round(s.probability * 100)}%)` })) }}
        onSave={(v) => requestDealStage(id, v)}
      />
      <EditableProperty label={stage?.closed ? "Close date" : "Expected close date"} display={formatDate(d.closeDate)} editor={{ kind: "date", value: d.closeDate }} onSave={(v) => update({ closeDate: v }, `Close date → ${formatDate(v)}`)} />
      <EditableProperty
        label="Forecast category"
        display={
          <span className="flex items-center gap-1.5">
            <Chip color={FORECAST_META[fc].color}>{FORECAST_META[fc].label}</Chip>
            {!d.forecastCategory && <span className="text-2xs text-sg-dim">from stage probability</span>}
          </span>
        }
        readOnly={!!stage?.closed}
        editor={{ kind: "select", value: fc, options: FORECAST_ORDER.map((c) => ({ value: c, label: `${FORECAST_META[c].label} — ${FORECAST_META[c].hint}` })) }}
        onSave={(v) => update({ forecastCategory: v as ForecastCategory }, `Forecast → ${FORECAST_META[v as ForecastCategory].label}`)}
      />
      <EditableProperty
        label="Pipeline"
        display={pipeline?.name}
        editor={{ kind: "select", value: d.pipelineId, options: pipelines.filter((p) => p.objectType === "deal").map((p) => ({ value: p.id, label: p.name })) }}
        onSave={(v) => {
          const p = pipelines.find((x) => x.id === v);
          if (p) update({ pipelineId: p.id, stageId: p.stages[0].id }, `Moved to the ${p.name} pipeline`);
        }}
      />
      <EditableProperty label="Priority" display={<span className="capitalize">{d.priority}</span>} editor={{ kind: "select", value: d.priority, options: ["high", "medium", "low"].map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) })) }} onSave={(v) => update({ priority: v as Deal["priority"] })} />
      <EditableProperty label="Deal type" display={d.dealType} editor={{ kind: "select", value: d.dealType, options: ["New Business", "Expansion", "Renewal"].map((t) => ({ value: t, label: t })) }} onSave={(v) => update({ dealType: v as Deal["dealType"] })} />
      <EditableProperty label="Capability" display={d.capability} editor={{ kind: "select", value: d.capability, options: CAPABILITIES.map((c) => ({ value: c, label: c })) }} onSave={(v) => update({ capability: v as Deal["capability"] })} />
      <EditableProperty label="Deal owner" display={<OwnerDisplay ownerId={d.ownerId} />} editor={{ kind: "select", value: d.ownerId, options: owners }} onSave={(v) => update({ ownerId: v })} />
      <EditableProperty label="Description" display={d.description} editor={{ kind: "textarea", value: d.description }} onSave={(v) => update({ description: v })} />
      {stage?.closed === "won" && <EditableProperty label="PO / contract number" display={d.poNumber} editor={{ kind: "text", value: d.poNumber ?? "" }} onSave={(v) => update({ poNumber: v.trim() || undefined })} />}
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
  const moveServiceTicket = useCrm((s) => s.moveServiceTicket);
  const undoTicketMove = useCrm((s) => s.undoTicketMove);
  const notify = useUi((s) => s.notify);
  const owners = useOwnerOptions();
  const stageMap = useStageMap();
  const stage = stageMap.get(t.stageId);
  const pipeline = pipelines.find((p) => p.id === t.pipelineId);
  const categories: Ticket["category"][] = ["Hardware Fault", "Software Defect", "Field Support", "Documentation", "Training"];
  // tick every 30 s so "2h left" / "Breached" stays current while the record is open
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(iv);
  }, []);
  const sla = ticketSla(t, now);
  const tone = sla.state === "met" ? "green" : sla.state === "late" || sla.state === "breached" ? "red" : sla.state === "due_soon" ? "orange" : sla.state === "paused" ? "yellow" : "white";

  const changePriority = (p: Ticket["priority"]) => {
    if (p === t.priority) return;
    update(id, { priority: p });
    if (t.closedAt) {
      notify(`Priority → ${ticketPriorityMeta[p].label}`);
      return;
    }
    const next = slaDueFor(p, Date.parse(t.createdAt));
    notify(`Priority → ${ticketPriorityMeta[p].label}. Reset the SLA to ${formatDate(next.dueAt, "datetime")} WIB?`, {
      label: "Apply",
      run: () => {
        update(id, { slaDueAt: next.dueAt, slaBasis: next.basis });
        notify(`SLA due ${formatDate(next.dueAt, "datetime")} WIB (${ticketPriorityMeta[p].label}, from ticket open)`, { label: "Undo", run: () => update(id, { slaDueAt: t.slaDueAt, slaBasis: t.slaBasis }) });
      },
    });
  };

  return (
    <div className="p-5">
      <div className="text-2xs font-semibold uppercase tracking-wider text-sg-dim">{t.id.toUpperCase()}</div>
      <h2 className="mt-1 font-display text-xl font-extrabold leading-tight text-sg-white">{t.subject}</h2>
      <div className={cn("mt-4 rounded-lg border p-3", tone === "red" ? "border-soft-red/50 bg-soft-red/10" : tone === "yellow" ? "border-soft-yellow/40 bg-soft-yellow/10" : "border-sg-line")} role="status" aria-live="polite">
        <div className="sg-eyebrow">SLA</div>
        <div className={cn("sg-num font-display text-xl font-extrabold", tone === "green" ? "text-soft-green" : tone === "red" ? "text-soft-red" : tone === "orange" ? "text-soft-orange" : tone === "yellow" ? "text-soft-yellow" : "text-sg-white")}>{sla.label}</div>
        <div className="text-2xs text-sg-dim">
          Due {formatDate(t.slaDueAt, "datetime")} WIB{t.closedAt ? ` · closed ${formatDate(t.closedAt, "datetime")} WIB` : ""}
        </div>
      </div>
      <QuickActions type="ticket" id={id} />
      <AboutHeader>About this ticket</AboutHeader>
      <EditableProperty label="Subject" display={t.subject} editor={{ kind: "text", value: t.subject, required: true }} onSave={(v) => update(id, { subject: v.trim() })} />
      <EditableProperty
        label="Status"
        display={stage ? <Chip color={stage.color} dot>{stage.name}</Chip> : null}
        editor={{ kind: "select", value: t.stageId, options: (pipeline?.stages ?? []).map((s) => ({ value: s.id, label: s.name })) }}
        onSave={(v) => {
          // through the service wrapper: logs "Ticket moved/closed", sets closedAt and pauses/resumes the SLA in "Waiting on Customer"
          const undo = moveServiceTicket(id, v);
          if (!undo) return;
          notify(`${t.id.toUpperCase()} → ${stageMap.get(v)?.name ?? "moved"} · logged on the timeline`, { label: "Undo", run: () => undoTicketMove(undo) });
        }}
      />
      <EditableProperty
        label="Priority"
        display={<span className={softText[ticketPriorityMeta[t.priority].color]}>{ticketPriorityMeta[t.priority].label}</span>}
        editor={{ kind: "select", value: t.priority, options: (["urgent", "high", "medium", "low"] as const).map((p) => ({ value: p, label: ticketPriorityMeta[p].label })) }}
        onSave={(v) => changePriority(v as Ticket["priority"])}
      />
      <EditableProperty label="Category" display={t.category} editor={{ kind: "select", value: t.category, options: categories.map((c) => ({ value: c, label: c })) }} onSave={(v) => update(id, { category: v as Ticket["category"] })} />
      <EditableProperty label="SLA due (WIB)" display={`${formatDate(t.slaDueAt, "datetime")} WIB`} editor={{ kind: "datetime", value: t.slaDueAt }} onSave={(v) => update(id, { slaDueAt: v })} />
      <EditableProperty label="Ticket owner" display={<OwnerDisplay ownerId={t.ownerId} />} editor={{ kind: "select", value: t.ownerId, options: owners }} onSave={(v) => update(id, { ownerId: v })} />
      <EditableProperty label="Description" display={t.description} editor={{ kind: "textarea", value: t.description }} onSave={(v) => update(id, { description: v })} />
      <EditableProperty label="Create date" display={`${formatDate(t.createdAt, "datetime")} WIB`} readOnly />
    </div>
  );
}
