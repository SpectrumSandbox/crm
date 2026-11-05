"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, Building2, ChevronDown, ChevronRight, FileText, Handshake, History, Kanban, Minus, Package, Plus, Ticket, Unlink, User, Users, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAssociations, useStageMap, useUserMap } from "@/lib/selectors";
import type { CrmObjectType } from "@/lib/types";
import { issueStatusMeta, issueTypeMeta, lifecycleMeta, linkTypeMeta, priorityMeta, ticketPriorityMeta } from "@/lib/meta";
import { cn, formatDate, formatIDR, softText } from "@/lib/utils";
import { QuoteRow } from "@/components/crm/quote-panels";
import { DealHistoryList, useDealHistory } from "@/components/crm/deal-panels";
import { applyDealChange } from "@/components/crm/deal-close";
import { Avatar, Chip, RecordAvatar } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { RecordPicker } from "@/components/shell/dialogs";
import { SampleChip, initiativeStatusMeta } from "@/components/initiatives/shared";
import { PROJECT_TYPE_META } from "@/lib/initiatives/policy";

export function AssociationsPane({ type, id }: { type: CrmObjectType; id: string }) {
  const a = useAssociations(type, id);
  const stageMap = useStageMap();
  const userMap = useUserMap();
  const openDialog = useUi((s) => s.openDialog);
  const openIssue = useUi((s) => s.openIssue);
  const router = useRouter();
  const unlink = useCrm((s) => s.unlink);
  const restoreCrossLink = useCrm((s) => s.restoreCrossLink);
  const expireQuotes = useCrm((s) => s.expireQuotes);
  const colleagues = useCrm((s) => s.contacts);
  const deals = useCrm((s) => s.deals);
  const setDealContacts = useCrm((s) => s.setDealContacts);
  const updateContact = useCrm((s) => s.updateContact);
  const notify = useUi((s) => s.notify);
  const deal = type === "deal" ? deals.find((d) => d.id === id) : undefined;
  const selfParentId = useCrm((s) => (type === "company" ? s.companies.find((c) => c.id === id)?.parentId ?? null : null));
  const openLinks = a.links.filter((l) => (l.issue ? l.issue.status !== "done" : l.epic?.status !== "done"));
  // quotes past their validity are marked expired (and logged) whenever a record with quotes opens
  useEffect(() => {
    if (a.quotes.length) expireQuotes();
  }, [a.quotes.length, expireQuotes]);
  const selfCompanyId = type === "contact" ? (a.companies[0]?.id ?? null) : null;
  const sameCompany = useMemo(() => (selfCompanyId ? colleagues.filter((c) => c.companyId === selfCompanyId && c.id !== id) : []), [colleagues, selfCompanyId, id]);

  return (
    <div className="space-y-3 p-4">
      {/* Jira first — the bridge is the point of this platform */}
      <Card
        title="Jira work"
        icon={Kanban}
        count={a.links.length}
        tone={openLinks.some((l) => l.linkType === "blocks") ? "red" : undefined}
        action={
          <div className="flex gap-1">
            <Button size="xs" variant="ghost" onClick={() => openDialog({ kind: "linkIssue", crmType: type, crmId: id })}>
              Link
            </Button>
            <Button size="xs" variant="ghost" onClick={() => openDialog({ kind: "createIssue", link: { crmType: type, crmId: id, linkType: type === "ticket" ? "escalated_from" : type === "deal" ? "implements" : "relates_to" } })}>
              <Plus /> Issue
            </Button>
          </div>
        }
      >
        {a.links.map((l) => {
          const key = l.issue?.key ?? l.epic?.key ?? "";
          const summary = l.issue?.summary ?? l.epic?.name ?? "";
          const status = l.issue?.status ?? l.epic?.status ?? "todo";
          const TypeIcon = l.issue ? issueTypeMeta[l.issue.type].icon : Kanban;
          const assignee = l.issue?.assigneeId ? userMap.get(l.issue.assigneeId) : l.epic ? userMap.get(l.epic.ownerId) : undefined;
          return (
            <div key={l.id} className="group rounded-md border border-sg-line bg-sg-bg/40 p-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-2xs">
                <span className={cn("font-semibold uppercase tracking-wider", softText[linkTypeMeta[l.linkType].color])}>{linkTypeMeta[l.linkType].crmSide}</span>
                <button
                  type="button"
                  onClick={() => {
                    const all = useCrm.getState().crossLinks;
                    const index = all.findIndex((x) => x.id === l.id);
                    const { issue: _i, epic: _e, ...link } = l;
                    unlink(l.id);
                    notify(`${key} unlinked`, { label: "Undo", run: () => restoreCrossLink(link, index) });
                  }}
                  className="ml-auto rounded p-0.5 text-sg-dim opacity-0 hover:text-soft-red focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                  aria-label={`Unlink ${key}`}
                  title="Unlink"
                >
                  <Unlink className="size-3" />
                </button>
              </div>
              <button type="button" onClick={() => (l.issue ? openIssue(l.issue.id) : l.epic ? router.push(`/board?project=${encodeURIComponent(l.epic.projectId)}&epic=${encodeURIComponent(l.epic.id)}`) : undefined)} className="flex w-full items-start gap-2 text-left" title={l.epic ? "Open the epic on the board" : "Open the issue"}>
                <TypeIcon className={cn("mt-0.5 size-3.5 shrink-0", l.issue ? softText[issueTypeMeta[l.issue.type].color] : "text-soft-magenta")} />
                <span className="min-w-0 flex-1">
                  <span className="mr-1.5 font-semibold text-sg-muted">{key}</span>
                  <span className="text-sm text-sg-text hover:text-sg-white">{summary}</span>
                </span>
              </button>
              <div className="mt-2 flex items-center gap-2">
                <Chip color={issueStatusMeta[status].color}>{issueStatusMeta[status].label}</Chip>
                {l.issue && <span className={cn("text-2xs", softText[priorityMeta[l.issue.priority].color])}>{priorityMeta[l.issue.priority].label}</span>}
                {l.epic && <span className="text-2xs font-semibold uppercase text-soft-magenta">Epic</span>}
                <Avatar user={assignee} size="xs" className="ml-auto" />
              </div>
            </div>
          );
        })}
      </Card>

      {type === "deal" && deal && <LineItemsCard dealId={deal.id} />}

      {type === "deal" && deal && <HistoryCard dealId={deal.id} />}

      {(type === "deal" || type === "company") && <InitiativesCard type={type} id={id} />}

      {(type === "deal" || type === "company") && (
        <Card
          title="Quotes"
          icon={FileText}
          count={a.quotes.length}
          action={
            type === "deal" ? (
              <Button size="xs" variant="ghost" onClick={() => openDialog({ kind: "generateQuote", dealId: id })}>
                <Plus /> Quote
              </Button>
            ) : undefined
          }
        >
          {[...a.quotes].sort((x, y) => y.createdAt.localeCompare(x.createdAt)).map((q) => (
            <QuoteRow key={q.id} quoteId={q.id} />
          ))}
        </Card>
      )}

      {type !== "deal" && (
        <Card
          title={type === "ticket" ? "Deals at this account" : "Deals"}
          icon={Handshake}
          count={a.deals.length}
          action={
            type === "contact" || type === "company" ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  openDialog({
                    kind: "createDeal",
                    companyId: type === "company" ? id : a.companies[0]?.id,
                    contactId: type === "contact" ? id : undefined,
                  })
                }
              >
                <Plus /> Deal
              </Button>
            ) : undefined
          }
        >
          {a.deals.map((d) => {
            const st = stageMap.get(d.stageId);
            return (
              <Link key={d.id} href={`/deals/${d.id}`} className="block rounded-md border border-sg-line bg-sg-bg/40 p-2.5 hover:border-sg-line-2">
                <div className="truncate text-sm font-semibold text-sg-white">{d.name}</div>
                <div className="mt-1 flex items-center gap-2 text-2xs text-sg-dim">
                  <span className="sg-num font-semibold text-sg-text">{formatIDR(d.amount)}</span>
                  {st && <Chip color={st.color}>{st.name}</Chip>}
                  <span className="ml-auto">{formatDate(d.closeDate, "short")}</span>
                </div>
              </Link>
            );
          })}
        </Card>
      )}

      {type === "contact" && (
        <Card title={a.companies[0] ? `Colleagues at ${a.companies[0].name}` : "Colleagues"} icon={Users} count={sameCompany.length}>
          {sameCompany.slice(0, 8).map((c) => (
            <Link key={c.id} href={`/contacts/${c.id}`} className="flex items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-sg-card-2">
              <RecordAvatar label={`${c.firstName} ${c.lastName}`} color={lifecycleMeta[c.lifecycleStage].color} size="sm" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-sg-white">
                  {c.firstName} {c.lastName}
                </div>
                <div className="truncate text-2xs text-sg-dim">{c.jobTitle}</div>
              </div>
            </Link>
          ))}
          {sameCompany.length > 8 && a.companies[0] && (
            <Link href={`/companies/${a.companies[0].id}`} className="block px-1 text-2xs text-sg-dim hover:text-sg-white">
              + {sameCompany.length - 8} more on the company record
            </Link>
          )}
        </Card>
      )}

      {type !== "contact" && <Card
        title="Contacts"
        icon={User}
        count={a.contacts.length}
        action={
          type === "deal" || type === "company" ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button size="xs" variant="ghost">
                  <Plus /> Add
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-2" align="end">
                <RecordPicker
                  types={["contact"]}
                  exclude={a.contacts.map((c) => c.id)}
                  onPick={(_t, contactId) => {
                    if (type === "deal" && deal) setDealContacts(deal.id, [...deal.contactIds, contactId]);
                    if (type === "company") updateContact(contactId, { companyId: id });
                    notify("Contact associated");
                  }}
                />
              </PopoverContent>
            </Popover>
          ) : undefined
        }
      >
        {a.contacts.map((c) => (
          <div key={c.id} className="group flex items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-sg-card-2">
            <RecordAvatar label={`${c.firstName} ${c.lastName}`} color={lifecycleMeta[c.lifecycleStage].color} size="sm" />
            <Link href={`/contacts/${c.id}`} className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-sg-white">
                {c.firstName} {c.lastName}
              </div>
              <div className="truncate text-2xs text-sg-dim">{c.jobTitle}</div>
            </Link>
            {type === "deal" && deal && (
              <button
                type="button"
                onClick={() => {
                  const prev = deal.contactIds;
                  setDealContacts(deal.id, prev.filter((x) => x !== c.id));
                  notify(`${c.firstName} ${c.lastName} removed from the deal`, { label: "Undo", run: () => setDealContacts(deal.id, prev) });
                }}
                className="rounded p-1 text-sg-dim opacity-0 hover:text-soft-red focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                aria-label={`Remove ${c.firstName} ${c.lastName} from this deal`}
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        ))}
      </Card>}

      <Card title={type === "company" ? "Related companies" : "Company"} icon={Building2} count={a.companies.length}>
        {a.companies.map((c) => (
          <Link key={c.id} href={`/companies/${c.id}`} className="flex items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-sg-card-2">
            <RecordAvatar label={c.name} size="sm" square color="blue" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-sg-white">{c.name}</div>
              <div className="truncate text-2xs text-sg-dim">
                {type === "company" ? (c.id === selfParentId ? "Parent company" : "Child business unit") : c.domain}
              </div>
            </div>
          </Link>
        ))}
      </Card>

      {type !== "ticket" && (
        <Card
          title="Tickets"
          icon={Ticket}
          count={a.tickets.length}
          action={
            type === "contact" || type === "company" ? (
              <Link
                href={`/tickets?new=1${type === "company" ? `&companyId=${encodeURIComponent(id)}` : `${a.companies[0] ? `&companyId=${encodeURIComponent(a.companies[0].id)}` : ""}&contactId=${encodeURIComponent(id)}`}`}
                className="inline-flex h-6 items-center gap-1 rounded px-2 text-2xs font-semibold text-sg-muted hover:bg-sg-card-2 hover:text-sg-white"
                title="Open a support ticket for this account"
              >
                <Plus className="size-3" /> Ticket
              </Link>
            ) : undefined
          }
        >
          {a.tickets.map((t) => {
            const st = stageMap.get(t.stageId);
            return (
              <Link key={t.id} href={`/tickets/${t.id}`} className="block rounded-md border border-sg-line bg-sg-bg/40 p-2.5 hover:border-sg-line-2">
                <div className="line-clamp-2 text-sm font-semibold text-sg-white">{t.subject}</div>
                <div className="mt-1 flex items-center gap-2 text-2xs">
                  {st && <Chip color={st.color}>{st.name}</Chip>}
                  <span className={softText[ticketPriorityMeta[t.priority].color]}>{ticketPriorityMeta[t.priority].label}</span>
                </div>
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function Card({
  title,
  icon: Icon,
  count,
  action,
  children,
  tone,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  action?: React.ReactNode;
  children: React.ReactNode;
  tone?: "red";
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className={cn("rounded-xl border bg-sg-card", tone === "red" ? "border-soft-red/40" : "border-sg-line")}>
      <header className="flex items-center gap-1.5 px-3 py-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-1.5 text-left">
          {open ? <ChevronDown className="size-3.5 text-sg-dim" /> : <ChevronRight className="size-3.5 text-sg-dim" />}
          <Icon className={cn("size-3.5", tone === "red" ? "text-soft-red" : "text-sg-muted")} />
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-sg-white">{title}</span>
          <span className="text-2xs text-sg-dim">({count})</span>
        </button>
        {action}
      </header>
      {open && <div className="space-y-1.5 px-3 pb-3">{count ? children : <p className="px-1 py-1 text-2xs text-sg-dim">None yet.</p>}</div>}
    </section>
  );
}

/** Project initiatives (PRC proposals) raised against this deal or company. */
function InitiativesCard({ type, id }: { type: "deal" | "company"; id: string }) {
  const all = useCrm((s) => s.initiatives);
  const items = useMemo(() => all.filter((i) => (type === "deal" ? i.dealId === id : i.companyId === id)), [all, type, id]);
  return (
    <Card
      title="Initiatives"
      icon={Briefcase}
      count={items.length}
      action={
        type === "deal" ? (
          <Link
            href={`/initiatives/new?fromDeal=${encodeURIComponent(id)}`}
            title="Start a PRC proposal prefilled from this deal — client, revenue cases, type, contract status, first CRM contact and milestones from its quote or line items"
            className="inline-flex h-6 items-center gap-1 rounded px-2 text-2xs font-semibold text-sg-muted hover:bg-sg-card-2 hover:text-sg-white"
          >
            <Plus className="size-3" /> Propose initiative
          </Link>
        ) : undefined
      }
    >
      {items.map((i) => {
        const st = initiativeStatusMeta[i.status];
        return (
          <Link key={i.id} href={`/initiatives/${i.id}`} className="block rounded-md border border-sg-line bg-sg-bg/40 p-2.5 hover:border-sg-line-2">
            <div className="flex items-baseline gap-1.5">
              {(i.code ?? i.trackingNo) && <span className="shrink-0 text-2xs font-semibold text-sg-muted">{i.code ?? i.trackingNo}</span>}
              <span className="truncate text-sm font-semibold text-sg-white">{i.title}</span>
              {i.demo ? <SampleChip className="shrink-0" /> : null}
            </div>
            <div className="mt-1 flex items-center gap-2 text-2xs">
              <Chip color={st.color} dot>
                {st.label}
              </Chip>
              <span className={softText[PROJECT_TYPE_META[i.type].color]}>
                Type {i.type} · {PROJECT_TYPE_META[i.type].short}
              </span>
            </div>
          </Link>
        );
      })}
    </Card>
  );
}

/** Tracked changes on the deal (amount, close date, stage, owner, forecast) — Pipeline Inspection style. */
function HistoryCard({ dealId }: { dealId: string }) {
  const rows = useDealHistory(dealId);
  return (
    <Card title="History" icon={History} count={rows.length}>
      <DealHistoryList dealId={dealId} />
    </Card>
  );
}

/** Deal line items (CPQ "configure" step) — feeds Generate Quote. */
function LineItemsCard({ dealId }: { dealId: string }) {
  const allItems = useCrm((s) => s.lineItems);
  const products = useCrm((s) => s.products);
  const deal = useCrm((s) => s.deals.find((d) => d.id === dealId));
  const addLineItem = useCrm((s) => s.addLineItem);
  const updateLineItem = useCrm((s) => s.updateLineItem);
  const removeLineItem = useCrm((s) => s.removeLineItem);
  const restoreLineItem = useCrm((s) => s.restoreLineItem);
  const notify = useUi((s) => s.notify);
  const items = useMemo(() => allItems.filter((l) => l.dealId === dealId), [allItems, dealId]);
  const total = Math.round(items.reduce((s, l) => s + l.quantity * l.unitPrice * (1 - l.discountPct / 100), 0));
  const delta = deal ? total - deal.amount : 0;
  const driftPct = deal && deal.amount > 0 ? Math.abs(delta) / deal.amount : 0;

  const remove = (id: string) => {
    const all = useCrm.getState().lineItems;
    const index = all.findIndex((l) => l.id === id);
    const item = all[index];
    if (!item) return;
    removeLineItem(id);
    const p = products.find((x) => x.id === item.productId);
    notify(`${p?.name ?? "Line item"} removed`, { label: "Undo", run: () => restoreLineItem(item, index) });
  };

  return (
    <Card
      title="Line items"
      icon={Package}
      count={items.length}
      action={
        <Menu>
          <MenuTrigger asChild>
            <Button size="xs" variant="ghost">
              <Plus /> Product
            </Button>
          </MenuTrigger>
          <MenuContent align="end" className="w-80">
            <MenuLabel>Product library</MenuLabel>
            {products.map((p) => (
              <MenuItem key={p.id} onSelect={() => addLineItem(dealId, p.id, 1)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p.name}</span>
                  <span className="text-2xs text-sg-dim">
                    {p.sku} · {formatIDR(p.unitPrice, "full")}
                    {p.billing !== "one_time" ? ` / ${p.billing === "monthly" ? "mo" : "yr"}` : ""}
                  </span>
                </span>
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      }
    >
      {items.map((l) => {
        const p = products.find((x) => x.id === l.productId);
        return (
          <div key={l.id} className="group rounded-md border border-sg-line bg-sg-bg/40 p-2">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-sg-white">{p?.name}</div>
                <div className="sg-num text-2xs text-sg-dim">
                  {p?.sku} · {formatIDR(l.unitPrice, "full")} ea{l.discountPct ? ` · −${l.discountPct}%` : ""}
                </div>
              </div>
              <button type="button" onClick={() => remove(l.id)} className="rounded p-0.5 text-sg-dim opacity-0 hover:text-soft-red focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100" aria-label={`Remove ${p?.name ?? "line item"}`}>
                <X className="size-3" />
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex items-center rounded border border-sg-line">
                <button type="button" className="px-1.5 py-0.5 text-sg-dim hover:text-sg-white" onClick={() => updateLineItem(l.id, { quantity: Math.max(1, l.quantity - 1) })} aria-label="Decrease quantity">
                  <Minus className="size-3" />
                </button>
                <NumberCell key={`q-${l.quantity}`} value={l.quantity} min={1} step={1} label={`Quantity of ${p?.name ?? "item"}`} onCommit={(n) => updateLineItem(l.id, { quantity: Math.round(n) })} className="w-10" />
                <button type="button" className="px-1.5 py-0.5 text-sg-dim hover:text-sg-white" onClick={() => updateLineItem(l.id, { quantity: l.quantity + 1 })} aria-label="Increase quantity">
                  <Plus className="size-3" />
                </button>
              </div>
              <span className="flex items-center gap-0.5 rounded border border-sg-line pr-1 text-2xs text-sg-dim">
                <NumberCell key={`d-${l.discountPct}`} value={l.discountPct} min={0} max={100} step={0.5} label={`Discount on ${p?.name ?? "item"} (%)`} onCommit={(n) => updateLineItem(l.id, { discountPct: Math.round(n * 2) / 2 })} className="w-9" />% off
              </span>
              <span className="sg-num ml-auto text-xs font-semibold text-sg-white">{formatIDR(l.quantity * l.unitPrice * (1 - l.discountPct / 100), "full")}</span>
            </div>
          </div>
        );
      })}
      {items.length > 0 && (
        <div className="space-y-1 border-t border-sg-line px-1 pt-2 text-xs">
          <div className="flex justify-between">
            <span className="text-sg-muted">Subtotal (excl. PPN)</span>
            <span className="sg-num font-bold text-sg-white">{formatIDR(total, "full")}</span>
          </div>
          {deal && delta !== 0 && (
            <div className={cn("flex items-center justify-between gap-2 rounded px-1.5 py-1 text-2xs", driftPct > 0.05 ? "bg-soft-yellow/10 text-soft-yellow" : "text-sg-dim")}>
              <span className="sg-num">
                Δ vs deal amount {delta > 0 ? "+" : "−"}
                {formatIDR(Math.abs(delta), "full")} ({Math.round(driftPct * 1000) / 10}%)
              </span>
              <button type="button" onClick={() => applyDealChange(dealId, { amount: total }, `Deal amount set to the line-item subtotal ${formatIDR(total, "full")}`)} className="shrink-0 font-semibold underline-offset-2 hover:underline">
                Set deal amount
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** small numeric input: commits on blur / Enter, reverts on Esc or invalid input */
function NumberCell({ value, min, max, step, label, onCommit, className }: { value: number; min?: number; max?: number; step: number; label: string; onCommit: (n: number) => void; className?: string }) {
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const n = Number(draft.replace(",", "."));
    if (draft.trim() === "" || !Number.isFinite(n) || (min !== undefined && n < min) || (max !== undefined && n > max)) {
      setDraft(String(value));
      return;
    }
    if (n !== value) onCommit(n);
  };
  return (
    <input
      value={draft}
      inputMode="decimal"
      step={step}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          e.stopPropagation();
          setDraft(String(value));
        }
      }}
      className={cn("sg-num h-5 bg-transparent text-center text-xs text-sg-white focus:outline-none focus:ring-1 focus:ring-sg-white/50", className)}
    />
  );
}
