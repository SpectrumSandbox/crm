"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { ArrowRight, Building2, FileText, Handshake, Kanban, Keyboard, Phone, Plus, Ticket, User, Users } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { issueTypeMeta, lifecycleMeta } from "@/lib/meta";
import { cn, formatIDR, softText } from "@/lib/utils";
import { Kbd } from "@/components/ui/misc";
import { recordFromPath } from "./hotkeys";

const itemCls =
  "flex cursor-pointer select-none items-center gap-2.5 rounded px-2.5 py-2 text-sm text-sg-text aria-selected:bg-sg-card-3 aria-selected:text-sg-white data-[disabled=true]:opacity-40";
const groupCls =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-sg-dim";

/** Every typed word must appear somewhere in the item's value or keywords; whole-word/prefix hits rank higher. */
function tokenFilter(value: string, search: string, keywords?: string[]) {
  const hay = `${value} ${(keywords ?? []).join(" ")}`.toLowerCase();
  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;
  let score = 0;
  for (const t of tokens) {
    const at = hay.indexOf(t);
    if (at < 0) return 0;
    score += at === 0 || /[\s\-—·(/]/.test(hay[at - 1] ?? "") ? 1 : 0.5;
  }
  return score / tokens.length;
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const openDialog = useUi((s) => s.openDialog);
  const openIssue = useUi((s) => s.openIssue);
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");

  const contacts = useCrm((s) => s.contacts);
  const companies = useCrm((s) => s.companies);
  const deals = useCrm((s) => s.deals);
  const tickets = useCrm((s) => s.tickets);
  const issues = useCrm((s) => s.issues);
  const pipelines = useCrm((s) => s.pipelines);

  const stageName = useMemo(() => new Map(pipelines.flatMap((p) => p.stages.map((s) => [s.id, s.name] as const))), [pipelines]);
  const companyName = useMemo(() => new Map(companies.map((c) => [c.id, c.name] as const)), [companies]);
  const current = recordFromPath(pathname);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const go = (href: string) => {
    close();
    router.push(href);
  };

  // only render record results once the user types — keeps the default view a tidy action menu
  const searching = query.trim().length > 0;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[14vh] z-50 w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-xl border border-sg-line bg-sg-card shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search records or run an action</DialogPrimitive.Description>
          <div className="sg-spectrum-rule h-[2px]" />
          <Command label="Command palette" loop filter={tokenFilter} className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-sg-line px-4">
              <Command.Input
                value={query}
                onValueChange={setQuery}
                autoFocus
                placeholder="Search contacts, companies, deals, tickets, issues — or type a command"
                className="h-12 flex-1 bg-transparent text-base text-sg-white placeholder:text-sg-dim focus:outline-none"
              />
              <Kbd>esc</Kbd>
            </div>
            <Command.List className="max-h-[56vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-sm text-sg-muted">No matches. Try a company, a person, a deal or an issue key like UAV-102.</Command.Empty>

              <Command.Group heading="Quick actions" className={groupCls}>
                <Command.Item value="action log call" keywords={["phone", "activity"]} onSelect={() => openDialog({ kind: "logActivity", activityType: "call", target: current })} className={itemCls}>
                  <Phone className="size-4 text-soft-green" /> Log call {current ? <span className="text-sg-dim">on this record</span> : null}
                  <Kbd className="ml-auto">L</Kbd>
                </Command.Item>
                <Command.Item value="action create issue" keywords={["jira", "bug", "story", "task"]} onSelect={() => openDialog({ kind: "createIssue", link: current ? { crmType: current.type, crmId: current.id, linkType: "relates_to" } : undefined })} className={itemCls}>
                  <Kanban className="size-4 text-soft-cyan" /> Create issue {current ? <span className="text-sg-dim">linked to this record</span> : null}
                </Command.Item>
                <Command.Item
                  value="action create deal"
                  keywords={["opportunity", "pipeline"]}
                  onSelect={() =>
                    openDialog({
                      kind: "createDeal",
                      companyId: current?.type === "company" ? current.id : current?.type === "contact" ? contacts.find((c) => c.id === current.id)?.companyId ?? undefined : undefined,
                      contactId: current?.type === "contact" ? current.id : undefined,
                    })
                  }
                  className={itemCls}
                >
                  <Handshake className="size-4 text-soft-yellow" /> Create deal
                </Command.Item>
                <Command.Item value="action generate quote" keywords={["cpq", "pricing", "proposal"]} onSelect={() => openDialog({ kind: "generateQuote", dealId: current?.type === "deal" ? current.id : undefined })} className={itemCls}>
                  <FileText className="size-4 text-soft-magenta" /> Generate quote
                </Command.Item>
                <Command.Item value="action create contact" keywords={["person", "lead"]} onSelect={() => openDialog({ kind: "createContact", companyId: current?.type === "company" ? current.id : undefined })} className={itemCls}>
                  <User className="size-4 text-soft-blue" /> Create contact
                </Command.Item>
                <Command.Item value="action create company" keywords={["account", "organisation"]} onSelect={() => openDialog({ kind: "createCompany" })} className={itemCls}>
                  <Plus className="size-4 text-soft-orange" /> Create company
                </Command.Item>
              </Command.Group>

              <Command.Group heading="Navigate" className={groupCls}>
                {[
                  { href: "/deals", label: "Deals pipeline", icon: Handshake, keys: "G D" },
                  { href: "/contacts", label: "Contacts", icon: Users, keys: "G C" },
                  { href: "/companies", label: "Companies", icon: Building2, keys: "G O" },
                  { href: "/board", label: "Agile board", icon: Kanban, keys: "G B" },
                ].map((n) => (
                  <Command.Item key={n.href} value={`nav ${n.label}`} onSelect={() => go(n.href)} className={itemCls}>
                    <n.icon className="size-4 text-sg-muted" /> {n.label}
                    <span className="ml-auto flex gap-1">
                      {n.keys.split(" ").map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  </Command.Item>
                ))}
                <Command.Item value="nav keyboard shortcuts help" onSelect={() => openDialog({ kind: "shortcuts" })} className={itemCls}>
                  <Keyboard className="size-4 text-sg-muted" /> Keyboard shortcuts <Kbd className="ml-auto">?</Kbd>
                </Command.Item>
              </Command.Group>

              {searching && (
                <>
                  <Command.Group heading="Deals" className={groupCls}>
                    {deals.map((d) => (
                      <Command.Item key={d.id} value={`deal ${d.id} ${d.name}`} keywords={[companyName.get(d.companyId ?? "") ?? "", d.capability]} onSelect={() => go(`/deals/${d.id}`)} className={itemCls}>
                        <Handshake className="size-4 shrink-0 text-soft-yellow" />
                        <span className="truncate">{d.name}</span>
                        <span className="ml-auto shrink-0 text-xs text-sg-dim">
                          {stageName.get(d.stageId)} · {formatIDR(d.amount)}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                  <Command.Group heading="Contacts" className={groupCls}>
                    {contacts.map((c) => (
                      <Command.Item key={c.id} value={`contact ${c.id} ${c.firstName} ${c.lastName}`} keywords={[c.email, c.jobTitle, companyName.get(c.companyId ?? "") ?? ""]} onSelect={() => go(`/contacts/${c.id}`)} className={itemCls}>
                        <User className="size-4 shrink-0 text-soft-blue" />
                        <span className="truncate">
                          {c.firstName} {c.lastName}
                        </span>
                        <span className="truncate text-xs text-sg-dim">{companyName.get(c.companyId ?? "")}</span>
                        <span className="ml-auto shrink-0 text-xs text-sg-dim">{lifecycleMeta[c.lifecycleStage].label}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                  <Command.Group heading="Companies" className={groupCls}>
                    {companies.map((c) => (
                      <Command.Item key={c.id} value={`company ${c.id} ${c.name}`} keywords={[c.domain, c.industry, c.city]} onSelect={() => go(`/companies/${c.id}`)} className={itemCls}>
                        <Building2 className="size-4 shrink-0 text-soft-orange" />
                        <span className="truncate">{c.name}</span>
                        <span className="ml-auto shrink-0 text-xs text-sg-dim">{c.domain}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                  <Command.Group heading="Tickets" className={groupCls}>
                    {tickets.map((t) => (
                      <Command.Item key={t.id} value={`ticket ${t.id} ${t.subject}`} keywords={[companyName.get(t.companyId ?? "") ?? "", t.category]} onSelect={() => go(`/tickets/${t.id}`)} className={itemCls}>
                        <Ticket className="size-4 shrink-0 text-soft-red" />
                        <span className="truncate">{t.subject}</span>
                        <span className="ml-auto shrink-0 text-xs text-sg-dim">{stageName.get(t.stageId)}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                  <Command.Group heading="Issues" className={groupCls}>
                    {issues.map((i) => {
                      const Icon = issueTypeMeta[i.type].icon;
                      return (
                        <Command.Item
                          key={i.id}
                          value={`issue ${i.key} ${i.summary}`}
                          keywords={i.labels}
                          onSelect={() => {
                            close();
                            openIssue(i.id);
                          }}
                          className={itemCls}
                        >
                          <Icon className={cn("size-4 shrink-0", softText[issueTypeMeta[i.type].color])} />
                          <span className="shrink-0 font-semibold text-sg-muted">{i.key}</span>
                          <span className="truncate">{i.summary}</span>
                          <ArrowRight className="ml-auto size-3.5 shrink-0 text-sg-dim" />
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                </>
              )}
            </Command.List>
            <div className="flex items-center gap-3 border-t border-sg-line px-4 py-2 text-2xs text-sg-dim">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> open
              </span>
              <span className="ml-auto">Searches contacts · companies · deals · tickets · issues</span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
