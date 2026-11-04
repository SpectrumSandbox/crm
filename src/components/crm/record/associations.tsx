"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, ChevronDown, ChevronRight, FileText, Handshake, Kanban, Minus, Package, Plus, Ticket, Unlink, User, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAssociations, useStageMap, useUserMap } from "@/lib/selectors";
import type { CrmObjectType, QuoteStatus } from "@/lib/types";
import { issueStatusMeta, issueTypeMeta, lifecycleMeta, linkTypeMeta, priorityMeta, quoteStatusMeta, ticketPriorityMeta } from "@/lib/meta";
import { cn, formatDate, formatIDR, softText } from "@/lib/utils";
import { Avatar, Chip, RecordAvatar } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { RecordPicker } from "@/components/shell/dialogs";

export function AssociationsPane({ type, id }: { type: CrmObjectType; id: string }) {
  const a = useAssociations(type, id);
  const stageMap = useStageMap();
  const userMap = useUserMap();
  const openDialog = useUi((s) => s.openDialog);
  const openIssue = useUi((s) => s.openIssue);
  const unlink = useCrm((s) => s.unlink);
  const deals = useCrm((s) => s.deals);
  const setDealContacts = useCrm((s) => s.setDealContacts);
  const updateContact = useCrm((s) => s.updateContact);
  const notify = useUi((s) => s.notify);
  const deal = type === "deal" ? deals.find((d) => d.id === id) : undefined;
  const selfParentId = useCrm((s) => (type === "company" ? s.companies.find((c) => c.id === id)?.parentId ?? null : null));
  const openLinks = a.links.filter((l) => (l.issue ? l.issue.status !== "done" : l.epic?.status !== "done"));

  return (
    <div className="space-y-3 p-4">
      {/* Jira first — the bridge is the point of this platform */}
      <Card
        title="Linked Jira work"
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
                    unlink(l.id);
                    notify(`${key} unlinked`);
                  }}
                  className="ml-auto rounded p-0.5 text-sg-dim opacity-0 hover:text-soft-red group-hover:opacity-100"
                  aria-label="Unlink"
                  title="Unlink"
                >
                  <Unlink className="size-3" />
                </button>
              </div>
              <button type="button" onClick={() => (l.issue ? openIssue(l.issue.id) : undefined)} className="flex w-full items-start gap-2 text-left">
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
          {a.quotes.map((q) => <QuoteRow key={q.id} quoteId={q.id} />)}
        </Card>
      )}

      {type !== "deal" && (
        <Card
          title="Deals"
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

      <Card
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
              <button type="button" onClick={() => setDealContacts(deal.id, deal.contactIds.filter((x) => x !== c.id))} className="rounded p-1 text-sg-dim opacity-0 hover:text-soft-red group-hover:opacity-100" aria-label="Remove association">
                <X className="size-3" />
              </button>
            )}
          </div>
        ))}
      </Card>

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
        <Card title="Tickets" icon={Ticket} count={a.tickets.length}>
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
      {type === "ticket" && a.deals.length > 0 && (
        <Card title="Deals at this account" icon={Handshake} count={a.deals.length}>
          {a.deals.map((d) => (
            <Link key={d.id} href={`/deals/${d.id}`} className="block truncate rounded-md px-1 py-1.5 text-sm text-sg-text hover:bg-sg-card-2 hover:text-sg-white">
              {d.name}
            </Link>
          ))}
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

function QuoteRow({ quoteId }: { quoteId: string }) {
  const quote = useCrm((s) => s.quotes.find((q) => q.id === quoteId));
  const setQuoteStatus = useCrm((s) => s.setQuoteStatus);
  if (!quote) return null;
  const sub = quote.lineItems.reduce((s, l) => s + l.quantity * l.unitPrice * (1 - l.discountPct / 100), 0);
  const meta = quoteStatusMeta[quote.status];
  const next: Partial<Record<QuoteStatus, QuoteStatus[]>> = {
    draft: ["pending_approval"],
    pending_approval: ["approved", "draft"],
    approved: ["sent"],
    sent: ["signed", "expired"],
  };
  return (
    <div className="rounded-md border border-sg-line bg-sg-bg/40 p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-2xs font-semibold text-sg-dim">{quote.number}</span>
        <Menu>
          <MenuTrigger asChild>
            <button type="button" className="ml-auto" disabled={!next[quote.status]?.length}>
              <Chip color={meta.color}>{meta.label}</Chip>
            </button>
          </MenuTrigger>
          {next[quote.status]?.length ? (
            <MenuContent align="end">
              <MenuLabel>Move quote to</MenuLabel>
              {next[quote.status]!.map((s) => (
                <MenuItem key={s} onSelect={() => setQuoteStatus(quote.id, s)}>
                  {quoteStatusMeta[s].label}
                </MenuItem>
              ))}
            </MenuContent>
          ) : null}
        </Menu>
      </div>
      <div className="mt-1 truncate text-sm text-sg-white">{quote.title}</div>
      <div className="mt-1 flex justify-between text-2xs text-sg-dim">
        <span className="sg-num font-semibold text-sg-text">{formatIDR(sub * (1 + quote.taxPct / 100))} incl. VAT</span>
        <span>expires {formatDate(quote.expiresAt, "short")}</span>
      </div>
    </div>
  );
}

/** Deal line items (CPQ "configure" step) — feeds Generate Quote. */
function LineItemsCard({ dealId }: { dealId: string }) {
  const allItems = useCrm((s) => s.lineItems);
  const products = useCrm((s) => s.products);
  const addLineItem = useCrm((s) => s.addLineItem);
  const updateLineItem = useCrm((s) => s.updateLineItem);
  const removeLineItem = useCrm((s) => s.removeLineItem);
  const items = allItems.filter((l) => l.dealId === dealId);
  const total = items.reduce((s, l) => s + l.quantity * l.unitPrice * (1 - l.discountPct / 100), 0);

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
                    {p.sku} · {formatIDR(p.unitPrice)}
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
                <div className="text-2xs text-sg-dim">
                  {p?.sku} · {formatIDR(l.unitPrice)} ea{l.discountPct ? ` · −${l.discountPct}%` : ""}
                </div>
              </div>
              <button type="button" onClick={() => removeLineItem(l.id)} className="rounded p-0.5 text-sg-dim opacity-0 hover:text-soft-red group-hover:opacity-100" aria-label="Remove line item">
                <X className="size-3" />
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex items-center rounded border border-sg-line">
                <button type="button" className="px-1.5 py-0.5 text-sg-dim hover:text-sg-white" onClick={() => updateLineItem(l.id, { quantity: Math.max(1, l.quantity - 1) })} aria-label="Decrease quantity">
                  <Minus className="size-3" />
                </button>
                <span className="sg-num min-w-[2ch] text-center text-xs text-sg-white">{l.quantity}</span>
                <button type="button" className="px-1.5 py-0.5 text-sg-dim hover:text-sg-white" onClick={() => updateLineItem(l.id, { quantity: l.quantity + 1 })} aria-label="Increase quantity">
                  <Plus className="size-3" />
                </button>
              </div>
              <select value={l.discountPct} onChange={(e) => updateLineItem(l.id, { discountPct: Number(e.target.value) })} className="h-6 rounded border border-sg-line bg-transparent px-1 text-2xs text-sg-muted [&>option]:bg-sg-card" aria-label="Discount">
                {[0, 3, 5, 8, 10, 12, 15, 20].map((d) => (
                  <option key={d} value={d}>
                    {d}% off
                  </option>
                ))}
              </select>
              <span className="sg-num ml-auto text-xs font-semibold text-sg-white">{formatIDR(l.quantity * l.unitPrice * (1 - l.discountPct / 100))}</span>
            </div>
          </div>
        );
      })}
      {items.length > 0 && (
        <div className="flex justify-between border-t border-sg-line px-1 pt-2 text-xs">
          <span className="text-sg-muted">Subtotal (excl. VAT)</span>
          <span className="sg-num font-bold text-sg-white">{formatIDR(total)}</span>
        </div>
      )}
    </Card>
  );
}
